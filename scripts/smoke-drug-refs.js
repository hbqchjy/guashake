const { findDrugRefsByScenarios, findDrugRefsByText } = require('../src/store');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const stomachRefs = findDrugRefsByScenarios(['stomach'], 12).map((item) => item.genericName);
assert(stomachRefs.includes('奥美拉唑肠溶胶囊'), 'missing stomach ref: 奥美拉唑肠溶胶囊');
assert(stomachRefs.includes('蒙脱石散'), 'missing stomach ref: 蒙脱石散');

const coldRefs = findDrugRefsByText('达菲、复方氨酚烷胺片、连花清瘟胶囊').map((item) => item.genericName);
assert(coldRefs.includes('磷酸奥司他韦胶囊'), 'missing text ref: 磷酸奥司他韦胶囊');
assert(coldRefs.includes('复方氨酚烷胺片'), 'missing text ref: 复方氨酚烷胺片');
assert(coldRefs.includes('连花清瘟胶囊'), 'missing text ref: 连花清瘟胶囊');

console.log('drug ref smoke ok');
