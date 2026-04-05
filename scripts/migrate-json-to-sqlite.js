#!/usr/bin/env node
/**
 * 将 data/db.json 的数据迁移到 SQLite (data/guashake.db)
 * 用法: node scripts/migrate-json-to-sqlite.js
 * 安全: 不会删除 db.json，迁移完成后可手动备份
 */

const fs = require('fs');
const path = require('path');

const JSON_PATH = path.join(__dirname, '..', 'data', 'db.json');

if (!fs.existsSync(JSON_PATH)) {
  console.log('db.json 不存在，无需迁移。');
  process.exit(0);
}

const raw = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
console.log('读取 db.json 完成。');

// 加载新的 store (会自动建表)
const store = require('../src/store');

// 迁移 sessions
const sessions = raw.sessions || {};
const sessionIds = Object.keys(sessions);
console.log(`迁移 ${sessionIds.length} 个 session...`);
for (const id of sessionIds) {
  store.upsertSession(id, sessions[id]);
}

// 迁移 users
const users = raw.users || {};
const userIds = Object.keys(users);
console.log(`迁移 ${userIds.length} 个用户...`);
for (const userId of userIds) {
  store.upsertUser(userId, users[userId]);
}

// 迁移 archives
const archives = raw.archives || {};
const archiveUserIds = Object.keys(archives);
let archiveCount = 0;
for (const userId of archiveUserIds) {
  const records = archives[userId] || [];
  for (const record of records) {
    // 确保用户存在
    if (!userIds.includes(userId)) {
      store.upsertUser(userId, { userId });
    }
    store.saveArchive(userId, record);
    archiveCount++;
  }
}
console.log(`迁移 ${archiveCount} 条档案记录...`);

// 迁移 analytics
const analytics = raw.analytics || {};
if (analytics.quickSymptoms) {
  const qs = analytics.quickSymptoms;
  // 先确保初始化，然后逐个写入
  const clicks = qs.clicks || {};
  for (const [symptom, count] of Object.entries(clicks)) {
    for (let i = 0; i < count; i++) {
      store.trackSymptomClick(symptom);
    }
  }
  const consultCount = Number(qs.totalConsultations || 0);
  for (let i = 0; i < consultCount; i++) {
    store.incrementConsultationCount();
  }
  console.log('迁移 analytics 完成。');
}

// 备份 db.json
const backupPath = JSON_PATH + '.bak';
fs.copyFileSync(JSON_PATH, backupPath);
console.log(`\n迁移完成！db.json 已备份为 ${backupPath}`);
console.log('确认无误后可删除 db.json。');
