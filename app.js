/* ======================================================
   KPI2 • Palliative Care Monitor
   ملف: app.js
   - تهيئة الواجهة، التيمات والحركات والتفضيلات
   - إدارة اليوم الجديد
   - إضافة/تعديل/حذف وImport CSV
   - فلاتر وجدول دائم + عدّادات
   - JSONP مع GAS (Sync/Load) لتفادي CORS
   ====================================================== */

import {
  APP_VERSION,
  PALLIATIVE_MEMBERS,
  INTERVENTIONS,
  OUT_TYPES,
  KEYS,
  DEFAULT_PREFERENCES,
  DEFAULT_GAS_URL,
  PatientSchema,
  uid,
  todayISO,
  clamp,
  normalizeOutType,
  validatePatient,
  toPatientRecord,
  CSV_HEADERS,
  CSV_HEADER_MAP,
  buildCsvTemplate,
  buildJsonpUrl,
  chunkString,
} from "./schema.js";

/* ============== حالة التطبيق ============== */
const state = {
  patientsAll: [],   // كل السجل عبر الأيام (لا يحذف)
  currentDay: todayISO(),
  prefs: structuredClone(DEFAULT_PREFERENCES),
  gasBase: DEFAULT_GAS_URL,
  importContext: { inout: "out" }, // يتغير حسب زر الاستيراد
};

/* ============== أدوات التخزين المحلي ============== */
const store = {
  load() {
    try {
      const ver = localStorage.getItem(KEYS.version);
      if (ver !== APP_VERSION) {
        // ترقية مستقبلية إن لزم
        localStorage.setItem(KEYS.version, APP_VERSION);
      }
      const all = JSON.parse(localStorage.getItem(KEYS.all) || "[]");
      const day = localStorage.getItem(KEYS.day) || todayISO();
      const prefs = JSON.parse(localStorage.getItem(KEYS.prefs) || "null");
      state.patientsAll = Array.isArray(all) ? all : [];
      state.currentDay = day;
      state.prefs = { ...DEFAULT_PREFERENCES, ...(prefs || {}) };
      if (state.prefs.gasUrlOverride) state.gasBase = state.prefs.gasUrlOverride;
    } catch (e) {
      console.error("Store load error:", e);
    }
  },
  saveAll() {
    localStorage.setItem(KEYS.all, JSON.stringify(state.patientsAll));
  },
  savePrefs() {
    localStorage.setItem(KEYS.prefs, JSON.stringify(state.prefs));
  },
  saveDay() {
    localStorage.setItem(KEYS.day, state.currentDay);
  },
};

/* ============== عناصر DOM ============== */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const el = {
  toast: $("#toast"),
  toastText: $("#toast-text"),
  toastClose: $("#toast-close"),

  themeSelect: $("#theme-select"),
  btnPrefs: $("#btn-preferences"),

  todayLabel: $("#today-label"),
  btnNewDay: $("#btn-new-day"),

  btnAddManual: $("#btn-add-manual"),
  btnImportOut: $("#btn-import-out"),
  btnImportIn: $("#btn-import-in"),
  linkTemplate: $("#btn-download-template"),

  outTypeSelect: $("#out-type-select"),
  outTypeOther: $("#out-type-other"),

  // counters
  countJawad: $("#count-jawad"),
  countAsala: $("#count-asala"),
  countAmin: $("#count-amin"),
  countTotal: $("#count-total"),

  // filters
  filterDept: $("#filter-dept"),
  filterIntervention: $("#filter-intervention"),
  filterMember: $("#filter-member"),
  filterName: $("#filter-name"),
  filterCode: $("#filter-code"),
  filterDate: $("#filter-date"),
  btnApplyFilters: $("#btn-apply-filters"),
  btnClearFilters: $("#btn-clear-filters"),

  // table
  tbody: $("#patients-tbody"),
  btnWeekly: $("#btn-export-weekly"),
  btnMonthly: $("#btn-export-monthly"),
  btnYearly: $("#btn-export-yearly"),
  btnSync: $("#btn-sync"),

  // modal patient
  modalPatient: $("#modal-patient"),
  formPatient: $("#form-patient"),
  modalPatientTitle: $("#modal-patient-title"),
  fldDate: $("#fld-date"),
  fldName: $("#fld-name"),
  fldCode: $("#fld-code"),
  fldInout: $("#fld-inout"),
  fldOutType: $("#fld-outtype"),
  fldOutTypeOther: $("#fld-outtype-other"),
  fldDept: $("#fld-dept"),
  fldIntervention: $("#fld-intervention"),
  fldMember: $("#fld-member"),
  fldNotes: $("#fld-notes"),
  btnSavePatient: $("#btn-save-patient"),

  // modal import
  modalImport: $("#modal-import"),
  formImport: $("#form-import"),
  fldFile: $("#fld-file"),
  fldBulkMember: $("#fld-bulk-member"),
  fldBulkDept: $("#fld-bulk-dept"),

  // preferences
  modalPrefs: $("#modal-preferences"),
  formPrefs: $("#form-preferences"),
  prefSpeed: $("#pref-speed"),
  prefMotion: $("#pref-motion"),
  prefGas: $("#pref-gas-url"),
  prefAutoSync: $("#pref-auto-sync"),
  prefDensity: $("#pref-ui-density"),

  rowTemplate: $("#row-template"),
};

let editId = null; // لتحديد السجل الجاري تعديله

/* ============== تهيئة UI ============== */
function initUI() {
  // تاريخ اليوم الظاهر
  el.todayLabel.textContent = state.currentDay;

  // تحميل الثيم
  document.body.setAttribute("data-theme", state.prefs.theme);
  el.themeSelect.value = state.prefs.theme;
  el.themeSelect.addEventListener("change", () => {
    state.prefs.theme = el.themeSelect.value;
    document.body.setAttribute("data-theme", state.prefs.theme);
    store.savePrefs();
  });

  // حركة وسرعة وكثافة
  applyMotionAndDensity();

  // روابط المودالات
  el.btnPrefs.addEventListener("click", () => openModal(el.modalPrefs));
  attachModalClose();

  // زر بدء يوم جديد
  el.btnNewDay.addEventListener("click", handleNewDay);

  // إضافة يدوي
  el.btnAddManual.addEventListener("click", () => openPatientModal());

  // الاستيراد
  el.btnImportOut.addEventListener("click", () => {
    state.importContext.inout = "out";
    $("#modal-import-title").textContent = "استيراد Outpatient CSV";
    openModal(el.modalImport);
  });
  el.btnImportIn.addEventListener("click", () => {
    state.importContext.inout = "in";
    $("#modal-import-title").textContent = "استيراد Inpatient CSV";
    openModal(el.modalImport);
  });

  // تحميل قالب CSV كـ blob
  const tmpl = buildCsvTemplate();
  const blob = new Blob([tmpl], { type: "text/csv;charset=utf-8" });
  el.linkTemplate.href = URL.createObjectURL(blob);
  el.linkTemplate.download = "kpi2_template.csv";

  // OutType في التولبار: عندما other نفعّل حقل الكتابة
  function handleOutToolbar() {
    const v = el.outTypeSelect.value;
    el.outTypeOther.classList.toggle("hidden", v !== "other");
  }
  el.outTypeSelect.addEventListener("change", handleOutToolbar);
  handleOutToolbar();

  // فلاتر
  el.btnApplyFilters.addEventListener("click", renderTable);
  el.btnClearFilters.addEventListener("click", clearFilters);

  // مودال المريض حفظ
  el.formPatient.addEventListener("submit", onSavePatient);

  // مودال الاستيراد
  el.formImport.addEventListener("submit", onImportCsv);

  // تفضيلات
  fillPrefsForm();
  el.formPrefs.addEventListener("submit", onSavePrefs);

  // مزامنة
  el.btnSync.addEventListener("click", syncAllToGAS);

  // تقارير
  el.btnWeekly.addEventListener("click", () => exportReport("week"));
  el.btnMonthly.addEventListener("click", () => exportReport("month"));
  el.btnYearly.addEventListener("click", () => exportReport("year"));

  // Toast close
  el.toastClose.addEventListener("click", () => hideToast());

  // أول عرض
  renderTable();
  updateCounters();
}

/* ============== تفضيلات: تطبيق الحركة والكثافة ============== */
function applyMotionAndDensity() {
  document.documentElement.style.setProperty("--speed", `${clamp(+state.prefs.speed || 240, 80, 2000)}ms`);
  document.documentElement.setAttribute("data-motion", state.prefs.motion);
  document.documentElement.setAttribute("data-density", state.prefs.uiDensity === "compact" ? "compact" : "cozy");
}

/* ============== مودالات ============== */
function openModal(dialog) {
  dialog.showModal();
}
function closeModal(dialog) {
  dialog.close();
}
function attachModalClose() {
  $$("[data-close]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const dialog = e.currentTarget.closest("dialog");
      dialog?.close();
    });
  });
}

/* ============== Toast ============== */
function showToast(msg, type = "info") {
  el.toast.classList.remove("toast-hidden", "toast-success", "toast-danger", "toast-info");
  el.toast.classList.add(`toast-${type}`);
  el.toastText.textContent = msg;
}
function hideToast() {
  el.toast.classList.add("toast-hidden");
}

/* ============== جدول + ريندر ============== */
function clearFilters() {
  el.filterDept.value = "";
  el.filterIntervention.value = "";
  el.filterMember.value = "";
  el.filterName.value = "";
  el.filterCode.value = "";
  el.filterDate.value = "";
  renderTable();
}

function applyFilters(list) {
  let out = list;
  const dept = el.filterDept.value.trim();
  const intrv = el.filterIntervention.value;
  const mem = el.filterMember.value;
  const name = el.filterName.value.trim();
  const code = el.filterCode.value.trim();
  const date = el.filterDate.value;

  if (dept) out = out.filter((r) => r.dept?.toLowerCase().includes(dept.toLowerCase()));
  if (intrv) out = out.filter((r) => r.intervention === intrv);
  if (mem) out = out.filter((r) => r.member === mem);
  if (name) out = out.filter((r) => r.name?.toLowerCase().includes(name.toLowerCase()));
  if (code) out = out.filter((r) => r.code?.toLowerCase().includes(code.toLowerCase()));
  if (date) out = out.filter((r) => r.date === date);

  return out;
}

function renderTable() {
  // السجل دائم لا يُحذف؛ الفلاتر تتحكم بالعرض
  const rows = applyFilters([...state.patientsAll]).sort((a, b) => (a.date > b.date ? -1 : 1));
  el.tbody.innerHTML = "";

  for (const r of rows) {
    const tr = el.rowTemplate.content.firstElementChild.cloneNode(true);
    tr.querySelector('[data-col="date"]').textContent = r.date || "";
    tr.querySelector('[data-col="name"]').textContent = r.name || "";
    tr.querySelector('[data-col="code"]').textContent = r.code || "";
    tr.querySelector('[data-col="inout"]').textContent = r.inout || "";
    tr.querySelector('[data-col="outtype"]').textContent = r.outtype || "";
    tr.querySelector('[data-col="dept"]').textContent = r.dept || "";
    tr.querySelector('[data-col="intervention"]').textContent = r.intervention || "";
    tr.querySelector('[data-col="member"]').textContent = r.member || "";
    tr.querySelector('[data-col="notes"]').textContent = r.notes || "";

    const btnEdit = tr.querySelector('[data-action="edit"]');
    const btnDelete = tr.querySelector('[data-action="delete"]');
    btnEdit.addEventListener("click", () => openPatientModal(r));
    btnDelete.addEventListener("click", () => deletePatient(r.id));

    el.tbody.appendChild(tr);
  }
}

/* ============== عدّادات الفريق ليوم محدد (currentDay) ============== */
function updateCounters() {
  const day = state.currentDay;
  const list = state.patientsAll.filter((r) => r.date === day);
  const c = {
    jawad: list.filter((r) => r.member === "جواد أبو صبحة").length,
    asala: list.filter((r) => r.member === "أصالة نوباني").length,
    amin: list.filter((r) => r.member === "أمين دحدولان").length,
  };
  el.countJawad.textContent = c.jawad;
  el.countAsala.textContent = c.asala;
  el.countAmin.textContent = c.amin;
  el.countTotal.textContent = list.length;
}

/* ============== بدء يوم جديد ============== */
function handleNewDay() {
  // نحفظ اليوم السابق ضمن السجل (هو محفوظ أساساً؛ لا حذف)
  const prevDay = state.currentDay;
  state.currentDay = todayISO();
  store.saveDay();
  el.todayLabel.textContent = state.currentDay;

  showToast(`تم بدء يوم جديد (${state.currentDay}) وحُفظت بيانات ${prevDay}.`, "success");
  updateCounters();
}

/* ============== إضافة/تعديل مريض ============== */
function openPatientModal(rec = null) {
  editId = rec?.id || null;
  el.modalPatientTitle.textContent = editId ? "تعديل بيانات" : "إضافة مريض";

  // تحديد قيم افتراضية ذكية
  el.fldDate.value = rec?.date || state.currentDay;
  el.fldName.value = rec?.name || "";
  el.fldCode.value = rec?.code || "";
  el.fldInout.value = rec?.inout || "out";
  el.fldOutType.value = OUT_TYPES.includes(rec?.outtype) ? rec.outtype : (rec?.outtype ? "other" : (el.outTypeSelect.value || "")); // إذا قيمة مخصصة، نعرض "other"
  el.fldOutTypeOther.value = OUT_TYPES.includes(rec?.outtype) ? "" : (rec?.outtype || (el.outTypeOther.value || ""));
  el.fldDept.value = rec?.dept || "";
  el.fldIntervention.value = rec?.intervention || INTERVENTIONS[0];
  el.fldMember.value = rec?.member || PALLIATIVE_MEMBERS[0];
  el.fldNotes.value = rec?.notes || "";

  // إظهار/إخفاء حقل other
  handleOutOtherField();

  el.fldOutType.addEventListener("change", handleOutOtherField, { once: true });
  openModal(el.modalPatient);
}

function handleOutOtherField() {
  const v = el.fldOutType.value;
  el.fldOutTypeOther.classList.toggle("hidden", v !== "other");
}

function onSavePatient(e) {
  e.preventDefault();

  const data = {
    id: editId || uid(),
    date: el.fldDate.value || state.currentDay,
    name: el.fldName.value.trim(),
    code: el.fldCode.value.trim(),
    inout: el.fldInout.value,
    outtype: normalizeOutType(el.fldOutType.value, el.fldOutTypeOther.value),
    dept: el.fldDept.value.trim(),
    intervention: el.fldIntervention.value,
    member: el.fldMember.value,
    notes: el.fldNotes.value.trim(),
  };

  const errs = validatePatient(data);
  if (errs.length) {
    showToast(errs.join(" • "), "danger");
    return;
  }

  if (editId) {
    const i = state.patientsAll.findIndex((x) => x.id === editId);
    if (i >= 0) state.patientsAll[i] = data;
    showToast("تم تحديث السجل.", "success");
  } else {
    state.patientsAll.push(toPatientRecord(data));
    showToast("تمت إضافة المريض.", "success");
  }

  store.saveAll();
  closeModal(el.modalPatient);
  renderTable();
  updateCounters();

  // مزامنة تلقائية
  if (state.prefs.autoSync === "on") syncAllToGAS({ silent: true });
}

function deletePatient(id) {
  const idx = state.patientsAll.findIndex((x) => x.id === id);
  if (idx < 0) return;
  state.patientsAll.splice(idx, 1);
  store.saveAll();
  renderTable();
  updateCounters();
  showToast("تم حذف السجل.", "success");
  if (state.prefs.autoSync === "on") syncAllToGAS({ silent: true });
}

/* ============== استيراد CSV ============== */
async function onImportCsv(e) {
  e.preventDefault();
  const file = el.fldFile.files?.[0];
  if (!file) {
    showToast("الرجاء اختيار ملف CSV.", "danger");
    return;
  }

  const text = await file.text();
  const rows = parseCsv(text);
  if (!rows.length) {
    showToast("ملف CSV فارغ.", "danger");
    return;
  }

  const bulkMember = el.fldBulkMember.value || "";
  const bulkDept = el.fldBulkDept.value.trim() || "";

  // صف الرأس
  const headerRaw = rows[0].map((h) => (h || "").toString().trim().toLowerCase());
  const header = headerRaw.map((h) => CSV_HEADER_MAP[h] || h);

  const imports = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !`${c}`.trim())) continue; // تجاهل صفوف فارغة

    const obj = {};
    for (let c = 0; c < header.length; c++) {
      const key = header[c];
      if (!CSV_HEADERS.includes(key)) continue; // تجاهل أعمدة غير معروفة
      const val = (row[c] || "").toString().trim();
      if (val === "") continue; // تجاهل الأعمدة الفارغة
      obj[key] = val;
    }

    // تطبيق in/out من سياق زر الاستيراد
    obj.inout = state.importContext.inout;

    // تطبيع outtype
    if (obj.outtype && obj.outtype.toLowerCase() === "other" && !obj._other) {
      // إذا الملف كتب "other" بدون نص، نتركها other ونسمح بالتعديل لاحقاً
      obj.outtype = "other";
    }

    // Bulk department/member
    if (bulkDept && !obj.dept) obj.dept = bulkDept;
    if (bulkMember && !obj.member) obj.member = bulkMember;

    // ملء حقول ناقصة افتراضياً
    obj.date = obj.date || state.currentDay;
    obj.intervention = obj.intervention || INTERVENTIONS[0];
    obj.member = obj.member || PALLIATIVE_MEMBERS[0];
    obj.outtype = obj.outtype || (state.importContext.inout === "out" ? (el.outTypeSelect.value || "") : "");

    const rec = toPatientRecord(obj);

    // فاليديشن أساسي؛ نتجاوز السطر إذا فشل
    const errs = validatePatient(rec);
    if (errs.length) {
      console.warn("CSV row skipped due to validation:", r + 1, errs);
      continue;
    }
    imports.push(rec);
  }

  if (!imports.length) {
    showToast("لم يتم استيراد أي سجلات (تحقق من الأعمدة).", "danger");
    return;
  }

  state.patientsAll.push(...imports);
  store.saveAll();
  closeModal(el.modalImport);
  el.formImport.reset();
  renderTable();
  updateCounters();
  showToast(`تم استيراد ${imports.length} سجلّاً.`, "success");

  if (state.prefs.autoSync === "on") syncAllToGAS({ silent: true });
}

/** Parser CSV بسيط يدعم الفواصل والنصوص بين أقواس اقتباس */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"'; // escaped quote
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      row.push(cur);
      cur = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (cur || row.length) {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  // تنظيف النهاية من أسطر فارغة
  return rows.filter((r) => r.length && r.some((c) => `${c}`.trim() !== ""));
}

/* ============== تقارير (أسبوع/شهر/سنة) ============== */
function exportReport(kind = "week") {
  const all = state.patientsAll;
  if (!all.length) {
    showToast("لا توجد بيانات للتقرير.", "danger");
    return;
  }
  const now = new Date(state.currentDay);
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  let from, to, filename;
  if (kind === "week") {
    // نفترض الأسبوع يبدأ الأحد (يمكن تعديل ذلك)
    const idx = now.getDay(); // 0-6
    const start = new Date(now);
    start.setDate(day - idx);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    from = iso(start);
    to = iso(end);
    filename = `report_week_${from}_to_${to}.csv`;
  } else if (kind === "month") {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    from = iso(start);
    to = iso(end);
    filename = `report_month_${year}-${String(month + 1).padStart(2, "0")}.csv`;
  } else {
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    from = iso(start);
    to = iso(end);
    filename = `report_year_${year}.csv`;
  }

  const filtered = all.filter((r) => r.date >= from && r.date <= to);
  if (!filtered.length) {
    showToast("لا توجد بيانات في المدى المحدد.", "danger");
    return;
  }

  const csv = buildCsvFromRecords(filtered);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("تم توليد التقرير وتنزيله.", "success");
}

function iso(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildCsvFromRecords(list) {
  const lines = [CSV_HEADERS.join(",")];
  for (const r of list) {
    const row = [
      r.date || "",
      escapeCsv(r.name || ""),
      escapeCsv(r.code || ""),
      r.inout || "",
      escapeCsv(r.outtype || ""),
      escapeCsv(r.dept || ""),
      escapeCsv(r.intervention || ""),
      escapeCsv(r.member || ""),
      escapeCsv(r.notes || ""),
    ];
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

function escapeCsv(v) {
  v = `${v}`;
  if (v.includes('"') || v.includes(",") || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

/* ============== مزامنة JSONP مع GAS ============== */
/**
 * إستدعاء JSONP عام:
 * params يجب أن تحتوي على callback=__cbName
 */
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = "__jsonp_cb_" + Math.random().toString(36).slice(2);
    const cleanup = () => {
      delete window[cb];
      script.remove();
    };
    const script = document.createElement("script");
    window[cb] = (data) => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("JSONP failed"));
    };
    const sep = url.includes("?") ? "&" : "?";
    script.src = `${url}${sep}callback=${cb}`;
    document.body.appendChild(script);
  });
}

/** تحميل أولي من GAS (اختياري) */
async function loadFromGAS() {
  try {
    const url = buildJsonpUrl(state.gasBase, { action: "pullAll" });
    const res = await jsonp(url);
    if (res && Array.isArray(res.records)) {
      // دمج بدون تكرار حسب id
      const map = new Map(state.patientsAll.map((r) => [r.id, r]));
      for (const r of res.records) map.set(r.id, r);
      state.patientsAll = [...map.values()];
      store.saveAll();
      renderTable();
      updateCounters();
      showToast("تم تحميل آخر نسخة من Google Sheets.", "success");
    }
  } catch (e) {
    console.warn("Load from GAS failed:", e);
  }
}

/** إرسال دفعة إلى GAS مع تقليل عدد الطلبات عبر التجميع */
async function syncAllToGAS({ silent = false } = {}) {
  try {
    const payload = JSON.stringify({
      version: APP_VERSION,
      prefs: state.prefs,
      records: state.patientsAll,
    });

    // لتجنب طول URL: نقسم
    const chunks = chunkString(encodeURIComponent(payload), 1500);
    // البداية
    const startUrl = buildJsonpUrl(state.gasBase, { action: "syncStart", count: chunks.length });
    const start = await jsonp(startUrl);
    if (!start || !start.ok) throw new Error("syncStart failed");

    // دفعات
    for (let i = 0; i < chunks.length; i++) {
      const partUrl = buildJsonpUrl(state.gasBase, {
        action: "syncPart",
        idx: i,
        data: chunks[i],
      });
      const part = await jsonp(partUrl);
      if (!part || !part.ok) throw new Error(`syncPart ${i} failed`);
    }

    // إنهاء
    const endUrl = buildJsonpUrl(state.gasBase, { action: "syncEnd" });
    const end = await jsonp(endUrl);
    if (!end || !end.ok) throw new Error("syncEnd failed");

    if (!silent) showToast("تمت المزامنة مع Google Sheets.", "success");
    localStorage.setItem(KEYS.lastSync, new Date().toISOString());
  } catch (e) {
    showToast("فشل المزامنة مع Google Sheets.", "danger");
    console.error(e);
  }
}

/* ============== تفضيلات ============== */
function fillPrefsForm() {
  el.prefSpeed.value = state.prefs.speed;
  el.prefMotion.value = state.prefs.motion;
  el.prefGas.value = state.prefs.gasUrlOverride || "";
  el.prefAutoSync.value = state.prefs.autoSync;
  el.prefDensity.value = state.prefs.uiDensity;
}

function onSavePrefs(e) {
  e.preventDefault();
  state.prefs.speed = clamp(+el.prefSpeed.value || 240, 80, 2000);
  state.prefs.motion = el.prefMotion.value;
  state.prefs.gasUrlOverride = (el.prefGas.value || "").trim();
  state.prefs.autoSync = el.prefAutoSync.value;
  state.prefs.uiDensity = el.prefDensity.value;

  if (state.prefs.gasUrlOverride) state.gasBase = state.prefs.gasUrlOverride;
  else state.gasBase = DEFAULT_GAS_URL;

  store.savePrefs();
  applyMotionAndDensity();
  closeModal(el.modalPrefs);
  showToast("تم حفظ التفضيلات.", "success");
}

/* ============== أحداث البداية ============== */
function firstRunToastIfNewDay() {
  const storedDay = localStorage.getItem(KEYS.day);
  const t = todayISO();
  if (!storedDay || storedDay !== t) {
    state.currentDay = t;
    store.saveDay();
    el.todayLabel.textContent = state.currentDay;
    showToast(`تم بدء يوم جديد وحفظ كل السابق (${t}).`, "info");
  }
}

/* ============== boot ============== */
(function boot() {
  store.load();
  initUI();
  firstRunToastIfNewDay();
  // تحميل من GAS (اختياري: يمكنك التعليق إذا لا تريد سحب تلقائي)
  // loadFromGAS();
})();

/* ============== تحسينات UX صغيرة ============== */
// عند اختيار "other" في التولبار، يمكن استخدام النص افتراضياً عند الإضافة
// محمول في openPatientModal عبر قراءة outTypeSelect/outTypeOther
