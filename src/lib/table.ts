import chalk from "chalk";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes are control characters by definition
const ANSI_REGEX = /\u001B\[[0-9;]*m/g;

function visibleWidth(value: string): number {
  return Array.from(value.replace(ANSI_REGEX, "")).length;
}

function padCell(value: string, width: number): string {
  const padding = Math.max(0, width - visibleWidth(value));
  return `${value}${" ".repeat(padding)}`;
}

function border(left: string, join: string, right: string, widths: number[]): string {
  return chalk.dim(`${left}${widths.map((w) => "─".repeat(w + 2)).join(join)}${right}`);
}

function formatRow(cells: string[], widths: number[]): string {
  return `${chalk.dim("│")} ${cells.map((cell, i) => padCell(cell, widths[i])).join(` ${chalk.dim("│")} `)} ${chalk.dim("│")}`;
}

export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, i) =>
    Math.max(visibleWidth(header), ...rows.map((row) => visibleWidth(row[i] || ""))),
  );

  const lines = [
    border("┌", "┬", "┐", widths),
    formatRow(
      headers.map((h) => chalk.dim(h)),
      widths,
    ),
    border("├", "┼", "┤", widths),
    ...rows.map((row) => formatRow(row, widths)),
    border("└", "┴", "┘", widths),
  ];

  return lines.join("\n");
}
