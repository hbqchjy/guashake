const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'guashake.db');
const DRUG_SEED_PATH = path.join(__dirname, '..', 'data', 'drug_refs.seed.json');

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

    CREATE TABLE IF NOT EXISTS drugs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generic_name TEXT NOT NULL,
      form TEXT DEFAULT '',
      spec TEXT DEFAULT '',
      insurance_class TEXT DEFAULT '',
      is_centralized INTEGER DEFAULT 0,
      price_min REAL,
      price_max REAL,
      source TEXT DEFAULT 'seed',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_drugs_identity
      ON drugs(generic_name, form, spec);

    CREATE TABLE IF NOT EXISTS drug_aliases (
      drug_id INTEGER NOT NULL,
      alias_name TEXT NOT NULL,
      FOREIGN KEY (drug_id) REFERENCES drugs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_drug_aliases_name ON drug_aliases(alias_name);

    CREATE TABLE IF NOT EXISTS drug_scenarios (
      drug_id INTEGER NOT NULL,
      scenario_code TEXT NOT NULL,
      scenario_name TEXT NOT NULL,
      FOREIGN KEY (drug_id) REFERENCES drugs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_drug_scenarios_drug ON drug_scenarios(drug_id);
  `);

  seedDrugRefsIfNeeded(db);
}

function normalizeDrugKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[（(【\[].*?[)\]】]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
}

function seedDrugRefsIfNeeded(db) {
  const countRow = db.prepare('SELECT COUNT(1) AS count FROM drugs').get();
  if (Number(countRow?.count || 0) > 0) return;
  if (!fs.existsSync(DRUG_SEED_PATH)) return;

  const payload = JSON.parse(fs.readFileSync(DRUG_SEED_PATH, 'utf8'));
  const items = Array.isArray(payload?.drugs) ? payload.drugs : [];
  if (!items.length) return;

  const insertDrug = db.prepare(`
    INSERT INTO drugs (
      generic_name, form, spec, insurance_class,
      is_centralized, price_min, price_max, source, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAlias = db.prepare('INSERT INTO drug_aliases (drug_id, alias_name) VALUES (?, ?)');
  const insertScenario = db.prepare(
    'INSERT INTO drug_scenarios (drug_id, scenario_code, scenario_name) VALUES (?, ?, ?)'
  );
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    items.forEach((item) => {
      const result = insertDrug.run(
        String(item.genericName || '').trim(),
        String(item.form || '').trim(),
        String(item.spec || '').trim(),
        String(item.insuranceClass || '').trim(),
        item.isCentralized ? 1 : 0,
        Number(item.priceMin || 0),
        Number(item.priceMax || 0),
        String(item.source || 'seed').trim() || 'seed',
        String(item.updatedAt || now)
      );
      const drugId = result.lastInsertRowid;
      const aliases = Array.isArray(item.aliases) ? item.aliases : [];
      aliases
        .map((alias) => String(alias || '').trim())
        .filter(Boolean)
        .forEach((alias) => insertAlias.run(drugId, alias));
      const scenarios = Array.isArray(item.scenarios) ? item.scenarios : [];
      scenarios.forEach((scenario) => {
        const code = String(scenario.code || '').trim();
        const name = String(scenario.name || '').trim();
        if (!code || !name) return;
        insertScenario.run(drugId, code, name);
      });
    });
  });

  tx();
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

function findDrugRefsByText(text, limit = 12) {
  const normalizedText = normalizeDrugKey(text);
  if (!normalizedText) return [];

  const rows = getDb()
    .prepare(`
      SELECT
        d.id,
        d.generic_name,
        d.form,
        d.spec,
        d.insurance_class,
        d.is_centralized,
        d.price_min,
        d.price_max,
        d.source,
        GROUP_CONCAT(DISTINCT da.alias_name) AS aliases,
        GROUP_CONCAT(DISTINCT ds.scenario_code) AS scenario_codes,
        GROUP_CONCAT(DISTINCT ds.scenario_name) AS scenario_names
      FROM drugs d
      LEFT JOIN drug_aliases da ON da.drug_id = d.id
      LEFT JOIN drug_scenarios ds ON ds.drug_id = d.id
      GROUP BY d.id
    `)
    .all();

  const matches = [];
  for (const row of rows) {
    const names = [
      row.generic_name,
      ...(String(row.aliases || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)),
    ];
    const normalizedNames = names
      .map((item) => ({ raw: item, normalized: normalizeDrugKey(item) }))
      .filter((item) => item.normalized);
    const matchedName = normalizedNames
      .sort((a, b) => b.normalized.length - a.normalized.length)
      .find((item) => normalizedText.includes(item.normalized));
    if (!matchedName) continue;

    matches.push({
      id: row.id,
      genericName: row.generic_name,
      form: row.form || '',
      spec: row.spec || '',
      insuranceClass: row.insurance_class || '不确定',
      isCentralized: Boolean(row.is_centralized),
      priceMin: Number(row.price_min || 0),
      priceMax: Number(row.price_max || 0),
      source: row.source || 'seed',
      aliases: names,
      scenarios: String(row.scenario_names || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      matchedBy: matchedName.raw,
      matchLength: matchedName.normalized.length,
    });
  }

  return matches
    .sort((a, b) => b.matchLength - a.matchLength)
    .slice(0, Math.max(1, Number(limit) || 12))
    .map(({ matchLength, ...item }) => item);
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
  findDrugRefsByText,
};
