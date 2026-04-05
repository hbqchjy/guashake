import axios from 'axios'

const api = axios.create({
  baseURL: '/',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

// ── 分诊 ──

export function createTriageSession(data) {
  return api.post('/triage/session', data).then(r => r.data)
}

export function answerTriageQuestion(data) {
  return api.post('/triage/answer', data).then(r => r.data)
}

export function sendTriageMessage(data) {
  return api.post('/triage/message', data).then(r => r.data)
}

export function sendTriageSupplement(data) {
  return api.post('/triage/supplement', data).then(r => r.data)
}

export function uploadTriageFile(sessionId, file) {
  const form = new FormData()
  form.append('sessionId', sessionId)
  form.append('file', file)
  return api.post('/triage/supplement-file', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)
}

export function getTriageResult(sessionId) {
  return api.get(`/triage/result/${sessionId}`).then(r => r.data)
}

export function getTriageState(sessionId) {
  return api.get(`/triage/session/${sessionId}/state`).then(r => r.data)
}

// ── 费用 & 挂号 ──

export function getCostEstimate(data) {
  return api.post('/cost/estimate', data).then(r => r.data)
}

export function getBookingOptions(sessionId) {
  return api.get('/booking/options', { params: { sessionId } }).then(r => r.data)
}

// ── 档案 ──

export function saveArchiveRecord(data) {
  return api.post('/archive/upload', data).then(r => r.data)
}

export function getArchiveList(userId) {
  return api.get('/archive/list', { params: { userId } }).then(r => r.data)
}

export function deleteArchiveRecord(userId, recordId) {
  return api.delete(`/archive/${userId}/${recordId}`).then(r => r.data)
}

// ── 阶段二：检查单/处方分析 ──

export function analyzeCheckSheet(file, context = '') {
  const form = new FormData()
  form.append('file', file)
  if (context) form.append('context', context)
  return api.post('/api/analyze/check-sheet', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  }).then(r => r.data)
}

export function analyzePrescription(file, context = '') {
  const form = new FormData()
  form.append('file', file)
  if (context) form.append('context', context)
  return api.post('/api/analyze/prescription', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  }).then(r => r.data)
}

// ── 阶段三：报告解读 ──

export function analyzeReport(file, context = '') {
  const form = new FormData()
  form.append('file', file)
  if (context) form.append('context', context)
  return api.post('/api/analyze/report', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  }).then(r => r.data)
}

// ── 认证 ──

export function loginByPassword(phone, password) {
  return api.post('/auth/password/login', { phone, password }).then(r => r.data)
}

export function getAccountSummary(userId) {
  return api.get('/account/summary', { params: { userId } }).then(r => r.data)
}

export default api
