import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Defaults {
  ignoreDirs: string[];
  largeFileThreshold: number;
  longFileThreshold: number;
  sourceExts: string[];
  mediaExts: string[];
  dataExts: string[];
  binaryExts: string[];
  generatedNames: string[];
  generatedExts: string[];
  configNames: string[];
  languageMap: Record<string, string>;
  projectMarkers: string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function stripJsoncComments(text: string): string {
  return text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function findDefaultsFile(): string {
  const candidates = [
    path.resolve(__dirname, "..", "..", "data", "defaults.jsonc"),
    path.resolve(__dirname, "..", "data", "defaults.jsonc"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error("Could not find data/defaults.jsonc");
}

export function loadDefaults(): Defaults {
  const raw = fs.readFileSync(findDefaultsFile(), "utf-8");
  return JSON.parse(stripJsoncComments(raw));
}

export const defaults = loadDefaults();
