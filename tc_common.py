"""Shared paths, settings storage and small helpers for ComfyUI-TagComplete.

Everything in this module is import-safe without a running ComfyUI server, so the
data layer can be unit tested from a plain python interpreter.
"""

from __future__ import annotations

import json
import os
import platform
import threading
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
TAGS_DIR = PACKAGE_DIR / "tags"
TEMP_DIR = TAGS_DIR / "temp"
WEB_DIR = PACKAGE_DIR / "web"
DEFAULT_WILDCARD_DIR = PACKAGE_DIR / "wildcards"
SETTINGS_FILE = PACKAGE_DIR / "settings.json"
DB_FILE = TAGS_DIR / "tag_frequency.db"

LOG_PREFIX = "[TagComplete]"

_LOCK = threading.RLock()

DEFAULT_SETTINGS: dict = {
    "tagFile": "danbooru_e621_merged.csv",
    "translationFile": "danbooru_e621_merged_CNv4.csv",
    "extraFile": "extra-quality-tags.csv",
    "chantFile": "demo-chants.json",
    "translationOldFormat": False,
    "wildcardPaths": [],
    "embeddingInsertFormat": "embedding:name",
    "disableConflictingAutocomplete": True,
    "wcWrap": "__",
}

_settings_cache: dict | None = None


def log(*args) -> None:
    print(LOG_PREFIX, *args)


# --------------------------------------------------------------------------- #
# ComfyUI interop (imported lazily so this module stays framework free)
# --------------------------------------------------------------------------- #
def _folder_paths():
    import folder_paths  # noqa: WPS433 - deliberately late import

    return folder_paths


def comfy_base_dir() -> Path:
    try:
        return Path(_folder_paths().base_path)
    except Exception:
        return PACKAGE_DIR


def folder_paths_for(name: str) -> list[Path]:
    """Return every configured directory for a ComfyUI folder type."""
    try:
        fp = _folder_paths()
        candidates = fp.get_folder_paths(name)
    except Exception:
        candidates = []

    out: list[Path] = []
    seen: set[str] = set()
    for raw in candidates:
        try:
            path = Path(raw)
        except Exception:
            continue
        key = str(path).lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(path)
    return out


def custom_nodes_dirs() -> list[Path]:
    dirs = folder_paths_for("custom_nodes")
    if not dirs:
        dirs = [comfy_base_dir() / "custom_nodes"]
    return [d for d in dirs if d.exists()]


def user_dir() -> Path:
    try:
        return Path(_folder_paths().get_user_directory())
    except Exception:
        return comfy_base_dir() / "user"


# --------------------------------------------------------------------------- #
# Settings (defaults -> shipped default config -> user settings json)
# --------------------------------------------------------------------------- #
DEFAULT_CONFIG_FILE = PACKAGE_DIR / "settings.default.json"


def _read_json(path: Path) -> dict:
    try:
        if not path.exists():
            return {}
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        log(f"could not read {path.name}: {exc}")
        return {}
    return data if isinstance(data, dict) else {}


def load_settings() -> dict:
    global _settings_cache
    with _LOCK:
        if _settings_cache is None:
            merged = dict(DEFAULT_SETTINGS)
            # the repository ships a default configuration (merged danbooru+e621
            # tag set, Chinese translations, ...) which the user settings override
            merged.update(_read_json(DEFAULT_CONFIG_FILE))
            merged.update(_read_json(SETTINGS_FILE))
            _settings_cache = merged
        return dict(_settings_cache)


def save_settings(patch: dict) -> dict:
    global _settings_cache
    with _LOCK:
        current = load_settings()
        if isinstance(patch, dict):
            for key, value in patch.items():
                if value is None:
                    current.pop(key, None)
                else:
                    current[key] = value
        _settings_cache = current
        try:
            SETTINGS_FILE.write_text(
                json.dumps(current, indent=2, ensure_ascii=False), encoding="utf-8"
            )
        except Exception as exc:  # noqa: BLE001
            log(f"could not write settings.json: {exc}")
        return dict(current)


def ensure_dirs() -> None:
    for path in (TAGS_DIR, TEMP_DIR, DEFAULT_WILDCARD_DIR):
        try:
            path.mkdir(parents=True, exist_ok=True)
        except Exception:  # noqa: BLE001
            pass


# --------------------------------------------------------------------------- #
# Misc helpers
# --------------------------------------------------------------------------- #
def since_epoch(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except Exception:
        return 0.0


def is_hidden(path: Path) -> bool:
    return any(part.startswith(".") for part in path.parts)


def safe_child(base: Path, relative: str) -> Path | None:
    """Resolve ``relative`` inside ``base`` and refuse path traversal."""
    if not relative:
        return None
    try:
        base_resolved = base.resolve()
        candidate = (base / relative).resolve()
    except Exception:  # noqa: BLE001
        return None
    try:
        if base_resolved == candidate or base_resolved in candidate.parents:
            return candidate
    except Exception:  # noqa: BLE001
        return None
    return None


def platform_label() -> str:
    return f"{platform.system()} {platform.release()}"
