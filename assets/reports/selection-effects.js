
(function () {
  /* ---- 星场 / 像素粒子 ---- */
  function stars(el, n, colors) {
    for (var i = 0; i < n; i++) {
      var s = document.createElement('i');
      s.className = 'star ' + colors[i % colors.length];
      s.style.top = (4 + Math.random() * 88) + '%';
      s.style.left = (2 + Math.random() * 94) + '%';
      s.style.animationDelay = (Math.random() * 3) + 's';
      el.appendChild(s);
    }
  }
  var st = document.getElementById('stars1');
  if (st) stars(st, 22, ['w', 'c', 'y', 'p', 'w', 'c']);
  function particles(el, n) {
    for (var i = 0; i < n; i++) {
      var p = document.createElement('i');
      p.className = 'pp ' + (['c', 'p', 'y'])[i % 3];
      p.style.top = (20 + Math.random() * 60) + '%';
      p.style.left = (5 + Math.random() * 90) + '%';
      p.style.animationDelay = (Math.random() * 6) + 's';
      el.appendChild(p);
    }
  }
  var pt = document.getElementById('particles1');
  if (pt) particles(pt, 12);

  /* ---- 滚动入场（.rv → .visible，同组错峰） ---- */
  var rvs = document.querySelectorAll('.rv');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('visible'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    rvs.forEach(function (el) { io.observe(el); });
  } else {
    rvs.forEach(function (el) { el.classList.add('visible'); });
  }

  /* ---- 右侧导航点 ---- */
  var secs = ['sec-1', 'sec-2', 'sec-3', 'sec-4', 'sec-5'].map(function (id) { return document.getElementById(id); });
  var navdots = document.getElementById('navdots');
  var counter = document.getElementById('counter');
  secs.forEach(function (sec, i) {
    var d = document.createElement('div');
    d.className = 'navdot';
    d.title = 'SEC 0' + (i + 1);
    d.addEventListener('click', function () { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    navdots.appendChild(d);
  });
  function setActive(i) {
    navdots.childNodes.forEach(function (nd, j) { nd.classList.toggle('on', j === i); });
    counter.textContent = (i < 0) ? 'INTRO' : ('SEC 0' + (i + 1) + ' / 05');
  }
  function trackActive() {
    var y = window.scrollY + window.innerHeight * 0.38;
    var idx = -1;
    secs.forEach(function (s, i) { if (s.offsetTop <= y) idx = i; });
    setActive(idx);
  }

  /* ---- 顶部进度条 + 当前段跟踪 ---- */
  var bar = document.getElementById('progressBar');
  function onScroll() {
    var h = document.documentElement;
    var max = h.scrollHeight - h.clientHeight;
    bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + '%';
    trackActive();
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();
})();
