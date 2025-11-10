/* =========================================================
   js/ui-view.js (EN updated)
   View layer: DOM, notifications, filters, import, preferences
   - Compatible with App (app-core.js) facade
   - Renders new fields: response_time, delay_reason
   ========================================================= */

(function (global) {
  "use strict";

  // DOM elements
  const els = {
    tableBody: null,
    filterDepartment: null,
    filterIntervention: null,
    filterMember: null,
    filterDate: null,
    teamCounters: null,
    csvInput: null,
    importBtn: null,
    preferencesBtn: null,
    notification: null,
  };

  // ------------------------------------------------------
  // DOM helpers
  // ------------------------------------------------------
  function qs(sel) { return document.querySelector(sel); }
  function ce(tag, cls) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    return el;
  }

  // ------------------------------------------------------
  // Notifications
  // ------------------------------------------------------
  function notify(msg, type = "info") {
    if (!els.notification) return;
    els.notification.textContent = msg;
    els.notification.classList.remove("hidden", "error", "info", "success");
    els.notification.classList.add(type === "error" ? "error" : (type === "success" ? "success" : "info"));

    // Fade-out effect
    els.notification.style.opacity = "1";
    setTimeout(() => {
      els.notification.style.opacity = "0";
      setTimeout(() => els.notification.classList.add("hidden"), 500);
    }, 2800);
  }

  // ------------------------------------------------------
  // Init & bindings
  // ------------------------------------------------------
  function initDom() {
    // Note: these IDs are for the legacy/alt UI. They are optional in the new layout.
    els.tableBody = qs("#patientTable tbody") || qs("#patients-tbody");
    els.filterDepartment = qs("#filterDepartment") || qs("#filter-dept");
    els.filterIntervention = qs("#filterIntervention") || qs("#filter-intervention");
    els.filterMember = qs("#filterMember") || qs("#filter-member");
    els.filterDate = qs("#filterDate") || qs("#filter-date");
    els.teamCounters = qs("#teamCounters");
    els.csvInput = qs("#csvImport") || qs("#fld-file");
    els.importBtn = qs("#importBtn") || qs("#btn-import-submit");
    els.preferencesBtn = qs("#preferencesBtn") || qs("#btn-preferences");
    els.notification = qs("#notification") || qs("#toast"); // fallback to global toast

    // Filters
    if (els.filterDepartment) els.filterDepartment.addEventListener("change", (e) => App.setFilter("department", e.target.value));
    if (els.filterIntervention) els.filterIntervention.addEventListener("change", (e) => App.setFilter("intervention", e.target.value));
    if (els.filterMember) els.filterMember.addEventListener("change", (e) => App.setFilter("member", e.target.value));
    if (els.filterDate) els.filterDate.addEventListener("change", (e) => App.setFilter("date", e.target.value));

    // Import
    if (els.importBtn) els.importBtn.addEventListener("click", onImportClick);

    // Preferences (optional entry point for legacy UI)
    if (els.preferencesBtn) els.preferencesBtn.addEventListener("click", openPreferences);
  }

  // ------------------------------------------------------
  // Populate filter options dynamically
  // ------------------------------------------------------
  function populateFilters({ departments = [], members = [], interventions = [] }) {
    // department
    fillSelect(els.filterDepartment, [""].concat(departments), (v) => v || "All departments");

    // interventions
    if (els.filterIntervention && interventions && interventions.length) {
      fillSelect(els.filterIntervention, [""].concat(interventions), (v) => v || "All interventions");
    }

    // members
    if (els.filterMember && members && members.length) {
      fillSelect(els.filterMember, [""].concat(members), (v) => v || "All members");
    }
  }

  function fillSelect(selectEl, values, labelFn) {
    if (!selectEl) return;
    const current = selectEl.value;
    selectEl.innerHTML = "";
    values.forEach((val) => {
      const opt = ce("option");
      opt.value = val;
      opt.textContent = labelFn ? labelFn(val) : val;
      selectEl.appendChild(opt);
    });
    // keep previous selection if possible
    if ([...selectEl.options].some((o) => o.value === current)) {
      selectEl.value = current;
    } else if (selectEl.options.length) {
      selectEl.selectedIndex = 0;
    }
  }

  // ------------------------------------------------------
  // Render table (supports both legacy table and new one)
  // ------------------------------------------------------
  function renderTable(list) {
    if (!els.tableBody) return;
    els.tableBody.innerHTML = "";

    (list || []).forEach((r) => {
      const tr = ce("tr", "row");
      // Support both schemas (legacy headings vs canonical keys)
      const cells = [
        r["Patient Name"] ?? r.name ?? "",
        r["Patient Code"] ?? r.code ?? "",
        r["Intervention"] ?? r.intervention ?? "",
        r["Department"] ?? r.dept ?? "",
        r["Palliative Member"] ?? r.member ?? "",
        r["Date"] ?? r.date ?? "",
        // New fields (show at the end for legacy table)
        r["response_time"] ?? r.response_time ?? "",
        r["delay_reason"] ?? r.delay_reason ?? "",
        r["notes"] ?? r.notes ?? "",
      ];

      cells.forEach((txt) => {
        const td = ce("td");
        td.textContent = String(txt || "");
        tr.appendChild(td);
      });
      els.tableBody.appendChild(tr);
    });

    // Subtle fade-in
    try {
      const rows = els.tableBody.querySelectorAll("tr");
      rows.forEach((row, i) => {
        row.style.opacity = "0";
        row.style.transform = "translateY(6px)";
        setTimeout(() => {
          row.style.transition = "opacity 220ms ease, transform 220ms ease";
          row.style.opacity = "1";
          row.style.transform = "translateY(0)";
        }, 12 * i);
      });
    } catch {}
  }

  // ------------------------------------------------------
  // Team counters (simple cards container if present)
  // ------------------------------------------------------
  function renderCounters(counterMap) {
    if (!els.teamCounters) return;
    els.teamCounters.innerHTML = "";

    Object.keys(counterMap).forEach((member) => {
      const card = ce("div", "counter-card");
      const name = ce("div", "counter-name");
      const val = ce("div", "counter-val");
      name.textContent = member;
      val.textContent = counterMap[member] || 0;
      card.appendChild(name);
      card.appendChild(val);
      els.teamCounters.appendChild(card);
    });
  }

  // ------------------------------------------------------
  // Import CSV (legacy UI path)
  // ------------------------------------------------------
  async function onImportClick() {
    const file = els.csvInput && els.csvInput.files && els.csvInput.files[0];
    if (!file) {
      notify("Choose a CSV file first.", "error");
      return;
    }

    // Quick defaults modal (optional)
    const defaults = await quickDefaultsPrompt();
    try {
      await App.importCsvFile(file, defaults);
      notify("Imported successfully.", "success");
    } catch (e) {
      console.error(e);
      notify("Import failed. Check the template and file.", "error");
    } finally {
      if (els.csvInput) els.csvInput.value = "";
    }
  }

  function quickDefaultsPrompt() {
    return new Promise((resolve) => {
      // Minimal modal (no extra CSS needed)
      const modal = ce("div", "modal");
      modal.innerHTML = `
        <div class="modal-inner">
          <h3>Import defaults (optional)</h3>
          <label>Default Department</label>
          <input type="text" id="impDefaultDept" placeholder="e.g., Internal Medicine" />
          <label>Default Team Member</label>
          <input type="text" id="impDefaultMem" placeholder="e.g., جواد أبو صبحة" />
          <div class="modal-actions">
            <button id="impConfirm">Continue</button>
            <button id="impCancel" class="ghost">Cancel</button>
          </div>
        </div>
      `;
      Object.assign(modal.style, {
        position: "fixed",
        inset: "0",
        background: "rgba(0,0,0,.45)",
        display: "grid",
        placeItems: "center",
        zIndex: 80,
      });
      const inner = modal.querySelector(".modal-inner");
      Object.assign(inner.style, {
        width: "min(520px, 92dvw)",
        background: "var(--card)",
        border: "1px solid rgba(255,255,255,.1)",
        borderRadius: "16px",
        padding: "12px",
        color: "var(--text)",
        boxShadow: "var(--shadow)",
      });
      const actions = modal.querySelector(".modal-actions");
      Object.assign(actions.style, { display: "flex", gap: "8px", marginTop: "10px" });

      document.body.appendChild(modal);

      const close = () => {
        try { document.body.removeChild(modal); } catch {}
      };

      modal.querySelector("#impCancel").addEventListener("click", () => {
        close();
        resolve({});
      });
      modal.querySelector("#impConfirm").addEventListener("click", () => {
        const defaultDepartment = modal.querySelector("#impDefaultDept").value.trim();
        const defaultMember = modal.querySelector("#impDefaultMem").value.trim();
        close();
        resolve({
          defaultDepartment: defaultDepartment || "",
          defaultMember: defaultMember || "",
        });
      });
    });
  }

  // ------------------------------------------------------
  // Preferences (very small dialog – optional path)
  // ------------------------------------------------------
  function openPreferences() {
    const prefs = App.getState().preferences;
    const modal = ce("div", "modal");
    modal.innerHTML = `
      <div class="modal-inner">
        <h3>Preferences</h3>

        <label>Theme</label>
        <select id="prefTheme">
          <option value="ocean">ocean</option>
          <option value="glow">glow</option>
          <option value="mint">mint</option>
          <option value="rose">rose</option>
          <option value="down">down</option>
          <option value="upper">upper</option>
          <option value="dark">dark</option>
          <option value="light-blue">light blue</option>
          <option value="dark-blue">dark blue</option>
          <option value="tirkwaz">tirkwaz</option>
          <option value="gradient">gradient</option>
        </select>

        <label>Transition style</label>
        <select id="prefTransStyle">
          <option value="fade">Fade</option>
          <option value="Slide">Slide</option>
          <option value="glow">Glow</option>
        </select>

        <label>Transition speed (ms)</label>
        <input type="number" id="prefTransSpeed" min="80" max="2000" step="20" />

        <label>GAS URL</label>
        <input type="text" id="prefGasUrl" placeholder="https://script.google.com/macros/s/....../exec" />

        <div class="modal-actions">
          <button id="prefSave">Save</button>
          <button id="prefCancel" class="ghost">Close</button>
        </div>
      </div>
    `;
    Object.assign(modal.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,.45)",
      display: "grid",
      placeItems: "center",
      zIndex: 80,
    });
    const inner = modal.querySelector(".modal-inner");
    Object.assign(inner.style, {
      width: "min(520px, 92dvw)",
      background: "var(--card)",
      border: "1px solid rgba(255,255,255,.1)",
      borderRadius: "16px",
      padding: "12px",
      color: "var(--text)",
      boxShadow: "var(--shadow)",
    });
    const actions = modal.querySelector(".modal-actions");
    Object.assign(actions.style, { display: "flex", gap: "8px", marginTop: "10px" });

    document.body.appendChild(modal);

    // initial values
    modal.querySelector("#prefTheme").value = prefs.theme || "ocean";
    modal.querySelector("#prefTransStyle").value = prefs.transitionStyle || "fade";
    modal.querySelector("#prefTransSpeed").value = prefs.transitionSpeed || 300;
    modal.querySelector("#prefGasUrl").value = prefs.gasUrl || "";

    const close = () => document.body.removeChild(modal);

    modal.querySelector("#prefCancel").addEventListener("click", close);
    modal.querySelector("#prefSave").addEventListener("click", () => {
      const theme = modal.querySelector("#prefTheme").value;
      const style = modal.querySelector("#prefTransStyle").value;
      const speed = parseInt(modal.querySelector("#prefTransSpeed").value, 10) || 300;
      const gasUrl = modal.querySelector("#prefGasUrl").value.trim();

      App.setPreference("theme", theme);
      App.setPreference("transitionStyle", style);
      App.setPreference("transitionSpeed", speed);
      if (gasUrl) App.setPreference("gasUrl", gasUrl);

      notify("Preferences saved.", "success");
      close();
    });
  }

  // ------------------------------------------------------
  // Transition prefs (exposed to app-core.js)
  // ------------------------------------------------------
  function applyTransitionPrefs(style, speed) {
    document.documentElement.style.setProperty("--transition-speed", `${speed}ms`);
    document.documentElement.setAttribute("data-transition", (style || "fade").toLowerCase());
  }

  // ------------------------------------------------------
  // Export UI API
  // ------------------------------------------------------
  const UI = {
    initDom,
    renderTable,
    renderCounters,
    notify,
    populateFilters,
    applyTransitionPrefs,
  };

  global.UI = UI;

  // DOM ready
  document.addEventListener("DOMContentLoaded", () => {
    initDom();
  });

})(window);
