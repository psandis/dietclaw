import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findDuplicates,
  findImportedPackages,
  labelRequiredBy,
  parseNpmOutdated,
} from "../src/lib/deps.js";
import type { PnpmLockfile } from "../src/lib/pnpm-lock.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dietclaw-deps-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relativePath: string, content: string) {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function makeLockfile(
  versions: Record<string, string[]>,
  dependents: Record<string, string[]> = {},
  direct: Record<string, string> = {},
): PnpmLockfile {
  return {
    versions: new Map(Object.entries(versions).map(([name, v]) => [name, new Set(v)])),
    dependents: new Map(Object.entries(dependents).map(([key, p]) => [key, new Set(p)])),
    direct: new Map(Object.entries(direct)),
  };
}

describe("findImportedPackages", () => {
  it("collects packages from all JS and TS module files", () => {
    writeFile("src/a.ts", 'import chalk from "chalk";');
    writeFile("src/b.mjs", 'export * from "lodash/get";');
    writeFile("src/c.cjs", 'const x = require("@scope/pkg/sub");');

    expect([...findImportedPackages(tmpDir)].sort()).toEqual(["@scope/pkg", "chalk", "lodash"]);
  });

  it("skips ignored directories", () => {
    writeFile("src/a.ts", 'import "used";');
    writeFile("dist/bundle.js", 'import "only-in-dist";');
    writeFile("node_modules/x/index.js", 'import "only-in-node-modules";');

    expect([...findImportedPackages(tmpDir)]).toEqual(["used"]);
  });

  it("ignores files that are not JS or TS modules", () => {
    writeFile("notes.md", 'import x from "not-code";');

    expect(findImportedPackages(tmpDir).size).toBe(0);
  });
});

describe("parseNpmOutdated", () => {
  it("returns an empty report for empty output", () => {
    expect(parseNpmOutdated("")).toEqual({});
    expect(parseNpmOutdated("  \n")).toEqual({});
  });

  it("parses a report of outdated packages", () => {
    const stdout = JSON.stringify({ chalk: { current: "5.0.0", latest: "6.0.1" } });
    expect(parseNpmOutdated(stdout)).toEqual({ chalk: { current: "5.0.0", latest: "6.0.1" } });
  });

  it("returns null for npm error output", () => {
    const stdout = JSON.stringify({ error: { code: "ENOTFOUND", summary: "network" } });
    expect(parseNpmOutdated(stdout)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseNpmOutdated("npm ERR! something")).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(parseNpmOutdated("[]")).toBeNull();
    expect(parseNpmOutdated("42")).toBeNull();
  });
});

describe("labelRequiredBy", () => {
  it("labels direct dependencies", () => {
    expect(labelRequiredBy(true, new Set(["other"]))).toBe("direct");
  });

  it("names a single parent", () => {
    expect(labelRequiredBy(false, new Set(["sucrase"]))).toBe("sucrase");
  });

  it("summarizes multiple parents in a stable order", () => {
    expect(labelRequiredBy(false, new Set(["c", "a", "b"]))).toBe("a +2 more");
  });

  it("falls back to transitive", () => {
    expect(labelRequiredBy(false, undefined)).toBe("transitive");
    expect(labelRequiredBy(false, new Set())).toBe("transitive");
  });
});

describe("findDuplicates", () => {
  it("reports packages with more than one version", () => {
    const lockfile = makeLockfile(
      { commander: ["15.0.0", "4.1.1"], chalk: ["6.0.1"] },
      { "commander@4.1.1": ["sucrase"] },
      { commander: "15.0.0" },
    );

    expect(findDuplicates(lockfile)).toEqual([
      {
        name: "commander",
        entries: [
          { version: "4.1.1", requiredBy: "sucrase" },
          { version: "15.0.0", requiredBy: "direct" },
        ],
      },
    ]);
  });

  it("sorts versions numerically, not as text", () => {
    const lockfile = makeLockfile({ x: ["10.0.0", "9.0.0", "1.2.0"] });

    expect(findDuplicates(lockfile)[0].entries.map((e) => e.version)).toEqual([
      "1.2.0",
      "9.0.0",
      "10.0.0",
    ]);
  });

  it("lists packages with the most versions first, then by name", () => {
    const lockfile = makeLockfile({
      b: ["1.0.0", "2.0.0"],
      a: ["1.0.0", "2.0.0"],
      c: ["1.0.0", "2.0.0", "3.0.0"],
    });

    expect(findDuplicates(lockfile).map((d) => d.name)).toEqual(["c", "a", "b"]);
  });

  it("returns nothing when every package has one version", () => {
    expect(findDuplicates(makeLockfile({ a: ["1.0.0"] }))).toEqual([]);
  });
});
