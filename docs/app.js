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
// unchanged. The UWP status line (`wdf`) is rendered below the hex by travellerCardHtml.

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

// --- system orrery ----------------------------------------------------------------------------
// A schematic top-down view of a system: the star at the left, one concentric orbit ellipse per
// body orbiting it, and a labelled glyph where that orbit crosses the baseline. Modelled on the
// classic solar-system infographic, so it is deliberately *not* to scale — real top-level radii
// span 0.03au to 8au, which would collapse every inner body into the star, so orbits are spaced
// evenly by rank and the true radius is printed under each glyph instead.
//
// Stage 1 glyphs are placeholders keyed only on `kind`, which every generator shares, so the orrery
// needs no per-generator code — the same principle the tree renderer follows. bodyLabel() is the
// seam for making the glyphs representative of the data later.
//
// Moons are counted, not drawn: a btech system carries up to ~144 of them (≈40 on one planet), so
// individual moon glyphs would be illegible. Rings are a child of their planet, so they render as a
// Saturn-style ellipse on the parent's glyph rather than as a row entry of their own.
//
// Colours are literal hex rather than var(--…) on purpose: CSS custom properties do not survive an
// SVG download, so the glyph fills mirror the .badge-* palette in styles.css instead of reading it.
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

// Only two glyphs are ever drawn as row entries, because only a star's direct children get a row:
// the planet disc, and the smaller disc of a companion star. Moons, moonlets and rings are always
// nested under a planet, and a belt draws its own dots — so anything else the API puts in orbit
// falls through to the neutral default rather than going missing.
const GLYPH = {
  star: { r: 26 }, // painted with the gradient, so no fill of its own
  planet: { r: 16, fill: "#6ea8fe" },
};
const GLYPH_DEFAULT = { r: 10, fill: MUTED_INK };

const glyphOf = (kind) => GLYPH[kind] || GLYPH_DEFAULT;
const n2 = (v) => v.toFixed(2);

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
    const starR = depth === 0 ? ORRERY.rootStar : GLYPH.star.r;
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
    // Only rx is stored per body; x/y follow from the row, so they are read off it at draw time
    // rather than copied onto every child.
    const bodies = kids.map((node, i) => {
      const rx = lead + i * ORRERY.step;
      // Squash the ellipses sub-linearly so the outermost orbit tops out at maxRy: a straight
      // rx * ratio would make a 14-body system over 900px tall.
      return { node, rx, ry: ORRERY.maxRy * Math.sqrt(rx / maxRx) };
    });

    rows.push({ node: star, x: originX, y: originY, r: starR, bodies, link });
    for (const b of bodies) {
      if (b.node.kind === "star" && (b.node.children || []).length) {
        // Carry the radius the layout chose, so the tether stays attached if the glyph is resized.
        walk(b.node, depth + 1, { x: originX + b.rx, y: originY, r: glyphOf("star").r });
      }
    }
  };

  walk(root, 0, null);
  return rows;
}

function svgText(x, y, content, size, fill, weight = 400) {
  return `<text x="${n2(x)}" y="${n2(y)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${content}</text>`;
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

function starGlyph(x, y, r) {
  return `<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(r * 1.5)}" fill="url(#orreryGlow)" />
    <circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(r)}" fill="url(#orreryStar)" />`;
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
  const g = glyphOf(node.kind);
  // A companion star needs no summary: layoutOrrery gives every star with children a row of its own,
  // so they are all drawn below rather than absorbed into this glyph.
  const kids = node.kind === "star" ? null : childSummary(node);
  const x = row.x + b.rx;
  const y = row.y;
  const parts = [];

  if (node.kind === "asteroidBelt") {
    parts.push(beltGlyph(row, b));
  } else if (node.kind === "star") {
    // A companion star gets the same treatment as a row head, just smaller.
    parts.push(starGlyph(x, y, g.r));
  } else {
    const disc = `<circle cx="${n2(x)}" cy="${n2(y)}" r="${g.r}" fill="${g.fill}" />`;
    if (kids?.ring) {
      // Saturn-style: the ring's far side passes behind the planet and its near side in front, so
      // the ellipse is split at its widest points and the disc drawn between the two halves. A
      // single ellipse would sit wholly on top and read as a hoop in front of the planet.
      // sweep=1 is the top (far) half, sweep=0 the bottom (near) half; both share the same tilt.
      const rx = g.r * 2;
      const ry = g.r * 0.55;
      const half = (sweep) =>
        `<path d="M${n2(x - rx)},${n2(y)} A${n2(rx)},${n2(ry)} 0 0 ${sweep} ${n2(x + rx)},${n2(y)}" fill="none" stroke="${RING_INK}" stroke-width="2.5" transform="rotate(-18 ${n2(x)} ${n2(y)})" />`;
      parts.push(half(1), disc, half(0));
    } else {
      parts.push(disc);
    }
  }

  // Label block: type, then the real orbit radius, then what is in orbit around it. Kept to three
  // lines (satellite counts share one) so every row bottoms out at the same LABEL_DEPTH.
  let line = y + ORRERY.labelTop;
  parts.push(svgText(x, line, escapeHtml(bodyLabel(node)), 12, "currentColor", 600));
  if (node.orbit?.radius) {
    line += ORRERY.lineHeight;
    parts.push(svgText(x, line, orbitLabel(node.orbit.radius), 11, "currentColor"));
  }
  const counts = [];
  if (kids?.moons) counts.push(`${kids.moons} moon${kids.moons === 1 ? "" : "s"}`);
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
  parts.push(starGlyph(row.x, row.y, row.r));
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
  for (const row of rows) {
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
    <defs>
      <radialGradient id="orreryStar" cx="38%" cy="34%" r="72%">
        <stop offset="0%" stop-color="#fff6d0" />
        <stop offset="55%" stop-color="#ffd479" />
        <stop offset="100%" stop-color="#e79a2f" />
      </radialGradient>
      <radialGradient id="orreryGlow">
        <stop offset="55%" stop-color="#ffd479" stop-opacity="0.3" />
        <stop offset="100%" stop-color="#ffd479" stop-opacity="0" />
      </radialGradient>
    </defs>
    ${rows.map(orreryRowSvg).join("")}
  </svg>`;
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
    // The orrery carries the shape of the system; the full per-body detail folds away below it,
    // since a btech tree runs to ~150 nodes.
    return `<div class="card orrery-card">${renderOrrerySvg(data.root)}</div>
      <div class="card">
        ${renderMeta(data, extras)}
        <details class="tree-wrap">
          <summary>System detail</summary>
          <ul class="tree">${renderNode(data.root)}</ul>
        </details>
      </div>`;
  }
  // Traveller is a flat UWP record; show it as the Classic Traveller system hex, with the UWP
  // status line (`wdf`) rendered below the hex.
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
