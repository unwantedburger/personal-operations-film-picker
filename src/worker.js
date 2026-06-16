// Picker Worker — same-origin API for lists / tags / enrichment +
// gated SPA serving.
//
// The Worker handles every request (`run_worker_first = true` in
// wrangler.toml). Static assets live under public/ and are fetched
// via `env.ASSETS.fetch()` from inside this script. The app itself
// is parked at an obscure path (APP_PATH) so the bare workers.dev
// URL leaks nothing about the picker existing.
//
// KV namespace bound as PICKER (separate from the VPN manager's
// STATE so the two services don't share state across deployments).
//
// Routes:
//   GET    /                                        blank page
//   GET    /a9rs8aristnarosin/                      SPA shell (SECRET
//                                                   injected into HTML)
//   GET    /a9rs8aristnarosin/<file>                static asset
//   GET    /lists.json                              public
//   PUT    /lists/<id>?secret=…&name=…              create/rename
//   DELETE /lists/<id>?secret=…                     delete
//   POST   /lists/<id>/add?secret=…&film=<guid>     add to list
//   POST   /lists/<id>/remove?secret=…&film=<guid>  remove from list
//   GET    /enriched.json                           public (may be {})
//   POST   /enrich/run?secret=…                     manual trigger
//
// Cron: runs the enrichment job every 12h (wrangler.toml triggers).
//
// Auth for writes: env.SECRET. Optional env.TMDB_TOKEN (v4 read
// access) — when present, enrichment populates poster + rating
// per film via TMDB search-by-title. When absent, the enrichment
// job no-ops and /enriched.json returns {}.

const APP_PATH = "/a9rs8aristnarosin";

const LISTS_KEY = "library:lists";
const ENRICH_KEY = "library:enriched";
const ENRICH_META_KEY = "library:enriched:meta";
const FILMS_URL = "https://vpn-manager.staalenataas.workers.dev/films.json";

// Minimal, intentionally uninformative root page. Anyone hitting the
// bare workers.dev URL sees nothing — no logo, no link, no clue that
// a picker lives behind a longer path.
const BLANK_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title></title></head><body></body></html>`;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });

function requireSecret(url, env) {
  const provided = url.searchParams.get("secret");
  return provided && env.SECRET && provided === env.SECRET;
}

async function loadLists(env) {
  const raw = await env.PICKER.get(LISTS_KEY);
  return raw ? JSON.parse(raw) : {};
}

async function saveLists(env, lists) {
  await env.PICKER.put(LISTS_KEY, JSON.stringify(lists));
}

const blankHtml = (status = 200) =>
  new Response(BLANK_PAGE, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });

// Fetch a file out of the assets binding using a synthesised URL so
// the path we ask for is the path we get, regardless of the
// inbound request.
async function fetchAsset(request, env, pathname) {
  const u = new URL(request.url);
  u.pathname = pathname;
  u.search = "";
  return env.ASSETS.fetch(new Request(u.toString(), { method: "GET" }));
}

// Serve the SPA shell, with SECRET injected so the page can call
// /lists/* without prompting the user for a key.
async function serveAppShell(request, env) {
  const assetResp = await fetchAsset(
    request,
    env,
    APP_PATH + "/index.html",
  );
  if (!assetResp.ok) return assetResp;
  let body = await assetResp.text();
  // Sentinel must match the placeholder in index.html exactly.
  // `replaceAll` because the sentinel appears in both a comment and
  // the script tag — `replace` with a string only hits the first.
  body = body.replaceAll(
    "\"__PICKER_SECRET__\"",
    JSON.stringify(env.SECRET ?? ""),
  );
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // No-store so a stale shell never hides a freshly-deployed
      // secret rotation or token-list change.
      "cache-control": "no-store",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ─── SPA gating ───────────────────────────────────────────
    //
    // Bare URL: empty page. The picker only exists at APP_PATH.

    if (request.method === "GET" && url.pathname === "/") {
      return blankHtml();
    }

    if (
      request.method === "GET" &&
      (url.pathname === APP_PATH || url.pathname === APP_PATH + "/")
    ) {
      return serveAppShell(request, env);
    }

    // Static assets under APP_PATH (incl. /index.html if asked
    // directly) pass through to the ASSETS binding unmodified.
    // index.html still routes through serveAppShell so SECRET gets
    // injected even when the path is spelled out.
    if (request.method === "GET" && url.pathname.startsWith(APP_PATH + "/")) {
      if (url.pathname === APP_PATH + "/index.html") {
        return serveAppShell(request, env);
      }
      return env.ASSETS.fetch(request);
    }

    // GET /lists.json — public read.
    if (request.method === "GET" && url.pathname === "/lists.json") {
      const raw = await env.PICKER.get(LISTS_KEY);
      return new Response(raw || "{}", {
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
        },
      });
    }

    // PUT /lists/<id>?secret=…&name=… — create or rename.
    if (request.method === "PUT" && url.pathname.startsWith("/lists/")) {
      if (!requireSecret(url, env)) return json({ error: "forbidden" }, 403);
      const id = decodeURIComponent(url.pathname.slice("/lists/".length));
      if (!id) return json({ error: "id required" }, 400);
      const name = url.searchParams.get("name") || id;
      const lists = await loadLists(env);
      const now = new Date().toISOString();
      const existing = lists[id];
      lists[id] = {
        id,
        name,
        filmGuids: existing?.filmGuids ?? [],
        created: existing?.created ?? now,
        updated: now,
      };
      await saveLists(env, lists);
      return json({ ok: true, list: lists[id] });
    }

    // DELETE /lists/<id>?secret=… — drop a list. Films unaffected.
    if (request.method === "DELETE" && url.pathname.startsWith("/lists/")) {
      if (!requireSecret(url, env)) return json({ error: "forbidden" }, 403);
      const id = decodeURIComponent(url.pathname.slice("/lists/".length));
      const lists = await loadLists(env);
      if (!lists[id]) return json({ error: "no such list" }, 404);
      delete lists[id];
      await saveLists(env, lists);
      return json({ ok: true, deleted: id });
    }

    // /lists/<id>/add or /remove — toggle film membership.
    const m = url.pathname.match(/^\/lists\/([^/]+)\/(add|remove)$/);
    if (m && (request.method === "POST" || request.method === "GET")) {
      if (!requireSecret(url, env)) return json({ error: "forbidden" }, 403);
      const id = decodeURIComponent(m[1]);
      const op = m[2];
      const film = url.searchParams.get("film");
      if (!film) return json({ error: "film required (?film=plex://movie/…)" }, 400);
      const lists = await loadLists(env);
      if (!lists[id]) return json({ error: "no such list (PUT it first)" }, 404);
      const set = new Set(lists[id].filmGuids);
      if (op === "add") set.add(film);
      else set.delete(film);
      lists[id].filmGuids = [...set];
      lists[id].updated = new Date().toISOString();
      await saveLists(env, lists);
      return json({ ok: true, list: lists[id] });
    }

    // ── Enrichment ────────────────────────────────────────────
    //
    // /enriched.json: client reads this alongside /films.json (on
    // the VPN Worker) and merges by Plex `guid`. Returns {} when
    // nothing's been enriched yet — clients render unenriched and
    // we layer in posters/ratings/blurbs as enrichment lands.

    if (request.method === "GET" && url.pathname === "/enriched.json") {
      const raw = await env.PICKER.get(ENRICH_KEY);
      const meta = await env.PICKER.get(ENRICH_META_KEY, "json");
      return new Response(raw || "{}", {
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=600",
          "x-updated": meta?.updated || "",
          "x-tmdb-enabled": env.TMDB_TOKEN ? "1" : "0",
        },
      });
    }

    // POST /enrich/run?secret=… — fire the enrichment job by hand.
    if (
      request.method === "POST" &&
      url.pathname === "/enrich/run"
    ) {
      if (!requireSecret(url, env)) return json({ error: "forbidden" }, 403);
      const report = await runEnrichment(env);
      return json({ ok: true, report });
    }

    // Unmatched paths get the blank page too — no API surface
    // hinted at, no JSON-error breadcrumb pointing scanners at a
    // real handler. (The API routes above still respond normally;
    // this only catches unrecognised paths.)
    return blankHtml(404);
  },

  // Cron handler — runs on the schedule(s) declared in wrangler.toml.
  // Enrichment is best-effort: if TMDB_TOKEN is missing, no-op.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runEnrichment(env));
  },
};

// ─────────────────────────────────────────────────────────────────
// TMDB enrichment
// ─────────────────────────────────────────────────────────────────

async function runEnrichment(env) {
  if (!env.TMDB_TOKEN) {
    return { skipped: "no TMDB_TOKEN configured" };
  }
  // Pull the library via the service binding (avoids the
  // workers.dev → workers.dev fetch quirk on the same account).
  let filmsResp;
  if (env.VPN) {
    filmsResp = await env.VPN.fetch("https://internal/films.json");
  } else {
    filmsResp = await fetch(FILMS_URL);
  }
  if (!filmsResp.ok) {
    return { error: "films.json fetch HTTP " + filmsResp.status };
  }
  const films = await filmsResp.json();
  const items = films?.MediaContainer?.Metadata || [];
  // Load existing enrichment
  const existingRaw = await env.PICKER.get(ENRICH_KEY);
  const enriched = existingRaw ? JSON.parse(existingRaw) : {};

  let added = 0, skipped = 0, failed = 0;
  // Worker CPU budget is tight on free tier (~10 ms/req); space
  // calls out to avoid TMDB rate limit (~50/sec). Process up to N
  // unenriched per run; the cron re-runs every 12h to backfill.
  const MAX_PER_RUN = 40;
  for (const v of items) {
    if (added + failed >= MAX_PER_RUN) break;
    const guid = v.guid;
    if (!guid) { skipped++; continue; }
    if (enriched[guid]) { skipped++; continue; }
    try {
      const tmdb = await tmdbLookup(env.TMDB_TOKEN, v.title, v.year);
      if (tmdb) {
        enriched[guid] = {
          tmdbId: tmdb.id,
          imdbId: tmdb.imdb_id || null,
          posterUrl: tmdb.poster_path
            ? "https://image.tmdb.org/t/p/w500" + tmdb.poster_path
            : null,
          backdropUrl: tmdb.backdrop_path
            ? "https://image.tmdb.org/t/p/w1280" + tmdb.backdrop_path
            : null,
          overview: tmdb.overview || null,
          tmdbRating: tmdb.vote_average ?? null,
          tmdbVotes: tmdb.vote_count ?? null,
          enrichedAt: new Date().toISOString(),
        };
        added++;
      } else {
        // Remember the miss so we don't re-query every run
        enriched[guid] = { miss: true, enrichedAt: new Date().toISOString() };
        skipped++;
      }
    } catch (e) {
      failed++;
    }
  }

  await env.PICKER.put(ENRICH_KEY, JSON.stringify(enriched));
  await env.PICKER.put(
    ENRICH_META_KEY,
    JSON.stringify({
      updated: new Date().toISOString(),
      added,
      skipped,
      failed,
      total: Object.keys(enriched).length,
    })
  );
  return { added, skipped, failed, total: Object.keys(enriched).length };
}

async function tmdbLookup(token, title, year) {
  const url = new URL("https://api.themoviedb.org/3/search/movie");
  url.searchParams.set("query", title);
  if (year) url.searchParams.set("year", year);
  const r = await fetch(url.toString(), {
    headers: { Authorization: "Bearer " + token, accept: "application/json" },
  });
  if (!r.ok) return null;
  const data = await r.json();
  const top = (data.results || [])[0];
  if (!top) return null;
  // Re-fetch full details for IMDb ID + richer fields
  const detUrl = "https://api.themoviedb.org/3/movie/" + top.id;
  const d = await fetch(detUrl, {
    headers: { Authorization: "Bearer " + token, accept: "application/json" },
  });
  if (!d.ok) return top;
  const det = await d.json();
  return { ...top, ...det };
}
