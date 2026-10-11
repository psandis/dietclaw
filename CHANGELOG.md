# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-10-11

### Added

- Windows support: no shell-specific syntax, forward-slash paths in all output, and Windows install and storage instructions in the README.
- CI on GitHub Actions: lint, type check, tests, build, and a CLI smoke test on macOS, Linux, and Windows with Node.js 22 and 24.
- `scan --each --save` saves one snapshot per detected project.
- `--limit` is validated and rejects anything other than a positive integer.
- `pnpm typecheck` script. Type checking now covers the tests as well as the source.
- `prepublishOnly` runs lint, type check, build, and tests before every publish.
- `deps` JSON output has a `warnings` array, also shown at the top of the text report, for problems that limited the analysis.
- `moduleExts` in `data/defaults.jsonc` lists the files parsed for imports. `.mts` and `.cts` are recognized as TypeScript source.
- Tests for the CLI (run as a separate process), import parsing, lockfile reading, dependency analysis, output formatting, snapshot storage, and config parsing (23 to 119 tests).
- This changelog.

### Changed

- **Breaking:** requires Node.js 22.12 or newer (was 22.0). commander 15 and oxc-parser need it.
- **Breaking (JSON output):** in `deps`, `outdated` is `null` when `npm outdated` could not run. It was previously an empty array, which looked the same as "everything up to date".
- Unused dependency detection parses JavaScript and TypeScript with [oxc-parser](https://github.com/oxc-project/oxc) instead of searching source text. Imports inside comments and strings no longer count, and `import()`, `require()`, re-exports, and TypeScript `import x = require()` are recognized.
- Version conflicts are read from `pnpm-lock.yaml` instead of the `node_modules/.pnpm` folder. Packages left behind after dependency changes are no longer reported, packages for other operating systems and CPUs are excluded, and "direct" means the exact version resolved for `package.json`.
- Heaviest packages skip `node_modules/.pnpm` entries the lockfile no longer references.
- Build uses esbuild directly instead of tsup, which is no longer maintained.
- Snapshots are keyed by the project's real path. Symlinked paths (such as `/tmp` on macOS) and Windows drive letter casing now map to the same history.
- `trend` orders snapshots by insertion order instead of by timestamp text.
- `DIETCLAW_HOME` is read when the database is opened instead of when the module loads.
- Update levels in `deps` (major, minor, patch) use `semver` instead of comparing version strings by hand.
- `data/defaults.jsonc` is parsed with `jsonc-parser`. An invalid file now stops with an error naming the file and the position of the problem.
- Errors print a single `error:` line and exit with code 1 instead of a stack trace.
- Empty table cells show `-`.
- README examples regenerated from real output. Added Storage and Windows sections.
- Development Node.js version is 24 (LTS). Package manager is pnpm 12; build script approvals moved to `pnpm-workspace.yaml`.
- Dependencies updated to their latest versions: better-sqlite3 13, chalk 6, commander 15, Biome 2.5, TypeScript 7, Vitest 5, Vite 8. New dependencies: oxc-parser, yaml, semver, jsonc-parser.

### Fixed

- Line counts included binary files such as images, which inflated totals and skewed language percentages. Binary files are now detected by content and counted for size only.
- Files ending with a newline were counted as one line too many.
- `deps` reported "All packages are up to date" when `npm outdated` failed, timed out, or was not installed.
- `npm outdated` used `2>/dev/null || true`, which does not work in Windows `cmd.exe`.
- Side-effect imports such as `import "dotenv/config"` were not recognized, so those packages were reported as unused.
- Unused dependency detection read source from `dist`, `build`, `vendor`, and other ignored directories.
- Negative size changes in `trend` were shown in bytes (`-1024 B`) instead of the matching unit (`-1.0 KB`).
- `trend` said "1 snapshots" for a single snapshot.
- npm alias dependencies (`npm:other@^1.0.0`) were not recognized as direct dependencies in version conflicts.
- Version conflicts sorted versions as text, so 10.0.0 came before 9.0.0.
- All 16 security advisories in development dependencies resolved (`pnpm audit` reports none).

## [0.2.0] - 2026-04-01

### Added

- `scan --save` stores a snapshot in `~/.dietclaw/history.db` (SQLite).
- `trend` command shows project health over time with a change summary.
- `DIETCLAW_HOME` environment variable to change the storage location.

### Changed

- README: emoji on related project links.

## [0.1.0] - 2026-03-26

### Added

- `scan`: project weight, category breakdown, languages, complexity, and large, long, and duplicate files.
- `scan --each`: compare multiple projects side by side.
- `deps`: outdated packages, unused dependencies, heaviest packages, and version conflicts.
- `--json` output on all commands.
- All classification rules in `data/defaults.jsonc`, editable without code changes.

[Unreleased]: https://github.com/psandis/dietclaw/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/psandis/dietclaw/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/psandis/dietclaw/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/psandis/dietclaw/releases/tag/v0.1.0
