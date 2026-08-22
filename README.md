# SilentBridge — Acoustic P2P Mesh Emergency Communicator

> **Zero-infrastructure, offline emergency peer-to-peer mesh communicator operating without cellular towers, Wi-Fi routers, internet, or Bluetooth pairing.**

Built for 24-Hour Open Innovation Hackathons, **SilentBridge** converts standard smartphones, laptops, and desktop browsers into acoustic modems. It transmits SOS telemetry packets, high-precision GPS coordinates, and emergency voice memos via near-ultrasonic sound waves (**18.0 kHz to 19.5 kHz**) and synchronized P2P channels using standard speakers and microphones.

---

## ⚡ Key Highlights

- ⚡ **1-Tap Instant Panic SOS Button (Sender)**:
  - High-urgency, 1-tap single-button trigger at the top of the interface.
  - Automatically acquires high-accuracy GPS coordinates and broadcasts a high-priority emergency beacon to rescue teams in 1 tap without requiring manual typing.
- 🚨 **Emergency Buzzer & Alarm Siren (Receiver)**:
  - When an incoming disaster message/beacon arrives at the receiver, a **loud dual-frequency emergency alarm buzzer** (960 Hz / 770 Hz siren pattern) sounds automatically to alert rescue personnel immediately.
- 🟢 **Dynamic Glowing Green Dashboard on ACK (Sender)**:
  - When the Rescue Base clicks **"Send ACK"**, an acknowledgment confirmation is modulated back to the survivor.
  - The survivor's dashboard dynamically transforms into a **bright glowing emerald green state** (`ACK RECEIVED ✓ // RESCUE TEAM EN ROUTE`) with an ascending multi-tone confirmation chime.
- 📱 **Dedicated Survivor Portal (`sender.html`)**:
  - Accessible by multiple concurrent citizens/survivors on their mobile devices.
  - Contains **only** sender functionality: 1-Tap panic button, 6 disaster options, auto GPS location, timestamped message, emergency voice memo (with live waveform, Play Preview, and Re-Record), and Broadcast SOS button.
  - **No receiver triage controls or survivor feeds visible to civilians.**
- 🛡️ **Dedicated Rescue Authority Portal (`receiver.html`)**:
  - Restricted to rescue teams, first responders, disaster management authorities, police, and paramedics.
  - Secured with an **Authority Access Gate (PIN: `911` / `RESCUE` or 1-click Authority Pass)**.
  - Live multi-sender triage feed with exact coordinates, direct **"Open in Google Maps ↗"** buttons, emergency voice player (+6dB volume booster), and **"🚨 Dispatch Rescue & Send ACK"** controls.
- 🚨 **6 Standard Disaster Classifications**:
  1. 🏥 **Medical Emergency**
  2. 🏢 **Trapped / Structural Collapse**
  3. 🔥 **Fire / Chemical Hazard**
  4. 🌊 **Flood / Water Rising**
  5. 🌋 **Earthquake / Landslide**
  6. ⛺ **Food / Water / Shelter Needed**
- 🧹 **Auto-Clearing Form**: Message text and recorded audio automatically reset on the sender's interface once successfully transmitted.
- 🚀 **Zero Build Step / 100% Self-Contained**: Pure vanilla modern JavaScript, HTML5, and CSS. Runs immediately in any modern browser.

---

## 🏗️ Architecture & File Structure

```
silentbridge/
├── sender.html         # Dedicated Survivor Portal (1-Tap Panic SOS, 6 Disasters, Voice Memo, Green ACK)
├── receiver.html       # Dedicated Rescue Authority Dashboard (PIN protected, Emergency Buzzer, Triage Feed)
├── index.html          # Unified Portal with Split Demo View & role switcher
├── crc16.js            # Standalone CCITT CRC-16 integrity checker (polynomial 0x1021)
├── packetEngine.js     # 32-byte binary protocol encoder, decoder, bit-packer & ACK creator
├── audioModem.js       # Dual-engine Web Audio API pipeline: BFSK Transmitter & Demodulator
└── app.js              # State manager, GPS tracker, Voice engine, Buzzer synthesizer & ACK coordinator
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
Open in Chrome, Edge, Safari, or Firefox.

### 2. Live URLs

- **📱 Survivor Portal**: **[http://localhost:8080/sender.html](http://localhost:8080/sender.html)**
- **🛡️ Rescue Authority Portal**: **[http://localhost:8080/receiver.html](http://localhost:8080/receiver.html)**
- **🎛️ Unified Split Demo View**: **[http://localhost:8080](http://localhost:8080)**

### 3. Step-by-Step Emergency Demo Flow:

1. **Sender 1-Tap SOS**: Open `sender.html` and click **"⚡ 1-TAP INSTANT PANIC SOS"**.
2. **Receiver Alarm Buzzer**: On `receiver.html`, the emergency beacon arrives and a **loud alarm siren/buzzer** sounds immediately.
3. **Google Maps Routing**: Rescuer clicks **"Open in Google Maps ↗"** or **"Play Voice SOS"**.
4. **Dispatch ACK**: Rescuer clicks **"🚨 Dispatch Rescue & Send ACK"**.
5. **Green Dashboard Confirmation**: On `sender.html`, the survivor's dashboard **turns vivid green** with **"✅ RESCUE ACK RECEIVED"** and an audio confirmation chime.

---

## 🛡️ License
MIT License. Created for the Open Innovation Hackathon.
