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
- The SPA lives at `/a9rs8aristnarosin/`. The bare workers.dev URL
  returns a blank page so the picker isn't trivially discoverable.

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

Cloudflare Pages, connected to this GitHub repo, auto-deploys on
push to `master`. The Worker (`personal-operations-macbook-vpn-manager`)
sets `access-control-allow-origin: *` on `/films.json`, so the page
can run on any origin.

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
