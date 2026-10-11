import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import { defaults } from "./config.js";
import {
  dirSize,
  listFiles,
  type PackageJson,
  readPackageJson,
  resolveProjectPath,
} from "./fs-utils.js";
import { collectModuleSpecifiers, packageNameOf } from "./imports.js";
import { LockfileError, type PnpmLockfile, readPnpmLockfile } from "./pnpm-lock.js";
import type {
  DepsOptions,
  DepsResult,
  DuplicateEntry,
  DuplicatePackage,
  HeavyPackage,
  OutdatedPackage,
  UnusedPackage,
} from "./types.js";

const MODULE_EXTS = new Set(defaults.moduleExts);
const IGNORE_DIRS = new Set(defaults.ignoreDirs);

export function analyzeDeps(options: DepsOptions): DepsResult {
  const root = resolveProjectPath(options.path);
  const limit = options.limit || 20;
  const pkg = readPackageJson(root);
  const warnings: string[] = [];

  if (!pkg) {
    return { path: root, outdated: [], unused: [], heaviest: [], duplicates: [], warnings };
  }

  let lockfile: PnpmLockfile | null = null;
  try {
    lockfile = readPnpmLockfile(root);
  } catch (err) {
    if (!(err instanceof LockfileError)) throw err;
    warnings.push(`${err.message}. Version conflicts were not analyzed.`);
  }

  return {
    path: root,
    outdated: findOutdated(root, pkg)?.slice(0, limit) ?? null,
    unused: findUnused(root, pkg),
    heaviest: findHeaviest(root, lockfile, limit),
    duplicates: lockfile ? findDuplicates(lockfile).slice(0, limit) : [],
    warnings,
  };
}

// --- Outdated: uses npm outdated --json ---
// Returns null when the check could not run (npm missing, timeout, bad output).

interface NpmOutdatedEntry {
  current?: string;
  latest?: string;
}

type NpmOutdatedReport = Record<string, NpmOutdatedEntry>;

interface ExecError extends Error {
  status: number | null;
  stdout: string;
}

function findOutdated(root: string, pkg: PackageJson): OutdatedPackage[] | null {
  const report = runNpmOutdated(root);
  if (!report) return null;

  const deps = pkg.dependencies || {};

  return Object.entries(report)
    .flatMap(([name, { current, latest }]): OutdatedPackage[] =>
      current && latest && current !== latest
        ? [{ name, current, latest, type: deps[name] ? "dep" : "dev" }]
        : [],
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Runs through the platform shell (sh or cmd.exe) so npm.cmd resolves on Windows.
// The command is a fixed string, so no user input reaches the shell.
function runNpmOutdated(root: string): NpmOutdatedReport | null {
  let stdout: string;

  try {
    stdout = execSync("npm outdated --json", {
      cwd: root,
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (err) {
    // Exit code 1 is npm's documented signal for "outdated packages found".
    // Anything else (missing npm, timeout, crash) means the check did not run.
    if (!isExecError(err) || err.status !== 1) return null;
    stdout = err.stdout;
  }

  return parseNpmOutdated(stdout);
}

export function parseNpmOutdated(stdout: string): NpmOutdatedReport | null {
  const text = stdout.trim();
  if (text === "") return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  // On failure npm still prints JSON, shaped as { "error": { code, summary } }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  if ("error" in parsed) return null;

  return parsed as NpmOutdatedReport;
}

function isExecError(err: unknown): err is ExecError {
  return (
    err instanceof Error && "status" in err && "stdout" in err && typeof err.stdout === "string"
  );
}

// --- Unused: checks imports against declared dependencies ---

function findUnused(root: string, pkg: PackageJson): UnusedPackage[] {
  const deps = pkg.dependencies || {};
  if (Object.keys(deps).length === 0) return [];

  const used = findImportedPackages(root);
  const nmPath = path.join(root, "node_modules");

  return Object.entries(deps)
    .filter(([name]) => !used.has(name))
    .map(([name, specifier]) => {
      const pkgDir = path.join(nmPath, ...name.split("/"));
      const version = readPackageJson(pkgDir)?.version || specifier;
      const size = fs.existsSync(pkgDir) ? dirSize(pkgDir) : null;
      return { name, version, size };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Package names imported anywhere in the project's JS/TS files
export function findImportedPackages(root: string): Set<string> {
  const packages = new Set<string>();

  for (const file of listFiles(root, IGNORE_DIRS)) {
    if (!MODULE_EXTS.has(path.extname(file).toLowerCase())) continue;

    const source = fs.readFileSync(file, "utf-8");
    for (const specifier of collectModuleSpecifiers(file, source)) {
      const name = packageNameOf(specifier);
      if (name) packages.add(name);
    }
  }

  return packages;
}

// --- Heaviest: measures real package sizes in node_modules ---

function findHeaviest(root: string, lockfile: PnpmLockfile | null, limit: number): HeavyPackage[] {
  const nmPath = path.join(root, "node_modules");
  if (!fs.existsSync(nmPath)) return [];

  const pnpmStore = path.join(nmPath, ".pnpm");
  const packages = fs.existsSync(pnpmStore)
    ? measurePnpmPackages(pnpmStore, lockfile)
    : measureFlatPackages(nmPath);

  return packages.sort((a, b) => b.size - a.size).slice(0, limit);
}

// When a lockfile is available, store entries it no longer references
// (left behind after dependency changes) are skipped.
function measurePnpmPackages(pnpmPath: string, lockfile: PnpmLockfile | null): HeavyPackage[] {
  const largest = new Map<string, number>();

  for (const entry of fs.readdirSync(pnpmPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const parsed = parsePnpmDirEntry(entry.name);
    if (!parsed) continue;
    if (lockfile && !lockfile.versions.get(parsed.name)?.has(parsed.version)) continue;

    const { name } = parsed;
    const pkgDir = path.join(pnpmPath, entry.name, "node_modules", ...name.split("/"));
    if (!fs.existsSync(pkgDir)) continue;

    const size = dirSize(pkgDir);
    if (size > (largest.get(name) || 0)) largest.set(name, size);
  }

  return [...largest.entries()].map(([name, size]) => ({ name, size }));
}

function measureFlatPackages(nmPath: string): HeavyPackage[] {
  const packages: HeavyPackage[] = [];

  for (const entry of fs.readdirSync(nmPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    if (entry.name.startsWith("@")) {
      for (const scoped of fs.readdirSync(path.join(nmPath, entry.name), { withFileTypes: true })) {
        if (!scoped.isDirectory()) continue;
        packages.push({
          name: `${entry.name}/${scoped.name}`,
          size: dirSize(path.join(nmPath, entry.name, scoped.name)),
        });
      }
    } else {
      packages.push({ name: entry.name, size: dirSize(path.join(nmPath, entry.name)) });
    }
  }

  return packages;
}

// --- Duplicates: packages resolved at more than one version ---
// Read from pnpm-lock.yaml, so only packages pnpm actually uses on this
// platform are reported, not leftovers in node_modules/.pnpm.

export function findDuplicates(lockfile: PnpmLockfile): DuplicatePackage[] {
  const results: DuplicatePackage[] = [];

  for (const [name, versions] of lockfile.versions) {
    if (versions.size <= 1) continue;

    const entries: DuplicateEntry[] = [...versions].sort(compareVersions).map((version) => ({
      version,
      requiredBy: labelRequiredBy(
        lockfile.direct.get(name) === version,
        lockfile.dependents.get(`${name}@${version}`),
      ),
    }));

    results.push({ name, entries });
  }

  return results.sort(
    (a, b) => b.entries.length - a.entries.length || a.name.localeCompare(b.name),
  );
}

export function labelRequiredBy(isDirect: boolean, parents: Set<string> | undefined): string {
  if (isDirect) return "direct";

  if (parents && parents.size > 0) {
    const [first, ...rest] = [...parents].sort();
    return rest.length > 0 ? `${first} +${rest.length} more` : first;
  }

  return "transitive";
}

function compareVersions(a: string, b: string): number {
  return semver.valid(a) && semver.valid(b) ? semver.compare(a, b) : a.localeCompare(b);
}

// --- pnpm directory name parsing ---

function parsePnpmDirName(dirName: string): string | null {
  if (dirName.startsWith("@")) {
    const withSlash = dirName.replace(/\+/, "/");
    const slashIdx = withSlash.indexOf("/");
    const atIdx = withSlash.indexOf("@", slashIdx + 1);
    return atIdx > 0 ? withSlash.slice(0, atIdx) : null;
  }

  const atIdx = dirName.indexOf("@");
  return atIdx > 0 ? dirName.slice(0, atIdx) : null;
}

export function parsePnpmDirEntry(dirName: string): { name: string; version: string } | null {
  const name = parsePnpmDirName(dirName);
  if (!name) return null;

  const versionStart = dirName.startsWith("@")
    ? dirName.indexOf("@", dirName.indexOf("+") + 1) + 1
    : dirName.indexOf("@") + 1;

  let versionEnd = dirName.indexOf("_", versionStart);
  if (versionEnd === -1) versionEnd = dirName.length;

  const version = dirName.slice(versionStart, versionEnd);
  if (!/^\d+\.\d+\.\d+/.test(version)) return null;

  return { name, version };
}
