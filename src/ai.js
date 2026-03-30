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
  chooseNextFollowUp,
  interpretSupplement,
  rewriteTriageResult,
  ocrFile,
};
