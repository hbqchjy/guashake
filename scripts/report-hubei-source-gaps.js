#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'cost-source.hubei.official.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const rows = [];
for (const [city, info] of Object.entries(data.cities || {})) {
  const sources = Array.isArray(info.preferredSources) ? info.preferredSources : [];
  const missingDirect = sources.filter((s) => !String(s.url || '').trim()).length;
  const hasMunicipalYbj = sources.some((s) => String(s.url || '').includes('ybj.') && !String(s.url || '').includes('ybj.hubei.gov.cn'));
  const hasMunicipalWjw = sources.some((s) => String(s.url || '').includes('wjw.') && !String(s.url || '').includes('wjw.hubei.gov.cn'));
  rows.push({
    city,
    status: info.status || 'pending_review',
    missingDirect,
    hasMunicipalYbj,
    hasMunicipalWjw,
  });
}

rows.sort((a, b) => {
  const rank = { verified_homepage: 0, partial_verified: 1, pending_review: 2 };
  return (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.city.localeCompare(b.city, 'zh-CN');
});

for (const row of rows) {
  console.log(`${row.city}\t${row.status}\tmissingDirect=${row.missingDirect}\tmunicipalYBJ=${row.hasMunicipalYbj}\tmunicipalWJW=${row.hasMunicipalWjw}`);
}
