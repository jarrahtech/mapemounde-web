"use strict";

// Shared by the hub and every generator page: where the API lives.
//
// In dev (the page is served from localhost) it resolves the base most-specific first — a ?api=
// query param wins (and is remembered), then a previously saved value, then the built-in default —
// seeds the #apiBase field from it, and remembers edits across visits and pages via localStorage.
//
// In prod (any other host) the base is locked to PROD_API_BASE and the field is hidden: ?api= and
// any saved value are ignored, so a shared link cannot point a visitor's page at another server.
// The field stays in the DOM because app.js reads the base from it.
//
// Wrapped so it declares no globals: app.js is a separate classic script, and a browser holding a
// stale cached copy of one file next to a fresh copy of the other would otherwise hit a duplicate
// top-level declaration, which is a SyntaxError that stops the whole script from running.
(() => {
  const DEFAULT_API_BASE = "http://localhost:8080";
  const PROD_API_BASE = "https://mapemounde-api.jarrahtechnology.com";
  const DEV_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
  const API_BASE_KEY = "mapemounde.apiBase";

  function saveApiBase(value) {
    try {
      localStorage.setItem(API_BASE_KEY, value);
    } catch {
      // Persistence is best-effort; ignore storage failures.
    }
  }

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

  const input = document.getElementById("apiBase");
  if (DEV_HOSTS.includes(location.hostname)) {
    input.value = resolveApiBase();
    input.addEventListener("change", () => saveApiBase(input.value.trim()));
  } else {
    input.value = PROD_API_BASE;
    // readOnly is also how app.js tells the base is locked (it keeps ?api= out of permalinks).
    input.readOnly = true;
    // Hide whatever the page marks data-dev-only around the field: its row, or the whole form on the
    // hub. Set inline because .row and form declare a display of their own, which the hidden
    // attribute cannot beat. Optional, so a stale cached page without the marker does not throw.
    const devOnly = input.closest("[data-dev-only]");
    if (devOnly) devOnly.style.display = "none";
  }
})();
