const REPORT_KEYWORDS = [
  { pattern: /(血常规|血常)/i, title: '血常规报告', focus: ['白细胞', '血红蛋白', '血小板'], next: '先看是否提示感染、贫血或出血风险。' },
  { pattern: /(尿常规|尿检)/i, title: '尿常规报告', focus: ['白细胞', '红细胞', '蛋白', '亚硝酸盐'], next: '先看是否像尿路感染，必要时再补尿培养。' },
  { pattern: /(肝功|肝功能)/i, title: '肝功能报告', focus: ['ALT', 'AST', '胆红素'], next: '先看转氨酶和胆红素，再判断是否需要进一步复查。' },
  { pattern: /(肾功|肾功能)/i, title: '肾功能报告', focus: ['肌酐', '尿素氮', '尿酸'], next: '先看肾功能指标，再决定是否需要肾脏B超。' },
  { pattern: /(心电图)/i, title: '心电图报告', focus: ['心率', '心律', 'ST-T'], next: '先看有无明显心律失常或缺血提示。' },
  { pattern: /(ct|胸片|x线|x光)/i, title: '影像检查报告', focus: ['检查部位', '影像所见', '结论'], next: '先看结论和建议，再决定是否需要挂对应专科。' },
  { pattern: /(彩超|b超|超声)/i, title: '超声检查报告', focus: ['检查部位', '大小形态', '结论'], next: '先看结论部分，再和现在症状对照。' },
  { pattern: /(病理)/i, title: '病理报告', focus: ['标本部位', '病理诊断', '备注'], next: '病理报告优先看诊断结论，后续按专科医生建议处理。' },
];

function formatSize(size) {
  const num = Number(size || 0);
  if (!num) return '未知大小';
  if (num >= 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)}MB`;
  if (num >= 1024) return `${Math.round(num / 1024)}KB`;
  return `${num}B`;
}

function inferSummaryFromName(originalName = '', label = '') {
  const source = `${label} ${originalName}`;
  const match = REPORT_KEYWORDS.find((item) => item.pattern.test(source));
  if (match) {
    return {
      title: match.title,
      highlights: match.focus,
      nextStep: match.next,
    };
  }

  if (/pdf/i.test(originalName)) {
    return {
      title: '检查报告文件',
      highlights: ['报告名称', '结论', '医生建议'],
      nextStep: '先看报告结论和建议，再决定是否需要带去复诊。',
    };
  }

  return {
    title: label === '检验报告' ? '检查报告图片' : '补充图片材料',
    highlights: ['检查名称', '主要结论', '日期'],
    nextStep: '先确认这份资料和本次症状是否相关，复诊时记得一并带上。',
  };
}

function summarizeFile(file, label = '补充材料') {
  const base = inferSummaryFromName(file.originalname || '', label);
  return {
    kind: label,
    fileName: file.originalname,
    fileType: file.mimetype || 'unknown',
    sizeText: formatSize(file.size),
    title: base.title,
    highlights: base.highlights,
    nextStep: base.nextStep,
    disclaimer: '当前为基础版摘要，主要根据文件名和材料类型判断，不替代医生解读。',
  };
}

module.exports = { summarizeFile };
