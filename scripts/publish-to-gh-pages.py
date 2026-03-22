#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = ["click"]
# ///
"""Build site data and publish the site to the gh-pages branch."""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import click


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"
EXTRACTED_DATA_DIR = REPO_ROOT / "extracted-data"
SITE_DIR = REPO_ROOT / "site"
SITE_DATA_DIR = SITE_DIR / "data"


def extract_game_data(streaming_assets_dir: Path) -> None:
    """Run extract-game-data.py to unpack game data from StreamingAssets."""
    click.echo("Extracting game data...", err=True)
    subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / "extract-game-data.py"), str(streaming_assets_dir), str(EXTRACTED_DATA_DIR)],
        check=True,
    )
    click.echo("Game data extracted successfully.", err=True)


def build_site_data() -> None:
    """Run build-site-data.py to generate the site data JSON files."""
    click.echo("Building site data...", err=True)
    subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / "build-site-data.py"), str(EXTRACTED_DATA_DIR), str(SITE_DATA_DIR)],
        check=True,
    )
    click.echo("Site data built successfully.", err=True)


def git(*args: str, cwd: str | Path | None = None) -> None:
    """Run a git command, raising on failure."""
    subprocess.run(["git", *args], cwd=cwd, check=True)


def get_remote_url() -> str:
    """Get the origin remote URL from the current repo."""
    result = subprocess.run(
        ["git", "remote", "get-url", "origin"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def publish(push: bool, message: str) -> None:
    """Commit site/ contents to gh-pages and optionally push."""
    remote_url = get_remote_url()

    with tempfile.TemporaryDirectory() as tmp:
        # Clone the latest gh-pages branch from origin
        git("clone", "--branch", "gh-pages", "--single-branch", "--depth", "1",
            remote_url, tmp)

        # Replace the working tree contents with the current site
        for entry in Path(tmp).iterdir():
            if entry.name == ".git":
                continue
            if entry.is_dir():
                shutil.rmtree(entry)
            else:
                entry.unlink()
        shutil.copytree(SITE_DIR, tmp, dirs_exist_ok=True)

        # Add .nojekyll so GitHub Pages serves files starting with _
        (Path(tmp) / ".nojekyll").touch()

        git("add", "-A", cwd=tmp)

        # Check if there are staged changes
        result = subprocess.run(
            ["git", "diff", "--cached", "--quiet"],
            cwd=tmp,
        )
        if result.returncode == 0:
            click.echo("No changes to publish.", err=True)
            return

        git("commit", "-m", message, cwd=tmp)

        if push:
            git("push", "origin", "gh-pages", cwd=tmp)


@click.command()
@click.argument(
    "streaming_assets_dir",
    type=click.Path(exists=True, file_okay=False, dir_okay=True, path_type=Path),
)
@click.option("--push/--no-push", default=True, help="Push to remote after updating gh-pages.")
@click.option("--message", "-m", default="Update site", help="Commit message for gh-pages.")
def main(streaming_assets_dir: Path, push: bool, message: str) -> None:
    """Build site data and publish to the gh-pages branch."""
    extract_game_data(streaming_assets_dir)
    build_site_data()

    click.echo("Publishing site to gh-pages branch...", err=True)
    publish(push=push, message=message)
    if push:
        click.echo("Site published to gh-pages and pushed to remote.", err=True)
    else:
        click.echo("gh-pages branch updated locally (not pushed).", err=True)


if __name__ == "__main__":
    main()
