# SilentBridge — Acoustic P2P Mesh Emergency Communicator

> **Zero-infrastructure, offline emergency peer-to-peer mesh communicator operating without cellular towers, Wi-Fi routers, internet, or Bluetooth pairing.**

Built for 24-Hour Open Innovation Hackathons, **SilentBridge** converts standard smartphones, laptops, and desktop browsers into acoustic modems. It transmits SOS telemetry packets, high-precision GPS coordinates, and emergency voice memos via near-ultrasonic sound waves (**18.0 kHz to 19.5 kHz**) and synchronized P2P channels using standard speakers and microphones.

---

## ⚡ Key Highlights

- 🔐 **Rescue Authority Authentication (Sign In & Sign Up with Password)**:
  - Complete tabbed authentication system on `receiver.html`:
    - **Sign In**: Officer Email/ID & Password.
    - **Sign Up / Register**: Officer Name, Agency / Badge ID, Email, and Password.
    - **1-Click Demo Login**: Pre-configured admin access (`commander@rescue.org` / `rescue911`).
    - **Log Out**: Secure session exit button in the header.
- 🚫 **Isolated Receiver Portal (`receiver.html`)**:
  - Exclusively for rescue teams, paramedics, police, and disaster authorities with all civilian survivor controls removed.
- 🌿 **Black & White Aesthetic with Nature Topographical Theme**:
  - High-contrast monochromatic design (deep obsidian black `#07090E` & crisp white).
  - Layered with organic vector **topographical contour elevation lines and mountain textures**.
- ⚡ **1-Tap Instant Panic SOS Button (Sender)**:
  - High-urgency, 1-tap single-button trigger on `sender.html` that automatically grabs current GPS coordinates and broadcasts a distress beacon in 1 tap without typing.
- 🚨 **Realistic Emergency Rescue Siren (Receiver)**:
  - Multi-sweep dual-oscillator acoustic siren (620 Hz up to 1480 Hz wails) that automatically sounds when a survivor distress beacon is detected.
- 🟢 **Dynamic Glowing Green Dashboard on ACK (Sender)**:
  - When Rescue Command clicks **"Dispatch Rescue & Send ACK"**, the survivor's dashboard turns **vivid glowing emerald green** (`ACK RECEIVED ✓ // RESCUE TEAM EN ROUTE`) with a confirmation chime.
- 📱 **Dedicated Survivor Portal (`sender.html`)**:
  - Accessible by multiple concurrent citizens/survivors on their mobile devices (1-Tap SOS, 6 disaster classifications, GPS locator, voice memo with Re-Record, and live green ACK card).
- 🧹 **Auto-Clearing Form**: Message text and recorded audio automatically reset on the sender's interface once successfully transmitted.
- 🚀 **Zero Build Step / 100% Self-Contained**: Pure vanilla modern JavaScript, HTML5, and CSS. Runs immediately in any modern browser.

---

## 🏗️ Architecture & File Structure

```
silentbridge/
├── sender.html         # Dedicated Survivor Portal (B&W Nature Theme, 1-Tap SOS, Voice Memo, Green ACK)
├── receiver.html       # Isolated Rescue Portal (Sign In / Register with password, Siren, Triage Feed)
├── index.html          # Unified Portal with Split Demo View & role switcher
├── crc16.js            # Standalone CCITT CRC-16 integrity checker (polynomial 0x1021)
├── packetEngine.js     # 32-byte binary protocol encoder, decoder, bit-packer & ACK creator
├── audioModem.js       # Dual-engine Web Audio API pipeline: BFSK Transmitter & Demodulator
└── app.js              # State manager, Auth engine, GPS tracker, Voice engine & Siren synthesizer
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

1. **Rescue Sign In / Sign Up**: Open `receiver.html`, sign in with `commander@rescue.org` / `rescue911` (or click **"1-Click Demo Login"** or **"Sign Up"** to create a new account).
2. **Survivor 1-Tap SOS**: Open `sender.html` and click **"⚡ 1-TAP INSTANT PANIC SOS"**.
3. **Rescue Siren**: On `receiver.html`, the emergency beacon arrives and the **loud emergency rescue siren** wails automatically.
4. **Google Maps Routing**: Rescuer clicks **"Open in Google Maps ↗"** or **"Play Voice SOS"**.
5. **Dispatch ACK**: Rescuer clicks **"🚨 Dispatch Rescue & Send ACK"**.
6. **Green Dashboard Confirmation**: On `sender.html`, the survivor's dashboard **turns vivid glowing green** with **"✅ RESCUE ACK RECEIVED"** and an audio confirmation chime.

---

## 🛡️ License
MIT License. Created for the Open Innovation Hackathon.
