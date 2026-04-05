const express = require('express');
const crypto = require('crypto');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const {
  SCENARIOS,
  detectScenarioDetailed,
  detectScenario,
  getScenarioSlotCatalog,
  shouldSkipQuestionByContext,
  buildTriageResult,
  buildCostEstimate,
  buildBookingSuggestion,
} = require('./rules');
const { searchRegions } = require('./regions');
const { hubeiHospitalDirectory } = require('./hospitals');
const {
  upsertSession,
  getSession,
  saveArchive,
  getArchive,
  getArchives,
  deleteArchive,
  upsertUser,
  getUser,
  getUserByPhone,
  createAuthRequest,
  consumeAuthRequest,
  createAuthTicket,
  consumeAuthTicket,
  trackSymptomClick,
  incrementConsultationCount,
  getQuickSymptomAnalytics,
  findDrugRefsByScenarios,
} = require('./store');
const { summarizeFile, buildSummarySlotHints } = require('./file-summary');
const {
  classifyComplaint,
  analyzeInitialTurn,
  classifyConversationTurn,
  chooseNextFollowUp,
  planOpenInterviewTurn,
  interpretSupplement,
  personalizeTriageResult,
  buildGuidanceDecision,
  answerFollowUpTurn,
  rewriteTriageResult,
  getStatus: getAiStatus,
  speechToText,
  synthesizeSpeech,
  analyzeCheckSheet,
  analyzePrescription,
  analyzeReport,
} = require('./ai');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);

app.use(cors());
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use(express.static(path.join(__dirname, '..', 'public')));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

function getWechatOauthConfig(req) {
  const appId = process.env.WECHAT_APP_ID || '';
  const appSecret = process.env.WECHAT_APP_SECRET || '';
  const callbackUrl = process.env.WECHAT_OAUTH_CALLBACK_URL || `${getOrigin(req)}/auth/wechat/callback`;
  return {
    configured: Boolean(appId && appSecret),
    appId,
    appSecret,
    callbackUrl,
    scope: process.env.WECHAT_OAUTH_SCOPE || 'snsapi_userinfo',
  };
}

function sanitizeReturnTo(raw, req) {
  const origin = getOrigin(req);
  try {
    const target = new URL(raw || '/', origin);
    if (target.origin !== origin) return `${origin}/`;
    return `${target.origin}${target.pathname}${target.search}`;
  } catch (_error) {
    return `${origin}/`;
  }
}

function appendQuery(rawUrl, key, value) {
  const target = new URL(rawUrl);
  target.searchParams.set(key, value);
  return target.toString();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, digest = '') {
  const [salt, expected] = String(digest || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function buildPasswordAuthPayload(user) {
  return {
    loggedIn: true,
    provider: 'password',
    userId: user.userId,
    nickname: user.nickname || `用户${String(user.phone || '').slice(-4)}`,
    avatarUrl: '',
    openId: '',
    phone: user.phone || '',
  };
}

function buildAccountSummary(userId) {
  const user = getUser(userId);
  if (!user) return null;
  const records = getArchives(userId).slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const latest = records[0] || null;
  return {
    userId: user.userId,
    provider: user.provider || 'password',
    providerLabel: user.provider === 'password' ? '手机号账号' : '其他账号',
    phone: user.phone || '',
    nickname: user.nickname || '',
    createdAt: user.createdAt || user.updatedAt || '',
    lastLoginAt: user.lastLoginAt || '',
    recordCount: records.length,
    latestRecordAt: latest?.createdAt || '',
    latestLikelyType: latest?.likelyType || latest?.summarySnapshot?.core?.possibleTypes?.[0] || '',
    latestSummary: latest?.summaryText || latest?.summary || '',
  };
}

async function requestWechatToken(code, config) {
  const tokenUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
  tokenUrl.searchParams.set('appid', config.appId);
  tokenUrl.searchParams.set('secret', config.appSecret);
  tokenUrl.searchParams.set('code', code);
  tokenUrl.searchParams.set('grant_type', 'authorization_code');
  const response = await fetch(tokenUrl);
  const payload = await response.json();
  if (!response.ok || payload.errcode) {
    throw new Error(payload.errmsg || 'wechat access_token failed');
  }
  return payload;
}

async function requestWechatUserInfo(tokenPayload) {
  const userInfoUrl = new URL('https://api.weixin.qq.com/sns/userinfo');
  userInfoUrl.searchParams.set('access_token', tokenPayload.access_token);
  userInfoUrl.searchParams.set('openid', tokenPayload.openid);
  userInfoUrl.searchParams.set('lang', 'zh_CN');
  const response = await fetch(userInfoUrl);
  const payload = await response.json();
  if (!response.ok || payload.errcode) {
    throw new Error(payload.errmsg || 'wechat userinfo failed');
  }
  return payload;
}

function mergeTriageWithAi(fallbackResult, aiRewrite) {
  if (!aiRewrite) return fallbackResult;

  return {
    ...fallbackResult,
    aiEnhanced: true,
    layeredOutput: {
      ...fallbackResult.layeredOutput,
      core: {
        ...fallbackResult.layeredOutput.core,
        text: aiRewrite.coreText || fallbackResult.layeredOutput.core.text,
      },
      detail: {
        ...fallbackResult.layeredOutput.detail,
        whyDepartment: aiRewrite.whyDepartment || fallbackResult.layeredOutput.detail.whyDepartment,
        suspectedDirections: Array.isArray(aiRewrite.suspectedDirections) && aiRewrite.suspectedDirections.length
          ? aiRewrite.suspectedDirections.slice(0, 3)
          : fallbackResult.layeredOutput.detail.suspectedDirections,
        stepByStep: Array.isArray(aiRewrite.stepByStep) && aiRewrite.stepByStep.length
          ? aiRewrite.stepByStep.slice(0, 4)
          : fallbackResult.layeredOutput.detail.stepByStep,
      },
      riskReminder: Array.isArray(aiRewrite.riskReminder) && aiRewrite.riskReminder.length
        ? aiRewrite.riskReminder.slice(0, 3)
        : fallbackResult.layeredOutput.riskReminder,
    },
  };
}

function getImageRiskSignal(session) {
  const files = Array.isArray(session?.supplementFiles) ? session.supplementFiles : [];
  if (!files.length) return null;
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const summary = files[i]?.summary || {};
    const level = String(summary.riskLevel || '').toLowerCase();
    if (['high', 'medium', 'low'].includes(level)) {
      return {
        level,
        riskText: String(summary.riskText || '').trim(),
        suggestDepartment: Array.isArray(summary.suggestDepartment) ? summary.suggestDepartment.filter(Boolean) : [],
      };
    }
  }
  return null;
}

function getTextRiskSignal(session) {
  const text = [
    session?.chiefComplaint || '',
    ...((session?.supplements || []).slice(-10)),
  ]
    .join(' ')
    .trim();
  if (!text) return null;

  const hasPositiveKeyword = (source = '', keyword = '') => {
    const value = String(source || '').toLowerCase();
    const token = String(keyword || '').toLowerCase();
    if (!value || !token) return false;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const deniedPattern = new RegExp(`(没有|无|否认|并无|未见|不是|并非)[^，。；;,.]{0,3}${escaped}`);
    if (deniedPattern.test(value)) return false;
    return value.includes(token);
  };

  const urgentKeywords = [
    '柏油样便',
    '柏油便',
    '黑便',
    '呕血',
    '便血',
    '上消化道出血',
    '呼吸困难',
    '胸痛加重',
    '意识模糊',
    '肢体无力',
    '说话不清',
    '口角歪斜',
    '偏瘫',
    '单侧肢体无力',
    '胸痛',
    '濒死感',
    '冷汗',
    '喉头水肿',
    '咽喉紧缩',
    '全身风团',
    '高热不退',
    '神志改变',
    '刀割样腹痛',
    '反跳痛',
    '大量出血',
    '停经后出血',
    '阴道大出血',
    '剧烈下腹痛伴停经',
    '胎动减少',
    '破水',
    '产后大出血',
    '高热惊厥',
    '儿童持续抽搐',
    '婴幼儿呼吸急促',
    '意识淡漠',
    '自杀',
    '轻生',
    '不想活',
    '自残',
    '伤人',
    '幻觉',
    '妄想',
  ];
  const hasUrgent = urgentKeywords.some((k) => hasPositiveKeyword(text, k));
  if (!hasUrgent) return null;

  return {
    level: 'high',
    riskText: '补充信息提示高风险信号，建议尽快线下就医，必要时急诊。',
  };
}

function applyTextRiskGuidance(triageResult, session) {
  const signal = getTextRiskSignal(session);
  if (!triageResult || !signal) return triageResult;

  const layeredOutput = triageResult.layeredOutput || {};
  const core = layeredOutput.core || {};
  const detail = layeredOutput.detail || {};
  const riskReminder = Array.isArray(layeredOutput.riskReminder) ? layeredOutput.riskReminder : [];

  return {
    ...triageResult,
    riskLevel: 'urgent',
    layeredOutput: {
      ...layeredOutput,
      core: {
        ...core,
        text: '你这次补充的信息提示风险偏高，建议尽快线下就医。',
        recommendationLevel: 'hospital_priority_high',
        severityLevel: 'high',
        severityText: signal.riskText,
        needsBooking: true,
        needsCost: true,
      },
      detail: {
        ...detail,
        visitAdvice: Array.from(new Set(['请尽快去医院面诊，必要时急诊。', ...(Array.isArray(detail.visitAdvice) ? detail.visitAdvice : [])])),
      },
      riskReminder: Array.from(new Set([signal.riskText, ...riskReminder])).slice(0, 4),
    },
  };
}

function applyImageRiskGuidance(triageResult, session) {
  const signal = getImageRiskSignal(session);
  if (!triageResult || !signal) return triageResult;

  const layeredOutput = triageResult.layeredOutput || {};
  const core = layeredOutput.core || {};
  const detail = layeredOutput.detail || {};
  const riskReminder = Array.isArray(layeredOutput.riskReminder) ? layeredOutput.riskReminder : [];
  const riskLine = signal.riskText || '图片提示当前风险偏高，建议尽快去医院面诊。';
  const suggestedDepartment = signal.suggestDepartment[0] || core.suggestDepartment;

  if (signal.level !== 'high') {
    return {
      ...triageResult,
      layeredOutput: {
        ...layeredOutput,
        core: {
          ...core,
          imageRiskLevel: signal.level,
          imageRiskText: signal.riskText || '',
          imageSuggestedDepartments: signal.suggestDepartment,
        },
      },
    };
  }

  return {
    ...triageResult,
    layeredOutput: {
      ...layeredOutput,
      core: {
        ...core,
        text: '图片里有较高风险信号，建议今天尽快去医院面诊。',
        recommendationLevel: 'hospital_priority_high',
        severityLevel: 'high',
        severityText: riskLine,
        needsBooking: true,
        needsCost: true,
        suggestDepartment: suggestedDepartment,
        imageRiskLevel: signal.level,
        imageRiskText: signal.riskText || '',
        imageSuggestedDepartments: signal.suggestDepartment,
      },
      detail: {
        ...detail,
        visitAdvice: Array.from(
          new Set([
            '建议尽快线下就医，必要时急诊评估。',
            ...(Array.isArray(detail.visitAdvice) ? detail.visitAdvice : []),
          ])
        ),
      },
      riskReminder: Array.from(new Set([riskLine, ...riskReminder])).slice(0, 4),
    },
  };
}

function hasHighImageRisk(session) {
  const signal = getImageRiskSignal(session);
  return Boolean(signal && signal.level === 'high');
}

function shouldImmediateUrgent(session, latestText = '') {
  if (hasEscalationSignal(latestText)) return true;
  if (getTextRiskSignal(session)) return true;
  if (hasHighImageRisk(session)) return true;
  return false;
}

function buildUrgentShortcutResult(session) {
  let triageResult = buildTriageResult(session);
  triageResult = applyTextRiskGuidance(triageResult, session);
  triageResult = applyImageRiskGuidance(triageResult, session);
  return triageResult;
}

function getFollowUpConfig(session) {
  const totalQuestions = session?.scenario?.questions?.length || 0;
  return {
    minSteps: Math.min(6, Math.max(4, totalQuestions)),
    maxSteps: Math.min(12, Math.max(8, totalQuestions)),
  };
}

function getStructuredProgressTotal(config = {}, candidateCount = 0, currentStep = 1) {
  const maxSteps = Number(config.maxSteps || 10);
  const step = Math.max(1, Number(currentStep || 1));
  const candidates = Math.max(1, Number(candidateCount || 1));
  const estimatedTotal = step + Math.max(0, candidates - 1);
  return Math.max(3, Math.min(maxSteps, estimatedTotal));
}

function shouldDelayResultConfirmation(session, stepCount = 0) {
  const structuredSteps = Number(stepCount || session?.followUp?.stepCount || 0);
  return structuredSteps < 3;
}

function getAskedQuestionIds(session) {
  return Array.isArray(session.followUp?.askedQuestionIds) ? session.followUp.askedQuestionIds : [];
}

function getFallbackNextQuestion(session) {
  const asked = new Set(getAskedQuestionIds(session));
  const slotCatalog = getScenarioSlotCatalog(session.scenario || {});
  return (session.scenario?.questions || [])
    .map((question) => {
      const slotMeta = slotCatalog.find((item) => item.questionId === question.id) || {};
      return {
        ...question,
        slot: slotMeta.slot || question.id,
        slotLabel: slotMeta.slotLabel || slotMeta.slot || question.id,
      };
    })
    .find((question) => !asked.has(question.id) && !shouldSkipQuestionByContext(session, question)) || null;
}

function isSlotFilled(session, slot) {
  if (!slot) return false;
  const slotState = session.followUp?.slotState || {};
  return Boolean(slotState[slot]?.answer);
}

function mapIntentToFocus(intentType = '', topicKey = '', focusLabel = '') {
  const intentMap = {
    medical_followup: { key: 'symptom', label: '症状判断' },
    medication_question: { key: 'medication', label: '用药顾虑' },
    booking_question: { key: 'booking', label: '挂号医院' },
    cost_question: { key: 'cost', label: '费用参考' },
    report_notice: { key: 'report', label: '报告解读' },
    new_issue: { key: 'new_issue', label: '新的问题' },
    off_topic: { key: 'other', label: '当前无关' },
  };
  const fallback = intentMap[intentType] || { key: 'symptom', label: '症状判断' };
  return {
    key: topicKey || fallback.key,
    label: focusLabel || fallback.label,
  };
}

function shouldPersistAsSupplement(intentType = '') {
  return ['medical_followup', 'cost_question', 'booking_question', 'report_notice'].includes(intentType);
}

function looksMedicalFollowup(text = '') {
  const value = String(text || '').trim();
  if (!value) return false;
  return /(疼|痛|闷|慌|晕|咳|痰|喘|烧|发热|拉肚子|便秘|尿频|尿急|尿痛|出血|恶心|呕吐|失眠|乏力|麻|肿|心跳|血压|呼吸|胸|腹|头|药|挂号|检查|报告|医院|科)/.test(value);
}

function hasEscalationSignal(text = '') {
  const value = String(text || '').trim();
  if (!value) return false;
  if (hasDeescalationSignal(value)) {
    const clarificationPatterns = [
      /不是黑便/,
      /不是便血/,
      /不是呕血/,
      /看错了/,
      /并非黑便/,
      /普通深褐色/,
      /没有黑便/,
      /没有便血/,
      /没有呕血/,
      /头晕也没有了/,
      /已经没有了/,
    ];
    if (clarificationPatterns.some((pattern) => pattern.test(value))) {
      return false;
    }
  }
  const hasPositiveKeyword = (source = '', keyword = '') => {
    const raw = String(source || '').toLowerCase();
    const token = String(keyword || '').toLowerCase();
    if (!raw || !token) return false;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const deniedPattern = new RegExp(`(没有|无|否认|并无|未见|不是|并非|看错了|排除)[^，。；;,.]{0,10}${escaped}`);
    if (deniedPattern.test(raw)) return false;
    return raw.includes(token);
  };
  const signalKeywords = [
    '加重', '越来越', '夜间憋醒', '走路都喘', '呼吸困难', '胸痛', '黑便', '便血', '高烧',
    '意识模糊', '说话不清', '口角歪斜', '偏瘫', '肢体无力', '抽搐', '晕倒', '剧烈头痛',
    '喉咙紧', '喉头水肿', '全身风团', '大量出血', '刀割样腹痛', '反跳痛', '停经后出血',
    '阴道大出血', '胎动减少', '破水', '产后大出血', '高热惊厥', '自杀', '轻生', '不想活',
    '自残', '伤人', '幻觉', '妄想',
  ];
  return signalKeywords.some((keyword) => hasPositiveKeyword(value, keyword));
}

function hasDeescalationSignal(text = '') {
  const value = String(text || '').trim();
  if (!value) return false;
  return /(好转|缓解|减轻|不再|已经没有|没有了|否认|排除|没再出现|恢复正常|已经退烧|不疼了|不闷了|看错了|不是黑便|不是便血|不是呕血|普通深褐色)/.test(value);
}

function buildRoutingContextText(session = {}, latestText = '') {
  return [
    session.chiefComplaint || '',
    ...Object.values(session.answers || {}).map((item) => String(item || '')),
    ...(session.supplements || []).map((item) => String(item || '')),
    ...(session.supplementInsights || []).map((item) => String(item.summary || '')),
    ...(session.supplementFiles || []).flatMap((file) => [
      String(file?.summary?.title || ''),
      String((file?.summary?.highlights || []).join('；')),
      String((file?.summary?.keyMetrics || []).join('；')),
    ]),
    latestText || '',
  ]
    .join(' ')
    .trim();
}

async function rerouteSessionByContext(session = {}, latestText = '') {
  const routingText = buildRoutingContextText(session, latestText);
  if (!routingText) return session;
  const route = await buildScenarioRoute(routingText);
  if (!route?.scenario?.id) return session;
  return upsertSession(session.id, {
    scenario: route.scenario,
    triageResult: null,
    routeMeta: {
      ...(session.routeMeta || {}),
      mode: `reroute-${route.routeMeta?.mode || 'rule'}`,
      normalizedComplaint: route.routeMeta?.normalizedComplaint || routingText.slice(0, 160),
      reason: `${route.routeMeta?.reason || '按上下文动态重算分流'}（含补充信息）`,
    },
  });
}

function buildTopicChips(session, triageResult) {
  const core = triageResult?.layeredOutput?.core || {};
  const detail = triageResult?.layeredOutput?.detail || {};
  const needsInPerson = ['routine_clinic', 'specialist_clinic', 'hospital_priority_high'].includes(core.recommendationLevel);
  const chips = [];
  const requestedFocus =
    session?.currentFocus && !['summary', 'other', 'new_issue'].includes(session.currentFocus)
      ? { key: session.currentFocus, label: session.currentFocusLabel || session.currentFocus }
      : null;

  if ((detail.selfCareAdvice || []).length || (detail.visitAdvice || []).length) {
    chips.push({ key: 'care', label: '现在怎么办' });
  }
  if ((detail.medicationAdvice || []).length) {
    chips.push({ key: 'medication', label: '用药建议' });
  }
  if (needsInPerson) {
    chips.push({ key: 'booking', label: '推荐医院科室' });
  }
  if (needsInPerson && ((detail.examAdvice || []).length || (core.firstChecks || []).length)) {
    chips.push({ key: 'checks', label: '检查项目' });
  }
  if (core.needsCost || needsInPerson || (detail.medicationAdvice || []).length) {
    chips.push({ key: 'cost', label: '费用参考' });
  }
  if ((session?.supplementFiles || []).length) {
    chips.push({ key: 'report', label: '检查报告解读' });
  }
  if (requestedFocus) {
    chips.push(requestedFocus);
  }

  return chips.filter((chip, index, array) => array.findIndex((item) => item.key === chip.key) === index);
}

const SCENARIO_DRUG_CODES = {
  digestive: ['stomach'],
  respiratory: ['cold', 'cough', 'throat'],
  eye: ['eye'],
  dermatology: ['skin'],
  cardiac: ['hypertension'],
  male: ['pain'],
  general: ['pain'],
};

function formatDrugPriceRange(min, max) {
  const low = Number(min || 0);
  const high = Number(max || 0);
  if (low && high) return `${low}~${high}元`;
  if (low || high) return `${low || high}元`;
  return '价格待确认';
}

function buildLocalMedicationRefs(scenarioId = '') {
  const codes = SCENARIO_DRUG_CODES[String(scenarioId || '').trim()] || [];
  if (!codes.length) return [];
  return findDrugRefsByScenarios(codes, 4).map((item) => ({
    name: item.genericName,
    priceRange: formatDrugPriceRange(item.priceMin, item.priceMax),
    source: '本地参考',
    insuranceType: item.insuranceClass || '不确定',
    note: item.isCentralized ? '集采品种' : '',
  }));
}

function mergeMedicationRefs(primary = [], fallback = []) {
  const seen = new Set();
  const merged = [];
  for (const item of [...primary, ...fallback]) {
    const key = `${item.name || item.category || ''}|${item.priceRange || item.price || ''}`;
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.slice(0, 5);
}

async function resolveNextQuestion(session, options = {}) {
  const asked = getAskedQuestionIds(session);
  const slotCatalog = getScenarioSlotCatalog(session.scenario || {});
  const candidates = slotCatalog
    .map((slotItem) => {
      const question = (session.scenario?.questions || []).find((item) => item.id === slotItem.questionId);
      if (!question) return null;
      return {
        ...question,
        slot: slotItem.slot,
        slotLabel: slotItem.slotLabel,
      };
    })
    .filter(Boolean)
    .filter((question) => !asked.includes(question.id))
    .filter((question) => !isSlotFilled(session, question.slot))
    .filter((question) => !shouldSkipQuestionByContext(session, question));
  const config = getFollowUpConfig(session);
  const stepCount = Number(session.followUp?.stepCount || 0);

  if (!candidates.length) {
    return {
      nextQuestion: null,
      done: true,
      progress: { current: stepCount, total: stepCount || config.minSteps },
      followUpPatch: {
        ...session.followUp,
        completed: true,
      },
      followUpMeta: {
        mode: 'exhausted',
        reason: '候选问题已经问完',
      },
    };
  }

  if (stepCount >= config.maxSteps) {
    return {
      nextQuestion: null,
      done: true,
      progress: { current: stepCount, total: stepCount },
      followUpPatch: {
        ...session.followUp,
        completed: true,
      },
      followUpMeta: {
        mode: 'max-steps',
        reason: '已达到追问上限',
      },
    };
  }

  let picked = null;
  let followUpMeta = {
    mode: 'rule',
    reason: '按默认顺序继续追问',
  };

  try {
    const aiDecision = await chooseNextFollowUp(session, candidates, {
      stepCount,
      ...config,
      ...options,
    });
    if (aiDecision?.enoughInfo && stepCount >= config.minSteps) {
      return {
        nextQuestion: null,
        done: true,
        progress: { current: stepCount, total: stepCount },
        followUpPatch: {
          ...session.followUp,
          completed: true,
        },
        followUpMeta: {
          mode: 'ai-stop',
          reason: aiDecision.reason || '模型判断信息已足够生成初步建议',
        },
      };
    }

    if (aiDecision?.questionId) {
      picked = candidates.find((question) => question.id === aiDecision.questionId) || null;
      if (picked) {
        if (aiDecision.questionText && Array.isArray(aiDecision.options) && aiDecision.options.length >= 2) {
          picked = {
            ...picked,
            text: String(aiDecision.questionText).trim() || picked.text,
            options: aiDecision.options
              .map((item) => String(item || '').trim())
              .filter(Boolean)
              .slice(0, 5),
          };
          if (picked.options.length < 2) {
            picked.options = candidates.find((question) => question.id === picked.id)?.options || picked.options;
          }
        }
        followUpMeta = {
          mode: 'ai',
          reason: aiDecision.reason || '按模型动态选择下一问',
          targetSlot: picked.slot || picked.id,
          targetSlotLabel: picked.slotLabel || picked.slot || picked.id,
        };
      }
    }
  } catch (_error) {
    followUpMeta = {
      mode: 'rule-fallback',
      reason: '模型动态追问失败，已回退规则顺序',
    };
  }

  if (!picked) {
    picked = candidates[0] || getFallbackNextQuestion(session);
  }

  if (!followUpMeta.targetSlot && picked) {
    followUpMeta = {
      ...followUpMeta,
      targetSlot: picked.slot || picked.id,
      targetSlotLabel: picked.slotLabel || picked.slot || picked.id,
    };
  }

  const targetTotal = getStructuredProgressTotal(config, candidates.length, stepCount + 1);
  return {
    nextQuestion: picked,
    done: false,
    progress: {
      current: stepCount + 1,
      total: targetTotal,
    },
    followUpPatch: {
      ...session.followUp,
      currentQuestionId: picked?.id || '',
      completed: false,
    },
    followUpMeta,
  };
}

function buildArchiveContextText(record, session) {
  const parts = [];
  const firstChecks = (record.firstChecks || []).map((item) => item.name).filter(Boolean);
  const fileSummaries = (record.files || [])
    .map((file) => file.summary?.title || file.originalName)
    .filter(Boolean);

  if (record.summary) parts.push(`之前一次问诊分析：${record.summary}`);
  if (session?.chiefComplaint) parts.push(`当时主诉：${session.chiefComplaint}`);
  if (record.department) parts.push(`上次建议科室：${record.department}`);
  if (record.costRange) parts.push(`上次首轮费用：${record.costRange}`);
  if (firstChecks.length) parts.push(`上次建议先做的检查：${firstChecks.join('、')}`);
  if (session?.answers && Object.keys(session.answers).length) {
    const qaText = Object.entries(session.answers)
      .map(([questionId, answer]) => {
        const question = session.scenario?.questions?.find((item) => item.id === questionId);
        return question ? `${question.text}：${answer}` : '';
      })
      .filter(Boolean)
      .join('；');
    if (qaText) parts.push(`上次追问回答：${qaText}`);
  }
  if (Array.isArray(session?.supplements) && session.supplements.length) {
    parts.push(`上次补充信息：${session.supplements.join('；')}`);
  }
  if (Array.isArray(session?.supplementInsights) && session.supplementInsights.length) {
    const insightText = session.supplementInsights
      .map((item) => item.summary)
      .filter(Boolean)
      .join('；');
    if (insightText) {
      parts.push(`系统补充理解：${insightText}`);
    }
  }
  if (fileSummaries.length) parts.push(`上次还上传过这些材料：${fileSummaries.join('、')}`);

  return parts.join('\n');
}

function buildConversationSnapshot(session) {
  const items = [];
  if (!session) return items;
  if (session.chiefComplaint) {
    items.push({ role: 'user', kind: 'chiefComplaint', text: session.chiefComplaint });
  }
  const answers = session.answers || {};
  for (const [questionId, answer] of Object.entries(answers)) {
    const question = session.scenario?.questions?.find((item) => item.id === questionId);
    items.push({
      role: 'user',
      kind: 'answer',
      text: question ? `${question.text}：${answer}` : String(answer),
      questionId,
    });
  }
  for (const supplement of session.supplements || []) {
    if (!supplement) continue;
    items.push({ role: 'user', kind: 'supplement', text: supplement });
  }
  return items;
}

function buildSlotHintsFromSession(session) {
  return Object.values(session?.followUp?.slotState || {})
    .filter((item) => item?.slot && item?.answer)
    .map((item) => ({
      slot: item.slot,
      slotLabel: item.slotLabel || item.slot,
      answer: item.answer,
    }));
}

function mergeSlotHintsIntoState(existingState = {}, hints = [], sourcePrefix = 'derived') {
  const slotState = { ...existingState };

  for (const hint of hints) {
    if (!hint?.slot || !hint?.answer) continue;
    const current = slotState[hint.slot];
    const mergedAnswer = current?.answer
      ? [...new Set(`${current.answer}；${hint.answer}`.split(/[；;]/).map((item) => item.trim()).filter(Boolean))].join('；')
      : hint.answer;

    slotState[hint.slot] = {
      questionId: current?.questionId || `${sourcePrefix}:${hint.slot}`,
      slot: hint.slot,
      slotLabel: hint.slotLabel || current?.slotLabel || hint.slot,
      answer: mergedAnswer,
    };
  }

  return slotState;
}

function buildInsightSlotHints(insight = {}, sourceText = '') {
  if (!insight || !Array.isArray(insight.relevantSlots) || !insight.relevantSlots.length) {
    return [];
  }
  const answer = Array.isArray(insight.normalizedFacts) && insight.normalizedFacts.length
    ? insight.normalizedFacts.join('；')
    : (insight.summary || sourceText || '').trim();

  return insight.relevantSlots
    .filter(Boolean)
    .map((slot) => ({
      slot,
      slotLabel: slot,
      answer,
    }));
}

async function buildScenarioRoute(chiefComplaint = '') {
  const ruleRoute = detectScenarioDetailed(chiefComplaint);
  let scenario = ruleRoute.scenario || SCENARIOS.general;
  let routeMeta = {
    mode: 'rule',
    normalizedComplaint: ruleRoute.normalizedText || chiefComplaint,
    reason: ruleRoute.ambiguous
      ? `规则命中不集中，先走通用分流（命中分数：${ruleRoute.score}）`
      : `按规则关键词匹配路由（命中分数：${ruleRoute.score}）`,
  };

  try {
    const aiRoute = await classifyComplaint(chiefComplaint, Object.values(SCENARIOS));
    if (aiRoute?.scenarioId && SCENARIOS[aiRoute.scenarioId]) {
      scenario = SCENARIOS[aiRoute.scenarioId];
      routeMeta = {
        mode: 'ai',
        normalizedComplaint: aiRoute.normalizedComplaint || chiefComplaint,
        reason: aiRoute.reason || '按模型理解路由',
      };
      return { scenario, routeMeta };
    }
  } catch (_error) {
  }

  if (ruleRoute.score <= 0 || ruleRoute.ambiguous) {
    routeMeta = {
      mode: 'rule-fallback',
      normalizedComplaint: chiefComplaint,
      reason: '模型路由没有返回稳定结果，已回退通用分流路由',
    };
    scenario = SCENARIOS.general;
  }

  return { scenario, routeMeta };
}

function shouldPreferOpenIntake(chiefComplaint = '', initialAnalysis = null) {
  const text = String(chiefComplaint || '').trim();
  if (!text) return false;
  if (initialAnalysis?.taskType !== 'symptom_consult') return false;
  if (initialAnalysis?.collectMode === 'open') return true;

  const duration = /(天|周|个月|半年|一年|最近|一直|反复|持续)/.test(text);
  const frequency = /(每次|偶尔|经常|总是|老是|有时候|多数时候)/.test(text);
  const location = /(左|右|上腹|下腹|胸口|腰|胃|肚子|喉咙|尿|头)/.test(text);
  const extraSymptom = /(发热|呕吐|腹泻|胸痛|咳嗽|头晕|尿痛|勃起|失眠|焦虑)/.test(text);
  const detailCount = [duration, frequency, location, extraSymptom].filter(Boolean).length;
  return detailCount < 2;
}

async function createTriageSession(payload = {}) {
  const {
    age,
    gender,
    province,
    city,
    district,
    insuranceType,
    chiefComplaint,
    supplements = [],
    supplementInsights = [],
    supplementFiles = [],
    slotHints = [],
  } = payload;

  const sessionId = uuidv4();
  const initialAnalysis = await analyzeInitialTurn(chiefComplaint, Object.values(SCENARIOS)).catch(() => null);
  const analysisScenario = initialAnalysis?.scenarioId && SCENARIOS[initialAnalysis.scenarioId]
    ? SCENARIOS[initialAnalysis.scenarioId]
    : null;
  const baseRoute = await buildScenarioRoute(chiefComplaint);
  const scenario = analysisScenario || baseRoute.scenario;
  const routeMeta = initialAnalysis
    ? {
        mode: 'ai',
        normalizedComplaint: chiefComplaint,
        reason: initialAnalysis.reason || baseRoute.routeMeta.reason,
      }
    : baseRoute.routeMeta;
  const slotState = mergeSlotHintsIntoState({}, slotHints, 'init');
  const taskType = initialAnalysis?.taskType || 'symptom_consult';
  const conversationStage = shouldPreferOpenIntake(chiefComplaint, initialAnalysis) ? 'open' : 'structured';
  const initialFocus = mapIntentToFocus('medical_followup', 'symptom', '症状判断');

  const session = upsertSession(sessionId, {
    id: sessionId,
    age,
    gender,
    province,
    city,
    district,
    insuranceType,
    chiefComplaint,
    supplements,
    supplementInsights,
    supplementFiles,
    scenario,
    routeMeta,
    taskType,
    conversationStage,
    currentFocus: initialFocus.key,
    currentFocusLabel: initialFocus.label,
    openTurns: 0,
    openPromptText: initialAnalysis?.nextPromptText || '',
    stepIndex: 0,
    followUp: {
      stepCount: 0,
      askedQuestionIds: [],
      currentQuestionId: '',
      slotState,
      completed: false,
    },
    answers: {},
    createdAt: new Date().toISOString(),
  });
  incrementConsultationCount();

  if (shouldImmediateUrgent(session, chiefComplaint)) {
    const triageResult = buildUrgentShortcutResult(session);
    upsertSession(sessionId, {
      triageResult,
      conversationStage: 'structured',
      followUp: {
        ...(session.followUp || {}),
        completed: true,
        currentQuestionId: '',
      },
    });
    return {
      sessionId,
      taskType,
      conversationStage: 'structured',
      immediateResult: true,
      assistantReply: '你这次描述里有高风险信号，我先直接给你分析结果，优先判断是否需要尽快线下就医。',
      progress: null,
      scenario: scenario.label,
      routeMeta,
      followUpMeta: {
        mode: 'urgent-shortcut',
        reason: '检测到高风险信号，跳过后续追问直接出分析',
      },
      currentFocus: initialFocus,
    };
  }

  if (taskType === 'out_of_scope') {
    return {
      sessionId,
      taskType,
      conversationStage: 'closed',
      assistantReply: initialAnalysis?.assistantReply || '这个问题不属于医疗咨询范围，我这边先不乱给建议。',
      progress: null,
      scenario: scenario.label,
      routeMeta,
      followUpMeta: null,
      currentFocus: initialFocus,
    };
  }

  if (conversationStage === 'open') {
    return {
      sessionId,
      taskType,
      conversationStage: 'open',
      assistantReply: initialAnalysis?.assistantReply || '我先了解一下情况。',
      nextPrompt: {
        type: 'text',
        text: initialAnalysis?.nextPromptText || '你先把最困扰你的情况多说一点。',
      },
      progress: null,
      stopRule: '先开放式聊几轮，方向清楚后再进入精准提问',
      scenario: scenario.label,
      routeMeta,
      followUpMeta: {
        mode: 'open',
        reason: initialAnalysis?.reason || '先开放式收集信息',
      },
      currentFocus: initialFocus,
    };
  }

  const nextQuestionState = await resolveNextQuestion(session);
  upsertSession(sessionId, {
    followUp: nextQuestionState.followUpPatch,
    followUpMeta: nextQuestionState.followUpMeta,
  });

  return {
    sessionId,
    taskType,
    conversationStage: 'structured',
    nextQuestion: nextQuestionState.nextQuestion,
    progress: nextQuestionState.progress,
    stopRule: '达到最小必要信息或追问上限后进入确认和补充阶段',
    scenario: scenario.label,
    routeMeta,
    followUpMeta: nextQuestionState.followUpMeta,
    currentFocus: initialFocus,
  };
}

app.post('/analytics/symptom-click', (req, res) => {
  const symptom = String(req.body?.symptom || '').trim();
  if (!symptom) {
    return res.status(400).json({ error: 'symptom is required' });
  }
  const analytics = trackSymptomClick(symptom);
  return res.json({
    ok: true,
    analytics,
  });
});

app.get('/api/quick-symptom-stats', (_req, res) => {
  const analytics = getQuickSymptomAnalytics();
  return res.json({
    ok: true,
    threshold: 200,
    ...analytics,
  });
});

app.get('/api/health', (_req, res) => {
  const aiStatus = getAiStatus();
  res.json({
    ok: true,
    name: '挂啥科 MVP',
    updatedAt: '2026-03-29',
    coverageTier: '全国可访问，重点省份高覆盖（演示数据）',
    ocrMode: aiStatus.enabled ? 'dashscope' : process.env.OCR_WEBHOOK_URL ? 'webhook' : 'fallback',
    ai: aiStatus,
  });
});

app.post('/auth/password/login', (req, res) => {
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');
  if (!/^1\d{10}$/.test(phone)) {
    return res.status(400).json({ error: '请输入正确的手机号' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: '密码至少 4 位' });
  }

  const existing = getUserByPhone(phone);
  if (!existing) {
    const userId = `phone_${phone}`;
    const user = upsertUser(userId, {
      provider: 'password',
      phone,
      nickname: `用户${phone.slice(-4)}`,
      passwordDigest: hashPassword(password),
    });
    return res.json({ ok: true, mode: 'registered', auth: buildPasswordAuthPayload(user) });
  }

  if (!verifyPassword(password, existing.passwordDigest)) {
    return res.status(401).json({ error: '手机号或密码不正确' });
  }

  const user = upsertUser(existing.userId, { lastLoginAt: new Date().toISOString() });
  return res.json({ ok: true, mode: 'login', auth: buildPasswordAuthPayload(user) });
});

app.get('/account/summary', (req, res) => {
  const userId = String(req.query.userId || '').trim();
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  const summary = buildAccountSummary(userId);
  if (!summary) {
    return res.status(404).json({ error: 'user not found' });
  }
  return res.json({ ok: true, summary });
});

app.get('/auth/wechat/status', (req, res) => {
  const config = getWechatOauthConfig(req);
  return res.json({
    configured: config.configured,
    appId: config.appId ? `${config.appId.slice(0, 4)}***` : '',
    callbackUrl: config.callbackUrl,
    scope: config.scope,
    message: config.configured ? '已配置公众号网页授权' : '未配置公众号网页授权参数',
  });
});

app.get('/auth/wechat/start', (req, res) => {
  const config = getWechatOauthConfig(req);
  const returnTo = sanitizeReturnTo(req.query.returnTo, req);
  if (!config.configured) {
    return res.redirect(appendQuery(returnTo, 'wx_auth_error', 'not_configured'));
  }

  const stateId = crypto.randomUUID();
  createAuthRequest(stateId, { returnTo });
  const authorizeUrl = new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
  authorizeUrl.searchParams.set('appid', config.appId);
  authorizeUrl.searchParams.set('redirect_uri', config.callbackUrl);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', config.scope);
  authorizeUrl.searchParams.set('state', stateId);
  return res.redirect(`${authorizeUrl.toString()}#wechat_redirect`);
});

app.get('/auth/wechat/callback', async (req, res) => {
  const config = getWechatOauthConfig(req);
  const code = req.query.code || '';
  const stateId = req.query.state || '';
  const authRequest = consumeAuthRequest(stateId);
  const returnTo = sanitizeReturnTo(authRequest?.returnTo, req);

  if (!config.configured) {
    return res.redirect(appendQuery(returnTo, 'wx_auth_error', 'not_configured'));
  }
  if (!code || !authRequest) {
    return res.redirect(appendQuery(returnTo, 'wx_auth_error', 'invalid_callback'));
  }

  try {
    const tokenPayload = await requestWechatToken(code, config);
    const userInfo = await requestWechatUserInfo(tokenPayload);
    const userId = `wx_${tokenPayload.openid}`;
    const user = upsertUser(userId, {
      provider: 'wechat_oauth',
      openId: tokenPayload.openid,
      unionId: tokenPayload.unionid || userInfo.unionid || '',
      nickname: userInfo.nickname || '微信用户',
      avatarUrl: userInfo.headimgurl || '',
      province: userInfo.province || '',
      city: userInfo.city || '',
      country: userInfo.country || '',
    });
    const ticket = crypto.randomUUID();
    createAuthTicket(ticket, {
      userId,
      nickname: user.nickname || '微信用户',
      avatarUrl: user.avatarUrl || '',
      openId: user.openId || '',
      provider: 'wechat_oauth',
    });
    return res.redirect(appendQuery(returnTo, 'wx_auth_ticket', ticket));
  } catch (error) {
    return res.redirect(appendQuery(returnTo, 'wx_auth_error', error.message || 'oauth_failed'));
  }
});

app.get('/auth/wechat/consume', (req, res) => {
  const ticket = String(req.query.ticket || '');
  if (!ticket) {
    return res.status(400).json({ error: 'ticket required' });
  }
  const payload = consumeAuthTicket(ticket);
  if (!payload) {
    return res.status(404).json({ error: 'ticket expired' });
  }
  return res.json({
    ok: true,
    auth: {
      loggedIn: true,
      provider: payload.provider || 'wechat_oauth',
      userId: payload.userId,
      nickname: payload.nickname || '微信用户',
      avatarUrl: payload.avatarUrl || '',
      openId: payload.openId || '',
    },
  });
});

app.get('/api/hospitals/hubei', (req, res) => {
  const city = String(req.query.city || '');
  const district = String(req.query.district || '');
  const rows = hubeiHospitalDirectory.filter((item) => {
    if (district) return item.district === district;
    if (city) return item.city === city;
    return true;
  });
  return res.json({ total: rows.length, rows });
});

app.get('/api/region/search', (req, res) => {
  const q = req.query.q || '';
  const regions = searchRegions(q, 8);
  res.json({ q, regions });
});

app.get('/api/region/reverse', async (req, res) => {
  const { lat, lon } = req.query;
  const latitude = Number(lat);
  const longitude = Number(lon);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=zh-CN&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`,
      {
        headers: {
          'User-Agent': 'guashake-mvp/1.0 (reverse geocode)',
        },
      }
    );

    if (!response.ok) {
      return res.status(502).json({ error: 'reverse geocode failed' });
    }

    const payload = await response.json();
    const address = payload.address || {};
    const candidates = [
      address.county,
      address.city_district,
      address.district,
      address.suburb,
      address.town,
      address.city,
      address.state,
    ].filter(Boolean);

    let region = null;
    for (const candidate of candidates) {
      const match = searchRegions(candidate, 1)[0];
      if (match) {
        region = match;
        break;
      }
    }

    return res.json({
      ok: true,
      displayName: payload.display_name || '',
      region,
    });
  } catch (error) {
    return res.status(502).json({ error: 'reverse geocode failed', detail: error.message });
  }
});

function isPublicIp(ip = '') {
  if (!ip) return false;
  const normalized = ip.replace('::ffff:', '').trim();
  if (!normalized) return false;
  if (normalized === '::1' || normalized === '127.0.0.1') return false;
  if (
    normalized.startsWith('10.') ||
    normalized.startsWith('192.168.') ||
    normalized.startsWith('172.16.') ||
    normalized.startsWith('172.17.') ||
    normalized.startsWith('172.18.') ||
    normalized.startsWith('172.19.') ||
    normalized.startsWith('172.2') ||
    normalized.startsWith('169.254.')
  ) {
    return false;
  }
  return true;
}

function mapIpPayloadToRegion(payload = {}) {
  const candidates = [payload.district, payload.city, payload.region, payload.regionName, payload.province, payload.country].filter(Boolean);
  for (const candidate of candidates) {
    const match = searchRegions(candidate, 1)[0];
    if (match) {
      return match;
    }
  }
  return null;
}

async function locateByIp(clientIp) {
  const providers = [
    {
      name: 'ipwhois',
      url: `https://ipwho.is/${encodeURIComponent(clientIp)}?lang=zh`,
      map: (payload) => ({
        displayName: [payload.country, payload.region, payload.city].filter(Boolean).join(' '),
        region: mapIpPayloadToRegion(payload),
      }),
    },
    {
      name: 'ipapi',
      url: `https://ipapi.co/${encodeURIComponent(clientIp)}/json/`,
      map: (payload) => ({
        displayName: [payload.country_name, payload.region, payload.city].filter(Boolean).join(' '),
        region: mapIpPayloadToRegion({ country: payload.country_name, region: payload.region, city: payload.city }),
      }),
    },
    {
      name: 'ipinfo',
      url: `https://ipinfo.io/${encodeURIComponent(clientIp)}/json`,
      map: (payload) => ({
        displayName: [payload.country, payload.region, payload.city].filter(Boolean).join(' '),
        region: mapIpPayloadToRegion(payload),
      }),
    },
  ];

  for (const provider of providers) {
    try {
      const response = await fetch(provider.url, {
        headers: { 'User-Agent': 'guashake-mvp/1.0 (ip locate)' },
      });
      if (!response.ok) continue;
      const payload = await response.json();
      const mapped = provider.map(payload);
      if (mapped.region) {
        return { provider: provider.name, displayName: mapped.displayName, region: mapped.region };
      }
    } catch (_error) {
    }
  }

  return null;
}

app.get('/api/region/ip-locate', async (req, res) => {
  const forwarded = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || '')
    .split(',')[0]
    .trim();
  const clientIp = forwarded.replace('::ffff:', '');

  if (!isPublicIp(clientIp)) {
    return res.status(400).json({ error: 'client ip not usable', ip: clientIp || '' });
  }

  try {
    const located = await locateByIp(clientIp);
    if (!located) {
      return res.status(502).json({ error: 'ip locate failed', ip: clientIp });
    }

    return res.json({
      ok: true,
      ip: clientIp,
      provider: located.provider,
      displayName: located.displayName || '',
      region: located.region,
    });
  } catch (error) {
    return res.status(502).json({ error: 'ip locate failed', detail: error.message });
  }
});

app.post('/triage/session', async (req, res) => {
  const {
    age,
    gender,
    province,
    city,
    district,
    insuranceType,
    chiefComplaint,
  } = req.body;

  if (!chiefComplaint) {
    return res.status(400).json({ error: 'chiefComplaint is required' });
  }
  const result = await createTriageSession({
    age,
    gender,
    province,
    city,
    district,
    insuranceType,
    chiefComplaint,
  });
  return res.json(result);
});

app.post('/triage/answer', async (req, res) => {
  const { sessionId, questionId, answer } = req.body;
  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }
  if (!questionId || !answer) {
    return res.status(400).json({ error: 'questionId and answer are required' });
  }
  if (session.followUp?.currentQuestionId && session.followUp.currentQuestionId !== questionId) {
    return res.status(409).json({ error: 'question is out of date, please answer the latest question' });
  }

  const answers = { ...(session.answers || {}) };
  answers[questionId] = answer;
  const slotCatalog = getScenarioSlotCatalog(session.scenario || {});
  const slotMeta = slotCatalog.find((item) => item.questionId === questionId);
  const slotState = {
    ...(session.followUp?.slotState || {}),
  };
  if (slotMeta) {
    slotState[slotMeta.slot] = {
      questionId,
      slot: slotMeta.slot,
      slotLabel: slotMeta.slotLabel,
      answer,
    };
  }

  const askedQuestionIds = Array.from(new Set([...(session.followUp?.askedQuestionIds || []), questionId].filter(Boolean)));
  const stepCount = Number(session.followUp?.stepCount || 0) + 1;
  const updatedSession = upsertSession(sessionId, {
    answers,
    stepIndex: stepCount,
    triageResult: null,
    followUp: {
      ...(session.followUp || {}),
      stepCount,
      askedQuestionIds,
      currentQuestionId: '',
      slotState,
    },
  });

  if (shouldImmediateUrgent(updatedSession, String(answer || ''))) {
    const triageResult = buildUrgentShortcutResult(updatedSession);
    upsertSession(sessionId, {
      triageResult,
      conversationStage: 'structured',
      followUp: {
        ...(updatedSession.followUp || {}),
        completed: true,
        currentQuestionId: '',
      },
    });
    return res.json({
      done: true,
      triageResult,
      urgentShortcut: true,
    });
  }

  const nextQuestionState = await resolveNextQuestion(updatedSession);
  upsertSession(sessionId, {
    followUp: nextQuestionState.followUpPatch,
    followUpMeta: nextQuestionState.followUpMeta,
  });

  if (nextQuestionState.done) {
    if (shouldDelayResultConfirmation(updatedSession, stepCount)) {
      return res.json({
        done: false,
        needsSupplement: true,
        assistantReply: '现在还不急着给分析，我还想再确认一点关键信息。',
        nextPrompt: {
          type: 'text',
          text: '你继续补充一下：大概持续多久了？最近是在加重、减轻，还是差不多？',
        },
        progress: nextQuestionState.progress,
        followUpMeta: {
          ...nextQuestionState.followUpMeta,
          mode: 'delay-confirmation',
          reason: '结构化信息仍偏少，继续补充后再生成分析',
        },
      });
    }
    return res.json({
      done: false,
      needsConfirmation: true,
      progress: nextQuestionState.progress,
      followUpMeta: nextQuestionState.followUpMeta,
    });
  }

  return res.json({
    done: false,
    nextQuestion: nextQuestionState.nextQuestion,
    progress: nextQuestionState.progress,
    followUpMeta: nextQuestionState.followUpMeta,
  });
});

app.post('/triage/message', async (req, res) => {
  const { sessionId, message } = req.body;
  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }

  const text = String(message || '').trim();
  if (!text) {
    return res.status(400).json({ error: 'message is required' });
  }

  let turnIntent = null;
  try {
    turnIntent = await classifyConversationTurn(session, text);
  } catch (_error) {
    turnIntent = null;
  }
  const intentType = turnIntent?.intentType || 'medical_followup';
  const currentFocus = mapIntentToFocus(intentType, turnIntent?.topicKey, turnIntent?.focusLabel);
  if (intentType === 'off_topic') {
    return res.json({
      ok: true,
      intentType,
      mode: 'text',
      assistantReply: turnIntent?.reply || '这条和当前咨询关系不大，我们先回到你这次不舒服本身。',
      nextPrompt: {
        type: 'text',
        text: session.openPromptText || '你继续说说这次最困扰你的不舒服是怎么表现的。',
      },
      currentFocus,
    });
  }
  if (intentType === 'report_notice') {
    upsertSession(sessionId, {
      currentFocus: currentFocus.key,
      currentFocusLabel: currentFocus.label,
    });
    return res.json({
      ok: true,
      intentType,
      mode: 'text',
      assistantReply: turnIntent?.reply || '可以，直接点左下角加号，把检查报告、相册图片或者拍照发给我就行。',
      nextPrompt: {
        type: 'text',
        text: session.openPromptText || '如果你还想先说症状，也可以继续补充。',
      },
      currentFocus,
    });
  }
  if (intentType === 'new_issue') {
    upsertSession(sessionId, {
      currentFocus: currentFocus.key,
      currentFocusLabel: currentFocus.label,
    });
    return res.json({
      ok: true,
      intentType,
      mode: 'text',
      assistantReply: turnIntent?.reply || '这更像另一个新问题。如果你想换问题，点“新的咨询”会更清楚。',
      nextPrompt: {
        type: 'text',
        text: session.openPromptText || '如果还是继续这次问题，就再说说现在最困扰你的症状。',
      },
      currentFocus,
    });
  }

  const supplements = [...(session.supplements || []), text];
  let insight = null;
  const supplementInsights = [...(session.supplementInsights || [])];
  try {
    insight = await interpretSupplement(session, text, getScenarioSlotCatalog(session.scenario || {}));
    if (insight?.summary) {
      supplementInsights.push({
        ...insight,
        sourceText: text,
        createdAt: new Date().toISOString(),
      });
    }
  } catch (_error) {
    insight = null;
  }

  const openTurns = Number(session.openTurns || 0) + 1;
  const updatedSession = upsertSession(sessionId, {
    supplements,
    supplementInsights,
    currentFocus: currentFocus.key,
    currentFocusLabel: currentFocus.label,
    followUp: {
      ...(session.followUp || {}),
      slotState: mergeSlotHintsIntoState(
        session.followUp?.slotState || {},
        buildInsightSlotHints(insight, text),
        'open'
      ),
    },
    openTurns,
    triageResult: null,
  });

  if (shouldImmediateUrgent(updatedSession, text)) {
    const triageResult = buildUrgentShortcutResult(updatedSession);
    upsertSession(sessionId, {
      triageResult,
      conversationStage: 'structured',
      followUp: {
        ...(updatedSession.followUp || {}),
        completed: true,
        currentQuestionId: '',
      },
      followUpMeta: {
        mode: 'urgent-shortcut',
        reason: '检测到高风险信号，跳过后续追问直接出分析',
      },
    });
    return res.json({
      ok: true,
      intentType,
      mode: 'immediate_result',
      assistantReply: '你这条补充提示风险偏高，我先直接给你更新分析结果。',
      insight,
      currentFocus,
    });
  }

  if (updatedSession.conversationStage !== 'open') {
    return res.json({
      ok: true,
      mode: 'context',
      insight,
    });
  }

  const asked = getAskedQuestionIds(updatedSession);
  const candidates = getScenarioSlotCatalog(updatedSession.scenario || {})
    .map((slotItem) => {
      const question = (updatedSession.scenario?.questions || []).find((item) => item.id === slotItem.questionId);
      if (!question) return null;
      return {
        ...question,
        slot: slotItem.slot,
        slotLabel: slotItem.slotLabel,
      };
    })
    .filter(Boolean)
    .filter((item) => !asked.includes(item.id))
    .filter((item) => !isSlotFilled(updatedSession, item.slot))
    .filter((item) => !shouldSkipQuestionByContext(updatedSession, item));

  const followUpConfig = getFollowUpConfig(updatedSession);
  // 第二轮开放式追问后，仍停留在 open 阶段时优先切到结构化确认。
  // 不再把“是否切换”完全交给模型，避免开放式问题拖得过长。
  if (openTurns >= 2 && candidates.length >= 1) {
    const picked = candidates[0];
    const nextQuestion = {
      ...picked,
      text: picked.text,
      options: picked.options,
    };
    upsertSession(sessionId, {
      conversationStage: 'structured',
      followUp: {
        ...(updatedSession.followUp || {}),
        currentQuestionId: nextQuestion.id,
        completed: false,
      },
      followUpMeta: {
        mode: 'forced-open-to-structured',
        reason: '开放式信息已积累两轮，切换到选择题确认关键点',
        targetSlot: nextQuestion.slot || nextQuestion.id,
        targetSlotLabel: nextQuestion.slotLabel || nextQuestion.slot || nextQuestion.id,
      },
    });
    return res.json({
      ok: true,
      intentType,
      mode: 'question',
      assistantReply: '我已经先听明白大概情况了，接下来用几个选择题把关键点问清楚。',
      nextQuestion,
      progress: {
        current: 1,
        total: getStructuredProgressTotal(followUpConfig, candidates.length, 1),
      },
      followUpMeta: {
        mode: 'forced-open-to-structured',
        reason: '开放式信息已积累两轮，切换到选择题确认关键点',
      },
      insight,
      currentFocus,
    });
  }

  const openPlan = await planOpenInterviewTurn(updatedSession, text, candidates, {
    openTurns,
  }).catch(() => null);

  if (!openPlan) {
    return res.json({
      ok: true,
      intentType,
      mode: 'text',
      assistantReply: '我在重试分析中。你先补充“持续多久、是否加重、有没有发热/疼痛位置变化”这些信息，我会继续分析。',
      nextPrompt: {
        type: 'text',
        text: '先告诉我：持续多久了？最近是在变重还是变轻？',
      },
      currentFocus,
    });
  }

  if (openPlan.collectMode === 'summary') {
    if (candidates.length && openTurns < 3) {
      const picked = candidates[0];
      const nextQuestion = {
        ...picked,
        text: picked.text,
        options: picked.options,
      };
      upsertSession(sessionId, {
        conversationStage: 'structured',
        followUp: {
          ...(updatedSession.followUp || {}),
          currentQuestionId: nextQuestion.id,
          completed: false,
        },
        followUpMeta: {
          mode: 'guarded-open-to-structured',
          reason: '开放式信息尚不足，先补充关键选择题',
          targetSlot: nextQuestion.slot || nextQuestion.id,
          targetSlotLabel: nextQuestion.slotLabel || nextQuestion.slot || nextQuestion.id,
        },
      });
      return res.json({
        ok: true,
        intentType,
        mode: 'question',
        assistantReply: openPlan.assistantReply || '我现在还不想太早下结论，再确认几个关键点。',
        nextQuestion,
        progress: {
          current: 1,
          total: getStructuredProgressTotal(followUpConfig, candidates.length, 1),
        },
        followUpMeta: {
          mode: 'guarded-open-to-structured',
          reason: '开放式信息尚不足，先补充关键选择题',
        },
        insight,
        currentFocus,
      });
    }

    if (!candidates.length && openTurns < 3) {
      upsertSession(sessionId, {
        conversationStage: 'open',
        openPromptText: '我还想再确认一下：大概持续多久了？最近是在加重、减轻，还是差不多？',
      });
      return res.json({
        ok: true,
        intentType,
        mode: 'text',
        assistantReply: openPlan.assistantReply || '现在信息还不够，我先不急着给结果。',
        nextPrompt: {
          type: 'text',
          text: '我还想再确认一下：大概持续多久了？最近是在加重、减轻，还是差不多？',
        },
        insight,
        currentFocus,
      });
    }

    upsertSession(sessionId, {
      conversationStage: 'structured',
      followUp: {
        ...(updatedSession.followUp || {}),
        completed: true,
        currentQuestionId: '',
      },
    });
    return res.json({
      ok: true,
      intentType,
      mode: 'confirmation',
      assistantReply: openPlan.assistantReply || '我这边先整理一下，现在可以给你初步分析了。',
      insight,
      needsConfirmation: true,
      currentFocus,
    });
  }

  if (openPlan.collectMode === 'structured') {
    const picked = candidates.find((item) => item.id === openPlan.questionId) || candidates[0] || null;
    if (!picked) {
      return res.json({
        ok: true,
        intentType,
        mode: 'confirmation',
        assistantReply: '我这边先整理一下，现在可以给你初步分析了。',
        insight,
        needsConfirmation: true,
        currentFocus,
      });
    }
    const nextQuestion = {
      ...picked,
      text: String(openPlan.questionText || picked.text).trim() || picked.text,
      options: Array.isArray(openPlan.options) && openPlan.options.length >= 2
        ? openPlan.options.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5)
        : picked.options,
    };
    upsertSession(sessionId, {
      conversationStage: 'structured',
      followUp: {
        ...(updatedSession.followUp || {}),
        currentQuestionId: nextQuestion.id,
        completed: false,
      },
      followUpMeta: {
        mode: 'ai-open-to-structured',
        reason: openPlan.reason || '开放式信息已足够，开始进入精准提问',
        targetSlot: nextQuestion.slot || nextQuestion.id,
        targetSlotLabel: nextQuestion.slotLabel || nextQuestion.slot || nextQuestion.id,
      },
    });
    return res.json({
      ok: true,
      intentType,
      mode: 'question',
      assistantReply: openPlan.assistantReply || '我大概有方向了，再确认一个关键点。',
      nextQuestion,
      progress: {
        current: 1,
        total: getStructuredProgressTotal(followUpConfig, candidates.length, 1),
      },
      followUpMeta: {
        mode: 'ai-open-to-structured',
        reason: openPlan.reason || '开放式信息已足够，开始进入精准提问',
      },
      insight,
      currentFocus,
    });
  }

  upsertSession(sessionId, {
    conversationStage: 'open',
    openPromptText: openPlan.nextPromptText || '',
  });
  return res.json({
    ok: true,
    intentType,
    mode: 'text',
    assistantReply: openPlan.assistantReply || '我继续了解一下。',
    nextPrompt: {
      type: 'text',
      text: openPlan.nextPromptText || '你再多说一点最近的变化。',
    },
    insight,
    currentFocus,
  });
});

app.post('/triage/supplement', async (req, res) => {
  const { sessionId, supplement } = req.body;
  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }

  const text = String(supplement || '').trim();
  let turnIntent = null;
  try {
    turnIntent = await classifyConversationTurn(session, text);
  } catch (_error) {
    turnIntent = null;
  }

  let intentType = turnIntent?.intentType || 'medical_followup';
  if (intentType === 'off_topic' && looksMedicalFollowup(text)) {
    intentType = 'medical_followup';
  }
  const currentFocus = mapIntentToFocus(intentType, turnIntent?.topicKey, turnIntent?.focusLabel);
  if (intentType === 'off_topic') {
    upsertSession(sessionId, {
      currentFocus: currentFocus.key,
      currentFocusLabel: currentFocus.label,
    });
    return res.json({
      ok: true,
      intentType,
      currentFocus,
      reply: turnIntent?.reply || '这条和当前咨询关系不大。你可以继续补充症状、病史、报告，或者重新开始一个新问题。',
      insight: null,
      refreshSummary: false,
      supplements: session.supplements || [],
    });
  }

  if (intentType === 'report_notice') {
    upsertSession(sessionId, {
      currentFocus: currentFocus.key,
      currentFocusLabel: currentFocus.label,
    });
    return res.json({
      ok: true,
      intentType,
      currentFocus,
      reply: turnIntent?.reply || '可以，直接点左下角加号，把检查报告、相册图片或者拍照发给我就行。',
      insight: null,
      refreshSummary: false,
      supplements: session.supplements || [],
    });
  }
  if (intentType === 'new_issue') {
    upsertSession(sessionId, {
      currentFocus: currentFocus.key,
      currentFocusLabel: currentFocus.label,
    });
    return res.json({
      ok: true,
      intentType,
      currentFocus,
      reply: turnIntent?.reply || '这更像另一个新问题。你可以点“新的咨询”，或者继续追问当前这次问题。',
      insight: null,
      refreshSummary: false,
      supplements: session.supplements || [],
    });
  }

  const supplements = [...(session.supplements || [])];
  if (text && shouldPersistAsSupplement(intentType)) {
    supplements.push(text);
  }

  let insight = null;
  const supplementInsights = [...(session.supplementInsights || [])];
  if (text && intentType === 'medical_followup') {
    try {
      insight = await interpretSupplement(session, text, getScenarioSlotCatalog(session.scenario || {}));
      if (insight?.summary) {
        supplementInsights.push({
          ...insight,
          sourceText: text,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (_error) {
      insight = null;
    }
  }

  const updated = upsertSession(sessionId, {
    supplements,
    supplementInsights,
    currentFocus: currentFocus.key,
    currentFocusLabel: currentFocus.label,
    followUp: {
      ...(session.followUp || {}),
      slotState: mergeSlotHintsIntoState(
        session.followUp?.slotState || {},
        buildInsightSlotHints(insight, text),
        'supplement'
      ),
    },
    triageResult: null,
  });

  if (shouldImmediateUrgent(updated, text)) {
    const triageResult = buildUrgentShortcutResult(updated);
    upsertSession(sessionId, {
      triageResult,
      conversationStage: 'structured',
      followUp: {
        ...(updated.followUp || {}),
        completed: true,
        currentQuestionId: '',
      },
      followUpMeta: {
        mode: 'urgent-shortcut',
        reason: '检测到高风险信号，跳过后续追问直接出分析',
      },
    });
    return res.json({
      ok: true,
      intentType,
      currentFocus,
      supplements: updated.supplements || [],
      insight,
      reply: '你这条补充提示风险偏高，我先直接更新分析结果。',
      affectsSummary: true,
      impactLevel: 'major',
      refreshSummary: true,
      forceImmediateResult: true,
    });
  }
  let followUpAnswer = null;
  const canRefreshSummary =
    Boolean(session.triageResult) &&
    ['medical_followup', 'medication_question', 'booking_question', 'cost_question'].includes(intentType);
  if (session.triageResult && ['medical_followup', 'medication_question', 'booking_question', 'cost_question'].includes(intentType)) {
    try {
      followUpAnswer = await answerFollowUpTurn(updated, text, intentType);
    } catch (_error) {
      followUpAnswer = null;
    }
  }
  return res.json({
    ok: true,
    intentType,
    currentFocus,
    supplements: updated.supplements || [],
    insight,
    reply: followUpAnswer?.answer || turnIntent?.reply || '',
    canRefreshSummary,
    affectsSummary: Boolean(followUpAnswer?.affectsSummary) || hasEscalationSignal(text) || hasDeescalationSignal(text),
    impactLevel: hasEscalationSignal(text)
      ? 'major'
      : (hasDeescalationSignal(text) ? 'minor' : (followUpAnswer?.impactLevel || 'none')),
    refreshSummary:
      Boolean(session.triageResult) &&
      ['medical_followup', 'medication_question', 'booking_question', 'cost_question'].includes(intentType) &&
      ((Boolean(followUpAnswer?.affectsSummary) && (followUpAnswer?.shouldRefreshSummary !== false))
        || hasEscalationSignal(text)
        || hasDeescalationSignal(text)),
  });
});

app.post('/triage/profile', (req, res) => {
  const { sessionId, province, city, district, insuranceType } = req.body;
  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }

  const patch = {};
  if (typeof province === 'string') patch.province = province;
  if (typeof city === 'string') patch.city = city;
  if (typeof district === 'string') patch.district = district;
  if (typeof insuranceType === 'string') patch.insuranceType = insuranceType;

  const updated = upsertSession(sessionId, patch);
  return res.json({
    ok: true,
    profile: {
      province: updated.province || '',
      city: updated.city || '',
      district: updated.district || '',
      insuranceType: updated.insuranceType || '',
    },
  });
});

app.post('/triage/supplement-file', upload.single('file'), async (req, res) => {
  const { sessionId, label = '补充材料' } = req.body;
  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'file is required' });
  }

  const summary = await summarizeFile(req.file, label);
  const summarySlotHints = buildSummarySlotHints(summary);
  const fileRecord = {
    originalName: req.file.originalname,
    filename: req.file.filename,
    path: `/uploads/${req.file.filename}`,
    size: req.file.size,
    mimetype: req.file.mimetype,
    label,
    uploadedAt: new Date().toISOString(),
    summary,
  };

  const supplementFiles = [...(session.supplementFiles || []), fileRecord];
  const nextSlotState = mergeSlotHintsIntoState(session.followUp?.slotState || {}, summarySlotHints, 'file');
  const updated = upsertSession(sessionId, {
    supplementFiles,
    currentFocus: 'report',
    currentFocusLabel: '报告解读',
    triageResult: null,
    followUp: {
      ...(session.followUp || {}),
      slotState: nextSlotState,
    },
  });

  if (shouldImmediateUrgent(updated, '')) {
    const triageResult = buildUrgentShortcutResult(updated);
    upsertSession(sessionId, {
      triageResult,
      conversationStage: 'structured',
      followUp: {
        ...(updated.followUp || {}),
        completed: true,
        currentQuestionId: '',
      },
      followUpMeta: {
        mode: 'urgent-shortcut',
        reason: '图片提示高风险，跳过后续追问直接出分析',
      },
    });
    return res.json({
      ok: true,
      file: fileRecord,
      total: supplementFiles.length,
      slotHints: summarySlotHints,
      currentFocus: { key: 'report', label: '报告解读' },
      forceImmediateResult: true,
      reply: '这份材料提示风险偏高，我先直接更新分析结果。',
    });
  }

  return res.json({
    ok: true,
    file: fileRecord,
    total: supplementFiles.length,
    slotHints: summarySlotHints,
    currentFocus: { key: 'report', label: '报告解读' },
  });
});

app.post('/triage/start-with-file', upload.single('file'), async (req, res) => {
  const { label = '检验报告' } = req.body;
  if (!req.file) {
    return res.status(400).json({ error: 'file is required' });
  }

  const summary = await summarizeFile(req.file, label);
  const slotHints = buildSummarySlotHints(summary);
  const fileRecord = {
    originalName: req.file.originalname,
    filename: req.file.filename,
    path: `/uploads/${req.file.filename}`,
    size: req.file.size,
    mimetype: req.file.mimetype,
    label,
    uploadedAt: new Date().toISOString(),
    summary,
  };
  const chiefComplaint = [
    summary.title,
    ...(summary.highlights || []).slice(0, 2),
    ...(summary.keyMetrics || []).slice(0, 2),
  ]
    .filter(Boolean)
    .join('，');

  const result = await createTriageSession({
    chiefComplaint: chiefComplaint || '我想让你看看这份检查报告',
    supplements: [`用户直接发送了一份${label}`],
    supplementFiles: [fileRecord],
    slotHints,
  });

  return res.json({
    ...result,
    file: fileRecord,
    slotHints,
    source: 'file',
  });
});

app.get('/triage/result/:id', async (req, res) => {
  const originalSession = getSession(req.params.id);
  if (!originalSession) {
    return res.status(404).json({ error: 'session not found' });
  }
  const session = await rerouteSessionByContext(originalSession);

  let triageResult = session.triageResult || buildTriageResult(session);
  if (!session.triageResult) {
    try {
      const guidance = await buildGuidanceDecision(session, triageResult);
      if (guidance) {
        triageResult = {
          ...triageResult,
          aiGuidance: true,
          layeredOutput: {
            ...triageResult.layeredOutput,
            core: {
              ...triageResult.layeredOutput.core,
              text: guidance.actionSummary || triageResult.layeredOutput.core.text,
              possibleTypes: guidance.likelyDirection
                ? [guidance.likelyDirection, guidance.simpleExplanation || triageResult.layeredOutput.core.possibleTypes?.[1] || '']
                : triageResult.layeredOutput.core.possibleTypes,
              recommendationLevel: guidance.actionLevel,
              severityLevel: guidance.severityLevel,
              severityText: guidance.severityText,
              userGoal: guidance.userGoal,
              needsBooking: guidance.needsBooking,
              needsCost: guidance.needsCost,
            },
            detail: {
              ...triageResult.layeredOutput.detail,
              selfCareAdvice: guidance.selfCareAdvice || [],
              medicationAdvice: guidance.medicationAdvice || [],
              visitAdvice: guidance.visitAdvice || [],
              examAdvice: guidance.examAdvice || [],
            },
          },
        };
      }
    } catch (_error) {
    }
  }
  if (!session.triageResult) {
    try {
      const personalized = await personalizeTriageResult(session, triageResult);
      if (personalized) {
        triageResult = {
          ...triageResult,
          aiPersonalized: true,
          layeredOutput: {
            ...triageResult.layeredOutput,
            core: {
              ...triageResult.layeredOutput.core,
              personalizedText: personalized.summaryLine || triageResult.layeredOutput.core.personalizedText || '',
            },
            detail: {
              ...triageResult.layeredOutput.detail,
              whyDepartment: personalized.whyDepartment || triageResult.layeredOutput.detail.whyDepartment,
              stepByStep: personalized.checkFocus
                ? [personalized.checkFocus, ...(triageResult.layeredOutput.detail.stepByStep || [])]
                : triageResult.layeredOutput.detail.stepByStep,
              personalizedTips: Array.isArray(personalized.userTips) ? personalized.userTips : [],
            },
          },
        };
      }
    } catch (_error) {
    }
  }
  if (!session.triageResult && process.env.AI_RESULT_REWRITE === '1') {
    try {
      const aiRewrite = await rewriteTriageResult(session, triageResult);
      triageResult = mergeTriageWithAi(triageResult, aiRewrite);
    } catch (_error) {
    }
  }
  triageResult = applyTextRiskGuidance(triageResult, session);
  triageResult = applyImageRiskGuidance(triageResult, session);
  const latest = upsertSession(req.params.id, { triageResult });
  const topicChips = buildTopicChips(latest, triageResult);
  const currentFocus = topicChips.find((chip) => chip.key === latest.currentFocus)
    ? { key: latest.currentFocus, label: latest.currentFocusLabel || topicChips.find((chip) => chip.key === latest.currentFocus)?.label || '' }
    : { key: 'summary', label: '小科分析' };
  return res.json({
    ...triageResult,
    snapshot: {
      currentFocus,
      topicChips,
    },
  });
});

app.post('/cost/estimate', (req, res) => {
  const { sessionId } = req.body;
  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }

  const estimate = buildCostEstimate(session);
  const localMedicationRefs = buildLocalMedicationRefs(session.scenario?.id);
  if (localMedicationRefs.length) {
    estimate.expanded.medicationPriceRefs = mergeMedicationRefs(
      localMedicationRefs,
      estimate.expanded.medicationPriceRefs || []
    );
  }
  upsertSession(sessionId, { estimate });
  return res.json({
    coverageTier: '基础覆盖',
    updatedAt: '2026-03-29',
    ...estimate,
  });
});

app.get('/booking/options', (req, res) => {
  const { sessionId } = req.query;
  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }

  const booking = buildBookingSuggestion(session);
  upsertSession(sessionId, { booking });
  return res.json(booking);
});

app.post('/archive/upload', upload.array('files', 10), (req, res) => {
  const { userId = 'guest', sessionId, summary, doctorAdvice } = req.body;
  const session = sessionId ? getSession(sessionId) : null;

  const triageResult = session?.triageResult || (session ? buildTriageResult(session) : null);
  const record = {
    id: uuidv4(),
    userId,
    sessionId: sessionId || null,
    summary: summary || triageResult?.layeredOutput?.core?.text || '就医记录',
    summaryText: triageResult?.layeredOutput?.core?.text || '',
    likelyType: triageResult?.layeredOutput?.core?.possibleTypes?.[0] || '',
    severityText: triageResult?.layeredOutput?.core?.severityText || '',
    doctorAdvice: doctorAdvice || '',
    department: triageResult?.layeredOutput?.core?.suggestDepartment || '',
    costRange: triageResult?.layeredOutput?.core?.firstCostRange || '',
    firstChecks: triageResult?.layeredOutput?.core?.firstChecks || [],
    summarySnapshot: triageResult?.layeredOutput || null,
    chiefComplaint: session?.chiefComplaint || '',
    conversationItems: buildConversationSnapshot(session),
    answers: session?.answers || {},
    supplements: session?.supplements || [],
    supplementInsights: session?.supplementInsights || [],
    files: [
      ...((session?.supplementFiles || []).map((f) => ({
        originalName: f.originalName,
        filename: f.filename,
        path: f.path,
        size: f.size,
        summary: f.summary || null,
      })) || []),
      ...(req.files || []).map((f) => ({
        originalName: f.originalname,
        filename: f.filename,
        path: `/uploads/${f.filename}`,
        size: f.size,
      })),
    ],
  };

  saveArchive(userId, record);
  return res.json({ ok: true, record });
});

app.get('/archive/list', (req, res) => {
  const userId = req.query.userId || 'guest';
  const records = getArchives(userId).slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return res.json({ userId, total: records.length, records });
});

app.get('/archive/:userId/:recordId', (req, res) => {
  const { userId, recordId } = req.params;
  const record = getArchive(userId, recordId);
  if (!record) {
    return res.status(404).json({ error: 'record not found' });
  }
  return res.json({ ok: true, record });
});

app.get('/archive/:userId/:recordId/context', (req, res) => {
  const { userId, recordId } = req.params;
  const record = getArchive(userId, recordId);
  if (!record) {
    return res.status(404).json({ error: 'record not found' });
  }

  const session = record.sessionId ? getSession(record.sessionId) : null;
  const contextText = buildArchiveContextText(record, session);
  return res.json({
    ok: true,
    recordId,
    contextText,
    record,
  });
});

app.post('/archive/:userId/:recordId/context-session', async (req, res) => {
  const { userId, recordId } = req.params;
  const record = getArchive(userId, recordId);
  if (!record) {
    return res.status(404).json({ error: 'record not found' });
  }

  const sourceSession = record.sessionId ? getSession(record.sessionId) : null;
  const contextText = buildArchiveContextText(record, sourceSession);
  const result = await createTriageSession({
    age: sourceSession?.age,
    gender: sourceSession?.gender,
    province: sourceSession?.province,
    city: sourceSession?.city,
    district: sourceSession?.district,
    insuranceType: sourceSession?.insuranceType,
    chiefComplaint: sourceSession?.chiefComplaint || record.summaryText || record.summary || record.likelyType || '我想继续参考之前的病情记录',
    supplements: contextText ? [contextText] : [],
    supplementInsights: sourceSession?.supplementInsights || record.supplementInsights || [],
    supplementFiles: sourceSession?.supplementFiles || [],
    slotHints: buildSlotHintsFromSession(sourceSession),
  });

  return res.json({
    ok: true,
    sourceRecord: record,
    contextText,
    ...result,
  });
});

app.get('/triage/session/:id/state', async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }

  const currentQuestionId = session.followUp?.currentQuestionId || '';
  const currentQuestion = currentQuestionId
    ? (session.scenario?.questions || []).find((item) => item.id === currentQuestionId) || null
    : null;
  const progress = session.followUp?.stepCount && session.scenario?.questions?.length
    ? {
        current: Math.min(Number(session.followUp.stepCount || 0) + (currentQuestion ? 1 : 0), session.scenario.questions.length),
        total: session.scenario.questions.length,
      }
    : null;
  const currentFocus = {
    key: session.currentFocus || 'summary',
    label: session.currentFocusLabel || '小科分析',
  };

  return res.json({
    ok: true,
    sessionId: session.id,
    conversationStage: session.conversationStage || 'idle',
    currentPrompt: session.openPromptText
      ? {
          type: 'text',
          text: session.openPromptText,
        }
      : null,
    currentQuestion,
    progress,
    profile: {
      province: session.province || '',
      city: session.city || '',
      district: session.district || '',
      insuranceType: session.insuranceType || '',
    },
    hasResult: Boolean(session.triageResult),
    currentFocus,
  });
});

app.delete('/archive/:userId/:recordId', (req, res) => {
  const { userId, recordId } = req.params;
  const records = deleteArchive(userId, recordId);
  return res.json({ ok: true, total: records.length, records });
});

app.post('/api/asr', memUpload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'no audio file' });
    }
    const transcript = await speechToText(req.file.buffer, req.file.mimetype || 'audio/webm');
    return res.json({ ok: true, text: transcript });
  } catch (error) {
    console.error('[asr]', error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

async function handleTtsRequest(req, res) {
  try {
    const source = req.method === 'GET' ? req.query : req.body;
    const text = String(source?.text || '').trim();
    if (!text) {
      return res.status(400).json({ ok: false, error: 'text is required' });
    }
    const result = await synthesizeSpeech(text, {
      model: source?.model,
      voice: source?.voice,
      format: source?.format || 'mp3',
    });
    res.setHeader('Content-Type', result.mimeType || 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(result.buffer);
  } catch (error) {
    console.error('[tts]', error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

app.post('/api/tts', handleTtsRequest);
app.get('/api/tts', handleTtsRequest);

// ── 阶段二：检查单分析 ──
app.post('/api/analyze/check-sheet', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const userContext = String(req.body?.context || '').trim();
    if (!file) {
      return res.status(400).json({ ok: false, error: '请上传检查单图片' });
    }

    const { ocrFile: doOcr } = require('./ai');
    const ocrText = await doOcr(file, '检查单');
    if (!ocrText) {
      return res.json({
        ok: false,
        error: 'OCR 未识别到文字，请确保图片清晰完整',
        ocrText: '',
      });
    }

    const analysis = await analyzeCheckSheet(ocrText, userContext);
    return res.json({
      ok: true,
      ocrText: ocrText.slice(0, 300),
      analysis: analysis || { items: [], script: '', savingEstimate: '', note: '分析暂时不可用，请稍后重试' },
      disclaimer: '以上分析仅供参考，具体请遵医嘱。',
    });
  } catch (error) {
    console.error('[analyze/check-sheet]', error.message);
    return res.status(500).json({ ok: false, error: '分析失败，请重试' });
  }
});

// ── 阶段二：处方分析 ──
app.post('/api/analyze/prescription', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const userContext = String(req.body?.context || '').trim();
    if (!file) {
      return res.status(400).json({ ok: false, error: '请上传处方图片' });
    }

    const { ocrFile: doOcr } = require('./ai');
    const ocrText = await doOcr(file, '处方');
    if (!ocrText) {
      return res.json({
        ok: false,
        error: 'OCR 未识别到文字，请确保图片清晰完整',
        ocrText: '',
      });
    }

    const analysis = await analyzePrescription(ocrText, userContext);
    return res.json({
      ok: true,
      ocrText: ocrText.slice(0, 300),
      analysis: analysis || { medicines: [], script: '', interactions: '', note: '分析暂时不可用，请稍后重试' },
      disclaimer: '以上分析仅供参考，用药请遵医嘱，切勿自行停药或换药。',
    });
  } catch (error) {
    console.error('[analyze/prescription]', error.message);
    return res.status(500).json({ ok: false, error: '分析失败，请重试' });
  }
});

// ── 阶段三：报告解读 ──
app.post('/api/analyze/report', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const userContext = String(req.body?.context || '').trim();
    if (!file) {
      return res.status(400).json({ ok: false, error: '请上传检验报告图片' });
    }

    const analysis = await analyzeReport(file, userContext);
    if (!analysis) {
      return res.json({
        ok: false,
        error: '未能解析报告，请确保图片清晰完整',
      });
    }

    return res.json({
      ok: true,
      analysis,
      disclaimer: '以上解读仅供参考，具体诊断请咨询医生。',
    });
  } catch (error) {
    console.error('[analyze/report]', error.message);
    return res.status(500).json({ ok: false, error: '分析失败，请重试' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`挂啥科 MVP running on http://localhost:${PORT}`);
});
