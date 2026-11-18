// Editor-only preview of cutscene flyby sounds (item.flyby, see cutsceneModel.js).
// Each item with flyby.on drives one voice (band-passed noise or a square tone) from its
// volume and pitch envelopes. Not baked into the game yet.

export class CutAudio {
  constructor() {
    this.ctx = null;
    this.voices = new Map();
    this.noise = null;
  }

  _ensure() {
    if (this.ctx) return true;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    this.ctx = new Ctx();
    const n = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return true;
  }

  _voice(id, kind) {
    let v = this.voices.get(id);
    if (v && v.kind !== kind) {
      this._kill(v);
      this.voices.delete(id);
      v = null;
    }
    if (v) return v;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    let src;
    let filter = null;
    if (kind === "tone") {
      src = ctx.createOscillator();
      src.type = "square";
      src.connect(gain);
    } else {
      src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.Q.value = 1.2;
      src.connect(filter);
      filter.connect(gain);
    }
    src.start();
    v = { kind, src, filter, gain };
    this.voices.set(id, v);
    return v;
  }

  _kill(v) {
    try {
      v.src.stop();
    } catch {
      /* already stopped */
    }
    v.src.disconnect();
    v.filter?.disconnect();
    v.gain.disconnect();
  }

  /** states: [{ id, kind, gain, pitch }] for the voices that should sound now; others are silenced. */
  update(states) {
    if (!states.length && !this.ctx) return;
    if (!this._ensure()) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    const t = this.ctx.currentTime;
    const live = new Set();
    for (const s of states) {
      live.add(s.id);
      const v = this._voice(s.id, s.kind);
      v.gain.gain.setTargetAtTime(Math.min(1, s.gain) * 0.35, t, 0.02);
      if (v.kind === "tone") v.src.frequency.setTargetAtTime(s.pitch, t, 0.02);
      else v.filter.frequency.setTargetAtTime(s.pitch, t, 0.02);
    }
    for (const [id, v] of this.voices) {
      if (!live.has(id)) {
        this._kill(v);
        this.voices.delete(id);
      }
    }
  }

  stop() {
    for (const v of this.voices.values()) this._kill(v);
    this.voices.clear();
  }
}
