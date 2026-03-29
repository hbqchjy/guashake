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
};

const $ = (id) => document.getElementById(id);

const ICONS = {
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a3 3 0 0 1 3 3v5a3 3 0 1 1-6 0V7a3 3 0 0 1 3-3Z"></path><path d="M19 11a7 7 0 0 1-14 0"></path><path d="M12 18v3"></path><path d="M8 21h8"></path></svg>',
  keyboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"></rect><path d="M7 10h.01M11 10h.01M15 10h.01M17 10h.01M7 14h.01M10 14h.01M13 14h4"></path></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>',
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

function addBotText(text) {
  return addRow('bot', `<p>${escapeHtml(text)}</p>`);
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

function addChoiceBlock(title, options, onPick, note = '', meta = '') {
  clearActiveChoiceBlock();

  const row = addRow('bot', '', 'choice-card');
  const bubble = row.querySelector('.bubble');

  const titleHtml = `<p>${escapeHtml(title)}</p>`;
  const noteHtml = note ? `<div class="choice-note">${escapeHtml(note)}</div>` : '';
  const metaHtml = meta ? `<div class="choice-meta">${escapeHtml(meta)}</div>` : '';
  bubble.innerHTML = `<div class="choice-head">${metaHtml}${titleHtml}${noteHtml}</div><div class="choice-grid"></div>`;

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
    button.textContent = symptom;
    button.onclick = () => submitText(symptom).catch((err) => alert(err.message));
    row.appendChild(button);
  });
}

function askQuestion(question, note = '如果你不想继续回答，也可以直接生成建议。') {
  state.currentQuestion = question;
  const progress = state.followUpProgress
    ? `第 ${state.followUpProgress.current} / ${state.followUpProgress.total} 步`
    : '一步一步来';
  addChoiceBlock(
    question.text,
    [
      ...question.options.map((label) => ({ label, type: 'answer' })),
      { label: '我不清楚', type: 'unknown' },
      { label: '直接给建议', type: 'skip' },
    ],
    async (option) => {
      if (option.type === 'skip') {
        await directResult();
        return;
      }
      await answerQuestion(option.type === 'unknown' ? '我不清楚' : option.label);
    },
    note,
    progress
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

  addBotText(`先按“${data.scenario}”方向帮你判断。`);
  askQuestion(data.nextQuestion);
}

async function submitText(text) {
  const value = String(text || '').trim();
  if (!value) return;

  if (state.awaitingContext === 'region') {
    addUserText(value);
    await handleRegionInput(value);
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
    await ensureContextAndRenderResult();
    return;
  }

  state.followUpProgress = data.progress || null;
  askQuestion(data.nextQuestion, '如果你已经不想继续答了，也可以直接生成建议。');
}

async function directResult() {
  const data = await api('/triage/answer', {
    method: 'POST',
    body: JSON.stringify({ sessionId: state.sessionId, skip: true }),
  });
  state.triageResult = data.triageResult;
  await ensureContextAndRenderResult();
}

async function ensureContextAndRenderResult() {
  state.currentQuestion = null;
  clearActiveChoiceBlock();

  if (!state.profile.district) {
    state.awaitingContext = 'region';
    await promptRegionConfirmation();
    return;
  }

  if (!state.profile.insuranceType) {
    state.awaitingContext = 'insurance';
    askInsuranceType();
    return;
  }

  await renderResultCards();
}

function askInsuranceType() {
  addBotText('再告诉我你的医保类型，小科就把费用和报销参考补全。');
  addChoiceBlock(
    '选择一个最接近的医保类型',
    INSURANCE_OPTIONS.map((label) => ({ label })),
    async ({ label }) => {
      state.profile.insuranceType = label;
      state.awaitingContext = null;
      setComposerState('symptom');
      await renderResultCards();
    }
  );
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

  addBotText('我匹配到了几个可能的地区，你点一个。');
  addChoiceBlock(
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
  if (!forceRetry && state.autoLocateTried) {
    addBotText('为了给你推荐就近医院和费用范围，你可以确认一下地区，或者手动改。');
    setComposerState('region');
    $('composerInput').focus();
    return;
  }

  state.autoLocateTried = true;
  addBotText('我先按你现在的位置补一个地区，你确认一下。');

  try {
    const region = await detectCurrentRegion();
    if (!region) {
      addBotText('我这次没拿到准确地区。你可以直接改成县、区或市名。');
      setComposerState('region');
      $('composerInput').focus();
      return;
    }

    addChoiceBlock(
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
        addBotText('你直接输入县、区或市名就行，我会自动补全。');
        setComposerState('region');
        $('composerInput').focus();
      },
      '如果定位不准，你再改。'
    );
  } catch (_error) {
    addBotText('定位没有成功。你可以直接输入县、区或市名。');
    setComposerState('region');
    $('composerInput').focus();
  }
}

async function selectRegion(region) {
  state.profile.province = region.province;
  state.profile.city = region.city;
  state.profile.district = region.district;
  state.awaitingContext = null;
  addBotText(`地区已确认：${formatRegion(region)}`);
  setComposerState('symptom');
  await ensureContextAndRenderResult();
}

function buildResultCard(title, contentHtml, extraClass = '') {
  return addRow(
    'bot',
    `<div class="result-card ${extraClass}"><h3>${escapeHtml(title)}</h3>${contentHtml}</div>`
  );
}

async function renderResultCards() {
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
  const firstChecks = (triage.core.firstChecks || [])
    .map((item) => `<li>${escapeHtml(`${item.name}（${item.min}~${item.max}元）`)}</li>`)
    .join('');
  const costItems = [
    `大概先花：${cost.simple.costRange}`,
    `医保参考：${cost.simple.insuranceCoverage}`,
    `更划算建议：${cost.simple.costEffectivePlan}`,
    cost.expanded.insuranceGuide,
  ]
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');
  const prepItems = (booking.preparation || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const riskItems = (triage.riskReminder || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const detailItems = (triage.detail.stepByStep || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const summaryHtml = [
    '<div class="summary-card">',
    '<div class="summary-top">',
    '<span class="summary-badge">小科总结</span>',
    `<p class="summary-title">${escapeHtml(triage.core.suggestDepartment)}</p>`,
    `<p class="summary-text">${escapeHtml(triage.core.text)}</p>`,
    '</div>',
    '<div class="summary-metrics">',
    `<div class="summary-metric"><span class="summary-label">建议医院</span><strong>${escapeHtml(triage.core.suggestHospital)}</strong></div>`,
    `<div class="summary-metric"><span class="summary-label">首轮费用</span><strong>${escapeHtml(triage.core.firstCostRange)}</strong></div>`,
    `<div class="summary-metric"><span class="summary-label">医保参考</span><strong>${escapeHtml(cost.simple.insuranceCoverage)}</strong></div>`,
    '</div>',
    '</div>',
  ].join('');
  addRow('bot', summaryHtml, 'summary-shell');

  buildResultCard('第一步检查', `<ul>${firstChecks}</ul>`);
  buildResultCard('费用与医保', `<ul>${costItems}</ul>`);
  buildResultCard('去医院前带什么', `<ul>${prepItems}</ul>`);
  buildResultCard('风险提醒', `<ul>${riskItems}</ul>`, 'risk');
  buildResultCard(
    '为什么这样建议',
    `<p>${escapeHtml(triage.detail.whyDepartment)}</p><ul>${detailItems}</ul>`
  );

  addRow(
    'bot',
    [
      '<div class="result-card action-card">',
      '<div class="action-head">',
      '<h3>下一步</h3>',
      '<p>先挂号，还是先把这次结果存下来。</p>',
      '</div>',
      '<div class="result-actions">',
      '<button class="result-action primary" data-action="booking">去挂号</button>',
      '<button class="result-action" data-action="save">保存记录</button>',
      '<button class="result-action" data-action="records">查看记录</button>',
      '<button class="result-action" data-action="restart">重新咨询</button>',
      '</div>',
      '</div>',
    ].join('')
  );

  const actionRow = $('chatFeed').lastElementChild;
  actionRow.querySelector('[data-action="booking"]').onclick = () => {
    const target = state.booking?.bookingLinks?.[0]?.url;
    if (!target) {
      addBotText('当前没有可直接打开的挂号入口。');
      return;
    }
    window.open(target, '_blank', 'noopener,noreferrer');
  };
  actionRow.querySelector('[data-action="save"]').onclick = () => {
    saveRecord().catch((err) => alert(err.message));
  };
  actionRow.querySelector('[data-action="records"]').onclick = () => {
    $('recordsDialog').showModal();
  };
  actionRow.querySelector('[data-action="restart"]').onclick = () => {
    resetConversation();
  };
}

async function saveRecord() {
  if (!state.sessionId || !state.triageResult) {
    alert('请先完成咨询');
    return;
  }

  const userId = $('userId').value.trim() || prompt('输入用户ID（为空用 guest）', 'guest') || 'guest';
  const formData = new FormData();
  formData.append('userId', userId);
  formData.append('sessionId', state.sessionId);

  await api('/archive/upload', {
    method: 'POST',
    body: formData,
  });

  addBotText('这次结果已经帮你保存了。');
}

function handlePickedFile(file, label) {
  if (!file) return;
  addUserText(`${label}：${file.name}`);
  addBotText('我先记下这个文件。后面你保存记录时，可以继续把它们整理进健康档案。');
}

async function handleLocationShare() {
  addUserText('使用当前位置');
  await promptRegionConfirmation(true);
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

async function listRecords() {
  const userId = $('userId').value.trim() || 'guest';
  const data = await api(`/archive/list?userId=${encodeURIComponent(userId)}`);
  const list = $('recordsList');
  list.innerHTML = '';

  if (!data.records.length) {
    list.innerHTML = '<p>暂无记录</p>';
    return;
  }

  data.records.forEach((record) => {
    const item = document.createElement('div');
    item.className = 'record-item';
    item.innerHTML = [
      `<p><strong>记录：</strong>${escapeHtml(record.summary || '-')}</p>`,
      `<p><strong>科室：</strong>${escapeHtml(record.department || '-')}</p>`,
      `<p><strong>时间：</strong>${escapeHtml(record.createdAt || '-')}</p>`,
      '<div class="record-actions">',
      `<a class="record-action" target="_blank" href="/archive/export?userId=${encodeURIComponent(userId)}&recordId=${record.id}">导出 PDF</a>`,
      `<button class="record-action" data-delete="${record.id}">删除</button>`,
      '</div>',
    ].join('');
    item.querySelector('[data-delete]').onclick = async () => {
      await api(`/archive/${encodeURIComponent(userId)}/${record.id}`, {
        method: 'DELETE',
      });
      await listRecords();
    };
    list.appendChild(item);
  });
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
      if (action === 'location') {
        handleLocationShare().catch((err) => alert(err.message));
      }
    };
  });

  $('reportInput').onchange = (event) => handlePickedFile(event.target.files?.[0], '检验报告');
  $('cameraInput').onchange = (event) => handlePickedFile(event.target.files?.[0], '拍照');
  $('imageInput').onchange = (event) => handlePickedFile(event.target.files?.[0], '相册');

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
  $('listRecordsBtn').onclick = () => {
    listRecords().catch((err) => alert(err.message));
  };
}

renderQuickSymptoms();
bindEvents();
resetConversation();
