#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = ["click"]
# ///
"""Build site data JSON files from extracted Timberborn game data."""

import csv
import json
import sys
from pathlib import Path

import click


def load_english_strings(localizations_dir: Path) -> dict[str, str]:
    """Load the English localization CSV into {key: text} dict."""
    csv_path = localizations_dir / "enUS.csv"
    strings: dict[str, str] = {}
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader)  # skip header: ID,Text,Comment
        for row in reader:
            if len(row) >= 2:
                strings[row[0]] = row[1]
    return strings


def load_blueprint(path: Path) -> dict:
    """Load a single blueprint JSON file."""
    with open(path, encoding="utf-8-sig") as f:
        return json.load(f)


def load_all_blueprints(directory: Path, pattern: str) -> list[dict]:
    """Load all blueprint JSON files matching a glob pattern."""
    results = []
    for path in sorted(directory.glob(pattern)):
        results.append(load_blueprint(path))
    return results


def resolve(loc_key: str, strings: dict[str, str]) -> str:
    """Resolve a localization key to its English text, falling back to the key."""
    return strings.get(loc_key, loc_key) if loc_key else ""


def extract_goods(blueprints_dir: Path, strings: dict[str, str]) -> dict:
    """Extract all goods."""
    goods = {}
    for bp in load_all_blueprints(blueprints_dir / "Goods", "*.blueprint.json"):
        spec = bp["GoodSpec"]
        goods[spec["Id"]] = {
            "id": spec["Id"],
            "displayName": resolve(spec["DisplayNameLocKey"], strings),
            "pluralDisplayName": resolve(spec["PluralDisplayNameLocKey"], strings),
            "goodGroupId": spec["GoodGroupId"],
            "goodType": spec["GoodType"],
            "weight": spec["Weight"],
            "consumptionEffects": [
                {"needId": e["NeedId"], "points": e["Points"]}
                for e in spec.get("ConsumptionEffects", [])
            ],
        }
    return goods


def extract_good_groups(blueprints_dir: Path, strings: dict[str, str]) -> dict:
    """Extract all good groups."""
    groups = {}
    for bp in load_all_blueprints(
        blueprints_dir / "GoodGroups", "*.blueprint.json"
    ):
        spec = bp["GoodGroupSpec"]
        groups[spec["Id"]] = {
            "id": spec["Id"],
            "displayName": resolve(spec["DisplayNameLocKey"], strings),
            "order": spec["Order"],
        }
    return groups


def extract_recipes(blueprints_dir: Path, strings: dict[str, str]) -> dict:
    """Extract all recipes."""
    recipes = {}
    for bp in load_all_blueprints(blueprints_dir / "Recipes", "*.blueprint.json"):
        spec = bp["RecipeSpec"]
        recipes[spec["Id"]] = {
            "id": spec["Id"],
            "displayName": resolve(spec["DisplayLocKey"], strings),
            "cycleDurationInHours": spec["CycleDurationInHours"],
            "ingredients": [
                {"id": i["Id"], "amount": i["Amount"]}
                for i in spec.get("Ingredients", [])
            ],
            "products": [
                {"id": p["Id"], "amount": p["Amount"]}
                for p in spec.get("Products", [])
            ],
            "producedSciencePoints": spec.get("ProducedSciencePoints", 0),
            "fuel": spec["Fuel"] or None,
            "cyclesFuelLasts": spec.get("CyclesFuelLasts", 0),
            "cyclesCapacity": spec.get("CyclesCapacity", 0),
            "fuelCapacity": spec.get("FuelCapacity", 0),
        }
    return recipes


def extract_needs(blueprints_dir: Path, strings: dict[str, str]) -> dict:
    """Extract all beaver needs."""
    needs = {}
    for bp in load_all_blueprints(blueprints_dir / "Needs", "*.blueprint.json"):
        spec = bp["NeedSpec"]
        needs[spec["Id"]] = {
            "id": spec["Id"],
            "displayName": resolve(spec["DisplayNameLocKey"], strings),
            "needGroupId": spec["NeedGroupId"],
            "characterType": spec["CharacterType"],
            "dailyDelta": spec["DailyDelta"],
            "min": spec["MinimumValue"],
            "max": spec["MaximumValue"],
            "favorableWellbeing": spec.get("FavorableWellbeing", 0),
            "unfavorableWellbeing": spec.get("UnfavorableWellbeing", 0),
            "isLethal": "LethalNeedSpec" in bp,
        }
    return needs


def extract_need_groups(blueprints_dir: Path, strings: dict[str, str]) -> dict:
    """Extract all need groups."""
    groups = {}
    for bp in load_all_blueprints(
        blueprints_dir / "NeedGroups", "*.blueprint.json"
    ):
        spec = bp["NeedGroupSpec"]
        groups[spec["Id"]] = {
            "id": spec["Id"],
            "displayName": resolve(spec["DisplayNameLocKey"], strings),
            "order": spec["Order"],
        }
    return groups


def extract_game_modes(blueprints_dir: Path, strings: dict[str, str]) -> list[dict]:
    """Extract game difficulty modes."""
    modes = []
    for bp in load_all_blueprints(
        blueprints_dir / "NewGameModes", "*.blueprint.json"
    ):
        spec = bp["GameModeSpec"]
        modes.append({
            "id": spec["DisplayNameLocKey"],
            "displayName": resolve(spec["DisplayNameLocKey"], strings),
            "order": spec["Order"],
            "isDefault": spec["IsDefault"],
            "temperateWeatherDuration": spec["TemperateWeatherDuration"],
            "droughtDuration": spec["DroughtDuration"],
            "badtideDuration": spec["BadtideDuration"],
        })
    modes.sort(key=lambda m: m["order"])
    return modes


def extract_building_categories(blueprints_dir: Path, strings: dict[str, str]) -> dict:
    """Extract building tool group categories with ordering."""
    categories = {}
    for bp in load_all_blueprints(
        blueprints_dir / "BlockObjectToolGroups", "BlockObjectToolGroup.*.blueprint.json"
    ):
        spec = bp["BlockObjectToolGroupSpec"]
        categories[spec["Id"]] = {
            "id": spec["Id"],
            "displayName": resolve(spec["NameLocKey"], strings),
            "order": spec["Order"],
        }
    return categories


def extract_natural_resources(blueprints_dir: Path, strings: dict[str, str]) -> dict:
    """Extract crops, trees, and bushes."""
    nr_dir = blueprints_dir / "NaturalResources"
    crops = {}
    trees = {}
    bushes = {}

    # Crops
    for bp in load_all_blueprints(nr_dir / "Crops", "**/*.blueprint.json"):
        name = bp["TemplateSpec"]["TemplateName"]
        yielder = bp["CuttableSpec"]["Yielder"]
        crops[name] = {
            "id": name,
            "displayName": resolve(bp["LabeledEntitySpec"]["DisplayNameLocKey"], strings),
            "growthTimeInDays": bp["GrowableSpec"]["GrowthTimeInDays"],
            "yield": {"id": yielder["Yield"]["Id"], "amount": yielder["Yield"]["Amount"]},
            "harvestTimeInHours": yielder["RemovalTimeInHours"],
            "plantTimeInHours": bp["PlantableSpec"]["PlantTimeInHours"],
            "resourceGroup": bp["PlantableSpec"]["ResourceGroup"],
            "daysToDieDry": bp.get("WateredNaturalResourceSpec", {}).get("DaysToDieDry"),
        }

    # Trees
    for bp in load_all_blueprints(nr_dir / "Trees", "**/*.blueprint.json"):
        name = bp["TemplateSpec"]["TemplateName"]
        yielder = bp["CuttableSpec"]["Yielder"]
        tree = {
            "id": name,
            "displayName": resolve(bp["LabeledEntitySpec"]["DisplayNameLocKey"], strings),
            "growthTimeInDays": bp["GrowableSpec"]["GrowthTimeInDays"],
            "yield": {"id": yielder["Yield"]["Id"], "amount": yielder["Yield"]["Amount"]},
            "harvestTimeInHours": yielder["RemovalTimeInHours"],
            "plantTimeInHours": bp["PlantableSpec"]["PlantTimeInHours"],
            "resourceGroup": yielder["ResourceGroup"],
            "daysToDieDry": bp.get("WateredNaturalResourceSpec", {}).get("DaysToDieDry"),
        }
        # Some trees have gatherable secondary yields (chestnuts, maple syrup, etc.)
        if "GatherableSpec" in bp:
            g = bp["GatherableSpec"]
            tree["gatherableYield"] = {
                "id": g["Yielder"]["Yield"]["Id"],
                "amount": g["Yielder"]["Yield"]["Amount"],
                "yieldGrowthTimeInDays": g["YieldGrowthTimeInDays"],
                "gatherTimeInHours": g["Yielder"]["RemovalTimeInHours"],
                "resourceGroup": g["Yielder"]["ResourceGroup"],
            }
        trees[name] = tree

    # Bushes
    for bp in load_all_blueprints(nr_dir / "Bushes", "**/*.blueprint.json"):
        name = bp["TemplateSpec"]["TemplateName"]
        g = bp["GatherableSpec"]
        bushes[name] = {
            "id": name,
            "displayName": resolve(bp["LabeledEntitySpec"]["DisplayNameLocKey"], strings),
            "growthTimeInDays": bp["GrowableSpec"]["GrowthTimeInDays"],
            "yield": {
                "id": g["Yielder"]["Yield"]["Id"],
                "amount": g["Yielder"]["Yield"]["Amount"],
            },
            "yieldGrowthTimeInDays": g["YieldGrowthTimeInDays"],
            "gatherTimeInHours": g["Yielder"]["RemovalTimeInHours"],
            "plantTimeInHours": bp.get("PlantableSpec", {}).get("PlantTimeInHours"),
            "resourceGroup": g["Yielder"]["ResourceGroup"],
            "daysToDieDry": bp.get("WateredNaturalResourceSpec", {}).get("DaysToDieDry"),
        }

    return {"crops": crops, "trees": trees, "bushes": bushes}


def extract_building(bp: dict, strings: dict[str, str]) -> dict:
    """Extract production-relevant fields from a building blueprint."""
    template_name = bp["TemplateSpec"]["TemplateName"]

    # Category and order from PlaceableBlockObjectSpec
    placeable = bp.get("PlaceableBlockObjectSpec", {})
    category = placeable.get("ToolGroupId", "Other")
    tool_order = placeable.get("ToolOrder", 0)

    # Building cost
    building_spec = bp.get("BuildingSpec", {})
    building_cost = [
        {"id": c["Id"], "amount": c["Amount"]}
        for c in building_spec.get("BuildingCost", [])
    ]
    science_cost = building_spec.get("ScienceCost", 0)

    # Workers
    workplace = bp.get("WorkplaceSpec", {})
    max_workers = workplace.get("MaxWorkers", 0)
    default_worker_type = workplace.get("DefaultWorkerType", "Beaver")
    disallow_other = workplace.get("DisallowOtherWorkerTypes", False)
    unlock_costs = workplace.get("WorkerTypeUnlockCosts", [])
    bot_unlock = next(
        (u for u in unlock_costs if u["WorkerType"] == "Bot"), None
    )
    allows_bot_workers = not disallow_other and bot_unlock is not None
    bot_unlock_science_cost = bot_unlock["ScienceCost"] if bot_unlock else 0

    # Recipes
    recipe_ids = bp.get("ManufactorySpec", {}).get("ProductionRecipeIds", [])

    # Planter / yield-removing resource group (farmhouses, foresters)
    plantable_resource_group = bp.get("PlanterBuildingSpec", {}).get(
        "PlantableResourceGroup"
    )
    yield_removing_resource_group = bp.get("YieldRemovingBuildingSpec", {}).get(
        "ResourceGroup"
    )

    # Power
    mech = bp.get("MechanicalNodeSpec", {})
    power_input = mech.get("PowerInput", 0)
    power_output = mech.get("PowerOutput", 0)

    # Display name
    labeled = bp.get("LabeledEntitySpec", {})
    display_name = resolve(labeled.get("DisplayNameLocKey", ""), strings)

    # Good consumption (passive, e.g. Agora consuming Extract)
    good_consuming = bp.get("GoodConsumingBuildingSpec", {})
    consumed_goods = [
        {"goodId": g["GoodId"], "goodPerHour": g["GoodPerHour"]}
        for g in good_consuming.get("ConsumedGoods", [])
    ]

    # Dwelling
    dwelling_spec = bp.get("DwellingSpec")
    dwelling = None
    if dwelling_spec:
        dwelling = {"maxBeavers": dwelling_spec["MaxBeavers"]}

    # Storage
    stockpile_spec = bp.get("StockpileSpec")
    stockpile = None
    if stockpile_spec:
        stockpile = {
            "maxCapacity": stockpile_spec["MaxCapacity"],
            "goodType": stockpile_spec.get("WhitelistedGoodType", ""),
        }

    # Needs covered (attractions, continuous effects, dwelling sleep effects)
    # Each entry: { needId, capacity? } — capacity omitted for unlimited (continuous effects)
    needs_covered: list[dict] = []
    enterable = bp.get("EnterableSpec", {})
    for effect in bp.get("AttractionSpec", {}).get("Effects", []):
        entry: dict = {"needId": effect["NeedId"]}
        if enterable.get("LimitedCapacityFinished"):
            entry["capacity"] = enterable["CapacityFinished"]
        needs_covered.append(entry)
    for effect in bp.get("ContinuousEffectBuildingSpec", {}).get("Effects", []):
        needs_covered.append({"needId": effect["NeedId"]})
    dwelling_spec = bp.get("DwellingSpec")
    if dwelling_spec:
        max_beavers = dwelling_spec["MaxBeavers"]
        for effect in dwelling_spec.get("SleepEffects", []):
            needs_covered.append({"needId": effect["NeedId"], "capacity": max_beavers})

    result = {
        "id": template_name,
        "displayName": display_name,
        "category": category,
        "toolOrder": tool_order,
        "buildingCost": building_cost,
        "scienceCost": science_cost,
        "maxWorkers": max_workers,
        "defaultWorkerType": default_worker_type,
        "allowsBotWorkers": allows_bot_workers,
        "botUnlockScienceCost": bot_unlock_science_cost,
        "recipeIds": recipe_ids,
        "powerInput": power_input,
        "powerOutput": power_output,
    }

    if plantable_resource_group:
        result["plantableResourceGroup"] = plantable_resource_group
    if yield_removing_resource_group:
        result["yieldRemovingResourceGroup"] = yield_removing_resource_group
    if consumed_goods:
        result["consumedGoods"] = consumed_goods
    if dwelling:
        result["dwelling"] = dwelling
    if stockpile:
        result["stockpile"] = stockpile
    if needs_covered:
        result["needsCovered"] = needs_covered

    return result


def extract_faction_data(
    blueprints_dir: Path,
    faction: str,
    strings: dict[str, str],
) -> dict:
    """Extract all building data for a faction."""
    # Load template collections to know which buildings belong to this faction
    tc_dir = blueprints_dir / "TemplateCollections"

    common_tc = load_blueprint(
        tc_dir / "TemplateCollection.Buildings.Common.blueprint.json"
    )
    faction_tc = load_blueprint(
        tc_dir / f"TemplateCollection.Buildings.{faction}.blueprint.json"
    )

    all_blueprints = (
        common_tc["TemplateCollectionSpec"]["Blueprints"]
        + faction_tc["TemplateCollectionSpec"]["Blueprints"]
    )

    # Load good collections
    gc_dir = blueprints_dir / "GoodCollections"
    common_goods = load_blueprint(
        gc_dir / "GoodCollection.Common.blueprint.json"
    )["GoodCollectionSpec"]["Goods"]
    faction_goods = load_blueprint(
        gc_dir / f"GoodCollection.{faction}.blueprint.json"
    )["GoodCollectionSpec"]["Goods"]

    # Load need collections
    nc_dir = blueprints_dir / "NeedCollections"
    common_needs = load_blueprint(
        nc_dir / "NeedCollection.Common.blueprint.json"
    )["NeedCollectionSpec"]["Needs"]
    faction_needs = load_blueprint(
        nc_dir / f"NeedCollection.{faction}.blueprint.json"
    )["NeedCollectionSpec"]["Needs"]

    # Load each building blueprint
    buildings = {}
    for bp_path_str in all_blueprints:
        # bp_path_str looks like "Buildings/Food/Bakery/Bakery.Folktails.blueprint"
        bp_path = blueprints_dir / (bp_path_str + ".json")
        if not bp_path.exists():
            print(f"  Warning: {bp_path} not found, skipping", file=sys.stderr)
            continue

        bp = load_blueprint(bp_path)

        # Skip dev mode tools
        placeable = bp.get("PlaceableBlockObjectSpec", {})
        if placeable.get("DevModeTool", False):
            continue

        building = extract_building(bp, strings)
        buildings[building["id"]] = building

    return {
        "factionId": faction,
        "displayName": resolve(f"Faction.{faction}.DisplayName", strings),
        "availableGoodIds": sorted(set(common_goods + faction_goods)),
        "availableNeedIds": sorted(set(common_needs + faction_needs)),
        "buildings": buildings,
    }


@click.command()
@click.argument(
    "extracted_data_dir",
    type=click.Path(exists=True, file_okay=False, dir_okay=True, path_type=Path),
)
@click.argument(
    "output_dir",
    type=click.Path(path_type=Path),
)
def main(extracted_data_dir: Path, output_dir: Path) -> None:
    """Build site data JSON files from extracted Timberborn game data."""
    blueprints_dir = extracted_data_dir / "blueprints"
    localizations_dir = extracted_data_dir / "localizations"

    output_dir.mkdir(parents=True, exist_ok=True)

    # Load English strings for resolving display names
    print("Loading English strings...", file=sys.stderr)
    strings = load_english_strings(localizations_dir)
    print(f"  {len(strings)} strings", file=sys.stderr)

    # Extract common data
    print("Extracting goods...", file=sys.stderr)
    goods = extract_goods(blueprints_dir, strings)
    print(f"  {len(goods)} goods", file=sys.stderr)

    print("Extracting good groups...", file=sys.stderr)
    good_groups = extract_good_groups(blueprints_dir, strings)
    print(f"  {len(good_groups)} good groups", file=sys.stderr)

    print("Extracting recipes...", file=sys.stderr)
    recipes = extract_recipes(blueprints_dir, strings)
    print(f"  {len(recipes)} recipes", file=sys.stderr)

    print("Extracting needs...", file=sys.stderr)
    needs = extract_needs(blueprints_dir, strings)
    print(f"  {len(needs)} needs", file=sys.stderr)

    print("Extracting need groups...", file=sys.stderr)
    need_groups = extract_need_groups(blueprints_dir, strings)
    print(f"  {len(need_groups)} need groups", file=sys.stderr)

    print("Extracting natural resources...", file=sys.stderr)
    natural_resources = extract_natural_resources(blueprints_dir, strings)
    print(
        f"  {len(natural_resources['crops'])} crops, "
        f"{len(natural_resources['trees'])} trees, "
        f"{len(natural_resources['bushes'])} bushes",
        file=sys.stderr,
    )

    print("Extracting building categories...", file=sys.stderr)
    building_categories = extract_building_categories(blueprints_dir, strings)
    print(f"  {len(building_categories)} building categories", file=sys.stderr)

    print("Extracting game modes...", file=sys.stderr)
    game_modes = extract_game_modes(blueprints_dir, strings)
    print(f"  {len(game_modes)} game modes", file=sys.stderr)

    common_data = {
        "goods": goods,
        "goodGroups": good_groups,
        "recipes": recipes,
        "needs": needs,
        "needGroups": need_groups,
        "buildingCategories": building_categories,
        "naturalResources": natural_resources,
        "gameModes": game_modes,
    }

    # Extract faction data
    faction_data = []
    for faction in ["Folktails", "IronTeeth"]:
        print(f"Extracting {faction} buildings...", file=sys.stderr)
        fd = extract_faction_data(blueprints_dir, faction, strings)
        print(f"  {len(fd['buildings'])} buildings", file=sys.stderr)
        faction_data.append(fd)

    # Read game version
    version_file = extracted_data_dir / "version.txt"
    if not version_file.exists():
        raise click.ClickException(
            f"{version_file} not found -- re-run extract-game-data.py with --game-version"
        )
    game_version = version_file.read_text().strip()
    print(f"Game version: {game_version}", file=sys.stderr)

    # Write output files
    def write_json(path: Path, data: object) -> None:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        print(f"Wrote {path} ({path.stat().st_size:,} bytes)", file=sys.stderr)

    write_json(output_dir / "common.json", common_data)
    for fd in faction_data:
        write_json(output_dir / f"{fd['factionId']}.json", fd)
    write_json(output_dir / "version.json", {"gameVersion": game_version})

    # Write data README
    readme_path = output_dir / "README.md"
    readme_path.write_text(
        f"# Site Data\n"
        f"\n"
        f"Generated from Timberborn **{game_version}**.\n"
        f"\n"
        f"These JSON files are produced by `scripts/build-site-data.py` and should not be edited by hand.\n"
    )
    print(f"Wrote {readme_path}", file=sys.stderr)

    print("Done!", file=sys.stderr)


if __name__ == "__main__":
    main()
