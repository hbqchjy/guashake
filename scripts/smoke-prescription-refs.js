const { findDrugRefsByText } = require('../src/store');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const refs = findDrugRefsByText('门诊处方：奥美拉唑肠溶胶囊、蒙脱石散、口服补液盐散').map((item) => item.genericName);
assert(refs.includes('奥美拉唑肠溶胶囊'), 'missing prescription ref: 奥美拉唑肠溶胶囊');
assert(refs.includes('蒙脱石散'), 'missing prescription ref: 蒙脱石散');
assert(refs.includes('口服补液盐散'), 'missing prescription ref: 口服补液盐散');

const eyeRefs = findDrugRefsByText('妥布霉素滴眼液、玻璃酸钠滴眼液').map((item) => item.genericName);
assert(eyeRefs.includes('妥布霉素滴眼液'), 'missing prescription ref: 妥布霉素滴眼液');
assert(eyeRefs.includes('玻璃酸钠滴眼液'), 'missing prescription ref: 玻璃酸钠滴眼液');

console.log('prescription ref smoke ok');
