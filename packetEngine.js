/**
 * SilentBridge - 32-Byte Binary Protocol Engine
 * Handles binary packet creation, bit-packing, serialization, parsing, and TTL management.
 * 
 * Schema (32 Bytes total):
 *  - Byte 0:       Sync Byte (0xAA)
 *  - Bytes 1-2:    Message ID (uint16)
 *  - Byte 3:       Distress Type (uint8: 1=Medical, 2=Trapped, 3=Fire, 4=Shelter)
 *  - Bytes 4-7:    Latitude (float32, IEEE 754)
 *  - Bytes 8-11:   Longitude (float32, IEEE 754)
 *  - Byte 12:      TTL / Hops Left (uint8)
 *  - Bytes 13-29:  Short Message (17 Bytes ASCII, zero-padded)
 *  - Bytes 30-31:  CRC-16 Checksum (uint16 over bytes 0-29)
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./crc16'], factory);
  } else if (typeof module === 'object' && module.exports) {
    const CRC16 = require('./crc16');
    module.exports = factory(CRC16);
  } else {
    root.PacketEngine = factory(root.CRC16);
  }
}(typeof self !== 'undefined' ? self : this, function (CRC16) {
  'use strict';

  const SYNC_BYTE = 0xAA;
  const PACKET_SIZE = 32;
  const MESSAGE_MAX_LEN = 17;
  const DEFAULT_TTL = 3;

  const DISTRESS_TYPES = {
    1: {
      id: 1,
      code: 'MEDICAL',
      name: 'Medical Emergency',
      shortName: 'Medical',
      icon: 'heart-pulse',
      color: '#EF4444',
      bgClass: 'bg-red-500/20 text-red-400 border-red-500/30',
      badgeClass: 'bg-red-500 text-white',
      priority: 'CRITICAL'
    },
    2: {
      id: 2,
      code: 'TRAPPED',
      name: 'Trapped / Structural Collapse',
      shortName: 'Trapped',
      icon: 'shield-alert',
      color: '#F97316',
      bgClass: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      badgeClass: 'bg-orange-500 text-white',
      priority: 'HIGH'
    },
    3: {
      id: 3,
      code: 'FIRE',
      name: 'Fire / Chemical Hazard',
      shortName: 'Fire/Hazard',
      icon: 'flame',
      color: '#DC2626',
      bgClass: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
      badgeClass: 'bg-rose-600 text-white',
      priority: 'CRITICAL'
    },
    4: {
      id: 4,
      code: 'SHELTER',
      name: 'Shelter / Food / Water Needed',
      shortName: 'Shelter/Food',
      icon: 'home',
      color: '#06B6D4',
      bgClass: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
      badgeClass: 'bg-cyan-500 text-white',
      priority: 'MEDIUM'
    }
  };

  /**
   * Generates a random 16-bit Message ID (1 to 65535)
   */
  function generateMessageId() {
    return Math.floor(Math.random() * 65534) + 1;
  }

  /**
   * Truncates and converts a string into a 17-byte ASCII Array
   */
  function encodeString17(str) {
    const bytes = new Uint8Array(MESSAGE_MAX_LEN);
    if (!str) return bytes;
    
    // Convert to ASCII, replace non-ASCII characters with safe approximations
    const cleanStr = String(str).replace(/[^\x20-\x7E]/g, '?');
    for (let i = 0; i < MESSAGE_MAX_LEN && i < cleanStr.length; i++) {
      bytes[i] = cleanStr.charCodeAt(i) & 0xFF;
    }
    return bytes;
  }

  /**
   * Decodes a 17-byte buffer into an ASCII string, trimming zero-padding
   */
  function decodeString17(uint8Array, offset = 13) {
    let result = '';
    for (let i = 0; i < MESSAGE_MAX_LEN; i++) {
      const charCode = uint8Array[offset + i];
      if (charCode === 0) break; // Null terminator
      if (charCode >= 32 && charCode <= 126) {
        result += String.fromCharCode(charCode);
      } else {
        result += ' ';
      }
    }
    return result.trim();
  }

  const PacketEngine = {
    SYNC_BYTE,
    PACKET_SIZE,
    MESSAGE_MAX_LEN,
    DEFAULT_TTL,
    DISTRESS_TYPES,

    generateMessageId,

    /**
     * Creates a standard 32-byte binary packet.
     * 
     * @param {Object} options
     * @param {number} [options.distressType=1] - 1: Medical, 2: Trapped, 3: Fire, 4: Shelter
     * @param {number} [options.latitude=0.0] - Latitude coordinate (-90 to 90)
     * @param {number} [options.longitude=0.0] - Longitude coordinate (-180 to 180)
     * @param {string} [options.message=''] - Max 17 ASCII chars
     * @param {number} [options.ttl=3] - Initial hops (0 to 255)
     * @param {number} [options.messageId] - Optional 16-bit ID (auto-generated if omitted)
     * @returns {Uint8Array} 32-byte packed binary packet
     */
    createPacket(options = {}) {
      const distressType = parseInt(options.distressType, 10) || 1;
      const latitude = typeof options.latitude === 'number' ? options.latitude : parseFloat(options.latitude) || 0.0;
      const longitude = typeof options.longitude === 'number' ? options.longitude : parseFloat(options.longitude) || 0.0;
      const message = options.message || '';
      const ttl = options.ttl !== undefined ? (parseInt(options.ttl, 10) & 0xFF) : DEFAULT_TTL;
      const messageId = options.messageId !== undefined ? (parseInt(options.messageId, 10) & 0xFFFF) : generateMessageId();

      const buffer = new ArrayBuffer(PACKET_SIZE);
      const dataView = new DataView(buffer);
      const uint8 = new Uint8Array(buffer);

      // Byte 0: Sync Byte
      dataView.setUint8(0, SYNC_BYTE);

      // Bytes 1-2: Message ID (uint16, big-endian)
      dataView.setUint16(1, messageId, false);

      // Byte 3: Distress Type (uint8)
      dataView.setUint8(3, Math.max(1, Math.min(4, distressType)));

      // Bytes 4-7: Latitude (float32, IEEE 754, big-endian)
      dataView.setFloat32(4, latitude, false);

      // Bytes 8-11: Longitude (float32, IEEE 754, big-endian)
      dataView.setFloat32(8, longitude, false);

      // Byte 12: TTL / Hops Left (uint8)
      dataView.setUint8(12, ttl);

      // Bytes 13-29: Message (17 Bytes ASCII zero-padded)
      const msgBytes = encodeString17(message);
      uint8.set(msgBytes, 13);

      // Bytes 30-31: CRC-16 (uint16 over bytes 0-29)
      const crc = CRC16 ? CRC16.compute(uint8, 0, 30) : 0;
      dataView.setUint16(30, crc, false);

      return uint8;
    },

    /**
     * Parses a 32-byte packet and verifies its integrity.
     * 
     * @param {Uint8Array|ArrayBuffer} rawData 
     * @returns {Object} Parsed packet details
     */
    parsePacket(rawData) {
      if (!rawData) {
        return { valid: false, error: 'Empty buffer' };
      }

      let uint8;
      if (rawData instanceof ArrayBuffer) {
        uint8 = new Uint8Array(rawData);
      } else if (rawData instanceof Uint8Array) {
        uint8 = rawData;
      } else if (Array.isArray(rawData)) {
        uint8 = new Uint8Array(rawData);
      } else {
        return { valid: false, error: 'Invalid buffer type' };
      }

      if (uint8.length < PACKET_SIZE) {
        return { valid: false, error: `Packet truncated: got ${uint8.length} bytes, expected ${PACKET_SIZE}` };
      }

      const buffer = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + PACKET_SIZE);
      const dataView = new DataView(buffer);

      const syncByte = dataView.getUint8(0);
      const syncValid = (syncByte === SYNC_BYTE);

      const messageId = dataView.getUint16(1, false);
      const distressType = dataView.getUint8(3);
      const latitude = dataView.getFloat32(4, false);
      const longitude = dataView.getFloat32(8, false);
      const ttl = dataView.getUint8(12);
      const message = decodeString17(uint8, 13);

      const storedCrc = dataView.getUint16(30, false);
      const computedCrc = CRC16 ? CRC16.compute(uint8, 0, 30) : 0;
      const crcValid = (storedCrc === computedCrc);

      const distressMeta = DISTRESS_TYPES[distressType] || {
        id: distressType,
        code: 'UNKNOWN',
        name: `Unknown Hazard (#${distressType})`,
        shortName: 'Unknown',
        icon: 'alert-triangle',
        color: '#94A3B8',
        bgClass: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
        badgeClass: 'bg-slate-500 text-white',
        priority: 'LOW'
      };

      const valid = syncValid && crcValid;

      return {
        valid,
        syncValid,
        crcValid,
        syncByte,
        messageId,
        distressType,
        distressMeta,
        latitude: parseFloat(latitude.toFixed(6)),
        longitude: parseFloat(longitude.toFixed(6)),
        ttl,
        message,
        storedCrc,
        computedCrc,
        crcHex: '0x' + storedCrc.toString(16).toUpperCase().padStart(4, '0'),
        rawHex: this.toHex(uint8.subarray(0, PACKET_SIZE)),
        rawBytes: uint8.subarray(0, PACKET_SIZE),
        timestamp: Date.now()
      };
    },

    /**
     * Decrements the TTL of an existing packet by 1 and re-stamps the CRC-16.
     * Returns true if packet is eligible for further relay (new TTL > 0).
     * 
     * @param {Uint8Array} packet - 32-byte packet
     * @returns {{ packet: Uint8Array, newTtl: number, canRelay: boolean }}
     */
    decrementTTL(packet) {
      if (!packet || packet.length < PACKET_SIZE) {
        throw new Error('Invalid packet buffer for TTL decrement');
      }

      const copy = new Uint8Array(packet.slice(0, PACKET_SIZE));
      const currentTtl = copy[12];
      const newTtl = Math.max(0, currentTtl - 1);

      copy[12] = newTtl;

      // Re-calculate and stamp CRC-16 over bytes 0-29
      if (CRC16) {
        CRC16.stamp(copy);
      }

      return {
        packet: copy,
        newTtl,
        canRelay: newTtl > 0
      };
    },

    /**
     * Converts a Uint8Array or byte buffer into a formatted hex string.
     */
    toHex(uint8Array, spacer = ' ') {
      if (!uint8Array) return '';
      return Array.from(uint8Array)
        .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
        .join(spacer);
    },

    /**
     * Parses a hex string into a Uint8Array.
     */
    fromHex(hexStr) {
      if (!hexStr) return new Uint8Array(0);
      const cleanHex = hexStr.replace(/[^0-9A-Fa-f]/g, '');
      const bytes = new Uint8Array(cleanHex.length / 2);
      for (let i = 0; i < cleanHex.length; i += 2) {
        bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
      }
      return bytes;
    }
  };

  return PacketEngine;
}));
