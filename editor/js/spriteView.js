import {
  SPRITE_DEFS,
  SPRITE_H_MAX,
  SPRITE_H_MIN,
  SPRITE_H_STEP,
  SPRITE_W_MAX,
  SPRITE_W_MIN,
  SPRITE_W_STEP,
  spriteBlankRows,
  spriteDef,
  spriteFlipHRows,
  spriteFlipVRows,
  spriteGet,
  spriteInvertRows,
  spriteResize,
  spriteRowsEqual,
  spriteSet,
  spriteShiftRows,
} from "./spriteModel.js";

const SPR_INK = "#ffffff";
const SPR_BG = "#000000";
const SPR_GRID = "rgba(255, 255, 255, 0.14)";
const SPR_MID = "rgba(255, 200, 80, 0.35)";
const SPR_MAX_W = 560;
const SPR_MAX_H = 520;

function sprEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * Sprites tab: list of viewport overlay sprites (left), 2x1-pixel white-on-black painter (centre)
 * with width/height sliders and a shift cross. Data lives in doc.sprites, read via opts.getSprites().
 * opts: left, panel (DOM roots), getSprites, beginUndo, endUndo, markDirty,
 *       onChange (inspector rebuild), onSelect (selected sprite changed or edited: redraw preview), onStatus.
 */
export class SpriteView {
  constructor(opts) {
    this.opts = opts;
    this.enabled = false;
    this.selId = SPRITE_DEFS[0].id;
    this.clip = null;
    this.stroke = null;
    this.thumbs = new Map();
    this.#buildList(opts.left);
    this.#buildPanel(opts.panel);
  }

  // ---- state ----

  getState() {
    return { sel: this.selId };
  }

  setState(s) {
    this.selId = spriteDef(s?.sel) ? s.sel : SPRITE_DEFS[0].id;
  }

  selected() {
    return this.opts.getSprites().find((s) => s.id === this.selId) || null;
  }

  hasClip() {
    return !!this.clip;
  }

  // ---- DOM ----

  #buildList(root) {
    root.textContent = "";
    root.append(sprEl("h2", "", "Sprites"));
    const wrap = sprEl("div", "spr-list");
    let group = null;
    for (const def of SPRITE_DEFS) {
      if (def.group !== group) {
        group = def.group;
        wrap.append(sprEl("h3", "spr-group", group));
      }
      const btn = sprEl("button", "spr-item");
      btn.type = "button";
      btn.dataset.id = def.id;
      const cv = document.createElement("canvas");
      cv.className = "spr-thumb";
      const label = sprEl("span", "spr-item-label", def.name);
      const dim = sprEl("span", "spr-item-dim muted");
      btn.append(cv, label, dim);
      btn.addEventListener("click", () => this.select(def.id));
      wrap.append(btn);
      this.thumbs.set(def.id, { btn, cv, dim });
    }
    root.append(wrap);
    root.append(sprEl("p", "muted spr-left-hint", "White on black. One pixel = 2 hires wide."));
  }

  #button(label, title, onClick, cls = "") {
    const b = sprEl("button", cls, label);
    b.type = "button";
    b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  #slider(label, min, max, step, onInput) {
    const row = sprEl("label", "spr-slider");
    const name = sprEl("span", "spr-slider-name", label);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const val = sprEl("span", "spr-slider-val");
    input.addEventListener("input", () => onInput(Number(input.value), false));
    input.addEventListener("change", () => onInput(Number(input.value), true));
    row.append(name, input, val);
    return { row, input, val };
  }

  #buildPanel(root) {
    root.textContent = "";
    this.title = sprEl("div", "spr-title");
    root.append(this.title);

    const main = sprEl("div", "spr-main");
    const cv = document.createElement("canvas");
    cv.className = "spr-grid";
    cv.addEventListener("pointerdown", (e) => this.#onDown(e));
    cv.addEventListener("pointermove", (e) => this.#onMove(e));
    cv.addEventListener("pointerup", (e) => this.#endStroke(e));
    cv.addEventListener("pointercancel", (e) => this.#endStroke(e));
    cv.addEventListener("lostpointercapture", (e) => this.#endStroke(e));
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    this.grid = cv;

    const side = sprEl("div", "spr-side");
    this.wSlider = this.#slider("Width", SPRITE_W_MIN, SPRITE_W_MAX, SPRITE_W_STEP, (v, done) =>
      this.#resize(v, null, done),
    );
    this.hSlider = this.#slider("Height", SPRITE_H_MIN, SPRITE_H_MAX, SPRITE_H_STEP, (v, done) =>
      this.#resize(null, v, done),
    );
    this.sizeNote = sprEl("p", "muted spr-size-note");

    const cross = sprEl("div", "spr-cross");
    cross.append(
      sprEl("span"),
      this.#button("↑", "Shift up (arrow)", () => this.shift(0, -1)),
      sprEl("span"),
      this.#button("←", "Shift left (arrow)", () => this.shift(-1, 0)),
      sprEl("span", "spr-cross-mid", "shift"),
      this.#button("→", "Shift right (arrow)", () => this.shift(1, 0)),
      sprEl("span"),
      this.#button("↓", "Shift down (arrow)", () => this.shift(0, 1)),
      sprEl("span"),
    );

    // Moves the whole sprite in game (its offset from the weapon / tip / viewport); pixels unchanged.
    const move = sprEl("div", "spr-cross");
    move.append(
      sprEl("span"),
      this.#button("↑", "Move sprite up 1 row (Ctrl+arrow, Shift = 4)", (e) => this.move(0, -(e.shiftKey ? 4 : 1))),
      sprEl("span"),
      this.#button("←", "Move sprite left 1 pixel (Ctrl+arrow, Shift = 4)", (e) => this.move(-(e.shiftKey ? 4 : 1), 0)),
      sprEl("span", "spr-cross-mid", "move"),
      this.#button("→", "Move sprite right 1 pixel (Ctrl+arrow, Shift = 4)", (e) => this.move(e.shiftKey ? 4 : 1, 0)),
      sprEl("span"),
      this.#button("↓", "Move sprite down 1 row (Ctrl+arrow, Shift = 4)", (e) => this.move(0, e.shiftKey ? 4 : 1)),
      sprEl("span"),
    );

    const ops = sprEl("div", "btn-row spr-ops");
    ops.append(
      this.#button("Clear", "Del", () => this.clear(), "danger"),
      this.#button("Invert", "I", () => this.invert()),
      this.#button("Flip H", "H", () => this.flipH()),
      this.#button("Flip V", "V", () => this.flipV()),
    );
    const clip = sprEl("div", "btn-row spr-ops");
    this.pasteBtn = this.#button("Paste", "Ctrl+V", () => this.paste());
    clip.append(this.#button("Copy", "Ctrl+C", () => this.copy()), this.pasteBtn);

    const sliders = sprEl("div", "spr-sliders");
    sliders.append(this.wSlider.row, this.hSlider.row, this.sizeNote);
    const btns = sprEl("div", "spr-btns");
    btns.append(ops, clip);
    side.append(sliders, cross, move, btns);
    // Fixed-size stage: resizing the sprite never moves the controls below it.
    const stage = sprEl("div", "spr-stage");
    stage.append(cv);
    main.append(stage, side);
    root.append(main);
  }

  // ---- drawing ----

  #cell(sp) {
    const cy = Math.max(4, Math.min(16, Math.floor(SPR_MAX_H / sp.h), Math.floor(SPR_MAX_W / (2 * sp.w))));
    return { cx: cy * 2, cy };
  }

  refresh() {
    if (!this.enabled) return;
    const sp = this.selected();
    for (const def of SPRITE_DEFS) this.#drawThumb(def.id);
    if (!sp) return;
    const def = spriteDef(sp.id);
    this.title.textContent = `${def.name} · ${sp.w}x${sp.h} px (${sp.w * 2}x${sp.h} hires)`;
    this.wSlider.input.value = String(sp.w);
    this.wSlider.val.textContent = String(sp.w);
    this.hSlider.input.value = String(sp.h);
    this.hSlider.val.textContent = String(sp.h);
    this.sizeNote.textContent = `Game offset ${sp.ox}, ${sp.oy} hires`;
    this.pasteBtn.disabled = !this.clip;
    this.#drawGrid(sp);
  }

  #drawGrid(sp) {
    const { cx, cy } = this.#cell(sp);
    const cv = this.grid;
    cv.width = sp.w * cx;
    cv.height = sp.h * cy;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = SPR_BG;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = SPR_INK;
    for (let y = 0; y < sp.h; y++) {
      for (let x = 0; x < sp.w; x++) {
        if (spriteGet(sp, x, y)) ctx.fillRect(x * cx + 1, y * cy + 1, cx - 1, cy - 1);
      }
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = SPR_GRID;
    ctx.beginPath();
    for (let x = 0; x <= sp.w; x++) {
      ctx.moveTo(x * cx + 0.5, 0);
      ctx.lineTo(x * cx + 0.5, cv.height);
    }
    for (let y = 0; y <= sp.h; y++) {
      ctx.moveTo(0, y * cy + 0.5);
      ctx.lineTo(cv.width, y * cy + 0.5);
    }
    ctx.stroke();
    // Canvas centre lines (what resizing keeps pixels centred on).
    ctx.strokeStyle = SPR_MID;
    ctx.beginPath();
    ctx.moveTo(cv.width / 2 + 0.5, 0);
    ctx.lineTo(cv.width / 2 + 0.5, cv.height);
    ctx.moveTo(0, cv.height / 2 + 0.5);
    ctx.lineTo(cv.width, cv.height / 2 + 0.5);
    ctx.stroke();
  }

  #drawThumb(id) {
    const t = this.thumbs.get(id);
    const sp = this.opts.getSprites().find((s) => s.id === id);
    if (!t || !sp) return;
    t.btn.classList.toggle("active", id === this.selId);
    t.dim.textContent = `${sp.w}x${sp.h}`;
    const cv = t.cv;
    cv.width = sp.w;
    cv.height = sp.h;
    const k = Math.max(1, Math.min(Math.floor(56 / (sp.w * 2)), Math.floor(44 / sp.h)));
    cv.style.width = `${sp.w * 2 * k}px`;
    cv.style.height = `${sp.h * k}px`;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = SPR_BG;
    ctx.fillRect(0, 0, sp.w, sp.h);
    ctx.fillStyle = SPR_INK;
    for (let y = 0; y < sp.h; y++) {
      for (let x = 0; x < sp.w; x++) if (spriteGet(sp, x, y)) ctx.fillRect(x, y, 1, 1);
    }
  }

  // ---- selection ----

  select(id) {
    if (!spriteDef(id) || id === this.selId) return;
    this.selId = id;
    this.refresh();
    this.opts.onSelect?.();
    this.opts.onChange?.();
  }

  // ---- painting ----

  #cellAt(e) {
    const sp = this.selected();
    const r = this.grid.getBoundingClientRect();
    return {
      x: Math.floor(((e.clientX - r.left) / r.width) * sp.w),
      y: Math.floor(((e.clientY - r.top) / r.height) * sp.h),
    };
  }

  #onDown(e) {
    if (!this.enabled || !this.selected()) return;
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    const c = this.#cellAt(e);
    this.stroke = { on: e.button === 0, last: c, pid: e.pointerId, began: false };
    this.grid.setPointerCapture(e.pointerId);
    this.#paint(c.x, c.y);
  }

  #onMove(e) {
    const s = this.stroke;
    if (!s || e.pointerId !== s.pid) return;
    const c = this.#cellAt(e);
    if (c.x === s.last.x && c.y === s.last.y) return;
    let x0 = s.last.x;
    let y0 = s.last.y;
    const dx = Math.abs(c.x - x0);
    const dy = -Math.abs(c.y - y0);
    const sx = x0 < c.x ? 1 : -1;
    const sy = y0 < c.y ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.#paint(x0, y0);
      if (x0 === c.x && y0 === c.y) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    s.last = c;
  }

  #paint(x, y) {
    const s = this.stroke;
    const sp = this.selected();
    if (!s || !sp || x < 0 || y < 0 || x >= sp.w || y >= sp.h) return;
    if (spriteGet(sp, x, y) === s.on) return;
    if (!s.began) {
      s.began = true;
      this.opts.beginUndo();
    }
    spriteSet(sp, x, y, s.on);
    this.#drawGrid(sp);
    this.#drawThumb(sp.id);
    this.opts.onSelect?.();
  }

  #endStroke(e) {
    const s = this.stroke;
    if (!s || (e && e.pointerId !== s.pid)) return;
    this.stroke = null;
    if (!s.began) return;
    this.opts.endUndo();
    this.opts.markDirty();
    this.opts.onChange?.();
  }

  // ---- edits ----

  #edit(fn) {
    const sp = this.selected();
    if (!sp) return false;
    const next = fn(sp);
    if (!next || spriteRowsEqual(next, sp.rows)) return false;
    this.opts.beginUndo();
    sp.rows = next;
    this.opts.endUndo();
    this.opts.markDirty();
    this.refresh();
    this.opts.onSelect?.();
    this.opts.onChange?.();
    return true;
  }

  /** Reposition the sprite in game: dx in pixels (2 hires), dy in rows. Pixels are unchanged. */
  move(dx, dy) {
    const sp = this.selected();
    if (!sp || (!dx && !dy)) return false;
    this.opts.beginUndo();
    sp.ox += 2 * dx;
    sp.oy += dy;
    this.opts.endUndo();
    this.opts.markDirty();
    this.refresh();
    this.opts.onSelect?.();
    this.opts.onChange?.();
    return true;
  }

  shift(dx, dy) {
    return this.#edit((sp) => spriteShiftRows(sp, dx, dy));
  }
  flipH() {
    return this.#edit(spriteFlipHRows);
  }
  flipV() {
    return this.#edit(spriteFlipVRows);
  }
  invert() {
    return this.#edit(spriteInvertRows);
  }
  clear() {
    return this.#edit((sp) => spriteBlankRows(sp.w, sp.h));
  }

  copy() {
    const sp = this.selected();
    if (!sp) return false;
    this.clip = { w: sp.w, h: sp.h, rows: sp.rows.slice() };
    this.opts.onStatus?.(`Copied ${spriteDef(sp.id).name}`);
    this.refresh();
    return true;
  }

  /** Top-left aligned; anything past the current size is cropped. */
  paste() {
    const clip = this.clip;
    if (!clip) return false;
    return this.#edit((sp) => {
      const rows = spriteBlankRows(sp.w, sp.h);
      for (let y = 0; y < Math.min(sp.h, clip.h); y++) {
        let s = "";
        for (let x = 0; x < sp.w; x++) s += x < clip.w ? clip.rows[y][x] : ".";
        rows[y] = s;
      }
      return rows;
    });
  }

  /** One undo step per slider drag: begins on the first input, ends on change. */
  #resize(w, h, done) {
    const sp = this.selected();
    if (!sp) return;
    const nw = w ?? sp.w;
    const nh = h ?? sp.h;
    if (nw !== sp.w || nh !== sp.h) {
      this.opts.beginUndo();
      Object.assign(sp, spriteResize(sp, nw, nh));
      this.opts.markDirty();
      this.refresh();
      this.opts.onSelect?.();
    }
    if (done) {
      this.opts.endUndo();
      this.opts.onChange?.();
    }
  }

  /** Returns true when the key was a sprite shortcut. Caller skips text inputs. */
  handleKey(e) {
    if (e.altKey) return false;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod) {
      const mv = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
      if (mv) {
        const n = e.shiftKey ? 4 : 1;
        return this.move(mv[0] * n, mv[1] * n) || true;
      }
      if (e.shiftKey) return false;
      if (k === "c") return this.copy() || true;
      if (k === "v") return this.paste() || true;
      return false;
    }
    switch (k) {
      case "arrowleft":
        return this.shift(-1, 0) || true;
      case "arrowright":
        return this.shift(1, 0) || true;
      case "arrowup":
        return this.shift(0, -1) || true;
      case "arrowdown":
        return this.shift(0, 1) || true;
      case "h":
        return this.flipH() || true;
      case "v":
        return this.flipV() || true;
      case "i":
        return this.invert() || true;
      case "delete":
      case "backspace":
        return this.clear() || true;
      default:
        return false;
    }
  }
}
