import path from "node:path";
import { Command } from "commander";
import { closeDb, getSnapshots, saveSnapshot } from "./lib/db.js";
import { analyzeDeps } from "./lib/deps.js";
import { formatDeps, formatEach, formatScan, formatTrend } from "./lib/format.js";
import { scan, scanEach } from "./lib/scanner.js";

const program = new Command();

program
  .name("dietclaw")
  .description("Codebase health monitor. Find out why your project is getting fat.")
  .version("0.2.0")
  .option("--json", "Output as JSON");

program
  .command("scan")
  .description("Quick health report for a project")
  .argument("[path]", "Project directory to scan", ".")
  .option("--limit <n>", "Max large files to show", "10")
  .option("--each", "Detect and compare subprojects")
  .option("--save", "Save snapshot for trend tracking")
  .action((targetPath: string, opts: { limit: string; each?: boolean; save?: boolean }) => {
    const limit = Number.parseInt(opts.limit, 10);
    const isJson = program.opts().json;

    if (opts.each) {
      const results = scanEach({ path: targetPath, limit });
      if (isJson) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        console.log(formatEach(results));
      }
    } else {
      const result = scan({ path: targetPath, limit });

      if (opts.save) {
        saveSnapshot(result);
        closeDb();
      }

      if (isJson) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatScan(result));
        if (opts.save) {
          console.log("  Snapshot saved.\n");
        }
      }
    }
  });

program
  .command("deps")
  .description("Dependency analysis — outdated, unused, heavy, duplicates")
  .argument("[path]", "Project directory to analyze", ".")
  .option("--limit <n>", "Max items per section", "20")
  .action((targetPath: string, opts: { limit: string }) => {
    const result = analyzeDeps({ path: targetPath, limit: Number.parseInt(opts.limit, 10) });

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
  .option("--limit <n>", "Max snapshots to show", "20")
  .action((targetPath: string, opts: { limit: string }) => {
    const project = path.resolve(targetPath);
    const limit = Number.parseInt(opts.limit, 10);
    const snapshots = getSnapshots(project, limit);
    closeDb();

    if (program.opts().json) {
      console.log(JSON.stringify(snapshots, null, 2));
    } else {
      console.log(formatTrend(project, snapshots));
    }
  });

export function runCli(argv?: string[]) {
  program.parse(argv || process.argv);
}

runCli();
