// 自定义 KPI 分析工作台：开放式体能数据分析工具（替代原「体能分析报告」）
// 流程：筛选 姓名/测试项目/日期 → 多选分析方法 → 每种方法生成一个看板（可选图型，系统推荐）→ 可继续追加/移除
// 方法库参考：NSCA-CPSS 第5章 KPI · 第6章建档与基准测试；Hopkins SWC；Cohen's d；Pearson 相关；Tukey 箱线图
Views.kpiLab = (() => {
  const P = Views.profile;

  // ---------- 图型候选（14 种） ----------
  const CTYPES = {
    bar: { name: '柱状图', desc: '分类对比数值高低，最直观通用' },
    hbar: { name: '条形图', desc: '类目名较长或项目较多时更易读' },
    line: { name: '折线图', desc: '展示随时间/序列变化的趋势走向' },
    area: { name: '面积图', desc: '强调趋势走向与累积量感' },
    pie: { name: '饼图', desc: '各部分占整体的比例构成' },
    donut: { name: '环形图', desc: '占比构成 + 中心突出总量' },
    rose: { name: '玫瑰图', desc: '占比对比更醒目（半径夸大面积）' },
    radar: { name: '雷达图', desc: '多维度能力综合画像' },
    scatter: { name: '散点图', desc: '两指标间关系与人群集群分布' },
    box: { name: '箱线图', desc: '分布、中位数与离群值一眼看清' },
    heat: { name: '热力图', desc: '矩阵数据的强弱格局一目了然' },
    gauge: { name: '仪表盘', desc: '单值对照区间（最多 6 项并排）' },
    pictorial: { name: '象形柱图', desc: '汇报展示场景更形象生动' },
    funnel: { name: '漏斗图', desc: '排名 / 递减序列展示' }
  };
  const cc = (t, rec) => ({ t, rec: !!rec });

  // ---------- 小工具 ----------
  const KL_COLORS = [UI.cssVar('var(--color-info)'), UI.cssVar('var(--color-success)'), UI.cssVar('var(--color-accent)'), UI.cssVar('var(--color-warning)'), UI.cssVar('var(--color-danger)'), UI.cssVar('var(--color-purple)'), '#4fd8d4', '#f0a35e'];
  const CN_NUM = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮';
  const inR = (d, from, to) => (!from || d >= from) && (!to || d <= to);
  const mean = (arr) => (arr && arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
  const fmtV = (v) => (v == null || isNaN(v)) ? '—' : (Math.abs(v) >= 100 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100);
  const pctS = (v) => (v > 0 ? '+' : '') + fmtV(v);
  const niceMax = (vals) => {
    const mx = Math.max(...vals, 0.001);
    const p = Math.pow(10, Math.floor(Math.log10(mx)));
    return Math.ceil(mx * 1.15 / p) * p;
  };
  const upS = (s) => `<b class="kl-up">${s}</b>`;
  const dnS = (s) => `<b class="kl-dn">${s}</b>`;

  // 数据访问器：某运动员某指标在日期范围内的全部测试点 [{date, value}]（升序、同日去重）
  function seriesOf(athId, m, from, to) {
    const out = [];
    if (m.source === '1rm') {
      const ex = Store.data.exercises.find((e) => e.name === m.exName);
      const rec = ex ? ((Store.data.athleteRm || {})[athId] || {})[ex.id] : null;
      if (rec) {
        (rec.history || []).forEach((h) => {
          if (h.date && h.value != null && inR(h.date, from, to)) out.push({ date: h.date, value: Number(h.value) });
        });
        if (!out.length && rec.value != null && (!rec.date || inR(rec.date, from, to))) out.push({ date: rec.date || '', value: Number(rec.value) });
      }
    } else {
      (Store.data.profiles || []).forEach((p) => {
        if (p.athleteId !== athId || !inR(p.date, from, to)) return;
        const v = P.profileVal(p, m);
        if (v != null) out.push({ date: p.date, value: Number(v) });
      });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    const dedup = [];
    out.forEach((p) => {
      const last = dedup[dedup.length - 1];
      if (last && last.date === p.date) dedup[dedup.length - 1] = p;   // 同日多条保留最后一条
      else dedup.push(p);
    });
    return dedup;
  }

  // 每位运动员该指标的末次测试值（区间内）
  function lastVals(ctx, m) {
    const out = [];
    ctx.aths.forEach((a) => {
      const s = seriesOf(a.id, m, ctx.from, ctx.to);
      if (s.length) out.push({ ath: a, val: s[s.length - 1].value, date: s[s.length - 1].date });
    });
    return out;
  }

  // 最小二乘线性回归 y = a + b·x，返回 {a, b, r2, r}
  function linreg(pts) {
    const n = pts.length;
    const mx = mean(pts.map((p) => p.x)), my = mean(pts.map((p) => p.y));
    let sxy = 0, sxx = 0, syy = 0;
    pts.forEach((p) => { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) * (p.x - mx); syy += (p.y - my) * (p.y - my); });
    const b = sxx ? sxy / sxx : 0;
    const r = (sxx && syy) ? sxy / Math.sqrt(sxx * syy) : 0;
    return { a: my - b * mx, b, r2: r * r, r };
  }
  const corrR = (xs, ys) => linreg(xs.map((x, i) => ({ x, y: ys[i] }))).r;

  // 五数概括（线性插值四分位）+ Tukey 1.5×IQR 离群值
  function fiveNum(vals) {
    const s = vals.slice().sort((a, b) => a - b);
    const q = (p) => { const idx = (s.length - 1) * p; const lo = Math.floor(idx); const hi = Math.min(lo + 1, s.length - 1); return s[lo] + (s[hi] - s[lo]) * (idx - lo); };
    const min = s[0], q1 = q(0.25), med = q(0.5), q3 = q(0.75), max = s[s.length - 1];
    const iqr = q3 - q1;
    const outliers = s.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr);
    return { min, q1, med, q3, max, iqr, outliers };
  }

  function tblHTML(t) {
    return `<table><thead><tr>${t.head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  // ---------- 分析方法库（14 种） ----------
  // 每种方法：intro 一句话说明 / algo 算法公式与标注解释 / charts 适用图型（rec=系统推荐）
  // compute(ctx) → { cats, series, raws?, scatter?, box?, heat?, gaugeMax?, insight, table, empty? }
  const METHODS = [
    {
      id: 'delta', name: '基线对比',
      intro: '区间内首次（基线）vs 末次（当前）测试对比，量化每位运动员的进步/退步幅度。',
      algo: `① Δ = 当前值 − 基线值；Δ% = Δ ÷ |基线值| × 100%
② 基线 = 日期范围内该运动员最早一次测试，当前 = 最晚一次测试
③ 计时类指标（冲刺、敏捷、反应时）数值越小越好，算法已自动取反——图中正值一律代表「变好」，负值代表「退步」
④ Δ% 消除量纲可跨指标比较；绝对变化 Δ 保留原始单位（kg / cm / s…）
⑤ 区间内测试不足 2 次的运动员无法计算，记为数据不足`,
      meaning: `回答「这段训练周期到底有没有带来改变」。用周期首末两次测试量化每个人、每个项目的进步幅度，是周期训练总结和向队员反馈训练成效最直接的依据；Δ% 消除了单位，可跨项目比较谁进步更大。局限：只取首末两点、忽略中间过程，结果可能受测试当天状态影响——变化是否真实请结合 SWC 方法，中间是否持续进步请看趋势斜率。`,
      charts: [cc('bar', 1), cc('hbar'), cc('pictorial'), cc('line')],
      compute(ctx) {
        const details = [];
        const cats = ctx.aths.map((a) => a.name);
        const series = ctx.metrics.map((m) => {
          const data = ctx.aths.map((a) => {
            const s = seriesOf(a.id, m, ctx.from, ctx.to);
            if (s.length < 2) return null;
            const base = s[0], cur = s[s.length - 1];
            let d = cur.value - base.value;
            if (m.invert) d = -d;
            const dpct = base.value !== 0 ? d / Math.abs(base.value) * 100 : null;
            details.push({ athName: a.name, mLabel: m.label, unit: m.unit, base: base.value, cur: cur.value, d, dpct, baseD: base.date, curD: cur.date });
            return dpct == null ? null : Math.round(dpct * 10) / 10;
          });
          return { name: m.label + ' Δ%', data };
        });
        const ok = details.filter((d) => d.dpct != null);
        const best = ok.slice().sort((a, b) => b.dpct - a.dpct)[0];
        const worst = ok.slice().sort((a, b) => a.dpct - b.dpct)[0];
        const up2 = ok.filter((d) => d.dpct >= 1).length, dn2 = ok.filter((d) => d.dpct <= -1).length;
        const flatN = ok.length - up2 - dn2;
        let insight = `对比区间内首次（基线）与末次（当前）测试，共 ${ok.length} 组（运动员 × 指标）：${upS(up2 + ' 组进步（≥1%）')}、${dnS(dn2 + ' 组退步（≤−1%）')}、${flatN} 组在 ±1% 以内基本持平。`;
        if (ok.length >= 2) {
          if (up2 / ok.length >= 0.6) insight += '超过六成在进步，本期训练整体呈现正向效果。';
          else if (dn2 / ok.length >= 0.6) insight += '超过六成在退步，建议复盘本期负荷安排、恢复状况以及两次测试的条件是否一致。';
          else insight += '涨跌互现，训练效果存在明显个体差异，建议结合下方数据表逐人查看。';
        }
        if (best && best.dpct >= 1) insight += `进步最大：${U.esc(best.athName)} 的 ${U.esc(best.mLabel)}，${fmtV(best.base)} → ${fmtV(best.cur)} ${best.unit}（${pctS(best.dpct)}%）。`;
        if (worst && worst.dpct <= -1) insight += `退步最大：${U.esc(worst.athName)} 的 ${U.esc(worst.mLabel)}，${fmtV(worst.base)} → ${fmtV(worst.cur)} ${worst.unit}（${pctS(worst.dpct)}%）；该变化是否已超出测试误差，建议用 SWC 方法核实。`;
        if (details.length > ok.length) insight += `另有 ${details.length - ok.length} 组区间内测试不足 2 次，未纳入对比；增加测试频率可让分析更全面。`;
        const table = {
          head: ['运动员', '指标', '基线（日期）', '当前（日期）', '变化（正=变好）', '变化率'],
          rows: details.map((d) => [U.esc(d.athName), U.esc(d.mLabel), `${fmtV(d.base)}（${d.baseD ? U.md(d.baseD) : '—'}）`, `${fmtV(d.cur)}（${d.curD ? U.md(d.curD) : '—'}）`, pctS(d.d) + ' ' + d.unit, d.dpct == null ? '—' : pctS(d.dpct) + '%'])
        };
        return { cats, series, insight, table };
      }
    },
    {
      id: 'trend', name: '趋势斜率',
      intro: '对每条测试序列做最小二乘线性回归，输出每周平均变化速率与拟合优度 R²，判断进步/退步趋势及其可信度。',
      algo: `① 对序列 (x = 距首测天数, y = 测试值) 做最小二乘拟合：y = a + b·x
② 每周变化速率 = 斜率 b × 7；计时类指标自动取反——正值一律代表「变好」
③ R²（拟合优度）∈ [0, 1]：越接近 1 线性趋势越明显；越接近 0 说明波动大、趋势不可信
④ 判定：|每周变化| < 0.5% × 序列均值 视为「平稳」，否则按方向判「提升 / 下降」
⑤ 每条序列至少 3 个数据点才参与计算；图中细线为原始值、虚线为回归拟合线`,
      meaning: `回答「变化是持续发生的，还是某一次测试的偶然高低」。它用全部测试点拟合趋势，不像基线对比只看首末两点：可以识别稳定进步、平台期和隐藏的下滑；每周变化速率能用来估算达标时间，R² 则告诉你这条趋势能不能信。适用于有 3 次以上连续测试的重点指标长期监控；数据点太少或波动太大时，优先加密测试而不是急于调整计划。`,
      charts: [cc('line', 1), cc('area'), cc('bar')],
      compute(ctx) {
        const raws = [], meta = [];
        ctx.metrics.forEach((m) => {
          ctx.aths.forEach((a) => {
            const s = seriesOf(a.id, m, ctx.from, ctx.to);
            if (s.length < 3) return;
            const x0 = s[0].date;
            const pts = s.map((p) => ({ x: U.daysBetween(x0, p.date) - 1, y: p.value }));   // daysBetween 含首尾，减 1 归零
            const reg = linreg(pts);
            const per7 = (m.invert ? -1 : 1) * reg.b * 7;
            const label = ctx.metrics.length > 1 ? `${a.name} · ${m.label}` : a.name;
            raws.push({
              name: label, unit: m.unit,
              pts: s.map((p) => ({ date: p.date, value: p.value })),
              fit: [{ date: s[0].date, value: reg.a }, { date: s[s.length - 1].date, value: reg.a + reg.b * pts[pts.length - 1].x }]
            });
            const mv = mean(s.map((p) => p.value));
            meta.push({ label, n: s.length, per7, unit: m.unit, r2: reg.r2, verdict: Math.abs(per7) < Math.abs(mv) * 0.005 ? '平稳' : (per7 > 0 ? '提升' : '下降') });
          });
        });
        if (!meta.length) return { empty: '当前筛选下没有至少 3 个数据点的序列，无法计算趋势', insight: '提示：趋势斜率要求每位运动员在所选日期范围内有 ≥ 3 次测试记录。' };
        const per7s = meta.map((x) => x.per7);
        const best = meta.slice().sort((a, b) => b.per7 - a.per7)[0];
        const worst = meta.slice().sort((a, b) => a.per7 - b.per7)[0];
        const avgR2 = mean(meta.map((x) => x.r2));
        const nUp = meta.filter((x) => x.verdict === '提升').length, nDn = meta.filter((x) => x.verdict === '下降').length, nFlat = meta.length - nUp - nDn;
        let insight = `对 ${meta.length} 条序列（每条 ≥3 次测试）做线性拟合：${upS(nUp + ' 条呈提升趋势')}、${dnS(nDn + ' 条呈下降趋势')}、${nFlat} 条基本平稳。`;
        if (avgR2 >= 0.5) {
          if (nUp > nDn) insight += '平均拟合优度 R² ≥ 0.5，趋势较可信，且整体以提升为主。';
          else if (nDn > nUp) insight += '平均 R² ≥ 0.5，趋势较可信，但整体以下降为主，建议尽快排查负荷与恢复并调整计划。';
          else insight += '平均 R² ≥ 0.5，各条序列趋势较明确，但提升与下降方向不一，需逐人分析。';
        } else insight += '平均 R² < 0.5，数据波动较大、趋势信号弱，斜率方向仅供参考，建议加密测试后再下结论。';
        if (best && best.per7 > 0) insight += `提升最快：${U.esc(best.label)}，平均每周 ${pctS(best.per7)} ${best.unit}。`;
        if (worst && worst.per7 < 0) insight += `下降最快：${U.esc(worst.label)}，平均每周 ${pctS(worst.per7)} ${worst.unit}，建议排查训练过量、恢复不足或技术状态问题。`;
        const cats = meta.map((x) => x.label);
        const series = [{ name: '每周变化', data: meta.map((x) => Math.round(x.per7 * 100) / 100) }];
        const table = { head: ['序列', '数据点', '每周变化', 'R²', '判定'], rows: meta.map((x) => [U.esc(x.label), x.n, pctS(x.per7), fmtV(x.r2), x.verdict]) };
        return { cats, series, raws, insight, table };
      }
    },
    {
      id: 'zscore', name: 'Z 分数',
      intro: '把测试值转换为「距团队均值多少个标准差」，实现不同量纲指标的横向比较，快速定位强项与短板。',
      algo: `① Z = (个体值 − 团队均值) ÷ 团队标准差（样本标准差，n−1）
② 计时类指标自动取反——Z 正 = 优于团队均值，Z 负 = 落后于团队均值
③ 参考区间：Z ≈ 0 团队平均；|Z| ≥ 1 显著偏离（Z ≥ +1 优势项 / Z ≤ −1 待改善项）
④ 团队 = 当前筛选名单中该指标有数据的运动员；有效人数 ≥ 2 才有意义
⑤ 热力图模式：行为指标、列为运动员，颜色越绿越强、越蓝越弱`,
      meaning: `回答「在当前团队里，谁的哪项能力明显强、哪项明显弱」。Z 分数把不同单位（kg、秒、厘米）统一换算成「离团队平均几个标准差」，跨项目、跨队员都能比，是分组训练、选拔和制定个体化补强目标的直接依据。注意它只衡量团队内的相对位置：全队一起进步时 Z 分数不变，评估绝对进步要配合基线对比；团队人数太少时个别人会显著拉大标准差，结论需谨慎。`,
      charts: [cc('bar', 1), cc('hbar'), cc('heat')],
      compute(ctx) {
        const flat = [], rows = [];
        const cats = ctx.aths.map((a) => a.name);
        ctx.metrics.forEach((m) => {
          const lv = lastVals(ctx, m);
          const arr = lv.map((x) => x.val);
          if (arr.length < 2) return;
          const sd = Calc.std(arr);
          if (sd <= 0) return;
          const mu = mean(arr);
          const vals = ctx.aths.map((a) => {
            const hit = lv.find((x) => x.ath.id === a.id);
            if (!hit) return null;
            let z = (hit.val - mu) / sd;
            if (m.invert) z = -z;
            z = Math.round(z * 100) / 100;
            flat.push({ athName: a.name, mLabel: m.label, z });
            return z;
          });
          rows.push({ m, vals });
        });
        if (!rows.length) return { empty: '当前筛选下有效团队数据不足（每个指标需 ≥ 2 人有数据）', insight: '提示：Z 分数基于团队内比较，所选名单中每个指标至少 2 人有末次测试值。' };
        const top = flat.slice().sort((a, b) => b.z - a.z)[0];
        const bottom = flat.slice().sort((a, b) => a.z - b.z)[0];
        const hi = flat.filter((x) => x.z >= 1).length, lo = flat.filter((x) => x.z <= -1).length;
        const minN = Math.min(...rows.map((r) => r.vals.filter((v) => v != null).length));
        let insight = `共 ${flat.length} 个「运动员 × 指标」Z 分数（0 = 团队平均，|Z|≥1 约等于偏离平均 1 个标准差、处于团队前/后约 16%）：${upS(hi + ' 项明显偏高（Z≥1）')}、${dnS(lo + ' 项明显偏低（Z≤−1）')}，其余处于团队常见范围。`;
        if (!hi && !lo) insight += '当前没有明显偏离团队水平的项，全队整体较为齐整。';
        if (top && top.z >= 1) insight += `${U.esc(top.athName)} 的 ${U.esc(top.mLabel)} 最突出（Z=${fmtV(top.z)}），可作为该项目的团队标杆。`;
        if (bottom && bottom.z <= -1) insight += `${U.esc(bottom.athName)} 的 ${U.esc(bottom.mLabel)} 最薄弱（Z=${fmtV(bottom.z)}），建议列为下一阶段个体补强重点。`;
        if (minN < 5) insight += `当前部分指标有效人数仅 ${minN} 人，样本偏少，Z 分数易受个别人影响，结论谨慎参考。`;
        if (rows.length > 1) {
          const heat = { xCats: cats, yCats: rows.map((r) => r.m.label), data: [] };
          rows.forEach((r, yi) => r.vals.forEach((z, xi) => { if (z != null) heat.data.push([xi, yi, z]); }));
          const series = rows.map((r) => ({ name: r.m.label, data: r.vals }));   // 多指标也返回 cats/series，让柱状图/条形图可用（多 series 分组柱）
          const table = { head: ['运动员', ...rows.map((r) => U.esc(r.m.label))], rows: ctx.aths.map((a, i) => [U.esc(a.name), ...rows.map((r) => r.vals[i] == null ? '—' : fmtV(r.vals[i]))]) };
          return { cats, series, heat, insight, table };
        }
        const series = [{ name: 'Z 分数', data: rows[0].vals }];
        const table = { head: ['运动员', 'Z 分数'], rows: ctx.aths.map((a, i) => [U.esc(a.name), rows[0].vals[i] == null ? '—' : fmtV(rows[0].vals[i])]) };
        return { cats, series, insight, table };
      }
    },
    {
      id: 'pct', name: '百分位排名',
      intro: '计算每个测试值在团队中的百分位（0-100），直观呈现「超过团队百分之多少的人」。',
      algo: `① 百分位 = 团队中「劣于」该值的人数 ÷ 有效人数 × 100%
② 「劣于」方向按指标而定：越大越好 → 统计比该值小的人数；计时类越小越好 → 统计比该值大的人数
③ 输出范围 0-100：100 = 团队第一，50 = 中位水平
④ 团队 = 当前筛选名单中该指标有数据的运动员（含本人）
⑤ 与 Z 分数相比：百分位不受极端值影响、更直观，但丢失了差距大小信息`,
      meaning: `回答「这个人超过了团队里百分之多少的人」。结果天然 0–100、无需统计知识就能懂，适合向队员和管理层汇报个人位置；它基于排名计算，队里有特别突出的极端值时也不会扭曲其他人的位置。局限：只知道名次、不知道差距——第 45 与第 55 百分位之间可能只差 0.1 秒；人数很少时台阶很大（5 人队每档就是 20%）。需要衡量差距大小时请用 Z 分数。`,
      charts: [cc('bar', 1), cc('hbar'), cc('radar'), cc('gauge'), cc('pie'), cc('donut'), cc('rose')],
      compute(ctx) {
        const cats = ctx.aths.map((a) => a.name);
        const allVals = [];
        const series = ctx.metrics.map((m) => {
          const lv = lastVals(ctx, m);
          const arr = lv.map((x) => x.val);
          const data = ctx.aths.map((a) => {
            const hit = lv.find((x) => x.ath.id === a.id);
            if (!hit || arr.length < 2) return null;
            const below = m.invert ? arr.filter((x) => x > hit.val).length : arr.filter((x) => x < hit.val).length;
            const p = Math.round(below / arr.length * 100);
            allVals.push({ athName: a.name, mLabel: m.label, p, n: arr.length });
            return p;
          });
          return { name: m.label, data };
        });
        const ok = allVals.filter((x) => x.p != null);
        if (!ok.length) return { empty: '当前筛选下有效团队数据不足（每个指标需 ≥ 2 人有数据）', insight: '提示：百分位排名需要在筛选名单内至少 2 人有同一指标的末次测试值。' };
        const top = ok.slice().sort((a, b) => b.p - a.p)[0];
        const hi = ok.filter((x) => x.p >= 75).length, loN = ok.filter((x) => x.p <= 25).length;
        const minN = Math.min(...ok.map((x) => x.n));
        const t100 = ok.filter((x) => x.p === 100);
        let insight = `共 ${ok.length} 个百分位成绩（100 = 团队最佳，50 = 中位）：${upS(hi + ' 个进入团队前 25%')}、${dnS(loN + ' 个处于后 25%')}，其余位于中间位置。`;
        if (t100.length) insight += `达到百分位 100（严格优于全部队友）：${t100.map((x) => `${U.esc(x.athName)} · ${U.esc(x.mLabel)}`).join('、')}。`;
        else if (top) insight += `相对最高的是 ${U.esc(top.athName)} 的 ${U.esc(top.mLabel)}（百分位 ${top.p}，尚有同水平队友）。`;
        if (minN < 5) insight += `当前部分指标有效人数仅 ${minN} 人，百分位台阶较粗（每档至少 ${Math.round(100 / minN)}%），分辨率有限。`;
        const table = { head: ['运动员', ...ctx.metrics.map((m) => U.esc(m.label) + ' 分位')], rows: ctx.aths.map((a, i) => [U.esc(a.name), ...series.map((s) => s.data[i] == null ? '—' : s.data[i] + '%')]) };
        return { cats, series, gaugeMax: 100, insight, table };
      }
    },
    {
      id: 'vsteam', name: '个人 vs 团队均值',
      intro: '计算个体值相对团队平均值的偏离百分比，快速定位每个人相对团队的位置。',
      algo: `① 偏差% = (个体值 − 团队均值) ÷ 团队均值 × 100%
② 计时类指标自动取反——正值一律代表「优于团队均值」
③ 经验参考：±5% 以内接近平均水平；> +20% 显著强于团队；< −20% 显著落后
④ 团队均值 = 当前筛选名单中该指标有数据者的算术平均（含本人）`,
      meaning: `回答「每个人比团队平均水平高多少、低多少」。用百分比表达差距，比原始单位直观，适合快速圈定两类人：明显高于均值者可作为带训示范资源，明显低于均值者是重点辅导对象；也能反过来看团队均值是否被一两个极端队员拉高或拉低。局限：均值本身受极端值影响，队中水平两极分化时「平均」代表性差，此时应配合分布分析（中位数）和 Z 分数一起看。`,
      charts: [cc('bar', 1), cc('hbar')],
      compute(ctx) {
        const flat = [];
        const cats = ctx.aths.map((a) => a.name);
        const series = ctx.metrics.map((m) => {
          const lv = lastVals(ctx, m);
          const arr = lv.map((x) => x.val);
          if (arr.length < 2) return { name: m.label, data: ctx.aths.map(() => null) };
          const mu = mean(arr);
          const data = ctx.aths.map((a) => {
            const hit = lv.find((x) => x.ath.id === a.id);
            if (!hit || mu === 0) return null;
            let dev = (hit.val - mu) / Math.abs(mu) * 100;
            if (m.invert) dev = -dev;
            dev = Math.round(dev * 10) / 10;
            flat.push({ athName: a.name, mLabel: m.label, dev });
            return dev;
          });
          return { name: m.label, data };
        });
        const ok = flat.filter((x) => x.dev != null);
        if (!ok.length) return { empty: '当前筛选下有效团队数据不足（每个指标需 ≥ 2 人有数据）', insight: '提示：偏差% 基于团队均值比较，所选名单中每个指标至少 2 人有末次测试值。' };
        const above = ok.filter((x) => x.dev > 0.5).length;
        const below = ok.filter((x) => x.dev < -0.5).length;
        const eqN = ok.length - above - below;
        const best = ok.slice().sort((a, b) => b.dev - a.dev)[0];
        const worst = ok.slice().sort((a, b) => a.dev - b.dev)[0];
        const minN = Math.min(...ctx.metrics.map((m) => lastVals(ctx, m).length).filter((n) => n >= 2));
        let insight = `共 ${ok.length} 项与团队均值的偏差（计时类已取反，正值 = 优于均值）：${upS(above + ' 项高于均值')}、${dnS(below + ' 项低于均值')}、${eqN} 项与均值基本持平（±0.5% 以内）。`;
        if (best && best.dev >= 20) insight += `${U.esc(best.athName)} 的 ${U.esc(best.mLabel)} 比团队均值高出 ${fmtV(best.dev)}%，优势显著，可作为队内示范资源。`;
        else if (best && best.dev >= 5) insight += `相对最高：${U.esc(best.athName)} 的 ${U.esc(best.mLabel)}（+${fmtV(best.dev)}%），高于团队均值。`;
        if (worst && worst.dev <= -20) insight += `${U.esc(worst.athName)} 的 ${U.esc(worst.mLabel)} 比团队均值低 ${fmtV(Math.abs(worst.dev))}%，差距明显，建议安排针对性补强。`;
        else if (worst && worst.dev <= -5) insight += `相对最低：${U.esc(worst.athName)} 的 ${U.esc(worst.mLabel)}（${fmtV(worst.dev)}%），低于团队均值。`;
        if (minN < 5) insight += `部分指标有效人数仅 ${minN} 人，均值易受个别人影响，偏差百分比谨慎参考。`;
        const table = { head: ['运动员', '指标', '偏差'], rows: ok.map((x) => [U.esc(x.athName), U.esc(x.mLabel), pctS(x.dev) + '%']) };
        return { cats, series, insight, table };
      }
    },
    {
      id: 'ma', name: '移动平均 MA(3)',
      intro: '对每次测试值做 3 点移动平均，平滑单次波动，展示真实的训练适应趋势。',
      algo: `① MAₜ = (xₜ + xₜ₋₁ + xₜ₋₂) ÷ 3（不足 3 点时取现有点平均）
② 移动平均保留趋势、滤除高频噪声（单次状态波动、测量误差）
③ 图中细线为原始值、粗线为 MA(3)；末端 MA 相对起点 MA 的变化反映阶段净变化
④ 序列至少 2 个数据点参与计算`,
      meaning: `回答「剔除单次发挥失常后，真实的状态走向是什么」。把相邻 3 次测试平均，临场波动、睡眠差和测量误差被抹平，曲线比原始值平滑，更容易看出当前处于上升通道、平台还是下行通道，从而决定维持还是调整训练刺激。它是平滑与观察工具，不回答变化是否「真实/显著」——下结论前请结合 SWC；拐点判断也不宜只看最后一个点。`,
      charts: [cc('line', 1), cc('area'), cc('bar')],
      compute(ctx) {
        const raws = [], meta = [];
        ctx.metrics.forEach((m) => {
          ctx.aths.forEach((a) => {
            const s = seriesOf(a.id, m, ctx.from, ctx.to);
            if (s.length < 2) return;
            const ma = s.map((p, i) => ({ date: p.date, value: mean(s.slice(Math.max(0, i - 2), i + 1).map((x) => x.value)) }));
            const label = ctx.metrics.length > 1 ? `${a.name} · ${m.label}` : a.name;
            raws.push({ name: label, unit: m.unit, pts: s.map((p) => ({ date: p.date, value: p.value })), ma });
            meta.push({ label, first: ma[0].value, last: ma[ma.length - 1].value, unit: m.unit, invert: m.invert });
          });
        });
        if (!meta.length) return { empty: '当前筛选下没有至少 2 个数据点的序列', insight: '提示：移动平均要求每位运动员在所选日期范围内有 ≥ 2 次测试记录。' };
        const chg = meta.map((x) => (x.invert ? -1 : 1) * (x.last - x.first));
        const bestChg = Math.max(...chg), worstChg = Math.min(...chg);
        const best = meta[chg.indexOf(bestChg)];
        const worst = meta[chg.indexOf(worstChg)];
        const chgTxt = (x) => pctS((x.invert ? -1 : 1) * (x.last - x.first)) + ' ' + x.unit;
        let insight = `对 ${meta.length} 条序列做 3 点移动平均，比较平滑曲线首尾的净变化（正 = 变好）：`;
        const parts = [];
        if (bestChg > 0) parts.push(upS(`提升最多：${U.esc(best.label)} 净 ${chgTxt(best)}`));
        if (worstChg < 0) parts.push(dnS(`下降最多：${U.esc(worst.label)} 净 ${chgTxt(worst)}`));
        insight += parts.length ? parts.join('；') + '。' : '各序列平滑后的首尾水平基本持平。';
        insight += '移动平均只描述平滑走向，不判断变化是否超过测试噪声（请结合 SWC 方法）。';
        const dset = [];
        raws.forEach((r) => r.pts.forEach((p) => { if (!dset.includes(p.date)) dset.push(p.date); }));
        dset.sort();
        const series = raws.map((r) => {
          const m2 = {};
          r.ma.forEach((p) => { m2[p.date] = p.value; });
          return { name: r.name + ' MA3', data: dset.map((d) => (m2[d] != null ? Math.round(m2[d] * 100) / 100 : null)) };
        });
        const table = { head: ['序列', '起点 MA', '末端 MA', '净变化'], rows: meta.map((x) => [U.esc(x.label), fmtV(x.first), fmtV(x.last), pctS((x.invert ? -1 : 1) * (x.last - x.first)) + ' ' + x.unit]) };
        return { cats: dset, series, raws, insight, table };
      }
    },
    {
      id: 'cv', name: '变异系数 CV',
      intro: '衡量每位运动员各指标测试值的稳定性（波动大小），CV 越小越稳定，可识别状态起伏或测试不可靠。',
      algo: `① CV = 标准差 ÷ 均值 × 100%（样本标准差，n−1）
② CV 反映相对波动：不受量纲影响，可跨指标、跨运动员比较
③ 经验参考：CV < 5% 高度稳定；5-10% 正常波动；10-20% 波动较大；> 20% 状态不稳或测试可靠性差
④ 每条序列至少 3 个数据点；均值接近 0 的指标 CV 易失真，需结合绝对标准差看`,
      meaning: `回答「这个人的表现稳不稳定、测试可不可靠」。波动小通常意味着技术定型、状态可控、测量可信；波动大可能对应状态起伏、技术未定型或测试操作不标准。它有三个典型用途：大赛人选选拔时优先发挥稳定者、检查测试流程质量（同一人不该有巨幅摆动）、作为过度训练的早期预警。要特别注意：系统训练带来的持续进步或退步也会抬高 CV——CV 大不等于「状态乱」，务必结合趋势斜率区分「起伏」与「真实变化」。`,
      charts: [cc('bar', 1), cc('hbar'), cc('radar'), cc('pie'), cc('donut')],
      compute(ctx) {
        const flat = [];
        const cats = ctx.aths.map((a) => a.name);
        const series = ctx.metrics.map((m) => {
          const data = ctx.aths.map((a) => {
            const s = seriesOf(a.id, m, ctx.from, ctx.to);
            if (s.length < 3) return null;
            const vals = s.map((p) => p.value);
            const mu = mean(vals);
            if (mu === 0) return null;
            const cv = Calc.std(vals) / mu * 100;
            flat.push({ athName: a.name, mLabel: m.label, cv, n: s.length });
            return Math.round(cv * 10) / 10;
          });
          return { name: m.label, data };
        });
        const ok = flat.filter((x) => x.cv != null);
        if (!ok.length) return { empty: '当前筛选下没有至少 3 个数据点的序列', insight: '提示：CV 要求每位运动员在所选日期范围内有 ≥ 3 次测试记录。' };
        const unstable = ok.slice().sort((a, b) => b.cv - a.cv)[0];
        const stable = ok.slice().sort((a, b) => a.cv - b.cv)[0];
        const hi = ok.filter((x) => x.cv > 20).length;
        const cvMean = mean(ok.map((x) => x.cv));
        const lvl = cvMean < 5 ? '高度稳定' : cvMean < 10 ? '整体稳定（正常波动范围）' : cvMean < 20 ? '波动偏大' : '波动明显';
        let insight = `共 ${ok.length} 条序列（每条 ≥3 次测试），平均 CV = ${fmtV(cvMean)}%，按经验阈值（<5% 高度稳定 / 5–10% 正常 / 10–20% 偏大 / >20% 明显起伏）属于「${lvl}」。`;
        if (hi) insight += dnS(`其中 ${hi} 条 CV 超过 20%，建议先核对测试操作是否标准化（设备、热身、口令），再排查疲劳、睡眠或心理因素`) + '。';
        if (ok.length >= 2) insight += `最稳定：${U.esc(stable.athName)} 的 ${U.esc(stable.mLabel)}（${fmtV(stable.cv)}%）；波动最大：${U.esc(unstable.athName)} 的 ${U.esc(unstable.mLabel)}（${fmtV(unstable.cv)}%）。`;
        else insight += `${U.esc(stable.athName)} 的 ${U.esc(stable.mLabel)} 波动幅度为 ${fmtV(stable.cv)}%（仅此一条序列，无队内对比）。`;
        insight += '注意：持续进步或退步同样会推高 CV，建议结合趋势斜率区分「起伏」与「真实变化」。';
        const table = { head: ['运动员', '指标', 'CV', '数据点'], rows: ok.map((x) => [U.esc(x.athName), U.esc(x.mLabel), fmtV(x.cv) + '%', x.n]) };
        return { cats, series, insight, table };
      }
    },
    {
      id: 'swc', name: 'SWC 最小有意义变化',
      intro: '以 0.2×团队间标准差为「噪声阈值」，判断每位运动员的变化是否超出测量噪声、具有实际训练意义。',
      algo: `① SWC = 0.2 × 团队间标准差（Hopkins 2004）——小于 SWC 的变化多半是测量噪声
② 变化倍数 = Δ ÷ SWC（Δ 与 SWC 同向：计时类取反后正值 = 变好）
③ Hopkins 效应分级：|倍数| < 0.5 无实质意义；0.5-1 边际；1-1.6 有意义；1.6-2.5 变化大；> 2.5 变化极大
④ 团队间标准差取「区间内末次测试值」的样本标准差（有效人数 ≥ 2）
⑤ 与效应量 d 的区别：SWC 回答「个体变化是否超噪声」，d 回答「团队整体变化有多大」`,
      meaning: `回答「这次变化是练出来的，还是测试本身的误差」。体能测试天然有噪声（设备、状态、动作标准），很多「进步 2%」其实落在误差范围内，据此加量或表扬都可能误判。SWC 给出一道噪声门槛，跨过门槛的变化才值得据此调整训练、向队员反馈，它是个体层面判断「训练是否真正见效」最循证的工具，也是决定是否可以升级训练负荷的安全阀。`,
      charts: [cc('bar', 1), cc('hbar')],
      compute(ctx) {
        const flat = [];
        const cats = ctx.aths.map((a) => a.name);
        const series = ctx.metrics.map((m) => {
          const lv = lastVals(ctx, m);
          const arr = lv.map((x) => x.val);
          const swc = arr.length >= 2 ? 0.2 * Calc.std(arr) : 0;
          const data = ctx.aths.map((a) => {
            const s = seriesOf(a.id, m, ctx.from, ctx.to);
            if (s.length < 2 || !swc) return null;
            const base = s[0], cur = s[s.length - 1];
            let d = cur.value - base.value;
            if (m.invert) d = -d;
            const ratio = d / swc;
            flat.push({ athName: a.name, mLabel: m.label, base: base.value, cur: cur.value, d, swc, ratio, n: arr.length });
            return Math.round(ratio * 100) / 100;
          });
          return { name: m.label + ' Δ/SWC', data };
        });
        const ok = flat.filter((x) => x.ratio != null);
        if (!ok.length) return { empty: '当前筛选下数据不足（个体需 ≥ 2 次测试且团队 ≥ 2 人有末次数据）', insight: '提示：SWC 需要团队间标准差（≥ 2 人）与个体前后两次测试。' };
        const band = (r) => { const a = Math.abs(r); return a < 0.5 ? '无实质意义' : a < 1 ? '边际变化' : a < 1.6 ? '有意义' : a < 2.5 ? '变化大' : '变化极大'; };
        const posSig = ok.filter((x) => x.ratio >= 1), negSig = ok.filter((x) => x.ratio <= -1);
        const marg = ok.filter((x) => Math.abs(x.ratio) >= 0.5 && Math.abs(x.ratio) < 1).length;
        const noiseN = ok.length - posSig.length - negSig.length - marg;
        const minN = Math.min(...ok.map((x) => x.n));
        const worstR = ok.slice().sort((a, b) => a.ratio - b.ratio)[0];
        let insight = `以 0.2 × 团队标准差为噪声阈值，检查 ${ok.length} 组前后变化：${upS(posSig.length + ' 组正向跨过阈值（可判定为真实进步）')}、${dnS(negSig.length + ' 组负向跨过阈值（真实退步）')}、${marg} 组处于 0.5–1 倍的边际区间、${noiseN} 组在测量噪声范围内（暂不能判定为真实变化）。`;
        if (posSig.length) insight += `正向变化最充分：${U.esc(posSig[0].athName)} 的 ${U.esc(posSig[0].mLabel)}（${band(posSig[0].ratio)}，变化达 SWC 的 ${fmtV(posSig[0].ratio)} 倍）。`;
        if (negSig.length) insight += `退步最明显：${U.esc(worstR.athName)} 的 ${U.esc(worstR.mLabel)}（${band(worstR.ratio)}，${fmtV(worstR.ratio)} 倍 SWC），建议优先关注其负荷与恢复。`;
        if (!posSig.length && !negSig.length) insight += '本期尚没有变化跨过噪声阈值：若训练刚结束可能是适应尚未体现，也可能是测试噪声偏大或训练刺激不足，建议先统一测试流程再观察。';
        if (minN < 5) insight += `部分指标团队有效人数仅 ${minN} 人，SWC 阈值本身偏粗，个体结论谨慎参考。`;
        const table = { head: ['运动员', '指标', '基线', '当前', 'Δ（正=变好）', 'SWC', '倍数', '判定'], rows: ok.map((x) => [U.esc(x.athName), U.esc(x.mLabel), fmtV(x.base), fmtV(x.cur), pctS(x.d), fmtV(x.swc), pctS(x.ratio), band(x.ratio)]) };
        return { cats, series, insight, table };
      }
    },
    {
      id: 'cohen', name: "效应量 Cohen's d",
      intro: '团队层面量化「训练前后变化有多大」：d = 平均变化 ÷ 变化量的标准差，不受人数影响，适合汇报表述。',
      algo: `① 对每位运动员计算前后变化 Δᵢ（基线 → 末次，计时类取反后正值 = 变好）
② d = mean(Δᵢ) ÷ std(Δᵢ)——配对前后测的 Cohen's d（按变化量标准差归一）
③ 分级（Cohen 1988 / Hopkins 修订）：|d| < 0.2 微不足道；0.2-0.5 小效应；0.5-0.8 中等效应；≥ 0.8 大效应
④ 正 d = 团队整体进步，负 d = 整体退步；有效 Δᵢ ≥ 2 人才能计算
⑤ 每个指标一根柱：柱越高说明该指标在这段时期的训练效应越明显`,
      meaning: `回答「整个团队这段时间的训练效应到底有多大」。仅凭平均值变化无法跨项目比较，也会被团队人数误导（人多时微小变化也显得「显著」）；d 值把变化按人与人之间的差异归一，不受人数影响，是训练周期总结、论文汇报和横向比较不同队伍/周期效果的标准语言。它衡量团队平均效应，会掩盖个体分化——同一指标可能有人大进步、有人退步，务必结合个体层面的基线对比与 SWC 一起解读。`,
      charts: [cc('bar', 1), cc('hbar'), cc('heat')],
      compute(ctx) {
        const rows = [];
        ctx.metrics.forEach((m) => {
          const diffs = [];
          ctx.aths.forEach((a) => {
            const s = seriesOf(a.id, m, ctx.from, ctx.to);
            if (s.length < 2) return;
            let d = s[s.length - 1].value - s[0].value;
            if (m.invert) d = -d;
            diffs.push(d);
          });
          if (diffs.length < 2) return;
          const sd = Calc.std(diffs);
          rows.push({ label: m.label, n: diffs.length, avg: mean(diffs), d: sd > 0 ? Math.round((mean(diffs) / sd) * 100) / 100 : 0, sdZero: sd === 0, unit: m.unit });
        });
        if (!rows.length) return { empty: '当前筛选下数据不足（每个指标需 ≥ 2 名运动员各有 ≥ 2 次测试）', insight: "提示：Cohen's d 在团队层面计算，需要至少 2 人有前后两次测试。" };
        const band = (d) => { const a = Math.abs(d); return a < 0.2 ? '微不足道' : a < 0.5 ? '小效应' : a < 0.8 ? '中等效应' : '大效应'; };
        const posBig = rows.filter((x) => !x.sdZero && x.d >= 0.5).length;
        const negBig = rows.filter((x) => !x.sdZero && x.d <= -0.5).length;
        let insight = `团队层面前后测效应量，共 ${rows.length} 个指标：${upS(posBig + ' 个中等以上正向效应（d≥0.5）')}、${dnS(negBig + ' 个中等以上负向效应（d≤−0.5）')}，其余为小效应或方向不明显。`;
        if (!posBig && !negBig) insight += '未出现中等以上效应：本期团队层面的整体变化温和，可能的原因包括训练刺激不足、观察周期尚短或测试敏感度不够，需结合具体指标判断。';
        rows.forEach((x) => {
          if (x.sdZero) insight += `<br/>· ${U.esc(x.label)}：全员变化量一致（人均 ${pctS(x.avg)} ${x.unit}），个体差异为 0，d 无法定义。`;
          else insight += `<br/>· ${U.esc(x.label)}：${x.d > 0 ? upS('团队整体进步') : x.d < 0 ? dnS('团队整体退步') : '基本持平'}，${band(x.d)}，平均每人变化 ${pctS(x.avg)} ${x.unit}（n=${x.n}${x.n < 5 ? '，样本偏少，d 估计不稳定，谨慎解读' : ''}）。`;
        });
        const cats = rows.map((x) => x.label);
        const series = [{ name: "Cohen's d", data: rows.map((x) => x.d) }];
        const table = { head: ['指标', '有效人数', '平均变化', "Cohen's d", '效应分级'], rows: rows.map((x) => [U.esc(x.label), x.n, pctS(x.avg) + ' ' + x.unit, fmtV(x.d), band(x.d)]) };
        let out = { cats, series, insight, table };
        if (rows.length >= 3) out.heat = { xCats: cats, yCats: ["Cohen's d"], data: rows.map((x, i) => [i, 0, x.d]) };
        return out;
      }
    },
    {
      id: 'corr', name: '指标相关性',
      intro: '计算两两测试指标间的 Pearson 相关系数 r，发现「练深蹲能否带动冲刺」这类迁移关系；散点图叠加回归线。',
      algo: `① r = Σ(x−x̄)(y−ȳ) ÷ √[Σ(x−x̄)² × Σ(y−ȳ)²]，取值 [-1, 1]
② 强度分级：|r| < 0.3 弱相关；0.3-0.5 中等；0.5-0.7 较强；≥ 0.7 强相关；正负号表示方向
③ 相关 ≠ 因果：高相关只说明共变，需结合训练学逻辑解释（如最大力量 → 爆发力）
④ 每对指标取「区间内末次测试值」且两名运动员同有的数据，有效对数 ≥ 3 才计算
⑤ 热力图 = 全指标相关矩阵（对角线 = 1）；散点图取 |r| 最大的指标对并叠加最小二乘回归线`,
      meaning: `回答「两项能力之间是否存在共变关系」。主要有三个用途：发现训练迁移线索（如最大力量与冲刺、跳跃的关系），为「练 A 能否带动 B」提供数据假设；精简测试组合（两指标长期高度相关，可少测一项）；验证或质疑训练经验。必须牢记：相关不等于因果，共变可能同因于训练年限、身体成熟度等第三因素；且小样本下极容易出现偶然高相关——一般要求 |r|≥0.5 且同测人数 ≥8 才值得作为训练决策参考。`,
      charts: [cc('scatter', 1), cc('heat')],
      compute(ctx) {
        const ms = ctx.metrics.filter((m) => { const lv = lastVals(ctx, m); return lv.length >= 3; });
        if (ms.length < 2) return { empty: '指标相关性需至少 2 个指标、且每个指标 ≥ 3 人有末次测试值', insight: '提示：先在上方多选几个测试项目（≥ 2 项）。' };
        const valsOf = (m) => ctx.aths.map((a) => { const hit = lastVals(ctx, m).find((x) => x.ath.id === a.id); return hit ? hit.val : null; });
        const cols = ms.map((m) => valsOf(m));
        const pairs = [];
        const heatData = [];
        for (let i = 0; i < ms.length; i++) {
          for (let j = 0; j < ms.length; j++) {
            const xs = [], ys = [];
            for (let k = 0; k < ctx.aths.length; k++) { if (cols[i][k] != null && cols[j][k] != null) { xs.push(cols[i][k]); ys.push(cols[j][k]); } }
            const r = (i === j) ? 1 : (xs.length >= 3 ? corrR(xs, ys) : null);
            if (r != null) { heatData.push([j, i, Math.round(r * 100) / 100]); if (j > i) pairs.push({ a: ms[i], b: ms[j], r, n: xs.length }); }
          }
        }
        if (!pairs.length) return { empty: '两两指标共同有效数据不足 3 人', insight: '提示：相关计算要求一对指标在 ≥ 3 名运动员身上同时有末次测试值。' };
        const best = pairs.slice().sort((x, y) => Math.abs(y.r) - Math.abs(x.r))[0];
        const lvA = lastVals(ctx, best.a), lvB = lastVals(ctx, best.b);
        const pts = [];
        ctx.aths.forEach((a) => {
          const h1 = lvA.find((x) => x.ath.id === a.id), h2 = lvB.find((x) => x.ath.id === a.id);
          if (h1 && h2) pts.push({ name: a.name, x: h1.val, y: h2.val });
        });
        const reg = linreg(pts.map((p) => ({ x: p.x, y: p.y })));
        const xsAll = pts.map((p) => p.x);
        const strength = (r) => { const x = Math.abs(r); return x < 0.3 ? '弱' : x < 0.5 ? '中等' : x < 0.7 ? '较强' : '强'; };
        const ar = Math.abs(best.r);
        let insight = `共计算 ${pairs.length} 对指标的 Pearson 相关系数（取同一名运动员的两项末次值）。|r| 最大的一对是 ${U.esc(best.a.label)} 与 ${U.esc(best.b.label)}：r = ${fmtV(best.r)}（n=${best.n}），按经验阈值属于${strength(best.r)}${best.r > 0 ? '正' : '负'}相关。`;
        if (best.n < 8) insight += '但同测人数不足 8 人，系数很容易被个别队员拉动，结论只能作为线索。';
        if (ar < 0.3) insight += '强度未达到 0.3，暂未发现有训练参考价值的线性关系，不建议据此调整训练安排。';
        else if (best.r > 0) insight += '两项成绩存在共变趋势：一项较好时另一项往往也较好，可作为「训练迁移」的候选线索继续观察验证——但相关不等于因果，暂不建议直接据此合并训练内容。';
        else insight += '两项成绩存在反向共变趋势，可能反映训练时间分配上的权衡或两项能力需求不同，建议结合专项逻辑分析，不必简单地回避同训。';
        const heat = { xCats: ms.map((m) => m.label), yCats: ms.map((m) => m.label), data: heatData };
        const scatter = { title: `${best.a.label} × ${best.b.label}`, xName: best.a.label + '（' + best.a.unit + '）', yName: best.b.label + '（' + best.b.unit + '）', points: pts, k: reg.b, b: reg.a, r: reg.r, xmin: Math.min(...xsAll), xmax: Math.max(...xsAll) };
        const table = { head: ['指标对', 'r', '强度', '有效对数'], rows: pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r)).map((x) => [U.esc(x.a.label) + ' × ' + U.esc(x.b.label), fmtV(x.r), strength(x.r) + (x.r > 0 ? '正' : '负'), x.n]) };
        return { heat, scatter, insight, table };
      }
    },
    {
      id: 'dist', name: '分布分析（箱线图）',
      intro: '按指标展示团队测试值的分布：中位数、四分位距与离群值，识别团队整体水平与两极分化。',
      algo: `① 五数概括：最小值、Q1（下四分位）、中位数、Q3（上四分位）、最大值（线性插值法）
② IQR = Q3 − Q1：中间 50% 数据的跨度，越大越分散（两极分化）
③ 离群值判定（Tukey 法）：超出 [Q1 − 1.5×IQR, Q3 + 1.5×IQR] 的值为疑似离群点
④ 每指标取「区间内末次测试值」；箱线图适合 ≥ 5 个样本，样本过少仅供参考
⑤ 柱状图模式显示各指标均值，可与箱线图互为印证`,
      meaning: `回答「团队整体处在什么水平、队员之间分化严不严重」。中位数代表不受极端值干扰的团队典型水平，四分位距反映中间一半人的水平跨度，离群值帮你发现天赋突出或明显掉队的队员。它是决定「全队统一练还是分组练」、设定团队目标线的客观依据；配合均值还能判断分布是否对称（均值被强者拉高说明长尾在右）。样本少于 5 人时箱线形态不稳定，只作粗略参考。`,
      charts: [cc('box', 1), cc('bar'), cc('hbar')],
      compute(ctx) {
        const rows = [];
        ctx.metrics.forEach((m) => {
          const lv = lastVals(ctx, m);
          if (lv.length < 3) return;
          const vals = lv.map((x) => x.val);
          const f = fiveNum(vals);
          rows.push({ m, n: vals.length, f, mu: mean(vals), sd: Calc.std(vals) });
        });
        if (!rows.length) return { empty: '当前筛选下每个指标需 ≥ 3 人有末次测试值', insight: '提示：分布分析在团队层面进行，需要足够的样本量。' };
        const cats = rows.map((r) => r.m.label);
        const boxes = rows.map((r) => ({ min: r.f.min, q1: r.f.q1, med: r.f.med, q3: r.f.q3, max: r.f.max, outliers: r.f.outliers }));
        const series = [{ name: '均值', data: rows.map((r) => Math.round(r.mu * 100) / 100) }];
        const spread = rows.slice().sort((a, b) => (b.f.iqr / Math.max(Math.abs(b.mu), 0.001)) - (a.f.iqr / Math.max(Math.abs(a.mu), 0.001)))[0];
        const outliersN = rows.reduce((s, r) => s + r.f.outliers.length, 0);
        let insight = `共 ${rows.length} 个指标的团队末次成绩分布。`;
        if (spread) insight += `相对离散程度最大的是 ${U.esc(spread.m.label)}：中位数 ${fmtV(spread.f.med)} ${spread.m.unit}，中间 50% 队员的跨度（IQR）为 ${fmtV(spread.f.iqr)} ${spread.m.unit}（n=${spread.n}）。`;
        insight += spread.n >= 5 ? '该指标队员水平差异明显，可考虑按水平分组训练、因材施教。' : '不过该指标有效人数不足 5，箱线形态不稳定，离散结论仅供参考。';
        insight += outliersN ? `另外有 ${outliersN} 个 Tukey 离群值（超出 Q1/Q3 各 1.5 倍 IQR），建议先核对是否录入或测试有误；数据无误则关注这些队员的特殊情况。` : '未发现统计离群值（这只说明没有极端偏离点，不代表原始记录一定无误，异常数据仍需结合测试记录核对）。';
        const table = { head: ['指标', '人数', '最小', 'Q1', '中位数', 'Q3', '最大', '均值±SD', '离群值'], rows: rows.map((r) => [U.esc(r.m.label), r.n, fmtV(r.f.min), fmtV(r.f.q1), fmtV(r.f.med), fmtV(r.f.q3), fmtV(r.f.max), `${fmtV(r.mu)} ± ${fmtV(r.sd)}`, r.f.outliers.length ? r.f.outliers.map((v) => fmtV(v)).join('、') : '无']) };
        return { cats, boxes, series, insight, table };
      }
    },
    {
      id: 'radarM', name: '多指标雷达画像',
      intro: '把每位运动员的全部选中指标归一化到 0-100 画成雷达图，一眼看清能力结构（全能型 / 爆发型 / 短板在哪）。',
      algo: `① 每个指标在筛选名单内做 min-max 归一：得分 = (值 − 最差值) ÷ (最好值 − 最差值) × 100
② 计时类指标方向自动翻转——100 一律代表「该指标团队最佳」
③ 某运动员缺该指标数据时该轴记 0 分（并计入数据完整度提示）
④ 全能得分 = 各轴平均；雷达图顶点数 = 指标数，建议 3-10 个指标；雷达模式最多展示 8 人
⑤ 归一化对极端值敏感：某指标只有一人有数据时该人记 100，参考意义有限`,
      meaning: `回答「每名运动员的能力结构长什么样：全能型、偏科型，短板具体在哪一轴」。把不同项目的成绩归一到同一把 0–100 的尺子上，能力轮廓一眼可比，便于与专项所需的能力模型对照、排出个人训练优先级，也适合在沟通时给队员直观展示。注意分数是团队内相对评分而非绝对水平标准，会随所选名单变化；缺测的轴不参与本人均分，缺测较多时画像不完整，应补测后再做结论。`,
      charts: [cc('radar', 1), cc('bar')],
      compute(ctx) {
        const rows = [];
        ctx.metrics.forEach((m) => {
          const lv = lastVals(ctx, m);
          if (!lv.length) return;
          const vals = lv.map((x) => x.val);
          const best = m.invert ? Math.min(...vals) : Math.max(...vals);
          const worst = m.invert ? Math.max(...vals) : Math.min(...vals);
          const span = best - worst;
          rows.push({ m, lv, score: (v) => span > 0 ? Math.round((v - worst) / span * 100) : 100 });
        });
        if (!rows.length) return { empty: '当前筛选下没有任何指标数据', insight: '提示：雷达画像需要至少 1 个指标、每名运动员有末次测试值。' };
        const cats = rows.map((r) => r.m.label);
        const athsShow = ctx.aths.slice(0, 8);
        // 真值矩阵：缺测为 null（统计口径）；雷达图渲染时缺测轴补 0（视觉口径）
        const grid = athsShow.map((a) => rows.map((r) => { const hit = r.lv.find((x) => x.ath.id === a.id); return hit ? r.score(hit.val) : null; }));
        const series = athsShow.map((a, i) => ({ name: a.name, data: grid[i].map((v) => (v == null ? 0 : v)) }));
        const avgs = athsShow.map((a, i) => { const vs = grid[i].filter((v) => v != null); return { name: a.name, avg: vs.length ? mean(vs) : null, cover: vs.length }; });
        const bestAth = avgs.filter((x) => x.avg != null).sort((x, y) => y.avg - x.avg)[0];
        let bestWeak = null;
        if (bestAth) {
          const bi = avgs.findIndex((x) => x.name === bestAth.name);
          bestWeak = rows.map((r, ri) => ({ label: r.m.label, v: grid[bi][ri] })).filter((x) => x.v != null).sort((x, y) => x.v - y.v)[0];
        }
        const axisAvg = rows.map((r) => {
          const vs = ctx.aths.map((a) => { const hit = r.lv.find((x) => x.ath.id === a.id); return hit ? r.score(hit.val) : null; }).filter((v) => v != null);
          return { label: r.m.label, avg: vs.length ? mean(vs) : null, cover: vs.length };
        });
        const weakest = axisAvg.filter((x) => x.avg != null).sort((x, y) => x.avg - y.avg)[0];
        const missAths = ctx.aths.map((a) => ({ name: a.name, miss: rows.filter((r) => !r.lv.some((x) => x.ath.id === a.id)).length })).filter((x) => x.miss > 0);
        let insight = `${ctx.aths.length} 位运动员 × ${rows.length} 项能力的团队内归一化画像（每项 100 = 该项团队最佳、0 = 团队最差；缺测轴不参与本人均分）。`;
        if (bestAth) {
          insight += `综合均分最高：${U.esc(bestAth.name)}（${fmtV(bestAth.avg)} 分，覆盖 ${bestAth.cover}/${rows.length} 项）`;
          if (bestWeak && rows.length >= 2) insight += `，其相对最短板是 ${U.esc(bestWeak.label)}（${bestWeak.v} 分）`;
          insight += '。';
          if (bestAth.cover < rows.length) insight += `该运动员仅覆盖 ${bestAth.cover} 项，综合分代表性有限，建议补测后再评估。`;
        }
        if (weakest && weakest.avg < 60) insight += `团队整体最薄弱的轴是 ${U.esc(weakest.label)}（有数据者平均 ${fmtV(weakest.avg)} 分，${weakest.cover} 人参评），可考虑列为下一阶段集体训练重点。`;
        if (missAths.length) insight += `${missAths.length} 人存在缺测项目（${missAths.slice(0, 3).map((x) => U.esc(x.name)).join('、')}${missAths.length > 3 ? ' 等' : ''}）：图中缺测轴按 0 分绘制但不计入均分，补测后画像更准确。`;
        if (ctx.aths.length > 8) insight += `雷达图最多展示 8 人，其余人员的详细得分见下方柱状图和数据表。`;
        const table = { head: ['运动员', ...cats.map(U.esc), '平均'], rows: ctx.aths.map((a) => { const vs = rows.map((r) => { const hit = r.lv.find((x) => x.ath.id === a.id); return hit ? r.score(hit.val) : null; }); return [U.esc(a.name), ...vs.map((v) => v == null ? '—' : v), vs.filter((v) => v != null).length ? fmtV(mean(vs.filter((v) => v != null))) : '—']; }) };
        return { cats, series, gaugeMax: 100, insight, table };
      }
    },
    {
      id: 'relval', name: '相对值标准化（/体重）',
      intro: '把绝对成绩除以体重得到相对值（如相对力量 kg/kg），消除体重优势，公平比较不同体格的运动员。',
      algo: `① 相对值 = 测试值 ÷ 体重（kg/kg），体重取该运动员区间内末次体重记录
② 典型应用：深蹲1RM ÷ 体重 = 相对力量——70kg 选手蹲 140kg（2.0 倍）强于 100kg 选手蹲 190kg（1.9 倍）
③ NSCA 惯例：相对力量以 1RM/体重表示；一般人群深蹲参考 1.5-2.5 倍体重区间（因项目、性别而异）
④ 无体重记录或区间内无体重数据者无法计算
⑤ 散点图模式：X = 体重、Y = 相对值，可观察「增重是否拖累相对值」`,
      meaning: `回答「剔除体重优势后，谁的能力真正更强」。在按体重分级的项目（举重、格斗、轻量级划船等）选材和横向比较时，相对值比绝对值公平；它还能检验增重回报——体重涨了、相对值反而掉，说明增加的可能不是有效肌肉。该方法主要适用于力量、跳跃等「越大越好」的指标；计时类成绩除以体重没有公认的训练学含义，系统仍会计算但仅作参考，不应据此指导减重。`,
      charts: [cc('bar', 1), cc('hbar'), cc('scatter')],
      compute(ctx) {
        const WM = { key: 'weight', label: '体重', unit: 'kg', invert: false, source: 'profile', field: 'weight' };
        const flat = [];
        const cats = ctx.aths.map((a) => a.name);
        let firstScatter = null;
        const series = ctx.metrics.map((m) => {
          const data = ctx.aths.map((a) => {
            const ws = seriesOf(a.id, WM, ctx.from, ctx.to);
            if (!ws.length) return null;
            const w = ws[ws.length - 1].value;
            const s = seriesOf(a.id, m, ctx.from, ctx.to);
            if (!s.length) return null;
            const rel = s[s.length - 1].value / w;
            flat.push({ athName: a.name, mLabel: m.label, val: s[s.length - 1].value, w, rel, invert: m.invert, unit: m.unit });
            if (!firstScatter) firstScatter = { m, athName: a.name, x: w, y: Math.round(rel * 100) / 100 };
            return Math.round(rel * 100) / 100;
          });
          return { name: m.label + ' /kg', data };
        });
        const ok = flat.filter((x) => x.rel != null);
        if (!ok.length) return { empty: '当前筛选下没有「测试值 + 体重」齐备的数据', insight: '提示：相对值需要运动员在所选日期范围内既有目标指标又有体重记录（在「添加体能数据」中录入）。' };
        const power = ok.filter((x) => !x.invert).sort((a, b) => b.rel - a.rel);
        const timed = ok.filter((x) => x.invert).sort((a, b) => a.rel - b.rel);
        let insight = `共 ${ok.length} 组「末次成绩 ÷ 末次体重」的体重标准化值，用于剔除体型差异后的横向比较。`;
        if (power.length) { const b = power[0]; insight += `力量/计数类指标（数值越大越好）：${U.esc(b.athName)} 的 ${U.esc(b.mLabel)} 相对表现最优，为 ${fmtV(b.rel)} ${b.unit}/kg（体重 ${fmtV(b.w)}kg，绝对值 ${fmtV(b.val)} ${b.unit}）。`; }
        if (timed.length) { const b = timed[0]; insight += `计时类指标（标准化后仍为数值越小越好）：${U.esc(b.athName)} 的 ${U.esc(b.mLabel)} 最优，为 ${fmtV(b.rel)} ${b.unit}/kg（体重 ${fmtV(b.w)}kg）。注意计时类成绩除以体重没有公认的训练学含义，该结果仅供参考。`; }
        const wMeta = [...new Map(flat.map((x) => [x.athName, x.w])).entries()];
        if (wMeta.length >= 3 && firstScatter) {
          const xs = wMeta.map((x) => x[1]);
          insight += `队员体重从 ${fmtV(Math.min(...xs))} 到 ${fmtV(Math.max(...xs))}kg 不等，可以看看体重增加是否影响了相对表现，帮助判断是否需要控制体重。`;
        }
        const table = { head: ['运动员', '指标', '绝对值', '体重 kg', '相对值 /kg'], rows: ok.map((x) => [U.esc(x.athName), U.esc(x.mLabel), fmtV(x.val), fmtV(x.w), fmtV(x.rel)]) };
        let out = { cats, series, insight, table };
        if (firstScatter) {
          const m = firstScatter.m;
          const pts = [];
          ctx.aths.forEach((a) => {
            const ws = seriesOf(a.id, WM, ctx.from, ctx.to);
            if (!ws.length) return;
            const s = seriesOf(a.id, m, ctx.from, ctx.to);
            if (!s.length) return;
            pts.push({ name: a.name, x: ws[ws.length - 1].value, y: Math.round(s[s.length - 1].value / ws[ws.length - 1].value * 100) / 100 });
          });
          if (pts.length >= 3) {
            const reg = linreg(pts.map((p) => ({ x: p.x, y: p.y })));
            out.scatter = { title: `体重 × ${m.label}相对值`, xName: '体重 kg', yName: m.label + ' /kg', points: pts, k: reg.b, b: reg.a, r: reg.r, xmin: Math.min(...pts.map((p) => p.x)), xmax: Math.max(...pts.map((p) => p.x)) };
          }
        }
        return out;
      }
    },
    {
      id: 'rank', name: '综合排名（Z 求和）',
      intro: '把每位运动员在各指标上的 Z 分数取平均得到综合分并排名，回答「谁是当前整体体能最强的人」。',
      algo: `① 综合分 = Σ(各指标 Z 分数) ÷ 有效指标数（Z 分数计时类已取反）
② 每个指标的 Z 均基于当前筛选名单计算，排名只在名单内比较
③ 缺某指标数据的运动员按其有效指标取平均（不罚分，但覆盖少时代表性弱）
④ 综合分 > 0 = 高于名单平均水平；分差 1.0 ≈ 1 个标准差
⑤ 所有指标默认等权重；如需加权，请分组多次分析`,
      meaning: `回答「综合全部测试，当前团队里谁的整体体能水平最高」。把各项目的 Z 分等权平均成一个综合分，给出团队整体序，适合阶段性总评、选拔初筛和向队员说明队内位置。它是相对排名而非绝对评分（0 分=名单平均，约 ±1 分对应一个标准差的差距），且等权重未必符合专项需求——专项最看重的项目应单独分组排名；只覆盖了少数指标的人，综合分代表性弱，不宜直接与全勤者比较。`,
      charts: [cc('bar', 1), cc('hbar'), cc('funnel')],
      compute(ctx) {
        const perAth = ctx.aths.map((a) => ({ ath: a, zs: [], miss: 0 }));
        ctx.metrics.forEach((m) => {
          const lv = lastVals(ctx, m);
          const arr = lv.map((x) => x.val);
          if (arr.length < 2) return;
          const sd = Calc.std(arr);
          if (sd <= 0) return;
          const mu = mean(arr);
          perAth.forEach((pa) => {
            const hit = lv.find((x) => x.ath.id === pa.ath.id);
            if (!hit) { pa.miss++; return; }
            let z = (hit.val - mu) / sd;
            if (m.invert) z = -z;
            pa.zs.push(z);
          });
        });
        const scored = perAth.filter((pa) => pa.zs.length).map((pa) => ({ name: pa.ath.name, score: Math.round(mean(pa.zs) * 100) / 100, cover: pa.zs.length, miss: pa.miss })).sort((a, b) => b.score - a.score);
        if (!scored.length) return { empty: '当前筛选下有效团队数据不足（每个指标需 ≥ 2 人有数据）', insight: '提示：综合排名基于团队内 Z 分数，每个指标至少 2 人有末次测试值。' };
        const cats = scored.map((x) => x.name);
        const series = [{ name: '综合分', data: scored.map((x) => x.score) }];
        const top3 = scored.slice(0, 3);
        const last = scored[scored.length - 1];
        const coverMin = Math.min(...scored.map((x) => x.cover)), coverMax = Math.max(...scored.map((x) => x.cover));
        let insight = `${scored.length} 位运动员的综合 Z 均分排名（0 分 = 名单平均水平，+1 ≈ 高出一个标准差；各指标等权）。前三：${top3.map((x, i) => `${i + 1}. ${U.esc(x.name)}（${pctS(x.score)} 分，${x.cover} 项）`).join('、')}。`;
        if (scored.length > 3 && last) {
          insight += last.score < 0
            ? `${U.esc(last.name)} 排末位（${pctS(last.score)} 分），低于团队平均水平、与第 1 名相差 ${fmtV(top3[0].score - last.score)} 分，建议对照数据表找出拉低均分的指标做个体补强。`
            : `${U.esc(last.name)} 虽排末位但综合分仍为 ${pctS(last.score)}（不低于团队平均），与第 1 名相差 ${fmtV(top3[0].score - last.score)} 分，全队整体水平较为接近。`;
        }
        if (coverMin < coverMax) insight += `各人有效指标数为 ${coverMin}–${coverMax} 项，覆盖较少者排名代表性弱，建议补测后再做正式比较。`;
        const table = { head: ['排名', '运动员', '综合分', '覆盖指标', '缺测'], rows: scored.map((x, i) => [i + 1, U.esc(x.name), pctS(x.score), x.cover + ' 项', x.miss ? x.miss + ' 项' : '—']) };
        return { cats, series, insight, table };
      }
    }
  ];

  // ---------- 状态 ----------
  const state = { aths: [], metrics: [], methods: [], from: '', to: '', panels: [], charts: [], macroFrom: '', macroTo: '', macroName: '', dataMax: '' };

  function persist() {
    Store.data.settings = Store.data.settings || {};
    Store.data.settings.kpiLabPanels = state.panels.map((p) => ({ id: p.id, methodId: p.methodId, aths: p.aths, metrics: p.metrics, from: p.from, to: p.to, chartType: p.chartType }));
    Store.save();   // 关闭工作台时调用——kpi 页订阅会自动重挂载，避免工作中途 dispose 图表
  }

  function buildCtx(aths, metrics, from, to) {
    const athAll = P.planAths();
    const metAll = P.allMetrics();
    return {
      aths: aths.map((id) => athAll.find((a) => a.id === id)).filter(Boolean),
      metrics: metrics.map((k) => metAll.find((x) => x.key === k)).filter(Boolean),
      from, to
    };
  }

  // ---------- 图型渲染 ----------
  // 图型-数据结构兼容性：类别图需要 cats+series，折线/面积另可用 raws，scatter/box/heat 各需对应结构
  const CAT_TYPES = ['bar', 'hbar', 'line', 'area', 'pie', 'donut', 'rose', 'radar', 'gauge', 'pictorial', 'funnel'];
  function dataShape(res) {
    return {
      cats: !!(res.cats && res.cats.length && res.series && res.series.length),
      raws: !!(res.raws && res.raws.length),
      scatter: !!res.scatter,
      boxes: !!(res.boxes && res.boxes.length),
      heat: !!(res.heat && res.heat.data && res.heat.data.length)
    };
  }
  function chartCompat(t, has) {
    if (t === 'scatter') return has.scatter;
    if (t === 'box') return has.boxes;
    if (t === 'heat') return has.heat;
    if (t === 'line' || t === 'area') return has.raws || has.cats;
    return has.cats;
  }
  function drawPanel(pn, res, box) {
    const ct = pn.chartType;
    const has = dataShape(res);
    if (ct === 'scatter' && has.scatter) return drawScatter(box, res.scatter);
    if (ct === 'box' && has.boxes) return drawBoxC(box, res);
    if (ct === 'heat' && has.heat) return drawHeat(box, res.heat);
    if ((ct === 'line' || ct === 'area') && has.raws) return drawRaws(box, ct, res.raws);
    if (CAT_TYPES.includes(ct) && has.cats) return drawCats(box, ct, res);
    // 所选图型与当前数据结构不兼容：自动回退到可用图型并同步下拉显示，避免错画成柱状图
    const fb = has.heat ? 'heat' : has.scatter ? 'scatter' : has.boxes ? 'box' : has.raws ? 'line' : has.cats ? 'bar' : '';
    if (!fb) { box.innerHTML = '<div class="kl-nodata">当前图型无法展示该数据，请切换其他图型</div>'; return; }
    pn.chartType = fb;
    const sel = document.querySelector(`#klPanels [data-kpct="${pn.id}"]`);
    if (sel && [...sel.options].some((o) => o.value === fb)) sel.value = fb;
    if (fb === 'heat') return drawHeat(box, res.heat);
    if (fb === 'scatter') return drawScatter(box, res.scatter);
    if (fb === 'box') return drawBoxC(box, res);
    if (fb === 'line') return drawRaws(box, 'line', res.raws);
    return drawCats(box, 'bar', res);
  }

  const gridBase = { left: 56, right: 26, top: 34, bottom: 44 };
  const catAxisLabel = (n) => ({ color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, rotate: n > 8 ? 40 : 0, interval: 0, width: n > 8 ? 60 : undefined, overflow: 'truncate' });
  const multiLegend = (series) => (series.length > 1 ? { top: 0, type: 'scroll', textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 } } : undefined);
  const tipItem = () => ({ trigger: 'item', ...UI.tooltipCommon });
  const tipAxis = () => ({ trigger: 'axis', ...UI.tooltipCommon });

  function drawCats(box, ct, res) {
    const cats = res.cats || [];
    const series = res.series || [];
    const chart = UI.chart(box);
    state.charts.push(chart);

    // 柱状/条形图增强：圆角 + 方向性渐变；单系列时逐类目循环配色，避免单色平铺
    // vertical=true 顶部实色→底部透明；false 左透明→右实色（条越长越亮，视觉引导数值大小）
    const mkBarItem = (s, si, vertical) => {
      // 实色端始终在数值头部：正柱实色在顶/右、负柱实色在底/左；另一端 25% 透明
      const grad = (c, neg) => new echarts.graphic.LinearGradient(
        ...(vertical ? (neg ? [0, 1, 0, 0] : [0, 0, 0, 1]) : (neg ? [0, 0, 1, 0] : [1, 0, 0, 0])),
        [{ offset: 0, color: c }, { offset: 1, color: UI.alpha(c, .25) }]);
      // 圆角始终在数值延伸的头部一端：正柱顶/右、负柱底/左
      const radiusOf = (v) => {
        const neg = v != null && v < 0;
        return vertical ? (neg ? [0, 0, 5, 5] : [5, 5, 0, 0]) : (neg ? [5, 0, 0, 5] : [0, 5, 5, 0]);
      };
      const single = series.length === 1;
      const data = single
        ? (s.data || []).map((v, ci) => ({ value: v, itemStyle: { color: grad(KL_COLORS[ci % KL_COLORS.length], v != null && v < 0), borderRadius: radiusOf(v) } }))
        : s.data;
      return { type: 'bar', name: s.name, data, itemStyle: single ? undefined : { color: grad(KL_COLORS[si % KL_COLORS.length], false), borderRadius: [5, 5, 0, 0] } };
    };
    // 单系列逐点贴头部标签：标签位置随正负走（柱状图 top/bottom、条形图 right/left），避免负值标签堆在 0 轴
    const withTipLabels = (o, posOf) => {
      if (!Array.isArray(o.data)) return o;
      o.data = o.data.map((d) => {
        const v = d && typeof d === 'object' ? d.value : d;
        return Object.assign({}, d, { label: { show: true, position: posOf(v), color: '#c8d0de', fontSize: 10, formatter: (p) => fmtV(p.value) } });
      });
      return o;
    };

    if (ct === 'pie' || ct === 'donut' || ct === 'rose') {
      const s0 = series[0] || { name: '', data: [] };
      const data = cats.map((c, i) => ({ name: c, value: s0.data[i] })).filter((d) => d.value != null && d.value > 0);
      chart.setOption({
        tooltip: tipItem(), color: KL_COLORS,
        legend: { bottom: 0, type: 'scroll', textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 } },
        series: [{ type: 'pie', name: s0.name, radius: ct === 'donut' ? ['36%', '60%'] : '60%', center: ['50%', '46%'], roseType: ct === 'rose' ? 'radius' : false, data,
          label: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, formatter: '{b}\n{d}%' }, emphasis: { scaleSize: 6 } }]
      });
      return;
    }
    if (ct === 'funnel') {
      const s0 = series[0] || { name: '', data: [] };
      const data = cats.map((c, i) => ({ name: c, value: s0.data[i] })).filter((d) => d.value != null).sort((a, b) => b.value - a.value);
      chart.setOption({
        tooltip: tipItem(), color: KL_COLORS,
        series: [{ type: 'funnel', left: '8%', width: '84%', top: 16, bottom: 12, sort: 'descending', gap: 3, data, label: { color: UI.cssVar('var(--color-ink)'), fontSize: 11, formatter: '{b}: {c}' } }]
      });
      return;
    }
    if (ct === 'radar') {
      const vals = series.flatMap((s) => s.data || []).filter((v) => v != null);
      const max = res.gaugeMax || niceMax(vals);
      chart.setOption({
        tooltip: tipItem(), color: KL_COLORS,
        legend: { bottom: 0, type: 'scroll', textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 } },
        radar: { indicator: cats.map((c) => ({ name: c, max, min: 0 })), radius: '56%', center: ['50%', '48%'],
          axisName: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 }, splitArea: { areaStyle: { color: [UI.tint('var(--color-info)', .03), UI.tint('var(--color-info)', .07)] } },
          splitLine: { lineStyle: { color: UI.tint('var(--color-ink-muted)', .15) } }, axisLine: { lineStyle: { color: UI.tint('var(--color-ink-muted)', .15) } } },
        series: [{ type: 'radar', data: series.map((s, i) => ({ name: s.name, value: s.data, symbolSize: 4, lineStyle: { width: 2.5 }, areaStyle: { color: KL_COLORS[i % KL_COLORS.length], opacity: .12 } })) }]
      });
      return;
    }
    if (ct === 'gauge') {
      const s0 = series[0] || { name: '', data: [] };
      const items = cats.map((c, i) => ({ name: c, value: s0.data[i] })).filter((d) => d.value != null).slice(0, 6);
      const max = res.gaugeMax || niceMax(items.map((x) => x.value));
      const n = items.length, cols = Math.min(3, Math.max(1, n)), rows = Math.ceil(n / cols);
      chart.setOption({
        tooltip: tipItem(),
        series: items.map((it, i) => ({
          type: 'gauge', min: 0, max,
          center: [((i % cols) + 0.5) / cols * 100 + '%', rows > 1 ? (Math.floor(i / cols) + 0.5) / rows * 72 + 14 + '%' : '54%'],
          radius: rows > 1 ? '40%' : '58%', startAngle: 210, endAngle: -30,
          progress: { show: true, width: 8, itemStyle: { color: KL_COLORS[i % KL_COLORS.length] } },
          axisLine: { lineStyle: { width: 8, color: [[1, UI.tint('var(--color-ink-muted)', .18)]] } },
          pointer: { length: '58%', width: 4, itemStyle: { color: UI.cssVar('var(--color-ink)') } },
          axisTick: { show: false }, splitLine: { show: false },
          axisLabel: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 9, distance: 10 },
          title: { offsetCenter: [0, '74%'], color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 },
          detail: { offsetCenter: [0, '46%'], color: UI.cssVar('var(--color-ink)'), fontSize: 13, formatter: (x) => fmtV(x) },
          data: [{ value: it.value, name: it.name }]
        }))
      });
      return;
    }
    if (ct === 'hbar') {
      // 单系列标签贴条头：正值在右、负值在左（避免负值标签全堆在 0 轴）
      const hbarSeries = series.map((s, si) => {
        const o = Object.assign(mkBarItem(s, si, false), { barMaxWidth: 24 });
        if (series.length === 1 && cats.length <= 20) withTipLabels(o, (v) => (v != null && v < 0 ? 'left' : 'right'));
        return o;
      });
      chart.setOption({
        tooltip: tipAxis(), color: KL_COLORS, legend: multiLegend(series),
        grid: { left: 96, right: 44, top: 34, bottom: 30 },
        xAxis: { type: 'value', ...UI.axisCommon },
        yAxis: { type: 'category', data: cats, inverse: true, ...UI.axisCommon, axisLabel: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, width: 86, overflow: 'truncate' } },
        series: hbarSeries
      });
      return;
    }
    if (ct === 'pictorial' && !series.some((s) => (s.data || []).some((v) => v != null && v < 0))) {
      chart.setOption({
        tooltip: tipAxis(), color: KL_COLORS, legend: multiLegend(series),
        grid: gridBase,
        xAxis: { type: 'category', data: cats, ...UI.axisCommon, axisLabel: catAxisLabel(cats.length) },
        yAxis: { type: 'value', ...UI.axisCommon },
        series: series.map((s) => ({ type: 'pictorialBar', name: s.name, symbol: 'roundRect', symbolRepeat: true, symbolSize: ['68%', '62%'], data: s.data, z: 10 }))
      });
      return;
    }
    if (ct === 'line' || ct === 'area') {
      chart.setOption({
        tooltip: tipAxis(), color: KL_COLORS, legend: multiLegend(series),
        grid: gridBase,
        xAxis: { type: 'category', data: cats, ...UI.axisCommon, axisLabel: catAxisLabel(cats.length), boundaryGap: false },
        yAxis: { type: 'value', ...UI.axisCommon, scale: true },
        series: series.map((s) => ({ type: 'line', name: s.name, data: s.data, smooth: true, symbolSize: 5, connectNulls: true, lineStyle: { width: 2.5 }, areaStyle: ct === 'area' ? { opacity: .16 } : undefined }))
      });
      return;
    }
    // bar（默认 / pictorial 负值回退）：单系列标签贴柱头，正值在顶、负值在底
    const barSeries = series.map((s, si) => {
      const o = Object.assign(mkBarItem(s, si, true), { barMaxWidth: 26 });
      if (series.length === 1 && cats.length <= 20) withTipLabels(o, (v) => (v != null && v < 0 ? 'bottom' : 'top'));
      return o;
    });
    chart.setOption({
      tooltip: tipAxis(), color: KL_COLORS, legend: multiLegend(series),
      grid: gridBase,
      xAxis: { type: 'category', data: cats, ...UI.axisCommon, axisLabel: catAxisLabel(cats.length) },
      yAxis: { type: 'value', ...UI.axisCommon },
      series: barSeries
    });
  }

  // 原始序列 + MA / 回归拟合线（trend、movingAvg 的折线/面积模式）
  function drawRaws(box, ct, raws) {
    const dset = [];
    raws.forEach((r) => r.pts.forEach((p) => { if (!dset.includes(p.date)) dset.push(p.date); }));
    dset.sort();
    const chart = UI.chart(box);
    state.charts.push(chart);
    chart.setOption({
      tooltip: tipAxis(), color: KL_COLORS,
      legend: { top: 0, type: 'scroll', textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 } },
      grid: gridBase,
      xAxis: { type: 'category', data: dset.map(U.md), ...UI.axisCommon, axisLabel: catAxisLabel(dset.length), boundaryGap: false },
      yAxis: { type: 'value', ...UI.axisCommon, scale: true },
      series: raws.flatMap((r, i) => {
        const m2 = {};
        (r.ma || r.fit || []).forEach((p) => { m2[p.date] = p.value; });
        const out = [{
          type: 'line', name: r.name, data: dset.map((d) => { const hit = r.pts.find((p) => p.date === d); return hit ? hit.value : null; }),
          symbolSize: 4, lineStyle: { width: 1.2, opacity: .55 }, itemStyle: { opacity: .75 }, connectNulls: true, color: KL_COLORS[i % KL_COLORS.length]
        }];
        if (r.ma) out.push({ type: 'line', name: r.name + ' MA3', data: dset.map((d) => (m2[d] != null ? Math.round(m2[d] * 100) / 100 : null)), smooth: true, symbol: 'none', lineStyle: { width: 3 }, connectNulls: true, color: KL_COLORS[i % KL_COLORS.length] });
        if (r.fit) out.push({ type: 'line', name: r.name + ' 回归', data: dset.map((d) => (m2[d] != null ? Math.round(m2[d] * 100) / 100 : null)), symbol: 'none', lineStyle: { width: 1.6, type: 'dashed' }, connectNulls: true, color: KL_COLORS[i % KL_COLORS.length] });
        if (ct === 'area') out[out.length - 1].areaStyle = { opacity: .14 };
        return out;
      })
    });
  }

  function drawScatter(box, sc) {
    const chart = UI.chart(box);
    state.charts.push(chart);
    chart.setOption({
      tooltip: { trigger: 'item', ...UI.tooltipCommon, formatter: (p) => p.seriesType === 'scatter' ? `${p.marker}${U.esc(p.name)}<br/>${U.esc(sc.xName)}：<b>${fmtV(p.value[0])}</b><br/>${U.esc(sc.yName)}：<b>${fmtV(p.value[1])}</b>` : `${p.marker}${p.seriesName}` },
      grid: { left: 60, right: 30, top: 32, bottom: 48 },
      xAxis: { type: 'value', name: sc.xName, nameTextStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 }, nameGap: 22, ...UI.axisCommon, scale: true },
      yAxis: { type: 'value', name: sc.yName, nameTextStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 }, ...UI.axisCommon, scale: true },
      series: [
        { type: 'scatter', name: sc.title, data: sc.points.map((p) => ({ name: p.name, value: [p.x, p.y] })), symbolSize: 12, itemStyle: { color: UI.cssVar('var(--color-info)'), opacity: .85 } },
        { type: 'line', name: `回归线 r=${fmtV(sc.r)}`, data: [{ value: [sc.xmin, sc.k * sc.xmin + sc.b] }, { value: [sc.xmax, sc.k * sc.xmax + sc.b] }], symbol: 'none', lineStyle: { color: UI.cssVar('var(--color-success)'), width: 2, type: 'dashed' }, tooltip: { show: false } }
      ]
    });
  }

  function drawBoxC(box, res) {
    const chart = UI.chart(box);
    state.charts.push(chart);
    const series = [{ type: 'boxplot', name: '五数概括', data: res.boxes.map((b) => [b.min, b.q1, b.med, b.q3, b.max]), itemStyle: { color: UI.tint('var(--color-info)', .25), borderColor: UI.cssVar('var(--color-info)'), borderWidth: 1.6 }, barMaxWidth: 40 }];
    const outliers = [];
    res.boxes.forEach((b, i) => (b.outliers || []).forEach((v) => outliers.push([i, v])));
    if (outliers.length) series.push({ type: 'scatter', name: '离群值', data: outliers, symbolSize: 8, itemStyle: { color: 'var(--color-danger)' } });
    chart.setOption({
      tooltip: { trigger: 'axis', ...UI.tooltipCommon, formatter: (ps) => (Array.isArray(ps) ? ps : [ps]).map((p) => p.seriesType === 'boxplot' ? `${p.marker}${p.name}：中位 <b>${fmtV(p.value[2])}</b> · Q1 ${fmtV(p.value[1])} · Q3 ${fmtV(p.value[3])}` : `${p.marker}${p.name} ${fmtV(p.value[1])}`).join('<br/>') },
      grid: gridBase,
      xAxis: { type: 'category', data: res.cats, ...UI.axisCommon, axisLabel: catAxisLabel(res.cats.length) },
      yAxis: { type: 'value', ...UI.axisCommon, scale: true },
      series
    });
  }

  function drawHeat(box, res) {
    const chart = UI.chart(box);
    state.charts.push(chart);
    const vals = res.data.map((d) => d[2]);
    const maxAbs = Math.max(...vals.map((v) => Math.abs(v)), 0.001);
    chart.setOption({
      tooltip: { trigger: 'item', ...UI.tooltipCommon, formatter: (p) => `${U.esc(res.yCats[p.value[1]])}<br/>${U.esc(res.xCats[p.value[0]])}：<b>${fmtV(p.value[2])}</b>` },
      grid: { left: 116, right: 96, top: 12, bottom: 56 },
      xAxis: { type: 'category', data: res.xCats, ...UI.axisCommon, axisLabel: catAxisLabel(res.xCats.length), splitArea: { show: true } },
      yAxis: { type: 'category', data: res.yCats, ...UI.axisCommon, axisLabel: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, width: 108, overflow: 'truncate' }, splitArea: { show: true } },
      visualMap: { min: -maxAbs, max: maxAbs, calculable: true, orient: 'vertical', right: 2, top: 'center', itemHeight: 120, textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10 },
        inRange: { color: [UI.cssVar('var(--color-info)'), '#151b29', UI.cssVar('var(--color-success)')] } },   // 负=蓝（弱）· 0=暗 · 正=绿（强）
      series: [{ type: 'heatmap', data: res.data, label: { show: res.data.length <= 60, color: UI.cssVar('var(--color-ink)'), fontSize: 10, formatter: (p) => fmtV(p.value[2]) } }]
    });
  }

  // ---------- 交互 ----------
  function algoModal(m) {
    UI.modal({
      title: `${m.name} · 算法说明`,
      body: `<div class="kl-meaning"><div class="kl-meaning-t">📊 这个分析方法有什么用</div><p>${U.esc(m.meaning || '')}</p></div><div class="kl-meaning-t">一句话说明</div><p style="line-height:1.8;margin:0 0 10px;color:var(--color-ink-muted)">${U.esc(m.intro)}</p><div class="kl-meaning-t">计算公式与标注解释</div><pre style="white-space:pre-wrap;font-family:inherit;line-height:1.9;color:var(--color-ink);background:color-mix(in oklch, var(--color-ink-muted) 8%, transparent);padding:12px;border-radius:8px;margin:0">${U.esc(m.algo)}</pre>`,
      footer: `<button class="btn primary" data-x>知道了</button>`
    });
  }

  function pickChartType(m, i, total, probe) {
    return new Promise((resolve) => {
      const has = probe ? dataShape(probe) : null;
      const items = m.charts.filter((c) => !has || chartCompat(c.t, has));   // 只列出与当前数据结构兼容的图型
      const defType = ((items.find((c) => c.rec) || items[0]) || {}).t || null;   // 默认选中推荐图，直接点确认即可
      UI.modal({
        title: `选择图型 · ${m.name}（${i}/${total}）`,
        wide: true,
        body: `<div class="kl-cts">${items.map((c) => `<div class="kl-ct ${c.rec ? 'rec' : ''}${c.t === defType ? ' sel' : ''}" data-ct="${c.t}">${c.rec ? '<span class="kl-rec">★ 系统推荐</span>' : ''}<b>${CTYPES[c.t].name}</b><span>${CTYPES[c.t].desc}</span></div>`).join('')}</div>`,
        footer: `<button class="btn primary" data-ok>确认</button><button class="btn ghost" data-reset>重新选择</button>`,
        onMount(ov, close) {
          let sel = defType;
          const paint = () => ov.querySelectorAll('.kl-ct').forEach((x) => x.classList.toggle('sel', x.dataset.ct === sel));
          ov.querySelectorAll('.kl-ct').forEach((el) => {
            el.onclick = () => { sel = el.dataset.ct; paint(); };
          });
          ov.querySelector('[data-reset]').onclick = () => { close(); resolve('__reselect__'); };   // 重新选择：关闭图型弹窗，回到筛选面板重新选择分析参数
          ov.querySelector('[data-ok]').onclick = () => { close(); resolve(sel); };
          // 右上角 X / 点遮罩 / ESC：关闭并跳过该图型（等价原「取消」，避免 await 悬挂）
          const skip = () => { close(); resolve(null); };
          ov.querySelector('.modal-x').onclick = skip;
          ov.addEventListener('mousedown', (e) => { if (e.target === ov) skip(); });
          const onEsc = (e) => { if (e.key === 'Escape') skip(); };
          document.addEventListener('keydown', onEsc);
        }
      });
    });
  }

  async function generate() {
    if (!state.aths.length) { UI.toast('请至少选择 1 名运动员', 'err'); return; }
    if (!state.metrics.length) { UI.toast('请至少选择 1 个测试项目', 'err'); return; }
    if (!state.methods.length) { UI.toast('请至少选择 1 种分析方法', 'err'); return; }
    if (state.from && state.to && state.from > state.to) { UI.toast('开始日期不能晚于结束日期', 'err'); return; }
    const ctx = buildCtx(state.aths, state.metrics, state.from, state.to);
    const ms = METHODS.filter((m) => state.methods.includes(m.id));
    let made = 0;
    const pending = [];   // 仅新方法弹图型选择；已有看板的方法静默按当前筛选更新（沿用原图型）
    for (const m of ms) {
      const exist = state.panels.find((p) => p.methodId === m.id);
      let probe;
      try { probe = m.compute(ctx); } catch (e) { UI.toast(`「${m.name}」计算出错：${e.message}`, 'err'); continue; }
      const has = probe && !probe.empty ? dataShape(probe) : null;
      const hasData = has && (has.cats || has.raws || has.scatter || has.boxes || has.heat);
      if (!hasData) {
        if (!exist) UI.toast(`「${m.name}」在当前筛选下没有可用数据，已跳过（可试试点「全部」扩大日期范围，或勾选更多测试项目）`, 'err');
        continue;   // 已有看板的方法无新数据时保留原看板不动
      }
      if (exist) { Object.assign(exist, { aths: state.aths.slice(), metrics: state.metrics.slice(), from: state.from, to: state.to }); made++; }
      else pending.push({ m, probe });
    }
    for (let i = 0; i < pending.length; i++) {
      const ct = await pickChartType(pending[i].m, i + 1, pending.length, pending[i].probe);
      if (ct === '__reselect__') { UI.toast('已返回筛选面板，可重新选择运动员 / 测试项目 / 分析方法', 'ok'); break; }   // 用户点「重新选择」→ 终止生成，回筛选面板
      if (!ct) continue;   // 用户跳过该方法
      state.panels.push({ id: U.uid('kp'), methodId: pending[i].m.id, aths: state.aths.slice(), metrics: state.metrics.slice(), from: state.from, to: state.to, chartType: ct });
      made++;
    }
    if (made) { UI.toast(`已生成 ${made} 个看板`, 'ok'); renderPanels(); updateGenBtn(); }
  }

  // ---------- 渲染 ----------
  function updateGenBtn() {
    const b = $('#klGen');
    if (b) b.textContent = `生成看板（${state.methods.length}）`;
  }

  function renderFilters() {
    const aths = P.planAths();
    const metrics = P.allMetrics();
    // 姓名
    $('#klAths').innerHTML = aths.map((a) => `<span class="chip ${state.aths.includes(a.id) ? 'on' : ''}" data-ath="${a.id}">${U.esc(a.name)}</span>`).join('');
    $$('#klAths [data-ath]').forEach((el) => {
      el.onclick = () => {
        const id = el.dataset.ath, i = state.aths.indexOf(id);
        if (i >= 0) state.aths.splice(i, 1); else state.aths.push(id);
        el.classList.toggle('on');
      };
    });
    // 测试项目（按分类分组）
    const groups = [];
    metrics.forEach((m) => {
      const c = m.cat || '其他';
      let g = groups.find((x) => x.cat === c);
      if (!g) { g = { cat: c, items: [] }; groups.push(g); }
      g.items.push(m);
    });
    $('#klMetrics').innerHTML = groups.map((g) => `<div class="kl-mg"><span class="kl-mgl">${U.esc(g.cat)}</span>${g.items.map((m) => `<span class="chip ${state.metrics.includes(m.key) ? 'on' : ''}" data-met="${m.key}" title="${U.esc(m.label)}${m.unit ? '（' + m.unit + '）' : ''}">${U.esc(m.label)}</span>`).join('')}</div>`).join('');
    $$('#klMetrics [data-met]').forEach((el) => {
      el.onclick = () => {
        const k = el.dataset.met, i = state.metrics.indexOf(k);
        if (i >= 0) state.metrics.splice(i, 1); else state.metrics.push(k);
        el.classList.toggle('on');
      };
    });
    // 方法
    $('#klMethods').innerHTML = METHODS.map((m) => `<span class="chip ${state.methods.includes(m.id) ? 'on' : ''}" data-mth="${m.id}">${m.name}<i class="kl-info" data-minfo="${m.id}">ⓘ</i></span>`).join('');
    $$('#klMethods [data-mth]').forEach((el) => {
      el.onclick = (e) => {
        if (e.target.classList.contains('kl-info')) return;
        const id = el.dataset.mth, i = state.methods.indexOf(id);
        if (i >= 0) state.methods.splice(i, 1); else state.methods.push(id);
        el.classList.toggle('on');
        updateGenBtn();
      };
    });
    $$('#klMethods [data-minfo]').forEach((el) => {
      el.onclick = (e) => { e.stopPropagation(); algoModal(METHODS.find((m) => m.id === el.dataset.minfo)); };
    });
    // 日期
    $('#klFrom').value = state.from;
    $('#klTo').value = state.to;
    $('#klFrom').onchange = (e) => { state.from = e.target.value; };
    $('#klTo').onchange = (e) => { state.to = e.target.value; };
    // 「全部」= 整个可选边界；近 N 天锚定最新一条测试数据的日期（而非今天），并钳制在边界内
    const anchor = state.dataMax || U.today();
    const clampD = (d) => {
      if (state.macroFrom && d < state.macroFrom) return state.macroFrom;
      if (state.macroTo && d > state.macroTo) return state.macroTo;
      return d;
    };
    const qRange = (n) => { const t = clampD(anchor); let f = clampD(U.addDays(anchor, -(n - 1))); if (f > t) f = state.macroFrom || t; return [f, t]; };
    const quick = {
      all: [state.macroFrom || '', state.macroTo || ''],
      d90: qRange(90),
      d28: qRange(28),
      d7: qRange(7)
    };
    $$('#klQuick [data-q]').forEach((b) => {
      b.onclick = () => {
        const [f, t] = quick[b.dataset.q];
        state.from = f; state.to = t;
        $('#klFrom').value = f; $('#klTo').value = t;
      };
    });
    $('#klAthAll').onclick = () => { state.aths = aths.map((a) => a.id); renderFilters(); };
    $('#klAthNone').onclick = () => { state.aths = []; renderFilters(); };
  }

  function renderPanels() {
    const host = $('#klPanels');
    state.charts.forEach((c) => { try { c.dispose(); } catch (e) { /* 已随 DOM 移除 */ } });
    state.charts = [];
    if (!state.panels.length) {
      host.innerHTML = `<div class="card kl-empty">尚无看板——在上方选择分析方法后点击「生成看板」。<br/>生成后可继续调整筛选、选择更多方法追加看板。</div>`;
      return;
    }
    const metAll = P.allMetrics();
    host.innerHTML = state.panels.map((pn, idx) => {
      const m = METHODS.find((x) => x.id === pn.methodId);
      if (!m) return '';
      const ctOpts = m.charts.map((c) => `<option value="${c.t}" ${c.t === pn.chartType ? 'selected' : ''}>${CTYPES[c.t].name}${c.rec ? ' ★推荐' : ''}</option>`).join('');
      const sum = `${pn.aths.length} 人 · ${pn.metrics.length} 项 · ${pn.from ? U.md(pn.from) : '全部'} ~ ${pn.to ? U.md(pn.to) : '至今'}`;
      return `<div class="card kl-panel">
        <div class="kl-phead">
          <b>${CN_NUM[idx] || (idx + 1)} ${m.name}</b>
          <span class="kl-qalgo" data-mth-info="${m.id}">算法 ⓘ</span>
          <span class="hint kl-sum">${U.esc(sum)}</span>
          <span class="spacer"></span>
          <span class="hint">图型</span>
          <select class="sel" data-kpct="${pn.id}">${ctOpts}</select>
          <button class="btn sm ghost" data-kpdel="${pn.id}">✕ 移除</button>
        </div>
        <div class="kl-canvas" id="klcv-${pn.id}"></div>
        <div class="kl-insight"><b>结果解读</b><div id="klin-${pn.id}"></div></div>
        <details class="kl-algo"><summary>算法与标注解释</summary><pre>${U.esc(m.algo)}</pre></details>
        <details class="kl-tbl"><summary>数据表</summary><div id="kltb-${pn.id}"></div></details>
      </div>`;
    }).join('');
    state.panels.forEach((pn) => {
      const m = METHODS.find((x) => x.id === pn.methodId);
      if (!m) return;
      const ctx = buildCtx(pn.aths, pn.metrics, pn.from, pn.to);
      let res;
      try { res = m.compute(ctx); } catch (e) { res = { empty: '计算出错：' + e.message, insight: '' }; }
      $('#klin-' + pn.id).innerHTML = res.insight || '—';
      if (res.table && res.table.rows.length) $('#kltb-' + pn.id).innerHTML = tblHTML(res.table);
      const box = $('#klcv-' + pn.id);
      if (res.empty) box.innerHTML = `<div class="kl-nodata">${U.esc(res.empty)}</div>`;
      else { try { drawPanel(pn, res, box); } catch (e) { box.innerHTML = `<div class="kl-nodata">图表绘制失败：${U.esc(e.message)}</div>`; } }
      // 按当前数据结构禁用不兼容的图型选项（如单指标 Z 分数无热力矩阵，禁用热力图）
      const selEl = document.querySelector(`#klPanels [data-kpct="${pn.id}"]`);
      if (selEl) {
        const has2 = res.empty ? { cats: false, raws: false, scatter: false, boxes: false, heat: false } : dataShape(res);
        [...selEl.options].forEach((o) => { o.disabled = !chartCompat(o.value, has2); });
      }
    });
    $$('#klPanels [data-kpct]').forEach((sel) => {
      sel.onchange = () => {
        const pn = state.panels.find((x) => x.id === sel.dataset.kpct);
        if (!pn) return;
        pn.chartType = sel.value;
        renderPanels();
      };
    });
    $$('#klPanels [data-kpdel]').forEach((b) => {
      b.onclick = () => {
        state.panels = state.panels.filter((x) => x.id !== b.dataset.kpdel);
        renderPanels();
      };
    });
    $$('#klPanels [data-mth-info]').forEach((el) => {
      el.onclick = (e) => { e.stopPropagation(); algoModal(METHODS.find((m) => m.id === el.dataset.mthInfo)); };
    });
  }

  function close() {
    persist();   // 触发 kpi 页订阅重挂载（其内部会 dispose 图表），随后移除工作台
    const w = document.getElementById('kpiLabWrap');
    if (w) w.remove();
    const pw = document.getElementById('klPrintWrap');
    if (pw) pw.remove();
    UI.disposeCharts();
    state.charts = [];
    const r = location.hash.replace('#/', '') || 'macro';
    (Views[r] || Views.macro).mount($('#view'));
  }

  // ---------- 导出 PDF 报告 ----------
  function exportPdf() {
    if (!state.panels.length) { UI.toast('请先生成看板，再导出报告', 'err'); return; }
    const old = document.getElementById('klPrintWrap');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.id = 'klPrintWrap';
    wrap.style.display = 'none';
    const dateStr = U.today();
    const macroName = state.macroName || '未命名计划';
    const rangeStr = (state.from ? U.md(state.from) : '全部') + ' ~ ' + (state.to ? U.md(state.to) : '至今');
    let html = `<div style="font-family:inherit;padding:20px">
      <h1 style="margin:0 0 6px;font-size:22px;color:#000">自定义 KPI 分析报告</h1>
      <p style="margin:0 0 16px;color:#666;font-size:13px">训练计划：${U.esc(macroName)}　|　分析区间：${U.esc(rangeStr)}　|　生成日期：${U.esc(dateStr)}</p>`;
    state.panels.forEach((pn, idx) => {
      const m = METHODS.find((x) => x.id === pn.methodId);
      if (!m) return;
      const ctx = buildCtx(pn.aths, pn.metrics, pn.from, pn.to);
      let res;
      try { res = m.compute(ctx); } catch (e) { res = { empty: '计算出错：' + e.message, insight: '' }; }
      const chart = state.charts.find((c) => c && c.getDom && c.getDom() && c.getDom().id === 'klcv-' + pn.id);
      let img = '';
      if (chart) {
        try { img = `<img src="${chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' })}" style="max-width:100%;margin:10px 0"/>`; } catch (e) { img = ''; }
      }
      const insightText = (res.insight || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '');
      const algoText = (m.algo || '').trim();
      html += `<div class="print-panel" style="border:1px solid #ddd;border-radius:8px;padding:16px;margin-bottom:16px">
        <h2 style="margin:0 0 8px;font-size:16px;color:#000">${CN_NUM[idx] || (idx + 1)} ${U.esc(m.name)}</h2>
        <p style="margin:0 0 8px;color:#666;font-size:12px">图型：${U.esc(CTYPES[pn.chartType] ? CTYPES[pn.chartType].name : pn.chartType)}　|　范围：${pn.aths.length} 人 · ${pn.metrics.length} 项</p>
        ${img}
        <h3 style="margin:12px 0 6px;font-size:13px;color:#333">结果解读</h3>
        <p style="margin:0 0 10px;font-size:12px;line-height:1.8;color:#333;white-space:pre-wrap">${U.esc(insightText)}</p>
        <h3 style="margin:12px 0 6px;font-size:13px;color:#333">算法说明</h3>
        <pre style="margin:0 0 10px;font-size:11px;line-height:1.7;color:#555;background:#f5f5f5;padding:10px;border-radius:6px">${U.esc(algoText)}</pre>`;
      if (res.table && res.table.rows.length) {
        html += `<h3 style="margin:12px 0 6px;font-size:13px;color:#333">数据表</h3>${tblHTML(res.table)}`;
      }
      html += `</div>`;
    });
    html += `</div>`;
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    UI.toast('已生成打印视图，正在打开打印对话框…', 'ok');
    setTimeout(() => window.print(), 300);
  }

  // ---------- 生成详细文字报告 ----------
  function textReport() {
    if (!state.panels.length) { UI.toast('请先生成看板，再生成详细文字报告', 'err'); return; }
    const dateStr = U.today();
    const macroName = state.macroName || '未命名计划';
    const rangeStr = (state.from ? U.md(state.from) : '全部') + ' ~ ' + (state.to ? U.md(state.to) : '至今');
    const athNames = state.aths.map((id) => { const a = P.planAths().find((x) => x.id === id); return a ? a.name : id; }).join('、');
    const metNames = state.metrics.map((k) => { const m = P.allMetrics().find((x) => x.key === k); return m ? m.label : k; }).join('、');
    let body = `<div style="max-height:60vh;overflow:auto;padding:4px 8px 4px 0;font-size:13px;line-height:1.9;color:var(--color-ink)">
      <div style="margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid color-mix(in oklch, var(--color-ink-muted) 20%, transparent)">
        <b style="font-size:15px">自定义 KPI 分析 · 详细文字报告</b><br/>
        <span class="hint" style="font-size:11px">计划：${U.esc(macroName)}　|　区间：${U.esc(rangeStr)}　|　日期：${U.esc(dateStr)}</span><br/>
        <span class="hint" style="font-size:11px">运动员：${U.esc(athNames)}</span><br/>
        <span class="hint" style="font-size:11px">测试项目：${U.esc(metNames)}</span>
      </div>`;
    state.panels.forEach((pn, idx) => {
      const m = METHODS.find((x) => x.id === pn.methodId);
      if (!m) return;
      const ctx = buildCtx(pn.aths, pn.metrics, pn.from, pn.to);
      let res;
      try { res = m.compute(ctx); } catch (e) { res = { empty: '计算出错：' + e.message, insight: '' }; }
      const insightText = (res.insight || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '');
      body += `<div style="margin-bottom:14px">
        <b style="font-size:14px;color:var(--color-info)">${CN_NUM[idx] || (idx + 1)} ${U.esc(m.name)}</b>
        <span class="hint" style="font-size:10px;margin-left:8px">${U.esc(CTYPES[pn.chartType] ? CTYPES[pn.chartType].name : pn.chartType)}</span>
        <div style="margin:6px 0;padding:8px 10px;background:color-mix(in oklch, var(--color-info) 8%, transparent);border-radius:6px;font-size:12px;line-height:1.8;white-space:pre-wrap">${U.esc(insightText)}</div>`;
      if (res.table && res.table.rows.length) {
        body += `<div style="margin:6px 0;font-size:11px;color:var(--color-ink-muted)">数据表：</div><div class="kl-tbl">${tblHTML(res.table)}</div>`;
      }
      body += `<details style="margin-top:6px"><summary style="cursor:pointer;color:var(--color-ink-muted);font-size:11px">算法说明</summary><pre style="white-space:pre-wrap;font-family:inherit;font-size:11px;color:var(--color-ink-muted);line-height:1.8;margin:6px 0 0;background:color-mix(in oklch, var(--color-ink-muted) 7%, transparent);padding:8px 10px;border-radius:6px">${U.esc(m.algo || '')}</pre></details>
      </div>`;
    });
    body += `</div>`;
    UI.modal({
      title: '详细文字报告',
      wide: true,
      body,
      footer: `<button class="btn primary" data-x>关闭</button>`
    });
  }

  // ---------- 入口 ----------
  function open() {
    if (document.getElementById('kpiLabWrap')) return;
    const aths = P.planAths();
    if (!aths.length) { UI.toast('当前训练计划暂无运动员，请先在「运动员档案」添加', 'err'); return; }
    const metrics = P.allMetrics();
    if (!metrics.length) { UI.toast('暂无可用测试项目，请先录入体能数据', 'err'); return; }
    // 恢复上次看板
    const saved = (Store.data.settings || {}).kpiLabPanels || [];
    state.panels = saved.filter((p) => p && p.id && METHODS.some((m) => m.id === p.methodId));
    state.aths = aths.map((a) => a.id);
    const defM = metrics.filter((m) => ['sq', 'bp', 'dl'].includes(m.key)).map((m) => m.key);
    state.metrics = defM.length ? defM : [metrics[0].key];
    state.methods = [];
    // 可选日期边界 = 计划周期 ∪ 全部测试数据日期（入队测试常在计划开始前进行，不能排除；但也不能选到无意义的远古日期）
    const macro = Store.activeMacro();
    const dates = [];
    const d0 = Store.data;
    Object.values(d0.athleteRm || {}).forEach((per) => Object.values(per || {}).forEach((rec) => {
      (rec.history || []).forEach((h) => h.date && dates.push(h.date));
      if (rec.date) dates.push(rec.date);
    }));
    (d0.tests || []).forEach((t) => t.date && dates.push(t.date));
    (d0.profiles || []).forEach((p) => p.date && dates.push(p.date));
    const dataMin = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : '';
    const dataMax = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : '';
    const macroStart = macro ? macro.startDate : '';
    const macroEnd = macro ? macro.endDate : '';
    const boundFrom = [macroStart, dataMin].filter(Boolean).sort()[0] || '';
    const boundTo = [macroEnd, dataMax].filter(Boolean).sort().pop() || '';
    state.macroFrom = boundFrom; state.macroTo = boundTo;
    state.macroName = macro ? macro.name : '';
    state.dataMax = dataMax;
    state.from = boundFrom; state.to = boundTo;
    state.charts = [];

    const wrap = document.createElement('div');
    wrap.id = 'kpiLabWrap';
    wrap.innerHTML = `
      <style>
        #kpiLabWrap{position:fixed;inset:0;z-index:80;background:color-mix(in oklch, var(--color-background) 92%, transparent);overflow:auto;padding:14px}
        #kpiLabWrap .kl-top{display:flex;gap:12px;align-items:center;margin-bottom:10px}
        #kpiLabWrap .spacer{flex:1}
        #kpiLabWrap .kl-body{display:flex;flex-direction:column;gap:10px;max-width:1280px;margin:0 auto}
        #kpiLabWrap .kl-frow{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px dashed var(--line)}
        #kpiLabWrap .kl-frow:last-of-type{border-bottom:none}
        #kpiLabWrap .kl-lab{min-width:64px;color:var(--color-ink-muted);font-size:12px;padding-top:3px;flex-shrink:0}
        #kpiLabWrap .kl-chips{display:flex;flex-wrap:wrap;gap:6px;flex:1}
        #kpiLabWrap .kl-chips.scr{max-height:150px;overflow:auto}
        #kpiLabWrap .kl-mg{display:flex;flex-wrap:wrap;gap:6px;align-items:center;width:100%}
        #kpiLabWrap .kl-mg + .kl-mg{margin-top:6px}
        #kpiLabWrap .kl-mgl{font-size:10px;color:var(--color-ink-subtle);min-width:52px;flex-shrink:0}
        #kpiLabWrap .chip{cursor:pointer;border:1px solid var(--line);border-radius:12px;padding:2px 10px;font-size:11px;color:var(--color-ink-muted);display:inline-flex;align-items:center;user-select:none}
        #kpiLabWrap .chip:hover{border-color:var(--color-info);color:var(--color-ink)}
        #kpiLabWrap .chip.on{background:color-mix(in oklch, var(--color-info) 20%, transparent);border-color:var(--color-info);color:var(--color-ink)}
        #kpiLabWrap .kl-info{font-style:normal;font-size:10px;background:color-mix(in oklch, var(--color-info) 18%, transparent);border-radius:50%;width:15px;height:15px;display:inline-flex;align-items:center;justify-content:center;margin-left:5px;color:var(--color-info)}
        #kpiLabWrap .kl-info:hover{background:color-mix(in oklch, var(--color-info) 45%, transparent)}
        .kl-cts{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;padding:4px 2px}
        .kl-ct{border:1px solid var(--line);border-radius:8px;padding:12px 10px 9px;display:flex;flex-direction:column;gap:3px;cursor:pointer;position:relative}
        .kl-ct:hover{border-color:var(--color-info);background:color-mix(in oklch, var(--color-info) 8%, transparent)}
        .kl-ct.sel{border-color:var(--color-info);background:color-mix(in oklch, var(--color-info) 14%, transparent);box-shadow:0 0 0 1px var(--color-info) inset}
        .kl-ct.rec{border-color:color-mix(in oklch, var(--color-success) 70%, transparent)}
        .kl-ct.rec.sel{border-color:var(--color-info)}
        .kl-ct b{font-size:13px;color:var(--color-ink)}
        .kl-ct span{font-size:10px;color:var(--color-ink-muted);line-height:1.5}
        .kl-rec{position:absolute;top:-9px;right:6px;background:var(--color-success);color:var(--color-accent-ink);font-size:9px;padding:1px 7px;border-radius:8px;font-weight:700}
        #kpiLabWrap .kl-panel{margin-bottom:12px}
        #kpiLabWrap .kl-phead{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        #kpiLabWrap .kl-phead b{font-size:14px}
        #kpiLabWrap .kl-qalgo{cursor:pointer;font-size:10px;color:var(--color-info);border:1px solid color-mix(in oklch, var(--color-info) 40%, transparent);border-radius:10px;padding:1px 8px}
        #kpiLabWrap .kl-qalgo:hover{background:color-mix(in oklch, var(--color-info) 15%, transparent)}
        #kpiLabWrap .kl-sum{font-size:10px}
        #kpiLabWrap .kl-canvas{height:340px;margin-top:10px}
        #kpiLabWrap .kl-insight{background:color-mix(in oklch, var(--color-info) 6%, transparent);border:1px solid color-mix(in oklch, var(--color-info) 16%, transparent);border-radius:8px;padding:10px 14px;font-size:12px;line-height:1.9;margin-top:10px}
        #kpiLabWrap .kl-insight>div{color:var(--color-ink);margin-top:4px}
        #kpiLabWrap .kl-up{color:var(--color-success);font-weight:700}
        #kpiLabWrap .kl-dn{color:var(--color-danger);font-weight:700}
        #kpiLabWrap details{margin-top:8px}
        #kpiLabWrap summary{cursor:pointer;color:var(--color-ink-muted);font-size:11px}
        #kpiLabWrap .kl-algo pre{white-space:pre-wrap;font-family:inherit;color:var(--color-ink-muted);line-height:1.9;margin:8px 0 0;background:color-mix(in oklch, var(--color-ink-muted) 7%, transparent);padding:10px 12px;border-radius:8px}
        #kpiLabWrap .kl-tbl table{width:100%;border-collapse:collapse;margin-top:8px}
        #kpiLabWrap .kl-tbl th,#kpiLabWrap .kl-tbl td{border:1px solid var(--line);padding:5px 8px;font-size:11px;color:var(--color-ink);text-align:left}
        #kpiLabWrap .kl-tbl th{color:var(--color-ink-muted);font-weight:600;background:color-mix(in oklch, var(--color-ink-muted) 6%, transparent)}
        #kpiLabWrap .kl-nodata{height:100%;display:flex;align-items:center;justify-content:center;color:var(--color-ink-subtle);font-size:12px}
        #kpiLabWrap .kl-empty{color:var(--color-ink-muted);font-size:12px;text-align:center;padding:26px;line-height:2}
        .kl-meaning{background:linear-gradient(135deg,color-mix(in oklch, var(--color-success) 10%, transparent),color-mix(in oklch, var(--color-info) 8%, transparent));border:1px solid color-mix(in oklch, var(--color-success) 28%, transparent);border-radius:10px;padding:12px 14px;margin:0 0 12px}
        .kl-meaning p{margin:6px 0 0;line-height:1.9;color:var(--color-ink);font-size:12.5px}
        .kl-meaning-t{font-size:12px;font-weight:700;color:var(--color-success);letter-spacing:.5px;margin:0 0 2px}
        .modal-body .kl-meaning-t:not(:first-child){margin-top:12px;color:var(--color-ink-muted)}
        @media print {
          body > *:not(#klPrintWrap) { display: none !important; }
          #klPrintWrap { display: block !important; position: static !important; z-index: 99999 !important; background: white !important; color: black !important; }
          #klPrintWrap .print-panel { page-break-inside: avoid; margin-bottom: 20px; }
          #klPrintWrap img { max-width: 100%; }
          #klPrintWrap table { width: 100%; border-collapse: collapse; }
          #klPrintWrap th, #klPrintWrap td { border: 1px solid #ccc; padding: 6px; }
          #klPrintWrap pre { white-space: pre-wrap; font-family: inherit; }
        }
      </style>
      <div class="kl-top">
        <button class="btn ghost sm" id="klClose">‹ 返回</button>
        <div>
          <b style="font-size:15px">自定义 KPI 分析</b>
          <div class="hint" style="font-size:11px">开放式体能数据分析 · 选筛选 → 多选方法 → 生成看板，每个方法一个看板，可继续追加</div>
        </div>
        <button class="btn ghost sm" id="klPdf" type="button">导出报告</button>
        <button class="btn ghost sm" id="klTxt" type="button">生成详细文字报告</button>
        <span class="spacer"></span>
        <span class="hint" style="font-size:11px">分析方法 ${METHODS.length} 种 · 图型 ${Object.keys(CTYPES).length} 种 · 每种方法附算法说明</span>
      </div>
      <div class="kl-body">
        <div class="card">
          <div class="kl-frow"><span class="kl-lab">姓名</span><div class="kl-chips" id="klAths"></div>
            <button class="btn sm ghost" id="klAthAll" type="button">全选</button><button class="btn sm ghost" id="klAthNone" type="button">清空</button></div>
          <div class="kl-frow"><span class="kl-lab">测试项目</span><div class="kl-chips scr" id="klMetrics"></div></div>
          <div class="kl-frow"><span class="kl-lab">日期范围</span>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <input type="date" class="ipt" id="klFrom" style="width:150px" min="${boundFrom}" max="${boundTo}">
              <span class="hint">—</span>
              <input type="date" class="ipt" id="klTo" style="width:150px" min="${boundFrom}" max="${boundTo}">
              <span id="klQuick" style="display:flex;gap:6px">
                <button class="btn sm ghost" data-q="all" type="button">全部</button>
                <button class="btn sm ghost" data-q="d90" type="button">近 90 天</button>
                <button class="btn sm ghost" data-q="d28" type="button">近 28 天</button>
                <button class="btn sm ghost" data-q="d7" type="button">近 7 天</button>
              </span>
              <span class="hint" style="font-size:10px">${boundFrom && boundTo ? `可选范围 ${U.md(boundFrom)} ~ ${U.md(boundTo)}（计划周期及测试数据日期内）` : '留空 = 不限'}</span>
            </div></div>
          <div class="kl-frow"><span class="kl-lab">分析方法</span><div class="kl-chips scr" id="klMethods"></div></div>
          <div class="row" style="justify-content:flex-end;padding-top:10px;gap:8px">
            <span class="hint" style="font-size:11px;margin-right:auto">点方法名选中，点 ⓘ 查看算法说明；已生成过的方法再次生成会按当前筛选更新看板，不重复弹图型选择</span>
            <button class="btn primary" id="klGen">生成看板（0）</button>
          </div>
        </div>
        <div id="klPanels"></div>
      </div>`;
    document.body.appendChild(wrap);

    $('#klClose').onclick = close;
    $('#klGen').onclick = generate;
    $('#klPdf').onclick = exportPdf;
    $('#klTxt').onclick = textReport;
    renderFilters();
    renderPanels();
  }

  return { open };
})();
