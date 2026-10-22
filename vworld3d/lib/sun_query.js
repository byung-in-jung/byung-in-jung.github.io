/* Point query: direct-sun hours at ONE facade point (building, floor, orientation), computed live by ray-marching toward the sun
 * against building boxes (2.5 m height grid, terrain base z0 .. roof z1) and the terrain height function.  No THREE dependency (node-testable).
 *   const Q = SunQuery.create({ buildings, getGroundHeight, bounds, terrainMax, calc?, lat?, lon? });
 *   Q.query({ id | index, floor, floorH, orient: 'S'|'E'|'W'|'N'|'all', edge?: index, dateKey?: {m,d} })
 * Scene metres: x east, y north, z up.  Descriptive only - not a legal assessment (docs/SUN.md).
 */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180;
  const KEYS = [['1221', 12, 21, '동지'], ['0321', 3, 21, '춘분'], ['0621', 6, 21, '하지'], ['0923', 9, 23, '추분']];
  const ORI = ['N', 'E', 'S', 'W'], ORI_KO = { N: '북', E: '동', S: '남', W: '서' };
  const REF = { run: 2.0, total: 4.0, from: 9, to: 15 };

  function parseUnit(s) {
    const m = /^\s*(\d{3,4})\s*호?\s*$/.exec(String(s || '')); if (!m) return null;
    const v = m[1]; return { floor: parseInt(v.slice(0, -2), 10), line: v.slice(-2), text: v + '호' };
  }

  function create(o) {
    const calc = o.calc || (root.SunAddon && root.SunAddon.calc) || require('./sun.js').calc;
    const lat = o.lat != null ? o.lat : 36.5, lon = o.lon != null ? o.lon : 127.27;
    const gh = o.getGroundHeight || (() => 0), CELL = o.cell || 2.5, YEAR = 2026;
    const bs = (o.buildings || []).map((b, i) => Object.assign({ idx: i }, b));
    const byId = new Map(); bs.forEach((b) => byId.set(b.id, b));
    const B = o.bounds || [-1000, -1000, 1000, 1000];
    const gx0 = B[0] - 100, gy0 = B[1] - 100, gnx = Math.ceil((B[2] - B[0] + 200) / CELL), gny = Math.ceil((B[3] - B[1] + 200) / CELL);
    const Hb = new Float32Array(gnx * gny).fill(-1e9), Ib = new Int32Array(gnx * gny).fill(-1);
    let maxTop = -1e9;
    for (const b of bs) {   // rasterise footprints (cell centre inside polygon, even-odd)
      const R = b.ring; let xmin = 1e18, xmax = -1e18, ymin = 1e18, ymax = -1e18;
      for (const p of R) { xmin = Math.min(xmin, p[0]); xmax = Math.max(xmax, p[0]); ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); }
      b.bbox = [xmin, ymin, xmax, ymax]; maxTop = Math.max(maxTop, b.z1);
      const i0 = Math.max(0, Math.floor((xmin - gx0) / CELL - 0.5)), i1 = Math.min(gnx - 1, Math.ceil((xmax - gx0) / CELL - 0.5));
      const j0 = Math.max(0, Math.floor((ymin - gy0) / CELL - 0.5)), j1 = Math.min(gny - 1, Math.ceil((ymax - gy0) / CELL - 0.5));
      for (let j = j0; j <= j1; j++) {
        const y = gy0 + (j + 0.5) * CELL, xs = [];
        for (let k = 0, n = R.length; k < n; k++) { const a = R[k], c = R[(k + 1) % n]; if ((a[1] > y) !== (c[1] > y)) xs.push(a[0] + (y - a[1]) * (c[0] - a[0]) / (c[1] - a[1])); }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const ia = Math.max(i0, Math.ceil((xs[k] - gx0) / CELL - 0.5)), ib = Math.min(i1, Math.floor((xs[k + 1] - gx0) / CELL - 0.5));
          for (let i = ia; i <= ib; i++) { const q = j * gnx + i; if (b.z1 > Hb[q]) { Hb[q] = b.z1; Ib[q] = b.idx; } }
        }
      }
    }
    const terrainMax = o.terrainMax != null ? o.terrainMax : 300;

    // ---- geometry helpers
    function edgesOf(b) {
      if (b._edges) return b._edges;
      const R = b.ring.slice(); if (R.length > 3 && R[0][0] === R[R.length - 1][0] && R[0][1] === R[R.length - 1][1]) R.pop();
      let a2 = 0; for (let i = 0; i < R.length; i++) { const p = R[i], q = R[(i + 1) % R.length]; a2 += p[0] * q[1] - q[0] * p[1]; }
      const ccw = a2 > 0, E = [];
      for (let i = 0; i < R.length; i++) {
        const p = R[i], q = R[(i + 1) % R.length], dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy); if (len < 2) continue;
        const nx = ccw ? dy / len : -dy / len, ny = ccw ? -dx / len : dx / len, az = (Math.atan2(nx, ny) / D2R + 360) % 360;
        E.push({ i, ax: p[0], ay: p[1], bx: q[0], by: q[1], cx: (p[0] + q[0]) / 2, cy: (p[1] + q[1]) / 2, nx, ny, len, az, orient: ORI[Math.floor(((az + 45) % 360) / 90)] });
      }
      return (b._edges = E);
    }
    function edgeFor(b, orient) {   // longest wall whose outward normal is within 45 deg of the cardinal direction
      const E = edgesOf(b).filter((e) => e.orient === orient); if (!E.length) return null;
      return E.reduce((m, e) => (e.len > m.len ? e : m));
    }
    function nearestEdge(b, x, y) {
      let best = null, bd = 1e18;
      for (const e of edgesOf(b)) {
        const t = Math.max(0, Math.min(1, ((x - e.ax) * (e.bx - e.ax) + (y - e.ay) * (e.by - e.ay)) / (e.len * e.len))), d = Math.hypot(x - (e.ax + t * (e.bx - e.ax)), y - (e.ay + t * (e.by - e.ay)));
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    }
    const floorsOf = (b, fh) => { const n = Math.max(0, Math.floor((b.z1 - b.z0) / fh + 1e-6)); return b.fl > 0 ? Math.min(b.fl, n) : n; };   // b.fl = 지상층수 from the 대장 (optional)
    const label = (b) => b.name || ('건물 ' + b.id);

    // ---- sun samples (15-min step centres while altitude > 0), cached per date
    const sunCache = {};
    function samples(m, d) {
      const k = m + '-' + d; if (sunCache[k]) return sunCache[k];
      const out = [];
      for (let q = 0; q < 96; q++) { const h = (q + 0.5) * 0.25, s = calc.solarPosition(YEAR, m, d, h, lat, lon); if (s.alt > 0) { const az = s.az * D2R, ca = Math.cos(s.alt * D2R); out.push({ h, alt: s.alt, az: s.az, ux: Math.sin(az), uy: Math.cos(az), t: Math.tan(s.alt * D2R), ca }); } }
      return (sunCache[k] = out);
    }

    // ---- ray test toward the sun. returns null (sunlit) or {type:'bld', idx} | {type:'terrain'}
    // Self-shading is exact: the point's own building is skipped in the raster (cell centres inside a wall would block grazing rays) and tested against its real
    // footprint edges instead (a courtyard wing or the building body behind a lit point still shades it).
    function ownBlocks(px, py, pz, s, b) {
      const R = b.ring, n = R.length; let best = Infinity;
      for (let k = 0; k < n; k++) {
        const a = R[k], c = R[(k + 1) % n], ex = c[0] - a[0], ey = c[1] - a[1], den = s.ux * ey - s.uy * ex; if (Math.abs(den) < 1e-9) continue;
        const dx = a[0] - px, dy = a[1] - py, d = (dx * ey - dy * ex) / den, t = (dx * s.uy - dy * s.ux) / den;
        if (d > 0.02 && t >= 0 && t <= 1 && d < best) best = d;
      }
      return best < Infinity && pz + s.t * best < b.z1 ? best : null;
    }
    function trace(px, py, pz, s, own, nearSkip) {
      let dB = Infinity;
      const dTop = (maxTop - pz) / s.t, dLim = Math.min(dTop, 900);
      let hit = null, dHit = Infinity;
      if (dLim > 0) {
        for (let d = 1.2; d < dLim; d += 1.5) {
          const x = px + s.ux * d, y = py + s.uy * d, i = Math.floor((x - gx0) / CELL), j = Math.floor((y - gy0) / CELL);
          if (i < 0 || j < 0 || i >= gnx || j >= gny) break;
          const q = j * gnx + i, h = Hb[q]; if (h > pz + s.t * d) { const id = Ib[q]; if (id === own) continue; hit = { type: 'bld', idx: id }; dHit = d; break; }
        }
      }
      if (own != null && own >= 0 && bs[own] && ownBlocks(px, py, pz, s, bs[own]) != null) return { type: 'bld', idx: own };
      const dTer = Math.min(dHit, (terrainMax - pz) / s.t, 12000);
      for (let d = 2; d < dTer; d += Math.max(4, d * 0.03)) { if (gh(px + s.ux * d, py + s.uy * d) > pz + s.t * d) return { type: 'terrain' }; }
      return hit;
    }
    const blockerName = (r, own) => (r.type === 'terrain' ? '산/지형' : r.idx === own ? '자기 건물' : '앞동 ' + label(bs[r.idx]));

    // ---- one facade point over one date
    function evalDay(pt, m, d, own, win) {
      const sm = samples(m, d), steps = []; let tot = 0, run = 0, cur = 0, wtot = 0, wrun = 0, wcur = 0;
      for (const s of sm) {
        let lit, why = null;
        if (pt.nx * s.ux + pt.ny * s.uy <= 1e-6) { lit = false; why = { type: 'bld', idx: own, self: true }; }
        else { why = trace(pt.x, pt.y, pt.z, s, own, 5); lit = why === null; }
        steps.push({ h: s.h, alt: s.alt, az: s.az, lit, why: lit ? null : (why.self ? '자기 건물' : blockerName(why, own)), widx: why && why.type === 'bld' && !why.self && why.idx !== own ? why.idx : null });
        if (lit) { tot += 0.25; cur += 0.25; run = Math.max(run, cur); } else cur = 0;
        if (win && s.h >= REF.from && s.h <= REF.to) { if (lit) { wtot += 0.25; wcur += 0.25; wrun = Math.max(wrun, wcur); } else wcur = 0; }
      }
      return { steps, tot, run, wtot, wrun };
    }
    function intervals(steps) {   // merge consecutive steps with the same state / blocker
      const out = [];
      for (const s of steps) {
        const key = s.lit ? '일조' : s.why, L = out[out.length - 1];
        if (L && L.key === key && Math.abs(s.h - 0.125 - L.to) < 1e-6) L.to = s.h + 0.125; else out.push({ key, lit: s.lit, from: s.h - 0.125, to: s.h + 0.125, widx: s.widx });
      }
      return out;
    }
    function point(b, e, floor, fh) { return { x: e.cx + e.nx * 0.1, y: e.cy + e.ny * 0.1, z: b.z0 + (floor - 1) * fh + 1.2, nx: e.nx, ny: e.ny }; }

    // ---- full evaluation of one orientation
    function evalFacade(b, e, floor, fh, cur, withProfile) {
      const pt = point(b, e, floor, fh), own = b.idx, res = { orient: e.orient, az: e.az, edge: e.i, pt, dates: [], len: e.len };
      const dl = KEYS.map((k) => ({ key: k[0], m: k[1], d: k[2], label: k[3] }));
      if (cur && !dl.some((x) => x.m === cur.m && x.d === cur.d)) dl.push({ key: 'cur', m: cur.m, d: cur.d, label: `${cur.m}월 ${cur.d}일` });
      const blk = {};
      for (const dt of dl) {
        const r = evalDay(pt, dt.m, dt.d, own, dt.key === '1221'), iv = intervals(r.steps);
        dt.tot = r.tot; dt.run = r.run; dt.intervals = iv; dt.steps = r.steps;
        if (dt.key === '1221') { dt.wtot = r.wtot; dt.wrun = r.wrun; dt.meetsRun = r.wrun >= REF.run - 1e-9; dt.meetsTotal = r.wtot >= REF.total - 1e-9; }
        for (const s of r.steps) if (!s.lit) { const k = s.why; (blk[k] = blk[k] || { name: k, hours: 0, widx: s.widx, assumed: s.widx != null ? !!bs[s.widx].assumed : k === '자기 건물' ? !!b.assumed : false }).hours += 0.25; }
        res.dates.push(dt);
      }
      res.blockers = Object.values(blk).sort((a, c) => c.hours - a.hours).slice(0, 3);
      if (withProfile) {   // 동지 9-15 total hours per floor
        const N = floorsOf(b, fh), stride = N > 24 ? 2 : 1, sm = samples(12, 21).filter((s) => s.h >= REF.from && s.h <= REF.to), prof = [];
        for (let f = 1; f <= N; f += stride) {
          const p = point(b, e, f, fh); let t = 0;
          for (const s of sm) if (p.nx * s.ux + p.ny * s.uy > 1e-6 && trace(p.x, p.y, p.z, s, own, 5) === null) t += 0.25;
          prof.push([f, t]);
        }
        if (prof.length && prof[prof.length - 1][0] !== N && N > 0) { const p = point(b, e, N, fh); let t = 0; for (const s of sm) if (p.nx * s.ux + p.ny * s.uy > 1e-6 && trace(p.x, p.y, p.z, s, own, 5) === null) t += 0.25; prof.push([N, t]); }
        res.profile = prof;
      }
      return res;
    }


    // ================================================================ 일조 점수 (0-100)
    // score = 100 x (direct-sun time / daylight time of that date). Daylight = sun altitude > 0 (sunrise..sunset), sampled every STEP_MIN minutes (step centres).
    // Direct sun = altitude > 0 AND the sun is in the wall's outward half-space (cos > 0) AND no building / terrain on the ray (same trace() as the point query).
    // Split of the lost share: dirLoss = daylight with the wall facing away from the sun (cannot be lit even on open ground), shadeLoss = lost to buildings / terrain.
    const STEP_MIN = 10, scoreSunCache = {};
    function scoreSamples(m, d) {
      const k = m + '-' + d; if (scoreSunCache[k]) return scoreSunCache[k];
      const n = Math.round(1440 / STEP_MIN), out = [];
      for (let q = 0; q < n; q++) { const h = (q + 0.5) * STEP_MIN / 60, sp = calc.solarPosition(YEAR, m, d, h, lat, lon); if (sp.alt > 0) { const az = sp.az * D2R, ca = Math.cos(sp.alt * D2R); out.push({ h, alt: sp.alt, az: sp.az, ux: Math.sin(az) * ca, uy: Math.cos(az) * ca, t: Math.tan(sp.alt * D2R) }); } }
      return (scoreSunCache[k] = out);
    }
    // NOTE: trace() expects ux,uy = horizontal unit direction and t = tan(alt); samples() above stores exactly that, so rebuild with it for the trace.
    function scoreDir(sm) { return sm.map((s) => { const az = s.az * D2R; return Object.assign({}, s, { ux: Math.sin(az), uy: Math.cos(az) }); }); }
    const scoreSmCache = {};
    function sm4(m, d) { const k = m + '-' + d; return scoreSmCache[k] || (scoreSmCache[k] = scoreDir(scoreSamples(m, d))); }
    // pt.horiz = horizontal surface (ground, yard, field, roof): no orientation test, so there is no direction loss.
    // detail = true also returns the 24 h slot states (0 night, 1 sun, 2 shaded by buildings/terrain, 3 facing away) and the day's first/last sun time.
    function scorePoint(pt, m, d, own, detail) {
      const sm = sm4(m, d), N = sm.length; let lit = 0, away = 0, blocked = 0; const slots = detail ? new Uint8Array(Math.round(1440 / STEP_MIN)) : null;
      for (const s of sm) {
        const si = detail ? Math.min(slots.length - 1, Math.floor(s.h * 60 / STEP_MIN)) : 0;
        // general surface normal (nx, ny, nz; nz = 0 for a vertical wall, 1 for a horizontal surface, anything between for slopes): lit only if n . sun > 0
        const ca = Math.cos(s.alt * D2R), sa = Math.sin(s.alt * D2R), nz = pt.horiz ? 1 : (pt.nz || 0), nxx = pt.horiz ? 0 : pt.nx, nyy = pt.horiz ? 0 : pt.ny;
        if ((nxx * s.ux + nyy * s.uy) * ca + nz * sa <= 1e-6) { away++; if (detail) slots[si] = 3; continue; }
        if (trace(pt.x, pt.y, pt.z, s, own == null ? -1 : own, 5) === null) { lit++; if (detail) slots[si] = 1; } else { blocked++; if (detail) slots[si] = 2; }
      }
      const f = N ? 100 / N : 0, r = { score: lit * f, dir: away * f, shade: blocked * f, litH: lit * STEP_MIN / 60, dayH: N * STEP_MIN / 60 };
      if (detail) { r.slots = slots; r.rise = N ? sm[0].h - STEP_MIN / 120 : null; r.set = N ? sm[N - 1].h + STEP_MIN / 120 : null; }
      return r;
    }
    // ---- ANY point (no building needed): horizontal surface or a vertical wall of a given orientation at height h above the ground.
    const NRM = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] };
    function terrainInfo(x, y, z) {   // elevation + highest terrain horizon angle (deg) over all azimuths and over the southern sector (120-240 deg)
      let all = -90, south = -90, azAll = 0, azSouth = 180;
      for (let az = 0; az < 360; az += 6) {
        const ux = Math.sin(az * D2R), uy = Math.cos(az * D2R); let mx = -90;
        for (let d = 15; d < 8000; d += Math.max(10, d * 0.06)) { const a = Math.atan2(gh(x + ux * d, y + uy * d) - z, d) / D2R; if (a > mx) mx = a; }
        if (mx > all) { all = mx; azAll = az; }
        if (az >= 120 && az <= 240 && mx > south) { south = mx; azSouth = az; }
      }
      return { elev: gh(x, y), horizonAll: Math.max(0, all), azAll, horizonSouth: Math.max(0, south), azSouth };
    }
    // ---- 생활동선 x 일조: samples along a polyline (flat [x0,y0,x1,y1,...]) every `step` m (ground, 0.5 m up), line-averaged ground sunshine, instantaneous lit test
    function lineSamples(pts, step, zAdd) {
      const out = [], za = zAdd == null ? 0.5 : zAdd; step = step || 20; let next = 0;       // `next` = distance along the polyline of the next sample
      let acc = 0;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3], L = Math.hypot(x1 - x0, y1 - y0); if (L < 1e-9) continue;
        while (next <= acc + L + 1e-9) { const u = (next - acc) / L, x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u; out.push({ x, y, z: gh(x, y) + za }); next += step; }
        acc += L;
      }
      if (!out.length && pts.length >= 2) out.push({ x: pts[0], y: pts[1], z: gh(pts[0], pts[1]) + za });
      return out;
    }
    function scoreLine(pts, o) {   // o: { step, shadeBelow (winter score under which a sample counts as shaded, default 50) }
      const sp = lineSamples(pts, (o && o.step) || 20), thr = (o && o.shadeBelow) != null ? o.shadeBelow : 50; let w = 0, a = 0, sh = 0;
      for (const p of sp) {
        const pt = { x: p.x, y: p.y, z: p.z, horiz: true, nx: 0, ny: 0, nz: 1 }; let ann = 0, win = 0;
        for (const k of KEYS) { const r = scorePoint(pt, k[1], k[2], -1, false); ann += r.score; if (k[0] === '1221') win = r.score; }
        w += win; a += ann / KEYS.length; if (win < thr) sh++;
      }
      const n = sp.length || 1; return { n: sp.length, winter: w / n, annual: a / n, shadedPct: 100 * sh / n };
    }
    function litAt(x, y, z, m, d, h) {   // 1 sun, 0 shade, -1 night (horizontal surface, no own building)
      const sp = calc.solarPosition(YEAR, m, d, h, lat, lon); if (sp.alt <= 0) return -1; const az = sp.az * D2R;
      return trace(x, y, z, { ux: Math.sin(az), uy: Math.cos(az), t: Math.tan(sp.alt * D2R) }, -1, 5) === null ? 1 : 0;
    }
    function unit3(n) { const l = Math.hypot(n[0], n[1], n[2]) || 1; return [n[0] / l, n[1] / l, n[2] / l]; }
    function terrainNormal(x, y, step) {   // upward unit normal of the terrain height function (central differences)
      const d = step || 10, dx = (gh(x + d, y) - gh(x - d, y)) / (2 * d), dy = (gh(x, y + d) - gh(x, y - d)) / (2 * d); return unit3([-dx, -dy, 1]);
    }
    // q: { x, y, h (m above ground) | z (absolute),
    //      normal: [nx, ny, nz] (scene metres: x east, y north, z up; any direction = walls, roofs, slopes) | kind: 'H' (flat) | 'V' + orient 'S'|'E'|'W'|'N'|'all',
    //      own: building index whose own surface is evaluated (self-shading uses a 5 m near-skip, so the wall itself never blocks), cur?: {m, d} }
    function scoreAnyPoint(q) {
      const x = +q.x, y = +q.y; if (!isFinite(x) || !isFinite(y)) return { ok: false, msg: '좌표를 읽을 수 없습니다.' };
      const ground = gh(x, y), z = q.z != null ? +q.z : ground + (q.h != null ? +q.h : 1.5);
      let specs, kind;
      if (q.normal) { kind = 'N'; specs = [{ orient: 'n', n: unit3(q.normal) }]; }
      else { kind = q.kind === 'V' ? 'V' : 'H'; specs = kind === 'H' ? [{ orient: null, n: [0, 0, 1] }] : (q.orient && q.orient !== 'all' ? [q.orient] : ['S', 'E', 'W', 'N']).map((on) => ({ orient: on, n: [NRM[on][0], NRM[on][1], 0] })); }
      const res = specs.map((sp) => {
        const n = sp.n, pt = { x: x + n[0] * 0.08, y: y + n[1] * 0.08, z: z + n[2] * 0.08, nx: n[0], ny: n[1], nz: n[2] }, byDate = {};
        for (const k of KEYS) byDate[k[0]] = scorePoint(pt, k[1], k[2], q.own == null ? -1 : q.own, true);
        if (q.cur) byDate.cur = scorePoint(pt, q.cur.m, q.cur.d, q.own == null ? -1 : q.own, true);
        const hz = Math.hypot(n[0], n[1]);
        return { orient: sp.orient, normal: n, az: hz > 1e-6 ? (Math.atan2(n[0], n[1]) / D2R + 360) % 360 : null, tilt: Math.acos(Math.max(-1, Math.min(1, n[2]))) / D2R, byDate, annual: avgScores(KEYS.map((k) => byDate[k[0]])), winter: byDate['1221'] };
      });
      return { ok: true, x, y, z, ground, h: z - ground, kind, results: res, info: terrainInfo(x, y, z), outside: x < B[0] - 100 || x > B[2] + 100 || y < B[1] - 100 || y > B[3] + 100 };
    }

    const mean = (a, k) => (a.length ? a.reduce((x, y) => x + y[k], 0) / a.length : 0);
    function avgScores(list) { return { score: mean(list, 'score'), dir: mean(list, 'dir'), shade: mean(list, 'shade'), litH: mean(list, 'litH'), dayH: mean(list, 'dayH') }; }
    function scoreFacade(b, e, floor, fh, extra) {           // one wall at one floor over the 4 representative days (+ optional current day)
      const pt = point(b, e, floor, fh), byDate = {};
      for (const k of KEYS) byDate[k[0]] = scorePoint(pt, k[1], k[2], b.idx);
      if (extra) byDate.cur = scorePoint(pt, extra.m, extra.d, b.idx);
      const annual = avgScores(KEYS.map((k) => byDate[k[0]]));
      return { orient: e.orient, edge: e.i, az: e.az, floor, byDate, annual, winter: byDate['1221'] };
    }
    function bandFloors(N) { return N <= 2 ? [[N <= 1 ? '전층' : '저층', 1], ...(N === 2 ? [['고층', 2]] : [])] : [['저층', Math.max(1, Math.ceil(N / 6))], ['중층', Math.max(1, Math.round(N / 2))], ['고층', Math.max(1, Math.ceil(N * 5 / 6))]]; }
    // Building: 4 faces x 3 floor bands. Building score = mean over the faces at the middle band (representative); best face, floor-band means. opts.light = middle band only (complex roll-ups).
    function scoreBuilding(b, opts) {
      opts = opts || {}; const fh = opts.floorH || 2.8, N = floorsOf(b, fh);
      if (N < 1) return { ok: false, msg: `높이 ${(b.z1 - b.z0).toFixed(1)} m: 층을 정할 수 없어 점수를 계산하지 않습니다.`, building: b };
      const bands = opts.light ? [['중층', Math.max(1, Math.round(N / 2))]] : bandFloors(N), res = { ok: true, building: b, floors: N, assumed: !!b.assumed, bands: bands.map((x) => ({ label: x[0], floor: x[1], faces: [] })), faces: [] };
      for (const on of ['S', 'E', 'W', 'N']) {
        const e = edgeFor(b, on); if (!e) continue;
        const per = bands.map((bd, i) => { const f = scoreFacade(b, e, bd[1], fh); res.bands[i].faces.push(f); return f; });
        const mid = per[Math.min(per.length - 1, bands.length === 3 ? 1 : 0)];
        res.faces.push({ orient: on, edge: e.i, az: e.az, len: e.len, mid, perBand: per });
      }
      const mids = res.faces.map((f) => f.mid);
      res.nFaces = res.faces.length;
      res.winter = avgScores(mids.map((f) => f.winter)); res.annual = avgScores(mids.map((f) => f.annual));
      res.byDate = {}; for (const k of KEYS) res.byDate[k[0]] = avgScores(mids.map((f) => f.byDate[k[0]]));
      res.best = res.faces.reduce((m, f) => (!m || f.mid.annual.score > m.mid.annual.score ? f : m), null);
      res.worst = res.faces.reduce((m, f) => (!m || f.mid.annual.score < m.mid.annual.score ? f : m), null);
      res.bandMeans = res.bands.map((bd) => ({ label: bd.label, floor: bd.floor, annual: mean(bd.faces.map((f) => f.annual), 'score'), winter: mean(bd.faces.map((f) => f.winter), 'score') }));
      return res;
    }
    // Unit (room): same as the facade score of that floor + orientation (position inside the floor is unknown: only floor + orientation are used).
    function scoreUnit(b, orient, floor, fh, cur) {
      fh = fh || 2.8; const N = floorsOf(b, fh); if (N < 1) return { ok: false, msg: '층을 정할 수 없습니다.' };
      if (floor > N) return { ok: false, msg: `${floor}층은 없습니다(최대 ${N}층).` };
      const e = edgeFor(b, orient); if (!e) return { ok: false, msg: '이 방향의 벽이 없습니다.' };
      return Object.assign({ ok: true, building: b, floors: N }, scoreFacade(b, e, Math.max(1, floor), fh, cur));
    }
    const GRADES = [[80, '매우 좋음'], [60, '좋음'], [40, '보통'], [20, '낮음'], [-1, '매우 낮음']];
    const gradeOf = (v) => { for (const g of GRADES) if (v >= g[0]) return g[1]; return GRADES[GRADES.length - 1][1]; };
    // Complex: mean of building scores (light mode) + min/max building. list = [{b, tier}] tier 'A' (확정) | 'B' (추정)
    function scoreComplexParts(items) {
      const rows = items.map((it) => { const r = scoreBuilding(it.b, { light: true }); return r.ok ? { b: it.b, tier: it.tier, winter: r.winter.score, annual: r.annual.score, dir: r.annual.dir, shade: r.annual.shade, best: r.best } : null; }).filter(Boolean);
      return rows;
    }
    function summarizeComplex(rows) {
      if (!rows.length) return { ok: false, msg: '점수를 낼 수 있는 소속 건물이 없습니다.' };
      const sorted = rows.slice().sort((a, c) => c.annual - a.annual);
      return { ok: true, n: rows.length, nA: rows.filter((r) => r.tier !== 'B').length, nB: rows.filter((r) => r.tier === 'B').length, annual: mean(rows, 'annual'), winter: mean(rows, 'winter'), dir: mean(rows, 'dir'), shade: mean(rows, 'shade'), min: sorted[sorted.length - 1], max: sorted[0], rows: sorted };
    }

    function query(q) {
      const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
      const b = q.index != null ? bs[q.index] : byId.get(q.id);
      if (!b) return { ok: false, msg: '건물을 찾지 못했습니다.' };
      const fh = Math.min(3.1, Math.max(2.7, q.floorH || 2.8)), N = floorsOf(b, fh), floor = Math.max(1, Math.round(q.floor || 1));
      const base = { ok: false, building: b, floors: N, floorH: fh, floor, assumed: !!b.assumed };
      if (N < 1) return Object.assign(base, { msg: `이 건물의 높이(${b.h || (b.z1 - b.z0).toFixed(1)} m)로는 층을 정할 수 없습니다.` });
      if (floor > N) return Object.assign(base, { msg: `${floor}층은 없습니다: 건물 높이 ${(b.z1 - b.z0).toFixed(1)} m${b.assumed ? '(추정 높이)' : ''} / 층고 ${fh} m → 최대 ${N}층.` });
      const out = [];
      if (q.edge != null) { const e = edgesOf(b).find((x) => x.i === q.edge); if (e) out.push(evalFacade(b, e, floor, fh, q.cur, true)); }
      else for (const on of (q.orient === 'all' || !q.orient ? ['S', 'E', 'W', 'N'] : [q.orient])) { const e = edgeFor(b, on); if (e) out.push(evalFacade(b, e, floor, fh, q.cur, true)); else out.push({ orient: on, missing: true }); }
      return Object.assign(base, { ok: true, facades: out, ms: (typeof performance !== 'undefined' ? performance : Date).now() - t0, msg: out.every((f) => f.missing) ? '선택한 방향의 벽이 없습니다.' : '' });
    }

    function insideBuilding(x, y) { const i = Math.floor((x - gx0) / CELL), j = Math.floor((y - gy0) / CELL); return i >= 0 && j >= 0 && i < gnx && j < gny && Hb[j * gnx + i] > -1e8; }
    // Live replacement of the old pre-computed per-building table: winter-solstice 09-15 reference (hours, longest run, meets) for 4 walls x 3 heights.
    function refTable(b) {
      const N = floorsOf(b, 2.8), fl = [1, Math.max(1, Math.round(N / 2)), Math.max(1, N)], out = {};
      for (const on of ['S', 'E', 'W', 'N']) { const e = edgeFor(b, on); out[on] = e ? fl.map((f) => { const r = evalDay(point(b, e, f, 2.8), 12, 21, b.idx, true); return { floor: f, tot: r.tot, wtot: r.wtot, wrun: r.wrun, meets: r.wrun >= REF.run - 1e-9 && r.wtot >= REF.total - 1e-9 }; }) : null; }
      return { floors: fl, faces: out };
    }
    function labelsList(extra) {   // autocomplete entries: [text, building index]
      const out = [];
      for (const b of bs) { if (b.ctx) continue; const base = label(b), cx = extra && extra[b.id]; out.push([cx ? `${cx} ${base}` : base, b.idx]); if (cx) out.push([base, b.idx]); }
      return out;
    }
    function find(text, extra) {   // exact label first, then substring
      const t = String(text || '').trim().replace(/\s+/g, ' '); if (!t) return [];
      const L = labelsList(extra), ex = L.filter((x) => x[0] === t), part = L.filter((x) => x[0].indexOf(t) >= 0);
      const num = /^(\d+)\s*동?$/.exec(t), nm = num ? L.filter((x) => x[0] === num[1] + '동' || x[0].endsWith(' ' + num[1] + '동')) : [];
      return [...new Set([...(ex.length ? ex : nm.length ? nm : part).map((x) => x[1])])].map((i) => bs[i]);
    }
    return { query, insideBuilding, refTable, lineSamples, scoreLine, litAt, scoreAnyPoint, terrainInfo, terrainNormal, scorePoint, scoreFacade, scoreBuilding, scoreUnit, scoreComplexParts, summarizeComplex, gradeOf, STEP_MIN, evalFacade, edgesOf, edgeFor, nearestEdge, floorsOf, find, labelsList, parseUnit, buildings: bs, byId, trace, samples, label, REF, KEYS, ORI_KO, grid: { nx: gnx, ny: gny }, point, rast: { Hb, Ib, gx0, gy0, nx: gnx, ny: gny, cell: CELL }, gh, terrainMax, bounds: B };
  }
  // ---- Ground sunshine map computed on demand (web worker or main thread): direct-sun hours of a horizontal surface 0.5 m above the ground for ONE date, over a grid.
  // o: { buildings, terrain: { x0, y0, nx, ny, dx, dy, h: Float32Array }, bounds, lat, lon, m, d, stepMin, area: { x0, y0, nx, ny, d }, above, terrainMax, calc }
  // value (image order, row 0 = north): round(lit hours x 10) (0..250), 255 = inside a building. job.step(ms) -> { done, progress }.
  function groundMapJob(o) {
    const T = o.terrain, bil = (x, y) => {
      const fx = (x - T.x0) / T.dx, fy = (y - T.y0) / T.dy, i = Math.max(0, Math.min(T.nx - 2, Math.floor(fx))), j = Math.max(0, Math.min(T.ny - 2, Math.floor(fy))), u = Math.max(0, Math.min(1, fx - i)), v = Math.max(0, Math.min(1, fy - j)), k = j * T.nx + i;
      return (T.h[k] * (1 - u) + T.h[k + 1] * u) * (1 - v) + (T.h[k + T.nx] * (1 - u) + T.h[k + T.nx + 1] * u) * v;
    };
    const Q = create({ buildings: o.buildings, getGroundHeight: bil, bounds: o.bounds, terrainMax: o.terrainMax, calc: o.calc, lat: o.lat, lon: o.lon });
    const sm = [], A = o.area, step = o.stepMin || 20, n = Math.round(1440 / step);
    for (let q = 0; q < n; q++) { const h = (q + 0.5) * step / 60, sp = o.calc.solarPosition(2026, o.m, o.d, h, o.lat, o.lon); if (sp.alt > 0) { const az = sp.az * D2R; sm.push({ ux: Math.sin(az), uy: Math.cos(az), t: Math.tan(sp.alt * D2R) }); } }
    const r0 = A.r0 || 0, r1 = A.r1 != null ? A.r1 : A.ny, vals = new Uint8Array((r1 - r0) * A.nx), total = (r1 - r0) * A.nx; let pos = 0;   // optional row band [r0, r1) so several workers can share one map
    return {
      vals, total, r0, r1, samples: sm.length, nBuildings: Q.buildings.length,
      step(ms) {
        const t0 = Date.now();
        while (pos < total && Date.now() - t0 < ms) {
          const rr = Math.floor(pos / A.nx), r = rr + r0, i = pos - rr * A.nx, x = A.x0 + (i + 0.5) * A.d, y = A.y0 + (A.ny - 1 - r + 0.5) * A.d;
          if (Q.insideBuilding(x, y)) vals[pos] = 255;
          else { const z = bil(x, y) + (o.above != null ? o.above : 0.5); let lit = 0; for (const s of sm) if (Q.trace(x, y, z, s, -1, 5) === null) lit++; vals[pos] = Math.min(250, Math.round(lit * step / 6)); }
          pos++;
        }
        return { done: pos >= total, progress: pos / total };
      },
    };
  }
  const GR = [[80, '매우 좋음'], [60, '좋음'], [40, '보통'], [20, '낮음']];
  const api = { create, groundMapJob, parseUnit, KEYS, ORI_KO, REF, gradeOf: (v) => { for (const g of GR) if (v >= g[0]) return g[1]; return '매우 낮음'; } };
  root.SunQuery = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
