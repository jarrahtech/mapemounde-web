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

// The API base field is resolved, seeded and persisted by apiBase.js (loaded before this script,
// and shared with the hub page); this script only reads it when building a request.
const DASH = '<span class="unit">—</span>';

const $ = (id) => document.getElementById(id);

const els = {
  form: $("form"),
  apiBase: $("apiBase"),
  seed: $("seed"),
  random: $("random"),
  status: $("status"),
  result: $("result"),
  rendered: $("rendered"),
  raw: $("raw"),
  systemName: $("systemName"), // traveller page only; null elsewhere
  downloadSvg: $("downloadSvg"),
};

const GENERATOR = document.body.dataset.generator;

// The seed plus every per-generator param, as the form currently has them. Per-generator params
// are any inputs marked data-param="<name>" on the page (a checkbox contributes true/false). The
// same set is both the query string sent to the API and the page's own permalink.
function formParams() {
  const params = new URLSearchParams({ seed: els.seed.value.trim() });
  document.querySelectorAll("[data-param]").forEach((el) => {
    params.set(el.dataset.param, el.type === "checkbox" ? String(el.checked) : el.value);
  });
  return params;
}

function buildUrl() {
  const base = els.apiBase.value.replace(/\/+$/, "");
  return `${base}/api/v1/${GENERATOR}?${formParams()}`;
}

// Fill the form from the page URL. Returns true when the URL names a system (carries a seed);
// params the URL leaves out keep whatever the form already has.
function readUrlParams() {
  const q = new URLSearchParams(location.search);
  if (!q.has("seed")) return false;
  els.seed.value = q.get("seed");
  document.querySelectorAll("[data-param]").forEach((el) => {
    const v = q.get(el.dataset.param);
    if (v === null) return;
    if (el.type === "checkbox") el.checked = v === "true";
    else el.value = v;
  });
  return true;
}

// Mirror the system just generated into the page URL, so it is a permalink and Back/Forward step
// through earlier systems. The first system *replaces* the seedless entry rather than stacking on
// it, so Back never lands on an empty page. A ?api= the visitor arrived with is carried along, so a
// shared link keeps pointing at the same server; nothing else from the old query survives.
function pushUrlParams() {
  const current = new URLSearchParams(location.search);
  const next = formParams();
  if (current.has("api")) next.set("api", current.get("api"));
  const search = `?${next}`;
  if (search === location.search) return;
  history[current.has("seed") ? "pushState" : "replaceState"](null, "", search);
}

// --- formatting helpers -----------------------------------------------------------------------

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
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

// A short headline for a body: stellar class for stars, else the most specific body-type label the
// node offers. Each generator names that field differently (ad2300 body.world, btech planet/moon
// planetType, aow bodyType), so this chain *is* per-generator knowledge — the one deliberate
// exception to this client's generic-renderer rule, kept in a single ordered accessor so the tree
// and the orrery caption a body identically. It is order-sensitive: reordering re-captions both.
// The chain is also incomplete by construction (aow rings carry ringDensity, not ringType, so they
// fall through to "Ring"). The real fix is a label on the node from mapemounde-api's view layer,
// which would collapse this to `node.label || humanize(node.kind)`.
function bodyLabel(node) {
  return (
    node.core?.stellarClass || node.bodyType || node.body?.world || node.planet?.planetType ||
    node.moon?.planetType || node.ringType || humanize(node.kind)
  );
}

// --- svg helpers ------------------------------------------------------------------------------

const n2 = (v) => v.toFixed(2);

function svgText(x, y, content, size, fill, weight = 400) {
  return `<text x="${n2(x)}" y="${n2(y)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${content}</text>`;
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
// as inline SVG (self-contained colours, vector glyphs) so downloadSvg() can export it unchanged.
// The UWP status line (`wdf`) is rendered below the hex by travellerCardHtml.

// A 5-point star path centred on (cx, cy), so the marker renders without relying on a font glyph.
function starPath(cx, cy, outer, inner) {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    d += `${i === 0 ? "M" : "L"}${n2(cx + r * Math.cos(a))},${n2(cy + r * Math.sin(a))}`;
  }
  return d + "Z";
}

function renderTravellerSvg(data, name) {
  // The starport class is the first character of the World Data Form the API sends ("E253686-6 …").
  const letter = String(data.wdf ?? "").charAt(0) || "?";
  const hasOceans = typeof data.water === "number" && data.water > 0;
  // World symbol: solid disc when there are oceans, hollow circle when there are none. Colours use
  // currentColor so the hex inherits the page text colour on-screen and defaults to black when the
  // SVG is opened standalone (e.g. after a download). Background stays transparent.
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
    ${svgText(130, 74, escapeHtml(letter), 40, "currentColor", 700)}
    ${naval}
    ${scout}
    ${gasGiant}
    ${world}
    ${nameText}
  </svg>`;
}

function travellerCardHtml(data, name) {
  // The UWP status line sits below the hex (the API now emits it as `wdf`): the world profile string
  // plus base/trade codes. Shown verbatim and monospaced so the columns line up as Traveller prints them.
  const uwp = data.wdf
    ? `<p class="uwp">${escapeHtml(String(data.wdf).trim())}</p>`
    : "";
  return `<div class="card hex-card">${renderTravellerSvg(data, name)}</div>${uwp}`;
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
  const base = (els.systemName.value || lastTravellerData?.seed || "hex")
    .trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "hex";
  const a = document.createElement("a");
  a.href = url;
  a.download = `traveller-${base}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

// Last traveller payload, so the name field can re-render the hex without re-fetching.
let lastTravellerData = null;

// Everything the traveller page does with a payload: draw the hex with the current name, keep the
// payload for live re-drawing as the name is typed, then fit the name to the hex (which must run
// after the SVG is in the DOM).
function showTraveller(data) {
  lastTravellerData = data;
  els.rendered.innerHTML = travellerCardHtml(data, els.systemName.value);
  fitHexName();
}

// --- system orrery ----------------------------------------------------------------------------
// A schematic top-down view of a system: the star at the left, one concentric orbit ellipse per
// body orbiting it, and a labelled glyph where that orbit crosses the baseline. Modelled on the
// classic solar-system infographic, so it is deliberately *not* to scale — real top-level radii
// span 0.03au to 8au, which would collapse every inner body into the star, so orbits are spaced
// evenly by rank and the true radius is printed under each glyph instead.
//
// Glyph shape is keyed only on `kind` and planet size only on the shared `core.radius`, so the
// orrery needs almost no per-generator code — the same principle the tree renderer follows. The
// exceptions are small, named field chains of the bodyLabel() kind: the caption, which of a book's
// classes are giants, and where a book keeps its temperature and water figures (see planet tints).
//
// Moons are drawn as dots on an arc over their planet, up to eight; past that the arc is full and
// the count is written instead, since a btech planet can carry ~30 and thirty dots would be noise.
// Rings are a child of their planet, so they render as a Saturn-style ellipse on the parent's glyph
// rather than as a row entry of their own.
//
// Colours are literal hex rather than var(--…) on purpose: CSS custom properties do not survive an
// SVG download, so the structural inks mirror the .badge-* palette in styles.css instead of reading
// it, and the planet tints are a palette of their own below.
// Structural ink (orbit lines, labels) uses currentColor, so it stays theme-aware on screen and can
// be baked to a solid colour the way downloadSvg() already does for the hex. NB no orrery download
// is wired up yet — this only keeps that option open; recolouring a badge means editing both files.

const ORRERY = {
  step: 120, // horizontal gap between successive orbits
  lead: 70, // gap from the star's edge out to the first orbit
  maxRy: 110, // vertical half-height of the outermost orbit ellipse
  rowGap: 250, // vertical distance from a star's row to a companion star's row
  rootStar: 48, // radius of the system's primary; companions use the standard star glyph
  labelTop: 44, // first label line, measured down from the orbit baseline
  lineHeight: 18,
  padX: 24,
  padY: 22,
};

const MUTED_INK = "#8a94a3";
const RING_INK = "#c2a8e0"; // rings and asteroid belts
const MOON_INK = "#b3bcc8"; // neutral for now; moons are to be coloured by condition later (TODO.md)
const HABITABLE_INK = "#6fcf97";

// Star colour by Harvard spectral class — the leading letter of `core.stellarClass`. These are
// schematic, not photometric: to the eye every star is close to white, so the hues are pushed well
// past life to keep an M dwarf and an A star apart at 26px. Each class gives a hot core, the
// characteristic mid hue, and a deeper limb. The generators between them emit D/F/G/K/L/M/T/Y, and
// btech's HotStars bias adds A/B; O is included to complete the sequence.
const STAR_TINTS = {
  O: { core: "#eaf1ff", mid: "#9bb0ff", edge: "#4c6fd8" },
  B: { core: "#f0f5ff", mid: "#b4c8ff", edge: "#6a8ce0" },
  A: { core: "#ffffff", mid: "#d7e2ff", edge: "#93a9d8" },
  F: { core: "#fffdf5", mid: "#f4efd4", edge: "#c3b585" },
  G: { core: "#fff6d0", mid: "#ffd479", edge: "#e79a2f" },
  K: { core: "#ffe8c2", mid: "#ffab5c", edge: "#d4711f" },
  M: { core: "#ffd3b0", mid: "#ff8155", edge: "#c23f22" },
  L: { core: "#e2a58c", mid: "#a9543f", edge: "#6b2a20" }, // brown dwarf
  T: { core: "#cf92ad", mid: "#7f4266", edge: "#46203c" }, // methane dwarf
  Y: { core: "#9585a2", mid: "#52415f", edge: "#2a2036" },
  D: { core: "#ffffff", mid: "#dcefff", edge: "#93bfe6" }, // white dwarf: D0, D2, …
};

// The class letter, or "G" when the API sends no class or one we don't know — which keeps an
// unclassified star looking exactly as it did before this table existed. Validating against
// STAR_TINTS also means the key is always a safe literal to interpolate into a gradient id.
function starTint(node) {
  const letter = String(node.core?.stellarClass ?? "").trim().charAt(0).toUpperCase();
  return STAR_TINTS[letter] ? letter : "G";
}

// Only two glyphs are ever drawn as row entries, because only a star's direct children get a row:
// the planet disc (sized by planetRadiusPx) and a companion star (painted with its class gradient,
// sized by starRadiusPx). Moons, moonlets and rings are always nested under a planet, and a belt
// draws its own dots — so anything else the API puts in orbit falls through to the neutral default
// rather than going missing.
const GLYPH_DEFAULT = { r: 10, fill: MUTED_INK };

// --- planet tints -----------------------------------------------------------------------------
// A planet's *family* (giant or not) comes from its own book's class, taken as correct: one fact
// per generator, keyed by the page's generator, saying which of that book's classes are giants and
// nothing else — no class from one book is ever mapped onto another's. Its *tint* comes from numbers
// every generator emits: a temperature, and water coverage where the book supplies one. The book's
// class name stays as the caption, verbatim, so the word is the book's and the colour is physics.

const GIANT_CLASSES = {
  ad2300: { GasGiant: "gas" },
  btech: { GasGiant: "gas", IceGiant: "ice" },
  aow: { GasGiant: "gas" },
};

const GIANT_TINTS = {
  gas: { fill: "#c9a672", band: "#a3804f" }, // banded tan
  ice: { fill: "#8fcfe0", band: "#67aec3" }, // pale cyan
};

// Rocky bodies by temperature band, coldest first; `wet` replaces `fill` when the book reports
// meaningful water coverage in a band where it can be liquid. The kelvin thresholds apply to a
// *surface* temperature and are presentation choices, not book rules — roughly Europa, Mars,
// Earth, Mercury and Venus as the landmarks.
const ROCK_TINTS = [
  { name: "frozen", below: 200, fill: "#e6eef4" }, // ice white
  { name: "cold", below: 260, fill: "#6a8fc4" }, // steel blue — a clear step from ice white
  { name: "temperate", below: 330, fill: "#9c8f7c", wet: "#3aa08e" }, // dun rock, or ocean green-teal
  { name: "hot", below: 500, fill: "#c98b3f" }, // ochre
  { name: "hothouse", below: Infinity, fill: "#e3c45a" }, // Venus yellow
];
const WET_COVERAGE = 0.3; // water fraction at or above which a temperate world reads as ocean

// ad2300 states a temperature in words (its AverageTemperature enum) rather than a surface figure,
// and only that word reflects the atmosphere: its HotHouse worlds sit at 330–450K blackbody, which
// the kelvin bands would call merely hot (Venus's own blackbody temperature is a cool 230K). Where a
// book states a temperature, that statement wins over a number we would have to interpret.
const TEMP_WORDS = { VeryCold: "frozen", Cold: "cold", Temperate: "temperate", Hot: "hot", VeryHot: "hothouse" };

// A planet's surface temperature in kelvin from whichever field its generator supplies: btech and
// aow give one directly; the orbit's blackbody temperature (or aow's min/max pair) is the fallback
// for a body with neither that nor a temperature word. Null when nothing readable is there.
function planetTempK(node) {
  const kelvin = (q) => (isQuantity(q) && q.unit === "K" ? q.value : null);
  const direct =
    kelvin(node.planet?.habitability?.temperature) ??
    kelvin(node.world?.climate?.averageSurfaceTemperature) ??
    kelvin(node.orbit?.blackbody);
  if (direct !== null) return direct;
  const lo = kelvin(node.orbit?.blackbodyMin);
  const hi = kelvin(node.orbit?.blackbodyMax);
  return lo !== null && hi !== null ? (lo + hi) / 2 : null;
}

// The temperature band for a rocky body: the book's word when it gives one, else its kelvin figure.
function rockBand(node) {
  const word = TEMP_WORDS[node.body?.temp];
  if (word) return ROCK_TINTS.find((b) => b.name === word);
  const t = planetTempK(node);
  return t === null ? null : ROCK_TINTS.find((b) => t < b.below);
}

// Water coverage as a 0–1 fraction where the book supplies one (ad2300 `body.water`, aow
// `hydrosphere.hydrographicCoverage`); btech has no such figure, so its worlds are never "wet".
function waterFraction(node) {
  const w = node.body?.water ?? node.world?.hydrosphere?.hydrographicCoverage;
  return typeof w === "number" && isFinite(w) ? w : null;
}

// Returns the fill (and band colour for a giant) plus a `key` naming the choice — a giant kind, a
// rock band name, "ocean" or "unknown" — which is what the legend lists.
function planetTint(node) {
  const giant = GIANT_CLASSES[GENERATOR]?.[bodyLabel(node)];
  if (giant) return { key: giant, ...GIANT_TINTS[giant] };
  const band = rockBand(node);
  if (!band) return { key: "unknown", fill: MUTED_INK };
  const wet = band.wet && (waterFraction(node) ?? 0) >= WET_COVERAGE;
  return wet ? { key: "ocean", fill: band.wet } : { key: band.name, fill: band.fill };
}

// The book's own habitability flag — ad2300 `humanOxygen`, btech `habitability.habitable`, aow
// `atmosphere.breathable` — shown as one green dot beneath the glyph when set, and nothing when not.
// Which flag stands for "habitable" is each book's call, not this client's (see TODO.md), so there is
// no marginal/hostile scale and no inference from temperature or water.
function habitableFlag(node) {
  return (
    (node.body?.humanOxygen ?? node.planet?.habitability?.habitable ?? node.world?.atmosphere?.breathable) === true
  );
}

const MOON_DOTS_MAX = 8;

// Moons as tiny dots on an arc over the planet — the classic satellite sketch — so a glance separates
// a moon or two from a retinue. The arc opens with the count (22.5° per extra moon, to a 90° crown)
// and its radius grows so the dots stay 4.5px apart; a 90° cone keeps clear of a ring's tips, which
// sit near the horizontal.
function moonDots(x, y, r, moons) {
  const n = Math.min(moons, MOON_DOTS_MAX);
  if (n === 0) return "";
  const span = (Math.min(90, 22.5 * (n - 1)) * Math.PI) / 180;
  const radius = Math.max(r + 7, n > 1 ? (4.5 * (n - 1)) / span : 0);
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (n > 1 ? -span / 2 + (i * span) / (n - 1) : 0);
    return `<circle cx="${n2(x + radius * Math.cos(a))}" cy="${n2(y + radius * Math.sin(a))}" r="1.7" fill="${MOON_INK}" />`;
  }).join("");
}

// A Saturn-style ring round a disc of radius r. The far half passes behind the planet and the near
// half in front, so the ellipse is split at its widest points for the caller to draw the disc between
// them; a single ellipse would sit wholly on top and read as a hoop in front of the planet. The ring
// scales with the disc but has a floor, so a ringed dwarf still reads as ringed rather than as a dot
// with a line through it.
function ringPaths(x, y, r) {
  const rx = Math.max(2 * r, 14);
  const ry = rx * 0.275;
  // sweep=1 is the top (far) half, sweep=0 the bottom (near) half; both share the same tilt.
  const half = (sweep) =>
    `<path d="M${n2(x - rx)},${n2(y)} A${n2(rx)},${n2(ry)} 0 0 ${sweep} ${n2(x + rx)},${n2(y)}" fill="none" stroke="${RING_INK}" stroke-width="2.5" transform="rotate(-18 ${n2(x)} ${n2(y)})" />`;
  return { far: half(1), near: half(0) };
}

// Three bands across a giant's disc, drawn as chords of the circle so no clipPath (and no per-glyph
// id) is needed. They shrink with the disc and simply vanish into it on a very small giant.
function giantBands(x, y, r, colour) {
  const width = n2(Math.max(1, r * 0.13));
  return [-0.42, 0.08, 0.5]
    .map((f) => {
      const dy = f * r;
      const half = Math.max(0, Math.sqrt(r * r - dy * dy) - 0.6);
      return `<line x1="${n2(x - half)}" y1="${n2(y + dy)}" x2="${n2(x + half)}" y2="${n2(y + dy)}" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" />`;
    })
    .join("");
}

// A radius quantity in metres, whatever unit its generator used: planets arrive in km (ad2300,
// btech) or m (aow); stars in R☉, except white and brown dwarfs, which arrive in km. Unknown units
// give null rather than a guess. (Earth-relative values from the API would retire this table — see
// TODO.md, API suggestion 4.)
const EARTH_RADIUS_M = 6.371e6;
const SUN_RADIUS_M = 6.957e8;
const RADIUS_UNIT_M = { m: 1, km: 1e3, "R🜨": EARTH_RADIUS_M, "R⊕": EARTH_RADIUS_M, "R☉": SUN_RADIUS_M };

function radiusM(q) {
  const scale = q && RADIUS_UNIT_M[q.unit];
  return scale && typeof q.value === "number" && isFinite(q.value) ? q.value * scale : null;
}

// Planet disc radius on a log scale of the body's real radius. Log rather than linear because
// planet radii span two orders of magnitude (a 350km dwarf to a super-jovian), and a linear scale
// would draw every terrestrial as a pixel beside a gas giant. Anchored so Earth is 10px and Jupiter
// (~11.2 R🜨) lands exactly on the 22px cap; the 5px floor keeps a dwarf a visible, clickable dot.
// A radius the client can't read draws Earth-sized rather than vanishing.
const PLANET_PX = { earth: 10, min: 5, max: 22 };
PLANET_PX.perDecade = (PLANET_PX.max - PLANET_PX.earth) / Math.log10(11.2);

function planetRadiusPx(node) {
  const m = radiusM(node.core?.radius);
  if (m === null) return PLANET_PX.earth;
  const px = PLANET_PX.earth + PLANET_PX.perDecade * Math.log10(m / EARTH_RADIUS_M);
  return Math.min(PLANET_PX.max, Math.max(PLANET_PX.min, px));
}

// Companion star glyph radius, on a log scale *relative to the system's primary*, which keeps its
// fixed row-head size. Stars get a scale of their own rather than sharing the planets' because a
// star is a hundred times a planet's radius: one scale for both would make every planet a pixel.
// Equal stars draw equal, a companion a tenth of the primary's radius draws at half size, and the
// floor keeps a white dwarf — Earth-sized in reality — a small star rather than a planet, since it
// still heads a row of its own. The cap sits a little above the primary because the root is not
// always the largest star (a giant round a white dwarf occurs), but stays low enough to fit the
// row spacing. A radius the client can't compare draws at the floor.
const STAR_SCALE = { perDecade: 0.5, min: 0.4, max: 1.25 };

function starRadiusPx(star, primary) {
  const rs = radiusM(star.core?.radius);
  const rp = radiusM(primary.core?.radius);
  const scale = rs !== null && rp > 0 ? 1 + STAR_SCALE.perDecade * Math.log10(rs / rp) : STAR_SCALE.min;
  return ORRERY.rootStar * Math.min(STAR_SCALE.max, Math.max(STAR_SCALE.min, scale));
}

// Glyph radius for any body in a star's row. Belts ignore it (they draw their own dots).
function bodyRadiusPx(node, primary) {
  if (node.kind === "star") return starRadiusPx(node, primary);
  if (node.kind === "planet") return planetRadiusPx(node);
  return GLYPH_DEFAULT.r;
}

// What a body's children contribute to its glyph, in one pass: moons and moonlets become a count,
// a ring becomes the Saturn ellipse, and every other kind is counted as "other" rather than dropped.
// The default matters — the folded tree below lists every child, so anything the orrery silently
// discarded would make the two views of the same payload disagree on screen.
function childSummary(node) {
  let moons = 0;
  let ring = false;
  let other = 0;
  for (const c of node.children || []) {
    if (c.kind === "moon" || c.kind === "moonlet") moons += 1;
    else if (c.kind === "ring") ring = true;
    else other += 1;
  }
  return { moons, ring, other };
}

// Place every star and its orbiting bodies on a horizontal row. A companion star (aow systems are
// often binary) is drawn in its primary's row *and* gets a row of its own beneath, tethered back to
// its glyph — hence the recursion rather than a single flat pass. Every row starts at the left
// margin rather than under the companion's glyph: a companion in the outermost orbit would
// otherwise push its own row a screen-width to the right and leave the card mostly empty.
function layoutOrrery(root) {
  const rows = [];
  let nextY = ORRERY.padY + Math.max(ORRERY.maxRy, ORRERY.rootStar);

  const walk = (star, depth, link) => {
    const originY = nextY;
    nextY += ORRERY.rowGap;
    // A companion heads its own row at the size it was drawn in its primary's row (carried in link).
    const starR = depth === 0 ? ORRERY.rootStar : link.r;
    const originX = ORRERY.padX + starR;
    // Order by the radius actually drawn under each glyph, not by array position: the contract
    // promises `id` is depth-first, never that `children` arrives sorted, and an unsorted row would
    // contradict its own labels. Copied before sorting so the tree below still renders the payload's
    // own order. Comparing raw values assumes one unit across a row, which holds — every body
    // orbiting a star carries `au` (it is the nested ring/moon radii that switch to km).
    const orbitOf = (node) => node.orbit?.radius?.value ?? Infinity;
    const kids = [...(star.children || [])].sort((a, b) => orbitOf(a) - orbitOf(b));
    const lead = starR + ORRERY.lead;
    const maxRx = lead + (kids.length - 1) * ORRERY.step;
    // Only rx and the glyph radius are stored per body; x/y follow from the row, so they are read
    // off it at draw time rather than copied onto every child.
    const bodies = kids.map((node, i) => {
      const rx = lead + i * ORRERY.step;
      // Squash the ellipses sub-linearly so the outermost orbit tops out at maxRy: a straight
      // rx * ratio would make a 14-body system over 900px tall.
      return { node, rx, ry: ORRERY.maxRy * Math.sqrt(rx / maxRx), r: bodyRadiusPx(node, root) };
    });

    rows.push({ node: star, x: originX, y: originY, r: starR, bodies, link });
    for (const b of bodies) {
      if (b.node.kind === "star" && (b.node.children || []).length) {
        // Carry the radius the layout chose, so the tether stays attached and the companion's own
        // row head is the same size as its glyph up here.
        walk(b.node, depth + 1, { x: originX + b.rx, y: originY, r: b.r });
      }
    }
  };

  walk(root, 0, null);
  return rows;
}

// The SVG twin of quantity(): a <tspan> for the unit, since an HTML <span> would not render inside
// an <svg>. The number is cut to three significant figures because this is a headline label, not a
// readout — formatNumber's 4dp turns an orbit into "85.2013au". The tree below still shows the
// full-precision value.
function orbitLabel(q) {
  if (q == null) return "";
  const v = q.value;
  // formatNumber already handles the non-number/non-finite contract; only the rounding differs.
  const figure =
    typeof v === "number" && isFinite(v) ? String(Number(v.toPrecision(3))) : formatNumber(v);
  return `${escapeHtml(figure)}<tspan fill="${MUTED_INK}" dx="2">${escapeHtml(q.unit)}</tspan>`;
}

// `ids` prefixes the gradient ids, so the legend's swatch and the orrery can share one page.
function starGlyph(x, y, r, tint, ids = "orrery") {
  return `<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(r * 1.5)}" fill="url(#${ids}Glow${tint})" />
    <circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(r)}" fill="url(#${ids}Star${tint})" />`;
}

// One gradient pair per spectral class actually present, rather than all eleven every time.
function starTintDefs(tints, ids = "orrery") {
  return [...tints]
    .map((t) => {
      const c = STAR_TINTS[t];
      return `<radialGradient id="${ids}Star${t}" cx="38%" cy="34%" r="72%">
        <stop offset="0%" stop-color="${c.core}" />
        <stop offset="55%" stop-color="${c.mid}" />
        <stop offset="100%" stop-color="${c.edge}" />
      </radialGradient>
      <radialGradient id="${ids}Glow${t}">
        <stop offset="55%" stop-color="${c.mid}" stop-opacity="0.3" />
        <stop offset="100%" stop-color="${c.mid}" stop-opacity="0" />
      </radialGradient>`;
    })
    .join("");
}

// Fixed offsets rather than Math.random(), so the same seed always draws the same belt — a system
// that reshuffled its asteroids on every re-render would look like the data had changed.
const BELT_JITTER = [0, 7, -5, 3, -8, 6, -2, 8, -6, 4, -3];

function beltGlyph(row, b) {
  const last = BELT_JITTER.length - 1;
  return BELT_JITTER.map((jitter, k) => {
    const t = (k / last - 0.5) * 0.34; // a short arc of the orbit, centred on the baseline
    const rx = b.rx + jitter;
    const ry = b.ry * (rx / b.rx);
    const cx = row.x + rx * Math.cos(t);
    const cy = row.y + ry * Math.sin(t);
    return `<circle cx="${n2(cx)}" cy="${n2(cy)}" r="${k % 3 === 0 ? 3 : 2}" fill="${RING_INK}" />`;
  }).join("");
}

function bodySvg(row, b) {
  const node = b.node;
  const r = b.r;
  // A companion star needs no summary: layoutOrrery gives every star with children a row of its own,
  // so they are all drawn below rather than absorbed into this glyph.
  const kids = node.kind === "star" ? null : childSummary(node);
  const x = row.x + b.rx;
  const y = row.y;
  const parts = [];

  if (node.kind === "asteroidBelt") {
    parts.push(beltGlyph(row, b));
  } else if (node.kind === "star") {
    // A companion star gets the same treatment as a row head, at its relative size.
    parts.push(starGlyph(x, y, r, starTint(node)));
  } else {
    const tint = node.kind === "planet" ? planetTint(node) : { fill: GLYPH_DEFAULT.fill };
    const disc =
      `<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(r)}" fill="${tint.fill}" />` +
      (tint.band ? giantBands(x, y, r, tint.band) : "");
    if (kids?.ring) {
      const ring = ringPaths(x, y, r);
      parts.push(ring.far, disc, ring.near);
    } else {
      parts.push(disc);
    }
    // Satellites over the glyph, the book's habitability flag under it (between glyph and label:
    // planets never exceed 22px, so the gap below labelTop is always there).
    if (kids?.moons) parts.push(moonDots(x, y, r, kids.moons));
    if (node.kind === "planet" && habitableFlag(node)) {
      parts.push(`<circle cx="${n2(x)}" cy="${n2(y + ORRERY.labelTop - 14)}" r="2.8" fill="${HABITABLE_INK}" />`);
    }
  }

  // Label block: type, then the real orbit radius, then what is in orbit around it that the glyph
  // could not show — a moon count past the dot limit, or bodies of other kinds. Kept to three lines
  // so every row bottoms out at the same LABEL_DEPTH. A companion drawn near the primary's size
  // reaches below labelTop, so its label steps down to clear it, the same clearance a row head's
  // label gets.
  let line = y + Math.max(ORRERY.labelTop, r + 22);
  parts.push(svgText(x, line, escapeHtml(bodyLabel(node)), 12, "currentColor", 600));
  if (node.orbit?.radius) {
    line += ORRERY.lineHeight;
    parts.push(svgText(x, line, orbitLabel(node.orbit.radius), 11, "currentColor"));
  }
  const counts = [];
  if (kids?.moons > MOON_DOTS_MAX) counts.push(`${kids.moons} moons`);
  if (kids?.other) counts.push(`${kids.other} other`);
  if (counts.length) {
    line += ORRERY.lineHeight;
    parts.push(svgText(x, line, counts.join(" · "), 11, MUTED_INK));
  }
  return parts.join("");
}

function orreryRowSvg(row) {
  const parts = [];
  // Dashed tether from the companion's glyph in its primary's row down to its own row. An S-curve
  // rather than a straight line, since the two ends are usually far apart horizontally.
  if (row.link) {
    const sx = row.link.x;
    const sy = row.link.y + row.link.r + 4;
    const ex = row.x;
    const ey = row.y - row.r - 4;
    const mid = sy + (ey - sy) / 2;
    parts.push(`<path d="M${n2(sx)},${n2(sy)} C${n2(sx)},${n2(mid)} ${n2(ex)},${n2(mid)} ${n2(ex)},${n2(ey)}" fill="none" stroke="currentColor" stroke-opacity="0.3" stroke-dasharray="4 4" />`);
  }
  // Orbits first, so the glyphs sit on top of the lines.
  for (const b of row.bodies) {
    parts.push(`<ellipse cx="${n2(row.x)}" cy="${n2(row.y)}" rx="${n2(b.rx)}" ry="${n2(b.ry)}" fill="none" stroke="currentColor" stroke-opacity="0.28" stroke-width="1" />`);
  }
  parts.push(starGlyph(row.x, row.y, row.r, starTint(row.node)));
  parts.push(svgText(row.x, row.y + row.r + 22, escapeHtml(bodyLabel(row.node)), 13, "currentColor", 600));
  for (const b of row.bodies) parts.push(bodySvg(row, b));
  return parts.join("");
}

// How far a row's label block reaches below its baseline: three lines plus a descender.
const LABEL_DEPTH = ORRERY.labelTop + 2 * ORRERY.lineHeight + 8;

function renderOrrerySvg(root) {
  const rows = layoutOrrery(root);

  let width = 0;
  let height = 0;
  const tints = new Set();
  for (const row of rows) {
    // Every star is drawn twice over: as a row head, and (for a companion) as a body in its
    // primary's row. Collect from both so a gradient is never referenced before it is defined.
    tints.add(starTint(row.node));
    for (const b of row.bodies) if (b.node.kind === "star") tints.add(starTint(b.node));
    // Half a step past the outermost glyph, so its centred label has room to sit.
    const reach = row.bodies.length
      ? row.bodies[row.bodies.length - 1].rx + ORRERY.step / 2
      : row.r;
    width = Math.max(width, row.x + reach + ORRERY.padX);
    // Whichever is deeper: the row's outermost orbit, or its label block. Taken over every row
    // rather than the last one, so the canvas does not depend on the order layoutOrrery emits.
    height = Math.max(height, row.y + Math.max(ORRERY.maxRy, LABEL_DEPTH) + ORRERY.padY);
  }
  const w = Math.ceil(width);
  const h = Math.ceil(height);

  return `<svg class="orrery-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Schematic map of the generated system">
    <defs>${starTintDefs(tints)}</defs>
    ${rows.map(orreryRowSvg).join("")}
  </svg>`;
}

// --- legend -----------------------------------------------------------------------------------
// What the orrery's marks mean, drawn with the orrery's own functions and colours so the two cannot
// drift apart, and listing only the marks the system in front of the reader actually uses — a legend
// decodes the picture at hand, and a full vocabulary would be three rows for a one-row need. The
// scale rules (planet size, orbit spacing, companion size) are one sentence, not swatches. Built per
// generator: the habitability dot is named in each book's own terms rather than as a shared notion
// of "habitable".

const HABITABLE_FLAG_NAME = {
  ad2300: "human-breathable oxygen",
  btech: "habitable",
  aow: "breathable atmosphere",
};

const SWATCH = 22; // rendered size; drawn in a 30-unit box so glyph helpers keep their proportions

// Which marks the orrery drew for this system: the same walk layoutOrrery makes (each star's direct
// children, recursing into companions with children), asking the same functions bodySvg does.
function usedMarks(root) {
  const marks = new Set();
  const visit = (star) => {
    for (const node of star.children || []) {
      if (node.kind === "star") {
        if ((node.children || []).length) visit(node);
        continue;
      }
      if (node.kind === "asteroidBelt") {
        marks.add("belt");
        continue;
      }
      if (node.kind === "planet") {
        marks.add(planetTint(node).key);
        if (habitableFlag(node)) marks.add("habitable");
      }
      const kids = childSummary(node);
      if (kids.ring) marks.add("ring");
      if (kids.moons) marks.add("moons");
    }
  };
  visit(root);
  return marks;
}

function swatch(inner, boxes = 1) {
  return `<svg class="swatch" viewBox="0 0 ${30 * boxes} 30" width="${SWATCH * boxes}" height="${SWATCH}" aria-hidden="true">${inner}</svg>`;
}

function legendHtml(root) {
  const used = usedMarks(root);
  const c = 15; // swatch centre
  const disc = (cx, cy, r, fill) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" />`;
  const rock = ROCK_TINTS[2].fill;
  const items = [];
  const add = (svg, label) => items.push(`<li>${svg}<span>${label}</span></li>`);

  for (const [kind, tint] of Object.entries(GIANT_TINTS)) {
    if (used.has(kind)) add(swatch(disc(c, c, 9, tint.fill) + giantBands(c, c, 9, tint.band)), `${kind} giant`);
  }
  // Rock bands: individually when one or two are present, else as one strip in temperature order,
  // labelled by its ends, since four discs and four words would take a third of the row.
  const bands = ROCK_TINTS.filter((b) => used.has(b.name));
  if (bands.length <= 2) {
    for (const b of bands) add(swatch(disc(c, c, 7, b.fill)), b.name);
  } else {
    const discs = bands.map((b, i) => disc(c + 30 * i, c, 7, b.fill)).join("");
    add(swatch(discs, bands.length), `${bands[0].name} → ${bands[bands.length - 1].name}`);
  }
  if (used.has("ocean")) add(swatch(disc(c, c, 7, ROCK_TINTS.find((b) => b.wet).wet)), "ocean");
  if (used.has("unknown")) add(swatch(disc(c, c, 7, MUTED_INK)), "unknown");
  if (used.has("ring")) {
    const ring = ringPaths(c, c, 6);
    add(swatch(ring.far + disc(c, c, 6, rock) + ring.near), "ring");
  }
  if (used.has("belt")) add(swatch(beltGlyph({ x: c - 10, y: c }, { rx: 10, ry: 40 })), "asteroid belt");
  if (used.has("moons")) add(swatch(disc(c, c + 4, 6, rock) + moonDots(c, c + 4, 6, 5)), `moons (${MOON_DOTS_MAX} max, then a count)`);
  if (used.has("habitable")) {
    add(swatch(disc(c, c - 3, 6, rock) + disc(c, c + 9, 2.8, HABITABLE_INK)), `${HABITABLE_FLAG_NAME[GENERATOR] || "habitable"}, the book's own flag`);
  }

  return `<ul class="legend">${items.join("")}</ul>
    <p class="legend-note">Planets are sized by log radius; orbits are spaced by rank, with the true radius printed beneath; companion stars are sized relative to the primary.</p>`;
}

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
  const title = bodyLabel(node);
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

// The header line: always generator + seed, plus every other system-level key (for aow these are
// age/metallicity/earthLike, for btech starType).
function renderMeta(data) {
  const tail = Object.entries(data)
    .filter(([k]) => !["generator", "seed", "root"].includes(k))
    .map(([k, v]) => ` · ${escapeHtml(humanize(k))} <strong>${renderValue(v)}</strong>`)
    .join("");
  return `<p class="meta">Generator <strong>${text(data.generator)}</strong> · seed <strong>${text(data.seed)}</strong>${tail}</p>`;
}

// A system tree (ad2300/btech/aow). The orrery carries the shape of the system; the full per-body
// detail folds away below it, since a btech tree runs to ~150 nodes.
function render(data) {
  return `<div class="card orrery-card">${renderOrrerySvg(data.root)}${legendHtml(data.root)}</div>
    <div class="card">
      ${renderMeta(data)}
      <details class="tree-wrap">
        <summary>System detail</summary>
        <ul class="tree">${renderNode(data.root)}</ul>
      </details>
    </div>`;
}

// --- wiring -----------------------------------------------------------------------------------

function setStatus(message, isError) {
  els.status.textContent = message;
  els.status.classList.toggle("error", Boolean(isError));
}

// Rapid rolling can leave several fetches in flight; only the latest one may touch the page,
// otherwise a slow older response would overwrite a newer system while the form and URL name it.
let requestId = 0;

// Fetch and render the system the form describes. `updateUrl` is false when the URL already names
// it (a page opened with ?seed=, or Back/Forward restoring one).
async function generate({ updateUrl = true } = {}) {
  const id = ++requestId;
  const url = buildUrl();
  setStatus("Generating…", false);
  els.result.hidden = true;

  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const body = await response.json();
    if (id !== requestId) return;
    els.raw.textContent = JSON.stringify(body, null, 2);

    if (!response.ok) {
      setStatus(`HTTP ${response.status}: ${body.error ?? "request failed"}`, true);
      els.rendered.innerHTML = "";
      els.result.hidden = false;
      return;
    }

    // Traveller is a flat UWP record shown as the system hex; every other generator is a tree.
    if (GENERATOR === "traveller") showTraveller(body);
    else els.rendered.innerHTML = render(body);
    els.result.hidden = false;
    setStatus(`OK (${url})`, false);
    if (updateUrl) pushUrlParams();
  } catch (err) {
    if (id !== requestId) return;
    // A network/CORS failure lands here (fetch rejects without a response).
    setStatus(`Request failed: ${err.message}. Is the API running at ${els.apiBase.value}?`, true);
  }
}

// One click: roll a fresh seed and generate. A big seed, to show string seeds survive the round
// trip (past 2^53).
function randomSystem() {
  els.seed.value = String(Math.floor(Math.random() * 9e15));
  generate();
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  generate();
});
els.random.addEventListener("click", randomSystem);

// R rolls a new system when focus is not in a field (typing an "r" into the seed or name must
// still work, and letters change the selection inside a <select>). Modified R is left to the browser.
document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() !== "r" || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target instanceof Element && event.target.matches("input, select, textarea")) return;
  event.preventDefault();
  randomSystem();
});

// Back/Forward: the URL names the system to show, so re-fetch it (generation is deterministic).
window.addEventListener("popstate", () => {
  if (readUrlParams()) generate({ updateUrl: false });
});

// Traveller-only: the name is a display label, so re-render the hex live as it's typed (no refetch),
// and let the button export the current hex as an SVG. Both controls exist only on the traveller page.
if (els.systemName) {
  els.systemName.addEventListener("input", () => {
    if (lastTravellerData) showTraveller(lastTravellerData);
  });
}
if (els.downloadSvg) els.downloadSvg.addEventListener("click", downloadSvg);

// A page opened with ?seed= (a permalink) generates straight away.
if (readUrlParams()) generate({ updateUrl: false });
