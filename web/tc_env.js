/** Environment glue: access the ComfyUI app instance and its HTTP API. */

const g = globalThis;

function pick() {
  let app = null;
  let api = null;
  try {
    app = g.comfyAPI?.app?.app ?? null;
  } catch {
    app = null;
  }
  if (!app) {
    try {
      app = g.app ?? null;
    } catch {
      app = null;
    }
  }
  try {
    api = g.comfyAPI?.api?.api ?? null;
  } catch {
    api = null;
  }
  if (!api) {
    try {
      api = g.api ?? null;
    } catch {
      api = null;
    }
  }
  return { app, api };
}

let { app: APP, api: API } = pick();

export function getApp() {
  if (!APP) {
    const picked = pick();
    APP = picked.app;
    API = picked.api;
  }
  return APP;
}

export function getApi() {
  if (!API) {
    const picked = pick();
    APP = picked.app;
    API = picked.api;
  }
  return API;
}

/** Wait (briefly) until the ComfyUI app object exists. */
export async function waitForApp(timeoutMs = 10000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (getApp()) return APP;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return getApp();
}

export function apiURL(path) {
  const api = getApi();
  const clean = path.startsWith("/") ? path : `/${path}`;
  try {
    if (api?.apiURL) {
      const url = api.apiURL(clean);
      if (url) return url;
    }
  } catch {
    /* ignore */
  }
  return clean;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 200)}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function getJSON(path, options = {}) {
  const response = await fetch(apiURL(path), { cache: "no-store", ...options });
  return parseResponse(response);
}

export async function getText(path) {
  const response = await fetch(apiURL(path), { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

export async function postJSON(path, body) {
  const response = await fetch(apiURL(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parseResponse(response);
}

export async function postEmpty(path) {
  const response = await fetch(apiURL(path), { method: "POST" });
  return parseResponse(response);
}

export function toast(summary, detail = "", severity = "info") {
  try {
    const manager = getApp()?.extensionManager;
    if (manager?.toast?.add) {
      manager.toast.add({ severity, summary, detail, life: 4000 });
      return;
    }
    if (typeof getApp()?.ui?.toast === "function") {
      getApp().ui.toast(summary, detail);
      return;
    }
  } catch {
    /* ignore */
  }
  console.log(`[TagComplete] ${summary}`, detail);
}

export function logWarn(...args) {
  console.warn("[TagComplete]", ...args);
}
