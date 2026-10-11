import { createRequire } from "node:module";
import { Command, InvalidArgumentError } from "commander";
import { closeDb, getSnapshots, type SnapshotRow, saveSnapshot } from "./lib/db.js";
import { analyzeDeps } from "./lib/deps.js";
import { formatDeps, formatEach, formatScan, formatTrend } from "./lib/format.js";
import { resolveProjectPath } from "./lib/fs-utils.js";
import { scan, scanEach } from "./lib/scanner.js";

// package.json sits one level above both src/cli.ts and the built dist/cli.js
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

function parseLimit(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new InvalidArgumentError("Must be a positive integer.");
  }
  return n;
}

const program = new Command();

program
  .name("dietclaw")
  .description("Codebase health monitor. Find out why your project is getting fat.")
  .version(version)
  .option("--json", "Output as JSON");

program
  .command("scan")
  .description("Quick health report for a project")
  .argument("[path]", "Project directory to scan", ".")
  .option("--limit <n>", "Max large files to show", parseLimit, 10)
  .option("--each", "Detect and compare subprojects")
  .option("--save", "Save snapshot for trend tracking")
  .action((targetPath: string, opts: { limit: number; each?: boolean; save?: boolean }) => {
    const results = opts.each
      ? scanEach({ path: targetPath, limit: opts.limit })
      : [scan({ path: targetPath, limit: opts.limit })];

    if (opts.save) {
      try {
        for (const result of results) saveSnapshot(result);
      } finally {
        closeDb();
      }
    }

    if (program.opts().json) {
      console.log(JSON.stringify(opts.each ? results : results[0], null, 2));
      return;
    }

    console.log(opts.each ? formatEach(results) : formatScan(results[0]));
    if (opts.save) {
      console.log(
        `  ${results.length === 1 ? "Snapshot" : `${results.length} snapshots`} saved.\n`,
      );
    }
  });

program
  .command("deps")
  .description("Dependency analysis: outdated, unused, heavy, duplicates")
  .argument("[path]", "Project directory to analyze", ".")
  .option("--limit <n>", "Max items per section", parseLimit, 20)
  .action((targetPath: string, opts: { limit: number }) => {
    const result = analyzeDeps({ path: targetPath, limit: opts.limit });

    if (program.opts().json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatDeps(result));
    }
  });

program
  .command("trend")
  .description("Show project health over time")
  .argument("[path]", "Project directory", ".")
  .option("--limit <n>", "Max snapshots to show", parseLimit, 20)
  .action((targetPath: string, opts: { limit: number }) => {
    const project = resolveProjectPath(targetPath);

    let snapshots: SnapshotRow[];
    try {
      snapshots = getSnapshots(project, opts.limit);
    } finally {
      closeDb();
    }

    if (program.opts().json) {
      console.log(JSON.stringify(snapshots, null, 2));
    } else {
      console.log(formatTrend(project, snapshots));
    }
  });

export function runCli(argv: string[] = process.argv) {
  try {
    program.parse(argv);
  } catch (err) {
    // Expected failures (missing path, unreadable directory) get a one-line
    // message instead of a stack trace
    program.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

runCli();
