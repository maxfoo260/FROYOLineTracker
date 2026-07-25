// Froyo Line Tracker — Express server + JSON API.
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  seedShops,
  getShops,
  getShop,
  getRecentReports,
  addReport,
} from "./db.js";
import { computeStatus, REPORT_TTL_MINUTES, LINE_LEVELS } from "./lib/status.js";
import { initCameras, nearestCamera, getCameraImage } from "./lib/cameras.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// Ensure shop metadata exists on boot (safe to run repeatedly).
seedShops();

// In-memory anti-spam: one report per shop per IP per cooldown window.
const COOLDOWN_MS = 30_000;
const lastReportByIp = new Map();

function shopWithStatus(shop) {
  const reports = getRecentReports(shop.id, REPORT_TTL_MINUTES);
  const status = computeStatus(shop, reports);
  const query = encodeURIComponent(`${shop.name} froyo ${shop.neighborhood} NYC`);
  return {
    id: shop.id,
    name: shop.name,
    neighborhood: shop.neighborhood,
    borough: shop.borough,
    blurb: shop.blurb,
    emoji: shop.emoji,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${query}`,
    camera: nearestCamera(shop.lat, shop.lng),
    status,
  };
}

// All shops, sorted shortest-line first (best pick for "where should I go?").
app.get("/api/shops", (_req, res) => {
  const shops = getShops().map(shopWithStatus);
  shops.sort((a, b) => a.status.score - b.status.score);
  res.json({ shops, updatedAt: Date.now() });
});

// Single shop detail.
app.get("/api/shops/:id", (req, res) => {
  const shop = getShop(req.params.id);
  if (!shop) return res.status(404).json({ error: "Shop not found" });
  res.json(shopWithStatus(shop));
});

// The tap targets the UI offers, so the client and server agree on levels.
app.get("/api/levels", (_req, res) => {
  res.json({ levels: LINE_LEVELS, ttlMinutes: REPORT_TTL_MINUTES });
});

// Submit a live line report.
app.post("/api/shops/:id/report", (req, res) => {
  const shop = getShop(req.params.id);
  if (!shop) return res.status(404).json({ error: "Shop not found" });

  const lineLevel = Number(req.body?.lineLevel);
  if (!Number.isInteger(lineLevel) || lineLevel < 0 || lineLevel > 4) {
    return res.status(400).json({ error: "lineLevel must be an integer 0-4" });
  }

  let waitMinutes = req.body?.waitMinutes;
  if (waitMinutes != null) {
    waitMinutes = Number(waitMinutes);
    if (!Number.isFinite(waitMinutes) || waitMinutes < 0 || waitMinutes > 240) {
      return res.status(400).json({ error: "waitMinutes must be 0-240" });
    }
    waitMinutes = Math.round(waitMinutes);
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.ip;
  const key = `${ip}:${shop.id}`;
  const last = lastReportByIp.get(key);
  if (last && Date.now() - last < COOLDOWN_MS) {
    return res
      .status(429)
      .json({ error: "You just reported this spot — give it a moment." });
  }

  addReport(shop.id, lineLevel, waitMinutes);
  lastReportByIp.set(key, Date.now());

  res.json(shopWithStatus(shop));
});

// Live image proxy for a nearby NYC DOT street camera. Cached server-side so
// many viewers refreshing every few seconds share one upstream fetch.
app.get("/api/cameras/:id/image", async (req, res) => {
  try {
    const { buf, contentType } = await getCameraImage(req.params.id);
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=3");
    res.send(buf);
  } catch {
    res.status(502).json({ error: "Camera image unavailable" });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Warm the camera directory before accepting traffic (best-effort).
await initCameras().catch((err) =>
  console.warn("Camera init failed, continuing without cams:", err.message)
);

app.listen(PORT, () => {
  console.log(`🍦 Froyo Line Tracker running at http://localhost:${PORT}`);
});
