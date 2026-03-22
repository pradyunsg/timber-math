// Minimal reactive signal system

export function createSignal(initial) {
  let value = initial;
  const subscribers = new Set();
  return {
    get() { return value; },
    set(next, meta) {
      value = next;
      for (const fn of subscribers) fn(value, meta);
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}

// Colony state
export const factionId = createSignal("Folktails");
export const beaverCount = createSignal(12);
export const botCount = createSignal(0);

// Roster entries. Two kinds:
//   { type: "building", buildingId, recipeId, count }
//   { type: "resource", resourceId, count }  (count = number of tiles)
export const roster = createSignal([
  { type: "resource", resourceId: "BlueberryBush", count: 130 },
  { type: "building", buildingId: "GathererFlag.Folktails", recipeId: null, count: 1 },
  { type: "building", buildingId: "WaterPump.Folktails", recipeId: "Water", count: 1 },
  { type: "building", buildingId: "MediumWarehouse.Folktails", recipeId: null, count: 2 },
  { type: "building", buildingId: "MediumTank.Folktails", recipeId: null, count: 1 },
]);

// Drought planning: how many days of drought to plan for
export const droughtDays = createSignal(9);

// Temperate season length (days available to fill stockpiles)
export const temperateDays = createSignal(13);

// Building productivity: fraction of max output (0-1)
export const productivity = createSignal(0.8);

// Helpers
export function addBuilding(buildingId, recipeId) {
  const current = roster.get();
  roster.set([...current, { type: "building", buildingId, recipeId, count: 1 }]);
}

export function addResource(resourceId) {
  const current = roster.get();
  roster.set([...current, { type: "resource", resourceId, count: 10 }]);
}

export function updateRosterEntry(index, updates, meta) {
  const current = [...roster.get()];
  current[index] = { ...current[index], ...updates };
  roster.set(current, meta);
}

export function removeFromRoster(index) {
  const current = [...roster.get()];
  current.splice(index, 1);
  roster.set(current);
}
