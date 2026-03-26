import { Command } from "commander";
import { analyzeDeps } from "./lib/deps.js";
import { formatDeps, formatEach, formatScan } from "./lib/format.js";
import { scan, scanEach } from "./lib/scanner.js";

const program = new Command();

program
  .name("dietclaw")
  .description("Codebase health monitor. Find out why your project is getting fat.")
  .version("0.1.0")
  .option("--json", "Output as JSON");

program
  .command("scan")
  .description("Quick health report for a project")
  .argument("[path]", "Project directory to scan", ".")
  .option("--limit <n>", "Max large files to show", "10")
  .option("--each", "Detect and compare subprojects")
  .action((targetPath: string, opts: { limit: string; each?: boolean }) => {
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
      if (isJson) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatScan(result));
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

export function runCli(argv?: string[]) {
  program.parse(argv || process.argv);
}

runCli();
