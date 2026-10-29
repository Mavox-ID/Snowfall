export const CAIRO_ALLOWED = new Set(['setOperator', 'paint', 'newPath', 'moveTo', 'lineTo', 'closePath', 'setSourceRGBA', 'fill', 'setLineWidth', 'stroke', '$dispose']);
export const stats = { cairoCalls: 0, repaints: 0, actorsCreated: 0, actorsDestroyed: 0 };

class Base {
    constructor(props = {}) {
        Object.assign(this, { visible: true, mapped: true, opacity: 255, x: 0, y: 0, width: 0, height: 0 }, props);
        this._children = []; this._handlers = {}; this.parent = null; this.destroyed = false;
        stats.actorsCreated++;
    }
    add_child(c) { c.parent = this; this._children.push(c); }
    remove_child(c) { this._children = this._children.filter(x => x !== c); c.parent = null; }
    set_child_below_sibling() {}
    show() { this.visible = true; } hide() { this.visible = false; }
    set_size(w, h) { this.width = w; this.height = h; }
    set_position(x, y) { this.x = x; this.y = y; }
    set_translation(x, y, z) { if (![x, y, z].every(Number.isFinite)) throw new Error(`bad translation ${x},${y},${z}`); this.tx = x; this.ty = y; }
    set_style(s) { this.style = s; }
    get_transformed_position() { return [this.x, this.y]; }
    get_transformed_size() { return [this.width, this.height]; }
    connect(sig, fn) { (this._handlers[sig] ??= []).push(fn); return 1; }
    destroy() { this.destroyed = true; stats.actorsDestroyed++; this.parent?.remove_child(this); for (const c of [...this._children]) c.destroy(); }
}
class DrawingArea extends Base {
    queue_repaint() { stats.repaints++; for (const f of this._handlers.repaint ?? []) f(this); }
    get_surface_size() { return [this.width, this.height]; }
    get_context() {
        return new Proxy({}, { get: (_t, name) => {
            if (!CAIRO_ALLOWED.has(name)) throw new Error(`cairo: no such method ${String(name)}`);
            return () => { stats.cairoCalls++; };
        } });
    }
}

export const timers = [];
let clock = 1000;
export const GLib = {
    PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false, SOURCE_CONTINUE: true,
    get_monotonic_time: () => Math.round(clock * 1000),
    timeout_add(_p, ms, cb) { const id = timers.length + 1; timers.push({ id, ms, cb, alive: true }); return id; },
    source_remove(id) { const t = timers.find(t => t.id === id); if (t) t.alive = false; return true; },
    Source: { set_name_by_id() {} },
};
export function runNextTimer() {
    const t = timers.find(t => t.alive);
    if (!t) return false;
    t.alive = false; clock += t.ms; t.cb();
    return true;
}
export function advance(ms) { clock += ms; }

export const Clutter = { Actor: Base };
export const St = { Widget: Base, DrawingArea, Icon: Base };
export const Meta = {
    WindowType: { NORMAL: 0, DIALOG: 3, MODAL_DIALOG: 4, MENU: 5 },
    DisplayDirection: { UP: 1, DOWN: 2, LEFT: 3, RIGHT: 4 },
    KeyBindingFlags: { IGNORE_AUTOREPEAT: 2 },
};

export const monitors = [{ x: 0, y: 0, width: 1366, height: 768, inFullscreen: false }];
export const chrome = [];
export const globalMock = {
    window_group: new Base(),
    _windows: [],
    get_window_actors() { return this._windows; },
    workspace_manager: { get_active_workspace: () => 'ws1' },
    display: { get_monitor_neighbor_index: () => -1 },
    pointer: [683, 300],
    get_pointer() { return [...this.pointer, 0]; },
};
export const Main = {
    layoutManager: {
        monitors, _trackedActors: [], uiGroup: { add_child(a) { chrome.push(a); }, remove_child(a) { const i = chrome.indexOf(a); if (i >= 0) chrome.splice(i, 1); } },
        addChrome(a) { chrome.push(a); }, removeChrome(a) { const i = chrome.indexOf(a); if (i >= 0) chrome.splice(i, 1); },
        connect: () => 1, disconnect() {},
        getWorkAreaForMonitor: i => ({ x: monitors[i].x, y: monitors[i].y + 32, width: monitors[i].width, height: monitors[i].height - 32 }),
    },
    overview: { visible: false },
};

export function makeWindow(seq, x, y, w, h, over = {}) {
    const win = {
        minimized: false, fullscreen: false, ws: 'ws1', mon: 0, ...over,
        get_window_type: () => 0, get_workspace: () => win.ws, is_on_all_workspaces: () => false,
        get_frame_rect: () => ({ x: win.x, y: win.y, width: win.w, height: win.h }),
        is_fullscreen: () => win.fullscreen, get_monitor: () => win.mon,
        get_stable_sequence: () => seq, located_on_workspace: ws => win.ws === ws, x, y, w, h,
    };
    return { meta_window: win, visible: true, win };
}

export function makeSettings(values) {
    const v = { ...values };
    const handlers = [];
    return {
        v,
        get_boolean: k => { if (!(k in v)) throw new Error('no such key ' + k); return v[k]; },
        get_string: k => { if (!(k in v)) throw new Error('no such key ' + k); return v[k]; },
        get_double: k => { if (!(k in v)) throw new Error('no such key ' + k); return v[k]; },
        get_int: k => { if (!(k in v)) throw new Error('no such key ' + k); return v[k]; },
        connect(sig, fn) { handlers.push(fn); return handlers.length; },
        disconnect() {},
        set(k, val) { v[k] = val; for (const h of handlers) h(null, k); },
    };
}
