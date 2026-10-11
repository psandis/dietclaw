import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDbPath, getSnapshots, saveSnapshot } from "../src/lib/db.js";
import type { ScanResult } from "../src/lib/types.js";

let tmpDir: string;
let previousHome: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dietclaw-db-test-"));
  previousHome = process.env.DIETCLAW_HOME;
  process.env.DIETCLAW_HOME = tmpDir;
});

afterEach(() => {
  // Close before removing: Windows cannot delete an open database file
  closeDb();
  if (previousHome === undefined) delete process.env.DIETCLAW_HOME;
  else process.env.DIETCLAW_HOME = previousHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeResult(project: string, totalFiles: number, withDeps = true): ScanResult {
  return {
    path: project,
    totalFiles,
    totalLines: totalFiles * 10,
    totalSize: totalFiles * 1000,
    weight: {
      categories: [],
      totalSize: totalFiles * 1000,
      sourceSize: totalFiles * 500,
      sourceRatio: 0.5,
      largeFiles: [],
      duplicates: [],
    },
    complexity: { longFiles: [], configFiles: [], npmScripts: 0, transitiveDeps: null },
    languages: [],
    dependencies: withDeps ? { count: 2, devCount: 3, totalSize: 4096, transitiveDeps: 40 } : null,
  };
}

describe("db", () => {
  it("stores the database under DIETCLAW_HOME", () => {
    saveSnapshot(makeResult("/project", 1));

    expect(getDbPath()).toBe(path.join(tmpDir, "history.db"));
    expect(fs.existsSync(getDbPath())).toBe(true);
  });

  it("saves and reads back a snapshot", () => {
    saveSnapshot(makeResult("/project", 5));

    const [row] = getSnapshots("/project");

    expect(row.total_files).toBe(5);
    expect(row.total_lines).toBe(50);
    expect(row.source_size).toBe(2500);
    expect(row.dep_count).toBe(5);
    expect(row.dep_size).toBe(4096);
    expect(JSON.parse(row.data).totalFiles).toBe(5);
  });

  it("stores null dependency columns when there is no package.json", () => {
    saveSnapshot(makeResult("/project", 1, false));

    const [row] = getSnapshots("/project");

    expect(row.dep_count).toBeNull();
    expect(row.dep_size).toBeNull();
  });

  it("returns snapshots newest first, even within the same second", () => {
    saveSnapshot(makeResult("/project", 1));
    saveSnapshot(makeResult("/project", 2));
    saveSnapshot(makeResult("/project", 3));

    expect(getSnapshots("/project").map((s) => s.total_files)).toEqual([3, 2, 1]);
  });

  it("filters by project", () => {
    saveSnapshot(makeResult("/a", 1));
    saveSnapshot(makeResult("/b", 2));

    expect(getSnapshots("/a").map((s) => s.total_files)).toEqual([1]);
  });

  it("respects the limit", () => {
    for (let i = 1; i <= 5; i++) saveSnapshot(makeResult("/project", i));

    expect(getSnapshots("/project", 2).map((s) => s.total_files)).toEqual([5, 4]);
  });

  it("reopens the database after closing", () => {
    saveSnapshot(makeResult("/project", 1));
    closeDb();

    expect(getSnapshots("/project")).toHaveLength(1);
  });
});
