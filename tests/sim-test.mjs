import { SnowSim, COL_W } from '../extension/sim.js';

let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function scene(win2y = 300) {
    return [
        { key: 'ground:0', kind: 'ground', x0: 0, x1: 1366, y: 768, cap: 24, occl: [[483, 883]], wallL: true, wallR: true },
        { key: 'dock:0', kind: 'dock', x0: 491, x1: 875, y: 700, cap: 12, occl: [] },
        { key: 'w1', kind: 'window', x0: 110, x1: 700, y: 120, cap: 12, occl: [] },
        { key: 'w2', kind: 'window', x0: 500, x1: 1200, y: win2y, cap: 12, occl: [[640, 760]] },
    ];
}
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };
const stat = (sim, k) => { const p = sim.piles.get(k); return p ? p.maxH : 0; };

const sim = new SnowSim({ rand });
sim.resize(1366, 768);
sim.configure({ intensity: 'steady', depositRate: 1.5 });
sim.prefill();

const dt = 1 / 30;
let worst = 0, total = 0, ticks = 0;
const report = (t) => console.log(
    `t=${String(t).padStart(4)}s  flakes=${String(sim.aliveFlakes).padStart(3)} parts=${String(sim.alivePart).padStart(3)}  ` +
    `ground=${stat(sim, 'ground:0').toFixed(1)}  dock=${stat(sim, 'dock:0').toFixed(1)}  w1=${stat(sim, 'w1').toFixed(1)}  w2=${stat(sim, 'w2').toFixed(1)}`);

function run(seconds, win2y = 300, ptr = null) {
    for (let i = 0; i < seconds * 30; i++) {
        const t0 = performance.now();
        sim.syncSurfaces(scene(win2y), dt);
        sim.step(dt, ptr);
        const ms = performance.now() - t0;
        worst = Math.max(worst, ms); total += ms; ticks++;
        for (const p of sim.piles.values()) for (let j = 0; j < p.n; j++) {
            assert(Number.isFinite(p.cols[j]) && p.cols[j] >= -1e-3 && p.cols[j] <= p.cap + 1e-3, `bad column ${p.key}[${j}]=${p.cols[j]}`);
        }
        for (let j = 0; j < sim.flakeHigh; j++) assert(Number.isFinite(sim.fx[j] + sim.fy[j]), 'NaN flake');
    }
}

console.log('— accumulation (steady, 1366×768) —');
for (let t = 30; t <= 300; t += 30) { run(30); report(t); }
assert(stat(sim, 'ground:0') > 4, 'ground should accumulate');
assert(stat(sim, 'ground:0') <= 24.001, 'ground capped');
assert(stat(sim, 'dock:0') > 1, 'dock should accumulate');

console.log('— snow flies off a fast-moving window —');
const before = stat(sim, 'w2');
sim.syncSurfaces(scene(300), dt);
sim.syncSurfaces(scene(330), dt);
const after = stat(sim, 'w2');
console.log(`w2 height before=${before.toFixed(1)} after the jerk=${after.toFixed(1)}  particles in the air=${sim.alivePart}`);
assert(after < before, 'moving window sheds snow');
sim.syncSurfaces(scene(300), dt);
run(2, 300);

console.log('— closing a window drops lumps —');
const list = scene().filter(s => s.key !== 'w1');
const gBefore = stat(sim, 'ground:0');
sim.syncSurfaces(list, dt);
assert(sim.alivePart > 0, 'closed window spawns lumps');
for (let i = 0; i < 120; i++) { sim.syncSurfaces(list, dt); sim.step(dt, null); }
console.log(`lumps landed, ground ${gBefore.toFixed(1)} → ${stat(sim, 'ground:0').toFixed(1)}, parts=${sim.alivePart}`);

console.log('— the cursor plows the ground —');
const gp = sim.piles.get('ground:0');
let sum = (p) => p.cols.reduce((a, b) => a + b, 0);
const s0 = sum(gp);
for (let i = 0; i < 20; i++) {
    sim.syncSurfaces(scene(600), dt);
    sim.step(dt, { x: 100 + i * 12, y: 760, vx: 700, vy: 0 });
}
console.log(`snow mass ${s0.toFixed(0)} → ${sum(gp).toFixed(0)} (in the air: ${sim.alivePart} particles)`);
assert(sum(gp) < s0, 'cursor sweeps snow');

console.log('— melt mode —');
sim.configure({ melt: true, intensity: 'off' });
const g0 = stat(sim, 'ground:0');
run(120, 600);
console.log(`ground ${g0.toFixed(1)} → ${stat(sim, 'ground:0').toFixed(1)} over 120 s (snowfall off, melt on)`);

console.log('— clearing —');
sim.clear();
assert(stat(sim, 'ground:0') === 0, 'clear works');

console.log(`\nsteps: ${ticks}, average ${(total / ticks).toFixed(3)} ms/step, worst ${worst.toFixed(2)} ms`);
console.log('OK');
