const QUICK_SYMPTOMS = ['心慌', '胸闷', '头晕', '腰酸', '肚子痛', '咳嗽', '尿频尿急', '皮肤/外伤'];
const INSURANCE_OPTIONS = ['城镇职工医保', '城乡居民医保', '其他商业医保', '无医保'];

const state = {
  sessionId: null,
  currentQuestion: null,
  triageResult: null,
  booking: null,
  cost: null,
  profile: {
    province: '',
    city: '',
    district: '',
    insuranceType: '',
  },
  inputMode: 'symptom',
  awaitingContext: null,
  activeChoiceBlock: null,
  composerMode: 'text',
  speechRecognition: null,
  speechListening: false,
  speechBuffer: '',
  autoLocateTried: false,
  followUpProgress: null,
  generationReady: false,
  supplementCount: 0,
  supplementStats: {
    text: 0,
    image: 0,
    report: 0,
  },
  resultViewMode: 'simple',
  sharedView: false,
  resultAnchor: 'summary',
  savedRegion: null,
  auth: {
    loggedIn: false,
    provider: '',
    userId: '',
    nickname: '',
  },
  recordsMode: 'browse',
};

let botTextQueue = Promise.resolve();
let pendingAfterLogin = null;
const AUTH_STORAGE_KEY = 'guashake-auth-v1';
const REGION_STORAGE_KEY = 'guashake-last-region-v1';

const $ = (id) => document.getElementById(id);

const ICONS = {
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a3 3 0 0 1 3 3v5a3 3 0 1 1-6 0V7a3 3 0 0 1 3-3Z"></path><path d="M19 11a7 7 0 0 1-14 0"></path><path d="M12 18v3"></path><path d="M8 21h8"></path></svg>',
  keyboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"></rect><path d="M7 10h.01M11 10h.01M15 10h.01M17 10h.01M7 14h.01M10 14h.01M13 14h4"></path></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>',
};

const QUICK_SYMPTOM_ICONS = {
  心慌: 'heartbeat',
  胸闷: 'chest',
  头晕: 'head',
  腰酸: 'waist',
  肚子痛: 'stomach',
  咳嗽: 'lung',
  尿频尿急: 'drop',
  '皮肤/外伤': 'bandage',
};

const RESULT_CARD_ICONS = {
  '第一步检查': 'clipboard',
  '费用与医保': 'wallet',
  '去医院前带什么': 'bag',
  '风险提醒': 'alert',
  '为什么这样建议': 'spark',
  '材料基础摘要': 'scan',
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRegionValid(region) {
  return Boolean(region && region.province && region.city && region.district);
}

function loadSavedRegion() {
  try {
    const raw = localStorage.getItem(REGION_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (isRegionValid(parsed)) {
      state.savedRegion = parsed;
    }
  } catch (_error) {
  }
}

function persistRegion(region) {
  if (!isRegionValid(region)) return;
  state.savedRegion = {
    province: region.province,
    city: region.city,
    district: region.district,
  };
  localStorage.setItem(REGION_STORAGE_KEY, JSON.stringify(state.savedRegion));
}

function createDemoWechatAuth() {
  const randomPart =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return {
    loggedIn: true,
    provider: 'wechat',
    userId: `wx_demo_${randomPart}`,
    nickname: '微信用户',
  };
}

function loadAuthState() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.loggedIn && parsed.userId) {
      state.auth = {
        loggedIn: true,
        provider: parsed.provider || 'wechat',
        userId: parsed.userId,
        nickname: parsed.nickname || '微信用户',
      };
    }
  } catch (_error) {
  }
}

function saveAuthState() {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(state.auth));
}

function getAuthDisplayName() {
  if (!state.auth.loggedIn) return '未登录';
  return `${state.auth.nickname || '微信用户'} · ${state.auth.userId}`;
}

function syncAuthUi() {
  if ($('recordsLoginState')) {
    $('recordsLoginState').textContent = getAuthDisplayName();
  }
  if ($('recordsLoginBtn')) {
    $('recordsLoginBtn').textContent = state.auth.loggedIn ? '已登录' : '微信登录';
    $('recordsLoginBtn').disabled = state.auth.loggedIn;
  }
}

async function performWechatLogin() {
  await wait(180);
  state.auth = createDemoWechatAuth();
  saveAuthState();
  syncAuthUi();
  $('loginDialog').close();
  await addBotText('微信登录已完成。后面保存记录和调用历史记录都会用这个账号。');
  if (typeof pendingAfterLogin === 'function') {
    const next = pendingAfterLogin;
    pendingAfterLogin = null;
    await next();
  }
}

async function requireLogin(nextAction) {
  if (state.auth.loggedIn) {
    return true;
  }
  pendingAfterLogin = nextAction || null;
  syncAuthUi();
  $('loginDialog').showModal();
  return false;
}

async function api(url, options = {}) {
  const config = { ...options };

  if (!(config.body instanceof FormData)) {
    config.headers = { 'Content-Type': 'application/json', ...(config.headers || {}) };
  }

  const res = await fetch(url, config);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '请求失败');
  }
  return res.json();
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    $('chatViewport').scrollTop = $('chatViewport').scrollHeight;
  });
}

function addRow(role, html, extraClass = '') {
  const row = document.createElement('div');
  row.className = `msg-row ${role}`;
  row.innerHTML = `<div class="bubble ${extraClass}">${html}</div>`;
  $('chatFeed').appendChild(row);
  scrollToBottom();
  return row;
}

function addTypingBubble() {
  return addRow(
    'bot',
    '<div class="typing-indicator" aria-label="小科正在输入"><span></span><span></span><span></span></div>',
    'typing-shell'
  );
}

async function typeTextInto(node, text) {
  const chars = Array.from(String(text || ''));
  node.textContent = '';

  for (let i = 0; i < chars.length; i += 1) {
    node.textContent += chars[i];
    if (i < chars.length - 1) {
      await wait(/[，。！？；：,.!?]/.test(chars[i]) ? 50 : 18);
    }
  }
}

async function addBotText(text) {
  botTextQueue = botTextQueue.then(async () => {
    const row = addRow('bot', '<p></p>');
    const p = row.querySelector('p');
    row.classList.add('is-typing');
    await wait(180);
    await typeTextInto(p, text);
    row.classList.remove('is-typing');
    return row;
  });

  return botTextQueue;
}

function addStatusPill(text) {
  return addRow('bot', `<div class="status-pill">${escapeHtml(text)}</div>`, 'status-shell');
}

function getSupplementStatusText() {
  const items = [];

  if (state.supplementStats.text > 0) items.push(`文字 ${state.supplementStats.text} 条`);
  if (state.supplementStats.image > 0) items.push(`图片 ${state.supplementStats.image} 张`);
  if (state.supplementStats.report > 0) items.push(`报告 ${state.supplementStats.report} 份`);

  if (!items.length) {
    return '还没有补充额外信息';
  }

  return `已补充 ${items.join(' · ')}`;
}

function addUserText(text) {
  return addRow('user', `<p>${escapeHtml(text)}</p>`);
}

function disableChoiceBlock(node) {
  if (!node) return;
  node.querySelectorAll('button').forEach((button) => {
    button.disabled = true;
  });
}

function clearActiveChoiceBlock() {
  disableChoiceBlock(state.activeChoiceBlock);
  state.activeChoiceBlock = null;
}

function addChoiceBlock(title, options, onPick, note = '', meta = '', progressRatio = 0) {
  clearActiveChoiceBlock();

  const row = addRow('bot', '', 'choice-card');
  const bubble = row.querySelector('.bubble');

  const titleHtml = `<p>${escapeHtml(title)}</p>`;
  const noteHtml = note ? `<div class="choice-note">${escapeHtml(note)}</div>` : '';
  const metaHtml = meta ? `<div class="choice-meta">${escapeHtml(meta)}</div>` : '';
  const progressHtml =
    progressRatio > 0
      ? `<div class="choice-progress"><span class="choice-progress-track"><span class="choice-progress-fill" style="width:${Math.max(
          6,
          Math.min(100, progressRatio)
        )}%"></span></span></div>`
      : '';
  bubble.innerHTML = `<div class="choice-head">${metaHtml}${progressHtml}${titleHtml}${noteHtml}</div><div class="choice-grid"></div>`;

  const grid = bubble.querySelector('.choice-grid');
  options.forEach((option) => {
    const button = document.createElement('button');
    button.className = 'choice-btn';
    button.dataset.kind = option.type || 'answer';
    button.textContent = option.label;
    button.onclick = async () => {
      clearActiveChoiceBlock();
      addUserText(option.label);
      await onPick(option);
    };
    grid.appendChild(button);
  });

  state.activeChoiceBlock = bubble;
  scrollToBottom();
}

async function revealChoiceBlock(title, options, onPick, note = '', meta = '', progressRatio = 0) {
  const typingRow = addTypingBubble();
  await wait(360);
  typingRow.remove();
  scrollToBottom();
  return addChoiceBlock(title, options, onPick, note, meta, progressRatio);
}

function addIntroCard() {
  const row = addRow(
    'bot',
    [
      '<div class="intro-card-inner">',
      '<p class="intro-copy"><strong class="intro-accent">我是小科</strong>，帮您了解去哪个医院、挂哪个科室，预估看病费用和医保报销，还能解读检查报告。只需告诉我哪里不舒服，或者发送您的检查报告，我能为您提供详细解答。</p>',
      '</div>',
    ].join(''),
    'intro-card'
  );
  return row;
}

function renderQuickSymptoms() {
  const row = $('quickRow');
  row.innerHTML = '';
  row.classList.remove('hidden');

  QUICK_SYMPTOMS.forEach((symptom) => {
    const button = document.createElement('button');
    button.className = 'quick-chip';
    const iconName = QUICK_SYMPTOM_ICONS[symptom] || 'spark';
    button.innerHTML = `<span class="quick-chip-icon">${getInlineIcon(iconName)}</span><span>${escapeHtml(symptom)}</span>`;
    button.onclick = () => submitText(symptom).catch((err) => alert(err.message));
    row.appendChild(button);
  });
}

function getInlineIcon(name) {
  const icons = {
    heartbeat:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2-4 3 8 2-4h7"></path></svg>',
    chest:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6c0-1.1.9-2 2-2h6c1.1 0 2 .9 2 2v12H7z"></path><path d="M10 8h4M10 12h4"></path></svg>',
    head:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a6 6 0 0 1 6 6c0 2.6-1.4 4.1-2.5 5.1-.7.7-1.1 1.1-1.1 1.9H9.6c0-.8-.4-1.2-1.1-1.9C7.4 14.1 6 12.6 6 10a6 6 0 0 1 6-6Z"></path><path d="M10 20h4"></path></svg>',
    waist:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6c1.6 1.5 2 3 2 5s-.4 3.5-2 5"></path><path d="M17 6c-1.6 1.5-2 3-2 5s.4 3.5 2 5"></path><path d="M9 11h6"></path></svg>',
    stomach:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4c0 2 .5 3 2 4 1.8 1.2 4 2.3 4 5.5A4.5 4.5 0 0 1 11.5 18c-2.8 0-4.5-1.7-4.5-4.3 0-2.4 1.4-3.8 2.5-4.9.9-.9 1.5-1.6 1.5-3.8Z"></path></svg>',
    lung:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4v7c0 1.4-1.1 2.5-2.5 2.5S6 12.4 6 11V8c0-1.7 1-3.2 2.6-3.8L11 4Z"></path><path d="M13 4v7c0 1.4 1.1 2.5 2.5 2.5S18 12.4 18 11V8c0-1.7-1-3.2-2.6-3.8L13 4Z"></path></svg>',
    drop:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4s5 5 5 8.5A5 5 0 1 1 7 12.5C7 9 12 4 12 4Z"></path></svg>',
    bandage:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6 18 16"></path><path d="M6 8 16 18"></path><rect x="4" y="9" width="16" height="6" rx="2" transform="rotate(-45 12 12)"></rect></svg>',
    clipboard:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6v3H9z"></path><path d="M7 7h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"></path><path d="M9 12h6M9 16h4"></path></svg>',
    wallet:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"></path><path d="M16 13h5"></path><path d="M6 7V6a2 2 0 0 1 2-2h9"></path></svg>',
    bag:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9h12l-1 10H7z"></path><path d="M9 9V7a3 3 0 1 1 6 0v2"></path></svg>',
    alert:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 3 20h18L12 4Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>',
    spark:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z"></path></svg>',
    scan:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4H5a2 2 0 0 0-2 2v2"></path><path d="M17 4h2a2 2 0 0 1 2 2v2"></path><path d="M7 20H5a2 2 0 0 1-2-2v-2"></path><path d="M17 20h2a2 2 0 0 0 2-2v-2"></path><path d="M8 12h8"></path></svg>',
  };
  return icons[name] || icons.spark;
}

function getQuestionReason(question) {
  const text = String(question?.text || '');

  if (/胸痛|压榨感|喘不上气|发烧|带血|化脓|红肿热痛/.test(text)) {
    return '这题主要用来判断紧急程度。';
  }
  if (/持续多久|频繁|次数|多久了/.test(text)) {
    return '这题主要用来判断是短期问题还是反复问题。';
  }
  if (/以前有|病史|哮喘史|高血压|心脏病/.test(text)) {
    return '这题主要用来判断既往基础病会不会影响现在的建议。';
  }
  if (/吃饭|大便|尿里带血|起夜|活动后|晚上/.test(text)) {
    return '这题主要用来判断症状更像哪一类问题。';
  }

  return '这题主要用来把就医方向问得更准一点。';
}

async function askQuestion(question, note = '') {
  state.currentQuestion = question;
  const progress = state.followUpProgress
    ? `第 ${state.followUpProgress.current} / ${state.followUpProgress.total} 步`
    : '一步一步来';
  const progressRatio = state.followUpProgress
    ? (state.followUpProgress.current / state.followUpProgress.total) * 100
    : 0;
  const reason = getQuestionReason(question);
  const mergedNotes = [reason, note].filter(Boolean);
  const finalNote = [...new Set(mergedNotes)].join(' ');
  await revealChoiceBlock(
    question.text,
    question.options.map((label) => ({ label, type: 'answer' })),
    async (option) => {
      await answerQuestion(option.label);
    },
    finalNote,
    progress,
    progressRatio
  );
  setComposerState('locked');
}

function setComposerState(mode) {
  state.inputMode = mode;
  $('composerInput').placeholder = '';
}

function setComposerMode(mode) {
  state.composerMode = mode;
  const isVoice = mode === 'voice';

  $('composerInput').classList.toggle('hidden', isVoice);
  $('voiceCaptureBtn').classList.toggle('hidden', !isVoice);
  $('sendBtn').classList.toggle('hidden', isVoice);
  $('modeToggleBtn').innerHTML = isVoice ? ICONS.keyboard : ICONS.mic;
  $('plusBtn').innerHTML = ICONS.plus;
  syncVoiceButton();
  if (!isVoice) setComposerState(state.inputMode);
}

function resetConversation() {
  if (state.sharedView) return;
  document.querySelector('.composer-wrap').classList.remove('hidden');
  state.sessionId = null;
  state.currentQuestion = null;
  state.triageResult = null;
  state.booking = null;
  state.cost = null;
  state.awaitingContext = null;
  state.activeChoiceBlock = null;
  state.autoLocateTried = false;
  state.speechListening = false;
  state.speechBuffer = '';
  state.followUpProgress = null;
  state.generationReady = false;
  state.supplementCount = 0;
  state.supplementStats = {
    text: 0,
    image: 0,
    report: 0,
  };
  state.resultViewMode = 'simple';
  state.sharedView = false;
  state.resultAnchor = 'summary';
  state.profile = {
    province: '',
    city: '',
    district: '',
    insuranceType: '',
  };

  $('chatFeed').innerHTML = '';
  $('composerInput').value = '';
  $('plusMenu').classList.add('hidden');
  setComposerMode('text');
  addIntroCard();
  renderQuickSymptoms();
  setComposerState('symptom');
}

function updateRecordsDialogCopy() {
  syncAuthUi();
  const browseMode = state.recordsMode !== 'context';
  $('recordsSubcopy').textContent = browseMode
    ? '这里会保存你之前的总结、材料和导出记录。'
    : '选择一条之前保存的记录，发到当前对话里，作为这次咨询的补充上下文。';
  $('listRecordsBtn').textContent = browseMode ? '刷新列表' : '刷新记录';
}

async function openRecordsDialog(mode = 'browse') {
  if (!(await requireLogin(() => openRecordsDialog(mode)))) {
    return;
  }
  state.recordsMode = mode;
  updateRecordsDialogCopy();
  $('recordsDialog').showModal();
  await listRecords();
}

async function startSymptomSession(symptomText) {
  const payload = { chiefComplaint: symptomText };
  const data = await api('/triage/session', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  state.sessionId = data.sessionId;
  state.currentQuestion = null;
  state.followUpProgress = data.progress || null;
  $('quickRow').classList.add('hidden');

  await addBotText(`先按“${data.scenario}”方向帮你判断。`);
  await askQuestion(data.nextQuestion, data.followUpMeta?.reason || '');
}

async function submitText(text) {
  const value = String(text || '').trim();
  if (!value) return;

  if (state.awaitingContext === 'region') {
    addUserText(value);
    await handleRegionInput(value);
    return;
  }

  if (state.awaitingContext === 'supplement') {
    addUserText(value);
    const data = await api('/triage/supplement', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: state.sessionId,
        supplement: value,
      }),
    });
    state.supplementStats.text += 1;
    state.supplementCount = data.supplements.length;
    state.awaitingContext = null;
    addStatusPill(getSupplementStatusText());
    if (data.insight?.summary) {
      await addBotText(`我补充理解到：${data.insight.summary}`);
    }
    if (Array.isArray(data.insight?.normalizedFacts) && data.insight.normalizedFacts.length) {
      await addBotText(`我先记下这些重点：${data.insight.normalizedFacts.join('；')}`);
    }
    await addBotText('补充信息我记下了。现在可以生成总结了。');
    await showGenerationConfirmCard('如果你还有别的信息，也可以继续补充一条。补充越完整，结果越准确。');
    return;
  }

  if (!state.sessionId) {
    addUserText(value);
    await startSymptomSession(value);
    return;
  }

  if (state.currentQuestion) {
    addBotText('这个问题直接点下面的选项就行。');
    return;
  }

  addBotText('如果你要重新开始，点结果卡里的“重新咨询”。');
}

async function answerQuestion(answer) {
  const data = await api('/triage/answer', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: state.sessionId,
      questionId: state.currentQuestion.id,
      answer,
    }),
  });

  if (data.done) {
    state.triageResult = data.triageResult;
    state.followUpProgress = null;
    state.generationReady = false;
    await ensureContextAndRenderResult();
    return;
  }

  if (data.needsConfirmation) {
    state.currentQuestion = null;
    state.followUpProgress = data.progress || null;
    state.generationReady = true;
    await showGenerationConfirmCard();
    return;
  }

  state.followUpProgress = data.progress || null;
  await askQuestion(data.nextQuestion, data.followUpMeta?.reason || '');
}

async function directResult() {
  const data = await api(`/triage/result/${encodeURIComponent(state.sessionId)}`);
  state.triageResult = data;
  state.followUpProgress = null;
  state.generationReady = false;
  await ensureContextAndRenderResult();
}

async function showGenerationConfirmCard(note = '如果您能补充上面没有问到的信息、或者提供图片，结果会更准确。') {
  clearActiveChoiceBlock();
  const total = state.followUpProgress?.total || 0;
  const meta = total ? `第 ${total} / ${total} 步` : '准备生成';
  await revealChoiceBlock(
    '现在可以生成总结了',
    [
      { label: '直接生成', type: 'generate' },
      { label: '补充信息', type: 'supplement' },
    ],
    async (option) => {
      if (option.type === 'generate') {
        await directResult();
        return;
      }
      state.awaitingContext = 'supplement';
      setComposerState('supplement');
      await addBotText('你可以补充上面没有问到的信息，也可以通过下方加号发送图片。');
      $('composerInput').focus();
    },
    note,
    meta,
    total ? 100 : 0
  );
}

async function ensureContextAndRenderResult() {
  state.currentQuestion = null;
  clearActiveChoiceBlock();
  await renderResultCards();
}

async function updateSessionProfile(patch) {
  const data = await api('/triage/profile', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: state.sessionId,
      ...patch,
    }),
  });
  state.profile = {
    ...state.profile,
    ...(data.profile || {}),
  };
  return state.profile;
}

async function handleRegionInput(text) {
  const data = await api(`/api/region/search?q=${encodeURIComponent(text)}`);

  if (!data.regions || data.regions.length === 0) {
    addBotText('我没匹配到这个地区。你可以换成更完整一点的写法，比如“隆回县”或“邵阳市隆回县”。');
    return;
  }

  if (data.regions.length === 1) {
    await selectRegion(data.regions[0]);
    return;
  }

  await addBotText('我匹配到了几个可能的地区，你点一个。');
  await revealChoiceBlock(
    '选择地区',
    data.regions.slice(0, 6).map((region) => ({
      label: `${region.district} · ${region.city} · ${region.province}`,
      region,
    })),
    async ({ region }) => {
      await selectRegion(region);
    }
  );
}

function formatRegion(region) {
  const city = region.city === '市辖区' || region.city === region.province ? '' : region.city;
  return `${region.province}${city}${region.district}`;
}

async function promptManualRegionEntry(copy = '你直接输入县、区或市名就行，我会自动补全。') {
  state.awaitingContext = 'region';
  setComposerState('region');
  await addBotText(copy);
  $('composerInput').focus();
}

async function detectCurrentRegion() {
  if (!navigator.geolocation) {
    return null;
  }

  const position = await new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (result) => resolve(result),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  });

  if (!position) {
    return null;
  }

  const { latitude, longitude } = position.coords;
  const data = await api(`/api/region/reverse?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`);
  return data.region || null;
}

async function promptRegionConfirmation(forceRetry = false) {
  const sessionRegion = isRegionValid(state.profile) ? state.profile : null;
  const cachedRegion = isRegionValid(state.savedRegion) ? state.savedRegion : null;

  if (!forceRetry && sessionRegion) {
    await revealChoiceBlock(
      '这次继续用这个地区吗',
      [
        { label: `继续用 ${formatRegion(sessionRegion)}`, type: 'current', region: sessionRegion },
        { label: '更改地址', type: 'manual' },
      ],
      async (option) => {
        if (option.type === 'current') {
          await selectRegion(option.region);
          return;
        }
        await promptManualRegionEntry();
      },
      '这样可以少输一次地址。'
    );
    return;
  }

  if (!forceRetry && cachedRegion && !state.autoLocateTried) {
    await revealChoiceBlock(
      '先用哪个地区',
      [
        { label: `用上次地区 ${formatRegion(cachedRegion)}`, type: 'cached', region: cachedRegion },
        { label: '自动获取地区', type: 'locate' },
        { label: '手动输入地区', type: 'manual' },
      ],
      async (option) => {
        if (option.type === 'cached') {
          await selectRegion(option.region);
          return;
        }
        if (option.type === 'locate') {
          await promptRegionConfirmation(true);
          return;
        }
        await promptManualRegionEntry();
      },
      '如果你看病常在同一个地方，这样会更快。'
    );
    return;
  }

  if (!forceRetry && state.autoLocateTried) {
    await promptManualRegionEntry('为了给你推荐就近医院和费用范围，你可以确认一下地区，或者手动改。');
    return;
  }

  state.autoLocateTried = true;
  await addBotText('我先按你现在的位置补一个地区，你确认一下。');

  try {
    const region = await detectCurrentRegion();
    if (!region) {
      if (cachedRegion) {
        await revealChoiceBlock(
          '这次定位没拿准，先用哪个地区',
          [
            { label: `用上次地区 ${formatRegion(cachedRegion)}`, type: 'cached', region: cachedRegion },
            { label: '手动输入地区', type: 'manual' },
          ],
          async (option) => {
            if (option.type === 'cached') {
              await selectRegion(option.region);
              return;
            }
            await promptManualRegionEntry();
          },
          '自动定位在微信里有时不稳定，我先把上次地区给你。'
        );
        return;
      }
      await promptManualRegionEntry('我这次没拿到准确地区。你可以直接改成县、区或市名。');
      return;
    }

    await revealChoiceBlock(
      '这是你现在的地区吗',
      [
        { label: `确认 ${formatRegion(region)}`, type: 'confirm', region },
        { label: '更改地址', type: 'change' },
      ],
      async (option) => {
        if (option.type === 'confirm') {
          await selectRegion(option.region);
          return;
        }
        await promptManualRegionEntry();
      },
      '如果定位不准，你再改。'
    );
  } catch (_error) {
    if (cachedRegion) {
      await revealChoiceBlock(
        '定位没有成功，先用哪个地区',
        [
          { label: `用上次地区 ${formatRegion(cachedRegion)}`, type: 'cached', region: cachedRegion },
          { label: '手动输入地区', type: 'manual' },
        ],
        async (option) => {
          if (option.type === 'cached') {
            await selectRegion(option.region);
            return;
          }
          await promptManualRegionEntry();
        },
        '你也可以直接改成新的县、区或市名。'
      );
      return;
    }
    await promptManualRegionEntry('定位没有成功。你可以直接输入县、区或市名。');
  }
}

async function selectRegion(region) {
  state.resultViewMode = 'full';
  state.resultAnchor = 'booking';
  persistRegion(region);
  await updateSessionProfile({
    province: region.province,
    city: region.city,
    district: region.district,
  });
  state.awaitingContext = null;
  await addBotText(`地区已确认：${formatRegion(region)}`);
  setComposerState('symptom');
  await ensureContextAndRenderResult();
}

function buildResultCard(title, contentHtml, extraClass = '') {
  const iconName = RESULT_CARD_ICONS[title] || 'spark';
  return markResultRow(addRow(
    'bot',
    `<div class="result-card ${extraClass}"><div class="result-card-head"><span class="result-card-icon">${getInlineIcon(
      iconName
    )}</span><h3>${escapeHtml(title)}</h3></div>${contentHtml}</div>`
  ));
}

function buildCollapsibleResultCard(title, preview, contentHtml, extraClass = '') {
  const iconName = RESULT_CARD_ICONS[title] || 'spark';
  return markResultRow(addRow(
    'bot',
    [
      `<details class="result-collapse ${extraClass}">`,
      `<summary class="result-collapse-summary"><span class="result-collapse-head"><span class="result-card-icon">${getInlineIcon(
        iconName
      )}</span><span class="result-collapse-title">${escapeHtml(title)}</span></span><span class="result-collapse-preview">${escapeHtml(
        preview
      )}</span></summary>`,
      `<div class="result-card collapse-inner ${extraClass}">${contentHtml}</div>`,
      '</details>',
    ].join('')
  ));
}

function setResultViewMode(mode) {
  state.resultViewMode = mode;
  document.querySelectorAll('[data-result-view]').forEach((node) => {
    const isDetail = node.dataset.resultView === 'full';
    node.classList.toggle('hidden', mode === 'simple' && isDetail);
  });
  document.querySelectorAll('[data-mode-toggle]').forEach((button) => {
    button.classList.toggle('active', button.dataset.modeToggle === mode);
  });
}

function clearResultRows() {
  document.querySelectorAll('[data-result-block="true"]').forEach((node) => node.remove());
}

function markResultRow(row) {
  row.dataset.resultBlock = 'true';
  return row;
}

function buildReportSummaryCard(summary, filePath = '') {
  const highlights = (summary.highlights || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const ocrBadge = summary.ocrMode === 'webhook' ? 'OCR 已识别' : '基础摘要';
  const metrics = (summary.keyMetrics || [])
    .map((item) => `<span class="record-chip metric-chip">${escapeHtml(item)}</span>`)
    .join('');
  return addRow(
    'bot',
    [
      '<div class="result-card report-summary-card">',
      `<div class="result-card-head"><span class="result-card-icon">${getInlineIcon('scan')}</span><h3>材料基础摘要</h3></div>`,
      `<div class="report-summary-meta"><span class="record-tag">${escapeHtml(ocrBadge)}</span><span class="record-tag subtle">${escapeHtml(
        summary.kind || '补充材料'
      )}</span></div>`,
      `<p class="report-summary-title">${escapeHtml(summary.title || '补充材料')}</p>`,
      `<p>文件：${escapeHtml(summary.fileName || '-')} · ${escapeHtml(summary.sizeText || '-')}</p>`,
      `<p>建议先重点看：${escapeHtml((summary.highlights || []).join('、'))}</p>`,
      metrics ? `<div class="report-metrics">${metrics}</div>` : '',
      `<p>${escapeHtml(summary.nextStep || '')}</p>`,
      summary.ocrText ? `<p class="report-ocr-snippet">识别到的文字：${escapeHtml(summary.ocrText)}</p>` : '',
      `<p class="report-summary-note">${escapeHtml(summary.disclaimer || '')}</p>`,
      filePath ? `<a class="record-action report-link" target="_blank" href="${escapeHtml(filePath)}">打开这份材料</a>` : '',
      highlights ? `<ul>${highlights}</ul>` : '',
      '</div>',
    ].join('')
  );
}

function buildBookingCard(booking, prepItems) {
  const hospitals = (booking.hospitals || []).slice(0, 5);
  const primaryHospitals = hospitals.slice(0, 2);
  const extraHospitals = hospitals.slice(2);
  const cachedRegion = isRegionValid(state.savedRegion) ? state.savedRegion : null;
  const hospitalCardHtml = (hospital) =>
    [
      '<div class="booking-hospital-item">',
      `<div class="booking-hospital-top"><div><p class="booking-hospital-name">${escapeHtml(hospital.name)}</p><p class="booking-hospital-meta">${escapeHtml(
        `${hospital.level} · 建议挂 ${hospital.department}`
      )}</p></div><div class="booking-hospital-actions"><button class="record-action" data-copy-hospital="${escapeHtml(
        hospital.name
      )}">复制医院名</button><button class="record-action" data-copy-wechat="${escapeHtml(hospital.wechatName)}">复制公众号名</button></div></div>`,
      `<p class="booking-hospital-note">${escapeHtml(hospital.recommendation)}</p>`,
      `<p class="booking-hospital-search">${escapeHtml(hospital.wechatKeyword)}</p>`,
      `<p class="booking-hospital-channel">挂号方式：${escapeHtml(hospital.channel)}</p>`,
      '</div>',
    ].join('');
  const html = booking.requiresRegion
    ? [
        '<div class="result-card booking-card">',
        `<div class="result-card-head"><span class="result-card-icon">${getInlineIcon('bag')}</span><h3>挂号建议</h3></div>`,
        '<p>先看完上面的总结。如果你想看更贴近你所在地区的医院，再确认一下地区。</p>',
        cachedRegion ? `<p class="booking-cache-tip">上次用过的地区：${escapeHtml(formatRegion(cachedRegion))}</p>` : '',
        '<div class="booking-actions">',
        cachedRegion ? '<button class="result-action" data-booking-action="recent">用上次地区</button>' : '',
        '<button class="result-action primary" data-booking-action="locate">自动获取地区</button>',
        '<button class="result-action" data-booking-action="manual">手动输入地区</button>',
        '</div>',
        '</div>',
      ].join('')
    : [
        '<div class="result-card booking-card">',
        `<div class="result-card-head"><span class="result-card-icon">${getInlineIcon('bag')}</span><h3>挂号建议</h3></div>`,
        `<p class="booking-region">当前地区：${escapeHtml(booking.confirmedRegion || '未确认')}</p>`,
        '<div class="booking-hospital-list">',
        ...primaryHospitals.map(hospitalCardHtml),
        extraHospitals.length
          ? [
              '<details class="booking-more">',
              `<summary class="booking-more-summary">更多医院（${extraHospitals.length} 家）</summary>`,
              '<div class="booking-more-list">',
              ...extraHospitals.map(hospitalCardHtml),
              '</div>',
              '</details>',
            ].join('')
          : '',
        '</div>',
        '<div class="booking-foot">',
        '<button class="result-action" data-booking-action="manual">更换地区</button>',
        '</div>',
        `<div class="detail-section"><h4>去医院前带什么</h4><ul>${prepItems}</ul></div>`,
        '</div>',
      ].join('');

  const row = markResultRow(addRow('bot', html));
  row.querySelectorAll('[data-booking-action="locate"]').forEach((button) => {
    button.onclick = async () => {
      state.resultViewMode = 'full';
      state.resultAnchor = 'booking';
      state.awaitingContext = null;
      await promptRegionConfirmation(true);
    };
  });
  row.querySelectorAll('[data-booking-action="recent"]').forEach((button) => {
    button.onclick = async () => {
      if (!cachedRegion) return;
      state.resultViewMode = 'full';
      state.resultAnchor = 'booking';
      await selectRegion(cachedRegion);
    };
  });
  row.querySelectorAll('[data-booking-action="manual"]').forEach((button) => {
    button.onclick = async () => {
      state.resultViewMode = 'full';
      state.resultAnchor = 'booking';
      state.awaitingContext = 'region';
      await addBotText('你直接输入县、区或市名就行，我会自动补全。');
      setComposerState('region');
      $('composerInput').focus();
    };
  });
  row.querySelectorAll('[data-copy-wechat]').forEach((button) => {
    button.onclick = async () => {
      const value = button.dataset.copyWechat;
      try {
        await navigator.clipboard.writeText(value);
        await addBotText(`公众号名已复制：${value}`);
      } catch (_error) {
        await addBotText(`你在微信里搜索：${value}`);
      }
    };
  });
  row.querySelectorAll('[data-copy-hospital]').forEach((button) => {
    button.onclick = async () => {
      const value = button.dataset.copyHospital;
      try {
        await navigator.clipboard.writeText(value);
        await addBotText(`医院名已复制：${value}`);
      } catch (_error) {
        await addBotText(`你在微信里搜索医院名：${value}`);
      }
    };
  });
  return row;
}

async function shareCurrentSummary() {
  if (!state.sessionId || !state.triageResult) return;
  const url = `${window.location.origin}${window.location.pathname}?session=${encodeURIComponent(state.sessionId)}&shared=1`;
  const title = `挂啥科总结：${state.triageResult.layeredOutput.core.suggestDepartment}`;
  const text = state.triageResult.layeredOutput.core.text;

  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (_error) {
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    await addBotText('总结链接已经复制好了，直接发给家属就行。');
  } catch (_error) {
    await addBotText(`把这个链接发给家属就行：${url}`);
  }
}

function buildCheckListHtml(items = []) {
  return [
    '<div class="result-list">',
    ...items.map(
      (item) =>
        `<div class="result-list-item"><div><p class="result-item-title">${escapeHtml(item.name)}</p><p class="result-item-sub">先做基础检查，避免一开始做太多贵检查</p></div><strong>${escapeHtml(
          `${item.min}~${item.max}元`
        )}</strong></div>`
    ),
    '</div>',
  ].join('');
}

function buildInsuranceSelectorHtml(selected) {
  return [
    '<div class="insurance-selector">',
    '<p class="insurance-label">选择医保类型后，费用和报销说明会更贴近你。</p>',
    '<div class="insurance-grid">',
    ...INSURANCE_OPTIONS.map(
      (label) =>
        `<button class="insurance-btn ${selected === label ? 'active' : ''}" data-insurance-option="${escapeHtml(label)}">${escapeHtml(label)}</button>`
    ),
    '</div>',
    '</div>',
  ].join('');
}

function buildCostHtml(cost, insuranceType) {
  return [
    '<div class="result-kv-grid">',
    `<div class="result-kv"><span>大概先花</span><strong>${escapeHtml(cost.simple.costRange)}</strong></div>`,
    `<div class="result-kv"><span>医保参考</span><strong>${escapeHtml(cost.simple.insuranceCoverage)}</strong></div>`,
    `<div class="result-kv full"><span>更划算建议</span><strong>${escapeHtml(cost.simple.costEffectivePlan)}</strong></div>`,
    `<div class="result-kv full"><span>补充说明</span><strong>${escapeHtml(cost.expanded.insuranceGuide)}</strong></div>`,
    '</div>',
    insuranceType ? `<div class="selected-insurance"><span class="record-tag">${escapeHtml(insuranceType)}</span></div>` : '',
    buildInsuranceSelectorHtml(insuranceType),
  ].join('');
}

function attachInsuranceActions(row) {
  row.querySelectorAll('[data-insurance-option]').forEach((button) => {
    button.onclick = async () => {
      state.resultViewMode = 'simple';
      state.resultAnchor = 'summary';
      await updateSessionProfile({ insuranceType: button.dataset.insuranceOption });
      state.awaitingContext = null;
      setComposerState('symptom');
      await renderResultCards();
    };
  });
}

async function renderResultCards() {
  clearResultRows();
  const [cost, booking] = await Promise.all([
    api('/cost/estimate', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: state.sessionId,
      }),
    }),
    api(`/booking/options?sessionId=${encodeURIComponent(state.sessionId)}`),
  ]);

  state.cost = cost;
  state.booking = booking;
  setComposerState('symptom');

  const triage = state.triageResult.layeredOutput;
  const firstChecks = buildCheckListHtml(triage.core.firstChecks || []);
  const costItems = buildCostHtml(cost, state.profile.insuranceType);
  const prepItems = (booking.preparation || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const riskItems = (triage.riskReminder || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const detailItems = (triage.detail.stepByStep || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const summaryHtml = [
    '<div class="summary-card">',
    '<div class="summary-top">',
    '<span class="summary-badge">小科总结</span>',
    `<p class="summary-title">${escapeHtml(triage.core.suggestDepartment)}</p>`,
    `<p class="summary-text">${escapeHtml(triage.core.text)}</p>`,
    `<div class="summary-next"><span class="summary-next-label">现在先做什么</span><strong>先去${escapeHtml(
      triage.core.suggestHospital
    )}挂${escapeHtml(triage.core.suggestDepartment)}，先把这轮基础检查做完，再决定要不要加更贵的检查。</strong></div>`,
    '</div>',
    '<div class="result-mode-toggle">',
    '<button class="result-mode-btn active" data-mode-toggle="simple">只看重点</button>',
    '<button class="result-mode-btn" data-mode-toggle="full">查看完整版</button>',
    '</div>',
    '<div class="summary-metrics">',
    `<div class="summary-metric"><span class="summary-label">建议医院</span><strong>${escapeHtml(triage.core.suggestHospital)}</strong></div>`,
    `<div class="summary-metric"><span class="summary-label">首轮费用</span><strong>${escapeHtml(triage.core.firstCostRange)}</strong></div>`,
    `<div class="summary-metric"><span class="summary-label">医保参考</span><strong>${escapeHtml(cost.simple.insuranceCoverage)}</strong></div>`,
    '</div>',
    '<div class="summary-actions">',
    '<button class="result-action primary" data-action="summary-booking">现在去挂号</button>',
    '<button class="result-action" data-action="summary-expand">查看完整建议</button>',
    '<button class="result-action" data-action="summary-share">分享给家属</button>',
    '</div>',
    '</div>',
  ].join('');
  const summaryRow = markResultRow(addRow('bot', summaryHtml, 'summary-shell'));
  summaryRow.querySelector('[data-action="summary-booking"]').onclick = () => {
    state.resultViewMode = 'full';
    state.resultAnchor = 'booking';
    setResultViewMode('full');
    requestAnimationFrame(() => {
      document.querySelector('[data-booking-card="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  summaryRow.querySelector('[data-action="summary-expand"]').onclick = () => {
    document.querySelectorAll('.result-collapse').forEach((node) => {
      node.open = true;
    });
    setResultViewMode('full');
  };
  summaryRow.querySelector('[data-action="summary-share"]').onclick = () => {
    shareCurrentSummary().catch((err) => alert(err.message));
  };
  summaryRow.querySelectorAll('[data-mode-toggle]').forEach((button) => {
    button.onclick = () => {
      const mode = button.dataset.modeToggle;
      setResultViewMode(mode);
    };
  });

  const essentialChecks = buildResultCard('第一步检查', firstChecks, 'strong');
  essentialChecks.dataset.resultView = 'simple';
  const essentialCost = buildResultCard('费用与医保', costItems);
  essentialCost.dataset.resultView = 'simple';
  attachInsuranceActions(essentialCost);
  const bookingCard = buildBookingCard(booking, prepItems);
  bookingCard.dataset.resultView = 'full';
  bookingCard.dataset.bookingCard = 'true';
  const prepCard = buildCollapsibleResultCard('去医院前带什么', '身份证、医保卡、近期检查结果', `<ul>${prepItems}</ul>`);
  prepCard.dataset.resultView = 'full';
  const riskCard = buildCollapsibleResultCard('风险提醒', '有胸痛加重或呼吸困难要尽快急诊', `<ul>${riskItems}</ul>`, 'risk');
  riskCard.dataset.resultView = 'full';
  const detailCard = buildCollapsibleResultCard(
    '为什么这样建议',
    '查看具体判断逻辑和后续路径',
    `<div class="result-card-title-wrap"><h3>为什么这样建议</h3><p>${escapeHtml(triage.detail.whyDepartment)}</p></div><ul>${detailItems}</ul>`
  );
  detailCard.dataset.resultView = 'full';

  const actionButtons = state.sharedView
    ? [
        '<button class="result-action primary" data-action="booking">去挂号</button>',
        '<button class="result-action" data-action="share">分享给家属</button>',
      ]
    : [
        '<button class="result-action primary" data-action="booking">去挂号</button>',
        '<button class="result-action" data-action="save">保存记录</button>',
        '<button class="result-action" data-action="share">分享给家属</button>',
        '<button class="result-action" data-action="records">查看记录</button>',
        '<button class="result-action" data-action="restart">重新咨询</button>',
      ];
  const actionRow = markResultRow(addRow(
    'bot',
    [
      '<div class="result-card action-card">',
      '<div class="action-head">',
      `<h3>${state.sharedView ? '后续建议' : '下一步'}</h3>`,
      `<p>${state.sharedView ? '家属可以根据这份总结，陪同去挂号或就诊。' : '先挂号，还是先把这次结果存下来。'}</p>`,
      '</div>',
      '<div class="result-actions">',
      ...actionButtons,
      '</div>',
      '</div>',
    ].join('')
  ));
  actionRow.dataset.resultView = 'simple';
  actionRow.querySelector('[data-action="booking"]').onclick = () => {
    state.resultViewMode = 'full';
    state.resultAnchor = 'booking';
    setResultViewMode('full');
    requestAnimationFrame(() => {
      document.querySelector('[data-booking-card="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  if (actionRow.querySelector('[data-action="save"]')) {
    actionRow.querySelector('[data-action="save"]').onclick = () => {
      saveRecord().catch((err) => alert(err.message));
    };
  }
  actionRow.querySelector('[data-action="share"]').onclick = () => {
    shareCurrentSummary().catch((err) => alert(err.message));
  };
  if (actionRow.querySelector('[data-action="records"]')) {
    actionRow.querySelector('[data-action="records"]').onclick = () => {
      openRecordsDialog('browse').catch((err) => alert(err.message));
    };
  }
  if (actionRow.querySelector('[data-action="restart"]')) {
    actionRow.querySelector('[data-action="restart"]').onclick = () => {
      resetConversation();
    };
  }

  setResultViewMode(state.resultViewMode || 'simple');
  requestAnimationFrame(() => {
    if (state.resultAnchor === 'booking') {
      document.querySelector('[data-booking-card="true"]')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else {
      summaryRow.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  });
}

async function saveRecord() {
  if (!state.sessionId || !state.triageResult) {
    alert('请先完成咨询');
    return;
  }

  if (!(await requireLogin(() => saveRecord()))) {
    return;
  }

  const formData = new FormData();
  formData.append('userId', state.auth.userId);
  formData.append('sessionId', state.sessionId);

  await api('/archive/upload', {
    method: 'POST',
    body: formData,
  });

  addBotText('这次结果已经帮你保存了。');
}

async function handlePickedFile(file, label) {
  if (!file) return;
  addUserText(`${label}：${file.name}`);
  if (state.awaitingContext === 'supplement') {
    const formData = new FormData();
    formData.append('sessionId', state.sessionId);
    formData.append('label', label);
    formData.append('file', file);
    const uploadResult = await api('/triage/supplement-file', {
      method: 'POST',
      body: formData,
    });
    if (label === '检验报告') {
      state.supplementStats.report += 1;
    } else {
      state.supplementStats.image += 1;
    }
    state.supplementCount += 1;
    addStatusPill(getSupplementStatusText());
    buildReportSummaryCard(uploadResult.file.summary, uploadResult.file.path);
    await addBotText('这份材料我先做了一个基础摘要。你可以继续补充文字，也可以直接生成总结。');
    await showGenerationConfirmCard('如果你还想补充文字，可以再发一条；也可以现在直接生成。');
    return;
  }
  await addBotText('这份材料我先记下了。等你完成这次咨询后，可以一起保存进健康档案。');
}

function syncVoiceButton() {
  $('voiceCaptureBtn').textContent = state.speechListening ? '松开发送' : '按住说话';
  $('voiceCaptureBtn').classList.toggle('active', state.speechListening);
}

function ensureSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  if (state.speechRecognition) return state.speechRecognition;

  const recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript?.trim();
    if (!transcript) return;
    state.speechBuffer = transcript;
    $('composerInput').value = transcript;
  };
  recognition.onend = () => {
    state.speechListening = false;
    syncVoiceButton();
    const transcript = state.speechBuffer.trim();
    state.speechBuffer = '';
    if (state.composerMode === 'voice') {
    }
    if (transcript) {
      $('composerInput').value = transcript;
      setComposerMode('text');
      $('sendBtn').click();
    }
  };
  recognition.onerror = () => {
    state.speechListening = false;
    syncVoiceButton();
  };
  state.speechRecognition = recognition;
  return recognition;
}

function startVoiceCapture(event) {
  event.preventDefault();
  const recognition = ensureSpeechRecognition();
  if (!recognition) {
    addBotText('当前浏览器不支持语音识别。你可以继续直接打字。');
    setComposerMode('text');
    return;
  }

  if (state.speechListening) {
    return;
  }

  state.speechBuffer = '';
  state.speechListening = true;
  syncVoiceButton();
  try {
    recognition.start();
  } catch (_error) {
    state.speechListening = false;
    syncVoiceButton();
  }
}

function stopVoiceCapture(event) {
  if (event) event.preventDefault();
  if (!state.speechListening) {
    return;
  }

  const recognition = ensureSpeechRecognition();
  if (recognition) {
    recognition.stop();
  } else {
    state.speechListening = false;
    syncVoiceButton();
  }
}

function buildRecordContextPreview(record) {
  const checks = (record.firstChecks || []).slice(0, 3).map((item) => item.name).filter(Boolean);
  return [
    record.summary || '',
    record.department ? `上次建议科室：${record.department}` : '',
    record.costRange ? `上次首轮费用：${record.costRange}` : '',
    checks.length ? `上次首轮检查：${checks.join('、')}` : '',
  ]
    .filter(Boolean)
    .join('；');
}

async function sendRecordAsContext(record) {
  if (!state.sessionId) {
    alert('先开始一次咨询，再引用历史记录。');
    return;
  }

  const data = await api(`/archive/${encodeURIComponent(state.auth.userId)}/${record.id}/context`);
  const contextText = data.contextText || buildRecordContextPreview(record);
  addUserText(`引用记录：${record.summary || '历史记录'}`);
  await api('/triage/supplement', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: state.sessionId,
      supplement: contextText,
    }),
  });
  state.supplementStats.text += 1;
  state.supplementCount += 1;
  addStatusPill(getSupplementStatusText());
  $('recordsDialog').close();
  await addBotText(`我已经把这条历史记录加到这次咨询的上下文里了：${buildRecordContextPreview(record) || '已补充历史记录'}`);
  if (state.generationReady) {
    await showGenerationConfirmCard('历史记录已经补进来了。你还可以继续补充，或者现在直接生成总结。');
  }
}

async function listRecords() {
  const data = await api(`/archive/list?userId=${encodeURIComponent(state.auth.userId)}`);
  const list = $('recordsList');
  list.innerHTML = '';

  if (!data.records.length) {
    list.innerHTML = '<div class="records-empty"><p>还没有保存过记录</p><span>你完成一次咨询后，可以把结果和材料一起存进这里。</span></div>';
    return;
  }

  data.records.forEach((record) => {
    const item = document.createElement('div');
    item.className = 'record-item';
    const fileCount = Array.isArray(record.files) ? record.files.length : 0;
    const reportCount = (record.files || []).filter((file) => file.summary?.title).length;
    item.innerHTML = [
      '<div class="record-top">',
      `<div><div class="record-tags"><span class="record-tag">历史记录</span>${record.department ? `<span class="record-tag subtle">${escapeHtml(record.department)}</span>` : ''}</div><p class="record-title">${escapeHtml(
        record.summary || '-'
      )}</p></div>`,
      `<span class="record-time">${escapeHtml((record.createdAt || '-').slice(0, 16).replace('T', ' '))}</span>`,
      '</div>',
      '<div class="record-metrics">',
      `<div class="record-metric"><span>首轮费用</span><strong>${escapeHtml(record.costRange || '-')}</strong></div>`,
      `<div class="record-metric"><span>材料数量</span><strong>${fileCount} 份</strong></div>`,
      `<div class="record-metric"><span>摘要材料</span><strong>${reportCount} 份</strong></div>`,
      '</div>',
      record.firstChecks?.length
        ? `<div class="record-checks">${record.firstChecks
            .slice(0, 3)
            .map((item) => `<span class="record-chip">${escapeHtml(item.name)}</span>`)
            .join('')}</div>`
        : '',
      '<div class="record-actions">',
      `<button class="record-action" data-detail="${record.id}">查看详情</button>`,
      state.recordsMode === 'context' ? `<button class="record-action" data-send-context="${record.id}">发送到当前对话</button>` : '',
      `<a class="record-action" target="_blank" href="/archive/export?userId=${encodeURIComponent(state.auth.userId)}&recordId=${record.id}">导出 PDF</a>`,
      `<button class="record-action" data-delete="${record.id}">删除</button>`,
      '</div>',
    ].join('');
    item.querySelector('[data-detail]').onclick = () => {
      openRecordDetail(record);
    };
    if (item.querySelector('[data-send-context]')) {
      item.querySelector('[data-send-context]').onclick = () => {
        sendRecordAsContext(record).catch((err) => alert(err.message));
      };
    }
    item.querySelector('[data-delete]').onclick = async () => {
      await api(`/archive/${encodeURIComponent(state.auth.userId)}/${record.id}`, {
        method: 'DELETE',
      });
      await listRecords();
    };
    list.appendChild(item);
  });
}

function openRecordDetail(record) {
  const files = Array.isArray(record.files) ? record.files : [];
  $('recordDetailBody').innerHTML = [
    '<div class="record-detail-card">',
    `<div class="record-tags"><span class="record-tag">记录详情</span>${record.department ? `<span class="record-tag subtle">${escapeHtml(
      record.department
    )}</span>` : ''}</div>`,
    `<p class="record-title">${escapeHtml(record.summary || '-')}</p>`,
    '<div class="record-metrics">',
    `<div class="record-metric"><span>首轮费用</span><strong>${escapeHtml(record.costRange || '-')}</strong></div>`,
    `<div class="record-metric"><span>保存时间</span><strong>${escapeHtml((record.createdAt || '-').slice(0, 16).replace('T', ' '))}</strong></div>`,
    `<div class="record-metric"><span>材料数量</span><strong>${files.length} 份</strong></div>`,
    '</div>',
    record.firstChecks?.length
      ? `<div class="detail-section"><h4>第一步检查</h4><div class="record-checks">${record.firstChecks
          .map((item) => `<span class="record-chip">${escapeHtml(item.name)}</span>`)
          .join('')}</div></div>`
      : '',
    files.length
      ? `<div class="detail-section"><h4>已保存材料</h4><div class="detail-file-list">${files
          .map(
            (file) => `<div class="detail-file-item"><strong>${escapeHtml(file.originalName || '-')}</strong>${
              file.summary?.title ? `<span>${escapeHtml(file.summary.title)}</span>` : '<span>未生成摘要</span>'
            }</div>`
          )
          .join('')}</div></div>`
      : '',
    '</div>',
  ].join('');
  $('recordDetailDialog').showModal();
}

async function handleComposerSubmit() {
  const text = $('composerInput').value.trim();
  if (!text) return;

  $('composerInput').value = '';
  await submitText(text);
}

function bindEvents() {
  $('sendBtn').onclick = () => {
    handleComposerSubmit().catch((err) => alert(err.message));
  };

  $('modeToggleBtn').onclick = () => {
    setComposerMode(state.composerMode === 'text' ? 'voice' : 'text');
  };

  $('voiceCaptureBtn').addEventListener('pointerdown', startVoiceCapture);
  $('voiceCaptureBtn').addEventListener('pointerup', stopVoiceCapture);
  $('voiceCaptureBtn').addEventListener('pointercancel', stopVoiceCapture);
  $('voiceCaptureBtn').addEventListener('pointerleave', stopVoiceCapture);
  $('voiceCaptureBtn').addEventListener('click', (event) => event.preventDefault());

  $('plusBtn').onclick = () => {
    $('plusMenu').classList.toggle('hidden');
  };

  $('plusMenu').querySelectorAll('[data-menu-action]').forEach((button) => {
    button.onclick = () => {
      const action = button.dataset.menuAction;
      $('plusMenu').classList.add('hidden');

      if (action === 'report') $('reportInput').click();
      if (action === 'camera') $('cameraInput').click();
      if (action === 'image') $('imageInput').click();
      if (action === 'records') {
        openRecordsDialog('context').catch((err) => alert(err.message));
      }
    };
  });

  $('reportInput').onchange = (event) => handlePickedFile(event.target.files?.[0], '检验报告').catch((err) => alert(err.message));
  $('cameraInput').onchange = (event) => handlePickedFile(event.target.files?.[0], '拍照').catch((err) => alert(err.message));
  $('imageInput').onchange = (event) => handlePickedFile(event.target.files?.[0], '相册').catch((err) => alert(err.message));

  $('composerInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      $('sendBtn').click();
    }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.composer-wrap')) {
      $('plusMenu').classList.add('hidden');
    }
  });

  $('closeRecordsBtn').onclick = () => $('recordsDialog').close();
  $('closeRecordDetailBtn').onclick = () => $('recordDetailDialog').close();
  $('closeLoginBtn').onclick = () => {
    pendingAfterLogin = null;
    $('loginDialog').close();
  };
  $('recordsLoginBtn').onclick = () => {
    requireLogin(async () => {
      syncAuthUi();
      await listRecords();
    }).catch((err) => alert(err.message));
  };
  $('wechatLoginBtn').onclick = () => {
    performWechatLogin().catch((err) => alert(err.message));
  };
  $('listRecordsBtn').onclick = () => {
    listRecords().catch((err) => alert(err.message));
  };
}

async function loadSharedSession(sessionId) {
  state.sharedView = true;
  state.sessionId = sessionId;
  $('chatFeed').innerHTML = '';
  $('quickRow').classList.add('hidden');
  document.querySelector('.composer-wrap').classList.add('hidden');
  addRow('bot', '<div class="intro-card-inner"><p class="intro-copy"><strong class="intro-accent">这是小科分享给家属的总结页</strong>，你可以直接查看这次建议、费用和挂号信息。</p></div>', 'intro-card');
  const result = await api(`/triage/result/${encodeURIComponent(sessionId)}`);
  state.triageResult = result;
  await renderResultCards();
}

async function bootstrap() {
  loadAuthState();
  loadSavedRegion();
  renderQuickSymptoms();
  syncAuthUi();
  bindEvents();
  const params = new URLSearchParams(window.location.search);
  const sharedSessionId = params.get('session');
  if (sharedSessionId) {
    try {
      await loadSharedSession(sharedSessionId);
      return;
    } catch (_error) {
      document.querySelector('.composer-wrap').classList.remove('hidden');
      state.sharedView = false;
    }
  }
  resetConversation();
}

bootstrap().catch((err) => alert(err.message));
