/* =========================================================
   js/api-gas.js
   طبقة التواصل مع Google Apps Script (GAS) لواجهة الويب
   - GET جميع البيانات
   - POST إضافة سجل/استيراد سجلات
   - استيراد CSV (ملف أو نص)
   - اكتشاف نوع التمبليت (Inpatient/Outpatient)
   - معالجة CORS + إعادة المحاولة + تقليل الحركات
   ========================================================= */

(function (global) {
  "use strict";

  // عدّل هذا المتغيّر مرة واحدة فقط (رابط نشر الويب أب من GAS):
  // مثال: https://script.google.com/macros/s/AKfycby.../exec
  const GAS_URL_DEFAULT = "PUT-YOUR-GAS-WEB-APP-URL-HERE";

  // حالة داخلية + إعدادات
  const state = {
    gasUrl: GAS_URL_DEFAULT,
    lastFetchTs: 0,
    cacheTTLms: 12 * 1000, // 12 ثانية كذاكرة مؤقتة بسيطة لتخفيف الطلبات
    memoryCache: null,     // كاش قوية لعرض الجدول مباشرة
  };

  // أداة تأخير
  const delay = (ms) => new Promise((res) => setTimeout(res, ms));

  // إعادة المحاولة مع Backoff
  async function withRetry(fn, { tries = 3, baseDelay = 300 } = {}) {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (err) {
        attempt++;
        if (attempt >= tries) throw err;
        await delay(baseDelay * Math.pow(2, attempt - 1));
      }
    }
  }

  // إرسال طلب JSON موحّد إلى GAS
  async function gasFetchJson(method, payload) {
    const url = state.gasUrl || GAS_URL_DEFAULT;
    const opts = {
      method,
      headers: {
        "Content-Type": "application/json",
      },
      redirect: "follow",
    };
    if (method === "POST") {
      opts.body = JSON.stringify(payload || {});
    }

    return withRetry(async () => {
      const res = await fetch(url, opts);
      if (!res.ok) {
        // في حال كانت OPTIONS/CORS على بعض الشبكات، GAS يردّ doOptions
        // ومع ذلك نحن نطلب GET/POST فقط هنا.
        const text = await res.text().catch(() => "");
        throw new Error(`GAS fetch failed (${res.status}): ${text}`);
      }
      // قد يعيد GAS نص JSON
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        // لو رجع نص فارغ (مثلاً doPost success بدون جسم)، نرجّع كائن بسيط
        return text ? { raw: text } : { status: "success" };
      }
    });
  }

  // ======================================================
  // واجهات عامة للتعامل مع GAS
  // ======================================================

  /**
   * تعيين/تغيير رابط GAS
   */
  function setGasUrl(url) {
    if (typeof url === "string" && url.trim()) {
      state.gasUrl = url.trim();
    }
  }

  /**
   * قراءة كل السجلات (مع ذاكرة مؤقتة قصيرة)
   * يعيد مصفوفة من الكائنات:
   * [{ Patient Code, Patient Name, Intervention, Department, Palliative Member, Date }, ...]
   */
  async function getAllRecords({ force = false } = {}) {
    const now = Date.now();
    const fresh = now - state.lastFetchTs < state.cacheTTLms;
    if (!force && fresh && Array.isArray(state.memoryCache)) {
      return state.memoryCache;
    }
    const data = await gasFetchJson("GET");
    // تأكّد من المصفوفة
    const list = Array.isArray(data) ? data : (Array.isArray(data.records) ? data.records : []);
    state.memoryCache = list;
    state.lastFetchTs = Date.now();
    return list;
  }

  /**
   * إضافة سجل واحد
   * record: {
   *   "Patient Code": "...",
   *   "Patient Name": "...",
   *   "Intervention": "...",
   *   "Department": "...",
   *   "Palliative Member": "...",
   *   // Date يُحدد على السيرفر
   * }
   */
  async function addRecord(record) {
    const payload = { action: "add", record };
    const res = await gasFetchJson("POST", payload);
    // بعد الإضافة، نحدّث الكاش محليًا بسرعة
    try {
      if (!state.memoryCache) state.memoryCache = [];
      state.memoryCache.push({
        "Patient Code": record["Patient Code"] || "",
        "Patient Name": record["Patient Name"] || "",
        "Intervention": record["Intervention"] || "",
        "Department": record["Department"] || "",
        "Palliative Member": record["Palliative Member"] || "",
        "Date": new Date().toLocaleDateString("en-GB"),
      });
    } catch {}
    return res;
  }

  /**
   * استيراد مجموعة سجلات دفعة واحدة
   * records: Array<record>
   * - سيجري تجاهل أعمدة Unnamed على السيرفر أيضًا
   */
  async function importRecords(records) {
    const payload = { action: "import", records: records || [] };
    const res = await gasFetchJson("POST", payload);
    // بعد الاستيراد، اجلب الكل بقوة لتحديث الجدول
    await getAllRecords({ force: true });
    return res;
  }

  // ======================================================
  // CSV Utilities
  // ======================================================

  /**
   * كشف نوع التمبليت (تجريبي وبسيط)
   * - لو يحتوي الهيدر على حقول: Patient Age أو Room -> Inpatient
   * - لو يحتوي على Intervention أو Visit Type -> Outpatient
   */
  function detectTemplateType(headers) {
    const H = headers.map((h) => (h || "").toLowerCase().trim());
    const hasInpatientHints = H.includes("patient age") || H.includes("room") || H.includes("admitting provider");
    const hasOutpatientHints = H.includes("intervention") || H.includes("visit type") || H.includes("opc");
    if (hasInpatientHints && !hasOutpatientHints) return "inpatient";
    if (hasOutpatientHints && !hasInpatientHints) return "outpatient";
    // لو مختلط أو غير واضح، نختار "inpatient" كافتراضي حسب التمبليت المرسل
    return "inpatient";
  }

  /**
   * Parser بسيط للـ CSV (بدون مكتبات خارجية)
   * يدعم: فواصل ، اقتباس مزدوج ، أسطر جديدة
   */
  function parseCsv(text, { delimiter = "," } = {}) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            // escaped quote
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += c;
        }
      } else {
        if (c === '"') {
          inQuotes = true;
        } else if (c === delimiter) {
          row.push(cur);
          cur = "";
        } else if (c === "\n") {
          row.push(cur);
          rows.push(row);
          row = [];
          cur = "";
        } else if (c === "\r") {
          // ignore \r (windows newlines)
        } else {
          cur += c;
        }
      }
    }
    // آخر خلية إن وجدت
    if (cur.length > 0 || row.length > 0) {
      row.push(cur);
      rows.push(row);
    }
    return rows;
  }

  /**
   * يحوّل CSV rows إلى كائنات بناءً على أول صف (Headers)
   * - يتجاهل الأعمدة الفارغة أو التي تبدأ بـ Unnamed
   */
  function rowsToObjects(rows) {
    if (!rows || !rows.length) return [];
    const headers = rows[0].map((h) => String(h || "").trim());
    const objects = [];

    for (let r = 1; r < rows.length; r++) {
      const obj = {};
      const row = rows[r] || [];
      let nonEmpty = false;

      for (let c = 0; c < headers.length; c++) {
        const key = headers[c];
        if (!key) continue;
        const lc = key.toLowerCase();
        if (lc.includes("unnamed")) continue;

        const val = (row[c] === undefined || row[c] === null) ? "" : String(row[c]).trim();
        if (val !== "") nonEmpty = true;
        obj[key] = val;
      }
      if (nonEmpty) objects.push(obj);
    }
    return { objects, headers };
  }

  /**
   * تطبيع السجلات لحقول الويب الرئيسية الموحدة
   * - يركّز على: Patient Code / Patient Name / Intervention / Department / Palliative Member
   * - يبقي الحقول الأخرى بدون حذف (سيتم تجاهلها في GAS)
   * - لو Outpatient و visitType = other(custom) سيستبدل القيمة
   */
  function normalizeRecordsForApp(objects, { defaultDepartment = "", defaultMember = "", visitTypeField = "Visit Type", otherVisitField = "Visit Other" } = {}) {
    return objects.map((src) => {
      const rec = { ...src };

      // أسماء الأعمدة المستهدفة (مرنة)
      const pCode = rec["Patient Code"] || rec["Code"] || "";
      const pName = rec["Patient Name"] || rec["Name"] || "";
      let intervention = rec["Intervention"] || rec["intervention"] || "";
      let department = rec["Department"] || rec["department"] || defaultDepartment || "";
      let member = rec["Palliative Member"] || rec["Palliative member"] || rec["Member"] || defaultMember || "";

      // دعم Outpatient: Visit Type (OPC/Clinic consult/TR/P.Office/Other)
      // استبدال Other بالنص الحرّ إذا موجود
      const visitTypeRaw = rec[visitTypeField] || rec["visit type"] || rec["VisitType"] || "";
      const otherText = rec[otherVisitField] || rec["Other"] || rec["other"] || "";
      if (visitTypeRaw) {
        const lower = String(visitTypeRaw).toLowerCase();
        if (lower === "other" && otherText) {
          rec[visitTypeField] = otherText;
        }
      }

      // ضمان الحقول الأساسية
      rec["Patient Code"] = pCode;
      rec["Patient Name"] = pName;
      rec["Intervention"] = intervention;
      rec["Department"] = department;
      rec["Palliative Member"] = member;

      return rec;
    });
  }

  // ======================================================
  // استيراد CSV (من نص أو ملف)
  // ======================================================

  /**
   * استيراد CSV من نصّ خام (كما بعد قراءة الملف)
   * - يكتشف النوع (Inpatient/Outpatient) للاستخدام لاحقًا
   * - يطبّع الحقول المطلوبة للتطبيق
   * - يرسل السجلات إلى GAS بدفعة واحدة
   */
  async function importCsvText(csvText, { defaultDepartment = "", defaultMember = "" } = {}) {
    const rows = parseCsv(csvText);
    const { objects, headers } = rowsToObjects(rows);
    const templateType = detectTemplateType(headers);

    // تطبيع
    const normalized = normalizeRecordsForApp(objects, { defaultDepartment, defaultMember });

    // إرسال دفعة واحدة
    const res = await importRecords(normalized);
    return { res, count: normalized.length, templateType };
  }

  /**
   * استيراد CSV من ملف (File object من <input type="file">)
   */
  async function importCsvFile(file, { defaultDepartment = "", defaultMember = "" } = {}) {
    const csvText = await readFileAsText(file);
    return importCsvText(csvText, { defaultDepartment, defaultMember });
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => reject(fr.error || new Error("Failed to read file"));
      fr.readAsText(file, "UTF-8");
    });
  }

  // ======================================================
  // أدوات مساعدة
  // ======================================================

  /**
   * تجميع سريع لإضافة عدة سجلات دفعة واحدة (يحوّلها إلى importRecords)
   * - مفيد عند ترحيل بيانات Outpatient/ Inpatient بعد التعديل اليدوي من الواجهة
   */
  async function addMany(records) {
    if (!Array.isArray(records) || records.length === 0) {
      return { status: "noop" };
    }
    return importRecords(records);
  }

  /**
   * فحص صحة الاتصال بالـ GAS
   */
  async function healthCheck() {
    try {
      const data = await getAllRecords({ force: true });
      return { ok: true, count: Array.isArray(data) ? data.length : 0 };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  // ======================================================
  // تصدير الواجهة العامة
  // ======================================================

  const API = {
    setGasUrl,
    getAllRecords,
    addRecord,
    importRecords,
    importCsvText,
    importCsvFile,
    addMany,
    detectTemplateType,
    healthCheck,
  };

  // إتاحة الواجهة في window.GAS
  global.GAS = API;

})(window);
