// Viewport overlay sprites (pistol, flashes, splats, cursors). Pure data, no DOM.
// One bit per pixel; a pixel is 2 hires wide x 1 tall (one mode-E colour clock).
// rows[y] is a string of "." and "#" (w chars). tools/spritejson.py reads the same file.

export const SPRITE_FILE_VERSION = 1;
export const SPRITE_W_MIN = 4;
export const SPRITE_W_MAX = 20;
export const SPRITE_W_STEP = 4;
export const SPRITE_H_MIN = 8;
export const SPRITE_H_MAX = 40;
export const SPRITE_H_STEP = 2;

/**
 * Catalogue. ox/oy: hires offset of the canvas top-left inside the generator's local canvas
 * (see tools/spritejson.py CANVAS). vx/vy: viewport-relative hires origin of that local canvas,
 * for the preview overlay. black: drawn as a black (AND) sprite in game.
 */
export const SPRITE_DEFS = [
  { id: "pistol", name: "Pistol", group: "Weapon", w: 12, h: 32, ox: 10, oy: 0, vx: 72, vy: 102, black: true },
  { id: "muzzle_flash", name: "Muzzle flash", group: "Muzzle flash", w: 12, h: 22, ox: 0, oy: 0, vx: 84, vy: 82, black: false },
  { id: "splat_0", name: "Splat 0 (near)", group: "Splat", w: 12, h: 22, ox: 0, oy: 0, vx: 84, vy: 54, black: false },
  { id: "splat_1", name: "Splat 1", group: "Splat", w: 12, h: 22, ox: 0, oy: 0, vx: 84, vy: 54, black: false },
  { id: "splat_2", name: "Splat 2 (far)", group: "Splat", w: 12, h: 22, ox: 0, oy: 0, vx: 84, vy: 54, black: false },
  { id: "enemy_muzzle_0", name: "Enemy flash 0 (near)", group: "Enemy flash", w: 12, h: 22, ox: 0, oy: 0, vx: 84, vy: 54, black: false },
  { id: "enemy_muzzle_1", name: "Enemy flash 1", group: "Enemy flash", w: 12, h: 22, ox: 0, oy: 0, vx: 84, vy: 54, black: false },
  { id: "enemy_muzzle_2", name: "Enemy flash 2 (far)", group: "Enemy flash", w: 12, h: 22, ox: 0, oy: 0, vx: 84, vy: 54, black: false },
  { id: "jump_cursor", name: "Jump cursor", group: "Cursor", w: 4, h: 8, ox: 92, oy: 60, vx: 0, vy: 0, black: true },
  { id: "scan_rig", name: "Scan rig", group: "Cursor", w: 20, h: 32, ox: 4, oy: 0, vx: 72, vy: 96, black: true },
];

export function spriteDef(id) {
  return SPRITE_DEFS.find((d) => d.id === id) || null;
}

export function spriteBlankRows(w, h) {
  return Array.from({ length: h }, () => ".".repeat(w));
}

export function spriteBlank(def) {
  return { id: def.id, w: def.w, h: def.h, ox: def.ox, oy: def.oy, rows: spriteBlankRows(def.w, def.h) };
}

function snapTo(v, min, max, step, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const s = Math.round((n - min) / step) * step + min;
  return Math.max(min, Math.min(max, s));
}

function cleanRows(raw, w, h) {
  const out = spriteBlankRows(w, h);
  if (!Array.isArray(raw)) return out;
  for (let y = 0; y < h; y++) {
    const r = typeof raw[y] === "string" ? raw[y] : "";
    let s = "";
    for (let x = 0; x < w; x++) s += r[x] === "#" ? "#" : ".";
    out[y] = s;
  }
  return out;
}

/** Always returns every catalogue sprite, in catalogue order. */
export function normalizeSprites(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return SPRITE_DEFS.map((def) => {
    const r = list.find((s) => s && s.id === def.id);
    if (!r) return spriteBlank(def);
    const w = snapTo(r.w, SPRITE_W_MIN, SPRITE_W_MAX, SPRITE_W_STEP, def.w);
    const h = snapTo(r.h, SPRITE_H_MIN, SPRITE_H_MAX, SPRITE_H_STEP, def.h);
    const ox = Number.isFinite(Number(r.ox)) ? Number(r.ox) | 0 : def.ox;
    const oy = Number.isFinite(Number(r.oy)) ? Number(r.oy) | 0 : def.oy;
    return { id: def.id, w, h, ox, oy, rows: cleanRows(r.rows, w, h) };
  });
}

export function spriteGet(sp, x, y) {
  if (x < 0 || y < 0 || x >= sp.w || y >= sp.h) return false;
  return sp.rows[y][x] === "#";
}

/** Mutates. Returns true when the pixel changed. */
export function spriteSet(sp, x, y, on) {
  if (x < 0 || y < 0 || x >= sp.w || y >= sp.h) return false;
  if (spriteGet(sp, x, y) === on) return false;
  const r = sp.rows[y];
  sp.rows[y] = r.slice(0, x) + (on ? "#" : ".") + r.slice(x + 1);
  return true;
}

export function spriteRowsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** {minX,maxX,minY,maxY,count} or null when blank. */
export function spriteInk(sp) {
  let minX = Infinity;
  let maxX = -1;
  let minY = Infinity;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < sp.h; y++) {
    for (let x = 0; x < sp.w; x++) {
      if (sp.rows[y][x] !== "#") continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return count ? { minX, maxX, minY, maxY, count } : null;
}

/** New rows, content moved by (dx, dy); anything pushed off the edge is lost. */
export function spriteShiftRows(sp, dx, dy) {
  const out = spriteBlankRows(sp.w, sp.h);
  for (let y = 0; y < sp.h; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= sp.h) continue;
    let s = "";
    for (let x = 0; x < sp.w; x++) {
      const sx = x - dx;
      s += sx >= 0 && sx < sp.w ? sp.rows[sy][sx] : ".";
    }
    out[y] = s;
  }
  return out;
}

export function spriteFlipHRows(sp) {
  return sp.rows.map((r) => r.split("").reverse().join(""));
}

export function spriteFlipVRows(sp) {
  return sp.rows.slice().reverse();
}

export function spriteInvertRows(sp) {
  return sp.rows.map((r) => r.replace(/[.#]/g, (c) => (c === "#" ? "." : "#")));
}

function clampDelta(d, lo, hi) {
  return Math.max(lo, Math.min(hi, d));
}

/**
 * Resize to (w, h) keeping the pixels centred. The old canvas centre maps to the new centre;
 * if ink exists and would be cropped although it fits, the shift is nudged so it survives.
 * ox/oy move opposite to the shift (hires x = 2 per pixel) so the art stays put in game.
 * Returns a new sprite object.
 */
export function spriteResize(sp, w, h) {
  let dx = Math.floor((w - sp.w) / 2);
  let dy = Math.floor((h - sp.h) / 2);
  const ink = spriteInk(sp);
  if (ink) {
    if (ink.maxX - ink.minX + 1 <= w) dx = clampDelta(dx, -ink.minX, w - 1 - ink.maxX);
    if (ink.maxY - ink.minY + 1 <= h) dy = clampDelta(dy, -ink.minY, h - 1 - ink.maxY);
  }
  const rows = spriteBlankRows(w, h);
  for (let y = 0; y < h; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= sp.h) continue;
    let s = "";
    for (let x = 0; x < w; x++) {
      const sx = x - dx;
      s += sx >= 0 && sx < sp.w ? sp.rows[sy][sx] : ".";
    }
    rows[y] = s;
  }
  return { id: sp.id, w, h, ox: sp.ox - 2 * dx, oy: sp.oy - dy, rows };
}

// ---- JSON file ----

export function spritesToJson(sprites) {
  const list = normalizeSprites(sprites);
  const blocks = list.map((sp) => {
    const rows = sp.rows.map((r) => `        ${JSON.stringify(r)}`).join(",\n");
    return (
      `    {\n      "id": ${JSON.stringify(sp.id)}, "w": ${sp.w}, "h": ${sp.h}, "ox": ${sp.ox}, "oy": ${sp.oy},\n` +
      `      "rows": [\n${rows}\n      ]\n    }`
    );
  });
  return `{\n  "version": ${SPRITE_FILE_VERSION},\n  "sprites": [\n${blocks.join(",\n")}\n  ]\n}\n`;
}

/** Throws on malformed JSON. */
export function spritesFromJson(text) {
  const data = typeof text === "string" ? JSON.parse(text) : text;
  return normalizeSprites(data?.sprites);
}

// ---- preview geometry ----

/** Viewport-relative hires rect of the sprite's canvas: {x, y, w, h}. */
export function spriteViewRect(sp) {
  const def = spriteDef(sp.id);
  return { x: (def?.vx ?? 0) + sp.ox, y: (def?.vy ?? 0) + sp.oy, w: sp.w * 2, h: sp.h };
}
