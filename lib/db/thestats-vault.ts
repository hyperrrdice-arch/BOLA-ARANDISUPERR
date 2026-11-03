import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

let vaultDbInstance: DatabaseSync | null = null;

export function getVaultDbPath(): string {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, "thestats_raw_vault.db");
}

export function getTheStatsVaultDb(): DatabaseSync {
  if (vaultDbInstance) {
    return vaultDbInstance;
  }

  const dbPath = getVaultDbPath();
  const db = new DatabaseSync(dbPath);

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS raw_api_vault (
      resource_id TEXT PRIMARY KEY,
      endpoint TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_vault_endpoint ON raw_api_vault(endpoint);
  `);

  vaultDbInstance = db;
  return vaultDbInstance;
}

export function saveRawPayload(endpoint: string, resourceId: string, payload: any): void {
  const db = getTheStatsVaultDb();
  const jsonStr = typeof payload === "string" ? payload : JSON.stringify(payload);
  const stmt = db.prepare(`
    INSERT INTO raw_api_vault (resource_id, endpoint, payload_json, created_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(resource_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      created_at = CURRENT_TIMESTAMP
  `);
  stmt.run(resourceId, endpoint, jsonStr);
}

export interface VaultPayloadEntry<T = any> {
  payload: T;
  createdAt: string;
  ageMs: number;
}

export function getRawPayloadEntry<T = any>(resourceId: string): VaultPayloadEntry<T> | null {
  const db = getTheStatsVaultDb();
  const stmt = db.prepare("SELECT payload_json, created_at FROM raw_api_vault WHERE resource_id = ?");
  const row = stmt.get(resourceId) as { payload_json: string; created_at: string } | undefined;
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload_json) as T;
    const createdTime = new Date(row.created_at + "Z").getTime();
    const ageMs = Math.max(0, Date.now() - createdTime);
    return { payload, createdAt: row.created_at, ageMs };
  } catch {
    return null;
  }
}

export function getRawPayload<T = any>(resourceId: string, maxAgeMs?: number): T | null {
  const entry = getRawPayloadEntry<T>(resourceId);
  if (!entry) return null;
  if (maxAgeMs !== undefined && maxAgeMs > 0 && entry.ageMs > maxAgeMs) {
    return null; // Expired / butuh refresh
  }
  return entry.payload;
}

export function hasRawPayload(resourceId: string): boolean {
  const db = getTheStatsVaultDb();
  const stmt = db.prepare("SELECT 1 FROM raw_api_vault WHERE resource_id = ?");
  return !!stmt.get(resourceId);
}

export function getVaultMetrics() {
  const db = getTheStatsVaultDb();
  const total = (db.prepare("SELECT count(*) as c FROM raw_api_vault").get() as any)?.c || 0;
  const byEndpoint = db.prepare(`
    SELECT endpoint, count(*) as count
    FROM raw_api_vault
    GROUP BY endpoint
  `).all();
  return { totalPayloads: total, byEndpoint };
}
