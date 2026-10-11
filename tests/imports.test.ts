import { describe, expect, it } from "vitest";
import { collectModuleSpecifiers, packageNameOf } from "../src/lib/imports.js";

const specifiers = (source: string, filename = "file.ts") => [
  ...collectModuleSpecifiers(filename, source),
];

describe("collectModuleSpecifiers", () => {
  it("collects import statements", () => {
    expect(specifiers("import chalk from \"chalk\";\nimport { a } from 'b';")).toEqual([
      "chalk",
      "b",
    ]);
  });

  it("collects side-effect imports", () => {
    expect(specifiers('import "dotenv/config";')).toEqual(["dotenv/config"]);
  });

  it("collects type-only imports", () => {
    expect(specifiers('import type { Options } from "lib";')).toEqual(["lib"]);
  });

  it("collects re-exports", () => {
    expect(
      specifiers('export { a } from "x";\nexport * from "y";\nexport * as z from "z";'),
    ).toEqual(["x", "y", "z"]);
  });

  it("does not treat local exports as imports", () => {
    expect(specifiers("const a = 1;\nexport { a };")).toEqual([]);
  });

  it("collects dynamic imports with static strings", () => {
    expect(specifiers('const m = await import("lazy");')).toEqual(["lazy"]);
    expect(specifiers("const m = await import(`tpl`);")).toEqual(["tpl"]);
  });

  it("collects require calls with static strings", () => {
    expect(specifiers('const fs = require("fs-extra");', "file.cjs")).toEqual(["fs-extra"]);
  });

  it("collects TypeScript import-equals declarations", () => {
    expect(specifiers('import legacy = require("legacy");')).toEqual(["legacy"]);
  });

  it("ignores specifiers that are not static strings", () => {
    expect(specifiers(`const m = require(name);\nawait import(\`./\${x}\`);`)).toEqual([]);
  });

  it("ignores import-like text in strings and comments", () => {
    const source = '// import "commented"\nconst s = "require(\\"in-string\\")";';
    expect(specifiers(source)).toEqual([]);
  });

  it("parses JSX and TSX", () => {
    expect(specifiers('import React from "react";\nconst el = <div />;', "file.tsx")).toEqual([
      "react",
    ]);
  });
});

describe("packageNameOf", () => {
  it("returns bare package names", () => {
    expect(packageNameOf("chalk")).toBe("chalk");
  });

  it("strips subpaths", () => {
    expect(packageNameOf("lodash/get")).toBe("lodash");
    expect(packageNameOf("@scope/pkg/sub/path")).toBe("@scope/pkg");
  });

  it("keeps scoped names", () => {
    expect(packageNameOf("@types/node")).toBe("@types/node");
  });

  it("rejects relative and absolute paths", () => {
    expect(packageNameOf("./local")).toBeNull();
    expect(packageNameOf("../up")).toBeNull();
    expect(packageNameOf("/abs/path")).toBeNull();
  });

  it("rejects package subpath imports", () => {
    expect(packageNameOf("#internal")).toBeNull();
  });

  it("rejects protocols, URLs, and Windows paths", () => {
    expect(packageNameOf("node:fs")).toBeNull();
    expect(packageNameOf("https://example.com/x.js")).toBeNull();
    expect(packageNameOf("C:\\x.js")).toBeNull();
  });

  it("rejects Node.js built-ins without the node: prefix", () => {
    expect(packageNameOf("fs")).toBeNull();
    expect(packageNameOf("path")).toBeNull();
  });

  it("rejects an incomplete scoped name", () => {
    expect(packageNameOf("@scope")).toBeNull();
  });
});
