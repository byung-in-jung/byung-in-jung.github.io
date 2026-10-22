/* 일조·그림자 add-on for three.js viewers  (flowmap/sun_addon/sun.js, docs/SUN.md)
 *
 *   SunAddon.init({THREE, scene, camera, renderer, terrainMesh, buildingMeshes, getGroundHeight, bounds, lat, lon, data, ...})
 *
 * Scene coordinates (the viewers' convention): metres x = east, y = north, z = up; three.js position = (x, z, -y).
 * Everything is descriptive: OSM footprints, estimated/OSM heights, SRTM-class terrain, no trees/balconies/eaves.
 * Not a legal sunshine (일조권) assessment and not a purchase recommendation.
 */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const NOTE = '일조는 모델 추정이며 실측·법적 판정이 아닙니다(참고용 계산, 구매·투자 권유 아님). 호(號)는 층만 반영합니다(방향 정보 없음). OSM 건물 윤곽과 추정/OSM 높이, 건설 이전 SRTM급 지형(산 그림자는 근사), 나무·발코니·처마는 반영하지 않았습니다.';
  const REF_TXT = '참고 기준(동지 9~15시 연속 2시간 또는 총 4시간) · 참고 기준, 법적 판정 아님';
  const YEAR = new Date().getFullYear();   // the panel works in the client's current calendar year (presets = that day of this year)
  const SITE_TZ = 9, KST_MIN = SITE_TZ * 60;   // the sites are in Korea: the sun is computed from the real instant at the site, KST only labels the site's wall clock
  // playback: 1x = a whole day in 60 s (24 simulated min per real second); a whole year in 120 s (365/120 days per real second). Speed multiplies both.
  const RATE_DAY_MIN_PER_S = 24, RATE_YEAR_DAYS_PER_S = 365 / 120, SPEEDS = [0.25, 0.5, 1, 2, 4], SHADOW_FPS = 10;

  // ------------------------------------------------------------------------------------------ solar position (NOAA / Meeus), mirrors flowmap/sun_calc.py
  function julianDay(y, m, d, hour) {
    if (m <= 2) { y -= 1; m += 12; }
    const a = Math.floor(y / 100), b = 2 - a + Math.floor(a / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5 + hour / 24;
  }
  function sunParams(jc) {
    const l0 = (((280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360) + 360) % 360;
    const m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc), e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc), mr = m * D2R;
    const c = Math.sin(mr) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + Math.sin(2 * mr) * (0.019993 - 0.000101 * jc) + Math.sin(3 * mr) * 0.000289;
    const om = 125.04 - 1934.136 * jc, app = l0 + c - 0.00569 - 0.00478 * Math.sin(om * D2R);
    const sec = 21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813)), obl = 23 + (26 + sec / 60) / 60 + 0.00256 * Math.cos(om * D2R);
    const dec = Math.asin(Math.sin(obl * D2R) * Math.sin(app * D2R)) * R2D, y = Math.tan(obl * D2R / 2) ** 2, l0r = l0 * D2R;
    const eot = 4 * R2D * (y * Math.sin(2 * l0r) - 2 * e * Math.sin(mr) + 4 * e * y * Math.sin(mr) * Math.cos(2 * l0r) - 0.5 * y * y * Math.sin(4 * l0r) - 1.25 * e * e * Math.sin(2 * mr));
    return [dec, eot];
  }
  const LAT0 = 36.5, LON0 = 127.27, TZ = 9;
  function solarPosition(year, month, day, hour, lat = LAT0, lon = LON0, tz = TZ) {
    const jc = (julianDay(year, month, day, hour - tz) - 2451545) / 36525, [dec, eot] = sunParams(jc);
    const tst = ((hour * 60 + eot + 4 * lon - 60 * tz) % 1440 + 1440) % 1440;
    let ha = tst / 4 - 180; if (ha < -180) ha += 360;
    const la = lat * D2R, de = dec * D2R, h = ha * D2R;
    const cz = clamp(Math.sin(la) * Math.sin(de) + Math.cos(la) * Math.cos(de) * Math.cos(h), -1, 1), zen = Math.acos(cz) * R2D, sz = Math.sin(zen * D2R);
    let az = 180;
    if (sz > 1e-9) { const ca = clamp((Math.sin(la) * cz - Math.sin(de)) / (Math.cos(la) * sz), -1, 1), a = Math.acos(ca) * R2D; az = ha > 0 ? (a + 180) % 360 : (540 - a) % 360; }
    return { alt: 90 - zen, az };
  }
  function dayEvents(year, month, day, lat = LAT0, lon = LON0, tz = TZ) {
    const jc = (julianDay(year, month, day, 12 - tz) - 2451545) / 36525, [dec, eot] = sunParams(jc), noon = (720 - 4 * lon - eot + tz * 60) / 60;
    const la = lat * D2R, de = dec * D2R, ch = Math.cos(90.833 * D2R) / (Math.cos(la) * Math.cos(de)) - Math.tan(la) * Math.tan(de);
    if (ch > 1 || ch < -1) return { sunrise: null, sunset: null, noon, dayLength: ch > 1 ? 0 : 24, noonAlt: 90 - Math.abs(lat - dec), dec };
    const ha = Math.acos(ch) * R2D, rise = noon - ha * 4 / 60, set = noon + ha * 4 / 60;
    return { sunrise: rise, sunset: set, noon, dayLength: set - rise, noonAlt: 90 - Math.abs(lat - dec), dec };
  }
  function sunVector(alt, az) { const a = alt * D2R, z = az * D2R; return [Math.cos(a) * Math.sin(z), Math.cos(a) * Math.cos(z), Math.sin(a)]; }   // east, north, up
  const dateFromDoy = (doy) => { const d = new Date(Date.UTC(YEAR, 0, doy)); return { month: d.getUTCMonth() + 1, day: d.getUTCDate() }; };
  const doyFromDate = (m, d) => Math.round((Date.UTC(YEAR, m - 1, d) - Date.UTC(YEAR, 0, 1)) / 864e5) + 1;
  const daysInYear = () => doyFromDate(12, 31);
  /** client wall-clock (doy of YEAR, minutes since local midnight) -> Date (real instant; wall-clock semantics, DST-safe) */
  const localInstant = (doy, min) => { const d = dateFromDoy(doy); return new Date(YEAR, d.month - 1, d.day, 0, Math.floor(min), Math.round((min % 1) * 60)); };
  /** instant (ms) -> the site's (KST) wall clock: {y,m,d,hour,min,doy} */
  const kstParts = (ms) => { const k = new Date(ms + KST_MIN * 60000), y = k.getUTCFullYear(), m = k.getUTCMonth() + 1, d = k.getUTCDate(), hour = k.getUTCHours() + k.getUTCMinutes() / 60 + k.getUTCSeconds() / 3600; return { y, m, d, hour, min: hour * 60, doy: Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5) + 1 }; };
  /** client "now" rounded to the nearest 10 min -> {doy, min} in the client's own calendar/clock */
  function nowState(date) {
    let d = date || new Date(); d = new Date(Math.round(d.getTime() / 600000) * 600000);   // 10-min grid (zone offsets are multiples of 15 min, so the local grid is the same)
    const doy = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 1)) / 864e5) + 1;
    return { year: d.getFullYear(), doy, min: d.getHours() * 60 + d.getMinutes() };
  }
  /** client time zone: offset (min east of UTC), short label ('KST', 'GMT+9', 'EDT'...) and IANA id */
  function tzInfo(date) {
    date = date || new Date(); const off = 0 - date.getTimezoneOffset() || 0; let name = '', id = '';
    try { const pp = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(date).find((x) => x.type === 'timeZoneName'); name = pp ? pp.value : ''; } catch (e) { /* no Intl */ }
    try { id = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* no Intl */ }
    if (off === KST_MIN && (id === 'Asia/Seoul' || !id || /KST|GMT\+9/.test(name))) name = 'KST';
    if (!name) name = 'UTC' + (off >= 0 ? '+' : '-') + Math.floor(Math.abs(off) / 60) + (Math.abs(off) % 60 ? ':' + String(Math.abs(off) % 60).padStart(2, '0') : '');
    return { off, name, id };
  }
  /** playback maths (pure; unit-tested). dt in real seconds, speed multiplier. */
  const advanceDay = (min, dt, speed) => min + RATE_DAY_MIN_PER_S * speed * dt;
  const advanceYear = (doyF, dt, speed) => doyF + RATE_YEAR_DAYS_PER_S * speed * dt;
  const hhmm = (h) => { if (h == null) return '--:--'; let m = Math.round(h * 60); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const compass = (az) => ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'][Math.round(az / 22.5) % 16];

  // ------------------------------------------------------------------------------------------ colour ramp: hours of direct sun (blue = little, yellow = lots)
  const RAMP = [[0, [31, 42, 110]], [0.25, [63, 111, 181]], [0.5, [159, 185, 198]], [0.75, [242, 221, 122]], [1, [255, 196, 0]]];
  function rampRGB(t) {
    t = clamp(t, 0, 1);
    for (let i = 1; i < RAMP.length; i++) if (t <= RAMP[i][0]) { const a = RAMP[i - 1], b = RAMP[i], u = (t - a[0]) / (b[0] - a[0]); return [lerp(a[1][0], b[1][0], u), lerp(a[1][1], b[1][1], u), lerp(a[1][2], b[1][2], u)]; }
    return RAMP[RAMP.length - 1][1];
  }
  const rampCSS = () => 'linear-gradient(90deg,' + RAMP.map(([t, c]) => `rgb(${c[0]},${c[1]},${c[2]}) ${t * 100}%`).join(',') + ')';

  // ------------------------------------------------------------------------------------------ PNG -> Uint8Array (hours*10), via canvas

  const api = { version: 2, calc: { solarPosition, dayEvents, sunVector, julianDay, doyFromDate, dateFromDoy }, time: { YEAR, daysInYear, localInstant, kstParts, nowState, tzInfo, advanceDay, advanceYear, RATE_DAY_MIN_PER_S, RATE_YEAR_DAYS_PER_S, SPEEDS, SHADOW_FPS }, rampRGB, NOTE, REF_TXT };
  api.init = function init(o) {
    const THREE = o.THREE, scene = o.scene, camera = o.camera, renderer = o.renderer, terrain = o.terrainMesh;
    const bmeshes = o.buildingMeshes || [], gh = o.getGroundHeight || (() => 0);
    const data = o.data || null, lat = o.lat != null ? o.lat : (data && data.lat) || LAT0, lon = o.lon != null ? o.lon : (data && data.lon) || LON0;
    const B = o.bounds || [-500, -500, 500, 500];
    const P3 = (x, y, z) => new THREE.Vector3(x, z, -y);
    const N0 = nowState(), S = { open: o.startOpen !== false, doy: N0.doy, min: N0.min, speed: 1, loop: false, paused: false, doyF: 0, kd: { month: 12, day: 21 }, kdoy: 355, kmin: 750, shadow: false, overlay: false, ovKey: '1221', bcolor: false, playing: null, sel: null, rasters: {}, ovMesh: null, folded: false };
    try { const j = JSON.parse(localStorage.getItem('sun-addon') || '{}'); if (typeof j.open === 'boolean' && o.persistOpen !== false) S.open = j.open; if (SPEEDS.includes(j.speed)) S.speed = j.speed; if (typeof j.loop === 'boolean') S.loop = j.loop; } catch (e) { /* storage may be blocked */ }
    const save = () => { try { localStorage.setItem('sun-addon', JSON.stringify({ open: S.open, speed: S.speed, loop: S.loop })); } catch (e) { /* ignore */ } };

    // ---------------------------------------------------------------------------------------- UI
    if (!document.getElementById('sun-addon-css') && (o.css || root.SUN_CSS)) { const st = document.createElement('style'); st.id = 'sun-addon-css'; st.textContent = o.css || root.SUN_CSS; document.head.appendChild(st); }
    const host = o.container || document.body;
    const launch = document.createElement('button'); launch.id = 'sun-launch'; launch.textContent = '☀ 일조·그림자'; launch.title = '일조·그림자 패널 열기';
    const panel = document.createElement('div'); panel.id = 'sun-panel';
    panel.innerHTML = `
<div class="sun-hd"><b>☀ 일조·그림자</b><span class="sun-hdt" id="sun-hdt"></span><button class="sun-x" data-a="fold" title="접기/펴기">▁</button><button class="sun-x" data-a="close" title="닫기">✕</button></div>
<div class="sun-bd">
 <div class="sun-card sun-first" id="sun-pt"><b>일조 평가 대상</b>
  <div class="sun-presets" id="sun-mode" role="group" aria-label="평가 대상 선택 방식"><button class="sun-b on" data-m="bld" aria-pressed="true">건물·단지 선택</button><button class="sun-b" data-m="pt" aria-pressed="false">지점 선택</button></div>
  <div class="sun-mut sun-sm" id="sun-ptmsg">지도를 눌러 일조를 평가합니다. 건물·단지는 그대로 누르고, 마당·공원·논밭·산처럼 건물이 없는 곳은 '지점 선택'을 켠 뒤 지면을 누르세요.</div>
  <div id="sun-ptopt" style="display:none">
   <div class="sun-presets" id="sun-ptk" role="group" aria-label="측정면"><button class="sun-b on" data-k="A" aria-pressed="true" title="누른 면의 실제 방향(벽 방위·경사)을 그대로 사용">누른 면 그대로</button><button class="sun-b" data-k="H" aria-pressed="false">수평면</button><button class="sun-b" data-k="V" aria-pressed="false">수직면(방향 선택)</button></div>
   <div class="sun-presets" id="sun-pto" role="group" aria-label="수직면 방향" style="display:none;margin-top:4px"><button class="sun-b" data-po="S">남</button><button class="sun-b" data-po="E">동</button><button class="sun-b" data-po="W">서</button><button class="sun-b" data-po="N">북</button><button class="sun-b on" data-po="all">모든 방향</button></div>
   <div class="sun-row">지면에서 높이 <input id="sun-pth" type="number" min="0" max="100" step="0.5" value="1.5" style="width:62px"> m · 층 <input id="sun-ptf" type="number" min="1" max="36" placeholder="-" style="width:48px"> <span class="sun-mut sun-sm">(층 높이 2.8 m 규칙)</span></div>
   <div class="sun-row"><input id="sun-ptc" placeholder="경도,위도 (예 127.25,35.22)" style="width:58%"> <button class="sun-b" id="sun-ptgo">평가</button> <button class="sun-b" id="sun-ptcam">카메라 중심</button></div>
  </div>
  <div id="sun-stand" style="margin-top:6px"><b class="sun-sm">걸어보기로 서는 곳</b>
   <div class="sun-mut sun-sm" id="sun-standmsg">걸어보기로 서는 곳을 먼저 고르세요.</div>
   <div class="sun-presets"><button class="sun-b" id="sun-standgo">현재 서 있는 곳 평가</button><button class="sun-b" id="sun-standwalk">걸어보기 시작</button><button class="sun-b" id="sun-standlook" title="걸어보기 중 정면으로 보는 방향을 창(수직면 법선)으로 평가">내가 보는 방향 창</button></div>
   <label class="sun-sw"><input type="checkbox" id="sun-standauto"> 서는 곳·방향이 바뀌면 자동으로 다시 평가</label>
  </div>
 </div>
 <div class="sun-row"><label class="sun-l"><span>날짜</span><span id="sun-dl">12월 21일</span></label>
  <input id="sun-d" type="range" min="1" max="${daysInYear()}" step="1" value="${S.doy}">
  <div class="sun-presets"><button class="sun-b" id="sun-now" title="내 기기의 현재 날짜·시각으로 되돌리기">지금</button><button class="sun-b" data-p="12-21">동지 12/21</button><button class="sun-b" data-p="3-20">춘분 3/20</button><button class="sun-b" data-p="6-21">하지 6/21</button><button class="sun-b" data-p="9-23">추분 9/23</button></div></div>
 <div class="sun-row"><label class="sun-l"><span>시각 (<span id="sun-tz">KST</span>)</span><span id="sun-tl">12:30</span></label>
  <div class="sun-time" id="sun-tbar"></div><input id="sun-t" type="range" min="0" max="1440" step="5" value="${S.min}">
  <div class="sun-marks" id="sun-marks"></div></div>
 <div class="sun-mut sun-sm" id="sun-kst" style="display:none"></div>
 <div class="sun-row"><div class="sun-presets"><button class="sun-b" id="sun-pd">▶ 하루 재생</button><button class="sun-b" id="sun-py">▶ 1년 재생</button><button class="sun-b" id="sun-pp" style="display:none" title="일시정지 / 계속">⏸ 일시정지</button></div>
  <div class="sun-presets" style="margin-top:4px"><button class="sun-b" id="sun-tm" title="10분 전" aria-label="10분 전">◀ 10분</button><button class="sun-b" id="sun-tp" title="10분 후" aria-label="10분 후">10분 ▶</button><button class="sun-b" id="sun-dm" title="하루 전" aria-label="하루 전">◀ 1일</button><button class="sun-b" id="sun-dp" title="하루 후" aria-label="하루 후">1일 ▶</button></div>
  <div class="sun-presets" style="margin-top:4px;align-items:center"><label class="sun-sm">재생 속도 <select id="sun-spd" class="sun-sel" aria-label="재생 속도">${SPEEDS.map((v) => `<option value="${v}"${v === S.speed ? ' selected' : ''}>${v}×</option>`).join('')}</select></label><label class="sun-sm"><input type="checkbox" id="sun-loop"${S.loop ? ' checked' : ''}> 반복</label></div>
  <div class="sun-mut sun-sm" id="sun-pinfo">1× = 하루 60초 · 1년 120초(1년 재생은 시각을 그대로 두고 날짜만 넘깁니다)</div></div>
 <div class="sun-read" id="sun-read"></div>
 <label class="sun-sw"><input type="checkbox" id="sun-sh"> 실시간 그림자 (건물·지형·산)</label>
 <label class="sun-sw"><input type="checkbox" id="sun-ov"> 일조 시간 지도 (지면, 직사광 시간)</label>

 <div id="sun-ovbox" style="display:none">
  <div class="sun-mut sun-sm" id="sun-ovinfo">보이는 영역만, 선택한 날짜 하루 기준으로 눌렀을 때 계산합니다.</div>
  <div class="sun-prog" id="sun-ovprog" style="display:none"><div class="sun-progbar"><i id="sun-ovbar"></i></div><span id="sun-ovpct">0%</span> <button class="sun-b" id="sun-ovcancel">취소</button></div>
  <div class="sun-presets"><button class="sun-b" id="sun-ovgo">이 영역·날짜로 다시 계산</button> <select id="sun-ovstep" aria-label="시간 간격" class="sun-sel"><option value="20" selected>20분 간격(빠름)</option><option value="10">10분 간격(정밀)</option></select></div>
  <div class="sun-note" id="sun-ovstale" role="status" style="display:none"></div>
  <div class="sun-lg" style="background:${rampCSS()};margin-top:5px"></div><div class="sun-lgt"><span>0 h</span><span>3</span><span>6</span><span>9</span><span>12 h</span></div>
  <div class="sun-mut sun-sm">회색(투명) = 건물 안. 값 = 해당 날짜 하루 직사광 합계(15분 간격).</div></div>
 <label class="sun-sw"><input type="checkbox" id="sun-bc"${o.setBuildingTint ? '' : ' disabled'}> 건물 색: 일조 점수(동지)</label><div class="sun-mut sun-sm" id="sun-bcmsg"></div>
 <div id="sun-bcbox" style="display:none"><div class="sun-lg" style="background:${rampCSS()}"></div><div class="sun-lgt"><span>0</span><span>25</span><span>50</span><span>75</span><span>100점</span></div>
  <div class="sun-mut sun-sm">건물 점수(4면 평균, 중층, 동지) — 눌렀을 때 계산합니다. 회색 = 점수를 낼 수 없는 건물.</div></div>
 <label class="sun-sw"><input type="checkbox" id="sun-sl"${o.onScoreLayer ? '' : ' disabled'}> 단지 라벨에 일조 점수 표시(연평균)</label>
 <div class="sun-mut sun-sm" id="sun-slnote" style="display:none">라벨의 숫자 = 소속 건물 점수 평균(0~100), 진한 파랑일수록 높음. 모델 추정·상대 설명용.</div>
 <div class="sun-card" id="sun-q"><b>점(동·층·방향) 일조 평가</b>
  <datalist id="sun-qlist"></datalist>
  <div class="sun-row"><input id="sun-qb" list="sun-qlist" placeholder="동 이름 (예 523동, 단지명)" style="width:62%"> 층 <input id="sun-qf" type="number" min="1" max="80" value="5" style="width:48px"></div>
  <div class="sun-row">호(선택) <input id="sun-qu" placeholder="1204호" style="width:68px"> 층고 <input id="sun-qh" type="number" min="2.7" max="3.1" step="0.1" value="2.8" style="width:52px"> m</div>
  <div class="sun-presets" id="sun-qo"><button class="sun-b" data-o="S">남</button><button class="sun-b" data-o="E">동</button><button class="sun-b" data-o="W">서</button><button class="sun-b" data-o="N">북</button><button class="sun-b on" data-o="all">모든 방향</button></div>
  <div class="sun-row"><button class="sun-b" id="sun-qgo">평가</button> <button class="sun-b" id="sun-qpick">벽 클릭 선택</button> <button class="sun-b" id="sun-qwin" title="선택한 건물·층·방향의 창가(벽 바로 바깥)에서 보기">창가 시점</button></div>
  <div id="sun-qmsg" class="sun-mut sun-sm"></div></div>
 <div class="sun-card" id="sun-stat"></div>
 <div class="sun-card" id="sun-card"><i class="sun-mut">건물을 선택하면 외벽 일조가 여기에 표시됩니다.</i></div>
 <div class="sun-note">${esc(NOTE)}</div>
</div>`;
    const ownLaunch = !o.launchButton; if (o.launchButton) { o.launchButton.addEventListener('click', () => { S.open = !S.open; showHide(); }); } else host.appendChild(launch); host.appendChild(panel);
    const $ = (s) => panel.querySelector(s);
    // ---- compact sun clock: stays on screen while a sun visualisation is on and the panel is closed/hidden (draggable, remembers its position)
    const clock = document.createElement('div'); clock.id = 'sun-clock'; clock.className = 'sun-hidden'; clock.setAttribute('role', 'group'); clock.setAttribute('aria-label', '일조 시뮬레이션 시계');
    clock.title = '누르면 일조 패널 열기 · 끌어서 이동 · 더블클릭: 위치 초기화';
    clock.innerHTML = '<div class="sun-ck-main"><span class="sun-ck-t" id="sun-ck-t">12:30</span><span class="sun-ck-d" id="sun-ck-d"></span></div><div class="sun-ck-sub" id="sun-ck-s"></div><button type="button" class="sun-ck-b" id="sun-ck-p" aria-label="하루 재생/정지" title="하루 재생/정지">▶</button>';
    host.appendChild(clock);
    const seasonOf = (m, d) => (m === 12 && d >= 21 && d <= 22 ? '동지' : m === 6 && d >= 21 && d <= 22 ? '하지' : m === 3 && d >= 20 && d <= 21 ? '춘분' : m === 9 && d >= 22 && d <= 23 ? '추분' : (m >= 3 && m <= 5) ? '봄' : (m >= 6 && m <= 8) ? '여름' : (m >= 9 && m <= 11) ? '가을' : '겨울');
    function updateClock() {
      const mode = S.shadow || S.overlay || S.bcolor, vis = mode && (!S.open || document.body.classList.contains('hideall'));
      clock.classList.toggle('sun-hidden', !vis); if (!vis) return;
      const { month, day } = dateFromDoy(S.doy), pl = S.playing, tz = tzInfo(localInstant(S.doy, S.min));
      clock.querySelector('#sun-ck-t').textContent = hhmm(S.min / 60) + ' ' + tz.name;
      clock.querySelector('#sun-ck-d').textContent = `${month}월 ${day}일 · ${seasonOf(month, day)}`;
      clock.querySelector('#sun-ck-s').innerHTML = `<span class="sun-ck-chip ${S.shadow ? 'on' : ''}">그림자 ${S.shadow ? 'ON' : 'OFF'}</span>` + (S.overlay ? '<span class="sun-ck-chip on">일조 지도</span>' : '') + (pl ? `<span class="sun-ck-chip on">${pl === 'day' ? '하루' : '1년'} ${S.paused ? '일시정지' : '재생 중'}${S.speed !== 1 ? ' ' + S.speed + '×' : ''}</span>` : '');
      clock.querySelector('#sun-ck-p').textContent = pl && !S.paused ? '⏸' : '▶';
    }
    function openFromClock() { if (document.body.classList.contains('hideall')) { const hb = document.getElementById('bHide'); if (hb) hb.click(); } S.open = true; showHide(); }
    clock.querySelector('#sun-ck-p').addEventListener('click', (e) => { e.stopPropagation(); if (S.playing) togglePause(); else play('day'); });
    clock.addEventListener('keydown', (e) => { e.stopPropagation(); if ((e.key === 'Enter' || e.key === ' ') && e.target === clock) { e.preventDefault(); openFromClock(); } });
    clock.tabIndex = 0;
    if (root.FMDrag) { root.FMDrag.attach(panel, panel.querySelector('.sun-hd'), 'sunpanel', { sheet: true }); root.FMDrag.attach(clock, clock, 'sunclock', { onClick: openFromClock }); }
    new MutationObserver(() => updateClock()).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    if (!o.setBuildingTint) { const bl = panel.querySelector('#sun-bc'); const lab = bl && bl.closest('label'); if (lab) lab.style.display = 'none'; }
    function showHide() { panel.classList.toggle('sun-hidden', !S.open); if (ownLaunch) launch.classList.toggle('sun-hidden', S.open); if (o.launchButton) o.launchButton.classList.toggle('on', S.open); if (o.onOpenChange) o.onOpenChange(S.open); panel.classList.toggle('sun-folded', S.folded); document.body.classList.toggle('fm-sun-open', !!S.open); updateClock(); save(); }
    launch.onclick = () => { S.open = true; showHide(); };
    panel.addEventListener('click', (e) => { const a = e.target.dataset && e.target.dataset.a; if (a === 'close') { S.open = false; showHide(); } else if (a === 'fold') { S.folded = !S.folded; showHide(); } });
    panel.addEventListener('keydown', (e) => e.stopPropagation());   // host WASD / H keys must not fire while typing/sliding

    // ---------------------------------------------------------------------------------------- sun state
    let sunNow = { alt: 30, az: 180 }, ev = null;
    const L = new THREE.Vector3(0, 1, 0);
    function computeSun() {
      // the sun is computed from the real instant (client wall clock -> instant -> the site's KST wall clock), so any client zone gives the same sun
      const t = localInstant(S.doy, S.min), kp = kstParts(t.getTime());
      S.kd = { month: kp.m, day: kp.d }; S.kdoy = kp.doy; S.kmin = kp.min;
      sunNow = solarPosition(kp.y, kp.m, kp.d, kp.hour, lat, lon);
      const e0 = dayEvents(kp.y, kp.m, kp.d, lat, lon), kMid = Date.UTC(kp.y, kp.m - 1, kp.d) - KST_MIN * 60000, lMid = localInstant(S.doy, 0).getTime();
      const cv = (h) => (h == null ? null : (kMid + h * 3600000 - lMid) / 3600000);   // site-day event (KST hours) -> hours after the client's local midnight
      ev = Object.assign({}, e0, { sunrise: cv(e0.sunrise), sunset: cv(e0.sunset), noon: cv(e0.noon) });
      const v = sunVector(sunNow.alt, sunNow.az); L.set(v[0], v[2], -v[1]).normalize();   // toward the sun, three coordinates
    }
    function updateReadout() {
      const { month, day } = dateFromDoy(S.doy), dl = ev.dayLength, tz = tzInfo(localInstant(S.doy, S.min));
      const pcw = (h) => (h == null ? '--:--' : hhmm(((h % 24) + 24) % 24) + (h >= 24 ? '(+1)' : h < 0 ? '(-1)' : ''));
      $('#sun-dl').textContent = `${month}월 ${day}일`; $('#sun-tl').textContent = hhmm(S.min / 60); $('#sun-tz').textContent = tz.name;
      $('#sun-hdt').textContent = `${month}/${day} ${hhmm(S.min / 60)} ${tz.name}`;
      const ks = $('#sun-kst'); if (tz.off !== KST_MIN) { ks.style.display = 'block'; ks.textContent = `현지(한국표준시) ${S.kd.month}월 ${S.kd.day}일 ${hhmm(S.kmin / 60)} — 위 시각은 내 시간대(${tz.id || tz.name}) 기준입니다.`; } else ks.style.display = 'none';
      const len = sunNow.alt > 0.3 ? `높이 10 m 건물 그림자 ≈ ${(10 / Math.tan(sunNow.alt * D2R)).toFixed(0)} m` : '해가 지평선 아래';
      $('#sun-read').innerHTML = `고도 <b>${sunNow.alt.toFixed(1)}°</b> · 방위 <b>${sunNow.az.toFixed(0)}° (${compass(sunNow.az)})</b><br>일출 <b>${pcw(ev.sunrise)}</b> · 일몰 <b>${pcw(ev.sunset)}</b> · 낮 길이 <b>${Math.floor(dl)}시간 ${Math.round((dl % 1) * 60)}분</b> · 정오 고도 ${ev.noonAlt.toFixed(1)}°<br><span style="color:#5b6773">${len}</span>`;
      $('#sun-d').value = S.doy; $('#sun-t').value = S.min;
      const t0 = 0, span = 1440, pc = (h) => clamp((h * 60 - t0) / span * 100, 0, 100);
      const rise = pc(ev.sunrise), set = pc(ev.sunset);
      $('#sun-tbar').style.background = `linear-gradient(90deg,#26304f 0%,#26304f ${Math.max(0, rise - 2)}%,#f4a259 ${rise}%,#ffe08a ${Math.min(100, rise + 6)}%,#ffe08a ${Math.max(0, set - 6)}%,#f4a259 ${set}%,#26304f ${Math.min(100, set + 2)}%,#26304f 100%)`;
      $('#sun-marks').innerHTML = `<span style="left:${clamp(rise, 8, 92)}%">▲일출 ${pcw(ev.sunrise)}</span><span style="left:${clamp(pc(ev.noon), 30, 70)}%">정오 ${pcw(ev.noon)}</span><span style="left:${clamp(set, 8, 92)}%">일몰 ${pcw(ev.sunset)}▲</span>`;
      panel.querySelectorAll('[data-p]').forEach((b) => { const [m, d] = b.dataset.p.split('-').map(Number); b.classList.toggle('on', doyFromDate(m, d) === S.doy); });
      $('#sun-pd').textContent = S.playing === 'day' ? '■ 정지' : '▶ 하루 재생'; $('#sun-py').textContent = S.playing === 'year' ? '■ 정지' : '▶ 1년 재생';
      $('#sun-pp').style.display = S.playing ? '' : 'none'; $('#sun-pp').textContent = S.paused ? '▶ 계속' : '⏸ 일시정지';
      updateClock();
    }

    // ---------------------------------------------------------------------------------------- real-time shadows
    const light = new THREE.DirectionalLight(0xfff2dd, 0); light.name = 'sun-addon-light';
    const MAPSZ = Math.min(o.shadowMapSize || 4096, renderer.capabilities.maxTextureSize || 2048);
    light.shadow.mapSize.set(MAPSZ, MAPSZ); light.shadow.bias = -0.0004; light.shadow.normalBias = 0.9; light.shadow.radius = 2;
    // sample points of the whole terrain extent (three coordinates) used to size the depth range of the orthographic shadow camera
    const TB = o.terrainBounds || [B[0] - 2500, B[1] - 2500, B[2] + 2500, B[3] + 2500];
    const NS = 150, SP = new Float32Array(NS * NS * 3);
    for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) { const x = lerp(TB[0], TB[2], i / (NS - 1)), y = lerp(TB[1], TB[3], j / (NS - 1)), k = (j * NS + i) * 3; SP[k] = x; SP[k + 1] = gh(x, y); SP[k + 2] = -y; }
    const RMAX = Math.max(500, Math.hypot(B[2] - B[0], B[3] - B[1]) / 2 + 80);
    const host0 = { bg: scene.background ? (scene.background.clone ? scene.background.clone() : scene.background) : null, lights: [], hemi: [] };
    addEventListener('fm-theme-bg', () => { if (scene.background && scene.background.isColor) host0.bg = scene.background.clone(); });   // host re-themed its backdrop: that is the new daytime sky
    const focus = new THREE.Vector3((B[0] + B[2]) / 2, 0, -(B[1] + B[3]) / 2); focus.y = gh((B[0] + B[2]) / 2, (B[1] + B[3]) / 2);
    let R = RMAX, lastCam = new Float32Array(16), dirty = true, focusT = 0;
    const tmp = new THREE.Vector3();
    function groundUnderView() {
      // march the view ray against the height function (no triangle raycast)
      const o3 = camera.getWorldPosition(new THREE.Vector3()), d3 = camera.getWorldDirection(new THREE.Vector3());
      let t = 5; const maxT = 12000;
      while (t < maxT) { const p = o3.clone().addScaledVector(d3, t), g = gh(p.x, -p.z); if (p.y < g) { let a = t - Math.max(5, t * 0.08), b = t; for (let k = 0; k < 14; k++) { const m2 = (a + b) / 2, q = o3.clone().addScaledVector(d3, m2); if (q.y < gh(q.x, -q.z)) b = m2; else a = m2; } const q = o3.clone().addScaledVector(d3, b); return { p: new THREE.Vector3(q.x, gh(q.x, -q.z), q.z), dist: b }; } t += Math.max(5, t * 0.04); }
      return null;
    }
    function fitShadow() {
      const c = focus.clone(), ex = new THREE.Vector3(0, 1, 0).cross(L); if (ex.lengthSq() < 1e-6) ex.set(1, 0, 0); ex.normalize();
      const ey = new THREE.Vector3().crossVectors(L, ex).normalize(), texel = 2 * R / MAPSZ;
      const a = c.dot(ex), b = c.dot(ey); c.addScaledVector(ex, Math.round(a / texel) * texel - a).addScaledVector(ey, Math.round(b / texel) * texel - b);   // texel snapping (no shimmer)
      let dmax = -1e9, dmin = 1e9; const lim = R * 1.08;
      for (let k = 0; k < SP.length; k += 3) {
        tmp.set(SP[k] - c.x, SP[k + 1] - c.y, SP[k + 2] - c.z);
        if (Math.abs(tmp.dot(ex)) > lim || Math.abs(tmp.dot(ey)) > lim) continue;
        const d = tmp.dot(L); if (d > dmax) dmax = d; if (d < dmin) dmin = d;
      }
      if (dmax < -1e8) { dmax = 100; dmin = -100; }
      dmax += 130; dmin -= 60;   // buildings (up to ~130 m) stand on the terrain samples; receivers may lie lower
      const cam = light.shadow.camera; cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R;
      light.position.copy(c).addScaledVector(L, dmax + 20); light.target.position.copy(c);
      cam.near = 1; cam.far = dmax - dmin + 40; cam.updateProjectionMatrix(); light.updateMatrixWorld(); light.target.updateMatrixWorld();
    }
    // ---- 창가 시점 하늘: 태양 고도 -> 하늘 그라데이션 + 옅은 안개색 (창가 시점일 때만, 생활동선 색은 건드리지 않음)
    const WS = { on: false, tex: null, cv: null, prevBg: null, prevFog: null, key: '' };
    function windowSky() {
      const WVm = root.WindowView; if (!WS.on || !WVm || !WS.tex) return;
      const c = WVm.skyColors(sunNow.alt), key = c.top + c.hor;
      if (key !== WS.key) {
        const g = WS.cv.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, WS.cv.height); gr.addColorStop(0, c.top); gr.addColorStop(0.62, c.hor); gr.addColorStop(1, c.hor);
        g.fillStyle = gr; g.fillRect(0, 0, WS.cv.width, WS.cv.height); WS.tex.needsUpdate = true; WS.key = key; if (scene.fog) scene.fog.color.set(c.fog);
      }
      if (scene.background !== WS.tex) scene.background = WS.tex;
    }
    function setWindowSky(on) {
      if (on === WS.on) return;
      if (on) {
        if (!document.createElement) return;
        WS.cv = document.createElement('canvas'); WS.cv.width = 4; WS.cv.height = 256; WS.tex = new THREE.CanvasTexture(WS.cv); if (THREE.SRGBColorSpace) WS.tex.colorSpace = THREE.SRGBColorSpace;
        WS.prevBg = scene.background; WS.prevFog = scene.fog; WS.key = ''; WS.on = true; scene.fog = new THREE.Fog(0xbcdcf7, 1500, 16000); windowSky();
      } else {
        WS.on = false; scene.fog = WS.prevFog; if (WS.prevBg && WS.prevBg.isColor) { scene.background = WS.prevBg; if (host0.bg && host0.bg.isColor) scene.background.copy(host0.bg); } else if (host0.bg) scene.background = host0.bg.clone();
        if (WS.tex) { WS.tex.dispose(); WS.tex = null; } skyAndLight();
      }
      dirty = true; if (o.requestRender) o.requestRender();
    }
    function skyAndLight() {
      const alt = sunNow.alt, f = clamp(alt / 14, 0, 1), s = f * f * (3 - 2 * f);
      const warm = clamp(alt / 30, 0, 1);
      const col = new THREE.Color().setRGB(1, lerp(0.52, 0.96, warm), lerp(0.28, 0.88, warm));
      light.color.copy(col); light.intensity = 2.5 * s * (0.55 + 0.45 * Math.sqrt(clamp(alt / 25, 0, 1)));
      for (const h of host0.hemi) h.l.intensity = h.i * (0.3 + 0.18 * s) ;
      if (S.shadow && !WS.on && scene.background && host0.bg && host0.bg.isColor) {   // the sky is only touched while real-time shadows are on (restored on off)
        const night = new THREE.Color(0x0b1226), dusk = new THREE.Color(0xe49a62), day = host0.bg;
        const c = new THREE.Color();
        if (alt < -6) c.copy(night); else if (alt < 0) c.copy(night).lerp(dusk, (alt + 6) / 6); else if (alt < 10) c.copy(dusk).lerp(day, alt / 10 * 0.6); else c.copy(dusk).lerp(day, 0.6 + 0.4 * clamp((alt - 10) / 20, 0, 1));
        scene.background.copy(c);
      }
      windowSky();
    }
    function setShadow(on) {
      S.shadow = on; $('#sun-sh').checked = on;
      if (on) {
        renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;   // static scene: re-render the depth map only when sun / camera / meshes change
        scene.add(light); scene.add(light.target);
        host0.lights = []; host0.hemi = [];
        scene.traverse((n) => { if (n.isDirectionalLight && n !== light) host0.lights.push({ l: n, i: n.intensity }); if (n.isHemisphereLight || n.isAmbientLight) host0.hemi.push({ l: n, i: n.intensity }); });
        host0.lights.forEach((h) => { h.l.intensity = 0; });
        light.castShadow = true;
        const mark = (m) => { if (m) { m.castShadow = true; m.receiveShadow = true; } };
        mark(terrain); bmeshes.forEach(mark); (o.extraCasters || []).forEach(mark);
        scene.traverse((n) => { if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => { m.needsUpdate = true; }); });
        dirty = true; skyAndLight();
      } else {
        scene.remove(light); scene.remove(light.target); light.castShadow = false;
        host0.lights.forEach((h) => { h.l.intensity = h.i; }); host0.hemi.forEach((h) => { h.l.intensity = h.i; });
        if (scene.background && host0.bg && host0.bg.isColor) scene.background.copy(host0.bg);
        renderer.shadowMap.enabled = false; renderer.shadowMap.autoUpdate = true;
        scene.traverse((n) => { if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => { m.needsUpdate = true; }); });
      }
      updateClock(); if (o.onShadowChange) o.onShadowChange(on);
      if (o.requestRender) o.requestRender();
    }

    // ---------------------------------------------------------------------------------------- ground sunshine map: computed WHEN SWITCHED ON (web workers), visible area, one date
    const OV = { workers: [], tok: 0, area: null, doy: null, view: null, cap: 60000, terr: null, running: false, t0: 0 };
    function sunScriptText() {
      if (o.workerSource) return o.workerSource;
      for (const sc of document.getElementsByTagName('script')) { const t = sc.textContent; if (t && t.indexOf('root.SunAddon = api') >= 0 && t.indexOf('groundMapJob') >= 0) return t; }
      return null;
    }
    function visibleArea() {
      const pts = []; let far = false;
      for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(nx, ny), camera);
        let t = marchGround(rc.ray.origin, rc.ray.direction); if (t == null || t > 7000) { t = 7000; far = true; }
        pts.push([rc.ray.origin.x + rc.ray.direction.x * t, -(rc.ray.origin.z + rc.ray.direction.z * t)]);
      }
      let x0 = Math.min(...pts.map((q) => q[0])), x1 = Math.max(...pts.map((q) => q[0])), y0 = Math.min(...pts.map((q) => q[1])), y1 = Math.max(...pts.map((q) => q[1]));
      x0 = Math.max(x0, TB[0]); y0 = Math.max(y0, TB[1]); x1 = Math.min(x1, TB[2]); y1 = Math.min(y1, TB[3]);
      if (x1 - x0 < 40 || y1 - y0 < 40) { const c = focus; x0 = c.x - 200; x1 = c.x + 200; y0 = -c.z - 200; y1 = -c.z + 200; }
      const w = x1 - x0, h = y1 - y0; let d = 5; for (const dd of [5, 10, 20, 40, 80, 160]) { d = dd; if (Math.ceil(w / dd) * Math.ceil(h / dd) <= OV.cap) break; }
      return { x0, y0, nx: Math.ceil(w / d), ny: Math.ceil(h / d), d, far };
    }
    function terrainGrid() {
      if (OV.terr) return OV.terr; const ext = Math.max(TB[2] - TB[0], TB[3] - TB[1]), dx = Math.max(o.terrainRes || 10, ext / 700), nx = Math.ceil((TB[2] - TB[0]) / dx) + 1, ny = Math.ceil((TB[3] - TB[1]) / dx) + 1, h = new Float32Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = gh(TB[0] + i * dx, TB[1] + j * dx);
      return (OV.terr = { x0: TB[0], y0: TB[1], nx, ny, dx, dy: dx, h });
    }
    function ovStop() { OV.tok++; OV.running = false; for (const w of OV.workers) { try { w.postMessage({ cancel: true }); w.terminate(); } catch (e) { /* ignore */ } } OV.workers = []; }
    function ovProg(p, msg) { $('#sun-ovprog').style.display = p == null ? 'none' : 'flex'; if (p != null) { $('#sun-ovbar').style.width = (p * 100).toFixed(0) + '%'; $('#sun-ovpct').textContent = msg || (p * 100).toFixed(0) + '%'; } }
    function ovStale(why) { if (!S.overlay || OV.running) return; const el = $('#sun-ovstale'); el.style.display = 'block'; el.textContent = why === 'date' ? '날짜가 바뀌었습니다. 지도는 이전 날짜 기준입니다 — \'이 영역·날짜로 다시 계산\'을 누르세요.' : '화면이 크게 바뀌었습니다. 지도는 이전 영역 기준입니다 — \'이 영역·날짜로 다시 계산\'을 누르세요(자동 재계산은 하지 않습니다).'; }
    function startOverlay() {
      ovStop(); const tok = OV.tok; $('#sun-ovstale').style.display = 'none'; if (!Q) return;
      const area = visibleArea(), dd = S.kd, step = +$('#sun-ovstep').value || 20, hw = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2, K = Math.max(1, Math.min(4, hw - 1));
      OV.area = area; OV.doy = S.kdoy; OV.running = true; OV.t0 = performance.now();
      const g = groundUnderView(); OV.view = { x: g ? g.p.x : (area.x0 + area.nx * area.d / 2), y: g ? -g.p.z : (area.y0 + area.ny * area.d / 2), w: area.nx * area.d };
      $('#sun-ovinfo').textContent = `${dd.month}월 ${dd.day}일 · 격자 ${area.d} m · ${area.nx}×${area.ny}칸 · ${step}분 간격 · ${K > 1 || typeof Worker === 'undefined' ? '병렬 ' + K : '백그라운드 1'}개 계산 중…`;
      ovProg(0);
      const common = { buildings: Q.buildings.map((b) => ({ id: b.id, ring: b.ring, z0: b.z0, z1: b.z1, h: b.h })), terrain: terrainGrid(), bounds: B, lat, lon, m: dd.month, d: dd.day, stepMin: step, terrainMax: o.terrainMax != null ? o.terrainMax : 300, above: 0.5 };
      const vals = new Uint8Array(area.nx * area.ny), prog = new Float64Array(K); let doneN = 0;
      const finish = () => { if (tok !== OV.tok) return; OV.running = false; ovProg(null); paintOverlay(area, vals); const sec = ((performance.now() - OV.t0) / 1000).toFixed(1); $('#sun-ovinfo').textContent = `${dd.month}월 ${dd.day}일 · 격자 ${area.d} m · ${area.nx}×${area.ny}칸 · ${step}분 간격 · ${sec}초${area.far ? ' · 먼 하늘 쪽은 7 km까지' : ''} (점 평가와 같은 계산, 격자 해상도만큼 근사)`; };
      const upd = () => { let t = 0; for (let k = 0; k < K; k++) t += prog[k]; ovProg(t / K); };
      const bands = []; for (let k = 0; k < K; k++) bands.push([Math.floor(area.ny * k / K), Math.floor(area.ny * (k + 1) / K)]);
      const src = typeof Worker !== 'undefined' && sunScriptText();
      const mainThread = () => {                                  // fallback: same job on the main thread in small slices
        let k = 0; const jobs = bands.map(([r0, r1]) => SQ.groundMapJob(Object.assign({ calc: api.calc, area: Object.assign({}, area, { r0, r1 }) }, common)));
        (function loop() { if (tok !== OV.tok) return; const j = jobs[k], r = j.step(30); prog[k] = r.progress; upd(); if (r.done) { vals.set(j.vals, j.r0 * area.nx); k++; if (k >= jobs.length) { finish(); return; } } setTimeout(loop, 0); })();
      };
      if (!src) { mainThread(); return; }
      let failed = false;
      try {
        const url = URL.createObjectURL(new Blob([src + "\n;self.onmessage=function(e){var m=e.data;if(m.cancel){self.__c=true;return}var job=self.SunQuery.groundMapJob(Object.assign({calc:self.SunAddon.calc},m));(function loop(){if(self.__c)return;var r=job.step(40);self.postMessage({progress:r.progress});if(r.done)self.postMessage({done:true,vals:job.vals,r0:job.r0},[job.vals.buffer]);else setTimeout(loop,0)})()};"], { type: 'text/javascript' }));
        bands.forEach(([r0, r1], k) => {
          const w = new Worker(url); OV.workers.push(w);
          w.onmessage = (e) => { if (tok !== OV.tok) return; const m = e.data; if (m.progress != null) { prog[k] = m.progress; upd(); } if (m.done) { vals.set(m.vals, m.r0 * area.nx); prog[k] = 1; w.terminate(); if (++doneN === K) { URL.revokeObjectURL(url); finish(); } } };
          w.onerror = () => { if (failed || tok !== OV.tok) return; failed = true; ovStop(); OV.tok++; OV.running = true; const tk2 = OV.tok; mainThreadWith(tk2); };
          w.postMessage(Object.assign({ area: Object.assign({}, area, { r0, r1 }) }, common));
        });
      } catch (e) { mainThread(); }
      function mainThreadWith(tk2) {
        let k = 0; const jobs = bands.map(([r0, r1]) => SQ.groundMapJob(Object.assign({ calc: api.calc, area: Object.assign({}, area, { r0, r1 }) }, common)));
        (function loop() { if (tk2 !== OV.tok) return; const j = jobs[k], r = j.step(30); prog[k] = r.progress; upd(); if (r.done) { vals.set(j.vals, j.r0 * area.nx); k++; if (k >= jobs.length) { OV.running = false; ovProg(null); paintOverlay(area, vals); $('#sun-ovinfo').textContent += ' (워커를 쓸 수 없어 화면 스레드에서 계산)'; return; } } setTimeout(loop, 0); })();
      }
    }
    function buildOverlayMesh(r) {
      const step = 2, nxv = Math.floor(r.nx / step) + 1, nyv = Math.floor(r.ny / step) + 1, W = r.nx * r.d, H = r.ny * r.d;
      const pos = new Float32Array(nxv * nyv * 3), uv = new Float32Array(nxv * nyv * 2);
      for (let j = 0; j < nyv; j++) for (let i = 0; i < nxv; i++) {
        const x = Math.min(r.x0 + i * step * r.d, r.x0 + W), y = Math.min(r.y0 + j * step * r.d, r.y0 + H), k = j * nxv + i;
        pos[k * 3] = x; pos[k * 3 + 1] = gh(x, y) + 0.6; pos[k * 3 + 2] = -y; uv[k * 2] = (x - r.x0) / W; uv[k * 2 + 1] = (y - r.y0) / H;
      }
      const idx = new Uint32Array((nxv - 1) * (nyv - 1) * 6); let n = 0;
      for (let j = 0; j < nyv - 1; j++) for (let i = 0; i < nxv - 1; i++) { const a = j * nxv + i, b = a + 1, c = a + nxv, d = c + 1; idx[n++] = a; idx[n++] = b; idx[n++] = c; idx[n++] = b; idx[n++] = d; idx[n++] = c; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1));
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 5; m.name = 'sun-overlay'; m.userData.noPick = true; return m;
    }
    function paintOverlay(area, vals) {
      if (S.ovMesh) { scene.remove(S.ovMesh); S.ovMesh.geometry.dispose(); if (S.ovMesh.material.map) S.ovMesh.material.map.dispose(); S.ovMesh.material.dispose(); }
      S.ovMesh = buildOverlayMesh(area); scene.add(S.ovMesh);
      const cv = document.createElement('canvas'); cv.width = area.nx; cv.height = area.ny; const g = cv.getContext('2d'), im = g.createImageData(area.nx, area.ny);
      const lut = []; for (let v = 0; v < 256; v++) lut.push(rampRGB(v / 10 / 12));
      for (let i = 0; i < vals.length; i++) { const v = vals[i], c = lut[v]; im.data[i * 4] = c[0]; im.data[i * 4 + 1] = c[1]; im.data[i * 4 + 2] = c[2]; im.data[i * 4 + 3] = v === 255 ? 0 : 255; }
      g.putImageData(im, 0, 0);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
      S.ovMesh.material.map = tex; S.ovMesh.material.needsUpdate = true; S.ovMesh.visible = S.overlay;
      if (o.requestRender) o.requestRender();
    }
    function setOverlay(on) {
      S.overlay = on; updateClock(); $('#sun-ov').checked = on; $('#sun-ovbox').style.display = on ? 'block' : 'none';
      if (on) startOverlay(); else { ovStop(); ovProg(null); if (S.ovMesh) S.ovMesh.visible = false; }
      if (o.requestRender) o.requestRender();
    }
    $('#sun-ovgo').onclick = () => startOverlay();
    $('#sun-ovcancel').onclick = () => { ovStop(); ovProg(null); $('#sun-ovinfo').textContent = '계산을 취소했습니다.'; };
    $('#sun-ovstep').addEventListener('change', () => { if (S.overlay) ovStale('date'); });
    setInterval(() => {            // the map belongs to one area: tell the user when the view moved away (never recompute by itself)
      if (!S.overlay || OV.running || !OV.view) return; const g = groundUnderView(); if (!g) return;
      const dx = Math.hypot(g.p.x - OV.view.x, -g.p.z - OV.view.y), cur = Math.max(2 * g.dist, 100);
      if (dx > 0.35 * OV.view.w || cur > 1.8 * OV.view.w || cur < 0.5 * OV.view.w * 0.5) ovStale('view');
    }, 1000);

    // ---------------------------------------------------------------------------------------- building colours (live, chunked) + card
    const bcCache = new Map(); let bcTok = 0;
    function colorFor(id) {
      const v = bcCache.get(id); if (v == null || v < 0) return new THREE.Color(0x9aa0a6);
      const c = rampRGB(v / 100); return new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255).convertSRGBToLinear();
    }
    function setBColor(on) {
      S.bcolor = on; updateClock(); $('#sun-bc').checked = on; $('#sun-bcbox').style.display = on ? 'block' : 'none'; const tok = ++bcTok, msg = $('#sun-bcmsg');
      if (!on) { msg.textContent = ''; if (o.setBuildingTint) o.setBuildingTint(null); if (o.requestRender) o.requestRender(); return; }
      if (!Q || !o.setBuildingTint) return;
      const bs = Q.buildings.filter((b) => !b.ctx && !bcCache.has(b.id)); let k = 0;
      (function step() {
        if (tok !== bcTok) return; const t0 = performance.now();
        while (k < bs.length && performance.now() - t0 < 25) { const b = bs[k++], r = Q.scoreBuilding(b, { light: true }); bcCache.set(b.id, r.ok ? r.winter.score : -1); }
        if (k < bs.length) { msg.textContent = `계산 중 ${Math.round(k / bs.length * 100)}%`; setTimeout(step, 0); } else { msg.textContent = ''; o.setBuildingTint(colorFor); if (o.requestRender) o.requestRender(); }
      })();
    }
    function facadeHTML(id) {
      const b = Q && Q.byId.get(id);
      if (!b) return '<i class="sun-mut">일조를 계산할 수 없는 건물입니다.</i>';
      const T = Q.refTable(b), hn = T.floors.map((f, i) => `${['저층', '중간', '상부'][i]} ${f}층`), on = [['S', '남'], ['E', '동'], ['W', '서'], ['N', '북']];
      const rows = on.map(([k, ko]) => { const f = T.faces[k]; return f ? `<tr><th>${ko}</th>` + f.map((c) => `<td>${c.wtot.toFixed(1)} h / 연속 ${c.wrun.toFixed(1)} h<br><span class="${c.meets ? 'sun-ok' : 'sun-no'}">${c.meets ? '충족' : '미충족'}</span></td>`).join('') + '</tr>' : `<tr><th>${ko}</th><td colspan="3" class="sun-mut">벽 없음</td></tr>`; }).join('');
      return `<b>${esc(b.name || ('건물 ' + b.id))}</b> <small>높이 ${(b.z1 - b.z0).toFixed(0)} m</small>${b.assumed ? '<br><b class="sun-no">높이는 추정치</b> → 그림자·일조가 달라질 수 있음' : ''}
<div style="margin:4px 0"><b>동지 9~15시 외벽 직사광</b> (뷰어 안에서 계산, 벽 중점 · 높이별)</div>
<table><tr><th></th>${hn.map((h) => `<th>${h}</th>`).join('')}</tr>${rows}</table>
<div class="sun-mut sun-sm" style="margin-top:3px">'충족' = ${esc(REF_TXT)}</div>`;
    }
    function showBuilding(id) { S.sel = id; if (id != null && Q && Q.byId.get(id)) $('#sun-qb').value = Q.label(Q.byId.get(id)); $('#sun-card').innerHTML = id == null ? '<i class="sun-mut">건물을 선택하면 외벽 일조가 여기에 표시됩니다.</i>' : (Q && Q.byId.get(id) ? buildingScoreHTML(Q.byId.get(id)) : '') + facadeHTML(id); }
    // ---------------------------------------------------------------------------------------- 일조 점수 (0-100)
    // 점수 범위(시범: 건물 높이 불확실도 b.hu(m) > 0 인 건물이 있을 때만): 높이를 -hu / +hu 로 바꾼 두 번째·세 번째 장면에서 같은 점수를 다시 계산해 '78점 (70–85)'로 보인다. o.scoreRange 가 없으면 아무 일도 하지 않는다.
    const RNG = { on: !!o.scoreRange, lo: null, hi: null, any: false };
    function rangeQ() {
      if (!RNG.on || !SQ || !Q) return null;
      if (RNG.lo === null) {
        const bl = o.queryBuildings || [];
        RNG.any = bl.some((b) => b.hu > 0);
        const mk = (sg) => SQ.create({ buildings: bl.map((b) => (b.hu > 0 ? Object.assign({}, b, { z1: Math.max(b.z0 + 3, b.z1 + sg * b.hu), h: Math.max(3, (b.h || 0) + sg * b.hu) }) : b)), getGroundHeight: gh, bounds: B, terrainMax: o.terrainMax != null ? o.terrainMax : 300, calc: api.calc, lat, lon });
        if (RNG.any) { RNG.lo = mk(-1); RNG.hi = mk(1); } else { RNG.lo = false; }
      }
      return RNG.any ? RNG : null;
    }
    function scoreRng(fn, mid) {            // fn(Qx) -> number on the shifted scenes; -> [lo, hi] containing `mid`, or null
      const r = rangeQ(); if (!r) return null;
      try { const a = fn(r.lo), c = fn(r.hi); if (a == null || c == null || !isFinite(a) || !isFinite(c)) return null; return [Math.min(a, c, mid), Math.max(a, c, mid)]; } catch (e) { return null; }
    }
    const rngTxt = (rg) => (rg && Math.round(rg[1]) - Math.round(rg[0]) >= 1 ? ` <span class="sun-rng" title="건물 높이 불확실도만큼 낮추거나 높였을 때의 점수 범위(높이가 추정·환산인 건물 반영)">(${Math.round(rg[0])}–${Math.round(rg[1])})</span>` : '');
    const rngNote = (rg) => (rg ? '<div class="sun-sm sun-mut">( ) 안: 높이 불확실도(추정·환산 오차)만큼 건물 높이를 낮추거나 높였을 때 점수 범위</div>' : '');
    const SCORE_NOTE = '일조 점수 = 일출~일몰 중 직사광이 드는 시간의 비율(0~100, 10분 간격). 모델 추정입니다: 건물 높이 일부 추정, 나무·단지 조경 그림자 미반영, 낮은 고도 햇빛의 세기는 반영하지 않고 시간만 셉니다. 등급은 상대 설명용이며 법적 판정이나 구매·투자 권유가 아닙니다. 호는 층·방향까지만 반영합니다(같은 층 안의 위치·실내·창 크기는 모름).';
    const clamp100 = (v) => Math.max(0, Math.min(100, v));
    const sBadge = (v, big) => `<span class="sun-badge${big ? ' big' : ''}${v >= 55 ? ' hi' : ''}" style="--v:${clamp100(v).toFixed(0)}%" title="${SQ ? SQ.gradeOf(v) : ''}">${Math.round(v)}</span>`;
    const gradeOf = (v) => (SQ ? SQ.gradeOf(v) : '');
    const sBars = (r) => r.noDir ? `<div class="sun-sb" role="img" aria-label="점수 ${Math.round(r.score)}, 가림 손실 ${Math.round(r.shade)}"><i class="s" style="width:${clamp100(r.score)}%"></i><i class="h" style="width:${clamp100(r.shade)}%"></i></div><div class="sun-sbl"><span><i class="s"></i>점수 <b>${Math.round(r.score)}</b></span><span title="주변 건물·산에 가려 잃은 몫"><i class="h"></i>가림 손실 <b>${Math.round(r.shade)}</b></span></div>` : `<div class="sun-sb" role="img" aria-label="점수 ${Math.round(r.score)}, 방향 손실 ${Math.round(r.dir)}, 가림 손실 ${Math.round(r.shade)}"><i class="s" style="width:${clamp100(r.score)}%"></i><i class="d" style="width:${clamp100(r.dir)}%"></i><i class="h" style="width:${clamp100(r.shade)}%"></i></div><div class="sun-sbl"><span><i class="s"></i>점수 <b>${Math.round(r.score)}</b></span><span title="그 방향이 해를 등지는 시간: 장애물이 없어도 직사광을 못 받는 몫"><i class="d"></i>방향 손실 <b>${Math.round(r.dir)}</b></span><span title="주변 건물·산에 가려 잃은 몫"><i class="h"></i>가림 손실 <b>${Math.round(r.shade)}</b></span></div>`;
    function buildingScoreHTML(b) {
      if (!Q || !b) return '';
      const r = Q.scoreBuilding(b); if (!r.ok) return `<div class="sun-score"><b>일조 점수</b> <span class="sun-mut">${esc(r.msg)}</span></div>`;
      const on = { S: '남', E: '동', W: '서', N: '북' };
      const rg = scoreRng((Qx) => { const bb = Qx.byId.get(b.id); const rr = bb && Qx.scoreBuilding(bb, { light: true }); return rr && rr.ok ? rr.annual.score : null; }, r.annual.score);
      const rows = ['S', 'E', 'W', 'N'].map((k) => { const f = r.faces.find((x) => x.orient === k); return f ? `<tr><th>${on[k]}</th><td>${sBadge(f.mid.winter.score)}</td><td>${sBadge(f.mid.annual.score)}</td><td>${Math.round(f.mid.annual.dir)}</td><td>${Math.round(f.mid.annual.shade)}</td></tr>` : `<tr><th>${on[k]}</th><td colspan="4" class="sun-mut">벽 없음</td></tr>`; }).join('');
      const bands = r.bandMeans.map((x) => `<span class="sun-bandchip">${x.label}(${x.floor}층) ${sBadge(x.annual)}</span>`).join(' ');
      return `<div class="sun-score"><div class="sun-sh"><b>일조 점수</b> <small class="sun-mut">건물 · ${r.nFaces}면 평균(중층 ${r.bandMeans.length === 3 ? r.bandMeans[1].floor : r.bandMeans[0].floor}층 기준)</small></div>
<div class="sun-sbig">${sBadge(r.annual.score, true)}<div><b>연평균 ${Math.round(r.annual.score)}점</b>${rngTxt(rg)} · ${gradeOf(r.annual.score)}<br><span class="sun-mut">동지 ${sBadge(r.winter.score)} ${gradeOf(r.winter.score)} · 최고 면 ${on[r.best.orient]}향 ${Math.round(r.best.mid.annual.score)}점</span></div></div>
${sBars(r.annual)}${rngNote(rg)}
<table class="sun-st"><tr><th>면</th><th>동지</th><th>연평균</th><th>방향 손실</th><th>가림 손실</th></tr>${rows}</table>
<div class="sun-sm">층별(연평균): ${bands}</div>
<details class="sun-sm sun-mut"><summary>읽는 법 · 한계</summary>연평균 = 춘분·하지·추분·동지 4일 평균(대표값). 북향이 낮은 것은 방향 때문(방향 손실)이며 가림과 구분해 읽으세요. ${r.assumed ? '<b class="sun-no">이 건물 높이는 추정치</b>. ' : ''}${esc(SCORE_NOTE)}</details></div>`;
    }
    function buildingScoreLine(id) {
      const b = Q && Q.byId.get(id); if (!b) return ''; const r = Q.scoreBuilding(b, { light: true }); if (!r.ok) return '';
      const on = { S: '남', E: '동', W: '서', N: '북' };
      const rg = scoreRng((Qx) => { const bb = Qx.byId.get(id); const rr = bb && Qx.scoreBuilding(bb, { light: true }); return rr && rr.ok ? rr.annual.score : null; }, r.annual.score);
      return `<p class="sun-line"><b>일조 점수</b> ${sBadge(r.annual.score, true)}${rngTxt(rg)} 연평균 · ${gradeOf(r.annual.score)} <span class="sun-mut">동지 ${Math.round(r.winter.score)} · 최고 면 ${on[r.best.orient]}향 · ${r.nFaces}면 평균(모델 추정)</span></p>`;
    }
    function facadeScoreHTML(res, f) {                    // query result: one wall at the selected floor
      const e = Q.edgesOf(res.building).find((x) => x.i === f.edge); if (!e) return '';
      const dd = S.kd, sf = Q.scoreFacade(res.building, e, res.floor, res.floorH, { m: dd.month, d: dd.day });
      const rg = scoreRng((Qx) => { const bb = Qx.byId.get(res.building.id), e2 = bb && Qx.edgesOf(bb).find((x) => x.i === f.edge); return e2 ? Qx.scoreFacade(bb, e2, res.floor, res.floorH).annual.score : null; }, sf.annual.score);
      const rows = [['1221', '동지'], ['0321', '춘분'], ['0621', '하지'], ['0923', '추분'], ['cur', `${dd.month}월 ${dd.day}일(슬라이더)`]].map(([k, lb]) => `<tr><th>${lb}</th><td>${sBadge(sf.byDate[k].score)}</td><td>${Math.round(sf.byDate[k].dir)}</td><td>${Math.round(sf.byDate[k].shade)}</td></tr>`).join('');
      return `<div class="sun-score"><div class="sun-sh"><b>일조 점수</b> <small class="sun-mut">${res.floor}층 · ${SQ.ORI_KO[f.orient]}향</small></div>
<div class="sun-sbig">${sBadge(sf.annual.score, true)}<div><b>연평균 ${Math.round(sf.annual.score)}점</b>${rngTxt(rg)} · ${gradeOf(sf.annual.score)}<br><span class="sun-mut">동지 ${sBadge(sf.winter.score)} ${gradeOf(sf.winter.score)}</span></div></div>
${sBars(sf.annual)}${rngNote(rg)}
<table class="sun-st"><tr><th>날짜</th><th>점수</th><th>방향 손실</th><th>가림 손실</th></tr>${rows}</table></div>`;
    }
    const cxCache = {};
    function complexSummary(items, key) {
      if (key && cxCache[key]) return cxCache[key];
      const its = (items || []).map((it) => ({ b: Q && Q.byId.get(it.id), tier: it.tier })).filter((x) => x.b);
      const out = Q ? Q.summarizeComplex(Q.scoreComplexParts(its)) : { ok: false, msg: '점수 계산용 건물 자료가 없습니다.' };
      out.mapped = (items || []).length; if (key) cxCache[key] = out; return out;
    }
    function complexScoreHTML(sum) {
      if (!sum.ok) return `<div class="sun-score"><b>일조 점수</b> <span class="sun-nos">${sum.mapped === 0 ? '매핑된 건물 없음 — 점수 없음' : esc(sum.msg)}</span><div class="sun-sm sun-mut">이 단지에 연결된 건물이 없어 점수를 계산하지 않습니다(건물→단지 근거가 없으면 반경 안 건물로 억지로 채우지 않음).</div></div>`;
      const li = sum.rows.map((r) => `<li data-bid="${r.b.id}" tabindex="0"><span class="t">${esc(Q.label(r.b))}${r.tier === 'B' ? ' <small class="sun-mut">(추정 연결)</small>' : ''}</span>${sBadge(r.annual)}<small class="sun-mut">동지 ${Math.round(r.winter)}</small></li>`).join('');
      return `<div class="sun-score"><div class="sun-sh"><b>일조 점수</b> <small class="sun-mut">단지 · 소속 건물 ${sum.n}동 평균(매핑 확정 ${sum.nA} + 추정 ${sum.nB}동 기준${sum.mapped > sum.n ? `, 점수 자료 없는 ${sum.mapped - sum.n}동 제외` : ''})</small></div>
<div class="sun-sbig">${sBadge(sum.annual, true)}<div><b>연평균 ${Math.round(sum.annual)}점</b> · ${gradeOf(sum.annual)}<br><span class="sun-mut">동지 ${sBadge(sum.winter)} · 최저 ${Math.round(sum.min.annual)}(${esc(Q.label(sum.min.b))}) · 최고 ${Math.round(sum.max.annual)}(${esc(Q.label(sum.max.b))})</span></div></div>
${sBars({ score: sum.annual, dir: sum.dir, shade: sum.shade })}
<ol class="sun-bl">${li}</ol>
<details class="sun-sm sun-mut"><summary>읽는 법 · 한계</summary>건물 점수(4면 평균, 중층 기준)의 단지 평균입니다. 건물을 누르면 건물 점수, 층·방향을 고르면 호실 점수. 매핑이 없는 건물은 제외됩니다. ${esc(SCORE_NOTE)}</details></div>`;
    }
    $('#sun-stat').style.display = 'none';

    // ---------------------------------------------------------------------------------------- point query (live ray-casting, flowmap/sun_addon/sun_query.js)
    const SQ = o.SunQuery || root.SunQuery; let Q = null;
    if (SQ) Q = SQ.create({ buildings: o.queryBuildings || [], getGroundHeight: gh, bounds: B, terrainMax: o.terrainMax != null ? o.terrainMax : 300, calc: api.calc, lat, lon });
    const qs = { orient: 'all', pick: false, last: null };
    const qp = document.createElement('div'); qp.id = 'sun-qpanel'; qp.className = 'sun-hidden';
    qp.innerHTML = '<div class="sun-hd"><b>☀ 일조 평가 결과</b><button class="sun-x" data-a="qclose" title="닫기">✕</button></div><div class="sun-bd" id="sun-qres"></div>';
    if (root.FMDrag) root.FMDrag.attach(qp, qp.querySelector('.sun-hd'), 'sunq', { sheet: true });
    host.appendChild(qp); qp.addEventListener('click', (e) => { if (e.target.dataset && e.target.dataset.a === 'qclose') qp.classList.add('sun-hidden'); }); qp.addEventListener('keydown', (e) => e.stopPropagation());
    const f1 = (v) => v.toFixed(1), DCOL = { '1221': '#2d6cdf', '0321': '#2a9d57', '0621': '#d94a3a', '0923': '#c98a00', cur: '#7a3fb5' };
    const DKEY = { '1221': [12, 21], '0321': [3, 21], '0621': [6, 21], '0923': [9, 23] };
    function barHTML(dt) {
      const t0 = 5, t1 = 20, seg = [];
      const sr = dt.intervals.length ? dt.intervals[0].from : t1, ss = dt.intervals.length ? dt.intervals[dt.intervals.length - 1].to : t1;
      const add = (a, b, col, tip) => { a = Math.max(a, t0); b = Math.min(b, t1); if (b > a) seg.push(`<i style="flex:${(b - a) / (t1 - t0) * 1000};background:${col}" title="${esc(tip)}"></i>`); };
      add(t0, sr, '#2b3248', '밤');
      for (const iv of dt.intervals) add(iv.from, iv.to, iv.lit ? '#ffd23f' : '#9aa3ad', `${hhmm(iv.from)}–${hhmm(iv.to)} ${iv.lit ? '직사광' : '그늘: ' + iv.key}`);
      add(ss, t1, '#2b3248', '밤');
      return `<div style="display:flex;height:12px;border:1px solid #8a949e;border-radius:3px;overflow:hidden">${seg.join('')}</div><div style="display:flex;justify-content:space-between;font-size:9.5px;color:#6a7580"><span>05</span><span>09</span><span>12</span><span>15</span><span>20시</span></div>`;
    }
    function ivText(dt) {
      return dt.intervals.map((iv) => `${hhmm(iv.from)}–${hhmm(iv.to)} ${iv.lit ? '<b class="sun-ok">일조</b>' : '그늘 · ' + esc(iv.key) + (iv.widx != null && Q.buildings[iv.widx].assumed ? ' <small>(높이 추정)</small>' : '')}`).join('<br>');
    }
    function sunPathSVG(f) {
      const W = 316, H = 150, m = 26, X = (az) => m + (az - 60) / 240 * (W - 2 * m), Y = (al) => H - m - al / 80 * (H - 2 * m);
      let g = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="background:#fbfcfd;border:1px solid #dde3e9;border-radius:4px">`;
      const band = (a0, a1, col) => { const lo = Math.max(60, a0), hi = Math.min(300, a1); if (hi > lo) g += `<rect x="${X(lo)}" y="${m - 6}" width="${X(hi) - X(lo)}" height="${H - 2 * m + 6}" fill="${col}"/>`; };
      for (const sh of [-360, 0, 360]) { band(f.az - 90 + sh, f.az + 90 + sh, 'rgba(255,214,64,.16)'); band(f.az - 45 + sh, f.az + 45 + sh, 'rgba(255,214,64,.28)'); }
      for (const a of [90, 135, 180, 225, 270]) g += `<line x1="${X(a)}" x2="${X(a)}" y1="${m - 6}" y2="${H - m}" stroke="#e3e8ed"/><text x="${X(a)}" y="${H - m + 11}" font-size="9" text-anchor="middle" fill="#6a7580">${{ 90: '동', 135: '남동', 180: '남', 225: '남서', 270: '서' }[a]}</text>`;
      for (const a of [0, 30, 60]) g += `<line x1="${m}" x2="${W - m}" y1="${Y(a)}" y2="${Y(a)}" stroke="#e3e8ed"/><text x="${m - 3}" y="${Y(a) + 3}" font-size="9" text-anchor="end" fill="#6a7580">${a}°</text>`;
      for (const dt of f.dates) {
        const md = dt.key === 'cur' ? [dt.m, dt.d] : DKEY[dt.key], sm = Q.samples(md[0], md[1]);
        const pts = sm.filter((s) => s.az >= 60 && s.az <= 300).map((s) => `${X(s.az).toFixed(1)},${Y(s.alt).toFixed(1)}`).join(' ');
        g += `<polyline points="${pts}" fill="none" stroke="${DCOL[dt.key]}" stroke-width="${dt.key === '1221' ? 2 : 1.3}"${dt.key === 'cur' ? ' stroke-dasharray="4 3"' : ''}/>`;
        if (dt.key === '1221') for (const s of dt.steps) if (s.az >= 60 && s.az <= 300) g += `<circle cx="${X(s.az).toFixed(1)}" cy="${Y(s.alt).toFixed(1)}" r="1.9" fill="${s.lit ? '#ffb000' : '#6b7480'}"/>`;
      }
      return g + `<text x="${W - 4}" y="10" font-size="8.5" text-anchor="end" fill="#6a7580">태양 경로(동지 점: 노랑=직사광, 회색=그늘) · 연한 띠 = 벽이 바라보는 방위</text></svg>`;
    }
    function profileSVG(f, res) {
      const P = f.profile || [], W = 316, H = 110, m = 22, n = Math.max(1, res.floors), bw = (W - 2 * m) / n, mx = Math.max(6, ...P.map((p) => p[1])), y4 = H - 18 - 4 / mx * (H - 34);
      let g = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="background:#fbfcfd;border:1px solid #dde3e9;border-radius:4px"><line x1="${m}" x2="${W - m}" y1="${y4}" y2="${y4}" stroke="#2a9d57" stroke-dasharray="3 3"/><text x="${W - m}" y="${y4 - 3}" font-size="9" text-anchor="end" fill="#2a9d57">4 h</text>`;
      for (const [fl, t] of P) { const h = t / mx * (H - 34), x = m + (fl - 1) * bw; g += `<rect x="${x + 0.5}" y="${H - 18 - h}" width="${Math.max(1, bw - 1)}" height="${Math.max(0.5, h)}" fill="${fl === res.floor ? '#e08a00' : '#f2c94c'}"><title>${fl}층 ${f1(t)} h</title></rect>`; }
      for (let fl = 1; fl <= n; fl += Math.max(1, Math.ceil(n / 10))) g += `<text x="${m + (fl - 0.5) * bw}" y="${H - 6}" font-size="9" text-anchor="middle" fill="#6a7580">${fl}</text>`;
      return g + `<text x="${m}" y="9" font-size="9" fill="#6a7580">층별 동지 9~15시 직사광 합계(h) · 선택 층 = 주황</text></svg>`;
    }
    function renderResult(res, ctx) {
      const el = qp.querySelector('#sun-qres');
      if (!res.ok) { el.innerHTML = `<div class="sun-note sun-err">${esc(res.msg)}</div>`; qp.classList.remove('sun-hidden'); return; }
      const b = res.building, fh = res.floorH, un = ctx && ctx.unit;
      let h = `<b>${esc(Q.label(b))}</b> ${res.floor}층 <small>(층고 ${fh} m, 바닥 +${f1((res.floor - 1) * fh)} m, 창 높이 +1.2 m · 이 건물 ${res.floors}층 규모)</small>`;
      if (un) h += `<br>입력 호수: ${esc(un.text)} → ${un.floor}층 · 라인 ${un.line}<br><span class="sun-no">호 라인의 방향 정보가 없어 방향을 직접 선택하세요. (호별 배치 자료 없음 → 기본으로 네 방향을 모두 표시)</span>`;
      h += `<br>${b.assumed ? '<b class="sun-no">이 건물 높이는 추정치</b>' : '이 건물 높이: OSM/대장 값'} · 계산 ${f1(res.ms)} ms`;
      res.facades.forEach((f, k) => {
        if (f.missing) { h += `<div class="sun-card"><b>${SQ.ORI_KO[f.orient]}향</b>: 이 방향의 벽이 없습니다.</div>`; return; }
        const d0 = f.dates[0];
        h += `<details class="sun-card"${k === 0 || res.facades.length === 1 ? ' open' : ''}><summary><b>${SQ.ORI_KO[f.orient]}향 벽</b> · 실제 방위 ${f.az.toFixed(0)}° (${compass(f.az)}) · 벽 길이 ${f1(f.len)} m · 동지 ${f1(d0.tot)} h</summary>`;
        h += '<table><tr><th>날짜</th><th>직사광 합계</th><th>최장 연속</th></tr>' + f.dates.map((d) => `<tr><td style="color:${DCOL[d.key]}">${d.label}</td><td>${f1(d.tot)} h</td><td>${f1(d.run)} h</td></tr><tr><td colspan="3" style="padding:1px 3px">${barHTML(d)}</td></tr>`).join('') + '</table>';
        h += `<div style="margin:5px 0"><b>동지 9~15시 참고 기준</b> (09–15시 창 안: 합계 ${f1(d0.wtot)} h, 최장 연속 ${f1(d0.wrun)} h)<br>연속 2시간 이상: <span class="${d0.meetsRun ? 'sun-ok' : 'sun-no'}">${d0.meetsRun ? '충족' : '미충족'}</span> · 합계 4시간 이상: <span class="${d0.meetsTotal ? 'sun-ok' : 'sun-no'}">${d0.meetsTotal ? '충족' : '미충족'}</span> <small>(참고 기준, 법적 판정 아님)</small></div>`;
        h += `<div style="font-size:11.5px"><b>동지 시간대별</b><br>${ivText(d0)}</div>`;
        const cd = f.dates.find((d) => d.key === 'cur'); if (cd) h += `<div style="font-size:11.5px;margin-top:3px"><b>${cd.label} 시간대별</b><br>${ivText(cd)}</div>`;
        h += `<div style="margin-top:5px"><b>주요 가림 요인 (동지 하루)</b><br>${f.blockers.length ? f.blockers.map((x, i) => `${i + 1}. ${esc(x.name)} — ${f1(x.hours)} h${x.assumed ? ' <small class="sun-no">(높이 추정)</small>' : ''}`).join('<br>') : '없음 (가림 없음)'}</div>`;
        h += facadeScoreHTML(res, f);
        h += `<div style="margin-top:5px">${sunPathSVG(f)}</div><div style="margin-top:5px">${profileSVG(f, res)}</div><div style="margin-top:6px"><button class="sun-b" data-win="${b.id}|${res.floor}|${f.edge}">창가 시점</button> <span class="sun-mut sun-sm">이 벽 ${res.floor}층 창가에서 바깥 보기(실내·창 크기·같은 층 내 호 위치는 반영하지 않음)</span></div></details>`;
      });
      h += '<div class="sun-note"><b>한계</b>: 건물 높이는 일부가 추정치(위 표시)이고, 지형은 건설 이전 SRTM급, 나무·발코니·처마·창 위치는 반영하지 않으며 OSM 윤곽은 단순화되어 있고 2026년 이전 자료입니다. 호 라인의 방향 자료가 없습니다. 설명용 계산이며 법적 일조 판정이나 구매 권유가 아닙니다.</div>';
      el.innerHTML = h; qp.classList.remove('sun-hidden');
    }
    // ---- 창가 시점: camera on the outer wall of one building/floor/facade (host implements o.onWindowView)
    let WVc = null;      // 조망 요약 카드 컨트롤러 (window_view.js), 창가 시점 중에만 active
    function windowViewFrom(res, f, vaz, edgeDiff) {
      if (!o.onWindowView || !res || !res.ok || !f || f.missing) return false;
      const d0 = f.dates.find((d) => d.key === '1221') || f.dates[0], b = res.building, WVm = root.WindowView;
      const e = Q.edgesOf(b).find((x) => x.i === f.edge), sf = e ? Q.scoreFacade(b, e, res.floor, res.floorH) : null;
      const rgw = sf ? scoreRng((Qx) => { const bb = Qx.byId.get(b.id), e2 = bb && Qx.edgesOf(bb).find((x) => x.i === f.edge); return e2 ? Qx.scoreFacade(bb, e2, res.floor, res.floorH).annual.score : null; }, sf.annual.score) : null;
      const az = vaz != null ? vaz : f.az, eyeZ = WVm ? WVm.eyeZ(b, res.floor, res.floorH) : f.pt.z;     // 눈높이 = z0 + (층-1)*층고 + 1.4 m (일조 점 평가는 +1.2 m)
      const w = { id: b.id, idx: b.idx, label: Q.label(b), floor: res.floor, floors: res.floors, floorH: res.floorH, orient: SQ.ORI_KO[f.orient], az, edgeAz: f.az, edge: f.edge, edgeDiff: edgeDiff || 0, pt: f.pt, eyeZ, hours: d0.tot, wHours: d0.wtot, assumed: !!b.assumed, score: sf ? sf.annual.score : null, scoreLo: rgw ? rgw[0] : null, scoreHi: rgw ? rgw[1] : null, scoreWinter: sf ? sf.winter.score : null };
      o.onWindowView(w); setWindowSky(true);
      if (WVc) WVc.show(w);
      return true;
    }
    // 창가 시점 열기/갱신. edge 가 있으면 그 벽, 아니면 az(도, 북 0 시계방향)에 가장 맞는 벽, 아니면 orient(남·동·서·북 기본 남).
    function windowViewAt(id, floor, edge, orient, az) {
      if (!Q) return false; const b = Q.byId.get(id) || Q.byId.get(+id); if (!b) return false;
      const dd = S.kd, fh = +$('#sun-qh').value || 2.8, N = Q.floorsOf(b, fh);
      const fl = Math.min(Math.max(1, Math.round(floor || +$('#sun-qf').value || 1)), Math.max(1, N));
      let q = { index: b.idx, floor: fl, floorH: fh, cur: { m: dd.month, d: dd.day } }, vaz = null, diff = 0;
      if (edge != null && edge !== '' && !isNaN(edge)) { q.edge = +edge; if (az != null && !isNaN(az)) vaz = ((+az % 360) + 360) % 360; }
      else if (az != null && !isNaN(az) && root.WindowView) { const pk = root.WindowView.pickEdge(Q.edgesOf(b), +az); if (pk) { q.edge = pk.edge.i; vaz = ((+az % 360) + 360) % 360; diff = pk.diff; } }
      if (q.edge == null) q.orient = orient || (qs.orient === 'all' ? 'S' : qs.orient);
      const res = Q.query(q);
      if (!res.ok) { $('#sun-qmsg').textContent = res.msg; return false; }
      const f0 = res.facades[0]; if (vaz != null && diff > 45) vaz = f0.az;     // 벽이 그 방향을 향하지 않으면 가장 가까운 벽의 바깥 방향으로 본다
      return windowViewFrom(res, f0, vaz, diff);
    }
    qp.addEventListener('click', (e) => { const t = e.target.closest && e.target.closest('[data-win]'); if (!t) return; const [id, fl, ed] = t.dataset.win.split('|'); windowViewAt(isNaN(+id) ? id : +id, +fl, +ed); });
    $('#sun-qwin').onclick = () => { const res = runQuery(); if (res && res.ok) windowViewFrom(res, res.facades[0]); else if (res && !res.ok) { /* message shown by runQuery */ } };
    let marker = null;
    function placeMarker(res) {
      if (!res.facades || !res.facades.length || res.facades[0].missing) return;
      if (!marker) { marker = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffb454, depthTest: false })); marker.renderOrder = 9; marker.userData.noPick = true; scene.add(marker); }
      const p = res.facades[0].pt; marker.position.set(p.x, p.z, -p.y); marker.visible = true; if (o.requestRender) o.requestRender();
    }
    // ---- ANY surface point (no building needed): ground / yard / field / slope / roof / wall / window height. Picked in the 3D scene (hit point + real surface normal),
    //      typed as lon,lat, the camera centre, or the walk-mode standing spot.
    const PT = { mode: 'bld', kind: 'A', orient: 'all', h: 1.6, last: null, auto: false, look: false };
    const hm = (h) => `${Math.floor(h + 1e-9)}시간 ${String(Math.round((h % 1) * 60)).padStart(2, '0')}분`;
    const SLOTC = ['#1b2338', 'var(--acc,#1f55b5)', '#8a97a8', '#cfd6df'], SLOTL = ['밤(해 없음)', '직사광', '가림(건물·산)', '면이 해를 등짐'];
    function sun24(slots) {
      let st = [], i = 0, n = slots.length;
      while (i < n) { let j = i; while (j < n && slots[j] === slots[i]) j++; st.push(`${SLOTC[slots[i]]} ${(i / n * 100).toFixed(2)}% ${(j / n * 100).toFixed(2)}%`); i = j; }
      return `<div class="sun-24" role="img" aria-label="하루 24시간 일조 막대" style="background:linear-gradient(90deg,${st.join(',')})"></div>`;
    }
    const ORK = { S: '남', E: '동', W: '서', N: '북' };
    const C16 = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'];
    const c16 = (az) => C16[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
    function toLL(x, y) { const g = o.geo; if (!g) return null; return [g.lon0 + x / (111320 * Math.cos(g.lat0 * D2R)), g.lat0 + y / 110574]; }
    function fromLL(lon, lat) { const g = o.geo; if (!g) return null; return [(lon - g.lon0) * 111320 * Math.cos(g.lat0 * D2R), (lat - g.lat0) * 110574]; }
    function surfaceLabel(res, r) {
      if (r.orient === 'n') return r.tilt < 8 ? '수평면(위를 향함)' : r.tilt > 82 ? `수직면 · 방위 ${Math.round(r.az)}°(${c16(r.az)}향)` : `경사면 · 방위 ${Math.round(r.az)}°(${c16(r.az)}향) · 기울기 ${Math.round(r.tilt)}°`;
      return r.orient == null ? '수평면' : ORK[r.orient] + '향 수직면';
    }
    function pointResultHTML(res, tg) {
      const ll = toLL(res.x, res.y), inf = res.info, dd = S.kd, nb = Q.buildings.filter((b) => !b.ctx).length, fl = Math.floor(Math.max(0, res.h) / 2.8) + 1;
      const kindTxt = tg ? { ground: '지면', wall: '벽·창 높이의 점', roof: '지붕(옥상)', stand: '걸어보기로 서 있는 곳', look: '걸어보기로 바라보는 것', manual: '입력한 지점' }[tg.type] || '지점' : '지점';
      let h = `<b>지점 일조 평가</b> <small class="sun-mut">대상: ${kindTxt}${tg && tg.name ? ' · ' + esc(tg.name) : ''}</small><br>`;
      h += `<span class="sun-mut sun-sm">고도 해발 ${f1(res.z)} m (지상 ${f1(res.h)} m, 약 ${fl}층) · ${ll ? `경도 ${ll[0].toFixed(5)}, 위도 ${ll[1].toFixed(5)} · ` : ''}지면 해발 ${f1(inf.elev)} m · 남쪽 산(지형) 지평선 최대 ${f1(inf.horizonSouth)}°(방위 ${inf.azSouth}°) · 전체 최대 ${f1(inf.horizonAll)}°</span>`;
      for (const r of res.results) {
        const noDir = r.orient == null || (r.orient === 'n' && r.tilt < 8), A = r.annual, W = r.winter;
        h += `<div class="sun-score"><div class="sun-sh"><b>${surfaceLabel(res, r)}</b> <small class="sun-mut">연평균 = 춘분·하지·추분·동지 4일 평균</small></div>
<div class="sun-sbig">${sBadge(A.score, true)}<div><b>연평균 ${Math.round(A.score)}점</b> · ${gradeOf(A.score)}<br><span class="sun-mut">동지 ${sBadge(W.score)} ${gradeOf(W.score)} · 연평균 직사광 ${hm(A.litH)}/${hm(A.dayH)}</span></div></div>
${sBars(Object.assign({ noDir }, A))}`;
        const rows = [['1221', '동지'], ['0321', '춘분'], ['0621', '하지'], ['0923', '추분'], ['cur', `${dd.month}월 ${dd.day}일(슬라이더)`]].filter(([k]) => r.byDate[k]).map(([k, lb]) => {
          const d = r.byDate[k]; return `<tr><th>${lb}</th><td>${sBadge(d.score)}</td><td>${hm(d.litH)}</td><td>${hhmm(d.rise)}–${hhmm(d.set)}</td>${noDir ? '' : `<td>${Math.round(d.dir)}</td>`}<td>${Math.round(d.shade)}</td></tr><tr><td colspan="${noDir ? 5 : 6}" style="padding:1px 3px">${sun24(d.slots)}</td></tr>`;
        }).join('');
        h += `<table class="sun-st"><tr><th>날짜</th><th>점수</th><th>직사광</th><th>일출–일몰</th>${noDir ? '' : '<th>방향 손실</th>'}<th>가림 손실</th></tr>${rows}</table>
<div class="sun-lgd">${SLOTL.map((t, i) => (noDir && i === 3 ? '' : `<span><i style="background:${SLOTC[i]}"></i>${t}</span>`)).join('')}<span class="sun-mut">막대 = 0~24시(10분 칸)</span></div></div>`;
      }
      const notes = [];
      if (!nb) notes.push('이 범위에는 건물 자료가 없어 지형(산) 가림만 반영했습니다.');
      if (res.outside) notes.push('건물 자료 범위 밖의 지점이라 건물 가림은 반영되지 않았습니다.');
      if (tg && tg.type === 'wall') notes.push('창은 OSM에 정보가 없어 \'벽의 해당 높이 점\'으로 정의했습니다(창 크기·유리 반사·실내·발코니는 반영하지 않음). 벽 방위는 실제 외벽 방향(4방향으로 맞추지 않음)입니다.');
      h += `<div class="sun-note">${notes.map((t) => esc(t) + '<br>').join('')}<b>산 그림자는 근사</b>입니다: 지형 해상도 ${o.terrainRes ? Math.round(o.terrainRes) + ' m' : '(알 수 없음)'}, 나무·울타리·작은 구조물·단지 조경은 반영하지 않습니다. 직사광 = 해가 지평선 위 AND 면의 바깥쪽 AND 건물·지형에 가려지지 않음(자기 건물 포함). 수평면은 방향 손실이 없고, 건물 높이 일부는 추정입니다. ${esc(SCORE_NOTE)}</div>`;
      if (o.onPointView) h += `<div style="margin-top:6px"><button class="sun-b" data-pv="${res.x.toFixed(2)}|${res.y.toFixed(2)}">지점 시점(걸어보기로 이 위치에 서기)</button></div>`;
      return h;
    }
    let pinArrow = null;
    function placePinXYZ(x, y, z, n) {
      if (!marker) { marker = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffb454, depthTest: false })); marker.renderOrder = 9; marker.userData.noPick = true; scene.add(marker); }
      marker.position.set(x, z, -y); marker.visible = true;
      if (!pinArrow && THREE.ArrowHelper) { pinArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 7, 0xffb454, 2.2, 1.4); pinArrow.userData.noPick = true; pinArrow.traverse((c) => { c.renderOrder = 9; if (c.material) { c.material.depthTest = false; } c.userData.noPick = true; }); scene.add(pinArrow); }
      if (pinArrow) { if (n) { pinArrow.position.set(x, z, -y); pinArrow.setDirection(new THREE.Vector3(n[0], n[2], -n[1]).normalize()); pinArrow.visible = true; } else pinArrow.visible = false; }
      if (o.requestRender) o.requestRender();
    }
    // spec: { x, y, z? (absolute) | h?, normal? [nx,ny,nz], own?, target?: {type, name} }
    function evalPoint(x, y, spec) {
      spec = spec || {};
      const msg = $('#sun-ptmsg'); if (!Q) { msg.textContent = '이 화면에는 일조 계산 엔진이 없습니다.'; return null; }
      const dd = S.kd, q = { x, y, cur: { m: dd.month, d: dd.day }, own: spec.own };
      if (spec.z != null) q.z = spec.z; else q.h = spec.h != null ? spec.h : PT.h;
      // surface: 'A' = the picked surface as it is; 'H' flat; 'V' a wall of the chosen bearing at this point
      if (PT.kind === 'A' && spec.normal) q.normal = spec.normal; else if (PT.kind === 'V') { q.kind = 'V'; q.orient = PT.orient; } else q.kind = 'H';
      if (PT.kind === 'A' && !spec.normal) q.kind = 'H';
      const res = Q.scoreAnyPoint(q); if (!res.ok) { msg.textContent = res.msg; return null; }
      PT.last = { x, y, spec }; let qr = qp.querySelector('#sun-qres'); if (!qr) { const bd = document.createElement('div'); bd.className = 'sun-bd'; bd.id = 'sun-qres'; qp.appendChild(bd); qr = bd; }   /* guard: a re-parented/rebuilt panel lost its body once (console: 'Cannot set properties of null') */
      qr.innerHTML = pointResultHTML(res, spec.target); qp.classList.remove('sun-hidden');
      placePinXYZ(res.x, res.y, res.z, res.results.length === 1 ? res.results[0].normal : null);
      msg.textContent = `선택한 점: 해발 ${f1(res.z)} m(지상 ${f1(res.h)} m). 다른 곳을 누르면 다시 평가합니다.`; return res;
    }
    function marchGround(origin, dir) {   // first intersection of a view ray with the terrain height function
      let t = 2; const maxT = 30000;
      while (t < maxT) {
        const px = origin.x + dir.x * t, pz = origin.z + dir.z * t, py = origin.y + dir.y * t;
        if (py < gh(px, -pz)) { let a = t - Math.max(2, t * 0.02), b = t; for (let k = 0; k < 16; k++) { const m = (a + b) / 2; if (origin.y + dir.y * m < gh(origin.x + dir.x * m, -(origin.z + dir.z * m))) b = m; else a = m; } return (a + b) / 2; }
        t += Math.max(2, t * 0.012);
      }
      return null;
    }
    function ownAt(h0, x, y) {            // the building a picked wall/roof belongs to (index into Q.buildings), or -1
      let b = null; if (o.idFromHit) { const id = o.idFromHit(h0); if (id != null) b = Q.byId.get(id); }
      if (!b) { let bd = 3; for (const c of Q.buildings) { if (x < c.bbox[0] - 3 || x > c.bbox[2] + 3 || y < c.bbox[1] - 3 || y > c.bbox[3] + 3) continue; const e = Q.nearestEdge(c, x, y); if (!e) continue; const dd = Math.abs((x - e.cx) * e.nx + (y - e.cy) * e.ny); if (dd < bd) { bd = dd; b = c; } } }
      return b ? b : null;
    }
    function pickAtNDC(ndcx, ndcy, tgType) {
      const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(ndcx, ndcy), camera);
      const hits = rc.intersectObjects(bmeshes, false).filter((h) => !h.object.userData.noPick), tg = marchGround(rc.ray.origin, rc.ray.direction);
      if (hits.length && (tg == null || hits[0].distance < tg)) {
        const h0 = hits[0], nw = h0.face ? h0.face.normal.clone().transformDirection(h0.object.matrixWorld) : new THREE.Vector3(0, 1, 0), n = [nw.x, -nw.z, nw.y], x = h0.point.x, y = -h0.point.z, z = h0.point.y, b = ownAt(h0, x, y);
        const roof = n[2] > 0.7;
        return evalPoint(x, y, { z, normal: n, own: b ? b.idx : undefined, target: { type: tgType || (roof ? 'roof' : 'wall'), name: b ? Q.label(b) : '' } });
      }
      if (tg == null) { $('#sun-ptmsg').textContent = '지면을 찾지 못했습니다(하늘을 눌렀을 수 있습니다).'; return null; }
      const x = rc.ray.origin.x + rc.ray.direction.x * tg, y = -(rc.ray.origin.z + rc.ray.direction.z * tg), nrm = Q.terrainNormal(x, y, Math.max(10, o.terrainRes || 10));
      return evalPoint(x, y, { normal: nrm, target: { type: tgType || 'ground' } });
    }
    function pickPoint(cx, cy) { const r = dom.getBoundingClientRect(); return pickAtNDC(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); }
    function pickCenter() { return pickAtNDC(0, 0, 'look'); }
    // ---- walk mode: the standing spot (shared with the walk start-point picking) is the evaluation point
    function evalStand(quiet) {
      const st = o.getStand && o.getStand(); const m = $('#sun-standmsg');
      if (!st) { m.textContent = '걸어보기로 서는 곳을 먼저 고르세요.'; return null; }
      const spec = { target: { type: 'stand' }, h: PT.h };
      if (PT.look && st.yaw != null) { const az = ((-st.yaw * 180 / Math.PI) % 360 + 360) % 360; spec.normal = [Math.sin(az * D2R), Math.cos(az * D2R), 0]; spec.target = { type: 'stand', name: `보는 방향 ${Math.round(az)}°(${c16(az)})` }; }
      const sk = PT.kind; if (sk === 'A') PT.kind = spec.normal ? 'A' : 'H';
      const res = evalPoint(st.x, st.y, spec); PT.kind = sk; PT.stand = { x: st.x, y: st.y, yaw: st.yaw }; return res;
    }
    function standUI() {
      const st = o.getStand && o.getStand(), m = $('#sun-standmsg'); if (!m) return;
      $('#sun-standgo').disabled = !st; $('#sun-standlook').disabled = !(st && st.walking);
      m.textContent = st ? (st.walking ? '걸어보기 중: 지금 서 있는 곳(눈높이 1.6 m)을 평가할 수 있습니다. 화면을 눌러 벽·지면을 고르면 그 점을 평가합니다.' : '선택한 서는 곳이 있습니다. 평가하거나 걸어보기를 시작하세요.') : '걸어보기로 서는 곳을 먼저 고르세요.';
      const cr = document.getElementById('fm-cross'); if (cr) cr.style.display = st && st.walking ? 'block' : 'none';
    }
    const crossEl = document.createElement('div'); crossEl.id = 'fm-cross'; crossEl.setAttribute('aria-hidden', 'true'); host.appendChild(crossEl);
    setInterval(() => {
      standUI(); if (!PT.auto) return; const st = o.getStand && o.getStand(); if (!st || !PT.stand) return;
      if (Math.hypot(st.x - PT.stand.x, st.y - PT.stand.y) > 0.8 || (PT.look && st.yaw != null && Math.abs(st.yaw - PT.stand.yaw) > 0.12)) evalStand(true);
    }, 600);
    function setPtMode(m) {
      PT.mode = m; window.__fmPointMode = m === 'pt'; document.body.classList.toggle('fm-pointmode', m === 'pt');
      panel.querySelectorAll('#sun-mode [data-m]').forEach((b) => { b.classList.toggle('on', b.dataset.m === m); b.setAttribute('aria-pressed', b.dataset.m === m ? 'true' : 'false'); });
      $('#sun-ptopt').style.display = m === 'pt' ? 'block' : 'none'; dom.style.cursor = m === 'pt' ? 'crosshair' : '';
      if (m === 'pt') { qs.pick = false; $('#sun-qpick').classList.remove('on'); $('#sun-ptmsg').textContent = '3D 장면의 지면·벽·지붕을 눌러 그 점의 위치·고도·면 방향으로 일조를 평가합니다. 걸어보기 중에도 됩니다.'; }
      else $('#sun-ptmsg').textContent = '지도를 눌러 일조를 평가합니다. 건물·단지는 그대로 누르고, 마당·공원·논밭·산·벽·창 높이는 \'지점 선택\'을 켠 뒤 누르세요.';
    }
    const rePt = () => { if (PT.last) evalPoint(PT.last.x, PT.last.y, PT.last.spec); };
    panel.querySelectorAll('#sun-mode [data-m]').forEach((b) => b.addEventListener('click', () => setPtMode(b.dataset.m)));
    panel.querySelectorAll('#sun-ptk [data-k]').forEach((b) => b.addEventListener('click', () => { PT.kind = b.dataset.k; panel.querySelectorAll('#sun-ptk [data-k]').forEach((c) => { c.classList.toggle('on', c === b); c.setAttribute('aria-pressed', c === b ? 'true' : 'false'); }); $('#sun-pto').style.display = PT.kind === 'V' ? 'flex' : 'none'; rePt(); }));
    panel.querySelectorAll('#sun-pto [data-po]').forEach((b) => b.addEventListener('click', () => { PT.orient = b.dataset.po; panel.querySelectorAll('#sun-pto [data-po]').forEach((c) => c.classList.toggle('on', c === b)); rePt(); }));
    const hFix = () => { if (PT.last && PT.last.spec) { delete PT.last.spec.z; PT.last.spec.h = PT.h; } rePt(); };
    $('#sun-pth').addEventListener('change', (e) => { PT.h = Math.max(0, Math.min(100, +e.target.value || 0)); e.target.value = PT.h; $('#sun-ptf').value = ''; hFix(); });
    $('#sun-ptf').addEventListener('change', (e) => { const f = Math.max(1, Math.min(36, Math.round(+e.target.value || 1))); e.target.value = f; PT.h = Math.min(100, +((f - 1) * 2.8 + 1.2).toFixed(1)); $('#sun-pth').value = PT.h; hFix(); });
    $('#sun-pth').value = PT.h;
    $('#sun-ptgo').onclick = () => {
      const m = /(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/.exec($('#sun-ptc').value || ''); if (!m) { $('#sun-ptmsg').textContent = '경도,위도를 입력하세요(예 127.25,35.22).'; return; }
      const xy = fromLL(+m[1], +m[2]); if (!xy) { $('#sun-ptmsg').textContent = '이 뷰어에는 좌표 변환 정보가 없습니다.'; return; }
      setPtMode('pt'); evalPoint(xy[0], xy[1], { target: { type: 'manual' } });
    };
    $('#sun-ptcam').onclick = () => { const c = o.cameraCenter && o.cameraCenter(); if (!c) { $('#sun-ptmsg').textContent = '카메라 중심을 알 수 없습니다.'; return; } setPtMode('pt'); evalPoint(c.x, c.y, { target: { type: 'manual' } }); };
    $('#sun-standgo').onclick = () => { setPtMode('pt'); evalStand(); };
    $('#sun-standwalk').onclick = () => { if (o.startWalkPick) { o.startWalkPick(); setPtMode('pt'); } else $('#sun-standmsg').textContent = '이 뷰어에는 걸어보기가 없습니다.'; };
    $('#sun-standlook').onclick = () => { PT.look = !PT.look; $('#sun-standlook').classList.toggle('on', PT.look); evalStand(); };
    $('#sun-standauto').addEventListener('change', (e) => { PT.auto = e.target.checked; });
    qp.addEventListener('click', (e) => { const t = e.target.closest && e.target.closest('[data-pv]'); if (!t || !o.onPointView) return; const [x, y] = t.dataset.pv.split('|').map(Number); o.onPointView({ x, y }); });
    // HUD buttons of the walk pad (present in the viewer template; the add-on only wires them)
    const wS = document.getElementById('wSun'), wL = document.getElementById('wLook');
    if (wS) wS.addEventListener('click', () => { setPtMode('pt'); evalStand(); });
    if (wL) wL.addEventListener('click', () => { setPtMode('pt'); pickCenter(); });
    function setOChips() { panel.querySelectorAll('#sun-qo [data-o]').forEach((c) => c.classList.toggle('on', c.dataset.o === qs.orient)); }
    function runQuery(extra) {
      const msg = $('#sun-qmsg'); msg.textContent = '';
      if (!Q) { msg.textContent = '이 화면에는 점 질의용 건물 자료가 없습니다.'; return null; }
      const txt = $('#sun-qb').value; let b = null;
      if (extra && extra.id != null) b = Q.byId.get(extra.id);
      else { const m = Q.find(txt, o.complexLabels); if (!m.length) { msg.textContent = `'${txt}' 건물을 찾지 못했습니다. 목록에서 선택하세요.`; return null; } b = m[0]; if (m.length > 1) msg.textContent = `같은 이름 ${m.length}개 중 첫 번째를 사용했습니다(단지명을 앞에 붙이면 구분).`; }
      const unit = SQ.parseUnit($('#sun-qu').value); let floor = +$('#sun-qf').value || 1;
      if (unit) { floor = unit.floor; $('#sun-qf').value = floor; if (!(extra && extra.edge != null)) { qs.orient = 'all'; setOChips(); } }
      const dd = S.kd;
      const res = Q.query({ index: b.idx, floor, floorH: +$('#sun-qh').value || 2.8, orient: qs.orient, edge: extra && extra.edge, cur: { m: dd.month, d: dd.day } });
      qs.last = { b, unit };
      if (!res.ok) msg.textContent = res.msg;
      renderResult(res, { unit });
      if (res.ok) placeMarker(res);
      return res;
    }
    if (Q) { $('#sun-qlist').innerHTML = Q.labelsList(o.complexLabels).map((x) => `<option value="${esc(x[0])}">`).join(''); }
    panel.querySelector('#sun-qo').addEventListener('click', (e) => { const k = e.target.dataset.o; if (k) { qs.orient = k; setOChips(); } });
    $('#sun-qgo').onclick = () => runQuery();
    ['#sun-qb', '#sun-qf', '#sun-qu', '#sun-qh'].forEach((s) => $(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') runQuery(); }));
    $('#sun-qu').addEventListener('input', () => { const u = SQ && SQ.parseUnit($('#sun-qu').value); if (u) $('#sun-qmsg').textContent = '호 라인의 방향 정보가 없어 방향을 직접 선택하세요. (층만 사용: ' + u.floor + '층)'; });
    $('#sun-qpick').onclick = () => { qs.pick = !qs.pick; $('#sun-qpick').classList.toggle('on', qs.pick); $('#sun-qmsg').textContent = qs.pick ? '건물 벽을 클릭하세요(클릭한 높이의 층, 벽의 방향이 사용됩니다).' : ''; };
    let pd = null; const dom = renderer.domElement;
    dom.addEventListener('pointerdown', (e) => { pd = [e.clientX, e.clientY]; });
    function pickAt(cx, cy) {
      const r = dom.getBoundingClientRect(), ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, camera); const hits = rc.intersectObjects(bmeshes, false).filter((h) => !h.object.userData.noPick);
      if (!hits.length) { $('#sun-qmsg').textContent = '건물이 선택되지 않았습니다.'; return; }
      const h0 = hits[0], x = h0.point.x, y = -h0.point.z, z = h0.point.y, nrm = h0.face ? h0.face.normal.clone().transformDirection(h0.object.matrixWorld) : null;
      if (nrm && nrm.y > 0.7) { $('#sun-qmsg').textContent = '지붕이 선택됐습니다. 벽을 클릭하세요.'; return; }
      let b = o.idFromHit ? Q.byId.get(o.idFromHit(h0)) : null;
      if (!b) { let bd = 1e9; for (const c of Q.buildings) { if (x < c.bbox[0] - 8 || x > c.bbox[2] + 8 || y < c.bbox[1] - 8 || y > c.bbox[3] + 8) continue; const ee = Q.nearestEdge(c, x, y); if (!ee) continue; const dd = Math.abs((x - ee.cx) * ee.nx + (y - ee.cy) * ee.ny); if (dd < bd) { bd = dd; b = c; } } }
      if (!b) { $('#sun-qmsg').textContent = '이 벽의 건물을 알 수 없습니다.'; return; }
      const ed = Q.nearestEdge(b, x, y), fh = +$('#sun-qh').value || 2.8, fl = clamp(Math.floor((z - b.z0) / fh) + 1, 1, Math.max(1, Q.floorsOf(b, fh)));
      $('#sun-qb').value = Q.label(b); $('#sun-qf').value = fl; $('#sun-qu').value = ''; qs.orient = ed.orient; setOChips();
      qs.pick = false; $('#sun-qpick').classList.remove('on');
      showBuilding(b.id); runQuery({ id: b.id, edge: ed.i });
      $('#sun-qmsg').textContent = `선택: ${Q.label(b)} ${fl}층 ${SQ.ORI_KO[ed.orient]}향 벽 (실제 방위 ${ed.az.toFixed(0)}°, ${compass(ed.az)})`;
    }
    dom.addEventListener('pointerup', (e) => { if (PT.mode === 'pt' && pd && Math.hypot(e.clientX - pd[0], e.clientY - pd[1]) <= 5) pickPoint(e.clientX, e.clientY); });
    dom.addEventListener('pointerup', (e) => { if (qs.pick && pd && Math.hypot(e.clientX - pd[0], e.clientY - pd[1]) <= 5 && Q) pickAt(e.clientX, e.clientY); });

    // ---------------------------------------------------------------------------------------- wiring
    function refresh(cause) { computeSun(); updateReadout(); skyAndLight(); if (WVc && WVc.active) WVc.onRefresh(); dirty = true; if (o.requestRender) o.requestRender(); if (cause !== 'play') save(); }
    $('#sun-d').addEventListener('input', (e) => { S.doy = +e.target.value; S.doyF = S.doy; refresh(); ovStale('date'); });
    $('#sun-t').addEventListener('input', (e) => { S.min = +e.target.value; refresh(); });
    panel.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
      const [m, d] = b.dataset.p.split('-').map(Number); S.doy = doyFromDate(m, d);
      refresh(); if (S.overlay) startOverlay();      // season presets: the ground map follows the chosen day
    }));
    $('#sun-sh').addEventListener('change', (e) => setShadow(e.target.checked));
    $('#sun-sl').addEventListener('change', (e) => { $('#sun-slnote').style.display = e.target.checked ? 'block' : 'none'; if (o.onScoreLayer) o.onScoreLayer(e.target.checked); });
    $('#sun-ov').addEventListener('change', (e) => setOverlay(e.target.checked));
    $('#sun-bc').addEventListener('change', (e) => setBColor(e.target.checked));
    // ---- playback: delta-time driven (same speed on slow and fast machines), speed multiplier, pause/resume, steps, loop
    let lastT = performance.now(), lastApply = 0;
    const dayRange = () => { computeSun(); let a = ev.sunrise == null ? 0 : ev.sunrise * 60 - 15, b = ev.sunset == null ? 1440 : ev.sunset * 60 + 15; a = Math.max(0, a); b = Math.min(1440, b); return b - a < 30 ? [0, 1440] : [a, b]; };
    function play(kind) {
      if (S.playing === kind) { stopPlay(); return; }
      S.playing = kind; S.paused = false;
      if (kind === 'day') { S.min = Math.round(dayRange()[0] / 5) * 5; } else { S.doyF = 1; S.doy = 1; }
      lastApply = 0; refresh('play'); updateReadout();
    }
    function stopPlay() { S.playing = null; S.paused = false; updateReadout(); }
    function togglePause() { if (!S.playing) return; S.paused = !S.paused; updateReadout(); }
    function stepMin(dm) { S.min += dm; while (S.min >= 1440) { S.min -= 1440; S.doy = Math.min(daysInYear(), S.doy + 1); } while (S.min < 0) { S.min += 1440; S.doy = Math.max(1, S.doy - 1); } S.doyF = S.doy; refresh(); }
    function stepDay(dd) { S.doy = clamp(S.doy + dd, 1, daysInYear()); S.doyF = S.doy; refresh(); ovStale('date'); }
    function toNow() { const n = nowState(); S.doy = n.doy; S.min = n.min; S.doyF = S.doy; refresh(); ovStale('date'); }
    $('#sun-pd').onclick = () => play('day'); $('#sun-py').onclick = () => play('year'); $('#sun-pp').onclick = togglePause;
    $('#sun-tm').onclick = () => stepMin(-10); $('#sun-tp').onclick = () => stepMin(10); $('#sun-dm').onclick = () => stepDay(-1); $('#sun-dp').onclick = () => stepDay(1); $('#sun-now').onclick = toNow;
    $('#sun-spd').addEventListener('change', (e) => { S.speed = +e.target.value || 1; save(); updateClock(); });
    $('#sun-loop').addEventListener('change', (e) => { S.loop = e.target.checked; save(); });
    let acc = 0;
    function loop(now) {
      const dt = Math.min(1, Math.max(0, (now - lastT) / 1000)); lastT = now;
      if (S.playing && !S.paused) {
        if (S.playing === 'day') {
          const [a, b] = dayRange(); S.min = advanceDay(Math.max(S.min, a), dt, S.speed);
          if (S.min >= b) { if (S.loop) S.min = a + (S.min - b); else { S.min = b; S.playing = null; S.paused = false; lastApply = 0; } }
        } else {
          if (Math.floor(S.doyF) !== S.doy) S.doyF = S.doy; S.doyF = advanceYear(S.doyF, dt, S.speed); const N = daysInYear();
          if (S.doyF >= N + 1) { if (S.loop) S.doyF = 1 + (S.doyF - N - 1); else { S.doyF = N; S.playing = null; S.paused = false; lastApply = 0; } }
          S.doy = clamp(Math.floor(S.doyF), 1, N);
        }
        if (now - lastApply >= 1000 / SHADOW_FPS || !S.playing) { lastApply = now; refresh('play'); }   // sim time is exact every frame; shadow/readout work is throttled
      }
      if (S.shadow) {
        camera.updateMatrixWorld(); const me = camera.matrixWorld.elements; let ch = false; for (let i = 0; i < 16; i++) if (Math.abs(me[i] - lastCam[i]) > 1e-4) { ch = true; break; }
        if (ch) { lastCam.set(me); focusT = now; dirty = true; }
        if (dirty) {
          const g = groundUnderView();
          if (g) { focus.copy(g.p); R = clamp(g.dist * 0.95, 220, RMAX); } else { focus.set((B[0] + B[2]) / 2, gh((B[0] + B[2]) / 2, (B[1] + B[3]) / 2), -(B[1] + B[3]) / 2); R = RMAX; }
          fitShadow(); dirty = false; renderer.shadowMap.needsUpdate = true; if (o.requestRender) o.requestRender();
        }
      }
      requestAnimationFrame(loop);
    }
    showHide(); computeSun(); updateReadout(); skyAndLight();
    requestAnimationFrame(loop);

    const inst = {
      state: S, light, setDate(m, d) { S.doy = doyFromDate(m, d); S.doyF = S.doy; refresh(); }, setTime(h) { S.min = Math.round(h * 60); refresh(); }, setTimeKST(h) { const k = new Date(Date.UTC(YEAR, 0, S.kdoy, 0, Math.round(h * 60)) - KST_MIN * 60000), n = nowState(k); S.doy = n.doy; S.min = n.min; S.doyF = S.doy; refresh(); }, play, stopPlay, togglePause, stepMin, stepDay, toNow,
      setShadow, setOverlay, setBuildingColor: setBColor, showBuilding, facadeHTML, buildingColor: colorFor, open() { S.open = true; showHide(); }, close() { S.open = false; showHide(); },
      toggle() { S.open = !S.open; showHide(); }, sun: () => ({ alt: sunNow.alt, az: sunNow.az, dir: L.clone() }), refresh, fit() { dirty = true; },
      query: (q) => (Q ? Q.query(q) : null), runQuery, getQ: () => Q, setQuery(txt, floor, orient, unit) { $('#sun-qb').value = txt; $('#sun-qf').value = floor; $('#sun-qu').value = unit || ''; qs.orient = orient || 'all'; setOChips(); return runQuery(); },
      windowView: windowViewAt, windowEnded() { setWindowSky(false); if (WVc) WVc.hide(); }, windowViewOn() { return !!(WVc && WVc.active); }, evalPoint, evalStand, setPointMode: setPtMode, pickPoint, pickCenter, complexSummary, complexScoreHTML, buildingScoreHTML, buildingScoreLine, scoreNote: SCORE_NOTE, startOverlay, stopOverlay: () => setOverlay(false), overlayArea: () => OV.area, getShadowInfo: () => ({ R, map: MAPSZ, focus: focus.clone() }),
    };
    WVc = root.WindowView ? root.WindowView.attach(inst, { onFov: (d) => { if (o.onWindowFov) o.onWindowFov(d); if (o.requestRender) o.requestRender(); }, getCover: o.getWindowCover }) : null;
    api.instance = inst; return inst;
  };
  root.SunAddon = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
