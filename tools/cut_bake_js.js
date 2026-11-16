#!/usr/bin/env node
/*
 * Dump the editor's cutscene bake (editor/js/cutsceneModel.js) as JSON, for cross-checking
 * tools/gencutscene.py against the JS the editor previews with.
 *
 *   node tools/cut_bake_js.js editor/maps/mapa.json > js_bake.json
 *
 * Output: { durMs, step, ns, actors: [{ id, kind, item, scale, ns, x[], y[], z[], yaw[] }] }
 * (positions already rounded to 1/256, yaw bytes 0..255). Prints {} when the map has no cutscene.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const jsDir = path.join(root, "editor", "js");

// Same module stripping as editor/bundle_editor.py: one shared scope.
function strip(src) {
  return src
    .replace(/^import\s+[\s\S]*?;\s*\n/gm, "")
    .replace(/^export\s*\{[\s\S]*?\};\s*\n/gm, "")
    .replace(/^export\s+default\s+/gm, "")
    .replace(/^export\s+/gm, "");
}

const files = ["roomGeom.js", "fontModel.js", "model.js", "cutsceneModel.js"];
const code = files.map((f) => strip(fs.readFileSync(path.join(jsDir, f), "utf8"))).join("\n\n");
const api = new Function(`${code}\nreturn { normalizeDocument, bakeCutscene };`)();

const mapPath = process.argv[2];
if (!mapPath) {
  console.error("usage: node tools/cut_bake_js.js <editor/maps/mapX.json>");
  process.exit(2);
}
const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const nebula = JSON.parse(fs.readFileSync(path.join(root, "editor", "nebula.json"), "utf8"));
const doc = api.normalizeDocument({
  version: nebula.version,
  maps: { MAPA: map },
  items: nebula.items,
  customItems: nebula.customItems,
  itemMeta: nebula.itemMeta,
  enemies: [],
});
const cut = doc.maps.MAPA.cutscene;
process.stdout.write(JSON.stringify(cut ? api.bakeCutscene(cut) : {}, null, 1) + "\n");
