// 国际化模块：简体中文（默认）/ 繁体中文（台灣用語）/ English
// 策略：
//  · zh-CN 不做任何转换；
//  · zh-TW 先做台灣惯用詞替换（資料/匯入/儲存…），再做「简→繁」逐字映射（字表只收录本应用实际用到的字）；
//  · en 使用「短语+词」最长匹配词典做全局替换，数字/日期/量词通过正则模式规整；用户数据（姓名/计划名/动作名等）
//    不在词典中则保持原文，与数字一样不被翻译。
// 渲染接入：app.js 每次视图 mount 后 apply(view)，UI.modal/toast 自动处理，另用 MutationObserver 兜底动态插入内容。
const I18n = (() => {
  const LOCALES = [
    { id: 'zh-CN', label: '简体中文', short: '简体' },
    { id: 'zh-TW', label: '繁體中文', short: '繁體' },
    { id: 'en', label: 'English', short: 'EN' }
  ];
  let locale = 'zh-CN';
  let applying = false;
  let observed = false;

  // ---------- 繁体：台灣慣用詞（長詞優先，在逐字映射之前执行） ----------
  const TW_WORDS = {
    '数据库': '資料庫', '数据表': '資料表', '数据点': '資料點', '数据概况': '資料概況', '数据': '資料',
    '软件': '軟體', '默认': '預設', '信息': '資訊', '视频': '視訊', '网络': '網路', '鼠标': '滑鼠',
    '程序': '程式', '文件夹': '資料夾', '文件': '檔案', '保存': '儲存', '导入': '匯入', '导出': '匯出',
    '撤销': '復原', '恢复': '還原', '加载': '載入', '服务器': '伺服器', '打印': '列印', '搜索': '搜尋',
    '智能': '智慧', '支持': '支援', '账号': '帳號', '设备': '裝置', '本地': '本機', '设置': '設定',
    '内存': '記憶體', '周期': '週期', '周一': '週一', '周二': '週二', '周三': '週三', '周四': '週四',
    '周五': '週五', '周六': '週六', '周日': '週日', '每周': '每週', '本周': '本週', '两周': '兩週',
    '周数': '週數', '周次': '週次', '宽带': '寬頻', '质量': '品質', '教程': '教學', '视频号': '視訊號',
    '这里': '這裡', '哪里': '哪裡', '里面': '裡面',
    '日历': '日曆', '上周': '上週', '下周': '下週',
    '躯干': '軀幹', '格斗': '格鬥', '菜单': '選單', '防御': '防禦',
    '公里': '公里', '厘米': '厘米', '毫米': '毫米', '英里': '英里', '海里': '海里'
  };

  // ---------- 繁体：简→繁逐字映射（仅收录本应用用字中存在异体的字） ----------
  const S2T = {
    动:'動', 训:'訓', 练:'練', 计:'計', 划:'劃', 负:'負', 课:'課', 与:'與', 时:'時', 测:'測',
    周:'週',
    选:'選', 据:'據', 员:'員', 类:'類', 运:'運', 组:'組', 体:'體', 项:'項', 个:'個', 试:'試',
    单:'單', 当:'當', 点:'點', 录:'錄', 后:'後', 间:'間', 无:'無', 复:'複', 记:'記', 该:'該', 内:'內',
    为:'為', 实:'實', 变:'變', 对:'對', 团:'團', 导:'導', 总:'總', 图:'圖', 统:'統', 际:'際',
    义:'義', 页:'頁', 线:'線', 并:'並', 态:'態', 长:'長', 库:'庫', 删:'刪', 择:'擇', 于:'於',
    击:'擊', 显:'顯', 准:'準', 应:'應', 开:'開', 块:'塊', 离:'離', 结:'結', 条:'條', 档:'檔',
    节:'節', 发:'發', 带:'帶', 过:'過', 筛:'篩', 称:'稱', 区:'區', 参:'參', 级:'級', 写:'寫',
    状:'狀', 冲:'衝', 认:'認', 围:'圍', 范:'範', 势:'勢', 调:'調', 仅:'僅', 别:'別', 会:'會',
    进:'進', 盖:'蓋', 吨:'噸', 稳:'穩', 关:'關', 应:'應', 续:'續', 户:'戶', 较:'較', 说:'說',
    适:'適', 议:'議', 侧:'側', 战:'戰', 专:'專', 钟:'鐘', 优:'優', 独:'獨', 历:'歷', 顶:'頂',
    热:'熱', 积:'積', 轴:'軸', 达:'達', 属:'屬', 题:'題', 签:'簽', 览:'覽', 构:'構', 风:'風',
    载:'載', 观:'觀', 启:'啟', 联:'聯', 极:'極', 从:'從', 号:'號', 样:'樣', 阶:'階', 减:'減',
    综:'綜', 纲:'綱', 绩:'績', 问:'問', 处:'處', 细:'細', 视:'視', 车:'車', 险:'險', 汇:'匯',
    连:'連', 创:'創', 余:'餘', 迁:'遷', 灵:'靈', 这:'這', 误:'誤', 传:'傳', 篮:'籃', 机:'機',
    证:'證', 规:'規', 韧:'韌', 断:'斷', 铃:'鈴', 栏:'欄', 盘:'盤', 响:'響', 环:'環', 评:'評',
    没:'沒', 读:'讀', 隐:'隱', 种:'種', 决:'決', 伤:'傷', 见:'見', 验:'驗', 层:'層', 卧:'臥',
    销:'銷', 剂:'劑', 报:'報', 悬:'懸', 异:'異', 远:'遠', 横:'橫', 挂:'掛', 举:'舉', 撑:'撐',
    败:'敗', 荐:'薦', 钮:'鈕', 静:'靜', 双:'雙', 给:'給', 声:'聲', 触:'觸', 献:'獻', 绿:'綠',
    绝:'絕', 阈:'閾', 杂:'雜', 蓝:'藍', 松:'鬆', 压:'壓', 继:'繼', 几:'幾', 红:'紅', 仪:'儀',
    储:'儲', 药:'藥', 跃:'躍', 齐:'齊', 经:'經', 鲜:'鮮', 础:'礎', 边:'邊', 须:'須', 况:'況',
    马:'馬', 掷:'擲', 场:'場', 论:'論', 宽:'寬', 纳:'納', 还:'還', 详:'詳', 杆:'桿', 滚:'滾',
    纯:'純', 锋:'鋒', 渐:'漸', 顺:'順', 拟:'擬', 颜:'顏', 权:'權', 错:'錯', 损:'損', 画:'畫',
    维:'維', 么:'麼', 网:'網', 浏:'瀏', 浅:'淺', 奥:'奧', 竞:'競', 抛:'拋', 务:'務', 约:'約',
    闭:'閉', 话:'話', 骤:'驟', 质:'質', 扩:'擴', 频:'頻', 营:'營', 养:'養', 躯:'軀', 终:'終',
    轮:'輪', 递:'遞', 绳:'繩', 国:'國', 飞:'飛', 监:'監', 产:'產', 码:'碼', 针:'針', 电:'電',
    语:'語', 残:'殘', 键:'鍵', 颈:'頸', 亚:'亞', 卫:'衛', 桥:'橋', 严:'嚴', 绘:'繪', 绑:'綁',
    阵:'陣', 辅:'輔', 虚:'虛', 谁:'誰', 让:'讓', 紧:'緊', 概:'概', 馆:'館', 简:'簡', 缩:'縮',
    学:'學', 贴:'貼', 净:'淨', 检:'檢', 觉:'覺', 轻:'輕', 缓:'緩', 锁:'鎖', 圆:'圓', 驱:'驅',
    织:'織', 铁:'鐵', 閱:'閱', 执:'執', 墙:'牆', 询:'詢', 释:'釋', 闪:'閃', 烁:'爍', 张:'張',
    黄:'黃', 晕:'暈', 冻:'凍', 装:'裝', 夹:'夾', 價:'價', 价:'價', 陈:'陳', 护:'護', 儿:'兒',
    枪:'槍', 链:'鏈', 龙:'龍', 伞:'傘', 逦:'邐', 弯:'彎', 遗:'遺', 们:'們', 业:'業', 坏:'壞',
    尽:'盡', 乱:'亂', 众:'眾', 龄:'齡', 垒:'壘', 艺:'藝', 壮:'壯', 汉:'漢', 潜:'潛', 钢:'鋼',
    欧:'歐', 壶:'壺', 蹼:'蹼', 职:'職', 尝:'嘗', 领:'領', 缝:'縫', 衔:'銜', 夸:'誇', 诉:'訴',
    懂:'懂', 扭:'扭', 辨:'辨', 抚:'撫', 抚:'撫', 仅:'僅', 办:'辦', 赃:'贓', 资:'資', 馈:'饋',
    剔:'剔', 竖:'豎', 榄:'欖', 鳔:'鰾', 鸢:'鳶', 鹦:'鸚', 鹉:'鵡', 鸽:'鴿', 鸥:'鷗', 鹊:'鵲',
    鹏:'鵬', 鸡:'雞', 难:'難', 雕:'雕', 雾:'霧', 鸡:'雞', 缘:'緣', 绑:'綁', 缠:'纏', 县:'縣',
    丰:'豐', 贯:'貫', 钻:'鑽', 摄:'攝', 脏:'髒', 拦:'攔', 却:'卻', 笔:'筆', 挑:'挑', 搬:'搬',
    呜:'嗚', 厅:'廳', 历:'歷', 归:'歸', 泽:'澤', 济:'濟', 涛:'濤', 涨:'漲', 涵:'涵', 淦:'淦',
    沐:'沐', 汇:'匯', 汉:'漢', 冯:'馮', 赵:'趙', 吴:'吳', 孙:'孫', 郑:'鄭', 韩:'韓', 旭:'旭',
    杨:'楊', 凯:'凱', 刘:'劉', 伟:'偉', 军:'軍', 刚:'剛', 强:'強', 磊:'磊', 涛:'濤', 斌:'斌',
    杰:'傑', 帆:'帆', 罗:'羅', 斯:'斯', 帕:'帕', 尼:'尼', 河:'河', 州:'州', 迪:'迪', 壁:'壁',
    尔:'爾', 街:'街', 搏:'搏', 古:'古', 气:'氣', 域:'域', 筝:'箏', 溪:'溪', 探:'探', 徒:'徒',
    蹈:'蹈', 想:'想', 牌:'牌', 糖:'糖', 酵:'酵', 筋:'筋', 膜:'膜', 姿:'姿', 永:'永', 绕:'繞',
    曾:'曾', 衰:'衰', 符:'符', 尺:'尺', 品:'品', 焦:'焦', 洗:'洗', 冒:'冒', 烟:'煙', 缀:'綴',
    摸:'摸', 千:'千', 逆:'逆', 乎:'乎', 家:'家', 协:'協', 师:'師', 唯:'唯', 偿:'償', 疼:'疼',
    痛:'痛', 岁:'歲', 委:'委', 候:'候', 偶:'偶', 薄:'薄', 挥:'揮', 临:'臨', 睡:'睡', 眠:'眠',
    槛:'檻', 够:'夠', 逻:'邏', 疑:'疑', 帮:'幫', 虑:'慮', 材:'材', 惯:'慣', 肉:'肉', 禁:'禁',
    陷:'陷', 聚:'聚', 乏:'乏', 征:'征', 绍:'紹', 髋:'髖', 乳:'乳', 酸:'酸', 膝:'膝', 副:'副',
    荧:'熒', 扫:'掃', 获:'獲', 夜:'夜', 墨:'墨', 柠:'檸', 炼:'煉', 匿:'匿', 壳:'殼', 菜:'菜',
    破:'破', 习:'習', 演:'演', 杭:'杭', 京:'京', 官:'官', 揭:'揭', 幕:'幕', 广:'廣', 王:'王',
    钩:'鉤', 争:'爭', 俊:'俊', 轩:'軒', 翼:'翼', 封:'封', 腰:'腰', 旗:'旗', 袋:'袋', 挡:'擋', 藤:'藤', 浮:'浮',
    德:'德', 躲:'躲', 乒:'乒', 乓:'乓', 羽:'羽', 毛:'毛', 棒:'棒', 槌:'槌', 竿:'竿', 铅:'鉛',
    床:'床', 酷:'酷', 跆:'跆', 剑:'劍', 泰:'泰', 踢:'踢', 西:'西', 桑:'桑', 扑:'撲', 桨:'槳',
    舟:'舟', 砾:'礫', 橇:'橇', 岩:'岩', 溯:'溯', 洞:'洞', 穴:'穴', 杖:'杖', 碟:'碟', 镖:'鏢',
    爵:'爵', 芭:'芭', 蕾:'蕾', 瑜:'瑜', 伽:'伽', 念:'念', 冥:'冥', 武:'武', 狮:'獅', 毽:'毽',
    珍:'珍', 珠:'珠', 抢:'搶', 炮:'炮', 陀:'陀', 螺:'螺', 弩:'弩', 智:'智', 钓:'釣', 竹:'竹',
    听:'聽', 膳:'膳', 嵌:'嵌', 臀:'臀', 踵:'踵', 抓:'抓', 蹬:'蹬', 膈:'膈', 治:'治', 愈:'愈',
    弃:'棄', 擎:'擎', 奔:'奔', 甚:'甚', 寸:'寸', 居:'居', 席:'席', 剥:'剝', 稍:'稍', 別:'別',
    叫:'叫', 涉:'涉', 敢:'敢', 簿:'簿', 瑰:'瑰', 醒:'醒', 漏:'漏', 善:'善', 抹:'抹', 拐:'拐',
    味:'味', 巨:'巨', 令:'令', 扬:'揚', 阀:'閥', 凭:'憑', 掩:'掩', 假:'假', 牢:'牢', 熟:'熟',
    似:'似', 扰:'擾', 赋:'賦', 客:'客', 施:'施', 廓:'廓', 沟:'溝', 罚:'罰', 勤:'勤', 虽:'雖',
    铺:'鋪', 延:'延', 采:'采', 锚:'錨', 钳:'鉗', 毁:'毀', 刊:'刊', 卷:'卷', 饱:'飽', 凹:'凹',
    陡:'陡', 倾:'傾', 阴:'陰', 研:'研', 究:'究', 贡:'貢', 耶:'耶', 彼:'彼', 扎:'扎', 爱:'愛',
    漫:'漫', 英:'英', 轭:'軛', 富:'富', 希:'希', 望:'望', 缔:'締', 秀:'秀', 塌:'塌', 柄:'柄',
    琥:'琥', 珀:'珀', 幂:'冪', 裹:'裹', 草:'草', 稿:'稿', 驻:'駐', 弓:'弓', 锥:'錐', 哥:'哥',
    哈:'哈', 仰:'仰', 血:'血', 褶:'褶', 厚:'厚', 骨:'骨', 骼:'骼', 死:'死', 故:'故', 裂:'裂',
    脱:'脫', 污:'污', 冷:'冷', 抑:'抑', 邃:'邃', 黑:'黑', 淡:'淡', 舒:'舒', 遇:'遇', 树:'樹',
    吗:'嗎', 榄:'欖', 橄:'橄', 棍:'棍', 巴:'巴', 士:'士', 巧:'巧', 软:'軟', 门:'門', 田:'田',
    障:'障', 碍:'礙', 骑:'騎', 皮:'皮', 摩:'摩', 漂:'漂', 攀:'攀', 箭:'箭', 棋:'棋', 垂:'垂',
    允:'允', 许:'許', 沿:'沿', 扁:'扁', 描:'描', 踝:'踝', 哑:'啞', 串:'串', 责:'責', 危:'危',
    厂:'廠', 校:'校', 久:'久', 混:'混', 警:'警', 邻:'鄰', 父:'父', 坐:'坐', 裁:'裁', 剪:'剪',
    服:'服', 厘:'厘', 斤:'斤', 既:'既', 抽:'抽', 满:'滿', 截:'截', 踪:'蹤', 劣:'劣', 玫:'玫',
    句:'句', 圈:'圈', 滤:'濾', 温:'溫', 穿:'穿', 粒:'粒', 梯:'梯', 掌:'掌', 鼠:'鼠', 腘:'膕',
    屈:'屈', 倒:'倒', 暖:'暖', 晰:'晰', 脑:'腦', 青:'青', 访:'訪', 繁:'繁', 赖:'賴', 御:'御',
    伪:'偽', 遍:'遍', 摆:'擺', 竭:'竭', 普:'普', 孤:'孤', 冬:'冬', 民:'民', 蹦:'蹦', 旧:'舊',
    叠:'疊', 仅:'僅', 赚:'賺', 赢:'贏', 赃:'贓', 贼:'賊', 资:'資',
    // —— 语料全量扫描补字 ——
    数:'數', 标:'標', 队:'隊', 赛:'賽', 备:'備', 换:'換', 请:'請', 术:'術',
    现:'現', 编:'編', 辑:'輯', 趋:'趨', 识:'識', 输:'輸', 随:'隨', 则:'則',
    转:'轉', 弹:'彈', 两:'兩', 暂:'暫', 头:'頭', 确:'確', 来:'來', 补:'補',
    劳:'勞', 将:'將', 径:'徑', 预:'預', 纵:'縱', 账:'帳', 册:'冊', 脚:'腳',
    谢:'謝', 谨:'謹', 滩:'灘', 饼:'餅', 订:'訂', 阅:'閱', 凑:'湊', 译:'譯',
    铭:'銘', 摇:'搖', 袭:'襲', 着:'著', 莱:'萊', 里:'裡'
  };

  // ---------- English 词典（静态 UI 文案；长词优先） ----------
  const EN = {
    // 导航
    '周期训练计划': 'Periodized Plan', '中周期': 'Mesocycle', '小周期': 'Microcycle',
    '训练课': 'Session', '负荷管理': 'Load Monitoring', '动作库': 'Exercise Library',
    '运动员档案': 'Athletes', 'KPI 分析': 'KPI Analysis', '自定义 KPI 分析': 'Custom KPI Lab',
    '设置': 'Settings',
    '周期总表 · 手动输入 · 负荷与峰值': 'Master table · Manual input · Load & peaks',
    '大周期管理 · 阶段制定 · 动作安排 · 小周期划分': 'Macro management · Phasing · Exercises · Microcycles',
    '周节奏管理 · 类型与强度分布': 'Weekly rhythm · Type & intensity distribution',
    '每日多节课 · sRPE · RIR 估算 1RM': 'Multiple daily sessions · sRPE · RIR-based 1RM',
    'ACWR 仪表盘 · 个人/团队负荷看板': 'ACWR dashboard · Individual/team load boards',
    '两级分类 · 动作管理': 'Two-level categories · Exercise management',
    '基本信息 · 统一体能数据源 · 1RM': 'Profile · Unified fitness data · 1RM',
    'KPI 看板 · 雷达 · FMS · 时期对比 · 团队排名': 'KPI boards · Radar · FMS · Phase compare · Team ranking',
    '外观背景 · 数据备份 · 使用手册 · 项目库 · 关于': 'Appearance · Backup · User guide · Item library · About',
    // 通用动作
    '新建训练计划': 'New Plan', '编辑训练计划': 'Edit Plan', '删除训练计划': 'Delete Plan',
    '新建中周期': 'New Mesocycle', '添加运动员': 'Add Athlete', '编辑运动员': 'Edit Athlete',
    '添加测试项目': 'Add Test Item', '管理测试项目库': 'Manage Test Item Library',
    '新建运动员': 'New Athlete', '导入体能测试': 'Import Test Data', '导入 Excel 测试表': 'Import Excel Test File',
    '导入体能测试数据': 'Import Fitness Test Data', '已建档': 'Profile',
    '上传头像': 'Upload Photo', '更换': 'Change', '移除': 'Remove', '头像': 'Photo',
    '保存': 'Save', '已保存': 'Saved', '保存成功': 'Saved', '操作成功': 'Done', '删除失败': 'Delete failed',
    '无数据': 'No Data', '取消': 'Cancel', '确认操作': 'Please Confirm', '确认': 'Confirm',
    '关闭': 'Close', '删除': 'Delete', '编辑': 'Edit', '添加': 'Add', '新增': 'Add New',
    '导入': 'Import', '导出': 'Export', '撤销': 'Undo', '恢复': 'Restore', '清空': 'Clear',
    '复制': 'Copy', '复制训练计划': 'Copy Plan', '搜索': 'Search', '全选': 'Select All',
    '清空选择': 'Clear', '全部': 'All', '返回': 'Back', '确定': 'OK', '应用': 'Apply',
    '下一步': 'Next', '上一步': 'Back', '完成': 'Done', '是': 'Yes', '否': 'No',
    '姓名': 'Name', '姓名 *': 'Name *', '请输入姓名': 'Enter name', '请填写姓名': 'Name is required',
    '性别': 'Gender', '男': 'Male', '女': 'Female', '出生日期': 'Birth Date',
    '位置': 'Position', '备注': 'Notes', '运动员': 'Athlete', '运动队': 'Team',
    '全部位置': 'All Positions', '未设置': 'Unassigned', '请选择': 'Select', '— 请选择 —': '— Select —',
    '自定义位置': 'Custom Position', '如：第六人 / 双能卫': 'e.g. Sixth Man / Combo Guard',
    '年龄': 'Age', '身高': 'Height', '体重': 'Body Weight',
    '开始日期': 'Start Date', '结束日期': 'End Date', '日期': 'Date', '日期范围': 'Date Range',
    '时间': 'Time', '计划名称': 'Plan Name', '项目分类': 'Category', '具体项目': 'Sport',
    '周期模型参考（供规划时参考，不自动生成）': 'Periodization models (reference only; nothing is auto-generated)',
    '类型': 'Type', '状态': 'Status', '单位': 'Unit', '数值': 'Value', '项目': 'Item',
    '动作': 'Exercise', '组数': 'Sets', '次数': 'Reps', '重量': 'Weight', '总负荷': 'Total Load',
    '负荷': 'Load', '强度': 'Intensity', '训练': 'Training', '计划': 'Plan', '目标': 'Target',
    '实际': 'Actual', '完成': 'Completed', '正式组': 'Work Sets', '热身组': 'Warm-up Sets',
    '比赛日': 'Competition Days', '测试日': 'Test Days', '比赛': 'Competition', '测试': 'Test',
    '中周期': 'Mesocycle', '大周期': 'Macrocycle', '周期': 'Period', '周期总表': 'Master Table',
    '当前训练计划': 'Current Plan', '我的计划': 'My Plans', '套用运动员': 'Assign Athletes',
    '调整名单': 'Roster', '比赛': 'Competition', '训练目标': 'Training Goals',
    '今日': 'Today', '暂无数据': 'No data yet', '加载中': 'Loading', '加载中…': 'Loading…',
    '近 90 天': 'Last 90 Days', '近 28 天': 'Last 28 Days', '近 7 天': 'Last 7 Days',
    '留空 = 不限': 'Blank = no limit', '可选范围': 'Available range',
    // 设置页
    '外观': 'Appearance', '数据与备份': 'Data & Backup', '通用': 'General', '使用手册': 'User Guide', '关于': 'About',
    '明暗模式': 'Theme', '深色': 'Dark', '浅色': 'Light',
    '深色适合夜间与弱光环境，浅色适合明亮环境': 'Dark suits dim environments; Light suits bright rooms',
    '背景模式': 'Background', '纯色': 'Solid', '渐变': 'Gradient', '星空': 'Starfield',
    '深邃纯色，专注工作': 'Deep solid color, focus on work',
    '低调双色光晕': 'Subtle dual-tone glow',
    '自然星点缓动': 'Gentle natural starfield',
    '选择应用主界面的背景效果': 'Choose the app background',
    '背景遮罩': 'Dim Layer', '加深遮罩可让文字更清晰（星空 / 渐变模式下生效）': 'Deeper dimming improves text contrast (starfield / gradient)',
    '强调色': 'Accent Color', '用于主按钮、选中态、图表高亮等': 'Used for primary buttons, selection and chart highlights',
    '界面密度': 'Density', '舒适': 'Comfortable', '紧凑': 'Compact',
    '紧凑模式会缩小卡片与表格间距，一屏看到更多内容': 'Compact reduces paddings so more fits on screen',
    '数据概况': 'Overview', '所有数据仅保存在本机，不会上传到任何服务器': 'All data stays on this computer; nothing is uploaded',
    '训练计划': 'Training Plans', '训练课': 'Sessions', '体能档案': 'Fitness Profiles',
    '测试记录': 'Test Records', '数据库大小': 'Database Size',
    '计划数据包': 'Plan Package',
    '把当前计划的全部内容（周期、训练课、运动员、体能数据、动作库）打包导出；在另一台设备导入后直接展示该计划':
      'Packages everything in the current plan (cycles, sessions, athletes, fitness data, exercise library); import it on another device to open the plan directly',
    '将导出该计划的全部相关数据': 'All data belonging to this plan will be exported',
    '请先在周期总表创建或选择一个计划': 'Create or select a plan on the master table first',
    '导出当前计划数据包': 'Export Current Plan Package',
    '导入计划数据包': 'Import Plan Package',
    '导入计划数据包…': 'Import Plan Package…',
    '备份与恢复': 'Backup & Restore', '建议每周或大批量导入前手动备份一次': 'Back up weekly or before bulk imports',
    '自动备份': 'Auto Backup',
    '开启后每天第一次启动自动备份一次，保留最近 7 份': 'Backs up automatically on first launch each day; keeps the latest 7 copies',
    '立即备份': 'Back Up Now', '立即备份到本机': 'Back Up to This Computer',
    '导出备份文件': 'Export Backup File', '打开备份文件夹': 'Open Backup Folder', '恢复备份': 'Restore Backup',
    '危险区': 'Danger Zone', '清空全部数据': 'Erase All Data',
    '清空后将删除所有计划、运动员、训练课与体能数据，且无法恢复，请先导出备份': 'Erases every plan, athlete, session and fitness record with no undo. Export a backup first.',
    '启动页': 'Startup Page', '周期总表': 'Master Table', '上次离开的页面': 'Last Visited Page',
    '每次打开应用先进入周期总表': 'Always open on the master table',
    '每次打开应用回到上次离开的页面': 'Resume on the page you last visited',
    '载入内置示例': 'Load Sample Plan', '退出示例': 'Exit Sample',
    '联系开发者': 'Contact Developer', '版本': 'Version', '语言': 'Language',
    '关于 Sharp Fit': 'About Sharp Fit',
    '体能教练训练计划管理平台 · 本地离线版': 'Strength & conditioning planning platform · Offline local edition',
    '数据存储：仅保存在你的电脑上，不联网、不注册账户、不上传任何服务器。':
      'Data is stored only on this computer — offline, no account, no uploads.',
    // KPI 实验室
    '测试项目': 'Metrics', '分析方法': 'Methods', '生成看板': 'Generate Dashboard',
    '姓名': 'Name', '生成看板（': 'Generate (',
    '导入 Excel 测试表': 'Import Excel Test File', '导出报告': 'Export Report',
    '生成详细文字报告': 'Generate Text Report',
    '开放式体能数据分析 · 选筛选 → 多选方法 → 生成看板，每个方法一个看板，可继续追加':
      'Open fitness data analysis · Pick filters → Select methods → Generate one board per method; keep adding more',
    '点方法名选中，点 ⓘ 查看算法说明；已生成过的方法再次生成会按当前筛选更新看板，不重复弹图型选择':
      'Click a method to select it, ⓘ for the algorithm. Regenerating a method refreshes its board with current filters.',
    '尚无看板——在上方选择分析方法后点击「生成看板」。生成后可继续调整筛选、选择更多方法追加看板。':
      'No boards yet — select methods above and click Generate. You can refine filters and append more boards afterwards.',
    '项目库还是空的，点右侧「＋ 添加测试项目」加入要分析的项目；导入 Excel 时出现的新项目也会自动加入项目库。':
      'The library is empty. Click “+ Add Test Item”, or import an Excel file — new items are added automatically.',
    '基线对比': 'Baseline Delta', '趋势斜率': 'Trend Slope', 'Z 分数': 'Z-Score',
    '百分位排名': 'Percentile Rank', '个人 vs 团队均值': 'Individual vs Team Mean',
    '移动平均 MA(3)': 'Moving Average MA(3)', '变异系数 CV': 'Coefficient of Variation CV',
    'SWC 最小有意义变化': 'SWC Smallest Worthwhile Change', "效应量 Cohen's d": "Effect Size Cohen's d",
    '指标相关性': 'Metric Correlation', '分布分析（箱线图）': 'Distribution (Box Plot)',
    '多指标雷达画像': 'Multi-Metric Radar', '相对值标准化（/体重）': 'Relative Normalization (/BW)',
    '综合排名（Z 求和）': 'Composite Ranking (ΣZ)',
    '柱状图': 'Bar', '条形图': 'Horizontal Bar', '折线图': 'Line', '面积图': 'Area',
    '饼图': 'Pie', '环形图': 'Donut', '玫瑰图': 'Nightingale', '雷达图': 'Radar',
    '散点图': 'Scatter', '箱线图': 'Box Plot', '热力图': 'Heatmap', '仪表盘': 'Gauge',
    '象形柱图': 'Pictorial Bar', '漏斗图': 'Funnel',
    '推荐': 'recommended', '算法': 'Algorithm', '均值': 'Mean', '综合分': 'Composite Score',
    '每周变化': 'Weekly Change', '离群值': 'Outliers',
    // 位置下拉
    '不选默认为全部位置；选择位置后自动选中该位置队员': 'Default = all positions; choosing one auto-selects its athletes',
    // 测试项目名（可能已进入用户测试项目库）
    '最大纵跳（助跑）': 'Max Vertical Jump (running)', '3/4场冲刺': '3/4-Court Sprint',
    'Lane敏捷': 'Lane Agility', 'Pro敏捷（5-10-5）': 'Pro Agility (5-10-5)', '折返跑': 'Shuttle Run',
    // 位置库（英式橄榄球 15 人制 / 美橄特勤组 / 冰球 / 水球 / 袋棍球）
    '支柱': 'Prop', '钩球员': 'Hooker', '锁球员': 'Lock', '侧翼': 'Flanker', '八号位': 'No. 8',
    '传锋': 'Scrum-half', '接锋': 'Fly-half', '内中锋': 'Inside Centre', '外中锋': 'Outside Centre', '殿卫': 'Full-back',
    '踢球手': 'Kicker', '弃踢手': 'Punter', '回攻手': 'Return Specialist', '扶球手': 'Holder', '长发球手': 'Long Snapper',
    '左后卫': 'Left Defenseman', '右后卫': 'Right Defenseman', '中卫': 'Center Defender', '外锋': 'Driver',
    '攻击手': 'Attacker', '长杆中场': 'Long-stick Midfielder', '争球手': 'Face-off Specialist',
    // 训练目标分类与目标（中周期/小周期/课表侧栏）
    '力量训练': 'Strength', '代谢训练': 'Metabolic Conditioning', '技/战术': 'Technique/Tactics',
    '多方向速度': 'Multi-directional Speed', '恢复与再生': 'Recovery & Regeneration',
    '调节训练': 'Conditioning', '柔韧与灵活性': 'Flexibility & Mobility',
    '核心训练': 'Core', '测试与评估': 'Testing & Evaluation', '心理与认知': 'Psychology & Cognition',
    '营养管理': 'Nutrition', '训练量': 'Volume', '训练负荷': 'Training Load', '准备水平': 'Readiness',
    '肌肥大': 'Hypertrophy', '最大力量': 'Max Strength', '爆发力': 'Power', '力量—速度': 'Strength–Speed',
    '速度—力量': 'Speed–Strength', '启动力量': 'Starting Strength', '反应力量': 'Reactive Strength',
    '力量耐力': 'Strength Endurance', '等长力量': 'Isometric Strength', '离心力量': 'Eccentric Strength',
    '动作速度': 'Movement Speed', '核心稳定（抗伸展）': 'Core Stability (Anti-extension)',
    '抗旋转': 'Anti-rotation', '动态核心力量': 'Dynamic Core Strength', '1RM 力量测试': '1RM Strength Test',
    '有氧耐力（LSD）': 'Aerobic Endurance (LSD)', '节奏训练': 'Tempo Training', '有氧间歇': 'Aerobic Intervals',
    '无氧间歇': 'Anaerobic Intervals', '无氧耐力（糖酵解）': 'Anaerobic Endurance (Glycolytic)',
    '有氧功率': 'Aerobic Power', '法特莱克': 'Fartlek', '重复冲刺（RSA）': 'Repeated Sprint (RSA)',
    '循环训练': 'Circuit Training', '体能测试': 'Fitness Testing',
    '专项技术': 'Sport-specific Technique', '战术执行': 'Tactical Execution', '团队配合': 'Team Play',
    '比赛节奏与决策': 'Game Tempo & Decision-making', '位置技术': 'Positional Technique',
    '攻防转换': 'Transition Play', '比赛模拟': 'Game Simulation',
    '启动速度': 'Acceleration Start', '加速能力': 'Acceleration',
    '线性速度（最大速度）': 'Linear Speed (Max Velocity)', '灵敏': 'Agility',
    '变向能力（COD）': 'Change of Direction (COD)', '反应灵敏': 'Reactive Agility',
    '减速与制动': 'Deceleration & Braking', '侧向速度': 'Lateral Speed', '后退速度': 'Backward Speed',
    '跑动技术': 'Running Technique', '速度与灵敏测试': 'Speed & Agility Test',
    '主动恢复': 'Active Recovery', '软组织放松': 'Soft Tissue Release', '呼吸调节': 'Breathing Regulation',
    '动态灵活性': 'Dynamic Mobility', '静态柔韧': 'Static Flexibility', '关节活动度': 'Range of Motion',
    'PNF 拉伸': 'PNF Stretching', '恢复性训练': 'Restorative Training',
    '反应与决策': 'Reaction & Decision-making', '专注力训练': 'Focus Training', '心理韧性': 'Mental Toughness',
    '训练前营养': 'Pre-training Nutrition', '训练中补给': 'In-training Fueling',
    '训练后恢复营养': 'Post-training Recovery Nutrition', '日常膳食管理': 'Daily Diet Management',
    '水化管理': 'Hydration', '体重与体成分管理': 'Weight & Body Composition', '运动补剂管理': 'Supplement Management',
    // 设置 · 外观
    '明暗模式': 'Theme', '深色适合夜间与弱光环境，浅色适合明亮环境': 'Dark for night & low light, light for bright rooms', '深色': 'Dark', '浅色': 'Light',
    '背景模式': 'Background', '选择应用主界面的背景效果': 'Pick the app background effect',
    '深邃纯色，专注工作': 'Deep solid, stay focused', '低调双色光晕': 'Subtle two-color glow', '自然星点缓动': 'Natural slow-drifting stars',
    '背景遮罩': 'Background Dim', '加深遮罩可让文字更清晰（星空 / 渐变模式下生效）': 'Darker dim improves text clarity (starfield / gradient only)',
    '强调色': 'Accent Color', '用于主按钮、选中态、图表高亮等': 'For primary buttons, selected states, chart highlights',
    '荧光绿': 'Volt', '海蓝': 'Ocean', '暖橙': 'Amber', '玫红': 'Rose',
    '界面密度': 'Density', '紧凑模式会缩小卡片与表格间距，一屏看到更多内容': 'Compact shrinks card & table spacing to show more per screen', '舒适': 'Cozy', '紧凑': 'Compact',
    // 设置 · 数据与备份
    '数据概况': 'Data Overview', '所有数据仅保存在本机，不会上传到任何服务器': 'All data stays on this machine — nothing is uploaded',
    '运动员': 'Athletes', '训练课': 'Sessions', '体能档案': 'Profiles', '测试记录': 'Test Records', '数据库大小': 'Database Size',
    '计划数据包': 'Plan Package', '把当前计划的全部内容（周期、训练课、运动员、体能数据、动作库）打包导出；在另一台设备导入后直接展示该计划': 'Export everything of the current plan (periods, sessions, athletes, test data, exercise library); import on another device to restore it',
    '当前计划': 'Current Plan', '将导出该计划的全部相关数据': 'All data of this plan will be exported', '请先在周期总表创建或选择一个计划': 'Create or select a plan first',
    '导出当前计划数据包': 'Export Plan Package', '导入计划数据包…': 'Import Plan Package…',
    '备份与恢复': 'Backup & Restore', '建议每周或大批量导入前手动备份一次': 'Back up weekly or before big imports',
    '自动备份': 'Auto Backup', '开启后每次启动应用自动备份（每天最多一份，保留最近 7 份）': 'Backs up on every app launch (one per day, keeps the latest 7)',
    '立即备份到本机': 'Back Up Now', '导出备份文件': 'Export Backup File', '打开备份文件夹': 'Open Backup Folder', '恢复备份…': 'Restore Backup…',
    '危险区': 'Danger Zone', '不可逆操作，请谨慎': 'Irreversible actions — be careful',
    '删除全部计划、运动员、档案、训练课与设置，恢复到出厂空白状态。': 'Deletes all plans, athletes, profiles, sessions and settings; resets to factory-blank state.',
    '操作前请先「导出备份文件」。': 'Export a backup file first.',
    '导出失败：未找到当前计划': 'Export failed: no current plan', '已取消导出': 'Export canceled', '计划数据包已保存到：': 'Plan package saved to: ', '计划数据包已导出': 'Plan package exported', '导出失败：': 'Export failed: ', '已触发浏览器下载': 'Browser download triggered',
    '已开启自动备份': 'Auto backup on', '已关闭自动备份': 'Auto backup off',
    '当前环境不支持本机备份，请用「导出备份文件」': 'Local backup not supported here; use "Export Backup File"',
    '已备份到：': 'Backed up to: ', '备份失败：': 'Backup failed: ', '未知错误': 'unknown error', '备份完成': 'Backup done',
    '备份文件已保存到：': 'Backup file saved to: ', '备份文件已导出': 'Backup file exported',
    '当前环境不支持打开文件夹': 'Opening folders not supported here', '数据包无效': 'Invalid package',
    '数据包 ': 'Package ', ' 将作为新的独立计划导入，不会影响你已有的数据。': ' will be imported as a new standalone plan — your existing data is untouched.',
    '包内内容：': 'Contents: ', ' 个计划 · ': ' plans · ', ' 个中周期 · ': ' mesocycles · ', ' 个小周期 · ': ' microcycles · ', ' 节训练课 · ': ' sessions · ', ' 名运动员 · ': ' athletes · ', ' 份体能档案 · ': ' profiles · ', ' 条测试记录。': ' test records.',
    '导入后将自动切换到该计划并刷新页面。': 'The app will switch to this plan afterwards.',
    '确认导入': 'Import', '导入失败': 'Import failed', '已导入': 'imported',
    '恢复备份': 'Restore Backup', '将用备份文件': 'The backup file will ', '整体替换': 'fully replace', '当前全部数据，当前数据会被覆盖。': ' all current data — it will be overwritten.',
    '备份内容：': 'Contents: ', '建议恢复前先「导出备份文件」保留当前数据。': 'Export a backup first to keep current data.',
    '确认恢复并重启': 'Restore & Restart', '备份已恢复，正在重启…': 'Backup restored, restarting…',
    '文件不是有效的备份（JSON 解析失败）': 'Not a valid backup (JSON parse failed)', '文件内容不是 Sharp Fit 备份数据': 'Not Sharp Fit backup data',
    '此操作不可撤销！': 'This cannot be undone!', '全部计划、运动员、体能档案、训练课与外观设置都将被删除。': 'All plans, athletes, profiles, sessions and appearance settings will be deleted.',
    '请在下方输入 ': 'Type ', ' 两个字以确认：': ' below to confirm:', '确认清空并重启': 'Wipe & Restart', '已清空全部数据，正在重启…': 'All data cleared, restarting…',
    // 设置 · 通用 / 关于
    '语言': 'Language', '简体中文 · 繁體中文 · English（切换立即生效，无需刷新；你的数据内容不翻译）': 'Simplified · Traditional · English (applies instantly, no reload; your own data stays untranslated)',
    '启动': 'Startup', '应用打开后默认显示的页面': 'The page shown when the app opens', '启动页面': 'Start Page', '可固定为周期总表，或记住上次离开时的页面': 'Pin to the Master Sheet or remember the last page', '上次页面': 'Last Page',
    '体能测试项目库': 'Test Item Library', '决定档案录入与 KPI 分析中可选的测试项目；Excel 导入遇到的新项目也会自动加入': 'Controls the test items available in profiles & KPI analysis; new items from Excel imports are added automatically',
    '管理测试项目库': 'Manage Test Library', '当前已添加 ': 'Currently ', ' 项': ' items',
    '示例数据': 'Sample Data', '内置一套完整的篮球队备战计划用于体验功能，不会与你的数据混在一起': 'A full built-in basketball team plan for exploring — never mixes with your data',
    '退出并移除示例': 'Remove Sample', '载入内置示例': 'Load Sample', '示例当前已载入，退出后示例数据将被精确移除，你的数据保留': 'Sample loaded; removing it deletes only sample data', '10 个月 · 2 个大周期 · 15 名运动员 · 训练课与体能测试': '10 months · 2 macrocycles · 15 athletes · sessions & tests',
    '已保存': 'Saved',
    '将退出并清除内置示例（示例计划、训练课、负荷、测试与示例运动员）。你自行添加的数据会保留。是否继续？': 'Remove the built-in sample (sample plan, sessions, loads, tests and sample athletes)? Your own data is kept. Continue?',
    '已退出示例': 'Sample removed', '将载入内置示例「XX篮球队备战计划」，不会覆盖你已有的计划与数据。是否继续？': 'Load the built-in sample basketball plan? Your existing plans and data are untouched. Continue?', '示例已载入': 'Sample loaded',
    '关于 Sharp Fit': 'About Sharp Fit', '体能教练训练计划管理平台 · 本地离线版': 'Training-plan platform for S&C coaches · local offline edition',
    '版本：': 'Version: ', '读取中…': 'loading…', '数据存储：仅保存在你的电脑上，不联网、不注册账户、不上传任何服务器。': 'Storage: on this computer only — no network, no account, no server.',
    '联系开发者': 'Contact Developer', '扫码添加开发者好友': 'Scan to add the developer', '问题反馈、功能建议、新版本安装包均可通过好友获取': 'Feedback, suggestions and new builds via the contact', '关闭': 'Close',
    '新版本安装包、使用问题与功能建议，均可扫码或添加开发者好友获取；换机时用「计划数据包」或「导出备份文件 / 恢复备份」迁移全部数据。': 'For new builds, issues and suggestions, scan the QR or add the developer; when switching machines, migrate with "Plan Package" or "Export / Restore Backup".',
    'v1.0（浏览器预览）': 'v1.0 (browser preview)',
    // 设置 · 使用手册
    'Sharp Fit 使用手册': 'Sharp Fit User Guide', '从零开始排出一份完整训练计划，只需要下面「快速上手」的 6 步；每个功能的详细说明在对应章节里，点击标题即可展开。': 'Build a complete training plan from scratch with the 6 steps below; each feature is explained in its chapter — click a title to expand.',
    '快速上手：6 步排出第一份计划': 'Quick Start: First Plan in 6 Steps', '第一次使用从这里开始，全程约 10 分钟': 'Start here on first use — about 10 minutes total',
    '① 创建计划': '① Create a plan', '② 建大周期阶段': '② Build macro phases', '③ 排训练内容': '③ Fill in training', '④ 添加运动员': '④ Add athletes', '⑤ 录体能数据': '⑤ Enter test data', '⑥ 查看分析': '⑥ Review analytics',
    '：进入 ': ': open ',
    '，点击右上角「新建训练计划」，填写名称、运动项目、开始与结束日期。计划是所有数据的容器，先有计划才能排课。': ', click "New Plan" top-right, and fill in name, sport, and start/end dates. A plan is the container for all data — schedule sessions inside one.',
    ' 页面顶部设定比赛日与测试日；再到 ': ' — set competition & test dates at the top; then in ',
    ' 点击「新建中周期」，为每个阶段（如准备期、力量期、赛前减量）划分日期范围与训练目标。': ', click "New Mesocycle" and set date ranges and goals for each phase (preparation, strength, taper…).',
    ' 选中某个日期，在下方课表中「添加动作」——从动作库选择动作、填 %1RM 强度、组数与次数。左侧日滑块可整体调节当天强度。': ', pick a date and "Add Exercise" in the session editor — choose from the library, set %1RM, sets and reps. The day slider adjusts that day\u2019s intensity.',
    '，点击「新建运动员」填写姓名、位置、性别等；回到 01 页点「套用运动员」把整个队伍挂到计划上。': ', click "New Athlete" for name, position, sex, etc.; back on page 01 use "Apply Athletes" to attach the squad.',
    ' 给运动员「添加体能数据」（纵跳、冲刺、1RM 测定等），也可以用「导入体能测试」直接选 Excel 文件，系统自动识别格式入库。': ' to add test data (jump, sprint, 1RM, etc.), or use "Import Tests" to pick Excel files — layouts are auto-detected.',
    '：训练后到 ': ': after training, log completion & RPE in ', ' 登记完成情况与 RPE，然后到 ': ', then check load curves & ACWR in ', ' 看负荷曲线与 ACWR，到 ': ', and fitness trends & team rankings in ', ' 看体能变化与团队排名。': '.',
    '01 周期训练计划 · 总览与总表': '01 Annual Plan · Overview & Master Sheet', '计划的创建、比赛日、周期总表的操作': 'Creating plans, competition days, master sheet operations',
    '02 中周期 · 阶段与课表': '02 Mesocycle · Phases & Sessions', '排课的核心页面：阶段划分、强度滑块、动作安排': 'The core scheduling page: phases, intensity sliders, exercises',
    '03 小周期 · 周节奏': '03 Microcycle · Weekly Rhythm', '周内类型与强度分布的微调': 'Fine-tuning weekly type & intensity distribution',
    '04 训练课 · 执行与记录': '04 Sessions · Execution & Logging', '每日排课、结果登记、sRPE 主观负荷': 'Daily scheduling, results, sRPE load',
    '05 负荷管理 · 监控看板': '05 Load Management · Dashboards', 'ACWR、个人/团队负荷曲线': 'ACWR, individual & team load curves',
    '06 动作库 · 训练动作管理': '06 Exercise Library', '两级分类、自定义动作': 'Two-level categories, custom exercises',
    '07 运动员档案 · 建档与体能数据': '07 Athletes · Profiles & Test Data', '建档、体能录入、Excel 自动导入与撤销': 'Profiles, test entry, one-click Excel import & undo',
    '08 KPI 分析 · 体能看板': '08 KPI Analysis · Fitness Dashboards', '雷达图、时期对比、团队排名与 KPI 实验室': 'Radars, phase comparisons, team rankings & KPI Lab',
    '09 设置 · 外观与偏好': '09 Settings · Appearance & Preferences', '明暗模式、背景、强调色、密度、启动页': 'Theme, background, accent, density, start page',
    '数据安全与换机迁移': 'Data Safety & Migration', '备份、计划数据包、清空的正确用法': 'Backup, plan packages, and safe wiping',
    '常见问题': 'FAQ', '导入识别、数据覆盖、示例数据': 'Import detection, overwriting, sample data',
    '这个页面做什么': 'What this page does',
    '管理你的训练计划（一个大周期），并用「周期总表」以月历形式总览全年安排：哪天有课、哪天比赛、哪天测试、当前处于哪个中周期。': 'Manage your plan (a macrocycle) and see the whole year on the monthly "Master Sheet": sessions, competitions, tests and the current mesocycle.',
    '创建与切换计划': 'Create & Switch Plans',
    '右上角「新建训练计划」：填名称、运动大类、专项、开始/结束日期。': '"New Plan" top-right: fill in name, sport category, discipline, start/end dates.',
    '顶部下拉可随时切换当前编辑的计划；「删除训练计划」会连同该计划下的中周期、课表与运动员档案一起删除（不可恢复，建议先导出计划数据包）。': 'Switch plans from the top dropdown anytime; "Delete Plan" also removes its mesocycles, sessions and athlete profiles (irreversible — export a plan package first).',
    '切换计划后，其他页面（中周期、训练课、档案、KPI）都只显示当前计划的数据。': 'After switching, other pages (mesocycle, sessions, profiles, KPI) show only the current plan\u2019s data.',
    '比赛日与测试日': 'Competition & Test Days',
    '「添加比赛日」：填日期、名称、地点。比赛日会在总表和日历上标红，负荷管理会自动倒推减量建议。': '"Add Competition Day": date, name, venue. Competition days turn red on the sheet & calendar; load management auto-suggests tapering.',
    '「添加测试日」：规划体能测试的时间点，KPI 分析可按测试日期对比成绩变化。': '"Add Test Day": schedule test sessions; KPI analysis compares results across test dates.',
    '总表按月分列，行依次是日期（周几）、周数、序号、大周期、中周期、测试、训练目标等分类行。': 'The sheet is split by month; rows are date (weekday), week number, index, macrocycle, mesocycle, tests and training-goal categories.',
    '顶部工具条可「添加分类」（如恢复、营养）与「隐藏分类」；按类别显示/隐藏、点击「隐藏大分类」可折叠整块。': 'The top toolbar adds categories (e.g. recovery, nutrition) and hides them; click "Hide Category" to collapse a block.',
    '点击总表中的任意日期可跳到该日的安排；中周期行显示各阶段色块，直接反映阶段划分是否合理。': 'Click any date to jump to that day\u2019s schedule; mesocycle rows show phase blocks, making the phasing easy to judge.',
    '把大周期拆成 4~8 周的中周期（阶段），并为每个阶段中的每一天排训练内容。': 'Split the macrocycle into 4–8 week mesocycles (phases) and schedule every day\u2019s training.',
    '新建中周期': 'New Mesocycle',
    '点击「新建中周期」，填名称（如 M1·准备期）、类型（积累/强化/转化/峰值/恢复）、起止日期。': 'Click "New Mesocycle", fill in name (e.g. M1 · Preparation), type (accumulation/intensification/transformation/peak/recovery) and date range.',
    '系统自动按周切分出日卡片条；每个日期卡片上有一个 ': 'Days are split into cards by week automatically; each date card has an ',
    '强度滑块': 'intensity slider',
    '，表示当天动作默认 %1RM，拖动即整体调节，单节课内仍可单独改。': ' for that day\u2019s default %1RM — drag to adjust globally; per-session overrides remain possible.',
    '点击某日卡片，下方进入该日的课表编辑。': 'Click a date card to edit that day\u2019s session below.',
    '编排课表': 'Editing Sessions',
    '「添加动作」：从动作库选动作，设置单位（kg/秒/次等）、%1RM、组数、单组量；系统自动算总负荷。': '"Add Exercise": pick from the library, set unit (kg/s/reps), %1RM, sets and per-set volume; total load is computed automatically.',
    '同一行可添加 2 个以上动作组成': 'Add 2+ exercises on one row to form a ', '超级组/复合组': 'superset/compound set', '（循环组），组内动作轮流完成。': ' (circuit) — exercises alternate within the group.',
    '「清空当日」一键清除该日全部课表；右上角可切换「按周查看」。': '"Clear Day" wipes that day\u2019s schedule; toggle "Week View" top-right.',
    '课表中的动作使用 %1RM 时，会按每名运动员自己的测定 1RM 自动换算成重量。': 'Exercises using %1RM auto-convert to loads from each athlete\u2019s tested 1RM.',
    '小周期划分': 'Microcycle Split',
    '在下方「小周期」区把中周期切成 1~2 周的小周期，设置每周的训练类型与强度分布，小周期页（03）会同步显示节奏曲线。': 'In the "Microcycles" area split the mesocycle into 1–2 week blocks and set weekly type & intensity; the microcycle page (03) mirrors the rhythm curve.',
    '展示当前中周期内每个小周期的类型构成（力量/代谢/速度/技战术等）与强度走势。': 'Shows each microcycle\u2019s type mix (strength/metabolic/speed/tactics…) and intensity trend in the current mesocycle.',
    '点击某天可修改当日类型与强度标签，用于执行「高强度日—低强度日」交替的周节奏。': 'Click a day to change its type & intensity label for a high–low alternating weekly rhythm.',
    '「目标负荷」可给小周期设定 AU 目标，负荷管理页会对比实际完成度。': '"Target Load" sets an AU goal per microcycle; load management compares actual completion.',
    '按日期查看与安排训练课（一天可有多节），训练结束后记录完成情况。': 'View & schedule sessions by date (multiple per day) and log completion afterwards.',
    '新建训练课': 'New Session', '：选日期、课名、课型（力量/耐力/技术…）、时间与时长，并勾选参加的运动员。': ': pick date, session name & type (strength/endurance/technique…), time and duration, and tick attending athletes.',
    '课表动作': 'Session Exercises', '：可从中周期模板带入，也可单独添加；每名运动员的重量按其 1RM 自动换算。': ': pull from mesocycle templates or add per session; each athlete\u2019s load converts from their 1RM.',
    '结果登记': 'Results', '：训练中记录每组的实际重量/次数与 RIR；未测 1RM 的动作可用「重量 × 次数 × RIR」现场估算并回写运动员的 1RM。': ': log actual load/reps and RIR per set; for untested 1RM, estimate via "load × reps × RIR" and write back.',
    '：课后每名运动员打一个 0~10 的主观强度分，系统乘以时长得到内部负荷（AU），是负荷监控的核心数据。': ': after each session every athlete rates perceived exertion 0–10; multiplied by duration it yields internal load (AU) — the core of load monitoring.',
    '完成列': 'Completion Column', '：展开课次可看到「已完成正式组 / 总正式组」的自动汇总，直观掌握完成度。': ': expand a session to see completed / total working sets at a glance.',
    'ACWR 仪表盘': 'ACWR Gauge', '：急性（7 天）与慢性（28 天）负荷比值，>1.5 提示负荷攀升过快、<0.8 提示减量过度。': ': acute (7-day) vs chronic (28-day) load ratio; >1.5 = ramping too fast, <0.8 = tapering too much.',
    '个人看板': 'Individual Dashboard', '：按运动员查看每日/每周 AU、训练分钟数、课次分布；时间范围可自由选择。': ': per-athlete daily/weekly AU, training minutes and session mix; pick any time range.',
    '团队看板': 'Team Dashboard', '：全队负荷热力与排名，快速发现负荷异常的队员。': ': team load heatmap & rankings to spot outliers fast.',
    '数据来源：训练课的 sRPE 与时长、手动添加的负荷记录（也可从外部表格导入）。': 'Data sources: session sRPE & duration, plus manual load entries (importable from spreadsheets).',
    '左侧为一级/二级分类树（如下肢→膝主导），右侧为动作列表；「新建动作」填名称、归类、器械与要点备注。': 'Left: category tree (e.g. lower body → knee-dominant); right: exercise list. "New Exercise" records name, category, equipment and coaching notes.',
    '动作被中周期课表引用后建议不要删除，可改名或移动分类（引用会自动跟随）。': 'Once referenced in sessions, prefer renaming or re-categorizing over deleting (references follow automatically).',
    '所有 1RM 一律按运动员测定，动作本身不设默认重量。': 'All 1RMs come from athlete testing — exercises carry no default weight.',
    '建档与套用': 'Profiles & Applying',
    '「新建运动员」：姓名必填，其余（位置、性别、生日、照片）选填；新建后自动挂到当前计划。': '"New Athlete": name required; position, sex, birthday, photo optional. New athletes attach to the current plan.',
    '「套用运动员」在 01 页把已有运动员批量挂到另一个计划；同一运动员可出现在多个计划。': '"Apply Athletes" on page 01 attaches existing athletes to another plan; one athlete can live in multiple plans.',
    '录入体能数据': 'Entering Test Data',
    '「添加体能数据」：选测试日期后，逐项填写身体成分（身高/体重/体脂）、体能指标（纵跳/冲刺/敏捷…）、FMS、YBT 与各动作 1RM；表单中的项目由「测试项目库」决定（可在 09 设置里增删）。': '"Add Test Data": pick a date, then fill body composition (height/weight/body fat), fitness items (jump/sprint/agility…), FMS, YBT and exercise 1RMs; the form follows your "Test Item Library" (edit it in Settings).',
    '同一日期重复保存会覆盖当日记录，不同日期形成历史，供 KPI 分析按时期对比。': 'Re-saving the same date overwrites that day; different dates build history for KPI comparisons.',
    'Excel 导入（推荐）': 'Excel Import (recommended)',
    '点击「导入体能测试」，直接选择一个或多个 Excel 文件即可——': 'Click "Import Tests" and pick one or more Excel files — ',
    '无需选择模板、无需映射': 'no template selection, no mapping',
    '系统自动识别宽表（一行一人多列成绩）、长表（一行一条记录）、多工作表、任意表头位置与列顺序；姓名自动匹配已有运动员，匹配不到的自动新建。': 'Wide tables (one row per athlete), long tables (one row per record), multiple sheets, any header position & column order are auto-detected; names match existing athletes or auto-create new ones.',
    '导入策略是「': 'The import policy is ', '只补空缺、不覆盖': 'fill gaps only, never overwrite',
    '」：同一人同日同项目已有成绩会保留原值，新日期与新项目正常写入；识别出的新测试项目会自动登记进项目库。': ': existing results for the same athlete/day/item keep their values; new dates & items are written normally; new test items register into the library automatically.',
    '导入完成会弹窗汇总（补了多少数据点、新建几人），支持「↩ 撤销本次导入」整批回滚；也可在台账里事后撤销。': 'A summary dialog reports what was added (data points, new athletes); "Undo Import" rolls back the whole batch, or undo later from the ledger.',
    '顶部筛选：选运动员、选测试项目（来自你的项目库）、选时期（如"赛季前 vs 赛季中"）。': 'Top filters: athletes, test items (from your library) and phases (e.g. pre-season vs in-season).',
    '内置看板：个体雷达与达标情况、FMS 功能筛查、YBT 平衡、1RM 力量档案、团队 Z 值排名。': 'Built-in dashboards: individual radars & benchmarks, FMS screening, YBT balance, 1RM profiles, team Z-score rankings.',
    '：自由勾选项目与分析方法（变化率、Z 分数、趋势回归、相对体重力量等）生成自定义看板，可一键生成文字分析报告。': ': freely combine items and methods (change rate, Z-scores, trend regression, relative strength…) into custom dashboards, plus one-click written reports.',
    '「＋ 添加测试项目」可直接注册新项目进项目库；数值方向（越大越好/越小越好）由系统按单位自动判定。': '"＋ Add Test Item" registers new items into the library; direction (higher/lower is better) is auto-judged from the unit.',
    '：深色适合夜间，浅色适合白天投影/打印场景。': ': dark for night, light for projection/printing.',
    '：纯色 / 渐变 / 星空三种，可再调背景遮罩深浅；星空为清晰星点缓慢漂移，不闪烁。': ': solid / gradient / starfield, plus a dim slider; stars are crisp, slow-drifting and non-flickering.',
    '：荧光绿/海蓝/暖橙/紫/玫红五选一，全站按钮与图表高亮跟随。': ': volt/ocean/amber/violet/rose — buttons and chart highlights follow site-wide.',
    '：紧凑模式缩小间距，笔记本小屏一屏显示更多内容。': ': compact shrinks spacing so small screens show more.',
    '：固定为周期总表，或每次打开回到上次离开的页面。': ': pin to the Master Sheet, or reopen where you left off.',
    '「数据与备份」里每个按钮的用途': 'What each button in "Data & Backup" does',
    '自动备份（开关）': 'Auto Backup (toggle)', '：开启后每次启动应用自动把数据库复制一份到本机备份目录，每天最多一份、自动保留最近 7 份——推荐一直开着。': ': copies the database to the local backup folder on every launch — one per day, keeps the latest 7. Recommended to keep on.',
    '：手动在备份目录多存一份，适合大批量导入/大改动前点一下。': ': save an extra copy in the backup folder — handy before big imports or edits.',
    '：弹出「另存为」由你选择位置，导出': ': opens "Save As" to choose a location and export ', '全部数据': 'all data', '（所有计划+设置）的 JSON 文件，用于换电脑或留档。': ' (all plans + settings) as JSON — for migrating or archiving.',
    '：查看本机自动备份的文件位置，误删后可从这里挑一份恢复。': ': see where local backups live; restore from there if needed.',
    '：选择之前导出的备份文件，': ': pick a previously exported backup to ', '当前全部数据（替换前请先再导出一份当前数据）。': ' all current data (export a fresh copy first).',
    '：危险区，需输入「清空」二字解锁，恢复出厂空白状态，操作前务必先导出备份。': ': type 清空 to unlock — factory reset; export a backup first.',
    '换电脑 / 分享给其他教练：计划数据包': 'Switching machines / sharing: Plan Package',
    '在「数据与备份 → 计划数据包」点': 'In "Data & Backup → Plan Package" click ',
    '，选择保存位置，得到一个 JSON 文件。里面包含该计划的周期、课表、运动员、体能数据、动作库等': ', choose a location and get a JSON file with the plan\u2019s periods, sessions, athletes, test data, exercise library — ',
    '全部内容': 'everything',
    '在另一台设备安装 Sharp Fit 后，点': 'After installing Sharp Fit on another device, click ',
    '选择该文件，确认后计划作为全新计划加入并自动切换过去，': ' and confirm — the plan joins as a new plan and the app switches to it, ',
    '不影响设备上已有的数据': 'leaving existing data untouched',
    '想迁移': 'To migrate ', '全部计划': 'all plans', '时用「导出备份文件 + 恢复备份」整库搬运。': ', use "Export / Restore Backup" to move the whole library.',
    'Excel 导入后去哪里看？': 'Where do Excel imports show up?', '——运动员档案（每人时间线）与 KPI 分析（图表对比）；导入完成弹窗也有快捷跳转按钮。': ' — Athlete profiles (per-athlete timeline) and KPI analysis (chart comparisons); the finish dialog has quick links.',
    '导入会不会覆盖我已有的成绩？': 'Will imports overwrite existing results?', '——不会。自动导入固定「只补空缺」；手动向导里也可显式选择覆盖策略。': ' — No. Auto-import always fills gaps only; the manual wizard lets you choose explicitly.',
    '测试项目找不到？': 'Test item missing?', '——在 09 设置 → 通用 →「管理测试项目库」勾选或新增；Excel 中出现的新项目也会自动登记。': ' — Tick or add it in 09 Settings → General → "Manage Test Library"; new Excel items auto-register.',
    '示例数据是什么？': 'What is sample data?', '——设置 → 通用 →「载入内置示例」可载入一套完整篮球队示例用于练手，退出示例会精确移除示例数据，不影响你自己的数据。': ' — Settings → General → "Load Sample" adds a full basketball team for practice; removing it deletes only the sample.',
    '换设备数据会丢吗？': 'Will data be lost when switching devices?', '——数据只存本机。换机前用「计划数据包」或「导出备份文件」带走在新设备导入即可。': ' — Data stays local. Take a "Plan Package" or "Export Backup File" and import on the new device.',
    // 导入
    '选择文件': 'Select File', '列映射': 'Column Mapping', '姓名对碰': 'Name Matching',
    '预览导入': 'Preview & Import', '一键导入': 'One-Click Import',
    '自动识别不同版本格式的测试数据，无需手动选择模板': 'Auto-detects any test-file layout — no template selection needed',
    '识别结果不对？手动调整': 'Detection off? Adjust manually',
    '请至少选择 1 名运动员': 'Select at least 1 athlete',
    // 通用短词（句子级未覆盖时的词级回退，仅 2 字以上，避免误伤单字）
    '团队': 'Team', '个人': 'Individual', '分析': 'Analysis', '看板': 'Dashboard', '报告': 'Report',
    '档案': 'Profile', '名单': 'Roster', '信息': 'Info', '提示': 'Notice', '警告': 'Warning',
    '错误': 'Error', '失败': 'Failed', '成功': 'Success', '自动': 'Auto', '手动': 'Manual',
    '默认': 'Default', '自定义': 'Custom', '系统': 'System', '内置': 'Built-in', '示例': 'Sample',
    '退出': 'Exit', '载入': 'Load', '打开': 'Open', '选择': 'Select', '选中': 'Selected',
    '已选': 'Selected', '未选': 'Not selected', '可选': 'Optional', '开始': 'Start', '结束': 'End',
    '本周': 'This Week', '上周': 'Last Week', '下周': 'Next Week', '每周': 'Weekly',
    '月份': 'Month', '小时': 'Hour', '分钟': 'Minute',
    '总览': 'Overview', '统计': 'Stats', '汇总': 'Summary', '平均': 'Average', '均值': 'Mean',
    '峰值': 'Peak', '趋势': 'Trend', '对比': 'Compare', '变化': 'Change', '排名': 'Ranking',
    '分布': 'Distribution', '达标': 'Standard Met', '评分': 'Score', '得分': 'Score',
    '动作库': 'Exercise Library', '分类': 'Category', '一级分类': 'Primary Category', '二级分类': 'Secondary Category',
    '训练课': 'Session', '课程': 'Course', '课表': 'Schedule', '课时': 'Duration',
    '参训': 'Attending', '参加': 'Attend', '缺席': 'Absent', '出勤': 'Attendance',
    '主观': 'Subjective', '时长': 'Duration', '功率': 'Power', '速度': 'Speed', '敏捷': 'Agility',
    '耐力': 'Endurance', '力量': 'Strength', '最大力量': 'Max Strength', '爆发力': 'Power',
    '有氧': 'Aerobic', '无氧': 'Anaerobic', '恢复': 'Recovery', '热身': 'Warm-up',
    '放松': 'Cool-down', '柔韧': 'Flexibility', '灵敏': 'Agility', '冲刺': 'Sprint',
    '纵跳': 'Vertical Jump', '深蹲': 'Back Squat', '卧推': 'Bench Press', '硬拉': 'Deadlift',
    '身体': 'Body', '成分': 'Composition', '体脂率': 'Body Fat %', '基础': 'Basic',
    '数据': 'Data', '记录': 'Record', '历史': 'History', '最新': 'Latest', '当前': 'Current',
    '目标负荷': 'Target Load', '实际负荷未填': 'Actual load not entered',
    '周期周数': 'Cycle Weeks', '周期序号': 'Cycle Index', '周数': 'Week No.',
    '大分类': 'Category', '隐藏分类': 'Hide Category', '添加分类': 'Add Category',
    '新建大分类': 'New Category', '删除本课': 'Remove Course', '清空当日': 'Clear Day',
    '休息': 'Rest', '比赛': 'Game', '测试': 'Test',
    // 位置（团队球类）
    '控球后卫': 'Point Guard', '得分后卫': 'Shooting Guard', '小前锋': 'Small Forward',
    '大前锋': 'Power Forward', '中锋': 'Center',
    '守门员': 'Goalkeeper', '中后卫': 'Center Back', '边后卫': 'Full Back',
    '防守型中场': 'Defensive Midfielder', '中场': 'Midfielder', '进攻型中场': 'Attacking Midfielder',
    '边锋': 'Winger', '前锋': 'Forward',
    '主攻': 'Outside Hitter', '副攻': 'Middle Blocker', '二传': 'Setter', '接应': 'Opposite Hitter',
    '自由人': 'Libero', '拦网手': 'Blocker', '防守手': 'Defender',
    '前鋒': 'Forward', '后锋': 'Back', '四分卫': 'Quarterback', '跑卫': 'Running Back',
    '外接手': 'Wide Receiver', '近端锋': 'Tight End', '进攻线': 'Offensive Line',
    '防守线': 'Defensive Line', '线卫': 'Linebacker', '角卫': 'Cornerback', '安全卫': 'Safety',
    '防守后卫': 'Defensive Back', '左边锋': 'Left Wing', '右边锋': 'Right Wing',
    '左内锋': 'Left Back', '右内锋': 'Right Back', '底线': 'Pivot',
    '后卫': 'Guard', '射门手': 'Goal Shooter', '进攻手': 'Goal Attack', '进攻翼': 'Wing Attack',
    '防守翼': 'Wing Defence', '进攻队员': 'Attacker', '防守队员': 'Defender',
    '主攻手': 'Striker', '二传手': 'Setter', '突袭者': 'Raider', '防守者': 'Defender',
    '前排': 'Front Row', '后排': 'Back Row', '单网前锋': 'Single-net Front',
    '单网后卫': 'Single-net Back', '双网队员': 'Double-net Player',
    '内场队员': 'Courter', '外场队员': 'Reactor',
    '投手': 'Pitcher', '捕手': 'Catcher', '一垒手': 'First Baseman', '二垒手': 'Second Baseman',
    '三垒手': 'Third Baseman', '游击手': 'Shortstop',
    '左外野手': 'Left Fielder', '中外野手': 'Center Fielder', '右外野手': 'Right Fielder',
    '指定打击': 'Designated Hitter', '击球手': 'Batsman', '投球手': 'Bowler',
    '全能手': 'All-rounder', '三柱门守门员': 'Wicket-keeper', '控盘手': 'Handler', '接盘手': 'Cutter',
    // 运动项目（选项标签）
    '球类 · 大球': 'Ball · Team', '球类 · 小球': 'Ball · Racket', '田径': 'Track & Field',
    '多项与障碍': 'Multi-sport & OCR', '体操与技巧': 'Gymnastics & Skills',
    '体能与健身': 'Strength & Fitness', '格斗对抗': 'Combat Sports', '水上运动': 'Water Sports',
    '自行车': 'Cycling', '冰雪运动': 'Snow & Ice', '户外与极限': 'Outdoor & Extreme',
    '精准运动': 'Precision Sports', '马术与机车': 'Equestrian & Motor',
    '舞蹈与身心': 'Dance & Mind-Body', '民族传统体育': 'Traditional Sports',
    '智力运动与电竞': 'Mind Sports & Esports', '其他项目': 'Others',
    '篮球': 'Basketball', '足球': 'Football', '排球': 'Volleyball', '沙滩排球': 'Beach Volleyball',
    '橄榄球': 'Rugby', '美式橄榄球': 'American Football', '腰旗橄榄球': 'Flag Football',
    '手球': 'Handball', '水球': 'Water Polo', '曲棍球': 'Field Hockey', '冰球': 'Ice Hockey',
    '棒球': 'Baseball', '垒球': 'Softball', '板球': 'Cricket', '极限飞盘': 'Ultimate Frisbee',
    '无挡板篮球': 'Netball', '力量训练': 'Strength Training', '体能训练': 'S&C Training',
    '简体中文 · 繁體中文 · English（切换后页面自动刷新；你的数据内容不翻译）':
      'Simplified Chinese · Traditional Chinese · English (the page reloads after switching; your data is not translated)',
    // ====== i18n 补漏：settings ======
    '紫': 'Violet', '节训练课。': 'sessions.',
    // ====== i18n 补漏：macro 周期模型库 ======
    '马特维耶夫经典周期': 'Matveyev Classic Periodization',
    '鿅性周期化模型，经典超负荷递增': 'Linear periodization, classic progressive overload',
    '初学者 / 稳定递增场景': 'Beginners / steady progression',
    '中低负荷量，渐进递增': 'Low-medium volume, gradual increase',
    'NSCA 鿅性周期化': 'NSCA Linear Periodization',
    '波动式周期化': 'Undulating Periodization',
    '板块周期化（Issurin）': 'Block Periodization (Issurin)',
    '共轭法（Westside）': 'Conjugate Method (Westside)',
    '三相训练（Triphasic）': 'Triphasic Training',
    '双峰周期（赛程密集型）': 'Dual-Peak Periodization (dense schedule)',
    '周期模型参考 ·  ': 'Periodization Reference · ',
    '适用对象': 'Target Users', '负荷特征': 'Load Profile',
    '典型阶段（手动划分中周期时参考 · 按当前计划 ${weeks} 周估算）': 'Typical phases (reference for manual mesocycle division · ~${weeks} wks)',
    '阶段': 'Phase', '占比': 'Share', '参考周数': 'Ref Wks',
    '💡 本系统不会自动生成任何计划，请结合项目特点到周期总表手动拖选划分中周期。': '💡 No plans are auto-generated — go to the master table and drag-select weeks to define mesocycles.',
    '我知道了': 'Got it',
    '暂无已保存的训练计划': 'No saved training plans',
    '已切换训练计划': 'Plan switched',
    '📖 周期模型参考 ▾': '📖 Periodization Reference ▾',
    '删除训练计划「${...}」？其下所有中周期、小周期、日计划、映射训练课，以及该计划的 ${athN} 名运动员（含 1RM、体能测试与负荷记录）将一并删除，且不可恢复。': 'Delete plan "${...}"? All mesocycles, microcycles, daily plans, mapped sessions, and ${athN} athletes (incl. 1RM, tests & load records) will be permanently deleted.',
    '训练计划已删除': 'Plan deleted',
    '💡 所有中周期需手动创建：到周期总表拖选空白周，或在中周期页面点击「＋」手动划分。': '💡 All mesocycles must be created manually — drag-select blank weeks on the master table, or click "+" on the mesocycle page.',
    '删除训练计划「${...}」？其下中周期与该计划的运动员（含 1RM、体能测试与负荷记录）将一并删除。': 'Delete plan "${...}"? Its mesocycles and the plan\'s athletes (incl. 1RM, tests & load records) will be deleted.',
    '请填写起止日期': 'Please enter start and end dates',
    '结束日期不能早于开始日期': 'End date must be after start date',
    '训练计划已更新': 'Plan updated', '训练计划已创建': 'Plan created',
    '编辑大周期': 'Edit Macrocycle', '新建大周期': 'New Macrocycle',
    '大周期名称': 'Macrocycle Name',
    '删除大周期「${...}」？': 'Delete macrocycle "${...}"?',
    '已删除大周期': 'Macrocycle deleted',
    '请检查起止日期': 'Please check the dates',
    '大周期日期需在训练计划范围内': 'Macrocycle dates must be within the plan range',
    '大周期已更新': 'Macrocycle updated', '大周期已创建': 'Macrocycle created',
    '周期总长': 'Total Length',
    '月历中已红色高亮': 'highlighted in red on the calendar',
    '备赛运动员': 'Roster Athletes', '仅限': 'limited to',
    '累计总吨位': 'Cumulative Tonnage',
    '已完成训练课累计负荷': 'Completed sessions cumulative load',
    '备赛名单已更新': 'Roster updated',
    '恢复中': 'Recovering', '疲劳': 'Fatigued',
    '低': 'Low', '正常': 'Normal', '中上': 'Above Average',
    '良好': 'Good', '优秀': 'Excellent', '接近峰值': 'Near Peak',
    '已占用': 'Occupied', '定义中周期': 'Define Mesocycle',
    '所属训练计划': 'Parent Plan', '起始周': 'Start Week', '结束周': 'End Week',
    '积累': 'Accumulation', '强化': 'Intensification', '转化功率': 'Transformation',
    '峰值': 'Peak', '维持': 'Maintenance',
    '选择连续的几周组成一个中周期，保存后自动同步到「中周期」模块；已占用的周不可重复划分': 'Select consecutive weeks to form a mesocycle — saved mesocycles sync to the Mesocycle page; occupied weeks can\'t be reused',
    '结束周不能早于起始周': 'End week must be after start week',
    '中周期已更新': 'Mesocycle updated',
    '中周期已定义，可在「中周期」模块查看': 'Mesocycle defined — view it on the Mesocycle page',
    '删除中周期「${...}」？其中的日计划将一并删除。': 'Delete mesocycle "${...}"? Its daily plans will be deleted too.',
    '已删除中周期': 'Mesocycle deleted',
    '标记日期': 'Mark Date', '比赛名称': 'Competition Name', '比赛地点': 'Venue',
    '标记': 'Mark', '测试名称': 'Test Name',
    '已标记测试日': 'Test day marked', '已标记比赛日': 'Competition day marked',
    '移除比赛日「${...}」（${...}）？': 'Remove competition day "${...}" (${...})?',
    '已移除比赛日': 'Competition day removed',
    '移除测试日「${...}」（${...}）？': 'Remove test day "${...}" (${...})?',
    '已移除测试日': 'Test day removed',
    '（点击标记比赛日 / 测试日）': '(click to mark competition / test day)',
    '＋标记': '+Mark',
    '周序号': 'Week Index',
    '（点击进入中周期规划）': '(click to enter mesocycle planning)',
    '点击或按住拖动选择连续几周，定义中周期': 'Click or drag to select consecutive weeks and define a mesocycle',
    '点击编辑/删除大周期': 'Click to edit/delete macrocycle',
    '点击或按住拖动选择连续几周，定义新大周期': 'Click or drag to select consecutive weeks and define a new macrocycle',
    '手动设定每周准备水平（1-10）。1=恢复中，3-4=基础，5-6=正常，7-8=良好，9-10=峰值。直接驱动峰值状态曲线走向。': 'Manually set weekly readiness (1-10). 1=Recovering, 3-4=Base, 5-6=Normal, 7-8=Good, 9-10=Peak. Drives the peak-state curve.',
    '点击输入队伍名称': 'Click to enter team name',
    '＋ 新增大分类': '+ Add Category',
    '拖拽分类标签可调整顺序 · 点 ▾ 隐藏整行': 'Drag category labels to reorder · click ▾ to hide a row',
    '已隐藏：': 'Hidden: ', '点击恢复显示该分类': 'Click to restore this category',
    // ====== i18n 补漏：meso ======
    '编辑中周期': 'Edit Mesocycle', '所属大周期': 'Parent Macrocycle',
    '结束日期需晚于开始日期': 'End date must be after start date',
    '删除中周期「${...}」？关联小周期将一并删除。': 'Delete mesocycle "${...}"? Linked microcycles will be deleted too.',
    '（点击查看该大周期的中周期）': '(click to view this macrocycle\'s mesocycles)',
    '编辑 / 删除大周期': 'Edit / Delete Macrocycle',
    '大周期 · 中周期': 'Macrocycle · Mesocycle',
    '＋ 新建大周期': '+ New Macrocycle', '＋ 新建中周期': '+ New Mesocycle',
    '显示当前训练计划中的全部中周期': 'Show all mesocycles in the current plan',
    ' 个中周期': ' mesocycles', '未划分': 'Undefined',
    ' 个小周期': ' microcycles',
    '该大周期下尚未安排中周期，点击右上角「＋ 新建中周期」': 'No mesocycles under this macrocycle yet — click "+ New Mesocycle" top-right',
    '暂无中周期': 'No mesocycles yet',
    '天数': 'Days', '目标负荷（AU，可选）': 'Target Load (AU, optional)',
    '小周期天数自行设定（常见 3-10 天），结束日期 = 开始日期 + 天数 − 1；创建后可点击小周期进入「小周期」页面安排每日训练': 'Microcycle days are custom (typically 3-10); end = start + days − 1. Click a microcycle to enter the Microcycle page and schedule daily training.',
    '未命名小周期': 'Untitled Microcycle', '请选择开始日期': 'Please select a start date',
    '小周期已创建': 'Microcycle created',
    '按天数自动划分小周期': 'Auto-split Microcycles by Days',
    '每个小周期的天数': 'Days per microcycle',
    '将「${...}」按固定天数依次划分，已有小周期将被清除': 'Split "${...}" into fixed-day microcycles — existing ones will be cleared',
    '划分': 'Split', '第 ${i} 段': 'Segment ${i}',
    '已按 ${len} 天划分 ${i-1} 个小周期': 'Split into ${i-1} microcycles of ${len} days each',
    '爆发/速度': 'Power/Speed', '技术战术': 'Technique/Tactics',
    '恢复再生': 'Recovery/Regeneration', '休息': 'Rest',
    '计划/实际': 'Planned/Actual', '人有1RM': 'have 1RM', '待设': 'Unset',
    '总次数 计划/实际': 'Total Reps Planned/Actual',
    '总距离 计划/实际': 'Total Distance Planned/Actual',
    '做功时长 计划/实际': 'Work Time Planned/Actual',
    '课型天数': 'Session-Type Days', ' 计划/实际': ' Planned/Actual',
    '中周期计划课': 'Mesocycle Planned Sessions',
    '来自中周期「${...}」当日计划': 'From mesocycle "${...}" daily plan',
    '选择一个中周期': 'Select a mesocycle',
    '在顶部中周期列表中选择或新建中周期后，即可按日安排力量训练动作、调整每日负荷强度，并划分小周期': 'Select or create a mesocycle at the top, then schedule daily exercises, adjust intensity and split microcycles',
    '休': 'Rest', '赛': 'Game',
    '点击定位该日 · 拖动调整当日 1RM% 负荷（课程动作的 %1RM 同步更新，动作内仍可单独修改）': 'Click to locate the day · drag to adjust daily 1RM% load (session exercises sync, per-exercise overrides still available)',
    '当前训练目标': 'Current Training Goal',
    '共 ${nWeeks} 周': '${nWeeks} wks total',
    '暂未制定训练目标（请在「周期训练计划」页设置）': 'No training goals set (configure on the Periodized Plan page)',
    '显示全部日期': 'Show All Dates', '第${cnNum(i+1)}周': 'Week ${i+1}',
    '每日安排': 'Daily Schedule',
    '拖动滑杆调整当日 1RM% 负荷': 'Drag the slider to adjust daily 1RM% load',
    '休息日': 'Rest Day', '小周期：': 'Microcycle: ',
    '未设类型': 'No type set', '查看当日训练课': 'View daily sessions',
    '节训练课': 'sessions',
    '从本中周期任意一天复制课程到当日（可选课程与是否包含负荷百分比）': 'Copy sessions from any day in this mesocycle to the current day (choose sessions and whether to include load %)',
    '＋ 添加训练课': '+ Add Session',
    '负荷 · 量 · 疲劳 · 峰值状态': 'Load · Volume · Fatigue · Peak State',
    '实际训练负荷与课次统计': 'Actual Training Load & Session Stats',
    '规划百分比负荷': 'Plan % Load',
    '共 ${micros.length} 个 · 点击小周期进入页面安排每日训练': '${micros.length} total · click a microcycle to schedule daily training',
    '按天数自动划分': 'Auto-split by Days',
    '点击进入小周期页面': 'Click to enter microcycle page',
    '尚未划分小周期：可自定义天数新建，或按固定天数自动划分整个中周期': 'No microcycles yet — create custom days or auto-split the whole mesocycle',
    '未命名': 'Untitled', '课程分类': 'Course Category',
    '按七大训练模块分组的课程分类，选择后自动作为课程名称': 'Course categories grouped by the 7 training modules — selecting one auto-names the course',
    '个动作': 'exercises', '未安排动作': 'No exercises',
    '删除课程 ${ci+1}「${...}」？对应自动映射的训练课将一并移除（已填实际数据的保留）。': 'Delete course ${ci+1} "${...}"? The auto-mapped session will be removed (those with actual data are kept).',
    '已删除课程': 'Course deleted',
    '本中周期还没有可复制的一天': 'No copyable day in this mesocycle yet',
    '复制训练计划（覆盖当日）': 'Copy Plan (Overwrite Day)',
    '1 · 选择来源日期': '1 · Select source date',
    '节课 ·  ': 'sessions · ', '动作': 'exercises',
    '2 · 选择要复制的课程（可多选）': '2 · Select sessions to copy (multi-select)',
    '全不选': 'Deselect All',
    '复制将覆盖当日的全部课程；「只复制计划」保留动作/组数/次数但清空 %1RM 负荷百分比，「全部复制」连负荷百分比一起复制。保存后自动同步当日训练课。': 'Copy overwrites all courses of the day; "Plan Only" keeps exercises/sets/reps but clears %1RM, "Full Copy" includes load %. Saved sessions auto-sync.',
    '只复制计划（不含负荷%）': 'Plan Only (no load %)',
    '全部复制（含负荷%）': 'Full Copy (with load %)',
    '未命名课程': 'Untitled Course',
    '个动作 ·  ': 'exercises · ', '未分类': 'Uncategorized',
    '请至少选择一节课程': 'Select at least one course',
    '已复制 ${U.cn(src.date)} ${idxs.length} 节课程${withPct ? \'（含负荷百分比）\' : \'（不含负荷百分比，%1RM 已清空）\'}': 'Copied ${idxs.length} sessions from ${src.date}${withPct ? \' (with load %)\' : \' (without load %, %1RM cleared)\'}',
    '清空当日全部课程动作？': 'Clear all course exercises for this day?',
    // ====== i18n 补漏：micro ======
    '编辑小周期': 'Edit Microcycle',
    '小周期天数自行设定，结束日期 = 开始日期 + 天数 − 1': 'Microcycle days are custom; end = start + days − 1',
    '小周期列表': 'Microcycle List', '所属中周期': 'Parent Mesocycle',
    '— 无中周期 —': '— No Mesocycle —',
    '按中周期自动划分': 'Auto-split by Mesocycle',
    '当前中周期暂无小周期': 'No microcycles in this mesocycle',
    '选择或创建小周期': 'Select or Create Microcycle',
    '小周期以周为单位规划每天的训练类型与强度分布，是负荷节奏管理的核心工具': 'Microcycles plan daily training types and intensity distribution weekly — the core tool for load rhythm management',
    '第${CN_S[i]}节：': 'Session ${i}: ',
    '等 ${names.length} 项': '+${names.length} more',
    '点击进入 ${U.cn(date)} 的训练课页': 'Click to enter the session page for ${date}',
    '节课（点击进入）': 'sessions (click to enter)',
    '小周期主要': 'Primary', '次要': 'Secondary', '编辑目标': 'Edit Goal',
    '训练类型': 'Training Type',
    '当日训练计划（点击进入当天训练课）': 'Daily plan (click to enter session)',
    '当日主题 / 备注': 'Daily Theme / Notes',
    '每日强度节奏': 'Daily Intensity Rhythm',
    '强度 % · 训练量与疲劳': 'Intensity % · Volume & Fatigue',
    '高强度日 (≥80%)': 'High-Intensity Day (≥80%)',
    '中强度日 (50-79%)': 'Medium-Intensity Day (50-79%)',
    '低强度/休息 (<50%)': 'Low-Intensity/Rest (<50%)',
    '周训练负荷': 'Weekly Training Load',
    '全队实际 sRPE 负荷合计': 'Team actual sRPE load total',
    '本小周期 · 按日': 'This microcycle · Daily',
    '小周期目标已更新': 'Microcycle goal updated',
    '删除小周期「${...}」？': 'Delete microcycle "${...}"?',
    '无已完成训练课': 'No completed sessions',
    '课次': 'Sessions', '全队负荷（AU）': 'Team Load (AU)', '训练课次': 'Session Count',
    '强度（%）': 'Intensity (%)', '训练量（AU）': 'Volume (AU)', '疲劳（AU）': 'Fatigue (AU)',
    // ====== i18n 补漏：session ======
    '尚未选择参训运动员': 'No athletes selected',
    '结束训练': 'End Session', '本节课负荷': 'This Session Load',
    '时长': 'Duration',
    '内部负荷 = sRPE × 时长': 'Internal Load = sRPE × Duration',
    '外部负荷含热身组+正式组全部完成量': 'External Load = warm-up + working sets, all completed volume',
    'sRPE': 'sRPE', '时长(min)': 'Duration (min)', '负荷(AU)': 'Load (AU)',
    '吨位(kg)': 'Tonnage (kg)', '距离(m)': 'Distance (m)', '做功(s)': 'Work (s)',
    '团队合计': 'Team Total',
    '不保存': 'Don\'t Save', '保存并纳入统计': 'Save & Include in Stats',
    '暂停': 'Pause', '继续': 'Resume',
    '开始训练': 'Start Training', '再次开始训练': 'Restart Training',
    '训练中 · 自动保存': 'In Session · Auto-saving',
    '已暂停': 'Paused', '已完课': 'Completed',
    '按七大训练模块分组的课型': 'Session types grouped by the 7 training modules',
    '计时中': 'Timing', '未计时': 'Not Timed',
    '展开 ▸': 'Expand ▸', '折叠 ▾': 'Collapse ▾',
    '复制课程': 'Copy Course', '训练时长': 'Training Duration',
    '分钟': 'minutes', '选择运动员': 'Select Athletes',
    '课程备注': 'Course Notes',
    '中周期计划 ${mrows.length} 动作': 'Mesocycle plan: ${mrows.length} exercises',
    '查看中周期': 'View Mesocycle',
    '来自小周期「${...}」': 'From microcycle "${...}"',
    '当日安排未设定': 'Daily plan not set', '进入小周期': 'Go to Microcycle',
    '运动员训练计划与完成情况': 'Athlete Plan & Completion',
    '吨位': 'Tonnage', '距离': 'Distance', '做功': 'Work',
    '项专属1RM': 'have 1RM', '无专属1RM': 'No 1RM',
    '未填': 'Not entered',
    '完课 sRPE': 'Completion sRPE',
    '动作 / 组': 'Exercise / Set', '计划%': 'Plan %',
    '计划量': 'Plan Volume', '实际重量': 'Actual Weight',
    '实际完成': 'Actual Done', '估算1RM': 'Est. 1RM',
    '复杂训练': 'Complex Training',
    '个动作 · 正式组共享': 'exercises · shared working sets',
    '组': 'sets',
    '单组次数过高': 'Reps too high',
    '请用≤10次组重测': 'Retest with ≤10 reps/set',
    '偏高': 'Too high', '更新1RM': 'Update 1RM',
    '热身': 'Warm-up', '正式': 'Working',
    '该组实际重量': 'Actual weight for this set',
    '该组实际完成量（次/m/s）': 'Actual volume for this set (reps/m/s)',
    '该组是否完成': 'Whether this set is completed',
    '删除此${kind}组': 'Delete this ${kind} set',
    '逐组记录（热身组不计入 1RM 估算）': 'Per-set logging (warm-up sets excluded from 1RM estimation)',
    '＋ 热身组': '+ Warm-up Set', '＋ 正式组': '+ Working Set',
    '正式组数量从中周期组数带入': 'Working set count inherited from mesocycle',
    '无计划行': 'No planned row',
    '每个动作至少保留一组正式组': 'Keep at least one working set per exercise',
    '移除「${...}」的本课计划？': 'Remove "${...}" from this session\'s plan?',
    '已移除该运动员': 'Athlete removed',
    '请先填写实际重量与单组次数（单组 ≤12 次，建议 3-10 次）': 'Enter actual weight and per-set reps first (≤12 reps/set; 3-10 recommended)',
    '已更新：': 'Updated: ', '记录日期': 'Record Date',
    '档案页按训练课日期归档': 'Archived by session date on the profile page',
    '（副本）': '(copy)', '已复制课程': 'Course copied',
    '删除课程「${...}」？关联的负荷记录将一并删除。': 'Delete course "${...}"? Linked load records will be deleted too.',
    '已暂停：计时冻结，可随时继续': 'Paused: timer frozen, resume anytime',
    '继续训练：计时恢复': 'Resumed: timer running',
    '已完课：${mins} 分钟，负荷已计算并纳入周期统计': 'Completed: ${mins} min — load calculated and added to cycle stats',
    '已取消完课：数据保留，未纳入负荷统计': 'Completion canceled: data kept, not included in load stats',
    '训练开始：计时中，填写数据将自动保存': 'Training started: timing — entered data auto-saves',
    '负荷已更新并纳入统计': 'Load updated and included in stats',
    '‹ 前一天': '‹ Prev Day', '后一天 ›': 'Next Day ›',
    '＋ 添加本日课程': '+ Add Today\'s Session',
    '在日期条上左右滑动切换日期（也可用键盘 ← →）': 'Swipe left/right on the date bar to switch (or use ← → keys)',
    '无课程': 'No sessions', '新训练课': 'New Session',
    '当日暂无课程': 'No sessions today',
    '点击「添加本日课程」排课，一天可安排多节不同类型的训练课': 'Click "Add Today\'s Session" to schedule — multiple sessions of different types per day',
    // ====== i18n 补漏：load ======
    '文献来源：': 'References: ',
    '基线积累中': 'Building baseline', '数据不足': 'Insufficient data',
    '近期负荷较低': 'Recent load is low', '变化平稳': 'Stable',
    '上升，建议复核': 'Rising — review recommended',
    '变化明显，建议复核': 'Sharp change — review recommended',
    '偏低': 'Low', '最适': 'Optimal', '偏高': 'High', '风险': 'Risk',
    '过于新鲜': 'Over-fresh', '状态新鲜': 'Fresh',
    '训练平衡': 'Balanced', '积累疲劳': 'Accumulating fatigue',
    '深度疲劳': 'Deep fatigue',
    '视图模式': 'View Mode', '个人负荷': 'Individual Load', '团队负荷': 'Team Load',
    '— 暂无运动员 —': '— No Athletes —',
    '汇总全队 ${aths.length} 名运动员的日负荷数据': 'Aggregating daily load for ${aths.length} athletes',
    '本节课': 'This Session',
    '本节课（当日无训练课）': 'This Session (no session today)',
    '日负荷': 'Daily Load',
    '小周期（未选择）': 'Microcycle (none selected)',
    '中周期（未选择）': 'Mesocycle (none selected)',
    '前往该训练课录入/完课 →': 'Go to session to log/complete →',
    '前往训练课页 →': 'Go to session page →',
    '负荷总览': 'Load Overview', '负荷时期': 'Load Period',
    '日': 'Day', '当日无课': 'No session today',
    '内部负荷 AU': 'Internal Load AU', '训练天数': 'Training Days',
    '做功': 'Work',
    '今日负荷': 'Today\'s Load',
    '急性负荷 ATL': 'Acute Load ATL', 'ACWR 急慢性比': 'ACWR Acute/Chronic Ratio',
    '慢性负荷 CTL': 'Chronic Load CTL',
    '本周负荷': 'This Week\'s Load',
    '全队今日负荷': 'Team Today\'s Load',
    '团队急性负荷 ATL': 'Team Acute Load ATL',
    '团队 ACWR': 'Team ACWR', '团队 TSB': 'Team TSB',
    '团队慢性负荷 CTL': 'Team Chronic Load CTL',
    '全队本周负荷': 'Team This Week\'s Load',
    'ACWR / TSB 仪表盘': 'ACWR / TSB Dashboard',
    'ACWR': 'ACWR', '超出基准量程': 'Out of range',
    '团队 ACWR / TSB 仪表盘': 'Team ACWR / TSB Dashboard',
    '团队 ACWR': 'Team ACWR', '团队 ACWR ·  ': 'Team ACWR · ',
    '团队 TSB ·  ': 'Team TSB · ',
    '速度敏捷': 'Speed/Agility', '恢复柔韧': 'Recovery/Flexibility',
    '技战术': 'Technique/Tactics',
    '训练内容雷达': 'Training Content Radar',
    '做功时长趋势': 'Work Time Trend', '外部负荷': 'External Load',
    '范围总吨位': 'Range Total Tonnage', '范围总距离': 'Range Total Distance',
    '范围总做功': 'Range Total Work', '时间量纲动作': 'Time-based exercises',
    '做功时长': 'Work Time', '其他': 'Other',
    '训练时间': 'Training Time',
    '全部 · 近 12 周': 'All · Last 12 Weeks',
    '全部 ·  ': 'All · ',
    '全部中周期': 'All Mesocycles', '全部小周期': 'All Microcycles',
    '急性负荷走势': 'Acute Load Trend',
    '每日负荷 与 ATL 急性走势': 'Daily Load & ATL Trend',
    'ACWR 历史走势': 'ACWR History',
    '0.8–1.3 最适区间': '0.8–1.3 Optimal Zone',
    '力量训练负荷与课次': 'Strength Load & Sessions',
    '外部负荷（吨位 / 距离 / 做功）': 'External Load (Tonnage / Distance / Work)',
    '慢性负荷 CTL 走势': 'Chronic Load CTL Trend',
    '每日负荷': 'Daily Load', 'ATL 急性': 'ATL Acute',
    '最适区间': 'Optimal Zone', '风险线': 'Risk Line',
    'CTL': 'CTL', 'AU/日': 'AU/day', 'CTL 慢性': 'CTL Chronic',
    '力量负荷（kg）': 'Strength Load (kg)',
    '参训课次': 'Attended Sessions',
    '团队急性负荷走势': 'Team Acute Load Trend',
    '全队每日总负荷 与 ATL': 'Team Daily Total Load & ATL',
    '个人负荷对比': 'Individual Load Comparison',
    '所选范围 ${rangeDays} 天累计 AU': 'Selected range ${rangeDays} d cumulative AU',
    '团队外部负荷（吨位 / 距离 / 做功）': 'Team External Load (Tonnage / Distance / Work)',
    '团队慢性负荷 CTL 走势': 'Team Chronic Load CTL Trend',
    '全队每日负荷': 'Team Daily Load',
    '范围累计': 'Range Total', '有负荷天数': 'Load Days',
    '范围累计负荷': 'Range Cumulative Load',
    '团队 CTL': 'Team CTL',
    '单调性与应变': 'Monotony & Strain', '数据表格': 'Data Table',
    '单调性 >2 提示负荷过于单一（缺乏变化）；ACWR 0.8–1.3 为合理区间，>1.5 风险升高。': 'Monotony >2 indicates monotonous load; ACWR 0.8–1.3 is optimal, >1.5 raises risk.',
    '周': 'Week', '过高': 'Too high',
    '日均': 'Daily Avg', '单调性': 'Monotony', '应变': 'Strain',
    '阈值 2': 'Threshold 2',
    '团队周负荷排名': 'Team Weekly Load Ranking',
    '总负荷': 'Total Load',
    '全部运动员': 'All Athletes', '全部周期': 'All Periods',
    '未选择运动员': 'No athlete selected',
    '当前计划全队 ${aths.length} 人': '${aths.length} athletes in current plan',
    '至': 'to', 'AU · 内部负荷总量': 'AU · Total Internal Load',
    '筛选范围累积': 'Filtered Range Cumulative',
    'ACWR · 急慢性比': 'ACWR · Acute/Chronic Ratio',
    'TSB · 训练压力平衡': 'TSB · Training Stress Balance',
    '训练吨位': 'Training Tonnage', '种课型': 'session types',
    '按课次分布': 'By Sessions', '共 ${total} 节': '${total} sessions total',
    '按训练时长分布': 'By Duration',
    '共 ${U.fmt(totalMin)} 分钟': '${U.fmt(totalMin)} min total',
    '所选课程未填写时长，暂无时间分布。': 'Selected sessions have no duration — no time distribution.',
    '该范围内暂无训练课。': 'No sessions in this range.',
    '课型': 'Session Type', '总课数': 'Total Sessions',
    '节课': 'sessions', '占': 'share',
    '总时长（分）': 'Total Duration (min)',
    '训练课类型统计': 'Session Type Stats',
    // ====== i18n 补漏：exercises ======
    '编辑一级分类': 'Edit Primary Category',
    '编辑二级分类': 'Edit Secondary Category',
    '添加一级分类': 'Add Primary Category',
    '添加二级分类': 'Add Secondary Category',
    '分类名称': 'Category Name',
    '分类名已存在': 'Category name already exists',
    '删除分类「${...}」${exCount ? `？其下 ${exCount} 个动作将一并删除` : \'\'}。': 'Delete category "${...}"${exCount ? `? ${exCount} exercises will be deleted too` : \'\'}.',
    '编辑动作': 'Edit Exercise', '添加动作': 'Add Exercise',
    '动作名称 *': 'Exercise Name *',
    '器械': 'Equipment', '计量单位 *': 'Unit *',
    '次（组×次数，力量/跳跃/投掷）': 'Reps (sets×reps, strength/jump/throw)',
    '距离（组×米，冲刺/间歇跑/跑动）': 'Distance (sets×m, sprint/interval/running)',
    '时间（组×秒，支撑/稳态/拉伸）': 'Time (sets×s, hold/steady/stretch)',
    '负荷类型 *': 'Load Type *',
    '抗阻（带重量/%1RM/RIR）': 'Resisted (weight/%1RM/RIR)',
    '自重/徒手': 'Bodyweight',
    '能量系统/位移（跑动/骑行/划船）': 'Energy system/Displacement (run/bike/row)',
    '技术要点 / 备注': 'Coaching Cues / Notes',
    '计量单位决定训练课该行录「组×次 / 组×距离 / 组×做功时间」；负荷类型决定是否显示 %1RM、重量与 RIR 列。排课重量与 %1RM 换算按运动员专属 1RM 计算——在「运动员档案」中通过测试或手动录入。': 'The unit determines the logging format; the load type controls whether %1RM, weight and RIR columns show. Scheduling weight from %1RM uses each athlete\'s 1RM — set in Athlete Profiles via testing or manual entry.',
    '请填写动作名称': 'Exercise name is required',
    '分类体系': 'Category System', '＋ 一级': '+ Primary',
    '改': 'Edit', '删': 'Del',
    '全部二级分类': 'All Secondary Categories',
    '动作列表': 'Exercise List', '全部分类': 'All Categories',
    '搜索名称 / 器械 / 分类…': 'Search name / equipment / category…',
    '＋ 添加动作': '+ Add Exercise',
    '已测 1RM': 'Tested 1RM', '操作': 'Actions',
    '人已测': 'tested', '暂无动作': 'No exercises yet',
    '添加动作建立训练动作库；运动员 1RM 在「运动员档案」按人录入，排课时按 %1RM 自动换算重量': 'Add exercises to build your library; athlete 1RMs are entered per-person in Athlete Profiles, auto-converting to weights from %1RM during scheduling',
    '删除动作「${...}」？历史计划中的引用将显示为空。': 'Delete exercise "${...}"? References in past plans will show as empty.',
    // ====== i18n 补漏：profile FMS/NSCA ======
    '跨栏步': 'Hurdle Step', '直线弓箭步': 'Inline Lunge',
    '肩部灵活性': 'Shoulder Mobility', '主动直腿抬高': 'Active Straight-Leg Raise',
    '躯干稳定俯卧撑': 'Trunk Stability Push-up', '旋转稳定性': 'Rotary Stability',
    '深蹲1RM': 'Squat 1RM', '卧推1RM': 'Bench Press 1RM', '硬拉1RM': 'Deadlift 1RM',
    '反向纵跳CMJ': 'CMJ', 'IMTP峰值': 'IMTP Peak',
    '20m冲刺': '20m Sprint', '立定跳远': 'Standing Long Jump',
    'Lane敏捷': 'Lane Agility', '反应时': 'Reaction Time',
    '引体向上': 'Pull-up',
    'YBT左腿': 'YBT Left', 'YBT右腿': 'YBT Right',
    'FMS 功能性动作筛查': 'FMS Functional Movement Screen',
    'YBT 下肢动态平衡': 'YBT Lower-Quarter Dynamic Balance',
    '力量（1RM）': 'Strength (1RM)',
    '请填写项目名称': 'Item name is required',
    '项目库中已存在「': 'Already in the library: "',
    // ====== i18n 补漏：ui.js ======
    '关闭对话框': 'Close Dialog', '手动输入': 'Manual Input',
    '的 1RM': '\'s 1RM',
    '（未设1RM）': '(no 1RM set)',
    '— 选择动作 —': '— Select Exercise —',
    '本行负荷单位：kg=外部重量（计吨位，可设%1RM）；BW=自重（计次不计吨位）；m=距离；s=时间；—=无负荷（计次不计吨位）': 'Row load unit: kg=external weight (counts tonnage, supports %1RM); BW=bodyweight (counts reps, no tonnage); m=distance; s=time; —=no load (counts reps, no tonnage)',
    '次': 'reps',
    '待设1RM': 'Unset 1RM',
    '无负荷': 'No Load', '自重': 'Bodyweight',
    '高速': 'High Speed', '中速': 'Medium Speed', '带': 'band',
    '复杂训练 ${...}': 'Complex Training ${...}',
    '个动作 · 共享': 'exercises · shared',
    '块内全部动作共享的正式组组数': 'Shared working sets for all exercises in the block',
    '组正式': 'working sets', '解散复杂训练': 'Dissolve Complex Training',
    '该组 %1RM': 'This set\'s %1RM',
    '该组重量（留空按 %1RM 折算）': 'This set\'s weight (blank = auto from %1RM)',
    '删除该组': 'Delete this set',
    '单组量': 'Per-set Volume', '重量kg': 'Weight (kg)',
    '本行负荷': 'Row Load',
    '勾选后可组成复杂训练': 'Check to form a complex training',
    '复杂训练 ${...} · 第 ${...} 个动作': 'Complex Training ${...} · Exercise ${...}',
    '任何以 kg 为单位的动作都可设置 %1RM': 'Any kg exercise can use %1RM',
    '第一步：选动作分类（全部分类=列出所有动作）': 'Step 1: pick a category ("All" lists everything)',
    '逐组展开/收起（热身组+正式组，负荷全部计入）': 'Expand/collapse per set (warm-up + working, all counted)',
    '逐组设计（热身 ${warmN} 组 · 正式 ${workN} 组 · 全部计入负荷）': 'Per-set design (warm-up ${warmN} · working ${workN} · all counted)',
    '计划吨位': 'Planned Tonnage',
    '组成复杂训练（${picked.size}）': 'Form Complex Training (${picked.size})',
    '勾选 2 个及以上动作可组成复杂训练（共享正式组组数，各自动作剂量独立）': 'Select 2+ exercises to form a complex training (shared working sets, independent dosing)',
    '＋ 添加动作': '+ Add Exercise',
    '计划重量按每人 1RM 内部换算（此处只显示 %1RM）· 实际重量课后按人填写': 'Planned weight auto-converts from each athlete\'s 1RM (only %1RM shown here) · actual weight entered post-session per athlete',
    '重量按 ${rmContext()} 计算': 'Weight by ${rmContext()}',
    '单位可选：kg 重量（计吨位）/ BW 自重（计次）/ m 距离 / s 时间 / — 无负荷（计次不计吨位）；点击 ▸ 可逐组设计热身+正式组': 'Units: kg weight (tonnage) / BW bodyweight (reps) / m distance / s time / — no load (reps); click ▸ for per-set warm-up + working design',
    '已组成复杂训练（共享 ${...} 组正式）': 'Complex formed (shared ${...} working sets)',
    '当前训练计划暂无运动员，请先在「运动员档案」中添加。': 'No athletes in the current plan — add them in Athlete Profiles first.',
    '选择备赛运动员 · ${scope}': 'Select Roster Athletes · ${scope}',
    '选择备赛运动员': 'Select Roster Athletes',
    '主': 'Primary', '次': 'Secondary',
    '训练目标涵盖 · 点击目标循环：未选 → 主要 → 次要 → 未选': 'Training goals · click to cycle: None → Primary → Secondary → None',
    '新大分类名称': 'New Category Name',
    '＋ 添加大分类': '+ Add Category',
    '新增分类自动分配不重复颜色': 'New categories auto-assign unique colors',
    '自定义目标名称': 'Custom Goal Name',
    '＋ 添加自定义目标': '+ Add Custom Goal',
    '已选 · 主要 ${sel.primary.length} 项 · 次要 ${sel.secondary.length} 项': 'Selected · Primary ${sel.primary.length} · Secondary ${sel.secondary.length}',
    '请填写大分类名称': 'Category name is required',
    '该大分类已存在': 'This category already exists',
    '大分类「${name}」已添加': 'Category "${name}" added',
    '请填写目标名称': 'Goal name is required',
    '该目标已存在': 'This goal already exists',
    '自定义目标已添加': 'Custom goal added',
    // ====== i18n 补漏：store 训练模块 ======
    '综合体能': 'Comprehensive S&C', '循环代谢': 'Circuit/Metabolic',
    '技术战术': 'Technique/Tactics', '恢复与再生': 'Recovery & Regeneration',
    '柔韧灵活性': 'Flexibility/Mobility', '心理认知': 'Psychology/Cognition',
    '反应决策': 'Reaction/Decision', '体重管控': 'Weight Management',
    '测试/比赛': 'Testing/Competition',
    '下肢力量': 'Lower Body Strength', '上肢力量': 'Upper Body Strength',
    '全身爆发力': 'Full-body Power', '核心与躯干': 'Core & Trunk',
    '能量系统': 'Energy Systems', '速度与敏捷': 'Speed & Agility',
    '拉伸': 'Stretching', '筋膜放松': 'Fascia Release', '呼吸训练': 'Breathing Training',
    // ====== i18n 补漏：kpiLab 图型 desc/表头 ======
    '序列': 'Series', '数据点': 'Data Points', '判定': 'Significance',
    '基线（日期）': 'Baseline (date)', '当前（日期）': 'Current (date)',
    '变化（正=变好）': 'Change (+ = better)', '变化率': 'Change Rate',
    '提示：': 'Tip: ',
    '当前图型无法展示该数据，请切换其他图型': 'The current chart type can\'t display this data — switch to another type',
    '体重 × ${m.label}相对值': 'Body Weight × ${m.label} Relative',
    // ====== i18n 补漏：macro 准备水平 ======
    '基础': 'Base',
  };

  // ---------- 英文动态规整：日期/量词 ----------
  const EN_PATTERNS = [
    [/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, '$1-$2-$3'],
    [/(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, '$1/$2'],
    [/(\d+)\s*个?月/g, '$1 mo'],
    [/第\s*(\d+)\s*周/g, 'W$1'],
    [/第\s*(\d+)\s*名/g, '#$1'],
    [/共\s*(\d+)\s*场/g, '$1 games'],
    [/(\d+)\s*周/g, '$1 wk'],
    [/(\d+)\s*天/g, '$1 d'],
    [/(\d+)\s*小时/g, '$1 h'],
    [/(\d+)\s*分钟/g, '$1 min'],
    [/(\d+)\s*名运动员/g, '$1 athletes'],
    [/(\d+)\s*位运动员/g, '$1 athletes'],
    [/(\d+)\s*名队员/g, '$1 athletes'],
    [/(\d+)\s*人次/g, '$1 attendances'],
    [/(\d+)\s*名/g, '$1 '],
    [/(\d+)\s*人/g, '$1 athletes'],
    [/(\d+)\s*节课/g, '$1 sessions'],
    [/(\d+)\s*节/g, '$1 sessions'],
    [/(\d+)\s*条数据/g, '$1 records'],
    [/(\d+)\s*条/g, '$1'],
    [/(\d+)\s*个(数据点|项目|计划|中周期|小周期)/g, '$1 '],
    [/(\d+)\s*项/g, '$1 items'],
    [/(\d+)\s*份/g, '$1'],
    [/(\d+)\s*个/g, '$1 '],
    [/周一/g, 'Mon'], [/周二/g, 'Tue'], [/周三/g, 'Wed'], [/周四/g, 'Thu'],
    [/周五/g, 'Fri'], [/周六/g, 'Sat'], [/周日/g, 'Sun'],
    // 数词后的英文名词复数规整（词典把「大周期/运动员」等译为单数后，按数量补复数）
    [/(\d+)\s+(Athlete|Macrocycle|Mesocycle|Microcycle|Session|Item|Record|Game)s?\b/g,
      (m, n, w) => (+n === 1 ? `${n} ${w}` : `${n} ${w}s`)]
  ];

  // ---------- 核心翻译 ----------
  let twWordRe = null, s2tRe = null, enRe = null;

  function buildRegexes() {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    twWordRe = new RegExp(Object.keys(TW_WORDS).sort((a, b) => b.length - a.length).map(esc).join('|'), 'g');
    s2tRe = new RegExp('[' + Object.keys(S2T).map(esc).join('') + ']', 'g');
    enRe = new RegExp(Object.keys(EN).sort((a, b) => b.length - a.length).map(esc).join('|'), 'g');
  }

  function toTraditional(text) {
    // 单位词中的「里」不转「裡」：先用私用区占位，逐字映射后还原
    const UNITS = ['公里', '厘米', '毫米', '英里', '海里'];
    let s = String(text);
    s = s.replace(/[公厘毫英海]?里/g, (m) => (UNITS.includes(m) ? '\uE000' + UNITS.indexOf(m) : m));
    s = s.replace(twWordRe, (m) => TW_WORDS[m]).replace(s2tRe, (m) => S2T[m] || m);
    return s.replace(/\uE000(\d)/g, (_, i) => UNITS[+i]);
  }

  function toEnglish(text) {
    let out = String(text);
    // 词典必须先于标点规整：词条保留全角标点原文，否则长句在标点替换后无法匹配
    out = out.replace(enRe, (m) => EN[m] != null ? EN[m] : m);
    for (const [re, rp] of EN_PATTERNS) out = out.replace(re, rp);
    // 残留中文标点
    out = out.replace(/[，；：、（）]/g, (m) => ({ '，': ', ', '；': '; ', '：': ': ', '、': ', ', '（': '(', '）': ')' }[m]));
    return out;
  }

  function t(text) {
    if (text == null) return text;
    const s = String(text);
    if (locale === 'zh-TW') return toTraditional(s);
    if (locale === 'en') return toEnglish(s);
    return s;
  }

  // ---------- DOM 翻译 ----------
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'KBD', 'SAMP']);
  const I18N_ATTRS = ['placeholder', 'title', 'aria-label'];

  function isOff(node) {
    let el = node && node.nodeType === 3 ? node.parentElement : node;
    return el && el.closest && el.closest('[data-i18n="off"],.no-i18n');
  }

  function pinOptionValues(select) {
    select.querySelectorAll('option').forEach((op) => {
      if (!op.hasAttribute('value')) op.setAttribute('value', op.textContent);
    });
  }

  function apply(root) {
    if (locale === 'zh-CN' || !root) return;
    applying = true;
    try {
      const scope = root.nodeType === 9 || root === document.documentElement || root === document.body ? document.body : root;
      // 1) 下拉：先钉住原始 value（保证英文模式下表单取值仍是中文枚举），再翻译展示文本
      const selects = scope.nodeType === 1 ? scope.matches && scope.matches('select') ? [scope] : [] : [];
      selects.push(...((scope.nodeType === 1 && scope.querySelectorAll ? scope.querySelectorAll('select') : [])));
      selects.forEach((sel) => {
        pinOptionValues(sel);
        sel.querySelectorAll('option').forEach((op) => { if (!isOff(op)) op.textContent = t(op.textContent); });
      });
      // 2) 文本节点
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          const p = n.parentElement;
          if (!p || SKIP_TAGS.has(p.tagName) || p.tagName === 'OPTION') return NodeFilter.FILTER_REJECT;
          if (isOff(n)) return NodeFilter.FILTER_REJECT;
          if (!n.nodeValue || !/[㐀-鿿]/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const targets = [];
      let cur;
      while ((cur = walker.nextNode())) targets.push(cur);
      targets.forEach((n) => { n.nodeValue = t(n.nodeValue); });
      // 3) 属性
      const ew = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT, null);
      const els = [];
      let ce;
      while ((ce = ew.nextNode())) els.push(ce);
      els.forEach((el) => {
        if (isOff(el)) return;
        for (const a of I18N_ATTRS) {
          const v = el.getAttribute(a);
          if (v && /[㐀-鿿]/.test(v)) el.setAttribute(a, t(v));
        }
      });
    } finally {
      applying = false;
    }
  }

  function applyNode(node) {
    if (!node || locale === 'zh-CN') return;
    if (node.nodeType === 1) {
      if (node.tagName === 'OPTION') {
        const sel = node.closest('select');
        if (sel && !node.hasAttribute('value')) node.setAttribute('value', sel.multiple ? '' : node.textContent);
        if (!isOff(node)) node.textContent = t(node.textContent);
      } else apply(node);
    } else if (node.nodeType === 3 && !isOff(node)) {
      const p = node.parentElement;
      if (p && !SKIP_TAGS.has(p.tagName) && p.tagName !== 'OPTION' && /[㐀-鿿]/.test(node.nodeValue)) node.nodeValue = t(node.nodeValue);
    }
  }

  function observe() {
    if (observed || !document.body) return;
    observed = true;
    // 合并队列：任何时刻到期的变更批次都并入 pending，绝不一弃了之。
    // 背景（顶栏时钟每秒写文本节点）会让「rAF 未执行期间丢弃新批次」的旧写法随机丢掉
    // 用户触发的重渲染（设置页签点击后翻译时有时无），合并后每次 rAF 处理全部积压变更
    const pending = [];
    let rafId = null;
    const mo = new MutationObserver((muts) => {
      if (locale === 'zh-CN' || applying) return;
      pending.push(...muts);
      if (rafId != null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        applying = true;
        try {
          pending.splice(0).forEach((m) => {
            if (m.type === 'childList') m.addedNodes.forEach(applyNode);
            else if (m.type === 'characterData' && m.target) applyNode(m.target);
          });
        } finally { applying = false; }
      });
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function init(loc) {
    if (loc && LOCALES.some((x) => x.id === loc)) locale = loc;
    document.documentElement.lang = locale;
    observe();
  }

  async function setLocale(loc) {
    if (!LOCALES.some((x) => x.id === loc) || loc === locale) return;
    locale = loc;
    document.documentElement.lang = loc;
    // 必须等待主进程真正写完 db.json 再重渲染：否则渲染中的懒加载会用旧库回写，造成语言设置丢失
    try {
      if (typeof Store !== 'undefined' && Store.data && Store.data.settings) {
        Store.data.settings.locale = loc;
        if (typeof Store.persist === 'function') await Store.persist();
        else Store.save();
        Store.rev++;
      }
    } catch (e) { /* Store 未就绪时忽略，调用方负责持久化 */ }
    // 无刷新切换：不重载页面。由 app.js 监听该事件重渲染导航与当前视图（模板输出原始简体），
    // 再对新 DOM 应用新语言翻译；图表随视图重挂载自动重绘，滚动位置与页面状态得以保留
    document.dispatchEvent(new CustomEvent('i18n:changed'));
  }

  buildRegexes();
  return { LOCALES, init, setLocale, apply, applyNode, t, get locale() { return locale; } };
})();
// 顶层 const 不自动挂 window：显式暴露，供 window.I18n 守卫判断（app.js/ui.js 中懒加载兼容）
window.I18n = I18n;
