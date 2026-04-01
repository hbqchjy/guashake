const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    const init = { sessions: {}, archives: {}, users: {}, authRequests: {}, authTickets: {} };
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

function ensureCollections(db) {
  db.sessions ||= {};
  db.archives ||= {};
  db.users ||= {};
  db.authRequests ||= {};
  db.authTickets ||= {};
  return db;
}

function upsertSession(id, patch) {
  const db = ensureCollections(readDb());
  const current = db.sessions[id] || {};
  db.sessions[id] = { ...current, ...patch, updatedAt: new Date().toISOString() };
  writeDb(db);
  return db.sessions[id];
}

function getSession(id) {
  const db = ensureCollections(readDb());
  return db.sessions[id] || null;
}

function saveArchive(userId, record) {
  const db = ensureCollections(readDb());
  if (!db.archives[userId]) {
    db.archives[userId] = [];
  }
  db.archives[userId].push({ ...record, createdAt: new Date().toISOString() });
  writeDb(db);
  return db.archives[userId];
}

function getArchives(userId) {
  const db = ensureCollections(readDb());
  return db.archives[userId] || [];
}

function getArchive(userId, recordId) {
  const db = ensureCollections(readDb());
  const records = db.archives[userId] || [];
  return records.find((record) => record.id === recordId) || null;
}

function deleteArchive(userId, recordId) {
  const db = ensureCollections(readDb());
  const before = db.archives[userId] || [];
  db.archives[userId] = before.filter((r) => r.id !== recordId);
  writeDb(db);
  return db.archives[userId];
}



function upsertUser(userId, patch) {
  const db = ensureCollections(readDb());
  const current = db.users[userId] || {};
  db.users[userId] = {
    ...current,
    ...patch,
    userId,
    createdAt: current.createdAt || patch.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeDb(db);
  return db.users[userId];
}

function getUser(userId) {
  const db = ensureCollections(readDb());
  return db.users[userId] || null;
}


function getUserByPhone(phone) {
  const db = ensureCollections(readDb());
  return Object.values(db.users).find((user) => user.phone === phone) || null;
}

function createAuthRequest(id, payload) {
  const db = ensureCollections(readDb());
  db.authRequests[id] = {
    ...payload,
    id,
    createdAt: new Date().toISOString(),
  };
  writeDb(db);
  return db.authRequests[id];
}

function consumeAuthRequest(id) {
  const db = ensureCollections(readDb());
  const payload = db.authRequests[id] || null;
  if (payload) {
    delete db.authRequests[id];
    writeDb(db);
  }
  return payload;
}

function createAuthTicket(id, payload) {
  const db = ensureCollections(readDb());
  db.authTickets[id] = {
    ...payload,
    id,
    createdAt: new Date().toISOString(),
  };
  writeDb(db);
  return db.authTickets[id];
}

function consumeAuthTicket(id) {
  const db = ensureCollections(readDb());
  const payload = db.authTickets[id] || null;
  if (payload) {
    delete db.authTickets[id];
    writeDb(db);
  }
  return payload;
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
};
