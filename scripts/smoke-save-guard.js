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
  return { status: res.status, data };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const created = await post('/triage/session', {
    chiefComplaint: '最近胃不舒服',
    age: 32,
    gender: '女',
  });
  assert(created.status === 200, 'session creation should succeed');
  const sid = created.data.sessionId;

  const turn1 = await post('/triage/message', {
    sessionId: sid,
    message: '吃饭后会加重，已经一周了',
  });
  assert(turn1.status === 200, 'first follow-up should succeed');

  const saved = await post('/archive/upload', {
    userId: 'guest',
    sessionId: sid,
    summary: 'test summary',
  });
  assert(saved.status === 409, `save guard should return 409, got ${saved.status}`);
  assert(saved.data.error === 'insufficient_confirmation', 'save guard should expose insufficient_confirmation');

  console.log('save guard smoke ok');
})().catch((error) => {
  console.error('save guard smoke failed:', error.message);
  process.exit(1);
});
