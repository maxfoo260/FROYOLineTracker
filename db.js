// SQLite data layer. Kept small and framework-free so it's easy to swap for
// Postgres later (the app only touches the functions exported here).
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, "data", "froyo.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS shops (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    neighborhood TEXT,
    borough      TEXT,
    blurb        TEXT,
    popularity   REAL DEFAULT 1.0,
    emoji        TEXT DEFAULT '🍦'
  );

  CREATE TABLE IF NOT EXISTS reports (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id      TEXT NOT NULL REFERENCES shops(id),
    line_level   INTEGER NOT NULL,
    wait_minutes INTEGER,
    created_at   INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_reports_shop_time
    ON reports (shop_id, created_at DESC);
`);

// Load / refresh shop metadata from data/shops.json (idempotent upsert).
export function seedShops() {
  const shops = JSON.parse(readFileSync(join(__dirname, "data", "shops.json"), "utf8"));
  const upsert = db.prepare(`
    INSERT INTO shops (id, name, neighborhood, borough, blurb, popularity, emoji)
    VALUES (@id, @name, @neighborhood, @borough, @blurb, @popularity, @emoji)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      neighborhood = excluded.neighborhood,
      borough = excluded.borough,
      blurb = excluded.blurb,
      popularity = excluded.popularity,
      emoji = excluded.emoji
  `);
  const tx = db.transaction((rows) => rows.forEach((r) => upsert.run(r)));
  tx(shops);
  return shops.length;
}

export function getShops() {
  return db.prepare("SELECT * FROM shops ORDER BY name").all();
}

export function getShop(id) {
  return db.prepare("SELECT * FROM shops WHERE id = ?").get(id);
}

// Recent reports for a shop, newest first, within the given window (minutes).
export function getRecentReports(shopId, windowMinutes) {
  const cutoff = Date.now() - windowMinutes * 60000;
  return db
    .prepare(
      "SELECT line_level, wait_minutes, created_at FROM reports " +
        "WHERE shop_id = ? AND created_at >= ? ORDER BY created_at DESC"
    )
    .all(shopId, cutoff);
}

export function addReport(shopId, lineLevel, waitMinutes) {
  const info = db
    .prepare(
      "INSERT INTO reports (shop_id, line_level, wait_minutes, created_at) VALUES (?, ?, ?, ?)"
    )
    .run(shopId, lineLevel, waitMinutes ?? null, Date.now());
  return info.lastInsertRowid;
}

export default db;
