// Films picker — V0.
//
// Fetches the full library blob from the VPN-manager Worker, renders
// a searchable list. Everything stays client-side; no server logic.

const FILMS_URL = "https://vpn-manager.staalenataas.workers.dev/films.json";
const REFRESH_URL = "https://vpn-manager.staalenataas.workers.dev/library/refresh";

const $ = (id) => document.getElementById(id);
const fmtDuration = (ms) => {
  if (!ms) return "";
  const min = Math.round(ms / 60000);
  if (min < 60) return min + " min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? h + " h" : h + " h " + m + " min";
};
const fmtUpdated = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.round((now - d) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return diffMin + " min ago";
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return diffH + " h ago";
  return Math.round(diffH / 24) + " d ago";
};

let allFilms = [];

function shapeFilm(v) {
  return {
    ratingKey: v.ratingKey,
    guid: v.guid,
    title: v.title,
    year: v.year,
    rating: v.rating,
    viewCount: v.viewCount || 0,
    duration: v.duration,
    summary: v.summary,
    contentRating: v.contentRating,
    directors: (v.Director || []).map((d) => d.tag),
    genres: (v.Genre || []).map((g) => g.tag),
    actors: (v.Role || []).slice(0, 5).map((r) => r.tag),
  };
}

// Build a single lowercase search-haystack per film. Computed once at
// load so the per-keystroke filter is just `haystack.includes(q)`.
function buildHaystack(f) {
  return [
    f.title,
    f.year,
    f.directors.join(" "),
    f.genres.join(" "),
    f.actors.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function render(films) {
  const ul = $("films");
  ul.hidden = films.length === 0;
  $("count").textContent = films.length + (films.length === 1 ? " film" : " films");

  if (films.length === 0) {
    ul.innerHTML = "";
    return;
  }

  ul.innerHTML = films
    .map((f) => {
      const sub = [
        f.year,
        f.directors[0],
        fmtDuration(f.duration),
        f.contentRating,
      ]
        .filter(Boolean)
        .join(" · ");
      const ratingStr = f.rating ? Number(f.rating).toFixed(1) : "";
      const watchedClass = f.viewCount > 0 ? "dot watched" : "dot";
      return (
        '<li class="film" data-key="' +
        f.ratingKey +
        '">' +
        '<span class="' +
        watchedClass +
        '" title="' +
        (f.viewCount > 0 ? "watched" : "unwatched") +
        '"></span>' +
        "<div>" +
        '<div class="title">' +
        escapeHtml(f.title) +
        "</div>" +
        '<div class="sub">' +
        escapeHtml(sub) +
        "</div>" +
        "</div>" +
        '<div class="rating">' +
        ratingStr +
        "</div>" +
        "</li>"
      );
    })
    .join("");
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyFilter(query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    render(allFilms);
    return;
  }
  const out = allFilms.filter((f) => f._haystack.includes(q));
  render(out);
}

async function load() {
  $("status").textContent = "Loading library…";
  $("status").className = "state";
  $("status").hidden = false;
  $("films").hidden = true;
  try {
    const res = await fetch(FILMS_URL);
    if (res.status === 503) {
      $("status").textContent =
        "Library hasn't been dumped yet. Tap refresh to ask solvors-mbp to do it now.";
      return;
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    const updated = res.headers.get("x-updated");
    const data = await res.json();
    const metadata = data.MediaContainer || {};
    const raw = metadata.Metadata || [];
    allFilms = raw.map((v) => {
      const f = shapeFilm(v);
      f._haystack = buildHaystack(f);
      return f;
    });
    // Default sort: title ascending, watched after unwatched.
    allFilms.sort((a, b) => {
      if ((a.viewCount > 0) !== (b.viewCount > 0)) {
        return (a.viewCount > 0) ? 1 : -1;
      }
      return a.title.localeCompare(b.title);
    });
    $("status").hidden = true;
    $("updated").textContent = "updated " + fmtUpdated(updated);
    $("size").textContent = allFilms.length + " films · " +
      Math.round((JSON.stringify(data).length) / 1024) + " KB";
    applyFilter($("search").value);
  } catch (e) {
    $("status").className = "state error";
    $("status").textContent = "Could not load /films.json: " + e.message;
  }
}

async function requestRefresh() {
  const secret = ensureSecret();
  if (!secret) return;
  $("refresh").disabled = true;
  try {
    const r = await fetch(
      REFRESH_URL + "?secret=" + encodeURIComponent(secret),
      { method: "POST" }
    );
    if (r.status === 403) {
      alert("Wrong key — tap refresh once more and re-enter.");
      localStorage.removeItem("vpn-secret");
      return;
    }
    if (!r.ok) throw new Error("HTTP " + r.status);
    alert("Refresh requested. The Mac will pick it up within ~60s; re-tap refresh to reload after.");
  } catch (e) {
    alert("Refresh request failed: " + e.message);
  } finally {
    $("refresh").disabled = false;
  }
}

function ensureSecret() {
  let secret = localStorage.getItem("vpn-secret");
  if (secret) return secret;
  const entered = prompt("Enter the VPN manager key:");
  if (entered) {
    secret = entered.trim();
    localStorage.setItem("vpn-secret", secret);
  }
  return secret;
}

// Wire up
$("search").addEventListener("input", (e) => applyFilter(e.target.value));
$("refresh").addEventListener("click", load);
$("fresh").addEventListener("click", requestRefresh);

// Pull `?key=…` or `#key=…` for sharing (matches the VPN page convention).
(function consumeKey() {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get("key");
  const fromQuery = new URLSearchParams(location.search).get("key");
  const k = fromHash || fromQuery;
  if (k) {
    localStorage.setItem("vpn-secret", k.trim());
    history.replaceState(null, "", location.pathname);
  }
})();

load();
