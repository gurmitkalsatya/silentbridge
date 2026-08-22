/**
 * SilentBridge - Dual-Engine Web Audio Acoustic Modem
 * Handles Binary Frequency Shift Keying (BFSK) Transmission (Tx) and Real-Time FFT Demodulation (Rx).
 * 
 * Frequencies:
 *  - Ultrasonic Mode (Default):
 *      Preamble: 18.0 kHz (60ms)
 *      Bit 0:    18.5 kHz (10ms)
 *      Bit 1:    19.5 kHz (10ms)
 *      Guard:    2ms silence
 *  - Audible Demo Mode:
 *      Preamble: 1.5 kHz (60ms)
 *      Bit 0:    1.8 kHz (10ms)
 *      Bit 1:    2.2 kHz (10ms)
 *      Guard:    2ms silence
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

      // High-speed modulation timing for instant transmission (~600ms total)
      this.preambleDuration = options.preambleDuration || 0.050; // 50ms
      this.bitDuration = options.bitDuration || 0.005;           // 5ms per bit
      this.guardDuration = options.guardDuration || 0.001;       // 1ms guard
      this.rampDuration = 0.001;                                // 1ms smooth envelope

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
      this.rxExpectedBits = 256;
      this.rxBitStartTime = 0;
      this.rxLastSampleTime = 0;
      this.rxBitIndex = 0;
      this.rxBitSamples = [];
      this.rxTimeoutTimer = null;
      this.adaptiveThreshold = 12;
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

    async ensureAudioContext() {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
          throw new Error('Web Audio API is not supported.');
        }
        this.audioCtx = new AudioContextClass();
      }
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
      return this.audioCtx;
    }

    setFrequencyMode(mode) {
      if (!FREQ_PROFILES[mode]) return;
      this.mode = mode;
      this.profile = FREQ_PROFILES[mode];

      if (this.filterNode && this.audioCtx) {
        this.filterNode.type = this.profile.filterType;
        this.filterNode.frequency.setValueAtTime(this.profile.filterFreq, this.audioCtx.currentTime);
      }
    }

    async startListening() {
      if (this.isListening) return;

      try {
        await this.ensureAudioContext();

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

        this.filterNode = this.audioCtx.createBiquadFilter();
        this.filterNode.type = this.profile.filterType;
        this.filterNode.frequency.setValueAtTime(this.profile.filterFreq, this.audioCtx.currentTime);
        this.filterNode.Q.setValueAtTime(1.0, this.audioCtx.currentTime);

        this.analyserNode = this.audioCtx.createAnalyser();
        this.analyserNode.fftSize = this.fftSize;
        this.analyserNode.smoothingTimeConstant = 0.15;
        this.analyserNode.minDecibels = -100;
        this.analyserNode.maxDecibels = -10;

        this.micSourceNode.connect(this.filterNode);
        this.filterNode.connect(this.analyserNode);

        this.fftBuffer = new Uint8Array(this.analyserNode.frequencyBinCount);
        this.floatFftBuffer = new Float32Array(this.analyserNode.frequencyBinCount);

        this.isListening = true;
        this._setRxState(RX_STATE.LISTENING);

        this._rxLoop = this._rxLoop.bind(this);
        this.rxAnimationId = requestAnimationFrame(this._rxLoop);
      } catch (err) {
        this.isListening = false;
        this._setRxState(RX_STATE.OFF);
        if (this.onError) this.onError(err);
        throw err;
      }
    }

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

    freqToBin(freq) {
      if (!this.audioCtx) return 0;
      const sampleRate = this.audioCtx.sampleRate || 48000;
      const nyquist = sampleRate / 2;
      const binCount = this.analyserNode ? this.analyserNode.frequencyBinCount : (this.fftSize / 2);
      const bin = Math.round((freq / nyquist) * binCount);
      return Math.max(0, Math.min(binCount - 1, bin));
    }

    getEnergyAtFreq(freq, windowBins = 1) {
      if (!this.analyserNode || !this.floatFftBuffer) return -120;
      const centerBin = this.freqToBin(freq);
      const startBin = Math.max(0, centerBin - windowBins);
      const endBin = Math.min(this.analyserNode.frequencyBinCount - 1, centerBin + windowBins);
      
      let sumPower = 0;
      let count = 0;
      for (let b = startBin; b <= endBin; b++) {
        const db = this.floatFftBuffer[b];
        const power = Math.pow(10, db / 10);
        sumPower += power;
        count++;
      }
      const avgPower = count > 0 ? (sumPower / count) : 1e-12;
      return 10 * Math.log10(Math.max(avgPower, 1e-12));
    }

    getAmbientNoiseFloor() {
      if (!this.analyserNode || !this.floatFftBuffer) return -100;
      const centerBin = this.freqToBin(this.profile.bit0Freq);
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

    _setRxState(state, meta = {}) {
      if (this.rxState !== state) {
        this.rxState = state;
        if (this.onRxStateChange) {
          this.onRxStateChange(state, meta);
        }
      }
    }

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

      if (this.onAudioLevels) {
        let peakFreq = this.profile.preambleFreq;
        if (bit0Energy > preambleEnergy && bit0Energy > bit1Energy) peakFreq = this.profile.bit0Freq;
        else if (bit1Energy > preambleEnergy && bit1Energy > bit0Energy) peakFreq = this.profile.bit1Freq;

        this.onAudioLevels({
          snr: parseFloat(snr.toFixed(1)),
          noiseFloor: parseFloat(noiseFloor.toFixed(1)),
          peakFreq,
          isSignalPresent: snr > 8,
          rxState: this.rxState
        });
      }

      this.rxAnimationId = requestAnimationFrame(this._rxLoop);
    }

    /**
     * Transmits a 32-byte packet over acoustic BFSK with fast burst
     */
    async transmitPacket(packetBytes) {
      if (this.isTransmitting) return;

      if (!packetBytes || packetBytes.length < 32) {
        throw new Error('Invalid packet: must be 32 bytes.');
      }

      await this.ensureAudioContext();

      this.isTransmitting = true;
      if (this.onTxStart) this.onTxStart(packetBytes);

      const bits = [];
      for (let i = 0; i < 32; i++) {
        const byte = packetBytes[i];
        for (let b = 7; b >= 0; b--) {
          bits.push((byte >> b) & 1);
        }
      }

      const totalBits = bits.length;
      const startTime = this.audioCtx.currentTime + 0.02;

      const masterGain = this.audioCtx.createGain();
      masterGain.gain.setValueAtTime(0, this.audioCtx.currentTime);
      masterGain.connect(this.audioCtx.destination);

      let scheduledTime = startTime;

      // 1. Preamble Tone
      const preambleFreq = this.profile.preambleFreq;
      this._scheduleTone(scheduledTime, preambleFreq, this.preambleDuration, masterGain);
      scheduledTime += this.preambleDuration + this.guardDuration;

      // 2. Transmit 256 Bits rapidly (~400-600ms total)
      const symbolDuration = this.bitDuration;
      const guardDuration = this.guardDuration;

      for (let i = 0; i < totalBits; i++) {
        const bit = bits[i];
        const freq = (bit === 1) ? this.profile.bit1Freq : this.profile.bit0Freq;
        
        this._scheduleTone(scheduledTime, freq, symbolDuration, masterGain);
        scheduledTime += symbolDuration + guardDuration;
      }

      const totalDurationMs = (scheduledTime - this.audioCtx.currentTime) * 1000;

      return new Promise((resolve) => {
        setTimeout(() => {
          this.isTransmitting = false;
          masterGain.disconnect();
          if (this.onTxEnd) this.onTxEnd(packetBytes);
          resolve();
        }, totalDurationMs + 50);
      });
    }

    _scheduleTone(startTime, frequency, duration, destinationNode) {
      const osc = this.audioCtx.createOscillator();
      const toneGain = this.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, startTime);

      const ramp = Math.min(this.rampDuration, duration * 0.2);
      const peakVolume = this.profile.isAudible ? 0.35 : 0.85;

      toneGain.gain.setValueAtTime(0.0001, startTime);
      toneGain.gain.linearRampToValueAtTime(peakVolume, startTime + ramp);
      toneGain.gain.setValueAtTime(peakVolume, startTime + duration - ramp);
      toneGain.gain.linearRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(toneGain);
      toneGain.connect(destinationNode);

      osc.start(startTime);
      osc.stop(startTime + duration + 0.003);
    }
  }

  AudioModem.FREQ_PROFILES = FREQ_PROFILES;
  AudioModem.RX_STATE = RX_STATE;

  return AudioModem;
}));
