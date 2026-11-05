/**
 * Question Manager: Weekly Chapter Schedule & Daily 25 Selection Logic
 *
 * Rules:
 * 1. Weekly Chapter Wise: Each week is dedicated to one NCERT Class 10 chapter.
 * 2. 50-Question Pool per chapter.
 * 3. Daily 25 Questions:
 *    - Day 1: 25 questions randomly selected from the 50 pool.
 *    - Next day: 5 questions repeated from previous day + 20 new questions from remaining 25.
 * 4. Integration with WhatsApp: Formats the daily 25 questions set for Teacher Helpline (+91 8448467381).
 */

const fs = require('fs');
const path = require('path');
const { NCERT_CHAPTERS } = require('./ncert_question_scraper');

const HISTORY_FILE = path.join(__dirname, 'daily_question_history.json');
const ACTIVE_CONFIG_FILE = path.join(__dirname, 'active_test_config.json');
const QUESTIONS_DB_FILE = path.join(__dirname, 'cbse10_questions.json');

function getTodayString() {
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function getYesterdayString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function loadHistory() {
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    } catch (e) {
      console.warn('Could not parse daily question history, initializing fresh.');
    }
  }
  return {};
}

function saveHistory(data) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving daily question history:', e);
  }
}

function getQuestionsDb() {
  if (fs.existsSync(QUESTIONS_DB_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(QUESTIONS_DB_FILE, 'utf-8'));
    } catch (e) {
      console.error('Error reading questions DB:', e);
    }
  }
  return { chapters: NCERT_CHAPTERS, pools: {} };
}

function getActiveConfig() {
  if (fs.existsSync(ACTIVE_CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(ACTIVE_CONFIG_FILE, 'utf-8'));
    } catch (e) {}
  }
  return {
    institution: 'Educare Academy',
    examName: 'Educare Academy - CBSE Class 10th Science Daily Chapter Assessment',
    subject: 'Science',
    classLevel: 'Class 10 (CBSE Board)',
    activeChapterId: 1,
    activeChapterName: 'Chemical Reactions and Equations',
    activeChapterHindi: 'रासायनिक अभिक्रियाएं एवं समीकरण',
    poolSize: 50,
    questionsInTest: 25,
    durationMinutes: 25,
    adminWhatsApp: '8448467381'
  };
}

function saveActiveConfig(cfg) {
  try {
    fs.writeFileSync(ACTIVE_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving active test config:', e);
  }
}

/**
 * Calculates current active week and corresponding chapter.
 * Rotates every 7 days (Monday to Sunday or weekly cycle).
 */
function getWeeklyActiveChapter() {
  const cfg = getActiveConfig();
  // If explicitly pinned by admin, use that; otherwise calculate from calendar week
  if (cfg.activeChapterId) {
    const found = NCERT_CHAPTERS.find(c => c.id === cfg.activeChapterId);
    if (found) return found;
  }
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const weekNumber = Math.ceil((((now - startOfYear) / 86400000) + startOfYear.getDay() + 1) / 7);
  const chapterIdx = (weekNumber - 1) % NCERT_CHAPTERS.length;
  return NCERT_CHAPTERS[chapterIdx];
}

/**
 * Ensures today's 25 questions are selected according to the rule:
 * - 5 questions repeated from yesterday
 * - 20 fresh questions from the other 25 of the 50-pool
 */
function ensureTodayQuestions(forceRegenerate = false) {
  const activeChapter = getWeeklyActiveChapter();
  const chapterId = activeChapter.id;
  const todayStr = getTodayString();
  const yesterdayStr = getYesterdayString();

  const history = loadHistory();
  const db = getQuestionsDb();
  const pool = (db.pools && db.pools[String(chapterId)]) || [];
  const poolCount = Math.min(pool.length || 50, 50);

  // Pool question IDs: 1 to 50
  const allPoolIds = Array.from({ length: poolCount }, (_, i) => i + 1);

  // If today's selection already exists and not forced, return it
  if (!forceRegenerate && history[todayStr] && history[todayStr].chapterId === chapterId && history[todayStr].selectedIds && history[todayStr].selectedIds.length === 25) {
    return {
      chapter: activeChapter,
      date: todayStr,
      selectedIds: history[todayStr].selectedIds,
      repeatedIds: history[todayStr].repeatedIds || [],
      freshIds: history[todayStr].freshIds || [],
      isNewSelection: false
    };
  }

  // Find yesterday's set for this chapter (or most recent previous set)
  let previousSet = null;
  if (history[yesterdayStr] && history[yesterdayStr].chapterId === chapterId) {
    previousSet = history[yesterdayStr].selectedIds;
  } else {
    // Check any most recent date for this chapter
    const pastDates = Object.keys(history).filter(d => d < todayStr && history[d].chapterId === chapterId).sort().reverse();
    if (pastDates.length > 0) {
      previousSet = history[pastDates[0]].selectedIds;
    }
  }

  let selectedIds = [];
  let repeatedIds = [];
  let freshIds = [];

  if (previousSet && previousSet.length >= 5) {
    // 1. Pick 5 random questions to repeat from previous day
    const shuffledPrevious = [...previousSet].sort(() => Math.random() - 0.5);
    repeatedIds = shuffledPrevious.slice(0, 5);

    // 2. Identify the other 25 questions from the 50-pool that were NOT in previous set
    const remainingPool = allPoolIds.filter(id => !previousSet.includes(id));

    // If remainingPool has at least 20, pick 20 from it
    if (remainingPool.length >= 20) {
      const shuffledRemaining = [...remainingPool].sort(() => Math.random() - 0.5);
      freshIds = shuffledRemaining.slice(0, 20);
    } else {
      // Fallback if pool is small: pick any not already in repeatedIds
      const available = allPoolIds.filter(id => !repeatedIds.includes(id)).sort(() => Math.random() - 0.5);
      freshIds = available.slice(0, 20);
    }

    selectedIds = [...repeatedIds, ...freshIds];
  } else {
    // Day 1 of chapter: pick 25 random from the 50-pool
    const shuffled = [...allPoolIds].sort(() => Math.random() - 0.5);
    selectedIds = shuffled.slice(0, 25);
    freshIds = [...selectedIds];
    repeatedIds = [];
  }

  // Save to history
  history[todayStr] = {
    date: todayStr,
    chapterId: chapterId,
    chapterName: activeChapter.name,
    selectedIds: selectedIds,
    repeatedIds: repeatedIds,
    freshIds: freshIds,
    updatedAt: new Date().toISOString()
  };
  saveHistory(history);

  // Update active test config
  const currentCfg = getActiveConfig();
  const updatedCfg = {
    ...currentCfg,
    activeChapterId: activeChapter.id,
    activeChapterName: activeChapter.name,
    activeChapterHindi: activeChapter.hindi,
    selectedQuestionIds: selectedIds,
    repeatedQuestionIds: repeatedIds,
    freshQuestionIds: freshIds,
    todayDate: todayStr,
    lastUpdated: new Date().toISOString()
  };
  saveActiveConfig(updatedCfg);

  console.log(`[QUESTION ROTATION] Day ${todayStr} for Ch ${chapterId} (${activeChapter.name}): 25 Questions Selected (5 Repeating: [${repeatedIds.join(', ')}], 20 Fresh: [${freshIds.join(', ')}])`);

  return {
    chapter: activeChapter,
    date: todayStr,
    selectedIds,
    repeatedIds,
    freshIds,
    isNewSelection: true
  };
}

/**
 * Returns formatted text ready to send to WhatsApp +91 8448467381
 */
function formatWhatsAppDailyQuestions(chapterId = null) {
  const cfg = getActiveConfig();
  const chId = chapterId || cfg.activeChapterId || 1;
  const chapter = NCERT_CHAPTERS.find(c => c.id === Number(chId)) || NCERT_CHAPTERS[0];

  const db = getQuestionsDb();
  const pool = (db.pools && db.pools[String(chId)]) || [];
  const todaySelection = ensureTodayQuestions();

  const selectedQuestions = pool.filter(q => todaySelection.selectedIds.includes(q.id));
  const repeatedSet = new Set(todaySelection.repeatedIds);

  let text = `*EDUCARE ACADEMY - CBSE CLASS 10TH SCIENCE*\n`;
  text += `*Daily Assessment Question Paper (25 Questions)*\n`;
  text += `📅 Date: ${todaySelection.date} | Week's Chapter: *Ch ${chapter.id} - ${chapter.name}*\n`;
  text += `🎯 Structure: 5 Repeating Questions (🔁) + 20 Fresh Questions (✨) from 50-Question Pool\n`;
  text += `📞 Teacher Helpline: +91 8448467381\n`;
  text += `-------------------------------------------\n\n`;

  const keys = ['A', 'B', 'C', 'D'];
  selectedQuestions.forEach((q, idx) => {
    const isRepeated = repeatedSet.has(q.id);
    const tag = isRepeated ? '🔁 [REPEAT FROM YESTERDAY]' : '✨ [FRESH QUESTION]';
    const qText = q.text || q.question || '';
    text += `*Q${idx + 1}.* ${tag}\n${qText}\n`;
    if (Array.isArray(q.options)) {
      q.options.forEach((opt, oIdx) => {
        const letter = keys[oIdx] || String.fromCharCode(65 + oIdx);
        let optText = '';
        if (typeof opt === 'string') {
          optText = opt;
        } else if (opt && typeof opt === 'object') {
          optText = opt.text || opt.label || opt.hindi || '';
        }
        text += `   (${letter}) ${optText}\n`;
      });
    }

    // Determine correct answer letter and option text
    let ansLetter = 'A';
    let ansOptionText = '';
    const cAns = (q.correctAnswer !== undefined && q.correctAnswer !== null) ? q.correctAnswer : q.answer;

    if (typeof cAns === 'number' && q.options && q.options[cAns] !== undefined) {
      ansLetter = keys[cAns] || String.fromCharCode(65 + cAns);
      const optObj = q.options[cAns];
      ansOptionText = (typeof optObj === 'object' && optObj !== null) ? (optObj.text || optObj.hindi || '') : String(optObj || '');
    } else if (typeof cAns === 'string' && /^[A-Da-d]$/.test(cAns)) {
      ansLetter = cAns.toUpperCase();
      const cIdx = ansLetter.charCodeAt(0) - 65;
      if (q.options && q.options[cIdx] !== undefined) {
        const optObj = q.options[cIdx];
        ansOptionText = (typeof optObj === 'object' && optObj !== null) ? (optObj.text || optObj.hindi || '') : String(optObj || '');
      }
    } else if (typeof cAns === 'string' && /^[0-3]$/.test(cAns)) {
      const cIdx = parseInt(cAns, 10);
      ansLetter = keys[cIdx] || String.fromCharCode(65 + cIdx);
      if (q.options && q.options[cIdx] !== undefined) {
        const optObj = q.options[cIdx];
        ansOptionText = (typeof optObj === 'object' && optObj !== null) ? (optObj.text || optObj.hindi || '') : String(optObj || '');
      }
    } else if (typeof cAns === 'string' && /^[1-4]$/.test(cAns)) {
      const cIdx = parseInt(cAns, 10) - 1;
      ansLetter = keys[cIdx] || String.fromCharCode(65 + cIdx);
      if (q.options && q.options[cIdx] !== undefined) {
        const optObj = q.options[cIdx];
        ansOptionText = (typeof optObj === 'object' && optObj !== null) ? (optObj.text || optObj.hindi || '') : String(optObj || '');
      }
    }

    text += `*Ans:* (${ansLetter}) ${ansOptionText}\n`;
    if (q.explanation) {
      text += `_Explanation:_ ${q.explanation}\n`;
    }
    text += `\n`;
  });

  text += `-------------------------------------------\n`;
  text += `📄 *Official Designed PDF Question Paper & Answer Key:*\n`;
  text += `http://localhost:3050/question-paper?chapterId=${chapter.id}\n`;
  text += `-------------------------------------------\n`;
  text += `Educare Academy Examination Control Desk\n`;

  const targetPhone = '8448467381';
  const whatsappUrl = `https://wa.me/91${targetPhone}?text=${encodeURIComponent(text)}`;

  return {
    success: true,
    targetPhone,
    chapter,
    date: todaySelection.date,
    totalQuestions: selectedQuestions.length,
    repeatedCount: todaySelection.repeatedIds.length,
    freshCount: todaySelection.freshIds.length,
    questions: selectedQuestions,
    pdfDownloadUrl: `/api/admin/download-questions-pdf?chapterId=${chapter.id}`,
    questionPaperWebUrl: `/question-paper?chapterId=${chapter.id}`,
    text: text,
    rawText: text,
    whatsappUrl
  };
}

/**
 * Deterministically shuffles questions using a seed (e.g. student roll number or session).
 * Prevents cheating while ensuring consistent question order for the same student session.
 */
function shuffleQuestionsBySeed(questionsList, seedStr) {
  if (!Array.isArray(questionsList) || questionsList.length <= 1) return questionsList;
  
  const str = String(seedStr || Date.now());
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  let seed = h >>> 0;
  if (seed === 0) seed = 123456789;

  function random() {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const result = [...questionsList];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
}

module.exports = {
  NCERT_CHAPTERS,
  getWeeklyActiveChapter,
  ensureTodayQuestions,
  formatWhatsAppDailyQuestions,
  shuffleQuestionsBySeed,
  getActiveConfig,
  saveActiveConfig,
  getQuestionsDb
};
