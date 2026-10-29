import * as M from './mocks.mjs';
globalThis.global = M.globalMock;
const { Overlay } = await import('../extension/overlay.js');

const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };
const settings = M.makeSettings({
    enabled: true, intensity: 'steady', density: 1, 'flake-size': 1, wind: 1, accumulate: true, 'accumulation-speed': 3,
    melt: false, 'ground-snow': true, 'ground-depth': 24, 'window-snow': true, 'dock-snow': true, 'ledge-depth': 12,
    'cursor-interaction': true, 'behind-windows': false, 'hide-on-fullscreen': true, fps: 30,
});

const w1 = M.makeWindow(1, 100, 120, 600, 400);
const w2 = M.makeWindow(2, 500, 300, 700, 380);
M.globalMock._windows = [w1, w2];
const dock = new (await import('./mocks.mjs')).St.Widget({ x: 491, y: 700, width: 384, height: 68 });
M.Main.layoutManager._trackedActors = [{ actor: dock }];

const ov = new Overlay(settings);
ov.enable();
assert(M.chrome.length === 1, 'overlay attached to uiGroup');

const run = n => { for (let i = 0; i < n; i++) if (!M.runNextTimer()) return i; return n; };
run(30 * 60);
const sim = ov._sim;
const keys = [...sim.piles.keys()].sort();
console.log('surfaces:', keys.join(', '));
assert(keys.includes('ground:0') && keys.includes('w1') && keys.includes('w2') && keys.includes('dock:0'), 'all surfaces found');
assert(sim.aliveFlakes > 50, 'snow is falling: ' + sim.aliveFlakes);
assert(M.stats.repaints > 0 && M.stats.cairoCalls > 0, 'drifts are painted (repaints=' + M.stats.repaints + ')');
const gnd = sim.piles.get('ground:0');
assert(gnd.occl.length === 1 && gnd.occl[0][0] === 491, 'the dock occludes the ground');
const w1p = sim.piles.get('w1');
const w4 = M.makeWindow(4, 300, 60, 300, 220);
M.globalMock._windows.push(w4);
run(3);
assert(sim.piles.get('w1').occl.some(o => o[0] === 300 && o[1] === 600), 'the upper window covers w1 edge');
M.globalMock._windows.pop();
run(3);
assert(sim.piles.get('w1').occl.length === 0, 'once the window is gone the edge is clear');
console.log(`after 60 s: flakes=${sim.aliveFlakes}, ground=${gnd.maxH.toFixed(1)}, w1=${w1p.maxH.toFixed(1)}, dock=${sim.piles.get('dock:0').maxH.toFixed(1)}`);

const w3 = M.makeWindow(3, 0, 32, 1366, 736);
M.globalMock._windows.push(w3);
run(10);
assert(!sim.piles.has('w3'), 'no drift on a maximized window');
M.globalMock._windows.pop();

w2.win.minimized = true;
run(2);
assert(!sim.piles.has('w2'), 'a minimized window loses its drift');
assert(sim.alivePart > 0 || sim.piles.get('ground:0').maxH > 0, 'the lumps fell');
w2.win.minimized = false;

w1.win.ws = 'ws2'; w1.visible = false;
run(5);
assert(sim.piles.get('w1')?.hidden === true, 'window on another workspace: drift hidden but alive');
w1.win.ws = 'ws1'; w1.visible = true;
run(5);
assert(sim.piles.get('w1')?.hidden === false, 'back again — the drift is still there');

settings.set('intensity', 'off'); run(30 * 45);
assert(sim.aliveFlakes === 0 && sim.alivePart === 0, 'the sky is clear');
{
    const c = sim.piles.get('ground:0').cols;
    c.fill(6); sim.piles.get('ground:0').maxH = 6;
    const under = () => { let m = 0; for (let i = 142; i < 158; i++) m += c[i]; return m; };
    const before = under();
    M.globalMock.pointer = [300, 760];
    run(1);
    const after = under();
    console.log(`cursor: mass under it ${before.toFixed(0)} → ${after.toFixed(0)}, particles in the air ${sim.alivePart}`);
    assert(after < before * 0.6, 'the cursor plows snow');
    assert(sim.alivePart > 0, 'plowed snow flies up as spray');
}

settings.set('intensity', 'heavy'); run(30 * 5);
assert(sim.aliveFlakes > 100, 'heavy: snow is falling again, flakes=' + sim.aliveFlakes);
settings.set('flake-size', 1.8); run(30);
settings.set('behind-windows', true); run(30);
assert(M.globalMock.window_group._children.includes(ov._root), 'behind-windows mode: overlay lives in window_group');
settings.set('behind-windows', false); run(5);
settings.set('clear-counter', 1);
assert(sim.piles.get('ground:0').maxH === 0 && sim.piles.get('ground:0').cols.every(v => v === 0), 'clearing works');
run(3);

M.monitors[0].inFullscreen = true; run(2);
assert(ov._root.visible === false, 'overlay hidden in fullscreen');
M.monitors[0].inFullscreen = false; run(2);
assert(ov._root.visible === true, 'visible again after fullscreen');

settings.set('enabled', false); run(3);
assert(ov._root.visible === false && !M.timers.some(t => t.alive), 'disabled: no timers running');
settings.set('enabled', true); run(3);
assert(M.timers.some(t => t.alive), 'enabled: the loop resumed');

ov.disable();
assert(M.chrome.length === 0 && !M.timers.some(t => t.alive), 'disable() cleaned everything up');
console.log(`actors created ${M.stats.actorsCreated}, destroyed ${M.stats.actorsDestroyed}`);
console.log('OK');
