// Entry point for reference.html

import { loadData, setActiveFaction } from "./data-loader.js";
import { factionId } from "./state.js";
import { initReferenceTab, renderReferenceTab, selectItem, onItemSelect } from "./ui/reference-tab.js";

const validFactions = ["Folktails", "IronTeeth"];

function parseHash() {
  const hash = location.hash.slice(1); // remove '#'
  if (!hash) return {};
  const parts = hash.split("/").map(decodeURIComponent);
  const result = {};
  if (parts[0]) result.faction = parts[0];
  if (parts[1] && parts[2]) {
    result.type = parts[1];
    result.id = parts[2];
  }
  return result;
}

function setHash(faction, item) {
  let hash = encodeURIComponent(faction);
  if (item) {
    hash += "/" + encodeURIComponent(item.type) + "/" + encodeURIComponent(item.id);
  }
  history.pushState(null, "", "#" + hash);
}

function applyHashState() {
  const state = parseHash();

  if (state.faction && validFactions.includes(state.faction) && state.faction !== factionId.get()) {
    factionId.set(state.faction);
    setActiveFaction(state.faction);
    document.getElementById("faction-select").value = state.faction;
    renderReferenceTab();
  }

  if (state.type && state.id) {
    selectItem(state.type, state.id);
  } else {
    selectItem(null, null);
  }
}

async function init() {
  await loadData();

  // Read initial state from URL hash
  const hashState = parseHash();
  if (hashState.faction && validFactions.includes(hashState.faction)) {
    factionId.set(hashState.faction);
    setActiveFaction(hashState.faction);
    document.getElementById("faction-select").value = hashState.faction;
  }

  initReferenceTab();
  renderReferenceTab();

  // Restore selected item from hash
  if (hashState.type && hashState.id) {
    selectItem(hashState.type, hashState.id);
  }

  // Update URL when item is selected
  onItemSelect((item) => {
    setHash(factionId.get(), item);
  });

  // Update URL when faction changes
  const factionSelect = document.getElementById("faction-select");
  factionSelect.addEventListener("change", () => {
    factionId.set(factionSelect.value);
    setActiveFaction(factionSelect.value);
    selectItem(null, null);
    renderReferenceTab();
    setHash(factionSelect.value, null);
  });

  // Set initial hash if none present
  if (!location.hash) {
    history.replaceState(null, "", "#" + encodeURIComponent(factionId.get()));
  }

  // Handle back/forward navigation
  window.addEventListener("popstate", applyHashState);
}

init().catch(err => {
  console.error("Failed to initialize:", err);
  document.querySelector("main").innerHTML = `<div style="padding:40px;color:#e05050">
    <h2>Failed to load</h2>
    <p>${err.message}</p>
  </div>`;
});
