# Roadmap

End goal (per Staale, 2026-06-09 evening):

> An interface helping with film choice. Tag films into lists
> ("cosy Friday night", "grownups only"). Browse lists. Film
> detail pages with posters + IMDB scores. A carousel view with
> a spin-the-wheel UI (confetti on landing). Posters fill the
> wheel slices.

Sequencing — earlier phases unblock the later ones; nothing here
depends on phase F (external IDs) so the UI can be built and
polished against Plex data, then enriched.

## Phase A — Lists / tags data layer

Persistent, cross-device, family-shared lists. KV-backed because
the alternative (per-device localStorage) makes Staale's spouse
unable to see lists Staale created.

- New KV key: `library:lists` = `{ listId: { id, name, filmGuids[], created, updated } }`
- Worker routes:
  - `GET  /lists.json`              — public, full lists state
  - `PUT  /lists/<id>?secret=…`     — create/rename a list
  - `DELETE /lists/<id>?secret=…`   — delete a list (films are unaffected)
  - `POST /films/<plexGuid>/lists/<id>?secret=…`     — add film to list
  - `DELETE /films/<plexGuid>/lists/<id>?secret=…`   — remove film
- `plexGuid` (Plex's stable `guid` field, e.g. `plex://movie/5d77687…`)
  is the durable handle. Survives library refreshes.

GitHub issue: A — Lists / tags data layer.

## Phase B — "Add to list" UI

On each film row in the list view:

- A small chevron / "+" button at the right
- Tap → dropdown menu of existing lists, each clickable to toggle
  membership
- "Create new list…" at the bottom of the dropdown → inline input
- Visual indicator on the film row showing list membership (small
  badges)

State sync via the Worker routes from Phase A.

GitHub issue: B — Add-to-list UI.

## Phase C — List view page

Route: `/list/<id>` (client-side routing — single-page app).

- Header with list name + count
- Same searchable list UI as `/`, scoped to the list members
- "Remove from list" affordance per row
- Sort: same defaults as the home view
- Empty-state copy when no films in the list yet

GitHub issue: C — List view page.

## Phase D — Film detail page

Route: `/film/<plexGuid>` (URL-safe-encode the guid).

- Title, year, content rating, runtime, plot summary, tagline
- Directors, cast (top 5), genres, country
- Plex's local rating (stand-in for IMDB until phase F)
- Toggle membership in each list (checkbox per list)
- "+ Create new list" affordance

GitHub issue: D — Film detail page.

## Phase E — Carousel + spin-the-wheel UX

Two visualisations on a `/wheel` (or `/spin`) route:

1. **Carousel grid**: pick a list (or "all"); shows tiny thumbnails
   in a grid. Cosmetic / browsy.
2. **Spin wheel**: an SVG/canvas wheel divided into slices, one per
   film in the selected list. Click → animated spin, eases to a
   slice, popover with the winner (title, year, poster).
3. Confetti on landing (one-off CSS or `canvas-confetti` lib).

Sub-phase E1 (this): plain text slices. E2 (phase G below): posters
in the slices.

GitHub issue: E — Carousel + spin-the-wheel UX.

## Phase F — External metadata enrichment

What we want from this phase:
- IMDB / Rotten Tomatoes / TMDB ratings (independent of Plex's
  local rating, which may be stale or wrong)
- Posters (Plex thumbs need a token-authed call back to solvors-mbp;
  external sources are stateless and CDN-cached)
- Improved plot blurbs (sometimes Plex's `summary` is sparse)

Strategy hierarchy (do whichever lands first):

1. **Pull external IDs from Plex itself.** Plex's API has
   `?includeGuids=1` which returns the `Guid` array per movie
   (`imdb://tt…`, `tmdb://…`, `tvdb://…`). Update
   `dump-library.sh` to request this. **Zero new credentials.**
2. **Use TMDB API for poster + ratings.** Free, needs a single
   API key. Staale-action: register on themoviedb.org (~2 min)
   and paste the key the same way the Cloudflare token was
   shared. Worker stores it as a secret; Mac uses it from
   `dump-library.sh` for enrichment writes to a `library:enrich:<guid>`
   KV key.
3. **Workaround if TMDB key isn't forthcoming:** scrape
   `themoviedb.org/movie/<tmdb_id>` for the public OG-image and
   rating from the meta tags. Ugly but works for a personal-scale
   service.
4. **Workaround for posters via Plex anyway:** `dump-library.sh`
   can `curl` each Plex thumb URL on-Mac (`?X-Plex-Token=…`),
   base64-encode, write a `library:thumb:<ratingKey>` KV entry.
   ~30 KB / film × 99 films = ~3 MB total. Within free tier KV
   limits. Refreshes alongside the library dump.

GitHub issue: F — External metadata enrichment.

## Phase G — Posters in wheel slices

Once enrichment lands (any of the strategies above), each wheel
slice gets a poster background image (`object-fit: contain` per
the brief). SVG `<image>` with `preserveAspectRatio="xMidYMid meet"`.

GitHub issue: G — Posters in wheel slices.

---

## Storage decision

**Cloudflare KV is enough.** Personal-scale data: 100 films, ~10
lists, dozens of memberships. Read pattern is "load whole blob,
filter client-side" (already the V0 pattern). Write pattern is
sparse: an add/remove/create might happen a few times a week per
family member.

Free-tier ceilings vs likely volume:
- 100 k reads/day → ~5/day expected
- 1 k writes/day → handful per week
- 25 MB per value → biggest blob is the films dump at ~226 KB

No relational queries (yet) so D1/SQL doesn't pay rent. Re-evaluate
if/when query patterns get more complex than "by-list membership."

## What I will *not* ask Staale for unless truly stuck

Per his "find a hack" directive:
- A TMDB API key — workaround paths are real (see Phase F sub-3 & 4).
- A separate database — KV works.
- Anything Cloudflare beyond what's already wired.

Things I *will* ping him about (he asked to be told what I tried):
- If all four Phase F strategies hit dead ends.
- If a UI direction has a real fork worth his judgment (e.g. carousel
  layout style — these are aesthetic and his call).
- If the existing VPN-manager Worker crowds and the film picker should
  move to a separate Worker.

## Build cadence

Phases A → E land first (no external dependency). Each phase pushes
on its own and stays usable. Phase F is the long-tail (depends on
which workaround lands). Phase G follows F.
