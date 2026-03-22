#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = ["click"]
# ///
"""Unpack Timberborn's Blueprints.zip & Localizations.zip from StreamingAssets."""

import json
import sys
import zipfile
from pathlib import Path

import click


def unpack(zip_path: Path, output_dir: Path) -> None:
    if not zip_path.exists():
        raise FileNotFoundError(
            f"{zip_path} not found -- expected inside StreamingAssets/Modding/"
        )
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(output_dir)

    print(f"Unpacked {zip_path.name} to {output_dir}", file=sys.stderr)


def read_game_version(streaming_assets_dir: Path) -> str:
    """Read the game version from StreamingAssets/VersionNumbers.json."""
    version_file = streaming_assets_dir / "VersionNumbers.json"
    if not version_file.exists():
        raise FileNotFoundError(
            f"{version_file} not found -- is this a Timberborn StreamingAssets directory?"
        )
    data = json.loads(version_file.read_text(encoding="utf-8"))
    return data["CurrentVersion"]


def core_logic(streaming_assets_dir: Path, output_dir: Path) -> None:
    game_version = read_game_version(streaming_assets_dir)
    print(f"Game version: {game_version}", file=sys.stderr)

    modding_dir = streaming_assets_dir / "Modding"
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / ".gitignore").write_text("*\n")
    (output_dir / "version.txt").write_text(game_version + "\n")
    unpack(modding_dir / "Localizations.zip", output_dir / "localizations")
    unpack(modding_dir / "Blueprints.zip", output_dir / "blueprints")


@click.command()
@click.argument(
    "streaming_assets_dir",
    type=click.Path(exists=True, file_okay=False, dir_okay=True, path_type=Path),
)
@click.argument(
    "output_dir",
    type=click.Path(exists=False, path_type=Path),
)
def main(streaming_assets_dir: Path, output_dir: Path) -> None:
    """Extract game data from Timberborn's StreamingAssets directory."""
    core_logic(streaming_assets_dir, output_dir)


if __name__ == "__main__":
    main()
