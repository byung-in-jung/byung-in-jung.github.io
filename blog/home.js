/* 볕결 세종 — 블로그 첫 화면 (Blogger HTML 가젯이 불러오는 파일). 마크업·위치 로직·지도 연동을 전부 여기서 만든다. */
(function () {
  'use strict';
  var root = document.getElementById('bg-home');
  if (!root || root.getAttribute('data-ready')) return;
  root.setAttribute('data-ready', '1');

  var VIEWER = 'https://byung-in-jung.github.io/';
  var ORIGIN = 'https://byung-in-jung.github.io';
  var FALLBACK = { n: '새롬동', h: '#view=-350.5,-404.3,450,0.55,0.62' };
  var DONGS = ['행복도시 전체', '한솔동', '새롬동', '다정동', '나성동', '도담동', '어진동', '아름동', '종촌동', '고운동', '소담동', '보람동', '대평동', '반곡동', '집현동', '해밀동', '산울동', '합강동', '다솜동', '용호동', '누리동', '한별동'];
  var PHOTOS = [
    { f: 'lake17.jpg', t: '세종호수공원 수상무대', a: 'Youngjin', l: 'CC BY-SA 3.0', u: 'https://commons.wikimedia.org/wiki/File:Sejong_lake_park_190609_17.jpg' },
    { f: 'lib.jpg', t: '세종국립도서관', a: 'Minseong Kim', l: 'CC BY-SA 4.0', u: 'https://commons.wikimedia.org/wiki/File:Sejong_National_Library.jpg' },
    { f: 'lake5.jpg', t: '호수공원 물놀이 광장', a: 'Youngjin', l: 'CC BY-SA 3.0', u: 'https://commons.wikimedia.org/wiki/File:Sejong_lake_park_190609_05.jpg' },
    { f: 'lake9.jpg', t: '호수공원 산책길', a: 'Youngjin', l: 'CC BY-SA 3.0', u: 'https://commons.wikimedia.org/wiki/File:Sejong_lake_park_190609_09.jpg' },
    { f: 'lake2.jpg', t: '호수공원 분수와 산', a: 'Youngjin', l: 'CC BY-SA 3.0', u: 'https://commons.wikimedia.org/wiki/File:Sejong_lake_park_190609_02.jpg' },
    { f: 'lib_east.jpg', t: '세종국립도서관 동쪽', a: 'Minseong Kim', l: 'CC BY-SA 4.0', u: 'https://commons.wikimedia.org/wiki/File:Sejong_National_Library_east.jpg' }
  ];
  var SELF = (function () { var s = document.currentScript; return s && s.src ? s.src.replace(/[^/]*$/, '') : VIEWER + 'blog/'; })();
  var BASE = SELF.replace(/blog\/$/, '');

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function card(p) { return '<figure class="bg-pc"><img src="' + BASE + 'photos/' + p.f + '" alt="" decoding="async" loading="lazy"><figcaption><b>' + esc(p.t) + '</b><small>' + esc(p.a) + ' · <a href="' + p.u + '" target="_blank" rel="noopener">' + p.l + '</a></small></figcaption></figure>'; }

  /* ---------- 마크업 ---------- */
  root.innerHTML = '';
  var SUNARC = '<svg viewBox="0 0 56 30" aria-hidden="true"><path class="arc" d="M3 27 Q28 -14 53 27"/><circle class="dot" cx="28" cy="10" r="5"/></svg>';
  var head = el('header', 'bg-head',
    '<div class="bg-logo"><h1 class="bg-title">볕결<i aria-hidden="true"></i><span>세종</span></h1><p class="bg-sub">햇볕이 드는 동네를 3D로 둘러봅니다</p></div>' +
    '<div class="bg-sun" aria-live="off">' + SUNARC + '<div><span class="bg-sun-t">—</span><small class="bg-sun-s"></small></div></div>');
  var rail = el('div', 'bg-rail at-start');
  var scroller = el('div', 'bg-scroll');
  var nav = el('nav', 'bg-nav'); nav.setAttribute('aria-label', '동 선택');
  var ind = el('span', 'bg-ind'); ind.setAttribute('aria-hidden', 'true'); nav.appendChild(ind);
  var btns = {}, order = [];
  DONGS.forEach(function (n, i) {
    var b = el('button', 'bg-chip' + (i === 0 ? ' all' : ''), i === 0 ? '전체<b>21</b>' : esc(n.replace(/동$/, ''))); b.type = 'button'; b.setAttribute('data-n', n); b.title = n; b.tabIndex = i === 0 ? 0 : -1;
    b.style.setProperty('--i', Math.min(i, 20)); nav.appendChild(b); btns[n] = b; order.push(n);
  });
  scroller.appendChild(nav); rail.appendChild(scroller);

  var grid = el('div', 'bg-grid'), top = el('div', 'bg-top'); top.appendChild(head); top.appendChild(rail);
  var adL = el('aside', 'bg-ad bg-ad-l', card(PHOTOS[0]) + card(PHOTOS[1]) + card(PHOTOS[4])); adL.id = 'bg-ad-l'; adL.setAttribute('aria-label', '세종 명소 · 광고 자리(왼쪽)');
  var adR = el('aside', 'bg-ad bg-ad-r', card(PHOTOS[2]) + card(PHOTOS[3]) + card(PHOTOS[5])); adR.id = 'bg-ad-r'; adR.setAttribute('aria-label', '세종 명소 · 광고 자리(오른쪽)');
  var main = el('main', 'bg-main');
  var stage = el('div', 'bg-stage');
  var frame = el('iframe', 'bg-frame'); frame.title = '선택한 동의 3D 지도'; frame.setAttribute('allow', 'fullscreen'); frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-pointer-lock');
  var loader = el('div', 'bg-load',
    '<svg class="bg-sil" viewBox="0 0 600 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><g fill="#56632d" opacity=".35"><rect x="24" y="52" width="34" height="68"/><rect x="64" y="22" width="30" height="98"/><rect x="100" y="60" width="42" height="60"/><rect x="170" y="36" width="32" height="84"/><rect x="208" y="72" width="46" height="48"/><rect x="300" y="14" width="36" height="106"/><rect x="342" y="54" width="30" height="66"/><rect x="378" y="34" width="40" height="86"/><rect x="440" y="64" width="44" height="56"/><rect x="490" y="42" width="30" height="78"/><rect x="526" y="70" width="46" height="50"/></g></svg>' +
    '<div class="bg-load-t">내 위치를 확인하는 중입니다</div><div class="bg-dots" aria-hidden="true"><i class="on"></i><i></i><i></i></div><div class="bg-load-n"></div>');
  loader.setAttribute('role', 'status');
  var badge = el('div', 'bg-chrome',
    '<div class="bg-id"><span class="bg-name">—</span><span class="bg-sep" aria-hidden="true"></span>' +
    '<div class="bg-seg loading" role="group" aria-label="지도 종류"><button type="button" data-v="map" aria-pressed="false">지도</button><button type="button" data-v="sat" aria-pressed="true"><i class="sp" aria-hidden="true"></i>위성</button></div><span class="bg-sep" aria-hidden="true"></span></div>' +
    '<div class="bg-tl"><button type="button" class="bg-fs bg-share" aria-label="링크 공유" title="링크 공유"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/></svg></button>' +
    '<a class="bg-fs bg-open" target="_blank" rel="noopener" aria-label="새 탭에서 열기" title="새 탭에서 열기"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></a>' +
    '<button type="button" class="bg-fs bg-full" aria-label="전체 화면" title="전체 화면"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button></div>');
  badge.style.display = 'none';
  var fs = badge.querySelector('a.bg-open'), fsBtn = badge.querySelector('.bg-full'), shareBtn = badge.querySelector('.bg-share'), nameEl = badge.querySelector('.bg-name'), seg = badge.querySelector('.bg-seg'), segBtn = { map: seg.querySelector('[data-v=map]'), sat: seg.querySelector('[data-v=sat]') };
  var say = el('div', 'bg-say'); say.setAttribute('role', 'status');
  stage.appendChild(frame); stage.appendChild(loader); stage.appendChild(badge); stage.appendChild(say);
  var foot = el('footer', 'bg-foot', '<span class="bg-fl">행정경계 © OpenStreetMap contributors · 지도 이용 안내는 지도 아래 “자세히”</span><span class="bg-fr"><button type="button" class="bg-link" data-act="credits">사진 출처</button><span class="bg-brand"><i></i>볕결 세종</span></span>');
  var dlg = el('dialog', 'bg-dlg', '<form method="dialog"><h2>사진 출처</h2><p>지도 옆 사진은 위키미디어 커먼즈의 자유 이용 사진입니다.</p><ul>' + PHOTOS.map(function (p) { return '<li><b>' + esc(p.t) + '</b> · ' + esc(p.a) + ' · <a href="' + p.u + '" target="_blank" rel="noopener">' + p.l + '</a></li>'; }).join('') + '</ul><button class="bg-dlg-x">닫기</button></form>');
  foot.querySelector('[data-act=credits]').addEventListener('click', function () { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); });
  var strip = el('div', 'bg-strip', PHOTOS.slice(0, 4).map(card).join(''));
  main.appendChild(stage); main.appendChild(strip); main.appendChild(foot);
  grid.appendChild(top); grid.appendChild(adL); grid.appendChild(main); grid.appendChild(adR);
  var skip = el('a', 'bg-skip', '지도 건너뛰기'); skip.href = '#bg-after'; var live = el('div', 'bg-vh'); live.setAttribute('aria-live', 'polite'); var after = el('span'); after.id = 'bg-after'; after.tabIndex = -1;
  root.appendChild(skip); root.appendChild(live); root.appendChild(grid); root.appendChild(dlg); root.appendChild(after);
  try { if (!document.querySelector('link[rel=icon][data-bg]')) { var fv = document.createElement('link'); fv.rel = 'icon'; fv.type = 'image/svg+xml'; fv.setAttribute('data-bg', '1'); fv.href = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#2f3819"/><circle cx="13" cy="13" r="5.5" fill="#e8a33d"/><path d="M17 29 L29 17" stroke="#f6d9a0" stroke-width="2" stroke-linecap="round"/><path d="M21 31 L31 21" stroke="#f6d9a0" stroke-width="2" stroke-linecap="round" opacity=".55"/></svg>'); document.head.appendChild(fv); } } catch (x) { /* 파비콘 추가 불가 */ }
  try { if (!document.querySelector('meta[name=theme-color]')) { var mt = document.createElement('meta'); mt.name = 'theme-color'; mt.content = '#f5eddc'; document.head.appendChild(mt); } } catch (x) { /* 메타 추가 불가 */ }

  /* ---------- 상태 ---------- */
  var cur = null, moved = false, started = false, lastLL = null, sayT = 0, stT = [], polys = null;
  if (!window.ResizeObserver && !('transition' in document.documentElement.style)) root.classList.add('no-ind');

  function toast(m, act, ms) {
    say.innerHTML = ''; say.appendChild(document.createTextNode(m));
    if (act) { var b = el('button', 'bg-say-b', act.label); b.type = 'button'; b.addEventListener('click', function () { say.classList.remove('on'); act.fn(); }); say.appendChild(b); }
    say.classList.toggle('act', !!act); say.classList.add('on'); clearTimeout(sayT); sayT = setTimeout(function () { say.classList.remove('on'); }, ms || (act ? 12000 : 7000));
  }
  var satT = 0, satT2 = 0, readyT = 0;
  function watchSat(state) {
    clearTimeout(satT);
    if (state === 'loading') {
      satT = setTimeout(function () { toast('위성 사진이 아직 오는 중이에요. 기다리거나 "지도"로 먼저 볼 수 있어요.', { label: '지도로 보기', fn: function () { segBtn.map.click(); } }); }, 45000);
      clearTimeout(satT2); satT2 = setTimeout(function () { seg.classList.remove('loading'); seg.setAttribute('aria-busy', 'false'); }, 150000);
    } else clearTimeout(satT2);
  }
  function stages(on, first) {
    stT.forEach(clearTimeout); stT = [];
    var t = loader.querySelector('.bg-load-t'), dots = loader.querySelectorAll('.bg-dots i'), note = loader.querySelector('.bg-load-n');
    function set(i, txt) { t.textContent = txt; for (var k = 0; k < dots.length; k++) dots[k].classList.toggle('on', k === i); }
    if (!on) { loader.classList.add('off'); stage.classList.add('ready'); return; }
    loader.classList.remove('off'); stage.classList.remove('ready'); note.textContent = '';
    set(0, first ? '내 위치를 확인하는 중입니다' : (cur || '') + ' 지도를 불러오는 중입니다');
    stT.push(setTimeout(function () { set(1, (cur === '행복도시 전체' ? '행복도시' : cur) + ' 3D 건물을 세우는 중입니다'); }, 3500));
    stT.push(setTimeout(function () { set(2, '위성 사진을 입히는 중입니다'); }, 9000));
    stT.push(setTimeout(function () { note.textContent = '조금 오래 걸리네요. 처음 한 번만 그래요.'; }, 14000));
    stT.push(setTimeout(function () { loader.classList.add('off'); stage.classList.add('ready'); toast('지도가 늦어지고 있어요. 인터넷 연결을 확인하거나 다시 시도해 주세요.', { label: '다시 시도', fn: function () { if (cur) select(cur); } }); }, 30000));
  }
  var VIEWER_V = '20261026v';
  function viewerUrl(name, hash) { var b = name === '행복도시 전체' ? VIEWER + 'haengbok/' : VIEWER + 'dongs/' + encodeURIComponent(name) + '/'; return b + '?v=' + VIEWER_V + (hash || '#') + (hash ? '&' : '') + 'ext=1'; }
  function setSeg(state) {
    var on = state === 'on' || state === 'loading', auto = state === 'auto';
    watchSat(state); segBtn.sat.setAttribute('aria-pressed', on ? 'true' : 'false'); segBtn.map.setAttribute('aria-pressed', on ? 'false' : 'true');
    seg.classList.toggle('loading', state === 'loading'); seg.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false'); segBtn.sat.disabled = auto; segBtn.sat.title = auto ? '일조 보기 중에는 지도만 보여요' : '';
    root.classList.toggle('is-loading', state === 'loading');
  }
  function setVw(on) { try { frame.contentWindow.postMessage({ type: 'vw-set', on: on }, ORIGIN); } catch (x) { /* 아직 로딩 전 */ } }
  segBtn.map.addEventListener('click', function () { setSeg('off'); setVw(false); });
  segBtn.sat.addEventListener('click', function () { setSeg('loading'); setVw(true); });
  function moveInd(animate) {
    var b = cur && btns[cur]; if (!b) return;
    if (!animate) ind.style.transition = 'none';
    ind.style.width = b.offsetWidth + 'px'; ind.style.transform = 'translate(' + b.offsetLeft + 'px,' + b.offsetTop + 'px)';
    if (!animate) { void ind.offsetWidth; ind.style.transition = ''; }
  }
  function updateFade() {
    var s = scroller; rail.classList.toggle('at-start', s.scrollLeft < 4); rail.classList.toggle('at-end', s.scrollLeft + s.clientWidth >= s.scrollWidth - 4);
  }
  function select(name, hash, first) {
    if (!btns[name]) return;
    var changed = cur !== name; cur = name; if (typeof locName !== 'undefined') locName = null;      /*curdong1*/
    order.forEach(function (k) { var on = k === name; btns[k].classList.toggle('on', on); btns[k].tabIndex = on ? 0 : -1; if (on) btns[k].setAttribute('aria-current', 'true'); else btns[k].removeAttribute('aria-current'); });
    moveInd(!first);
    var b = btns[name]; if (first) { var need = b.offsetLeft + b.offsetWidth + 12 - scroller.clientWidth; scroller.scrollLeft = need > 0 ? need : 0; } else if (scroller.scrollTo) scroller.scrollTo({ left: b.offsetLeft - (scroller.clientWidth - b.offsetWidth) / 2, behavior: 'smooth' }); else scroller.scrollLeft = b.offsetLeft - (scroller.clientWidth - b.offsetWidth) / 2;
    setTimeout(updateFade, 250);
    if (changed) { nameEl.classList.add('swap'); setTimeout(function () { nameEl.textContent = name; nameEl.classList.remove('swap'); }, 160); }
    var u = viewerUrl(name, hash);
    var plain = name === '행복도시 전체'; badge.classList.toggle('no-sat', plain); stages(true, first); setSeg(plain ? 'off' : 'loading');
    frame.onload = plain ? function () { setTimeout(function () { stages(false); }, 1500); } : null; frame.title = name + ' 3D 일조 지도'; live.textContent = name + ' 지도를 불러옵니다'; frame.src = u; fs.href = u; badge.style.display = 'flex';
    try { history.replaceState(null, '', '#' + encodeURIComponent(name)); } catch (x) { /* 주소 갱신 불가 */ }
  }


  /* curdong1: 지금 보는 위치의 동 이름(장면과 별개) */
  var locName = null;
  function showLoc(name) {
    if (!name || typeof name !== 'string' || name === locName) return; locName = name;
    nameEl.textContent = name; order.forEach(function (k) { var on = k === name; btns[k].classList.toggle('on', on); if (on) btns[k].setAttribute('aria-current', 'true'); else btns[k].removeAttribute('aria-current'); });
    if (btns[name]) { var b = btns[name]; if (scroller.scrollTo) scroller.scrollTo({ left: b.offsetLeft - (scroller.clientWidth - b.offsetWidth) / 2, behavior: 'smooth' }); moveInd(true); }
    try { history.replaceState(null, '', '#' + encodeURIComponent(name)); } catch (x) { /* 주소 갱신 불가 */ }
    if (typeof dpop !== 'undefined' && dpop && !dpop.hidden) dpopSet(true);
  }
  /* chrome1: 전체 화면(같은 페이지) 토글 + 동 목록 팝오버 */
  var fsOn = false, pseudoFs = false, fsIn = fsBtn.innerHTML, fsOut = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
  function fsSync() {
    var on = !!(document.fullscreenElement || document.webkitFullscreenElement) || pseudoFs; fsOn = on;
    stage.classList.toggle('is-fs', on); root.classList.toggle('bg-fs-on', on); fsBtn.innerHTML = on ? fsOut : fsIn; fsBtn.setAttribute('aria-label', on ? '축소' : '전체 화면'); fsBtn.title = on ? '축소' : '전체 화면';
    document.documentElement.classList.toggle('bg-pfs-lock', pseudoFs);
    setTimeout(function () { try { window.dispatchEvent(new Event('resize')); } catch (x) { /* */ } try { frame.contentWindow.dispatchEvent(new Event('resize')); } catch (x) { /* */ } }, 80);
  }
  function pseudoOn() { pseudoFs = true; try { history.pushState({ bgfs: 1 }, ''); } catch (x) { /* */ } fsSync(); }
  function pseudoOff() { if (!pseudoFs) return; pseudoFs = false; fsSync(); if (history.state && history.state.bgfs) { try { history.back(); } catch (x) { /* */ } } }
  function enterFs() {
    var req = stage.requestFullscreen || stage.webkitRequestFullscreen;
    if (req && (document.fullscreenEnabled || document.webkitFullscreenEnabled)) { try { var p = req.call(stage); if (p && p.catch) p.catch(function () { pseudoOn(); }); } catch (x) { pseudoOn(); } } else pseudoOn();
  }
  function exitFs() { if (document.fullscreenElement || document.webkitFullscreenElement) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (x) { /* */ } } pseudoOff(); }
  fsBtn.addEventListener('click', function () { if (fsOn) exitFs(); else enterFs(); });
  document.addEventListener('fullscreenchange', fsSync); document.addEventListener('webkitfullscreenchange', fsSync);
  window.addEventListener('popstate', function () { if (pseudoFs) { pseudoFs = false; fsSync(); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (pseudoFs) pseudoOff(); else if (dpop && !dpop.hidden) dpopSet(false); } });
  var dpop = el('div', 'bg-dpop'); dpop.hidden = true; dpop.setAttribute('role', 'listbox'); dpop.setAttribute('aria-label', '동 선택');
  DONGS.forEach(function (n) { var b = el('button', '', esc(n === '행복도시 전체' ? '전체' : n.replace(/동$/, ''))); b.type = 'button'; b.setAttribute('data-n', n); b.setAttribute('role', 'option'); b.addEventListener('click', function () { dpopSet(false); moved = true; select(n); }); dpop.appendChild(b); });
  stage.appendChild(dpop);
  function dpopSet(on) { dpop.hidden = !on; nameEl.setAttribute('aria-expanded', on ? 'true' : 'false'); if (on) { [].forEach.call(dpop.children, function (b) { var c = b.getAttribute('data-n') === (locName || cur); b.classList.toggle('on', c); if (c) b.setAttribute('aria-selected', 'true'); else b.removeAttribute('aria-selected'); }); } }
  nameEl.setAttribute('role', 'button'); nameEl.tabIndex = 0; nameEl.setAttribute('aria-haspopup', 'listbox'); nameEl.setAttribute('aria-expanded', 'false'); nameEl.title = '다른 동 고르기';
  nameEl.addEventListener('click', function () { dpopSet(dpop.hidden); });
  nameEl.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dpopSet(dpop.hidden); } });
  document.addEventListener('pointerdown', function (e) { if (!dpop.hidden && !dpop.contains(e.target) && e.target !== nameEl) dpopSet(false); }, true);
  shareBtn.addEventListener('click', function () {
    var url = location.href.split('#')[0] + '#' + encodeURIComponent(locName || cur || ''), t = (locName || cur || '세종') + ' 3D 지도 · 볕결 세종';
    if (navigator.share) { navigator.share({ title: t, url: url }).catch(function () { /* 취소 */ }); return; }
    var done = function () { toast('링크를 복사했어요 · ' + (locName || cur || '')); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { toast(url); }); else toast(url);
  });
  nav.addEventListener('click', function (e) { var b = e.target.closest ? e.target.closest('.bg-chip') : null; if (!b) return; moved = true; select(b.getAttribute('data-n')); });
  nav.addEventListener('keydown', function (e) {
    var k = e.key, i = order.indexOf(document.activeElement && document.activeElement.getAttribute('data-n'));
    if (i < 0) return;
    var n = k === 'ArrowRight' ? Math.min(order.length - 1, i + 1) : k === 'ArrowLeft' ? Math.max(0, i - 1) : k === 'Home' ? 0 : k === 'End' ? order.length - 1 : -1;
    if (n < 0) return; e.preventDefault(); btns[order[n]].focus();
  });
  scroller.addEventListener('scroll', updateFade, { passive: true });
  window.addEventListener('resize', function () { moveInd(false); updateFade(); });

  /* ---------- 위치 → 동 ---------- */
  function inP(x, y, q) { var c = false; for (var i = 0, j = q.length - 2; i < q.length; j = i, i += 2) { var xi = q[i], yi = q[i + 1], xj = q[j], yj = q[j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
  function pick(lat, lon) {
    if (!polys) return null;
    for (var k = 0; k < polys.length; k++) {
      if (inP(lon, lat, polys[k][3])) {
        var x = (lon - polys[k][2]) * 111320 * Math.cos(polys[k][1] * Math.PI / 180), y = (lat - polys[k][1]) * 110574;
        return { n: polys[k][0], h: '#view=' + x.toFixed(1) + ',' + y.toFixed(1) + ',450,0.55,0.62' };
      }
    }
    return null;
  }
  function start(r) { if (started) return; started = true; select(r.n, r.h, true); }
  function late(lat, lon) {
    if (!started || moved) return;
    if (lastLL && Math.abs(lat - lastLL[0]) < 0.0003 && Math.abs(lon - lastLL[1]) < 0.0003) return;
    var r = pick(lat, lon); if (!r) return; lastLL = [lat, lon];
    if (r.n === cur) { var u = viewerUrl(r.n, r.h); frame.src = u; fs.href = u; } else select(r.n, r.h, false);
  }
  function boot() {
    var hn = ''; try { hn = decodeURIComponent((location.hash || '').slice(1)); } catch (x) { hn = ''; }
    if (hn && btns[hn]) { moved = true; start({ n: hn }); return; }
    var sv = null; try { sv = JSON.parse(localStorage.getItem('hmLast') || 'null'); } catch (x) { sv = null; }
    if (sv && sv.n && sv.h && btns[sv.n] && Date.now() - sv.t < 2592000000) { moved = true; start({ n: sv.n, h: sv.h }); toast('마지막으로 보던 위치로 열었어요 · ' + sv.n); return; }
    if (!navigator.geolocation) { start(FALLBACK); return; }
    var tm = setTimeout(function () { toast('내 위치를 확인하지 못해 새뜸마을 1단지로 열었어요. 위치 허용 여부를 확인해 주세요.'); start(FALLBACK); }, 5000);
    var go = function (p) {
      var la = p.coords.latitude, lo = p.coords.longitude, r = pick(la, lo);
      if (!started) {
        clearTimeout(tm); lastLL = [la, lo];
        if (r) { toast('내 위치는 ' + r.n + '이에요 · 다른 동도 볼 수 있어요'); if (btns[r.n]) btns[r.n].classList.add('here'); start(r); } else { toast('내 위치(' + la.toFixed(3) + ', ' + lo.toFixed(3) + ')가 행복도시 밖이라 새뜸마을 1단지로 열었어요'); start(FALLBACK); }
      } else late(la, lo);
    };
    navigator.geolocation.getCurrentPosition(go, function (er) {
      clearTimeout(tm);
      toast(er && er.code === 1 ? '위치 권한이 꺼져 있어 새뜸마을 1단지로 열었어요. 주소창 왼쪽 자물쇠에서 위치를 허용해 주세요.' : '내 위치를 확인하지 못해 새뜸마을 1단지로 열었어요.');
      start(FALLBACK);
    }, { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 });
    var wid = navigator.geolocation.watchPosition(go, function () { }, { enableHighAccuracy: true, maximumAge: 0 });
    setTimeout(function () { navigator.geolocation.clearWatch(wid); }, 45000);
  }
  fetch(SELF + 'dongpoly.json').then(function (r) { return r.json(); }).then(function (j) { polys = j; }, function () { polys = null; }).then(boot);

  /* ---------- 뷰어 메시지 ---------- */
  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGIN || !e.data) return;
    var t = e.data.type;
    if (t === 'vw-ready') { clearTimeout(readyT); readyT = setTimeout(function () { stages(false); }, 1200); }
    else if (t === 'vw-moved') moved = true;
    else if (t === 'vw-state') setSeg(e.data.state);
    else if (t === 'vw-dong') showLoc(e.data.name);      /*curdong1*/
    else if (t === 'vw-view' && cur) { try { localStorage.setItem('hmLast', JSON.stringify({ n: cur, h: e.data.h, t: Date.now() })); } catch (x) { /* 저장 불가 */ } }
  });

  /* ---------- 세종의 지금 해(헤더의 볕·그림자) ---------- */
  var LAT = 36.5, LON = 127.28, RAD = Math.PI / 180;
  function sunPos(d) {
    var t = d.getTime() / 86400000 + 2440587.5 - 2451545.0, M = (357.5291 + 0.98560028 * t) * RAD,
      C = 1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M), L = (280.4665 + 0.98564736 * t + C) * RAD,
      eps = 23.4393 * RAD, dec = Math.asin(Math.sin(eps) * Math.sin(L)), ra = Math.atan2(Math.cos(eps) * Math.sin(L), Math.cos(L)),
      gst = (280.16 + 360.9856235 * t) * RAD, H = gst + LON * RAD - ra, phi = LAT * RAD;
    var alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
    var az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;
    return { alt: alt / RAD, az: az / RAD };
  }
  function fmt(m) { var h = Math.floor(m / 60) % 24, mm = m % 60; return (h < 12 ? '오전 ' : '오후 ') + (h % 12 || 12) + ':' + (mm < 10 ? '0' : '') + mm; }
  function sunTick() {
    var now = new Date(), s = sunPos(now), midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()), rise = -1, set = -1;
    for (var m = 0; m < 1440; m += 2) { var a = sunPos(new Date(midnight.getTime() + m * 60000)).alt; if (rise < 0 && a > 0) rise = m; if (rise >= 0 && a <= 0 && set < 0) { set = m; break; } }
    var cm = now.getHours() * 60 + now.getMinutes(), day = s.alt > 0, f = rise >= 0 && set > rise ? Math.max(0, Math.min(1, (cm - rise) / (set - rise))) : .5;
    root.classList.toggle('night', !day);
    var dot = head.querySelector('.dot'), x = 3 + 50 * f, y = 27 - 4 * 27 * f * (1 - f) * 1.0;
    dot.setAttribute('cx', x.toFixed(1)); dot.setAttribute('cy', (27 - 38 * f * (1 - f)).toFixed(1));
    head.querySelector('.bg-sun-t').textContent = fmt(cm) + (day ? ' · 고도 ' + Math.round(s.alt) + '°' : ' · 밤');
    head.querySelector('.bg-sun-s').textContent = day ? '일출 ' + fmt(rise) + ' · 일몰 ' + fmt(set) : (rise >= 0 ? '내일 일출 ' + fmt(rise) : '');
    /* 해가 낮을수록 그림자는 길고, 방위 반대쪽으로 뻗는다 */
    var len = day ? Math.min(6, 2 + 4 / Math.max(.4, Math.tan(Math.max(6, s.alt) * RAD) * 2)) : 3, azr = s.az * RAD;
    root.style.setProperty('--sx', (-Math.sin(azr) * len).toFixed(1) + 'px'); root.style.setProperty('--sy', (Math.max(1.5, Math.cos(azr) * len * .5 + len * .35)).toFixed(1) + 'px'); root.style.setProperty('--sb', '0px');
    root.style.setProperty('--glow', day ? String(Math.max(.35, Math.min(1, s.alt / 40))) : '.25');
  }
  sunTick(); setInterval(sunTick, 60000);

  /* ---------- 폭 맞춤(테마 칸을 벗어나 화면 가운데로) ---------- */
  function fit() {
    var vw = document.documentElement.clientWidth;
    if (vw <= 760) { root.style.width = ''; root.style.marginLeft = ''; root.style.maxWidth = ''; return; }
    root.style.marginLeft = '0px'; root.style.width = '';
    var l = root.getBoundingClientRect().left, W = Math.min(1800, vw - 48);
    root.style.maxWidth = 'none'; root.style.width = W + 'px'; root.style.marginLeft = ((vw - W) / 2 - l) + 'px';
    moveInd(false);
  }
  setTimeout(function () { root.classList.add('bg-in'); }, 30);
  fit(); window.addEventListener('resize', fit); window.addEventListener('load', fit); setTimeout(fit, 600); setTimeout(fit, 2000);
})();
