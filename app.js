/**
 * SilentBridge - Main Application Controller
 * Features:
 *  - Instant SOS Broadcasting (received by receiver in < 1-2 seconds).
 *  - 6 Disaster Classifications (Medical, Trapped, Fire, Flood, Earthquake, Supplies).
 *  - Streamlined Sender Interface (Auto GPS coordinates, timestamped message, voice memo with Re-Record).
 *  - Auto-Clearing Sender Form on transmit.
 *  - Simplified Clean Receiver Interface (Disaster cards, Voice SOS player, Direct Google Maps links, Send ACK).
 *  - 100% Offline Acoustic Modulation & Multi-Tab Synchronization.
 */

(function () {
  'use strict';

  // Global Application State
  const AppState = {
    currentRole: 'mesh', // 'sender' | 'receiver' | 'mesh'
    audioModem: null,

    // Telemetry & Packets
    receivedPackets: [],       // Array of parsed packet objects from multiple senders
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
    const elapsedHours = Math.floor(elapsedMinutes / 60);
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
    const hash = window.location.hash.replace('#', '').toLowerCase();
    if (hash === 'sender' || hash === 'receiver' || hash === 'mesh') {
      setRole(hash);
    } else {
      setRole('mesh');
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                       HIGH-ACCURACY GPS TRACKER                            */
  /* -------------------------------------------------------------------------- */

  function initGpsTracking() {
    acquireHighAccuracyGps();

    if (navigator.geolocation) {
      try {
        AppState.gpsWatchId = navigator.geolocation.watchPosition(
          (pos) => onGpsSuccess(pos),
          (err) => console.warn('GPS Watch Notice:', err.message),
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 }
        );
      } catch (e) {}
    }
  }

  function acquireHighAccuracyGps() {
    const btnSenderLabel = document.getElementById('senderGpsLabel');
    if (btnSenderLabel) btnSenderLabel.textContent = 'Acquiring GPS...';

    if (!navigator.geolocation) {
      if (btnSenderLabel) btnSenderLabel.textContent = 'GPS Unavailable';
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onGpsSuccess(pos);
        if (btnSenderLabel) btnSenderLabel.textContent = 'GPS Locked ✓';
      },
      (err) => {
        console.warn('GPS fix notice:', err.message);
        if (btnSenderLabel) btnSenderLabel.textContent = 'Retry GPS Fix';
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  function onGpsSuccess(pos) {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const accuracy = pos.coords.accuracy || 3.5;

    AppState.currentLat = lat;
    AppState.currentLon = lon;
    AppState.gpsAccuracyMeters = accuracy;

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
      sAccPill.textContent = `± ${accuracy.toFixed(1)}m (${accuracy <= 5 ? 'High Precision' : 'GPS Fix'})`;
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

        return `
          <div class="p-4 sm:p-5 rounded-2xl border ${meta.bgClass} bg-tactical-900/95 shadow-xl transition-all hover:border-slate-500 relative" id="card_${pkt.messageId}">
            
            <!-- Top Line: Disaster Badge, Timestamp -->
            <div class="flex items-center justify-between mb-2.5">
              <div class="flex items-center gap-2">
                <span class="px-3 py-1 rounded-lg text-xs font-mono font-extrabold uppercase ${meta.badgeClass} flex items-center gap-1.5 shadow-sm">
                  <i data-lucide="${meta.icon}" class="w-4 h-4"></i>
                  ${meta.name}
                </span>
                <span class="text-xs font-mono text-slate-400 font-bold">#${pkt.messageId}</span>
              </div>
              <div class="text-xs font-mono text-slate-400 flex items-center gap-1.5">
                <i data-lucide="clock" class="w-3.5 h-3.5 text-slate-500"></i>
                <span>${pkt.timeString || timeStr}</span>
              </div>
            </div>

            <!-- Message & Voice Tag -->
            <div class="text-base font-mono font-extrabold text-white mb-3 tracking-wide flex items-center justify-between">
              <span>"${pkt.message}"</span>
              ${pkt.hasVoice ? `
                <span class="px-2.5 py-1 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs flex items-center gap-1 font-bold">
                  <i data-lucide="mic" class="w-3.5 h-3.5"></i> VOICE SOS ATTACHED
                </span>
              ` : ''}
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

            <!-- Action Controls: Listen Voice, Send ACK, Clear -->
            <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-tactical-border/50">
              <div class="flex items-center gap-2.5">
                <button type="button" class="btn-play-voice-card text-xs px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold transition-all flex items-center gap-1.5 shadow-md shadow-rose-950/40" data-msgid="${pkt.messageId}">
                  <i data-lucide="play" class="w-4 h-4"></i> Play Voice SOS
                </button>
                <button type="button" class="btn-send-ack text-xs px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold transition-all flex items-center gap-1.5 shadow-md shadow-emerald-950/40" data-msgid="${pkt.messageId}">
                  <i data-lucide="check-check" class="w-4 h-4"></i> Send ACK
                </button>
              </div>

              <div>
                <button type="button" class="btn-clear-single-beacon text-xs px-3 py-1.5 rounded-lg bg-tactical-800 hover:bg-tactical-700 text-slate-400 hover:text-slate-200 font-mono transition-colors" data-msgid="${pkt.messageId}">
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
        btn.textContent = 'ACK Sent ✓';
        btn.className = 'text-xs px-3.5 py-2 rounded-xl bg-emerald-900 text-emerald-300 border border-emerald-500/40 font-mono font-bold';
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

      AppState.stats.ackCount++;
      const ackCountEl = document.getElementById('statAckCount');
      if (ackCountEl) ackCountEl.textContent = AppState.stats.ackCount;

    } catch (e) {}
  }

  function handleIncomingAck(targetMessageId) {
    const banner = document.getElementById('senderAckBanner');
    const timeEl = document.getElementById('ackTimestamp');
    const msgEl = document.getElementById('ackMessageText');

    if (banner) {
      banner.classList.remove('hidden');
      if (timeEl) timeEl.textContent = new Date().toTimeString().split(' ')[0];
      if (msgEl) msgEl.textContent = `Base Station Confirmed Distress Beacon #${targetMessageId}! Rescue is En Route.`;
    }

    AppState.stats.ackCount++;
    const ackCountEl = document.getElementById('statAckCount');
    if (ackCountEl) ackCountEl.textContent = AppState.stats.ackCount;

    playAckSuccessChime();
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
      gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.5);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.55);
    } catch (e) {}
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

    AppState.seenPacketIds.add(packet.messageId);

    if (voiceAttachment) {
      packet.hasVoice = true;
      packet.voiceDataUrl = voiceAttachment.dataUrl || voiceAttachment.voiceDataUrl;
      packet.voiceDuration = voiceAttachment.duration || voiceAttachment.voiceDuration || 3.0;
    } else {
      packet.hasVoice = false;
    }

    AppState.stats.rxCount++;
    const rxCountEl = document.getElementById('statRxCount');
    if (rxCountEl) rxCountEl.textContent = AppState.stats.rxCount;

    AppState.receivedPackets.unshift(packet);
    renderEmergencyFeeds();
    setActiveVoiceDispatch(packet);

    playReceptionChirp();
  }

  function playReceptionChirp() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.15);

      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.02);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.22);
    } catch (e) {}
  }

  /* -------------------------------------------------------------------------- */
  /*            CROSS-TAB BROADCASTCHANNEL SYNCHRONIZATION                      */
  /* -------------------------------------------------------------------------- */

  function initCrossTabSync() {
    try {
      if ('BroadcastChannel' in window) {
        AppState.syncChannel = new BroadcastChannel('silentbridge_instant_sync');
        AppState.syncChannel.onmessage = (event) => {
          const data = event.data;
          if (data && data.type === 'DISTRESS_BROADCAST') {
            const rawBytes = PacketEngine.fromHex(data.packetHex);
            const parsed = PacketEngine.parsePacket(rawBytes);
            if (parsed.valid) {
              handleIncomingPacket(parsed, {
                dataUrl: data.voiceDataUrl,
                duration: data.voiceDuration
              });
            }
          } else if (data && data.type === 'ACK_BROADCAST') {
            handleIncomingAck(data.targetMessageId);
          }
        };
      }
    } catch (e) {}
  }

  function broadcastDistressCrossTab(packetBytes, voiceDataUrl, voiceDuration) {
    if (AppState.syncChannel) {
      AppState.syncChannel.postMessage({
        type: 'DISTRESS_BROADCAST',
        packetHex: PacketEngine.toHex(packetBytes, ''),
        voiceDataUrl: voiceDataUrl || null,
        voiceDuration: voiceDuration || 0,
        timestamp: Date.now()
      });
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                 INSTANT TRANSMIT SOS HANDLER & AUTO-CLEAR                  */
  /* -------------------------------------------------------------------------- */

  async function handleBroadcastSos(source) {
    const isSenderView = (source === 'sender');

    const latInput = isSenderView ? document.getElementById('senderInputLat') : document.getElementById('meshInputLat');
    const lonInput = isSenderView ? document.getElementById('senderInputLon') : document.getElementById('meshInputLon');
    const msgInput = isSenderView ? document.getElementById('senderInputMessage') : document.getElementById('meshInputMessage');

    const lat = parseFloat(latInput ? latInput.value : AppState.currentLat) || AppState.currentLat;
    const lon = parseFloat(lonInput ? lonInput.value : AppState.currentLon) || AppState.currentLon;
    const msg = msgInput ? msgInput.value : 'NEED RESCUE ASAP';
    const messageId = PacketEngine.generateMessageId();
    AppState.lastSentMessageId = messageId;

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
      // 1. Instant Cross-tab and local dispatch (arrives within milliseconds)
      broadcastDistressCrossTab(packetBytes, voiceDataUrl, voiceDuration);

      const parsed = PacketEngine.parsePacket(packetBytes);
      if (parsed.valid) {
        handleIncomingPacket(parsed, {
          dataUrl: voiceDataUrl,
          duration: voiceDuration
        });
      }

      // 2. High-speed acoustic burst transmission (~400ms)
      if (AppState.audioModem) {
        AppState.audioModem.transmitPacket(packetBytes).catch(() => {});
      }

      // 3. Clear sender form automatically
      if (isSenderView) {
        if (msgInput) msgInput.value = '';
        const charCounter = document.getElementById('senderCharCounter');
        if (charCounter) charCounter.textContent = '0 / 17 Bytes';
        discardVoiceRecording();
      }

      AppState.stats.txCount++;
      const txCountEl = document.getElementById('statTxCount');
      if (txCountEl) txCountEl.textContent = AppState.stats.txCount;

    } catch (err) {
      alert(`Transmission Notice: ${err.message}`);
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                           MAIN APP INITIALIZATION                          */
  /* -------------------------------------------------------------------------- */

  function initApp() {
    initRoleFromHash();
    initVoiceRecorder();
    initReceiverVoicePlayer();
    initGpsTracking();
    initCrossTabSync();

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

    const btnSenderBroadcast = document.getElementById('btnSenderBroadcastSos');
    const btnMeshBroadcast = document.getElementById('btnMeshBroadcastSos');

    if (btnSenderBroadcast) btnSenderBroadcast.addEventListener('click', () => handleBroadcastSos('sender'));
    if (btnMeshBroadcast) btnMeshBroadcast.addEventListener('click', () => handleBroadcastSos('mesh'));

    const btnSim = document.getElementById('btnSimulatePacket');
    if (btnSim) {
      btnSim.addEventListener('click', () => {
        const randomSenders = [
          { dLat: 0.008, dLon: -0.005, msg: 'TRAPPED BASEMENT', type: 2 },
          { dLat: -0.012, dLon: 0.009, msg: 'FLOOD RISING FL2', type: 4 },
          { dLat: 0.015, dLon: 0.012, msg: 'MEDIC NEEDED', type: 1 },
          { dLat: -0.006, dLon: -0.008, msg: 'LANDSLIDE COLLAPSE', type: 5 },
          { dLat: 0.004, dLon: 0.003, msg: 'FIRE IN 3RD FLOOR', type: 3 },
          { dLat: -0.009, dLon: 0.002, msg: 'SHELTER 20 PEOPLE', type: 6 }
        ];
        const sample = randomSenders[Math.floor(Math.random() * randomSenders.length)];
        const simPacket = PacketEngine.createPacket({
          distressType: sample.type,
          latitude: AppState.currentLat + sample.dLat,
          longitude: AppState.currentLon + sample.dLon,
          message: sample.msg,
          ttl: 2
        });
        const parsed = PacketEngine.parsePacket(simPacket);
        handleIncomingPacket(parsed, {
          dataUrl: AppState.voice.dataUrl,
          duration: AppState.voice.durationSeconds || 3.0
        });
      });
    }

    const btnRxClear = document.getElementById('btnReceiverClearFeed');
    const btnMeshClear = document.getElementById('btnMeshClearFeed');

    const clearAllFeeds = () => {
      AppState.receivedPackets = [];
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
  }

  document.addEventListener('DOMContentLoaded', initApp);
})();
