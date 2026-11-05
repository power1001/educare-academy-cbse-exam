// Educare Academy - CBSE Class 10 Science PDF Question Paper Generator
const PDFDocument = require('pdfkit');

/**
 * Generates a clean, professionally formatted PDF of the 25 questions with answers and explanations
 * @param {Object} data { chapter, date, questions, repeatedIds }
 * @param {stream.Writable} outputStream Writable stream to pipe PDF into
 */
function generateQuestionPaperPdf(data, outputStream) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: {
      Title: `Educare Academy - CBSE Class 10 Science - Ch ${data.chapter?.id || 1} Assessment`,
      Author: 'Educare Academy Examination Control Desk',
      Subject: 'CBSE Class 10th Science Daily Question Paper',
      Keywords: 'CBSE, Class 10, Science, Educare Academy, NCERT'
    }
  });

  doc.pipe(outputStream);

  const primaryColor = '#0B2545';
  const secondaryColor = '#134074';
  const accentGold = '#D97706';
  const darkTextColor = '#1E293B';
  const lightMutedColor = '#64748B';
  const greenColor = '#15803D';

  const chId = data.chapter?.id || 1;
  const chName = data.chapter?.name || 'Chemical Reactions and Equations';
  const examDate = data.date || new Date().toISOString().slice(0, 10);
  const repeatedSet = new Set(data.repeatedIds || []);

  // --- HEADER SECTION ---
  doc.rect(40, 40, 515, 68).fillAndStroke('#0B2545', '#0B2545');

  doc.fillColor('#FFFFFF').fontSize(16).font('Helvetica-Bold')
     .text('EDUCARE ACADEMY', 50, 48, { align: 'center', width: 495 });

  doc.fillColor('#FEF08A').fontSize(10).font('Helvetica-Bold')
     .text('CBSE CLASS 10TH SCIENCE • DAILY ASSESSMENT QUESTION PAPER', 50, 68, { align: 'center', width: 495 });

  doc.fillColor('#E2E8F0').fontSize(8.5).font('Helvetica')
     .text(`Chapter ${chId}: ${chName}   |   Date: ${examDate}   |   Helpline: +91 8448467381`, 50, 84, { align: 'center', width: 495 });

  doc.y = 118;

  // Meta Info Bar
  doc.rect(40, 114, 515, 22).fillAndStroke('#F1F5F9', '#CBD5E1');
  doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold')
     .text('TOTAL QUESTIONS: 25 (MCQ)', 48, 120, { continued: true })
     .text('      MAXIMUM MARKS: 25', { continued: true })
     .text('      DURATION: 25 MINUTES', { continued: true })
     .text('      MARKING: +1 CORRECT, 0 NEGATIVE', { align: 'right' });

  doc.y = 145;

  const keys = ['A', 'B', 'C', 'D'];
  const questions = data.questions || [];

  // --- RENDER 25 QUESTIONS ---
  questions.forEach((q, idx) => {
    // Check if new page needed
    if (doc.y > 690) {
      doc.addPage();
      renderPageHeaderMini(doc, chId, chName, examDate);
    }

    const isRepeated = repeatedSet.has(q.id);
    const tag = isRepeated ? '[REPEAT FROM YESTERDAY]' : '[FRESH QUESTION]';
    const tagColor = isRepeated ? '#9333EA' : '#0284C7';

    // Question Box Header
    const startY = doc.y;
    doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold')
       .text(`Q${idx + 1}. `, 40, startY, { continued: true });

    doc.fillColor(tagColor).fontSize(8).font('Helvetica-Bold')
       .text(`${tag} `, { continued: true });

    doc.fillColor(darkTextColor).fontSize(9.5).font('Helvetica')
       .text(q.text || q.question || '', { width: 515, lineGap: 2 });

    doc.moveDown(0.3);

    // Options
    if (Array.isArray(q.options)) {
      q.options.forEach((opt, oIdx) => {
        const letter = keys[oIdx] || 'A';
        const optText = (typeof opt === 'object' && opt !== null) ? (opt.text || opt.label || '') : String(opt || '');

        doc.fillColor(lightMutedColor).fontSize(8.5).font('Helvetica-Bold')
           .text(`    (${letter}) `, { continued: true });
        doc.fillColor(darkTextColor).fontSize(8.5).font('Helvetica')
           .text(optText, { width: 480 });
      });
    }

    // Divider line between questions
    doc.moveDown(0.4);
    doc.strokeColor('#E2E8F0').lineWidth(0.5)
       .moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.5);
  });

  // --- ANSWER KEY & EXPLANATIONS SECTION (NEW PAGE) ---
  doc.addPage();
  renderAnswerKeyPage(doc, questions, chId, chName, examDate);

  doc.end();
}

function renderPageHeaderMini(doc, chId, chName, date) {
  doc.rect(40, 30, 515, 20).fillAndStroke('#0B2545', '#0B2545');
  doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold')
     .text(`EDUCARE ACADEMY • CBSE CLASS 10 SCIENCE • CH ${chId}: ${chName} • DATE: ${date}`, 45, 36, { align: 'center', width: 505 });
  doc.y = 60;
}

function renderAnswerKeyPage(doc, questions, chId, chName, date) {
  const primaryColor = '#0B2545';
  const greenColor = '#15803D';
  const darkTextColor = '#1E293B';
  const keys = ['A', 'B', 'C', 'D'];

  doc.rect(40, 35, 515, 30).fillAndStroke('#0B2545', '#0B2545');
  doc.fillColor('#FFFFFF').fontSize(12).font('Helvetica-Bold')
     .text('OFFICIAL ANSWER KEY & NCERT EXPLANATIONS', 45, 43, { align: 'center', width: 505 });

  doc.y = 75;

  // Quick Answer Grid (5 rows x 5 columns)
  doc.rect(40, 75, 515, 55).fillAndStroke('#F8FAFC', '#CBD5E1');
  doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold')
     .text('QUICK ANSWER MATRIX (TEACHER REFERENCE):', 48, 80);

  const colWidth = 100;
  for (let col = 0; col < 5; col++) {
    const xPos = 48 + (col * colWidth);
    for (let row = 0; row < 5; row++) {
      const qIdx = (col * 5) + row;
      if (qIdx < questions.length) {
        const q = questions[qIdx];
        const cAns = (q.correctAnswer !== undefined && q.correctAnswer !== null) ? q.correctAnswer : 0;
        const ansLetter = (typeof cAns === 'number') ? keys[cAns] : String(cAns);
        const yPos = 95 + (row * 6.5);
        doc.fillColor(primaryColor).fontSize(7).font('Helvetica-Bold')
           .text(`Q${qIdx + 1}: `, xPos, yPos, { continued: true });
        doc.fillColor(greenColor).fontSize(7).font('Helvetica-Bold')
           .text(`(${ansLetter})`, { continued: false });
      }
    }
  }

  doc.y = 140;
  doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold')
     .text('DETAILED NCERT STEP-BY-STEP EXPLANATIONS', 40, doc.y);
  doc.moveDown(0.4);

  questions.forEach((q, idx) => {
    if (doc.y > 700) {
      doc.addPage();
      renderPageHeaderMini(doc, chId, chName, date);
    }

    const cAns = (q.correctAnswer !== undefined && q.correctAnswer !== null) ? q.correctAnswer : 0;
    const ansLetter = (typeof cAns === 'number') ? keys[cAns] : String(cAns);
    const correctOpt = Array.isArray(q.options) && q.options[cAns];
    const correctText = (typeof correctOpt === 'object' && correctOpt !== null) ? (correctOpt.text || '') : String(correctOpt || '');

    doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold')
       .text(`Q${idx + 1}. `, 40, doc.y, { continued: true });
    doc.fillColor(greenColor).fontSize(8.5).font('Helvetica-Bold')
       .text(`Correct Option (${ansLetter}): ${correctText}`, { continued: false });

    if (q.explanation) {
      doc.fillColor(darkTextColor).fontSize(8).font('Helvetica')
         .text(`Explanation: ${q.explanation}`, 52, doc.y, { width: 500, lineGap: 1.5 });
    }

    doc.moveDown(0.3);
  });

  // Footer seal
  doc.moveDown(0.8);
  doc.rect(40, doc.y, 515, 25).fillAndStroke('#FEF3C7', '#F59E0B');
  doc.fillColor('#92400E').fontSize(8).font('Helvetica-Bold')
     .text('Educare Academy Assessment Control Desk • Helpline / WhatsApp: +91 8448467381', 45, doc.y + 7, { align: 'center', width: 505 });
}

module.exports = {
  generateQuestionPaperPdf
};
