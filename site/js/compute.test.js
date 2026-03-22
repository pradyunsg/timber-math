import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeBuildingRates,
  computeColonyFlows,
  computePowerBalance,
  computeWorkerBalance,
  computePopulationNeeds,
  computeBotNeeds,
  computeStorageCapacity,
  findResource,
  computeResourceYield,
} from "./compute.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeRecipe(overrides = {}) {
  return {
    id: "TestRecipe",
    displayName: "Test Recipe",
    cycleDurationInHours: 4,
    ingredients: [{ id: "Wheat", amount: 2 }],
    products: [{ id: "Bread", amount: 1 }],
    producedSciencePoints: 0,
    fuel: null,
    cyclesFuelLasts: 0,
    cyclesCapacity: 0,
    fuelCapacity: 0,
    ...overrides,
  };
}

function makeBuilding(overrides = {}) {
  return {
    id: "TestBuilding",
    displayName: "Test Building",
    maxWorkers: 2,
    defaultWorkerType: "Beaver",
    allowsBotWorkers: false,
    recipeIds: ["TestRecipe"],
    powerInput: 0,
    powerOutput: 0,
    ...overrides,
  };
}

function makeCommonData(overrides = {}) {
  return {
    goods: {
      Water: {
        id: "Water",
        displayName: "Water",
        goodGroupId: "Liquid",
        goodType: "Liquid",
        weight: 1,
        consumptionEffects: [{ needId: "Thirst", points: 0.5 }],
      },
      Wheat: {
        id: "Wheat",
        displayName: "Wheat",
        goodGroupId: "Food",
        goodType: "Box",
        weight: 1,
        consumptionEffects: [],
      },
      Bread: {
        id: "Bread",
        displayName: "Bread",
        goodGroupId: "Food",
        goodType: "Box",
        weight: 1,
        consumptionEffects: [{ needId: "Hunger", points: 0.3 }],
      },
      Log: {
        id: "Log",
        displayName: "Log",
        goodGroupId: "Material",
        goodType: "Pileable",
        weight: 1,
        consumptionEffects: [],
      },
      Biofuel: {
        id: "Biofuel",
        displayName: "Biofuel",
        goodGroupId: "Material",
        goodType: "Box",
        weight: 1,
        consumptionEffects: [{ needId: "BotFuel", points: 0.3 }],
      },
      Carrot: {
        id: "Carrot",
        displayName: "Carrot",
        goodGroupId: "Food",
        goodType: "Box",
        weight: 1,
        consumptionEffects: [{ needId: "Hunger", points: 0.3 }],
      },
      Berries: {
        id: "Berries",
        displayName: "Berries",
        goodGroupId: "Food",
        goodType: "Box",
        weight: 1,
        consumptionEffects: [{ needId: "Hunger", points: 0.3 }],
      },
      Chestnut: {
        id: "Chestnut",
        displayName: "Chestnut",
        goodGroupId: "Food",
        goodType: "Box",
        weight: 1,
        consumptionEffects: [{ needId: "Hunger", points: 0.3 }],
      },
    },
    recipes: {
      BreadRecipe: makeRecipe({ id: "BreadRecipe" }),
    },
    needs: {
      Hunger: {
        id: "Hunger",
        displayName: "Hunger",
        needGroupId: "Sustenance",
        characterType: "Beaver",
        dailyDelta: -0.8,
        min: 0,
        max: 1,
        isLethal: true,
      },
      Thirst: {
        id: "Thirst",
        displayName: "Thirst",
        needGroupId: "Sustenance",
        characterType: "Beaver",
        dailyDelta: -0.7,
        min: 0,
        max: 1,
        isLethal: true,
      },
      BotFuel: {
        id: "BotFuel",
        displayName: "Bot Fuel",
        needGroupId: "BotNeeds",
        characterType: "Bot",
        dailyDelta: -0.6,
        min: 0,
        max: 1,
        isLethal: false,
      },
      BotEnergy: {
        id: "BotEnergy",
        displayName: "Bot Energy",
        needGroupId: "BotNeeds",
        characterType: "Bot",
        dailyDelta: -0.5,
        min: 0,
        max: 1,
        isLethal: false,
      },
    },
    needGroups: {},
    goodGroups: {},
    naturalResources: {
      crops: {
        Carrot: {
          id: "Carrot",
          displayName: "Carrot",
          growthTimeInDays: 4,
          yield: { id: "Carrot", amount: 3 },
        },
      },
      trees: {
        Oak: {
          id: "Oak",
          displayName: "Oak",
          growthTimeInDays: 30,
          yield: { id: "Log", amount: 8 },
        },
        ChestnutTree: {
          id: "ChestnutTree",
          displayName: "Chestnut Tree",
          growthTimeInDays: 23,
          yield: { id: "Log", amount: 4 },
          gatherableYield: {
            id: "Chestnut",
            amount: 3,
            yieldGrowthTimeInDays: 8,
          },
        },
      },
      bushes: {
        BlueberryBush: {
          id: "BlueberryBush",
          displayName: "Blueberry Bush",
          growthTimeInDays: 12,
          yield: { id: "Berries", amount: 3 },
          yieldGrowthTimeInDays: 12,
        },
      },
    },
    ...overrides,
  };
}

function makeFactionData(overrides = {}) {
  return {
    factionId: "Folktails",
    displayName: "Folktails",
    availableGoodIds: ["Water", "Wheat", "Bread", "Log", "Biofuel"],
    availableNeedIds: ["Hunger", "Thirst", "BotFuel"],
    buildings: {
      Bakery: makeBuilding({
        id: "Bakery",
        displayName: "Bakery",
        recipeIds: ["BreadRecipe"],
        powerInput: 50,
      }),
      PowerWheel: makeBuilding({
        id: "PowerWheel",
        displayName: "Power Wheel",
        recipeIds: [],
        powerOutput: 50,
        maxWorkers: 1,
      }),
      Warehouse: makeBuilding({
        id: "Warehouse",
        displayName: "Warehouse",
        recipeIds: [],
        maxWorkers: 0,
        stockpile: { maxCapacity: 200, goodType: "Box" },
      }),
      Tank: makeBuilding({
        id: "Tank",
        displayName: "Tank",
        recipeIds: [],
        maxWorkers: 0,
        stockpile: { maxCapacity: 100, goodType: "Liquid" },
      }),
      LogPile: makeBuilding({
        id: "LogPile",
        displayName: "Log Pile",
        recipeIds: [],
        maxWorkers: 0,
        stockpile: { maxCapacity: 150, goodType: "Pileable" },
      }),
      BotWorkshop: makeBuilding({
        id: "BotWorkshop",
        displayName: "Bot Workshop",
        defaultWorkerType: "Bot",
        maxWorkers: 3,
      }),
      Agora: makeBuilding({
        id: "Agora",
        displayName: "Agora",
        recipeIds: [],
        maxWorkers: 0,
        consumedGoods: [{ goodId: "Bread", goodPerHour: 0.5 }],
      }),
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeBuildingRates
// ---------------------------------------------------------------------------

describe("computeBuildingRates", () => {
  it("returns empty for null recipe", () => {
    const result = computeBuildingRates(null, makeBuilding(), 1);
    assert.deepEqual(result, { production: [], consumption: [] });
  });

  it("returns empty for count <= 0", () => {
    const result = computeBuildingRates(makeRecipe(), makeBuilding(), 0);
    assert.deepEqual(result, { production: [], consumption: [] });
  });

  it("computes rates for beaver workers (16h workday)", () => {
    const recipe = makeRecipe({
      cycleDurationInHours: 4,
      products: [{ id: "Bread", amount: 1 }],
      ingredients: [{ id: "Wheat", amount: 2 }],
    });
    const building = makeBuilding({ defaultWorkerType: "Beaver" });
    const result = computeBuildingRates(recipe, building, 1);

    // 16h / 4h = 4 cycles/day
    assert.equal(result.production.length, 1);
    assert.equal(result.production[0].goodId, "Bread");
    assert.equal(result.production[0].perDay, 4); // 1 * 4

    assert.equal(result.consumption.length, 1);
    assert.equal(result.consumption[0].goodId, "Wheat");
    assert.equal(result.consumption[0].perDay, 8); // 2 * 4
  });

  it("computes rates for bot workers (24h workday)", () => {
    const recipe = makeRecipe({ cycleDurationInHours: 8 });
    const building = makeBuilding({ defaultWorkerType: "Bot" });
    const result = computeBuildingRates(recipe, building, 1);

    // 24h / 8h = 3 cycles/day
    assert.equal(result.production[0].perDay, 3); // 1 * 3
    assert.equal(result.consumption[0].perDay, 6); // 2 * 3
  });

  it("multiplies by building count", () => {
    const recipe = makeRecipe({ cycleDurationInHours: 4 });
    const building = makeBuilding({ defaultWorkerType: "Beaver" });
    const result = computeBuildingRates(recipe, building, 3);

    // 4 cycles/day * 3 buildings
    assert.equal(result.production[0].perDay, 12); // 1 * 4 * 3
    assert.equal(result.consumption[0].perDay, 24); // 2 * 4 * 3
  });

  it("includes fuel consumption", () => {
    const recipe = makeRecipe({
      fuel: "Log",
      cyclesFuelLasts: 2,
      cycleDurationInHours: 4,
    });
    const building = makeBuilding();
    const result = computeBuildingRates(recipe, building, 1);

    // 4 cycles/day, fuel lasts 2 cycles -> 2 fuel/day
    const fuelConsumption = result.consumption.find(c => c.goodId === "Log");
    assert.ok(fuelConsumption);
    assert.equal(fuelConsumption.perDay, 2);
  });

  it("includes science production", () => {
    const recipe = makeRecipe({
      producedSciencePoints: 5,
      cycleDurationInHours: 4,
    });
    const building = makeBuilding();
    const result = computeBuildingRates(recipe, building, 1);

    // 4 cycles/day * 5 science = 20/day
    const science = result.production.find(p => p.goodId === "__science__");
    assert.ok(science);
    assert.equal(science.perDay, 20);
  });

  it("does not include fuel when cyclesFuelLasts is 0", () => {
    const recipe = makeRecipe({ fuel: "Log", cyclesFuelLasts: 0 });
    const result = computeBuildingRates(recipe, makeBuilding(), 1);
    const fuelConsumption = result.consumption.find(c => c.goodId === "Log");
    assert.equal(fuelConsumption, undefined);
  });
});

// ---------------------------------------------------------------------------
// findResource
// ---------------------------------------------------------------------------

describe("findResource", () => {
  const common = makeCommonData();

  it("finds crops", () => {
    assert.equal(findResource("Carrot", common).id, "Carrot");
  });

  it("finds trees", () => {
    assert.equal(findResource("Oak", common).id, "Oak");
  });

  it("finds bushes", () => {
    assert.equal(findResource("BlueberryBush", common).id, "BlueberryBush");
  });

  it("returns null for unknown resource", () => {
    assert.equal(findResource("Nonexistent", common), null);
  });
});

// ---------------------------------------------------------------------------
// computeResourceYield
// ---------------------------------------------------------------------------

describe("computeResourceYield", () => {
  const common = makeCommonData();

  it("returns empty for unknown resource", () => {
    assert.deepEqual(computeResourceYield("Nonexistent", 10, common), []);
  });

  it("computes crop yield (cut-and-replant)", () => {
    // Carrot: 3 yield / 4 days = 0.75/tile/day
    const yields = computeResourceYield("Carrot", 10, common);
    assert.equal(yields.length, 1);
    assert.equal(yields[0].goodId, "Carrot");
    assert.closeTo(yields[0].perDay, 7.5, 0.001); // 0.75 * 10
  });

  it("computes tree yield (cut-and-replant)", () => {
    // Oak: 8 log / 30 days = 0.2667/tile/day
    const yields = computeResourceYield("Oak", 30, common);
    assert.equal(yields.length, 1);
    assert.equal(yields[0].goodId, "Log");
    assert.closeTo(yields[0].perDay, 8, 0.001); // 8/30 * 30
  });

  it("computes tree with gatherable secondary yield", () => {
    // ChestnutTree: 4 log / 23 days + 3 chestnut / 8 days
    const yields = computeResourceYield("ChestnutTree", 1, common);
    assert.equal(yields.length, 2);
    assert.equal(yields[0].goodId, "Log");
    assert.closeTo(yields[0].perDay, 4 / 23, 0.001);
    assert.equal(yields[1].goodId, "Chestnut");
    assert.closeTo(yields[1].perDay, 3 / 8, 0.001);
  });

  it("computes bush yield (renewable gather)", () => {
    // BlueberryBush: 3 berries / 12 days
    const yields = computeResourceYield("BlueberryBush", 5, common);
    assert.equal(yields.length, 1);
    assert.equal(yields[0].goodId, "Berries");
    assert.closeTo(yields[0].perDay, (3 / 12) * 5, 0.001); // 1.25
  });

  it("scales linearly with tile count", () => {
    const y1 = computeResourceYield("Carrot", 1, common);
    const y10 = computeResourceYield("Carrot", 10, common);
    assert.closeTo(y10[0].perDay, y1[0].perDay * 10, 0.001);
  });
});

// ---------------------------------------------------------------------------
// computePowerBalance
// ---------------------------------------------------------------------------

describe("computePowerBalance", () => {
  const faction = makeFactionData();

  it("returns zeros for empty roster", () => {
    const result = computePowerBalance([], faction);
    assert.deepEqual(result, { demand: 0, supply: 0, net: 0 });
  });

  it("sums power demand and supply", () => {
    const entries = [
      { type: "building", buildingId: "Bakery", recipeId: "BreadRecipe", count: 2 },
      { type: "building", buildingId: "PowerWheel", recipeId: null, count: 3 },
    ];
    const result = computePowerBalance(entries, faction);
    assert.equal(result.demand, 100); // 50 * 2
    assert.equal(result.supply, 150); // 50 * 3
    assert.equal(result.net, 50);
  });

  it("skips entries with count 0", () => {
    const entries = [
      { type: "building", buildingId: "Bakery", recipeId: "BreadRecipe", count: 0 },
    ];
    const result = computePowerBalance(entries, faction);
    assert.equal(result.demand, 0);
  });

  it("skips unknown buildings", () => {
    const entries = [
      { type: "building", buildingId: "Unknown", recipeId: null, count: 1 },
    ];
    const result = computePowerBalance(entries, faction);
    assert.equal(result.demand, 0);
  });
});

// ---------------------------------------------------------------------------
// computeWorkerBalance
// ---------------------------------------------------------------------------

describe("computeWorkerBalance", () => {
  const faction = makeFactionData();

  it("returns available counts for empty roster", () => {
    const result = computeWorkerBalance([], 30, 5, faction);
    assert.deepEqual(result, {
      beaverUsed: 0,
      beaverAvailable: 30,
      botUsed: 0,
      botAvailable: 5,
    });
  });

  it("separates beaver and bot workers", () => {
    const entries = [
      { type: "building", buildingId: "Bakery", recipeId: "BreadRecipe", count: 2 },
      { type: "building", buildingId: "BotWorkshop", recipeId: null, count: 1 },
    ];
    const result = computeWorkerBalance(entries, 30, 5, faction);
    assert.equal(result.beaverUsed, 4); // 2 workers * 2 bakeries
    assert.equal(result.botUsed, 3); // 3 workers * 1 bot workshop
  });

  it("multiplies workers by count", () => {
    const entries = [
      { type: "building", buildingId: "PowerWheel", recipeId: null, count: 5 },
    ];
    const result = computeWorkerBalance(entries, 10, 0, faction);
    assert.equal(result.beaverUsed, 5); // 1 worker * 5
  });
});

// ---------------------------------------------------------------------------
// computeStorageCapacity
// ---------------------------------------------------------------------------

describe("computeStorageCapacity", () => {
  const common = makeCommonData();
  const faction = makeFactionData();

  it("returns zeros for empty roster", () => {
    const result = computeStorageCapacity([], common, faction);
    assert.deepEqual(result, { totalBox: 0, totalLiquid: 0, totalPileable: 0 });
  });

  it("sums storage by type", () => {
    const entries = [
      { type: "building", buildingId: "Warehouse", count: 2 },
      { type: "building", buildingId: "Tank", count: 3 },
      { type: "building", buildingId: "LogPile", count: 1 },
    ];
    const result = computeStorageCapacity(entries, common, faction);
    assert.equal(result.totalBox, 400); // 200 * 2
    assert.equal(result.totalLiquid, 300); // 100 * 3
    assert.equal(result.totalPileable, 150); // 150 * 1
  });

  it("skips buildings without stockpile", () => {
    const entries = [
      { type: "building", buildingId: "Bakery", count: 5 },
    ];
    const result = computeStorageCapacity(entries, common, faction);
    assert.deepEqual(result, { totalBox: 0, totalLiquid: 0, totalPileable: 0 });
  });

  it("skips entries with count 0", () => {
    const entries = [
      { type: "building", buildingId: "Warehouse", count: 0 },
    ];
    const result = computeStorageCapacity(entries, common, faction);
    assert.equal(result.totalBox, 0);
  });

  it("includes production building storage", () => {
    const recipeWithCapacity = makeRecipe({
      id: "BreadProd",
      ingredients: [{ id: "Wheat", amount: 2 }],
      products: [{ id: "Bread", amount: 5 }],
      cyclesCapacity: 10,
      fuel: "Log",
      fuelCapacity: 3,
    });
    const customCommon = makeCommonData({
      recipes: { BreadProd: recipeWithCapacity },
    });
    const customFaction = makeFactionData({
      buildings: {
        ...faction.buildings,
        ProdBuilding: makeBuilding({ id: "ProdBuilding", recipeIds: ["BreadProd"] }),
      },
    });
    const entries = [
      { type: "building", buildingId: "ProdBuilding", recipeId: "BreadProd", count: 2 },
    ];
    const result = computeStorageCapacity(entries, customCommon, customFaction);
    // Wheat: 10 * 2 * 2 = 40 (Box), Bread: 10 * 5 * 2 = 100 (Box), Log fuel: 3 * 2 = 6 (Pileable)
    assert.equal(result.totalBox, 140);
    assert.equal(result.totalPileable, 6);
  });
});

// ---------------------------------------------------------------------------
// computePopulationNeeds
// ---------------------------------------------------------------------------

describe("computePopulationNeeds", () => {
  const common = makeCommonData();

  it("returns empty for 0 beavers", () => {
    const result = computePopulationNeeds(0, common);
    // Hunger and Thirst both need beaverCount > 0 in the formula,
    // but the function doesn't guard on beaverCount — it always returns entries.
    // total will be 0 though.
    for (const need of result) {
      assert.equal(need.total, 0);
    }
  });

  it("computes food need from Hunger", () => {
    const result = computePopulationNeeds(10, common);
    const food = result.find(r => r.label === "Food");
    assert.ok(food);
    // |dailyDelta| / 0.3 = 0.8 / 0.3 ≈ 2.667 per beaver
    assert.closeTo(food.perBeaverPerDay, 0.8 / 0.3, 0.001);
    assert.closeTo(food.total, 10 * 0.8 / 0.3, 0.001);
  });

  it("computes water need from Thirst", () => {
    const result = computePopulationNeeds(10, common);
    const water = result.find(r => r.label === "Water");
    assert.ok(water);
    // |dailyDelta| / consumptionPoints = 0.7 / 0.5 = 1.4 per beaver
    assert.closeTo(water.perBeaverPerDay, 1.4, 0.001);
    assert.closeTo(water.total, 14, 0.001);
  });
});

// ---------------------------------------------------------------------------
// computeBotNeeds
// ---------------------------------------------------------------------------

describe("computeBotNeeds", () => {
  const common = makeCommonData();

  it("returns empty for 0 bots", () => {
    const faction = makeFactionData();
    const result = computeBotNeeds(0, common, faction);
    for (const need of result) {
      assert.equal(need.total, 0);
    }
  });

  it("finds consumable good for bot need", () => {
    // BotFuel need: dailyDelta=-0.6, satisfied by Biofuel (0.3 points)
    const faction = makeFactionData({ availableNeedIds: ["BotFuel"] });
    const result = computeBotNeeds(5, common, faction);
    const fuel = result.find(r => r.needId === "BotFuel");
    assert.ok(fuel);
    assert.equal(fuel.goodId, "Biofuel");
    assert.closeTo(fuel.perBotPerDay, 0.6 / 0.3, 0.001); // 2
    assert.closeTo(fuel.total, 10, 0.001); // 5 * 2
  });

  it("handles needs without consumable goods (charging)", () => {
    // BotEnergy: no good satisfies it
    const faction = makeFactionData({ availableNeedIds: ["BotEnergy"] });
    const result = computeBotNeeds(3, common, faction);
    const energy = result.find(r => r.needId === "BotEnergy");
    assert.ok(energy);
    assert.equal(energy.goodId, null);
    assert.ok(energy.label.includes("charging"));
    assert.closeTo(energy.perBotPerDay, 0.5, 0.001);
    assert.closeTo(energy.total, 1.5, 0.001);
  });

  it("skips non-Bot needs", () => {
    // Hunger is a Beaver need, should be skipped
    const faction = makeFactionData({ availableNeedIds: ["Hunger", "BotFuel"] });
    const result = computeBotNeeds(1, common, faction);
    assert.ok(!result.find(r => r.needId === "Hunger"));
    assert.ok(result.find(r => r.needId === "BotFuel"));
  });
});

// ---------------------------------------------------------------------------
// computeColonyFlows
// ---------------------------------------------------------------------------

describe("computeColonyFlows", () => {
  const common = makeCommonData();
  const faction = makeFactionData();

  it("returns empty for empty roster and 0 population", () => {
    const flows = computeColonyFlows([], 0, 0, common, faction);
    assert.equal(flows.length, 0);
  });

  it("computes building production and consumption", () => {
    const entries = [
      { type: "building", buildingId: "Bakery", recipeId: "BreadRecipe", count: 1 },
    ];
    const flows = computeColonyFlows(entries, 0, 0, common, faction);
    const bread = flows.find(f => f.goodId === "Bread");
    const wheat = flows.find(f => f.goodId === "Wheat");

    assert.ok(bread);
    assert.ok(wheat);
    // 16h / 4h = 4 cycles/day
    assert.closeTo(bread.produced, 4, 0.001);
    assert.closeTo(wheat.consumed, 8, 0.001);
  });

  it("computes resource tile production", () => {
    const entries = [
      { type: "resource", resourceId: "Carrot", count: 10 },
    ];
    const flows = computeColonyFlows(entries, 0, 0, common, faction);
    const carrot = flows.find(f => f.goodId === "Carrot");
    assert.ok(carrot);
    assert.closeTo(carrot.produced, 7.5, 0.001); // 3/4 * 10
    assert.equal(carrot.consumed, 0);
  });

  it("includes beaver water consumption", () => {
    const flows = computeColonyFlows([], 10, 0, common, faction);
    const water = flows.find(f => f.goodId === "Water");
    assert.ok(water);
    // 0.7 / 0.5 = 1.4/beaver/day * 10 = 14
    assert.closeTo(water.consumed, 14, 0.001);
    assert.closeTo(water.net, -14, 0.001);
  });

  it("includes beaver food consumption as __food__", () => {
    const flows = computeColonyFlows([], 10, 0, common, faction);
    const food = flows.find(f => f.goodId === "__food__");
    assert.ok(food);
    // 0.8 / 0.3 ≈ 2.667/beaver * 10 ≈ 26.67
    assert.closeTo(food.consumed, 10 * 0.8 / 0.3, 0.01);
  });

  it("includes bot needs in consumption", () => {
    const flows = computeColonyFlows([], 0, 5, common, faction);
    const biofuel = flows.find(f => f.goodId === "Biofuel");
    assert.ok(biofuel);
    assert.closeTo(biofuel.consumed, 5 * 0.6 / 0.3, 0.01); // 10
  });

  it("includes passive building consumption", () => {
    const entries = [
      { type: "building", buildingId: "Agora", recipeId: null, count: 2 },
    ];
    const flows = computeColonyFlows(entries, 0, 0, common, faction);
    const bread = flows.find(f => f.goodId === "Bread");
    assert.ok(bread);
    // 0.5/hour * 24h * 2 buildings = 24/day
    assert.closeTo(bread.consumed, 24, 0.001);
  });

  it("sorts deficits first", () => {
    const entries = [
      { type: "building", buildingId: "Bakery", recipeId: "BreadRecipe", count: 1 },
    ];
    const flows = computeColonyFlows(entries, 0, 0, common, faction);
    // Wheat is consumed (deficit), Bread is produced (surplus)
    const wheatIdx = flows.findIndex(f => f.goodId === "Wheat");
    const breadIdx = flows.findIndex(f => f.goodId === "Bread");
    assert.ok(wheatIdx < breadIdx, "Deficits should come before surpluses");
  });

  it("skips entries with count 0", () => {
    const entries = [
      { type: "building", buildingId: "Bakery", recipeId: "BreadRecipe", count: 0 },
      { type: "resource", resourceId: "Carrot", count: 0 },
    ];
    const flows = computeColonyFlows(entries, 0, 0, common, faction);
    assert.equal(flows.length, 0);
  });

  it("aggregates multiple sources of the same good", () => {
    const entries = [
      { type: "resource", resourceId: "Oak", count: 30 },
      { type: "resource", resourceId: "ChestnutTree", count: 10 },
    ];
    const flows = computeColonyFlows(entries, 0, 0, common, faction);
    const log = flows.find(f => f.goodId === "Log");
    assert.ok(log);
    // Oak: 8/30 * 30 = 8, ChestnutTree: 4/23 * 10 ≈ 1.739
    assert.closeTo(log.produced, 8 + 4 / 23 * 10, 0.01);
  });

  it("handles combined building and resource production", () => {
    const entries = [
      { type: "building", buildingId: "Bakery", recipeId: "BreadRecipe", count: 1 },
      { type: "resource", resourceId: "Carrot", count: 10 },
    ];
    const flows = computeColonyFlows(entries, 10, 0, common, faction);

    // Bread from bakery
    const bread = flows.find(f => f.goodId === "Bread");
    assert.ok(bread);
    assert.closeTo(bread.produced, 4, 0.001);

    // Carrots from tiles
    const carrot = flows.find(f => f.goodId === "Carrot");
    assert.ok(carrot);
    assert.closeTo(carrot.produced, 7.5, 0.001);

    // Water consumed by beavers
    const water = flows.find(f => f.goodId === "Water");
    assert.ok(water);
    assert.closeTo(water.consumed, 14, 0.001);
  });
});

// ---------------------------------------------------------------------------
// Helper: assert.closeTo
// ---------------------------------------------------------------------------

// Patch assert to add closeTo if not present
if (!assert.closeTo) {
  assert.closeTo = (actual, expected, tolerance, message) => {
    const diff = Math.abs(actual - expected);
    if (diff > tolerance) {
      assert.fail(
        message || `Expected ${actual} to be close to ${expected} (tolerance: ${tolerance}, diff: ${diff})`
      );
    }
  };
}
