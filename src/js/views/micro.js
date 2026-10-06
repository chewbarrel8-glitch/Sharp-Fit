// 小周期页面
Views.micro = (() => {
  const state = { mesoId: null, microId: null };

  function microDialog(micro, mesoId) {
    UI.modal({
      title: micro ? '编辑小周期' : '新建小周期',
      body: `
        <div class="form-grid">
          <div class="field full"><label>名称</label><input class="ipt" id="fName" value="${U.esc(micro ? micro.name : '')}"></div>
          <div class="field"><label>开始日期</label><input type="date" class="ipt" id="fStart" value="${micro ? micro.startDate : U.today()}"></div>
          <div class="field"><label>天数</label><input type="number" class="ipt" id="fDays" min="1" max="28" value="${micro ? U.daysBetween(micro.startDate, micro.endDate) : 7}"></div>
          <div class="field full"><span class="hint">小周期天数自行设定，结束日期 = 开始日期 + 天数 − 1</span></div>
        </div>`,
      footer: `<button class="btn ghost" data-x>取消</button><button class="btn primary" data-ok>保存</button>`,
      onMount(ov, close) {
        ov.querySelector('[data-ok]').onclick = () => {
          const name = ov.querySelector('#fName').value.trim() || '未命名小周期';
          const s = ov.querySelector('#fStart').value;
          if (!s) { UI.toast('请选择开始日期', 'err'); return; }
          const days = Math.max(1, Number(ov.querySelector('#fDays').value) || 7);
          const obj = micro || { id: U.uid('mic'), mesoId, days: [] };
          Object.assign(obj, {
            name,
            startDate: s,
            endDate: U.addDays(s, days - 1)
          });
          if (!micro) Store.data.micros.push(obj);
          state.microId = obj.id;
          Store.save(); close(); mount(); UI.toast('已保存', 'ok');
        };
      }
    });
  }

  function renderSide(v) {
    const el = v.querySelector('#microSide');
    const mac = Store.activeMacro();
    const mesos = mac ? Store.mesosOf(mac.id) : [];
    // 映射：首次进入/选择失效时，跟随中周期页正在查看的中周期与小周期
    if (!state.mesoId || !mesos.find((m) => m.id === state.mesoId)) {
      const from = (Views.meso && Views.meso.state && Views.meso.state.mesoId) || null;
      state.mesoId = from && mesos.find((m) => m.id === from) ? from : (mesos[0] ? mesos[0].id : null);
    }
    const micros = state.mesoId ? Store.microsOf(state.mesoId) : [];
    if (!state.microId || !micros.find((m) => m.id === state.microId)) {
      const ms = (Views.meso && Views.meso.state) || {};
      const fromMic = micros.find((m) => m.id === ms.microId) || micros.find((m) => ms.day && U.between(ms.day, m.startDate, m.endDate));
      state.microId = fromMic ? fromMic.id : (micros[0] ? micros[0].id : null);
    }
    el.innerHTML = `
      <div class="card-title"><h3>小周期列表</h3>
        <div class="row">
          <span class="hint" style="flex:none">所属中周期</span>
          <select class="sel" id="mesoSel" style="width:220px">${mesos.map((m) => `<option value="${m.id}" ${state.mesoId === m.id ? 'selected' : ''}>${U.esc(m.name)}</option>`).join('') || '<option value="">— 无中周期 —</option>'}</select>
          <button class="btn sm primary" id="micAdd" ${state.mesoId ? '' : 'disabled'}>＋ 新建</button>
          <button class="btn sm" id="micAuto" ${state.mesoId ? '' : 'disabled'}>按中周期自动划分</button>
        </div>
      </div>
      <div class="top-list">
        ${micros.map((m) => `
          <div class="day-chip top-item ${state.microId === m.id ? 'active' : ''}" data-id="${m.id}">
            <div class="d2">${U.esc(m.name)}</div>
            <div class="d1">${U.md(m.startDate)} — ${U.md(m.endDate)}</div>
            <div class="row" style="justify-content:flex-end"><span class="chip">${U.daysBetween(m.startDate, m.endDate)} 天</span></div>
          </div>`).join('') || '<p class="hint">当前中周期暂无小周期</p>'}
      </div>`;
    el.querySelector('#mesoSel').onchange = (e) => { state.mesoId = e.target.value; state.microId = null; mount(); };
    $$('[data-id]', el).forEach((c) => { c.onclick = () => { state.microId = c.dataset.id; mount(); }; });
    el.querySelector('#micAdd').onclick = () => microDialog(null, state.mesoId);
    el.querySelector('#micAuto').onclick = () => {
      const meso = Store.data.mesos.find((m) => m.id === state.mesoId);
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
              Store.data.micros.push({
                id: U.uid('mic'), mesoId: meso.id, name: `第 ${i} 段`, startDate: cur, endDate: end, targetLoad: null,
                days: []
              });
              cur = U.addDays(end, 1); i++;
            }
            state.microId = null;
            Store.save(); close(); mount(); UI.toast(`已按 ${len} 天划分 ${i - 1} 个小周期`, 'ok');
          };
        }
      });
    };
  }

  // 全队周实际负荷（AU）：小周期日期范围内负荷记录合计
  function weekAU(m) {
    let sum = 0;
    for (const e of Store.data.loadEntries) {
      if (e.date >= m.startDate && e.date <= m.endDate) sum += Number(e.load) || 0;
    }
    return sum;
  }

  function renderDetail(v) {
    const el = v.querySelector('#microDetail');
    const micro = Store.data.micros.find((m) => m.id === state.microId);
    if (!micro) {
      el.innerHTML = '<div class="empty"><h4>选择或创建小周期</h4><p>小周期以周为单位规划每天的训练类型与强度分布，是负荷节奏管理的核心工具</p></div>';
      return;
    }
    if (!micro.days) micro.days = [];
    // 补齐每日记录
    let d = micro.startDate;
    while (d <= micro.endDate) {
      if (!micro.days.find((x) => x.date === d)) micro.days.push({ date: d, type: '', intensity: 50, note: '' });
      d = U.addDays(d, 1);
    }
    micro.days.sort((a, b) => a.date.localeCompare(b.date));

    // 训练目标：本小周期目标（大/中/小周期目标一致，不再重复展示映射来源）
    const mgSelf = Store.goalsOf(micro);
    const mesoObj = Store.data.mesos.find((x) => x.id === micro.mesoId);

    // 映射：中周期当日课程（一天多课逐节展示，类型直接取自课程分类）+ 当日训练课（点击进入当天训练课页）
    const dayCoursesMap = {}, dayRestMap = {};
    if (mesoObj) for (const x of (mesoObj.days || [])) {
      if (x.rest) dayRestMap[x.date] = true;
      (dayCoursesMap[x.date] = dayCoursesMap[x.date] || []).push(...Store.dayCourses(x));
    }
    const sesMap = {};
    for (const s of Store.data.sessions) {
      // 优先用 microId 直接匹配，fallback 到日期范围匹配（兼容旧数据）
      const inMicro = s.microId ? s.microId === micro.id : (s.date >= micro.startDate && s.date <= micro.endDate);
      if (inMicro) (sesMap[s.date] = sesMap[s.date] || []).push(s);
    }
    const CN_S = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    const courseTypeOf = (c, date) => {
      if (c.type) return c.type;
      const dy = micro.days.find((x) => x.date === date);
      return dy && dy.type && dy.type !== '休息' ? dy.type : '';
    };
    // 训练类型列：中周期当日设定了什么课程就显示什么；一天多课不同类型 → 第一节：xx / 第二节：xx
    const dayTypeCell = (date) => {
      if (dayRestMap[date]) return '<span class="chip">休息</span>';
      const courses = dayCoursesMap[date] || [];
      if (courses.length === 1) return `<span class="chip volt">${U.esc(courseTypeOf(courses[0], date) || '未分类')}</span>`;
      if (courses.length > 1) return courses.map((c, i) =>
        `<div style="line-height:1.9">第${CN_S[i]}节：<b style="color:var(--tx)">${U.esc(courseTypeOf(c, date) || '未分类')}</b></div>`).join('');
      const dy = micro.days.find((x) => x.date === date);
      return dy && dy.type ? `<span class="hint">${U.esc(dy.type)}</span>` : '<span class="hint">—</span>';
    };
    // 当日计划列：逐节显示具体课程计划（动作清单），点击进入当天训练课页
    const dayPlanCell = (date) => {
      if (dayRestMap[date]) return '<span class="hint">—</span>';
      const courses = dayCoursesMap[date] || [];
      const blocks = courses.map((c, i) => {
        const type = courseTypeOf(c, date);
        const names = (c.rows || []).map((r) => { const ex = Store.exercise(r.exId); return ex ? ex.name : ''; }).filter(Boolean);
        const head = (courses.length > 1 ? `第${CN_S[i]}节` : '课程') + (type ? ' · ' + U.esc(type) : '');
        const body = names.length
          ? U.esc(names.slice(0, 4).join(' · ')) + (names.length > 4 ? ` 等 ${names.length} 项` : '')
          : '<span style="opacity:.65">未安排动作</span>';
        return `<div class="plan-line" data-gses="${date}" title="点击进入 ${U.cn(date)} 的训练课页">
          <span class="chip ${names.length ? 'volt' : ''}">${head}</span>
          <span class="hint" style="line-height:1.6">${body}</span>
        </div>`;
      }).join('');
      if (blocks) return blocks;
      const slist = sesMap[date] || [];
      return slist.length
        ? `<span class="chip" data-gses="${date}" style="cursor:pointer" title="查看当日训练课">${slist.length} 节课（点击进入）</span>`
        : '<span class="hint">—</span>';
    };

    // 强度分档统计：休息日（中周期标休）与未排课日（当日无课程无训练课）不参与强度分档，归入「低强度/休息」
    const isOffDay = (date) => dayRestMap[date] || (!(dayCoursesMap[date] || []).length && !(sesMap[date] || []).length);
    el.innerHTML = `
      <div class="card-title">
        <h3>${U.esc(micro.name)}</h3>
        <div class="row">
          <span class="sub">${U.cn(micro.startDate)} — ${U.cn(micro.endDate)}</span>
          <button class="btn sm" id="micEdit">编辑</button>
          <button class="btn sm danger" id="micDel">删除</button>
        </div>
      </div>
      <div class="goal-rows" style="margin-bottom:12px">
        <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
          <span class="goal-tag">小周期主要</span>${U.goalChips(mgSelf.primary, 'primary')}
          ${mgSelf.secondary && mgSelf.secondary.length ? `<span class="goal-tag" style="margin-left:6px">次要</span>${U.goalChips(mgSelf.secondary, 'secondary')}` : ''}
          <button class="btn sm ghost" id="micGoalEdit" style="padding:2px 10px">编辑目标</button>
        </div>
      </div>
      <div style="overflow-x:auto"><table class="tbl">
        <thead><tr><th style="width:120px">日期</th><th style="width:170px">训练类型</th><th>当日训练计划（点击进入当天训练课）</th><th style="width:220px">当日主题 / 备注</th></tr></thead>
        <tbody>
          ${micro.days.map((day, i) => `
            <tr data-i="${i}">
              <td><b class="num">${U.md(day.date)}</b> <span class="hint">${U.wd(day.date)}</span>${Store.compOn(day.date) ? ' <span class="chip red">赛</span>' : ''}</td>
              <td>${dayTypeCell(day.date)}</td>
              <td>${dayPlanCell(day.date)}</td>
              <td><input class="ipt" style="width:100%" data-f="note" value="${U.esc(day.note || '')}"></td>
            </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="grid2" style="margin-top:16px">
        <div><div class="card-title" style="margin-bottom:6px"><h3 style="font-size:14px">每日强度节奏</h3><span class="sub">强度 % · 训练量与疲劳</span></div><div class="chart chart-sm" id="chMicro"></div></div>
        <div class="kpis" style="grid-template-columns:1fr 1fr">
          <div class="kpi bad"><div class="k">高强度日 (≥80%)</div><div class="v">${micro.days.filter((x) => !isOffDay(x.date) && (x.intensity || 0) >= 80).length}<small>天</small></div></div>
          <div class="kpi warn"><div class="k">中强度日 (50-79%)</div><div class="v">${micro.days.filter((x) => !isOffDay(x.date) && (x.intensity || 0) >= 50 && (x.intensity || 0) < 80).length}<small>天</small></div></div>
          <div class="kpi ok"><div class="k">低强度/休息 (<50%)</div><div class="v">${micro.days.filter((x) => isOffDay(x.date) || (x.intensity || 0) < 50).length}<small>天</small></div></div>
          <div class="kpi info"><div class="k">周训练负荷</div><div class="v">${U.fmt(weekAU(micro) / 1000, 1)}<small>k AU</small></div><div class="d">全队实际 sRPE 负荷合计</div></div>
        </div>
      </div>
      ${mesoObj ? `
      <div style="margin-top:16px">
        <div class="card-title" style="margin-bottom:6px"><h3 style="font-size:14px">实际训练负荷与课次统计</h3><span class="sub">本小周期 · 按日</span></div>
        <div class="chart chart-sm" id="chMicroActual"></div>
      </div>` : ''}`;

    // 绑定
    // 当日训练计划点击 → 进入当天训练课页（定位该日）
    $$('[data-gses]', el).forEach((c) => {
      c.onclick = () => {
        if (Views.session && Views.session.state) Views.session.state.date = c.dataset.gses;
        location.hash = '#/session';
      };
    });
    $$('tbody tr', el).forEach((tr) => {
      const i = Number(tr.dataset.i);
      const day = micro.days[i];
      tr.querySelector('[data-f="note"]').onchange = (e) => { day.note = e.target.value; Store.save(); };
    });
    el.querySelector('#micGoalEdit').onclick = () => UI.goalPicker(micro.goals || {}, (sel) => {
      micro.goals = sel; Store.save(); renderDetail(v); UI.toast('小周期目标已更新', 'ok');
    });
    el.querySelector('#micEdit').onclick = () => microDialog(micro, micro.mesoId);
    el.querySelector('#micDel').onclick = () => UI.confirm(`删除小周期「${U.esc(micro.name)}」？`, () => {
      Store.data.micros = Store.data.micros.filter((m) => m.id !== micro.id);
      state.microId = null; Store.save(); mount();
    });
    renderChart(el, micro);
    renderActualChart(el, micro);

    // 实际训练负荷与课次统计（本小周期 · 全队已完成训练课，按日）
    function renderActualChart(box, m) {
      const chEl = box.querySelector('#chMicroActual');
      if (!chEl || !mesoObj) return;
      const ds = m.days.map((x) => x.date);
      const byDate = {};
      ds.forEach((d) => { byDate[d] = { load: 0, ses: 0 }; });
      for (const e of Store.data.loadEntries) {
        if (e.date < m.startDate || e.date > m.endDate) continue;
        if (byDate[e.date]) byDate[e.date].load += Number(e.load) || 0;
      }
      for (const ses of Store.data.sessions) {
        if (ses.date < m.startDate || ses.date > m.endDate) continue;
        if (byDate[ses.date]) byDate[ses.date].ses += 1;
      }
      const ch = UI.chart(chEl);
      ch.setOption({
        grid: { left: 50, right: 56, top: 30, bottom: 24 },
        legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 } },
        tooltip: Object.assign({}, UI.tooltipCommon, {
          formatter: (ps) => {
            if (!ps || !ps.length) return '';
            const lines = ps.filter((p) => p.value != null).map((p) => `${p.marker}${p.seriesName}：<b>${U.fmt(p.value)}</b>`);
            return `${U.md(ps[0].axisValue)} ${U.wd(ps[0].axisValue)}<br/>` + (lines.join('<br/>') || '无已完成训练课');
          }
        }),
        xAxis: { type: 'category', data: ds, axisLabel: Object.assign({ formatter: (v) => U.md(v) }, UI.axisCommon.axisLabel) },
        yAxis: [
          Object.assign({ type: 'value', name: 'AU', nameTextStyle: { color: UI.cssVar('var(--color-ink-subtle)') } }, UI.axisCommon),
          Object.assign({ type: 'value', name: '课次', nameTextStyle: { color: UI.cssVar('var(--color-ink-subtle)') } }, UI.axisCommon, { splitLine: { show: false } })
        ],
        series: [
          { name: '全队负荷（AU）', type: 'bar', data: ds.map((x) => byDate[x].load || null), barMaxWidth: 22,
            itemStyle: { borderRadius: [4, 4, 0, 0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: UI.tint('var(--color-info)', .85) }, { offset: 1, color: UI.tint('var(--color-info)', .25) }] } } },
          { name: '训练课次', type: 'line', yAxisIndex: 1, data: ds.map((x) => byDate[x].ses || null), smooth: true, lineStyle: { color: '#ff9f43', width: 2.5 }, itemStyle: { color: '#ff9f43' }, symbolSize: 6, connectNulls: true }
        ]
      });
    }

    function renderChart(box, m) {
      const ch = UI.chart(box.querySelector('#chMicro'));
      const colors = m.days.map((x) => ((x.intensity || 0) >= 80 ? UI.cssVar('var(--color-danger)') : (x.intensity || 0) >= 50 ? UI.cssVar('var(--color-warning)') : UI.cssVar('var(--color-success)')));
      // 全队实际负荷 AU：训练量（当日合计）+ 疲劳（EWMA 7d），向前多取 42 天预热
      const start = U.addDays(m.startDate, -42), end = m.endDate;
      const series = Calc.dailySeries(Store.data.loadEntries, start, end);
      const fat = Calc.ewma(series, 7);
      const auMap = {}, fatMap = {};
      for (const p of series) auMap[p.date] = Math.round(p.load);
      for (const p of fat) fatMap[p.date] = Math.round(p.value);
      ch.setOption({
        grid: { left: 40, right: 44, top: 30, bottom: 24 },
        legend: { top: 0, right: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 } },
        tooltip: Object.assign({}, UI.tooltipCommon, {
          formatter: (ps) => {
            const arr = Array.isArray(ps) ? ps : [ps];
            if (!arr.length) return '';
            let s = `${U.md(arr[0].axisValue)} ${U.wd(arr[0].axisValue)}`;
            for (const p of arr) s += `<br/>${p.marker}${p.seriesName}：<b>${p.value != null ? p.value : '—'}${p.seriesName.includes('%') ? '%' : ' AU'}</b>`;
            return s;
          }
        }),
        xAxis: { type: 'category', data: m.days.map((x) => x.date), axisLabel: Object.assign({}, UI.axisCommon.axisLabel, { fontSize: 9, interval: 0, formatter: (v) => U.md(v) + '\n' + U.wd(v) }) },
        yAxis: [
          Object.assign({ type: 'value', max: 100, axisLabel: { formatter: '{value}%' } }, UI.axisCommon),
          Object.assign({ type: 'value', scale: true, splitLine: { show: false } }, UI.axisCommon)
        ],
        series: [
          { name: '强度（%）', type: 'bar', data: m.days.map((x) => x.intensity ?? 0), barMaxWidth: 18, itemStyle: { borderRadius: [4, 4, 0, 0], color: (p) => colors[p.dataIndex] } },
          { name: '训练量（AU）', type: 'line', yAxisIndex: 1, data: m.days.map((x) => auMap[x.date] ?? 0), smooth: true, symbolSize: 4, lineStyle: { width: 2, color: UI.cssVar('var(--color-info)') }, itemStyle: { color: UI.cssVar('var(--color-info)') } },
          { name: '疲劳（AU）', type: 'line', yAxisIndex: 1, data: m.days.map((x) => fatMap[x.date] ?? 0), smooth: true, symbolSize: 4, lineStyle: { width: 2, type: 'dashed', color: UI.cssVar('var(--color-danger)') }, itemStyle: { color: UI.cssVar('var(--color-danger)') } }
        ]
      });
    }
  }

  function mount(v) {
    if (v == null) v = $('#view');
    UI.disposeCharts();
    v.innerHTML = `
      <div class="card" id="microSide" style="margin-bottom:14px"></div>
      <div class="card" id="microDetail"></div>`;
    renderSide(v);
    renderDetail(v);
  }

  // 供中周期页点击小周期跳转并定位
  function show(id) {
    const mic = Store.data.micros.find((m) => m.id === id);
    if (mic) { state.mesoId = mic.mesoId; state.microId = id; }
    if (location.hash === '#/micro') mount();
    else location.hash = '#/micro';
  }

  // 实时分析：训练课课后保存/手动录入 → 小周期实际负荷与课次看板自动重算
  Store.subscribe(() => {
    if (location.hash.replace('#/', '') !== 'micro') return;
    const view = $('#view');
    if (view && view.querySelector('#microDetail')) mount(view);
  });

  return { mount, state, show };
})();
