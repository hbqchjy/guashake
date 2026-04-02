const hubeiHospitalDirectory = require('../data/hubei-hospital-booking.sample.json');

function formatRegionName(region = {}) {
  return [region.province, region.city, region.district].filter(Boolean).join('');
}

function normalizeRegion(region = {}) {
  const districtRaw = String(region.district || '').trim();
  const district = ['市辖区', '县', '城区'].includes(districtRaw) ? '' : districtRaw;
  return {
    province: String(region.province || '').trim(),
    city: String(region.city || '').trim(),
    district,
  };
}

function buildWechatKeyword(name) {
  if (!name) return '';
  return `${name}服务号`;
}

function buildMiniProgramName(name) {
  if (!name) return '';
  return `${name}挂号`;
}

function buildOfficialProfileUrl(__biz = '') {
  if (!__biz) return '';
  return `https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=${encodeURIComponent(__biz)}#wechat_redirect`;
}

function buildWechatProfileScheme(wechatAccount = '') {
  const account = String(wechatAccount || '').trim();
  if (!account) return '';
  return `weixin://contacts/profile/${encodeURIComponent(account)}`;
}

function isMpArticleUrl(url = '') {
  return /^https:\/\/mp\.weixin\.qq\.com\/s\//.test(String(url || '').trim());
}

const KNOWN_HOSPITALS = Object.fromEntries(
  hubeiHospitalDirectory.map((item) => [
    item.hospitalName,
    {
      level: item.level || '',
      officialWechatName: item.officialWechatName || '',
      wechatAccount: item.wechatAccount || '',
      bookingUrl: item.bookingUrl || '',
      officialProfileUrl: item.officialProfileUrl || '',
      miniProgramName: item.miniProgramName || '',
      verificationStatus: item.verificationStatus || 'unknown',
      sourceUrl: item.sourceUrl || '',
      notes: item.notes || '',
      channel: item.bookingUrl ? '医院服务号 / H5挂号' : item.miniProgramName ? '医院公众号 / 微信小程序' : '待补官方挂号入口',
    },
  ])
);

function getHospitalTemplates(scenarioId) {
  const shared = [
    { type: 'people', suffix: '人民医院', level: '县级综合医院', channel: '医院公众号 / 小程序', officialBiz: '', miniProgramPath: '', bookingUrl: '' },
    { type: 'first', suffix: '第一人民医院', level: '市级综合医院', channel: '医院公众号 / 小程序', officialBiz: '', miniProgramPath: '', bookingUrl: '' },
    { type: 'center', suffix: '中心医院', level: '市级综合医院', channel: '医院公众号 / 小程序', officialBiz: '', miniProgramPath: '', bookingUrl: '' },
    { type: 'tcm', suffix: '中医院', level: '县市中医院', channel: '医院公众号 / 小程序', officialBiz: '', miniProgramPath: '', bookingUrl: '' },
  ];

  if (scenarioId === 'skinTrauma') {
    return [
      { type: 'people', suffix: '人民医院', level: '县级综合医院', channel: '医院公众号 / 小程序', officialBiz: '', miniProgramPath: '', bookingUrl: '' },
      { type: 'surgery', suffix: '人民医院急诊外科', level: '市级综合医院', channel: '医院公众号 / 急诊窗口', officialBiz: '', miniProgramPath: '', bookingUrl: '' },
      { type: 'skin', suffix: '皮肤病防治院', level: '专科医院', channel: '医院公众号 / 电话咨询', officialBiz: '', miniProgramPath: '', bookingUrl: '' },
      { type: 'tcm', suffix: '中医院', level: '县市中医院', channel: '医院公众号 / 小程序', officialBiz: '', miniProgramPath: '', bookingUrl: '' },
    ];
  }

  return shared;
}

function buildKnownHospitalCard(name, department, index) {
  const known = KNOWN_HOSPITALS[name] || {};
  const officialProfileUrl = known.officialProfileUrl || buildOfficialProfileUrl(known.officialBiz || '');
  const wechatProfileScheme = buildWechatProfileScheme(known.wechatAccount || '');
  const bookingUrl = known.bookingUrl || '';
  const officialArticleUrl = isMpArticleUrl(known.sourceUrl || '') ? known.sourceUrl : '';
  const miniProgramPath = known.miniProgramPath || '';
  const entryUrl =
    officialProfileUrl ||
    officialArticleUrl ||
    wechatProfileScheme ||
    ((known.verificationStatus || '') === 'confirmed_booking_url' ? bookingUrl : '');
  const officialEntryFound = Boolean(entryUrl || miniProgramPath);

  return {
    id: `known-${index}`,
    name,
    level: known.level || '综合医院',
    department,
    channel: known.channel || '待补官方挂号入口',
    officialWechatName: known.officialWechatName || buildWechatKeyword(name),
    wechatAccount: known.wechatAccount || '',
    miniProgramName: known.miniProgramName || '',
    officialProfileUrl,
    officialArticleUrl,
    wechatProfileScheme,
    bookingUrl,
    miniProgramPath,
    officialEntryFound,
    entryUrl,
    entryLabel: getEntryLabel(
      known.verificationStatus || '',
      bookingUrl,
      officialProfileUrl,
      miniProgramPath,
      wechatProfileScheme,
      officialArticleUrl
    ),
    verificationStatus: known.verificationStatus || 'unknown',
    sourceUrl: known.sourceUrl || '',
    notes: known.notes || '',
    recommendation:
      index === 0
        ? '优先推荐这一家，当前地区样板库里已收录。'
        : index === 1
          ? '这家也可作为同城备选，适合进一步复诊或转诊。'
          : '作为样板库里的补充医院，可以按需再核对挂号入口。',
  };
}

function getEntryLabel(
  verificationStatus = '',
  bookingUrl = '',
  officialProfileUrl = '',
  miniProgramPath = '',
  wechatProfileScheme = '',
  officialArticleUrl = ''
) {
  if (officialProfileUrl || wechatProfileScheme) return '打开公众号';
  if (officialArticleUrl) return '打开公众号';
  if (miniProgramPath) return '打开小程序';
  if (bookingUrl && verificationStatus === 'confirmed_booking_url') return '去挂号';
  if (bookingUrl) return '查看挂号方式';
  return '未录入官方挂号入口';
}

function findDirectoryMatches(region = {}) {
  const normalized = normalizeRegion(region);
  const district = normalized.district || '';
  const city = normalized.city || '';
  const province = normalized.province || '';
  const byDistrict = district ? hubeiHospitalDirectory.filter((item) => item.district === district) : [];
  const byCity = city ? hubeiHospitalDirectory.filter((item) => item.city === city) : [];
  const byProvince = province ? hubeiHospitalDirectory.filter((item) => item.province === province) : [];
  const merged = [];
  const seen = new Set();
  const pushRows = (rows = []) => {
    rows.forEach((item) => {
      const key = `${item.province}-${item.city}-${item.district}-${item.hospitalName}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(item);
    });
  };
  // 优先本区县，再补同城，最后补同省，确保地址变化后推荐明显不同。
  pushRows(byDistrict);
  pushRows(byCity);
  if (!city) {
    pushRows(byProvince);
  }
  return merged;
}

function buildTemplateRecommendations(region = {}, scenario = {}) {
  const normalized = normalizeRegion(region);
  const districtBase = normalized.district || normalized.city || normalized.province || '本地';
  const cityBase = normalized.city && normalized.city !== '市辖区' ? normalized.city : normalized.province || districtBase;
  const department = scenario.department || '内科';

  return getHospitalTemplates(scenario.id).map((template, index) => {
    const baseName = index === 0 ? districtBase : cityBase;
    const name = `${baseName}${template.suffix}`;
    const known = KNOWN_HOSPITALS[name] || {};
    const officialProfileUrl = known.officialProfileUrl || buildOfficialProfileUrl(template.officialBiz || known.officialBiz || '');
    const wechatProfileScheme = buildWechatProfileScheme(known.wechatAccount || '');
    const bookingUrl = known.bookingUrl || template.bookingUrl || '';
    const officialArticleUrl = isMpArticleUrl(known.sourceUrl || '') ? known.sourceUrl : '';
    const miniProgramPath = known.miniProgramPath || template.miniProgramPath || '';
    const entryUrl =
      officialProfileUrl ||
      officialArticleUrl ||
      wechatProfileScheme ||
      ((known.verificationStatus || '') === 'confirmed_booking_url' ? bookingUrl : '');
    const officialEntryFound = Boolean(entryUrl || miniProgramPath);
    return {
      id: `${template.type}-${index}`,
      name,
      level: known.level || template.level,
      department,
      channel: known.channel || template.channel,
      officialWechatName: known.officialWechatName || buildWechatKeyword(name),
      wechatAccount: known.wechatAccount || '',
      miniProgramName: known.miniProgramName || (index < 3 ? buildMiniProgramName(name) : ''),
      officialProfileUrl,
      officialArticleUrl,
      wechatProfileScheme,
      bookingUrl,
      miniProgramPath,
      officialEntryFound,
      entryUrl,
      entryLabel: getEntryLabel(
        known.verificationStatus || '',
        bookingUrl,
        officialProfileUrl,
        miniProgramPath,
        wechatProfileScheme,
        officialArticleUrl
      ),
      verificationStatus: known.verificationStatus || 'unknown',
      sourceUrl: known.sourceUrl || '',
      notes: known.notes || '',
      recommendation:
        index === 0
          ? '首诊优先这一家，通常离得近，先做基础检查更省时间。'
          : index === 1
            ? '如果症状更复杂，或者县医院建议转诊，可以优先看这一家。'
            : '可以作为备选，尤其适合需要进一步复查或专科会诊时使用。',
    };
  });
}

function buildHospitalRecommendations(region = {}, scenario = {}) {
  const normalized = normalizeRegion(region);
  const department = scenario.department || '内科';
  const matches = findDirectoryMatches(normalized).slice(0, 5);
  const knownCards = matches.map((item, index) => buildKnownHospitalCard(item.hospitalName, department, index));
  if (knownCards.length >= 5) {
    return knownCards.slice(0, 5);
  }
  const knownNames = new Set(knownCards.map((item) => item.name));
  const templateCards = buildTemplateRecommendations(normalized, scenario).filter((item) => !knownNames.has(item.name));
  return knownCards.concat(templateCards).slice(0, 5);
}

module.exports = {
  formatRegionName,
  buildHospitalRecommendations,
  hubeiHospitalDirectory,
};
