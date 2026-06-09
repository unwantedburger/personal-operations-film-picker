// Picker Worker — same-origin API for lists / tags.
//
// Static assets (public/) are served by Cloudflare's assets binding
// before this Worker runs; this script handles the /lists* surface.
//
// KV namespace bound as PICKER (separate from the VPN manager's
// STATE so the two services don't share state across deployments).
//
// Routes:
//   GET    /lists.json                              public
//   PUT    /lists/<id>?secret=…&name=…              create/rename
//   DELETE /lists/<id>?secret=…                     delete
//   POST   /lists/<id>/add?secret=…&film=<guid>     add to list
//   POST   /lists/<id>/remove?secret=…&film=<guid>  remove from list
//
// Auth for writes: env.SECRET (set via `wrangler secret put SECRET`).
// Same SECRET shared with the VPN manager for convenience — family
// members reuse the same key they entered for /vpn.

const LISTS_KEY = "library:lists";

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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

    // Everything else: fall through. Cloudflare static-assets binding
    // serves the SPA at this point. If we reach the end of this
    // handler, the request was unmatched — return 404.
    return json({ error: "not found" }, 404);
  },
};
