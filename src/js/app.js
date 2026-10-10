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
    { id: 'kpi', no: '08', label: 'KPI 分析', sub: 'KPI 看板 · 雷达 · FMS · 时期对比 · 团队排名' },
    { id: 'settings', no: '09', label: '设置', sub: '外观背景 · 数据备份 · 使用手册 · 项目库 · 关于' }
  ];

  function currentRoute() {
    const h = location.hash.replace('#/', '');
    return NAV.find((n) => n.id === h) ? h : 'macro';
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
    const gear = document.getElementById('navSettings');
    if (gear) gear.classList.toggle('on', route === 'settings');
    UI.disposeCharts();
    const view = $('#view');
    view.setAttribute('aria-busy', 'true');
    Views[route].mount(view);
    view.setAttribute('aria-busy', 'false');
    view.classList.remove('view-ready');
    requestAnimationFrame(() => view.classList.add('view-ready'));
    if (window.I18n) I18n.apply(view);   // 视图内动态文案随当前语言切换
    // 记住最近访问的页面（设置中选「启动页=上次页面」时使用）；仅在变化时落盘，避免频繁写库
    if (Store.data.settings.homeRoute === 'last' && Store.data.settings.lastRoute !== route) {
      Store.data.settings.lastRoute = route;
      Store.save();
    }
  }

  function buildNav() {
    // 设置入口固定在侧栏左下角（齿轮图标 #navSettings），主导航列表不再重复渲染
    $('#nav').innerHTML = NAV.filter((n) => n.id !== 'settings').map((n) => `
      <button type="button" class="nav-item" data-id="${n.id}" aria-label="${n.label}">
        <span class="no">${n.no}</span><span class="lbl">${n.label}</span>
      </button>`).join('');
    $$('.nav-item').forEach((el) => { el.onclick = () => { location.hash = '#/' + el.dataset.id; }; });
    const gear = document.getElementById('navSettings');
    if (gear) {
      gear.onclick = () => { location.hash = '#/settings'; };
      // 齿轮文案还原为原始简体（齿轮在 index.html 中是静态节点，无刷新切换语言时需随导航一起重建原文再翻译）
      gear.title = '设置';
      const gt = gear.querySelector('.side-gear-t');
      if (gt) gt.textContent = '设置';
    }
    window.addEventListener('hashchange', render);
  }

  // 无刷新切换语言：重渲染导航与当前视图（模板输出原始简体），再按新语言整体翻译。
  // 视图重挂载会重建图表 canvas，图表内文字随新语言重绘；不 reload，保留页面状态与滚动位置
  document.addEventListener('i18n:changed', () => {
    buildNav();
    render();
    if (window.I18n) I18n.apply(document.body);
  });

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
    // 语言必须在首次渲染前生效（侧栏/顶栏/视图统一翻译）
    if (window.I18n) I18n.init(Store.data.settings.locale || 'zh-CN');
    // 应用外观设置（背景模式/强调色/密度），需在首次渲染前生效
    Views.settings.applyAppearance();
    buildNav();
    bindGlobal();
    if (window.I18n) I18n.apply(document.body);
    // 启动页：周期总表（默认）或上次离开时的页面
    const s = Store.data.settings;
    if (s.homeRoute === 'last' && s.lastRoute && NAV.some((n) => n.id === s.lastRoute)) {
      if ((location.hash || '').replace('#/', '') !== s.lastRoute) location.hash = '#/' + s.lastRoute;
    }
    render();
  });
})();
