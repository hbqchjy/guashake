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

function buildSearchEntryUrl(name) {
  if (!name) return '';
  return `https://weixin.sogou.com/weixin?type=1&query=${encodeURIComponent(name)}`;
}

function getHospitalTemplates(scenarioId) {
  const shared = [
    { type: 'people', suffix: '人民医院', level: '县级综合医院', channel: '医院公众号 / 小程序' },
    { type: 'first', suffix: '第一人民医院', level: '市级综合医院', channel: '医院公众号 / 小程序' },
    { type: 'center', suffix: '中心医院', level: '市级综合医院', channel: '医院公众号 / 小程序' },
    { type: 'tcm', suffix: '中医院', level: '县市中医院', channel: '医院公众号 / 小程序' },
  ];

  if (scenarioId === 'skinTrauma') {
    return [
      { type: 'people', suffix: '人民医院', level: '县级综合医院', channel: '医院公众号 / 小程序' },
      { type: 'surgery', suffix: '人民医院急诊外科', level: '市级综合医院', channel: '医院公众号 / 急诊窗口' },
      { type: 'skin', suffix: '皮肤病防治院', level: '专科医院', channel: '医院公众号 / 电话咨询' },
      { type: 'tcm', suffix: '中医院', level: '县市中医院', channel: '医院公众号 / 小程序' },
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
    return {
      id: `${template.type}-${index}`,
      name,
      level: template.level,
      department,
      channel: template.channel,
      officialWechatName: buildWechatKeyword(name),
      miniProgramName: index < 3 ? buildMiniProgramName(name) : '',
      officialEntryFound: index < 3,
      entryUrl: index < 3 ? buildSearchEntryUrl(name) : '',
      wechatKeyword: `微信搜索“${name}”`,
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
