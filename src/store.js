const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'guashake.db');

let _db = null;

function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initTables(_db);
  }
  return _db;
}

function initTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      phone TEXT,
      provider TEXT DEFAULT 'password',
      nickname TEXT DEFAULT '',
      avatar_url TEXT DEFAULT '',
      open_id TEXT DEFAULT '',
      union_id TEXT DEFAULT '',
      province TEXT DEFAULT '',
      city TEXT DEFAULT '',
      country TEXT DEFAULT '',
      password_digest TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_login_at TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS archives (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone
      ON users(phone) WHERE phone != '';
    CREATE INDEX IF NOT EXISTS idx_archives_user ON archives(user_id);

    CREATE TABLE IF NOT EXISTS auth_requests (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS auth_tickets (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS analytics (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

// ── Sessions ──

function upsertSession(id, patch) {
  const db = getDb();
  const row = db.prepare('SELECT data FROM sessions WHERE id = ?').get(id);
  const current = row ? JSON.parse(row.data) : {};
  const merged = { ...current, ...patch, updatedAt: new Date().toISOString() };

  db.prepare(`
    INSERT INTO sessions (id, data, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(id, JSON.stringify(merged));

  return merged;
}

function getSession(id) {
  const row = getDb().prepare('SELECT data FROM sessions WHERE id = ?').get(id);
  return row ? JSON.parse(row.data) : null;
}

// ── Archives ──

function saveArchive(userId, record) {
  const db = getDb();
  const data = { ...record, createdAt: new Date().toISOString() };
  db.prepare('INSERT INTO archives (id, user_id, data) VALUES (?, ?, ?)').run(
    record.id || require('crypto').randomUUID(),
    userId,
    JSON.stringify(data)
  );
  return getArchives(userId);
}

function getArchives(userId) {
  const rows = getDb()
    .prepare('SELECT data FROM archives WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId);
  return rows.map((r) => JSON.parse(r.data));
}

function getArchive(userId, recordId) {
  const row = getDb()
    .prepare('SELECT data FROM archives WHERE user_id = ? AND id = ?')
    .get(userId, recordId);
  return row ? JSON.parse(row.data) : null;
}

function deleteArchive(userId, recordId) {
  getDb().prepare('DELETE FROM archives WHERE user_id = ? AND id = ?').run(userId, recordId);
  return getArchives(userId);
}

// ── Users ──

function upsertUser(userId, patch) {
  const db = getDb();
  const existing = getUser(userId);
  const now = new Date().toISOString();

  if (existing) {
    const merged = { ...existing, ...patch, userId, updatedAt: now };
    db.prepare(`
      UPDATE users SET
        phone = ?, provider = ?, nickname = ?, avatar_url = ?,
        open_id = ?, union_id = ?, province = ?, city = ?, country = ?,
        password_digest = ?, updated_at = ?, last_login_at = ?
      WHERE user_id = ?
    `).run(
      merged.phone || '', merged.provider || 'password', merged.nickname || '',
      merged.avatarUrl || '', merged.openId || '', merged.unionId || '',
      merged.province || '', merged.city || '', merged.country || '',
      merged.passwordDigest || '', now, merged.lastLoginAt || '',
      userId
    );
    return merged;
  }

  const user = {
    userId,
    phone: '', provider: 'password', nickname: '', avatarUrl: '',
    openId: '', unionId: '', province: '', city: '', country: '',
    passwordDigest: '', lastLoginAt: '',
    ...patch,
    createdAt: patch.createdAt || now,
    updatedAt: now,
  };
  db.prepare(`
    INSERT INTO users (user_id, phone, provider, nickname, avatar_url,
      open_id, union_id, province, city, country,
      password_digest, created_at, updated_at, last_login_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId, user.phone, user.provider, user.nickname, user.avatarUrl,
    user.openId, user.unionId, user.province, user.city, user.country,
    user.passwordDigest, user.createdAt, user.updatedAt, user.lastLoginAt
  );
  return user;
}

function getUser(userId) {
  const row = getDb().prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  if (!row) return null;
  return {
    userId: row.user_id,
    phone: row.phone,
    provider: row.provider,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    openId: row.open_id,
    unionId: row.union_id,
    province: row.province,
    city: row.city,
    country: row.country,
    passwordDigest: row.password_digest,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

function getUserByPhone(phone) {
  const row = getDb().prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!row) return null;
  return getUser(row.user_id);
}

// ── Auth Requests ──

function createAuthRequest(id, payload) {
  const data = { ...payload, id, createdAt: new Date().toISOString() };
  getDb().prepare('INSERT OR REPLACE INTO auth_requests (id, data) VALUES (?, ?)').run(
    id, JSON.stringify(data)
  );
  return data;
}

function consumeAuthRequest(id) {
  const db = getDb();
  const row = db.prepare('SELECT data FROM auth_requests WHERE id = ?').get(id);
  if (!row) return null;
  db.prepare('DELETE FROM auth_requests WHERE id = ?').run(id);
  return JSON.parse(row.data);
}

// ── Auth Tickets ──

function createAuthTicket(id, payload) {
  const data = { ...payload, id, createdAt: new Date().toISOString() };
  getDb().prepare('INSERT OR REPLACE INTO auth_tickets (id, data) VALUES (?, ?)').run(
    id, JSON.stringify(data)
  );
  return data;
}

function consumeAuthTicket(id) {
  const db = getDb();
  const row = db.prepare('SELECT data FROM auth_tickets WHERE id = ?').get(id);
  if (!row) return null;
  db.prepare('DELETE FROM auth_tickets WHERE id = ?').run(id);
  return JSON.parse(row.data);
}

// ── Analytics ──

function _getAnalytics(key) {
  const row = getDb().prepare('SELECT data FROM analytics WHERE key = ?').get(key);
  return row ? JSON.parse(row.data) : null;
}

function _setAnalytics(key, data) {
  getDb().prepare(`
    INSERT INTO analytics (key, data, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(data));
}

function ensureQuickSymptomAnalytics() {
  let analytics = _getAnalytics('quickSymptoms');
  if (!analytics) {
    analytics = { totalConsultations: 0, totalClicks: 0, clicks: {}, updatedAt: null };
    _setAnalytics('quickSymptoms', analytics);
  }
  analytics.clicks ||= {};
  return analytics;
}

function trackSymptomClick(symptom) {
  const analytics = ensureQuickSymptomAnalytics();
  const key = String(symptom || '').trim();
  if (!key) return analytics;
  analytics.totalClicks = Number(analytics.totalClicks || 0) + 1;
  analytics.clicks[key] = Number(analytics.clicks[key] || 0) + 1;
  analytics.updatedAt = new Date().toISOString();
  _setAnalytics('quickSymptoms', analytics);
  return analytics;
}

function incrementConsultationCount() {
  const analytics = ensureQuickSymptomAnalytics();
  analytics.totalConsultations = Number(analytics.totalConsultations || 0) + 1;
  analytics.updatedAt = new Date().toISOString();
  _setAnalytics('quickSymptoms', analytics);
  return analytics;
}

function getQuickSymptomAnalytics() {
  return ensureQuickSymptomAnalytics();
}

module.exports = {
  upsertSession,
  getSession,
  saveArchive,
  getArchive,
  getArchives,
  deleteArchive,
  upsertUser,
  getUser,
  getUserByPhone,
  createAuthRequest,
  consumeAuthRequest,
  createAuthTicket,
  consumeAuthTicket,
  trackSymptomClick,
  incrementConsultationCount,
  getQuickSymptomAnalytics,
};
