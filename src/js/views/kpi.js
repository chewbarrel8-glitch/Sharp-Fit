// KPI 分析页：运动员全部体能分析（KPI 看板 / 雷达 / Z 分数 / FMS / 纵向趋势 / 团队排名）
// 数据层复用档案页（Views.profile）导出的辅助函数，本页只负责时期筛选与可视化
// 分析框架参考：《NSCA-CPSS 美国国家体能协会运动表现与科学训练师认证指南》第5章 KPI · 第6章 建档与基准测试
Views.kpi = (() => {
  const P = Views.profile;
  // kpiDate=null means latest data; trendMetric: ''=all metrics, p:<field>=fitness metric, r:<exercise>=1RM; rmExId/rmRange=1RM board exercise/range; dashboardId=active dashboard; viewMode=personal|team
  const state = { athleteId: null, kpiDate: null, trendMetric: '', rmExId: null, rmRange: '', dashboardId: null, viewMode: 'personal', teamAthIds: null };   // teamAthIds: null = whole roster; array of athlete ids = filtered subset

  // 指标问号提示：悬停显示原生提示，点击弹出指标说明与计算方法弹窗（ref 为文献引用，拼接在末尾）
  const qTip = (t, ref) => { const full = ref ? `${t}　—　文献来源：${ref}` : t; return `<button type="button" class="qmark" aria-label="查看指标说明" title="${U.esc(full)}" data-tip="${U.esc(full)}">?</button>`; };
  // 文献引用来源
  const REFS = {
    hopkins09: 'Hopkins WG, Marshall SW, Batterham AM, et al. Progressive statistics for studies in sports medicine and exercise science. Sports Med, 2009; 39(3):213-231.（SWC/CV/百分位统计框架）',
    hopkins00: 'Hopkins WG. A new view of statistics. sportsci.org, 2000.（效应量与最小有意义变化 SWC）'
  };
  const refTxt = (...keys) => keys.map((k) => REFS[k]).join('；');

  // ---------- 图表（自档案页迁入，改用 P. 数据层） ----------
  // FMS 个人雷达图：7 轴 0-3 分，最新档案为主线，叠加基线对照
  function initFms(box, recs) {
    if (!box) return;
    const cur = recs[recs.length - 1];
    const base = recs.length > 1 ? recs[0] : null;
    const vals = (p) => P.FMS_TESTS.map((t) => (p.fms[t.key] != null ? p.fms[t.key] : 0));
    const chart = UI.chart(box);
    const data = [
      { value: vals(cur), name: U.md(cur.date), areaStyle: { color: UI.tint('var(--color-info)', .25) }, lineStyle: { color: UI.cssVar('var(--color-info)'), width: 2.5 }, itemStyle: { color: UI.cssVar('var(--color-info)') } },
      { value: P.FMS_TESTS.map(() => 3), name: '满分 3', areaStyle: { color: UI.tint('var(--color-success)', 0) }, lineStyle: { color: UI.cssVar('var(--color-success)'), width: 1, type: 'dashed' }, itemStyle: { color: UI.cssVar('var(--color-success)') }, symbol: 'none' }
    ];
    if (base && base !== cur) data.push({ value: vals(base), name: '基线 ' + U.md(base.date), areaStyle: { color: UI.tint('var(--color-accent)', .05) }, lineStyle: { color: UI.cssVar('var(--color-accent)'), width: 1.5, type: 'dotted' }, itemStyle: { color: UI.cssVar('var(--color-accent)') } });
    chart.setOption({
      tooltip: Object.assign({ trigger: 'item' }, UI.tooltipCommon, { formatter: (ps) => (Array.isArray(ps) ? ps : [ps]).map((p) => `${p.marker}${p.seriesName}：<b>${p.value}</b> / 3`).join('<br/>') }),
      radar: { indicator: P.FMS_TESTS.map((t) => ({ name: t.label, max: 3, min: 0 })), radius: '62%', center: ['50%', '52%'],
        axisName: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 }, splitArea: { areaStyle: { color: [UI.tint('var(--color-info)', .03), UI.tint('var(--color-info)', .06)] } },
        splitLine: { lineStyle: { color: UI.tint('var(--color-ink-muted)', .15) } }, axisLine: { lineStyle: { color: UI.tint('var(--color-ink-muted)', .15) } } },
      legend: { textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 }, top: 4, right: 10 },
      series: [{ type: 'radar', data }]
    });
  }

  function initRadar(box, ath, aths, refDate) {
    const labels = P.allMetrics().filter((m) => P.getMetric(ath.id, m, refDate) != null);
    const athScores = labels.map((m) => Math.max(0, Math.min(100, 50 + P.metricZ(ath.id, aths, m, refDate) * 16.67)));
    const baseline = P.getProfiles(ath.id, refDate)[0];
    const baseScores = baseline ? labels.map((m) => {
      if ((m.source === 'profile' || m.source === 'custom') && P.profileVal(baseline, m) != null) {
        const arr = P.teamValues(aths, m, refDate);
        const z = arr.length >= 2 ? (m.invert ? -Calc.zScore(P.profileVal(baseline, m), arr) : Calc.zScore(P.profileVal(baseline, m), arr)) : 0;
        return Math.max(0, Math.min(100, 50 + z * 16.67));
      }
      return 50;
    }) : null;
    // Previous-test overlay (spider-chart before/after comparison, per assessment-book method)
    const profs = P.getProfiles(ath.id);
    const prevProf = profs.length >= 2 ? profs[profs.length - 2] : null;
    const prevScores = prevProf ? labels.map((m) => {
      if ((m.source === 'profile' || m.source === 'custom') && P.profileVal(prevProf, m) != null) {
        const arr = P.teamValues(aths, m, refDate);
        const z = arr.length >= 2 ? (m.invert ? -Calc.zScore(P.profileVal(prevProf, m), arr) : Calc.zScore(P.profileVal(prevProf, m), arr)) : 0;
        return Math.max(0, Math.min(100, 50 + z * 16.67));
      }
      return null;
    }) : null;
    const chart = UI.chart(box);
    const data = [
      { value: athScores, name: ath.name + '（本次）', areaStyle: { color: UI.tint('var(--color-info)', .25) }, lineStyle: { color: UI.cssVar('var(--color-info)'), width: 2.5 }, itemStyle: { color: UI.cssVar('var(--color-info)') } },
      { value: labels.map(() => 50), name: '团队均值', areaStyle: { color: UI.tint('var(--color-success)', .05) }, lineStyle: { color: UI.cssVar('var(--color-success)'), width: 1.5, type: 'dashed' }, itemStyle: { color: UI.cssVar('var(--color-success)') } }
    ];
    if (prevScores) data.push({ value: prevScores, name: '上次测试 ' + U.md(prevProf.date), areaStyle: { color: 'transparent' }, lineStyle: { color: UI.cssVar('var(--color-warning)'), width: 2, type: 'dashed' }, itemStyle: { color: UI.cssVar('var(--color-warning)'), connectNulls: true } });
    if (baseScores) data.push({ value: baseScores, name: '初始基线', areaStyle: { color: UI.tint('var(--color-accent)', .05) }, lineStyle: { color: UI.cssVar('var(--color-accent)'), width: 1.5, type: 'dotted' }, itemStyle: { color: UI.cssVar('var(--color-accent)') } });
    chart.setOption({
      tooltip: Object.assign({ trigger: 'item' }, UI.tooltipCommon, { formatter: (ps) => (Array.isArray(ps) ? ps : [ps]).map((p) => `${p.marker}${p.seriesName}：<b>${Number(p.value).toFixed(1)}</b>`).join('<br/>') }),
      radar: { indicator: labels.map((m) => ({ name: m.label, max: 100, min: 0 })), radius: '62%', center: ['50%', '52%'],
        axisName: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 }, splitArea: { areaStyle: { color: [UI.tint('var(--color-info)', .03), UI.tint('var(--color-info)', .06)] } },
        splitLine: { lineStyle: { color: UI.tint('var(--color-ink-muted)', .15) } }, axisLine: { lineStyle: { color: UI.tint('var(--color-ink-muted)', .15) } } },
      legend: { textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 }, top: 4, right: 10 },
      series: [{ type: 'radar', data }]
    });
  }

  function initZBar(box, ath, aths, items, refDate) {
    const zVals = items.map((m) => P.metricZ(ath.id, aths, m, refDate));
    const maxAbs = Math.max(1, ...zVals.map(Math.abs));
    const yMax = Math.ceil(maxAbs * 1.3);
    const chart = UI.chart(box);
    // 伪 3D 柱：正面渐变 + 顶盖高光 + 右侧暗面（DX/DY 为深度偏移）；数值标在柱末端外侧（正柱顶上 / 负柱底下），不贴柱体也不贴横轴
    const DX = 7, DY = 5;
    const palette = (z) => z > 0 ? { top: UI.cssVar('var(--color-success)'), bottom: UI.tint('var(--color-success)', .62), cap: UI.cssVar('var(--color-success)'), side: UI.tint('var(--color-success)', .5) }
      : z < 0 ? { top: UI.cssVar('var(--color-info)'), bottom: UI.tint('var(--color-info)', .62), cap: UI.cssVar('var(--color-info)'), side: UI.tint('var(--color-info)', .5) }
        : { top: UI.cssVar('var(--color-ink-muted)'), bottom: UI.tint('var(--color-ink-muted)', .5), cap: UI.cssVar('var(--color-ink-muted)'), side: UI.tint('var(--color-ink-subtle)', .55) };
    chart.setOption({
      grid: { left: 50, right: 30, top: 44, bottom: 92 },
      legend: { show: true, top: 4, right: 10, itemWidth: 14, itemHeight: 10, itemGap: 16,
        textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 },
        data: [{ name: '个人数据', icon: 'roundRect' }, { name: '团队均值', icon: 'rect' }] },
      tooltip: Object.assign({}, UI.tooltipCommon, {
        formatter: (ps) => { const p = Array.isArray(ps) ? ps[0] : ps; const val = Array.isArray(p.value) ? p.value[1] : p.value;
          return `${items[p.dataIndex].label}<br/>Z分数：<b style="color:${val > 0 ? UI.cssVar('var(--color-success)') : val < 0 ? UI.cssVar('var(--color-danger)') : UI.cssVar('var(--color-ink-muted)')}">${val > 0 ? '+' : ''}${Number(val).toFixed(2)}σ</b>`; } }),
      // 注意：axisCommon 必须在前——其 axisLabel 会整体覆盖后设的 interval/rotate（曾致项目名被截断跳隔）
      xAxis: Object.assign({}, UI.axisCommon, { type: 'category', data: items.map((m) => m.label), axisLabel: Object.assign({}, UI.axisCommon.axisLabel, { interval: 0, rotate: 45 }) }),
      yAxis: Object.assign({ type: 'value', min: -yMax, max: yMax, axisLabel: Object.assign({}, UI.axisCommon.axisLabel, { formatter: (v2) => (v2 > 0 ? '+' : '') + v2 + 'σ' }) }, UI.axisCommon, { splitLine: { lineStyle: { color: UI.tint('var(--color-ink)', .06) } } }),
      series: [
        { name: '个人数据', type: 'custom', itemStyle: { color: UI.cssVar('var(--color-success)') },
          renderItem: (params, api) => {
            const i = params.dataIndex;
            const z = api.value(1);
            const c = palette(z);
            const cx = api.coord([i, 0])[0], yZero = api.coord([i, 0])[1], yEnd = api.coord([i, z])[1];
            const halfW = Math.min(9, api.size([0.36, 0])[0] / 2);
            const x0 = cx - halfW, x1 = cx + halfW;
            const topY = Math.min(yZero, yEnd), botY = Math.max(yZero, yEnd);
            const capY = z >= 0 ? topY : botY;   // 顶盖始终在数值端（正柱顶端 / 负柱底端）
            const poly = (pts, fill) => ({ type: 'polygon', shape: { points: pts }, style: { fill } });
            const children = [
              poly([[x0, topY], [x1, topY], [x1, botY], [x0, botY]], new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: c.top }, { offset: 1, color: c.bottom }])),
              poly([[x1, topY], [x1 + DX, topY - DY], [x1 + DX, botY - DY], [x1, botY]], c.side),
              poly([[x0, capY], [x1, capY], [x1 + DX, capY - DY], [x0 + DX, capY - DY]], c.cap)
            ];
            if (Math.abs(z) > 0.001) children.push({ type: 'text', style: { text: (z > 0 ? '+' : '') + z.toFixed(2), x: cx + 3, y: z >= 0 ? capY - DY - 10 : capY + DY + 12, fill: UI.cssVar('var(--color-ink)'), stroke: UI.tint('var(--color-background)', .9), lineWidth: 3, font: '600 12px sans-serif', textAlign: 'center', textVerticalAlign: 'middle' } });
            return { type: 'group', children };
          },
          data: zVals.map((z, i) => [i, +z.toFixed(2)]) },
        { name: '团队均值', type: 'line', data: [],
          markLine: { silent: true, symbol: 'none', lineStyle: { color: UI.tint('var(--color-ink)', 0.4), width: 1.5, type: 'solid' },
            label: { show: true, formatter: '团队均值', color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, position: 'insideStartBottom' },
            data: [{ yAxis: 0 },
              { yAxis: 0.5, lineStyle: { color: UI.tint('var(--color-success)', 0.5), type: 'dashed' }, label: { show: true, formatter: '+0.5σ 领先', color: UI.cssVar('var(--color-success)'), fontSize: 9, position: 'insideEndTop' } },
              { yAxis: -0.5, lineStyle: { color: UI.tint('var(--color-danger)', 0.5), type: 'dashed' }, label: { show: true, formatter: '-0.5σ 待提升', color: UI.cssVar('var(--color-danger)'), fontSize: 9, position: 'insideEndBottom' } }] } }
      ]
    });
  }

  function initTrend(box, td) {
    if (!box) return;
    const chart = UI.chart(box);
    // x 轴 = 体能档案与 1RM 历史的唯一日期并集：同一天多次录入合并为一个趋势点（避免出现重复日期）
    const dateSet = new Set(td.profiles.map((p) => p.date));
    (td.rmTrend || []).forEach((s) => s.dates.forEach((d) => dateSet.add(d)));
    const ds = [...dateSet].sort();
    const dates = ds.map((d) => U.md(d));
    // 同一天多条档案合并：组内同字段取最后非空值
    const profByDate = {};
    td.profiles.forEach((p) => {
      const cur = Object.assign({}, profByDate[p.date]);
      Object.keys(p).forEach((k) => { if (p[k] !== null && p[k] !== undefined && p[k] !== '') cur[k] = p[k]; });
      profByDate[p.date] = cur;
    });
    const series = [];
    let yAxes = null;
    // 单一测试项目视图（下拉选择）：体能/身体成分/自定义指标显示实际值（左轴=单位），1RM 显示 kg 测定史
    const sel = state.trendMetric || '';
    if (sel.startsWith('p:')) {
      const m = P.allMetrics().find((x) => x.field === sel.slice(2));
      if (m) {
        const valAt = m.source === 'custom'
          ? (d) => { const c = ((profByDate[d] || {}).custom || []).find((c) => c && c.name === m.field); return c && c.value != null ? c.value : null; }
          : (d) => { const v2 = (profByDate[d] || {})[m.field]; return v2 == null ? null : v2; };
        series.push({ name: m.label, type: 'line', connectNulls: true, data: ds.map(valAt), smooth: true, showSymbol: true, symbolSize: 6, itemStyle: { color: UI.cssVar('var(--color-info)') }, lineStyle: { color: UI.cssVar('var(--color-info)'), width: 2 } });
        yAxes = [Object.assign({ type: 'value', name: m.unit }, UI.axisCommon, { splitLine: { show: false } })];
      }
    } else if (sel.startsWith('r:')) {
      const s = (td.rmTrend || []).find((x) => x.name === sel.slice(2) && x.dates.length >= 2);
      if (s) {
        const mm = {};
        s.dates.forEach((d, i) => { mm[d] = s.vals[i]; });
        series.push({ name: s.name + ' 1RM', type: 'line', connectNulls: true, data: ds.map((d) => mm[d] != null ? mm[d] : null), smooth: true, showSymbol: true, symbolSize: 6, itemStyle: { color: UI.cssVar('var(--color-accent)') }, lineStyle: { color: UI.cssVar('var(--color-accent)'), width: 2, type: 'dashed' } });
        yAxes = [Object.assign({ type: 'value', name: 'kg' }, UI.axisCommon, { splitLine: { show: false } })];
      }
    }
    // 组合视图（默认「全部指标」）：全部体能指标归一化趋势（0-100）+ 全部 1RM 历史实际值（kg，右轴）
    if (!series.length) {
      // 全部体能指标归一化趋势（0-100，100 = 该指标区间内最佳：计时类越小越好需反向归一）
      td.changeRows.forEach((cr) => {
        const vals = td.profiles.map((p) => P.profileVal(p, cr.m)).filter((v) => v != null);
        const min = Math.min(...vals), max = Math.max(...vals);
        series.push({ name: cr.m.label, type: 'line', connectNulls: true, data: ds.map((d) => {
          const v2 = P.profileVal(profByDate[d] || {}, cr.m);
          if (v2 == null) return null;
          if (!(max > min)) return 50;
          return Math.round((cr.m.invert ? (max - v2) : (v2 - min)) / (max - min) * 100);
        }), smooth: true, showSymbol: true, symbolSize: 6 });
      });
      // 全部 1RM 历史实际值（kg，右轴）：按日期映射到统一 x 轴
      if (td.rmTrend) {
        td.rmTrend.forEach((s) => {
          const m = {};
          s.dates.forEach((d, i) => { m[d] = s.vals[i]; });
          series.push({ name: s.name + ' 1RM', type: 'line', yAxisIndex: 1, connectNulls: true, data: ds.map((d) => m[d] != null ? m[d] : null), smooth: true, showSymbol: true, symbolSize: 6, lineStyle: { width: 2, type: 'dashed' } });
        });
      }
      yAxes = [
        Object.assign({ type: 'value', name: '归一化', max: 100 }, UI.axisCommon, { splitLine: { show: false } }),
        Object.assign({ type: 'value', name: 'kg', position: 'right' }, UI.axisCommon, { splitLine: { show: false } })
      ];
    }
    // 图例：指标多时滚动显示，左右留出纵轴刻度宽度，避免与坐标标签重叠
    const legendCfg = Object.assign({ textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 }, top: 0, left: 46, right: 46 },
      series.length > 6 ? { type: 'scroll', pageIconColor: UI.cssVar('var(--color-accent)'), pageTextStyle: { color: UI.cssVar('var(--color-ink-muted)') } } : {});
    chart.setOption({
      grid: { left: 46, right: 46, top: 46, bottom: 30 },
      legend: legendCfg,
      tooltip: Object.assign({}, UI.tooltipCommon, { formatter: (ps) => { const arr = Array.isArray(ps) ? ps : [ps]; const t = arr[0].axisValue != null ? arr[0].axisValue : arr[0].name; return `${t}<br/>` + arr.map((p) => `${p.marker}${p.seriesName}：<b>${p.value}</b>`).join('<br/>'); } }),
      xAxis: { type: 'category', data: dates, axisLabel: Object.assign({ interval: 0 }, UI.axisCommon.axisLabel) },
      yAxis: yAxes,
      series
    });
  }

  // 1RM 力量变化看板：单动作按日期折线 + 最高/最低标注 + 均值虚线（标签置顶避免与轴刻度重叠）
  function initRmTrend(box, td) {
    if (!box) return;
    const chart = UI.chart(box);
    const vals = td.pts.map((p) => p.value);
    const mean = U.avg(vals);
    chart.setOption({
      grid: { left: 56, right: 36, top: 34, bottom: 32 },
      tooltip: Object.assign({}, UI.tooltipCommon, { formatter: (ps) => { const p = Array.isArray(ps) ? ps[0] : ps; const r = td.pts[p.dataIndex];
        return `<b>${U.esc(td.exName)} 1RM</b><br/>${U.md(r.date)} · <b>${r.value} kg</b>${r.method ? '<br/>' + U.esc(r.method) : ''}${r.source === 'session' ? ' · 训练课估算' : ''}`; } }),
      xAxis: { type: 'category', data: td.pts.map((p) => U.md(p.date)), axisLabel: Object.assign({ interval: 0 }, UI.axisCommon.axisLabel) },
      yAxis: Object.assign({ type: 'value', scale: true, name: 'kg' }, UI.axisCommon),
      series: [{
        name: td.exName + ' 1RM', type: 'line', data: vals, smooth: true, showSymbol: true, symbolSize: 7,
        itemStyle: { color: UI.cssVar('var(--color-accent)') }, lineStyle: { color: UI.cssVar('var(--color-accent)'), width: 2.5 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: UI.tint('var(--color-accent)', .22) }, { offset: 1, color: UI.tint('var(--color-accent)', 0) }]) },
        label: { show: true, position: 'top', color: UI.cssVar('var(--color-ink)'), fontSize: 10, formatter: '{c}' },
        markLine: vals.length >= 2 ? { silent: true, symbol: 'none', lineStyle: { color: UI.tint('var(--color-ink)', .3), type: 'dashed' },
          label: { show: true, position: 'insideStartTop', formatter: '均值 ' + U.fmt(mean) + ' kg', color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 }, data: [{ yAxis: +mean.toFixed(1) }] } : undefined
      }]
    });
  }

  // KPI 看板 · 团队百分位横条图（图形化展示，明细进 tooltip）
  function initKpiPct(box, rows) {
    if (!box) return;
    const chart = UI.chart(box);
    chart.setOption({
      grid: { left: 92, right: 116, top: 24, bottom: 26 },
      tooltip: Object.assign({}, UI.tooltipCommon, {
        formatter: (ps) => { const p = Array.isArray(ps) ? ps[0] : ps; const r = rows[p.dataIndex];
          return `<b>${U.esc(r.m.label)}</b><br/>当前：<b>${r.cur}${r.m.unit}</b><br/>团队均值：${r.mean}${r.m.unit}<br/>CV：${r.cv} · SWC：${r.swc}<br/>Z：${r.z > 0 ? '+' : ''}${r.z.toFixed(2)}σ · 百分位：${r.pct}%`; } }),
      xAxis: Object.assign({}, UI.axisCommon, { type: 'value', min: 0, max: 100, splitLine: { lineStyle: { color: UI.tint('var(--color-ink)', 0.06) } }, axisLabel: Object.assign({}, UI.axisCommon.axisLabel, { formatter: '{value}%' }) }),
      yAxis: Object.assign({}, UI.axisCommon, { type: 'category', inverse: true, data: rows.map((r) => r.m.label), axisLabel: Object.assign({}, UI.axisCommon.axisLabel, { fontSize: 11 }) }),
      series: [{
        type: 'bar', barWidth: 14,
        data: rows.map((r) => ({ value: r.pct, itemStyle: { color: r.pct >= 75 ? UI.cssVar('var(--color-success)') : r.pct <= 25 ? UI.cssVar('var(--color-danger)') : UI.cssVar('var(--color-warning)'), borderRadius: [0, 7, 7, 0] } })),
        label: { show: true, position: 'right', distance: 6, color: UI.cssVar('var(--color-ink)'), fontSize: 11,
          formatter: (p) => { const r = rows[p.dataIndex]; return `${r.cur}${r.m.unit} · ${r.pct}%`; } },
        markLine: { silent: true, symbol: 'none', lineStyle: { color: UI.tint('var(--color-ink)', .35), type: 'dashed' },
          label: { show: true, formatter: '均值 50', color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, position: 'start', distance: 4 }, data: [{ xAxis: 50 }] }
      }]
    });
  }

  // KPI 看板 · 基线→当前变化正负横条图（增长绿 / 下降红，invert 指标按好/坏判色）
  function initKpiDelta(box, rows) {
    if (!box) return;
    const chart = UI.chart(box);
    const maxAbs = Math.max(5, ...rows.map((r) => Math.abs(r.deltaCur)));
    // Color by change classification: confirmed (solid) / possible (60% alpha) / noise (gray)
    const cSuc = UI.cssVar('var(--color-success)'), cDan = UI.cssVar('var(--color-danger)'), cMut = UI.cssVar('var(--color-ink-muted)');
    const barColor = (r) => {
      const good = r.m.invert ? r.deltaCur < 0 : r.deltaCur > 0;
      const base = r.deltaCur === 0 ? cMut : good ? cSuc : cDan;
      if (!r.change) return base;
      if (r.change.cls === 'noise') return UI.alpha(cMut, .45);
      if (r.change.cls === 'possible') return UI.alpha(base, .55);
      return base;
    };
    chart.setOption({
      grid: { left: 92, right: 130, top: 10, bottom: 26 },
      tooltip: Object.assign({}, UI.tooltipCommon, {
        formatter: (ps) => { const p = Array.isArray(ps) ? ps[0] : ps; const r = rows[p.dataIndex];
          const word = r.deltaCur > 0 ? '增长' : r.deltaCur < 0 ? '下降' : '持平';
          let s = `<b>${U.esc(r.m.label)}</b><br/>Δ%：<b>${r.deltaCur > 0 ? '+' : ''}${r.deltaCur.toFixed(1)}% ${word}</b>`;
          if (r.change) {
            const icon = r.change.cls === 'confirmed' ? '✅' : r.change.cls === 'possible' ? '⚠️' : '⚪';
            s += `<br/>${icon} ${r.change.label}（|Δ| vs SWC / √2×TE 双阈值）`;
          } else if (r.swc !== '—' && Math.abs(r.deltaCur) >= parseFloat(r.swc)) {
            s += '<br/>⚠ 超过 SWC（变化有意义）';
          }
          if (r.teAbs != null) s += `<br/><span style="opacity:.7">TE（典型误差）：${r.teAbs.toFixed(2)}${r.m.unit || ''}</span>`;
          return s; } }),
      xAxis: Object.assign({}, UI.axisCommon, { type: 'value', min: -maxAbs * 1.2, max: maxAbs * 1.2, axisLabel: Object.assign({}, UI.axisCommon.axisLabel, { formatter: '{value}%' }) }),
      yAxis: Object.assign({}, UI.axisCommon, { type: 'category', inverse: true, data: rows.map((r) => r.m.label), axisLabel: Object.assign({}, UI.axisCommon.axisLabel, { fontSize: 11 }) }),
      series: [{
        type: 'bar', barWidth: 14,
        data: rows.map((r) => ({ value: +r.deltaCur.toFixed(1), itemStyle: { color: barColor(r), borderRadius: 7 } })),
        label: { show: true, position: 'right', distance: 6, color: UI.cssVar('var(--color-ink)'), fontSize: 11,
          formatter: (p) => { const r = rows[p.dataIndex]; const word = r.deltaCur > 0 ? '增长' : r.deltaCur < 0 ? '下降' : '持平';
            const tag = r.change ? (r.change.cls === 'confirmed' ? ' 确认' : r.change.cls === 'possible' ? ' 可能' : ' 噪声') : '';
            return `${r.deltaCur > 0 ? '+' : ''}${r.deltaCur.toFixed(1)}% ${word}${tag}`; },
          textBorderColor: UI.tint('var(--color-background)', .92), textBorderWidth: 3 },
        markLine: { silent: true, symbol: 'none', lineStyle: { color: UI.tint('var(--color-ink)', .35) }, label: { show: false }, data: [{ xAxis: 0 }] }
      }]
    });
  }

  // ---------- 分析主体：KPI 看板 → 雷达/Z → FMS → 趋势 → 团队排名（各自有数据才渲染） ----------
  // 运动员是否有测试数据（体能档案或 1RM 任一）——KPI 分析只展示有数据的运动员，选中即直接出分析
  function hasData(aid) {
    return P.getProfiles(aid).length > 0 || Object.keys(P.rmAsOf(aid)).length > 0;
  }

  // Team view: aggregate all athletes' metrics, show team-wide distribution & ranking
  function renderTeamKpi(v, el, aths) {
    const refDate = state.kpiDate;
    if (!aths.length) {
      el.innerHTML = `<p class="hint" style="padding:26px;text-align:center">当前训练计划暂无运动员</p>`;
      return;
    }
    // Get active dashboard widgets for the current view mode (personal/team are independent)
    const dash = activeDashboard();
    const dashWidgets = (dash && state.viewMode === 'team')
      ? (Array.isArray(dash.widgetsTeam) ? dash.widgetsTeam : dash.widgets)
      : (dash && Array.isArray(dash.widgets) ? dash.widgets : null);
    const widgets = (dashWidgets && dashWidgets.length) ? dashWidgets : Store.defaultKpiDashboards().items[0].widgets;
    const hasWidget = (id) => widgets.some((w) => w.id === id);

    const allMetrics = P.allMetrics();
    // For each metric, collect team values and compute stats
    const teamRows = allMetrics.map((m) => {
      const arr = P.teamValues(aths, m, refDate);
      if (!arr.length) return null;
      const mean = U.avg(arr);
      const sd = arr.length > 1 ? Math.sqrt(U.avg(arr.map((x) => (x - mean) ** 2))) : 0;
      const cv = mean > 0 ? (sd / mean * 100) : 0;
      const min = Math.min(...arr), max = Math.max(...arr);
      return { m, count: arr.length, mean, sd, cv: +cv.toFixed(1), min, max };
    }).filter(Boolean);

    if (!teamRows.length) {
      el.innerHTML = `<p class="hint" style="padding:26px;text-align:center">全队暂无测试数据——在「运动员档案」录入体能数据后，此处自动生成团队汇总分析</p>`;
      return;
    }

    // Team ranking (same as personal view's c_rank)
    let rankRows = null;
    if (aths.length >= 2) {
      const labels = allMetrics.filter((m) => P.teamValues(aths, m, refDate).length >= 2);
      rankRows = aths.map((a) => {
        const zs = labels.map((m) => P.metricZ(a.id, aths, m, refDate));
        const avgZ = U.avg(zs);
        return { ath: a, score: +Math.max(0, Math.min(100, 50 + avgZ * 16.67)).toFixed(1), avgZ: +avgZ.toFixed(2) };
      }).sort((a, b) => b.score - a.score).map((s) => {
        const labels2 = allMetrics.filter((m) => P.teamValues(aths, m, refDate).length >= 2);
        const athLabels = labels2.map((m) => ({ m, z: P.metricZ(s.ath.id, aths, m, refDate) })).sort((a, b) => b.z - a.z);
        return Object.assign({}, s, { top3: athLabels.slice(0, 3).map((x) => x.m.label), bot3: athLabels.slice(-3).reverse().map((x) => x.m.label) });
      });
    }

    // ---- Team longitudinal data: REAL test sessions only (no LOCF forward-fill) ----
    // Per-metric date -> raw values across the selected athletes
    const metricDateVals = (m) => {
      const byDate = new Map();
      const add = (d, val) => {
        if (d == null || val == null) return;
        if (!byDate.has(d)) byDate.set(d, []);
        byDate.get(d).push(val);
      };
      aths.forEach((a) => {
        if (m.source === '1rm') {
          const ex = Store.data.exercises.find((e) => e.name === m.exName);
          if (!ex) return;
          const rm = Store.athRm(a.id, ex.id);
          if (!rm) return;
          (rm.history || []).filter((h) => h.date && (!refDate || h.date <= refDate)).forEach((h) => add(h.date, h.value));
        } else {
          P.getProfiles(a.id, refDate).forEach((p) => add(p.date, P.profileVal(p, m)));
        }
      });
      return byDate;
    };
    // Union of real team session dates (profile dates + 1RM history dates)
    const teamSessionDates = (() => {
      const set = new Set();
      aths.forEach((a) => {
        P.getProfiles(a.id, refDate).forEach((p) => set.add(p.date));
        const rmAll = (Store.data.athleteRm || {})[a.id] || {};
        Object.keys(rmAll).forEach((exId) => ((rmAll[exId] && rmAll[exId].history) || []).forEach((h) => {
          if (h.date && (!refDate || h.date <= refDate)) set.add(h.date);
        }));
      });
      return [...set].sort();
    })();
    // Trend metrics need >=2 real sessions (a single session cannot show change); cap at 8
    const trendMetrics = teamRows.map((r) => ({ m: r.m, byDate: metricDateVals(r.m) }))
      .filter((t) => t.byDate.size >= 2).slice(0, 8);
    const trendDates = [...new Set(trendMetrics.flatMap((t) => [...t.byDate.keys()]))].sort();
    // Category radar: team mean percentile per metric category (metrics with >=2 tested athletes)
    const subCats = (() => {
      const map = {};
      teamRows.forEach((r) => {
        if (P.teamValues(aths, r.m, refDate).length < 2) return;
        const pcts = aths.map((a) => (P.getMetric(a.id, r.m, refDate) == null ? null : P.metricPct(a.id, aths, r.m, refDate))).filter((x) => x != null);
        if (!pcts.length) return;
        const c = r.m.cat || '其他';
        (map[c] = map[c] || []).push(U.avg(pcts));
      });
      return Object.keys(map).filter((c) => map[c].length).map((c) => ({ cat: c, val: +U.avg(map[c]).toFixed(1) }));
    })();
    // Percentile histogram: only athlete-metric pairs with a real value count
    const pctHistBins = [0, 0, 0, 0];
    let pctHistN = 0;
    aths.forEach((a) => teamRows.forEach((r) => {
      if (P.getMetric(a.id, r.m, refDate) == null) return;
      const pct = P.metricPct(a.id, aths, r.m, refDate);
      if (pct == null) return;
      pctHistBins[pct >= 75 ? 3 : pct >= 50 ? 2 : pct >= 25 ? 1 : 0]++;
      pctHistN++;
    }));
    // Team mean TSA per real session date, standardized against each metric's FIRST team
    // session (fixed baseline). A within-team z per date would pin the cross-sectional mean
    // to ~50 by construction and hide team-wide improvement, so baseline stats stay fixed.
    const scoreBase = (() => {
      const map = {};
      allMetrics.forEach((m) => {
        const bd = metricDateVals(m);
        const dates = [...bd.keys()].sort();
        if (dates.length < 2) return;
        const bv = bd.get(dates[0]);
        if (!bv || bv.length < 2) return;
        const mean = U.avg(bv);
        const sd = Math.sqrt(U.avg(bv.map((x) => (x - mean) ** 2)));
        if (!(sd > 0)) return;
        map[m.key || m.label] = { m, mean, sd };
      });
      return map;
    })();
    // Athlete's REAL value on an exact date (no LOCF forward-fill)
    const valOn = (a, m, d) => {
      if (m.source === '1rm') {
        const ex = Store.data.exercises.find((e) => e.name === m.exName);
        if (!ex) return null;
        const rm = Store.athRm(a.id, ex.id);
        const h = rm && (rm.history || []).find((x) => x.date === d);
        return h ? h.value : null;
      }
      const p = P.getProfiles(a.id).find((x) => x.date === d);
      return p ? P.profileVal(p, m) : null;
    };
    const scorePts = teamSessionDates.map((d) => {
      const zs = [];
      const athSet = new Set();
      Object.keys(scoreBase).forEach((k) => {
        const b = scoreBase[k];
        aths.forEach((a) => {
          const v = valOn(a, b.m, d);
          if (v == null) return;
          zs.push((v - b.mean) / b.sd * (b.m.invert ? -1 : 1));
          athSet.add(a.id);
        });
      });
      return (athSet.size >= 2 && zs.length) ? +Math.max(0, Math.min(100, 50 + U.avg(zs) * 16.67)).toFixed(1) : null;
    });
    const scoreOk = scorePts.filter((x) => x != null).length >= 2;
    // Team mean body composition per profile date
    const bodyPts = (() => {
      const byDate = new Map();
      aths.forEach((a) => P.getProfiles(a.id, refDate).forEach((p) => {
        if (p.weight == null && p.bodyFat == null) return;
        if (!byDate.has(p.date)) byDate.set(p.date, { w: [], bf: [] });
        const s = byDate.get(p.date);
        if (p.weight != null) s.w.push(+p.weight);
        if (p.bodyFat != null) s.bf.push(+p.bodyFat);
      }));
      return [...byDate.keys()].sort().map((d) => {
        const s = byDate.get(d);
        return { d, w: s.w.length ? +U.avg(s.w).toFixed(1) : null, bf: s.bf.length ? +U.avg(s.bf).toFixed(1) : null };
      });
    })();
    const bodyOk = bodyPts.length >= 2;

    const chartSec = (title, ctx, chartId, h) => `<section class="card kpi-chart"><div class="chart-cap">${title}${ctx ? `<span class="ctx">${ctx}</span>` : ''}</div><div class="chart" id="${chartId}" style="height:${h}px"></div></section>`;
    const chartH = Math.max(220, teamRows.length * 26 + 70);
    const pctHtml = hasWidget('c_pct') && teamRows.length ? chartSec('团队指标均值分布', refDate ? `${U.md(refDate)} 时点` : '', 'chTeamPct', chartH) : '';
    const rankHtml = hasWidget('c_rank') && rankRows ? `<section class="card kpi-chart">
      <div class="card-title"><h3>团队综合评分排名</h3><span class="sub">Z分数均值映射 · 50=团队均值${refDate ? ' · ' + U.md(refDate) + ' 时点' : ''}</span></div>
      <div style="overflow-x:auto"><table class="tbl">
        <thead><tr><th>排名</th><th>运动员</th><th class="r">综合分 TSA</th><th class="r">Z均值</th><th>优势项</th><th>劣势项</th></tr></thead>
        <tbody>${rankRows.map((s, i) => `<tr>
          <td>${i + 1}</td>
          <td>${U.esc(s.ath.name)}</td>
          <td class="r" style="font-weight:700">${s.score}</td>
          <td class="r">${s.avgZ > 0 ? '+' : ''}${s.avgZ}</td>
          <td>${s.top3.join('、')}</td>
          <td>${s.bot3.join('、')}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </section>` : '';

    const radarLabels = allMetrics.filter((m) => P.teamValues(aths, m, refDate).length >= 2).slice(0, 12);
    const radarOk = hasWidget('c_radar') && radarLabels.length >= 3;
    const radarHtml = radarOk ? chartSec('团队能力雷达', 'Z 分数均值映射 · 50=团队水平', 'chTeamRadar', 320) : '';

    const zbarOk = hasWidget('c_zbar') && aths.length >= 2 && teamRows.length >= 2;
    const zbarHtml = zbarOk ? chartSec('运动员 Z 分数偏差', '相对团队均值 · 0=团队水平', 'chTeamZBar', 320) : '';

    // Personal-only charts: show team summary cards when selected in team view
    const deltaHtml = hasWidget('c_delta') && teamRows.length ? `<section class="card kpi-chart"><div class="chart-cap">团队指标概览<span class="ctx">均值 · 范围 · CV</span></div><div style="overflow-x:auto"><table class="tbl">
      <thead><tr><th>指标</th><th class="r">均值</th><th class="r">范围</th><th class="r">CV</th></tr></thead>
      <tbody>${teamRows.map((r) => `<tr><td>${U.esc(r.m.label)}</td><td class="r">${r.mean.toFixed(1)}${r.m.unit}</td><td class="r">${r.min} – ${r.max}</td><td class="r">${r.cv}%</td></tr>`).join('')}</tbody>
    </table></div></section>` : '';

    const rmHtml = hasWidget('c_rm') ? (() => {
      const rmExs = Store.data.exercises.filter((e) => (e.tags || []).includes('力量'));
      const rmRows = rmExs.map((ex) => {
        const vals = aths.map((a) => P.rmAsOf(a.id, refDate)[ex.name]).filter((v) => v != null);
        if (!vals.length) return null;
        return { name: ex.name, mean: U.avg(vals), max: Math.max(...vals), min: Math.min(...vals), n: vals.length };
      }).filter(Boolean);
      if (!rmRows.length) return '';
      return `<section class="card kpi-chart"><div class="chart-cap">团队 1RM 力量均值<span class="ctx">全队各动作最大力量均值</span></div><div style="overflow-x:auto"><table class="tbl">
        <thead><tr><th>动作</th><th class="r">均值(kg)</th><th class="r">最强</th><th class="r">最弱</th><th class="r">人数</th></tr></thead>
        <tbody>${rmRows.map((r) => `<tr><td>${U.esc(r.name)}</td><td class="r">${r.mean.toFixed(1)}</td><td class="r">${r.max}</td><td class="r">${r.min}</td><td class="r">${r.n}</td></tr>`).join('')}</tbody>
      </table></div></section>`;
    })() : '';

    const fmsHtml = hasWidget('c_fms') ? (() => {
      const fmsTests = P.FMS_TESTS || [];
      if (!fmsTests.length) return '';
      const fmsAths = aths.map((a) => {
        const fr = P.fmsRecs(a.id, refDate);
        return fr.length ? fr[fr.length - 1] : null;
      }).filter(Boolean);
      if (!fmsAths.length) return '';
      const rows = fmsTests.map((t) => {
        const vals = fmsAths.map((f) => f.fms[t.key]).filter((v) => v != null);
        if (!vals.length) return null;
        return { label: t.label, mean: U.avg(vals) };
      }).filter(Boolean);
      return `<section class="card kpi-chart"><div class="chart-cap">团队 FMS 动作均值<span class="ctx">全队各动作平均得分（0-3）</span></div><div class="chart" id="chTeamFms" style="height:300px"></div></section>`;
    })() : '';

    // Selected widgets without enough data render an explanatory placeholder instead of silently vanishing
    const emptySec = (title, ctx, msg) => `<section class="card kpi-chart"><div class="chart-cap">${title}${ctx ? `<span class="ctx">${ctx}</span>` : ''}</div><p class="hint" style="margin:0;padding:28px 10px;text-align:center">${msg}</p></section>`;
    const trendHtml = hasWidget('c_trend') ? (trendMetrics.length
      ? chartSec('团队指标纵向追踪', '全队均值 · 首测基线=100 · 向上为进步', 'chTeamTrend', 320)
      : emptySec('团队指标纵向追踪', '', '全队仅有 1 次测试数据，至少需要 2 次测试才能追踪纵向变化')) : '';
    const subHtml = hasWidget('c_subradar') ? (subCats.length >= 3
      ? chartSec('分项能力雷达', '按类别平均百分位', 'chTeamSubRadar', 320)
      : emptySec('分项能力雷达', '', '至少需要 3 个指标类别，且每类有 ≥2 名运动员完成测试')) : '';
    const histHtml = hasWidget('c_pcthist') ? (aths.length >= 2 && pctHistN
      ? chartSec('百分位分布直方图', '全队各百分位区间人次', 'chTeamPctHist', 300)
      : emptySec('百分位分布直方图', '', '至少需要 2 名运动员的测试数据')) : '';
    const scoreHtml = hasWidget('c_scoretrend') ? (scoreOk
      ? chartSec('综合评分趋势 · TSA', '全队综合分均值 · 首测基线=50 · 向上为进步', 'chTeamScoreTrend', 300)
      : emptySec('综合评分趋势 · TSA', '', '至少需要 2 个测试时点才能追踪全队综合评分')) : '';
    const bodyHtml = hasWidget('c_bodytrend') ? (bodyOk
      ? chartSec('身体成分趋势', '全队平均体重 + 体脂率', 'chTeamBodyTrend', 300)
      : emptySec('身体成分趋势', '', '至少需要 2 次含体重或体脂率的体测记录')) : '';

    if (!pctHtml && !radarHtml && !zbarHtml && !rankHtml && !deltaHtml && !rmHtml && !fmsHtml && !trendHtml && !subHtml && !histHtml && !scoreHtml && !bodyHtml) {
      el.innerHTML = `<div class="card"><p class="hint" style="padding:26px;text-align:center">全队暂无测试数据——在「运动员档案」录入体能数据后，此处自动生成团队汇总分析</p></div>`;
      return;
    }

    el.innerHTML = `<div class="kpi-layout">
      ${pctHtml ? `<div class="kpi-chart-row">${pctHtml}</div>` : ''}
      ${histHtml ? `<div class="kpi-chart-row">${histHtml}</div>` : ''}
      ${radarHtml ? `<div class="kpi-chart-row">${radarHtml}</div>` : ''}
      ${subHtml ? `<div class="kpi-chart-row">${subHtml}</div>` : ''}
      ${zbarHtml ? `<div class="kpi-chart-row">${zbarHtml}</div>` : ''}
      ${rankHtml ? `<div class="kpi-chart-row">${rankHtml}</div>` : ''}
      ${deltaHtml ? `<div class="kpi-chart-row">${deltaHtml}</div>` : ''}
      ${rmHtml ? `<div class="kpi-chart-row">${rmHtml}</div>` : ''}
      ${fmsHtml ? `<div class="kpi-chart-row">${fmsHtml}</div>` : ''}
      ${trendHtml ? `<div class="kpi-chart-row">${trendHtml}</div>` : ''}
      ${scoreHtml ? `<div class="kpi-chart-row">${scoreHtml}</div>` : ''}
      ${bodyHtml ? `<div class="kpi-chart-row">${bodyHtml}</div>` : ''}
    </div>`;

    // Init team percentile chart
    const pctBox = el.querySelector('#chTeamPct');
    if (pctBox) {
      const chart = UI.chart(pctBox);
      chart.setOption({
        grid: { left: 110, right: 50, top: 10, bottom: 20 },
        tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'shadow' } }, UI.tooltipCommon, {
          formatter: (ps) => {
            const r = teamRows[ps[0].dataIndex];
            return `<b>${r.m.label}</b><br/>均值：<b>${r.mean.toFixed(1)}${r.m.unit}</b><br/>范围：${r.min} – ${r.max}<br/>SD：${r.sd.toFixed(1)} · CV：${r.cv}%`;
          }
        }),
        xAxis: Object.assign({ type: 'value' }, UI.axisCommon),
        yAxis: Object.assign({ type: 'category', data: teamRows.map((r) => r.m.label), inverse: true }, UI.axisCommon),
        series: [{
          type: 'bar',
          data: teamRows.map((r) => +r.mean.toFixed(2)),
          itemStyle: { color: UI.cssVar('var(--color-info)') },
          label: { show: true, position: 'right', formatter: '{c}', color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 }
        }]
      });
    }

    // Init team radar
    if (radarOk) {
      const rBox = el.querySelector('#chTeamRadar');
      if (rBox) {
        const chart = UI.chart(rBox);
        const vals = radarLabels.map((m) => {
          const arr = P.teamValues(aths, m, refDate);
          const mean = U.avg(arr);
          const sd = arr.length > 1 ? Math.sqrt(U.avg(arr.map((x) => (x - mean) ** 2))) : 1;
          const teamMeanZ = 0; // by definition
          return Math.round(50 + teamMeanZ * 16.67);
        });
        chart.setOption({
          tooltip: Object.assign({ trigger: 'item' }, UI.tooltipCommon, { formatter: (p) => `${p.name}: <b>${p.value}</b>` }),
          radar: {
            indicator: radarLabels.map((m) => ({ name: m.label, max: 100, min: 0 })),
            radius: '62%', center: ['50%', '52%'],
            axisName: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 },
            splitArea: { areaStyle: { color: [UI.tint('var(--color-info)', .03), UI.tint('var(--color-info)', .06)] } },
            splitLine: { lineStyle: { color: UI.tint('var(--color-ink-muted)', .15) } },
            axisLine: { lineStyle: { color: UI.tint('var(--color-ink-muted)', .15) } }
          },
          series: [{ type: 'radar', data: [{ value: vals, name: '团队均值', areaStyle: { color: UI.tint('var(--color-info)', .25) }, lineStyle: { color: UI.cssVar('var(--color-info)'), width: 2.5 }, itemStyle: { color: UI.cssVar('var(--color-info)') } }] }]
        });
      }
    }

    // Init team Z-bar (each athlete's avg Z)
    if (zbarOk) {
      const zBox = el.querySelector('#chTeamZBar');
      if (zBox) {
        const chart = UI.chart(zBox);
        const labels = allMetrics.filter((m) => P.teamValues(aths, m, refDate).length >= 2);
        const rows = aths.map((a) => {
          const zs = labels.map((m) => P.metricZ(a.id, aths, m, refDate));
          return { name: a.name, z: +U.avg(zs).toFixed(2) };
        }).sort((a, b) => b.z - a.z);
        chart.setOption({
          grid: { left: 90, right: 40, top: 10, bottom: 20 },
          tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'shadow' } }, UI.tooltipCommon),
          xAxis: Object.assign({ type: 'value', name: 'Z 均值' }, UI.axisCommon),
          yAxis: Object.assign({ type: 'category', data: rows.map((r) => r.name), inverse: true }, UI.axisCommon),
          series: [{
            type: 'bar',
            data: rows.map((r) => r.z),
            itemStyle: { color: (p) => p.value >= 0 ? UI.cssVar('var(--color-success)') : UI.cssVar('var(--color-danger)') },
            label: { show: true, position: 'right', formatter: (p) => (p.value > 0 ? '+' : '') + p.value, color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 }
          }]
        });
      }
    }

    // Init team FMS chart
    const fmsBox = el.querySelector('#chTeamFms');
    if (fmsBox) {
      const fmsTests = P.FMS_TESTS || [];
      const fmsAths = aths.map((a) => {
        const fr = P.fmsRecs(a.id, refDate);
        return fr.length ? fr[fr.length - 1] : null;
      }).filter(Boolean);
      const fmsRows = fmsTests.map((t) => {
        const vals = fmsAths.map((f) => f.fms[t.key]).filter((v) => v != null);
        return vals.length ? { label: t.label, mean: +U.avg(vals).toFixed(2) } : null;
      }).filter(Boolean);
      if (fmsRows.length) {
        const chart = UI.chart(fmsBox);
        chart.setOption({
          grid: { left: 100, right: 50, top: 10, bottom: 20 },
          tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'shadow' } }, UI.tooltipCommon),
          xAxis: Object.assign({ type: 'value', max: 3, name: '得分' }, UI.axisCommon),
          yAxis: Object.assign({ type: 'category', data: fmsRows.map((r) => r.label), inverse: true }, UI.axisCommon),
          series: [{
            type: 'bar', data: fmsRows.map((r) => r.mean), barWidth: '55%',
            itemStyle: { color: (p) => p.value >= 2 ? UI.cssVar('var(--color-success)') : p.value >= 1 ? UI.cssVar('var(--color-warning)') : UI.cssVar('var(--color-danger)') },
            label: { show: true, position: 'right', formatter: '{c}', color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 }
          }]
        });
      }
    }

    // ---- Team chart color tokens ----
    const cPri = UI.cssVar('var(--color-primary)'), cInfo = UI.cssVar('var(--color-info)'),
          cSuc = UI.cssVar('var(--color-success)'), cWarn = UI.cssVar('var(--color-warning)'),
          cDan = UI.cssVar('var(--color-danger)'), cMut = UI.cssVar('var(--color-ink-muted)');
    const lineColors = [cPri, cInfo, cSuc, cWarn, cDan, UI.cssVar('var(--color-accent)')];

    // Init team longitudinal trend: REAL session dates on X, baseline index on Y (first session = 100).
    // Inverted metrics (e.g. sprint seconds) are flipped so "up = improvement" for every line.
    const trendBox = el.querySelector('#chTeamTrend');
    if (trendBox && trendMetrics.length) {
      const chart = UI.chart(trendBox);
      // Per-metric baseline = team mean at its own first real test date; skip metrics with a non-positive baseline
      const valid = trendMetrics.map((t, si) => {
        const firstDate = [...t.byDate.keys()].sort()[0];
        const baseVals = t.byDate.get(firstDate) || [];
        return { t, base: baseVals.length ? U.avg(baseVals) : 0, color: lineColors[si % lineColors.length] };
      }).filter((x) => x.base > 0);
      const series = valid.map((x, i) => ({
        name: x.t.m.label,
        type: 'line',
        connectNulls: false,
        symbol: 'circle', symbolSize: 6,
        data: trendDates.map((d) => {
          const vals = x.t.byDate.get(d);
          if (!vals || !vals.length) return { value: null };
          const mean = U.avg(vals);
          const idx = x.t.m.invert ? x.base / mean * 100 : mean / x.base * 100;
          return { value: +idx.toFixed(1), raw: +mean.toFixed(2) };
        }),
        lineStyle: { width: 2, color: x.color },
        itemStyle: { color: x.color },
        markLine: i === 0 ? {
          silent: true, symbol: 'none', label: { show: false },
          lineStyle: { color: UI.alpha(cMut, .4), type: 'dashed' },
          data: [{ yAxis: 100 }]
        } : undefined
      }));
      chart.setOption({
        grid: { left: 56, right: 20, top: 40, bottom: 30 },
        tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon, {
          formatter: (ps) => {
            let html = `<b>${ps[0].axisValue}</b>`;
            ps.forEach((p) => {
              const d = p.data;
              if (!d || d.value == null) return;
              const m = valid[p.seriesIndex].t.m;
              html += `<br/>${p.marker}${p.seriesName}: <b>${d.value}</b>${d.raw != null ? ` <span style="opacity:.7">(均值 ${d.raw}${U.esc(m.unit || '')})</span>` : ''}`;
            });
            return html;
          }
        }),
        legend: { textStyle: { color: cMut, fontSize: 10 }, top: 4, itemWidth: 12, itemHeight: 8, type: 'scroll' },
        xAxis: Object.assign({ type: 'category', data: trendDates.map((d) => U.md(d)), boundaryGap: false }, UI.axisCommon),
        yAxis: Object.assign({ type: 'value', name: '基线指数', scale: true }, UI.axisCommon),
        series
      });
    }

    // Init team category radar: team mean percentile per metric category
    const subBox = el.querySelector('#chTeamSubRadar');
    if (subBox && subCats.length >= 3) {
      const chart = UI.chart(subBox);
      chart.setOption({
        tooltip: UI.tooltipCommon,
        radar: {
          indicator: subCats.map((c) => ({ name: c.cat, max: 100, min: 0 })),
          radius: '64%', center: ['50%', '52%'],
          axisName: { color: cMut, fontSize: 11 },
          splitArea: { areaStyle: { color: ['transparent', UI.alpha(cInfo, .05)] } },
          splitLine: { lineStyle: { color: UI.alpha(cMut, .2) } },
          axisLine: { lineStyle: { color: UI.alpha(cMut, .3) } }
        },
        series: [{
          type: 'radar',
          data: [{ value: subCats.map((c) => c.val), name: '类别平均百分位', areaStyle: { color: UI.alpha(cInfo, .25) }, lineStyle: { color: cInfo, width: 2.5 }, itemStyle: { color: cInfo } }]
        }]
      });
    }

    // Init team percentile histogram: athlete-metric pairs with real values only
    const histBox = el.querySelector('#chTeamPctHist');
    if (histBox && pctHistN) {
      const chart = UI.chart(histBox);
      chart.setOption({
        grid: { left: 50, right: 20, top: 20, bottom: 34 },
        tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'shadow' } }, UI.tooltipCommon),
        xAxis: Object.assign({ type: 'category', data: ['0–25 落后', '25–50 偏下', '50–75 良好', '75–100 领先'] }, UI.axisCommon),
        yAxis: Object.assign({ type: 'value', name: '人次', minInterval: 1 }, UI.axisCommon),
        series: [{
          type: 'bar', data: pctHistBins, barWidth: '46%',
          itemStyle: { color: (p) => [cDan, cWarn, cInfo, cSuc][p.dataIndex], borderRadius: [6, 6, 0, 0] },
          label: { show: true, position: 'top', color: cMut, fontSize: 11 }
        }]
      });
    }

    // Init team TSA trend: mean athlete TSA per real session date (>=2 scored athletes per date)
    const scoreBox = el.querySelector('#chTeamScoreTrend');
    if (scoreBox && scoreOk) {
      const chart = UI.chart(scoreBox);
      chart.setOption({
        grid: { left: 50, right: 20, top: 20, bottom: 34 },
        tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon),
        xAxis: Object.assign({ type: 'category', data: teamSessionDates.map((d) => U.md(d)), boundaryGap: false }, UI.axisCommon),
        yAxis: Object.assign({ type: 'value', min: 0, max: 100, name: '综合分' }, UI.axisCommon),
        series: [{
          name: '全队 TSA 均值', type: 'line', data: scorePts, smooth: true, connectNulls: false,
          symbol: 'circle', symbolSize: 7,
          lineStyle: { width: 3, color: cPri }, itemStyle: { color: cPri },
          areaStyle: { color: UI.alpha(cPri, .15) },
          markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: UI.alpha(cMut, .4), type: 'dashed' }, data: [{ yAxis: 50 }] }
        }]
      });
    }

    // Init team body composition trend: team mean weight / body-fat per profile date
    const bodyBox = el.querySelector('#chTeamBodyTrend');
    if (bodyBox && bodyOk) {
      const chart = UI.chart(bodyBox);
      chart.setOption({
        grid: { left: 55, right: 55, top: 34, bottom: 34 },
        tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon),
        legend: { textStyle: { color: cMut, fontSize: 10 }, top: 4 },
        xAxis: Object.assign({ type: 'category', data: bodyPts.map((x) => U.md(x.d)), boundaryGap: false }, UI.axisCommon),
        yAxis: [
          Object.assign({ type: 'value', name: '体重 kg' }, UI.axisCommon),
          Object.assign({ type: 'value', name: '体脂 %', splitLine: { show: false } }, UI.axisCommon)
        ],
        series: [
          { name: '体重', type: 'line', data: bodyPts.map((x) => x.w), smooth: true, connectNulls: true, symbol: 'circle', symbolSize: 6, lineStyle: { width: 2.5, color: cPri }, itemStyle: { color: cPri } },
          { name: '体脂率', type: 'line', yAxisIndex: 1, data: bodyPts.map((x) => x.bf), smooth: true, connectNulls: true, symbol: 'circle', symbolSize: 6, lineStyle: { width: 2.5, color: cWarn, type: 'dashed' }, itemStyle: { color: cWarn } }
        ]
      });
    }
  }

  // Resolve the active KPI dashboard object (state.dashboardId overrides store.activeId)
  function activeDashboard() {
    const cfg = Store.data.settings.kpiDashboards;
    if (!cfg || !Array.isArray(cfg.items) || !cfg.items.length) return null;
    const id = state.dashboardId || cfg.activeId;
    return cfg.items.find((it) => it.id === id) || cfg.items[0];
  }
  function renderKpi(v, teamAths) {
    const el = v.querySelector('#kpiBody');
    const isTeam = state.viewMode === 'team';
    const aths = teamAths || P.planAths();
    if (isTeam) { renderTeamKpi(v, el, aths); return; }
    const ath = Store.data.athletes.find((a) => a.id === state.athleteId);
    if (!ath) {
      el.innerHTML = `<p class="hint" style="padding:26px;text-align:center">暂无可分析的测试数据——在「运动员档案」录入体能数据后，此处自动生成分析</p>`;
      return;
    }
    const refDate = state.kpiDate;
    const profiles = P.getProfiles(ath.id);
    const rmA = P.rmAsOf(ath.id, refDate);

    // Typical Error estimation: TE = SD(paired consecutive diffs) / √2 (Hopkins 2000)
    const teCache = {};
    const estTE = (m) => {
      if (teCache[m.key || m.label] !== undefined) return teCache[m.key || m.label];
      const diffs = [];
      aths.forEach((a) => {
        let vals = [];
        if (m.source === '1rm') {
          const ex = Store.data.exercises.find((e) => e.name === m.exName);
          const h = ex && (((Store.data.athleteRm || {})[a.id] || {})[ex.id] || {}).history;
          vals = (h || []).filter((x) => x && x.value != null && x.date).sort((x, y) => x.date.localeCompare(y.date)).map((x) => x.value);
        } else {
          vals = P.getProfiles(a.id).map((p) => P.profileVal(p, m)).filter((x) => x != null);
        }
        for (let i = 1; i < vals.length; i++) diffs.push(vals[i] - vals[i - 1]);
      });
      const te = diffs.length >= 3 ? Calc.std(diffs) / Math.sqrt(2) : null;
      teCache[m.key || m.label] = te;
      return te;
    };
    // Change classification per research: confirmed when |Δ| exceeds BOTH SWC and √2×TE
    const classifyChange = (deltaPctV, swcAbs, meanV, teAbs) => {
      if (deltaPctV == null || !meanV) return null;
      const swcPct = swcAbs ? (swcAbs / meanV) * 100 : null;
      const tePct = teAbs ? ((teAbs * Math.sqrt(2)) / meanV) * 100 : null;
      const abs = Math.abs(deltaPctV);
      const thrLow = Math.min(swcPct ?? Infinity, tePct ?? Infinity);
      const thrHigh = Math.max(swcPct ?? -Infinity, tePct ?? -Infinity);
      if (thrHigh === -Infinity || thrLow === Infinity) return null; // no thresholds available
      if (abs >= thrHigh) return { cls: 'confirmed', label: '确认变化' };
      if (abs >= thrLow) return { cls: 'possible', label: '可能变化' };
      return { cls: 'noise', label: '噪声范围内' };
    };

    // ① KPI 分析看板（动态指标总表：1RM 全部已测动作 + 体能 + 身体成分/平衡 + 自定义，去重后逐一分析）
    const kpiRows = P.allMetrics().filter((m) => P.getMetric(ath.id, m, refDate) != null).map((m) => {
      const cur = P.getMetric(ath.id, m, refDate); const arr = P.teamValues(aths, m, refDate);
      const mean = arr.length ? U.avg(arr).toFixed(1) : '—';
      const cv = arr.length ? Calc.cv(arr).toFixed(1) + '%' : '—';
      const swc = arr.length > 1 ? Calc.swc(arr).toFixed(1) : '—';
      const pct = P.metricPct(ath.id, aths, m, refDate); const z = P.metricZ(ath.id, aths, m, refDate);
      let deltaCur = null;
      if (m.source === '1rm') {
        const ex = Store.data.exercises.find((e) => e.name === m.exName);
        const h = ex && rmA[ex.id] && rmA[ex.id].history;
        if (h && h.length >= 2) deltaCur = Calc.deltaPct(h[h.length - 1].value, h[0].value);
      } else {
        const curArr = profiles.map((p) => P.profileVal(p, m)).filter((x) => x != null);
        if (curArr.length >= 2) deltaCur = Calc.deltaPct(curArr[curArr.length - 1], curArr[0]);
      }
      const teAbs = estTE(m);
      const change = classifyChange(deltaCur, swc !== '—' ? parseFloat(swc) : null, parseFloat(mean), teAbs);
      return { m, cur, mean, cv, swc, pct, z, deltaCur, teAbs, change };
    });
    // ①b 1RM 力量变化看板（动作 + 时间范围筛选；跟随顶部运动员下拉切换）
    const RM_RANGES = [['', '全部时间'], ['4', '近 4 周'], ['8', '近 8 周'], ['12', '近 12 周'], ['24', '近 24 周'], ['52', '近 1 年']];
    const rmStore = (Store.data.athleteRm || {})[ath.id] || {};
    const rmExOpts = Object.keys(rmStore).map((exId) => {
      const ex = Store.exercise(exId);
      const hist = ((rmStore[exId] || {}).history || []).filter((h) => h && h.value && h.date);
      return ex && hist.length ? { ex, hist } : null;
    }).filter(Boolean).sort((a, b) => a.ex.name.localeCompare(b.ex.name, 'zh'));
    let rmWidgetData = null;
    if (rmExOpts.length) {
      if (!state.rmExId || !rmExOpts.some((o) => o.ex.id === state.rmExId)) state.rmExId = rmExOpts[0].ex.id;
      if (!RM_RANGES.some((r) => r[0] === state.rmRange)) state.rmRange = '';
      const opt = rmExOpts.find((o) => o.ex.id === state.rmExId);
      const cutoff = state.rmRange ? U.addDays(U.today(), -7 * Number(state.rmRange)) : null;
      const pts = opt.hist.filter((h) => !cutoff || h.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date));
      const first = pts.length ? pts[0].value : null, last = pts.length ? pts[pts.length - 1].value : null;
      const delta = pts.length >= 2 ? Calc.deltaPct(last, first) : null;
      rmWidgetData = { opt, pts, delta, first, last };
      v.__rmTrendData = { pts, exName: opt.ex.name };
    }

    // ② 雷达图 + Z 分数偏差图可用性
    const radarOk = P.allMetrics().filter((m) => P.getMetric(ath.id, m, refDate) != null).length >= 3;
    const zItems = aths.length >= 2 ? P.allMetrics().filter((m) => P.teamValues(aths, m, refDate).length >= 2 && P.getMetric(ath.id, m, refDate) != null) : [];

    // ③ FMS 功能性动作筛查数据
    const fRecs = P.fmsRecs(ath.id, refDate);
    const fmsCur = fRecs.length ? fRecs[fRecs.length - 1] : null;
    const fmsBase = fRecs.length > 1 ? fRecs[0] : null;
    const fmsTotal = fmsCur ? P.fmsTotal(fmsCur.fms) : null;
    const fmsBaseTotal = fmsBase && fmsBase !== fmsCur ? P.fmsTotal(fmsBase.fms) : null;

    // ④ 纵向追踪趋势数据（≥2 次记录才可用）
    const rmHistCount = Object.keys(rmA).reduce((n, k) => n + ((rmA[k] && rmA[k].history || []).length), 0);
    const trendOk = profiles.length >= 2 || rmHistCount >= 2;
    let allChanges = [], rmTrend = null, rmOpts = [];
    if (trendOk) {
      allChanges = profiles.length >= 2 ? P.allMetrics().filter((m) => m.source === 'profile' || m.source === 'custom').map((m) => {
        const vals = profiles.map((p) => P.profileVal(p, m)).filter((v2) => v2 != null);   // 指标缺测的档案不阻断该指标趋势
        if (vals.length < 2) return null;
        const first = vals[0], last = vals[vals.length - 1];
        return { m, first, last, delta: m.invert ? first - last : last - first };
      }).filter(Boolean).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)) : [];
      rmTrend = (() => {
        const series = Object.keys(rmA).map((exId) => {
          const h = rmA[exId] && rmA[exId].history;
          if (!h || h.length < 1) return null;
          const ex = Store.exercise(exId);
          return { name: ex ? ex.name : '—', dates: h.map((x) => x.date), vals: h.map((x) => x.value) };
        }).filter(Boolean);
        return series.length ? series : null;
      })();
      rmOpts = (rmTrend || []).filter((s) => s.dates.length >= 2);
      // 趋势图测试项目下拉：全部指标 / 体能+身体成分+自定义指标（≥2 次记录）/ 1RM 动作（≥2 次测定）；当前选择失效时重置
      const trendVals = [''].concat(allChanges.map((c) => 'p:' + c.m.field), rmOpts.map((s) => 'r:' + s.name));
      if (trendVals.indexOf(state.trendMetric) < 0) state.trendMetric = '';
      v.__trendData = { profiles, changeRows: allChanges, rmTrend };
    }

    // ⑤ 团队综合评分排名数据（≥2 人才可用）
    let rankRows = null;
    if (aths.length >= 2) {
      const labels = P.allMetrics().filter((m) => P.teamValues(aths, m, refDate).length >= 2);
      rankRows = aths.map((a) => {
        const zs = labels.map((m) => P.metricZ(a.id, aths, m, refDate));
        const avgZ = U.avg(zs);
        return { ath: a, score: +Math.max(0, Math.min(100, 50 + avgZ * 16.67)).toFixed(1), avgZ: +avgZ.toFixed(2) };
      }).sort((a, b) => b.score - a.score).map((s) => {
        const labels2 = P.allMetrics().filter((m) => P.teamValues(aths, m, refDate).length >= 2);
        const athLabels = labels2.map((m) => ({ m, z: P.metricZ(s.ath.id, aths, m, refDate) })).sort((a, b) => b.z - a.z);
        return Object.assign({}, s, { top3: athLabels.slice(0, 3).map((x) => x.m.label), bot3: athLabels.slice(-3).reverse().map((x) => x.m.label) });
      });
    }

    // ---------- Widget dictionary: render filtered by dashboard config ----------
    // All remaining widgets are full-width chart sections
    const chartSec = (wid, sz, title, ctx, tip, chartId, h) => `<section class="card kpi-chart" data-wid="${wid}"><div class="chart-cap">${title}${ctx ? `<span class="ctx">${ctx}</span>` : ''}${tip || ''}</div><div class="chart" id="${chartId}" style="height:${h}px"></div></section>`;
    const h = Math.max(220, kpiRows.length * 26 + 70);
    const deltaRows = kpiRows.filter((r) => r.deltaCur != null);
    const W = {
      c_pct: (sz) => !kpiRows.length ? '' : chartSec('c_pct', sz, '团队百分位', '100 = 团队领先', qTip('百分位=该运动员当前值在团队中的相对位置（0–100）；条端标注「当前值 · 百分位」。悬停查看团队均值 / CV / SWC / Z 明细', refTxt('hopkins09', 'hopkins00')), 'chKpiPct', h),
      c_delta: (sz) => !kpiRows.length ? '' : (deltaRows.length
        ? chartSec('c_delta', sz, '基线 → 当前变化', '实色=确认变化 · 半透明=可能变化 · 灰=噪声', qTip('Δ% =（当前值 − 基线值）÷ 基线值。变化分级依据双阈值：|Δ| 同时超过 SWC（0.2×团队SD）与 √2×TE（典型误差）为「确认变化」，仅超其一为「可能变化」，两者皆未达为「噪声」', refTxt('hopkins09', 'hopkins00')), 'chKpiDelta', h)
        : `<section class="card kpi-chart" data-wid="c_delta"><div class="chart-cap">基线 → 当前变化</div><p class="hint" style="padding:36px 10px;text-align:center;border:1px dashed var(--border);border-radius:8px">各指标需 ≥2 次记录后显示变化方向</p></section>`),
      c_zbar: (sz) => !zItems.length ? '' : chartSec('c_zbar', sz, 'Z 分数偏差图', '相对团队均值 · 0=团队水平', '', 'chZBar', 320),
      c_rank: (sz) => !rankRows ? '' : `<section class="card kpi-chart" data-wid="c_rank">
          <div class="card-title"><h3>团队综合评分排名</h3><span class="sub">Z分数均值映射 · 50=团队均值${refDate ? ' · ' + U.md(refDate) + ' 时点' : ''}</span></div>
          <div style="overflow-x:auto"><table class="tbl">
            <thead><tr><th>排名</th><th>运动员</th><th class="r">综合分 TSA</th><th class="r">Z均值</th><th>优势项</th><th>劣势项</th></tr></thead>
            <tbody>${rankRows.map((s, i) => `<tr ${s.ath.id === state.athleteId ? 'style="background:color-mix(in oklch, var(--color-info) 6%, transparent)"' : ''}>
                <td class="num"><b>#${i + 1}</b></td>
                <td><b>${U.esc(s.ath.name)}</b></td>
                <td class="r num"><b style="color:${s.score >= 60 ? UI.cssVar('var(--color-success)') : s.score <= 40 ? UI.cssVar('var(--color-danger)') : UI.cssVar('var(--color-warning)')}">${s.score}</b></td>
                <td class="r num" style="color:${s.avgZ > 0.5 ? UI.cssVar('var(--color-success)') : s.avgZ < -0.5 ? UI.cssVar('var(--color-danger)') : UI.cssVar('var(--color-ink-muted)')}">${s.avgZ > 0 ? '+' : ''}${s.avgZ.toFixed(2)}σ</td>
                <td class="hint">${s.top3.join(' · ')}</td>
                <td class="hint" style="color:var(--color-danger)">${s.bot3.join(' · ')}</td>
              </tr>`).join('')}</tbody>
          </table></div>
        </section>`,
      c_rm: (sz) => !rmWidgetData ? '' : `<section class="card kpi-chart" data-wid="c_rm">
          <div class="card-title"><h3>1RM 力量变化</h3>
            <div class="row" style="gap:10px;align-items:center">
              <span class="sub">${rmWidgetData.pts.length ? `共 ${rmWidgetData.pts.length} 次记录${rmWidgetData.delta != null ? ` · ${rmWidgetData.first} → ${rmWidgetData.last} kg · ${rmWidgetData.delta > 0 ? '+' : ''}${rmWidgetData.delta.toFixed(1)}%` : ''}` : '该时间范围内暂无记录'}</span>
              <select class="sel" id="rmChartEx" style="width:150px">${rmExOpts.map((o) => `<option value="${o.ex.id}" ${o.ex.id === state.rmExId ? 'selected' : ''}>${U.esc(o.ex.name)}</option>`).join('')}</select>
              <select class="sel" id="rmChartRange" style="width:110px">${RM_RANGES.map((r) => `<option value="${r[0]}" ${state.rmRange === r[0] ? 'selected' : ''}>${r[1]}</option>`).join('')}</select>
            </div>
          </div>
          ${rmWidgetData.pts.length ? `<div class="chart" id="chRmTrend" style="height:260px"></div>` : `<p class="hint" style="padding:26px;text-align:center;border:1px dashed var(--border);border-radius:8px">该时间范围内暂无「${U.esc(rmWidgetData.opt.ex.name)}」1RM 记录——更换时间范围或动作</p>`}
        </section>`,
      c_trend: (sz) => !trendOk ? '' : `<section class="card kpi-chart" data-wid="c_trend">
          <div class="card-title"><h3>纵向追踪趋势</h3>
            <div class="row" style="gap:10px;align-items:center">
              <span class="sub">基线 → 当前 · Δ% 变化幅度</span>
              <select class="sel" id="trendSel" style="width:170px">
                <option value="" ${state.trendMetric === '' ? 'selected' : ''}>全部指标</option>
                ${allChanges.map((cr) => `<option value="p:${cr.m.field}" ${state.trendMetric === 'p:' + cr.m.field ? 'selected' : ''}>${U.esc(cr.m.label)}</option>`).join('')}
                ${rmOpts.map((s) => `<option value="r:${U.esc(s.name)}" ${state.trendMetric === 'r:' + s.name ? 'selected' : ''}>${U.esc(s.name)} 1RM</option>`).join('')}
              </select>
            </div>
          </div>
          <div style="display:flex;gap:12px;align-items:flex-start">
            ${(allChanges.length || rmOpts.length) ? `<div style="width:220px;flex-shrink:0;max-height:280px;overflow-y:auto">
              <div style="display:flex;flex-direction:column;gap:6px">
                ${allChanges.map((cr) => {
                  const deltaPct = Calc.deltaPct(cr.last, cr.first);
                  const good = cr.m.invert ? deltaPct < 0 : deltaPct > 0;
                  const color = deltaPct === 0 ? UI.cssVar('var(--color-ink-muted)') : Math.abs(deltaPct) <= 1 ? UI.cssVar('var(--color-warning)') : good ? UI.cssVar('var(--color-success)') : UI.cssVar('var(--color-danger)');
                  const word = deltaPct > 0 ? '增长' : deltaPct < 0 ? '下降' : '持平';
                  const dir = deltaPct > 0 ? '↑' : deltaPct < 0 ? '↓' : '→';
                  return `<div class="card" style="padding:8px 10px;background:var(--bg);margin:0;cursor:pointer" data-trend-metric="p:${cr.m.field}" title="点击在右侧图表中单独查看该指标">
                    <div class="hint" style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${U.esc(cr.m.label)}">${U.esc(cr.m.label)}</div>
                    <div class="row" style="justify-content:space-between;margin-top:3px">
                      <div><b style="font-size:13px">${cr.first}</b><span class="hint" style="font-size:11px">→</span><b style="font-size:13px">${cr.last}</b><span class="hint" style="font-size:11px">${cr.m.unit}</span></div>
                      <b style="font-size:11px;color:${color}">${dir} ${word} ${Math.abs(deltaPct).toFixed(1)}%</b>
                    </div>
                  </div>`;
                }).join('')}
                ${rmOpts.map((s) => {
                  const first = s.vals[0], last = s.vals[s.vals.length - 1];
                  const dp = Calc.deltaPct(last, first);
                  const color = dp === 0 ? UI.cssVar('var(--color-ink-muted)') : Math.abs(dp) <= 1 ? UI.cssVar('var(--color-warning)') : dp > 0 ? UI.cssVar('var(--color-success)') : UI.cssVar('var(--color-danger)');
                  const word = dp > 0 ? '增长' : dp < 0 ? '下降' : '持平';
                  const dir = dp > 0 ? '↑' : dp < 0 ? '↓' : '→';
                  return `<div class="card" style="padding:8px 10px;background:var(--bg);margin:0;cursor:pointer" data-trend-metric="r:${U.esc(s.name)}" title="点击在右侧图表中单独查看该动作 1RM">
                    <div class="hint" style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${U.esc(s.name)} 1RM">${U.esc(s.name)} 1RM</div>
                    <div class="row" style="justify-content:space-between;margin-top:3px">
                      <div><b style="font-size:13px">${first}</b><span class="hint" style="font-size:11px">→</span><b style="font-size:13px">${last}</b><span class="hint" style="font-size:11px">kg</span></div>
                      <b style="font-size:11px;color:${color}">${dir} ${word} ${Math.abs(dp).toFixed(1)}%</b>
                    </div>
                  </div>`;
                }).join('')}
              </div>
            </div>` : ''}
            <div style="flex:1"><div class="chart" id="chTrend" style="height:230px"></div></div>
          </div>
        </section>`,
      c_radar: (sz) => !radarOk ? '' : chartSec('c_radar', sz, '综合能力雷达图', 'Z分数映射 · 50=团队均值', '', 'chRadar', 320),
      c_fms: (sz) => !fmsCur ? '' : (() => {
        const asymmKeys = fmsCur.fmsAsymm || [];
        const tColor = fmsTotal > 14 ? UI.cssVar('var(--color-success)') : fmsTotal === 14 ? UI.cssVar('var(--color-warning)') : UI.cssVar('var(--color-danger)');
        return `<section class="card kpi-chart" data-wid="c_fms">
          <div class="card-title"><h3>FMS 功能性动作筛查</h3><span class="sub">7 项动作模式 · 每项 0–3 分 · ${U.md(fmsCur.date)}</span></div>
          <div class="grid2" style="align-items:start">
            <div class="chart" id="chFms" style="height:300px"></div>
            <div style="padding:4px 2px">
              <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
                <span class="chip" style="font-size:14px;padding:6px 14px;color:${tColor};border-color:${tColor}">总分 <b>${fmsTotal}</b>/21</span>
                ${fmsBaseTotal != null && fmsBaseTotal !== fmsTotal ? `<span class="hint">基线 ${fmsBaseTotal} → ${fmsTotal > fmsBaseTotal ? '+' : ''}${fmsTotal - fmsBaseTotal}</span>` : ''}
              </div>
              ${fmsTotal <= 14 ? `<div class="hint" style="color:var(--color-danger);margin-top:8px">⚠ 总分 ≤14：提示损伤风险升高，建议先补动作质量再上负荷</div>` : ''}
              ${asymmKeys.length ? `<div class="hint" style="margin-top:8px;color:var(--color-warning)">⚠ 不对称：${asymmKeys.map((k) => (P.FMS_TESTS.find((t) => t.key === k) || {}).label || k).join(' · ')}（宜单侧补差）</div>` : ''}
              <div class="tbl-wrap" style="margin-top:10px">
                <table class="tbl" style="font-size:12px">
                  <thead><tr><th>动作模式</th><th class="r">最新得分</th>${fmsBase ? '<th class="r">基线</th>' : ''}</tr></thead>
                  <tbody>
                    ${P.FMS_TESTS.map((t) => {
                      const v2 = fmsCur.fms[t.key];
                      const bv = fmsBase ? fmsBase.fms[t.key] : null;
                      return `<tr><td>${t.label}</td><td class="r num" style="${v2 != null && v2 <= 1 ? 'color:var(--color-danger);font-weight:700' : ''}">${v2 != null ? v2 : '—'}</td>${fmsBase ? `<td class="r num">${bv != null ? bv : '—'}</td>` : ''}</tr>`;
                    }).join('')}
                  </tbody>
                </table>
              </div>
              <div class="hint" style="margin-top:10px;line-height:1.7">3=标准完成 · 2=完成有代偿 · 1=无法完成 · 0=疼痛</div>
            </div>
          </div>
        </section>`;
      })(),
      // ---- Extra visual charts ----
      c_subradar: (sz) => {
        if (kpiRows.length < 3) return '';
        const catMap = {};
        kpiRows.forEach((r) => { const c = r.m.cat || '其他'; (catMap[c] = catMap[c] || []).push(r.pct); });
        const cats = Object.keys(catMap).filter((c) => catMap[c].length);
        if (cats.length < 3) return '';
        return chartSec('c_subradar', sz, '分项能力雷达', '按类别平均百分位', '', 'chSubRadar', 320);
      },
      c_pcthist: (sz) => {
        if (aths.length < 2 || !kpiRows.length) return '';
        return chartSec('c_pcthist', sz, '百分位分布直方图', '全队各百分位区间人次', '', 'chPctHist', 300);
      },
      c_scoretrend: (sz) => {
        const dates = P.dataDates(ath.id);
        if (dates.length < 2) return '';
        return chartSec('c_scoretrend', sz, '综合评分趋势 · TSA', 'Turner 2014 · Z均值映射', '', 'chScoreTrend', 300);
      },
      c_bodytrend: (sz) => {
        const wpts = profiles.map((p) => ({ d: p.date, w: p.weight, bf: p.bodyFat })).filter((x) => x.w != null || x.bf != null);
        if (wpts.length < 2) return '';
        return chartSec('c_bodytrend', sz, '身体成分趋势', '体重 + 体脂率', '', 'chBodyTrend', 300);
      },
    };

    // Render widgets: tiles grouped in overview row, charts each full-width row
    const dash = activeDashboard();
    const dashWidgets = (dash && state.viewMode === 'team')
      ? (Array.isArray(dash.widgetsTeam) ? dash.widgetsTeam : dash.widgets)
      : (dash && Array.isArray(dash.widgets) ? dash.widgets : null);
    const widgets = (dashWidgets && dashWidgets.length) ? dashWidgets : Store.defaultKpiDashboards().items[0].widgets;
    const hasWidget = (id) => widgets.some((w) => w.id === id);

    // Every widget renders as a full-width chart section; widgets without data show a placeholder
    const charts = widgets.map((w) => {
      const html = W[w.id] ? W[w.id](w.size) : '';
      if (html) return html;
      const meta = Store.KPI_WIDGET_CATALOG.find((m) => m.id === w.id);
      if (!meta) return '';   // unknown/retired widget id from a stale config
      return `<section class="card kpi-chart" data-wid="${U.esc(w.id)}"><div class="chart-cap">${U.esc(meta.name)}</div><p class="hint" style="padding:40px 10px;text-align:center;border:1px dashed var(--border);border-radius:8px">暂无数据</p></section>`;
    }).filter(Boolean);

    if (!charts.length) {
      el.innerHTML = `<div class="card"><p class="hint" style="padding:26px;text-align:center">该运动员暂无体能分析数据——前往 <a href="#/profile" style="color:var(--accent)">运动员档案</a> 点击「＋ 添加体能数据」录入后，此处自动生成分析</p></div>`;
      return;
    }

    const chartsRows = charts.map((h2) => `<div class="kpi-chart-row">${h2}</div>`).join('');
    el.innerHTML = `<div class="kpi-layout">${chartsRows}</div>`;

    // 图表初始化（按看板组件守卫）
    if (hasWidget('c_pct') && kpiRows.length) initKpiPct(el.querySelector('#chKpiPct'), kpiRows);
    if (hasWidget('c_delta') && deltaRows.length) initKpiDelta(el.querySelector('#chKpiDelta'), deltaRows);
    // 1RM 力量变化看板：动作 / 时间范围筛选
    const rmt = v.__rmTrendData;
    if (rmt && hasWidget('c_rm')) {
      const exSel = el.querySelector('#rmChartEx');
      if (exSel) exSel.onchange = (e) => { state.rmExId = e.target.value; mount(); };
      const rgSel = el.querySelector('#rmChartRange');
      if (rgSel) rgSel.onchange = (e) => { state.rmRange = e.target.value; mount(); };
      if (rmt.pts.length) initRmTrend(el.querySelector('#chRmTrend'), rmt);
    }
    delete v.__rmTrendData;
    if (hasWidget('c_radar') && radarOk) initRadar(el.querySelector('#chRadar'), ath, aths, refDate);
    if (hasWidget('c_zbar') && zItems.length) initZBar(el.querySelector('#chZBar'), ath, aths, zItems, refDate);
    if (hasWidget('c_fms') && fRecs.length) initFms(el.querySelector('#chFms'), fRecs);
    const td = v.__trendData;
    if (td && hasWidget('c_trend')) {
      const tsel = el.querySelector('#trendSel');
      if (tsel) tsel.onchange = (e) => { state.trendMetric = e.target.value; mount(); };
      // 左侧指标小卡：点击切换图表到该指标
      el.querySelectorAll('[data-trend-metric]').forEach((c) => {
        c.onclick = () => { state.trendMetric = c.dataset.trendMetric; mount(); };
      });
      initTrend(el.querySelector('#chTrend'), td);
    }
    delete v.__trendData;

    // ---- Extra visual charts init ----
    const cPri = UI.cssVar('var(--color-primary)'), cInfo = UI.cssVar('var(--color-info)'),
          cSuc = UI.cssVar('var(--color-success)'), cWarn = UI.cssVar('var(--color-warning)'),
          cDan = UI.cssVar('var(--color-danger)'), cMut = UI.cssVar('var(--color-ink-muted)');

    if (hasWidget('c_subradar')) {
      const box = el.querySelector('#chSubRadar');
      if (box) {
        const catMap = {};
        kpiRows.forEach((r) => { const c = r.m.cat || '其他'; (catMap[c] = catMap[c] || []).push(r.pct); });
        const cats = Object.keys(catMap).filter((c) => catMap[c].length);
        if (cats.length >= 3) {
          const chart = UI.chart(box);
          chart.setOption({
            tooltip: UI.tooltipCommon,
            radar: {
              indicator: cats.map((c) => ({ name: c, max: 100 })),
              radius: '64%', axisName: { color: cMut, fontSize: 11 },
              splitArea: { areaStyle: { color: ['transparent', UI.alpha(cPri, .04)] } },
              splitLine: { lineStyle: { color: UI.alpha(cMut, .2) } },
              axisLine: { lineStyle: { color: UI.alpha(cMut, .3) } }
            },
            series: [{
              type: 'radar',
              data: [{ value: cats.map((c) => +U.avg(catMap[c]).toFixed(1)), name: '平均百分位', areaStyle: { color: UI.alpha(cPri, .25) }, lineStyle: { color: cPri, width: 2 }, itemStyle: { color: cPri } }]
            }]
          });
        }
      }
    }
    if (hasWidget('c_pcthist')) {
      const box = el.querySelector('#chPctHist');
      if (box) {
        const bins = [0, 0, 0, 0]; // 0-25, 25-50, 50-75, 75-100
        aths.forEach((a) => {
          P.allMetrics().forEach((m) => {
            const pct = P.metricPct(a.id, aths, m, refDate);
            if (pct == null) return;
            bins[pct >= 75 ? 3 : pct >= 50 ? 2 : pct >= 25 ? 1 : 0]++;
          });
        });
        const chart = UI.chart(box);
        chart.setOption({
          grid: { left: 50, right: 20, top: 20, bottom: 34 },
          tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'shadow' } }, UI.tooltipCommon),
          xAxis: Object.assign({ type: 'category', data: ['0–25 落后', '25–50 偏下', '50–75 良好', '75–100 领先'] }, UI.axisCommon),
          yAxis: Object.assign({ type: 'value', name: '人次' }, UI.axisCommon),
          series: [{
            type: 'bar', data: bins, barWidth: '46%',
            itemStyle: { color: (p) => [cDan, cWarn, cInfo, cSuc][p.dataIndex], borderRadius: [6, 6, 0, 0] },
            label: { show: true, position: 'top', color: cMut, fontSize: 11 }
          }]
        });
      }
    }
    if (hasWidget('c_scoretrend')) {
      const box = el.querySelector('#chScoreTrend');
      if (box) {
        const dates = P.dataDates(ath.id);
        const pts = dates.map((d) => {
          const labels = P.allMetrics().filter((m) => P.teamValues(aths, m, d).length >= 2 && P.getMetric(ath.id, m, d) != null);
          if (!labels.length) return null;
          const avgZ = U.avg(labels.map((m) => P.metricZ(ath.id, aths, m, d)));
          return +Math.max(0, Math.min(100, 50 + avgZ * 16.67)).toFixed(1);
        });
        const valid = pts.filter((x) => x != null).length;
        if (valid >= 2) {
          const chart = UI.chart(box);
          chart.setOption({
            grid: { left: 50, right: 20, top: 20, bottom: 34 },
            tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon),
            xAxis: Object.assign({ type: 'category', data: dates.map((d) => U.md(d)), boundaryGap: false }, UI.axisCommon),
            yAxis: Object.assign({ type: 'value', min: 0, max: 100, name: '综合分' }, UI.axisCommon),
            series: [{
              type: 'line', data: pts, smooth: true, connectNulls: true, symbol: 'circle', symbolSize: 7,
              lineStyle: { width: 3, color: cPri }, itemStyle: { color: cPri },
              areaStyle: { color: UI.alpha(cPri, .15) },
              markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: UI.alpha(cMut,.4), type: 'dashed' }, data: [{ yAxis: 50 }] }
            }]
          });
        }
      }
    }
    if (hasWidget('c_bodytrend')) {
      const box = el.querySelector('#chBodyTrend');
      if (box) {
        const pts = profiles.map((p) => ({ d: p.date, w: p.weight, bf: p.bodyFat })).filter((x) => x.w != null || x.bf != null);
        if (pts.length >= 2) {
          const chart = UI.chart(box);
          chart.setOption({
            grid: { left: 50, right: 50, top: 34, bottom: 34 },
            tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon),
            legend: { textStyle: { color: cMut, fontSize: 10 }, top: 4 },
            xAxis: Object.assign({ type: 'category', data: pts.map((x) => U.md(x.d)), boundaryGap: false }, UI.axisCommon),
            yAxis: [
              Object.assign({ type: 'value', name: '体重 kg' }, UI.axisCommon),
              Object.assign({ type: 'value', name: '体脂 %', splitLine: { show: false } }, UI.axisCommon)
            ],
            series: [
              { name: '体重', type: 'line', data: pts.map((x) => x.w), smooth: true, connectNulls: true, symbol: 'circle', symbolSize: 6, lineStyle: { width: 2.5, color: cPri }, itemStyle: { color: cPri } },
              { name: '体脂率', type: 'line', yAxisIndex: 1, data: pts.map((x) => x.bf), smooth: true, connectNulls: true, symbol: 'circle', symbolSize: 6, lineStyle: { width: 2.5, color: cWarn, type: 'dashed' }, itemStyle: { color: cWarn } }
            ]
          });
        }
      }
    }
  }

  function mount(v) {
    if (v == null) v = $('#view');
    UI.disposeCharts();
    const mac = P.curMacro();
    if (!mac) {
      v.innerHTML = `<div class="empty"><h4>暂无训练计划</h4><p>请先在「周期训练计划」中新建训练计划，再查看 KPI 分析</p></div>`;
      return;
    }
    const aths = P.planAths();
    // Team name filter: null = whole roster; sanitize stored ids against current plan and normalize full set back to null
    if (Array.isArray(state.teamAthIds)) {
      const planIds = new Set(aths.map((a) => a.id));
      const kept = state.teamAthIds.filter((id) => planIds.has(id));
      state.teamAthIds = (kept.length && kept.length < aths.length) ? kept : null;
    }
    const teamAths = state.teamAthIds ? aths.filter((a) => state.teamAthIds.includes(a.id)) : aths;
    // KPI 面板不添加运动员：只列出有测试数据的运动员，选中即直接展示体能分析
    const withData = aths.filter((a) => hasData(a.id));
    // 默认运动员：本页记住上次选择 → 档案页当前选中（从档案页点「KPI 分析 ›」无缝衔接）→ 首位有数据运动员
    if (!state.athleteId || !withData.find((a) => a.id === state.athleteId)) {
      const prev = P.state.athleteId;
      state.athleteId = (prev && withData.find((a) => a.id === prev)) ? prev : (withData[0] ? withData[0].id : null);
    }
    const ath = Store.data.athletes.find((a) => a.id === state.athleteId);
    const dates = ath ? P.dataDates(ath.id) : [];
    const profN = ath ? P.getProfiles(ath.id, state.kpiDate).length : 0;   // 时点前建档数（最新=全部）
    const rmN = ath ? Object.keys(P.rmAsOf(ath.id, state.kpiDate)).length : 0;
    const age = ath && ath.birth ? Math.floor((Date.now() - new Date(ath.birth).getTime()) / (365.25 * 24 * 3600 * 1000)) : null;

    // Dashboard chips: built-in + user layouts, active highlights; trailing add/edit/delete
    const dashCfg = Store.data.settings.kpiDashboards;
    const dashboards = (dashCfg && Array.isArray(dashCfg.items)) ? dashCfg.items : [];
    const activeDashId = (state.dashboardId || (dashCfg && dashCfg.activeId)) || (dashboards[0] && dashboards[0].id);
    // viewMode is user-controlled; default to personal (do NOT force from dashboard scope)
    const activeDash = dashboards.find((d) => d.id === activeDashId);
    const chipRow = dashboards.map((d) => {
      const isActive = d.id === activeDashId;
      const scopeCls = d.scope === 'team' ? 'is-team' : 'is-personal';
      return `<button type="button" class="ld-chip ${isActive ? 'on' : ''} ${scopeCls}" data-dash="${d.id}" title="${U.esc(d.name)}">${U.esc(d.name)}${d.isDefault ? '<span class="ld-chip-star">★</span>' : ''}</button>`;
    }).join('') + `<button type="button" class="ld-chip-add" id="kpiAddDash" title="新建看板">+</button><button type="button" class="ld-edit-cur" id="kpiEditCur" title="编辑当前看板">编辑</button>`
      + (dashboards.find((d) => d.id === activeDashId && !d.isDefault) ? `<button type="button" class="ld-edit-cur ld-del-cur" id="kpiDelCur" title="删除当前看板">删除</button>` : '');

    // Personal / Team view toggle
    const isTeam = state.viewMode === 'team';
    const scopeToggle = `<div class="kpi-scope-toggle">
        <button type="button" class="kpi-scope-btn ${!isTeam ? 'on' : ''}" data-scope="personal" title="个人视图：分析当前选中运动员">个人</button>
        <button type="button" class="kpi-scope-btn ${isTeam ? 'on' : ''}" data-scope="team" title="团队视图：全队汇总分析">团队</button>
      </div>`;

    // Team name filter popover rows (whole roster; athletes without tests are flagged and never enter charts)
    const teamFilterRows = aths.map((a) => {
      const on = !state.teamAthIds || state.teamAthIds.includes(a.id);
      return `<label class="kpi-af-row">
        <input type="checkbox" value="${a.id}" ${on ? 'checked' : ''}>
        ${U.avatar(a, 'width:24px;height:24px;font-size:10px')}
        <span class="af-name">${U.esc(a.name)}</span>
        ${hasData(a.id) ? '' : '<span class="hint af-na">无测试</span>'}
      </label>`;
    }).join('');
    const teamFilterLabel = state.teamAthIds ? `已选 ${teamAths.length}/${aths.length} 人` : `全队 · ${aths.length} 人`;

    v.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
        <div class="ld-chips" id="kpiChips">${chipRow}</div>
        ${scopeToggle}
      </div>
      <div class="card" style="margin-bottom:12px">
        <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div class="row" style="gap:12px">
            ${isTeam ? '<span class="avatar" style="width:44px;height:44px;font-size:20px">队</span>' : (ath ? U.avatar(ath, 'width:44px;height:44px;font-size:20px', true) : '<span class="avatar" style="width:44px;height:44px;font-size:20px">—</span>')}
            <div>
              <h2 id="kpiHeadName" style="font-size:18px;margin:0 0 3px">${isTeam ? '全队汇总' : (ath ? U.esc(ath.name) : '未选择')}</h2>
            </div>
            ${!isTeam && ath ? `<span class="chip">档案 ${profN}</span><span class="chip ${rmN ? 'volt' : ''}">1RM × ${rmN}</span>` : (isTeam ? `<span class="chip" id="kpiTeamChip">运动员 ${state.teamAthIds ? `${teamAths.length}/${aths.length}` : aths.length}</span>` : '')}
          </div>
          <div class="row" style="gap:8px;align-items:center">
            ${!isTeam ? `<span class="hint" style="font-size:11px">运动员</span>
            <select class="sel" id="kpiAth" style="width:130px">${withData.map((a) => `<option value="${a.id}" ${a.id === state.athleteId ? 'selected' : ''}>${U.esc(a.name)}</option>`).join('')}</select>`
            : `<span class="hint" style="font-size:11px">运动员</span>
            <div class="kpi-af" id="kpiTeamAthWrap">
              <button type="button" class="sel kpi-af-btn ${state.teamAthIds ? 'is-filtered' : ''}" id="kpiTeamAthBtn">
                <span id="kpiTeamAthLabel">${teamFilterLabel}</span><span class="kpi-af-caret">▾</span>
              </button>
              <div class="kpi-af-pop" id="kpiTeamAthPop" hidden>
                <div class="kpi-af-h"><span>筛选运动员</span>
                  <span class="row" style="gap:6px">
                    <button type="button" class="btn sm ghost" id="kpiAfAll">全选</button>
                    <button type="button" class="btn sm ghost" id="kpiAfInv">反选</button>
                  </span>
                </div>
                <div class="kpi-af-list">${teamFilterRows}</div>
                <div class="kpi-af-f"><span id="kpiAfCount">已选 ${teamAths.length} / ${aths.length}</span><span class="hint">无测试人员不计入图表</span></div>
              </div>
            </div>`}
            <span class="hint" style="font-size:11px">时期</span>
            <select class="sel" id="kpiDate" style="width:150px">
              <option value="">最新数据</option>
              ${dates.map((d) => `<option value="${d}" ${d === state.kpiDate ? 'selected' : ''}>${U.md(d)}</option>`).join('')}
            </select>
            <button class="btn primary" id="kpiReport">自定义 KPI 分析</button>
            <button class="btn ghost" id="kpiImport">导入 Excel 测试表</button>
          </div>
        </div>
        ${!withData.length ? `<p class="hint" style="margin-top:10px">当前训练计划的运动员暂无测试数据——在「运动员档案」录入体能数据后，此处自动生成分析</p>` : ''}
      </div>
      <div id="kpiBody"></div>`;

    // Personal/Team scope toggle: switch view mode and re-render
    v.querySelectorAll('.kpi-scope-btn').forEach((b) => b.onclick = () => {
      if (b.dataset.scope === state.viewMode) return;
      state.viewMode = b.dataset.scope;
      if (activeDash && dashCfg) { activeDash.scope = state.viewMode; Store.save(); }
      mount(v);
    });

    $('#kpiAth')?.addEventListener('change', (e) => { state.athleteId = e.target.value; mount(); });
    $('#kpiDate').onchange = (e) => { state.kpiDate = e.target.value || null; mount(); };

    // Team name filter: dropdown panel with checkboxes; body-only refresh keeps the panel open while toggling
    const afWrap = v.querySelector('#kpiTeamAthWrap');
    if (afWrap) {
      const afBtn = v.querySelector('#kpiTeamAthBtn');
      const afPop = v.querySelector('#kpiTeamAthPop');
      const afChecks = () => $$('.kpi-af-row input', afPop);
      const syncHeader = (ids) => {
        const sub = ids ? aths.filter((a) => ids.includes(a.id)) : aths;
        v.querySelector('#kpiTeamAthLabel').textContent = ids ? `已选 ${sub.length}/${aths.length} 人` : `全队 · ${aths.length} 人`;
        v.querySelector('#kpiTeamChip').textContent = ids ? `运动员 ${sub.length}/${aths.length}` : `运动员 ${aths.length}`;
        v.querySelector('#kpiAfCount').textContent = `已选 ${sub.length} / ${aths.length}`;
        afBtn.classList.toggle('is-filtered', !!ids);
        afBtn.title = ids ? sub.map((a) => a.name).join('、') : '';
      };
      const apply = (ids) => {
        state.teamAthIds = ids;
        const sub = ids ? aths.filter((a) => ids.includes(a.id)) : aths;
        UI.disposeCharts();
        try { renderTeamKpi(v, v.querySelector('#kpiBody'), sub); }
        catch (err) {
          const b = v.querySelector('#kpiBody');
          if (b) b.innerHTML = `<div class="card"><p style="padding:20px;color:red;font-size:12px;white-space:pre-wrap">渲染错误: ${err.message}\n${err.stack}</p></div>`;
          console.error('renderTeamKpi error:', err);
        }
        syncHeader(ids);
      };
      afBtn.onclick = (e) => { e.stopPropagation(); afPop.hidden = !afPop.hidden; };
      afPop.addEventListener('click', (e) => e.stopPropagation());
      afPop.addEventListener('change', (e) => {
        if (e.target.type !== 'checkbox') return;
        const ids = afChecks().filter((c) => c.checked).map((c) => c.value);
        if (!ids.length) { e.target.checked = true; UI.toast('至少保留 1 名运动员', 'err'); return; }
        apply(ids.length === aths.length ? null : ids);
      });
      v.querySelector('#kpiAfAll').onclick = () => { afChecks().forEach((c) => { c.checked = true; }); apply(null); };
      v.querySelector('#kpiAfInv').onclick = () => {
        const checks = afChecks();
        if (checks.every((c) => c.checked)) { UI.toast('反选后将没有任何运动员', 'err'); return; }
        checks.forEach((c) => { c.checked = !c.checked; });
        const ids = checks.filter((c) => c.checked).map((c) => c.value);
        apply(ids.length === aths.length ? null : ids);
      };
      const onDocClick = (e) => {
        if (!afWrap.isConnected) { document.removeEventListener('click', onDocClick); return; }
        if (!e.target.closest('#kpiTeamAthWrap')) afPop.hidden = true;
      };
      const onDocKey = (e) => {
        if (!afWrap.isConnected) { document.removeEventListener('keydown', onDocKey); return; }
        if (e.key === 'Escape') afPop.hidden = true;
      };
      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onDocKey);
    }
    $('#kpiReport').onclick = () => Views.kpiLab.open();
    $('#kpiImport').onclick = () => Views.importTest.open({ onImported: () => mount() });

    // Dashboard chip interactions: switch persists to store; add/edit/delete delegate to settings modal
    const openDashEditor = (id) => {
      if (Views.settings && typeof Views.settings.editKpiDashboard === 'function') {
        Views.settings.editKpiDashboard(id, () => { state.dashboardId = id; mount(v); });
      }
    };
    $$('.ld-chip', v).forEach((b) => b.onclick = () => {
      const id = b.dataset.dash;
      if (id === activeDashId) return;
      state.dashboardId = id;
      if (dashCfg) { dashCfg.activeId = id; Store.save(); }
      mount(v);
    });
    $('#kpiAddDash', v).onclick = () => {
      if (!dashCfg) return;
      const id = U.uid('d');
      dashCfg.items.push({ id, name: '新看板 ' + (dashboards.length + 1), scope: 'personal', isDefault: false, widgets: [{ id: 'c_pct', size: 'primary' }, { id: 'c_rm', size: 'primary' }] });
      dashCfg.activeId = id;
      state.dashboardId = id;
      Store.save();
      openDashEditor(id);
    };
    $('#kpiEditCur', v).onclick = () => openDashEditor(activeDashId);
    // Delete current dashboard (non-default only): confirm, splice, fall back to default
    const delCur = $('#kpiDelCur', v);
    if (delCur) delCur.onclick = () => {
      const item = dashCfg.items.find((x) => x.id === activeDashId);
      if (!item || item.isDefault) return;
      UI.confirm(`确定删除看板「${item.name}」？删除后不可恢复。`, () => {
        const idx = dashCfg.items.findIndex((x) => x.id === activeDashId);
        if (idx >= 0) dashCfg.items.splice(idx, 1);
        dashCfg.activeId = 'default';
        state.dashboardId = 'default';
        Store.save();
        UI.toast('看板已删除', 'ok');
        mount(v);
      });
    };

    try { renderKpi(v, teamAths); } catch (err) {
      const el = v.querySelector('#kpiBody');
      if (el) el.innerHTML = `<div class="card"><p style="padding:20px;color:red;font-size:12px;white-space:pre-wrap">渲染错误: ${err.message}\n${err.stack}</p></div>`;
      console.error('renderKpi error:', err);
    }
    // 指标问号点击 → 弹出说明与计算方法（事件委托，覆盖 KPI 看板全部问号）
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

  // 数据更新自动重算：任意 Store.save() 后，若正处 KPI 分析页则自动重挂载（新增 1RM/体能/自定义数据即刻纳入全部分析）
  Store.subscribe(() => {
    if (location.hash.replace('#/', '') !== 'kpi') return;
    const view = $('#view');
    if (view && view.querySelector('#kpiBody')) mount(view);
  });

  return { mount };
})();
