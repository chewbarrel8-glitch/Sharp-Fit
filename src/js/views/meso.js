// 中周期页面：训练规划（计划模式，不含实际完成/RIR——课后数据在训练课页按运动员填写）
Views.meso = (() => {
  const state = { mesoId: null, day: null, microId: null, cycleId: 'all' };

  // 大周期 → 配色色相（按出现顺序循环：蓝/琥珀/绿/紫/品红，与周期总表一致）
  const CYC_HUES = [210, 32, 150, 265, 330];

  function mesoDialog(meso) {
    const mac = Store.activeMacro();
    UI.modal({
      title: meso ? '编辑中周期' : '新建中周期',
      body: `
        <div class="form-grid">
          <div class="field full"><label>名称</label><input class="ipt" id="fName" value="${U.esc(meso ? meso.name : '')}"></div>
          <div class="field"><label>类型</label><input class="ipt" id="fType" value="${U.esc(meso ? meso.type : '积累')}"></div>
          <div class="field"><label>所属大周期</label><input class="ipt" value="${U.esc(mac ? mac.name : '—')}" disabled></div>
          <div class="field"><label>开始日期</label><input type="date" class="ipt" id="fStart" value="${meso ? meso.startDate : (mac ? mac.startDate : U.today())}"></div>
          <div class="field"><label>结束日期</label><input type="date" class="ipt" id="fEnd" value="${meso ? meso.endDate : (mac ? U.addDays(mac.startDate, 27) : U.addDays(U.today(), 27))}"></div>
        </div>`,
      footer: `${meso ? '<button class="btn danger" data-del>删除</button>' : ''}<button class="btn ghost" data-x>取消</button><button class="btn primary" data-ok>保存</button>`,
      onMount(ov, close) {
        ov.querySelector('[data-ok]').onclick = () => {
          const name = ov.querySelector('#fName').value.trim();
          if (!name) { UI.toast('请填写名称', 'err'); return; }
          const obj = meso || { id: U.uid('mes'), macroId: mac ? mac.id : null, days: [] };
          Object.assign(obj, {
            name, type: ov.querySelector('#fType').value.trim() || '积累',
            startDate: ov.querySelector('#fStart').value,
            endDate: ov.querySelector('#fEnd').value
          });
          if (obj.startDate > obj.endDate) { UI.toast('结束日期需晚于开始日期', 'err'); return; }
          if (!meso) Store.data.mesos.push(obj);
          Store.save(); close(); mount(); UI.toast('已保存', 'ok');
        };
        const del = ov.querySelector('[data-del]');
        if (del) del.onclick = () => UI.confirm(`删除中周期「${U.esc(meso.name)}」？关联小周期将一并删除。`, () => {
          Store.data.micros = Store.data.micros.filter((m) => m.mesoId !== meso.id);
          Store.data.mesos = Store.data.mesos.filter((m) => m.id !== meso.id);
          state.mesoId = null; Store.save(); close(); mount(); UI.toast('已删除中周期', 'ok');
        });
      }
    });
  }

  function renderList(v) {
    const mac = Store.activeMacro();
    const el = v.querySelector('#mesoList');
    if (!mac) { el.innerHTML = ''; return; }
    const cycles = (mac.cycles || []).slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
    const allMesos = Store.mesosOf(mac.id);
    // 选中的大周期已被删除时回到「全部」
    if (state.cycleId !== 'all' && !cycles.some((c) => c.id === state.cycleId)) state.cycleId = 'all';
    const selCyc = cycles.find((c) => c.id === state.cycleId) || null;
    const mesos = selCyc ? allMesos.filter((m) => U.between(m.startDate, selCyc.startDate, selCyc.endDate)) : allMesos;
    const cycChip = (c, i) => {
      const n = allMesos.filter((m) => U.between(m.startDate, c.startDate, c.endDate)).length;
      const compN = (mac.compDates || []).filter((x) => x.date >= c.startDate && x.date <= c.endDate).length;
      return `<div class="cyc-chip ${state.cycleId === c.id ? 'active' : ''}" data-cyc="${c.id}" style="--cyc:${CYC_HUES[i % CYC_HUES.length]}"
        title="${U.md(c.startDate)} — ${U.md(c.endDate)} · ${n} 个中周期${compN ? ' · ' + compN + ' 个比赛日' : ''}（点击查看该大周期的中周期）">
        <span class="cyc-dot"></span><b>${U.esc(c.name)}</b><span class="hint">${U.md(c.startDate)}–${U.md(c.endDate)} · ${n} 个中周期</span><span class="cyc-edit" data-cyedit="${c.id}" title="编辑 / 删除大周期">✎</span>
      </div>`;
    };
    el.innerHTML = `
      <div class="card-title"><h3>大周期 · 中周期</h3><div class="row"><span class="sub">${U.esc(mac.name)}</span><button class="btn sm" id="cycAdd">＋ 新建大周期</button><button class="btn sm primary" id="mesoAdd">＋ 新建中周期</button></div></div>
      <div class="cyc-strip">
        <div class="cyc-chip ${state.cycleId === 'all' ? 'active' : ''}" data-cyc="all" title="显示当前训练计划中的全部中周期">
          <span class="cyc-dot" style="background:var(--dim)"></span><b>全部</b><span class="hint">${allMesos.length} 个中周期</span>
        </div>
        ${cycles.map(cycChip).join('')}
      </div>
      <div class="top-list" style="margin-top:10px">
      ${mesos.map((m) => {
        // 实际外部负荷（三量纲）：只统计本中周期日期范围内已完成训练课，未填实际完成不计
        const actD = { kg: 0, m: 0, s: 0 };
        for (const ses of Store.data.sessions) {
          if (ses.date < m.startDate || ses.date > m.endDate) continue;
          const d = Store.sessionActualDose(ses, null, { actualOnly: true });
          actD.kg += d.kg; actD.m += d.m; actD.s += d.s;
        }
        const micN = Store.microsOf(m.id).length;
        const actChips = [
          actD.kg ? `${U.fmt(actD.kg / 1000, 1)} t` : '',
          actD.m ? `${U.fmt(Math.round(actD.m / 100) / 10, 1)} km` : '',
          actD.s ? `${U.fmt(Math.round(actD.s / 6) / 10, 1)} min` : ''
        ].filter(Boolean);
        return `
        <div class="day-chip top-item ${state.mesoId === m.id ? 'active' : ''}" data-id="${m.id}">
          <div class="d2">${U.esc(m.name)}</div>
          <div class="d1">${U.md(m.startDate)} — ${U.md(m.endDate)} · ${U.esc(m.type)}</div>
          <div class="row" style="justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap"><span class="row" style="gap:4px;flex-wrap:wrap">${actChips.length ? actChips.map((t) => `<span class="chip volt" title="已完成训练课实际外部负荷（实际完成口径）">${t}</span>`).join('') : '<span class="chip">实际负荷未填</span>'}</span><span class="hint">${micN ? micN + ' 个小周期' : '未划分'}</span></div>
        </div>`;
      }).join('') || `<p class="hint">${selCyc ? '该大周期下尚未安排中周期，点击右上角「＋ 新建中周期」' : '暂无中周期'}</p>`}
      </div>`;
    // 点击大周期 → 筛选出该大周期内规划的中周期
    $$('.cyc-chip[data-cyc]', el).forEach((c) => {
      c.onclick = (e) => {
        if (e.target.closest('[data-cyedit]')) return;
        state.cycleId = c.dataset.cyc;
        mount();
      };
    });
    // ✎ 编辑/删除大周期（共用周期总表的大周期弹窗，保存后自动重挂本页）
    $$('[data-cyedit]', el).forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        Views.macro.openCycle(mac, (mac.cycles || []).find((x) => x.id === b.dataset.cyedit));
      };
    });
    el.querySelector('#cycAdd').onclick = () => Views.macro.openCycle(mac, null);
    $$('.day-chip[data-id]', el).forEach((c) => {
      c.onclick = () => { state.mesoId = c.dataset.id; state.day = null; state.microId = null; state.weekIdx = null; mount(); };
    });
    el.querySelector('#mesoAdd').onclick = () => mesoDialog(null);
  }

  // ---------- 小周期：新建（自定义天数）/ 自动划分 ----------
  function microDialogMeso(meso) {
    UI.modal({
      title: '新建小周期',
      body: `
        <div class="form-grid">
          <div class="field full"><label>名称</label><input class="ipt" id="miName"></div>
          <div class="field"><label>开始日期</label><input type="date" class="ipt" id="miStart" value="${state.day || meso.startDate}"></div>
          <div class="field"><label>天数</label><input type="number" class="ipt" id="miDays" min="1" max="28" value="7"></div>
          <div class="field full"><label>目标负荷（AU，可选）</label><input type="number" class="ipt" id="miTarget"></div>
          <div class="field full"><span class="hint">小周期天数自行设定（常见 3-10 天），结束日期 = 开始日期 + 天数 − 1；创建后可点击小周期进入「小周期」页面安排每日训练</span></div>
        </div>`,
      footer: `<button class="btn ghost" data-x>取消</button><button class="btn primary" data-ok>保存</button>`,
      onMount(ov, close) {
        ov.querySelector('[data-ok]').onclick = () => {
          const name = ov.querySelector('#miName').value.trim() || '未命名小周期';
          const s = ov.querySelector('#miStart').value;
          if (!s) { UI.toast('请选择开始日期', 'err'); return; }
          const days = Math.max(1, Number(ov.querySelector('#miDays').value) || 7);
          Store.data.micros.push({
            id: U.uid('mic'), mesoId: meso.id, name, startDate: s, endDate: U.addDays(s, days - 1),
            targetLoad: Number(ov.querySelector('#miTarget').value) || null, days: []
          });
          Store.save(); close(); mount(); UI.toast('小周期已创建', 'ok');
        };
      }
    });
  }

  function autoSplitMicros(meso) {
    UI.modal({
      title: '按天数自动划分小周期',
      body: `
        <div class="field"><label>每个小周期的天数</label><input type="number" class="ipt" id="spDays" min="1" max="28" value="7"></div>
        <p class="hint">将「${U.esc(meso.name)}」按固定天数依次划分，已有小周期将被清除</p>`,
      footer: `<button class="btn ghost" data-x>取消</button><button class="btn primary" data-ok>划分</button>`,
      onMount(ov, close) {
        ov.querySelector('[data-ok]').onclick = () => {
          const len = Math.max(1, Number(ov.querySelector('#spDays').value) || 7);
          Store.data.micros = Store.data.micros.filter((m) => m.mesoId !== meso.id);
          let cur = meso.startDate, i = 1;
          while (cur <= meso.endDate) {
            let end = U.addDays(cur, len - 1);
            if (end > meso.endDate) end = meso.endDate;
            Store.data.micros.push({ id: U.uid('mic'), mesoId: meso.id, name: `第 ${i} 段`, startDate: cur, endDate: end, targetLoad: null, days: [] });
            cur = U.addDays(end, 1); i++;
          }
          Store.save(); close(); mount(); UI.toast(`已按 ${len} 天划分 ${i - 1} 个小周期`, 'ok');
        };
      }
    });
  }

  // 训练课类别 → KPI 配色
  const TYPE_KPI = { '力量': 'ok', '爆发/速度': 'info', '体能': 'warn', '测试': 'bad', '比赛': 'bad', '技术战术': 'info', '恢复再生': 'ok', '休息': '' };

  // ---------- 计划映射：中周期当日课程 → 小周期页展示 + 训练课页课程 ----------
  // 自动映射：课程保存/修改时自动同步（无需手动按钮）；幂等按 planKey（mesoId:date[:courseId]）
  // 课程 planKey 规则：无 id 的兼容课程（旧数据首课程）= mesoId:date；新课程 = mesoId:date:courseId
  // 课型细类（扁平化，来源于七大训练模块 Store.TRAIN_MODULES；供小周期日类型兼容判断）
  const SES_TYPES = Store.TRAIN_MODULES.flatMap((m) => m.types);
  const courseKey = (meso, date, course) => meso.id + ':' + date + (course.id ? ':' + course.id : '');
  const sesHasActual = (ses) => Store.sessionHasActual(ses);
  function mapTarget(meso, date, course) {
    if (!course || !(course.rows || []).length) return null;
    const mic = Store.data.micros.find((m) => m.mesoId === meso.id && U.between(date, m.startDate, m.endDate));
    const micDay = mic ? (mic.days || []).find((x) => x.date === date) : null;
    const key = courseKey(meso, date, course);
    const ses = Store.data.sessions.find((s) => s.planKey === key) || null;
    const type = course.type || (micDay && SES_TYPES.includes(micDay.type) && micDay.type) || '力量';
    const name = (course.name && course.name.trim()) || (micDay && micDay.note && micDay.note.trim()) || '中周期计划课';
    return { course, mic, micDay, ses, hasActual: sesHasActual(ses), key, type, name };
  }
  function applyMap(meso, date, t) {
    const mac = Store.macro(meso.macroId);
    const aths = U.deepClone(t.course.athletes && t.course.athletes.length ? t.course.athletes : ((mac && mac.athletes) || []));
    if (t.ses) {
      const oldRows = t.ses.rows || [];
      const oldRes = t.ses.results || {};
      t.ses.rows = U.deepClone(t.course.rows);
      t.ses.blocks = U.deepClone(t.course.blocks || []);
      // 计划行重建后保留每人真实课后记录（实际重量/RIR/单独修改过的组次）：
      // 优先按行 rid 对齐，无 rid 时按「动作 id + 同动作出现顺序」兜底；未单独修改的组次由计划重新自动带入
      const picked = new Array(t.ses.rows.length).fill(null);
      const used = new Set();
      t.ses.rows.forEach((r, i) => {
        if (!r || !r.rid) return;
        const oi = oldRows.findIndex((x, k) => x && x.rid === r.rid && !used.has(k));
        if (oi >= 0) { picked[i] = oi; used.add(oi); }
      });
      const pools = {};
      oldRows.forEach((r, i) => { if (r && r.exId && !used.has(i)) (pools[r.exId] = pools[r.exId] || []).push(i); });
      t.ses.rows.forEach((r, i) => {
        if (picked[i] != null || !r || !r.exId) return;
        if (pools[r.exId] && pools[r.exId].length) { picked[i] = pools[r.exId].shift(); used.add(picked[i]); }
      });
      const keptRes = {};
      Object.keys(oldRes).forEach((aid) => {
        keptRes[aid] = t.ses.rows.map((_, i) => {
          const oi = picked[i];
          return oi != null && oldRes[aid][oi] ? U.deepClone(oldRes[aid][oi]) : null;
        });
      });
      t.ses.results = keptRes;
      t.ses.mesoId = meso.id;
      t.ses.microId = t.mic ? t.mic.id : null;
      if (t.course.name && t.course.name.trim()) t.ses.name = t.name;
      if (t.course.type) t.ses.type = t.type;
      if (!t.ses.athletes || !t.ses.athletes.length) t.ses.athletes = aths;
      Store.alignSessionResults(t.ses);   // 新增/变更行自动带入计划组次，个人已改值不被覆盖
      t.ses.fromMeso = true;
      if (!t.ses.note) t.ses.note = `来自中周期「${meso.name}」当日计划`;
      return 'updated';
    }
    const ns = {
      id: U.uid('ses'), planKey: t.key, date,
      name: t.name, type: t.type, time: null, duration: null, srpe: null, athSrpe: {},
      athletes: aths,
      rows: U.deepClone(t.course.rows),
      blocks: U.deepClone(t.course.blocks || []),
      results: {},
      note: `来自中周期「${meso.name}」当日计划`,
      mesoId: meso.id, microId: t.mic ? t.mic.id : null, fromMeso: true
    };
    Store.alignSessionResults(ns);   // 计划组次立即自动带入每名运动员
    Store.data.sessions.push(ns);
    return 'created';
  }
  // 自动映射当日全部课程：有动作的课程建/同步训练课（已填实际数据的跳过，不覆盖课后记录）；
  // 已无对应课程且无实际数据的自动课程删除
  function autoMapDay(meso, date) {
    const dayRec = (meso.days || []).find((x) => x.date === date);
    const keys = new Set();
    if (dayRec && !dayRec.rest) {
      for (const course of Store.dayCourses(dayRec)) {
        const t = mapTarget(meso, date, course);
        if (!t) continue;
        if (t.hasActual) {
          // 已有实际数据：不覆盖动作/结果，但补标来源信息
          if (t.ses) { t.ses.fromMeso = true; if (!t.ses.note) t.ses.note = `来自中周期「${meso.name}」当日计划`; }
          keys.add(t.key); continue;
        }
        applyMap(meso, date, t);
        keys.add(t.key);
      }
    }
    let removed = 0;
    for (const s of Store.data.sessions.filter((x) => x.planKey && x.mesoId === meso.id && x.date === date)) {
      if (!keys.has(s.planKey) && !sesHasActual(s)) {
        Store.data.sessions = Store.data.sessions.filter((x) => x !== s);
        removed++;
      }
    }
    return removed;
  }

  function renderDetail(v) {
    const el = v.querySelector('#mesoDetail');
    const meso = Store.data.mesos.find((m) => m.id === state.mesoId);
    if (!meso) {
      el.innerHTML = `<div class="empty"><h4>选择一个中周期</h4><p>在顶部中周期列表中选择或新建中周期后，即可按日安排力量训练动作、调整每日负荷强度，并划分小周期</p></div>`;
      return;
    }
    if (!state.day || state.day < meso.startDate || state.day > meso.endDate) state.day = meso.startDate;

    const micros = Store.microsOf(meso.id);
    // 周数标签：本中周期共 N 周（第一周/第二周/…），点击任一周 → 日条只显示该周每一天
    const CN = '一二三四五六七八九';
    const cnNum = (n) => n <= 10 ? (n === 10 ? '十' : CN[n - 1]) : n < 20 ? '十' + CN[n - 11] : (n % 10 ? CN[Math.floor(n / 10) - 1] + '十' + CN[(n % 10) - 1] : CN[Math.floor(n / 10) - 1] + '十');
    const nWeeks = Math.max(1, Math.ceil(U.daysBetween(meso.startDate, meso.endDate) / 7));   // daysBetween 已含首尾，勿再 +1
    const weeks = Array.from({ length: nWeeks }, (_, i) => {
      const s = U.addDays(meso.startDate, i * 7);
      return { s, e: U.addDays(s, 6) < meso.endDate ? U.addDays(s, 6) : meso.endDate };
    });
    if (state.weekIdx != null && (state.weekIdx < 0 || state.weekIdx >= nWeeks)) state.weekIdx = null;
    // 按周查看：选中第 N 周时日条固定为该周 7 天，否则整段
    const weekSel = state.weekIdx != null ? weeks[state.weekIdx] : null;
    if (weekSel && (state.day < weekSel.s || state.day > weekSel.e)) state.day = weekSel.s;

    // 日条（与每日负荷强度滑杆合并）：一张卡片 = 日期/星期/休赛标记 + 当日 1RM% 负荷滑杆；
    // 按周查看 → 该周 7 天；否则整段。拖动滑杆当日课程动作的 %1RM 同步更新
    const stripStart = weekSel ? weekSel.s : meso.startDate;
    const stripEnd = weekSel ? weekSel.e : meso.endDate;
    // 每日负荷强度记录（所属小周期当日安排）：滑杆直接写入该记录 intensity
    const ensureMicDay = (date) => {
      const mi = micros.find((m) => U.between(date, m.startDate, m.endDate));
      if (!mi) return { mic: null, rec: null };
      if (!mi.days) mi.days = [];
      let rec = mi.days.find((x) => x.date === date);
      if (!rec) { rec = { date, type: '', intensity: 50, note: '' }; mi.days.push(rec); }
      return { mic: mi, rec };
    };
    const dayChips = [];
    let d = stripStart;
    while (d <= stripEnd) {
      const recs = (meso.days || []).filter((x) => x.date === d);
      const isComp = Store.compOn(d);
      const rest = recs.some((x) => x.rest);
      const planned = recs.some((x) => Store.dayRows(x).length);
      const { rec: micRec } = ensureMicDay(d);
      const val = micRec ? (micRec.intensity ?? 50) : 50;
      const col = val >= 80 ? UI.cssVar('var(--color-danger)') : val >= 50 ? UI.cssVar('var(--color-warning)') : UI.cssVar('var(--color-success)');
      const badge = rest ? '<span class="chip">休</span>' : isComp ? '<span class="chip red">赛</span>' : (planned ? '<span class="dot"></span>' : '');
      dayChips.push(`
        <div class="day-chip merged ${state.day === d ? 'active' : ''}" data-day="${d}" ${rest ? 'style="opacity:.6"' : ''}
          title="点击定位该日 · 拖动调整当日 1RM% 负荷（课程动作的 %1RM 同步更新，动作内仍可单独修改）">
          <div class="row" style="justify-content:space-between;align-items:center;gap:4px">
            <span class="d1">${U.md(d)}</span>${badge}
          </div>
          <span class="d2">${U.wd(d)}</span>
          <input type="range" min="0" max="100" step="5" value="${val}" data-lday="${d}" ${micRec ? '' : 'disabled'}>
          <span class="val" style="color:${col}">${val}%</span>
        </div>`);
      d = U.addDays(d, 1);
    }
    // 当前选中日的小周期安排（类型/强度 chip）与当日训练课数
    const here = ensureMicDay(state.day);
    const micHere = here.mic, micDayRec = here.rec;
    const sesN = Store.data.sessions.filter((s) => s.date === state.day).length;
    const dayRecs = (meso.days || []).filter((x) => x.date === state.day);
    const rec = dayRecs[0] || null;
    const allRows = (meso.days || []).flatMap((x) => Store.dayRows(x));
    // 训练课类别统计：本中周期内各小周期的每日训练类型
    const typeCounts = {};
    for (const mi of micros) {
      for (const dy of (mi.days || [])) {
        if (dy.date < meso.startDate || dy.date > meso.endDate || !dy.type) continue;
        typeCounts[dy.type] = (typeCounts[dy.type] || 0) + 1;
      }
    }
    const isRest = dayRecs.some((x) => x.rest);
    // 当日课程类型摘要：取当日各课程分类（未分类时回退小周期当日类型）
    const dayCoursesHere = dayRecs.flatMap((x) => Store.dayCourses(x));
    const dayTypeLbl = [...new Set(dayCoursesHere.map((c) => c.type).filter(Boolean))].join(' + ')
      || (micDayRec && micDayRec.type) || '';
    // 当前训练目标（只读）：本中周期目标与所属大周期目标块合并展示，目标统一在「周期训练计划」页制定
    const mg = Store.goalsOf(meso);
    const macObj = Store.data.macros.find((x) => x.id === meso.macroId);
    const mgMac = macObj ? Store.goalBlocksIn(macObj.id, meso.startDate, meso.endDate) : { primary: [], secondary: [] };
    const curGoals = [...new Set([...(mg.primary || []), ...(mg.secondary || []), ...(mgMac.primary || []), ...(mgMac.secondary || [])])];
    el.innerHTML = `
      <div class="card-title">
        <h3>${U.esc(meso.name)} <span class="chip ${meso.type === '峰值' ? 'red' : 'volt'}" style="margin-left:6px">${U.esc(meso.type)}</span></h3>
        <div class="row">
          <span class="sub">${U.cn(meso.startDate)} — ${U.cn(meso.endDate)}（${U.wd(meso.startDate)} 起 · 共 ${nWeeks} 周）</span>
          <button class="btn sm" id="mesoEdit">编辑</button>
          <button class="btn sm danger" id="mesoDel">删除</button>
        </div>
      </div>
      <div class="goal-rows" style="margin-bottom:12px">
        <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
          <span class="goal-tag">当前训练目标</span>${curGoals.length ? U.goalChips(curGoals, 'primary') : '<span class="hint">暂未制定训练目标（请在「周期训练计划」页设置）</span>'}
        </div>
      </div>
      <div class="row" style="gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px" id="mesoWeekTabs">
        <span class="hint" style="flex:none">周期周数</span>
        <span class="chip ${state.weekIdx == null ? 'volt' : ''}" data-wk="all" style="cursor:pointer" title="显示全部日期">全部</span>
        ${weeks.map((w, i) => `<span class="chip ${state.weekIdx === i ? 'volt' : ''}" data-wk="${i}" style="cursor:pointer" title="${w.s} — ${w.e}">第${cnNum(i + 1)}周 <small style="opacity:.65">${U.md(w.s)}–${U.md(w.e)}</small></span>`).join('')}
      </div>
      <div class="card-title" style="margin:0 0 6px"><h3 style="font-size:14px">每日安排</h3><span class="sub">拖动滑杆调整当日 1RM% 负荷</span></div>
      <div class="daystrip merged" style="margin-bottom:16px">${dayChips.join('')}</div>
      <div class="row" style="justify-content:space-between;margin-bottom:10px">
        <div class="row"><b style="letter-spacing:1px">${U.cn(state.day)} ${U.wd(state.day)}</b>
          ${isRest ? '<span class="chip">休息日</span>' : ''}
          ${micDayRec ? `<span class="chip volt" id="micDayChip" title="来自${U.esc(micHere.name)}当日安排（拖动上方日卡片滑杆修改强度）">小周期：${U.esc(dayTypeLbl || '未设类型')}${micDayRec.intensity != null ? ' · ' + micDayRec.intensity + '%' : ''}</span>` : ''}${sesN ? `<span class="chip" data-sesjump style="cursor:pointer" title="查看当日训练课">${sesN} 节训练课</span>` : ''}
        </div>
        <div class="row">
          <button class="btn sm" id="dayCopy" title="从本中周期任意一天复制课程到当日（可选课程与是否包含负荷百分比）">复制训练计划</button>
          <button class="btn sm danger" id="dayClear">清空当日</button>
        </div>
      </div>
      <div id="dayTable"></div>
      <button class="btn sm primary" id="courseAdd" style="margin-top:10px">＋ 添加训练课</button>
      <div class="grid2" style="margin-top:16px">
        <div><div class="card-title" style="margin-bottom:6px"><h3 style="font-size:14px">负荷 · 量 · 疲劳 · 峰值状态</h3><span class="sub" id="chMesoDayHint"></span></div><div class="chart chart-sm" id="chMesoDay"></div></div>
        <div>
          <div class="kpis" style="grid-template-columns:1fr 1fr">
            ${(() => {
              const teamT = Calc.rowsTeamTonnage(allRows, (macObj && macObj.athletes) || []);
              const tonKg = teamT.kg >= 10000 ? Math.round(teamT.kg / 100) / 10 : Math.round(teamT.kg);
              const tonUnit = teamT.kg >= 10000 ? 't' : 'kg';
              return teamT.kg
                ? `<div class="kpi volt"><div class="k">计划吨位（${teamT.nW}/${teamT.n} 人有1RM）</div><div class="v">${U.fmt(tonKg, 1)}<small>${tonUnit}</small></div></div>`
                : `<div class="kpi"><div class="k">计划吨位</div><div class="v" title="为参训运动员设置 1RM 后，kg 行按 %1RM 自动折算吨位">待设<small>1RM</small></div></div>`;
            })()}
            <div class="kpi warn"><div class="k">计划总次数</div><div class="v">${U.fmt(Calc.rowsReps(allRows))}<small>次</small></div></div>
            <div class="kpi info"><div class="k">计划总距离</div><div class="v">${U.fmt(Math.round(Calc.rowsDistance(allRows) / 100) / 10, 1)}<small>km</small></div></div>
            <div class="kpi"><div class="k">计划做功时长</div><div class="v">${U.fmt(Math.round(Calc.rowsDuration(allRows) / 6) / 10, 1)}<small>min</small></div></div>
            ${Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([t, n]) =>
              `<div class="kpi ${TYPE_KPI[t] || ''}"><div class="k">${U.esc(t)}</div><div class="v">${n}<small>天</small></div></div>`).join('')}
          </div>
        </div>
      </div>
      <div style="margin-top:16px">
        <div class="card-title" style="margin-bottom:6px"><h3 style="font-size:14px">实际训练负荷与课次统计</h3><span class="sub" id="chMesoActualHint"></span></div>
        <div class="chart chart-sm" id="chMesoActual"></div>
      </div>
      <div style="margin-top:16px">
        <div class="card-title" style="margin-bottom:6px"><h3 style="font-size:14px">规划百分比负荷</h3><span class="sub" id="chMesoPctHint"></span></div>
        <div class="chart chart-sm" id="chMesoPct"></div>
      </div>
      <div id="microBox" style="margin-top:20px;border-top:1px solid var(--line);padding-top:14px">
        <div class="card-title"><h3 style="font-size:14px">小周期划分</h3>
          <div class="row"><span class="sub">共 ${micros.length} 个 · 点击小周期进入页面安排每日训练</span>
          <button class="btn sm" id="mesoMicAuto">按天数自动划分</button>
          <button class="btn sm primary" id="mesoMicAdd">＋ 新建小周期</button></div>
        </div>
        ${micros.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">
          ${micros.map((mi) => `
            <div class="day-chip" data-mic="${mi.id}" style="flex-direction:row;justify-content:space-between;align-items:center;cursor:pointer" title="点击进入小周期页面">
              <div><div class="d2">${U.esc(mi.name)}</div><div class="d1">${U.md(mi.startDate)} — ${U.md(mi.endDate)}</div></div>
              <span class="chip">${U.daysBetween(mi.startDate, mi.endDate)} 天</span>
            </div>`).join('')}
        </div>` : '<p class="hint">尚未划分小周期：可自定义天数新建，或按固定天数自动划分整个中周期</p>'}
      </div>`;

    // 日表（计划模式：不含实际完成/RIR）——一天多课：dayRec.courses = [{id,name,type,rows}]（旧数据自动包裹为单课程）
    if (!rec) {
      (meso.days = meso.days || []).push({ date: state.day, note: '', rows: [], courses: [{ name: '', type: '', rows: [] }] });
    }
    const dayRec = (meso.days || []).find((x) => x.date === state.day);
    if (!Array.isArray(dayRec.courses)) {
      dayRec.courses = [{ name: dayRec.note || '', type: dayRec.type || '', rows: dayRec.rows || [] }];
    }
    const renderDayTable = () => {
      const wrap = el.querySelector('#dayTable');
      wrap.innerHTML = '';
      dayRec.courses.forEach((course, ci) => {
        const block = document.createElement('div');
        block.className = 'course-block';
        block.style.cssText = 'border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:10px';
        block.innerHTML = `
          <div class="row" style="gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
            <span class="chip ${course.rows.length ? 'volt' : ''}">课程 ${ci + 1}</span>
            <b style="min-width:70px">${U.esc(course.name || '未命名')}</b>
            <select class="sel" data-ctype style="width:140px" title="按七大训练模块分组的课程分类，选择后自动作为课程名称">
              <option value="">课程分类</option>
              ${Store.TRAIN_MODULES.map((m) => `<optgroup label="${m.name}">${m.types.map((t) => `<option ${course.type === t ? 'selected' : ''}>${t}</option>`).join('')}</optgroup>`).join('')}
              ${course.type && !SES_TYPES.includes(course.type) ? `<option selected>${U.esc(course.type)}</option>` : ''}
            </select>
            <span class="hint">${course.rows.length ? course.rows.length + ' 个动作' : '未安排动作'}</span>
            <div style="margin-left:auto;display:flex;gap:6px">
              ${dayRec.courses.length > 1 ? '<button class="btn sm danger" data-cdel>删除本课</button>' : ''}
            </div>
          </div>`;
        wrap.appendChild(block);
        block.appendChild(UI.exerciseTable({
          rows: course.rows,
          container: course,
          planMode: true,
          setEditor: false,
          athleteId: (dayRec.athletes && dayRec.athletes.length === 1) ? dayRec.athletes[0] : null,
          planAthIds: macObj && Array.isArray(macObj.athletes) ? macObj.athletes.slice() : [],
          defaultPct: micDayRec && micDayRec.intensity != null ? micDayRec.intensity : null,
          onChanged: onPlanChanged
        }));
        block.querySelector('[data-ctype]').onchange = (e) => { course.type = e.target.value; course.name = e.target.value || ('课程 ' + (ci + 1)); onPlanChanged(true); };
        const cdel = block.querySelector('[data-cdel]');
        if (cdel) cdel.onclick = () => UI.confirm(`删除课程 ${ci + 1}「${U.esc(course.name || '未命名')}」？对应自动映射的训练课将一并移除（已填实际数据的保留）。`, () => {
          dayRec.courses.splice(ci, 1);
          onPlanChanged(true);
          UI.toast('已删除课程', 'ok');
        });
      });
    };
    // 计划变更 → 保存 + 自动映射到训练课（结构变化时刷新整页以更新映射状态 chip）
    function onPlanChanged(structural) {
      const removed = autoMapDay(meso, state.day);
      // 当日任一动作 %1RM 高于负荷条设定值 → 负荷条自动上调到最高动作百分比（只升不降）
      const dayR = (meso.days || []).find((x) => x.date === state.day && !x.rest);
      if (dayR) {
        let maxPct = 0;
        (meso.days || []).filter((x) => x.date === state.day && !x.rest)
          .flatMap((x) => Store.dayCourses(x))
          .forEach((c) => (c.rows || []).forEach((r) => { if (r.exId) maxPct = Math.max(maxPct, Number(r.pct) || 0); }));
        if (maxPct > 0) {
          const { rec: mdrSync } = ensureMicDay(state.day);
          if (mdrSync && maxPct > (mdrSync.intensity ?? 0)) {
            mdrSync.intensity = Math.min(100, maxPct);
            const rgSync = el.querySelector(`.daystrip input[data-lday="${state.day}"]`);
            if (rgSync) {
              rgSync.value = mdrSync.intensity;
              const valEl = rgSync.parentElement.querySelector('.val');
              if (valEl) {
                valEl.textContent = mdrSync.intensity + '%';
                valEl.style.color = mdrSync.intensity >= 80 ? UI.cssVar('var(--color-danger)') : mdrSync.intensity >= 50 ? UI.cssVar('var(--color-warning)') : UI.cssVar('var(--color-success)');
              }
            }
          }
        }
      }
      Store.save();
      renderChart(el, meso);
      renderActualChart(el, meso);
      renderPctChart(el, meso);
      if (structural) mount();
    }
    renderDayTable();

    // 日卡片：点击定位该日（点滑杆本身不触发定位）
    $$('.daystrip .day-chip[data-day]', el).forEach((c) => {
      c.onclick = (e) => {
        if (e.target.closest('input,button,a')) return;
        state.day = c.dataset.day; mount();
      };
    });
    // 每日 1RM% 负荷滑杆：拖动即更新小周期当日强度；松手时同步当日全部课程动作的 %1RM 并映射训练课
    $$('.daystrip input[data-lday]', el).forEach((rg) => {
      rg.oninput = () => {
        const v = Number(rg.value);
        const valEl = rg.parentElement.querySelector('.val');
        valEl.textContent = v + '%';
        valEl.style.color = v >= 80 ? UI.cssVar('var(--color-danger)') : v >= 50 ? UI.cssVar('var(--color-warning)') : UI.cssVar('var(--color-success)');
      };
      rg.onchange = () => {
        const date = rg.dataset.lday;
        const v = Number(rg.value);
        const { rec: mdr } = ensureMicDay(date);
        if (!mdr) return;
        mdr.intensity = v;
        // 课程动作 %1RM 同步：当日每节课中已选动作的行统一取当日强度；动作内仍可在课程表中手动再改
        const dayR = (meso.days || []).find((x) => x.date === date);
        if (dayR && !dayR.rest) {
          let touched = false;
          Store.dayCourses(dayR).forEach((course) => {
            (course.rows || []).forEach((r) => { if (r.exId) { r.pct = v; touched = true; } });
          });
          if (touched) autoMapDay(meso, date);
        }
        Store.save();
        mount();
      };
    });
    // 当日训练课 chip → 跳转训练课页定位该日
    const sesJump = el.querySelector('[data-sesjump]');
    if (sesJump) sesJump.onclick = () => {
      if (Views.session && Views.session.state) Views.session.state.date = state.day;
      location.hash = '#/session';
    };
    // 周数标签：点击第 N 周 → 日条只显示该周每一天；点「全部」恢复整段视图
    $$('[data-wk]', el).forEach((c) => {
      c.onclick = () => {
        state.weekIdx = c.dataset.wk === 'all' ? null : +c.dataset.wk;
        if (state.weekIdx != null) {
          const w = weeks[state.weekIdx];
          if (state.day < w.s || state.day > w.e) state.day = w.s;
        } else if (state.day < meso.startDate || state.day > meso.endDate) state.day = meso.startDate;
        mount();
      };
    });
    el.querySelector('#mesoEdit').onclick = () => mesoDialog(meso);
    el.querySelector('#mesoDel').onclick = () => UI.confirm(`删除中周期「${U.esc(meso.name)}」？关联小周期将一并删除。`, () => {
      Store.data.micros = Store.data.micros.filter((m) => m.mesoId !== meso.id);
      Store.data.mesos = Store.data.mesos.filter((m) => m.id !== meso.id);
      state.mesoId = null; Store.save(); mount();
    });
    // 复制训练计划（覆盖当日）：①选来源日期 → ②来源日多节课时可勾选复制哪几节（默认全选）→ ③选择「只复制计划（不含负荷%）」或「全部复制（含负荷%）」
    function openCopyDialog() {
      const sources = (meso.days || [])
        .filter((x) => x.date !== state.day && !x.rest && Store.dayRows(x).length)
        .sort((a, b) => b.date.localeCompare(a.date));
      if (!sources.length) { UI.toast('本中周期还没有可复制的一天', 'err'); return; }
      UI.modal({
        title: '复制训练计划（覆盖当日）',
        body: `
          <div class="field"><label>1 · 选择来源日期</label>
            <select class="sel" id="cpSrc" style="width:100%">
              ${sources.map((x) => {
                const cs = Store.dayCourses(x);
                return `<option value="${x.date}">${U.esc(`${U.cn(x.date)} ${U.wd(x.date)} · ${cs.length} 节课 · ${Store.dayRows(x).length} 动作`)}</option>`;
              }).join('')}
            </select></div>
          <div class="field" id="cpCourseField"><label>2 · 选择要复制的课程（可多选）</label>
            <div id="cpCourses" style="display:flex;flex-direction:column;gap:6px"></div>
            <div class="row" style="gap:6px;margin-top:6px">
              <button class="btn sm ghost" type="button" id="cpAll">全选</button>
              <button class="btn sm ghost" type="button" id="cpNone">全不选</button>
            </div>
          </div>
          <p class="hint">复制将覆盖当日的全部课程；「只复制计划」保留动作/组数/次数但清空 %1RM 负荷百分比，「全部复制」连负荷百分比一起复制。保存后自动同步当日训练课。</p>`,
        footer: `<button class="btn ghost" data-x>取消</button>
          <button class="btn primary" data-cpplan>只复制计划（不含负荷%）</button>
          <button class="btn primary" data-cpfull>全部复制（含负荷%）</button>`,
        onMount(ov, close) {
          const box = ov.querySelector('#cpCourses');
          const fieldEl = ov.querySelector('#cpCourseField');
          const renderCourses = () => {
            const src = (meso.days || []).find((x) => x.date === ov.querySelector('#cpSrc').value);
            const cs = src ? Store.dayCourses(src) : [];
            box.innerHTML = cs.map((c, i) => `
              <label class="row" style="gap:8px;align-items:center;margin:0;cursor:pointer">
                <input type="checkbox" class="cpCk" data-ci="${i}" checked style="margin:0">
                <span class="chip ${c.rows.length ? 'volt' : ''}">课程 ${i + 1}</span>
                <b>${U.esc(c.name || '未命名课程')}</b>
                <span class="hint">${(c.rows || []).length} 个动作 · ${U.esc(c.type || '未分类')}</span>
              </label>`).join('');
            // 仅 1 节课无需选择，直接隐藏课程选择区
            fieldEl.style.display = cs.length > 1 ? '' : 'none';
          };
          renderCourses();
          ov.querySelector('#cpSrc').onchange = renderCourses;
          const checkedIdx = () => [...box.querySelectorAll('.cpCk:checked')].map((k) => +k.dataset.ci);
          ov.querySelector('#cpAll').onclick = () => box.querySelectorAll('.cpCk').forEach((k) => { k.checked = true; });
          ov.querySelector('#cpNone').onclick = () => box.querySelectorAll('.cpCk').forEach((k) => { k.checked = false; });
          const doCopy = (withPct) => {
            const src = (meso.days || []).find((x) => x.date === ov.querySelector('#cpSrc').value);
            if (!src) { close(); return; }
            const cs = Store.dayCourses(src);
            const idxs = cs.length > 1 ? checkedIdx() : cs.map((_, i) => i);
            if (!idxs.length) { UI.toast('请至少选择一节课程', 'err'); return; }
            dayRec.courses = idxs.map((i) => {
              const cl = U.deepClone(cs[i]);
              cl.id = U.uid('mcs');
              if (!withPct) (cl.rows || []).forEach((r) => { r.pct = null; });
              return cl;
            });
            dayRec.rest = false;
            close();
            onPlanChanged(true);
            UI.toast(`已复制 ${U.cn(src.date)} ${idxs.length} 节课程${withPct ? '（含负荷百分比）' : '（不含负荷百分比，%1RM 已清空）'}`, 'ok');
          };
          ov.querySelector('[data-cpplan]').onclick = () => doCopy(false);
          ov.querySelector('[data-cpfull]').onclick = () => doCopy(true);
        }
      });
    }
    el.querySelector('#dayCopy').onclick = () => openCopyDialog();
    el.querySelector('#dayClear').onclick = () => UI.confirm('清空当日全部课程动作？', () => {
      for (const c of dayRec.courses) c.rows = [];
      onPlanChanged(false);
      renderDayTable();
    });
    // 添加训练课：一天多课（如上午力量 / 下午技术战术）
    el.querySelector('#courseAdd').onclick = () => {
      dayRec.courses.push({ id: U.uid('mcs'), name: '', type: '', rows: [] });
      Store.save();
      renderDayTable();
      const blocks = el.querySelectorAll('#dayTable .course-block');
      const last = blocks[blocks.length - 1];
      if (last) { const s = last.querySelector('[data-ctype]'); if (s) s.focus(); }
    };
    el.querySelector('#mesoMicAdd').onclick = () => microDialogMeso(meso);
    el.querySelector('#mesoMicAuto').onclick = () => autoSplitMicros(meso);
    $$('[data-mic]', el).forEach((c) => { c.onclick = () => Views.micro.show(c.dataset.mic); });

    // 当日最高规划 1RM% 负荷：当日各课程动作行 pct 与小周期当日强度取最大值
    const dayMaxPct = (date) => {
      let v = 0;
      for (const dy of (meso.days || []).filter((x) => x.date === date && !x.rest)) {
        for (const c of Store.dayCourses(dy)) {
          for (const r of (c.rows || [])) if (r.exId) v = Math.max(v, Number(r.pct) || 0);
        }
      }
      const mi = micros.find((x) => U.between(date, x.startDate, x.endDate));
      const rec = mi && (mi.days || []).find((x) => x.date === date);
      if (rec && rec.intensity != null) v = Math.max(v, Number(rec.intensity) || 0);
      return v;
    };
    const pctColor = (v) => v >= 80 ? UI.cssVar('var(--color-danger)') : v >= 50 ? UI.cssVar('var(--color-warning)') : UI.cssVar('var(--color-success)');

    // 实际训练负荷与课次统计：全部=逐个小周期（每周期一根柱）；第N周=该周 7 天逐日（每日一根柱）
    function renderActualChart(box, m) {
      const chEl = box.querySelector('#chMesoActual');
      if (!chEl) return;
      const hint = box.querySelector('#chMesoActualHint');
      const ch = UI.chart(chEl);
      const wk = state.weekIdx != null ? weeks[state.weekIdx] : null;

      if (wk) {
        const days = [];
        for (let d = wk.s; d <= wk.e; d = U.addDays(d, 1)) days.push(d);
        const loadArr = days.map((d) => {
          let load = 0;
          for (const e of Store.data.loadEntries) if (e.date === d) load += Number(e.load) || 0;
          return Math.round(load);
        });
        const sesArr = days.map((d) => Store.data.sessions.filter((s) => s.date === d).length);
        if (hint) hint.textContent = `第${cnNum(state.weekIdx + 1)}周 · ${U.md(wk.s)} — ${U.md(wk.e)} · 按日`;
        ch.setOption({
          grid: { left: 50, right: 56, top: 30, bottom: 28 },
          legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 } },
          tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon, {
            formatter: (ps) => {
              if (!ps || !ps.length) return '';
              const d = days[ps[0].dataIndex];
              const lines = ps.filter((p) => p.value != null).map((p) => `${p.marker}${p.seriesName}：<b>${U.fmt(p.value)}</b>`);
              return `<b>${U.md(d)} ${U.wd(d)}</b><br/>` + lines.join('<br/>');
            }
          }),
          xAxis: { type: 'category', data: days.map((d) => U.md(d) + ' ' + U.wd(d)),
            axisLabel: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, interval: 0 } },
          yAxis: [
            Object.assign({ type: 'value', name: 'AU', nameTextStyle: { color: UI.cssVar('var(--color-ink-subtle)') } }, UI.axisCommon),
            Object.assign({ type: 'value', name: '课次', minInterval: 1, nameTextStyle: { color: UI.cssVar('var(--color-ink-subtle)') } }, UI.axisCommon, { splitLine: { show: false } })
          ],
          series: [
            { name: '全队负荷（AU）', type: 'bar', data: loadArr, barMaxWidth: 26,
              itemStyle: { borderRadius: [4, 4, 0, 0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: UI.tint('var(--color-info)', .85) }, { offset: 1, color: UI.tint('var(--color-info)', .25) }] } } },
            { name: '训练课次', type: 'line', yAxisIndex: 1, data: sesArr, smooth: true, lineStyle: { color: '#ff9f43', width: 2.5 }, itemStyle: { color: '#ff9f43' }, symbolSize: 7, connectNulls: true }
          ]
        });
        return;
      }

      // 全部：与周标签同一口径，逐周（第N周）一根柱——保证柱数与「第N周」标签数一致
      if (hint) hint.textContent = '按周汇总 · sRPE×时长=AU';
      const labels = weeks.map((w, i) => `第${cnNum(i + 1)}周`);
      const loadArr = [], sesArr = [];
      weeks.forEach((w) => {
        let load = 0;
        for (const e of Store.data.loadEntries) {
          if (e.date >= w.s && e.date <= w.e) load += Number(e.load) || 0;
        }
        const ses = Store.data.sessions.filter((s) => s.date >= w.s && s.date <= w.e).length;
        loadArr.push(Math.round(load)); sesArr.push(ses);
      });
      ch.setOption({
        grid: { left: 50, right: 56, top: 30, bottom: weeks.length > 5 ? 48 : 28 },
        legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 } },
        tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon, {
          formatter: (ps) => {
            if (!ps || !ps.length) return '';
            const i = ps[0].dataIndex, w = weeks[i];
            const lines = ps.filter((p) => p.value != null).map((p) => `${p.marker}${p.seriesName}：<b>${U.fmt(p.value)}</b>`);
            return `<b>${labels[i]}</b><br/>${U.md(w.s)} — ${U.md(w.e)}<br/>` + lines.join('<br/>');
          }
        }),
        xAxis: { type: 'category', data: labels,
          axisLabel: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, interval: 0, rotate: weeks.length > 5 ? 25 : 0 } },
        yAxis: [
          Object.assign({ type: 'value', name: 'AU', nameTextStyle: { color: UI.cssVar('var(--color-ink-subtle)') } }, UI.axisCommon),
          Object.assign({ type: 'value', name: '课次', minInterval: 1, nameTextStyle: { color: UI.cssVar('var(--color-ink-subtle)') } }, UI.axisCommon, { splitLine: { show: false } })
        ],
        series: [
          { name: '全队负荷（AU）', type: 'bar', data: loadArr, barMaxWidth: 34,
            itemStyle: { borderRadius: [4, 4, 0, 0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: UI.tint('var(--color-info)', .85) }, { offset: 1, color: UI.tint('var(--color-info)', .25) }] } } },
          { name: '训练课次', type: 'line', yAxisIndex: 1, data: sesArr, smooth: true, lineStyle: { color: '#ff9f43', width: 2.5 }, itemStyle: { color: '#ff9f43' }, symbolSize: 7, connectNulls: true }
        ]
      });
    }

    // 规划百分比负荷看板：全部=每个小周期一根柱（该周内最高当日 1RM%）；第N周=该周每日一根柱（当天最高 1RM%）
    function renderPctChart(box, m) {
      const chEl = box.querySelector('#chMesoPct');
      if (!chEl) return;
      const hint = box.querySelector('#chMesoPctHint');
      const ch = UI.chart(chEl);
      const wk = state.weekIdx != null ? weeks[state.weekIdx] : null;
      let labels, vals, daily = null;

      if (wk) {
        const days = [];
        for (let d = wk.s; d <= wk.e; d = U.addDays(d, 1)) days.push(d);
        daily = days;
        labels = days.map((d) => U.md(d) + ' ' + U.wd(d));
        vals = days.map(dayMaxPct);
        if (hint) hint.textContent = `第${cnNum(state.weekIdx + 1)}周 · ${U.md(wk.s)} — ${U.md(wk.e)} · 按日 · 当天最高`;
      } else {
        // 全部：与周标签同一口径，每周一根柱（该周内最高当日 1RM%）
        if (hint) hint.textContent = '按周 · 柱=每周内最高当日 1RM%';
        labels = weeks.map((w, i) => `第${cnNum(i + 1)}周`);
        vals = weeks.map((w) => {
          let mx = 0;
          for (let d = w.s; d <= w.e; d = U.addDays(d, 1)) mx = Math.max(mx, dayMaxPct(d));
          return mx;
        });
      }
      ch.setOption({
        grid: { left: 44, right: 20, top: 30, bottom: labels.length > 5 ? 48 : 28 },
        tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon, {
          formatter: (ps) => {
            if (!ps || !ps.length) return '';
            const i = ps[0].dataIndex;
            const v = vals[i];
            const head = daily
              ? `<b>${U.md(daily[i])} ${U.wd(daily[i])}</b>`
              : `<b>${U.esc(labels[i])}</b>`;
            return `${head}<br/>${ps[0].marker}最高 1RM% 负荷：<b>${v}%</b>`;
          }
        }),
        xAxis: { type: 'category', data: labels,
          axisLabel: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, interval: 0, rotate: labels.length > 5 ? 25 : 0 } },
        yAxis: Object.assign({}, UI.axisCommon, { type: 'value', min: 0, max: 100, name: '%1RM', nameTextStyle: { color: UI.cssVar('var(--color-ink-subtle)') }, axisLabel: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, formatter: '{value}%' } }),
        series: [
          { name: '最高 1RM% 负荷', type: 'bar', barMaxWidth: wk ? 26 : 34,
            data: vals.map((v) => ({ value: v, itemStyle: { borderRadius: [4, 4, 0, 0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: pctColor(v) }, { offset: 1, color: UI.alpha(pctColor(v), .2) }] } } })),
            label: { show: true, position: 'top', formatter: (p) => p.value ? p.value + '%' : '', color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 },
            markLine: { silent: true, symbol: 'none', lineStyle: { color: UI.cssVar('var(--color-danger)'), type: 'dashed', width: 1 },
              data: [{ yAxis: 80, label: { formatter: '高强度 80%', color: UI.cssVar('var(--color-danger)'), fontSize: 10, position: 'insideEndTop' } }] }
          }
        ]
      });
    }

    renderChart(el, meso);
    renderActualChart(el, meso);
    renderPctChart(el, meso);

    function renderChart(box, m) {
      const chEl = box.querySelector('#chMesoDay');
      if (!chEl) return;
      const hint = box.querySelector('#chMesoDayHint');
      const ch = UI.chart(chEl);
      const wk = state.weekIdx != null ? weeks[state.weekIdx] : null;

      // 全队实际负荷 AU + 疲劳（EWMA 7d）+ 峰值状态（EWMA 42d − EWMA 7d），向前多取 42 天预热
      const buildEwma = (endDate) => {
        const series = Calc.dailySeries(Store.data.loadEntries, U.addDays(m.startDate, -42), endDate);
        const fatArr = Calc.ewma(series, 7), fitArr = Calc.ewma(series, 42);
        const auMap = {}, fatMap = {}, formMap = {};
        for (const p of series) auMap[p.date] = Math.round(p.load);
        for (const p of fatArr) fatMap[p.date] = Math.round(p.value);
        for (let i = 0; i < fitArr.length; i++) formMap[fitArr[i].date] = Math.round(fitArr[i].value - fatArr[i].value);
        return { auMap, fatMap, formMap };
      };
      const eachDay = (s, e) => { const arr = []; for (let d = s; d <= e; d = U.addDays(d, 1)) arr.push(d); return arr; };
      const seriesDef = (vol, au, fat, form) => [
        { name: '量（kg，实际）', type: 'bar', yAxisIndex: 1, data: vol, barMaxWidth: wk ? 16 : 22, itemStyle: { borderRadius: [3, 3, 0, 0], color: UI.tint('var(--color-info)', .22) } },
        { name: '负荷（AU）', type: 'line', data: au, smooth: true, symbolSize: 5, lineStyle: { width: 2.5, color: UI.cssVar('var(--color-accent)') }, itemStyle: { color: UI.cssVar('var(--color-accent)') }, emphasis: { focus: 'series' } },
        { name: '疲劳（AU）', type: 'line', data: fat, smooth: true, symbolSize: 5, lineStyle: { width: 2.5, color: UI.cssVar('var(--color-danger)') }, itemStyle: { color: UI.cssVar('var(--color-danger)') }, emphasis: { focus: 'series' } },
        { name: '峰值状态（AU）', type: 'line', data: form, smooth: true, symbolSize: 5, lineStyle: { width: 2.5, type: 'dashed', color: UI.cssVar('var(--color-success)') }, itemStyle: { color: UI.cssVar('var(--color-success)') }, emphasis: { focus: 'series' }, markLine: { silent: true, symbol: 'none', lineStyle: { color: UI.cssVar('var(--color-success)'), type: 'dotted', width: 1 }, data: [{ yAxis: 0, label: { formatter: '基准', color: UI.cssVar('var(--color-success)'), fontSize: 9 } }] } }
      ];

      if (wk) {
        // 第N周：该周 7 天逐日
        const days = eachDay(wk.s, wk.e);
        const maps = buildEwma(wk.e);
        const volData = days.map((x) => Math.round(Store.dayActualTonnage(x)));
        if (hint) hint.textContent = `第${cnNum(state.weekIdx + 1)}周 · ${U.md(wk.s)} — ${U.md(wk.e)} · 按日`;
        ch.setOption({
          grid: { left: 60, right: 60, top: 30, bottom: 36 },
          legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 } },
          tooltip: Object.assign({}, UI.tooltipCommon, {
            formatter: (ps) => {
              const arr = Array.isArray(ps) ? ps : [ps];
              if (!arr.length) return '';
              const d = days[arr[0].dataIndex];
              let s = `<b>${U.md(d)} ${U.wd(d)}</b>`;
              for (const p of arr) s += `<br/>${p.marker}${p.seriesName}：<b>${p.value != null ? U.fmt(p.value) : '—'}</b>`;
              return s;
            }
          }),
          xAxis: { type: 'category', data: days, axisLabel: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, interval: 0, rotate: 25, formatter: (v) => U.md(v) } },
          yAxis: [
            Object.assign({ type: 'value', scale: true, name: 'AU', nameLocation: 'middle', nameGap: 40, nameTextStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 } }, UI.axisCommon),
            Object.assign({ type: 'value', scale: true, splitLine: { show: false }, name: 'kg', nameLocation: 'middle', nameGap: 40, nameTextStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 } }, UI.axisCommon)
          ],
          series: seriesDef(
            volData,
            days.map((x) => maps.auMap[x] ?? 0),
            days.map((x) => maps.fatMap[x] ?? 0),
            days.map((x) => maps.formMap[x] ?? 0)
          )
        });
        return;
      }

      // 全部：与周标签同一口径，逐周汇总（量/负荷=周合计，疲劳/峰值=周末日状态）
      const maps = buildEwma(m.endDate);
      const labels = weeks.map((w, i) => `第${cnNum(i + 1)}周`);
      const volData = [], auData = [], fatData = [], formData = [];
      weeks.forEach((w) => {
        let vol = 0, au = 0;
        for (let d = w.s; d <= w.e; d = U.addDays(d, 1)) {
          vol += Math.round(Store.dayActualTonnage(d));
          au += maps.auMap[d] || 0;
        }
        volData.push(vol); auData.push(au);
        fatData.push(maps.fatMap[w.e] ?? 0);
        formData.push(maps.formMap[w.e] ?? 0);
      });
      if (hint) hint.textContent = '按周 · 量与负荷为周合计';
      ch.setOption({
        grid: { left: 60, right: 60, top: 30, bottom: weeks.length > 5 ? 48 : 28 },
        legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 } },
        tooltip: Object.assign({}, UI.tooltipCommon, {
          formatter: (ps) => {
            const arr = Array.isArray(ps) ? ps : [ps];
            if (!arr.length) return '';
            const i = arr[0].dataIndex, w = weeks[i];
            let s = `<b>${labels[i]}</b><br/>${U.md(w.s)} — ${U.md(w.e)}`;
            for (const p of arr) s += `<br/>${p.marker}${p.seriesName}：<b>${p.value != null ? U.fmt(p.value) : '—'}</b>`;
            return s;
          }
        }),
        xAxis: { type: 'category', data: labels, axisLabel: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, interval: 0, rotate: weeks.length > 5 ? 25 : 0 } },
        yAxis: [
          Object.assign({ type: 'value', scale: true, name: 'AU', nameLocation: 'middle', nameGap: 40, nameTextStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 } }, UI.axisCommon),
          Object.assign({ type: 'value', scale: true, splitLine: { show: false }, name: 'kg', nameLocation: 'middle', nameGap: 40, nameTextStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 } }, UI.axisCommon)
        ],
        series: seriesDef(volData, auData, fatData, formData)
      });
    }
  }

  function mount(v) {
    if (v == null) v = $('#view');
    UI.disposeCharts();
    const mac = Store.activeMacro();
    if (!state.mesoId || !Store.data.mesos.find((m) => m.id === state.mesoId)) {
      state.mesoId = null;
      const mesos = mac ? Store.mesosOf(mac.id) : [];
      if (mesos.length) state.mesoId = mesos[0].id;
    }
    v.innerHTML = `
      <div class="card" id="mesoList" style="margin-bottom:14px"></div>
      <div class="card" id="mesoDetail"></div>
      ${!mac ? '<p class="hint" style="margin-top:14px">请先在「周期训练计划」中创建训练计划。</p>' : ''}`;
    renderList(v);
    renderDetail(v);
  }

  // 供周期总表 / 小周期页跳转并定位
  function show(id) {
    state.mesoId = id; state.day = null; state.microId = null; state.weekIdx = null; state.cycleId = 'all';
    if (location.hash === '#/meso') mount();
    else location.hash = '#/meso';
  }

  // 实时分析：训练课课后保存/手动录入 → 中周期实际负荷、力量负荷、百分比负荷看板自动重算
  Store.subscribe(() => {
    if (location.hash.replace('#/', '') !== 'meso') return;
    const view = $('#view');
    if (view && view.querySelector('#mesoDetail')) mount(view);
  });

  return { mount, state, show };
})();
