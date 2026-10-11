/* Sharp Fit · 开场动画 v5：智能杠铃装配开屏（每次启动播放，结束后点击「下一步」进入引导）
   开屏分镜：杠铃杆展开 → 杠铃片依次飞入装配（光环+配重浮字）→ 杆压弯弹回 → 小哑铃抢镜被弹飞 → 力-时间曲线淡入 → 下一步按钮；
   三屏引导（仅首次）：哑铃装配（黑箱）→ 柱状图计数（数据）→ 趋势光点（看见）；
   第三屏副文「看得见的训练，才能不断进步」；按钮「开始创建我的计划」。 */
(() => {
  'use strict';

  const KEY = 'sf_onboarding_seen_v1';
  const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const seen = () => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
  const mark = () => { try { localStorage.setItem(KEY, '1'); } catch (e) { /* 忽略存储失败 */ } }

  /* —— 平滑 CMJ（垂直纵跳）力-时间曲线：静立 → 下蹲 → 制动 → 蹬伸 → 腾空 → 冲击 → 回稳 —— */
  function buildCurve(n = 80) {
    const seg = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
    const ease = (x) => x * x * (3 - 2 * x);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      let y = 0.35; // 体重基线
      if (t < 0.20) y = 0.35 + 0.004 * Math.sin(t * 70);
      else if (t < 0.32) y = 0.35 - 0.20 * ease(seg(t, 0.20, 0.32));
      else if (t < 0.47) y = 0.15 + 0.26 * ease(seg(t, 0.32, 0.47));
      else if (t < 0.60) y = 0.41 + 0.54 * ease(seg(t, 0.47, 0.60));
      else if (t < 0.645) y = 0.95 - 0.95 * ease(seg(t, 0.60, 0.645));
      else if (t < 0.79) y = 0;
      else if (t < 0.845) y = 0.72 * Math.sin(Math.PI * seg(t, 0.79, 0.845));
      else y = 0.35 - 0.12 * (1 - ease(seg(t, 0.845, 0.96)));
      pts.push(Math.max(0, Math.min(1, y + 0.003 * Math.sin(i * 0.9)))); // 仪器级微颤
    }
    return pts;
  }

  /* 引导页 SVG 坐标系（viewBox 640×260） */
  const X0 = 20, X1 = 620;

  /* Catmull-Rom → 三次贝塞尔平滑 */
  function smoothD(P) {
    let d = 'M' + P[0][0].toFixed(1) + ' ' + P[0][1].toFixed(1);
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += 'C' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
    }
    return d;
  }

  function accentColor() {
    const c = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
    return c || 'oklch(94% 0.2 117)';
  }

  /* ============ 开屏：柱状图跑步 + 心跳图（循环，结束后点下一步进入引导） ============ */
  function runSplash(root, onDone) {
    /* 6 根递增柱子（楼梯），每根柱子显示一项数据，循环高亮；上方心形跳动 + 两侧 ECG 曲线穿过 */
    const bars = [
      { x: 90,  top: 260, h: 40,  data: '180', unit: 'spm' },
      { x: 170, top: 238, h: 62,  data: '5.2', unit: 'km' },
      { x: 250, top: 212, h: 88,  data: '85',  unit: '%' },
      { x: 330, top: 180, h: 120, data: '0.42',unit: 's' },
      { x: 410, top: 144, h: 156, data: '168', unit: 'bpm' },
      { x: 490, top: 104, h: 196, data: 'PB!', unit: '' },
    ];

    // 柱子（始终显示，循环高亮由 CSS 控制）
    const barsSvg = bars.map((b, i) => `
      <g class="bar-col bar-col-${i}" data-i="${i}">
        <rect class="bar-bg" x="${b.x - 26}" y="${b.top}" width="52" height="${b.h}" rx="6"/>
        <rect class="bar-fill" x="${b.x - 26}" y="${b.top}" width="52" height="${b.h}" rx="6"/>
        <text class="bar-data" x="${b.x}" y="${b.top - 12}">${b.data}</text>
        <text class="bar-unit" x="${b.x}" y="${b.top - 0}">${b.unit}</text>
      </g>`).join('');

    // 更逼真的心形 path（适配面板 y=14~114）
    const heartPath = 'M320,72 C320,65 307,53 295,53 C280,53 270,65 270,78 C270,92 320,112 320,112 C320,112 370,92 370,78 C370,65 360,53 345,53 C333,53 320,65 320,72 Z';

    // 左侧 ECG（连续波形，从左到心形左边缘 x≈270）
    const ecgLeft = 'M30,76 L100,76 L106,72 L110,76 L116,76 L122,68 L126,84 L130,66 L134,76 L210,76 L216,72 L220,76 L226,76 L232,64 L236,88 L240,62 L244,76 L266,76';
    // 右侧 ECG（连续波形，从心形右边缘 x≈370 到右）
    const ecgRight = 'M374,76 L400,76 L406,72 L410,76 L416,76 L422,66 L426,86 L430,64 L434,76 L510,76 L516,72 L520,76 L526,76 L532,68 L536,84 L540,66 L544,76 L610,76';

    const stage = document.createElement('div');
    stage.className = 'sf-stage sf-splash';
    stage.innerHTML = `
      <div class="splash-runner" aria-hidden="true">
        <svg viewBox="0 0 640 360">
          <!-- 科技网格背景 -->
          <g class="tech-grid">
            <line x1="0" y1="100" x2="640" y2="100"/>
            <line x1="0" y1="170" x2="640" y2="170"/>
            <line x1="0" y1="240" x2="640" y2="240"/>
            <line x1="0" y1="310" x2="640" y2="310"/>
          </g>
          <!-- 心跳监测区：心形跳动 + 两侧 ECG 曲线穿过 -->
          <g class="heart-panel">
            <rect class="heart-bg" x="20" y="14" width="600" height="100" rx="12"/>
            <!-- 左侧 ECG -->
            <path class="ecg-line" d="${ecgLeft}"/>
            <!-- 右侧 ECG -->
            <path class="ecg-line" d="${ecgRight}"/>
            <!-- 中间跳动心形 -->
            <path class="heart-shape" d="${heartPath}"/>
            <path class="heart-shape heart-glow" d="${heartPath}"/>
          </g>
          <!-- 柱状图 -->
          <g class="run-bars">${barsSvg}</g>
        </svg>
      </div>
      <div class="splash-copy">
        <div class="splash-eyebrow">SHARP FIT</div>
        <h1>记录你的每一次训练</h1>
      </div>
      <button type="button" class="splash-next">下一步</button>`;
    root.appendChild(stage);

    let finished = false;
    function done() {
      if (finished) return;
      finished = true;
      window.removeEventListener('keydown', onKey, true);
      stage.remove();
      onDone();
    }
    function onKey(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); done(); }
    }
    window.addEventListener('keydown', onKey, true);

    const nextBtn = stage.querySelector('.splash-next');
    nextBtn.addEventListener('click', done);

    let skipped = false;
    stage.addEventListener('pointerdown', () => {
      if (skipped) return;
      skipped = true;
      stage.classList.add('splash-skip');
    }, { once: true });

    const DURATION = REDUCED ? 400 : 4200;
    setTimeout(() => stage.classList.add('splash-ready'), DURATION);
  }

  /* ============ 三屏引导：痛点 → 方法 → 主张（仅首次启动） ============
     三屏各配专属视觉：① 哑铃装配（黑箱）② 柱状图计数（数据）③ 趋势光点（看见） */
  function bellVisual() {
    /* 拆件：横杆组（含两端卡箍）/ 左片组 / 右片组 —— 供「装配」动效分层入场 */
    const barShape = `
      <rect x="170" y="104" width="9" height="52" rx="4"/>
      <rect x="229" y="126" width="182" height="8" rx="4"/>
      <rect x="461" y="104" width="9" height="52" rx="4"/>`;
    const plateL = `
      <rect x="181" y="57" width="20" height="146" rx="8"/>
      <rect x="205" y="72" width="24" height="116" rx="9"/>`;
    const plateR = `
      <rect x="411" y="72" width="24" height="116" rx="9"/>
      <rect x="439" y="57" width="20" height="146" rx="8"/>`;
    return `
      <svg viewBox="0 0 640 260">
        <defs>
          <g id="sfBellBar">${barShape}</g>
          <g id="sfBellPlateL">${plateL}</g>
          <g id="sfBellPlateR">${plateR}</g>
          <clipPath id="sfBellClip">${barShape}${plateL}${plateR}</clipPath>
          <linearGradient id="sfSheen" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#fff" stop-opacity="0"/>
            <stop offset="0.5" stop-color="#fff" stop-opacity="0.35"/>
            <stop offset="1" stop-color="#fff" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <ellipse class="bell-shadow" cx="320" cy="214" rx="152" ry="9"/>
        <use href="#sfBellBar" class="bell-iron bel-bar"/>
        <use href="#sfBellPlateL" class="bell-iron bel-pll"/>
        <use href="#sfBellPlateR" class="bell-iron bel-plr"/>
        <use href="#sfBellBar" class="bell-glow bel-bar"/>
        <use href="#sfBellPlateL" class="bell-glow bel-pll"/>
        <use href="#sfBellPlateR" class="bell-glow bel-plr"/>
        <g clip-path="url(#sfBellClip)"><g class="bell-sheen"><rect x="-150" y="30" width="110" height="200" transform="skewX(-16)" fill="url(#sfSheen)"/></g></g>
      </svg>`;
  }

  function barsVisual() {
    return `
      <svg viewBox="0 0 640 260">
        <line class="grid-line" x1="110" y1="72" x2="530" y2="72"/>
        <line class="grid-line" x1="110" y1="115" x2="530" y2="115"/>
        <line class="grid-line" x1="110" y1="158" x2="530" y2="158"/>
        <line class="base-line" x1="110" y1="200" x2="530" y2="200"/>
        <rect class="bar" x="188" y="130" width="64" height="70" rx="7"/>
        <rect class="bar" x="288" y="105" width="64" height="95" rx="7"/>
        <rect class="bar" x="388" y="75" width="64" height="125" rx="7"/>
        <text class="bar-num" x="220" y="112" data-count="80">80</text>
        <text class="bar-num" x="320" y="87" data-count="82.5">82.5</text>
        <text class="bar-num" x="420" y="57" data-count="87.5">87.5</text>
      </svg>`;
  }

  /* 周期化上升的进步趋势（波动上行） */
  const TREND = [0.30, 0.38, 0.35, 0.45, 0.52, 0.48, 0.58, 0.68, 0.62, 0.74, 0.80, 0.88];
  const TREND_P = TREND.map((v, i) => [X0 + (X1 - X0) * (i / (TREND.length - 1)), 214 - v * 132]);

  function trendVisual() {
    const trendD = smoothD(TREND_P);
    const areaD = trendD + 'L' + X1 + ' 238L' + X0 + ' 238Z';
    const last = TREND_P[TREND_P.length - 1];
    let pts = '';
    for (let i = 0; i < TREND_P.length - 1; i++) {
      pts += `<circle class="trend-pt" cx="${TREND_P[i][0].toFixed(1)}" cy="${TREND_P[i][1].toFixed(1)}" r="2.5" style="transition-delay:${i * 90}ms"/>`;
    }
    return `
      <svg viewBox="0 0 640 260">
        <defs>
          <linearGradient id="sfTrend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style="stop-color:var(--color-accent)" stop-opacity="0.22"/>
            <stop offset="100%" style="stop-color:var(--color-accent)" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <line class="trend-base" x1="${X0}" y1="238" x2="${X1}" y2="238"/>
        <path class="trend-area" d="${areaD}" fill="url(#sfTrend)"/>
        <path class="trend-line" d="${trendD}"/>
        ${pts}
        <circle class="trend-head" r="3.4" style="offset-path:path('${trendD}')"/>
        <g class="trend-end">
          <circle class="trend-ripple" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="6"/>
          <circle class="trend-halo" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="11"/>
          <circle class="trend-core" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4"/>
        </g>
      </svg>`;
  }

  /* 数字滚动计数：柱状图数字从 0 滚到目标值（与柱子升起节奏错峰同步） */
  function playBarsCounters(slide, token, getToken) {
    const nums = Array.from(slide.querySelectorAll('.bar-num'));
    if (!nums.length) return;
    const DELAYS = [650, 930, 1210];
    nums.forEach((n, k) => {
      const txt = (n.dataset.count || n.textContent).trim();
      const target = parseFloat(txt) || 0;
      const dec = (txt.split('.')[1] || '').length;
      if (REDUCED) { n.textContent = txt; n.style.opacity = '1'; n.style.transform = 'none'; return; }
      n.textContent = '0';
      n.style.opacity = '0';
      n.style.transform = 'translateY(6px)';
      const t0 = performance.now();
      (function tick(now) {
        if (getToken() !== token) return; // 已切屏/重播，终止旧计数
        const p = (now - t0 - DELAYS[k]) / 850;
        if (p < 0) { requestAnimationFrame(tick); return; }
        n.style.opacity = '1';
        n.style.transform = 'none';
        const q = Math.min(1, p);
        const e = 1 - Math.pow(1 - q, 3);
        n.textContent = (target * e).toFixed(dec);
        if (q < 1) requestAnimationFrame(tick);
        else n.textContent = txt;
      })(t0);
    });
  }

  function runGuide(root, onFinish) {
    const slides = [
      { state: 'bell', kicker: '01 · 黑箱', title: '你的努力，是个黑箱', sub: '练了多少、进步在哪、为什么卡住——凭感觉，永远说不清。', visual: bellVisual() },
      { state: 'bars', kicker: '02 · 数据', title: '把训练变成数据', sub: '每一次跳跃、每一次发力，都被精确记录。', visual: barsVisual() },
      { state: 'trend', kicker: '03 · 看见', title: '让训练被看见', sub: '看得见的训练，才能不断进步', cta: '开始创建我的计划', visual: trendVisual() }
    ];

    const stage = document.createElement('div');
    stage.className = 'sf-stage sf-guide';
    stage.innerHTML = `
      <div class="guide-brand" aria-hidden="true">SHARP FIT</div>
      <button type="button" class="guide-skip">跳过</button>
      <div class="guide-viewport">
        <div class="guide-track">
          ${slides.map((s) => `
            <section class="g-slide" data-state="${s.state}">
              <div class="g-visual" aria-hidden="true">${s.visual}</div>
              <div class="g-kicker">${s.kicker}</div>
              <h2 class="g-title">${s.title}</h2>
              <p class="g-sub">${s.sub}</p>
              ${s.cta ? `<div class="g-cta"><button type="button" class="btn-start">${s.cta}</button></div>` : ''}
            </section>`).join('')}
        </div>
      </div>
      <div class="guide-dots" role="tablist" aria-label="引导页切换">
        ${slides.map((s, i) => `<button type="button" class="g-dot" data-i="${i}" aria-label="第 ${i + 1} 屏"></button>`).join('')}
      </div>`;
    root.appendChild(stage);

    // 屏3 趋势曲线：描边生长动画的路径长度
    const trendLine = stage.querySelector('.trend-line');
    if (trendLine) trendLine.style.setProperty('--len', Math.ceil(trendLine.getTotalLength()));

    const track = stage.querySelector('.guide-track');
    const view = stage.querySelector('.guide-viewport');
    const dotEls = Array.from(stage.querySelectorAll('.g-dot'));
    let idx = 0;
    let counterToken = 0;

    function go(i) {
      idx = Math.max(0, Math.min(slides.length - 1, i));
      track.style.transform = `translateX(-${idx * 100}%)`;
      dotEls.forEach((b, k) => b.classList.toggle('on', k === idx));
      Array.from(track.children).forEach((s) => s.classList.remove('play'));
      counterToken++; // 使未完成的旧计数循环失效
      const cur = track.children[idx];
      void cur.offsetWidth; // 强制重排，重播入场动画
      cur.classList.add('play');
      if (cur.dataset.state === 'bars') playBarsCounters(cur, counterToken, () => counterToken);
    }

    let closed = false;
    function finish() {
      if (closed) return;
      closed = true;
      mark();
      window.removeEventListener('keydown', onKey, true);
      onFinish();
    }

    function onKey(e) {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        go(idx + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        go(idx - 1);
      } else if (e.key === 'Escape') {
        finish();
      } else if (e.key === 'Enter' && idx === slides.length - 1) {
        finish();
      }
    }

    stage.querySelector('.guide-skip').addEventListener('click', finish);
    dotEls.forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.i))));
    const cta = stage.querySelector('.btn-start');
    if (cta) cta.addEventListener('click', finish);
    window.addEventListener('keydown', onKey, true);

    // 横向滑动 / 拖拽翻页
    let px = null;
    view.addEventListener('pointerdown', (e) => { px = e.clientX; });
    window.addEventListener('pointerup', (e) => {
      if (px == null) return;
      const dx = e.clientX - px;
      px = null;
      if (Math.abs(dx) > 60) go(idx + (dx < 0 ? 1 : -1));
    });

    go(0);
  }

  /* ============ 入口：开屏每次播放；三屏引导仅首次 ============ */
  function boot() {
    const root = document.createElement('div');
    root.id = 'sfIntro';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Sharp Fit 开场');
    document.body.appendChild(root);

    function close() {
      root.classList.add('leaving');
      setTimeout(() => root.remove(), 640);
    }
    runSplash(root, () => {
      if (!seen()) runGuide(root, close);
      else close();
    });
  }

  boot();
})();
