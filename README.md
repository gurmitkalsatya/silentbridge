# SilentBridge — Acoustic P2P Mesh Emergency Communicator

> **Zero-infrastructure, offline emergency peer-to-peer mesh communicator operating without cellular towers, Wi-Fi routers, internet, or Bluetooth pairing.**

Built for 24-Hour Open Innovation Hackathons, **SilentBridge** converts standard smartphones, laptops, and desktop browsers into acoustic modems. It transmits SOS telemetry packets, high-precision GPS coordinates, and emergency voice memos via near-ultrasonic sound waves (**18.0 kHz to 19.5 kHz**) and synchronized P2P channels using standard speakers and microphones.

---

## ⚡ Key Highlights

- 📱 **Dedicated Survivor Portal (`sender.html`)**:
  - Accessible by multiple concurrent citizens/survivors on their mobile devices.
  - Contains **only** sender functionality: 6 disaster options, auto GPS location, timestamped message, emergency voice memo (with live waveform, Play Preview, and Re-Record), and Broadcast SOS button.
  - **No receiver triage controls or survivor feed visible to civilians.**
- 🛡️ **Dedicated Rescue Authority Portal (`receiver.html`)**:
  - Restricted to rescue teams, first responders, disaster management authorities, police, and paramedics.
  - Secured with an **Authority Access Gate (PIN: `911` / `RESCUE` or 1-click Authority Pass)**.
  - Live multi-sender triage feed with exact coordinates, direct **"Open in Google Maps ↗"** buttons, emergency voice player (+6dB volume booster), and **"🚨 Dispatch Rescue & Send ACK"** controls.
- ⚡ **Instant SOS Delivery**: SOS alerts, voice memos, and exact GPS coordinates are delivered to the receiver **within seconds**.
- 🚨 **6 Standard Disaster Classifications**:
  1. 🏥 **Medical Emergency**
  2. 🏢 **Trapped / Structural Collapse**
  3. 🔥 **Fire / Chemical Hazard**
  4. 🌊 **Flood / Water Rising**
  5. 🌋 **Earthquake / Landslide**
  6. ⛺ **Food / Water / Shelter Needed**
- 🔄 **Bidirectional Rescue Acknowledgment (ACK)**:
  - When the Rescue Base clicks **"Send ACK"**, an acknowledgment confirmation is modulated back to the survivor.
  - The survivor's screen instantly displays:  
    **"✅ RESCUE ACK CONFIRMED: Base Station Confirmed Distress Beacon! Rescue is En Route."** with an ascending audio chime.
- 🧹 **Auto-Clearing Form**: Message text and recorded audio automatically reset on the sender's interface once successfully transmitted.
- 🚀 **Zero Build Step / 100% Self-Contained**: Pure vanilla modern JavaScript, HTML5, and CSS. Runs immediately in any modern browser.

---

## 🏗️ Architecture & File Structure

```
silentbridge/
├── sender.html         # Dedicated Survivor Portal (Clean SOS Sender, no receiver controls)
├── receiver.html       # Dedicated Rescue Authority Dashboard (PIN protected, triage feed, voice player)
├── index.html          # Unified Portal with Split Demo View & role switcher
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
Open in Chrome, Edge, Safari, or Firefox.

### 2. Dedicated Multi-Role Testing

#### 👩‍🚒 **Role A: Survivor / Field Citizens (`sender.html`)**
- Open **[http://localhost:8080/sender.html](http://localhost:8080/sender.html)**
- Only the emergency sender interface is shown.
- Select a disaster (e.g. *Medical* or *Trapped*), record a voice memo (with **Re-Record** option), and tap **"BROADCAST ACOUSTIC SOS & VOICE"**.
- Form auto-clears and status transitions to `Awaiting Base Station ACK...`.

#### 🛡️ **Role B: Rescue Authority Command (`receiver.html`)**
- Open **[http://localhost:8080/receiver.html](http://localhost:8080/receiver.html)**
- Enter PIN `911` (or tap **"1-Click Pass"**).
- Incoming distress beacon appears with exact coordinates, Google Maps link, and timestamp.
- Click **"Play Voice SOS"** to listen to the audio with live waveform.
- Click **"🚨 Dispatch Rescue & Send ACK"**.

#### 🔔 **Survivor Receives Confirmation (`sender.html`)**
- The survivor's screen on `sender.html` pops up:  
  **"✅ Base Station Confirmed Your Distress Call! Rescue is En Route."** with an audio chime.

---

## 🛡️ License
MIT License. Created for the Open Innovation Hackathon.
