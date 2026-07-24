// Line-status model for the Froyo Line Tracker.
//
// Two data sources are blended into a single 0-100 "busyness" score:
//   1. A time-of-day ESTIMATE, derived from typical dessert-shop demand curves.
//   2. LIVE crowdsourced reports, which override the estimate when recent enough.
//
// The result always tells the UI which source is driving the number, so we can
// honestly label a card as "LIVE" vs "estimated".

// How long a live report stays relevant, in minutes. After this it's ignored.
export const REPORT_TTL_MINUTES = 45;

// Line level -> busyness score (0-100). This is the scale users tap on.
export const LINE_LEVELS = [
  { level: 0, label: "No line", score: 5, wait: 0 },
  { level: 1, label: "Short line", score: 28, wait: 5 },
  { level: 2, label: "Moderate", score: 52, wait: 12 },
  { level: 3, label: "Long line", score: 76, wait: 25 },
  { level: 4, label: "Out the door", score: 95, wait: 45 },
];

// Typical relative demand for a dessert spot by hour of day (local time), 0-23.
// Low in the morning, climbing through the afternoon, peaking after dinner.
const HOURLY_CURVE = [
  8, 4, 2, 1, 1, 1, 2, 5, 10, 16, 22, 30,
  40, 44, 48, 52, 58, 66, 82, 92, 88, 72, 50, 24,
];

// Weekend evenings are busier than weekday evenings — kept modest so it nudges
// the estimate rather than pinning every shop to the ceiling.
function dayMultiplier(dayOfWeek, hour) {
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isFridayNight = dayOfWeek === 5 && hour >= 17;
  return isWeekend || isFridayNight ? 1.15 : 1.0;
}

// Trendiness adjusts the estimate gently around the baseline shop (1.0), so a
// hot spot reads busier without a single multiplier saturating the whole scale.
function popularityFactor(popularity = 1.0) {
  return 0.6 + 0.4 * popularity;
}

// Get the current hour (0-23) and day of week (0=Sun) in New York local time,
// regardless of the server's timezone.
export function nycNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);

  const hourPart = parts.find((p) => p.type === "hour").value;
  const weekdayPart = parts.find((p) => p.type === "weekday").value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  // Intl returns "24" for midnight in some environments; normalize to 0-23.
  let hour = parseInt(hourPart, 10) % 24;
  return { hour, dayOfWeek: weekdayMap[weekdayPart] };
}

// Soft-saturation scale: larger = harder to reach 100. Preserves ordering
// between shops near the top instead of hard-clamping everyone to 100.
const SATURATION = 60;

// Time-of-day estimate for a shop, 0-100.
export function estimateBusyness(shop, date = new Date()) {
  const { hour, dayOfWeek } = nycNow(date);
  const base = HOURLY_CURVE[hour];
  const raw =
    base * popularityFactor(shop.popularity ?? 1.0) * dayMultiplier(dayOfWeek, hour);
  // Diminishing returns near the ceiling keeps busy shops distinguishable.
  const score = 100 * (1 - Math.exp(-raw / SATURATION));
  return clamp(Math.round(score), 0, 100);
}

// Blend recent live reports (if any) over the time-of-day estimate.
// `reports` = [{ line_level, wait_minutes, created_at (ms epoch) }], newest first.
export function computeStatus(shop, reports = [], date = new Date()) {
  const now = date.getTime();
  const estimate = estimateBusyness(shop, date);

  // Keep only fresh reports and weight them by recency (1.0 now -> 0.0 at TTL).
  const fresh = [];
  for (const r of reports) {
    const ageMin = (now - r.created_at) / 60000;
    if (ageMin < 0 || ageMin > REPORT_TTL_MINUTES) continue;
    const weight = 1 - ageMin / REPORT_TTL_MINUTES;
    fresh.push({ ...r, ageMin, weight });
  }

  if (fresh.length === 0) {
    return {
      source: "estimate",
      score: estimate,
      ...describe(estimate),
      estimate,
      liveReports: 0,
      lastReportMinutesAgo: null,
    };
  }

  // Recency-weighted average of reported busyness scores.
  let sumW = 0;
  let sumScore = 0;
  let sumWait = 0;
  let sumWaitW = 0;
  for (const r of fresh) {
    const lvl = LINE_LEVELS[r.line_level] ?? LINE_LEVELS[2];
    sumScore += lvl.score * r.weight;
    sumW += r.weight;
    if (r.wait_minutes != null) {
      sumWait += r.wait_minutes * r.weight;
      sumWaitW += r.weight;
    }
  }
  const liveScore = sumScore / sumW;

  // Confidence rises with the amount of recent signal; more/fresher reports
  // pull the final number toward the live value and away from the estimate.
  const confidence = clamp(sumW / 2, 0, 1);
  const score = clamp(Math.round(liveScore * confidence + estimate * (1 - confidence)), 0, 100);

  const desc = describe(score);
  // Prefer an actual reported wait time when people gave one.
  const reportedWait = sumWaitW > 0 ? Math.round(sumWait / sumWaitW) : desc.waitMinutes;

  return {
    source: "live",
    score,
    ...desc,
    waitMinutes: reportedWait,
    estimate,
    liveReports: fresh.length,
    lastReportMinutesAgo: Math.round(fresh[0].ageMin),
  };
}

// Map a 0-100 score to a human label, color band, and rough wait estimate.
export function describe(score) {
  let label, band, waitMinutes;
  if (score < 15) {
    label = "No line";
    band = "clear";
    waitMinutes = 0;
  } else if (score < 35) {
    label = "Short line";
    band = "short";
    waitMinutes = 5;
  } else if (score < 60) {
    label = "Moderate";
    band = "moderate";
    waitMinutes = 12;
  } else if (score < 80) {
    label = "Long line";
    band = "long";
    waitMinutes = 25;
  } else {
    label = "Out the door";
    band = "packed";
    waitMinutes = 45;
  }
  return { label, band, waitMinutes };
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
