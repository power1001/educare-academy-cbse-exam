// Educare Academy - CBSE Class 10th Science Assessment Serverless API Engine
const fs = require('fs');
const path = require('path');
const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = 'educare-academy/cbse-10-exam';
const GITHUB_FILE = 'completed_students.json';
const GITHUB_SCHEDULE_FILE = 'portal_schedule.json';

const DEFAULT_SCHEDULE = {
  portalOpen: true,
  deadline: '2026-12-31T23:59:59+05:30',
  deadlineFormatted: '31 Dec 2026, 11:59:59 PM IST',
  timezone: 'Asia/Kolkata',
  closedMessage: 'Educare Academy CBSE Class 10th Science Assessment portal registration & examination window is closed. Please contact your teacher at 8448467381.',
  closedMessageHindi: 'एजुकेयर एकेडमी कक्षा 10वीं सीबीएसई दैनिक परीक्षा पोर्टल वर्तमान में बंद है। सहायता के लिए +91 8448467381 पर संपर्क करें।',
  updatedAt: new Date().toISOString(),
  updatedBy: 'Educare Academy Admin'
};

let pkgConfig = null;
try {
  const pkg = require('../package.json');
  pkgConfig = pkg.examConfig || {};
} catch (e) {
  pkgConfig = {};
}

// In-memory cache for fast response and avoiding rate limits
let cacheCompleted = {
  data: null,
  sha: null,
  lastFetch: 0
};

let cacheSchedule = {
  data: null,
  sha: null,
  lastFetch: 0
};

// In-memory real-time active exam sessions map
const activeExamSessions = new Map();

function githubRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path: endpoint,
      method: method,
      headers: {
        'User-Agent': 'Educare-CBSE-Exam-Portal',
        'Authorization': GITHUB_TOKEN ? 'token ' + GITHUB_TOKEN : undefined,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Fetch completed records from GitHub repository ledger
async function fetchCompletedFromGitHub(forceFresh = false) {
  const now = Date.now();
  if (!forceFresh && cacheCompleted.data && (now - cacheCompleted.lastFetch < 3000)) {
    return { list: cacheCompleted.data, sha: cacheCompleted.sha };
  }

  try {
    const res = await githubRequest('GET', `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`);
    if (res.status === 200 && res.data && res.data.content) {
      const raw = Buffer.from(res.data.content, 'base64').toString('utf8');
      const list = JSON.parse(raw || '[]');
      cacheCompleted = {
        data: list,
        sha: res.data.sha,
        lastFetch: now
      };
      return { list, sha: res.data.sha };
    }
  } catch (err) {
    console.error('Error fetching from GitHub ledger:', err);
  }

  // Fallback to local file or empty array
  try {
    const localPath = path.join(__dirname, '..', 'completed_students.json');
    if (fs.existsSync(localPath)) {
      const data = JSON.parse(fs.readFileSync(localPath, 'utf8') || '[]');
      return { list: data, sha: null };
    }
  } catch (e) {}

  return { list: cacheCompleted.data || [], sha: cacheCompleted.sha };
}

// Save completed records directly to GitHub repository ledger
async function saveCompletedToGitHub(newList, commitMessage) {
  cacheCompleted.data = newList;
  cacheCompleted.lastFetch = Date.now();

  try {
    // 1. Get latest sha
    const getRes = await githubRequest('GET', `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`);
    const sha = (getRes.status === 200 && getRes.data) ? getRes.data.sha : cacheCompleted.sha;

    // 2. Put updated content
    const base64Content = Buffer.from(JSON.stringify(newList, null, 2)).toString('base64');
    const putRes = await githubRequest('PUT', `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`, {
      message: commitMessage || 'Update candidate exam records ledger',
      content: base64Content,
      sha: sha,
      committer: {
        name: 'PETER PARKER',
        email: 'educareacademy-maker@users.noreply.github.com'
      },
      author: {
        name: 'PETER PARKER',
        email: 'educareacademy-maker@users.noreply.github.com'
      }
    });

    if ((putRes.status === 200 || putRes.status === 201) && putRes.data && putRes.data.content) {
      cacheCompleted.sha = putRes.data.content.sha;
      console.log(`[LEDGER UPDATED ON GITHUB] ${commitMessage}`);
      return true;
    }
  } catch (err) {
    console.error('Error writing to GitHub ledger:', err);
  }

  // Backup write to /tmp or local
  try {
    const tmpPath = path.join('/tmp', 'completed_students.json');
    fs.writeFileSync(tmpPath, JSON.stringify(newList, null, 2), 'utf8');
  } catch (e) {}

  return false;
}

// Fetch portal schedule from GitHub or local ledger
async function fetchScheduleFromGitHub(forceFresh = false) {
  const now = Date.now();
  if (!forceFresh && cacheSchedule.data && (now - cacheSchedule.lastFetch < 3000)) {
    return { schedule: cacheSchedule.data, sha: cacheSchedule.sha };
  }

  try {
    const res = await githubRequest('GET', `/repos/${GITHUB_REPO}/contents/${GITHUB_SCHEDULE_FILE}`);
    if (res.status === 200 && res.data && res.data.content) {
      const raw = Buffer.from(res.data.content, 'base64').toString('utf8');
      const sched = JSON.parse(raw || '{}');
      cacheSchedule = {
        data: { ...DEFAULT_SCHEDULE, ...sched },
        sha: res.data.sha,
        lastFetch: now
      };
      return { schedule: cacheSchedule.data, sha: res.data.sha };
    }
  } catch (err) {
    console.error('Error fetching portal schedule from GitHub:', err);
  }

  // Fallback to local file or default
  try {
    const localPath = path.join(__dirname, '..', 'portal_schedule.json');
    if (fs.existsSync(localPath)) {
      const data = JSON.parse(fs.readFileSync(localPath, 'utf8') || '{}');
      return { schedule: { ...DEFAULT_SCHEDULE, ...data }, sha: null };
    }
  } catch (e) {}

  return { schedule: cacheSchedule.data || DEFAULT_SCHEDULE, sha: cacheSchedule.sha };
}

// Save portal schedule directly to GitHub repository ledger and local
async function saveScheduleToGitHub(newSchedule, commitMessage) {
  cacheSchedule.data = newSchedule;
  cacheSchedule.lastFetch = Date.now();

  try {
    // 1. Get latest sha
    const getRes = await githubRequest('GET', `/repos/${GITHUB_REPO}/contents/${GITHUB_SCHEDULE_FILE}`);
    const sha = (getRes.status === 200 && getRes.data) ? getRes.data.sha : cacheSchedule.sha;

    // 2. Put updated content
    const base64Content = Buffer.from(JSON.stringify(newSchedule, null, 2)).toString('base64');
    const putRes = await githubRequest('PUT', `/repos/${GITHUB_REPO}/contents/${GITHUB_SCHEDULE_FILE}`, {
      message: commitMessage || 'Update exam portal schedule and deadline',
      content: base64Content,
      sha: sha,
      committer: {
        name: 'PETER PARKER',
        email: 'educareacademy-maker@users.noreply.github.com'
      },
      author: {
        name: 'PETER PARKER',
        email: 'educareacademy-maker@users.noreply.github.com'
      }
    });

    if ((putRes.status === 200 || putRes.status === 201) && putRes.data && putRes.data.content) {
      cacheSchedule.sha = putRes.data.content.sha;
      console.log(`[SCHEDULE UPDATED ON GITHUB] ${commitMessage}`);
      return true;
    }
  } catch (err) {
    console.error('Error writing portal schedule to GitHub:', err);
  }

  // Local/tmp write
  try {
    const localPath = path.join(__dirname, '..', 'portal_schedule.json');
    fs.writeFileSync(localPath, JSON.stringify(newSchedule, null, 2), 'utf8');
  } catch (e) {}
  try {
    const tmpPath = path.join('/tmp', 'portal_schedule.json');
    fs.writeFileSync(tmpPath, JSON.stringify(newSchedule, null, 2), 'utf8');
  } catch (e) {}

  return false;
}

function evaluatePortalStatus(schedule) {
  const current = schedule || DEFAULT_SCHEDULE;
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

function normalizeRollNumber(rawRoll) {
  if (!rawRoll) return '';
  const clean = String(rawRoll).trim().toUpperCase();
  const alphanumeric = clean.replace(/[^A-Z0-9]/g, '');
  if (/^26CBSEBRD[A-Z0-9]{3}$/.test(alphanumeric)) {
    return alphanumeric;
  }
  return clean;
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), interest-cohort=()');
  if (typeof res.removeHeader === 'function') res.removeHeader('X-Powered-By');
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') {
      return resolve(req.body);
    }
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const reqPath = url.pathname;

  // 1. GET /api/exam-config
  if (req.method === 'GET' && reqPath.includes('exam-config')) {
    const { schedule } = await fetchScheduleFromGitHub();
    const evaluated = evaluatePortalStatus(schedule);
    sendJson(res, 200, {
      success: true,
      examName: pkgConfig.examName || 'Educare Academy - CBSE Class 10th Science Daily Chapter Assessment',
      durationMinutes: 25,
      totalQuestions: 25,
      portalSchedule: evaluated
    });
    return;
  }

  // 1b. GET /api/portal-schedule
  if (req.method === 'GET' && reqPath.includes('portal-schedule')) {
    const { schedule } = await fetchScheduleFromGitHub();
    const evaluated = evaluatePortalStatus(schedule);
    sendJson(res, 200, {
      success: true,
      ...evaluated
    });
    return;
  }

  // 2. POST /api/verify-login
  if (req.method === 'POST' && reqPath.includes('verify-login')) {
    try {
      const { schedule } = await fetchScheduleFromGitHub();
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
            ? `🚫 Assessment Closed: The examination window for Educare Academy Class 10 expired on ${portalState.deadlineFormatted || '31 Dec 2026'}. Candidate login is no longer permitted.`
            : `🚫 Assessment Closed: The examination portal has been closed by the administration. Contact Sir at +91 8448467381.`
        });
        return;
      }

      const body = await readBody(req);
      const name = (body.name || '').trim();
      const rawRoll = (body.roll || '').trim();
      const password = (body.password || '').trim();

      if (!name) {
        sendJson(res, 400, { success: false, error: 'MISSING_NAME', message: 'Please enter Student Full Name to continue.' });
        return;
      }
      if (!rawRoll) {
        sendJson(res, 400, { success: false, error: 'MISSING_ROLL', message: 'Please enter your authorized Roll Number.' });
        return;
      }
      if (!password) {
        sendJson(res, 400, { success: false, error: 'MISSING_PASSWORD', message: 'Please enter your confidential Exam Password.' });
        return;
      }

      const students = pkgConfig.students || [];
      const normalizedRoll = normalizeRollNumber(rawRoll);
      const student = students.find(s => s.roll === normalizedRoll);

      if (!student) {
        sendJson(res, 401, {
          success: false,
          error: 'INVALID_ROLL',
          message: `Invalid Roll Number (${rawRoll})! Please enter the authorized Roll Number printed on your Admit Card.`
        });
        return;
      }

      if (password !== 'Edu@26' && password !== student.password) {
        sendJson(res, 401, {
          success: false,
          error: 'INVALID_PASSWORD',
          message: `Incorrect Password! Please enter the valid Exam Password.`
        });
        return;
      }

      // Check single-attempt against cloud ledger
      const { list: completedList } = await fetchCompletedFromGitHub();
      const existingAttempt = completedList.find(s => s.roll === normalizedRoll);
      if (existingAttempt) {
        sendJson(res, 403, {
          success: false,
          error: 'ALREADY_COMPLETED',
          alreadyCompleted: true,
          completedAt: existingAttempt.completedAt,
          score: existingAttempt.score,
          total: existingAttempt.total,
          message: `🚫 Access Denied: Examination Already Completed! Candidate with Roll Number ${normalizedRoll} has already submitted this test. Re-attempting is strictly prohibited.`
        });
        return;
      }

      sendJson(res, 200, {
        success: true,
        normalizedRoll: normalizedRoll,
        studentSerial: student.serial,
        message: 'Candidate Verified Successfully'
      });
      return;
    } catch (err) {
      sendJson(res, 500, { success: false, message: 'Server verification error' });
      return;
    }
  }

  // 2b. POST /api/exam-activity (Real-time student progress & proctoring tab-switch logging)
  if (req.method === 'POST' && reqPath.includes('exam-activity')) {
    try {
      const body = await readBody(req);
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

      if (type === 'VIOLATION') {
        session.violationsCount = body.violationsCount || (session.violationsCount + 1);
        const violationEntry = {
          strike: body.strike || session.violationsCount,
          reason: body.reason || 'Proctoring violation detected',
          time: body.time || new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }),
          timestamp: body.timestamp || Date.now()
        };
        session.violations.push(violationEntry);
        console.log(`[REALTIME VIOLATION] Roll: ${roll} | Strike ${violationEntry.strike}: ${violationEntry.reason}`);
      }

      sendJson(res, 200, { success: true, session });
      return;
    } catch (err) {
      console.error('Error logging exam activity:', err);
      sendJson(res, 500, { success: false, message: 'Server activity error' });
      return;
    }
  }

  // 3. POST /api/complete-exam
  if (req.method === 'POST' && reqPath.includes('complete-exam')) {
    try {
      const { schedule } = await fetchScheduleFromGitHub();
      const portalState = evaluatePortalStatus(schedule);
      if (!portalState.isOpen) {
        sendJson(res, 403, {
          success: false,
          error: 'PORTAL_CLOSED',
          message: '🚫 Submission Rejected: The examination portal deadline has expired. Submissions can no longer be accepted.'
        });
        return;
      }

      const body = await readBody(req);
      const roll = normalizeRollNumber(body.roll);
      const name = (body.name || '').trim();
      const score = body.score ?? 0;
      const total = body.total ?? 20;
      const percentage = body.percentage ?? '0';
      const status = body.status || 'SUBMITTED';

      if (!roll) {
        sendJson(res, 400, { success: false, message: 'Roll number is required' });
        return;
      }

      const active = activeExamSessions.get(roll);
      activeExamSessions.delete(roll); // Session finished, remove from active in-memory tracker

      const { list: completedList } = await fetchCompletedFromGitHub(true);
      const existsIndex = completedList.findIndex(s => s.roll === roll);

      const allViolations = (body.violations && body.violations.length > 0)
        ? body.violations
        : (active && active.violations ? active.violations : []);
      const violationsCount = typeof body.violationsCount === 'number'
        ? body.violationsCount
        : allViolations.length;

      const record = {
        roll: roll,
        name: name || (active ? active.name : ''),
        score: score,
        total: total,
        percentage: percentage,
        secAScore: body.secAScore ?? 0,
        secBScore: body.secBScore ?? 0,
        status: status,
        completionType: body.completionType || (status === 'DISQUALIFIED' ? 'DISQUALIFIED' : 'COMPLETED'),
        timeSpentSeconds: body.timeSpentSeconds || 0,
        timeSpentFormatted: body.timeSpentFormatted || '',
        violationsCount: violationsCount,
        violations: allViolations,
        solutions: body.solutions || [],
        disqualificationReason: body.disqualificationReason || '',
        completedAt: body.completedAt || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        timestamp: Date.now()
      };

      if (existsIndex >= 0) {
        completedList[existsIndex] = record;
      } else {
        completedList.unshift(record);
      }

      // Commit update to GitHub repository cloud ledger!
      await saveCompletedToGitHub(completedList, `Candidate exam submitted: ${roll} (${record.name}) - Score ${score}/${total} | Violations: ${violationsCount}`);

      sendJson(res, 200, {
        success: true,
        message: 'Examination record locked permanently in server ledger.',
        record: record
      });
      return;
    } catch (err) {
      console.error('Error completing exam:', err);
      sendJson(res, 500, { success: false, message: 'Server error saving submission' });
      return;
    }
  }

  // 4. GET /api/completed-students
  if (req.method === 'GET' && reqPath.includes('completed-students')) {
    const { list } = await fetchCompletedFromGitHub();
    sendJson(res, 200, { success: true, total: list.length, records: list });
    return;
  }

  // 5. POST /api/clear-completed-students
  if (req.method === 'POST' && reqPath.includes('clear-completed-students')) {
    activeExamSessions.clear();
    await saveCompletedToGitHub([], 'Admin cleared all candidate records');
    sendJson(res, 200, { success: true, message: 'All completed student records have been reset.' });
    return;
  }

  // 5b. POST /api/admin/verify-auth
  if (req.method === 'POST' && reqPath.includes('verify-auth')) {
    try {
      const body = await readJsonBody(req);
      const pwd = (body.password || body.key || '').trim();
      const validPasswords = ['Rockey6974@'];
      if (validPasswords.includes(pwd)) {
        sendJson(res, 200, {
          success: true,
          message: 'Admin authorization granted',
          authenticated: true
        });
      } else {
        sendJson(res, 401, {
          success: false,
          message: 'Invalid Master Administrator Password',
          authenticated: false
        });
      }
      return;
    } catch (err) {
      sendJson(res, 500, { success: false, message: 'Server auth error' });
      return;
    }
  }

  // 6. GET /api/admin/all-students
  if (req.method === 'GET' && reqPath.includes('all-students')) {
    const allStudents = pkgConfig.students || [];
    const { list: completedList } = await fetchCompletedFromGitHub();
    const completedMap = new Map();
    completedList.forEach(c => completedMap.set(c.roll, c));

    let completedCount = 0;
    let inProgressCount = 0;
    let eligibleCount = 0;
    let notEligibleCount = 0;
    let disqualifiedCount = 0;
    let totalViolationsRecorded = 0;

    const now = Date.now();
    const studentRows = allStudents.map(s => {
      const rec = completedMap.get(s.roll);
      const active = activeExamSessions.get(s.roll);
      const isActiveNow = active && (now - active.lastActivity < 25 * 60 * 1000);

      if (rec) {
        completedCount++;
        const isDisqualified = rec.status === 'Disqualified' || rec.status === 'DISQUALIFIED' || rec.completionType === 'DISQUALIFIED';
        const isPass = rec.score >= 10;
        let eligibility = 'ELIGIBLE';
        if (isDisqualified) {
          eligibility = 'DISQUALIFIED';
          disqualifiedCount++;
        } else if (isPass) {
          eligibility = 'ELIGIBLE';
          eligibleCount++;
        } else {
          eligibility = 'NOT_ELIGIBLE';
          notEligibleCount++;
        }

        const vCount = rec.violationsCount || (rec.violations ? rec.violations.length : 0);
        totalViolationsRecorded += vCount;

        return {
          serial: s.serial,
          name: rec.name || s.name || `Candidate #${s.serial}`,
          roll: s.roll,
          password: s.password,
          attempted: true,
          isInProgress: false,
          score: rec.score,
          total: rec.total || 20,
          percentage: rec.percentage || Math.round((rec.score / (rec.total || 20)) * 100),
          secAScore: rec.secAScore ?? 0,
          secBScore: rec.secBScore ?? 0,
          status: rec.status || (isPass ? 'Qualified' : 'Failed'),
          eligibility: eligibility,
          completionType: rec.completionType || (isDisqualified ? 'DISQUALIFIED' : (rec.timeSpentSeconds && rec.timeSpentSeconds < 1200 ? 'EARLY_SUBMIT' : 'TIME_EXPIRED')),
          timeSpentFormatted: rec.timeSpentFormatted || '',
          violationsCount: vCount,
          violations: rec.violations || [],
          solutions: rec.solutions || [],
          completedAt: rec.completedAt || '-',
          timestamp: rec.timestamp || 0
        };
      } else if (isActiveNow) {
        inProgressCount++;
        const vCount = active.violationsCount || (active.violations ? active.violations.length : 0);
        totalViolationsRecorded += vCount;

        return {
          serial: s.serial,
          name: active.name || s.name || `Candidate #${s.serial}`,
          roll: s.roll,
          password: s.password,
          attempted: false,
          isInProgress: true,
          score: null,
          total: 20,
          percentage: null,
          status: 'In Progress',
          eligibility: 'IN_PROGRESS',
          completionType: 'ACTIVE',
          timeSpentFormatted: 'Taking Exam Now',
          violationsCount: vCount,
          violations: active.violations || [],
          solutions: [],
          completedAt: 'Active (' + new Date(active.startTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) + ')',
          timestamp: active.lastActivity
        };
      }

      return {
        serial: s.serial,
        name: s.name || `Candidate #${s.serial}`,
        roll: s.roll,
        password: s.password,
        attempted: false,
        isInProgress: false,
        score: null,
        total: 20,
        percentage: null,
        status: 'Pending',
        eligibility: 'PENDING',
        completionType: 'PENDING',
        timeSpentFormatted: '-',
        violationsCount: 0,
        violations: [],
        solutions: [],
        completedAt: '-',
        timestamp: 0
      };
    });

    sendJson(res, 200, {
      success: true,
      summary: {
        totalEnrolled: allStudents.length,
        completed: completedCount,
        inProgress: inProgressCount,
        pending: allStudents.length - completedCount - inProgressCount,
        eligible: eligibleCount,
        notEligible: notEligibleCount,
        disqualified: disqualifiedCount,
        totalViolations: totalViolationsRecorded,
        passPercentage: completedCount > 0 ? Math.round((eligibleCount / completedCount) * 100) : 0
      },
      students: studentRows
    });
    return;
  }

  // 6b. GET /api/admin/student-report?roll=...
  if (req.method === 'GET' && reqPath.includes('student-report')) {
    const allStudents = pkgConfig.students || [];
    const queryRoll = normalizeRollNumber(url.searchParams.get('roll') || '');

    const student = allStudents.find(s => s.roll === queryRoll);
    const { list: completedList } = await fetchCompletedFromGitHub();
    const rec = completedList.find(s => s.roll === queryRoll);
    const active = activeExamSessions.get(queryRoll);

    if (!student && !rec && !active) {
      sendJson(res, 404, { success: false, message: 'Candidate not found.' });
      return;
    }

    sendJson(res, 200, {
      success: true,
      report: {
        roll: queryRoll,
        serial: student ? student.serial : null,
        name: (rec && rec.name) || (active && active.name) || (student ? student.name : `Candidate ${queryRoll}`),
        password: student ? student.password : '',
        attempted: !!rec,
        isInProgress: !!active && !rec,
        score: rec ? rec.score : null,
        total: rec ? (rec.total || 20) : 20,
        percentage: rec ? rec.percentage : null,
        secAScore: rec ? (rec.secAScore ?? 0) : null,
        secBScore: rec ? (rec.secBScore ?? 0) : null,
        status: rec ? rec.status : (active ? 'In Progress' : 'Pending'),
        completionType: rec ? rec.completionType : (active ? 'ACTIVE' : 'PENDING'),
        timeSpentFormatted: rec ? rec.timeSpentFormatted : (active ? 'In Progress' : '-'),
        violationsCount: rec ? rec.violationsCount : (active ? active.violationsCount : 0),
        violations: rec ? (rec.violations || []) : (active ? (active.violations || []) : []),
        solutions: rec ? (rec.solutions || []) : [],
        completedAt: rec ? rec.completedAt : (active ? 'In Progress' : '-'),
        timestamp: rec ? rec.timestamp : (active ? active.lastActivity : 0)
      }
    });
    return;
  }

  // 7. POST /api/admin/reset-student
  if (req.method === 'POST' && reqPath.includes('reset-student')) {
    try {
      const body = await readBody(req);
      const rollToReset = normalizeRollNumber((body.roll || '').trim());
      if (!rollToReset) {
        sendJson(res, 400, { success: false, message: 'Roll number is required to reset' });
        return;
      }
      activeExamSessions.delete(rollToReset);
      let { list: completedList } = await fetchCompletedFromGitHub(true);
      const initialLen = completedList.length;
      completedList = completedList.filter(s => s.roll !== rollToReset);
      await saveCompletedToGitHub(completedList, `Admin reset attempt for ${rollToReset}`);
      sendJson(res, 200, {
        success: true,
        message: `Attempt record for ${rollToReset} reset successfully. Candidate can now re-attempt.`,
        deleted: initialLen > completedList.length
      });
      return;
    } catch (err) {
      sendJson(res, 500, { success: false, message: 'Error resetting student record' });
      return;
    }
  }

  // 8. POST /api/admin/portal-schedule
  if (req.method === 'POST' && reqPath.includes('portal-schedule')) {
    try {
      const body = await readBody(req);
      const { schedule: existing } = await fetchScheduleFromGitHub(true);
      const current = existing || DEFAULT_SCHEDULE;

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

      await saveScheduleToGitHub(updatedSchedule, `Admin updated exam portal schedule: Deadline ${newFormatted}, Open: ${updatedSchedule.portalOpen}`);
      const evaluated = evaluatePortalStatus(updatedSchedule);

      sendJson(res, 200, {
        success: true,
        message: 'Portal schedule successfully updated.',
        schedule: evaluated
      });
      return;
    } catch (err) {
      console.error('Error saving portal schedule:', err);
      sendJson(res, 500, { success: false, message: 'Server error updating portal schedule' });
      return;
    }
  }

  sendJson(res, 404, { success: false, message: 'API route not found: ' + reqPath });
};
