const { buildHospitalRecommendations, formatRegionName } = require('./hospitals');
const costReference = require('../data/cost-reference.common.json');
const hubeiCityOverrides = require('../data/cost-reference.hubei.city-overrides.json');
const hubeiCityFactors = require('../data/cost-reference.hubei.city-factors.json');

const GENERIC_TRIAGE_QUESTIONS = [
  { id: 'g_duration', text: '这种不舒服大概持续多久了？', options: ['不到1天', '1-3天', '超过1周', '反复超过1个月'] },
  { id: 'g_location', text: '最不舒服主要在什么部位？', options: ['头/眼', '胸口/心口', '肚子/胃', '腰背/四肢', '说不清'] },
  { id: 'g_trend', text: '最近是越来越重，还是差不多？', options: ['在加重', '差不多', '在减轻'] },
  { id: 'g_frequency', text: '出现频率大概怎样？', options: ['偶尔', '一天几次', '几乎每天', '持续不缓解'] },
  { id: 'g_accompany', text: '有没有明显伴随情况？', options: ['发热', '呕吐/腹泻', '胸闷/气短', '头晕/无力', '没有明显伴随'] },
  { id: 'g_history', text: '你有长期慢性病或长期用药吗？', options: ['没有', '高血压/糖尿病', '心脑血管病', '其他慢病/长期用药'] },
  { id: 'g_trigger', text: '症状和什么有关会更明显？', options: ['活动后', '进食后', '夜间', '压力/熬夜后', '说不清'] },
  { id: 'g_redflag', text: '有没有出现明显危险信号？', options: ['没有', '胸痛或呼吸困难', '黑便/便血/呕血', '说话不清/肢体无力'] },
];

const COMMON_BASE_CHECKS = [
  { name: '挂号费', min: 10, max: 40 },
  { name: '基础问诊/查体', min: 0, max: 30 },
  { name: '血常规', min: 20, max: 40 },
  { name: '基础生化', min: 40, max: 90 },
];

const SPECIALTY_QUESTION_SETS = {
  ent: [
    { id: 'ent_main', text: '你现在最困扰的是鼻子、喉咙还是耳朵？', options: ['鼻子为主', '喉咙为主', '耳朵为主', '都有'] },
    { id: 'ent_days', text: '这个问题持续多久了？', options: ['不到3天', '3-7天', '超过1周', '反复发作'] },
    { id: 'ent_fever', text: '有没有发热或吞咽明显困难？', options: ['没有', '有发热', '吞咽困难', '两者都有'] },
    { id: 'ent_discharge', text: '有没有明显鼻涕、痰或耳部分泌物？', options: ['没有', '清涕/白痰', '黄稠分泌物', '带血丝'] },
    { id: 'ent_voice', text: '声音嘶哑或耳鸣有没有加重趋势？', options: ['没有', '有一点', '明显加重'] },
  ],
  neurology: [
    { id: 'neuro_main', text: '主要是头痛头晕，还是麻木无力更明显？', options: ['头痛头晕', '麻木无力', '都明显', '说不清'] },
    { id: 'neuro_onset', text: '这次是突然发作还是慢慢出现？', options: ['突然发作', '慢慢出现', '反复发作'] },
    { id: 'neuro_side', text: '症状有没有偏一侧（单侧）？', options: ['没有', '左侧明显', '右侧明显', '不确定'] },
    { id: 'neuro_speech', text: '有没有说话不清、走路不稳或视物旋转？', options: ['没有', '偶尔有', '比较明显'] },
    { id: 'neuro_progress', text: '最近是在加重还是缓解？', options: ['在加重', '差不多', '在缓解'] },
  ],
  endocrinology: [
    { id: 'endo_main', text: '更像血糖问题还是甲状腺相关不适？', options: ['血糖方向', '甲状腺方向', '两者都有', '不确定'] },
    { id: 'endo_drink', text: '最近有没有明显口渴、多尿、体重变化？', options: ['没有', '有1项', '有2项及以上'] },
    { id: 'endo_fatigue', text: '乏力、心慌、怕冷/怕热是否明显？', options: ['不明显', '有一点', '比较明显'] },
    { id: 'endo_duration', text: '这种状态持续多久了？', options: ['不到1周', '1-4周', '超过1个月', '反复'] },
    { id: 'endo_history', text: '以前有糖尿病、甲状腺病或长期用药吗？', options: ['没有', '有其一', '两者/多项都有'] },
  ],
  gynecology: [
    { id: 'gyn_main', text: '这次主要是月经异常、白带异常还是下腹痛？', options: ['月经异常', '白带异常', '下腹痛', '不止一种'] },
    { id: 'gyn_cycle', text: '月经周期和经量和以前比变化大吗？', options: ['变化不大', '有些变化', '变化很明显'] },
    { id: 'gyn_bleed', text: '有没有非经期出血或同房后出血？', options: ['没有', '偶尔有', '比较明显'] },
    { id: 'gyn_pain', text: '腹痛是偶发还是持续加重？', options: ['偶发', '持续但不重', '持续加重'] },
    { id: 'gyn_fever', text: '有没有发热、异味分泌物或明显不适？', options: ['没有', '有一项', '有多项'] },
  ],
  obstetrics: [
    { id: 'obs_week', text: '目前大概在孕期哪个阶段？', options: ['早孕期', '中孕期', '晚孕期', '产后'] },
    { id: 'obs_bleed', text: '有没有见红、流水（破水）或腹痛？', options: ['没有', '有其一', '有两项及以上'] },
    { id: 'obs_move', text: '胎动和以前比有没有明显减少？', options: ['无变化', '有点少', '明显减少', '不适用'] },
    { id: 'obs_pressure', text: '有没有头痛眼花、血压高或下肢明显水肿？', options: ['没有', '有一点', '比较明显'] },
    { id: 'obs_progress', text: '症状是稳定、加重还是缓解？', options: ['稳定', '加重', '缓解'] },
  ],
  pediatrics: [
    { id: 'ped_age', text: '孩子大概年龄段是？', options: ['0-1岁', '1-3岁', '3-12岁', '12岁以上'] },
    { id: 'ped_main', text: '主要问题是发热、咳嗽还是胃肠道不适？', options: ['发热', '咳嗽', '呕吐/腹泻', '不止一种'] },
    { id: 'ped_temp', text: '体温大概到多少？', options: ['不发热', '38度以下', '38-39度', '39度以上'] },
    { id: 'ped_state', text: '精神状态和进食情况怎么样？', options: ['基本正常', '有点差', '明显差'] },
    { id: 'ped_duration', text: '症状持续多久了？', options: ['不到1天', '1-3天', '超过3天', '反复发作'] },
  ],
  nephrology: [
    { id: 'neph_main', text: '现在更明显的是水肿、尿量变化还是化验异常？', options: ['水肿', '尿量变化', '化验异常', '都有'] },
    { id: 'neph_urine', text: '小便有没有泡沫多、颜色异常或明显变少？', options: ['没有', '有其一', '有多项'] },
    { id: 'neph_bp', text: '近期血压有没有偏高或波动明显？', options: ['没有', '偶尔高', '经常偏高'] },
    { id: 'neph_edema', text: '眼睑/下肢水肿是偶发还是持续？', options: ['没有', '偶发', '持续明显'] },
    { id: 'neph_history', text: '既往有肾病、糖尿病或长期止痛药使用吗？', options: ['没有', '有其一', '有多项'] },
  ],
  hepatobiliary: [
    { id: 'hb_main', text: '主要是上腹痛、黄疸，还是体检肝功异常？', options: ['上腹痛', '黄疸', '肝功异常', '不止一种'] },
    { id: 'hb_trigger', text: '和油腻饮食或饮酒后关系明显吗？', options: ['不明显', '有一点', '比较明显'] },
    { id: 'hb_digest', text: '有没有恶心、呕吐、食欲差或腹胀？', options: ['没有', '有1项', '有2项及以上'] },
    { id: 'hb_fever', text: '有没有发热或疼痛明显加重？', options: ['没有', '有一点', '比较明显'] },
    { id: 'hb_history', text: '既往有肝胆胰疾病或结石病史吗？', options: ['没有', '有其一', '有多项'] },
  ],
  orthopedics: [
    { id: 'ortho_site', text: '主要是哪个部位疼痛或不舒服？', options: ['颈肩', '腰背', '膝/踝', '手臂/手腕'] },
    { id: 'ortho_cause', text: '和外伤、扭伤或负重劳累有关吗？', options: ['没有', '有一点关系', '关系明显'] },
    { id: 'ortho_move', text: '活动时会更痛还是休息也痛？', options: ['活动更痛', '休息也痛', '都差不多'] },
    { id: 'ortho_swelling', text: '有没有肿胀、发热或活动受限？', options: ['没有', '有一项', '有多项'] },
    { id: 'ortho_duration', text: '持续多久了？', options: ['不到3天', '3-7天', '超过1周', '反复'] },
  ],
  rheumatology: [
    { id: 'rheum_joint', text: '主要是哪些关节不舒服？', options: ['手指/手腕', '膝踝', '多关节', '说不清'] },
    { id: 'rheum_morning', text: '早晨僵硬持续时间大概多久？', options: ['没有晨僵', '30分钟内', '30-60分钟', '超过1小时'] },
    { id: 'rheum_swelling', text: '有没有关节肿胀、发热或压痛？', options: ['没有', '有一点', '比较明显'] },
    { id: 'rheum_repeat', text: '这种情况是偶发还是反复发作？', options: ['偶发', '间断反复', '持续存在'] },
    { id: 'rheum_other', text: '是否伴皮疹、口腔溃疡或乏力？', options: ['没有', '有1项', '有2项及以上'] },
  ],
  psychiatry: [
    { id: 'psy_main', text: '目前更困扰的是焦虑、情绪低落还是睡眠问题？', options: ['焦虑为主', '情绪低落为主', '睡眠问题为主', '都有'] },
    { id: 'psy_duration', text: '这种状态持续多久了？', options: ['不到1周', '1-4周', '超过1个月', '反复发作'] },
    { id: 'psy_impact', text: '对工作生活影响大吗？', options: ['影响不大', '有一定影响', '影响很明显'] },
    { id: 'psy_body', text: '是否伴心慌、胸闷、食欲或精力变化？', options: ['没有', '有一项', '有多项'] },
    { id: 'psy_safety', text: '有没有出现伤害自己或他人的想法？', options: ['没有', '偶尔出现', '比较明显'] },
  ],
  oncology: [
    { id: 'onco_main', text: '这次最担心的是肿块、消瘦还是持续不明原因不适？', options: ['肿块', '消瘦', '长期不适', '不止一种'] },
    { id: 'onco_growth', text: '相关症状是稳定还是在进展？', options: ['基本稳定', '缓慢进展', '明显进展'] },
    { id: 'onco_systemic', text: '有没有低热、盗汗、乏力等全身表现？', options: ['没有', '有1项', '有多项'] },
    { id: 'onco_family', text: '家族里有类似肿瘤病史吗？', options: ['没有', '有其一', '不清楚'] },
    { id: 'onco_history', text: '既往体检或影像提示异常吗？', options: ['没有', '有但未复查', '有且在随访'] },
  ],
  hematology: [
    { id: 'hema_main', text: '主要是贫血乏力、出血倾向还是化验异常？', options: ['贫血乏力', '出血倾向', '化验异常', '不止一种'] },
    { id: 'hema_bleed', text: '有没有鼻出血、牙龈出血或皮下淤青？', options: ['没有', '偶尔有', '比较明显'] },
    { id: 'hema_infect', text: '近期是否反复发热或感染？', options: ['没有', '偶尔', '反复明显'] },
    { id: 'hema_duration', text: '症状持续多久了？', options: ['不到1周', '1-4周', '超过1个月', '反复'] },
    { id: 'hema_report', text: '有没有既往血常规异常记录？', options: ['没有', '有一次', '多次异常'] },
  ],
  anorectal: [
    { id: 'ano_main', text: '主要是不适是疼痛、出血还是坠胀？', options: ['疼痛', '出血', '坠胀', '都有'] },
    { id: 'ano_stool', text: '和排便关系明显吗？', options: ['关系不大', '排便时明显', '排便后仍明显'] },
    { id: 'ano_bleed', text: '出血量大概如何？', options: ['没有出血', '纸上带血', '滴血较多', '不确定'] },
    { id: 'ano_constipation', text: '近期有便秘或排便费力吗？', options: ['没有', '有一点', '比较明显'] },
    { id: 'ano_duration', text: '这种情况持续多久？', options: ['不到3天', '3-7天', '超过1周', '反复发作'] },
  ],
  dentistry: [
    { id: 'den_main', text: '主要是牙痛、牙龈肿还是口腔溃疡？', options: ['牙痛', '牙龈肿', '口腔溃疡', '不止一种'] },
    { id: 'den_hotcold', text: '遇冷热是否会明显加重？', options: ['不会', '有一点', '非常明显'] },
    { id: 'den_night', text: '夜间疼痛是否更明显影响睡眠？', options: ['没有', '有一点', '比较明显'] },
    { id: 'den_swallow', text: '有没有面部肿胀、发热或张口困难？', options: ['没有', '有一项', '有多项'] },
    { id: 'den_duration', text: '这次持续多久了？', options: ['不到3天', '3-7天', '超过1周', '反复'] },
  ],
  dermatology: [
    { id: 'derm_main', text: '主要是痒、痛，还是皮疹扩散更明显？', options: ['痒为主', '痛为主', '扩散为主', '都有'] },
    { id: 'derm_area', text: '受累范围大概怎样？', options: ['局部小范围', '多处散在', '范围较大'] },
    { id: 'derm_trigger', text: '近期有换护肤品、药物或可疑过敏接触吗？', options: ['没有', '有可疑因素', '不确定'] },
    { id: 'derm_fluid', text: '有没有渗液、结痂或化脓？', options: ['没有', '有一点', '比较明显'] },
    { id: 'derm_duration', text: '这种皮肤问题持续多久了？', options: ['不到3天', '3-7天', '超过1周', '反复'] },
  ],
  breastThyroid: [
    { id: 'bt_main', text: '主要是乳房问题还是甲状腺/颈前肿块问题？', options: ['乳房为主', '甲状腺为主', '两者都有'] },
    { id: 'bt_lump', text: '肿块大小或硬度最近有变化吗？', options: ['没有明显变化', '有一点变化', '变化明显'] },
    { id: 'bt_pain', text: '是否伴疼痛、压痛或不适加重？', options: ['没有', '有一点', '比较明显'] },
    { id: 'bt_cycle', text: '乳房不适与月经周期相关吗？', options: ['相关明显', '关系不大', '不适用/不确定'] },
    { id: 'bt_report', text: '有没有做过彩超或甲功检查？', options: ['没有', '做过一次', '已多次复查'] },
  ],
};

const RED_FLAG_KEYWORDS = [
  '胸痛加重',
  '呼吸困难',
  '意识模糊',
  '意识障碍',
  '剧烈头痛',
  '肢体无力',
  '抽搐',
  '便血大量',
  '黑便伴头晕',
  '黑便',
  '柏油样便',
  '柏油便',
  '呕血',
  '血便',
  '上消化道出血',
  '说话不清',
  '口角歪斜',
  '单侧肢体无力',
  '一侧肢体无力',
  '突发言语不清',
  '突发偏瘫',
  '突发剧烈头痛',
  '持续高热',
  '面口歪斜',
  '偏瘫',
  '单侧麻木',
  '胸闷胸痛',
  '冷汗',
  '濒死感',
  '喘不过气',
  '嘴唇发紫',
  '低血压',
  '休克',
  '喉头水肿',
  '咽喉紧缩',
  '全身风团',
  '高热不退',
  '神志改变',
  '反跳痛',
  '腹膜刺激征',
  '刀割样腹痛',
  '大量出血',
  '外伤后意识不清',
  '持续抽搐',
  '停经后出血',
  '阴道大出血',
  '剧烈下腹痛伴停经',
  '胎动明显减少',
  '破水',
  '产后大出血',
  '高热惊厥',
  '婴幼儿呼吸急促',
  '儿童持续抽搐',
  '意识淡漠',
  '自杀',
  '轻生',
  '自残',
  '伤人',
  '幻觉',
  '妄想',
];

const SCENARIOS = {
  cardio: {
    id: 'cardio',
    label: '心慌/胸闷/头晕/高血压相关',
    keywords: ['心慌', '胸闷', '头晕', '血压高', '心跳快', '胸口堵'],
    department: '心血管内科',
    hospitalLevel: '县人民医院起步，症状加重建议市级综合医院',
    preparation: ['身份证', '医保卡/医保电子凭证', '既往血压记录', '既往心电图/化验单', '正在服用药物清单'],
    baseChecks: [
      { name: '挂号费', min: 10, max: 40 },
      { name: '血压测量', min: 0, max: 10 },
      { name: '血常规', min: 20, max: 40 },
      { name: '生化+肾功能', min: 50, max: 120 },
    ],
    nextStepRules: [
      '如果基础化验异常，再考虑心电图/心脏彩超。',
      '如果血压持续明显升高并伴不适，再考虑24小时动态血压。',
    ],
    questions: [
      { id: 'chestPain', text: '发作时胸口会不会疼，或者像被压着一样难受？', options: ['没有', '偶尔', '持续存在'] },
      { id: 'breath', text: '一活动会不会比平时更喘？', options: ['不会', '有一点', '明显会'] },
      { id: 'dizzy', text: '有没有头晕、眼前发黑，或者差点站不住？', options: ['没有', '偶尔有', '比较明显'] },
      { id: 'duration', text: '这种不舒服大概有多久了？', options: ['不到1天', '1-3天', '超过1周', '反复超过1个月'] },
      { id: 'frequency', text: '这种心慌或胸闷现在出现得多吗？', options: ['偶尔一次', '一天几次', '几乎每天都有'] },
      { id: 'palpitationTime', text: '心慌一般更容易在什么时候出来？', options: ['活动后', '休息时', '晚上更明显', '说不准'] },
      { id: 'history', text: '以前查出过高血压或者心脏方面的问题吗？', options: ['没有', '有高血压', '有心脏病', '两者都有'] },
      { id: 'sweat', text: '发作的时候，会不会冒冷汗、手发抖或者心里特别慌？', options: ['不会', '偶尔会', '比较明显'] },
    ],
  },
  lumbar: {
    id: 'lumbar',
    label: '腰酸/腰痛/腿麻',
    keywords: ['腰酸', '腰痛', '腿麻', '腰背痛', '闪腰'],
    department: '骨科（伴尿路症状时考虑泌尿外科）',
    hospitalLevel: '县医院骨科起步，出现进行性无力建议市医院',
    preparation: ['身份证', '医保卡', '既往腰椎片子或报告', '近期外伤经过'],
    baseChecks: [
      { name: '挂号费', min: 10, max: 40 },
      { name: '体格检查', min: 0, max: 20 },
      { name: '基础尿检', min: 20, max: 35 },
      { name: '腰椎X线（按需）', min: 80, max: 180 },
    ],
    nextStepRules: [
      '如果腿麻加重或力量下降，再考虑腰椎MRI。',
      '如果伴尿频尿痛或发热，优先补做泌尿系统检查。',
    ],
    questions: [
      { id: 'trauma', text: '最近有没有闪到腰、搬重东西，或者摔过碰过？', options: ['没有', '有'] },
      { id: 'numbness', text: '腿上有没有发麻，或者走路发软？', options: ['没有', '有一点', '明显有'] },
      { id: 'position', text: '这个腰酸，主要偏左边、右边，还是正中间？', options: ['左边', '右边', '中间', '说不清'] },
      { id: 'style', text: '更像酸胀，还是针扎一样痛？', options: ['酸胀', '刺痛', '酸痛都有'] },
      { id: 'duration', text: '这个腰酸腰痛大概多久了？', options: ['不到3天', '3-7天', '超过1周', '反复超过1个月'] },
      { id: 'movePain', text: '是动一动更痛，还是坐着躺着也明显？', options: ['动一动更痛', '休息时也明显', '差不多'] },
      { id: 'morning', text: '早上刚起床时，会不会更僵、更酸？', options: ['不会', '有一点', '比较明显'] },
    ],
  },
  digestive: {
    id: 'digestive',
    label: '肚子痛/胃不舒服/消化问题',
    keywords: ['肚子痛', '胃不舒服', '胃痛', '反酸', '拉肚子', '恶心', '黑便', '柏油样便', '便血', '呕血'],
    department: '消化内科',
    hospitalLevel: '先县医院，持续加重可转市医院消化专科',
    preparation: ['身份证', '医保卡', '近期饮食和用药情况', '既往胃镜/幽门螺杆菌结果'],
    baseChecks: [
      { name: '挂号费', min: 10, max: 40 },
      { name: '腹部查体', min: 0, max: 20 },
      { name: '血常规', min: 20, max: 40 },
      { name: '粪便常规/隐血（按需）', min: 20, max: 50 },
    ],
    nextStepRules: [
      '如果基础检查异常或症状迁延，再考虑腹部B超/胃镜。',
      '如果黑便、呕血或持续高热，建议尽快急诊。',
    ],
    questions: [
      { id: 'stool', text: '这几天大便有没有变化，比如拉肚子或者发黑？', options: ['没有', '腹泻', '黑便', '便秘'] },
      { id: 'fever', text: '有没有发热，或者反复想吐？', options: ['没有', '有发热', '有呕吐', '两者都有'] },
      { id: 'location', text: '主要是胃口上面难受，还是肚脐周围更明显？', options: ['上腹', '肚脐周围', '下腹', '不固定'] },
      { id: 'eatRel', text: '和吃饭有关系吗？', options: ['饭前更明显', '饭后更明显', '关系不大'] },
      { id: 'appetite', text: '最近胃口怎么样？', options: ['和平时差不多', '有点差', '明显吃不下'] },
      { id: 'bloat', text: '会不会反酸、胀气，或者烧心得厉害？', options: ['没有', '有一点', '比较明显'] },
      { id: 'meal', text: '是不是吃了油腻辛辣以后会更明显？', options: ['油腻辛辣后更明显', '和平时差不多', '说不清'] },
      { id: 'nightPain', text: '晚上或者空肚子的时候，会不会更难受？', options: ['不会', '有一点', '比较明显'] },
    ],
  },
  urinary: {
    id: 'urinary',
    label: '尿频/尿急/尿痛',
    keywords: ['尿频', '尿急', '尿痛', '小便疼', '夜尿多'],
    department: '泌尿外科（女性可先全科/内科分诊）',
    hospitalLevel: '县医院泌尿外科起步，伴发热腰痛可上级医院',
    preparation: ['身份证', '医保卡', '近期尿检结果', '既往泌尿系统病史'],
    baseChecks: [
      { name: '挂号费', min: 10, max: 40 },
      { name: '尿常规', min: 20, max: 35 },
      { name: '肾功能/炎症指标', min: 40, max: 90 },
      { name: '泌尿系B超（按需）', min: 80, max: 180 },
    ],
    nextStepRules: [
      '如果尿常规提示感染，再按医生建议做尿培养。',
      '如果反复发作或伴血尿，再考虑进一步影像检查。',
    ],
    questions: [
      { id: 'blood', text: '你有没有看到尿里带红色，或者像血丝一样？', options: ['没有', '有一点', '明显有'] },
      { id: 'fever', text: '这几天有没有发烧，或者腰背那边跟着疼？', options: ['没有', '有发烧', '有腰背痛', '两者都有'] },
      { id: 'pain', text: '小便的时候，会不会刺痛或者烧得慌？', options: ['不会', '有一点', '明显疼'] },
      { id: 'duration', text: '这种情况大概持续多久了？', options: ['不到3天', '3-7天', '超过1周', '反复超过1个月'] },
      { id: 'night', text: '晚上起夜是不是比平时多了？', options: ['没有明显变化', '多一点', '明显多很多'] },
      { id: 'repeat', text: '以前有没有反复闹过这种小便不舒服？', options: ['没有', '偶尔有过', '经常反复'] },
      { id: 'water', text: '多喝水以后，会不会稍微好一点？', options: ['会', '变化不大', '反而更不舒服'] },
    ],
  },
  respiratory: {
    id: 'respiratory',
    label: '咳嗽/发热/呼吸道不适',
    keywords: ['咳嗽', '发热', '嗓子痛', '呼吸道', '咳痰'],
    department: '呼吸内科',
    hospitalLevel: '先县医院呼吸内科，气促明显可直接急诊',
    preparation: ['身份证', '医保卡', '体温记录', '近期胸片/血常规结果'],
    baseChecks: [
      { name: '挂号费', min: 10, max: 40 },
      { name: '体温/血氧测量', min: 0, max: 15 },
      { name: '血常规', min: 20, max: 40 },
      { name: 'CRP（按需）', min: 30, max: 70 },
    ],
    nextStepRules: [
      '如果持续高热或咳喘明显，再考虑胸片/CT。',
      '如果血氧下降或呼吸困难，建议急诊处理。',
    ],
    questions: [
      { id: 'breath', text: '这几天会不会觉得喘不上气？', options: ['不会', '有一点', '明显会'] },
      { id: 'feverDays', text: '有没有发热？如果有，大概烧了几天？', options: ['没发热', '1-2天', '3天以上'] },
      { id: 'sputum', text: '咳的时候有没有痰？痰大概是什么样？', options: ['无痰', '白痰', '黄痰', '带血丝'] },
      { id: 'chronic', text: '以前有慢性支气管炎、哮喘这类毛病吗？', options: ['没有', '有'] },
      { id: 'throat', text: '喉咙痛、鼻塞、流鼻涕这些明显吗？', options: ['没有', '有一点', '比较明显'] },
      { id: 'days', text: '咳嗽差不多有多久了？', options: ['不到3天', '3-7天', '超过1周', '超过1个月'] },
      { id: 'nightCough', text: '晚上躺下以后，咳得会不会更厉害？', options: ['不会', '有一点', '比较明显'] },
      { id: 'contact', text: '最近身边有没有人也在发热、咳嗽？', options: ['没有', '有', '不确定'] },
    ],
  },
  eye: {
    id: 'eye',
    label: '眼部不适/视力变化',
    keywords: ['眼睛', '眼痛', '视力模糊', '看不清', '畏光', '流泪', '红眼', '飞蚊'],
    department: '眼科',
    hospitalLevel: '先县医院眼科门诊，出现突发视力下降可直接市医院急诊眼科',
    preparation: ['身份证', '医保卡', '既往眼科检查单', '正在使用的眼药水/药物'],
    baseChecks: [
      { name: '挂号费', min: 10, max: 40 },
      { name: '视力检查', min: 20, max: 50 },
      { name: '裂隙灯检查', min: 30, max: 80 },
      { name: '眼压测量', min: 20, max: 50 },
    ],
    nextStepRules: [
      '若突发视力明显下降、眼前黑影增多或剧烈眼痛，尽快急诊眼科。',
      '如基础检查异常，再按医生建议做眼底照相/OCT等。',
    ],
    questions: [
      { id: 'eye_duration', text: '眼睛不舒服大概持续多久了？', options: ['不到1天', '1-3天', '超过1周', '反复超过1个月'] },
      { id: 'eye_side', text: '主要是一只眼还是两只眼都有？', options: ['左眼', '右眼', '两只眼', '说不清'] },
      { id: 'eye_type', text: '更明显的是哪种感觉？', options: ['疼痛/胀痛', '干涩/异物感', '视物模糊', '红痒流泪'] },
      { id: 'eye_vision_drop', text: '最近看东西有没有明显变模糊或突然看不清？', options: ['没有', '有一点', '明显变差'] },
      { id: 'eye_redflag', text: '有没有畏光、剧烈眼痛、恶心头痛这类情况？', options: ['没有', '有一点', '比较明显'] },
      { id: 'eye_trigger', text: '是否和长时间看屏幕、熬夜或用眼过度有关？', options: ['是', '不是', '不确定'] },
    ],
  },
  skinTrauma: {
    id: 'skinTrauma',
    label: '外伤/皮肤问题',
    keywords: ['外伤', '皮肤', '红疹', '伤口', '烫伤', '摔伤', '过敏'],
    department: '皮肤科或外科（外伤优先外科）',
    hospitalLevel: '先县医院处理，深伤口/大面积损伤建议上级医院',
    preparation: ['身份证', '医保卡', '受伤时间', '伤口/皮损照片', '过敏史'],
    baseChecks: [
      { name: '挂号费', min: 10, max: 40 },
      { name: '伤口/皮损评估', min: 20, max: 60 },
      { name: '基础消毒换药（按需）', min: 30, max: 120 },
      { name: '破伤风评估（按需）', min: 40, max: 180 },
    ],
    nextStepRules: [
      '如果出现化脓、发热或范围扩大，尽快复诊。',
      '如果伤口深、出血不止或面部眼周受伤，建议急诊。',
    ],
    questions: [
      { id: 'infection', text: '有没有流东西、化脓，或者又红又烫又疼？', options: ['没有', '有一点', '明显有'] },
      { id: 'fever', text: '这两天有没有跟着发热？', options: ['没有', '有'] },
      { id: 'type', text: '这个更像是擦伤碰伤，还是皮肤起疹子发红？', options: ['外伤', '皮肤起疹', '两者都有'] },
      { id: 'duration', text: '这个问题大概持续多久了？', options: ['不到1天', '1-3天', '超过3天'] },
      { id: 'spread', text: '现在这个范围是在变大，还是差不多？', options: ['差不多', '有一点扩大', '明显扩大'] },
      { id: 'itchPain', text: '现在是痒更明显，还是痛更明显？', options: ['更痒', '更痛', '又痒又痛'] },
      { id: 'medicine', text: '最近有没有换过药、护肤品，或者洗衣液这些？', options: ['没有', '有', '不确定'] },
    ],
  },
  maleHealth: {
    id: 'maleHealth',
    label: '男科/性健康相关',
    keywords: ['早泄', '做爱时间短', '性生活时间短', '勃起', '硬度不够', '射精快', '性功能'],
    department: '男科或泌尿外科',
    hospitalLevel: '先县医院泌尿外科/男科，复杂情况再到市医院专科',
    preparation: ['身份证', '医保卡', '既往化验/体检结果', '正在服用药物清单', '近期作息和压力情况'],
    baseChecks: [
      { name: '挂号费', min: 10, max: 40 },
      { name: '基础问诊和体格评估', min: 0, max: 40 },
      { name: '血压/血糖基础筛查（按需）', min: 20, max: 80 },
      { name: '激素/前列腺相关检查（按需）', min: 80, max: 240 },
    ],
    nextStepRules: [
      '如果合并勃起维持困难、长期焦虑失眠或慢病史，再考虑进一步检查。',
      '如果只是偶发、和压力睡眠有关，医生一般会先从生活方式和心理因素评估开始。',
    ],
    questions: [
      { id: 'sexDuration', text: '这种情况大概从什么时候开始的？', options: ['最近才开始', '几个月了', '一直都有', '说不清'] },
      { id: 'sexFrequency', text: '是每次都这样，还是有时候正常？', options: ['每次都这样', '大多数时候这样', '偶尔这样', '说不清'] },
      { id: 'erection', text: '除了时间短，勃起硬度或者维持时间有没有问题？', options: ['没有', '偶尔有', '比较明显'] },
      { id: 'stress', text: '最近压力、焦虑或者睡眠差明显吗？', options: ['不明显', '有一点', '比较明显'] },
      { id: 'partner', text: '这个问题已经影响到你们的性生活或情绪了吗？', options: ['影响不大', '有一点影响', '影响比较明显'] },
      { id: 'maleHistory', text: '以前看过男科、泌尿外科，或者有高血压糖尿病这类慢病吗？', options: ['没有', '看过男科/泌尿外科', '有慢病', '两者都有'] },
    ],
  },
  ent: {
    id: 'ent',
    label: '耳鼻喉不适',
    keywords: ['咽痛', '喉咙痛', '鼻塞', '流鼻涕', '耳痛', '耳鸣', '声音嘶哑', '吞咽痛', '扁桃体'],
    department: '耳鼻喉科',
    hospitalLevel: '先县医院耳鼻喉科门诊，重症再转市级医院',
    preparation: ['身份证', '医保卡', '既往耳鼻喉检查报告', '近期用药信息'],
    baseChecks: COMMON_BASE_CHECKS,
    nextStepRules: ['症状持续超过1周可做喉镜/鼻内镜进一步判断。', '高热或吞咽困难明显加重时尽快线下就医。'],
    questions: SPECIALTY_QUESTION_SETS.ent,
  },
  neurology: {
    id: 'neurology',
    label: '神经系统不适',
    keywords: ['头痛', '偏头痛', '头晕', '麻木', '说话不清', '手脚无力', '眩晕'],
    department: '神经内科',
    hospitalLevel: '先县医院神经内科，急性神经症状优先急诊',
    preparation: ['身份证', '医保卡', '既往影像报告', '慢病与用药记录'],
    baseChecks: COMMON_BASE_CHECKS,
    nextStepRules: ['若出现持续加重的神经体征，优先做头颅CT/MRI。', '急性发作时不要拖延，尽快线下评估。'],
    questions: SPECIALTY_QUESTION_SETS.neurology,
  },
  endocrinology: {
    id: 'endocrinology',
    label: '内分泌/代谢问题',
    keywords: ['血糖', '糖尿病', '甲状腺功能', '乏力', '多饮', '多尿', '体重变化', '甲功'],
    department: '内分泌科',
    hospitalLevel: '先县医院内分泌或内科门诊',
    preparation: ['身份证', '医保卡', '既往血糖/甲功报告', '长期用药清单'],
    baseChecks: COMMON_BASE_CHECKS,
    nextStepRules: ['先做血糖和基础代谢检查，再决定是否追加专项激素检查。', '若血糖极高伴不适，尽快线下就医。'],
    questions: SPECIALTY_QUESTION_SETS.endocrinology,
  },
  gynecology: {
    id: 'gynecology',
    label: '妇科相关问题',
    keywords: ['月经异常', '阴道出血', '白带异常', '下腹痛', '痛经', '妇科'],
    department: '妇科',
    hospitalLevel: '先县医院妇科门诊，异常出血明显时优先急诊',
    preparation: ['身份证', '医保卡', '月经记录', '既往妇科检查报告'],
    baseChecks: COMMON_BASE_CHECKS,
    nextStepRules: ['先做妇科查体与基础检验，再决定是否做超声或激素检查。', '出血量大或疼痛剧烈时尽快就医。'],
    questions: SPECIALTY_QUESTION_SETS.gynecology,
  },
  obstetrics: {
    id: 'obstetrics',
    label: '孕产相关问题',
    keywords: ['怀孕', '孕期', '胎动', '见红', '破水', '产后'],
    department: '产科',
    hospitalLevel: '优先有产科能力的综合医院',
    preparation: ['身份证', '医保卡', '产检手册', '近期产检报告'],
    baseChecks: COMMON_BASE_CHECKS,
    nextStepRules: ['孕期异常应优先产科评估，不建议自行拖延。', '出现见红、腹痛、胎动异常时立即线下就医。'],
    questions: SPECIALTY_QUESTION_SETS.obstetrics,
  },
  pediatrics: {
    id: 'pediatrics',
    label: '儿科问题',
    keywords: ['小孩', '孩子', '婴儿', '发烧', '咳嗽', '腹泻', '哭闹'],
    department: '儿科',
    hospitalLevel: '先儿科门诊，婴幼儿高热或精神差优先急诊',
    preparation: ['身份证', '医保卡', '体温记录', '既往儿科病历'],
    baseChecks: COMMON_BASE_CHECKS,
    nextStepRules: ['儿童症状变化快，建议短时间复评。', '高热不退、精神差、进食差时尽快线下就医。'],
    questions: SPECIALTY_QUESTION_SETS.pediatrics,
  },
  nephrology: {
    id: 'nephrology',
    label: '肾脏相关问题',
    keywords: ['水肿', '肾功能', '蛋白尿', '尿少', '肌酐', '肾病'],
    department: '肾内科',
    hospitalLevel: '先县医院肾内科/内科门诊',
    preparation: ['身份证', '医保卡', '既往肾功能报告', '血压记录'],
    baseChecks: COMMON_BASE_CHECKS,
    nextStepRules: ['先做尿检和肾功能，再决定是否追加肾脏超声。', '水肿明显或尿量骤减时尽快就医。'],
    questions: SPECIALTY_QUESTION_SETS.nephrology,
  },
  hepatobiliary: {
    id: 'hepatobiliary',
    label: '肝胆胰相关问题',
    keywords: ['肝区痛', '黄疸', '转氨酶', '胆囊', '胆结石', '胰腺'],
    department: '消化内科/肝胆外科',
    hospitalLevel: '先县医院消化内科，疑胆胰急症转上级医院',
    preparation: ['身份证', '医保卡', '肝功/腹部超声报告', '用药与饮酒史'],
    baseChecks: COMMON_BASE_CHECKS,
    nextStepRules: ['先做肝功能和腹部超声，再评估是否需专项影像。', '黄疸加重或腹痛剧烈时尽快就医。'],
    questions: SPECIALTY_QUESTION_SETS.hepatobiliary,
  },
  orthopedics: {
    id: 'orthopedics',
    label: '骨关节问题',
    keywords: ['膝盖痛', '关节痛', '骨头痛', '活动受限', '扭伤', '骨科'],
    department: '骨科',
    hospitalLevel: '先县医院骨科门诊，明显外伤可急诊',
    preparation: ['身份证', '医保卡', '既往影像片', '受伤经过'],
    baseChecks: COMMON_BASE_CHECKS,
    nextStepRules: ['先体格评估，必要时做X线/超声。', '不能负重或畸形明显时尽快线下处理。'],
    questions: SPECIALTY_QUESTION_SETS.orthopedics,
  },
  rheumatology: {
    id: 'rheumatology',
    label: '风湿免疫相关',
    keywords: ['晨僵', '关节肿痛', '风湿', '免疫', '红斑', '反复发作'],
    department: '风湿免疫科',
    hospitalLevel: '先内科门诊分诊，条件允许可直接风湿免疫科',
    preparation: ['身份证', '医保卡', '既往免疫化验报告', '长期用药信息'],
    baseChecks: COMMON_BASE_CHECKS,
    nextStepRules: ['先做基础炎症指标与相关抗体筛查。', '症状反复迁延建议尽早专科评估。'],
    questions: SPECIALTY_QUESTION_SETS.rheumatology,
  },
  psychiatry: {
    id: 'psychiatry',
    label: '心理/精神相关',
    keywords: ['焦虑', '抑郁', '睡不好', '情绪低落', '惊恐', '心烦'],
    department: '精神心理科',
    hospitalLevel: '先心理门诊，危机信号优先急诊',
    preparation: ['身份证', '医保卡', '既往心理就诊记录', '当前用药信息'],
    baseChecks: COMMON_BASE_CHECKS,
    nextStepRules: ['优先评估睡眠、情绪与压力因素。', '若出现自伤他伤风险，立即线下急诊。'],
    questions: SPECIALTY_QUESTION_SETS.psychiatry,
  },
  oncology: {
    id: 'oncology',
    label: '肿瘤相关担忧',
    keywords: ['肿块', '消瘦', '肿瘤', '癌', '淋巴结肿大', '长期低热'],
    department: '肿瘤科/相关专科',
    hospitalLevel: '先综合医院门诊分诊，再转肿瘤专科',
    preparation: ['身份证', '医保卡', '既往影像和病理报告', '近期体检结果'],
    baseChecks: COMMON_BASE_CHECKS,
    nextStepRules: ['先做基础评估，不直接下结论。', '按医生建议完善影像和病理相关检查。'],
    questions: SPECIALTY_QUESTION_SETS.oncology,
  },
  hematology: {
    id: 'hematology',
    label: '血液系统问题',
    keywords: ['贫血', '出血点', '白细胞', '血小板', '淤青', '血液病'],
    department: '血液内科',
    hospitalLevel: '先综合医院内科门诊，必要时转血液科',
    preparation: ['身份证', '医保卡', '血常规报告', '既往血液检查结果'],
    baseChecks: COMMON_BASE_CHECKS,
    nextStepRules: ['先复核血常规和凝血相关指标。', '异常持续时建议专科进一步排查。'],
    questions: SPECIALTY_QUESTION_SETS.hematology,
  },
  anorectal: {
    id: 'anorectal',
    label: '肛肠相关问题',
    keywords: ['痔疮', '肛门痛', '便血', '肛裂', '便后滴血', '肛门坠胀'],
    department: '肛肠外科/普外科',
    hospitalLevel: '先县医院外科门诊',
    preparation: ['身份证', '医保卡', '排便情况记录', '既往肠镜报告'],
    baseChecks: COMMON_BASE_CHECKS,
    nextStepRules: ['先做基础查体，再决定是否肠镜评估。', '出血量大或持续不缓解需尽快线下。'],
    questions: SPECIALTY_QUESTION_SETS.anorectal,
  },
  dentistry: {
    id: 'dentistry',
    label: '口腔牙科问题',
    keywords: ['牙痛', '牙龈肿', '口腔溃疡', '牙周', '智齿', '口臭'],
    department: '口腔科',
    hospitalLevel: '先县医院口腔门诊',
    preparation: ['身份证', '医保卡', '既往口腔片', '近期用药信息'],
    baseChecks: COMMON_BASE_CHECKS,
    nextStepRules: ['先口腔查体，必要时牙片评估。', '面部肿胀发热或张口困难时尽快线下。'],
    questions: SPECIALTY_QUESTION_SETS.dentistry,
  },
  dermatology: {
    id: 'dermatology',
    label: '皮肤科问题',
    keywords: ['皮疹', '瘙痒', '湿疹', '荨麻疹', '脱皮', '色斑'],
    department: '皮肤科',
    hospitalLevel: '先县医院皮肤科门诊',
    preparation: ['身份证', '医保卡', '皮损照片', '近期外用药记录'],
    baseChecks: COMMON_BASE_CHECKS,
    nextStepRules: ['先识别过敏/感染/炎症方向，再决定是否加做化验。', '范围快速扩大或伴发热尽快线下。'],
    questions: SPECIALTY_QUESTION_SETS.dermatology,
  },
  breastThyroid: {
    id: 'breastThyroid',
    label: '乳腺/甲状腺问题',
    keywords: ['乳房肿块', '乳房疼', '甲状腺结节', '甲状腺结节复查', '颈前肿块', '甲状腺肿大', '乳腺结节'],
    department: '甲乳外科/内分泌科',
    hospitalLevel: '先综合医院门诊分诊',
    preparation: ['身份证', '医保卡', '既往彩超报告', '甲功检查结果'],
    baseChecks: COMMON_BASE_CHECKS,
    nextStepRules: ['先做超声和基础检验，再定是否追加专项检查。', '肿块短期增大或疼痛加重时尽快就诊。'],
    questions: SPECIALTY_QUESTION_SETS.breastThyroid,
  },
  general: {
    id: 'general',
    label: '未明确单一方向（需继续补充）',
    keywords: [],
    department: '全科医学科/内科门诊',
    hospitalLevel: '先到县医院全科/内科分诊，再按医生建议转专科',
    preparation: ['身份证', '医保卡', '既往病历/检查单', '正在服用药物清单'],
    baseChecks: COMMON_BASE_CHECKS,
    nextStepRules: [
      '先做基础检查，避免一开始就做大检查。',
      '根据首诊医生分诊，再决定是否转消化/呼吸/神经/泌尿等专科。',
    ],
    questions: GENERIC_TRIAGE_QUESTIONS,
  },
};

const QUESTION_SLOT_META = {
  chestPain: { slot: 'pain', slotLabel: '疼痛/压迫感' },
  breath: { slot: 'breath', slotLabel: '气促程度' },
  dizzy: { slot: 'dizziness', slotLabel: '头晕/黑朦' },
  duration: { slot: 'duration', slotLabel: '持续时间' },
  frequency: { slot: 'frequency', slotLabel: '发作频率' },
  palpitationTime: { slot: 'triggerTime', slotLabel: '更容易发作的时间' },
  history: { slot: 'history', slotLabel: '既往病史' },
  sweat: { slot: 'associatedSymptoms', slotLabel: '伴随症状' },
  trauma: { slot: 'cause', slotLabel: '诱因/外伤' },
  numbness: { slot: 'neurologic', slotLabel: '麻木/无力' },
  position: { slot: 'location', slotLabel: '症状位置' },
  style: { slot: 'painStyle', slotLabel: '疼痛性质' },
  movePain: { slot: 'activityRelation', slotLabel: '活动关系' },
  morning: { slot: 'morningStiffness', slotLabel: '晨起变化' },
  stool: { slot: 'bowelChange', slotLabel: '大便变化' },
  fever: { slot: 'feverVomiting', slotLabel: '发热/呕吐' },
  location: { slot: 'location', slotLabel: '症状位置' },
  eatRel: { slot: 'mealRelation', slotLabel: '与进食关系' },
  appetite: { slot: 'appetite', slotLabel: '食欲变化' },
  bloat: { slot: 'refluxBloating', slotLabel: '反酸/胀气' },
  meal: { slot: 'foodTrigger', slotLabel: '饮食诱因' },
  nightPain: { slot: 'nightPattern', slotLabel: '夜间/空腹变化' },
  blood: { slot: 'bloodInUrine', slotLabel: '血尿' },
  pain: { slot: 'urinationPain', slotLabel: '排尿疼痛' },
  night: { slot: 'nightUrination', slotLabel: '夜尿' },
  repeat: { slot: 'repeatHistory', slotLabel: '是否反复' },
  water: { slot: 'waterResponse', slotLabel: '喝水后变化' },
  feverDays: { slot: 'feverDuration', slotLabel: '发热天数' },
  sputum: { slot: 'sputum', slotLabel: '痰的情况' },
  chronic: { slot: 'chronicHistory', slotLabel: '慢性病史' },
  throat: { slot: 'upperRespSymptoms', slotLabel: '上呼吸道症状' },
  days: { slot: 'duration', slotLabel: '持续时间' },
  nightCough: { slot: 'nightPattern', slotLabel: '夜间变化' },
  contact: { slot: 'contactHistory', slotLabel: '接触史' },
  infection: { slot: 'infectionSigns', slotLabel: '感染迹象' },
  type: { slot: 'problemType', slotLabel: '问题类型' },
  spread: { slot: 'spread', slotLabel: '范围变化' },
  itchPain: { slot: 'itchVsPain', slotLabel: '痒痛特点' },
  medicine: { slot: 'exposureHistory', slotLabel: '药物/接触史' },
  sexDuration: { slot: 'duration', slotLabel: '持续时间' },
  sexFrequency: { slot: 'frequency', slotLabel: '出现频率' },
  erection: { slot: 'erectionFunction', slotLabel: '勃起情况' },
  stress: { slot: 'stressSleep', slotLabel: '压力/睡眠' },
  partner: { slot: 'lifeImpact', slotLabel: '生活影响' },
  maleHistory: { slot: 'history', slotLabel: '既往病史' },
  eye_duration: { slot: 'duration', slotLabel: '持续时间' },
  eye_side: { slot: 'location', slotLabel: '患眼侧别' },
  eye_type: { slot: 'problemType', slotLabel: '主要不适类型' },
  eye_vision_drop: { slot: 'visionChange', slotLabel: '视力变化' },
  eye_redflag: { slot: 'riskSignal', slotLabel: '眼部危险信号' },
  eye_trigger: { slot: 'exposureHistory', slotLabel: '用眼诱因' },
  g_duration: { slot: 'duration', slotLabel: '持续时间' },
  g_location: { slot: 'location', slotLabel: '症状位置' },
  g_trend: { slot: 'trend', slotLabel: '变化趋势' },
  g_frequency: { slot: 'frequency', slotLabel: '出现频率' },
  g_accompany: { slot: 'accompanying', slotLabel: '伴随情况' },
  g_history: { slot: 'history', slotLabel: '慢病/用药史' },
  g_trigger: { slot: 'triggerTime', slotLabel: '诱因' },
  g_redflag: { slot: 'riskSignal', slotLabel: '风险信号' },
  ent_main: { slot: 'problemType', slotLabel: '耳鼻喉主症状' },
  ent_days: { slot: 'duration', slotLabel: '持续时间' },
  ent_fever: { slot: 'infectionSigns', slotLabel: '发热/吞咽困难' },
  ent_discharge: { slot: 'accompanying', slotLabel: '分泌物情况' },
  ent_voice: { slot: 'trend', slotLabel: '加重趋势' },
  neuro_main: { slot: 'problemType', slotLabel: '神经主症状' },
  neuro_onset: { slot: 'timeline', slotLabel: '起病方式' },
  neuro_side: { slot: 'location', slotLabel: '单侧表现' },
  neuro_speech: { slot: 'neurologic', slotLabel: '神经体征' },
  neuro_progress: { slot: 'trend', slotLabel: '变化趋势' },
  endo_main: { slot: 'problemType', slotLabel: '内分泌方向' },
  endo_drink: { slot: 'accompanying', slotLabel: '代谢表现' },
  endo_fatigue: { slot: 'severity', slotLabel: '全身不适' },
  endo_duration: { slot: 'duration', slotLabel: '持续时间' },
  endo_history: { slot: 'history', slotLabel: '慢病病史' },
  gyn_main: { slot: 'problemType', slotLabel: '妇科主症状' },
  gyn_cycle: { slot: 'timeline', slotLabel: '周期变化' },
  gyn_bleed: { slot: 'riskSignal', slotLabel: '异常出血' },
  gyn_pain: { slot: 'severity', slotLabel: '疼痛变化' },
  gyn_fever: { slot: 'infectionSigns', slotLabel: '感染征象' },
  obs_week: { slot: 'timeline', slotLabel: '孕周阶段' },
  obs_bleed: { slot: 'riskSignal', slotLabel: '孕产危险信号' },
  obs_move: { slot: 'fetalMove', slotLabel: '胎动变化' },
  obs_pressure: { slot: 'severity', slotLabel: '并发风险' },
  obs_progress: { slot: 'trend', slotLabel: '变化趋势' },
  ped_age: { slot: 'ageBand', slotLabel: '年龄段' },
  ped_main: { slot: 'problemType', slotLabel: '儿科主症状' },
  ped_temp: { slot: 'feverDuration', slotLabel: '发热程度' },
  ped_state: { slot: 'severity', slotLabel: '精神进食状态' },
  ped_duration: { slot: 'duration', slotLabel: '持续时间' },
  neph_main: { slot: 'problemType', slotLabel: '肾脏主诉' },
  neph_urine: { slot: 'urinationPain', slotLabel: '尿液变化' },
  neph_bp: { slot: 'bloodPressure', slotLabel: '血压变化' },
  neph_edema: { slot: 'severity', slotLabel: '水肿程度' },
  neph_history: { slot: 'history', slotLabel: '慢病/用药史' },
  hb_main: { slot: 'problemType', slotLabel: '肝胆胰主诉' },
  hb_trigger: { slot: 'foodTrigger', slotLabel: '饮食诱因' },
  hb_digest: { slot: 'accompanying', slotLabel: '消化伴随症状' },
  hb_fever: { slot: 'severity', slotLabel: '加重信号' },
  hb_history: { slot: 'history', slotLabel: '既往病史' },
  ortho_site: { slot: 'location', slotLabel: '部位' },
  ortho_cause: { slot: 'cause', slotLabel: '诱因' },
  ortho_move: { slot: 'activityRelation', slotLabel: '活动关系' },
  ortho_swelling: { slot: 'accompanying', slotLabel: '伴随体征' },
  ortho_duration: { slot: 'duration', slotLabel: '持续时间' },
  rheum_joint: { slot: 'location', slotLabel: '关节部位' },
  rheum_morning: { slot: 'morningStiffness', slotLabel: '晨僵' },
  rheum_swelling: { slot: 'accompanying', slotLabel: '肿痛体征' },
  rheum_repeat: { slot: 'repeatHistory', slotLabel: '反复情况' },
  rheum_other: { slot: 'accompanying', slotLabel: '系统症状' },
  psy_main: { slot: 'problemType', slotLabel: '心理主诉' },
  psy_duration: { slot: 'duration', slotLabel: '持续时间' },
  psy_impact: { slot: 'lifeImpact', slotLabel: '生活影响' },
  psy_body: { slot: 'accompanying', slotLabel: '躯体伴随' },
  psy_safety: { slot: 'riskSignal', slotLabel: '安全风险' },
  onco_main: { slot: 'problemType', slotLabel: '肿瘤担忧点' },
  onco_growth: { slot: 'trend', slotLabel: '进展趋势' },
  onco_systemic: { slot: 'accompanying', slotLabel: '全身症状' },
  onco_family: { slot: 'history', slotLabel: '家族史' },
  onco_history: { slot: 'testFindings', slotLabel: '既往检查' },
  hema_main: { slot: 'problemType', slotLabel: '血液主诉' },
  hema_bleed: { slot: 'riskSignal', slotLabel: '出血倾向' },
  hema_infect: { slot: 'infectionSigns', slotLabel: '感染情况' },
  hema_duration: { slot: 'duration', slotLabel: '持续时间' },
  hema_report: { slot: 'testFindings', slotLabel: '化验记录' },
  ano_main: { slot: 'problemType', slotLabel: '肛肠主诉' },
  ano_stool: { slot: 'bowelChange', slotLabel: '排便关系' },
  ano_bleed: { slot: 'riskSignal', slotLabel: '出血程度' },
  ano_constipation: { slot: 'bowelChange', slotLabel: '便秘情况' },
  ano_duration: { slot: 'duration', slotLabel: '持续时间' },
  den_main: { slot: 'problemType', slotLabel: '口腔主诉' },
  den_hotcold: { slot: 'triggerTime', slotLabel: '冷热刺激' },
  den_night: { slot: 'nightPattern', slotLabel: '夜间加重' },
  den_swallow: { slot: 'riskSignal', slotLabel: '急性危险信号' },
  den_duration: { slot: 'duration', slotLabel: '持续时间' },
  derm_main: { slot: 'problemType', slotLabel: '皮肤主诉' },
  derm_area: { slot: 'spread', slotLabel: '范围' },
  derm_trigger: { slot: 'exposureHistory', slotLabel: '接触诱因' },
  derm_fluid: { slot: 'infectionSigns', slotLabel: '渗液化脓' },
  derm_duration: { slot: 'duration', slotLabel: '持续时间' },
  bt_main: { slot: 'problemType', slotLabel: '甲乳方向' },
  bt_lump: { slot: 'trend', slotLabel: '肿块变化' },
  bt_pain: { slot: 'severity', slotLabel: '疼痛程度' },
  bt_cycle: { slot: 'timeline', slotLabel: '周期关系' },
  bt_report: { slot: 'testFindings', slotLabel: '既往检查' },
};

const SECOND_ROUND_CHECKS = {
  cardio: [
    { name: '心电图', trigger: '基础化验异常、心慌发作频繁或胸闷加重时' },
    { name: '心脏彩超', trigger: '心电图异常或持续胸闷气促时' },
  ],
  lumbar: [
    { name: '腰椎MRI', trigger: '腿麻加重、下肢无力或保守治疗无效时' },
    { name: '神经传导检查', trigger: '怀疑神经受压或症状持续进展时' },
  ],
  digestive: [
    { name: '腹部B超', trigger: '持续腹痛、体检异常或肝胆胰问题疑似时' },
    { name: '胃镜', trigger: '反复上腹不适、黑便或长期反酸时' },
    { name: '肠镜', trigger: '长期腹泻、便血或医生建议进一步筛查时' },
  ],
  urinary: [
    { name: '尿培养', trigger: '尿路感染反复、用药后仍反复发作时' },
    { name: '腹部CT', trigger: '怀疑结石、梗阻或血尿持续时' },
  ],
  respiratory: [
    { name: '胸片', trigger: '发热不退或咳嗽超过1周时' },
    { name: '胸部CT', trigger: '胸片异常、气促明显或症状持续加重时' },
    { name: '电子喉镜', trigger: '咽喉不适持续、声音嘶哑或咳嗽迁延时' },
  ],
  eye: [
    { name: '眼底照相', trigger: '视力下降或眼底异常提示时' },
    { name: 'OCT', trigger: '怀疑黄斑/视网膜问题时' },
    { name: '眼科B超', trigger: '眼底无法看清或需进一步评估时' },
  ],
  skinTrauma: [
    { name: '伤口细菌培养', trigger: '伤口化脓、反复感染时' },
    { name: '深部软组织超声', trigger: '怀疑深部组织损伤或脓肿时' },
  ],
  maleHealth: [
    { name: '激素六项', trigger: '持续存在性功能问题且伴慢病/睡眠压力异常时' },
    { name: '前列腺彩超', trigger: '合并排尿异常或医生建议进一步评估时' },
  ],
  general: [
    { name: '心电图', trigger: '伴胸闷心慌或活动后不适时' },
    { name: '腹部B超', trigger: '以腹痛/胃肠不适为主且持续时' },
    { name: '胸片', trigger: '咳嗽发热或呼吸道症状持续时' },
  ],
};

const MEDICATION_PRICE_RANGES = {
  cardio: [
    { category: '降压药（常见口服）', domesticPrice: '25~45元/月', importedPrice: '90~140元/月', note: '示例：国产苯磺酸氨氯地平、进口络活喜等' },
    { category: '缓解心慌类药物', domesticPrice: '30~60元/盒', importedPrice: '100~180元/盒', note: '需结合医生评估，不建议长期自行加量' },
  ],
  lumbar: [
    { category: '外用止痛贴/凝胶', domesticPrice: '20~40元/盒', importedPrice: '70~120元/盒', note: '多用于短期疼痛缓解' },
    { category: '口服止痛抗炎药', domesticPrice: '20~50元/盒', importedPrice: '80~150元/盒', note: '胃部不适或慢病人群需谨慎' },
  ],
  digestive: [
    { category: '抑酸/护胃药', domesticPrice: '20~45元/盒', importedPrice: '90~180元/盒', note: '常见短期用药区间' },
    { category: '止泻/调节肠道药', domesticPrice: '15~35元/盒', importedPrice: '50~120元/盒', note: '腹泻明显时短期使用' },
  ],
  urinary: [
    { category: '常见抗感染药', domesticPrice: '25~60元/疗程', importedPrice: '90~220元/疗程', note: '需结合感染类型与疗程' },
    { category: '解痉镇痛类药', domesticPrice: '20~40元/盒', importedPrice: '60~130元/盒', note: '以对症缓解为主' },
  ],
  respiratory: [
    { category: '止咳化痰药', domesticPrice: '18~40元/盒', importedPrice: '60~130元/盒', note: '根据症状选型，短期观察' },
    { category: '退热镇痛药', domesticPrice: '10~25元/盒', importedPrice: '30~80元/盒', note: '按需短期使用' },
  ],
  eye: [
    { category: '人工泪液/润眼类', domesticPrice: '20~45元/盒', importedPrice: '70~150元/盒', note: '多用于干涩、异物感等轻症对症' },
    { category: '抗炎滴眼类', domesticPrice: '25~60元/盒', importedPrice: '90~220元/盒', note: '应结合眼科评估后使用' },
  ],
  skinTrauma: [
    { category: '外用消毒/抗炎药', domesticPrice: '15~35元/支', importedPrice: '50~100元/支', note: '轻中度皮损常见范围' },
    { category: '口服抗过敏药', domesticPrice: '20~35元/盒', importedPrice: '60~140元/盒', note: '按症状短期使用' },
  ],
  maleHealth: [
    { category: '男科常见口服药', domesticPrice: '60~120元/盒', importedPrice: '180~360元/盒', note: '价格差异与品牌和疗程相关' },
    { category: '情绪/睡眠辅助药物', domesticPrice: '20~50元/盒', importedPrice: '80~180元/盒', note: '需按医生建议用药' },
  ],
  general: [
    { category: '对症类常见口服药', domesticPrice: '15~45元/盒', importedPrice: '60~140元/盒', note: '按当前主要症状短期对症使用' },
  ],
};

const URGENT_CHECK_PLANS = {
  generic: {
    possibleTypes: ['当前更像急性高风险问题', '优先线下急诊评估，不建议继续等待'],
    baseChecks: [
      { name: '急诊挂号/诊察', min: 20, max: 60 },
      { name: '血常规', min: 18, max: 35 },
      { name: '生化+肾功能', min: 45, max: 85 },
      { name: '心电图', min: 28, max: 55 },
    ],
    secondRoundChecks: [
      { name: '胸部CT', trigger: '医生判断需进一步排查时' },
      { name: '腹部CT', trigger: '症状持续或出现腹部急症体征时' },
    ],
    examAdvice: ['先做急诊基础化验和生命体征评估，再由医生决定是否做影像检查。'],
  },
  digestiveBleed: {
    possibleTypes: ['当前更像上消化道出血风险', '应尽快线下评估，不建议在家继续观察'],
    baseChecks: [
      { name: '急诊挂号/诊察', min: 20, max: 60 },
      { name: '血常规', min: 18, max: 35 },
      { name: '凝血功能（按需）', min: 45, max: 95 },
      { name: '生化+肾功能', min: 45, max: 85 },
      { name: '粪便常规/隐血（按需）', min: 18, max: 38 },
    ],
    secondRoundChecks: [
      { name: '胃镜', trigger: '医生评估后常作为关键排查项目' },
      { name: '腹部CT', trigger: '必要时用于进一步排查并发问题' },
    ],
    examAdvice: ['到院后优先做血常规、凝血功能、粪便隐血检查；必要时尽快安排胃镜评估。'],
  },
  cardioNeuro: {
    possibleTypes: ['当前更像心脑血管急性风险', '需尽快线下急诊排查（含脑卒中/急性心血管事件）'],
    baseChecks: [
      { name: '急诊挂号/诊察', min: 20, max: 60 },
      { name: '血常规', min: 18, max: 35 },
      { name: '生化+肾功能', min: 45, max: 85 },
      { name: '凝血功能（按需）', min: 45, max: 95 },
      { name: '心电图', min: 28, max: 55 },
      { name: '头颅CT', min: 230, max: 420 },
    ],
    secondRoundChecks: [
      { name: '心脏彩超', trigger: '医生评估疑似心功能异常时' },
      { name: '胸部CT', trigger: '伴胸痛/气促且需进一步排查时' },
    ],
    examAdvice: ['优先做生命体征、心电图与头颅CT等急诊排查，避免延误脑卒中/心血管急症。'],
  },
  stroke: {
    possibleTypes: ['当前高度怀疑脑卒中风险', '应立即急诊完成卒中通道相关评估'],
    baseChecks: [
      { name: '急诊挂号/诊察', min: 20, max: 60 },
      { name: '血常规', min: 18, max: 35 },
      { name: '生化+肾功能', min: 45, max: 85 },
      { name: '凝血功能（按需）', min: 45, max: 95 },
      { name: '心电图', min: 28, max: 55 },
      { name: '头颅CT', min: 230, max: 420 },
    ],
    secondRoundChecks: [
      { name: '胸部CT', trigger: '医生评估需排查并发症时' },
    ],
    examAdvice: ['优先完成卒中急诊评估，先做头颅CT和基础化验，不建议继续观察。'],
  },
  acs: {
    possibleTypes: ['当前更像急性冠脉综合征风险', '应尽快急诊排查心肌缺血/心梗'],
    baseChecks: [
      { name: '急诊挂号/诊察', min: 20, max: 60 },
      { name: '心电图', min: 28, max: 55 },
      { name: '血常规', min: 18, max: 35 },
      { name: '生化+肾功能', min: 45, max: 85 },
      { name: '凝血功能（按需）', min: 45, max: 95 },
    ],
    secondRoundChecks: [
      { name: '心脏彩超', trigger: '心电图或临床评估提示异常时' },
      { name: '胸部CT', trigger: '需进一步排查胸痛相关病因时' },
    ],
    examAdvice: ['先做心电图和急诊化验，必要时尽快完善心脏超声/进一步影像。'],
  },
  respiratoryAcute: {
    possibleTypes: ['当前更像呼吸系统急性风险', '需尽快线下评估，先排查肺部/缺氧等问题'],
    baseChecks: [
      { name: '急诊挂号/诊察', min: 20, max: 60 },
      { name: '体温/血氧测量', min: 0, max: 10 },
      { name: '血常规', min: 18, max: 35 },
      { name: 'CRP（按需）', min: 25, max: 55 },
      { name: '胸片', min: 60, max: 120 },
    ],
    secondRoundChecks: [
      { name: '胸部CT', trigger: '胸片异常或气促明显时' },
    ],
    examAdvice: ['先做血氧、血常规和胸部影像，必要时尽快升级到胸部CT。'],
  },
  sepsis: {
    possibleTypes: ['当前存在全身感染重症风险', '应尽快急诊评估并尽早控制感染'],
    baseChecks: [
      { name: '急诊挂号/诊察', min: 20, max: 60 },
      { name: '血常规', min: 18, max: 35 },
      { name: 'CRP（按需）', min: 25, max: 55 },
      { name: '生化+肾功能', min: 45, max: 85 },
      { name: '凝血功能（按需）', min: 45, max: 95 },
    ],
    secondRoundChecks: [
      { name: '胸部CT', trigger: '需寻找感染灶时' },
      { name: '腹部CT', trigger: '腹部感染灶或并发症排查时' },
    ],
    examAdvice: ['高热伴意识改变/呼吸快等需急诊评估，先做感染和器官功能相关检查。'],
  },
  anaphylaxis: {
    possibleTypes: ['当前存在严重过敏反应风险', '应立即急诊处理并严密观察'],
    baseChecks: [
      { name: '急诊挂号/诊察', min: 20, max: 60 },
      { name: '体温/血氧测量', min: 0, max: 10 },
      { name: '血常规', min: 18, max: 35 },
      { name: '生化+肾功能', min: 45, max: 85 },
      { name: '心电图', min: 28, max: 55 },
    ],
    secondRoundChecks: [],
    examAdvice: ['出现呼吸困难、喉头紧缩、口唇舌咽肿胀时应立即急诊，不建议等待。'],
  },
  acuteAbdomen: {
    possibleTypes: ['当前存在急腹症风险', '应尽快线下急诊评估，避免延误手术时机'],
    baseChecks: [
      { name: '急诊挂号/诊察', min: 20, max: 60 },
      { name: '血常规', min: 18, max: 35 },
      { name: '生化+肾功能', min: 45, max: 85 },
      { name: '腹部B超', min: 95, max: 170 },
    ],
    secondRoundChecks: [
      { name: '腹部CT', trigger: '需进一步明确急腹症病因时' },
    ],
    examAdvice: ['持续剧烈腹痛、反跳痛或黑便呕血时，优先急诊完善腹部影像与化验。'],
  },
  severeTrauma: {
    possibleTypes: ['当前存在严重外伤风险', '应尽快急诊评估并排除内出血/骨折/颅脑损伤'],
    baseChecks: [
      { name: '急诊挂号/诊察', min: 20, max: 60 },
      { name: '血常规', min: 18, max: 35 },
      { name: '生化+肾功能', min: 45, max: 85 },
      { name: '胸片', min: 60, max: 120 },
    ],
    secondRoundChecks: [
      { name: '头颅CT', trigger: '头部受伤或意识改变时' },
      { name: '腹部CT', trigger: '腹部外伤或内出血疑似时' },
    ],
    examAdvice: ['明显外伤伴意识改变/持续出血时，优先急诊影像评估并现场止血处理。'],
  },
  obstetricEmergency: {
    possibleTypes: ['当前存在妇产急症风险', '应尽快妇产科急诊评估，避免延误'],
    baseChecks: [
      { name: '急诊挂号/诊察', min: 20, max: 60 },
      { name: '血常规', min: 18, max: 35 },
      { name: '凝血功能（按需）', min: 45, max: 95 },
      { name: '生化+肾功能', min: 45, max: 85 },
      { name: '腹部B超', min: 95, max: 170 },
    ],
    secondRoundChecks: [
      { name: '腹部CT', trigger: '医生评估需进一步排查并发症时' },
    ],
    examAdvice: ['停经后腹痛出血、孕期异常出血或产后大出血需立即急诊妇产科评估。'],
  },
  pediatricCritical: {
    possibleTypes: ['当前存在儿科危重风险', '应尽快儿科急诊评估，不建议继续等待'],
    baseChecks: [
      { name: '急诊挂号/诊察', min: 20, max: 60 },
      { name: '体温/血氧测量', min: 0, max: 10 },
      { name: '血常规', min: 18, max: 35 },
      { name: 'CRP（按需）', min: 25, max: 55 },
      { name: '胸片', min: 60, max: 120 },
    ],
    secondRoundChecks: [
      { name: '胸部CT', trigger: '呼吸异常明显或胸片异常时' },
      { name: '头颅CT', trigger: '抽搐或意识异常需进一步排查时' },
    ],
    examAdvice: ['儿童高热惊厥、持续抽搐、精神差或呼吸急促应立即儿科急诊。'],
  },
  psychiatricCrisis: {
    possibleTypes: ['当前存在精神危机风险', '应尽快急诊精神科或综合急诊处理，确保人身安全'],
    baseChecks: [
      { name: '急诊挂号/诊察', min: 20, max: 60 },
      { name: '血常规', min: 18, max: 35 },
      { name: '生化+肾功能', min: 45, max: 85 },
      { name: '头颅CT', min: 230, max: 420 },
    ],
    secondRoundChecks: [],
    examAdvice: ['出现自伤/伤人念头、明显精神错乱或幻觉妄想时，应立即就医并优先保证安全。'],
  },
  urinaryComplicated: {
    possibleTypes: ['当前更像泌尿系统急性风险', '需尽快线下评估，排查感染上行或梗阻'],
    baseChecks: [
      { name: '急诊挂号/诊察', min: 20, max: 60 },
      { name: '尿常规', min: 12, max: 25 },
      { name: '血常规', min: 18, max: 35 },
      { name: '肾功能/炎症指标', min: 40, max: 75 },
      { name: '泌尿系B超（按需）', min: 110, max: 180 },
    ],
    secondRoundChecks: [
      { name: '腹部CT', trigger: '怀疑结石梗阻或血尿持续时' },
      { name: '尿培养', trigger: '反复感染或治疗效果不佳时' },
    ],
    examAdvice: ['优先做尿检、炎症指标和泌尿系影像，必要时尽快做CT排查梗阻。'],
  },
};

const URGENT_PLAN_DEPARTMENTS = {
  generic: '急诊医学科',
  digestiveBleed: '急诊医学科/消化内科',
  cardioNeuro: '急诊医学科/心血管内科/神经内科',
  stroke: '急诊医学科/神经内科',
  acs: '急诊医学科/心血管内科',
  respiratoryAcute: '急诊医学科/呼吸内科',
  sepsis: '急诊医学科/感染科',
  anaphylaxis: '急诊医学科',
  acuteAbdomen: '急诊医学科/普外科',
  severeTrauma: '急诊医学科/创伤外科',
  obstetricEmergency: '急诊医学科/妇产科',
  pediatricCritical: '急诊医学科/儿科',
  psychiatricCrisis: '急诊医学科/精神心理科',
  urinaryComplicated: '急诊医学科/泌尿外科',
};

const URGENT_CATEGORY_PATTERNS = [
  {
    category: 'stroke',
    patterns: [
      /(说话不清|言语不清|失语|口角歪|面口歪斜|偏瘫|单侧肢体无力|一侧肢体无力|单侧麻木|突发.*(头痛|头晕))/,
    ],
  },
  {
    category: 'digestiveBleed',
    patterns: [/(黑便|柏油样便|柏油便|呕血|上消化道出血|消化道出血|便血)/],
  },
  {
    category: 'acs',
    patterns: [/(胸痛|胸口压榨|胸闷胸痛|后背放射痛|左臂痛|下颌痛|冷汗|濒死感|心梗)/],
  },
  {
    category: 'anaphylaxis',
    patterns: [/(喉头水肿|喉咙紧|咽喉紧缩|口唇舌肿|呼吸道过敏|过敏性休克|全身风团.*呼吸困难)/],
  },
  {
    category: 'sepsis',
    patterns: [/(高热不退|持续高热|寒战高热|神志改变|意识改变|感染性休克|败血症)/],
  },
  {
    category: 'respiratoryAcute',
    patterns: [/(呼吸困难|喘不过气|嘴唇发紫|血氧低|端坐呼吸|严重气促)/],
  },
  {
    category: 'acuteAbdomen',
    patterns: [/(刀割样腹痛|反跳痛|腹膜刺激征|持续剧烈腹痛|急腹症)/],
  },
  {
    category: 'severeTrauma',
    patterns: [/(大量出血|外伤后意识不清|开放性伤口|高处坠落|严重车祸伤|伤口喷射出血)/],
  },
  {
    category: 'obstetricEmergency',
    patterns: [/(停经后.*(出血|腹痛)|阴道大出血|孕期出血|胎动.*(减少|消失)|破水|产后大出血|宫外孕|先兆流产)/],
  },
  {
    category: 'pediatricCritical',
    patterns: [/(高热惊厥|儿童.*持续抽搐|婴幼儿.*(呼吸急促|发紫|精神差|嗜睡|拒食)|小孩.*(抽搐|高热不退))/],
  },
  {
    category: 'psychiatricCrisis',
    patterns: [/(自杀|轻生|不想活|自残|伤人|幻觉|妄想|躁狂失控|精神错乱)/],
  },
];

const SELF_CARE_PLAYBOOK = {
  digestive: {
    severityText: '目前更像轻中度胃肠不适，可先短期自我处理并观察。',
    actionSummary: '先清淡饮食和规律作息，短期观察1-2天；若加重再去消化内科。',
    selfCareAdvice: ['少油少辣、少酒，先吃易消化食物', '先观察1-2天症状变化'],
    medicationAdvice: ['可短期考虑抑酸/护胃或止泻类非处方药，按说明书使用'],
    visitAdvice: ['若出现黑便、呕血、持续加重，立即线下就医'],
  },
  respiratory: {
    severityText: '目前更像上呼吸道轻中度不适，可先对症处理。',
    actionSummary: '先休息补液和对症处理，若发热/咳喘持续不缓解再去门诊。',
    selfCareAdvice: ['多喝温水，保持休息', '避免烟酒和熬夜'],
    medicationAdvice: ['发热可考虑退热药；咳嗽可短期对症用药'],
    visitAdvice: ['发热超过3天、气促明显或症状加重时就医'],
  },
  eye: {
    severityText: '目前更像轻中度眼表刺激或用眼相关不适，可先短期对症处理。',
    actionSummary: '先减少用眼、规律作息和润眼观察；若视力下降或疼痛加重，尽快眼科就诊。',
    selfCareAdvice: ['减少连续看屏幕时间，增加休息', '避免揉眼，保持眼部清洁'],
    medicationAdvice: ['可短期考虑人工泪液等对症处理'],
    visitAdvice: ['若突发视力下降、眼痛明显、畏光加重，尽快线下眼科'],
  },
  lumbar: {
    severityText: '目前更像轻中度腰背劳损，可先居家处理。',
    actionSummary: '先减少负重与久坐，配合热敷和适度活动，观察1-3天。',
    selfCareAdvice: ['避免搬重物和久坐', '可热敷并做轻度拉伸'],
    medicationAdvice: ['可短期外用止痛药物；口服药需结合胃病/慢病情况'],
    visitAdvice: ['若腿麻无力加重或出现大小便异常，及时就医'],
  },
  skinTrauma: {
    severityText: '目前更像轻中度皮肤/外伤问题，可先规范局部处理。',
    actionSummary: '先清洁消毒并观察创面变化，若感染加重再线下处理。',
    selfCareAdvice: ['保持伤口清洁干燥', '避免反复摩擦和抓挠'],
    medicationAdvice: ['可短期使用外用消毒/抗炎药物'],
    visitAdvice: ['若红肿扩散、渗液或发热，尽快就医'],
  },
  urinary: {
    severityText: '目前更像轻中度尿路刺激问题，可先短期处理并观察。',
    actionSummary: '先补充水分、避免憋尿；若持续不缓解再去门诊检查。',
    selfCareAdvice: ['增加饮水，避免久憋尿', '避免辛辣和酒精刺激'],
    medicationAdvice: ['如需抗感染药物，建议线下评估后再使用'],
    visitAdvice: ['出现发热、腰痛或血尿时应尽快就医'],
  },
  cardio: {
    severityText: '当前仍建议尽快门诊评估，不建议长期自行处理。',
    actionSummary: '心血管相关不适风险波动较大，建议尽快到门诊完善评估。',
    selfCareAdvice: ['避免熬夜和情绪激动', '暂时避免剧烈活动'],
    medicationAdvice: ['已有心血管用药请按既往医嘱使用，不要自行停药'],
    visitAdvice: ['胸痛、气促、晕厥等出现时立即急诊'],
  },
  maleHealth: {
    severityText: '目前更像非急症问题，可先生活方式干预并观察。',
    actionSummary: '先调整作息和压力，若持续影响生活再到男科/泌尿外科评估。',
    selfCareAdvice: ['先改善睡眠和压力管理', '减少酒精和熬夜'],
    medicationAdvice: ['药物方案建议在线下医生评估后确定'],
    visitAdvice: ['若持续数月影响明显，建议门诊系统评估'],
  },
};

function normalizeText(v) {
  return String(v || '').trim().toLowerCase();
}

function expandComplaintText(input = '') {
  let text = normalizeText(input);
  const replacements = [
    [/心悸|心口发慌|心里发慌/g, '心慌'],
    [/胸口闷|胸口堵|喘不过气/g, '胸闷'],
    [/头发昏|头发晕|发晕/g, '头晕'],
    [/胃胀|胃疼|肚胀|肚子不舒服/g, '胃不舒服'],
    [/拉稀|腹泻/g, '拉肚子'],
    [/小便频繁|尿得多|憋不住尿/g, '尿频'],
    [/小便痛|尿尿疼/g, '尿痛'],
    [/咽痛|嗓子疼/g, '咽痛'],
    [/感冒咳嗽/g, '咳嗽'],
    [/起疹子|过敏|皮肤发痒/g, '皮肤'],
    [/摔伤|碰伤|伤口/g, '外伤'],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function buildSessionSignalText(session = {}) {
  return [
    session.chiefComplaint || '',
    ...Object.values(session.answers || {}).map((item) => String(item || '')),
    ...(session.supplements || []).map((item) => String(item || '')),
    ...(session.supplementInsights || []).map((item) => String(item.summary || '')),
    ...(session.supplementFiles || []).flatMap((file) => [
      String(file?.summary?.title || ''),
      String((file?.summary?.highlights || []).join('；')),
      String((file?.summary?.keyMetrics || []).join('；')),
      String(file?.summary?.ocrText || '').slice(0, 200),
    ]),
  ]
    .join(' ')
    .trim();
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasPositiveKeyword(text = '', keyword = '') {
  const normalized = String(text || '').toLowerCase();
  const token = String(keyword || '').toLowerCase();
  if (!normalized || !token) return false;
  const deniedPattern = new RegExp(`(没有|无|否认|并无|未见|不是|并非)[^，。；;,.]{0,3}${escapeRegExp(token)}`);
  if (deniedPattern.test(normalized)) return false;
  return normalized.includes(token);
}

function scoreScenario(text = '', scenario = {}) {
  const normalized = expandComplaintText(text);
  const keywords = Array.isArray(scenario.keywords) ? scenario.keywords : [];
  return keywords.reduce((acc, kw) => {
    if (!hasPositiveKeyword(normalized, kw)) return acc;
    const weight = String(kw || '').length >= 4 ? 2 : 1;
    return acc + weight;
  }, 0);
}

function rankScenariosByText(text = '') {
  const list = Object.values(SCENARIOS).filter((item) => item.id !== 'general');
  const ranked = list
    .map((scenario) => ({
      scenario,
      score: scoreScenario(text, scenario),
    }))
    .sort((a, b) => b.score - a.score);
  return ranked;
}

function detectScenarioDetailed(chiefComplaint = '') {
  const text = expandComplaintText(chiefComplaint);
  const ranked = rankScenariosByText(text);
  const best = ranked[0] || { scenario: SCENARIOS.general, score: 0 };
  const second = ranked[1] || { scenario: SCENARIOS.general, score: 0 };
  const gap = Number(best.score || 0) - Number(second.score || 0);
  const ambiguous = best.score <= 0 || (gap <= 0 && best.score < 2);
  const pickedScenario = ambiguous ? SCENARIOS.general : best.scenario;

  return {
    scenario: pickedScenario,
    score: Number(best.score || 0),
    secondScore: Number(second.score || 0),
    scoreGap: gap,
    ambiguous,
    ranked,
    normalizedText: text,
  };
}

function detectScenario(chiefComplaint = '') {
  return detectScenarioDetailed(chiefComplaint).scenario;
}

function getQuestionSlotMeta(question = {}) {
  return QUESTION_SLOT_META[question.id] || {
    slot: question.id,
    slotLabel: question.id,
  };
}

function getScenarioSlotCatalog(scenario = {}) {
  return (scenario.questions || []).map((question) => ({
    questionId: question.id,
    questionText: question.text,
    options: question.options,
    ...getQuestionSlotMeta(question),
  }));
}

function hasRedFlag({ chiefComplaint = '', answers = {}, supplements = [] }) {
  const text = `${chiefComplaint} ${Object.values(answers).join(' ')} ${(supplements || []).join(' ')}`;
  return RED_FLAG_KEYWORDS.some((k) => hasPositiveKeyword(text, k));
}

function isDigestiveBleedRisk(session = {}) {
  const text = `${session.chiefComplaint || ''} ${Object.values(session.answers || {}).join(' ')} ${(session.supplements || []).join(' ')}`;
  const keywords = ['黑便', '柏油样便', '柏油便', '呕血', '上消化道出血', '消化道出血', '便血'];
  return keywords.some((keyword) => hasPositiveKeyword(text, keyword));
}

function buildUrgentPlan(session = {}, scenario = {}) {
  const fullText = `${session.chiefComplaint || ''} ${Object.values(session.answers || {}).join(' ')} ${(session.supplements || []).join(' ')}`;
  const matchedCategory = URGENT_CATEGORY_PATTERNS.find((item) => item.patterns.some((pattern) => pattern.test(fullText)))?.category || '';
  const withDept = (planKey, plan) => ({
    ...plan,
    department: URGENT_PLAN_DEPARTMENTS[planKey] || scenario.department || '急诊医学科',
  });
  if (matchedCategory && URGENT_CHECK_PLANS[matchedCategory]) {
    return withDept(matchedCategory, URGENT_CHECK_PLANS[matchedCategory]);
  }
  if ((scenario.id === 'digestive') || isDigestiveBleedRisk(session)) {
    return withDept('digestiveBleed', URGENT_CHECK_PLANS.digestiveBleed);
  }
  if (scenario.id === 'cardio') {
    return withDept('cardioNeuro', URGENT_CHECK_PLANS.cardioNeuro);
  }
  if (scenario.id === 'respiratory') {
    return withDept('respiratoryAcute', URGENT_CHECK_PLANS.respiratoryAcute);
  }
  if (scenario.id === 'urinary') {
    return withDept('urinaryComplicated', URGENT_CHECK_PLANS.urinaryComplicated);
  }
  return withDept('generic', URGENT_CHECK_PLANS.generic);
}

function hasModerateOrWorseSignal(text = '') {
  return /(加重|持续|明显|反复|发热|高烧|呼吸困难|胸痛|出血|剧痛|晕倒|呕吐不止|血尿|黑便)/.test(String(text || ''));
}

function shouldSelfCareFirst(session = {}, schema = {}) {
  const fullText = `${session.chiefComplaint || ''} ${Object.values(session.answers || {}).join(' ')} ${(session.supplements || []).join(' ')}`;
  if (hasModerateOrWorseSignal(fullText)) return false;
  const scenarioId = session.scenario?.id || '';
  if (scenarioId === 'cardio') return false;
  const answerCount = Object.keys(session.answers || {}).length;
  const hasStrongSchemaSignal = (schema.severity || []).length + (schema.accompanying || []).length >= 3;
  return answerCount <= 2 && !hasStrongSchemaSignal;
}

function calcBaseCost(baseChecks) {
  const total = baseChecks.reduce(
    (acc, item) => ({ min: acc.min + item.min, max: acc.max + item.max }),
    { min: 0, max: 0 }
  );
  return total;
}

function normalizeBaseChecks(baseChecks = []) {
  const map = costReference?.items || {};
  return baseChecks.map((item) => {
    const ref = map[item.name];
    if (!ref) return item;
    return {
      ...item,
      min: Number(ref.min),
      max: Number(ref.max),
    };
  });
}

function normalizeCityKey(city = '') {
  const raw = String(city || '').trim();
  if (!raw) return '';
  return raw
    .replace(/土家族苗族自治州$/, '')
    .replace(/自治州$/, '')
    .replace(/林区$/, '')
    .replace(/市$/, '');
}

function getCityFactor(session = {}) {
  const cityKey = normalizeCityKey(session.city || '');
  if (!cityKey) return 1;
  const cityConfig = hubeiCityFactors?.cities?.[cityKey];
  const factor = Number(cityConfig?.factor || 1);
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

function getPriceByRegion(name = '', session = {}) {
  const cityKey = normalizeCityKey(session.city || '');
  const cityMap = hubeiCityOverrides?.cities?.[cityKey] || {};
  if (cityMap[name]) return cityMap[name];
  const common = (costReference?.items || {})[name] || null;
  if (!common) return null;
  const factor = getCityFactor(session);
  return {
    min: roundToTen(Number(common.min) * factor, 'floor'),
    max: roundToTen(Number(common.max) * factor, 'ceil'),
  };
}

function normalizeBaseChecksByRegion(baseChecks = [], session = {}) {
  return baseChecks.map((item) => {
    const ref = getPriceByRegion(item.name, session);
    if (!ref) return item;
    return {
      ...item,
      min: Number(ref.min),
      max: Number(ref.max),
    };
  });
}

function normalizeNamedItems(items = [], session = {}) {
  const map = costReference?.items || {};
  return items.map((item) => {
    const ref = getPriceByRegion(item.name, session) || map[item.name];
    if (!ref) {
      return {
        ...item,
        min: Number(item.min || 0),
        max: Number(item.max || 0),
      };
    }
    return {
      ...item,
      min: Number(ref.min),
      max: Number(ref.max),
    };
  });
}

function roundToTen(value, mode = 'round') {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  if (mode === 'ceil') return Math.ceil(num / 10) * 10;
  if (mode === 'floor') return Math.floor(num / 10) * 10;
  return Math.round(num / 10) * 10;
}

function getHospitalCostFactor(levelText = '') {
  const text = String(levelText || '');
  if (/三甲|三级甲等/.test(text)) return 1.38;
  if (/三级/.test(text)) return 1.28;
  if (/市级/.test(text)) return 1.18;
  if (/县级/.test(text)) return 1.06;
  return 1.15;
}

function buildNarrowCostRange(baseChecks = [], factor = 1.15) {
  const midpoint = baseChecks.reduce((sum, item) => sum + (Number(item.min || 0) + Number(item.max || 0)) / 2, 0) * factor;
  const bandPct = 0.16;
  const min = roundToTen(midpoint * (1 - bandPct), 'floor');
  const max = roundToTen(midpoint * (1 + bandPct), 'ceil');
  const ensuredMax = max - min < 60 ? min + 60 : max;
  return { min, max: ensuredMax };
}

function estimateFeeItems(baseChecks = [], factor = 1.15) {
  return baseChecks.map((item) => {
    const mid = ((Number(item.min || 0) + Number(item.max || 0)) / 2) * factor;
    const min = roundToTen(mid * 0.88, 'floor');
    const max = roundToTen(mid * 1.12, 'ceil');
    return {
      ...item,
      min: Math.max(0, min),
      max: Math.max(min + 10, max),
    };
  });
}

function estimateSecondRoundItems(items = [], factor = 1.15) {
  return items.map((item) => {
    const mid = ((Number(item.min || 0) + Number(item.max || 0)) / 2) * (factor * 1.05);
    const min = roundToTen(mid * 0.84, 'floor');
    const max = roundToTen(mid * 1.16, 'ceil');
    return {
      name: item.name,
      trigger: item.trigger || '',
      min: Math.max(0, min),
      max: Math.max(min + 20, max),
    };
  });
}

function confidenceLevel(answerCount, redFlag) {
  if (redFlag) return '高风险优先';
  if (answerCount >= 8) return '高概率方向';
  if (answerCount >= 4) return '可能方向';
  return '信息不足，建议线下检查';
}

function splitJoinedText(value = '') {
  return String(value || '')
    .split(/[；;、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniq(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function buildGenericSymptomSchema(session) {
  const slotState = session.followUp?.slotState || {};
  const supplementFacts = uniq(
    (session.supplementInsights || [])
      .flatMap((item) => item.normalizedFacts || [])
      .map((item) => String(item || '').trim())
  );
  const reportFindings = uniq(
    (session.supplementFiles || []).flatMap((file) => [
      ...splitJoinedText((file.summary?.keyMetrics || []).join('；')),
      ...splitJoinedText((file.summary?.highlights || []).join('；')),
    ])
  );

  const getAnswer = (slot) => String(slotState?.[slot]?.answer || '').trim();
  const collect = (slots = []) => uniq(slots.flatMap((slot) => splitJoinedText(getAnswer(slot))));

  return {
    mainSymptom: session.chiefComplaint || '',
    timeline: collect(['duration', 'frequency', 'triggerTime', 'nightPattern', 'feverDuration']),
    location: collect(['location']),
    severity: collect(['breath', 'pain', 'dizziness', 'itchVsPain']),
    accompanying: collect([
      'associatedSymptoms',
      'upperRespSymptoms',
      'sputum',
      'bowelChange',
      'refluxBloating',
      'bloodInUrine',
      'infectionSigns',
      'urinationPain',
    ]),
    history: collect([
      'history',
      'chronicHistory',
      'repeatHistory',
      'contactHistory',
      'exposureHistory',
      'cause',
    ]),
    testFindings: uniq([
      ...collect(['bloodPressure', 'heartRate', 'labFindings', 'reportFindings', 'imagingFindings']),
      ...reportFindings,
    ]),
    supplementFacts,
  };
}

function buildSchemaHighlights(schema = {}) {
  return uniq([
    ...(schema.timeline || []).slice(0, 1).map((item) => `病程/节律：${item}`),
    ...(schema.location || []).slice(0, 1).map((item) => `主要位置：${item}`),
    ...(schema.severity || []).slice(0, 1).map((item) => `症状强度：${item}`),
    ...(schema.accompanying || []).slice(0, 1).map((item) => `伴随表现：${item}`),
    ...(schema.history || []).slice(0, 1).map((item) => `病史线索：${item}`),
    ...(schema.testFindings || []).slice(0, 2).map((item) => `检查提示：${item}`),
    ...(schema.supplementFacts || []).slice(0, 2).map((item) => `补充信息：${item}`),
  ]).slice(0, 5);
}

function calcInfoCoverage(schema = {}, session = {}) {
  const checks = [
    Boolean(session.chiefComplaint),
    (schema.timeline || []).length > 0,
    (schema.location || []).length > 0,
    (schema.severity || []).length > 0 || (schema.accompanying || []).length > 0,
    (schema.history || []).length > 0,
    (schema.testFindings || []).length > 0 || (schema.supplementFacts || []).length > 0,
  ];
  const hit = checks.filter(Boolean).length;
  const slotRatio = checks.length ? hit / checks.length : 0;
  const answerRatio = Math.min(1, Object.keys(session.answers || {}).length / 6);
  return {
    hit,
    total: checks.length,
    ratio: Math.max(slotRatio, answerRatio),
  };
}

function buildPossibleTypes(session, schema = {}, scenarioId = session.scenario?.id) {
  const scenarioLabel = session.scenario?.label || '相关科室';
  const findings = (schema.testFindings || []).join('；');
  const history = (schema.history || []).join('；');

  if (scenarioId === 'cardio') {
    const first = /血压/.test(`${session.chiefComplaint}；${findings}；${history}`)
      ? '大概率和血压波动或心血管方面有关'
      : '大概率和心血管或心律方面有关';
    return [first, '也要排除劳累后气促或心率不齐'];
  }
  if (scenarioId === 'digestive') {
    return ['更像胃肠道功能紊乱、胃炎这类问题', '如果黑便或反复呕吐，要尽快线下检查'];
  }
  if (scenarioId === 'lumbar') {
    return ['更像腰肌劳损或腰椎相关问题', '如果腿麻加重，也要排除神经受压'];
  }
  if (scenarioId === 'urinary') {
    return ['更像尿路刺激或感染相关问题', '如果反复发作，也要排除结石等情况'];
  }
  if (scenarioId === 'respiratory') {
    return ['更像呼吸道感染或支气管问题', '如果咳喘持续不缓解，需要进一步查肺部'];
  }
  if (scenarioId === 'eye') {
    return ['更像眼表刺激、干眼或炎症相关问题', '若突发视力下降或剧烈眼痛，要尽快眼科急诊'];
  }
  if (scenarioId === 'skinTrauma') {
    return ['更像皮肤炎症、过敏或外伤恢复问题', '如果范围扩大或化脓，需要尽快复诊'];
  }
  if (scenarioId === 'maleHealth') {
    return ['更像男科或性功能方面的问题', '常常还需要结合压力、睡眠和慢病情况一起判断'];
  }
  if (scenarioId === 'general') {
    return ['目前信息还不足以归到单一方向', '建议继续补充或到全科/内科先做分诊'];
  }
  return [`更像${scenarioLabel}相关问题`, '还需要结合线下检查进一步确认'];
}

function buildFallbackGuidance(session, scenarioId = session.scenario?.id) {

  if (scenarioId === 'cardio') {
    return {
      recommendationLevel: 'routine_clinic',
      severityLevel: 'moderate',
      severityText: '当前更像心血管方向问题，建议尽快门诊评估，不要长期拖着。',
      userGoal: '先判断风险级别，再决定检查路径和就诊时机',
      actionSummary: '先按心血管方向评估更稳妥；建议尽快去门诊，必要时做心电图和基础化验。',
      selfCareAdvice: ['最近先减少熬夜和情绪波动', '避免浓茶咖啡和剧烈运动刺激'],
      medicationAdvice: ['如已在用降压或心血管药物，不要自行停药或加量'],
      visitAdvice: ['建议先挂心血管内科普通号', '若胸痛明显加重或呼吸困难，立即急诊'],
      examAdvice: ['首轮通常先做血压、心电图、血常规和基础生化检查'],
      needsBooking: true,
      needsCost: true,
    };
  }

  if (scenarioId === 'digestive') {
    return {
      recommendationLevel: 'self_care',
      severityLevel: 'mild',
      severityText: '目前更像轻到中度不适，先观察和调整通常更合适。',
      userGoal: '先判断需不需要马上去医院，以及能不能先自行缓一缓',
      actionSummary: '目前先按胃肠道轻中度不适处理更合适，先观察饮食和休息，再看要不要去消化内科。',
      selfCareAdvice: ['先吃清淡一点', '这两天少酒少辣', '先观察 1 到 2 天变化'],
      medicationAdvice: ['胃胀反酸可考虑抑酸药或胃黏膜保护药', '腹泻时可先补液，必要时考虑止泻药'],
      visitAdvice: ['如果反复加重，再去消化内科', '如果黑便、持续呕吐或疼得明显，尽快线下'],
      examAdvice: ['先从血常规、便常规或腹部查体开始'],
      needsBooking: false,
      needsCost: false,
    };
  }

  if (scenarioId === 'respiratory') {
    return {
      recommendationLevel: 'otc_guidance',
      severityLevel: 'moderate',
      severityText: '目前更像呼吸道感染或刺激后的不适，先看轻重再决定要不要就医。',
      userGoal: '先缓解当前不适，再判断需不需要去医院',
      actionSummary: '可以先按呼吸道不适做对症处理；如果咳喘、发热或拖得久，再去呼吸内科更稳。',
      selfCareAdvice: ['先多休息、多喝水', '少熬夜，避免烟酒刺激'],
      medicationAdvice: ['发热可考虑退热药', '咽痛咳嗽可考虑止咳化痰或含片类药物'],
      visitAdvice: ['发热超过 3 天或气促明显时去呼吸内科', '老人、小孩或慢病人群别硬扛太久'],
      examAdvice: ['必要时先做血常规、CRP、胸片'],
      needsBooking: false,
      needsCost: false,
    };
  }

  if (scenarioId === 'lumbar') {
    return {
      recommendationLevel: 'otc_guidance',
      severityLevel: 'moderate',
      severityText: '当前更像肌肉劳损或腰椎相关不适，可先短期对症处理并观察。',
      userGoal: '先缓解疼痛，再判断是否需要影像检查',
      actionSummary: '先按腰背部劳损方向处理，若1-3天不缓解或腿麻加重，再去骨科就诊。',
      selfCareAdvice: ['先避免搬重物和久坐', '可热敷、轻度活动，不建议完全卧床'],
      medicationAdvice: ['可短期考虑外用止痛类药物；胃病或慢病人群用口服药前先问医生'],
      visitAdvice: ['若出现进行性腿无力、大小便异常，尽快急诊或骨科就诊'],
      examAdvice: ['门诊通常先做体格评估；必要时再做腰椎X线/MRI'],
      needsBooking: false,
      needsCost: true,
    };
  }

  if (scenarioId === 'urinary') {
    return {
      recommendationLevel: 'routine_clinic',
      severityLevel: 'moderate',
      severityText: '当前更像泌尿系统刺激或感染相关问题，建议门诊尽快评估。',
      userGoal: '先判断是否感染及是否需要抗感染治疗',
      actionSummary: '建议先去泌尿外科或内科门诊做尿检，明确后再定治疗方案。',
      selfCareAdvice: ['先保证饮水量，避免憋尿', '近期避免辛辣和酒精刺激'],
      medicationAdvice: ['抗感染用药建议在线下医生评估后使用，避免自行长期用药'],
      visitAdvice: ['若发热、腰痛或血尿明显，建议尽快线下就诊'],
      examAdvice: ['首轮优先尿常规和炎症指标，必要时补做泌尿系B超'],
      needsBooking: true,
      needsCost: true,
    };
  }

  if (scenarioId === 'skinTrauma') {
    return {
      recommendationLevel: 'otc_guidance',
      severityLevel: 'moderate',
      severityText: '当前更像局部皮肤/外伤问题，先规范处理并短期观察通常可行。',
      userGoal: '先控制局部症状，判断是否需要线下清创或抗感染处理',
      actionSummary: '先做清洁消毒和局部护理，若红肿扩大、渗液或发热，尽快线下处理。',
      selfCareAdvice: ['保持局部清洁干燥，避免反复摩擦', '不要自行挤压或频繁更换刺激性药物'],
      medicationAdvice: ['可短期考虑外用消毒/抗炎药物，出现感染迹象时及时就医'],
      visitAdvice: ['若深伤口、持续出血或范围明显扩大，建议尽快外科/皮肤科就诊'],
      examAdvice: ['门诊先做创面评估，必要时换药或进一步影像检查'],
      needsBooking: false,
      needsCost: true,
    };
  }

  if (scenarioId === 'eye') {
    return {
      recommendationLevel: 'otc_guidance',
      severityLevel: 'moderate',
      severityText: '目前更像眼部轻中度不适，先对症处理并观察更稳妥。',
      userGoal: '先缓解不适并识别是否存在眼科急症信号',
      actionSummary: '先按眼表刺激方向处理，若视力变差或眼痛明显，尽快到眼科面诊。',
      selfCareAdvice: ['先减少连续用眼，规律休息', '不要揉眼，先做好基础眼部护理'],
      medicationAdvice: ['可短期考虑人工泪液等对症处理'],
      visitAdvice: ['若突发视力下降、畏光明显、眼痛加重，尽快眼科就诊'],
      examAdvice: ['门诊通常先做视力、裂隙灯和眼压检查'],
      needsBooking: false,
      needsCost: true,
    };
  }

  if (scenarioId === 'maleHealth') {
    return {
      recommendationLevel: 'routine_clinic',
      severityLevel: 'moderate',
      severityText: '这类问题常见，但往往要结合压力、睡眠和慢病情况一起看。',
      userGoal: '先搞清楚这是偶发问题，还是值得系统评估的持续问题',
      actionSummary: '先把持续时间、频率、压力睡眠和勃起情况弄清楚；如果反复存在，再挂男科或泌尿外科。',
      selfCareAdvice: ['先看最近压力和睡眠', '别把偶发情况直接当成大问题'],
      medicationAdvice: ['如果后续确实需要药物，多半要医生结合年龄和基础病来定'],
      visitAdvice: ['如果反复几个月都在影响性生活，再去男科或泌尿外科', '先挂普通号一般就够了'],
      examAdvice: ['医生可能会先问病史，再决定要不要查血糖、激素或前列腺相关'],
      needsBooking: true,
      needsCost: true,
    };
  }

  if (scenarioId === 'general') {
    return {
      recommendationLevel: 'routine_clinic',
      severityLevel: 'moderate',
      severityText: '目前信息还不够集中，先做分诊比盲目猜单一方向更稳妥。',
      userGoal: '先把方向缩小到1~3个，再决定专科和检查路径',
      actionSummary: '建议先到全科/内科门诊分诊，带上现有资料，先做基础检查再定专科。',
      selfCareAdvice: ['继续观察症状变化，尤其是加重/缓解规律', '把持续时间、诱因、伴随症状补充完整'],
      medicationAdvice: ['若需用药，先按当前最主要症状做短期对症处理'],
      visitAdvice: ['可先挂全科/内科普通号，再按医生建议转专科', '若出现红旗症状，直接急诊'],
      examAdvice: ['先做血常规、基础生化等通用检查，避免一开始做过多大检查'],
      needsBooking: true,
      needsCost: true,
    };
  }

  return {
    recommendationLevel: 'routine_clinic',
    severityLevel: 'moderate',
    severityText: '目前更适合先做初步判断，再决定要不要线下进一步检查。',
    userGoal: '先判断方向、科室和下一步该怎么处理',
    actionSummary: `当前先按 ${session.scenario?.department || '相关科室'} 方向考虑，更稳妥的是先做初步判断，再决定要不要去医院。`,
    selfCareAdvice: ['先别太焦虑，先把症状变化记清楚', '这段时间注意休息和饮食规律'],
    medicationAdvice: [],
    visitAdvice: [`如果这两天一直不缓解，再去${session.scenario?.department || '相关科室'}看看`],
    examAdvice: ['如果要线下看，一般先从基础检查开始'],
    needsBooking: true,
    needsCost: true,
  };
}

function buildTriageResult(session) {
  const sessionText = buildSessionSignalText(session);
  const routing = detectScenarioDetailed(sessionText || session.chiefComplaint || '');
  const scenario = routing.scenario || session.scenario || SCENARIOS.general;
  let normalizedBaseChecks = normalizeBaseChecksByRegion(scenario.baseChecks, session);
  const redFlag = hasRedFlag({
    chiefComplaint: session.chiefComplaint,
    answers: session.answers,
    supplements: session.supplements,
  });
  const urgentPlan = redFlag ? buildUrgentPlan(session, scenario) : null;
  if (urgentPlan?.baseChecks?.length) {
    normalizedBaseChecks = normalizeNamedItems(urgentPlan.baseChecks, session);
  }
  const answerCount = Object.keys(session.answers || {}).length;
  const confidence = confidenceLevel(answerCount, redFlag);
  const baseCost = calcBaseCost(normalizedBaseChecks);
  const schema = buildGenericSymptomSchema(session);
  const coverage = calcInfoCoverage(schema, session);
  const schemaHighlights = buildSchemaHighlights(schema);
  const possibleTypes = redFlag
    ? (urgentPlan?.possibleTypes || ['存在需要急诊先排查的风险', '建议尽快线下就医'])
    : buildPossibleTypes(session, schema, scenario.id);
  const supplementInsightSummaries = (session.supplementInsights || [])
    .map((item) => item.summary)
    .filter(Boolean)
    .slice(0, 2);
  const supplementNote = (session.supplements || []).length
    ? `已参考你补充的 ${session.supplements.length} 条信息。`
    : '';
  const fallbackGuidance = buildFallbackGuidance(session, scenario.id);
  const selfCarePlay = SELF_CARE_PLAYBOOK[scenario.id] || null;
  const preferSelfCare = !redFlag && selfCarePlay && shouldSelfCareFirst(session, schema);
  const stepCount = Number(session.followUp?.stepCount || 0);
  const reachedUpperFollowUp = stepCount >= 10;
  const lowConfidenceRouting = routing.ambiguous || routing.score < 2 || routing.scoreGap < 1;
  const unresolvedAfterEnoughTurns = !redFlag && reachedUpperFollowUp && (coverage.ratio < 0.7 || lowConfidenceRouting);
  const topDepartments = (routing.ranked || [])
    .filter((item) => item.score > 0)
    .slice(0, 3)
    .map((item) => item.scenario.department)
    .filter(Boolean);
  const mergedDepartments = topDepartments.length
    ? Array.from(new Set(topDepartments)).join(' / ')
    : '全科医学科 / 内科门诊';
  const guidance = redFlag
    ? {
      recommendationLevel: 'hospital_priority_high',
      severityLevel: 'high',
      severityText: '当前有高风险信号，建议立即线下就医，必要时急诊。',
      userGoal: '先快速排查高风险原因，避免延误',
      actionSummary: '你现在有紧急风险信号，建议尽快去急诊，不要继续等待。',
      selfCareAdvice: [],
      medicationAdvice: [],
      visitAdvice: [`请尽快到${urgentPlan?.department || '急诊医学科'}线下评估，不建议继续观察。`],
      examAdvice: urgentPlan?.examAdvice?.length
        ? urgentPlan.examAdvice
        : ['到院后优先做血常规、粪便潜血及医生建议的止血相关检查。'],
        needsBooking: true,
        needsCost: true,
      }
    : (unresolvedAfterEnoughTurns
        ? {
            recommendationLevel: 'routine_clinic',
            severityLevel: 'moderate',
            severityText: '信息仍不够集中，建议先分诊，不强行归到单一科室。',
            userGoal: '先由门诊分诊缩小方向，再决定专科与检查',
            actionSummary: '已追问多轮仍存在分歧，建议先挂全科/内科普通号，由医生分诊到更匹配科室。',
            selfCareAdvice: ['可以继续补充症状变化，后续再更新分析', '若症状明显加重，不要等待，尽快线下就医'],
            medicationAdvice: ['药物建议以对症短期为主，避免同时叠加多种药物'],
            visitAdvice: ['优先挂全科/内科普通号', `可备选：${mergedDepartments}`],
            examAdvice: ['首轮先做通用基础检查，再按分诊结果追加专项检查'],
            needsBooking: true,
            needsCost: true,
          }
        : (preferSelfCare
        ? {
            recommendationLevel: 'self_care',
            severityLevel: 'mild',
            severityText: selfCarePlay.severityText,
            userGoal: '先判断是否能先自我处理，以及何时需要就医',
            actionSummary: selfCarePlay.actionSummary,
            selfCareAdvice: selfCarePlay.selfCareAdvice || [],
            medicationAdvice: selfCarePlay.medicationAdvice ? [selfCarePlay.medicationAdvice] : [],
            visitAdvice: selfCarePlay.visitAdvice ? [selfCarePlay.visitAdvice] : [],
            examAdvice: [],
            needsBooking: false,
            needsCost: false,
          }
        : fallbackGuidance));

  const coreConclusion = guidance.actionSummary;

  return {
    riskLevel: redFlag ? 'urgent' : 'normal',
    confidence,
    scenario: scenario.label,
    layeredOutput: {
      core: {
        text: coreConclusion,
        personalizedText: schemaHighlights[0] || '',
        possibleTypes,
        suggestHospital: guidance.recommendationLevel === 'routine_clinic' && scenario.id === 'general'
          ? '先就近医院全科/内科分诊，再转专科'
          : scenario.hospitalLevel,
        suggestDepartment: guidance.recommendationLevel === 'hospital_priority_high'
          ? (urgentPlan?.department || '急诊医学科')
          : (guidance.recommendationLevel === 'routine_clinic' && unresolvedAfterEnoughTurns
          ? mergedDepartments
          : scenario.department),
        firstChecks: normalizedBaseChecks,
        firstCostRange: `${baseCost.min}~${baseCost.max}元`,
        recommendationLevel: guidance.recommendationLevel,
        severityLevel: guidance.severityLevel,
        severityText: guidance.severityText,
        userGoal: guidance.userGoal,
        needsBooking: guidance.needsBooking,
        needsCost: guidance.needsCost,
      },
      detail: {
        whyDepartment: guidance.recommendationLevel === 'hospital_priority_high'
          ? `当前存在高风险信号，建议优先到${urgentPlan?.department || '急诊医学科'}线下评估。`
          : (unresolvedAfterEnoughTurns
          ? `当前信息在多个方向上都有线索（信息覆盖 ${coverage.hit}/${coverage.total}），先分诊比硬判单科更稳妥。`
          : `根据你的主诉、追问答案和补充材料，当前更匹配 ${scenario.department} 的初筛路径。`),
        suspectedDirections: redFlag
          ? ['存在需要急诊先排查的风险']
          : (unresolvedAfterEnoughTurns
              ? (routing.ranked || [])
                .filter((item) => item.score > 0)
                .slice(0, 3)
                .map((item) => `可能方向：${item.scenario.label}`)
              : [`当前最相关：${scenario.label}`, '先做基础检查后再决定是否追加影像检查']),
        slotHighlights: schemaHighlights,
        schema,
        stepByStep: [
          ...(supplementNote ? [supplementNote] : []),
          ...schema.testFindings.slice(0, 2).map((item) => `已上传材料提示：${item}`),
          ...supplementInsightSummaries.map((item) => `补充信息提示：${item}`),
          ...scenario.nextStepRules,
        ],
        selfCareAdvice: guidance.selfCareAdvice,
        medicationAdvice: guidance.medicationAdvice,
        visitAdvice: guidance.visitAdvice,
        examAdvice: guidance.examAdvice,
      },
      riskReminder: [
        '如果出现胸痛加重、呼吸困难、意识模糊、剧烈头痛、肢体无力等情况，请尽快去急诊。',
        '本结果仅作就医前咨询参考，不能替代医生面诊。',
      ],
    },
  };
}

function buildCostEstimate(session) {
  const scenario = session.scenario;
  const triageResult = session.triageResult || buildTriageResult(session);
  const recommendationLevel = triageResult?.layeredOutput?.core?.recommendationLevel || '';
  const urgentMode = recommendationLevel === 'hospital_priority_high';
  const urgentPlan = urgentMode ? buildUrgentPlan(session, scenario) : null;
  const normalizedBaseChecks = urgentPlan?.baseChecks?.length
    ? normalizeNamedItems(urgentPlan.baseChecks, session)
    : normalizeBaseChecksByRegion(scenario.baseChecks, session);
  const region = {
    province: session.province || '',
    city: session.city || '',
    district: session.district || '',
  };
  const hasRegion = Boolean(region.province || region.city || region.district);
  const recommendations = hasRegion ? buildHospitalRecommendations(region, scenario) : [];
  const primaryHospital = recommendations[0] || null;
  const costFactor = getHospitalCostFactor(primaryHospital?.level || scenario.hospitalLevel);
  const range = buildNarrowCostRange(normalizedBaseChecks, costFactor);
  const feeItems = estimateFeeItems(normalizedBaseChecks, costFactor);
  const secondRoundBase = normalizeNamedItems(
    urgentPlan?.secondRoundChecks?.length ? urgentPlan.secondRoundChecks : (SECOND_ROUND_CHECKS[scenario.id] || SECOND_ROUND_CHECKS.general || []),
    session
  );
  const secondRound = estimateSecondRoundItems(secondRoundBase, costFactor);
  const medicationRefs = MEDICATION_PRICE_RANGES[scenario.id] || MEDICATION_PRICE_RANGES.general || [];

  return {
    simple: {
      costRange: `${range.min}~${range.max}元`,
      basedOn: primaryHospital ? `${primaryHospital.name}（${primaryHospital.level}）` : scenario.hospitalLevel,
      pricingRule: urgentMode
        ? '按急诊优先排查路径 + 当前地区价格样板估算'
        : '按首选医院级别 + 常规门诊基础检查项目估算',
      needMoreChecks: '视首轮检查结果决定是否追加检查',
    },
    expanded: {
      feeItems,
      secondRoundChecks: secondRound,
      medicationPriceRefs: medicationRefs,
      ifThen: scenario.nextStepRules,
      updateCycle: `样板价格按月整理，当前版本：${costReference?.version || '2026-04'}`,
      disclaimer: '不同医院同项目价格会有波动，先按首轮基础检查范围做预算更稳妥。',
    },
  };
}

function buildBookingSuggestion(session) {
  const scenario = session.scenario;
  const region = {
    province: session.province || '',
    city: session.city || '',
    district: session.district || '',
  };
  const regionText = formatRegionName(region);
  const hasRegion = Boolean(session.district || session.city || session.province);
  const recommendations = hasRegion ? buildHospitalRecommendations(region, scenario) : [];
  return {
    requiresRegion: !hasRegion,
    confirmedRegion: regionText,
    hospitalSuggestion: `${regionText || '本地'}县人民医院/市医院（按症状轻重选择）`,
    department: scenario.department,
    ticketType: '建议先挂普通号，首诊后再决定是否转专家号',
    urgency: '如症状持续加重，建议48小时内就诊；出现急症信号立即急诊。',
    preparation: scenario.preparation,
    hospitals: recommendations,
  };
}

function getSessionTextForSemanticSkip(session = {}) {
  return [
    session.chiefComplaint || '',
    ...Object.values(session.answers || {}).map((item) => String(item || '')),
    ...(session.supplements || []).map((item) => String(item || '')),
    ...(session.supplementInsights || []).map((item) => String(item.summary || '')),
  ]
    .join(' ')
    .toLowerCase();
}

const SEMANTIC_SKIP_PATTERNS = {
  duration: /(多久|几天|几周|几个月|持续|反复|一直|最近.*天)/,
  frequency: /(频繁|一天几次|每天|偶尔|反复发作|次数)/,
  location: /(左|右|上腹|下腹|胸口|喉咙|耳朵|眼睛|膝盖|腰|颈|部位)/,
  history: /(既往|以前|病史|慢病|长期用药|家族史)/,
  trend: /(加重|缓解|好转|变化|进展|越来越|减轻)/,
  riskSignal: /(胸痛|呼吸困难|黑便|便血|呕血|说话不清|肢体无力|晕倒|高热)/,
  problemType: /(主要是|最困扰|哪种感觉|哪方面)/,
  triggerTime: /(活动后|进食后|夜间|熬夜|诱因|冷热刺激)/,
  cause: /(扭伤|外伤|搬重物|诱因|原因)/,
  infectionSigns: /(发热|发烧|化脓|渗液|感染|寒战)/,
  bowelChange: /(大便|便秘|腹泻|排便|便血|黑便)/,
  urinationPain: /(尿频|尿急|尿痛|尿液|小便)/,
  nightPattern: /(夜间|晚上|夜里)/,
  lifeImpact: /(影响生活|工作|睡眠|情绪|功能)/,
};

function shouldSkipQuestionByContext(session = {}, question = {}) {
  const slot = String(question.slot || '').trim();
  if (!slot) return false;
  if (session.followUp?.slotState?.[slot]?.answer) return true;
  const text = getSessionTextForSemanticSkip(session);
  if (!text) return false;
  const pattern = SEMANTIC_SKIP_PATTERNS[slot];
  if (!pattern) return false;
  if (!pattern.test(text)) return false;
  const strictSlots = new Set(['duration', 'frequency', 'location', 'history', 'trend', 'riskSignal']);
  // 这些关键槽位即便开放式文本里提到，也仍然优先保留结构化确认，避免“只说过一次就被视为问清楚”。
  if (strictSlots.has(slot)) return false;
  const questionText = String(question.text || '');
  return questionText.length > 0;
}

module.exports = {
  SCENARIOS,
  detectScenarioDetailed,
  detectScenario,
  getScenarioSlotCatalog,
  shouldSkipQuestionByContext,
  buildGenericSymptomSchema,
  buildTriageResult,
  buildCostEstimate,
  buildBookingSuggestion,
};
