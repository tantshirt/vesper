#!/usr/bin/env node
/**
 * Token guard: fails (exit 1) if any component file under app/app hardcodes a hex color.
 * Brand colors must come from CSS tokens in globals.css. Dependency-free (node built-ins only).
 * Scans .tsx/.ts/.jsx/.js (case-insensitive); globals.css is not scanned (it holds the tokens).
 *
 * Allowlist: a line carrying an inline `/* token-guard-allow *\/` marker may contain exactly
 * ONE sanctioned literal (e.g. Privy accentColor, theme-color metadata that needs a string).
 * The marker suppresses a single hex on its line — any additional hex on that same line is
 * still reported, so the marker can't be abused to smuggle an off-token color through.
 */
import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, "..");      // .../app
const SCAN_DIR = join(APP_ROOT, "app");      // .../app/app (the App Router tree)

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

const violations = [];
for (const file of collect(SCAN_DIR)) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, idx) => {
    const matches = line.match(HEX);
    if (!matches) return;
    // A marker allows exactly one sanctioned literal on the line; report the rest.
    const reportable = line.includes(ALLOW_MARKER) ? matches.slice(1) : matches;
    for (const hex of reportable) {
      violations.push(`${relative(APP_ROOT, file)}:${idx + 1}\t${hex}`);
    }
  });
}

if (violations.length > 0) {
  console.error("check:tokens — hardcoded hex color(s) found. Use a CSS token from globals.css instead:");
  for (const v of violations) console.error("  " + v);
  console.error(
    `\n${violations.length} violation(s). If a single literal is genuinely required, mark its line with an inline /* ${ALLOW_MARKER} */ comment.`,
  );
  process.exit(1);
}

console.log("check:tokens — clean: no hardcoded hex colors in components under app/app.");
process.exit(0);
