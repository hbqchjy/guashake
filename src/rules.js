const { buildHospitalRecommendations, formatRegionName } = require('./hospitals');

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
    keywords: ['肚子痛', '胃不舒服', '胃痛', '反酸', '拉肚子', '恶心'],
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
};

const INSURANCE_GUIDE = {
  '无医保': '你当前没有医保，建议先去县医院做首轮基础检查，避免一次做太多高价项目。',
  '城镇职工医保': '职工医保一般门诊有一定报销，慢病长期用药可咨询当地是否支持慢病备案。',
  '城乡居民医保': '居民医保门诊报销比例通常低于住院，先做基础检查后再决定是否转上级医院更省钱。',
  '其他商业医保': '商业医保通常要看你买的险种和条款，先把病历和票据留好，后面理赔会更方便。',
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
    [/咽痛|嗓子疼|感冒咳嗽/g, '咳嗽'],
    [/起疹子|过敏|皮肤发痒/g, '皮肤'],
    [/摔伤|碰伤|伤口/g, '外伤'],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function detectScenarioDetailed(chiefComplaint = '') {
  const text = expandComplaintText(chiefComplaint);
  let best = SCENARIOS.cardio;
  let bestScore = -1;

  for (const scenario of Object.values(SCENARIOS)) {
    const score = scenario.keywords.reduce((acc, kw) => (text.includes(kw) ? acc + 1 : acc), 0);
    if (score > bestScore) {
      best = scenario;
      bestScore = score;
    }
  }

  return {
    scenario: best,
    score: bestScore,
    normalizedText: text,
  };
}

function detectScenario(chiefComplaint = '') {
  return detectScenarioDetailed(chiefComplaint).scenario;
}

function hasRedFlag({ chiefComplaint = '', answers = {}, supplements = [] }) {
  const text = `${chiefComplaint} ${Object.values(answers).join(' ')} ${(supplements || []).join(' ')}`;
  return RED_FLAG_KEYWORDS.some((k) => text.includes(k));
}

function calcBaseCost(baseChecks) {
  const total = baseChecks.reduce(
    (acc, item) => ({ min: acc.min + item.min, max: acc.max + item.max }),
    { min: 0, max: 0 }
  );
  return total;
}

function confidenceLevel(answerCount, redFlag) {
  if (redFlag) return '高风险优先';
  if (answerCount >= 6) return '高概率方向';
  if (answerCount >= 3) return '可能方向';
  return '信息不足，建议线下检查';
}

function buildTriageResult(session) {
  const scenario = session.scenario;
  const redFlag = hasRedFlag({
    chiefComplaint: session.chiefComplaint,
    answers: session.answers,
    supplements: session.supplements,
  });
  const answerCount = Object.keys(session.answers || {}).length;
  const confidence = confidenceLevel(answerCount, redFlag);
  const baseCost = calcBaseCost(scenario.baseChecks);
  const supplementNote = (session.supplements || []).length
    ? `已参考你补充的 ${session.supplements.length} 条信息。`
    : '';

  const coreConclusion = redFlag
    ? '你现在有紧急风险信号，建议尽快去急诊，不要继续等待。'
    : `你这个情况优先考虑 ${scenario.department} 方向，先做基础检查更稳妥。`;

  return {
    riskLevel: redFlag ? 'urgent' : 'normal',
    confidence,
    scenario: scenario.label,
    layeredOutput: {
      core: {
        text: coreConclusion,
        suggestHospital: scenario.hospitalLevel,
        suggestDepartment: scenario.department,
        firstChecks: scenario.baseChecks,
        firstCostRange: `${baseCost.min}~${baseCost.max}元`,
      },
      detail: {
        whyDepartment: `根据你的主诉和追问答案，当前更匹配 ${scenario.department} 的初筛路径。`,
        suspectedDirections: redFlag
          ? ['存在需要急诊先排查的风险']
          : [`当前最相关：${scenario.label}`, '先做基础检查后再决定是否追加影像检查'],
        stepByStep: supplementNote ? [supplementNote, ...scenario.nextStepRules] : scenario.nextStepRules,
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
  const baseCost = calcBaseCost(scenario.baseChecks);
  const insurance = session.insuranceType || '';
  return {
    simple: {
      costRange: `${baseCost.min}~${baseCost.max}元`,
      insuranceCoverage: insurance ? '部分可报，具体以当地医保窗口为准' : '先选择医保类型，再看更贴近你的报销参考',
      costEffectivePlan: scenario.hospitalLevel,
      needMoreChecks: '视首轮检查结果决定是否追加检查',
    },
    expanded: {
      feeItems: scenario.baseChecks,
      ifThen: scenario.nextStepRules,
      insuranceGuide: insurance ? INSURANCE_GUIDE[insurance] || INSURANCE_GUIDE['无医保'] : '你先选一下医保类型，小科再把费用和报销说明补全。',
      disclaimer: '医保政策按地区和时间调整，请以当地医保窗口最新口径为准。',
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
  const recommendations = session.district ? buildHospitalRecommendations(region, scenario) : [];
  return {
    requiresRegion: !session.district,
    confirmedRegion: regionText,
    hospitalSuggestion: `${regionText || '本地'}县人民医院/市医院（按症状轻重选择）`,
    department: scenario.department,
    ticketType: '建议先挂普通号，首诊后再决定是否转专家号',
    urgency: '如症状持续加重，建议48小时内就诊；出现急症信号立即急诊。',
    preparation: scenario.preparation,
    hospitals: recommendations,
  };
}

module.exports = {
  SCENARIOS,
  detectScenarioDetailed,
  detectScenario,
  buildTriageResult,
  buildCostEstimate,
  buildBookingSuggestion,
};
