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
      { id: 'duration', text: '这种不舒服持续多久了？', options: ['不到1天', '1-3天', '超过1周', '反复超过1个月'] },
      { id: 'chestPain', text: '有没有明显胸痛或胸口压榨感？', options: ['没有', '偶尔', '持续存在'] },
      { id: 'breath', text: '最近活动后会不会更喘？', options: ['不会', '有一点', '明显会'] },
      { id: 'history', text: '以前有高血压/心脏病吗？', options: ['没有', '有高血压', '有心脏病', '两者都有'] },
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
      { id: 'position', text: '主要是左边、右边还是中间痛？', options: ['左边', '右边', '中间', '说不清'] },
      { id: 'style', text: '更像酸胀还是刺痛？', options: ['酸胀', '刺痛', '酸痛都有'] },
      { id: 'trauma', text: '最近有扭伤、搬重物或外伤吗？', options: ['没有', '有'] },
      { id: 'numbness', text: '有没有腿麻或走路发软？', options: ['没有', '有一点', '明显有'] },
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
      { id: 'location', text: '主要是上腹不舒服还是肚脐周围？', options: ['上腹', '肚脐周围', '下腹', '不固定'] },
      { id: 'eatRel', text: '和吃饭关系大吗？', options: ['饭前更明显', '饭后更明显', '关系不大'] },
      { id: 'stool', text: '大便有没有异常（腹泻/黑便）？', options: ['没有', '腹泻', '黑便', '便秘'] },
      { id: 'fever', text: '有没有发热或反复呕吐？', options: ['没有', '有发热', '有呕吐', '两者都有'] },
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
      { id: 'pain', text: '小便时会不会疼？', options: ['不会', '有一点', '明显疼'] },
      { id: 'fever', text: '有没有发烧或腰背痛？', options: ['没有', '有发烧', '有腰背痛', '两者都有'] },
      { id: 'blood', text: '有没有看到尿里带血？', options: ['没有', '有一点', '明显有'] },
      { id: 'duration', text: '症状持续多久了？', options: ['不到3天', '3-7天', '超过1周', '反复超过1个月'] },
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
      { id: 'feverDays', text: '发热持续几天了？', options: ['没发热', '1-2天', '3天以上'] },
      { id: 'sputum', text: '咳嗽有痰吗？', options: ['无痰', '白痰', '黄痰', '带血丝'] },
      { id: 'breath', text: '会不会感觉喘不上气？', options: ['不会', '有一点', '明显会'] },
      { id: 'chronic', text: '有没有慢性肺病/哮喘史？', options: ['没有', '有'] },
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
      { id: 'type', text: '更像外伤还是皮肤起疹子？', options: ['外伤', '皮肤起疹', '两者都有'] },
      { id: 'infection', text: '有没有渗液、化脓或明显红肿热痛？', options: ['没有', '有一点', '明显有'] },
      { id: 'fever', text: '有没有发热？', options: ['没有', '有'] },
      { id: 'duration', text: '这个问题持续多久了？', options: ['不到1天', '1-3天', '超过3天'] },
    ],
  },
};

const INSURANCE_GUIDE = {
  '无医保': '你当前没有医保，建议先去县医院做首轮基础检查，避免一次做太多高价项目。',
  '体制内医保': '体制内医保通常门诊和住院报销比例较好，先走普通门诊，必要时再升级检查更划算。',
  '城镇职工医保': '职工医保一般门诊有一定报销，慢病长期用药可咨询当地是否支持慢病备案。',
  '城乡居民医保': '居民医保门诊报销比例通常低于住院，先做基础检查后再决定是否转上级医院更省钱。',
};

function normalizeText(v) {
  return String(v || '').trim().toLowerCase();
}

function detectScenario(chiefComplaint = '') {
  const text = normalizeText(chiefComplaint);
  let best = SCENARIOS.cardio;
  let bestScore = -1;

  for (const scenario of Object.values(SCENARIOS)) {
    const score = scenario.keywords.reduce((acc, kw) => (text.includes(kw) ? acc + 1 : acc), 0);
    if (score > bestScore) {
      best = scenario;
      bestScore = score;
    }
  }

  return best;
}

function hasRedFlag({ chiefComplaint = '', answers = {} }) {
  const text = `${chiefComplaint} ${Object.values(answers).join(' ')}`;
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
  if (answerCount >= 4) return '高概率方向';
  if (answerCount >= 2) return '可能方向';
  return '信息不足，建议线下检查';
}

function buildTriageResult(session) {
  const scenario = session.scenario;
  const redFlag = hasRedFlag({ chiefComplaint: session.chiefComplaint, answers: session.answers });
  const answerCount = Object.keys(session.answers || {}).length;
  const confidence = confidenceLevel(answerCount, redFlag);
  const baseCost = calcBaseCost(scenario.baseChecks);

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
        stepByStep: scenario.nextStepRules,
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
  const insurance = session.insuranceType || '无医保';
  return {
    simple: {
      costRange: `${baseCost.min}~${baseCost.max}元`,
      insuranceCoverage: '部分可报，具体以当地医保窗口为准',
      costEffectivePlan: scenario.hospitalLevel,
      needMoreChecks: '视首轮检查结果决定是否追加检查',
    },
    expanded: {
      feeItems: scenario.baseChecks,
      ifThen: scenario.nextStepRules,
      insuranceGuide: INSURANCE_GUIDE[insurance] || INSURANCE_GUIDE['无医保'],
      disclaimer: '医保政策按地区和时间调整，请以当地医保窗口最新口径为准。',
    },
  };
}

function buildBookingSuggestion(session) {
  const scenario = session.scenario;
  const regionText = [session.province, session.city, session.district].filter(Boolean).join('');
  return {
    hospitalSuggestion: `${regionText || '本地'}县人民医院/市医院（按症状轻重选择）`,
    department: scenario.department,
    ticketType: '建议先挂普通号，首诊后再决定是否转专家号',
    urgency: '如症状持续加重，建议48小时内就诊；出现急症信号立即急诊。',
    preparation: scenario.preparation,
    bookingLinks: [
      { label: '国家医保服务平台', url: 'https://fuwu.nhsa.gov.cn' },
      { label: '微信搜医院公众号挂号', url: 'https://weixin.qq.com' },
    ],
  };
}

module.exports = {
  SCENARIOS,
  detectScenario,
  buildTriageResult,
  buildCostEstimate,
  buildBookingSuggestion,
};
