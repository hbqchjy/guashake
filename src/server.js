const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const {
  detectScenario,
  buildTriageResult,
  buildCostEstimate,
  buildBookingSuggestion,
} = require('./rules');
const { searchRegions } = require('./regions');
const { upsertSession, getSession, saveArchive, getArchives, deleteArchive } = require('./store');
const { buildArchivePdf } = require('./pdf');
const { summarizeFile } = require('./file-summary');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use(express.static(path.join(__dirname, '..', 'public')));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    name: '挂啥科 MVP',
    updatedAt: '2026-03-29',
    coverageTier: '全国可访问，重点省份高覆盖（演示数据）',
    ocrMode: process.env.OCR_WEBHOOK_URL ? 'webhook' : 'fallback',
  });
});

app.get('/api/region/search', (req, res) => {
  const q = req.query.q || '';
  const regions = searchRegions(q, 8);
  res.json({ q, regions });
});

app.get('/api/region/reverse', async (req, res) => {
  const { lat, lon } = req.query;
  const latitude = Number(lat);
  const longitude = Number(lon);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=zh-CN&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`,
      {
        headers: {
          'User-Agent': 'guashake-mvp/1.0 (reverse geocode)',
        },
      }
    );

    if (!response.ok) {
      return res.status(502).json({ error: 'reverse geocode failed' });
    }

    const payload = await response.json();
    const address = payload.address || {};
    const candidates = [
      address.county,
      address.city_district,
      address.district,
      address.suburb,
      address.town,
      address.city,
      address.state,
    ].filter(Boolean);

    let region = null;
    for (const candidate of candidates) {
      const match = searchRegions(candidate, 1)[0];
      if (match) {
        region = match;
        break;
      }
    }

    return res.json({
      ok: true,
      displayName: payload.display_name || '',
      region,
    });
  } catch (error) {
    return res.status(502).json({ error: 'reverse geocode failed', detail: error.message });
  }
});

app.post('/triage/session', (req, res) => {
  const {
    age,
    gender,
    province,
    city,
    district,
    insuranceType,
    chiefComplaint,
  } = req.body;

  if (!chiefComplaint) {
    return res.status(400).json({ error: 'chiefComplaint is required' });
  }

  const sessionId = uuidv4();
  const scenario = detectScenario(chiefComplaint);
  const session = upsertSession(sessionId, {
    id: sessionId,
    age,
    gender,
    province,
    city,
    district,
    insuranceType,
    chiefComplaint,
    supplements: [],
    supplementFiles: [],
    scenario,
    stepIndex: 0,
    answers: {},
    createdAt: new Date().toISOString(),
  });

  return res.json({
    sessionId,
    nextQuestion: scenario.questions[0],
    progress: {
      current: 1,
      total: scenario.questions.length,
    },
    stopRule: '回答完整组追问后进入确认和补充阶段；命中急症信号时优先提示尽快就医',
    scenario: scenario.label,
  });
});

app.post('/triage/answer', (req, res) => {
  const { sessionId, questionId, answer } = req.body;
  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }

  const answers = { ...(session.answers || {}) };
  if (questionId && answer) {
    answers[questionId] = answer;
  }

  let stepIndex = Number(session.stepIndex || 0) + 1;
  const reachedMax = stepIndex >= session.scenario.questions.length;

  upsertSession(sessionId, { answers, stepIndex });

  if (reachedMax) {
    return res.json({
      done: false,
      needsConfirmation: true,
      progress: {
        current: session.scenario.questions.length,
        total: session.scenario.questions.length,
      },
    });
  }

  return res.json({
    done: false,
    nextQuestion: session.scenario.questions[stepIndex],
    progress: {
      current: stepIndex + 1,
      total: session.scenario.questions.length,
    },
  });
});

app.post('/triage/supplement', (req, res) => {
  const { sessionId, supplement } = req.body;
  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }

  const text = String(supplement || '').trim();
  const supplements = [...(session.supplements || [])];
  if (text) {
    supplements.push(text);
  }

  const updated = upsertSession(sessionId, { supplements });
  return res.json({
    ok: true,
    supplements: updated.supplements || [],
  });
});

app.post('/triage/supplement-file', upload.single('file'), async (req, res) => {
  const { sessionId, label = '补充材料' } = req.body;
  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'file is required' });
  }

  const summary = await summarizeFile(req.file, label);
  const fileRecord = {
    originalName: req.file.originalname,
    filename: req.file.filename,
    path: `/uploads/${req.file.filename}`,
    size: req.file.size,
    mimetype: req.file.mimetype,
    label,
    uploadedAt: new Date().toISOString(),
    summary,
  };

  const supplementFiles = [...(session.supplementFiles || []), fileRecord];
  upsertSession(sessionId, { supplementFiles });

  return res.json({
    ok: true,
    file: fileRecord,
    total: supplementFiles.length,
  });
});

app.get('/triage/result/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }

  const triageResult = session.triageResult || buildTriageResult(session);
  upsertSession(req.params.id, { triageResult });
  return res.json(triageResult);
});

app.post('/cost/estimate', (req, res) => {
  const { sessionId } = req.body;
  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }

  const estimate = buildCostEstimate(session);
  upsertSession(sessionId, { estimate });
  return res.json({
    coverageTier: '基础覆盖',
    updatedAt: '2026-03-29',
    ...estimate,
  });
});

app.get('/booking/options', (req, res) => {
  const { sessionId } = req.query;
  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }

  const booking = buildBookingSuggestion(session);
  upsertSession(sessionId, { booking });
  return res.json(booking);
});

app.post('/archive/upload', upload.array('files', 10), (req, res) => {
  const { userId = 'guest', sessionId, summary, doctorAdvice } = req.body;
  const session = sessionId ? getSession(sessionId) : null;

  const triageResult = session?.triageResult || (session ? buildTriageResult(session) : null);
  const record = {
    id: uuidv4(),
    userId,
    sessionId: sessionId || null,
    summary: summary || triageResult?.layeredOutput?.core?.text || '就医记录',
    doctorAdvice: doctorAdvice || '',
    department: triageResult?.layeredOutput?.core?.suggestDepartment || '',
    costRange: triageResult?.layeredOutput?.core?.firstCostRange || '',
    firstChecks: triageResult?.layeredOutput?.core?.firstChecks || [],
    files: [
      ...((session?.supplementFiles || []).map((f) => ({
        originalName: f.originalName,
        filename: f.filename,
        path: f.path,
        size: f.size,
        summary: f.summary || null,
      })) || []),
      ...(req.files || []).map((f) => ({
        originalName: f.originalname,
        filename: f.filename,
        path: `/uploads/${f.filename}`,
        size: f.size,
      })),
    ],
  };

  saveArchive(userId, record);
  return res.json({ ok: true, record });
});

app.get('/archive/list', (req, res) => {
  const userId = req.query.userId || 'guest';
  const records = getArchives(userId);
  return res.json({ userId, total: records.length, records });
});

app.delete('/archive/:userId/:recordId', (req, res) => {
  const { userId, recordId } = req.params;
  const records = deleteArchive(userId, recordId);
  return res.json({ ok: true, total: records.length, records });
});

app.get('/archive/export', (req, res) => {
  const userId = req.query.userId || 'guest';
  const recordId = req.query.recordId;
  const records = getArchives(userId);

  const target = recordId ? records.find((r) => r.id === recordId) : records[0];
  if (!target) {
    return res.status(404).json({ error: 'record not found' });
  }

  buildArchivePdf(target, res);
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`挂啥科 MVP running on http://localhost:${PORT}`);
});
