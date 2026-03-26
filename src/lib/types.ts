// File categories for weight analysis
export type FileCategory =
  | "source"
  | "dependency"
  | "media"
  | "data"
  | "binary"
  | "generated"
  | "config"
  | "other";

export interface CategoryBreakdown {
  category: FileCategory;
  files: number;
  size: number;
}

export interface WeightReport {
  categories: CategoryBreakdown[];
  totalSize: number;
  sourceSize: number;
  sourceRatio: number;
  largeFiles: FileEntry[];
  duplicates: DuplicateGroup[];
}

export interface DuplicateGroup {
  size: number;
  paths: string[];
}

export interface ComplexityReport {
  longFiles: FileEntry[];
  configFiles: string[];
  npmScripts: number;
  transitiveDeps: number | null;
}

export interface DependencyInfo {
  count: number;
  devCount: number;
  totalSize: number | null;
  transitiveDeps: number | null;
}

export interface LanguageBreakdown {
  language: string;
  files: number;
  lines: number;
  size: number;
}

export interface ScanResult {
  path: string;
  totalFiles: number;
  totalLines: number;
  totalSize: number;
  weight: WeightReport;
  complexity: ComplexityReport;
  languages: LanguageBreakdown[];
  dependencies: DependencyInfo | null;
}

export interface FileEntry {
  path: string;
  size: number;
  lines: number;
}

export interface ScanOptions {
  path: string;
  limit?: number;
}

// Dependency analysis
export interface DepsResult {
  path: string;
  outdated: OutdatedPackage[];
  unused: UnusedPackage[];
  heaviest: HeavyPackage[];
  duplicates: DuplicatePackage[];
}

export interface UnusedPackage {
  name: string;
  version: string;
  size: number | null;
}

export interface OutdatedPackage {
  name: string;
  current: string;
  latest: string;
  type: "dep" | "dev";
}

export interface HeavyPackage {
  name: string;
  size: number;
}

export interface DuplicatePackage {
  name: string;
  entries: DuplicateEntry[];
}

export interface DuplicateEntry {
  version: string;
  requiredBy: string;
}

export interface DepsOptions {
  path: string;
  limit?: number;
}
