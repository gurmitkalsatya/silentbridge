# SilentBridge — Acoustic P2P Mesh Emergency Communicator

> **Zero-infrastructure, offline emergency peer-to-peer mesh communicator operating without cellular towers, Wi-Fi routers, internet, or Bluetooth pairing.**

Built for 24-Hour Open Innovation Hackathons, **SilentBridge** converts standard smartphones, laptops, and desktop browsers into acoustic modems. It transmits SOS telemetry packets via near-ultrasonic sound waves (**18.0 kHz to 19.5 kHz**) using standard speakers and microphones.

---

## ⚡ Key Highlights

- 🔇 **Near-Ultrasonic Acoustic Carrier**: Operates at 18.0–19.5 kHz (inaudible to most adults) with a one-click Audible Demo Mode (1.5–2.2 kHz) for presentations.
- 📦 **32-Byte Compact Binary Schema**: Optimized fixed-length binary protocol packed via `DataView` with IEEE-754 coordinates and CCITT CRC-16 error detection.
- 🔄 **Autonomous Mesh Relay & Deduplication**: Multi-hop peer-to-peer relay with randomized jitter delay (800–1800ms) to eliminate acoustic collisions.
- 🗺️ **Offline Geo-Tactical Map**: Leaflet.js radar map displaying distress beacons, distance estimates, and telemetry markers.
- 📊 **Real-Time FFT Spectrum & Waterfall Visualizer**: 2048-point live frequency analyzer highlighting carrier energy and ambient noise floor.
- 🚀 **Zero Build Step / 100% Self-Contained**: Pure vanilla modern JavaScript, HTML5, and CSS. Runs immediately in any modern browser.

---

## 🏗️ Architecture & File Structure

```
silentbridge/
├── index.html          # Dark tactical emergency UI, Leaflet map, Canvas mounts, Tailwind CSS
├── crc16.js            # Standalone CCITT CRC-16 integrity checker (polynomial 0x1021)
├── packetEngine.js     # Compact 32-byte binary protocol encoder, decoder & bit-packer
├── audioModem.js       # Dual-engine Web Audio API pipeline: BFSK Transmitter & FFT Demodulator
└── app.js              # Reactive UI controller, Leaflet map manager, spectrum visualizer & mesh relay
```

---

## 📐 32-Byte Binary Packet Schema

All telemetry is serialized into a fixed 32-byte (`ArrayBuffer`) payload:

```
+---------------+------------------+------------------+------------------+
| Byte 0        | Bytes 1–2        | Byte 3           | Bytes 4–7        |
| Sync (0xAA)   | Message ID       | Distress Type    | Latitude (f32)   |
+---------------+------------------+------------------+------------------+
| Bytes 8–11    | Byte 12          | Bytes 13–29      | Bytes 30–31      |
| Longitude(f32)| TTL / Hops Left  | Short Msg (17 B) | CRC-16 (CCITT)   |
+---------------+------------------+------------------+------------------+
```

### Distress Classifications
- `1`: **Medical Emergency** (Critical // Red)
- `2`: **Trapped / Structural Collapse** (High // Orange)
- `3`: **Fire / Chemical Hazard** (Critical // Rose)
- `4`: **Shelter / Food / Water Needed** (Medium // Cyan)

---

## 🔊 Audio Modem Pipeline (`audioModem.js`)

### Acoustic Modulation (Tx):
- **Carrier Profile (Ultrasonic)**:
  - `Preamble Tone`: **18.0 kHz** (100ms)
  - `Bit 0 Frequency`: **18.5 kHz** (40ms)
  - `Bit 1 Frequency`: **19.5 kHz** (40ms)
  - `Guard Interval`: **5ms** silence between symbols
- **Smooth Envelope Ramping**: 3ms cosine/linear ramps on each symbol to eliminate acoustic pop/click noise.

### Acoustic Demodulation (Rx):
- **Microphone Capture**: `navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })`
- **FFT Spectrum Engine**: `AnalyserNode` with `fftSize = 2048`, `smoothingTimeConstant = 0.15`
- **Adaptive Energy Thresholding**: Dynamic SNR comparison of carrier frequencies vs ambient noise baseline.

---

## 🚀 Quick Start Guide

### 1. Run Locally
Simply serve the workspace using any static HTTP server:

```bash
# Using npx serve
npx serve .

# Or using Python
python -m http.server 3000
```

Open `http://localhost:3000` in Chrome, Edge, Safari, or Firefox.

### 2. Live Demo & Testing
1. **Acquire GPS / Mock Coords**: Click *"Get GPS Fix"* or select a preset location (*SF Hub, NYC Base, London, Tokyo*).
2. **Select Distress Type & Message**: Choose a category and enter a short distress description (up to 17 characters).
3. **Broadcast SOS**: Click **"BROADCAST ACOUSTIC SOS"** to transmit the 256-bit BFSK acoustic packet.
4. **Simulator / Test Bench**: Click **"Simulate Mesh Node"** to test multi-node mesh packet reception, deduplication, and automated multi-hop relay.
5. **Inspect Raw Hex**: Click *"Inspect Hex"* on any feed card to view the exact 32-byte layout, sync byte, and CRC-16 checksum.

---

## 🛡️ License
MIT License. Created for the Open Innovation Hackathon.
