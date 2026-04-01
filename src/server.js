const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const {
  SCENARIOS,
  detectScenarioDetailed,
  detectScenario,
  getScenarioSlotCatalog,
  buildTriageResult,
  buildCostEstimate,
  buildBookingSuggestion,
} = require('./rules');
const { searchRegions } = require('./regions');
const { upsertSession, getSession, saveArchive, getArchive, getArchives, deleteArchive } = require('./store');
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

function getFollowUpConfig(session) {
  const totalQuestions = session?.scenario?.questions?.length || 0;
  return {
    minSteps: Math.min(5, Math.max(4, totalQuestions)),
    maxSteps: Math.min(10, Math.max(6, totalQuestions)),
  };
}

function getAskedQuestionIds(session) {
  return Array.isArray(session.followUp?.askedQuestionIds) ? session.followUp.askedQuestionIds : [];
}

function getFallbackNextQuestion(session) {
  const asked = new Set(getAskedQuestionIds(session));
  return (session.scenario?.questions || []).find((question) => !asked.has(question.id)) || null;
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
    cost_question: { key: 'cost', label: '费用医保' },
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

function buildTopicChips(session, triageResult) {
  const core = triageResult?.layeredOutput?.core || {};
  const detail = triageResult?.layeredOutput?.detail || {};
  const needsInPerson = ['routine_clinic', 'specialist_clinic', 'hospital_priority_high'].includes(core.recommendationLevel);
  const chips = [{ key: 'summary', label: '先看总结' }];
  const requestedFocus =
    session?.currentFocus && !['summary', 'other', 'new_issue'].includes(session.currentFocus)
      ? { key: session.currentFocus, label: session.currentFocusLabel || session.currentFocus }
      : null;

  if ((detail.selfCareAdvice || []).length || (detail.visitAdvice || []).length) {
    chips.push({ key: 'care', label: '现在怎么处理' });
  }
  if ((detail.medicationAdvice || []).length) {
    chips.push({ key: 'medication', label: '用什么药' });
  }
  if (needsInPerson) {
    chips.push({ key: 'booking', label: '去哪个医院' });
  }
  if (core.needsCost) {
    chips.push({ key: 'cost', label: '费用和医保' });
  }
  if ((session?.supplementFiles || []).length) {
    chips.push({ key: 'report', label: '看检查报告' });
  }
  if (needsInPerson && ((detail.examAdvice || []).length || (core.firstChecks || []).length)) {
    chips.push({ key: 'checks', label: '要做哪些检查' });
  }
  chips.push({ key: 'continue', label: '继续聊当前问题' });
  if (requestedFocus) {
    chips.push(requestedFocus);
  }

  return chips.filter((chip, index, array) => array.findIndex((item) => item.key === chip.key) === index);
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
    .filter((question) => !isSlotFilled(session, question.slot));
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

  const targetTotal = Math.max(config.minSteps, Math.min(config.maxSteps, stepCount + candidates.length));
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

  if (record.summary) parts.push(`之前一次问诊总结：${record.summary}`);
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
  let scenario = ruleRoute.scenario;
  let routeMeta = {
    mode: 'rule',
    normalizedComplaint: ruleRoute.normalizedText || chiefComplaint,
    reason: `按规则关键词匹配路由（命中分数：${ruleRoute.score}）`,
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

  if (ruleRoute.score <= 0) {
    routeMeta = {
      mode: 'rule-fallback',
      normalizedComplaint: chiefComplaint,
      reason: '模型路由没有返回稳定结果，已回退规则路由',
    };
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

  const nextQuestionState = await resolveNextQuestion(updatedSession);
  upsertSession(sessionId, {
    followUp: nextQuestionState.followUpPatch,
    followUpMeta: nextQuestionState.followUpMeta,
  });

  if (nextQuestionState.done) {
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
    .filter((item) => !isSlotFilled(updatedSession, item.slot));

  const openPlan = await planOpenInterviewTurn(updatedSession, text, candidates, {
    openTurns,
  }).catch(() => null);

  if (!openPlan) {
    return res.status(503).json({ error: '当前智能分析暂时不可用，请稍后再试。' });
  }

  if (openPlan.collectMode === 'summary') {
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
      assistantReply: openPlan.assistantReply || '我这边先整理一下，现在可以给你初步总结了。',
      insight,
      needsConfirmation: true,
      currentFocus,
    });
  }

  if (openPlan.collectMode === 'structured') {
    const picked = candidates.find((item) => item.id === openPlan.questionId) || candidates[0] || null;
    if (!picked) {
      return res.status(503).json({ error: '当前智能分析暂时不可用，请稍后再试。' });
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
        total: Math.max(3, Math.min(6, candidates.length + 1)),
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

  const intentType = turnIntent?.intentType || 'medical_followup';
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
  let followUpAnswer = null;
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
    affectsSummary: Boolean(followUpAnswer?.affectsSummary),
    impactLevel: followUpAnswer?.impactLevel || 'none',
    refreshSummary:
      Boolean(session.triageResult) &&
      ['medical_followup', 'medication_question', 'booking_question', 'cost_question'].includes(intentType) &&
      Boolean(followUpAnswer?.affectsSummary) &&
      (followUpAnswer?.shouldRefreshSummary !== false),
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
  upsertSession(sessionId, {
    supplementFiles,
    currentFocus: 'report',
    currentFocusLabel: '报告解读',
    triageResult: null,
    followUp: {
      ...(session.followUp || {}),
      slotState: nextSlotState,
    },
  });

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
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }

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
  upsertSession(req.params.id, { triageResult });
  const topicChips = buildTopicChips(session, triageResult);
  const currentFocus = topicChips.find((chip) => chip.key === session.currentFocus)
    ? { key: session.currentFocus, label: session.currentFocusLabel || topicChips.find((chip) => chip.key === session.currentFocus)?.label || '' }
    : { key: 'summary', label: '先看总结' };
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

app.delete('/archive/:userId/:recordId', (req, res) => {
  const { userId, recordId } = req.params;
  const records = deleteArchive(userId, recordId);
  return res.json({ ok: true, total: records.length, records });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`挂啥科 MVP running on http://localhost:${PORT}`);
});
