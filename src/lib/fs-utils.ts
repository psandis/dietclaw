import fs from "node:fs";
import path from "node:path";

export interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

// Canonical absolute path for a project. Resolves symlinks (macOS /tmp is
// /private/tmp) and normalizes drive letter and casing on Windows, so the
// same project always maps to the same snapshot history.
export function resolveProjectPath(target: string): string {
  const absolute = path.resolve(target);
  if (!fs.existsSync(absolute)) throw new Error(`Path not found: ${absolute}`);
  return fs.realpathSync.native(absolute);
}

export function readPackageJson(dir: string): PackageJson | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"));
  } catch {
    return null;
  }
}

export function dirSize(dir: string): number {
  let size = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) size += dirSize(fullPath);
      else if (entry.isFile()) size += fs.statSync(fullPath).size;
    }
  } catch {
    /* skip inaccessible */
  }
  return size;
}

// All regular files under dir, skipping dotfiles, dot directories, and ignored
// directory names. Symlinks are not followed.
export function listFiles(dir: string, ignoreDirs: Set<string>): string[] {
  const results: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || ignoreDirs.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...listFiles(fullPath, ignoreDirs));
    else if (entry.isFile()) results.push(fullPath);
  }

  return results;
}
