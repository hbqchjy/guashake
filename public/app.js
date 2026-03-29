const QUICK_SYMPTOMS = ['心慌', '胸闷', '头晕', '腰酸', '肚子痛', '咳嗽', '尿频尿急', '皮肤/外伤'];

const state = {
  sessionId: null,
  currentQuestion: null,
  questionCount: 0,
  maxQuestions: 5,
  triageResult: null,
  booking: null,
  cost: null,
};

const $ = (id) => document.getElementById(id);

function setPage(pageId) {
  ['homePage', 'chatPage', 'resultPage'].forEach((id) => {
    $(id).classList.toggle('active', id === pageId);
  });
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '请求失败');
  }

  return res.json();
}

function renderQuickSymptoms() {
  const box = $('quickSymptoms');
  box.innerHTML = '';

  QUICK_SYMPTOMS.forEach((symptom) => {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.textContent = symptom;
    btn.onclick = () => {
      const input = $('chiefComplaint');
      const old = input.value.trim();
      input.value = old ? `${old}、${symptom}` : symptom;
      input.focus();
    };
    box.appendChild(btn);
  });
}

function updateProgress() {
  const done = Math.max(1, state.questionCount + 1);
  const text = `第${Math.min(done, state.maxQuestions)}步 / 共${state.maxQuestions}步`;
  $('progressText').textContent = text;
  $('progressBar').style.width = `${Math.min(100, Math.round((done / state.maxQuestions) * 100))}%`;
}

function addMessage(role, text) {
  const row = document.createElement('div');
  row.className = `msg ${role}`;
  row.innerHTML = `<div class="bubble">${text}</div>`;
  $('chatBox').appendChild(row);
  $('chatBox').scrollTop = $('chatBox').scrollHeight;
}

function fillList(el, items) {
  el.innerHTML = '';
  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    el.appendChild(li);
  });
}

function renderOptions(options) {
  const box = $('options');
  box.innerHTML = '';

  options.forEach((opt) => {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = opt;
    btn.onclick = () => answerQuestion(opt).catch((e) => alert(e.message));
    box.appendChild(btn);
  });
}

function renderQuestion(question) {
  state.currentQuestion = question;
  state.questionCount += 1;
  updateProgress();
  addMessage('bot', question.text);
  renderOptions(question.options || []);
}

async function startConsultation() {
  const chiefComplaint = $('chiefComplaint').value.trim();
  if (!chiefComplaint) {
    alert('请先输入哪里不舒服');
    return;
  }

  const payload = {
    chiefComplaint,
    age: $('age').value || undefined,
    gender: $('gender').value || undefined,
    province: $('province').value || undefined,
    city: $('city').value || undefined,
    district: $('district').value || undefined,
    insuranceType: $('insuranceType').value || undefined,
  };

  const data = await api('/triage/session', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  state.sessionId = data.sessionId;
  state.currentQuestion = null;
  state.questionCount = 0;
  state.triageResult = null;
  state.booking = null;
  state.cost = null;

  setPage('chatPage');
  $('chatBox').innerHTML = '';

  addMessage('bot', `收到，你的情况先按“${data.scenario}”方向来判断。`);
  addMessage('bot', '我每次只问一个问题，尽量简单。');
  renderQuestion(data.nextQuestion);
}

async function answerQuestion(answer) {
  if (!state.currentQuestion || !state.sessionId) return;

  addMessage('user', answer);

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
    await showResult();
    return;
  }

  renderQuestion(data.nextQuestion);
}

async function directResult() {
  if (!state.sessionId) return;

  const data = await api('/triage/answer', {
    method: 'POST',
    body: JSON.stringify({ sessionId: state.sessionId, skip: true }),
  });

  if (data.done) {
    state.triageResult = data.triageResult;
    await showResult();
  }
}

async function showResult() {
  const [cost, booking] = await Promise.all([
    api('/cost/estimate', {
      method: 'POST',
      body: JSON.stringify({ sessionId: state.sessionId }),
    }),
    api(`/booking/options?sessionId=${state.sessionId}`),
  ]);

  state.cost = cost;
  state.booking = booking;

  const result = state.triageResult;
  setPage('resultPage');

  $('coreText').textContent = result.layeredOutput.core.text;
  fillList($('coreList'), [
    `建议科室：${result.layeredOutput.core.suggestDepartment}`,
    `建议医院：${result.layeredOutput.core.suggestHospital}`,
    `首轮费用：${result.layeredOutput.core.firstCostRange}`,
  ]);

  fillList(
    $('checkList'),
    (result.layeredOutput.core.firstChecks || []).map((i) => `${i.name}（${i.min}~${i.max}元）`)
  );

  fillList($('costSimple'), [
    `大概先花：${cost.simple.costRange}`,
    `医保参考：${cost.simple.insuranceCoverage}`,
    `更划算建议：${cost.simple.costEffectivePlan}`,
    cost.expanded.insuranceGuide,
  ]);

  fillList($('prepList'), booking.preparation || []);
  fillList($('riskList'), result.layeredOutput.riskReminder || []);

  $('detailText').textContent = result.layeredOutput.detail.whyDepartment;
  fillList($('detailList'), result.layeredOutput.detail.stepByStep || []);
}

async function saveRecord() {
  if (!state.sessionId || !state.triageResult) {
    alert('请先完成咨询');
    return;
  }

  const userId = $('userId').value.trim() || prompt('输入用户ID（为空用guest）', 'guest') || 'guest';

  const formData = new FormData();
  formData.append('userId', userId);
  formData.append('sessionId', state.sessionId);

  const res = await fetch('/archive/upload', {
    method: 'POST',
    body: formData,
  });

  const data = await res.json();
  if (!res.ok) {
    alert(data.error || '保存失败');
    return;
  }

  alert('已保存');
}

function openRecords() {
  $('recordsDialog').showModal();
}

function closeRecords() {
  $('recordsDialog').close();
}

async function listRecords() {
  const userId = $('userId').value.trim() || 'guest';
  const data = await api(`/archive/list?userId=${encodeURIComponent(userId)}`);

  const box = $('recordsList');
  box.innerHTML = '';

  if (!data.records.length) {
    box.innerHTML = '<p>暂无记录</p>';
    return;
  }

  data.records.forEach((record) => {
    const node = document.createElement('div');
    node.className = 'recordItem';

    node.innerHTML = `
      <p><strong>记录：</strong>${record.summary || '-'}</p>
      <p><strong>科室：</strong>${record.department || '-'}</p>
      <p><strong>时间：</strong>${record.createdAt || '-'}</p>
      <div class="actions">
        <a class="btn" target="_blank" href="/archive/export?userId=${encodeURIComponent(userId)}&recordId=${record.id}">导出PDF</a>
        <button class="btn" data-id="${record.id}">删除</button>
      </div>
    `;

    node.querySelector('button').onclick = async () => {
      await api(`/archive/${encodeURIComponent(userId)}/${record.id}`, { method: 'DELETE' });
      await listRecords();
    };

    box.appendChild(node);
  });
}

function bindEvents() {
  $('startBtn').onclick = () => startConsultation().catch((e) => alert(e.message));
  $('directResultBtn').onclick = () => directResult().catch((e) => alert(e.message));
  $('backHomeBtn').onclick = () => setPage('homePage');
  $('restartBtn').onclick = () => setPage('homePage');

  $('bookingBtn').onclick = () => {
    const target = state.booking?.bookingLinks?.[0]?.url;
    if (target) {
      window.open(target, '_blank', 'noopener,noreferrer');
      return;
    }
    alert('暂无挂号入口');
  };

  $('saveBtn').onclick = () => saveRecord().catch((e) => alert(e.message));
  $('openRecordsBtn').onclick = () => openRecords();
  $('viewRecordsBtn').onclick = () => openRecords();
  $('closeRecordsBtn').onclick = () => closeRecords();
  $('listRecordsBtn').onclick = () => listRecords().catch((e) => alert(e.message));
}

renderQuickSymptoms();
bindEvents();
updateProgress();
