const areaData = require('china-area-data');

let cache = null;

function buildIndex() {
  if (cache) return cache;

  const provinces = areaData['86'] || {};
  const rows = [];

  Object.entries(provinces).forEach(([pCode, province]) => {
    const cities = areaData[pCode] || {};
    Object.entries(cities).forEach(([cCode, city]) => {
      const districts = areaData[cCode] || {};
      Object.entries(districts).forEach(([dCode, district]) => {
        const fullName = `${province}${city}${district}`;
        rows.push({
          code: dCode,
          province,
          city,
          district,
          fullName,
          searchKey: `${province}|${city}|${district}|${fullName}`.toLowerCase(),
        });
      });
    });
  });

  cache = rows;
  return rows;
}

function searchRegions(query, limit = 10) {
  const raw = String(query || '').trim();
  if (!raw) return [];
  const normalized = raw
    .replace(/[，,。！？!?:：；;、\s]/g, '')
    .replace(/^(我在|我住在|地址在|地区在|定位在|在)/, '')
    .replace(/(这边|附近|这儿|这里|左右)$/g, '');
  const tokenMatches = normalized.match(/[\u4e00-\u9fa5]{2,}(?:省|市|区|县|州|盟|旗|自治区|特别行政区)/g) || [];
  const candidates = Array.from(new Set([raw, normalized, ...tokenMatches].filter(Boolean))).map((item) => item.toLowerCase());
  const data = buildIndex();
  const starts = [];
  const contains = [];
  const seen = new Set();

  const pushRow = (target, row) => {
    const key = row.code || `${row.province}-${row.city}-${row.district}`;
    if (seen.has(key)) return;
    seen.add(key);
    target.push(row);
  };

  for (const q of candidates) {
    for (const row of data) {
      if (row.district.toLowerCase().startsWith(q) || row.city.toLowerCase().startsWith(q) || row.province.toLowerCase().startsWith(q)) {
        pushRow(starts, row);
      } else if (row.searchKey.includes(q)) {
        pushRow(contains, row);
      }
      if (starts.length >= limit) break;
    }
    if (starts.length >= limit) break;
  }

  return starts.concat(contains).slice(0, limit);
}

function parseRegionText(input) {
  const text = String(input || '').trim();
  if (!text) return { province: '', city: '', district: '' };

  const m = text.match(/(.+省|.+自治区|.+市)?(.+市|.+州|.+地区)?(.+区|.+县|.+旗)?$/);
  if (!m) return { province: '', city: '', district: text };

  return {
    province: m[1] || '',
    city: m[2] || '',
    district: m[3] || text,
  };
}

module.exports = {
  searchRegions,
  parseRegionText,
};
