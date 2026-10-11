import { describe, expect, it } from "vitest";
import { defaults, parseDefaults } from "../src/lib/config.js";

describe("parseDefaults", () => {
  it("strips line and block comments", () => {
    const text = `{
      // line comment
      "largeFileThreshold": 100, /* block comment */
      "longFileThreshold": 10
    }`;

    const parsed = parseDefaults(text, "test.jsonc");

    expect(parsed.largeFileThreshold).toBe(100);
    expect(parsed.longFileThreshold).toBe(10);
  });

  it("keeps // inside string values", () => {
    const text = `{ "projectMarkers": ["https://example.com"] // trailing comment
    }`;

    expect(parseDefaults(text, "test.jsonc").projectMarkers).toEqual(["https://example.com"]);
  });

  it("allows trailing commas", () => {
    expect(parseDefaults(`{ "ignoreDirs": ["dist",], }`, "test.jsonc").ignoreDirs).toEqual([
      "dist",
    ]);
  });

  it("throws with the file name on invalid input", () => {
    expect(() => parseDefaults(`{ "ignoreDirs": [ }`, "broken.jsonc")).toThrow(/broken\.jsonc/);
  });
});

describe("defaults", () => {
  it("loads the bundled defaults file", () => {
    expect(defaults.ignoreDirs).toContain("node_modules");
    expect(defaults.largeFileThreshold).toBeGreaterThan(0);
  });
});
