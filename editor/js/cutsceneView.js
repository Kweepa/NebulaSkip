import {
  ITEM_WORLD_BIAS,
  itemMeshFor,
  itemMeshWorldSegs,
  itemSphereWorld,
  roomGeometry,
  WORLD_MAX,
  WORLD_MIN,
} from "./model.js";
import { intersectPlane, lookVectors, projectLine, projectPoint, screenRay } from "./math3d.js";
import {
  GIZMO_FALLBACK_LEN,
  drawTranslateGizmo,
  gizmoAxisDragDelta,
  hitTranslateGizmo,
} from "./gizmo.js";
import { cutActorStart, cutSampleAt, yawByteToRad } from "./cutsceneModel.js";

const CUT_ZOOM_K = 0.008;
const CUT_DIST_MIN = 20;
const CUT_DIST_MAX = 1200;
const CUT_HIT_PX = 10;
const CUT_COL_ITEM = "#c8ccd4";
const CUT_COL_CAMERA = "#f2d36b";
const CUT_COL_PATH = "#3f7f8a";
const CUT_COL_SEL = "#d4a017";
const CUT_COL_TARGET = "#c8603c";
const CUT_CAM_LEN = 10;
// Game view: 192x128 at focal 100 -> half extents 0.96 / 0.64 of the view depth.
const CUT_CAM_HW = 0.96;
const CUT_CAM_HH = 0.64;

function cutViewClamp(n) {
  return Math.max(WORLD_MIN, Math.min(WORLD_MAX, Math.round(n)));
}

/**
 * Perspective orbit editor for the Cutscene tab. Draws on the shared #view-canvas.
 * The cutscene state lives in the map; this class edits it through opts callbacks.
 *
 * opts: stage, getDoc(), getCutscene() (map.cutscene or null), getBaked() (bakeCutscene result),
 *   getTimeMs(), beginUndo(), endUndo(), onChange() (data edited), onSelect(), onViewChanged(),
 *   onDelete() (Delete key on the canvas).
 */
export class CutsceneView {
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.opts = opts;
    this.orbit = { yaw: 0.6, pitch: 0.45, dist: 300, target: { x: 128, y: 40, z: 128 } };
    /** actor: id | null; point: path index, or -1 for the actor itself. */
    this.sel = { actor: null, point: -1 };
    this.drag = null;
    this.hoverGizmo = null;
    this.hoverAnchor = null;
    this.enabled = false;
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(opts.stage || canvas.parentElement);

    canvas.addEventListener("pointerdown", (e) => this.#onDown(e));
    canvas.addEventListener("pointermove", (e) => this.#onMove(e));
    canvas.addEventListener("pointerup", (e) => this.#onUp(e));
    canvas.addEventListener("pointerleave", (e) => this.#onUp(e));
    canvas.addEventListener("wheel", (e) => this.#onWheel(e), { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("keydown", (e) => this.#onKey(e));
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 1) e.preventDefault();
    });
    canvas.addEventListener("auxclick", (e) => {
      if (e.button === 1) e.preventDefault();
    });
  }

  resize() {
    if (!this.enabled) return;
    const stage = this.opts.stage || this.canvas.parentElement;
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(64, Math.floor(rect.width));
    const h = Math.max(64, Math.floor(rect.height));
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssW = w;
    this.cssH = h;
    this.draw();
  }

  setSelection(actor, point = -1) {
    this.sel = { actor, point };
    this.opts.onSelect?.();
    this.draw();
  }

  /** Frame the world cube (0..255) or the given room. */
  focus(room = null) {
    let c = { x: 128, y: 40, z: 128 };
    let size = 300;
    if (room) {
      c = { x: room.x + room.sx / 2, y: room.y + room.sy / 2, z: room.z + room.sz / 2 };
      size = Math.max(60, Math.hypot(room.sx, room.sy, room.sz) * 1.1);
    }
    this.orbit.target = c;
    this.orbit.dist = Math.max(CUT_DIST_MIN, Math.min(CUT_DIST_MAX, size));
    this.opts.onViewChanged?.();
    this.draw();
  }

  #cam() {
    const { yaw, pitch, dist, target } = this.orbit;
    const { forward } = lookVectors(yaw, pitch);
    return {
      x: target.x - forward.x * dist,
      y: target.y - forward.y * dist,
      z: target.z - forward.z * dist,
      yaw,
      pitch,
    };
  }

  #eventPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * this.cssW,
      y: ((e.clientY - rect.top) / rect.height) * this.cssH,
    };
  }

  #cut() {
    return this.opts.getCutscene?.() || null;
  }

  #actor(id) {
    return this.#cut()?.actors.find((a) => a.id === id) || null;
  }

  /** Where an actor's coordinate is drawn: items sit at x/z + ITEM_WORLD_BIAS (like placed pickups), the camera does not. */
  #shown(a, v) {
    const b = a.kind === "item" ? ITEM_WORLD_BIAS : 0;
    return { x: v.x + b, y: v.y, z: v.z + b };
  }

  /** The gizmo anchor: the selected path point, or a stationary selected actor. `raw` is the stored value, `v` where it is drawn. */
  #selAnchor() {
    const a = this.#actor(this.sel.actor);
    if (!a) return null;
    let raw;
    let point = -1;
    if (a.path.length) {
      const p = a.path[this.sel.point];
      if (!p) return null;
      raw = { x: p.x, y: p.y, z: p.z };
      point = this.sel.point;
    } else raw = { x: a.x, y: a.y, z: a.z };
    return { a, point, raw, v: this.#shown(a, raw) };
  }

  /** Everything pickable: path points, plus each actor's position at the timeline cursor. */
  #anchors() {
    const cut = this.#cut();
    if (!cut) return [];
    const baked = this.opts.getBaked?.();
    const t = this.opts.getTimeMs?.() ?? 0;
    const out = [];
    for (const a of cut.actors) {
      a.path.forEach((p, i) => out.push({ actor: a.id, point: i, pos: this.#shown(a, p) }));
      const b = baked?.actors.find((o) => o.id === a.id);
      const s = b ? cutSampleAt(b, t) : cutActorStart(a);
      out.push({ actor: a.id, point: -1, pos: this.#shown(a, s) });
    }
    return out;
  }

  #hitAnchor(mx, my) {
    const cam = this.#cam();
    let best = null;
    let bestD = CUT_HIT_PX;
    for (const an of this.#anchors()) {
      const p = projectPoint(an.pos, cam, this.cssW, this.cssH);
      if (!p.ok) continue;
      const d = Math.hypot(mx - p.sx, my - p.sy);
      // Path points beat the time marker when they overlap.
      if (d < bestD || (an.point >= 0 && d <= bestD && best && best.point < 0)) {
        bestD = d;
        best = an;
      }
    }
    return best;
  }

  zoomBy(factor) {
    this.orbit.dist = Math.max(CUT_DIST_MIN, Math.min(CUT_DIST_MAX, this.orbit.dist * factor));
    this.opts.onViewChanged?.();
    this.draw();
  }

  #onWheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this.zoomBy(e.deltaY > 0 ? 1.1 : 1 / 1.1);
  }

  #onKey(e) {
    if (!this.enabled) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      this.opts.onDelete?.();
    } else if (e.key === "f" || e.key === "F") {
      this.opts.onFocus?.();
    }
  }

  #onDown(e) {
    if (!this.enabled) return;
    this.canvas.focus();
    const p = this.#eventPos(e);
    const grab = (kind) => {
      this.drag = { kind, last: p };
      this.canvas.setPointerCapture(e.pointerId);
    };
    if (e.button === 2 && e.altKey) return grab("zoom");
    if (e.button === 1) return grab("pan");
    if (e.button === 2) return grab("orbit");
    if (e.button !== 0) return;
    if (e.altKey) {
      e.preventDefault();
      return grab("orbit");
    }
    const anchor = this.#selAnchor();
    if (anchor) {
      const hit = hitTranslateGizmo(anchor.v, this.#cam(), this.cssW, this.cssH, p.x, p.y);
      if (hit) {
        this.opts.beginUndo?.();
        this.drag = {
          kind: hit.kind,
          axis: hit.axis,
          plane: hit.plane,
          planeN: hit.planeN,
          grab: hit.world,
          gizmoAxisLen: hit.gizmoAxisLen ?? GIZMO_FALLBACK_LEN,
          orig: { ...anchor.raw },
          actor: anchor.a.id,
          point: anchor.point,
          start: p,
        };
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    const an = this.#hitAnchor(p.x, p.y);
    if (an) this.setSelection(an.actor, an.point);
    else this.setSelection(null, -1);
    this.drag = { kind: "select" };
    this.canvas.setPointerCapture(e.pointerId);
  }

  /** Move the dragged anchor to `next`, keeping a path actor's x/y/z in step with point 0. */
  #applyPos(next) {
    const a = this.#actor(this.drag.actor);
    if (!a) return;
    const v = { x: cutViewClamp(next.x), y: cutViewClamp(next.y), z: cutViewClamp(next.z) };
    if (this.drag.point >= 0) {
      Object.assign(a.path[this.drag.point], v);
      if (this.drag.point === 0) Object.assign(a, v);
    } else Object.assign(a, v);
    this.opts.onChange?.();
    this.draw();
  }

  #onMove(e) {
    if (!this.enabled) return;
    const p = this.#eventPos(e);
    const d = this.drag;
    if (!d) {
      const anchor = this.#selAnchor();
      this.hoverGizmo = anchor ? hitTranslateGizmo(anchor.v, this.#cam(), this.cssW, this.cssH, p.x, p.y) : null;
      this.hoverAnchor = this.hoverGizmo ? null : this.#hitAnchor(p.x, p.y);
      this.draw();
      return;
    }
    if (d.kind === "orbit") {
      const dx = p.x - d.last.x;
      const dy = p.y - d.last.y;
      d.last = p;
      this.orbit.yaw += dx * 0.01;
      this.orbit.pitch = Math.max(-1.4, Math.min(1.4, this.orbit.pitch - dy * 0.01));
      this.draw();
    } else if (d.kind === "pan") {
      const dx = p.x - d.last.x;
      const dy = p.y - d.last.y;
      d.last = p;
      const scale = this.orbit.dist / (Math.min(this.cssW, this.cssH) * 0.9);
      const { right, up } = lookVectors(this.orbit.yaw, this.orbit.pitch);
      const t = this.orbit.target;
      t.x += (-right.x * dx + up.x * dy) * scale;
      t.y += (-right.y * dx + up.y * dy) * scale;
      t.z += (-right.z * dx + up.z * dy) * scale;
      this.draw();
    } else if (d.kind === "zoom") {
      const delta = p.x - d.last.x + (p.y - d.last.y);
      d.last = p;
      if (delta) this.zoomBy(Math.exp(-delta * CUT_ZOOM_K));
    } else if (d.kind === "axis") {
      const delta = gizmoAxisDragDelta(p, d.grab, d.axis, d.start, d.gizmoAxisLen, this.#cam(), this.cssW, this.cssH, true);
      if (delta == null) return;
      this.#applyPos({ ...d.orig, [d.axis]: d.orig[d.axis] + delta });
    } else if (d.kind === "plane") {
      const ray = screenRay(p.x, p.y, this.#cam(), this.cssW, this.cssH);
      const hit = intersectPlane(ray.origin, ray.dir, d.grab, d.planeN);
      if (!hit) return;
      let dx = Math.round(hit.point.x - d.grab.x);
      let dy = Math.round(hit.point.y - d.grab.y);
      let dz = Math.round(hit.point.z - d.grab.z);
      if (d.plane === "xy") dz = 0;
      else if (d.plane === "xz") dy = 0;
      else if (d.plane === "yz") dx = 0;
      this.#applyPos({ x: d.orig.x + dx, y: d.orig.y + dy, z: d.orig.z + dz });
    }
  }

  #onUp(e) {
    if (!this.enabled) return;
    const kind = this.drag?.kind;
    if (kind === "axis" || kind === "plane") this.opts.endUndo?.();
    this.drag = null;
    if (kind === "orbit" || kind === "zoom" || kind === "pan") this.opts.onViewChanged?.();
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.draw();
  }

  #seg(ctx, cam, a, b, col, width = 1) {
    const s = projectLine(a, b, cam, this.cssW, this.cssH);
    if (!s) return;
    ctx.strokeStyle = col;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(s.ax, s.ay);
    ctx.lineTo(s.bx, s.by);
    ctx.stroke();
  }

  #dot(ctx, cam, pos, r, fill, stroke = null) {
    const p = projectPoint(pos, cam, this.cssW, this.cssH);
    if (!p.ok) return;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  #sphere(ctx, cam, s, col) {
    const p = projectPoint(s, cam, this.cssW, this.cssH);
    if (!p.ok) return;
    const focal = Math.min(this.cssW, this.cssH) * 0.9;
    const R = (s.r * focal) / p.z;
    if (R < 1) return;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, R, 0, Math.PI * 2);
    ctx.stroke();
  }

  #drawCameraGlyph(ctx, cam, pos, yawByte, col, width) {
    const yaw = yawByteToRad(yawByte);
    const { forward, right, up } = lookVectors(yaw, 0);
    const c = { x: pos.x + forward.x * CUT_CAM_LEN, y: pos.y + forward.y * CUT_CAM_LEN, z: pos.z + forward.z * CUT_CAM_LEN };
    const corner = (sx, sy) => ({
      x: c.x + right.x * sx * CUT_CAM_HW * CUT_CAM_LEN + up.x * sy * CUT_CAM_HH * CUT_CAM_LEN,
      y: c.y + right.y * sx * CUT_CAM_HW * CUT_CAM_LEN + up.y * sy * CUT_CAM_HH * CUT_CAM_LEN,
      z: c.z + right.z * sx * CUT_CAM_HW * CUT_CAM_LEN + up.z * sy * CUT_CAM_HH * CUT_CAM_LEN,
    });
    const k = [corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)];
    for (let i = 0; i < 4; i++) {
      this.#seg(ctx, cam, pos, k[i], col, width);
      this.#seg(ctx, cam, k[i], k[(i + 1) % 4], col, width);
    }
  }

  draw() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const w = this.cssW;
    const h = this.cssH;
    if (!w || !h) return;
    ctx.fillStyle = "#0a0a0c";
    ctx.fillRect(0, 0, w, h);
    const cam = this.#cam();
    const doc = this.opts.getDoc();
    const cut = this.#cut();

    // World cube 0..255 (floor grid every 32).
    ctx.lineWidth = 1;
    for (let i = 0; i <= 256; i += 32) {
      this.#seg(ctx, cam, { x: i, y: 0, z: 0 }, { x: i, y: 0, z: 256 }, "#2c3340");
      this.#seg(ctx, cam, { x: 0, y: 0, z: i }, { x: 256, y: 0, z: i }, "#2c3340");
    }
    this.#seg(ctx, cam, { x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }, "#a66", 2);
    this.#seg(ctx, cam, { x: 0, y: 0, z: 0 }, { x: 0, y: 40, z: 0 }, "#6a6", 2);
    this.#seg(ctx, cam, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 40 }, "#66a", 2);

    const room = this.opts.getRoom?.();
    if (room) {
      const g = roomGeometry(room);
      for (const e of g.edges) this.#seg(ctx, cam, g.verts[e.a], g.verts[e.b], "#6b7488", 1.25);
    }
    if (!cut) {
      ctx.fillStyle = "#8b91a0";
      ctx.font = "12px Segoe UI, sans-serif";
      ctx.fillText("Pick a cutscene room, then add actors.", 12, 20);
      this.opts.onDrawn?.();
      return;
    }

    const baked = this.opts.getBaked?.();
    const t = this.opts.getTimeMs?.() ?? 0;
    const poses = new Map();
    for (const a of cut.actors) {
      const b = baked?.actors.find((o) => o.id === a.id);
      poses.set(a.id, b ? cutSampleAt(b, t) : { ...cutActorStart(a), yaw: 0 });
    }

    for (const a of cut.actors) {
      const isSel = a.id === this.sel.actor;
      const b = baked?.actors.find((o) => o.id === a.id);
      if (b && b.ns > 1) {
        for (let i = 0; i + 1 < b.ns; i++) {
          this.#seg(
            ctx,
            cam,
            this.#shown(a, { x: b.x[i], y: b.y[i], z: b.z[i] }),
            this.#shown(a, { x: b.x[i + 1], y: b.y[i + 1], z: b.z[i + 1] }),
            isSel ? CUT_COL_PATH : "#2d4a50",
            isSel ? 2 : 1.25
          );
        }
      }
      a.path.forEach((p, i) => {
        const sel = isSel && this.sel.point === i;
        const hov = this.hoverAnchor?.actor === a.id && this.hoverAnchor.point === i;
        this.#dot(ctx, cam, this.#shown(a, p), sel ? 5.5 : 4, sel ? CUT_COL_SEL : hov ? "#fff" : isSel ? "#7fd0da" : "#4f8f98");
      });
      const pose = poses.get(a.id);
      if (a.kind === "camera") {
        this.#drawCameraGlyph(ctx, cam, pose, pose.yaw, isSel ? "#fff" : CUT_COL_CAMERA, isSel ? 2 : 1.25);
        if (a.facing === "target") {
          const tp = poses.get(a.target);
          if (tp) {
            ctx.setLineDash([4, 3]);
            const ta = this.#actor(a.target);
            this.#seg(ctx, cam, pose, ta ? this.#shown(ta, tp) : tp, CUT_COL_TARGET, 1);
            ctx.setLineDash([]);
          }
        }
      } else {
        const obj = { x: pose.x, y: pose.y, z: pose.z, scale: a.scale };
        const yaw = yawByteToRad(pose.yaw);
        const mesh = itemMeshFor(doc, a.item);
        const col = isSel ? "#fff" : CUT_COL_ITEM;
        for (const s of itemMeshWorldSegs(obj, mesh, yaw)) this.#seg(ctx, cam, s.a, s.b, col, isSel ? 2 : 1.25);
        for (const s of itemSphereWorld(obj, mesh, yaw)) this.#sphere(ctx, cam, s, col);
        // Facing tick so a mesh-less or symmetric item still shows its heading.
        const { forward } = lookVectors(yaw, 0);
        const o = this.#shown(a, pose);
        this.#seg(ctx, cam, o, { x: o.x + forward.x * 6, y: o.y, z: o.z + forward.z * 6 }, "#d4a017", 1);
      }
      const hov = this.hoverAnchor?.actor === a.id && this.hoverAnchor.point < 0;
      this.#dot(ctx, cam, this.#shown(a, pose), hov ? 4 : 2.5, hov ? "#fff" : isSel && this.sel.point < 0 ? CUT_COL_SEL : "#8b91a0");
    }

    const anchor = this.#selAnchor();
    if (anchor) drawTranslateGizmo(ctx, anchor.v, cam, w, h, { hoverGizmo: this.hoverGizmo, drag: this.drag });

    ctx.fillStyle = "#8b91a0";
    ctx.font = "11px Segoe UI, sans-serif";
    ctx.fillText(`${(t / 1000).toFixed(2)} s / ${(cut.duration || 0).toFixed(2)} s`, 8, 16);
    this.opts.onDrawn?.();
  }
}
