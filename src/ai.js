const fs = require('fs');
const path = require('path');

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_TEXT_MODEL = 'qwen3.5-plus-2026-02-15';
const DEFAULT_OCR_MODEL = 'qwen-vl-ocr-latest';
const DEFAULT_TIMEOUT_MS = 15000;

function getConfig() {
  return {
    apiKey: process.env.DASHSCOPE_API_KEY || '',
    baseUrl: (process.env.DASHSCOPE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
    textModel: process.env.DASHSCOPE_TEXT_MODEL || DEFAULT_TEXT_MODEL,
    ocrModel: process.env.DASHSCOPE_OCR_MODEL || DEFAULT_OCR_MODEL,
  };
}

function isConfigured() {
  return Boolean(getConfig().apiKey);
}

function getStatus() {
  const config = getConfig();
  return {
    enabled: Boolean(config.apiKey),
    provider: config.apiKey ? 'dashscope' : 'fallback',
    textModel: config.textModel,
    ocrModel: config.ocrModel,
    baseUrl: config.baseUrl,
  };
}

async function chatCompletions({ model, messages, temperature = 0.2, maxTokens = 800 }) {
  const config = getConfig();
  if (!config.apiKey) {
    throw new Error('DASHSCOPE_API_KEY is not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        enable_thinking: false,
        stream: false,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`dashscope chat timeout after ${DEFAULT_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`dashscope chat failed: ${response.status} ${detail}`.trim());
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map((item) => item?.text || item?.content || '').join('\n').trim();
  }
  return '';
}

function extractJsonObject(text = '') {
  const source = String(text || '').trim();
  if (!source) return null;
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : source;

  try {
    return JSON.parse(candidate);
  } catch (_error) {
  }

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch (_error) {
    }
  }

  return null;
}

async function classifyComplaint(chiefComplaint, scenarios) {
  if (!isConfigured()) return null;

  const prompt = [
    '你是分诊路由器，只做场景归类，不做诊断。',
    '从下面场景里选一个最匹配的 scenarioId：',
    scenarios
      .map((scenario) => `${scenario.id}: ${scenario.label}；关键词：${(scenario.keywords || []).slice(0, 4).join('、')}`)
      .join('\n'),
    `用户主诉：${chiefComplaint}`,
    '输出 JSON，字段固定：scenarioId、normalizedComplaint、reason。',
    '只能返回一个 JSON 对象，不要解释。',
  ].join('\n');

  const raw = await chatCompletions({
    model: getConfig().textModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    maxTokens: 140,
  });

  const parsed = extractJsonObject(raw);
  if (!parsed?.scenarioId) return null;
  return parsed;
}

async function analyzeInitialTurn(userMessage, scenarios) {
  if (!isConfigured()) return null;

  const prompt = [
    '你是“小科”的医疗咨询会话入口分析器。',
    '任务：判断用户这句话属于什么任务、适合什么医学方向、是先开放式继续聊天还是直接进入结构化问题。',
    '支持的 taskType：symptom_consult、report_interpretation、booking_hospital、cost_insurance、follow_up_consult、out_of_scope。',
    '可选的 scenarioId：',
    scenarios.map((scenario) => `${scenario.id}: ${scenario.label}`).join('\n'),
    '要求：',
    '1. 不做诊断。',
    '2. assistantReply 要像真人客服/助手，简短自然。',
    '3. 如果需要先继续自由聊天，collectMode 输出 open，并给 nextPromptText。',
    '4. 如果已经适合进入结构化问题，collectMode 输出 structured。',
    '5. 如果是明显非医疗问题，taskType 输出 out_of_scope。',
    '6. 对症状咨询，除非用户已经明确说出持续时间/频率/部位/伴随变化中的至少两项，否则优先输出 open，不要过早进入结构化问答。',
    '输出 JSON，字段固定：taskType、scenarioId、collectMode、assistantReply、nextPromptText、reason。',
    `用户输入：${userMessage}`,
    '只返回一个 JSON 对象。',
  ].join('\n');

  const raw = await chatCompletions({
    model: getConfig().textModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    maxTokens: 260,
  });

  const parsed = extractJsonObject(raw);
  if (!parsed?.taskType) return null;
  return parsed;
}

async function classifyConversationTurn(session, userMessage) {
  if (!isConfigured()) return null;

  const prompt = [
    '你是“小科”的对话意图判断器。',
    '任务：判断用户这条新消息，在当前医疗咨询上下文里属于哪一类。',
    '可选 intentType：medical_followup、medication_question、booking_question、cost_question、report_notice、new_issue、off_topic。',
    '可选 topicKey：symptom、medication、booking、cost、report、new_issue、other。',
    '要求：',
    '1. medical_followup 表示继续补充症状、病史、检查、感受。',
    '2. medication_question 表示主要在问吃什么药、怎么用药。',
    '3. booking_question 表示主要在问挂什么科、去哪家医院、怎么挂号。',
    '4. cost_question 表示主要在问费用、医保、报销。',
    '5. report_notice 表示主要在说要发报告、刚发了报告、让系统看报告。',
    '6. new_issue 表示用户开始问另一个明显不同的新问题，不适合继续当作当前症状补充。',
    '7. off_topic 表示和当前医疗咨询关系不大，或者明显跑题。',
    '8. reply 用一句自然的话回复用户，不要解释内部判断。',
    '9. focusLabel 用 2 到 6 个字概括这轮主要在聊什么，例如：症状判断、用药顾虑、挂号医院、费用医保、报告解读。',
    '输出 JSON，字段固定：intentType、topicKey、focusLabel、reply、reason。',
    `当前主诉：${session.chiefComplaint || ''}`,
    `当前场景：${session.scenario?.label || ''}`,
    `当前任务：${session.taskType || 'symptom_consult'}`,
    `已有补充：${JSON.stringify((session.supplements || []).slice(-6))}`,
    `用户新消息：${userMessage}`,
    '只返回一个 JSON 对象。',
  ].join('\n');

  const raw = await chatCompletions({
    model: getConfig().textModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    maxTokens: 220,
  });

  const parsed = extractJsonObject(raw);
  if (!parsed?.intentType) return null;
  return {
    intentType: String(parsed.intentType || '').trim(),
    topicKey: String(parsed.topicKey || '').trim(),
    focusLabel: String(parsed.focusLabel || '').trim(),
    reply: String(parsed.reply || '').trim(),
    reason: String(parsed.reason || '').trim(),
  };
}

function buildAnswerSummary(session) {
  return (session.scenario?.questions || [])
    .map((question) => {
      const answer = session.answers?.[question.id];
      if (!answer) return null;
      return `${question.text}：${answer}`;
    })
    .filter(Boolean)
    .join('；');
}

function buildSlotStateSummary(session) {
  const slotState = session.followUp?.slotState || {};
  return Object.entries(slotState)
    .map(([slot, value]) => {
      const label = value?.slotLabel || slot;
      const answer = value?.answer || '';
      return answer ? `${label}：${answer}` : '';
    })
    .filter(Boolean)
    .join('；');
}

function buildFileInsightSummary(session) {
  return (session.supplementFiles || [])
    .map((file) => {
      const title = file.summary?.title || file.originalName || '补充材料';
      const metrics = Array.isArray(file.summary?.keyMetrics) ? file.summary.keyMetrics.slice(0, 4) : [];
      const highlights = Array.isArray(file.summary?.highlights) ? file.summary.highlights.slice(0, 3) : [];
      const merged = [...new Set([...metrics, ...highlights])].slice(0, 4);
      return merged.length ? `${title}：${merged.join('；')}` : title;
    })
    .filter(Boolean)
    .join('\n');
}

async function rewriteTriageResult(session, fallbackResult) {
  if (!isConfigured()) return null;

  const scenario = session.scenario || {};
  const prompt = [
    '你是“小科”，负责把结构化就医建议改写成通俗、克制、面向普通用户的话。',
    '重要约束：',
    '1. 不要更改科室、医院层级、首轮检查项目、费用区间。',
    '2. 不要给诊断结论，不要伪装成医生确诊。',
    '3. 保持短句，先结论后解释。',
    '4. 输出必须是 JSON。',
    '5. 字段固定为 coreText、whyDepartment、suspectedDirections、stepByStep、riskReminder。',
    '输入信息：',
    JSON.stringify({
      chiefComplaint: session.chiefComplaint,
      supplements: session.supplements || [],
      scenario: scenario.label,
      department: scenario.department,
      hospitalLevel: scenario.hospitalLevel,
      firstChecks: fallbackResult.layeredOutput.core.firstChecks,
      firstCostRange: fallbackResult.layeredOutput.core.firstCostRange,
      answerSummary: buildAnswerSummary(session),
      redFlag: fallbackResult.riskLevel === 'urgent',
      fallback: fallbackResult.layeredOutput,
    }),
    '只返回 JSON。',
  ].join('\n');

  const raw = await chatCompletions({
    model: getConfig().textModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    maxTokens: 900,
  });

  const parsed = extractJsonObject(raw);
  if (!parsed?.coreText) return null;
  return parsed;
}

async function personalizeTriageResult(session, fallbackResult) {
  if (!isConfigured()) return null;

  const prompt = [
    '你是“小科”的就医总结助手。',
    '任务：根据已经填好的槽位、补充说明和检查材料，把规则结果再个性化一点。',
    '要求：',
    '1. 不要改变推荐科室、医院层级、首轮检查和费用区间。',
    '2. 不做诊断，不用“确诊”口吻。',
    '3. summaryLine 要是一句很短的人话，18到38字。',
    '4. whyDepartment 和 checkFocus 各 1 句话，简短直接。',
    '5. userTips 最多 3 条，每条不超过 20 个字。',
    '输出 JSON，字段固定：summaryLine、whyDepartment、checkFocus、userTips。',
    JSON.stringify({
      chiefComplaint: session.chiefComplaint,
      scenario: session.scenario?.label,
      slotState: buildSlotStateSummary(session),
      supplementInsights: (session.supplementInsights || []).map((item) => item.summary),
      fileInsights: buildFileInsightSummary(session),
      fallbackCore: fallbackResult.layeredOutput?.core || {},
      fallbackDetail: fallbackResult.layeredOutput?.detail || {},
    }),
    '只返回 JSON。',
  ].join('\n');

  const raw = await chatCompletions({
    model: getConfig().textModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    maxTokens: 260,
  });

  const parsed = extractJsonObject(raw);
  if (!parsed?.summaryLine) return null;
  return {
    summaryLine: String(parsed.summaryLine || '').trim(),
    whyDepartment: String(parsed.whyDepartment || '').trim(),
    checkFocus: String(parsed.checkFocus || '').trim(),
    userTips: Array.isArray(parsed.userTips) ? parsed.userTips.filter(Boolean).slice(0, 3) : [],
  };
}

async function buildGuidanceDecision(session, fallbackResult) {
  if (!isConfigured()) return null;

  const prompt = [
    '你是“小科”的就医建议决策器。',
    '任务：根据当前对话、补充信息、材料和系统已有结果，输出更像真人助手的分级建议。',
    '要求：',
    '1. 不要确诊，只能说“更像”“可能”“先考虑”。',
    '2. 结果不要默认都导向挂号；要先判断轻重和用户真正想解决的问题。',
    '3. actionLevel 只能是 self_care、otc_guidance、routine_clinic、specialist_clinic、hospital_priority_high。',
    '4. severityLevel 只能是 mild、moderate、high。',
    '5. medicationAdvice 测试期允许写出具体药名或药物方向，但语气必须克制，最多 3 条。',
    '6. 如果当前不一定需要线下就医，needsBooking 和 needsCost 可以为 false。',
    '7. 输出必须是 JSON。',
    '字段固定：likelyDirection、simpleExplanation、severityLevel、severityText、userGoal、actionLevel、actionSummary、selfCareAdvice、medicationAdvice、visitAdvice、examAdvice、needsBooking、needsCost。',
    JSON.stringify({
      chiefComplaint: session.chiefComplaint,
      scenario: session.scenario?.label,
      routeReason: session.routeMeta?.reason || '',
      slotState: buildSlotStateSummary(session),
      supplements: (session.supplements || []).slice(-8),
      supplementInsights: (session.supplementInsights || []).map((item) => item.summary).slice(-5),
      fileInsights: buildFileInsightSummary(session),
      fallbackCore: fallbackResult.layeredOutput?.core || {},
      fallbackDetail: fallbackResult.layeredOutput?.detail || {},
      taskType: session.taskType || 'symptom_consult',
    }),
    '只返回一个 JSON 对象。',
  ].join('\n');

  const raw = await chatCompletions({
    model: getConfig().textModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.15,
    maxTokens: 500,
  });

  const parsed = extractJsonObject(raw);
  if (!parsed?.actionLevel || !parsed?.likelyDirection) return null;
  return {
    likelyDirection: String(parsed.likelyDirection || '').trim(),
    simpleExplanation: String(parsed.simpleExplanation || '').trim(),
    severityLevel: String(parsed.severityLevel || '').trim(),
    severityText: String(parsed.severityText || '').trim(),
    userGoal: String(parsed.userGoal || '').trim(),
    actionLevel: String(parsed.actionLevel || '').trim(),
    actionSummary: String(parsed.actionSummary || '').trim(),
    selfCareAdvice: Array.isArray(parsed.selfCareAdvice) ? parsed.selfCareAdvice.filter(Boolean).slice(0, 4) : [],
    medicationAdvice: Array.isArray(parsed.medicationAdvice) ? parsed.medicationAdvice.filter(Boolean).slice(0, 3) : [],
    visitAdvice: Array.isArray(parsed.visitAdvice) ? parsed.visitAdvice.filter(Boolean).slice(0, 4) : [],
    examAdvice: Array.isArray(parsed.examAdvice) ? parsed.examAdvice.filter(Boolean).slice(0, 4) : [],
    needsBooking: Boolean(parsed.needsBooking),
    needsCost: Boolean(parsed.needsCost),
  };
}

async function answerFollowUpTurn(session, userMessage, intentType = 'medical_followup') {
  if (!isConfigured()) return null;

  const prompt = [
    '你是“小科”的继续追问回答器。',
    '任务：在当前已经有初步总结的前提下，针对用户新追问先给一句自然、直接、有帮助的回答。',
    '要求：',
    '1. 不要重复整份总结。',
    '2. 先正面回应用户当前这句在问什么。',
    '3. 语气像真人助手，不要官话，不要说内部流程。',
    '4. 不要确诊，只能说“更像”“先考虑”“通常”。',
    '5. 如果用户问的是药，可以直接给常见药名或药物类别，但最多 3 条，语气要克制。',
    '6. 如果用户问的是挂号/医院/费用，就优先回答那个问题，不要再泛泛重复病情。',
    '7. 输出 JSON，字段固定：answer、shouldRefreshSummary。',
    JSON.stringify({
      intentType,
      chiefComplaint: session.chiefComplaint,
      currentFocus: session.currentFocusLabel || '',
      currentSummary: session.triageResult?.layeredOutput?.core || {},
      currentDetail: session.triageResult?.layeredOutput?.detail || {},
      slotState: buildSlotStateSummary(session),
      supplementInsights: (session.supplementInsights || []).map((item) => item.summary).slice(-5),
      fileInsights: buildFileInsightSummary(session),
      userMessage,
    }),
    '只返回一个 JSON 对象。',
  ].join('\n');

  const raw = await chatCompletions({
    model: getConfig().textModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    maxTokens: 260,
  });

  const parsed = extractJsonObject(raw);
  if (!parsed?.answer) return null;
  return {
    answer: String(parsed.answer || '').trim(),
    shouldRefreshSummary: parsed.shouldRefreshSummary !== false,
  };
}

async function chooseNextFollowUp(session, candidates, meta = {}) {
  if (!isConfigured() || !Array.isArray(candidates) || !candidates.length) return null;

  const answered = (session.scenario?.questions || [])
    .map((question) => {
      const answer = session.answers?.[question.id];
      if (!answer) return null;
      return { id: question.id, text: question.text, answer };
    })
    .filter(Boolean);
  const supplementInsights = Array.isArray(session.supplementInsights)
    ? session.supplementInsights.map((item) => ({
        summary: item.summary,
        relevantSlots: item.relevantSlots || [],
        normalizedFacts: item.normalizedFacts || [],
      }))
    : [];
  const slotStateSummary = buildSlotStateSummary(session);

  const prompt = [
    '你是“小科”的动态追问引擎。',
    '任务：根据用户主诉和已知回答，从候选问题里只选下一问最有价值的一题。',
    '要求：',
    '1. 只能从候选槽位里选一个 questionId，不要自造新槽位。',
    '2. 你要尽量把这一题重新写得更贴近日常说法，不要机械照抄默认问法。',
    '3. 如果目前信息已经够生成初步建议，可以返回 enoughInfo=true。',
    '4. 用户目标是挂哪个科、先查什么、费用大概多少，不是做诊断。',
    '5. 输出必须是 JSON。',
    '字段固定：questionId、questionText、options、enoughInfo、reason、estimatedTotalSteps。',
    `当前主诉：${session.chiefComplaint}`,
    `当前场景：${session.scenario?.label || ''}`,
    `已经问了 ${meta.stepCount || 0} 步，至少问到 ${meta.minSteps || 0} 步，最多 ${meta.maxSteps || 0} 步。`,
    `已知回答：${answered.length ? JSON.stringify(answered) : '[]'}`,
    `已填槽位：${slotStateSummary || '暂无'}`,
    `补充信息理解：${supplementInsights.length ? JSON.stringify(supplementInsights) : '[]'}`,
    '候选问题：',
    JSON.stringify(
      candidates.map((item) => ({
        id: item.id,
        slot: item.slot || item.id,
        slotLabel: item.slotLabel || item.slot || item.id,
        defaultQuestion: item.text,
        defaultOptions: item.options,
      }))
    ),
    '只返回一个 JSON 对象，不要解释。',
  ].join('\n');

  const raw = await chatCompletions({
    model: getConfig().textModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    maxTokens: 180,
  });

  const parsed = extractJsonObject(raw);
  if (!parsed || (!parsed.questionId && !parsed.enoughInfo)) {
    return null;
  }
  if (parsed.questionText && !Array.isArray(parsed.options)) {
    parsed.options = [];
  }
  return parsed;
}

async function planOpenInterviewTurn(session, latestUserMessage, candidates = [], meta = {}) {
  if (!isConfigured()) return null;

  const prompt = [
    '你是“小科”的开放式追问引擎。',
    '任务：根据用户刚补充的自由描述，决定下一步继续开放式追问，还是转入结构化问题，还是已经可以生成初步总结。',
    '要求：',
    '1. collectMode 只能是 open、structured、summary 三种之一。',
    '2. 如果 collectMode=open，输出 assistantReply 和 nextPromptText。',
    '3. 如果 collectMode=structured，只能从候选问题里选一个 questionId，并可重写 questionText 和 options。',
    '4. 如果 collectMode=summary，表示信息已足够生成初步总结。',
    '5. 不做诊断。',
    '6. 除非已经明确主问题、持续时间/频率、至少一个影响因素或伴随信息，否则优先继续开放式追问，不要过早切按钮题。',
    '7. 只根据当前信息是否足够来判断 open 还是 structured，不要机械要求必须聊满几轮。',
    '输出 JSON，字段固定：collectMode、assistantReply、nextPromptText、questionId、questionText、options、reason。',
    `当前任务类型：${session.taskType || 'symptom_consult'}`,
    `当前场景：${session.scenario?.label || ''}`,
    `用户主诉：${session.chiefComplaint || ''}`,
    `本轮用户补充：${latestUserMessage}`,
    `已经开放式沟通轮数：${meta.openTurns || 0}`,
    `已知槽位：${buildSlotStateSummary(session) || '暂无'}`,
    `补充理解：${JSON.stringify((session.supplementInsights || []).map((item) => item.summary).slice(-3))}`,
    `候选结构化问题：${JSON.stringify(
      candidates.map((item) => ({
        id: item.id,
        slot: item.slot,
        slotLabel: item.slotLabel,
        defaultQuestion: item.text,
        defaultOptions: item.options,
      }))
    )}`,
    '只返回一个 JSON 对象，不要解释。',
  ].join('\n');

  const raw = await chatCompletions({
    model: getConfig().textModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    maxTokens: 260,
  });

  const parsed = extractJsonObject(raw);
  if (!parsed?.collectMode) return null;
  return parsed;
}

async function interpretSupplement(session, supplementText, slotCatalog = []) {
  if (!isConfigured()) return null;

  const prompt = [
    '你是“小科”的补充信息理解器。',
    '任务：读取用户补充的一段自由描述，提炼出和就医分流最相关的信息。',
    '要求：',
    '1. 不做诊断，不扩写，不编造。',
    '2. 只提炼用户已经明确说到的信息。',
    '3. relevantSlots 只能从给定槽位里选，最多 3 个。',
    '4. summary 要用一句通俗短句，15到40字。',
    '5. normalizedFacts 是 1 到 4 条简短事实。',
    '输出 JSON，字段固定：summary、relevantSlots、normalizedFacts。',
    `当前主诉：${session.chiefComplaint}`,
    `当前场景：${session.scenario?.label || ''}`,
    `已知槽位：${buildSlotStateSummary(session) || '暂无'}`,
    `用户补充：${supplementText}`,
    `可用槽位：${JSON.stringify(
      slotCatalog.map((item) => ({
        slot: item.slot,
        slotLabel: item.slotLabel,
      }))
    )}`,
    '只返回一个 JSON 对象，不要解释。',
  ].join('\n');

  const raw = await chatCompletions({
    model: getConfig().textModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    maxTokens: 220,
  });

  const parsed = extractJsonObject(raw);
  if (!parsed?.summary) return null;
  return {
    summary: String(parsed.summary || '').trim(),
    relevantSlots: Array.isArray(parsed.relevantSlots) ? parsed.relevantSlots.filter(Boolean).slice(0, 3) : [],
    normalizedFacts: Array.isArray(parsed.normalizedFacts) ? parsed.normalizedFacts.filter(Boolean).slice(0, 4) : [],
  };
}

function detectMimeFromName(fileName = '') {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.bmp') return 'image/bmp';
  if (ext === '.tif' || ext === '.tiff') return 'image/tiff';
  if (ext === '.heic') return 'image/heic';
  return 'application/octet-stream';
}

function isImageFile(file) {
  const type = file?.mimetype || detectMimeFromName(file?.originalname || '');
  return /^image\//.test(type);
}

async function ocrFile(file, label = '补充材料') {
  if (!isConfigured() || !file?.path || !fs.existsSync(file.path) || !isImageFile(file)) {
    return null;
  }

  const mimeType = file.mimetype || detectMimeFromName(file.originalname || 'upload.png');
  const base64 = fs.readFileSync(file.path).toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64}`;
  const prompt = [
    '请识别这份医疗检查/化验/处方图片中的主要文字。',
    '输出要求：',
    '1. 尽量完整保留检查名称、关键指标、结果、参考范围、结论、建议。',
    '2. 只输出识别出的纯文本，不要解释，不要补充，不要编造。',
    `3. 这是“${label}”类型的材料。`,
  ].join('\n');

  const raw = await chatCompletions({
    model: getConfig().ocrModel,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: prompt },
        ],
      },
    ],
    temperature: 0,
    maxTokens: 1800,
  });

  return String(raw || '').trim();
}

module.exports = {
  getStatus,
  isConfigured,
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
  ocrFile,
};
