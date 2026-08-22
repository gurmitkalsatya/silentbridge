/**
 * SilentBridge - Main Application Controller
 * Handles UI interactions, Leaflet map management, Spectrum & Waterfall Canvas visualizer,
 * acoustic modem coordinator, and peer-to-peer mesh deduplication/relay engine.
 */

(function () {
  'use strict';

  // State Management
  const AppState = {
    audioModem: null,
    map: null,
    userLocationMarker: null,
    distressMarkers: new Map(), // messageId -> Leaflet Layer
    receivedPackets: [],       // List of parsed packet objects
    seenPacketIds: new Set(),
    activeDistressType: 1,
    currentLat: 37.7749,
    currentLon: -122.4194,
    visualizerMode: 'spectrum', // 'spectrum' | 'waterfall'
    waterfallHistory: [],
    waterfallMaxRows: 120,
    stats: {
      txCount: 0,
      rxCount: 0,
      relayCount: 0,
      crcErrors: 0
    }
  };

  // Distance calculation helper (Haversine formula in km / m)
  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in metres
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

  // Format relative timestamp (e.g. "Just now", "45s ago")
  function formatRelativeTime(timestamp) {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (elapsedSeconds < 5) return 'Just now';
    if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    return `${elapsedHours}h ago`;
  }

  // Load seen packet IDs from localStorage for persistence
  function loadSeenPackets() {
    try {
      const stored = localStorage.getItem('silentbridge_seen_packets');
      if (stored) {
        const ids = JSON.parse(stored);
        if (Array.isArray(ids)) {
          AppState.seenPacketIds = new Set(ids);
        }
      }
    } catch (e) {
      console.warn('Failed to load seen packets from localStorage:', e);
    }
  }

  // Save seen packet IDs to localStorage
  function saveSeenPackets() {
    try {
      const ids = Array.from(AppState.seenPacketIds);
      localStorage.setItem('silentbridge_seen_packets', JSON.stringify(ids.slice(-500)));
    } catch (e) {
      console.warn('Failed to save seen packets to localStorage:', e);
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                             LEAFLET MAP MANAGER                            */
  /* -------------------------------------------------------------------------- */

  function initMap() {
    const mapElement = document.getElementById('map');
    if (!mapElement || typeof L === 'undefined') return;

    // Initialize map centered at current coordinates
    AppState.map = L.map('map', {
      zoomControl: true,
      attributionControl: false
    }).setView([AppState.currentLat, AppState.currentLon], 13);

    // Dark Map Tiles (CartoDB Dark Matter with OSM fallback)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd'
    }).addTo(AppState.map);

    // Create Local Device Pulse Marker
    updateUserMapMarker(AppState.currentLat, AppState.currentLon);
  }

  function updateUserMapMarker(lat, lon) {
    if (!AppState.map || typeof L === 'undefined') return;

    if (AppState.userLocationMarker) {
      AppState.userLocationMarker.setLatLng([lat, lon]);
    } else {
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

      AppState.userLocationMarker = L.marker([lat, lon], { icon: userIcon })
        .addTo(AppState.map)
        .bindPopup(`
          <div class="p-1 font-mono text-xs text-slate-200">
            <strong class="text-cyan-400 block mb-1">LOCAL ACOUSTIC NODE</strong>
            <div>Lat: ${lat.toFixed(6)}</div>
            <div>Lon: ${lon.toFixed(6)}</div>
          </div>
        `);
    }
  }

  function addDistressMapMarker(packet) {
    if (!AppState.map || typeof L === 'undefined') return;

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

    const marker = L.marker([packet.latitude, packet.longitude], { icon: distressIcon })
      .addTo(AppState.map)
      .bindPopup(`
        <div class="p-1 font-mono text-xs text-slate-200 space-y-1">
          <div class="flex items-center justify-between gap-2 border-b border-tactical-border pb-1">
            <strong style="color: ${markerColor};">${meta.name}</strong>
            <span class="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">#${packet.messageId}</span>
          </div>
          <div class="text-white font-bold">"${packet.message}"</div>
          <div class="text-slate-400 text-[11px]">Distance: <span class="text-cyan-400 font-bold">${distStr}</span></div>
          <div class="text-slate-400 text-[11px]">Hops Remaining: <span class="text-amber-400 font-bold">${packet.ttl}</span></div>
          <div class="text-[10px] text-slate-500">${packet.latitude.toFixed(5)}, ${packet.longitude.toFixed(5)}</div>
        </div>
      `);

    AppState.distressMarkers.set(packet.messageId, marker);

    // Auto pan/fit bounds
    const bounds = L.latLngBounds([
      [AppState.currentLat, AppState.currentLon],
      [packet.latitude, packet.longitude]
    ]);
    AppState.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
  }

  /* -------------------------------------------------------------------------- */
  /*                    CANVAS SPECTRUM & WATERFALL VISUALIZER                  */
  /* -------------------------------------------------------------------------- */

  function initVisualizer() {
    const canvas = document.getElementById('visualizerCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Resize canvas to match container pixel density
    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Animation Render Loop
    function render() {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const modem = AppState.audioModem;

      ctx.clearRect(0, 0, width, height);

      if (!modem || !modem.isListening || !modem.fftBuffer) {
        // Draw Idle Radar Line & Grid
        drawIdleGrid(ctx, width, height);
      } else if (AppState.visualizerMode === 'spectrum') {
        drawSpectrumBars(ctx, width, height, modem);
      } else {
        drawWaterfall(ctx, width, height, modem);
      }

      requestAnimationFrame(render);
    }

    render();
  }

  function drawIdleGrid(ctx, width, height) {
    ctx.strokeStyle = '#162238';
    ctx.lineWidth = 1;

    // Horizontal Grid Lines
    for (let y = 0; y < height; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Centered Idle Status
    ctx.fillStyle = '#475569';
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('STANDBY // ACTIVATE MODEM LISTENER TO ENGAGE FFT', width / 2, height / 2);
  }

  function drawSpectrumBars(ctx, width, height, modem) {
    const buffer = modem.fftBuffer;
    const floatBuffer = modem.floatFftBuffer;
    const binCount = buffer.length;
    const sampleRate = (modem.audioCtx && modem.audioCtx.sampleRate) || 48000;
    const nyquist = sampleRate / 2;

    // Frequency window to display (zoomed around carrier band)
    const isUltrasonic = modem.mode === 'ultrasonic';
    const minFreq = isUltrasonic ? 16500 : 1000;
    const maxFreq = isUltrasonic ? 20500 : 3000;

    const minBin = Math.floor((minFreq / nyquist) * binCount);
    const maxBin = Math.ceil((maxFreq / nyquist) * binCount);
    const targetBins = Math.max(1, maxBin - minBin);

    const barWidth = Math.max(2, (width / targetBins));

    // Target Carrier Bins
    const preambleBin = modem.freqToBin(modem.profile.preambleFreq);
    const bit0Bin = modem.freqToBin(modem.profile.bit0Freq);
    const bit1Bin = modem.freqToBin(modem.profile.bit1Freq);

    // Draw Spectrum Bars
    for (let i = 0; i < targetBins; i++) {
      const binIdx = minBin + i;
      if (binIdx >= binCount) break;

      const rawVal = buffer[binIdx]; // 0 to 255
      const barHeight = (rawVal / 255) * (height - 20);
      const x = i * barWidth;
      const y = height - barHeight;

      // Color coding for carrier frequencies
      if (Math.abs(binIdx - preambleBin) <= 1) {
        ctx.fillStyle = '#F59E0B'; // Amber for Preamble
      } else if (Math.abs(binIdx - bit0Bin) <= 1) {
        ctx.fillStyle = '#06B6D4'; // Cyan for Bit 0
      } else if (Math.abs(binIdx - bit1Bin) <= 1) {
        ctx.fillStyle = '#10B981'; // Emerald for Bit 1
      } else {
        ctx.fillStyle = 'rgba(51, 77, 122, 0.6)'; // Tactical slate
      }

      ctx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight);
    }

    // Draw Carrier Marker Tags at Top
    drawFrequencyMarker(ctx, width, minBin, targetBins, preambleBin, 'PRE (18.0k)', '#F59E0B');
    drawFrequencyMarker(ctx, width, minBin, targetBins, bit0Bin, 'B0 (18.5k)', '#06B6D4');
    drawFrequencyMarker(ctx, width, minBin, targetBins, bit1Bin, 'B1 (19.5k)', '#10B981');
  }

  function drawFrequencyMarker(ctx, width, minBin, targetBins, binIdx, label, color) {
    if (binIdx < minBin || binIdx > minBin + targetBins) return;
    const relX = ((binIdx - minBin) / targetBins) * width;

    ctx.strokeStyle = color;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(relX, 20);
    ctx.lineTo(relX, 100);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = color;
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, relX, 14);
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

    // Push new row to waterfall history
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
        const val = rowData[c]; // 0 to 255
        const x = c * cellWidth;

        // Tactical heatmap coloring (Dark -> Blue -> Cyan -> Yellow -> Red)
        if (val < 40) ctx.fillStyle = '#060911';
        else if (val < 90) ctx.fillStyle = '#1E293B';
        else if (val < 140) ctx.fillStyle = '#0284C7';
        else if (val < 190) ctx.fillStyle = '#06B6D4';
        else if (val < 230) ctx.fillStyle = '#F59E0B';
        else ctx.fillStyle = '#EF4444';

        ctx.fillRect(x, y, Math.ceil(cellWidth), Math.ceil(rowHeight));
      }
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                   LIVE EMERGENCY DISTRESS FEED RENDERER                    */
  /* -------------------------------------------------------------------------- */

  function renderEmergencyFeed() {
    const feedContainer = document.getElementById('emergencyFeedList');
    if (!feedContainer) return;

    if (AppState.receivedPackets.length === 0) {
      feedContainer.innerHTML = `
        <div id="feedEmptyState" class="p-6 text-center border border-dashed border-tactical-border rounded-lg bg-tactical-950/50 text-slate-500 font-mono text-xs">
          <i data-lucide="shield-check" class="w-8 h-8 mx-auto mb-2 text-slate-600"></i>
          No active distress beacons received.<br>
          Acoustic listener standing by on carrier frequencies.
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    feedContainer.innerHTML = AppState.receivedPackets.map((pkt) => {
      const meta = pkt.distressMeta || PacketEngine.DISTRESS_TYPES[pkt.distressType];
      const distStr = calculateDistance(AppState.currentLat, AppState.currentLon, pkt.latitude, pkt.longitude);
      const timeStr = formatRelativeTime(pkt.timestamp);

      return `
        <div class="p-3.5 rounded-xl border ${meta.bgClass} bg-tactical-900/90 shadow-md transition-all hover:border-slate-600 relative overflow-hidden group">
          
          <!-- Top Row: Distress Badge & Meta -->
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${meta.badgeClass}">
                ${meta.name}
              </span>
              <span class="text-xs font-mono text-slate-400 font-bold">#${pkt.messageId}</span>
            </div>
            <span class="text-[10px] font-mono text-slate-400">${timeStr}</span>
          </div>

          <!-- Distress Message -->
          <div class="text-sm font-mono font-bold text-white mb-2 tracking-wide">
            "${pkt.message}"
          </div>

          <!-- Bottom Telemetry Row -->
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

            <!-- Card Actions -->
            <div class="flex items-center gap-1.5">
              <button type="button" class="btn-inspect-hex text-[10px] px-2 py-0.5 rounded bg-tactical-800 hover:bg-tactical-700 text-slate-300 font-mono transition-colors" data-msgid="${pkt.messageId}">
                Inspect Hex
              </button>
              <button type="button" class="btn-focus-map text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-900 font-mono transition-colors" data-lat="${pkt.latitude}" data-lon="${pkt.longitude}">
                Focus
              </button>
            </div>
          </div>

        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();

    // Attach click handlers to dynamically rendered cards
    feedContainer.querySelectorAll('.btn-inspect-hex').forEach(btn => {
      btn.addEventListener('click', () => {
        const msgId = parseInt(btn.dataset.msgid, 10);
        const packet = AppState.receivedPackets.find(p => p.messageId === msgId);
        if (packet) showHexModal(packet);
      });
    });

    feedContainer.querySelectorAll('.btn-focus-map').forEach(btn => {
      btn.addEventListener('click', () => {
        const lat = parseFloat(btn.dataset.lat);
        const lon = parseFloat(btn.dataset.lon);
        if (AppState.map) {
          AppState.map.setView([lat, lon], 15, { animate: true });
        }
      });
    });
  }

  /* -------------------------------------------------------------------------- */
  /*                    PACKET RECEIVED & MESH RELAY HANDLER                    */
  /* -------------------------------------------------------------------------- */

  function handleIncomingPacket(packet) {
    console.log('[SilentBridge] Processing incoming packet:', packet);

    // 1. Check De-duplication Cache
    if (AppState.seenPacketIds.has(packet.messageId)) {
      console.log(`[SilentBridge Mesh] Dropping duplicate packet #${packet.messageId}`);
      return;
    }

    // 2. Mark as Seen and persist
    AppState.seenPacketIds.add(packet.messageId);
    saveSeenPackets();

    // 3. Update Statistics
    AppState.stats.rxCount++;
    document.getElementById('statRxCount').textContent = AppState.stats.rxCount;

    // 4. Add to Feed & Map
    AppState.receivedPackets.unshift(packet);
    renderEmergencyFeed();
    addDistressMapMarker(packet);

    // 5. Play Tactical Audio Notification Chirp
    playReceptionChirp();

    // 6. Mesh Relay Logic: If TTL > 0, decrement and re-transmit with randomized jitter delay
    if (packet.ttl > 0) {
      const relayData = PacketEngine.decrementTTL(packet.rawBytes);
      const jitterMs = Math.floor(800 + Math.random() * 1000); // 800ms to 1800ms jitter

      console.log(`[SilentBridge Mesh] Scheduling auto-relay for #${packet.messageId} (New TTL: ${relayData.newTtl}) in ${jitterMs}ms`);

      setTimeout(async () => {
        if (!AppState.audioModem) return;
        try {
          console.log(`[SilentBridge Mesh] Transmitting acoustic relay for #${packet.messageId}...`);
          await AppState.audioModem.transmitPacket(relayData.packet);
          AppState.stats.relayCount++;
          document.getElementById('statRelayCount').textContent = AppState.stats.relayCount;
        } catch (err) {
          console.warn('[SilentBridge Mesh] Relay transmission failed or collided:', err);
        }
      }, jitterMs);
    }
  }

  // Tactical subtle UI audio chime on packet reception
  function playReceptionChirp() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.15); // A6

      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.02);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.22);
    } catch (e) {
      // Audio context policy fallback
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
  /*                           MAIN APP INITIALIZATION                          */
  /* -------------------------------------------------------------------------- */

  function initApp() {
    loadSeenPackets();
    initMap();
    initVisualizer();

    // Instantiate Audio Modem Engine
    AppState.audioModem = new AudioModem({ mode: 'ultrasonic' });

    // Modem Event Callbacks
    AppState.audioModem.onTxStart = () => {
      const btn = document.getElementById('btnBroadcastSos');
      const btnText = document.getElementById('broadcastBtnText');
      btn.classList.add('animate-pulse');
      btnText.textContent = 'TRANSMITTING BFSK TONES...';
      document.getElementById('rxStateBadge').className = 'px-2.5 py-1 rounded-md text-xs font-mono font-bold tracking-wide uppercase bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 flex items-center gap-1.5';
      document.getElementById('rxStateText').textContent = 'TRANSMITTING';
    };

    AppState.audioModem.onTxProgress = ({ currentBit, totalBits, progressPercent, currentFreq }) => {
      const overlay = document.getElementById('txProgressOverlay');
      if (overlay) overlay.style.width = `${progressPercent}%`;

      const viewer = document.getElementById('bitStreamViewer');
      if (viewer && currentBit % 8 === 0) {
        viewer.innerHTML += `<span class="text-cyan-300 font-bold"> [TX ${currentBit}/${totalBits}] </span>`;
        viewer.scrollTop = viewer.scrollHeight;
      }
    };

    AppState.audioModem.onTxEnd = (packetBytes) => {
      const btn = document.getElementById('btnBroadcastSos');
      const btnText = document.getElementById('broadcastBtnText');
      const overlay = document.getElementById('txProgressOverlay');
      btn.classList.remove('animate-pulse');
      btnText.textContent = 'BROADCAST ACOUSTIC SOS';
      if (overlay) overlay.style.width = '0%';

      AppState.stats.txCount++;
      document.getElementById('statTxCount').textContent = AppState.stats.txCount;

      // Add self-transmitted packet to local feed
      const parsed = PacketEngine.parsePacket(packetBytes);
      if (parsed.valid && !AppState.seenPacketIds.has(parsed.messageId)) {
        AppState.seenPacketIds.add(parsed.messageId);
        saveSeenPackets();
        AppState.receivedPackets.unshift(parsed);
        renderEmergencyFeed();
        addDistressMapMarker(parsed);
      }

      document.getElementById('rxStateBadge').className = 'px-2.5 py-1 rounded-md text-xs font-mono font-bold tracking-wide uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5';
      document.getElementById('rxStateText').textContent = 'LISTENING';
    };

    AppState.audioModem.onRxStateChange = (state) => {
      const badge = document.getElementById('rxStateBadge');
      const text = document.getElementById('rxStateText');
      if (!badge || !text) return;

      text.textContent = state;

      if (state === 'LISTENING') {
        badge.className = 'px-2.5 py-1 rounded-md text-xs font-mono font-bold tracking-wide uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5';
      } else if (state === 'PREAMBLE_DETECTED') {
        badge.className = 'px-2.5 py-1 rounded-md text-xs font-mono font-bold tracking-wide uppercase bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1.5 animate-pulse';
        const viewer = document.getElementById('bitStreamViewer');
        viewer.innerHTML = '<span class="text-amber-400 font-bold">// PREAMBLE TONE DETECTED (18.0 kHz) -> LOCKING CARRIER CLOCK...</span><br>';
      } else if (state === 'RECEIVING_BITS') {
        badge.className = 'px-2.5 py-1 rounded-md text-xs font-mono font-bold tracking-wide uppercase bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 flex items-center gap-1.5';
      } else if (state === 'VALIDATING') {
        badge.className = 'px-2.5 py-1 rounded-md text-xs font-mono font-bold tracking-wide uppercase bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1.5';
      } else if (state === 'OFF') {
        badge.className = 'px-2.5 py-1 rounded-md text-xs font-mono font-bold tracking-wide uppercase bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1.5';
      }
    };

    AppState.audioModem.onRxProgress = ({ currentBit, totalBits, bitValue, progressPercent }) => {
      document.getElementById('rxBitCounter').textContent = `${currentBit} / ${totalBits} BITS`;
      document.getElementById('rxProgressBar').style.width = `${progressPercent}%`;

      const viewer = document.getElementById('bitStreamViewer');
      if (viewer) {
        const bitClass = bitValue === 1 ? 'text-emerald-400 font-bold' : 'text-slate-400';
        viewer.innerHTML += `<span class="${bitClass}">${bitValue}</span>`;
        if (currentBit % 8 === 0) viewer.innerHTML += ' ';
        viewer.scrollTop = viewer.scrollHeight;
      }
    };

    AppState.audioModem.onPacketReceived = (packet) => {
      const viewer = document.getElementById('bitStreamViewer');
      if (viewer) {
        viewer.innerHTML += `<br><span class="text-emerald-300 font-bold">// PACKET #${packet.messageId} VERIFIED (CRC-16 OK: ${packet.crcHex})</span><br>`;
        viewer.scrollTop = viewer.scrollHeight;
      }
      handleIncomingPacket(packet);
    };

    AppState.audioModem.onCrcError = ({ error, rawBytes }) => {
      AppState.stats.crcErrors++;
      document.getElementById('statCrcErrors').textContent = AppState.stats.crcErrors;

      const viewer = document.getElementById('bitStreamViewer');
      if (viewer) {
        viewer.innerHTML += `<br><span class="text-rose-400 font-bold">// CRC REJECTION: ${error}</span><br>`;
        viewer.scrollTop = viewer.scrollHeight;
      }
    };

    AppState.audioModem.onAudioLevels = ({ snr, noiseFloor, peakFreq }) => {
      document.getElementById('statSnr').textContent = `${snr.toFixed(1)} dB`;
      document.getElementById('hudSnr').textContent = `${snr.toFixed(1)} dB`;
      document.getElementById('hudNoiseFloor').textContent = `${noiseFloor.toFixed(1)} dB`;
      document.getElementById('hudPeakFreq').textContent = `${Math.round(peakFreq).toLocaleString()} Hz`;
    };

    // Auto-start listener on first user interaction
    const startAudioOnce = async () => {
      try {
        await AppState.audioModem.startListening();
        updateAudioButtonState(true);
      } catch (err) {
        console.warn('Audio auto-start waiting for explicit user gesture:', err);
        updateAudioButtonState(false);
      }
      window.removeEventListener('click', startAudioOnce);
    };
    window.addEventListener('click', startAudioOnce);

    setupEventHandlers();
  }

  function updateAudioButtonState(isActive) {
    const btn = document.getElementById('btnToggleAudio');
    const text = document.getElementById('audioPowerText');
    const ping = document.getElementById('audioPowerPing');
    const dot = document.getElementById('audioPowerDot');

    if (isActive) {
      btn.className = 'px-3.5 py-2 rounded-lg font-mono text-xs font-bold transition-all flex items-center gap-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/40 shadow-sm';
      text.textContent = 'MODEM: ACTIVE';
      ping.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75';
      dot.className = 'relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500';
    } else {
      btn.className = 'px-3.5 py-2 rounded-lg font-mono text-xs font-bold transition-all flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700 shadow-sm';
      text.textContent = 'MODEM: STANDBY';
      ping.className = 'hidden';
      dot.className = 'relative inline-flex rounded-full h-2.5 w-2.5 bg-slate-500';
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                           UI EVENT HANDLERS                                */
  /* -------------------------------------------------------------------------- */

  function setupEventHandlers() {
    // 1. Audio Modem Power Toggle
    document.getElementById('btnToggleAudio').addEventListener('click', async () => {
      const modem = AppState.audioModem;
      if (modem.isListening) {
        modem.stopListening();
        updateAudioButtonState(false);
      } else {
        try {
          await modem.startListening();
          updateAudioButtonState(true);
        } catch (err) {
          alert('Microphone access required for acoustic modem receiver.');
        }
      }
    });

    // 2. Frequency Mode Switchers
    const btnUltra = document.getElementById('btnModeUltrasonic');
    const btnAudible = document.getElementById('btnModeAudible');

    btnUltra.addEventListener('click', () => {
      AppState.audioModem.setFrequencyMode('ultrasonic');
      btnUltra.className = 'px-2.5 py-1.5 rounded-md font-semibold transition-all flex items-center gap-1.5 bg-cyan-500 text-slate-950 shadow-sm';
      btnAudible.className = 'px-2.5 py-1.5 rounded-md font-semibold transition-all text-slate-400 hover:text-white flex items-center gap-1.5';
      document.getElementById('carrierRangeLabel').textContent = '17.5 - 20.0 kHz';
      document.getElementById('canvasFreqMin').textContent = '17.0 kHz';
      document.getElementById('canvasFreqMid').textContent = '18.5 kHz (Bit 0)';
      document.getElementById('canvasFreqMax').textContent = '20.0 kHz';
    });

    btnAudible.addEventListener('click', () => {
      AppState.audioModem.setFrequencyMode('audible');
      btnAudible.className = 'px-2.5 py-1.5 rounded-md font-semibold transition-all flex items-center gap-1.5 bg-cyan-500 text-slate-950 shadow-sm';
      btnUltra.className = 'px-2.5 py-1.5 rounded-md font-semibold transition-all text-slate-400 hover:text-white flex items-center gap-1.5';
      document.getElementById('carrierRangeLabel').textContent = '1.0 - 2.5 kHz';
      document.getElementById('canvasFreqMin').textContent = '1.0 kHz';
      document.getElementById('canvasFreqMid').textContent = '1.8 kHz (Bit 0)';
      document.getElementById('canvasFreqMax').textContent = '2.5 kHz';
    });

    // 3. Distress Type Buttons
    document.querySelectorAll('.distress-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.distress-btn').forEach(b => {
          b.className = 'distress-btn p-2.5 rounded-lg border text-left transition-all flex flex-col gap-1 bg-tactical-850 border-tactical-border text-slate-400 hover:border-slate-600';
        });

        const typeId = parseInt(btn.dataset.distress, 10);
        AppState.activeDistressType = typeId;

        const meta = PacketEngine.DISTRESS_TYPES[typeId];
        btn.className = `distress-btn active p-2.5 rounded-lg border text-left transition-all flex flex-col gap-1 ${meta.bgClass} shadow-md`;
        document.getElementById('selectedDistressPriority').textContent = meta.priority;
        document.getElementById('selectedDistressPriority').style.color = meta.color;
      });
    });

    // 4. GPS Acquisition Button
    const btnGps = document.getElementById('btnGetGps');
    btnGps.addEventListener('click', () => {
      const label = document.getElementById('gpsButtonLabel');
      label.textContent = 'Acquiring GPS...';

      if (!navigator.geolocation) {
        alert('Geolocation API not supported.');
        label.textContent = 'Get GPS Fix';
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          AppState.currentLat = pos.coords.latitude;
          AppState.currentLon = pos.coords.longitude;
          document.getElementById('inputLat').value = pos.coords.latitude.toFixed(6);
          document.getElementById('inputLon').value = pos.coords.longitude.toFixed(6);
          updateUserMapMarker(pos.coords.latitude, pos.coords.longitude);
          if (AppState.map) AppState.map.setView([pos.coords.latitude, pos.coords.longitude], 14);
          label.textContent = 'GPS Locked ✓';
        },
        (err) => {
          console.warn('GPS Error:', err);
          label.textContent = 'GPS Failed (Using Coords)';
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });

    // 5. Preset Mock Location Buttons
    document.querySelectorAll('.btn-preset-loc').forEach(btn => {
      btn.addEventListener('click', () => {
        const lat = parseFloat(btn.dataset.lat);
        const lon = parseFloat(btn.dataset.lon);
        AppState.currentLat = lat;
        AppState.currentLon = lon;
        document.getElementById('inputLat').value = lat;
        document.getElementById('inputLon').value = lon;
        updateUserMapMarker(lat, lon);
        if (AppState.map) AppState.map.setView([lat, lon], 13);
      });
    });

    // 6. Message Input & Char Counter
    const msgInput = document.getElementById('inputMessage');
    const charCounter = document.getElementById('charCounter');
    msgInput.addEventListener('input', () => {
      const len = msgInput.value.length;
      charCounter.textContent = `${len} / 17 Bytes`;
      if (len >= 17) {
        charCounter.className = 'text-[11px] font-mono text-amber-400 font-bold';
      } else {
        charCounter.className = 'text-[11px] font-mono text-cyan-400';
      }
    });

    // 7. Preset Message Buttons
    document.querySelectorAll('.btn-preset-msg').forEach(btn => {
      btn.addEventListener('click', () => {
        msgInput.value = btn.dataset.msg;
        msgInput.dispatchEvent(new Event('input'));
      });
    });

    // 8. Broadcast Acoustic SOS Button
    document.getElementById('btnBroadcastSos').addEventListener('click', async () => {
      const lat = parseFloat(document.getElementById('inputLat').value) || AppState.currentLat;
      const lon = parseFloat(document.getElementById('inputLon').value) || AppState.currentLon;
      const msg = document.getElementById('inputMessage').value || 'NEED HELP';
      const ttl = parseInt(document.getElementById('selectTtl').value, 10) || 3;

      const packetBytes = PacketEngine.createPacket({
        distressType: AppState.activeDistressType,
        latitude: lat,
        longitude: lon,
        message: msg,
        ttl: ttl
      });

      try {
        await AppState.audioModem.transmitPacket(packetBytes);
      } catch (err) {
        alert(`Transmission Error: ${err.message}`);
      }
    });

    // 9. Canvas View Mode Tabs
    const tabSpec = document.getElementById('tabSpectrum');
    const tabWater = document.getElementById('tabWaterfall');

    tabSpec.addEventListener('click', () => {
      AppState.visualizerMode = 'spectrum';
      tabSpec.className = 'px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/30';
      tabWater.className = 'px-2.5 py-1 rounded text-slate-400 hover:text-slate-200';
    });

    tabWater.addEventListener('click', () => {
      AppState.visualizerMode = 'waterfall';
      tabWater.className = 'px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/30';
      tabSpec.className = 'px-2.5 py-1 rounded text-slate-400 hover:text-slate-200';
    });

    // 10. Test Bench: Simulate Mesh Node
    document.getElementById('btnSimulatePacket').addEventListener('click', () => {
      const randomTypes = [1, 2, 3, 4];
      const randomType = randomTypes[Math.floor(Math.random() * randomTypes.length)];
      
      const randomOffsets = [
        { dLat: 0.008, dLon: -0.005, msg: 'TRAPPED IN BASEMENT' },
        { dLat: -0.012, dLon: 0.009, msg: 'BRUSH FIRE SPREADING' },
        { dLat: 0.015, dLon: 0.012, msg: 'MEDIC NEEDED FL 4' },
        { dLat: -0.006, dLon: -0.008, msg: 'SHELTER 12 REFUGEES' }
      ];
      const sample = randomOffsets[Math.floor(Math.random() * randomOffsets.length)];

      const simLat = AppState.currentLat + sample.dLat;
      const simLon = AppState.currentLon + sample.dLon;

      const simPacketBytes = PacketEngine.createPacket({
        distressType: randomType,
        latitude: simLat,
        longitude: simLon,
        message: sample.msg,
        ttl: 2
      });

      AppState.audioModem.injectSyntheticPacket(simPacketBytes);
    });

    // 11. Test Bench: Self Loopback Test
    document.getElementById('btnLoopbackTest').addEventListener('click', () => {
      const lat = parseFloat(document.getElementById('inputLat').value) || AppState.currentLat;
      const lon = parseFloat(document.getElementById('inputLon').value) || AppState.currentLon;
      const msg = document.getElementById('inputMessage').value || 'LOOPBACK TEST';

      const testPacketBytes = PacketEngine.createPacket({
        distressType: AppState.activeDistressType,
        latitude: lat,
        longitude: lon,
        message: msg,
        ttl: 1
      });

      AppState.audioModem.injectSyntheticPacket(testPacketBytes);
    });

    // 12. Clear Feed Button
    document.getElementById('btnClearFeed').addEventListener('click', () => {
      AppState.receivedPackets = [];
      AppState.distressMarkers.forEach(marker => {
        if (AppState.map) AppState.map.removeLayer(marker);
      });
      AppState.distressMarkers.clear();
      renderEmergencyFeed();
    });

    // 13. Map Recenter
    document.getElementById('btnRecenterMap').addEventListener('click', () => {
      if (AppState.map) {
        AppState.map.setView([AppState.currentLat, AppState.currentLon], 13);
      }
    });

    // 14. Modals
    const hexModal = document.getElementById('hexModal');
    document.getElementById('btnCloseHexModal').addEventListener('click', () => hexModal.close());

    const helpModal = document.getElementById('helpModal');
    document.getElementById('btnOpenHelpModal').addEventListener('click', () => helpModal.showModal());
    document.getElementById('btnCloseHelpModal').addEventListener('click', () => helpModal.close());

    // Periodic relative time update for feed cards
    setInterval(() => {
      if (AppState.receivedPackets.length > 0) {
        renderEmergencyFeed();
      }
    }, 10000);
  }

  // DOM Content Loaded entry point
  document.addEventListener('DOMContentLoaded', initApp);
})();
