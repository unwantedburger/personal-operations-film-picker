// Films picker — V0.1 (Phase B: add-to-list UI).
//
// Fetches /films.json + /lists.json on load. Each row gets a small
// list-membership chip plus a + button that opens an inline panel
// of toggleable lists with a "create new" inline input. State
// changes go through the Worker; we re-fetch lists after each
// mutation to keep the in-memory map honest.

import {
  FILMS_URL,
  FILMS_REFRESH_URL as REFRESH_URL,
  ensureSecret,
  forgetSecret,
  getLists,
  addToList,
  removeFromList,
  createList,
  indexByFilm,
} from "./lists.js";

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

let allFilms = [];        // shaped + indexed for search
let allLists = {};        // { id: {id, name, filmGuids} }
let filmListsMap = new Map(); // guid → Set<listId>
let currentRoute = { view: "home" };   // { view: 'home' | 'list', listId? }

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

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function listBadge(guid) {
  const ids = filmListsMap.get(guid);
  if (!ids || ids.size === 0) return "";
  const names = [...ids]
    .map((id) => allLists[id]?.name || id)
    .slice(0, 2);
  const extra = ids.size > 2 ? " +" + (ids.size - 2) : "";
  return (
    '<span class="lists-chip">' +
    names.map(escapeHtml).join(" · ") +
    escapeHtml(extra) +
    "</span>"
  );
}

function listDropdown(guid) {
  const memberOf = filmListsMap.get(guid) || new Set();
  const sortedLists = Object.values(allLists).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const items = sortedLists
    .map(
      (l) =>
        '<label class="list-row">' +
        '<input type="checkbox" data-guid="' +
        escapeHtml(guid) +
        '" data-list="' +
        escapeHtml(l.id) +
        '"' +
        (memberOf.has(l.id) ? " checked" : "") +
        ">" +
        '<span>' +
        escapeHtml(l.name) +
        "</span></label>"
    )
    .join("");
  return (
    '<details class="list-menu">' +
    '<summary aria-label="Manage lists">+</summary>' +
    '<div class="list-dropdown">' +
    (items || '<div class="empty">No lists yet — create one below.</div>') +
    '<form class="new-list-form" data-guid="' +
    escapeHtml(guid) +
    '">' +
    '<input type="text" placeholder="New list…" autocapitalize="none" autocomplete="off">' +
    '<button type="submit">+</button>' +
    "</form>" +
    "</div>" +
    "</details>"
  );
}

function render(films) {
  const ul = $("films");
  ul.hidden = films.length === 0;
  $("count").textContent =
    films.length + (films.length === 1 ? " film" : " films");
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
        '<li class="film" data-guid="' +
        escapeHtml(f.guid) +
        '">' +
        '<span class="' +
        watchedClass +
        '" title="' +
        (f.viewCount > 0 ? "watched" : "unwatched") +
        '"></span>' +
        '<div class="film-main">' +
        '<div class="title">' +
        escapeHtml(f.title) +
        "</div>" +
        '<div class="sub">' +
        escapeHtml(sub) +
        listBadge(f.guid) +
        "</div>" +
        "</div>" +
        '<div class="rating">' +
        ratingStr +
        "</div>" +
        listDropdown(f.guid) +
        "</li>"
      );
    })
    .join("");
}

function scopedFilms() {
  if (currentRoute.view === "list") {
    const list = allLists[currentRoute.listId];
    if (!list) return [];
    const members = new Set(list.filmGuids || []);
    return allFilms.filter((f) => members.has(f.guid));
  }
  return allFilms;
}

function applyFilter(query) {
  const q = query.trim().toLowerCase();
  const base = scopedFilms();
  const out = q ? base.filter((f) => f._haystack.includes(q)) : base;
  render(out);
}

function renderHeaderForRoute() {
  if (currentRoute.view === "list") {
    const list = allLists[currentRoute.listId];
    const name = list?.name || "Unknown list";
    $("page-title").textContent = name;
    $("back").hidden = false;
  } else {
    $("page-title").textContent = "Films";
    $("back").hidden = true;
  }
  renderListsMenu();
}

function renderListsMenu() {
  const lists = Object.values(allLists).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const menu = $("lists-menu");
  if (lists.length === 0) {
    menu.innerHTML = '<div class="empty">No lists yet.</div>';
    return;
  }
  const allCurrent = currentRoute.view === "home" ? " class=\"current\"" : "";
  menu.innerHTML =
    '<a href="#/"' + allCurrent + '><span>All films</span>' +
    '<span class="count">' + allFilms.length + '</span></a>' +
    lists
      .map((l) => {
        const isCurrent =
          currentRoute.view === "list" && currentRoute.listId === l.id;
        return (
          '<a href="#/list/' +
          encodeURIComponent(l.id) +
          '"' +
          (isCurrent ? ' class="current"' : "") +
          ">" +
          "<span>" +
          escapeHtml(l.name) +
          "</span>" +
          '<span class="count">' +
          (l.filmGuids?.length || 0) +
          "</span></a>"
        );
      })
      .join("");
}

function parseRoute() {
  const hash = location.hash.replace(/^#/, "");
  if (!hash || hash === "/") return { view: "home" };
  const listMatch = hash.match(/^\/list\/(.+)$/);
  if (listMatch) {
    return { view: "list", listId: decodeURIComponent(listMatch[1]) };
  }
  return { view: "home" };
}

function applyRoute() {
  currentRoute = parseRoute();
  // Close any open dropdowns on navigation.
  document
    .querySelectorAll("details[open]")
    .forEach((d) => d.removeAttribute("open"));
  renderHeaderForRoute();
  applyFilter($("search").value);
}

async function loadFilms() {
  $("status").textContent = "Loading library…";
  $("status").className = "state";
  $("status").hidden = false;
  $("films").hidden = true;
  try {
    const res = await fetch(FILMS_URL);
    if (res.status === 503) {
      $("status").textContent =
        "Library hasn't been dumped yet. Tap 'pull fresh data' to ask solvors-mbp to do it now.";
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
    allFilms.sort((a, b) => {
      if ((a.viewCount > 0) !== (b.viewCount > 0)) {
        return a.viewCount > 0 ? 1 : -1;
      }
      return a.title.localeCompare(b.title);
    });
    $("status").hidden = true;
    $("updated").textContent = "updated " + fmtUpdated(updated);
    $("size").textContent =
      allFilms.length +
      " films · " +
      Math.round(JSON.stringify(data).length / 1024) +
      " KB";
    return true;
  } catch (e) {
    $("status").className = "state error";
    $("status").textContent = "Could not load /films.json: " + e.message;
    return false;
  }
}

async function loadListsData() {
  try {
    allLists = await getLists();
    filmListsMap = indexByFilm(allLists);
  } catch (e) {
    // Lists load failure is non-fatal — films still render without
    // membership info. Surface in console for debugging.
    console.warn("lists.json load failed:", e);
    allLists = {};
    filmListsMap = new Map();
  }
}

async function load() {
  const ok = await loadFilms();
  if (!ok) return;
  await loadListsData();
  applyRoute();
}

async function requestRefresh() {
  const secret = ensureSecret();
  if (!secret) return;
  $("fresh").disabled = true;
  try {
    const r = await fetch(
      REFRESH_URL + "?secret=" + encodeURIComponent(secret),
      { method: "POST" }
    );
    if (r.status === 403) {
      forgetSecret();
      alert("Wrong key — re-tap and re-enter.");
      return;
    }
    if (!r.ok) throw new Error("HTTP " + r.status);
    alert(
      "Refresh requested. solvors-mbp picks it up within ~60 s; tap refresh to reload the page after."
    );
  } catch (e) {
    alert("Refresh request failed: " + e.message);
  } finally {
    $("fresh").disabled = false;
  }
}

// Delegated event handler for checkbox toggles inside list dropdowns.
// Awaiting the server mutation before re-fetching keeps in-memory
// state aligned with KV.
async function onChange(ev) {
  const cb = ev.target;
  if (!cb.matches('input[type="checkbox"][data-list]')) return;
  const filmGuid = cb.dataset.guid;
  const listId = cb.dataset.list;
  cb.disabled = true;
  try {
    if (cb.checked) {
      await addToList(listId, filmGuid);
    } else {
      await removeFromList(listId, filmGuid);
    }
    await loadListsData();
    renderListsMenu(); // counts in the header dropdown may have changed
    // Re-render only the changed row's chip + dropdown without a full
    // applyFilter (which would close other open dropdowns).
    const row = cb.closest(".film");
    if (row) {
      const rebuilt = document.createElement("div");
      rebuilt.innerHTML = listBadge(filmGuid);
      const oldChip = row.querySelector(".lists-chip");
      if (rebuilt.firstChild) {
        if (oldChip) oldChip.replaceWith(rebuilt.firstChild);
        else row.querySelector(".sub")?.appendChild(rebuilt.firstChild);
      } else if (oldChip) {
        oldChip.remove();
      }
    }
  } catch (e) {
    cb.checked = !cb.checked; // revert
    alert("Couldn't update list: " + e.message);
  } finally {
    cb.disabled = false;
  }
}

// New-list inline form: creates the list, adds the current film to
// it, then re-renders all dropdowns so the new list is visible.
async function onSubmit(ev) {
  const form = ev.target;
  if (!form.matches(".new-list-form")) return;
  ev.preventDefault();
  const input = form.querySelector("input");
  const name = input.value.trim();
  if (!name) return;
  const filmGuid = form.dataset.guid;
  input.disabled = true;
  form.querySelector("button").disabled = true;
  try {
    const newId = await createList(name);
    await addToList(newId, filmGuid);
    await loadListsData();
    renderListsMenu();
    applyFilter($("search").value);  // full re-render so all dropdowns get the new list
  } catch (e) {
    alert("Couldn't create list: " + e.message);
    input.disabled = false;
    form.querySelector("button").disabled = false;
  }
}

// Wire-up
$("search").addEventListener("input", (e) => applyFilter(e.target.value));
$("refresh").addEventListener("click", load);
$("fresh").addEventListener("click", requestRefresh);
$("films").addEventListener("change", onChange);
$("films").addEventListener("submit", onSubmit);
window.addEventListener("hashchange", applyRoute);

// Close any open <details> popover (per-row list menu OR the header
// "Lists ▾" menu) when the user clicks outside.
document.addEventListener("click", (e) => {
  // Per-row list menus on the films list
  if (!e.target.closest("details.list-menu")) {
    document
      .querySelectorAll("details.list-menu[open]")
      .forEach((d) => d.removeAttribute("open"));
  }
  // Header lists-navigation menu
  if (!e.target.closest("details.lists-menu")) {
    document
      .querySelectorAll("details.lists-menu[open]")
      .forEach((d) => d.removeAttribute("open"));
  }
});

// `#key=…` or `?key=…` for first-time enrolment via a share URL.
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
