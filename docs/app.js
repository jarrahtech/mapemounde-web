"use strict";

// A deliberately tiny, build-free client. One script serves every generator page: the
// page declares which generator it is via <body data-generator="...">, and any per-generator
// query params via inputs carrying a [data-param] attribute. The script maps that form to a
// GET request against the API, then renders the JSON.
//
// The new API returns a *nested tree* (`root` + `children`) for ad2300/btech/aow, and a flat
// record for traveller. The node shape is uniform — shared `orbit`/`core` objects plus a
// varying set of generator-specific extra keys — so we render orbit/core as labelled grids and
// fall back to a generic recursive renderer for everything else. That keeps this one renderer
// correct for all three trees (and the flat traveller record) without per-generator code.
//
// Seed is always sent as a string to match the API contract (Long seeds lose precision as JSON
// numbers past 2^53).

// Where the API lives. Fallback used on first visit; override it for your deployment. NB: when
// this site is served over HTTPS (e.g. GitHub Pages) the browser blocks calls to an http:// API
// as mixed content — the API base must be https:// there.
const DEFAULT_API_BASE = "http://localhost:8080";
const API_BASE_KEY = "mapemounde.apiBase";
const DASH = '<span class="unit">—</span>';

// Resolve the API base, most-specific first: a ?api= query param wins (and is remembered), then
// a previously saved value, then the built-in default. Shared across every page via localStorage.
function resolveApiBase() {
  const fromQuery = new URLSearchParams(location.search).get("api");
  if (fromQuery) {
    saveApiBase(fromQuery);
    return fromQuery;
  }
  try {
    return localStorage.getItem(API_BASE_KEY) || DEFAULT_API_BASE;
  } catch {
    // localStorage can throw in private-mode / sandboxed contexts — fall back to the default.
    return DEFAULT_API_BASE;
  }
}

function saveApiBase(value) {
  try {
    localStorage.setItem(API_BASE_KEY, value);
  } catch {
    // Persistence is best-effort; ignore storage failures.
  }
}

const $ = (id) => document.getElementById(id);

const els = {
  form: $("form"),
  apiBase: $("apiBase"),
  seed: $("seed"),
  randomSeed: $("randomSeed"),
  status: $("status"),
  result: $("result"),
  rendered: $("rendered"),
  raw: $("raw"),
  systemName: $("systemName"), // traveller page only; null elsewhere
  downloadSvg: $("downloadSvg"),
};

const GENERATOR = document.body.dataset.generator;

// Build the request URL for the current form state. Per-generator params are any inputs marked
// with data-param="<name>" on the page (a checkbox contributes its checked-ness as true/false).
function buildUrl() {
  const base = els.apiBase.value.replace(/\/+$/, "");
  const params = new URLSearchParams({ seed: els.seed.value.trim() });
  document.querySelectorAll("[data-param]").forEach((el) => {
    const name = el.dataset.param;
    params.set(name, el.type === "checkbox" ? String(el.checked) : el.value);
  });
  return `${base}/api/v1/${GENERATOR}?${params.toString()}`;
}

// --- formatting helpers -----------------------------------------------------------------------

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function formatNumber(v) {
  if (typeof v !== "number" || !isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(3);
  return String(Math.round(v * 10000) / 10000);
}

function text(value) {
  if (value === null || value === undefined) return DASH;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return formatNumber(value);
  return escapeHtml(value);
}

// A {value, unit} quantity — the API's self-describing physical-quantity shape.
function isQuantity(v) {
  return (
    v && typeof v === "object" && typeof v.value === "number" &&
    typeof v.unit === "string" && Object.keys(v).length === 2
  );
}

function quantity(q) {
  if (q == null) return DASH;
  return `${formatNumber(q.value)}<span class="unit">${escapeHtml(q.unit)}</span>`;
}

// camelCase / PascalCase key -> a spaced, capitalised label. "surfaceGravity" -> "Surface gravity".
function humanize(key) {
  const spaced = String(key).replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// --- generic value renderer -------------------------------------------------------------------
// Renders any JSON value the API can emit: quantities via quantity(), nested objects as labelled
// grids (recursively), arrays as lists, primitives as text. This is what makes one renderer cover
// every generator's bespoke detail (body, planet, belt, world, rotation, …) with no special cases.

function renderValue(v) {
  if (v === null || v === undefined) return DASH;
  if (isQuantity(v)) return quantity(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return DASH;
    if (v.every((x) => x === null || typeof x !== "object")) return v.map(text).join(", ");
    return `<ul class="list">${v.map((x) => `<li>${renderValue(x)}</li>`).join("")}</ul>`;
  }
  if (typeof v === "object") return renderGrid(Object.entries(v));
  return text(v);
}

// A definition-list grid from [key, value] pairs. Absent values are skipped (the API omits, not
// nulls, but we guard anyway). Returns an em dash when nothing is left to show.
function renderGrid(entries) {
  const rows = entries
    .filter(([, val]) => val !== null && val !== undefined)
    .map(([k, val]) => `<dt>${escapeHtml(humanize(k))}</dt><dd>${renderValue(val)}</dd>`)
    .join("");
  return rows ? `<dl class="grid">${rows}</dl>` : DASH;
}

// --- traveller hex diagram --------------------------------------------------------------------
// The Classic Traveller "system hex": one hexagon carrying the starport class (a letter), base
// markers (★ naval at left, ▲ scout at lower-left), a gas-giant dot (upper-right), and the world
// symbol in the centre — filled when the world has oceans, an open circle when it has none. Drawn
// as inline SVG (self-contained colours, vector glyphs) so stage 2 can offer it as a download
// unchanged. The UWP status line will be added once the API emits it.

const STARPORT_LETTER = {
  Excellent: "A", Good: "B", Routine: "C", Poor: "D", Frontier: "E", None: "X",
};

function starportLetter(name) {
  return STARPORT_LETTER[name] || (name ? String(name).charAt(0).toUpperCase() : "?");
}

// A 5-point star path centred on (cx, cy), so the marker renders without relying on a font glyph.
function starPath(cx, cy, outer, inner) {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    d += `${i === 0 ? "M" : "L"}${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }
  return d + "Z";
}

function renderTravellerSvg(data, name) {
  const letter = starportLetter(data.starport);
  const hasOceans = typeof data.water === "number" && data.water > 0;
  // World symbol: solid disc when there are oceans, hollow circle when there are none. Colours use
  // currentColor so the hex inherits the page text colour on-screen and defaults to black when the
  // SVG is opened standalone (e.g. after a stage-2 download). Background stays transparent.
  // Regular hexagon centred on (130, 120); the world disc sits at that centre.
  const world = hasOceans
    ? `<circle cx="130" cy="120" r="24" fill="currentColor" />`
    : `<circle cx="130" cy="120" r="24" fill="none" stroke="currentColor" stroke-width="3" />`;
  const naval = data.navalBase ? `<path d="${starPath(60, 112, 15, 6)}" fill="currentColor" />` : "";
  const scout = data.scoutBase ? `<polygon points="80,150 92,172 68,172" fill="currentColor" />` : "";
  const gasGiant = data.gasGiant ? `<circle cx="190" cy="78" r="8" fill="currentColor" />` : "";
  // Display-only system name along the bottom-inside edge; fitHexName() shrinks it to fit afterward.
  const label = (name || "").trim();
  const nameText = label
    ? `<text class="hex-name" x="130" y="198" text-anchor="middle" font-family="system-ui, sans-serif" font-size="22" fill="currentColor">${escapeHtml(label)}</text>`
    : "";

  return `<svg class="hex-svg" viewBox="0 0 260 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Traveller system hex">
    <polygon points="75,25 185,25 240,120 185,215 75,215 20,120" fill="none" stroke="currentColor" stroke-width="3" />
    <text x="130" y="74" text-anchor="middle" font-family="system-ui, sans-serif" font-size="40" font-weight="700" fill="currentColor">${escapeHtml(letter)}</text>
    ${naval}
    ${scout}
    ${gasGiant}
    ${world}
    ${nameText}
  </svg>`;
}

function travellerCardHtml(data, name) {
  return `<div class="card hex-card">${renderTravellerSvg(data, name)}</div>`;
}

// Compress an over-long name to stay within the hex's bottom edge (must run after the SVG is in the
// DOM, since it measures the rendered text). Short names are left at their natural size.
function fitHexName() {
  const t = els.rendered.querySelector(".hex-name");
  if (!t || typeof t.getComputedTextLength !== "function") return;
  const MAX_WIDTH = 96;
  if (t.getComputedTextLength() > MAX_WIDTH) {
    t.setAttribute("textLength", String(MAX_WIDTH));
    t.setAttribute("lengthAdjust", "spacingAndGlyphs");
  }
}

// Serialize the on-screen hex to a downloadable SVG file. On screen the ink is currentColor (theme
// aware); a standalone file has no theme, and many SVG viewers (librsvg etc.) don't resolve
// currentColor reliably, so we bake the literal ink colour into the file. Background stays
// transparent (no rect), and we set width/height so viewers have an intrinsic size.
const EXPORT_INK = "#111";

function downloadSvg() {
  const svg = els.rendered.querySelector("svg.hex-svg");
  if (!svg) return;
  const clone = svg.cloneNode(true);
  clone.removeAttribute("class");
  clone.setAttribute("width", "260");
  clone.setAttribute("height", "240");
  const serialized = new XMLSerializer().serializeToString(clone).replace(/currentColor/g, EXPORT_INK);
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + serialized;
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const base = ((els.systemName && els.systemName.value) || lastTravellerData?.seed || "hex")
    .trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "hex";
  const a = document.createElement("a");
  a.href = url;
  a.download = `traveller-${base}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

// Last traveller payload, so the name field can re-render the hex without re-fetching.
let lastTravellerData = null;

// --- tree renderer ----------------------------------------------------------------------------

// Fields every node carries; everything else is generator-specific richness rendered generically.
const STRUCTURAL = new Set(["id", "kind", "orbit", "core", "children"]);

function section(title, html) {
  return `<div class="sect"><h4>${escapeHtml(title)}</h4>${html}</div>`;
}

function nonEmpty(obj) {
  return obj && typeof obj === "object" && Object.keys(obj).length > 0;
}

function renderNode(node) {
  // A short headline: stellar class for stars, else the most specific body-type label available.
  const title =
    node.core?.stellarClass || node.bodyType || node.planet?.planetType ||
    node.moon?.planetType || node.ringType || humanize(node.kind);
  const orbitRadius = node.orbit?.radius ? quantity(node.orbit.radius) : "";

  const sections = [];
  if (nonEmpty(node.orbit)) sections.push(section("Orbit", renderGrid(Object.entries(node.orbit))));
  if (nonEmpty(node.core)) sections.push(section("Core", renderGrid(Object.entries(node.core))));
  for (const [k, val] of Object.entries(node)) {
    if (STRUCTURAL.has(k)) continue;
    sections.push(section(humanize(k), renderValue(val)));
  }

  const kids = (node.children || []).map(renderNode).join("");
  return `<li class="node">
    <div class="node-head">
      <span class="badge badge-${escapeHtml(node.kind)}">${escapeHtml(node.kind)}</span>
      <span class="node-title">${escapeHtml(title)}</span>
      <span class="node-id">#${escapeHtml(node.id)}</span>
      ${orbitRadius ? `<span class="node-orbit">${orbitRadius}</span>` : ""}
    </div>
    <div class="node-detail">${sections.join("")}</div>
    ${kids ? `<ul class="children">${kids}</ul>` : ""}
  </li>`;
}

// The header line: always generator + seed, plus any system-level params (passed in as extras —
// for aow these are age/metallicity/earthLike, for btech starType). The flat record passes no
// extras since the grid below already lists every field.
function renderMeta(data, extras) {
  const tail = extras
    .map(([k, v]) => ` · ${escapeHtml(humanize(k))} <strong>${renderValue(v)}</strong>`)
    .join("");
  return `<p class="meta">Generator <strong>${text(data.generator)}</strong> · seed <strong>${text(data.seed)}</strong>${tail}</p>`;
}

function render(data) {
  if (data.root) {
    const extras = Object.entries(data).filter(([k]) => !["generator", "seed", "root"].includes(k));
    return `<div class="card">${renderMeta(data, extras)}<ul class="tree">${renderNode(data.root)}</ul></div>`;
  }
  // Traveller is a flat UWP record; show it as the Classic Traveller system hex. (The UWP status
  // line will be added below the hex once the API emits it.)
  if (data.generator === "traveller") {
    lastTravellerData = data;
    return travellerCardHtml(data, els.systemName ? els.systemName.value : "");
  }
  // Any other flat record: render every field but the generator/seed shown in the meta line.
  const record = Object.entries(data).filter(([k]) => !["generator", "seed"].includes(k));
  return `<div class="card">${renderMeta(data, [])}${renderGrid(record)}</div>`;
}

// --- wiring -----------------------------------------------------------------------------------

function setStatus(message, isError) {
  els.status.textContent = message;
  els.status.classList.toggle("error", Boolean(isError));
}

async function generate(event) {
  event.preventDefault();
  const url = buildUrl();
  setStatus("Generating…", false);
  els.result.hidden = true;

  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const body = await response.json();
    els.raw.textContent = JSON.stringify(body, null, 2);

    if (!response.ok) {
      setStatus(`HTTP ${response.status}: ${body.error ?? "request failed"}`, true);
      els.rendered.innerHTML = "";
      els.result.hidden = false;
      return;
    }

    els.rendered.innerHTML = render(body);
    if (GENERATOR === "traveller") fitHexName();
    els.result.hidden = false;
    setStatus(`OK (${url})`, false);
  } catch (err) {
    // A network/CORS failure lands here (fetch rejects without a response).
    setStatus(`Request failed: ${err.message}. Is the API running at ${els.apiBase.value}?`, true);
  }
}

els.randomSeed.addEventListener("click", () => {
  // A big seed to show string seeds survive the round trip (past 2^53).
  els.seed.value = String(Math.floor(Math.random() * 9e15));
});
// Remember the API base across visits (and across pages) whenever the user edits it.
els.apiBase.addEventListener("change", () => saveApiBase(els.apiBase.value.trim()));
els.form.addEventListener("submit", generate);

// Traveller-only: the name is a display label, so re-render the hex live as it's typed (no refetch),
// and let the button export the current hex as an SVG. Both controls exist only on the traveller page.
if (els.systemName) {
  els.systemName.addEventListener("input", () => {
    if (!lastTravellerData) return;
    els.rendered.innerHTML = travellerCardHtml(lastTravellerData, els.systemName.value);
    fitHexName();
  });
}
if (els.downloadSvg) els.downloadSvg.addEventListener("click", downloadSvg);

// Seed the API-base field from the saved/override/default base.
els.apiBase.value = resolveApiBase();
