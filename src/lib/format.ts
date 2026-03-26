import path from "node:path";
import chalk from "chalk";
import { renderTable } from "./table.js";
import type { DepsResult, ScanResult } from "./types.js";

const CATEGORY_LABELS: Record<string, string> = {
  source: "Source code",
  media: "Assets",
  dependency: "Dependencies",
  generated: "Generated files",
  config: "Configuration",
  data: "Data files",
  binary: "Binaries",
  other: "Other files",
};

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function formatScan(result: ScanResult): string {
  const lines: string[] = [];
  const w = result.weight;
  const c = result.complexity;

  lines.push("");
  lines.push(chalk.bold("  Project Health Report"));
  lines.push(chalk.gray(`  ${result.path}`));
  lines.push("");

  // Weight overview
  lines.push(chalk.bold("  Weight"));
  lines.push(`    Total        ${formatSize(w.totalSize)}`);
  lines.push(`    Source code  ${formatSize(w.sourceSize)}  (${formatPct(w.sourceRatio)})`);
  lines.push("");

  // Category breakdown
  lines.push(chalk.bold("  Breakdown"));
  lines.push("");
  const breakdownRows = w.categories.map((cat) => [
    CATEGORY_LABELS[cat.category] || cat.category,
    formatSize(cat.size),
    `${cat.files}`,
    w.totalSize > 0 ? formatPct(cat.size / w.totalSize) : "0%",
  ]);
  lines.push(renderTable(["Category", "Size", "Files", "Share"], breakdownRows));
  lines.push("");

  // Dependencies
  if (result.dependencies) {
    const d = result.dependencies;
    lines.push(chalk.bold("  Dependencies"));
    lines.push(`    Direct       ${d.count} production + ${d.devCount} development`);
    if (d.transitiveDeps !== null) {
      lines.push(
        `    Installed    ${formatNumber(d.transitiveDeps)} packages (${d.totalSize !== null ? formatSize(d.totalSize) : "unknown size"})`,
      );
    }
    lines.push("");
  }

  // Languages
  if (result.languages.length > 0) {
    lines.push(chalk.bold("  Languages"));
    lines.push("");
    const langRows = result.languages
      .slice(0, 10)
      .map((lang) => [
        lang.language,
        formatNumber(lang.lines),
        `${lang.files}`,
        result.totalLines > 0 ? formatPct(lang.lines / result.totalLines) : "0%",
      ]);
    lines.push(renderTable(["Language", "Lines", "Files", "Share"], langRows));
    lines.push("");
  }

  // Complexity
  const hasComplexity = c.configFiles.length > 5 || c.npmScripts > 10;
  if (hasComplexity) {
    lines.push(chalk.bold("  Complexity"));
    if (c.configFiles.length > 0) {
      lines.push(`    Config files  ${c.configFiles.length}`);
    }
    if (c.npmScripts > 0) {
      lines.push(`    npm scripts   ${c.npmScripts}`);
    }
    lines.push("");
  }

  // Long files
  if (c.longFiles.length > 0) {
    lines.push(chalk.bold.yellow(`  Long Files (${c.longFiles.length})`));
    lines.push(chalk.gray("  Source files exceeding the line threshold"));
    lines.push("");
    const longRows = c.longFiles.slice(0, 10).map((f) => [f.path, formatNumber(f.lines)]);
    lines.push(renderTable(["File", "Lines"], longRows));
    lines.push("");
  }

  // Large files
  if (w.largeFiles.length > 0) {
    lines.push(chalk.bold.yellow(`  Large Files (${w.largeFiles.length})`));
    lines.push(chalk.gray("  Files exceeding the size threshold"));
    lines.push("");
    const largeRows = w.largeFiles.map((f) => [f.path, formatSize(f.size)]);
    lines.push(renderTable(["File", "Size"], largeRows));
    lines.push("");
  }

  // Duplicates
  if (w.duplicates.length > 0) {
    lines.push(chalk.bold.yellow(`  Duplicate Files (${w.duplicates.length})`));
    lines.push(chalk.gray("  Identical files found in multiple locations"));
    lines.push("");
    const dupRows = w.duplicates
      .slice(0, 5)
      .map((dup) => [dup.paths[0], formatSize(dup.size), `${dup.paths.length}`]);
    lines.push(renderTable(["File", "Size", "Copies"], dupRows));
    lines.push("");
  }

  return lines.join("\n");
}

export function formatEach(results: ScanResult[]): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(chalk.bold("  Project Comparison"));
  lines.push("");

  const headers = ["Project", "Source code", "Assets", "Dependencies"];
  const rows = results.map((r) => {
    const mediaCat = r.weight.categories.find((c) => c.category === "media");
    return [
      chalk.bold(path.basename(r.path)),
      formatSize(r.weight.sourceSize),
      mediaCat ? formatSize(mediaCat.size) : "—",
      r.dependencies?.totalSize ? formatSize(r.dependencies.totalSize) : "—",
    ];
  });

  lines.push(renderTable(headers, rows));
  lines.push("");

  return lines.join("\n");
}

export function formatDeps(result: DepsResult): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(chalk.bold("  Dependency Analysis"));
  lines.push(chalk.gray(`  ${result.path}`));
  lines.push("");

  // Outdated
  if (result.outdated.length > 0) {
    lines.push(chalk.bold.yellow(`  Outdated Packages (${result.outdated.length})`));
    lines.push("");
    const outdatedRows = result.outdated.map((pkg) => {
      const [curMajor, curMinor] = pkg.current.split(".");
      const [latMajor, latMinor] = pkg.latest.split(".");
      let level: string;
      let colorFn: typeof chalk.red;

      if (curMajor !== latMajor) {
        level = "major";
        colorFn = chalk.red;
      } else if (curMinor !== latMinor) {
        level = "minor";
        colorFn = chalk.yellow;
      } else {
        level = "patch";
        colorFn = chalk.green;
      }

      return [pkg.name, pkg.current, colorFn(pkg.latest), colorFn(level)];
    });
    lines.push(renderTable(["Package", "Current", "Latest", "Update"], outdatedRows));
    lines.push("");
  } else {
    lines.push(chalk.bold("  Outdated Packages"));
    lines.push(`  ${chalk.green("All packages are up to date")}`);
    lines.push("");
  }

  // Unused
  if (result.unused.length > 0) {
    lines.push(chalk.bold.yellow(`  Unused Dependencies (${result.unused.length})`));
    lines.push(chalk.gray("  In package.json but no direct import found in source"));
    lines.push("");
    const unusedRows = result.unused.map((pkg) => [
      chalk.yellow(pkg.name),
      pkg.version,
      pkg.size !== null ? formatSize(pkg.size) : "—",
    ]);
    lines.push(renderTable(["Package", "Version", "Size"], unusedRows));
    lines.push("");
  } else {
    lines.push(chalk.bold("  Unused Dependencies"));
    lines.push(`  ${chalk.green("All dependencies are imported")}`);
    lines.push("");
  }

  // Heaviest
  if (result.heaviest.length > 0) {
    lines.push(chalk.bold(`  Heaviest Packages (top ${result.heaviest.length})`));
    lines.push("");
    const heavyRows = result.heaviest.map((pkg) => [pkg.name, formatSize(pkg.size)]);
    lines.push(renderTable(["Package", "Size"], heavyRows));
    lines.push("");
  }

  // Duplicates
  if (result.duplicates.length > 0) {
    lines.push(chalk.bold.yellow(`  Version Conflicts (${result.duplicates.length})`));
    lines.push(
      chalk.gray("  These packages exist multiple times in your project at different versions."),
    );
    lines.push(
      chalk.gray(
        "  This happens when your dependencies each require a different version of the same package.",
      ),
    );
    lines.push("");

    const dupRows: string[][] = [];
    for (const dup of result.duplicates.slice(0, 10)) {
      for (const entry of dup.entries) {
        dupRows.push([dup.name, entry.version, entry.requiredBy]);
      }
    }
    lines.push(renderTable(["Package", "Installed version", "Needed by"], dupRows));

    if (result.duplicates.length > 10) {
      lines.push(
        chalk.gray(`  ...and ${result.duplicates.length - 10} more (use --json for full list)`),
      );
    }

    lines.push("");
  }

  return lines.join("\n");
}
