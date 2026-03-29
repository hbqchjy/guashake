const QUICK_SYMPTOMS = ['心慌', '胸闷', '头晕', '腰酸', '肚子痛', '咳嗽', '尿频尿急', '皮肤/外伤'];
const INSURANCE_OPTIONS = ['无医保', '体制内医保', '城镇职工医保', '城乡居民医保'];

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
};

const $ = (id) => document.getElementById(id);

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

function addChoiceBlock(title, options, onPick, note = '') {
  clearActiveChoiceBlock();

  const row = addRow('bot', '', 'choice-card');
  const bubble = row.querySelector('.bubble');

  const titleHtml = `<p>${escapeHtml(title)}</p>`;
  const noteHtml = note ? `<div class="choice-note">${escapeHtml(note)}</div>` : '';
  bubble.innerHTML = `${titleHtml}<div class="choice-grid"></div>${noteHtml}`;

  const grid = bubble.querySelector('.choice-grid');
  options.forEach((option) => {
    const button = document.createElement('button');
    button.className = 'choice-btn';
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
      '<div class="eyebrow">看病前先把方向问清楚</div>',
      '<div class="intro-card-inner">',
      '<h1>先说哪里不舒服，其他信息我会在需要的时候再问。</h1>',
      '<p>我先帮你判断挂什么科、先做哪些基础检查。到了需要推荐医院和估费用的时候，我再问地区和医保。</p>',
      '<div class="intro-tags">',
      '<span>不先填表</span>',
      '<span>一步一步问</span>',
      '<span>先结论再解释</span>',
      '<span>只收必要信息</span>',
      '</div>',
      '</div>',
    ].join(''),
    'intro-card'
  );
  return row;
}

function renderQuickSymptoms() {
  const row = $('quickRow');
  row.innerHTML = '';

  QUICK_SYMPTOMS.forEach((symptom) => {
    const button = document.createElement('button');
    button.className = 'quick-chip';
    button.textContent = symptom;
    button.onclick = () => {
      $('composerInput').value = symptom;
      $('composerInput').focus();
    };
    row.appendChild(button);
  });
}

function askQuestion(question, note = '如果你不想继续回答，也可以直接生成建议。') {
  state.currentQuestion = question;
  addBotText(question.text);
  addChoiceBlock(
    '点一个最接近的答案',
    [
      ...question.options.map((label) => ({ label, type: 'answer' })),
      { label: '直接给建议', type: 'skip' },
    ],
    async (option) => {
      if (option.type === 'skip') {
        await directResult();
        return;
      }
      await answerQuestion(option.label);
    },
    note
  );
  setComposerState('locked');
}

function setComposerState(mode) {
  state.inputMode = mode;

  if (mode === 'region') {
    $('composerInput').placeholder = '输入县 / 区 / 市名，例如：隆回县、朝阳区、杭州';
    $('composerHint').textContent = '只输入一个地区名就行，我会自动匹配省市区。';
    return;
  }

  if (mode === 'locked') {
    $('composerInput').placeholder = '当前问题请直接点选下面的按钮';
    $('composerHint').textContent = '这个问题不需要打字，直接点一下选项。';
    return;
  }

  $('composerInput').placeholder = '直接说哪里不舒服，例如：最近心慌、胸闷、头晕';
  $('composerHint').textContent = '我会先问最必要的问题，不会一上来堆很多选项。';
}

function resetConversation() {
  state.sessionId = null;
  state.currentQuestion = null;
  state.triageResult = null;
  state.booking = null;
  state.cost = null;
  state.awaitingContext = null;
  state.activeChoiceBlock = null;
  state.profile = {
    province: '',
    city: '',
    district: '',
    insuranceType: '',
  };

  $('chatFeed').innerHTML = '';
  $('composerInput').value = '';
  addIntroCard();
  addBotText('直接告诉我哪里不舒服。我先听你说，再一步步追问。');
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

  addBotText(`先按“${data.scenario}”方向帮你判断。`);
  askQuestion(data.nextQuestion);
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
    await ensureContextAndRenderResult();
    return;
  }

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
    addBotText('为了给你推荐就近医院和费用范围，我还差一个地区。你直接输入县、区或市名就行。');
    setComposerState('region');
    $('composerInput').focus();
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
  addBotText('再告诉我你的医保类型，我就把费用和报销参考补全。');
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

async function selectRegion(region) {
  state.profile.province = region.province;
  state.profile.city = region.city;
  state.profile.district = region.district;
  state.awaitingContext = null;
  addBotText(`地区已确认：${region.province}${region.city}${region.district}`);
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

  buildResultCard(
    '先去哪个科',
    [
      `<p>${escapeHtml(triage.core.text)}</p>`,
      '<ul>',
      `<li>${escapeHtml(`建议科室：${triage.core.suggestDepartment}`)}</li>`,
      `<li>${escapeHtml(`建议医院：${triage.core.suggestHospital}`)}</li>`,
      `<li>${escapeHtml(`首轮费用：${triage.core.firstCostRange}`)}</li>`,
      '</ul>',
    ].join(''),
    'strong'
  );

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
      '<div class="result-card">',
      '<h3>下一步</h3>',
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

  if (state.awaitingContext === 'region') {
    addUserText(text);
    await handleRegionInput(text);
    return;
  }

  if (!state.sessionId) {
    addUserText(text);
    await startSymptomSession(text);
    return;
  }

  if (state.currentQuestion) {
    addBotText('当前这个问题直接点下面的选项更准确。');
    return;
  }

  addBotText('如果你要重新开始，点结果卡里的“重新咨询”。');
}

function bindEvents() {
  $('sendBtn').onclick = () => {
    handleComposerSubmit().catch((err) => alert(err.message));
  };

  $('composerInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      $('sendBtn').click();
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
