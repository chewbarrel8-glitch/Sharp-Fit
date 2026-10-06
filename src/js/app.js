// 应用外壳与路由（Views 定义于 util.js）

(() => {
  const NAV = [
    { id: 'macro', no: '01', label: '周期训练计划', sub: '周期总表 · 手动输入 · 负荷与峰值' },
    { id: 'meso', no: '02', label: '中周期', sub: '大周期管理 · 阶段制定 · 动作安排 · 小周期划分' },
    { id: 'micro', no: '03', label: '小周期', sub: '周节奏管理 · 类型与强度分布' },
    { id: 'session', no: '04', label: '训练课', sub: '每日多节课 · sRPE · RIR 估算 1RM' },
    { id: 'load', no: '05', label: '负荷管理', sub: 'ACWR 仪表盘 · 个人/团队负荷看板' },
    { id: 'exercises', no: '06', label: '动作库', sub: '两级分类 · 动作管理' },
    { id: 'profile', no: '07', label: '运动员档案', sub: '基本信息 · 统一体能数据源 · 1RM' },
    { id: 'kpi', no: '08', label: 'KPI 分析', sub: 'KPI 看板 · 雷达 · FMS · 时期对比 · 团队排名' }
  ];

  function currentRoute() {
    const h = location.hash.replace('#/', '');
    return NAV.find((n) => n.id === h) ? h : 'macro';
  }

  // 侧栏示例按钮：无示例时显示「载入示例」；示例载入后变为「退出示例」
  const demoActive = () => !!(Store.data.settings.demo && Store.data.macros.some((m) => m.id === Store.data.settings.demo.macroId));
  function syncDemoBtn() {
    const b = document.getElementById('loadDemo');
    if (b) b.textContent = demoActive() ? '退出示例' : '载入示例';
  }

  function render() {
    const route = currentRoute();
    const meta = NAV.find((n) => n.id === route);
    $('#pageTitle').textContent = meta.label;
    $('#pageSub').textContent = meta.sub;
    $$('.nav-item').forEach((el) => {
      const active = el.dataset.id === route;
      el.classList.toggle('active', active);
      el.setAttribute('aria-current', active ? 'page' : 'false');
    });
    UI.disposeCharts();
    const view = $('#view');
    view.setAttribute('aria-busy', 'true');
    Views[route].mount(view);
    view.setAttribute('aria-busy', 'false');
    view.classList.remove('view-ready');
    requestAnimationFrame(() => view.classList.add('view-ready'));
    syncDemoBtn();
  }

  function buildNav() {
    $('#nav').innerHTML = NAV.map((n) => `
      <button type="button" class="nav-item" data-id="${n.id}" aria-label="${n.label}">
        <span class="no">${n.no}</span><span class="lbl">${n.label}</span>
      </button>`).join('');
    $$('.nav-item').forEach((el) => { el.onclick = () => { location.hash = '#/' + el.dataset.id; }; });
    window.addEventListener('hashchange', render);
  }

  function bindGlobal() {
    // 下拉菜单切换仅局部刷新数据：保持 #view 滚动位置，避免页面跳回顶部
    document.addEventListener('change', (e) => {
      if (!e.target || e.target.tagName !== 'SELECT') return;
      const view = $('#view');
      if (!view) return;
      const y = view.scrollTop;
      requestAnimationFrame(() => requestAnimationFrame(() => { view.scrollTop = y; }));
    }, true);
  }

  window.addEventListener('DOMContentLoaded', async () => {
    await Store.init();
    buildNav();
    bindGlobal();
    // 左下角「联系开发者」：弹出二维码图片，用于添加开发者好友
    const devBtn = document.getElementById('contactDev');
    if (devBtn) devBtn.onclick = () => {
      UI.modal({
        title: '联系开发者',
        body: `<div style="text-align:center"><img src="assets/developer-qr.jpg" alt="开发者二维码" style="max-width:100%;max-height:60vh;border-radius:10px;box-shadow:0 6px 24px color-mix(in oklch, var(--color-background) 18%, transparent)"><p style="margin:14px 0 0;color:var(--dim);font-size:13px">长按或扫码添加开发者好友</p></div>`,
        footer: `<button class="btn primary" data-x>关闭</button>`
      });
    };
    // 左下角示例按钮：载入内置示例「XX篮球队备战计划」；示例存在时变为「退出示例」
    const demoBtn = document.getElementById('loadDemo');
    if (demoBtn) demoBtn.onclick = () => {
      if (demoActive()) {
        UI.confirm('将退出并清除内置示例「XX篮球队备战计划」（计划、训练课、负荷、测试与示例运动员数据）。<br>你在示例之外自行添加的数据会保留。是否继续？', () => {
          try {
            window.exitDemo();
            UI.toast('已退出示例', 'ok');
            location.hash = '#/macro';
            render();
          } catch (err) {
            UI.toast('退出示例失败：' + err.message, 'err');
          }
        });
        return;
      }
      UI.confirm('将载入内置示例「XX篮球队备战计划」（10 个月、2 个大周期、15 名运动员，含训练课、体能测试与负荷数据）。<br><strong>当前所有数据会被覆盖</strong>，是否继续？', () => {
        try {
          window.seedDemo();
          UI.toast('示例已载入：XX篮球队备战计划', 'ok');
          location.hash = '#/macro';
          render();
        } catch (err) {
          UI.toast('示例载入失败：' + err.message, 'err');
        }
      });
    };
    render();
  });
})();
