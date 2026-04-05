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
  if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const created = await post('/triage/session', { chiefComplaint: '胃不舒服，反酸烧心', age: 36, gender: '男' });
  const sid = created.sessionId;

  let current = await post('/triage/message', { sessionId: sid, message: '两天了，饭后更明显，没有发烧，也没有呕血黑便' });
  const openFollowups = [
    '上腹为主，有点胀气，食欲一般',
    '没有明显腹泻，喝热水会稍微舒服一点',
    '主要是饭后反酸和烧心，晚上躺下更明显',
  ];
  for (const text of openFollowups) {
    if (current.mode === 'question') break;
    current = await post('/triage/message', { sessionId: sid, message: text });
  }
  assert(current.mode === 'question', 'should enter structured mode before supplement refresh test');

  for (let i = 0; i < 3 && current.nextQuestion; i += 1) {
    const q = current.nextQuestion;
    current = await post('/triage/answer', { sessionId: sid, questionId: q.id, answer: q.options[0] });
  }

  const supp1 = await post('/triage/supplement', { sessionId: sid, supplement: '后来又开始黑便，而且头晕乏力' });
  assert(supp1.forceImmediateResult === true, 'high-risk supplement should force immediate result');
  assert(supp1.impactLevel === 'major', 'high-risk supplement should be major');

  const supp2 = await post('/triage/supplement', { sessionId: sid, supplement: '补充一下，刚才看错了，不是黑便，就是普通深褐色，头晕也没有了' });
  assert(supp2.refreshSummary === true, 'clarification should still allow refresh');
  assert(supp2.affectsSummary === true, 'clarification should affect summary');
  assert(supp2.impactLevel === 'minor', 'clarification should de-escalate to minor');

  console.log('supplement refresh smoke ok');
})().catch((error) => {
  console.error('supplement refresh smoke failed:', error.message);
  process.exit(1);
});
