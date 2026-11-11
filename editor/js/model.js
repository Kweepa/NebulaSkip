import { fontBlank, normalizeFont } from "./fontModel.js";
import {
  ROOM_SHAPES,
  clampRoomShape,
  clampQuarter,
  clampRoomSplits,
  applyRoomShape,
  roomGeometry,
  pointInRoom,
  aabbOverlapsRoom,
  roomFloorY,
  rayHullFace,
  rayRoomHull,
  xzOnRoomFloor,
  snapDoorToRoom,
  snapDoorBetweenRooms,
  snapDoorToFace,
  snapSwitchToFace,
  orientDoorToRooms,
  snapSwitchToRoom,
  alignSwitchToContact,
  rayCrateSwitchFace,
  doorRoomScores,
  doorTouchingRooms,
  doorNearFaceId,
  nudgeDoorOutside,
  rotateRoom,
  preserveRoomSplits,
  applyRoomSplitDelta,
  roomControlPoints,
  controlSelectionTranslates,
  applyRoomControlDelta,
  applyAabbControlDelta,
  roomBasis,
  defaultRoomSplits,
} from "./roomGeom.js";

export {
  ROOM_SHAPES,
  clampRoomShape,
  clampQuarter,
  clampRoomSplits,
  applyRoomShape,
  roomGeometry,
  pointInRoom,
  aabbOverlapsRoom,
  roomFloorY,
  rayHullFace,
  rayRoomHull,
  xzOnRoomFloor,
  snapDoorToRoom,
  snapDoorBetweenRooms,
  snapDoorToFace,
  snapSwitchToFace,
  orientDoorToRooms,
  snapSwitchToRoom,
  alignSwitchToContact,
  rayCrateSwitchFace,
  doorNearFaceId,
  nudgeDoorOutside,
  rotateRoom,
  preserveRoomSplits,
  applyRoomSplitDelta,
  roomControlPoints,
  controlSelectionTranslates,
  applyRoomControlDelta,
  applyAabbControlDelta,
  roomBasis,
  defaultRoomSplits,
};

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const WORLD_MIN = 0;
export const WORLD_MAX = 255;
export const WORLD_SIZE = 256;
export const MAX_VERTS = 13;
export const MAX_LINES = 13;
export const SKEL_MAX_VERTS = 16;
export const SKEL_MAX_LINES = 32;
export const SPRITE_MAX_VERTS = 16;
export const SPRITE_MAX_LINES = 32;
export const ENEMY_DOS = {
  Possessed: "poss",
  Baron: "baron",
  Pinky: "pinky",
  Imp: "imp",
};
export const DOOM_SPRITE_PREFIX = {
  Possessed: "POSS",
  Imp: "TROO",
  Pinky: "SARG",
  Baron: "BOSS",
};
export const WEAPON_VERT = 12;

/** Game muzzle reads batch slot 12. Export parks this vertex there. */
export function clampWeaponVert(n, nv) {
  const count = Math.max(0, nv | 0);
  if (!count) return 0;
  const fallback = Math.min(WEAPON_VERT, count - 1);
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(count - 1, v | 0));
}
export const VERT_MIN = -128;
export const VERT_MAX = 127;
export const SKEL_VERT_MAX = 509;
export const DEFAULT_MDL_SCALE = 0.7;
const OLD_DEFAULT_MDL_SCALE = 0.57;
export const ANIM_ORBIT_DIST_MIN = 4;
export const ANIM_ORBIT_DIST_MAX = 400;
export const ITEM_ORBIT_DIST_MIN = 8;
export const ITEM_ORBIT_DIST_MAX = 80;
export const DOC_VERSION = 11;
export const DEFAULT_WEAPON_SCALE = 0.4;
export const WEAPON_KEYS = ["shot2", "chain", "rock"];
export const WEAPON_LABELS = {
  shot2: "Super shotgun",
  chain: "Chaingun",
  rock: "Rocket launcher",
};

/** Fixed enemy cue set. sight/wince/death play generically; melee/shoot bind to clips. */
export const ENEMY_CUES = ["sight", "wince", "melee", "shoot", "death"];
export const ENEMY_CUE_LABELS = {
  sight: "Sight",
  wince: "Wince",
  melee: "Melee",
  shoot: "Shoot",
  death: "Death",
};
export const ENEMY_CUES_REQUIRED = ["sight", "wince", "death"];
/** Cues that a clip may carry (timed to an animation frame). */
export const ENEMY_ATTACK_CUES = ["melee", "shoot"];

/** Normalize a cue value to a sound path, or "" when it is not one. */
export function normalizeCuePath(raw) {
  const p = String(raw ?? "")
    .trim()
    .replace(/\\/g, "/")
    .toLowerCase();
  return p.startsWith("sound/") && p.endsWith(".wav") ? p : "";
}

/** { sight, wince, melee, shoot, death } -> sound path. Unset cues are omitted. */
export function parseEnemyCues(raw) {
  const out = {};
  for (const cue of ENEMY_CUES) {
    const p = normalizeCuePath(raw?.[cue]);
    if (p) out[cue] = p;
  }
  return out;
}

export function clampMdlScale(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_MDL_SCALE;
  return Math.max(0.1, Math.min(2, v));
}

/**
 * Room colour is one Atari byte: hue in the high nibble, luminance in the low
 * nibble (bit 0 unused). The game feeds it straight to COLPF0 (paper); ink is
 * the same hue at luminance $0c. No other per-room colours exist.
 */
export const ROOM_BG_GREY_DARK = 0x04;
export const ROOM_BG_GREY_LIGHT = 0x0a;

/** Picker slots. Slot i is also what legacy C64 bgColor i converts to. */
export const ROOM_BG_SLOTS = [
  { name: "dark grey (was black)", byte: ROOM_BG_GREY_DARK },
  { name: "light grey (was white)", byte: ROOM_BG_GREY_LIGHT },
  { name: "red", byte: 0x42 },
  { name: "cyan", byte: 0xa6 },
  { name: "purple", byte: 0x64 },
  { name: "green", byte: 0xc4 },
  { name: "blue", byte: 0x84 },
  { name: "yellow", byte: 0x1c },
  { name: "orange", byte: 0x26 },
  { name: "brown", byte: 0x24 },
  { name: "light red", byte: 0x4a },
  { name: "dark grey", byte: 0x06 },
  { name: "grey", byte: 0x08 },
  { name: "light green", byte: 0xca },
  { name: "light blue", byte: 0x9a },
  { name: "light grey", byte: 0x0c },
];

/** Default room background (A8 byte; the old brown). */
export const ROOM_BG_DEFAULT = 0x24;

/** A8 RGB, [hue * 8 + (lum >> 1)]. Approximate NTSC GTIA, preview only. */
export const A8_HEX = [
  // hue 0
  "#000000", "#242424", "#494949", "#6d6d6d", "#929292", "#b6b6b6", "#dbdbdb", "#ffffff",
  // hue 1
  "#1d0a00", "#422f00", "#665300", "#8b7700", "#af9c10", "#d4c035", "#f8e559", "#ffff7d",
  // hue 2
  "#380000", "#5d1b00", "#813f00", "#a6630c", "#ca8831", "#efac55", "#ffd179", "#fff59e",
  // hue 3
  "#4a0000", "#6e0800", "#932d19", "#b7513d", "#db7562", "#ff9a86", "#ffbeab", "#ffe3cf",
  // hue 4
  "#4e000a", "#73002e", "#971f53", "#bc4477", "#e0689b", "#ff8cc0", "#ffb1e4", "#ffd5ff",
  // hue 5
  "#450042", "#6a0066", "#8e198a", "#b33daf", "#d762d3", "#fb86f8", "#ffabff", "#ffcfff",
  // hue 6
  "#30006e", "#550093", "#791bb7", "#9e3fdb", "#c264ff", "#e688ff", "#ffadff", "#ffd1ff",
  // hue 7
  "#130088", "#3700ac", "#5c25d1", "#8049f5", "#a56eff", "#c992ff", "#eeb7ff", "#ffdbff",
  // hue 8
  "#00008a", "#1711ae", "#3b35d3", "#6059f7", "#847eff", "#a9a2ff", "#cdc7ff", "#f1ebff",
  // hue 9
  "#000074", "#002498", "#1d49bd", "#416de1", "#6692ff", "#8ab6ff", "#afdaff", "#d3ffff",
  // hue A
  "#00144a", "#00386f", "#065c93", "#2b81b7", "#4fa5dc", "#74caff", "#98eeff", "#bcffff",
  // hue B
  "#002413", "#004838", "#006d5c", "#209181", "#44b6a5", "#68daca", "#8dfeee", "#b1ffff",
  // hue C
  "#002e00", "#005200", "#007722", "#229b47", "#46c06b", "#6be490", "#8fffb4", "#b4ffd8",
  // hue D
  "#003000", "#005500", "#0d7900", "#319d13", "#56c238", "#7ae65c", "#9eff81", "#c3ffa5",
  // hue E
  "#002a00", "#024e00", "#267300", "#4b9700", "#6fbc14", "#94e038", "#b8ff5d", "#ddff81",
  // hue F
  "#001d00", "#224100", "#466500", "#6b8a00", "#8fae06", "#b3d32a", "#d8f74f", "#fcff73",
];

export function a8Hex(byte) {
  const b = byte & 0xfe;
  return A8_HEX[((b >> 4) << 3) | ((b & 15) >> 1)];
}

/** Line colour for this paper: same hue, luminance $0c. Matches the seam DLI. */
export function a8InkHex(byte) {
  return a8Hex((byte & 0xf0) | 0x0c);
}

/** Black and white papers are not allowed: black gutters / ink == paper. */
export function normalizeBg(value, fallback = ROOM_BG_DEFAULT) {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return fallback;
  const b = Math.max(0, Math.min(255, n | 0)) & 0xfe;
  if ((b & 0xf0) === 0) {
    if (b < 0x04) return ROOM_BG_GREY_DARK;
    if (b >= 0x0e) return ROOM_BG_GREY_LIGHT;
  }
  return b;
}

/** Room object -> A8 background byte. Legacy bgColor/skyColor are C64 indices 0-15. */
export function roomBgFromJson(o, fallback = ROOM_BG_DEFAULT) {
  if (o == null) return fallback;
  if (o.a8Bg != null) return normalizeBg(o.a8Bg, fallback);
  const legacy = o.bgColor ?? o.skyColor;
  if (legacy != null) {
    const i = Number(legacy);
    if (Number.isFinite(i)) return ROOM_BG_SLOTS[Math.max(0, Math.min(15, i | 0))].byte;
  }
  return fallback;
}

export const KINDS = {
  room: {
    id: "room",
    label: "Room",
    color: "#c8ccd4",
    defaultSize: [16, 12, 16],
    fixed: false,
    slope: false,
  },
  crate: {
    id: "crate",
    label: "Crate",
    color: "#d4893a",
    defaultSize: [6, 6, 6],
    fixed: false,
    slope: false,
  },
  elevator: {
    id: "elevator",
    label: "Elevator",
    color: "#3ab4d4",
    defaultSize: [4, 1, 4],
    fixed: false,
    slope: false,
  },
  slope: {
    id: "slope",
    label: "Ramp",
    color: "#5cb85c",
    defaultSize: [4, 2, 4],
    fixed: false,
    slope: true,
  },
  platform: {
    id: "platform",
    label: "Platform",
    color: "#b8a878",
    defaultSize: [4, 1, 4],
    fixed: false,
    slope: false,
  },
  doorway: {
    id: "doorway",
    label: "Doorway",
    color: "#e6c84a",
    defaultSize: [4, 5, 1],
    fixed: true,
    slope: false,
  },
  switch: {
    id: "switch",
    label: "Switch",
    color: "#d45ec8",
    defaultSize: [2, 3, 1],
    fixed: true,
    slope: false,
  },
  enemy: {
    id: "enemy",
    label: "Enemy",
    color: "#e07070",
    defaultSize: [2, 4, 2],
    fixed: true,
    slope: false,
  },
  spawn: {
    id: "spawn",
    label: "Spawn",
    color: "#3ee06a",
    defaultSize: [2, 4, 2],
    fixed: true,
    slope: false,
  },
  trigger: {
    id: "trigger",
    label: "Trigger",
    color: "#7ec8e8",
    defaultSize: [8, 4, 8],
    fixed: false,
    slope: false,
  },
  pickup: {
    id: "pickup",
    label: "Pickup",
    color: "#6ec4a8",
    defaultSize: [1, 2, 1], // overwritten by applyBackpackProportions (1.5 tall, φ base)
    fixed: true,
    slope: false,
  },
};

/** Editor-only dashed / ghost volumes (not solid world geometry). */
export function isGhostKind(kind) {
  return kind === "trigger";
}

/** Kinds that always carry a link tag (resolved to indices on export). */
export function usesLinkTag(kind) {
  return kind === "switch" || kind === "elevator";
}

/** Trigger purposes. Tag is used for elevator / summon / unlock / unhide. */
export const TRIGGER_PURPOSES = ["message", "end_level", "hurt", "hurt_small", "elevator", "summon", "unlock", "unhide", "spawn"];
export const TRIGGER_PURPOSE_LABELS = {
  message: "Display message",
  end_level: "End of level",
  hurt: "Large hurt",
  hurt_small: "Small hurt",
  elevator: "Activate elevator",
  summon: "Summon elevator",
  unlock: "Unlock door",
  unhide: "Unhide door for 30s",
  spawn: "Spawn tagged enemies (once)",
};

export function clampTriggerPurpose(s) {
  return TRIGGER_PURPOSES.includes(s) ? s : "message";
}

export function triggerUsesTag(purpose) {
  const p = clampTriggerPurpose(purpose);
  return p === "elevator" || p === "summon" || p === "unlock" || p === "unhide" || p === "spawn";
}

export function doorUsesTag(lockKey) {
  return clampDoorLock(lockKey) === "remote";
}

/** Layout placements draw the first stick frame at this fraction of anim units (Possessed ~4 world high). */
export const LAYOUT_ENEMY_SCALE = 1 / 4;
/** mem.asm ENEMY_BLOCK_R: player cell vs enemy cell, Chebyshev (cells). */
export const GAME_ENEMY_BLOCK_R = 1;
/** mem.asm ENEMY_CULL_H: enemy body height for the player Y-overlap gate (world units). */
export const GAME_ENEMY_CULL_H = 6;

/** Yaw octants, 0 = +Z (N / game forward). */
export const ENEMY_FACINGS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function clampEnemyRot(n) {
  const r = n | 0;
  if (!Number.isFinite(r)) return 0;
  return ((r % 8) + 8) % 8;
}

export function cycleEnemyRot(n, delta = 1) {
  return clampEnemyRot((n | 0) + delta);
}

/** Ramp surface horizontals: bit0 = low end, bit1 = high end. */
export const SLOPE_FLAG_BOTTOM = 1;
export const SLOPE_FLAG_TOP = 2;

export function clampSlopeFlags(n) {
  return (n | 0) & (SLOPE_FLAG_BOTTOM | SLOPE_FLAG_TOP);
}

/** +90° Y. High end walks N (+Z) → E (+X) → S (−Z) → W (−X). */
export function cycleSlopeOrient(obj) {
  if (!obj || obj.kind !== "slope") return obj;
  return rotateSlopeOrientY(obj, 1);
}

export const PALETTE_ORDER = [
  "room",
  "switch",
  "slope",
  "platform",
  "crate",
  "elevator",
  "spawn",
  "trigger",
];
/** Palette icon stem in editor/thingicons/{stem}.png. */
export const KIND_ICON = {
  room: "room",
  doorway: "door",
  switch: "switch",
  slope: "ramp",
  platform: "platform",
  crate: "crate",
  elevator: "elevator",
  spawn: "spawn",
  trigger: "trigger",
};
export const MAX_TRIGGER_TEXT = 80;
export const MAX_NAME_LEN = 40;
export const MAX_VERB_LEN = 16;
export const MAX_TAG_LEN = 16;

/** Elevator height mode: Auto invents home/dest at cook; off uses elevLow/elevHigh vs room.y. */
export function elevHeightsAuto(obj) {
  return obj?.elevAuto !== false;
}

export function clampElevHeights(obj) {
  let low = Number.isFinite(Number(obj.elevLow)) ? obj.elevLow | 0 : 0;
  let high = Number.isFinite(Number(obj.elevHigh)) ? obj.elevHigh | 0 : 1;
  if (high <= low) high = low + 1;
  obj.elevLow = low;
  obj.elevHigh = high;
  obj.elevAuto = elevHeightsAuto(obj);
  delete obj.elevType;
}

function xzAabbGap(a, b) {
  const ax1 = (a.x | 0) + (a.sx | 0);
  const bx1 = (b.x | 0) + (b.sx | 0);
  const az1 = (a.z | 0) + (a.sz | 0);
  const bz1 = (b.z | 0) + (b.sz | 0);
  const dx = Math.max(0, (a.x | 0) - bx1, (b.x | 0) - ax1);
  const dz = Math.max(0, (a.z | 0) - bz1, (b.z | 0) - az1);
  return dx + dz;
}

/** XZ interiors overlap. A shared edge is not enough. */
function xzStrictOverlap(a, b) {
  const ax = a.x | 0;
  const bx = b.x | 0;
  const az = a.z | 0;
  const bz = b.z | 0;
  return (
    ax < bx + (b.sx | 0) &&
    bx < ax + (a.sx | 0) &&
    az < bz + (b.sz | 0) &&
    bz < az + (a.sz | 0)
  );
}

/** Highest collider floor under the car, else the room AABB min Y. */
function elevRestFloor(elev, room) {
  const roomY = room.y | 0;
  const elevY = elev.y | 0;
  let best = null;
  for (const c of roomGeometry(room).colliders || []) {
    if ((c.sx | 0) <= 0) continue;
    const cy = c.y | 0;
    if (cy > elevY) continue;
    if (!xzStrictOverlap(elev, c)) continue;
    if (best == null || cy > best) best = cy;
  }
  return best == null ? roomY : best;
}

function nearestFloorHome(elev, room, floorY) {
  const elevSy = elev.sy | 0;
  const elevTop = (elev.y | 0) + elevSy;
  let bestKey = null;
  let bestHome = null;
  for (const c of roomGeometry(room).colliders || []) {
    if ((c.sx | 0) <= 0) continue;
    const cy = c.y | 0;
    if (cy <= floorY) continue;
    const home = cy - elevSy;
    if (home <= floorY) continue;
    const key = [xzAabbGap(elev, c), Math.abs(cy - elevTop)];
    if (
      bestKey == null ||
      key[0] < bestKey[0] ||
      (key[0] === bestKey[0] && key[1] < bestKey[1])
    ) {
      bestKey = key;
      bestHome = home;
    }
  }
  return bestHome;
}

/** Upper stop so elev top meets nearest same-room solid platform top, or null. */
function nearestPlatHome(elev, roomId, plats, floorY) {
  const elevSy = elev.sy | 0;
  const elevTop = (elev.y | 0) + elevSy;
  let bestKey = null;
  let bestHome = null;
  for (const p of plats) {
    if (p.roomId !== roomId) continue;
    if (p.collide === false) continue;
    const surface = (p.y | 0) + ((p.sy | 0) || 1);
    const home = surface - elevSy;
    if (home <= floorY) continue;
    const key = [xzAabbGap(elev, p), Math.abs(surface - elevTop)];
    if (
      bestKey == null ||
      key[0] < bestKey[0] ||
      (key[0] === bestKey[0] && key[1] < bestKey[1])
    ) {
      bestKey = key;
      bestHome = home;
    }
  }
  return bestHome;
}

/** Upper stop so elev top meets a doorway sill on this room, or null. */
function nearestDoorHome(elev, roomId, doors, floorY) {
  const elevSy = elev.sy | 0;
  const elevTop = (elev.y | 0) + elevSy;
  let bestKey = null;
  let bestHome = null;
  for (const d of doors) {
    if (d.roomId !== roomId && d.otherRoomId !== roomId) continue;
    const surface = d.y | 0;
    const home = surface - elevSy;
    if (home <= floorY) continue;
    const key = [xzAabbGap(elev, d), Math.abs(surface - elevTop)];
    if (
      bestKey == null ||
      key[0] < bestKey[0] ||
      (key[0] === bestKey[0] && key[1] < bestKey[1])
    ) {
      bestKey = key;
      bestHome = home;
    }
  }
  return bestHome;
}

/**
 * Absolute elev_y bottoms for dest (low) and home (high), matching tools/genmap.py.
 * @returns {{ dest: number, home: number }}
 */
export function elevStopBottoms(doc, elev) {
  const room = roomUnderObject(doc, elev) || roomById(doc, elev.roomId);
  const roomY = room ? room.y | 0 : 0;
  if (!elevHeightsAuto(elev)) {
    clampElevHeights(elev);
    return { dest: roomY + elev.elevLow, home: roomY + elev.elevHigh };
  }
  const floorY = room ? elevRestFloor(elev, room) : roomY;
  let home = elev.y | 0;
  let dest = floorY;
  if ((elev.y | 0) <= floorY && room) {
    dest = elev.y | 0;
    const map = activeMap(doc);
    const objs = map?.objects || [];
    const plats = objs.filter((o) => o.kind === "platform");
    const doors = objs.filter((o) => o.kind === "doorway");
    let raised = nearestFloorHome(elev, room, floorY);
    if (raised == null) raised = nearestPlatHome(elev, elev.roomId, plats, floorY);
    if (raised == null) raised = nearestDoorHome(elev, room.id, doors, floorY);
    if (raised != null) home = raised;
  }
  return { dest, home };
}

/** Placeable pickup contents. Lightpost and barrel are drawn props. */
export const PICKUP_TYPES = [
  "small health",
  "large health",
  "green armor",
  "blue armor",
  "ammo box",
  "shells",
  "box of rockets",
  "shotgun",
  "chaingun",
  "chainsaw",
  "rocket launcher",
  "backpack",
  "red keycard",
  "yellow keycard",
  "blue keycard",
  "soulsphere",
  "radsuit",
  "lightpost",
  "barrel",
];
/** Shipped 8x8 palette icons (C64 index per pixel, . = clear), traced from the old thingicons PNGs. */
const BUILTIN_ITEM_ICONS = {
  "small health": ["00000000", "00111100", "01111110", "0ffffff0", "01155110", "01555510", "01155110", "01111110"],
  "large health": ["00000000", "01111110", "11111111", "ffffffff", "11155111", "11555511", "11155111", "11111111"],
  "green armor": ["55500555", "55555555", "055bb550", "0bb55bb0", "05b55b50", "0b5555b0", "05b55b50", "00555500"],
  "blue armor": ["eee00eee", "eeeeeeee", "0ee99ee0", "099ee990", "0e9ee9e0", "09eeee90", "0e9ee9e0", "00eeee00"],
  "ammo box": ["00000000", "00000000", "00000000", "00dddd00", "05555550", "09155190", "05999950", "05555550"],
  "shells": ["00000000", "00000000", "00000000", "00000000", "00000000", "00111700", "0f5f5880", "0ffff880"],
  "box of rockets": ["00000000", "00000000", "08888880", "9f9999f9", "98855889", "98989989", "98888889", "99999999"],
  "shotgun": ["........", "........", "........", "........", ".0......", "..000000", "22c..22.", "22......"],
  "chaingun": ["00000000", "00000000", "01f01010", "ccccfcfc", "ccfcfcf0", "022cfcf0", "2220f0f0", "22000000"],
  "chainsaw": ["........", "........", ".0......", "0.0.....", "0001c1c.", "727bbbb1", "777bbbbc", "771c1c1."],
  "rocket launcher": ["00000000", "00000000", "00000000", "00000010", "f222ffcf", "c2cfcccc", "00cc00c0", "00c00000"],
  "backpack": ["..88....", ".8888...", ".88899..", ".8898.9.", "89988..9", "88888..9", "88888.9.", ".88899.."],
  "red keycard": ["000aaaaa", "00aa2a2a", "0aa7222a", "0a7a222a", "0a772a2a", "0aa72a2a", "0a7a2a2a", "0aaaaaaa"],
  "yellow keycard": ["00077777", "00775757", "07725557", "07275557", "07225757", "07725757", "07275757", "07777777"],
  "blue keycard": ["000eeeee", "00ee6e6e", "0ee3666e", "0e3e666e", "0e336e6e", "0ee36e6e", "0e3e6e6e", "0eeeeeee"],
  "soulsphere": ["..6666..", ".6eeee6.", "6e0ee0e6", "66100166", "6ee66ee6", "66600666", ".660066.", "..6e66.."],
  "radsuit": ["0ff00ff0", "fffbbfff", "fc1cc1cf", "fcf11fcf", "fbffffbf", "29ffff92", "fbffffbf", "00ffff00"],
  "lightpost": ["00077000", "00011000", "000cb000", "000cb000", "000fc000", "000cb000", "000fc000", "00fccc00"],
  "barrel": ["0dd55555", "00bbbbb0", "0dd55555", "00bbbcb0", "00d55b50", "00d55550", "00555550", "0dd55555"],
  Tech: ["ffffffff", "fccccccf", "fcbbbbcf", "fcb11bcf", "fcbbbbcf", "fcb11bcf", "fcbbbbcf", "fccccccf"],
  Arch: ["..ffff..", ".fccccf.", "fcbbbbcf", "fcbbbbcf", "fcb11bcf", "fcbbbbcf", "fcbbbbcf", "fcbbbbcf"],
  Tri: ["...ff...", "...cc...", "..fccf..", "..fbbf..", ".fcbbcf.", ".fbbbbf.", "fcbbbbcf", "ffffffff"],
  Crack: ["...f....", "...f....", "..f.....", "..ff....", "...f....", "....f...", "...f....", "..f....."],
};
/** @deprecated Use PICKUP_TYPES */
export const BACKPACK_TYPES = PICKUP_TYPES;

export const ITEM_MESH_KEYS = PICKUP_TYPES;
export const DOOR_TYPES = ["Tech", "Arch", "Tri", "Crack"];
export const DOOR_MESH_KEYS = DOOR_TYPES;
export const ALL_MESH_KEYS = [...ITEM_MESH_KEYS, ...DOOR_MESH_KEYS];

/**
 * User-defined items. TH 0..18 are the built-ins above (fixed by the asm);
 * customItems get TH 19.. in order. Module registry so doc-less clamps
 * (clampPickupType) accept custom names; the doc owns the list and calls
 * setCustomItemNames on load / edit / undo.
 */
export const BUILTIN_ITEM_COUNT = PICKUP_TYPES.length;
export const ITEM_NAME_MAX = 24;
export const ITEM_PAGES_MAX = 2;
/** Offsets into a page blob are one byte. */
export const ITEM_PAGE_OFFSET_MAX = 255;
let customItemList = [];

export function setCustomItemNames(list) {
  customItemList = Array.isArray(list) ? [...list] : [];
}

export function customItemNames() {
  return customItemList;
}

/** Items in TH order: built-ins, then custom. */
export function itemKeys() {
  return [...PICKUP_TYPES, ...customItemList];
}

/** Every key with a mesh slot: items then doors. */
export function allMeshKeys() {
  return [...itemKeys(), ...DOOR_MESH_KEYS];
}

export function isCustomItem(key) {
  return customItemList.includes(key);
}

/**
 * Door types. Any item can be flagged door (doc.itemMeta[key].door); the item key is the door
 * type, its mesh the door face. The four shipped doors always are. Module registry so doc-less
 * clamps (clampDoorType) know the set.
 */
let doorKeySet = new Set(DOOR_MESH_KEYS);

export function setItemDoors(metaMap) {
  doorKeySet = new Set(DOOR_MESH_KEYS);
  if (!metaMap || typeof metaMap !== "object") return;
  for (const key of itemKeys()) if (metaMap[key]?.door === true) doorKeySet.add(key);
}

export function isDoorItem(key) {
  return doorKeySet.has(key);
}

/** Door types in cook order: the shipped four, then flagged items. */
export function doorTypes() {
  return [...DOOR_MESH_KEYS, ...itemKeys().filter((k) => doorKeySet.has(k))];
}

/** Items the Things palette places as pickups/props (doors are placed as doorways). */
export function placeableItemKeys() {
  return itemKeys().filter((k) => !doorKeySet.has(k));
}

/** Rebuild every doc-less registry (labels, doors) from doc.itemMeta. */
export function syncItemRegistry(metaMap) {
  setItemLabels(metaMap);
  setItemDoors(metaMap);
}

/**
 * Display names. Every item and door has a free name; the key stays internal (map JSON, TH
 * slots, mesh tables). Custom items are their own key. Built-ins fall back to the shipped
 * in-game text (stimpack, medikit) and carry an override in doc.itemMeta[key].label.
 * Module registry like customItemList so doc-less labels (objectLabel) work.
 */
const DEFAULT_ITEM_LABEL = { "small health": "stimpack", "large health": "medikit" };
let itemLabelOverrides = {};

export function defaultItemLabel(key) {
  return DEFAULT_ITEM_LABEL[key] ?? key;
}

export function itemLabel(key) {
  if (customItemList.includes(key)) return key;
  return itemLabelOverrides[key] ?? defaultItemLabel(key);
}

/** Rebuild the label registry from doc.itemMeta. */
export function setItemLabels(metaMap) {
  itemLabelOverrides = {};
  if (!metaMap || typeof metaMap !== "object") return;
  for (const key of [...PICKUP_TYPES, ...DOOR_MESH_KEYS]) {
    const l = clampItemName(metaMap[key]?.label);
    if (l && l !== defaultItemLabel(key)) itemLabelOverrides[key] = l;
  }
}

/** Name cleanup for a user item. "" when nothing usable is left. */
export function clampItemName(s) {
  const t = String(s ?? "")
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ITEM_NAME_MAX)
    .trim();
  return t;
}

/** Reason a name cannot be used for a new/renamed custom item, or "". */
export function itemNameProblem(name, except = null) {
  if (!name) return "Name is empty";
  const low = name.toLowerCase();
  if (["__proto__", "constructor", "prototype"].includes(low)) return "Reserved name";
  const others = allMeshKeys().filter((k) => k !== except);
  if (others.some((k) => itemLabel(k).toLowerCase() === low)) return `"${name}" is already an item`;
  // Internal keys stay claimed even when their item has been renamed.
  if (others.some((k) => k.toLowerCase() === low)) return `"${name}" is reserved`;
  if ((except == null || isCustomItem(except)) && PICKUP_ALIAS_NAMES.includes(low)) {
    return `"${name}" is a reserved alias`;
  }
  return "";
}

/** Built-in flags. Lightpost / barrel are still props. */
export function builtinItemMeta(key) {
  if (DOOR_MESH_KEYS.includes(key)) {
    return { rotating: false, pickup: false, door: true, icon: BUILTIN_ITEM_ICONS[key] ?? null };
  }
  const prop = key === "lightpost" || key === "barrel";
  return { rotating: !prop, pickup: !prop, door: false, icon: BUILTIN_ITEM_ICONS[key] ?? null };
}

/** Colodore. Same palette the shipped thingicons were drawn in. */
export const C64_HEX = [
  "#000000",
  "#ffffff",
  "#813338",
  "#75cec8",
  "#8e3c97",
  "#56ac4d",
  "#40318d",
  "#bfce72",
  "#8e5029",
  "#574200",
  "#c46c71",
  "#4a4a4a",
  "#7b7b7b",
  "#a9ff9f",
  "#706deb",
  "#b2b2b2",
];
export const ITEM_ICON_SIZE = 8;

export function emptyItemIcon() {
  return Array.from({ length: ITEM_ICON_SIZE }, () => ".".repeat(ITEM_ICON_SIZE));
}

/** 8 strings of 8 chars, 0-f = C64 colour, . = transparent. null when blank/invalid. */
export function parseItemIcon(raw) {
  if (!Array.isArray(raw)) return null;
  const rows = [];
  let any = false;
  for (let y = 0; y < ITEM_ICON_SIZE; y++) {
    const src = String(raw[y] ?? "").toLowerCase();
    let row = "";
    for (let x = 0; x < ITEM_ICON_SIZE; x++) {
      const c = src[x];
      if (c && /[0-9a-f]/.test(c)) {
        row += c;
        any = true;
      } else row += ".";
    }
    rows.push(row);
  }
  return any ? rows : null;
}

function baseItemMeta(key) {
  return isCustomItem(key)
    ? { rotating: true, pickup: false, door: false, icon: null, label: key }
    : { ...builtinItemMeta(key), label: defaultItemLabel(key) };
}

/** Shipped defaults for a key (what "reset" returns to). */
export function defaultItemMeta(key) {
  return baseItemMeta(key);
}

/** Effective flags for a key: built-in defaults / custom defaults, then doc overrides. */
export function itemMeta(doc, key) {
  const base = baseItemMeta(key);
  const o = doc?.itemMeta?.[key];
  if (!o || typeof o !== "object") return base;
  const door = DOOR_MESH_KEYS.includes(key) ? true : o.door == null ? base.door : !!o.door;
  return {
    // A door is a static face: it never spins and is never a pickup.
    rotating: door ? false : o.rotating == null ? base.rotating : !!o.rotating,
    pickup: door ? false : isCustomItem(key) ? (o.pickup == null ? base.pickup : !!o.pickup) : base.pickup,
    door,
    icon: parseItemIcon(o.icon) ?? base.icon,
    label: isCustomItem(key) ? key : clampItemName(o.label) || base.label,
  };
}

/** Write one key's meta, creating doc.itemMeta as needed. */
export function setItemMeta(doc, key, patch) {
  if (!doc.itemMeta) doc.itemMeta = {};
  const cur = itemMeta(doc, key);
  const next = { ...cur, ...patch };
  const icon = parseItemIcon(next.icon);
  const shipped = baseItemMeta(key).icon;
  const same = icon && shipped && icon.join("|") === shipped.join("|");
  const label = isCustomItem(key) ? "" : clampItemName(next.label);
  const door = DOOR_MESH_KEYS.includes(key) ? true : !!next.door;
  doc.itemMeta[key] = {
    rotating: door ? false : !!next.rotating,
    pickup: door ? false : !!next.pickup,
    ...(door !== baseItemMeta(key).door ? { door } : {}),
    ...(icon && !same ? { icon } : {}),
    ...(label && label !== defaultItemLabel(key) ? { label } : {}),
  };
  syncItemRegistry(doc.itemMeta);
}

export function parseItemMetaMap(raw, customList) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  const fixed = [...PICKUP_TYPES, ...DOOR_MESH_KEYS];
  const valid = new Set([...fixed, ...customList]);
  for (const key of Object.keys(raw)) {
    if (!valid.has(key)) continue;
    const o = raw[key];
    if (!o || typeof o !== "object") continue;
    const custom = customList.includes(key);
    const base = custom ? { rotating: true, pickup: false, door: false } : builtinItemMeta(key);
    const icon = parseItemIcon(o.icon);
    const label = custom ? "" : clampItemName(o.label);
    const door = DOOR_MESH_KEYS.includes(key) ? true : o.door == null ? base.door : o.door === true;
    out[key] = {
      rotating: door ? false : o.rotating == null ? base.rotating : !!o.rotating,
      pickup: door ? false : custom ? !!o.pickup : base.pickup,
      ...(door !== base.door ? { door } : {}),
      ...(icon ? { icon } : {}),
      ...(label && label !== defaultItemLabel(key) ? { label } : {}),
    };
  }
  // Drop label overrides that collide with another item's name.
  const taken = new Set(customList.map((k) => k.toLowerCase()));
  for (const k of fixed) if (!out[k]?.label) taken.add(defaultItemLabel(k).toLowerCase());
  for (const k of fixed) {
    const l = out[k]?.label;
    if (!l) continue;
    if (taken.has(l.toLowerCase())) delete out[k].label;
    else taken.add(l.toLowerCase());
  }
  return out;
}

export function parseCustomItems(raw) {
  const out = [];
  if (!Array.isArray(raw)) return out;
  const seen = new Set([...PICKUP_TYPES, ...DOOR_MESH_KEYS].map((k) => k.toLowerCase()));
  for (const src of raw) {
    const name = clampItemName(src);
    if (!name) continue;
    const low = name.toLowerCase();
    if (seen.has(low) || ["__proto__", "constructor", "prototype"].includes(low)) continue;
    if (PICKUP_ALIAS_NAMES.includes(low)) continue;
    seen.add(low);
    out.push(name);
  }
  return out;
}

/** Items-tab floor/cube and paste-nudge window. Not a coord cap. */
export const ITEM_MIN = -4;
export const ITEM_MAX = 4;
/** Quarter-unit locals. Packed byte is round(v*4), still −128..127. */
export const ITEM_POS_Q = 4;
export const ITEM_COORD_MIN = -128 / ITEM_POS_Q;
export const ITEM_COORD_MAX = 127 / ITEM_POS_Q;
export const ITEM_ORIGIN = 0;
/** Editor 0 sits at the centre of the 2×2 pickup footprint. */
export const ITEM_WORLD_BIAS = 1;
export const ITEM_MAX_VERTS = 16;
export const ITEM_MAX_LINES = 16;
export const ITEM_MAX_UNIQUE = 6;

export const DOOR_LOCKS = ["unlocked", "yellow", "blue", "red", "remote"];
export const DOOR_LOCK_LABELS = {
  unlocked: "Unlocked",
  yellow: "Yellow keycard",
  blue: "Blue keycard",
  red: "Red keycard",
  remote: "Remote",
};
/** Discrete AABB scales of the 4×5×1 doorway. Thickness stays 1. */
export const DOOR_SCALES = [1, 1.5, 2];
export const DOOR_SCALE_LABELS = { 1: "1.0", 1.5: "1.5", 2: "2.0" };

/** Height / base-side = φ. Fixed backpack: 1.5 tall. */
export const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
export const BACKPACK_HEIGHT = 1.5;
export const BACKPACK_SIDE = BACKPACK_HEIGHT / GOLDEN_RATIO;
export const BACKPACK_DEPTH = (BACKPACK_SIDE * Math.sqrt(3)) / 2;

const PICKUP_ALIAS = {
  "health 25%": "small health",
  "health 50%": "large health",
  armour: "green armor",
  armor: "green armor",
  "quad damage": "radsuit",
  "pentagram of protection": "soulsphere",
  "ring of shadows": "radsuit",
  "silver key": "yellow keycard",
  "gold key": "blue keycard",
  "rune of earth magic": "red keycard",
};

const PICKUP_ALIAS_NAMES = Object.keys(PICKUP_ALIAS);

export function clampPickupType(s) {
  const n = PICKUP_ALIAS[s] || s;
  if (PICKUP_TYPES.includes(n) || customItemList.includes(n)) return n;
  return "shells";
}

/** @deprecated Use clampPickupType */
export function clampBackpackType(s) {
  return clampPickupType(s);
}

export function clampDoorLock(s) {
  if (s === "silver" || s === "yellow") return "yellow";
  if (s === "gold" || s === "blue") return "blue";
  if (s === "red") return "red";
  if (s === "remote") return "remote";
  return "unlocked";
}

export function clampDoorType(s) {
  const t = String(s ?? "");
  if (doorKeySet.has(t)) return t;
  const lower = t.toLowerCase();
  if (lower === "tech") return "Tech";
  if (lower === "arch") return "Arch";
  if (lower === "tri") return "Tri";
  if (lower === "crack") return "Crack";
  return "Tech";
}

export function clampDoorScale(s) {
  const n = Number(s);
  if (n === 2) return 2;
  if (n === 1.5) return 1.5;
  return 1;
}

/** Width × height × thickness for a doorway scale (1 / 1.5 / 2). */
export function doorSizeForScale(scale) {
  const s = clampDoorScale(scale);
  if (s === 2) return [8, 10, 1];
  if (s === 1.5) return [6, 8, 1];
  return [4, 5, 1];
}

/** True for a door type (flagged item or shipped door), incl. the old lowercase spellings. */
export function isDoorMeshKey(key) {
  const t = String(key ?? "");
  return doorKeySet.has(t) || t === "tech" || t === "arch" || t === "tri" || t === "crack";
}

export function clampItemCoord(n) {
  const q = Math.round(Number(n) * ITEM_POS_Q) / ITEM_POS_Q;
  if (q < ITEM_COORD_MIN) return ITEM_COORD_MIN;
  if (q > ITEM_COORD_MAX) return ITEM_COORD_MAX;
  return q;
}

export function emptyItemMesh() {
  return { verts: [], lines: [] };
}

function v3(x, y, z) {
  return { x, y, z };
}

function meshOf(verts, lines) {
  return { verts: verts.map((p) => v3(p[0], p[1], p[2])), lines: lines.map((p) => [p[0], p[1]]) };
}

/** Seeded meshes that obey 6 unique X / 6 unique Z. Empty types fall back to backpack. */
export function defaultItemMeshes() {
  return {
    backpack: meshOf(
      [
        [-1, 0, -1],
        [1, 0, -1],
        [0, 0, 1],
        [0, 2, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 0],
        [3, 0],
        [3, 1],
        [3, 2],
      ]
    ),
    "small health": meshOf(
      [
        [0, 2, 0],
        [-1, 1, 0],
        [0, 1, 1],
        [1, 1, 0],
        [0, 1, -1],
        [0, 0, 0],
      ],
      [
        [4, 5],
        [3, 5],
        [1, 5],
        [2, 5],
        [1, 4],
        [1, 2],
        [2, 3],
        [3, 4],
        [0, 1],
        [0, 2],
        [0, 4],
        [0, 3],
      ]
    ),
    "large health": meshOf(
      [
        [0, 4, 0],
        [-2, 2, 0],
        [0, 2, 2],
        [2, 2, 0],
        [0, 2, -2],
        [0, 0, 0],
      ],
      [
        [4, 5],
        [3, 5],
        [1, 5],
        [2, 5],
        [1, 4],
        [1, 2],
        [2, 3],
        [3, 4],
        [0, 1],
        [0, 2],
        [0, 4],
        [0, 3],
      ]
    ),
    "green armor": meshOf(
      [
        [-1, 0, -1],
        [1, 0, -1],
        [1, 0, 1],
        [-1, 0, 1],
        [0, 3, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [4, 0],
        [4, 1],
        [4, 2],
        [4, 3],
      ]
    ),
    "soulsphere": meshOf(
      [
        [0, 0, -2],
        [2, 0, 0],
        [0, 0, 2],
        [-2, 0, 0],
        [0, 4, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [4, 0],
        [4, 1],
        [4, 2],
        [4, 3],
      ]
    ),
    "radsuit": meshOf(
      [
        [-2, 2, 0],
        [-1, 1, 0],
        [1, 1, 0],
        [2, 2, 0],
        [1, 4, 0],
        [-1, 4, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 5],
        [5, 0],
      ]
    ),
    "yellow keycard": meshOf(
      [
        [-2, 1, 0],
        [-2, 2, 0],
        [-1, 2, 0],
        [-1, 1, 0],
        [2, 1, 0],
        [2, 0, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [3, 4],
        [4, 5],
      ]
    ),
    "blue keycard": meshOf(
      [
        [-2, 1, 0],
        [-2, 3, 0],
        [-1, 3, 0],
        [-1, 1, 0],
        [2, 1, 0],
        [2, 2, 0],
        [2, 0, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [3, 4],
        [4, 5],
        [4, 6],
      ]
    ),
    "red keycard": meshOf(
      [
        [0, 0, 0],
        [-2, 1, 0],
        [-2, 3, 0],
        [0, 4, 0],
        [2, 3, 0],
        [2, 1, 0],
        [0, 2, 0],
        [-1, 1, 0],
        [1, 1, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 5],
        [5, 0],
        [3, 6],
        [6, 0],
        [6, 7],
        [6, 8],
      ]
    ),
    "blue armor": meshOf(
      [
        [-1, 0, -1],
        [1, 0, -1],
        [1, 0, 1],
        [-1, 0, 1],
        [0, 4, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [4, 0],
        [4, 1],
        [4, 2],
        [4, 3],
      ]
    ),
    "ammo box": meshOf(
      [
        [-1, 0, -1],
        [1, 0, -1],
        [1, 1, -1],
        [-1, 1, -1],
        [0, 0, 1],
        [0, 1, 1],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [0, 4],
        [1, 4],
        [3, 5],
        [2, 5],
        [4, 5],
      ]
    ),
    shells: meshOf(
      [
        [-1, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [-1, 1, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ]
    ),
    "box of rockets": meshOf(
      [
        [-1, 0, 0],
        [1, 0, 0],
        [0, 2, 0],
        [0, 1, 1],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 0],
        [0, 3],
        [1, 3],
        [2, 3],
      ]
    ),
    shotgun: meshOf(
      [
        [-2, 1, 0],
        [2, 1, 0],
        [1, 0, 0],
        [0, 2, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 0],
        [0, 3],
        [1, 3],
      ]
    ),
    chaingun: meshOf(
      [
        [-2, 1, 0],
        [2, 1, 0],
        [1, 0, 0],
        [0, 2, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 0],
        [0, 3],
        [1, 3],
      ]
    ),
    chainsaw: meshOf(
      [
        [0, 0, 0],
        [0, 3, 0],
        [-1, 3, 0],
        [1, 3, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [1, 3],
      ]
    ),
    "rocket launcher": meshOf(
      [
        [-1, 0, 0],
        [1, 0, 0],
        [1, 2, 0],
        [-1, 2, 0],
        [0, 3, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [2, 4],
        [3, 4],
      ]
    ),
    lightpost: meshOf(
      [
        [0, 0, 0],
        [0, 4, 0],
        [-1, 4, 0],
        [1, 4, 0],
        [0, 4, -1],
        [0, 4, 1],
      ],
      [
        [0, 1],
        [2, 3],
        [4, 5],
      ]
    ),
    barrel: meshOf(
      [
        [-1, 0, 0],
        [1, 0, 0],
        [1, 2, 0],
        [-1, 2, 0],
        [0, 0, 1],
        [0, 2, 1],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [0, 4],
        [1, 4],
        [3, 5],
        [2, 5],
        [4, 5],
      ]
    ),
    Tech: meshOf(
      [
        [-2, 0, 0],
        [2, 0, 0],
        [2, 5, 0],
        [-2, 5, 0],
        [-2, 2, 0],
        [2, 2, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [4, 5],
      ]
    ),
    Arch: meshOf(
      [
        [-2, 0, 0],
        [2, 0, 0],
        [2, 4, 0],
        [0, 5, 0],
        [-2, 4, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 0],
      ]
    ),
    Tri: meshOf(
      [
        [-2, 0, 0],
        [2, 0, 0],
        [0, 5, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 0],
      ]
    ),
    Crack: meshOf(
      [
        [-2, 0, 0],
        [-2, 4, 0],
        [-1, 2, 0],
        [0, 5, 0],
        [1, 2, 0],
        [2, 4, 0],
        [2, 0, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 5],
        [5, 6],
      ]
    ),
  };
}

function parseItemVert(v) {
  if (Array.isArray(v) && v.length >= 3) return { x: clampItemCoord(v[0]), y: clampItemCoord(v[1]), z: clampItemCoord(v[2]) };
  if (v && typeof v === "object") return { x: clampItemCoord(v.x), y: clampItemCoord(v.y), z: clampItemCoord(v.z) };
  return null;
}

export function parseItemMesh(raw) {
  if (!raw || typeof raw !== "object") return emptyItemMesh();
  const verts = [];
  const seen = new Set();
  for (const src of raw.verts || []) {
    const v = parseItemVert(src);
    if (!v) continue;
    const k = `${v.x},${v.y},${v.z}`;
    if (seen.has(k) || verts.length >= ITEM_MAX_VERTS) continue;
    seen.add(k);
    verts.push(v);
  }
  const lines = [];
  const lineSeen = new Set();
  for (const src of raw.lines || []) {
    const a = src?.[0] | 0;
    const b = src?.[1] | 0;
    if (a === b || a < 0 || b < 0 || a >= verts.length || b >= verts.length) continue;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const k = `${lo}-${hi}`;
    if (lineSeen.has(k) || lines.length >= ITEM_MAX_LINES) continue;
    lineSeen.add(k);
    lines.push([lo, hi]);
  }
  return { verts, lines };
}

export function parseItemMeshes(raw) {
  const d = defaultItemMeshes();
  if (!raw || typeof raw !== "object") return d;
  const src = { ...raw };
  const meshAlias = {
    "health 25%": "small health",
    "silver key": "yellow keycard",
    "gold key": "blue keycard",
    "rune of earth magic": "red keycard",
    "pentagram of protection": "soulsphere",
    "ring of shadows": "radsuit",
  };
  for (const [oldKey, newKey] of Object.entries(meshAlias)) {
    if (src[oldKey] != null && src[newKey] == null) src[newKey] = src[oldKey];
  }
  if (src.chaingun != null && src.shotgun == null) src.shotgun = src.chaingun;
  if (src["green armor"] != null && src["blue armor"] == null) src["blue armor"] = src["green armor"];
  if (src.tech != null && src.Tech == null) src.Tech = src.tech;
  if (src.arch != null && src.Arch == null) src.Arch = src.arch;
  if (src.tri != null && src.Tri == null) src.Tri = src.tri;
  if (src.crack != null && src.Crack == null) src.Crack = src.crack;
  for (const key of allMeshKeys()) {
    if (!Object.hasOwn(src, key) || src[key] == null) {
      if (isCustomItem(key)) d[key] = emptyItemMesh();
      continue;
    }
    const mesh = parseItemMesh(src[key]);
    if (!mesh.verts.length && (key === "backpack" || DOOR_MESH_KEYS.includes(key))) continue;
    d[key] = mesh;
  }
  return d;
}

function vertsMatch(verts, pts) {
  if (!verts || verts.length !== pts.length) return false;
  return pts.every((p, i) => verts[i].x === p[0] && verts[i].y === p[1] && verts[i].z === p[2]);
}

/** v8 stored 0..7 with origin at 4. Shift X/Z so origin is 0. */
export function migrateItemMeshes(rawItems, fromVersion) {
  if (fromVersion >= 9 || !rawItems || typeof rawItems !== "object") return rawItems;
  const out = { ...rawItems };
  for (const key of Object.keys(out)) {
    const mesh = out[key];
    if (!mesh || typeof mesh !== "object") continue;
    const verts = (mesh.verts || []).map((src) => {
      let x = 0;
      let y = 0;
      let z = 0;
      if (Array.isArray(src) && src.length >= 3) {
        x = src[0] | 0;
        y = src[1] | 0;
        z = src[2] | 0;
      } else if (src && typeof src === "object") {
        x = src.x | 0;
        y = src.y | 0;
        z = src.z | 0;
      }
      return { x: clampItemCoord(x - 4), y: clampItemCoord(y), z: clampItemCoord(z - 4) };
    });
    out[key] = { ...mesh, verts };
  }
  const bp = out.backpack;
  if (bp && vertsMatch(bp.verts, [
    [0, 0, 0],
    [2, 0, 0],
    [1, 0, 2],
    [1, 2, 1],
  ])) {
    out.backpack = defaultItemMeshes().backpack;
  }
  return out;
}

export function itemMeshHasGeom(mesh) {
  return !!(mesh && mesh.verts?.length && mesh.lines?.length);
}

export function itemMeshFor(doc, type) {
  const items = doc?.items || defaultItemMeshes();
  if (type === "backpack") {
    const mesh = items.backpack;
    if (itemMeshHasGeom(mesh)) return mesh;
    return defaultItemMeshes().backpack;
  }
  if (isDoorMeshKey(type)) {
    const key = clampDoorType(type);
    const mesh = items[key];
    if (itemMeshHasGeom(mesh)) return mesh;
    return items.Tech || defaultItemMeshes().Tech;
  }
  const key = clampPickupType(type);
  const mesh = items[key];
  if (itemMeshHasGeom(mesh)) return mesh;
  return items.backpack || defaultItemMeshes().backpack;
}

export function itemUniqueXZ(verts) {
  const xs = new Set();
  const zs = new Set();
  for (const v of verts || []) {
    xs.add(Math.round(v.x * ITEM_POS_Q));
    zs.add(Math.round(v.z * ITEM_POS_Q));
  }
  return { nx: xs.size, nz: zs.size, xs, zs };
}

export function itemMeshStats(mesh) {
  const verts = mesh?.verts || [];
  const lines = mesh?.lines || [];
  const { nx, nz } = itemUniqueXZ(verts);
  const nv = verts.length;
  const ne = lines.length;
  return {
    nv,
    ne,
    nx,
    nz,
    bytes: nx + nz + nv * 4 + ne * 2,
    over: nx > ITEM_MAX_UNIQUE || nz > ITEM_MAX_UNIQUE || nv > ITEM_MAX_VERTS || ne > ITEM_MAX_LINES,
  };
}

export const ITEM_TABLE_MAX = 256;

/**
 * Mesh blob paging, mirrors tools/genitems.py. Slots in order (built-ins, custom,
 * doors) are packed first-fit into pages. A mesh fits a page while every start
 * offset it would get (verts, edges, unique X, unique Z so far) is still <= 255.
 * @returns {{ pages: {nv:number,ne:number,nx:number,nz:number}[], pageOf: Record<string, number>, over: boolean }}
 */
export function itemPagePlan(doc) {
  const items = doc?.items || {};
  const defaults = defaultItemMeshes();
  const pages = [];
  const pageOf = {};
  for (const key of allMeshKeys()) {
    let mesh = items[key];
    if (DOOR_MESH_KEYS.includes(key)) mesh = itemMeshHasGeom(mesh) ? mesh : defaults[key];
    if (!itemMeshHasGeom(mesh)) {
      pageOf[key] = 0;
      continue;
    }
    const st = itemMeshStats(mesh);
    let p = pages.findIndex(
      (pg) =>
        pg.nv <= ITEM_PAGE_OFFSET_MAX &&
        pg.ne <= ITEM_PAGE_OFFSET_MAX &&
        pg.nx <= ITEM_PAGE_OFFSET_MAX &&
        pg.nz <= ITEM_PAGE_OFFSET_MAX
    );
    if (p < 0) {
      pages.push({ nv: 0, ne: 0, nx: 0, nz: 0 });
      p = pages.length - 1;
    }
    pages[p].nv += st.nv;
    pages[p].ne += st.ne;
    pages[p].nx += st.nx;
    pages[p].nz += st.nz;
    pageOf[key] = p;
  }
  if (!pages.length) pages.push({ nv: 0, ne: 0, nx: 0, nz: 0 });
  return { pages, pageOf, over: pages.length > ITEM_PAGES_MAX };
}

/** Rotation period of spinning items, ms. Game: ~1 rev / 4 s. */
export const ITEM_SPIN_PERIOD_MS = 4000;

/** Shared spin angle (radians) for every rotating item in every editor view. */
export function itemSpinAngle(nowMs = performance.now()) {
  return ((nowMs % ITEM_SPIN_PERIOD_MS) / ITEM_SPIN_PERIOD_MS) * Math.PI * 2;
}

/**
 * Yaw to draw this placed item at: spin when its type rotates, else the placed facing
 * (`rot`, 0..7 octants, 0 = +Z; same convention as enemy rot and the game's th_ori bits 0-2).
 */
export function itemYawFor(doc, type, rot = 0) {
  if (itemMeta(doc, clampPickupType(type)).rotating) return itemSpinAngle();
  return (clampEnemyRot(rot) * Math.PI) / 4;
}

/** True when the placed item holds a fixed facing (its type does not spin). */
export function itemHoldsFacing(doc, type) {
  return !itemMeta(doc, clampPickupType(type)).rotating;
}

/** Placed-item scales: a left shift of 0..3 in the game (cube.asm / item_xf.asm). */
export const ITEM_SCALES = [1, 2, 4, 8];

export function clampItemScale(n) {
  const v = Number(n);
  return ITEM_SCALES.includes(v) ? v : 1;
}

/** 8.8 world coords wrap past +-128: scaled verts must stay within 127/scale of the item origin. */
export function itemScaleMax(scale) {
  return 127 / clampItemScale(scale);
}

/** True when mesh * scale stays inside the game's 8.8 range (XZ radius and |y|). */
export function itemScaleFits(mesh, scale) {
  const max = itemScaleMax(scale);
  for (const v of mesh?.verts || []) {
    if (Math.hypot(Number(v.x), Number(v.z)) > max) return false;
    if (Math.abs(Number(v.y)) > max) return false;
  }
  return true;
}

/** True when any pickup object in the list uses a rotating item. */
export function anyRotatingItem(doc, objs) {
  for (const o of objs || []) {
    if (o.kind === "pickup" && itemMeta(doc, clampPickupType(o.pickup)).rotating) return true;
  }
  return false;
}

export function itemMeshWorldSegs(obj, mesh, yaw = 0) {
  const m = mesh && itemMeshHasGeom(mesh) ? mesh : defaultItemMeshes().backpack;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const k = clampItemScale(obj.scale ?? (obj.big ? 8 : 1));
  const verts = m.verts.map((v) => {
    const lx = Number(v.x) * k;
    const lz = Number(v.z) * k;
    return {
      x: obj.x + (lx * c + lz * s) + ITEM_WORLD_BIAS,
      y: obj.y + Number(v.y) * k,
      z: obj.z + (-lx * s + lz * c) + ITEM_WORLD_BIAS,
    };
  });
  const segs = [];
  for (const [a, b] of m.lines) {
    if (verts[a] && verts[b]) segs.push({ a: verts[a], b: verts[b] });
  }
  return segs;
}

/** Fixed equilateral tetra: height 1.5, base side = height/φ. */
export function applyBackpackProportions(obj) {
  obj.sx = BACKPACK_SIDE;
  obj.sy = BACKPACK_HEIGHT;
  obj.sz = BACKPACK_DEPTH;
  return obj;
}

export const LEVEL_NAMES = ["E1M1", "E1M2", "E1M3", "E1M4", "E1M5", "E1M6", "E1M7", "E1M8"];

export function clipForFrame(clips, index) {
  const list = Array.isArray(clips) ? clips : [];
  const i = index | 0;
  return list.find((c) => i >= c.start && i < c.start + c.len) || list[0] || null;
}

export function normalizeExportClips(raw) {
  if (!Array.isArray(raw)) return undefined;
  const out = [];
  const seen = new Set();
  for (const n of raw) {
    const name = String(n ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Optional melee/shoot cue + clip-local frame. Anything else is omitted. */
export function normalizeClipSound(raw, len) {
  const n = Math.max(1, len | 0);
  const cue = String(raw?.sound || "").trim().toLowerCase();
  if (!ENEMY_ATTACK_CUES.includes(cue)) return {};
  return { sound: cue, soundFrame: Math.max(0, Math.min(raw.soundFrame | 0, n - 1)) };
}

/** Present attackFrame clamped to 0..len-1. Missing stays missing. */
export function clampAttackFrame(raw, len) {
  const n = Math.max(1, len | 0);
  if (raw == null || raw === "") return null;
  let frame = Number(raw);
  if (!Number.isFinite(frame)) return null;
  frame = frame | 0;
  if (frame < 0) frame = 0;
  if (frame > n - 1) frame = n - 1;
  return frame;
}

/** Missing attackFrame is clip-local frame 1, then clamped. */
export function attackFrameOrDefault(raw, len) {
  const set = clampAttackFrame(raw, len);
  if (set != null) return set;
  return clampAttackFrame(1, len);
}

export function withClipSound(clip, src) {
  const from = src || clip;
  const extra = normalizeClipSound(from, clip.len);
  const out = { name: clip.name, start: clip.start, len: clip.len, ...extra };
  const attackRaw = from.attackFrame != null ? from.attackFrame : clip.attackFrame;
  const attackFrame = clampAttackFrame(attackRaw, clip.len);
  if (attackFrame != null) out.attackFrame = attackFrame;
  return out;
}

export function normalizeClips(raw, frameCount) {
  const n = Math.max(0, frameCount | 0);
  if (!n || !Array.isArray(raw) || !raw.length) return [];
  const out = [];
  for (const c of raw) {
    const name = String(c?.name || "clip");
    if (name === "legacy") continue;
    const start = Math.max(0, c.start | 0);
    const len = Math.max(1, c.len | 0);
    if (start >= n) continue;
    out.push(withClipSound({ name, start, len: Math.min(len, n - start) }, c));
  }
  return out;
}

/**
 * Placeable types. Index is the game type id (ENT_*).
 * hp is the default game byte (Doom health / 5). Edited values live on the
 * enemy record; lists sort by that.
 */
export const ENEMY_TYPES = [
  { name: "Possessed", hp: 4, scale: [1, 1, 1], rest: { 12: [0, 1, 8] } },
  {
    name: "Baron",
    hp: 200,
    scale: [1.5, 1.45, 1.2],
    rest: {
      4: [-2, -2, 0],
      5: [-3, -6, 1],
      6: [2, -2, 0],
      7: [3, -6, 1],
      12: [4, -8, 5],
    },
  },
  {
    name: "Pinky",
    hp: 30,
    scale: [1.35, 1.15, 1.25],
    rest: { 3: [0, 2, 2], 12: [4, -2, 8] },
  },
  {
    name: "Imp",
    hp: 12,
    scale: [0.9, 0.85, 0.9],
    rest: { 12: [0, 1, 8] },
  },
];

/** Flinch when rnd8 is below this. Imp, pinky, and baron override. */
export const DEFAULT_ENEMY_PAIN_CHANCE = 0x80;
export const ENEMY_PAIN_CHANCE_BY_NAME = {
  Imp: 0xff,
  Pinky: 0xff,
  Baron: 0,
};

export function defaultEnemyHp(name) {
  const t = ENEMY_TYPES.find((e) => e.name === name);
  return t ? t.hp : 1;
}

export function defaultEnemyPainChance(name) {
  return ENEMY_PAIN_CHANCE_BY_NAME[name] ?? DEFAULT_ENEMY_PAIN_CHANCE;
}

/** Game byte written to enemy_hp_init. Missing or bad values fall back to the type default. */
export function clampEnemyHp(n, name) {
  const v = Number(n);
  if (!Number.isFinite(v)) return defaultEnemyHp(name);
  return Math.max(1, Math.min(255, v | 0));
}

/** Game byte written to enemy_pain_chance. 0 never flinches. Missing values use the type default. */
export function clampEnemyPainChance(n, name) {
  const v = Number(n);
  if (!Number.isFinite(v)) return defaultEnemyPainChance(name);
  return Math.max(0, Math.min(255, v | 0));
}

export const DEFAULT_ENEMY_BLOCK_R = GAME_ENEMY_BLOCK_R;
export const ENEMY_BLOCK_R_MAX = 3;

/** Game byte written to enemy_block_r: player-vs-enemy Chebyshev radius in cells. */
export function clampEnemyBlockR(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_ENEMY_BLOCK_R;
  return Math.max(0, Math.min(ENEMY_BLOCK_R_MAX, v | 0));
}

export function enemyHp(name, enemies) {
  const rec = (enemies || []).find((e) => e.name === name);
  if (rec) return clampEnemyHp(rec.hp, name);
  return defaultEnemyHp(name);
}

/** Placeable types, lowest HP first. */
export function enemyTypesByHp(enemies) {
  return [...ENEMY_TYPES].sort(
    (a, b) => enemyHp(a.name, enemies) - enemyHp(b.name, enemies) || a.name.localeCompare(b.name)
  );
}

/** Enemy records, lowest HP first. */
export function enemiesByHp(enemies) {
  return [...(enemies || [])].sort(
    (a, b) => enemyHp(a.name, enemies) - enemyHp(b.name, enemies) || String(a.name).localeCompare(String(b.name))
  );
}

export const FACES = [
  { id: "+z", axis: "z", sign: 1, label: "+Z" },
  { id: "-z", axis: "z", sign: -1, label: "-Z" },
  { id: "+x", axis: "x", sign: 1, label: "+X" },
  { id: "-x", axis: "x", sign: -1, label: "-X" },
];

export function clampByte(n) {
  return Math.max(WORLD_MIN, Math.min(WORLD_MAX, n | 0));
}

export function clampSize(origin, size) {
  const o = clampByte(origin);
  const s = Math.max(1, size | 0);
  return Math.min(s, WORLD_SIZE - o);
}

export function clampVert(n) {
  const v = n | 0;
  return Math.max(VERT_MIN, Math.min(VERT_MAX, v));
}

/** Sprite poses quantize to 1/4. Packed byte is round(v*4), still -128..127. */
export const SPRITE_POS_Q = 4;

export function clampSpriteVert(n) {
  const q = Math.round(Number(n) * SPRITE_POS_Q) / SPRITE_POS_Q;
  const max = VERT_MAX / SPRITE_POS_Q;
  const min = VERT_MIN / SPRITE_POS_Q;
  if (q < min) return min;
  if (q > max) return max;
  return q;
}

export function clampSkelVert(n) {
  const v = n | 0;
  return Math.max(-SKEL_VERT_MAX, Math.min(SKEL_VERT_MAX, v));
}

export function vertLimitFor(enemy) {
  if (enemyHasSprites(enemy)) return VERT_MAX / SPRITE_POS_Q;
  return enemy?.customSkeleton ? SKEL_VERT_MAX : VERT_MAX;
}

export function clampVertFor(enemy) {
  if (enemyHasSprites(enemy)) return clampSpriteVert;
  return enemy?.customSkeleton ? clampSkelVert : clampVert;
}

export function aabbEnd(box) {
  return {
    x: box.x + box.sx,
    y: box.y + box.sy,
    z: box.z + box.sz,
  };
}

/** Inclusive face-touch counts as overlap (shared portal wall). */
export function aabbOverlap(a, b) {
  return (
    a.x <= b.x + b.sx &&
    a.x + a.sx >= b.x &&
    a.y <= b.y + b.sy &&
    a.y + a.sy >= b.y &&
    a.z <= b.z + b.sz &&
    a.z + a.sz >= b.z
  );
}

/** Interior volume overlap only; face-touch is OK. */
export function aabbStrictOverlap(a, b) {
  return (
    a.x < b.x + b.sx &&
    a.x + a.sx > b.x &&
    a.y < b.y + b.sy &&
    a.y + a.sy > b.y &&
    a.z < b.z + b.sz &&
    a.z + a.sz > b.z
  );
}

/** +90° Y face map matching rot90({x:z,y:y,z:-x}). */
const FACE_Y_PLUS = { "+z": "+x", "+x": "-z", "-z": "-x", "-x": "+z" };

/** Rotate AABB footprint around pivot in XZ by delta quarter-turns (Y). */
export function rotateAabbYAround(obj, pivotX, pivotZ, delta) {
  const steps = ((delta | 0) % 4 + 4) % 4;
  for (let i = 0; i < steps; i++) {
    const sx = obj.sx | 0;
    const sz = obj.sz | 0;
    const ox = (obj.x | 0) + sx / 2;
    const oz = (obj.z | 0) + sz / 2;
    const dx = ox - pivotX;
    const dz = oz - pivotZ;
    obj.sx = sz;
    obj.sz = sx;
    obj.x = Math.round(pivotX + dz - obj.sx / 2);
    obj.z = Math.round(pivotZ - dx - obj.sz / 2);
  }
  return obj;
}

/** One +90° Y: (z,+1)→(x,+1)→(z,−1)→(x,−1). High end N→E→S→W. */
function rotateSlopeOrientY(obj, delta) {
  const steps = ((delta | 0) % 4 + 4) % 4;
  for (let i = 0; i < steps; i++) {
    if (obj.axis === "z" && obj.dir === 1) {
      obj.axis = "x";
      obj.dir = 1;
    } else if (obj.axis === "x" && obj.dir === 1) {
      obj.axis = "z";
      obj.dir = -1;
    } else if (obj.axis === "z" && obj.dir === -1) {
      obj.axis = "x";
      obj.dir = -1;
    } else {
      obj.axis = "z";
      obj.dir = 1;
    }
  }
  return obj;
}

/** Facing / slope / figure yaw for +delta Y quarter-turns. */
export function applyYawQuarterMeta(obj, delta) {
  if (!obj) return obj;
  const steps = ((delta | 0) % 4 + 4) % 4;
  if (!steps) return obj;
  if (obj.kind === "enemy" || obj.kind === "spawn" || obj.kind === "pickup") {
    obj.rot = clampEnemyRot((obj.rot | 0) + 2 * steps);
  }
  if (obj.kind === "doorway" || obj.kind === "switch") {
    for (let i = 0; i < steps; i++) {
      obj.face = FACE_Y_PLUS[obj.face] || "+z";
    }
  }
  if (obj.kind === "slope") rotateSlopeOrientY(obj, steps);
  return obj;
}

/** +90° Y: (x,z) → (pivotX+dz, pivotZ-dx), matching rotateAabbYAround. */
function yawPoint(x, z, pivotX, pivotZ, delta) {
  const steps = ((delta | 0) % 4 + 4) % 4;
  let px = x;
  let pz = z;
  for (let i = 0; i < steps; i++) {
    const dx = px - pivotX;
    const dz = pz - pivotZ;
    px = pivotX + dz;
    pz = pivotZ - dx;
  }
  return { x: px, z: pz };
}

/** Selected owner for a doorway: roomId if in the set, else otherRoomId. */
function doorAnchorRoomId(door, idSet) {
  const a = door.roomId != null ? String(door.roomId) : "";
  const b = door.otherRoomId != null ? String(door.otherRoomId) : "";
  if (idSet.has(a)) return a;
  if (idSet.has(b)) return b;
  return null;
}

/** Rigid Y rotate room AABB/orient and transform owned contents + doorways. */
export function rotateRoomY(doc, room, delta = 1) {
  if (!room || room.kind !== "room") return room;
  rotateRoomsBlockY(doc, [room.id], delta);
  return room;
}

function translatedRoomBox(room, dx, dz) {
  return {
    x: (room.x | 0) + dx,
    y: room.y | 0,
    z: (room.z | 0) + dz,
    sx: room.sx | 0,
    sy: room.sy | 0,
    sz: room.sz | 0,
  };
}

function blockFitsAt(rooms, outsiders, dx, dz) {
  for (const r of rooms) {
    const box = translatedRoomBox(r, dx, dz);
    if (box.x < WORLD_MIN || box.z < WORLD_MIN) return false;
    if (box.x + box.sx > WORLD_SIZE || box.z + box.sz > WORLD_SIZE) return false;
    if (box.y < WORLD_MIN || box.y + box.sy > WORLD_SIZE) return false;
    for (const o of outsiders) {
      if (aabbStrictOverlap(box, o)) return false;
    }
  }
  return true;
}

/** Smallest |dx|+|dz| translation (spiral) so rooms clear outsiders; face-touch OK. */
export function findFreeRoomTranslation(rooms, outsiders) {
  if (blockFitsAt(rooms, outsiders, 0, 0)) return { dx: 0, dz: 0 };
  const maxR = WORLD_SIZE;
  for (let rad = 1; rad < maxR; rad++) {
    for (let dx = -rad; dx <= rad; dx++) {
      for (const dz of [-rad, rad]) {
        if (blockFitsAt(rooms, outsiders, dx, dz)) return { dx, dz };
      }
    }
    for (let dz = -rad + 1; dz <= rad - 1; dz++) {
      for (const dx of [-rad, rad]) {
        if (blockFitsAt(rooms, outsiders, dx, dz)) return { dx, dz };
      }
    }
  }
  return { dx: 0, dz: 0 };
}

/**
 * World-Y rotate each selected room about its AABB center (contents + attached
 * doors), then translate so room centers orbit the union XZ pivot. Doors keep
 * IDs and yawed face (no re-pair). If the set overlaps outsiders, nudge it.
 */
export function rotateRoomsBlockY(doc, roomIds, delta = 1) {
  const d = delta | 0;
  if (!d) return;
  const idSet = new Set((roomIds || []).map(String));
  const rooms = roomsOf(doc).filter((r) => idSet.has(String(r.id)));
  if (!rooms.length) return;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const origCenter = new Map();
  for (const r of rooms) {
    const c = aabbCenter(r);
    origCenter.set(String(r.id), { x: c.x, z: c.z });
    minX = Math.min(minX, r.x | 0);
    maxX = Math.max(maxX, (r.x | 0) + (r.sx | 0));
    minZ = Math.min(minZ, r.z | 0);
    maxZ = Math.max(maxZ, (r.z | 0) + (r.sz | 0));
  }
  const pivotX = (minX + maxX) / 2;
  const pivotZ = (minZ + maxZ) / 2;

  const byRoom = new Map();
  const doors = [];
  for (const obj of activeMap(doc).objects) {
    if (obj.kind === "room") continue;
    if (obj.kind === "doorway") {
      const anchor = doorAnchorRoomId(obj, idSet);
      if (anchor) doors.push({ obj, anchor });
      continue;
    }
    if (obj.roomId != null && idSet.has(String(obj.roomId))) {
      const k = String(obj.roomId);
      if (!byRoom.has(k)) byRoom.set(k, []);
      byRoom.get(k).push(obj);
    }
  }

  for (const room of rooms) {
    const c = origCenter.get(String(room.id));
    rotateRoom(room, "y", d);
    for (const obj of byRoom.get(String(room.id)) || []) {
      rotateAabbYAround(obj, c.x, c.z, d);
      applyYawQuarterMeta(obj, d);
    }
  }
  for (const { obj, anchor } of doors) {
    const c = origCenter.get(anchor);
    rotateAabbYAround(obj, c.x, c.z, d);
    applyYawQuarterMeta(obj, d);
  }

  const shift = new Map();
  for (const room of rooms) {
    const orig = origCenter.get(String(room.id));
    const target = yawPoint(orig.x, orig.z, pivotX, pivotZ, d);
    const destX = Math.round(target.x - (room.sx | 0) / 2);
    const destZ = Math.round(target.z - (room.sz | 0) / 2);
    const dx = destX - (room.x | 0);
    const dz = destZ - (room.z | 0);
    shift.set(String(room.id), { dx, dz });
    if (dx || dz) {
      room.x = (room.x | 0) + dx;
      room.z = (room.z | 0) + dz;
      for (const obj of byRoom.get(String(room.id)) || []) {
        obj.x = (obj.x | 0) + dx;
        obj.z = (obj.z | 0) + dz;
      }
    }
  }
  for (const { obj, anchor } of doors) {
    const s = shift.get(anchor);
    if (s && (s.dx || s.dz)) {
      obj.x = (obj.x | 0) + s.dx;
      obj.z = (obj.z | 0) + s.dz;
    }
  }

  const moving = [...rooms];
  for (const list of byRoom.values()) moving.push(...list);
  for (const { obj } of doors) moving.push(obj);

  const outsiders = roomsOf(doc).filter((r) => !idSet.has(String(r.id)));
  const { dx, dz } = findFreeRoomTranslation(rooms, outsiders);
  if (dx || dz) {
    for (const obj of moving) {
      obj.x = (obj.x | 0) + dx;
      obj.z = (obj.z | 0) + dz;
    }
  }

  for (const obj of moving) clampObject(obj);
}

export function pointInAabb(p, box) {
  return (
    p.x >= box.x &&
    p.x <= box.x + box.sx &&
    p.y >= box.y &&
    p.y <= box.y + box.sy &&
    p.z >= box.z &&
    p.z <= box.z + box.sz
  );
}

export function aabbVolume(box) {
  return box.sx * box.sy * box.sz;
}

export function aabbCenter(box) {
  return {
    x: box.x + box.sx / 2,
    y: box.y + box.sy / 2,
    z: box.z + box.sz / 2,
  };
}

export function sizeForFace(kind, faceId, scale) {
  const def = KINDS[kind];
  const face = FACES.find((f) => f.id === faceId) || FACES[0];
  const [a, b, thick] = kind === "doorway" ? doorSizeForScale(scale) : def.defaultSize;
  if (face.axis === "x") return { sx: thick, sy: b, sz: a };
  return { sx: a, sy: b, sz: thick };
}

export function applyFaceSize(obj) {
  if (obj.kind !== "doorway" && obj.kind !== "switch") return obj;
  const s = sizeForFace(obj.kind, obj.face, obj.doorScale);
  obj.sx = s.sx;
  obj.sy = s.sy;
  obj.sz = s.sz;
  obj.x = clampByte(obj.x);
  obj.y = clampByte(obj.y);
  obj.z = clampByte(obj.z);
  obj.sx = clampSize(obj.x, obj.sx);
  obj.sy = clampSize(obj.y, obj.sy);
  obj.sz = clampSize(obj.z, obj.sz);
  return obj;
}

/** Axis x/z, dir ±1; sizes independent (rise = sy, run = sx or sz). */
export function applySlopeConstraint(obj) {
  if (obj.kind !== "slope") return obj;
  obj.sy = clampSize(obj.y, Math.max(1, obj.sy | 0));
  if (obj.axis === "x") {
    obj.sx = clampSize(obj.x, Math.max(1, obj.sx | 0));
    obj.sz = clampSize(obj.z, Math.max(1, obj.sz | 0));
  } else {
    obj.axis = "z";
    obj.sz = clampSize(obj.z, Math.max(1, obj.sz | 0));
    obj.sx = clampSize(obj.x, Math.max(1, obj.sx | 0));
  }
  if (obj.dir !== -1) obj.dir = 1;
  return obj;
}

export function clampObject(obj) {
  obj.x = clampByte(obj.x);
  obj.y = clampByte(obj.y);
  obj.z = clampByte(obj.z);
  if (obj.kind === "doorway") obj.doorScale = clampDoorScale(obj.doorScale);
  if (obj.kind === "doorway" || obj.kind === "switch") {
    applyFaceSize(obj);
  } else if (obj.kind === "pickup") {
    applyBackpackProportions(obj);
  } else if (obj.kind === "slope") {
    obj.sx = clampSize(obj.x, obj.sx);
    obj.sy = clampSize(obj.y, obj.sy);
    obj.sz = clampSize(obj.z, obj.sz);
    applySlopeConstraint(obj);
    obj.flags = clampSlopeFlags(obj.flags);
  } else {
    obj.sx = clampSize(obj.x, obj.sx);
    obj.sy = clampSize(obj.y, obj.sy);
    obj.sz = clampSize(obj.z, obj.sz);
  }
  if (obj.kind === "enemy" || obj.kind === "spawn") {
    obj.rot = clampEnemyRot(obj.rot ?? 0);
  }
  if (obj.kind === "enemy") {
    const et = clampTag(obj.tag);
    if (et) obj.tag = et;
    else delete obj.tag;
  }
  if (obj.kind === "trigger") {
    obj.purpose = clampTriggerPurpose(obj.purpose);
    obj.text = clampTriggerText(obj.text);
    obj.tag = clampTag(obj.tag);
    const et = clampTag(obj.enableTag);
    if (et) obj.enableTag = et;
    else delete obj.enableTag;
  }
  if (obj.kind === "room") {
    obj.name = clampName(obj.name);
    obj.a8Bg = roomBgFromJson(obj);
    delete obj.bgColor;
    delete obj.lineColor;
    delete obj.fxColor;
    delete obj.weaponColor;
    delete obj.skyColor;
    delete obj.floorColor;
    clampRoomSplits(obj);
  } else {
    if (obj.roomId != null) obj.roomId = String(obj.roomId);
    else obj.roomId = null;
  }
  if (usesLinkTag(obj.kind)) obj.tag = clampTag(obj.tag);
  if (obj.kind === "elevator") {
    clampElevHeights(obj);
    if (obj.elevSlow) obj.elevSlow = true;
    else delete obj.elevSlow;
  }
  if (obj.kind === "pickup") {
    obj.pickup = clampPickupType(obj.pickup);
    const facing = clampEnemyRot(obj.rot ?? 0);
    if (facing) obj.rot = facing;
    else delete obj.rot;
    // "big" was the old 8x flag.
    const scale = clampItemScale(obj.scale ?? (obj.big ? 8 : 1));
    delete obj.big;
    if (scale > 1) obj.scale = scale;
    else delete obj.scale;
  }
  if (obj.kind === "switch") {
    if (obj.shootable) obj.shootable = true;
    else delete obj.shootable;
    if (obj.endLevel) obj.endLevel = true;
    else delete obj.endLevel;
  }
  if (obj.kind === "doorway") {
    obj.lockKey = clampDoorLock(obj.lockKey);
    obj.doorType = clampDoorType(obj.doorType);
    obj.locked = obj.lockKey !== "unlocked";
    obj.tag = clampTag(obj.tag);
    delete obj.keyTag;
    if (obj.hidden) obj.hidden = true;
    else delete obj.hidden;
    if (obj.otherRoomId != null) obj.otherRoomId = String(obj.otherRoomId);
    else obj.otherRoomId = null;
  }
  if (obj.kind === "platform") {
    obj.sy = 1;
    obj.collide = obj.collide !== false;
  }
  if (obj.kind === "crate") {
    if (obj.allEdges) obj.allEdges = true;
    else delete obj.allEdges;
  }
  if (obj.kind === "spawn") {
    obj.enabled = !!obj.enabled;
    if (obj.showJump) obj.showJump = true;
    else delete obj.showJump;
  }
  return obj;
}

export function createObject(kind, x, y, z, extra = {}) {
  const def = KINDS[kind];
  if (!def) throw new Error(`Unknown kind ${kind}`);
  const obj = {
    id: extra.id || uid(),
    kind,
    x: x | 0,
    y: y | 0,
    z: z | 0,
    sx: def.defaultSize[0],
    sy: def.defaultSize[1],
    sz: def.defaultSize[2],
    face: extra.face || "+z",
    axis: extra.axis || "z",
    dir: extra.dir ?? 1,
  };
  if (kind === "slope") {
    obj.sx = 4;
    obj.sy = 2;
    obj.sz = 4;
    obj.flags = extra.flags;
  }
  if (kind === "crate" && extra.allEdges) obj.allEdges = true;
  if (kind === "spawn" || kind === "enemy") {
    obj.rot = clampEnemyRot(extra.rot ?? 0);
  }
  if (kind === "spawn") {
    obj.enabled = extra.enabled === true;
    if (extra.showJump) obj.showJump = true;
  }
  if (kind === "enemy") {
    const name = extra.enemy || "Possessed";
    obj.enemy = ENEMY_TYPES.some((t) => t.name === name) ? name : "Possessed";
    const et = clampTag(extra.tag);
    if (et) obj.tag = et;
  }
  if (kind === "trigger") {
    obj.purpose = clampTriggerPurpose(extra.purpose);
    obj.text = extra.text;
    obj.tag = extra.tag;
    obj.enableTag = extra.enableTag;
  }
  if (kind === "room") {
    obj.name = clampName(extra.name);
    obj.a8Bg = roomBgFromJson(extra);
    obj.shape = clampRoomShape(extra.shape);
    obj.rx = extra.rx | 0;
    obj.ry = extra.ry | 0;
    obj.rz = extra.rz | 0;
    if (Array.isArray(extra.cuts)) obj.cuts = extra.cuts.map((c) => ({ su: c.su | 0, sv: c.sv | 0 }));
    obj.cutU = extra.cutU | 0;
    obj.cutV = extra.cutV | 0;
    obj.stemW = extra.stemW | 0;
    obj.stemPos = extra.stemPos | 0;
    obj.barD = extra.barD | 0;
    obj.shift = extra.shift | 0;
    obj.mid = extra.mid | 0;
  } else if (extra.roomId) {
    obj.roomId = String(extra.roomId);
  }
  if (usesLinkTag(kind)) obj.tag = clampTag(extra.tag);
  if (kind === "switch" && extra.shootable) obj.shootable = true;
  if (kind === "switch" && extra.endLevel) obj.endLevel = true;
  if (kind === "elevator") {
    obj.elevAuto = extra.elevAuto !== false;
    if (extra.elevLow != null) obj.elevLow = extra.elevLow | 0;
    if (extra.elevHigh != null) obj.elevHigh = extra.elevHigh | 0;
    if (extra.elevSlow) obj.elevSlow = true;
  }
  if (kind === "pickup") {
    obj.pickup = clampPickupType(extra.pickup);
    if (extra.rot) obj.rot = clampEnemyRot(extra.rot);
    const scale = clampItemScale(extra.scale ?? (extra.big ? 8 : 1));
    if (scale > 1) obj.scale = scale;
  }
  if (kind === "doorway") {
    obj.lockKey = clampDoorLock(extra.lockKey ?? (extra.locked ? "yellow" : "unlocked"));
    obj.doorType = clampDoorType(extra.doorType);
    obj.doorScale = clampDoorScale(extra.doorScale);
    obj.tag = clampTag(extra.tag);
    if (extra.hidden) obj.hidden = true;
    if (extra.otherRoomId) obj.otherRoomId = String(extra.otherRoomId);
  }
  if (kind === "platform") obj.collide = extra.collide !== false;
  return clampObject(obj);
}

export function clampTriggerText(s) {
  return String(s ?? "").replace(/\r\n/g, "\n").slice(0, MAX_TRIGGER_TEXT);
}

export function clampName(s) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LEN);
}

/** Enter-card verb shown instead of "entering" ("docking at", "landing on"). */
export function clampVerb(s) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_VERB_LEN);
}

export function clampTag(s) {
  return String(s ?? "")
    .replace(/\s+/g, "")
    .slice(0, MAX_TAG_LEN);
}

export function isFigureObject(obj) {
  return obj.kind === "enemy" || obj.kind === "spawn";
}

/** Exactly one spawn `enabled` when any exist. None marked → first in list (old maps). */
export function ensureSpawnExclusive(objects) {
  const spawns = (objects || []).filter((o) => o.kind === "spawn");
  if (!spawns.length) return;
  const on = spawns.filter((s) => s.enabled);
  const keep = on[0] || spawns[0];
  for (const s of spawns) s.enabled = s === keep;
}

export function enableSpawn(objects, spawnId) {
  for (const o of objects || []) {
    if (o.kind === "spawn") o.enabled = o.id === spawnId;
  }
}

/** Objects-panel label: type only (no XYZ). Rooms may include display name. */
export function objectLabel(obj) {
  if (!obj || !KINDS[obj.kind]) return "?";
  if (obj.kind === "room") {
    return obj.name ? `Room  ${obj.name}` : "Room";
  }
  if (obj.kind === "enemy") return obj.enemy || "Enemy";
  if (obj.kind === "pickup") return `Pickup (${itemLabel(clampPickupType(obj.pickup))})`;
  if (obj.kind === "doorway") return `Doorway (${itemLabel(clampDoorType(obj.doorType))})`;
  if (obj.kind === "spawn" && !obj.enabled) return "Spawn (off)";
  return KINDS[obj.kind].label;
}

/** Whitespace-separated Maps-panel search terms. Empty when the query is blank. */
export function layoutSearchTerms(query) {
  return String(query ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** Kind, list label, and the text fields that distinguish a placed object. */
export function layoutSearchHaystack(obj) {
  if (!obj || !KINDS[obj.kind]) return "";
  const parts = [obj.kind, KINDS[obj.kind].label, objectLabel(obj)];
  if (obj.kind === "doorway") {
    const lock = clampDoorLock(obj.lockKey);
    parts.push(lock, DOOR_LOCK_LABELS[lock]);
    if (lock !== "unlocked") parts.push("locked");
    if (obj.hidden) parts.push("hidden");
    if (obj.tag) parts.push(obj.tag);
  } else if (obj.kind === "trigger") {
    const purpose = clampTriggerPurpose(obj.purpose);
    parts.push(purpose, TRIGGER_PURPOSE_LABELS[purpose]);
    if (obj.text) parts.push(obj.text);
    if (obj.tag) parts.push(obj.tag);
    if (obj.enableTag) parts.push(obj.enableTag);
  } else if (usesLinkTag(obj.kind) && obj.tag) {
    parts.push(obj.tag);
  }
  return parts.filter(Boolean).join(" ");
}

/** True when any term is a case-insensitive substring of the object's search text. */
export function objectMatchesLayoutSearch(obj, terms) {
  if (!terms?.length) return false;
  const hay = layoutSearchHaystack(obj).toLowerCase();
  if (!hay) return false;
  return terms.some((term) => hay.includes(term));
}

export function mapMatchesLayoutSearch(map, terms) {
  if (!terms?.length) return false;
  return (map?.objects || []).some((obj) => objectMatchesLayoutSearch(obj, terms));
}

export function figureTemplateName(obj) {
  return obj.kind === "spawn" ? "Possessed" : obj.enemy || "Possessed";
}

/** Rest pose. Palette icons and the spawn marker stay here. */
export function enemyPreviewFrame(template) {
  const frames = template?.frames;
  if (!frames?.length) return null;
  const want = ROLE_CLIPS[template.name]?.preview?.[0];
  if (want) {
    const clip = (template.clips || []).find((c) => poseClipKey(c.name) === poseClipKey(want));
    const fi = clip ? clip.start | 0 : -1;
    if (fi >= 0 && fi < frames.length) return frames[fi];
  }
  return frames[0];
}

/** src/mem.asm ANIM_MS. Doom types in enemy.asm advance every other tick. */
const ANIM_MS = 100;
const DOOM_SLOW_WALK = new Set(["Possessed", "Baron", "Pinky", "Imp"]);

function walkStepMs(name) {
  return DOOM_SLOW_WALK.has(name) ? ANIM_MS * 2 : ANIM_MS;
}

/** Role clip ("run"/"stand") frame at the game step clock. All placed figures share one phase. */
function roleCycleFrame(template, now, roleName) {
  const frames = template?.frames;
  if (!frames?.length) return null;
  const role = findPoseRole(template?.name, template?.clips || [], roleName);
  if (!role) return enemyPreviewFrame(template);
  const [start, len] = role;
  if (len < 1) return enemyPreviewFrame(template);
  const fi = (start | 0) + (Math.floor(now / walkStepMs(template.name)) % len);
  if (fi < 0 || fi >= frames.length) return enemyPreviewFrame(template);
  return frames[fi];
}

/** World-space stick verts (1/4 scale, feet on floor center). Enemies loop walk, player spawns loop stand. */
export function enemyPlacementWorldVerts(obj, template, now = performance.now()) {
  const frame =
    obj?.kind === "enemy"
      ? roleCycleFrame(template, now, "run")
      : obj?.kind === "spawn"
        ? roleCycleFrame(template, now, "stand")
        : enemyPreviewFrame(template);
  if (!frame) return [];
  const ox = obj.x + obj.sx / 2;
  const oy = obj.y;
  const oz = obj.z + obj.sz / 2;
  const s = LAYOUT_ENEMY_SCALE;
  const rot = clampEnemyRot(obj.rot ?? 0);
  const th = (rot * Math.PI) / 4;
  const c = Math.cos(th);
  const sn = Math.sin(th);
  return frame.map((v) => {
    const lx = v.x * s;
    const ly = v.y * s;
    const lz = v.z * s;
    return {
      x: ox + lx * c + lz * sn,
      y: oy + ly,
      z: oz - lx * sn + lz * c,
    };
  });
}

export function findEnemyTemplate(doc, name) {
  return (doc.enemies || []).find((e) => e.name === name) || doc.enemies?.[0] || null;
}

export function cycleFace(faceId, delta) {
  const i = FACES.findIndex((f) => f.id === faceId);
  const n = (i + delta + FACES.length) % FACES.length;
  return FACES[n].id;
}

export function emptyMap() {
  return { name: "", objects: [] };
}

/** Per-map jump physics, game units (player is PLAYER_H = 4 high). Keep in sync with tools/genmap.py. */
export const DEFAULT_JUMP_SPEED = 23; // units/s upward at takeoff
export const DEFAULT_GRAVITY = 61; // units/s² (ledge falls use it too)
export const JUMP_SPEED_MAX = 62; // packed as one byte, 4.096 per unit/s
export const GRAVITY_MAX = 240; // packed as one byte, 1.0486 per unit/s²

function clampPhys(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n * 10) / 10));
}

export function clampJumpSpeed(v) {
  return clampPhys(v, DEFAULT_JUMP_SPEED, 0, JUMP_SPEED_MAX);
}

/** Min 1: zero gravity never lands (jump or fall). */
export function clampGravity(v) {
  return clampPhys(v, DEFAULT_GRAVITY, 1, GRAVITY_MAX);
}

export const PHYS_TICK_S = 0.032; // engine fall tick (FALL_TICK_MS)
export const WALK_SPEED = 7.75; // units/s; wish scale 127 / 64 / 256 per ms

/**
 * Jump arc as the engine integrates it: values packed to the header bytes
 * (genmap.py), then per 32 ms tick  up = v0 - n*a;  y += up  (no landing test
 * while ascending). Horizontal is walk speed along the takeoff heading.
 * Returns { pts: [{ t, d, y }], apex, range, time } in seconds / game units.
 */
export function jumpArc(jumpSpeed, gravity, land = null) {
  const v0 = (Math.round(clampJumpSpeed(jumpSpeed) * 4.096) * 2) / 256;
  const a = Math.round(clampGravity(gravity) * 1.048576) / 4 / 256;
  const pt = (n, y) => ({ t: n * PHYS_TICK_S, d: WALK_SPEED * n * PHYS_TICK_S, y });
  const pts = [pt(0, 0)];
  let y = 0;
  let apex = 0;
  for (let n = 1; n <= 4000; n++) {
    const up = v0 - n * a;
    const prev = y;
    y += up;
    if (up <= 0) {
      // Descending: land on the first surface, else (flat) back at takeoff height.
      const ly = land ? land(pt(n - 1, prev), pt(n, y)) : y <= 0 ? 0 : null;
      if (ly != null) {
        const f = prev > y ? Math.min(1, Math.max(0, (prev - ly) / (prev - y))) : 0;
        pts.push(pt(n - 1 + f, ly));
        break;
      }
      if (land && y < -64) {
        pts.push(pt(n, y)); // no floor under the path
        break;
      }
    }
    apex = Math.max(apex, y);
    pts.push(pt(n, y));
  }
  const last = pts[pts.length - 1];
  return { pts, apex, range: last.d, time: last.t };
}

export const JUMP_STEP_UP = 2; // keep in sync with STEP_UP in src/mem.asm

/**
 * Floor query for the editor's jump preview: (x, z, lo, hi) -> highest walkable
 * top in [lo, hi] at that column, or null. Room floors, crate tops and solid
 * platform tops (same surfaces genmap emits). Slopes and elevators are not
 * included, so an arc passes through them.
 */
export function floorSurfaces(doc) {
  const rooms = [];
  const boxes = [];
  for (const o of activeMap(doc).objects) {
    if (o.kind === "room") {
      rooms.push((roomGeometry(o).colliders || []).map((c) => ({ ...c })));
    } else if (o.kind === "crate") {
      boxes.push({ o, top: (o.y | 0) + (o.sy | 0) });
    } else if (o.kind === "platform" && o.collide !== false) {
      boxes.push({ o, top: (o.y | 0) + ((o.sy | 0) || 1) });
    }
  }
  return (x, z, lo, hi) => {
    let best = null;
    const take = (t) => {
      if (t >= lo - 1e-6 && t <= hi + 1e-6 && (best == null || t > best)) best = t;
    };
    for (const cols of rooms) {
      let floor = null;
      for (const c of cols) {
        if (x >= c.x && x <= c.x + c.sx && z >= c.z && z <= c.z + c.sz) {
          if (floor == null || c.y < floor) floor = c.y; // lowest containing, as the engine
        }
      }
      if (floor != null) take(floor);
    }
    for (const { o, top } of boxes) {
      if (x >= o.x && x <= o.x + o.sx && z >= o.z && z <= o.z + o.sz) take(top);
    }
    return best;
  };
}

export function mapDisplayName(map, key) {
  const n = clampName(map?.name);
  return n || key;
}

/** Soft cap: 8-bit object indices / editor budget. */
export const MAX_MAP_OBJECTS = 255;
export const ROOM_MAX = 32; // keep in sync with tools/genmap.py

/** One name per possible room (ROOM_MAX). Unnamed rooms get the first unused one on save. */
export const ROOM_NAME_POOL = [
  "Acid Pit",
  "Bone Yard",
  "Brimstone Hall",
  "Cacodemon Den",
  "Cinder Vault",
  "Dead End",
  "Gore Nest",
  "Grim Annex",
  "Hell Closet",
  "Imp Parlor",
  "Lava Lounge",
  "Meat Locker",
  "Mold Cellar",
  "Ooze Chamber",
  "Pain Pantry",
  "Rust Gallery",
  "Skull Court",
  "Slime Gutter",
  "Spore Attic",
  "Stinky Vent",
  "Toxic Nook",
  "Void Closet",
  "Wretched Foyer",
  "Zombie Walk",
  "Charnel Loft",
  "Ember Crypt",
  "Fester Hall",
  "Gristle Pit",
  "Maggot Bay",
  "Rot Chapel",
  "Sulfur Sump",
  "Tallow Vault",
];

/** Name every blank room from ROOM_NAME_POOL (unique per level). Returns count named. */
export function assignRoomNames(doc) {
  let n = 0;
  for (const name of LEVEL_NAMES) {
    const objs = doc.maps?.[name]?.objects;
    if (!Array.isArray(objs)) continue;
    const rooms = objs.filter((o) => o.kind === "room");
    const used = new Set(rooms.map((r) => clampName(r.name).toLowerCase()).filter(Boolean));
    for (const room of rooms) {
      if (clampName(room.name)) continue;
      let pick = ROOM_NAME_POOL.find((p) => !used.has(p.toLowerCase()));
      for (let i = 1; !pick; i++) {
        const cand = `Room ${i}`;
        if (!used.has(cand.toLowerCase())) pick = cand;
      }
      room.name = pick;
      used.add(pick.toLowerCase());
      n++;
    }
  }
  return n;
}
export const ROOM_MAX_TYPES = 2;
export const ENEMY_MAX = 24; // keep in sync with tools/genmap.py / src/mem.asm
export const MESH_EDGE_MAX = 255; // packed mesh-edge table is one byte; box rooms store 0
export const MAP_MAX_BYTES = 4096;
export const ENEMY_POSE_MAX = 7680;
export const STICK_POSE_BYTES = 13 * 3; // gx+gy+gz per stored pose

/** Packed map header: 10 counts + jump_v, grav, pad + 4 mesh lens + 6 spawn. */
export const MAP_HDR_BYTES = 23;

// Keep in sync with tools/genenemies.py (role names).
const PAIN_MAX = 4;
const ROLE_CLIPS = {
  Possessed: { stand: ["stand"], alert: ["stand"], run: ["walk"], walk: ["walk"], attack: ["missile"] },
  Baron: {
    stand: ["stand"],
    alert: ["stand"],
    run: ["walk"],
    walk: ["walk"],
    attack: ["attack"],
  },
  Pinky: {
    stand: ["stand"],
    alert: ["stand"],
    run: ["walk"],
    walk: ["walk"],
    attack: ["melee"],
  },
  Imp: {
    stand: ["stand"],
    alert: ["stand"],
    run: ["walk"],
    walk: ["walk"],
    attack: ["attack"],
  },
};

function poseClipKey(name) {
  return String(name).replace(/_+$/, "").toLowerCase();
}

export function clipIsAttackRole(enemyName, clipName) {
  const names = ROLE_CLIPS[enemyName]?.attack || [];
  const key = poseClipKey(clipName);
  return names.some((n) => poseClipKey(n) === key);
}

function poseClipByName(clips, name) {
  for (const c of clips) {
    if (c.name === name) return c;
  }
  const k = poseClipKey(name);
  for (const c of clips) {
    if (poseClipKey(c.name) === k) return c;
  }
  return null;
}

/**
 * Stick clips/frames that will go in the pose PRG (exportClips checkboxes).
 * Missing exportClips → all copied clips. Checked names with no stick frames are skipped.
 */
export function exportPoseData(enemy) {
  const frames = enemy?.frames || [];
  const clips = enemy?.clips || [];
  const names = Array.isArray(enemy?.exportClips) ? enemy.exportClips : null;
  if (!names) return { clips, frames };
  const outClips = [];
  const outFrames = [];
  let start = 0;
  for (const name of names) {
    const c = poseClipByName(clips, name);
    if (!c) continue;
    const slice = frames.slice(c.start | 0, (c.start | 0) + (c.len | 0));
    if (!slice.length) continue;
    outClips.push(withClipSound({ name: c.name, start, len: slice.length }, c));
    outFrames.push(...slice);
    start += slice.length;
  }
  return { clips: outClips, frames: outFrames };
}

function findPoseClip(clips, ...names) {
  for (const want of names) {
    for (const c of clips) {
      if (poseClipKey(c.name) === want) return [c.start | 0, c.len | 0];
    }
  }
  return null;
}

function findPoseRole(name, clips, role) {
  if (role === "attack") return null;
  const spec = ROLE_CLIPS[name]?.[role];
  if (!spec) return null;
  const found = findPoseClip(clips, spec[0]);
  if (!found) return null;
  let [start, length] = found;
  if (spec[1] != null) length = Math.min(length, spec[1]);
  return [start, length];
}

/** The one attack clip for this type, in export order. */
function findPoseAttackVariants(name, clips) {
  const names = ROLE_CLIPS[name]?.attack || [];
  const want = new Set(names.filter((n) => typeof n === "string").map(poseClipKey));
  for (const c of clips) {
    if (!want.has(poseClipKey(c.name))) continue;
    const len = c.len | 0;
    return [[c.start | 0, len, attackFrameOrDefault(c.attackFrame, len)]];
  }
  const stand = findPoseClip(clips, "stand", "walk", "hover");
  if (stand) return [[stand[0], 1, 0]];
  return [];
}

function findPoseVariants(clips, kind) {
  const re = kind === "pain" ? /^pain[a-z]?$/ : /^(bdeath|death[a-z]?)$/;
  const out = [];
  for (const c of clips) {
    if (!re.test(poseClipKey(c.name))) continue;
    out.push([c.start | 0, c.len | 0]);
    if (out.length >= PAIN_MAX) break;
  }
  if (!out.length) {
    const stand = findPoseClip(clips, "stand", "walk", "hover");
    if (stand) out.push([stand[0], 1]);
  }
  return out;
}

function poseAccAt(frs, i) {
  if (!frs || i <= 0 || i >= frs.length - 1) return 0;
  let m = 0;
  const a = frs[i - 1];
  const b = frs[i];
  const c = frs[i + 1];
  if (!a || !b || !c) return 0;
  const nv = b.length;
  for (let v = 0; v < nv; v++) {
    if (!a[v] || !c[v]) continue;
    for (const k of ["x", "y", "z"]) {
      const d = Math.abs((c[v][k] | 0) - 2 * (b[v][k] | 0) + (a[v][k] | 0));
      if (d > m) m = d;
    }
  }
  return m;
}

function posePickKeys(frs, start, length, extra) {
  if (length <= 2) return [];
  const minSep = Math.max(2, (length / 3) | 0);
  const keys = [];
  for (const e of extra) {
    if (start < e && e < start + length - 1) keys.push(e);
    if (keys.length >= 2) return keys.slice(0, 2).sort((a, b) => a - b);
  }
  if (!frs) return keys.sort((a, b) => a - b);
  const scored = [];
  for (let i = start + 1; i < start + length - 1; i++) {
    scored.push([poseAccAt(frs, i), i]);
  }
  scored.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  for (const [, i] of scored) {
    if (keys.some((k) => Math.abs(i - k) < minSep)) continue;
    keys.push(i);
    if (keys.length === 2) break;
  }
  return keys.sort((a, b) => a - b);
}

function poseCadenceKeep(start, length, keys) {
  if (length <= 0) return new Set();
  const last = start + length - 1;
  const keyset = new Set(keys);
  const kept = [];
  let f = start;
  while (f < last) {
    const plug = [...keyset].filter((k) => f < k && k < f + 2).sort((a, b) => a - b);
    kept.push(f);
    if (plug.length) {
      kept.push(plug[0]);
      f = plug[0] + 2;
    } else {
      f += 2;
    }
  }
  kept.push(last);
  return new Set(kept);
}

function poseUncoveredRuns(covered) {
  const out = [];
  let i = 0;
  while (i < covered.length) {
    if (covered[i]) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < covered.length && !covered[j]) j += 1;
    out.push([i, j - i]);
    i = j;
  }
  return out;
}

/**
 * Packed pose PRG size (tools/genenemies.py pack_poses).
 * clips: [{name, start, len}] covering the logical timeline.
 * frames: stick verts for those logical indices, or null → cadence + fire pin only.
 */
export function packedPoseBytes(enemy, clips, frames) {
  const name = enemy?.name || "Possessed";
  if (clips === undefined) {
    const pose = exportPoseData(enemy);
    clips = pose.clips;
    frames = pose.frames;
  }
  const clipList = clips || [];
  const frs = frames && frames.length ? frames : null;
  let nLogical = 0;
  for (const c of clipList) {
    const end = (c.start | 0) + (c.len | 0);
    if (end > nLogical) nLogical = end;
  }
  if (frs && frs.length > nLogical) nLogical = frs.length;
  if (nLogical <= 0) return { bytes: 0, nLogical: 0, nStored: 0 };

  if (enemyHasSprites(enemy) && frs) {
    const seen = new Set();
    for (let i = 0; i < nLogical; i++) {
      const fr = frs[i] || [];
      seen.add(fr.map((v) => `${Math.round(v.x * SPRITE_POS_Q)},${Math.round(v.y * SPRITE_POS_Q)},${Math.round(v.z * SPRITE_POS_Q)}`).join(";"));
    }
    const nv = frs[0]?.length || 13;
    return { bytes: 2 + nLogical + seen.size * nv * 3, nLogical, nStored: seen.size };
  }

  const covered = Array(nLogical).fill(false);
  const keep = new Set();

  const ranges = [];
  for (const role of ["stand", "alert", "run", "walk"]) {
    const found = findPoseRole(name, clipList, role);
    if (!found) continue;
    let [start, length] = found;
    if (start >= nLogical || length <= 0) continue;
    length = Math.min(length, nLogical - start);
    ranges.push([role, start, length]);
  }
  findPoseAttackVariants(name, clipList).forEach(([start, length, fireOff], i) => {
    if (start >= nLogical || length <= 0) return;
    const ln = Math.min(length, nLogical - start);
    let fr = fireOff ?? attackFrameOrDefault(null, ln);
    if (fr < 0) fr = 0;
    if (fr >= ln) fr = ln - 1;
    ranges.push([`attack${i}`, start, ln, fr]);
  });
  for (const kind of ["pain", "death"]) {
    findPoseVariants(clipList, kind).forEach(([start, length], i) => {
      if (start >= nLogical || length <= 0) return;
      ranges.push([`${kind}${i}`, start, Math.min(length, nLogical - start)]);
    });
  }
  for (const [role, start, length, fireOff] of ranges) {
    let extra = [];
    if (typeof role === "string" && role.startsWith("attack") && fireOff >= 0 && fireOff < 255) {
      extra = [start + fireOff];
    }
    for (const i of poseCadenceKeep(start, length, posePickKeys(frs, start, length, extra))) {
      keep.add(i);
    }
    for (let i = start; i < start + length; i++) covered[i] = true;
  }
  for (const c of clipList) {
    const start = c.start | 0;
    let length = c.len | 0;
    if (start >= nLogical || length <= 0) continue;
    length = Math.min(length, nLogical - start);
    let all = true;
    for (let i = start; i < start + length; i++) {
      if (!covered[i]) {
        all = false;
        break;
      }
    }
    if (all) continue;
    for (const i of poseCadenceKeep(start, length, posePickKeys(frs, start, length, []))) {
      keep.add(i);
    }
    for (let i = start; i < start + length; i++) covered[i] = true;
  }
  for (const [start, length] of poseUncoveredRuns(covered)) {
    for (const i of poseCadenceKeep(start, length, posePickKeys(frs, start, length, []))) {
      keep.add(i);
    }
  }

  const nStored = keep.size;
  const nv = frs?.[0]?.length || 13;
  const bytes = 2 + nLogical + nStored * nv * 3;
  return { bytes, nLogical, nStored };
}

/** Unique enemy type names in one room (unknown names count as Possessed). */
export function roomEnemyTypeNames(map, roomId) {
  const names = [];
  if (roomId == null) return names;
  const rid = String(roomId);
  for (const obj of map?.objects || []) {
    if (obj.kind !== "enemy") continue;
    if (String(obj.roomId) !== rid) continue;
    const raw = obj.enemy || "Possessed";
    const name = ENEMY_TYPES.some((t) => t.name === raw) ? raw : "Possessed";
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Unique enemy type names placed on a map (unknown names count as Possessed). */
export function mapEnemyTypeNames(map) {
  const names = [];
  for (const obj of map?.objects || []) {
    if (obj.kind !== "enemy") continue;
    const raw = obj.enemy || "Possessed";
    const name = ENEMY_TYPES.some((t) => t.name === raw) ? raw : "Possessed";
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** True if placing/changing to typeName in roomId stays within ROOM_MAX_TYPES. */
export function canAddEnemyType(map, typeName, roomId) {
  const names = roomEnemyTypeNames(map, roomId);
  const raw = typeName || "Possessed";
  const name = ENEMY_TYPES.some((t) => t.name === raw) ? raw : "Possessed";
  if (names.includes(name)) return true;
  return names.length < ROOM_MAX_TYPES;
}

/**
 * Bytes per instance in the cooked C64 SoA (tools/genmap.py).
 * Trigger text blob is counted separately. Spawn lives in the 23-byte header.
 */
export const C64_OBJECT_BYTES = {
  room: 7, // x y z sx sy sz bg
  doorway: 11, // one baked instance; +11 if otherRoomId (see mapStats)
  crate: 8,
  slope: 11,
  platform: 8,
  elevator: 11,
  switch: 10,
  enemy: 9,
  trigger: 10,
  spawn: 0,
  pickup: 6,
};

/** Counts + packed map RAM for the active level (matches genmap cook_one). */
export function mapStats(doc) {
  const map = activeMap(doc);
  const byKind = {};
  let total = 0;
  let c64Bytes = MAP_HDR_BYTES;
  c64Bytes += clampName(map.name).length + 1; // map_name + NUL
  c64Bytes += clampVerb(map.enterVerb).length + 1; // enter verb + NUL
  let meshEdges = 0;
  let hasSpawn = false;
  let mapText = 0;
  for (const obj of map.objects) {
    const kind = obj.kind;
    if (!KINDS[kind]) continue;
    total += 1;
    byKind[kind] = (byKind[kind] || 0) + 1;
    if (kind === "spawn") {
      if (hasSpawn) continue; // engine keeps one spawn record in the header
      hasSpawn = true;
      continue;
    }
    c64Bytes += C64_OBJECT_BYTES[kind] ?? 8;
    if (kind === "doorway" && obj.otherRoomId) {
      c64Bytes += 11; // second baked instance for the far room
    }
    if (kind === "room") {
      c64Bytes += 18; // three collider slots (3×6)
      c64Bytes += 12; // two cutout slots (2×6), always padded
      c64Bytes += 8; // nv/ne/vo/eo/nx/nz/uo/zo (zeros on box)
      c64Bytes += 2; // room_door_o + room_ndoor
      if (clampRoomShape(obj.shape) !== "box") {
        const g = roomGeometry(obj);
        meshEdges += g.edges.length;
        const nx = new Set(g.verts.map((v) => v.x)).size;
        const nz = new Set(g.verts.map((v) => v.z)).size;
        c64Bytes += nx + nz + g.verts.length * 4 + g.edges.length * 3;
      }
    }
    if (kind === "trigger" && clampTriggerPurpose(obj.purpose) === "message") {
      const text = String(obj.text || "")
        .replace(/\r\n/g, "\n")
        .split("\n", 1)[0]
        .slice(0, 40);
      mapText += text.length + 1; // chars + NUL in map_text
    }
  }
  c64Bytes += mapText || 1; // dummy NUL if no message triggers
  const enemyTypes = mapEnemyTypeNames(map);
  const enemyTypeCount = enemyTypes.length;
  let overTypes = false;
  const roomTypeCounts = new Map();
  for (const obj of map.objects) {
    if (obj.kind !== "enemy") continue;
    const rid = obj.roomId != null ? String(obj.roomId) : "";
    const raw = obj.enemy || "Possessed";
    const name = ENEMY_TYPES.some((t) => t.name === raw) ? raw : "Possessed";
    let set = roomTypeCounts.get(rid);
    if (!set) {
      set = new Set();
      roomTypeCounts.set(rid, set);
    }
    set.add(name);
  }
  for (const set of roomTypeCounts.values()) {
    if (set.size > ROOM_MAX_TYPES) {
      overTypes = true;
      break;
    }
  }
  // Pose peak = worst room's cohabiting types (streaming holds ≤ ROOM_MAX_TYPES).
  const poseSize = (name) => {
    const e = (doc.enemies || []).find((en) => en.name === name);
    return e ? packedPoseBytes(e).bytes : 0;
  };
  let poseBytes = 0;
  let poseParts = [];
  for (const set of roomTypeCounts.values()) {
    const names = [...set].sort();
    const sum = names.reduce((s, n) => s + poseSize(n), 0);
    if (sum > poseBytes) {
      poseBytes = sum;
      poseParts = names.map((n) => `${n} ${poseSize(n)}`);
    }
  }
  const loadBytes = c64Bytes + poseBytes;
  return {
    total,
    byKind,
    c64Bytes,
    poseBytes,
    loadBytes,
    poseParts,
    max: MAX_MAP_OBJECTS,
    meshEdges,
    enemyTypes,
    enemyTypeCount,
    overTypes,
    overRooms: (byKind.room || 0) > ROOM_MAX,
    overEnemies: (byKind.enemy || 0) > ENEMY_MAX,
    overBudget: overTypes || (byKind.room || 0) > ROOM_MAX || (byKind.enemy || 0) > ENEMY_MAX,
  };
}

const MAP_KIND_ORDER = [
  "room",
  "doorway",
  "crate",
  "slope",
  "platform",
  "elevator",
  "switch",
  "enemy",
  "trigger",
  "spawn",
  "pickup",
];

const MAP_KIND_PLURALS = {
  room: "rooms",
  doorway: "doors",
  crate: "crates",
  slope: "ramps",
  platform: "platforms",
  elevator: "elevators",
  switch: "switches",
  enemy: "enemies",
  trigger: "triggers",
  spawn: "spawns",
  pickup: "pickups",
};

function mapKindCountLabel(kind, n) {
  const one = KINDS[kind]?.label?.toLowerCase() || kind;
  return n === 1 ? one : MAP_KIND_PLURALS[kind] || `${one}s`;
}

/** Viewport strip: memory, capped counts, and the per-room type limit. */
export function formatMapStats(stats) {
  const rooms = stats.byKind.room || 0;
  const enemies = stats.byKind.enemy || 0;
  const edges = stats.meshEdges || 0;
  return [
    { text: `${stats.c64Bytes}:${stats.loadBytes}` },
    { text: `${stats.total}/${stats.max} objects` },
    { text: `${rooms}/${ROOM_MAX} ${mapKindCountLabel("room", rooms)}` },
    { text: `${enemies}/${ENEMY_MAX} ${mapKindCountLabel("enemy", enemies)}` },
    { text: `≤${ROOM_MAX_TYPES} types/room` },
    { text: `${edges}/${MESH_EDGE_MAX} edges`, over: edges > MESH_EDGE_MAX },
  ];
}

/** Kind counts for the empty-selection inspector. */
export function mapKindStatRows(stats) {
  const rows = [];
  for (const kind of MAP_KIND_ORDER) {
    const n = stats.byKind[kind] || 0;
    if (!n) continue;
    const label = mapKindCountLabel(kind, n);
    rows.push({
      label: label.charAt(0).toUpperCase() + label.slice(1),
      n,
    });
  }
  return rows;
}

export function formatMapLoadTitle(stats) {
  const bits = [`map ${stats.c64Bytes}`, ...(stats.poseParts || [])];
  return `${bits.join(" + ")} = ${stats.loadBytes}`;
}

export function activeMap(doc) {
  const name = LEVEL_NAMES.includes(doc.activeLevel) ? doc.activeLevel : LEVEL_NAMES[0];
  doc.activeLevel = name;
  if (!doc.maps) doc.maps = {};
  if (!doc.maps[name]) doc.maps[name] = emptyMap();
  if (typeof doc.maps[name].name !== "string") doc.maps[name].name = "";
  doc.maps[name].jumpSpeed = clampJumpSpeed(doc.maps[name].jumpSpeed);
  doc.maps[name].gravity = clampGravity(doc.maps[name].gravity);
  if (!Array.isArray(doc.maps[name].objects)) doc.maps[name].objects = [];
  return doc.maps[name];
}

export function roomsOf(doc) {
  return activeMap(doc).objects.filter((o) => o.kind === "room");
}

export function doorwaysOf(doc) {
  return activeMap(doc).objects.filter((o) => o.kind === "doorway");
}

export function currentRoom(doc, cam) {
  const rooms = roomsOf(doc).filter((r) => pointInRoom(cam, r));
  if (!rooms.length) return null;
  rooms.sort((a, b) => aabbVolume(a) - aabbVolume(b));
  return rooms[0];
}

export function roomById(doc, id) {
  if (!id) return null;
  return roomsOf(doc).find((r) => r.id === id) || null;
}

export function roomUnderObject(doc, obj) {
  if (!obj || obj.kind === "room") return null;
  return roomById(doc, obj.roomId);
}

/**
 * Objects whose AABB is not fully inside the AABB of their assigned room.
 * Legal but unusual, so the editor flags them. Doorways are skipped (they
 * straddle a wall by design) as are objects with no valid roomId.
 * Returns Map<objId, room>.
 */
export function outsideRoomBoxMap(doc) {
  const out = new Map();
  const map = activeMap(doc);
  const rooms = new Map();
  for (const o of map.objects) if (o.kind === "room") rooms.set(o.id, o);
  for (const o of map.objects) {
    if (o.kind === "room" || o.kind === "doorway" || !o.roomId) continue;
    const r = rooms.get(o.roomId);
    if (!r) continue;
    if (
      o.x < r.x ||
      o.y < r.y ||
      o.z < r.z ||
      o.x + o.sx > r.x + r.sx ||
      o.y + o.sy > r.y + r.sy ||
      o.z + o.sz > r.z + r.sz
    ) {
      out.set(o.id, r);
    }
  }
  return out;
}

/** Rooms that contain / overlap an object (doors may sit in two). */
export function roomsForObject(doc, obj) {
  if (!obj || obj.kind === "room") return [];
  const out = [];
  const a = roomById(doc, obj.roomId);
  if (a) out.push(a);
  if (obj.kind === "doorway") {
    const b = roomById(doc, obj.otherRoomId);
    if (b && b.id !== a?.id) out.push(b);
  }
  return out;
}

/**
 * Shallow room → children tree for the Objects panel.
 * Doors appear under owner and associated room; other objects under roomId.
 */
export function objectTree(doc) {
  const map = activeMap(doc);
  const rooms = roomsOf(doc);
  const claimed = new Set();
  const nodes = rooms.map((room) => {
    const children = [];
    for (const obj of map.objects) {
      if (obj.kind === "room") continue;
      if (obj.kind === "doorway") {
        if (obj.roomId === room.id || obj.otherRoomId === room.id) children.push(obj);
        continue;
      }
      if (obj.roomId === room.id) {
        children.push(obj);
        claimed.add(obj.id);
      }
    }
    return { room, children };
  });
  const orphans = map.objects.filter((o) => {
    if (o.kind === "room") return false;
    if (o.kind === "doorway") return !roomById(doc, o.roomId) && !roomById(doc, o.otherRoomId);
    return !claimed.has(o.id);
  });
  return { nodes, orphans };
}

/** Hull-face scores below this are on-wall; +50 is a lateral miss. Orientation only; links use doorTouchingRooms. */
const DOOR_PAIR_MAX = 8;
const DOOR_PAIR_SLACK = 4;

/** True if the door lists two different rooms that still exist. */
export function doorDoublyConnected(doc, door) {
  if (!door || door.kind !== "doorway") return false;
  const a = roomById(doc, door.roomId);
  const b = roomById(doc, door.otherRoomId);
  return !!(a && b && a.id !== b.id);
}

/** Closest room, plus a second room across the same portal if still close. */
export function inferDoorRoomPair(doc, door, loose = false) {
  if (!door || door.kind !== "doorway") return { room: null, other: null };
  const scored = doorRoomScores(door, roomsOf(doc));
  if (!scored.length || scored[0].score >= 50) return { room: null, other: null };
  const best = scored[0];
  const closeLimit = loose ? DOOR_PAIR_LOOSE : Math.min(DOOR_PAIR_MAX, best.score + DOOR_PAIR_SLACK);
  let otherHit = null;
  for (const hit of scored) {
    if (hit.room.id === best.room.id) continue;
    if (hit.score > closeLimit) continue;
    const opposite = hit.f.axis === best.f.axis && hit.f.sign !== best.f.sign;
    const ranked = opposite ? hit.score : hit.score + 100;
    if (!otherHit || ranked < otherHit.ranked) otherHit = { hit, ranked };
  }
  return { room: best.room, other: otherHit?.hit.room || null };
}

/** Prefer a room already linked to the door among touching candidates, else the largest contact. */
function pickTouching(list, door) {
  if (!list.length) return null;
  const keep = list.find((h) => h.room.id === door.roomId || h.room.id === door.otherRoomId);
  return (keep || list[0]).room;
}

/**
 * Set roomId / otherRoomId from geometry only: a room counts when its hull
 * touches the door's low or high plane. Untouched sides become null.
 * Keeps the current owner when it still touches. Does not move or resize the
 * door. Returns true if a link changed.
 */
export function relinkDoorToRooms(rooms, door) {
  if (!door || door.kind !== "doorway") return false;
  const { low, high } = doorTouchingRooms(door, rooms);
  const a = pickTouching(low, door);
  const b = pickTouching(high, door);
  let owner = a || b;
  let other = a && b && a.id !== b.id ? b : null;
  if (other && door.roomId === b.id) {
    owner = b;
    other = a;
  }
  const roomId = owner?.id || null;
  const otherRoomId = other?.id || null;
  const changed = (door.roomId || null) !== roomId || (door.otherRoomId || null) !== otherRoomId;
  door.roomId = roomId;
  door.otherRoomId = otherRoomId;
  return changed;
}

export function relinkDoor(doc, door) {
  return relinkDoorToRooms(roomsOf(doc), door);
}

/** Relink every doorway on every level. Returns the number of doors changed. */
export function relinkAllDoors(doc) {
  let n = 0;
  for (const name of LEVEL_NAMES) {
    const objs = doc.maps?.[name]?.objects;
    if (!Array.isArray(objs)) continue;
    const rooms = objs.filter((o) => o.kind === "room");
    for (const obj of objs) {
      if (relinkDoorToRooms(rooms, obj)) n++;
    }
  }
  return n;
}

/**
 * After a door is placed, moved or rescaled: orient/snap it against the nearest
 * walls (owner as fallback), then take the links from what it actually touches.
 */
export function assignDoorRooms(doc, door, owner, snap = true) {
  if (!door || door.kind !== "doorway") return door;
  const pair = inferDoorRoomPair(doc, door);
  const roomA = pair.room || owner || roomById(doc, door.roomId);
  const roomB = pair.other || null;
  if (snap) snapDoorBetweenRooms(door, roomA, roomB);
  else orientDoorToRooms(door, roomA, roomB);
  relinkDoor(doc, door);
  return door;
}

export function neighbourRooms(doc, room) {
  if (!room) return [];
  const doors = doorwaysOf(doc);
  const out = [];
  for (const other of roomsOf(doc)) {
    if (other.id === room.id) continue;
    const linked = doors.some(
      (d) =>
        (d.roomId === room.id && d.otherRoomId === other.id) ||
        (d.roomId === other.id && d.otherRoomId === room.id)
    );
    if (linked) out.push(other);
  }
  return out;
}

/** Enabled spawn, or the first spawn when none are marked. */
function activeSpawnObject(doc) {
  const spawns = activeMap(doc).objects.filter((o) => o.kind === "spawn");
  if (!spawns.length) return null;
  return spawns.find((s) => s.enabled) || spawns[0];
}

/** Selected room, or owner of the newest selected object; else lastRoomId; else the active spawn's room. */
export function localFocusRoom(doc, selectedIds, lastId) {
  const ids = Array.isArray(selectedIds) ? selectedIds : [];
  const objs = activeMap(doc).objects;
  for (let i = ids.length - 1; i >= 0; i--) {
    const obj = objs.find((o) => o.id === ids[i]);
    if (!obj) continue;
    if (obj.kind === "room") return obj;
    const r = roomById(doc, obj.roomId);
    if (r) return r;
  }
  const remembered = roomById(doc, lastId);
  if (remembered) return remembered;
  const spawn = activeSpawnObject(doc);
  return spawn ? roomById(doc, spawn.roomId) : null;
}

export function localVisibleIds(doc, focus, includeNeighbours) {
  if (!focus) return new Set();
  const rooms = [focus, ...(includeNeighbours ? neighbourRooms(doc, focus) : [])];
  const roomIds = new Set(rooms.map((r) => r.id));
  const ids = new Set(roomIds);
  for (const obj of activeMap(doc).objects) {
    if (obj.kind === "room") continue;
    if (roomIds.has(obj.roomId) || (obj.kind === "doorway" && roomIds.has(obj.otherRoomId))) {
      ids.add(obj.id);
    }
  }
  return ids;
}

export function objectVisible(doc, obj, localMode, focus, neighbours, roomsOnly) {
  if (roomsOnly && obj.kind !== "room" && obj.kind !== "doorway") return false;
  if (!localMode) return true;
  return localVisibleIds(doc, focus, neighbours).has(obj.id);
}

const BASE_SKELETON = [
  [-3, 6, 0],
  [3, 6, 0],
  [0, 14, 0],
  [0, 20, 0],
  [-6, 11, 0],
  [-8, 7, 0],
  [6, 11, 0],
  [8, 7, 0],
  [-3, 3, 0],
  [-3, 0, 0],
  [3, 3, 0],
  [3, 0, 0],
  [8, 8, 8],
];

const TEMPLATE_LINES = [
  [0, 1],
  [1, 2],
  [2, 0],
  [2, 3],
  [2, 4],
  [4, 5],
  [2, 6],
  [6, 7],
  [0, 8],
  [8, 9],
  [1, 10],
  [10, 11],
  [7, 12],
];

function skeletonBase(type) {
  const [sx, sy, sz] = type.scale;
  return BASE_SKELETON.map((p, i) => {
    const r = type.rest[i] || [0, 0, 0];
    return [
      Math.round(p[0] * sx + r[0]),
      Math.round(p[1] * sy + r[1]),
      Math.round(p[2] * sz + r[2]),
    ];
  });
}

function enemyTypeByName(name) {
  return ENEMY_TYPES.find((t) => t.name === name) || ENEMY_TYPES[0];
}

export function restSkeletonHeight(name) {
  const base = skeletonBase(enemyTypeByName(name));
  let maxY = 1;
  for (const p of base) {
    if (p[1] > maxY) maxY = p[1];
  }
  return maxY;
}

export function emptyMdlRig() {
  return { jointVerts: Array.from({ length: 13 }, () => []) };
}

export function normalizeMdlRig(raw, nv = 13) {
  const n = nv | 0;
  const rig = { jointVerts: Array.from({ length: n }, () => []) };
  const src = raw?.jointVerts;
  if (!Array.isArray(src)) return rig;
  for (let i = 0; i < n; i++) {
    const list = src[i];
    if (!Array.isArray(list)) continue;
    const seen = new Set();
    for (const v of list) {
      const idx = v | 0;
      if (idx < 0 || seen.has(idx)) continue;
      seen.add(idx);
      rig.jointVerts[i].push(idx);
    }
  }
  return rig;
}

function parseSkelLines(raw, nv) {
  const out = [];
  const seen = new Set();
  for (const pair of raw || []) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    let a = pair[0] | 0;
    let b = pair[1] | 0;
    if (a === b || a < 0 || b < 0 || a >= nv || b >= nv) continue;
    if (a > b) {
      const t = a;
      a = b;
      b = t;
    }
    const k = `${a},${b}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([a, b]);
    if (out.length >= SKEL_MAX_LINES) break;
  }
  return out;
}

function inferSkelNv(raw) {
  let n;
  const joints = raw?.mdlRig?.jointVerts;
  if (Array.isArray(joints)) n = joints.length;
  else if ((raw?.verts | 0) > 0) n = raw.verts | 0;
  else if (Array.isArray(raw?.frames?.[0])) n = raw.frames[0].length;
  else n = 13;
  if (n < 0) n = 0;
  if (n > SKEL_MAX_VERTS) n = SKEL_MAX_VERTS;
  return n;
}

/** melee/shoot stays a cue name. A legacy SOUND_ stem stays uppercased for migrateClipSounds. */
function parseClipSound(raw) {
  const stem = String(raw || "").trim();
  if (!stem) return "";
  const cue = stem.toLowerCase();
  if (ENEMY_ATTACK_CUES.includes(cue)) return cue;
  return stem.toUpperCase().replace(/^SOUND_/, "");
}

/** Map a legacy stem onto the attack cue whose path ident matches. Drop anything else. */
function cuePathIdent(path) {
  let rest = String(path || "").replace(/\\/g, "/");
  if (rest.toLowerCase().startsWith("sound/")) rest = rest.slice(6);
  if (rest.toLowerCase().endsWith(".wav")) rest = rest.slice(0, -4);
  const ident = rest.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  return ident || "SFX";
}

function migrateClipSounds(clips, cues) {
  if (!Array.isArray(clips)) return;
  const byIdent = new Map();
  for (const cue of ENEMY_ATTACK_CUES) {
    const path = cues?.[cue];
    if (!path || byIdent.has(cuePathIdent(path))) continue;
    byIdent.set(cuePathIdent(path), cue);
  }
  for (const c of clips) {
    if (!c?.sound) continue;
    if (ENEMY_ATTACK_CUES.includes(c.sound)) continue;
    const cue = byIdent.get(String(c.sound).trim().toUpperCase().replace(/^SOUND_/, ""));
    if (cue) c.sound = cue;
    else {
      delete c.sound;
      delete c.soundFrame;
    }
  }
}

function migrateEnemyClipSounds(enemy) {
  migrateClipSounds(enemy.clips, enemy.cues);
}

/** Clip name + optional sound. start/len are filled when poses are derived. */
function parseClipMeta(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const c of raw) {
    const name = String(c?.name || "").trim();
    if (!name || name === "legacy" || seen.has(name)) continue;
    seen.add(name);
    const clip = { name, start: c?.start | 0, len: Math.max(1, c?.len | 0) };
    if (Array.isArray(c?.sprites)) clip.sprites = c.sprites.map((s) => String(s || "A").slice(0, 1));
    const sound = parseClipSound(c?.sound);
    if (sound) {
      clip.sound = sound;
      clip.soundFrame = Math.max(0, c.soundFrame | 0);
    }
    const attackFrame = clampAttackFrame(c?.attackFrame, clip.len);
    if (attackFrame != null) clip.attackFrame = attackFrame;
    out.push(clip);
  }
  return out;
}

function persistClip(c) {
  const out = { name: c.name };
  if (Array.isArray(c.sprites)) {
    out.start = c.start | 0;
    out.len = c.len | 0;
    out.sprites = c.sprites.map((s) => String(s || "A").slice(0, 1));
  }
  if (c.sound) {
    out.sound = c.sound;
    out.soundFrame = c.soundFrame | 0;
  }
  if (c.attackFrame != null) out.attackFrame = c.attackFrame | 0;
  return out;
}

export function enemyHasSprites(e) {
  return (e?.clips || []).some((c) => Array.isArray(c.sprites) && c.sprites.length);
}

export function enemyFileRecords(doc) {
  return (doc.enemies || [])
    .map((e) => ({ dos: ENEMY_DOS[e.name], data: persistEnemy(e) }))
    .filter((r) => r.dos);
}

function xzCenterDist2(a, b) {
  const ac = aabbCenter(a);
  const bc = aabbCenter(b);
  const dx = ac.x - bc.x;
  const dz = ac.z - bc.z;
  return dx * dx + dz * dz;
}

function mintElevTag(elev, used) {
  const raw = String(elev.id || "").replace(/[^a-z0-9]/gi, "");
  const stem = clampTag("e" + raw) || "e";
  let tag = stem;
  let n = 1;
  while (used.has(tag)) {
    const suf = String(n++);
    if (suf.length >= MAX_TAG_LEN) break;
    tag = clampTag(stem.slice(0, MAX_TAG_LEN - suf.length) + suf);
  }
  return tag;
}

/** Blank elevator/summon tags copy the nearest elevator (xz centers). Returns true if a tag was written. */
export function assignNearestElevatorTags(objects) {
  if (!Array.isArray(objects) || !objects.length) return false;
  const elevs = objects.filter((o) => o.kind === "elevator");
  if (!elevs.length) return false;
  const used = new Set();
  for (const o of objects) {
    const tag = clampTag(o?.tag || "");
    if (tag) used.add(tag);
    const enable = clampTag(o?.enableTag || "");
    if (enable) used.add(enable);
  }
  let changed = false;
  for (const t of objects) {
    if (t.kind !== "trigger") continue;
    const purpose = clampTriggerPurpose(t.purpose);
    if (purpose !== "elevator" && purpose !== "summon") continue;
    if (clampTag(t.tag || "")) continue;
    let best = null;
    let bestD = Infinity;
    for (const e of elevs) {
      const d = xzCenterDist2(t, e);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (!best) continue;
    let tag = clampTag(best.tag || "");
    if (!tag) {
      tag = mintElevTag(best, used);
      best.tag = tag;
      used.add(tag);
    }
    t.tag = tag;
    changed = true;
  }
  return changed;
}

export function mapFileRecords(doc) {
  let tagsFilled = false;
  relinkAllDoors(doc);
  const namesFilled = assignRoomNames(doc);
  const records = LEVEL_NAMES.map((name) => {
    const map = doc.maps?.[name] || {};
    const objects = Array.isArray(map.objects) ? map.objects : [];
    if (assignNearestElevatorTags(objects)) tagsFilled = true;
    return {
      file: `${name.toLowerCase()}.json`,
      data: {
        name: clampName(map.name),
        enterVerb: clampVerb(map.enterVerb),
        jumpSpeed: clampJumpSpeed(map.jumpSpeed),
        gravity: clampGravity(map.gravity),
        objects,
      },
    };
  });
  records.tagsFilled = tagsFilled;
  records.namesFilled = namesFilled;
  return records;
}

function persistFrames(frames, fine) {
  const q = fine
    ? (n) => clampSpriteVert(n)
    : (n) => Math.round(n || 0);
  return (frames || []).map((fr) =>
    (fr || []).map((v) => ({
      x: q(v?.x || 0),
      y: q(v?.y || 0),
      z: q(v?.z || 0),
    }))
  );
}

function persistEnemy(e) {
  const out = { ...e };
  delete out.spriteScale;
  if (enemyHasSprites(e)) out.frames = persistFrames(e.frames, true);
  else delete out.frames;
  out.cues = parseEnemyCues(e.cues);
  if (Array.isArray(out.clips)) out.clips = out.clips.map(persistClip);
  delete out.stockGraph;
  delete out.customGraph;
  return out;
}

/** Drop unbound stock joints 0–12 copied in when custom mode kept the humanoid. */
function stripInheritedStockJoints(enemy) {
  const joints = enemy.mdlRig?.jointVerts;
  if (!Array.isArray(joints) || joints.length < 13) return;
  for (let i = 0; i < 13; i++) {
    if (joints[i]?.length) return;
  }
  if (enemy.lines.some(([a, b]) => (a | 0) >= 13 || (b | 0) >= 13)) return;
  const extra = joints.slice(13).map((list) => [...list]);
  enemy.mdlRig = { jointVerts: extra };
  enemy.verts = extra.length;
  enemy.lines = [];
  enemy.frames = [restPoseFrame(enemy.name, extra.length)];
}

export function dummyFrameFor(name) {
  const base = skeletonBase(enemyTypeByName(name));
  return base.map((p) => ({
    x: clampVert(p[0]),
    y: clampVert(p[1]),
    z: clampVert(p[2]),
  }));
}

/** One rest pose. Poses are derived from the binding once ID1 is open. nv 0 is an empty custom rig. */
export function restPoseFrame(name, nv) {
  const n = Math.max(0, nv | 0);
  if (!n) return [];
  const base = dummyFrameFor(name);
  const frame = [];
  for (let i = 0; i < n; i++) {
    const v = base[i] || { x: 0, y: 0, z: 0 };
    frame.push({ x: v.x, y: v.y, z: v.z });
  }
  return frame;
}

export function createEnemy(name = "Possessed") {
  return {
    id: uid(),
    name,
    verts: 13,
    lines: TEMPLATE_LINES.map((p) => [p[0], p[1]]),
    frames: [dummyFrameFor(name)],
    clips: [],
    cues: {},
    mdlRig: emptyMdlRig(),
    customSkeleton: true,
    weaponVert: WEAPON_VERT,
    hp: defaultEnemyHp(name),
    painChance: defaultEnemyPainChance(name),
    blockR: DEFAULT_ENEMY_BLOCK_R,
  };
}

export function createAllCreatures() {
  return ENEMY_TYPES.map((t) => createEnemy(t.name));
}

function migrateDoorLock(o) {
  if (o.lockKey != null) return clampDoorLock(o.lockKey);
  if (o.locked) {
    const t = String(o.keyTag || o.tag || "").toLowerCase();
    if (t.includes("red")) return "red";
    return t.includes("gold") || t.includes("blue") ? "blue" : "yellow";
  }
  return "unlocked";
}

function migrateLoadedObject(o) {
  if (!o || typeof o !== "object") return o;
  const out = { ...o };
  if (out.kind === "backpack") {
    out.kind = "pickup";
    out.pickup = out.pickup || out.backpack;
  }
  if (out.kind === "key") {
    out.kind = "pickup";
    const t = `${out.tag || ""} ${out.keyTag || ""} ${out.pickup || ""}`.toLowerCase();
    if (t.includes("red")) out.pickup = "red keycard";
    else if (t.includes("gold") || t.includes("blue")) out.pickup = "blue keycard";
    else out.pickup = "yellow keycard";
  }
  if (out.kind === "doorway") out.lockKey = migrateDoorLock(out);
  return out;
}

function parseObjects(list) {
  const out = [];
  for (const raw of list || []) {
    const o = migrateLoadedObject(raw);
    if (!KINDS[o.kind]) continue;
    const obj = createObject(o.kind, o.x, o.y, o.z, {
      id: o.id,
      face: o.face,
      axis: o.axis,
      dir: o.dir,
      flags: o.flags,
      allEdges: o.allEdges,
      enemy: o.enemy,
      shootable: o.shootable,
      endLevel: o.endLevel,
      rot: o.rot,
      text: o.text,
      purpose: o.purpose,
      name: o.name,
      tag: o.tag,
      enableTag: o.enableTag,
      lockKey: o.lockKey,
      doorType: o.doorType,
      doorScale: o.doorScale,
      hidden: o.hidden,
      locked: o.locked,
      keyTag: o.keyTag,
      elevAuto: o.elevAuto,
      elevLow: o.elevLow,
      elevHigh: o.elevHigh,
      elevSlow: o.elevSlow,
      pickup: o.pickup,
      backpack: o.backpack,
      big: o.big,
      scale: o.scale,
      order: o.order,
      collide: o.collide,
      enabled: o.enabled,
      a8Bg: o.a8Bg,
      bgColor: o.bgColor,
      skyColor: o.skyColor,
      shape: o.shape,
      rx: o.rx,
      ry: o.ry,
      rz: o.rz,
      cuts: o.cuts,
      cutU: o.cutU,
      cutV: o.cutV,
      stemW: o.stemW,
      stemPos: o.stemPos,
      barD: o.barD,
      shift: o.shift,
      mid: o.mid,
      roomId: o.roomId,
      otherRoomId: o.otherRoomId,
    });
    if (!KINDS[o.kind].fixed) {
      obj.sx = o.sx ?? obj.sx;
      obj.sy = o.sy ?? obj.sy;
      obj.sz = o.sz ?? obj.sz;
    }
    if (o.kind === "enemy" || o.kind === "spawn") {
      if (o.kind === "enemy") {
        const name = o.enemy || "";
        if (!ENEMY_TYPES.some((t) => t.name === name)) continue;
        obj.enemy = name;
        const et = clampTag(o.tag);
        if (et) obj.tag = et;
      }
      if (o.rot != null) obj.rot = o.rot;
    }
    if (o.kind === "trigger") {
      if (o.text != null) obj.text = clampTriggerText(o.text);
      if (o.purpose != null) obj.purpose = clampTriggerPurpose(o.purpose);
      if (o.tag != null) obj.tag = clampTag(o.tag);
      if (o.enableTag != null) obj.enableTag = clampTag(o.enableTag);
    }
    if (o.kind === "room") {
      if (o.name != null) obj.name = clampName(o.name);
      if (o.a8Bg != null || o.bgColor != null || o.skyColor != null) obj.a8Bg = roomBgFromJson(o);
      delete obj.bgColor;
      delete obj.lineColor;
      delete obj.fxColor;
      delete obj.weaponColor;
      if (o.shape != null) obj.shape = clampRoomShape(o.shape);
      if (o.rx != null) obj.rx = o.rx | 0;
      if (o.ry != null) obj.ry = o.ry | 0;
      if (o.rz != null) obj.rz = o.rz | 0;
      if (Array.isArray(o.cuts)) obj.cuts = o.cuts.map((c) => ({ su: c.su | 0, sv: c.sv | 0 }));
      if (o.cutU != null) obj.cutU = o.cutU | 0;
      if (o.cutV != null) obj.cutV = o.cutV | 0;
      if (o.stemW != null) obj.stemW = o.stemW | 0;
      if (o.stemPos != null) obj.stemPos = o.stemPos | 0;
      if (o.barD != null) obj.barD = o.barD | 0;
      if (o.shift != null) obj.shift = o.shift | 0;
      if (o.mid != null) obj.mid = o.mid | 0;
      delete obj.skyColor;
      delete obj.floorColor;
    }
    if (o.kind !== "room") {
      if (o.roomId != null) obj.roomId = String(o.roomId);
    }
    if (usesLinkTag(o.kind) && o.tag != null) obj.tag = clampTag(o.tag);
    if (o.kind === "elevator") {
      obj.elevAuto = o.elevAuto !== false;
      if (o.elevLow != null) obj.elevLow = o.elevLow | 0;
      if (o.elevHigh != null) obj.elevHigh = o.elevHigh | 0;
      if (o.elevSlow) obj.elevSlow = true;
      else delete obj.elevSlow;
      delete obj.elevType;
    }
    if (o.kind === "pickup" || o.kind === "backpack") {
      obj.pickup = clampPickupType(o.pickup || o.backpack);
    }
    if (o.kind === "doorway") {
      obj.lockKey = migrateDoorLock(o);
      if (o.otherRoomId != null) obj.otherRoomId = String(o.otherRoomId);
      if (o.tag != null) obj.tag = clampTag(o.tag);
    }
    if (o.kind === "platform" && o.collide != null) obj.collide = o.collide !== false;
    if (o.kind === "spawn") {
      obj.enabled = o.enabled === true;
      if (o.showJump) obj.showJump = true;
    }
    out.push(clampObject(obj));
  }
  ensureSpawnExclusive(out);
  return out;
}

function starterObjects() {
  const roomA = createObject("room", 8, 0, 8, { name: "Start" });
  roomA.sx = 24;
  roomA.sy = 12;
  roomA.sz = 24;
  const roomB = createObject("room", 31, 0, 8, { name: "Next" });
  roomB.sx = 24;
  roomB.sy = 12;
  roomB.sz = 24;
  const door = createObject("doorway", 31, 0, 16, { face: "+x", roomId: roomA.id, otherRoomId: roomB.id });
  const crate = createObject("crate", 14, 0, 14, { roomId: roomA.id });
  return [roomA, roomB, door, crate];
}

export function defaultEditorState() {
  return {
    mode: "layout",
    localDraw: false,
    neighbourDraw: false,
    roomsOnlyDraw: false,
    selectedIds: [],
    enemy: "Possessed",
    frameIndex: 0,
    clipIndex: 0,
    frameLocal: 0,
    selectedVerts: [],
    layoutCamera: { x: 28, y: 10, z: -6, yaw: 0.35, pitch: -0.2, speed: 28 },
    animOrbit: { yaw: 0.5, pitch: 0.15, dist: 48 },
    mdlScale: DEFAULT_MDL_SCALE,
    weapon: "shot2",
    weaponFrame: 0,
    overlayOn: true,
    orthoMode: "top",
    collapsedRooms: [],
    activeLevel: null,
    layoutCameras: {},
    item: "backpack",
    itemOrbit: { yaw: 0.6, pitch: 0.35, dist: 16, target: { x: 0, y: 0, z: 0 } },
    fontSlots: [null, null, null, null],
    fontActive: 0,
  };
}

export function clampWeaponScale(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_WEAPON_SCALE;
  return Math.max(0.05, Math.min(8, v));
}

function parseWeaponPan(raw) {
  return {
    x: Number.isFinite(Number(raw?.x)) ? Number(raw.x) : 0,
    y: Number.isFinite(Number(raw?.y)) ? Number(raw.y) : 0,
  };
}

function parseWeaponItem(raw) {
  const pan = parseWeaponPan(raw?.pan);
  let frames = null;
  if (Array.isArray(raw?.frames)) {
    const seen = new Set();
    frames = [];
    for (const f of raw.frames) {
      const n = f | 0;
      if (n < 0 || n > 4095 || seen.has(n)) continue;
      seen.add(n);
      frames.push(n);
    }
  }
  return { pan, frames };
}

export function defaultWeapons() {
  const items = {};
  for (const key of WEAPON_KEYS) {
    items[key] = { pan: { x: 0, y: 0 }, frames: null };
  }
  return { scale: DEFAULT_WEAPON_SCALE, items };
}

export function parseWeapons(raw) {
  const d = defaultWeapons();
  if (!raw || typeof raw !== "object") return d;
  d.scale = clampWeaponScale(raw.scale);
  const src = raw.items && typeof raw.items === "object" ? raw.items : raw;
  for (const key of WEAPON_KEYS) {
    d.items[key] = parseWeaponItem(src[key]);
  }
  return d;
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseLayoutCamera(raw, fallback) {
  return {
    x: num(raw?.x, fallback.x),
    y: num(raw?.y, fallback.y),
    z: num(raw?.z, fallback.z),
    yaw: num(raw?.yaw, fallback.yaw),
    pitch: num(raw?.pitch, fallback.pitch),
    speed: Math.max(6, Math.min(80, num(raw?.speed, fallback.speed))),
  };
}

export function parseEditorState(raw) {
  const d = defaultEditorState();
  if (!raw || typeof raw !== "object") return d;
  if (
    raw.mode === "anim" ||
    raw.mode === "layout" ||
    raw.mode === "weapons" ||
    raw.mode === "items" ||
    raw.mode === "font" ||
    raw.mode === "build"
  ) {
    d.mode = raw.mode;
  }
  if (Array.isArray(raw.fontSlots)) {
    d.fontSlots = d.fontSlots.map((_, i) => {
      const c = raw.fontSlots[i];
      return Number.isInteger(c) && c >= 32 && c <= 127 ? c : null;
    });
  }
  d.fontActive = Math.max(0, Math.min(3, num(raw.fontActive, 0) | 0));
  d.localDraw = !!raw.localDraw;
  d.neighbourDraw = !!raw.neighbourDraw;
  d.roomsOnlyDraw = !!raw.roomsOnlyDraw;
  if (Array.isArray(raw.selectedIds)) d.selectedIds = raw.selectedIds.map(String);
  if (typeof raw.enemy === "string" && raw.enemy) d.enemy = raw.enemy;
  d.frameIndex = Math.max(0, num(raw.frameIndex, 0) | 0);
  d.clipIndex = Math.max(0, num(raw.clipIndex, 0) | 0);
  d.frameLocal = Math.max(0, num(raw.frameLocal, 0) | 0);
  if (Array.isArray(raw.selectedVerts)) {
    d.selectedVerts = raw.selectedVerts.map((i) => i | 0).filter((i) => i >= 0 && i < SKEL_MAX_VERTS);
  }
  const cam = raw.layoutCamera || {};
  d.layoutCamera = parseLayoutCamera(cam, d.layoutCamera);
  d.layoutCameras = {};
  if (raw.layoutCameras && typeof raw.layoutCameras === "object") {
    for (const name of LEVEL_NAMES) {
      if (raw.layoutCameras[name]) {
        d.layoutCameras[name] = parseLayoutCamera(raw.layoutCameras[name], d.layoutCamera);
      }
    }
  }
  const camLevel =
    typeof raw.activeLevel === "string" && LEVEL_NAMES.includes(raw.activeLevel)
      ? raw.activeLevel
      : d.activeLevel || LEVEL_NAMES[0];
  if (raw.layoutCamera && !d.layoutCameras[camLevel]) {
    d.layoutCameras[camLevel] = { ...d.layoutCamera };
  }
  const orb = raw.animOrbit || {};
  d.animOrbit = {
    yaw: num(orb.yaw, d.animOrbit.yaw),
    pitch: num(orb.pitch, d.animOrbit.pitch),
    dist: Math.max(ANIM_ORBIT_DIST_MIN, Math.min(ANIM_ORBIT_DIST_MAX, num(orb.dist, d.animOrbit.dist))),
  };
  const scaleIn = raw.mdlScale;
  const scaleNum = Number(scaleIn);
  if (scaleIn == null || !Number.isFinite(scaleNum) || Math.abs(scaleNum - OLD_DEFAULT_MDL_SCALE) < 1e-6) {
    d.mdlScale = DEFAULT_MDL_SCALE;
  } else {
    d.mdlScale = clampMdlScale(scaleNum);
  }
  if (typeof raw.weapon === "string" && WEAPON_KEYS.includes(raw.weapon)) d.weapon = raw.weapon;
  d.weaponFrame = Math.max(0, num(raw.weaponFrame, 0) | 0);
  if (raw.overlayOn != null) d.overlayOn = !!raw.overlayOn;
  if (raw.orthoMode === "top" || raw.orthoMode === "left" || raw.orthoMode === "forward") {
    d.orthoMode = raw.orthoMode;
  }
  if (Array.isArray(raw.collapsedRooms)) d.collapsedRooms = raw.collapsedRooms.map(String);
  if (typeof raw.activeLevel === "string" && LEVEL_NAMES.includes(raw.activeLevel)) {
    d.activeLevel = raw.activeLevel;
  } else {
    d.activeLevel = null;
  }
  if (typeof raw.item === "string" && allMeshKeys().includes(raw.item)) d.item = raw.item;
  const io = raw.itemOrbit || {};
  const tgt = io.target || {};
  d.itemOrbit = {
    yaw: num(io.yaw, d.itemOrbit.yaw),
    pitch: Math.max(-1.2, Math.min(1.2, num(io.pitch, d.itemOrbit.pitch))),
    dist: Math.max(ITEM_ORBIT_DIST_MIN, Math.min(ITEM_ORBIT_DIST_MAX, num(io.dist, d.itemOrbit.dist))),
    target: {
      x: num(tgt.x, d.itemOrbit.target.x),
      y: num(tgt.y, d.itemOrbit.target.y),
      z: num(tgt.z, d.itemOrbit.target.z),
    },
  };
  return d;
}

/** Game JSON only — no editor camera/tab/selection. */
export function gameDocument(doc) {
  return {
    version: doc.version,
    weapons: doc.weapons,
    items: doc.items,
    customItems: doc.customItems || [],
    itemMeta: doc.itemMeta || {},
  };
}

export function createDefaultDocument() {
  setCustomItemNames([]);
  syncItemRegistry({});
  const maps = {};
  for (const name of LEVEL_NAMES) maps[name] = emptyMap();
  maps.E1M1 = { name: "Slipgate Complex", objects: starterObjects() };
  return {
    version: DOC_VERSION,
    activeLevel: "E1M1",
    maps,
    enemies: createAllCreatures(),
    weapons: defaultWeapons(),
    items: defaultItemMeshes(),
    customItems: [],
    itemMeta: {},
    font: fontBlank(),
  };
}

export function cloneDoc(doc) {
  return JSON.parse(JSON.stringify(doc));
}

function nudgeDoorsOutside(doc) {
  for (const name of LEVEL_NAMES) {
    const map = doc.maps[name];
    if (!map) continue;
    const rooms = map.objects.filter((o) => o.kind === "room");
    const byId = new Map(rooms.map((r) => [r.id, r]));
    for (const obj of map.objects) {
      if (obj.kind !== "doorway") continue;
      const room = byId.get(obj.roomId) || byId.get(obj.otherRoomId);
      if (room) nudgeDoorOutside(obj, room);
    }
  }
}

function migrateRoomParents(doc) {
  for (const name of LEVEL_NAMES) {
    const map = doc.maps[name];
    if (!map) continue;
    const rooms = map.objects.filter((o) => o.kind === "room");
    for (const obj of map.objects) {
      if (obj.kind === "room") continue;
      if (obj.kind === "doorway") continue; // links come from relinkAllDoors (geometry)
      if (obj.roomId) continue;
      const hits = rooms.filter((r) => aabbOverlap(obj, r));
      if (!hits.length) {
        obj.roomId = null;
        continue;
      }
      hits.sort((a, b) => aabbVolume(a) - aabbVolume(b));
      obj.roomId = hits[0].id;
    }
  }
}

export function normalizeDocument(raw) {
  const doc = createDefaultDocument();
  if (!raw || typeof raw !== "object") return doc;
  const fromVersion = Number(raw.version) || 0;
  // Custom item names first: object normalization below clamps pickup names against them.
  const customItems = parseCustomItems(raw.customItems);
  setCustomItemNames(customItems);
  const itemMetaParsed = parseItemMetaMap(raw.itemMeta, customItems);
  syncItemRegistry(itemMetaParsed);
  if (raw.maps && typeof raw.maps === "object") {
    for (const name of LEVEL_NAMES) {
      const src = raw.maps[name] || {};
      doc.maps[name] = {
        name: clampName(src.name),
        enterVerb: clampVerb(src.enterVerb),
        jumpSpeed: clampJumpSpeed(src.jumpSpeed),
        gravity: clampGravity(src.gravity),
        objects: parseObjects(src.objects),
      };
    }
  } else {
    doc.maps.E1M1 = {
      name: clampName(raw.map?.name),
      enterVerb: clampVerb(raw.map?.enterVerb),
      jumpSpeed: clampJumpSpeed(raw.map?.jumpSpeed),
      gravity: clampGravity(raw.map?.gravity),
      objects: parseObjects(raw.map?.objects || raw.objects),
    };
  }
  doc.activeLevel = LEVEL_NAMES.includes(raw.activeLevel) ? raw.activeLevel : "E1M1";
  doc.enemies = [];
  const stale = !raw.version || raw.version < 2;
  if (stale) {
    doc.enemies = createAllCreatures();
  } else {
    const enemies = raw.enemies || [];
    for (const e of enemies) {
      const enemy = createEnemy(e.name || "Enemy");
      enemy.id = e.id || enemy.id;
      enemy.name = e.name || enemy.name;
      enemy.customSkeleton = true;
      const nv = inferSkelNv(e);
      enemy.verts = nv;
      enemy.lines = parseSkelLines(e.lines, nv);
      enemy.frames = [restPoseFrame(enemy.name, nv)];
      enemy.mdlRig = normalizeMdlRig(e.mdlRig, nv);
      delete enemy.stockGraph;
      delete enemy.customGraph;
      if (!enemyHasSprites({ clips: e.clips })) stripInheritedStockJoints(enemy);
      enemy.clips = parseClipMeta(e.clips);
      if (enemyHasSprites({ clips: enemy.clips }) && Array.isArray(e.frames) && e.frames.length) {
        enemy.frames = e.frames.map((fr) =>
          (fr || []).map((v) => ({
            x: clampSpriteVert(v?.x || 0),
            y: clampSpriteVert(v?.y || 0),
            z: clampSpriteVert(v?.z || 0),
          }))
        );
        enemy.verts = enemy.frames[0]?.length || enemy.verts;
        while (enemy.mdlRig.jointVerts.length < enemy.verts) enemy.mdlRig.jointVerts.push([]);
      }
      enemy.cues = parseEnemyCues(e.cues);
      migrateEnemyClipSounds(enemy);
      enemy.weaponVert = clampWeaponVert(e.weaponVert, enemy.verts);
      enemy.hp = clampEnemyHp(e.hp, enemy.name);
      enemy.painChance = clampEnemyPainChance(e.painChance, enemy.name);
      enemy.blockR = clampEnemyBlockR(e.blockR);
      const exportClips = normalizeExportClips(e.exportClips);
      if (exportClips) enemy.exportClips = exportClips;
      doc.enemies.push(enemy);
    }
    const have = new Set(doc.enemies.map((e) => e.name));
    for (const t of ENEMY_TYPES) {
      if (!have.has(t.name)) doc.enemies.push(createEnemy(t.name));
    }
  }
  if (!doc.enemies.length) doc.enemies = createAllCreatures();
  if (fromVersion < 7) migrateRoomParents(doc);
  if (fromVersion < 7) relinkAllDoors(doc);
  nudgeDoorsOutside(doc);
  relinkAllDoors(doc);
  doc.version = DOC_VERSION;
  doc.weapons = parseWeapons(raw.weapons);
  doc.customItems = customItems;
  doc.itemMeta = itemMetaParsed;
  doc.items = parseItemMeshes(migrateItemMeshes(raw.items, fromVersion));
  doc.font = normalizeFont(raw.font);
  doc.editor = parseEditorState(raw.editor);
  doc.enemies = (doc.enemies || []).filter((e) => DOOM_SPRITE_PREFIX[e.name]);
  if (!doc.enemies.length) {
    doc.enemies = createAllCreatures().filter((e) => DOOM_SPRITE_PREFIX[e.name]);
  }
  return doc;
}
