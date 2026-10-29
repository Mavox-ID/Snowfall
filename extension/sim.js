export const COL_W = 2;
const REPOSE = 0.8;
const GRAVITY = 1700;
const FLAKE_CAP = 1400;
const PART_CAP = 900;
const SHED_SPEED = 700;
const AREA_1080P = 1920 * 1080;
const LEVEL_BASE = { off: 0, light: 90, steady: 230, heavy: 520, variable: 230 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class SnowSim {
    constructor(opts = {}) {
        this.rand = opts.rand ?? Math.random;
        this.W = 1920;
        this.H = 1080;
        this.cfg = {
            intensity: 'steady', density: 1, wind: 1, accumulate: true, melt: false,
            cursor: true, flakeScale: 1, depositRate: 1,
        };
        this.time = 0;
        this.strength = 1;
        this.strengthTarget = 1;
        this.nextShift = 0;
        this.wind = 0;

        const F = FLAKE_CAP;
        this.fx = new Float32Array(F); this.fy = new Float32Array(F);
        this.fsz = new Float32Array(F); this.fd = new Float32Array(F);
        this.falpha = new Float32Array(F); this.fspd = new Float32Array(F);
        this.fphase = new Float32Array(F); this.fsway = new Float32Array(F);
        this.fswayAmt = new Float32Array(F);
        this.fpx = new Float32Array(F); this.fpy = new Float32Array(F);
        this.fAlive = new Uint8Array(F);
        this.aliveFlakes = 0;
        this.flakeHigh = 0;
        this.flakeGen = 0;
        this._reviveBudget = 0;
        this._scan = 0;

        const P = PART_CAP;
        this.px = new Float32Array(P); this.py = new Float32Array(P);
        this.pvx = new Float32Array(P); this.pvy = new Float32Array(P);
        this.psz = new Float32Array(P); this.pal = new Float32Array(P);
        this.page = new Float32Array(P); this.plife = new Float32Array(P);
        this.parea = new Float32Array(P);
        this.pkind = new Uint8Array(P);
        this.pgen = new Uint32Array(P);
        this.pAlive = new Uint8Array(P);
        this.alivePart = 0;
        this.partHigh = 0;
        this._pscan = 0;

        this.piles = new Map();
        this.pileList = [];
        this._assignSlots();
    }

    configure(cfg) {
        const scaleChanged = cfg.flakeScale !== undefined && cfg.flakeScale !== this.cfg.flakeScale;
        const wasVariable = this.cfg.intensity === 'variable';
        Object.assign(this.cfg, cfg);
        if (scaleChanged) this._assignSlots();
        if (this.cfg.intensity === 'variable' && !wasVariable) this.nextShift = this.time;
        if (this.cfg.intensity !== 'variable') { this.strength = 1; this.strengthTarget = 1; }
    }

    resize(W, H) {
        this.W = Math.max(64, W);
        this.H = Math.max(64, H);
    }

    _assignSlots() {
        const r = this.rand, s = this.cfg.flakeScale;
        for (let i = 0; i < FLAKE_CAP; i++) {
            const d = Math.pow(r(), 1.5);
            this.fd[i] = d;
            this.fsz[i] = (1.7 + d * 3.4) * s;
            this.falpha[i] = 0.5 + 0.5 * d;
            this.fspd[i] = (24 + d * 62) * (0.85 + r() * 0.3);
        }
        this.flakeGen++;
    }

    get target() {
        const base = LEVEL_BASE[this.cfg.intensity] ?? 0;
        const area = clamp((this.W * this.H) / AREA_1080P, 0.45, 3);
        const k = this.cfg.intensity === 'variable' ? this.strength : 1;
        return Math.min(FLAKE_CAP, Math.round(base * this.cfg.density * area * k));
    }

    prefill() {
        const t = this.target;
        for (let i = 0; i < t; i++) this._revive(i, false);
    }

    get busy() {
        if (this.aliveFlakes > 0 || this.alivePart > 0) return true;
        for (const p of this.piles.values()) if (p.activeT > 0 || p.dirty) return true;
        return false;
    }

    get hasSnow() {
        for (const p of this.piles.values()) if (p.maxH > 0.15) return true;
        return false;
    }

    syncSurfaces(list, dt) {
        const seen = new Set();
        for (const s of list) {
            seen.add(s.key);
            const p = this.piles.get(s.key);
            if (!p) this.piles.set(s.key, this._makePile(s));
            else this._updatePile(p, s, dt);
        }
        for (const [key, p] of this.piles) {
            if (seen.has(key)) continue;
            if (!p.hidden && p.kind === 'window') this._drop(p);
            this.piles.delete(key);
        }
        this.pileList = [];
        for (const p of this.piles.values()) if (!p.hidden) this.pileList.push(p);
    }

    _makePile(s) {
        const n = Math.max(2, Math.ceil((s.x1 - s.x0) / COL_W));
        return {
            key: s.key, kind: s.kind, x0: s.x0, x1: s.x1, y: s.y, cap: s.cap, n,
            cols: new Float32Array(n), occl: s.occl ?? [], hidden: !!s.hidden,
            wallL: !!s.wallL, wallR: !!s.wallR,
            dirty: true, activeT: 0, meltT: 0, spillL: 0, spillR: 0, maxH: 0,
        };
    }

    _updatePile(p, s, dt) {
        const w = s.x1 - s.x0, ow = p.x1 - p.x0;
        if (Math.abs(w - ow) > 1.5) {
            const n = Math.max(2, Math.ceil(w / COL_W));
            const nc = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                const j = Math.floor((s.x0 + (i + 0.5) * COL_W - p.x0) / COL_W);
                if (j >= 0 && j < p.n) nc[i] = p.cols[j];
            }
            p.cols = nc; p.n = n; p.dirty = true;
        } else if (p.kind === 'window' && !p.hidden && !s.hidden && p.maxH > 0.3) {
            const dx = s.x0 - p.x0, dy = s.y - p.y;
            const sp = Math.hypot(dx, dy) / Math.max(dt, 0.001);
            if (sp > SHED_SPEED) this._shed(p, sp, dx / Math.max(dt, 0.001), dy / Math.max(dt, 0.001), dt);
        }
        const occl = s.occl ?? [];
        if (!sameOccl(p.occl, occl) || p.hidden !== !!s.hidden || p.y !== s.y || p.x0 !== s.x0) p.dirty = true;
        p.x0 = s.x0; p.x1 = s.x1; p.y = s.y;
        if (s.cap !== p.cap) {
            p.cap = s.cap;
            for (let i = 0; i < p.n; i++) if (p.cols[i] > p.cap) p.cols[i] = p.cap;
            p.dirty = true;
        }
        p.occl = occl; p.hidden = !!s.hidden; p.wallL = !!s.wallL; p.wallR = !!s.wallR;
        p.n = Math.max(2, Math.ceil((p.x1 - p.x0) / COL_W));
        if (p.cols.length !== p.n) {
            const nc = new Float32Array(p.n); nc.set(p.cols.subarray(0, Math.min(p.n, p.cols.length))); p.cols = nc;
        }
    }

    _recalc(p) {
        let m = 0;
        for (let i = 0; i < p.n; i++) if (p.cols[i] > m) m = p.cols[i];
        p.maxH = m;
    }

    _shed(p, speed, vx, vy, dt) {
        const frac = Math.min(0.7, 0.04 + (speed - SHED_SPEED) / 4000) * Math.min(1, dt * 30);
        let total = 0;
        for (let i = 0; i < p.n; i++) {
            const take = p.cols[i] * frac;
            p.cols[i] -= take; total += take * COL_W;
        }
        this._recalc(p);
        p.dirty = true;
        this._throw(p, total, vx * 0.35, vy * 0.35, false);
    }

    _drop(p) {
        let total = 0;
        for (let i = 0; i < p.n; i++) total += p.cols[i] * COL_W;
        if (total < 2) return;
        this._throw(p, total, 0, 0, true);
    }

    _throw(p, area, vx, vy, lumps) {
        if (area < 0.6) return;
        const r = this.rand;
        const count = lumps ? Math.min(40, Math.max(3, Math.ceil(area / 10))) : Math.min(14, Math.max(1, Math.ceil(area / 3)));
        const each = area / count;
        for (let k = 0; k < count; k++) {
            let i = Math.floor(r() * p.n);
            for (let t = 0; t < 12 && p.cols[i] < 0.3; t++) i = Math.floor(r() * p.n);
            const x = p.x0 + (i + 0.5) * COL_W;
            const y = p.y - p.cols[i] - 1;
            this._spawnPart(x, y, vx + (r() - 0.5) * (lumps ? 60 : 120), vy + (r() - 0.5) * 60 - (lumps ? 0 : r() * 70), each, lumps ? 2 : 0);
        }
    }

    clear() {
        const r = this.rand;
        for (const p of this.piles.values()) {
            for (let i = 0; i < p.n; i += 6) {
                if (p.cols[i] < 0.4) continue;
                this._spawnPart(p.x0 + i * COL_W, p.y - p.cols[i], (r() - 0.5) * 220, -r() * 120, 0, 1);
            }
            p.cols.fill(0); p.maxH = 0; p.dirty = true;
        }
    }

    _spawnPart(x, y, vx, vy, area, kind) {
        if (this.alivePart >= PART_CAP) return false;
        let i = this._pscan;
        for (let t = 0; t < PART_CAP; t++, i = (i + 1) % PART_CAP) {
            if (this.pAlive[i]) continue;
            this._pscan = (i + 1) % PART_CAP;
            const r = this.rand;
            this.px[i] = x; this.py[i] = y; this.pvx[i] = vx; this.pvy[i] = vy;
            this.parea[i] = area; this.pkind[i] = kind; this.page[i] = 0;
            if (kind === 1) {
                this.psz[i] = 1.4 + r() * 1.2; this.pal[i] = 0.75; this.plife[i] = 0.5 + r() * 0.7;
            } else if (kind === 2) {
                this.psz[i] = clamp(Math.sqrt(area) * 1.1, 3, 7); this.pal[i] = 0.97; this.plife[i] = 0;
            } else {
                this.psz[i] = clamp(Math.sqrt(area) * 1.2, 1.6, 3.6); this.pal[i] = 0.95; this.plife[i] = 0;
            }
            this.pAlive[i] = 1; this.pgen[i]++;
            this.alivePart++;
            if (i >= this.partHigh) this.partHigh = i + 1;
            return true;
        }
        return false;
    }

    _burst(x, y, area) {
        const r = this.rand;
        const n = 5 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) {
            const a = -Math.PI * r();
            const sp = 40 + r() * 110;
            this._spawnPart(x, y - 1, Math.cos(a) * sp, Math.sin(a) * sp * 0.7, 0, 1);
        }
    }

    step(dt, ptr) {
        dt = clamp(dt, 0.001, 0.1);
        this.time += dt;
        this._updateWeather(dt);
        const pointer = this.cfg.cursor && ptr ? ptr : null;
        this._stepFlakes(dt, pointer);
        this._stepParticles(dt);
        this._stepPiles(dt, pointer);
    }

    _updateWeather(dt) {
        const t = this.time;
        this.wind = this.cfg.wind * (16 * Math.sin(t * 0.13) + 9 * Math.sin(t * 0.31 + 1.7) + 5 * Math.sin(t * 0.77 + 0.4));
        if (this.cfg.intensity === 'variable') {
            if (t >= this.nextShift) {
                this.strengthTarget = 0.3 + this.rand() * 1.5;
                this.nextShift = t + 25 + this.rand() * 50;
            }
            this.strength += (this.strengthTarget - this.strength) * Math.min(1, dt * 0.08);
        }
    }

    _revive(i, atTop = true) {
        const r = this.rand;
        this.fx[i] = r() * (this.W + 160) - 80;
        this.fy[i] = atTop ? -(this.fsz[i] + r() * 50) : r() * this.H;
        this.fphase[i] = r() * 6.2832;
        this.fsway[i] = 0.6 + r() * 1.3;
        this.fswayAmt[i] = 6 + r() * 16;
        this.fpx[i] = 0; this.fpy[i] = 0;
        if (!this.fAlive[i]) { this.fAlive[i] = 1; this.aliveFlakes++; }
        if (i >= this.flakeHigh) this.flakeHigh = i + 1;
    }

    _kill(i) {
        if (this.fAlive[i]) { this.fAlive[i] = 0; this.aliveFlakes--; }
    }

    _stepFlakes(dt, ptr) {
        const target = this.target;
        if (this.aliveFlakes < target) {
            this._reviveBudget += dt * target / 8;
            while (this._reviveBudget >= 1 && this.aliveFlakes < target) {
                this._reviveBudget -= 1;
                let i = this._scan;
                for (let t = 0; t < FLAKE_CAP; t++, i = (i + 1) % FLAKE_CAP) if (!this.fAlive[i]) break;
                this._scan = (i + 1) % FLAKE_CAP;
                this._revive(i, true);
            }
        } else this._reviveBudget = 0;

        const fx = this.fx, fy = this.fy, A = this.fAlive;
        const wind = this.wind, W = this.W, H = this.H;
        const pd = Math.exp(-2.5 * dt);
        const land = this.cfg.accumulate && this.pileList.length > 0;
        const sp = ptr ? Math.hypot(ptr.vx, ptr.vy) : 0;
        const R = 38, R2 = R * R;
        for (let i = 0; i < this.flakeHigh; i++) {
            if (!A[i]) continue;
            this.fphase[i] += this.fsway[i] * dt;
            let x = fx[i], y = fy[i];
            if (ptr && sp > 40) {
                const dx = x - ptr.x, dy = y - ptr.y, d2 = dx * dx + dy * dy;
                if (d2 < R2) {
                    const d = Math.sqrt(d2) + 0.001, k = 1 - d / R;
                    this.fpx[i] += (dx / d) * k * 260 + ptr.vx * 0.06 * k;
                    this.fpy[i] += (dy / d) * k * 200 + ptr.vy * 0.06 * k;
                }
            }
            const vx = this.fswayAmt[i] * Math.sin(this.fphase[i]) + wind * (0.5 + this.fd[i] * 0.5) + this.fpx[i];
            const vy = this.fspd[i] + this.fpy[i];
            this.fpx[i] *= pd; this.fpy[i] *= pd;
            const ny = y + vy * dt;
            x += vx * dt;
            if (x < -90) x += W + 180; else if (x > W + 90) x -= W + 180;
            if (land) {
                const hit = this._land(x, y, ny);
                if (hit) {
                    this._deposit(hit, x, this.fsz[i] * this.fsz[i] * 0.8);
                    fx[i] = x; fy[i] = ny;
                    this._kill(i);
                    continue;
                }
            }
            fx[i] = x; fy[i] = ny;
            if (ny > H + 12) this._kill(i);
        }
    }

    _stepParticles(dt) {
        const G = GRAVITY, W = this.W, H = this.H;
        const land = this.pileList.length > 0;
        const dragX = Math.exp(-0.9 * dt), dragY = Math.exp(-0.3 * dt);
        const moteDrag = Math.exp(-4.2 * dt);
        for (let i = 0; i < this.partHigh; i++) {
            if (!this.pAlive[i]) continue;
            if (this.pkind[i] === 1) {
                this.pvx[i] *= moteDrag; this.pvy[i] = this.pvy[i] * moteDrag - 14 * dt;
                this.px[i] += this.pvx[i] * dt; this.py[i] += this.pvy[i] * dt;
                this.page[i] += dt;
                if (this.page[i] >= this.plife[i]) this._killPart(i);
                continue;
            }
            this.pvy[i] = (this.pvy[i] + G * dt) * dragY;
            this.pvx[i] *= dragX;
            const x = this.px[i] + this.pvx[i] * dt;
            const y0 = this.py[i], y1 = y0 + this.pvy[i] * dt;
            if (land) {
                const hit = this._land(x, y0, y1);
                if (hit) {
                    if (this.pkind[i] === 2) this._burst(x, y1, this.parea[i]);
                    if (this.cfg.accumulate) this._deposit(hit, x, this.parea[i]);
                    this._killPart(i);
                    continue;
                }
            }
            this.px[i] = x; this.py[i] = y1;
            if (y1 > H + 20 || x < -60 || x > W + 60) this._killPart(i);
        }
    }

    _killPart(i) {
        if (this.pAlive[i]) { this.pAlive[i] = 0; this.alivePart--; }
    }

    _land(x, y0, y1) {
        const L = this.pileList;
        let best = null, bestTop = Infinity;
        for (let k = 0; k < L.length; k++) {
            const p = L[k];
            if (x < p.x0 || x >= p.x1) continue;
            if (y1 < p.y - p.cap - 1) continue;
            const c = ((x - p.x0) / COL_W) | 0;
            if (c >= p.n) continue;
            if (p.occl.length && occludedAt(p.occl, x)) continue;
            const top = p.y - p.cols[c];
            if (y0 <= top && y1 >= top && top < bestTop) { bestTop = top; best = p; }
        }
        return best;
    }

    _deposit(p, x, area) {
        let c = Math.floor((x - p.x0) / COL_W);
        c = clamp(c, 0, p.n - 1);
        const cols = p.cols;
        const f = Math.max(0, 1 - cols[c] / p.cap);
        const amount = (area / COL_W) * 0.7 * this.cfg.depositRate * f * f;
        cols[c] += amount * 0.5;
        if (c > 0) cols[c - 1] += amount * 0.25;
        if (c < p.n - 1) cols[c + 1] += amount * 0.25;
        for (let i = Math.max(0, c - 1), e = Math.min(p.n - 1, c + 1); i <= e; i++) {
            if (cols[i] > p.cap) cols[i] = p.cap;
            if (cols[i] > p.maxH) p.maxH = cols[i];
        }
        p.dirty = true;
        p.activeT = 0.7;
    }

    _stepPiles(dt, ptr) {
        for (const p of this.piles.values()) {
            if (p.hidden) continue;
            if (ptr && p.maxH > 0.2) this._sweep(p, ptr);
            if (p.activeT > 0) {
                p.activeT -= dt;
                this._relax(p);
            }
            if (this.cfg.melt && p.maxH > 0.05) {
                p.meltT += dt;
                if (p.meltT >= 0.25) {
                    const m = p.meltT; p.meltT = 0;
                    let mx = 0;
                    for (let i = 0; i < p.n; i++) {
                        let h = p.cols[i];
                        if (h <= 0) continue;
                        h -= m * (0.01 + 0.0025 * h);
                        if (h < 0.05) h = 0;
                        p.cols[i] = h;
                        if (h > mx) mx = h;
                    }
                    p.maxH = mx; p.dirty = true;
                }
            }
        }
    }

    _relax(p) {
        const c = p.cols, n = p.n, lim = REPOSE * COL_W;
        for (let pass = 0; pass < 2; pass++) {
            for (let i = 0; i < n - 1; i++) {
                const d = c[i] - c[i + 1];
                if (d > lim) { const t = (d - lim) * 0.5; c[i] -= t; c[i + 1] += t; }
                else if (d < -lim) { const t = (-d - lim) * 0.5; c[i] += t; c[i + 1] -= t; }
            }
            for (let i = n - 2; i >= 0; i--) {
                const d = c[i] - c[i + 1];
                if (d > lim) { const t = (d - lim) * 0.5; c[i] -= t; c[i + 1] += t; }
                else if (d < -lim) { const t = (-d - lim) * 0.5; c[i] += t; c[i + 1] -= t; }
            }
        }
        if (!p.wallL && c[0] > lim) { p.spillL += (c[0] - lim) * COL_W; c[0] = lim; }
        if (!p.wallR && c[n - 1] > lim) { p.spillR += (c[n - 1] - lim) * COL_W; c[n - 1] = lim; }
        const r = this.rand;
        if (p.spillL > 5) { this._spawnPart(p.x0 + 1, p.y - lim, -20 - r() * 50, -r() * 20, p.spillL, 0); p.spillL = 0; }
        if (p.spillR > 5) { this._spawnPart(p.x1 - 1, p.y - lim, 20 + r() * 50, -r() * 20, p.spillR, 0); p.spillR = 0; }
        let mx = 0;
        for (let i = 0; i < n; i++) { if (c[i] > p.cap) c[i] = p.cap; if (c[i] > mx) mx = c[i]; }
        p.maxH = mx;
        p.dirty = true;
    }

    _sweep(p, ptr) {
        const sp = Math.hypot(ptr.vx, ptr.vy);
        if (sp < 60) return;
        const R = 16;
        if (ptr.x < p.x0 - R || ptr.x > p.x1 + R || ptr.y < p.y - p.cap - R || ptr.y > p.y + R + 6) return;
        const gain = 0.35 + 0.65 * Math.min(1, sp / 800);
        const py = ptr.y + 6;
        let area = 0, sx = 0, sy = p.y;
        const i0 = Math.max(0, Math.floor((ptr.x - R - p.x0) / COL_W));
        const i1 = Math.min(p.n - 1, Math.floor((ptr.x + R - p.x0) / COL_W));
        for (let i = i0; i <= i1; i++) {
            const h = p.cols[i];
            if (h < 0.2) continue;
            const cx = p.x0 + (i + 0.5) * COL_W;
            const dx = Math.abs(cx - ptr.x);
            if (dx > R) continue;
            if (occludedAt(p.occl, cx)) continue;
            const top = p.y - h;
            if (py < top - 8) continue;
            const f = 1 - (dx / R) * (dx / R);
            const take = h * f * gain * 0.85;
            p.cols[i] = h - take;
            area += take * COL_W; sx += cx * take; sy = Math.min(sy, top);
        }
        if (area < 0.3) return;
        this._recalc(p);
        p.dirty = true; p.activeT = 0.5;
        const r = this.rand, cxm = sx / (area / COL_W);
        const g = Math.min(4, Math.ceil(area / 2.5)), each = area / g;
        for (let k = 0; k < g; k++) {
            this._spawnPart(cxm + (r() - 0.5) * R, sy - 2, ptr.vx * 0.35 + (r() - 0.5) * 180, ptr.vy * 0.25 - 40 - r() * 160, each, 0);
        }
    }

    pointerNear(ptr) {
        if (!ptr || !this.cfg.cursor) return false;
        for (const p of this.piles.values()) {
            if (p.hidden || p.maxH < 0.2) continue;
            if (ptr.x >= p.x0 - 30 && ptr.x <= p.x1 + 30 && ptr.y >= p.y - p.cap - 30 && ptr.y <= p.y + 30) return true;
        }
        return false;
    }
}

export function occludedAt(occl, x) {
    for (let i = 0; i < occl.length; i++) if (x >= occl[i][0] && x <= occl[i][1]) return true;
    return false;
}

function sameOccl(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
    return true;
}
