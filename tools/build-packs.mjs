/**
 * Compile the JSON sources in packs/_source/<pack> into Foundry LevelDB compendiums in packs/<pack>,
 * or extract compendiums back to JSON.
 * Usage: node tools/build-packs.mjs pack | unpack
 */
import fs from "node:fs";
import path from "node:path";
import { compilePack, extractPack } from "@foundryvtt/foundryvtt-cli";

const root = path.resolve(import.meta.dirname, "..");
const sourceDir = path.join(root, "packs", "_source");
const mode = process.argv[2] ?? "pack";
const manifest = JSON.parse(fs.readFileSync(path.join(root, "system.json"), "utf8"));

for ( const pack of manifest.packs ) {
  const src = path.join(sourceDir, pack.name);
  const dest = path.join(root, pack.path);
  if ( mode === "unpack" ) {
    await extractPack(dest, src, { clean: true });
    console.log(`Extracted ${pack.name}`);
    continue;
  }
  if ( !fs.existsSync(src) ) {
    console.warn(`No source for ${pack.name}, skipping`);
    continue;
  }
  fs.rmSync(dest, { recursive: true, force: true });
  await compilePack(src, dest, { log: false });
  console.log(`Compiled ${pack.name} (${fs.readdirSync(src).length} documents)`);
}
