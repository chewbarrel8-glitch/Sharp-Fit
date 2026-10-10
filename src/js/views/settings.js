// 设置页（本地离线平台，无账户）：外观（背景/强调色/密度）· 数据备份与恢复 · 通用偏好 · 关于与联系开发者
Views.settings = (() => {
  const state = { tab: 'appearance', info: null };

  // ---------------- 外观配置 ----------------
  const ACCENTS = {
    volt:   { name: '荧光绿', swatch: '#d8ff4b', accent: 'oklch(94% 0.2 117)',  deep: 'oklch(83% 0.19 117)', ink: 'oklch(17% 0.035 117)' },
    ocean:  { name: '海蓝',   swatch: '#5aa7ff', accent: 'oklch(72% 0.15 245)', deep: 'oklch(62% 0.16 245)', ink: 'oklch(16% 0.04 245)' },
    amber:  { name: '暖橙',   swatch: '#ff9d4d', accent: 'oklch(78% 0.15 55)',  deep: 'oklch(70% 0.16 55)',  ink: 'oklch(18% 0.04 55)' },
    violet: { name: '紫',     swatch: '#b48cff', accent: 'oklch(74% 0.18 290)', deep: 'oklch(65% 0.18 290)', ink: 'oklch(16% 0.04 290)' },
    rose:   { name: '玫红',   swatch: '#ff6f91', accent: 'oklch(72% 0.17 12)',  deep: 'oklch(64% 0.19 12)',  ink: 'oklch(17% 0.04 12)' }
  };
  const BGMODES = [
    { id: 'solid', name: '纯色', desc: '深邃纯色，专注工作' },
    { id: 'gradient', name: '渐变', desc: '低调双色光晕' },
    { id: 'starfield', name: '星空', desc: '自然星点缓动' }
  ];

  function appearance() {
    const s = Store.data.settings;
    if (!s.appearance) s.appearance = { bgm: 'solid', accent: 'volt', density: 'cozy', theme: 'dark', dim: 0.55 };
    ['bgm', 'accent', 'density', 'theme', 'dim'].forEach((k) => { if (!(k in s.appearance)) s.appearance[k] = { bgm: 'solid', accent: 'volt', density: 'cozy', theme: 'dark', dim: 0.55 }[k]; });
    if (s.appearance.bgm === 'image') s.appearance.bgm = 'solid';   // 自定义背景图功能已移除，旧配置回退纯色
    return s.appearance;
  }
  function saveAppearance() { Store.data.settings.appearance = appearance(); Store.save(); }

  // 应用外观到文档（app.js 启动时与设置页修改后调用）
  // 注意：主题属性必须同时挂在 <html> 上——--bg2/--panel 等映射变量在 :root 上完成 var() 解析，
  // 只挂 body 会导致映射变量仍按 html 上的深色 token 解析（浅色模式下出现黑色残留）
  function applyAppearance() {
    const a = appearance();
    const light = a.theme === 'light';
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    document.body.dataset.theme = light ? 'light' : 'dark';
    document.body.dataset.bgm = a.bgm || 'solid';
    document.body.dataset.density = a.density || 'cozy';
    document.documentElement.style.colorScheme = light ? 'light' : 'dark';
    const c = ACCENTS[a.accent] || ACCENTS.volt;
    const r = document.documentElement.style;
    // 浅色模式下强调色改用 deep 版本保证白底可读，其上文字改为亮色
    r.setProperty('--color-accent', light ? c.deep : c.accent);
    r.setProperty('--color-accent-deep', c.deep);
    r.setProperty('--color-accent-ink', light ? 'oklch(99% 0.005 117)' : c.ink);
    r.setProperty('--volt', light ? c.deep : c.swatch);
    r.setProperty('--volt-deep', c.deep);
    r.setProperty('--volt-dim', (light ? c.deep : c.accent).replace(/\)$/, ' / 0.14)'));
    r.setProperty('--bg-dim', String(a.dim == null ? 0.55 : a.dim));
    stopStars();                                  // 主题切换后星色随之重建
    if (a.bgm === 'starfield') startStars();
  }

  // ---------------- 星空背景（清晰星点 · 自然色温 · 极慢漂移 · 不闪烁） ----------------
  let starRAF = null, starCanvas = null, stars = [], starResize = null;
  function stopStars() {
    if (starRAF) { cancelAnimationFrame(starRAF); starRAF = null; }
    if (starResize) { window.removeEventListener('resize', starResize); starResize = null; }
    if (starCanvas) { starCanvas.remove(); starCanvas = null; }
    stars = [];
  }
  function startStars() {
    const host = document.getElementById('bgFx');
    if (!host || document.getElementById('bgStars')) return;
    starCanvas = document.createElement('canvas');
    starCanvas.id = 'bgStars';
    host.appendChild(starCanvas);
    const ctx = starCanvas.getContext('2d');
    let W = 0, H = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    starResize = () => {
      W = window.innerWidth; H = window.innerHeight;
      starCanvas.width = W * dpr; starCanvas.height = H * dpr;
      starCanvas.style.width = W + 'px'; starCanvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(220, Math.round(W * H / 9000));
      const light = document.body.dataset.theme === 'light';
      stars = Array.from({ length: n }, () => {
        const roll = Math.random();
        // 色温：70% 主色 / 20% 淡蓝 / 10% 暖黄；浅色主题下用深灰蓝星点保证可见
        const c = light
          ? (roll > 0.3 ? '70,82,112' : (roll > 0.1 ? '90,120,190' : '150,115,60'))
          : (roll > 0.3 ? '255,255,255' : (roll > 0.1 ? '205,222,255' : '255,238,205'));
        return {
          x: Math.random() * W, y: Math.random() * H,
          r: 0.4 + Math.random() * 1.1,
          c,
          a: 0.45 + Math.random() * 0.5,
          vx: (Math.random() - 0.5) * 0.012, vy: (Math.random() - 0.5) * 0.012
        };
      });
    };
    starResize();
    window.addEventListener('resize', starResize);
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      for (const s of stars) {
        s.x += s.vx; s.y += s.vy;
        if (s.x < 0) s.x = W; if (s.x > W) s.x = 0;
        if (s.y < 0) s.y = H; if (s.y > H) s.y = 0;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + s.c + ',' + s.a + ')';
        ctx.fill();
      }
      starRAF = requestAnimationFrame(draw);
    };
    draw();
  }

  // ---------------- 联系开发者（侧栏按钮与关于页共用） ----------------
  function contactDev() {
    UI.modal({
      title: '联系开发者',
      body: `<div style="text-align:center">
        <img src="assets/developer-qr.jpg" alt="开发者二维码" style="max-width:100%;max-height:56vh;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35)">
        <p style="margin:14px 0 0;color:var(--dim);font-size:13px;line-height:1.8">扫码添加开发者好友<br>问题反馈、功能建议、新版本安装包均可通过好友获取</p>
      </div>`,
      footer: `<button class="btn primary" data-x>关闭</button>`
    });
  }

  // ---------------- 主渲染 ----------------
  const TABS = [
    { id: 'appearance', name: '外观' },
    { id: 'data', name: '数据与备份' },
    { id: 'general', name: '通用' },
    { id: 'manual', name: '使用手册' },
    { id: 'about', name: '关于' }
  ];

  function mount(box) {
    box.innerHTML = `
      <div class="st-wrap">
        <div class="st-tabs" role="tablist">
          ${TABS.map((t) => `<button type="button" class="st-tab ${state.tab === t.id ? 'on' : ''}" data-tab="${t.id}">${t.name}</button>`).join('')}
        </div>
        <div class="st-body" id="stBody"></div>
      </div>`;
    $$('.st-tab', box).forEach((b) => b.onclick = () => { state.tab = b.dataset.tab; mount(box); });
    const body = $('#stBody', box);
    if (state.tab === 'appearance') renderAppearance(body);
    else if (state.tab === 'data') renderData(body);
    else if (state.tab === 'general') renderGeneral(body);
    else if (state.tab === 'manual') renderManual(body);
    else renderAbout(body);
  }

  function card(title, sub, inner) {
    return `<section class="card st-card">
      <div class="card-title"><h3>${U.esc(title)}</h3>${sub ? `<p class="hint" style="margin:2px 0 0;font-size:12px">${U.esc(sub)}</p>` : ''}</div>
      <div class="st-card-body">${inner}</div>
    </section>`;
  }
  function row(label, hint, ctrl) {
    return `<div class="st-row"><div class="st-row-l"><div class="st-row-t">${U.esc(label)}</div>${hint ? `<div class="hint" style="font-size:11.5px;margin-top:2px">${U.esc(hint)}</div>` : ''}</div><div class="st-row-r">${ctrl}</div></div>`;
  }

  // ---------- 外观 ----------
  function renderAppearance(body) {
    const a = appearance();
    body.innerHTML =
      card('明暗模式', '', `
        <div class="st-seg">
          ${['dark', 'light'].map((t) => `<button type="button" class="st-seg-btn ${(a.theme || 'dark') === t ? 'on' : ''}" data-theme="${t}">${t === 'dark' ? '深色' : '浅色'}</button>`).join('')}
        </div>`)
      + card('背景模式', '', `
        <div class="st-bgm">
          ${BGMODES.map((m) => `<button type="button" class="st-bgm-opt ${a.bgm === m.id ? 'on' : ''}" data-bgm="${m.id}">
            <span class="st-bgm-prev st-bgm-${m.id}"></span>
            <b>${m.name}</b><i>${m.desc}</i>
          </button>`).join('')}
        </div>
        ${row('背景遮罩', '加深遮罩可让文字更清晰（星空 / 渐变模式下生效）', `
          <input type="range" id="stDim" min="0.15" max="0.85" step="0.05" value="${a.dim}" style="width:200px"> <span id="stDimV" class="hint">${Math.round(a.dim * 100)}%</span>`)}
      `)
      + card('强调色', '', `
        <div class="st-swatches">
          ${Object.entries(ACCENTS).map(([id, c]) => `<button type="button" class="st-sw ${a.accent === id ? 'on' : ''}" data-accent="${id}" title="${c.name}" style="--sw:${c.swatch}"><span></span>${c.name}</button>`).join('')}
        </div>`)
      + card('界面密度', '', `
        <div class="st-seg">
          ${['cozy', 'compact'].map((d) => `<button type="button" class="st-seg-btn ${a.density === d ? 'on' : ''}" data-density="${d}">${d === 'cozy' ? '舒适' : '紧凑'}</button>`).join('')}
        </div>`);

    $$('[data-theme]', body).forEach((b) => b.onclick = () => { a.theme = b.dataset.theme; saveAppearance(); applyAppearance(); renderAppearance(body); });
    $$('[data-bgm]', body).forEach((b) => b.onclick = () => { a.bgm = b.dataset.bgm; saveAppearance(); applyAppearance(); renderAppearance(body); });
    $$('[data-accent]', body).forEach((b) => b.onclick = () => { a.accent = b.dataset.accent; saveAppearance(); applyAppearance(); renderAppearance(body); });
    $$('[data-density]', body).forEach((b) => b.onclick = () => { a.density = b.dataset.density; saveAppearance(); applyAppearance(); renderAppearance(body); });
    $('#stDim', body).oninput = (e) => { a.dim = Number(e.target.value); $('#stDimV', body).textContent = Math.round(a.dim * 100) + '%'; applyAppearance(); };
    $('#stDim', body).onchange = () => saveAppearance();
  }

  // ---------- 数据与备份 ----------
  function renderData(body) {
    const d = Store.data;
    const mac = Store.activeMacro();
    const sizeKb = Math.round(new Blob([JSON.stringify(d)]).size / 1024);
    const stat = (n, label) => `<div class="st-stat"><b>${n}</b><span>${label}</span></div>`;
    body.innerHTML =
      card('数据概况', '', `
        <div class="st-stats">
          ${stat(d.macros.length, '训练计划')}${stat(d.athletes.length, '运动员')}${stat(d.sessions.length, '训练课')}
          ${stat(d.profiles.length, '体能档案')}${stat(d.tests.length, '测试记录')}${stat(sizeKb + ' KB', '数据库大小')}
        </div>`)
      + card('计划数据包', '', `
        ${mac ? `<div class="hint" style="margin-bottom:8px"><b>${U.esc(mac.name)}</b></div>` : '<div class="hint" style="margin-bottom:8px">请先在周期总表创建或选择一个计划</div>'}
        <div class="st-actions">
          <button type="button" class="btn" id="stPackExport" ${mac ? '' : 'disabled'}>导出当前计划数据包</button>
          <button type="button" class="btn ghost" id="stPackImport">导入计划数据包…</button>
          <input type="file" id="stPackFile" accept=".json,application/json" style="display:none">
        </div>
        <p class="hint" id="stPackMsg" style="font-size:11.5px;margin:8px 0 0;line-height:1.7"></p>`)
      + card('备份与恢复', '', `
        ${row('自动备份', '开启后每次启动应用自动备份（每天最多一份，保留最近 7 份）', `
          <label class="st-switch"><input type="checkbox" id="stAutoBak" ${d.settings.autoBackup ? 'checked' : ''}><i></i></label>`)}
        <div class="st-actions">
          <button type="button" class="btn" id="stBakNow">立即备份到本机</button>
          <button type="button" class="btn ghost" id="stBakDownload">导出备份文件</button>
          <button type="button" class="btn ghost" id="stBakFolder">打开备份文件夹</button>
          <button type="button" class="btn warn" id="stRestore">恢复备份…</button>
          <input type="file" id="stRestoreFile" accept=".json,application/json" style="display:none">
        </div>
        <p class="hint" id="stBakMsg" style="font-size:11.5px;margin:8px 0 0;line-height:1.7"></p>`)
      + card('危险区', '不可逆操作，请谨慎', `
        <div class="st-danger">
          <div>
            <b>清空全部数据</b>
            <p class="hint" style="font-size:11.5px;margin:4px 0 0">删除全部计划、运动员、档案、训练课与设置，恢复到出厂空白状态。<br>操作前请先「导出备份文件」。</p>
          </div>
          <button type="button" class="btn danger" id="stWipe">清空全部数据</button>
        </div>`);

    const msg = $('#stBakMsg', body);
    // ---- 计划数据包：导出 / 导入 ----
    const packMsg = $('#stPackMsg', body);
    const packBtn = $('#stPackExport', body);
    if (packBtn && mac) packBtn.onclick = async () => {
      const pack = Store.exportPlan(mac.id);
      if (!pack) { packMsg.textContent = '导出失败：未找到当前计划'; return; }
      const safe = (mac.name || '计划').replace(/[\\/:*?"<>|]/g, '_');
      const fname = `SharpFit-计划包-${safe}-${U.today()}.json`;
      const text = JSON.stringify(pack);
      // 系统另存为对话框：由用户选择保存位置（Electron）；无 api 时回退浏览器下载
      if (window.api && window.api.exportFileAs) {
        const r = await window.api.exportFileAs(fname, text);
        if (r.canceled) { packMsg.textContent = '已取消导出'; return; }
        if (r.ok) { packMsg.innerHTML = `计划数据包已保存到：<code>${U.esc(r.path)}</code>`; UI.toast('计划数据包已导出', 'ok'); return; }
        if (r.msg) { packMsg.textContent = '导出失败：' + r.msg; return; }
      }
      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = fname;
      a.click(); URL.revokeObjectURL(a.href);
      packMsg.textContent = '已触发浏览器下载';
    };
    const packFile = $('#stPackFile', body);
    $('#stPackImport', body).onclick = () => packFile.click();
    packFile.onchange = () => {
      const file = packFile.files && packFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => confirmImportPack(String(reader.result || ''));
      reader.readAsText(file);
      packFile.value = '';
    };

    $('#stAutoBak', body).onchange = (e) => {
      d.settings.autoBackup = e.target.checked;
      Store.save();
      UI.toast(e.target.checked ? '已开启自动备份' : '已关闭自动备份', 'ok');
      if (e.target.checked && window.api && window.api.backupDB) window.api.backupDB();
    };
    $('#stBakNow', body).onclick = async () => {
      if (!window.api || !window.api.backupDB) { msg.textContent = '当前环境不支持本机备份，请用「导出备份文件」'; return; }
      const r = await window.api.backupDB();
      msg.innerHTML = r.ok ? `已备份到：<code>${U.esc(r.path)}</code>` : ('备份失败：' + U.esc(r.msg || '未知错误'));
      if (r.ok) UI.toast('备份完成', 'ok');
    };
    $('#stBakDownload', body).onclick = async () => {
      const t = U.today();
      const text = JSON.stringify(Store.data, null, 2);
      // 系统另存为对话框：由用户选择保存位置（Electron）；无 api 时回退浏览器下载
      if (window.api && window.api.exportFileAs) {
        const r = await window.api.exportFileAs('SharpFit-备份-' + t + '.json', text);
        if (r.canceled) { msg.textContent = '已取消导出'; return; }
        if (r.ok) { msg.innerHTML = `备份文件已保存到：<code>${U.esc(r.path)}</code>`; UI.toast('备份文件已导出', 'ok'); return; }
        if (r.msg) { msg.textContent = '导出失败：' + r.msg; return; }
      }
      // 浏览器预览环境兜底：blob 下载
      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'SharpFit-备份-' + t + '.json';
      a.click(); URL.revokeObjectURL(a.href);
      msg.textContent = '已触发浏览器下载';
    };
    $('#stBakFolder', body).onclick = async () => {
      if (window.api && window.api.openPath) {
        const info = state.info || (window.api.appInfo ? await window.api.appInfo() : null);
        window.api.openPath(info ? info.userData : '');
      } else msg.textContent = '当前环境不支持打开文件夹';
    };
    const rf = $('#stRestoreFile', body);
    $('#stRestore', body).onclick = () => rf.click();
    rf.onchange = () => {
      const file = rf.files && rf.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => confirmRestore(String(reader.result || ''));
      reader.readAsText(file);
      rf.value = '';
    };
    $('#stWipe', body).onclick = () => confirmWipe();
  }

  // 计划数据包导入确认：展示包内数据量，确认后整体追加为独立计划
  function confirmImportPack(text) {
    const r = Store.importPlan(text);
    if (!r.ok) { UI.toast(r.msg || '数据包无效', 'err'); return; }
    const n = (k) => (r.pack[k] || []).length;
    UI.modal({
      title: '导入计划数据包',
      body: `<div style="font-size:13px;line-height:2">
        <p style="margin:0 0 8px">数据包 <b>${U.esc(r.name)}</b> 将作为<b>新的独立计划</b>导入，不会影响你已有的数据。</p>
        包内内容：<b>${n('macros')}</b> 个计划 · <b>${n('mesos')}</b> 个中周期 · <b>${n('micros')}</b> 个小周期 · <b>${n('sessions')}</b> 节训练课 · <b>${n('athletes')}</b> 名运动员 · <b>${n('profiles')}</b> 份体能档案 · <b>${n('tests')}</b> 条测试记录。<br>
        导入后将自动切换到该计划并刷新页面。
      </div>`,
      footer: `<button class="btn ghost" data-x>取消</button><button class="btn primary" data-ok>确认导入</button>`,
      onMount(ov, close) {
        ov.querySelector('[data-ok]').onclick = async () => {
          const done = r.apply();
          if (!done.ok) { close(); UI.toast(done.msg || '导入失败', 'err'); return; }
          close();
          UI.toast(`计划「${done.name}」已导入`, 'ok');
          setTimeout(() => { location.hash = '#/macro'; location.reload(); }, 600);
        };
      }
    });
  }

  // 恢复前确认弹窗：展示备份内含数据量，确认后替换并 reload
  function confirmRestore(text) {
    let obj = null;
    try { obj = JSON.parse(text); } catch (e) { UI.toast('文件不是有效的备份（JSON 解析失败）', 'err'); return; }
    if (!obj || typeof obj !== 'object' || !('macros' in obj) && !('athletes' in obj) && !('profiles' in obj)) {
      UI.toast('文件内容不是 Sharp Fit 备份数据', 'err');
      return;
    }
    const n = (k) => Array.isArray(obj[k]) ? obj[k].length : 0;
    UI.modal({
      title: '恢复备份',
      body: `<div style="font-size:13px;line-height:2">
        <p style="color:var(--color-warning);margin:0 0 8px">将用备份文件<b>整体替换</b>当前全部数据，当前数据会被覆盖。</p>
        备份内容：<b>${n('macros')}</b> 个计划 · <b>${n('athletes')}</b> 名运动员 · <b>${n('profiles')}</b> 份体能档案 · <b>${n('sessions')}</b> 节训练课。<br>
        建议恢复前先「导出备份文件」保留当前数据。
      </div>`,
      footer: `<button class="btn ghost" data-x>取消</button><button class="btn primary" data-ok>确认恢复并重启</button>`,
      onMount(ov, close) {
        ov.querySelector('[data-ok]').onclick = async () => {
          await Store.replaceAll(obj);
          close();
          UI.toast('备份已恢复，正在重启…', 'ok');
          setTimeout(() => location.reload(), 600);
        };
      }
    });
  }

  // 清空确认：需输入「清空」二字才能提交，防误触
  function confirmWipe() {
    UI.modal({
      title: '清空全部数据',
      body: `<div style="font-size:13px;line-height:2">
        <p style="color:var(--color-danger);margin:0 0 8px"><b>此操作不可撤销！</b>全部计划、运动员、体能档案、训练课与外观设置都将被删除。</p>
        请在下方输入 <b>清空</b> 两个字以确认：
        <input class="ipt" id="stWipeInput" placeholder="清空" style="margin-top:8px;width:100%">
      </div>`,
      footer: `<button class="btn ghost" data-x>取消</button><button class="btn danger" id="stWipeOk" disabled>确认清空并重启</button>`,
      onMount(ov, close) {
        const inp = ov.querySelector('#stWipeInput'), ok = ov.querySelector('#stWipeOk');
        inp.oninput = () => { ok.disabled = inp.value.trim() !== '清空'; };
        ok.onclick = async () => {
          await Store.resetAll();
          close();
          UI.toast('已清空全部数据，正在重启…', 'ok');
          setTimeout(() => location.reload(), 600);
        };
      }
    });
  }

  // ---------- 通用 ----------
  function renderGeneral(body) {
    const s = Store.data.settings;
    if (!s.homeRoute) s.homeRoute = 'macro';
    const demoOn = !!(s.demo && Store.data.macros.some((m) => m.id === s.demo.macroId));
    body.innerHTML =
      card('语言', '', `
        <div class="st-seg">
          <button type="button" class="st-seg-btn ${(s.locale || 'zh-CN') === 'zh-CN' ? 'on' : ''}" data-loc="zh-CN">简体中文</button>
          <button type="button" class="st-seg-btn ${s.locale === 'zh-TW' ? 'on' : ''}" data-loc="zh-TW">繁體中文</button>
          <button type="button" class="st-seg-btn ${s.locale === 'en' ? 'on' : ''}" data-loc="en">English</button>
        </div>`)
      + card('启动', '应用打开后默认显示的页面', `
        ${row('启动页面', '可固定为周期总表，或记住上次离开时的页面', `
          <div class="st-seg">
            <button type="button" class="st-seg-btn ${s.homeRoute !== 'last' ? 'on' : ''}" data-home="macro">周期总表</button>
            <button type="button" class="st-seg-btn ${s.homeRoute === 'last' ? 'on' : ''}" data-home="last">上次页面</button>
          </div>`)}`)
      + card('体能测试项目库', '', `
        <div class="st-actions">
          <button type="button" class="btn" id="stTestLib">管理测试项目库</button>
          <span class="hint" style="font-size:12px">当前已添加 <b>${(s.testItems || []).length}</b> 项</span>
        </div>`)
      + card('示例数据', '', `
        <div class="st-actions">
          <button type="button" class="btn ${demoOn ? 'warn' : 'ghost'}" id="stDemo">${demoOn ? '退出并移除示例' : '载入内置示例'}</button>
          <span class="hint" style="font-size:12px">${demoOn ? '示例当前已载入，退出后示例数据将被精确移除，你的数据保留' : '10 个月 · 2 个大周期 · 15 名运动员 · 训练课与体能测试'}</span>
        </div>`);

    $$('[data-home]', body).forEach((b) => b.onclick = () => {
      s.homeRoute = b.dataset.home; Store.save(); UI.toast('已保存', 'ok'); renderGeneral(body);
    });
    $$('[data-loc]', body).forEach((b) => b.onclick = () => {
      const loc = b.dataset.loc;
      if ((s.locale || 'zh-CN') === loc) return;
      I18n.setLocale(loc);   // 持久化并整页重载，图表内文字也会随新语言重绘
    });
    $('#stTestLib', body).onclick = () => Views.profile.testLibDialog();
    $('#stDemo', body).onclick = () => {
      if (demoOn) {
        UI.confirm('将退出并清除内置示例（示例计划、训练课、负荷、测试与示例运动员）。你自行添加的数据会保留。是否继续？', () => {
          window.exitDemo(); UI.toast('已退出示例', 'ok'); location.hash = '#/macro'; location.reload();
        });
      } else {
        UI.confirm('将载入内置示例「XX篮球队备战计划」，不会覆盖你已有的计划与数据。是否继续？', () => {
          window.seedDemo(); UI.toast('示例已载入', 'ok'); location.hash = '#/macro'; location.reload();
        });
      }
    };
  }

  // ---------- 使用手册 ----------
  // 章节：t=标题, d=一句话说明, open=默认展开；正文用有序/无序列表分步说明
  function manSec(t, d, inner, open) {
    return `<details class="st-man"${open ? ' open' : ''}>
      <summary><b>${U.esc(t)}</b><span>${U.esc(d)}</span></summary>
      <div class="st-man-b">${inner}</div>
    </details>`;
  }
  const ol = (items) => `<ol>${items.map((i) => `<li>${i}</li>`).join('')}</ol>`;
  const ul = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;

  function renderManual(body) {
    body.innerHTML = `
    <div class="st-man-top">
      <b>Sharp Fit 使用手册</b>
      <span>从零开始排出一份完整训练计划，只需要下面「快速上手」的 6 步；每个功能的详细说明在对应章节里，点击标题即可展开。</span>
    </div>
    ${manSec('快速上手：6 步排出第一份计划', '第一次使用从这里开始，全程约 10 分钟', ol([
      '<b>① 创建计划</b>：进入 <b>01 周期训练计划</b>，点击右上角「新建训练计划」，填写名称、运动项目、开始与结束日期。计划是所有数据的容器，先有计划才能排课。',
      '<b>② 建大周期阶段</b>：在 <b>01 周期训练计划</b> 页面顶部设定比赛日与测试日；再到 <b>02 中周期</b> 点击「新建中周期」，为每个阶段（如准备期、力量期、赛前减量）划分日期范围与训练目标。',
      '<b>③ 排训练内容</b>：在 <b>02 中周期</b> 选中某个日期，在下方课表中「添加动作」——从动作库选择动作、填 %1RM 强度、组数与次数。左侧日滑块可整体调节当天强度。',
      '<b>④ 添加运动员</b>：进入 <b>07 运动员档案</b>，点击「新建运动员」填写姓名、位置、性别等；回到 01 页点「套用运动员」把整个队伍挂到计划上。',
      '<b>⑤ 录体能数据</b>：在 <b>07 运动员档案</b> 给运动员「添加体能数据」（纵跳、冲刺、1RM 测定等），也可以用「导入体能测试」直接选 Excel 文件，系统自动识别格式入库。',
      '<b>⑥ 查看分析</b>：训练后到 <b>04 训练课</b> 登记完成情况与 RPE，然后到 <b>05 负荷管理</b> 看负荷曲线与 ACWR，到 <b>08 KPI 分析</b> 看体能变化与团队排名。'
    ], ), true)}
    ${manSec('01 周期训练计划 · 总览与总表', '计划的创建、比赛日、周期总表的操作', `
      <p class="st-man-h">这个页面做什么</p>
      <p>管理你的训练计划（一个大周期），并用「周期总表」以月历形式总览全年安排：哪天有课、哪天比赛、哪天测试、当前处于哪个中周期。</p>
      <p class="st-man-h">创建与切换计划</p>
      ${ol([
        '右上角「新建训练计划」：填名称、运动大类、专项、开始/结束日期。',
        '顶部下拉可随时切换当前编辑的计划；「删除训练计划」会连同该计划下的中周期、课表与运动员档案一起删除（不可恢复，建议先导出计划数据包）。',
        '切换计划后，其他页面（中周期、训练课、档案、KPI）都只显示当前计划的数据。'
      ])}
      <p class="st-man-h">比赛日与测试日</p>
      ${ul([
        '「添加比赛日」：填日期、名称、地点。比赛日会在总表和日历上标红，负荷管理会自动倒推减量建议。',
        '「添加测试日」：规划体能测试的时间点，KPI 分析可按测试日期对比成绩变化。'
      ])}
      <p class="st-man-h">周期总表</p>
      ${ul([
        '总表按月分列，行依次是日期（周几）、周数、序号、大周期、中周期、测试、训练目标等分类行。',
        '顶部工具条可「添加分类」（如恢复、营养）与「隐藏分类」；按类别显示/隐藏、点击「隐藏大分类」可折叠整块。',
        '点击总表中的任意日期可跳到该日的安排；中周期行显示各阶段色块，直接反映阶段划分是否合理。'
      ])}
    `)}
    ${manSec('02 中周期 · 阶段与课表', '排课的核心页面：阶段划分、强度滑块、动作安排', `
      <p class="st-man-h">这个页面做什么</p>
      <p>把大周期拆成 4~8 周的中周期（阶段），并为每个阶段中的每一天排训练内容。</p>
      <p class="st-man-h">新建中周期</p>
      ${ol([
        '点击「新建中周期」，填名称（如 M1·准备期）、类型（积累/强化/转化/峰值/恢复）、起止日期。',
        '系统自动按周切分出日卡片条；每个日期卡片上有一个 <b>强度滑块</b>，表示当天动作默认 %1RM，拖动即整体调节，单节课内仍可单独改。',
        '点击某日卡片，下方进入该日的课表编辑。'
      ])}
      <p class="st-man-h">编排课表</p>
      ${ul([
        '「添加动作」：从动作库选动作，设置单位（kg/秒/次等）、%1RM、组数、单组量；系统自动算总负荷。',
        '同一行可添加 2 个以上动作组成<b>超级组/复合组</b>（循环组），组内动作轮流完成。',
        '「清空当日」一键清除该日全部课表；右上角可切换「按周查看」。',
        '课表中的动作使用 %1RM 时，会按每名运动员自己的测定 1RM 自动换算成重量。'
      ])}
      <p class="st-man-h">小周期划分</p>
      ${ul(['在下方「小周期」区把中周期切成 1~2 周的小周期，设置每周的训练类型与强度分布，小周期页（03）会同步显示节奏曲线。'])}
    `)}
    ${manSec('03 小周期 · 周节奏', '周内类型与强度分布的微调', `
      ${ul([
        '展示当前中周期内每个小周期的类型构成（力量/代谢/速度/技战术等）与强度走势。',
        '点击某天可修改当日类型与强度标签，用于执行「高强度日—低强度日」交替的周节奏。',
        '「目标负荷」可给小周期设定 AU 目标，负荷管理页会对比实际完成度。'
      ])}
    `)}
    ${manSec('04 训练课 · 执行与记录', '每日排课、结果登记、sRPE 主观负荷', `
      <p class="st-man-h">这个页面做什么</p>
      <p>按日期查看与安排训练课（一天可有多节），训练结束后记录完成情况。</p>
      ${ul([
        '<b>新建训练课</b>：选日期、课名、课型（力量/耐力/技术…）、时间与时长，并勾选参加的运动员。',
        '<b>课表动作</b>：可从中周期模板带入，也可单独添加；每名运动员的重量按其 1RM 自动换算。',
        '<b>结果登记</b>：训练中记录每组的实际重量/次数与 RIR；未测 1RM 的动作可用「重量 × 次数 × RIR」现场估算并回写运动员的 1RM。',
        '<b>sRPE</b>：课后每名运动员打一个 0~10 的主观强度分，系统乘以时长得到内部负荷（AU），是负荷监控的核心数据。',
        '<b>完成列</b>：展开课次可看到「已完成正式组 / 总正式组」的自动汇总，直观掌握完成度。'
      ])}
    `)}
    ${manSec('05 负荷管理 · 监控看板', 'ACWR、个人/团队负荷曲线', `
      ${ul([
        '<b>ACWR 仪表盘</b>：急性（7 天）与慢性（28 天）负荷比值，>1.5 提示负荷攀升过快、<0.8 提示减量过度。',
        '<b>个人看板</b>：按运动员查看每日/每周 AU、训练分钟数、课次分布；时间范围可自由选择。',
        '<b>团队看板</b>：全队负荷热力与排名，快速发现负荷异常的队员。',
        '数据来源：训练课的 sRPE 与时长、手动添加的负荷记录（也可从外部表格导入）。'
      ])}
    `)}
    ${manSec('06 动作库 · 训练动作管理', '两级分类、自定义动作', `
      ${ul([
        '左侧为一级/二级分类树（如下肢→膝主导），右侧为动作列表；「新建动作」填名称、归类、器械与要点备注。',
        '动作被中周期课表引用后建议不要删除，可改名或移动分类（引用会自动跟随）。',
        '所有 1RM 一律按运动员测定，动作本身不设默认重量。'
      ])}
    `)}
    ${manSec('07 运动员档案 · 建档与体能数据', '建档、体能录入、Excel 自动导入与撤销', `
      <p class="st-man-h">建档与套用</p>
      ${ol([
        '「新建运动员」：姓名必填，其余（位置、性别、生日、照片）选填；新建后自动挂到当前计划。',
        '「套用运动员」在 01 页把已有运动员批量挂到另一个计划；同一运动员可出现在多个计划。'
      ])}
      <p class="st-man-h">录入体能数据</p>
      ${ul([
        '「添加体能数据」：选测试日期后，逐项填写身体成分（身高/体重/体脂）、体能指标（纵跳/冲刺/敏捷…）、FMS、YBT 与各动作 1RM；表单中的项目由「测试项目库」决定（可在 09 设置里增删）。',
        '同一日期重复保存会覆盖当日记录，不同日期形成历史，供 KPI 分析按时期对比。'
      ])}
      <p class="st-man-h">Excel 导入（推荐）</p>
      ${ol([
        '点击「导入体能测试」，直接选择一个或多个 Excel 文件即可——<b>无需选择模板、无需映射</b>。',
        '系统自动识别宽表（一行一人多列成绩）、长表（一行一条记录）、多工作表、任意表头位置与列顺序；姓名自动匹配已有运动员，匹配不到的自动新建。',
        '导入策略是「<b>只补空缺、不覆盖</b>」：同一人同日同项目已有成绩会保留原值，新日期与新项目正常写入；识别出的新测试项目会自动登记进项目库。',
        '导入完成会弹窗汇总（补了多少数据点、新建几人），支持「↩ 撤销本次导入」整批回滚；也可在台账里事后撤销。'
      ])}
    `)}
    ${manSec('08 KPI 分析 · 体能看板', '雷达图、时期对比、团队排名与 KPI 实验室', `
      ${ul([
        '顶部筛选：选运动员、选测试项目（来自你的项目库）、选时期（如"赛季前 vs 赛季中"）。',
        '内置看板：个体雷达与达标情况、FMS 功能筛查、YBT 平衡、1RM 力量档案、团队 Z 值排名。',
        '<b>KPI 实验室</b>：自由勾选项目与分析方法（变化率、Z 分数、趋势回归、相对体重力量等）生成自定义看板，可一键生成文字分析报告。',
        '「＋ 添加测试项目」可直接注册新项目进项目库；数值方向（越大越好/越小越好）由系统按单位自动判定。'
      ])}
    `)}
    ${manSec('09 设置 · 外观与偏好', '明暗模式、背景、强调色、密度、启动页', `
      ${ul([
        '<b>明暗模式</b>：深色适合夜间，浅色适合白天投影/打印场景。',
        '<b>背景模式</b>：纯色 / 渐变 / 星空三种，可再调背景遮罩深浅；星空为清晰星点缓慢漂移，不闪烁。',
        '<b>强调色</b>：荧光绿/海蓝/暖橙/紫/玫红五选一，全站按钮与图表高亮跟随。',
        '<b>界面密度</b>：紧凑模式缩小间距，笔记本小屏一屏显示更多内容。',
        '<b>启动页</b>：固定为周期总表，或每次打开回到上次离开的页面。'
      ])}
    `)}
    ${manSec('数据安全与换机迁移', '备份、计划数据包、清空的正确用法', `
      <p class="st-man-h">「数据与备份」里每个按钮的用途</p>
      ${ul([
        '<b>自动备份（开关）</b>：开启后每次启动应用自动把数据库复制一份到本机备份目录，每天最多一份、自动保留最近 7 份——推荐一直开着。',
        '<b>立即备份到本机</b>：手动在备份目录多存一份，适合大批量导入/大改动前点一下。',
        '<b>导出备份文件</b>：弹出「另存为」由你选择位置，导出<b>全部数据</b>（所有计划+设置）的 JSON 文件，用于换电脑或留档。',
        '<b>打开备份文件夹</b>：查看本机自动备份的文件位置，误删后可从这里挑一份恢复。',
        '<b>恢复备份</b>：选择之前导出的备份文件，<b>整体替换</b>当前全部数据（替换前请先再导出一份当前数据）。',
        '<b>清空全部数据</b>：危险区，需输入「清空」二字解锁，恢复出厂空白状态，操作前务必先导出备份。'
      ])}
      <p class="st-man-h">换电脑 / 分享给其他教练：计划数据包</p>
      ${ol([
        '在「数据与备份 → 计划数据包」点<b>导出当前计划数据包</b>，选择保存位置，得到一个 JSON 文件。里面包含该计划的周期、课表、运动员、体能数据、动作库等<b>全部内容</b>。',
        '在另一台设备安装 Sharp Fit 后，点<b>导入计划数据包</b>选择该文件，确认后计划作为全新计划加入并自动切换过去，<b>不影响设备上已有的数据</b>。',
        '想迁移<b>全部计划</b>时用「导出备份文件 + 恢复备份」整库搬运。'
      ])}
    `)}
    ${manSec('常见问题', '导入识别、数据覆盖、示例数据', `
      ${ul([
        '<b>Excel 导入后去哪里看？</b>——运动员档案（每人时间线）与 KPI 分析（图表对比）；导入完成弹窗也有快捷跳转按钮。',
        '<b>导入会不会覆盖我已有的成绩？</b>——不会。自动导入固定「只补空缺」；手动向导里也可显式选择覆盖策略。',
        '<b>测试项目找不到？</b>——在 09 设置 → 通用 →「管理测试项目库」勾选或新增；Excel 中出现的新项目也会自动登记。',
        '<b>示例数据是什么？</b>——设置 → 通用 →「载入内置示例」可载入一套完整篮球队示例用于练手，退出示例会精确移除示例数据，不影响你自己的数据。',
        '<b>换设备数据会丢吗？</b>——数据只存本机。换机前用「计划数据包」或「导出备份文件」带走在新设备导入即可。'
      ])}
    `)}`;
  }

  // ---------- 关于 ----------
  function renderAbout(body) {
    body.innerHTML = `<div id="stAbout">${card('关于 Sharp Fit', '', `
      <div class="st-about">
        <div class="st-logo"><img src="assets/logo.png" alt="Sharp Fit" class="st-logo-img" /></div>
        <div>
          <h3 style="margin:0">Sharp Fit</h3>
          <p class="hint" style="margin:4px 0 0;font-size:12px">体能教练训练计划管理平台 · 本地离线版</p>
          <p style="margin:10px 0 0;font-size:13px;line-height:1.9">
            版本：<b id="stVer">读取中…</b><br>
            数据存储：仅保存在你的电脑上，不联网、不注册账户、不上传任何服务器。
          </p>
        </div>
      </div>
      <div class="st-actions" style="margin-top:14px">
        <button type="button" class="btn primary" id="stContact">联系开发者</button>
      </div>
      <p class="hint" style="font-size:11.5px;margin:12px 0 0;line-height:1.8">新版本安装包、使用问题与功能建议，均可扫码或添加开发者好友获取；换机时用「计划数据包」或「导出备份文件 / 恢复备份」迁移全部数据。</p>
    `)}</div>`;
    $('#stContact', body).onclick = () => contactDev();
    (async () => {
      if (!window.api || !window.api.appInfo) {
        const v = $('#stVer', body); if (v) v.textContent = 'v1.0（浏览器预览）';
        return;
      }
      const info = await window.api.appInfo();
      state.info = info;
      const v = $('#stVer', body);
      if (v) v.textContent = 'v' + info.version;
    })();
  }

  return { mount, applyAppearance, contactDev };
})();
