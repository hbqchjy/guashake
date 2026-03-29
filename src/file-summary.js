const fs = require('fs');

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

function normalizeText(text = '') {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[：:]/g, '：')
    .trim();
}

function pickHighlightsFromText(text = '') {
  const compact = normalizeText(text);
  if (!compact) return [];

  const candidates = [];
  const lineRules = [
    /(?:结论|提示|印象|诊断)[：:]\s*([^。；\n]{2,40})/i,
    /(?:检查项目|项目名称)[：:]\s*([^。；\n]{2,40})/i,
    /(?:白细胞|血红蛋白|肌酐|尿蛋白|心率|血压)[^。\n]{0,24}/i,
  ];

  for (const rule of lineRules) {
    const match = compact.match(rule);
    if (match?.[1]) {
      candidates.push(match[1]);
    } else if (match?.[0]) {
      candidates.push(match[0]);
    }
  }

  return [...new Set(candidates)].slice(0, 3);
}

function extractKeyMetrics(text = '') {
  const compact = normalizeText(text);
  if (!compact) return [];

  const rules = [
    { label: '白细胞', pattern: /(白细胞|WBC)[^0-9]{0,6}([0-9]+(?:\.[0-9]+)?)/i },
    { label: '血红蛋白', pattern: /(血红蛋白|HGB)[^0-9]{0,6}([0-9]+(?:\.[0-9]+)?)/i },
    { label: '血小板', pattern: /(血小板|PLT)[^0-9]{0,6}([0-9]+(?:\.[0-9]+)?)/i },
    { label: '肌酐', pattern: /(肌酐)[^0-9]{0,6}([0-9]+(?:\.[0-9]+)?)/i },
    { label: '尿酸', pattern: /(尿酸)[^0-9]{0,6}([0-9]+(?:\.[0-9]+)?)/i },
    { label: '心率', pattern: /(心率)[^0-9]{0,6}([0-9]+(?:\.[0-9]+)?)/i },
    { label: '收缩压', pattern: /(收缩压)[^0-9]{0,6}([0-9]+(?:\.[0-9]+)?)/i },
    { label: '舒张压', pattern: /(舒张压)[^0-9]{0,6}([0-9]+(?:\.[0-9]+)?)/i },
  ];

  const metrics = [];
  for (const rule of rules) {
    const match = compact.match(rule.pattern);
    if (match?.[2]) {
      metrics.push(`${rule.label} ${match[2]}`);
    }
  }

  const abnormalHints = compact.match(/(偏高|偏低|升高|降低|阳性|阴性)/g) || [];
  for (const hint of abnormalHints.slice(0, 2)) {
    metrics.push(`提示 ${hint}`);
  }

  return [...new Set(metrics)].slice(0, 4);
}

function inferSummaryFromText(text = '', fallbackTitle = '检查报告') {
  const compact = normalizeText(text);
  if (!compact) return null;

  const matched = REPORT_KEYWORDS.find((item) => item.pattern.test(compact));
  const highlights = pickHighlightsFromText(compact);

  if (matched) {
    return {
      title: matched.title,
      highlights: highlights.length ? highlights : matched.focus,
      nextStep: matched.next,
    };
  }

  if (highlights.length) {
    return {
      title: fallbackTitle,
      highlights,
      nextStep: '先看结论和关键指标，再决定是否需要补做其他检查。',
    };
  }

  return null;
}

async function extractTextWithWebhook(file) {
  const webhook = process.env.OCR_WEBHOOK_URL;
  if (!webhook || !file?.path || !fs.existsSync(file.path)) {
    return null;
  }

  const form = new FormData();
  const buffer = fs.readFileSync(file.path);
  const blob = new Blob([buffer], { type: file.mimetype || 'application/octet-stream' });
  form.append('file', blob, file.originalname || 'upload.bin');

  const response = await fetch(webhook, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    throw new Error(`ocr webhook failed: ${response.status}`);
  }

  const payload = await response.json().catch(() => ({}));
  return normalizeText(payload.text || payload.ocrText || payload.content || '');
}

async function summarizeFile(file, label = '补充材料') {
  const base = inferSummaryFromName(file.originalname || '', label);
  let ocrText = '';
  let ocrEnabled = false;

  try {
    ocrText = await extractTextWithWebhook(file);
    ocrEnabled = Boolean(process.env.OCR_WEBHOOK_URL);
  } catch (_error) {
    ocrText = '';
    ocrEnabled = Boolean(process.env.OCR_WEBHOOK_URL);
  }

  const inferred = inferSummaryFromText(ocrText, base.title) || base;
  const keyMetrics = ocrText ? extractKeyMetrics(ocrText) : [];

  return {
    kind: label,
    fileName: file.originalname,
    fileType: file.mimetype || 'unknown',
    sizeText: formatSize(file.size),
    title: inferred.title,
    highlights: inferred.highlights,
    keyMetrics,
    nextStep: inferred.nextStep,
    ocrText: ocrText ? ocrText.slice(0, 220) : '',
    ocrMode: ocrText ? 'webhook' : 'fallback',
    disclaimer: ocrText
      ? '当前摘要已参考 OCR 提取结果，仍建议结合医生正式报告解读。'
      : ocrEnabled
        ? 'OCR 服务暂时没有返回有效文字，当前先按文件名和材料类型做基础摘要。'
        : '当前未配置 OCR 服务，先按文件名和材料类型做基础摘要。',
  };
}

module.exports = { summarizeFile };
