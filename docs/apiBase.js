"use strict";

// Shared by the hub and every generator page: where the API lives. Resolves the base most-specific
// first — a ?api= query param wins (and is remembered), then a previously saved value, then the
// built-in default — seeds the #apiBase field from it, and remembers edits across visits and pages
// via localStorage. NB: when this site is served over HTTPS (e.g. GitHub Pages) the browser blocks
// calls to an http:// API as mixed content — the API base must be https:// there.
//
// Wrapped so it declares no globals: app.js is a separate classic script, and a browser holding a
// stale cached copy of one file next to a fresh copy of the other would otherwise hit a duplicate
// top-level declaration, which is a SyntaxError that stops the whole script from running.
(() => {
  const DEFAULT_API_BASE = "http://localhost:8080";
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
  input.value = resolveApiBase();
  input.addEventListener("change", () => saveApiBase(input.value.trim()));
})();
