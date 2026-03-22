// Entry point for progression.html

import { loadData, setActiveFaction } from "./data-loader.js";
import { factionId } from "./state.js";
import { initFlowTab, renderFlowTab, initAdvancedGraphControls } from "./ui/flow-tab.js";

async function init() {
  await loadData();

  const factionSelect = document.getElementById("faction-select");
  const initialFaction = factionSelect.value;
  if (initialFaction !== factionId.get()) {
    factionId.set(initialFaction);
    setActiveFaction(initialFaction);
  }

  await initFlowTab();
  await renderFlowTab();

  factionSelect.addEventListener("change", async () => {
    factionId.set(factionSelect.value);
    setActiveFaction(factionSelect.value);
    await renderFlowTab();
  });

  if (new URLSearchParams(location.search).get("advanced-graph-controls") === "1") {
    initAdvancedGraphControls();
  }

  initTour();
}

async function initTour() {
  const { driver } = await import("https://cdn.jsdelivr.net/npm/driver.js@1.3.1/+esm");

  const tourDriver = driver({
    showProgress: true,
    popoverClass: "tour-popover",
    steps: [
      {
        element: "#flow-container",
        popover: {
          title: "Progression Graph",
          description: "This graph shows how raw materials flow through buildings and recipes into finished goods.",
          side: "top",
          align: "center",
        },
      },
      {
        element: "#flow-container",
        popover: {
          title: "Navigation",
          description: "Drag to pan around the graph. Scroll to zoom in and out.",
          side: "top",
          align: "center",
        },
      },
      {
        element: "#flow-container .joint-element",
        popover: {
          title: "Nodes",
          description: "Each node is a good, building, or natural resource. Click any node to highlight its connections — click again or double-click the background to deselect.",
          side: "bottom",
          align: "center",
        },
      },
      {
        element: "#flow-search",
        popover: {
          title: "Search",
          description: "Type to find and highlight specific goods or buildings by name.",
          side: "bottom",
          align: "start",
        },
      },
      {
        element: "#flow-legend",
        popover: {
          title: "Legend",
          description: "Node shapes and colors indicate type: rounded for goods, square for buildings. Edge styles distinguish recipe flows from building costs.",
          side: "bottom",
          align: "center",
        },
      },
      {
        element: "#faction-select",
        popover: {
          title: "Faction",
          description: "Switch between Folktails and Iron Teeth to see each faction's available buildings and recipes.",
          side: "bottom",
          align: "end",
        },
      },
      {
        element: "#flow-reset-view",
        popover: {
          title: "Reset View",
          description: "Click to fit the entire graph back into view after panning or zooming.",
          side: "bottom",
          align: "start",
        },
      },
    ],
  });

  document.getElementById("flow-tour-btn").addEventListener("click", () => {
    tourDriver.drive();
  });
}

init().catch(err => {
  console.error("Failed to initialize:", err);
  document.querySelector("main").innerHTML = `<div style="padding:40px;color:#e05050">
    <h2>Failed to load</h2>
    <p>${err.message}</p>
  </div>`;
});
