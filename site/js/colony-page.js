// Entry point for colony.html

import { loadData, setActiveFaction } from "./data-loader.js";
import * as state from "./state.js";
import { initColonyTab, renderColonyTab } from "./ui/colony-tab.js";
import { wrapNumberInputs } from "./ui/components.js";

const STORAGE_KEY = "timbermath-colony";

function saveState() {
  const data = {
    factionId: state.factionId.get(),
    beaverCount: state.beaverCount.get(),
    botCount: state.botCount.get(),
    droughtDays: state.droughtDays.get(),
    temperateDays: state.temperateDays.get(),
    productivity: state.productivity.get(),
    roster: state.roster.get(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function restoreState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);

    if (data.factionId) {
      state.factionId.set(data.factionId);
      setActiveFaction(data.factionId);
      document.getElementById("faction-select").value = data.factionId;
    }
    if (data.beaverCount != null) {
      state.beaverCount.set(data.beaverCount);
      document.getElementById("beaver-count").value = data.beaverCount;
    }
    if (data.botCount != null) {
      state.botCount.set(data.botCount);
      document.getElementById("bot-count").value = data.botCount;
    }
    if (data.droughtDays != null) {
      state.droughtDays.set(data.droughtDays);
      document.getElementById("drought-days").value = data.droughtDays;
    }
    if (data.temperateDays != null) {
      state.temperateDays.set(data.temperateDays);
      document.getElementById("temperate-days").value = data.temperateDays;
    }
    if (data.productivity != null) {
      state.productivity.set(data.productivity);
      document.getElementById("productivity").value = Math.round(data.productivity * 100);
    }
    if (Array.isArray(data.roster)) {
      state.roster.set(data.roster);
    }
  } catch (e) {
    // Ignore — start fresh if saved state is invalid
  }
}

async function init() {
  await loadData();

  restoreState();
  initColonyTab();
  renderColonyTab();
  wrapNumberInputs(document.querySelector(".colony-params"), { vertical: true });

  // Persist on every state change
  state.factionId.subscribe(saveState);
  state.beaverCount.subscribe(saveState);
  state.botCount.subscribe(saveState);
  state.droughtDays.subscribe(saveState);
  state.temperateDays.subscribe(saveState);
  state.productivity.subscribe(saveState);
  state.roster.subscribe(saveState);

  const factionSelect = document.getElementById("faction-select");
  factionSelect.addEventListener("change", () => {
    const roster = state.roster.get();
    if (roster.length > 0 && !confirm("Switching factions will clear your building roster. Continue?")) {
      factionSelect.value = state.factionId.get();
      return;
    }
    state.factionId.set(factionSelect.value);
    setActiveFaction(factionSelect.value);
    state.roster.set([]);
    renderColonyTab();
  });
}

init().catch(err => {
  console.error("Failed to initialize:", err);
  document.querySelector("main").innerHTML = `<div style="padding:40px;color:#e05050">
    <h2>Failed to load</h2>
    <p>${err.message}</p>
  </div>`;
});
