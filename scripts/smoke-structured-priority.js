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

const acceptedSlots = {
  digestive: new Set(['bowelChange', 'feverVomiting', 'location', 'duration', 'mealRelation', 'appetite', 'refluxBloating']),
  cardio: new Set(['pain', 'breath', 'dizziness', 'duration', 'frequency', 'associatedSymptoms']),
  respiratory: new Set(['breath', 'feverDuration', 'sputum', 'duration', 'upperRespSymptoms']),
  urinary: new Set(['bloodInUrine', 'feverVomiting', 'urinationPain', 'duration']),
};

async function reachStructured(chiefComplaint, messages) {
  const created = await post('/triage/session', { chiefComplaint, age: 35, gender: '男' });
  let current = null;
  for (const message of messages) {
    current = await post('/triage/message', { sessionId: created.sessionId, message });
    if (current.mode === 'question') break;
  }
  return current;
}

(async () => {
  const digestive = await reachStructured('最近胃不舒服', [
    '吃饭后会加重，已经一周了',
    '吃饭前不明显，没有黑便，也没有呕吐',
  ]);
  assert(digestive.mode === 'question', 'digestive should enter structured mode');
  assert(acceptedSlots.digestive.has(digestive.nextQuestion.slot), `digestive first slot not high-value: ${digestive.nextQuestion.slot}`);

  const cardio = await reachStructured('最近心慌胸闷', [
    '这两天反复出现，走快一点更明显，没有晕倒',
    '有点气短，偶尔头晕，没有说话不清',
  ]);
  assert(cardio.mode === 'question', 'cardio should enter structured mode');
  assert(acceptedSlots.cardio.has(cardio.nextQuestion.slot), `cardio first slot not high-value: ${cardio.nextQuestion.slot}`);

  console.log('structured priority smoke ok');
})().catch((error) => {
  console.error('structured priority smoke failed:', error.message);
  process.exit(1);
});
