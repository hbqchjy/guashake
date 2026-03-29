const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    const init = { sessions: {}, archives: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function upsertSession(id, patch) {
  const db = readDb();
  const current = db.sessions[id] || {};
  db.sessions[id] = { ...current, ...patch, updatedAt: new Date().toISOString() };
  writeDb(db);
  return db.sessions[id];
}

function getSession(id) {
  const db = readDb();
  return db.sessions[id] || null;
}

function saveArchive(userId, record) {
  const db = readDb();
  if (!db.archives[userId]) {
    db.archives[userId] = [];
  }
  db.archives[userId].push({ ...record, createdAt: new Date().toISOString() });
  writeDb(db);
  return db.archives[userId];
}

function getArchives(userId) {
  const db = readDb();
  return db.archives[userId] || [];
}

function deleteArchive(userId, recordId) {
  const db = readDb();
  const before = db.archives[userId] || [];
  db.archives[userId] = before.filter((r) => r.id !== recordId);
  writeDb(db);
  return db.archives[userId];
}

module.exports = {
  upsertSession,
  getSession,
  saveArchive,
  getArchives,
  deleteArchive,
};
