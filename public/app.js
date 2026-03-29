const QUICK_SYMPTOMS = ['心慌', '胸闷', '头晕', '腰酸', '肚子痛', '咳嗽', '尿频尿急', '皮肤/外伤'];

const state = {
  sessionId: null,
  currentQuestion: null,
  triageResult: null,
  booking: null,
  cost: null,
  profile: {
    age: '',
    gender: '',
    insuranceType: '',
    province: '',
    city: '',
    district: '',
    regionInput: '',
  },
  regionTimer: null,
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

function addMessage(role, text) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  wrap.innerHTML = `<div class="bubble">${text}</div>`;
  $('chat').appendChild(wrap);
  $('chat').scrollTop = $('chat').scrollHeight;
}

function fillList(el, items) {
  el.innerHTML = '';
  items.forEach((it) => {
    const li = document.createElement('li');
    li.textContent = it;
    el.appendChild(li);
  });
}

function setSegValue(groupId, value) {
  const box = $(groupId);
  box.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
}

function renderQuickSymptoms() {
  const row = $('quickSymptoms');
  row.innerHTML = '';
  QUICK_SYMPTOMS.forEach((s) => {
    const btn = document.createElement('button');
    btn.className = 'q-chip';
    btn.textContent = s;
    btn.onclick = () => {
      const input = $('chiefComplaint');
      const old = input.value.trim();
      input.value = old ? `${old}、${s}` : s;
      input.focus();
    };
    row.appendChild(btn);
  });
}

function renderOptions(options) {
  const dock = $('optionDock');
  const box = $('options');
  box.innerHTML = '';

  if (!options || options.length === 0) {
    dock.classList.add('hidden');
    return;
  }

  dock.classList.remove('hidden');
  options.forEach((opt) => {
    const btn = document.createElement('button');
    btn.className = 'ghost wide';
    btn.textContent = opt;
    btn.onclick = () => answerQuestion(opt).catch((e) => alert(e.message));
    box.appendChild(btn);
  });
}

function showProfileResolved(region) {
  if (!region || !region.province) {
    $('regionResolved').textContent = '';
    return;
  }
  $('regionResolved').textContent = `已匹配：${region.province} ${region.city} ${region.district}`;
}

function setRegion(region) {
  state.profile.province = region.province;
  state.profile.city = region.city;
  state.profile.district = region.district;
  state.profile.regionInput = `${region.province}${region.city}${region.district}`;
  $('regionInput').value = state.profile.regionInput;
  showProfileResolved(region);
}

async function searchRegion(keyword) {
  const data = await api(`/api/region/search?q=${encodeURIComponent(keyword)}`);
  const box = $('regionSuggest');
  box.innerHTML = '';

  if (!data.regions || data.regions.length === 0) {
    box.classList.add('hidden');
    return;
  }

  data.regions.forEach((r) => {
    const btn = document.createElement('button');
    btn.className = 's-item';
    btn.textContent = `${r.district} · ${r.city} · ${r.province}`;
    btn.onclick = () => {
      setRegion(r);
      box.classList.add('hidden');
    };
    box.appendChild(btn);
  });

  box.classList.remove('hidden');
}

async function startConsultation() {
  const chiefComplaint = $('chiefComplaint').value.trim();
  if (!chiefComplaint) {
    alert('先输入哪里不舒服');
    return;
  }

  state.profile.age = $('age').value.trim();
  state.profile.regionInput = $('regionInput').value.trim();

  const payload = {
    chiefComplaint,
    age: state.profile.age || undefined,
    gender: state.profile.gender || undefined,
    insuranceType: state.profile.insuranceType || undefined,
    province: state.profile.province || undefined,
    city: state.profile.city || undefined,
    district: state.profile.district || state.profile.regionInput || undefined,
  };

  const data = await api('/triage/session', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  state.sessionId = data.sessionId;
  state.currentQuestion = data.nextQuestion;
  state.triageResult = null;
  state.booking = null;
  state.cost = null;

  $('optionDock').classList.remove('hidden');
  $('resultSheet').classList.add('hidden');
  $('chat').innerHTML = '';

  addMessage('bot', `收到，我会按“${data.scenario}”方向帮你判断。`);
  addMessage('bot', '我每次只问一个问题，你点按钮就行。');
  addMessage('bot', data.nextQuestion.text);
  renderOptions(data.nextQuestion.options);
}

async function answerQuestion(answer) {
  if (!state.sessionId || !state.currentQuestion) return;

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

  state.currentQuestion = data.nextQuestion;
  addMessage('bot', data.nextQuestion.text);
  renderOptions(data.nextQuestion.options);
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
  $('resultSheet').classList.remove('hidden');

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

  addMessage('bot', '建议已生成，你可以在下方查看完整卡片。');
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
    const row = document.createElement('div');
    row.className = 'record';
    row.innerHTML = `
      <p><strong>记录：</strong>${record.summary || '-'}</p>
      <p><strong>科室：</strong>${record.department || '-'}</p>
      <p><strong>时间：</strong>${record.createdAt || '-'}</p>
      <div class="sheet-actions">
        <a class="ghost" target="_blank" href="/archive/export?userId=${encodeURIComponent(userId)}&recordId=${record.id}">导出PDF</a>
        <button class="ghost" data-id="${record.id}">删除</button>
      </div>
    `;
    row.querySelector('button').onclick = async () => {
      await api(`/archive/${encodeURIComponent(userId)}/${record.id}`, { method: 'DELETE' });
      await listRecords();
    };
    box.appendChild(row);
  });
}

function bindSegControls() {
  $('genderGroup').querySelectorAll('.seg-btn').forEach((btn) => {
    btn.onclick = () => {
      state.profile.gender = btn.dataset.value;
      setSegValue('genderGroup', state.profile.gender);
    };
  });

  $('insuranceGroup').querySelectorAll('.seg-btn').forEach((btn) => {
    btn.onclick = () => {
      state.profile.insuranceType = btn.dataset.value;
      setSegValue('insuranceGroup', state.profile.insuranceType);
    };
  });
}

function bindRegionInput() {
  $('regionInput').addEventListener('input', () => {
    const q = $('regionInput').value.trim();
    state.profile.regionInput = q;

    if (state.regionTimer) clearTimeout(state.regionTimer);
    if (!q) {
      $('regionSuggest').classList.add('hidden');
      showProfileResolved(null);
      return;
    }

    state.regionTimer = setTimeout(() => {
      searchRegion(q).catch(() => $('regionSuggest').classList.add('hidden'));
    }, 180);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.region-wrap')) {
      $('regionSuggest').classList.add('hidden');
    }
  });
}

function bindEvents() {
  $('openProfileBtn').onclick = () => {
    $('profilePanel').classList.remove('hidden');
    $('profilePanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $('closeProfileBtn').onclick = () => $('profilePanel').classList.add('hidden');

  $('sendBtn').onclick = () => {
    if (state.sessionId && state.currentQuestion) {
      alert('请先回答当前问题，或点“直接给建议”');
      return;
    }
    startConsultation().catch((e) => alert(e.message));
  };

  $('directResultBtn').onclick = () => directResult().catch((e) => alert(e.message));

  $('openRecordsBtn').onclick = () => $('recordsDialog').showModal();
  $('viewRecordsBtn').onclick = () => $('recordsDialog').showModal();
  $('closeRecordsBtn').onclick = () => $('recordsDialog').close();
  $('listRecordsBtn').onclick = () => listRecords().catch((e) => alert(e.message));

  $('closeResultBtn').onclick = () => $('resultSheet').classList.add('hidden');
  $('restartBtn').onclick = () => {
    state.sessionId = null;
    state.currentQuestion = null;
    state.triageResult = null;
    $('resultSheet').classList.add('hidden');
    $('optionDock').classList.add('hidden');
    $('chat').innerHTML = '';
    $('chiefComplaint').value = '';
    addMessage('bot', '已重置。你可以重新描述不舒服的地方。');
  };

  $('bookingBtn').onclick = () => {
    const target = state.booking?.bookingLinks?.[0]?.url;
    if (!target) {
      alert('暂无挂号入口');
      return;
    }
    window.open(target, '_blank', 'noopener,noreferrer');
  };

  $('saveBtn').onclick = () => saveRecord().catch((e) => alert(e.message));

  $('chiefComplaint').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      $('sendBtn').click();
    }
  });
}

renderQuickSymptoms();
bindSegControls();
bindRegionInput();
bindEvents();
addMessage('bot', '你好，我是挂啥科助手。先说哪里不舒服，我来一步步帮你判断。');
