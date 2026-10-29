"""Data layer for ComfyUI-TagComplete.

Scans the local library (wildcards / embeddings / LoRAs / hypernetworks), reads
LoRA metadata, serves preview images and keeps the tag usage database.

The model listings reuse ComfyUI's own folder index (``folder_paths``) so the
results are always identical to what the node widgets offer. Directory walks
follow symlinks/junctions, exactly like ComfyUI does.

All scans are cached in memory; ``refresh()`` clears the cache.
"""

from __future__ import annotations

import json
import os
import sqlite3
import struct
import threading
import time
from pathlib import Path

from tc_common import (
    DB_FILE,
    DEFAULT_WILDCARD_DIR,
    PACKAGE_DIR,
    TAGS_DIR,
    TEMP_DIR,
    comfy_base_dir,
    custom_nodes_dirs,
    folder_paths_for,
    load_settings,
    log,
    safe_child,
    since_epoch,
)

# --------------------------------------------------------------------------- #
# constants
# --------------------------------------------------------------------------- #
MODEL_EXT = {".safetensors", ".ckpt", ".pt", ".pth", ".bin"}
EMB_EXT = {".safetensors", ".pt", ".bin", ".pth"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".jxl"}
PREVIEW_SUFFIXES = [".preview.png", ".preview.jpg", ".preview.jpeg", ".preview.webp", ".preview.gif"]

SCAN_TTL = 300.0

_cache: dict = {}
_cache_lock = threading.RLock()


def _cached(key: str, builder):
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and (now - hit[0]) < SCAN_TTL:
            return hit[1]
    value = builder()
    with _cache_lock:
        _cache[key] = (time.time(), value)
    return value


def refresh() -> None:
    with _cache_lock:
        _cache.clear()


# --------------------------------------------------------------------------- #
# filesystem helpers
# --------------------------------------------------------------------------- #
def _walk(root: Path, suffixes: set[str] | None = None):
    """os.walk equivalent that follows symlinks and skips hidden folders."""
    try:
        if not root.exists() or not root.is_dir():
            return
    except Exception:
        return
    for dirpath, dirnames, filenames in os.walk(root, followlinks=True):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d != "__pycache__"]
        for filename in filenames:
            if filename.startswith("."):
                continue
            if suffixes is not None:
                ext = os.path.splitext(filename)[1].lower()
                if ext not in suffixes:
                    continue
            yield Path(dirpath) / filename


def _folder_listing(folder_name: str) -> tuple[list[tuple[str, float]], list[str]]:
    """Return ``(relative name, sort key)`` pairs for a ComfyUI model folder."""
    entries: list[tuple[str, float]] = []
    roots: list[str] = []

    try:
        import folder_paths  # noqa: WPS433

        roots = list(folder_paths.get_folder_paths(folder_name))
    except Exception:
        roots = []

    files: list[str] = []
    folder_mtimes: dict[str, float] = {}
    try:
        import folder_paths  # noqa: WPS433

        files, folder_mtimes, _ = folder_paths.get_filename_list_(folder_name)
    except Exception:
        files = []

    if files:
        for rel in files:
            posix = str(rel).replace("\\", "/")
            parent = os.path.dirname(os.path.join(roots[0], rel)) if roots else ""
            mtime = folder_mtimes.get(parent, 0.0) if folder_mtimes else 0.0
            entries.append((posix, mtime))
        return entries, roots

    # Fallback: walk the configured roots ourselves
    seen: set[str] = set()
    for root in roots:
        root_path = Path(root)
        for path in _walk(root_path, MODEL_EXT):
            try:
                rel = path.relative_to(root_path).as_posix()
            except Exception:
                continue
            if rel.lower() in seen:
                continue
            seen.add(rel.lower())
            entries.append((rel, since_epoch(path)))
    return entries, roots


def _scan_models(folder_name: str) -> list[list]:
    def build():
        entries, _roots = _folder_listing(folder_name)
        results = [[name, mtime] for name, mtime in entries]
        results.sort(key=lambda item: item[0].lower())
        return results

    return _cached(f"models:{folder_name}", build)


# --------------------------------------------------------------------------- #
# tag files
# --------------------------------------------------------------------------- #
def list_tag_files() -> dict:
    def build():
        csv_files = []
        json_files = []
        try:
            for entry in sorted(TAGS_DIR.glob("*.csv")):
                if entry.is_file():
                    csv_files.append(entry.name)
            for entry in sorted(TAGS_DIR.glob("*.json")):
                if entry.is_file():
                    json_files.append(entry.name)
        except Exception as exc:  # noqa: BLE001
            log("could not list tag files:", exc)
        return {"csv": csv_files, "json": json_files}

    return _cached("tagfiles", build)


def resolve_tag_file(name: str) -> Path | None:
    if not name or name == "None":
        return None
    path = safe_child(TAGS_DIR, name)
    if path and path.is_file():
        return path
    return None


# --------------------------------------------------------------------------- #
# wildcards
# --------------------------------------------------------------------------- #
def wildcard_dirs() -> list[Path]:
    settings = load_settings()
    dirs: list[Path] = [DEFAULT_WILDCARD_DIR, comfy_base_dir() / "wildcards"]

    for extra in settings.get("wildcardPaths", []) or []:
        try:
            dirs.append(Path(os.path.expandvars(os.path.expanduser(str(extra)))))
        except Exception:
            continue

    for node_dir in custom_nodes_dirs():
        try:
            for candidate in node_dir.glob("*/wildcards"):
                if candidate.is_dir():
                    dirs.append(candidate)
        except Exception:
            continue

    out: list[Path] = []
    seen: set[str] = set()
    for path in dirs:
        try:
            if not path.exists() or not path.is_dir():
                continue
            key = str(path.resolve()).lower()
        except Exception:
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(path)
    return out


def scan_wildcards() -> dict:
    """Return wildcard files, yaml wildcard collections and UMI tag counts."""

    def build():
        files: list[list] = []
        yaml_files: list[tuple[Path, Path]] = []

        for root in wildcard_dirs():
            try:
                root_key = root.as_posix()
            except Exception:
                continue
            for path in _walk(root, {".txt"}):
                if path.name == "put wildcards here.txt":
                    continue
                try:
                    rel = path.relative_to(root).as_posix()
                except Exception:
                    continue
                name = rel[:-4] if rel.lower().endswith(".txt") else rel
                files.append([root_key, name, since_epoch(path)])
            for path in _walk(root, {".yaml", ".yml"}):
                yaml_files.append((path, root))

        files.sort(key=lambda item: str(item[1]).lower())

        yaml_wildcards: dict = {}
        umi_entries: dict[str, dict] = {}

        try:
            import yaml  # type: ignore
        except Exception:  # noqa: BLE001
            yaml = None

        for path, root in yaml_files:
            if yaml is None:
                break
            try:
                with open(path, encoding="utf-8") as handle:
                    data = yaml.safe_load(handle)
            except Exception:
                continue
            if not isinstance(data, dict):
                continue

            if _looks_like_umi(data):
                for name, item in data.items():
                    tags = item.get("Tags") if isinstance(item, dict) else None
                    if not isinstance(tags, list) or not tags:
                        continue
                    entry = umi_entries.setdefault(str(name), {"tags": [], "count": 0})
                    entry["tags"] = [str(tag) for tag in tags]
                    entry["count"] += 1
            else:
                cleaned = _clean_dynamic_prompt_data(data)
                if cleaned:
                    try:
                        rel_parent = path.relative_to(root).parent
                        parts = [part for part in rel_parent.parts if part not in ("", ".")]
                    except Exception:
                        parts = []
                    for part in reversed(parts):
                        cleaned = {part: cleaned}
                    yaml_wildcards[path.name] = cleaned

        umi_list = sorted(umi_entries.items(), key=lambda item: item[1]["count"], reverse=True)
        umi_out = [[name, info["tags"], info["count"]] for name, info in umi_list]

        try:
            TEMP_DIR.mkdir(parents=True, exist_ok=True)
            (TEMP_DIR / "wc_yaml.json").write_text(
                json.dumps(yaml_wildcards, ensure_ascii=False), encoding="utf-8"
            )
            (TEMP_DIR / "wc.txt").write_text(
                "\n".join(f"{base},{name}" for base, name, _ in files), encoding="utf-8"
            )
            (TEMP_DIR / "umi_tags.txt").write_text(
                "\n".join(f"{name},{count},{','.join(tags)}" for name, tags, count in umi_out), encoding="utf-8"
            )
        except Exception:
            pass

        return {"wildcards": files, "yamlWildcards": yaml_wildcards, "umiTags": umi_out}

    return _cached("wildcards", build)


def _looks_like_umi(data: dict) -> bool:
    if not data:
        return False
    for item in data.values():
        if not isinstance(item, dict) or "Tags" not in item or not isinstance(item["Tags"], list):
            return False
    return True


def _clean_dynamic_prompt_data(data: dict) -> dict:
    out: dict = {}
    for key, value in data.items():
        if isinstance(value, dict):
            nested = _clean_dynamic_prompt_data(value)
            if nested:
                out[key] = nested
        elif isinstance(value, str):
            out[key] = value
        elif isinstance(value, list) and all(isinstance(item, str) for item in value):
            out[key] = value
    return out


def wildcard_contents(base: str, filename: str) -> str | None:
    root = Path(base)
    try:
        if not root.exists() or not root.is_dir():
            return None
    except Exception:
        return None
    candidate = safe_child(root, filename)
    if candidate is None or not candidate.is_file():
        return None
    if candidate.suffix.lower() not in {".txt"}:
        return None
    try:
        return candidate.read_text(encoding="utf-8", errors="replace")
    except Exception as exc:  # noqa: BLE001
        log("could not read wildcard file:", exc)
        return None


# --------------------------------------------------------------------------- #
# embeddings / loras / hypernetworks
# --------------------------------------------------------------------------- #
def scan_embeddings() -> list[list]:
    def build():
        entries, _roots = _folder_listing("embeddings")
        results: list[list] = []
        for name, mtime in entries:
            stem = name[: name.rfind(".")] if "." in name else name
            results.append([stem, mtime, _embedding_version(name)])
        results.sort(key=lambda item: item[0].lower())
        return results

    return _cached("embeddings", build)


def _embedding_version(name: str) -> str:
    """Best effort guess of the CLIP version, based on the last tensor dimension."""
    path = _full_path("embeddings", name)
    if path is None or path.suffix.lower() != ".safetensors":
        return ""
    try:
        with open(path, "rb") as handle:
            header_len = struct.unpack("<Q", handle.read(8))[0]
            if header_len <= 0 or header_len > 8 * 1024 * 1024:
                return ""
            header = json.loads(handle.read(header_len).decode("utf-8", errors="replace"))
    except Exception:
        return ""
    dims: set[int] = set()
    for key, value in header.items():
        if key == "__metadata__" or not isinstance(value, dict):
            continue
        shape = value.get("shape") or []
        if shape:
            try:
                dims.add(int(shape[-1]))
            except Exception:
                continue
    if 768 in dims:
        return "v1"
    if 1024 in dims:
        return "v2"
    if 2048 in dims:
        return "vXL"
    return ""


def scan_loras() -> list[list]:
    return _scan_models("loras")


def scan_lycos() -> list[list]:
    return _scan_models("lycos")


def scan_hypernetworks() -> list[list]:
    return _scan_models("hypernetworks")


def scan_styles() -> list[list]:
    def build():
        candidates = [TAGS_DIR / "styles.txt", TEMP_DIR / "styles.txt"]
        for path in candidates:
            if not path.is_file():
                continue
            names: list[list] = []
            try:
                for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
                    name = line.strip()
                    if not name or name == "None":
                        continue
                    names.append([name])
            except Exception:
                continue
            names.sort(key=lambda item: item[0])
            return names
        return []

    return _cached("styles", build)


# --------------------------------------------------------------------------- #
# model lookup helpers
# --------------------------------------------------------------------------- #
def _full_path(folder_name: str, name: str) -> Path | None:
    name = str(name).replace("\\", "/")
    candidates = [name]
    if not os.path.splitext(name)[1]:
        for ext in MODEL_EXT:
            candidates.append(name + ext)
    try:
        import folder_paths  # noqa: WPS433

        for candidate in candidates:
            try:
                found = folder_paths.get_full_path(folder_name, candidate)
            except Exception:
                found = None
            if found:
                return Path(found)
    except Exception:
        pass

    for root in folder_paths_for(folder_name):
        for candidate in candidates:
            path = safe_child(root, candidate)
            if path and path.is_file():
                return path
    return None


def find_model_file(folder_name: str, name: str) -> Path | None:
    """Find a model by ``relative/name`` or bare ``name`` (extension optional)."""
    if not name:
        return None
    direct = _full_path(folder_name, name)
    if direct is not None:
        return direct

    wanted = str(name).replace("\\", "/").lower()
    bare = wanted.rsplit("/", 1)[-1]
    entries, roots = _folder_listing(folder_name)
    for rel, _mtime in entries:
        lowered = rel.lower()
        stem = lowered[: lowered.rfind(".")] if "." in lowered else lowered
        if lowered == wanted or stem == wanted or stem.rsplit("/", 1)[-1] == bare:
            found = _full_path(folder_name, rel)
            if found is not None:
                return found
    return None


def model_sidecar_json(path: Path) -> dict | None:
    for candidate in (path.with_suffix(".json"), path.parent / (path.stem + ".json")):
        if candidate.is_file():
            try:
                data = json.loads(candidate.read_text(encoding="utf-8", errors="replace"))
                if isinstance(data, dict):
                    return data
            except Exception:
                continue
    return None


def _safetensors_metadata(path: Path) -> dict:
    if path.suffix.lower() != ".safetensors":
        return {}
    try:
        with open(path, "rb") as handle:
            header_len = struct.unpack("<Q", handle.read(8))[0]
            if header_len <= 0 or header_len > 32 * 1024 * 1024:
                return {}
            header = json.loads(handle.read(header_len).decode("utf-8", errors="replace"))
    except Exception:
        return {}
    meta = header.get("__metadata__")
    return meta if isinstance(meta, dict) else {}


def model_info(folder_name: str, name: str) -> dict:
    """Activation text / preferred weight for a LoRA style model."""
    path = find_model_file(folder_name, name)
    info: dict = {}
    if path is None:
        return info

    sidecar = model_sidecar_json(path) or {}
    activation = (
        sidecar.get("activation text")
        or sidecar.get("activation_text")
        or sidecar.get("trigger")
        or sidecar.get("trigger_words")
    )
    weight = sidecar.get("preferred weight") or sidecar.get("preferred_weight")

    if not activation or weight in (None, ""):
        meta = _safetensors_metadata(path)
        meta_lower = {str(key).lower(): value for key, value in meta.items()}
        activation = activation or (
            meta_lower.get("modelspec.trigger_phrase")
            or meta_lower.get("ss_activation_text")
            or meta_lower.get("activation text")
            or meta_lower.get("trigger_phrase")
        )
        weight = weight or (
            meta_lower.get("modelspec.preferred_weight")
            or meta_lower.get("preferred weight")
            or meta_lower.get("ss_preferred_weight")
        )

    if activation:
        info["activation text"] = str(activation).strip()
    if weight not in (None, ""):
        try:
            info["preferred weight"] = float(weight)
        except Exception:
            pass
    return info


def model_keywords(folder_name: str, name: str) -> str | None:
    """Trigger words for a LoRA, including model-keyword style lists."""
    info = model_info(folder_name, name)
    if info.get("activation text"):
        return info["activation text"]

    table = _keyword_table()
    key = str(name).replace("\\", "/").lower()
    if key in table:
        return table[key]
    bare = key.rsplit("/", 1)[-1]
    return table.get(bare)


def _keyword_table() -> dict[str, str]:
    def build():
        table: dict[str, str] = {}
        for node_dir in custom_nodes_dirs():
            for pattern in ("*/lora-keyword.txt", "*/lora-keyword-user.txt"):
                try:
                    for candidate in node_dir.glob(pattern):
                        _read_keyword_file(candidate, table)
                except Exception:
                    continue
        return table

    return _cached("keywords", build)


def _read_keyword_file(path: Path, table: dict[str, str]) -> None:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(",")
        if len(parts) < 3:
            continue
        keywords = "|".join(parts[1:-1]) if len(parts) > 3 else parts[1]
        keywords = keywords.replace("| ", ", ").replace("|", ", ").strip()
        model_name = parts[-1].replace("\\", "/").rsplit("/", 1)[-1].strip().lower()
        if model_name and keywords:
            table[model_name] = keywords


def find_preview(folder_name: str, name: str) -> Path | None:
    path = find_model_file(folder_name, name)
    if path is None:
        return None
    candidates: list[Path] = []
    for suffix in PREVIEW_SUFFIXES:
        candidates.append(path.with_name(path.stem + suffix))
    for ext in IMAGE_EXT:
        candidates.append(path.with_suffix(ext))
        candidates.append(path.with_name(path.stem + ext))
    for candidate in candidates:
        try:
            if candidate.is_file() and candidate.stat().st_size > 0:
                return candidate
        except Exception:
            continue
    return None


# --------------------------------------------------------------------------- #
# aggregated payload for the browser
# --------------------------------------------------------------------------- #
def data_payload() -> dict:
    wildcard_data = scan_wildcards()
    files = list_tag_files()
    settings = load_settings()
    return {
        "version": 1,
        "packagePath": PACKAGE_DIR.as_posix(),
        "tagsPath": TAGS_DIR.as_posix(),
        "files": files,
        "settings": settings,
        "wildcards": wildcard_data["wildcards"],
        "yamlWildcards": wildcard_data["yamlWildcards"],
        "umiTags": wildcard_data["umiTags"],
        "embeddings": scan_embeddings(),
        "loras": scan_loras(),
        "lycos": scan_lycos(),
        "hypernetworks": scan_hypernetworks(),
        "styles": scan_styles(),
        "folders": {
            "loras": [str(p) for p in folder_paths_for("loras")],
            "embeddings": [str(p) for p in folder_paths_for("embeddings")],
            "hypernetworks": [str(p) for p in folder_paths_for("hypernetworks")],
            "wildcards": [str(p) for p in wildcard_dirs()],
        },
    }


# --------------------------------------------------------------------------- #
# tag usage database
# --------------------------------------------------------------------------- #
class UsageDatabase:
    """sqlite storage of tag usage counts (same schema as the A1111 extension)."""

    version = 1

    def __init__(self, path: Path = DB_FILE) -> None:
        self.path = path
        self.error: str | None = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._ensure_schema()
        except Exception as exc:  # noqa: BLE001
            self.error = str(exc)
            log("frequency database unavailable:", exc)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=30)
        conn.isolation_level = None
        return conn

    def _ensure_schema(self) -> None:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("CREATE TABLE IF NOT EXISTS db_data (key TEXT PRIMARY KEY, value TEXT)")
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS tag_frequency (
                    name TEXT NOT NULL,
                    type INT NOT NULL,
                    count_pos INT,
                    count_neg INT,
                    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (name, type)
                )
                """
            )
            cursor.execute(
                "INSERT OR REPLACE INTO db_data (key, value) VALUES ('version', ?)",
                (str(self.version),),
            )
        finally:
            conn.close()

    # -- reading ------------------------------------------------------------
    def counts(
        self,
        names: list[str],
        types: list[int],
        negative: bool = False,
        max_age_days: int | None = None,
    ) -> list[list]:
        column = "count_neg" if negative else "count_pos"
        rows: list[list] = []
        conn = self._connect()
        try:
            cursor = conn.cursor()
            for name, tag_type in zip(names, types):
                try:
                    tag_type_int = int(tag_type)
                except Exception:
                    tag_type_int = 0
                if max_age_days:
                    cursor.execute(
                        f"SELECT {column}, last_used FROM tag_frequency "
                        "WHERE name = ? AND type = ? "
                        "AND last_used > datetime('now', '-' || ? || ' days')",
                        (name, tag_type_int, int(max_age_days)),
                    )
                else:
                    cursor.execute(
                        f"SELECT {column}, last_used FROM tag_frequency WHERE name = ? AND type = ?",
                        (name, tag_type_int),
                    )
                row = cursor.fetchone()
                if row:
                    rows.append([name, tag_type, int(row[0] or 0), row[1]])
                else:
                    rows.append([name, tag_type, 0, None])
        finally:
            conn.close()
        return rows

    def single_count(self, name: str, tag_type: int, negative: bool = False):
        column = "count_neg" if negative else "count_pos"
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                f"SELECT {column}, last_used FROM tag_frequency WHERE name = ? AND type = ?",
                (name, int(tag_type)),
            )
            row = cursor.fetchone()
        finally:
            conn.close()
        if row:
            return [int(row[0] or 0), row[1]]
        return [0, None]

    def all_counts(self) -> list[list]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT name, type, count_pos, count_neg, last_used FROM tag_frequency "
                "WHERE count_pos > 0 OR count_neg > 0 ORDER BY count_pos + count_neg DESC"
            )
            rows = cursor.fetchall()
        finally:
            conn.close()
        return [list(row) for row in rows]

    # -- writing ------------------------------------------------------------
    def increase(self, name: str, tag_type: int, negative: bool = False) -> None:
        tag_type = int(tag_type)
        pos = self.single_count(name, tag_type, False)[0]
        neg = self.single_count(name, tag_type, True)[0]
        if negative:
            neg += 1
        else:
            pos += 1
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT OR REPLACE INTO tag_frequency (name, type, count_pos, count_neg, last_used) "
                "VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
                (name, tag_type, pos, neg),
            )
        finally:
            conn.close()

    def reset(self, name: str, tag_type: int, positive: bool = True, negative: bool = False) -> None:
        if positive and negative:
            set_clause = "count_pos = 0, count_neg = 0"
        elif positive:
            set_clause = "count_pos = 0"
        elif negative:
            set_clause = "count_neg = 0"
        else:
            return
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                f"UPDATE tag_frequency SET {set_clause} WHERE name = ? AND type = ?",
                (name, int(tag_type)),
            )
        finally:
            conn.close()


try:
    usage_db: UsageDatabase | None = UsageDatabase()
except Exception as _exc:  # noqa: BLE001
    usage_db = None
    log("failed to initialise usage db:", _exc)
