/* ======================================================
   KPI2 • Palliative Care Monitor
   File: schema.js
   - Schema & constants (EN)
   - Validation & transforms
   - Default GAS URL
   - CSV templates & header maps
   ====================================================== */

/** Bump when structural changes occur */
export const APP_VERSION = "1.1.0";

/** Team members (kept as real names) */
export const PALLIATIVE_MEMBERS = [
  "جواد أبو صبحة",
  "أصالة نوباني",
  "أمين دحدولان",
];

/** Intervention types */
export const INTERVENTIONS = [
  "refill medication",
  "reassessment/dose modification",
  "new assessment/new patient",
];

/** Outpatient subtypes */
export const OUT_TYPES = ["OPC", "Clinic consult", "TR", "P.Office", "other"];

/** NEW: Response time options */
export const RESPONSE_TIME_OPTIONS = [
  "within half hour",
  "within hour",
  "more than hour",
];

/** LocalStorage keys */
export const KEYS = {
  all: "kpi2.patientsAll",
  version: "kpi2.version",
  prefs: "kpi2.preferences",
  day: "kpi2.currentDay", // YYYY-MM-DD
  toast: "kpi2.toastDismissedAt",
  lastSync: "kpi2.lastSync",
};

/** Default preferences */
export const DEFAULT_PREFERENCES = {
  theme: "ocean",
  motion: "slide", // slide|fade|glow
  speed: 240,      // ms
  autoSync: "on",
  uiDensity: "cozy",
  gasUrlOverride: "", // allows overriding the default GAS URL
};

/** Default GAS URL (can be edited prior to deploy) */
export const DEFAULT_GAS_URL =
  "https://script.google.com/macros/s/AKfycbzDcsaxkGQE2Zd6D06JvfENaXWlSfwWSnbZQs5Q1KpyFLFLWx-_0rlBChXqQkEYP2sN-g/exec";

/** Canonical patient record schema */
export const PatientSchema = {
  date: "string",           // ISO yyyy-mm-dd
  name: "string",
  code: "string",           // optional
  inout: "string",          // "in" | "out"
  outtype: "string",        // '', OPC, Clinic consult, TR, P.Office, or custom
  dept: "string",           // department name
  intervention: "string",   // from INTERVENTIONS
  member: "string",         // from PALLIATIVE_MEMBERS

  /** NEW fields */
  response_time: "string",  // from RESPONSE_TIME_OPTIONS
  delay_reason: "string",   // required if response_time === "more than hour"

  notes: "string",          // optional
  id: "string",             // internal uid
};

/** Utils */
export const uid = () =>
  "p_" +
  Math.random().toString(36).slice(2, 8) +
  Date.now().toString(36).slice(-6);

export const todayISO = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/** Normalize outtype when "other" is chosen with custom text */
export function normalizeOutType(value, otherText) {
  if (!value) return "";
  if (value === "other" && otherText && otherText.trim()) {
    return otherText.trim();
  }
  return value;
}

/** Validation */
export function validatePatient(p) {
  const errors = [];
  if (!p.date) errors.push("Date is required");
  if (!p.name) errors.push("Name is required");
  if (!p.inout || !["in", "out"].includes(p.inout))
    errors.push("In/Out must be 'in' or 'out'");
  if (!INTERVENTIONS.includes(p.intervention))
    errors.push("Invalid intervention");
  if (!PALLIATIVE_MEMBERS.includes(p.member))
    errors.push("Invalid palliative member");

  // NEW: response time validation
  if (!p.response_time || !RESPONSE_TIME_OPTIONS.includes(p.response_time)) {
    errors.push("Response Time is required");
  }
  // delay_reason required when "more than hour"
  if (p.response_time === "more than hour") {
    if (!p.delay_reason || !p.delay_reason.trim()) {
      errors.push("Delay Reason is required when response time is more than hour");
    }
  }
  return errors;
}

/** Map any object into a proper Patient record (ignore empty fields) */
export function toPatientRecord(src = {}) {
  const rec = {
    id: src.id || uid(),
    date: src.date || todayISO(),
    name: (src.name || "").trim(),
    code: (src.code || "").trim(),
    inout: src.inout === "in" ? "in" : "out",
    outtype: (src.outtype || "").trim(),
    dept: (src.dept || "").trim(),
    intervention: (src.intervention || "").trim(),
    member: (src.member || "").trim(),

    /** NEW fields normalized */
    response_time: (src.response_time || "").trim(),
    delay_reason: (src.delay_reason || "").trim(),

    notes: (src.notes || "").trim(),
  };
  return rec;
}

/** CSV: Default canonical headers (aligned with the provided template) */
export const CSV_HEADERS = [
  "date",
  "name",
  "code",
  "inout",
  "outtype",
  "dept",
  "intervention",
  "member",
  "response_time",  // NEW
  "delay_reason",   // NEW
  "notes",
];

/** Header map: common variants -> canonical names (EN-first, plus some legacy/AR aliases) */
export const CSV_HEADER_MAP = {
  // EN
  date: "date",
  "patient name": "name",
  name: "name",
  "patient code": "code",
  code: "code",
  "in/out": "inout",
  inout: "inout",
  "out type": "outtype",
  outtype: "outtype",
  department: "dept",
  dept: "dept",
  section: "dept",
  intervention: "intervention",
  member: "member",
  "palliative member": "member",
  "response time": "response_time",
  response_time: "response_time",
  "delay reason": "delay_reason",
  delay_reason: "delay_reason",
  notes: "notes",
  remark: "notes",

  // Legacy AR header aliases (kept for older files)
  تاريخ: "date",
  "patient name (ar)": "name",
  الاسم: "name",
  "patient code (ar)": "code",
  الكود: "code",
  "in/out (ar)": "inout",
  القسم: "dept",
  التدخل: "intervention",
  "عضو الرعاية": "member",
};

/** Build a CSV template as a string */
export function buildCsvTemplate() {
  const header = CSV_HEADERS.join(",");
  const rows = [
    // example row
    "2025-11-05,Patient Name,12345,out,OPC,OPC,refill medication,جواد أبو صبحة,within half hour,,",
  ];
  return [header, ...rows].join("\n");
}

/** JSONP URL builder */
export function buildJsonpUrl(base, params) {
  const q = new URLSearchParams(params);
  return `${base}?${q.toString()}`;
}

/** Split large strings into chunks (to limit JSONP URL length) */
export function chunkString(str, size = 1500) {
  const chunks = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.slice(i, i + size));
  }
  return chunks;
}
