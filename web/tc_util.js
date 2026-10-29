/** Small helpers shared by the tag autocomplete modules. */

/**
 * Parse one line of CSV honouring quoted fields (quotes never span lines in the
 * bundled data sets - same limitation as the A1111 extension).
 */
function parseQuotedLine(line) {
  const cells = [];
  let cell = "";
  let quote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && quote && line[i + 1] === '"') {
      cell += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      quote = !quote;
      continue;
    }
    if (ch === "," && !quote) {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += ch;
  }
  cells.push(cell);
  return cells;
}

/**
 * Parse a CSV string into a 2D array, one entry per line (no header row).
 *
 * The bundled tag files are 6-7 MB with quoted alias columns, so a per line
 * split with a quoted-field fallback is used instead of a full character loop:
 * ~4x faster on the merged data set while producing identical rows.
 */
export function parseCSV(str) {
  const rows = [];
  const length = str.length;
  let start = 0;
  while (start < length) {
    let end = str.indexOf("\n", start);
    if (end === -1) end = length;
    let line = str.substring(start, end);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line.length) rows.push(line.includes('"') ? parseQuotedLine(line) : line.split(","));
    start = end + 1;
  }
  return rows;
}

export function escapeRegExp(string, wildcardMatching = false) {
  if (string === null || string === undefined) return "";
  if (wildcardMatching) {
    return String(string)
      .replace(/[-[\]{}()+.,\\^$|#\s]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
  }
  return String(string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function escapeHTML(unsafe) {
  const div = document.createElement("div");
  div.textContent = unsafe === null || unsafe === undefined ? "" : String(unsafe);
  return div.innerHTML;
}

let dbTimer;
export function debounce(func, wait = 300) {
  return function (...args) {
    if (dbTimer) clearTimeout(dbTimer);
    dbTimer = setTimeout(() => func.apply(this, args), wait);
  };
}

/** Difference of two arrays including duplicate counts. */
export function difference(a, b) {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  return [
    ...b.reduce(
      (acc, v) => acc.set(v, (acc.get(v) || 0) - 1),
      a.reduce((acc, v) => acc.set(v, (acc.get(v) || 0) + 1), new Map())
    ),
  ].reduce((acc, [v, count]) => acc.concat(Array(Math.abs(count)).fill(v)), []);
}

export function flatten(obj, roots = [], sep = ".") {
  return Object.keys(obj || {}).reduce(
    (memo, prop) =>
      Object.assign(
        {},
        memo,
        Object.prototype.toString.call(obj[prop]) === "[object Object]"
          ? flatten(obj[prop], roots.concat([prop]), sep)
          : { [roots.concat([prop]).join(sep)]: obj[prop] }
      ),
    {}
  );
}

export function toNgrams(inputArray, size) {
  return Array.from({ length: Math.max(0, inputArray.length - (size - 1)) }, (_, index) =>
    inputArray.slice(index, index + size)
  );
}

/** Compact number formatting identical to the Danbooru style used by the original. */
export function formatCount(postCount) {
  let formatter;
  if (postCount >= 1000000 || (postCount >= 1000 && postCount < 10000)) {
    formatter = new Intl.NumberFormat("en", {
      notation: "compact",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  } else {
    formatter = new Intl.NumberFormat("en", { notation: "compact" });
  }
  return formatter.format(postCount);
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function deepMerge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!patch || typeof patch !== "object") return out;
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value) && base && typeof base[key] === "object") {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function getByPath(obj, path, fallback = undefined) {
  const parts = String(path).split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return fallback;
    current = current[part];
  }
  return current === undefined ? fallback : current;
}

export function setByPath(obj, path, value) {
  const parts = String(path).split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]] || typeof current[parts[i]] !== "object") current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

/* ------------------------------------------------------------------------- *
 * Caret position inside a textarea (from component/textarea-caret-position)
 * ------------------------------------------------------------------------- */
const MIRROR_PROPERTIES = [
  "direction",
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "textDecoration",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "MozTabSize",
];

const IS_FIREFOX = typeof window !== "undefined" && window.mozInnerScreenX != null;

/**
 * Coordinates of a caret position, relative to the element's padding box.
 * @returns {{top:number,left:number,height:number}}
 */
export function getCaretCoordinates(element, position) {
  const div = document.createElement("div");
  div.id = "input-textarea-caret-position-mirror-div";
  document.body.appendChild(div);

  const style = div.style;
  const computed = window.getComputedStyle(element);
  const isInput = element.nodeName === "INPUT";

  style.whiteSpace = "pre-wrap";
  if (!isInput) style.wordWrap = "break-word";
  style.position = "absolute";
  style.visibility = "hidden";
  style.overflow = "hidden";

  for (const prop of MIRROR_PROPERTIES) {
    try {
      style[prop] = computed[prop];
    } catch {
      /* ignore */
    }
  }

  if (IS_FIREFOX && element.scrollHeight > parseInt(computed.height, 10)) {
    style.overflowY = "scroll";
  }

  div.textContent = element.value.substring(0, position);
  if (isInput) div.textContent = div.textContent.replace(/\s/g, "\u00a0");

  const span = document.createElement("span");
  span.textContent = element.value.substring(position) || ".";
  div.appendChild(span);

  const coordinates = {
    top: span.offsetTop + parseInt(computed.borderTopWidth, 10),
    left: span.offsetLeft + parseInt(computed.borderLeftWidth, 10),
    height: parseInt(computed.lineHeight, 10) || 16,
  };

  document.body.removeChild(div);
  return coordinates;
}

export function uid() {
  return `tac${Math.random().toString(36).slice(2, 9)}`;
}
