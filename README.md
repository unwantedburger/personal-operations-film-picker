# personal-operations-film-picker

Static web app for browsing Staale's Plex film library. Reads the
JSON blob published by
[`personal-operations-macbook-vpn-manager`](https://github.com/unwantedburger/personal-operations-macbook-vpn-manager)
at `https://vpn-manager.staalenataas.workers.dev/films.json` and
renders it as a searchable list.

## V0 scope

- Big list of all films (Films section on solvors-mbp's Plex).
- Live search filter (title, year, director, genre, top-5 cast).
- Watched / unwatched indicator (green dot vs grey).
- "Pull fresh data" link triggers the Mac to re-dump from Plex via
  the Worker's `/library/refresh` endpoint. Uses the same `SECRET`
  as the VPN manager; the picker Worker injects it into the SPA
  shell so no prompt or `localStorage` is needed. The list itself
  is public-read; only the refresh requires the key.
- **Open (2026-07-02):** the SPA serves at the root path — anyone
  with the workers.dev URL can browse and pick films. It used to
  hide behind an obscure path (`/a9rs8aristnarosin/`, now 301'd to
  `/`); that gating was dropped on Staale's call. The write-key is
  still injected into the page (so blind scanners hitting the raw
  API without loading the page can't write), but every visitor
  gets it — the URL alone grants full access.

## What's not here (yet)

- Tagging / playlists (cosy Friday night, grownups only, etc.) — V0.1.
- Random "spin the wheel" pick — glazing, deferred.
- TV / series — V0 is films only.
- Posters / artwork — would need to proxy Plex thumbnails, parked.

## Stack

Plain `index.html` + ES module + CSS, no build tooling. Reasoning:

- ~150 lines of code total for V0.
- Iteration on the picker UX should be friction-free —
  edit-and-refresh, no `npm run` step.
- A build step starts paying for itself when there's a real
  component model worth maintaining; we're not there yet.

When (if) tagging / playlists arrive and the state surface grows,
swap in Vite + vanilla TS or a small framework. Migration path is
"replace `index.html` with the build output."

## Deploy

This is a **Cloudflare Worker** (not Pages) — `wrangler.toml` binds
static assets, a KV namespace, a service binding to the VPN-manager
Worker, and a 12h enrichment cron. Deploy with:

```bash
npx wrangler deploy      # needs Cloudflare auth (see below)
```

Auth: wrangler reads a `CLOUDFLARE_API_TOKEN` from `.env.local`
(git-ignored) or the environment. The token needs
`Account · Workers Scripts · Edit`. The headless VM has no persisted
OAuth, so deploys run either from a machine with `wrangler login`
(Staale's Mac) or with that token dropped in `.env.local`.

Live at `https://personal-operations-film-picker.staalenataas.workers.dev`.
The data Worker (`personal-operations-macbook-vpn-manager`) sets
`access-control-allow-origin: *` on `/films.json`, so the page can
run on any origin.

For local dev:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

The JS `fetch("https://vpn-manager.staalenataas.workers.dev/films.json")`
hits the production data — there's no separate dev API for the
library blob.

## Stable refs in the data

Each film carries:

- `ratingKey` — per-server (e.g. `"440"`), survives re-imports
  unless the file path changes meaningfully.
- `guid` — cross-server, e.g. `"plex://movie/5f409621…"`. Plex's
  canonical identity; best ref for tag persistence.
- `key` — path back to metadata, derivable from `ratingKey`.

When the tagging layer lands, pin tags to `guid`.
