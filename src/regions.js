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
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];

  const data = buildIndex();
  const starts = [];
  const contains = [];

  for (const row of data) {
    if (row.district.toLowerCase().startsWith(q) || row.city.toLowerCase().startsWith(q) || row.province.toLowerCase().startsWith(q)) {
      starts.push(row);
    } else if (row.searchKey.includes(q)) {
      contains.push(row);
    }

    if (starts.length >= limit) break;
  }

  const merged = starts.concat(contains).slice(0, limit);
  return merged;
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
