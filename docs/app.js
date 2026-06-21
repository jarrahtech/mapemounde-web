"use strict";

// A deliberately tiny, build-free client. It maps the form to a GET request against the
// API (one route per generator), then renders the JSON. Seed is always sent as a string
// to match the API contract (Long seeds lose precision as JSON numbers past 2^53).

// Where the API lives. This is the fallback used on first visit; override it for your
// deployment. NB: when this site is served over HTTPS (e.g. GitHub Pages), the browser
// blocks calls to an http:// API as mixed content — the API base must be https:// there.
const DEFAULT_API_BASE = "http://localhost:8080";
const API_BASE_KEY = "mapemounde.apiBase";

// Resolve the API base, most-specific first: a ?api= query param wins (and is remembered),
// then a previously saved value, then the built-in default.
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
  generator: $("generator"),
  seed: $("seed"),
  randomSeed: $("randomSeed"),
  starType: $("starType"),
  earthLike: $("earthLike"),
  status: $("status"),
  result: $("result"),
  rendered: $("rendered"),
  raw: $("raw"),
};

// Show only the params relevant to the chosen generator.
function syncParams() {
  const gen = els.generator.value;
  document.querySelectorAll(".param").forEach((el) => {
    el.hidden = el.dataset.param !== gen;
  });
}

// Build the request URL for the current form state.
function buildUrl() {
  const base = els.apiBase.value.replace(/\/+$/, "");
  const gen = els.generator.value;
  const params = new URLSearchParams({ seed: els.seed.value.trim() });
  if (gen === "btech") params.set("starType", els.starType.value);
  if (gen === "aow") params.set("earthLike", String(els.earthLike.checked));
  return `${base}/api/v1/${gen}?${params.toString()}`;
}

// Render a {value, unit} quantity, or an em dash when absent.
function quantity(q) {
  if (q == null) return '<span class="unit">—</span>';
  return `${formatNumber(q.value)}<span class="unit">${escapeHtml(q.unit)}</span>`;
}

function formatNumber(v) {
  if (typeof v !== "number" || !isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(3);
  return String(Math.round(v * 10000) / 10000);
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function text(value) {
  return value == null ? '<span class="unit">—</span>' : escapeHtml(value);
}

// SystemView (ad2300, btech, aow): a flattened object list + orbit list.
function renderSystem(data) {
  const objectRows = data.objects
    .map(
      (o) => `<tr>
        <td>${text(o.kind)}</td>
        <td>${text(o.stellarClass)}</td>
        <td class="num">${quantity(o.mass)}</td>
        <td class="num">${quantity(o.radius)}</td>
        <td class="num">${quantity(o.density)}</td>
        <td class="num">${quantity(o.surfaceGravity)}</td>
        <td class="num">${quantity(o.escapeVelocity)}</td>
        <td class="num">${quantity(o.luminosity)}</td>
        <td class="num">${quantity(o.temperature)}</td>
      </tr>`,
    )
    .join("");

  const orbitRows = data.orbits
    .map(
      (o) => `<tr>
        <td>${text(o.obj)}</td>
        <td class="num">${quantity(o.radius)}</td>
        <td class="num">${o.eccentricity == null ? '<span class="unit">—</span>' : formatNumber(o.eccentricity)}</td>
        <td class="num">${quantity(o.blackbody)}</td>
      </tr>`,
    )
    .join("");

  return `
    <div class="card">
      <p class="meta">Generator <strong>${text(data.generator)}</strong> · seed <strong>${text(data.seed)}</strong> · ${data.objects.length} objects · ${data.orbits.length} orbits</p>
      <h2>Objects</h2>
      <table>
        <thead><tr>
          <th>Kind</th><th>Class</th><th>Mass</th><th>Radius</th><th>Density</th>
          <th>Surface g</th><th>Escape v</th><th>Luminosity</th><th>Temp</th>
        </tr></thead>
        <tbody>${objectRows}</tbody>
      </table>
    </div>
    <div class="card">
      <h2>Orbits</h2>
      <table>
        <thead><tr><th>Object</th><th>Radius</th><th>Eccentricity</th><th>Blackbody</th></tr></thead>
        <tbody>${orbitRows}</tbody>
      </table>
    </div>`;
}

// TravellerView: a flat Classic Traveller UWP record.
function renderTraveller(data) {
  const kv = (k, v) => `<dt>${escapeHtml(k)}</dt><dd>${text(v == null ? null : String(v))}</dd>`;
  return `
    <div class="card">
      <p class="meta">Generator <strong>${text(data.generator)}</strong> · seed <strong>${text(data.seed)}</strong></p>
      <dl class="kvs">
        ${kv("Starport", data.starport)}
        ${kv("Naval base", data.navalBase)}
        ${kv("Scout base", data.scoutBase)}
        ${kv("Gas giant", data.gasGiant)}
        ${kv("Travel zone", data.zone)}
        ${kv("Size", data.size)}
        ${kv("Atmosphere", data.atmosphere)}
        ${kv("Water", data.water)}
        ${kv("Population", data.population)}
        ${kv("Government", data.government)}
        ${kv("Law", data.law)}
        ${kv("Tech", data.tech)}
        ${kv("Trade", (data.trade || []).join(", ") || null)}
      </dl>
    </div>`;
}

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

    els.rendered.innerHTML = els.generator.value === "traveller" ? renderTraveller(body) : renderSystem(body);
    els.result.hidden = false;
    setStatus(`OK (${url})`, false);
  } catch (err) {
    // A network/CORS failure lands here (fetch rejects without a response).
    setStatus(`Request failed: ${err.message}. Is the API running at ${els.apiBase.value}?`, true);
  }
}

els.generator.addEventListener("change", syncParams);
els.randomSeed.addEventListener("click", () => {
  // A big seed to show string seeds survive the round trip (past 2^53).
  els.seed.value = String(Math.floor(Math.random() * 9e15));
});
// Remember the API base across visits whenever the user edits it.
els.apiBase.addEventListener("change", () => saveApiBase(els.apiBase.value.trim()));
els.form.addEventListener("submit", generate);

// Seed the field from the saved/override/default base, then show the right params.
els.apiBase.value = resolveApiBase();
syncParams();
