import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import { parseAllDocuments } from "yaml";

// Reads pnpm-lock.yaml (lockfile format v9, written by pnpm 9 and later).
//
// pnpm 11+ may write two YAML documents: one that pins pnpm itself
// (packageManagerDependencies) and one for the project. The project document
// is the one whose root importer declares dependencies.

export const LOCKFILE_NAME = "pnpm-lock.yaml";
const SUPPORTED_LOCKFILE_MAJOR = 9;

export interface PnpmLockfile {
  // Package name -> versions in the lockfile that install on this platform
  versions: Map<string, Set<string>>;
  // "name@version" -> names of packages that depend on it
  dependents: Map<string, Set<string>>;
  // Direct dependency name -> resolved version
  direct: Map<string, string>;
}

export class LockfileError extends Error {}

interface PackageMeta {
  os?: string[];
  cpu?: string[];
  libc?: string[];
}

interface Snapshot {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface Importer {
  dependencies?: Record<string, { version: string }>;
  devDependencies?: Record<string, { version: string }>;
  optionalDependencies?: Record<string, { version: string }>;
}

interface LockfileDocument {
  lockfileVersion?: string | number;
  importers?: Record<string, Importer>;
  packages?: Record<string, PackageMeta | null>;
  snapshots?: Record<string, Snapshot | null>;
}

const IMPORTER_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

// Returns null when the project has no pnpm-lock.yaml.
// Throws LockfileError when the file exists but cannot be used.
export function readPnpmLockfile(root: string): PnpmLockfile | null {
  const file = path.join(root, LOCKFILE_NAME);
  if (!fs.existsSync(file)) return null;

  return parsePnpmLockfile(fs.readFileSync(file, "utf-8"));
}

export function parsePnpmLockfile(text: string): PnpmLockfile {
  const lockfile: PnpmLockfile = { versions: new Map(), dependents: new Map(), direct: new Map() };
  const doc = selectProjectDocument(text);
  if (!doc) return lockfile;

  const major = Number.parseInt(String(doc.lockfileVersion ?? ""), 10);
  if (major !== SUPPORTED_LOCKFILE_MAJOR) {
    throw new LockfileError(
      `Unsupported ${LOCKFILE_NAME} version ${doc.lockfileVersion ?? "(missing)"}, expected ${SUPPORTED_LOCKFILE_MAJOR}.x`,
    );
  }

  for (const [key, meta] of Object.entries(doc.packages ?? {})) {
    const pkg = parsePackageKey(key);
    if (!pkg || !installsOnThisPlatform(meta ?? {})) continue;
    addToSet(lockfile.versions, pkg.name, pkg.version);
  }

  for (const [key, snapshot] of Object.entries(doc.snapshots ?? {})) {
    const parent = parsePackageKey(key);
    if (!parent || !snapshot) continue;

    const deps = { ...snapshot.dependencies, ...snapshot.optionalDependencies };
    for (const [name, ref] of Object.entries(deps)) {
      const child = resolveReference(name, ref);
      if (child) addToSet(lockfile.dependents, `${child.name}@${child.version}`, parent.name);
    }
  }

  const importer = doc.importers?.["."] ?? {};
  for (const section of IMPORTER_SECTIONS) {
    for (const [name, { version }] of Object.entries(importer[section] ?? {})) {
      const resolved = resolveReference(name, version);
      if (resolved) lockfile.direct.set(resolved.name, resolved.version);
    }
  }

  return lockfile;
}

function selectProjectDocument(text: string): LockfileDocument | null {
  const docs = parseAllDocuments(text);
  if (!Array.isArray(docs)) return null;

  const parsed: LockfileDocument[] = [];
  for (const doc of docs) {
    if (doc.errors.length > 0) {
      throw new LockfileError(`Invalid ${LOCKFILE_NAME}: ${doc.errors[0].message}`);
    }
    parsed.push((doc.toJS() ?? {}) as LockfileDocument);
  }

  const declaresDependencies = (doc: LockfileDocument) => {
    const root = doc.importers?.["."];
    return root !== undefined && IMPORTER_SECTIONS.some((section) => root[section] !== undefined);
  };

  return parsed.find(declaresDependencies) ?? null;
}

// "name@1.2.3" or "@scope/name@1.2.3(peer@4.5.6)" -> { name, version }
export function parsePackageKey(key: string): { name: string; version: string } | null {
  const withoutPeers = key.split("(")[0];
  const at = withoutPeers.lastIndexOf("@");
  if (at <= 0) return null;
  return { name: withoutPeers.slice(0, at), version: withoutPeers.slice(at + 1) };
}

// Dependency references in snapshots and importers:
//   "1.2.3(peer@4.5.6)"   -> the dependency itself at 1.2.3
//   "real-name@1.2.3"     -> npm alias, resolves to real-name
//   "link:../x"           -> local link, not a registry package
function resolveReference(name: string, ref: string): { name: string; version: string } | null {
  const withoutPeers = ref.split("(")[0];
  if (/^(link|file|workspace):/.test(withoutPeers)) return null;
  if (withoutPeers.lastIndexOf("@") > 0) return parsePackageKey(withoutPeers);
  return { name, version: withoutPeers };
}

// Same rules npm applies to the os, cpu, and libc fields of package.json:
// a "!value" entry excludes, plain entries restrict to the listed values.
export function installsOnThisPlatform(
  meta: PackageMeta,
  platform: string = process.platform,
  arch: string = process.arch,
  libc: string | null = platform === "linux" ? linuxLibc() : null,
): boolean {
  if (!matchesList(meta.os, platform)) return false;
  if (!matchesList(meta.cpu, arch)) return false;
  if (libc !== null && !matchesList(meta.libc, libc)) return false;
  return true;
}

function matchesList(list: string[] | undefined, value: string): boolean {
  if (!list || list.length === 0) return true;
  if (list.includes(`!${value}`)) return false;

  const allowed = list.filter((entry) => !entry.startsWith("!"));
  return allowed.length === 0 || allowed.includes(value);
}

// glibc reports its runtime version in the Node.js diagnostic report; musl does not
function linuxLibc(): "glibc" | "musl" {
  const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } };
  return report.header?.glibcVersionRuntime ? "glibc" : "musl";
}

// Package folders in node_modules/.pnpm. With a lockfile, entries it no longer
// references (left behind after dependency changes) are skipped.
export function listPnpmStoreEntries(
  pnpmPath: string,
  lockfile: PnpmLockfile | null,
): { dirName: string; name: string; version: string }[] {
  const entries: { dirName: string; name: string; version: string }[] = [];

  for (const entry of fs.readdirSync(pnpmPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const parsed = parsePnpmDirEntry(entry.name);
    if (!parsed) continue;
    if (lockfile && !lockfile.versions.get(parsed.name)?.has(parsed.version)) continue;

    entries.push({ dirName: entry.name, ...parsed });
  }

  return entries;
}

// Store folder names encode "/" as "+" and append peer suffixes after "_":
//   "@types+node@26.6.5" -> @types/node 26.6.5
//   "vite@8.3.4_@types+node@26.6.5" -> vite 8.3.4
export function parsePnpmDirEntry(dirName: string): { name: string; version: string } | null {
  const scoped = dirName.startsWith("@");
  const nameEnd = dirName.indexOf("@", scoped ? dirName.indexOf("+") + 1 : 1);
  if (nameEnd <= 0 || (scoped && dirName.indexOf("+") === -1)) return null;

  const name = scoped ? dirName.slice(0, nameEnd).replace("+", "/") : dirName.slice(0, nameEnd);

  const versionStart = nameEnd + 1;
  const peerStart = dirName.indexOf("_", versionStart);
  const version = dirName.slice(versionStart, peerStart === -1 ? undefined : peerStart);

  return semver.valid(version) ? { name, version } : null;
}

function addToSet<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
}
