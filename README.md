# SilentBridge — 100% Offline Acoustic P2P Mesh Emergency Communicator

> **Zero-infrastructure, 100% offline emergency peer-to-peer mesh communicator operating without cellular towers, Wi-Fi routers, internet, or Bluetooth pairing.**

Built for 24-Hour Open Innovation Hackathons, **SilentBridge** converts standard smartphones, laptops, and desktop browsers into acoustic modems. It transmits SOS telemetry packets, high-precision satellite GPS coordinates, and emergency voice memos via near-ultrasonic sound waves (**18.0 kHz to 19.5 kHz**) and synchronized P2P channels using standard speakers and microphones.

---

## 🛰️ How SilentBridge Works in Towerless, Zero-Internet Disaster Areas

When disaster strikes (earthquakes, floods, hurricanes, structural collapses), cellular base stations collapse and power grids fail. SilentBridge functions **100% offline** through physical-layer mechanics:

### 1. 🛰️ Direct GNSS Satellite Hardware GPS (Zero Towers / Zero SIM)
- **Direct Space Connection**: Modern smartphones, laptops, and tablets contain dedicated physical **GNSS receiver chips** (GPS, GLONASS, Galileo, BeiDou) that communicate directly with satellites in Earth's orbit.
- **No Cellular/Internet Required**: Calculating exact latitude and longitude operates passively by receiving atomic clock timing signals directly from space. No SIM card, cellular carrier, or Wi-Fi is needed.
- **Cached Satellite Position**: SilentBridge caches the latest hardware GNSS lock in local memory. If a survivor is trapped deep inside a collapsed basement or rubble where satellite line-of-sight is obstructed, their last verified coordinates are immediately retrieved and transmitted.

### 2. 🔊 Acoustic Physical Airwave Transmission (Zero Radio/Zero Pairing)
- **Sound Waves as Carrier**: Data packets (disaster category, exact GPS coordinates, timestamp, and voice audio) are encoded into Binary Frequency-Shift Keying (**BFSK**) audio bursts emitted from the device's physical speaker.
- **Ultrasonic Frequencies**: Operates at **18.0 kHz to 19.5 kHz** (near-ultrasonic and inaudible to human ears) or audible demo frequencies (**1.5 kHz to 2.2 kHz**).
- **Zero Radio Interference**: Requires no Bluetooth pairing, no Wi-Fi hotspot, and no cellular spectrum.

### 3. 📦 PWA Offline Service Worker (`service-worker.js`)
- Pre-caches all scripts, stylesheets, and assets via a Cache-First service worker.
- Boots instantly and operates fully in **Airplane Mode** with zero network connection.

---

## ⚡ Key Highlights

- 🛰️ **Direct Satellite GNSS Hardware GPS**: Locks exact coordinates with ±3.5m accuracy directly from Earth's orbital satellites.
- ⚡ **1-Tap Instant Panic SOS Button (Sender)**: Single-tap emergency trigger on `sender.html` that automatically grabs current GPS coordinates and broadcasts a distress beacon in 1 tap without typing.
- 🚨 **Realistic Emergency Rescue Siren (Receiver)**: Multi-sweep dual-oscillator acoustic siren (620 Hz to 1480 Hz wails) that automatically sounds when a survivor distress beacon is detected.
- 🟢 **Dynamic Glowing Green Dashboard on ACK (Sender)**: When Rescue Command clicks **"Dispatch Rescue & Send ACK"**, the survivor's dashboard turns **vivid glowing emerald green** (`ACK RECEIVED ✓ // RESCUE TEAM EN ROUTE`) with an ascending audio confirmation chime.
- 🔐 **Rescue Authority Authentication (Sign In & Sign Up with Password)**: Full offline credentials with 1-Click Demo Login (`commander@rescue.org` / `rescue911`) and secure session log out.
- 🚫 **Isolated Rescuer Portal (`receiver.html`)**: Exclusively for rescue teams, paramedics, police, and disaster authorities with survivor and split demo buttons removed.
- 🌿 **Black & White Aesthetic with Nature Topographical Theme**: High-contrast monochrome design layered with organic vector **topographical contour elevation lines**.
- 🧹 **Auto-Clearing Form**: Message text and recorded audio automatically reset on the sender's interface once successfully transmitted.
- 🚀 **Zero Build Step / 100% Self-Contained**: Pure vanilla modern JavaScript, HTML5, and CSS. Runs immediately in any modern browser.

---

## 🏗️ Architecture & File Structure

```
silentbridge/
├── sender.html         # Dedicated Survivor Portal (B&W Nature Theme, 1-Tap SOS, Satellite GPS, Green ACK)
├── receiver.html       # Isolated Rescuer Portal (Sign In/Register, Emergency Siren, Triage Feed)
├── index.html          # Rescuer Portal Entry point
├── service-worker.js   # 100% Offline Cache-First Service Worker for Airplane Mode
├── manifest.json       # PWA offline installation configuration
├── crc16.js            # Standalone CCITT CRC-16 integrity checker (polynomial 0x1021)
├── packetEngine.js     # 32-byte binary protocol encoder, decoder, bit-packer & ACK creator
├── audioModem.js       # Dual-engine Web Audio API pipeline: BFSK Transmitter & Demodulator
└── app.js              # State manager, Auth engine, Satellite GPS tracker & Siren synthesizer
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

## 🚀 Live Deployment & Online URLs

SilentBridge is deployed to GitHub Pages and ready for instant use across any browser:

- **📱 Survivor SOS Portal**: **[https://gurmitkalsatya.github.io/silentbridge/sender.html](https://gurmitkalsatya.github.io/silentbridge/sender.html)**
- **🛡️ Rescuer Command Portal**: **[https://gurmitkalsatya.github.io/silentbridge/receiver.html](https://gurmitkalsatya.github.io/silentbridge/receiver.html)** *(Master Password: `admin@321`)*
- **🌐 Main Unified Entry**: **[https://gurmitkalsatya.github.io/silentbridge/](https://gurmitkalsatya.github.io/silentbridge/)**

---

## 🖐️ Safety Dispatch Pipeline & Anti-Spam Protection

SilentBridge includes a triple-layer safety dispatch architecture to eliminate accidental activations while supporting hands-free emergency dispatch:

1. **🖐️ 1.5-Second Gesture Hold Threshold**:
   - Uses **MediaPipe Hands** to detect `✊ Closed Fist` (Panic/Trapped), `☝️ Pointing Index` (Medical), and `✌️ V-Sign` (Evacuation/Rescue).
   - Requires holding the gesture continuously for **1.5 seconds** (1500ms) with a real-time progress HUD (0% to 100%).
   - If the hand moves, changes gesture, or exits the camera frame before 1.5s, the timer **immediately resets to 0%**.
2. **🚨 5-Second Cancel / Undo Overlay**:
   - Once armed (via gesture or 1-Tap SOS), a prominent red modal overlay counts down from **5s to 1s** with a shrinking progress bar.
   - Clicking **`🛑 CANCEL / UNDO DISPATCH`** immediately aborts the timer and sends zero network/acoustic data.
3. **⏳ 60-Second Anti-Spam Cooldown**:
   - Once dispatched, the survivor UI locks into a **60-second cooldown** to prevent accidental airwave flooding.
   - All gesture triggers and buttons are locked (`opacity-50 pointer-events-none`) with a live `⏳ Anti-Spam Cooldown: Xs remaining` badge.
4. **🤖 Automated False Alarm Triage & Siren Suppression**:
   - Distress beacons lacking voice SOS audio or with invalid GPS coordinates are automatically tagged as potential hoaxes with a muted alert, sparing rescue teams from false panic.

---

## 🏃 Run Locally

```bash
python -m http.server 8080
```
Open **[http://localhost:8080/sender.html](http://localhost:8080/sender.html)** in any browser.

---

## 🛡️ License
MIT License. Created for the Open Innovation Hackathon.

