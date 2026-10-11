import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO_ROOT, "src", "cli.ts");
const { version } = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"));

let tmpDir: string;
let project: string;
let home: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dietclaw-cli-test-"));
  project = path.join(tmpDir, "project");
  home = path.join(tmpDir, "home");
  fs.mkdirSync(project);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relativePath: string, content: string) {
  const fullPath = path.join(project, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

// Runs the CLI in a child process with its own DIETCLAW_HOME and no colors
function run(...args: string[]) {
  const result = spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    env: { ...process.env, DIETCLAW_HOME: home, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runJson<T>(...args: string[]): T {
  const result = run("--json", ...args);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as T;
}

describe("cli", { timeout: 30000 }, () => {
  it("prints the package version", () => {
    const result = run("--version");

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(version);
  });

  it("lists all commands in help", () => {
    const result = run("--help");

    expect(result.status).toBe(0);
    for (const command of ["scan", "deps", "trend"]) expect(result.stdout).toContain(command);
  });

  it("scans a project as JSON", () => {
    writeFile("src/index.ts", "export const x = 1;\n");

    const result = runJson<{ path: string; totalFiles: number; totalLines: number }>(
      "scan",
      project,
    );

    expect(result.path).toBe(fs.realpathSync.native(project));
    expect(result.totalFiles).toBe(1);
    expect(result.totalLines).toBe(1);
  });

  it("prints a human-readable report", () => {
    writeFile("src/index.ts", "export const x = 1;\n");

    const result = run("scan", project);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Project Health Report");
    expect(result.stdout).toContain("Source code");
  });

  it("saves snapshots and shows them in trend, newest first", () => {
    writeFile("a.ts", "a\n");
    expect(run("scan", project, "--save").stdout).toContain("Snapshot saved.");

    writeFile("b.ts", "b\n");
    run("scan", project, "--save");

    const snapshots = runJson<{ total_files: number }[]>("trend", project);
    expect(snapshots.map((s) => s.total_files)).toEqual([2, 1]);

    const text = run("trend", project).stdout;
    expect(text).toContain("History (2 snapshots)");
    expect(text).toContain("Files        +1");
  });

  it("saves one snapshot per project with --each --save", () => {
    writeFile("one/package.json", "{}");
    writeFile("two/package.json", "{}");

    expect(run("scan", project, "--each", "--save").stdout).toContain("2 snapshots saved.");
    expect(runJson<unknown[]>("trend", path.join(project, "one"))).toHaveLength(1);
    expect(runJson<unknown[]>("trend", path.join(project, "two"))).toHaveLength(1);
  });

  it("explains how to start tracking when there is no history", () => {
    const result = run("trend", project);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("dietclaw scan --save");
  });

  it("analyzes dependencies as JSON", () => {
    const result = runJson<{ path: string; unused: unknown[]; warnings: string[] }>(
      "deps",
      project,
    );

    expect(result.path).toBe(fs.realpathSync.native(project));
    expect(result.unused).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  // End to end through the real `npm outdated`, which queries the npm registry
  it("reports outdated packages from npm", { timeout: 120000 }, () => {
    writeFile(
      "package.json",
      JSON.stringify({ name: "fixture", dependencies: { chalk: "5.0.0" } }),
    );
    writeFile(
      "node_modules/chalk/package.json",
      JSON.stringify({ name: "chalk", version: "5.0.0" }),
    );

    const result = runJson<{
      outdated: { name: string; current: string; latest: string; type: string }[] | null;
    }>("deps", project);

    expect(result.outdated).not.toBeNull();
    const chalk = result.outdated?.find((p) => p.name === "chalk");
    expect(chalk).toMatchObject({ name: "chalk", current: "5.0.0", type: "dep" });
    expect(semver.gt(chalk?.latest ?? "0.0.0", "5.0.0")).toBe(true);

    const text = run("deps", project).stdout;
    expect(text).toMatch(/Outdated Packages \(1\)/);
    expect(text).toMatch(/chalk +│ 5\.0\.0 +│ \S+ +│ major/);
  });

  it("fails with a one-line error for a missing path", () => {
    const result = run("scan", path.join(tmpDir, "missing"));

    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toMatch(/^error: Path not found: /);
    expect(result.stderr).not.toContain("    at ");
  });

  it("rejects an invalid --limit", () => {
    for (const value of ["abc", "0", "-1", "1.5"]) {
      const result = run("scan", project, "--limit", value);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Must be a positive integer.");
    }
  });
});
