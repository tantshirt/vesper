#!/usr/bin/env node
/**
 * Token guard: fails (exit 1) if any component file under a scanned App Router tree hardcodes a hex
 * color. Brand colors must come from CSS tokens in globals.css. Dependency-free (node built-ins only).
 * Scans .tsx/.ts/.jsx/.js (case-insensitive); globals.css is not scanned (it holds the tokens).
 *
 * Roots (Admin Story 1.1): both the consumer tree (app/app) and the admin tree (admin/app), resolved
 * from the repo root. A root that does not exist is skipped — but if NONE of the roots exist the guard
 * exits 1, because a guard that reports success having scanned nothing is worse than no guard at all.
 *
 * Allowlist: a line carrying an inline `/* token-guard-allow *\/` marker may contain exactly
 * ONE sanctioned literal (e.g. Privy accentColor, theme-color metadata that needs a string).
 * The marker suppresses a single hex on its line — any additional hex on that same line is
 * still reported, so the marker can't be abused to smuggle an off-token color through.
 */
import { readdirSync, readFileSync, lstatSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, "..");       // .../app
const REPO_ROOT = join(APP_ROOT, "..");       // repo root (workspace root)
// App Router trees to scan, relative to the repo root. Both apps are held to the same token rule.
const SCAN_DIRS = [join(REPO_ROOT, "app", "app"), join(REPO_ROOT, "admin", "app")];

// #rgb | #rgba | #rrggbb | #rrggbbaa — global so every hex on a line is seen.
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;
const ALLOW_MARKER = "token-guard-allow";
const SCAN_EXT = /\.(tsx|ts|jsx|js)$/i;

function collect(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    console.error(`check:tokens — cannot read directory ${dir}: ${err.message}`);
    process.exit(2);
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = lstatSync(full, { throwIfNoEntry: false });
    if (!st || st.isSymbolicLink()) continue;       // skip broken/dangling and symlinks (no cycles)
    if (st.isDirectory()) out.push(...collect(full));
    else if (SCAN_EXT.test(name)) out.push(full);
  }
  return out;
}

const roots = SCAN_DIRS.filter((dir) => existsSync(dir));
if (roots.length === 0) {
  console.error(
    `check:tokens — no App Router tree found to scan (looked for: ${SCAN_DIRS.map((d) => relative(REPO_ROOT, d)).join(", ")}). Refusing to report success on an empty scan.`,
  );
  process.exit(1);
}

const violations = [];
for (const root of roots) {
  for (const file of collect(root)) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, idx) => {
      const matches = line.match(HEX);
      if (!matches) return;
      // A marker allows exactly one sanctioned literal on the line; report the rest.
      const reportable = line.includes(ALLOW_MARKER) ? matches.slice(1) : matches;
      for (const hex of reportable) {
        violations.push(`${relative(REPO_ROOT, file)}:${idx + 1}\t${hex}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error("check:tokens — hardcoded hex color(s) found. Use a CSS token from globals.css instead:");
  for (const v of violations) console.error("  " + v);
  console.error(
    `\n${violations.length} violation(s). If a single literal is genuinely required, mark its line with an inline /* ${ALLOW_MARKER} */ comment.`,
  );
  process.exit(1);
}

console.log(
  `check:tokens — clean: no hardcoded hex colors in ${roots.map((d) => relative(REPO_ROOT, d)).join(", ")}.`,
);
process.exit(0);
