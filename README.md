# mapemounde-web

A small, build-free static website for the **mapemounde** star-system generator,
aimed at game masters: roll a system, judge it at a glance, dig into the details.
It is a pure client: an HTML form that makes GET calls to the REST API and renders
the JSON. The API itself lives in the separate **mapemounde-api** project
(`../mapemounde-api`).

## What you see

For the three system generators (2300 AD, BattleTech, Architect of Worlds) each roll
draws an **orrery**: a schematic map with the star at the left, one orbit per body,
and glyphs whose size follows the body's radius and whose colour follows what it is —
banded tan gas giants, and rocky worlds tinted from ice white through ocean blue-green
to hothouse yellow. Rings, asteroid belts, moon counts and each book's own habitability
flag are drawn too, and a legend beneath explains the marks in use. Hovering a glyph
(or tapping it) shows a card of headline facts with a link to the body's full record in
the folded **System detail** tree below; hovering a record lights its glyph. The raw
JSON is one fold further down. The Traveller page draws the Classic Traveller system hex
instead, with a name field and an SVG download.

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
