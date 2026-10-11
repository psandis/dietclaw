import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installsOnThisPlatform,
  LockfileError,
  listPnpmStoreEntries,
  parsePackageKey,
  parsePnpmDirEntry,
  parsePnpmLockfile,
} from "../src/lib/pnpm-lock.js";

// Shape written by pnpm 12: a document pinning pnpm itself, then the project
const LOCKFILE = `---
lockfileVersion: '9.0'

importers:

  .:
    configDependencies: {}
    packageManagerDependencies:
      pnpm:
        specifier: 12.11.2
        version: 12.11.2

packages:

  pnpm@12.11.2:
    resolution: {integrity: sha512-x}

snapshots:

  pnpm@12.11.2: {}

---
lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      commander:
        specifier: ^15.0.0
        version: 15.0.0
      string-width-cjs:
        specifier: npm:string-width@^4.2.3
        version: string-width@4.2.3
    devDependencies:
      vitest:
        specifier: ^5.0.3
        version: 5.0.3(@types/node@26.6.5)

packages:

  commander@15.0.0:
    resolution: {integrity: sha512-a}

  commander@4.1.1:
    resolution: {integrity: sha512-b}

  string-width@4.2.3:
    resolution: {integrity: sha512-c}

  sucrase@3.35.0:
    resolution: {integrity: sha512-d}

  vitest@5.0.3:
    resolution: {integrity: sha512-e}

  '@esbuild/darwin-arm64@0.28.2':
    resolution: {integrity: sha512-f}
    cpu: [arm64]
    os: [darwin]

  '@esbuild/win32-x64@0.28.2':
    resolution: {integrity: sha512-g}
    cpu: [x64]
    os: [win32]

snapshots:

  commander@15.0.0: {}

  commander@4.1.1: {}

  string-width@4.2.3: {}

  sucrase@3.35.0:
    dependencies:
      commander: 4.1.1

  vitest@5.0.3(@types/node@26.6.5):
    dependencies:
      commander: 15.0.0
    optionalDependencies:
      '@esbuild/darwin-arm64': 0.28.2
`;

describe("parsePnpmLockfile", () => {
  const lockfile = parsePnpmLockfile(LOCKFILE);

  it("reads the project document, not the package manager document", () => {
    expect(lockfile.versions.has("pnpm")).toBe(false);
    expect(lockfile.versions.get("commander")).toEqual(new Set(["15.0.0", "4.1.1"]));
  });

  it("records which packages depend on each version", () => {
    expect(lockfile.dependents.get("commander@4.1.1")).toEqual(new Set(["sucrase"]));
    expect(lockfile.dependents.get("commander@15.0.0")).toEqual(new Set(["vitest"]));
  });

  it("includes optional dependencies as dependents", () => {
    expect(lockfile.dependents.get("@esbuild/darwin-arm64@0.28.2")).toEqual(new Set(["vitest"]));
  });

  it("records direct dependency versions without peer suffixes", () => {
    expect(lockfile.direct.get("commander")).toBe("15.0.0");
    expect(lockfile.direct.get("vitest")).toBe("5.0.3");
  });

  it("resolves npm aliases to the real package", () => {
    expect(lockfile.direct.get("string-width")).toBe("4.2.3");
    expect(lockfile.direct.has("string-width-cjs")).toBe(false);
  });

  it("returns an empty lockfile when no document declares dependencies", () => {
    const empty = parsePnpmLockfile("lockfileVersion: '9.0'\nimporters:\n  .: {}\n");
    expect(empty.versions.size).toBe(0);
  });

  it("rejects unsupported lockfile versions", () => {
    const old = "lockfileVersion: '6.0'\nimporters:\n  .:\n    dependencies: {}\n";
    expect(() => parsePnpmLockfile(old)).toThrow(LockfileError);
    expect(() => parsePnpmLockfile(old)).toThrow(/version 6\.0/);
  });

  it("rejects invalid YAML", () => {
    expect(() => parsePnpmLockfile("importers: [unclosed")).toThrow(LockfileError);
  });
});

describe("parsePackageKey", () => {
  it("parses unscoped and scoped keys", () => {
    expect(parsePackageKey("chalk@6.0.1")).toEqual({ name: "chalk", version: "6.0.1" });
    expect(parsePackageKey("@types/node@26.6.5")).toEqual({
      name: "@types/node",
      version: "26.6.5",
    });
  });

  it("strips peer dependency suffixes", () => {
    expect(parsePackageKey("vite@8.3.4(@types/node@26.6.5)(tsx@4.23.15)")).toEqual({
      name: "vite",
      version: "8.3.4",
    });
  });

  it("rejects keys without a version", () => {
    expect(parsePackageKey("chalk")).toBeNull();
    expect(parsePackageKey("@scope/pkg")).toBeNull();
  });
});

describe("parsePnpmDirEntry", () => {
  it("parses unscoped packages", () => {
    expect(parsePnpmDirEntry("chalk@5.6.2")).toEqual({ name: "chalk", version: "5.6.2" });
  });

  it("parses scoped packages", () => {
    expect(parsePnpmDirEntry("@types+node@26.6.5")).toEqual({
      name: "@types/node",
      version: "26.6.5",
    });
  });

  it("strips peer dependency suffixes", () => {
    expect(parsePnpmDirEntry("vitest@5.0.3_@types+node@26.6.5")).toEqual({
      name: "vitest",
      version: "5.0.3",
    });
    expect(parsePnpmDirEntry("@vitest+mocker@5.0.3_vite@8.3.4")).toEqual({
      name: "@vitest/mocker",
      version: "5.0.3",
    });
  });

  it("keeps prerelease versions", () => {
    expect(parsePnpmDirEntry("pkg@2.0.0-beta.1")).toEqual({ name: "pkg", version: "2.0.0-beta.1" });
  });

  it("rejects entries without a valid version", () => {
    expect(parsePnpmDirEntry("node_modules")).toBeNull();
    expect(parsePnpmDirEntry("lock.yaml")).toBeNull();
    expect(parsePnpmDirEntry("@scope@1.0.0")).toBeNull();
    expect(parsePnpmDirEntry("pkg@latest")).toBeNull();
  });
});

describe("listPnpmStoreEntries", () => {
  let store: string;

  beforeEach(() => {
    store = fs.mkdtempSync(path.join(os.tmpdir(), "dietclaw-store-test-"));
    for (const dir of [
      "chalk@6.0.1",
      "chalk@5.0.0",
      "vite@8.3.4_tsx@4.23.15",
      ".modules.yaml-dir",
    ]) {
      fs.mkdirSync(path.join(store, dir));
    }
    fs.writeFileSync(path.join(store, "lock.yaml"), "");
  });

  afterEach(() => {
    fs.rmSync(store, { recursive: true, force: true });
  });

  const names = (entries: { name: string; version: string }[]) =>
    entries.map((e) => `${e.name}@${e.version}`).sort();

  it("lists every package folder when there is no lockfile", () => {
    expect(names(listPnpmStoreEntries(store, null))).toEqual([
      "chalk@5.0.0",
      "chalk@6.0.1",
      "vite@8.3.4",
    ]);
  });

  it("skips folders the lockfile no longer references", () => {
    const lockfile = {
      versions: new Map([
        ["chalk", new Set(["6.0.1"])],
        ["vite", new Set(["8.3.4"])],
      ]),
      dependents: new Map(),
      direct: new Map(),
    };

    expect(names(listPnpmStoreEntries(store, lockfile))).toEqual(["chalk@6.0.1", "vite@8.3.4"]);
  });
});

describe("installsOnThisPlatform", () => {
  it("accepts packages without platform restrictions", () => {
    expect(installsOnThisPlatform({}, "win32", "x64", null)).toBe(true);
  });

  it("matches os and cpu allow lists", () => {
    const meta = { os: ["darwin"], cpu: ["arm64"] };
    expect(installsOnThisPlatform(meta, "darwin", "arm64", null)).toBe(true);
    expect(installsOnThisPlatform(meta, "win32", "arm64", null)).toBe(false);
    expect(installsOnThisPlatform(meta, "darwin", "x64", null)).toBe(false);
  });

  it("honors negated entries", () => {
    expect(installsOnThisPlatform({ os: ["!win32"] }, "win32", "x64", null)).toBe(false);
    expect(installsOnThisPlatform({ os: ["!win32"] }, "linux", "x64", "glibc")).toBe(true);
  });

  it("checks libc on Linux only", () => {
    const musl = { os: ["linux"], libc: ["musl"] };
    expect(installsOnThisPlatform(musl, "linux", "x64", "glibc")).toBe(false);
    expect(installsOnThisPlatform(musl, "linux", "x64", "musl")).toBe(true);
    expect(installsOnThisPlatform({ libc: ["musl"] }, "darwin", "arm64", null)).toBe(true);
  });
});
