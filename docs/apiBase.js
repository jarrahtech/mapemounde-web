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
    // Hide the field's row — or the whole form when the field is all it holds (the hub). Set inline
    // because .row and form declare a display of their own, which the hidden attribute cannot beat.
    const row = input.closest(".row");
    const form = input.closest("form");
    const target = form.querySelectorAll(".row").length > 1 ? row : form;
    target.style.display = "none";
  }
})();
