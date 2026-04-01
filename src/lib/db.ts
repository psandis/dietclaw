import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { ScanResult } from "./types.js";

const DIETCLAW_HOME = process.env.DIETCLAW_HOME || path.join(os.homedir(), ".dietclaw");
const DB_PATH = path.join(DIETCLAW_HOME, "history.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(DIETCLAW_HOME, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')),
      total_size INTEGER NOT NULL,
      source_size INTEGER NOT NULL,
      total_files INTEGER NOT NULL,
      total_lines INTEGER NOT NULL,
      dep_count INTEGER,
      dep_size INTEGER,
      data TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_snapshots_project ON snapshots (project);
    CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON snapshots (timestamp);
  `);

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function saveSnapshot(result: ScanResult): void {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT INTO snapshots (project, total_size, source_size, total_files, total_lines, dep_count, dep_size, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    result.path,
    result.weight.totalSize,
    result.weight.sourceSize,
    result.totalFiles,
    result.totalLines,
    result.dependencies ? result.dependencies.count + result.dependencies.devCount : null,
    result.dependencies?.totalSize ?? null,
    JSON.stringify(result),
  );
}

export interface SnapshotRow {
  id: number;
  project: string;
  timestamp: string;
  total_size: number;
  source_size: number;
  total_files: number;
  total_lines: number;
  dep_count: number | null;
  dep_size: number | null;
  data: string;
}

export function getSnapshots(project: string, limit = 20): SnapshotRow[] {
  const db = getDb();

  return db
    .prepare("SELECT * FROM snapshots WHERE project = ? ORDER BY timestamp DESC LIMIT ?")
    .all(project, limit) as SnapshotRow[];
}

export function getDbPath(): string {
  return DB_PATH;
}
