/* ======================================================
   KPI2 • Palliative Care Monitor
   ملف: schema.js
   - تعريف السكيما والقيم الثابتة
   - الفاليديشن والتحويلات
   - إعداد Default GAS URL
   - قوالب CSV وخرائط الأعمدة
   ====================================================== */

/** نسخة لتحديث التخزين المحلي عند تغييرات بنيوية */
export const APP_VERSION = "1.0.0";

/** أعضاء الفريق */
export const PALLIATIVE_MEMBERS = [
  "جواد أبو صبحة",
  "أصالة نوباني",
  "أمين دحدولان",
];

/** نوع التدخل */
export const INTERVENTIONS = [
  "refill medication",
  "reassessment/dose modification",
  "new assessment/new patient",
];

/** Outpatient subtypes */
export const OUT_TYPES = ["OPC", "Clinic consult", "TR", "P.Office", "other"];

/** مفاتيح التخزين المحلي */
export const KEYS = {
  all: "kpi2.patientsAll",
  version: "kpi2.version",
  prefs: "kpi2.preferences",
  day: "kpi2.currentDay", // YYYY-MM-DD
  toast: "kpi2.toastDismissedAt",
  lastSync: "kpi2.lastSync",
};

/** تفضيلات افتراضية */
export const DEFAULT_PREFERENCES = {
  theme: "ocean",
  motion: "slide", // slide|fade|glow
  speed: 240,      // ms
  autoSync: "on",
  uiDensity: "cozy",
  gasUrlOverride: "", // يسمح بتجاوز URL الافتراضي
};

/** عنوان GAS الافتراضي (يمكن تعديله هنا قبل البناء/النشر) */
export const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbzDcsaxkGQE2Zd6D06JvfENaXWlSfwWSnbZQs5Q1KpyFLFLWx-_0rlBChXqQkEYP2sN-g/exec";

/** السكيما القياسية لسجل مريض */
export const PatientSchema = {
  date: "string",         // ISO yyyy-mm-dd
  name: "string",
  code: "string",         // اختياري
  inout: "string",        // "in" | "out"
  outtype: "string",      // '', OPC, Clinic consult, TR, P.Office, or custom
  dept: "string",         // اسم القسم
  intervention: "string", // من INTERVENTIONS
  member: "string",       // من PALLIATIVE_MEMBERS
  notes: "string",        // اختياري
  id: "string",           // uid داخلي
};

/** أدوات صغيرة */
export const uid = () =>
  "p_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-6);

export const todayISO = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/** تنقيح قيمة outtype عند اختيار other */
export function normalizeOutType(value, otherText) {
  if (!value) return "";
  if (value === "other" && otherText && otherText.trim()) {
    return otherText.trim();
  }
  return value;
}

/** فاليديشن بسيط */
export function validatePatient(p) {
  const errors = [];
  if (!p.date) errors.push("التاريخ مطلوب");
  if (!p.name) errors.push("الاسم مطلوب");
  if (!p.inout || !["in", "out"].includes(p.inout)) errors.push("In/Out غير صحيح");
  if (!INTERVENTIONS.includes(p.intervention))
    errors.push("نوع التدخل غير صحيح");
  if (!PALLIATIVE_MEMBERS.includes(p.member))
    errors.push("عضو الرعاية غير صحيح");
  return errors;
}

/** تحويل أي كائن لسجل وفق السكيما (تجاهل الحقول الفارغة) */
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
    notes: (src.notes || "").trim(),
  };
  // حذف الحقول الفارغة اختيارياً عند الإرسال إلى GAS
  return rec;
}

/** CSV: رؤوس الأعمدة الافتراضية (متوافقة مع القالب المرفق) */
export const CSV_HEADERS = [
  "date",
  "name",
  "code",
  "inout",
  "outtype",
  "dept",
  "intervention",
  "member",
  "notes",
];

/** خريطة أسماء شائعة -> أسماءنا القياسية (مرونة للاستيراد) */
export const CSV_HEADER_MAP = {
  تاريخ: "date",
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
  notes: "notes",
  remark: "notes",
};

/** توليد CSV Template كسلسلة نصية */
export function buildCsvTemplate() {
  // نترك بعض الأعمدة فارغة اختيارياً (سيتجاهلها التطبيق)
  const header = CSV_HEADERS.join(",");
  const rows = [
    // مثال توضيحي لسطر
    "2025-11-05,اسم المريض,12345,out,OPC,OPC,refill medication,جواد أبو صبحة,",
  ];
  return [header, ...rows].join("\n");
}

/** JSONP: بناء URL */
export function buildJsonpUrl(base, params) {
  const q = new URLSearchParams(params);
  return `${base}?${q.toString()}`;
}

/** تقسيم نص كبير لدفعات للـ JSONP (تقليل خطر طول URL) */
export function chunkString(str, size = 1500) {
  const chunks = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.slice(i, i + size));
  }
  return chunks;
}
