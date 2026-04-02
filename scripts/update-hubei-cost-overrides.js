#!/usr/bin/env node
/**
 * 用法：
 *   node scripts/update-hubei-cost-overrides.js --city 武汉 --item 挂号费 --min 8 --max 20
 *   node scripts/update-hubei-cost-overrides.js --city 黄石 --from-json ./tmp/city-fees.json
 *
 * 说明：
 * - 这是“月更”维护脚本，先把官方公示页整理成结构化数据，再写入覆盖库。
 * - 不直接内置抓取器，避免因站点反爬/格式变化导致线上数据污染。
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '..', 'data', 'cost-reference.hubei.city-overrides.json');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '1';
    args[name] = value;
    if (value !== '1') i += 1;
  }
  return args;
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function normalizeCity(city = '') {
  return String(city || '').trim().replace(/市$/, '');
}

function normalizeItemRow(row) {
  return {
    item: String(row.item || row.name || '').trim(),
    min: Number(row.min),
    max: Number(row.max),
  };
}

function main() {
  const args = parseArgs(process.argv);
  const city = normalizeCity(args.city || '');
  if (!city) {
    throw new Error('missing --city');
  }

  const data = loadJson(TARGET);
  data.cities = data.cities || {};
  data.cities[city] = data.cities[city] || {};

  if (args.fromJson || args['from-json']) {
    const source = args.fromJson || args['from-json'];
    const rows = loadJson(path.resolve(source));
    rows.forEach((raw) => {
      const row = normalizeItemRow(raw);
      if (!row.item || !Number.isFinite(row.min) || !Number.isFinite(row.max)) return;
      data.cities[city][row.item] = { min: row.min, max: row.max };
    });
  } else {
    const item = String(args.item || '').trim();
    const min = Number(args.min);
    const max = Number(args.max);
    if (!item || !Number.isFinite(min) || !Number.isFinite(max)) {
      throw new Error('single update requires --item --min --max');
    }
    data.cities[city][item] = { min, max };
  }

  const today = new Date().toISOString().slice(0, 10);
  data.updatedAt = today;
  saveJson(TARGET, data);
  console.log(`updated ${city}: ${TARGET}`);
}

main();
