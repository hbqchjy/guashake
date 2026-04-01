function formatRegionName(region = {}) {
  return [region.province, region.city, region.district].filter(Boolean).join('');
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

const KNOWN_HOSPITALS = {
  '蕲春县人民医院': {
    officialWechatName: '蕲春县人民医院',
    wechatAccount: 'qcxyy-cn',
    bookingUrl: 'https://zsyy.1451cn.com/#/choice-room-today',
    channel: '医院服务号 / H5挂号',
  },
  '黄石市中心医院': {
    officialWechatName: '黄石市中心医院',
    miniProgramName: '黄石市中心医院',
    channel: '医院公众号 / 微信小程序',
  },
};

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

function buildHospitalRecommendations(region = {}, scenario = {}) {
  const districtBase = region.district || region.city || region.province || '本地';
  const cityBase = region.city && region.city !== '市辖区' ? region.city : region.province || districtBase;
  const department = scenario.department || '内科';

  return getHospitalTemplates(scenario.id).map((template, index) => {
    const baseName = index === 0 ? districtBase : cityBase;
    const name = `${baseName}${template.suffix}`;
    const known = KNOWN_HOSPITALS[name] || {};
    const officialProfileUrl = known.officialProfileUrl || buildOfficialProfileUrl(template.officialBiz || known.officialBiz || '');
    const bookingUrl = known.bookingUrl || template.bookingUrl || '';
    const miniProgramPath = known.miniProgramPath || template.miniProgramPath || '';
    const entryUrl = bookingUrl || officialProfileUrl || '';
    const officialEntryFound = Boolean(entryUrl || miniProgramPath);
    return {
      id: `${template.type}-${index}`,
      name,
      level: template.level,
      department,
      channel: known.channel || template.channel,
      officialWechatName: known.officialWechatName || buildWechatKeyword(name),
      wechatAccount: known.wechatAccount || '',
      miniProgramName: known.miniProgramName || (index < 3 ? buildMiniProgramName(name) : ''),
      officialProfileUrl,
      bookingUrl,
      miniProgramPath,
      officialEntryFound,
      entryUrl,
      entryLabel: bookingUrl ? '去挂号' : officialProfileUrl ? '打开公众号' : '未录入官方挂号入口',
      recommendation:
        index === 0
          ? '首诊优先这一家，通常离得近，先做基础检查更省时间。'
          : index === 1
            ? '如果症状更复杂，或者县医院建议转诊，可以优先看这一家。'
            : '可以作为备选，尤其适合需要进一步复查或专科会诊时使用。',
    };
  });
}

module.exports = {
  formatRegionName,
  buildHospitalRecommendations,
};
