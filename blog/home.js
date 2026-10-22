/* 볕결 세종 — 블로그 첫 화면 (Blogger HTML 가젯이 불러오는 파일). 마크업·위치 로직·지도 연동을 전부 여기서 만든다. */
(function () {
  'use strict';
  var root = document.getElementById('bg-home');
  if (!root || root.getAttribute('data-ready')) return;
  root.setAttribute('data-ready', '1');

  var VIEWER = 'https://byung-in-jung.github.io/';
  var BLOG = 'https://scity3d.blogspot.com/p/';
  var ORIGIN = 'https://byung-in-jung.github.io';
  var FALLBACK = { n: '새롬동', h: '#view=-350.5,-404.3,450,0.55,0.62' };
  var DONGS = [
    ['행복도시 전체', 'sejong', '전체'], ['한솔동', 'hansol'], ['새롬동', 'saerom'], ['다정동', 'dajeong'], ['나성동', 'naseong'],
    ['도담동', 'dodam'], ['어진동', 'eojin'], ['아름동', 'areum'], ['종촌동', 'jongchon'], ['고운동', 'goun'], ['소담동', 'sodam'],
    ['보람동', 'boram'], ['대평동', 'daepyeong'], ['반곡동', 'bangok'], ['집현동', 'jiphyeon'], ['해밀동', 'haemil'],
    ['산울동', 'sanul'], ['합강동', 'hapgang'], ['다솜동', 'dasom'], ['용호동', 'yongho'], ['누리동', 'nuri'], ['한별동', 'hanbyeol']
  ];
  var PHOTOS = {
    l: [
      { f: 'lake17.jpg', t: '세종호수공원 수상무대', a: 'Youngjin', l: 'CC BY-SA 3.0', u: 'https://commons.wikimedia.org/wiki/File:Sejong_lake_park_190609_17.jpg' },
      { f: 'lib.jpg', t: '세종국립도서관', a: 'Minseong Kim', l: 'CC BY-SA 4.0', u: 'https://commons.wikimedia.org/wiki/File:Sejong_National_Library.jpg' }
    ],
    r: [
      { f: 'lake5.jpg', t: '호수공원 물놀이 광장', a: 'Youngjin', l: 'CC BY-SA 3.0', u: 'https://commons.wikimedia.org/wiki/File:Sejong_lake_park_190609_05.jpg' },
      { f: 'lake9.jpg', t: '호수공원 산책길', a: 'Youngjin', l: 'CC BY-SA 3.0', u: 'https://commons.wikimedia.org/wiki/File:Sejong_lake_park_190609_09.jpg' }
    ]
  };
  var SELF = (function () { var s = document.currentScript; return s && s.src ? s.src.replace(/[^/]*$/, '') : 'https://byung-in-jung.github.io/blog/'; })();

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- 마크업 ---------- */
  root.innerHTML = '';
  var head = el('header', 'bg-head', '<h1 class="bg-title">볕결 세종</h1><p class="bg-sub">햇볕이 드는 동네를 3D로 둘러봅니다</p>');
  var nav = el('nav', 'bg-nav'); nav.setAttribute('aria-label', '동 선택');
  var btns = {};
  DONGS.forEach(function (d) {
    var b = el('button', 'bg-chip', esc(d[2] || d[0].replace(/동$/, ''))); b.type = 'button'; b.setAttribute('data-n', d[0]); b.title = d[0];
    nav.appendChild(b); btns[d[0]] = b;
  });
  var grid = el('div', 'bg-grid');
  function side(k) {
    var a = el('aside', 'bg-ad bg-ad-' + k); a.id = 'bg-ad-' + k; a.setAttribute('aria-label', '세종 명소 · 광고 자리');
    PHOTOS[k].forEach(function (p) {
      a.appendChild(el('figure', 'bg-pc', '<img src="' + SELF.replace(/blog\/$/, '') + 'photos/' + p.f + '" alt="' + esc(p.t) + '" decoding="async"><figcaption><b>' + esc(p.t) + '</b><small>' + esc(p.a) + ' · <a href="' + p.u + '" target="_blank" rel="noopener">' + p.l + '</a></small></figcaption>'));
    });
    return a;
  }
  var main = el('main', 'bg-main');
  var stage = el('div', 'bg-stage');
  var frame = el('iframe', 'bg-frame'); frame.title = '선택한 동의 3D 지도'; frame.setAttribute('allow', 'fullscreen'); frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-pointer-lock');
  var loader = el('div', 'bg-load', '<span class="bg-spin" aria-hidden="true"></span><span class="bg-load-t">내 위치를 확인하는 중입니다</span>'); loader.setAttribute('role', 'status');
  var fs = el('a', 'bg-fs', '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>');
  fs.target = '_blank'; fs.rel = 'noopener'; fs.setAttribute('aria-label', '전체 화면으로 열기'); fs.title = '전체 화면'; fs.style.display = 'none';
  var say = el('div', 'bg-say'); say.setAttribute('role', 'status');
  stage.appendChild(frame); stage.appendChild(loader); stage.appendChild(fs); stage.appendChild(say);
  var src = el('p', 'bg-src', '참고용(실측·법적 판정 아님) · 위성영상: 브이월드(국토교통부) · 경계: © OpenStreetMap contributors');
  main.appendChild(stage); main.appendChild(src);
  grid.appendChild(side('l')); grid.appendChild(main); grid.appendChild(side('r'));
  root.appendChild(head); root.appendChild(nav); root.appendChild(grid);

  /* ---------- 상태 ---------- */
  var cur = null, moved = false, started = false, lastLL = null, sayT = 0, loadT = 0, polys = null;

  function toast(m) { say.textContent = m; say.classList.add('on'); clearTimeout(sayT); sayT = setTimeout(function () { say.classList.remove('on'); }, 9000); }
  function setLoading(on, text) {
    clearTimeout(loadT);
    if (text) loader.querySelector('.bg-load-t').textContent = text;
    loader.classList.toggle('off', !on);
    if (on) loadT = setTimeout(function () { loader.classList.add('off'); }, 20000);
  }
  function viewerUrl(name) {
    return name === '행복도시 전체' ? VIEWER + 'haengbok/' : VIEWER + 'dongs/' + encodeURIComponent(name) + '/';
  }
  function select(name, hash) {
    if (!btns[name]) return;
    cur = name;
    Object.keys(btns).forEach(function (k) { var on = k === name; btns[k].classList.toggle('on', on); if (on) btns[k].setAttribute('aria-current', 'true'); else btns[k].removeAttribute('aria-current'); });
    var u = viewerUrl(name) + (hash || '');
    setLoading(true, '지도를 불러오는 중입니다');
    frame.src = u; fs.href = u; fs.style.display = 'grid';
    var b = btns[name], p = nav;
    if (p.scrollWidth > p.clientWidth) p.scrollLeft = b.offsetLeft - (p.clientWidth - b.offsetWidth) / 2;
  }
  nav.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.bg-chip') : null; if (!b) return;
    moved = true; select(b.getAttribute('data-n'));
  });

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
  function start(r) { if (started) return; started = true; select(r.n, r.h); }
  function late(lat, lon) {
    if (!started || moved) return;
    if (lastLL && Math.abs(lat - lastLL[0]) < 0.0003 && Math.abs(lon - lastLL[1]) < 0.0003) return;
    var r = pick(lat, lon); if (!r) return; lastLL = [lat, lon];
    if (r.n === cur) { var u = viewerUrl(r.n) + r.h; frame.src = u; fs.href = u; } else select(r.n, r.h);
  }
  function boot() {
    var sv = null; try { sv = JSON.parse(localStorage.getItem('hmLast') || 'null'); } catch (x) { sv = null; }
    if (sv && sv.n && sv.h && btns[sv.n] && Date.now() - sv.t < 2592000000) { moved = true; start({ n: sv.n, h: sv.h }); toast('마지막으로 보던 위치로 열었어요 · ' + sv.n); return; }
    if (!navigator.geolocation) { start(FALLBACK); return; }
    var tm = setTimeout(function () { toast('내 위치를 확인하지 못해 새뜸마을 1단지로 열었어요. 위치 허용 여부를 확인해 주세요.'); start(FALLBACK); }, 5000);
    var go = function (p) {
      var la = p.coords.latitude, lo = p.coords.longitude, r = pick(la, lo);
      if (!started) {
        clearTimeout(tm); lastLL = [la, lo];
        if (r) { toast('내 위치로 열었어요 · ' + r.n); start(r); } else { toast('내 위치(' + la.toFixed(3) + ', ' + lo.toFixed(3) + ')가 행복도시 밖이라 새뜸마을 1단지로 열었어요'); start(FALLBACK); }
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
    if (t === 'vw-ready') setLoading(false);
    else if (t === 'vw-moved') moved = true;
    else if (t === 'vw-view' && cur) { try { localStorage.setItem('hmLast', JSON.stringify({ n: cur, h: e.data.h, t: Date.now() })); } catch (x) { /* 저장 불가 */ } }
  });

  /* ---------- 폭 맞춤(테마 칸을 벗어나 화면 가운데로) ---------- */
  function fit() {
    var vw = document.documentElement.clientWidth;
    if (vw <= 760) { root.style.width = ''; root.style.marginLeft = ''; return; }
    root.style.marginLeft = '0px'; root.style.width = '';
    var l = root.getBoundingClientRect().left, W = Math.min(1800, vw - 48);
    root.style.width = W + 'px'; root.style.marginLeft = ((vw - W) / 2 - l) + 'px';
  }
  fit(); window.addEventListener('resize', fit); window.addEventListener('load', fit); setTimeout(fit, 600); setTimeout(fit, 2000);
})();
