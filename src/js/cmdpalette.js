// 命令面板：Cmd/Ctrl+K 弹出 · 实时过滤高亮 · ↑↓ 回车跳转
window.CmdPalette = (() => {
  let open = false;
  let input = null, list = null, wrap = null;
  let items = [], filtered = [], idx = 0;

  function highlight(text, q) {
    if (!q) return text;
    const lower = text.toLowerCase();
    const ql = q.toLowerCase();
    const i = lower.indexOf(ql);
    if (i < 0) return text;
    return text.slice(0, i) + `<mark>${text.slice(i, i + q.length)}</mark>` + text.slice(i + q.length);
  }

  function filter(q) {
    if (!q) return items.map((it) => ({ ...it, __score: 0 }));
    const ql = q.toLowerCase();
    return items
      .map((it) => {
        const label = it.label.toLowerCase();
        const id = it.id.toLowerCase();
        const sub = (it.sub || '').toLowerCase();
        let score = 0;
        if (label === ql) score += 100;
        if (label.startsWith(ql)) score += 80;
        if (label.includes(ql)) score += 50;
        if (id.includes(ql)) score += 30;
        if (sub.includes(ql)) score += 15;
        return { ...it, __score: score };
      })
      .filter((x) => x.__score > 0)
      .sort((a, b) => b.__score - a.__score);
  }

  function renderList() {
    const q = input.value.trim();
    filtered = filter(q);
    if (!filtered.length) {
      list.innerHTML = `<div class="cp-empty">没找到匹配项</div>`;
    } else {
      list.innerHTML = filtered.map((it, i) => `
        <button type="button" class="cp-item ${i === idx ? 'on' : ''}" data-id="${it.id}">
          <span class="cp-no">${it.no}</span>
          <span class="cp-main">
            <strong>${highlight(it.label, q)}</strong>
            <em>${highlight(it.sub || '', q)}</em>
          </span>
        </button>`).join('');
    }
    list.querySelectorAll('.cp-item').forEach((el) => {
      el.onmouseenter = () => { idx = [...list.children].indexOf(el); updateHover(); };
      el.onclick = () => selectId(el.dataset.id);
    });
  }

  function updateHover() {
    [...list.children].forEach((c, i) => c.classList.toggle('on', i === idx));
    const on = list.querySelector('.cp-item.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }

  function openPalette() {
    if (!wrap) init();
    open = true;
    wrap.classList.add('on');
    wrap.setAttribute('aria-hidden', 'false');
    setTimeout(() => { input.focus(); input.select(); }, 60);
    renderList();
  }

  function closePalette() {
    open = false;
    wrap.classList.remove('on');
    wrap.setAttribute('aria-hidden', 'true');
  }

  function selectId(id) {
    closePalette();
    location.hash = '#/' + id;
  }

  function init() {
    wrap = document.getElementById('cmdPalette');
    if (!wrap) return;
    wrap.innerHTML = `
      <div class="cp-mask"></div>
      <div class="cp-box" role="dialog" aria-modal="true" aria-label="命令面板">
        <div class="cp-search">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          <input type="text" id="cpInput" placeholder="搜索页面…（输入编号也可）" autocomplete="off" spellcheck="false"/>
          <kbd class="cp-esc">ESC</kbd>
        </div>
        <div class="cp-list" id="cpList"></div>
        <div class="cp-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 跳转</span>
          <span><kbd>ESC</kbd> 关闭</span>
        </div>
      </div>`;
    input = wrap.querySelector('#cpInput');
    list = wrap.querySelector('#cpList');

    input.addEventListener('input', () => { idx = 0; renderList(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filtered.length) idx = (idx + 1) % filtered.length;
        updateHover();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filtered.length) idx = (idx - 1 + filtered.length) % filtered.length;
        updateHover();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[idx]) selectId(filtered[idx].id);
      } else if (e.key === 'Escape') {
        e.preventDefault(); closePalette();
      }
    });
    wrap.querySelector('.cp-mask').addEventListener('click', closePalette);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closePalette(); });
  }

  function setItems(arr) { items = arr || []; }

  document.addEventListener('keydown', (e) => {
    // Cmd+K / Ctrl+K
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      open ? closePalette() : openPalette();
      return;
    }
    if (open && e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });

  // 暴露快捷入口
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      // 让 Nav.items 成为命令面板数据源
      const sync = () => { if (window.Nav && Nav.items && Nav.items.length) setItems(Nav.items); };
      sync();
      document.addEventListener('i18n:changed', sync);
    }, 100);
  });

  return { open: openPalette, close: closePalette, setItems };
})();
