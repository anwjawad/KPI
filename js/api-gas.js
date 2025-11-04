/* =========================================================
   js/api-gas.js  —  JSONP Edition (READ + WRITE via GET)
   - كل العمليات عبر GET لتجنّب CORS تمامًا
   - القراءة: action=get
   - إضافة سجل: action=add&payload=<b64>
   - استيراد عدة سجلات: action=import&payload=<b64>
   ========================================================= */

(function (global) {
  "use strict";

  // ضع رابط /exec تبع GAS
  const GAS_URL_DEFAULT = "https://script.google.com/macros/s/AKfycbwHadqtLWyHFoiwr12co13DKn6NV35KPJHqZvSwwY6nBveZsgCdwl5kDOcjtV6wXqZz/exec";

  const state = {
    gasUrl: GAS_URL_DEFAULT,
    lastFetchTs: 0,
    cacheTTLms: 12 * 1000,
    memoryCache: null,
  };

  function setGasUrl(url) {
    if (typeof url === "string" && url.trim()) state.gasUrl = url.trim();
  }

  // ----------------------- JSONP Core -----------------------
  function jsonp(url, { timeoutMs = 20000 } = {}) {
    return new Promise((resolve, reject) => {
      const cb = "cb_" + Math.random().toString(36).slice(2);
      const cleanup = () => {
        try { delete window[cb]; } catch {}
        if (script && script.parentNode) script.parentNode.removeChild(script);
      };
      const script = document.createElement("script");
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("JSONP timeout"));
      }, timeoutMs);

      window[cb] = (data) => {
        clearTimeout(timer);
        cleanup();
        resolve(data);
      };
      script.onerror = (e) => {
        clearTimeout(timer);
        cleanup();
        reject(new Error("JSONP network error"));
      };

      script.src = appendQuery(url, { callback: cb });
      document.body.appendChild(script);
    });
  }

  function appendQuery(base, params) {
    const qs = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    return base + (base.includes("?") ? "&" : "?") + qs;
  }

  // Base64 web-safe (بدون مكتبات)
  function b64webSafe(str) {
    // btoa يتطلب ASCII؛ لذلك نحول UTF-8 يدويًا
    const utf8 = unescape(encodeURIComponent(str));
    const b64 = btoa(utf8);
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  // ----------------------- API Calls via JSONP -----------------------
  async function getAllRecords({ force = false } = {}) {
    const now = Date.now();
    const fresh = now - state.lastFetchTs < state.cacheTTLms;
    if (!force && fresh && Array.isArray(state.memoryCache)) return state.memoryCache;

    const url = appendQuery(state.gasUrl, { action: "get" });
    const data = await jsonp(url);
    const list = Array.isArray(data) ? data : (Array.isArray(data.records) ? data.records : []);
    state.memoryCache = list;
    state.lastFetchTs = Date.now();
    return list;
  }

  async function addRecord(record) {
    const payload = b64webSafe(JSON.stringify({ record }));
    const url = appendQuery(state.gasUrl, { action: "add", payload });
    const res = await jsonp(url);
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

  // تقسيم دفعات الاستيراد لتجنّب طول URL (آمن ~7000 حرف)
  async function importRecords(records) {
    if (!Array.isArray(records) || records.length === 0) return { status: "noop" };

    const MAX_URL_CHARS = 7000;
    let i = 0;
    while (i < records.length) {
      // جرّب زيادة حجم الدفعة تدريجيًا
      let size = Math.min(200, records.length - i);
      while (size > 0) {
        const slice = records.slice(i, i + size);
        const payloadStr = JSON.stringify({ records: slice });
        const payload = b64webSafe(payloadStr);
        const testUrl = appendQuery(state.gasUrl, { action: "import", payload, callback: "x" });
        if (testUrl.length <= MAX_URL_CHARS) {
          // نفّذ الطلب الحقيقي
          const url = appendQuery(state.gasUrl, { action: "import", payload });
          await jsonp(url);
          i += size;
          break;
        }
        size = Math.floor(size / 2); // صغّر الدفعة
      }
      if (size === 0) throw new Error("Record too large for JSONP import; reduce record size.");
    }

    // تحديث الكاش
    await getAllRecords({ force: true });
    return { status: "success" };
  }

  // ----------------------- CSV Utilities (كما كانت) -----------------------
  function detectTemplateType(headers) {
    const H = headers.map((h) => (h || "").toLowerCase().trim());
    const hasInpatientHints = H.includes("patient age") || H.includes("room") || H.includes("admitting provider");
    const hasOutpatientHints = H.includes("intervention") || H.includes("visit type") || H.includes("opc");
    if (hasInpatientHints && !hasOutpatientHints) return "inpatient";
    if (hasOutpatientHints && !hasInpatientHints) return "outpatient";
    return "inpatient";
  }

  function parseCsv(text, { delimiter = "," } = {}) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else { inQuotes = false; }
        } else cur += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === delimiter) { row.push(cur); cur = ""; }
        else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
        else if (c === "\r") { /* ignore */ }
        else cur += c;
      }
    }
    if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
    return rows;
  }

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

  function normalizeRecordsForApp(objects, { defaultDepartment = "", defaultMember = "", visitTypeField = "Visit Type", otherVisitField = "Visit Other" } = {}) {
    return objects.map((src) => {
      const rec = { ...src };
      const pCode = rec["Patient Code"] || rec["Code"] || "";
      const pName = rec["Patient Name"] || rec["Name"] || "";
      let intervention = rec["Intervention"] || rec["intervention"] || "";
      let department = rec["Department"] || rec["department"] || defaultDepartment || "";
      let member = rec["Palliative Member"] || rec["Palliative member"] || rec["Member"] || defaultMember || "";

      const visitTypeRaw = rec[visitTypeField] || rec["visit type"] || rec["VisitType"] || "";
      const otherText = rec[otherVisitField] || rec["Other"] || rec["other"] || "";
      if (visitTypeRaw) {
        const lower = String(visitTypeRaw).toLowerCase();
        if (lower === "other" && otherText) rec[visitTypeField] = otherText;
      }

      rec["Patient Code"] = pCode;
      rec["Patient Name"] = pName;
      rec["Intervention"] = intervention;
      rec["Department"] = department;
      rec["Palliative Member"] = member;
      return rec;
    });
  }

  async function importCsvText(csvText, { defaultDepartment = "", defaultMember = "" } = {}) {
    const rows = parseCsv(csvText);
    const { objects, headers } = rowsToObjects(rows);
    const templateType = detectTemplateType(headers);
    const normalized = normalizeRecordsForApp(objects, { defaultDepartment, defaultMember });
    const res = await importRecords(normalized);
    return { res, count: normalized.length, templateType };
  }

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

  async function addMany(records) {
    if (!Array.isArray(records) || records.length === 0) return { status: "noop" };
    return importRecords(records);
  }

  async function healthCheck() {
    try {
      const data = await getAllRecords({ force: true });
      return { ok: true, count: Array.isArray(data) ? data.length : 0 };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  // تصدير
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

  global.GAS = API;

})(window);
