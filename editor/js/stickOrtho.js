/**
 * Orthographic stick pane. Front edits X/Y. Left edits Z/Y.
 * Selection matches the perspective view: click a vertex or a line, drag a box on empty space,
 * Shift adds. A press on an already-selected vertex drags the whole selection.
 */

import { distPointToSegment2d } from "./math3d.js";

export const STICK_GROUND_Y = 0.72;

const HIT = 8;
const STICK_LINE_HIT = 6;
/** A box smaller than this in both dimensions is a click (clears the selection unless Shift). */
const STICK_BOX_CLICK = 4;

function clampCoord(v, lim) {
  const n = Math.round(v);
  if (n < -lim) return -lim;
  if (n > lim) return lim;
  return n;
}

export class StickOrtho {
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.opts = opts;
    this.drag = null;
    this.px = 4;
    this.panX = 0;
    this.panY = 0;
    this.enabled = false;
    canvas.addEventListener("pointerdown", (e) => this.#onDown(e));
    canvas.addEventListener("pointermove", (e) => this.#onMove(e));
    canvas.addEventListener("pointerup", (e) => this.#onUp(e));
    canvas.addEventListener("pointerleave", (e) => this.#onUp(e));
    canvas.addEventListener("wheel", (e) => this.#onWheel(e), { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 1) e.preventDefault();
    });
  }

  resize() {
    if (!this.enabled) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(32, Math.floor(rect.width));
    const h = Math.max(32, Math.floor(rect.height));
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssW = w;
    this.cssH = h;
    this.draw();
  }

  #enemy() {
    return this.opts.getEnemy?.() || null;
  }

  #verts() {
    const e = this.#enemy();
    const fi = this.opts.getFrame?.() ?? 0;
    return e?.frames?.[fi] || null;
  }

  #groundPan() {
    return this.opts.getGroundPan?.() ?? this.panY;
  }

  #origin() {
    return {
      x: this.cssW * 0.5 + this.panX,
      y: this.cssH * STICK_GROUND_Y + this.#groundPan(),
    };
  }

  // Front looks along -Z, so screen-right is -X, matching the perspective camera.
  // Left looks along +X (180° from the old right view), so screen-right is -Z.
  // opts.mirror() flips the horizontal axis (left view becomes the right view).
  #sign() {
    return this.opts.mirror?.() ? 1 : -1;
  }

  #toScreen(v) {
    const o = this.#origin();
    const horiz = this.opts.horiz === "z" ? v.z : v.x;
    return { x: o.x + this.#sign() * horiz * this.px, y: o.y - v.y * this.px };
  }

  #eventPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * this.cssW,
      y: ((e.clientY - rect.top) / rect.height) * this.cssH,
    };
  }

  #hitVert(sx, sy) {
    const verts = this.#verts();
    if (!verts) return -1;
    let best = -1;
    let bestD = HIT * HIT;
    for (let i = 0; i < verts.length; i++) {
      const p = this.#toScreen(verts[i]);
      const d = (p.x - sx) ** 2 + (p.y - sy) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  #onDown(e) {
    if (!this.enabled) return;
    const p = this.#eventPos(e);
    if (e.button === 1 || e.button === 2) {
      this.drag = { kind: "pan", x: p.x, y: p.y, panX: this.panX, panY: this.#groundPan() };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    if (this.opts.showWire?.() === false) return;
    const selected = this.opts.getSelected?.() || [];
    const hit = this.#hitVert(p.x, p.y);
    if (hit >= 0) {
      if (e.shiftKey) {
        // Shift only adds, as in the perspective view; no drag so a stray Shift-click can't move anything.
        this.opts.onSelect?.(selected.includes(hit) ? selected : [...selected, hit]);
        this.drag = { kind: "select" };
        this.canvas.setPointerCapture(e.pointerId);
        this.draw();
        return;
      }
      const next = selected.includes(hit) ? selected : [hit];
      this.opts.onSelect?.(next);
      const verts = this.#verts();
      this.drag = {
        kind: "vert",
        x: p.x,
        y: p.y,
        indices: next.slice(),
        start: next.map((i) => ({ ...verts[i] })),
        undo: false,
      };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    const li = this.#hitLine(p.x, p.y);
    if (li >= 0) {
      this.opts.onSelectLine?.(li, e.shiftKey);
      this.drag = { kind: "select" };
      this.canvas.setPointerCapture(e.pointerId);
      this.draw();
      return;
    }
    this.drag = { kind: "box", start: p, end: p, additive: e.shiftKey };
    this.canvas.setPointerCapture(e.pointerId);
  }

  #hitLine(sx, sy) {
    const verts = this.#verts();
    const lines = this.#enemy()?.lines;
    if (!verts || !lines) return -1;
    let best = -1;
    let bestD = STICK_LINE_HIT;
    lines.forEach(([a, b], i) => {
      const pa = verts[a];
      const pb = verts[b];
      if (!pa || !pb) return;
      const sa = this.#toScreen(pa);
      const sb = this.#toScreen(pb);
      const d = distPointToSegment2d(sx, sy, sa.x, sa.y, sb.x, sb.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
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

  /** Every vertex whose projection is in the box, regardless of depth. */
  #vertsInBox(rect) {
    const hits = [];
    (this.#verts() || []).forEach((v, i) => {
      const p = this.#toScreen(v);
      if (p.x >= rect.x0 && p.x <= rect.x1 && p.y >= rect.y0 && p.y <= rect.y1) hits.push(i);
    });
    return hits;
  }

  #finishBox() {
    const rect = this.#boxRect();
    const additive = this.drag.additive;
    if (rect.w < STICK_BOX_CLICK && rect.h < STICK_BOX_CLICK) {
      if (!additive) this.opts.onSelect?.([]);
      return;
    }
    const hits = this.#vertsInBox(rect);
    const selected = this.opts.getSelected?.() || [];
    this.opts.onSelect?.(additive ? [...new Set([...selected, ...hits])] : hits);
  }

  #onMove(e) {
    if (!this.drag) return;
    const p = this.#eventPos(e);
    if (this.drag.kind === "pan") {
      this.panX = this.drag.panX + (p.x - this.drag.x);
      const panY = this.drag.panY + (p.y - this.drag.y);
      if (this.opts.setGroundPan) this.opts.setGroundPan(panY);
      else this.panY = panY;
      this.draw();
      return;
    }
    if (this.drag.kind === "box") {
      this.drag.end = p;
      this.draw();
      return;
    }
    if (this.drag.kind !== "vert") return;
    if (!this.drag.undo) {
      this.opts.beginUndo?.();
      this.drag.undo = true;
    }
    const verts = this.#verts();
    const lim = this.opts.vertLimit?.() ?? 127;
    const quant = this.opts.clampVert;
    const du = (p.x - this.drag.x) / this.px;
    const dy = (this.drag.y - p.y) / this.px;
    const horiz = this.opts.horiz === "z" ? "z" : "x";
    const sign = this.#sign();
    this.drag.indices.forEach((i, n) => {
      const src = this.drag.start[n];
      if (!src || !verts[i]) return;
      const x = src[horiz] + sign * du;
      const y = src.y + dy;
      verts[i][horiz] = quant ? quant(x) : clampCoord(x, lim);
      verts[i].y = quant ? quant(y) : clampCoord(y, lim);
    });
    this.draw();
    this.opts.onPose?.();
  }

  #onUp(e) {
    if (!this.drag) return;
    const kind = this.drag.kind;
    if (kind === "box") this.#finishBox();
    if (this.drag.undo) this.opts.endUndo?.();
    this.drag = null;
    if (this.canvas.hasPointerCapture?.(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    // Selection-only gestures don't change the pose, so they must not mark the document dirty.
    if (kind === "box" || kind === "select") this.draw();
    else this.opts.onPose?.();
  }

  setScale(px) {
    this.px = Math.max(0.05, Math.min(800, px));
  }

  #onWheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this.opts.onZoom?.(e.deltaY > 0 ? 1.1 : 1 / 1.1);
  }

  /** 1-unit grid in vertex coordinates; major lines every 8 and 32. Origin axes are brighter. */
  #drawGrid(o) {
    const ctx = this.ctx;
    const w = this.cssW;
    const h = this.cssH;
    const px = this.px;
    // Coarsen by powers of two until cells are at least ~5 px.
    let step = 1;
    while (step * px < 5 && step < 64) step *= 2;
    const line = (pos, vertical, style) => {
      ctx.strokeStyle = style;
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
    const style = (n) => {
      if (n === 0) return "rgba(120,150,190,0.55)";
      if (n % 32 === 0) return "rgba(120,150,190,0.30)";
      if (n % 8 === 0) return "rgba(120,150,190,0.18)";
      return "rgba(120,150,190,0.07)";
    };
    ctx.save();
    ctx.lineWidth = 1;
    // Screen x = o.x + sign*n*px; screen y = o.y - n*px.
    const s = this.#sign();
    const nA = ((0 - o.x) / px) * s;
    const nB = ((w - o.x) / px) * s;
    const nxMin = Math.ceil(Math.min(nA, nB) / step) * step;
    const nxMax = Math.floor(Math.max(nA, nB) / step) * step;
    for (let n = nxMin; n <= nxMax; n += step) line(o.x + s * n * px, true, style(n));
    const nyMin = Math.ceil((o.y - h) / px / step) * step;
    const nyMax = Math.floor(o.y / px / step) * step;
    for (let n = nyMin; n <= nyMax; n += step) line(o.y - n * px, false, style(n));
    ctx.restore();
  }

  draw() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const w = this.cssW;
    const h = this.cssH;
    if (!w || !h) return;
    ctx.fillStyle = "#0a0a0c";
    ctx.fillRect(0, 0, w, h);
    const e = this.#enemy();
    const verts = this.#verts();
    const o = this.#origin();
    this.#drawGrid(o);
    const sprite = this.opts.getSprite?.();
    const scale = this.opts.spriteScale?.() ?? 1;
    if (sprite?.canvas) {
      const k = scale * this.px;
      const dw = sprite.canvas.width * k;
      const dh = sprite.canvas.height * k;
      const left = sprite.flip ? sprite.canvas.width - sprite.left : sprite.left;
      const dx = o.x - left * k;
      const dy = o.y - sprite.top * k;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.85;
      if (sprite.flip) {
        ctx.translate(dx + dw, dy);
        ctx.scale(-1, 1);
        ctx.drawImage(sprite.canvas, 0, 0, dw, dh);
      } else {
        ctx.drawImage(sprite.canvas, dx, dy, dw, dh);
      }
      ctx.restore();
    }
    const ghost = this.opts.getGhostItem?.();
    if (ghost?.length) {
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#6b5a8a";
      ctx.beginPath();
      for (const s of ghost) {
        const sa = this.#toScreen(s.a);
        const sb = this.#toScreen(s.b);
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (!verts || this.opts.showWire?.() === false) return;
    let selectedList = this.opts.getSelected?.() || [];
    // Live preview of a box-select in progress.
    const boxing = this.drag?.kind === "box";
    const rect = boxing ? this.#boxRect() : null;
    if (rect && (rect.w >= STICK_BOX_CLICK || rect.h >= STICK_BOX_CLICK)) {
      const hits = this.#vertsInBox(rect);
      selectedList = this.drag.additive ? [...new Set([...selectedList, ...hits])] : hits;
    }
    const selected = new Set(selectedList);
    const selLines = new Set(this.opts.getSelectedLines?.() || []);
    let li = -1;
    for (const [a, b] of e.lines || []) {
      li++;
      const pa = verts[a];
      const pb = verts[b];
      if (!pa || !pb) continue;
      const sa = this.#toScreen(pa);
      const sb = this.#toScreen(pb);
      const lineSel = selLines.has(li);
      ctx.lineWidth = lineSel ? 2.5 : 1.5;
      ctx.strokeStyle = lineSel ? "#fc6" : "#9ab";
      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.stroke();
    }
    for (let i = 0; i < verts.length; i++) {
      const p = this.#toScreen(verts[i]);
      ctx.fillStyle = selected.has(i) ? "#fc6" : "#eee";
      ctx.beginPath();
      ctx.arc(p.x, p.y, selected.has(i) ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (rect) {
      ctx.fillStyle = "rgba(212, 160, 23, 0.12)";
      ctx.fillRect(rect.x0, rect.y0, rect.w, rect.h);
      ctx.strokeStyle = "#d4a017";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(rect.x0 + 0.5, rect.y0 + 0.5, rect.w, rect.h);
      ctx.setLineDash([]);
    }
  }
}
