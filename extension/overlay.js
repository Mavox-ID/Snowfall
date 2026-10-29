import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SnowSim, COL_W, occludedAt} from './sim.js';

const PAD = 4;
const SINK = 3;
const PAINT_S = 0.09;
const DOCK_MEMORY_S = 90;

const flakePx = size => Math.max(2, Math.round(size));

export class Overlay {
    constructor(settings) {
        this._settings = settings;
        this._sim = new SnowSim();
        this._cfg = {};
        this._tid = 0;
        this._last = 0;
        this._ptr = null;
        this._errors = 0;
        this._behindNow = null;
        this._flakeActors = [];
        this._flakeVis = new Uint8Array(1400);
        this._flakeGen = -1;
        this._partActors = [];
        this._partVis = new Uint8Array(900);
        this._partGen = new Uint32Array(900);
        this._pileAreas = new Map();
        this._hv = new Float32Array(2048);
        this._dockMem = new Map();
        this._sigs = [];
    }

    enable() {
        this._root = new Clutter.Actor({name: 'snowfall-overlay', reactive: false});
        this._pileLayer = new Clutter.Actor({reactive: false});
        this._flakeLayer = new Clutter.Actor({reactive: false});
        this._root.add_child(this._pileLayer);
        this._root.add_child(this._flakeLayer);

        this._readSettings();
        this._attach();
        this._resize();

        this._sigs.push([this._settings, this._settings.connect('changed', (_s, key) => this._onSetting(key))]);
        this._sigs.push([Main.layoutManager, Main.layoutManager.connect('monitors-changed', () => this._resize())]);

        if (this._cfg.enabled && this._cfg.intensity !== 'off') this._sim.prefill();
        this._wake();
    }

    disable() {
        if (this._tid) {
            GLib.source_remove(this._tid);
            this._tid = 0;
        }
        for (const [obj, id] of this._sigs) obj.disconnect(id);
        this._sigs = [];
        if (this._root) {
            this._detach();
            this._root.destroy();
            this._root = null;
        }
        this._flakeActors = [];
        this._partActors = [];
        this._pileAreas.clear();
        this._dockMem.clear();
    }

    clear() {
        this._sim.clear();
        this._wake();
    }

    _readSettings() {
        const s = this._settings;
        this._cfg = {
            enabled: s.get_boolean('enabled'),
            intensity: s.get_string('intensity'),
            density: s.get_double('density'),
            flakeSize: s.get_double('flake-size'),
            wind: s.get_double('wind'),
            accumulate: s.get_boolean('accumulate'),
            accSpeed: s.get_double('accumulation-speed'),
            melt: s.get_boolean('melt'),
            groundSnow: s.get_boolean('ground-snow'),
            groundDepth: s.get_int('ground-depth'),
            windowSnow: s.get_boolean('window-snow'),
            dockSnow: s.get_boolean('dock-snow'),
            ledgeDepth: s.get_int('ledge-depth'),
            cursor: s.get_boolean('cursor-interaction'),
            behind: s.get_boolean('behind-windows'),
            hideFs: s.get_boolean('hide-on-fullscreen'),
            fps: s.get_int('fps'),
        };
        const c = this._cfg;
        this._sim.configure({
            intensity: c.intensity, density: c.density, wind: c.wind, accumulate: c.accumulate,
            melt: c.melt, cursor: c.cursor, flakeScale: c.flakeSize, depositRate: c.accSpeed,
        });
    }

    _onSetting(key) {
        if (!this._root) return;
        const wasEnabled = this._cfg.enabled;
        const wasIntensity = this._cfg.intensity;
        if (key === 'clear-counter') {
            this._sim.clear();
        } else {
            this._readSettings();
            if (key === 'behind-windows') {
                this._detach();
                this._attach();
            }
            if (key === 'enabled' && this._cfg.enabled && !wasEnabled) this._last = 0;
            if (key === 'intensity' && wasIntensity === 'off' && this._cfg.intensity !== 'off' && this._sim.aliveFlakes === 0)
                this._sim.prefill();
        }
        this._wake();
    }

    _attach() {
        if (this._cfg.behind) {
            const wg = global.window_group;
            wg.add_child(this._root);
            wg.set_child_below_sibling(this._root, null);
        } else {
            Main.layoutManager.uiGroup.add_child(this._root);
        }
        this._behindNow = this._cfg.behind;
    }

    _detach() {
        if (this._behindNow === null) return;
        if (this._behindNow) global.window_group.remove_child(this._root);
        else Main.layoutManager.uiGroup.remove_child(this._root);
        this._behindNow = null;
    }

    _resize() {
        if (!this._root) return;
        let W = 0, H = 0;
        for (const m of Main.layoutManager.monitors) {
            W = Math.max(W, m.x + m.width);
            H = Math.max(H, m.y + m.height);
        }
        this._root.set_position(0, 0);
        this._root.set_size(W, H);
        this._sim.resize(W, H);
        for (const p of this._sim.piles.values()) p.dirty = true;
        this._wake();
    }

    _wake() {
        if (!this._root || this._tid) return;
        this._arm(16);
    }

    _arm(ms) {
        if (this._tid) GLib.source_remove(this._tid);
        this._tid = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(8, Math.round(ms)), () => {
            this._tid = 0;
            this._tick();
            return GLib.SOURCE_REMOVE;
        });
        GLib.Source.set_name_by_id(this._tid, '[snowfall] tick');
    }

    _tick() {
        if (!this._root) return;
        try {
            this._tickInner();
            this._errors = 0;
        } catch (e) {
            console.error(`Snowfall: error in tick loop: ${e}\n${e.stack ?? ''}`);
            if (++this._errors < 5) this._arm(1000);
        }
    }

    _tickInner() {
        const c = this._cfg;
        const now = GLib.get_monotonic_time() / 1e6;
        let dt = this._last ? now - this._last : 1 / 30;
        if (dt > 0.25) dt = 1 / 30;
        this._last = now;

        if (!c.enabled) {
            this._root.hide();
            this._last = 0;
            return;
        }
        if (c.hideFs && this._anyFullscreen()) {
            this._root.hide();
            this._last = 0;
            this._arm(500);
            return;
        }
        this._root.show();

        const ptr = this._pointer(dt);
        this._sim.syncSurfaces(this._collectSurfaces(now), dt);
        this._sim.step(dt, ptr);
        this._render(now);

        if (this._sim.busy || this._sim.pointerNear(ptr)) this._arm(1000 / c.fps);
        else if (this._sim.piles.size > 0) this._arm(250);
    }

    _anyFullscreen() {
        try {
            return Main.layoutManager.monitors.some(m => m.inFullscreen);
        } catch (_e) {
            return false;
        }
    }

    _pointer(dt) {
        const [x, y] = global.get_pointer();
        const p = this._ptr ?? (this._ptr = {x, y, vx: 0, vy: 0});
        const k = Math.min(1, dt * 20);
        const clampV = v => Math.max(-5000, Math.min(5000, v));
        p.vx += (clampV((x - p.x) / dt) - p.vx) * Math.max(0.5, k);
        p.vy += (clampV((y - p.y) / dt) - p.vy) * Math.max(0.5, k);
        p.x = x;
        p.y = y;
        return p;
    }

    _collectSurfaces(now) {
        const c = this._cfg;
        const lm = Main.layoutManager;
        const mons = lm.monitors;
        const out = [];
        const overview = Main.overview.visible;
        const ws = global.workspace_manager.get_active_workspace();

        const wins = [];
        for (const a of global.get_window_actors()) {
            const w = a.meta_window;
            if (!w) continue;
            const t = w.get_window_type();
            if (t !== Meta.WindowType.NORMAL && t !== Meta.WindowType.DIALOG && t !== Meta.WindowType.MODAL_DIALOG) continue;
            if (w.minimized) continue;
            if (!w.get_workspace() && !w.is_on_all_workspaces()) continue;
            const r = w.get_frame_rect();
            const fs = w.is_fullscreen();
            wins.push({
                key: `w${w.get_stable_sequence()}`, x: r.x, y: r.y, w: r.width, h: r.height,
                fs, mon: w.get_monitor(), shown: a.visible && w.located_on_workspace(ws) && !fs,
            });
        }

        const docks = c.dockSnow ? this._findDocks(mons, now) : [];

        if (c.windowSnow) {
            for (let i = 0; i < wins.length; i++) {
                const W = wins[i];
                if (W.fs || W.w < 90 || W.mon < 0 || W.mon >= mons.length) continue;
                const wa = lm.getWorkAreaForMonitor(W.mon);
                const room = W.y - wa.y;
                if (room < 8) continue;
                const cap = Math.min(c.ledgeDepth, room - 2);
                const occl = [];
                for (let j = i + 1; j < wins.length; j++) {
                    const Q = wins[j];
                    if (!Q.shown) continue;
                    if (Q.y < W.y && Q.y + Q.h > W.y - cap && Q.x < W.x + W.w && Q.x + Q.w > W.x) occl.push([Q.x, Q.x + Q.w]);
                }
                out.push({
                    key: W.key, kind: 'window', x0: W.x + 10, x1: W.x + W.w - 10, y: W.y, cap,
                    occl, hidden: overview || !W.shown,
                });
            }
        }

        for (const d of docks) out.push(d.surface);

        if (c.groundSnow) {
            const disp = global.display;
            for (let i = 0; i < mons.length; i++) {
                if (disp.get_monitor_neighbor_index(i, Meta.DisplayDirection.DOWN) !== -1) continue;
                const m = mons[i];
                const bottom = m.y + m.height;
                const occl = [];
                for (const d of docks) if (d.mon === i && !d.surface.hidden) occl.push([d.rx, d.rx + d.rw]);
                if (c.behind) {
                    for (const W of wins) {
                        if (W.shown && W.y < bottom && W.y + W.h > bottom - c.groundDepth && W.x < m.x + m.width && W.x + W.w > m.x)
                            occl.push([W.x, W.x + W.w]);
                    }
                }
                out.push({
                    key: `ground:${i}`, kind: 'ground', x0: m.x, x1: m.x + m.width, y: bottom, cap: c.groundDepth, occl,
                    wallL: disp.get_monitor_neighbor_index(i, Meta.DisplayDirection.LEFT) === -1,
                    wallR: disp.get_monitor_neighbor_index(i, Meta.DisplayDirection.RIGHT) === -1,
                });
            }
        }
        return out;
    }

    _findDocks(mons, now) {
        const found = [];
        let tracked = [];
        try {
            tracked = Main.layoutManager._trackedActors ?? [];
        } catch (_e) {}

        tracked.forEach((t, idx) => {
            try {
                const a = t.actor;
                if (!a || a === this._root || !a.visible || !a.mapped) return;
                const target = (a.dash && typeof a.dash.get_transformed_position === 'function') ? a.dash : a;
                const [x, y] = target.get_transformed_position();
                const [w, h] = target.get_transformed_size();
                if (!(w >= 120 && h >= 16 && h <= 260)) return;
                const cx = x + w / 2, cy = y + h / 2;
                const mi = mons.findIndex(m => cx >= m.x && cx < m.x + m.width && cy >= m.y && cy < m.y + m.height);
                if (mi < 0) return;
                const m = mons[mi], bottom = m.y + m.height;
                if (y < m.y + m.height * 0.5) return;
                if (y > bottom - 6) return;
                if (y + h < bottom - 6) return;
                found.push({
                    key: `dock:${idx}`, mon: mi, rx: x, rw: w,
                    surface: {
                        key: `dock:${idx}`, kind: 'dock', x0: x + 8, x1: x + w - 8, y: Math.round(y),
                        cap: this._cfg.ledgeDepth, occl: [], hidden: Main.overview.visible,
                    },
                });
            } catch (_e) {}
        });

        const seen = new Set();
        for (const d of found) {
            seen.add(d.key);
            this._dockMem.set(d.key, {d, t: now});
        }
        for (const [key, m] of this._dockMem) {
            if (seen.has(key)) continue;
            if (now - m.t > DOCK_MEMORY_S) this._dockMem.delete(key);
            else found.push({...m.d, surface: {...m.d.surface, hidden: true}});
        }
        return found;
    }

    _render(now) {
        const sim = this._sim;
        this._renderPiles(now);
        this._renderFlakes(sim);
        this._renderParticles(sim);
    }

    _rebuildFlakes() {
        for (const a of this._flakeActors) a?.destroy();
        this._flakeActors = [];
        this._flakeVis.fill(0);
        this._flakeGen = this._sim.flakeGen;
    }

    _makeFlake(i) {
        const sim = this._sim;
        const s = flakePx(sim.fsz[i]);
        const alpha = sim.falpha[i].toFixed(2);
        const outline = s >= 4 ? 'border: 1px solid rgba(105,135,180,0.32);' : '';
        const a = new St.Widget({
            reactive: false, width: s, height: s,
            style: `background-color: rgba(255,255,255,${alpha}); border-radius: ${s}px; ${outline}`,
        });
        a.hide();
        this._flakeLayer.add_child(a);
        return a;
    }

    _renderFlakes(sim) {
        if (sim.flakeGen !== this._flakeGen) this._rebuildFlakes();
        const vis = this._flakeVis;
        for (let i = 0; i < sim.flakeHigh; i++) {
            let a = this._flakeActors[i];
            if (sim.fAlive[i]) {
                if (!a) a = this._flakeActors[i] = this._makeFlake(i);
                if (!vis[i]) { a.show(); vis[i] = 1; }
                const h = flakePx(sim.fsz[i]) / 2;
                a.set_translation(sim.fx[i] - h, sim.fy[i] - h, 0);
            } else if (vis[i]) {
                a.hide();
                vis[i] = 0;
            }
        }
    }

    _renderParticles(sim) {
        const vis = this._partVis;
        for (let i = 0; i < sim.partHigh; i++) {
            let a = this._partActors[i];
            if (sim.pAlive[i]) {
                if (!a) {
                    a = this._partActors[i] = new St.Widget({reactive: false});
                    this._flakeLayer.add_child(a);
                }
                if (this._partGen[i] !== sim.pgen[i]) {
                    this._partGen[i] = sim.pgen[i];
                    const s = Math.max(1, Math.round(sim.psz[i]));
                    const outline = (sim.pkind[i] !== 1 && s >= 3) ? 'border: 1px solid rgba(105,135,180,0.32);' : '';
                    a.set_size(s, s);
                    a.set_style(`background-color: rgb(255,255,255); border-radius: ${s}px; ${outline}`);
                }
                if (!vis[i]) { a.show(); vis[i] = 1; }
                const fade = sim.pkind[i] === 1 ? sim.pal[i] * Math.max(0, 1 - sim.page[i] / sim.plife[i]) : sim.pal[i];
                a.opacity = Math.round(fade * 255);
                const h = Math.max(1, Math.round(sim.psz[i])) / 2;
                a.set_translation(sim.px[i] - h, sim.py[i] - h, 0);
            } else if (vis[i]) {
                a.hide();
                vis[i] = 0;
            }
        }
    }

    _renderPiles(now) {
        const sim = this._sim;
        for (const [key, p] of sim.piles) {
            let e = this._pileAreas.get(key);
            const visible = !p.hidden && p.maxH > 0.12;
            if (!visible) {
                if (e && e.vis) { e.area.hide(); e.vis = false; e.stale = true; }
                p.dirty = false;
                continue;
            }
            if (!e) {
                const area = new St.DrawingArea({reactive: false});
                area.connect('repaint', a => this._paintPile(a, key));
                this._pileLayer.add_child(area);
                e = {area, vis: true, w: 0, h: 0, px: NaN, py: NaN, t: 0, stale: true};
                this._pileAreas.set(key, e);
            }
            const capI = Math.ceil(p.cap);
            const w = Math.ceil(p.x1 - p.x0) + 2 * PAD, h = capI + PAD + SINK + 2;
            const px = Math.round(p.x0) - PAD, py = Math.round(p.y) - capI - PAD;
            if (e.w !== w || e.h !== h) { e.area.set_size(w, h); e.w = w; e.h = h; e.stale = true; }
            if (e.px !== px || e.py !== py) { e.area.set_position(px, py); e.px = px; e.py = py; }
            if (!e.vis) { e.area.show(); e.vis = true; e.stale = true; }
            if ((p.dirty || e.stale) && now - e.t >= PAINT_S) {
                e.area.queue_repaint();
                e.t = now; p.dirty = false; e.stale = false;
            }
        }
        for (const [key, e] of this._pileAreas) {
            if (sim.piles.has(key)) continue;
            e.area.destroy();
            this._pileAreas.delete(key);
        }
    }

    _paintPile(area, key) {
        const p = this._sim.piles.get(key);
        const cr = area.get_context();
        try {
            cr.setOperator(0);
            cr.paint();
            cr.setOperator(2);
            if (!p) return;

            const n = p.n, c = p.cols, base = PAD + Math.ceil(p.cap);
            if (this._hv.length < n) this._hv = new Float32Array(n + 64);
            const hv = this._hv;
            for (let i = 0; i < n; i++) {
                if (p.occl.length && occludedAt(p.occl, p.x0 + (i + 0.5) * COL_W)) { hv[i] = 0; continue; }
                const a = i > 0 ? c[i - 1] : c[i], b = i < n - 1 ? c[i + 1] : c[i];
                hv[i] = a * 0.25 + c[i] * 0.5 + b * 0.25;
            }
            let i = 0;
            while (i < n) {
                if (hv[i] < 0.12) { i++; continue; }
                let j = i;
                while (j < n && hv[j] >= 0.12) j++;
                this._drawRun(cr, hv, i, j, base);
                i = j;
            }
        } finally {
            cr.$dispose();
        }
    }

    _drawRun(cr, hv, i0, j0, base) {
        const xl = PAD + i0 * COL_W, xr = PAD + j0 * COL_W;

        cr.newPath();
        cr.moveTo(xl, base + SINK);
        cr.lineTo(xl, base);
        for (let k = i0; k < j0; k++) cr.lineTo(PAD + (k + 0.5) * COL_W, base - hv[k]);
        cr.lineTo(xr, base);
        cr.lineTo(xr, base + SINK);
        cr.closePath();
        cr.setSourceRGBA(0.97, 0.985, 1.0, 0.97);
        cr.fill();

        cr.newPath();
        cr.moveTo(xl, base + SINK);
        cr.lineTo(xl, base);
        for (let k = i0; k < j0; k++) cr.lineTo(PAD + (k + 0.5) * COL_W, base - hv[k] * 0.38);
        cr.lineTo(xr, base);
        cr.lineTo(xr, base + SINK);
        cr.closePath();
        cr.setSourceRGBA(0.66, 0.76, 0.9, 0.28);
        cr.fill();

        cr.newPath();
        cr.moveTo(xl, base);
        for (let k = i0; k < j0; k++) cr.lineTo(PAD + (k + 0.5) * COL_W, base - hv[k]);
        cr.lineTo(xr, base);
        cr.setLineWidth(1);
        cr.setSourceRGBA(0.5, 0.62, 0.8, 0.5);
        cr.stroke();
    }
}
