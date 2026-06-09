// lists.js — client-side helpers for the picker's own /lists API.
// Same-origin calls; the picker's Worker handles them in src/worker.js.
//
// The film data, by contrast, lives on the VPN manager's Worker and
// is fetched cross-origin from FILMS_URL.
//
// Server is the source of truth — each mutation awaits the response
// before updating in-memory state.

export const FILMS_URL = "https://vpn-manager.staalenataas.workers.dev/films.json";
export const FILMS_REFRESH_URL = "https://vpn-manager.staalenataas.workers.dev/library/refresh";
const SECRET_KEY = "picker-secret";

export function ensureSecret() {
  let s = localStorage.getItem(SECRET_KEY);
  if (s) return s;
  const entered = prompt("Enter the VPN manager key:");
  if (entered) {
    s = entered.trim();
    localStorage.setItem(SECRET_KEY, s);
  }
  return s;
}

export function forgetSecret() {
  localStorage.removeItem(SECRET_KEY);
}

export async function getLists() {
  const r = await fetch("/lists.json", { cache: "no-store" });
  if (!r.ok) throw new Error("lists.json: HTTP " + r.status);
  return await r.json();
}

async function authedFetch(path, opts = {}) {
  const secret = ensureSecret();
  if (!secret) throw new Error("no key");
  const url = new URL(path, location.origin);
  url.searchParams.set("secret", secret);
  const r = await fetch(url.toString(), {
    method: opts.method || "POST",
    ...opts,
  });
  if (r.status === 403) {
    forgetSecret();
    throw new Error("forbidden — key removed, try again");
  }
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}

// Kebab-case slug. Lowercase, ASCII letters/digits/dashes, no
// leading/trailing dashes. Falls back to a short random suffix if
// the input has no usable characters (e.g. all emoji).
export function slugify(name) {
  const base = String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base) return base;
  return "list-" + Math.random().toString(36).slice(2, 7);
}

export async function createList(name) {
  const id = slugify(name);
  const url = "/lists/" + encodeURIComponent(id) +
    "?name=" + encodeURIComponent(name);
  await authedFetch(url, { method: "PUT" });
  return id;
}

export async function deleteList(id) {
  await authedFetch("/lists/" + encodeURIComponent(id), { method: "DELETE" });
}

export async function addToList(listId, filmGuid) {
  const path = "/lists/" + encodeURIComponent(listId) +
    "/add?film=" + encodeURIComponent(filmGuid);
  await authedFetch(path, { method: "POST" });
}

export async function removeFromList(listId, filmGuid) {
  const path = "/lists/" + encodeURIComponent(listId) +
    "/remove?film=" + encodeURIComponent(filmGuid);
  await authedFetch(path, { method: "POST" });
}

// Build a Map<filmGuid, Set<listId>> from the /lists.json blob.
export function indexByFilm(listsObj) {
  const m = new Map();
  for (const [listId, list] of Object.entries(listsObj || {})) {
    for (const guid of list.filmGuids || []) {
      if (!m.has(guid)) m.set(guid, new Set());
      m.get(guid).add(listId);
    }
  }
  return m;
}
