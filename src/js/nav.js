// 导航层：侧栏滑动高亮 + 底部 dock + 状态徽标
// app.js 调用：Nav.build(NAV) / Nav.setActive(id) / Nav.syncSlider()
window.Nav = (() => {
  const ICONS = {
    macro: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3"/>',
    meso: '<path d="M12 3l9 4.6-9 4.6L3 7.6 12 3z"/><path d="M3 12.2l9 4.6 9-4.6"/><path d="M3 16.6l9 4.6 9-4.6"/>',
    micro: '<rect x="3" y="3.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3.5" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13" width="7.5" height="7.5" rx="1.6"/>',
    session: '<path d="M4 9v6M7 6.5v11M17 6.5v11M20 9v6M7 12h10"/>',
    load: '<path d="M3 12.5h3.2l2.4-6.5 3.4 12.5 2.8-9 1.8 3h4.4"/>',
    exercises: '<path d="M4 5.5A2 2 0 016 3.5h5v17H6a2 2 0 01-2-2v-13z"/><path d="M20 5.5a2 2 0 00-2-2h-5v17h5a2 2 0 002-2v-13z"/>',
    profile: '<circle cx="12" cy="8" r="3.6"/><path d="M5.2 20c0-3.4 3-5.6 6.8-5.6s6.8 2.2 6.8 5.6"/>',
    kpi: '<path d="M12 3l8.4 5.2v7.6L12 21l-8.4-5.2V8.2L12 3z"/><path d="M12 7.6l4 2.5v4.4l-4 2.5-4-2.5v-4.4l4-2.5z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>'
  };
  const ico = (id) => `<svg class="nv-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id] || ''}</svg>`;

  let ITEMS = [], active = 'macro';
  let statusMap = {};   // { id: { dot: bool, count: number } }
  let onNavigate = null;

  function syncSlider(id) {
    const slider = document.getElementById('navSlider');
    if (!slider) return;
    const target = document.querySelector(`.nav-item[data-id="${id}"]`);
    if (!target) { slider.style.opacity = 0; return; }
    const nav = document.getElementById('nav');
    if (!nav) return;
    const navRect = nav.getBoundingClientRect();
    const tRect = target.getBoundingClientRect();
    slider.style.opacity = 1;
    slider.style.top = (tRect.top - navRect.top) + 'px';
    slider.style.height = tRect.height + 'px';
    // width 留一点 padding 让滑块不贴满
    slider.style.width = 'calc(100% - 16px)';
  }

  function buildDock() {
    const dock = document.getElementById('dock');
    if (!dock) return;
    dock.innerHTML = ITEMS.map((it) => `
      <button type="button" class="dock-item ${it.id === active ? 'active' : ''}" data-id="${it.id}" aria-label="${it.label}">
        <span class="dock-ico">${ico(it.id)}</span>
        <span class="dock-label">${it.label}</span>
        <i class="dock-dot" aria-hidden="true"></i>
      </button>`).join('');
    dock.querySelectorAll('.dock-item').forEach((el) => {
      el.onclick = () => { if (onNavigate) onNavigate(el.dataset.id); };
    });
  }

  function syncDock(id) {
    const dock = document.getElementById('dock');
    if (!dock) return;
    dock.querySelectorAll('.dock-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.id === id);
    });
  }

  function syncBadges(items) {
    items.forEach((it) => {
      const el = document.querySelector(`.nav-item[data-id="${it.id}"]`);
      if (!el) return;
      const st = statusMap[it.id];
      let right = el.querySelector('.nav-right');
      if (!right) {
        right = document.createElement('span');
        right.className = 'nav-right';
        el.appendChild(right);
      }
      right.innerHTML = '';
      if (st && st.dot) {
        const dot = document.createElement('i');
        dot.className = 'nav-dot';
        right.appendChild(dot);
      }
      if (st && st.count > 0) {
        const b = document.createElement('span');
        b.className = 'nav-badge';
        b.textContent = st.count > 99 ? '99+' : st.count;
        right.appendChild(b);
      }
    });
  }

  function setActive(id) {
    active = id;
    syncSlider(id);
    syncDock(id);
    // 导航到的项清除徽标
    if (statusMap[id]) {
      statusMap[id].dot = false;
      statusMap[id].count = 0;
      syncBadges(ITEMS);
    }
  }

  function setStatus(map) {
    statusMap = { ...statusMap, ...map };
    syncBadges(ITEMS);
  }

  function build(items, opts) {
    if (Array.isArray(items) && items.length) ITEMS = items;
    if (opts && typeof opts.onNavigate === 'function') onNavigate = opts.onNavigate;
    buildDock();
    syncBadges(ITEMS);
    // 首次渲染后等一帧再算滑块（布局刚完成）
    requestAnimationFrame(() => syncSlider(active));
  }

  return {
    build,
    setActive,
    syncSlider,
    setStatus,
    get items() { return ITEMS; },
    get active() { return active; }
  };
})();
