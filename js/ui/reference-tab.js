// Reference tab: browse and search game data

import * as data from "../data-loader.js";
import {
  escapeHtml, goodName, recipeName, buildingName, naturalResourceName,
  formatRate, renderTable,
} from "./components.js";

let currentFilter = "all";
let currentSearch = "";
let selectedItem = null; // { type, id }
let itemSelectCallback = null;

export function onItemSelect(fn) {
  itemSelectCallback = fn;
}

export function selectItem(type, id) {
  selectedItem = type && id ? { type, id } : null;
  renderList();
  if (selectedItem) {
    renderDetail(selectedItem.type, selectedItem.id);
  } else {
    document.getElementById("reference-detail").innerHTML =
      '<p class="placeholder">Select an item to see details</p>';
  }
}

export function initReferenceTab() {
  const searchInput = document.getElementById("reference-search-input");
  searchInput.addEventListener("input", () => {
    currentSearch = searchInput.value.toLowerCase();
    renderList();
  });

  for (const btn of document.querySelectorAll(".filter-btn")) {
    btn.addEventListener("click", () => {
      document.querySelector(".filter-btn.active").classList.remove("active");
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      renderList();
    });
  }

  renderList();
}

export function renderReferenceTab() {
  renderList();
  if (selectedItem) {
    renderDetail(selectedItem.type, selectedItem.id);
  }
}

function renderList() {
  const container = document.getElementById("reference-list");
  const common = data.getCommon();
  const faction = data.getFaction();
  if (!common || !faction) return;

  let html = "";

  // Goods
  if (currentFilter === "all" || currentFilter === "goods") {
    const goods = Object.values(common.goods)
      .filter(g => faction.availableGoodIds.includes(g.id))
      .filter(g => matchesSearch(goodName(g), g.id))
      .sort((a, b) => (a.goodGroupId + a.id).localeCompare(b.goodGroupId + b.id));

    if (goods.length > 0) {
      html += `<div class="ref-section"><h3>Goods (${goods.length})</h3>`;
      for (const g of goods) {
        const selected = selectedItem?.type === "good" && selectedItem?.id === g.id;
        const groupLabel = common.goodGroups[g.goodGroupId]?.displayName || g.goodGroupId;
        html += `<div class="ref-item ${selected ? "selected" : ""}" data-type="good" data-id="${escapeHtml(g.id)}">
          <span>${escapeHtml(goodName(g))}</span>
          <span class="badge">${escapeHtml(groupLabel)}</span>
        </div>`;
      }
      html += "</div>";
    }
  }

  // Recipes (only those available in current faction's buildings)
  if (currentFilter === "all" || currentFilter === "recipes") {
    const recipes = Object.values(common.recipes)
      .filter(r => data.getBuildingsByRecipe(r.id).length > 0)
      .filter(r => matchesSearch(recipeName(r), r.id))
      .sort((a, b) => a.id.localeCompare(b.id));

    if (recipes.length > 0) {
      html += `<div class="ref-section"><h3>Recipes (${recipes.length})</h3>`;
      for (const r of recipes) {
        const selected = selectedItem?.type === "recipe" && selectedItem?.id === r.id;
        const duration = `${r.cycleDurationInHours}h`;
        html += `<div class="ref-item ${selected ? "selected" : ""}" data-type="recipe" data-id="${escapeHtml(r.id)}">
          <span>${escapeHtml(recipeName(r))}</span>
          <span class="badge">${duration}</span>
        </div>`;
      }
      html += "</div>";
    }
  }

  // Buildings
  if (currentFilter === "all" || currentFilter === "buildings") {
    const buildings = Object.values(faction.buildings)
      .filter(b => matchesSearch(buildingName(b), b.id))
      .sort((a, b) => {
        const catOrder = (cat) => common.buildingCategories[cat].order;
        return catOrder(a.category) - catOrder(b.category) || a.toolOrder - b.toolOrder;
      });

    if (buildings.length > 0) {
      html += `<div class="ref-section"><h3>Buildings (${buildings.length})</h3>`;
      for (const b of buildings) {
        const selected = selectedItem?.type === "building" && selectedItem?.id === b.id;
        html += `<div class="ref-item ${selected ? "selected" : ""}" data-type="building" data-id="${escapeHtml(b.id)}">
          <span>${escapeHtml(buildingName(b))}</span>
          <span class="badge">${escapeHtml(b.category)}</span>
        </div>`;
      }
      html += "</div>";
    }
  }

  // Natural resources (only those whose yields are available for the current faction)
  if (currentFilter === "all" || currentFilter === "nature") {
    const nr = common.naturalResources;
    const availableGoods = new Set(faction.availableGoodIds);
    const isResourceAvailable = r =>
      availableGoods.has(r.yield.id) || (r.gatherableYield && availableGoods.has(r.gatherableYield.id));
    const allResources = [
      ...Object.values(nr.crops).map(r => ({ ...r, kind: "Crop" })),
      ...Object.values(nr.trees).map(r => ({ ...r, kind: "Tree" })),
      ...Object.values(nr.bushes).map(r => ({ ...r, kind: "Bush" })),
    ]
      .filter(isResourceAvailable)
      .filter(r => matchesSearch(naturalResourceName(r), r.id));

    if (allResources.length > 0) {
      html += `<div class="ref-section"><h3>Natural Resources (${allResources.length})</h3>`;
      for (const r of allResources) {
        const selected = selectedItem?.type === "nature" && selectedItem?.id === r.id;
        html += `<div class="ref-item ${selected ? "selected" : ""}" data-type="nature" data-id="${escapeHtml(r.id)}">
          <span>${escapeHtml(naturalResourceName(r))}</span>
          <span class="badge">${escapeHtml(r.kind)}</span>
        </div>`;
      }
      html += "</div>";
    }
  }

  // Hint for items available in other factions
  if (currentSearch) {
    const otherHints = getOtherFactionHints(common, faction, currentSearch, currentFilter);
    if (otherHints.length > 0) {
      html += `<div class="ref-section ref-hint">`;
      html += `<p>Looking for something else? These match in other factions:</p><ul>`;
      for (const hint of otherHints) {
        html += `<li>${escapeHtml(hint.name)} <span class="badge">${escapeHtml(hint.faction)}</span></li>`;
      }
      html += `</ul></div>`;
    }
  }

  container.innerHTML = html;

  // Bind click events
  for (const item of container.querySelectorAll(".ref-item")) {
    item.addEventListener("click", () => {
      selectedItem = { type: item.dataset.type, id: item.dataset.id };
      renderList();
      renderDetail(item.dataset.type, item.dataset.id);
      if (itemSelectCallback) itemSelectCallback(selectedItem);
    });
  }

  // Scroll selected item into view
  const selected = container.querySelector(".ref-item.selected");
  if (selected) {
    selected.scrollIntoView({ block: "nearest" });
  }
}

function matchesSearch(displayName, id) {
  if (!currentSearch) return true;
  return displayName.toLowerCase().includes(currentSearch) ||
    id.toLowerCase().includes(currentSearch);
}

function getOtherFactionHints(common, currentFaction, search, filter) {
  const allFactions = data.getAllFactions();
  const hints = [];
  const seen = new Set();

  for (const [factionId, otherFaction] of Object.entries(allFactions)) {
    if (factionId === currentFaction.factionId) continue;

    // Goods in other faction but not current
    if (filter === "all" || filter === "goods") {
      const currentGoods = new Set(currentFaction.availableGoodIds);
      for (const gid of otherFaction.availableGoodIds) {
        if (currentGoods.has(gid)) continue;
        const g = common.goods[gid];
        if (g && matchesSearch(goodName(g), g.id) && !seen.has(g.id)) {
          seen.add(g.id);
          hints.push({ name: goodName(g), faction: otherFaction.displayName });
        }
      }
    }

    // Recipes in other faction's buildings but not current
    if (filter === "all" || filter === "recipes") {
      const currentRecipeIds = new Set();
      for (const b of Object.values(currentFaction.buildings)) {
        for (const rid of b.recipeIds) currentRecipeIds.add(rid);
      }
      const otherRecipeIds = new Set();
      for (const b of Object.values(otherFaction.buildings)) {
        for (const rid of b.recipeIds) otherRecipeIds.add(rid);
      }
      for (const rid of otherRecipeIds) {
        if (currentRecipeIds.has(rid)) continue;
        const r = common.recipes[rid];
        if (r && matchesSearch(recipeName(r), r.id) && !seen.has(rid)) {
          seen.add(rid);
          hints.push({ name: recipeName(r), faction: otherFaction.displayName });
        }
      }
    }

    // Natural resources in other faction but not current
    if (filter === "all" || filter === "nature") {
      const currentGoods = new Set(currentFaction.availableGoodIds);
      const otherGoods = new Set(otherFaction.availableGoodIds);
      const nr = common.naturalResources;
      for (const category of [nr.crops, nr.trees, nr.bushes]) {
        for (const r of Object.values(category)) {
          const inCurrent = currentGoods.has(r.yield.id) || (r.gatherableYield && currentGoods.has(r.gatherableYield.id));
          const inOther = otherGoods.has(r.yield.id) || (r.gatherableYield && otherGoods.has(r.gatherableYield.id));
          if (inOther && !inCurrent && matchesSearch(naturalResourceName(r), r.id) && !seen.has(r.id)) {
            seen.add(r.id);
            hints.push({ name: naturalResourceName(r), faction: otherFaction.displayName });
          }
        }
      }
    }
  }

  return hints;
}

function renderDetail(type, id) {
  const container = document.getElementById("reference-detail");
  const common = data.getCommon();
  const faction = data.getFaction();

  if (type === "good") {
    renderGoodDetail(container, common, faction, id);
  } else if (type === "recipe") {
    renderRecipeDetail(container, common, faction, id);
  } else if (type === "building") {
    renderBuildingDetail(container, common, faction, id);
  } else if (type === "nature") {
    renderNatureDetail(container, common, id);
  }
}

function renderGoodDetail(container, common, faction, goodId) {
  const good = common.goods[goodId];
  if (!good) return;

  const groupName = common.goodGroups[good.goodGroupId]?.displayName || good.goodGroupId;
  const producedBy = data.getRecipesByProduct(goodId);
  const yieldedBy = data.getNaturalResourcesByYield(goodId);
  const consumedBy = data.getRecipesByIngredient(goodId);
  const nr = common.naturalResources;
  const hasSources = producedBy.length > 0 || yieldedBy.length > 0;
  const hasConsumers = consumedBy.length > 0;

  let html = `
    <div class="detail-header">
      <h2>${escapeHtml(goodName(good))}</h2>
      <div class="detail-type">${escapeHtml(groupName)} &middot; Weight: ${good.weight}</div>
    </div>`;

  // Relevant Recipes — combined sources (+) and consumers (-)
  if (hasSources || hasConsumers) {
    html += `<div class="detail-flat-section"><h4>Relevant Recipes</h4>`;

    // Sources (+)
    const sourceBuildings = {};
    for (const rid of producedBy) {
      for (const bid of data.getBuildingsByRecipe(rid)) {
        if (!sourceBuildings[bid]) sourceBuildings[bid] = [];
        sourceBuildings[bid].push(rid);
      }
    }
    for (const [bid, rids] of Object.entries(sourceBuildings)) {
      for (const rid of rids) {
        const r = common.recipes[rid];
        const p = r.products.find(x => x.id === goodId);
        const rLabel = recipeName(r) === goodName(good) ? `${recipeName(r)} (recipe)` : recipeName(r);
        html += `<div class="flat-list-item source">`;
        html += `<span class="flat-list-name">${makeLink("building", bid, buildingName(faction.buildings[bid]))} via ${makeLink("recipe", rid, rLabel)}</span>`;
        html += `<span class="flat-list-value">+${p ? p.amount : "?"}/cycle</span>`;
        html += `</div>`;
      }
    }

    // Natural resource sources (+)
    for (const rid of yieldedBy) {
      const r = nr.crops[rid] || nr.trees[rid] || nr.bushes[rid];
      let amount = "", method = "";
      if (r.yield.id === goodId) { amount = r.yield.amount; method = "harvest"; }
      else if (r.gatherableYield?.id === goodId) { amount = r.gatherableYield.amount; method = "gather"; }
      html += `<div class="flat-list-item source">`;
      html += `<span class="flat-list-name">${makeLink("nature", rid, naturalResourceName(r))} via ${method}</span>`;
      html += `<span class="flat-list-value">+${amount}/${method}</span>`;
      html += `</div>`;
    }

    // Consumers (-)
    const consumerBuildings = {};
    for (const rid of consumedBy) {
      for (const bid of data.getBuildingsByRecipe(rid)) {
        if (!consumerBuildings[bid]) consumerBuildings[bid] = [];
        consumerBuildings[bid].push(rid);
      }
    }
    for (const [bid, rids] of Object.entries(consumerBuildings)) {
      for (const rid of rids) {
        const r = common.recipes[rid];
        const ing = r.ingredients.find(x => x.id === goodId);
        let amountStr = "";
        if (ing) amountStr = `&minus;${ing.amount}/cycle`;
        else if (r.fuel === goodId) amountStr = `(fuel, ${r.cyclesFuelLasts} cycles) &minus;1`;
        const rLabel = recipeName(r) === goodName(good) ? `${recipeName(r)} (recipe)` : recipeName(r);
        html += `<div class="flat-list-item consumer">`;
        html += `<span class="flat-list-name">${makeLink("building", bid, buildingName(faction.buildings[bid]))} via ${makeLink("recipe", rid, rLabel)}</span>`;
        html += `<span class="flat-list-value">${amountStr}</span>`;
        html += `</div>`;
      }
    }

    html += `</div>`;
  }

  // Needed to Build — flat list
  const neededBy = data.getBuildingsByCost(goodId);
  if (neededBy.length > 0) {
    html += `<div class="detail-flat-section"><h4>Needed to Build</h4>`;
    html += `<div class="build-cost-grid">`;
    const catOrder = (cat) => common.buildingCategories[cat]?.order ?? 999;
    const sorted = neededBy
      .map(bid => {
        const b = faction.buildings[bid];
        const cost = b.buildingCost.find(c => c.id === goodId);
        return { bid, b, amount: cost ? cost.amount : 0 };
      })
      .sort((a, b) =>
        catOrder(a.b.category) - catOrder(b.b.category) ||
        buildingName(a.b).localeCompare(buildingName(b.b)) ||
        a.amount - b.amount
      );
    let lastCategory = null;
    for (const { bid, b, amount } of sorted) {
      const showCategory = b.category !== lastCategory;
      lastCategory = b.category;
      const catLabel = common.buildingCategories[b.category]?.displayName || b.category;
      html += `<div class="build-cost-row${showCategory ? " build-cost-group-start" : ""}">`;
      html += `<span class="build-cost-category">${showCategory ? escapeHtml(catLabel) : ""}</span>\t`;
      html += `<span class="build-cost-name">${makeLink("building", bid, buildingName(b))}</span>\t`;
      html += `<span class="build-cost-amount">${amount || "?"}</span>`;
      html += `</div>`;
    }
    html += `</div></div>`;
  }

  // Satisfies Needs — flat list with need group
  if (good.consumptionEffects.length > 0) {
    html += `<div class="detail-flat-section"><h4>Satisfies Needs</h4>`;
    for (const e of good.consumptionEffects) {
      const need = common.needs[e.needId];
      const name = need?.displayName || e.needId;
      const groupId = need?.needGroupId;
      const groupName = groupId ? (common.needGroups[groupId]?.displayName || groupId) : "";
      html += `<div class="flat-list-item">`;
      html += `<span class="flat-list-name">${escapeHtml(name)}${groupName ? `<span class="sep">&middot;</span><span style="color:var(--text-dim);font-size:0.8rem">${escapeHtml(groupName)}</span>` : ""}</span>`;
      html += `<span class="flat-list-value">${e.points} pts</span>`;
      html += `</div>`;
    }
    html += `</div>`;
  }

  container.innerHTML = html;
  bindDetailLinks(container);
}

function renderRecipeDetail(container, common, faction, recipeId) {
  const recipe = common.recipes[recipeId];
  if (!recipe) return;

  const workHours = 16;
  const cyclesPerDay = workHours / recipe.cycleDurationInHours;
  const hasInputs = recipe.ingredients.length > 0 || recipe.fuel;
  const hasOutputs = recipe.products.length > 0 || recipe.producedSciencePoints > 0;

  const buildings = data.getBuildingsByRecipe(recipeId);
  const buildingLinks = buildings.map(bid =>
    makeLink("building", bid, buildingName(faction.buildings[bid]))
  ).join(", ");

  let html = `
    <div class="detail-header">
      <h2>${escapeHtml(recipeName(recipe))}</h2>
      <div class="detail-type">Recipe${buildingLinks ? ` &middot; ${buildingLinks}` : ""}</div>
    </div>`;

  // Visual arrow flow: input cards --duration--> output cards
  if (hasInputs || hasOutputs) {
    html += `<div class="recipe-flow-diagram">`;

    // Input cards
    html += `<div class="recipe-flow-side">`;
    const inputItems = [];
    for (const ing of recipe.ingredients) {
      let card = `<div class="recipe-flow-card">`;
      card += `<span class="recipe-flow-card-amount">${ing.amount}</span> ${makeLink("good", ing.id, goodName(common.goods[ing.id]))}`;
      card += `</div>`;
      inputItems.push(card);
    }
    if (recipe.fuel) {
      let card = `<div class="recipe-flow-card">`;
      card += `<span class="recipe-flow-card-amount">1</span> ${makeLink("good", recipe.fuel, goodName(common.goods[recipe.fuel]))}`;
      card += `<div class="recipe-flow-card-note">fuel, 1/${recipe.cyclesFuelLasts} cycles</div>`;
      card += `</div>`;
      inputItems.push(card);
    }
    if (!hasInputs) {
      html += `<div class="recipe-flow-card recipe-flow-card-empty">nothing</div>`;
    } else {
      html += inputItems.join(`<div class="recipe-flow-plus">+</div>`);
    }
    html += `</div>`;

    // Arrow
    html += `<div class="recipe-flow-arrow"><span class="recipe-flow-duration">${recipe.cycleDurationInHours}h</span><svg class="recipe-flow-line" viewBox="0 0 100 10" preserveAspectRatio="none"><line x1="0" y1="5" x2="93" y2="5" stroke="#888" stroke-width="1" vector-effect="non-scaling-stroke"/><polygon points="93,2 100,5 93,8" fill="#888"/></svg></div>`;

    // Output cards
    html += `<div class="recipe-flow-side">`;
    for (const prod of recipe.products) {
      html += `<div class="recipe-flow-card">`;
      html += `<span class="recipe-flow-card-amount">${prod.amount}</span> ${makeLink("good", prod.id, goodName(common.goods[prod.id]))}`;
      html += `</div>`;
    }
    if (recipe.producedSciencePoints > 0) {
      html += `<div class="recipe-flow-card">`;
      html += `<span class="recipe-flow-card-amount">${recipe.producedSciencePoints}</span> Science`;
      html += `</div>`;
    }
    html += `</div>`;

    html += `</div>`;
  }


  container.innerHTML = html;
  bindDetailLinks(container);
}

function renderBuildingDetail(container, common, faction, buildingId) {
  const building = faction.buildings[buildingId];
  if (!building) return;

  const catLabel = common.buildingCategories[building.category]?.displayName || building.category;

  // Header — just category and dwelling
  const headerParts = [escapeHtml(catLabel)];
  if (building.dwelling) headerParts.push(`${building.dwelling.maxBeavers} beaver capacity`);

  let html = `
    <div class="detail-header">
      <h2>${escapeHtml(buildingName(building))}</h2>
      <div class="detail-type">${headerParts.join(" &middot; ")}</div>
    </div>`;

  // Unlock cost
  if (building.scienceCost > 0) {
    html += `<div class="detail-flat-section"><h4>Unlock Cost</h4>`;
    html += `<div class="flat-list-item">`;
    html += `<span class="flat-list-name">Science</span>`;
    html += `<span class="flat-list-value">${building.scienceCost}</span>`;
    html += `</div></div>`;
  }

  // Build cost — flat list
  if (building.buildingCost.length > 0) {
    html += `<div class="detail-flat-section"><h4>Build Cost</h4>`;
    for (const c of building.buildingCost) {
      html += `<div class="flat-list-item">`;
      html += `<span class="flat-list-name">${makeLink("good", c.id, goodName(common.goods[c.id]))}</span>`;
      html += `<span class="flat-list-value">${c.amount}</span>`;
      html += `</div>`;
    }
    html += `</div>`;
  }

  // Operation — workers, power, recipe flow diagrams, passive consumption
  const hasOps = building.maxWorkers > 0 || building.powerInput > 0 || building.powerOutput > 0 || building.recipeIds.length > 0 || building.consumedGoods?.length > 0;
  if (hasOps) {
    html += `<div class="detail-flat-section"><h4>Operation</h4>`;

    // Workers and power
    if (building.maxWorkers > 0) {
      html += `<div class="flat-list-item">`;
      html += `<span class="flat-list-name">Workers</span>`;
      html += `<span class="flat-list-value">${building.maxWorkers}</span>`;
      html += `</div>`;
    }
    if (building.powerInput > 0) {
      html += `<div class="flat-list-item">`;
      html += `<span class="flat-list-name">Power input</span>`;
      html += `<span class="flat-list-value">${building.powerInput} hp</span>`;
      html += `</div>`;
    }
    if (building.powerOutput > 0) {
      html += `<div class="flat-list-item">`;
      html += `<span class="flat-list-name">Power output</span>`;
      html += `<span class="flat-list-value">${building.powerOutput} hp</span>`;
      html += `</div>`;
    }

    // Recipe flow diagrams
    for (const rid of building.recipeIds) {
      const recipe = common.recipes[rid];
      if (!recipe) continue;

      // Recipe label
      html += `<div class="building-recipe-label">${makeLink("recipe", rid, recipeName(recipe))}</div>`;

      // Arrow flow diagram
      html += `<div class="recipe-flow-diagram">`;

      // Input cards
      html += `<div class="recipe-flow-side">`;
      const inputItems = [];
      for (const ing of recipe.ingredients) {
        let card = `<div class="recipe-flow-card">`;
        card += `<span class="recipe-flow-card-amount">${ing.amount}</span> ${makeLink("good", ing.id, goodName(common.goods[ing.id]))}`;
        card += `</div>`;
        inputItems.push(card);
      }
      if (recipe.fuel) {
        let card = `<div class="recipe-flow-card">`;
        card += `<span class="recipe-flow-card-amount">1</span> ${makeLink("good", recipe.fuel, goodName(common.goods[recipe.fuel]))}`;
        card += `<div class="recipe-flow-card-note">fuel, 1/${recipe.cyclesFuelLasts} cycles</div>`;
        card += `</div>`;
        inputItems.push(card);
      }
      if (inputItems.length === 0) {
        html += `<div class="recipe-flow-card recipe-flow-card-empty">nothing</div>`;
      } else {
        html += inputItems.join(`<div class="recipe-flow-plus">+</div>`);
      }
      html += `</div>`;

      // Arrow
      html += `<div class="recipe-flow-arrow"><span class="recipe-flow-duration">${recipe.cycleDurationInHours}h</span><svg class="recipe-flow-line" viewBox="0 0 100 10" preserveAspectRatio="none"><line x1="0" y1="5" x2="93" y2="5" stroke="#888" stroke-width="1" vector-effect="non-scaling-stroke"/><polygon points="93,2 100,5 93,8" fill="#888"/></svg></div>`;

      // Output cards
      html += `<div class="recipe-flow-side">`;
      for (const prod of recipe.products) {
        html += `<div class="recipe-flow-card">`;
        html += `<span class="recipe-flow-card-amount">${prod.amount}</span> ${makeLink("good", prod.id, goodName(common.goods[prod.id]))}`;
        html += `</div>`;
      }
      if (recipe.producedSciencePoints > 0) {
        html += `<div class="recipe-flow-card">`;
        html += `<span class="recipe-flow-card-amount">${recipe.producedSciencePoints}</span> Science`;
        html += `</div>`;
      }
      html += `</div>`;

      html += `</div>`;
    }

    // Passive consumption
    if (building.consumedGoods?.length > 0) {
      html += `<div class="building-recipe-label">Passive Consumption</div>`;
      for (const c of building.consumedGoods) {
        html += `<div class="flat-list-item">`;
        html += `<span class="flat-list-name">${makeLink("good", c.goodId, goodName(common.goods[c.goodId]))}</span>`;
        html += `<span class="flat-list-value">${formatRate(c.goodPerHour)}/hr</span>`;
        html += `</div>`;
      }
    }

    html += `</div>`;
  }

  container.innerHTML = html;
  bindDetailLinks(container);
}

function renderNatureDetail(container, common, resourceId) {
  const nr = common.naturalResources;
  const resource = nr.crops[resourceId] || nr.trees[resourceId] || nr.bushes[resourceId];
  if (!resource) return;

  const kind = nr.crops[resourceId] ? "Crop" : nr.trees[resourceId] ? "Tree" : "Bush";

  // Header with inline stats
  const headerParts = [kind];
  headerParts.push(`${resource.growthTimeInDays} day growth`);
  if (resource.daysToDieDry != null) {
    headerParts.push(`${resource.daysToDieDry} day drought tolerance`);
  }

  let html = `
    <div class="detail-header">
      <h2>${escapeHtml(naturalResourceName(resource))}</h2>
      <div class="detail-type">${headerParts.join(" &middot; ")}</div>
    </div>`;

  // Yield cards — layout depends on resource type
  html += `<div class="nature-yields">`;

  const isCrop = !!nr.crops[resourceId];
  const isTree = !!nr.trees[resourceId];
  const isBush = !!nr.bushes[resourceId];

  if (isCrop) {
    // Crops: single card — harvest is destructive, must replant
    const effectiveRate = resource.yield.amount / resource.growthTimeInDays;
    const times = [];
    if (resource.harvestTimeInHours) times.push(`${resource.harvestTimeInHours}h harvest`);
    if (resource.plantTimeInHours) times.push(`${resource.plantTimeInHours}h plant`);

    html += `<div class="nature-yield-card">`;
    html += `<div class="nature-yield-card-label">Harvest (destructive)</div>`;
    html += `<div class="nature-yield-card-body">`;
    html += `<div class="nature-yield-card-amount">${resource.yield.amount} ${makeLink("good", resource.yield.id, goodName(common.goods[resource.yield.id]))}</div>`;
    html += `<div class="nature-yield-card-rate">${formatRate(effectiveRate)}/day per plant</div>`;
    if (times.length > 0) {
      html += `<div class="nature-yield-card-time">${times.join(" &middot; ")}</div>`;
    }
    html += `</div></div>`;
  }

  if (isTree) {
    // Trees: cut is destructive (gives logs)
    const effectiveRate = resource.yield.amount / resource.growthTimeInDays;
    const times = [];
    if (resource.harvestTimeInHours) times.push(`${resource.harvestTimeInHours}h cut`);
    if (resource.plantTimeInHours) times.push(`${resource.plantTimeInHours}h plant`);

    html += `<div class="nature-yield-card">`;
    html += `<div class="nature-yield-card-label">Cut (destructive)</div>`;
    html += `<div class="nature-yield-card-body">`;
    html += `<div class="nature-yield-card-amount">${resource.yield.amount} ${makeLink("good", resource.yield.id, goodName(common.goods[resource.yield.id]))}</div>`;
    html += `<div class="nature-yield-card-rate">${formatRate(effectiveRate)}/day per plant</div>`;
    if (times.length > 0) {
      html += `<div class="nature-yield-card-time">${times.join(" &middot; ")}</div>`;
    }
    html += `</div></div>`;

    // Trees may also have a gatherable yield (renewable)
    if (resource.gatherableYield) {
      const gy = resource.gatherableYield;
      const gatherRate = gy.amount / gy.yieldGrowthTimeInDays;

      html += `<div class="nature-yield-card">`;
      html += `<div class="nature-yield-card-label">Gather (renewable)</div>`;
      html += `<div class="nature-yield-card-body">`;
      html += `<div class="nature-yield-card-amount">${gy.amount} ${makeLink("good", gy.id, goodName(common.goods[gy.id]))}</div>`;
      html += `<div class="nature-yield-card-rate">every ${gy.yieldGrowthTimeInDays} days &middot; ${formatRate(gatherRate)}/day per plant</div>`;
      html += `<div class="nature-yield-card-time">${gy.gatherTimeInHours}h gather</div>`;
      html += `</div></div>`;
    }
  }

  if (isBush) {
    // Bushes: gather is renewable — the bush regrows its yield
    const effectiveRate = resource.yield.amount / resource.yieldGrowthTimeInDays;
    const times = [];
    if (resource.gatherTimeInHours) times.push(`${resource.gatherTimeInHours}h gather`);
    if (resource.plantTimeInHours) times.push(`${resource.plantTimeInHours}h plant`);

    html += `<div class="nature-yield-card">`;
    html += `<div class="nature-yield-card-label">Gather (renewable)</div>`;
    html += `<div class="nature-yield-card-body">`;
    html += `<div class="nature-yield-card-amount">${resource.yield.amount} ${makeLink("good", resource.yield.id, goodName(common.goods[resource.yield.id]))}</div>`;
    html += `<div class="nature-yield-card-rate">every ${resource.yieldGrowthTimeInDays} days &middot; ${formatRate(effectiveRate)}/day per plant</div>`;
    if (times.length > 0) {
      html += `<div class="nature-yield-card-time">${times.join(" &middot; ")}</div>`;
    }
    html += `</div></div>`;
  }

  html += `</div>`;

  container.innerHTML = html;
  bindDetailLinks(container);
}

function makeLink(type, id, label) {
  return `<span class="detail-link" data-type="${type}" data-id="${escapeHtml(id)}">${escapeHtml(label)}</span>`;
}

function bindDetailLinks(container) {
  for (const link of container.querySelectorAll(".detail-link")) {
    link.addEventListener("click", () => {
      selectedItem = { type: link.dataset.type, id: link.dataset.id };
      renderList();
      renderDetail(link.dataset.type, link.dataset.id);
      if (itemSelectCallback) itemSelectCallback(selectedItem);
    });
  }
}
