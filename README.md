# SilentBridge — Acoustic P2P Mesh Emergency Communicator

> **Zero-infrastructure, offline emergency peer-to-peer mesh communicator operating without cellular towers, Wi-Fi routers, internet, or Bluetooth pairing.**

Built for 24-Hour Open Innovation Hackathons, **SilentBridge** converts standard smartphones, laptops, and desktop browsers into acoustic modems. It transmits SOS telemetry packets, high-precision GPS coordinates, and emergency voice memos via near-ultrasonic sound waves (**18.0 kHz to 19.5 kHz**) and synchronized P2P channels using standard speakers and microphones.

---

## ⚡ Key Highlights

- ⚡ **Instant SOS Delivery**: SOS alerts, voice memos, and exact GPS coordinates are delivered to the receiver **within seconds**.
- 🚨 **6 Standard Disaster Classifications**:
  1. 🏥 **Medical Emergency**
  2. 🏢 **Trapped / Structural Collapse**
  3. 🔥 **Fire / Chemical Hazard**
  4. 🌊 **Flood / Water Rising**
  5. 🌋 **Earthquake / Landslide**
  6. ⛺ **Food / Water / Shelter Needed**
- 🎙️ **Emergency Voice Memo Recording with Re-Record**: Survivors can record up to 10-second voice memos with live audio waveforms, preview audio, and re-record before sending.
- 📱 **Streamlined Survivor / Sender UI (No Map)**: Clean, rapid disaster interface with auto-detected GPS coordinates, timestamped message box, and one-tap SOS broadcast.
- 🗺️ **One-Click Google Maps Navigation (Receiver)**: Direct **"Open in Google Maps"** links (`https://www.google.com/maps?q=lat,lon`) on every incoming beacon for instant route dispatch.
- 🔊 **Simplified Rescue Receiver UI**: Clean dashboard displaying incoming messages, live audio voice players with +6dB field gain booster, and one-tap ACK response.
- 🔄 **Bidirectional Rescue Acknowledgment (ACK)**: When the Rescue Base receives a distress beacon, they can dispatch an ACK confirmation back to the survivor.
- 👥 **Multiple Concurrent Senders**: Real-time triage feed tracking multiple survivors simultaneously.
- 🧹 **Auto-Clearing Form**: Message text and recorded audio automatically reset on the sender's interface once successfully transmitted.
- 🚀 **Zero Build Step / 100% Self-Contained**: Pure vanilla modern JavaScript, HTML5, and CSS. Runs immediately in any modern browser.

---

## 🏗️ Architecture & File Structure

```
silentbridge/
├── index.html          # Clean role switcher, 6 disaster grid, Voice recorder, Google Maps links
├── crc16.js            # Standalone CCITT CRC-16 integrity checker (polynomial 0x1021)
├── packetEngine.js     # 32-byte binary protocol encoder, decoder, bit-packer & ACK creator
├── audioModem.js       # Dual-engine Web Audio API pipeline: BFSK Transmitter & Demodulator
└── app.js              # State manager, GPS tracker, Voice engine, ACK coordinator & Mesh router
```

---

## 📐 32-Byte Binary Packet Schema

All telemetry is serialized into a fixed 32-byte (`ArrayBuffer`) payload:

```
+---------------+------------------+------------------+------------------+
| Byte 0        | Bytes 1–2        | Byte 3           | Bytes 4–7        |
| Sync (0xAA/AC)| Message ID/ACK ID| Distress (1-6/15)| Latitude (f32)   |
+---------------+------------------+------------------+------------------+
| Bytes 8–11    | Byte 12          | Bytes 13–29      | Bytes 30–31      |
| Longitude(f32)| TTL / Hops Left  | Short Msg (17 B) | CRC-16 (CCITT)   |
+---------------+------------------+------------------+------------------+
```

---

## 🚀 How to Test & Demo

### 1. Run Locally
```bash
python -m http.server 8080
```
Open **[http://localhost:8080](http://localhost:8080)** in Chrome, Edge, Safari, or Firefox.

### 2. Multi-Tab Testing (Survivor & Rescue Base)
- **Tab 1 (Survivor / Sender)**: Open `http://localhost:8080#sender`
- **Tab 2 (Rescue Base / Receiver)**: Open `http://localhost:8080#receiver`

**Step-by-Step Flow**:
1. In **Tab 1 (Sender)**:
   - Select one of the **6 Disaster Classifications** (e.g. *Medical* or *Flood*).
   - Click **"Record Voice (10s)"**, speak an emergency message, and test the **"Re-Record"** or **"Play Preview"** buttons.
   - Click **"BROADCAST ACOUSTIC SOS & VOICE"**.
   - The form immediately auto-clears.
2. In **Tab 2 (Receiver)**:
   - Within seconds, the emergency card appears with the disaster badge, message, timestamp, and coordinates.
   - Click **"Open in Google Maps ↗"** to open the survivor's exact location in Google Maps.
   - Click **"Play Voice SOS"** to listen to the survivor's audio memo with the live waveform visualizer.
   - Click **"🚨 Send ACK"** to dispatch rescue confirmation.
3. In **Tab 1 (Sender)**:
   - A bright green confirmation banner appears: **"✅ Base Station Confirmed Distress Beacon! Rescue is En Route."** with a confirmation chime.

---

## 🛡️ License
MIT License. Created for the Open Innovation Hackathon.
