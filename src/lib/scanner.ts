import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { defaults } from "./config.js";
import { dirSize, listFiles, readPackageJson, resolveProjectPath } from "./fs-utils.js";
import {
  LockfileError,
  listPnpmStoreEntries,
  type PnpmLockfile,
  readPnpmLockfile,
} from "./pnpm-lock.js";
import type {
  CategoryBreakdown,
  ComplexityReport,
  DependencyInfo,
  DuplicateGroup,
  FileCategory,
  FileEntry,
  LanguageBreakdown,
  ScanOptions,
  ScanResult,
  WeightReport,
} from "./types.js";

const IGNORE_DIRS = new Set(defaults.ignoreDirs);
const SOURCE_EXTS = new Set(defaults.sourceExts);
const MEDIA_EXTS = new Set(defaults.mediaExts);
const DATA_EXTS = new Set(defaults.dataExts);
const BINARY_EXTS = new Set(defaults.binaryExts);
const GENERATED_NAMES = new Set(defaults.generatedNames);
const GENERATED_EXTS = new Set(defaults.generatedExts);
const CONFIG_NAMES = new Set(defaults.configNames);
const LANGUAGE_MAP = defaults.languageMap;

export function scan(options: ScanOptions): ScanResult {
  const root = resolveProjectPath(options.path);
  const limit = options.limit || 10;
  const files = listFiles(root, IGNORE_DIRS);

  const languages = new Map<string, LanguageBreakdown>();
  const categories = new Map<FileCategory, CategoryBreakdown>();
  const hashes = new Map<string, string[]>();
  const largeFiles: FileEntry[] = [];
  const longFiles: FileEntry[] = [];
  const configFiles: string[] = [];

  let totalFiles = 0;
  let totalLines = 0;
  let totalSize = 0;
  let sourceSize = 0;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const basename = path.basename(file);
    const relative = toPosix(path.relative(root, file));
    const content = fs.readFileSync(file);
    const size = content.length;
    const lines = isBinary(content) ? 0 : countLines(content);
    const category = categorize(ext, basename);

    totalFiles++;
    totalLines += lines;
    totalSize += size;
    if (category === "source") sourceSize += size;

    tally(categories, category, { category, files: 0, size: 0 }, (c) => {
      c.files++;
      c.size += size;
    });

    const lang = LANGUAGE_MAP[ext];
    if (lang) {
      tally(languages, lang, { language: lang, files: 0, lines: 0, size: 0 }, (l) => {
        l.files++;
        l.lines += lines;
        l.size += size;
      });
    }

    if (size > 1024) {
      const hash = crypto.createHash("md5").update(content).digest("hex");
      const group = hashes.get(hash) || [];
      group.push(relative);
      hashes.set(hash, group);
    }

    if (size >= defaults.largeFileThreshold) largeFiles.push({ path: relative, size, lines });
    if (lines >= defaults.longFileThreshold && SOURCE_EXTS.has(ext))
      longFiles.push({ path: relative, size, lines });
    if (category === "config") configFiles.push(relative);
  }

  const duplicates: DuplicateGroup[] = [];
  for (const [, paths] of hashes) {
    if (paths.length > 1) {
      duplicates.push({ size: fs.statSync(path.join(root, paths[0])).size, paths });
    }
  }

  const dependencies = readDependencies(root);

  const weight: WeightReport = {
    categories: sorted(categories.values(), (a, b) => b.size - a.size),
    totalSize,
    sourceSize,
    sourceRatio: totalSize > 0 ? sourceSize / totalSize : 0,
    largeFiles: sorted(largeFiles, (a, b) => b.size - a.size).slice(0, limit),
    duplicates: sorted(
      duplicates,
      (a, b) => b.size * b.paths.length - a.size * a.paths.length,
    ).slice(0, limit),
  };

  const complexity: ComplexityReport = {
    longFiles: sorted(longFiles, (a, b) => b.lines - a.lines).slice(0, limit),
    configFiles,
    npmScripts: Object.keys(readPackageJson(root)?.scripts || {}).length,
    transitiveDeps: dependencies?.transitiveDeps ?? null,
  };

  return {
    path: root,
    totalFiles,
    totalLines,
    totalSize,
    weight,
    complexity,
    languages: sorted(languages.values(), (a, b) => b.lines - a.lines),
    dependencies,
  };
}

export function detectProjects(root: string): string[] {
  const markers = new Set(defaults.projectMarkers);
  const resolved = resolveProjectPath(root);
  const projects: string[] = [];

  for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || IGNORE_DIRS.has(entry.name)) continue;

    const subdir = path.join(resolved, entry.name);
    if (fs.readdirSync(subdir).some((f) => markers.has(f))) {
      projects.push(subdir);
    }
  }

  return projects.sort();
}

export function scanEach(options: ScanOptions): ScanResult[] {
  return detectProjects(options.path).map((p) => scan({ ...options, path: p }));
}

// --- Helpers ---

function tally<K, V>(map: Map<K, V>, key: K, init: V, update: (v: V) => void): void {
  const value = map.get(key) || { ...init };
  update(value);
  map.set(key, value);
}

function sorted<T>(items: Iterable<T>, compare: (a: T, b: T) => number): T[] {
  return [...items].sort(compare);
}

function categorize(ext: string, basename: string): FileCategory {
  if (CONFIG_NAMES.has(basename)) return "config";
  if (GENERATED_NAMES.has(basename)) return "generated";
  if (GENERATED_EXTS.has(ext)) return "generated";
  if (SOURCE_EXTS.has(ext)) return "source";
  if (MEDIA_EXTS.has(ext)) return "media";
  if (DATA_EXTS.has(ext)) return "data";
  if (BINARY_EXTS.has(ext)) return "binary";
  if (ext === ".md") return "other";
  if ([".json", ".yaml", ".yml", ".toml", ".xml"].includes(ext)) return "config";
  return "other";
}

// Same heuristic as git: a NUL byte in the first 8 KB means binary
function isBinary(content: Buffer): boolean {
  return content.subarray(0, 8000).includes(0);
}

// A trailing newline ends the last line, it does not start a new one
function countLines(content: Buffer): number {
  if (content.length === 0) return 0;

  let lines = 0;
  for (const byte of content) {
    if (byte === 0x0a) lines++;
  }
  return content[content.length - 1] === 0x0a ? lines : lines + 1;
}

// Report paths with forward slashes on every platform
function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function readDependencies(root: string): DependencyInfo | null {
  const pkg = readPackageJson(root);
  if (!pkg) return null;

  const count = Object.keys(pkg.dependencies || {}).length;
  const devCount = Object.keys(pkg.devDependencies || {}).length;
  const nmPath = path.join(root, "node_modules");
  const hasNodeModules = fs.existsSync(nmPath);

  return {
    count,
    devCount,
    totalSize: hasNodeModules ? dirSize(nmPath) : null,
    transitiveDeps: hasNodeModules ? countTransitiveDeps(root, nmPath) : null,
  };
}

// scan only uses the lockfile to filter its package count; an unreadable
// lockfile is reported by `deps`, and scan falls back to counting the store
function readLockfileIfValid(root: string): PnpmLockfile | null {
  try {
    return readPnpmLockfile(root);
  } catch (err) {
    if (err instanceof LockfileError) return null;
    throw err;
  }
}

// Distinct installed packages (name@version). For pnpm, peer variants of the
// same version count once, and store entries the lockfile no longer
// references are skipped, matching what `deps` reports.
function countTransitiveDeps(root: string, nmPath: string): number {
  const pnpmPath = path.join(nmPath, ".pnpm");

  if (fs.existsSync(pnpmPath)) {
    const entries = listPnpmStoreEntries(pnpmPath, readLockfileIfValid(root));
    return new Set(entries.map((e) => `${e.name}@${e.version}`)).size;
  }

  let count = 0;
  for (const entry of fs.readdirSync(nmPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@")) {
      count += fs
        .readdirSync(path.join(nmPath, entry.name), { withFileTypes: true })
        .filter((e) => e.isDirectory()).length;
    } else {
      count++;
    }
  }
  return count;
}
