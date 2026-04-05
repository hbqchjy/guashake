const base = process.env.GUASHAKE_BASE_URL || 'http://127.0.0.1:3000';

async function post(path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`invalid json from ${path}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`${path} ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const created = await post('/triage/session', {
    chiefComplaint: '我肚子痛，还拉肚子',
    age: 35,
    gender: '男',
  });
  assert(created.conversationStage === 'open', 'session should start in open stage');
  assert(!created.immediateResult, 'must not return immediate result on first turn');

  const sid = created.sessionId;
  const turn1 = await post('/triage/message', {
    sessionId: sid,
    message: '今天开始，肚子是绞着疼，已经拉了三次，都是稀水样',
  });
  assert(turn1.mode === 'text', 'first follow-up should remain open text');

  const turn2 = await post('/triage/message', {
    sessionId: sid,
    message: '没有血，没有黏液，有点恶心，没有发烧',
  });
  assert(turn2.mode === 'question', 'second follow-up should switch to structured question');
  assert(turn2.nextQuestion && turn2.nextQuestion.id, 'structured question missing');
  assert(turn2.progress && turn2.progress.current === 1, 'structured progress should start at 1');

  let current = turn2;
  for (let i = 1; i <= 2; i += 1) {
    const q = current.nextQuestion;
    const answer = Array.isArray(q.options) && q.options.length ? q.options[0] : '是';
    current = await post('/triage/answer', {
      sessionId: sid,
      questionId: q.id,
      answer,
    });
    assert(!current.done, `should not finish after structured answer ${i}`);
    assert(!current.needsConfirmation, `should not ask for confirmation before 3 structured answers (${i})`);
    assert(!current.immediateResult, `should not jump to result before 3 structured answers (${i})`);
  }

  console.log('smoke ok');
})().catch((error) => {
  console.error('smoke failed:', error.message);
  process.exit(1);
});
