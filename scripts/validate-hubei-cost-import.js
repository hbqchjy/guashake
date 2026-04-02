#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function validateRow(row, index) {
  const errors = [];
  const item = String(row.item || row.name || '').trim();
  const min = Number(row.min);
  const max = Number(row.max);
  const sourceUrl = String(row.sourceUrl || '').trim();
  const sourceDate = String(row.sourceDate || '').trim();

  if (!item) errors.push(`row ${index + 1}: missing item`);
  if (!Number.isFinite(min) || !Number.isFinite(max)) errors.push(`row ${index + 1}: invalid min/max`);
  if (Number.isFinite(min) && Number.isFinite(max) && min > max) errors.push(`row ${index + 1}: min > max`);
  if (!/^https?:\/\//.test(sourceUrl)) errors.push(`row ${index + 1}: invalid sourceUrl`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)) errors.push(`row ${index + 1}: sourceDate must be YYYY-MM-DD`);

  return errors;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/validate-hubei-cost-import.js <file.json>');
    process.exit(1);
  }
  const abs = path.resolve(file);
  const rows = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!Array.isArray(rows)) {
    console.error('Import file must be an array');
    process.exit(1);
  }
  const errors = [];
  rows.forEach((row, idx) => {
    errors.push(...validateRow(row, idx));
  });
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(2);
  }
  console.log(`ok: ${abs} (${rows.length} rows)`);
}

main();
