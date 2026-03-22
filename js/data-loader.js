// Data loading and indexing

let commonData = null;
let factionData = {};
let activeFaction = null;

// Indexes built after loading
let recipesByProduct = {};        // goodId -> [recipeId]
let recipesByIngredient = {};     // goodId -> [recipeId]
let buildingsByRecipe = {};       // recipeId -> [buildingId]
let buildingsByCost = {};         // goodId -> [buildingId]
let naturalResourcesByYield = {}; // goodId -> [resourceId]

export async function loadData() {
  const [common, folktails, ironteeth] = await Promise.all([
    fetchJson("data/common.json"),
    fetchJson("data/Folktails.json"),
    fetchJson("data/IronTeeth.json"),
  ]);

  commonData = common;
  factionData = { Folktails: folktails, IronTeeth: ironteeth };
  activeFaction = folktails;

  buildIndexes();
}

async function fetchJson(path) {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`Failed to fetch ${path}: ${resp.status}`);
  return resp.json();
}

export function setActiveFaction(factionId) {
  activeFaction = factionData[factionId];
  buildIndexes();
}

function buildIndexes() {
  recipesByProduct = {};
  recipesByIngredient = {};
  buildingsByRecipe = {};
  buildingsByCost = {};
  naturalResourcesByYield = {};

  // Build buildingsByRecipe first (needed to filter recipes by faction)
  if (activeFaction) {
    for (const [id, building] of Object.entries(activeFaction.buildings)) {
      for (const recipeId of building.recipeIds) {
        if (!buildingsByRecipe[recipeId]) buildingsByRecipe[recipeId] = [];
        buildingsByRecipe[recipeId].push(id);
      }
      for (const cost of building.buildingCost) {
        if (!buildingsByCost[cost.id]) buildingsByCost[cost.id] = [];
        buildingsByCost[cost.id].push(id);
      }
    }
  }

  // Only index recipes that are available in the current faction's buildings
  const recipes = commonData.recipes;
  for (const [id, recipe] of Object.entries(recipes)) {
    if (!buildingsByRecipe[id]) continue;
    for (const product of recipe.products) {
      if (!recipesByProduct[product.id]) recipesByProduct[product.id] = [];
      recipesByProduct[product.id].push(id);
    }
    for (const ingredient of recipe.ingredients) {
      if (!recipesByIngredient[ingredient.id]) recipesByIngredient[ingredient.id] = [];
      recipesByIngredient[ingredient.id].push(id);
    }
    // Fuel is also consumed
    if (recipe.fuel) {
      if (!recipesByIngredient[recipe.fuel]) recipesByIngredient[recipe.fuel] = [];
      recipesByIngredient[recipe.fuel].push(id);
    }
  }

  // Natural resources by yield good (only those relevant to current faction)
  const nr = commonData.naturalResources;
  const availableGoods = activeFaction ? new Set(activeFaction.availableGoodIds) : new Set();
  for (const category of [nr.crops, nr.trees, nr.bushes]) {
    for (const [id, resource] of Object.entries(category)) {
      const yieldId = resource.yield.id;
      if (availableGoods.has(yieldId)) {
        if (!naturalResourcesByYield[yieldId]) naturalResourcesByYield[yieldId] = [];
        naturalResourcesByYield[yieldId].push(id);
      }
      // Gatherable secondary yield
      if (resource.gatherableYield) {
        const gId = resource.gatherableYield.id;
        if (availableGoods.has(gId)) {
          if (!naturalResourcesByYield[gId]) naturalResourcesByYield[gId] = [];
          naturalResourcesByYield[gId].push(id);
        }
      }
    }
  }
}

export function getCommon() { return commonData; }
export function getFaction() { return activeFaction; }
export function getAllFactions() { return factionData; }
export function getRecipesByProduct(goodId) { return recipesByProduct[goodId] || []; }
export function getRecipesByIngredient(goodId) { return recipesByIngredient[goodId] || []; }
export function getBuildingsByRecipe(recipeId) { return buildingsByRecipe[recipeId] || []; }
export function getBuildingsByCost(goodId) { return buildingsByCost[goodId] || []; }
export function getNaturalResourcesByYield(goodId) { return naturalResourcesByYield[goodId] || []; }
