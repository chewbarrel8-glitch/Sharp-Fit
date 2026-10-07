// 数据层：Electron 下走文件（userData/db.json），浏览器预览走 localStorage
const Store = {
  data: null,
  _subs: [],
  rev: 0,                       // 数据版本号：每次 save() 自增，供看板监听数据更新
  // 订阅数据更新：save() 后逐个通知（页面用来自动重算当前看板）
  subscribe(fn) { Store._subs.push(fn); },

  defaultDB() {
    return {
      version: 1,
      settings: { activeMacroId: null },
      customSports: {},            // { [catName]: [sportName] }
      categories1: [],             // 动作库一级分类 {id, name, children:[{id,name}]}
      exercises: [],               // {id, cat1, cat2, name, equip, notes}（1RM 一律按运动员测定，不设默认值）
      macros: [],                  // {id, name, sportCat, sport, model, startDate, endDate, compDates:[{date,name,place}], testDates:[{date,name}]}
      mesos: [],                   // {id, macroId, name, type, startDate, endDate, days:[{date, note, rows:[{exId,pct,weight,sets,reps,actual}]}]}
      micros: [],                  // {id, mesoId, name, startDate, endDate, days:[{date, type, intensity, note}], targetLoad}
      sessions: [],                // {id, date, name, type, time, duration, srpe, athSrpe:{[athId]:rpe}, athletes:[ids], rows:[...], results:{[athId]:[{w,actual,rir}]}, note}
      athletes: [],                // {id, name, sport, gender, birth, note, macroId, avatar} avatar=160px JPEG dataURL（''=未上传，回退姓名首字）
      loadEntries: [],             // {id, athleteId, date, rpe, duration, source, sessionId, note}
      athleteRm: {},               // { [athleteId]: { [exerciseId]: {value, date, testDate, history:[{value,date,method,source}]} } } 运动员专属 1RM
      tests: [],                    // {id, athleteId, exerciseId, weight, reps, rir, estimated1RM, date, source, note}
      profiles: [],                 // {id, athleteId, date, height, weight, bodyFat, verticalJump, sprint20m, broadJump, laneAgility, pullUpReps, reactionTime, cmjHeight, imtpPeak, ybtLeft, ybtRight, asymm, fms:{squat,hurdle,lunge,shoulder,aslr,tspu,rotary}, fmsAsymm:[key], note}
      goals: [],                    // 训练目标库 {id, name, cat, hue}；大/中/小周期以 goals:{primary:[id],secondary:[id]} 引用
      goalCats: []                  // 用户自定义目标分类 [{id, name, hue}]；内置 9 大类从 goals 提取，自定义分类独立存储（允许空分类显示一行）
    };
  },

  // 内置训练目标库：七大训练模块 62 项
  // 力量训练 / 代谢训练 / 技·战术 / 多方向速度 / 恢复与再生 / 心理与认知 / 营养管理
  // hue 为该目标的色相（每模块一个色系、模块内渐变区分）；id 沿用历史 g1..g55（按目标名映射，保证旧库引用不断链）
  defaultGoals() {
    // 旧九大类顺序 → 旧 id 映射（仅用于保持存量库 goalBlocks/micro.goals 引用稳定）
    const legacyDefs = [
      ['力量训练', ['肌肥大', '最大力量', '爆发力', '力量—速度', '速度—力量', '启动力量', '反应力量', '力量耐力', '等长力量', '离心力量', '动作速度']],
      ['调节训练', ['有氧耐力（LSD）', '节奏训练', '有氧间歇', '无氧间歇', 'HIIT', '无氧耐力（糖酵解）', '有氧功率', '法特莱克', '重复冲刺（RSA）', '循环训练', '恢复性训练']],
      ['多方向速度', ['启动速度', '加速能力', '线性速度（最大速度）', '灵敏', '变向能力（COD）', '反应灵敏', '减速与制动', '侧向速度', '后退速度', '跑动技术']],
      ['技/战术', ['专项技术', '战术执行', '团队配合', '比赛节奏与决策', '位置技术', '攻防转换', '比赛模拟']],
      ['柔韧与灵活性', ['动态灵活性', '静态柔韧', '关节活动度', 'PNF 拉伸']],
      ['恢复与再生', ['主动恢复', '软组织放松', '呼吸调节']],
      ['核心训练', ['核心稳定（抗伸展）', '抗旋转', '动态核心力量']],
      ['测试与评估', ['体能测试', '1RM 力量测试', '速度与灵敏测试']],
      ['心理与认知', ['反应与决策', '专注力训练', '心理韧性']]
    ];
    const legacyId = {};
    let n = 0;
    for (const [, names] of legacyDefs) for (const nm of names) legacyId[nm] = 'g' + (++n);
    // 新七大模块（模块名, 色相, 小目标）
    const defs = [
      ['力量训练', 8, ['肌肥大', '最大力量', '爆发力', '力量—速度', '速度—力量', '启动力量', '反应力量', '力量耐力', '等长力量', '离心力量', '动作速度',
        '核心稳定（抗伸展）', '抗旋转', '动态核心力量', '1RM 力量测试']],
      ['代谢训练', 165, ['有氧耐力（LSD）', '节奏训练', '有氧间歇', '无氧间歇', 'HIIT', '无氧耐力（糖酵解）', '有氧功率', '法特莱克', '重复冲刺（RSA）', '循环训练', '体能测试']],
      ['技/战术', 268, ['专项技术', '战术执行', '团队配合', '比赛节奏与决策', '位置技术', '攻防转换', '比赛模拟']],
      ['多方向速度', 200, ['启动速度', '加速能力', '线性速度（最大速度）', '灵敏', '变向能力（COD）', '反应灵敏', '减速与制动', '侧向速度', '后退速度', '跑动技术', '速度与灵敏测试']],
      ['恢复与再生', 330, ['主动恢复', '软组织放松', '呼吸调节', '动态灵活性', '静态柔韧', '关节活动度', 'PNF 拉伸', '恢复性训练']],
      ['心理与认知', 230, ['反应与决策', '专注力训练', '心理韧性']],
      ['营养管理', 45, ['训练前营养', '训练中补给', '训练后恢复营养', '日常膳食管理', '水化管理', '体重与体成分管理', '运动补剂管理']]
    ];
    const out = [];
    const usedId = new Set();
    for (const [cat, hue, names] of defs) {
      names.forEach((name, i) => {
        let id = legacyId[name];
        if (!id || usedId.has(id)) { id = 'g' + (56 + out.filter((g) => g.id.startsWith('g') && Number(g.id.slice(1)) >= 56).length); while (usedId.has(id)) id = 'g' + (Number(id.slice(1)) + 1); }
        usedId.add(id);
        out.push({ id, name, cat, hue: (hue + i * 6) % 360 });
      });
    }
    return out;
  },

  // 七大训练模块（训练课课型也按此归类）：{name, hue, types:[课型细类]}
  TRAIN_MODULES: [
    { name: '力量训练', hue: 8, types: ['力量', '最大力量', '力量耐力', '爆发力', '核心稳定'] },
    { name: '代谢训练', hue: 165, types: ['耐力', '有氧耐力', '无氧耐力', '综合体能', '循环代谢'] },
    { name: '技/战术', hue: 268, types: ['技术', '战术', '技术战术'] },
    { name: '多方向速度', hue: 200, types: ['速度', '敏捷', '多方向速度'] },
    { name: '恢复与再生', hue: 330, types: ['恢复再生', '主动恢复', '柔韧灵活性'] },
    { name: '心理与认知', hue: 230, types: ['心理认知', '反应决策'] },
    { name: '营养管理', hue: 45, types: ['营养管理', '体重管控'] },
    { name: '测试/比赛', hue: 52, types: ['测试', '比赛'] }
  ],
  // 课型细类 → 所属模块名
  moduleOfType(t) {
    for (const m of Store.TRAIN_MODULES) if (m.types.includes(t)) return m.name;
    return null;
  },

  goalById(id) { return (Store.data.goals || []).find((g) => g.id === id); },

  // 全部分类（内置 9 大类从 goals 提取 + 用户自定义 goalCats），返回 [{name, hue}]，去重保序
  // 用于总表 9+ 行布局（空自定义分类也显示一行）+ goalPicker 分类下拉 + goalCycleChips 分组
  allGoalCats() {
    const out = [];
    const seen = new Set();
    // 内置分类：按 goals 数组顺序提取（defaultGoals 已按 9 大类顺序生成）
    for (const g of (Store.data.goals || [])) {
      if (g && g.cat && !seen.has(g.cat)) { seen.add(g.cat); out.push({ name: g.cat, hue: g.hue != null ? g.hue : 200 }); }
    }
    // 用户自定义分类（允许空分类，即该分类下无任何目标）
    for (const c of (Store.data.goalCats || [])) {
      if (c && c.name && !seen.has(c.name)) { seen.add(c.name); out.push({ name: c.name, hue: c.hue != null ? c.hue : 200 }); }
    }
    return out;
  },

  // 为新自定义分类分配不重复色相：在色环上找已有 hue 之间最大间隔的中点，保证颜色差异最大
  allocCatHue() {
    const used = Store.allGoalCats().map((c) => c.hue).filter((h) => h != null);
    if (!used.length) return 0;
    used.sort((a, b) => a - b);
    let bestGap = 0, bestHue = used[0];
    for (let i = 0; i < used.length; i++) {
      const next = used[(i + 1) % used.length];
      let gap = next - used[i]; if (gap < 0) gap += 360;
      if (gap > bestGap) { bestGap = gap; bestHue = (used[i] + gap / 2) % 360; }
    }
    return Math.round(bestHue);
  },

  // 删除自定义目标大分类：goalCats 移除 + 该分类下目标从 goals 库删除 + 各训练计划目标块中的引用清理（空块移除）+ 排序/隐藏记录清理
  removeGoalCat(name) {
    const d = Store.data;
    d.goalCats = (d.goalCats || []).filter((c) => c.name !== name);
    const gone = new Set((d.goals || []).filter((g) => g.cat === name).map((g) => g.id));
    d.goals = (d.goals || []).filter((g) => g.cat !== name);
    (d.macros || []).forEach((mac) => {
      if (Array.isArray(mac.goalBlocks)) {
        mac.goalBlocks.forEach((b) => {
          b.primary = (b.primary || []).filter((id) => !gone.has(id));
          b.secondary = (b.secondary || []).filter((id) => !gone.has(id));
        });
        mac.goalBlocks = mac.goalBlocks.filter((b) => (b.primary || []).length || (b.secondary || []).length);
      }
      if (Array.isArray(mac.goalCatOrder)) mac.goalCatOrder = mac.goalCatOrder.filter((n) => n !== name);
      if (Array.isArray(mac.goalHiddenCats)) mac.goalHiddenCats = mac.goalHiddenCats.filter((n) => n !== name);
    });
  },

  // 周期对象（meso/micro 为 obj.goals 嵌套；总表目标块为扁平 {primary, secondary}）的已选目标 → {primary:[目标对象], secondary:[目标对象]}
  goalsOf(obj) {
    const g = (obj && obj.goals) || obj || {};
    const pick = (ids) => (ids || []).map((id) => Store.goalById(id)).filter(Boolean);
    return { primary: pick(g.primary), secondary: pick(g.secondary) };
  },

  // 总表目标块映射：大周期 goalBlocks 中与 [startDate, endDate] 重叠的块 → 合并主要/次要目标（按目标 id 去重）
  // 供中/小周期页显示「来自大周期」的映射目标
  goalBlocksIn(macId, startDate, endDate) {
    const mac = Store.macro(macId);
    const blocks = ((mac && mac.goalBlocks) || []).filter((b) => b.start <= endDate && b.end >= startDate);
    const dedup = (ids) => {
      const seen = new Set(); const out = [];
      for (const id of ids) if (!seen.has(id)) { seen.add(id); const g = Store.goalById(id); if (g) out.push(g); }
      return out;
    };
    return { primary: dedup(blocks.flatMap((b) => b.primary || [])), secondary: dedup(blocks.flatMap((b) => b.secondary || [])) };
  },

  // 更新运动员专属 1RM（带历史记录）；method=来源描述，source='test'|'session'
  // applyValue=true（训练课内显式点击「更新1RM」）：无论是否已有测定基准，都把该估算提升为生效 1RM，下次训练按此值计划重量
  // sid=训练课 id：同一节课同一动作的估算在历史中只保留最新一条（课中反复修改重量/次数/RIR 不产生多条同日记录）
  updateAthRm(athId, exId, value, date, method, source, applyValue, sid) {
    if (!athId || !exId || !value) return;
    Store.data.athleteRm = Store.data.athleteRm || {};
    const rec = Store.data.athleteRm[athId] = Store.data.athleteRm[athId] || {};
    const prev = rec[exId];
    let history = (prev && prev.history) ? prev.history.slice() : [];
    if (sid) history = history.filter((h) => !h || h.sid !== sid);
    const entry = { value, date, method: method || '更新', source: source || 'test' };
    if (sid) entry.sid = sid;
    history.push(entry);
    if (prev && source === 'session' && !applyValue) {
      // 训练课课后估算（自动保存）：已有基准（测定/手动录入）时不覆盖基准 1RM，仅追加为最新一条记录供查看与分析；
      // 无基准的纯估算记录（历史全部来自训练课）允许刷新 value/date，保证估算随最新填写更新
      const hasBase = prev.history && prev.history.some((h) => h && h.source !== 'session');
      if (hasBase) {
        rec[exId] = Object.assign({}, prev, { history });
      } else {
        rec[exId] = { value, date, testDate: (prev && prev.testDate) ? prev.testDate : date, history };
      }
    } else {
      rec[exId] = { value, date, testDate: (prev && prev.testDate) ? prev.testDate : date, history };
    }
  },

  // 把已写入历史的某次估算提升为生效 1RM（显式点击「更新1RM」且同日同值记录已存在时使用，不重复追加历史）
  promoteAthRm(athId, exId, value, date) {
    if (!athId || !exId || !value) return;
    const rec = Store.data.athleteRm && Store.data.athleteRm[athId] && Store.data.athleteRm[athId][exId];
    if (!rec) return;
    rec.value = value;
    rec.date = date;
  },

  // 运动员某动作的 1RM 历史记录
  athRmHistory(athId, exId) {
    const rec = Store.data.athleteRm && Store.data.athleteRm[athId] && Store.data.athleteRm[athId][exId];
    return (rec && rec.history) ? rec.history : [];
  },

  // 生效 1RM：仅运动员专属值（测试自动估算或手动录入），不设全队默认；返回 {value, date, testDate} 或 null
  athRm(athId, exId) {
    const per = athId && Store.data.athleteRm && Store.data.athleteRm[athId] && Store.data.athleteRm[athId][exId];
    return per && per.value ? per : null;
  },

  // 运动员专属 1RM 设定数量（用于列表标记）
  athRmCount(exId) {
    const rm = Store.data.athleteRm || {};
    return Object.keys(rm).filter((athId) => rm[athId] && rm[athId][exId] && rm[athId][exId].value).length;
  },

  // 内置动作分类（首启种子 + 旧库迁移按名称补全新增分类）
  builtinCats() {
    return [
      ['下肢力量', ['深蹲系列', '硬拉系列', '单腿系列', '小腿与足踝']],
      ['上肢力量', ['推类', '拉类', '手臂']],
      ['全身爆发力', ['奥林匹克举重', '跳跃类', '药球与抛掷']],
      ['核心与躯干', ['抗伸展', '抗旋转', '动态核心']],
      ['能量系统', ['无氧功率', '有氧耐力', '间歇训练']],
      ['速度与敏捷', ['冲刺与加速', '变向与灵敏']],
      ['恢复与再生', ['拉伸', '筋膜放松', '呼吸训练']]
    ];
  },
  seedCategories() {
    const mk = (name, children) => ({ id: U.uid('c1'), name, children: children.map((c) => ({ id: U.uid('c2'), name: c })) });
    return Store.builtinCats().map(([name, children]) => mk(name, children));
  },

  // 内置动作目录：[一级分类, 二级分类, 名称, 器械, 计量单位(reps=次/distance=米/duration=秒), 负荷类型(resistance=抗阻带重量/bodyweight=自重/cardio=能量系统位移)]
  // 计量单位决定训练课该行录「组×次 / 组×距离 / 组×做功时间」；负荷类型决定是否显示 %1RM/重量/RIR 列
  builtinExDefs() {
    const R = 'reps', D = 'distance', T = 'duration';
    const RS = 'resistance', BW = 'bodyweight', CD = 'cardio';
    return [
      ['下肢力量', '深蹲系列', '颈后深蹲', '杠铃', R, RS],
      ['下肢力量', '深蹲系列', '前深蹲', '杠铃', R, RS],
      ['下肢力量', '深蹲系列', '箱式深蹲', '杠铃', R, RS],
      ['下肢力量', '深蹲系列', '保加利亚分腿蹲', '哑铃', R, RS],
      ['下肢力量', '硬拉系列', '传统硬拉', '杠铃', R, RS],
      ['下肢力量', '硬拉系列', '罗马尼亚硬拉', '杠铃', R, RS],
      ['下肢力量', '硬拉系列', '六角杠硬拉', '六角杠', R, RS],
      ['下肢力量', '单腿系列', '单腿臀桥', '自重', R, BW],
      ['下肢力量', '单腿系列', '单腿蹲（手枪蹲）', '自重', R, BW],
      ['下肢力量', '小腿与足踝', '站姿提踵', '杠铃', R, RS],
      ['上肢力量', '推类', '平板卧推', '杠铃', R, RS],
      ['上肢力量', '推类', '上斜卧推', '杠铃', R, RS],
      ['上肢力量', '推类', '站姿实力举', '杠铃', R, RS],
      ['上肢力量', '推类', '俯卧撑', '自重', R, BW],
      ['上肢力量', '拉类', '引体向上', '自重', R, BW],
      ['上肢力量', '拉类', '杠铃划船', '杠铃', R, RS],
      ['上肢力量', '拉类', '单臂哑铃划船', '哑铃', R, RS],
      ['上肢力量', '手臂', '杠铃弯举', '杠铃', R, RS],
      ['上肢力量', '手臂', '绳索下压', '绳索', R, RS],
      ['全身爆发力', '奥林匹克举重', '高翻', '杠铃', R, RS],
      ['全身爆发力', '奥林匹克举重', '悬垂翻', '杠铃', R, RS],
      ['全身爆发力', '奥林匹克举重', '抓举', '杠铃', R, RS],
      ['全身爆发力', '奥林匹克举重', '借力推', '杠铃', R, RS],
      ['全身爆发力', '跳跃类', '跳深', '跳箱', R, BW],
      ['全身爆发力', '跳跃类', '立定跳远', '自重', D, BW],
      ['全身爆发力', '跳跃类', '连续纵跳', '自重', R, BW],
      ['全身爆发力', '药球与抛掷', '胸前推掷药球', '药球', R, BW],
      ['全身爆发力', '药球与抛掷', '旋转侧抛药球', '药球', R, BW],
      ['核心与躯干', '抗伸展', '平板支撑', '自重', T, BW],
      ['核心与躯干', '抗伸展', '侧桥', '自重', T, BW],
      ['核心与躯干', '抗伸展', '靠墙静蹲', '自重', T, BW],
      ['核心与躯干', '抗旋转', '帕洛夫推举', '绳索', R, RS],
      ['核心与躯干', '动态核心', '悬垂举腿', '单杠', R, BW],
      ['能量系统', '无氧功率', '风阻单车冲刺', '风阻单车', T, CD],
      ['能量系统', '无氧功率', 'Wingate 30秒全力蹬车', '风阻单车', T, CD],
      ['能量系统', '有氧耐力', '划船机稳态', '划船机', T, CD],
      ['能量系统', '有氧耐力', '稳态慢跑（LSD）', '跑道', T, CD],
      ['能量系统', '有氧耐力', '12分钟跑（Cooper）', '跑道', D, CD],
      ['能量系统', '有氧耐力', '3000m跑', '跑道', D, CD],
      ['能量系统', '有氧耐力', '法特莱克跑', '跑道', T, CD],
      ['能量系统', '间歇训练', '400米间歇跑', '跑道', D, CD],
      ['能量系统', '间歇训练', '300m间歇跑', '跑道', D, CD],
      ['能量系统', '间歇训练', '200m间歇跑', '跑道', D, CD],
      ['能量系统', '间歇训练', '20m折返跑（Beep）', '跑道', D, CD],
      ['能量系统', '间歇训练', 'Yo-Yo间歇测试', '跑道', D, CD],
      ['能量系统', '间歇训练', '30-15间歇体能测试（IFT）', '跑道', D, CD],
      ['速度与敏捷', '冲刺与加速', '10m加速跑', '跑道', D, CD],
      ['速度与敏捷', '冲刺与加速', '20m冲刺', '跑道', D, CD],
      ['速度与敏捷', '冲刺与加速', '40码冲刺', '跑道', D, CD],
      ['速度与敏捷', '冲刺与加速', '飞行30m最大速度', '跑道', D, CD],
      ['速度与敏捷', '冲刺与加速', '重复冲刺RSA（6×30m）', '跑道', D, CD],
      ['速度与敏捷', '变向与灵敏', '505变向测试', '跑道', D, CD],
      ['速度与敏捷', '变向与灵敏', 'Pro敏捷（5-10-5）', '跑道', D, CD],
      ['速度与敏捷', '变向与灵敏', 'T测试', '跑道', D, CD],
      ['速度与敏捷', '变向与灵敏', 'Illinois敏捷测试', '跑道', D, CD],
      ['恢复与再生', '拉伸', '静态拉伸', '自重', T, BW],
      ['恢复与再生', '筋膜放松', '泡沫轴放松', '泡沫轴', T, BW],
      ['恢复与再生', '呼吸训练', '膈肌呼吸训练', '自重', T, BW]
    ];
  },
  seedExercises() {
    const c = Store.data.categories1;
    const find = (n1, n2) => {
      const a = c.find((x) => x.name === n1); const b = a && a.children.find((y) => y.name === n2);
      return b ? { c1: a.name, c2: b.name } : null;
    };
    return Store.builtinExDefs().map(([n1, n2, name, equip, metric, loadType]) => {
      const pos = find(n1, n2) || { c1: n1, c2: n2 };
      return { id: U.uid('ex'), cat1: pos.c1, cat2: pos.c2, name, equip, metric, loadType, notes: '' };
    });
  },

  // 旧库迁移：补全新增内置分类/动作（按名称去重），并为缺量纲字段的旧动作推断 metric/loadType
  migrateExerciseLib() {
    const d = Store.data;
    d.categories1 = Array.isArray(d.categories1) ? d.categories1 : [];
    d.exercises = Array.isArray(d.exercises) ? d.exercises : [];
    // ① 补缺失的一级/二级分类
    for (const [c1Name, children] of Store.builtinCats()) {
      let c1 = d.categories1.find((c) => c.name === c1Name);
      if (!c1) { c1 = { id: U.uid('c1'), name: c1Name, children: [] }; d.categories1.push(c1); }
      c1.children = Array.isArray(c1.children) ? c1.children : [];
      for (const c2Name of children) {
        if (!c1.children.some((c) => c.name === c2Name)) c1.children.push({ id: U.uid('c2'), name: c2Name });
      }
    }
    // ② 补缺失的内置动作（同名不重复添加）
    const has = (nm) => d.exercises.some((e) => e.name === nm);
    for (const [n1, n2, name, equip, metric, loadType] of Store.builtinExDefs()) {
      if (has(name)) continue;
      d.exercises.push({ id: U.uid('ex'), cat1: n1, cat2: n2, name, equip, metric, loadType, notes: '' });
    }
    // ③ 旧动作补量纲字段（按分类/名称推断，仅补不覆盖用户已选值）
    for (const ex of d.exercises) {
      if (ex.metric == null) ex.metric = Store.inferMetric(ex);
      if (ex.loadType == null) ex.loadType = Store.inferLoadType(ex);
    }
  },

  // 旧动作量纲推断：名称/二级分类含跑/冲刺/间歇/跑测→距离；支撑/拉伸/放松/稳态/静蹲→时间；其余→次
  inferMetric(ex) {
    const t = `${ex.name || ''} ${ex.cat2 || ''} ${ex.cat1 || ''}`;
    if (/跑|冲刺|折返|Yo-Yo|Beep|Cooper|RSA|变向|敏捷|T测试|Illinois|Pro|505/.test(t) && !/跑步机热身上肢/.test(t)) {
      if (/风阻|单车|Wingate|划船机稳态|稳态|法特莱克|LSD|静蹲|支撑|平板|侧桥|拉伸|放松|呼吸/.test(t)) return 'duration';
      return 'distance';
    }
    if (/平板|支撑|静蹲|静态|拉伸|放松|呼吸|稳态|法特莱克|LSD|Wingate|风阻|单车/.test(t)) return 'duration';
    return 'reps';
  },
  inferLoadType(ex) {
    if (ex.cat1 === '能量系统' || ex.cat1 === '速度与敏捷') return 'cardio';
    if (ex.cat1 === '恢复与再生') return 'bodyweight';
    if (ex.equip && !/自重/.test(ex.equip)) return 'resistance';
    return 'bodyweight';
  },

  async init() {
    let raw = null;
    if (window.api) raw = await window.api.loadDB();
    else { try { raw = JSON.parse(localStorage.getItem('tpdb') || 'null'); } catch (e) { raw = null; } }
    Store.data = Object.assign(Store.defaultDB(), raw || {});
    if (!Store.data.categories1.length) Store.data.categories1 = Store.seedCategories();
    if (!Store.data.exercises.length) Store.data.exercises = Store.seedExercises();
    // 动作库量纲迁移：补全新增内置分类/动作 + 旧动作补 metric/loadType（次/米/秒，抗阻/自重/能量系统）
    Store.migrateExerciseLib();
    // 训练目标库迁移：旧数据无 goals 时填充内置目录
    if (!Store.data.goals || !Store.data.goals.length) Store.data.goals = Store.defaultGoals();
    // 自定义目标分类迁移
    Store.data.goals = Store.data.goals || [];
    Store.data.goalCats = Store.data.goalCats || [];
    // 一次性迁移：九大分类 → 七大训练模块（目标名不变，重划 cat；新增营养管理等内置目标补入）
    if (!Store.data.settings.goalTaxV2) {
      const defs = Store.defaultGoals();
      const byName = new Map(defs.map((g) => [g.name, g]));
      const existingIds = new Set(Store.data.goals.map((g) => g.id));
      const existingNames = new Set(Store.data.goals.map((g) => g.name));
      for (const g of Store.data.goals) {
        const ng = byName.get(g.name);
        if (ng) { g.cat = ng.cat; g.hue = ng.hue; }   // 旧内置目标跟随新模块划分（调节→代谢、核心/1RM→力量、柔韧→恢复…）
      }
      for (const ng of defs) {
        if (!existingNames.has(ng.name) && !existingIds.has(ng.id)) Store.data.goals.push(Object.assign({}, ng));
      }
      Store.data.settings.goalTaxV2 = true;
    }
    // 训练计划 → 大周期 层级迁移：每个 macro（训练计划）新增 cycles 数组（用户自定义的大周期子区间）
    for (const mac of Store.data.macros || []) {
      mac.cycles = mac.cycles || [];
    }
    // 一次性迁移：小周期每日强度 1-10 → 百分比（0-100）
    if (!Store.data.settings.intensityPct) {
      for (const mi of Store.data.micros || []) {
        for (const dy of (mi.days || [])) {
          if (typeof dy.intensity === 'number' && dy.intensity >= 1 && dy.intensity <= 10) dy.intensity = dy.intensity * 10;
        }
      }
      Store.data.settings.intensityPct = true;
    }
    // 一次性迁移：每人课后结果中已填的 组数/单组量 标记为「个人数据」，与计划自动带入（Own=false）区分
    if (!Store.data.settings.resultsOwnV2) {
      for (const s of Store.data.sessions || []) {
        for (const arr of Object.values(s.results || {})) {
          for (const rs of (arr || [])) {
            if (!rs) continue;
            if (rs.actual != null) rs.actualOwn = true;
            if (rs.sets != null) rs.setsOwn = true;
          }
        }
      }
      Store.data.settings.resultsOwnV2 = true;
    }
    // 一次性迁移：计划行补稳定 rid（行增删/重排后每人数据按 rid 对齐，不按下标串位）
    if (!Store.data.settings.rowRidV1) {
      const stampRows = (rows) => { for (const r of (rows || [])) if (r && !r.rid) r.rid = U.uid('r'); };
      for (const m of Store.data.mesos || []) {
        for (const d of (m.days || [])) {
          for (const c of (d.courses || [])) stampRows(c.rows);
          stampRows(d.rows);
        }
      }
      for (const s of Store.data.sessions || []) stampRows(s.rows);
      Store.data.settings.rowRidV1 = true;
    }
    Store.persist();
  },

  async persist() {
    try {
      if (window.api) {
        await window.api.saveDB(Store.data);
      } else {
        localStorage.setItem('tpdb', JSON.stringify(Store.data));
      }
    } catch (err) {
      console.error('persist failed', err);
    }
  },

  save() {
    const result = Store.persist();
    Store.rev++;
    Store._subs.forEach((fn) => { try { fn(); } catch (e) { /* 单个订阅者异常不阻断其余通知 */ } });
    return result;
  },

  // ---------- 查询 ----------
  macro(id) { return Store.data.macros.find((m) => m.id === id); },
  // 中周期当日课程：新结构 {courses:[{id,name,type,rows}]}（一天多课）；旧结构 {rows} 视为单课程
  dayCourses(dy) {
    if (!dy) return [];
    if (Array.isArray(dy.courses)) return dy.courses;
    return [{ name: dy.note || '', type: dy.type || '', rows: dy.rows || [] }];
  },
  dayRows(dy) { return Store.dayCourses(dy).flatMap((c) => c.rows || []); },

  // ---------- 复杂训练分组（blocks 容器：session 或 meso course） ----------
  ensureBlocks(c) { if (c && !Array.isArray(c.blocks)) c.blocks = []; return c ? c.blocks : []; },
  nextBlockLabel(c) {
    const used = new Set((c && Array.isArray(c.blocks) ? c.blocks : []).map((b) => b.label));
    let n = 0;
    while (used.has(String.fromCharCode(65 + n))) n++;
    return String.fromCharCode(65 + n);
  },
  // 创建组块并把 rows[rowIdxs] 加入（共享正式组组数取首行组数，默认 3）
  makeBlock(container, rows, rowIdxs) {
    Store.ensureBlocks(container);
    const sets = rowIdxs.length && Number(rows[rowIdxs[0]].sets) ? Number(rows[rowIdxs[0]].sets) : 3;
    const blk = { id: U.uid('blk'), label: Store.nextBlockLabel(container), sets };
    container.blocks.push(blk);
    rowIdxs.forEach((i) => { if (rows[i]) { rows[i].blkId = blk.id; rows[i].sets = sets; } });
    return blk;
  },
  // 块共享组数变更：同步块内每行 sets；已逐组展开的行同步增减其正式组定义（以末尾正式组为模板）
  setBlockSets(container, rows, blkId, sets) {
    const blk = (container.blocks || []).find((b) => b.id === blkId);
    if (!blk) return;
    blk.sets = sets;
    rows.forEach((r) => { if (r.blkId === blkId) Store.setRowWorkSets(r, sets); });
  },
  // 单行正式组数变更：同步 r.sets；若已逐组展开，按末尾正式组为模板增减正式组定义
  setRowWorkSets(r, sets) {
    r.sets = sets;
    if (!(Array.isArray(r.setDefs) && r.setDefs.length)) return;
    const defs = r.setDefs;
    const workIdx = defs.map((d, k) => (d.kind !== 'warm' ? k : -1)).filter((k) => k >= 0);
    const cur = workIdx.length;
    if (sets > cur) {
      const tpl = Object.assign({}, defs[workIdx[workIdx.length - 1]] || { kind: 'work' }, { kind: 'work' });
      for (let k = 0; k < sets - cur; k++) defs.push(Object.assign({}, tpl));
    } else if (sets < cur) {
      let remove = cur - sets;
      for (let k = defs.length - 1; k >= 0 && remove; k--) {
        if (defs[k].kind !== 'warm') { defs.splice(k, 1); remove--; }
      }
    }
  },
  // 行移出块；块为空时自动删除块（保留动作本身）
  detachBlockRow(container, rows, idx) {
    const blkId = rows[idx] && rows[idx].blkId;
    if (!blkId) return;
    rows[idx].blkId = null;
    if (!rows.some((r) => r.blkId === blkId)) {
      container.blocks = (container.blocks || []).filter((b) => b.id !== blkId);
    }
  },
  // 行在所属块内的序号（1 起，用于 A1/A2 标注）
  blockPos(rows, r) {
    let n = 0;
    for (const x of rows) { if (x.blkId === r.blkId) { n++; if (x === r) return n; } }
    return n;
  },
  // 快速模式行物化为逐组定义（现有 组数×单组量 → N 个正式组）；已展开则原样返回
  materializeSetDefs(r) {
    if (Array.isArray(r.setDefs) && r.setDefs.length) return r.setDefs;
    const metric = Calc.metricOf(r);
    const mk = () => Object.assign(
      { sid: U.uid('set'), kind: 'work', pct: r.pct ?? null, weight: r.weight ?? null, reps: null, dist: null, distUnit: r.distUnit || 'm', dur: null, durUnit: r.durUnit || 's' },
      metric === 'distance' ? { dist: r.dist ?? null } : metric === 'duration' ? { dur: r.dur ?? null } : { reps: r.reps ?? null });
    const n = Math.max(1, Number(r.sets) || 1);
    r.setDefs = Array.from({ length: n }, mk);
    return r.setDefs;
  },
  activeMacro() {
    const s = Store.data.settings;
    return Store.macro(s.activeMacroId) || Store.data.macros[0] || null;
  },
  mesosOf(macroId) {
    return Store.data.mesos.filter((m) => m.macroId === macroId).sort((a, b) => a.startDate.localeCompare(b.startDate));
  },
  microsOf(mesoId) {
    return Store.data.micros.filter((m) => m.mesoId === mesoId).sort((a, b) => a.startDate.localeCompare(b.startDate));
  },
  sessionsOn(date) { return Store.data.sessions.filter((s) => s.date === date); },
  exercise(id) { return Store.data.exercises.find((e) => e.id === id); },

  activeMacroAthletes() {
    const mac = Store.activeMacro();
    if (!mac) return null;
    return new Set((Store.data.athletes || []).filter((a) => a.macroId === mac.id).map((a) => a.id));
  },
  athleteSetForScope(athleteId) {
    if (athleteId) return new Set([athleteId]);
    const scope = Store.activeMacroAthletes();
    return scope || null;
  },
  // 计算某日所有训练计划吨位（kg）：中周期计划 + 训练课实际
  dayTonnage(date) {
    let kg = 0;
    for (const meso of Store.data.mesos) {
      const day = meso.days && meso.days.find((x) => x.date === date);
      if (day) kg += Calc.rowsTonnage(day.rows || []);
    }
    for (const ses of Store.data.sessions) {
      if (ses.date === date) kg += Calc.rowsTonnage(ses.rows || []);
    }
    return kg;
  },
  // 计算某日训练课实际吨位（kg）：仅已建训练课，不含中周期计划
  sessionTonnage(date) {
    let kg = 0;
    for (const ses of Store.data.sessions) {
      if (ses.date === date) kg += Calc.rowsTonnage(ses.rows || []);
    }
    return kg;
  },
  // 某日已完成训练课的实际吨位（kg）：按运动员实际重量×实际完成次数叠加；
  // 实际重量缺省回退该运动员 1RM 换算的计划重量；未填实际完成（未完成）不计
  dayActualTonnage(date) {
    let kg = 0;
    for (const ses of Store.data.sessions) {
      if (ses.date !== date) continue;
      kg += Store.sessionActualTonnage(ses);
    }
    return kg;
  },
  // 计划组/次自动带入每名运动员：results[athId] 与 ses.rows 按下标对齐，
  // 未单独修改（Own=false）的 组数/单组量 自动取计划值并随计划更新；已单独修改（Own=true）的保留个人值。
  // 实际重量 w / RIR 永远由每人单独填写，不从计划带入。
  alignSessionResults(ses) {
    if (!ses) return;
    ses.results = ses.results || {};
    const rows = ses.rows || [];
    for (const aid of (ses.athletes || [])) {
      const old = ses.results[aid] || [];
      // 优先按行 rid 对齐（行增删/重排后个人数据不串位），未匹配的按下标兜底
      const picked = new Array(rows.length).fill(null);
      const used = new Set();
      rows.forEach((r, i) => {
        if (!r || !r.rid) return;
        const oi = old.findIndex((c, k) => c && c.rid === r.rid && !used.has(k));
        if (oi >= 0) { picked[i] = old[oi]; used.add(oi); }
      });
      rows.forEach((r, i) => {
        if (picked[i] || !r) return;
        for (let k = 0; k < old.length; k++) {
          if (!used.has(k)) { picked[i] = old[k]; used.add(k); break; }
        }
      });
      const next = [];
      for (let i = 0; i < rows.length; i++) {
        const p = picked[i] || {};
        const setsOwn = !!p.setsOwn;
        const actualOwn = !!p.actualOwn;
        const planSets = Number(rows[i].sets) || null;
        const planPerSet = Calc.rowPerSet(rows[i]) || null;
        const item = {
          rid: rows[i].rid || p.rid || null,
          w: p.w ?? null,
          rir: p.rir ?? null,
          setsOwn,
          actualOwn,
          sets: setsOwn ? (p.sets ?? null) : planSets,
          actual: actualOwn ? (p.actual ?? null) : planPerSet
        };
        if (Array.isArray(p.setDefs) && p.setDefs.length) item.setDefs = p.setDefs;
        // 逐组明细按运动员个人定义优先；旧数据仍可从共享计划 setDefs 读取
        // own=false 的组跟随计划（实际量随计划更新）；own=true 保留个人值；done=false（未完成）持久保留
        const defs = Array.isArray(item.setDefs) && item.setDefs.length ? item.setDefs
          : Array.isArray(rows[i].setDefs) && rows[i].setDefs.length ? rows[i].setDefs : null;
        if (defs) {
          const oldLogs = Array.isArray(p.setLogs) ? p.setLogs : [];
          defs.forEach((d, k) => {
            if (!d.sid) d.sid = U.uid('set');
            if (oldLogs[k] && !oldLogs[k].sid) oldLogs[k].sid = d.sid;
          });
          const hasStableLogs = oldLogs.some((lg) => lg && lg.sid);
          const logsById = new Map(oldLogs.filter((lg) => lg && lg.sid).map((lg) => [lg.sid, lg]));
          item.setLogs = defs.map((d, k) => {
            const lg = (hasStableLogs ? logsById.get(d.sid) : oldLogs[k]) || {};
            const own = !!lg.own;
            return {
              sid: d.sid,
              kind: d.kind || 'work',
              w: own ? (lg.w ?? null) : null,
              actual: own ? (lg.actual ?? null) : Calc.setDefDose(rows[i], d),
              rir: lg.rir ?? null,
              done: lg.done === undefined ? true : !!lg.done,
              own
            };
          });
        } else if (Array.isArray(p.setLogs)) {
          item.setLogs = p.setLogs;   // 计划明细被收起时保留个人逐组数据，不丢弃
        }
        next.push(item);
      }
      ses.results[aid] = next;
    }
  },

  // 训练课是否已包含真实课后记录（重量/RIR/单独修改过的组次/逐组记录）；仅计划自动带入不算
  sessionHasActual(ses) {
    return !!ses && Object.values(ses.results || {}).some((arr) => (arr || []).some((r) =>
      r && (r.actualOwn || r.setsOwn || r.w != null || r.rir != null ||
        (Array.isArray(r.setLogs) && r.setLogs.some((lg) => lg && (lg.own || lg.done === false))))));
  },

  // 完课判定：实时/计划训练不进入“已完成”外部负荷分析。
  // 兼容旧数据：早期记录可能缺少 sStatus，但只要已保存过有效的课后 sRPE 时长记录，仍视为完成。
  hasCompletedLoad(ses) {
    if (!ses) return false;
    if (ses.sStatus === 'done') return true;
    return (Store.data.loadEntries || []).some((e) => e.sessionId === ses.id && Number(e.duration) > 0);
  },

  // 单节训练课实际吨位（kg）：所有参训运动员实际完成叠加（kg/次行；重量为 0 的自重行不产生吨位）
  // 与 sessionActualDose 同口径（含热身组、逐组重量）；若当前存在活动计划作用域，则仅统计该 scope 内运动员
  sessionActualTonnage(ses) {
    const scope = Store.athleteSetForScope();
    const aids = (ses.athletes || []).filter((aid) => !scope || scope.has(aid));
    return aids.reduce((kg, aid) => kg + Store.sessionActualDose(ses, aid).kg, 0);
  },

  // 单节训练课（或单人）实际外部负荷向量：{kg 吨位, m 总距离, s 做功秒数, reps 总次数, bands 速度带距离{m}}
  // aid 省略 = 全队参训者累加；actual 语义=单组量（次/米/秒），总剂量=实际组数×单组量，缺省回退计划
  // 逐组明细（setDefs/setLogs）：热身+正式均统计，done=false 的组不计，重量按组各自回退（组重量→1RM×组%1RM→行重量）
  sessionActualDose(ses, aid, opts) {
    const actualOnly = !!(opts && opts.actualOnly);
    const out = { kg: 0, m: 0, s: 0, reps: 0, bands: { sprint: 0, hsr: 0, moderate: 0, aerobic: 0 } };
    const scope = Store.athleteSetForScope(aid);
    const aids = aid ? [aid] : ((ses.athletes || []).filter((id) => !scope || scope.has(id)));
    if (!aids.length) return out;
    aids.forEach((id) => {
      const res = (ses.results || {})[id] || [];
      (ses.rows || []).forEach((r, i) => {
        const rs = res[i] || {};
        const metric = Calc.metricOf(r);
        const defs = Array.isArray(rs.setDefs) && rs.setDefs.length ? rs.setDefs
          : Array.isArray(r.setDefs) && r.setDefs.length ? r.setDefs : null;
        const logs = defs && Array.isArray(rs.setLogs) ? rs.setLogs : null;
        // 逐组完成路径
        if (defs && logs) {
          if (actualOnly && !logs.some((lg) => lg && lg.own)) return;
          const rm = Store.athRm(id, r.exId);
          defs.forEach((d0, k) => {
            const lg = logs[k] || {};
            if (lg.done === false) return;
            let v = Number(lg.actual);
            if (!lg.own || v == null || isNaN(v)) v = Calc.setDefDose(r, d0);
            if (!v) return;
            if (metric === 'reps') {
              out.reps += v;
              let w = lg.own && lg.w != null ? Number(lg.w) : NaN;
              if (!w || isNaN(w)) w = Calc.setDefWeight(d0, rm ? rm.value : null) || Number(r.weight) || 0;
              out.kg += (w || 0) * v;
            } else if (metric === 'distance') {
              out.m += v;
              out.bands[Calc.setDefSpeedBand(r, d0)] += v;
            } else if (metric === 'duration') {
              out.s += v;
            }
          });
          return;
        }
        const d = Calc.actualRowDose(r, rs);
        if (actualOnly && !d.filled) return;
        const dose = d.total;
        if (!dose) return;
        if (metric === 'reps') {
          out.reps += dose;
          // 有实际/计划重量才算吨位（自重动作重量=0，自然为 0；任何 kg 行动作只要设置了重量/1RM 都计入）
          const rm = Store.athRm(id, r.exId);
          const w = rs.w != null ? rs.w : (rm && r.pct ? Calc.weightFromPct(rm.value, r.pct) : r.weight);
          out.kg += (Number(w) || 0) * dose;
        } else if (metric === 'distance') {
          out.m += dose;
          out.bands[Calc.rowSpeedBand(r)] += dose;
        } else if (metric === 'duration') {
          out.s += dose;
        }
      });
    });
    return out;
  },

  // 单节训练课内部负荷（sRPE×时长，来自 loadEntries）：aid 省略=全队参训者合计
  // 返回 {au 负荷, minutes 时长, n 有负荷记录人数}
  sessionInternal(ses, aid) {
    const scope = Store.athleteSetForScope(aid);
    const es = (Store.data.loadEntries || []).filter((e) => e.sessionId === ses.id && (!scope || (scope.size === 0 ? false : scope.has(e.athleteId))));
    if (aid) return { au: U.sum(es, (e) => Number(e.load) || 0), minutes: U.sum(es, (e) => Number(e.duration) || 0), n: es.length };
    return { au: U.sum(es, (e) => Number(e.load) || 0), minutes: U.sum(es, (e) => Number(e.duration) || 0), n: es.length };
  },

  // 日期范围内部负荷汇总：{au, minutes, days 有训练的天数, sessions 不同课次}
  rangeInternalLoad(from, to, athleteId) {
    const scope = Store.athleteSetForScope(athleteId);
    const days = new Set(), sids = new Set();
    let au = 0, minutes = 0;
    for (const e of Store.data.loadEntries || []) {
      if (e.date < from || e.date > to) continue;
      if (scope && !scope.has(e.athleteId)) continue;
      au += Number(e.load) || 0;
      minutes += Number(e.duration) || 0;
      days.add(e.date);
      if (e.sessionId) sids.add(e.sessionId);
    }
    return { au, minutes, days: days.size, sessions: sids.size };
  },

  // 日期范围内全队/个人外部负荷汇总（kg/m/s，速度带）；只统计已完课。
  // 完课但未逐项录入时，剂量按完成时保存的计划回填，保证“计划”与“已完成”不会混在一起。
  rangeActualDose(from, to, athleteId) {
    const scope = Store.athleteSetForScope(athleteId);
    const out = { kg: 0, m: 0, s: 0, reps: 0, bands: { sprint: 0, hsr: 0, moderate: 0, aerobic: 0 } };
    for (const ses of Store.data.sessions) {
      if (ses.date < from || ses.date > to) continue;
      if (scope && !(ses.athletes || []).some((id) => scope.has(id))) continue;
      if (!Store.hasCompletedLoad(ses)) continue;
      const d = Store.sessionActualDose(ses, athleteId || null);
      out.kg += d.kg; out.m += d.m; out.s += d.s; out.reps += d.reps;
      for (const k of Object.keys(out.bands)) out.bands[k] += d.bands[k];
    }
    return out;
  },

  // 按日已完成外部负荷序列（{date, kg, m, s, bands}），范围 [start,end] 填零
  dailyDoseSeries(start, end, athleteId) {
    const scope = Store.athleteSetForScope(athleteId);
    const map = {};
    for (const ses of Store.data.sessions) {
      if (ses.date < start || ses.date > end) continue;
      if (scope && !(ses.athletes || []).some((id) => scope.has(id))) continue;
      if (!Store.hasCompletedLoad(ses)) continue;
      const d = Store.sessionActualDose(ses, athleteId || null);
      const p = map[ses.date] = map[ses.date] || { kg: 0, m: 0, s: 0, bands: { sprint: 0, hsr: 0, moderate: 0, aerobic: 0 } };
      p.kg += d.kg; p.m += d.m; p.s += d.s;
      for (const k of Object.keys(p.bands)) p.bands[k] += d.bands[k];
    }
    const out = [];
    let dt = start;
    while (dt <= end) {
      const p = map[dt] || { kg: 0, m: 0, s: 0, bands: { sprint: 0, hsr: 0, moderate: 0, aerobic: 0 } };
      out.push({ date: dt, kg: p.kg, m: p.m, s: p.s, bands: p.bands });
      dt = U.addDays(dt, 1);
    }
    return out;
  },

  // 范围内外部负荷：按内容桶拆分的实际训练分钟数（loadEntries 关联 sessions 取各行时间占比）
  // 口径：每节课每名运动员的实际时长（分钟，含组间休息）× 动作行估算的内容时间占比；不含 sRPE 加权
  rangeMinByBucket(from, to, athleteId) {
    const out = {};
    const sesMap = {};
    for (const ses of Store.data.sessions) sesMap[ses.id] = ses;
    for (const e of Store.data.loadEntries || []) {
      if (e.date < from || e.date > to) continue;
      if (athleteId && e.athleteId !== athleteId) continue;
      const ses = sesMap[e.sessionId];
      const shares = ses ? Calc.sessionBucketShares(ses) : { [Calc.sessionTypeBucket(e.note)]: 1 };
      const min = Number(e.duration) || 0;
      for (const [b, sh] of Object.entries(shares)) out[b] = (out[b] || 0) + min * sh;
    }
    return out;
  },

  // 计划范围内（中周期全部 dayCourses 行）的计划外部负荷向量：{kg, m, s, reps}
  // athleteId 给出时，抗阻行重量按该运动员 1RM×%1RM 换算（计划行通常只填 pct）；不给则用行内计划重量
  planDoseBetween(from, to, athleteId) {
    const out = { kg: 0, m: 0, s: 0, reps: 0 };
    for (const meso of Store.data.mesos || []) {
      for (const dy of (meso.days || [])) {
        if (dy.date < from || dy.date > to) continue;
        for (const c of Store.dayCourses(dy)) {
          for (const r of c.rows || []) {
            const metric = Calc.metricOf(r);
            const dose = Calc.planRowDose(r);
            if (metric === 'reps') {
              out.reps += dose;
              let w = Number(r.weight) || 0;
              if (!w && athleteId && r.pct) {
                const rm = Store.athRm(athleteId, r.exId);
                w = rm ? Calc.weightFromPct(rm.value, r.pct) : 0;
              }
              out.kg += (w || 0) * dose;
            } else if (metric === 'distance') out.m += dose;
            else if (metric === 'duration') out.s += dose;
          }
        }
      }
    }
    return out;
  },

  compOn(date) { return Store.data.macros.some((m) => (m.compDates || []).some((c) => c.date === date)); }
};

// ---------- 计算引擎 ----------
const Calc = {
  // 单行负荷 kg = 重量 × 完成次数（实际缺省 = 组数×每组次数）；仅重量行产生吨位
  // rmValue：计划模式传入运动员 1RM 时，重量缺省按 1RM×%1RM 折算（课后行已直接存 r.weight）
  rowLoad(r, rmValue) {
    if (Calc.metricOf(r) !== 'reps') return 0;
    // 逐组明细（热身组 + 正式组分别计吨位）：Σ 逐组重量 × 逐组次数
    if (Array.isArray(r.setDefs) && r.setDefs.length) {
      return U.sum(r.setDefs, (d) => (Calc.setDefWeight(d, rmValue) || 0) * (Number(d.reps) || 0));
    }
    let w = Number(r.weight);
    if ((!w || isNaN(w)) && rmValue && r.pct) w = Number(Calc.weightFromPct(rmValue, r.pct)) || 0;
    if (!w || isNaN(w)) return 0;
    const reps = r.actual != null && r.actual !== '' ? Number(r.actual) : (Number(r.sets) || 0) * (Number(r.reps) || 0);
    return w * (reps || 0);
  },
  // 逐组定义的有效重量：组内手填重量优先，否则按该运动员 1RM×该组 %1RM 折算
  setDefWeight(d, rmValue) {
    let w = Number(d && d.weight);
    if ((!w || isNaN(w)) && rmValue && d && d.pct) w = Number(Calc.weightFromPct(rmValue, d.pct)) || 0;
    return w || 0;
  },
  rowsTonnage(rows) { return U.sum(rows || [], Calc.rowLoad); },
  // 计划行按一批运动员 1RM 折算的团队计划吨位（仅 kg/次行）
  // 每个有 1RM 的运动员：重量 = 行内重量 或 1RM×%1RM；无 1RM 者跳过。返回 {kg, nW 有重量人数, n 总人数}
  planRowTeamLoad(r, athIds) {
    if (Calc.metricOf(r) !== 'reps') return { kg: 0, nW: 0, n: (athIds || []).length };
    // 逐组明细：每名运动员每组按 组重量→其1RM×组%1RM 折算后累加
    const defs = Array.isArray(r.setDefs) && r.setDefs.length ? r.setDefs : null;
    let kg = 0, nW = 0;
    if (defs) {
      (athIds || []).forEach((aid) => {
        const rm = Store.athRm(aid, r.exId);
        const perAth = U.sum(defs, (d) => Calc.setDefWeight(d, rm ? rm.value : null) * (Number(d.reps) || 0));
        kg += perAth;
        if (perAth > 0) nW++;
      });
      return { kg, nW, n: (athIds || []).length };
    }
    const reps = (Number(r.sets) || 0) * (Number(r.reps) || 0);
    if (!reps) return { kg: 0, nW: 0, n: (athIds || []).length };
    (athIds || []).forEach((aid) => {
      let w = Number(r.weight);
      if ((!w || isNaN(w)) && r.pct) {
        const rm = Store.athRm(aid, r.exId);
        w = rm ? Number(Calc.weightFromPct(rm.value, r.pct)) || 0 : 0;
      }
      if (w > 0) { kg += w * reps; nW++; }
    });
    return { kg, nW, n: (athIds || []).length };
  },
  rowsTeamTonnage(rows, athIds) {
    return (rows || []).reduce((acc, r) => {
      const t = Calc.planRowTeamLoad(r, athIds);
      acc.kg += t.kg; acc.nW = Math.max(acc.nW, t.nW); acc.n = Math.max(acc.n, t.n);
      return acc;
    }, { kg: 0, nW: 0, n: (athIds || []).length });
  },
  rowsSets(rows) { return U.sum(rows || [], (r) => Number(r.sets) || 0); },
  rowsReps(rows) {
    // 总次数只统计「次」量纲行（距离行的米、时间行的秒不得计入次数）；逐组明细含热身+正式
    return U.sum(rows || [], (r) => {
      if (Calc.metricOf(r) !== 'reps') return 0;
      if (Array.isArray(r.setDefs) && r.setDefs.length) return Calc.planRowDose(r);
      return r.actual != null && r.actual !== '' ? Number(r.actual) || 0 : (Number(r.sets) || 0) * (Number(r.reps) || 0);
    });
  },

  // ---------- 五量纲体系：重量行(kg, 次×重量) / 自重行(BW, 只计次不计吨位) / 距离行(m) / 时间行(s) / 无负荷行(—, 只记组数) ----------
  // 行单位：优先行内显式 unit（教练可在动作表手改），否则按动作库量纲+负荷类型自动判定，旧数据按字段启发式回退
  rowUnit(r) {
    if (r && ['kg', 'm', 's', 'bw', 'none'].includes(r.unit)) return r.unit;
    const ex = r && r.exId ? Store.exercise(r.exId) : null;
    if (ex && ex.metric === 'distance') return 'm';
    if (ex && ex.metric === 'duration') return 's';
    if (!ex) {
      if (r && r.dist != null && r.dist !== '') return 'm';
      if (r && r.dur != null && r.dur !== '') return 's';
    }
    if (ex && ex.loadType === 'bodyweight') return 'bw';
    return 'kg';
  },
  // 选动作时自动带出的单位（自重次数→BW，距离量纲→m，时间量纲→s，抗阻次数→kg）
  autoUnitOf(ex) {
    if (ex && ex.metric === 'distance') return 'm';
    if (ex && ex.metric === 'duration') return 's';
    if (ex && ex.loadType === 'bodyweight') return 'bw';
    return 'kg';
  },
  // 行量纲：kg/BW→reps（次/重量行；BW 自重行只计次数不计吨位），m→distance，s→duration，none→无负荷
  metricOf(r) {
    const u = r && r.unit ? r.unit : null;
    if (u === 'kg' || u === 'bw') return 'reps';
    if (u === 'm') return 'distance';
    if (u === 's') return 'duration';
    if (u === 'none') return 'none';
    const ex = r && r.exId ? Store.exercise(r.exId) : null;
    if (ex && ex.metric) return ex.metric === 'reps' && ex.loadType === 'bodyweight' ? 'reps' : ex.metric;
    if (r && r.dist != null && r.dist !== '') return 'distance';
    if (r && r.dur != null && r.dur !== '') return 'duration';
    return 'reps';
  },
  loadTypeOf(r) {
    if (r && r.unit === 'bw') return 'bodyweight';
    if (r && r.unit === 'none') return 'none';
    const ex = r && r.exId ? Store.exercise(r.exId) : null;
    if (ex && ex.loadType) return ex.loadType;
    if (r && r.exId) return (r.weight ? 'resistance' : 'bodyweight');
    return 'resistance';   // 未选动作的新行：按抗阻行展示 %1RM/重量列（选择自重/能量系统动作后自动收起）
  },
  // 单行单组剂量（计划）：次数=reps；距离统一米（distUnit=km 换算）；做功时间统一秒（durUnit=min 换算）；无负荷=0
  rowPerSet(r) {
    const metric = Calc.metricOf(r);
    if (metric === 'distance') {
      const d = Number(r.dist) || 0;
      return r.distUnit === 'km' ? d * 1000 : d;
    }
    if (metric === 'duration') {
      const d = Number(r.dur) || 0;
      return r.durUnit === 'min' ? d * 60 : d;
    }
    if (metric === 'none') return 0;
    return Number(r.reps) || 0;
  },
  // 单行计划总剂量：逐组明细 = Σ 各组（热身+正式）单组量；否则 组×单组剂量
  planRowDose(r) {
    if (Calc.metricOf(r) === 'none') return 0;
    if (Array.isArray(r.setDefs) && r.setDefs.length) return U.sum(r.setDefs, (d) => Calc.setDefDose(r, d));
    return (Number(r.sets) || 0) * Calc.rowPerSet(r);
  },
  // 单个逐组定义的剂量（规范单位：次 / 米 / 秒）
  setDefDose(r, d) {
    d = d || {};
    const metric = Calc.metricOf(r);
    if (metric === 'none') return 0;
    if (metric === 'distance') {
      const v = Number(d.dist) || 0;
      return d.distUnit === 'km' ? v * 1000 : v;
    }
    if (metric === 'duration') {
      const v = Number(d.dur) || 0;
      return d.durUnit === 'min' ? v * 60 : v;
    }
    return Number(d.reps) || 0;
  },
  // 运动员单行实际完成（规范单位：次/米/秒）
  // 归属标记：rs.actualOwn/rs.setsOwn = 该运动员此行的单组量/组数已被单独修改（真实课后记录）；
  // 未标记的单元格值由计划自动带入，随计划变更而更新。清空个人值即恢复跟随计划。
  // 旧数据兼容：只填了 rs.actual（历史上是总剂量）且没有 rs.sets → 按 1 组处理，总剂量保持不变
  actualRowDose(r, rs) {
    rs = rs || {};
    const metric = Calc.metricOf(r);
    // 逐组完成记录（与计划 setDefs 对齐）：仅统计 done !== false 的组；未单独修改（own=false）跟随计划
    const defs = Array.isArray(r.setDefs) && r.setDefs.length ? r.setDefs : null;
    const logs = defs && Array.isArray(rs.setLogs) ? rs.setLogs : null;
    if (defs && logs) {
      let total = 0, doneN = 0, own = false;
      logs.forEach((lg, k) => {
        lg = lg || {};
        if (lg.done === false) return;
        doneN++;
        let v = Number(lg.actual);
        if (!lg.own || v == null || isNaN(v)) v = Calc.setDefDose(r, defs[k] || {});
        total += v || 0;
        if (lg.own) own = true;
      });
      return { sets: doneN, perSet: doneN ? total / doneN : 0, total, filled: own };
    }
    const aOwn = !!rs.actualOwn;
    let perSet;
    if (aOwn) {
      perSet = Number(rs.actual) || 0;
      if (metric === 'distance' && r.distUnit === 'km') perSet *= 1000;
      if (metric === 'duration' && r.durUnit === 'min') perSet *= 60;
    } else {
      perSet = Calc.rowPerSet(r);
    }
    let sets;
    if (rs.setsOwn) sets = Number(rs.sets) || 0;
    else sets = aOwn ? 1 : (Number(r.sets) || 0);
    return { sets, perSet, total: sets * perSet, filled: aOwn };
  },
  // 一组距离的速度 m/s（同时录了单组距离+单组做功时间时可算）；否则 null
  rowSpeed(r) {
    if (Calc.metricOf(r) !== 'distance') return null;
    const dist = Calc.rowPerSet(r);   // 米
    const sec = Number(r.dur) ? (r.durUnit === 'min' ? Number(r.dur) * 60 : Number(r.dur)) : 0;
    return dist > 0 && sec > 0 ? dist / sec : null;
  },
  // 速度带：冲刺 ≥7.0 m/s · 高速跑 HSR 5.0–7.0 · 中速 3.0–5.0 · 有氧 <3.0
  // 无做功时间时按动作名称/二级分类归入速度带（冲刺类→sprint，有氧/LSD→aerobic，间歇/无氧→hsr，其余 moderate）
  rowSpeedBand(r) {
    const v = Calc.rowSpeed(r);
    if (v != null) return v >= 7 ? 'sprint' : v >= 5 ? 'hsr' : v >= 3 ? 'moderate' : 'aerobic';
    const ex = r && r.exId ? Store.exercise(r.exId) : null;
    const t = `${(ex && ex.name) || ''} ${(ex && ex.cat2) || ''} ${(ex && ex.cat1) || ''}`;
    if (/冲刺|加速|最大速度|40码|RSA|飞(行|奔)|sprint/i.test(t)) return 'sprint';
    if (/有氧|稳态|LSD|慢跑|法特莱克|Cooper|12分钟|3000m|Beep|折返/.test(t)) return 'aerobic';
    if (/间歇|无氧|功率|Wingate|敏捷|变向|505|Illinois|T测试|Pro/.test(t)) return 'hsr';
    return 'moderate';
  },
  // 计划距离/做功时长汇总（meso 计划行用）
  rowsDistance(rows) {
    return U.sum(rows || [], (r) => Calc.metricOf(r) === 'distance' ? Calc.planRowDose(r) : 0);
  },
  rowsDuration(rows) {
    return U.sum(rows || [], (r) => Calc.metricOf(r) === 'duration' ? Calc.planRowDose(r) : 0);
  },
  // 按速度带拆分计划距离 {sprint,hsr,moderate,aerobic}；逐组定义按每组距离/做功分别归类
  rowsDistanceBands(rows) {
    const b = { sprint: 0, hsr: 0, moderate: 0, aerobic: 0 };
    (rows || []).forEach((r) => {
      if (Calc.metricOf(r) !== 'distance') return;
      const defs = Array.isArray(r.setDefs) && r.setDefs.length ? r.setDefs : null;
      if (defs) defs.forEach((d) => { b[Calc.setDefSpeedBand(r, d)] += Calc.setDefDose(r, d); });
      else b[Calc.rowSpeedBand(r)] += Calc.planRowDose(r);
    });
    return b;
  },
  // 单个距离组的速度带：组距离/组做功可算速度时按速度，否则回退动作名称归类
  setDefSpeedBand(r, d) {
    const dist = Calc.setDefDose(r, d);
    const sec = Number(d.dur) ? (d.durUnit === 'min' ? Number(d.dur) * 60 : Number(d.dur)) : 0;
    if (dist > 0 && sec > 0) {
      const v = dist / sec;
      return v >= 7 ? 'sprint' : v >= 5 ? 'hsr' : v >= 3 ? 'moderate' : 'aerobic';
    }
    return Calc.rowSpeedBand(r);
  },

  // ---------- 内容大类（7 个训练桶 + 技战术/测试/比赛三个课级桶） ----------
  bucketOf(ex) {
    if (!ex) return '其他';
    if (/冲刺|加速|敏捷|变向/.test(`${ex.cat2 || ''}`)) return '速度敏捷';
    switch (ex.cat1) {
      case '下肢力量': case '上肢力量': return '力量';
      case '全身爆发力': return '爆发力';
      case '核心与躯干': return '核心';
      case '恢复与再生': return '恢复柔韧';
      case '速度与敏捷': return '速度敏捷';
      case '能量系统':
        if (ex.cat2 === '有氧耐力' || /有氧|稳态|LSD|慢跑|节奏/.test(ex.name || '')) return '有氧';
        return '无氧';
      default:
        if (/冲刺|加速|敏捷|变向/.test(ex.name || '')) return '速度敏捷';
        if (/有氧|慢跑|LSD/.test(ex.name || '')) return '有氧';
        if (/无氧|间歇|Wingate|冲刺/.test(ex.name || '')) return '无氧';
        return '其他';
    }
  },
  rowBucket(r) { return Calc.bucketOf(r && r.exId ? Store.exercise(r.exId) : null); },
  // 课程类型 → 内容桶（课级，技战术/比赛课无动作行时使用）
  sessionTypeBucket(type) {
    const t = type || '';
    if (/力量/.test(t)) return '力量';
    if (/爆发/.test(t)) return '爆发力';
    if (/速度|敏捷/.test(t)) return '速度敏捷';
    if (/有氧|无氧|耐力|体能/.test(t)) return /有氧/.test(t) ? '有氧' : '无氧';
    if (/核心/.test(t)) return '核心';
    if (/柔韧|恢复/.test(t)) return '恢复柔韧';
    if (/技|战术/.test(t)) return '技战术';
    if (/比赛/.test(t)) return '比赛';
    if (/测试/.test(t)) return '测试';
    return '其他';
  },
  // 行估算占用课时（分钟，含组间休息）——用于把整节实际训练时长按内容桶拆分
  rowEstMin(r) {
    const sets = Number(r.sets) || 0;
    if (!sets) return 0;
    const metric = Calc.metricOf(r);
    if (metric === 'duration') {
      const work = Calc.planRowDose(r) / 60;
      return work + (sets > 1 ? sets * 0.5 : 0);
    }
    if (metric === 'distance') {
      const band = Calc.rowSpeedBand(r);
      const speed = band === 'sprint' ? 7 : band === 'hsr' ? 5.5 : band === 'aerobic' ? 3.3 : 4;   // m/s 估算
      const rest = band === 'sprint' ? 2 : band === 'hsr' ? 1.5 : 1;
      return Calc.planRowDose(r) / speed / 60 + (sets > 1 ? sets * rest : 0);
    }
    // 次数量纲：抗阻 3 min/组（做功+休息）；跳跃/投掷 2.5；核心/自重 1.5；其余 2
    const ex = r && r.exId ? Store.exercise(r.exId) : null;
    const b = Calc.bucketOf(ex);
    if (b === '爆发力') return sets * 2.5;
    if (b === '核心' || Calc.loadTypeOf(r) === 'bodyweight') return sets * 1.5;
    if (b === '力量') return sets * 3;
    return sets * 2;
  },
  // 一节课各内容桶的时间占比（{桶: 0~1}，合计 1）：按行估算课时归一；无行时整课归入课程类型桶
  sessionBucketShares(ses) {
    const mins = {};
    (ses.rows || []).forEach((r) => {
      const m = Calc.rowEstMin(r);
      if (!(m > 0)) return;
      const b = Calc.rowBucket(r);
      mins[b] = (mins[b] || 0) + m;
    });
    const total = Object.values(mins).reduce((s, v) => s + v, 0);
    if (!total) { const b = Calc.sessionTypeBucket(ses.type); return { [b]: 1 }; }
    const shares = {};
    for (const [b, m] of Object.entries(mins)) shares[b] = m / total;
    return shares;
  },
  // 吨位加权平均强度
  rowsAvgPct(rows) {
    let sw = 0, sp = 0;
    for (const r of rows || []) {
      const w = Number(r.weight); const p = Number(r.pct);
      if (w && p) { const reps = (r.actual != null && r.actual !== '' ? Number(r.actual) : (Number(r.sets) || 0) * (Number(r.reps) || 0)) || 0; sw += w * reps; sp += w * reps * p; }
    }
    return sw ? sp / sw : null;
  },
  // %1RM -> 重量
  weightFromPct(oneRm, pct) {
    if (!oneRm || !pct) return null;
    return U.round25(oneRm * pct / 100);
  },
  // 重量 -> %1RM
  pctFromWeight(oneRm, w) {
    if (!oneRm || !w) return null;
    return Math.round(w / oneRm * 100);
  },
  // 基于 RIR 估算 1RM（Epley 公式 RIR 修正版）
  // 公式：e1RM = weight × (1 + (reps + rir) / 30)
  // 参考来源：Helms 2016 RPE-RIR 量表 / Zourdos 2016；最佳精度区间 3-10 次，±5% 误差
  // 注意：reps 必须是「单组次数」而非多组总次数；总次数（如 3 组×12 次=36）代入会严重高估
  estimate1RM(weight, reps, rir) {
    const w = Number(weight), r = Number(reps), ri = Number(rir);
    // 下限硬约束：重量/次数必须为正，RIR 不得为负（输入框 min=0 但手输可绕过；负值会让估算静默偏低甚至为负）
    if (!(w > 0) || !(r > 0)) return null;
    const rr = isNaN(ri) ? 0 : Math.max(0, ri);
    return Math.round(w * (1 + (r + rr) / 30));
  },
  // 1RM 估算可靠性评估（基于单组完成次数 reps + RIR）
  // 返回 {est, warn, over}：≤10 次可靠；11-12 次偏高警示；>12 次超出公式适用范围不给出估算值
  estimate1RMInfo(weight, reps, rir) {
    const w = Number(weight), r = Number(reps);
    if (!(w > 0) || !(r > 0)) return null;
    const n = r + Math.max(0, Number(rir) || 0);
    if (n > 12) return { est: null, over: true, warn: false, n };
    return { est: Calc.estimate1RM(weight, reps, rir), over: false, warn: n > 10, n };
  },
  // EWMA（指数移动平均）：tau 天时间常数
  // 标准公式：EWMA_t = λ·EWMA_{t-1} + (1−λ)·load_t，λ=exp(−1/tau)
  // 曾错误地把当日负荷也乘 λ（稳态被放大约 tau 倍，TSB=CTL−ATL 严重失真），已修正
  ewma(series, tau) {
    // series: [{date, load}] 已按日期升序去重合并
    const lam = Math.exp(-1 / tau);
    let out = [], prev = null, prevDate = null;
    for (const p of series) {
      let v;
      if (prev == null) v = p.load;
      else {
        const d = Math.max(1, U.daysBetween(prevDate, p.date) - 1);   // 间隔天数（相邻日=1；daysBetween 含首尾+1 需减回）
        const w = Math.pow(lam, d);   // 历史权重随间隔衰减
        v = prev * w + p.load * (1 - w);
      }
      out.push({ date: p.date, value: v });
      prev = v; prevDate = p.date;
    }
    return out;
  },
  // 日负荷序列（填零），范围 [start, end]
  dailySeries(entries, start, end) {
    const map = {};
    for (const e of entries) map[e.date] = (map[e.date] || 0) + (Number(e.load) || 0);
    const out = []; let d = start;
    while (d <= end) { out.push({ date: d, load: map[d] || 0 }); d = U.addDays(d, 1); }
    return out;
  },
  // ACWR（急慢性负荷比）= 急性负荷 EWMA(7d) ÷ 慢性负荷 EWMA(42d)
  // 与 TSB = CTL(42d EWMA) − ATL(7d EWMA) 共享同一组 CTL/ATL 值（Banister 模型）
  // 建议区间 0.8–1.3，>1.5 提示短期负荷激增、损伤风险上升
  acwr(series, idx) {
    const ctl = Calc.ewma(series, 42)[idx].value;
    const atl = Calc.ewma(series, 7)[idx].value;
    return ctl > 0 ? atl / ctl : null;
  },
  // 单调性 = 周日均 / 周内标准差
  monotony(loads) {
    const m = U.avg(loads);
    if (loads.length < 2) return null;
    const sd = Math.sqrt(U.avg(loads.map((x) => (x - m) * (x - m))));
    return sd > 0 ? m / sd : null;
  },
  // ---------- 统计分析 ----------
  // 标准差（样本标准差，除以 n-1）
  std(arr) {
    if (!arr || arr.length < 2) return 0;
    const m = U.avg(arr);
    return Math.sqrt(U.sum(arr, (x) => (x - m) * (x - m)) / (arr.length - 1));
  },
  // Z 分数 = (个体 - 均值) / 标准差
  zScore(val, arr) {
    if (val == null || !arr || arr.length < 2) return 0;
    const m = U.avg(arr);
    const sd = Calc.std(arr);
    return sd > 0 ? (val - m) / sd : 0;
  },
  // 百分位排名 = 该值超过数组中多少百分比的数据
  percentile(val, arr) {
    if (val == null || !arr || !arr.length) return 50;
    const below = arr.filter((x) => x < val).length;
    return Math.round((below / arr.length) * 100);
  },
  // 变异系数 CV = 标准差 / 均值 × 100%
  cv(arr) {
    if (!arr || !arr.length) return 0;
    const m = U.avg(arr);
    if (m === 0) return 0;
    return (Calc.std(arr) / m) * 100;
  },
  // 最小有意义变化 SWC = 0.2 × 受试者间标准差（Hopkins 2004）
  // 小于 SWC 的变化多为测量噪声；团队不足 2 人有值时返回 0
  swc(arr) {
    if (!arr || arr.length < 2) return 0;
    return 0.2 * Calc.std(arr);
  },
  // 测量标准误差 SEM = CV × 均值 / 100（简化）
  sem(arr) {
    if (!arr || !arr.length) return 0;
    const m = U.avg(arr);
    return Calc.std(arr) / Math.sqrt(arr.length);
  },
  // 变化幅度 Δ% = (当前 - 基线) / 基线 × 100
  deltaPct(current, baseline) {
    if (current == null || baseline == null || baseline === 0) return 0;
    return ((current - baseline) / baseline) * 100;
  }
};
