import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import type { SnapshotRow } from "../src/lib/db.js";
import { formatDeps, formatSize, formatTrend, plural, updateLevel } from "../src/lib/format.js";
import type { DepsResult } from "../src/lib/types.js";

const plain = (text: string) => stripVTControlCharacters(text);

function makeSnapshot(id: number, totalSize: number, totalFiles: number): SnapshotRow {
  return {
    id,
    project: "/project",
    timestamp: `2026-10-0${id} 12:00:00`,
    total_size: totalSize,
    source_size: totalSize / 2,
    total_files: totalFiles,
    total_lines: totalFiles * 100,
    dep_count: null,
    dep_size: null,
    data: "{}",
  };
}

function makeDeps(overrides: Partial<DepsResult>): DepsResult {
  return {
    path: "/project",
    outdated: [],
    unused: [],
    heaviest: [],
    duplicates: [],
    warnings: [],
    ...overrides,
  };
}

describe("plural", () => {
  it("uses the singular for one", () => {
    expect(plural(1, "snapshot")).toBe("1 snapshot");
  });

  it("uses the plural for zero and many, with thousands separators", () => {
    expect(plural(0, "snapshot")).toBe("0 snapshots");
    expect(plural(1200, "snapshot")).toBe("1,200 snapshots");
  });
});

describe("formatSize", () => {
  it("formats each unit", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(formatSize(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });

  it("formats negative sizes with the same units", () => {
    expect(formatSize(-512)).toBe("-512 B");
    expect(formatSize(-2048)).toBe("-2.0 KB");
  });
});

describe("updateLevel", () => {
  it("classifies semver differences", () => {
    expect(updateLevel("5.6.2", "6.0.1")).toBe("major");
    expect(updateLevel("5.6.2", "5.7.0")).toBe("minor");
    expect(updateLevel("5.6.2", "5.6.3")).toBe("patch");
  });

  it("classifies prereleases by their target level", () => {
    expect(updateLevel("1.0.0", "2.0.0-beta.1")).toBe("major");
    expect(updateLevel("1.0.0", "1.1.0-rc.1")).toBe("minor");
  });

  it("treats a 0.x minor bump as major, following npm caret rules", () => {
    expect(updateLevel("0.120.0", "0.133.0")).toBe("major");
    expect(updateLevel("0.120.0", "0.120.5")).toBe("patch");
  });

  it("treats any 0.0.x bump as major", () => {
    expect(updateLevel("0.0.3", "0.0.4")).toBe("major");
  });

  it("returns other when latest is not newer", () => {
    expect(updateLevel("2.0.0", "2.0.0")).toBe("other");
    expect(updateLevel("2.0.0", "1.9.0")).toBe("other");
  });

  it("returns other for versions that are not valid semver", () => {
    expect(updateLevel("git+https://x", "1.0.0")).toBe("other");
  });
});

describe("formatTrend", () => {
  it("prompts to save a snapshot when there is no history", () => {
    expect(plain(formatTrend("/project", []))).toContain("dietclaw scan --save");
  });

  it("shows one row per snapshot with a dash for missing dependency data", () => {
    const out = plain(formatTrend("/project", [makeSnapshot(1, 1024, 3)]));

    expect(out).toContain("History (1 snapshot)");
    expect(out).toContain("2026-10-01 12:00:00");
    expect(out).toMatch(/│ - +│ - +│/);
    expect(out).not.toContain("Change");
  });

  it("summarizes the change from oldest to newest", () => {
    const out = plain(
      formatTrend("/project", [makeSnapshot(2, 4096, 7), makeSnapshot(1, 2048, 5)]),
    );

    expect(out).toContain("Total        +2.0 KB");
    expect(out).toContain("Files        +2");
    expect(out).toContain("Lines        +200");
  });

  it("shows shrinkage as a negative change", () => {
    const out = plain(
      formatTrend("/project", [makeSnapshot(2, 1024, 3), makeSnapshot(1, 2048, 3)]),
    );

    expect(out).toContain("Total        -1.0 KB");
    expect(out).toContain("Files        no change");
  });
});

describe("formatDeps", () => {
  it("shows warnings at the top of the report", () => {
    const out = plain(
      formatDeps(makeDeps({ warnings: ["Unsupported pnpm-lock.yaml version 6.0"] })),
    );

    expect(out).toContain("Warning: Unsupported pnpm-lock.yaml version 6.0");
    expect(out.indexOf("Warning:")).toBeLessThan(out.indexOf("Outdated Packages"));
  });

  it("lists version conflicts with what needs each version", () => {
    const out = plain(
      formatDeps(
        makeDeps({
          duplicates: [
            {
              name: "commander",
              entries: [
                { version: "4.1.1", requiredBy: "sucrase" },
                { version: "15.0.0", requiredBy: "direct" },
              ],
            },
          ],
        }),
      ),
    );

    expect(out).toContain("Version Conflicts (1)");
    expect(out).toMatch(/commander.*4\.1\.1.*sucrase/);
    expect(out).toMatch(/commander.*15\.0\.0.*direct/);
  });

  it("reports when the outdated check could not run", () => {
    const out = plain(formatDeps(makeDeps({ outdated: null })));

    expect(out).toContain("Could not check");
    expect(out).not.toContain("All packages are up to date");
  });

  it("reports up to date when nothing is outdated", () => {
    expect(plain(formatDeps(makeDeps({ outdated: [] })))).toContain("All packages are up to date");
  });

  it("lists outdated packages with their update level", () => {
    const out = plain(
      formatDeps(
        makeDeps({ outdated: [{ name: "chalk", current: "5.6.2", latest: "6.0.1", type: "dep" }] }),
      ),
    );

    expect(out).toContain("Outdated Packages (1)");
    expect(out).toMatch(/chalk.*5\.6\.2.*6\.0\.1.*major/);
  });
});
