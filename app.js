/**
 * EDUCARE ACADEMY - CBSE CLASS 10TH SCIENCE ASSESSMENT ENGINE
 * - Dynamic NCERT CBSE Class 10 Science Chapter Tests (25 MCQs / 25 Marks)
 * - Strict 1-Attempt Verification & Authorized Student Roster
 * - Real-Time AI Proctoring Surveillance & Tab-Switch Auditing
 * - Real-Time Examiner Lock Listener (Instant Warning Popup on Admin Lock)
 * - Automatic Scorecard, Solutions Review & Printable Marksheet
 */

(function () {
  'use strict';

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // State Management
  const state = {
    config: null,
    chapter: null,
    questions: [],
    currentIndex: 0,
    answers: [],
    reviewed: [],
    visited: [],
    student: {
      name: '',
      roll: '',
      password: '',
      photoUrl: ''
    },
    language: 'en', // 'en' or 'hi'
    timer: {
      totalSeconds: 25 * 60,
      remainingSeconds: 25 * 60,
      intervalId: null
    },
    proctoring: {
      stream: null,
      videoElement: null,
      photoBase64: '',
      violations: 0,
      maxViolations: 3,
      isExamActive: false,
      isExaminerLocked: false,
      schedulePollInterval: null,
      mediaRecorder: null,
      recordedChunks: [],
      snapshotIntervalId: null
    },
    submitted: false
  };

  // DOM Elements Cache
  const dom = {
    // Header
    headerPortalDot: document.getElementById('headerPortalDot'),
    headerPortalTxt: document.getElementById('headerPortalTxt'),
    headerActiveChapter: document.getElementById('headerActiveChapter'),
    headerSecurityStatus: document.getElementById('headerSecurityStatus'),

    // Screens
    welcomeScreen: document.getElementById('welcomeInstructionsScreen'),
    registrationScreen: document.getElementById('registrationScreen'),
    examScreen: document.getElementById('examScreen'),
    resultScreen: document.getElementById('resultScreen'),

    // Welcome Step
    agreeWelcomeCheckbox: document.getElementById('agreeWelcomeCheckbox'),
    btnProceedToLogin: document.getElementById('btnProceedToLogin'),
    portalScheduleCountdown: document.getElementById('portalScheduleCountdown'),

    // Registration Step
    candName: document.getElementById('candName'),
    candRoll: document.getElementById('candRoll'),
    candPassword: document.getElementById('candPassword'),
    btnTogglePassword: document.getElementById('btnTogglePassword'),
    pwdEyeIcon: document.getElementById('pwdEyeIcon'),
    formValidationError: document.getElementById('formValidationError'),
    summaryChapterName: document.getElementById('summaryChapterName'),
    setupVideoFeed: document.getElementById('setupVideoFeed'),
    videoStatusOverlay: document.getElementById('videoStatusOverlay'),
    cameraStatusText: document.getElementById('cameraStatusText'),
    btnRequestMedia: document.getElementById('btnRequestMedia'),
    btnCapturePhoto: document.getElementById('btnCapturePhoto'),
    photoCapturePreviewBox: document.getElementById('photoCapturePreviewBox'),
    capturedCandidatePhoto: document.getElementById('capturedCandidatePhoto'),
    chkCamera: document.getElementById('chkCamera'),
    chkPhoto: document.getElementById('chkPhoto'),
    chkPhotoDesc: document.getElementById('chkPhotoDesc'),
    chkMic: document.getElementById('chkMic'),
    agreeTermsCheckbox: document.getElementById('agreeTermsCheckbox'),
    btnStartExam: document.getElementById('btnStartExam'),

    // Exam Step
    examActiveChapterPill: document.getElementById('examActiveChapterPill'),
    timerDisplay: document.getElementById('timerDisplay'),
    timerWrapper: document.getElementById('timerWrapper'),
    qNumberBadge: document.getElementById('qNumberBadge'),
    btnLangEn: document.getElementById('btnLangEn'),
    btnLangHi: document.getElementById('btnLangHi'),
    questionText: document.getElementById('questionText'),
    optionsGrid: document.getElementById('optionsGrid'),
    btnMarkReview: document.getElementById('btnMarkReview'),
    btnClearResponse: document.getElementById('btnClearResponse'),
    btnPrevQuestion: document.getElementById('btnPrevQuestion'),
    btnSaveNext: document.getElementById('btnSaveNext'),
    btnOpenSubmitModal: document.getElementById('btnOpenSubmitModal'),
    liveExamVideoFeed: document.getElementById('liveExamVideoFeed'),
    sidebarStudentName: document.getElementById('sidebarStudentName'),
    sidebarStudentRoll: document.getElementById('sidebarStudentRoll'),
    violationCounter: document.getElementById('violationCounter'),
    violationCount: document.getElementById('violationCount'),
    questionPaletteGrid: document.getElementById('questionPaletteGrid'),

    // Result Step
    resStudentName: document.getElementById('resStudentName'),
    resStudentRoll: document.getElementById('resStudentRoll'),
    resChapterName: document.getElementById('resChapterName'),
    resSubmitTime: document.getElementById('resSubmitTime'),
    resScoreVal: document.getElementById('resScoreVal'),
    resPercentageVal: document.getElementById('resPercentageVal'),
    resStatusBadge: document.getElementById('resStatusBadge'),
    resFeedbackText: document.getElementById('resFeedbackText'),
    resCorrectCount: document.getElementById('resCorrectCount'),
    resIncorrectCount: document.getElementById('resIncorrectCount'),
    resUnattemptedCount: document.getElementById('resUnattemptedCount'),
    resTimeTakenVal: document.getElementById('resTimeTakenVal'),
    solutionsList: document.getElementById('solutionsList'),

    // Modals
    examinerLockOverlay: document.getElementById('examinerLockOverlay'),
    examinerLockMsg: document.getElementById('examinerLockMsg'),
    earlySubmitModalOverlay: document.getElementById('earlySubmitModalOverlay'),
    submitModalStatsText: document.getElementById('submitModalStatsText'),
    btnCancelSubmitModal: document.getElementById('btnCancelSubmitModal'),
    btnConfirmSubmitModal: document.getElementById('btnConfirmSubmitModal')
  };

  // --- INITIALIZATION ---
  async function initApp() {
    // Explicitly reset form fields to ensure no cached or autofilled values appear
    if (dom.candName) dom.candName.value = '';
    if (dom.candRoll) dom.candRoll.value = '';
    if (dom.candPassword) dom.candPassword.value = '';
    if (dom.agreeTermsCheckbox) dom.agreeTermsCheckbox.checked = false;

    setupEventListeners();
    await loadExamConfiguration();
    await loadQuestions();
    startPortalScheduleHeartbeat();
    validateRegistrationForm();

    // Check if user came via direct result link e.g. /?result=26CBSEBRD001 or /?roll=001
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const queryRoll = urlParams.get('result') || urlParams.get('roll') || urlParams.get('scorecard');
      if (queryRoll) {
        fetch('/api/student-result?roll=' + encodeURIComponent(queryRoll))
          .then(r => r.json())
          .then(data => {
            if (data.success && data.record) {
              window.displayCompletedRecord(data.record);
            }
          })
          .catch(() => {});
      }
    } catch(e) {}
  }

  // Fetch initial config & active chapter
  async function loadExamConfiguration() {
    try {
      const res = await fetch('/api/exam-config');
      if (!res.ok) throw new Error('Failed to load exam config');
      const data = await res.json();
      state.config = data;

      if (data.activeChapter) {
        if (dom.headerActiveChapter) {
          dom.headerActiveChapter.textContent = data.activeChapter.name || 'Science Assessment';
        }
        if (dom.summaryChapterName) {
          dom.summaryChapterName.textContent = data.activeChapter.name || 'CBSE 10th Science';
        }
        if (dom.examActiveChapterPill) {
          dom.examActiveChapterPill.textContent = `Chapter ${data.activeChapter.id}: ${data.activeChapter.name}`;
        }
      }

      if (data.portalSchedule) {
        updatePortalStatusUI(data.portalSchedule);
      }
    } catch (err) {
      console.warn('Could not load /api/exam-config:', err);
    }
  }

  // Deterministic Anti-Cheating Question Shuffler (seeded by Student Roll)
  function shuffleQuestionsByRoll(questionsList, rollStr) {
    if (!Array.isArray(questionsList) || questionsList.length <= 1) return questionsList;
    const str = String(rollStr || Date.now());
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

  // Fetch 25 science questions for active chapter
  async function loadQuestions() {
    try {
      const rollParam = state.student && state.student.roll ? `?roll=${encodeURIComponent(state.student.roll)}` : '';
      const res = await fetch('/api/science-questions' + rollParam);
      if (!res.ok) throw new Error('Failed to fetch science questions');
      const data = await res.json();
      
      state.chapter = data.chapter;
      state.questions = (data.testQuestions && data.testQuestions.length) 
        ? data.testQuestions 
        : (data.fullPool || []).slice(0, 25);

      if (state.student && state.student.roll && !data.isShuffled) {
        state.questions = shuffleQuestionsByRoll(state.questions, state.student.roll);
      }

      state.answers = new Array(state.questions.length).fill(null);
      state.reviewed = new Array(state.questions.length).fill(false);
      state.visited = new Array(state.questions.length).fill(false);

      if (state.chapter && dom.headerActiveChapter) {
        dom.headerActiveChapter.textContent = state.chapter.name;
      }
    } catch (err) {
      console.error('Error fetching questions:', err);
      dom.questionText.textContent = 'Failed to load test questions. Please refresh or contact your teacher.';
    }
  }

  // --- REAL-TIME EXAMINER LOCK & PORTAL SCHEDULE HEARTBEAT ---
  function startPortalScheduleHeartbeat() {
    async function checkSchedule() {
      try {
        const res = await fetch('/api/portal-schedule?t=' + Date.now());
        if (!res.ok) return;
        const sched = await res.json();
        updatePortalStatusUI(sched);

        // Check if Admin has locked the examination panel during live test
        if (sched && (!sched.isOpen || sched.status !== 'OPEN' || sched.isManuallyClosed)) {
          triggerExaminerLockPopup(sched);
        } else {
          releaseExaminerLockPopup();
        }
      } catch (e) {
        // network glitch
      }
    }

    checkSchedule();
    state.proctoring.schedulePollInterval = setInterval(checkSchedule, 10000);
  }

  function updatePortalStatusUI(sched) {
    if (!sched) return;
    const isOpen = sched.isOpen && sched.status === 'OPEN';

    if (dom.headerPortalDot && dom.headerPortalTxt) {
      if (isOpen) {
        dom.headerPortalDot.style.background = '#10B981';
        dom.headerPortalTxt.textContent = `Portal Open • Deadline: ${sched.deadlineFormatted || '31 Dec 2026'}`;
      } else {
        dom.headerPortalDot.style.background = '#EF4444';
        dom.headerPortalTxt.textContent = 'Portal Locked / Concluded';
      }
    }

    if (dom.portalScheduleCountdown) {
      if (sched.timeRemainingMs > 0 && isOpen) {
        const hours = Math.floor(sched.timeRemainingMs / (1000 * 60 * 60));
        const mins = Math.floor((sched.timeRemainingMs % (1000 * 60 * 60)) / (1000 * 60));
        dom.portalScheduleCountdown.textContent = `${hours}h ${mins}m`;
      } else if (!isOpen) {
        dom.portalScheduleCountdown.textContent = 'Closed by Examiner';
      }
    }
  }

  function triggerExaminerLockPopup(sched) {
    state.proctoring.isExaminerLocked = true;
    if (dom.examinerLockOverlay) {
      dom.examinerLockOverlay.classList.add('active');
    }
    if (dom.examinerLockMsg) {
      dom.examinerLockMsg.textContent = sched.closedMessage || 
        'Educare Academy examination portal has been locked by the examiner. All student assessment sessions are currently paused.';
    }
  }

  function releaseExaminerLockPopup() {
    if (state.proctoring.isExaminerLocked) {
      state.proctoring.isExaminerLocked = false;
      if (dom.examinerLockOverlay) {
        dom.examinerLockOverlay.classList.remove('active');
      }
    }
  }

  // --- STEP SWITCHING ---
  function showScreen(screenEl) {
    [dom.welcomeScreen, dom.registrationScreen, dom.examScreen, dom.resultScreen].forEach(s => {
      if (s) s.classList.remove('active');
    });
    if (screenEl) screenEl.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // --- EVENT LISTENERS ---
  function setupEventListeners() {
    // Step 0: Welcome Instructions
    if (dom.agreeWelcomeCheckbox && dom.btnProceedToLogin) {
      dom.agreeWelcomeCheckbox.addEventListener('change', () => {
        dom.btnProceedToLogin.disabled = !dom.agreeWelcomeCheckbox.checked;
        const helpNote = document.getElementById('welcomeHelpNote');
        if (helpNote) helpNote.style.display = dom.agreeWelcomeCheckbox.checked ? 'none' : 'block';
      });

      dom.btnProceedToLogin.addEventListener('click', () => {
        showScreen(dom.registrationScreen);
      });
    }

    // Toggle Password Visibility
    if (dom.btnTogglePassword && dom.candPassword) {
      dom.btnTogglePassword.addEventListener('click', () => {
        const isPwd = dom.candPassword.type === 'password';
        dom.candPassword.type = isPwd ? 'text' : 'password';
        if (dom.pwdEyeIcon) dom.pwdEyeIcon.textContent = isPwd ? '🙈' : '👁';
      });
    }

    // Request Webcam
    if (dom.btnRequestMedia) {
      dom.btnRequestMedia.addEventListener('click', startWebcamVerification);
    }

    // Capture Candidate Photo
    if (dom.btnCapturePhoto) {
      dom.btnCapturePhoto.addEventListener('click', handleCaptureCandidatePhoto);
    }

    // Agreement checkbox on Registration Screen
    if (dom.agreeTermsCheckbox && dom.btnStartExam) {
      dom.agreeTermsCheckbox.addEventListener('change', validateRegistrationForm);
    }
    if (dom.candName) dom.candName.addEventListener('input', validateRegistrationForm);
    if (dom.candRoll) dom.candRoll.addEventListener('input', validateRegistrationForm);
    if (dom.candPassword) dom.candPassword.addEventListener('input', validateRegistrationForm);

    // Start Exam Button
    if (dom.btnStartExam) {
      dom.btnStartExam.addEventListener('click', handleStartExam);
    }

    // Language Toggle
    if (dom.btnLangEn && dom.btnLangHi) {
      dom.btnLangEn.addEventListener('click', () => {
        state.language = 'en';
        dom.btnLangEn.classList.add('active');
        dom.btnLangHi.classList.remove('active');
        renderCurrentQuestion();
      });
      dom.btnLangHi.addEventListener('click', () => {
        state.language = 'hi';
        dom.btnLangHi.classList.add('active');
        dom.btnLangEn.classList.remove('active');
        renderCurrentQuestion();
      });
    }

    // Nav Toolbar Buttons
    if (dom.btnPrevQuestion) {
      dom.btnPrevQuestion.addEventListener('click', () => {
        if (state.currentIndex > 0) {
          state.currentIndex--;
          renderCurrentQuestion();
        }
      });
    }
    if (dom.btnSaveNext) {
      dom.btnSaveNext.addEventListener('click', () => {
        if (state.currentIndex < state.questions.length - 1) {
          state.currentIndex++;
          renderCurrentQuestion();
        } else {
          // Last question -> open submit confirmation
          openSubmitModal();
        }
      });
    }
    if (dom.btnMarkReview) {
      dom.btnMarkReview.addEventListener('click', () => {
        state.reviewed[state.currentIndex] = !state.reviewed[state.currentIndex];
        renderCurrentQuestion();
        renderQuestionPalette();
      });
    }
    if (dom.btnClearResponse) {
      dom.btnClearResponse.addEventListener('click', () => {
        state.answers[state.currentIndex] = null;
        renderCurrentQuestion();
        renderQuestionPalette();
      });
    }
    if (dom.btnOpenSubmitModal) {
      dom.btnOpenSubmitModal.addEventListener('click', openSubmitModal);
    }

    // Early Submit Modal
    if (dom.btnCancelSubmitModal && dom.earlySubmitModalOverlay) {
      dom.btnCancelSubmitModal.addEventListener('click', () => {
        dom.earlySubmitModalOverlay.style.display = 'none';
      });
    }
    if (dom.btnConfirmSubmitModal) {
      dom.btnConfirmSubmitModal.addEventListener('click', () => {
        if (dom.earlySubmitModalOverlay) dom.earlySubmitModalOverlay.style.display = 'none';
        submitAssessment(false);
      });
    }

    // Close / Cut button on Tab Cancel Popup -> Redirect to Main Menu
    const btnTabCancelClose = document.getElementById('btnTabCancelClose');
    if (btnTabCancelClose) {
      btnTabCancelClose.addEventListener('click', () => {
        window.location.href = '/';
      });
    }

    // Return to Main Menu button on Tab Cancel Popup
    const btnReturnMainMenu = document.getElementById('btnReturnMainMenu');
    if (btnReturnMainMenu) {
      btnReturnMainMenu.addEventListener('click', () => {
        window.location.href = '/';
      });
    }

    // Anti-Cheating & Tab Switching Auditing
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
  }

  // --- WEBCAM & PROCTORING VERIFICATION ---
  async function startWebcamVerification() {
    try {
      if (state.proctoring.stream) {
        state.proctoring.stream.getTracks().forEach(t => t.stop());
      }

      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: true
        });
      } catch (audioErr) {
        console.warn('Audio device unavailable or permission denied, falling back to video-only stream:', audioErr);
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
        });
      }

      state.proctoring.stream = stream;
      if (dom.setupVideoFeed) {
        dom.setupVideoFeed.srcObject = stream;
        dom.setupVideoFeed.play().catch(() => {});
      }
      if (dom.videoStatusOverlay) dom.videoStatusOverlay.style.display = 'none';
      if (dom.chkCamera) {
        dom.chkCamera.querySelector('.check-icon').textContent = '✔';
        dom.chkCamera.querySelector('.check-icon').style.color = '#10B981';
      }
      if (dom.chkMic) {
        dom.chkMic.querySelector('.check-icon').textContent = '✔';
        dom.chkMic.querySelector('.check-icon').style.color = '#10B981';
      }
      if (dom.btnRequestMedia) {
        dom.btnRequestMedia.textContent = '✔ Camera & Surveillance Active';
        dom.btnRequestMedia.style.background = '#059669';
        dom.btnRequestMedia.disabled = true;
      }

      // Reveal photo capture button now that stream is live
      if (dom.btnCapturePhoto) {
        dom.btnCapturePhoto.style.display = 'block';
      }

      validateRegistrationForm();
    } catch (err) {
      console.warn('Camera access denied or error:', err);
      alert('Camera access is required for Educare Academy proctored tests. Please allow camera permissions.');
    }
  }

  // Explicit Candidate Photo Capture
  function handleCaptureCandidatePhoto() {
    try {
      if (!dom.setupVideoFeed || !state.proctoring.stream) {
        alert('Please enable camera stream first.');
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(dom.setupVideoFeed, 0, 0, 320, 240);
      const photoData = canvas.toDataURL('image/jpeg', 0.85);

      state.proctoring.photoCaptured = true;
      state.proctoring.photoBase64 = photoData;
      state.student.photoUrl = photoData;

      if (dom.capturedCandidatePhoto) {
        dom.capturedCandidatePhoto.src = photoData;
      }
      if (dom.photoCapturePreviewBox) {
        dom.photoCapturePreviewBox.style.display = 'block';
      }
      if (dom.btnCapturePhoto) {
        dom.btnCapturePhoto.innerHTML = '🔄 Retake Photo (दोबारा फोटो खींचें)';
        dom.btnCapturePhoto.style.background = '#2563EB';
        dom.btnCapturePhoto.style.borderColor = '#2563EB';
      }
      if (dom.chkPhoto) {
        dom.chkPhoto.querySelector('.check-icon').textContent = '✔';
        dom.chkPhoto.querySelector('.check-icon').style.color = '#10B981';
        if (dom.chkPhotoDesc) {
          dom.chkPhotoDesc.textContent = 'Candidate Photo Captured & Verified';
        }
      }
      validateRegistrationForm();
    } catch (e) {
      console.warn('Photo capture error:', e);
    }
  }

  // Validate form fields
  function validateRegistrationForm() {
    const name = (dom.candName ? dom.candName.value : '').trim();
    const roll = (dom.candRoll ? dom.candRoll.value : '').trim();
    const pwd = (dom.candPassword ? dom.candPassword.value : '').trim();
    const agreed = dom.agreeTermsCheckbox ? dom.agreeTermsCheckbox.checked : false;

    const isValid = name.length >= 2 && roll.length >= 1 && pwd.length >= 1 && agreed;
    if (dom.btnStartExam) dom.btnStartExam.disabled = !isValid;
    return isValid;
  }

  // --- LOGIN VERIFICATION & TEST START ---
  async function handleStartExam() {
    const name = dom.candName.value.trim();
    const roll = dom.candRoll.value.trim();
    const password = dom.candPassword.value.trim();

    dom.formValidationError.style.display = 'none';

    // Ensure camera & photo capture are taken
    if (!state.proctoring.stream) {
      dom.formValidationError.textContent = '⚠ Camera & Candidate Photo are mandatory. Please click "Enable Camera Stream" and capture your photo before proceeding.';
      dom.formValidationError.style.display = 'block';
      if (dom.btnRequestMedia) dom.btnRequestMedia.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    if (!state.proctoring.photoCaptured) {
      // Auto-capture candidate photo from active stream
      handleCaptureCandidatePhoto();
    }

    dom.btnStartExam.disabled = true;
    dom.btnStartExam.textContent = 'Verifying Student Roster...';

    try {
      const candidatePhoto = state.student.photoUrl || state.proctoring.photoBase64 || '';
      const res = await fetch('/api/verify-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, roll, password, photoUrl: candidatePhoto })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        dom.formValidationError.textContent = data.message || 'Login verification failed.';
        dom.formValidationError.style.display = 'block';
        dom.btnStartExam.disabled = false;
        dom.btnStartExam.innerHTML = '&#128640; PROCEED TO TEST &amp; START EXAM &rarr;';
        return;
      }

      // If student has already completed today's assessment, show instant result button!
      if (data.alreadyCompleted) {
        window._lastCompletedRecord = data.record || {
          roll: data.normalizedRoll || roll,
          name: data.studentName || name,
          score: data.score,
          total: data.total || 25,
          percentage: data.percentage,
          completedAt: data.completedAt
        };
        dom.formValidationError.innerHTML = `
          <div style="background: #ECFDF5; border: 1.5px solid #10B981; border-radius: 8px; padding: 14px; text-align: left; margin-top: 6px;">
            <div style="font-size: 14px; font-weight: 800; color: #065F46; margin-bottom: 4px;">
              &#10004; Aapne Aaj Ki Exam Already Complete Kar Li Hai!
            </div>
            <div style="font-size: 12.5px; color: #047857; margin-bottom: 12px; line-height: 1.45;">
              Candidate: <strong>${escapeHtml(data.studentName || name)}</strong> (${escapeHtml(data.normalizedRoll || roll)})<br>
              Marks: <strong>${data.score ?? 0} / ${data.total || 25}</strong> (${data.percentage || ''}%) &bull; Submitted: ${escapeHtml(data.completedAt || 'Today')}
            </div>
            <button type="button" onclick="window.displayCompletedRecord(window._lastCompletedRecord)" class="btn-primary" style="width: 100%; background: #16A34A; border: none; padding: 11px; font-weight: 700; font-size: 13.5px; cursor: pointer; border-radius: 6px; box-shadow: 0 2px 4px rgba(22,163,74,0.3);">
              &#128424; View &amp; Print Official Marksheet / Result &rarr;
            </button>
            <div style="font-size: 11.5px; color: #475569; margin-top: 8px; text-align: center;">
              Dobara exam dene ke liye apne teacher (+91 8448467381) se attempt reset karwayen.
            </div>
          </div>
        `;
        dom.formValidationError.style.display = 'block';
        dom.btnStartExam.disabled = false;
        dom.btnStartExam.innerHTML = '&#128640; PROCEED TO TEST &amp; START EXAM &rarr;';
        return;
      }

      // Login Verified!
      if (state.proctoring.schedulePollInterval) {
        clearInterval(state.proctoring.schedulePollInterval);
        state.proctoring.schedulePollInterval = null;
      }
      state.student.name = data.studentName || name;
      state.student.roll = data.normalizedRoll || roll;
      state.student.password = password;

      // Anti-Cheating: Scramble/Jumble the 25 questions uniquely for this student's roll number!
      if (state.questions && state.questions.length > 0) {
        state.questions = shuffleQuestionsByRoll(state.questions, state.student.roll);
        state.answers = new Array(state.questions.length).fill(null);
        state.reviewed = new Array(state.questions.length).fill(false);
        state.visited = new Array(state.questions.length).fill(false);
      }

      // Ensure snapshot captured
      captureCandidateSnapshot();

      // Enter fullscreen if possible
      try {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } catch (e) {}

      // Switch to exam screen
      startExamSession();
    } catch (err) {
      console.error('Login error:', err);
      dom.formValidationError.textContent = 'Server connection error. Please try again.';
      dom.formValidationError.style.display = 'block';
      dom.btnStartExam.disabled = false;
      dom.btnStartExam.innerHTML = '&#128640; PROCEED TO TEST &amp; START EXAM &rarr;';
    }
  }

  function captureCandidateSnapshot() {
    try {
      const videoSource = (dom.setupVideoFeed && dom.setupVideoFeed.srcObject) ? dom.setupVideoFeed : dom.liveExamVideoFeed;
      if (!videoSource || !state.proctoring.stream) return;
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoSource, 0, 0, 320, 240);
      state.proctoring.photoBase64 = canvas.toDataURL('image/jpeg', 0.85);
      state.student.photoUrl = state.proctoring.photoBase64;
    } catch (e) {
      console.warn('Snapshot capture error:', e);
    }
  }

  // --- START EXAM SESSION ---
  function startExamSession() {
    state.proctoring.isExamActive = true;
    showScreen(dom.examScreen);

    // Update Sidebar
    if (dom.sidebarStudentName) dom.sidebarStudentName.textContent = state.student.name;
    if (dom.sidebarStudentRoll) dom.sidebarStudentRoll.textContent = state.student.roll;

    // Attach stream to background video feed without using display:none (which pauses frame decoding)
    if (dom.liveExamVideoFeed && state.proctoring.stream) {
      dom.liveExamVideoFeed.srcObject = state.proctoring.stream;
      dom.liveExamVideoFeed.style.display = 'block';
      dom.liveExamVideoFeed.style.position = 'fixed';
      dom.liveExamVideoFeed.style.top = '-9999px';
      dom.liveExamVideoFeed.style.left = '-9999px';
      dom.liveExamVideoFeed.style.width = '320px';
      dom.liveExamVideoFeed.style.height = '240px';
      dom.liveExamVideoFeed.style.opacity = '0';
      dom.liveExamVideoFeed.style.pointerEvents = 'none';
      dom.liveExamVideoFeed.play().catch(() => {});
    }

    // Immediately transmit START heartbeat with candidate verification photo to Admin Panel
    try {
      const startPhoto = state.student.photoUrl || state.proctoring.photoBase64 || '';
      fetch('/api/exam-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roll: state.student.roll,
          name: state.student.name,
          type: 'START',
          photoUrl: startPhoto
        })
      }).catch(() => {});
    } catch (e) {}

    // Start continuous compressed proctoring video recording & snapshots
    startProctoringVideoRecording();

    // Initialize timer
    startCountdownTimer();

    // Render first question & palette
    state.currentIndex = 0;
    renderCurrentQuestion();
    renderQuestionPalette();
  }

  // --- TIMER ---
  function startCountdownTimer() {
    state.timer.remainingSeconds = 25 * 60; // 25 Minutes
    updateTimerDisplay();

    state.timer.intervalId = setInterval(() => {
      // If locked by examiner, pause timer countdown
      if (state.proctoring.isExaminerLocked) return;

      state.timer.remainingSeconds--;
      updateTimerDisplay();

      if (state.timer.remainingSeconds <= 0) {
        clearInterval(state.timer.intervalId);
        alert('Time is up! Your 25-minute test will now be submitted automatically.');
        submitAssessment(true);
      }
    }, 1000);
  }

  function updateTimerDisplay() {
    if (!dom.timerDisplay) return;
    const mins = Math.floor(state.timer.remainingSeconds / 60);
    const secs = state.timer.remainingSeconds % 60;
    const str = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    dom.timerDisplay.textContent = str;

    if (state.timer.remainingSeconds < 300) { // under 5 min
      if (dom.timerWrapper) dom.timerWrapper.style.background = '#FEF2F2';
      dom.timerDisplay.style.color = '#DC2626';
    }
  }

  // --- QUESTION RENDERING ---
  function renderCurrentQuestion() {
    if (!state.questions || state.questions.length === 0) {
      dom.questionText.textContent = 'Loading questions...';
      return;
    }

    const q = state.questions[state.currentIndex];
    state.visited[state.currentIndex] = true;

    // Meta Badge
    if (dom.qNumberBadge) {
      dom.qNumberBadge.textContent = `Question ${state.currentIndex + 1} of ${state.questions.length}`;
    }

    // Question Text (Bilingual)
    const isHindi = state.language === 'hi';
    const mainText = (isHindi && q.textHindi) ? q.textHindi : q.text;
    const altText = (isHindi && q.text) ? q.text : (q.textHindi || '');

    dom.questionText.innerHTML = `
      <div style="font-size: 16px; font-weight: 700; color: #0F172A; line-height: 1.5;">
        ${state.currentIndex + 1}. ${mainText}
      </div>
      ${altText ? `<div style="font-size: 13.5px; color: #64748B; margin-top: 6px; font-style: italic;">${altText}</div>` : ''}
    `;

    // Render Options
    dom.optionsGrid.innerHTML = '';
    const currentAns = state.answers[state.currentIndex];

    (q.options || []).forEach((opt, idx) => {
      const optKey = opt.key || String.fromCharCode(65 + idx);
      const optText = isHindi && opt.hindi ? opt.hindi : opt.text;
      const isSelected = currentAns === idx;

      const optBtn = document.createElement('button');
      optBtn.type = 'button';
      optBtn.className = `option-item ${isSelected ? 'selected' : ''}`;
      optBtn.innerHTML = `
        <span class="option-key-badge">${optKey}</span>
        <span class="option-label-text">${optText}</span>
      `;

      optBtn.addEventListener('click', () => {
        state.answers[state.currentIndex] = idx;
        renderCurrentQuestion();
        renderQuestionPalette();
      });

      dom.optionsGrid.appendChild(optBtn);
    });

    // Button states
    if (dom.btnPrevQuestion) {
      dom.btnPrevQuestion.disabled = state.currentIndex === 0;
    }
    if (dom.btnSaveNext) {
      dom.btnSaveNext.textContent = (state.currentIndex === state.questions.length - 1) 
        ? 'Review & Submit Test ✔' 
        : 'Save & Next →';
    }
    if (dom.btnMarkReview) {
      const isRev = state.reviewed[state.currentIndex];
      dom.btnMarkReview.style.background = isRev ? '#FEF3C7' : '#F1F5F9';
      dom.btnMarkReview.style.color = isRev ? '#92400E' : '#475569';
    }

    renderQuestionPalette();
  }

  // --- QUESTION PALETTE ---
  function renderQuestionPalette() {
    if (!dom.questionPaletteGrid || !state.questions) return;
    dom.questionPaletteGrid.innerHTML = '';

    state.questions.forEach((q, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = idx + 1;
      btn.className = 'palette-btn';

      const isCurrent = idx === state.currentIndex;
      const isAnswered = state.answers[idx] !== null;
      const isReviewed = state.reviewed[idx];
      const isVisited = state.visited[idx];

      if (isCurrent) btn.classList.add('current');
      if (isAnswered) btn.classList.add('answered');
      else if (isReviewed) btn.classList.add('review');
      else if (isVisited) btn.classList.add('unanswered');
      else btn.classList.add('unvisited');

      btn.addEventListener('click', () => {
        state.currentIndex = idx;
        renderCurrentQuestion();
      });

      dom.questionPaletteGrid.appendChild(btn);
    });
  }

  // --- SUBMIT CONFIRMATION MODAL ---
  function openSubmitModal() {
    const answeredCount = state.answers.filter(a => a !== null).length;
    const unansweredCount = state.questions.length - answeredCount;
    const reviewedCount = state.reviewed.filter(Boolean).length;

    if (dom.submitModalStatsText) {
      dom.submitModalStatsText.innerHTML = `
        You have answered <strong>${answeredCount}</strong> out of <strong>${state.questions.length}</strong> questions.<br>
        Unattempted: <strong>${unansweredCount}</strong> | Marked for Review: <strong>${reviewedCount}</strong>.<br><br>
        Are you sure you want to finish and submit your test now?
      `;
    }
    if (dom.earlySubmitModalOverlay) {
      dom.earlySubmitModalOverlay.style.display = 'flex';
    }
  }

  // --- SUBMIT ASSESSMENT ---
  async function submitAssessment(isAutoSubmit = false) {
    if (state.submitted) return;
    state.submitted = true;
    state.proctoring.isExamActive = false;

    if (state.timer.intervalId) clearInterval(state.timer.intervalId);

    // Calculate score & construct full solutions array for permanent marksheet
    let score = 0;
    const solutions = [];
    const optionLetters = ['A', 'B', 'C', 'D'];

    state.questions.forEach((q, idx) => {
      const chosen = state.answers[idx];
      const isCorrect = chosen !== null && chosen === q.correctAnswer;
      if (isCorrect) score += 1;

      const userOptText = (chosen !== null && q.options && q.options[chosen] !== undefined)
        ? (typeof q.options[chosen] === 'object' ? q.options[chosen].text : q.options[chosen])
        : 'Not Attempted';
      const userOptHindi = (chosen !== null && q.options && q.options[chosen] && typeof q.options[chosen] === 'object')
        ? q.options[chosen].hindi || ''
        : '';
      const correctOptText = (q.options && q.options[q.correctAnswer] !== undefined)
        ? (typeof q.options[q.correctAnswer] === 'object' ? q.options[q.correctAnswer].text : q.options[q.correctAnswer])
        : '';
      const correctOptHindi = (q.options && q.options[q.correctAnswer] && typeof q.options[q.correctAnswer] === 'object')
        ? q.options[q.correctAnswer].hindi || ''
        : '';

      solutions.push({
        qIndex: idx + 1,
        section: q.section || 'A',
        questionText: q.text || '',
        questionHindi: q.textHindi || '',
        userAnswerIndex: chosen,
        userAnswerLetter: chosen !== null ? (optionLetters[chosen] || String.fromCharCode(65 + chosen)) : '-',
        userAnswerText: chosen !== null ? `(${optionLetters[chosen] || 'A'}) ${userOptText}` : 'Not Attempted',
        userAnswerHindi: userOptHindi,
        correctAnswerIndex: q.correctAnswer,
        correctAnswerLetter: optionLetters[q.correctAnswer] || 'A',
        correctAnswerText: `(${optionLetters[q.correctAnswer] || 'A'}) ${correctOptText}`,
        correctAnswerHindi: correctOptHindi,
        isCorrect: isCorrect,
        explanation: q.explanation || ''
      });
    });

    const total = state.questions.length || 25;
    const percentage = ((score / total) * 100).toFixed(1);
    const timeSpentSec = Math.max(0, (25 * 60) - state.timer.remainingSeconds);
    const minsTaken = Math.floor(timeSpentSec / 60);
    const secsTaken = timeSpentSec % 60;
    const timeTakenStr = `${String(minsTaken).padStart(2, '0')}:${String(secsTaken).padStart(2, '0')}`;

    // 1. Immediately render result scorecard for candidate without blocking
    renderResultScorecard(score, total, percentage, timeTakenStr);

    // 2. Post record with solutions to server
    try {
      fetch('/api/complete-exam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roll: state.student.roll,
          name: state.student.name,
          score: score,
          total: total,
          percentage: percentage,
          correctCount: score,
          incorrectCount: (state.answers.filter(a => a !== null).length) - score,
          skippedCount: total - (state.answers.filter(a => a !== null).length),
          timeSpentSeconds: timeSpentSec,
          timeSpentFormatted: timeTakenStr,
          timeTaken: timeTakenStr,
          status: score >= (total * 0.4) ? 'QUALIFIED' : 'NEEDS PRACTICE',
          photoUrl: state.student.photoUrl || '',
          violations: state.proctoring.violations,
          chapterId: state.chapter ? state.chapter.id : 1,
          chapterName: state.chapter ? state.chapter.name : 'Chemical Reactions and Equations',
          chapterHindi: state.chapter ? state.chapter.hindi : '',
          solutions: solutions
        })
      }).catch(e => console.warn('Complete exam err:', e));
    } catch (e) {
      console.warn('Could not record complete-exam on server:', e);
    }

    // 3. Stop proctoring video and upload compressed media in background
    try {
      stopAndUploadProctoringVideo().catch(e => console.warn('Video upload note:', e));
    } catch(e) {}
  }

  function renderResultScorecard(score, total, percentage, timeTakenStr) {
    showScreen(dom.resultScreen);

    if (dom.resStudentName) dom.resStudentName.textContent = state.student.name;
    if (dom.resStudentRoll) dom.resStudentRoll.textContent = state.student.roll;
    
    // Password for front page printout
    const resStudentPassword = document.getElementById('resStudentPassword');
    if (resStudentPassword) resStudentPassword.textContent = state.student.password || 'Edu@26';

    // Header info for page 2+ question paper print
    const qpPrintStudentName = document.getElementById('qpPrintStudentName');
    if (qpPrintStudentName) qpPrintStudentName.textContent = state.student.name || '-';
    const qpPrintStudentRoll = document.getElementById('qpPrintStudentRoll');
    if (qpPrintStudentRoll) qpPrintStudentRoll.textContent = state.student.roll || '-';

    if (dom.resChapterName) {
      dom.resChapterName.textContent = state.chapter 
        ? `${state.chapter.name} (${state.chapter.hindi || ''})` 
        : 'CBSE Class 10th Science';
    }
    if (dom.resSubmitTime) {
      dom.resSubmitTime.textContent = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
    }

    if (dom.resScoreVal) dom.resScoreVal.textContent = score;
    if (dom.resPercentageVal) dom.resPercentageVal.textContent = `${percentage}%`;

    const answered = state.answers.filter(a => a !== null).length;
    const correct = score;
    const incorrect = answered - correct;
    const unattempted = total - answered;

    if (dom.resCorrectCount) dom.resCorrectCount.textContent = correct;
    if (dom.resIncorrectCount) dom.resIncorrectCount.textContent = incorrect;
    if (dom.resUnattemptedCount) dom.resUnattemptedCount.textContent = unattempted;
    if (dom.resTimeTakenVal) dom.resTimeTakenVal.textContent = timeTakenStr;

    // Status badge & feedback
    const pctNum = parseFloat(percentage);
    if (pctNum >= 80) {
      dom.resStatusBadge.textContent = 'EXCELLENT (A1)';
      dom.resStatusBadge.style.background = '#DCFCE7';
      dom.resStatusBadge.style.color = '#15803D';
      dom.resFeedbackText.textContent = 'Outstanding concept mastery! Keep up the brilliant preparation for CBSE Board exams.';
    } else if (pctNum >= 50) {
      dom.resStatusBadge.textContent = 'GOOD PROGRESS (B1)';
      dom.resStatusBadge.style.background = '#EFF6FF';
      dom.resStatusBadge.style.color = '#1D4ED8';
      dom.resFeedbackText.textContent = 'Good effort. Review the incorrect answers below to solidify your understanding.';
    } else {
      dom.resStatusBadge.textContent = 'NEEDS REVISION';
      dom.resStatusBadge.style.background = '#FEE2E2';
      dom.resStatusBadge.style.color = '#B91C1C';
      dom.resFeedbackText.textContent = 'Revise this NCERT chapter carefully and consult Sir at +91 8448467381 for doubt clearing.';
    }

    // Render Solutions Review
    renderSolutionsList();
  }

  function renderSolutionsList() {
    if (!dom.solutionsList || !state.questions) return;
    dom.solutionsList.innerHTML = '';

    const optionLetters = ['A', 'B', 'C', 'D'];

    state.questions.forEach((q, idx) => {
      const chosen = state.answers[idx];
      const correct = q.correctAnswer;
      const isCorrect = chosen === correct;
      const isUnanswered = chosen === null;

      const card = document.createElement('div');
      card.className = 'print-question-card';
      card.style.cssText = `
        background: #FFFFFF;
        border: 1.5px solid ${isCorrect ? '#86EFAC' : isUnanswered ? '#CBD5E1' : '#FCA5A5'};
        border-left: 6px solid ${isCorrect ? '#16A34A' : isUnanswered ? '#64748B' : '#DC2626'};
        border-radius: 8px;
        padding: 16px 18px;
        margin-bottom: 18px;
        page-break-inside: avoid;
        break-inside: avoid;
      `;

      // Build 4 Options HTML
      let optionsHtml = '';
      if (Array.isArray(q.options)) {
        optionsHtml = '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0;">';
        q.options.forEach((opt, optIdx) => {
          const optLetter = opt.key || optionLetters[optIdx] || String.fromCharCode(65 + optIdx);
          const optText = typeof opt === 'object' ? opt.text : opt;
          const optHindi = (typeof opt === 'object' && opt.hindi) ? opt.hindi : '';

          const isThisChosen = chosen === optIdx;
          const isThisCorrect = correct === optIdx;

          let optBorder = '#E2E8F0';
          let optBg = '#F8FAFC';
          let badge = '';

          if (isThisChosen && isThisCorrect) {
            optBorder = '#16A34A';
            optBg = '#DCFCE7';
            badge = '<span style="background: #16A34A; color: #FFFFFF; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 4px; margin-left: 6px;">✔ Your Choice (Correct)</span>';
          } else if (isThisChosen && !isThisCorrect) {
            optBorder = '#DC2626';
            optBg = '#FEE2E2';
            badge = '<span style="background: #DC2626; color: #FFFFFF; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 4px; margin-left: 6px;">✖ Your Choice (Incorrect)</span>';
          } else if (isThisCorrect) {
            optBorder = '#16A34A';
            optBg = '#F0FDF4';
            badge = '<span style="background: #059669; color: #FFFFFF; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 4px; margin-left: 6px;">✔ Official Correct Answer</span>';
          }

          optionsHtml += `
            <div style="border: 1.5px solid ${optBorder}; background: ${optBg}; border-radius: 6px; padding: 8px 10px; font-size: 13px; color: #1E293B; display: flex; align-items: flex-start; gap: 6px;">
              <strong style="color: #0F172A; min-width: 22px;">(${optLetter})</strong>
              <div style="flex: 1;">
                <div>${optText} ${badge}</div>
                ${optHindi ? `<div style="font-size: 12px; color: #64748B; margin-top: 2px;">${optHindi}</div>` : ''}
              </div>
            </div>
          `;
        });
        optionsHtml += '</div>';
      }

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
          <div>
            <strong style="font-size: 14.5px; color: #0F172A;">Question ${idx + 1} of ${state.questions.length}</strong>
            <span style="font-size: 12px; color: #64748B; margin-left: 8px;">(Marks: 1.00)</span>
          </div>
          <span style="font-weight: 800; font-size: 12.5px; padding: 3px 10px; border-radius: 20px; background: ${isCorrect ? '#DCFCE7' : isUnanswered ? '#F1F5F9' : '#FEE2E2'}; color: ${isCorrect ? '#16A34A' : isUnanswered ? '#475569' : '#DC2626'}; border: 1px solid ${isCorrect ? '#86EFAC' : isUnanswered ? '#CBD5E1' : '#FCA5A5'};">
            ${isCorrect ? '✔ CORRECT (+1.00)' : isUnanswered ? '○ NOT ATTEMPTED (0.00)' : '✖ INCORRECT (0.00)'}
          </span>
        </div>

        <div style="font-size: 14px; font-weight: 600; color: #1E293B; line-height: 1.45; margin-bottom: 4px;">
          ${q.text}
        </div>
        ${q.textHindi ? `<div style="font-size: 13px; color: #64748B; line-height: 1.4; margin-bottom: 8px;">${q.textHindi}</div>` : ''}

        ${optionsHtml}

        ${q.explanation ? `
          <div style="background: #F8FAFC; border: 1px dashed #CBD5E1; padding: 10px 14px; border-radius: 6px; font-size: 12.5px; color: #334155; margin-top: 8px; line-height: 1.45;">
            <strong style="color: #0F172A;">&#128161; NCERT Solution &amp; Concept Explanation:</strong> ${q.explanation}
          </div>
        ` : ''}
      `;

      dom.solutionsList.appendChild(card);
    });
  }

  // --- RESULT LOOKUP & SAVED MARKSHEET DISPLAY ---
  window.openResultLookupModal = function() {
    const modal = document.getElementById('resultLookupModal');
    if (modal) {
      modal.style.display = 'flex';
      const input = document.getElementById('inputSearchRoll');
      if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 50);
      }
      const status = document.getElementById('resultLookupStatus');
      if (status) status.innerHTML = '';
    }
  };

  window.closeResultLookupModal = function() {
    const modal = document.getElementById('resultLookupModal');
    if (modal) modal.style.display = 'none';
  };

  window.handleSearchStudentResult = async function() {
    const input = document.getElementById('inputSearchRoll');
    const status = document.getElementById('resultLookupStatus');
    const btn = document.getElementById('btnSearchStudentResult');
    if (!input || !status) return;

    const rawRoll = input.value.trim();
    if (!rawRoll) {
      status.innerHTML = '<span style="color: #DC2626; font-weight: 700;">⚠ Kripya apna Roll Number enter karein.</span>';
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Searching...';
    }
    status.innerHTML = '<span style="color: #0284C7; font-weight: 600;">⏳ Searching official assessment records...</span>';

    try {
      const res = await fetch('/api/student-result?roll=' + encodeURIComponent(rawRoll));
      const data = await res.json();
      if (data.success && data.record) {
        window._lastCompletedRecord = data.record;
        status.innerHTML = `
          <div style="background: #ECFDF5; border: 1.5px solid #10B981; border-radius: 8px; padding: 12px; margin-top: 8px;">
            <div style="font-size: 13.5px; font-weight: 800; color: #065F46; margin-bottom: 4px;">
              &#10004; Marksheet Mil Gayi! (${escapeHtml(data.studentName || data.record.name)})
            </div>
            <div style="font-size: 12px; color: #047857; margin-bottom: 10px; line-height: 1.4;">
              Roll: <strong>${escapeHtml(data.record.roll)}</strong> | Score: <strong>${data.record.score ?? 0} / ${data.record.total || 25}</strong> (${data.record.percentage ?? ''}%)<br>
              Chapter: ${escapeHtml(data.record.chapterName || 'CBSE 10th Science')}
            </div>
            <button type="button" onclick="window.closeResultLookupModal(); window.displayCompletedRecord(window._lastCompletedRecord);" class="btn-primary" style="width: 100%; background: #16A34A; padding: 10px; font-weight: 700; font-size: 13px; border-radius: 6px; cursor: pointer; box-shadow: 0 2px 4px rgba(22,163,74,0.3);">
              &#128424; Open &amp; Print Official Marksheet &rarr;
            </button>
          </div>
        `;
      } else {
        status.innerHTML = `<span style="color: #DC2626; font-weight: 700;">⚠ ${escapeHtml(data.message || 'Result record not found.')}</span>`;
      }
    } catch (e) {
      status.innerHTML = `<span style="color: #DC2626; font-weight: 700;">⚠ Network failure connecting to result server.</span>`;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '&#128269; Search Result';
      }
    }
  };

  window.displayCompletedRecord = function(rec) {
    if (!rec) return;
    showScreen(dom.resultScreen);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (dom.resStudentName) dom.resStudentName.textContent = rec.name || '-';
    if (dom.resStudentRoll) dom.resStudentRoll.textContent = rec.roll || '-';
    
    const resStudentPassword = document.getElementById('resStudentPassword');
    if (resStudentPassword) resStudentPassword.textContent = 'Edu@26';

    const qpPrintStudentName = document.getElementById('qpPrintStudentName');
    if (qpPrintStudentName) qpPrintStudentName.textContent = rec.name || '-';
    const qpPrintStudentRoll = document.getElementById('qpPrintStudentRoll');
    if (qpPrintStudentRoll) qpPrintStudentRoll.textContent = rec.roll || '-';

    if (dom.resChapterName) {
      dom.resChapterName.textContent = rec.chapterName 
        ? `${rec.chapterName} (${rec.chapterHindi || ''})` 
        : 'CBSE Class 10th Science';
    }
    if (dom.resSubmitTime) {
      dom.resSubmitTime.textContent = rec.completedAt || (new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST');
    }

    const total = rec.total || 25;
    const score = rec.score !== undefined ? rec.score : 0;
    const percentage = rec.percentage || ((score / total) * 100).toFixed(1);

    if (dom.resScoreVal) dom.resScoreVal.textContent = score;
    if (dom.resPercentageVal) dom.resPercentageVal.textContent = `${percentage}%`;

    const correct = rec.correctCount !== undefined ? rec.correctCount : score;
    const incorrect = rec.incorrectCount !== undefined ? rec.incorrectCount : Math.max(0, total - score);
    const unattempted = rec.skippedCount !== undefined ? rec.skippedCount : 0;
    const timeTakenStr = rec.timeSpentFormatted || rec.timeTaken || '25:00';

    if (dom.resCorrectCount) dom.resCorrectCount.textContent = correct;
    if (dom.resIncorrectCount) dom.resIncorrectCount.textContent = incorrect;
    if (dom.resUnattemptedCount) dom.resUnattemptedCount.textContent = unattempted;
    if (dom.resTimeTakenVal) dom.resTimeTakenVal.textContent = timeTakenStr;

    // Status badge & feedback
    const pctNum = parseFloat(percentage);
    if (pctNum >= 80) {
      dom.resStatusBadge.textContent = 'EXCELLENT (A1)';
      dom.resStatusBadge.style.background = '#DCFCE7';
      dom.resStatusBadge.style.color = '#15803D';
      dom.resFeedbackText.textContent = 'Outstanding concept mastery! Keep up the brilliant preparation for CBSE Board exams.';
    } else if (pctNum >= 50) {
      dom.resStatusBadge.textContent = 'GOOD PROGRESS (B1)';
      dom.resStatusBadge.style.background = '#EFF6FF';
      dom.resStatusBadge.style.color = '#1D4ED8';
      dom.resFeedbackText.textContent = 'Good effort. Review the incorrect answers below to solidify your understanding.';
    } else {
      dom.resStatusBadge.textContent = 'NEEDS REVISION';
      dom.resStatusBadge.style.background = '#FEE2E2';
      dom.resStatusBadge.style.color = '#B91C1C';
      dom.resFeedbackText.textContent = 'Revise this NCERT chapter carefully and consult Sir at +91 8448467381 for doubt clearing.';
    }

    // Render Solutions
    if (Array.isArray(rec.solutions) && rec.solutions.length > 0) {
      renderSavedSolutionsList(rec.solutions);
    } else if (state.questions && state.questions.length > 0) {
      renderSolutionsList();
    }
  };

  function renderSavedSolutionsList(solutions) {
    if (!dom.solutionsList || !Array.isArray(solutions)) return;
    dom.solutionsList.innerHTML = '';

    solutions.forEach(sol => {
      const isCorrect = !!sol.isCorrect;
      const isUnanswered = sol.userAnswerIndex === null || sol.userAnswerLetter === '-' || sol.userAnswerText === 'Not Attempted';

      const card = document.createElement('div');
      card.className = 'print-question-card';
      card.style.cssText = `
        background: #FFFFFF;
        border: 1.5px solid ${isCorrect ? '#86EFAC' : isUnanswered ? '#CBD5E1' : '#FCA5A5'};
        border-left: 6px solid ${isCorrect ? '#16A34A' : isUnanswered ? '#64748B' : '#DC2626'};
        border-radius: 8px;
        padding: 16px 18px;
        margin-bottom: 18px;
        page-break-inside: avoid;
        break-inside: avoid;
      `;

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
          <div>
            <strong style="font-size: 14.5px; color: #0F172A;">Question ${sol.qIndex} of ${solutions.length}</strong>
            <span style="font-size: 12px; color: #64748B; margin-left: 8px;">(Marks: 1.00)</span>
          </div>
          <span style="font-weight: 800; font-size: 12.5px; padding: 3px 10px; border-radius: 20px; background: ${isCorrect ? '#DCFCE7' : isUnanswered ? '#F1F5F9' : '#FEE2E2'}; color: ${isCorrect ? '#16A34A' : isUnanswered ? '#475569' : '#DC2626'}; border: 1px solid ${isCorrect ? '#86EFAC' : isUnanswered ? '#CBD5E1' : '#FCA5A5'};">
            ${isCorrect ? '✔ CORRECT (+1.00)' : isUnanswered ? '○ NOT ATTEMPTED (0.00)' : '✖ INCORRECT (0.00)'}
          </span>
        </div>

        <div style="font-size: 14px; font-weight: 600; color: #1E293B; line-height: 1.45; margin-bottom: 4px;">
          ${escapeHtml(sol.questionText)}
        </div>
        ${sol.questionHindi ? `<div style="font-size: 13px; color: #64748B; line-height: 1.4; margin-bottom: 8px;">${escapeHtml(sol.questionHindi)}</div>` : ''}

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0;">
          <div style="border: 1.5px solid ${isCorrect ? '#86EFAC' : isUnanswered ? '#CBD5E1' : '#FCA5A5'}; background: ${isCorrect ? '#F0FDF4' : isUnanswered ? '#F8FAFC' : '#FEF2F2'}; border-radius: 6px; padding: 8px 10px; font-size: 13px;">
            <div style="font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase;">Your Marked Response:</div>
            <strong style="color: ${isCorrect ? '#15803D' : isUnanswered ? '#475569' : '#DC2626'}; font-size: 13.5px;">${escapeHtml(sol.userAnswerText)}</strong>
          </div>
          <div style="border: 1.5px solid #86EFAC; background: #F0FDF4; border-radius: 6px; padding: 8px 10px; font-size: 13px;">
            <div style="font-size: 11px; font-weight: 700; color: #059669; text-transform: uppercase;">Official Correct Answer:</div>
            <strong style="color: #15803D; font-size: 13.5px;">${escapeHtml(sol.correctAnswerText)}</strong>
          </div>
        </div>

        ${sol.explanation ? `
          <div style="background: #F8FAFC; border: 1px dashed #CBD5E1; padding: 10px 14px; border-radius: 6px; font-size: 12.5px; color: #334155; margin-top: 8px; line-height: 1.45;">
            <strong style="color: #0F172A;">&#128161; NCERT Solution &amp; Concept Explanation:</strong> ${escapeHtml(sol.explanation)}
          </div>
        ` : ''}
      `;

      dom.solutionsList.appendChild(card);
    });
  }

  // --- COMPRESSED PROCTORING VIDEO & PERIODIC SNAPSHOTS ---
  function startProctoringVideoRecording() {
    state.proctoring.recordedChunks = [];
    if (!state.proctoring.stream) return;

    try {
      // Determine supported compressed WebM/MP4 mimeType
      let mimeType = '';
      if (typeof MediaRecorder !== 'undefined') {
        const candidateTypes = [
          'video/webm;codecs=vp8',
          'video/webm',
          'video/mp4;codecs=avc1',
          'video/mp4'
        ];
        for (const t of candidateTypes) {
          if (MediaRecorder.isTypeSupported(t)) {
            mimeType = t;
            break;
          }
        }

        const options = {
          videoBitsPerSecond: 100000 // 100 kbps (High compression, kept around 1.5 - 3 MB total)
        };
        if (mimeType) options.mimeType = mimeType;

        const recorder = new MediaRecorder(state.proctoring.stream, options);
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            state.proctoring.recordedChunks.push(event.data);
          }
        };
        recorder.start(3000); // Record in 3-second compressed slices
        state.proctoring.mediaRecorder = recorder;
        console.log('[PROCTOR] Compressed Video Recording Started (100 kbps bitrate)', mimeType);
      }
    } catch (err) {
      console.warn('[PROCTOR] MediaRecorder not supported or failed to start:', err);
    }

    // Periodic compressed snapshot capture every 30 seconds
    if (state.proctoring.snapshotIntervalId) clearInterval(state.proctoring.snapshotIntervalId);
    state.proctoring.snapshotIntervalId = setInterval(capturePeriodicCompressedSnapshot, 30000);
  }

  function capturePeriodicCompressedSnapshot() {
    if (!state.proctoring.isExamActive || state.submitted) return;
    try {
      const video = (dom.liveExamVideoFeed && dom.liveExamVideoFeed.videoWidth > 0) ? dom.liveExamVideoFeed : dom.setupVideoFeed;
      if (!video || !state.proctoring.stream) return;
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, 320, 240);
      const compressedJpeg = canvas.toDataURL('image/jpeg', 0.45); // 45% quality (~15KB per snapshot)
      
      fetch('/api/exam-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roll: state.student.roll,
          name: state.student.name,
          type: 'HEARTBEAT',
          photoUrl: compressedJpeg
        })
      }).catch(() => {});
    } catch (e) {}
  }

  async function stopAndUploadProctoringVideo() {
    if (state.proctoring.snapshotIntervalId) {
      clearInterval(state.proctoring.snapshotIntervalId);
      state.proctoring.snapshotIntervalId = null;
    }

    if (state.proctoring.mediaRecorder && state.proctoring.mediaRecorder.state !== 'inactive') {
      try {
        if (state.proctoring.mediaRecorder.state === 'recording') {
          state.proctoring.mediaRecorder.requestData();
        }
        state.proctoring.mediaRecorder.stop();
      } catch (e) {}
    }

    // Wait brief moment for last chunk to flush
    await new Promise(r => setTimeout(r, 600));

    if (state.proctoring.recordedChunks && state.proctoring.recordedChunks.length > 0) {
      try {
        const mimeType = state.proctoring.mediaRecorder?.mimeType || 'video/webm';
        const videoBlob = new Blob(state.proctoring.recordedChunks, { type: mimeType });
        console.log(`[PROCTOR] Uploading compressed proctor video. Size: ${(videoBlob.size / 1024 / 1024).toFixed(2)} MB`);
        
        await fetch('/api/upload-proctor-video?roll=' + encodeURIComponent(state.student.roll), {
          method: 'POST',
          headers: { 'Content-Type': mimeType },
          body: videoBlob
        });
        console.log('[PROCTOR] Compressed proctor video upload finished.');
      } catch (err) {
        console.warn('[PROCTOR] Error uploading video blob:', err);
      }
    }

    // Stop camera tracks cleanly
    if (state.proctoring.stream) {
      state.proctoring.stream.getTracks().forEach(t => {
        try { t.stop(); } catch (e) {}
      });
    }
  }

  // --- ANTI-CHEATING VIOLATION AUDITING (3-ATTEMPTS TAB SWITCH RULE) ---
  function handleVisibilityChange() {
    if (!state.proctoring.isExamActive || state.submitted) return;
    if (document.hidden) {
      registerSecurityViolation('टैब बदलना (Tab switch detected away from exam window)');
    }
  }

  function handleWindowBlur() {
    if (!state.proctoring.isExamActive || state.submitted) return;
    registerSecurityViolation('विंडो बदलना (Window lost focus / application switch)');
  }

  function registerSecurityViolation(reason) {
    if (!state.proctoring.isExamActive || state.submitted) return;

    state.proctoring.violations++;
    const vCount = state.proctoring.violations;

    if (dom.violationCounter) dom.violationCounter.style.display = 'block';
    if (dom.violationCount) dom.violationCount.textContent = vCount;

    // Send activity log to server
    try {
      fetch('/api/exam-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roll: state.student.roll,
          name: state.student.name,
          type: 'VIOLATION',
          strike: vCount,
          reason: reason
        })
      }).catch(() => {});
    } catch (e) {}

    if (vCount === 1) {
      alert(`⚠️ सुरक्षा चेतावनी 1 / 3 (Strike 1):\n${reason}\n\nटैब बदलना सख्त मना है! आपके पास 2 चेतावनियां शेष हैं। 3 बार टैब बदलने पर आपकी परीक्षा तुरंत रद्द कर दी जाएगी।`);
    } else if (vCount === 2) {
      alert(`⚠️ अंतिम सुरक्षा चेतावनी 2 / 3 (Strike 2):\n${reason}\n\nअंतिम चेतावनी! अगली बार टैब बदलने पर आपका परीक्षा प्रयास बिना किसी अवसर के तुरंत रद्द कर दिया जाएगा।`);
    } else if (vCount >= 3) {
      handleTabSwitchCancellation();
    }
  }

  // Exact Cancellation Prompt & Disqualification on 3rd Tab Switch Attempt
  function handleTabSwitchCancellation() {
    if (state.submitted) return;
    state.submitted = true;
    state.proctoring.isExamActive = false;

    if (state.timer.intervalId) clearInterval(state.timer.intervalId);

    // Stop proctor video and flush to server
    stopAndUploadProctoringVideo();

    // Permanently cancel attempt on server
    try {
      fetch('/api/complete-exam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roll: state.student.roll,
          name: state.student.name,
          score: 0,
          total: state.questions.length || 25,
          percentage: '0.0',
          status: 'ATTEMPT_CANCELLED_TAB_SWITCH',
          completionType: 'ATTEMPT_CANCELLED_TAB_SWITCH',
          disqualified: true,
          violationsCount: 3,
          photoUrl: state.student.photoUrl || '',
          chapterId: state.chapter ? state.chapter.id : 1,
          chapterName: state.chapter ? state.chapter.name : 'CBSE 10th Science',
          cancellationMessage: 'tab switch hone ki wajah se tumhara attempt cancle kar diya gaya hai apne teacher ko contact karo fir se exam dene ke liye'
        })
      }).catch(() => {});
    } catch (e) {}

    // Show prominent modal popup
    const cancelModal = document.getElementById('tabSwitchCancelModal');
    if (cancelModal) {
      cancelModal.style.display = 'flex';
      const waBtn = document.getElementById('btnWhatsAppTeacherCancel');
      if (waBtn) {
        const text = `Sir, tab switch hone ki wajah se mera attempt cancle ho gaya hai. Roll: ${state.student.roll}, Name: ${state.student.name}. Kripya test reset karein.`;
        waBtn.href = `https://wa.me/918448467381?text=${encodeURIComponent(text)}`;
      }
    }

    // Disable background interactions
    if (dom.examScreen) {
      dom.examScreen.style.pointerEvents = 'none';
      dom.examScreen.style.filter = 'blur(4px)';
    }
  }

  // Start app on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})();
