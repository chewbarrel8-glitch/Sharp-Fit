// 内置示例：XX篮球队备战计划（10 个月 / 2 个大周期 / 15 人 / 每天 1-3 节不同类型训练课 / 5 次×10 项体能测试）
// 通过侧边栏「载入示例」载入；纯浏览器脚本，依赖全局 Store / U / Calc（与各视图脚本同源加载）
// 载入策略：合并而非覆盖——用户已创建的计划/运动员/动作等数据全部保留，示例作为一套新增计划并存；
// 「退出示例」时仅精确移除示例创建的数据，并切回用户载入前正在查看的计划。

// 示例队员名单（[姓名, 生日, 标准位置, 备注]）：seedDemo 造数与旧库位置补全迁移共用同一数据源
// 位置取篮球标准枚举（控球后卫/得分后卫/小前锋/大前锋/中锋，每位置 3 人）
const SEED_ROSTER = [
  ['陈浩', '1998-03-12', '小前锋', '明星锋线 · 队长'],
  ['刘致远', '2002-07-02', '控球后卫', '伤后复出'],
  ['王俊杰', '1999-11-20', '中锋', ''],
  ['李明轩', '2000-01-15', '大前锋', ''],
  ['张天翼', '2001-05-08', '得分后卫', ''],
  ['赵子涵', '1997-09-23', '小前锋', ''],
  ['孙宇翔', '2000-12-03', '控球后卫', '组织后卫'],
  ['周凯', '1999-04-19', '中锋', ''],
  ['吴承宇', '2001-08-27', '大前锋', ''],
  ['郑浩然', '2000-02-14', '得分后卫', ''],
  ['冯启铭', '1998-06-30', '小前锋', ''],
  ['江沐宸', '2002-10-11', '控球后卫', ''],
  ['韩旭', '1999-01-25', '中锋', ''],
  ['杨帆', '2001-03-09', '得分后卫', '锋卫摇摆人'],
  ['高翔', '2000-09-17', '大前锋', '']
];
// 姓名 → 标准位置映射：供 Store 旧库迁移时为早期 seed（未写 position）的示例队员补位置
window.SEED_DEMO_POS = Object.fromEntries(SEED_ROSTER.map(([name, , position]) => [name, position]));

window.seedDemo = function seedDemo() {
  // 已载入过示例则不重复载入
  if (Store.data && Store.data.settings && Store.data.settings.demo) return false;

  const d = Store.data;
  // 确保内置库存在（正常初始化后必然存在，此处仅防御异常库）
  if (!d.categories1 || !d.categories1.length) d.categories1 = Store.seedCategories();
  if (!d.exercises || !d.exercises.length) d.exercises = Store.seedExercises();
  if (!d.goals || !d.goals.length) d.goals = Store.defaultGoals();
  const prevActiveMacroId = d.settings.activeMacroId || null;

  // 固定种子伪随机：保证每次载入的示例数据一致
  let rngSeed = 20261006;
  const rnd = () => {
    rngSeed |= 0; rngSeed = (rngSeed + 0x6D2B79F5) | 0;
    let t = Math.imul(rngSeed ^ (rngSeed >>> 15), 1 | rngSeed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r1 = (x) => Math.round(x * 10) / 10;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------- 篮球专项自定义动作（挂到动作库自定义分类） ----------
  // 同名分类/动作不重复创建（防御重复载入）；仅记录本次新建项，退出示例时才移除
  const demoCreatedExIds = [];
  let c1bb = d.categories1.find((c) => c.name === '篮球专项');
  let catCreated = false;
  if (!c1bb) {
    c1bb = { id: U.uid('c1'), name: '篮球专项', children: [
      { id: U.uid('c2'), name: '进攻技术' }, { id: U.uid('c2'), name: '防守与战术' }
    ] };
    d.categories1.push(c1bb);
    catCreated = true;
  }
  const mkBbEx = (name, c2, metric) => {
    let ex = d.exercises.find((x) => x.cat1 === '篮球专项' && x.name === name);
    if (!ex) {
      ex = { id: U.uid('ex'), cat1: '篮球专项', cat2: c2, name, equip: '自重', metric, loadType: 'bodyweight', notes: '' };
      d.exercises.push(ex);
      demoCreatedExIds.push(ex.id);
    }
    return ex;
  };
  const exShoot = mkBbEx('定点投篮', '进攻技术', 'reps');
  const exDribble = mkBbEx('运球突破练习', '进攻技术', 'duration');
  const exTactic = mkBbEx('战术配合演练', '防守与战术', 'duration');
  const exSlide = mkBbEx('防守滑步训练', '防守与战术', 'duration');

  const pick = (n) => d.exercises.find((x) => x.name === n);
  const gid = (name) => { const g = d.goals.find((x) => x.name === name); return g ? g.id : null; };
  const gids = (names) => names.map(gid).filter(Boolean);

  // ---------- 大周期：XX篮球队备战计划（作为新增计划并入，不影响用户已有计划） ----------
  const macroId = U.uid('mac');
  const macRef = {
    id: macroId, name: 'XX篮球队备战计划', sportCat: '球类 · 大球', sport: '篮球',
    model: 'block', startDate: '2026-01-05', endDate: '2026-11-01',
    cycles: [
      { id: 'cy1', name: '第一大周期 · 准备与常规赛季（1-8月）', startDate: '2026-01-05', endDate: '2026-08-09' },
      { id: 'cy2', name: '第二大周期 · 季后赛冲刺（8-11月）', startDate: '2026-08-10', endDate: '2026-10-18' }
    ],
    compDates: [
      { date: '2026-04-18', name: '季前热身赛', place: '本市 · 市体育馆' },
      { date: '2026-06-20', name: '夏季联赛第1轮', place: '杭州 · 奥体中心' },
      { date: '2026-07-25', name: '夏季联赛关键战', place: '南京 · 青奥体育馆' },
      { date: '2026-08-08', name: '夏季联赛收官战', place: '本市 · 市体育馆' },
      { date: '2026-10-17', name: '新赛季常规赛揭幕战', place: '本市 · 市体育馆' },
      { date: '2026-10-31', name: '常规赛第3轮', place: '广州 · 天河体育馆' }
    ],
    testDates: [
      { date: '2026-01-10', name: '基线测试' },
      { date: '2026-03-14', name: '最大力量期测试' },
      { date: '2026-05-16', name: '功率转化期测试' },
      { date: '2026-07-18', name: '比赛期测试' },
      { date: '2026-09-19', name: '第二峰值期测试' }
    ]
  };
  d.macros.push(macRef);
  d.settings.activeMacroId = macroId;

  // ---------- 周期总表：43 周波浪式负荷（3 周加载 + 1 周减量） ----------
  const weekPlan = {};
  // 各中周期所占周序：M1 0-7 / M2 8-15 / M3 16-22 / M4 23-30 / M5 31-36 / M6 37-42
  const phaseOfWeek = (w) => (w <= 7 ? 0 : w <= 15 ? 1 : w <= 22 ? 2 : w <= 30 ? 3 : w <= 36 ? 4 : 5);
  // [加载周 ×3（量/强度/准备水平），减量周]
  const phaseWP = [
    [[7, 4, 5], [8, 5, 6], [8, 5, 6], [5, 3, 4]],          // M1 一般准备·积累
    [[8, 6, 6], [9, 7, 7], [9, 7, 7], [5, 5, 5]],          // M2 最大力量
    [[8, 7, 7], [8, 8, 8], [7, 8, 8], [5, 5, 6]],          // M3 转化功率
    [[7, 8, 8], [6, 9, 8], [5, 9, 9], [4, 6, 6]],          // M4 比赛期·峰值（量递减）
    [[8, 7, 7], [9, 7, 8], [8, 8, 8], [5, 5, 6]],          // M5 第二准备·最大力量
    [[7, 8, 8], [6, 9, 9], [5, 9, 9], [4, 6, 7]]           // M6 季后赛冲刺·峰值
  ];
  let ws0 = '2026-01-05';
  for (let w = 0; w < 43; w++) {
    const ws = U.addDays(ws0, w * 7);
    const [v, i, st] = phaseWP[phaseOfWeek(w)][w % 4];
    weekPlan[ws] = { volume: v, intensity: i, status: st };
  }

  // ---------- 中周期（6 个，分属 2 个大周期） ----------
  const mesoDefs = [
    ['M1 · 一般准备·积累', '积累', '2026-01-05', '2026-03-01', [['肌肥大'], ['有氧耐力（LSD）']]],
    ['M2 · 最大力量', '最大力量', '2026-03-02', '2026-04-26', [['最大力量'], ['加速能力', '核心稳定（抗伸展）']]],
    ['M3 · 转化功率', '转化功率', '2026-04-27', '2026-06-14', [['爆发力'], ['重复冲刺（RSA）']]],
    ['M4 · 比赛期·峰值', '峰值', '2026-06-15', '2026-08-09', [['反应力量'], ['比赛节奏与决策']]],
    ['M5 · 第二准备·最大力量', '最大力量', '2026-08-10', '2026-09-20', [['最大力量'], ['变向能力（COD）']]],
    ['M6 · 季后赛冲刺·峰值', '峰值', '2026-09-21', '2026-11-01', [['爆发力'], ['专项技术']]]
  ];
  const mesoIds = [];
  const mesoRefs = [];
  for (const [name, type, s, e] of mesoDefs) {
    const id = U.uid('mes');
    mesoIds.push(id);
    const m = { id, macroId, name, type, startDate: s, endDate: e, goals: { primary: [], secondary: [] }, days: [] };
    mesoRefs.push(m);
    d.mesos.push(m);
  }
  mesoRefs.forEach((m, i) => {
    m.goals = { primary: gids(mesoDefs[i][4][0]), secondary: gids(mesoDefs[i][4][1]) };
  });
  // 总表目标块（每个中周期一块，主/次目标恰好落在两个训练模块分类上）
  macRef.goalBlocks = mesoDefs.map(([, , s, e, goals], i) => ({
    id: 'gbdemo' + (i + 1), start: s, end: e,
    primary: gids(goals[0]), secondary: gids(goals[1])
  }));
  Object.assign(macRef, { weekPlan, teamName: 'XX篮球队' });

  // ---------- 动作行构造 ----------
  const REF_RM = { '颈后深蹲': 110, '传统硬拉': 150, '平板卧推': 85, '高翻': 80, '六角杠硬拉': 130, '借力推': 70, '保加利亚分腿蹲': 55, '罗马尼亚硬拉': 100 };
  const exRef = (n) => (typeof n === 'string' ? pick(n) : n);
  const rRow = (name, pct, sets, reps) => {
    const ex = exRef(name);
    const rm = REF_RM[name];
    return { exId: ex.id, pct, weight: rm && pct ? Calc.weightFromPct(rm, pct) : null, sets, reps, dist: null, dur: null, actual: null };
  };
  const mRow = (name, sets, dist) => ({ exId: exRef(name).id, pct: null, weight: null, sets, reps: null, dist, dur: null, unit: 'm', actual: null });
  const tRow = (name, sets, dur) => ({ exId: exRef(name).id, pct: null, weight: null, sets, reps: null, dist: null, dur, unit: 's', actual: null });
  const bwRow = (name, sets, reps) => ({ exId: exRef(name).id, unit: 'bw', pct: null, weight: null, sets, reps, dist: null, dur: null, actual: null });

  const strengthRows = (type, wk) => {
    if (type === '最大力量') {
      const v = Math.min(88, 78 + wk * 2);
      return [rRow('颈后深蹲', v, 5, 3), rRow('传统硬拉', v - 8, 4, 3), rRow('平板卧推', v - 5, 4, 4), rRow('高翻', 75, 5, 2)];
    }
    if (type === '转化功率') {
      return [rRow('六角杠硬拉', 70, 4, 3), bwRow(pick('跳深'), 6, 3), rRow('高翻', 80, 6, 2), bwRow(pick('胸前推掷药球'), 4, 6)];
    }
    if (type === '峰值') {
      return [rRow('颈后深蹲', 90, 3, 2), rRow('借力推', 80, 4, 2), bwRow(pick('跳深'), 4, 3)];
    }
    return [rRow('保加利亚分腿蹲', 65, 3, 8), rRow('罗马尼亚硬拉', 65, 3, 8), rRow('平板卧推', 60, 4, 10), bwRow(pick('帕洛夫推举'), 3, 12)];
  };
  const techRows = () => [bwRow(exShoot, 4, 20), tRow(exDribble, 2, 600)];
  const tacticRows = () => [tRow(exTactic, 1, 1800), tRow(exSlide, 3, 300)];
  const recRows = () => [tRow('泡沫轴放松', 1, 900), tRow('静态拉伸', 1, 600)];
  const speedRows = () => [mRow('20m冲刺', 8, 20), mRow('重复冲刺RSA（6×30m）', 6, 30)];
  const agilityRows = () => [mRow('505变向测试', 4, 20), tRow(exSlide, 4, 120)];
  const condRows = (type) => {
    if (type === '积累') return [mRow('3000m跑', 1, 3000), tRow('风阻单车冲刺', 6, 60)];
    if (type === '最大力量') return [mRow('400米间歇跑', 6, 400)];
    if (type === '转化功率') return [tRow('风阻单车冲刺', 8, 30), mRow('重复冲刺RSA（6×30m）', 4, 30)];
    return [mRow('20m折返跑（Beep）', 1, 1200), tRow('风阻单车冲刺', 6, 45)];
  };
  const testRows = () => [mRow('20m冲刺', 3, 20), mRow('505变向测试', 2, 20), bwRow(pick('引体向上'), 1, 6)];

  // 课表模板：周日休息；测试日/比赛日特殊安排；每天 1-3 节不同课型
  const DUR = { '力量': 90, '技术': 90, '战术': 75, '综合体能': 60, '速度': 50, '敏捷': 50, '恢复再生': 40, '测试': 120, '比赛': 100 };
  const courseOf = (name, type, time, rows) => ({ id: U.uid('mcs'), name, type, time, rows });
  const coursesForDate = (date, meso, wk) => {
    const wd = U.d(date).getDay();
    if (wd === 0) return [];
    if ((macRef.testDates || []).some((t) => t.date === date)) {
      return [courseOf('综合体能测试（10项）', '测试', '09:00', testRows()), courseOf('测试后放松恢复', '恢复再生', '16:30', recRows())];
    }
    if ((macRef.compDates || []).some((c) => c.date === date)) {
      return [courseOf('赛前投篮训练', '技术', '10:00', techRows()), courseOf('正式比赛', '比赛', '19:30', [])];
    }
    const t = meso.type;
    switch (wd) {
      case 1: return [courseOf('力量训练课', '力量', '09:00', strengthRows(t, wk)), courseOf('技术训练课', '技术', '15:30', techRows())];
      case 2: return [courseOf('体能训练课', '综合体能', '09:00', condRows(t)),
        courseOf(wk % 2 ? '速度训练课' : '敏捷训练课', wk % 2 ? '速度' : '敏捷', '15:30', wk % 2 ? speedRows() : agilityRows()),
        courseOf('恢复再生课', '恢复再生', '19:30', recRows())];
      case 3: return [courseOf('技术训练课', '技术', '09:00', techRows()), courseOf('战术合练课', '战术', '15:30', tacticRows())];
      case 4: return [courseOf('力量训练课', '力量', '09:00', strengthRows(t, wk)), courseOf('恢复再生课', '恢复再生', '19:30', recRows())];
      case 5: return [courseOf('速度训练课', '速度', '09:00', speedRows()), courseOf('战术合练课', '战术', '15:30', tacticRows())];
      default: return [courseOf('力量训练课（减量）', '力量', '09:00', strengthRows(t, wk))];
    }
  };

  // 全计划逐日课程（10 个月，仅遍历示例自己的中周期）
  for (const meso of mesoRefs) {
    let cur = meso.startDate, wk = 0;
    while (cur <= meso.endDate) {
      if (U.d(cur).getDay() === 1) wk++;
      const courses = coursesForDate(cur, meso, wk);
      if (courses.length) meso.days.push({ date: cur, note: '', courses });
      cur = U.addDays(cur, 1);
    }
  }

  // ---------- 小周期：逐周划分，日类型/强度驱动周节奏 ----------
  const microGoals = mesoDefs.map(([, , , , goals]) => ({ primary: gids(goals[0]), secondary: gids(goals[1]) }));
  const dayTypeByWd = ['休息', '力量', '综合体能', '技术', '力量', '速度', '力量'];
  const dayIntByWd = [15, 80, 74, 55, 78, 82, 70];
  mesoRefs.forEach((meso, mi) => {
    let cur = meso.startDate, wk = 0;
    while (cur <= meso.endDate) {
      const e = U.addDays(cur, 6);
      d.micros.push({
        id: U.uid('mic'), mesoId: meso.id, name: `${meso.name.split(' · ')[0]} 第${wk + 1}周`,
        startDate: cur, endDate: e > meso.endDate ? meso.endDate : e, targetLoad: null, goals: microGoals[mi],
        days: dayTypeByWd.map((type, j) => ({
          date: U.addDays(cur, j), type, intensity: clamp(dayIntByWd[j] + (wk % 4 === 3 ? -18 : (wk > 2 ? 6 : 0)), 5, 100), note: ''
        }))
      });
      wk++;
      cur = U.addDays(cur, 7);
    }
  });

  // ---------- 15 名运动员（名单见顶层 SEED_ROSTER） ----------
  const roster = SEED_ROSTER;
  const aths = roster.map(([name, birth, position, note]) => ({ id: U.uid('ath'), macroId, name, sport: '篮球', gender: '男', birth, position, note }));
  d.athletes.push(...aths);
  macRef.athletes = aths.map((a) => a.id);

  // ---------- 1RM 测试（多负荷测试，构建 RIR-负荷曲线） ----------
  const sq = pick('颈后深蹲'), bp = pick('平板卧推'), dl = pick('传统硬拉');
  const mkTest = (aid, ex, w, r, ri, date, note) => {
    const est = Calc.estimate1RM(w, r, ri);
    d.tests.push({ id: U.uid('tst'), athleteId: aid, exerciseId: ex.id, weight: w, reps: r, rir: ri, estimated1RM: est, date, source: 'test', note });
    Store.updateAthRm(aid, ex.id, est, date, '多负荷测试', 'test');
  };
  // 陈浩（明星）：最大力量期多负荷测试
  mkTest(aths[0].id, sq, 90, 8, 3, '2026-03-14', '90kg 热身组');
  mkTest(aths[0].id, sq, 110, 5, 1, '2026-03-14', '110kg 中等负荷');
  mkTest(aths[0].id, sq, 125, 3, 1, '2026-03-14', '125kg 大负荷');
  mkTest(aths[0].id, sq, 135, 2, 0, '2026-03-14', '135kg 力竭');
  mkTest(aths[0].id, bp, 60, 8, 2, '2026-03-14', '60kg 热身');
  mkTest(aths[0].id, bp, 75, 4, 1, '2026-03-14', '75kg 大负荷');
  mkTest(aths[0].id, dl, 120, 5, 1, '2026-03-14', '120kg 中等');
  mkTest(aths[0].id, dl, 140, 3, 0, '2026-03-14', '140kg 大负荷');
  // 刘致远（伤后复出）：单次测试 95×3×RIR0 → e1RM 105
  mkTest(aths[1].id, sq, 95, 3, 0, '2026-03-14', '伤后首次最大力量测试');

  // ---------- 5 次体能测试 × 10 项 + FMS（15 人） ----------
  const testDates = ['2026-01-10', '2026-03-14', '2026-05-16', '2026-07-18', '2026-09-19'];
  const testNotes = ['基线测试', '第2次 · 最大力量期', '第3次 · 功率转化期', '第4次 · 比赛期', '第5次 · 第二峰值期'];
  const fmsSets = [
    [2, 3, 2, 3, 2, 2, 3], [3, 3, 2, 3, 2, 2, 3], [2, 2, 2, 3, 2, 2, 3], [2, 2, 2, 2, 2, 2, 3],
    [3, 3, 3, 3, 2, 2, 3], [2, 2, 3, 3, 3, 2, 3], [3, 2, 2, 3, 2, 3, 3], [2, 3, 2, 2, 2, 2, 3],
    [2, 2, 2, 2, 3, 2, 3], [3, 3, 2, 2, 2, 3, 3], [2, 2, 3, 3, 2, 2, 3], [3, 2, 3, 3, 3, 2, 3],
    [3, 3, 2, 3, 3, 3, 3], [2, 3, 2, 2, 2, 2, 3], [2, 2, 2, 2, 3, 2, 2]
  ];
  aths.forEach((a, ai) => {
    // 位置差异的基线（身高/体重/各项能力）
    const height = r1(183 + rnd() * 17);
    const weight0 = r1(clamp(height - 105 + (rnd() - 0.4) * 9, 74, 106));
    const vj0 = r1(52 + rnd() * 18);                 // 纵跳 cm
    const cmj0 = r1(vj0 - 12 - rnd() * 4);
    const bj0 = r1(220 + rnd() * 45);                // 立定跳远 cm
    const sp0 = r1(2.92 + rnd() * 0.38);             // 20m 冲刺 s（越小越好）
    const la0 = r1(9.6 + rnd() * 1.1);               // Lane 敏捷 s
    const rt0 = Math.round(420 + rnd() * 130);       // 反应时 ms
    const pu0 = Math.round(4 + rnd() * 9);           // 引体向上
    const imtp0 = Math.round(2200 + rnd() * 1200);   // IMTP 峰值 N
    const bf0 = r1(11 + rnd() * 8);                  // 体脂率 %
    const star = ai === 0;
    const liuzqy = ai === 1;

    testDates.forEach((date, ti) => {
      const t = ti / (testDates.length - 1);
      // 刘致远第 2 次测试处于康复期，部分指标短暂回落
      const dip = liuzqy && ti === 1 ? 0.55 : 1;
      const gain = (good) => (liuzqy ? (ti === 1 ? 0.25 : 0.55 + 0.45 * Math.min(1, t * 1.25)) : (star ? 1.15 : 1)) * (good ? 1 : 1);
      const prof = {
        id: U.uid('pf'), athleteId: a.id, date, height,
        weight: r1(weight0 + (star ? 1.2 : 0) * t + (rnd() - 0.5) * 0.8),
        bodyFat: r1(clamp(bf0 - (star ? 3.2 : 2.0) * t * dip + (rnd() - 0.5) * 0.4, 7, 20)),
        verticalJump: r1(vj0 + (star ? 9 : 6) * t * dip + (rnd() - 0.5) * 0.8),
        cmjHeight: r1(cmj0 + (star ? 8 : 5.5) * t * dip + (rnd() - 0.5) * 0.8),
        broadJump: r1(bj0 + (star ? 22 : 14) * t * dip + (rnd() - 0.5) * 2),
        sprint20m: r1(clamp(sp0 - (star ? 0.16 : 0.11) * t * dip + (rnd() - 0.5) * 0.02, 2.6, 3.5)),
        laneAgility: r1(clamp(la0 - (star ? 0.55 : 0.38) * t * dip + (rnd() - 0.5) * 0.03, 8.6, 11)),
        imtpPeak: Math.round(imtp0 + (star ? 700 : 480) * t * dip + (rnd() - 0.5) * 60),
        pullUpReps: Math.round(clamp(pu0 + (star ? 5 : 3) * t * dip + (rnd() - 0.5), 1, 22)),
        reactionTime: Math.round(clamp(rt0 - (star ? 55 : 38) * t * dip + (rnd() - 0.5) * 8, 350, 600)),
        note: testNotes[ti]
      };
      if (liuzqy && ti === 0) { prof.ybtLeft = 90; prof.ybtRight = 83; prof.asymm = 7.8; }
      if (liuzqy && ti >= 3) { prof.ybtLeft = 92; prof.ybtRight = 90; prof.asymm = 2.2; }
      // FMS：基线 + 最新两次测试均记录；刘致远基线 12 分（跨栏步/俯卧撑 1 分 + 肩部不对称）
      if (ti === 0 || ti === 3 || ti === 4) {
        let s = fmsSets[ai];
        if (liuzqy && ti === 0) {
          s = [2, 1, 2, 2, 2, 1, 2];
          prof.fms = { squat: s[0], hurdle: s[1], lunge: s[2], shoulder: s[3], aslr: s[4], tspu: s[5], rotary: s[6] };
          prof.fmsAsymm = ['shoulder'];
        } else if (liuzqy) {
          s = [2, 2, 2, 3, 2, 2, 3];
          prof.fms = { squat: s[0], hurdle: s[1], lunge: s[2], shoulder: s[3], aslr: s[4], tspu: s[5], rotary: s[6] };
        } else {
          // 末次筛查普遍 +1 分（封顶 3）
          const ss = ti === 0 ? s : s.map((v) => Math.min(3, v + (rnd() > 0.5 ? 1 : 0)));
          prof.fms = { squat: ss[0], hurdle: ss[1], lunge: ss[2], shoulder: ss[3], aslr: ss[4], tspu: ss[5], rotary: ss[6] };
        }
      }
      d.profiles.push(prof);
    });
  });

  // ---------- 近 8 周已完成训练课（每天 1-3 节，含全队 sRPE 与个人负荷） ----------
  const sesStart = U.addDays(U.today(), -56);
  const baseRpe = { '力量': 7, '技术': 5.5, '战术': 6.5, '综合体能': 8, '速度': 8, '敏捷': 7.5, '恢复再生': 3, '测试': 7, '比赛': 9 };
  for (const meso of mesoRefs) {
    for (const day of meso.days || []) {
      if (day.date < sesStart || day.date > U.today()) continue;
      for (const course of day.courses || []) {
        if (!Store.moduleOfType(course.type)) continue;
        const micro = d.micros.find((x) => x.mesoId === meso.id && U.between(day.date, x.startDate, x.endDate));
        const ses = {
          id: U.uid('ses'), planKey: meso.id + ':' + day.date + ':' + course.id, date: day.date,
          name: course.name, type: course.type, time: course.time, duration: DUR[course.type] || 75,
          srpe: null, athSrpe: {}, athletes: aths.map((a) => a.id),
          rows: U.deepClone(course.rows || []), results: {}, note: `来自中周期「${meso.name}」当日计划`,
          mesoId: meso.id, microId: micro ? micro.id : null, fromMeso: true
        };
        d.sessions.push(ses);
        aths.forEach((a, k) => {
          const rpe = clamp(Math.round(baseRpe[course.type] + (rnd() - 0.5) * 2 + (k === 0 ? 0.5 : 0)), 1, 10);
          ses.athSrpe[a.id] = rpe;
          d.loadEntries.push({
            id: U.uid('le'), athleteId: a.id, date: day.date, rpe,
            duration: ses.duration, load: rpe * ses.duration, source: 'session', sessionId: ses.id, note: ses.name
          });
          // 力量课：逐人实际重量/完成组次/RIR（actualOwn 标记教练已录入，计入实际口径统计）；其它课型标记为已完成（保护中周期双向映射）
          ses.results[a.id] = ses.rows.map((r) => {
            if (Calc.metricOf(r) === 'reps' && r.exId) {
              const rm = Store.athRm(a.id, r.exId);
              const w = rm && r.pct ? Calc.weightFromPct(rm.value, r.pct) : r.weight;
              return { w, actual: Number(r.reps) || 0, sets: Number(r.sets) || 0, setsOwn: true, rir: 2, actualOwn: true };
            }
            return { w: null, actual: null, rir: 2 };
          });
        });
      }
    }
  }

  // 记录示例清单：「退出示例」时按此精确移除示例创建的数据，不影响用户自己新增的内容
  d.settings.demo = {
    macroId,
    athleteIds: aths.map((a) => a.id),
    exerciseIds: demoCreatedExIds,
    cat1Id: catCreated ? c1bb.id : null,
    prevActiveMacroId
  };

  Store.save();
  return true;
};

// 退出示例：仅移除 seedDemo 创建的示例数据（计划/中周期/小周期/训练课/负荷/测试/档案/示例运动员/篮球专项动作），
// 用户自建的计划与数据完整保留；退出后切回载入示例前正在查看的用户计划
window.exitDemo = function exitDemo() {
  const dm = Store.data && Store.data.settings && Store.data.settings.demo;
  if (!dm) return;
  const d = Store.data;
  const athSet = new Set(dm.athleteIds || []);
  const mesoIds = new Set(d.mesos.filter((m) => m.macroId === dm.macroId).map((m) => m.id));
  d.macros = d.macros.filter((m) => m.id !== dm.macroId);
  d.mesos = d.mesos.filter((m) => m.macroId !== dm.macroId);
  d.micros = d.micros.filter((m) => !mesoIds.has(m.mesoId));
  d.sessions = d.sessions.filter((s) => !mesoIds.has(s.mesoId));
  d.loadEntries = d.loadEntries.filter((le) => !athSet.has(le.athleteId));
  d.tests = d.tests.filter((t) => !athSet.has(t.athleteId));
  d.profiles = d.profiles.filter((p) => !athSet.has(p.athleteId));
  d.athletes = d.athletes.filter((a) => !athSet.has(a.id));
  for (const aid of athSet) delete d.athleteRm[aid];
  const exSet = new Set(dm.exerciseIds || []);
  if (exSet.size) d.exercises = d.exercises.filter((e) => !exSet.has(e.id));
  if (dm.cat1Id) d.categories1 = d.categories1.filter((c) => c.id !== dm.cat1Id);
  // 恢复载入前查看的计划；若该计划已不存在，则落到剩余的第一个用户计划
  const restore = dm.prevActiveMacroId && d.macros.some((m) => m.id === dm.prevActiveMacroId)
    ? dm.prevActiveMacroId
    : (d.macros.length ? d.macros[0].id : null);
  // 导入新建的运动员不属于示例自带清单（未被上面删除），但其 macroId 指向即将删除的示例计划；
  // 迁移到恢复后的计划，避免成为 KPI/档案页看不到的「孤儿运动员」
  if (restore) for (const a of d.athletes) if (a.macroId === dm.macroId) a.macroId = restore;
  d.settings.activeMacroId = restore;
  delete d.settings.demo;
  Store.save();
};
