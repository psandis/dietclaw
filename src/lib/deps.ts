import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { defaults } from "./config.js";
import { dirSize, type PackageJson, readAllSource, readPackageJson } from "./fs-utils.js";
import type {
  DepsOptions,
  DepsResult,
  DuplicateEntry,
  DuplicatePackage,
  HeavyPackage,
  OutdatedPackage,
  UnusedPackage,
} from "./types.js";

const SOURCE_EXTS = new Set(defaults.sourceExts);

export function analyzeDeps(options: DepsOptions): DepsResult {
  const root = path.resolve(options.path);
  const limit = options.limit || 20;
  const pkg = readPackageJson(root);

  if (!pkg) {
    return { path: root, outdated: [], unused: [], heaviest: [], duplicates: [] };
  }

  return {
    path: root,
    outdated: findOutdated(root, pkg).slice(0, limit),
    unused: findUnused(root, pkg),
    heaviest: findHeaviest(root, limit),
    duplicates: findDuplicates(root, pkg).slice(0, limit),
  };
}

// --- Outdated: uses npm outdated --json ---

function findOutdated(root: string, pkg: PackageJson): OutdatedPackage[] {
  try {
    const raw = execSync("npm outdated --json 2>/dev/null || true", {
      cwd: root,
      encoding: "utf-8",
      timeout: 30000,
    }).trim();

    if (!raw || raw === "{}") return [];

    const data = JSON.parse(raw) as Record<string, { current?: string; latest?: string }>;
    const deps = pkg.dependencies || {};

    return Object.entries(data)
      .filter(([, info]) => info.current && info.latest && info.current !== info.latest)
      .map(
        ([name, info]): OutdatedPackage => ({
          name,
          current: info.current || "",
          latest: info.latest || "",
          type: deps[name] ? "dep" : "dev",
        }),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

// --- Unused: checks imports against declared dependencies ---

function findUnused(root: string, pkg: PackageJson): UnusedPackage[] {
  const deps = pkg.dependencies || {};
  if (Object.keys(deps).length === 0) return [];

  const source = readAllSource(root, SOURCE_EXTS);
  if (!source) return [];

  const nmPath = path.join(root, "node_modules");

  return Object.entries(deps)
    .filter(([name]) => !isImported(name, source))
    .map(([name, specifier]) => {
      const version = readPackageJson(path.join(nmPath, ...name.split("/")))?.version || specifier;
      const pkgDir = path.join(nmPath, ...name.split("/"));
      const size = fs.existsSync(pkgDir) ? dirSize(pkgDir) : null;
      return { name, version, size };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function isImported(name: string, source: string): boolean {
  return [
    `from "${name}"`,
    `from '${name}'`,
    `from "${name}/`,
    `from '${name}/`,
    `require("${name}")`,
    `require('${name}')`,
    `require("${name}/`,
    `require('${name}/`,
    `import("${name}")`,
    `import('${name}')`,
  ].some((p) => source.includes(p));
}

// --- Heaviest: measures real package sizes in node_modules ---

function findHeaviest(root: string, limit: number): HeavyPackage[] {
  const nmPath = path.join(root, "node_modules");
  if (!fs.existsSync(nmPath)) return [];

  const pnpmStore = path.join(nmPath, ".pnpm");
  const packages = fs.existsSync(pnpmStore)
    ? measurePnpmPackages(pnpmStore)
    : measureFlatPackages(nmPath);

  return packages.sort((a, b) => b.size - a.size).slice(0, limit);
}

function measurePnpmPackages(pnpmPath: string): HeavyPackage[] {
  const largest = new Map<string, number>();

  for (const entry of fs.readdirSync(pnpmPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const name = parsePnpmDirName(entry.name);
    if (!name) continue;

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

// --- Duplicates: finds packages installed at multiple versions ---
// pnpm stores each resolved package in .pnpm/<name>@<version>/node_modules/
// We read the nested package.json to trace which parent resolves which version.

function findDuplicates(root: string, pkg: PackageJson): DuplicatePackage[] {
  const pnpmPath = path.join(root, "node_modules", ".pnpm");
  if (!fs.existsSync(pnpmPath)) return [];

  const directDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const entries = fs.readdirSync(pnpmPath, { withFileTypes: true });

  // Step 1: collect all installed versions per package
  const installed = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const parsed = parsePnpmDirEntry(entry.name);
    if (!parsed) continue;

    const versions = installed.get(parsed.name) || new Set();
    versions.add(parsed.version);
    installed.set(parsed.name, versions);
  }

  // Step 2: identify which packages have multiple versions
  const duplicateNames = new Set<string>();
  for (const [name, versions] of installed) {
    if (versions.size > 1) duplicateNames.add(name);
  }
  if (duplicateNames.size === 0) return [];

  // Step 3: trace which parent package resolves each version
  const resolvedBy = new Map<string, Map<string, Set<string>>>();
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const parent = parsePnpmDirName(entry.name);
    if (!parent) continue;

    const entryNm = path.join(pnpmPath, entry.name, "node_modules");
    if (!fs.existsSync(entryNm)) continue;

    for (const target of duplicateNames) {
      if (target === parent) continue;

      const version = readNestedVersion(entryNm, target);
      if (!version) continue;

      const byTarget = resolvedBy.get(target) || new Map<string, Set<string>>();
      const parents = byTarget.get(version) || new Set<string>();
      parents.add(parent);
      byTarget.set(version, parents);
      resolvedBy.set(target, byTarget);
    }
  }

  // Step 4: build results with "required by" context
  const results: DuplicatePackage[] = [];
  for (const [name, versions] of installed) {
    if (versions.size <= 1) continue;

    const byVersion = resolvedBy.get(name) || new Map();
    const dupEntries: DuplicateEntry[] = [...versions].sort().map((version) => ({
      version,
      requiredBy: labelRequiredBy(name, version, directDeps, byVersion.get(version)),
    }));

    results.push({ name, entries: dupEntries });
  }

  return results.sort((a, b) => b.entries.length - a.entries.length);
}

function labelRequiredBy(
  name: string,
  version: string,
  directDeps: Record<string, string>,
  parents: Set<string> | undefined,
): string {
  if (directDeps[name]) {
    const specMajor = directDeps[name].replace(/[\^~>=<\s]/g, "").split(".")[0];
    if (version.split(".")[0] === specMajor) return "direct";
  }

  if (parents && parents.size > 0) {
    const first = [...parents][0];
    return parents.size > 1 ? `${first} +${parents.size - 1} more` : first;
  }

  return "transitive";
}

function readNestedVersion(entryNm: string, packageName: string): string | null {
  try {
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(entryNm, ...packageName.split("/"), "package.json"), "utf-8"),
    );
    return pkgJson.version || null;
  } catch {
    return null;
  }
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

function parsePnpmDirEntry(dirName: string): { name: string; version: string } | null {
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
