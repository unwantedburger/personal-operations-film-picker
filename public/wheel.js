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

  // Per-slice paths and clip-paths
  const slicePaths = films.map((_, i) => {
    const a1 = (i * SLICE - 90) * (Math.PI / 180);
    const a2 = ((i + 1) * SLICE - 90) * (Math.PI / 180);
    const x1 = R * Math.cos(a1);
    const y1 = R * Math.sin(a1);
    const x2 = R * Math.cos(a2);
    const y2 = R * Math.sin(a2);
    const largeArc = SLICE > 180 ? 1 : 0;
    return `M 0 0 L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  });

  const clipDefs = films
    .map((_, i) => '<clipPath id="ws' + i + '"><path d="' + slicePaths[i] + '"/></clipPath>')
    .join("");

  const slices = films
    .map((_, i) => {
      const colour = i % 2 === 0 ? "var(--wheel-a)" : "var(--wheel-b)";
      return (
        '<path d="' + slicePaths[i] +
        '" fill="' + colour + '" stroke="var(--bg)" stroke-width="0.4"/>'
      );
    })
    .join("");

  // Posters as <image>s clipped to each slice. Centered on the
  // wedge centroid, sized to roughly the inscribed rectangle so
  // the poster reads in "contain" mode without overflowing.
  const posters = showPosters
    ? films
        .map((f, i) => {
          if (!f.posterUrl) return "";
          const midDeg = i * SLICE + SLICE / 2;
          const midRad = (midDeg - 90) * (Math.PI / 180);
          // Centroid ~55% along the radius
          const cx = R * 0.55 * Math.cos(midRad);
          const cy = R * 0.55 * Math.sin(midRad);
          // Max inscribed rectangle: tangential width = 2R sin(θ/2);
          // radial height = R - small margin. Aim for ~80% of that.
          const w = Math.min(R * 0.85, 2 * R * Math.sin((SLICE / 2) * (Math.PI / 180)) * 0.85);
          const h = Math.min(R * 0.85, w * 1.5); // poster aspect 2:3
          // Rotate the image so its "up" points outward radially
          return (
            '<image href="' + posterSize(f.posterUrl, "w342") +
            '" x="' + (cx - w / 2) + '" y="' + (cy - h / 2) +
            '" width="' + w + '" height="' + h +
            '" preserveAspectRatio="xMidYMid meet"' +
            ' transform="rotate(' + midDeg + " " + cx + " " + cy + ')"' +
            ' clip-path="url(#ws' + i + ')" opacity="0.85"/>'
          );
        })
        .join("")
    : "";

  // Labels at the radial midpoint, rotated to face outward
  const labels = films
    .map((f, i) => {
      const midDeg = i * SLICE + SLICE / 2;
      const midRad = (midDeg - 90) * (Math.PI / 180);
      const tx = (R * 0.92) * Math.cos(midRad);
      const ty = (R * 0.92) * Math.sin(midRad);
      const maxChars = Math.max(8, Math.floor(180 / N) + 6);
      const label =
        f.title.length > maxChars ? f.title.slice(0, maxChars - 1) + "…" : f.title;
      return (
        '<text x="' + tx + '" y="' + ty +
        '" text-anchor="middle" alignment-baseline="middle" font-size="' +
        Math.max(2.5, Math.min(5, 60 / N + 1.5)) +
        '" transform="rotate(' + midDeg + " " + tx + " " + ty + ')" ' +
        'fill="var(--wheel-fg)" paint-order="stroke" stroke="var(--bg)" stroke-width="0.8">' +
        escapeHtml(label) + "</text>"
      );
    })
    .join("");

  container.innerHTML =
    '<div class="wheel-box">' +
    '<svg class="wheel" viewBox="-110 -110 220 220" aria-hidden="true">' +
    "<defs>" + clipDefs + "</defs>" +
    '<g class="wheel-rotor" id="wheel-rotor">' +
    slices + posters + labels +
    "</g>" +
    '<polygon points="0,-108 -7,-92 7,-92" fill="var(--off)"/>' +
    '<circle cx="0" cy="0" r="8" fill="var(--bg)" stroke="var(--card-border)"/>' +
    "</svg>" +
    '<button class="spin-btn" id="spin-btn">Spin</button>' +
    '<div class="winner" id="winner" hidden></div>' +
    '<canvas class="confetti" id="confetti" width="600" height="400"></canvas>' +
    "</div>";

  let currentAngle = 0;
  const rotor = container.querySelector("#wheel-rotor");
  const btn = container.querySelector("#spin-btn");
  const winnerEl = container.querySelector("#winner");
  const confettiCanvas = container.querySelector("#confetti");

  btn.addEventListener("click", () => {
    btn.disabled = true;
    winnerEl.hidden = true;
    // 4–8 full turns + a random offset within [0, 360)
    const turns = 4 + Math.floor(Math.random() * 5);
    const offset = Math.random() * 360;
    const targetAngle = currentAngle + turns * 360 + offset;
    rotor.style.transition =
      "transform 5s cubic-bezier(0.15, 0.65, 0.18, 1)";
    rotor.style.transform = "rotate(" + targetAngle + "deg)";
    rotor.addEventListener(
      "transitionend",
      () => {
        currentAngle = targetAngle % 360;
        // Pointer is at the top (-y axis). To find which slice
        // landed at the top, compute the angle "under" the pointer.
        // After the rotor rotates by currentAngle clockwise, the
        // slice originally at angle (360 - currentAngle) is now at
        // the pointer.
        const at = (360 - (currentAngle % 360)) % 360;
        const idx = Math.floor(at / SLICE) % N;
        const winner = films[idx];
        const posterHtml = winner.posterUrl
          ? '<img class="winner-poster" src="' + posterSize(winner.posterUrl, "w342") + '" alt="">'
          : "";
        winnerEl.innerHTML =
          '<div class="winner-card">' +
          posterHtml +
          '<div class="winner-label">And the winner is</div>' +
          '<div class="winner-title">' +
          escapeHtml(winner.title) +
          "</div>" +
          '<div class="winner-sub">' +
          [winner.year, winner.directors?.[0]].filter(Boolean).join(" · ") +
          "</div>" +
          '<a class="winner-link" href="#/film/' +
          encodeURIComponent(winner.guid) +
          '">Open detail</a>' +
          "</div>";
        winnerEl.hidden = false;
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
