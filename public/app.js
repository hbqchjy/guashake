const state = {
  sessionId: null,
  currentQuestion: null,
  triageResult: null,
};

const $ = (id) => document.getElementById(id);

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

function show(id) {
  $(id).classList.remove('hidden');
}

function fillList(el, items) {
  el.innerHTML = '';
  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    el.appendChild(li);
  });
}

function renderQuestion(question) {
  state.currentQuestion = question;
  $('questionText').textContent = question.text;
  const optionsBox = $('options');
  optionsBox.innerHTML = '';
  question.options.forEach((opt) => {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = opt;
    btn.onclick = () => answerQuestion(opt);
    optionsBox.appendChild(btn);
  });
}

async function startTriage() {
  const payload = {
    age: $('age').value,
    gender: $('gender').value,
    province: $('province').value,
    city: $('city').value,
    district: $('district').value,
    insuranceType: $('insuranceType').value,
    chiefComplaint: $('chiefComplaint').value,
  };

  if (!payload.chiefComplaint.trim()) {
    alert('请先填写“主要不舒服”');
    return;
  }

  const data = await api('/triage/session', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  state.sessionId = data.sessionId;
  $('scenarioTag').textContent = `匹配场景：${data.scenario}`;
  show('questionCard');
  renderQuestion(data.nextQuestion);
}

async function answerQuestion(answer, skip = false) {
  const payload = {
    sessionId: state.sessionId,
    skip,
  };

  if (!skip) {
    payload.questionId = state.currentQuestion.id;
    payload.answer = answer;
  }

  const data = await api('/triage/answer', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (data.done) {
    state.triageResult = data.triageResult;
    renderTriageResult(data.triageResult);
    await loadCostAndBooking();
    return;
  }

  renderQuestion(data.nextQuestion);
}

function renderTriageResult(result) {
  show('resultCard');
  const riskBanner = $('riskBanner');
  riskBanner.className = `risk ${result.riskLevel === 'urgent' ? 'urgent' : 'normal'}`;
  riskBanner.textContent = `风险等级：${result.confidence}`;

  $('coreText').textContent = result.layeredOutput.core.text;
  fillList($('coreList'), [
    `建议医院：${result.layeredOutput.core.suggestHospital}`,
    `建议科室：${result.layeredOutput.core.suggestDepartment}`,
    `首轮费用：${result.layeredOutput.core.firstCostRange}`,
  ]);

  $('whyDepartment').textContent = result.layeredOutput.detail.whyDepartment;
  fillList($('detailList'), result.layeredOutput.detail.stepByStep);
  fillList($('riskList'), result.layeredOutput.riskReminder);
}

async function loadCostAndBooking() {
  const cost = await api('/cost/estimate', {
    method: 'POST',
    body: JSON.stringify({ sessionId: state.sessionId }),
  });
  show('costCard');
  fillList($('costSimple'), [
    `先花多少钱：${cost.simple.costRange}`,
    `医保参考：${cost.simple.insuranceCoverage}`,
    `哪里更划算：${cost.simple.costEffectivePlan}`,
    `是否追加检查：${cost.simple.needMoreChecks}`,
  ]);

  fillList($('costExpanded'), [
    ...cost.expanded.feeItems.map((i) => `${i.name}: ${i.min}~${i.max}元`),
    ...cost.expanded.ifThen,
    `医保说明：${cost.expanded.insuranceGuide}`,
    `更新时间：${cost.updatedAt}，覆盖等级：${cost.coverageTier}`,
    cost.expanded.disclaimer,
  ]);

  const booking = await api(`/booking/options?sessionId=${state.sessionId}`);
  show('bookingCard');
  fillList($('bookingList'), [
    `建议医院：${booking.hospitalSuggestion}`,
    `建议科室：${booking.department}`,
    `建议号别：${booking.ticketType}`,
    `就诊时机：${booking.urgency}`,
    `去前准备：${booking.preparation.join('、')}`,
  ]);

  const linkBox = $('bookingLinks');
  linkBox.innerHTML = '';
  booking.bookingLinks.forEach((l) => {
    const a = document.createElement('a');
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.href = l.url;
    a.textContent = l.label;
    linkBox.appendChild(a);
  });

  show('archiveCard');
}

async function saveArchive() {
  if (!state.sessionId || !state.triageResult) {
    alert('请先完成预诊');
    return;
  }

  const formData = new FormData();
  formData.append('userId', $('userId').value || 'guest');
  formData.append('sessionId', state.sessionId);
  formData.append('doctorAdvice', $('doctorAdvice').value || '');

  const files = $('files').files;
  for (const file of files) {
    formData.append('files', file);
  }

  const res = await fetch('/archive/upload', {
    method: 'POST',
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || '保存失败');
    return;
  }

  alert('保存成功');
  await listArchive();
}

async function listArchive() {
  const userId = $('userId').value || 'guest';
  const data = await api(`/archive/list?userId=${encodeURIComponent(userId)}`);
  const box = $('archiveList');

  if (!data.records.length) {
    box.innerHTML = '<p>暂无档案记录</p>';
    return;
  }

  box.innerHTML = '';
  data.records.forEach((record) => {
    const item = document.createElement('div');
    item.className = 'resultBlock';
    const fileText = (record.files || []).map((f) => f.originalName).join('、') || '无';
    item.innerHTML = `
      <p><strong>记录：</strong>${record.summary}</p>
      <p><strong>科室：</strong>${record.department || '-'}</p>
      <p><strong>资料：</strong>${fileText}</p>
      <div class="actionRow">
        <a class="btn" href="/archive/export?userId=${encodeURIComponent(userId)}&recordId=${record.id}" target="_blank">导出PDF</a>
        <button class="btn" data-id="${record.id}">删除</button>
      </div>
    `;
    item.querySelector('button').onclick = async () => {
      await api(`/archive/${encodeURIComponent(userId)}/${record.id}`, { method: 'DELETE' });
      await listArchive();
    };
    box.appendChild(item);
  });
}

$('startBtn').onclick = () => startTriage().catch((e) => alert(e.message));
$('skipBtn').onclick = () => answerQuestion('', true).catch((e) => alert(e.message));
$('saveArchiveBtn').onclick = () => saveArchive().catch((e) => alert(e.message));
$('listArchiveBtn').onclick = () => listArchive().catch((e) => alert(e.message));
