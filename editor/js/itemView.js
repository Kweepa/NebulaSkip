import {
  ITEM_MIN,
  ITEM_MAX,
  ITEM_COORD_MIN,
  ITEM_COORD_MAX,
  ITEM_ORIGIN,
  ITEM_MAX_VERTS,
  ITEM_MAX_LINES,
  ITEM_MAX_UNIQUE,
  ITEM_POS_Q,
  ITEM_ORBIT_DIST_MIN,
  ITEM_ORBIT_DIST_MAX,
  aabbCenter,
  clampItemCoord,
  clampItemSphereR,
  itemSpinAngle,
  itemUniqueXZ,
} from "./model.js";
import {
  BOX_EDGES,
  cornerWorld,
  distPointToSegment2d,
  intersectPlane,
  lookVectors,
  projectLine,
  projectPoint,
  screenRay,
} from "./math3d.js";
import {
  GIZMO_AXIS_COLS,
  GIZMO_FALLBACK_LEN,
  drawTranslateGizmo,
  gizmoAxisDragDelta,
  hitTranslateGizmo,
} from "./gizmo.js";

const ITEM_VERT_HIT = 10;
const ITEM_LINE_HIT = 6;
const ITEM_BOX_CLICK = 4;
const ITEM_ZOOM_K = 0.008;
/** Pixel tolerance for grabbing a sphere's circumference. */
const ITEM_RING_HIT = 6;
const SPHERE_COL = "#e08a3e";
const SPHERE_COL_HOT = "#ffb36b";
const SPHERE_COL_SEL = "#d4a017";

/**
 * The four viewports. Ortho views look along a world axis (same orientations as the enemy editor's
 * Front / Right panes and the map editor's Top pane). They have no state of their own: centre and
 * zoom come from ItemView.orbit (target, dist), so pan and zoom stay in sync across all views.
 */
const ITEM_VIEW_DEFS = {
  front: { label: "Front", yaw: Math.PI, pitch: 0 },
  right: { label: "Right", yaw: -Math.PI / 2, pitch: 0 },
  // yaw π: screen-right is -X (as in Front) and +Z points down the screen, so Top lines up with Front.
  top: { label: "Top", yaw: Math.PI, pitch: -Math.PI / 2 },
  persp: { label: "Perspective" },
};
/** Ortho eye distance: beyond any model coordinate so plane-drag rays always start in front of the plane. */
const ITEM_ORTHO_EYE = 200;

function clampItemDist(d) {
  return Math.max(ITEM_ORBIT_DIST_MIN, Math.min(ITEM_ORBIT_DIST_MAX, d));
}

/** { verts: [{x,y,z}], lines: [[i,j]] } in local indices. Survives mesh-type switches. */
let itemClip = null;

function offsetSortKey([dx, dy, dz]) {
  const m = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
  const axis = dx !== 0 ? 0 : dz !== 0 ? 1 : 2;
  const sign = dx + dy + dz < 0 ? 1 : 0;
  return m * 100 + axis * 10 + sign;
}

export class ItemView {
  /** The view the current pointer event / draw pass is working in; cssW, cssH and #cam() read it. */
  #v = null;

  /** `canvas` is the perspective view; opts.ortho = { front, right, top } are the orthographic canvases. */
  constructor(canvas, opts) {
    this.opts = opts;
    const mkView = (kind, cv) => ({ kind, canvas: cv, ctx: cv.getContext("2d"), w: 0, h: 0 });
    this.views = [
      mkView("front", opts.ortho.front),
      mkView("right", opts.ortho.right),
      mkView("top", opts.ortho.top),
      mkView("persp", canvas),
    ];
    this.#v = this.views[3];
    this.orbit = { yaw: 0.6, pitch: 0.35, dist: 16, target: { x: 0, y: 0, z: 0 } };
    this.drag = null;
    this.hoverVert = -1;
    this.hoverLine = -1;
    this.hoverGizmo = null;
    this.hoverSphere = -1;
    this.hoverRing = -1;
    this.selectedVerts = [];
    this.selectedLines = [];
    /** Indices into mesh.spheres whose centres are selected (move with the gizmo like verts). */
    this.selectedSpheres = [];
    this.enabled = false;
    this.pointerInside = false;
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(opts.stage || canvas.parentElement);
    this.resize();

    for (const view of this.views) {
      const cv = view.canvas;
      const as = (fn) => (e) => {
        this.#v = view;
        fn(e);
      };
      cv.addEventListener("pointerenter", () => {
        this.pointerInside = true;
      });
      cv.addEventListener("pointerleave", () => {
        this.pointerInside = false;
      });
      cv.addEventListener("pointerdown", as((e) => this.#onDown(e)));
      cv.addEventListener("pointermove", as((e) => this.#onMove(e)));
      cv.addEventListener("pointerup", as((e) => this.#onUp(e)));
      cv.addEventListener(
        "pointerleave",
        as((e) => {
          // Hover highlights are model-space, so they show in every view: drop them when the pointer leaves.
          if (!this.drag) {
            this.hoverVert = -1;
            this.hoverLine = -1;
            this.hoverGizmo = null;
            this.hoverSphere = -1;
            this.hoverRing = -1;
          }
          this.#onUp(e);
        })
      );
      cv.addEventListener("wheel", as((e) => this.#onWheel(e)), { passive: false });
      cv.addEventListener("contextmenu", (e) => e.preventDefault());
      cv.addEventListener("mousedown", (e) => {
        if (e.button === 1) e.preventDefault();
      });
      cv.addEventListener("auxclick", (e) => {
        if (e.button === 1) e.preventDefault();
      });
    }
    const spinLoop = () => {
      if (this.enabled && this.#spinning()) this.draw();
      requestAnimationFrame(spinLoop);
    };
    requestAnimationFrame(spinLoop);
  }

  /**
   * Rotating-item preview. Runs only while the pointer is off the canvas with nothing
   * selected or dragged, so picking and the gizmo always see authored coordinates.
   */
  #spinning() {
    return (
      !!this.opts.getSpin?.() &&
      !this.drag &&
      !this.pointerInside &&
      !this.selectedVerts.length &&
      !this.selectedLines.length &&
      !this.selectedSpheres.length
    );
  }

  #spinYaw() {
    return this.#spinning() ? itemSpinAngle() : 0;
  }

  get cssW() {
    return this.#v.w;
  }

  get cssH() {
    return this.#v.h;
  }

  /** Each canvas fills its grid cell (CSS 100%); measure the cell, then size the backing store to it. */
  resize() {
    if (!this.enabled) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const view of this.views) {
      const cv = view.canvas;
      cv.style.width = "";
      cv.style.height = "";
      const rect = cv.getBoundingClientRect();
      const w = Math.max(32, Math.floor(rect.width));
      const h = Math.max(32, Math.floor(rect.height));
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      view.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      view.w = w;
      view.h = h;
    }
    this.draw();
  }

  selection() {
    return { verts: [...this.selectedVerts], lines: [...this.selectedLines], spheres: [...this.selectedSpheres] };
  }

  clearSelection() {
    this.selectedVerts = [];
    this.selectedLines = [];
    this.selectedSpheres = [];
    this.hoverVert = -1;
    this.hoverLine = -1;
    this.hoverSphere = -1;
    this.hoverRing = -1;
    this.hoverGizmo = null;
  }

  addVertAtOrigin() {
    const mesh = this.#mesh();
    if (mesh.verts.length >= ITEM_MAX_VERTS) {
      this.opts.onStatus?.("Vertex cap (16)", true);
      return false;
    }
    const cell = { x: ITEM_ORIGIN, y: ITEM_ORIGIN, z: ITEM_ORIGIN };
    if (this.#occupied(mesh, cell.x, cell.y, cell.z)) {
      this.opts.onStatus?.("Origin is occupied", true);
      return false;
    }
    const next = [...mesh.verts, { ...cell }];
    if (!this.#uniqueOk(next)) {
      this.opts.onStatus?.(`Would exceed ${ITEM_MAX_UNIQUE} unique X or Z`, true);
      return false;
    }
    this.opts.beginUndo?.();
    mesh.verts.push({ ...cell });
    this.opts.endUndo?.();
    this.selectedVerts = [mesh.verts.length - 1];
    this.selectedLines = [];
    this.selectedSpheres = [];
    this.opts.onChange?.();
    this.opts.onSelect?.();
    this.draw();
    return true;
  }

  addLineFromSelection() {
    const mesh = this.#mesh();
    if (this.selectedVerts.length !== 2) {
      this.opts.onStatus?.("Select two vertices", true);
      return false;
    }
    const [a, b] = this.selectedVerts;
    if (!this.#canAddLine(mesh, a, b)) {
      this.opts.onStatus?.(mesh.lines.length >= ITEM_MAX_LINES ? "Line cap (16)" : "Line already exists", true);
      return false;
    }
    this.opts.beginUndo?.();
    this.#tryAddLine(mesh, a, b);
    this.opts.endUndo?.();
    this.opts.onChange?.();
    this.opts.onSelect?.();
    this.draw();
    return true;
  }

  deleteSelection() {
    const mesh = this.#mesh();
    if (!mesh) return false;
    const lines = [...this.selectedLines].filter((i) => i >= 0 && i < mesh.lines.length).sort((a, b) => b - a);
    const verts = [...this.selectedVerts].filter((i) => i >= 0 && i < mesh.verts.length).sort((a, b) => b - a);
    const sphs = [...this.selectedSpheres].filter((i) => i >= 0 && i < (mesh.spheres?.length || 0)).sort((a, b) => b - a);
    if (!lines.length && !verts.length && !sphs.length) return false;
    this.opts.beginUndo?.();
    for (const i of sphs) mesh.spheres.splice(i, 1);
    if (mesh.spheres && !mesh.spheres.length) delete mesh.spheres;
    for (const i of lines) mesh.lines.splice(i, 1);
    for (const i of verts) {
      mesh.verts.splice(i, 1);
      mesh.lines = mesh.lines
        .filter(([a, b]) => a !== i && b !== i)
        .map(([a, b]) => [a > i ? a - 1 : a, b > i ? b - 1 : b]);
    }
    this.opts.endUndo?.();
    this.clearSelection();
    this.opts.onChange?.();
    this.opts.onSelect?.();
    this.draw();
    return true;
  }

  hasClipboard() {
    return !!(itemClip && itemClip.verts.length);
  }

  copySelection() {
    const clip = this.#gatherSelection();
    if (!clip) {
      this.opts.onStatus?.("Nothing selected", true);
      return false;
    }
    itemClip = clip;
    this.opts.onSelect?.();
    const nv = clip.verts.length;
    const ne = clip.lines.length;
    this.opts.onStatus?.(`Copied ${nv} vert${nv === 1 ? "" : "s"}, ${ne} line${ne === 1 ? "" : "s"}`);
    return true;
  }

  pasteSelection() {
    if (!itemClip?.verts.length) {
      this.opts.onStatus?.("Nothing to paste", true);
      return false;
    }
    const mesh = this.#mesh();
    const addV = itemClip.verts.length;
    const addE = itemClip.lines.length;
    if (mesh.verts.length + addV > ITEM_MAX_VERTS) {
      this.opts.onStatus?.("Vertex cap (16)", true);
      return false;
    }
    if (mesh.lines.length + addE > ITEM_MAX_LINES) {
      this.opts.onStatus?.("Line cap (16)", true);
      return false;
    }
    let uniqueFail = false;
    let placed = null;
    for (const [dx, dy, dz] of this.#pasteOffsets()) {
      const trial = this.#shiftedClip(dx, dy, dz);
      if (!trial || this.#cellsBlocked(mesh, trial)) continue;
      if (!this.#uniqueOk([...mesh.verts, ...trial])) {
        uniqueFail = true;
        continue;
      }
      placed = trial;
      break;
    }
    if (!placed) {
      this.opts.onStatus?.(
        uniqueFail ? `Would exceed ${ITEM_MAX_UNIQUE} unique X or Z` : "No free cells for paste",
        true
      );
      return false;
    }
    this.opts.beginUndo?.();
    const base = mesh.verts.length;
    for (const v of placed) mesh.verts.push({ x: v.x, y: v.y, z: v.z });
    for (const [a, b] of itemClip.lines) this.#tryAddLine(mesh, base + a, base + b);
    this.opts.endUndo?.();
    this.selectedVerts = placed.map((_, i) => base + i);
    this.selectedLines = [];
    this.selectedSpheres = [];
    this.opts.onChange?.();
    this.opts.onSelect?.();
    this.draw();
    this.opts.onStatus?.(`Pasted ${addV} vert${addV === 1 ? "" : "s"}, ${addE} line${addE === 1 ? "" : "s"}`);
    return true;
  }

  #gatherSelection() {
    const mesh = this.#mesh();
    const vset = new Set();
    const edgeKeys = new Set();
    const addEdge = (a, b) => {
      if (a === b || !mesh.verts[a] || !mesh.verts[b]) return;
      edgeKeys.add(`${Math.min(a, b)},${Math.max(a, b)}`);
    };
    for (const i of this.selectedVerts) {
      if (mesh.verts[i]) vset.add(i);
    }
    for (const i of this.selectedLines) {
      const e = mesh.lines[i];
      if (!e) continue;
      if (mesh.verts[e[0]]) vset.add(e[0]);
      if (mesh.verts[e[1]]) vset.add(e[1]);
      addEdge(e[0], e[1]);
    }
    if (!vset.size) return null;
    for (const [a, b] of mesh.lines) {
      if (vset.has(a) && vset.has(b)) addEdge(a, b);
    }
    const indices = [...vset].sort((a, b) => a - b);
    const imap = new Map(indices.map((i, j) => [i, j]));
    return {
      verts: indices.map((i) => {
        const v = mesh.verts[i];
        return { x: clampItemCoord(v.x), y: clampItemCoord(v.y), z: clampItemCoord(v.z) };
      }),
      lines: [...edgeKeys].map((k) => {
        const [a, b] = k.split(",").map(Number);
        return [imap.get(a), imap.get(b)];
      }),
    };
  }

  #pasteOffsets() {
    const offs = [];
    for (let dx = ITEM_MIN; dx <= ITEM_MAX; dx++) {
      for (let dy = ITEM_MIN; dy <= ITEM_MAX; dy++) {
        for (let dz = ITEM_MIN; dz <= ITEM_MAX; dz++) {
          offs.push([dx, dy, dz]);
        }
      }
    }
    offs.sort((a, b) => offsetSortKey(a) - offsetSortKey(b));
    return offs;
  }

  #shiftedClip(dx, dy, dz) {
    const placed = [];
    for (const v of itemClip.verts) {
      const x = v.x + dx;
      const y = v.y + dy;
      const z = v.z + dz;
      if (
        x < ITEM_COORD_MIN ||
        x > ITEM_COORD_MAX ||
        y < ITEM_COORD_MIN ||
        y > ITEM_COORD_MAX ||
        z < ITEM_COORD_MIN ||
        z > ITEM_COORD_MAX
      ) {
        return null;
      }
      placed.push({ x, y, z });
    }
    return placed;
  }

  #cellsBlocked(mesh, placed) {
    const seen = new Set();
    for (const v of placed) {
      const k = `${v.x},${v.y},${v.z}`;
      if (seen.has(k) || this.#occupied(mesh, v.x, v.y, v.z)) return true;
      seen.add(k);
    }
    return false;
  }

  #mesh() {
    return this.opts.getMesh?.() || { verts: [], lines: [] };
  }

  /**
   * Perspective: the orbit camera. Ortho: looks along a world axis at orbit.target with `ortho` set to the
   * pixels-per-unit the perspective view has at the target plane (focal / dist), so every view shows the
   * same scale and centre.
   */
  #cam(view = this.#v) {
    const { dist, target } = this.orbit;
    const def = ITEM_VIEW_DEFS[view.kind];
    const ortho = view.kind !== "persp";
    const yaw = ortho ? def.yaw : this.orbit.yaw;
    const pitch = ortho ? def.pitch : this.orbit.pitch;
    const { forward } = lookVectors(yaw, pitch);
    const back = ortho ? ITEM_ORTHO_EYE : dist;
    const cam = {
      x: target.x - forward.x * back,
      y: target.y - forward.y * back,
      z: target.z - forward.z * back,
      yaw,
      pitch,
    };
    if (ortho) cam.ortho = Math.max(0.01, (Math.min(view.w, view.h) * 0.9) / dist);
    return cam;
  }

  get #persp() {
    return this.views[3];
  }

  /** Frame mesh verts; if none, center on origin without changing dist. */
  focusObject() {
    const mesh = this.#mesh();
    const points = [...mesh.verts];
    for (const s of mesh.spheres || []) {
      points.push({ x: s.x - s.r, y: s.y - s.r, z: s.z - s.r }, { x: s.x + s.r, y: s.y + s.r, z: s.z + s.r });
    }
    if (!points.length) {
      this.orbit.target = { x: 0, y: 0, z: 0 };
      this.opts.onViewChanged?.();
      this.draw();
      return true;
    }

    let minx = Infinity;
    let miny = Infinity;
    let minz = Infinity;
    let maxx = -Infinity;
    let maxy = -Infinity;
    let maxz = -Infinity;
    for (const v of points) {
      minx = Math.min(minx, v.x);
      miny = Math.min(miny, v.y);
      minz = Math.min(minz, v.z);
      maxx = Math.max(maxx, v.x);
      maxy = Math.max(maxy, v.y);
      maxz = Math.max(maxz, v.z);
    }
    const box = {
      x: minx,
      y: miny,
      z: minz,
      sx: Math.max(1e-3, maxx - minx),
      sy: Math.max(1e-3, maxy - miny),
      sz: Math.max(1e-3, maxz - minz),
    };
    const center = aabbCenter(box);
    const { yaw, pitch } = this.orbit;
    const { forward, right, up } = lookVectors(yaw, pitch);
    // Frames the perspective view; the ortho views follow through orbit.target / dist.
    const w = this.#persp.w;
    const h = this.#persp.h;
    const focal = Math.min(w, h) * 0.9;
    const pad = 0.82;
    const halfW = Math.max(1, w * 0.5 * pad);
    const halfH = Math.max(1, h * 0.5 * pad);

    let frameDist = 4;
    for (let i = 0; i < 8; i++) {
      const c = cornerWorld(box, i);
      const rx = c.x - center.x;
      const ry = c.y - center.y;
      const rz = c.z - center.z;
      const cx = rx * right.x + ry * right.y + rz * right.z;
      const cy = rx * up.x + ry * up.y + rz * up.z;
      const cz = rx * forward.x + ry * forward.y + rz * forward.z;
      frameDist = Math.max(frameDist, (Math.abs(cx) * focal) / halfW - cz);
      frameDist = Math.max(frameDist, (Math.abs(cy) * focal) / halfH - cz);
      frameDist = Math.max(frameDist, 1 - cz);
    }

    this.orbit.target = { x: center.x, y: center.y, z: center.z };
    this.orbit.dist = clampItemDist(frameDist);
    this.opts.onViewChanged?.();
    this.draw();
    return true;
  }

  #eventPos(e) {
    const rect = this.#v.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * this.cssW,
      y: ((e.clientY - rect.top) / rect.height) * this.cssH,
    };
  }

  /** Gizmo anchor: centroid of the selected verts and sphere centres. */
  #selectionAnchor() {
    const mesh = this.#mesh();
    const selected = this.selectedVerts.filter((i) => mesh.verts[i]);
    const sph = this.selectedSpheres.filter((i) => mesh.spheres?.[i]);
    const pts = [...selected.map((i) => mesh.verts[i]), ...sph.map((i) => mesh.spheres[i])];
    if (!pts.length) return null;
    if (pts.length === 1) return { v: pts[0], indices: selected, spheres: sph };
    let x = 0;
    let y = 0;
    let z = 0;
    for (const p of pts) {
      x += p.x;
      y += p.y;
      z += p.z;
    }
    const n = pts.length;
    return { v: { x: x / n, y: y / n, z: z / n }, indices: selected, spheres: sph };
  }

  #applyVertDrag(origs, applyCoord, sorigs = []) {
    const mesh = this.#mesh();
    const next = mesh.verts.map((v) => ({ ...v }));
    for (const o of origs) {
      next[o.i].x = o.x;
      next[o.i].y = o.y;
      next[o.i].z = o.z;
      applyCoord(next[o.i], o);
    }
    const nextSph = (mesh.spheres || []).map((s) => ({ ...s }));
    for (const o of sorigs) {
      nextSph[o.i].x = o.x;
      nextSph[o.i].y = o.y;
      nextSph[o.i].z = o.z;
      applyCoord(nextSph[o.i], o);
    }
    // Coincident verts are allowed mid-drag; #mergeDropped welds them on release.
    if (!this.#uniqueOk(next, nextSph)) return false;
    for (const o of origs) {
      mesh.verts[o.i].x = next[o.i].x;
      mesh.verts[o.i].y = next[o.i].y;
      mesh.verts[o.i].z = next[o.i].z;
    }
    for (const o of sorigs) {
      mesh.spheres[o.i].x = nextSph[o.i].x;
      mesh.spheres[o.i].y = nextSph[o.i].y;
      mesh.spheres[o.i].z = nextSph[o.i].z;
    }
    return true;
  }

  #gizmoDragOrigs(prim) {
    const mesh = this.#mesh();
    return prim.indices.map((i) => ({
      i,
      x: mesh.verts[i].x,
      y: mesh.verts[i].y,
      z: mesh.verts[i].z,
    }));
  }

  #gizmoDragSphereOrigs(prim) {
    const mesh = this.#mesh();
    return prim.spheres.map((i) => ({
      i,
      x: mesh.spheres[i].x,
      y: mesh.spheres[i].y,
      z: mesh.spheres[i].z,
    }));
  }

  /**
   * Ctrl-drag: first valid move appends a copy of each dragged vertex plus a line from
   * the original to it, then drags the copies. Nothing is added if the move is refused.
   */
  #dupStart(d) {
    const mesh = this.#mesh();
    const n = d.origs.length;
    if (mesh.verts.length + n > ITEM_MAX_VERTS) {
      this.opts.onStatus?.("Vertex cap (16)", true);
      return false;
    }
    if (mesh.lines.length + n > ITEM_MAX_LINES) {
      this.opts.onStatus?.("Line cap (16)", true);
      return false;
    }
    const base = mesh.verts.length;
    d.dupFrom = d.origs;
    for (const o of d.origs) mesh.verts.push({ x: o.x, y: o.y, z: o.z });
    d.origs.forEach((o, k) => mesh.lines.push([o.i, base + k]));
    d.origs = d.origs.map((o, k) => ({ i: base + k, x: o.x, y: o.y, z: o.z }));
    return true;
  }

  #dupUndo(d) {
    const mesh = this.#mesh();
    const n = d.dupFrom.length;
    mesh.verts.length -= n;
    mesh.lines.length -= n;
    d.origs = d.dupFrom;
    d.dupFrom = null;
  }

  /** Apply a gizmo drag step, creating the ctrl-drag copies on the first one that lands. */
  #dragStep(coordFn) {
    const d = this.drag;
    if (d.dupBlocked) return false;
    const starting = d.dup && !d.dupDone;
    if (starting && !this.#dupStart(d)) {
      d.dupBlocked = true;
      return false;
    }
    const ok = this.#applyVertDrag(d.origs, coordFn, d.sorigs);
    if (ok) d.moved = true;
    if (starting) {
      if (ok) {
        d.dupDone = true;
        this.selectedVerts = d.origs.map((o) => o.i);
        this.selectedLines = [];
        this.opts.onSelect?.();
      } else this.#dupUndo(d);
    }
    return ok;
  }

  /**
   * Drop-merge: every dragged vertex now sitting on a vertex that was not dragged is welded into
   * it. Lines follow the survivor; a line that collapses to a point or duplicates another is
   * dropped, so a ctrl-drag copy dropped on vertex B leaves its new line (original, B).
   * Returns the number of vertices removed.
   */
  #mergeDropped(indices) {
    const mesh = this.#mesh();
    const moved = new Set(indices);
    const into = new Map();
    for (const i of moved) {
      const v = mesh.verts[i];
      if (!v) continue;
      const j = mesh.verts.findIndex((w, k) => !moved.has(k) && w.x === v.x && w.y === v.y && w.z === v.z);
      if (j >= 0) into.set(i, j);
    }
    if (!into.size) return 0;
    const seen = new Set();
    const lines = [];
    for (const [a0, b0] of mesh.lines) {
      const a = into.get(a0) ?? a0;
      const b = into.get(b0) ?? b0;
      if (a === b) continue;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const k = `${lo}-${hi}`;
      if (seen.has(k)) continue;
      seen.add(k);
      lines.push([lo, hi]);
    }
    const newIdx = [];
    let n = 0;
    mesh.verts.forEach((_, i) => {
      newIdx[i] = into.has(i) ? -1 : n++;
    });
    mesh.verts = mesh.verts.filter((_, i) => !into.has(i));
    mesh.lines = lines.map(([a, b]) => [newIdx[a], newIdx[b]]);
    this.selectedVerts = [...new Set([...moved].map((i) => newIdx[into.get(i) ?? i]))];
    this.selectedLines = [];
    return into.size;
  }

  #startGizmoDrag(gizmoHit, prim, p, dup = false) {
    this.opts.beginUndo?.();
    this.drag = {
      // Ctrl-drag copies vertices only; sphere centres in the selection just move.
      dup: dup && prim.indices.length > 0,
      dupDone: false,
      dupBlocked: false,
      kind: gizmoHit.kind,
      axis: gizmoHit.axis,
      plane: gizmoHit.plane,
      planeN: gizmoHit.planeN,
      grab: gizmoHit.world,
      gizmoAxisLen: gizmoHit.gizmoAxisLen ?? GIZMO_FALLBACK_LEN,
      origs: this.#gizmoDragOrigs(prim),
      sorigs: this.#gizmoDragSphereOrigs(prim),
      orig: { x: prim.v.x, y: prim.v.y, z: prim.v.z },
      start: p,
    };
  }

  #hitVert(mx, my, verts) {
    const cam = this.#cam();
    let best = -1;
    let bestD = ITEM_VERT_HIT;
    verts.forEach((v, i) => {
      const p = projectPoint(v, cam, this.cssW, this.cssH);
      if (!p.ok) return;
      const d = Math.hypot(mx - p.sx, my - p.sy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  /**
   * Screen centre and radius (px) of a sphere in the active view, or null when behind the camera.
   * `upp` is world units per pixel of radius at the sphere (perspective z / focal, ortho 1 / px), so
   * a radius drag is r = pixels * upp. Spin is off while the pointer is in.
   */
  #sphereScreen(sp) {
    const w = this.cssW;
    const h = this.cssH;
    const cam = this.#cam();
    const pr = projectPoint(sp, cam, w, h);
    if (!pr.ok) return null;
    const upp = cam.ortho ? 1 / cam.ortho : pr.z / (Math.min(w, h) * 0.9);
    return { sx: pr.sx, sy: pr.sy, z: pr.z, upp, rad: sp.r / upp };
  }

  /** Nearest sphere centre within the vert hit radius. `prefer` wins a tie (a sphere sitting on a vertex). */
  #hitSphereCenter(mx, my, mesh) {
    let best = -1;
    let bestD = ITEM_VERT_HIT;
    (mesh.spheres || []).forEach((sp, i) => {
      const s = this.#sphereScreen(sp);
      if (!s) return;
      const d = Math.hypot(mx - s.sx, my - s.sy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return { index: best, dist: bestD };
  }

  /** Sphere whose circumference passes within ITEM_RING_HIT px of the pointer. */
  #hitSphereRing(mx, my, mesh) {
    let best = -1;
    let bestD = ITEM_RING_HIT;
    (mesh.spheres || []).forEach((sp, i) => {
      const s = this.#sphereScreen(sp);
      if (!s || s.rad > 4 * Math.max(this.cssW, this.cssH)) return;
      const d = Math.abs(Math.hypot(mx - s.sx, my - s.sy) - s.rad);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  /**
   * Vertex or sphere centre under the pointer. A vertex wins unless the sphere centre is strictly nearer,
   * or the two coincide and the vertex is already selected (so a second click reaches the sphere).
   */
  #hitHandle(mx, my, mesh) {
    const vi = this.#hitVert(mx, my, mesh.verts);
    const sh = this.#hitSphereCenter(mx, my, mesh);
    if (sh.index < 0) return { vert: vi, sphere: -1 };
    if (vi < 0) return { vert: -1, sphere: sh.index };
    const cam = this.#cam();
    const p = projectPoint(mesh.verts[vi], cam, this.cssW, this.cssH);
    const vd = Math.hypot(mx - p.sx, my - p.sy);
    const sphereWins = sh.dist < vd || (sh.dist === vd && this.selectedVerts.includes(vi));
    return sphereWins ? { vert: -1, sphere: sh.index } : { vert: vi, sphere: -1 };
  }

  #hitLine(mx, my, mesh) {
    const cam = this.#cam();
    let best = -1;
    let bestD = ITEM_LINE_HIT;
    mesh.lines.forEach(([ia, ib], i) => {
      const a = mesh.verts[ia];
      const b = mesh.verts[ib];
      if (!a || !b) return;
      const pl = projectLine(a, b, cam, this.cssW, this.cssH);
      if (!pl) return;
      const d = distPointToSegment2d(mx, my, pl.ax, pl.ay, pl.bx, pl.by);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  #onWheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this.orbit.dist = clampItemDist(this.orbit.dist * (e.deltaY > 0 ? 1.1 : 1 / 1.1));
    this.opts.onViewChanged?.();
    this.draw();
  }

  #occupied(mesh, x, y, z, skip = new Set()) {
    return mesh.verts.some((v, i) => !skip.has(i) && v.x === x && v.y === y && v.z === z);
  }

  /** Unique X/Z budget over the cooked verts: mesh verts plus sphere origins (an origin on a vert reuses it). */
  #uniqueOk(verts, spheres = this.#mesh().spheres || []) {
    const { nx, nz } = itemUniqueXZ([...verts, ...spheres]);
    return nx <= ITEM_MAX_UNIQUE && nz <= ITEM_MAX_UNIQUE;
  }

  #canAddLine(mesh, a, b) {
    if (a === b || a < 0 || b < 0 || a >= mesh.verts.length || b >= mesh.verts.length) return false;
    if (mesh.lines.length >= ITEM_MAX_LINES) return false;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return !mesh.lines.some(([ia, ib]) => Math.min(ia, ib) === lo && Math.max(ia, ib) === hi);
  }

  #tryAddLine(mesh, a, b) {
    if (!this.#canAddLine(mesh, a, b)) return false;
    mesh.lines.push([Math.min(a, b), Math.max(a, b)]);
    return true;
  }

  #selectVert(i, additive) {
    if (i < 0) this.selectedVerts = [];
    else if (additive) {
      if (!this.selectedVerts.includes(i)) this.selectedVerts.push(i);
    } else {
      this.selectedVerts = [i];
      this.selectedSpheres = [];
    }
    this.selectedLines = [];
    this.opts.onSelect?.();
  }

  #selectSphere(i, additive) {
    if (additive) {
      if (!this.selectedSpheres.includes(i)) this.selectedSpheres.push(i);
    } else {
      this.selectedSpheres = [i];
      this.selectedVerts = [];
    }
    this.selectedLines = [];
    this.opts.onSelect?.();
  }

  #selectVerts(indices, additive, sphereIndices = []) {
    if (additive) {
      for (const i of indices) {
        if (!this.selectedVerts.includes(i)) this.selectedVerts.push(i);
      }
      for (const i of sphereIndices) {
        if (!this.selectedSpheres.includes(i)) this.selectedSpheres.push(i);
      }
    } else {
      this.selectedVerts = [...indices];
      this.selectedSpheres = [...sphereIndices];
    }
    this.selectedLines = [];
    this.opts.onSelect?.();
  }

  #selectLine(i, additive) {
    if (i < 0) this.selectedLines = [];
    else if (additive) {
      if (!this.selectedLines.includes(i)) this.selectedLines.push(i);
    } else this.selectedLines = [i];
    this.selectedVerts = [];
    this.selectedSpheres = [];
    this.opts.onSelect?.();
  }

  #onDown(e) {
    if (!this.enabled) return;
    this.#v.canvas.focus();
    const p = this.#eventPos(e);
    const mesh = this.#mesh();
    // Orthographic views can't orbit: where the perspective view orbits, they pan.
    const turn = this.#v.kind === "persp" ? "orbit" : "pan";

    if (e.button === 2 && e.altKey) {
      this.drag = { kind: "zoom", last: p };
      this.#v.canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 1) {
      this.drag = { kind: "pan", last: p };
      this.#v.canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 2) {
      this.drag = { kind: turn, last: p };
      this.#v.canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    if (e.altKey) {
      e.preventDefault();
      this.drag = { kind: turn, last: p };
      this.#v.canvas.setPointerCapture(e.pointerId);
      return;
    }

    const prim = this.#selectionAnchor();
    const cam = this.#cam();
    if (prim) {
      const gizmoHit = hitTranslateGizmo(prim.v, cam, this.cssW, this.cssH, p.x, p.y);
      if (gizmoHit) {
        this.#startGizmoDrag(gizmoHit, prim, p, e.ctrlKey || e.metaKey);
        this.#v.canvas.setPointerCapture(e.pointerId);
        return;
      }
    }

    const hit = this.#hitHandle(p.x, p.y, mesh);
    if (hit.vert >= 0 || hit.sphere >= 0) {
      if (hit.vert >= 0) this.#selectVert(hit.vert, e.shiftKey);
      else this.#selectSphere(hit.sphere, e.shiftKey);
      this.drag = { kind: "select" };
      this.#v.canvas.setPointerCapture(e.pointerId);
      this.draw();
      return;
    }

    const ri =this.#hitSphereRing(p.x, p.y, mesh);
    if (ri >= 0) {
      this.drag = { kind: "radius", si: ri, began: false };
      this.#v.canvas.setPointerCapture(e.pointerId);
      this.draw();
      return;
    }

    const li = this.#hitLine(p.x, p.y, mesh);
    if (li >= 0) {
      this.#selectLine(li, e.shiftKey);
      this.drag = { kind: "select" };
      this.#v.canvas.setPointerCapture(e.pointerId);
      this.draw();
      return;
    }

    this.drag = { kind: "box", start: p, end: p, additive: e.shiftKey, view: this.#v };
    this.#v.canvas.setPointerCapture(e.pointerId);
  }

  #onMove(e) {
    if (!this.enabled) return;
    const p = this.#eventPos(e);
    const mesh = this.#mesh();
    if (!this.drag) {
      const prim = this.#selectionAnchor();
      const cam = this.#cam();
      const hit = this.#hitHandle(p.x, p.y, mesh);
      this.hoverVert = hit.vert;
      this.hoverSphere = hit.sphere;
      this.hoverGizmo =
        prim && hit.vert < 0 && hit.sphere < 0
          ? hitTranslateGizmo(prim.v, cam, this.cssW, this.cssH, p.x, p.y)
          : null;
      const onHandle = this.hoverGizmo || hit.vert >= 0 || hit.sphere >= 0;
      this.hoverRing = onHandle ? -1 : this.#hitSphereRing(p.x, p.y, mesh);
      this.hoverLine = onHandle || this.hoverRing >= 0 ? -1 : this.#hitLine(p.x, p.y, mesh);
      this.#v.canvas.style.cursor = this.hoverRing >= 0 ? "nesw-resize" : "";
      this.draw();
      return;
    }
    if (this.drag.kind === "radius") {
      const sp = mesh.spheres?.[this.drag.si];
      const s = sp && this.#sphereScreen(sp);
      if (!s) return;
      // Inverse of the draw radius: r = px * upp (persp z / focal, ortho 1 / pixels-per-unit).
      const r = clampItemSphereR(Math.hypot(p.x - s.sx, p.y - s.sy) * s.upp);
      if (r === sp.r) return;
      if (!this.drag.began) {
        this.opts.beginUndo?.();
        this.drag.began = true;
      }
      sp.r = r;
      this.opts.onChange?.();
      this.draw();
      return;
    }
    if (this.drag.kind === "orbit") {
      const dx = p.x - this.drag.last.x;
      const dy = p.y - this.drag.last.y;
      this.drag.last = p;
      this.orbit.yaw += dx * 0.01;
      this.orbit.pitch = Math.max(-1.2, Math.min(1.2, this.orbit.pitch - dy * 0.01));
      this.opts.onViewChanged?.();
      this.draw();
      return;
    }
    if (this.drag.kind === "pan") {
      const dx = p.x - this.drag.last.x;
      const dy = p.y - this.drag.last.y;
      this.drag.last = p;
      // Moves the shared orbit.target in this view's screen plane. dist / focal is 1 / pixels-per-unit in
      // the perspective view and the ortho views alike, so every view recentres on the same point.
      const cam = this.#cam();
      const focal = Math.min(this.cssW, this.cssH) * 0.9;
      const scale = this.orbit.dist / focal;
      const { right, up } = lookVectors(cam.yaw, cam.pitch);
      const t = this.orbit.target;
      t.x += (-right.x * dx + up.x * dy) * scale;
      t.y += (-right.y * dx + up.y * dy) * scale;
      t.z += (-right.z * dx + up.z * dy) * scale;
      this.opts.onViewChanged?.();
      this.draw();
      return;
    }
    if (this.drag.kind === "zoom") {
      const dx = p.x - this.drag.last.x;
      const dy = p.y - this.drag.last.y;
      this.drag.last = p;
      const delta = dx + dy;
      if (delta) this.orbit.dist = clampItemDist(this.orbit.dist * Math.exp(-delta * ITEM_ZOOM_K));
      this.opts.onViewChanged?.();
      this.draw();
      return;
    }
    if (this.drag.kind === "box") {
      this.drag.end = p;
      this.draw();
      return;
    }
    if (this.drag.kind === "axis") {
      const cam = this.#cam();
      const delta = gizmoAxisDragDelta(
        p,
        this.drag.grab,
        this.drag.axis,
        this.drag.start,
        this.drag.gizmoAxisLen ?? GIZMO_FALLBACK_LEN,
        cam,
        this.cssW,
        this.cssH,
        false
      );
      if (delta == null) return;
      const axis = this.drag.axis;
      if (
        this.#dragStep((v, o) => {
          v[axis] = clampItemCoord(o[axis] + delta);
        })
      ) {
        this.opts.onChange?.();
        this.draw();
      }
      return;
    }
    if (this.drag.kind === "plane") {
      const cam = this.#cam();
      const ray = screenRay(p.x, p.y, cam, this.cssW, this.cssH);
      const hit = intersectPlane(ray.origin, ray.dir, this.drag.grab, this.drag.planeN);
      if (!hit) return;
      let dx = hit.point.x - this.drag.grab.x;
      let dy = hit.point.y - this.drag.grab.y;
      let dz = hit.point.z - this.drag.grab.z;
      if (this.drag.plane === "xy") dz = 0;
      else if (this.drag.plane === "xz") dy = 0;
      else if (this.drag.plane === "yz") dx = 0;
      if (
        this.#dragStep((v, o) => {
          v.x = clampItemCoord(o.x + dx);
          v.y = clampItemCoord(o.y + dy);
          v.z = clampItemCoord(o.z + dz);
        })
      ) {
        this.opts.onChange?.();
        this.draw();
      }
    }
  }

  #boxRect() {
    const a = this.drag.start;
    const b = this.drag.end;
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }

  #vertsInBox(rect) {
    const mesh = this.#mesh();
    const cam = this.#cam();
    const hits = [];
    mesh.verts.forEach((v, i) => {
      const p = projectPoint(v, cam, this.cssW, this.cssH);
      if (!p.ok) return;
      if (p.sx >= rect.x0 && p.sx <= rect.x1 && p.sy >= rect.y0 && p.sy <= rect.y1) hits.push(i);
    });
    return hits;
  }

  #spheresInBox(rect) {
    const hits = [];
    (this.#mesh().spheres || []).forEach((sp, i) => {
      const s = this.#sphereScreen(sp);
      if (s && s.sx >= rect.x0 && s.sx <= rect.x1 && s.sy >= rect.y0 && s.sy <= rect.y1) hits.push(i);
    });
    return hits;
  }

  #finishBox() {
    const rect = this.#boxRect();
    const additive = this.drag.additive;
    if (rect.w < ITEM_BOX_CLICK && rect.h < ITEM_BOX_CLICK) {
      if (!additive) {
        this.selectedVerts = [];
        this.selectedLines = [];
        this.selectedSpheres = [];
        this.opts.onSelect?.();
      }
      return;
    }
    this.#selectVerts(this.#vertsInBox(rect), additive, this.#spheresInBox(rect));
  }

  #onUp(e) {
    if (!this.enabled) return;
    const orbitEnded = this.drag?.kind === "orbit" || this.drag?.kind === "zoom" || this.drag?.kind === "pan";
    if (this.drag?.kind === "box") this.#finishBox();
    if (this.drag?.kind === "axis" || this.drag?.kind === "plane") {
      const merged = this.drag.moved ? this.#mergeDropped(this.drag.origs.map((o) => o.i)) : 0;
      if (merged) {
        this.opts.onChange?.();
        this.opts.onSelect?.();
        this.opts.onStatus?.(`Merged ${merged} vertex${merged === 1 ? "" : "es"}`);
      }
      this.opts.endUndo?.();
    }
    if (this.drag?.kind === "radius") this.opts.endUndo?.();
    this.drag = null;
    this.#v.canvas.style.cursor = "";
    if (orbitEnded) this.opts.onViewChanged?.();
    try {
      this.#v.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.draw();
  }

  #strokeSeg(ctx, cam, w, h, p0, p1, col, width = 1) {
    const seg = projectLine(p0, p1, cam, w, h);
    if (!seg) return;
    ctx.strokeStyle = col;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(seg.ax, seg.ay);
    ctx.lineTo(seg.bx, seg.by);
    ctx.stroke();
  }

  #drawGizmo(ctx, cam, w, h, v) {
    drawTranslateGizmo(ctx, v, cam, w, h, { hoverGizmo: this.hoverGizmo, drag: this.drag });
  }

  #drawForwardArrow(ctx, cam, w, h) {
    const y = 0.15;
    const tipZ = ITEM_MAX;
    const barbZ = ITEM_MAX - 1.2;
    const tip = { x: 0, y, z: tipZ };
    const col = "#d4a017";
    this.#strokeSeg(ctx, cam, w, h, { x: 0, y, z: 0 }, tip, col, 2.5);
    this.#strokeSeg(ctx, cam, w, h, tip, { x: 0.9, y, z: barbZ }, col, 2);
    this.#strokeSeg(ctx, cam, w, h, tip, { x: -0.9, y, z: barbZ }, col, 2);
    this.#strokeSeg(ctx, cam, w, h, tip, { x: 0, y: 1.05, z: barbZ }, col, 2);
    const label = projectPoint({ x: 0, y: 0.55, z: tipZ + 0.6 }, cam, w, h);
    if (label.ok) {
      ctx.fillStyle = col;
      ctx.font = "11px Segoe UI, sans-serif";
      ctx.fillText("fwd", label.sx - 10, label.sy);
    }
  }

  /** Dim player spawn (collision box + stick figure) at game scale, for sizing. */
  #drawGhost(ctx, cam, w, h) {
    const g = this.opts.getGhost?.();
    if (!g) return;
    ctx.save();
    ctx.strokeStyle = "#3ee06a";
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.25;
    for (const [i, j] of BOX_EDGES) {
      const a = cornerWorld(g.box, i);
      const b = cornerWorld(g.box, j);
      this.#strokeSeg(ctx, cam, w, h, a, b, "#3ee06a");
    }
    ctx.globalAlpha = 0.6;
    for (const [i, j] of g.lines) {
      if (g.verts[i] && g.verts[j]) this.#strokeSeg(ctx, cam, w, h, g.verts[i], g.verts[j], "#3ee06a", 1.5);
    }
    ctx.restore();
  }

  /**
   * Top view: a guide line through every unique X (vertical, red) and unique Z (horizontal, blue) used by the
   * mesh verts and sphere origins, i.e. the values the ITEM_MAX_UNIQUE budget counts. Corner text shows the use.
   */
  #drawUniqueGuides(ctx, cam, w, h, mesh) {
    const { nx, nz, xs, zs } = itemUniqueXZ([...mesh.verts, ...(mesh.spheres || [])]);
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = GIZMO_AXIS_COLS.x;
    for (const q of xs) {
      const sx = Math.round(projectPoint({ x: q / ITEM_POS_Q, y: 0, z: 0 }, cam, w, h).sx) + 0.5;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
      ctx.stroke();
    }
    ctx.strokeStyle = GIZMO_AXIS_COLS.z;
    for (const q of zs) {
      const sy = Math.round(projectPoint({ x: 0, y: 0, z: q / ITEM_POS_Q }, cam, w, h).sy) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = nx > ITEM_MAX_UNIQUE || nz > ITEM_MAX_UNIQUE ? "#e55" : "#8b91a0";
    ctx.font = "11px Segoe UI, sans-serif";
    ctx.fillText(`unique X ${nx}/${ITEM_MAX_UNIQUE} · Z ${nz}/${ITEM_MAX_UNIQUE}`, 8, 30);
  }

  /**
   * Background grid for an ortho view: 1-unit lines (coarsened by powers of two when cells get tiny),
   * 0.25 sub-lines once zoomed in, every 4th line brighter, and the two world axes in their gizmo colours.
   */
  #drawOrthoGrid(ctx, cam, w, h) {
    const px = cam.ortho;
    const { right, up } = lookVectors(cam.yaw, cam.pitch);
    const axisOf = (v) => (Math.abs(v.x) > 0.5 ? "x" : Math.abs(v.y) > 0.5 ? "y" : "z");
    const hAxis = axisOf(right);
    const vAxis = axisOf(up);
    const hs = right[hAxis] > 0 ? 1 : -1;
    const vs = up[vAxis] > 0 ? 1 : -1;
    const o = projectPoint({ x: 0, y: 0, z: 0 }, cam, w, h);
    let step = 1;
    while (step * px < 5 && step < 64) step *= 2;
    const style = (n) => {
      if (Math.abs(n % 4) < 1e-6) return "#363e4e";
      if (Math.abs(n % 1) < 1e-6) return "#262c39";
      return "#171b24";
    };
    const line = (pos, vertical, col, alpha = 1) => {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = col;
      ctx.beginPath();
      if (vertical) {
        const x = Math.round(pos) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      } else {
        const y = Math.round(pos) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
    };
    const sub = px * 0.25 >= 7 ? 0.25 : step;
    ctx.save();
    ctx.lineWidth = 1;
    // Horizontal axis value n sits at x = o.sx + hs*n*px; vertical axis value n at y = o.sy - vs*n*px.
    const nA = ((0 - o.sx) / px) * hs;
    const nB = ((w - o.sx) / px) * hs;
    const hMin = Math.ceil(Math.min(nA, nB) / sub) * sub;
    const hMax = Math.floor(Math.max(nA, nB) / sub) * sub;
    for (let n = hMin; n <= hMax + 1e-9; n += sub) {
      if (Math.abs(n) < 1e-9) continue;
      line(o.sx + hs * n * px, true, style(n));
    }
    const nC = ((o.sy - 0) / px) * vs;
    const nD = ((o.sy - h) / px) * vs;
    const vMin = Math.ceil(Math.min(nC, nD) / sub) * sub;
    const vMax = Math.floor(Math.max(nC, nD) / sub) * sub;
    for (let n = vMin; n <= vMax + 1e-9; n += sub) {
      if (Math.abs(n) < 1e-9) continue;
      line(o.sy - vs * n * px, false, style(n));
    }
    // The line at horizontal value 0 runs along the vertical axis, and vice versa.
    line(o.sx, true, GIZMO_AXIS_COLS[vAxis], 0.55);
    line(o.sy, false, GIZMO_AXIS_COLS[hAxis], 0.55);
    ctx.restore();
  }

  draw() {
    if (!this.enabled) return;
    const prev = this.#v;
    // Live box-select preview is computed once in the view the box is dragged in.
    let preview = null;
    const d = this.drag;
    if (d?.kind === "box" && d.view) {
      this.#v = d.view;
      const r = this.#boxRect();
      if (r.w >= ITEM_BOX_CLICK || r.h >= ITEM_BOX_CLICK) {
        preview = { verts: this.#vertsInBox(r), spheres: this.#spheresInBox(r) };
      }
    }
    for (const view of this.views) {
      if (!view.w || !view.h) continue;
      this.#v = view;
      this.#drawView(view, preview);
    }
    this.#v = prev;
  }

  #drawView(view, preview) {
    const ctx = view.ctx;
    const w = view.w;
    const h = view.h;
    ctx.fillStyle = "#0a0a0c";
    ctx.fillRect(0, 0, w, h);
    const cam = this.#cam(view);
    const ortho = !!cam.ortho;
    const mesh = this.#mesh();
    const lo = ITEM_MIN;
    const hi = ITEM_MAX;

    if (ortho) this.#drawOrthoGrid(ctx, cam, w, h);
    else {
      for (let i = lo; i <= hi; i++) {
        const col = i === 0 ? "#3d4658" : "#2a3140";
        this.#strokeSeg(ctx, cam, w, h, { x: i, y: 0, z: lo }, { x: i, y: 0, z: hi }, col);
        this.#strokeSeg(ctx, cam, w, h, { x: lo, y: 0, z: i }, { x: hi, y: 0, z: i }, col);
      }
    }
    const cube = [
      [
        { x: lo, y: lo, z: lo },
        { x: hi, y: lo, z: lo },
      ],
      [
        { x: hi, y: lo, z: lo },
        { x: hi, y: lo, z: hi },
      ],
      [
        { x: hi, y: lo, z: hi },
        { x: lo, y: lo, z: hi },
      ],
      [
        { x: lo, y: lo, z: hi },
        { x: lo, y: lo, z: lo },
      ],
      [
        { x: lo, y: hi, z: lo },
        { x: hi, y: hi, z: lo },
      ],
      [
        { x: hi, y: hi, z: lo },
        { x: hi, y: hi, z: hi },
      ],
      [
        { x: hi, y: hi, z: hi },
        { x: lo, y: hi, z: hi },
      ],
      [
        { x: lo, y: hi, z: hi },
        { x: lo, y: hi, z: lo },
      ],
      [
        { x: lo, y: lo, z: lo },
        { x: lo, y: hi, z: lo },
      ],
      [
        { x: hi, y: lo, z: lo },
        { x: hi, y: hi, z: lo },
      ],
      [
        { x: hi, y: lo, z: hi },
        { x: hi, y: hi, z: hi },
      ],
      [
        { x: lo, y: lo, z: hi },
        { x: lo, y: hi, z: hi },
      ],
    ];
    for (const [a, b] of cube) this.#strokeSeg(ctx, cam, w, h, a, b, "#252a35");

    // Of the ortho views only Top shows the forward arrow; Perspective always does.
    if (view.kind === "top" || view.kind === "persp") this.#drawForwardArrow(ctx, cam, w, h);
    this.#drawGhost(ctx, cam, w, h);

    let shownVerts = this.selectedVerts;
    let shownSpheres = this.selectedSpheres;
    if (preview) {
      const add = this.drag.additive;
      shownVerts = add ? [...new Set([...this.selectedVerts, ...preview.verts])] : preview.verts;
      shownSpheres = add ? [...new Set([...this.selectedSpheres, ...preview.spheres])] : preview.spheres;
    }

    const yaw = this.#spinYaw();
    const dverts = yaw
      ? mesh.verts.map((v) => ({
          x: v.x * Math.cos(yaw) + v.z * Math.sin(yaw),
          y: v.y,
          z: -v.x * Math.sin(yaw) + v.z * Math.cos(yaw),
        }))
      : mesh.verts;

    if (view.kind === "top" && !yaw) this.#drawUniqueGuides(ctx, cam, w, h, mesh);

    mesh.lines.forEach(([ia, ib], i) => {
      const a = dverts[ia];
      const b = dverts[ib];
      if (!a || !b) return;
      const sel = this.selectedLines.includes(i);
      this.#strokeSeg(ctx, cam, w, h, a, b, sel ? "#f2d36b" : "#c8ccd4", sel ? 2.5 : 1.5);
    });

    // Spheres: smooth camera-facing circles (radius r * focal / z, as the game scales them; the game's
    // pixel circle is only in the Preview view). Centre is a diamond handle, circumference is draggable.
    (mesh.spheres || []).forEach((sp, i) => {
      const c = yaw
        ? { x: sp.x * Math.cos(yaw) + sp.z * Math.sin(yaw), y: sp.y, z: -sp.x * Math.sin(yaw) + sp.z * Math.cos(yaw) }
        : sp;
      const pr = projectPoint(c, cam, w, h);
      if (!pr.ok) return;
      const rad = ortho ? sp.r * cam.ortho : (sp.r * Math.min(w, h) * 0.9) / pr.z;
      const sel = shownSpheres.includes(i);
      const hot = this.hoverRing === i || (this.drag?.kind === "radius" && this.drag.si === i);
      const col = sel ? SPHERE_COL_SEL : hot ? SPHERE_COL_HOT : SPHERE_COL;
      if (rad >= 0.5 && rad <= 4 * Math.max(w, h)) {
        ctx.beginPath();
        ctx.arc(pr.sx, pr.sy, rad, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(224, 138, 62, 0.07)";
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = hot ? 2.5 : 1.5;
        ctx.stroke();
      }
      const ho = this.hoverSphere === i;
      const d = sel || ho ? 6 : 5;
      ctx.beginPath();
      ctx.moveTo(pr.sx, pr.sy - d);
      ctx.lineTo(pr.sx + d, pr.sy);
      ctx.lineTo(pr.sx, pr.sy + d);
      ctx.lineTo(pr.sx - d, pr.sy);
      ctx.closePath();
      ctx.fillStyle = ho && !sel ? "#fff" : col;
      ctx.fill();
      ctx.strokeStyle = "#0a0a0c";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (hot) {
        ctx.fillStyle = col;
        ctx.font = "11px Segoe UI, sans-serif";
        ctx.fillText(`r ${sp.r}`, pr.sx + 9, pr.sy - 9);
      }
    });

    dverts.forEach((v, i) => {
      const pr = projectPoint(v, cam, w, h);
      if (!pr.ok) return;
      const sel = shownVerts.includes(i);
      const ho = i === this.hoverVert;
      ctx.fillStyle = sel ? "#d4a017" : ho ? "#fff" : "#6ec4a8";
      const r = sel || ho ? 5 : 4;
      ctx.beginPath();
      ctx.arc(pr.sx, pr.sy, r, 0, Math.PI * 2);
      ctx.fill();
    });

    const prim = this.#selectionAnchor();
    if (prim) this.#drawGizmo(ctx, cam, w, h, prim.v);

    if (this.drag?.kind === "box" && this.drag.view === view) {
      const r = this.#boxRect();
      ctx.fillStyle = "rgba(212, 160, 23, 0.12)";
      ctx.fillRect(r.x0, r.y0, r.w, r.h);
      ctx.strokeStyle = "#d4a017";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(r.x0 + 0.5, r.y0 + 0.5, r.w, r.h);
      ctx.setLineDash([]);
    }

    ctx.fillStyle = "#8b91a0";
    ctx.font = "11px Segoe UI, sans-serif";
    ctx.fillText(ITEM_VIEW_DEFS[view.kind].label, 8, 16);
  }
}
