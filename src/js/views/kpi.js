// KPI 分析页：运动员全部体能分析（KPI 看板 / 雷达 / Z 分数 / FMS / 纵向趋势 / 团队排名）
// 数据层复用档案页（Views.profile）导出的辅助函数，本页只负责时期筛选与可视化
// 分析框架参考：《NSCA-CPSS 美国国家体能协会运动表现与科学训练师认证指南》第5章 KPI · 第6章 建档与基准测试
Views.kpi = (() => {
  const P = Views.profile;
  const state = { athleteId: null, kpiDate: null, trendMetric: '', rmExId: null, rmRange: '' };   // kpiDate=null 表示最新数据；trendMetric=趋势图选中测试项目（''=全部指标，p:字段=体能指标，r:动作名=1RM）；rmExId/rmRange=1RM 看板动作/时间范围

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
    const chart = UI.chart(box);
    const data = [
      { value: athScores, name: ath.name, areaStyle: { color: UI.tint('var(--color-info)', .25) }, lineStyle: { color: UI.cssVar('var(--color-info)'), width: 2.5 }, itemStyle: { color: UI.cssVar('var(--color-info)') } },
      { value: labels.map(() => 50), name: '团队均值', areaStyle: { color: UI.tint('var(--color-success)', .05) }, lineStyle: { color: UI.cssVar('var(--color-success)'), width: 1.5, type: 'dashed' }, itemStyle: { color: UI.cssVar('var(--color-success)') } }
    ];
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
            label: { show: true, formatter: '团队均值', color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, position: 'insideEndTop' }, data: [{ yAxis: 0 }] } }
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
    // 图例：指标多时滚动显示，保证所有标签可达可见
    const legendCfg = Object.assign({ textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 }, top: 0, left: 0 },
      series.length > 6 ? { type: 'scroll', pageIconColor: UI.cssVar('var(--color-accent)'), pageTextStyle: { color: UI.cssVar('var(--color-ink-muted)') } } : {});
    chart.setOption({
      grid: { left: 46, right: 46, top: 34, bottom: 30 },
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
        label: { show: true, position: 'top', color: '#d8e0ee', fontSize: 10, formatter: '{c}' },
        markLine: vals.length >= 2 ? { silent: true, symbol: 'none', lineStyle: { color: UI.tint('var(--color-ink)', .3), type: 'dashed' },
          label: { show: true, position: 'insideEndTop', formatter: '均值 ' + U.fmt(mean) + ' kg', color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 }, data: [{ yAxis: +mean.toFixed(1) }] } : undefined
      }]
    });
  }

  // KPI 看板 · 团队百分位横条图（图形化展示，明细进 tooltip）
  function initKpiPct(box, rows) {
    if (!box) return;
    const chart = UI.chart(box);
    chart.setOption({
      grid: { left: 92, right: 116, top: 10, bottom: 26 },
      tooltip: Object.assign({}, UI.tooltipCommon, {
        formatter: (ps) => { const p = Array.isArray(ps) ? ps[0] : ps; const r = rows[p.dataIndex];
          return `<b>${U.esc(r.m.label)}</b><br/>当前：<b>${r.cur}${r.m.unit}</b><br/>团队均值：${r.mean}${r.m.unit}<br/>CV：${r.cv} · SWC：${r.swc}<br/>Z：${r.z > 0 ? '+' : ''}${r.z.toFixed(2)}σ · 百分位：${r.pct}%`; } }),
      xAxis: Object.assign({}, UI.axisCommon, { type: 'value', min: 0, max: 100, splitLine: { lineStyle: { color: UI.tint('var(--color-ink)', 0.06) } }, axisLabel: Object.assign({}, UI.axisCommon.axisLabel, { formatter: '{value}%' }) }),
      yAxis: Object.assign({}, UI.axisCommon, { type: 'category', inverse: true, data: rows.map((r) => r.m.label), axisLabel: Object.assign({}, UI.axisCommon.axisLabel, { fontSize: 11 }) }),
      series: [{
        type: 'bar', barWidth: 14,
        data: rows.map((r) => ({ value: r.pct, itemStyle: { color: r.pct >= 75 ? UI.cssVar('var(--color-success)') : r.pct <= 25 ? UI.cssVar('var(--color-danger)') : UI.cssVar('var(--color-warning)'), borderRadius: [0, 7, 7, 0] } })),
        label: { show: true, position: 'right', distance: 6, color: '#d8e0ee', fontSize: 11,
          formatter: (p) => { const r = rows[p.dataIndex]; return `${r.cur}${r.m.unit} · ${r.pct}%`; } },
        markLine: { silent: true, symbol: 'none', lineStyle: { color: UI.tint('var(--color-ink)', .35), type: 'dashed' },
          label: { show: true, formatter: '均值 50', color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, position: 'insideEndTop' }, data: [{ xAxis: 50 }] }
      }]
    });
  }

  // KPI 看板 · 基线→当前变化正负横条图（增长绿 / 下降红，invert 指标按好/坏判色）
  function initKpiDelta(box, rows) {
    if (!box) return;
    const chart = UI.chart(box);
    const maxAbs = Math.max(5, ...rows.map((r) => Math.abs(r.deltaCur)));
    chart.setOption({
      grid: { left: 92, right: 130, top: 10, bottom: 26 },
      tooltip: Object.assign({}, UI.tooltipCommon, {
        formatter: (ps) => { const p = Array.isArray(ps) ? ps[0] : ps; const r = rows[p.dataIndex];
          const word = r.deltaCur > 0 ? '增长' : r.deltaCur < 0 ? '下降' : '持平';
          return `<b>${U.esc(r.m.label)}</b><br/>Δ%：<b>${r.deltaCur > 0 ? '+' : ''}${r.deltaCur.toFixed(1)}% ${word}</b>${r.swc !== '—' && Math.abs(r.deltaCur) >= parseFloat(r.swc) ? '<br/>⚠ 超过 SWC（变化有意义）' : ''}`; } }),
      xAxis: Object.assign({}, UI.axisCommon, { type: 'value', min: -maxAbs * 1.2, max: maxAbs * 1.2, axisLabel: Object.assign({}, UI.axisCommon.axisLabel, { formatter: '{value}%' }) }),
      yAxis: Object.assign({}, UI.axisCommon, { type: 'category', inverse: true, data: rows.map((r) => r.m.label), axisLabel: Object.assign({}, UI.axisCommon.axisLabel, { fontSize: 11 }) }),
      series: [{
        type: 'bar', barWidth: 14,
        data: rows.map((r) => {
          const good = r.m.invert ? r.deltaCur < 0 : r.deltaCur > 0;
          return { value: +r.deltaCur.toFixed(1), itemStyle: { color: r.deltaCur === 0 ? UI.cssVar('var(--color-ink-muted)') : good ? UI.cssVar('var(--color-success)') : UI.cssVar('var(--color-danger)'), borderRadius: 7 } };
        }),
        label: { show: true, position: 'right', distance: 6, color: '#d8e0ee', fontSize: 11,
          formatter: (p) => { const r = rows[p.dataIndex]; const word = r.deltaCur > 0 ? '增长' : r.deltaCur < 0 ? '下降' : '持平';
            return `${r.deltaCur > 0 ? '+' : ''}${r.deltaCur.toFixed(1)}% ${word}`; },
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
  function renderKpi(v) {
    const el = v.querySelector('#kpiBody');
    const ath = Store.data.athletes.find((a) => a.id === state.athleteId);
    if (!ath) {
      el.innerHTML = `<p class="hint" style="padding:26px;text-align:center">暂无可分析的测试数据——在「运动员档案」录入体能数据后，此处自动生成分析</p>`;
      return;
    }
    const refDate = state.kpiDate;
    const aths = P.planAths();
    const profiles = P.getProfiles(ath.id);
    const rmA = P.rmAsOf(ath.id, refDate);
    const parts = [];

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
      return { m, cur, mean, cv, swc, pct, z, deltaCur };
    });
    // ① KPI 分析看板（图形化：团队百分位横条 + 基线→当前变化正负横条；明细进 tooltip）
    if (kpiRows.length) {
      const deltaRows = kpiRows.filter((r) => r.deltaCur != null);
      const h = Math.max(220, kpiRows.length * 26 + 70);
      parts.push(`
        <div class="card" id="kpiBoard" style="margin-bottom:12px">
          <div class="card-title"><h3>KPI 分析看板</h3><span class="sub">${refDate ? U.md(refDate) + ' 时点' : ''}</span></div>
          <div class="grid2" style="align-items:start">
            <div>
              <div class="chart-cap">团队百分位<span class="ctx">100 = 团队领先</span>${qTip('百分位=该运动员当前值在团队中的相对位置（0–100）；条端标注「当前值 · 百分位」。悬停查看团队均值 / CV / SWC / Z 明细', refTxt('hopkins09', 'hopkins00'))}</div>
              <div class="chart" id="chKpiPct" style="height:${h}px"></div>
            </div>
            ${deltaRows.length ? `
            <div>
              <div class="chart-cap">基线 → 当前变化<span class="ctx">↑ 增长 / ↓ 下降</span>${qTip('Δ% =（当前值 − 基线值）÷ 基线值。绿色=提升、红色=退步；Δ% 超过 SWC（最小有意义变化）表示变化具有实际意义而非测量噪声', refTxt('hopkins09', 'hopkins00'))}</div>
              <div class="chart" id="chKpiDelta" style="height:${h}px"></div>
            </div>` : `
            <div>
              <div class="chart-cap">基线 → 当前变化</div>
              <p class="hint" style="padding:36px 10px;text-align:center;border:1px dashed var(--border);border-radius:8px">各指标需 ≥2 次记录后显示变化方向</p>
            </div>`}
          </div>
        </div>`);
    }

    // ①b 1RM 力量变化看板（动作 + 时间范围筛选；跟随顶部运动员下拉切换）
    const RM_RANGES = [['', '全部时间'], ['4', '近 4 周'], ['8', '近 8 周'], ['12', '近 12 周'], ['24', '近 24 周'], ['52', '近 1 年']];
    const rmStore = (Store.data.athleteRm || {})[ath.id] || {};
    const rmExOpts = Object.keys(rmStore).map((exId) => {
      const ex = Store.exercise(exId);
      const hist = ((rmStore[exId] || {}).history || []).filter((h) => h && h.value && h.date);
      return ex && hist.length ? { ex, hist } : null;
    }).filter(Boolean).sort((a, b) => a.ex.name.localeCompare(b.ex.name, 'zh'));
    if (rmExOpts.length) {
      if (!state.rmExId || !rmExOpts.some((o) => o.ex.id === state.rmExId)) state.rmExId = rmExOpts[0].ex.id;
      if (!RM_RANGES.some((r) => r[0] === state.rmRange)) state.rmRange = '';
      const opt = rmExOpts.find((o) => o.ex.id === state.rmExId);
      const cutoff = state.rmRange ? U.addDays(U.today(), -7 * Number(state.rmRange)) : null;
      const pts = opt.hist.filter((h) => !cutoff || h.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date));
      const first = pts.length ? pts[0].value : null, last = pts.length ? pts[pts.length - 1].value : null;
      const delta = pts.length >= 2 ? Calc.deltaPct(last, first) : null;
      parts.push(`
        <div class="card" id="kpiRmBoard" style="margin-bottom:12px">
          <div class="card-title"><h3>1RM 力量变化</h3>
            <div class="row" style="gap:10px;align-items:center">
              <span class="sub">${pts.length ? `共 ${pts.length} 次记录${delta != null ? ` · ${first} → ${last} kg · ${delta > 0 ? '+' : ''}${delta.toFixed(1)}%` : ''}` : '该时间范围内暂无记录'}</span>
              <select class="sel" id="rmChartEx" style="width:150px">${rmExOpts.map((o) => `<option value="${o.ex.id}" ${o.ex.id === state.rmExId ? 'selected' : ''}>${U.esc(o.ex.name)}</option>`).join('')}</select>
              <select class="sel" id="rmChartRange" style="width:110px">${RM_RANGES.map((r) => `<option value="${r[0]}" ${state.rmRange === r[0] ? 'selected' : ''}>${r[1]}</option>`).join('')}</select>
            </div>
          </div>
          ${pts.length ? `<div class="chart" id="chRmTrend" style="height:260px"></div>` : `<p class="hint" style="padding:26px;text-align:center;border:1px dashed var(--border);border-radius:8px">该时间范围内暂无「${U.esc(opt.ex.name)}」1RM 记录——更换时间范围或动作</p>`}
        </div>`);
      v.__rmTrendData = { pts, exName: opt.ex.name };
    }

    // ② 雷达图 + Z 分数偏差图（并排；各自有数据才渲染）
    const radarOk = P.allMetrics().filter((m) => P.getMetric(ath.id, m, refDate) != null).length >= 3;
    const zItems = aths.length >= 2 ? P.allMetrics().filter((m) => P.teamValues(aths, m, refDate).length >= 2 && P.getMetric(ath.id, m, refDate) != null) : [];
    if (radarOk || zItems.length) {
      parts.push(`
        <div class="${radarOk && zItems.length ? 'grid2' : ''}" style="margin-bottom:12px;align-items:start">
          ${radarOk ? `<div class="card"><div class="card-title"><h3>综合能力雷达图</h3><span class="sub">Z分数映射 · 50=团队均值</span></div><div class="chart" id="chRadar" style="height:320px"></div></div>` : ''}
          ${zItems.length ? `<div class="card"><div class="card-title"><h3>Z 分数偏差图</h3><span class="sub">相对团队均值 · 0=团队水平</span></div><div class="chart" id="chZBar" style="height:320px"></div></div>` : ''}
        </div>`);
    }

    // ③ FMS 功能性动作筛查（有 FMS 数据才渲染：个人雷达图 + 总分/风险面板）
    const fRecs = P.fmsRecs(ath.id, refDate);
    if (fRecs.length) {
      const cur = fRecs[fRecs.length - 1];
      const base = fRecs.length > 1 ? fRecs[0] : null;
      const total = P.fmsTotal(cur.fms);
      const baseTotal = base && base !== cur ? P.fmsTotal(base.fms) : null;
      const asymmKeys = cur.fmsAsymm || [];
      const tColor = total > 14 ? UI.cssVar('var(--color-success)') : total === 14 ? UI.cssVar('var(--color-warning)') : UI.cssVar('var(--color-danger)');
      parts.push(`
        <div class="card" id="kpiFms" style="margin-bottom:12px">
          <div class="card-title"><h3>FMS 功能性动作筛查</h3><span class="sub">7 项动作模式 · 每项 0–3 分 · ${U.md(cur.date)}</span></div>
          <div class="grid2" style="align-items:start">
            <div class="chart" id="chFms" style="height:300px"></div>
            <div style="padding:4px 2px">
              <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
                <span class="chip" style="font-size:14px;padding:6px 14px;color:${tColor};border-color:${tColor}">总分 <b>${total}</b>/21</span>
                ${baseTotal != null && baseTotal !== total ? `<span class="hint">基线 ${baseTotal} → ${total > baseTotal ? '+' : ''}${total - baseTotal}</span>` : ''}
              </div>
              ${total <= 14 ? `<div class="hint" style="color:var(--color-danger);margin-top:8px">⚠ 总分 ≤14：提示损伤风险升高，建议先补动作质量再上负荷</div>` : ''}
              ${asymmKeys.length ? `<div class="hint" style="margin-top:8px;color:var(--color-warning)">⚠ 不对称：${asymmKeys.map((k) => (P.FMS_TESTS.find((t) => t.key === k) || {}).label || k).join(' · ')}（宜单侧补差）</div>` : ''}
              <div class="tbl-wrap" style="margin-top:10px">
                <table class="tbl" style="font-size:12px">
                  <thead><tr><th>动作模式</th><th class="r">最新得分</th>${base ? '<th class="r">基线</th>' : ''}</tr></thead>
                  <tbody>
                    ${P.FMS_TESTS.map((t) => {
                      const v = cur.fms[t.key];
                      const bv = base ? base.fms[t.key] : null;
                      return `<tr><td>${t.label}</td><td class="r num" style="${v != null && v <= 1 ? 'color:var(--color-danger);font-weight:700' : ''}">${v != null ? v : '—'}</td>${base ? `<td class="r num">${bv != null ? bv : '—'}</td>` : ''}</tr>`;
                    }).join('')}
                  </tbody>
                </table>
              </div>
              <div class="hint" style="margin-top:10px;line-height:1.7">3=标准完成 · 2=完成有代偿 · 1=无法完成 · 0=疼痛</div>
            </div>
          </div>
        </div>`);
    }

    // ④ 纵向追踪趋势（≥2 次记录才渲染）
    const rmHistCount = Object.keys(rmA).reduce((n, k) => n + ((rmA[k] && rmA[k].history || []).length), 0);
    if (profiles.length >= 2 || rmHistCount >= 2) {
      const allChanges = profiles.length >= 2 ? P.allMetrics().filter((m) => m.source === 'profile' || m.source === 'custom').map((m) => {
        const vals = profiles.map((p) => P.profileVal(p, m)).filter((v) => v != null);   // 指标缺测的档案不阻断该指标趋势
        if (vals.length < 2) return null;
        const first = vals[0], last = vals[vals.length - 1];
        return { m, first, last, delta: m.invert ? first - last : last - first };
      }).filter(Boolean).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)) : [];
      const changeRows = allChanges;   // 左侧小卡显示全部指标（不再只取前 4）
      const rmTrend = (() => {
        const series = Object.keys(rmA).map((exId) => {
          const h = rmA[exId] && rmA[exId].history;
          if (!h || h.length < 1) return null;
          const ex = Store.exercise(exId);
          return { name: ex ? ex.name : '—', dates: h.map((x) => x.date), vals: h.map((x) => x.value) };
        }).filter(Boolean);
        return series.length ? series : null;
      })();
      // 趋势图测试项目下拉：全部指标 / 体能+身体成分+自定义指标（≥2 次记录）/ 1RM 动作（≥2 次测定）；当前选择失效时重置
      const rmOpts = (rmTrend || []).filter((s) => s.dates.length >= 2);
      const trendVals = [''].concat(allChanges.map((c) => 'p:' + c.m.field), rmOpts.map((s) => 'r:' + s.name));
      if (trendVals.indexOf(state.trendMetric) < 0) state.trendMetric = '';
      parts.push(`
        <div class="card" style="margin-bottom:12px">
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
            ${(changeRows.length || rmOpts.length) ? `<div style="width:220px;flex-shrink:0;max-height:280px;overflow-y:auto">
              <div style="display:flex;flex-direction:column;gap:6px">
                ${changeRows.map((cr) => {
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
        </div>`);
      v.__trendData = { profiles, changeRows, rmTrend };
    }

    // ⑤ 团队综合评分排名（≥2 人才渲染）
    if (aths.length >= 2) {
      const labels = P.allMetrics().filter((m) => P.teamValues(aths, m, refDate).length >= 2);
      const scored = aths.map((a) => {
        const zs = labels.map((m) => P.metricZ(a.id, aths, m, refDate));
        const avgZ = U.avg(zs);
        return { ath: a, score: +Math.max(0, Math.min(100, 50 + avgZ * 16.67)).toFixed(1), avgZ: +avgZ.toFixed(2) };
      }).sort((a, b) => b.score - a.score);
      parts.push(`
        <div class="card">
          <div class="card-title"><h3>团队综合评分排名</h3><span class="sub">Z分数均值映射 · 50=团队均值${refDate ? ' · ' + U.md(refDate) + ' 时点' : ''}</span></div>
          <div style="overflow-x:auto"><table class="tbl">
            <thead><tr><th>排名</th><th>运动员</th><th class="r">综合分</th><th class="r">Z均值</th><th>优势项</th><th>劣势项</th></tr></thead>
            <tbody>${scored.map((s, i) => {
              const athLabels = labels.map((m) => ({ m, z: P.metricZ(s.ath.id, aths, m, refDate) })).sort((a, b) => b.z - a.z);
              const top3 = athLabels.slice(0, 3).map((x) => x.m.label);
              const bot3 = athLabels.slice(-3).reverse().map((x) => x.m.label);
              return `<tr ${s.ath.id === state.athleteId ? 'style="background:color-mix(in oklch, var(--color-info) 6%, transparent)"' : ''}>
                <td class="num"><b>#${i + 1}</b></td>
                <td><b>${U.esc(s.ath.name)}</b></td>
                <td class="r num"><b style="color:${s.score >= 60 ? UI.cssVar('var(--color-success)') : s.score <= 40 ? UI.cssVar('var(--color-danger)') : UI.cssVar('var(--color-warning)')}">${s.score}</b></td>
                <td class="r num" style="color:${s.avgZ > 0.5 ? UI.cssVar('var(--color-success)') : s.avgZ < -0.5 ? UI.cssVar('var(--color-danger)') : UI.cssVar('var(--color-ink-muted)')}">${s.avgZ > 0 ? '+' : ''}${s.avgZ.toFixed(2)}σ</td>
                <td class="hint">${top3.join(' · ')}</td>
                <td class="hint" style="color:var(--color-danger)">${bot3.join(' · ')}</td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>
        </div>`);
    }

    if (!parts.length) {
      parts.push(`<div class="card"><p class="hint" style="padding:26px;text-align:center">该运动员暂无体能分析数据——前往 <a href="#/profile" style="color:var(--accent)">运动员档案</a> 点击「＋ 添加体能数据」录入后，此处自动生成分析</p></div>`);
    }

    el.innerHTML = parts.join('');

    // 图表初始化
    if (kpiRows.length) {
      initKpiPct(el.querySelector('#chKpiPct'), kpiRows);
      initKpiDelta(el.querySelector('#chKpiDelta'), kpiRows.filter((r) => r.deltaCur != null));
    }
    // 1RM 力量变化看板：动作 / 时间范围筛选
    const rmt = v.__rmTrendData;
    if (rmt) {
      const exSel = el.querySelector('#rmChartEx');
      if (exSel) exSel.onchange = (e) => { state.rmExId = e.target.value; mount(); };
      const rgSel = el.querySelector('#rmChartRange');
      if (rgSel) rgSel.onchange = (e) => { state.rmRange = e.target.value; mount(); };
      if (rmt.pts.length) initRmTrend(el.querySelector('#chRmTrend'), rmt);
    }
    delete v.__rmTrendData;
    if (radarOk) initRadar(el.querySelector('#chRadar'), ath, aths, refDate);
    if (zItems.length) initZBar(el.querySelector('#chZBar'), ath, aths, zItems, refDate);
    if (fRecs.length) initFms(el.querySelector('#chFms'), fRecs);
    const td = v.__trendData;
    if (td) {
      const tsel = el.querySelector('#trendSel');
      if (tsel) tsel.onchange = (e) => { state.trendMetric = e.target.value; mount(); };
      // 左侧指标小卡：点击切换图表到该指标
      el.querySelectorAll('[data-trend-metric]').forEach((c) => {
        c.onclick = () => { state.trendMetric = c.dataset.trendMetric; mount(); };
      });
      initTrend(el.querySelector('#chTrend'), td);
    }
    delete v.__trendData;
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

    v.innerHTML = `
      <div class="card" style="margin-bottom:12px">
        <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div class="row" style="gap:12px">
            ${ath ? U.avatar(ath, 'width:44px;height:44px;font-size:20px', true) : '<span class="avatar" style="width:44px;height:44px;font-size:20px">—</span>'}
            <div>
              <h2 id="kpiHeadName" style="font-size:18px;margin:0 0 3px">${ath ? U.esc(ath.name) : '未选择'}</h2>
            </div>
            ${ath ? `<span class="chip">档案 ${profN}</span><span class="chip ${rmN ? 'volt' : ''}">1RM × ${rmN}</span>` : ''}
          </div>
          <div class="row" style="gap:8px;align-items:center">
            <span class="hint" style="font-size:11px">运动员</span>
            <select class="sel" id="kpiAth" style="width:130px">${withData.map((a) => `<option value="${a.id}" ${a.id === state.athleteId ? 'selected' : ''}>${U.esc(a.name)}</option>`).join('')}</select>
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

    $('#kpiAth').onchange = (e) => { state.athleteId = e.target.value; mount(); };
    $('#kpiDate').onchange = (e) => { state.kpiDate = e.target.value || null; mount(); };
    $('#kpiReport').onclick = () => Views.kpiLab.open();
    $('#kpiImport').onclick = () => Views.importTest.open({ onImported: () => mount() });

    renderKpi(v);
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
