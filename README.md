# TimberMath

Planning tools and reference for [Timberborn](https://store.steampowered.com/app/1062090/Timberborn/), built on the actual game data.

## Tools

- **Progression Graph** — Interactive graph showing how raw materials flow through buildings and recipes into advanced goods. Click any node to trace its full supply chain.
- **Colony Planner** — Add buildings and resource tiles, set population, and see production, consumption, power, and drought readiness at a glance.
- **Reference** — Browse goods, recipes, buildings, and natural resources with cross-referenced details.

## Where the data comes from

Game data is extracted from Timberborn's [StreamingAssets](https://github.com/mechanistry/timberborn-modding/wiki/Assets#accessing-game-assets) directory, so it stays anchored to the actual game values.

## Development

The site is plain HTML/CSS/JS with no build step. Data extraction and site-data generation are Python scripts in `scripts/`.

## License

[MIT](LICENSE)
