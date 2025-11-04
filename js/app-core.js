/* =========================================================
   js/app-core.js
   منطق التطبيق الأساسي: الحالة العامة، اليوم الجديد، التفضيلات،
   العدّادات، والتكامل مع طبقة GAS
   ========================================================= */

(function (global) {
  "use strict";

  // ------------------------------------------------------
  // الحالة العامة (Singleton)
  // ------------------------------------------------------
  const state = {
    todayKey: "",                 // مفتاح اليوم الحالي بصيغة YYYY-MM-DD
    data: [],                     // كل السجلات القادمة من GAS
    filtered: [],                 // نتائج الفلترة الحالية
    filters: {
      department: "",
      intervention: "",
      member: "",
      date: "",                   // بصيغة YYYY-MM-DD
    },
    teamMembers: ["جواد ابو صبحة", "اصالة نوباني", "امين دحدولان"],
    interventions: [
      "refill medication",
      "reassessment/dose modification",
      "new assessment/new patient",
    ],
    departments: new Set(),       // يُملأ ديناميكيًا من البيانات
    preferences: {
      theme: "ocean",             // افتراضي
      transitionSpeed: 300,       // ms
      transitionStyle: "fade",    // fade | slide | glow
      gasUrl: "",                 // ممكن تغييره من preferences
    },
  };

  // ------------------------------------------------------
  // أدوات وقت/تواريخ
  // ------------------------------------------------------
  function toYMD(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function fromDdMmYyyyToYmd(ddmmyyyy) {
    // مدخل مثل 31/10/2025 -> 2025-10-31
    if (!ddmmyyyy || !ddmmyyyy.includes("/")) return "";
    const [dd, mm, yyyy] = ddmmyyyy.split("/");
    if (!yyyy) return "";
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  // ------------------------------------------------------
  // تخزين محلي (localStorage)
  // ------------------------------------------------------
  const LS_KEYS = {
    LAST_DAY: "palMon.lastDay",
    PREFS: "palMon.prefs",
  };

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(LS_KEYS.PREFS);
      if (raw) {
        const saved = JSON.parse(raw);
        Object.assign(state.preferences, saved || {});
      }
    } catch {}
  }

  function savePrefs() {
    try {
      localStorage.setItem(LS_KEYS.PREFS, JSON.stringify(state.preferences));
    } catch {}
  }

  function checkNewDayAndNotify() {
    const today = toYMD();
    state.todayKey = today;
    let last = "";
    try { last = localStorage.getItem(LS_KEYS.LAST_DAY) || ""; } catch {}
    if (last !== today) {
      // يوم جديد
      try { localStorage.setItem(LS_KEYS.LAST_DAY, today); } catch {}
      UI.notify("تم بدء يوم جديد وحفظ كل السابق ✅");
    }
  }

  // ------------------------------------------------------
  // تهيئة GAS URL من التفضيلات (إن وُجد)
  // ------------------------------------------------------
  function initGasUrl() {
    if (state.preferences.gasUrl && window.GAS && typeof GAS.setGasUrl === "function") {
      GAS.setGasUrl(state.preferences.gasUrl);
    }
  }

  // ------------------------------------------------------
  // جلب البيانات وتحديث الحالة
  // ------------------------------------------------------
  async function refreshData({ force = false } = {}) {
    const list = await GAS.getAllRecords({ force });
    // تحديث الأقسام من البيانات
    state.departments = new Set();
    list.forEach((r) => {
      const d = (r["Department"] || "").trim();
      if (d) state.departments.add(d);
    });
    state.data = normalizeDates(list);
    applyFilters();
  }

  function normalizeDates(list) {
    // تحويل Date "31/10/2025" إلى YMD لمقارنة الفلاتر بسهولة
    return (list || []).map((r) => {
      const copy = { ...r };
      copy.__ymd = fromDdMmYyyyToYmd(String(r.Date || "").trim()) || "";
      return copy;
    });
  }

  // ------------------------------------------------------
  // فلترة
  // ------------------------------------------------------
  function setFilter(key, value) {
    if (key in state.filters) {
      state.filters[key] = value || "";
      applyFilters();
    }
  }

  function applyFilters() {
    const f = state.filters;
    const arr = (state.data || []).filter((r) => {
      const depOk = f.department ? (String(r["Department"] || "").trim() === f.department) : true;
      const intOk = f.intervention ? (String(r["Intervention"] || "").trim().toLowerCase() === f.intervention.toLowerCase()) : true;
      const memOk = f.member ? (String(r["Palliative Member"] || "").trim() === f.member) : true;
      const dateOk = f.date ? (r.__ymd === f.date) : true;
      return depOk && intOk && memOk && dateOk;
    });
    state.filtered = arr;
    UI.renderTable(arr);
    UI.renderCounters(counterByMember(state.filtered));
    UI.populateFilters({
      departments: Array.from(state.departments).sort(),
      members: state.teamMembers,
      interventions: state.interventions,
    });
  }

  // ------------------------------------------------------
  // عدادات الفريق
  // ------------------------------------------------------
  function counterByMember(list) {
    const counters = {};
    state.teamMembers.forEach((m) => (counters[m] = 0));
    (list || []).forEach((r) => {
      const m = (r["Palliative Member"] || "").trim();
      if (!(m in counters)) counters[m] = 0;
      counters[m] += 1;
    });
    return counters;
  }

  // ------------------------------------------------------
  // إضافة سجل يدويًا (يمكن استخدامه من الواجهة لاحقًا)
  // ------------------------------------------------------
  async function addRecord(record) {
    await GAS.addRecord(record);
    await refreshData({ force: true });
  }

  // ------------------------------------------------------
  // استيراد CSV
  // ------------------------------------------------------
  async function importCsvFile(file, { defaultDepartment = "", defaultMember = "" } = {}) {
    const { count, templateType } = await GAS.importCsvFile(file, { defaultDepartment, defaultMember });
    UI.notify(`تم استيراد ${count} سجل (${templateType}).`);
    await refreshData({ force: true });
  }

  // ------------------------------------------------------
  // تفضيلات (واجهة مبسطة)
  // ------------------------------------------------------
  function setPreference(key, value) {
    state.preferences[key] = value;
    savePrefs();
    if (key === "theme") {
      document.documentElement.setAttribute("data-theme", value);
    } else if (key === "gasUrl") {
      initGasUrl();
    }
    UI.applyTransitionPrefs(state.preferences.transitionStyle, state.preferences.transitionSpeed);
  }

  // ------------------------------------------------------
  // API عام لـ UI
  // ------------------------------------------------------
  const API = {
    // حالة
    getState: () => state,
    getFilters: () => ({ ...state.filters }),
    setFilter,
    applyFilters,

    // بيانات
    refreshData,

    // سجلات
    addRecord,

    // استيراد
    importCsvFile,

    // تفضيلات
    setPreference,

    // وقت/يوم
    checkNewDayAndNotify,
  };

  // إتاحة في window.App
  global.App = API;

  // ------------------------------------------------------
  // تهيئة أولية
  // ------------------------------------------------------
  document.addEventListener("DOMContentLoaded", async () => {
    loadPrefs();
    initGasUrl();
    checkNewDayAndNotify();

    // ضبط الثيم والترانزشن من التفضيلات
    document.documentElement.setAttribute("data-theme", state.preferences.theme);
    UI.applyTransitionPrefs(state.preferences.transitionStyle, state.preferences.transitionSpeed);

    // جلب البيانات وعرضها
    try {
      await refreshData({ force: true });
    } catch (e) {
      UI.notify("تعذر جلب البيانات من الخادم. تأكد من رابط GAS.", "error");
      console.error(e);
    }
  });

})(window);
