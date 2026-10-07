// jsdom 冒烟测试：大周期页「周期总表」渲染与保存
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

window.__chartOptions = [];
window.echarts = { init: () => ({ setOption(option) { window.__chartOptions.push(option); }, resize() {}, dispose() {} }) };
window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));

// 造数夹具复用应用内示例（src/js/demo.js：XX篮球队备战计划），保证冒烟测试与「载入示例」同源
// 不引入 app.js：jsdom 会异步触发 DOMContentLoaded，app 启动引导会抢先挂载 macro 到静态 #view，
// 与下方手动挂载的 section 产生重复 ID，触发 jsdom(nwsapi) 重复 ID 下作用域 querySelector 失效
const files = ['js/util.js', 'js/sports.js', 'js/store.js', 'js/ui.js',
  'js/views/macro.js', 'js/views/meso.js', 'js/views/micro.js', 'js/views/session.js',
  'js/views/load.js', 'js/views/exercises.js'];
const seedSource = fs.readFileSync(path.join(root, 'src', 'js', 'demo.js'), 'utf8');
// 拼接为单个脚本执行，保证跨文件顶层 const 共享（与浏览器多 <script> 行为一致）
window.eval(files.map((f) => fs.readFileSync(path.join(root, 'src', f), 'utf8')).join('\n;\n')
  + '\n;\n' + seedSource
  + '\n;window.__T = { Store, Calc, U, UI, Views, seedDemo };');
const T = window.__T;

const errors = [];
window.addEventListener('error', (e) => errors.push(e.message));

(async () => {
  const $ = (s) => window.document.querySelector(s);
  const $$ = (s) => [...window.document.querySelectorAll(s)];
  await T.Store.init();
  T.seedDemo();

  // 挂载大周期页
  const view = window.document.createElement('section');
  window.document.body.appendChild(view);
  T.Views.macro.mount(view);

  const grid = $('#gridBox', view) || view.querySelector('#gridBox');
  const assert = (cond, name) => console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name) || (cond || errors.push(name));

  assert(!!grid.querySelector('#teamName'), 'TEAM NAME 输入框存在');
  assert(grid.querySelectorAll('.pg-mon').length >= 2, '月份合并带 >= 2（跨月）');
  // 期望周数与大周期总表渲染同口径：起始周周一铺到结束周周一
  const mac0 = T.Store.activeMacro();
  const expWeeks = Math.round((T.U.d(T.U.weekStart(mac0.endDate)) - T.U.d(T.U.weekStart(mac0.startDate))) / 86400000 / 7) + 1;
  assert(grid.querySelectorAll('.pg-day').length / 7 === expWeeks, '日期格数 = 周数×7（' + expWeeks + ' 周）');
  assert(grid.querySelector('.pg-day.comp'), '存在红色比赛日格');
  assert(grid.querySelectorAll('.pg-meso').length >= 3, '中周期合并带 >= 3');
  assert(grid.querySelector('.pg-comp').textContent !== '' || grid.querySelectorAll('.pg-comp').length > 0, '比赛日行渲染');
  assert(grid.querySelectorAll('.pg-inp').length >= 14, '训练量/负荷输入格齐全');

  // 模拟输入：第一周训练量 8 / 训练负荷 6 / 准备水平 8（状态行现为 1-10 数字输入）
  const mac = T.Store.activeMacro();
  const ws = T.U.weekStart(mac.startDate);
  const setVal = (key, val) => {
    const inp = grid.querySelector(`[data-ws="${ws}"][data-key="${key}"]`);
    inp.value = val;
    inp.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  setVal('volume', '8'); setVal('intensity', '6'); setVal('status', '8');
  assert(mac.weekPlan[ws] && mac.weekPlan[ws].volume === 8 && mac.weekPlan[ws].intensity === 6 && mac.weekPlan[ws].status === 8, '手动输入已写入 weekPlan');
  const sel = grid.querySelector(`[data-ws="${ws}"][data-key="status"]`);
  assert(sel.className.includes('st-8'), '准备水平高亮 class 生效');

  // 持久化
  const saved = JSON.parse(window.localStorage.getItem('tpdb'));
  assert(saved.macros[0].weekPlan[ws].volume === 8 && saved.macros[0].weekPlan[ws].status === 8, 'weekPlan 已持久化到 localStorage');

  // 队伍名称
  const tn = grid.querySelector('#teamName');
  tn.value = '国家集训队';
  tn.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(T.Store.activeMacro().teamName === '国家集训队', '队伍名称已保存');

  // 重新挂载后回填
  T.Views.macro.mount(view);
  const g2 = view.querySelector('#gridBox');
  assert(g2.querySelector('#teamName').value === '国家集训队', '重挂载后队伍名称回填');
  assert(g2.querySelector(`[data-ws="${ws}"][data-key="volume"]`).value === '8', '重挂载后训练量回填');
  assert(g2.querySelector(`[data-ws="${ws}"][data-key="status"]`).className.includes('st-8'), '重挂载后准备水平高亮回填');

  // 其它页面挂载无异常
  for (const r of ['meso', 'micro', 'session', 'load', 'exercises']) {
    try { window.Views[r].mount(view); console.log('PASS - 页面挂载 ' + r); } catch (e) { console.log('FAIL - 页面挂载 ' + r + ': ' + e.message); errors.push(r); }
  }

  // 负荷管理：日期/周期筛选驱动全可视化看板
  const loadView = $('#view');
  const chartOptionStart = window.__chartOptions.length;
  T.Views.load.mount(loadView);
  const dashboard = loadView.querySelector('#loadDashboard');
  assert(!!loadView.querySelector('#loadDateFrom') && !!loadView.querySelector('#loadDateTo'), '自定义起止日期筛选存在');
  assert(!!loadView.querySelector('#loadMesoFilter') && !!loadView.querySelector('#loadMicroFilter'), '中周期与小周期筛选存在');
  assert(dashboard.querySelectorAll('table').length === 0, '负荷看板不使用数据表格');
  assert(dashboard.querySelectorAll('.load-metric').length === 8, 'AU、ACWR、TSB、吨位、课次、训练时长、距离、做功时间指标齐全');
  assert(dashboard.querySelectorAll('.chart[role="img"]').length === 10, '负荷看板包含十个可视化图表');
  assert(dashboard.querySelectorAll('.load-metric .qmark').length === 8 && dashboard.querySelectorAll('.card-title .qmark').length === 10, '每张指标卡和图表均有算法说明入口');
  const dashboardChartOptions = window.__chartOptions.slice(chartOptionStart);
  assert(dashboardChartOptions.filter((option) => (option.series || []).some((series) => series.type === 'gauge')).length === 2, 'ACWR 与 TSB 均以指针仪表绘制');
  const dateAxisOptions = dashboardChartOptions.filter((option) => option.xAxis && !Array.isArray(option.xAxis) && Array.isArray(option.xAxis.data));
  assert(dateAxisOptions.length > 0 && dateAxisOptions.every((option) => option.xAxis.data.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)) && !option.xAxis.axisLabel.formatter('2026-01-01').includes('NaN')), '每日图表使用 ISO 日期并且轴标签不产生 NaN');
  const fromInput = loadView.querySelector('#loadDateFrom');
  const toInput = loadView.querySelector('#loadDateTo');
  fromInput.value = '2026-09-15';
  toInput.value = '2026-09-30';
  fromInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(loadView.querySelector('#loadDateFrom').value === '2026-09-15' && loadView.querySelector('#loadDateTo').value === '2026-09-30', '自定义日期范围可应用到看板');
  assert(loadView.querySelector('#loadMesoFilter').value === 'all' && loadView.querySelector('#loadMicroFilter').value === 'all', '手动选择日期会清除周期筛选');
  const mesoFilter = loadView.querySelector('#loadMesoFilter');
  const firstMesoId = mesoFilter.options[1] && mesoFilter.options[1].value;
  if (firstMesoId) {
    const firstMeso = T.Store.data.mesos.find((m) => m.id === firstMesoId);
    assert(mesoFilter.options[1].textContent.includes(T.U.md(firstMeso.startDate)) && mesoFilter.options[1].textContent.includes(T.U.md(firstMeso.endDate)), '中周期选项显示起止日期');
    mesoFilter.value = firstMesoId;
    mesoFilter.dispatchEvent(new window.Event('change', { bubbles: true }));
    const selectedMeso = T.Store.data.mesos.find((m) => m.id === firstMesoId);
    assert(loadView.querySelector('#loadDateFrom').value === selectedMeso.startDate && loadView.querySelector('#loadDateTo').value === selectedMeso.endDate, '选择中周期会联动日期范围');
    const microFilter = loadView.querySelector('#loadMicroFilter');
    const firstMicroId = microFilter.options[1] && microFilter.options[1].value;
    if (firstMicroId) {
      const firstMicro = T.Store.data.micros.find((mi) => mi.id === firstMicroId);
      assert(microFilter.options[1].textContent.includes(T.U.md(firstMicro.startDate)) && microFilter.options[1].textContent.includes(T.U.md(firstMicro.endDate)), '小周期选项显示起止日期');
      microFilter.value = firstMicroId;
      microFilter.dispatchEvent(new window.Event('change', { bubbles: true }));
      const selectedMicro = T.Store.data.micros.find((mi) => mi.id === firstMicroId);
      assert(loadView.querySelector('#loadDateFrom').value === selectedMicro.startDate && loadView.querySelector('#loadDateTo').value === selectedMicro.endDate, '选择小周期会联动日期范围');
    }
  }
  const macroB = T.U.uid('mac');
  const mesoB = T.U.uid('mes');
  const microB = T.U.uid('mic');
  const athleteB = T.U.uid('ath');
  const athleteC = T.U.uid('ath');
  T.Store.data.macros.push({ id: macroB, name: '第二计划', startDate: '2026-01-01', endDate: '2026-12-31' });
  T.Store.data.mesos.push({ id: mesoB, macroId: macroB, name: '第二计划中周期', startDate: '2026-01-01', endDate: '2026-12-31' });
  T.Store.data.micros.push({ id: microB, mesoId: mesoB, name: '第二计划小周期', startDate: '2026-01-01', endDate: '2026-01-07' });
  T.Store.data.athletes.push({ id: athleteB, macroId: macroB, name: '第二计划运动员' });
  T.Store.data.athletes.push({ id: athleteC, macroId: macroB, name: '第二计划运动员二' });
  T.Store.data.settings.activeMacroId = macroB;
  T.Views.load.mount(loadView);
  assert(loadView.querySelector('#loadMesoFilter').value === 'all' && loadView.querySelector('#loadMicroFilter').value === 'all', '切换计划后周期筛选重置到新计划');
  const futureFrom = T.U.addDays(T.U.today(), 14);
  const futureTo = T.U.addDays(T.U.today(), 21);
  loadView.querySelector('#loadDateFrom').value = futureFrom;
  loadView.querySelector('#loadDateTo').value = futureTo;
  loadView.querySelector('#loadDateFrom').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(loadView.querySelector('.load-metric-grid .load-metric:nth-child(5) .v').textContent.startsWith('0') && loadView.querySelector('.load-metric-grid .load-metric:nth-child(2) .v').textContent.includes('基线积累中'), '纯未来日期范围不冒充今天的训练数据');

  const today = T.U.today();
  const finiteChartOptions = (value, seen = new Set()) => {
    if (typeof value === 'number') return Number.isFinite(value);
    if (!value || typeof value !== 'object' || seen.has(value)) return true;
    seen.add(value);
    return Object.values(value).every((child) => finiteChartOptions(child, seen));
  };
  const noLoadChartStart = window.__chartOptions.length;
  loadView.querySelector('#loadDateFrom').value = today;
  loadView.querySelector('#loadDateTo').value = today;
  loadView.querySelector('#loadDateFrom').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(!loadView.textContent.includes('NaN'), '当天无负荷时界面不显示 NaN');
  assert(window.__chartOptions.slice(noLoadChartStart).every((option) => finiteChartOptions(option)), '当天无负荷时图表配置不包含非有限数');
  T.Store.data.loadEntries.push({ id: T.U.uid('badle'), athleteId: athleteB, date: today, load: 'NaN', duration: 'NaN', sessionId: 'invalid-entry' });
  const invalidChartStart = window.__chartOptions.length;
  T.Views.load.mount(loadView);
  assert(!loadView.textContent.includes('NaN'), '异常历史负荷不会污染指标或图表文字');
  assert(window.__chartOptions.slice(invalidChartStart).every((option) => finiteChartOptions(option)), '异常历史负荷不会传入非有限图表数据');
  T.Store.data.loadEntries = T.Store.data.loadEntries.filter((entry) => entry.sessionId !== 'invalid-entry');

  const completedId = T.U.uid('ses');
  const resistanceExercise = T.Store.data.exercises.find((exercise) => T.Calc.metricOf({ exId: exercise.id }) === 'reps' && T.Calc.loadTypeOf({ exId: exercise.id }) === 'resistance');
  assert(!!resistanceExercise, '存在抗阻动作供逐组与 1RM 测试');
  const complexBlockId = T.U.uid('blk');
  const complexRows = [0, 1].map(() => ({ rid: T.U.uid('row'), exId: resistanceExercise.id, unit: 'kg', sets: 5, reps: 3, weight: 80, pct: null, blkId: complexBlockId }));
  const complexBlock = { id: complexBlockId, label: 'A', sets: 5 };
  const mesoCourse = { name: '复杂训练计划课', rows: T.U.deepClone(complexRows), blocks: [T.U.deepClone(complexBlock)] };
  const completedSession = {
    id: completedId, date: today, name: '即时统计回归课', type: '力量', duration: null,
    time: '09:00', sStatus: 'paused', sElapsed: 60000, sStartDate: null,
    athletes: [athleteB, athleteC], athSrpe: { [athleteC]: 8 },
    rows: T.U.deepClone(mesoCourse.rows), blocks: T.U.deepClone(mesoCourse.blocks),
    results: {}, note: ''
  };
  T.Store.data.sessions.push(completedSession);
  T.Store.alignSessionResults(completedSession);
  const mesoPlanTable = window.document.createElement('div');
  const mesoPlan = T.Store.data.mesos.find((item) => item.id === mesoB);
  mesoPlan.days = [{ date: today, courses: [mesoCourse] }];
  mesoPlanTable.appendChild(T.UI.exerciseTable({ rows: mesoCourse.rows, container: mesoCourse, planMode: true, setEditor: false }));
  assert(!mesoPlanTable.querySelector('.ex-expand') && !mesoPlanTable.querySelector('.ex-add-warm') && !mesoPlanTable.querySelector('.ex-add-work'), '中周期计划不提供逐组编辑入口');
  assert(mesoPlanTable.querySelector('.blk-head')?.textContent.includes('复杂训练 A') && !mesoPlanTable.textContent.includes('超级组'), '中周期组块显示为复杂训练');
  let loadPresentAtSaveNotification = false;
  T.Store.subscribe(() => {
    if (completedSession.sStatus === 'done') {
      loadPresentAtSaveNotification = T.Store.data.loadEntries.some((entry) => entry.sessionId === completedId && entry.athleteId === athleteB);
    }
  });
  T.Views.session.state.date = today;
  T.Views.session.mount(loadView);
  const sessionCard = loadView.querySelector(`[data-ses="${completedId}"]`);
  assert(!sessionCard.querySelector('[data-table] .ex-expand') && !sessionCard.querySelector('[data-table] .ex-add-warm'), '训练课公共计划表不提供逐组编辑入口');
  assert(sessionCard.querySelector('[data-table] .blk-head')?.textContent.includes('复杂训练 A'), '中周期映射后的课程保留复杂训练组块');
  assert(sessionCard.querySelector('.ath-complex-head')?.textContent.includes('复杂训练 A') && sessionCard.querySelector('.ath-complex-head')?.textContent.includes('2 个动作'), '复杂训练分组映射到个人训练计划');
  assert(!sessionCard.textContent.includes('按计划重量') && !sessionCard.textContent.includes('填实际值可记录'), '个人训练计划不显示计划值提示文案');
  assert(!!sessionCard.querySelector('.athlete-plan-table .athlete-action-col') && !!sessionCard.querySelector('.athlete-plan-table .athlete-action-cell'), '动作名称列使用固定宽度横排样式');
  const athleteExpand = sessionCard.querySelector(`[data-ath-expand="${athleteB}:0"]`);
  assert(!!athleteExpand, '逐组展开入口位于个人训练计划');
  athleteExpand.click();
  assert(sessionCard.querySelectorAll('.sd-log-row').length === 5, '展开时正式组数量默认继承中周期的 5 组');
  const existingSetId = completedSession.results[athleteB][0].setLogs[4].sid;
  completedSession.results[athleteB][0].setLogs[4].w = 79;
  completedSession.results[athleteB][0].setLogs[4].actual = 2;
  completedSession.results[athleteB][0].setLogs[4].own = true;
  sessionCard.querySelector(`[data-ath-id="${athleteB}"].ex-ath-add-warm`).click();
  assert(sessionCard.querySelectorAll('.sd-log-row').length === 6 && !!sessionCard.querySelector(`[data-ath-id="${athleteB}"].ex-ath-add-work`), '添加热身组后面板保持展开且正式组可继续添加');
  assert(completedSession.results[athleteB][0].setLogs.find((log) => log.sid === existingSetId).w === 79, '在前面插入热身组不串移已有实际重量');
  sessionCard.querySelector(`[data-ath-id="${athleteB}"].ex-ath-add-work`).click();
  assert(sessionCard.querySelectorAll('.sd-log-row').length === 7, '添加正式组后面板保持展开并保留全部组');
  sessionCard.querySelector(`[data-ath-set-delete="${athleteB}:0:0"]`).click();
  assert(sessionCard.querySelectorAll('.sd-log-row').length === 6, '删除热身组后其余正式组保留');
  sessionCard.querySelector(`[data-ath-set-delete="${athleteB}:0:5"]`).click();
  assert(sessionCard.querySelectorAll('.sd-log-row').length === 5, '删除单个正式组后其余组保留');
  assert(completedSession.results[athleteB][0].setLogs.find((log) => log.sid === existingSetId).w === 79, '删除其他组后已有完成记录仍与原组对应');
  let currentSetDefs = completedSession.results[athleteB][0].setDefs;
  for (let index = currentSetDefs.length - 1; index >= 0; index--) {
    if (currentSetDefs[index].sid === existingSetId) continue;
    sessionCard.querySelector(`[data-ath-set-delete="${athleteB}:0:${index}"]`).click();
    currentSetDefs = completedSession.results[athleteB][0].setDefs;
  }
  assert(sessionCard.querySelectorAll('.sd-log-row').length === 1 && sessionCard.querySelector('.ath-set-delete').disabled, '保留最后一组正式组且禁用其删除按钮');
  const survivingSetIndex = completedSession.results[athleteB][0].setDefs.findIndex((set) => set.sid === existingSetId);
  let logWeight = sessionCard.querySelector(`[data-sl="${athleteB}:0:${survivingSetIndex}"][data-slf="w"]`);
  logWeight.value = '82'; logWeight.dispatchEvent(new window.Event('change', { bubbles: true }));
  let logActual = sessionCard.querySelector(`[data-sl="${athleteB}:0:${survivingSetIndex}"][data-slf="actual"]`);
  logActual.value = '3'; logActual.dispatchEvent(new window.Event('change', { bubbles: true }));
  const updateRm = sessionCard.querySelector(`[data-uprm="${athleteB}:0"]`);
  assert(!!updateRm, '完成正式组实际数据后出现更新1RM按钮');
  updateRm.click();
  assert(!!T.Store.athRm(athleteB, resistanceExercise.id), '更新1RM按钮写入该运动员的专属1RM');
  sessionCard.querySelector('[data-act="toggle-live"]').click();
  const saveCompletion = window.document.querySelector('.overlay [data-save]');
  assert(!!saveCompletion, '完课确认弹窗打开');
  saveCompletion.click();
  const savedLoad = T.Store.data.loadEntries.find((entry) => entry.sessionId === completedId && entry.athleteId === athleteB);
  const explicitSavedLoad = T.Store.data.loadEntries.find((entry) => entry.sessionId === completedId && entry.athleteId === athleteC);
  assert(completedSession.sStatus === 'done' && !!savedLoad && savedLoad.load === 6 && !!explicitSavedLoad && explicitSavedLoad.load === 8, '完课后立即为每名参训者生成 AU 负荷（默认与个人 sRPE）');
  assert(loadPresentAtSaveNotification, '负荷记录先于 Store 保存通知写入');
  const persistedDB = JSON.parse(window.localStorage.getItem('tpdb'));
  assert(persistedDB.loadEntries.some((entry) => entry.sessionId === completedId && entry.load === 6) && persistedDB.loadEntries.some((entry) => entry.sessionId === completedId && entry.load === 8), '全体参训者负荷记录与训练课状态同次持久化');
  T.Views.load.mount(loadView);
  loadView.querySelector('#loadDateFrom').value = today;
  loadView.querySelector('#loadDateTo').value = today;
  loadView.querySelector('#loadDateFrom').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(loadView.querySelector('.load-metric-grid .load-metric:first-child .v').textContent.startsWith('6'), '完课后进入负荷看板立即看到当日 AU');
  assert(loadView.querySelector('.load-metric-grid .load-metric:nth-child(5) .v').textContent.startsWith('1'), '完课后立即计入当日训练课次');
  loadView.querySelector('#modeTeam').click();
  assert(loadView.querySelector('.load-metric-grid .load-metric:first-child .v').textContent.startsWith('14'), '团队模式汇总所有当前计划参训者 AU');

  // 退出示例：空白库载入 → 退出 → 回到空白库
  T.Store.data = T.Store.defaultDB();
  T.Store.data.categories1 = T.Store.seedCategories();
  T.Store.data.exercises = T.Store.seedExercises();
  T.Store.data.goals = T.Store.defaultGoals();
  T.seedDemo();
  assert(!!T.Store.data.settings.demo && T.Store.data.settings.demo.athleteIds.length === 15, '载入示例后记录示例清单（15 名运动员）');
  window.exitDemo();
  const dd = T.Store.data;
  assert(dd.macros.length === 0 && dd.mesos.length === 0 && dd.micros.length === 0, '退出示例后计划/中周期/小周期清空');
  assert(dd.sessions.length === 0 && dd.loadEntries.length === 0, '退出示例后训练课与负荷记录清空');
  assert(dd.profiles.length === 0 && dd.tests.length === 0 && dd.athletes.length === 0, '退出示例后测试档案与示例运动员清空');
  assert(Object.keys(dd.athleteRm).length === 0, '退出示例后示例运动员 1RM 清空');
  assert(!dd.exercises.some((e) => e.cat1 === '篮球专项') && !dd.categories1.some((c) => c.name === '篮球专项'), '退出示例后篮球专项动作与分类移除');
  assert(!dd.settings.demo && dd.settings.activeMacroId === null, '退出示例后清除示例标记并复位当前计划');

  // 合并式载入：用户先有自己的计划 → 载入示例不覆盖 → 退出示例后用户数据完整保留并切回
  dd.macros.push({ id: 'mac_u', name: '用户自建计划', sportCat: '球类·小球', sport: '羽毛球', startDate: '2026-09-01', endDate: '2027-06-30', cycles: [], compDates: [], testDates: [], weekPlan: {}, goalBlocks: [], athletes: [] });
  dd.mesos.push({ id: 'mes_u', macroId: 'mac_u', name: '用户中周期', type: '积累', startDate: '2026-09-07', endDate: '2026-10-04', goals: { primary: [], secondary: [] }, days: [] });
  dd.athletes.push({ id: 'ath_u', macroId: 'mac_u', name: '张三', sport: '羽毛球', gender: '男', birth: '2000-01-01', note: '' });
  dd.settings.activeMacroId = 'mac_u';
  T.seedDemo();
  assert(dd.macros.length === 2 && dd.macros.some((m) => m.id === 'mac_u') && dd.settings.activeMacroId === dd.settings.demo.macroId, '载入示例不覆盖用户计划，且切到示例计划');
  assert(dd.athletes.some((a) => a.id === 'ath_u') && dd.mesos.some((m) => m.id === 'mes_u'), '载入示例保留用户运动员与中周期');
  assert(T.seedDemo() === false, '示例已载入时重复载入不生效');
  window.exitDemo();
  assert(dd.macros.length === 1 && dd.macros[0].id === 'mac_u' && dd.mesos.length === 1 && dd.athletes.length === 1, '退出示例后用户计划/中周期/运动员完整保留');
  assert(dd.settings.activeMacroId === 'mac_u' && !dd.settings.demo, '退出示例后切回用户载入前的计划');

  console.log(errors.length ? '\n== 有失败项 ==' : '\n== 全部通过 ==');
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH:', e); process.exit(2); });
