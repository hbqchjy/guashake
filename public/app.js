const QUICK_SYMPTOMS = ['心慌', '胸闷', '头晕', '腰酸', '肚子痛', '咳嗽', '尿频尿急', '皮肤/外伤'];

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
  speechSynthesisEnabled: false,
  speechSynthesisPrimed: false,
  speechListening: false,
  speechPressing: false,
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
  resultViewMode: 'full',
  showBookingPanel: false,
  activeRecordDetail: null,
  activeRecordDetailMode: 'full',
  sharedView: false,
  resultAnchor: 'summary',
  savedRegion: null,
  auth: {
    loggedIn: false,
    provider: '',
    userId: '',
    nickname: '',
    avatarUrl: '',
    openId: '',
    phone: '',
  },
  accountSummary: null,
  recordsMode: 'browse',
  shareUrl: '',
  pendingThinkingRow: null,
  conversationStage: 'idle',
  currentPrompt: null,
  currentFocus: { key: 'summary', label: '先看总结' },
  topicChips: [],
  summaryDirty: false,
  summaryImpactLevel: 'none',
  isWeChat: false,
  isTouchDevice: false,
  ttsToggleOn: true,
  wechatTtsSeq: 0,
  wechatTtsEnabled: false,
  wechatTtsAudio: null,
  wechatBridgeReady: false,
  wechatTtsWarned: false,
};

let botTextQueue = Promise.resolve();
let pendingAfterLogin = null;
const AUTH_STORAGE_KEY = 'guashake-auth-v1';
const REGION_STORAGE_KEY = 'guashake-last-region-v1';
const RUNTIME_STORAGE_KEY = 'guashake-runtime-v1';

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
  现在怎么办: 'spark',
  用药建议: 'clipboard',
  什么时候去医院: 'bag',
  '第一步检查': 'clipboard',
  '费用参考': 'wallet',
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

function formatDateTimeText(value, fallback = '暂无') {
  if (!value) return fallback;
  return String(value).slice(0, 16).replace('T', ' ');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopSpeechPlayback() {
  if (state.wechatTtsAudio) {
    try {
      state.wechatTtsAudio.pause();
      state.wechatTtsAudio.currentTime = 0;
    } catch (_error) {
    }
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

function ensureWeChatTtsAudio() {
  if (!state.wechatTtsAudio) {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.crossOrigin = 'use-credentials';
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
    audio.style.display = 'none';
    document.body.appendChild(audio);
    state.wechatTtsAudio = audio;
  }
  return state.wechatTtsAudio;
}

function buildWeChatTtsUrl(text) {
  const clipped = String(text || '').trim().slice(0, 220);
  const url = new URL('/api/tts', window.location.origin);
  url.searchParams.set('text', clipped);
  url.searchParams.set('_t', String(Date.now()));
  return url.toString();
}

function splitTextForWeChatTts(text) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return [];
  const sentenceParts = source
    .split(/(?<=[。！？!?；;])/)
    .map((item) => item.trim())
    .filter(Boolean);
  const maxLen = 28;
  const segments = [];
  const pushChunk = (chunk) => {
    const trimmed = String(chunk || '').trim();
    if (!trimmed) return;
    if (trimmed.length <= maxLen) {
      segments.push(trimmed);
      return;
    }
    const commaParts = trimmed
      .split(/(?<=[，,、])/)
      .map((item) => item.trim())
      .filter(Boolean);
    let cursor = '';
    commaParts.forEach((part) => {
      const merged = `${cursor}${part}`.trim();
      if (!cursor || merged.length <= maxLen) {
        cursor = merged;
      } else {
        segments.push(cursor);
        cursor = part;
      }
    });
    if (cursor) {
      if (cursor.length <= maxLen) {
        segments.push(cursor);
      } else {
        for (let i = 0; i < cursor.length; i += maxLen) {
          segments.push(cursor.slice(i, i + maxLen));
        }
      }
    }
  };
  sentenceParts.forEach(pushChunk);
  return segments.length ? segments : [source.slice(0, maxLen)];
}

function playAudioForWeChat(audio) {
  if (!audio) return Promise.resolve();
  const directPlay = () => audio.play();

  if (!state.isWeChat) {
    return directPlay();
  }

  if (typeof window.WeixinJSBridge !== 'undefined' && typeof window.WeixinJSBridge.invoke === 'function') {
    return new Promise((resolve, reject) => {
      window.WeixinJSBridge.invoke('getNetworkType', {}, () => {
        directPlay().then(resolve).catch(reject);
      });
    });
  }

  return directPlay();
}

function playWeChatTtsSegment(audio, segment, seq) {
  return new Promise((resolve, reject) => {
    if (
      seq !== state.wechatTtsSeq ||
      !state.speechSynthesisEnabled ||
      !state.ttsToggleOn ||
      !state.isWeChat ||
      !state.wechatTtsEnabled
    ) {
      resolve();
      return;
    }
    const cleanup = () => {
      audio.onended = null;
      audio.onerror = null;
      audio.onabort = null;
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, 12000);
    audio.onended = () => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    audio.onerror = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error('audio play error'));
    };
    audio.onabort = () => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    audio.src = buildWeChatTtsUrl(segment);
    playAudioForWeChat(audio).catch((err) => {
      clearTimeout(timer);
      cleanup();
      reject(err);
    });
  });
}

async function playWeChatTtsBySegments(content, seq) {
  const segments = splitTextForWeChatTts(content);
  if (!segments.length) return;
  const audio = ensureWeChatTtsAudio();
  for (const segment of segments) {
    if (
      seq !== state.wechatTtsSeq ||
      !state.speechSynthesisEnabled ||
      !state.ttsToggleOn ||
      !state.isWeChat ||
      !state.wechatTtsEnabled
    ) {
      return;
    }
    await playWeChatTtsSegment(audio, segment, seq);
  }
}

function getPreferredSpeechVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices?.() || [];
  if (!voices.length) return null;
  return voices.find((voice) => /zh|Chinese/i.test(`${voice.lang} ${voice.name}`)) || voices[0];
}

function primeSpeechPlayback() {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.getVoices?.();
    if (state.speechSynthesisPrimed) return;
    const utterance = new SpeechSynthesisUtterance('。');
    utterance.lang = 'zh-CN';
    utterance.volume = 0;
    const preferred = getPreferredSpeechVoice();
    if (preferred) {
      utterance.voice = preferred;
    }
    utterance.onend = () => {
      state.speechSynthesisPrimed = true;
    };
    utterance.onerror = () => {
      state.speechSynthesisPrimed = true;
    };
    stopSpeechPlayback();
    window.speechSynthesis.resume?.();
    window.speechSynthesis.speak(utterance);
    state.speechSynthesisPrimed = true;
  } catch (_error) {
    state.speechSynthesisPrimed = false;
  }
}

function speakGesturePrompt(text) {
  if (state.isWeChat) return;
  if (!('speechSynthesis' in window)) return;
  const content = String(text || '').trim();
  if (!content) return;
  try {
    stopSpeechPlayback();
    window.speechSynthesis.resume?.();
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = 'zh-CN';
    utterance.rate = 1;
    const preferred = getPreferredSpeechVoice();
    if (preferred) {
      utterance.voice = preferred;
    }
    utterance.onend = () => {
      state.speechSynthesisPrimed = true;
    };
    utterance.onerror = () => {
      state.speechSynthesisPrimed = false;
    };
    window.speechSynthesis.speak(utterance);
  } catch (_error) {
    state.speechSynthesisPrimed = false;
  }
}

function speakBotText(text) {
  if (!state.speechSynthesisEnabled) return;
  if (!state.ttsToggleOn) return;
  const content = String(text || '').trim();
  if (!content) return;
  if (state.isWeChat) {
    if (!state.wechatTtsEnabled) return;
    const seq = ++state.wechatTtsSeq;
    stopSpeechPlayback();
    playWeChatTtsBySegments(content, seq).catch(() => {
      if (seq !== state.wechatTtsSeq) return;
      if (!state.wechatTtsWarned) {
        state.wechatTtsWarned = true;
        addStatusPill('语音播报未成功，可点消息右侧喇叭重试');
      }
    });
    return;
  }
  if (!('speechSynthesis' in window)) return;
  if (!state.speechSynthesisPrimed) {
    primeSpeechPlayback();
    setTimeout(() => {
      if (state.speechSynthesisEnabled) {
        speakBotText(content);
      }
    }, 180);
    return;
  }

  stopSpeechPlayback();
  window.speechSynthesis.resume?.();
  const utterance = new SpeechSynthesisUtterance(content);
  utterance.lang = 'zh-CN';
  utterance.rate = 1;
  const preferred = getPreferredSpeechVoice();
  if (preferred) {
    utterance.voice = preferred;
  }
  window.speechSynthesis.speak(utterance);
}

function syncInlineTtsButtons() {
  document.querySelectorAll('.tts-inline-btn').forEach((btn) => {
    btn.textContent = state.ttsToggleOn ? '🔊' : '🔇';
    btn.classList.toggle('is-off', !state.ttsToggleOn);
  });
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
  syncMyUi();
}

function loadAuthState() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.loggedIn && parsed.userId) {
      state.auth = {
        loggedIn: true,
        provider: parsed.provider || 'wechat_oauth',
        userId: parsed.userId,
        nickname: parsed.nickname || '微信用户',
        avatarUrl: parsed.avatarUrl || '',
        openId: parsed.openId || '',
        phone: parsed.phone || '',
      };
    }
  } catch (_error) {
  }
}

function saveAuthState() {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(state.auth));
}

function saveRuntimeState() {
  if (!state.sessionId) {
    sessionStorage.removeItem(RUNTIME_STORAGE_KEY);
    return;
  }
  const payload = {
    sessionId: state.sessionId,
    resultViewMode: state.resultViewMode,
    showBookingPanel: state.showBookingPanel,
    resultAnchor: state.resultAnchor,
    currentFocus: state.currentFocus,
    profile: state.profile,
  };
  sessionStorage.setItem(RUNTIME_STORAGE_KEY, JSON.stringify(payload));
}

function clearRuntimeState() {
  sessionStorage.removeItem(RUNTIME_STORAGE_KEY);
}

function loadRuntimeState() {
  try {
    return JSON.parse(sessionStorage.getItem(RUNTIME_STORAGE_KEY) || 'null');
  } catch (_error) {
    return null;
  }
}

function getAuthDisplayName() {
  if (!state.auth.loggedIn) return '未登录';
  if (state.auth.phone) {
    return `${state.auth.nickname || '用户'} · ${state.auth.phone.slice(0, 3)}****${state.auth.phone.slice(-4)}`;
  }
  return state.auth.openId
    ? `${state.auth.nickname || '微信用户'} · ${state.auth.openId.slice(0, 6)}...`
    : `${state.auth.nickname || '微信用户'} · ${state.auth.userId}`;
}

function syncAuthUi() {
  if ($('recordsLoginState')) {
    $('recordsLoginState').textContent = getAuthDisplayName();
  }
  if ($('recordsLoginBtn')) {
    $('recordsLoginBtn').textContent = state.auth.loggedIn ? '已登录' : '手机号登录';
    $('recordsLoginBtn').disabled = state.auth.loggedIn;
  }
}

function syncMyUi() {
  const summary = state.accountSummary || null;
  if ($('myLoginState')) {
    $('myLoginState').textContent = getAuthDisplayName();
  }
  if ($('myLoginBtn')) {
    $('myLoginBtn').textContent = state.auth.loggedIn ? '已登录' : '手机号登录';
    $('myLoginBtn').disabled = state.auth.loggedIn;
  }
  if ($('myPhoneValue')) {
    $('myPhoneValue').textContent = state.auth.loggedIn && state.auth.phone
      ? state.auth.phone.slice(0, 3) + '****' + state.auth.phone.slice(-4)
      : '未登录';
  }
  if ($('myProviderValue')) {
    $('myProviderValue').textContent = summary?.providerLabel || (state.auth.loggedIn ? '手机号账号' : '测试账号');
  }
  if ($('myCreatedAtValue')) {
    $('myCreatedAtValue').textContent = formatDateTimeText(summary?.createdAt, state.auth.loggedIn ? '刚刚创建' : '-');
  }
  if ($('myRecordCountValue')) {
    $('myRecordCountValue').textContent = String(summary?.recordCount || 0) + ' 条';
  }
  if ($('myLastRecordValue')) {
    $('myLastRecordValue').textContent = formatDateTimeText(summary?.latestRecordAt, '暂无');
  }
  if ($('myLatestSummaryTitle')) {
    $('myLatestSummaryTitle').textContent = summary?.latestLikelyType || '最近一次记录';
  }
  if ($('myLatestSummaryText')) {
    $('myLatestSummaryText').textContent = summary?.latestSummary || '登录后保存的问诊记录会显示在这里。';
  }
  if ($('myLatestSummaryCard')) {
    $('myLatestSummaryCard').classList.toggle('hidden', !(summary?.latestSummary));
  }
  if ($('myRegionValue')) {
    $('myRegionValue').textContent = isRegionValid(state.savedRegion) ? formatRegion(state.savedRegion) : '未设置';
  }
  if ($('myLogoutBtn')) {
    $('myLogoutBtn').disabled = !state.auth.loggedIn;
  }
}

async function refreshMySummary() {
  if (!state.auth.loggedIn || !state.auth.userId) {
    state.accountSummary = null;
    syncMyUi();
    return;
  }
  try {
    const data = await api('/account/summary?userId=' + encodeURIComponent(state.auth.userId));
    state.accountSummary = data.summary || null;
  } catch (_error) {
    state.accountSummary = null;
  }
  syncMyUi();
}

async function openMyDialog() {
  syncMyUi();
  $('myDialog')?.showModal();
  await refreshMySummary();
}

function logoutAuth() {
  state.auth = {
    loggedIn: false,
    provider: '',
    userId: '',
    nickname: '',
    avatarUrl: '',
    openId: '',
    phone: '',
  };
  state.accountSummary = null;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  syncAuthUi();
  syncMyUi();
}

function cleanupAuthQueryParams() {
  const url = new URL(window.location.href);
  let changed = false;
  ['wx_auth_ticket', 'wx_auth_error'].forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  });
  if (changed) {
    history.replaceState({}, '', `${url.pathname}${url.search}`);
  }
}

async function consumeWechatAuthTicketIfPresent() {
  const params = new URLSearchParams(window.location.search);
  const authError = params.get('wx_auth_error');
  const authTicket = params.get('wx_auth_ticket');
  if (authError) {
    cleanupAuthQueryParams();
    const errorMap = {
      not_configured: '公众号网页授权还没配置好，当前不能完成真实微信登录。',
      invalid_callback: '微信登录回调无效，请重新发起登录。',
    };
    alert(errorMap[authError] || `微信登录失败：${authError}`);
    return;
  }
  if (!authTicket) return;
  try {
    const data = await api(`/auth/wechat/consume?ticket=${encodeURIComponent(authTicket)}`);
    state.auth = data.auth;
    saveAuthState();
    syncAuthUi();
    syncMyUi();
    cleanupAuthQueryParams();
  } catch (error) {
    cleanupAuthQueryParams();
    alert(error.message || '微信登录失败');
  }
}

async function performPasswordLogin() {
  const phone = String($('phoneLoginInput')?.value || '').trim();
  const password = String($('passwordLoginInput')?.value || '');
  const data = await api('/auth/password/login', {
    method: 'POST',
    body: JSON.stringify({ phone, password }),
  });
  state.auth = data.auth;
  state.accountSummary = null;
  saveAuthState();
  syncAuthUi();
  syncMyUi();
  $('passwordLoginInput').value = '';
  $('loginDialog').close();
  await addBotText(data.mode === 'registered' ? '账号已创建，后面保存记录会直接用这个手机号账号。' : '手机号登录已完成。');
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
  syncMyUi();
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

function showThinkingBubble() {
  clearThinkingBubble();
  state.pendingThinkingRow = addTypingBubble();
}

function clearThinkingBubble() {
  if (state.pendingThinkingRow) {
    state.pendingThinkingRow.remove();
    state.pendingThinkingRow = null;
  }
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
    clearThinkingBubble();
    const showSpeaker = state.composerMode === 'voice';
    const row = addRow(
      'bot',
      showSpeaker
        ? '<div class="bot-text-wrap"><p></p><button type="button" class="tts-inline-btn" aria-label="语音播报开关">🔊</button></div>'
        : '<p></p>'
    );
    const p = row.querySelector('p');
    row.classList.add('is-typing');
    await wait(180);
    await typeTextInto(p, text);
    row.classList.remove('is-typing');
    const ttsBtn = row.querySelector('.tts-inline-btn');
    if (ttsBtn) {
      ttsBtn.onclick = () => {
        state.ttsToggleOn = !state.ttsToggleOn;
        syncInlineTtsButtons();
        if (state.ttsToggleOn) {
          speakBotText(text);
        } else {
          stopSpeechPlayback();
        }
      };
      syncInlineTtsButtons();
    }
    speakBotText(text);
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

function setCurrentFocus(focus, options = {}) {
  if (!focus?.key) return;
  state.currentFocus = {
    key: focus.key,
    label: focus.label || focus.key,
  };
  if (!state.topicChips.some((chip) => chip.key === focus.key) && !['other', 'new_issue'].includes(focus.key)) {
    state.topicChips = [...state.topicChips, { key: focus.key, label: focus.label || focus.key }];
  }
  if (options.switchToFull) {
    state.resultViewMode = 'full';
  }
}

function syncSnapshotMeta(snapshot) {
  if (!snapshot) return;
  if (Array.isArray(snapshot.topicChips)) {
    state.topicChips = snapshot.topicChips;
  }
  if (snapshot.currentFocus?.key) {
    setCurrentFocus(snapshot.currentFocus);
  }
}

function markSummaryDirty(impactLevel = 'minor') {
  state.summaryDirty = true;
  state.summaryImpactLevel = impactLevel;
}

function clearSummaryDirty() {
  state.summaryDirty = false;
  state.summaryImpactLevel = 'none';
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
      showThinkingBubble();
      await onPick(option);
    };
    grid.appendChild(button);
  });

  state.activeChoiceBlock = bubble;
  scrollToBottom();
}

async function revealChoiceBlock(title, options, onPick, note = '', meta = '', progressRatio = 0) {
  clearThinkingBubble();
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
      '<p class="intro-copy"><strong class="intro-accent">我是小科</strong>，帮您分析症状、推荐医院和科室、预估看病费用，还能解读检查报告。直接告诉我哪里不舒服，或发送检查报告即可。</p>',
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

async function askQuestion(question, note = '') {
  state.currentQuestion = question;
  const progress = state.followUpProgress
    ? `第 ${state.followUpProgress.current} / ${state.followUpProgress.total} 步`
    : '一步一步来';
  const progressRatio = state.followUpProgress
    ? (state.followUpProgress.current / state.followUpProgress.total) * 100
    : 0;
  await revealChoiceBlock(
    question.text,
    question.options.map((label) => ({ label, type: 'answer' })),
    async (option) => {
      await answerQuestion(option.label);
    },
    '',
    progress,
    progressRatio
  );
  setComposerState('locked');
}

function setComposerState(mode) {
  state.inputMode = mode;
  $('composerInput').placeholder = '';
}

function syncComposerActions() {
  const isVoice = state.composerMode === 'voice';
  const hasText = Boolean(($('composerInput')?.value || '').trim());
  $('plusBtn')?.classList.toggle('hidden', !isVoice && hasText);
  $('sendBtn')?.classList.toggle('hidden', isVoice || !hasText);
}

function setComposerMode(mode) {
  const previousMode = state.composerMode;
  state.composerMode = mode;
  state.speechSynthesisEnabled = mode === 'voice';
  state.wechatTtsEnabled = mode === 'voice';
  if (mode !== 'voice') {
    state.wechatTtsWarned = false;
  }
  const isVoice = mode === 'voice';

  $('composerInput').classList.toggle('hidden', isVoice);
  $('voiceCaptureBtn').classList.toggle('hidden', !isVoice);
  $('modeToggleBtn').innerHTML = isVoice ? ICONS.keyboard : ICONS.mic;
  $('plusBtn').innerHTML = ICONS.plus;
  syncVoiceButton();
  if (isVoice) {
    if (!state.isWeChat) {
      primeSpeechPlayback();
    }
    if (previousMode !== 'voice' && !state.isWeChat) {
      speakGesturePrompt('语音模式已开启');
    }
  }
  if (!isVoice) {
    stopSpeechPlayback();
    state.speechBuffer = '';
    if (previousMode === 'voice') {
      $('composerInput').value = '';
    }
  }
  if (!isVoice) setComposerState(state.inputMode);
  syncComposerActions();
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
  state.speechPressing = false;
  state.speechBuffer = '';
  state.followUpProgress = null;
  state.generationReady = false;
  state.supplementCount = 0;
  state.supplementStats = {
    text: 0,
    image: 0,
    report: 0,
  };
  state.resultViewMode = 'full';
  state.showBookingPanel = false;
  state.activeRecordDetail = null;
  state.activeRecordDetailMode = 'full';
  state.sharedView = false;
  state.conversationStage = 'idle';
  state.currentPrompt = null;
  state.currentFocus = { key: 'summary', label: '先看总结' };
  state.topicChips = [];
  clearSummaryDirty();
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
  syncComposerActions();
  clearRuntimeState();
}

function updateRecordsDialogCopy() {
  syncAuthUi();
  const browseMode = state.recordsMode !== 'context';
  $('recordsSubcopy').textContent = browseMode
    ? '这里会保存你之前的总结和相关材料。'
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
  state.currentPrompt = null;
  state.conversationStage = data.conversationStage || 'structured';
  state.followUpProgress = data.progress || null;
  if (data.currentFocus) {
    setCurrentFocus(data.currentFocus);
  }
  $('quickRow').classList.add('hidden');
  saveRuntimeState();

  if (data.conversationStage === 'closed') {
    if (data.assistantReply) {
      await addBotText(data.assistantReply);
    }
    state.currentPrompt = null;
    state.currentQuestion = null;
    setComposerState('symptom');
    return;
  }
  if (data.nextPrompt?.type === 'text') {
    state.currentPrompt = data.nextPrompt;
    setComposerState('symptom');
    await addBotText(data.nextPrompt.text);
    return;
  }
  if (!data.nextQuestion) {
    await addBotText('我这边还需要你再说具体一点，或者直接发检查报告。');
    setComposerState('symptom');
    return;
  }

  await addBotText('为了更准确地帮你分析，需要你回答几个问题。');
  await askQuestion(data.nextQuestion);
}

function looksLikeReportIntent(text = '') {
  return /(报告|化验单|检查单|检验单|片子|单子|结果|发给你看|给你看一下)/.test(String(text || ''));
}

async function appendContextMessage(value) {
  showThinkingBubble();
  const data = await api('/triage/supplement', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: state.sessionId,
      supplement: value,
    }),
  });

  state.awaitingContext = null;
  if (data.currentFocus) {
    setCurrentFocus(data.currentFocus, { switchToFull: ['booking', 'cost', 'report', 'medication'].includes(data.currentFocus.key) });
  }

  if (data.intentType === 'new_issue') {
    await addBotText(data.reply || '这更像另一个新问题。');
    await showNewIssuePrompt(value);
    return;
  }

  if (['off_topic', 'report_notice'].includes(data.intentType)) {
    await addBotText(data.reply || '这条和当前咨询关系不大。');
    return;
  }

  if (data.intentType === 'medical_followup') {
    state.supplementStats.text += 1;
    state.supplementCount = data.supplements.length;
    addStatusPill(getSupplementStatusText());
  }

  if (state.triageResult && data.refreshSummary) {
    if (data.reply) {
      await addBotText(data.reply);
    }
    if (data.affectsSummary) {
      markSummaryDirty(data.impactLevel || 'minor');
      if ((data.impactLevel || 'none') === 'major') {
        await showSummaryRefreshPrompt();
        return;
      }
      addStatusPill('有新信息，可更新分析');
      return;
    }
    await directResult();
    return;
  }

  if (state.generationReady) {
    if (data.reply) {
      await addBotText(data.reply);
    }
    await showGenerationConfirmCard('如果你还有别的信息，也可以继续补充；如果没有，现在就可以直接生成总结。');
    return;
  }

  if (data.reply) {
    await addBotText(data.reply);
  }
}

async function continueOpenConversation(value) {
  showThinkingBubble();
  const data = await api('/triage/message', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: state.sessionId,
      message: value,
    }),
  });
  if (data.currentFocus) {
    setCurrentFocus(data.currentFocus);
  }

  if (data.intentType === 'new_issue' || data.currentFocus?.key === 'new_issue') {
    if (data.assistantReply) {
      await addBotText(data.assistantReply);
    }
    await showNewIssuePrompt(value, data.nextPrompt?.text || '如果还是继续当前这次问题，就再说说现在最困扰你的症状。');
    return;
  }

  if (data.needsConfirmation) {
    state.currentPrompt = null;
    state.currentQuestion = null;
    state.generationReady = true;
    state.conversationStage = 'structured';
    if (data.assistantReply) {
      await addBotText(data.assistantReply);
    }
    await showGenerationConfirmCard('如果你愿意，还可以再补充一点；如果没有，现在可以直接生成总结。');
    return;
  }

  if (data.mode === 'question' && data.nextQuestion) {
    state.currentPrompt = null;
    state.currentQuestion = null;
    state.conversationStage = 'structured';
    state.followUpProgress = data.progress || null;
    saveRuntimeState();
    await addBotText('为了更准确地帮你分析，需要你回答几个问题。');
    await askQuestion(data.nextQuestion);
    return;
  }

  if (data.mode === 'text' && data.nextPrompt?.type === 'text') {
    state.currentPrompt = data.nextPrompt;
    state.currentQuestion = null;
    state.conversationStage = 'open';
    setComposerState('symptom');
    saveRuntimeState();
    await addBotText(data.nextPrompt.text);
    return;
  }
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
    await appendContextMessage(value);
    return;
  }

  if (!state.sessionId) {
    if (looksLikeReportIntent(value)) {
      addUserText(value);
      await addBotText('可以，你直接点左下角加号，把检验报告、相册图片或者拍照发给我就行。');
      return;
    }
    addUserText(value);
    showThinkingBubble();
    await startSymptomSession(value);
    return;
  }

  if (state.currentPrompt?.type === 'text' && !state.currentQuestion) {
    addUserText(value);
    await continueOpenConversation(value);
    return;
  }

  if (state.currentQuestion) {
    addBotText('这个问题直接点下面的选项就行。');
    return;
  }

  addUserText(value);
  await appendContextMessage(value);
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
  saveRuntimeState();
  await askQuestion(data.nextQuestion);
}

async function directResult() {
  const data = await api(`/triage/result/${encodeURIComponent(state.sessionId)}`);
  syncSnapshotMeta(data.snapshot);
  state.triageResult = data;
  state.followUpProgress = null;
  state.generationReady = false;
  state.currentPrompt = null;
  state.showBookingPanel = false;
  clearSummaryDirty();
  saveRuntimeState();
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

async function showSummaryRefreshPrompt(note = '根据你刚补充的新信息，我可以把这次分析更新得更准确。') {
  clearActiveChoiceBlock();
  await revealChoiceBlock(
    '这条信息可能会影响当前总结',
    [
      { label: '继续交流', type: 'continue' },
      { label: '更新分析', type: 'refresh' },
    ],
    async (option) => {
      if (option.type === 'refresh') {
        await directResult();
        return;
      }
      await addBotText('可以，我们继续聊。等你想更新时，再点总结里的相关主题也行。');
      $('composerInput').focus();
    },
    note,
    '可随时更新',
    100
  );
}

async function showNewIssuePrompt(originalText, note = '这更像另一个新问题。你可以重新开始，也可以继续聊当前这次问题。') {
  clearActiveChoiceBlock();
  await revealChoiceBlock(
    '这像是另一个新问题',
    [
      { label: '继续当前问题', type: 'continue' },
      { label: '新的咨询', type: 'restart' },
    ],
    async (option) => {
      if (option.type === 'restart') {
        resetConversation();
        await submitText(originalText);
        return;
      }
      setCurrentFocus({ key: 'symptom', label: '症状判断' });
      await addBotText('可以，我们继续当前这次问题。你再说说现在最困扰你的地方。');
      $('composerInput').focus();
    },
    note,
    '换题提醒',
    100
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

async function detectRegionByIp() {
  const data = await api('/api/region/ip-locate');
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

  if (!state.isWeChat) {
    await addBotText('我先试着按你现在的位置补一个地区，你确认一下。');
    const preciseRegion = await detectCurrentRegion().catch(() => null);
    if (preciseRegion) {
      await revealChoiceBlock(
        '我拿到了一个当前位置，你确认一下',
        [
          { label: `确认 ${formatRegion(preciseRegion)}`, type: 'confirm', region: preciseRegion },
          { label: '更改地址', type: 'manual' },
        ],
        async (option) => {
          if (option.type === 'confirm') {
            await selectRegion(option.region);
            return;
          }
          await promptManualRegionEntry();
        },
        '如果定位不准，你再手动改。'
      );
      return;
    }
  }

  await addBotText(state.isWeChat ? '微信里精确定位不太稳定，我先按网络位置估一个地区，你确认一下。' : '精确定位没拿到，我先按网络位置估一个地区，你确认一下。');
  const ipRegion = await detectRegionByIp().catch(() => null);
  if (ipRegion) {
    await revealChoiceBlock(
      '我先按网络位置估了一个地区，你确认一下',
      [
        { label: `确认 ${formatRegion(ipRegion)}`, type: 'confirm', region: ipRegion },
        { label: '更改地址', type: 'manual' },
      ],
      async (option) => {
        if (option.type === 'confirm') {
          await selectRegion(option.region);
          return;
        }
        await promptManualRegionEntry();
      },
      '网络位置只做大致参考，不准的话你直接改。'
    );
    return;
  }

  if (cachedRegion) {
    await revealChoiceBlock(
      '自动获取没拿准，先用哪个地区',
      [
        { label: `继续用上次地区 ${formatRegion(cachedRegion)}`, type: 'cached', region: cachedRegion },
        { label: '手动输入地区', type: 'manual' },
      ],
      async (option) => {
        if (option.type === 'cached') {
          await selectRegion(option.region);
          return;
        }
        await promptManualRegionEntry();
      }
    );
    return;
  }

  await promptManualRegionEntry('自动获取地区这次没拿准，你直接输入县、区或市名就行。');
}

async function selectRegion(region) {
  state.resultViewMode = 'full';
  state.resultAnchor = 'booking';
  state.showBookingPanel = true;
  persistRegion(region);
  await updateSessionProfile({
    province: region.province,
    city: region.city,
    district: region.district,
  });
  state.awaitingContext = null;
  await addBotText(`地区已确认：${formatRegion(region)}`);
  setComposerState('symptom');
  saveRuntimeState();
  await ensureContextAndRenderResult();
}

function buildPlainResultCardHtml(title, contentHtml, extraClass = '') {
  const iconName = RESULT_CARD_ICONS[title] || 'spark';
  return `<div class="result-card ${extraClass}"><div class="result-card-head"><span class="result-card-icon">${getInlineIcon(
    iconName
  )}</span><h3>${escapeHtml(title)}</h3></div>${contentHtml}</div>`;
}

function buildResultCard(title, contentHtml, extraClass = '') {
  return markResultRow(addRow('bot', buildPlainResultCardHtml(title, contentHtml, extraClass)));
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
  document.querySelectorAll('[data-topic-chip]').forEach((button) => {
    button.classList.toggle('active', button.dataset.topicChip === state.currentFocus?.key);
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
  const row = addRow(
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
  row.dataset.topicCard = 'report';
  return row;
}

function buildInsightChipHtml(items = [], extraClass = '') {
  const list = (items || []).filter(Boolean);
  if (!list.length) return '';
  return `<div class="record-checks ${extraClass}">${list
    .map((item) => `<span class="record-chip">${escapeHtml(item)}</span>`)
    .join('')}</div>`;
}

function buildTopicChipsHtml(chips = []) {
  const list = Array.isArray(chips) ? chips.filter(Boolean) : [];
  if (!list.length) return '';
  return [
    '<div class="topic-chip-row">',
    ...list.map((chip) => {
      const active = chip.key === state.currentFocus?.key ? 'active' : '';
      return `<button class="topic-chip ${active}" type="button" data-topic-chip="${escapeHtml(chip.key)}">${escapeHtml(chip.label)}</button>`;
    }),
    '</div>',
  ].join('');
}

function buildSummarySectionHeading(title) {
  return `<div class="summary-section-heading"><span class="result-card-icon">${getInlineIcon('spark')}</span><span>${escapeHtml(title)}</span></div>`;
}

function focusResultTopic(topicKey) {
  if (!topicKey) return;
  if (topicKey === 'summary') {
    state.resultAnchor = 'summary';
    setCurrentFocus({ key: 'summary', label: '先看总结' });
    requestAnimationFrame(() => {
      document.querySelector('.summary-shell')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return;
  }
  if (topicKey === 'continue') {
    state.resultViewMode = 'full';
    setCurrentFocus({ key: 'continue', label: '继续追问' }, { switchToFull: true });
    setResultViewMode('full');
    $('composerInput').focus();
    return;
  }
  if (topicKey === 'booking' && state.triageResult) {
    const recommendationLevel = state.triageResult.layeredOutput?.core?.recommendationLevel || '';
    const needsInPerson = ['routine_clinic', 'specialist_clinic', 'hospital_priority_high'].includes(recommendationLevel);
    if (needsInPerson && !state.showBookingPanel) {
      state.showBookingPanel = true;
      state.resultAnchor = 'booking';
      setCurrentFocus({ key: 'booking', label: '去哪个医院' }, { switchToFull: true });
      renderResultCards().catch((err) => alert(err.message));
      return;
    }
  }
  state.resultViewMode = 'full';
  setCurrentFocus(
    state.topicChips.find((chip) => chip.key === topicKey) || { key: topicKey, label: topicKey },
    { switchToFull: true }
  );
  setResultViewMode('full');
  requestAnimationFrame(() => {
    document.querySelector(`[data-topic-card="${topicKey}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function buildBookingCard(booking, prepItems) {
  const hospitals = (booking.hospitals || []).slice(0, 5);
  const primaryHospitals = hospitals.slice(0, 2);
  const extraHospitals = hospitals.slice(2);
  const cachedRegion = isRegionValid(state.savedRegion) ? state.savedRegion : null;
  const hospitalCardHtml = (hospital) => {
    const entryButton = '';
    return [
      '<div class="booking-hospital-item">',
      `<div class="booking-hospital-top"><div><p class="booking-hospital-name">${escapeHtml(hospital.name)}</p><p class="booking-hospital-meta">${escapeHtml(`${hospital.level} · 建议挂 ${hospital.department}`)}</p></div><div class="booking-hospital-actions">${entryButton}</div></div>`,
      `<p class="booking-hospital-note">${escapeHtml(hospital.recommendation)}</p>`,
      `<p class="booking-hospital-channel">挂号方式：请在微信搜索医院全名挂号</p>`,
      '</div>',
    ].join('');
  };
  const html = booking.requiresRegion
    ? [
        '<div class="result-card booking-card">',
        `<div class="result-card-head"><span class="result-card-icon">${getInlineIcon('bag')}</span><h3>挂号建议</h3></div>`,
        '<p>先确认一下地区，我再给你看更贴近本地的医院和挂号入口。</p>',
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
        prepItems ? `<div class="detail-section"><h4>去医院前带什么</h4><ul>${prepItems}</ul></div>` : '',
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
  return row;
}

async function shareCurrentSummary() {
  if (!state.sessionId || !state.triageResult) return;
  const url = `${window.location.origin}${window.location.pathname}?session=${encodeURIComponent(state.sessionId)}&shared=1`;
  state.shareUrl = url;
  const title = `挂啥科总结：${state.triageResult.layeredOutput.core.suggestDepartment}`;
  const text = state.triageResult.layeredOutput.core.text;
  const isWechat = /micromessenger/i.test(navigator.userAgent);

  if (isWechat) {
    $('shareGuideDialog').showModal();
    return;
  }

  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (_error) {
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    await addBotText('总结链接已经复制好了，可以直接发给家属。');
  } catch (_error) {
    alert('当前浏览器不支持系统分享，请手动复制地址栏链接发给家属。');
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

function buildCostHtml(cost, options = {}) {
  const secondRoundChecks = Array.isArray(cost?.expanded?.secondRoundChecks) ? cost.expanded.secondRoundChecks : [];
  const medicationRefs = Array.isArray(cost?.expanded?.medicationPriceRefs) ? cost.expanded.medicationPriceRefs : [];
  const showMedicationPrices = Boolean(options.showMedicationPrices);
  const secondRoundHtml = secondRoundChecks.length
    ? [
        '<div class="detail-section">',
        '<h4>第二轮必要检查（按触发条件追加）</h4>',
        '<ul class="result-advice-list">',
        ...secondRoundChecks.map((item) => `<li>${escapeHtml(item.name)}：约 ${escapeHtml(`${item.min}~${item.max}元`)}；触发条件：${escapeHtml(item.trigger || '按医生判断')}</li>`),
        '</ul>',
        '</div>',
      ].join('')
    : '';
  const medicationHtml = showMedicationPrices && medicationRefs.length
    ? [
        '<div class="detail-section">',
        '<h4>用药价格参考</h4>',
        '<ul class="result-advice-list">',
        ...medicationRefs.map((item) => `<li>${escapeHtml(item.category)}：国产约 ${escapeHtml(`${item.domesticPrice || '-'}`)}，进口约 ${escapeHtml(`${item.importedPrice || '-'}`)}；${escapeHtml(item.note || '')}</li>`),
        '</ul>',
        '</div>',
      ].join('')
    : '';
  return [
    '<div class="result-kv-grid">',
    `<div class="result-kv"><span>大概先花</span><strong>${escapeHtml(cost.simple.costRange)}</strong></div>`,
    `<div class="result-kv"><span>参考医院</span><strong>${escapeHtml(cost.simple.basedOn || '-')}</strong></div>`,
    '</div>',
    `<p class="result-card-subtitle">${escapeHtml(cost.expanded.disclaimer || '')}</p>`,
    secondRoundHtml,
    medicationHtml,
  ].join('');
}

function buildAdviceListHtml(items = [], subtitle = '') {
  const list = (items || []).filter(Boolean);
  if (!list.length) return '';
  return [
    subtitle ? `<p class="result-card-subtitle">${escapeHtml(subtitle)}</p>` : '',
    '<ul class="result-advice-list">',
    ...list.map((item) => `<li>${escapeHtml(item)}</li>`),
    '</ul>',
  ].join('');
}

function formatRecommendationLevel(level) {
  const mapping = {
    self_care: '先观察和自我处理',
    otc_guidance: '先对症处理',
    routine_clinic: '建议普通门诊',
    specialist_clinic: '建议专科门诊',
    hospital_priority_high: '建议尽快线下就医',
  };
  return mapping[level] || level || '继续结合症状判断';
}

async function renderResultCards() {
  clearResultRows();
  const triage = state.triageResult.layeredOutput;
  const recommendationLevel = triage.core.recommendationLevel || 'routine_clinic';
  const needsInPerson = ['routine_clinic', 'specialist_clinic', 'hospital_priority_high'].includes(recommendationLevel);
  const needsBooking = Boolean(triage.core.needsBooking || needsInPerson);
  const needsCost = Boolean(triage.core.needsCost || needsInPerson);
  if (!needsInPerson) {
    state.showBookingPanel = false;
  }

  const requests = [];
  if (needsCost) {
    requests.push(
      api('/cost/estimate', {
        method: 'POST',
        body: JSON.stringify({ sessionId: state.sessionId }),
      })
    );
  }
  if (needsBooking) {
    requests.push(api(`/booking/options?sessionId=${encodeURIComponent(state.sessionId)}`));
  }
  const resolved = await Promise.all(requests);
  const cost = needsCost
    ? resolved.shift()
    : {
        simple: {
          costRange: triage.core.firstCostRange || '',
          basedOn: '当前暂无',
          pricingRule: '当前这轮不需要单独费用估算',
        },
        expanded: {
          updateCycle: '按月更新',
          disclaimer: '如果后面要线下就医，再查看费用估算会更准确。',
        },
      };
  const booking = needsBooking ? resolved.shift() : { preparation: [], hospitals: [] };

  state.cost = cost || null;
  state.booking = booking || null;
  setComposerState('symptom');

  const possibleTypes = triage.core.possibleTypes || [];
  const selfCareAdvice = triage.detail.selfCareAdvice || [];
  const medicationAdvice = triage.detail.medicationAdvice || [];
  const visitAdvice = triage.detail.visitAdvice || [];
  const examAdvice = triage.detail.examAdvice || [];
  const topicChips = state.topicChips || [];
  const careAdvice = Array.from(new Set([...visitAdvice, ...selfCareAdvice].filter(Boolean)));
  const firstChecks = buildCheckListHtml(triage.core.firstChecks || []);
  const costItems = buildCostHtml(cost, { showMedicationPrices: medicationAdvice.length > 0 });
  const prepItems = (booking.preparation || []).filter((item) => !String(item).includes('医保')).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const riskItems = (triage.riskReminder || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const summaryTitle = possibleTypes[0] || triage.core.suggestDepartment || '还需要结合症状继续判断';
  const summaryLines = [possibleTypes[1], triage.core.severityText].filter(Boolean);

  const summaryHtml = [
    '<div class="summary-card">',
    '<div class="summary-top">',
    buildSummarySectionHeading('小科总结'),
    `<p class="summary-title compact">${escapeHtml(summaryTitle)}</p>`,
    ...summaryLines.map((line) => `<p class="summary-text">${escapeHtml(line)}</p>`),
    state.summaryDirty ? `<p class="summary-dirty ${state.summaryImpactLevel === 'major' ? 'major' : ''}">根据你后面补充的新信息，这份总结可以再更新一次。</p>` : '',
    buildSummarySectionHeading('小科建议'),
    `<div class="summary-next"><strong>${escapeHtml(triage.core.text || '')}</strong></div>`,
    '</div>',
    '<div class="result-mode-toggle">',
    '<button class="result-mode-btn active" data-mode-toggle="full">完整版建议</button>',
    '<button class="result-mode-btn" data-mode-toggle="simple">只看重点</button>',
    '</div>',
    buildTopicChipsHtml(topicChips),
    '</div>',
  ].join('');
  const summaryRow = markResultRow(addRow('bot', summaryHtml, 'summary-shell'));
  summaryRow.querySelectorAll('[data-mode-toggle]').forEach((button) => {
    button.onclick = () => {
      setResultViewMode(button.dataset.modeToggle);
    };
  });

  const actionCard = buildResultCard(
    '现在怎么办',
    buildAdviceListHtml(careAdvice.length ? careAdvice : [triage.core.text || '先继续观察变化']),
    'strong'
  );
  actionCard.dataset.resultView = 'full';
  actionCard.dataset.topicCard = 'care';

  let medicationCard = null;
  if (medicationAdvice.length) {
    medicationCard = buildResultCard(
      '用药建议',
      buildAdviceListHtml(medicationAdvice, '测试期建议仅供参考，最好结合既往病史、说明书和药师意见一起看。')
    );
    medicationCard.dataset.resultView = 'full';
    medicationCard.dataset.topicCard = 'medication';
  }

  let essentialChecks = null;
  if (needsInPerson && (examAdvice.length || (triage.core.firstChecks || []).length)) {
    essentialChecks = buildResultCard('第一步检查', `${buildAdviceListHtml(examAdvice)}${firstChecks}`, 'strong');
    essentialChecks.dataset.resultView = 'full';
    essentialChecks.dataset.topicCard = 'checks';
  }

  let essentialCost = null;
  if (needsCost) {
    essentialCost = buildResultCard('费用参考', costItems);
    essentialCost.dataset.resultView = 'full';
    essentialCost.dataset.topicCard = 'cost';
  }

  let bookingCard = null;
  let prepCard = null;
  if (needsBooking && state.showBookingPanel) {
    bookingCard = buildBookingCard(booking, prepItems);
    bookingCard.dataset.resultView = 'full';
    bookingCard.dataset.bookingCard = 'true';
    bookingCard.dataset.topicCard = 'booking';
  }

  const riskCard = buildCollapsibleResultCard('风险提醒', '有胸痛加重或呼吸困难要尽快急诊', `<ul>${riskItems}</ul>`, 'risk');
  riskCard.dataset.resultView = 'full';
  riskCard.dataset.topicCard = 'care';

  const actionButtons = state.sharedView
    ? [
        needsInPerson ? '<button class="result-action primary is-default" data-action="booking">去挂号</button>' : '<button class="result-action primary is-default" data-action="deep">继续咨询</button>',
        needsInPerson ? '<button class="result-action" data-action="deep">继续咨询</button>' : '',
        '<button class="result-action" data-action="restart">新的咨询</button>',
        '<button class="result-action" data-action="share">分享结果</button>',
      ].filter(Boolean)
    : [
        needsInPerson ? '<button class="result-action primary is-default" data-action="booking">去挂号</button>' : '<button class="result-action primary is-default" data-action="deep">继续咨询</button>',
        needsInPerson ? '<button class="result-action" data-action="deep">继续咨询</button>' : '',
        '<button class="result-action" data-action="restart">新的咨询</button>',
        '<button class="result-action" data-action="save">保存记录</button>',
        '<button class="result-action" data-action="share">分享结果</button>',
      ].filter(Boolean);
  const actionRow = markResultRow(addRow(
    'bot',
    [
      '<div class="result-card action-card">',
      '<div class="action-head">',
      `<h3>${state.sharedView ? '后续建议' : '下一步'}</h3>`,
      `<p>${state.sharedView ? '家属可以根据这份总结，继续陪你处理这次问题。' : needsInPerson ? '需要线下就医时，再展开挂号建议。' : '先按建议处理，也可以继续补充后再更新分析。'}</p>`,
      '</div>',
      '<div class="result-actions">',
      ...actionButtons,
      '</div>',
      '</div>',
    ].join('')
  ));
  actionRow.dataset.resultView = 'full';
  actionRow.dataset.topicCard = 'continue';
  if (actionRow.querySelector('[data-action="booking"]')) {
    actionRow.querySelector('[data-action="booking"]').onclick = async () => {
      state.showBookingPanel = true;
      state.resultViewMode = 'full';
      state.resultAnchor = 'booking';
      setCurrentFocus({ key: 'booking', label: '去哪个医院' }, { switchToFull: true });
      await renderResultCards();
    };
  }
  if (actionRow.querySelector('[data-action="deep"]')) {
    actionRow.querySelector('[data-action="deep"]').onclick = async () => {
      setResultViewMode('full');
      await addBotText('你可以继续追问，我会沿着这次咨询的上下文继续分析。');
      $('composerInput').focus();
    };
  }
  if (actionRow.querySelector('[data-action="save"]')) {
    actionRow.querySelector('[data-action="save"]').onclick = () => {
      saveRecord().catch((err) => alert(err.message));
    };
  }
  actionRow.querySelector('[data-action="share"]').onclick = () => {
    shareCurrentSummary().catch((err) => alert(err.message));
  };
  if (actionRow.querySelector('[data-action="restart"]')) {
    actionRow.querySelector('[data-action="restart"]').onclick = () => {
      resetConversation();
    };
  }

  setResultViewMode(state.resultViewMode || 'full');
  summaryRow.querySelectorAll('[data-topic-chip]').forEach((button) => {
    button.onclick = () => {
      focusResultTopic(button.dataset.topicChip);
    };
  });
  requestAnimationFrame(() => {
    if (state.resultAnchor === 'booking' && state.showBookingPanel) {
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
  if (!state.sessionId) {
    showThinkingBubble();
    const formData = new FormData();
    formData.append('label', label);
    formData.append('file', file);
    const data = await api('/triage/start-with-file', {
      method: 'POST',
      body: formData,
    });
    state.sessionId = data.sessionId;
    state.currentQuestion = null;
    state.currentPrompt = null;
    state.conversationStage = data.conversationStage || 'structured';
    state.followUpProgress = data.progress || null;
    if (data.currentFocus) {
      setCurrentFocus(data.currentFocus);
    }
    $('quickRow').classList.add('hidden');
    buildReportSummaryCard(data.file.summary, data.file.path);
    if (data.conversationStage === 'closed') {
      if (data.assistantReply) {
        await addBotText(data.assistantReply);
      }
      state.currentPrompt = null;
      state.currentQuestion = null;
      setComposerState('symptom');
      return;
    }
    if (data.nextPrompt?.type === 'text') {
      state.currentPrompt = data.nextPrompt;
      setComposerState('symptom');
      await addBotText(data.nextPrompt.text);
      return;
    }
    if (!data.nextQuestion) {
      await addBotText('这份材料我已经收到。你可以继续补充一下不舒服的地方，我再接着分析。');
      setComposerState('symptom');
      return;
    }
    await addBotText('为了更准确地帮你分析，需要你回答几个问题。');
    await askQuestion(data.nextQuestion);
    return;
  }

  showThinkingBubble();
  const formData = new FormData();
  formData.append('sessionId', state.sessionId);
  formData.append('label', label);
  formData.append('file', file);
  const uploadResult = await api('/triage/supplement-file', {
    method: 'POST',
    body: formData,
  });
  if (uploadResult.currentFocus) {
    setCurrentFocus(uploadResult.currentFocus, { switchToFull: true });
  }
  if (label === '检验报告') {
    state.supplementStats.report += 1;
  } else {
    state.supplementStats.image += 1;
  }
  state.supplementCount += 1;
  state.awaitingContext = null;
  addStatusPill(getSupplementStatusText());
  buildReportSummaryCard(uploadResult.file.summary, uploadResult.file.path);

  if (state.currentQuestion) {
    await addBotText('这份材料我已经并到当前咨询里了。咱们继续把上面的问题答完，我会一起参考这份报告。');
    return;
  }

  if (state.triageResult) {
    await addBotText('我把这份材料合进这次咨询里了，给你更新一下总结。');
    await directResult();
    return;
  }

  if (state.generationReady || state.awaitingContext === 'supplement') {
    await addBotText('这份材料我已经并到这次咨询里了。你还可以继续补充，或者现在直接生成总结。');
    await showGenerationConfirmCard('这份材料已经加入分析。你可以继续补充，或者现在直接生成总结。');
    return;
  }

  await addBotText('这份材料我已经并到这次咨询里了。');
}

function syncVoiceButton() {
  $('voiceCaptureBtn').textContent = state.speechListening ? '松开发送' : '按住说话';
  $('voiceCaptureBtn').classList.toggle('active', state.speechListening);
}

function clearBrowserSelection() {
  try {
    window.getSelection?.()?.removeAllRanges?.();
  } catch (_error) {
  }
}

async function startVoiceCapture(event) {
  event.preventDefault();
  event.stopPropagation();
  if (state.speechListening) return;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    const isWechat = /MicroMessenger/i.test(navigator.userAgent || '');
    if (isWechat) {
      addBotText('微信内打开网页时麦克风权限受限。请先用手机 Chrome 测试语音输入，或改用打字继续。');
    } else {
      addBotText('无法访问麦克风，请检查浏览器麦克风权限设置。');
    }
    setComposerMode('text');
    return;
  }

  stopSpeechPlayback();
  clearBrowserSelection();

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/mp4')
      ? 'audio/mp4'
      : '';
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    state.speechListening = false;
    state.speechPressing = false;
    document.documentElement.classList.remove('voice-pressing');
    document.body.classList.remove('voice-pressing');
    syncVoiceButton();

    if (!chunks.length) return;
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    if (blob.size < 1000) return;

    $('voiceCaptureBtn').textContent = '识别中…';
    $('voiceCaptureBtn').disabled = true;
    try {
      const form = new FormData();
      const rawType = String(blob.type || '').split(';')[0];
      const ext = rawType.includes('mp4') ? 'mp4' : rawType.includes('wav') ? 'wav' : 'webm';
      form.append('audio', blob, `voice.${ext}`);
      const res = await fetch('/api/asr', { method: 'POST', body: form });
      const data = await res.json();
      const transcript = (data.text || '').trim();
      if (transcript) {
        $('composerInput').value = transcript;
        submitText(transcript).catch((err) => alert(err.message));
      } else {
        $('voiceCaptureBtn').textContent = '未识别到内容';
        setTimeout(syncVoiceButton, 1500);
      }
    } catch (err) {
      $('voiceCaptureBtn').textContent = '识别失败';
      setTimeout(syncVoiceButton, 1500);
    } finally {
      $('voiceCaptureBtn').disabled = false;
      syncVoiceButton();
    }
  };

  state.speechRecognition = recorder;
  state.speechPressing = true;
  state.speechListening = true;
  document.documentElement.classList.add('voice-pressing');
  document.body.classList.add('voice-pressing');
  syncVoiceButton();
  recorder.start();
}

function stopVoiceCapture(event) {
  if (event) event.preventDefault();
  if (event) event.stopPropagation();
  if (!state.speechListening) {
    state.speechPressing = false;
    document.documentElement.classList.remove('voice-pressing');
    document.body.classList.remove('voice-pressing');
    return;
  }

  state.speechPressing = false;
  document.documentElement.classList.remove('voice-pressing');
  document.body.classList.remove('voice-pressing');
  const recorder = state.speechRecognition;
  if (recorder && recorder.state === 'recording') {
    recorder.stop();
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
  addUserText(`引用记录：${record.summary || record.chiefComplaint || '历史记录'}`);
  if (!state.sessionId) {
    showThinkingBubble();
    const data = await api(`/archive/${encodeURIComponent(state.auth.userId)}/${record.id}/context-session`, {
      method: 'POST',
    });
    state.sessionId = data.sessionId;
    state.currentQuestion = null;
    state.currentPrompt = null;
    state.profile = {
      ...state.profile,
      province: data.profile?.province || state.profile.province,
      city: data.profile?.city || state.profile.city,
      district: data.profile?.district || state.profile.district,
      insuranceType: data.profile?.insuranceType || state.profile.insuranceType,
    };
    state.conversationStage = data.conversationStage || 'structured';
    state.followUpProgress = data.progress || null;
    if (data.currentFocus) {
      setCurrentFocus(data.currentFocus);
    }
    $('quickRow').classList.add('hidden');
    saveRuntimeState();
    if (data.assistantReply) {
      await addBotText(data.assistantReply);
    }
    if (data.nextPrompt?.type === 'text') {
      state.currentPrompt = data.nextPrompt;
      setComposerState('symptom');
      await addBotText(data.nextPrompt.text);
      return;
    }
    if (data.nextQuestion) {
      await addBotText('为了更准确地帮你分析，需要你回答几个问题。');
      await askQuestion(data.nextQuestion);
      return;
    }
    return;
  }

  const data = await api(`/archive/${encodeURIComponent(state.auth.userId)}/${record.id}/context`);
  const contextText = data.contextText || buildRecordContextPreview(record);
  const supplementResult = await api('/triage/supplement', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: state.sessionId,
      supplement: contextText,
    }),
  });
  if (supplementResult.currentFocus) {
    setCurrentFocus(supplementResult.currentFocus, {
      switchToFull: ['booking', 'cost', 'report', 'medication'].includes(supplementResult.currentFocus.key),
    });
  }
  $('recordsDialog').close();

  if (supplementResult.intentType === 'new_issue') {
    await addBotText(supplementResult.reply || '这条历史记录更像另一个新问题。');
    await showNewIssuePrompt(record.summary || buildRecordContextPreview(record) || '新的问题');
    return;
  }

  if (supplementResult.intentType === 'medical_followup') {
    state.supplementStats.text += 1;
    state.supplementCount = (supplementResult.supplements || []).length;
    addStatusPill(getSupplementStatusText());
  }

  await addBotText(
    supplementResult.reply || `这条历史记录已经并到当前咨询里了：${buildRecordContextPreview(record) || '已补充历史记录'}`
  );

  if (state.triageResult && supplementResult.refreshSummary) {
    if (supplementResult.affectsSummary) {
      markSummaryDirty(supplementResult.impactLevel || 'minor');
      if ((supplementResult.impactLevel || 'none') === 'major') {
        await showSummaryRefreshPrompt('这条历史记录可能会影响当前总结。');
        return;
      }
      addStatusPill('这条历史记录可用于更新分析');
      return;
    }
    await directResult();
    return;
  }

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
    const leadText = record.likelyType || record.summarySnapshot?.core?.possibleTypes?.[0] || '历史咨询';
    item.innerHTML = [
      '<div class="record-top">',
      `<p class="record-title">${escapeHtml(leadText)}</p>`,
      `<span class="record-time">${escapeHtml((record.createdAt || '-').slice(0, 16).replace('T', ' '))}</span>`,
      '</div>',
      '<div class="record-actions">',
      `<button class="record-action" data-detail="${record.id}">查看详情</button>`,
      state.recordsMode === 'context' ? `<button class="record-action" data-send-context="${record.id}">发送到当前对话</button>` : '',
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

function buildRecordDetailView(record, mode = 'full') {
  const snapshot = record.summarySnapshot || {};
  const core = snapshot.core || {};
  const detail = snapshot.detail || {};
  const recommendationLevel = core.recommendationLevel || (record.department ? 'routine_clinic' : 'self_care');
  const needsInPerson = ['routine_clinic', 'specialist_clinic', 'hospital_priority_high'].includes(recommendationLevel);
  const summaryTitle = core.possibleTypes?.[0] || record.likelyType || record.department || '本次咨询';
  const summaryLines = [core.possibleTypes?.[1], core.severityText || record.severityText].filter(Boolean);
  const careAdvice = Array.from(new Set([...(detail.visitAdvice || []), ...(detail.selfCareAdvice || [])].filter(Boolean)));
  const medicationAdvice = detail.medicationAdvice || [];
  const examAdvice = detail.examAdvice || [];
  const firstChecks = (core.firstChecks || record.firstChecks || []).map((item) => item.name || item).filter(Boolean);
  const files = Array.isArray(record.files) ? record.files : [];
  const conversationItems = Array.isArray(record.conversationItems) ? record.conversationItems.filter((item) => item?.text) : [];
  const sections = [];

  if (careAdvice.length) {
    sections.push(buildPlainResultCardHtml('现在怎么办', buildAdviceListHtml(careAdvice), 'strong'));
  }
  if (medicationAdvice.length) {
    sections.push(buildPlainResultCardHtml('用药建议', buildAdviceListHtml(medicationAdvice)));
  }
  if (needsInPerson && (examAdvice.length || firstChecks.length)) {
    sections.push(
      buildPlainResultCardHtml(
        '第一步检查',
        `${buildAdviceListHtml(examAdvice)}${firstChecks.length ? `<div class="record-checks">${firstChecks.map((item) => `<span class="record-chip">${escapeHtml(item)}</span>`).join('')}</div>` : ''}`,
        'strong'
      )
    );
  }
  if (files.length) {
    sections.push(
      buildPlainResultCardHtml(
        '已保存材料',
        `<div class="detail-file-list">${files
          .map((file) => `<div class="detail-file-item"><strong>${escapeHtml(file.originalName || '-')}</strong>${file.summary?.title ? `<span>${escapeHtml(file.summary.title)}</span>` : '<span>未生成摘要</span>'}</div>`)
          .join('')}</div>`
      )
    );
  }
  if (conversationItems.length) {
    sections.unshift(
      buildPlainResultCardHtml(
        '病情记录',
        `<div class="detail-file-list">${conversationItems
          .map((item) => `<div class="detail-file-item"><strong>${escapeHtml(item.kind === 'chiefComplaint' ? '首次描述' : item.kind === 'answer' ? '问答记录' : '补充信息')}</strong><span>${escapeHtml(item.text)}</span></div>`)
          .join('')}</div>`
      )
    );
  }

  return [
    '<div class="record-detail-stack">',
    '<div class="summary-card">',
    '<div class="summary-top">',
    buildSummarySectionHeading('小科总结'),
    `<p class="summary-title compact">${escapeHtml(summaryTitle)}</p>`,
    ...summaryLines.map((line) => `<p class="summary-text">${escapeHtml(line)}</p>`),
    buildSummarySectionHeading('小科建议'),
    `<div class="summary-next"><strong>${escapeHtml(core.text || record.summaryText || record.summary || '这次咨询已经保存。')}</strong></div>`,
    '</div>',
    '<div class="result-mode-toggle">',
    `<button class="result-mode-btn ${mode === 'full' ? 'active' : ''}" data-record-detail-mode="full">完整版建议</button>`,
    `<button class="result-mode-btn ${mode === 'simple' ? 'active' : ''}" data-record-detail-mode="simple">只看重点</button>`,
    '</div>',
    '</div>',
    mode === 'full' ? `<div class="record-detail-sections">${sections.join('')}</div>` : '',
    `<div class="record-detail-meta"><span class="record-time">${escapeHtml((record.createdAt || '-').slice(0, 16).replace('T', ' '))}</span></div>`,
    '</div>',
  ].join('');
}

function renderRecordDetail(record) {
  $('recordDetailBody').innerHTML = buildRecordDetailView(record, state.activeRecordDetailMode);
  $('recordDetailBody').querySelectorAll('[data-record-detail-mode]').forEach((button) => {
    button.onclick = () => {
      state.activeRecordDetailMode = button.dataset.recordDetailMode;
      renderRecordDetail(record);
    };
  });
}

function openRecordDetail(record) {
  state.activeRecordDetail = record;
  state.activeRecordDetailMode = 'full';
  renderRecordDetail(record);
  $('recordDetailDialog').showModal();
}

async function handleComposerSubmit() {
  const text = $('composerInput').value.trim();
  if (!text) return;

  $('composerInput').value = '';
  syncComposerActions();
  await submitText(text);
}

function bindEvents() {
  $('sendBtn')?.addEventListener('click', () => {
    handleComposerSubmit().catch((err) => alert(err.message));
  });

  $('modeToggleBtn')?.addEventListener('click', () => {
    setComposerMode(state.composerMode === 'text' ? 'voice' : 'text');
  });

  if (state.isTouchDevice) {
    $('voiceCaptureBtn')?.addEventListener('touchstart', startVoiceCapture, { passive: false });
    $('voiceCaptureBtn')?.addEventListener('touchend', stopVoiceCapture, { passive: false });
    $('voiceCaptureBtn')?.addEventListener('touchcancel', stopVoiceCapture, { passive: false });
  } else {
    $('voiceCaptureBtn')?.addEventListener('mousedown', startVoiceCapture);
    $('voiceCaptureBtn')?.addEventListener('mouseup', stopVoiceCapture);
  }
  $('voiceCaptureBtn')?.addEventListener('click', (event) => event.preventDefault());
  $('voiceCaptureBtn')?.addEventListener('contextmenu', (event) => event.preventDefault());
  $('voiceCaptureBtn')?.addEventListener('selectstart', (event) => event.preventDefault());
  document.addEventListener('selectionchange', () => {
    if (state.speechPressing) {
      clearBrowserSelection();
    }
  });

  $('plusBtn')?.addEventListener('click', () => {
    $('plusMenu').classList.toggle('hidden');
  });

  $('plusMenu').querySelectorAll('[data-menu-action]').forEach((button) => {
    button.onclick = () => {
      const action = button.dataset.menuAction;
      $('plusMenu').classList.add('hidden');

      if (action === 'report') $('reportInput').click();
      if (action === 'camera') $('cameraInput').click();
      if (action === 'my') openMyDialog().catch((err) => alert(err.message));
      if (action === 'records') {
        openRecordsDialog('context').catch((err) => alert(err.message));
      }
    };
  });

  $('reportInput').onchange = (event) => handlePickedFile(event.target.files?.[0], '检验报告').catch((err) => alert(err.message));
  $('cameraInput').onchange = (event) => handlePickedFile(event.target.files?.[0], '拍照').catch((err) => alert(err.message));
  $('imageInput').onchange = (event) => handlePickedFile(event.target.files?.[0], '相册').catch((err) => alert(err.message));

  $('composerInput')?.addEventListener('input', () => {
    syncComposerActions();
  });

  $('composerInput')?.addEventListener('keydown', (event) => {
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

  $('closeMyBtn')?.addEventListener('click', () => $('myDialog').close());
  $('closeRecordsBtn')?.addEventListener('click', () => $('recordsDialog').close());
  $('closeRecordDetailBtn')?.addEventListener('click', () => $('recordDetailDialog').close());
  $('closeLoginBtn')?.addEventListener('click', () => {
    pendingAfterLogin = null;
    $('loginDialog').close();
  });
  $('closeShareGuideBtn')?.addEventListener('click', () => $('shareGuideDialog').close());
  $('recordsLoginBtn')?.addEventListener('click', () => {
    requireLogin(async () => {
      syncAuthUi();
      syncMyUi();
      await listRecords();
    }).catch((err) => alert(err.message));
  });
  $('myLoginBtn')?.addEventListener('click', () => {
    requireLogin(async () => {
      syncAuthUi();
      syncMyUi();
    }).catch((err) => alert(err.message));
  });
  $('myRecordsBtn')?.addEventListener('click', () => {
    $('myDialog')?.close();
    openRecordsDialog('browse').catch((err) => alert(err.message));
  });
  $('myLogoutBtn')?.addEventListener('click', () => {
    logoutAuth();
  });
  $('passwordLoginBtn')?.addEventListener('click', () => {
    performPasswordLogin().catch((err) => alert(err.message));
  });
  $('passwordLoginInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      $('passwordLoginBtn').click();
    }
  });
  $('listRecordsBtn')?.addEventListener('click', () => {
    listRecords().catch((err) => alert(err.message));
  });
}

async function loadSharedSession(sessionId) {
  state.sharedView = true;
  state.sessionId = sessionId;
  $('chatFeed').innerHTML = '';
  $('quickRow').classList.add('hidden');
  document.querySelector('.composer-wrap').classList.add('hidden');
  addRow('bot', '<div class="intro-card-inner"><p class="intro-copy"><strong class="intro-accent">这是小科分享给家属的总结页</strong>，你可以直接查看这次建议、费用和挂号信息。</p></div>', 'intro-card');
  const result = await api(`/triage/result/${encodeURIComponent(sessionId)}`);
  syncSnapshotMeta(result.snapshot);
  state.triageResult = result;
  await renderResultCards();
}

async function bootstrap() {
  state.isWeChat = /MicroMessenger/i.test(navigator.userAgent || '');
  state.isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  if (state.isWeChat) {
    const markBridgeReady = () => {
      state.wechatBridgeReady = true;
    };
    document.addEventListener('WeixinJSBridgeReady', markBridgeReady, false);
    if (typeof window.WeixinJSBridge !== 'undefined') {
      markBridgeReady();
    }
  }
  loadAuthState();
  loadSavedRegion();
  if ('speechSynthesis' in window && typeof window.speechSynthesis.onvoiceschanged !== 'undefined') {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices?.();
    };
  }
  renderQuickSymptoms();
  syncAuthUi();
  syncMyUi();
  bindEvents();
  window.addEventListener('beforeunload', saveRuntimeState);
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
  const cachedRuntime = loadRuntimeState();
  if (cachedRuntime?.sessionId) {
    try {
      state.sessionId = cachedRuntime.sessionId;
      state.resultViewMode = cachedRuntime.resultViewMode || 'full';
      state.showBookingPanel = Boolean(cachedRuntime.showBookingPanel);
      state.resultAnchor = cachedRuntime.resultAnchor || 'summary';
      if (cachedRuntime.currentFocus?.key) {
        setCurrentFocus(cachedRuntime.currentFocus);
      }
      if (cachedRuntime.profile) {
        state.profile = { ...state.profile, ...cachedRuntime.profile };
      }
      $('quickRow').classList.add('hidden');
      const restored = await api(`/triage/session/${encodeURIComponent(cachedRuntime.sessionId)}/state`);
      state.conversationStage = restored.conversationStage || 'idle';
      if (restored.profile) {
        state.profile = { ...state.profile, ...restored.profile };
      }
      if (restored.currentFocus?.key) {
        setCurrentFocus(restored.currentFocus);
      }
      if (restored.hasResult) {
        const result = await api(`/triage/result/${encodeURIComponent(cachedRuntime.sessionId)}`);
        syncSnapshotMeta(result.snapshot);
        state.triageResult = result;
        await renderResultCards();
        return;
      }
      resetConversation();
      state.sessionId = cachedRuntime.sessionId;
      $('quickRow').classList.add('hidden');
      if (restored.currentPrompt?.type === 'text') {
        state.currentPrompt = restored.currentPrompt;
        state.conversationStage = restored.conversationStage || 'open';
        await addBotText(restored.currentPrompt.text);
        saveRuntimeState();
        return;
      }
      if (restored.currentQuestion) {
        state.currentQuestion = null;
        state.followUpProgress = restored.progress || null;
        state.conversationStage = 'structured';
        await askQuestion(restored.currentQuestion);
        saveRuntimeState();
        return;
      }
    } catch (_error) {
      clearRuntimeState();
    }
  }
  resetConversation();
}

bootstrap().catch((err) => alert(err.message));
