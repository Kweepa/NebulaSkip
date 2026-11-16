import {
  WORLD_MAX,
  WORLD_MIN,
  activeMap,
  clampEnemyRot,
  clampItemScale,
  clampPickupType,
  itemMeshFor,
  itemMeshHasGeom,
  roomById,
  uid,
} from "./model.js";

/*
 * Cutscene data (map.cutscene) and its bake. Pure: no DOM.
 *
 * map.cutscene = { roomId, duration, starfield, actors[] }
 *   roomId    id of the room set aside for the cutscene (null = none)
 *   duration  seconds, CUT_DUR_MIN..CUT_DUR_MAX
 *   starfield true = scatter of CUT_STAR_COUNT stars behind everything (see STARS)
 *   actors[]  { id, kind: "item"|"camera", x,y,z, path:[{x,y,z}], facing, ... }
 *     item    item (key), scale (1/2/4/8), yaw (0..255 like the camera; old files: rot octant * 32), facing "fixed"|"path"
 *     camera  yaw (0..255 game units, 256 = turn, 0 = +Z, 64 = +X), facing "fixed"|"path"|"target",
 *             target (actor id). x,y,z is the EYE position, used as is (items draw at x,y,z plus
 *             ITEM_WORLD_BIAS = 1 on X/Z, the camera has no bias). The game projector is yaw-only: no pitch.
 *
 * BAKE SPEC (tools/gencutscene.py implements the same; keep them in step):
 *   ns        = ceil(durMs / CUT_STEP_MS) + 1 samples, sample i at t = i * CUT_STEP_MS ms,
 *               durMs = round(duration * 1000), u_i = min(t_i / durMs, 1).
 *   spline    >= 2 path points P0..Pn-1, uniform Catmull-Rom, phantom ends P-1 = 2P0 - P1, Pn = 2Pn-1 - Pn-2.
 *             Segment k (0..n-2) uses P[k-1], P[k], P[k+1], P[k+2], local t in 0..1:
 *               0.5 * (2 P1 + (-P0 + P2) t + (2 P0 - 5 P1 + 4 P2 - P3) t^2 + (-P0 + 3 P1 - 3 P2 + P3) t^3)
 *             spline parameter s = k + t, s in 0..n-1.
 *   speed     arc-length table with CUT_ARC_SUB subdivisions per segment (chord lengths, 3D);
 *             distance d = e(u) * total; find table interval, linear s inside it. The actor's `ease`
 *             picks e: linear = u (constant speed), out = 1 - (1-u)^2 (slows to a stop at the end),
 *             in = u^2, inout = u^2 (3 - 2u). Only path actors use it.
 *   position  spline(s), clamped to 0..255+255/256, rounded: floor(v * 256 + 0.5) / 256.
 *   yaw       fixed  -> the actor's yaw.
 *             path   -> atan2(dx, dz) of the analytic derivative at s (ends: t = 0 / t = 1 of the end
 *                       segment); degenerate horizontal tangent keeps the previous sample's yaw
 *                       (first sample: the fixed yaw).
 *             target -> atan2(dx, dz) from the camera to the target actor's unrounded position at the
 *                       same sample. Same degenerate rule.
 *             byte = floor(angle / (2 pi) * 256 + 0.5) mod 256.
 *   ns per actor = full ns when the actor has a path or faces a moving target, else 1.
 * STARS    only when starfield: CUT_STAR_COUNT stars, a fixed scatter from a 16-bit xorshift, seed $ACE1
 *           (one step: x ^= x << 7;  x ^= x >> 9;  x ^= x << 8, all mod 65536). Per star, in order:
 *             step -> (h, l):   fresh position  az = h, row = l >> 1 (0..127)
 *             step -> (h2, l2): clumping and size
 *               if (l2 & 4) == 0 the star is placed near the previous star (prev starts at az 0, row 0):
 *                 az = (prev az + ((l2 >> 3) & 15) - 8) & 255,  row = (prev row + ((h2 >> 3) & 15) - 8) & 127
 *               size class k = h2 & 7: 0 plus (centre + 4 neighbours), 1..2 vertical pair (centre + the
 *               row below), else a single dot. The only visible tones in the room are ink and blood red,
 *               so brightness is size, all ink (pixel 11).
 *           d = signed byte (az - yaw); the star shows when -32 <= d <= 31, centre at colour-clock column
 *           x = 48 + d + (d >> 1) (96 columns = 192 hires px, ~1.5 columns per yaw tick); pixels outside
 *           0..95 / 0..127 are clipped. Drawn before the room. yaw is the camera's byte yaw at the frame.
 *           No pitch exists, so stars never move vertically.
 * Engine playback: i = t >> 7, frac = (t & 127) << 1, linear lerp of position and shortest-arc yaw.
 */

export const CUT_STEP_MS = 128;
export const CUT_ARC_SUB = 32;
export const CUT_DUR_MIN = 0.5;
export const CUT_DUR_MAX = 16;
export const CUT_DUR_DEFAULT = 3;
export const CUT_ACTOR_MAX = 6;
export const CUT_PATH_MAX = 16;
/**
 * Bytes available for the cooked data: the bank-0 static block ends at QS_OVL ($7900) and the
 * overlay code (~830 B) sits in front of the data. tools/gencutscene.py --pack is the real check.
 */
export const CUT_DATA_BUDGET = 2600;
export const CUT_STAR_COUNT = 128;
export const CUT_FACING_ITEM = ["fixed", "path"];
export const CUT_FACING_CAMERA = ["fixed", "path", "target"];
/** Speed along the path: constant, or the distance fraction reshaped over time (see BAKE SPEC). */
export const CUT_EASES = ["linear", "out", "in", "inout"];

const POS_MAX = WORLD_MAX + 255 / 256;

function cutClampCoord(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return WORLD_MIN;
  return Math.max(WORLD_MIN, Math.min(WORLD_MAX, v));
}

export function clampCutDuration(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return CUT_DUR_DEFAULT;
  return Math.min(CUT_DUR_MAX, Math.max(CUT_DUR_MIN, Math.round(v * 8) / 8));
}

function clampYawByte(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 0;
  return ((v % 256) + 256) % 256;
}

export function newCutscene() {
  return { roomId: null, duration: CUT_DUR_DEFAULT, starfield: false, actors: [] };
}

/** A new actor. Items start at (x,y,z) with no path; the camera starts at an eye position. */
export function createCutActor(kind, opts = {}) {
  const base = {
    id: uid(),
    kind,
    x: cutClampCoord(opts.x ?? 128),
    y: cutClampCoord(opts.y ?? 64),
    z: cutClampCoord(opts.z ?? 128),
    path: [],
    facing: "fixed",
    ease: "linear",
  };
  if (kind === "camera") return { ...base, yaw: 0, target: null };
  return { ...base, item: clampPickupType(opts.item ?? "planet"), scale: 1, yaw: 0 };
}

function normalizeActor(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kind = raw.kind === "camera" ? "camera" : raw.kind === "item" ? "item" : null;
  if (!kind) return null;
  const a = createCutActor(kind, { x: raw.x, y: raw.y, z: raw.z, item: raw.item });
  a.id = typeof raw.id === "string" && raw.id ? raw.id : a.id;
  const allowed = kind === "camera" ? CUT_FACING_CAMERA : CUT_FACING_ITEM;
  a.facing = allowed.includes(raw.facing) ? raw.facing : "fixed";
  a.ease = CUT_EASES.includes(raw.ease) ? raw.ease : "linear";
  a.path = Array.isArray(raw.path)
    ? raw.path.slice(0, CUT_PATH_MAX).map((p) => ({ x: cutClampCoord(p?.x), y: cutClampCoord(p?.y), z: cutClampCoord(p?.z) }))
    : [];
  // Items used to carry an octant `rot`; it reads as yaw = rot * 32.
  a.yaw = clampYawByte(raw.yaw ?? (kind === "item" ? clampEnemyRot(raw.rot) * 32 : 0));
  if (kind === "camera") a.target = typeof raw.target === "string" && raw.target ? raw.target : null;
  else a.scale = clampItemScale(raw.scale);
  return a;
}

/** Clean a map's cutscene block. null when it holds nothing (no room, no actors). */
export function normalizeCutscene(raw) {
  if (!raw || typeof raw !== "object") return null;
  const actors = (Array.isArray(raw.actors) ? raw.actors : []).map(normalizeActor).filter(Boolean).slice(0, CUT_ACTOR_MAX);
  const roomId = typeof raw.roomId === "string" && raw.roomId ? raw.roomId : null;
  if (!roomId && !actors.length) return null;
  return { roomId, duration: clampCutDuration(raw.duration), starfield: raw.starfield === true, actors };
}

/** The map's cutscene, created on first use (editing). */
export function ensureCutscene(map) {
  if (!map.cutscene) map.cutscene = newCutscene();
  return map.cutscene;
}

export function cutActorLabel(a, index) {
  if (a.kind === "camera") return "Camera";
  return `${a.item}${index != null ? ` ${index + 1}` : ""}`;
}

/** The actor's start position: path[0] when it has a path, else its own x/y/z. */
export function cutActorStart(a) {
  return a.path.length ? a.path[0] : { x: a.x, y: a.y, z: a.z };
}

export function cutActorMoves(a) {
  return a.path.length >= 2;
}

/* ---- Catmull-Rom ---- */

function crPoint(P, k, t) {
  const n = P.length;
  const at = (i) => {
    if (i < 0) return { x: 2 * P[0].x - P[1].x, y: 2 * P[0].y - P[1].y, z: 2 * P[0].z - P[1].z };
    if (i >= n) {
      return { x: 2 * P[n - 1].x - P[n - 2].x, y: 2 * P[n - 1].y - P[n - 2].y, z: 2 * P[n - 1].z - P[n - 2].z };
    }
    return P[i];
  };
  const p0 = at(k - 1);
  const p1 = at(k);
  const p2 = at(k + 1);
  const p3 = at(k + 2);
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  const g = (a, b, c, d) => 0.5 * (-a + c + 2 * (2 * a - 5 * b + 4 * c - d) * t + 3 * (-a + 3 * b - 3 * c + d) * t2);
  return {
    pos: { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y), z: f(p0.z, p1.z, p2.z, p3.z) },
    tan: { x: g(p0.x, p1.x, p2.x, p3.x), y: g(p0.y, p1.y, p2.y, p3.y), z: g(p0.z, p1.z, p2.z, p3.z) },
  };
}

/** Evaluate at spline parameter s in 0..n-1. */
function crAt(P, s) {
  const n = P.length;
  let k = Math.floor(s);
  if (k >= n - 1) k = n - 2;
  if (k < 0) k = 0;
  return crPoint(P, k, s - k);
}

/** Arc-length table: { s[], len[], total } sampled CUT_ARC_SUB times per segment. */
function arcTable(P) {
  const n = P.length;
  const steps = (n - 1) * CUT_ARC_SUB;
  const s = [];
  const len = [];
  let prev = null;
  let acc = 0;
  for (let j = 0; j <= steps; j++) {
    const sj = j / CUT_ARC_SUB;
    const p = crAt(P, sj).pos;
    if (prev) acc += Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
    s.push(sj);
    len.push(acc);
    prev = p;
  }
  return { s, len, total: acc };
}

function sAtU(table, u) {
  const d = u * table.total;
  const { len } = table;
  let j = 0;
  while (j < len.length - 2 && len[j + 1] < d) j++;
  const span = len[j + 1] - len[j];
  const f = span > 0 ? Math.min(1, Math.max(0, (d - len[j]) / span)) : 0;
  return (j + f) / CUT_ARC_SUB;
}

/** Time fraction u -> fraction of the path length covered. out: decelerates to a stop at the end. */
function easeU(ease, u) {
  if (ease === "out") return 1 - (1 - u) * (1 - u);
  if (ease === "in") return u * u;
  if (ease === "inout") return u * u * (3 - 2 * u);
  return u;
}

function q256(v) {
  const c = Math.max(0, Math.min(POS_MAX, v));
  return Math.floor(c * 256 + 0.5) / 256;
}

function yawByteOf(dx, dz) {
  const a = Math.atan2(dx, dz);
  const b = Math.floor((a / (Math.PI * 2)) * 256 + 0.5);
  return ((b % 256) + 256) % 256;
}

export function cutSampleCount(durMs) {
  return Math.ceil(durMs / CUT_STEP_MS) + 1;
}

function fixedYaw(a) {
  return clampYawByte(a.yaw);
}

/** Unrounded position + tangent of an actor at sample time index. */
function rawSamples(a, ns, durMs) {
  const out = [];
  if (!cutActorMoves(a)) {
    const p = { x: a.path.length ? a.path[0].x : a.x, y: a.path.length ? a.path[0].y : a.y, z: a.path.length ? a.path[0].z : a.z };
    for (let i = 0; i < ns; i++) out.push({ pos: p, tan: null });
    return out;
  }
  const table = arcTable(a.path);
  for (let i = 0; i < ns; i++) {
    const u = easeU(a.ease, Math.min((i * CUT_STEP_MS) / durMs, 1));
    out.push(crAt(a.path, sAtU(table, u)));
  }
  return out;
}

function derivedYaws(a, raws, targetRaws) {
  const n = raws.length;
  const yaws = [];
  let prev = fixedYaw(a);
  for (let i = 0; i < n; i++) {
    let dx = 0;
    let dz = 0;
    let use = false;
    if (a.facing === "path" && raws[i].tan) {
      dx = raws[i].tan.x;
      dz = raws[i].tan.z;
      use = true;
    } else if (a.facing === "target" && targetRaws) {
      const tr = targetRaws[Math.min(i, targetRaws.length - 1)];
      dx = tr.pos.x - raws[i].pos.x;
      dz = tr.pos.z - raws[i].pos.z;
      use = true;
    }
    if (use && (Math.abs(dx) > 1e-9 || Math.abs(dz) > 1e-9)) prev = yawByteOf(dx, dz);
    else if (!use) prev = fixedYaw(a);
    yaws.push(prev);
  }
  return yaws;
}

/**
 * Bake a cutscene. Returns { durMs, step, ns, actors: [{ id, kind, item, scale, ns, x[], y[], z[], yaw[] }] }
 * (positions already rounded to 1/256, yaw bytes 0..255). Bad references fall back to fixed facing.
 */
export function bakeCutscene(cut) {
  const durMs = Math.round(clampCutDuration(cut?.duration) * 1000);
  const ns = cutSampleCount(durMs);
  const actors = cut?.actors || [];
  const byId = new Map(actors.map((a) => [a.id, a]));
  const raws = new Map();
  const rawFor = (a) => {
    if (!raws.has(a.id)) raws.set(a.id, rawSamples(a, ns, durMs));
    return raws.get(a.id);
  };
  const out = [];
  for (const a of actors) {
    const own = rawFor(a);
    let target = null;
    let targetRaws = null;
    if (a.kind === "camera" && a.facing === "target") {
      target = byId.get(a.target);
      if (target && target !== a && target.kind === "item") targetRaws = rawFor(target);
    }
    const full = cutActorMoves(a) || (targetRaws && cutActorMoves(target));
    const cnt = full ? ns : 1;
    const useRaw = own.slice(0, cnt);
    const yaws = derivedYaws(a, own.slice(0, cnt), targetRaws);
    out.push({
      id: a.id,
      kind: a.kind,
      item: a.kind === "item" ? a.item : null,
      scale: a.kind === "item" ? a.scale : 1,
      ns: cnt,
      x: useRaw.map((r) => q256(r.pos.x)),
      y: useRaw.map((r) => q256(r.pos.y)),
      z: useRaw.map((r) => q256(r.pos.z)),
      yaw: yaws,
    });
  }
  return { durMs, step: CUT_STEP_MS, ns, actors: out };
}

/** Engine-style playback of one baked actor at tMs: lerp position, shortest-arc lerp of yaw. */
export function cutSampleAt(baked, tMs) {
  const last = baked.ns - 1;
  if (last <= 0) return { x: baked.x[0], y: baked.y[0], z: baked.z[0], yaw: baked.yaw[0] };
  const t = Math.max(0, tMs);
  let i = Math.floor(t / CUT_STEP_MS);
  if (i >= last) return { x: baked.x[last], y: baked.y[last], z: baked.z[last], yaw: baked.yaw[last] };
  const f = (t % CUT_STEP_MS) / CUT_STEP_MS;
  const lerp = (arr) => arr[i] + (arr[i + 1] - arr[i]) * f;
  const dy = ((((baked.yaw[i + 1] - baked.yaw[i]) % 256) + 384) % 256) - 128;
  const yaw = (((baked.yaw[i] + dy * f) % 256) + 256) % 256;
  return { x: lerp(baked.x), y: lerp(baked.y), z: lerp(baked.z), yaw };
}

/** Bytes of the cooked data: fixed 34-byte header (4 + five 6-entry actor tables), 7 per sample. */
export function cutsceneBytes(baked) {
  let n = 35;
  for (const a of baked.actors) n += 7 * a.ns;
  return n;
}

/**
 * The star pixels visible at camera yaw byte `yaw` (the STARS spec):
 * [{ x: 0..95 colour-clock column, y: 0..127 row }]. Mirrors cut_stars in src/a8cutscene.asm.
 */
export function cutStars(yaw) {
  const out = [];
  const yb = ((Math.round(yaw) % 256) + 256) % 256;
  let x = 0xace1;
  const rng = () => {
    x ^= (x << 7) & 0xffff;
    x ^= x >> 9;
    x ^= (x << 8) & 0xffff;
  };
  let pa = 0;
  let py = 0;
  for (let i = 0; i < CUT_STAR_COUNT; i++) {
    rng();
    let az = x >> 8;
    let row = (x & 255) >> 1;
    rng();
    const h2 = x >> 8;
    const l2 = x & 255;
    if ((l2 & 4) === 0) {
      az = (pa + ((l2 >> 3) & 15) - 8) & 255;
      row = (py + ((h2 >> 3) & 15) - 8) & 127;
    }
    pa = az;
    py = row;
    let d = (az - yb) & 255;
    if (d >= 128) d -= 256;
    if (d < -32 || d > 31) continue;
    const cx = 48 + d + (d >> 1);
    const k = h2 & 7;
    const px = [[0, 0]];
    if (k === 0) px.push([1, 0], [-1, 0], [0, -1], [0, 1]);
    else if (k <= 2) px.push([0, 1]);
    for (const [dx, dy] of px) {
      const sx = cx + dx;
      const sy = row + dy;
      if (sx >= 0 && sx < 96 && sy >= 0 && sy < 128) out.push({ x: sx, y: sy });
    }
  }
  return out;
}

export function yawByteToRad(b) {
  return (b / 256) * Math.PI * 2;
}

/** Human-readable problems with the active map's cutscene (empty = fine). */
export function cutsceneIssues(doc, map = activeMap(doc)) {
  const cut = map.cutscene;
  if (!cut) return [];
  const issues = [];
  const room = cut.roomId ? roomById(doc, cut.roomId) : null;
  if (!cut.roomId) issues.push("No cutscene room chosen.");
  else if (!room) issues.push("The cutscene room no longer exists.");
  const spawn = map.objects.find((o) => o.kind === "spawn" && o.enabled !== false) || map.objects.find((o) => o.kind === "spawn");
  if (room && spawn && spawn.roomId === room.id) issues.push("The cutscene room is the spawn room.");
  if (!spawn) issues.push("The map has no spawn to drop into after the cutscene.");
  const cams = cut.actors.filter((a) => a.kind === "camera");
  if (!cams.length) issues.push("No camera.");
  if (cams.length > 1) issues.push("More than one camera.");
  if (cut.actors.length > CUT_ACTOR_MAX) issues.push(`More than ${CUT_ACTOR_MAX} actors.`);
  for (const a of cut.actors) {
    const name = cutActorLabel(a);
    if (a.kind === "item" && !itemMeshHasGeom(itemMeshFor(doc, a.item))) issues.push(`${name}: item has no mesh.`);
    if (a.path.length === 1) issues.push(`${name}: a path needs at least 2 points.`);
    if (a.kind === "camera" && a.facing === "target") {
      const t = cut.actors.find((o) => o.id === a.target);
      if (!t) issues.push("Camera: no target chosen.");
      else if (t.kind !== "item") issues.push("Camera: target must be an item.");
    }
  }
  if (!issues.length || cams.length) {
    const bytes = cutsceneBytes(bakeCutscene(cut));
    if (bytes > CUT_DATA_BUDGET) issues.push(`Cutscene data is ${bytes} B (budget about ${CUT_DATA_BUDGET} B).`);
  }
  return issues;
}
