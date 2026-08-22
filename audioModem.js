/**
 * SilentBridge - Dual-Engine Web Audio Acoustic Modem
 * Handles Binary Frequency Shift Keying (BFSK) Transmission (Tx) and Real-Time FFT Demodulation (Rx).
 * 
 * Frequencies:
 *  - Ultrasonic Mode (Default):
 *      Preamble: 18.0 kHz (100ms)
 *      Bit 0:    18.5 kHz (40ms)
 *      Bit 1:    19.5 kHz (40ms)
 *      Guard:    5ms silence
 *  - Audible Demo Mode:
 *      Preamble: 1.5 kHz (100ms)
 *      Bit 0:    1.8 kHz (40ms)
 *      Bit 1:    2.2 kHz (40ms)
 *      Guard:    5ms silence
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./crc16', './packetEngine'], factory);
  } else if (typeof module === 'object' && module.exports) {
    const CRC16 = require('./crc16');
    const PacketEngine = require('./packetEngine');
    module.exports = factory(CRC16, PacketEngine);
  } else {
    root.AudioModem = factory(root.CRC16, root.PacketEngine);
  }
}(typeof self !== 'undefined' ? self : this, function (CRC16, PacketEngine) {
  'use strict';

  // Frequency Profiles
  const FREQ_PROFILES = {
    ultrasonic: {
      name: 'Near-Ultrasonic (18.0 - 19.5 kHz)',
      preambleFreq: 18000,
      bit0Freq: 18500,
      bit1Freq: 19500,
      filterType: 'highpass',
      filterFreq: 17000,
      isAudible: false
    },
    audible: {
      name: 'Audible Demo (1.5 - 2.2 kHz)',
      preambleFreq: 1500,
      bit0Freq: 1800,
      bit1Freq: 2200,
      filterType: 'bandpass',
      filterFreq: 1850,
      isAudible: true
    }
  };

  // Receiver State Constants
  const RX_STATE = {
    OFF: 'OFF',
    IDLE: 'IDLE',
    LISTENING: 'LISTENING',
    PREAMBLE_DETECTED: 'PREAMBLE_DETECTED',
    RECEIVING_BITS: 'RECEIVING_BITS',
    VALIDATING: 'VALIDATING'
  };

  class AudioModem {
    constructor(options = {}) {
      this.mode = options.mode || 'ultrasonic';
      this.profile = FREQ_PROFILES[this.mode] || FREQ_PROFILES.ultrasonic;

      // Modulation Timing Specifications
      this.preambleDuration = options.preambleDuration || 0.100; // 100ms
      this.bitDuration = options.bitDuration || 0.040;           // 40ms
      this.guardDuration = options.guardDuration || 0.005;       // 5ms
      this.rampDuration = 0.003;                                // 3ms smooth envelope

      // Audio Contexts & Nodes
      this.audioCtx = null;
      this.micStream = null;
      this.micSourceNode = null;
      this.filterNode = null;
      this.analyserNode = null;
      this.fftSize = 2048;
      this.fftBuffer = null;
      this.floatFftBuffer = null;

      // Status
      this.isTransmitting = false;
      this.isListening = false;
      this.rxState = RX_STATE.OFF;

      // Receiver internal tracking
      this.rxAnimationId = null;
      this.preambleHitCount = 0;
      this.rxBitBuffer = [];
      this.rxExpectedBits = 256; // 32 bytes * 8 bits
      this.rxBitStartTime = 0;
      this.rxLastSampleTime = 0;
      this.rxBitIndex = 0;
      this.rxBitSamples = [];
      this.rxTimeoutTimer = null;
      this.adaptiveThreshold = 12; // dB above ambient baseline
      this.ambientNoiseFloor = -100;

      // Event Callbacks
      this.onTxStart = null;
      this.onTxProgress = null;
      this.onTxEnd = null;
      this.onRxStateChange = null;
      this.onRxProgress = null;
      this.onPacketReceived = null;
      this.onCrcError = null;
      this.onAudioLevels = null;
      this.onError = null;
    }

    /**
     * Initializes or resumes the Web Audio Context
     */
    async ensureAudioContext() {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
          throw new Error('Web Audio API is not supported in this browser.');
        }
        this.audioCtx = new AudioContextClass();
      }
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
      return this.audioCtx;
    }

    /**
     * Switch between 'ultrasonic' and 'audible' frequency modes
     */
    setFrequencyMode(mode) {
      if (!FREQ_PROFILES[mode]) {
        throw new Error(`Unknown mode: ${mode}. Available: 'ultrasonic', 'audible'`);
      }
      this.mode = mode;
      this.profile = FREQ_PROFILES[mode];

      if (this.filterNode && this.audioCtx) {
        this.filterNode.type = this.profile.filterType;
        this.filterNode.frequency.setValueAtTime(this.profile.filterFreq, this.audioCtx.currentTime);
      }
    }

    /**
     * Starts listening to the microphone for incoming acoustic packets
     */
    async startListening() {
      if (this.isListening) return;

      try {
        await this.ensureAudioContext();

        // Request clean uncompressed raw audio stream
        const constraints = {
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
            sampleRate: { ideal: 48000 }
          }
        };

        this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
        this.micSourceNode = this.audioCtx.createMediaStreamSource(this.micStream);

        // Pre-filtering node to suppress low-frequency room noise / voices
        this.filterNode = this.audioCtx.createBiquadFilter();
        this.filterNode.type = this.profile.filterType;
        this.filterNode.frequency.setValueAtTime(this.profile.filterFreq, this.audioCtx.currentTime);
        this.filterNode.Q.setValueAtTime(1.0, this.audioCtx.currentTime);

        // Analyser node for FFT spectrum calculation
        this.analyserNode = this.audioCtx.createAnalyser();
        this.analyserNode.fftSize = this.fftSize;
        this.analyserNode.smoothingTimeConstant = 0.15; // Fast response for 40ms symbols
        this.analyserNode.minDecibels = -100;
        this.analyserNode.maxDecibels = -10;

        // Pipe: Mic -> Filter -> Analyser
        this.micSourceNode.connect(this.filterNode);
        this.filterNode.connect(this.analyserNode);

        this.fftBuffer = new Uint8Array(this.analyserNode.frequencyBinCount);
        this.floatFftBuffer = new Float32Array(this.analyserNode.frequencyBinCount);

        this.isListening = true;
        this._setRxState(RX_STATE.LISTENING);

        // Start real-time demodulator loop
        this._rxLoop = this._rxLoop.bind(this);
        this.rxAnimationId = requestAnimationFrame(this._rxLoop);
      } catch (err) {
        this.isListening = false;
        this._setRxState(RX_STATE.OFF);
        if (this.onError) this.onError(err);
        throw err;
      }
    }

    /**
     * Stops listening to the microphone
     */
    stopListening() {
      if (!this.isListening) return;

      this.isListening = false;
      if (this.rxAnimationId) {
        cancelAnimationFrame(this.rxAnimationId);
        this.rxAnimationId = null;
      }
      if (this.rxTimeoutTimer) {
        clearTimeout(this.rxTimeoutTimer);
        this.rxTimeoutTimer = null;
      }

      if (this.micStream) {
        this.micStream.getTracks().forEach(track => track.stop());
        this.micStream = null;
      }

      if (this.micSourceNode) {
        this.micSourceNode.disconnect();
        this.micSourceNode = null;
      }

      if (this.filterNode) {
        this.filterNode.disconnect();
        this.filterNode = null;
      }

      this._setRxState(RX_STATE.OFF);
    }

    /**
     * Helper to get FFT frequency bin index for a given frequency
     */
    freqToBin(freq) {
      if (!this.audioCtx) return 0;
      const sampleRate = this.audioCtx.sampleRate || 48000;
      const nyquist = sampleRate / 2;
      const binCount = this.analyserNode ? this.analyserNode.frequencyBinCount : (this.fftSize / 2);
      const bin = Math.round((freq / nyquist) * binCount);
      return Math.max(0, Math.min(binCount - 1, bin));
    }

    /**
     * Gets average energy (in dB) across a small frequency window around target frequency
     */
    getEnergyAtFreq(freq, windowBins = 1) {
      if (!this.analyserNode || !this.floatFftBuffer) return -120;
      const centerBin = this.freqToBin(freq);
      const startBin = Math.max(0, centerBin - windowBins);
      const endBin = Math.min(this.analyserNode.frequencyBinCount - 1, centerBin + windowBins);
      
      let sumPower = 0;
      let count = 0;
      for (let b = startBin; b <= endBin; b++) {
        const db = this.floatFftBuffer[b];
        // Convert dB to linear power for accurate energy summation
        const power = Math.pow(10, db / 10);
        sumPower += power;
        count++;
      }
      const avgPower = count > 0 ? (sumPower / count) : 1e-12;
      return 10 * Math.log10(Math.max(avgPower, 1e-12));
    }

    /**
     * Calculates ambient noise floor around target band
     */
    getAmbientNoiseFloor() {
      if (!this.analyserNode || !this.floatFftBuffer) return -100;
      const centerBin = this.freqToBin(this.profile.bit0Freq);
      // Sample bins 5-15 bins away from carrier to measure baseline noise
      let sumPower = 0;
      let count = 0;
      for (let offset of [-15, -12, -9, 9, 12, 15]) {
        const b = centerBin + offset;
        if (b >= 0 && b < this.analyserNode.frequencyBinCount) {
          const db = this.floatFftBuffer[b];
          sumPower += Math.pow(10, db / 10);
          count++;
        }
      }
      const avgPower = count > 0 ? (sumPower / count) : 1e-10;
      return 10 * Math.log10(Math.max(avgPower, 1e-10));
    }

    /**
     * Internal Rx State Setter with event trigger
     */
    _setRxState(state, meta = {}) {
      if (this.rxState !== state) {
        this.rxState = state;
        if (this.onRxStateChange) {
          this.onRxStateChange(state, meta);
        }
      }
    }

    /**
     * Main Demodulator Frame Loop
     */
    _rxLoop() {
      if (!this.isListening || !this.analyserNode) return;

      this.analyserNode.getFloatFrequencyData(this.floatFftBuffer);
      this.analyserNode.getByteFrequencyData(this.fftBuffer);

      const preambleEnergy = this.getEnergyAtFreq(this.profile.preambleFreq, 1);
      const bit0Energy = this.getEnergyAtFreq(this.profile.bit0Freq, 1);
      const bit1Energy = this.getEnergyAtFreq(this.profile.bit1Freq, 1);
      const noiseFloor = this.getAmbientNoiseFloor();
      this.ambientNoiseFloor = noiseFloor;

      const peakSignal = Math.max(preambleEnergy, bit0Energy, bit1Energy);
      const snr = Math.max(0, peakSignal - noiseFloor);

      // Emit audio levels to UI HUD
      if (this.onAudioLevels) {
        let peakFreq = this.profile.preambleFreq;
        if (bit0Energy > preambleEnergy && bit0Energy > bit1Energy) peakFreq = this.profile.bit0Freq;
        else if (bit1Energy > preambleEnergy && bit1Energy > bit0Energy) peakFreq = this.profile.bit1Freq;

        this.onAudioLevels({
          snr: parseFloat(snr.toFixed(1)),
          noiseFloor: parseFloat(noiseFloor.toFixed(1)),
          preambleEnergy: parseFloat(preambleEnergy.toFixed(1)),
          bit0Energy: parseFloat(bit0Energy.toFixed(1)),
          bit1Energy: parseFloat(bit1Energy.toFixed(1)),
          peakFreq,
          isSignalPresent: snr > 8,
          rxState: this.rxState
        });
      }

      const now = performance.now();

      // State Machine Demodulation Logic
      switch (this.rxState) {
        case RX_STATE.LISTENING: {
          // Check for preamble tone presence (SNR > threshold)
          const preambleSnr = preambleEnergy - noiseFloor;
          if (preambleSnr >= this.adaptiveThreshold && preambleEnergy > -75) {
            this.preambleHitCount++;
            if (this.preambleHitCount >= 2) {
              // Preamble verified!
              this._setRxState(RX_STATE.PREAMBLE_DETECTED);
              this._scheduleBitReception(now);
            }
          } else {
            this.preambleHitCount = Math.max(0, this.preambleHitCount - 1);
          }
          break;
        }

        case RX_STATE.PREAMBLE_DETECTED: {
          // Waiting for preamble tone to finish and first bit slot to begin
          // Handled by timing in _scheduleBitReception
          break;
        }

        case RX_STATE.RECEIVING_BITS: {
          // Sampling is orchestrated by timing loop
          break;
        }
      }

      this.rxAnimationId = requestAnimationFrame(this._rxLoop);
    }

    /**
     * Prepares and starts sampling bits after preamble
     */
    _scheduleBitReception(detectedTimeMs) {
      this.preambleHitCount = 0;
      this.rxBitBuffer = [];
      this.rxBitIndex = 0;

      // The preamble is ~100ms. If we detected it halfway (~50ms in),
      // the first bit will start after remaining preamble (~50ms) + guard (5ms) + half bitDuration (20ms).
      const remainingPreambleTime = (this.preambleDuration * 1000) * 0.45;
      const initialDelayMs = remainingPreambleTime + (this.guardDuration * 1000) + ((this.bitDuration * 1000) / 2);
      
      const symbolIntervalMs = (this.bitDuration + this.guardDuration) * 1000;

      // Watchdog to abort if reception hangs
      if (this.rxTimeoutTimer) clearTimeout(this.rxTimeoutTimer);
      const maxExpectedDurationMs = (this.rxExpectedBits + 5) * symbolIntervalMs + 3000;
      this.rxTimeoutTimer = setTimeout(() => {
        if (this.rxState === RX_STATE.RECEIVING_BITS || this.rxState === RX_STATE.PREAMBLE_DETECTED) {
          console.warn('[AudioModem] Rx timeout watchdog triggered. Resetting to LISTENING.');
          this._setRxState(RX_STATE.LISTENING);
        }
      }, maxExpectedDurationMs);

      setTimeout(() => {
        if (this.rxState !== RX_STATE.PREAMBLE_DETECTED && this.rxState !== RX_STATE.LISTENING) return;
        this._setRxState(RX_STATE.RECEIVING_BITS, { totalBits: this.rxExpectedBits });
        this._sampleNextBit(0, symbolIntervalMs);
      }, initialDelayMs);
    }

    /**
     * Recursively samples each bit at precise symbol center intervals
     */
    _sampleNextBit(bitIndex, symbolIntervalMs) {
      if (!this.isListening || this.rxState !== RX_STATE.RECEIVING_BITS) return;

      if (bitIndex >= this.rxExpectedBits) {
        // All 256 bits gathered!
        this._finalizePacket();
        return;
      }

      // Sample energy at Bit 0 vs Bit 1
      const bit0Energy = this.getEnergyAtFreq(this.profile.bit0Freq, 1);
      const bit1Energy = this.getEnergyAtFreq(this.profile.bit1Freq, 1);

      // Decision logic: compare energy levels
      let bitValue = 0;
      if (bit1Energy > bit0Energy) {
        bitValue = 1;
      } else {
        bitValue = 0;
      }

      this.rxBitBuffer.push(bitValue);
      this.rxBitIndex = bitIndex + 1;

      if (this.onRxProgress) {
        this.onRxProgress({
          currentBit: bitIndex + 1,
          totalBits: this.rxExpectedBits,
          bitValue,
          progressPercent: Math.round(((bitIndex + 1) / this.rxExpectedBits) * 100)
        });
      }

      // Schedule next bit sample
      setTimeout(() => {
        this._sampleNextBit(bitIndex + 1, symbolIntervalMs);
      }, symbolIntervalMs);
    }

    /**
     * Converts accumulated 256 bits into 32 bytes and verifies integrity
     */
    _finalizePacket() {
      this._setRxState(RX_STATE.VALIDATING);
      if (this.rxTimeoutTimer) {
        clearTimeout(this.rxTimeoutTimer);
        this.rxTimeoutTimer = null;
      }

      const totalBytes = Math.floor(this.rxBitBuffer.length / 8);
      const uint8 = new Uint8Array(totalBytes);

      for (let byteIdx = 0; byteIdx < totalBytes; byteIdx++) {
        let byteVal = 0;
        for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
          const bit = this.rxBitBuffer[byteIdx * 8 + bitIdx];
          byteVal = (byteVal << 1) | (bit & 1);
        }
        uint8[byteIdx] = byteVal;
      }

      const parsed = PacketEngine.parsePacket(uint8);

      if (parsed.valid) {
        if (this.onPacketReceived) {
          this.onPacketReceived(parsed);
        }
      } else {
        if (this.onCrcError) {
          this.onCrcError({
            parsed,
            rawBytes: uint8,
            error: parsed.error || (!parsed.syncValid ? 'Invalid Sync Byte' : 'CRC Checksum Mismatch')
          });
        }
      }

      // Brief recovery pause before re-arming listener
      setTimeout(() => {
        if (this.isListening) {
          this._setRxState(RX_STATE.LISTENING);
        }
      }, 500);
    }

    /**
     * Transmits a 32-byte packet over acoustic BFSK
     * 
     * @param {Uint8Array} packetBytes - 32-byte binary packet
     * @returns {Promise<void>} Resolves when transmission finishes
     */
    async transmitPacket(packetBytes) {
      if (this.isTransmitting) {
        throw new Error('Acoustic transmission already in progress.');
      }

      if (!packetBytes || packetBytes.length < 32) {
        throw new Error('Invalid packet: must be exactly 32 bytes.');
      }

      await this.ensureAudioContext();

      this.isTransmitting = true;
      if (this.onTxStart) this.onTxStart(packetBytes);

      // Convert 32 bytes into 256 bits (MSB first)
      const bits = [];
      for (let i = 0; i < 32; i++) {
        const byte = packetBytes[i];
        for (let b = 7; b >= 0; b--) {
          bits.push((byte >> b) & 1);
        }
      }

      const totalBits = bits.length; // 256 bits
      const startTime = this.audioCtx.currentTime + 0.05; // 50ms startup cushion

      // Create Master Output Gain Node for Transmitter
      const masterGain = this.audioCtx.createGain();
      masterGain.gain.setValueAtTime(0, this.audioCtx.currentTime);
      masterGain.connect(this.audioCtx.destination);

      let scheduledTime = startTime;

      // 1. Transmit Preamble Tone
      const preambleFreq = this.profile.preambleFreq;
      this._scheduleTone(scheduledTime, preambleFreq, this.preambleDuration, masterGain);
      scheduledTime += this.preambleDuration + this.guardDuration;

      // 2. Transmit 256 Bits
      const symbolDuration = this.bitDuration;
      const guardDuration = this.guardDuration;

      // Progress reporting timers
      const progressTimers = [];

      for (let i = 0; i < totalBits; i++) {
        const bit = bits[i];
        const freq = (bit === 1) ? this.profile.bit1Freq : this.profile.bit0Freq;
        
        this._scheduleTone(scheduledTime, freq, symbolDuration, masterGain);

        // Schedule progress callback
        const bitIndex = i;
        const delayUntilBitMs = Math.max(0, (scheduledTime - this.audioCtx.currentTime) * 1000);
        const timer = setTimeout(() => {
          if (this.onTxProgress) {
            this.onTxProgress({
              currentBit: bitIndex + 1,
              totalBits,
              currentFreq: freq,
              bitValue: bit,
              progressPercent: Math.round(((bitIndex + 1) / totalBits) * 100)
            });
          }
        }, delayUntilBitMs);
        progressTimers.push(timer);

        scheduledTime += symbolDuration + guardDuration;
      }

      // Total transmission duration
      const totalDurationMs = (scheduledTime - this.audioCtx.currentTime) * 1000;

      return new Promise((resolve) => {
        setTimeout(() => {
          this.isTransmitting = false;
          masterGain.disconnect();
          if (this.onTxEnd) this.onTxEnd(packetBytes);
          resolve();
        }, totalDurationMs + 100);
      });
    }

    /**
     * Schedules a single sine tone pulse with smooth cosine/linear envelope ramps
     */
    _scheduleTone(startTime, frequency, duration, destinationNode) {
      const osc = this.audioCtx.createOscillator();
      const toneGain = this.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, startTime);

      // Smooth envelope ramp to prevent wideband click/pop harmonics
      const ramp = Math.min(this.rampDuration, duration * 0.1);
      const peakVolume = this.profile.isAudible ? 0.35 : 0.85; // High volume for ultrasonic

      toneGain.gain.setValueAtTime(0.0001, startTime);
      toneGain.gain.linearRampToValueAtTime(peakVolume, startTime + ramp);
      toneGain.gain.setValueAtTime(peakVolume, startTime + duration - ramp);
      toneGain.gain.linearRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(toneGain);
      toneGain.connect(destinationNode);

      osc.start(startTime);
      osc.stop(startTime + duration + 0.005);
    }

    /**
     * Diagnostic Helper: Directly injects a synthetic packet into the receiver pipeline
     * (Simulates zero-latency acoustic reception for testing)
     */
    injectSyntheticPacket(packetBytes) {
      const parsed = PacketEngine.parsePacket(packetBytes);
      if (parsed.valid && this.onPacketReceived) {
        this.onPacketReceived(parsed);
      } else if (!parsed.valid && this.onCrcError) {
        this.onCrcError({
          parsed,
          rawBytes: packetBytes,
          error: parsed.error || 'Synthetic CRC Mismatch'
        });
      }
      return parsed;
    }
  }

  AudioModem.FREQ_PROFILES = FREQ_PROFILES;
  AudioModem.RX_STATE = RX_STATE;

  return AudioModem;
}));
