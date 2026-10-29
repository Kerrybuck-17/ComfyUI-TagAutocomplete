"""aiohttp routes exposed by ComfyUI-TagComplete."""

from __future__ import annotations

import urllib.parse
from pathlib import Path

from aiohttp import web

import tc_data
from tc_common import PACKAGE_DIR, load_settings, log, save_settings

try:
    from server import PromptServer

    routes = PromptServer.instance.routes
except Exception as exc:  # pragma: no cover - only during standalone import
    routes = None
    log("server module unavailable:", exc)


def _json(data, status: int = 200):
    return web.json_response(data, status=status, headers={"Cache-Control": "no-store"})


def _no_cache():
    return {"Cache-Control": "no-store", "Pragma": "no-cache"}


def register(app_routes) -> None:
    """Register every endpoint on the given aiohttp RouteTableDef."""

    # ------------------------------------------------------------------ info
    @app_routes.get("/tagcomplete/info")
    async def tagcomplete_info(request):
        files = tc_data.list_tag_files()
        return _json(
            {
                "ok": True,
                "version": 1,
                "tagFiles": files["csv"],
                "jsonFiles": files["json"],
                "tagsPath": tc_data.TAGS_DIR.as_posix(),
                "packagePath": PACKAGE_DIR.as_posix(),
                "folders": tc_data.data_payload()["folders"],
                "usageDb": tc_data.usage_db is not None and tc_data.usage_db.error is None,
            }
        )

    # ------------------------------------------------------------------ data
    @app_routes.get("/tagcomplete/data")
    async def tagcomplete_data(request):
        try:
            return _json(tc_data.data_payload())
        except Exception as exc:  # noqa: BLE001
            log("data payload error:", exc)
            return _json({"error": str(exc)}, status=500)

    @app_routes.post("/tagcomplete/refresh")
    async def tagcomplete_refresh(request):
        tc_data.refresh()
        return _json({"ok": True, "data": tc_data.data_payload()})

    # -------------------------------------------------------------- settings
    @app_routes.get("/tagcomplete/settings")
    async def tagcomplete_get_settings(request):
        return _json(load_settings())

    @app_routes.post("/tagcomplete/settings")
    async def tagcomplete_post_settings(request):
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        if payload.pop("__refresh__", False):
            tc_data.refresh()
        return _json(save_settings(payload))

    # ----------------------------------------------------------------- files
    @app_routes.get("/tagcomplete/file")
    async def tagcomplete_file(request):
        name = request.query.get("name", "")
        path = tc_data.resolve_tag_file(name)
        if path is None:
            return web.Response(status=404)
        try:
            body = path.read_bytes()
        except Exception as exc:  # noqa: BLE001
            return _json({"error": str(exc)}, status=500)
        return web.Response(
            body=body,
            content_type="application/json" if path.suffix.lower() == ".json" else "text/csv",
            headers=_no_cache(),
        )

    @app_routes.get("/tagcomplete/wildcard")
    async def tagcomplete_wildcard(request):
        base = request.query.get("base", "")
        filename = request.query.get("file", "")
        content = tc_data.wildcard_contents(base, filename)
        if content is None:
            return web.Response(status=404)
        return web.Response(text=content, content_type="text/plain", headers=_no_cache())

    # ----------------------------------------------------------- model extras
    @app_routes.get("/tagcomplete/model-info")
    async def tagcomplete_model_info(request):
        kind = request.query.get("kind", "loras")
        name = request.query.get("name", "")
        return _json(tc_data.model_info(kind, name))

    @app_routes.get("/tagcomplete/model-keywords")
    async def tagcomplete_model_keywords(request):
        kind = request.query.get("kind", "loras")
        name = request.query.get("name", "")
        return _json({"keywords": tc_data.model_keywords(kind, name)})

    @app_routes.get("/tagcomplete/preview")
    async def tagcomplete_preview(request):
        kind = request.query.get("kind", "loras")
        name = request.query.get("name", "")
        path = tc_data.find_preview(kind, name)
        if path is None:
            return web.Response(status=404)
        try:
            body = path.read_bytes()
        except Exception:
            return web.Response(status=404)
        suffix = path.suffix.lower().lstrip(".")
        content_type = {
            "png": "image/png",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "webp": "image/webp",
            "gif": "image/gif",
            "avif": "image/avif",
            "jxl": "image/jxl",
        }.get(suffix, "application/octet-stream")
        return web.Response(body=body, content_type=content_type, headers=_no_cache())

    # ------------------------------------------------------------- frequency
    @app_routes.post("/tagcomplete/frequency/counts")
    async def tagcomplete_frequency_counts(request):
        db = tc_data.usage_db
        if db is None or db.error:
            return _json({"result": []})
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        names = payload.get("names") or []
        types = payload.get("types") or []
        negative = bool(payload.get("neg"))
        max_age = load_settings().get("frequencyMaxAge", 30)
        try:
            max_age = int(max_age)
        except Exception:
            max_age = 30
        if max_age <= 0:
            max_age = None
        try:
            rows = db.counts(names, types, negative, max_age)
        except Exception as exc:  # noqa: BLE001
            return _json({"result": [], "error": str(exc)})
        return _json({"result": rows})

    @app_routes.post("/tagcomplete/frequency/increase")
    async def tagcomplete_frequency_increase(request):
        db = tc_data.usage_db
        if db is None or db.error:
            return _json({"ok": False})
        name = request.query.get("name", "")
        tag_type = request.query.get("type", "1")
        negative = request.query.get("neg", "0").lower() in ("1", "true", "yes")
        if not name:
            return _json({"ok": False}, status=400)
        try:
            db.increase(urllib.parse.unquote(name), tag_type, negative)
        except Exception as exc:  # noqa: BLE001
            return _json({"ok": False, "error": str(exc)})
        return _json({"ok": True})

    @app_routes.post("/tagcomplete/frequency/reset")
    async def tagcomplete_frequency_reset(request):
        db = tc_data.usage_db
        if db is None or db.error:
            return _json({"ok": False})
        name = request.query.get("name", "")
        tag_type = request.query.get("type", "1")
        pos = request.query.get("pos", "1").lower() in ("1", "true", "yes")
        neg = request.query.get("neg", "1").lower() in ("1", "true", "yes")
        try:
            db.reset(urllib.parse.unquote(name), tag_type, pos, neg)
        except Exception as exc:  # noqa: BLE001
            return _json({"ok": False, "error": str(exc)})
        return _json({"ok": True})

    @app_routes.get("/tagcomplete/frequency/all")
    async def tagcomplete_frequency_all(request):
        db = tc_data.usage_db
        if db is None or db.error:
            return _json({"result": []})
        try:
            rows = db.all_counts()
        except Exception as exc:  # noqa: BLE001
            return _json({"result": [], "error": str(exc)})
        return _json({"result": rows})


if routes is not None:
    register(routes)
