const PDFDocument = require('pdfkit');

function buildArchivePdf(record, res) {
  const doc = new PDFDocument({ margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=archive-${record.id}.pdf`);

  doc.pipe(res);
  doc.fontSize(20).text('挂啥科 - 就医记录摘要', { align: 'left' });
  doc.moveDown(0.5);
  doc.fontSize(12).text(`记录ID: ${record.id}`);
  doc.text(`时间: ${record.createdAt || '-'}`);
  doc.text(`用户: ${record.userId || '-'}`);
  doc.moveDown();

  doc.fontSize(14).text('核心结论');
  doc.fontSize(12).text(record.summary || '-');
  doc.moveDown();

  doc.fontSize(14).text('建议科室与检查');
  doc.fontSize(12).text(`科室: ${record.department || '-'}`);
  doc.text(`首轮费用: ${record.costRange || '-'}`);

  if (Array.isArray(record.firstChecks) && record.firstChecks.length > 0) {
    doc.moveDown(0.5);
    for (const item of record.firstChecks) {
      doc.text(`- ${item.name}: ${item.min}~${item.max}元`);
    }
  }

  if (Array.isArray(record.files) && record.files.length > 0) {
    doc.moveDown();
    doc.fontSize(14).text('已上传资料');
    doc.fontSize(12);
    for (const file of record.files) {
      doc.text(`- ${file.originalName}`);
      if (file.summary?.title) {
        doc.text(`  摘要: ${file.summary.title}`);
      }
    }
  }

  doc.moveDown();
  doc.fontSize(10).text('免责声明：本资料仅作就医前信息参考，不能替代医生面诊。');
  doc.end();
}

module.exports = { buildArchivePdf };
