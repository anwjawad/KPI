/* =========================================================
   js/app-core.js (EN updated)
   Core app logic: global state, new-day notice, preferences,
   counters, and GAS integration.
   - Keeps compatibility with ui-view.js
   - Aware of new fields: response_time, delay_reason
   ========================================================= */

(function (global) {
  "use strict";

  // ------------------------------------------------------
  // Global State (Singleton)
  // ------------------------------------------------------
  const state = {
    todayKey: "",                 // YYYY-MM-DD
    data: [],                     // all records pulled from GAS
    filtered: [],                 // current filtered view
    filters: {
      department: "",
      intervention: "",
      member: "",
      date: "",                   // YYYY-MM-DD
    },
    teamMembers: ["جواد أبو صبحة", "أصالة نوباني", "أمين دحدولان"],
    interventions: [
      "refill medication",
      "reassessment/dose modification",
      "new assessment/new patient",
    ],
    departments: new Set(),       // collected dynamically from data
    preferences: {
      theme: "ocean",
      transitionSpeed: 300,       // ms
      transitionStyle: "fade",    // fade | slide | glow
      gasUrl: "",                 // can be changed from preferences
    },
  };

  // ------------------------------------------------------
  // Date helpers
  // ------------------------------------------------------
  function toYMD(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function fromDdMmYyyyToYmd(ddmmyyyy) {
    // e.g. "31/10/2025" -> "2025-10-31"
    if (!ddmmyyyy || !ddmmyyyy.includes("/")) return "";
    const [dd, mm, yyyy] = ddmmyyyy.split("/");
    if (!yyyy) return "";
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  // ------------------------------------------------------
  // Local Storage
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
      // New day
      try { localStorage.setItem(LS_KEYS.LAST_DAY, today); } catch {}
      UI.notify("A new day has started. Previous data preserved ✅");
    }
  }

  // ------------------------------------------------------
  // GAS URL from preferences (if provided)
  // ------------------------------------------------------
  function initGasUrl() {
    if (state.preferences.gasUrl && window.GAS && typeof GAS.setGasUrl === "function") {
      GAS.setGasUrl(state.preferences.gasUrl);
    }
  }

  // ------------------------------------------------------
  // Fetch data & update state
  // ------------------------------------------------------
  async function refreshData({ force = false } = {}) {
    // Expecting GAS.getAllRecords to return array of row-objects with headers:
    // id, date, name, code, inout, outtype, dept, intervention, member, response_time, delay_reason, notes
    const list = await GAS.getAllRecords({ force });

    // Prepare departments from data
    state.departments = new Set();
    list.forEach((r) => {
      const d = (r["Department"] || r["dept"] || "").toString().trim();
      if (d) state.departments.add(d);
    });

    state.data = normalizeRecords(list);
    applyFilters();
  }

  function normalizeRecords(list) {
    // Normalize to unified keys + add __ymd for easy date filtering
    return (list || []).map((r) => {
      const copy = {
        id: r.id,
        date: r.date,
        name: r["Patient Name"] ?? r.name,
        code: r["Patient Code"] ?? r.code,
        inout: r.inout,
        outtype: r.outtype,
        dept: r["Department"] ?? r.dept,
        intervention: r["Intervention"] ?? r.intervention,
        member: r["Palliative Member"] ?? r.member,
        response_time: r["response_time"] ?? r.response_time ?? "",
        delay_reason: r["delay_reason"] ?? r.delay_reason ?? "",
        notes: r.notes,
      };
      // Allow DD/MM/YYYY fallback then normalize
      const rawDate = (copy.date || "").toString().trim();
      copy.__ymd = rawDate.includes("/") ? fromDdMmYyyyToYmd(rawDate) : rawDate;
      return copy;
    });
  }

  // ------------------------------------------------------
  // Filtering
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
      const depOk = f.department ? (String(r.dept || "").trim() === f.department) : true;
      const intOk = f.intervention ? (String(r.intervention || "").trim().toLowerCase() === f.intervention.toLowerCase()) : true;
      const memOk = f.member ? (String(r.member || "").trim() === f.member) : true;
      const dateOk = f.date ? (r.__ymd === f.date) : true;
      return depOk && intOk && memOk && dateOk;
    });
    state.filtered = arr;

    // Render through UI facade
    UI.renderTable(state.filtered);
    UI.renderCounters(counterByMember(state.filtered));
    UI.populateFilters({
      departments: Array.from(state.departments).sort(),
      members: state.teamMembers,
      interventions: state.interventions,
    });
  }

  // ------------------------------------------------------
  // Team counters (by member)
  // ------------------------------------------------------
  function counterByMember(list) {
    const counters = {};
    state.teamMembers.forEach((m) => (counters[m] = 0));
    (list || []).forEach((r) => {
      const m = (r.member || "").trim();
      if (!(m in counters)) counters[m] = 0;
      counters[m] += 1;
    });
    return counters;
  }

  // ------------------------------------------------------
  // Add a single record via GAS (optional API for UI)
  // ------------------------------------------------------
  async function addRecord(record) {
    await GAS.addRecord(record);
    await refreshData({ force: true });
  }

  // ------------------------------------------------------
  // Import CSV via GAS endpoint
  // ------------------------------------------------------
  async function importCsvFile(file, { defaultDepartment = "", defaultMember = "" } = {}) {
    const { count, templateType } = await GAS.importCsvFile(file, { defaultDepartment, defaultMember });
    UI.notify(`Imported ${count} record(s) (${templateType}).`);
    await refreshData({ force: true });
  }

  // ------------------------------------------------------
  // Preferences facade
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
  // Public API for UI
  // ------------------------------------------------------
  const API = {
    // state
    getState: () => state,
    getFilters: () => ({ ...state.filters }),
    setFilter,
    applyFilters,

    // data
    refreshData,

    // records
    addRecord,

    // import
    importCsvFile,

    // preferences
    setPreference,

    // day
    checkNewDayAndNotify,
  };

  // expose
  global.App = API;

  // ------------------------------------------------------
  // Initial boot
  // ------------------------------------------------------
  document.addEventListener("DOMContentLoaded", async () => {
    loadPrefs();
    initGasUrl();
    checkNewDayAndNotify();

    // apply theme & transitions
    document.documentElement.setAttribute("data-theme", state.preferences.theme);
    UI.applyTransitionPrefs(state.preferences.transitionStyle, state.preferences.transitionSpeed);

    // fetch and render
    try {
      await refreshData({ force: true });
    } catch (e) {
      UI.notify("Failed to fetch data from server. Check GAS URL.", "error");
      console.error(e);
    }
  });

})(window);
