import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectProjects, scan, scanEach } from "../src/lib/scanner.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dietclaw-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relativePath: string, content: string) {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

describe("scan", () => {
  it("counts files and lines", () => {
    writeFile("src/index.ts", "const x = 1;\nconst y = 2;\n");
    writeFile("src/util.ts", "export function hello() {}\n");

    const result = scan({ path: tmpDir });

    expect(result.totalFiles).toBe(2);
    expect(result.totalLines).toBeGreaterThan(0);
    expect(result.totalSize).toBeGreaterThan(0);
  });

  it("categorizes source files", () => {
    writeFile("app.ts", "console.log('hi');\n");

    const result = scan({ path: tmpDir });
    const source = result.weight.categories.find((c) => c.category === "source");

    expect(source).toBeDefined();
    expect(source?.files).toBe(1);
  });

  it("categorizes media files", () => {
    writeFile("logo.png", "fake-png-data");

    const result = scan({ path: tmpDir });
    const media = result.weight.categories.find((c) => c.category === "media");

    expect(media).toBeDefined();
    expect(media?.files).toBe(1);
  });

  it("categorizes generated files", () => {
    writeFile("pnpm-lock.yaml", "lockfile: true\n");

    const result = scan({ path: tmpDir });
    const generated = result.weight.categories.find((c) => c.category === "generated");

    expect(generated).toBeDefined();
    expect(generated?.files).toBe(1);
  });

  it("categorizes config files", () => {
    writeFile("tsconfig.json", "{}");
    writeFile("biome.json", "{}");

    const result = scan({ path: tmpDir });
    const config = result.weight.categories.find((c) => c.category === "config");

    expect(config).toBeDefined();
    expect(config?.files).toBe(2);
  });

  it("calculates source ratio", () => {
    writeFile("app.ts", "x".repeat(100));
    writeFile("logo.png", "x".repeat(900));

    const result = scan({ path: tmpDir });

    expect(result.weight.sourceRatio).toBeGreaterThan(0);
    expect(result.weight.sourceRatio).toBeLessThan(0.5);
  });

  it("detects large files", () => {
    writeFile("big.png", "x".repeat(600 * 1024));

    const result = scan({ path: tmpDir });

    expect(result.weight.largeFiles.length).toBe(1);
    expect(result.weight.largeFiles[0].path).toBe("big.png");
  });

  it("does not flag small files as large", () => {
    writeFile("small.ts", "const x = 1;\n");

    const result = scan({ path: tmpDir });

    expect(result.weight.largeFiles.length).toBe(0);
  });

  it("detects duplicate files", () => {
    const content = "x".repeat(2048);
    writeFile("a/file.ts", content);
    writeFile("b/file.ts", content);

    const result = scan({ path: tmpDir });

    expect(result.weight.duplicates.length).toBe(1);
    expect(result.weight.duplicates[0].paths.length).toBe(2);
  });

  it("detects long source files", () => {
    const lines = Array.from({ length: 400 }, (_, i) => `const x${i} = ${i};`).join("\n");
    writeFile("big.ts", lines);

    const result = scan({ path: tmpDir });

    expect(result.complexity.longFiles.length).toBe(1);
    expect(result.complexity.longFiles[0].path).toBe("big.ts");
  });

  it("ignores node_modules", () => {
    writeFile("src/app.ts", "code\n");
    writeFile("node_modules/pkg/index.js", "module code\n");

    const result = scan({ path: tmpDir });

    expect(result.totalFiles).toBe(1);
  });

  it("ignores dotfiles and dot directories", () => {
    writeFile("src/app.ts", "code\n");
    writeFile(".hidden/secret.ts", "hidden\n");
    writeFile(".env", "SECRET=x\n");

    const result = scan({ path: tmpDir });

    expect(result.totalFiles).toBe(1);
  });

  it("reads language breakdown", () => {
    writeFile("app.ts", "const x = 1;\n");
    writeFile("style.css", "body { color: red; }\n");

    const result = scan({ path: tmpDir });
    const ts = result.languages.find((l) => l.language === "TypeScript");
    const css = result.languages.find((l) => l.language === "CSS");

    expect(ts).toBeDefined();
    expect(css).toBeDefined();
  });

  it("reads dependency info from package.json", () => {
    writeFile(
      "package.json",
      JSON.stringify({
        dependencies: { chalk: "^5.0.0", commander: "^13.0.0" },
        devDependencies: { vitest: "^3.0.0" },
      }),
    );

    const result = scan({ path: tmpDir });

    expect(result.dependencies).toBeDefined();
    expect(result.dependencies?.count).toBe(2);
    expect(result.dependencies?.devCount).toBe(1);
  });

  it("returns null dependencies when no package.json", () => {
    writeFile("app.ts", "code\n");

    const result = scan({ path: tmpDir });

    expect(result.dependencies).toBeNull();
  });

  it("reads npm script count", () => {
    writeFile(
      "package.json",
      JSON.stringify({
        scripts: { build: "tsup", test: "vitest", lint: "biome check" },
      }),
    );

    const result = scan({ path: tmpDir });

    expect(result.complexity.npmScripts).toBe(3);
  });

  it("respects limit option", () => {
    for (let i = 0; i < 5; i++) {
      writeFile(`big${i}.png`, "x".repeat(600 * 1024));
    }

    const result = scan({ path: tmpDir, limit: 2 });

    expect(result.weight.largeFiles.length).toBe(2);
  });
});

describe("detectProjects", () => {
  it("detects subdirectories with package.json", () => {
    writeFile("project-a/package.json", "{}");
    writeFile("project-b/package.json", "{}");
    writeFile("not-a-project/readme.md", "hi");

    const projects = detectProjects(tmpDir);

    expect(projects.length).toBe(2);
    expect(projects.map((p) => path.basename(p))).toContain("project-a");
    expect(projects.map((p) => path.basename(p))).toContain("project-b");
  });

  it("detects Cargo.toml projects", () => {
    writeFile("rust-app/Cargo.toml", "[package]");

    const projects = detectProjects(tmpDir);

    expect(projects.length).toBe(1);
    expect(path.basename(projects[0])).toBe("rust-app");
  });

  it("detects go.mod projects", () => {
    writeFile("go-service/go.mod", "module example.com/app");

    const projects = detectProjects(tmpDir);

    expect(projects.length).toBe(1);
  });

  it("ignores hidden directories", () => {
    writeFile(".hidden/package.json", "{}");

    const projects = detectProjects(tmpDir);

    expect(projects.length).toBe(0);
  });

  it("ignores node_modules", () => {
    writeFile("node_modules/pkg/package.json", "{}");

    const projects = detectProjects(tmpDir);

    expect(projects.length).toBe(0);
  });
});

describe("scanEach", () => {
  it("returns results for each detected project", () => {
    writeFile("app-a/package.json", JSON.stringify({ dependencies: {} }));
    writeFile("app-a/src/index.ts", "console.log('a');\n");
    writeFile("app-b/package.json", JSON.stringify({ dependencies: {} }));
    writeFile("app-b/src/index.ts", "console.log('b');\n");

    const results = scanEach({ path: tmpDir });

    expect(results.length).toBe(2);
    expect(results[0].totalFiles).toBeGreaterThan(0);
    expect(results[1].totalFiles).toBeGreaterThan(0);
  });
});
