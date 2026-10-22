/* 창가 시점 개선: 거실 창 시점(눈높이·화각·창틀) + 조망 요약(하늘 비율, 앞 건물, 지평선 고도, 물/녹지) + 층 비교.
 * 코어(sector / compare / pickEdge / skyColors / eyeZ / stepFloor)는 DOM 없이 node 에서 시험된다. 같은 가림 자료(SunQuery 의 2.5 m 높이 격자 + 지형 함수)를 쓴다.
 * 장면 좌표: x 동, y 북, z 위(m). 방위각은 북 0 시계방향. 설명용 모델 추정이며 법적 일조 판정이나 구매 권유가 아니다(docs/SUN.md).
 *   const W = WindowView.create(Q, { cover?: (x, y) => 0 | 1(물) | 2(녹지) });
 *   W.sector({ x, y, z, az, own, half = 60, n = 61, fh = 2.8, floor })  ->  조망 요약 객체
 */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180;
  const EYE = 1.4;                                   // 눈높이: 해당 층 슬래브 위 1.4 m (일조 점 평가는 1.2 m — 0.2 m 차이는 일조 시간에 영향이 없음)
  const ELEVS = [0, 5, 10, 15, 25, 40, 60];          // 고도각(도): 7개, 방위 61개와 곱해 427개 시선
  const DIRS8 = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
  const FOV0 = 75, FOV_MIN = 60, FOV_MAX = 95;
  const norm = (a) => ((a % 360) + 360) % 360;
  const dirName = (az) => DIRS8[Math.round(norm(az) / 45) % 8];
  const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const eyeZ = (b, floor, fh) => b.z0 + (floor - 1) * (fh || 2.8) + EYE;       // = z0 + 층*fh - fh + 1.4
  const stepFloor = (floor, d, N) => Math.min(Math.max(1, N | 0), Math.max(1, Math.round(floor + d)));
  const clampFov = (v) => Math.min(FOV_MAX, Math.max(FOV_MIN, Math.round(+v || FOV0)));
  const f0 = (v) => Math.round(v), f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

  // ---- 하늘 색: 태양 고도 -> 위/지평선 색 (이 모드에서만 쓰며 생활동선 색에는 닿지 않는다)
  const SKY = [   // [고도, 위, 지평선]
    [-18, [6, 10, 24], [13, 21, 48]], [-6, [11, 20, 48], [31, 42, 82]], [-1, [42, 53, 102], [224, 135, 90]],
    [4, [60, 94, 156], [240, 178, 122]], [12, [79, 134, 207], [207, 223, 240]], [30, [63, 134, 223], [188, 220, 247]],
  ];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const hex = (c) => '#' + c.map((v) => ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2)).join('');
  function skyColors(alt) {
    let lo = SKY[0], hi = SKY[SKY.length - 1];
    if (alt <= lo[0]) hi = lo; else if (alt >= hi[0]) lo = hi; else { for (let i = 0; i + 1 < SKY.length; i++) if (alt >= SKY[i][0] && alt <= SKY[i + 1][0]) { lo = SKY[i]; hi = SKY[i + 1]; break; } }
    const t = hi === lo ? 0 : (alt - lo[0]) / (hi[0] - lo[0]), top = mix(lo[1], hi[1], t), hor = mix(lo[2], hi[2], t);
    return { top: hex(top), hor: hex(hor), fog: hex(hor), topRGB: top, horRGB: hor };
  }

  // ---- 방위 -> 가장 알맞은 외벽: 30도 안에서 가장 긴 벽, 없으면 각도 차가 가장 작은 벽. diff > 45 이면 호출한 쪽이 알린다.
  function pickEdge(edges, az) {
    let best = null, bs = -1e18;
    for (const e of edges) {
      const d = angDiff(e.az, az), s = d <= 30 ? 1000 + e.len : -d + Math.min(e.len, 20) * 0.01;
      if (s > bs) { bs = s; best = e; }
    }
    return best ? { edge: best, diff: angDiff(best.az, az) } : null;
  }

  function create(Q, opt) {
    opt = opt || {};
    const R = Q.rast, gh = Q.gh || (() => 0), bs = Q.buildings, cover = opt.cover || null;
    let topMax = Q.terrainMax != null ? Q.terrainMax : 300; for (const b of bs) if (b.z1 > topMax) topMax = b.z1;
    function ownHit(b, x, y, ux, uy) {                // 자기 건물의 실제 윤곽선과 시선의 첫 교점(날개동·중정 등), 없으면 0
      const r = b.ring, n = r.length; let best = Infinity;
      for (let k = 0; k < n; k++) {
        const a = r[k], c = r[(k + 1) % n], ex = c[0] - a[0], ey = c[1] - a[1], den = ux * ey - uy * ex; if (Math.abs(den) < 1e-9) continue;
        const dx = a[0] - x, dy = a[1] - y, d = (dx * ey - dy * ex) / den, t = (dx * uy - dy * ux) / den;
        if (d > 0.3 && t >= 0 && t <= 1 && d < best) best = d;
      }
      return best < Infinity ? best : 0;
    }
    function sector(p) {
      const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
      const half = p.half != null ? p.half : 60, n = p.n || 61, fh = p.fh || 2.8, x = p.x, y = p.y, z = p.z, dmax = p.dmax || 6000, wmax = p.wmax || 3000;
      const own = p.own != null && p.own >= 0 ? bs[p.own] : null, step = n > 1 ? 2 * half / (n - 1) : 0;
      const tans = ELEVS.map((e) => Math.tan(e * D2R));
      let sky = 0, tBest = -1e9, tAz = 0, tDist = 0, aBest = -1e9, aAz = 0, nb = Infinity, nbIdx = -1, blocked = 0, wNear = Infinity, gNear = Infinity, wCnt = 0, gCnt = 0;
      const firstB = new Int32Array(n).fill(-1), firstD = new Float64Array(n);
      let nv = 0;      // 벽 바깥쪽 반공간(법선에서 88도 이내)의 시선만 센다: 벽에서 비스듬히 본 시선이 자기 건물 속으로 들어가는 것을 막는다
      for (let k = 0; k < n; k++) {
        const az = p.az - half + k * step; if (p.clipAz != null && angDiff(az, p.clipAz) > 88) continue; nv++;
        const ux = Math.sin(az * D2R), uy = Math.cos(az * D2R);
        let mS = -1e9, tS = -1e9, tD = 0, fb = -1, fd = 0, wD = Infinity, gD = Infinity;
        const od = own ? ownHit(own, x, y, ux, uy) : 0, os = od ? (own.z1 - z) / od : 0; let oDone = !od;
        for (let d = 2.5; d <= dmax;) {
          if (!oDone && d >= od) { oDone = true; if (os > mS) mS = os; if (own.z1 > z && fb < 0) { fb = own.idx; fd = od; } }
          const px = x + ux * d, py = y + uy * d, g = gh(px, py), sg = (g - z) / d;
          if (cover && d <= wmax) { const c = cover(px, py); if (c && sg >= mS - 1e-6) { if (c === 1) { if (d < wD) wD = d; } else if (d < gD) gD = d; } }
          if (sg > tS) { tS = sg; tD = d; } if (sg > mS) mS = sg;
          const i = Math.floor((px - R.gx0) / R.cell), j = Math.floor((py - R.gy0) / R.cell);
          if (i >= 0 && j >= 0 && i < R.nx && j < R.ny) {
            const q = j * R.nx + i, h = R.Hb[q];
            if (h > -1e8) { const id = R.Ib[q]; if (!own || id !== own.idx) { const sb = (h - z) / d; if (sb > mS) mS = sb; if (h > z && fb < 0) { fb = id; fd = d; } } }
          }
          if ((!cover || d > wmax) && (topMax - z) / d <= mS) break;
          d += d < 400 ? R.cell : Math.max(5, d * 0.02);
        }
        if (!oDone && os > mS) { mS = os; if (own.z1 > z && fb < 0) { fb = own.idx; fd = od; } }
        for (const t of tans) if (t > mS) sky++;
        if (tS > tBest) { tBest = tS; tAz = az; tDist = tD; } if (mS > aBest) { aBest = mS; aAz = az; }
        firstB[k] = fb; firstD[k] = fd; if (fb >= 0) { blocked++; if (fd < nb) { nb = fd; nbIdx = fb; } }
        if (wD < Infinity) { wCnt++; if (wD < wNear) wNear = wD; } if (gD < Infinity) { gCnt++; if (gD < gNear) gNear = gD; }
      }
      const nn = Math.max(1, nv), skyShare = sky / (nn * ELEVS.length), out = { ok: nv > 0, az: p.az, half, n, nValid: nv, nRays: nv * ELEVS.length, z, skyShare, skyPct: 100 * skyShare, blockedPct: 100 * blocked / nn };
      if (nbIdx >= 0) {
        const b = bs[nbIdx]; let cnt = 0; for (let k = 0; k < n; k++) if (firstB[k] === nbIdx) cnt++;
        const bf = Q.floorsOf(b, fh), fl = p.floor || 1;
        out.front = { idx: nbIdx, id: b.id, name: Q.label(b), dist: nb, h: b.z1 - b.z0, floors: bf, ratio: bf / Math.max(1, fl), above: b.z1 - z, elev: Math.atan((b.z1 - z) / nb) / D2R, widthDeg: cnt * step, assumed: !!b.assumed };
      } else out.front = null;
      out.horizon = { terrainDeg: Math.atan(tBest) / D2R, terrainAz: norm(tAz), terrainDist: tDist, allDeg: Math.atan(aBest) / D2R, allAz: norm(aAz) };
      out.water = { visible: wCnt > 0, dist: wNear < Infinity ? wNear : null, share: 100 * wCnt / nn };
      out.green = { visible: gCnt > 0, dist: gNear < Infinity ? gNear : null, share: 100 * gCnt / n };
      const dF = out.front ? Math.min(1, out.front.dist / 100) : 1;
      out.openScore = Math.round(100 * (0.7 * skyShare + 0.3 * dF));      // 참고용: 하늘 비율 70 % + 앞 건물 거리(100 m 이상이면 만점) 30 %
      out.grade = skyShare >= 0.85 && (!out.front || out.front.dist >= 100) ? '시야 트임' : skyShare >= 0.55 ? '보통' : '가림';
      out.ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
      return out;
    }
    // 같은 자리(벽)에서 층만 바꿔 비교: [{ floor, sky, front, blockedPct, score }]  (score = 일조 점수 연평균, 건물·벽을 알 때)
    function compare(c) {
      const b = bs[c.idx], e = c.edge != null ? Q.edgesOf(b).find((q) => q.i === c.edge) : null, fh = c.fh || 2.8, rows = [];
      for (const fl of c.floors) {
        const z = eyeZ(b, fl, fh), s = sector({ x: c.x, y: c.y, z, az: c.az, own: c.idx, fh, floor: fl, half: c.half, n: c.n, clipAz: c.clipAz });
        let score = null; if (c.withScore !== false && e && Q.scoreFacade) { const r = Q.scoreFacade(b, e, fl, fh); score = r && r.annual ? r.annual.score : null; }
        rows.push({ floor: fl, skyPct: s.skyPct, frontDist: s.front ? s.front.dist : null, blockedPct: s.blockedPct, score, openScore: s.openScore });
      }
      return rows;
    }
    function compareFloors(N) {      // 3/10/20/30 중 존재하는 층 + 꼭대기 층 (+ 현재 층은 호출한 쪽이 더한다)
      const L = [3, 10, 20, 30].filter((f) => f <= N); if (N >= 1 && L.indexOf(N) < 0) L.push(N); if (!L.length && N >= 1) L.push(1); return L;
    }
    return { sector, compare, compareFloors, pickEdge: (b, az) => pickEdge(Q.edgesOf(b), az) };
  }

  // ---- 녹지/물 덮개 격자(조망용): 폴리곤(kind 'water'|'park') + 지형 격자의 물 칸 -> Uint8 (1 물, 2 녹지)
  function coverRaster(o) {     // o: { x0, y0, x1, y1, res, polys: [{ kind, ring: [[x, y]...] }], cells: [[x, y, half]...] }
    const res = o.res || 10, nx = Math.max(1, Math.ceil((o.x1 - o.x0) / res)), ny = Math.max(1, Math.ceil((o.y1 - o.y0) / res)), g = new Uint8Array(nx * ny);
    for (const P of o.polys || []) {
      const v = P.kind === 'water' ? 1 : P.kind === 'park' ? 2 : 0; if (!v) continue; const r = P.ring; if (!r || r.length < 3) continue;
      let ymin = 1e18, ymax = -1e18; for (const q of r) { ymin = Math.min(ymin, q[1]); ymax = Math.max(ymax, q[1]); }
      const j0 = Math.max(0, Math.floor((ymin - o.y0) / res)), j1 = Math.min(ny - 1, Math.floor((ymax - o.y0) / res));
      for (let j = j0; j <= j1; j++) {
        const y = o.y0 + (j + 0.5) * res, xs = [];
        for (let k = 0, n = r.length; k < n; k++) { const a = r[k], c = r[(k + 1) % n]; if ((a[1] > y) !== (c[1] > y)) xs.push(a[0] + (y - a[1]) * (c[0] - a[0]) / (c[1] - a[1])); }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) { const ia = Math.max(0, Math.ceil((xs[k] - o.x0) / res - 0.5)), ib = Math.min(nx - 1, Math.floor((xs[k + 1] - o.x0) / res - 0.5)); for (let i = ia; i <= ib; i++) { const q = j * nx + i; if (v === 1 || !g[q]) g[q] = v; } }
      }
    }
    for (const c of o.cells || []) {     // 물 칸(중심 x, y, 반폭)
      const i0 = Math.max(0, Math.floor((c[0] - c[2] - o.x0) / res)), i1 = Math.min(nx - 1, Math.floor((c[0] + c[2] - o.x0) / res)), j0 = Math.max(0, Math.floor((c[1] - c[2] - o.y0) / res)), j1 = Math.min(ny - 1, Math.floor((c[1] + c[2] - o.y0) / res));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) g[j * nx + i] = 1;
    }
    return (x, y) => { const i = Math.floor((x - o.x0) / res), j = Math.floor((y - o.y0) / res); return i < 0 || j < 0 || i >= nx || j >= ny ? 0 : g[j * nx + i]; };
  }

  // =========================================================== 화면(DOM): 조망 요약 카드, 창틀, 방향/층/화각 조작
  function attach(inst, o) {
    if (typeof document === 'undefined') return null;
    o = o || {}; const doc = document, Qf = () => inst.getQ();
    let W = null, cur = null, card = null, frame = null, openBtn = null, fov = FOV0, frameOn = true, closed = false, cvr = null, lastDoy = null;
    const store = { get(k, d) { try { const v = localStorage.getItem('fm-wv:' + k); return v == null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('fm-wv:' + k, String(v)); } catch (e) { /* ignore */ } } };
    fov = clampFov(store.get('fov', FOV0)); frameOn = store.get('frame', '1') !== '0';
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    function ensure() {
      if (card) return;
      frame = doc.createElement('div'); frame.id = 'wvFrame'; frame.setAttribute('aria-hidden', 'true'); frame.innerHTML = '<i class="wv-mv"></i><i class="wv-mh"></i>'; doc.body.appendChild(frame);
      card = doc.createElement('div'); card.id = 'wvCard'; card.setAttribute('role', 'region'); card.setAttribute('aria-label', '조망 요약');
      card.innerHTML = '<div class="wv-hd"><b>조망 요약</b><span class="wv-sub"></span><button type="button" class="wv-m" aria-label="접기/펼치기" title="접기/펼치기">▾</button><button type="button" class="wv-x" aria-label="조망 요약 닫기">×</button></div><div class="wv-brief"></div><div class="wv-bd">' +
        '<div class="wv-row"><span class="wv-lb">층</span><button type="button" class="wv-b" data-fl="-1" aria-label="한 층 아래">▼</button><b class="wv-fl"></b><button type="button" class="wv-b" data-fl="1" aria-label="한 층 위">▲</button><span class="wv-mut wv-fmax"></span></div>' +
        '<div class="wv-row wv-dirs"><span class="wv-lb">방향</span>' + DIRS8.map((n, i) => `<button type="button" class="wv-b wv-d" data-az="${i * 45}">${n}</button>`).join('') + '</div>' +
        '<div class="wv-row"><span class="wv-lb">내 거실 방위</span><input class="wv-az" type="number" min="0" max="359" step="5" inputmode="numeric" aria-label="거실이 향한 방위(도)"><span class="wv-mut">°</span><button type="button" class="wv-b wv-go">보기</button></div>' +
        '<div class="wv-row"><span class="wv-lb">화각</span><input class="wv-fov" type="range" min="' + FOV_MIN + '" max="' + FOV_MAX + '" step="1" aria-label="화각"><output class="wv-fv"></output><label class="wv-chk"><input class="wv-frame" type="checkbox"> 창틀 보기</label></div>' +
        '<div class="wv-sum" aria-live="polite"></div><div class="wv-cmpw"></div><div class="wv-note"></div></div>';
      doc.body.appendChild(card);
      const winBar = doc.getElementById('winBar'), ex = doc.getElementById('winExit');
      if (winBar) { openBtn = doc.createElement('button'); openBtn.type = 'button'; openBtn.className = 'btn'; openBtn.id = 'wvOpen'; openBtn.textContent = '조망 요약'; openBtn.style.display = 'none'; winBar.insertBefore(openBtn, ex || null); openBtn.addEventListener('click', () => { closed = false; paint(); }); }
      card.querySelector('.wv-x').addEventListener('click', () => { closed = true; paint(); });
      card.querySelector('.wv-m').addEventListener('click', () => { card.classList.toggle('wv-min'); card.querySelector('.wv-m').textContent = card.classList.contains('wv-min') ? '▴' : '▾'; });
      card.addEventListener('click', (e) => {
        const t = e.target.closest && e.target.closest('button'); if (!t || !cur) return;
        if (t.dataset.fl) go({ floor: stepFloor(cur.floor, +t.dataset.fl, cur.floors) });
        else if (t.dataset.az != null) go({ az: +t.dataset.az, edge: null });
        else if (t.classList.contains('wv-go')) applyAz();
        else if (t.dataset.cf) go({ floor: +t.dataset.cf });
      });
      const azi = card.querySelector('.wv-az'); azi.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyAz(); e.stopPropagation(); }); azi.addEventListener('keyup', (e) => e.stopPropagation());
      const fi = card.querySelector('.wv-fov'); fi.addEventListener('input', () => { setFov(+fi.value); });
      card.querySelector('.wv-frame').addEventListener('change', (e) => { frameOn = e.target.checked; store.set('frame', frameOn ? 1 : 0); paintFrame(); });
      if (root.FMDrag) root.FMDrag.attach(card, card.querySelector('.wv-hd'), 'wvcard', { sheet: true });
    }
    function applyAz() { const v = parseFloat(card.querySelector('.wv-az').value); if (isFinite(v)) go({ az: norm(v), edge: null }); }
    function setFov(v) { fov = clampFov(v); store.set('fov', fov); const fi = card && card.querySelector('.wv-fov'); if (fi) fi.value = fov; const fv = card && card.querySelector('.wv-fv'); if (fv) fv.textContent = fov + '°'; if (o.onFov) o.onFov(fov); }
    function go(ch) {         // 층·방향을 바꿔 같은 모드에서 다시 본다 (카메라·일조 칩·요약 모두 갱신)
      if (!cur) return; const f = ch.floor != null ? ch.floor : cur.floor, az = ch.az != null ? ch.az : cur.az, edge = ch.az != null ? null : cur.edge;
      if (f === cur.floor && ch.az == null) return; inst.windowView(cur.id, f, edge, null, az);
    }
    function paintFrame() { if (frame) frame.style.display = cur && frameOn ? 'block' : 'none'; if (doc.body) doc.body.classList.toggle('fm-wv-frame', !!(cur && frameOn)); }
    function paint() {
      if (!card) return;
      card.style.display = cur && !closed ? 'block' : 'none'; if (openBtn) openBtn.style.display = cur && closed ? '' : 'none'; paintFrame();
    }
    function sumHTML(s, w) {
      const fr = s.front, hz = s.horizon, h = [];
      h.push(`<div class="wv-g wv-g-${s.grade === '시야 트임' ? 'a' : s.grade === '보통' ? 'b' : 'c'}"><b>${s.grade}</b> <span class="wv-mut">(설명용 · 판정 아님)</span></div>`);
      h.push(`<div>하늘 비율 <b>${f0(s.skyPct)}%</b> <span class="wv-mut">(시야각 ±${s.half}° × 고도 0–60° 시선 ${s.nRays}개 중 하늘에 닿는 비율)</span></div>`);
      h.push(fr ? `<div>가장 가까운 앞 건물 <b>${f0(fr.dist)} m</b>: ${esc(fr.name)}, ${f0(fr.h)} m${fr.assumed ? '(추정)' : ''} · 약 ${fr.floors}층(내 층의 ${fr.ratio.toFixed(1)}배), 눈높이보다 ${f0(fr.above)} m 높음, 가리는 폭 약 ${f0(fr.widthDeg)}° · 시야 ${f0(s.blockedPct)}% 방위에 눈높이 이상 건물</div>` : '<div>눈높이보다 높은 앞 건물 <b>없음</b> (이 시야각 안)</div>');
      h.push(hz.terrainDeg > 0.5 ? `<div>지평선: ${dirName(hz.terrainAz)}쪽 지형이 눈높이(수평) 위 <b>${f1(hz.terrainDeg)}°</b>까지 (약 ${(hz.terrainDist / 1000).toFixed(1)} km)</div>` : `<div>지평선: 지형은 눈높이 아래(최고 ${f1(hz.terrainDeg)}°) — 먼 능선이 하늘을 가리지 않음</div>`);
      if (hz.allDeg > hz.terrainDeg + 0.5) h.push(`<div class="wv-mut">건물 포함 가장 높은 가림 ${dirName(hz.allAz)}쪽 ${f1(hz.allDeg)}°</div>`);
      h.push(`<div>물(하천·호수) ${s.water.visible ? `<b>보임</b> · 가장 가까운 곳 약 ${s.water.dist >= 1000 ? (s.water.dist / 1000).toFixed(1) + ' km' : f0(s.water.dist) + ' m'} (시야각의 ${f0(s.water.share)}%)` : '<b>안 보임</b> (3 km 안)'}${cvr ? '' : ' <span class="wv-mut">(자료 없음)</span>'}</div>`);
      h.push(`<div>공원·녹지 ${s.green.visible ? `<b>보임</b> · 약 ${s.green.dist >= 1000 ? (s.green.dist / 1000).toFixed(1) + ' km' : f0(s.green.dist) + ' m'}` : '안 보임'}</div>`);
      h.push(`<div class="wv-mut">시야 개방도 점수 ${s.openScore}/100 <span title="하늘 비율 70% + 앞 건물 거리(100 m 이상 만점) 30%">(참고용)</span></div>`);
      return h.join('');
    }
    function cmpHTML(w, rows) {
      let h = '<table class="wv-cmp"><caption>다른 층 비교 (같은 벽·같은 방위)</caption><thead><tr><th>층</th><th>하늘 비율</th><th>앞 건물(거리·가린 방위)</th><th>일조 점수</th></tr></thead><tbody>';
      for (const r of rows) h += `<tr class="${r.floor === w.floor ? 'cur' : ''}"><td><button type="button" class="wv-lk" data-cf="${r.floor}">${r.floor}층</button></td><td>${f0(r.skyPct)}%</td><td>${r.frontDist == null ? '없음' : f0(r.frontDist) + ' m · ' + f0(r.blockedPct) + '%'}</td><td>${r.score == null ? '–' : f0(r.score)}</td></tr>`;
      return h + '</tbody></table>';
    }
    function show(w) {
      const Q = Qf(); if (!Q || !w || w.idx == null) return; ensure();
      if (!W) W = create(Q, { cover: getCover() });
      const wasNew = !cur; cur = { id: w.id, idx: w.idx, floor: w.floor, floors: w.floors, fh: w.floorH || 2.8, az: w.az, edge: w.edge, edgeAz: w.edgeAz, x: w.pt.x, y: w.pt.y, z: w.eyeZ };
      if (wasNew) { closed = false; if (matchMedia && matchMedia('(max-width:720px),(max-height:620px)').matches) { card.classList.add('wv-min'); card.querySelector('.wv-m').textContent = '▴'; } setFov(fov); card.querySelector('.wv-frame').checked = frameOn; }
      const s = W.sector({ x: cur.x, y: cur.y, z: cur.z, az: cur.az, own: cur.idx, fh: cur.fh, floor: cur.floor, clipAz: cur.edgeAz });
      const fl = W.compareFloors(cur.floors); if (fl.indexOf(cur.floor) < 0) { fl.push(cur.floor); fl.sort((a, b) => a - b); }
      const rows = W.compare({ idx: cur.idx, edge: cur.edge, x: cur.x, y: cur.y, az: cur.az, fh: cur.fh, floors: fl, clipAz: cur.edgeAz });
      card.querySelector('.wv-sub').textContent = `${w.label} · ${w.floor}층 · ${f0(cur.az)}° ${dirName(cur.az)}`;
      card.querySelector('.wv-fl').textContent = cur.floor + '층'; card.querySelector('.wv-fmax').textContent = '/ 최고 ' + cur.floors + '층 · 눈높이 지상 ' + f1(cur.z - Q.buildings[cur.idx].z0) + ' m';
      const up = card.querySelector('[data-fl="1"]'), dn = card.querySelector('[data-fl="-1"]'); up.disabled = cur.floor >= cur.floors; dn.disabled = cur.floor <= 1;
      card.querySelectorAll('.wv-d').forEach((b) => b.classList.toggle('on', Math.abs(angDiff(+b.dataset.az, cur.az)) < 0.5));
      card.querySelector('.wv-az').value = f0(cur.az);
      card.querySelector('.wv-brief').innerHTML = `<b class="wv-g-${s.grade === '시야 트임' ? 'a' : s.grade === '보통' ? 'b' : 'c'}">${s.grade}</b> · 하늘 ${f0(s.skyPct)}% · ${s.front ? '앞 건물 ' + f0(s.front.dist) + ' m' : '앞 건물 없음'} · 지평선 ${f1(s.horizon.terrainDeg)}°`;
      card.querySelector('.wv-sum').innerHTML = sumHTML(s, w); card.querySelector('.wv-cmpw').innerHTML = cmpHTML(cur, rows);
      card.querySelector('.wv-note').innerHTML = (w.edgeDiff > 45 ? `<b>이 방향에는 외벽이 없어 가장 가까운 벽(${f0(w.edgeAz)}°)에서 봅니다.</b> ` : '') + '모델 추정: 건물 높이 일부는 추정, 나무·실내·창 크기·발코니는 반영하지 않음. 지형은 건설 이전 SRTM급. 설명용이며 법적 일조·조망 판정이 아닙니다.';
      lastDoy = inst.state ? inst.state.doy : null; w.view = s; paint();
    }
    function getCover() { if (cvr !== null) return cvr || null; try { cvr = (o.getCover && o.getCover()) || false; } catch (e) { cvr = false; } return cvr || null; }
    function hide() { cur = null; closed = false; if (card) card.style.display = 'none'; if (openBtn) openBtn.style.display = 'none'; paintFrame(); }
    function onRefresh() { if (!cur) return; const d = inst.state ? inst.state.doy : null; if (d !== lastDoy) { lastDoy = d; inst.windowView(cur.id, cur.floor, cur.edge, null, cur.az); } }
    return { show, hide, onRefresh, setFov, get active() { return !!cur; }, get fov() { return fov; } };
  }

  const api = { create, attach, coverRaster, skyColors, pickEdge, eyeZ, stepFloor, clampFov, dirName, angDiff, EYE, ELEVS, DIRS8, FOV0, FOV_MIN, FOV_MAX };
  root.WindowView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
