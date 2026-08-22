# SilentBridge — Acoustic P2P Mesh Emergency Communicator

> **Zero-infrastructure, offline emergency peer-to-peer mesh communicator operating without cellular towers, Wi-Fi routers, internet, or Bluetooth pairing.**

Built for 24-Hour Open Innovation Hackathons, **SilentBridge** converts standard smartphones, laptops, and desktop browsers into acoustic modems. It transmits SOS telemetry packets and emergency voice memos via near-ultrasonic sound waves (**18.0 kHz to 19.5 kHz**) and synchronized P2P channels using standard speakers and microphones.

---

## ⚡ Key Highlights

- 🔇 **Near-Ultrasonic Acoustic Carrier**: Operates at 18.0–19.5 kHz (inaudible to most adults) with a one-click Audible Demo Mode (1.5–2.2 kHz) for presentations.
- 🎙️ **Emergency Voice Memo Recording & Dispatch Playback**: Survivors can record up to 10-second voice memos with live audio waveforms. Base stations receive and play voice dispatches with +6dB field gain boosting.
- 🎯 **High-Accuracy Geo-Telemetry**: Real-time GPS confidence acquisition with estimated accuracy radius (`±X.Xm`), satellite lock indicators, and coordinate pin-pointing.
- 🎛️ **Dedicated Sender & Receiver Operating Interfaces**:
  - **Sender Mode (`#sender`)**: Field Distress Unit featuring voice recorder, high-contrast emergency controls, and one-tap broadcast.
  - **Receiver Mode (`#receiver`)**: Rescue Command Center featuring live FFT spectrum, radar map, voice dispatch player, and verified SOS feed.
  - **Unified Mesh Mode (`#mesh`)**: Side-by-side dual console for presentation and single-screen testing.
- 📦 **32-Byte Compact Binary Protocol**: Optimized fixed-length binary payload packed via `DataView` with IEEE-754 coordinates and CCITT CRC-16 error detection.
- 🔄 **Autonomous Mesh Relay & Deduplication**: Multi-hop peer-to-peer relay with randomized jitter delay (800–1800ms) to eliminate acoustic collisions.
- 🗺️ **Offline Geo-Tactical Map**: Leaflet.js radar map displaying distress beacons, distance estimates, and telemetry markers.
- 📊 **Real-Time FFT Spectrum & Waterfall Visualizer**: 2048-point live frequency analyzer highlighting carrier energy and ambient noise floor.
- 🚀 **Zero Build Step / 100% Self-Contained**: Pure vanilla modern JavaScript, HTML5, and CSS. Runs immediately in any modern browser.

---

## 🏗️ Architecture & File Structure

```
silentbridge/
├── index.html          # Role switcher, Dark tactical UI, Voice recording/playback consoles, Leaflet map
├── crc16.js            # Standalone CCITT CRC-16 integrity checker (polynomial 0x1021)
├── packetEngine.js     # Compact 32-byte binary protocol encoder, decoder & bit-packer
├── audioModem.js       # Dual-engine Web Audio API pipeline: BFSK Transmitter & FFT Demodulator
└── app.js              # State manager, GPS engine, Voice recorder/player, Map coordinator & Mesh sync
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

## 🔊 Audio Modem & Voice Pipeline

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

## 🚀 Quick Start & Multi-Device Testing

### 1. Run Locally
```bash
python -m http.server 8080
```
Open **[http://localhost:8080](http://localhost:8080)** in Chrome, Edge, Safari, or Firefox.

### 2. Multi-Tab / Multi-Device Testing
- **Tab 1 (Sender)**: Open `http://localhost:8080#sender`
- **Tab 2 (Receiver)**: Open `http://localhost:8080#receiver`
- In Tab 1:
  1. Click **"Record Voice (10s)"** and speak an emergency message.
  2. Click **"Acquire High-Accuracy GPS"** or select a preset location.
  3. Click **"BROADCAST ACOUSTIC SOS & VOICE"**.
- In Tab 2:
  1. The acoustic listener detects the incoming signal.
  2. The distress beacon appears on the radar map.
  3. Click **"PLAY VOICE SOS"** to listen to the survivor's voice memo!

---

## 🛡️ License
MIT License. Created for the Open Innovation Hackathon.
