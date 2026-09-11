# mapemounde-web

A tiny, build-free static website that exercises the **mapemounde** star-system
generator. It is a pure client: an HTML form that makes GET calls to the REST API
and renders the JSON. The API itself lives in the separate **mapemounde-api**
project (`../mapemounde-api`).

## Run it

No build step, no dependencies — just serve the `docs/` directory statically:

```bash
cd docs && python3 -m http.server 5173   # then open http://localhost:5173
```

The **API base** field tells the page where `mapemounde-api` is running. It is
remembered across visits (`localStorage`) and can be overridden per-load with a
`?api=` query param; the built-in default is `http://localhost:8080`
(see `DEFAULT_API_BASE` in `docs/apiBase.js`).

**Generate** renders the system for the seed in the form; **🎲 Random** (or the `R` key
when no field has focus) rolls a new seed and generates in one click. Every system you
generate is mirrored into the page URL (`?seed=…` plus the generator's own params), so
the address bar is a permalink, Back/Forward step through earlier systems, and opening a
page with a seed in the URL generates it straight away.

## Hosting on GitHub Pages

The folder is named `docs/` so Pages can serve it directly: repo **Settings → Pages
→ Source: main branch, `/docs`**. Two things the **API** side must satisfy, because
Pages is HTTPS-only and cross-origin:

- **The API must be served over HTTPS** — a browser on `https://…github.io` blocks
  calls to an `http://` API as mixed content (localhost is exempt for dev only).
- **The API must send CORS headers** allowing the Pages origin (configured in
  `mapemounde-api`, not here).
