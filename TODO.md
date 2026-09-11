# TODO — making the system pages readable at a glance

Design backlog for the three tree pages (`ad2300`, `btech`, `aow`). The traveller page has its
own hex and is out of scope here. Nothing below is started; effort tags are estimates:
**[S]** an hour or two inside one function · **[M]** a new SVG component or layout change, about
half a day · **[L]** a new interaction model or work that spans this repo and `mapemounde-api`.

## Who this is for, and the loop it serves

Game masters generating systems and worlds for a game. The expected loop is:

1. **Roll** — generate, often many times in a row.
2. **Glance** — judge from the orrery whether the system is suitable.
3. **Dig** — open the fold-out for the worlds that matter.
4. **Keep** — download (later: save) the ones they want, eventually with the text.

Everything below is ordered by how much it helps that loop. Today the orrery encodes order,
count, rings and companion stars; every planet is the same blue disc, and "is anything here
habitable?" is not answered above the fold.

## Principles

- **Graphics carry the headline; the fold-out carries the numbers.** Don't add text panels.
- **The client renders what the API emits.** Where an idea needs a vocabulary shared across
  generators (body class, habitability, zone bounds), prefer adding it to `mapemounde-api`'s
  views (see *API suggestions*) over growing per-generator tables in `app.js`. `bodyLabel()`
  is the one such table today and should shrink, not grow.
- **Two size scales, never one.** Stars on a log scale relative to the primary; planets and
  moons on their own log scale. One scale spanning a star and its planets makes every planet
  a single pixel.
- **Dark on screen, light on paper.** Anything that will be exported or printed must not
  depend on the dark theme or on `currentColor`.

## What the data supports

Survey of 60 seeds per generator against the local API, 2026-09-11:

| | ad2300 | btech | aow |
|---|---|---|---|
| systems with companion stars | 0 | 0 | 31 (24 binary, 7 trinary+) |
| companions carrying planets | — | — | 24 |
| companion separation | — | — | 0.07 au to 14,000 au |
| max planets round one star | 13 | 14 | 14 |
| max moons on one planet | 10 | 31 | 8 |
| belts / rings per 60 systems | 9 / 300 | 54 / 172 | 18 / 56 |
| planet radius unit | km | km | **m** |
| star radius unit | R☉, sometimes **km** | R☉ | R☉, sometimes **km** |
| planet type field | `body.world`: Rock, FailedCore, GasGiant, IceBall, Garden, HotHouse, Desert, Glacier | `planet.planetType`: Terrestrial, GiantTerrestrial, DwarfTerrestrial, GasGiant, IceGiant | `bodyType`: GasGiant, Terrestrial, FailedCore, Leftover |

Three things follow. Companion stars are an AoW-only concern today but a common one there, and
their separations span five orders of magnitude, which the rank-spaced orrery hides completely.
Units are not consistent across generators, so any size-by-radius or Earth-comparison feature
needs a normaliser (client- or server-side). And the three "type" vocabularies are different
*kinds* of classification — surface/climate, size class, formation class — so a shared display
class can't be a rename; it needs a small mapping that belongs with the generator knowledge.

## Phase 1 — the glance

Small, mostly no API change. Together these turn "seven identical discs" into a readable system.

- [x] **One-click random.** A single 🎲 Random button that rolls a seed and fetches; `R`
      outside a field does the same. [S]
- [x] **Seed and params in the URL.** `?seed=…&starType=…` so a system is a permalink, the
      back button works, and a page with a seed auto-generates on load. [S]
- [x] **Planet glyphs sized on a planet log scale.** Radius from `core.radius` normalised to
      Earth radii; 5 px floor for a dwarf up to a 22 px cap that Jupiter lands on. [S–M]
- [x] **Star glyphs sized on a star log scale relative to the primary.** Primary stays the
      row-head size; a companion's radius is scaled by log(R_companion / R_primary), clamped
      so a white dwarf is visibly smaller but never planet-sized. Star radius is normalised
      from R☉ or km (white and brown dwarfs arrive in km). [S]
- [x] **Planet colour: family from the book, tint from physics.** The *family* (giant or
      not) comes from each book's own class, taken as correct: ad2300 `GasGiant`; btech
      `GasGiant`, `IceGiant`; aow `GasGiant`. That is one fact per generator, not a shared
      taxonomy, so it lives in a three-entry client table. The *tint* comes from numbers every
      generator emits: giants banded tan (ice giants pale cyan where the book distinguishes
      them); rocky bodies by temperature from white ice through blue-green temperate to ochre
      and yellow hothouse, with water coverage adding blue where the book supplies it (ad2300,
      aow; btech has no water field). The book's class name stays as the label, verbatim. No
      API change. [M]
- [ ] **Habitability dot under each planet.** Show each book's *own* flag as it stands, no
      interpretation: ad2300 `humanOxygen`, btech `habitability.habitable`, aow
      `atmosphere.breathable`. One dot, on or off. "Habitable" is relative, so no
      marginal/hostile scale unless a book defines one; user-set criteria are a possible later
      layer (see Open questions). [S]
- [ ] **Moons as dots, not words.** Up to ~8 tiny dots in an arc round the planet, then
      "+23". [S]
- [ ] **Legend.** Required as soon as colour and size mean something. [XS]
- [ ] **Fit to width.** See *Shrink vs scroll* below. Shrink with a legibility floor, then
      shed secondary label lines, then wrap. [S for plain scale-to-fit, M with the floor and
      wrapping]

## Phase 2 — the dig

- [ ] **Habitable zone band.** A translucent green wedge between the orbits where liquid
      water is possible, interpolated between neighbouring orbit ellipses because spacing is
      by rank. btech already sends `lifezone`, so do it there first. ad2300 and aow only if
      their books define a zone and the library can expose it (API suggestion 3, under
      consideration); no client-side derivation from luminosity, which would present a zone
      the book never specified. Every star in a multi-star system gets its own band in its own
      row. [M]
- [ ] **Hover card on a glyph.** Four or five headline facts: class, radius vs Earth, gravity,
      temperature, atmosphere. HTML popover positioned off the SVG element. [M]
- [ ] **Click a glyph to open its node.** Expands the fold-out and scrolls to that body;
      hovering a tree node highlights its glyph. Node ids already exist. [S–M]
- [ ] **Planet portrait in the node head.** The orrery glyph at ~24 px beside the badge so
      tree and orrery share an identity. [XS once glyphs exist]
- [ ] **Humanised units in the fold-out.** Periods in days/years rather than seconds, planet
      mass in Earth masses, radius in km, 3–4 significant figures. Client-side conversion or
      API suggestion 4. This is text, but it makes every fold-out section usable. [S]
- [ ] **Earth-comparison bars** beside mass, radius and gravity (Jupiter as the reference
      above ~10 Earth masses). Depends on the unit normaliser. [M]
- [ ] **Atmosphere composition as a stacked bar.** btech `habitability.composition` and aow
      `atmosphere.composition` are already proportion maps. [S]
- [ ] **Moon system as a mini strip.** For a planet with many moons, a compact log-radius
      strip of dots with the moon nodes folded beneath it. btech's fold-out is currently
      dominated by moon records (a 31-moon planet is ~30 screens tall). [M]
- [ ] **Star card.** The primary drawn to scale against a Sun outline, with class, mass,
      luminosity, temperature and lifetime/age. [S]
- [ ] **Summary strip instead of the developer meta line.** Replace "Generator ad2300 · seed
      42" with icon-led counts: star class chip, planets by class, moons, belts, habitable
      worlds, companion count; btech adds jump distance / charge time, aow age and
      metallicity. Keep seed visible but small; drop `#id` from node heads or mute it. [S]

## Phase 3 — keep it

- [ ] **Names.** A display-only system name (as on the traveller page) and optional per-world
      names, drawn in the orrery and carried into exports. Client-side; never sent to the API.
      [S]
- [ ] **Saved systems.** A localStorage list of (generator, seed, params, names) with
      mini-orrery thumbnails; click to restore. Doubles as the "recent rolls" history strip.
      Export/import as JSON so it survives a browser. [M]
- [ ] **Download the orrery as SVG.** Light palette baked at export, as `downloadSvg()` does
      for the hex. [S]
- [ ] **Print stylesheet.** `@media print`: light background, form and raw JSON hidden, all
      details expanded, orrery + summary + one card per world, page breaks between worlds.
      This is the cheapest route to "the text too". [M]
- [ ] **Standalone system sheet.** A self-contained SVG or PDF with orrery, summary and world
      cards, for sharing without the site. [L]

## Phase 4 — bigger, or lower value

- [ ] **Log-distance strip under the orrery.** A thin horizontal log axis with each body at
      its true radius, the habitable zone shaded, belts as bands. For single stars this is a
      nice-to-have; for aow binaries it is the only honest way to show a companion at 14,000
      au next to planets at 0.03 au. Could also label the companion tether with the
      separation as a cheaper first step. [M; tether label S]
- [ ] **Per-planet detail panel.** Click a world for a card with a large portrait, gauges for
      gravity / pressure / temperature, the atmosphere bar and the moon strip. The natural end
      state of Phase 2; where AoW's depth pays off. [L]
- [ ] **Batch roll and pick.** Roll N seeds, show thumbnails, filter by "has a habitable
      world / gas giant / belt / companion". Directly serves the GM loop. [M–L]
- [ ] **Companion-system polish.** Companion glyph and row head coloured and sized by the star
      rules above; each star's own habitable band; separation on the tether. [S each]
- [ ] **Eccentric orbits (aow).** Offset the ellipse by `orbit.eccentricity`. [S, low value]
- [ ] **Animated or scale-toggling orrery.** Fun, low information per unit of effort. [L, low]

## Design notes

### Sizing: two log scales

- **Planets and moons:** `r_px = clamp(10 + k · log10(R / R⊕), 5, 22)` with `k` chosen so
  Jupiter (11.2 R⊕) lands on the cap (`planetRadiusPx()` in `app.js`). Earth = 10 px, a
  0.3 R⊕ dwarf hits the 5 px floor. Moons should reuse the same scale with a 4 px floor, so
  they read as dots.
- **Stars:** the primary keeps its fixed row-head radius. A companion is drawn at
  `r_primary · clamp(1 + 0.5 · log10(R_c / R_root), 0.4, 1.25)` (`starRadiusPx()` in
  `app.js`): equal stars draw equal, a tenth of the radius draws at half size. A T dwarf is
  Jupiter-sized in reality, but it stays on the star scale on purpose: it is a star in the
  tree, it heads a row, and shrinking it to planet size would make the row look headless.
  The cap is above 1 because the root is not always the largest star: one AoW system in 80
  puts a K3 III giant round a D4 white-dwarf primary.
- Both need radius normalised first (planet km vs m; star R☉ vs km). Do the normalisation in
  one place, ideally the API (suggestion 4).

### Shrink vs scroll

Recommendation: **shrink to fit, with a floor.** Compute the orbit step from the available
width; when the step would fall below the point where 11 px labels stop being legible, first
shed the secondary label lines (orbit radius and moon counts move into the hover card), then
wrap the row, and only then scroll. The whole system must be visible for the glance: the body
that decides suitability is often the outermost one, which is exactly the one that scrolls
off-screen today.

The argument for scrolling instead: label size never changes between systems, layout doesn't
jump when re-rolling, and print/export keeps full detail. Those are real, so keep full-size
layout for export and print even if the screen view shrinks. Once the summary strip exists,
the glance needs the orrery less for counting and more for shape, which further favours
shrinking.

### Companion systems

The rank-spaced layout draws a companion at 0.07 au and one at 14,000 au identically. That is
acceptable for the glance only if the separation is visible somewhere: label the tether, and
later add the log-distance strip. Each star row is already independent, so per-star habitable
bands and star-scale sizing drop in without layout changes. Trinary systems recurse already.

### Print and export

- Define ink and glyph colours as CSS custom properties for both a dark and a light palette;
  SVG uses classes on screen. At export, clone the SVG and bake the *computed* colours into
  attributes (the pattern `downloadSvg()` already uses for `currentColor`). That retires the
  literal-hex palette in `app.js`, which exists only because CSS variables don't survive a
  download.
- `@media print` switches to the light palette, hides the form and raw JSON, expands every
  `<details>`, and breaks pages between worlds.

## API suggestions (for `mapemounde-api`'s views)

Guiding rule (decided 2026-09-11): the API reports what each book's algorithm specifies and
does not invent cross-book categories. The three class vocabularies are different *kinds* of
classification and are taken as correct as emitted. Physical quantities and units are fair
game.

1. ~~**`bodyClass` on every body**, a shared enum across generators.~~ **Dropped.** It would
   force the books' classes into categories that could mislead. Colour uses each book's own
   giant classes for the family and physics for the tint (Phase 1).
2. ~~**`habitability` summary on every body.**~~ **Not in the API.** Habitability is relative;
   where a book specifies a flag the client shows that flag, and nothing more. A later option
   is user-set criteria on the web page, purely for display (see Open questions).
3. **`habitableZone { inner, outer }` per star, in au.** btech: yes, it already emits
   `lifezone` in metres, so normalising name and unit is the whole job. ad2300 and aow: only
   if the books define one; whether the library can expose it easily is being checked.
4. **Consistent units across generators**, or Earth-relative twins alongside the existing
   quantities: `radiusEarth`, `massEarth`, `gravityG`, `periodDays`. **Agreed.** The library
   can change measurement units easily; it needs hooks in the web-api. This retires the
   client's unit tables (`RADIUS_UNIT_M` today; density and mass would follow for colour and
   comparison bars).
5. **`label` on every node** (a display string), so the client stops synthesising one. Low
   value now that the label is simply the book's own class name.
6. **`summary` on every system:** counts of planets by book class, moons, belts, stars. Cheap
   server-side; saves the client a tree walk for the summary strip and thumbnails.
7. **`frostLine` on every star, in au,** if a book defines it, for the distance strip.

## Open questions

- **User-set habitability criteria** (later): rather than the API or the client deciding what
  "habitable" means, let the GM set display thresholds on the page (temperature range,
  pressure range, gravity range, breathable required) and highlight matching worlds. Purely
  presentational; the books' own flags remain the only "habitable" the data asserts.
- Should moons appear in the glance beyond a count? In some settings a gas giant's moons are
  the habitable candidates.
- Do names live only in saved systems, or also in the URL for sharing?
- Is a GM more likely to want one system sheet per roll, or a batch (Phase 4) to pick from?
