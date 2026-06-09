# Changelog

Reverse-chronological log of significant changes and operational
decisions. Captures *why* alongside *what*, so future iterations
can re-litigate intentionally rather than by accident.

---

## 2026-06-09 — V0 through V0.7, the whole picker in one session

Built and deployed seven phases (A → G) plus a restructure and a
late bug-fix, end of day Staale was browsing posters on his iPhone.

### Phases

- **A — Lists data layer.** KV-backed lists/tags, cross-device
  shared via Cloudflare KV. Routes: `GET /lists.json`, `PUT
  /lists/<id>`, `DELETE /lists/<id>`, `POST /lists/<id>/add|remove`.
  Films referenced by Plex `guid` (durable across re-imports).
  Commit `aa709b3`.

- **B — Add-to-list UI.** Per-row + button → absolute-positioned
  popover with toggleable checkboxes + inline new-list form.
  Server-first mutations (~100 ms to Cloudflare; optimistic UI
  not worth the complexity at this scale). Commit `9fde5ab`.

- **C — List view + hash routing.** Routes `#/list/<id>` for
  scoped views; header Lists ▾ dropdown for navigation. Hash
  routing (not `history.pushState`) because Cloudflare static
  assets serve `index.html` only at `/` by default — hash never
  hits the server. Commit `4bc610a`.

- **D — Film detail page.** Route `#/film/<plexGuid>` with large
  title, year + director + rating pill, tagline, summary, credits
  grid, list-membership checkboxes. Row click → navigate; clicks
  inside the +-button container short-circuit the row handler.
  Commit `2eb69f6`.

- **E1 — Wheel + grid carousel.** Routes `#/wheel/<listId>/<mode>`
  (mode = `spin` or `grid`). SVG slices, CSS-transition rotation,
  popover winner + canvas confetti. List chip bar at top; mode
  toggle on the right. Commit `3a2282f`.

- **F — TMDB enrichment.** Picker Worker fetches the library
  via a service binding to the VPN Worker (`env.VPN.fetch`),
  enriches each film via TMDB search-by-title, caches in
  `library:enriched` KV. Cron `0 */12 * * *`. 96 of 99 films
  matched on first pass; 3 misses on obscure titles. Commit
  `bd19d89`.

- **G — Posters in wheel slices.** SVG `<clipPath>` per slice
  with an `<image>` rotated to the slice's radial direction
  (`preserveAspectRatio="meet"` for CSS-`contain` semantics).
  Plus poster thumbs on home rows, poster cards on the grid,
  full poster on film detail, blurred backdrop accent.
  Commit `778f041`.

### Restructure (mid-session)

VPN manager was frozen per Staale's directive — the original
Phase A had added lists CRUD to the VPN Worker. Reverted that
(`3abd29a` on the VPN repo) and moved the API into this repo
under `src/worker.js`. Static site moved to `public/`. New KV
namespace owned by the picker. Commit `aa709b3` carries the
move.

### Late bug

The header restructure (adding the Lists ▾ dropdown) silently
removed `<span id="updated">` while `app.js`'s `loadFilms()`
still wrote into it. Every visit threw `Cannot set properties
of null` inside the films-fetch try block; the catch reported
it as "Could not load /films.json" — misleading enough to send
me chasing iPhone cache for half an hour. Restored the element.
Commit `808a7f9`. Headless Chromium repro turned this from "must
be cache" into "must be code" in three minutes; that's the move
next time something doesn't render and the user's report is
ambiguous.

### Design choices worth re-litigating later

- **Worker stores, doesn't filter.** All filtering happens
  client-side (search, list scoping, wheel selection). Lets the
  picker UX iterate without Worker redeploys. Re-evaluate if
  query patterns grow beyond "by-membership" and "by-keyword."

- **Cross-device shared lists (KV), not per-device localStorage.**
  Staale's family using the same lists is the whole point.
  Tradeoff: last-write-wins conflict semantics on concurrent
  edits; acceptable at family scale.

- **Same `SECRET` as VPN.** Family already has the key in
  their browsers; reusing it means one URL bookmark covers both
  services. Tradeoff: revoking one revokes the other.

- **Service binding to VPN Worker.** Worker → Worker fetches via
  `*.workers.dev` URLs on the same Cloudflare account return 404
  (undocumented routing edge). Service bindings (`env.VPN.fetch`)
  are the correct primitive. Doesn't modify the VPN repo —
  read-only consumption.

- **Hash routing, not pushState.** Static-assets-only Worker
  doesn't have a `not_found_handling = "single-page-application"`
  fallback wired. Hash routes work without it. Could change later
  by setting that and switching to `history.pushState`.

- **Storage: KV throughout.** No D1, no Postgres, no external
  database. Worker free-tier KV easily covers the volume (99
  films × ~30 KB enrichment ≈ 3 MB; tens of lists; ~5 reads/day
  baseline). Re-evaluate when query patterns get relational.

### What's deliberately not yet here

- **Posters via Plex thumbs.** Initially considered base64-
  encoding Plex thumbnails into KV. Staale rejected ("too
  complex"); TMDB poster CDN URLs are stateless and free.
- **Sort orders.** Default is alphabetical, unwatched first.
  Most-recently-added / highest-rated / longest / shortest /
  random — open V0.1 question.
- **Genre/director filter chips.** Currently keyword search only.
  Open V0.1 question.
- **Tag merge across devices when the same list is edited
  concurrently.** Currently last-write-wins. Real CRDT-style
  merge would matter at scale; deferred.

### Cloudflare gotchas surfaced

- Pages merged into Workers Builds — static-site deploys need a
  `wrangler.toml` with `[assets] directory = "./"` even with no
  Worker script. Already captured in a reference memory.
- New workers.dev subdomains take ~30-60 s for the edge to
  provision a cert; first curl after a fresh deploy SSL-handshakes.
- `_headers` file in `public/` is honoured for cache-control
  directives; useful for forcing revalidation of JS/CSS modules
  (added at `5aa77c8`).

### Repository topology now

```
unwantedburger/
├── personal-operations-macbook-vpn-manager     (VPN Worker + Mac daemon)
│     deploys: vpn-manager.staalenataas.workers.dev
└── personal-operations-film-picker             (this repo)
      deploys: personal-operations-film-picker.staalenataas.workers.dev
      consumes: vpn-manager Worker's /films.json via service binding
```

Lives connected: picker fetches films from VPN, Mac dumps films
to VPN's KV, picker enriches via TMDB and caches in its own KV.

7 GitHub issues opened (#1–#7) and closed against their
implementing commits.
