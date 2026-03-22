// Colony Planner tab: building roster + computed flows + drought planning

import * as data from "../data-loader.js";
import * as state from "../state.js";
import {
  computeBuildingRates, computeColonyFlows, computePowerBalance, computeWorkerBalance,
  computePopulationNeeds, computeBotNeeds, computeCoveredNeeds, computeStorageCapacity,
  computeProductionBuildingStorage, computeStorageSlots, computeBufferNeeds, allocateStorageToBuffers,
  computeHarvesterEfficiency, getResourceKind,
  findResource, computeResourceYield,
} from "../compute.js";
import { escapeHtml, goodName, buildingName, recipeName, naturalResourceName, formatRate, wrapNumberInputs } from "./components.js";

export function initColonyTab() {
  document.getElementById("beaver-count").addEventListener("input", (e) => {
    state.beaverCount.set(parseInt(e.target.value) || 0);
  });
  document.getElementById("bot-count").addEventListener("input", (e) => {
    state.botCount.set(parseInt(e.target.value) || 0);
  });
  document.getElementById("drought-days").addEventListener("input", (e) => {
    state.droughtDays.set(parseFloat(e.target.value) || 0);
  });
  document.getElementById("temperate-days").addEventListener("input", (e) => {
    state.temperateDays.set(parseFloat(e.target.value) || 0);
  });
  document.getElementById("productivity").addEventListener("input", (e) => {
    state.productivity.set((parseFloat(e.target.value) || 0) / 100);
  });

  state.roster.subscribe((_, { countOnly } = {}) => {
    if (!countOnly) renderRoster();
    renderColonyOutput();
  });
  state.beaverCount.subscribe(() => renderColonyOutput());
  state.botCount.subscribe(() => renderColonyOutput());
  state.droughtDays.subscribe(() => renderColonyOutput());
  state.temperateDays.subscribe(() => renderColonyOutput());
  state.productivity.subscribe(() => renderColonyOutput());

  initRosterSearch();
  initDroughtHint();
}

export function renderColonyTab() {
  renderRoster();
  renderColonyOutput();
  initDroughtHint();
}

function initDroughtHint() {
  const common = data.getCommon();
  if (!common?.gameModes) return;

  const droughtTooltip = document.getElementById("drought-hint-tooltip");
  let droughtHtml = "Drought duration by difficulty:";
  for (const mode of common.gameModes) {
    const d = mode.droughtDuration;
    droughtHtml += `<br><b>${escapeHtml(mode.displayName)}:</b> ${d.Min}\u2013${d.Max} days`;
  }
  droughtTooltip.innerHTML = droughtHtml;

  const tempTooltip = document.getElementById("temperate-hint-tooltip");
  let tempHtml = "Temperate season by difficulty:";
  for (const mode of common.gameModes) {
    const t = mode.temperateWeatherDuration;
    tempHtml += `<br><b>${escapeHtml(mode.displayName)}:</b> ${t.Min}\u2013${t.Max} days`;
  }
  tempTooltip.innerHTML = tempHtml;
}

// --- Roster Search: buildings, recipes, and natural resource tiles ---

function initRosterSearch() {
  const input = document.getElementById("roster-search");
  const dropdown = document.getElementById("roster-dropdown");

  input.addEventListener("input", () => {
    const query = input.value.toLowerCase();
    if (query.length === 0) {
      dropdown.classList.add("hidden");
      return;
    }
    renderSearchDropdown(query);
    dropdown.classList.remove("hidden");
  });

  input.addEventListener("focus", () => {
    if (input.value.length > 0) {
      renderSearchDropdown(input.value.toLowerCase());
      dropdown.classList.remove("hidden");
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".roster-add")) {
      dropdown.classList.add("hidden");
    }
  });
}

function renderSearchDropdown(query) {
  const dropdown = document.getElementById("roster-dropdown");
  const common = data.getCommon();
  const faction = data.getFaction();
  if (!faction || !common) return;

  const results = []; // { kind, id, recipeId?, label, sublabel, onAdd }

  // --- Natural resource tiles ---
  const nr = common.naturalResources;
  for (const category of [nr.crops, nr.trees, nr.bushes]) {
    for (const [rid, resource] of Object.entries(category)) {
      const rname = naturalResourceName(resource).toLowerCase();
      const yieldGoodName = goodName(common.goods[resource.yield.id]).toLowerCase();
      // Also check gatherable yield for trees
      let gatherGoodName = "";
      if (resource.gatherableYield) {
        gatherGoodName = goodName(common.goods[resource.gatherableYield.id]).toLowerCase();
      }
      const kind = nr.crops[rid] ? "Crop" : nr.trees[rid] ? "Tree" : "Bush";
      if (rname.includes(query) || rid.toLowerCase().includes(query) ||
          yieldGoodName.includes(query) || gatherGoodName.includes(query) ||
          kind.toLowerCase().includes(query)) {
        const yields = computeResourceYield(rid, 1, common);
        const yieldStr = yields.map(y =>
          `${formatRate(y.perDay)} ${goodName(common.goods[y.goodId])}/day`
        ).join(", ");
        results.push({
          kind: "resource",
          id: rid,
          label: `${naturalResourceName(resource)} tiles`,
          sublabel: `${kind} — ${yieldStr}/tile`,
        });
      }
    }
  }

  // --- Buildings (with and without recipes) ---
  for (const b of Object.values(faction.buildings)) {
    const bname = buildingName(b).toLowerCase();
    const categoryMatch = b.category.toLowerCase().includes(query);
    const nameMatch = bname.includes(query) || b.id.toLowerCase().includes(query) || categoryMatch;

    if (b.recipeIds.length === 0) {
      if (nameMatch) {
        results.push({
          kind: "building",
          id: b.id,
          recipeId: null,
          label: buildingName(b),
          sublabel: b.category,
        });
      }
    } else {
      for (const rid of b.recipeIds) {
        const recipe = common.recipes[rid];
        if (!recipe) continue;
        const rname = recipeName(recipe).toLowerCase();
        const goodsMatch = recipe.products.some(p =>
          goodName(common.goods[p.id]).toLowerCase().includes(query) ||
          p.id.toLowerCase().includes(query)
        ) || recipe.ingredients.some(i =>
          goodName(common.goods[i.id]).toLowerCase().includes(query) ||
          i.id.toLowerCase().includes(query)
        );
        if (nameMatch || rname.includes(query) || rid.toLowerCase().includes(query) || goodsMatch) {
          results.push({
            kind: "building",
            id: b.id,
            recipeId: rid,
            label: buildingName(b),
            sublabel: recipeName(recipe),
          });
        }
      }
    }
  }

  results.sort((a, b) => (a.label + (a.sublabel || "")).localeCompare(b.label + (b.sublabel || "")));
  const limited = results.slice(0, 25);

  dropdown.innerHTML = limited.map((r, i) => `
    <div class="roster-dropdown-item" data-idx="${i}">
      <span>${escapeHtml(r.label)}</span>
      <span class="dd-category">${escapeHtml(r.sublabel)}</span>
    </div>
  `).join("");

  for (const item of dropdown.querySelectorAll(".roster-dropdown-item")) {
    item.addEventListener("click", () => {
      const r = limited[parseInt(item.dataset.idx)];
      if (r.kind === "resource") {
        addResourceWithHarvester(r.id, common, faction);
      } else {
        state.addBuilding(r.id, r.recipeId);
      }
      document.getElementById("roster-search").value = "";
      dropdown.classList.add("hidden");
    });
  }
}

// --- Roster Rendering ---

let prevRosterSize = -1;

function sweepChangedRows(container, prevSnapshot) {
  const rows = container.querySelectorAll(".balance-row");
  rows.forEach((row, i) => {
    const text = row.textContent;
    if (prevSnapshot && i < prevSnapshot.length && prevSnapshot[i] !== text) {
      // Sweep only the value (last child span)
      const valueSpan = row.lastElementChild;
      if (valueSpan) {
        valueSpan.classList.remove("value-flash");
        void valueSpan.offsetWidth; // force reflow to restart animation
        valueSpan.classList.add("value-flash");
        valueSpan.addEventListener("animationend", () => valueSpan.classList.remove("value-flash"), { once: true });
      }
    }
  });
}

function snapshotRows(container) {
  return Array.from(container.querySelectorAll(".balance-row")).map(r => r.textContent);
}

function renderRoster() {
  const container = document.getElementById("roster-list");
  const entries = state.roster.get();
  const common = data.getCommon();
  const faction = data.getFaction();
  if (!common || !faction) return;

  if (entries.length === 0) {
    container.innerHTML = '<p style="color:var(--text-dim);font-size:0.85rem;padding:8px">No items added. Search by building, recipe, or resource name above.</p>';
    renderBuildingCosts([], null, null);
    return;
  }

  const harvEff = computeHarvesterEfficiency(entries, common, faction, state.productivity.get());

  // Sort display order by category (resources first, then buildings by category)
  const sortedIndices = entries.map((_, i) => i).sort((a, b) => {
    const ea = entries[a], eb = entries[b];
    // Resources before buildings
    if (ea.type !== eb.type) return ea.type === "resource" ? -1 : 1;
    if (ea.type === "resource") {
      const ka = getResourceKind(ea.resourceId, common) || "";
      const kb = getResourceKind(eb.resourceId, common) || "";
      return ka.localeCompare(kb) || ea.resourceId.localeCompare(eb.resourceId);
    }
    const ba = faction.buildings[ea.buildingId];
    const bb = faction.buildings[eb.buildingId];
    if (!ba || !bb) return (ba ? -1 : 1);
    const catOrderFn = (cat) => common.buildingCategories[cat]?.order ?? 999;
    const catCmp = catOrderFn(ba.category) - catOrderFn(bb.category);
    if (catCmp !== 0) return catCmp;
    return (ba.toolOrder ?? 0) - (bb.toolOrder ?? 0);
  });

  container.innerHTML = sortedIndices.map(index => {
    const entry = entries[index];
    if (entry.type === "resource") {
      return renderResourceEntry(entry, index, common, harvEff);
    }
    return renderBuildingEntry(entry, index, common, faction, harvEff);
  }).join("");

  bindRosterEvents(container);
  wrapNumberInputs(container);

  // Flash new entries (skip first render)
  if (prevRosterSize >= 0 && entries.length > prevRosterSize) {
    const allEntries = container.querySelectorAll(".roster-entry");
    // Flash entries whose original index >= prevRosterSize (newly added)
    for (const el of allEntries) {
      const idx = parseInt(el.querySelector(".roster-count")?.dataset.index);
      if (idx >= prevRosterSize) {
        el.classList.add("flash");
        el.addEventListener("animationend", () => el.classList.remove("flash"), { once: true });
      }
    }
  }
  prevRosterSize = entries.length;
  renderBuildingCosts(entries, common, faction);
}

function renderBuildingCosts(entries, common, faction) {
  const container = document.getElementById("colony-costs");
  if (!entries.length || !common || !faction) {
    container.innerHTML = "";
    return;
  }

  // Aggregate material costs (per instance × count)
  const materialTotals = new Map(); // goodId -> total amount
  // Track unique building types for one-time science costs
  const seenTypes = new Set();
  let scienceTotal = 0;
  let botUnlockTotal = 0;

  for (const entry of entries) {
    if (entry.type !== "building" || entry.count <= 0) continue;
    const building = faction.buildings[entry.buildingId];
    if (!building) continue;

    for (const cost of building.buildingCost) {
      materialTotals.set(cost.id, (materialTotals.get(cost.id) || 0) + cost.amount * entry.count);
    }

    if (!seenTypes.has(entry.buildingId)) {
      seenTypes.add(entry.buildingId);
      scienceTotal += building.scienceCost;
      if (building.botUnlockScienceCost) {
        botUnlockTotal += building.botUnlockScienceCost;
      }
    }
  }

  if (materialTotals.size === 0 && scienceTotal === 0) {
    container.innerHTML = "";
    return;
  }

  let html = '<div class="building-costs"><h3 class="neutral-header">Building Cost</h3>';

  // Material costs sorted by good group order
  const sortedMaterials = [...materialTotals.entries()].sort((a, b) => {
    const ga = common.goods[a[0]], gb = common.goods[b[0]];
    const groupA = ga ? common.goodGroups?.[ga.goodGroupId]?.order ?? 999 : 999;
    const groupB = gb ? common.goodGroups?.[gb.goodGroupId]?.order ?? 999 : 999;
    return groupA - groupB || a[0].localeCompare(b[0]);
  });

  for (const [goodId, amount] of sortedMaterials) {
    html += `<div class="balance-row">
      <span class="balance-label">${escapeHtml(goodName(common.goods[goodId]))}</span>
      <span class="balance-value">${amount}</span>
    </div>`;
  }

  // Science costs
  if (scienceTotal > 0 || botUnlockTotal > 0) {
    const parts = [];
    if (scienceTotal > 0) parts.push(`${scienceTotal} unlock`);
    if (botUnlockTotal > 0) parts.push(`${botUnlockTotal} bot unlock`);
    html += `<div class="balance-row">
      <span class="balance-label">Science</span>
      <span class="balance-value" style="color:var(--accent)">${parts.join(" + ")}</span>
    </div>`;
  }

  html += '</div>';
  container.innerHTML = html;
}

function renderResourceEntry(entry, index, common, harvEff) {
  const resource = findResource(entry.resourceId, common);
  if (!resource) return "";

  const kind = getResourceKind(entry.resourceId, common);
  const eff = kind ? harvEff[kind].efficiency : 1;
  const yields = computeResourceYield(entry.resourceId, 1, common);
  const yieldStr = yields.map(y =>
    `${formatRate(y.perDay * eff)} ${goodName(common.goods[y.goodId])}/day/tile`
  ).join(", ");

  return `
    <div class="roster-entry">
      <span class="roster-name">${escapeHtml(naturalResourceName(resource))} tiles</span>
      <span class="roster-rate">${yieldStr}</span>
      <input type="number" class="roster-count" data-index="${index}" value="${entry.count}" min="0" max="999">
      <button class="roster-remove" data-index="${index}">&times;</button>
    </div>`;
}

function renderBuildingEntry(entry, index, common, faction, harvEff) {
  const building = faction.buildings[entry.buildingId];
  if (!building) return "";

  const multiRecipe = building.recipeIds.length > 1;
  const hasRecipes = building.recipeIds.length > 0;

  let recipeSelect = "";
  if (multiRecipe) {
    recipeSelect = `<select class="roster-recipe" data-index="${index}">
      ${building.recipeIds.map(rid => {
        const recipe = common.recipes[rid];
        return `<option value="${rid}" ${rid === entry.recipeId ? "selected" : ""}>${escapeHtml(recipeName(recipe))}</option>`;
      }).join("")}
    </select>`;
  }

  // Per-building rate summary for recipes
  let rateStr = "";
  if (hasRecipes && entry.recipeId) {
    const recipe = common.recipes[entry.recipeId];
    if (recipe) {
      const rates = computeBuildingRates(recipe, building, 1, state.productivity.get());
      const parts = [];
      for (const p of rates.production) {
        parts.push(`+${formatRate(p.perDay)} ${goodName(common.goods[p.goodId])}`);
      }
      for (const c of rates.consumption) {
        parts.push(`-${formatRate(c.perDay)} ${goodName(common.goods[c.goodId])}`);
      }
      if (parts.length > 0) rateStr = parts.join(", ") + "/day";
    }
  }

  // Check if this is an unused harvester (no tiles of its kind)
  let unusedLabel = "";
  const factionId = state.factionId.get();
  const harvMap = HARVESTER_BUILDINGS[factionId];
  if (harvMap) {
    for (const [kind, bId] of Object.entries(harvMap)) {
      if (bId === entry.buildingId && harvEff[kind]?.tiles === 0) {
        unusedLabel = `<span style="font-size:0.75rem;color:var(--deficit)">(unused)</span>`;
        break;
      }
    }
  }

  return `
    <div class="roster-entry">
      <span class="roster-name">${escapeHtml(buildingName(building))} ${recipeSelect}</span>
      ${rateStr ? `<span class="roster-rate">${rateStr}</span>` : ""}
      ${unusedLabel}
      <input type="number" class="roster-count" data-index="${index}" value="${entry.count}" min="0" max="999">
      <button class="roster-remove" data-index="${index}">&times;</button>
    </div>`;
}

function bindRosterEvents(container) {
  for (const select of container.querySelectorAll(".roster-recipe")) {
    select.addEventListener("change", (e) => {
      state.updateRosterEntry(parseInt(e.target.dataset.index), { recipeId: e.target.value });
    });
  }
  for (const input of container.querySelectorAll(".roster-count")) {
    input.addEventListener("input", (e) => {
      state.updateRosterEntry(parseInt(e.target.dataset.index), { count: parseInt(e.target.value) || 0 }, { countOnly: true });
    });
  }
  for (const btn of container.querySelectorAll(".roster-remove")) {
    btn.addEventListener("click", (e) => {
      state.removeFromRoster(parseInt(e.target.dataset.index));
    });
  }
}

// --- Colony Output ---

function renderColonyOutput() {
  const common = data.getCommon();
  const faction = data.getFaction();
  if (!common || !faction) return;

  const entries = state.roster.get();
  const beavers = state.beaverCount.get();
  const bots = state.botCount.get();
  const droughtDays = state.droughtDays.get();
  const prod = state.productivity.get();

  // Good flows
  const flows = computeColonyFlows(entries, beavers, bots, common, faction, prod);
  const storage = computeStorageCapacity(entries, common, faction);

  // Food special handling: distribute __food__ consumption across food-producing goods
  const foodFlow = flows.find(f => f.goodId === "__food__");
  const foodConsumption = foodFlow ? foodFlow.consumed : 0;
  const foodProduction = flows
    .filter(f => { const g = common.goods[f.goodId]; return g && g.goodGroupId === "Food"; })
    .reduce((sum, f) => sum + f.produced, 0);
  const foodNet = foodProduction - foodConsumption;

  // Compute adjusted net for food goods (proportional share of food consumption)
  const adjustedNet = new Map();
  const trackedGoods = flows.filter(f => !f.goodId.startsWith("__"));
  const foodProducers = trackedGoods.filter(f => {
    const good = common.goods[f.goodId];
    return good && good.goodGroupId === "Food" && f.produced > 0;
  });
  const totalFoodProd = foodProducers.reduce((sum, f) => sum + f.produced, 0);
  for (const f of trackedGoods) {
    const good = common.goods[f.goodId];
    if (good && good.goodGroupId === "Food" && f.produced > 0 && totalFoodProd > 0) {
      const share = f.produced / totalFoodProd;
      adjustedNet.set(f.goodId, f.net - share * foodConsumption);
    } else {
      adjustedNet.set(f.goodId, f.net);
    }
  }

  // Science
  const scienceFlow = flows.find(f => f.goodId === "__science__");

  // --- Population ---
  const needsEl = document.getElementById("colony-needs");
  let needsHtml = '<h3 class="neutral-header">Population</h3>';

  // Good IDs being produced (for need coverage from goods)
  const producedGoodIds = flows.filter(f => f.produced > 0).map(f => f.goodId);

  if (beavers > 0) {
    const popNeeds = computePopulationNeeds(beavers, common);
    needsHtml += `<div class="subsection-label">Beavers</div>`;
    for (const need of popNeeds) {
      needsHtml += `<div class="needs-row">
        <span>${escapeHtml(need.label)}</span>
        <span>${formatRate(need.perBeaverPerDay)}/beaver \u00d7 ${beavers} beavers = ${formatRate(need.total)}/day</span>
      </div>`;
    }

    // Covered needs (skip Hunger/Thirst — already shown above)
    const beaverNeeds = computeCoveredNeeds(entries, producedGoodIds, beavers, "Beaver", ["Hunger", "Thirst"], common, faction);
    needsHtml += renderCoveredNeeds(beaverNeeds, beavers);
  }
  if (bots > 0) {
    const botNeeds = computeBotNeeds(bots, common, faction);
    if (botNeeds.length > 0) {
      needsHtml += `<div class="subsection-label">Bots</div>`;
      for (const need of botNeeds) {
        const label = need.goodId ? goodDisplayName(need.goodId, common) : need.label;
        needsHtml += `<div class="needs-row">
          <span>${escapeHtml(label)}</span>
          <span>${formatRate(need.perBotPerDay)}/bot \u00d7 ${bots} bots = ${formatRate(need.total)}/day</span>
        </div>`;
      }
    }

    // Bot condition improvements (skip basic bot needs — already shown above)
    const basicBotNeedIds = botNeeds.map(n => n.needId);
    const botCondition = computeCoveredNeeds(entries, producedGoodIds, bots, "Bot", basicBotNeedIds, common, faction);
    if (botCondition.length > 0) {
      needsHtml += renderCoveredNeeds(botCondition, bots);
    }
  }
  const prevNeeds = snapshotRows(needsEl);
  needsEl.innerHTML = needsHtml;
  sweepChangedRows(needsEl, prevNeeds);

  // Adjusted consumption per good (includes distributed food consumption)
  const adjustedConsumption = new Map();
  for (const f of trackedGoods) {
    const good = common.goods[f.goodId];
    if (good && good.goodGroupId === "Food" && f.produced > 0 && totalFoodProd > 0) {
      const share = f.produced / totalFoodProd;
      adjustedConsumption.set(f.goodId, f.consumed + share * foodConsumption);
    } else {
      adjustedConsumption.set(f.goodId, f.consumed);
    }
  }

  // Compute uncapped resource production to detect harvester capping
  const uncappedProd = new Map();
  for (const entry of entries) {
    if (entry.type !== "resource" || entry.count <= 0) continue;
    const yields = computeResourceYield(entry.resourceId, entry.count, common);
    for (const y of yields) {
      uncappedProd.set(y.goodId, (uncappedProd.get(y.goodId) || 0) + y.perDay);
    }
  }

  // --- Production (goods + storage + power + workers) ---
  const prodEl = document.getElementById("colony-production");
  let prodHtml = '<h3 class="neutral-header">Production</h3>';

  // Goods rows: name on left, rate on right
  if (foodFlow) {
    prodHtml += goodFlowRow("Food (total)", foodNet);
  }
  const goodGroupOrder = (goodId) => {
    const g = common.goods[goodId];
    if (!g) return 999;
    const group = common.goodGroups?.[g.goodGroupId];
    return group?.order ?? 999;
  };
  const sortedGoods = [...trackedGoods].sort((a, b) =>
    goodGroupOrder(a.goodId) - goodGroupOrder(b.goodId)
      || goodDisplayName(a.goodId, common).localeCompare(goodDisplayName(b.goodId, common))
  );
  for (const f of sortedGoods) {
    const good = common.goods[f.goodId];
    if (!good) continue;
    const net = adjustedNet.get(f.goodId);

    // Check if this good's production is capped by harvesters
    const uncapped = uncappedProd.get(f.goodId) || 0;
    const cappedFrom = uncapped > f.produced + 0.01 ? uncapped - f.produced + net : null;
    prodHtml += goodFlowRow(goodDisplayName(f.goodId, common), net, cappedFrom);
  }

  if (trackedGoods.length === 0 && !foodFlow) {
    prodHtml += '<p style="font-size:0.85rem;color:var(--text-dim)">No goods flowing</p>';
  }

  if (scienceFlow && scienceFlow.produced > 0) {
    prodHtml += `<div class="balance-row">
      <span class="balance-label">Science</span>
      <span class="balance-value" style="color:var(--accent)">${formatRate(scienceFlow.produced)}/day</span>
    </div>`;
  }

  // --- Storage buffer allocation (divider) ---
  const storageSlots = computeStorageSlots(entries, faction);
  const { totals: productionStorage, breakdown: productionBreakdown } = computeProductionBuildingStorage(entries, common, faction);
  const bufferNeeds = computeBufferNeeds(entries, adjustedConsumption, common, faction);
  const { allocations, slotSummary } = allocateStorageToBuffers(bufferNeeds, storageSlots, productionStorage, common);

  if (allocations.length > 0 || storageSlots.length > 0) {
    prodHtml += `<div class="section-divider"></div>`;
    prodHtml += `<div class="subsection-label">Storage</div>`;

    for (const a of allocations) {
      const warehouse = a.capacityAllocated - a.productionCapacity;
      const building = a.productionCapacity;
      const color = a.covered ? "var(--surplus)" : "var(--deficit)";

      // Build "N (?) + M store" parts, omitting zero components
      const parts = [];
      if (building > 0) parts.push(`${building} ${buildingStorageHint(productionBreakdown.get(a.goodId))}`);
      if (warehouse > 0) parts.push(`${warehouse} store`);
      const capacityStr = parts.length > 0 ? parts.join(" + ") : "0";

      prodHtml += `<div class="balance-row">
        <span class="balance-label">${escapeHtml(goodDisplayName(a.goodId, common))}</span>
        <span class="balance-value" style="color:${color}">${capacityStr} <span class="storage-needed">/ ${a.bufferNeeded}</span></span>
      </div>`;
    }

    const summaryParts = [];
    for (const type of ["Box", "Liquid", "Pileable"]) {
      const s = slotSummary[type];
      if (s.total > 0 || s.used > 0) {
        const color = s.used <= s.total ? "var(--text-dim)" : "var(--deficit)";
        summaryParts.push(`<span style="color:${color}">${s.used}/${s.total} ${type.toLowerCase()}</span>`);
      }
    }
    if (summaryParts.length > 0) {
      prodHtml += `<div style="font-size:0.8rem;color:var(--text-dim);margin-top:4px">Slots: ${summaryParts.join(" \u00b7 ")}</div>`;
    }
  }

  // --- Workers + Power (divider) ---
  const workers = computeWorkerBalance(entries, beavers, bots, faction);
  const power = computePowerBalance(entries, faction);
  const hasWorkers = workers.beaverUsed > 0 || workers.botUsed > 0 || beavers > 0;
  const hasPower = power.demand > 0 || power.supply > 0;

  if (hasWorkers || hasPower) {
    prodHtml += `<div class="section-divider"></div>`;
    prodHtml += `<div class="subsection-label">Workers</div>`;

    const bvrColor = workers.beaverUsed <= workers.beaverAvailable ? "var(--surplus)" : "var(--deficit)";
    prodHtml += `<div class="balance-row">
      <span class="balance-label">Beavers</span>
      <span class="balance-value" style="color:${bvrColor}">${workers.beaverUsed} / ${workers.beaverAvailable}</span>
    </div>`;
    if (bots > 0 || workers.botUsed > 0) {
      const botColor = workers.botUsed <= workers.botAvailable ? "var(--surplus)" : "var(--deficit)";
      prodHtml += `<div class="balance-row">
        <span class="balance-label">Bots</span>
        <span class="balance-value" style="color:${botColor}">${workers.botUsed} / ${workers.botAvailable}</span>
      </div>`;
    }

    if (hasPower) {
      const powerColor = power.net >= 0 ? "var(--surplus)" : "var(--deficit)";
      const powerLabel = power.net >= 0 ? "" : `<span style="color:var(--deficit)">(${formatRate(power.net)} hp)</span>`;
      prodHtml += `<div class="balance-row">
        <span class="balance-label">Power</span>
        <span class="balance-value" style="color:${powerColor}">${powerLabel} ${power.demand} / ${power.supply} hp</span>
      </div>`;
    }

    // Harvester capacity
    const harvEff = computeHarvesterEfficiency(entries, common, faction, prod);
    const kindLabels = { tree: "Lumberjacks", bush: "Gatherers", crop: "Farmers" };
    for (const kind of ["tree", "bush", "crop"]) {
      const info = harvEff[kind];
      if (info.tiles === 0) continue;
      const capped = info.efficiency < 0.999;
      const color = capped ? "var(--deficit)" : "var(--text-dim)";
      prodHtml += `<div class="balance-row">
        <span class="balance-label">${kindLabels[kind]}</span>
        <span class="balance-value" style="color:${color}">${info.tiles} / ${info.maxTiles === Infinity ? "\u221e" : info.maxTiles} tiles</span>
      </div>`;
    }
  }

  const prevProd = snapshotRows(prodEl);
  prodEl.innerHTML = prodHtml;
  sweepChangedRows(prodEl, prevProd);

  // --- Drought Planning ---
  const droughtEl = document.getElementById("colony-drought");
  const temperateDays = state.temperateDays.get();
  let droughtHtml = `<h3 class="neutral-header">Drought Storage</h3>`;

  if (droughtDays > 0) {
    // Pre-compute per-type warehouse-only storage (subtract production building storage from totals)
    const warehouseByType = { Box: storage.totalBox, Liquid: storage.totalLiquid, Pileable: storage.totalPileable };
    for (const [goodId, cap] of productionStorage) {
      const g = common.goods[goodId];
      if (g && warehouseByType[g.goodType] !== undefined) warehouseByType[g.goodType] -= cap;
    }

    const droughtConsumption = computeDroughtConsumption(beavers, bots, droughtDays, entries, common, faction);
    for (const item of droughtConsumption) {
      const good = common.goods[item.goodId];
      const goodType = good ? good.goodType : "Box";
      const needed = Math.ceil(item.needed);

      // Break down storage into store vs building (per-good)
      let buildingCap;
      let bldBreakdown;
      if (item.goodId === "__food__") {
        // Aggregate production storage across all food goods
        buildingCap = 0;
        bldBreakdown = [];
        for (const [gid, cap] of productionStorage) {
          const g = common.goods[gid];
          if (g && g.goodGroupId === "Food") {
            buildingCap += cap;
            const entries = productionBreakdown.get(gid) || [];
            bldBreakdown.push(...entries);
          }
        }
      } else {
        buildingCap = productionStorage.get(item.goodId) || 0;
        bldBreakdown = productionBreakdown.get(item.goodId);
      }
      const storeCap = goodType === "Liquid" ? warehouseByType.Liquid
        : goodType === "Pileable" ? warehouseByType.Pileable : warehouseByType.Box;
      const storageAvail = storeCap + buildingCap;

      // Surplus rate for this good during temperate season
      const surplusPerDay = item.goodId === "__food__"
        ? foodNet
        : (adjustedNet.get(item.goodId) ?? 0);
      const daysToFill = surplusPerDay > 0.01 ? needed / surplusPerDay : Infinity;

      const fillsInTime = daysToFill <= temperateDays;
      const storageSufficient = needed <= storageAvail;

      const fillColor = fillsInTime ? "var(--surplus)" : "var(--deficit)";
      const fillStr = `<span style="color:${fillColor}">(${daysToFill === Infinity ? "\u221ed" : formatRate(daysToFill) + "d"} to fill)</span>`;

      const capColor = storageSufficient ? "var(--surplus)" : "var(--deficit)";
      const capParts = [];
      if (buildingCap > 0) capParts.push(`${buildingCap} ${buildingStorageHint(bldBreakdown)}`);
      if (storeCap > 0) capParts.push(`${storeCap} store`);
      const capStr = capParts.length > 0 ? capParts.join(" + ") : "0";

      droughtHtml += `<div class="balance-row">
        <span class="balance-label">${escapeHtml(goodDisplayName(item.goodId, common))}</span>
        <span class="balance-value">${fillStr} <span style="color:${capColor}">${capStr}</span> <span class="storage-needed">/ ${needed}</span></span>
      </div>`;
    }
  } else {
    droughtHtml += '<p style="font-size:0.85rem;color:var(--text-dim)">Set drought days above to plan</p>';
  }
  const prevDrought = snapshotRows(droughtEl);
  droughtEl.innerHTML = droughtHtml;
  sweepChangedRows(droughtEl, prevDrought);
}

// --- Helpers ---

const HARVESTER_BUILDINGS = {
  Folktails: { tree: "LumberjackFlag.Folktails", bush: "GathererFlag.Folktails", crop: "EfficientFarmHouse.Folktails" },
  IronTeeth: { tree: "LumberjackFlag.IronTeeth", bush: "GathererFlag.IronTeeth", crop: "FarmHouse.IronTeeth" },
};

function addResourceWithHarvester(resourceId, common, faction) {
  const kind = getResourceKind(resourceId, common);
  const factionId = state.factionId.get();
  const harvesterId = kind && HARVESTER_BUILDINGS[factionId]?.[kind];
  const roster = state.roster.get();

  const newEntries = [...roster, { type: "resource", resourceId, count: 10 }];

  // Auto-add harvester if not already in roster
  if (harvesterId && faction.buildings[harvesterId] &&
      !roster.some(e => e.type === "building" && e.buildingId === harvesterId)) {
    newEntries.push({ type: "building", buildingId: harvesterId, recipeId: null, count: 1 });
  }

  state.roster.set(newEntries);
}

/**
 * Render satisfied needs grouped by need group.
 * Shows a capacity warning when buildings can't serve the whole population.
 */
function renderCoveredNeeds(needs, population) {
  if (needs.length === 0) return "";

  let html = "";
  let currentGroup = null;

  for (const n of needs) {
    if (n.needGroupId !== currentGroup) {
      // Close previous group
      if (currentGroup !== null) html += `</span></div>`;
      currentGroup = n.needGroupId;
      html += `<div class="needs-group-row">
        <span class="needs-group-label">${escapeHtml(n.groupDisplayName)}</span>
        <span class="needs-group-items">`;
    }

    const wb = n.favorableWellbeing;
    if (n.sufficient) {
      html += `<span class="need-covered" title="${escapeHtml(n.displayName)}: +${wb} wellbeing">${escapeHtml(n.displayName)} <span class="need-wb">+${wb}</span></span>`;
    } else {
      const cap = n.capacity;
      html += `<span class="need-partial" title="${escapeHtml(n.displayName)}: capacity ${cap}/${population}">${escapeHtml(n.displayName)} <span class="need-wb">${cap}/${population}</span></span>`;
    }
  }

  // Close last group
  if (currentGroup !== null) html += `</span></div>`;

  return html;
}

/**
 * Render "building" label with a hover tooltip showing which buildings contribute what storage.
 */
function buildingStorageHint(breakdown) {
  if (!breakdown || breakdown.length === 0) return "?";
  const lines = breakdown.map(b =>
    `${escapeHtml(b.displayName)}: ${b.capacity}`
  ).join("<br>");
  return `<span class="hint-trigger" tabindex="0">?<span class="hint-tooltip">${lines}</span></span>`;
}

function goodDisplayName(goodId, common) {
  if (goodId === "__food__") return "Food (total)";
  if (goodId === "__science__") return "Science";
  return goodName(common.goods[goodId]) || goodId;
}

function goodFlowRow(name, net, uncappedNet) {
  const isDeficit = net < -0.01;
  const isSurplus = net > 0.01;
  const rateCls = isDeficit ? "deficit" : (isSurplus ? "surplus" : "neutral");
  const prefix = isSurplus ? "+" : "";

  let cappedStr = "";
  if (uncappedNet != null) {
    const uPrefix = uncappedNet > 0 ? "+" : "";
    cappedStr = `<span style="color:var(--deficit)">(${uPrefix}${formatRate(uncappedNet)}/day uncapped)</span>`;
  }

  return `<div class="balance-row">
    <span class="balance-label">${escapeHtml(name)}</span>
    <span class="balance-value ${rateCls}">${cappedStr} ${prefix}${formatRate(net)}/day</span>
  </div>`;
}

/**
 * Compute what goods need to be stockpiled for a drought of N days.
 */
function computeDroughtConsumption(beavers, bots, days, entries, common, faction) {
  const consumption = new Map();

  // Beaver needs
  const hunger = common.needs["Hunger"];
  if (hunger && beavers > 0) {
    const foodPerDay = beavers * Math.abs(hunger.dailyDelta) / 0.3;
    consumption.set("__food__", (consumption.get("__food__") || 0) + foodPerDay * days);
  }

  const thirst = common.needs["Thirst"];
  const water = common.goods["Water"];
  if (thirst && water && beavers > 0) {
    const waterEffect = water.consumptionEffects.find(e => e.needId === "Thirst");
    if (waterEffect) {
      const waterPerDay = beavers * Math.abs(thirst.dailyDelta) / waterEffect.points;
      consumption.set("Water", (consumption.get("Water") || 0) + waterPerDay * days);
    }
  }

  // Bot needs
  if (bots > 0) {
    const botNeeds = computeBotNeeds(bots, common, faction);
    for (const need of botNeeds) {
      if (need.goodId) {
        consumption.set(need.goodId, (consumption.get(need.goodId) || 0) + need.total * days);
      }
    }
  }

  // Passive building consumption
  for (const entry of entries) {
    if (entry.type !== "building" || entry.count <= 0) continue;
    const building = faction.buildings[entry.buildingId];
    if (!building?.consumedGoods) continue;
    for (const cg of building.consumedGoods) {
      const perDay = cg.goodPerHour * 24 * entry.count;
      consumption.set(cg.goodId, (consumption.get(cg.goodId) || 0) + perDay * days);
    }
  }

  const result = [];
  for (const [goodId, needed] of consumption) {
    result.push({ goodId, needed });
  }
  result.sort((a, b) => b.needed - a.needed);
  return result;
}
