// Pure computation functions for colony calculations

const BEAVER_WORK_HOURS = 16;
const BOT_WORK_HOURS = 24;

/**
 * Compute production and consumption rates for a single building running a recipe.
 * Returns { production: [{goodId, perDay}], consumption: [{goodId, perDay}] }
 */
export function computeBuildingRates(recipe, building, count, productivity = 1) {
  if (!recipe || count <= 0) return { production: [], consumption: [] };

  const workerType = building.defaultWorkerType;
  const workHours = workerType === "Bot" ? BOT_WORK_HOURS : BEAVER_WORK_HOURS;
  const cyclesPerDay = (workHours / recipe.cycleDurationInHours) * productivity;

  const production = recipe.products.map(p => ({
    goodId: p.id,
    perDay: p.amount * cyclesPerDay * count,
  }));

  const consumption = recipe.ingredients.map(i => ({
    goodId: i.id,
    perDay: i.amount * cyclesPerDay * count,
  }));

  // Fuel consumption
  if (recipe.fuel && recipe.cyclesFuelLasts > 0) {
    consumption.push({
      goodId: recipe.fuel,
      perDay: (cyclesPerDay / recipe.cyclesFuelLasts) * count,
    });
  }

  // Science production
  if (recipe.producedSciencePoints > 0) {
    production.push({
      goodId: "__science__",
      perDay: recipe.producedSciencePoints * cyclesPerDay * count,
    });
  }

  return { production, consumption };
}

/**
 * Compute total colony flows from roster + population.
 */
export function computeColonyFlows(rosterEntries, beaverCount, botCount, commonData, factionData, productivity = 1) {
  const production = new Map(); // goodId -> perDay
  const consumption = new Map();

  // Harvester efficiency caps resource output to what workers can collect
  const harvEff = computeHarvesterEfficiency(rosterEntries, commonData, factionData, productivity);

  for (const entry of rosterEntries) {
    if (entry.count <= 0) continue;

    // --- Resource tile entries ---
    if (entry.type === "resource") {
      const yields = computeResourceYield(entry.resourceId, entry.count, commonData);
      const kind = getResourceKind(entry.resourceId, commonData);
      const eff = kind ? harvEff[kind].efficiency : 1;
      for (const y of yields) {
        production.set(y.goodId, (production.get(y.goodId) || 0) + y.perDay * eff);
      }
      continue;
    }

    // --- Building entries ---
    const building = factionData.buildings[entry.buildingId];
    if (!building) continue;

    // Recipe-based production/consumption
    if (entry.recipeId) {
      const recipe = commonData.recipes[entry.recipeId];
      if (recipe) {
        const rates = computeBuildingRates(recipe, building, entry.count, productivity);
        for (const p of rates.production) {
          production.set(p.goodId, (production.get(p.goodId) || 0) + p.perDay);
        }
        for (const c of rates.consumption) {
          consumption.set(c.goodId, (consumption.get(c.goodId) || 0) + c.perDay);
        }
      }
    }

    // Passive good consumption (e.g. Agora consuming Extract)
    if (building.consumedGoods) {
      for (const cg of building.consumedGoods) {
        const perDay = cg.goodPerHour * 24 * entry.count;
        consumption.set(cg.goodId, (consumption.get(cg.goodId) || 0) + perDay);
      }
    }
  }

  // Beaver consumption
  if (beaverCount > 0) {
    const needs = commonData.needs;
    const goods = commonData.goods;

    // Water: |dailyDelta(Thirst)| / consumptionEffect(Water, Thirst)
    const thirst = needs["Thirst"];
    const water = goods["Water"];
    if (thirst && water) {
      const waterEffect = water.consumptionEffects.find(e => e.needId === "Thirst");
      if (waterEffect && waterEffect.points > 0) {
        const waterPerBeaverPerDay = Math.abs(thirst.dailyDelta) / waterEffect.points;
        consumption.set("Water", (consumption.get("Water") || 0) + beaverCount * waterPerBeaverPerDay);
      }
    }

    // Food: |dailyDelta(Hunger)| / avg consumptionEffect(food, Hunger)
    // Use 0.3 as the standard hunger points per food unit
    const hunger = needs["Hunger"];
    if (hunger) {
      const foodPerBeaverPerDay = Math.abs(hunger.dailyDelta) / 0.3;
      consumption.set("__food__", (consumption.get("__food__") || 0) + beaverCount * foodPerBeaverPerDay);
    }
  }

  // Bot consumption: find bot needs that consume goods
  if (botCount > 0) {
    const botNeeds = computeBotNeeds(botCount, commonData, factionData);
    for (const need of botNeeds) {
      if (need.goodId) {
        consumption.set(need.goodId, (consumption.get(need.goodId) || 0) + need.total);
      }
    }
  }

  // Compute net flows
  const allGoods = new Set([...production.keys(), ...consumption.keys()]);
  const flows = [];
  for (const goodId of allGoods) {
    const prod = production.get(goodId) || 0;
    const cons = consumption.get(goodId) || 0;
    flows.push({ goodId, produced: prod, consumed: cons, net: prod - cons });
  }

  // Sort: deficits first (most negative), then surpluses
  flows.sort((a, b) => a.net - b.net);

  return flows;
}

/**
 * Compute power balance.
 */
export function computePowerBalance(rosterEntries, factionData) {
  let totalDemand = 0;
  let totalSupply = 0;

  for (const entry of rosterEntries) {
    const building = factionData.buildings[entry.buildingId];
    if (!building || entry.count <= 0) continue;
    totalDemand += building.powerInput * entry.count;
    totalSupply += building.powerOutput * entry.count;
  }

  return { demand: totalDemand, supply: totalSupply, net: totalSupply - totalDemand };
}

/**
 * Compute worker allocation.
 */
export function computeWorkerBalance(rosterEntries, beaverCount, botCount, factionData) {
  let beaverWorkersUsed = 0;
  let botWorkersUsed = 0;

  for (const entry of rosterEntries) {
    const building = factionData.buildings[entry.buildingId];
    if (!building || entry.count <= 0) continue;

    const workers = building.maxWorkers * entry.count;
    if (building.defaultWorkerType === "Bot") {
      botWorkersUsed += workers;
    } else {
      beaverWorkersUsed += workers;
    }
  }

  return {
    beaverUsed: beaverWorkersUsed,
    beaverAvailable: beaverCount,
    botUsed: botWorkersUsed,
    botAvailable: botCount,
  };
}

/**
 * Compute population needs summary.
 */
export function computePopulationNeeds(beaverCount, commonData) {
  const needs = commonData.needs;
  const result = [];

  const hunger = needs["Hunger"];
  if (hunger) {
    result.push({
      label: "Food",
      perBeaverPerDay: Math.abs(hunger.dailyDelta) / 0.3,
      total: beaverCount * Math.abs(hunger.dailyDelta) / 0.3,
    });
  }

  const thirst = needs["Thirst"];
  const water = commonData.goods["Water"];
  if (thirst && water) {
    const waterEffect = water.consumptionEffects.find(e => e.needId === "Thirst");
    if (waterEffect) {
      const rate = Math.abs(thirst.dailyDelta) / waterEffect.points;
      result.push({
        label: "Water",
        perBeaverPerDay: rate,
        total: beaverCount * rate,
      });
    }
  }

  return result;
}

/**
 * Compute bot needs.
 * Bots have faction-specific needs: Folktails bots need Biofuel, IronTeeth bots need Energy (charging).
 * Bot needs are in the needs data with characterType === "Bot".
 */
export function computeBotNeeds(botCount, commonData, factionData) {
  const needs = commonData.needs;
  const goods = commonData.goods;
  const availableNeeds = factionData.availableNeedIds || [];
  const result = [];

  for (const needId of availableNeeds) {
    const need = needs[needId];
    if (!need || need.characterType !== "Bot") continue;
    if (need.dailyDelta >= 0) continue; // Only consumption needs

    // Find a good that satisfies this need
    let goodId = null;
    let consumptionPoints = 0;
    for (const [gid, good] of Object.entries(goods)) {
      const effect = good.consumptionEffects.find(e => e.needId === needId);
      if (effect) {
        goodId = gid;
        consumptionPoints = effect.points;
        break;
      }
    }

    if (goodId && consumptionPoints > 0) {
      const perBotPerDay = Math.abs(need.dailyDelta) / consumptionPoints;
      result.push({
        needId,
        goodId,
        label: goodId,
        perBotPerDay,
        total: botCount * perBotPerDay,
      });
    } else {
      // Need without a consumable good (e.g., Energy charged at stations)
      result.push({
        needId,
        goodId: null,
        label: needId + " (charging)",
        perBotPerDay: Math.abs(need.dailyDelta),
        total: botCount * Math.abs(need.dailyDelta),
      });
    }
  }

  return result;
}

/**
 * Compute which needs are satisfied by the colony's buildings and production.
 *
 * A need is "satisfied" if:
 *   - A building in the roster lists it in needsCovered, OR
 *   - A good being produced has a consumptionEffect for it
 *
 * Only returns needs that ARE satisfied. Each result includes capacity info
 * so the UI can flag when there aren't enough buildings for the population.
 *
 * Capacity rules:
 *   - Buildings with a capacity field: total = sum(capacity * count)
 *   - Continuous-effect buildings (no capacity): unlimited
 *   - Goods-based satisfaction: unlimited (rate already shown in flows)
 *
 * @param {number} populationCount - beavers or bots to cover
 * @param {string} characterType - "Beaver" or "Bot"
 * @param {string[]} skipNeedIds - need IDs to exclude (e.g. Hunger/Thirst already shown)
 */
export function computeCoveredNeeds(rosterEntries, producedGoodIds, populationCount, characterType, skipNeedIds, commonData, factionData) {
  const availableNeeds = new Set(factionData.availableNeedIds || []);

  // Aggregate per-need capacity from buildings in the roster
  // capacity: number (finite) or Infinity (continuous/unlimited)
  const needCapacity = new Map(); // needId -> total capacity
  for (const entry of rosterEntries) {
    if (entry.type !== "building" || entry.count <= 0) continue;
    const building = factionData.buildings[entry.buildingId];
    if (!building?.needsCovered) continue;
    for (const nc of building.needsCovered) {
      const prev = needCapacity.get(nc.needId) || 0;
      if (nc.capacity != null) {
        needCapacity.set(nc.needId, prev + nc.capacity * entry.count);
      } else {
        needCapacity.set(nc.needId, Infinity);
      }
    }
  }

  // Collect need IDs covered by produced goods (unlimited capacity)
  for (const goodId of producedGoodIds) {
    const good = commonData.goods[goodId];
    if (!good) continue;
    for (const effect of good.consumptionEffects) {
      if (!needCapacity.has(effect.needId)) {
        needCapacity.set(effect.needId, Infinity);
      }
    }
  }

  const skipSet = new Set(skipNeedIds);

  const results = [];
  for (const [needId, need] of Object.entries(commonData.needs)) {
    if (need.characterType !== characterType) continue;
    if (!availableNeeds.has(needId)) continue;
    if (skipSet.has(needId)) continue;
    if (!needCapacity.has(needId)) continue; // Not satisfied — hide
    if (need.dailyDelta >= 0) continue; // Recovers naturally
    if (need.favorableWellbeing <= 0 && need.unfavorableWellbeing >= 0) continue; // No wellbeing impact

    const capacity = needCapacity.get(needId);
    const group = commonData.needGroups[need.needGroupId];
    results.push({
      needId,
      needGroupId: need.needGroupId,
      displayName: need.displayName,
      groupDisplayName: group?.displayName || need.needGroupId,
      groupOrder: group?.order ?? 999,
      favorableWellbeing: need.favorableWellbeing,
      capacity,
      sufficient: capacity >= populationCount,
    });
  }

  results.sort((a, b) => a.groupOrder - b.groupOrder || a.displayName.localeCompare(b.displayName));
  return results;
}

/**
 * Compute per-good storage capacity from production building internal inventories.
 * Each production building buffers CyclesCapacity cycles of inputs/outputs plus FuelCapacity fuel.
 *
 * Returns { totals: Map<goodId, capacity>, breakdown: Map<goodId, [{buildingId, displayName, capacity}]> }
 */
export function computeProductionBuildingStorage(rosterEntries, commonData, factionData) {
  const totals = new Map();
  const breakdown = new Map();

  function add(goodId, buildingId, displayName, cap) {
    totals.set(goodId, (totals.get(goodId) || 0) + cap);
    if (!breakdown.has(goodId)) breakdown.set(goodId, []);
    breakdown.get(goodId).push({ buildingId, displayName, capacity: cap });
  }

  for (const entry of rosterEntries) {
    if (entry.type !== "building" || entry.count <= 0 || !entry.recipeId) continue;
    const building = factionData.buildings[entry.buildingId];
    if (!building) continue;
    const recipe = commonData.recipes[entry.recipeId];
    if (!recipe || !recipe.cyclesCapacity) continue;

    const label = `${building.displayName} \u00d7${entry.count}`;

    // Input storage: cyclesCapacity * ingredient amount per cycle
    for (const ing of recipe.ingredients) {
      add(ing.id, entry.buildingId, label, recipe.cyclesCapacity * ing.amount * entry.count);
    }

    // Output storage: cyclesCapacity * product amount per cycle
    for (const prod of recipe.products) {
      add(prod.id, entry.buildingId, label, recipe.cyclesCapacity * prod.amount * entry.count);
    }

    // Fuel storage
    if (recipe.fuel && recipe.fuelCapacity > 0) {
      add(recipe.fuel, entry.buildingId, label, recipe.fuelCapacity * entry.count);
    }
  }

  return { totals, breakdown };
}

/**
 * Compute total storage capacity from roster buildings.
 * Includes both dedicated storage buildings and production building internal inventories.
 */
export function computeStorageCapacity(rosterEntries, commonData, factionData) {
  let totalBox = 0;
  let totalLiquid = 0;
  let totalPileable = 0;

  // Dedicated storage buildings (warehouses, tanks, piles)
  for (const entry of rosterEntries) {
    const building = factionData.buildings[entry.buildingId];
    if (!building || !building.stockpile || entry.count <= 0) continue;

    const cap = building.stockpile.maxCapacity * entry.count;
    switch (building.stockpile.goodType) {
      case "Box": totalBox += cap; break;
      case "Liquid": totalLiquid += cap; break;
      case "Pileable": totalPileable += cap; break;
    }
  }

  // Production building internal storage
  const { totals: prodStorage } = computeProductionBuildingStorage(rosterEntries, commonData, factionData);
  for (const [goodId, cap] of prodStorage) {
    const good = commonData.goods[goodId];
    if (!good) continue;
    switch (good.goodType) {
      case "Box": totalBox += cap; break;
      case "Liquid": totalLiquid += cap; break;
      case "Pileable": totalPileable += cap; break;
    }
  }

  return { totalBox, totalLiquid, totalPileable };
}

/**
 * Return individual storage slots from the roster.
 * Each storage building instance is one slot that holds a single good type.
 */
export function computeStorageSlots(rosterEntries, factionData) {
  const slots = [];
  for (const entry of rosterEntries) {
    const building = factionData.buildings[entry.buildingId];
    if (!building?.stockpile || entry.count <= 0) continue;
    for (let i = 0; i < entry.count; i++) {
      slots.push({
        goodType: building.stockpile.goodType,
        capacity: building.stockpile.maxCapacity,
      });
    }
  }
  return slots;
}

/**
 * Compute buffer storage needed to smooth production cycles for each good.
 *
 * Buffer = dailyConsumption × longestProductionCycleDays
 *
 * For natural resources the cycle is the growth time (days to weeks).
 * For building recipes the cycle is recipe duration (typically minutes — negligible).
 *
 * @param {Map<string, number>} consumptionByGood - adjusted daily consumption per good
 */
export function computeBufferNeeds(rosterEntries, consumptionByGood, commonData, factionData) {
  const goodCycles = new Map(); // goodId -> longestCycleDays
  const nr = commonData.naturalResources;

  // Natural resource cycles
  for (const entry of rosterEntries) {
    if (entry.type !== "resource" || entry.count <= 0) continue;
    const resource = findResource(entry.resourceId, commonData);
    if (!resource) continue;

    if (nr.bushes[entry.resourceId]) {
      setMax(goodCycles, resource.yield.id, resource.yieldGrowthTimeInDays);
    } else {
      setMax(goodCycles, resource.yield.id, resource.growthTimeInDays);
      if (resource.gatherableYield) {
        setMax(goodCycles, resource.gatherableYield.id, resource.gatherableYield.yieldGrowthTimeInDays);
      }
    }
  }

  // Building recipe cycles
  for (const entry of rosterEntries) {
    if (entry.type !== "building" || entry.count <= 0 || !entry.recipeId) continue;
    const building = factionData.buildings[entry.buildingId];
    if (!building) continue;
    const recipe = commonData.recipes[entry.recipeId];
    if (!recipe) continue;

    const workHours = building.defaultWorkerType === "Bot" ? BOT_WORK_HOURS : BEAVER_WORK_HOURS;
    // Beavers consume food/water in a daily burst, so building-produced goods
    // need at least 1 day of buffer. Use recipe cycle if longer (unlikely).
    const cycleDays = Math.max(1, recipe.cycleDurationInHours / 24);

    for (const p of recipe.products) {
      setMax(goodCycles, p.id, cycleDays);
    }
  }

  const results = [];
  for (const [goodId, cycleDays] of goodCycles) {
    const consumed = consumptionByGood.get(goodId) || 0;
    if (consumed <= 0.01) continue;
    const buffer = consumed * cycleDays;
    if (buffer < 0.5) continue; // Skip negligible buffers
    results.push({ goodId, buffer: Math.ceil(buffer), cycleDays });
  }

  results.sort((a, b) => b.buffer - a.buffer);
  return results;
}

function setMax(map, key, value) {
  map.set(key, Math.max(map.get(key) || 0, value));
}

/**
 * Allocate storage slots to goods needing buffer.
 * Each slot holds one good type. Largest-buffer goods get largest slots first.
 * Production building storage is subtracted from buffer needs before allocating warehouse slots.
 */
export function allocateStorageToBuffers(bufferNeeds, storageSlots, productionStorage, commonData) {
  const byType = {
    Box: { goods: [], slots: [] },
    Liquid: { goods: [], slots: [] },
    Pileable: { goods: [], slots: [] },
  };

  for (const b of bufferNeeds) {
    const prodCap = productionStorage.get(b.goodId) || 0;
    const remaining = Math.max(0, b.buffer - prodCap);
    const good = commonData.goods[b.goodId];
    const type = good?.goodType || "Box";
    if (byType[type]) byType[type].goods.push({ ...b, remaining, productionCapacity: prodCap });
  }

  for (const s of storageSlots) {
    if (byType[s.goodType]) byType[s.goodType].slots.push({ ...s });
  }

  const allocations = [];
  const slotSummary = { Box: { used: 0, total: 0 }, Liquid: { used: 0, total: 0 }, Pileable: { used: 0, total: 0 } };

  for (const type of ["Box", "Liquid", "Pileable"]) {
    const { goods, slots } = byType[type];
    goods.sort((a, b) => b.remaining - a.remaining);
    slots.sort((a, b) => b.capacity - a.capacity);
    slotSummary[type].total = slots.length;

    let slotIdx = 0;
    for (const g of goods) {
      let allocated = 0;
      let slotsUsed = 0;
      while (allocated < g.remaining && slotIdx < slots.length) {
        allocated += slots[slotIdx].capacity;
        slotIdx++;
        slotsUsed++;
      }
      slotSummary[type].used += slotsUsed;
      allocations.push({
        goodId: g.goodId,
        goodType: type,
        bufferNeeded: g.buffer,
        productionCapacity: g.productionCapacity,
        capacityAllocated: g.productionCapacity + allocated,
        slotsUsed,
        covered: g.productionCapacity + allocated >= g.buffer,
      });
    }
  }

  return { allocations, slotSummary };
}

/**
 * Find a natural resource by ID across all categories.
 */
export function findResource(resourceId, commonData) {
  const nr = commonData.naturalResources;
  return nr.crops[resourceId] || nr.trees[resourceId] || nr.bushes[resourceId] || null;
}

/**
 * Return the resource kind: "tree", "bush", "crop", or null.
 */
export function getResourceKind(resourceId, commonData) {
  const nr = commonData.naturalResources;
  if (nr.trees[resourceId]) return "tree";
  if (nr.bushes[resourceId]) return "bush";
  if (nr.crops[resourceId]) return "crop";
  return null;
}

/**
 * Compute yield rates for natural resource tiles (raw growth rate, no productivity).
 * Returns [{ goodId, perDay }].
 *
 * Actual output is capped by harvester worker capacity — see computeHarvesterEfficiency.
 */
export function computeResourceYield(resourceId, tileCount, commonData) {
  const resource = findResource(resourceId, commonData);
  if (!resource) return [];

  const results = [];
  const nr = commonData.naturalResources;

  if (nr.bushes[resourceId]) {
    const perDay = resource.yield.amount / resource.yieldGrowthTimeInDays;
    results.push({ goodId: resource.yield.id, perDay: perDay * tileCount });
  } else {
    const perDay = resource.yield.amount / resource.growthTimeInDays;
    results.push({ goodId: resource.yield.id, perDay: perDay * tileCount });

    if (resource.gatherableYield) {
      const gy = resource.gatherableYield;
      const gPerDay = gy.amount / gy.yieldGrowthTimeInDays;
      results.push({ goodId: gy.id, perDay: gPerDay * tileCount });
    }
  }

  return results;
}

/**
 * Which building IDs are harvesters for each resource kind.
 */
function getHarvesterKind(buildingId) {
  if (buildingId.startsWith("LumberjackFlag")) return "tree";
  if (buildingId.startsWith("GathererFlag")) return "bush";
  if (buildingId.startsWith("FarmHouse") ||
      buildingId.startsWith("EfficientFarmHouse") ||
      buildingId.startsWith("AquaticFarmhouse")) return "crop";
  return null;
}

/**
 * Compute harvester efficiency per resource kind (tree/bush/crop).
 *
 * Returns { tree: ratio, bush: ratio, crop: ratio } where ratio is 0–1.
 * 1.0 = enough harvesters for all tiles, <1.0 = workers can't keep up.
 *
 * Each resource tile needs periodic worker attention:
 *   work per tile per day = (gatherTime [+ plantTime]) / cycleDays
 * Total work needed vs total worker-hours available determines the ratio.
 */
export function computeHarvesterEfficiency(rosterEntries, commonData, factionData, productivity) {
  const nr = commonData.naturalResources;

  // Sum daily work-hours needed per kind, and total tiles
  const workNeeded = { tree: 0, bush: 0, crop: 0 };
  const tiles = { tree: 0, bush: 0, crop: 0 };
  for (const entry of rosterEntries) {
    if (entry.type !== "resource" || entry.count <= 0) continue;
    const resource = findResource(entry.resourceId, commonData);
    if (!resource) continue;

    const kind = getResourceKind(entry.resourceId, commonData);
    if (!kind) continue;

    tiles[kind] += entry.count;

    let workPerTile, cycleDays;
    if (kind === "bush") {
      workPerTile = resource.gatherTimeInHours || 0;
      cycleDays = resource.yieldGrowthTimeInDays;
    } else {
      workPerTile = (resource.gatherTimeInHours || 0) + (resource.plantTimeInHours || 0);
      cycleDays = resource.growthTimeInDays;
    }

    if (cycleDays > 0) {
      workNeeded[kind] += entry.count * workPerTile / cycleDays;
    }
  }

  // Sum available worker-hours per kind
  const workAvailable = { tree: 0, bush: 0, crop: 0 };
  for (const entry of rosterEntries) {
    if (entry.type !== "building" || entry.count <= 0) continue;
    const building = factionData.buildings[entry.buildingId];
    if (!building) continue;

    const kind = getHarvesterKind(entry.buildingId);
    if (!kind) continue;

    const workHours = building.defaultWorkerType === "Bot" ? BOT_WORK_HOURS : BEAVER_WORK_HOURS;
    workAvailable[kind] += building.maxWorkers * entry.count * workHours * productivity;
  }

  const result = {};
  for (const kind of ["tree", "bush", "crop"]) {
    const eff = workNeeded[kind] > 0 ? Math.min(1, workAvailable[kind] / workNeeded[kind]) : 1;
    // Max tiles = current tiles scaled by efficiency headroom
    const maxTiles = workNeeded[kind] > 0
      ? Math.floor(tiles[kind] * workAvailable[kind] / workNeeded[kind])
      : (workAvailable[kind] > 0 ? Infinity : 0);
    result[kind] = { efficiency: eff, tiles: tiles[kind], maxTiles };
  }
  return result;
}
