/**
 * Static checks: JS syntax, JSON validity, and i18n keys used in code/templates present in every language file.
 * Usage: node tools/check.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const walk = dir => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
let failed = false;

// JS syntax
for ( const file of walk(path.join(root, "module")).filter(f => f.endsWith(".mjs")) ) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch ( err ) {
    failed = true;
    console.error(`Syntax error in ${file}\n${err.stderr}`);
  }
}

// JSON validity
const jsonFiles = ["system.json", ...walk(path.join(root, "lang")), ...walk(path.join(root, "packs", "_source"))]
  .filter(f => f.endsWith(".json"));
for ( const file of jsonFiles ) {
  try {
    JSON.parse(fs.readFileSync(path.resolve(root, file), "utf8"));
  } catch ( err ) {
    failed = true;
    console.error(`Invalid JSON in ${file}: ${err.message}`);
  }
}

// i18n keys
const sources = [...walk(path.join(root, "module")), ...walk(path.join(root, "templates"))];
const used = new Set();
for ( const file of sources ) {
  for ( const m of fs.readFileSync(file, "utf8").matchAll(/(?<!CONFIG.)EP1E\.[A-Za-z0-9_.]*[A-Za-z0-9]/g) ) used.add(m[0]);
}
const flatten = (obj, prefix = "") => Object.entries(obj)
  .flatMap(([k, v]) => (typeof v === "object") ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
for ( const lang of fs.readdirSync(path.join(root, "lang")) ) {
  const keys = flatten(JSON.parse(fs.readFileSync(path.join(root, "lang", lang), "utf8")));
  const keySet = new Set(keys);
  // Keys built dynamically (e.g. `EP1E.Skill.${key}`) appear as prefixes
  const missing = [...used].filter(k => !keySet.has(k) && !keys.some(x => x.startsWith(`${k}.`)));
  if ( missing.length ) {
    failed = true;
    console.error(`${lang} is missing: ${missing.join(", ")}`);
  }
}

console.log(failed ? "Checks failed." : "All checks passed.");
process.exit(failed ? 1 : 0);
