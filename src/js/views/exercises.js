// 动作库页面：两级分类 + 动作管理（1RM 一律按运动员在「运动员档案」中测定/录入，动作库不设默认值）
Views.exercises = (() => {
  const state = { c1: undefined, c2: null, q: '' };   // c1=undefined 仅首次进入自动选中一级分类；null=用户点击收起（可折叠）

  // ---------- 分类管理 ----------
  function catDialog(level, parentCat, cat) {
    UI.modal({
      title: cat ? `编辑${level === 1 ? '一级' : '二级'}分类` : `添加${level === 1 ? '一级' : '二级'}分类`,
      body: `<div class="field"><label>分类名称</label><input class="ipt" id="fName" value="${U.esc(cat ? cat.name : '')}"></div>`,
      footer: `<button class="btn ghost" data-x>取消</button><button class="btn primary" data-ok>保存</button>`,
      onMount(ov, close) {
        ov.querySelector('[data-ok]').onclick = () => {
          const name = ov.querySelector('#fName').value.trim();
          if (!name) { UI.toast('请填写名称', 'err'); return; }
          const dup = level === 1
            ? Store.data.categories1.some((c) => c.name === name && c !== cat)
            : (parentCat.children.some((c) => c.name === name && c !== cat));
          if (dup) { UI.toast('分类名已存在', 'err'); return; }
          if (level === 1) {
            if (cat) cat.name = name;
            else Store.data.categories1.push({ id: U.uid('c1'), name, children: [] });
          } else {
            if (cat) cat.name = name;
            else parentCat.children.push({ id: U.uid('c2'), name });
          }
          Store.save(); close(); mount(); UI.toast('已保存', 'ok');
        };
      }
    });
  }

  function deleteCat(level, parentCat, cat) {
    const exCount = Store.data.exercises.filter((e) => level === 1 ? e.cat1 === cat.name : (e.cat1 === parentCat.name && e.cat2 === cat.name)).length;
    UI.confirm(`删除分类「${U.esc(cat.name)}」${exCount ? `？其下 ${exCount} 个动作将一并删除` : ''}。`, () => {
      if (level === 1) {
        Store.data.exercises = Store.data.exercises.filter((e) => e.cat1 !== cat.name);
        Store.data.categories1 = Store.data.categories1.filter((c) => c.id !== cat.id);
        if (state.c1 === cat.id) { state.c1 = null; state.c2 = null; }
      } else {
        Store.data.exercises = Store.data.exercises.filter((e) => !(e.cat1 === parentCat.name && e.cat2 === cat.name));
        parentCat.children = parentCat.children.filter((c) => c.id !== cat.id);
        if (state.c2 === cat.id) state.c2 = null;
      }
      Store.save(); mount();
    });
  }

  // ---------- 动作管理 ----------
  function exDialog(ex) {
    const cats = Store.data.categories1;
    UI.modal({
      title: ex ? '编辑动作' : '添加动作',
      body: `
        <div class="form-grid">
          <div class="field"><label>一级分类</label><select class="sel" id="fC1">${cats.map((c) => `<option value="${c.id}" ${ex && ex._c1 === c.id ? 'selected' : ''}>${U.esc(c.name)}</option>`).join('')}</select></div>
          <div class="field"><label>二级分类</label><select class="sel" id="fC2"></select></div>
          <div class="field"><label>动作名称 *</label><input class="ipt" id="fName" value="${U.esc(ex ? ex.name : '')}"></div>
          <div class="field"><label>器械</label><input class="ipt" id="fEquip" value="${U.esc(ex ? ex.equip : '')}"></div>
          <div class="field"><label>计量单位 *</label><select class="sel" id="fMetric">
            <option value="reps" ${ex && ex.metric === 'distance' || ex && ex.metric === 'duration' ? '' : 'selected'}>次（组×次数，力量/跳跃/投掷）</option>
            <option value="distance" ${ex && ex.metric === 'distance' ? 'selected' : ''}>距离（组×米，冲刺/间歇跑/跑动）</option>
            <option value="duration" ${ex && ex.metric === 'duration' ? 'selected' : ''}>时间（组×秒，支撑/稳态/拉伸）</option>
          </select></div>
          <div class="field"><label>负荷类型 *</label><select class="sel" id="fLoadType">
            <option value="resistance" ${ex && ex.loadType === 'bodyweight' || ex && ex.loadType === 'cardio' ? '' : 'selected'}>抗阻（带重量/%1RM/RIR）</option>
            <option value="bodyweight" ${ex && ex.loadType === 'bodyweight' ? 'selected' : ''}>自重/徒手</option>
            <option value="cardio" ${ex && ex.loadType === 'cardio' ? 'selected' : ''}>能量系统/位移（跑动/骑行/划船）</option>
          </select></div>
          <div class="field full"><label>技术要点 / 备注</label><input class="ipt" id="fNotes" value="${U.esc(ex ? ex.notes : '')}"></div>
          <div class="field full"><span class="hint">计量单位决定训练课该行录「组×次 / 组×距离 / 组×做功时间」；负荷类型决定是否显示 %1RM、重量与 RIR 列。排课重量与 %1RM 换算按运动员专属 1RM 计算——在「运动员档案」中通过测试或手动录入。</span></div>
        </div>`,
      footer: `<button class="btn ghost" data-x>取消</button><button class="btn primary" data-ok>保存</button>`,
      onMount(ov, close) {
        const c1s = ov.querySelector('#fC1'), c2s = ov.querySelector('#fC2');
        const fillC2 = () => {
          const c1 = cats.find((c) => c.id === c1s.value);
          c2s.innerHTML = c1.children.map((c) => `<option value="${c.id}">${U.esc(c.name)}</option>`).join('');
        };
        fillC2();
        if (ex) {
          const c1 = cats.find((c) => c.name === ex.cat1);
          const c2 = c1 && c1.children.find((c) => c.name === ex.cat2);
          if (c1) { c1s.value = c1.id; fillC2(); if (c2) c2s.value = c2.id; }
        }
        c1s.onchange = fillC2;
        ov.querySelector('[data-ok]').onclick = () => {
          const name = ov.querySelector('#fName').value.trim();
          if (!name) { UI.toast('请填写动作名称', 'err'); return; }
          const c1 = cats.find((c) => c.id === c1s.value), c2 = c1.children.find((c) => c.id === c2s.value);
          const obj = ex || { id: U.uid('ex') };
          Object.assign(obj, {
            name, cat1: c1.name, cat2: c2.name,
            equip: ov.querySelector('#fEquip').value.trim(),
            metric: ov.querySelector('#fMetric').value,
            loadType: ov.querySelector('#fLoadType').value,
            notes: ov.querySelector('#fNotes').value.trim()
          });
          if (!ex) Store.data.exercises.push(obj);
          Store.save(); close(); mount(); UI.toast('已保存', 'ok');
        };
      }
    });
  }

  // ---------- 渲染 ----------
  function renderCats(v) {
    const el = v.querySelector('#exCats');
    el.innerHTML = `
      <div class="card-title"><h3>分类体系</h3><button class="btn sm primary" id="c1Add">＋ 一级</button></div>
      <div style="max-height:56vh;overflow-y:auto">
      ${Store.data.categories1.map((c1) => `
        <div style="margin-bottom:8px">
          <div class="row" style="justify-content:space-between;background:${state.c1 === c1.id ? 'color-mix(in oklch,var(--color-accent) 7%,transparent)' : 'transparent'};border:1px solid ${state.c1 === c1.id ? 'color-mix(in oklch,var(--color-accent) 30%,transparent)' : 'transparent'};border-radius:8px;padding:6px 8px;cursor:pointer" data-c1="${c1.id}">
            <b style="letter-spacing:.5px"><span style="color:var(--color-ink-muted);display:inline-block;width:13px;font-size:10px">${state.c1 === c1.id ? '▾' : '▸'}</span>${U.esc(c1.name)}</b>
            <span class="row" style="gap:4px">
              <button class="mini-btn" data-add2="${c1.id}">＋</button>
              <button class="mini-btn" data-e1="${c1.id}">改</button>
              <button class="mini-btn" data-d1="${c1.id}">删</button>
            </span>
          </div>
          ${state.c1 === c1.id ? `<div style="padding:4px 0 4px 14px;display:flex;flex-direction:column;gap:2px">
            <div class="row" style="justify-content:space-between;padding:4px 8px;border-radius:6px;cursor:pointer;${!state.c2 ? 'color:var(--volt);font-weight:700' : ''}" data-c2-all="${c1.id}"><span class="hint">全部二级分类</span></div>
            ${c1.children.map((c2) => `
              <div class="row" style="justify-content:space-between;padding:4px 8px;border-radius:6px;cursor:pointer;${state.c2 === c2.id ? 'background:color-mix(in oklch,var(--color-accent) 10%,transparent);color:var(--volt)' : ''}" data-c2="${c2.id}">
                <span>${U.esc(c2.name)}</span>
                <span class="row" style="gap:4px;opacity:.8">
                  <button class="mini-btn" data-e2="${c2.id}">改</button>
                  <button class="mini-btn" data-d2="${c2.id}">删</button>
                </span>
              </div>`).join('')}
          </div>` : ''}
        </div>`).join('')}
      </div>`;

    el.querySelector('#c1Add').onclick = () => catDialog(1, null, null);
    $$('[data-c1]', el).forEach((x) => {
      x.onclick = (e) => {
        if (e.target.dataset.add2 || e.target.dataset.e1 || e.target.dataset.d1) return;
        state.c1 = state.c1 === x.dataset.c1 ? null : x.dataset.c1; state.c2 = null; mount();
      };
    });
    $$('[data-c2-all]', el).forEach((x) => { x.onclick = () => { state.c2 = null; mount(); }; });
    $$('[data-c2]', el).forEach((x) => { x.onclick = (e) => { if (e.target.dataset.e2 || e.target.dataset.d2) return; state.c2 = x.dataset.c2; mount(); }; });
    $$('[data-add2]', el).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); catDialog(2, Store.data.categories1.find((c) => c.id === b.dataset.add2), null); }; });
    $$('[data-e1]', el).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); catDialog(1, null, Store.data.categories1.find((c) => c.id === b.dataset.e1)); }; });
    $$('[data-d1]', el).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); deleteCat(1, null, Store.data.categories1.find((c) => c.id === b.dataset.d1)); }; });
    $$('[data-e2]', el).forEach((b) => { b.onclick = (e) => {
      e.stopPropagation();
      for (const c1 of Store.data.categories1) { const c2 = c1.children.find((x) => x.id === b.dataset.e2); if (c2) { catDialog(2, c1, c2); return; } }
    }; });
    $$('[data-d2]', el).forEach((b) => { b.onclick = (e) => {
      e.stopPropagation();
      for (const c1 of Store.data.categories1) { const c2 = c1.children.find((x) => x.id === b.dataset.d2); if (c2) { deleteCat(2, c1, c2); return; } }
    }; });
  }

  function renderList(v) {
    const el = v.querySelector('#exList');
    if (!el) return;   // 视图已切换（防抖回调晚于导航触发）时静默跳过
    const c1 = Store.data.categories1.find((c) => c.id === state.c1);
    const c2 = c1 && state.c2 ? c1.children.find((c) => c.id === state.c2) : null;
    let list = Store.data.exercises;
    if (c1) list = list.filter((e) => e.cat1 === c1.name);
    if (c2) list = list.filter((e) => e.cat2 === c2.name);
    if (state.q) {
      const q = state.q;
      list = list.filter((e) => (e.name || '').includes(q) || (e.equip || '').includes(q) || (e.cat1 || '').includes(q) || (e.cat2 || '').includes(q) || (e.notes || '').includes(q));
    }
    el.innerHTML = `
      <div class="card-title">
        <h3>动作列表 <span class="sub">${c1 ? U.esc(c1.name) : '全部分类'}${c2 ? ' · ' + U.esc(c2.name) : ''} · ${list.length} 个</span></h3>
        <div class="row">
          <input class="ipt" id="exQ" placeholder="搜索名称 / 器械 / 分类…" value="${U.esc(state.q)}" style="width:190px">
          <button class="btn sm primary" id="exAdd">＋ 添加动作</button>
        </div>
      </div>
      ${list.length ? `<div style="overflow-x:auto"><table class="tbl">
        <thead><tr><th>动作</th><th>分类</th><th>器械</th><th class="r">已测 1RM</th><th class="r" style="width:150px">操作</th></tr></thead>
        <tbody>${list.map((e) => `
          <tr>
            <td><b>${U.esc(e.name)}</b>${e.notes ? `<div class="hint">${U.esc(e.notes)}</div>` : ''}</td>
            <td class="hint">${U.esc(e.cat1)} · ${U.esc(e.cat2)}</td>
            <td>${U.esc(e.equip || '—')}</td>
            <td class="r num">${Store.athRmCount(e.id) ? `<b style="color:var(--volt)">${Store.athRmCount(e.id)}</b> <span class="hint">人已测</span>` : '<span class="hint">—</span>'}</td>
            <td class="r">
              <button class="btn sm" data-edit="${e.id}">编辑</button>
              <button class="btn sm danger" data-del="${e.id}">✕</button>
            </td>
          </tr>`).join('')}
        </tbody></table></div>`
      : '<div class="empty"><h4>暂无动作</h4><p>添加动作建立训练动作库；运动员 1RM 在「运动员档案」按人录入，排课时按 %1RM 自动换算重量</p></div>'}`;

    // 搜索：200ms 防抖，仅重渲染列表区，保持焦点与光标位置
    let qTimer = null;
    const qInput = el.querySelector('#exQ');
    qInput.oninput = (e) => {
      state.q = e.target.value.trim();
      const pos = qInput.selectionStart;
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        renderList(v);
        const nq = v.querySelector('#exQ');
        if (!nq) return;   // 防抖回调时页面可能已切换，避免对空引用 focus
        nq.focus();
        try { nq.setSelectionRange(pos, pos); } catch (err) { /* 输入框类型不支持时忽略 */ }
      }, 200);
    };
    el.querySelector('#exAdd').onclick = () => exDialog(null);
    $$('[data-edit]', el).forEach((b) => { b.onclick = () => exDialog(Store.exercise(b.dataset.edit)); });
    $$('[data-del]', el).forEach((b) => { b.onclick = () => {
      const ex = Store.exercise(b.dataset.del);
      UI.confirm(`删除动作「${U.esc(ex.name)}」？历史计划中的引用将显示为空。`, () => {
        Store.data.exercises = Store.data.exercises.filter((e) => e.id !== ex.id);
        Store.save(); mount();
      });
    }; });
  }

  function mount(v) {
    if (v == null) v = $('#view');
    UI.disposeCharts();
    if (state.c1 === undefined && Store.data.categories1.length) state.c1 = Store.data.categories1[0].id;
    v.innerHTML = `
      <div class="grid2" style="grid-template-columns:300px 1fr;align-items:start">
        <div class="card" id="exCats"></div>
        <div class="card" id="exList"></div>
      </div>`;
    renderCats(v);
    renderList(v);
  }

  return { mount };
})();
