import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ParseError, parse, printParseErrorCode } from "jsonc-parser";

export interface Defaults {
  ignoreDirs: string[];
  largeFileThreshold: number;
  longFileThreshold: number;
  sourceExts: string[];
  moduleExts: string[];
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

export function parseDefaults(text: string, source: string): Defaults {
  const errors: ParseError[] = [];
  const parsed = parse(text, errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    const details = errors
      .map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`)
      .join(", ");
    throw new Error(`Invalid JSONC in ${source}: ${details}`);
  }

  return parsed as Defaults;
}

export function loadDefaults(): Defaults {
  const file = findDefaultsFile();
  return parseDefaults(fs.readFileSync(file, "utf-8"), file);
}

export const defaults = loadDefaults();
