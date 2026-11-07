// Educare Academy - CBSE Class 10th Science Assessment Server
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3050;
const PUBLIC_DIR = __dirname;
const IS_VERCEL = !!(process.env.VERCEL || process.env.NOW_REGION);
const DATA_DIR = IS_VERCEL ? '/tmp' : __dirname;

const COMPLETED_FILE = path.join(DATA_DIR, 'completed_students.json');
const PACKAGE_FILE = path.join(__dirname, 'package.json');
const SCHEDULE_FILE = path.join(DATA_DIR, 'portal_schedule.json');
const QUESTIONS_FILE = path.join(__dirname, 'cbse10_questions.json');
const ACTIVE_CONFIG_FILE = path.join(DATA_DIR, 'active_test_config.json');
const ROSTER_FILE = path.join(DATA_DIR, 'students_roster.json');

// In-memory runtime caches to guarantee seamless execution in serverless read-only environments
let inMemoryRoster = null;
let inMemoryCompletedStudents = null;
let inMemorySchedule = null;
let inMemoryActiveConfig = null;

// Ensure completed_students.json exists
try {
  if (!fs.existsSync(COMPLETED_FILE)) {
    fs.writeFileSync(COMPLETED_FILE, JSON.stringify([], null, 2), 'utf8');
  }
} catch (e) {}

// Media Records directories for Candidate Verification Photos and Compressed Proctoring Videos
const RECORDS_DIR = path.join(DATA_DIR, 'records');
const PHOTOS_DIR = path.join(RECORDS_DIR, 'photos');
const VIDEOS_DIR = path.join(RECORDS_DIR, 'videos');
try {
  if (!fs.existsSync(RECORDS_DIR)) fs.mkdirSync(RECORDS_DIR, { recursive: true });
  if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });
} catch (e) {}

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

// In-memory real-time active exam sessions map
const activeExamSessions = new Map();

// Helper: Convert epoch ms to Indian Standard Time (IST) date string YYYY-MM-DD
function getIstDateParts(epochMs) {
  try {
    return new Date(epochMs).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  } catch (e) {
    const istMs = epochMs + (5.5 * 60 * 60 * 1000);
    const d = new Date(istMs);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

// Helper: Given an exam completion timestamp, compute the 1:00 AM IST cutoff of the NEXT day
function getExamExpirationCutoffMs(examTimestampMs) {
  const examDateStr = getIstDateParts(examTimestampMs); // e.g. "2026-11-08"
  const [year, month, day] = examDateStr.split('-').map(Number);
  
  // Calculate next day date
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  d.setUTCDate(d.getUTCDate() + 1);
  
  const nextYear = d.getUTCFullYear();
  const nextMonth = String(d.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(d.getUTCDate()).padStart(2, '0');
  
  // 01:00:00 AM IST next day (e.g. "2026-11-09T01:00:00+05:30")
  const cutoffIso = `${nextYear}-${nextMonth}-${nextDay}T01:00:00+05:30`;
  return Date.parse(cutoffIso);
}

// Helper: Extract valid epoch ms from record's timestamp or completedAt string
function extractRecordTimestamp(record) {
  if (!record) return 0;
  if (record.timestamp && typeof record.timestamp === 'number' && !isNaN(record.timestamp) && record.timestamp > 0) {
    return record.timestamp;
  }
  if (record.completedAt) {
    const str = String(record.completedAt).trim();
    const parsed = Date.parse(str);
    if (!isNaN(parsed) && parsed > 0) return parsed;

    // Parse "6/11/2026, 3:44:40 pm" or "06-11-2026 15:44:40"
    const match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:,\s*(\d{1,2}):(\d{1,2}):(\d{1,2})\s*(am|pm)?)?/i);
    if (match) {
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      const year = parseInt(match[3], 10);
      let hour = match[4] ? parseInt(match[4], 10) : 12;
      const min = match[5] ? parseInt(match[5], 10) : 0;
      const sec = match[6] ? parseInt(match[6], 10) : 0;
      const ampm = (match[7] || '').toLowerCase();
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;

      const isoStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}+05:30`;
      const t = Date.parse(isoStr);
      if (!isNaN(t)) return t;
    }
  }
  return 0;
}

// Helper: Check if an exam record has passed next morning 1:00 AM IST cutoff
function isRecordExpired(record, nowMs = Date.now()) {
  const ts = extractRecordTimestamp(record);
  if (!ts || ts <= 0) return true; // Malformed/legacy untimestamped records get purged
  const cutoff = getExamExpirationCutoffMs(ts);
  return nowMs >= cutoff;
}

// Helper: Safely unlink media files associated with a student roll
function deleteMediaForRoll(roll, photoUrl, videoUrl) {
  try {
    const tryUnlink = (relPath) => {
      if (!relPath) return;
      const candidates = [
        path.join(DATA_DIR, relPath),
        path.join(__dirname, relPath)
      ];
      candidates.forEach(p => {
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch (e) {}
      });
    };

    tryUnlink(photoUrl);
    tryUnlink(videoUrl);

    if (roll) {
      [PHOTOS_DIR, VIDEOS_DIR].forEach(dir => {
        try {
          if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            files.forEach(f => {
              if (f.startsWith(roll)) {
                try {
                  fs.unlinkSync(path.join(dir, f));
                } catch (e) {}
              }
            });
          }
        } catch (e) {}
      });
    }
  } catch (err) {
    console.warn('[MEDIA DELETE WARNING]', err.message);
  }
}

// Daily Proctoring Media File Sweeper
function cleanupProctorMedia() {
  let videoCount = 0;
  let photoCount = 0;
  try {
    const cleanDir = (dir) => {
      let count = 0;
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        files.forEach(f => {
          try {
            fs.unlinkSync(path.join(dir, f));
            count++;
          } catch (e) {}
        });
      }
      return count;
    };

    videoCount += cleanDir(VIDEOS_DIR);
    photoCount += cleanDir(PHOTOS_DIR);

    if (DATA_DIR !== __dirname) {
      photoCount += cleanDir(path.join(__dirname, 'records', 'photos'));
      videoCount += cleanDir(path.join(__dirname, 'records', 'videos'));
    }

    console.log(`[PROCTOR MEDIA PURGE] Removed ${videoCount} videos and ${photoCount} captured photos.`);
    return { success: true, videosDeleted: videoCount, photosDeleted: photoCount };
  } catch (err) {
    console.error('Error during proctor media purge:', err);
    return { success: false, error: err.message, videosDeleted: videoCount, photosDeleted: photoCount };
  }
}

// Unified Auto-Purge: Purges previous day exam records & proctor media at 1:00 AM IST cutoff
let isPurging = false;
let lastAutoPurgeCheck = 0;

function autoPurgeExpiredRecordsAndMedia(forceAll = false) {
  if (isPurging) {
    return { purgedCount: 0, remainingCount: inMemoryCompletedStudents ? inMemoryCompletedStudents.length : 0 };
  }
  const now = Date.now();
  if (!forceAll && (now - lastAutoPurgeCheck < 30000) && inMemoryCompletedStudents !== null) {
    return { purgedCount: 0, remainingCount: inMemoryCompletedStudents.length };
  }
  lastAutoPurgeCheck = now;
  isPurging = true;

  try {
    const list = getRawCompletedStudents();
    if (!Array.isArray(list) || list.length === 0) {
      if (forceAll) {
        cleanupProctorMedia();
        activeExamSessions.clear();
      }
      isPurging = false;
      return { purgedCount: 0, remainingCount: 0 };
    }

    if (forceAll) {
      console.log(`[MANUAL TOTAL PURGE] Purging all ${list.length} student records and proctor media files...`);
      list.forEach(rec => {
        deleteMediaForRoll(rec.roll, rec.photoUrl, rec.videoUrl);
      });
      cleanupProctorMedia();
      activeExamSessions.clear();
      inMemoryCompletedStudents = [];
      saveCompletedStudents([]);
      isPurging = false;
      return { purgedCount: list.length, remainingCount: 0 };
    }

    const valid = [];
    const expired = [];

    list.forEach(rec => {
      if (isRecordExpired(rec, now)) {
        expired.push(rec);
      } else {
        valid.push(rec);
      }
    });

    if (expired.length > 0) {
      console.log(`[AUTO-PURGE 1:00 AM IST CUTOFF] Purging ${expired.length} expired exam records (held through 11:59 PM until next day 1:00 AM IST)...`);
      expired.forEach(rec => {
        deleteMediaForRoll(rec.roll, rec.photoUrl, rec.videoUrl);
        if (rec.roll) {
          activeExamSessions.delete(rec.roll);
        }
      });

      inMemoryCompletedStudents = valid;
      saveCompletedStudents(valid);

      if (valid.length === 0) {
        cleanupProctorMedia();
      }
      console.log(`[AUTO-PURGE COMPLETE] Removed ${expired.length} records. Active unexpired exam records: ${valid.length}.`);
    } else {
      inMemoryCompletedStudents = valid;
    }

    isPurging = false;
    return { purgedCount: expired.length, remainingCount: valid.length };
  } catch (err) {
    console.error('Error during autoPurgeExpiredRecordsAndMedia:', err);
    isPurging = false;
    return { purgedCount: 0, remainingCount: (inMemoryCompletedStudents || []).length, error: err.message };
  }
}

// 1:00 AM IST Daily Auto-Purge Scheduler (Only in standalone node server)
let lastPurgeDate = '';
if (require.main === module) {
  setInterval(() => {
    try {
      const nowIst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const currentHour = nowIst.getHours();
      const currentMinute = nowIst.getMinutes();
      const currentDateStr = nowIst.toISOString().slice(0, 10);

      // Runs automatically at 01:00 AM IST daily
      if (currentHour === 1 && currentMinute === 0 && lastPurgeDate !== currentDateStr) {
        console.log(`[DAILY 1:00 AM IST AUTO-PURGE] Triggering automated ledger & proctor media purge for date: ${currentDateStr}...`);
        autoPurgeExpiredRecordsAndMedia(false);
        lastPurgeDate = currentDateStr;
      }
    } catch (e) {
      console.error('Error in 1:00 AM scheduler interval:', e);
    }
  }, 60000);
}

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
  if (inMemorySchedule) return inMemorySchedule;
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      const data = fs.readFileSync(SCHEDULE_FILE, 'utf8');
      inMemorySchedule = { ...DEFAULT_SCHEDULE, ...JSON.parse(data || '{}') };
      return inMemorySchedule;
    }
    const bundledSchedule = path.join(__dirname, 'portal_schedule.json');
    if (fs.existsSync(bundledSchedule)) {
      const data = fs.readFileSync(bundledSchedule, 'utf8');
      inMemorySchedule = { ...DEFAULT_SCHEDULE, ...JSON.parse(data || '{}') };
      return inMemorySchedule;
    }
  } catch (err) {
    console.error('Error reading portal_schedule.json:', err);
  }
  inMemorySchedule = { ...DEFAULT_SCHEDULE };
  return inMemorySchedule;
}

function savePortalSchedule(schedule) {
  inMemorySchedule = { ...schedule };
  try {
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedule, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.warn('[STORAGE] Warning writing portal_schedule.json (using memory cache):', err.message);
    return true;
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

let inMemoryPackageConfig = null;
let inMemoryQuestionsDb = null;

function getPackageConfig() {
  if (inMemoryPackageConfig) return inMemoryPackageConfig;
  try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf8'));
    inMemoryPackageConfig = pkg.examConfig || {
      institutionName: 'Educare Academy',
      examName: 'Educare Academy - CBSE Class 10th Science Daily Chapter Assessment',
      commonPassword: 'Edu@26',
      totalQuestions: 25,
      poolSize: 50,
      teacherWhatsApp: '8448467381',
      students: []
    };
    return inMemoryPackageConfig;
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
  if (inMemoryQuestionsDb) return inMemoryQuestionsDb;
  try {
    if (fs.existsSync(QUESTIONS_FILE)) {
      inMemoryQuestionsDb = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
      return inMemoryQuestionsDb;
    }
  } catch (err) {
    console.error('Error reading cbse10_questions.json:', err);
  }
  return { chapters: [], pools: {} };
}

function getActiveConfig() {
  if (inMemoryActiveConfig) return inMemoryActiveConfig;
  try {
    if (fs.existsSync(ACTIVE_CONFIG_FILE)) {
      inMemoryActiveConfig = JSON.parse(fs.readFileSync(ACTIVE_CONFIG_FILE, 'utf8'));
      return inMemoryActiveConfig;
    }
  } catch (err) {
    console.error('Error reading active_test_config.json:', err);
  }
  inMemoryActiveConfig = {
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
  return inMemoryActiveConfig;
}

function saveActiveConfig(cfg) {
  inMemoryActiveConfig = cfg;
  try {
    fs.writeFileSync(ACTIVE_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.warn('[STORAGE] Warning writing active_test_config.json (using memory cache):', err.message);
    return true;
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
  if (inMemoryRoster && inMemoryRoster.length > 0) return inMemoryRoster;
  try {
    if (fs.existsSync(ROSTER_FILE)) {
      inMemoryRoster = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8') || '[]');
      if (inMemoryRoster.length > 0) return inMemoryRoster;
    }
  } catch (err) {}

  // Fallback to bundled roster
  try {
    const bundledRoster = path.join(__dirname, 'students_roster.json');
    if (fs.existsSync(bundledRoster)) {
      inMemoryRoster = JSON.parse(fs.readFileSync(bundledRoster, 'utf8') || '[]');
      if (IS_VERCEL) {
        try { fs.writeFileSync(ROSTER_FILE, JSON.stringify(inMemoryRoster, null, 2), 'utf8'); } catch (e) {}
      }
      return inMemoryRoster;
    }
  } catch (err) {}

  const pkg = getPackageConfig();
  inMemoryRoster = pkg.students || [];
  return inMemoryRoster;
}

function saveStudentRoster(roster) {
  inMemoryRoster = roster;
  try {
    fs.writeFileSync(ROSTER_FILE, JSON.stringify(roster, null, 2), 'utf8');
  } catch (err) {
    console.warn('[STORAGE] Could not write ROSTER_FILE (using in-memory cache):', err.message);
  }

  // When running locally in project directory, sync all credentials files directly on disk
  if (!IS_VERCEL) {
    try {
      // 1. Sync package.json
      if (fs.existsSync(PACKAGE_FILE)) {
        const pkg = JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf8'));
        if (pkg.examConfig) {
          pkg.examConfig.students = roster;
          fs.writeFileSync(PACKAGE_FILE, JSON.stringify(pkg, null, 2), 'utf8');
        }
      }
      if (inMemoryPackageConfig && inMemoryPackageConfig.students) {
        inMemoryPackageConfig.students = roster;
      }

      // 2. Sync STUDENT_CREDENTIALS_LIST.csv
      const csvPath = path.join(__dirname, 'STUDENT_CREDENTIALS_LIST.csv');
      let csv = 'Serial,Name,Roll Number,Password,Class,Phone,Status\n';
      roster.forEach(s => {
        csv += `${s.serial},"${s.name}",${s.roll},${s.password || 'Edu@26'},${s.class || 'Class 10 CBSE'},${s.phone || ''},${s.status || 'ACTIVE'}\n`;
      });
      fs.writeFileSync(csvPath, csv, 'utf8');

      // 3. Sync STUDENT_CREDENTIALS_LIST.md
      const mdPath = path.join(__dirname, 'STUDENT_CREDENTIALS_LIST.md');
      let md = `# EDUCARE ACADEMY - CBSE CLASS 10TH OFFICIAL STUDENT CREDENTIALS\n\n`;
      md += `> **Total Registered Students:** ${roster.length} Students  \n`;
      md += `> **Format:** Roll Number: \`26CBSEBRD---\` | Universal Password: \`Edu@26\`  \n`;
      md += `> **Teacher Helpline & WhatsApp:** +91 8448467381  \n\n`;
      md += `| Serial | Student Name | Roll Number | Password | Class | Phone | Status |\n`;
      md += `|:---:|:---|:---:|:---:|:---:|:---:|:---:|\n`;
      roster.forEach(s => {
        md += `| ${s.serial} | ${s.name} | \`${s.roll}\` | \`${s.password || 'Edu@26'}\` | ${s.class || 'Class 10 CBSE'} | ${s.phone || '-'} | ${s.status || 'ACTIVE'} |\n`;
      });
      fs.writeFileSync(mdPath, md, 'utf8');
      console.log(`[STORAGE SYNC] All 4 roster files updated directly in project folder (JSON, PKG, CSV, MD).`);
    } catch (e) {
      console.error('[STORAGE SYNC] Error syncing reports to folder:', e.message);
    }
  }
  return true;
}

function getRawCompletedStudents() {
  if (inMemoryCompletedStudents) return inMemoryCompletedStudents;
  try {
    if (fs.existsSync(COMPLETED_FILE)) {
      const data = fs.readFileSync(COMPLETED_FILE, 'utf8');
      inMemoryCompletedStudents = JSON.parse(data || '[]');
      return inMemoryCompletedStudents;
    }
    const bundledCompleted = path.join(__dirname, 'completed_students.json');
    if (fs.existsSync(bundledCompleted)) {
      const data = fs.readFileSync(bundledCompleted, 'utf8');
      inMemoryCompletedStudents = JSON.parse(data || '[]');
      return inMemoryCompletedStudents;
    }
  } catch (err) {
    console.error('Error reading completed_students.json:', err);
  }
  inMemoryCompletedStudents = [];
  return inMemoryCompletedStudents;
}

function getCompletedStudents(allowPurge = true) {
  if (allowPurge) {
    autoPurgeExpiredRecordsAndMedia(false);
  }
  return getRawCompletedStudents();
}

function saveCompletedStudents(list) {
  inMemoryCompletedStudents = list;
  try {
    fs.writeFileSync(COMPLETED_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (err) {
    console.warn('[STORAGE] Could not write COMPLETED_FILE (using in-memory cache):', err.message);
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

  // Check if serial number was passed (e.g. 1 to 500)
  if (/^\d{1,3}$/.test(clean)) {
    const sNum = parseInt(clean, 10);
    const roster = getStudentRoster();
    const match = roster.find(s => s.serial === sNum);
    if (match) return match.roll;
    return '26CBSEBRD' + clean.padStart(3, '0');
  }

  // Check if 3-character suffix was passed (e.g. D2A)
  if (/^[A-Z0-9]{3}$/.test(clean)) {
    const roster = getStudentRoster();
    const match = roster.find(s => s.roll === '26CBSEBRD' + clean || s.roll.endsWith(clean));
    if (match) return match.roll;
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
    'X-Frame-Options': 'SAMEORIGIN',
    'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
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

async function requestHandler(req, res) {
  const urlParts = (req.url || '/').split('?');
  const rawPath = urlParts[0];
  const queryStr = urlParts[1] || '';

  // Parse query parameters safely
  const parsedQuery = {};
  if (queryStr) {
    queryStr.split('&').forEach(pair => {
      const idx = pair.indexOf('=');
      if (idx > -1) {
        try {
          const k = decodeURIComponent(pair.slice(0, idx));
          const v = decodeURIComponent(pair.slice(idx + 1));
          parsedQuery[k] = v;
        } catch (e) {}
      }
    });
  }

  // Support Vercel rewrite forwarding via _api_path query or direct path
  let reqPath = rawPath;
  if (parsedQuery._api_path) {
    reqPath = '/api/' + parsedQuery._api_path.replace(/^\/+/, '');
  }

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
      const chId = parseInt(body.chapterId || body.chapter || 1, 10);
      console.log(`[SCRAPER API] Admin requested live NCERT scrape for chapter ${chId}...`);
      const scrapeResult = await ncertScraper.scrapeQuestionsForChapter(chId);
      // Re-trigger daily question selection for refreshed pool and activate chapter
      questionManager.setActiveChapter(chId);
      sendJson(res, 200, {
        success: true,
        message: `Successfully scraped 50 verified NCERT Class 10 questions for Chapter ${chId} (${scrapeResult.chapterName}) from internet.`,
        chapterId: chId,
        chapterName: scrapeResult.chapterName,
        chapterHindi: scrapeResult.chapterHindi,
        scrapeResult
      });
      return;
    } catch (err) {
      console.error('Error in scrape-questions endpoint:', err);
      sendJson(res, 500, { success: false, message: 'Scraping engine error: ' + err.message });
      return;
    }
  }

  // 4f. POST /api/admin/clean-proctor-media (Manual trigger for proctor video/photo & results purge)
  if (req.method === 'POST' && reqPath === '/api/admin/clean-proctor-media') {
    try {
      const body = await readJsonBody(req);
      if (!verifyAdminAuth(req, body, queryStr)) {
        sendJson(res, 401, { success: false, error: 'UNAUTHORIZED_ADMIN', message: '🚫 Admin Authorization Required.' });
        return;
      }
      const forceAll = !!(body && (body.purgeAll || body.forceAll || body.clearAll));
      const purgeResult = autoPurgeExpiredRecordsAndMedia(forceAll);
      const mediaResult = cleanupProctorMedia();
      const totalDeletedFiles = (mediaResult.videosDeleted || 0) + (mediaResult.photosDeleted || 0);

      sendJson(res, 200, {
        success: true,
        message: forceAll
          ? `All test records and proctor media purged (${purgeResult.purgedCount} student records, ${totalDeletedFiles} media files removed). Ready for new exam.`
          : `Purge completed: ${purgeResult.purgedCount} expired records purged, ${purgeResult.remainingCount} active records retained until 1:00 AM IST. ${totalDeletedFiles} media files cleaned.`,
        purgedRecords: purgeResult.purgedCount,
        remainingRecords: purgeResult.remainingCount,
        deletedVideos: mediaResult.videosDeleted || 0,
        deletedPhotos: mediaResult.photosDeleted || 0,
        deletedFiles: totalDeletedFiles,
        purgeResult
      });
      return;
    } catch (err) {
      sendJson(res, 500, { success: false, message: 'Error cleaning proctor media & records: ' + err.message });
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

        sendJson(res, 200, {
          success: true,
          alreadyCompleted: true,
          completedAt: existingAttempt.completedAt,
          score: existingAttempt.score,
          total: existingAttempt.total || 25,
          percentage: existingAttempt.percentage,
          record: existingAttempt,
          studentName: student.name,
          normalizedRoll: normalizedRoll,
          message: `Notice: ${student.name} (${student.roll}) has already submitted today's assessment. Score: ${existingAttempt.score}/${existingAttempt.total || 25}.`
        });
        return;
      }

      // All checks passed! Register active exam session immediately with photo
      let candidatePhoto = body.photoUrl || '';
      if (candidatePhoto && candidatePhoto.startsWith('data:image/') && !IS_VERCEL) {
        try {
          const matches = candidatePhoto.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            const imgBuffer = Buffer.from(matches[2], 'base64');
            const photoName = `${normalizedRoll}_photo.jpg`;
            fs.writeFileSync(path.join(PHOTOS_DIR, photoName), imgBuffer);
            candidatePhoto = `/records/photos/${photoName}`;
          }
        } catch (e) {}
      }

      activeExamSessions.set(normalizedRoll, {
        roll: normalizedRoll,
        name: studentName,
        startTime: Date.now(),
        lastActivity: Date.now(),
        violationsCount: 0,
        violations: [],
        photoUrl: candidatePhoto,
        status: 'IN_PROGRESS'
      });

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
          status: 'IN_PROGRESS',
          photoUrl: (session && session.photoUrl) ? session.photoUrl : ''
        };
        activeExamSessions.set(roll, session);
      }

      session.lastActivity = Date.now();
      if (name) session.name = name;

      if (body.photoUrl) {
        let pUrl = body.photoUrl;
        if (pUrl.startsWith('data:image/')) {
          if (!IS_VERCEL) {
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
        if (!IS_VERCEL) {
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

  // 8a. GET /api/student-result (Public Student Result & Marksheet Lookup by Roll Number)
  if (req.method === 'GET' && reqPath === '/api/student-result') {
    const params = new URLSearchParams(queryStr);
    const rawRoll = (params.get('roll') || '').trim();
    if (!rawRoll) {
      sendJson(res, 400, { success: false, message: 'Roll number is required to search result.' });
      return;
    }

    const normRoll = normalizeRollNumber(rawRoll);
    const roster = getStudentRoster();
    const student = roster.find(s => s.roll === normRoll || s.roll === rawRoll.toUpperCase());
    const completedList = getCompletedStudents();
    const record = completedList.find(s => s.roll === normRoll || s.roll === rawRoll.toUpperCase());

    if (record) {
      sendJson(res, 200, {
        success: true,
        found: true,
        attempted: true,
        studentName: record.name || (student ? student.name : 'Student'),
        roll: record.roll,
        record: {
          ...record,
          name: record.name || (student ? student.name : 'Student'),
          class: student ? student.class : 'Class 10 CBSE'
        }
      });
      return;
    }

    if (student) {
      sendJson(res, 200, {
        success: false,
        found: true,
        attempted: false,
        studentName: student.name,
        roll: student.roll,
        message: `Student ${student.name} (${student.roll}) is registered in Educare Academy, but has not yet submitted today's assessment.`
      });
      return;
    }

    sendJson(res, 404, {
      success: false,
      found: false,
      message: `No assessment record found for Roll Number "${rawRoll}". Please check your roll number (e.g. 26CBSEBRD001).`
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
          name: s.name || rec.name || `Student #${s.serial}`,
          roll: s.roll,
          password: s.password,
          phone: s.phone || '',
          class: s.class || 'Class 10 CBSE',
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
          name: s.name || active.name || `Student #${s.serial}`,
          roll: s.roll,
          password: s.password,
          phone: s.phone || '',
          class: s.class || 'Class 10 CBSE',
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
        phone: s.phone || '',
        class: s.class || 'Class 10 CBSE',
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
        if (body.class) roster[idx].class = body.class.trim();
        roster[idx].phone = (body.phone || '').trim();
        if (body.status) roster[idx].status = body.status.trim();
        saveStudentRoster(roster);

        // Also update name in completed_students.json if candidate previously completed test
        try {
          const completed = getCompletedStudents();
          const cIdx = completed.findIndex(c => c.roll === roll);
          if (cIdx >= 0) {
            completed[cIdx].name = name;
            completed[cIdx].phone = (body.phone || '').trim();
            saveCompletedStudents(completed);
          }
        } catch (cErr) {}

        console.log(`[STUDENT UPDATED] Slot #${roster[idx].serial}: ${name} (${roll}) | Phone: ${roster[idx].phone} | Roll & Password remain locked.`);
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

  // 10c-2. POST /api/admin/sync-student-overrides (Bi-directional sync of client localStorage overrides to server)
  if (req.method === 'POST' && reqPath === '/api/admin/sync-student-overrides') {
    try {
      const body = await readJsonBody(req);
      if (!verifyAdminAuth(req, body, queryStr)) {
        sendJson(res, 401, { success: false, error: 'UNAUTHORIZED_ADMIN', message: '🚫 Admin Authorization Required.' });
        return;
      }
      const overrides = body.overrides || {};
      const roster = getStudentRoster();
      let updatedCount = 0;

      for (const [rawRoll, data] of Object.entries(overrides)) {
        const roll = normalizeRollNumber(rawRoll);
        const idx = roster.findIndex(s => s.roll === roll);
        if (idx >= 0 && data) {
          let itemChanged = false;
          if (data.name) {
            const cleanName = data.name.trim();
            if (cleanName && roster[idx].name !== cleanName) {
              roster[idx].name = cleanName;
              itemChanged = true;
            }
          }
          if (data.phone !== undefined) {
            const cleanPhone = (data.phone || '').trim();
            if (roster[idx].phone !== cleanPhone) {
              roster[idx].phone = cleanPhone;
              itemChanged = true;
            }
          }
          if (data.class) {
            const cleanClass = data.class.trim();
            if (roster[idx].class !== cleanClass) {
              roster[idx].class = cleanClass;
              itemChanged = true;
            }
          }
          if (data.status) {
            const cleanStatus = data.status.trim();
            if (roster[idx].status !== cleanStatus) {
              roster[idx].status = cleanStatus;
              itemChanged = true;
            }
          }
          if (itemChanged) {
            updatedCount++;
          }
        }
      }

      if (updatedCount > 0) {
        saveStudentRoster(roster);
        try {
          const completed = getCompletedStudents();
          let cUpdated = false;
          completed.forEach(c => {
            const ovr = overrides[c.roll];
            if (ovr) {
              if (ovr.name && c.name !== ovr.name) {
                c.name = ovr.name;
                cUpdated = true;
              }
              if (ovr.phone !== undefined && c.phone !== ovr.phone) {
                c.phone = ovr.phone;
                cUpdated = true;
              }
            }
          });
          if (cUpdated) saveCompletedStudents(completed);
        } catch (e) {}
      }

      console.log(`[OVERRIDES SYNCED] Successfully synced ${updatedCount} student overrides to server roster.`);
      sendJson(res, 200, {
        success: true,
        message: `Synced ${updatedCount} student overrides to server memory & storage.`,
        updatedCount
      });
      return;
    } catch (err) {
      console.error('Error syncing student overrides:', err);
      sendJson(res, 500, { success: false, message: 'Server error syncing overrides.' });
      return;
    }
  }

  // 10c-3. POST /api/admin/sync-git-vercel (Permanent push of local file updates to GitHub & Vercel)
  if (req.method === 'POST' && reqPath === '/api/admin/sync-git-vercel') {
    try {
      if (!verifyAdminAuth(req, null, queryStr)) {
        sendJson(res, 401, { success: false, error: 'UNAUTHORIZED_ADMIN', message: '🚫 Admin Authorization Required.' });
        return;
      }
      if (IS_VERCEL) {
        sendJson(res, 200, {
          success: true,
          message: 'Changes are securely active in serverless memory and client localStorage.'
        });
        return;
      }
      const { exec } = require('child_process');
      exec('git add . && git commit -m "Auto-sync updated student roster from Admin Panel" && git push origin main', { cwd: __dirname }, (error, stdout, stderr) => {
        if (error) {
          console.warn('[GIT SYNC ERROR]:', error.message);
          sendJson(res, 200, { success: true, message: 'Files saved to project folder successfully.' });
          return;
        }
        console.log('[GIT SYNC SUCCESS]:', stdout);
        sendJson(res, 200, {
          success: true,
          message: '✓ Successfully committed and pushed all updated student files to GitHub & Vercel!'
        });
      });
      return;
    } catch (err) {
      sendJson(res, 500, { success: false, message: err.message });
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
  // ANTI-SCRAPING & SECURITY FIREWALL (Strict Public Whitelist)
  // -----------------------------------------------------------
  let serveFile = reqPath;
  if (serveFile === '/' || serveFile === '') {
    serveFile = '/index.html';
  } else if (serveFile === '/admin' || serveFile === '/admin/') {
    serveFile = '/admin.html';
  } else if (serveFile === '/question-paper' || serveFile === '/question-paper/') {
    serveFile = '/question-paper.html';
  }

  // Strictly Whitelisted Public Static Files
  const ALLOWED_STATIC_FILES = new Set([
    '/index.html',
    '/admin.html',
    '/question-paper.html',
    '/style.css',
    '/app.js',
    '/robots.txt',
    '/favicon.ico'
  ]);

  // Block any scraper/attacker attempt to access source code, lists, or database files
  const isDirectFileBlocked = !ALLOWED_STATIC_FILES.has(serveFile) &&
    !serveFile.startsWith('/records/videos/') &&
    !serveFile.startsWith('/records/photos/');

  if (isDirectFileBlocked) {
    res.writeHead(403, {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet'
    });
    res.end(JSON.stringify({
      error: 'ACCESS_DENIED',
      message: '🚫 Direct file access is strictly blocked by Educare Security Firewall.'
    }));
    return;
  }

  const filePath = serveFile.startsWith('/records/')
    ? path.join(DATA_DIR, serveFile)
    : path.join(PUBLIC_DIR, serveFile);

  if (!filePath.startsWith(PUBLIC_DIR) && !filePath.startsWith(DATA_DIR)) {
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
}

const server = http.createServer(requestHandler);

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

// Run local HTTP server if executed directly via node CLI
if (require.main === module) {
  startServer(PORT);
}

module.exports = requestHandler;
