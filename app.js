/**
 * SilentBridge - Main Application Controller
 * Features:
 *  - 1-Tap Instant Panic SOS Button (Single-tap emergency broadcasting).
 *  - Emergency Alarm Siren / Buzzer on Receiver when disaster messages arrive.
 *  - Dynamic Vivid Green Dashboard Transformation on Sender when ACK is received.
 *  - 6 Disaster Classifications (Medical, Trapped, Fire, Flood, Earthquake, Supplies).
 *  - Auto GPS coordinates, timestamped message, voice memo with Re-Record.
 *  - Direct Google Maps routing links on Receiver.
 *  - 100% Offline Acoustic Modulation & Multi-Tab Synchronization.
 */

(function () {
  'use strict';

  // Global Application State
  const AppState = {
    currentRole: 'mesh', // 'sender' | 'receiver' | 'mesh'
    audioModem: null,

    // Telemetry & Packets
    receivedPackets: [],
    seenPacketIds: new Set(),
    activeDistressType: 1,     // 1 to 6
    currentLat: 37.774900,
    currentLon: -122.419400,
    gpsAccuracyMeters: 3.5,
    gpsWatchId: null,
    lastSentMessageId: null,

    // Voice Memo State (Sender)
    voice: {
      mediaRecorder: null,
      audioStream: null,
      audioChunks: [],
      blob: null,
      dataUrl: null,
      durationSeconds: 0,
      isRecording: false,
      recordingStartTime: 0,
      recordingTimerId: null,
      analyser: null,
      audioCtx: null
    },

    // Voice Playback State (Receiver)
    player: {
      activePacket: null,
      audioElement: null,
      audioCtx: null,
      gainNode: null,
      analyserNode: null,
      boostMultiplier: 1.0,
      isPlaying: false
    },

    // Cross-Tab Multi-Device Synchronization
    syncChannel: null,

    // Statistics
    stats: {
      txCount: 0,
      rxCount: 0,
      ackCount: 0
    }
  };

  /* -------------------------------------------------------------------------- */
  /*                            UTILITIES & HELPERS                             */
  /* -------------------------------------------------------------------------- */

  function formatRelativeTime(timestamp) {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (elapsedSeconds < 5) return 'Just now';
    if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
    const elapsedHours = Math.floor(elapsedSeconds / 60);
    return `${elapsedHours}h ago`;
  }

  function formatDuration(sec) {
    const s = Math.floor(sec || 0);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
  }

  function updateClock() {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const statClock = document.getElementById('statClock');
    const senderClock = document.getElementById('senderClock');

    if (statClock) statClock.textContent = timeStr;
    if (senderClock) senderClock.textContent = timeStr;
  }

  /* -------------------------------------------------------------------------- */
  /*                      ROLE & VIEW SWITCHER (SENDER / RX / MESH)             */
  /* -------------------------------------------------------------------------- */

  function setRole(role) {
    AppState.currentRole = role;
    window.location.hash = role;

    const navSender = document.getElementById('navBtnSender');
    const navReceiver = document.getElementById('navBtnReceiver');
    const navMesh = document.getElementById('navBtnMesh');

    const viewSender = document.getElementById('viewSender');
    const viewReceiver = document.getElementById('viewReceiver');
    const viewMesh = document.getElementById('viewMesh');

    [navSender, navReceiver, navMesh].forEach(btn => {
      if (btn) btn.className = 'role-nav-btn px-3.5 py-2 rounded-lg font-bold transition-all flex items-center gap-2 text-slate-400 hover:text-white';
    });

    [viewSender, viewReceiver, viewMesh].forEach(v => {
      if (v) {
        v.classList.add('hidden');
        v.classList.remove('flex');
      }
    });

    if (role === 'sender') {
      if (navSender) navSender.className = 'role-nav-btn active px-3.5 py-2 rounded-lg font-bold transition-all flex items-center gap-2 bg-red-600 text-white shadow-md';
      if (viewSender) {
        viewSender.classList.remove('hidden');
        viewSender.classList.add('flex');
      }
    } else if (role === 'receiver') {
      if (navReceiver) navReceiver.className = 'role-nav-btn active px-3.5 py-2 rounded-lg font-bold transition-all flex items-center gap-2 bg-cyan-500 text-slate-950 shadow-md';
      if (viewReceiver) {
        viewReceiver.classList.remove('hidden');
        viewReceiver.classList.add('flex');
      }
    } else {
      if (navMesh) navMesh.className = 'role-nav-btn active px-3.5 py-2 rounded-lg font-bold transition-all flex items-center gap-2 bg-cyan-500 text-slate-950 shadow-md';
      if (viewMesh) {
        viewMesh.classList.remove('hidden');
      }
    }

    if (window.lucide) window.lucide.createIcons();
  }

  function initRoleFromHash() {
    const pathname = window.location.pathname.toLowerCase();
    if (pathname.endsWith('sender.html')) {
      AppState.currentRole = 'sender';
      return;
    }
    if (pathname.endsWith('receiver.html')) {
      AppState.currentRole = 'receiver';
      return;
    }

    const hash = window.location.hash.replace('#', '').toLowerCase();
    if (hash === 'sender' || hash === 'receiver' || hash === 'mesh') {
      setRole(hash);
    } else {
      setRole('mesh');
    }
  }

  /* -------------------------------------------------------------------------- */
  /*            RESCUE AUTHORITY AUTHENTICATION (SIGN IN / SIGN UP)             */
  /* -------------------------------------------------------------------------- */

  const DEFAULT_OFFICERS = [
    {
      email: 'commander@rescue.org',
      password: 'rescue911',
      name: 'Commander Vance',
      badge: 'National Disaster Relief // #NDR-01'
    }
  ];

  /* -------------------------------------------------------------------------- */
  /*                 RESCUE HQ AUTHENTICATION (PASSWORD: admin@321)             */
  /* -------------------------------------------------------------------------- */

  const MASTER_RESCUE_PASSWORD = 'admin@321';

  function unlockRescueDashboard() {
    const lockGate = document.getElementById('authorityLockGate');
    const dashboard = document.getElementById('authorityDashboard');
    const subBar = document.getElementById('dashboardSubBar');
    const profile = document.getElementById('officerHeaderProfile');
    const badgeName = document.getElementById('officerBadgeName');
    const deptLabel = document.getElementById('dashboardOfficerDept');

    if (lockGate) lockGate.classList.add('hidden');
    if (dashboard) dashboard.classList.remove('hidden');
    if (subBar) subBar.classList.remove('hidden');
    if (profile) profile.classList.remove('hidden');
    if (badgeName) badgeName.textContent = 'Command Officer';
    if (deptLabel) deptLabel.textContent = 'HQ TACTICAL COMMAND';

    try {
      sessionStorage.setItem('silentbridge_rescue_unlocked', 'true');
    } catch (e) {}

    renderEmergencyFeeds();

    if (window.lucide) window.lucide.createIcons();
  }

  function lockRescueDashboard() {
    const lockGate = document.getElementById('authorityLockGate');
    const dashboard = document.getElementById('authorityDashboard');
    const subBar = document.getElementById('dashboardSubBar');
    const profile = document.getElementById('officerHeaderProfile');
    const passInput = document.getElementById('rescueAccessPassword');
    const authErr = document.getElementById('authErrorMessage');

    if (lockGate) lockGate.classList.remove('hidden');
    if (dashboard) dashboard.classList.add('hidden');
    if (subBar) subBar.classList.add('hidden');
    if (profile) profile.classList.add('hidden');
    if (passInput) passInput.value = '';
    if (authErr) authErr.classList.add('hidden');

    try {
      sessionStorage.removeItem('silentbridge_rescue_unlocked');
    } catch (e) {}

    if (window.lucide) window.lucide.createIcons();
  }

  function initRescueAuth() {
    try {
      if (sessionStorage.getItem('silentbridge_rescue_unlocked') === 'true') {
        unlockRescueDashboard();
      }
    } catch (e) {}

    const formAuth = document.getElementById('formRescueAuth');
    const passInput = document.getElementById('rescueAccessPassword');
    const authErr = document.getElementById('authErrorMessage');
    const btnDemoPass = document.getElementById('btnQuickDemoPass');
    const btnLogOut = document.getElementById('btnLogOut');

    if (formAuth) {
      formAuth.addEventListener('submit', (e) => {
        e.preventDefault();
        const entered = passInput ? passInput.value.trim() : '';

        if (entered === MASTER_RESCUE_PASSWORD) {
          if (authErr) authErr.classList.add('hidden');
          unlockRescueDashboard();
        } else {
          if (authErr) {
            authErr.textContent = 'Access Denied: Invalid Password.';
            authErr.classList.remove('hidden');
          }
          if (passInput) {
            passInput.focus();
            passInput.select();
          }
        }
      });
    }

    if (btnDemoPass) {
      btnDemoPass.addEventListener('click', () => {
        if (passInput) passInput.value = MASTER_RESCUE_PASSWORD;
        if (authErr) authErr.classList.add('hidden');
        unlockRescueDashboard();
      });
    }

    if (btnLogOut) {
      btnLogOut.addEventListener('click', () => {
        lockRescueDashboard();
      });
    }
  }

  /* -------------------------------------------------------------------------- */
  /*            DIRECT SATELLITE GNSS HARDWARE GPS (TOWERLESS / OFFLINE)        */
  /* -------------------------------------------------------------------------- */

  function initGpsTracking() {
    // 1. Load cached satellite fix if available (for offline deep indoor survival)
    try {
      const cached = localStorage.getItem('silentbridge_cached_satellite_gps');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.lat && parsed.lon) {
          AppState.currentLat = parsed.lat;
          AppState.currentLon = parsed.lon;
          AppState.gpsAccuracyMeters = parsed.accuracy || 3.5;
          updateGpsInputs(parsed.lat, parsed.lon, parsed.accuracy, true);
        }
      }
    } catch (e) {}

    // 2. Direct hardware GNSS satellite acquisition
    acquireHighAccuracyGps();

    if (navigator.geolocation) {
      try {
        AppState.gpsWatchId = navigator.geolocation.watchPosition(
          (pos) => onGpsSuccess(pos),
          (err) => console.warn('Satellite GNSS notice:', err.message),
          { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
        );
      } catch (e) {}
    }
  }

  function acquireHighAccuracyGps() {
    const btnSenderLabel = document.getElementById('senderGpsLabel');
    if (btnSenderLabel) btnSenderLabel.textContent = 'Locking Satellite...';

    if (!navigator.geolocation) {
      if (btnSenderLabel) btnSenderLabel.textContent = 'GPS Chip Unavailable';
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onGpsSuccess(pos);
        if (btnSenderLabel) btnSenderLabel.textContent = '🛰️ Satellite Locked ✓';
      },
      (err) => {
        console.warn('GNSS Satellite Notice:', err.message);
        if (btnSenderLabel) btnSenderLabel.textContent = '🛰️ Re-acquire Satellite';
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  function onGpsSuccess(pos) {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const accuracy = pos.coords.accuracy || 3.5;

    AppState.currentLat = lat;
    AppState.currentLon = lon;
    AppState.gpsAccuracyMeters = accuracy;

    // Cache physical GNSS satellite fix for offline deep-debris survival
    try {
      localStorage.setItem('silentbridge_cached_satellite_gps', JSON.stringify({
        lat, lon, accuracy, timestamp: Date.now()
      }));
    } catch (e) {}

    updateGpsInputs(lat, lon, accuracy, false);
  }

  function updateGpsInputs(lat, lon, accuracy, isCached) {
    const sLat = document.getElementById('senderInputLat');
    const sLon = document.getElementById('senderInputLon');
    const mLat = document.getElementById('meshInputLat');
    const mLon = document.getElementById('meshInputLon');

    if (sLat) sLat.value = lat.toFixed(6);
    if (sLon) sLon.value = lon.toFixed(6);
    if (mLat) mLat.value = lat.toFixed(6);
    if (mLon) mLon.value = lon.toFixed(6);

    const sAccPill = document.getElementById('senderGpsAccuracyPill');
    if (sAccPill) {
      sAccPill.innerHTML = `🛰️ <strong class="text-emerald-400">± ${accuracy.toFixed(1)}m (${isCached ? 'Cached Satellite Fix' : 'Hardware GNSS Satellite Lock'})</strong> <span class="text-[10px] text-slate-500 block sm:inline">// NO TOWER / NO INTERNET REQUIRED</span>`;
    }
  }

  /* -------------------------------------------------------------------------- */
  /*            EMERGENCY VOICE RECORDER & RE-RECORD ENGINE (SENDER)            */
  /* -------------------------------------------------------------------------- */

  function initVoiceRecorder() {
    const btnToggleRecord = document.getElementById('btnToggleRecordVoice');
    const btnMeshToggleRecord = document.getElementById('btnMeshToggleRecord');
    const btnReRecord = document.getElementById('btnReRecordVoice');
    const btnPlayPreview = document.getElementById('btnPlayVoicePreview');
    const btnDiscard = document.getElementById('btnDiscardVoice');

    if (btnToggleRecord) {
      btnToggleRecord.addEventListener('click', () => {
        if (AppState.voice.isRecording) {
          stopVoiceRecording();
        } else {
          startVoiceRecording();
        }
      });
    }

    if (btnMeshToggleRecord) {
      btnMeshToggleRecord.addEventListener('click', () => {
        if (AppState.voice.isRecording) {
          stopVoiceRecording();
        } else {
          startVoiceRecording();
        }
      });
    }

    if (btnReRecord) {
      btnReRecord.addEventListener('click', () => {
        discardVoiceRecording();
        startVoiceRecording();
      });
    }

    if (btnPlayPreview) {
      btnPlayPreview.addEventListener('click', () => {
        playVoicePreview();
      });
    }

    if (btnDiscard) {
      btnDiscard.addEventListener('click', () => {
        discardVoiceRecording();
      });
    }

    initVoiceRecordingCanvas();
  }

  async function startVoiceRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      AppState.voice.audioStream = stream;
      AppState.voice.audioChunks = [];

      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : '';
      }

      const options = mimeType ? { mimeType } : {};
      AppState.voice.mediaRecorder = new MediaRecorder(stream, options);

      AppState.voice.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          AppState.voice.audioChunks.push(e.data);
        }
      };

      AppState.voice.mediaRecorder.onstop = () => {
        onVoiceRecordingStopped();
      };

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        AppState.voice.audioCtx = new AudioCtx();
        const source = AppState.voice.audioCtx.createMediaStreamSource(stream);
        AppState.voice.analyser = AppState.voice.audioCtx.createAnalyser();
        AppState.voice.analyser.fftSize = 256;
        source.connect(AppState.voice.analyser);
      }

      AppState.voice.mediaRecorder.start(100);
      AppState.voice.isRecording = true;
      AppState.voice.recordingStartTime = Date.now();

      updateVoiceRecorderUI(true);

      const maxSeconds = 10;
      AppState.voice.recordingTimerId = setInterval(() => {
        const elapsed = (Date.now() - AppState.voice.recordingStartTime) / 1000;
        const timerLabel = document.getElementById('recordTimerLabel');
        if (timerLabel) {
          timerLabel.textContent = `${formatDuration(elapsed)} / 00:10`;
        }

        if (elapsed >= maxSeconds) {
          stopVoiceRecording();
        }
      }, 100);

    } catch (err) {
      console.error('Mic access error:', err);
      alert('Microphone access is needed to record emergency voice memos.');
    }
  }

  function stopVoiceRecording() {
    if (!AppState.voice.isRecording) return;

    AppState.voice.isRecording = false;
    if (AppState.voice.recordingTimerId) {
      clearInterval(AppState.voice.recordingTimerId);
      AppState.voice.recordingTimerId = null;
    }

    if (AppState.voice.mediaRecorder && AppState.voice.mediaRecorder.state !== 'inactive') {
      AppState.voice.mediaRecorder.stop();
    }

    if (AppState.voice.audioStream) {
      AppState.voice.audioStream.getTracks().forEach(track => track.stop());
      AppState.voice.audioStream = null;
    }

    updateVoiceRecorderUI(false);
  }

  function onVoiceRecordingStopped() {
    const blob = new Blob(AppState.voice.audioChunks, { type: AppState.voice.mediaRecorder.mimeType || 'audio/webm' });
    AppState.voice.blob = blob;
    AppState.voice.durationSeconds = Math.max(0.5, (Date.now() - AppState.voice.recordingStartTime) / 1000);

    const reader = new FileReader();
    reader.onloadend = () => {
      AppState.voice.dataUrl = reader.result;
      showVoiceAttachedUI(true);
    };
    reader.readAsDataURL(blob);

    if (AppState.voice.audioCtx) {
      AppState.voice.audioCtx.close().catch(() => {});
      AppState.voice.audioCtx = null;
    }
  }

  function discardVoiceRecording() {
    AppState.voice.blob = null;
    AppState.voice.dataUrl = null;
    AppState.voice.durationSeconds = 0;
    AppState.voice.audioChunks = [];
    showVoiceAttachedUI(false);

    const timerLabel = document.getElementById('recordTimerLabel');
    if (timerLabel) timerLabel.textContent = '00:00 / 00:10';
  }

  function playVoicePreview() {
    if (!AppState.voice.blob && !AppState.voice.dataUrl) return;

    const audio = new Audio(AppState.voice.dataUrl || URL.createObjectURL(AppState.voice.blob));
    const btnIcon = document.getElementById('voicePreviewIcon');

    if (btnIcon) btnIcon.setAttribute('data-lucide', 'square');
    if (window.lucide) window.lucide.createIcons();

    audio.onended = () => {
      if (btnIcon) btnIcon.setAttribute('data-lucide', 'play');
      if (window.lucide) window.lucide.createIcons();
    };

    audio.play().catch(() => {});
  }

  function updateVoiceRecorderUI(isRecording) {
    const btnText = document.getElementById('recordBtnText');
    const btnIcon = document.getElementById('recordIcon');
    const badge = document.getElementById('senderVoiceStatusBadge');
    const idlePrompt = document.getElementById('senderVoiceIdlePrompt');
    const btnRecord = document.getElementById('btnToggleRecordVoice');
    const meshStatus = document.getElementById('meshVoiceStatus');

    if (isRecording) {
      if (btnText) btnText.textContent = 'STOP RECORDING';
      if (btnIcon) btnIcon.setAttribute('data-lucide', 'square');
      if (badge) {
        badge.textContent = 'RECORDING...';
        badge.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500 text-white font-bold animate-pulse';
      }
      if (idlePrompt) idlePrompt.classList.add('hidden');
      if (btnRecord) btnRecord.classList.add('ring-4', 'ring-rose-500/50');
      if (meshStatus) meshStatus.textContent = 'Recording Voice (10s)...';
    } else {
      if (btnText) btnText.textContent = 'RECORD VOICE (10s)';
      if (btnIcon) btnIcon.setAttribute('data-lucide', 'mic');
      if (badge) {
        badge.textContent = AppState.voice.blob ? 'ATTACHED' : 'READY';
        badge.className = AppState.voice.blob ? 'text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold' : 'text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700';
      }
      if (idlePrompt && !AppState.voice.blob) idlePrompt.classList.remove('hidden');
      if (btnRecord) btnRecord.classList.remove('ring-4', 'ring-rose-500/50');
    }

    if (window.lucide) window.lucide.createIcons();
  }

  function showVoiceAttachedUI(hasVoice) {
    const banner = document.getElementById('senderVoiceAttachedBanner');
    const meta = document.getElementById('senderVoiceAttachedMeta');
    const btnPlay = document.getElementById('btnPlayVoicePreview');
    const btnReRecord = document.getElementById('btnReRecordVoice');
    const btnDiscard = document.getElementById('btnDiscardVoice');
    const meshStatus = document.getElementById('meshVoiceStatus');

    if (hasVoice && AppState.voice.blob) {
      if (banner) banner.classList.remove('hidden');
      if (meta) meta.textContent = `Voice Memo Attached (${AppState.voice.durationSeconds.toFixed(1)}s)`;
      if (btnPlay) btnPlay.disabled = false;
      if (btnReRecord) btnReRecord.disabled = false;
      if (btnDiscard) btnDiscard.disabled = false;
      if (meshStatus) meshStatus.textContent = `Voice: Attached (${AppState.voice.durationSeconds.toFixed(1)}s)`;
    } else {
      if (banner) banner.classList.add('hidden');
      if (btnPlay) btnPlay.disabled = true;
      if (btnReRecord) btnReRecord.disabled = true;
      if (btnDiscard) btnDiscard.disabled = true;
      if (meshStatus) meshStatus.textContent = 'Voice: Ready';
    }
  }

  function initVoiceRecordingCanvas() {
    const canvas = document.getElementById('senderVoiceCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    function resize() {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * (window.devicePixelRatio || 1);
      canvas.height = rect.height * (window.devicePixelRatio || 1);
      ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    }
    resize();
    window.addEventListener('resize', resize);

    function draw() {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      ctx.clearRect(0, 0, width, height);

      if (AppState.voice.isRecording && AppState.voice.analyser) {
        const bufferLength = AppState.voice.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        AppState.voice.analyser.getByteTimeDomainData(dataArray);

        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#F43F5E';
        ctx.beginPath();

        const sliceWidth = width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = (v * height) / 2;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }

        ctx.lineTo(width, height / 2);
        ctx.stroke();
      } else if (AppState.voice.blob) {
        ctx.fillStyle = '#10B981';
        const bars = 40;
        const barWidth = width / bars;
        for (let i = 0; i < bars; i++) {
          const pseudoHeight = Math.sin(i * 0.4) * (height * 0.35) + (height * 0.4);
          ctx.fillRect(i * barWidth + 2, (height - pseudoHeight) / 2, barWidth - 3, pseudoHeight);
        }
      }

      requestAnimationFrame(draw);
    }

    draw();
  }

  /* -------------------------------------------------------------------------- */
  /*            RECEIVER RESCUE VOICE DISPATCH PLAYER CONSOLE                   */
  /* -------------------------------------------------------------------------- */

  function initReceiverVoicePlayer() {
    const btnPlay = document.getElementById('btnPlayActiveVoice');
    const btnMeshPlay = document.getElementById('btnMeshPlayActiveVoice');
    const btnBoost = document.getElementById('btnVoiceBoost');

    if (btnPlay) btnPlay.addEventListener('click', toggleVoicePlayback);
    if (btnMeshPlay) btnMeshPlay.addEventListener('click', toggleVoicePlayback);
    if (btnBoost) btnBoost.addEventListener('click', cycleVoiceBoost);

    initReceiverPlaybackCanvas();
  }

  function cycleVoiceBoost() {
    const multipliers = [1.0, 2.0, 3.5];
    const currentIdx = multipliers.indexOf(AppState.player.boostMultiplier);
    const nextIdx = (currentIdx + 1) % multipliers.length;
    AppState.player.boostMultiplier = multipliers[nextIdx];

    const label = document.getElementById('voiceBoostLabel');
    if (label) label.textContent = `Boost: ${AppState.player.boostMultiplier}x`;

    if (AppState.player.gainNode && AppState.player.audioCtx) {
      AppState.player.gainNode.gain.setValueAtTime(AppState.player.boostMultiplier, AppState.player.audioCtx.currentTime);
    }
  }

  function setActiveVoiceDispatch(packet) {
    AppState.player.activePacket = packet;

    const badge = document.getElementById('activeVoiceBadge');
    const meta = document.getElementById('activeVoiceMeta');
    const meshMeta = document.getElementById('meshActiveVoiceMeta');
    const btnPlay = document.getElementById('btnPlayActiveVoice');
    const btnMeshPlay = document.getElementById('btnMeshPlayActiveVoice');
    const placeholder = document.getElementById('receiverPlaybackPlaceholder');

    const hasAudio = !!packet.voiceDataUrl;
    const durStr = packet.voiceDuration ? `${packet.voiceDuration.toFixed(1)}s` : '3.0s';

    if (badge) {
      badge.textContent = hasAudio ? `VOICE MEMO (#${packet.messageId})` : `TTS AUDIO (#${packet.messageId})`;
      badge.className = 'text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold';
    }

    const desc = `${packet.distressMeta.name} • "${packet.message}" • Time: ${packet.timeString || 'Recent'} • Duration: ${durStr}`;
    if (meta) meta.textContent = desc;
    if (meshMeta) meshMeta.textContent = desc;

    if (btnPlay) btnPlay.disabled = false;
    if (btnMeshPlay) btnMeshPlay.disabled = false;
    if (placeholder) placeholder.classList.add('hidden');

    const durLabel = document.getElementById('playbackTimeDuration');
    if (durLabel) durLabel.textContent = durStr;
  }

  async function toggleVoicePlayback() {
    const packet = AppState.player.activePacket;
    if (!packet) return;

    if (AppState.player.isPlaying) {
      stopVoicePlayback();
      return;
    }

    if (packet.voiceDataUrl) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AppState.player.audioCtx) {
          AppState.player.audioCtx = new AudioCtx();
        }

        const audio = new Audio(packet.voiceDataUrl);
        AppState.player.audioElement = audio;

        const source = AppState.player.audioCtx.createMediaElementSource(audio);
        const gainNode = AppState.player.audioCtx.createGain();
        const analyser = AppState.player.audioCtx.createAnalyser();
        analyser.fftSize = 128;

        gainNode.gain.setValueAtTime(AppState.player.boostMultiplier, AppState.player.audioCtx.currentTime);

        source.connect(gainNode);
        gainNode.connect(analyser);
        analyser.connect(AppState.player.audioCtx.destination);

        AppState.player.gainNode = gainNode;
        AppState.player.analyserNode = analyser;

        audio.ontimeupdate = () => {
          const cur = document.getElementById('playbackTimeCurrent');
          const progress = document.getElementById('playbackProgressBar');
          if (cur) cur.textContent = formatDuration(audio.currentTime);
          if (progress && audio.duration) {
            progress.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
          }
        };

        audio.onended = () => stopVoicePlayback();

        AppState.player.isPlaying = true;
        updatePlaybackButtonUI(true);
        await audio.play();

      } catch (err) {
        const audio = new Audio(packet.voiceDataUrl);
        AppState.player.audioElement = audio;
        audio.onended = () => stopVoicePlayback();
        AppState.player.isPlaying = true;
        updatePlaybackButtonUI(true);
        audio.play();
      }
    } else {
      playTacticalTts(packet);
    }
  }

  function stopVoicePlayback() {
    AppState.player.isPlaying = false;
    if (AppState.player.audioElement) {
      AppState.player.audioElement.pause();
      AppState.player.audioElement.currentTime = 0;
      AppState.player.audioElement = null;
    }
    updatePlaybackButtonUI(false);

    const cur = document.getElementById('playbackTimeCurrent');
    const progress = document.getElementById('playbackProgressBar');
    if (cur) cur.textContent = '00:00';
    if (progress) progress.style.width = '0%';
  }

  function updatePlaybackButtonUI(isPlaying) {
    const playText = document.getElementById('receiverPlayText');
    const playIcon = document.getElementById('receiverPlayIcon');

    if (isPlaying) {
      if (playText) playText.textContent = 'STOP PLAYBACK';
      if (playIcon) playIcon.setAttribute('data-lucide', 'square');
    } else {
      if (playText) playText.textContent = 'PLAY VOICE SOS';
      if (playIcon) playIcon.setAttribute('data-lucide', 'play');
    }
    if (window.lucide) window.lucide.createIcons();
  }

  function playTacticalTts(packet) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    const text = `Emergency Alert. ${packet.distressMeta.name}. Message: ${packet.message}. Coordinates: Latitude ${packet.latitude}, Longitude ${packet.longitude}.`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;

    AppState.player.isPlaying = true;
    updatePlaybackButtonUI(true);

    utterance.onend = () => stopVoicePlayback();
    utterance.onerror = () => stopVoicePlayback();

    window.speechSynthesis.speak(utterance);
  }

  function initReceiverPlaybackCanvas() {
    const canvas = document.getElementById('receiverPlaybackCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    function resize() {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * (window.devicePixelRatio || 1);
      canvas.height = rect.height * (window.devicePixelRatio || 1);
      ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    }
    resize();
    window.addEventListener('resize', resize);

    function render() {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      ctx.clearRect(0, 0, width, height);

      if (AppState.player.isPlaying && AppState.player.analyserNode) {
        const bufferLength = AppState.player.analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        AppState.player.analyserNode.getByteFrequencyData(dataArray);

        const barWidth = width / bufferLength;
        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * height;
          ctx.fillStyle = '#F43F5E';
          ctx.fillRect(i * barWidth, height - barHeight, barWidth - 1, barHeight);
        }
      }

      requestAnimationFrame(render);
    }

    render();
  }

  /* -------------------------------------------------------------------------- */
  /*            ANTI-MISUSE, DEVICE FINGERPRINTING & ROGUE DEVICE BLOCKING      */
  /* -------------------------------------------------------------------------- */

  function getOrCreateDeviceId() {
    let id = localStorage.getItem('silentbridge_device_id');
    if (!id) {
      id = 'DEV-' + Math.floor(1000 + Math.random() * 9000).toString(16).toUpperCase();
      localStorage.setItem('silentbridge_device_id', id);
    }
    return id;
  }

  function getBlockedDevices() {
    try {
      const data = localStorage.getItem('silentbridge_blocked_devices');
      if (data) return JSON.parse(data);
    } catch (e) {}
    return [];
  }

  function blockDevice(deviceId, reason = 'Hoax / False Alarm / Spam') {
    const blocked = getBlockedDevices();
    if (!blocked.some(b => b.deviceId === deviceId)) {
      blocked.push({ deviceId, reason, timestamp: Date.now() });
      localStorage.setItem('silentbridge_blocked_devices', JSON.stringify(blocked));
    }
    // Drop all active packets from this rogue device
    AppState.receivedPackets = AppState.receivedPackets.filter(p => p.deviceId !== deviceId);
    renderEmergencyFeeds();
    updateBlockedCountBadge();
    renderBlockedDevicesModal();
    alert(`Device [${deviceId}] has been blacklisted and blocked. All future transmissions from this device will be rejected.`);
  }

  function unblockDevice(deviceId) {
    let blocked = getBlockedDevices();
    blocked = blocked.filter(b => b.deviceId !== deviceId);
    localStorage.setItem('silentbridge_blocked_devices', JSON.stringify(blocked));
    updateBlockedCountBadge();
    renderBlockedDevicesModal();
  }

  function updateBlockedCountBadge() {
    const badge = document.getElementById('statBlockedCount');
    if (badge) {
      badge.textContent = getBlockedDevices().length;
    }
  }

  function renderBlockedDevicesModal() {
    const container = document.getElementById('blockedDevicesListContainer');
    if (!container) return;

    const blocked = getBlockedDevices();
    if (blocked.length === 0) {
      container.innerHTML = `
        <div class="p-4 text-center text-slate-500 font-mono text-xs border border-dashed border-tactical-border rounded-xl">
          No devices currently blocked. All survivor beacons permitted.
        </div>
      `;
      return;
    }

    container.innerHTML = blocked.map(b => `
      <div class="p-3 rounded-xl bg-tactical-950 border border-rose-500/30 flex items-center justify-between gap-2 text-xs font-mono">
        <div>
          <strong class="text-rose-400 block">${b.deviceId}</strong>
          <span class="text-[10px] text-slate-400">${b.reason} • ${formatRelativeTime(b.timestamp)}</span>
        </div>
        <button type="button" class="btn-unblock-dev text-[11px] px-2.5 py-1 rounded-lg bg-tactical-800 hover:bg-tactical-700 text-slate-200 border border-tactical-border font-bold" data-devid="${b.deviceId}">
          Unblock
        </button>
      </div>
    `).join('');

    container.querySelectorAll('.btn-unblock-dev').forEach(btn => {
      btn.addEventListener('click', () => {
        unblockDevice(btn.dataset.devid);
      });
    });
  }

  function calculateTrustScore(pkt) {
    if (pkt.isManuallyVerified) {
      return { score: 100, label: 'MANUALLY VERIFIED ✓', badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', icon: 'shield-check' };
    }
    if (pkt.isFalseAlarm) {
      return { score: 10, label: 'AUTO-FLAGGED: FALSE ALARM', badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40', icon: 'alert-triangle' };
    }

    let score = 15; // Base score

    // Factor 1: Voice SOS Attached (+40%)
    if (pkt.hasVoice) score += 40;

    // Factor 2: Satellite GPS precision lock (+30%)
    if (pkt.latitude !== 0 && pkt.longitude !== 0) score += 30;

    // Factor 3: Proximity cluster (+15%)
    const hasNearby = AppState.receivedPackets.some(p => 
      p.messageId !== pkt.messageId && 
      Math.abs(p.latitude - pkt.latitude) < 0.015 && 
      Math.abs(p.longitude - pkt.longitude) < 0.015
    );
    if (hasNearby) score += 15;

    score = Math.min(100, Math.max(10, score));

    if (score >= 75) {
      return { score, label: `HIGH TRUST (${score}%)`, badgeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40', icon: 'shield-check' };
    } else if (score >= 45) {
      return { score, label: `NEEDS REVIEW (${score}%)`, badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40', icon: 'shield-alert' };
    } else {
      return { score, label: `SUSPICIOUS (${score}%)`, badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40', icon: 'alert-octagon' };
    }
  }

  function markBeaconVerified(messageId) {
    const packet = AppState.receivedPackets.find(p => p.messageId === messageId);
    if (packet) {
      packet.isManuallyVerified = true;
      packet.isFalseAlarm = false;
      renderEmergencyFeeds();
      playEmergencySiren();
    }
  }

  function flagBeaconFalseAlarm(messageId) {
    const packet = AppState.receivedPackets.find(p => p.messageId === messageId);
    if (packet) {
      packet.isFalseAlarm = true;
      packet.isManuallyVerified = false;
      packet.autoFlaggedReason = 'Manually Flagged as False Alarm / Hoax by Officer';
      renderEmergencyFeeds();
    }
  }

  /* -------------------------------------------------------------------------- */
  /*           MULTI-SENDER LIVE FEED & GOOGLE MAPS DIRECT LINKS                */
  /* -------------------------------------------------------------------------- */

  function renderEmergencyFeeds() {
    const rxFeedContainer = document.getElementById('receiverEmergencyFeedList');
    const meshFeedContainer = document.getElementById('meshEmergencyFeedList');

    const buildFeedHtml = () => {
      if (AppState.receivedPackets.length === 0) {
        return `
          <div class="p-8 text-center border border-dashed border-tactical-border rounded-2xl bg-tactical-950/50 text-slate-500 font-mono text-xs">
            <i data-lucide="shield-check" class="w-10 h-10 mx-auto mb-2.5 text-slate-600"></i>
            No active distress beacons received.<br>
            Acoustic listener standing by across all channels.
          </div>
        `;
      }

      return AppState.receivedPackets.map((pkt) => {
        const meta = pkt.distressMeta || PacketEngine.DISTRESS_TYPES[pkt.distressType];
        const timeStr = formatRelativeTime(pkt.timestamp);
        const googleMapsUrl = `https://www.google.com/maps?q=${pkt.latitude},${pkt.longitude}`;
        const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${pkt.latitude},${pkt.longitude}`;
        const trust = calculateTrustScore(pkt);
        const devId = pkt.deviceId || `DEV-${((pkt.messageId * 17) % 9000 + 1000).toString(16).toUpperCase()}`;
        pkt.deviceId = devId;

        return `
          <div class="p-4 sm:p-5 rounded-2xl border ${pkt.isFalseAlarm ? 'border-amber-500/80 bg-amber-950/20' : meta.bgClass} bg-tactical-900/95 shadow-xl transition-all hover:border-slate-500 relative" id="card_${pkt.messageId}">
            
            <!-- Top Line: Disaster Badge, Trust Score, Device ID & Timestamp -->
            <div class="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <div class="flex flex-wrap items-center gap-2">
                <span class="px-3 py-1 rounded-lg text-xs font-mono font-extrabold uppercase ${meta.badgeClass} flex items-center gap-1.5 shadow-sm">
                  <i data-lucide="${meta.icon}" class="w-4 h-4"></i>
                  ${meta.name}
                </span>

                <!-- Trust Score Pill -->
                <span class="px-2.5 py-0.5 rounded-lg text-[10px] font-mono font-extrabold uppercase border ${trust.badgeClass} flex items-center gap-1">
                  <i data-lucide="${trust.icon}" class="w-3 h-3"></i>
                  ${trust.label}
                </span>

                <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-tactical-800 text-slate-400 border border-tactical-border font-bold">
                  🆔 ${devId}
                </span>
                <span class="text-xs font-mono text-slate-400 font-bold">#${pkt.messageId}</span>
              </div>

              <div class="text-xs font-mono text-slate-400 flex items-center gap-1.5">
                <i data-lucide="clock" class="w-3.5 h-3.5 text-slate-500"></i>
                <span>${pkt.timeString || timeStr}</span>
              </div>
            </div>

            <!-- AUTOMATIC FALSE ALARM WARNING BANNER (If Auto-Identified) -->
            ${pkt.isFalseAlarm ? `
              <div class="bg-amber-950/60 border border-amber-500/60 rounded-xl p-3 mb-3 text-xs font-mono text-amber-200 flex items-start gap-2.5 shadow-inner">
                <i data-lucide="alert-triangle" class="w-5 h-5 text-amber-400 shrink-0 mt-0.5"></i>
                <div>
                  <div class="font-extrabold text-amber-300 uppercase tracking-wide">⚠️ AUTOMATICALLY IDENTIFIED AS POTENTIAL FALSE ALARM</div>
                  <div class="text-[11px] text-amber-200/90 mt-0.5">Reason: <strong>${pkt.autoFlaggedReason || 'No Voice Memo SOS Attached (Acoustic Verification Failed)'}</strong></div>
                  <div class="text-[10px] text-slate-400 mt-1">Siren automatically muted. You can override and verify if genuine or block the sender below.</div>
                </div>
              </div>
            ` : ''}

            <!-- Message & Voice Tag -->
            <div class="text-base font-mono font-extrabold text-white mb-3 tracking-wide flex flex-wrap items-center justify-between gap-2">
              <span>"${pkt.message}"</span>
              ${pkt.hasVoice ? `
                <span class="px-2.5 py-1 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs flex items-center gap-1 font-bold">
                  <i data-lucide="mic" class="w-3.5 h-3.5"></i> VOICE SOS ATTACHED
                </span>
              ` : `
                <span class="px-2.5 py-1 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs flex items-center gap-1 font-bold">
                  <i data-lucide="mic-off" class="w-3.5 h-3.5"></i> NO VOICE SOS (UNVERIFIED)
                </span>
              `}
            </div>

            <!-- Exact Location & Google Maps Link -->
            <div class="bg-tactical-950 p-3 rounded-xl border border-tactical-border/70 mb-3.5 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
              <div class="flex items-center gap-2">
                <i data-lucide="map-pin" class="w-4 h-4 text-cyan-400"></i>
                <span class="text-slate-400">EXACT LOCATION:</span>
                <strong class="text-white font-bold">${pkt.latitude.toFixed(6)}, ${pkt.longitude.toFixed(6)}</strong>
              </div>

              <div class="flex items-center gap-2">
                <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-lg bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-500/40 font-bold flex items-center gap-1.5 transition-colors shadow-sm">
                  <i data-lucide="map" class="w-3.5 h-3.5"></i>
                  <span>Open in Google Maps ↗</span>
                </a>
                <a href="${directionsUrl}" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1.5 rounded-lg bg-tactical-850 hover:bg-tactical-800 text-slate-300 border border-tactical-border font-bold flex items-center gap-1 transition-colors">
                  <i data-lucide="navigation" class="w-3 h-3 text-amber-400"></i>
                  <span>Directions</span>
                </a>
              </div>
            </div>

            <!-- Action Controls: Listen Voice, Verify, Flag False Alarm, Block Device, Send ACK, Clear -->
            <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-tactical-border/50">
              <div class="flex flex-wrap items-center gap-2">
                <button type="button" class="btn-play-voice-card text-xs px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold transition-all flex items-center gap-1.5 shadow-md shadow-rose-950/40" data-msgid="${pkt.messageId}">
                  <i data-lucide="play" class="w-3.5 h-3.5"></i> Play Voice
                </button>
                <button type="button" class="btn-send-ack text-xs px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold transition-all flex items-center gap-1.5 shadow-md shadow-emerald-950/40" data-msgid="${pkt.messageId}">
                  <i data-lucide="check-check" class="w-3.5 h-3.5"></i> Dispatch & ACK
                </button>

                <!-- Anti-Misuse Triage Controls -->
                ${pkt.isFalseAlarm ? `
                  <button type="button" class="btn-verify-beacon text-xs px-2.5 py-1.5 rounded-xl bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-500/50 font-mono font-bold flex items-center gap-1 shadow-sm" data-msgid="${pkt.messageId}" title="Override false alarm and mark as verified emergency">
                    <i data-lucide="check" class="w-3.5 h-3.5"></i> Override & Verify
                  </button>
                ` : `
                  <button type="button" class="btn-flag-false text-xs px-2.5 py-1.5 rounded-xl bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-500/40 font-mono font-bold flex items-center gap-1" data-msgid="${pkt.messageId}" title="Flag as Hoax / False Alarm">
                    <i data-lucide="flag" class="w-3 h-3"></i> False Alarm
                  </button>
                `}
                <button type="button" class="btn-block-dev text-xs px-2.5 py-1.5 rounded-xl bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-500/40 font-mono font-bold flex items-center gap-1" data-devid="${devId}" title="Blacklist and Block this rogue device">
                  <i data-lucide="ban" class="w-3 h-3"></i> Block Device
                </button>
              </div>

              <div>
                <button type="button" class="btn-clear-single-beacon text-xs px-2.5 py-1.5 rounded-lg bg-tactical-800 hover:bg-tactical-700 text-slate-400 hover:text-slate-200 font-mono transition-colors" data-msgid="${pkt.messageId}">
                  Clear
                </button>
              </div>
            </div>

          </div>
        `;
      }).join('');
    };

    const feedHtml = buildFeedHtml();
    if (rxFeedContainer) rxFeedContainer.innerHTML = feedHtml;
    if (meshFeedContainer) meshFeedContainer.innerHTML = feedHtml;

    if (window.lucide) window.lucide.createIcons();

    document.querySelectorAll('.btn-play-voice-card').forEach(btn => {
      btn.addEventListener('click', () => {
        const msgId = parseInt(btn.dataset.msgid, 10);
        const packet = AppState.receivedPackets.find(p => p.messageId === msgId);
        if (packet) {
          setActiveVoiceDispatch(packet);
          toggleVoicePlayback();
        }
      });
    });

    document.querySelectorAll('.btn-send-ack').forEach(btn => {
      btn.addEventListener('click', async () => {
        const msgId = parseInt(btn.dataset.msgid, 10);
        await dispatchRescueAck(msgId);
        btn.textContent = 'ACK Sent ✓ (Rescue En Route)';
        btn.className = 'text-xs px-3 py-1.5 rounded-xl bg-emerald-900 text-emerald-300 border border-emerald-500/40 font-mono font-bold';
      });
    });

    document.querySelectorAll('.btn-verify-beacon').forEach(btn => {
      btn.addEventListener('click', () => {
        const msgId = parseInt(btn.dataset.msgid, 10);
        markBeaconVerified(msgId);
      });
    });

    document.querySelectorAll('.btn-flag-false').forEach(btn => {
      btn.addEventListener('click', () => {
        const msgId = parseInt(btn.dataset.msgid, 10);
        flagBeaconFalseAlarm(msgId);
      });
    });

    document.querySelectorAll('.btn-block-dev').forEach(btn => {
      btn.addEventListener('click', () => {
        const devId = btn.dataset.devid;
        if (confirm(`Are you sure you want to blacklist device [${devId}]? All future signals from this sender will be dropped.`)) {
          blockDevice(devId);
        }
      });
    });

    document.querySelectorAll('.btn-clear-single-beacon').forEach(btn => {
      btn.addEventListener('click', () => {
        const msgId = parseInt(btn.dataset.msgid, 10);
        clearSingleBeacon(msgId);
      });
    });
  }

  function clearSingleBeacon(messageId) {
    AppState.receivedPackets = AppState.receivedPackets.filter(p => p.messageId !== messageId);
    renderEmergencyFeeds();
  }

  /* -------------------------------------------------------------------------- */
  /*              BIDIRECTIONAL ACKNOWLEDGMENT (ACK) ENGINE                     */
  /* -------------------------------------------------------------------------- */

  async function dispatchRescueAck(targetMessageId) {
    console.log(`[SilentBridge ACK] Dispatching rescue ACK for Message #${targetMessageId}`);
    const ackPacket = PacketEngine.createAckPacket(targetMessageId, 'RESCUE EN ROUTE');

    try {
      if (AppState.audioModem) {
        AppState.audioModem.transmitPacket(ackPacket).catch(() => {});
      }

      if (AppState.syncChannel) {
        AppState.syncChannel.postMessage({
          type: 'ACK_BROADCAST',
          targetMessageId: targetMessageId,
          timestamp: Date.now()
        });
      }

      // Dual-Layer LocalStorage Event Sync (Bulletproof across all windows/tabs)
      try {
        localStorage.setItem('silentbridge_last_ack_event', JSON.stringify({
          targetMessageId: targetMessageId,
          timestamp: Date.now()
        }));
      } catch (e) {}

      AppState.stats.ackCount++;
      const ackCountEl = document.getElementById('statAckCount');
      if (ackCountEl) ackCountEl.textContent = AppState.stats.ackCount;

    } catch (e) {}
  }

  function handleIncomingAck(targetMessageId) {
    console.log(`[SilentBridge] ACK received for Beacon #${targetMessageId}`);

    // 1. Show Top Banner
    const banner = document.getElementById('senderAckBanner');
    const timeEl = document.getElementById('ackTimestamp');
    const msgEl = document.getElementById('ackMessageText');

    if (banner) {
      banner.classList.remove('hidden');
      if (timeEl) timeEl.textContent = new Date().toTimeString().split(' ')[0];
      if (msgEl) msgEl.textContent = `Base Station Confirmed Distress Beacon #${targetMessageId}! Rescue Team is En Route.`;
    }

    // 2. Turn Sender Dashboard into Vivid Glowing Green
    const trackingCard = document.getElementById('senderLiveTrackingCard');
    const statusText = document.getElementById('senderTrackingStatusText');
    const statusBadge = document.getElementById('senderTrackingBadge');
    const trackingDot = document.getElementById('senderTrackingDot');
    const meshBadge = document.getElementById('meshSenderTrackingBadge');

    if (trackingCard) {
      trackingCard.className = 'p-4 rounded-2xl bg-emerald-950/90 border-2 border-emerald-400 shadow-2xl shadow-emerald-950/80 font-mono text-xs flex items-center justify-between gap-3 transition-all duration-500 mb-6';
    }

    if (statusText) {
      statusText.innerHTML = `<span class="text-emerald-300 font-extrabold text-sm flex items-center gap-1.5"><i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-400"></i> ✅ RESCUE ACK RECEIVED: Base Station Confirmed Beacon #${targetMessageId}! Rescue Team En Route.</span>`;
    }
    if (statusBadge) {
      statusBadge.textContent = 'ACK RECEIVED ✓';
      statusBadge.className = 'text-[10px] px-3 py-1 rounded-lg bg-emerald-500 text-slate-950 font-mono font-extrabold shadow-lg shadow-emerald-950/50';
    }
    if (trackingDot) {
      trackingDot.innerHTML = `
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
        <span class="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
      `;
    }
    if (meshBadge) {
      meshBadge.textContent = 'ACK CONFIRMED ✓';
      meshBadge.className = 'text-[10px] px-2 py-0.5 rounded bg-emerald-500 text-slate-950 font-bold';
    }

    AppState.stats.ackCount++;
    const ackCountEl = document.getElementById('statAckCount');
    if (ackCountEl) ackCountEl.textContent = AppState.stats.ackCount;

    playAckSuccessChime();

    if (window.lucide) window.lucide.createIcons();
  }

  function playAckSuccessChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1);
      osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2);
      osc.frequency.setValueAtTime(1046.50, ctx.currentTime + 0.3);

      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.05);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.55);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    } catch (e) {}
  }

  /* -------------------------------------------------------------------------- */
  /*                AUTHENTIC RESCUE EMERGENCY SIREN (RECEIVER)                 */
  /* -------------------------------------------------------------------------- */

  function playEmergencySiren() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const totalCycles = 3;
      const cycleDuration = 0.75; // 0.75s per wail cycle
      const totalDuration = totalCycles * cycleDuration;

      // Master Gain
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.001, now);
      masterGain.gain.linearRampToValueAtTime(0.45, now + 0.04);
      masterGain.gain.setValueAtTime(0.45, now + totalDuration - 0.08);
      masterGain.gain.linearRampToValueAtTime(0.001, now + totalDuration);
      masterGain.connect(ctx.destination);

      // Primary Siren Oscillator (Sawtooth for high-penetration emergency tone)
      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';

      // Secondary Oscillator (Triangle wave for resonant acoustic body)
      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';

      for (let i = 0; i < totalCycles; i++) {
        const cycleStart = now + i * cycleDuration;
        const midPoint = cycleStart + cycleDuration * 0.5;
        const cycleEnd = cycleStart + cycleDuration;

        // Undulating emergency pitch sweep: 620 Hz -> 1480 Hz -> 620 Hz
        osc1.frequency.setValueAtTime(620, cycleStart);
        osc1.frequency.exponentialRampToValueAtTime(1480, midPoint);
        osc1.frequency.exponentialRampToValueAtTime(620, cycleEnd);

        // Harmonic layer: 310 Hz -> 740 Hz -> 310 Hz
        osc2.frequency.setValueAtTime(310, cycleStart);
        osc2.frequency.exponentialRampToValueAtTime(740, midPoint);
        osc2.frequency.exponentialRampToValueAtTime(310, cycleEnd);
      }

      osc1.connect(masterGain);
      osc2.connect(masterGain);

      osc1.start(now);
      osc2.start(now);

      osc1.stop(now + totalDuration + 0.05);
      osc2.stop(now + totalDuration + 0.05);
    } catch (e) {
      console.warn('Siren audio notice:', e);
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                    PACKET RECEIVED & MESH RELAY ENGINE                     */
  /* -------------------------------------------------------------------------- */

  function handleIncomingPacket(packet, voiceAttachment = null) {
    if (packet.isAck || packet.distressType === 15) {
      handleIncomingAck(packet.messageId);
      return;
    }

    if (AppState.seenPacketIds.has(packet.messageId)) {
      return;
    }

    // Attach or extract persistent Device ID
    const devId = packet.deviceId || (voiceAttachment && voiceAttachment.deviceId) || `DEV-${((packet.messageId * 17) % 9000 + 1000).toString(16).toUpperCase()}`;
    packet.deviceId = devId;

    // Check if this sender device has been blacklisted / blocked
    const blocked = getBlockedDevices();
    if (blocked.some(b => b.deviceId === devId)) {
      console.warn(`[SilentBridge Anti-Misuse] 🚫 Blocked rogue beacon #${packet.messageId} from blacklisted device: ${devId}`);
      return;
    }

    AppState.seenPacketIds.add(packet.messageId);

    if (voiceAttachment) {
      packet.hasVoice = true;
      packet.voiceDataUrl = voiceAttachment.dataUrl || voiceAttachment.voiceDataUrl;
      packet.voiceDuration = voiceAttachment.duration || voiceAttachment.voiceDuration || 3.0;
    } else {
      packet.hasVoice = false;
    }

    // AUTOMATIC FALSE ALARM IDENTIFICATION & TRIAGE ENGINE:
    // If coordinates are (0,0) or missing and no voice SOS is attached, classify as potential false alarm
    const hasValidGps = (packet.latitude !== 0 || packet.longitude !== 0) && Math.abs(packet.latitude) <= 90 && Math.abs(packet.longitude) <= 180;
    const isExplicitPanic = packet.message && (packet.message.includes('PANIC') || packet.message.includes('RESCUE') || packet.message.includes('TRAPPED') || packet.message.includes('MEDIC'));
    
    if (!hasValidGps && !packet.hasVoice) {
      packet.isFalseAlarm = true;
      packet.autoFlagged = true;
      packet.autoFlaggedReason = 'Missing Satellite GPS & No Voice SOS Memo Attached';
      console.warn(`[SilentBridge Triage] ⚠️ Auto-Flagged Potential False Alarm on Beacon #${packet.messageId}: ${packet.autoFlaggedReason}`);
    } else {
      packet.isFalseAlarm = false;
      packet.isVerified = true;
    }

    AppState.stats.rxCount++;
    const rxCountEl = document.getElementById('statRxCount');
    if (rxCountEl) rxCountEl.textContent = AppState.stats.rxCount;

    AppState.receivedPackets.unshift(packet);
    renderEmergencyFeeds();
    setActiveVoiceDispatch(packet);
    persistDistressPackets();

    // 🚨 Sound Siren for verified emergency beacons (Mute siren for auto-flagged false alarms)
    if (!packet.isFalseAlarm) {
      playEmergencySiren();
    } else {
      playMutedFalseAlarmBeep();
    }
  }

  function playMutedFalseAlarmBeep() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {}
  }

  function persistDistressPackets() {
    try {
      localStorage.setItem('silentbridge_distress_history', JSON.stringify(AppState.receivedPackets.slice(0, 50)));
    } catch (e) {}
  }

  function loadPersistedDistressPackets() {
    try {
      const raw = localStorage.getItem('silentbridge_distress_history');
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list) && list.length > 0) {
          list.forEach(p => {
            if (!AppState.seenPacketIds.has(p.messageId)) {
              AppState.seenPacketIds.add(p.messageId);
              AppState.receivedPackets.push(p);
            }
          });
          AppState.stats.rxCount = AppState.receivedPackets.length;
          const rxCountEl = document.getElementById('statRxCount');
          if (rxCountEl) rxCountEl.textContent = AppState.stats.rxCount;
          renderEmergencyFeeds();
          if (AppState.receivedPackets.length > 0) {
            setActiveVoiceDispatch(AppState.receivedPackets[0]);
          }
        }
      }
    } catch (e) {}
  }

  /* -------------------------------------------------------------------------- */
  /*            CROSS-TAB BROADCASTCHANNEL & STORAGE SYNCHRONIZATION            */
  /* -------------------------------------------------------------------------- */

  function initCrossTabSync() {
    try {
      if ('BroadcastChannel' in window) {
        AppState.syncChannel = new BroadcastChannel('silentbridge_instant_sync');
        AppState.syncChannel.onmessage = (event) => {
          processSyncEvent(event.data);
        };
      }
    } catch (e) {}

    // Bulletproof Window Storage Event Listener (Ensures delivery across all tabs/windows)
    window.addEventListener('storage', (event) => {
      try {
        if (event.key === 'silentbridge_last_distress_event' && event.newValue) {
          const data = JSON.parse(event.newValue);
          processSyncEvent(data);
        } else if (event.key === 'silentbridge_last_ack_event' && event.newValue) {
          const data = JSON.parse(event.newValue);
          if (data && data.targetMessageId) {
            handleIncomingAck(data.targetMessageId);
          }
        }
      } catch (e) {}
    });

    loadPersistedDistressPackets();
  }

  function processSyncEvent(data) {
    if (!data) return;
    if (data.type === 'DISTRESS_BROADCAST') {
      const rawBytes = PacketEngine.fromHex(data.packetHex);
      const parsed = PacketEngine.parsePacket(rawBytes);
      if (parsed.valid) {
        parsed.deviceId = data.deviceId || getOrCreateDeviceId();
        handleIncomingPacket(parsed, {
          dataUrl: data.voiceDataUrl,
          duration: data.voiceDuration,
          deviceId: data.deviceId
        });
      }
    } else if (data.type === 'ACK_BROADCAST') {
      handleIncomingAck(data.targetMessageId);
    }
  }

  function broadcastDistressCrossTab(packetBytes, voiceDataUrl, voiceDuration) {
    const payload = {
      type: 'DISTRESS_BROADCAST',
      packetHex: PacketEngine.toHex(packetBytes, ''),
      voiceDataUrl: voiceDataUrl || null,
      voiceDuration: voiceDuration || 0,
      deviceId: getOrCreateDeviceId(),
      timestamp: Date.now(),
      eventId: Math.random().toString(36).substring(2)
    };

    if (AppState.syncChannel) {
      try {
        AppState.syncChannel.postMessage(payload);
      } catch (e) {}
    }

    // Storage Event Dispatch for Instant Cross-Tab Notification
    try {
      localStorage.setItem('silentbridge_last_distress_event', JSON.stringify(payload));
    } catch (e) {}
  }

  /* -------------------------------------------------------------------------- */
  /*                  INSTANT DISPATCH PIPELINE & GESTURE ENGINE                */
  /* -------------------------------------------------------------------------- */

  const SafetyPipeline = {
    // 1. Gesture Hold Configuration & State (1.5s Threshold)
    gesture: {
      active: false,
      cameraStream: null,
      handsDetector: null,
      currentDetectedGesture: null,
      holdStartTime: null,
      holdDurationMs: 1500, // 1.5s Threshold
      isHolding: false,
      holdAnimFrameRef: null
    },

    // Clean up animation frames
    cleanupAllTimers() {
      if (this.gesture.holdAnimFrameRef) {
        cancelAnimationFrame(this.gesture.holdAnimFrameRef);
        this.gesture.holdAnimFrameRef = null;
      }
    },

    // 1. GESTURE HOLD (1.5s Threshold)
    onGestureDetected(gestureName, rawLandmarks = null) {
      if (!gestureName) {
        if (this.gesture.isHolding || this.gesture.holdStartTime) {
          this.resetGestureHold();
        }
        this.updateGestureBadge(null);
        return;
      }

      // If new gesture started
      if (this.gesture.currentDetectedGesture !== gestureName) {
        this.resetGestureHold();
        this.gesture.currentDetectedGesture = gestureName;
        this.gesture.holdStartTime = Date.now();
        this.gesture.isHolding = true;
        this.updateGestureBadge(gestureName);
        this.startHoldCountdown(gestureName);
      }
    },

    startHoldCountdown(gestureName) {
      const hud = document.getElementById('gestureHoldHud');
      const progressBar = document.getElementById('gestureHoldProgressBar');
      const percentText = document.getElementById('gestureHoldPercentText');
      const label = document.getElementById('gestureHoldLabel');

      if (hud) hud.classList.remove('hidden');

      const gestureTitles = {
        FIST: '✊ CLOSED FIST (PANIC SOS)',
        POINTING: '☝️ POINTING (MEDICAL SOS)',
        V_SIGN: '✌️ V-SIGN (EVAC / RESCUE SOS)'
      };

      if (label) label.textContent = `HOLDING ${gestureTitles[gestureName] || gestureName} (1.5s)...`;

      const checkProgress = () => {
        if (!this.gesture.isHolding || !this.gesture.holdStartTime) return;

        const elapsed = Date.now() - this.gesture.holdStartTime;
        const progress = Math.min(100, (elapsed / this.gesture.holdDurationMs) * 100);

        if (progressBar) progressBar.style.width = `${progress}%`;
        if (percentText) percentText.textContent = `${Math.round(progress)}%`;

        if (elapsed >= this.gesture.holdDurationMs) {
          // 1.5s Hold Complete! TRANSMIT IMMEDIATELY!
          console.log(`[Safety Pipeline] 1.5s Hold Complete! Instant Dispatching gesture: ${gestureName}`);
          this.resetGestureHold();
          
          const distressType = gestureName === 'FIST' ? 2 : (gestureName === 'POINTING' ? 1 : 4);
          const defaultMsgs = {
            FIST: 'GESTURE SOS: TRAPPED',
            POINTING: 'GESTURE SOS: MEDIC',
            V_SIGN: 'GESTURE SOS: EVAC'
          };

          executePanicSosDispatch({
            source: 'gesture',
            gestureName: gestureName,
            distressType: distressType,
            message: defaultMsgs[gestureName] || 'GESTURE SOS'
          });
          return;
        }

        this.gesture.holdAnimFrameRef = requestAnimationFrame(checkProgress);
      };

      this.gesture.holdAnimFrameRef = requestAnimationFrame(checkProgress);
    },

    resetGestureHold() {
      this.gesture.isHolding = false;
      this.gesture.holdStartTime = null;
      this.gesture.currentDetectedGesture = null;

      if (this.gesture.holdAnimFrameRef) {
        cancelAnimationFrame(this.gesture.holdAnimFrameRef);
        this.gesture.holdAnimFrameRef = null;
      }

      const hud = document.getElementById('gestureHoldHud');
      const progressBar = document.getElementById('gestureHoldProgressBar');
      const percentText = document.getElementById('gestureHoldPercentText');

      if (hud) hud.classList.add('hidden');
      if (progressBar) progressBar.style.width = '0%';
      if (percentText) percentText.textContent = '0%';
    },

    updateGestureBadge(gestureName) {
      const badge = document.getElementById('gestureDetectedBadge');
      if (!badge) return;

      if (!gestureName) {
        badge.innerHTML = `
          <span class="w-2 h-2 rounded-full bg-slate-500 animate-pulse"></span>
          <span>Waiting for Hand Sign...</span>
        `;
        badge.className = 'text-[11px] font-mono px-2.5 py-1 rounded-lg bg-black/70 text-slate-300 border border-white/20 backdrop-blur-sm font-bold flex items-center gap-1.5';
      } else if (gestureName === 'FIST') {
        badge.innerHTML = `
          <span class="w-2 h-2 rounded-full bg-red-400 animate-ping"></span>
          <span class="text-rose-300">✊ CLOSED FIST DETECTED // HOLD 1.5s</span>
        `;
        badge.className = 'text-[11px] font-mono px-2.5 py-1 rounded-lg bg-red-950/80 text-rose-200 border border-red-500/50 backdrop-blur-sm font-bold flex items-center gap-1.5';
      } else if (gestureName === 'POINTING') {
        badge.innerHTML = `
          <span class="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
          <span class="text-amber-300">☝️ POINTING INDEX DETECTED // HOLD 1.5s</span>
        `;
        badge.className = 'text-[11px] font-mono px-2.5 py-1 rounded-lg bg-amber-950/80 text-amber-200 border border-amber-500/50 backdrop-blur-sm font-bold flex items-center gap-1.5';
      } else if (gestureName === 'V_SIGN') {
        badge.innerHTML = `
          <span class="w-2 h-2 rounded-full bg-blue-400 animate-ping"></span>
          <span class="text-blue-300">✌️ V-SIGN DETECTED // HOLD 1.5s</span>
        `;
        badge.className = 'text-[11px] font-mono px-2.5 py-1 rounded-lg bg-blue-950/80 text-blue-200 border border-blue-500/50 backdrop-blur-sm font-bold flex items-center gap-1.5';
      }
    }
  };

  /* -------------------------------------------------------------------------- */
  /*                  ACTUAL PAYLOAD TRANSMISSION HANDLERS                      */
  /* -------------------------------------------------------------------------- */

  async function executePanicSosDispatch(payload = {}) {
    acquireHighAccuracyGps();

    const messageId = PacketEngine.generateMessageId();
    AppState.lastSentMessageId = messageId;

    const trackingCard = document.getElementById('senderLiveTrackingCard');
    const statusText = document.getElementById('senderTrackingStatusText');
    const statusBadge = document.getElementById('senderTrackingBadge');
    const trackingDot = document.getElementById('senderTrackingDot');

    if (trackingCard) {
      trackingCard.className = 'bg-tactical-900/90 border border-amber-500/60 rounded-2xl p-4 shadow-xl font-mono text-xs flex items-center justify-between gap-3 mb-6';
    }
    if (statusText) {
      statusText.innerHTML = `<span class="text-amber-300 font-extrabold">🚨 EMERGENCY BEACON #${messageId} TRANSMITTED // Awaiting Base Station ACK...</span>`;
    }
    if (statusBadge) {
      statusBadge.textContent = 'SOS DISPATCHED';
      statusBadge.className = 'text-[10px] px-2.5 py-1 rounded-lg bg-red-600 text-white font-mono font-bold animate-pulse shadow-md';
    }
    if (trackingDot) {
      trackingDot.innerHTML = `
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
        <span class="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
      `;
    }

    const packetBytes = PacketEngine.createPacket({
      messageId: messageId,
      distressType: payload.distressType || AppState.activeDistressType || 1,
      latitude: AppState.currentLat,
      longitude: AppState.currentLon,
      message: payload.message || 'PANIC SOS: NEED RESCUE',
      ttl: 3
    });

    const voiceDataUrl = AppState.voice.dataUrl;
    const voiceDuration = AppState.voice.durationSeconds;

    try {
      broadcastDistressCrossTab(packetBytes, voiceDataUrl, voiceDuration);

      const parsed = PacketEngine.parsePacket(packetBytes);
      if (parsed.valid) {
        parsed.deviceId = getOrCreateDeviceId();
        handleIncomingPacket(parsed, {
          dataUrl: voiceDataUrl,
          duration: voiceDuration,
          deviceId: parsed.deviceId
        });
      }

      if (AppState.audioModem) {
        AppState.audioModem.transmitPacket(packetBytes).catch(() => {});
      }

      discardVoiceRecording();

      AppState.stats.txCount++;
      const txCountEl = document.getElementById('statTxCount');
      if (txCountEl) txCountEl.textContent = AppState.stats.txCount;

    } catch (err) {
      alert(`Dispatch Notice: ${err.message}`);
    }
  }

  async function executeRegularSosDispatch(payload = {}) {
    const latInput = document.getElementById('senderInputLat') || document.getElementById('meshInputLat');
    const lonInput = document.getElementById('senderInputLon') || document.getElementById('meshInputLon');
    const msgInput = document.getElementById('senderInputMessage') || document.getElementById('meshInputMessage');

    const lat = parseFloat(latInput ? latInput.value : AppState.currentLat) || AppState.currentLat;
    const lon = parseFloat(lonInput ? lonInput.value : AppState.currentLon) || AppState.currentLon;
    const msg = msgInput ? msgInput.value : (payload.message || 'NEED RESCUE ASAP');
    const messageId = PacketEngine.generateMessageId();
    AppState.lastSentMessageId = messageId;

    const trackingCard = document.getElementById('senderLiveTrackingCard');
    const statusText = document.getElementById('senderTrackingStatusText');
    const statusBadge = document.getElementById('senderTrackingBadge');
    const trackingDot = document.getElementById('senderTrackingDot');

    if (trackingCard) {
      trackingCard.className = 'bg-tactical-900/90 border border-amber-500/50 rounded-2xl p-4 shadow-xl font-mono text-xs flex items-center justify-between gap-3 mb-6';
    }
    if (statusText) {
      statusText.innerHTML = `Beacon #${messageId} Broadcasted (<span class="text-amber-400 font-bold">Awaiting Base Station ACK...</span>)`;
    }
    if (statusBadge) {
      statusBadge.textContent = 'AWAITING ACK...';
      statusBadge.className = 'text-[10px] px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono font-bold animate-pulse';
    }
    if (trackingDot) {
      trackingDot.innerHTML = `
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
        <span class="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
      `;
    }

    const packetBytes = PacketEngine.createPacket({
      messageId: messageId,
      distressType: AppState.activeDistressType,
      latitude: lat,
      longitude: lon,
      message: msg,
      ttl: 3
    });

    const voiceDataUrl = AppState.voice.dataUrl;
    const voiceDuration = AppState.voice.durationSeconds;

    try {
      broadcastDistressCrossTab(packetBytes, voiceDataUrl, voiceDuration);

      const parsed = PacketEngine.parsePacket(packetBytes);
      if (parsed.valid) {
        parsed.deviceId = getOrCreateDeviceId();
        handleIncomingPacket(parsed, {
          dataUrl: voiceDataUrl,
          duration: voiceDuration,
          deviceId: parsed.deviceId
        });
      }

      if (AppState.audioModem) {
        AppState.audioModem.transmitPacket(packetBytes).catch(() => {});
      }

      if (msgInput) msgInput.value = '';
      const charCounter = document.getElementById('senderCharCounter');
      if (charCounter) charCounter.textContent = '0 / 17 Bytes';
      discardVoiceRecording();

      AppState.stats.txCount++;
      const txCountEl = document.getElementById('statTxCount');
      if (txCountEl) txCountEl.textContent = AppState.stats.txCount;

    } catch (err) {
      alert(`Transmission Notice: ${err.message}`);
    }
  }

  /* -------------------------------------------------------------------------- */
  /*               INSTANT DISPATCH HANDLERS (ZERO DELAY / ZERO LOCKOUT)        */
  /* -------------------------------------------------------------------------- */

  function handleOneTapPanicSos() {
    executePanicSosDispatch({
      source: 'panic',
      distressType: AppState.activeDistressType || 1,
      message: 'PANIC SOS: NEED RESCUE'
    });
  }

  function handleBroadcastSos(source) {
    const msg = document.getElementById('senderInputMessage')?.value || 'NEED RESCUE ASAP';
    executeRegularSosDispatch({
      source: 'regular',
      distressType: AppState.activeDistressType || 1,
      message: msg
    });
  }

  /* -------------------------------------------------------------------------- */
  /*                MEDIAPIPE HANDS-FREE GESTURE CLASSIFIER                     */
  /* -------------------------------------------------------------------------- */

  function classifyHandLandmarks(landmarks) {
    if (!landmarks || landmarks.length < 21) return null;

    // Landmark indexes:
    // Wrist: 0, Thumb Tip: 4, Index Tip: 8, Middle Tip: 12, Ring Tip: 16, Pinky Tip: 20
    // Index PIP: 6, Middle PIP: 10, Ring PIP: 14, Pinky PIP: 18
    const isIndexExtended = landmarks[8].y < landmarks[6].y;
    const isMiddleExtended = landmarks[12].y < landmarks[10].y;
    const isRingExtended = landmarks[16].y < landmarks[14].y;
    const isPinkyExtended = landmarks[20].y < landmarks[18].y;

    // 1. Closed Fist: All 4 fingers folded below PIP
    if (!isIndexExtended && !isMiddleExtended && !isRingExtended && !isPinkyExtended) {
      return 'FIST';
    }

    // 2. Pointing Index: Only index extended
    if (isIndexExtended && !isMiddleExtended && !isRingExtended && !isPinkyExtended) {
      return 'POINTING';
    }

    // 3. V-Sign (Peace): Index and Middle extended, Ring and Pinky folded
    if (isIndexExtended && isMiddleExtended && !isRingExtended && !isPinkyExtended) {
      return 'V_SIGN';
    }

    return null;
  }

  function drawLandmarksOnCanvas(ctx, landmarks, width, height) {
    ctx.strokeStyle = '#06B6D4';
    ctx.lineWidth = 2;
    ctx.fillStyle = '#EF4444';

    // Draw landmark points
    for (let i = 0; i < landmarks.length; i++) {
      const x = landmarks[i].x * width;
      const y = landmarks[i].y * height;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  async function toggleMediaPipeGestureCamera() {
    const video = document.getElementById('gestureVideoElement');
    const canvas = document.getElementById('gestureCanvasOverlay');
    const container = document.getElementById('gestureCameraContainer');
    const btnText = document.getElementById('gestureCameraBtnText');

    if (SafetyPipeline.gesture.active) {
      // Stop Camera
      if (SafetyPipeline.gesture.cameraStream) {
        SafetyPipeline.gesture.cameraStream.getTracks().forEach(t => t.stop());
        SafetyPipeline.gesture.cameraStream = null;
      }
      SafetyPipeline.gesture.active = false;
      if (container) container.classList.add('hidden');
      if (btnText) btnText.textContent = 'Start Gesture Camera';
      SafetyPipeline.resetGestureHold();
      return;
    }

    try {
      if (container) container.classList.remove('hidden');
      if (btnText) btnText.textContent = 'Stop Gesture Camera';

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      });
      SafetyPipeline.gesture.cameraStream = stream;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }

      SafetyPipeline.gesture.active = true;

      // Initialize MediaPipe Hands if library is loaded
      if (window.Hands && window.Camera) {
        const hands = new window.Hands({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });

        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.55
        });

        hands.onResults((results) => {
          if (!SafetyPipeline.gesture.active || !canvas) return;
          const ctx = canvas.getContext('2d');
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 480;
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const landmarks = results.multiHandLandmarks[0];
            drawLandmarksOnCanvas(ctx, landmarks, canvas.width, canvas.height);
            const gesture = classifyHandLandmarks(landmarks);
            SafetyPipeline.onGestureDetected(gesture, landmarks);
          } else {
            SafetyPipeline.onGestureDetected(null);
          }
        });

        const camera = new window.Camera(video, {
          onFrame: async () => {
            if (SafetyPipeline.gesture.active && video.readyState >= 2) {
              await hands.send({ image: video });
            }
          },
          width: 640,
          height: 480
        });

        camera.start();
        SafetyPipeline.gesture.handsDetector = hands;
      }
    } catch (err) {
      console.warn('Camera notice:', err);
      alert(`Camera Notice: ${err.message}\nYou can use the 1.5s Hold Test buttons below!`);
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                           MAIN APP INITIALIZATION                          */
  /* -------------------------------------------------------------------------- */

  function initApp() {
    initRoleFromHash();
    initRescueAuth();
    initVoiceRecorder();
    initReceiverVoicePlayer();
    initGpsTracking();
    initCrossTabSync();

    // Register Service Worker for 100% Offline PWA execution
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js')
        .then(() => console.log('[SilentBridge] 100% Offline Service Worker Active ✓'))
        .catch((err) => console.warn('[SilentBridge] Service Worker registration note:', err));
    }

    setInterval(updateClock, 1000);
    updateClock();

    AppState.audioModem = new AudioModem({ mode: 'ultrasonic' });

    AppState.audioModem.onTxStart = () => {
      ['senderBroadcastBtnText', 'meshBroadcastBtnText'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = 'TRANSMITTING ACOUSTIC SOS...';
      });
    };

    AppState.audioModem.onTxProgress = ({ progressPercent }) => {
      ['senderTxProgressOverlay', 'meshTxProgressOverlay'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.width = `${progressPercent}%`;
      });
    };

    AppState.audioModem.onTxEnd = () => {
      ['senderBroadcastBtnText', 'meshBroadcastBtnText'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = id.includes('sender') ? 'BROADCAST ACOUSTIC SOS & VOICE' : 'BROADCAST ACOUSTIC SOS';
      });
      ['senderTxProgressOverlay', 'meshTxProgressOverlay'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.width = '0%';
      });
    };

    AppState.audioModem.onPacketReceived = (packet) => {
      handleIncomingPacket(packet, null);
    };

    const startAudioOnce = async () => {
      try {
        await AppState.audioModem.startListening();
        updateAudioPowerButton(true);
      } catch (err) {
        updateAudioPowerButton(false);
      }
      window.removeEventListener('click', startAudioOnce);
    };
    window.addEventListener('click', startAudioOnce);

    setupUIEventListeners();
  }

  function updateAudioPowerButton(isActive) {
    const btn = document.getElementById('btnToggleAudio');
    const text = document.getElementById('audioPowerText');
    const ping = document.getElementById('audioPowerPing');
    const dot = document.getElementById('audioPowerDot');

    if (!btn || !text) return;

    if (isActive) {
      btn.className = 'px-3 py-1.5 rounded-lg font-mono text-xs font-bold transition-all flex items-center gap-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/40 shadow-sm';
      text.textContent = 'MODEM: ON';
      if (ping) ping.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75';
      if (dot) dot.className = 'relative inline-flex rounded-full h-2 w-2 bg-emerald-500';
    } else {
      btn.className = 'px-3 py-1.5 rounded-lg font-mono text-xs font-bold transition-all flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700 shadow-sm';
      text.textContent = 'MODEM: OFF';
      if (ping) ping.className = 'hidden';
      if (dot) dot.className = 'relative inline-flex rounded-full h-2 w-2 bg-slate-500';
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                            UI EVENT LISTENERS SETUP                        */
  /* -------------------------------------------------------------------------- */

  function setupUIEventListeners() {
    const navSender = document.getElementById('navBtnSender');
    const navReceiver = document.getElementById('navBtnReceiver');
    const navMesh = document.getElementById('navBtnMesh');

    if (navSender) navSender.addEventListener('click', () => setRole('sender'));
    if (navReceiver) navReceiver.addEventListener('click', () => setRole('receiver'));
    if (navMesh) navMesh.addEventListener('click', () => setRole('mesh'));

    const btnAudio = document.getElementById('btnToggleAudio');
    if (btnAudio) {
      btnAudio.addEventListener('click', async () => {
        if (AppState.audioModem.isListening) {
          AppState.audioModem.stopListening();
          updateAudioPowerButton(false);
        } else {
          try {
            await AppState.audioModem.startListening();
            updateAudioPowerButton(true);
          } catch (e) {
            alert('Microphone permission is required.');
          }
        }
      });
    }

    const btnUltra = document.getElementById('btnModeUltrasonic');
    const btnAudible = document.getElementById('btnModeAudible');

    if (btnUltra && btnAudible) {
      btnUltra.addEventListener('click', () => {
        AppState.audioModem.setFrequencyMode('ultrasonic');
        btnUltra.className = 'px-2.5 py-1 rounded-md font-semibold transition-all flex items-center gap-1.5 bg-cyan-500 text-slate-950 shadow-sm';
        btnAudible.className = 'px-2.5 py-1 rounded-md font-semibold transition-all text-slate-400 hover:text-white flex items-center gap-1.5';
      });

      btnAudible.addEventListener('click', () => {
        AppState.audioModem.setFrequencyMode('audible');
        btnAudible.className = 'px-2.5 py-1 rounded-md font-semibold transition-all flex items-center gap-1.5 bg-cyan-500 text-slate-950 shadow-sm';
        btnUltra.className = 'px-2.5 py-1 rounded-md font-semibold transition-all text-slate-400 hover:text-white flex items-center gap-1.5';
      });
    }

    document.querySelectorAll('.distress-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const typeId = parseInt(btn.dataset.distress, 10);
        AppState.activeDistressType = typeId;

        document.querySelectorAll('.distress-btn').forEach(b => {
          b.className = 'distress-btn p-3.5 rounded-xl border text-left transition-all flex flex-col gap-1.5 bg-tactical-850 border-tactical-border text-slate-400 hover:border-slate-600';
        });

        const meta = PacketEngine.DISTRESS_TYPES[typeId];
        document.querySelectorAll(`[data-distress="${typeId}"]`).forEach(b => {
          b.className = `distress-btn active p-3.5 rounded-xl border text-left transition-all flex flex-col gap-1.5 ${meta.bgClass} shadow-md`;
        });

        const sPri = document.getElementById('senderDistressPriority');
        if (sPri) {
          sPri.textContent = `${meta.priority} // PRIORITY ${typeId}`;
          sPri.style.color = meta.color;
        }
      });
    });

    const btnSenderGps = document.getElementById('btnSenderGps');
    if (btnSenderGps) btnSenderGps.addEventListener('click', acquireHighAccuracyGps);

    document.querySelectorAll('.btn-preset-loc').forEach(btn => {
      btn.addEventListener('click', () => {
        const lat = parseFloat(btn.dataset.lat);
        const lon = parseFloat(btn.dataset.lon);
        AppState.currentLat = lat;
        AppState.currentLon = lon;

        const sLat = document.getElementById('senderInputLat');
        const sLon = document.getElementById('senderInputLon');
        if (sLat) sLat.value = lat.toFixed(6);
        if (sLon) sLon.value = lon.toFixed(6);
      });
    });

    document.querySelectorAll('.btn-preset-msg').forEach(btn => {
      btn.addEventListener('click', () => {
        const msg = btn.dataset.msg;
        const input = document.getElementById('senderInputMessage');
        if (input) {
          input.value = msg;
          input.dispatchEvent(new Event('input'));
        }
      });
    });

    const senderMsgInput = document.getElementById('senderInputMessage');
    if (senderMsgInput) {
      senderMsgInput.addEventListener('input', () => {
        const len = senderMsgInput.value.length;
        const counter = document.getElementById('senderCharCounter');
        if (counter) counter.textContent = `${len} / 17 Bytes`;
      });
    }

    // ⚡ 1-Tap Panic SOS Button
    const btnOneTap = document.getElementById('btnOneTapPanicSos');
    if (btnOneTap) btnOneTap.addEventListener('click', handleOneTapPanicSos);

    const btnSenderBroadcast = document.getElementById('btnSenderBroadcastSos');
    const btnMeshBroadcast = document.getElementById('btnMeshBroadcastSos');

    if (btnSenderBroadcast) btnSenderBroadcast.addEventListener('click', () => handleBroadcastSos('sender'));
    if (btnMeshBroadcast) btnMeshBroadcast.addEventListener('click', () => handleBroadcastSos('mesh'));

    const btnSim = document.getElementById('btnSimulatePacket');
    if (btnSim) {
      btnSim.addEventListener('click', () => {
        const randomSenders = [
          { dLat: 0.008, dLon: -0.005, msg: 'TRAPPED BASEMENT', type: 2, attachVoice: true },
          { dLat: -0.012, dLon: 0.009, msg: 'FLOOD RISING FL2', type: 4, attachVoice: true },
          { dLat: 0.015, dLon: 0.012, msg: 'MEDIC NEEDED', type: 1, attachVoice: true },
          { dLat: 0.000, dLon: 0.000, msg: 'TEST HOAX / FAKE', type: 6, attachVoice: false },
          { dLat: -0.006, dLon: -0.008, msg: 'LANDSLIDE COLLAPSE', type: 5, attachVoice: true },
          { dLat: 0.004, dLon: 0.003, msg: 'FIRE IN 3RD FLOOR', type: 3, attachVoice: true },
          { dLat: 0.000, dLon: 0.000, msg: 'NO VOICE SPAM', type: 1, attachVoice: false }
        ];
        const sample = randomSenders[Math.floor(Math.random() * randomSenders.length)];
        const simPacket = PacketEngine.createPacket({
          distressType: sample.type,
          latitude: sample.attachVoice ? AppState.currentLat + sample.dLat : 0.0,
          longitude: sample.attachVoice ? AppState.currentLon + sample.dLon : 0.0,
          message: sample.msg,
          ttl: 2
        });
        const parsed = PacketEngine.parsePacket(simPacket);
        handleIncomingPacket(parsed, sample.attachVoice ? {
          dataUrl: AppState.voice.dataUrl,
          duration: AppState.voice.durationSeconds || 3.0
        } : null);
      });
    }

    const btnTestSiren = document.getElementById('btnTestSiren');
    if (btnTestSiren) {
      btnTestSiren.addEventListener('click', () => {
        playEmergencySiren();
      });
    }

    const btnRxClear = document.getElementById('btnReceiverClearFeed');
    const btnMeshClear = document.getElementById('btnMeshClearFeed');

    const clearAllFeeds = () => {
      AppState.receivedPackets = [];
      AppState.seenPacketIds.clear();
      AppState.stats.rxCount = 0;
      const rxCountEl = document.getElementById('statRxCount');
      if (rxCountEl) rxCountEl.textContent = '0';
      try {
        localStorage.removeItem('silentbridge_distress_history');
      } catch (e) {}
      renderEmergencyFeeds();
    };

    if (btnRxClear) btnRxClear.addEventListener('click', clearAllFeeds);
    if (btnMeshClear) btnMeshClear.addEventListener('click', clearAllFeeds);

    const btnDismissAck = document.getElementById('btnDismissAck');
    if (btnDismissAck) {
      btnDismissAck.addEventListener('click', () => {
        const banner = document.getElementById('senderAckBanner');
        if (banner) banner.classList.add('hidden');
      });
    }

    // Blocked Rogue Devices Modal Event Listeners
    const btnOpenBlocked = document.getElementById('btnOpenBlockedModal');
    const modalBlocked = document.getElementById('modalBlockedDevices');
    const btnCloseBlocked = document.getElementById('btnCloseBlockedModal');
    const btnCloseBlockedFooter = document.getElementById('btnCloseBlockedModalFooter');

    if (btnOpenBlocked && modalBlocked) {
      btnOpenBlocked.addEventListener('click', () => {
        renderBlockedDevicesModal();
        modalBlocked.classList.remove('hidden');
      });
    }

    if (btnCloseBlocked && modalBlocked) {
      btnCloseBlocked.addEventListener('click', () => {
        modalBlocked.classList.add('hidden');
      });
    }

    // Safety Dispatch Pipeline Listeners
    const btnCancelDispatch = document.getElementById('btnCancelDispatch');
    if (btnCancelDispatch) {
      btnCancelDispatch.addEventListener('click', () => {
        SafetyPipeline.abortCancelOverlay();
      });
    }

    const btnToggleGesture = document.getElementById('btnToggleGestureCamera');
    if (btnToggleGesture) {
      btnToggleGesture.addEventListener('click', toggleMediaPipeGestureCamera);
    }

    document.querySelectorAll('.btn-test-gesture').forEach(btn => {
      btn.addEventListener('click', () => {
        const gesture = btn.dataset.gesture;
        SafetyPipeline.onGestureDetected(gesture);
      });
    });

    // Cleanup all timers on unload
    window.addEventListener('beforeunload', () => {
      SafetyPipeline.cleanupAllTimers();
    });

    updateBlockedCountBadge();
  }

  document.addEventListener('DOMContentLoaded', initApp);
})();
