/**
 * SilentBridge - 32-Byte Binary Protocol Engine
 * Handles binary packet creation, bit-packing, serialization, parsing, and TTL management.
 * Supports 6 Disaster Classifications and Bidirectional Rescue Acknowledgment (ACK) packets.
 * 
 * Schema (32 Bytes total):
 *  - Byte 0:       Sync Byte (0xAA for SOS, 0xAC for ACK)
 *  - Bytes 1-2:    Message ID / Target ACK ID (uint16)
 *  - Byte 3:       Distress Type (uint8: 1=Medical, 2=Trapped, 3=Fire, 4=Flood, 5=Earthquake, 6=Shelter, 15=ACK)
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
  const ACK_SYNC_BYTE = 0xAC;
  const PACKET_SIZE = 32;
  const MESSAGE_MAX_LEN = 17;
  const DEFAULT_TTL = 3;

  // 6 Standard Disaster & Emergency Classifications
  const DISTRESS_TYPES = {
    1: {
      id: 1,
      code: 'MEDICAL',
      name: 'Medical Emergency',
      shortName: 'Medical',
      icon: 'heart-pulse',
      color: '#EF4444',
      bgClass: 'bg-red-500/20 text-red-400 border-red-500/40',
      badgeClass: 'bg-red-600 text-white',
      priority: 'CRITICAL'
    },
    2: {
      id: 2,
      code: 'TRAPPED',
      name: 'Trapped / Collapse',
      shortName: 'Trapped',
      icon: 'shield-alert',
      color: '#F97316',
      bgClass: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
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
      bgClass: 'bg-rose-500/20 text-rose-400 border-rose-500/40',
      badgeClass: 'bg-rose-600 text-white',
      priority: 'CRITICAL'
    },
    4: {
      id: 4,
      code: 'FLOOD',
      name: 'Flood / Water Rising',
      shortName: 'Flood',
      icon: 'waves',
      color: '#3B82F6',
      bgClass: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
      badgeClass: 'bg-blue-600 text-white',
      priority: 'HIGH'
    },
    5: {
      id: 5,
      code: 'EARTHQUAKE',
      name: 'Earthquake / Landslide',
      shortName: 'Earthquake',
      icon: 'activity',
      color: '#EAB308',
      bgClass: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
      badgeClass: 'bg-amber-600 text-white',
      priority: 'HIGH'
    },
    6: {
      id: 6,
      code: 'SHELTER',
      name: 'Food / Water / Shelter',
      shortName: 'Supplies',
      icon: 'home',
      color: '#06B6D4',
      bgClass: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40',
      badgeClass: 'bg-cyan-600 text-white',
      priority: 'MEDIUM'
    },
    15: {
      id: 15,
      code: 'ACK',
      name: 'Rescue Acknowledgment',
      shortName: 'ACK Confirmed',
      icon: 'check-circle-2',
      color: '#10B981',
      bgClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
      badgeClass: 'bg-emerald-600 text-white',
      priority: 'CONFIRMATION'
    }
  };

  function generateMessageId() {
    return Math.floor(Math.random() * 65534) + 1;
  }

  function encodeString17(str) {
    const bytes = new Uint8Array(MESSAGE_MAX_LEN);
    if (!str) return bytes;
    const cleanStr = String(str).replace(/[^\x20-\x7E]/g, '?');
    for (let i = 0; i < MESSAGE_MAX_LEN && i < cleanStr.length; i++) {
      bytes[i] = cleanStr.charCodeAt(i) & 0xFF;
    }
    return bytes;
  }

  function decodeString17(uint8Array, offset = 13) {
    let result = '';
    for (let i = 0; i < MESSAGE_MAX_LEN; i++) {
      const charCode = uint8Array[offset + i];
      if (charCode === 0) break;
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
    ACK_SYNC_BYTE,
    PACKET_SIZE,
    MESSAGE_MAX_LEN,
    DEFAULT_TTL,
    DISTRESS_TYPES,

    generateMessageId,

    /**
     * Creates a standard 32-byte binary packet.
     */
    createPacket(options = {}) {
      const isAck = options.isAck === true;
      const distressType = isAck ? 15 : (parseInt(options.distressType, 10) || 1);
      const latitude = typeof options.latitude === 'number' ? options.latitude : parseFloat(options.latitude) || 0.0;
      const longitude = typeof options.longitude === 'number' ? options.longitude : parseFloat(options.longitude) || 0.0;
      const message = options.message || (isAck ? 'RESCUE EN ROUTE' : '');
      const ttl = options.ttl !== undefined ? (parseInt(options.ttl, 10) & 0xFF) : DEFAULT_TTL;
      const messageId = options.messageId !== undefined ? (parseInt(options.messageId, 10) & 0xFFFF) : generateMessageId();

      const buffer = new ArrayBuffer(PACKET_SIZE);
      const dataView = new DataView(buffer);
      const uint8 = new Uint8Array(buffer);

      // Byte 0: Sync Byte (0xAA or 0xAC for ACK)
      dataView.setUint8(0, isAck ? ACK_SYNC_BYTE : SYNC_BYTE);

      // Bytes 1-2: Message ID / Target ACK ID (uint16)
      dataView.setUint16(1, messageId, false);

      // Byte 3: Distress Type (uint8: 1-6 or 15 for ACK)
      dataView.setUint8(3, distressType);

      // Bytes 4-7: Latitude (float32, IEEE 754)
      dataView.setFloat32(4, latitude, false);

      // Bytes 8-11: Longitude (float32, IEEE 754)
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
     * Helper to create a dedicated ACK packet referencing a target Message ID.
     */
    createAckPacket(targetMessageId, customMessage = 'RESCUE EN ROUTE') {
      return this.createPacket({
        isAck: true,
        messageId: targetMessageId,
        distressType: 15,
        latitude: 0,
        longitude: 0,
        message: customMessage,
        ttl: 3
      });
    },

    /**
     * Parses a 32-byte packet and verifies its integrity.
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
      const isAck = (syncByte === ACK_SYNC_BYTE);
      const syncValid = (syncByte === SYNC_BYTE || syncByte === ACK_SYNC_BYTE);

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
        name: `Hazard #${distressType}`,
        shortName: 'Hazard',
        icon: 'alert-triangle',
        color: '#94A3B8',
        bgClass: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
        badgeClass: 'bg-slate-500 text-white',
        priority: 'LOW'
      };

      const valid = syncValid && crcValid;

      // Generate human timestamp
      const now = new Date();
      const timeString = now.toTimeString().split(' ')[0] + ' ' + now.toLocaleDateString();

      return {
        valid,
        syncValid,
        crcValid,
        isAck,
        syncByte,
        messageId,
        distressType,
        distressMeta,
        latitude: parseFloat(latitude.toFixed(6)),
        longitude: parseFloat(longitude.toFixed(6)),
        ttl,
        message,
        timeString,
        storedCrc,
        computedCrc,
        crcHex: '0x' + storedCrc.toString(16).toUpperCase().padStart(4, '0'),
        rawHex: this.toHex(uint8.subarray(0, PACKET_SIZE)),
        rawBytes: uint8.subarray(0, PACKET_SIZE),
        timestamp: Date.now()
      };
    },

    decrementTTL(packet) {
      if (!packet || packet.length < PACKET_SIZE) {
        throw new Error('Invalid packet buffer for TTL decrement');
      }

      const copy = new Uint8Array(packet.slice(0, PACKET_SIZE));
      const currentTtl = copy[12];
      const newTtl = Math.max(0, currentTtl - 1);
      copy[12] = newTtl;

      if (CRC16) {
        CRC16.stamp(copy);
      }

      return {
        packet: copy,
        newTtl,
        canRelay: newTtl > 0
      };
    },

    toHex(uint8Array, spacer = ' ') {
      if (!uint8Array) return '';
      return Array.from(uint8Array)
        .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
        .join(spacer);
    },

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
