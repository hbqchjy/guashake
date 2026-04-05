const fs = require('fs');
const path = require('path');
const { findDrugRefsByText } = require('./store');

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_TEXT_MODEL = 'qwen3.5-plus-2026-02-15';
const DEFAULT_CHEAP_TEXT_MODEL = 'qwen-plus';
const DEFAULT_OCR_MODEL = 'qwen-vl-ocr-latest';
const DEFAULT_VISION_MODEL = 'qwen-vl-max-latest';
const DEFAULT_ASR_MODEL = 'qwen3-asr-flash';
const DEFAULT_TTS_MODEL = 'cosyvoice-v2';
const DEFAULT_TTS_VOICE = 'longxiaochun_v2';
const DEFAULT_TTS_PROVIDER = 'dashscope';
const DEFAULT_TIMEOUT_MS = 15000;

function getConfig() {
  const fallbackListRaw = process.env.DASHSCOPE_TEXT_MODEL_FALLBACKS || process.env.DASHSCOPE_TEXT_MODEL_FALLBACK || '';
  const textModelFallbacks = String(fallbackListRaw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    apiKey: process.env.DASHSCOPE_API_KEY || '',
    baseUrl: (process.env.DASHSCOPE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
    textModelPrimary:
      process.env.DASHSCOPE_TEXT_MODEL_PRIMARY ||
      process.env.DASHSCOPE_TEXT_MODEL ||
      DEFAULT_TEXT_MODEL,
    textModelCheap: process.env.DASHSCOPE_TEXT_MODEL_CHEAP || DEFAULT_CHEAP_TEXT_MODEL,
    textModelFallbacks,
    ocrModel: process.env.DASHSCOPE_OCR_MODEL || DEFAULT_OCR_MODEL,
    visionModel: process.env.DASHSCOPE_VISION_MODEL || DEFAULT_VISION_MODEL,
    asrModel: process.env.DASHSCOPE_ASR_MODEL || DEFAULT_ASR_MODEL,
    ttsProvider: String(process.env.TTS_PROVIDER || DEFAULT_TTS_PROVIDER).trim().toLowerCase(),
    ttsModel: process.env.DASHSCOPE_TTS_MODEL || DEFAULT_TTS_MODEL,
    ttsVoice: process.env.DASHSCOPE_TTS_VOICE || DEFAULT_TTS_VOICE,
    tencentTtsSecretId: process.env.TENCENT_TTS_SECRET_ID || '',
    tencentTtsSecretKey: process.env.TENCENT_TTS_SECRET_KEY || '',
    tencentTtsAppId: process.env.TENCENT_TTS_APP_ID || '',
    tencentTtsVoiceType: process.env.TENCENT_TTS_VOICE_TYPE || '',
    externalFallbackApiKey: process.env.FALLBACK_OPENAI_API_KEY || '',
    externalFallbackBaseUrl: (process.env.FALLBACK_OPENAI_BASE_URL || '').replace(/\/$/, ''),
    externalFallbackModel: process.env.FALLBACK_OPENAI_MODEL || '',
  };
}

function isConfigured() {
  return Boolean(getConfig().apiKey);
}

function getStatus() {
  const config = getConfig();
  const externalFallbackEnabled = Boolean(
    config.externalFallbackApiKey && config.externalFallbackBaseUrl && config.externalFallbackModel
  );
  return {
    enabled: Boolean(config.apiKey),
    provider: config.apiKey ? 'dashscope' : 'fallback',
    textModel: config.textModelPrimary,
    textModelPrimary: config.textModelPrimary,
    textModelCheap: config.textModelCheap,
    textModelFallbacks: config.textModelFallbacks,
    ocrModel: config.ocrModel,
    visionModel: config.visionModel,
    asrModel: config.asrModel,
    ttsProviderRequested: config.ttsProvider,
    ttsProvider: resolveTtsProvider(config),
    ttsModel: config.ttsModel,
    ttsVoice: config.ttsVoice,
    baseUrl: config.baseUrl,
    externalFallbackEnabled,
    externalFallbackBaseUrl: config.externalFallbackBaseUrl || '',
    externalFallbackModel: config.externalFallbackModel || '',
  };
}

function hasTencentTtsConfig(config) {
  return Boolean(config.tencentTtsSecretId && config.tencentTtsSecretKey && config.tencentTtsAppId);
}

function resolveTtsProvider(config) {
  if (config.ttsProvider === 'tencent' && hasTencentTtsConfig(config) && process.env.TENCENT_TTS_ENABLED === '1') {
    return 'tencent';
  }
  return 'dashscope';
}

async function callChatCompletionOnce({
  baseUrl,
  apiKey,
  model,
  messages,
  temperature = 0.2,
  maxTokens = 800,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
    throw new Error(`chat failed: ${response.status} ${detail}`.trim());
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map((item) => item?.text || item?.content || '').join('\n').trim();
  }
  return '';
}

function addChatCandidate(candidates, candidate) {
  if (!candidate?.apiKey || !candidate?.baseUrl || !candidate?.model) return;
  const key = `${candidate.baseUrl}|${candidate.model}|${candidate.source}`;
  if (candidates.some((item) => item.key === key)) return;
  candidates.push({ key, ...candidate });
}

function buildTextRouteCandidates(config, route = 'default') {
  const candidates = [];
  const routeMap = {
    default: ['cheap', 'primary', 'dashFallback', 'externalFallback'],
    classify: ['cheap', 'primary', 'dashFallback', 'externalFallback'],
    intake: ['cheap', 'primary', 'dashFallback', 'externalFallback'],
    intent: ['cheap', 'primary', 'dashFallback', 'externalFallback'],
    openInterview: ['cheap', 'primary', 'dashFallback', 'externalFallback'],
    questionPlanning: ['cheap', 'primary', 'dashFallback', 'externalFallback'],
    supplement: ['cheap', 'primary', 'dashFallback', 'externalFallback'],
    followup: ['cheap', 'primary', 'dashFallback', 'externalFallback'],
    summary: ['primary', 'cheap', 'dashFallback', 'externalFallback'],
    decision: ['primary', 'cheap', 'dashFallback', 'externalFallback'],
    rewrite: ['primary', 'cheap', 'dashFallback', 'externalFallback'],
  };
  const strategy = routeMap[route] || routeMap.default;
  for (const item of strategy) {
    if (item === 'cheap') {
      addChatCandidate(candidates, {
        source: 'dashscope-cheap',
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.textModelCheap,
      });
    }
    if (item === 'primary') {
      addChatCandidate(candidates, {
        source: 'dashscope-primary',
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.textModelPrimary,
      });
    }
    if (item === 'dashFallback') {
      for (let i = 0; i < config.textModelFallbacks.length; i += 1) {
        addChatCandidate(candidates, {
          source: `dashscope-fallback-${i + 1}`,
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.textModelFallbacks[i],
        });
      }
    }
    if (item === 'externalFallback') {
      addChatCandidate(candidates, {
        source: 'external-fallback',
        baseUrl: config.externalFallbackBaseUrl,
        apiKey: config.externalFallbackApiKey,
        model: config.externalFallbackModel,
      });
    }
  }
  return candidates;
}

async function chatCompletions({ model, messages, temperature = 0.2, maxTokens = 800, route = 'default' }) {
  const config = getConfig();
  const candidates = model
    ? [
        {
          source: 'explicit-model',
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model,
        },
      ]
    : buildTextRouteCandidates(config, route);

  if (!candidates.length) {
    throw new Error('No available chat model candidates. Check model/API env settings.');
  }

  const errors = [];
  for (const candidate of candidates) {
    try {
      return await callChatCompletionOnce({
        baseUrl: candidate.baseUrl,
        apiKey: candidate.apiKey,
        model: candidate.model,
        messages,
        temperature,
        maxTokens,
      });
    } catch (error) {
      errors.push(`${candidate.source}:${candidate.model} => ${error.message}`);
    }
  }

  throw new Error(`chat failed after routing attempts: ${errors.join(' | ')}`);
}

async function speechToText(audioBuffer, mimeType = 'audio/webm') {
  const config = getConfig();
  if (!config.apiKey) {
    throw new Error('DASHSCOPE_API_KEY is not configured');
  }

  const normalizedMime = String(mimeType || 'audio/webm').split(';')[0].trim() || 'audio/webm';
  const audioDataUri = `data:${normalizedMime};base64,${audioBuffer.toString('base64')}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.asrModel,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: {
                  data: audioDataUri,
                  format: normalizedMime,
                },
              },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 512,
        stream: false,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('speech-to-text timeout after 30s');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`speech-to-text failed: ${response.status} ${detail}`.trim());
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => item?.text || item?.transcript || item?.output_text || item?.content || '')
      .join('\n')
      .trim();
  }
  return '';
}

function normalizeDashscopeAudioMime(format = 'mp3') {
  const key = String(format || '').toLowerCase();
  if (key === 'wav') return 'audio/wav';
  if (key === 'pcm') return 'audio/pcm';
  if (key === 'opus') return 'audio/opus';
  return 'audio/mpeg';
}

async function synthesizeSpeech(text, options = {}) {
  const config = getConfig();
  const inputText = String(text || '').trim();
  if (!inputText) {
    throw new Error('text is required');
  }

  const provider = resolveTtsProvider(config);
  if (provider === 'tencent') {
    // Tencent TTS will be wired here once provider implementation is added.
    // Until then, keep online traffic on the stable DashScope path.
  }

  if (!config.apiKey) {
    throw new Error('DASHSCOPE_API_KEY is not configured');
  }

  const model = options.model || config.ttsModel;
  const voice = options.voice || config.ttsVoice;
  const format = String(options.format || 'mp3').toLowerCase();
  const sampleRate = Number(options.sampleRate || 24000);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let response;
  try {
    response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: {
          text: inputText,
          voice,
          format,
          sample_rate: sampleRate,
        },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('text-to-speech timeout after 30s');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`text-to-speech failed: ${response.status} ${detail}`.trim());
  }

  const payload = await response.json();
  const audio = payload?.output?.audio || {};
  const mimeType = normalizeDashscopeAudioMime(format);
  if (audio?.data) {
    return {
      buffer: Buffer.from(String(audio.data), 'base64'),
      mimeType,
    };
  }

  if (!audio?.url) {
    throw new Error('text-to-speech returned empty audio');
  }

  const audioResponse = await fetch(audio.url);
  if (!audioResponse.ok) {
    const detail = await audioResponse.text().catch(() => '');
    throw new Error(`text-to-speech audio fetch failed: ${audioResponse.status} ${detail}`.trim());
  }
  const bytes = Buffer.from(await audioResponse.arrayBuffer());
  return {
    buffer: bytes,
    mimeType: audioResponse.headers.get('content-type') || mimeType,
  };
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
    route: 'classify',
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
    route: 'intake',
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

  const ruleIntent = detectTurnIntentByRule(session, userMessage);
  if (ruleIntent) {
    return ruleIntent;
  }

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
    route: 'intent',
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

function detectMedicalDomainText(text = '') {
  const normalized = String(text || '').toLowerCase();
  const domains = [
    ['eye', /(眼睛|眼痛|视力|看不清|模糊|畏光|红眼|流泪|飞蚊)/],
    ['ent', /(鼻塞|流鼻涕|咽痛|喉咙痛|耳鸣|耳痛|声音嘶哑)/],
    ['gyne', /(月经|白带|阴道|妇科|痛经|见红|下腹痛)/],
    ['obstetric', /(怀孕|孕期|胎动|破水|产后|停经)/],
    ['pediatric', /(小孩|孩子|婴儿|宝宝)/],
    ['neuro', /(头痛|眩晕|麻木|说话不清|肢体无力|偏瘫)/],
    ['endocrine', /(血糖|糖尿病|甲状腺|多饮|多尿|消瘦)/],
    ['sleep', /(失眠|睡不着|入睡难|易醒|早醒|睡眠|睡不好)/],
    ['sexual', /(做爱|同房|早泄|勃起|射精|性功能|性欲|性生活)/],
    ['digestive', /(胃|肚子|腹|胀|反酸|烧心|恶心|呕吐|拉肚子|腹泻|便秘|消化)/],
    ['cardio', /(心慌|胸闷|胸痛|心跳|血压|心口)/],
    ['respiratory', /(咳嗽|咳痰|喘|呼吸|鼻塞|流鼻涕|喉咙|咽痛)/],
    ['urinary', /(尿频|尿急|尿痛|小便|排尿|前列腺|尿)/],
    ['neuro', /(头晕|头痛|麻木|乏力|站不稳|眩晕)/],
    ['musculoskeletal', /(腰酸|腰痛|背痛|腿麻|腿痛|关节|扭伤|骨头)/],
    ['skin', /(皮肤|疹子|瘙痒|红肿|伤口|外伤)/],
  ];
  const matched = domains.find(([, pattern]) => pattern.test(normalized));
  return matched ? matched[0] : '';
}

function detectTurnIntentByRule(session, userMessage) {
  const text = String(userMessage || '').trim();
  if (!text) return null;

  if (/(报告|化验单|检查单|检验单|片子|结果单|报告单)/.test(text) && /(发|给你看|帮我看|解读)/.test(text)) {
    return {
      intentType: 'report_notice',
      topicKey: 'report',
      focusLabel: '报告解读',
      reply: '可以，直接把检查报告发给我，我按当前这次咨询一起看。',
      reason: 'rule: report intent',
    };
  }

  if (/(吃什么药|买什么药|推荐.*药|用什么药|怎么吃药|药怎么吃|要不要吃药)/.test(text)) {
    return {
      intentType: 'medication_question',
      topicKey: 'medication',
      focusLabel: '用药顾虑',
      reply: '',
      reason: 'rule: medication intent',
    };
  }

  if (/(挂什么科|去哪家医院|去哪个医院|怎么挂号|挂号|普通号|专家号)/.test(text)) {
    return {
      intentType: 'booking_question',
      topicKey: 'booking',
      focusLabel: '挂号医院',
      reply: '',
      reason: 'rule: booking intent',
    };
  }

  if (/(多少钱|费用|花多少|医保|报销|能报多少)/.test(text)) {
    return {
      intentType: 'cost_question',
      topicKey: 'cost',
      focusLabel: '费用医保',
      reply: '',
      reason: 'rule: cost intent',
    };
  }

  const newIssueHint = /(另一个问题|另外一个问题|换个问题|新的问题|顺便问|再问个|还想问|另外想问)/.test(text);
  const currentDomain = detectMedicalDomainText(`${session?.scenario?.label || ''} ${session?.chiefComplaint || ''}`);
  const nextDomain = detectMedicalDomainText(text);
  if (newIssueHint && nextDomain && currentDomain && nextDomain !== currentDomain) {
    return {
      intentType: 'new_issue',
      topicKey: 'new_issue',
      focusLabel: '新的问题',
      reply: '这更像另一个新问题。我可以继续聊当前这次情况，也可以帮你重新开始新的咨询。',
      reason: 'rule: new issue with domain shift',
    };
  }

  return null;
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
    route: 'rewrite',
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
    route: 'summary',
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
    route: 'decision',
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
    '7. affectsSummary 表示这条新信息是否会让原来的总结更准确。',
    '8. impactLevel 只能是 none、minor、major。',
    '9. 输出 JSON，字段固定：answer、shouldRefreshSummary、affectsSummary、impactLevel。',
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
    route: 'followup',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    maxTokens: 260,
  });

  const parsed = extractJsonObject(raw);
  if (!parsed?.answer) return null;
  return {
    answer: String(parsed.answer || '').trim(),
    shouldRefreshSummary: parsed.shouldRefreshSummary !== false,
    affectsSummary: Boolean(parsed.affectsSummary),
    impactLevel: ['none', 'minor', 'major'].includes(parsed.impactLevel) ? parsed.impactLevel : 'none',
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
    route: 'questionPlanning',
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
    route: 'openInterview',
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
    route: 'supplement',
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

async function interpretMedicalImage(file, label = '补充材料') {
  if (!isConfigured() || !file?.path || !fs.existsSync(file.path) || !isImageFile(file)) {
    return null;
  }

  const mimeType = file.mimetype || detectMimeFromName(file.originalname || 'upload.png');
  const base64 = fs.readFileSync(file.path).toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64}`;
  const prompt = [
    '你是医疗图片分级助手，不做确诊。',
    '请根据图片做通俗分析，重点判断风险等级和下一步建议。',
    '要求：',
    '1. 不能给确定性诊断，只能使用“可能/倾向/不能排除”。',
    '2. riskLevel 只能是 low、medium、high。',
    '3. riskText 用一句人话描述风险。',
    '4. possibleDirections 最多 3 条。',
    '5. advice 最多 4 条，优先给可执行建议。',
    '6. suggestDepartment 最多 2 个科室名。',
    '7. 输出 JSON：title、riskLevel、riskText、possibleDirections、advice、suggestDepartment。',
    `8. 图片类型：${label}`,
    '只返回 JSON。',
  ].join('\n');

  const raw = await chatCompletions({
    model: getConfig().visionModel,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: prompt },
        ],
      },
    ],
    temperature: 0.1,
    maxTokens: 800,
  });

  const parsed = extractJsonObject(raw);
  if (!parsed?.title) return null;
  return {
    title: String(parsed.title || '').trim(),
    riskLevel: String(parsed.riskLevel || '').trim(),
    riskText: String(parsed.riskText || '').trim(),
    possibleDirections: Array.isArray(parsed.possibleDirections) ? parsed.possibleDirections.filter(Boolean).slice(0, 3) : [],
    advice: Array.isArray(parsed.advice) ? parsed.advice.filter(Boolean).slice(0, 4) : [],
    suggestDepartment: Array.isArray(parsed.suggestDepartment) ? parsed.suggestDepartment.filter(Boolean).slice(0, 2) : [],
  };
}

async function analyzeCheckSheet(ocrText, userContext = '') {
  if (!isConfigured() || !ocrText) return null;

  const prompt = [
    '你是医疗费用顾问助手，不做确诊，只帮患者理解检查单。',
    '用户上传了一份医生开出的检查单，OCR 识别结果如下：',
    '---',
    ocrText.slice(0, 2000),
    '---',
    userContext ? `用户补充信息：${userContext}` : '',
    '',
    '请分析每项检查，输出 JSON：',
    '{',
    '  "items": [',
    '    {',
    '      "name": "检查项目名",',
    '      "priceRange": "参考价格区间",',
    '      "priority": "必要|可等|问医生",',
    '      "reason": "一句话说明为什么这个优先级"',
    '    }',
    '  ],',
    '  "script": "建议对医生说的一句话",',
    '  "savingEstimate": "预估可节省金额（如有可等项目）",',
    '  "note": "整体建议（一两句话）"',
    '}',
    '',
    '判断原则：',
    '- 血常规、尿常规等基础化验通常"必要"',
    '- CT/MRI 等大型检查，如果没有基础检查结果支撑，建议"可等"',
    '- 肿瘤标志物等筛查项目，非急症时标记"问医生"',
    '- 价格给常见范围，不确定就写"价格待确认"',
    '只返回 JSON。',
  ].filter(Boolean).join('\n');

  const raw = await chatCompletions({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    maxTokens: 1200,
    route: 'summary',
  });

  const parsed = extractJsonObject(raw);
  if (!parsed?.items) return null;
  return {
    items: Array.isArray(parsed.items) ? parsed.items.slice(0, 15) : [],
    script: String(parsed.script || '').trim(),
    savingEstimate: String(parsed.savingEstimate || '').trim(),
    note: String(parsed.note || '').trim(),
  };
}

async function analyzePrescription(ocrText, userContext = '') {
  if (!isConfigured() || !ocrText) return null;

  const localDrugRefs = findDrugRefsByText(ocrText, 12);
  const localDrugPrompt = localDrugRefs.length
    ? [
        '以下药品命中了本地参考数据，医保类别和价格优先使用这些信息：',
        ...localDrugRefs.map((item) => {
          const identity = [item.genericName, item.form, item.spec].filter(Boolean).join(' ');
          const insuranceText = item.insuranceClass || '不确定';
          const centralizedText = item.isCentralized ? '集采品种' : '非集采/未标记集采';
          const priceText =
            item.priceMin && item.priceMax
              ? `${item.priceMin}~${item.priceMax}元`
              : '价格待确认';
          const scenarioText = item.scenarios?.length ? `；适用场景：${item.scenarios.join('、')}` : '';
          return `- ${identity}：${insuranceText}，${centralizedText}，常见价 ${priceText}${scenarioText}`;
        }),
        '如果某药命中了本地参考数据：insuranceType 和 priceRange 优先以本地参考为准，source 写“本地参考”。',
        '如果没有命中本地参考数据：可以基于常识补充，但 source 必须写“模型参考”，价格不确定时写“价格仅供参考”。',
      ].join('\n')
    : '';

  const prompt = [
    '你是药品信息助手，不做确诊，不替代医生，只帮患者理解处方。',
    '用户上传了一份处方，OCR 识别结果如下：',
    '---',
    ocrText.slice(0, 2000),
    '---',
    userContext ? `用户补充信息：${userContext}` : '',
    localDrugPrompt,
    '',
    '请分析每种药品，输出 JSON：',
    '{',
    '  "medicines": [',
    '    {',
    '      "name": "药品通用名",',
    '      "brandName": "商品名（如能识别）",',
    '      "category": "核心用药|辅助用药|中成药",',
    '      "insuranceType": "甲类|乙类|自费|不确定",',
    '      "priceRange": "参考价格",',
    '      "source": "本地参考|模型参考",',
    '      "necessity": "核心|辅助|证据有限",',
    '      "reason": "一句话说明"',
    '    }',
    '  ],',
    '  "script": "建议问医生的一句话",',
    '  "interactions": "药物相互作用提醒（如有）",',
    '  "note": "整体用药建议（一两句话）"',
    '}',
    '',
    '判断原则：',
    '- 抗生素、降压药等对症核心药标记"核心"',
    '- 辅助用药（如某些中成药注射剂）标记"辅助"',
    '- 临床证据薄弱的标记"证据有限"',
    '- 自费药重点标出',
    '- 永远用"可能""建议"措辞，不说"必须""不能用"',
    '只返回 JSON。',
  ].filter(Boolean).join('\n');

  const raw = await chatCompletions({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    maxTokens: 1200,
    route: 'summary',
  });

  const parsed = extractJsonObject(raw);
  if (!parsed?.medicines) return null;
  const medicines = Array.isArray(parsed.medicines) ? parsed.medicines.slice(0, 15) : [];
  return {
    medicines: applyPrescriptionDrugRefs(medicines, localDrugRefs),
    script: String(parsed.script || '').trim(),
    interactions: String(parsed.interactions || '').trim(),
    note: String(parsed.note || '').trim(),
  };
}

function toDrugPriceRange(priceMin, priceMax) {
  const min = Number(priceMin || 0);
  const max = Number(priceMax || 0);
  if (!min && !max) return '';
  if (min && max) return `${min}~${max}元`;
  return `${min || max}元`;
}

function normalizeDrugToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[（(【\[].*?[)\]】]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
}

function matchDrugRefForMedicine(medicine, localDrugRefs = []) {
  const tokens = [medicine?.name, medicine?.brandName]
    .map((item) => normalizeDrugToken(item))
    .filter(Boolean);
  if (!tokens.length || !localDrugRefs.length) return null;

  let best = null;
  for (const ref of localDrugRefs) {
    const names = [ref.genericName, ...(ref.aliases || [])]
      .map((item) => ({ raw: item, normalized: normalizeDrugToken(item) }))
      .filter((item) => item.normalized);
    const hit = names.find((item) =>
      tokens.some((token) => token.includes(item.normalized) || item.normalized.includes(token))
    );
    if (!hit) continue;
    if (!best || hit.normalized.length > best.length) {
      best = { ref, length: hit.normalized.length };
    }
  }
  return best?.ref || null;
}

function applyPrescriptionDrugRefs(medicines = [], localDrugRefs = []) {
  return medicines.map((medicine) => {
    const matched = matchDrugRefForMedicine(medicine, localDrugRefs);
    if (!matched) {
      const source = String(medicine?.source || '').trim() || '模型参考';
      const priceRange = String(medicine?.priceRange || '').trim() || '价格仅供参考';
      return {
        ...medicine,
        source,
        priceRange,
      };
    }

    const priceRange = toDrugPriceRange(matched.priceMin, matched.priceMax) || String(medicine?.priceRange || '').trim();
    return {
      ...medicine,
      name: medicine?.name || matched.genericName,
      insuranceType: matched.insuranceClass || medicine?.insuranceType || '不确定',
      priceRange: priceRange || '价格待确认',
      source: '本地参考',
      reason: [
        String(medicine?.reason || '').trim(),
        matched.isCentralized ? '本地参考显示为集采品种。' : '',
      ]
        .filter(Boolean)
        .join(' '),
    };
  });
}

async function analyzeReport(file, userContext = '') {
  if (!isConfigured() || !file?.path || !fs.existsSync(file.path) || !isImageFile(file)) {
    return null;
  }

  const mimeType = file.mimetype || detectMimeFromName(file.originalname || 'upload.png');
  const base64 = fs.readFileSync(file.path).toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const prompt = [
    '你是检验报告解读助手，不做确诊，只帮患者看懂报告。',
    userContext ? `用户补充信息：${userContext}` : '',
    '',
    '请分析这份检验报告图片，输出 JSON：',
    '{',
    '  "reportType": "报告类型（如血常规、尿常规、肝功能等）",',
    '  "overallStatus": "大部分正常|部分异常|多项异常",',
    '  "abnormalCount": 异常项目数量,',
    '  "items": [',
    '    {',
    '      "name": "指标名",',
    '      "value": "检测值",',
    '      "unit": "单位",',
    '      "reference": "参考范围",',
    '      "status": "正常|偏高|偏低|异常",',
    '      "explanation": "一句话通俗解释（仅异常项需要）"',
    '    }',
    '  ],',
    '  "summary": "一段话总结（通俗易懂，50字以内）",',
    '  "suggestions": ["建议1", "建议2"],',
    '  "followUpDays": 建议复查天数（0表示无需复查）',
    '}',
    '',
    '要求：',
    '- items 按异常优先排序，正常的放后面',
    '- 异常项必须有 explanation',
    '- 用"可能提示""建议"措辞，不用"确诊""一定"',
    '- 解释用老百姓能听懂的话',
    '只返回 JSON。',
  ].filter(Boolean).join('\n');

  const raw = await chatCompletions({
    model: getConfig().visionModel,
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
    maxTokens: 2000,
  });

  const parsed = extractJsonObject(raw);
  if (!parsed?.items) return null;
  return {
    reportType: String(parsed.reportType || '').trim(),
    overallStatus: String(parsed.overallStatus || '').trim(),
    abnormalCount: Number(parsed.abnormalCount || 0),
    items: Array.isArray(parsed.items) ? parsed.items.slice(0, 30) : [],
    summary: String(parsed.summary || '').trim(),
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.filter(Boolean).slice(0, 5) : [],
    followUpDays: Number(parsed.followUpDays || 0),
  };
}

module.exports = {
  getStatus,
  isConfigured,
  speechToText,
  synthesizeSpeech,
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
  interpretMedicalImage,
  analyzeCheckSheet,
  analyzePrescription,
  analyzeReport,
};
