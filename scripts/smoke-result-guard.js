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

async function get(path) {
  const res = await fetch(base + path);
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

  const result = await get(`/triage/result/${sid}`);
  assert(result.status === 409, `result guard should return 409, got ${result.status}`);
  assert(result.data.error === 'insufficient_confirmation', 'result guard should expose insufficient_confirmation');

  console.log('result guard smoke ok');
})().catch((error) => {
  console.error('result guard smoke failed:', error.message);
  process.exit(1);
});
