/**
 * SilentBridge - Main Application Controller
 * Features:
 *  - Dedicated Sender, Receiver, and Unified Mesh role views.
 *  - High-Accuracy GPS tracking with accuracy confidence circles and live pin-pointing.
 *  - Emergency Voice Memo Recorder with live mic waveform visualization.
 *  - Cross-tab & acoustic synchronized Voice SOS transmission and reception.
 *  - Rescue Command Voice Dispatch Audio Player with +6dB field gain booster and live playback visualizer.
 *  - Dual Leaflet radar maps, 2048-point FFT spectrum visualizer, and CCITT CRC-16 telemetry feed.
 */

(function () {
  'use strict';

  // Global Application State
  const AppState = {
    currentRole: 'mesh', // 'sender' | 'receiver' | 'mesh'
    audioModem: null,
    receiverMap: null,
    meshMap: null,
    receiverUserMarker: null,
    receiverAccuracyCircle: null,
    meshUserMarker: null,
    meshAccuracyCircle: null,
    distressMarkers: new Map(), // messageId -> Leaflet Layer
    receivedPackets: [],       // Array of parsed packet objects
    seenPacketIds: new Set(),
    activeDistressType: 1,
    currentLat: 37.774900,
    currentLon: -122.419400,
    gpsAccuracyMeters: 3.5,
    gpsWatchId: null,
    visualizerMode: 'spectrum', // 'spectrum' | 'waterfall'
    waterfallHistory: [],
    waterfallMaxRows: 120,
    
    // Voice Recording State (Sender)
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
      audioCtx: null,
      waveformPeaks: []
    },

    // Voice Playback State (Receiver)
    player: {
      activePacket: null,
      audioElement: null,
      audioCtx: null,
      sourceNode: null,
      gainNode: null,
      analyserNode: null,
      boostMultiplier: 1.0, // 1.0x, 2.0x, 3.0x
      isPlaying: false,
      animationFrameId: null
    },

    // BroadcastChannel for cross-tab multi-device sync
    syncChannel: null,

    // Statistics
    stats: {
      txCount: 0,
      rxCount: 0,
      voiceCount: 0,
      relayCount: 0,
      crcErrors: 0
    }
  };

  /* -------------------------------------------------------------------------- */
  /*                            UTILITIES & HELPERS                             */
  /* -------------------------------------------------------------------------- */

  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    const distMeters = R * c;
    if (distMeters < 1000) {
      return `${Math.round(distMeters)} m`;
    }
    return `${(distMeters / 1000).toFixed(2)} km`;
  }

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

    // Reset button styles
    [navSender, navReceiver, navMesh].forEach(btn => {
      if (btn) {
        btn.className = 'role-nav-btn px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-2 text-slate-400 hover:text-white';
      }
    });

    // Hide all views
    [viewSender, viewReceiver, viewMesh].forEach(v => {
      if (v) v.classList.add('hidden');
      if (v) v.classList.remove('flex');
    });

    if (role === 'sender') {
      if (navSender) navSender.className = 'role-nav-btn active px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-2 bg-red-600 text-white shadow-md';
      if (viewSender) {
        viewSender.classList.remove('hidden');
        viewSender.classList.add('flex');
      }
    } else if (role === 'receiver') {
      if (navReceiver) navReceiver.className = 'role-nav-btn active px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-2 bg-cyan-500 text-slate-950 shadow-md';
      if (viewReceiver) {
        viewReceiver.classList.remove('hidden');
        viewReceiver.classList.add('flex');
      }
      setTimeout(() => {
        if (AppState.receiverMap) AppState.receiverMap.invalidateSize();
      }, 100);
    } else {
      // Mesh (Default / Dual)
      if (navMesh) navMesh.className = 'role-nav-btn active px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-2 bg-cyan-500 text-slate-950 shadow-md';
      if (viewMesh) {
        viewMesh.classList.remove('hidden');
      }
      setTimeout(() => {
        if (AppState.meshMap) AppState.meshMap.invalidateSize();
      }, 100);
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
    if (!navigator.geolocation) {
      console.warn('Geolocation API not supported.');
      return;
    }

    acquireHighAccuracyGps();

    // Continuous watch for field responder positioning
    try {
      AppState.gpsWatchId = navigator.geolocation.watchPosition(
        (pos) => onGpsSuccess(pos),
        (err) => console.warn('GPS Watch Notice:', err.message),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 }
      );
    } catch (e) {
      console.warn('GPS Watch failed:', e);
    }
  }

  function acquireHighAccuracyGps() {
    const btnSenderLabel = document.getElementById('senderGpsLabel');
    const btnMeshLabel = document.getElementById('meshGpsLabel');
    if (btnSenderLabel) btnSenderLabel.textContent = 'Acquiring GPS Fix...';
    if (btnMeshLabel) btnMeshLabel.textContent = 'Acquiring GPS...';

    if (!navigator.geolocation) {
      alert('Geolocation API is not available on this browser/device.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onGpsSuccess(pos);
        if (btnSenderLabel) btnSenderLabel.textContent = 'GPS Locked ✓';
        if (btnMeshLabel) btnMeshLabel.textContent = 'GPS Locked ✓';
      },
      (err) => {
        console.warn('High-accuracy GPS fix failed or timed out:', err);
        if (btnSenderLabel) btnSenderLabel.textContent = 'Retry GPS Fix';
        if (btnMeshLabel) btnMeshLabel.textContent = 'Retry GPS';
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  }

  function onGpsSuccess(pos) {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const accuracy = pos.coords.accuracy || 4.0;

    AppState.currentLat = lat;
    AppState.currentLon = lon;
    AppState.gpsAccuracyMeters = accuracy;

    // Update form coordinate inputs
    const sLat = document.getElementById('senderInputLat');
    const sLon = document.getElementById('senderInputLon');
    const mLat = document.getElementById('meshInputLat');
    const mLon = document.getElementById('meshInputLon');

    if (sLat) sLat.value = lat.toFixed(6);
    if (sLon) sLon.value = lon.toFixed(6);
    if (mLat) mLat.value = lat.toFixed(6);
    if (mLon) mLon.value = lon.toFixed(6);

    // Update GPS Accuracy Badges
    const accStr = `±${accuracy.toFixed(1)}m (${accuracy <= 5 ? 'HIGH PRECISION' : accuracy <= 20 ? 'GOOD FIX' : 'APPROXIMATE'})`;
    const statGpsAcc = document.getElementById('statGpsAccuracy');
    const sAccPill = document.getElementById('senderGpsAccuracyPill');

    if (statGpsAcc) statGpsAcc.textContent = `±${accuracy.toFixed(1)}m`;
    if (sAccPill) {
      sAccPill.textContent = accStr;
      sAccPill.className = accuracy <= 5 ? 'text-emerald-400 font-bold' : accuracy <= 20 ? 'text-cyan-400 font-bold' : 'text-amber-400 font-bold';
    }

    // Update Map Markers & Accuracy Rings
    updateMapPositions(lat, lon, accuracy);
  }

  /* -------------------------------------------------------------------------- */
  /*                             LEAFLET MAP ENGINES                            */
  /* -------------------------------------------------------------------------- */

  function initMaps() {
    if (typeof L === 'undefined') return;

    // 1. Receiver Radar Map
    const rxMapEl = document.getElementById('receiverMap');
    if (rxMapEl) {
      AppState.receiverMap = L.map('receiverMap', {
        zoomControl: true,
        attributionControl: false
      }).setView([AppState.currentLat, AppState.currentLon], 13);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd'
      }).addTo(AppState.receiverMap);
    }

    // 2. Unified Mesh Map
    const meshMapEl = document.getElementById('meshMap');
    if (meshMapEl) {
      AppState.meshMap = L.map('meshMap', {
        zoomControl: true,
        attributionControl: false
      }).setView([AppState.currentLat, AppState.currentLon], 13);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd'
      }).addTo(AppState.meshMap);
    }

    // Update Initial Node Markers
    updateMapPositions(AppState.currentLat, AppState.currentLon, AppState.gpsAccuracyMeters);
  }

  function updateMapPositions(lat, lon, accuracy) {
    if (typeof L === 'undefined') return;

    // User Marker DivIcon
    const userIcon = L.divIcon({
      className: 'custom-user-marker',
      html: `
        <div class="relative flex items-center justify-center w-8 h-8">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-60"></span>
          <span class="relative inline-flex items-center justify-center rounded-full h-4 w-4 bg-cyan-500 border-2 border-slate-950 shadow-lg text-[8px] font-bold text-slate-950 font-mono">ME</span>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    // Update Receiver Map
    if (AppState.receiverMap) {
      if (AppState.receiverUserMarker) {
        AppState.receiverUserMarker.setLatLng([lat, lon]);
      } else {
        AppState.receiverUserMarker = L.marker([lat, lon], { icon: userIcon }).addTo(AppState.receiverMap)
          .bindPopup(`<div class="p-1 font-mono text-xs text-slate-200"><strong class="text-cyan-400">LOCAL BASE NODE</strong><br>Lat: ${lat.toFixed(6)}<br>Lon: ${lon.toFixed(6)}<br>Acc: ±${accuracy.toFixed(1)}m</div>`);
      }

      if (AppState.receiverAccuracyCircle) {
        AppState.receiverAccuracyCircle.setLatLng([lat, lon]);
        AppState.receiverAccuracyCircle.setRadius(accuracy);
      } else {
        AppState.receiverAccuracyCircle = L.circle([lat, lon], {
          radius: accuracy,
          color: '#06B6D4',
          fillColor: '#06B6D4',
          fillOpacity: 0.12,
          weight: 1.5,
          dashArray: '4, 4'
        }).addTo(AppState.receiverMap);
      }
    }

    // Update Mesh Map
    if (AppState.meshMap) {
      if (AppState.meshUserMarker) {
        AppState.meshUserMarker.setLatLng([lat, lon]);
      } else {
        AppState.meshUserMarker = L.marker([lat, lon], { icon: userIcon }).addTo(AppState.meshMap)
          .bindPopup(`<div class="p-1 font-mono text-xs text-slate-200"><strong class="text-cyan-400">LOCAL NODE</strong><br>Lat: ${lat.toFixed(6)}<br>Lon: ${lon.toFixed(6)}</div>`);
      }

      if (AppState.meshAccuracyCircle) {
        AppState.meshAccuracyCircle.setLatLng([lat, lon]);
        AppState.meshAccuracyCircle.setRadius(accuracy);
      } else {
        AppState.meshAccuracyCircle = L.circle([lat, lon], {
          radius: accuracy,
          color: '#06B6D4',
          fillColor: '#06B6D4',
          fillOpacity: 0.12,
          weight: 1.5,
          dashArray: '4, 4'
        }).addTo(AppState.meshMap);
      }
    }
  }

  function addDistressToMaps(packet) {
    if (typeof L === 'undefined') return;

    const meta = packet.distressMeta || PacketEngine.DISTRESS_TYPES[packet.distressType];
    const markerColor = meta.color || '#EF4444';

    const distressIcon = L.divIcon({
      className: `custom-distress-marker marker-${packet.messageId}`,
      html: `
        <div class="relative flex items-center justify-center w-9 h-9" style="color: ${markerColor};">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style="background-color: ${markerColor};"></span>
          <div class="relative inline-flex items-center justify-center rounded-full h-6 w-6 border-2 border-slate-950 shadow-xl font-mono text-[10px] font-extrabold text-white" style="background-color: ${markerColor};">
            #${packet.distressType}
          </div>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    const distStr = calculateDistance(AppState.currentLat, AppState.currentLon, packet.latitude, packet.longitude);

    const popupHtml = `
      <div class="p-1 font-mono text-xs text-slate-200 space-y-1">
        <div class="flex items-center justify-between gap-2 border-b border-tactical-border pb-1">
          <strong style="color: ${markerColor};">${meta.name}</strong>
          <span class="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">#${packet.messageId}</span>
        </div>
        <div class="text-white font-bold">"${packet.message}"</div>
        <div class="text-slate-400 text-[11px]">Distance: <span class="text-cyan-400 font-bold">${distStr}</span></div>
        <div class="text-slate-400 text-[11px]">Voice Attached: <span class="${packet.hasVoice ? 'text-rose-400 font-bold' : 'text-slate-500'}">${packet.hasVoice ? 'YES (Audio Memo)' : 'No (Text SOS)'}</span></div>
        <div class="text-[10px] text-slate-500">${packet.latitude.toFixed(6)}, ${packet.longitude.toFixed(6)}</div>
      </div>
    `;

    // Add to Receiver Map
    if (AppState.receiverMap) {
      const rxMarker = L.marker([packet.latitude, packet.longitude], { icon: distressIcon })
        .addTo(AppState.receiverMap)
        .bindPopup(popupHtml);
      AppState.distressMarkers.set(`rx_${packet.messageId}`, rxMarker);
    }

    // Add to Mesh Map
    if (AppState.meshMap) {
      const meshMarker = L.marker([packet.latitude, packet.longitude], { icon: distressIcon })
        .addTo(AppState.meshMap)
        .bindPopup(popupHtml);
      AppState.distressMarkers.set(`mesh_${packet.messageId}`, meshMarker);
    }
  }

  /* -------------------------------------------------------------------------- */
  /*               EMERGENCY VOICE MEMO RECORDER ENGINE (SENDER)                */
  /* -------------------------------------------------------------------------- */

  function initVoiceRecorder() {
    const btnToggleRecord = document.getElementById('btnToggleRecordVoice');
    const btnMeshToggleRecord = document.getElementById('btnMeshToggleRecord');
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

      // Determine supported mimeType
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

      // Set up AudioContext & Analyser for live waveform visualizer during recording
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

      // Update UI
      updateVoiceRecorderUI(true);

      // Start 10s countdown timer
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
      console.error('Failed to access microphone for voice recording:', err);
      alert('Microphone access is required to record emergency voice memos.');
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

    // Convert to Base64 dataURL for cross-tab sync
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

    audio.play().catch(e => console.warn('Preview play error:', e));
  }

  function updateVoiceRecorderUI(isRecording) {
    const btnText = document.getElementById('recordBtnText');
    const btnIcon = document.getElementById('recordIcon');
    const badge = document.getElementById('voiceRecorderStatusBadge');
    const idlePrompt = document.getElementById('voiceCanvasIdlePrompt');
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
    const banner = document.getElementById('voiceAttachedBanner');
    const meta = document.getElementById('voiceAttachedMeta');
    const btnPlay = document.getElementById('btnPlayVoicePreview');
    const btnDiscard = document.getElementById('btnDiscardVoice');
    const meshStatus = document.getElementById('meshVoiceStatus');

    if (hasVoice && AppState.voice.blob) {
      if (banner) banner.classList.remove('hidden');
      if (meta) meta.textContent = `Voice Memo Attached (${AppState.voice.durationSeconds.toFixed(1)}s)`;
      if (btnPlay) btnPlay.disabled = false;
      if (btnDiscard) btnDiscard.disabled = false;
      if (meshStatus) meshStatus.textContent = `Voice Memo: Attached (${AppState.voice.durationSeconds.toFixed(1)}s)`;
    } else {
      if (banner) banner.classList.add('hidden');
      if (btnPlay) btnPlay.disabled = true;
      if (btnDiscard) btnDiscard.disabled = true;
      if (meshStatus) meshStatus.textContent = 'Voice Memo: None';
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
        ctx.strokeStyle = '#F43F5E'; // Tactical Rose
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
        // Draw static recorded waveform preview
        ctx.fillStyle = '#10B981'; // Emerald
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

    if (btnPlay) {
      btnPlay.addEventListener('click', () => {
        toggleVoicePlayback();
      });
    }

    if (btnMeshPlay) {
      btnMeshPlay.addEventListener('click', () => {
        toggleVoicePlayback();
      });
    }

    if (btnBoost) {
      btnBoost.addEventListener('click', () => {
        cycleVoiceBoost();
      });
    }

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
    const durStr = packet.voiceDuration ? `${packet.voiceDuration.toFixed(1)}s` : '3.5s';

    if (badge) {
      badge.textContent = hasAudio ? `VOICE MEMO (#${packet.messageId})` : `TTS DISPATCH (#${packet.messageId})`;
      badge.className = 'text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold';
    }

    const desc = `Distress Beacon #${packet.messageId} • ${packet.distressMeta.name} • "${packet.message}" • Duration: ${durStr}`;
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
      // Play real audio memo recorded from sender with Web Audio Gain Boost
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

        audio.onended = () => {
          stopVoicePlayback();
        };

        AppState.player.isPlaying = true;
        updatePlaybackButtonUI(true);
        await audio.play();

      } catch (err) {
        console.warn('Web Audio player fallback to standard HTML5 audio:', err);
        const audio = new Audio(packet.voiceDataUrl);
        AppState.player.audioElement = audio;
        audio.onended = () => stopVoicePlayback();
        AppState.player.isPlaying = true;
        updatePlaybackButtonUI(true);
        audio.play();
      }
    } else {
      // Fallback to SpeechSynthesis tactical voice announcement
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

    const text = `Emergency Alert. Distress classification: ${packet.distressMeta.name}. Message: ${packet.message}. Distance: ${calculateDistance(AppState.currentLat, AppState.currentLon, packet.latitude, packet.longitude)}.`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 0.95;

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
  /*                    CANVAS SPECTRUM & WATERFALL VISUALIZER                  */
  /* -------------------------------------------------------------------------- */

  function initVisualizers() {
    const rxCanvas = document.getElementById('receiverVisualizerCanvas');
    const meshCanvas = document.getElementById('meshVisualizerCanvas');

    [rxCanvas, meshCanvas].forEach(canvas => {
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
        const modem = AppState.audioModem;

        ctx.clearRect(0, 0, width, height);

        if (!modem || !modem.isListening || !modem.fftBuffer) {
          drawIdleGrid(ctx, width, height);
        } else if (AppState.visualizerMode === 'spectrum') {
          drawSpectrumBars(ctx, width, height, modem);
        } else {
          drawWaterfall(ctx, width, height, modem);
        }

        requestAnimationFrame(render);
      }

      render();
    });
  }

  function drawIdleGrid(ctx, width, height) {
    ctx.strokeStyle = '#162238';
    ctx.lineWidth = 1;
    for (let y = 0; y < height; y += 25) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.fillStyle = '#475569';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('STANDBY // MODEM LISTENER ARMED', width / 2, height / 2);
  }

  function drawSpectrumBars(ctx, width, height, modem) {
    const buffer = modem.fftBuffer;
    const binCount = buffer.length;
    const sampleRate = (modem.audioCtx && modem.audioCtx.sampleRate) || 48000;
    const nyquist = sampleRate / 2;

    const isUltrasonic = modem.mode === 'ultrasonic';
    const minFreq = isUltrasonic ? 16500 : 1000;
    const maxFreq = isUltrasonic ? 20500 : 3000;

    const minBin = Math.floor((minFreq / nyquist) * binCount);
    const maxBin = Math.ceil((maxFreq / nyquist) * binCount);
    const targetBins = Math.max(1, maxBin - minBin);
    const barWidth = Math.max(2, (width / targetBins));

    const preambleBin = modem.freqToBin(modem.profile.preambleFreq);
    const bit0Bin = modem.freqToBin(modem.profile.bit0Freq);
    const bit1Bin = modem.freqToBin(modem.profile.bit1Freq);

    for (let i = 0; i < targetBins; i++) {
      const binIdx = minBin + i;
      if (binIdx >= binCount) break;

      const rawVal = buffer[binIdx];
      const barHeight = (rawVal / 255) * (height - 15);
      const x = i * barWidth;
      const y = height - barHeight;

      if (Math.abs(binIdx - preambleBin) <= 1) ctx.fillStyle = '#F59E0B';
      else if (Math.abs(binIdx - bit0Bin) <= 1) ctx.fillStyle = '#06B6D4';
      else if (Math.abs(binIdx - bit1Bin) <= 1) ctx.fillStyle = '#10B981';
      else ctx.fillStyle = 'rgba(51, 77, 122, 0.6)';

      ctx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight);
    }
  }

  function drawWaterfall(ctx, width, height, modem) {
    const buffer = modem.fftBuffer;
    const sampleRate = (modem.audioCtx && modem.audioCtx.sampleRate) || 48000;
    const nyquist = sampleRate / 2;

    const isUltrasonic = modem.mode === 'ultrasonic';
    const minFreq = isUltrasonic ? 16500 : 1000;
    const maxFreq = isUltrasonic ? 20500 : 3000;

    const minBin = Math.floor((minFreq / nyquist) * buffer.length);
    const maxBin = Math.ceil((maxFreq / nyquist) * buffer.length);
    const slice = buffer.slice(minBin, maxBin);

    AppState.waterfallHistory.unshift(slice);
    if (AppState.waterfallHistory.length > AppState.waterfallMaxRows) {
      AppState.waterfallHistory.pop();
    }

    const rowHeight = height / AppState.waterfallMaxRows;
    for (let r = 0; r < AppState.waterfallHistory.length; r++) {
      const rowData = AppState.waterfallHistory[r];
      const cellWidth = width / rowData.length;
      const y = r * rowHeight;

      for (let c = 0; c < rowData.length; c++) {
        const val = rowData[c];
        if (val < 40) ctx.fillStyle = '#060911';
        else if (val < 90) ctx.fillStyle = '#1E293B';
        else if (val < 140) ctx.fillStyle = '#0284C7';
        else if (val < 190) ctx.fillStyle = '#06B6D4';
        else if (val < 230) ctx.fillStyle = '#F59E0B';
        else ctx.fillStyle = '#EF4444';

        ctx.fillRect(c * cellWidth, y, Math.ceil(cellWidth), Math.ceil(rowHeight));
      }
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                     LIVE SOS EMERGENCY FEED RENDERER                       */
  /* -------------------------------------------------------------------------- */

  function renderEmergencyFeeds() {
    const rxFeedContainer = document.getElementById('receiverEmergencyFeedList');
    const meshFeedContainer = document.getElementById('meshEmergencyFeedList');

    const buildFeedHtml = () => {
      if (AppState.receivedPackets.length === 0) {
        return `
          <div class="p-6 text-center border border-dashed border-tactical-border rounded-lg bg-tactical-950/50 text-slate-500 font-mono text-xs">
            <i data-lucide="shield-check" class="w-7 h-7 mx-auto mb-2 text-slate-600"></i>
            No active distress beacons received.<br>
            Acoustic listener standing by on carrier frequencies.
          </div>
        `;
      }

      return AppState.receivedPackets.map((pkt) => {
        const meta = pkt.distressMeta || PacketEngine.DISTRESS_TYPES[pkt.distressType];
        const distStr = calculateDistance(AppState.currentLat, AppState.currentLon, pkt.latitude, pkt.longitude);
        const timeStr = formatRelativeTime(pkt.timestamp);

        return `
          <div class="p-3.5 rounded-xl border ${meta.bgClass} bg-tactical-900/90 shadow-md transition-all hover:border-slate-500 relative overflow-hidden group">
            
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${meta.badgeClass}">
                  ${meta.name}
                </span>
                <span class="text-xs font-mono text-slate-400 font-bold">#${pkt.messageId}</span>
              </div>
              <span class="text-[10px] font-mono text-slate-400">${timeStr}</span>
            </div>

            <div class="text-sm font-mono font-bold text-white mb-2 tracking-wide flex items-center justify-between">
              <span>"${pkt.message}"</span>
              ${pkt.hasVoice ? `
                <span class="px-2 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px] flex items-center gap-1 font-bold">
                  <i data-lucide="mic" class="w-3 h-3"></i> VOICE SOS
                </span>
              ` : ''}
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400 border-t border-tactical-border/50 pt-2">
              <div class="flex items-center gap-3">
                <span class="flex items-center gap-1 text-cyan-400">
                  <i data-lucide="navigation" class="w-3 h-3"></i>
                  ${distStr}
                </span>
                <span class="flex items-center gap-1 text-amber-400">
                  <i data-lucide="git-fork" class="w-3 h-3"></i>
                  Hops: ${pkt.ttl}
                </span>
                <span class="text-emerald-400 flex items-center gap-1">
                  <i data-lucide="check-circle" class="w-3 h-3"></i>
                  ${pkt.crcHex}
                </span>
              </div>

              <div class="flex items-center gap-1.5">
                <button type="button" class="btn-play-voice-card text-[10px] px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold transition-colors flex items-center gap-1" data-msgid="${pkt.messageId}">
                  <i data-lucide="play" class="w-3 h-3"></i> Play Voice
                </button>
                <button type="button" class="btn-inspect-hex text-[10px] px-2 py-1 rounded bg-tactical-800 hover:bg-tactical-700 text-slate-300 font-mono transition-colors" data-msgid="${pkt.messageId}">
                  Hex
                </button>
                <button type="button" class="btn-focus-map text-[10px] px-2 py-1 rounded bg-cyan-950 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-900 font-mono transition-colors" data-lat="${pkt.latitude}" data-lon="${pkt.longitude}">
                  Map
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

    // Attach Event Handlers for dynamically rendered feed cards
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

    document.querySelectorAll('.btn-inspect-hex').forEach(btn => {
      btn.addEventListener('click', () => {
        const msgId = parseInt(btn.dataset.msgid, 10);
        const packet = AppState.receivedPackets.find(p => p.messageId === msgId);
        if (packet) showHexModal(packet);
      });
    });

    document.querySelectorAll('.btn-focus-map').forEach(btn => {
      btn.addEventListener('click', () => {
        const lat = parseFloat(btn.dataset.lat);
        const lon = parseFloat(btn.dataset.lon);
        if (AppState.receiverMap) AppState.receiverMap.setView([lat, lon], 15, { animate: true });
        if (AppState.meshMap) AppState.meshMap.setView([lat, lon], 15, { animate: true });
      });
    });
  }

  /* -------------------------------------------------------------------------- */
  /*                    PACKET RECEIVED & MESH RELAY ENGINE                     */
  /* -------------------------------------------------------------------------- */

  function handleIncomingPacket(packet, voiceAttachment = null) {
    console.log('[SilentBridge] Processing incoming packet:', packet);

    if (AppState.seenPacketIds.has(packet.messageId)) {
      console.log(`[SilentBridge Mesh] Dropping duplicate #${packet.messageId}`);
      return;
    }

    AppState.seenPacketIds.add(packet.messageId);

    // Attach voice memo if provided
    if (voiceAttachment) {
      packet.hasVoice = true;
      packet.voiceDataUrl = voiceAttachment.dataUrl || voiceAttachment.voiceDataUrl;
      packet.voiceDuration = voiceAttachment.duration || voiceAttachment.voiceDuration || 3.5;
    } else {
      packet.hasVoice = false;
    }

    AppState.stats.rxCount++;
    if (packet.hasVoice) AppState.stats.voiceCount++;

    const rxCountEl = document.getElementById('statRxCount');
    const voiceCountEl = document.getElementById('statVoiceCount');
    if (rxCountEl) rxCountEl.textContent = AppState.stats.rxCount;
    if (voiceCountEl) voiceCountEl.textContent = AppState.stats.voiceCount;

    AppState.receivedPackets.unshift(packet);
    renderEmergencyFeeds();
    addDistressToMaps(packet);
    setActiveVoiceDispatch(packet);

    playReceptionChirp();

    // Auto-relay if TTL > 0
    if (packet.ttl > 0) {
      const relayData = PacketEngine.decrementTTL(packet.rawBytes);
      const jitterMs = Math.floor(800 + Math.random() * 1000);

      setTimeout(async () => {
        if (!AppState.audioModem) return;
        try {
          await AppState.audioModem.transmitPacket(relayData.packet);
          AppState.stats.relayCount++;
        } catch (err) {
          console.warn('[SilentBridge Mesh] Relay transmission error:', err);
        }
      }, jitterMs);
    }
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
        AppState.syncChannel = new BroadcastChannel('silentbridge_mesh_sync');
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
          }
        };
      }
    } catch (e) {
      console.warn('BroadcastChannel sync init failed:', e);
    }
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
  /*                          HEX MODAL INSPECTOR                               */
  /* -------------------------------------------------------------------------- */

  function showHexModal(packet) {
    const modal = document.getElementById('hexModal');
    if (!modal) return;

    document.getElementById('modalHexDump').textContent = packet.rawHex || PacketEngine.toHex(packet.rawBytes);
    document.getElementById('modalSync').textContent = '0x' + packet.syncByte.toString(16).toUpperCase().padStart(2, '0');
    document.getElementById('modalMsgId').textContent = `#${packet.messageId} (0x${packet.messageId.toString(16).toUpperCase()})`;
    document.getElementById('modalType').textContent = `${packet.distressType} (${packet.distressMeta.name})`;
    document.getElementById('modalTtl').textContent = `${packet.ttl} Hops`;
    document.getElementById('modalLat').textContent = packet.latitude.toFixed(6);
    document.getElementById('modalLon').textContent = packet.longitude.toFixed(6);
    document.getElementById('modalMsg').textContent = `"${packet.message}"`;
    document.getElementById('modalCrc').textContent = `${packet.crcHex} (${packet.crcValid ? 'VALID' : 'CORRUPTED'})`;

    modal.showModal();
  }

  /* -------------------------------------------------------------------------- */
  /*                            TRANSMIT SOS HANDLER                            */
  /* -------------------------------------------------------------------------- */

  async function handleBroadcastSos(source) {
    const isSenderView = (source === 'sender');

    const latInput = isSenderView ? document.getElementById('senderInputLat') : document.getElementById('meshInputLat');
    const lonInput = isSenderView ? document.getElementById('senderInputLon') : document.getElementById('meshInputLon');
    const msgInput = isSenderView ? document.getElementById('senderInputMessage') : document.getElementById('meshInputMessage');
    const ttlSelect = isSenderView ? document.getElementById('senderSelectTtl') : document.getElementById('selectTtl');

    const lat = parseFloat(latInput ? latInput.value : AppState.currentLat) || AppState.currentLat;
    const lon = parseFloat(lonInput ? lonInput.value : AppState.currentLon) || AppState.currentLon;
    const msg = msgInput ? msgInput.value : 'NEED RESCUE ASAP';
    const ttl = ttlSelect ? parseInt(ttlSelect.value, 10) : 3;

    const packetBytes = PacketEngine.createPacket({
      distressType: AppState.activeDistressType,
      latitude: lat,
      longitude: lon,
      message: msg,
      ttl: ttl
    });

    const voiceDataUrl = AppState.voice.dataUrl;
    const voiceDuration = AppState.voice.durationSeconds;

    try {
      // 1. Physical Acoustic Transmission (emits BFSK tone sequence)
      await AppState.audioModem.transmitPacket(packetBytes);

      // 2. Cross-tab synchronization
      broadcastDistressCrossTab(packetBytes, voiceDataUrl, voiceDuration);

      // 3. Add to local feed
      const parsed = PacketEngine.parsePacket(packetBytes);
      if (parsed.valid) {
        handleIncomingPacket(parsed, {
          dataUrl: voiceDataUrl,
          duration: voiceDuration
        });
      }
    } catch (err) {
      alert(`Transmission Notice: ${err.message}`);
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                           MAIN APP INITIALIZATION                          */
  /* -------------------------------------------------------------------------- */

  function initApp() {
    initRoleFromHash();
    initMaps();
    initVisualizers();
    initVoiceRecorder();
    initReceiverVoicePlayer();
    initGpsTracking();
    initCrossTabSync();

    // Instantiate Audio Modem Engine
    AppState.audioModem = new AudioModem({ mode: 'ultrasonic' });

    // Audio Modem Event Callbacks
    AppState.audioModem.onTxStart = () => {
      ['senderBroadcastBtnText', 'meshBroadcastBtnText'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = 'TRANSMITTING BFSK TONES...';
      });
    };

    AppState.audioModem.onTxProgress = ({ currentBit, totalBits, progressPercent }) => {
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
      AppState.stats.txCount++;
      const txCountEl = document.getElementById('statTxCount');
      if (txCountEl) txCountEl.textContent = AppState.stats.txCount;
    };

    AppState.audioModem.onRxStateChange = (state) => {
      ['receiverRxStateBadge', 'meshRxStateBadge'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.textContent = state;
          el.className = state === 'LISTENING' ? 'px-2 py-0.5 rounded text-xs font-mono font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'px-2 py-0.5 rounded text-xs font-mono font-bold uppercase bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse';
        }
      });
    };

    AppState.audioModem.onRxProgress = ({ currentBit, totalBits, bitValue, progressPercent }) => {
      ['receiverRxBitCounter', 'meshRxBitCounter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = `${currentBit} / ${totalBits} BITS`;
      });
      const pBar = document.getElementById('receiverRxProgressBar');
      if (pBar) pBar.style.width = `${progressPercent}%`;

      const viewer = document.getElementById('receiverBitStreamViewer');
      if (viewer) {
        const bitClass = bitValue === 1 ? 'text-emerald-400 font-bold' : 'text-slate-400';
        viewer.innerHTML += `<span class="${bitClass}">${bitValue}</span>`;
        if (currentBit % 8 === 0) viewer.innerHTML += ' ';
        viewer.scrollTop = viewer.scrollHeight;
      }
    };

    AppState.audioModem.onPacketReceived = (packet) => {
      handleIncomingPacket(packet, null);
    };

    AppState.audioModem.onAudioLevels = ({ snr, noiseFloor, peakFreq }) => {
      const snrStr = `${snr.toFixed(1)} dB`;
      const floorStr = `${noiseFloor.toFixed(1)} dB`;
      const freqStr = `${Math.round(peakFreq).toLocaleString()} Hz`;

      const statSnr = document.getElementById('statSnr');
      if (statSnr) statSnr.textContent = snrStr;

      const rSnr = document.getElementById('receiverHudSnr');
      const rFloor = document.getElementById('receiverHudNoiseFloor');
      const rFreq = document.getElementById('receiverHudPeakFreq');

      if (rSnr) rSnr.textContent = snrStr;
      if (rFloor) rFloor.textContent = floorStr;
      if (rFreq) rFreq.textContent = freqStr;

      const mSnr = document.getElementById('meshHudSnr');
      const mFloor = document.getElementById('meshHudNoiseFloor');
      const mFreq = document.getElementById('meshHudPeakFreq');

      if (mSnr) mSnr.textContent = snrStr;
      if (mFloor) mFloor.textContent = floorStr;
      if (mFreq) mFreq.textContent = freqStr;
    };

    // Auto-start listener on first user click gesture
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
  /*                            EVENT LISTENERS SETUP                           */
  /* -------------------------------------------------------------------------- */

  function setupUIEventListeners() {
    // 1. Role Navigation Buttons
    const navSender = document.getElementById('navBtnSender');
    const navReceiver = document.getElementById('navBtnReceiver');
    const navMesh = document.getElementById('navBtnMesh');

    if (navSender) navSender.addEventListener('click', () => setRole('sender'));
    if (navReceiver) navReceiver.addEventListener('click', () => setRole('receiver'));
    if (navMesh) navMesh.addEventListener('click', () => setRole('mesh'));

    // 2. Audio Power Toggle
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
            alert('Microphone permission is required to listen for acoustic SOS packets.');
          }
        }
      });
    }

    // 3. Frequency Mode Selectors
    const btnUltra = document.getElementById('btnModeUltrasonic');
    const btnAudible = document.getElementById('btnModeAudible');

    if (btnUltra && btnAudible) {
      btnUltra.addEventListener('click', () => {
        AppState.audioModem.setFrequencyMode('ultrasonic');
        btnUltra.className = 'px-2 py-1 rounded-md font-semibold transition-all flex items-center gap-1.5 bg-cyan-500 text-slate-950 shadow-sm';
        btnAudible.className = 'px-2 py-1 rounded-md font-semibold transition-all text-slate-400 hover:text-white flex items-center gap-1.5';
      });

      btnAudible.addEventListener('click', () => {
        AppState.audioModem.setFrequencyMode('audible');
        btnAudible.className = 'px-2 py-1 rounded-md font-semibold transition-all flex items-center gap-1.5 bg-cyan-500 text-slate-950 shadow-sm';
        btnUltra.className = 'px-2 py-1 rounded-md font-semibold transition-all text-slate-400 hover:text-white flex items-center gap-1.5';
      });
    }

    // 4. Distress Type Selectors
    document.querySelectorAll('.distress-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const typeId = parseInt(btn.dataset.distress, 10);
        AppState.activeDistressType = typeId;

        document.querySelectorAll('.distress-btn').forEach(b => {
          b.className = 'distress-btn p-3 rounded-xl border text-left transition-all flex flex-col gap-1.5 bg-tactical-850 border-tactical-border text-slate-400 hover:border-slate-600';
        });

        const meta = PacketEngine.DISTRESS_TYPES[typeId];
        document.querySelectorAll(`[data-distress="${typeId}"]`).forEach(b => {
          b.className = `distress-btn active p-3 rounded-xl border text-left transition-all flex flex-col gap-1.5 ${meta.bgClass} shadow-md`;
        });

        const sPri = document.getElementById('senderDistressPriority');
        const mPri = document.getElementById('meshDistressPriority');
        if (sPri) {
          sPri.textContent = `${meta.priority} // PRIORITY ${typeId}`;
          sPri.style.color = meta.color;
        }
        if (mPri) {
          mPri.textContent = meta.priority;
          mPri.style.color = meta.color;
        }
      });
    });

    // 5. GPS Acquisition Triggers
    const btnSenderGps = document.getElementById('btnSenderGps');
    const btnMeshGps = document.getElementById('btnMeshGps');
    if (btnSenderGps) btnSenderGps.addEventListener('click', acquireHighAccuracyGps);
    if (btnMeshGps) btnMeshGps.addEventListener('click', acquireHighAccuracyGps);

    // 6. Location Presets
    document.querySelectorAll('.btn-preset-loc').forEach(btn => {
      btn.addEventListener('click', () => {
        const lat = parseFloat(btn.dataset.lat);
        const lon = parseFloat(btn.dataset.lon);
        AppState.currentLat = lat;
        AppState.currentLon = lon;

        ['senderInputLat', 'meshInputLat'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = lat.toFixed(6);
        });
        ['senderInputLon', 'meshInputLon'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = lon.toFixed(6);
        });

        updateMapPositions(lat, lon, 5.0);
      });
    });

    // 7. Message Presets
    document.querySelectorAll('.btn-preset-msg').forEach(btn => {
      btn.addEventListener('click', () => {
        const msg = btn.dataset.msg;
        ['senderInputMessage', 'meshInputMessage'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = msg;
        });
      });
    });

    // 8. Broadcast Buttons
    const btnSenderBroadcast = document.getElementById('btnSenderBroadcastSos');
    const btnMeshBroadcast = document.getElementById('btnMeshBroadcastSos');

    if (btnSenderBroadcast) {
      btnSenderBroadcast.addEventListener('click', () => handleBroadcastSos('sender'));
    }
    if (btnMeshBroadcast) {
      btnMeshBroadcast.addEventListener('click', () => handleBroadcastSos('mesh'));
    }

    // 9. Simulator Test Bench
    const btnSim = document.getElementById('btnSimulatePacket');
    const btnLoop = document.getElementById('btnLoopbackTest');

    if (btnSim) {
      btnSim.addEventListener('click', () => {
        const randomOffsets = [
          { dLat: 0.008, dLon: -0.005, msg: 'TRAPPED IN BASEMENT', type: 2 },
          { dLat: -0.012, dLon: 0.009, msg: 'BRUSH FIRE SPREADING', type: 3 },
          { dLat: 0.015, dLon: 0.012, msg: 'MEDIC NEEDED FL 4', type: 1 },
          { dLat: -0.006, dLon: -0.008, msg: 'SHELTER 12 SURVIVORS', type: 4 }
        ];
        const sample = randomOffsets[Math.floor(Math.random() * randomOffsets.length)];
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

    if (btnLoop) {
      btnLoop.addEventListener('click', () => {
        handleBroadcastSos('mesh');
      });
    }

    // 10. Clear Feed Buttons
    const btnRxClear = document.getElementById('btnReceiverClearFeed');
    const btnMeshClear = document.getElementById('btnMeshClearFeed');

    const clearAllFeeds = () => {
      AppState.receivedPackets = [];
      AppState.distressMarkers.forEach(marker => {
        if (AppState.receiverMap && AppState.receiverMap.hasLayer(marker)) AppState.receiverMap.removeLayer(marker);
        if (AppState.meshMap && AppState.meshMap.hasLayer(marker)) AppState.meshMap.removeLayer(marker);
      });
      AppState.distressMarkers.clear();
      renderEmergencyFeeds();
    };

    if (btnRxClear) btnRxClear.addEventListener('click', clearAllFeeds);
    if (btnMeshClear) btnMeshClear.addEventListener('click', clearAllFeeds);

    // 11. Modals
    const hexModal = document.getElementById('hexModal');
    const btnCloseHex = document.getElementById('btnCloseHexModal');
    if (btnCloseHex) btnCloseHex.addEventListener('click', () => hexModal.close());

    const helpModal = document.getElementById('helpModal');
    const btnOpenHelp = document.getElementById('btnOpenHelpModal');
    const btnCloseHelp = document.getElementById('btnCloseHelpModal');
    if (btnOpenHelp) btnOpenHelp.addEventListener('click', () => helpModal.showModal());
    if (btnCloseHelp) btnCloseHelp.addEventListener('click', () => helpModal.close());
  }

  // Document entry point
  document.addEventListener('DOMContentLoaded', initApp);
})();
