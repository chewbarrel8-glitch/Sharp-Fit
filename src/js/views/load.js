// 负荷管理页面：ACWR 仪表盘 · 个人/团队负荷看板
// 运动员归属训练计划：名单/看板只统计当前计划运动员
Views.load = (() => {
  const state = { athleteId: null, mode: 'personal', weekView: 'strain', fltMesoId: 'all', fltMicroId: 'all', pieAthId: 'all', ovLevel: 'session', ovDate: U.today(), ovSesId: null, loadTab: 'detail', dateFrom: U.addDays(U.today(), -41), dateTo: U.today() };
  // 单一时期导航 → 对应分析内容
  const TAB_OF_LEVEL = { session: 'detail', day: 'detail', micro: 'micro', meso: 'micro' };
  let weekChart = null;   // 周负荷分析图表实例（切换视图时先销毁）

  function planAths() {
    const mac = Store.activeMacro();
    return mac ? Store.data.athletes.filter((a) => a.macroId === mac.id) : [];
  }

  function planCycles() {
    const mac = Store.activeMacro();
    const mesos = mac ? Store.data.mesos.filter((m) => m.macroId === mac.id) : [];
    const mesoIds = new Set(mesos.map((m) => m.id));
    const micros = Store.data.micros.filter((mi) => mesoIds.has(mi.mesoId));
    if (state.fltMesoId !== 'all' && !mesoIds.has(state.fltMesoId)) {
      state.fltMesoId = 'all';
      state.fltMicroId = 'all';
    }
    const eligibleMicros = state.fltMesoId === 'all' ? micros : micros.filter((mi) => mi.mesoId === state.fltMesoId);
    if (state.fltMicroId !== 'all' && !eligibleMicros.some((mi) => mi.id === state.fltMicroId)) state.fltMicroId = 'all';
    if (state.pieAthId !== 'all' && !planAths().some((a) => a.id === state.pieAthId)) state.pieAthId = 'all';
    return { mesos, micros, eligibleMicros };
  }

  function entriesOf(athId) {
    return Store.data.loadEntries
      .filter((e) => e.athleteId === athId)
      .map((e) => {
        const load = e.load != null ? Number(e.load) : Number(e.rpe) * Number(e.duration);
        return Object.assign({}, e, { load: Number.isFinite(load) ? load : 0 });
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // 团队汇总：当前计划运动员合并日负荷
  function teamEntries() {
    const ids = new Set(planAths().map((a) => a.id));
    const map = {};
    for (const e of Store.data.loadEntries) {
      if (!ids.has(e.athleteId)) continue;
      const value = e.load != null ? Number(e.load) : Number(e.rpe) * Number(e.duration);
      const load = Number.isFinite(value) ? value : 0;
      map[e.date] = (map[e.date] || 0) + load;
    }
    return Object.keys(map).map((date) => ({ date, load: map[date] })).sort((a, b) => a.date.localeCompare(b.date));
  }

  // 指标问号提示：悬停显示原生提示，点击弹出指标说明与计算方法弹窗（ref 为文献引用，拼接在末尾）
  const qTip = (t, ref) => { const full = ref ? `${t}　—　文献来源：${ref}` : t; return `<button type="button" class="qmark" aria-label="查看指标说明" title="${U.esc(full)}" data-tip="${U.esc(full)}">?</button>`; };

  // 文献引用来源（按指标拼接进各问号说明；格式：作者. 简题. 期刊, 年; 卷(期): 页）
  const REFS = {
    foster01: 'Foster C, et al. A new approach to monitoring exercise training. J Strength Cond Res, 2001; 15(1):109-115.（sRPE×时长 法）',
    banister91: 'Banister EW. Modeling elite athletic performance. In: Physiological Testing of the High-Performance Athlete, 2nd ed. Human Kinetics, 1991.（冲击-反应模型）',
    coggan: 'Allen H, Coggan A. Training and Racing with a Power Meter. 3rd ed. VeloPress, 2019.（Performance Management Chart；CTL/ATL/TSB 实务定义）',
    skiba13: 'Clarke DC, Skiba PF. Rationale and resources for teaching the mathematical modeling of athletic training. Adv Physiol Educ, 2013; 37(2):134-142.',
    mujika96: 'Mujika I, et al. Modeling the effects of training in professional road cyclists. Int J Sports Med, 1996; 17(7):506-510.',
    hulin14: 'Hulin BT, Gabbett TJ, et al. Soft-tissue injury risk in elite rugby league using the acute:chronic workload ratio. Br J Sports Med, 2014; 48(12):923-927.',
    gabbett16: 'Gabbett TJ. The training—injury prevention paradox: should athletes be training smarter and harder? Br J Sports Med, 2016; 50(5):273-280.',
    impellizzeri20: 'Impellizzeri FM, Tenan MS, Kempton T, Novak A, Coutts AJ. Acute:Chronic Workload Ratio: Conceptual Issues and Fundamental Pitfalls. Int J Sports Physiol Perform, 2020; 15(6):907-913.',
    foster98: 'Foster C, et al. Monitoring training in athletes with reference to overtraining syndrome. Med Sci Sports Exerc, 1998; 30(7):1164-1168.（单调性/应变法）',
    impellizzeri19: 'Impellizzeri FM, Marcora SM, Coutts AJ. Internal and external training load: 15 years on. Int J Sports Physiol Perform, 2019; 14(2):270-273.',
    halson14: 'Halson SL. Monitoring training load to understand fatigue in athletes. Sports Med, 2014; 44(Suppl 2):S139-147.'
  };
  const refTxt = (...keys) => keys.map((k) => REFS[k]).join('；');

  function acwrInfo(v) {
    if (v == null || !Number.isFinite(Number(v))) return { label: '基线积累中', cls: '', desc: '数据不足', color: UI.cssVar('var(--color-ink-muted)') };
    if (v < 0.8) return { label: v.toFixed(2), cls: 'info', desc: '近期负荷较低', color: UI.cssVar('var(--color-info)') };
    if (v <= 1.3) return { label: v.toFixed(2), cls: 'ok', desc: '变化平稳', color: UI.cssVar('var(--color-success)') };
    if (v <= 1.5) return { label: v.toFixed(2), cls: 'warn', desc: '上升，建议复核', color: UI.cssVar('var(--color-warning)') };
    return { label: v.toFixed(2), cls: 'bad', desc: '变化明显，建议复核', color: UI.cssVar('var(--color-danger)') };
  }

  // ACWR 区间图例（与 gauge 色带分界一致：0.8 / 1.3 / 1.5）
  const ACWR_LEGEND = [
    [UI.cssVar('var(--color-info)'), '&lt; 0.8 偏低'],
    [UI.cssVar('var(--color-success)'), '0.8–1.3 最适'],
    [UI.cssVar('var(--color-warning)'), '1.3–1.5 偏高'],
    [UI.cssVar('var(--color-danger)'), '&gt; 1.5 风险']
  ].map(([c, t]) => `<span class="row" style="gap:6px;align-items:center"><i style="width:10px;height:10px;border-radius:3px;background:${c};display:inline-block"></i><span class="hint" style="font-size:11px">${t}</span></span>`).join('');

  // 仪表盘动态量程：值超出基准量程时按固定步长向外扩展，色带按绝对分界重算比例
  // → 指针永远落在刻度内（不再穿出色带），中心数字始终显示真值；步长固定保证跨人/跨时可比较
  function tsbRange(tsb) {
    return { min: Math.min(-50, Math.floor(tsb / 25) * 25), max: Math.max(25, Math.ceil(tsb / 25) * 25) };
  }
  function acwrRange(acwr) {
    return { min: 0, max: Math.max(2.5, acwr != null ? Math.ceil(acwr * 2) / 2 : 2.5) };
  }
  // bands: [[绝对分界值, 该段颜色]] 升序；映射到 [min,max] 的 0..1 比例并裁剪
  function gaugeStops(min, max, bands) {
    const span = max - min;
    return bands.map(([b, c]) => [Math.min(1, Math.max(0, (b - min) / span)), c]);
  }
  // TSB 色带（基于 Banister 模型与训练监控文献共识）：
  //   < -30  红：深度疲劳，过度训练/损伤风险高
  //   -30~-10 橙：积累疲劳，正常训练块中常见的建设性疲劳
  //   -10~+5  黄：训练平衡，中性区间
  //   +5~+25  绿：状态新鲜，适合比赛/高强度输出
  //   > +25   蓝：过于新鲜，持续可能掉能力
  // 文献来源：Banister EW (1991) Modeling elite athletic performance；Clarke DC & Skiba PF (2013) Adv Physiol Educ 37(2):134-142；
  //           Mujika I et al. (1996) Int J Sports Med 17(7):506-510；区间参考 TrainingPeaks 绩效管理图（Coggan 改良 Banister 模型）
  const TSB_BANDS = (max) => [[-30, UI.cssVar('var(--color-danger)')], [-10, UI.cssVar('var(--color-warning)')], [5, UI.cssVar('var(--color-warning)')], [25, UI.cssVar('var(--color-success)')], [max, UI.cssVar('var(--color-info)')]];
  // TSB 颜色与状态描述（与色带分界一致）
  function tsbState(tsb) {
    if (tsb == null || !Number.isFinite(Number(tsb))) return { color: UI.cssVar('var(--color-ink-muted)'), desc: '数据不足', cls: '' };
    if (tsb > 25) return { color: UI.cssVar('var(--color-info)'), desc: '过于新鲜', cls: 'info' };
    if (tsb > 5) return { color: UI.cssVar('var(--color-success)'), desc: '状态新鲜', cls: 'ok' };
    if (tsb > -10) return { color: UI.cssVar('var(--color-warning)'), desc: '训练平衡', cls: 'warn' };
    if (tsb > -30) return { color: UI.cssVar('var(--color-warning)'), desc: '积累疲劳', cls: 'warn' };
    return { color: UI.cssVar('var(--color-danger)'), desc: '深度疲劳', cls: 'bad' };
  }
  // ACWR 色带绝对分界：<0.8 蓝、0.8~1.3 绿、1.3~1.5 黄、>1.5 红
  // 文献来源：Hulin BT, Gabbett TJ et al. (2014) Br J Sports Med 48(12):923-927；Gabbett TJ (2016) Br J Sports Med 50(5):273-280
  const ACWR_BANDS = (max) => [[0.8, UI.cssVar('var(--color-info)')], [1.3, UI.cssVar('var(--color-success)')], [1.5, UI.cssVar('var(--color-warning)')], [max, UI.cssVar('var(--color-danger)')]];

  function renderHead(v) {
    const el = v.querySelector('#loadHead');
    const aths = planAths();
    el.innerHTML = `
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div class="row" style="gap:16px;flex-wrap:wrap">
          <div class="field" style="margin:0"><label>视图模式</label>
            <div class="row" style="gap:0;border-radius:8px;overflow:hidden;border:1px solid var(--border)">
              <button class="btn sm ${state.mode === 'personal' ? 'primary' : 'ghost'}" id="modePersonal" style="border-radius:0">个人负荷</button>
              <button class="btn sm ${state.mode === 'team' ? 'primary' : 'ghost'}" id="modeTeam" style="border-radius:0">团队负荷</button>
            </div>
          </div>
          ${state.mode === 'personal' ? `<div class="field" style="margin:0"><label>运动员</label>
            <select class="sel" id="athSel" style="min-width:170px">
              ${aths.map((a) => `<option value="${a.id}" ${state.athleteId === a.id ? 'selected' : ''}>${U.esc(a.name)}${a.sport ? ' · ' + U.esc(a.sport) : ''}</option>`).join('') || '<option value="">— 暂无运动员 —</option>'}
            </select>
          </div>` : ''}
        </div>
        ${state.mode === 'team' ? `<div class="row" style="gap:8px;align-self:flex-end"><span class="hint" style="align-self:center">汇总全队 ${aths.length} 名运动员的日负荷数据</span></div>` : ''}
      </div>`;
    if (state.mode === 'personal') {
      el.querySelector('#athSel').onchange = (e) => { state.athleteId = e.target.value; mount(); };
    }
    el.querySelector('#modePersonal').onclick = () => { state.mode = 'personal'; mount(); };
    el.querySelector('#modeTeam').onclick = () => { state.mode = 'team'; mount(); };
  }

  // ---------- 负荷总览卡：本节课 / 日 / 小周期 / 中周期 四级 ----------
  // 个人模式按 state.athleteId；团队模式全队汇总
  function renderOverview(v) {
    const el = v.querySelector('#loadOverview');
    if (!el) return;
    const team = state.mode === 'team';
    const aid = team ? null : state.athleteId;
    const { mesos, eligibleMicros } = planCycles();
    const today = U.today();
    if (!state.ovDate) state.ovDate = today;
    let rangeFrom = state.ovDate, rangeTo = state.ovDate;

    // 默认选择：个人仅列本人参与且已完课的课程；团队仅列已完课课程，避免把计划剂量展示为完成剂量。
    const teamIds = new Set(planAths().map((a) => a.id));
    const daySes = (Store.data.sessions || []).filter((s) =>
      s.date === state.ovDate && Store.hasCompletedLoad(s) && (team
        ? (s.athletes || []).some((id) => teamIds.has(id))
        : (s.athletes || []).includes(aid)));
    if (state.ovLevel === 'session') {
      const valid = daySes.find((s) => s.id === state.ovSesId);
      if (!valid) {
        const first = daySes[0];
        if (first) state.ovSesId = first.id;
        else { state.ovLevel = 'day'; state.ovSesId = null; }
      }
    }

    // 选择器
    const sesOpts = daySes.map((s) => `<option value="${s.id}" ${state.ovSesId === s.id ? 'selected' : ''}>${U.esc(s.name || '训练课')}${s.sStatus === 'done' ? ' ✓' : ''}</option>`).join('');
    // 小/中周期默认选中覆盖当日（或最近）的一个
    if (state.fltMicroId === 'all') {
      const mc = eligibleMicros.find((m) => U.between(state.ovDate, m.startDate, m.endDate)) || eligibleMicros[0];
      if (state.ovLevel === 'micro' && mc) state.fltMicroId = mc.id;
    }
    if (state.fltMesoId === 'all' && state.ovLevel === 'meso') {
      const me = mesos.find((m) => U.between(state.ovDate, m.startDate, m.endDate)) || mesos[0];
      if (me) state.fltMesoId = me.id;
    }
    const selectedMicros = state.fltMesoId === 'all' ? eligibleMicros : eligibleMicros.filter((mi) => mi.mesoId === state.fltMesoId);
    const micOpts = selectedMicros.map((m) => `<option value="${m.id}" ${state.fltMicroId === m.id ? 'selected' : ''}>${U.esc(m.name)}</option>`).join('');
    const mesOpts = mesos.map((m) => `<option value="${m.id}" ${state.fltMesoId === m.id ? 'selected' : ''}>${U.esc(m.name)}</option>`).join('');

    // 计算所选范围负荷
    let label = '', au = 0, minutes = 0, days = 0, sessions = 0, ext = { kg: 0, m: 0, s: 0, reps: 0 };
    if (state.ovLevel === 'session') {
      const ses = daySes.find((s) => s.id === state.ovSesId);
      if (ses) {
        label = `本节课 · ${U.esc(ses.name)} · ${U.md(ses.date)}`;
        const si = Store.sessionInternal(ses, aid);
        au = si.au; minutes = si.minutes; sessions = 1; days = 1;
        ext = Store.sessionActualDose(ses, aid);
      } else label = '本节课（当日无训练课）';
    } else if (state.ovLevel === 'day') {
      label = `日负荷 · ${U.cn(state.ovDate)}`;
      rangeFrom = rangeTo = state.ovDate;
      const ri = Store.rangeInternalLoad(state.ovDate, state.ovDate, aid);
      au = ri.au; minutes = ri.minutes; days = ri.days; sessions = ri.sessions;
      ext = Store.rangeActualDose(state.ovDate, state.ovDate, aid);
    } else if (state.ovLevel === 'micro') {
      const mi = selectedMicros.find((m) => m.id === state.fltMicroId);
      if (mi) {
        rangeFrom = mi.startDate; rangeTo = mi.endDate;
        label = `小周期 · ${U.esc(mi.name)} · ${U.md(mi.startDate)}–${U.md(mi.endDate)}`;
        const ri = Store.rangeInternalLoad(mi.startDate, mi.endDate, aid);
        au = ri.au; minutes = ri.minutes; days = ri.days; sessions = ri.sessions;
        ext = Store.rangeActualDose(mi.startDate, mi.endDate, aid);
      } else label = '小周期（未选择）';
    } else if (state.ovLevel === 'meso') {
      const me = mesos.find((m) => m.id === state.fltMesoId);
      if (me) {
        rangeFrom = me.startDate; rangeTo = me.endDate;
        label = `中周期 · ${U.esc(me.name)} · ${U.md(me.startDate)}–${U.md(me.endDate)}`;
        const ri = Store.rangeInternalLoad(me.startDate, me.endDate, aid);
        au = ri.au; minutes = ri.minutes; days = ri.days; sessions = ri.sessions;
        ext = Store.rangeActualDose(me.startDate, me.endDate, aid);
      } else label = '中周期（未选择）';
    }

    // 团队模式：每人明细表（任意级：课=该课；日=当日全部课；小/中周期=范围内全部课）
    let teamRows = '';
    if (team) {
      const aths = planAths();
      let rangeSes = [];
      if (state.ovLevel === 'session') rangeSes = daySes.filter((s) => s.id === state.ovSesId);
      else if (state.ovLevel === 'day') rangeSes = daySes;
      else if (state.ovLevel === 'micro') { const mi = selectedMicros.find((m) => m.id === state.fltMicroId); rangeSes = mi ? (Store.data.sessions || []).filter((s) => U.between(s.date, mi.startDate, mi.endDate) && Store.hasCompletedLoad(s) && (s.athletes || []).some((id) => teamIds.has(id))) : []; }
      else if (state.ovLevel === 'meso') { const me = mesos.find((m) => m.id === state.fltMesoId); rangeSes = me ? (Store.data.sessions || []).filter((s) => U.between(s.date, me.startDate, me.endDate) && Store.hasCompletedLoad(s) && (s.athletes || []).some((id) => teamIds.has(id))) : []; }
      else rangeSes = (Store.data.sessions || []).filter((s) => U.between(s.date, rangeFrom, rangeTo) && Store.hasCompletedLoad(s) && (s.athletes || []).some((id) => teamIds.has(id)));
      teamRows = aths.map((a) => {
        let aAu = 0, aMin = 0, aKg = 0, aReps = 0, aM = 0, aS = 0;
        rangeSes.forEach((s) => {
          if ((s.athletes || []).includes(a.id)) {
            const si = Store.sessionInternal(s, a.id); aAu += si.au; aMin += si.minutes;
            const d = Store.sessionActualDose(s, a.id); aKg += d.kg; aReps += d.reps; aM += d.m; aS += d.s;
          }
        });
        return `<tr><td>${U.esc(a.name)}</td><td class="r num">${U.fmt(aAu)}</td><td class="r num">${aMin}</td><td class="r num">${aKg ? U.fmt(Math.round(aKg)) : '—'}</td><td class="r num">${aReps ? U.fmt(aReps) : '—'}</td><td class="r num">${aM ? U.fmt(aM) : '—'}</td><td class="r num">${aS ? U.fmt(Math.round(aS)) : '—'}</td></tr>`;
      }).join('');
    }

    // 管理快捷入口：跳到训练课页对应日期（录入/完课/复查）
    let goDate = state.ovDate;
    if (state.ovLevel === 'session') goDate = (daySes.find((s) => s.id === state.ovSesId) || {}).date || state.ovDate;
    else if (state.ovLevel === 'micro') { const mi = selectedMicros.find((m) => m.id === state.fltMicroId); if (mi) goDate = mi.startDate; }
    else if (state.ovLevel === 'meso') { const me = mesos.find((m) => m.id === state.fltMesoId); if (me) goDate = me.startDate; }
    const goBtn = `<button class="btn sm" id="ovGo" title="前往训练课页：排课、录入完成情况、完课保存负荷">${state.ovLevel === 'session' ? '前往该训练课录入/完课 →' : '前往训练课页 →'}</button>`;

    el.innerHTML = `
      <div class="card-title"><h3 style="font-size:14px">负荷总览</h3><span class="sub">${U.esc(label)}</span></div>
      <div class="row" style="gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
        <div class="load-period-switch" role="group" aria-label="负荷时期">
          ${[['session', '本节课'], ['day', '日'], ['micro', '小周期'], ['meso', '中周期']].map(([lv, t]) =>
            `<button class="btn sm ${state.ovLevel === lv ? 'primary' : 'ghost'}" data-ovl="${lv}" aria-pressed="${state.ovLevel === lv}">${t}</button>`).join('')}
        </div>
        ${state.ovLevel === 'session' ? `<select class="sel" id="ovSes" style="min-width:180px">${sesOpts || '<option value="">当日无课</option>'}</select>` : ''}
          ${state.ovLevel === 'day' ? `<input class="ipt" type="date" id="ovDate" value="${state.ovDate}">` : ''}
        ${state.ovLevel === 'micro' ? `<select class="sel" id="ovMicro" style="min-width:180px">${micOpts}</select>` : ''}
        ${state.ovLevel === 'meso' ? `<select class="sel" id="ovMeso" style="min-width:180px">${mesOpts}</select>` : ''}
        <span style="margin-left:auto">${goBtn}</span>
      </div>
      <div class="ov-kpis">
        <div class="ov-kpi"><div class="k">内部负荷 AU</div><div class="v">${U.fmt(au)}</div></div>
        <div class="ov-kpi"><div class="k">训练时长</div><div class="v">${U.fmt(minutes)}<small> min</small></div></div>
        <div class="ov-kpi"><div class="k">训练天数</div><div class="v">${days}<small> 天</small></div></div>
        <div class="ov-kpi"><div class="k">课次</div><div class="v">${sessions}<small> 节</small></div></div>
        <div class="ov-kpi"><div class="k">吨位</div><div class="v">${ext.kg ? U.fmt(Math.round(ext.kg)) : '—'}<small> kg</small></div></div>
        <div class="ov-kpi"><div class="k">次数</div><div class="v">${ext.reps ? U.fmt(ext.reps) : '—'}<small> 次</small></div></div>
        <div class="ov-kpi"><div class="k">距离</div><div class="v">${ext.m ? U.fmt(ext.m) : '—'}<small> m</small></div></div>
        <div class="ov-kpi"><div class="k">做功</div><div class="v">${ext.s ? U.fmt(Math.round(ext.s)) : '—'}<small> s</small></div></div>
      </div>
      ${teamRows ? `<div class="tbl-wrap" style="margin-top:10px"><table class="tbl" style="font-size:12px">
        <thead><tr><th>运动员</th><th class="r">AU</th><th class="r">时长(min)</th><th class="r">吨位(kg)</th><th class="r">次数</th><th class="r">距离(m)</th><th class="r">做功(s)</th></tr></thead>
        <tbody>${teamRows}</tbody>
      </table></div>` : ''}`;

    $$('[data-ovl]', el).forEach((b) => b.onclick = () => {
      state.ovLevel = b.dataset.ovl;
      state.loadTab = TAB_OF_LEVEL[state.ovLevel] || 'detail';
      if (state.ovLevel === 'micro') {
        state.fltMesoId = 'all';
        if (state.fltMicroId === 'all') {
          const { eligibleMicros: allPlanMicros } = planCycles();
          const mc = allPlanMicros.find((m) => U.between(state.ovDate, m.startDate, m.endDate)) || allPlanMicros[0];
          if (mc) state.fltMicroId = mc.id;
        }
      }
      if (state.ovLevel === 'meso') {
        state.fltMicroId = 'all';
        if (state.fltMesoId === 'all') {
          const me = mesos.find((m) => U.between(state.ovDate, m.startDate, m.endDate)) || mesos[0];
          if (me) state.fltMesoId = me.id;
        }
      }
      mount();
    });
    const sSel = el.querySelector('#ovSes'); if (sSel) sSel.onchange = () => { state.ovSesId = sSel.value; mount(); };
    const dInp = el.querySelector('#ovDate'); if (dInp) dInp.onchange = () => { state.ovDate = dInp.value; mount(); };
    const mSel = el.querySelector('#ovMicro'); if (mSel) mSel.onchange = () => { state.fltMicroId = mSel.value; state.fltMesoId = 'all'; mount(); };
    const eSel = el.querySelector('#ovMeso'); if (eSel) eSel.onchange = () => { state.fltMesoId = eSel.value; state.fltMicroId = 'all'; mount(); };
    const goBtnEl = el.querySelector('#ovGo');
    if (goBtnEl) goBtnEl.onclick = () => {
      try { if (window.Views && Views.session && Views.session.state) Views.session.state.date = goDate; } catch (e) {}
      location.hash = '#/session'; window.dispatchEvent(new Event('hashchange'));
    };
  }

  function renderKPI(v) {
    const shortEl = v.querySelector('#loadShortKpis');
    const longEl = v.querySelector('#loadLongKpis');
    const weekEl = v.querySelector('#loadWeekKpis');
    if (state.mode === 'personal') {
      const ath = planAths().find((a) => a.id === state.athleteId);
      if (!ath) { [shortEl, longEl, weekEl].forEach((e) => { if (e) e.innerHTML = ''; }); return; }
      const entries = entriesOf(ath.id);
      const today = U.today();
      const wkStart = U.weekStart(today);
      const start = U.addDays(today, -111);
      const series = Calc.dailySeries(entries, start, today);
      const idx = series.length - 1;
      const ctlArr = Calc.ewma(series, 42), atlArr = Calc.ewma(series, 7);
      const tsb = ctlArr[idx].value - atlArr[idx].value;
      const acwr = Calc.acwr(series, idx);
      const ai = acwrInfo(acwr);
      const weekLoad = U.sum(series.slice(-7), (x) => x.load);
      const chronic = ctlArr[idx].value;
      const acute = atlArr[idx].value;
      const todayLoad = series[idx].load;
      const ts = tsbState(tsb);
      // 短期负荷 KPI：今日负荷 / ATL / ACWR / TSB
      shortEl.innerHTML = `<div class="kpis">
        <div class="kpi info"><div class="k">今日负荷${qTip('单次训练的内部负荷（量×强度）。计算：sRPE（自觉用力程度 0-10）× 训练时长（分钟），单位 AU（Arbitrary Units）', refTxt('foster01', 'impellizzeri19'))}</div><div class="v">${U.fmt(todayLoad)}<small>AU</small></div><div class="d">${U.md(today)} ${U.wd(today)}</div></div>
        <div class="kpi"><div class="k">急性负荷 ATL${qTip('急性训练负荷，代表近期疲劳水平（Acute Training Load）。计算：最近 7 天每日负荷的指数移动平均 EWMA（时间常数 7 天，Banister 模型）；对近期训练反应灵敏，上升快下降也快', refTxt('banister91', 'coggan'))}</div><div class="v">${U.fmt(Math.round(acute))}<small>AU/日</small></div><div class="d">近 7 天疲劳</div></div>
        <div class="kpi ${ai.cls}"><div class="k">ACWR 急慢性比${qTip('急慢性负荷比（Acute:Chronic Workload Ratio），评估负荷安排是否合理。计算：急性负荷 ATL（7 天 EWMA）÷ 慢性负荷 CTL（42 天 EWMA），与 TSB 共享同一组 CTL/ATL 值（Banister 模型）；建议保持 0.8-1.3，>1.5 提示负荷激增、损伤风险上升', refTxt('hulin14', 'gabbett16'))}</div><div class="v">${ai.label}</div><div class="d">${ai.desc}</div></div>
        <div class="kpi ${ts.cls}"><div class="k">TSB 训练压力平衡${qTip('训练压力平衡（Training Stress Balance），衡量疲劳与新鲜状态（Banister 模型）。计算：TSB = CTL（42 天慢性 EWMA）− ATL（7 天急性 EWMA）。文献区间：> +25 过于新鲜（可能掉能力）；+5~+25 状态新鲜（适合比赛）；−10~+5 训练平衡；−30~−10 积累疲劳（建设性）；< −30 深度疲劳（过度训练/损伤风险）', refTxt('banister91', 'coggan', 'skiba13', 'mujika96'))}</div><div class="v">${U.fmt(Math.round(tsb))}</div><div class="d">${ts.desc}</div></div>
      </div>`;
      // 长期负荷 KPI：CTL
      longEl.innerHTML = `<div class="kpis">
        <div class="kpi"><div class="k">慢性负荷 CTL${qTip('慢性训练负荷，代表当前能力水平（Chronic Training Load）。计算：最近 42 天每日负荷的指数移动平均 EWMA（时间常数 42 天，Banister 模型）；变化缓慢，反映长期适应的训练量', refTxt('banister91', 'coggan'))}</div><div class="v">${U.fmt(Math.round(chronic))}<small>AU/日</small></div><div class="d">能力基线</div></div>
      </div>`;
      // 周负荷 KPI
      weekEl.innerHTML = `<div class="kpis">
        <div class="kpi"><div class="k">本周负荷${qTip('近期急性负荷窗口。计算：本周一至今的每日负荷总和（Σ 最近 7 天每日负荷）', refTxt('foster01', 'coggan'))}</div><div class="v">${U.fmt(weekLoad)}<small>AU</small></div><div class="d">${U.md(wkStart)} 起</div></div>
      </div>`;
    } else {
      // 团队 KPI
      const aths = planAths();
      const entries = teamEntries();
      const today = U.today();
      const start = U.addDays(today, -111);
      const series = Calc.dailySeries(entries, start, today);
      const idx = series.length - 1;
      const ctlArr = Calc.ewma(series, 42), atlArr = Calc.ewma(series, 7);
      const tsb = ctlArr[idx].value - atlArr[idx].value;
      const acwr = Calc.acwr(series, idx);
      const ai = acwrInfo(acwr);
      const weekLoad = U.sum(series.slice(-7), (x) => x.load);
      const chronic = ctlArr[idx].value;
      const acute = atlArr[idx].value;
      const todayLoad = series[idx].load;
      const perAcwr = aths.map((a) => {
        const ent = entriesOf(a.id);
        const s = Calc.dailySeries(ent, start, today);
        return { name: a.name, acwr: Calc.acwr(s, s.length - 1), sport: a.sport };
      }).filter((x) => x.acwr != null).sort((a, b) => b.acwr - a.acwr);
      const risk = perAcwr.filter((x) => x.acwr > 1.3).length;
      const ts = tsbState(tsb);
      shortEl.innerHTML = `<div class="kpis">
        <div class="kpi info"><div class="k">全队今日负荷${qTip('全体队员当日负荷之和。单人负荷 = sRPE（自觉用力程度 0-10）× 训练时长（分钟）', refTxt('foster01', 'impellizzeri19'))}</div><div class="v">${U.fmt(todayLoad)}<small>AU</small></div><div class="d">${aths.length} 人合计</div></div>
        <div class="kpi"><div class="k">团队急性负荷 ATL${qTip('全队急性负荷（近期疲劳）。计算：全队每日负荷合计后取 7 天 EWMA（Banister 模型），与 TSB/ACWR 同口径', refTxt('banister91', 'coggan'))}</div><div class="v">${U.fmt(Math.round(acute))}<small>AU/日</small></div><div class="d">近 7 天疲劳</div></div>
        <div class="kpi ${ai.cls}"><div class="k">团队 ACWR${qTip('急慢性负荷比（全队合计口径）。计算：急性负荷 ATL（7 天 EWMA）÷ 慢性负荷 CTL（42 天 EWMA），与 TSB 共享同一组 CTL/ATL 值（Banister 模型）；建议保持 0.8-1.3', refTxt('hulin14', 'gabbett16'))}</div><div class="v">${ai.label}</div><div class="d">${ai.desc}${risk ? ` · ${risk} 人偏高` : ''}</div></div>
        <div class="kpi ${ts.cls}"><div class="k">团队 TSB${qTip('训练压力平衡（全队合计口径，Banister 模型）。计算：TSB = CTL（42 天慢性 EWMA）− ATL（7 天急性 EWMA）。文献区间：> +25 过于新鲜；+5~+25 状态新鲜；−10~+5 训练平衡；−30~−10 积累疲劳；< −30 深度疲劳', refTxt('banister91', 'coggan', 'skiba13', 'mujika96'))}</div><div class="v">${U.fmt(Math.round(tsb))}</div><div class="d">${ts.desc}</div></div>
      </div>`;
      longEl.innerHTML = `<div class="kpis">
        <div class="kpi"><div class="k">团队慢性负荷 CTL${qTip('全队长期负荷基础（CTL）。计算：全队每日负荷合计后取 42 天 EWMA，与 TSB/ACWR 同口径', refTxt('banister91', 'coggan'))}</div><div class="v">${U.fmt(Math.round(chronic))}<small>AU/日</small></div><div class="d">团队能力基线</div></div>
      </div>`;
      weekEl.innerHTML = `<div class="kpis">
        <div class="kpi"><div class="k">全队本周负荷${qTip('全体队员最近 7 天负荷总和（急性负荷窗口）。计算：Σ 全队每日负荷', refTxt('foster01', 'coggan'))}</div><div class="v">${U.fmt(weekLoad)}<small>AU</small></div><div class="d">${U.md(U.weekStart(today))} 起</div></div>
      </div>`;
    }
  }

  function renderGauges(v) {
    const el = v.querySelector('#loadGauges');
    if (state.mode === 'personal') {
      const ath = planAths().find((a) => a.id === state.athleteId);
      if (!ath) { el.innerHTML = ''; return; }
      const entries = entriesOf(ath.id);
      const today = U.today();
      const start = U.addDays(today, -111);
      const series = Calc.dailySeries(entries, start, today);
      const idx = series.length - 1;
      const ctlArr = Calc.ewma(series, 42), atlArr = Calc.ewma(series, 7);
      const tsb = ctlArr[idx].value - atlArr[idx].value;
      const acwr = Calc.acwr(series, idx);
      const ai = acwrInfo(acwr);
      el.innerHTML = `
        <div class="card-title"><h3>${U.esc(ath.name)} · ACWR / TSB 仪表盘${qTip('ACWR 急慢性负荷比：急性负荷 ATL（7 天 EWMA）÷ 慢性负荷 CTL（42 天 EWMA），与 TSB 共享同一组 CTL/ATL 值（Banister 模型）。指针指向当前值，绿色区 0.8-1.3 为最适区间；TSB 训练压力平衡 = CTL − ATL，正值=状态新鲜', refTxt('banister91', 'coggan', 'hulin14', 'gabbett16'))}</h3></div>
        <div class="grid2">
          <div><div class="chart" id="chAcwrGauge" style="height:300px"></div></div>
          <div><div class="chart" id="chTsbGauge" style="height:300px"></div></div>
        </div>
        <div class="row" style="gap:16px;justify-content:center;flex-wrap:wrap;margin-top:2px">
          ${ACWR_LEGEND}
        </div>`;
      // ACWR gauge（量程随超界值向上扩展，色带按 0.8/1.3/1.5 绝对分界重算）
      const ar = acwrRange(acwr);
      const g1 = UI.chart(el.querySelector('#chAcwrGauge'));
      g1.setOption({
        tooltip: Object.assign({ trigger: 'item' }, UI.tooltipCommon, { formatter: (p) => `${p.name || 'ACWR'}：<b>${p.value}</b>${ar.max > 2.5 ? '（超出基准量程 2.5，刻度已自动扩展）' : ''}` }),
        series: [{
          type: 'gauge',
          min: ar.min, max: ar.max,
          splitNumber: Math.round((ar.max - ar.min) / 0.5),
          radius: '62%', center: ['50%', '50%'],
          axisLine: {
            lineStyle: {
              width: 18,
              color: gaugeStops(ar.min, ar.max, ACWR_BANDS(ar.max))
            }
          },
          pointer: { width: 5, length: '60%', itemStyle: { color: UI.cssVar('var(--color-ink)'), shadowColor: UI.tint('var(--color-ink)', .5), shadowBlur: 10 } },
          anchor: { show: true, size: 12, itemStyle: { color: UI.cssVar('var(--color-surface)'), borderColor: UI.cssVar('var(--color-ink)'), borderWidth: 2 } },
          axisTick: { distance: 0, length: 6, lineStyle: { color: UI.cssVar('var(--color-ink-muted)') } },
          splitLine: { distance: 0, length: 14, lineStyle: { color: UI.cssVar('var(--color-ink-muted)') } },
          axisLabel: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, distance: 8 },   // 正值=向色带外（ECharts gauge axisLabel.distance 正=向外、负=向内）
          title: { show: false },
          detail: { valueAnimation: true, offsetCenter: [0, '85%'],
            formatter: (v) => `{val|${v}}\n{desc|${ai.desc}${ar.max > 2.5 ? ' · 超基准量程' : ''}}`,
            rich: { val: { color: ai.color, fontSize: 22, fontWeight: 'bold', backgroundColor: UI.tint('var(--color-background)', .72), borderColor: UI.tint('var(--color-ink-muted)', .25), borderWidth: 1, borderRadius: 6, padding: [2, 8] },
              desc: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11, padding: [3, 0, 0, 0] } } },
          data: [{ value: acwr != null ? +acwr.toFixed(2) : 0, name: 'ACWR · ' + ai.desc }]
        }]
      });
      // TSB gauge（量程随超界值按 25 步长扩展，色带按文献分界 −30/−10/+5/+25 重算；深度疲劳也不会穿出刻度）
      const ts = tsbState(tsb);
      const tr = tsbRange(tsb);
      const tsbOver = tsb < tr.min || tsb > 25;
      const g2 = UI.chart(el.querySelector('#chTsbGauge'));
      g2.setOption({
        tooltip: Object.assign({ trigger: 'item' }, UI.tooltipCommon, { formatter: (p) => `${p.name || 'TSB'}：<b>${p.value}</b>${tsbOver ? '（超出基准量程 −50～25，刻度已自动扩展）' : ''}` }),
        series: [{
          type: 'gauge',
          min: tr.min, max: tr.max,
          splitNumber: Math.round((tr.max - tr.min) / 25),
          radius: '62%', center: ['50%', '50%'],
          axisLine: {
            lineStyle: {
              width: 18,
              color: gaugeStops(tr.min, tr.max, TSB_BANDS(tr.max))
            }
          },
          pointer: { width: 5, length: '60%', itemStyle: { color: UI.cssVar('var(--color-ink)') } },
          anchor: { show: true, size: 12, itemStyle: { color: UI.cssVar('var(--color-surface)'), borderColor: UI.cssVar('var(--color-ink)'), borderWidth: 2 } },
          axisTick: { distance: 0, length: 6, lineStyle: { color: UI.cssVar('var(--color-ink-muted)') } },
          splitLine: { distance: 0, length: 14, lineStyle: { color: UI.cssVar('var(--color-ink-muted)') } },
          axisLabel: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, distance: 8 },   // 正值=向色带外（ECharts gauge axisLabel.distance 正=向外、负=向内）
          title: { show: false },
          detail: { valueAnimation: true, offsetCenter: [0, '85%'],
            formatter: (v) => `{val|${v}}\n{desc|${ts.desc}${tsbOver ? ' · 超基准量程' : ''}}`,
            rich: { val: { color: ts.color, fontSize: 22, fontWeight: 'bold', backgroundColor: UI.tint('var(--color-background)', .72), borderColor: UI.tint('var(--color-ink-muted)', .25), borderWidth: 1, borderRadius: 6, padding: [2, 8] },
              desc: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11, padding: [3, 0, 0, 0] } } },
          data: [{ value: Math.round(tsb), name: 'TSB · ' + ts.desc }]
        }]
      });
      // 团队 ACWR / TSB 仪表盘
    } else {
      // 团队 gauge
      const entries = teamEntries();
      const today = U.today();
      const start = U.addDays(today, -111);
      const series = Calc.dailySeries(entries, start, today);
      const idx = series.length - 1;
      const ctlArr = Calc.ewma(series, 42), atlArr = Calc.ewma(series, 7);
      const tsb = ctlArr[idx].value - atlArr[idx].value;
      const acwr = Calc.acwr(series, idx);
      const ai = acwrInfo(acwr);
      el.innerHTML = `
        <div class="card-title"><h3>团队 ACWR / TSB 仪表盘${qTip('急慢性负荷比（全队合计口径）：急性负荷 ATL（7 天 EWMA）÷ 慢性负荷 CTL（42 天 EWMA），与 TSB 共享同一组 CTL/ATL 值（Banister 模型），绿色区 0.8-1.3 为最适区间；TSB 训练压力平衡 = CTL − ATL', refTxt('banister91', 'coggan', 'hulin14', 'gabbett16'))}</h3><span class="sub">全队合计负荷 · 急慢性负荷比</span></div>
        <div class="grid2">
          <div><div class="chart" id="chAcwrGauge" style="height:300px"></div></div>
          <div><div class="chart" id="chTsbGauge" style="height:300px"></div></div>
        </div>
        <div class="row" style="gap:16px;justify-content:center;flex-wrap:wrap;margin-top:2px">
          ${ACWR_LEGEND}
        </div>`;
      const ar = acwrRange(acwr);
      const g1 = UI.chart(el.querySelector('#chAcwrGauge'));
      g1.setOption({
        tooltip: Object.assign({ trigger: 'item' }, UI.tooltipCommon, { formatter: (p) => `${p.name || '团队 ACWR'}：<b>${p.value}</b>${ar.max > 2.5 ? '（超出基准量程 2.5，刻度已自动扩展）' : ''}` }),
        series: [{
          type: 'gauge', min: ar.min, max: ar.max, splitNumber: Math.round((ar.max - ar.min) / 0.5), radius: '68%', center: ['50%', '50%'],
          axisLine: { lineStyle: { width: 18, color: gaugeStops(ar.min, ar.max, ACWR_BANDS(ar.max)) } },
          pointer: { width: 5, length: '60%', itemStyle: { color: UI.cssVar('var(--color-ink)') } },
          anchor: { show: true, size: 12, itemStyle: { color: UI.cssVar('var(--color-surface)'), borderColor: UI.cssVar('var(--color-ink)'), borderWidth: 2 } },
          axisTick: { distance: 0, length: 6, lineStyle: { color: UI.cssVar('var(--color-ink-muted)') } },
          splitLine: { distance: 0, length: 14, lineStyle: { color: UI.cssVar('var(--color-ink-muted)') } },
          axisLabel: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, distance: 8 },   // 正值=向色带外（ECharts gauge axisLabel.distance 正=向外、负=向内）
          title: { show: false },
          detail: { valueAnimation: true, offsetCenter: [0, '85%'],
            formatter: (v) => `{val|${v}}\n{desc|${ai.desc}${ar.max > 2.5 ? ' · 超基准量程' : ''}}`,
            rich: { val: { color: ai.color, fontSize: 22, fontWeight: 'bold', backgroundColor: UI.tint('var(--color-background)', .72), borderColor: UI.tint('var(--color-ink-muted)', .25), borderWidth: 1, borderRadius: 6, padding: [2, 8] },
              desc: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11, padding: [3, 0, 0, 0] } } },
          data: [{ value: acwr != null ? +acwr.toFixed(2) : 0, name: '团队 ACWR · ' + ai.desc }]
        }]
      });
      const ts = tsbState(tsb);
      const tr = tsbRange(tsb);
      const tsbOver = tsb < tr.min || tsb > 25;
      const g2 = UI.chart(el.querySelector('#chTsbGauge'));
      g2.setOption({
        tooltip: Object.assign({ trigger: 'item' }, UI.tooltipCommon, { formatter: (p) => `${p.name || '团队 TSB'}：<b>${p.value}</b>${tsbOver ? '（超出基准量程 −50～25，刻度已自动扩展）' : ''}` }),
        series: [{
          type: 'gauge', min: tr.min, max: tr.max, splitNumber: Math.round((tr.max - tr.min) / 25), radius: '68%', center: ['50%', '50%'],
          axisLine: { lineStyle: { width: 18, color: gaugeStops(tr.min, tr.max, TSB_BANDS(tr.max)) } },
          pointer: { width: 5, length: '60%', itemStyle: { color: UI.cssVar('var(--color-ink)') } },
          anchor: { show: true, size: 12, itemStyle: { color: UI.cssVar('var(--color-surface)'), borderColor: UI.cssVar('var(--color-ink)'), borderWidth: 2 } },
          axisTick: { distance: 0, length: 6, lineStyle: { color: UI.cssVar('var(--color-ink-muted)') } },
          splitLine: { distance: 0, length: 14, lineStyle: { color: UI.cssVar('var(--color-ink-muted)') } },
          axisLabel: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, distance: 8 },   // 正值=向色带外（ECharts gauge axisLabel.distance 正=向外、负=向内）
          title: { show: false },
          detail: { valueAnimation: true, offsetCenter: [0, '85%'],
            formatter: (v) => `{val|${v}}\n{desc|${ts.desc}${tsbOver ? ' · 超基准量程' : ''}}`,
            rich: { val: { color: ts.color, fontSize: 22, fontWeight: 'bold', backgroundColor: UI.tint('var(--color-background)', .72), borderColor: UI.tint('var(--color-ink-muted)', .25), borderWidth: 1, borderRadius: 6, padding: [2, 8] },
              desc: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11, padding: [3, 0, 0, 0] } } },
          data: [{ value: Math.round(tsb), name: '团队 TSB · ' + ts.desc }]
        }]
      });
    }
  }

  // ---------- 外部负荷三量纲分析（吨位 kg / 距离 m / 做功 s） ----------
  const BUCKET_COLORS = {
    '力量': UI.cssVar('var(--color-info)'), '爆发力': UI.cssVar('var(--color-purple)'), '速度敏捷': UI.cssVar('var(--color-danger)'), '核心': UI.cssVar('var(--color-accent)'),
    '有氧': UI.cssVar('var(--color-success)'), '无氧': UI.cssVar('var(--color-warning)'), '恢复柔韧': '#4fd6e0', '技战术': UI.cssVar('var(--color-ink-muted)'),
    '比赛': '#ff7ab6', '测试': '#c9a25d', '其他': UI.cssVar('var(--color-ink-subtle)')
  };
  const RADAR_AXES = ['力量', '爆发力', '速度敏捷', '有氧', '无氧', '核心', '恢复柔韧'];
  const emptyDose = () => ({ kg: 0, m: 0, s: 0, bands: { sprint: 0, hsr: 0, moderate: 0, aerobic: 0 } });
  const addDose = (a, b) => { a.kg += b.kg; a.m += b.m; a.s += b.s; for (const k of Object.keys(a.bands)) a.bands[k] += b.bands[k] || 0; };

  // 外部负荷 · 训练内容构成区块：实际训练分钟按内容桶拆分堆叠柱 + 七轴内容雷达
  function auSectionHtml(pfx) {
    return `
      <div style="margin-top:18px">
        <div class="card-title" style="margin-bottom:6px"><h3>外部负荷 · 训练内容构成${qTip('外部负荷按实际训练时间（分钟，含组间休息）计量：把每名运动员每节已完成训练课的实际时长，按动作行估算的时间占比拆分到力量/爆发力/速度敏捷/有氧/无氧/核心/恢复柔韧/技战术等内容桶，随上方周期筛选联动；雷达图展示所选范围七个内容轴的训练时间分布，形状越饱满内容越全面，某轴凹陷说明该素质本阶段安排较少。内部负荷 AU（sRPE×时长）见上方趋势图', refTxt('impellizzeri19', 'halson14'))}</h3></div>
        <div class="grid2">
          <div>
            <div class="chart" id="chExtAu${pfx}"></div>
          </div>
          <div>
            <div class="chart-cap">训练内容雷达</div>
            <div class="chart" id="chExtRadar${pfx}"></div>
          </div>
        </div>
      </div>`;
  }

  // 外部负荷区块 HTML（个人/团队共用，prefix 防 id 冲突）
  function extSectionHtml(pfx, title) {
    return `
      <div style="margin-top:18px">
        <div class="card-title" style="margin-bottom:6px"><h3>${title}${qTip('外部负荷 = 运动员实际完成的训练量，按三个不可互相换算的量纲分别统计：吨位 kg（重量×次数）、距离 m（跑动/位移）、做功 min（支撑/稳态等按时间计量的动作）。数据来自训练课每个动作行的「实际完成」，未填实际完成的行不计入；按训练内容拆分的实际训练分钟见下方「训练内容构成」，内部负荷（AU=sRPE×时长）见上方趋势图', refTxt('impellizzeri19', 'halson14'))}</h3></div>
        <div class="kpis" id="extKpi${pfx}" style="margin-bottom:12px"></div>
        <div>
          <div class="chart-cap">做功时长趋势${qTip('按时间计量的动作（平板支撑、靠墙静蹲、稳态有氧、拉伸等）实际完成的做功时间合计（分钟），不含组间休息；随上方周期筛选联动，单小周期内按天、否则按小周期聚合', refTxt('halson14'))}</div>
          <div class="chart" id="chExtSec${pfx}"></div>
        </div>
      </div>`;
  }

  // 个人：直接取单人剂量；团队：当前计划运动员逐个累加
  function extSessionDose(ses, aid) {
    if (aid) return Store.sessionActualDose(ses, aid, { actualOnly: true });
    const acc = emptyDose();
    for (const a of planAths()) if ((ses.athletes || []).includes(a.id)) addDose(acc, Store.sessionActualDose(ses, a.id, { actualOnly: true }));
    return acc;
  }
  function extMinBucket(from, to, aid) {
    if (aid) return Store.rangeMinByBucket(from, to, aid);
    const out = {};
    for (const a of planAths()) {
      const m = Store.rangeMinByBucket(from, to, a.id);
      for (const [b, v] of Object.entries(m)) out[b] = (out[b] || 0) + v;
    }
    return out;
  }

  function drawExternalLoad(v, pfx, aid) {
    // 与上方趋势图相同的周期范围/粒度（fltMeso/fltMicro）
    const tMac = Store.activeMacro();
    const tMesos = tMac ? Store.data.mesos.filter((m) => m.macroId === tMac.id) : Store.data.mesos;
    const tMics = state.fltMesoId === 'all'
      ? Store.data.micros.filter((mi) => tMesos.some((m) => m.id === mi.mesoId))
      : Store.data.micros.filter((mi) => mi.mesoId === state.fltMesoId);
    const tMic = state.fltMicroId !== 'all' ? Store.data.micros.find((x) => x.id === state.fltMicroId) : null;
    const tMeso = !tMic && state.fltMesoId !== 'all' ? tMesos.find((x) => x.id === state.fltMesoId) : null;
    let end = U.today(), start = U.addDays(end, -83);
    if (tMic) { start = tMic.startDate; end = tMic.endDate; }
    else if (tMeso) { start = tMeso.startDate; end = tMeso.endDate; }
    else if (tMac) { start = tMac.startDate; end = tMac.endDate; }
    const gran = tMic ? 'day' : 'micro';
    let ticks = [];
    if (gran === 'day') {
      for (let d = start; d <= end; d = U.addDays(d, 1)) ticks.push(d);
    } else {
      ticks = (state.fltMesoId !== 'all' ? Store.data.micros.filter((x) => x.mesoId === state.fltMesoId) : tMics.slice())
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    }
    const spanOf = (t) => gran === 'micro' ? [t.startDate, t.endDate] : [t, t];
    const labels = ticks.map((t) => gran === 'micro' ? t.name : U.md(t));
    const byTick = ticks.map(() => emptyDose());
    const rangeTot = emptyDose();
    for (const ses of Store.data.sessions || []) {
      if (ses.date < start || ses.date > end) continue;
      if (aid && !(ses.athletes || []).includes(aid)) continue;
      const d = extSessionDose(ses, aid);
      addDose(rangeTot, d);
      ticks.forEach((t, i) => { const [s, en] = spanOf(t); if (ses.date >= s && ses.date <= en) addDose(byTick[i], d); });
    }
    // KPI 卡：吨位 t / 距离 km / 做功 min
    const kpiBox = v.querySelector('#extKpi' + pfx);
    if (kpiBox) {
      kpiBox.innerHTML = `
        <div class="kpi"><div class="k">范围总吨位${qTip('所选周期内实际完成的力量训练总吨位（Σ 实际重量×实际完成次数，单位 kg），换算为吨 t', refTxt('halson14', 'impellizzeri19'))}</div><div class="v">${U.fmt(Math.round(rangeTot.kg / 100) / 10, 1)}<small>t</small></div><div class="d">${U.fmt(rangeTot.kg)} kg</div></div>
        <div class="kpi info"><div class="k">范围总距离${qTip('所选周期内实际完成的总跑动/位移距离（所有距离量纲动作行合计）', refTxt('halson14', 'impellizzeri19'))}</div><div class="v">${U.fmt(Math.round(rangeTot.m / 100) / 10, 1)}<small>km</small></div><div class="d">${U.fmt(Math.round(rangeTot.m))} m</div></div>
        <div class="kpi"><div class="k">范围总做功${qTip('所选周期内按时间计量动作（支撑/稳态/拉伸等）的实际做功时间合计，不含组间休息', refTxt('halson14', 'impellizzeri19'))}</div><div class="v">${U.fmt(Math.round(rangeTot.s / 6) / 10, 1)}<small>min</small></div><div class="d">时间量纲动作</div></div>`;
    }

    const axisLabel = { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, interval: gran === 'micro' && ticks.length > 12 ? 'auto' : 0, rotate: gran === 'micro' && ticks.length > 12 ? 45 : gran === 'micro' && ticks.length > 5 ? 25 : 0 };
    const tipHead = (i) => gran === 'micro' ? `<b>${U.esc(ticks[i].name)}</b><br/>${U.md(ticks[i].startDate)} — ${U.md(ticks[i].endDate)}` : `${U.md(ticks[i])} ${U.wd(ticks[i])}`;

    // 做功时长柱（秒→分）
    const cSec = UI.chart(v.querySelector('#chExtSec' + pfx));
    if (cSec) cSec.setOption({
      grid: { left: 52, right: 16, top: 30, bottom: gran === 'micro' && ticks.length > 5 ? 52 : 26 },
      tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon, {
        formatter: (ps) => tipHead(ps[0].dataIndex) + '<br/>' + ps.map((p) => `${p.marker}${p.seriesName}：<b>${U.fmt(Math.round(p.value))}</b> min（${U.fmt(Math.round(p.value * 60))} s）`).join('<br/>')
      }),
      xAxis: { type: 'category', data: labels, axisLabel },
      yAxis: Object.assign({ type: 'value', name: 'min', nameTextStyle: { color: UI.cssVar('var(--color-ink-subtle)') } }, UI.axisCommon),
      series: [{
        name: '做功时长', type: 'bar', data: byTick.map((x) => x.s ? Math.round(x.s / 6) / 10 : null), barMaxWidth: gran === 'micro' ? 30 : 24,
        itemStyle: { borderRadius: [4, 4, 0, 0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(79,214,224,.85)' }, { offset: 1, color: 'rgba(79,214,224,.25)' }] } }
      }]
    });

    // 实际训练分钟按内容桶堆叠柱
    const bucketNames = Object.keys(BUCKET_COLORS).filter((b) => b !== '其他');
    const minByTick = ticks.map((t) => { const [s, en] = spanOf(t); return extMinBucket(s, en, aid); });
    const cAu = UI.chart(v.querySelector('#chExtAu' + pfx));
    if (cAu) cAu.setOption({
      grid: { left: 52, right: 16, top: 30, bottom: gran === 'micro' && ticks.length > 5 ? 52 : 26 },
      tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon, {
        formatter: (ps) => tipHead(ps[0].dataIndex) + '<br/>' + ps.filter((p) => p.value > 0).map((p) => `${p.marker}${p.seriesName}：<b>${U.fmt(Math.round(p.value))}</b> min`).join('<br/>')
      }),
      legend: { top: 0, left: 0, itemWidth: 10, itemHeight: 8, textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 9 }, type: 'scroll' },
      xAxis: { type: 'category', data: labels, axisLabel },
      yAxis: Object.assign({ type: 'value', name: 'min', nameTextStyle: { color: UI.cssVar('var(--color-ink-subtle)') } }, UI.axisCommon),
      series: bucketNames.map((b) => ({
        name: b, type: 'bar', stack: 'min', data: minByTick.map((x) => x[b] ? Math.round(x[b]) : null), barMaxWidth: gran === 'micro' ? 30 : 24,
        itemStyle: { color: BUCKET_COLORS[b] }
      }))
    });

    // 内容雷达（范围总训练分钟，七轴）
    const rangeBuckets = extMinBucket(start, end, aid);
    const cRadar = UI.chart(v.querySelector('#chExtRadar' + pfx));
    if (cRadar) cRadar.setOption({
      tooltip: Object.assign({}, UI.tooltipCommon, { trigger: 'item', formatter: () => RADAR_AXES.map((ax) => `${ax}：<b>${U.fmt(Math.round(rangeBuckets[ax] || 0))}</b> min`).join('<br/>') }),
      radar: {
        indicator: RADAR_AXES.map((name) => ({ name, max: Math.max(50, ...RADAR_AXES.map((ax) => rangeBuckets[ax] || 0)) })),
        radius: '62%', center: ['50%', '54%'],
        axisName: { color: UI.cssVar('var(--color-ink)'), fontSize: 11 }, splitLine: { lineStyle: { color: UI.tint('var(--color-ink-muted)', .2) } },
        splitArea: { areaStyle: { color: [UI.tint('var(--color-ink-muted)', .04), UI.tint('var(--color-ink-muted)', .08)] } }, axisLine: { lineStyle: { color: UI.tint('var(--color-ink-muted)', .25) } }
      },
      series: [{
        type: 'radar', data: [{ value: RADAR_AXES.map((ax) => Math.round(rangeBuckets[ax] || 0)), name: '训练时间' }],
        areaStyle: { color: UI.tint('var(--color-info)', .25) }, lineStyle: { color: UI.cssVar('var(--color-info)'), width: 2 }, itemStyle: { color: UI.cssVar('var(--color-info)') }
      }]
    });
  }

  function renderCharts(v) {
    const shortEl = v.querySelector('#loadShortCharts');
    const strEl = v.querySelector('#loadStrength');
    const extEl = v.querySelector('#loadExternal');
    const longEl = v.querySelector('#loadLongCharts');
    if (state.mode === 'personal') {
      const ath = planAths().find((a) => a.id === state.athleteId);
      if (!ath) { [shortEl, strEl, extEl, longEl].forEach((e) => { if (e) e.innerHTML = ''; }); return; }
      // 全页统一周期筛选：选中小周期→小周期范围；选中中周期→中周期范围；全部→整个计划
      const tMac = Store.activeMacro();
      const tMesos = tMac ? Store.data.mesos.filter((m) => m.macroId === tMac.id) : Store.data.mesos;
      const tMics = state.fltMesoId === 'all'
        ? Store.data.micros.filter((mi) => tMesos.some((m) => m.id === mi.mesoId))
        : Store.data.micros.filter((mi) => mi.mesoId === state.fltMesoId);
      const tMic = state.fltMicroId !== 'all' ? Store.data.micros.find((x) => x.id === state.fltMicroId) : null;
      const tMeso = !tMic && state.fltMesoId !== 'all' ? tMesos.find((x) => x.id === state.fltMesoId) : null;
      let rangeLbl = '全部 · 近 12 周';
      let end = U.today(), start = U.addDays(end, -83);
      if (tMic) { start = tMic.startDate; end = tMic.endDate; rangeLbl = U.cn(start) + ' — ' + U.cn(end); }
      else if (tMeso) { start = tMeso.startDate; end = tMeso.endDate; rangeLbl = tMeso.name + ' · ' + U.cn(start) + ' — ' + U.cn(end); }
      else if (tMac) { start = tMac.startDate; end = tMac.endDate; rangeLbl = '全部 · ' + U.cn(start) + ' — ' + U.cn(end); }
      const rangeDays = Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
      const dayAxis = { interval: 'auto', rotate: rangeDays > 60 ? 30 : 0 };
      const gridBottom = rangeDays > 60 ? 38 : 26;
      // 统一周期筛选下拉（放在短期负荷面板顶部，全页共用）
      const fltSels = `
            <select id="fltMeso" class="sel" style="width:150px">
              <option value="all">全部中周期</option>
              ${tMesos.map((m) => `<option value="${m.id}" ${state.fltMesoId === m.id ? 'selected' : ''}>${U.esc(m.name)}</option>`).join('')}
            </select>
            <select id="fltMicro" class="sel" style="width:190px">
              <option value="all">全部小周期</option>
              ${tMics.map((mi) => `<option value="${mi.id}" ${state.fltMicroId === mi.id ? 'selected' : ''}>${U.esc(mi.name)}</option>`).join('')}
            </select>`;
      // —— 短期负荷：每日负荷 + ATL 走势 与 ACWR 历史走势 ——
      shortEl.innerHTML = `
        <div class="card-title"><h3>${U.esc(ath.name)} · 急性负荷走势${qTip('每日负荷=当日 sRPE×时长（AU）；ATL 急性负荷=7 天 EWMA（代表近期疲劳，反应灵敏）；ACWR=ATL÷CTL，绿色带 0.8–1.3 为最适区间，>1.5 红色虚线为风险线', refTxt('foster01', 'banister91', 'coggan', 'hulin14', 'gabbett16'))}</h3>
          <div class="row" style="gap:8px;align-items:center">
            <span class="sub">${rangeLbl}</span>
            ${fltSels}
          </div>
        </div>
        <div class="grid2">
          <div>
            <div class="chart-cap">每日负荷 与 ATL 急性走势${qTip('蓝柱=每日负荷（AU，当日 sRPE×时长）；橙线 ATL=7 天急性负荷 EWMA（近期疲劳，反应灵敏）；ATL 陡升说明近期负荷激增', refTxt('foster01', 'banister91', 'coggan'))}</div>
            <div class="chart" id="chDaily"></div>
          </div>
          <div>
            <div class="chart-cap">ACWR 历史走势<span class="ctx">0.8–1.3 最适区间</span>${qTip('ACWR=急性负荷 ATL÷慢性负荷 CTL（EWMA 口径，与 TSB 同源）；绿色带 0.8–1.3 表示负荷渐进合理；低于 0.8 负荷不足，高于 1.5 红色虚线为风险线，提示负荷激增、损伤风险上升', refTxt('hulin14', 'gabbett16'))}</div>
            <div class="chart" id="chAcwrTrend"></div>
          </div>
        </div>`;
      // —— 力量训练负荷与课次 ——
      strEl.innerHTML = `
        <div class="card-title" style="margin-bottom:6px"><h3>力量训练负荷与课次${qTip('力量负荷（kg）=已完成训练课中各动作「实际重量 × 实际完成次数」的合计（未填写实际重量或实际完成的动作不计入，负荷单位为 kg 而非 AU）；参训课次=该时段该运动员参训的训练课节数（右轴）', refTxt('halson14', 'impellizzeri19'))}</h3></div>
        <div class="chart" id="chAthActual"></div>`;
      // —— 外部负荷 + 训练内容构成 ——
      extEl.innerHTML = auSectionHtml('P') + extSectionHtml('P', U.esc(ath.name) + ' · 外部负荷（吨位 / 距离 / 做功）');
      // —— 长期负荷：CTL 走势 ——
      longEl.innerHTML = `
        <div class="card-title" style="margin-bottom:6px"><h3>慢性负荷 CTL 走势${qTip('CTL 慢性负荷=42 天 EWMA 日均负荷（代表能力水平，变化缓慢）；CTL 持续走高说明能力在积累，下降说明训练量不足或处于减量期', refTxt('banister91', 'coggan'))}</h3><span class="sub">${rangeLbl}</span></div>
        <div class="chart" id="chCtlTrend"></div>`;

      const series = Calc.dailySeries(entriesOf(ath.id), start, end);
      const days = series.map((x) => x.date);
      const ctl = Calc.ewma(series, 42).map((x) => Math.round(x.value));
      const atl = Calc.ewma(series, 7).map((x) => Math.round(x.value));
      const acwr = series.map((_, i) => { const v = Calc.acwr(series, i); return v == null ? null : +v.toFixed(2); });

      // 短期：每日负荷柱 + ATL 线
      const c1 = UI.chart(shortEl.querySelector('#chDaily'));
      c1.setOption({
        grid: { left: 46, right: 16, top: 30, bottom: gridBottom },
        tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon, { formatter: (ps) => `${U.md(ps[0].axisValue)} ${U.wd(ps[0].axisValue)}<br/>` + ps.map((p) => `${p.marker}${p.seriesName}：<b>${p.value ?? '—'}</b>`).join('<br/>') }),
        legend: { textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 }, top: 0, right: 0 },
        xAxis: { type: 'category', data: days, axisLabel: Object.assign({ formatter: (v) => U.md(v) }, UI.axisCommon.axisLabel, dayAxis) },
        yAxis: Object.assign({ type: 'value', name: 'AU' }, UI.axisCommon),
        series: [
          { name: '每日负荷', type: 'bar', data: series.map((x) => Math.round(x.load)), barMaxWidth: 10, itemStyle: { borderRadius: [3, 3, 0, 0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: UI.tint('var(--color-info)', .7) }, { offset: 1, color: UI.tint('var(--color-info)', .25) }] } } },
          { name: 'ATL 急性', type: 'line', data: atl, smooth: true, showSymbol: false, lineStyle: { color: UI.cssVar('var(--color-warning)'), width: 2.5, shadowColor: UI.tint('var(--color-warning)', .4), shadowBlur: 8 }, itemStyle: { color: UI.cssVar('var(--color-warning)') } }
        ]
      });
      const c2 = UI.chart(shortEl.querySelector('#chAcwrTrend'));
      c2.setOption({
        grid: { left: 46, right: 46, top: 30, bottom: gridBottom },
        tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon, { formatter: (ps) => `${U.md(ps[0].axisValue)} ${U.wd(ps[0].axisValue)}<br/>${ps[0].marker}ACWR：<b>${ps[0].value ?? '—'}</b>` }),
        xAxis: { type: 'category', data: days, axisLabel: Object.assign({ formatter: (v) => U.md(v) }, UI.axisCommon.axisLabel, dayAxis) },
        yAxis: Object.assign({ type: 'value', name: 'ACWR', min: 0, max: 2.5 }, UI.axisCommon, { splitLine: { show: false } }),
        series: [
          { name: 'ACWR', type: 'line', data: acwr, smooth: true, showSymbol: false, connectNulls: true,
            lineStyle: { color: UI.cssVar('var(--color-accent)'), width: 3, shadowColor: UI.tint('var(--color-accent)', .5), shadowBlur: 10 }, itemStyle: { color: UI.cssVar('var(--color-accent)') },
            areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: UI.tint('var(--color-accent)', .25) }, { offset: 1, color: UI.tint('var(--color-accent)', 0) }] } },
            markArea: { silent: true, itemStyle: { color: UI.tint('var(--color-success)', .08) }, label: { show: true, position: 'insideTop', color: UI.tint('var(--color-success)', .7), fontSize: 10 }, data: [[{ yAxis: 0.8, name: '最适区间' }, { yAxis: 1.3 }]] },
            markLine: { silent: true, symbol: 'none', lineStyle: { color: UI.tint('var(--color-danger)', .6), type: 'dashed' }, label: { color: UI.cssVar('var(--color-danger)'), fontSize: 10 }, data: [{ yAxis: 1.5, name: '风险线' }] }
          }
        ]
      });
      // 长期：CTL 走势
      const cCtl = UI.chart(longEl.querySelector('#chCtlTrend'));
      cCtl.setOption({
        grid: { left: 50, right: 16, top: 20, bottom: gridBottom },
        tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon, { formatter: (ps) => `${U.md(ps[0].axisValue)} ${U.wd(ps[0].axisValue)}<br/>${ps[0].marker}CTL：<b>${ps[0].value ?? '—'}</b> AU/日` }),
        xAxis: { type: 'category', data: days, axisLabel: Object.assign({ formatter: (v) => U.md(v) }, UI.axisCommon.axisLabel, dayAxis) },
        yAxis: Object.assign({ type: 'value', name: 'AU/日' }, UI.axisCommon),
        series: [{
          name: 'CTL 慢性', type: 'line', data: ctl, smooth: true, showSymbol: false,
          lineStyle: { color: UI.cssVar('var(--color-success)'), width: 3, shadowColor: UI.tint('var(--color-success)', .4), shadowBlur: 8 }, itemStyle: { color: UI.cssVar('var(--color-success)') },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: UI.tint('var(--color-success)', .2) }, { offset: 1, color: UI.tint('var(--color-success)', 0) }] } }
        }]
      });
      // 力量训练负荷与课次
      const drawAthActual = () => {
        const mesoId = state.fltMesoId, micId = state.fltMicroId;
        const gran = micId !== 'all' ? 'day' : 'micro';
        let ticks = [];
        if (gran === 'day') {
          const mi = Store.data.micros.find((x) => x.id === micId);
          if (mi) for (let d = mi.startDate; d <= mi.endDate; d = U.addDays(d, 1)) ticks.push(d);
        } else {
          ticks = (mesoId !== 'all'
            ? Store.data.micros.filter((x) => x.mesoId === mesoId)
            : tMics.slice())
            .sort((a, b) => a.startDate.localeCompare(b.startDate));
        }
        const spanOf = (t) => gran === 'micro' ? [t.startDate, t.endDate] : [t, t];
        const byTick = ticks.map(() => ({ kg: 0, ses: 0 }));
        for (const ses of Store.data.sessions) {
          if (!(ses.athletes || []).includes(ath.id)) continue;
          const res = (ses.results || {})[ath.id] || [];
          (ses.rows || []).forEach((r, ri) => {
            if (Calc.metricOf(r) !== 'reps') return;
            const rs = res[ri];
            const w = rs && rs.w != null ? Number(rs.w) : null;
            const d = Calc.actualRowDose(r, rs || {});
            if (!w || !d.filled || !d.total) return;
            const kg = w * d.total;
            ticks.forEach((t, ti) => { const [s, en] = spanOf(t); if (ses.date >= s && ses.date <= en) byTick[ti].kg += kg; });
          });
        }
        for (const ses of Store.data.sessions) {
          if (!(ses.athletes || []).includes(ath.id)) continue;
          ticks.forEach((t, i) => { const [s, en] = spanOf(t); if (ses.date >= s && ses.date <= en) byTick[i].ses += 1; });
        }
        const labels = ticks.map((t) => gran === 'micro' ? t.name : U.md(t));
        const ch = UI.chart(strEl.querySelector('#chAthActual'));
        ch.setOption({
          grid: { left: 50, right: 56, top: 30, bottom: gran === 'micro' && ticks.length > 12 ? 74 : gran === 'micro' && ticks.length > 5 ? 52 : 24 },
          legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 } },
          tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon, {
            formatter: (ps) => {
              if (!ps || !ps.length) return '';
              const i = ps[0].dataIndex, t = ticks[i];
              const head = gran === 'micro'
                ? `<b>${U.esc(t.name)}</b><br/>${U.md(t.startDate)} — ${U.md(t.endDate)}`
                : `${U.md(t)} ${U.wd(t)}`;
              const lines = ps.filter((p) => p.value != null).map((p) => `${p.marker}${p.seriesName}：<b>${U.fmt(p.value)}</b>${p.seriesName === '力量负荷（kg）' ? ' kg' : ''}`);
              return head + '<br/>' + (lines.join('<br/>') || '无已完成训练课');
            }
          }),
          xAxis: { type: 'category', data: labels,
            axisLabel: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10,
              interval: gran === 'micro' && ticks.length > 12 ? 'auto' : 0,
              rotate: gran === 'micro' && ticks.length > 12 ? 45 : gran === 'micro' && ticks.length > 5 ? 25 : 0 } },
          yAxis: [
            Object.assign({ type: 'value', name: 'kg', nameTextStyle: { color: UI.cssVar('var(--color-ink-subtle)') } }, UI.axisCommon),
            Object.assign({ type: 'value', name: '课次', minInterval: 1, nameTextStyle: { color: UI.cssVar('var(--color-ink-subtle)') } }, UI.axisCommon, { splitLine: { show: false } })
          ],
          series: [
            { name: '力量负荷（kg）', type: 'bar', data: byTick.map((x) => x.kg ? Math.round(x.kg) : null), barMaxWidth: gran === 'micro' ? 34 : 26,
              itemStyle: { borderRadius: [4, 4, 0, 0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: UI.tint('var(--color-success)', .85) }, { offset: 1, color: UI.tint('var(--color-success)', .25) }] } } },
            { name: '参训课次', type: 'line', yAxisIndex: 1, data: byTick.map((x) => x.ses || null), smooth: true, lineStyle: { color: UI.cssVar('var(--color-warning)'), width: 2.5 }, itemStyle: { color: UI.cssVar('var(--color-warning)') }, symbolSize: 6, connectNulls: true }
          ]
        });
      };
      drawAthActual();
      drawExternalLoad(extEl, 'P', ath.id);
      const fltMesoSel = shortEl.querySelector('#fltMeso');
      if (fltMesoSel) fltMesoSel.onchange = () => { state.fltMesoId = fltMesoSel.value; state.fltMicroId = 'all'; mount(); };
      const fltMicSel = shortEl.querySelector('#fltMicro');
      if (fltMicSel) fltMicSel.onchange = () => { state.fltMicroId = fltMicSel.value; mount(); };
    } else {
      // 团队图表
      const aths = planAths();
      const tMac = Store.activeMacro();
      const tMesos = tMac ? Store.data.mesos.filter((m) => m.macroId === tMac.id) : Store.data.mesos;
      const tMics = state.fltMesoId === 'all'
        ? Store.data.micros.filter((mi) => tMesos.some((m) => m.id === mi.mesoId))
        : Store.data.micros.filter((mi) => mi.mesoId === state.fltMesoId);
      const tMic = state.fltMicroId !== 'all' ? Store.data.micros.find((x) => x.id === state.fltMicroId) : null;
      const tMeso = !tMic && state.fltMesoId !== 'all' ? tMesos.find((x) => x.id === state.fltMesoId) : null;
      let rangeLbl = '全部 · 近 12 周';
      let end = U.today(), start = U.addDays(end, -83);
      if (tMic) { start = tMic.startDate; end = tMic.endDate; rangeLbl = U.cn(start) + ' — ' + U.cn(end); }
      else if (tMeso) { start = tMeso.startDate; end = tMeso.endDate; rangeLbl = tMeso.name + ' · ' + U.cn(start) + ' — ' + U.cn(end); }
      else if (tMac) { start = tMac.startDate; end = tMac.endDate; rangeLbl = '全部 · ' + U.cn(start) + ' — ' + U.cn(end); }
      const rangeDays = Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
      const dayAxis = { interval: 'auto', rotate: rangeDays > 60 ? 30 : 0 };
      const gridBottom = rangeDays > 60 ? 38 : 26;
      const teamSeries = Calc.dailySeries(teamEntries(), start, end);
      const days = teamSeries.map((x) => x.date);
      const perRange = aths.map((a) => {
        const s = Calc.dailySeries(entriesOf(a.id), start, end);
        return { name: a.name, sport: a.sport, load: U.sum(s, (x) => x.load), days: s.filter((x) => x.load > 0).length };
      }).sort((a, b) => b.load - a.load);
      const fltSels = `
            <select id="fltMeso" class="sel" style="width:150px">
              <option value="all">全部中周期</option>
              ${tMesos.map((m) => `<option value="${m.id}" ${state.fltMesoId === m.id ? 'selected' : ''}>${U.esc(m.name)}</option>`).join('')}
            </select>
            <select id="fltMicro" class="sel" style="width:190px">
              <option value="all">全部小周期</option>
              ${tMics.map((mi) => `<option value="${mi.id}" ${state.fltMicroId === mi.id ? 'selected' : ''}>${U.esc(mi.name)}</option>`).join('')}
            </select>`;
      // 短期负荷：全队每日负荷 + ATL 与个人负荷对比
      shortEl.innerHTML = `
        <div class="card-title"><h3>团队急性负荷走势</h3>
          <div class="row" style="gap:8px;align-items:center">
            <span class="sub">${rangeLbl}</span>
            ${fltSels}
          </div>
        </div>
        <div class="grid2">
          <div>
            <div class="chart-cap">全队每日总负荷 与 ATL${qTip('蓝柱=全队每日总负荷（AU，全体队员当日 sRPE×时长之和）；橙线 ATL=7 天急性负荷 EWMA（团队近期疲劳）', refTxt('foster01', 'banister91', 'coggan'))}</div>
            <div class="chart" id="chTeamDaily"></div>
          </div>
          <div>
            <div class="chart-cap">个人负荷对比<span class="ctx">所选范围 ${rangeDays} 天累计 AU</span>${qTip('横向柱=每名运动员在所选范围（随上方周期筛选联动）内的累计负荷 AU；颜色按日均负荷分级：红>430、橙>215、绿≤215；悬停显示累计负荷与有负荷天数', refTxt('foster01'))}</div>
            <div class="chart" id="chPerCompare"></div>
          </div>
        </div>`;
      strEl.innerHTML = '';
      extEl.innerHTML = auSectionHtml('T') + extSectionHtml('T', '团队外部负荷（吨位 / 距离 / 做功）');
      longEl.innerHTML = `
        <div class="card-title" style="margin-bottom:6px"><h3>团队慢性负荷 CTL 走势${qTip('CTL 慢性负荷=全队 42 天 EWMA 日均负荷（代表团队能力水平，变化缓慢）', refTxt('banister91', 'coggan'))}</h3><span class="sub">${rangeLbl}</span></div>
        <div class="chart" id="chCtlTrend"></div>`;

      const ctl = Calc.ewma(teamSeries, 42).map((x) => Math.round(x.value));
      const atl = Calc.ewma(teamSeries, 7).map((x) => Math.round(x.value));
      const c1 = UI.chart(shortEl.querySelector('#chTeamDaily'));
      c1.setOption({
        grid: { left: 46, right: 16, top: 30, bottom: gridBottom },
        tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon, { formatter: (ps) => `${U.md(ps[0].axisValue)} ${U.wd(ps[0].axisValue)}<br/>` + ps.map((p) => `${p.marker}${p.seriesName}：<b>${p.value ?? '—'}</b>`).join('<br/>') }),
        legend: { textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 }, top: 0, right: 0 },
        xAxis: { type: 'category', data: days, axisLabel: Object.assign({ formatter: (v) => U.md(v) }, UI.axisCommon.axisLabel, dayAxis) },
        yAxis: Object.assign({ type: 'value', name: 'AU' }, UI.axisCommon),
        series: [
          { name: '全队每日负荷', type: 'bar', data: teamSeries.map((x) => Math.round(x.load)), barMaxWidth: 12, itemStyle: { borderRadius: [3, 3, 0, 0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: UI.tint('var(--color-info)', .7) }, { offset: 1, color: UI.tint('var(--color-info)', .2) }] } } },
          { name: 'ATL 急性', type: 'line', data: atl, smooth: true, showSymbol: false, lineStyle: { color: UI.cssVar('var(--color-warning)'), width: 2.5 }, itemStyle: { color: UI.cssVar('var(--color-warning)') } }
        ]
      });
      const c2 = UI.chart(shortEl.querySelector('#chPerCompare'));
      c2.setOption({
        grid: { left: 80, right: 44, top: 30, bottom: 26 },
        tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon, { formatter: (ps) => {
          const v = perRange[perRange.length - 1 - ps[0].dataIndex];
          return `${ps[0].axisValue || ps[0].name}<br/>${ps[0].marker}范围累计：<b>${U.fmt(ps[0].value)} AU</b>${v ? `<br/>有负荷天数：${v.days} 天` : ''}`;
        } }),
        xAxis: Object.assign({ type: 'value' }, UI.axisCommon),
        yAxis: { type: 'category', data: perRange.map((p) => p.name).reverse(), axisLine: { lineStyle: { color: UI.cssVar('var(--color-border-strong)') } }, axisLabel: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 } },
        series: [{
          name: '范围累计负荷', type: 'bar', data: perRange.map((p) => Math.round(p.load)).reverse(), barMaxWidth: 18,
          itemStyle: { borderRadius: [0, 4, 4, 0], color: (p) => {
            const v = perRange[perRange.length - 1 - p.dataIndex];
            const avg = v && v.days ? v.load / v.days : 0;
            return avg > 430 ? UI.cssVar('var(--color-danger)') : avg > 215 ? UI.cssVar('var(--color-warning)') : UI.cssVar('var(--color-success)');
          } },
          label: { show: true, position: 'right', formatter: (p) => U.fmt(p.value), color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 }
        }]
      });
      // 长期：团队 CTL 走势
      const cCtl = UI.chart(longEl.querySelector('#chCtlTrend'));
      cCtl.setOption({
        grid: { left: 50, right: 16, top: 20, bottom: gridBottom },
        tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon, { formatter: (ps) => `${U.md(ps[0].axisValue)} ${U.wd(ps[0].axisValue)}<br/>${ps[0].marker}团队 CTL：<b>${ps[0].value ?? '—'}</b> AU/日` }),
        xAxis: { type: 'category', data: days, axisLabel: Object.assign({ formatter: (v) => U.md(v) }, UI.axisCommon.axisLabel, dayAxis) },
        yAxis: Object.assign({ type: 'value', name: 'AU/日' }, UI.axisCommon),
        series: [{
          name: 'CTL 慢性', type: 'line', data: ctl, smooth: true, showSymbol: false,
          lineStyle: { color: UI.cssVar('var(--color-success)'), width: 3, shadowColor: UI.tint('var(--color-success)', .4), shadowBlur: 8 }, itemStyle: { color: UI.cssVar('var(--color-success)') },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: UI.tint('var(--color-success)', .2) }, { offset: 1, color: UI.tint('var(--color-success)', 0) }] } }
        }]
      });
      const fltMesoSel = shortEl.querySelector('#fltMeso');
      if (fltMesoSel) fltMesoSel.onchange = () => { state.fltMesoId = fltMesoSel.value; state.fltMicroId = 'all'; mount(); };
      const fltMicSel = shortEl.querySelector('#fltMicro');
      if (fltMicSel) fltMicSel.onchange = () => { state.fltMicroId = fltMicSel.value; mount(); };
      drawExternalLoad(extEl, 'T', null);
    }
  }

  function renderWeeks(v) {
    const el = v.querySelector('#loadWeeks');
    if (state.mode === 'personal') {
      const ath = planAths().find((a) => a.id === state.athleteId);
      if (!ath) { el.innerHTML = ''; return; }
      const entries = entriesOf(ath.id);
      // 粒度：选中小周期 → 按日（每日负荷与课次）；选中中周期 → 按小周期聚合（各小周期负荷与课次）；否则按周（近 8 周）
      const mac = Store.activeMacro();
      const mesos = mac ? Store.data.mesos.filter((m) => m.macroId === mac.id) : Store.data.mesos;
      const micros = state.fltMesoId === 'all' ? Store.data.micros.filter((mi) => mesos.some((m) => m.id === mi.mesoId)) : Store.data.micros.filter((mi) => mi.mesoId === state.fltMesoId);
      const loadOf = (e) => e.load != null ? e.load : Math.round((Number(e.rpe) || 0) * (Number(e.duration) || 0));
      const sesCount = (from, to) => (Store.data.sessions || []).filter((s) => s.date >= from && s.date <= to && Store.hasCompletedLoad(s) && (s.athletes || []).includes(ath.id)).length;
      const acwrAt = (day) => { const s = Calc.dailySeries(entries, U.addDays(day, -55), day); return Calc.acwr(s, s.length - 1); };
      const selMicro = state.fltMicroId !== 'all' ? Store.data.micros.find((x) => x.id === state.fltMicroId) : null;
      const selMeso = !selMicro && state.fltMesoId !== 'all' ? mesos.find((x) => x.id === state.fltMesoId) : null;
      let gran = selMicro ? 'day' : 'micro';   // day=单个小周期按日；micro=逐小周期（选 中周期→其内小周期；全部→全计划小周期）
      let wStart = null, wEnd = null;
      const rows = [];
      if (gran === 'day') {
        wStart = selMicro.startDate; wEnd = selMicro.endDate;
        for (let d = wStart; d <= wEnd; d = U.addDays(d, 1)) {
          const dayEntries = entries.filter((e) => e.date === d);
          const total = U.sum(dayEntries, loadOf);
          rows.push({ ws: d, we: d, total, days: total > 0 ? 1 : 0, mono: null, strain: null, acwr: acwrAt(d), ses: sesCount(d, d) });
        }
      } else {
        const mics = micros.slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
        wStart = selMeso ? selMeso.startDate : (mics[0] ? mics[0].startDate : U.weekStart(U.today()));
        wEnd = selMeso ? selMeso.endDate : (mics.length ? mics[mics.length - 1].endDate : U.today());
        mics.forEach((mi) => {
          const miEntries = entries.filter((e) => U.between(e.date, mi.startDate, mi.endDate));
          const loads = Calc.dailySeries(miEntries, mi.startDate, mi.endDate).map((x) => x.load);
          const total = U.sum(loads);
          const mono = Calc.monotony(loads);
          rows.push({ ws: mi.startDate, we: mi.endDate, label: mi.name, total, days: loads.filter((x) => x > 0).length, mono, strain: mono ? Math.round(total * mono) : null, acwr: acwrAt(mi.endDate), ses: sesCount(mi.startDate, mi.endDate) });
        });
      }
      // 视图下拉：单调性与应变 / 数据表格（按日粒度无周指标，仅提供数据表格；负荷与课次统计已在上方负荷趋势看板，不再重复）
      if (gran === 'day' && state.weekView !== 'table') state.weekView = 'table';
      const viewSel = `<select class="sel" id="wkView" style="width:auto">
        ${gran !== 'day' ? `<option value="strain" ${state.weekView === 'strain' ? 'selected' : ''}>单调性与应变</option>` : ''}
        <option value="table" ${state.weekView === 'table' ? 'selected' : ''}>数据表格</option>
      </select>`;
      const headHtml = `<div class="card-title"><h3>周负荷分析${qTip('总负荷=所选时段（随上方周期筛选联动）每日负荷合计 AU；课次=该时段参训训练课节数；训练天数=有负荷记录的天数；日均=总负荷÷天数；单调性=日均÷标准差（>2 提示负荷过于单一）；应变=总负荷×单调性；ACWR=时段末急慢性负荷比（7 天 EWMA ÷ 42 天 EWMA）', refTxt('foster98', 'hulin14', 'gabbett16'))}</h3><span class="sub">${U.md(wStart)} — ${U.md(wEnd)}</span>${viewSel}</div>`;
      const hintHtml = `<p class="hint" style="margin-top:10px;line-height:1.8">单调性 >2 提示负荷过于单一（缺乏变化）；ACWR 0.8–1.3 为合理区间，>1.5 风险升高。（单调性/应变：Foster C, et al. Med Sci Sports Exerc, 1998；ACWR 区间：Gabbett TJ, Br J Sports Med, 2016）</p>`;
      if (weekChart) { weekChart.dispose(); weekChart = null; }
      if (state.weekView === 'table') {
        const spanDays = (r) => Math.max(1, Math.round((new Date(r.we) - new Date(r.ws)) / 86400000) + 1);
        const headCell = gran === 'day' ? '<th>日期</th>' : gran === 'micro' ? '<th>小周期</th>' : '<th>周</th>';
        el.innerHTML = `${headHtml}
        <div style="overflow-x:auto"><table class="tbl">
          <thead><tr>${headCell}<th class="r">${gran === 'day' ? '负荷 AU' : '总负荷'}</th><th class="r">课次${qTip('该时段内运动员参训的训练课节数（按训练课日期统计）')}</th>${gran === 'day' ? '' : `<th class="r">训练天数</th><th class="r">日均</th><th class="r">单调性${qTip('负荷单一程度。计算：周内日均负荷 ÷ 日负荷标准差，＞2 提示负荷过于单一、缺乏变化，增加过度使用损伤风险', refTxt('foster98'))}</th><th class="r">应变${qTip('周负荷总压力。计算：周总负荷 × 单调性', refTxt('foster98'))}</th>`}<th class="r">ACWR${qTip('该时段末时点的急慢性负荷比。计算：急性负荷（7 天 EWMA）÷ 慢性负荷（42 天 EWMA），建议保持 0.8-1.3', refTxt('hulin14', 'gabbett16'))}</th></tr></thead>
          <tbody>${rows.map((r) => `
            <tr><td class="num">${gran === 'day' ? U.md(r.ws) + ' ' + U.wd(r.ws) : (r.label ? U.esc(r.label) + ' · ' : '') + U.md(r.ws) + ' — ' + U.md(r.we)}</td>
            <td class="r num"><b>${U.fmt(r.total)}</b></td>
            <td class="r num">${r.ses}</td>
            ${gran === 'day' ? '' : `<td class="r num">${r.days}</td>
            <td class="r num">${U.fmt(Math.round(r.total / spanDays(r)))}</td>
            <td class="r num">${r.mono ? r.mono.toFixed(2) + (r.mono > 2 ? ' <span class="chip red">过高</span>' : '') : '—'}</td>
            <td class="r num">${r.strain != null ? U.fmt(r.strain) : '—'}</td>`}
            <td class="r num">${r.acwr != null ? acwrInfo(r.acwr).label : '—'}</td></tr>`).join('')}
          </tbody></table></div>
        ${hintHtml}`;
      } else {
        el.innerHTML = `${headHtml}<div class="chart" id="chWeek" style="height:300px"></div>${hintHtml}`;
        weekChart = UI.chart(el.querySelector('#chWeek'));
        // 悬停提示：覆盖全部指标（负荷/课次/天数/日均/单调性/应变/ACWR）
        const tipFmt = (ps) => {
          const r = rows[ps[0].dataIndex];
          if (!r) return '';
          const ai = r.acwr != null ? acwrInfo(r.acwr) : null;
          const span = Math.max(1, Math.round((new Date(r.we) - new Date(r.ws)) / 86400000) + 1);
          const head = gran === 'day' ? `<b>${U.md(r.ws)} ${U.wd(r.ws)}</b>` : `<b>${r.label ? U.esc(r.label) + ' · ' : ''}${U.md(r.ws)} — ${U.md(r.we)}</b>`;
          return `${head}<br/>负荷：${U.fmt(r.total)} AU<br/>课次：${r.ses} 节<br/>训练天数：${r.days} 天<br/>日均：${U.fmt(Math.round(r.total / span))} AU${gran === 'day' ? '' : `<br/>单调性：${r.mono ? r.mono.toFixed(2) : '—'}<br/>应变：${r.strain != null ? U.fmt(r.strain) : '—'}`}<br/>ACWR：${ai ? ai.label + '（' + ai.desc + '）' : '—'}`;
        };
        // x 轴：按日=日期；按小周期=小周期名称（多个时倾斜防重叠）；按周=周一日期
        const xData = rows.map((r) => gran === 'micro' ? (r.label || U.md(r.ws)) : U.md(r.ws));
        const xAxisCfg = Object.assign({ type: 'category', data: xData }, UI.axisCommon,
          gran === 'micro' ? { axisLabel: { interval: rows.length > 12 ? 'auto' : 0, rotate: rows.length > 12 ? 45 : rows.length > 4 ? 25 : 0, fontSize: 10, color: UI.cssVar('var(--color-ink-muted)') } } : {});
        // 柱 = 应变，线 = 单调性（右侧轴），红色虚线阈值 2
        weekChart.setOption({
          grid: { left: 56, right: 52, top: 50, bottom: gran === 'micro' && rows.length > 12 ? 74 : gran === 'micro' && rows.length > 4 ? 46 : 26 },
          tooltip: Object.assign({}, UI.tooltipCommon, { trigger: 'axis', formatter: tipFmt }),
          legend: { textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 }, top: 0, left: 0 },
          xAxis: xAxisCfg,
          yAxis: [
            Object.assign({ type: 'value', name: '应变', nameTextStyle: { color: UI.cssVar('var(--color-ink-subtle)') } }, UI.axisCommon),
            Object.assign({ type: 'value', name: '单调性', min: 0, max: 3, nameTextStyle: { color: UI.cssVar('var(--color-ink-subtle)') } }, UI.axisCommon)
          ],
          series: [
            { name: '应变', type: 'bar', data: rows.map((r) => r.strain), barMaxWidth: 30, itemStyle: { borderRadius: [4, 4, 0, 0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: UI.tint('var(--color-warning)', .85) }, { offset: 1, color: UI.tint('var(--color-warning)', .25) }] } } },
            { name: '单调性', type: 'line', yAxisIndex: 1, data: rows.map((r) => r.mono == null ? null : +r.mono.toFixed(2)), smooth: true, symbolSize: 7, lineStyle: { color: UI.cssVar('var(--color-info)'), width: 2.5 }, itemStyle: { color: UI.cssVar('var(--color-info)') },
              markLine: { silent: true, symbol: 'none', lineStyle: { color: UI.cssVar('var(--color-danger)'), type: 'dashed' }, label: { color: UI.cssVar('var(--color-danger)'), fontSize: 10, formatter: '阈值 2' }, data: [{ yAxis: 2 }] } }
          ]
        });
      }
      const sel = el.querySelector('#wkView');
      if (sel) sel.onchange = () => { state.weekView = sel.value; renderWeeks(v); };
    } else {
      // 团队周分析：各运动员近周负荷排名
      const aths = planAths();
      const thisWs = U.weekStart(U.today());
      const ws = U.addDays(thisWs, -7 * 7), we = U.today();
      const rows = aths.map((a) => {
        const entries = entriesOf(a.id);
        const wkEntries = entries.filter((e) => U.between(e.date, ws, we));
        const total = U.sum(wkEntries, (e) => e.load != null ? e.load : Math.round((Number(e.rpe) || 0) * (Number(e.duration) || 0)));
        const s = Calc.dailySeries(entries, U.addDays(we, -55), we);
        return { name: a.name, sport: a.sport, total, acwr: Calc.acwr(s, s.length - 1), days: wkEntries.length };
      }).sort((a, b) => b.total - a.total);
      el.innerHTML = `
        <div class="card-title"><h3>团队周负荷排名${qTip('近 8 周各运动员合计负荷排名；总负荷=Σ 日负荷（AU）；训练天数=有负荷记录的天数；日均=总负荷÷56 天；ACWR=急慢性负荷比（7 天 EWMA ÷ 42 天 EWMA），0.8-1.3 为最适区间', refTxt('foster98', 'hulin14', 'gabbett16'))}</h3><span class="sub">近 8 周合计</span></div>
        <div style="overflow-x:auto"><table class="tbl">
          <thead><tr><th>运动员</th><th>项目</th><th class="r">总负荷</th><th class="r">训练天数</th><th class="r">日均</th><th class="r">ACWR</th></tr></thead>
          <tbody>${rows.map((r) => {
            const ai = acwrInfo(r.acwr);
            return `<tr><td><b>${U.esc(r.name)}</b></td>
            <td>${U.esc(r.sport || '—')}</td>
            <td class="r num"><b>${U.fmt(r.total)}</b></td>
            <td class="r num">${r.days}</td>
            <td class="r num">${U.fmt(Math.round(r.total / 56))}</td>
            <td class="r num ${ai.cls}">${ai.label}</td></tr>`;
          }).join('')}</tbody>
        </table></div>`;
    }
  }

  // 训练课类型统计：高级甜甜圈（渐变圆角分片 + 光晕底盘 + 中心汇总），悬停突出显示；支持 周期/运动员 筛选
  const PIE_COLORS = { '力量': UI.cssVar('var(--color-info)'), '技术': UI.cssVar('var(--color-accent)'), '体能': UI.cssVar('var(--color-warning)'), '恢复': UI.cssVar('var(--color-success)'), '比赛': UI.cssVar('var(--color-danger)'), '其他': UI.cssVar('var(--color-ink-muted)') };
  const pieColor = (t, i) => PIE_COLORS[t] || [UI.cssVar('var(--color-info)'), UI.cssVar('var(--color-accent)'), UI.cssVar('var(--color-warning)'), UI.cssVar('var(--color-success)'), UI.cssVar('var(--color-purple)'), UI.cssVar('var(--color-danger)')][i % 6];
  const shade = (hex, f) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${Math.round(((n >> 16) & 255) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`;
  };

  // 甜甜圈绘制（课次饼 / 时长饼共用）：线性渐变分片 + 微光晕底盘 + 中心总量 + 悬停放大阴影
  function drawSesDonut(box, items, name, total, totalLbl, tipFmt, labelFmt) {
    if (!box) return;
    const ch = UI.chart(box);
    const slices = items.map((d, i) => ({
      name: d.name, value: d.value,
      itemStyle: {
        color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: pieColor(d.name, i) }, { offset: 1, color: shade(pieColor(d.name, i), .55) }] },
        borderRadius: 6, borderColor: '#0d1420', borderWidth: 2
      }
    }));
    ch.setOption({
      title: { text: U.fmt(total), subtext: totalLbl, left: 'center', top: '38%',
        textStyle: { color: UI.cssVar('var(--color-ink)'), fontSize: 24, fontWeight: 700 }, subtextStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 } },
      tooltip: Object.assign({ trigger: 'item' }, UI.tooltipCommon, { formatter: tipFmt }),
      legend: { bottom: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 } },
      series: [
        { name: '底盘', type: 'pie', silent: true, z: 1, center: ['50%', '45%'], radius: ['43%', '64%'],
          label: { show: false }, labelLine: { show: false }, emphasis: { disabled: true }, select: { disabled: true },
          tooltip: { show: false }, data: [{ value: 1, itemStyle: { color: UI.tint('var(--color-ink-muted)', .09) } }] },
        { name, type: 'pie', z: 2, center: ['50%', '45%'], radius: ['44%', '62%'],
          label: { color: UI.cssVar('var(--color-ink)'), fontSize: 11, lineHeight: 16, formatter: labelFmt },
          labelLine: { length: 16, length2: 10, lineStyle: { color: UI.cssVar('var(--color-ink-muted)') } },
          emphasis: { scale: true, scaleSize: 12, itemStyle: { shadowBlur: 22, shadowOffsetY: 8, shadowColor: UI.tint('var(--color-background)', .55) } },
          data: slices }
      ]
    });
  }

  function renderSesPie(v) {
    const el = v.querySelector('#loadSes');
    if (!el) return;
    const aths = planAths();
    const { mesos, eligibleMicros } = planCycles();
    const micros = eligibleMicros;
    const selMicro = state.fltMicroId !== 'all' ? micros.find((x) => x.id === state.fltMicroId) : null;
    const selMeso = !selMicro && state.fltMesoId !== 'all' ? mesos.find((x) => x.id === state.fltMesoId) : null;
    const inRange = (s) => selMicro ? U.between(s.date, selMicro.startDate, selMicro.endDate)
      : selMeso ? U.between(s.date, selMeso.startDate, selMeso.endDate) : true;
    const activeAthleteIds = new Set(aths.map((a) => a.id));
    const athOk = (s) => state.mode === 'personal'
      ? (s.athletes || []).includes(state.athleteId)
      : (s.athletes || []).some((id) => activeAthleteIds.has(id)) &&
        (state.pieAthId === 'all' || (s.athletes || []).includes(state.pieAthId));
    const list = (Store.data.sessions || []).filter((s) => Store.hasCompletedLoad(s) && inRange(s) && athOk(s));
    const map = {};
    list.forEach((s) => { const t = s.type || '其他'; map[t] = (map[t] || 0) + 1; });
    const data = Object.keys(map).map((t, i) => ({ name: t, value: map[t], itemStyle: { color: pieColor(t, i) } })).sort((a, b) => b.value - a.value);
    // 时间比例：按课型累计训练时长（分钟），与课次饼同一套筛选
    const dmap = {};
    list.forEach((s) => { const t = s.type || '其他'; dmap[t] = (dmap[t] || 0) + (Number(s.duration) || 0); });
    const dData = Object.keys(dmap).map((t) => ({ name: t, value: Math.round(dmap[t]) })).filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
    const scopeLbl = selMicro ? selMicro.name : selMeso ? selMeso.name : '全部中周期';
    const whoLbl = state.mode === 'personal'
      ? (planAths().find((a) => a.id === state.athleteId) || {}).name || '—'
      : state.pieAthId === 'all' ? `全队 ${planAths().length} 人` : (planAths().find((a) => a.id === state.pieAthId) || {}).name || '—';
    const total = U.sum(data, (d) => d.value);
    const totalMin = U.sum(dData, (d) => d.value);
    el.innerHTML = `
      <div class="card-title"><h3>训练课类型统计${qTip('左图按课次：统计已完成训练课各课型（力量/技术/体能/恢复等）的节数与占比；右图按时长：统计各课型训练时长（分钟）与时间占比，时长取训练课填写的 duration 合计。两图共用周期/运动员筛选，悬停色块突出显示', refTxt('impellizzeri19', 'halson14'))}</h3>
        <span class="sub">${U.esc(whoLbl)} · ${U.esc(scopeLbl)}</span>
        <div class="row" style="gap:8px;align-items:center">
          ${state.mode === 'team' ? `<select class="sel" id="pieAth" style="width:130px">
            <option value="all">全部运动员</option>
            ${aths.map((a) => `<option value="${a.id}" ${state.pieAthId === a.id ? 'selected' : ''}>${U.esc(a.name)}</option>`).join('')}
          </select>` : ''}
          <select class="sel" id="pieMeso" style="width:150px">
            <option value="all">全部中周期</option>
              ${mesos.map((m) => `<option value="${m.id}" ${state.fltMesoId === m.id ? 'selected' : ''}>${U.esc(m.name)}</option>`).join('')}
          </select>
          <select class="sel" id="pieMicro" style="width:170px">
            <option value="all">全部小周期</option>
              ${micros.map((mi) => `<option value="${mi.id}" ${state.fltMicroId === mi.id ? 'selected' : ''}>${U.esc(mi.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      ${data.length ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 10px">
        <div class="chart-cap" style="justify-content:center">按课次分布<span class="ctx">共 ${total} 节</span></div>
        <div class="chart-cap" style="justify-content:center">按训练时长分布<span class="ctx">共 ${U.fmt(totalMin)} 分钟</span></div>
        <div class="chart" id="chSesPie" style="height:330px"></div>
        ${dData.length ? `<div class="chart" id="chSesTime" style="height:330px"></div>` : `<p class="hint" style="display:flex;align-items:center;justify-content:center;height:330px;margin:0;border:1px dashed var(--border);border-radius:8px">所选课程未填写时长，暂无时间分布。</p>`}
      </div>` : `<p class="hint" style="padding:8px 2px">该范围内暂无训练课。</p>`}`;
    const pieMesoSel = el.querySelector('#pieMeso');
    if (pieMesoSel) pieMesoSel.onchange = () => { state.fltMesoId = pieMesoSel.value; state.fltMicroId = 'all'; mount(); };
    const pieMicSel = el.querySelector('#pieMicro');
    if (pieMicSel) pieMicSel.onchange = () => { state.fltMicroId = pieMicSel.value; state.fltMesoId = 'all'; mount(); };
    const pieAthSel = el.querySelector('#pieAth');
    if (pieAthSel) pieAthSel.onchange = () => { state.pieAthId = pieAthSel.value; renderSesPie(v); };
    if (!data.length) return;
    drawSesDonut(el.querySelector('#chSesPie'), data, '课型', total, '总课数',
      (p) => `${p.marker}${p.name}：<b>${p.value}</b> 节课（占 ${p.percent}%）`, '{b}\n{d}%（{c} 节）');
    if (dData.length) drawSesDonut(el.querySelector('#chSesTime'), dData, '时长', totalMin, '总时长（分）',
      (p) => `${p.marker}${p.name}：<b>${p.value}</b> 分钟（占 ${p.percent}%）`, '{b}\n{d}%（{c} 分钟）');
  }

  // 板块标题：大分类色带 + 标题 + 说明问号
  function sectionHeader(title, tip) {
    return `<div class="sec-head"><span class="sec-bar"></span><h2 class="sec-title">${U.esc(title)}</h2>${tip ? qTip(tip) : ''}</div>`;
  }

  function renderDashboard(v) {
    const el = v.querySelector('#loadDashboard');
    if (!el) return;
    const macro = Store.activeMacro();
    const { mesos, micros } = planCycles();
    const aths = planAths();
    const today = U.today();
    if (!state.dateFrom) state.dateFrom = U.addDays(today, -41);
    if (!state.dateTo) state.dateTo = today;
    if (state.dateFrom > state.dateTo) [state.dateFrom, state.dateTo] = [state.dateTo, state.dateFrom];
    const meso = mesos.find((m) => m.id === state.fltMesoId);
    const availableMicros = meso ? micros.filter((mi) => mi.mesoId === meso.id) : micros;
    const selectedMicro = availableMicros.find((mi) => mi.id === state.fltMicroId);
    const cycleOptionLabel = (cycle) => {
      const dates = [cycle.startDate, cycle.endDate].filter(Boolean).map(U.md);
      return `${U.esc(cycle.name)}${dates.length ? ` · ${dates.join('–')}` : ''}`;
    };
    const dateFrom = state.dateFrom;
    const dateTo = state.dateTo;
    const actualTo = dateTo > today ? today : dateTo;
    const safeFrom = dateFrom;
    const hasActualRange = safeFrom <= actualTo;
    const athleteId = state.mode === 'personal' ? state.athleteId : null;
    const athleteIds = new Set(aths.map((a) => a.id));
    const sessions = (Store.data.sessions || []).filter((s) => hasActualRange &&
      s.date >= safeFrom && s.date <= actualTo && Store.hasCompletedLoad(s) &&
      (state.mode === 'personal'
        ? (s.athletes || []).includes(athleteId)
        : (s.athletes || []).some((id) => athleteIds.has(id))));
    const entries = state.mode === 'personal' ? entriesOf(athleteId) : teamEntries();
    const historyFrom = U.addDays(safeFrom, -84);
    const series = hasActualRange ? Calc.dailySeries(entries, historyFrom, actualTo) : [];
    const ctl = Calc.ewma(series, 42);
    const atl = Calc.ewma(series, 7);
    const hasInternalLoadData = entries.some((entry) => entry.date >= historyFrom && entry.date <= actualTo && (Number(entry.load) || 0) > 0);
    const visible = series.map((point, i) => ({ point, i })).filter(({ point }) => point.date >= safeFrom && point.date <= actualTo);
    const dates = visible.map(({ point }) => point.date);
    const ctlVisible = visible.map(({ i }) => ctl[i].value);
    const atlVisible = visible.map(({ i }) => atl[i].value);
    const acwrVisible = visible.map(({ i }) => ctl[i].value > 0 ? atl[i].value / ctl[i].value : null);
    const tsbVisible = visible.map(({ i }) => hasInternalLoadData ? ctl[i].value - atl[i].value : null);
    const last = series.length - 1;
    const currentCtl = ctl[last] ? ctl[last].value : 0;
    const currentAtl = atl[last] ? atl[last].value : 0;
    const currentAcwrValue = currentCtl > 0 ? currentAtl / currentCtl : null;
    const currentAcwr = Number.isFinite(currentAcwrValue) ? currentAcwrValue : null;
    const currentTsbValue = hasInternalLoadData ? currentCtl - currentAtl : null;
    const currentTsb = Number.isFinite(currentTsbValue) ? currentTsbValue : null;
    const dose = hasActualRange ? Store.rangeActualDose(safeFrom, actualTo, athleteId) : emptyDose();
    const doseSeries = hasActualRange ? Store.dailyDoseSeries(safeFrom, actualTo, athleteId) : [];
    const auTotal = U.sum(visible, ({ point }) => Number(point.load) || 0);
    const sessionCounts = {};
    const typeCounts = {};
    const typeMinutes = {};
    let courseMinutes = 0;
    sessions.forEach((s) => {
      sessionCounts[s.date] = (sessionCounts[s.date] || 0) + 1;
      const type = s.type || '其他';
      typeCounts[type] = (typeCounts[type] || 0) + 1;
      const minutes = Number(s.duration) || 0;
      typeMinutes[type] = (typeMinutes[type] || 0) + minutes;
      courseMinutes += minutes;
    });
    const countByType = Object.entries(typeCounts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    const timeByType = Object.entries(typeMinutes).map(([name, value]) => ({ name, value: Math.round(value) })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
    const dateLabels = dates;
    const activeCycle = selectedMicro ? selectedMicro.name : meso ? meso.name : '全部周期';
    const scopeName = state.mode === 'personal' ? (aths.find((a) => a.id === athleteId) || {}).name || '未选择运动员' : `当前计划全队 ${aths.length} 人`;
    const acwrMeta = acwrInfo(currentAcwr);
    const tsbMeta = currentTsb == null ? { desc: '数据不足', cls: '' } : tsbState(currentTsb);
    const metricHelp = {
      au: '筛选范围内的内部负荷总量。单条负荷记录优先读取 load；缺失时用 RPE × 时长（分钟）计算，按日期累加。AU 是无量纲内部负荷单位，用于同一运动员观察训练压力变化，不宜跨运动员直接比较。',
      acwr: '急慢性负荷比。算法：ATL（7 日 EWMA）÷ CTL（42 日 EWMA），取筛选结束日；系列从筛选开始日前 84 天预热。0.8–1.3 是部分队列研究常用的监控区间，不是适用于所有运动员的安全阈值，也不能单独预测损伤。',
      tsb: '训练压力平衡。算法：TSB = CTL（42 日 EWMA）− ATL（7 日 EWMA），取筛选结束日。正值表示近期 ATL 低于长期 CTL，通常解读为相对新鲜；负值表示近期负荷高于慢性基线，通常解读为疲劳累积。它是训练状态模型指标，不是直接的竞技表现测量。',
      tonnage: '筛选范围内已完课力量动作吨位：逐运动员、逐动作行汇总重量 × 完成次数，再将 kg 换算为 t。逐组实际记录优先；缺少实际剂量时，已完课训练会回退到保存的计划剂量。不同动作的吨位不能代表完全相同的生理刺激。',
      sessions: '筛选范围内已完课训练课记录数；每条训练课记录计 1 节，团队训练不会因参训人数重复计数。类型数量来自 session.type，缺失类型归为“其他”。用于观察训练频率与课型覆盖，不代表训练质量。',
      courseTime: '筛选范围内已完课训练课的课程时长总和：Σ session.duration，按分钟存储并换算为小时显示。训练类型时间占比也使用此字段；未填写时长的课程仍计入课次，但不贡献时长占比。',
      distance: '筛选范围内已完课训练课中距离量纲动作的完成距离总和，按米汇总并换算为 km。实际逐组数据优先，缺失时回退保存的计划剂量；反映距离体量，不含速度或强度信息。',
      work: '筛选范围内已完课训练课中时间量纲动作的做功时间总和：Σ 实际完成秒数，换算为分钟显示。包含动作本身的工作时间，不等于课程总时长，也不包含课程里未记为时间量纲动作的休息时间。'
    };
    const metric = (title, value, unit, note, cls = '', help = '', references = '') => `<div class="load-metric ${cls}"><div class="k">${title}${help ? qTip(help, references) : ''}</div><div class="v">${value}<small>${unit}</small></div><div class="d">${note}</div></div>`;

    el.innerHTML = `
      <div class="load-filterbar" id="loadFilters">
        <div class="load-date-range">
          <div class="field"><label for="loadDateFrom">开始日期</label><input class="ipt" id="loadDateFrom" type="date" value="${dateFrom}"></div>
          <span class="load-filter-separator">至</span>
          <div class="field"><label for="loadDateTo">结束日期</label><input class="ipt" id="loadDateTo" type="date" value="${dateTo}"></div>
        </div>
        <div class="field"><label for="loadMesoFilter">中周期</label><select class="sel" id="loadMesoFilter"><option value="all">全部中周期</option>${mesos.map((m) => `<option value="${m.id}" ${m.id === state.fltMesoId ? 'selected' : ''}>${cycleOptionLabel(m)}</option>`).join('')}</select></div>
        <div class="field"><label for="loadMicroFilter">小周期</label><select class="sel" id="loadMicroFilter"><option value="all">全部小周期</option>${availableMicros.map((mi) => `<option value="${mi.id}" ${mi.id === state.fltMicroId ? 'selected' : ''}>${cycleOptionLabel(mi)}</option>`).join('')}</select></div>
        <div class="load-filter-context">${U.esc(scopeName)}<span>${U.esc(activeCycle)} · ${U.md(dateFrom)} — ${U.md(dateTo)}</span></div>
      </div>
      <div class="load-metric-grid">
        ${metric('AU · 内部负荷总量', U.fmt(Math.round(auTotal)), 'AU', '筛选范围累积', '', metricHelp.au, refTxt('foster01', 'impellizzeri19'))}
        ${metric('ACWR · 急慢性比', acwrMeta.label, '', `${acwrMeta.desc} · 截止 ${U.md(actualTo)}`, acwrMeta.cls, metricHelp.acwr, refTxt('hulin14', 'gabbett16', 'impellizzeri20'))}
        ${metric('TSB · 训练压力平衡', currentTsb == null ? '—' : U.fmt(Math.round(currentTsb)), currentTsb == null ? '' : 'AU/日', `${tsbMeta.desc} · CTL − ATL`, tsbMeta.cls, metricHelp.tsb, refTxt('banister91', 'coggan', 'skiba13'))}
        ${metric('训练吨位', U.fmt(Math.round(dose.kg / 100) / 10, 1), 't', `${U.fmt(Math.round(dose.kg))} kg`, '', metricHelp.tonnage, refTxt('impellizzeri19', 'halson14'))}
        ${metric('训练课次', U.fmt(sessions.length), '节', `${Object.keys(typeCounts).length} 种课型`, '', metricHelp.sessions, refTxt('foster01', 'halson14'))}
        ${metric('训练时长', U.fmt(Math.round(courseMinutes / 6) / 10, 1), 'h', `${U.fmt(Math.round(courseMinutes))} min`, '', metricHelp.courseTime, refTxt('halson14'))}
        ${metric('训练距离', U.fmt(dose.m / 1000, 1), 'km', `${U.fmt(Math.round(dose.m))} m`, '', metricHelp.distance, refTxt('halson14', 'impellizzeri19'))}
        ${metric('动作做功时间', U.fmt(dose.s / 60, 1), 'min', `${U.fmt(Math.round(dose.s))} s`, '', metricHelp.work, refTxt('halson14'))}
      </div>
      <div class="load-chart-grid">
        <section class="card load-chart-panel"><div class="card-title"><h3>AU 内部负荷看板${qTip('柱形为每日内部负荷 AU：Σ 当日每人 RPE × 训练时长（分钟）；折线为 ATL：7 日 EWMA，反映近期负荷变化。AU 是个体内部负荷指标，主要用于观察个人或同队趋势。', refTxt('foster01', 'impellizzeri19'))}</h3><span class="sub">每日 AU · ATL 7 日 EWMA</span></div><div class="chart" id="loadDailyChart" role="img" aria-label="每日内部负荷与 ATL 趋势"></div></section>
        <section class="card load-chart-panel"><div class="card-title"><h3>ACWR 与 TSB 趋势${qTip(metricHelp.acwr + ' TSB = CTL(42 日 EWMA) − ATL(7 日 EWMA)，正值通常表示相对新鲜，负值表示近期负荷高于慢性基线。区间只作训练监控参考。', refTxt('hulin14', 'gabbett16', 'impellizzeri20', 'banister91', 'coggan'))}</h3><span class="sub">ACWR 0.8–1.3 为文献常见参考范围</span></div><div class="chart" id="loadRiskChart" role="img" aria-label="ACWR 与 TSB 趋势"></div></section>
        <section class="card load-chart-panel"><div class="card-title"><h3>ACWR 指针看板${qTip(metricHelp.acwr, refTxt('hulin14', 'gabbett16', 'impellizzeri20'))}</h3><span class="sub">筛选结束日</span></div><div class="chart" id="loadAcwrGauge" role="img" aria-label="急慢性负荷比 ACWR 指针仪表"></div></section>
        <section class="card load-chart-panel"><div class="card-title"><h3>TSB 指针看板${qTip(metricHelp.tsb, refTxt('banister91', 'coggan', 'skiba13'))}</h3><span class="sub">筛选结束日</span></div><div class="chart" id="loadTsbGauge" role="img" aria-label="训练压力平衡 TSB 指针仪表"></div></section>
        <section class="card load-chart-panel"><div class="card-title"><h3>吨位变化${qTip(metricHelp.tonnage, refTxt('impellizzeri19', 'halson14'))}</h3><span class="sub">t / 日</span></div><div class="chart" id="loadTonnageChart" role="img" aria-label="每日吨位"></div></section>
        <section class="card load-chart-panel"><div class="card-title"><h3>训练课次与类型${qTip(metricHelp.sessions, refTxt('foster01', 'halson14'))}</h3><span class="sub">已完成训练课</span></div><div class="chart" id="loadSessionChart" role="img" aria-label="每日训练课次"></div></section>
        <section class="card load-chart-panel"><div class="card-title"><h3>训练课类型分布${qTip('按训练课的 session.type 分组，每节已完课记录计 1 节；环图比例 = 该类型课次 ÷ 所选范围全部课次。用于观察课型结构，不代表训练负荷大小。', refTxt('halson14', 'impellizzeri19'))}</h3><span class="sub">按课次占比</span></div><div class="chart load-donut" id="loadTypeChart" role="img" aria-label="训练课类型课次占比"></div></section>
        <section class="card load-chart-panel"><div class="card-title"><h3>训练类型时间占比${qTip(metricHelp.courseTime + ' 分类型占比算法：某类型的 Σ session.duration ÷ 所有类型的 Σ session.duration。', refTxt('halson14', 'impellizzeri19'))}</h3><span class="sub">课程时长 · min</span></div><div class="chart load-donut" id="loadTypeTimeChart" role="img" aria-label="训练课类型时间占比"></div></section>
        <section class="card load-chart-panel"><div class="card-title"><h3>训练距离${qTip(metricHelp.distance, refTxt('halson14', 'impellizzeri19'))}</h3><span class="sub">km / 日</span></div><div class="chart" id="loadDistanceChart" role="img" aria-label="每日训练距离"></div></section>
        <section class="card load-chart-panel"><div class="card-title"><h3>动作做功时间${qTip(metricHelp.work, refTxt('halson14'))}</h3><span class="sub">min / 日</span></div><div class="chart" id="loadWorkTimeChart" role="img" aria-label="每日动作做功时间"></div></section>
      </div>`;

    const applyDateRange = () => {
      state.dateFrom = el.querySelector('#loadDateFrom').value || today;
      state.dateTo = el.querySelector('#loadDateTo').value || today;
      if (state.dateFrom > state.dateTo) state.dateTo = state.dateFrom;
      state.fltMesoId = 'all';
      state.fltMicroId = 'all';
      mount(v);
    };
    el.querySelector('#loadDateFrom').onchange = applyDateRange;
    el.querySelector('#loadDateTo').onchange = applyDateRange;
    el.querySelector('#loadMesoFilter').onchange = (event) => {
      state.fltMesoId = event.target.value;
      state.fltMicroId = 'all';
      const selected = mesos.find((m) => m.id === state.fltMesoId) || macro;
      if (selected) { state.dateFrom = selected.startDate; state.dateTo = selected.endDate; }
      mount(v);
    };
    el.querySelector('#loadMicroFilter').onchange = (event) => {
      state.fltMicroId = event.target.value;
      const selected = availableMicros.find((mi) => mi.id === state.fltMicroId);
      if (selected) {
        state.fltMesoId = selected.mesoId;
        state.dateFrom = selected.startDate;
        state.dateTo = selected.endDate;
      } else {
        const selectedMeso = mesos.find((m) => m.id === state.fltMesoId) || macro;
        if (selectedMeso) { state.dateFrom = selectedMeso.startDate; state.dateTo = selectedMeso.endDate; }
      }
      mount(v);
    };

    const commonAxis = UI.axisCommon;
    const labelsAxis = { type: 'category', data: dateLabels, axisLabel: Object.assign({}, commonAxis.axisLabel, { interval: 'auto', formatter: (value) => U.md(value), rotate: dates.length > 90 ? 35 : 0 }) };
    const baseGrid = { left: 48, right: 20, top: 34, bottom: dates.length > 90 ? 54 : 30 };
    const axisTooltip = (ps, suffix) => {
      const p = ps && ps[0];
      if (!p) return '';
      return `${U.md(dates[p.dataIndex])}<br/>${ps.map((item) => `${item.marker}${item.seriesName}：<b>${U.fmt(item.value || 0)}</b> ${suffix(item.seriesName)}`).join('<br/>')}`;
    };
    const dailyChart = UI.chart(el.querySelector('#loadDailyChart'));
    dailyChart.setOption({ grid: baseGrid, tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon, { formatter: (ps) => axisTooltip(ps, () => 'AU') }), legend: { top: 0, textStyle: { color: UI.cssVar('var(--color-ink-muted)') } }, xAxis: labelsAxis, yAxis: Object.assign({ type: 'value', name: 'AU' }, commonAxis), series: [
      { name: '每日负荷', type: 'bar', data: visible.map(({ point }) => point.load), barMaxWidth: 16, itemStyle: { color: UI.tint('var(--color-info)', .68), borderRadius: [3, 3, 0, 0] } },
      { name: 'ATL', type: 'line', data: atlVisible, smooth: true, showSymbol: false, lineStyle: { color: UI.cssVar('var(--color-warning)'), width: 2.5 } }
    ] });

    const riskChart = UI.chart(el.querySelector('#loadRiskChart'));
    riskChart.setOption({ grid: baseGrid, tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon, { formatter: (ps) => axisTooltip(ps, (name) => name === 'TSB' ? 'AU/日' : '') }), legend: { top: 0, textStyle: { color: UI.cssVar('var(--color-ink-muted)') } }, xAxis: labelsAxis, yAxis: [
      Object.assign({ type: 'value', name: 'ACWR', min: 0 }, commonAxis),
      Object.assign({ type: 'value', name: 'TSB', splitLine: { show: false } }, commonAxis)
    ], series: [
      { name: 'ACWR', type: 'line', data: acwrVisible, smooth: true, showSymbol: false, lineStyle: { color: UI.cssVar('var(--color-accent)'), width: 2.5 }, markArea: { silent: true, itemStyle: { color: UI.tint('var(--color-success)', .09) }, data: [[{ yAxis: .8 }, { yAxis: 1.3 }]] }, markLine: { silent: true, symbol: 'none', lineStyle: { color: UI.cssVar('var(--color-danger)'), type: 'dashed' }, data: [{ yAxis: 1.5 }] } },
      { name: 'TSB', type: 'line', yAxisIndex: 1, data: tsbVisible, smooth: true, showSymbol: false, lineStyle: { color: UI.cssVar('var(--color-info)'), width: 2 } }
    ] });

    const renderPointerGauge = (id, value, range, bands, info, digits, unit) => {
      const chart = UI.chart(el.querySelector('#' + id));
      const gaugeValue = value == null ? range.min : Math.max(range.min, Math.min(range.max, value));
      const valueLabel = value == null ? '—' : digits === 2 ? value.toFixed(2) : String(Math.round(value));
      chart.setOption({
        tooltip: Object.assign({ trigger: 'item', formatter: () => `${id === 'loadAcwrGauge' ? 'ACWR' : 'TSB'}：<b>${valueLabel}</b>${unit ? ` ${unit}` : ''} · ${info.desc}` }, UI.tooltipCommon),
        series: [{
          type: 'gauge', min: range.min, max: range.max,
          startAngle: 205, endAngle: -25, radius: '72%', center: ['50%', '55%'],
          splitNumber: Math.max(1, Math.round((range.max - range.min) / (digits === 2 ? .5 : 25))),
          axisLine: { lineStyle: { width: 20, color: gaugeStops(range.min, range.max, bands) } },
          pointer: { show: value != null, width: 5, length: '62%', itemStyle: { color: UI.cssVar('var(--color-ink)') } },
          anchor: { show: true, size: 12, itemStyle: { color: UI.cssVar('var(--color-surface)'), borderColor: UI.cssVar('var(--color-ink)'), borderWidth: 2 } },
          axisTick: { distance: 0, length: 5, lineStyle: { color: UI.cssVar('var(--color-ink-muted)') } },
          splitLine: { distance: 0, length: 12, lineStyle: { color: UI.cssVar('var(--color-ink-muted)') } },
          axisLabel: { distance: 8, color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, formatter: (n) => digits === 2 ? (+n.toFixed(1)).toString() : String(Math.round(n)) },
          title: { show: false },
          detail: {
            valueAnimation: true, offsetCenter: [0, '68%'],
            formatter: () => value == null ? `{val|—}\n{desc|数据不足}` : `{val|${valueLabel}}\n{desc|${info.desc}}`,
            rich: {
              val: { color: info.color || UI.cssVar('var(--color-ink-muted)'), fontSize: 25, fontWeight: 700, padding: [2, 8] },
              desc: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11, padding: [4, 0, 0, 0] }
            }
          },
          data: [{ value: gaugeValue, name: id === 'loadAcwrGauge' ? 'ACWR' : 'TSB' }]
        }]
      });
    };
    const acwrGaugeRange = acwrRange(currentAcwr);
    const tsbGaugeRange = tsbRange(currentTsb || 0);
    renderPointerGauge('loadAcwrGauge', currentAcwr, acwrGaugeRange, ACWR_BANDS(acwrGaugeRange.max), acwrMeta, 2, '');
    renderPointerGauge('loadTsbGauge', currentTsb, tsbGaugeRange, TSB_BANDS(tsbGaugeRange.max), tsbMeta, 0, 'AU/日');

    const byDate = new Map(doseSeries.map((d) => [d.date, d]));
    const chartValues = (key, divisor) => dates.map((date) => {
      const value = Number((byDate.get(date) || {})[key]);
      return Number.isFinite(value) ? value / divisor : 0;
    });
    const drawDailyBar = (id, data, unit, color, axisName = unit) => {
      const chart = UI.chart(el.querySelector('#' + id));
      chart.setOption({ grid: baseGrid, tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon, { formatter: (ps) => axisTooltip(ps, () => unit) }), xAxis: labelsAxis, yAxis: Object.assign({ type: 'value', name: axisName }, commonAxis), series: [{ type: 'bar', name: axisName, data, barMaxWidth: 18, itemStyle: { color, borderRadius: [3, 3, 0, 0] } }] });
    };
    drawDailyBar('loadTonnageChart', chartValues('kg', 1000), 't', UI.cssVar('var(--color-success)'), 't');
    drawDailyBar('loadDistanceChart', chartValues('m', 1000), 'km', UI.cssVar('var(--color-info)'), 'km');
    drawDailyBar('loadWorkTimeChart', chartValues('s', 60), 'min', '#4fd6e0', 'min');
    const sessionChart = UI.chart(el.querySelector('#loadSessionChart'));
    sessionChart.setOption({ grid: baseGrid, tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon, { formatter: (ps) => axisTooltip(ps, () => '节') }), xAxis: labelsAxis, yAxis: Object.assign({ type: 'value', name: '节', minInterval: 1 }, commonAxis), series: [{ type: 'bar', name: '训练课次', data: dates.map((date) => sessionCounts[date] || 0), barMaxWidth: 18, itemStyle: { color: UI.cssVar('var(--color-warning)'), borderRadius: [3, 3, 0, 0] } }] });

    const drawShare = (id, data, total, unit) => {
      const chart = UI.chart(el.querySelector('#' + id));
      chart.setOption({
        title: { text: U.fmt(total), subtext: unit, left: 'center', top: '40%', textStyle: { color: UI.cssVar('var(--color-ink)'), fontSize: 23, fontWeight: 700 }, subtextStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 } },
        tooltip: Object.assign({ trigger: 'item', formatter: (p) => `${p.marker}${p.name}：<b>${U.fmt(p.value)}</b> ${unit}（${p.percent}%）` }, UI.tooltipCommon),
        legend: { type: 'scroll', bottom: 0, textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 } },
        graphic: data.length ? [] : [{ type: 'text', left: 'center', top: '72%', style: { text: '暂无已完成训练课', fill: UI.cssVar('var(--color-ink-muted)'), fontSize: 12 } }],
        series: [{ type: 'pie', radius: ['43%', '68%'], center: ['50%', '46%'], avoidLabelOverlap: true, itemStyle: { borderRadius: 5, borderColor: UI.cssVar('var(--color-surface)'), borderWidth: 2 }, label: { color: UI.cssVar('var(--color-ink)'), formatter: '{b}\n{d}%' }, data: data.map((item, i) => ({ ...item, itemStyle: { color: pieColor(item.name, i), borderRadius: 5, borderColor: UI.cssVar('var(--color-surface)'), borderWidth: 2 } })) }]
      });
    };
    drawShare('loadTypeChart', countByType, sessions.length, '节');
    drawShare('loadTypeTimeChart', timeByType, Math.round(courseMinutes), 'min');

    const metricBox = el.querySelector('.load-metric-grid');
    metricBox.dataset.rangeStart = safeFrom;
    metricBox.dataset.rangeEnd = actualTo;
  }

  function mount(v) {
    if (v == null) v = $('#view');
    UI.disposeCharts();
    if (state.mode === 'personal') {
      if (!state.athleteId || !planAths().find((a) => a.id === state.athleteId)) {
        state.athleteId = planAths()[0] ? planAths()[0].id : null;
      }
    }
    v.innerHTML = `
      <div class="card" id="loadHead"></div>
      <div id="loadDashboard"></div>`;
    renderHead(v);
    renderDashboard(v);
    // 指标问号点击 → 弹出说明与计算方法（事件委托，覆盖 KPI 卡/仪表盘/周分析所有问号）
    v.onclick = (e) => {
      const q = e.target.closest('.qmark');
      if (!q) return;
      UI.modal({
        title: '指标说明',
        body: `<p style="line-height:1.9;margin:0">${U.esc(q.dataset.tip)}</p>`,
        footer: `<button class="btn primary" data-x>知道了</button>`
      });
    };
  }

  // 实时分析：任意数据变更（手动录入/课后更新/保存）触发 Store.save → rev++ → 通知 → 负荷看板自动重算重绘
  Store.subscribe(() => {
    if (location.hash.replace('#/', '') !== 'load') return;
    const view = $('#view');
    if (view && view.querySelector('#loadHead')) mount(view);
  });

  return { mount };
})();
