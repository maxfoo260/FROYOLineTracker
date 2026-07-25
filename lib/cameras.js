// NYC DOT traffic-camera layer.
//
// NYC DOT publishes ~970 public street cameras (the same feed the "Traffic Cam
// Photobooth" project uses). We map each froyo shop to its nearest online
// camera so people can glance at the block and eyeball the crowd.
//
// Caveat baked into the UX copy: these cams sit at intersections and are
// low-res — they show the general street, not a headcount at the door.

const FEED_URL = "https://webcams.nyctmc.org/api/cameras";
const LIST_TTL_MS = 10 * 60 * 1000; // refresh the camera directory every 10 min
const IMAGE_TTL_MS = 4000; // share one upstream image fetch across viewers
const FETCH_TIMEOUT_MS = 15000;

let cameras = []; // cached directory
let listFetchedAt = 0;
let refreshing = null; // in-flight refresh promise (de-dupes concurrent calls)

const imageCache = new Map(); // id -> { buf, contentType, ts, pending }

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Camera feed responded ${res.status}`);
  return res.json();
}

// Refresh the camera directory. Best-effort: on failure we keep the last good
// list so a flaky feed never breaks the app.
export async function refreshCameras() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const data = await fetchJson(FEED_URL);
      cameras = data
        .filter((c) => c.isOnline === "true" && c.latitude && c.longitude)
        .map((c) => ({
          id: c.id,
          name: c.name,
          area: c.area,
          lat: c.latitude,
          lng: c.longitude,
        }));
      listFetchedAt = Date.now();
    } catch (err) {
      console.warn("Camera feed refresh failed:", err.message);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// Load once at boot and keep it warm in the background.
export async function initCameras() {
  await refreshCameras();
  setInterval(() => {
    refreshCameras();
  }, LIST_TTL_MS).unref?.();
}

function milesBetween(aLat, aLng, bLat, bLng) {
  const R = 3958.8; // Earth radius, miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Nearest online camera to a coordinate, or null if we have no coords/feed.
export function nearestCamera(lat, lng) {
  if (lat == null || lng == null || cameras.length === 0) return null;
  let best = null;
  let bestDist = Infinity;
  for (const cam of cameras) {
    const d = milesBetween(lat, lng, cam.lat, cam.lng);
    if (d < bestDist) {
      bestDist = d;
      best = cam;
    }
  }
  if (!best) return null;
  return {
    id: best.id,
    name: best.name,
    area: best.area,
    distanceMi: Math.round(bestDist * 100) / 100,
    // Served through our own origin so the browser gets one stable URL and the
    // upstream fetch is cached/shared server-side.
    imageUrl: `/api/cameras/${best.id}/image`,
  };
}

// Return recent image bytes for a camera, fetching upstream at most once per
// IMAGE_TTL_MS regardless of how many viewers are watching.
export async function getCameraImage(id) {
  const cached = imageCache.get(id);
  const now = Date.now();
  if (cached && now - cached.ts < IMAGE_TTL_MS && cached.buf) {
    return { buf: cached.buf, contentType: cached.contentType };
  }
  if (cached?.pending) return cached.pending;

  const pending = (async () => {
    const res = await fetch(`https://webcams.nyctmc.org/api/cameras/${id}/image`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`image ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || "image/jpeg";
    imageCache.set(id, { buf, contentType, ts: Date.now(), pending: null });
    return { buf, contentType };
  })();

  imageCache.set(id, { ...(cached || {}), pending });
  try {
    return await pending;
  } catch (err) {
    imageCache.set(id, { ...(cached || {}), pending: null });
    throw err;
  }
}
