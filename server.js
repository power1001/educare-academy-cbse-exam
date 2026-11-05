// Educare Academy - CBSE Class 10th Science Assessment Server
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3050;
const PUBLIC_DIR = __dirname;
const COMPLETED_FILE = path.join(__dirname, 'completed_students.json');
const PACKAGE_FILE = path.join(__dirname, 'package.json');
const SCHEDULE_FILE = path.join(__dirname, 'portal_schedule.json');
const QUESTIONS_FILE = path.join(__dirname, 'cbse10_questions.json');
const ACTIVE_CONFIG_FILE = path.join(__dirname, 'active_test_config.json');
const ROSTER_FILE = path.join(__dirname, 'students_roster.json');

// Ensure completed_students.json exists
if (!fs.existsSync(COMPLETED_FILE)) {
  fs.writeFileSync(COMPLETED_FILE, JSON.stringify([], null, 2), 'utf8');
}

// Media Records directories for Candidate Verification Photos and Compressed Proctoring Videos
const RECORDS_DIR = path.join(__dirname, 'records');
const PHOTOS_DIR = path.join(RECORDS_DIR, 'photos');
const VIDEOS_DIR = path.join(RECORDS_DIR, 'videos');
if (!fs.existsSync(RECORDS_DIR)) fs.mkdirSync(RECORDS_DIR, { recursive: true });
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });
if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });

// Optional Oracle Cloud Database module
let oracleDb = null;
try {
  oracleDb = require('./oracle_db');
} catch (e) {
  console.log('[ORACLE DB] oracle_db module loaded in fallback mode.');
}

// Dynamic Question Manager & NCERT Scraper modules
const questionManager = require('./question_manager');
const ncertScraper = require('./ncert_question_scraper');
const pdfGenerator = require('./pdf_generator');

// Daily 1:00 AM IST Proctoring Media Auto-Cleanup
function cleanupProctorMedia() {
  let videoCount = 0;
  let photoCount = 0;
  try {
    if (fs.existsSync(VIDEOS_DIR)) {
      const vFiles = fs.readdirSync(VIDEOS_DIR);
      vFiles.forEach(f => {
        try {
          fs.unlinkSync(path.join(VIDEOS_DIR, f));
          videoCount++;
        } catch (e) {}
      });
    }
    if (fs.existsSync(PHOTOS_DIR)) {
      const pFiles = fs.readdirSync(PHOTOS_DIR);
      pFiles.forEach(f => {
        try {
          fs.unlinkSync(path.join(PHOTOS_DIR, f));
          photoCount++;
        } catch (e) {}
      });
    }
    console.log(`[PROCTOR MEDIA AUTO-PURGE 1:00 AM IST] Successfully removed ${videoCount} videos and ${photoCount} captured photos. Clean disk ready for next exam.`);
    return { success: true, videosDeleted: videoCount, photosDeleted: photoCount };
  } catch (err) {
    console.error('Error during proctor media purge:', err);
    return { success: false, error: err.message };
  }
}

// 1:00 AM IST Auto-Purge Scheduler
let lastPurgeDate = '';
setInterval(() => {
  try {
    const nowIst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const currentHour = nowIst.getHours();
    const currentMinute = nowIst.getMinutes();
    const currentDateStr = nowIst.toISOString().slice(0, 10);

    // Runs automatically at 01:00 AM IST daily
    if (currentHour === 1 && currentMinute === 0 && lastPurgeDate !== currentDateStr) {
      console.log(`[DAILY AUTO-PURGE] Triggering 1:00 AM IST proctor media purge for date: ${currentDateStr}...`);
      cleanupProctorMedia();
      lastPurgeDate = currentDateStr;
    }
  } catch (e) {
    console.error('Error in 1:00 AM scheduler interval:', e);
  }
}, 60000);

// In-memory real-time active exam sessions map
const activeExamSessions = new Map();

const DEFAULT_SCHEDULE = {
  portalOpen: true,
  deadline: '2026-12-31T23:59:59+05:30',
  deadlineFormatted: '31 Dec 2026, 11:59:59 PM IST',
  timezone: 'Asia/Kolkata',
  closedMessage: 'Educare Academy CBSE Class 10th Examination Portal registration and testing window is currently closed. Contact Sir at +91 8448467381.',
  closedMessageHindi: 'एजुकेयर एकेडमी कक्षा 10वीं सीबीएसई दैनिक परीक्षा पोर्टल वर्तमान में बंद है। सहायता के लिए +91 8448467381 पर संपर्क करें।',
  updatedAt: new Date().toISOString(),
  updatedBy: 'Educare Academy Admin'
};

const ADMIN_PASSWORDS = ['Rockey6974@'];

function isValidAdminPassword(pass) {
  if (!pass) return false;
  const clean = String(pass).trim();
  return ADMIN_PASSWORDS.includes(clean);
}

function verifyAdminAuth(req, body = null, queryStr = '') {
  const adminKey = req.headers['x-admin-key'] || req.headers['authorization'];
  if (adminKey) {
    const clean = adminKey.replace(/^Bearer\s+/i, '').trim();
    if (isValidAdminPassword(clean)) return true;
  }
  if (body) {
    const p = body.adminPassword || body.adminKey || body.password || body.adminPass;
    if (isValidAdminPassword(p)) return true;
  }
  if (queryStr) {
    try {
      const qParams = new URLSearchParams(queryStr);
      const qKey = qParams.get('adminKey') || qParams.get('adminPass') || qParams.get('pass');
      if (isValidAdminPassword(qKey)) return true;
    } catch (e) {}
  }
  return false;
}

function getPortalSchedule() {
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      const data = fs.readFileSync(SCHEDULE_FILE, 'utf8');
      return { ...DEFAULT_SCHEDULE, ...JSON.parse(data || '{}') };
    }
  } catch (err) {
    console.error('Error reading portal_schedule.json:', err);
  }
  return DEFAULT_SCHEDULE;
}

function savePortalSchedule(schedule) {
  try {
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedule, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing portal_schedule.json:', err);
    return false;
  }
}

function evaluatePortalStatus(schedule) {
  const current = schedule || getPortalSchedule();
  const now = Date.now();
  const deadlineTime = new Date(current.deadline).getTime();
  const isTimeExpired = !isNaN(deadlineTime) && now > deadlineTime;
  const isManuallyClosed = current.portalOpen === false;

  let status = 'OPEN';
  if (isManuallyClosed) {
    status = 'CLOSED';
  } else if (isTimeExpired) {
    status = 'EXPIRED';
  }

  const isOpen = status === 'OPEN';
  const timeRemainingMs = Math.max(0, (deadlineTime || 0) - now);

  return {
    ...current,
    isOpen,
    status,
    isTimeExpired,
    isManuallyClosed,
    serverTime: new Date().toISOString(),
    timeRemainingMs,
    currentTimeMs: now
  };
}

function getPackageConfig() {
  try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf8'));
    return pkg.examConfig || {
      institutionName: 'Educare Academy',
      examName: 'Educare Academy - CBSE Class 10th Science Daily Chapter Assessment',
      commonPassword: 'Edu@26',
      totalQuestions: 25,
      poolSize: 50,
      teacherWhatsApp: '8448467381',
      students: []
    };
  } catch (err) {
    console.error('Error reading package.json config:', err);
    return {
      institutionName: 'Educare Academy',
      examName: 'Educare Academy - CBSE Class 10th Science Daily Chapter Assessment',
      commonPassword: 'Edu@26',
      totalQuestions: 25,
      poolSize: 50,
      teacherWhatsApp: '8448467381',
      students: []
    };
  }
}

function getQuestionsDb() {
  try {
    if (fs.existsSync(QUESTIONS_FILE)) {
      return JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading cbse10_questions.json:', err);
  }
  return { chapters: [], pools: {} };
}

function getActiveConfig() {
  try {
    if (fs.existsSync(ACTIVE_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(ACTIVE_CONFIG_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading active_test_config.json:', err);
  }
  return {
    institution: 'Educare Academy',
    activeChapterId: 1,
    activeChapterName: 'Chemical Reactions and Equations',
    activeChapterHindi: 'रासायनिक अभिक्रियाएं एवं समीकरण',
    poolSize: 50,
    questionsInTest: 25,
    durationMinutes: 25,
    adminWhatsApp: '8448467381',
    teacherNotice: 'Ye question ka set se aaj test hoga. 50 questions import ho chuke hain, students ke test me inme se 25 questions aayenge.',
    selectedQuestionIds: Array.from({ length: 25 }, (_, i) => i + 1)
  };
}

function saveActiveConfig(cfg) {
  try {
    fs.writeFileSync(ACTIVE_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving active_test_config.json:', err);
    return false;
  }
}


function generateUnguessableCode(length = 3) {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let res = '';
  for (let i = 0; i < length; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return res;
}

function generateUnguessablePassword(length = 8) {
  const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowers = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '@#$&*';
  const all = uppers + lowers + digits + symbols;
  const pwd = [
    uppers[Math.floor(Math.random() * uppers.length)],
    lowers[Math.floor(Math.random() * lowers.length)],
    digits[Math.floor(Math.random() * digits.length)],
    symbols[Math.floor(Math.random() * symbols.length)]
  ];
  while (pwd.length < length) {
    pwd.push(all[Math.floor(Math.random() * all.length)]);
  }
  return pwd.sort(() => Math.random() - 0.5).join('');
}

function formatStudentCredentialsWhatsApp(student, host) {
  const cleanPhone = (student.phone || '').replace(/[^0-9]/g, '');
  const waPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : (cleanPhone.length >= 11 ? cleanPhone : '918448467381');
  const waText = `📚 *EDUCARE ACADEMY - CBSE CLASS 10TH SCIENCE EXAM*\n\n` +
    `Namaste *${student.name}*,\n` +
    `Here are your official login credentials for the Educare Academy CBSE Class 10 Science Online Examination:\n\n` +
    `👤 *Student Name:* ${student.name}\n` +
    `🆔 *Roll Number:* ${student.roll}\n` +
    `🔑 *Confidential Password:* ${student.password}\n` +
    `🏫 *Class:* ${student.class || 'Class 10 CBSE'}\n` +
    `📝 *Test Format:* 25 Questions (NCERT Class 10 Science)\n` +
    `⏰ *Duration:* 25 Minutes | Total Marks: 25\n\n` +
    `🌐 *Exam Portal Link:* http://${host}\n\n` +
    `⚠️ *Important Instructions:*\n` +
    `1. Use Google Chrome browser and enable webcam for AI proctoring.\n` +
    `2. Do NOT switch tabs or minimize window (3 strikes will immediately cancel your attempt).\n` +
    `3. Helpline / Teacher Contact: +91 8448467381\n\n` +
    `All the Best for your Examination! 🎯`;

  return {
    phone: waPhone,
    text: waText,
    whatsappUrl: `https://wa.me/${waPhone}?text=${encodeURIComponent(waText)}`
  };
}

function getStudentRoster() {
  try {
    if (fs.existsSync(ROSTER_FILE)) {
      return JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8') || '[]');
    }
  } catch (err) {
    console.error('Error reading students_roster.json:', err);
  }
  const pkg = getPackageConfig();
  return pkg.students || [];
}

function saveStudentRoster(roster) {
  try {
    fs.writeFileSync(ROSTER_FILE, JSON.stringify(roster, null, 2), 'utf8');
    // Also sync to package.json
    try {
      if (fs.existsSync(PACKAGE_FILE)) {
        const pkg = JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf8'));
        if (pkg.examConfig) {
          pkg.examConfig.students = roster;
          fs.writeFileSync(PACKAGE_FILE, JSON.stringify(pkg, null, 2), 'utf8');
        }
      }
    } catch (e) {}
    return true;
  } catch (err) {
    console.error('Error writing students_roster.json:', err);
    return false;
  }
}

function getCompletedStudents() {
  try {
    if (fs.existsSync(COMPLETED_FILE)) {
      const data = fs.readFileSync(COMPLETED_FILE, 'utf8');
      return JSON.parse(data || '[]');
    }
  } catch (err) {
    console.error('Error reading completed_students.json:', err);
  }
  return [];
}

function saveCompletedStudents(list) {
  try {
    fs.writeFileSync(COMPLETED_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing completed_students.json:', err);
  }
}

function normalizeRollNumber(rawRoll) {
  if (!rawRoll) return '';
  const clean = String(rawRoll).trim().toUpperCase();

  // Matches 26CBSEBRD--- (3 alphanumeric characters/digits)
  const alphanumeric = clean.replace(/[^A-Z0-9]/g, '');
  if (/^26CBSEBRD[A-Z0-9]{3}$/.test(alphanumeric)) {
    return alphanumeric;
  }

  return clean;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 2e6) { // 2MB limit
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(JSON.stringify(data));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.ogg': 'video/ogg'
};

const server = http.createServer(async (req, res) => {
  const urlParts = req.url.split('?');
  const reqPath = urlParts[0];
  const queryStr = urlParts[1] || '';

  // Enable CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-admin-key, Authorization'
    });
    res.end();
    return;
  }

  // 0a. POST /api/admin/login (Verify Admin Password)
  if (req.method === 'POST' && reqPath === '/api/admin/login') {
    try {
      const body = await readJsonBody(req);
      const pass = (body.password || '').trim();
      if (isValidAdminPassword(pass)) {
        console.log('[ADMIN AUTH] Admin successfully logged in with master key.');
        sendJson(res, 200, {
          success: true,
          message: 'Admin authenticated successfully',
          adminKey: pass
        });
      } else {
        console.warn('[ADMIN AUTH] Failed admin login attempt with incorrect password.');
        sendJson(res, 401, {
          success: false,
          error: 'INVALID_ADMIN_PASSWORD',
          message: '🚫 Incorrect Admin Master Password. Access Denied.'
        });
      }
      return;
    } catch (err) {
      sendJson(res, 400, { success: false, message: 'Invalid login request body' });
      return;
    }
  }

  // 0b. GET /api/portal-schedule (Real-time live portal status & countdown)
  if (req.method === 'GET' && reqPath === '/api/portal-schedule') {
    const schedule = getPortalSchedule();
    const evaluated = evaluatePortalStatus(schedule);
    sendJson(res, 200, {
      success: true,
      ...evaluated
    });
    return;
  }

  // 1. GET /api/exam-config
  if (req.method === 'GET' && reqPath === '/api/exam-config') {
    const config = getPackageConfig();
    const schedule = getPortalSchedule();
    const evaluated = evaluatePortalStatus(schedule);
    const activeCfg = getActiveConfig();
    const db = getQuestionsDb();

    sendJson(res, 200, {
      success: true,
      institution: 'Educare Academy',
      examName: config.examName || 'Educare Academy - CBSE Class 10th Science Daily Chapter Assessment',
      classLevel: 'Class 10 (CBSE Board)',
      subject: 'Science',
      durationMinutes: activeCfg.durationMinutes || 25,
      totalQuestions: activeCfg.questionsInTest || 25,
      poolSize: activeCfg.poolSize || 50,
      adminWhatsApp: activeCfg.adminWhatsApp || '8448467381',
      activeChapter: {
        id: activeCfg.activeChapterId,
        name: activeCfg.activeChapterName,
        hindi: activeCfg.activeChapterHindi
      },
      chapters: db.chapters || [],
      portalSchedule: evaluated
    });
    return;
  }

  // 2. GET /api/science-questions (Dynamic Daily 25 from Weekly 50 Pool)
  if (req.method === 'GET' && reqPath === '/api/science-questions') {
    const db = getQuestionsDb();
    const activeCfg = getActiveConfig();
    const params = new URLSearchParams(queryStr);
    const chapterId = parseInt(params.get('chapterId') || activeCfg.activeChapterId || 1, 10);

    const chapterMeta = (db.chapters || []).find(c => c.id === chapterId) || {
      id: chapterId,
      name: activeCfg.activeChapterName || 'Chemical Reactions and Equations',
      hindi: activeCfg.activeChapterHindi || 'रासायनिक अभिक्रियाएं एवं समीकरण'
    };

    const fullPool = (db.pools && db.pools[String(chapterId)]) || [];
    
    // Ensure today's 25 questions: exactly 5 repeating from yesterday + 20 fresh
    const todaySelection = questionManager.ensureTodayQuestions();
    const selectedIds = (activeCfg.activeChapterId === chapterId && todaySelection.selectedIds) 
      ? todaySelection.selectedIds 
      : (activeCfg.selectedQuestionIds && activeCfg.selectedQuestionIds.length === 25 ? activeCfg.selectedQuestionIds : Array.from({ length: 25 }, (_, i) => i + 1));

    let testQuestions = fullPool.filter(q => selectedIds.includes(q.id));
    if (testQuestions.length < 25) {
      testQuestions = fullPool.slice(0, 25);
    }

    const roll = params.get('roll') || '';
    const seed = params.get('seed') || roll;
    const shouldShuffle = params.get('shuffle') === 'true';

    // Jumble / Shuffle test questions per student roll or request to eliminate exam copying
    if (seed) {
      testQuestions = questionManager.shuffleQuestionsBySeed(testQuestions, seed);
    } else if (shouldShuffle) {
      testQuestions = questionManager.shuffleQuestionsBySeed(testQuestions, String(Date.now()));
    }

    sendJson(res, 200, {
      success: true,
      chapter: chapterMeta,
      date: todaySelection.date,
      poolSize: fullPool.length,
      fullPool: fullPool,
      testQuestions: testQuestions,
      repeatedCount: (todaySelection.repeatedIds || []).length,
      freshCount: (todaySelection.freshIds || []).length,
      activeTestCount: testQuestions.length,
      isShuffled: Boolean(seed || shouldShuffle)
    });
    return;
  }

  // 3. POST /api/admin/set-active-chapter
  if (req.method === 'POST' && reqPath === '/api/admin/set-active-chapter') {
    try {
      const body = await readJsonBody(req);
      if (!verifyAdminAuth(req, body, queryStr)) {
        sendJson(res, 401, { success: false, error: 'UNAUTHORIZED_ADMIN', message: '🚫 Admin Authorization Required. Please enter valid password.' });
        return;
      }
      const chapterId = parseInt(body.chapterId || 1, 10);
      const db = getQuestionsDb();
      const ch = (db.chapters || []).find(c => c.id === chapterId);
      if (!ch) {
        sendJson(res, 400, { success: false, message: 'Invalid Chapter ID' });
        return;
      }

      const pool = (db.pools && db.pools[String(chapterId)]) || [];
      const poolLen = pool.length || 50;

      // Deterministic or randomized selection of 25 questions out of 50
      let selectedIds = [];
      if (body.randomize) {
        const shuffled = [...Array(poolLen).keys()].map(i => i + 1).sort(() => Math.random() - 0.5);
        selectedIds = shuffled.slice(0, 25);
      } else {
        selectedIds = Array.from({ length: 25 }, (_, i) => i + 1);
      }

      const currentCfg = getActiveConfig();
      const updated = {
        ...currentCfg,
        activeChapterId: ch.id,
        activeChapterName: ch.name,
        activeChapterHindi: ch.hindi,
        selectedQuestionIds: selectedIds,
        lastUpdated: new Date().toISOString()
      };
      saveActiveConfig(updated);

      sendJson(res, 200, {
        success: true,
        message: `Chapter ${ch.id} (${ch.name}) set as today's active test! 25 questions selected from pool of 50.`,
        activeConfig: updated
      });
      return;
    } catch (err) {
      console.error('Error activating chapter:', err);
      sendJson(res, 500, { success: false, message: 'Server error setting chapter' });
      return;
    }
  }

  // 4. GET /api/admin/whatsapp-notice
  if (req.method === 'GET' && reqPath === '/api/admin/whatsapp-notice') {
    if (!verifyAdminAuth(req, null, queryStr)) {
      sendJson(res, 401, { success: false, error: 'UNAUTHORIZED_ADMIN', message: '🚫 Admin Authorization Required.' });
      return;
    }
    const activeCfg = getActiveConfig();
    const db = getQuestionsDb();
    const params = new URLSearchParams(queryStr);
    const chId = parseInt(params.get('chapterId') || activeCfg.activeChapterId || 1, 10);
    const ch = (db.chapters || []).find(c => c.id === chId) || {
      name: activeCfg.activeChapterName,
      hindi: activeCfg.activeChapterHindi
    };

    const targetPhone = '8448467381';
    const dateStr = new Date().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });

    const msg = `📚 *EDUCARE ACADEMY - CBSE CLASS 10TH DAILY SCIENCE TEST* 📚\n` +
      `📅 *Date:* ${dateStr}\n` +
      `📖 *Subject:* Science (Class 10 CBSE Board)\n` +
      `📑 *Active Chapter:* Chapter ${chId}: ${ch.name} (${ch.hindi})\n` +
      `📦 *Question Pool:* 50 Questions ready & verified in database\n` +
      `🎯 *Today's Test Paper:* 25 Questions selected from this 50-question pool\n` +
      `⏰ *Duration:* 25 Minutes | Total Marks: 25\n\n` +
      `📢 *Notice for Teacher / Sir:*\n` +
      `"Ye question ka set se aaj test hoga. Aaj 50 questions import ho chuke hain, students ke test me inme se 25 questions aayenge."\n\n` +
      `🔗 *Student Online Test Portal:* http://${req.headers.host || 'localhost:3050'}\n` +
      `📊 *Teacher Result Dashboard:* http://${req.headers.host || 'localhost:3050'}/admin`;

    const encodedMsg = encodeURIComponent(msg);
    const whatsappUrl = `https://api.whatsapp.com/send?phone=91${targetPhone}&text=${encodedMsg}`;

    sendJson(res, 200, {
      success: true,
      phone: targetPhone,
      messageText: msg,
      whatsappUrl: whatsappUrl
    });
    return;
  }

  // 4b. GET /api/admin/whatsapp-50-questions (Format all 50 questions & answers for WhatsApp 8448467381)
  if (req.method === 'GET' && reqPath === '/api/admin/whatsapp-50-questions') {
    if (!verifyAdminAuth(req, null, queryStr)) {
      sendJson(res, 401, { success: false, error: 'UNAUTHORIZED_ADMIN', message: '🚫 Admin Authorization Required.' });
      return;
    }
    const activeCfg = getActiveConfig();
    const db = getQuestionsDb();
    const params = new URLSearchParams(queryStr);
    const chId = parseInt(params.get('chapterId') || activeCfg.activeChapterId || 1, 10);
    const ch = (db.chapters || []).find(c => c.id === chId) || {
      name: activeCfg.activeChapterName,
      hindi: activeCfg.activeChapterHindi
    };

    const targetPhone = '8448467381';
    const pool = (db.pools && db.pools[String(chId)]) || [];
    const selectedIds = new Set(activeCfg.selectedQuestionIds || []);

    const formatQuestion = (q, idx) => {
      const isTestQ = selectedIds.has(q.id);
      const testTag = isTestQ ? '⭐ [IN TODAY\'S TEST PAPER]' : '[POOL QUESTION]';
      const keys = ['A', 'B', 'C', 'D'];
      const correctKey = keys[q.correctAnswer] || 'A';
      const correctText = q.options[q.correctAnswer]?.text || '';

      let text = `Q${idx + 1}. ${testTag}\n${q.text}\n(${q.textHindi || ''})\n`;
      q.options.forEach((opt, oIdx) => {
        text += `(${keys[oIdx]}) ${opt.text}\n`;
      });
      text += `✅ Correct Ans: (${correctKey}) ${correctText}\n`;
      if (q.explanation) {
        text += `💡 Explanation: ${q.explanation}\n`;
      }
      return text;
    };

    // Format Part 1 (Q1 - Q25)
    let part1Text = `*📚 EDUCARE ACADEMY - CBSE CLASS 10 SCIENCE (PART 1: Q1-Q25)*\n` +
      `📖 *Chapter ${chId}: ${ch.name}*\n` +
      `🎯 *Total 25 Questions in Today's Test (marked with ⭐)*\n\n`;
    pool.slice(0, 25).forEach((q, i) => {
      part1Text += `${formatQuestion(q, i)}\n-------------------\n`;
    });

    // Format Part 2 (Q26 - Q50)
    let part2Text = `*📚 EDUCARE ACADEMY - CBSE CLASS 10 SCIENCE (PART 2: Q26-Q50)*\n` +
      `📖 *Chapter ${chId}: ${ch.name}*\n` +
      `🎯 *Questions from 50-Question Bank*\n\n`;
    pool.slice(25, 50).forEach((q, i) => {
      part2Text += `${formatQuestion(q, i + 25)}\n-------------------\n`;
    });

    // Complete 50-Questions text
    let full50Text = `=================================================================\n` +
      `  EDUCARE ACADEMY - CBSE CLASS 10TH SCIENCE QUESTION BANK\n` +
      `  Chapter ${chId}: ${ch.name} (${ch.hindi})\n` +
      `  Total Pool: 50 Questions | Active Test: 25 Questions (marked with ⭐)\n` +
      `  Teacher Helpline: +91 8448467381\n` +
      `=================================================================\n\n`;
    pool.forEach((q, i) => {
      full50Text += `${formatQuestion(q, i)}\n-----------------------------------------------------------------\n`;
    });

    const urlPart1 = `https://api.whatsapp.com/send?phone=91${targetPhone}&text=${encodeURIComponent(part1Text)}`;
    const urlPart2 = `https://api.whatsapp.com/send?phone=91${targetPhone}&text=${encodeURIComponent(part2Text)}`;

    sendJson(res, 200, {
      success: true,
      phone: targetPhone,
      chapterName: ch.name,
      totalQuestions: pool.length,
      testQuestionsCount: activeCfg.selectedQuestionIds?.length || 25,
      urlPart1,
      urlPart2,
      full50Text
    });
    return;
  }

  // 4c. GET /api/admin/download-50-questions (Download 50 questions as .txt file)
  if (req.method === 'GET' && reqPath === '/api/admin/download-50-questions') {
    if (!verifyAdminAuth(req, null, queryStr)) {
      sendJson(res, 401, { success: false, error: 'UNAUTHORIZED_ADMIN', message: '🚫 Admin Authorization Required.' });
      return;
    }
    const activeCfg = getActiveConfig();
    const db = getQuestionsDb();
    const chId = activeCfg.activeChapterId || 1;
    const ch = (db.chapters || []).find(c => c.id === chId) || {
      name: activeCfg.activeChapterName,
      hindi: activeCfg.activeChapterHindi
    };

    const pool = (db.pools && db.pools[String(chId)]) || [];
    const selectedIds = new Set(activeCfg.selectedQuestionIds || []);
    const keys = ['A', 'B', 'C', 'D'];

    let fileContent = `=================================================================\n` +
      `  EDUCARE ACADEMY - CBSE CLASS 10TH SCIENCE COMPLETE QUESTION BANK\n` +
      `  Chapter ${chId}: ${ch.name} (${ch.hindi})\n` +
      `  Total 50 Questions with Answers and Explanations\n` +
      `  Today's Test Paper: 25 Questions (marked with [★ IN TODAY'S TEST])\n` +
      `  Teacher WhatsApp: +91 8448467381\n` +
      `=================================================================\n\n`;

    pool.forEach((q, idx) => {
      const isTestQ = selectedIds.has(q.id);
      fileContent += `Question ${idx + 1} of 50 ${isTestQ ? '[★ IN TODAY\'S TEST PAPER]' : ''}\n`;
      fileContent += `EN: ${q.text}\n`;
      fileContent += `HI: ${q.textHindi || ''}\n`;
      q.options.forEach((opt, oIdx) => {
        fileContent += `  (${keys[oIdx]}) ${opt.text} / ${opt.hindi || ''}\n`;
      });
      const correctKey = keys[q.correctAnswer] || 'A';
      fileContent += `\n>> Correct Answer: Option (${correctKey}) - ${q.options[q.correctAnswer]?.text}\n`;
      if (q.explanation) fileContent += `>> Explanation: ${q.explanation}\n`;
      fileContent += `-----------------------------------------------------------------\n\n`;
    });

    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="Educare_CBSE10_Science_Chapter_${chId}_50_Questions.txt"`,
      'Cache-Control': 'no-store'
    });
    res.end(fileContent);
    return;
  }

  // 4d. GET /api/admin/whatsapp-daily-questions & /api/question-paper-data (Public/Shared for Question Paper View & WhatsApp)
  if (req.method === 'GET' && (reqPath === '/api/admin/whatsapp-daily-questions' || reqPath === '/api/question-paper-data')) {
    const params = new URLSearchParams(queryStr);
    const chId = params.get('chapterId') ? parseInt(params.get('chapterId'), 10) : null;
    const result = questionManager.formatWhatsAppDailyQuestions(chId);
    sendJson(res, 200, result);
    return;
  }

  // 4d-2. GET /api/admin/download-questions-pdf (Generate & Stream Designed PDF Question Paper)
  if (req.method === 'GET' && reqPath === '/api/admin/download-questions-pdf') {
    const params = new URLSearchParams(queryStr);
    const chId = params.get('chapterId') ? parseInt(params.get('chapterId'), 10) : null;
    const result = questionManager.formatWhatsAppDailyQuestions(chId);

    const safeChName = (result.chapter?.name || 'Class10_Science').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Educare_CBSE10_Science_Ch${result.chapter?.id || 1}_${safeChName}_25Questions_${result.date}.pdf`;

    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store'
    });

    try {
      if (pdfGenerator && pdfGenerator.generateQuestionPaperPdf) {
        pdfGenerator.generateQuestionPaperPdf(result, res);
      } else {
        res.end('PDF generator not available');
      }
    } catch (pdfErr) {
      console.error('[PDF ERROR]', pdfErr);
      res.end('Error generating PDF');
    }
    return;
  }

  // 4e. POST /api/admin/scrape-questions (Live Internet NCERT Scraper for Chapter)
  if (req.method === 'POST' && reqPath === '/api/admin/scrape-questions') {
    try {
      const body = await readJsonBody(req);
      if (!verifyAdminAuth(req, body, queryStr)) {
        sendJson(res, 401, { success: false, error: 'UNAUTHORIZED_ADMIN', message: '🚫 Admin Authorization Required.' });
        return;
      }
      const chId = parseInt(body.chapterId || 1, 10);
      console.log(`[SCRAPER API] Admin requested live NCERT scrape for chapter ${chId}...`);
      const scrapeResult = await ncertScraper.scrapeQuestionsForChapter(chId);
      // Re-trigger daily question selection for refreshed pool
      questionManager.ensureTodayQuestions(true);
      sendJson(res, 200, {
        success: true,
        message: `Successfully scraped 50 verified NCERT Class 10 questions for Chapter ${chId} (${scrapeResult.chapterName}) from internet.`,
        scrapeResult
      });
      return;
    } catch (err) {
      console.error('Error in scrape-questions endpoint:', err);
      sendJson(res, 500, { success: false, message: 'Scraping engine error: ' + err.message });
      return;
    }
  }

  // 4f. POST /api/admin/clean-proctor-media (Manual trigger for proctor video/photo purge)
  if (req.method === 'POST' && reqPath === '/api/admin/clean-proctor-media') {
    try {
      const body = await readJsonBody(req);
      if (!verifyAdminAuth(req, body, queryStr)) {
        sendJson(res, 401, { success: false, error: 'UNAUTHORIZED_ADMIN', message: '🚫 Admin Authorization Required.' });
        return;
      }
      const purgeResult = cleanupProctorMedia();
      sendJson(res, 200, {
        success: true,
        message: `Proctoring media successfully cleaned. Deleted ${purgeResult.videosDeleted || 0} videos and ${purgeResult.photosDeleted || 0} photos.`,
        purgeResult
      });
      return;
    } catch (err) {
      sendJson(res, 500, { success: false, message: 'Error cleaning proctor media: ' + err.message });
      return;
    }
  }

  // 5. POST /api/verify-login (Strict Name + Roll + Password Authorization & Daily Attempt Enforcement)
  if (req.method === 'POST' && reqPath === '/api/verify-login') {
    try {
      const schedule = getPortalSchedule();
      const portalState = evaluatePortalStatus(schedule);
      if (!portalState.isOpen) {
        sendJson(res, 403, {
          success: false,
          error: 'PORTAL_CLOSED',
          portalClosed: true,
          status: portalState.status,
          deadline: portalState.deadline,
          deadlineFormatted: portalState.deadlineFormatted,
          message: portalState.status === 'EXPIRED'
            ? `🚫 Assessment Closed: The testing window for Educare Academy CBSE Class 10 expired on ${portalState.deadlineFormatted || '31 Dec 2026'}. Candidate login is closed.`
            : `🚫 Assessment Closed: Examination portal has been paused by the administration. Contact Sir at +91 8448467381.`
        });
        return;
      }

      const body = await readJsonBody(req);
      const rawName = (body.name || '').trim();
      const rawRoll = (body.roll || '').trim();
      const password = (body.password || '').trim();

      if (!rawName) {
        sendJson(res, 400, {
          success: false,
          error: 'MISSING_NAME',
          message: 'Please enter your Full Name.'
        });
        return;
      }

      if (!rawRoll) {
        sendJson(res, 400, {
          success: false,
          error: 'MISSING_ROLL',
          message: 'Please enter your assigned Roll Number.'
        });
        return;
      }

      if (!password) {
        sendJson(res, 400, {
          success: false,
          error: 'MISSING_PASSWORD',
          message: 'Please enter your confidential Exam Password.'
        });
        return;
      }

      const roster = getStudentRoster();
      const normalizedRoll = normalizeRollNumber(rawRoll);
      const config = getPackageConfig();
      const commonPwd = config.commonPassword || 'Edu@26';

      // 1. Check if Roll Number exists in authorized roster (managed by Admin)
      const student = roster.find(s => s.roll === normalizedRoll);
      if (!student) {
        sendJson(res, 401, {
          success: false,
          error: 'UNAUTHORIZED_ROLL',
          message: `🚫 Unauthorized Roll Number (${rawRoll}): This roll number is not registered in the Educare Academy roster. Only authorized students can participate.`
        });
        return;
      }

      // Check name match against roster:
      const rosterName = (student.name || '').trim();
      const isGenericRosterName = /^Student\s*#\d+$/i.test(rosterName) || /^Editable\s*Slot$/i.test(rosterName) || !rosterName;

      let verifiedName = rawName;
      if (!isGenericRosterName) {
        const c1 = rawName.toLowerCase().replace(/\s+/g, ' ');
        const c2 = rosterName.toLowerCase().replace(/\s+/g, ' ');
        if (c1 !== c2) {
          sendJson(res, 401, {
            success: false,
            error: 'NAME_MISMATCH',
            message: `🚫 Name mismatch: Roll Number ${rawRoll} is officially assigned to "${student.name}". Please enter your correct name as registered.`
          });
          return;
        }
        verifiedName = student.name;
      } else {
        student.name = rawName;
        saveStudentRoster(roster);
        verifiedName = rawName;
      }

      const studentName = verifiedName;

      // 3. UNIFORM PASSWORD VERIFICATION: Edu@26
      if (password !== 'Edu@26' && password !== student.password && password !== commonPwd) {
        sendJson(res, 401, {
          success: false,
          error: 'INVALID_PASSWORD',
          message: '🚫 Incorrect Password! Please enter your valid Exam Password.'
        });
        return;
      }

      // 4. STRICT DAILY ATTEMPT ENFORCEMENT & TAB-SWITCH CANCELLATION LOCK
      const completedList = getCompletedStudents();
      const existingAttempt = completedList.find(s => s.roll === normalizedRoll);
      if (existingAttempt) {
        if (existingAttempt.completionType === 'ATTEMPT_CANCELLED_TAB_SWITCH' || existingAttempt.status === 'ATTEMPT_CANCELLED_TAB_SWITCH') {
          sendJson(res, 403, {
            success: false,
            error: 'ATTEMPT_CANCELLED_TAB_SWITCH',
            tabSwitchCancelled: true,
            message: '🚫 tab switch hone ki wajah se tumhara attempt cancle kar diya gaya hai apne teacher ko contact karo fir se exam dene ke liye'
          });
          return;
        }

        sendJson(res, 403, {
          success: false,
          error: 'DAILY_ATTEMPT_EXHAUSTED',
          alreadyCompleted: true,
          completedAt: existingAttempt.completedAt,
          score: existingAttempt.score,
          total: existingAttempt.total || 25,
          message: `🚫 Daily Attempt Limit Reached: ${student.name} (${student.roll}) has already submitted today's assessment. Dobara exam dene ke liye apne teacher (+91 8448467381) se attempt reset karwayen.`
        });
        return;
      }

      // All checks passed!
      sendJson(res, 200, {
        success: true,
        normalizedRoll: normalizedRoll,
        studentSerial: student.serial || 1,
        studentName: student.name || rawName,
        message: 'प्रवेश सत्यापित (Student Authorized Successfully)'
      });
      return;
    } catch (err) {
      console.error('Login verification error:', err);
      sendJson(res, 500, { success: false, message: 'Server verification error' });
      return;
    }
  }

  // 6. POST /api/exam-activity
  if (req.method === 'POST' && reqPath === '/api/exam-activity') {
    try {
      const body = await readJsonBody(req);
      const rawRoll = (body.roll || body.rollNumber || '').trim();
      const roll = normalizeRollNumber(rawRoll);
      const name = (body.name || '').trim();
      const type = (body.type || body.action || 'HEARTBEAT').toUpperCase();

      if (!roll) {
        sendJson(res, 400, { success: false, message: 'Roll is required' });
        return;
      }

      let session = activeExamSessions.get(roll);
      if (!session || type === 'START') {
        session = {
          roll: roll,
          name: name,
          startTime: Date.now(),
          lastActivity: Date.now(),
          violationsCount: 0,
          violations: [],
          status: 'IN_PROGRESS'
        };
        activeExamSessions.set(roll, session);
      }

      session.lastActivity = Date.now();
      if (name) session.name = name;

      if (body.photoUrl) {
        let pUrl = body.photoUrl;
        if (pUrl.startsWith('data:image/')) {
          try {
            const matches = pUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
              const imgBuffer = Buffer.from(matches[2], 'base64');
              const photoName = `${roll}_photo.jpg`;
              fs.writeFileSync(path.join(PHOTOS_DIR, photoName), imgBuffer);
              pUrl = `/records/photos/${photoName}`;
            }
          } catch (e) {}
        }
        session.photoUrl = pUrl;
      }

      if (type === 'VIOLATION') {
        session.violationsCount = body.violationsCount || (session.violationsCount + 1);
        const violationEntry = {
          strike: body.strike || session.violationsCount,
          reason: body.reason || 'Tab switch detected',
          time: body.time || new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }),
          timestamp: body.timestamp || Date.now()
        };
        session.violations.push(violationEntry);
      }

      sendJson(res, 200, { success: true, session });
      return;
    } catch (err) {
      console.error('Error logging exam activity:', err);
      sendJson(res, 500, { success: false, message: 'Server activity error' });
      return;
    }
  }

  // 7. POST /api/complete-exam
  if (req.method === 'POST' && reqPath === '/api/complete-exam') {
    try {
      const schedule = getPortalSchedule();
      const portalState = evaluatePortalStatus(schedule);
      if (!portalState.isOpen) {
        sendJson(res, 403, {
          success: false,
          error: 'PORTAL_CLOSED',
          message: '🚫 Submission Rejected: Examination portal deadline has expired.'
        });
        return;
      }

      const body = await readJsonBody(req);
      const roll = normalizeRollNumber(body.roll);
      const name = (body.name || '').trim();
      const score = body.score ?? 0;
      const total = body.total ?? 25;
      const percentage = body.percentage ?? ((score / total) * 100).toFixed(1);
      const status = body.status || 'SUBMITTED';

      if (!roll) {
        sendJson(res, 400, { success: false, message: 'Roll number is required' });
        return;
      }

      const active = activeExamSessions.get(roll);
      activeExamSessions.delete(roll);

      const activeCfg = getActiveConfig();
      const completedList = getCompletedStudents();
      const existsIndex = completedList.findIndex(s => s.roll === roll);

      let photoUrl = body.photoUrl || (active ? active.photoUrl : '') || (existsIndex >= 0 ? completedList[existsIndex].photoUrl : '') || '';
      if (photoUrl && photoUrl.startsWith('data:image/')) {
        try {
          const matches = photoUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            const imgBuffer = Buffer.from(matches[2], 'base64');
            const photoName = `${roll}_photo.jpg`;
            fs.writeFileSync(path.join(PHOTOS_DIR, photoName), imgBuffer);
            photoUrl = `/records/photos/${photoName}`;
          }
        } catch (err) {
          console.warn('Error saving photo buffer:', err);
        }
      }

      const existingRec = existsIndex >= 0 ? completedList[existsIndex] : null;
      const videoUrl = body.videoUrl || (existingRec ? existingRec.videoUrl : '') || '';
      const videoSize = body.videoSize || (existingRec ? existingRec.videoSize : 0) || 0;

      // Student name is strictly taken from the admin-assigned roster
      const roster = getStudentRoster();
      const studentInRoster = roster.find(s => s.roll === roll);
      const studentName = (studentInRoster && studentInRoster.name) ? studentInRoster.name : (name || (active ? active.name : '') || 'Student');

      const record = {
        roll: roll,
        name: studentName,
        photoUrl: photoUrl,
        videoUrl: videoUrl,
        videoSize: videoSize,
        chapterId: body.chapterId || activeCfg.activeChapterId,
        chapterName: body.chapterName || activeCfg.activeChapterName,
        chapterHindi: body.chapterHindi || activeCfg.activeChapterHindi,
        score: score,
        total: total,
        percentage: percentage,
        correctCount: body.correctCount ?? score,
        incorrectCount: body.incorrectCount ?? (total - score),
        skippedCount: body.skippedCount ?? 0,
        status: status,
        completionType: body.completionType || 'COMPLETED',
        timeSpentSeconds: body.timeSpentSeconds || 0,
        timeSpentFormatted: body.timeSpentFormatted || '',
        violationsCount: body.violationsCount || 0,
        violations: body.violations || [],
        solutions: body.solutions || [],
        completedAt: body.completedAt || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        timestamp: Date.now()
      };

      if (existsIndex >= 0) {
        completedList[existsIndex] = record;
      } else {
        completedList.unshift(record);
      }

      saveCompletedStudents(completedList);
      console.log(`[EXAM SUBMITTED] ${roll} | ${name} | Score: ${score}/${total} (${percentage}%) | Photo: ${photoUrl ? 'YES' : 'NO'} | Chapter: ${record.chapterName}`);

      // Async sync to Oracle DB if configured
      if (oracleDb) {
        try {
          let photoBuf = null;
          let videoBuf = null;
          if (photoUrl && photoUrl.startsWith('/records/photos/')) {
            const pPath = path.join(__dirname, photoUrl);
            if (fs.existsSync(pPath)) photoBuf = fs.readFileSync(pPath);
          }
          if (videoUrl && videoUrl.startsWith('/records/videos/')) {
            const vPath = path.join(__dirname, videoUrl);
            if (fs.existsSync(vPath)) videoBuf = fs.readFileSync(vPath);
          }
          oracleDb.saveRecordToOracle({ record, photoBuffer: photoBuf, videoBuffer: videoBuf }).catch(e => {
            console.log('[ORACLE DB NOTICE]', e.message || e);
          });
        } catch (e) {}
      }

      sendJson(res, 200, {
        success: true,
        message: 'Scorecard permanently recorded in Educare Academy ledger.',
        record: record
      });
      return;
    } catch (err) {
      console.error('Error completing exam:', err);
      sendJson(res, 500, { success: false, message: 'Server error saving submission' });
      return;
    }
  }

  // 7b. POST /api/upload-proctor-video (Compressed Video Stream Upload)
  if (req.method === 'POST' && reqPath === '/api/upload-proctor-video') {
    const params = new URLSearchParams(queryStr);
    const rawRoll = (params.get('roll') || '').trim();
    const roll = normalizeRollNumber(rawRoll);

    if (!roll) {
      sendJson(res, 400, { success: false, message: 'Roll number is required for video upload' });
      return;
    }

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        if (buffer.length === 0) {
          sendJson(res, 400, { success: false, message: 'Empty video payload received' });
          return;
        }

        const filename = `${roll}_${Date.now()}.webm`;
        const filePath = path.join(VIDEOS_DIR, filename);
        fs.writeFileSync(filePath, buffer);
        const videoUrl = `/records/videos/${filename}`;

        // Link with completed student record
        const completedList = getCompletedStudents();
        const recIndex = completedList.findIndex(s => s.roll === roll);
        let studentRec = null;
        if (recIndex >= 0) {
          completedList[recIndex].videoUrl = videoUrl;
          completedList[recIndex].videoSize = buffer.length;
          studentRec = completedList[recIndex];
          saveCompletedStudents(completedList);
        }

        console.log(`[PROCTOR VIDEO SAVED] Roll: ${roll} | File: ${filename} | Size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

        // Async sync video BLOB to Oracle DB
        if (oracleDb && studentRec) {
          try {
            let photoBuf = null;
            if (studentRec.photoUrl && studentRec.photoUrl.startsWith('/records/photos/')) {
              const pPath = path.join(__dirname, studentRec.photoUrl);
              if (fs.existsSync(pPath)) photoBuf = fs.readFileSync(pPath);
            }
            oracleDb.saveRecordToOracle({ record: studentRec, photoBuffer: photoBuf, videoBuffer: buffer }).catch(e => {});
          } catch (e) {}
        }

        sendJson(res, 200, {
          success: true,
          message: 'Compressed proctoring video successfully uploaded & saved.',
          videoUrl: videoUrl,
          sizeBytes: buffer.length
        });
      } catch (err) {
        console.error('Error saving proctoring video:', err);
        sendJson(res, 500, { success: false, message: 'Server error saving proctoring video' });
      }
    });
    return;
  }

  // 7c. GET /api/oracle/status
  if (req.method === 'GET' && reqPath === '/api/oracle/status') {
    if (oracleDb) {
      sendJson(res, 200, { success: true, ...oracleDb.getOracleStatus() });
    } else {
      sendJson(res, 200, { success: false, message: 'Oracle DB module not loaded' });
    }
    return;
  }

  // 7d. POST /api/oracle/sync-student
  if (req.method === 'POST' && reqPath === '/api/oracle/sync-student') {
    if (!verifyAdminAuth(req, null, queryStr)) {
      sendJson(res, 401, { success: false, error: 'UNAUTHORIZED_ADMIN', message: '🚫 Admin Authorization Required.' });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const roll = normalizeRollNumber(body.roll || '');
      const completedList = getCompletedStudents();
      const rec = completedList.find(s => s.roll === roll);
      if (!rec) {
        sendJson(res, 404, { success: false, message: 'Student record not found for roll ' + roll });
        return;
      }
      if (!oracleDb) {
        sendJson(res, 500, { success: false, message: 'Oracle DB driver not loaded' });
        return;
      }

      let photoBuf = null;
      let videoBuf = null;
      if (rec.photoUrl && fs.existsSync(path.join(__dirname, rec.photoUrl))) {
        photoBuf = fs.readFileSync(path.join(__dirname, rec.photoUrl));
      }
      if (rec.videoUrl && fs.existsSync(path.join(__dirname, rec.videoUrl))) {
        videoBuf = fs.readFileSync(path.join(__dirname, rec.videoUrl));
      }

      const syncRes = await oracleDb.saveRecordToOracle({ record: rec, photoBuffer: photoBuf, videoBuffer: videoBuf });
      sendJson(res, 200, syncRes);
      return;
    } catch (e) {
      sendJson(res, 500, { success: false, error: e.message });
      return;
    }
  }

  // 7e. GET /api/oracle/video (Stream video from Oracle DB BLOB)
  if (req.method === 'GET' && reqPath === '/api/oracle/video') {
    const params = new URLSearchParams(queryStr);
    const roll = normalizeRollNumber(params.get('roll') || '');
    if (!roll) {
      sendJson(res, 400, { success: false, message: 'Roll number required' });
      return;
    }
    if (oracleDb) {
      await oracleDb.streamVideoFromOracle(roll, req, res);
    } else {
      sendJson(res, 500, { success: false, message: 'Oracle DB module not available' });
    }
    return;
  }

  // 8. GET /api/completed-students
  if (req.method === 'GET' && reqPath === '/api/completed-students') {
    const list = getCompletedStudents();
    sendJson(res, 200, {
      success: true,
      total: list.length,
      records: list
    });
    return;
  }

  // 9. POST /api/clear-completed-students
  if (req.method === 'POST' && reqPath === '/api/clear-completed-students') {
    if (!verifyAdminAuth(req, null, queryStr)) {
      sendJson(res, 401, { success: false, error: 'UNAUTHORIZED_ADMIN', message: '🚫 Admin Authorization Required.' });
      return;
    }
    saveCompletedStudents([]);
    console.log('[RECORDS CLEARED] Admin cleared all student test records.');
    sendJson(res, 200, {
      success: true,
      message: 'All completed student test records have been reset.'
    });
    return;
  }

  // 10. GET /api/admin/all-students
  if (req.method === 'GET' && reqPath === '/api/admin/all-students') {
    if (!verifyAdminAuth(req, null, queryStr)) {
      sendJson(res, 401, { success: false, error: 'UNAUTHORIZED_ADMIN', message: '🚫 Admin Authorization Required.' });
      return;
    }
    const allStudents = getStudentRoster();
    const completedList = getCompletedStudents();

    const completedMap = new Map();
    completedList.forEach(c => {
      completedMap.set(c.roll, c);
    });

    let completedCount = 0;
    let inProgressCount = 0;
    let qualifiedCount = 0;
    let needsRevisionCount = 0;

    const now = Date.now();
    const studentRows = allStudents.map(s => {
      const rec = completedMap.get(s.roll);
      const active = activeExamSessions.get(s.roll);
      const isActiveNow = active && (now - active.lastActivity < 30 * 60 * 1000);

      if (rec) {
        completedCount++;
        const isPass = rec.score >= 20; // 80% passing cutoff (20/25 marks) for Class 10
        if (isPass) qualifiedCount++;
        else needsRevisionCount++;

        return {
          serial: s.serial,
          name: rec.name || `Student #${s.serial}`,
          roll: s.roll,
          password: s.password,
          photoUrl: rec.photoUrl || '',
          videoUrl: rec.videoUrl || '',
          videoSize: rec.videoSize || 0,
          attempted: true,
          isInProgress: false,
          chapterName: rec.chapterName || 'Class 10 Science',
          score: rec.score,
          total: rec.total || 25,
          percentage: rec.percentage || Math.round((rec.score / (rec.total || 25)) * 100),
          correctCount: rec.correctCount ?? rec.score,
          incorrectCount: rec.incorrectCount ?? ((rec.total || 25) - rec.score),
          status: rec.status || (isPass ? 'Passed' : 'Needs Revision'),
          completionType: rec.completionType || 'COMPLETED',
          timeSpentFormatted: rec.timeSpentFormatted || '',
          violationsCount: rec.violationsCount || (rec.violations ? rec.violations.length : 0),
          violations: rec.violations || [],
          solutions: rec.solutions || [],
          completedAt: rec.completedAt || '-',
          timestamp: rec.timestamp || 0
        };
      } else if (isActiveNow) {
        inProgressCount++;
        return {
          serial: s.serial,
          name: active.name || `Student #${s.serial}`,
          roll: s.roll,
          password: s.password,
          photoUrl: active.photoUrl || '',
          videoUrl: '',
          videoSize: 0,
          attempted: false,
          isInProgress: true,
          chapterName: 'Class 10 Science',
          score: null,
          total: 25,
          percentage: null,
          status: 'In Progress',
          timeSpentFormatted: 'Taking Exam Now',
          violationsCount: active.violationsCount || 0,
          violations: active.violations || [],
          solutions: [],
          completedAt: 'Active (' + new Date(active.startTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) + ')',
          timestamp: active.lastActivity
        };
      }

      return {
        serial: s.serial,
        name: s.name || `Student #${s.serial}`,
        roll: s.roll,
        password: s.password,
        photoUrl: '',
        videoUrl: '',
        videoSize: 0,
        attempted: false,
        isInProgress: false,
        chapterName: '-',
        score: null,
        total: 25,
        percentage: null,
        status: 'Pending',
        timeSpentFormatted: '-',
        violationsCount: 0,
        violations: [],
        solutions: [],
        completedAt: '-',
        timestamp: 0
      };
    });

    // Also include external students who participated and aren't in standard 500
    completedList.forEach(rec => {
      if (!allStudents.some(s => s.roll === rec.roll)) {
        completedCount++;
        const isPass = rec.score >= 20; // 80% passing cutoff (20/25 marks)
        if (isPass) qualifiedCount++;
        else needsRevisionCount++;

        studentRows.unshift({
          serial: 0,
          name: rec.name || rec.roll,
          roll: rec.roll,
          password: 'Guest',
          attempted: true,
          isInProgress: false,
          chapterName: rec.chapterName || 'Class 10 Science',
          score: rec.score,
          total: rec.total || 25,
          percentage: rec.percentage,
          correctCount: rec.correctCount ?? rec.score,
          incorrectCount: rec.incorrectCount ?? ((rec.total || 25) - rec.score),
          status: rec.status || (isPass ? 'Passed' : 'Needs Revision'),
          completionType: rec.completionType || 'COMPLETED',
          timeSpentFormatted: rec.timeSpentFormatted || '',
          solutions: rec.solutions || [],
          completedAt: rec.completedAt || '-',
          timestamp: rec.timestamp || 0
        });
      }
    });

    sendJson(res, 200, {
      success: true,
      stats: {
        totalConfigured: allStudents.length,
        completedCount,
        inProgressCount,
        qualifiedCount,
        needsRevisionCount
      },
      students: studentRows
    });
    return;
  }


  // 10a. GET /api/admin/student-report (Get detailed solutions and report for student)
  if (req.method === 'GET' && reqPath === '/api/admin/student-report') {
    if (!verifyAdminAuth(req, null, queryStr)) {
      sendJson(res, 401, { success: false, error: 'UNAUTHORIZED_ADMIN', message: '🚫 Admin Authorization Required.' });
      return;
    }
    const params = new URLSearchParams(queryStr);
    const roll = normalizeRollNumber(params.get('roll') || '');
    const completedList = getCompletedStudents();
    const rec = completedList.find(s => s.roll === roll);
    if (rec) {
      sendJson(res, 200, { success: true, report: rec });
    } else {
      sendJson(res, 404, { success: false, message: 'Student report record not found.' });
    }
    return;
  }

  // 10b. GET /api/admin/roster or /api/student-roster
  if (req.method === 'GET' && (reqPath === '/api/admin/roster' || reqPath === '/api/student-roster' || reqPath === '/api/admin/students')) {
    if (!verifyAdminAuth(req, null, queryStr)) {
      sendJson(res, 401, { success: false, error: 'UNAUTHORIZED_ADMIN', message: '🚫 Admin Authorization Required.' });
      return;
    }
    const roster = getStudentRoster();
    const completedList = getCompletedStudents();
    const completedMap = new Map();
    completedList.forEach(c => completedMap.set(c.roll, c));

    const rows = roster.map(s => {
      const rec = completedMap.get(s.roll);
      return {
        ...s,
        attempted: !!rec,
        photoUrl: rec ? (rec.photoUrl || '') : '',
        videoUrl: rec ? (rec.videoUrl || '') : '',
        score: rec ? rec.score : null,
        total: rec ? rec.total || 25 : 25,
        percentage: rec ? rec.percentage : null,
        completedAt: rec ? rec.completedAt : '-'
      };
    });

    sendJson(res, 200, {
      success: true,
      total: roster.length,
      roster: rows
    });
    return;
  }

  // 10c. POST /api/admin/update-student (Edit student name, roll, password)
  if (req.method === 'POST' && reqPath === '/api/admin/update-student') {
    try {
      const body = await readJsonBody(req);
      if (!verifyAdminAuth(req, body, queryStr)) {
        sendJson(res, 401, { success: false, error: 'UNAUTHORIZED_ADMIN', message: '🚫 Admin Authorization Required.' });
        return;
      }
      const roll = normalizeRollNumber(body.originalRoll || body.roll);
      const name = (body.name || '').trim();

      if (!name || !roll) {
        sendJson(res, 400, { success: false, message: 'Student Name and Roll Number are required.' });
        return;
      }

      const roster = getStudentRoster();
      const idx = roster.findIndex(s => s.roll === roll);

      if (idx >= 0) {
        // Edit student credentials (name, class, phone, status)
        // STRICT POLICY: Roll Number and Password cannot be changed once assigned
        roster[idx].name = name;
        if (body.class) roster[idx].class = body.class;
        if (body.phone) roster[idx].phone = body.phone;
        if (body.status) roster[idx].status = body.status;
        saveStudentRoster(roster);
        console.log(`[STUDENT UPDATED] Slot #${roster[idx].serial}: ${name} (${roll}) | Roll & Password remain locked.`);
        sendJson(res, 200, {
          success: true,
          message: `Student "${name}" details updated successfully. (Roll Number & Password remain securely locked by policy).`,
          student: roster[idx]
        });
      } else {
        sendJson(res, 404, { success: false, message: `Student with roll ${roll} not found in 500-student roster.` });
      }
      return;
    } catch (err) {
      console.error('Error updating student:', err);
      sendJson(res, 500, { success: false, message: 'Server error updating student.' });
      return;
    }
  }

  // 10d. POST /api/admin/add-student (Admin adds new student with unguessable credentials & WhatsApp dispatch)
  if (req.method === 'POST' && reqPath === '/api/admin/add-student') {
    try {
      const body = await readJsonBody(req);
      if (!verifyAdminAuth(req, body, queryStr)) {
        sendJson(res, 401, { success: false, error: 'UNAUTHORIZED_ADMIN', message: '🚫 Admin Authorization Required.' });
        return;
      }
      const name = (body.name || '').trim();
      if (!name) {
        sendJson(res, 400, { success: false, message: 'Student Full Name is required.' });
        return;
      }

      const roster = getStudentRoster();
      const existingRolls = new Set(roster.map(s => s.roll));

      let roll = body.roll ? normalizeRollNumber(body.roll) : '';
      if (!roll) {
        do {
          roll = `26CBSEBRD${generateUnguessableCode(3)}`;
        } while (existingRolls.has(roll));
      } else if (existingRolls.has(roll)) {
        sendJson(res, 400, { success: false, message: `Roll Number "${roll}" already exists in roster.` });
        return;
      }

      const password = (body.password || '').trim() || 'Edu@26';
      const studentClass = (body.class || 'Class 10 CBSE').trim();
      const phone = (body.phone || '').trim();

      const newStudent = {
        serial: roster.length + 1,
        name: name,
        roll: roll,
        password: password,
        class: studentClass,
        status: 'ACTIVE',
        phone: phone,
        createdAt: new Date().toISOString()
      };

      roster.push(newStudent);
      saveStudentRoster(roster);

      // Append to CSV & MD if files exist
      try {
        const csvPath = path.join(__dirname, 'STUDENT_CREDENTIALS_LIST.csv');
        if (fs.existsSync(csvPath)) {
          fs.appendFileSync(csvPath, `\n${newStudent.serial},"${newStudent.name}","${newStudent.roll}","${newStudent.password}","${newStudent.class}","ACTIVE","${newStudent.phone}"`);
        }
        const mdPath = path.join(__dirname, 'STUDENT_CREDENTIALS_LIST.md');
        if (fs.existsSync(mdPath)) {
          fs.appendFileSync(mdPath, `\n| ${newStudent.serial} | ${newStudent.name} | \`${newStudent.roll}\` | \`${newStudent.password}\` | ${newStudent.class} | ACTIVE |`);
        }
      } catch (e) {
        console.warn('Could not append to CSV/MD:', e.message);
      }

      const host = req.headers.host || 'localhost:3050';
      const waDetails = formatStudentCredentialsWhatsApp(newStudent, host);

      console.log(`[STUDENT ENROLLED] #${newStudent.serial}: ${newStudent.name} (${newStudent.roll})`);

      sendJson(res, 200, {
        success: true,
        message: `Student "${name}" successfully enrolled with Roll: ${roll}!`,
        student: newStudent,
        whatsappUrl: waDetails.whatsappUrl,
        whatsappText: waDetails.text,
        totalEnrolled: roster.length
      });
      return;
    } catch (err) {
      console.error('Error adding student:', err);
      sendJson(res, 500, { success: false, message: 'Error enrolling student: ' + err.message });
      return;
    }
  }

  // 10d-2. GET /api/admin/whatsapp-student-credentials (Format Credentials for WhatsApp Share)
  if (req.method === 'GET' && reqPath === '/api/admin/whatsapp-student-credentials') {
    if (!verifyAdminAuth(req, null, queryStr)) {
      sendJson(res, 401, { success: false, error: 'UNAUTHORIZED_ADMIN', message: '🚫 Admin Authorization Required.' });
      return;
    }
    const params = new URLSearchParams(queryStr);
    const roll = normalizeRollNumber(params.get('roll') || '');
    const roster = getStudentRoster();
    const student = roster.find(s => s.roll === roll);
    if (!student) {
      sendJson(res, 404, { success: false, message: `Student with roll ${roll} not found.` });
      return;
    }

    const host = req.headers.host || 'localhost:3050';
    const waDetails = formatStudentCredentialsWhatsApp(student, host);

    sendJson(res, 200, {
      success: true,
      student,
      whatsappUrl: waDetails.whatsappUrl,
      whatsappText: waDetails.text
    });
    return;
  }

  // 10e. POST /api/admin/delete-student (Admin can remove a student from roster)
  if (req.method === 'POST' && reqPath === '/api/admin/delete-student') {
    try {
      const body = await readJsonBody(req);
      if (!verifyAdminAuth(req, body, queryStr)) {
        sendJson(res, 401, { success: false, error: 'UNAUTHORIZED_ADMIN', message: '🚫 Admin Authorization Required.' });
        return;
      }
      const roll = normalizeRollNumber(body.roll);
      if (!roll) {
        sendJson(res, 400, { success: false, message: 'Roll Number is required.' });
        return;
      }
      let roster = getStudentRoster();
      const initialLen = roster.length;
      roster = roster.filter(s => s.roll !== roll);
      if (roster.length === initialLen) {
        sendJson(res, 404, { success: false, message: `Student with roll ${roll} not found.` });
        return;
      }
      // Re-number serials
      roster.forEach((s, idx) => { s.serial = idx + 1; });
      saveStudentRoster(roster);
      console.log(`[STUDENT DELETED] Roll: ${roll} removed from roster by admin`);
      sendJson(res, 200, { success: true, message: `Student ${roll} removed successfully!` });
      return;
    } catch (err) {
      sendJson(res, 500, { success: false, message: 'Error deleting student.' });
      return;
    }
  }

  // 11. POST /api/admin/reset-student
  if (req.method === 'POST' && reqPath === '/api/admin/reset-student') {
    try {
      const body = await readJsonBody(req);
      if (!verifyAdminAuth(req, body, queryStr)) {
        sendJson(res, 401, { success: false, error: 'UNAUTHORIZED_ADMIN', message: '🚫 Admin Authorization Required.' });
        return;
      }
      const rollToReset = normalizeRollNumber((body.roll || '').trim());
      if (!rollToReset) {
        sendJson(res, 400, { success: false, message: 'Roll number is required to reset' });
        return;
      }
      activeExamSessions.delete(rollToReset);
      let completedList = getCompletedStudents();
      const initialLen = completedList.length;
      completedList = completedList.filter(s => s.roll !== rollToReset);
      saveCompletedStudents(completedList);
      console.log(`[STUDENT RESET] Test record reset for roll: ${rollToReset}`);
      sendJson(res, 200, {
        success: true,
        message: `Attempt record for ${rollToReset} reset successfully. Student can re-attempt.`,
        deleted: initialLen > completedList.length
      });
      return;
    } catch (err) {
      sendJson(res, 500, { success: false, message: 'Error resetting student record' });
      return;
    }
  }

  // 12. POST /api/admin/portal-schedule or /api/admin/update-schedule
  if (req.method === 'POST' && (reqPath === '/api/admin/portal-schedule' || reqPath === '/api/admin/update-schedule')) {
    try {
      const body = await readJsonBody(req);
      if (!verifyAdminAuth(req, body, queryStr)) {
        sendJson(res, 401, { success: false, error: 'UNAUTHORIZED_ADMIN', message: '🚫 Admin Authorization Required.' });
        return;
      }
      const current = getPortalSchedule();

      let newDeadline = current.deadline;
      let newFormatted = current.deadlineFormatted;
      if (body.deadline) {
        const parsedDate = new Date(body.deadline);
        if (!isNaN(parsedDate.getTime())) {
          newDeadline = parsedDate.toISOString();
          newFormatted = parsedDate.toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
          }) + ' IST';
        }
      }

      const updatedSchedule = {
        portalOpen: typeof body.portalOpen === 'boolean' ? body.portalOpen : current.portalOpen,
        deadline: newDeadline,
        deadlineFormatted: newFormatted,
        timezone: 'Asia/Kolkata',
        closedMessage: (body.closedMessage || current.closedMessage || '').trim(),
        closedMessageHindi: (body.closedMessageHindi || current.closedMessageHindi || '').trim(),
        updatedAt: new Date().toISOString(),
        updatedBy: body.updatedBy || 'Educare Academy Administrator'
      };

      savePortalSchedule(updatedSchedule);
      const evaluated = evaluatePortalStatus(updatedSchedule);

      sendJson(res, 200, {
        success: true,
        message: 'Portal schedule updated successfully.',
        schedule: evaluated
      });
      return;
    } catch (err) {
      sendJson(res, 500, { success: false, message: 'Server error updating portal schedule' });
      return;
    }
  }

  // -----------------------------------------------------------
  // STATIC FILE SERVING
  // -----------------------------------------------------------
  let serveFile = reqPath;
  if (serveFile === '/' || serveFile === '') {
    serveFile = '/index.html';
  } else if (serveFile === '/admin' || serveFile === '/admin/') {
    serveFile = '/admin.html';
  } else if (serveFile === '/question-paper' || serveFile === '/question-paper/') {
    serveFile = '/question-paper.html';
  }
  const filePath = path.join(PUBLIC_DIR, serveFile);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Support HTTP Range Requests for HTML5 Video Streaming & Seeking
    if (ext === '.webm' || ext === '.mp4') {
      const range = req.headers.range;
      const total = stats.size;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const partialstart = parts[0];
        const partialend = parts[1];
        const start = parseInt(partialstart, 10);
        const end = partialend ? parseInt(partialend, 10) : total - 1;
        const chunksize = (end - start) + 1;

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType,
          'Cache-Control': 'no-cache'
        });
        const stream = fs.createReadStream(filePath, { start, end });
        stream.pipe(res);
        return;
      } else {
        res.writeHead(200, {
          'Content-Length': total,
          'Accept-Ranges': 'bytes',
          'Content-Type': contentType,
          'Cache-Control': 'no-cache'
        });
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
        return;
      }
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });

    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
  });
});

let currentPort = PORT;

function startServer(port) {
  currentPort = port;
  server.listen(port, () => {
    console.log('================================================================');
    console.log('  EDUCARE ACADEMY - CBSE CLASS 10TH SCIENCE TEST SERVER');
    console.log(`  Live Server running on: http://localhost:${port}`);
    console.log('  500 Student Roll Numbers Configured (EDU-10-001 to EDU-10-500)');
    console.log('  WhatsApp Integration Ready for Teacher Helpline: 8448467381');
    console.log('  25 Questions Loaded from 50 Questions Chapter Pool');
    console.log('================================================================');
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const nextPort = currentPort === 3000 ? 3050 : currentPort + 1;
    console.log(`Port ${currentPort} in use, trying port ${nextPort}...`);
    startServer(nextPort);
  } else {
    console.error('Server error:', err);
  }
});

startServer(PORT);
