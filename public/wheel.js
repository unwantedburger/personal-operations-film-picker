// wheel.js — SVG spin-the-wheel + confetti for Phase E.
//
// Exports renderWheel(container, films, onWin). Container should be
// an empty <div>; films is the array of currently-selected films;
// onWin gets called with the winning film when the spin lands.
//
// No external libs — SVG slices + CSS transition for rotation,
// canvas confetti pasted in below.

export function renderWheel(container, films, onWin) {
  if (!films.length) {
    container.innerHTML =
      '<p class="state">Pick a list with at least one film to spin.</p>';
    return;
  }
  if (films.length === 1) {
    container.innerHTML =
      '<p class="state">Only one film in this list — no need to spin: <strong>' +
      escapeHtml(films[0].title) +
      "</strong>.</p>";
    return;
  }
  if (films.length > 60) {
    container.innerHTML =
      '<p class="state error">' +
      films.length +
      " films is too many for a readable wheel — pick a smaller list.</p>";
    return;
  }

  const N = films.length;
  const SLICE = 360 / N;
  const R = 100; // radius in viewBox units
  const showPosters = N <= 20; // posters readable up to ~20 slices

  // Per-slice geometry. The clip path for slice `i` is the wedge
  // shape at angles [i*SLICE, (i+1)*SLICE] measured from 12 o'clock
  // clockwise. The image for slice `i` is NOT rotated — posters
  // stay upright regardless of slice position. The clipPath crops
  // overflow.
  const slicePath = (i) => {
    const a1 = (i * SLICE - 90) * (Math.PI / 180);
    const a2 = ((i + 1) * SLICE - 90) * (Math.PI / 180);
    const x1 = R * Math.cos(a1);
    const y1 = R * Math.sin(a1);
    const x2 = R * Math.cos(a2);
    const y2 = R * Math.sin(a2);
    const largeArc = SLICE > 180 ? 1 : 0;
    return `M 0 0 L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  };

  const clipDefs = films
    .map((_, i) => '<clipPath id="ws' + i + '"><path d="' + slicePath(i) + '"/></clipPath>')
    .join("");

  // Each slice rendered as a self-contained group containing:
  // - the wedge fill (so all slices have visible edges)
  // - the poster, clipped to the wedge, positioned at the wedge's
  //   centroid, NOT rotated (upright posters)
  // - the title label, rotated to read along the radial direction
  //
  // Posters sized to the wedge's inscribed rectangle so they
  // visually fill the slice without overflow.
  const sliceGroups = films
    .map((f, i) => {
      const colour = i % 2 === 0 ? "var(--wheel-a)" : "var(--wheel-b)";
      const wedgeFill =
        '<path d="' + slicePath(i) +
        '" fill="' + colour + '" stroke="rgba(242,234,217,0.35)" stroke-width="0.35"/>';

      let posterTag = "";
      if (showPosters && f.posterUrl) {
        // Use an SVG <pattern> as the wedge's fill. The pattern's
        // viewport handles the "contain" semantics natively
        // (preserveAspectRatio="meet"), and the wedge's path
        // automatically clips anything outside its own boundary —
        // no separate clipPath needed, no overflow into neighbours.
        const midDeg = i * SLICE + SLICE / 2;
        const midRad = (midDeg - 90) * (Math.PI / 180);
        const halfChord = R * Math.sin((SLICE / 2) * (Math.PI / 180));
        const w = Math.min(R * 0.85, halfChord * 1.8);
        const h = w * 1.5;
        const rCentroid = R * 0.55;
        const cx = rCentroid * Math.cos(midRad);
        const cy = rCentroid * Math.sin(midRad);
        const px = cx - w / 2;
        const py = cy - h / 2;
        // The pattern itself is registered in <defs> below; here we
        // emit nothing — the wedge's `fill` carries the reference.
        // We tag the slice with `data-pattern-i` so the wedge fill
        // can be set after the fact.
        // Actually simpler: render the pattern + the wedge filled by
        // it as one inline string.
        posterTag =
          '<defs><pattern id="p' + i + '" patternUnits="userSpaceOnUse" ' +
          'x="' + px + '" y="' + py + '" width="' + w + '" height="' + h + '">' +
          '<rect width="' + w + '" height="' + h + '" fill="' + colour + '"/>' +
          '<image href="' + posterSize(f.posterUrl, "w342") +
          '" x="0" y="0" width="' + w + '" height="' + h +
          '" preserveAspectRatio="xMidYMid meet"/>' +
          "</pattern></defs>" +
          '<path d="' + slicePath(i) + '" fill="url(#p' + i + ')"/>';
      }

      // Label — radial midpoint, rotated to read along the slice
      const midDeg = i * SLICE + SLICE / 2;
      const midRad = (midDeg - 90) * (Math.PI / 180);
      const lx = R * 0.88 * Math.cos(midRad);
      const ly = R * 0.88 * Math.sin(midRad);
      const maxChars = Math.max(8, Math.floor(180 / N) + 6);
      const labelText =
        f.title.length > maxChars ? f.title.slice(0, maxChars - 1) + "…" : f.title;
      const fontSize = Math.max(2.5, Math.min(4.5, 50 / N + 1.5));
      const labelTag =
        '<text x="' + lx + '" y="' + ly +
        '" text-anchor="middle" alignment-baseline="middle" font-size="' + fontSize +
        '" transform="rotate(' + midDeg + " " + lx + " " + ly + ')" ' +
        'fill="var(--wheel-fg)" paint-order="stroke" stroke="rgba(15,13,11,0.85)" stroke-width="0.5">' +
        escapeHtml(labelText) + "</text>";

      return wedgeFill + posterTag + labelTag;
    })
    .join("");

  container.innerHTML =
    '<div class="wheel-box">' +
    '<svg class="wheel" viewBox="-110 -110 220 220" aria-hidden="true">' +
    "<defs>" + clipDefs + "</defs>" +
    '<g class="wheel-rotor" id="wheel-rotor">' +
    sliceGroups +
    "</g>" +
    // pointer at top — separate from rotor so it stays still. Apex
    // points DOWN into the wheel (tip at the rim) to mark the slice.
    '<polygon class="wheel-pointer" points="0,-94 -8,-110 8,-110" fill="var(--accent)"/>' +
    '<circle class="wheel-hub" cx="0" cy="0" r="7" fill="var(--bg)" stroke="var(--accent)" stroke-width="1"/>' +
    "</svg>" +
    '<button class="spin-btn" id="spin-btn"><span>Spin</span></button>' +
    '<canvas class="confetti" id="confetti" width="900" height="700"></canvas>' +
    // Winner is a modal overlay — sits in a portal at body level so
    // it covers everything regardless of stacking context.
    '<div class="winner-modal" id="winner-modal" hidden role="dialog" aria-modal="true">' +
    '<div class="winner-backdrop" data-close></div>' +
    '<div class="winner-card-wrap" id="winner-content"></div>' +
    "</div>" +
    "</div>";

  let currentAngle = 0;
  const rotor = container.querySelector("#wheel-rotor");
  const btn = container.querySelector("#spin-btn");
  const modal = container.querySelector("#winner-modal");
  const modalContent = container.querySelector("#winner-content");
  const confettiCanvas = container.querySelector("#confetti");

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
  }
  modal.addEventListener("click", (e) => {
    if (e.target.matches("[data-close]") || e.target.classList.contains("winner-backdrop")) {
      closeModal();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) closeModal();
  });

  btn.addEventListener("click", () => {
    btn.disabled = true;
    closeModal();
    const turns = 5 + Math.floor(Math.random() * 4);
    const offset = Math.random() * 360;
    const targetAngle = currentAngle + turns * 360 + offset;
    // Strong easing — fast start, lingering deceleration.
    rotor.style.transition =
      "transform 6s cubic-bezier(0.1, 0.62, 0.16, 1)";
    rotor.style.transform = "rotate(" + targetAngle + "deg)";
    rotor.addEventListener(
      "transitionend",
      () => {
        currentAngle = targetAngle % 360;
        // Pointer is at 12 o'clock. After rotor rotates by
        // currentAngle clockwise, the slice originally at angle
        // (360 - currentAngle) sits under the pointer.
        const at = (360 - (currentAngle % 360)) % 360;
        const idx = Math.floor(at / SLICE) % N;
        const winner = films[idx];
        const posterHtml = winner.posterUrl
          ? '<img class="winner-poster" src="' + posterSize(winner.posterUrl, "w500") + '" alt="">'
          : '<div class="winner-poster placeholder">' + escapeHtml(winner.title.slice(0, 1)) + "</div>";
        const ratingPill = winner.tmdbRating
          ? '<span class="winner-rating">★ ' + Number(winner.tmdbRating).toFixed(1) + "</span>"
          : winner.rating
          ? '<span class="winner-rating">★ ' + Number(winner.rating).toFixed(1) + "</span>"
          : "";
        modalContent.innerHTML =
          '<button class="winner-close" data-close aria-label="Close">×</button>' +
          '<div class="winner-card">' +
          posterHtml +
          '<div class="winner-label">Tonight</div>' +
          '<div class="winner-title">' +
          escapeHtml(winner.title) +
          "</div>" +
          '<div class="winner-sub">' +
          [winner.year, winner.directors?.[0]].filter(Boolean).join(" · ") +
          " " + ratingPill +
          "</div>" +
          '<div class="winner-actions">' +
          '<a class="winner-link primary" href="#/film/' +
          encodeURIComponent(winner.guid) +
          '">Open detail</a>' +
          '<button class="winner-link secondary" data-close type="button">Pick again</button>' +
          "</div>" +
          "</div>";
        modal.hidden = false;
        document.body.classList.add("modal-open");
        burstConfetti(confettiCanvas);
        btn.disabled = false;
        if (onWin) onWin(winner);
      },
      { once: true }
    );
  });
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

// Minimal canvas confetti. Spawns ~120 paper particles that fall +
// fade out over ~2.5s. No deps.
function burstConfetti(canvas) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const colors = ["#ff7a59", "#66e07a", "#5b9bff", "#ffd166", "#c87cff"];
  const particles = [];
  for (let i = 0; i < 140; i++) {
    particles.push({
      x: w / 2 + (Math.random() - 0.5) * 100,
      y: h * 0.45,
      vx: (Math.random() - 0.5) * 8,
      vy: -Math.random() * 9 - 4,
      g: 0.25,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: 4 + Math.random() * 5,
      life: 1,
    });
  }
  let frame = 0;
  const start = performance.now();
  function tick(now) {
    frame++;
    ctx.clearRect(0, 0, w, h);
    let alive = 0;
    for (const p of particles) {
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life = Math.max(0, 1 - (now - start) / 2500);
      if (p.life > 0) {
        alive++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.5);
        ctx.restore();
      }
    }
    if (alive > 0) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, w, h);
  }
  requestAnimationFrame(tick);
}

// ── Carousel grid (text variant for V0; posters land in Phase G) ──
export function renderGrid(container, films) {
  if (!films.length) {
    container.innerHTML =
      '<p class="state">Pick a list with at least one film.</p>';
    return;
  }
  container.innerHTML =
    '<div class="grid">' +
    films
      .map((f) => {
        const poster = f.posterUrl
          ? '<img class="grid-poster" src="' + posterSize(f.posterUrl, "w185") + '" alt="" loading="lazy">'
          : '<div class="grid-poster placeholder">' + escapeHtml(f.title.slice(0, 1)) + "</div>";
        return (
          '<a class="grid-card" href="#/film/' +
          encodeURIComponent(f.guid) +
          '">' +
          poster +
          '<div class="grid-card-title">' +
          escapeHtml(f.title) +
          "</div>" +
          '<div class="grid-card-sub">' +
          escapeHtml([f.year, fmtDuration(f.duration)].filter(Boolean).join(" · ")) +
          "</div>" +
          "</a>"
        );
      })
      .join("") +
    "</div>";
}

// TMDB image URLs follow `https://image.tmdb.org/t/p/<size>/<path>`.
// Storing only w500 in KV; resize on the fly client-side.
function posterSize(url, size) {
  if (!url) return url;
  return url.replace(/\/t\/p\/[^/]+\//, "/t/p/" + size + "/");
}

function fmtDuration(ms) {
  if (!ms) return "";
  const min = Math.round(ms / 60000);
  if (min < 60) return min + " min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? h + " h" : h + " h " + m + " min";
}
