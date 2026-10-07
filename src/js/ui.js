// 共享 UI 组件：模态 / Toast / 确认框 / 动作负荷表 / 运动员选择 / 图表工具
const UI = {
  expandedExerciseRows: new WeakMap(),
  // ---------- Toast ----------
  toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    $('#toastWrap').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, 2200);
  },

  // ---------- 模态 ----------
  modal({ title, body, footer, wide, onMount }) {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    const titleId = U.uid('modalTitle');
    const previouslyFocused = document.activeElement;
    ov.innerHTML = `
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <div class="modal-head"><h3 id="${titleId}">${title}</h3><button type="button" class="modal-x" aria-label="关闭对话框">✕</button></div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>`;
    document.body.appendChild(ov);
    const close = () => {
      document.removeEventListener('keydown', onKeydown);
      ov.remove();
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
    };
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    ov.querySelector('.modal-x').onclick = close;
    const xBtn = ov.querySelector('[data-x]');
    if (xBtn) xBtn.onclick = close;
    const onKeydown = (e) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      const focusables = $$('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', ov)
        .filter((el) => !el.hidden && el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeydown);
    const initialFocus = ov.querySelector('[autofocus], .modal-x, button, input, select, textarea');
    if (initialFocus) requestAnimationFrame(() => initialFocus.focus());
    if (onMount) onMount(ov, close);
    return close;
  },

  confirm(msg, onOk) {
    UI.modal({
      title: '确认操作',
      body: `<p style="padding:6px 2px;line-height:1.7">${msg}</p>`,
      footer: `<button class="btn ghost" data-x>取消</button><button class="btn danger" data-ok>确认</button>`,
      onMount(ov, close) {
        ov.querySelector('[data-x]').onclick = close;
        ov.querySelector('[data-ok]').onclick = () => { close(); onOk(); };
      }
    });
  },

  // ---------- 动作负荷表（中周期 / 训练课共用核心组件） ----------
  // rows: [{exId, pct, weight, sets, reps, actual, blkId, setDefs:[{kind:'warm'|'work',pct,weight,reps,dist,distUnit,dur,durUnit}]}]
  // container: 组块容器（训练课 session / 中周期课程 course，持有 blocks:[{id,label,sets}]）；传入即开启复杂训练分组
  // athleteId: 参训运动员上下文——单人且有专属 1RM 时按 %1RM 换算重量；多人或未录入 1RM 时重量手动输入
  // planMode: 计划模式（中周期）——只保留 动作/%1RM/组数/次数，删除重量、负荷、实际完成/RIR
  // hideActualOnly: 仅隐藏实际完成/RIR（训练课计划表），保留重量与单动作负荷
  // pctOnly: 只显示百分比不显示重量（训练课）——同一 %1RM 各运动员对应重量不同，计划重量按每人 1RM 内部换算（供总负荷/吨位用）
  // defaultPct: 计划模式下新增动作/选择动作时 %1RM 的默认值（取当日负荷条百分比），null 表示不预填
  // planAthIds: 团队计划上下文的参训运动员 id 列表——kg 行按每人 1RM×%1RM 汇总团队计划吨位（无人设 1RM 时提示）
  exerciseTable({ rows, onChanged, athleteId, planMode, hideActualOnly, pctOnly, defaultPct, planAthIds, container, setEditor = !planMode }) {
    const wrap = document.createElement('div');
    wrap.className = 'extable';
    planAthIds = Array.isArray(planAthIds) ? planAthIds : [];
    const blocksOn = !!container;
    if (blocksOn) Store.ensureBlocks(container);
    // 展开状态按容器保留，父视图保存并重绘后仍保持展开。
    let expanded = container ? UI.expandedExerciseRows.get(container) : null;
    if (!expanded) {
      expanded = new WeakSet();
      if (container) UI.expandedExerciseRows.set(container, expanded);
    }
    const picked = new Set();
    // 当前运动员上下文的 1RM 来源提示（1RM 一律按运动员测定/录入，无全队默认）
    const rmContext = () => {
      if (!athleteId) return '手动输入';
      const ath = Store.data.athletes.find((a) => a.id === athleteId);
      return ath ? `${U.esc(ath.name)} 的 1RM` : '手动输入';
    };
    // 有效 1RM 值：优先运动员专属
    const effRm = (exId) => { const r = Store.athRm(athleteId, exId); return r ? r.value : null; };

    // 两级联动：先选分类（一级·二级），再从该分类下选动作
    const encCat = (c1, c2) => c1 + '::' + c2;
    const byCat = () => {
      const byC1 = {};
      for (const ex of Store.data.exercises) {
        byC1[ex.cat1] = byC1[ex.cat1] || {};
        byC1[ex.cat1][ex.cat2] = byC1[ex.cat1][ex.cat2] || [];
        byC1[ex.cat1][ex.cat2].push(ex);
      }
      return byC1;
    };
    // 分类下拉：全部分类 + 按一级分组列二级
    const catOptions = () => {
      const byC1 = byCat();
      let html = '<option value="">全部分类</option>';
      for (const c1 of Object.keys(byC1).sort()) {
        html += `<optgroup label="${U.esc(c1)}">`;
        for (const c2 of Object.keys(byC1[c1])) html += `<option value="${encCat(c1, c2)}">${U.esc(c2)}</option>`;
        html += '</optgroup>';
      }
      return html;
    };
    // 动作下拉：传分类则只列该分类动作；不传（全部分类）按「一级 · 二级」分组
    const noRmTag = (ex) => athleteId && Calc.autoUnitOf(ex) === 'kg' && !effRm(ex.id) ? '（未设1RM）' : '';
    const exOptions = (c1, c2) => {
      let html = '<option value="">— 选择动作 —</option>';
      if (!c1) {
        const byC1 = byCat();
        for (const a of Object.keys(byC1).sort()) {
          for (const b of Object.keys(byC1[a])) {
            html += `<optgroup label="${U.esc(a)} · ${U.esc(b)}">`;
            for (const ex of byC1[a][b]) html += `<option value="${ex.id}">${U.esc(ex.name)}${noRmTag(ex)}</option>`;
            html += '</optgroup>';
          }
        }
        return html;
      }
      const list = (byCat()[c1] || {})[c2] || [];
      for (const ex of list) html += `<option value="${ex.id}">${U.esc(ex.name)}${noRmTag(ex)}</option>`;
      return html;
    };

    // 行单位：kg 重量行（计吨位）/ BW 自重行（计次不计吨位）/ m 距离行 / s 时间行 / — 无负荷（计次不计吨位）
    const UNITS = [['kg', 'kg'], ['bw', 'BW'], ['m', 'm'], ['s', 's'], ['none', '—']];
    const unitCell = (r) => `<select class="sel ex-unit-main" data-f="unit" title="本行负荷单位：kg=外部重量（计吨位，可设%1RM）；BW=自重（计次不计吨位）；m=距离；s=时间；—=无负荷（计次不计吨位）">
      ${UNITS.map(([u, lbl]) => `<option value="${u}" ${Calc.rowUnit(r) === u ? 'selected' : ''}>${lbl}</option>`).join('')}
    </select>`;
    // 行内剂量片段：重量/自重/无负荷行录次/组；距离行录单组距离（统一米）；时间行录单组做功（统一秒）
    const doseCell = (r) => {
      const m = Calc.metricOf(r);
      if (m === 'distance') {
        return `<input class="ipt" data-f="dist" type="number" min="0" step="any" value="${r.dist ?? ''}">`;
      }
      if (m === 'duration') {
        return `<input class="ipt" data-f="dur" type="number" min="0" step="any" value="${r.dur ?? ''}">`;
      }
      return `<input class="ipt" data-f="reps" type="number" min="0" value="${r.reps ?? ''}">`;
    };
    // 实际完成（课后）：总次数 / 总距离 m / 总做功 s（距离统一米、做功统一秒）；无负荷行同样计次
    const actualCell = (r) => {
      const m = Calc.metricOf(r);
      const unit = m === 'reps' ? '次' : m === 'distance' ? 'm' : 's';
      return `<input class="ipt" data-f="actual" type="number" min="0" step="any" value="${r.actual ?? ''}" style="width:calc(100% - 30px);min-width:0"><small class="hint" style="width:26px;text-align:right">${unit}</small>`;
    };
    // kg/次行「总负荷」：单位是 kg 就应显示吨位（重量×组×单组次数）
    // 取数优先级：单人上下文 1RM×%1RM → 团队每人 1RM×%1RM 汇总 → 行内手动重量；都无重量时提示「待设1RM」（次数仅作参考，不当作负荷）
    const kgLoadCell = (r) => {
      const dose = Calc.planRowDose(r);
      if (!dose) return '<span class="hint">—</span>';
      if (athleteId) {
        const kg = Calc.rowLoad(r, effRm(r.exId));
        if (kg) return `${U.fmt(Math.round(kg))} <small>kg</small>`;
      }
      if (planAthIds.length) {
        const t = Calc.planRowTeamLoad(r, planAthIds);
        if (t.kg > 0) return `${U.fmt(Math.round(t.kg))} <small>kg</small><br><span class="hint" style="font-size:10px">${t.nW}/${t.n} 人有1RM</span>`;
      }
      const direct = Calc.rowLoad(r);
      if (direct) return `${U.fmt(Math.round(direct))} <small>kg</small>`;
      return `<span class="hint" title="kg 行吨位 = 重量 × 组 × 单组次数；为参训运动员设置 1RM（档案页或课后「更新1RM」）后按 %1RM 自动折算">${U.fmt(dose)} <small>次</small><br><span style="font-size:10px">待设1RM</span></span>`;
    };
    // 本行负荷（课后口径）：kg=吨位；BW=总次数（自重）；—=总次数（无负荷）；距离=总米；时间=总秒（折分钟）
    const loadCell = (r) => {
      const u = Calc.rowUnit(r);
      const m = Calc.metricOf(r);
      const dose = Calc.planRowDose(r);
      if (u === 'none') return dose ? `${U.fmt(dose)} <small>次</small><br><span class="hint" style="font-size:10px">无负荷</span>` : '<span class="hint">无负荷</span>';
      if (m === 'reps' && u === 'bw') return dose ? `${U.fmt(dose)} <small>次</small><br><span class="hint" style="font-size:10px">自重</span>` : '<span class="hint">自重</span>';
      if (m === 'reps') return kgLoadCell(r);
      if (m === 'distance') {
        const band = { sprint: '冲刺', hsr: '高速', moderate: '中速', aerobic: '有氧' }[Calc.rowSpeedBand(r)];
        return `${U.fmt(dose)} <small>m</small>${band ? `<br><span class="hint" style="font-size:10px">${band}带</span>` : ''}`;
      }
      return `${U.fmt(dose)} <small>s</small> · ${U.fmt(Math.round(dose / 6) / 10)} <small>min</small>`;
    };
    // 计划模式「总负荷」：随单位自动计算——kg 行=吨位（单人/团队 1RM 折算）；BW=总次数（自重）；—=总次数（无负荷）；距离行=总米；时间行=总秒
    const planLoadCell = (r) => {
      const u = Calc.rowUnit(r);
      const m = Calc.metricOf(r);
      if (u === 'none') {
        const dose = Calc.planRowDose(r);
        return dose ? `${U.fmt(dose)} <small>次</small><br><span class="hint" style="font-size:10px">无负荷</span>` : '<span class="hint">无负荷</span>';
      }
      if (m === 'reps' && u === 'bw') {
        const dose = Calc.planRowDose(r);
        return dose ? `${U.fmt(dose)} <small>次</small><br><span class="hint" style="font-size:10px">自重</span>` : '<span class="hint">自重</span>';
      }
      if (m === 'reps') return kgLoadCell(r);
      const dose = Calc.planRowDose(r);
      if (!dose) return '<span class="hint">—</span>';
      if (m === 'distance') {
        const band = { sprint: '冲刺', hsr: '高速', moderate: '中速', aerobic: '有氧' }[Calc.rowSpeedBand(r)];
        return `${U.fmt(dose)} <small>m</small>${band ? `<br><span class="hint" style="font-size:10px">${band}带</span>` : ''}`;
      }
      return `${U.fmt(dose)} <small>s</small> · ${U.fmt(Math.round(dose / 6) / 10)} <small>min</small>`;
    };

    // 组块头条：显示块标签 + 共享组数 + 移出块
    const blockHeaderRow = (blk, rowsInBlk) => `
      <tr class="blk-head" data-blk="${blk.id}">
        <td colspan="99" style="padding:6px 10px;background:color-mix(in oklch,var(--color-accent) 6%,transparent);border-left:3px solid var(--volt);font-size:12px;font-weight:600">
          <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
            <span class="blk-label">复杂训练 ${U.esc(blk.label)}</span>
            <span class="hint">${rowsInBlk.length} 个动作 · 共享</span>
            <input class="ipt blk-sets" data-blk-sets="${blk.id}" type="number" min="1" value="${blk.sets}" style="width:56px" title="块内全部动作共享的正式组组数">
            <span class="hint">组正式</span>
            <button class="btn sm ghost blk-del" data-blk-del="${blk.id}" title="解散该复杂训练（动作保留，恢复为独立动作）">解散复杂训练</button>
          </div>
        </td>
      </tr>`;

    // 单个逐组定义的输入片段（计划层）：类型切换 + %1RM/重量 + 单组量
    const setDefCell = (r, d, idx) => {
      const u = Calc.rowUnit(r);
      const m = Calc.metricOf(r);
      const dose = m === 'distance'
        ? `<input class="ipt" data-sd="${idx}" data-sf="dist" type="number" min="0" step="any" value="${d.dist ?? ''}" style="width:70px">`
        : m === 'duration'
          ? `<input class="ipt" data-sd="${idx}" data-sf="dur" type="number" min="0" step="any" value="${d.dur ?? ''}" style="width:70px">`
          : `<input class="ipt" data-sd="${idx}" data-sf="reps" type="number" min="0" value="${d.reps ?? ''}" style="width:50px">`;
      const pctW = u === 'kg'
        ? `<input class="ipt" data-sd="${idx}" data-sf="pct" type="number" min="0" max="200" placeholder="%" value="${d.pct ?? ''}" style="width:56px" title="该组 %1RM">
           ${pctOnly ? '' : `<input class="ipt" data-sd="${idx}" data-sf="weight" type="number" min="0" step="0.5" placeholder="kg" value="${d.weight ?? ''}" style="width:64px" title="该组重量（留空按 %1RM 折算）">`}`
        : '<span class="hint" style="min-width:110px">—</span>';
      return `<span class="sd-kind ${d.kind === 'warm' ? 'warm' : 'work'}" data-sd="${idx}" data-sf="kind" title="点击切换 热身/正式">${d.kind === 'warm' ? '热身' : '正式'}</span>
        ${pctW} ${dose}
        <button class="btn sm ghost sd-del" data-sd="${idx}" data-sf="del" title="删除该组">✕</button>`;
    };

    const render = () => {
      // 量纲切换时清空不匹配字段
      const resetForMetric = (row, m) => {
        if (m === 'reps') { row.dist = null; row.distUnit = 'm'; row.dur = null; row.durUnit = 's'; }
        if (m === 'distance') { row.reps = null; row.dur = null; row.durUnit = 's'; }
        if (m === 'duration') { row.reps = null; row.dist = null; row.distUnit = 'm'; }
        row.actual = null;
      };

      const hideActual = hideActualOnly || pctOnly;
      const headCols = planMode
        ? `<th style="width:21%">动作</th><th style="width:6%">单位</th><th style="width:7%">%1RM</th><th style="width:6%">组数</th><th style="width:18%">单组量</th><th style="width:18%">总负荷</th>`
        : `<th style="width:17%">动作</th><th style="width:5%">单位</th><th style="width:6%">%1RM</th>${pctOnly ? '' : '<th style="width:7%">重量kg</th>'}
           <th style="width:5%">组数</th><th style="width:11%">单组量</th>${hideActual ? '' : '<th style="width:11%">实际完成</th><th style="width:5%">RIR</th>'}
           <th class="r" style="width:12%">本行负荷</th>`;
      const header = `<tr>${blocksOn ? '<th style="width:28px"></th>' : ''}${headCols}<th style="width:40px"></th></tr>`;

      let body = '';
      let lastBlk = null;
      (rows || []).forEach((r, i) => {
        const isKg = Calc.rowUnit(r) === 'kg';
        const ex = Store.exercise(r.exId);
        const hasDefs = Array.isArray(r.setDefs) && r.setDefs.length;
        const isExpanded = expanded.has(r);
        // 块头条
        if (blocksOn && r.blkId && r.blkId !== lastBlk) {
          const blk = (container.blocks || []).find((b) => b.id === r.blkId);
          const inBlk = rows.filter((x) => x.blkId === r.blkId);
          if (blk) body += blockHeaderRow(blk, inBlk);
        }
        lastBlk = r.blkId || null;
        // 行选择框（用于成组）
        const pick = blocksOn ? `<td class="c"><input type="checkbox" class="ex-pick" data-pick="${i}" ${picked.has(i) ? 'checked' : ''} title="勾选后可组成复杂训练"></td>` : '';
        // 块角标 A1/A2
        const blkBadge = (blocksOn && r.blkId) ? `<span class="blk-badge" title="复杂训练 ${(container.blocks||[]).find(b=>b.id===r.blkId)?.label||''} · 第 ${Store.blockPos(rows,r)} 个动作">${(container.blocks||[]).find(b=>b.id===r.blkId)?.label||''}${Store.blockPos(rows,r)}</span>` : '';
        const coreCells = planMode
          ? `<td>${unitCell(r)}</td>
             <td>${isKg ? `<input class="ipt ex-pct" data-f="pct" type="number" min="0" max="200" placeholder="%" value="${r.pct ?? ''}" title="任何以 kg 为单位的动作都可设置 %1RM">` : '<span class="hint">—</span>'}</td>
             <td><input class="ipt" data-f="sets" type="number" min="0" value="${r.sets ?? ''}"></td>
             <td><div class="row" style="gap:4px;flex-wrap:nowrap">${doseCell(r)}</div></td>
             <td class="r num ex-load">${planLoadCell(r)}</td>`
          : `<td>${unitCell(r)}</td>
             <td>${isKg ? `<input class="ipt ex-pct" data-f="pct" type="number" min="0" max="200" placeholder="%" value="${r.pct ?? ''}">` : '<span class="hint">—</span>'}</td>
             ${pctOnly ? '' : `<td>${isKg ? `<input class="ipt ex-w" data-f="weight" type="number" min="0" step="0.5" value="${r.weight ?? ''}">` : '<span class="hint">—</span>'}</td>`}
             <td><input class="ipt" data-f="sets" type="number" min="0" value="${r.sets ?? ''}"></td>
             <td><div class="row" style="gap:4px;flex-wrap:nowrap">${doseCell(r)}</div></td>
             ${hideActual ? '' : `<td><div class="row" style="gap:3px;flex-wrap:nowrap">${actualCell(r)}</div>
             <td>${isKg ? `<input class="ipt" data-f="rir" type="number" min="0" max="10" value="${r.rir ?? ''}">` : '<span class="hint">—</span>'}</td>`}
             <td class="r num ex-load">${loadCell(r)}</td>`;
        body += `
          <tr data-i="${i}" class="${r.blkId ? 'in-blk' : ''}">
            ${pick}
            <td><div class="row" style="gap:4px;align-items:center">${blkBadge}<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px">
              <select class="sel ex-cat-sel" title="第一步：选动作分类（全部分类=列出所有动作）" style="font-size:11px;padding:2px 6px">${catOptions()}</select>
              <select class="sel ex-sel" data-f="exId" style="min-width:0">${exOptions(ex ? ex.cat1 : null, ex ? ex.cat2 : null)}</select>
            </div>
              ${setEditor ? `<button class="btn sm ghost ex-expand" data-ex="${i}" title="逐组展开/收起（热身组+正式组，负荷全部计入）">${isExpanded ? '▾' : '▸'}</button>` : ''}</div></td>
            ${coreCells}
            <td><button class="btn danger sm ex-del" title="删除">✕</button></td>
          </tr>`;
        // 逐组展开子行
        if (isExpanded && setEditor) {
          const defs = hasDefs ? r.setDefs : Store.materializeSetDefs(r);
          const warmN = defs.filter((d) => d.kind === 'warm').length;
          const workN = defs.length - warmN;
          const spanN = (blocksOn ? 1 : 0) + (planMode ? 6 : (hideActual ? 6 + (pctOnly ? 0 : 1) : 8 + (pctOnly ? 0 : 1)));
          body += `
          <tr class="sd-row" data-sd-row="${i}">
            <td colspan="${spanN}" style="padding:6px 10px 8px;background:color-mix(in oklch, var(--color-border-strong) 50%, transparent)">
              <div class="row" style="gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap">
                <span class="hint">逐组设计（热身 ${warmN} 组 · 正式 ${workN} 组 · 全部计入负荷）</span>
                ${setEditor ? `<button class="btn sm ex-add-warm" data-add-warm="${i}">＋ 热身组</button>
                <button class="btn sm primary ex-add-work" data-add-work="${i}">＋ 正式组</button>` : ''}
              </div>
              <div class="sd-list">
                ${defs.map((d, k) => `<div class="sd-item ${d.kind === 'warm' ? 'warm' : 'work'}">${setDefCell(r, d, k)}</div>`).join('')}
              </div>
            </td>
          </tr>`;
        }
      });

      // 表底三族汇总
      const teamT = planAthIds.length ? Calc.rowsTeamTonnage(rows, planAthIds) : null;
      const totalKg = teamT && teamT.kg ? teamT.kg : Calc.rowsTonnage(rows);
      const totalM = Calc.rowsDistance(rows);
      const totalS = Calc.rowsDuration(rows);
      const totalReps = Calc.rowsReps(rows);
      const bands = Calc.rowsDistanceBands(rows);
      const sumBits = [];
      if (totalKg) sumBits.push(`计划吨位 <b>${U.fmt(Math.round(totalKg))}</b><small> kg</small>${teamT && teamT.nW ? ` <span class="hint" style="font-size:10px">${teamT.nW}/${teamT.n}人有1RM</span>` : ''}`);
      if (totalM) sumBits.push(`距离 <b>${U.fmt(totalM)}</b><small> m</small>（冲刺 ${U.fmt(bands.sprint)} · 高速 ${U.fmt(bands.hsr)} · 其他 ${U.fmt(bands.moderate + bands.aerobic)}）`);
      if (totalS) sumBits.push(`做功 <b>${Math.round(totalS)}</b><small> s</small>（${U.fmt(Math.round(totalS / 6) / 10)} min）`);
      if (totalReps && !totalKg) sumBits.push(`次数 <b>${U.fmt(totalReps)}</b><small> 次</small>`);

      const blkBar = blocksOn ? `
        <div class="row" style="gap:8px;margin-bottom:8px;align-items:center;flex-wrap:wrap">
          <button class="btn sm ex-mk-blk" ${picked.size < 2 ? 'disabled' : ''}>⇄ 组成复杂训练（${picked.size}）</button>
          <span class="hint">勾选 2 个及以上动作可组成复杂训练（共享正式组组数，各自动作剂量独立）</span>
        </div>` : '';

      wrap.innerHTML = `
        ${blkBar}
        <div class="tbl-wrap" style="overflow-x:auto">
          <table class="tbl"><thead>${header}</thead><tbody>${body}</tbody></table>
        </div>
        <div class="row" style="justify-content:space-between;margin-top:10px;gap:10px;flex-wrap:wrap">
          <button class="btn sm ghost ex-add">＋ 添加动作</button>
          <div class="tot-line" style="padding:0;gap:14px;flex-wrap:wrap">
            ${planMode ? '' : `<span class="hint">${pctOnly ? '计划重量按每人 1RM 内部换算（此处只显示 %1RM）· 实际重量课后按人填写' : `重量按 ${rmContext()} 计算`}</span>`}
            ${sumBits.length ? sumBits.map((s) => `<span>${s}</span>`).join('') : '<span class="hint">单位可选：kg 重量（计吨位）/ BW 自重（计次）/ m 距离 / s 时间 / — 无负荷（计次不计吨位）；点击 ▸ 可逐组设计热身+正式组</span>'}
          </div>
        </div>`;

      // 回填选中 + 绑定事件（分类 → 动作 两级联动，逐行绑定）
      $$('.tbl tbody tr[data-i]', wrap).forEach((tr) => {
        const i = Number(tr.dataset.i);
        const catSel = tr.querySelector('.ex-cat-sel');
        const sel = tr.querySelector('.ex-sel');
        if (catSel) {
          const ex0 = rows[i].exId ? Store.exercise(rows[i].exId) : null;
          catSel.value = ex0 ? encCat(ex0.cat1, ex0.cat2) : '';
          catSel.onchange = () => {
            const [c1, c2] = catSel.value ? catSel.value.split('::') : [null, null];
            sel.innerHTML = exOptions(c1, c2);
            // 当前动作仍属新分类则保留选中；否则回到占位（动作数据不变，另选后才切换）
            const exCur = rows[i].exId ? Store.exercise(rows[i].exId) : null;
            sel.value = exCur && (!c1 || (exCur.cat1 === c1 && exCur.cat2 === c2)) ? rows[i].exId : '';
          };
        }
        if (sel) {
          sel.value = rows[i].exId || '';
          sel.onchange = () => {
            rows[i].exId = sel.value || null;
            const ex = rows[i].exId ? Store.exercise(rows[i].exId) : null;
            rows[i].unit = Calc.autoUnitOf(ex);
            resetForMetric(rows[i], Calc.metricOf(rows[i]));
            if (planMode && defaultPct != null && Calc.metricOf(rows[i]) === 'reps' && (rows[i].pct == null || rows[i].pct === '')) rows[i].pct = defaultPct;
            if (!planMode && Calc.metricOf(rows[i]) === 'reps') {
              const rm = rows[i].exId ? effRm(rows[i].exId) : null;
              if (rm && rows[i].pct) rows[i].weight = Calc.weightFromPct(rm, rows[i].pct);
            }
            render(); onChanged && onChanged();
          };
        }
      });
      $$('.ex-del', wrap).forEach((btn, i) => { btn.onclick = () => {
        const r = rows[i];
        if (blocksOn && r.blkId) Store.detachBlockRow(container, rows, i);
        rows.splice(i, 1); picked.delete(i); render(); onChanged && onChanged();
      }; });
      wrap.querySelector('.ex-add').onclick = () => {
        rows.push({ rid: U.uid('r'), exId: null, unit: 'kg', pct: planMode && defaultPct != null ? defaultPct : null, weight: null, sets: 3, reps: 8, dist: null, distUnit: 'm', dur: null, durUnit: 's', actual: null, rir: null, blkId: null });
        render(); onChanged && onChanged();
      };
      // 成组
      if (blocksOn) {
        $$('.ex-pick', wrap).forEach((cb) => {
          cb.onchange = () => { const i = Number(cb.dataset.pick); if (cb.checked) picked.add(i); else picked.delete(i); render(); };
        });
        const mkBlk = wrap.querySelector('.ex-mk-blk');
        if (mkBlk) mkBlk.onclick = () => {
          const idxs = Array.from(picked).sort((a, b) => a - b);
          if (idxs.length < 2) return;
          Store.makeBlock(container, rows, idxs);
          picked.clear(); render(); onChanged && onChanged();
          UI.toast(`已组成复杂训练（共享 ${(container.blocks||[]).find(b=>b.id===rows[idxs[0]].blkId)?.sets||3} 组正式）`, 'ok');
        };
        $$('.blk-sets', wrap).forEach((inp) => {
          inp.onchange = () => {
            const blkId = inp.dataset.blkSets; const v = Math.max(1, Number(inp.value) || 1);
            Store.setBlockSets(container, rows, blkId, v);
            render(); onChanged && onChanged();
          };
        });
        $$('.blk-del', wrap).forEach((btn) => {
          btn.onclick = () => {
            const blkId = btn.dataset.blkDel;
            rows.forEach((r) => { if (r.blkId === blkId) r.blkId = null; });
            container.blocks = (container.blocks || []).filter((b) => b.id !== blkId);
            render(); onChanged && onChanged();
          };
        });
      }
      // 展开/收起
      $$('.ex-expand', wrap).forEach((btn) => {
        btn.onclick = () => {
          const i = Number(btn.dataset.ex);
          if (expanded.has(rows[i])) expanded.delete(rows[i]); else expanded.add(rows[i]);
          render();
        };
      });
      // 逐组增删改
      const bindSetDef = (inp) => {
        const key = inp.dataset.sd; const f = inp.dataset.sf;
        const [ri, si] = String(key).split('|').map(Number);
        const r = rows[ri]; if (!r || !r.setDefs) return;
        const d = r.setDefs[si]; if (!d) return;
        if (f === 'kind') { d.kind = d.kind === 'warm' ? 'work' : 'warm'; render(); onChanged && onChanged(); return; }
        if (f === 'del') { r.setDefs.splice(si, 1); render(); onChanged && onChanged(); return; }
        const v = inp.value === '' ? null : Number(inp.value);
        d[f] = (v != null && isNaN(v)) ? null : v;
        // %1RM↔重量 联动（组内，仅 kg 重量行）
        if (!planMode && Calc.rowUnit(r) === 'kg') {
          const rm = r.exId ? effRm(r.exId) : null;
          if (f === 'pct' && rm && v) d.weight = Calc.weightFromPct(rm, v);
          else if (f === 'weight' && rm && v) d.pct = Calc.pctFromWeight(rm, v);
        }
        render(); onChanged && onChanged();
      };
      $$('[data-sd]', wrap).forEach((el) => {
        // data-sd 在 setDefCell 中是单个数字下标；补全为 rowIdx|setIdx
        const sdRow = el.closest('.sd-row');
        if (!sdRow) return;
        const ri = Number(sdRow.dataset.sdRow);
        el.dataset.sd = ri + '|' + el.dataset.sd;
        if (el.tagName === 'BUTTON' || el.classList.contains('sd-kind')) {
          el.onclick = (e) => { e.preventDefault(); bindSetDef(el); };
        } else {
          el.onchange = () => bindSetDef(el);
        }
      });
      // 新增热身/正式组
      const addSet = (ri, kind) => {
        const r = rows[ri]; if (!r) return;
        const defs = Store.materializeSetDefs(r);
        const m = Calc.metricOf(r);
        const tpl = Object.assign({ kind, pct: r.pct ?? null, weight: r.weight ?? null, reps: null, dist: null, distUnit: r.distUnit || 'm', dur: null, durUnit: r.durUnit || 's' },
          m === 'distance' ? { dist: r.dist ?? null } : m === 'duration' ? { dur: r.dur ?? null } : { reps: r.reps ?? null });
        if (kind === 'warm') defs.unshift(tpl);
        else {
          // 正式组插到末尾；同步行 sets
          defs.push(tpl);
          r.sets = defs.filter((d) => d.kind !== 'warm').length;
          if (r.blkId) Store.setBlockSets(container, rows, r.blkId, r.sets);
        }
        render(); onChanged && onChanged();
      };
      $$('.ex-add-warm', wrap).forEach((b) => { b.onclick = () => addSet(Number(b.dataset.addWarm), 'warm'); });
      $$('.ex-add-work', wrap).forEach((b) => { b.onclick = () => addSet(Number(b.dataset.addWork), 'work'); });

      // 行级数字字段
      $$('.tbl tbody tr[data-i]', wrap).forEach((tr) => {
        const i = Number(tr.dataset.i);
        const isKg = Calc.rowUnit(rows[i] || {}) === 'kg';
        const numFields = planMode
          ? (isKg ? ['pct', 'sets', 'reps', 'dist', 'dur'] : ['sets', 'reps', 'dist', 'dur'])
          : (() => {
              const base = (isKg ? ['pct'] : []).concat(pctOnly ? [] : (isKg ? ['weight'] : []), ['sets', 'reps', 'dist', 'dur']);
              return hideActual ? base : base.concat(isKg ? ['actual', 'rir'] : ['actual']);
            })();
        for (const f of numFields) {
          const inp = tr.querySelector(`[data-f="${f}"]`);
          if (!inp) continue;
          inp.onchange = () => {
            let v = inp.value === '' ? null : Number(inp.value);
            if (v != null && isNaN(v)) v = null;
            rows[i][f] = v;
            // 组数变更：同步已展开的正式组定义；块内行同步块
            if (f === 'sets' && v != null) {
              if (rows[i].blkId) Store.setBlockSets(container, rows, rows[i].blkId, v);
              else Store.setRowWorkSets(rows[i], v);
            }
            if (!planMode && isKg && f === 'pct') {
              const rm = rows[i].exId ? effRm(rows[i].exId) : null;
              if (rm && v) rows[i].weight = Calc.weightFromPct(rm, v);
            } else if (!planMode && isKg && f === 'weight') {
              const rm = rows[i].exId ? effRm(rows[i].exId) : null;
              if (rm && v) rows[i].pct = Calc.pctFromWeight(rm, v);
            }
            render(); onChanged && onChanged();
          };
        }
        const unitSel = tr.querySelector('[data-f="unit"]');
        if (unitSel) {
          unitSel.onchange = () => {
            const prev = Calc.metricOf(rows[i]);
            rows[i].unit = unitSel.value;
            const m = Calc.metricOf(rows[i]);
            if (m !== prev) { resetForMetric(rows[i], m); if (Array.isArray(rows[i].setDefs)) rows[i].setDefs = null; }
            // 离开 kg 单位时清掉 %1RM/重量（含逐组定义），避免残留重量被误计
            if (rows[i].unit !== 'kg' && (rows[i].pct != null || rows[i].weight != null)) {
              rows[i].pct = null; rows[i].weight = null;
              if (Array.isArray(rows[i].setDefs)) rows[i].setDefs.forEach((d) => { d.pct = null; d.weight = null; });
            }
            render(); onChanged && onChanged();
          };
        }
      });
    };
    render();
    return wrap;
  },

  // ---------- 运动员多选 ----------
  // 运动员归属训练计划（macroId）：选人只列当前训练计划名单——新建其他计划（即使项目相同）不共享，需重新添加
  athletePicker(selectedIds, onDone, sport) {
    const mac = Store.activeMacro();
    const list = mac ? Store.data.athletes.filter((a) => a.macroId === mac.id)
      : (sport ? Store.data.athletes.filter((a) => a.sport === sport) : Store.data.athletes);
    const scope = mac ? mac.sport : sport;
    const items = list.map((a) => `
      <label class="row" style="gap:8px;padding:7px 8px;border-radius:8px;cursor:pointer" data-id="${a.id}">
        <input type="checkbox" ${selectedIds.includes(a.id) ? 'checked' : ''}>
        ${U.avatar(a, 'width:26px;height:26px;font-size:11px')}
        <span>${U.esc(a.name)}</span><span class="chip">${U.esc(a.sport || '—')}</span>
      </label>`).join('') || `<p class="hint">当前训练计划暂无运动员，请先在「运动员档案」中添加。</p>`;
    UI.modal({
      title: scope ? `选择备赛运动员 · ${U.esc(scope)}` : '选择备赛运动员',
      body: `<div style="display:flex;flex-direction:column;gap:2px">${items}</div>`,
      footer: `<button class="btn primary" data-ok>确定</button>`,
      onMount(ov, close) {
        ov.querySelector('[data-ok]').onclick = () => {
          const ids = $$('input[type=checkbox]:checked', ov).map((c) => c.closest('[data-id]').dataset.id);
          close(); onDone(ids);
        };
      }
    });
  },

  // ---------- 训练目标选择 chips（共享渲染器） ----------
  // 按分类分组渲染全部目标；点击循环 未选 → 主要(p) → 次要(s) → 未选；onChange(sel) 每次切换后回调
  goalCycleChips(container, sel, onChange, opts = {}) {
    const { cat, singlePrimary } = opts;
    const render = () => {
      const cats = cat ? [cat] : Store.allGoalCats().map((c) => c.name);
      const chip = (g) => {
        const lv = sel.primary.includes(g.id) ? 'p' : sel.secondary.includes(g.id) ? 's' : '';
        return `<button type="button" class="gchip ${lv}" data-gid="${g.id}" aria-pressed="${lv ? 'true' : 'false'}" style="--gh:${g.hue != null ? g.hue : 200}">${U.esc(g.name)}${lv ? `<i class="lv">${lv === 'p' ? '主' : '次'}</i>` : ''}</button>`;
      };
      container.innerHTML = cats.map((c) => `
        <div class="gcat"><div class="gcat-t">${U.esc(c)}</div>
          <div class="row" style="gap:6px;flex-wrap:wrap">${Store.data.goals.filter((g) => g.cat === c).map(chip).join('')}</div>
        </div>`).join('');
      $$('.gchip', container).forEach((c) => {
        c.onclick = () => {
          const id = c.dataset.gid;
          if (singlePrimary) {
            // 单主要模式：每类主要目标只能一个，第二个自动降为次要
            if (sel.primary.includes(id)) { sel.primary = sel.primary.filter((x) => x !== id); }
            else if (sel.secondary.includes(id)) { sel.secondary = sel.secondary.filter((x) => x !== id); }
            else { if (sel.primary.length >= 1) sel.secondary.push(id); else sel.primary.push(id); }
          } else {
            // 循环模式：未选 → 主要 → 次要 → 未选
            if (sel.primary.includes(id)) { sel.primary = sel.primary.filter((x) => x !== id); sel.secondary.push(id); }
            else if (sel.secondary.includes(id)) { sel.secondary = sel.secondary.filter((x) => x !== id); }
            else sel.primary.push(id);
          }
          render();
          if (onChange) onChange(sel);
        };
      });
    };
    render();
  },

  // ---------- 训练目标选择器 ----------
  // current: {primary:[goalId], secondary:[goalId]}；onDone(sel) 保存
  // 点击循环选择 + 可添加自定义大分类 + 在任意分类下添加自定义目标
  goalPicker(current, onDone) {
    const sel = { primary: [...((current && current.primary) || [])], secondary: [...((current && current.secondary) || [])] };
    UI.modal({
      title: '训练目标涵盖 · 点击目标循环：未选 → 主要 → 次要 → 未选',
      wide: true,
      body: `<div id="gpBody"></div>
        <div class="row" style="gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line);flex-wrap:wrap">
          <input class="ipt" id="gpCatNew" placeholder="新大分类名称" style="width:200px">
          <button class="btn sm" id="gpCatAdd">＋ 添加大分类</button>
          <span class="hint" style="color:var(--dim)">新增分类自动分配不重复颜色</span>
        </div>
        <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
          <input class="ipt" id="gpNew" placeholder="自定义目标名称" style="width:190px">
          <select class="sel" id="gpCat" style="width:150px"></select>
          <button class="btn sm" id="gpAdd">＋ 添加自定义目标</button>
          <span class="hint" id="gpCount"></span>
        </div>`,
      footer: `<button class="btn ghost" data-x>取消</button><button class="btn primary" data-ok>保存</button>`,
      onMount(ov, close) {
        const body = ov.querySelector('#gpBody');
        const count = ov.querySelector('#gpCount');
        const sync = () => { count.textContent = `已选 · 主要 ${sel.primary.length} 项 · 次要 ${sel.secondary.length} 项`; };
        const catSel = ov.querySelector('#gpCat');
        const refreshCats = () => {
          catSel.innerHTML = Store.allGoalCats().map((c) => `<option value="${U.esc(c.name)}" style="color:hsl(${c.hue} 70% 60%)">${U.esc(c.name)}</option>`).join('');
        };
        UI.goalCycleChips(body, sel, sync);
        refreshCats();
        // 添加大分类：输入名称 → 分配不重复 hue → push goalCats → 刷新 chips + 下拉
        ov.querySelector('#gpCatAdd').onclick = () => {
          const name = ov.querySelector('#gpCatNew').value.trim();
          if (!name) { UI.toast('请填写大分类名称', 'err'); return; }
          if (Store.allGoalCats().some((c) => c.name === name)) { UI.toast('该大分类已存在', 'err'); return; }
          const hue = Store.allocCatHue();
          Store.data.goalCats = Store.data.goalCats || [];
          Store.data.goalCats.push({ id: U.uid('gc'), name, hue });
          Store.save();
          UI.goalCycleChips(body, sel, sync);
          refreshCats();
          ov.querySelector('#gpCatNew').value = '';
          UI.toast(`大分类「${name}」已添加`, 'ok');
        };
        // 添加自定义目标：归入所选分类，hue 用该分类 hue（类内色相统一）
        ov.querySelector('#gpAdd').onclick = () => {
          const name = ov.querySelector('#gpNew').value.trim();
          if (!name) { UI.toast('请填写目标名称', 'err'); return; }
          if (Store.data.goals.some((g) => g.name === name)) { UI.toast('该目标已存在', 'err'); return; }
          const catName = catSel.value;
          const catObj = Store.allGoalCats().find((c) => c.name === catName);
          const hue = catObj ? catObj.hue : 200;
          Store.data.goals.push({ id: U.uid('g'), name, cat: catName, hue });
          Store.save();
          UI.goalCycleChips(body, sel, sync);
          sync();
          UI.toast('自定义目标已添加', 'ok');
        };
        sync();
        ov.querySelector('[data-ok]').onclick = () => { close(); onDone(sel); };
      }
    });
  },

  // ---------- 图表 ----------
  charts: [],
  chart(el) {
    const c = echarts.init(el, null, { renderer: 'canvas' });
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // 全局默认：直角坐标系图表悬停即显示该点（整列）数据；gauge/pie/radar/heatmap 等在各自 setOption 中显式 trigger:'item' 覆盖
    c.setOption({
      animation: !reduced,
      animationDuration: reduced ? 0 : 380,
      animationDurationUpdate: reduced ? 0 : 260,
      animationEasing: 'cubicOut',
      animationEasingUpdate: 'cubicOut',
      // 画布密集数字走等宽（等宽字体天然 tabular）；中文字形自动回退 PingFang SC
      textStyle: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace' },
      aria: { enabled: true, decal: { show: true } },
      tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon)
    });
    UI.charts.push(c);
    return c;
  },
  disposeCharts() { UI.charts.forEach((c) => c.dispose()); UI.charts = []; },
  // 设计系统 token 解析：把 CSS 变量解析为 ECharts/zrender 可用的 rgb()（zrender 不识别 oklch/color-mix）
  cssVar(name) {
    if (!UI.__cvEl) {
      UI.__cvEl = document.createElement('div');
      UI.__cvEl.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
      document.body.appendChild(UI.__cvEl);
    }
    UI.__cvEl.style.color = 'rgb(0,0,0)';
    UI.__cvEl.style.color = name;
    let v = getComputedStyle(UI.__cvEl).color.trim();
    const m = v.match(/oklch\(\s*([\d.]+)(%)?\s+([\d.]+)\s+([\d.]+)/);
    if (m) {
      const L = parseFloat(m[1]) / (m[2] ? 100 : 1), C = parseFloat(m[3]), H = parseFloat(m[4]);
      v = UI._oklchToRgb(L, C, H);
    }
    return v;
  },
  // OKLCH → sRGB（标准转换：OKLab → linear sRGB → gamma）
  _oklchToRgb(L, C, H) {
    const h = H * Math.PI / 180;
    const a = C * Math.cos(h), b = C * Math.sin(h);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
    let r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    let bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    const enc = (x) => {
      x = Math.min(1, Math.max(0, x));
      x = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
      return Math.round(x * 255);
    };
    return `rgb(${enc(r)}, ${enc(g)}, ${enc(bb)})`;
  },
  tint(name, alpha) {
    const rgb = UI.cssVar(name);
    const mm = rgb.match(/\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    return mm ? `rgba(${mm[1]},${mm[2]},${mm[3]},${alpha})` : rgb;
  },
  // 给已解析颜色（rgb()/rgba()/#rrggbb）附加 alpha；入参为 var(--x) 时请用 tint
  alpha(color, a) {
    if (typeof color !== 'string') return color;
    let m = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (m) return `rgba(${m[1]},${m[2]},${m[3]},${a})`;
    m = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (m) return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
    return color;
  },
  get axisCommon() {
    return {
      axisLine: { lineStyle: { color: UI.cssVar('var(--color-border-strong)') } },
      axisLabel: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 },
      splitLine: { lineStyle: { color: UI.tint('var(--color-border)', .52) } }
    };
  },
  get tooltipCommon() {
    return {
      backgroundColor: UI.cssVar('var(--color-surface)'),
      borderColor: UI.cssVar('var(--color-border-strong)'),
      textStyle: { color: UI.cssVar('var(--color-ink)'), fontSize: 12 }
    };
  }
};
window.addEventListener('resize', () => UI.charts.forEach((c) => c.resize()));
