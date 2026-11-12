const IDPO = 0x4f504449;
const ALIAS_VERSION = 6;
const ALIAS_SINGLE = 0;

export const ENEMY_MDL_PATHS = {};

function cstr(view, offset, len) {
  let s = "";
  for (let i = 0; i < len; i++) {
    const c = view.getUint8(offset + i);
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function clipKey(name) {
  const k = name.replace(/\d+$/, "");
  return k || name;
}

/** Drop extra pain/death variants; keep first pain and first death. */
const EXTRA_PAIN_DEATH = /^pain[b-z]|^death[b-z]|^deathc$|^bdeath$/;

export function shouldKeepMdlClip(name) {
  return !EXTRA_PAIN_DEATH.test(name);
}

export function filterMdlClips(clips) {
  return (clips || []).filter((c) => shouldKeepMdlClip(c.name));
}

/** Clips named in `names`, in MDL order. Missing/undefined names → default kept set. */
export function selectMdlClips(mdl, names) {
  const clips = mdl?.clips || [];
  if (!clips.length) return [];
  if (!Array.isArray(names)) return filterMdlClips(clips);
  const want = new Set(names);
  return clips.filter((c) => want.has(c.name));
}

/** Global stick index → MDL frame index (same order as filterMdlClips). */
export function mdlFrameIndexAt(mdl, globalIndex) {
  const kept = filterMdlClips(mdl.clips);
  let i = 0;
  for (const clip of kept) {
    for (const fr of clip.frames) {
      if (i === globalIndex) return fr.index;
      i++;
    }
  }
  return kept[0]?.frames[0]?.index ?? 0;
}

function uniqueEdges(tris) {
  const seen = new Set();
  const edges = [];
  const add = (a, b) => {
    if (a === b) return;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = lo + ":" + hi;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push([lo, hi]);
  };
  for (const t of tris) {
    add(t[0], t[1]);
    add(t[1], t[2]);
    add(t[2], t[0]);
  }
  return edges;
}

function reader(buffer) {
  const view = new DataView(buffer);
  let o = 0;
  return {
    i32() {
      const v = view.getInt32(o, true);
      o += 4;
      return v;
    },
    f32() {
      const v = view.getFloat32(o, true);
      o += 4;
      return v;
    },
    vec3() {
      return [this.f32(), this.f32(), this.f32()];
    },
    skip(n) {
      o += n;
    },
    u8() {
      const v = view.getUint8(o);
      o += 1;
      return v;
    },
    name16() {
      const s = cstr(view, o, 16);
      o += 16;
      return s;
    },
    check(n, what) {
      if (o + n > buffer.byteLength) throw new Error(`MDL truncated (${what})`);
    },
  };
}

function skipSkins(r, numSkins, skinWidth, skinHeight) {
  const skinSize = skinWidth * skinHeight;
  if (skinSize < 0 || skinSize > 2_000_000) throw new Error("MDL skin size invalid");
  for (let i = 0; i < numSkins; i++) {
    r.check(4, "skin type");
    const typ = r.i32();
    if (typ === ALIAS_SINGLE) {
      r.check(skinSize, "skin");
      r.skip(skinSize);
    } else {
      r.check(4, "skin group");
      const n = r.i32();
      if (n < 0 || n > 256) throw new Error("MDL skin group too large");
      r.check(n * 4 + n * skinSize, "skin group");
      r.skip(n * 4);
      r.skip(n * skinSize);
    }
  }
}

function readSimpleFrame(r, numVerts) {
  r.check(8 + 16 + numVerts * 4, "frame");
  r.skip(8);
  const name = r.name16();
  const verts = new Uint8Array(numVerts * 3);
  for (let i = 0; i < numVerts; i++) {
    verts[i * 3] = r.u8();
    verts[i * 3 + 1] = r.u8();
    verts[i * 3 + 2] = r.u8();
    r.u8();
  }
  return { name, verts };
}

export function parseMdl(buffer) {
  const r = reader(buffer);
  r.check(84, "header");
  const ident = r.i32();
  if (ident !== IDPO) throw new Error("Not an IDPO MDL");
  const version = r.i32();
  if (version !== ALIAS_VERSION) throw new Error(`MDL version ${version}, expected 6`);
  const scale = r.vec3();
  const origin = r.vec3();
  r.f32();
  r.vec3();
  const numSkins = r.i32();
  const skinWidth = r.i32();
  const skinHeight = r.i32();
  const numVerts = r.i32();
  const numTris = r.i32();
  const numFrames = r.i32();
  r.i32();
  r.i32();
  r.f32();

  if (numVerts <= 0 || numVerts > 10000 || numTris <= 0 || numTris > 20000 || numFrames <= 0) {
    throw new Error("MDL has no geometry");
  }

  skipSkins(r, numSkins, skinWidth, skinHeight);

  r.check(numVerts * 12, "stverts");
  r.skip(numVerts * 12);

  const tris = [];
  r.check(numTris * 16, "tris");
  for (let i = 0; i < numTris; i++) {
    r.i32();
    tris.push([r.i32(), r.i32(), r.i32()]);
  }

  const frames = [];
  for (let i = 0; i < numFrames; i++) {
    r.check(4, "frame type");
    const typ = r.i32();
    if (typ === ALIAS_SINGLE) {
      frames.push(readSimpleFrame(r, numVerts));
    } else {
      r.check(4, "group count");
      const n = r.i32();
      if (n < 0 || n > 256) throw new Error("MDL frame group too large");
      r.check(8 + n * 4, "group header");
      r.skip(8);
      r.skip(n * 4);
      for (let j = 0; j < n; j++) frames.push(readSimpleFrame(r, numVerts));
    }
  }

  const clips = [];
  const byKey = new Map();
  for (let i = 0; i < frames.length; i++) {
    const key = clipKey(frames[i].name);
    let clip = byKey.get(key);
    if (!clip) {
      clip = { name: key, frames: [] };
      byKey.set(key, clip);
      clips.push(clip);
    }
    clip.frames.push({ name: frames[i].name, index: i });
  }

  return {
    numVerts,
    scale,
    origin,
    tris,
    edges: uniqueEdges(tris),
    frames,
    clips,
  };
}

/** Doom hull mins.z / modelgen $origin z — origin sits this far above the floor. */
const HULL_FLOOR = 24;

/** Doom +X forward / +Z up → editor +Z forward / +Y up. */
function doomToEditor(qx, qy, qz) {
  return { x: -qy, y: qz, z: qx };
}

function decodeConverted(mdl, frameIndex) {
  const fr = mdl.frames[frameIndex];
  const out = new Array(mdl.numVerts);
  if (fr?.xyz) {
    const xyz = fr.xyz;
    for (let i = 0; i < mdl.numVerts; i++) {
      out[i] = doomToEditor(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]);
    }
    return out;
  }
  const [sx, sy, sz] = mdl.scale;
  const [ox, oy, oz] = mdl.origin;
  const packed = fr.verts;
  for (let i = 0; i < mdl.numVerts; i++) {
    const qx = packed[i * 3] * sx + ox;
    const qy = packed[i * 3 + 1] * sy + oy;
    const qz = packed[i * 3 + 2] * sz + oz;
    out[i] = doomToEditor(qx, qy, qz);
  }
  return out;
}

export function mdlEditorVerts(mdl, frameIndex, scale) {
  const raw = decodeConverted(mdl, frameIndex);
  const n = Number(scale);
  const s = Number.isFinite(n) ? Math.max(0.1, Math.min(2, n)) : 0.7;
  return raw.map((v) => ({ x: v.x * s, y: (v.y + HULL_FLOOR) * s, z: v.z * s }));
}

/** Build stick poses + clip table from bound MDL clips (selected names, or default kept set). */
export function buildStickFramesFromMdl(mdl, rig, scale, restFrame, clampVert, clipNames) {
  const kept = selectMdlClips(mdl, clipNames);
  const frames = [];
  const clips = [];
  let start = 0;
  for (const clip of kept) {
    clips.push({ name: clip.name, start, len: clip.frames.length });
    for (const fr of clip.frames) {
      const verts = mdlEditorVerts(mdl, fr.index, scale);
      const avg = averageJointPositions(verts, rig.jointVerts);
      const pose = avg.map((p, i) => {
        if (p) {
          return {
            x: clampVert(Math.round(p.x)),
            y: clampVert(Math.round(p.y)),
            z: clampVert(Math.round(p.z)),
          };
        }
        const v = restFrame[i] || { x: 0, y: 0, z: 0 };
        return { x: v.x, y: v.y, z: v.z };
      });
      frames.push(pose);
    }
    start += clip.frames.length;
  }
  return { frames, clips };
}

export function averageJointPositions(verts, jointVerts) {
  return jointVerts.map((indices) => {
    if (!indices || !indices.length) return null;
    let x = 0;
    let y = 0;
    let z = 0;
    let n = 0;
    for (const i of indices) {
      const v = verts[i];
      if (!v) continue;
      x += v.x;
      y += v.y;
      z += v.z;
      n++;
    }
    if (!n) return null;
    return { x: x / n, y: y / n, z: z / n };
  });
}

export function loadEnemyMdls(lumps) {
  const models = {};
  const missing = [];
  for (const [enemy, path] of Object.entries(ENEMY_MDL_PATHS)) {
    const buf = lumps.get(path.toLowerCase());
    if (!buf) {
      missing.push(enemy);
      continue;
    }
    try {
      models[enemy] = parseMdl(buf);
    } catch (err) {
      missing.push(enemy);
      console.warn(`Failed to parse ${path}:`, err);
    }
  }
  return { models, missing };
}
