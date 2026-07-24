// Froyo Line Tracker — frontend.
const REFRESH_MS = 15_000;

const $shops = document.getElementById("shops");
const $refreshNote = document.getElementById("refresh-note");
const $modal = document.getElementById("modal");
const $modalShop = document.getElementById("modal-shop");
const $levels = document.getElementById("levels");
const $wait = document.getElementById("wait");
const $submit = document.getElementById("submit-report");
const $error = document.getElementById("modal-error");
const $ttl = document.getElementById("ttl");

let LEVELS = [];
let selectedShop = null;
let selectedLevel = null;

const SWATCH = ["#2fbf71", "#7bc043", "#f4b942", "#f4762a", "#e23e5b"];

init();

async function init() {
  showSkeletons();
  try {
    const res = await fetch("/api/levels");
    const data = await res.json();
    LEVELS = data.levels;
    $ttl.textContent = data.ttlMinutes;
  } catch {
    LEVELS = [
      { level: 0, label: "No line" },
      { level: 1, label: "Short line" },
      { level: 2, label: "Moderate" },
      { level: 3, label: "Long line" },
      { level: 4, label: "Out the door" },
    ];
  }
  buildLevelButtons();
  await load();
  setInterval(load, REFRESH_MS);
  wireModal();
}

function showSkeletons() {
  $shops.innerHTML = Array.from({ length: 6 })
    .map(() => `<div class="skeleton"></div>`)
    .join("");
}

async function load() {
  try {
    const res = await fetch("/api/shops");
    const data = await res.json();
    render(data.shops);
    const t = new Date(data.updatedAt);
    $refreshNote.textContent = `Live · updated ${t.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  } catch {
    $refreshNote.textContent = "Couldn't reach the server — retrying…";
  }
}

function render(shops) {
  $shops.innerHTML = shops.map(cardHTML).join("");
  for (const btn of document.querySelectorAll("[data-report]")) {
    btn.addEventListener("click", () => openModal(btn.dataset.report));
  }
  window.__shops = shops; // for the modal to look up names
}

function cardHTML(shop) {
  const s = shop.status;
  const isLive = s.source === "live";
  const pill = isLive
    ? `<span class="pill live">● Live</span>`
    : `<span class="pill estimate">Estimate</span>`;

  const waitText =
    s.waitMinutes > 0 ? `~${s.waitMinutes} min wait` : "Walk right in";

  let metaRight;
  if (isLive) {
    const ago = s.lastReportMinutesAgo;
    const agoText = ago <= 0 ? "just now" : `${ago} min ago`;
    metaRight = `${s.liveReports} report${s.liveReports === 1 ? "" : "s"} · ${agoText}`;
  } else {
    metaRight = "Based on typical crowds";
  }

  return `
    <article class="card">
      <div class="card-head">
        <div>
          <h3 class="card-name">${shop.emoji} ${escapeHTML(shop.name)}</h3>
          <p class="card-hood">${escapeHTML(shop.neighborhood)} · ${escapeHTML(shop.borough)}</p>
        </div>
        ${pill}
      </div>

      <div class="status ${s.band}">
        <span class="status-label">${s.label}</span>
        <span class="status-wait">${waitText}</span>
      </div>
      <div class="status-meter">
        <span style="width:${s.score}%;background:${SWATCH[bandIndex(s.band)]}"></span>
      </div>

      <p class="card-blurb">${escapeHTML(shop.blurb)}</p>

      <div class="card-meta">
        <span>${escapeHTML(metaRight)}</span>
      </div>

      <div class="card-actions">
        <button class="btn btn-report" data-report="${shop.id}">Report the line</button>
        <a class="btn btn-map" href="${shop.mapsUrl}" target="_blank" rel="noopener">Map ↗</a>
      </div>
    </article>`;
}

function bandIndex(band) {
  return ["clear", "short", "moderate", "long", "packed"].indexOf(band);
}

/* ---------- Modal ---------- */

function buildLevelButtons() {
  $levels.innerHTML = LEVELS.map(
    (lvl) => `
      <button class="level-btn" data-level="${lvl.level}">
        <span class="level-swatch" style="background:${SWATCH[lvl.level]}"></span>
        ${escapeHTML(lvl.label)}
      </button>`
  ).join("");
  for (const btn of $levels.querySelectorAll(".level-btn")) {
    btn.addEventListener("click", () => {
      selectedLevel = Number(btn.dataset.level);
      $levels
        .querySelectorAll(".level-btn")
        .forEach((b) => b.classList.toggle("selected", b === btn));
      $error.textContent = "";
    });
  }
}

function openModal(shopId) {
  const shop = (window.__shops || []).find((s) => s.id === shopId);
  if (!shop) return;
  selectedShop = shopId;
  selectedLevel = null;
  $modalShop.textContent = `${shop.emoji} ${shop.name} · ${shop.neighborhood}`;
  $wait.value = "";
  $error.textContent = "";
  $levels.querySelectorAll(".level-btn").forEach((b) => b.classList.remove("selected"));
  $modal.classList.remove("hidden");
}

function closeModal() {
  $modal.classList.add("hidden");
}

function wireModal() {
  document.getElementById("modal-close").addEventListener("click", closeModal);
  $modal.addEventListener("click", (e) => {
    if (e.target === $modal) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
  $submit.addEventListener("click", submitReport);
}

async function submitReport() {
  if (selectedLevel == null) {
    $error.textContent = "Tap how long the line is first.";
    return;
  }
  $submit.disabled = true;
  $error.textContent = "";

  const body = { lineLevel: selectedLevel };
  const waitVal = $wait.value.trim();
  if (waitVal !== "") body.waitMinutes = Number(waitVal);

  try {
    const res = await fetch(`/api/shops/${selectedShop}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      $error.textContent = data.error || "Something went wrong.";
      $submit.disabled = false;
      return;
    }
    closeModal();
    await load(); // reflect the new report immediately
  } catch {
    $error.textContent = "Network error — try again.";
  } finally {
    $submit.disabled = false;
  }
}

function escapeHTML(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
