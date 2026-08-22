/**
 * SilentBridge - Standalone CCITT CRC-16 Integrity Checker
 * Polynomial: 0x1021 (x^16 + x^12 + x^5 + 1)
 * Initial Value: 0xFFFF
 * Standard: CCITT / X.25 / HDLC
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CRC16 = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const POLYNOMIAL = 0x1021;
  const INITIAL_VALUE = 0xFFFF;

  // Precomputed 256-entry lookup table for CCITT CRC-16
  const CRC_TABLE = new Uint16Array(256);

  for (let i = 0; i < 256; i++) {
    let curr = (i << 8) & 0xFFFF;
    for (let j = 0; j < 8; j++) {
      if ((curr & 0x8000) !== 0) {
        curr = ((curr << 1) ^ POLYNOMIAL) & 0xFFFF;
      } else {
        curr = (curr << 1) & 0xFFFF;
      }
    }
    CRC_TABLE[i] = curr;
  }

  const CRC16 = {
    POLYNOMIAL,
    INITIAL_VALUE,
    TABLE: CRC_TABLE,

    /**
     * Computes the 16-bit CCITT CRC checksum for a given Uint8Array or byte array.
     * @param {Uint8Array|Array<number>} data - The input byte buffer
     * @param {number} [offset=0] - Starting offset in the buffer
     * @param {number} [length] - Number of bytes to process (defaults to data.length - offset)
     * @returns {number} 16-bit unsigned integer checksum
     */
    compute(data, offset = 0, length = undefined) {
      if (!data || data.length === 0) return 0;
      
      const len = length !== undefined ? length : (data.length - offset);
      const end = Math.min(offset + len, data.length);
      
      let crc = INITIAL_VALUE;
      for (let i = offset; i < end; i++) {
        const byte = data[i] & 0xFF;
        const tableIndex = ((crc >> 8) ^ byte) & 0xFF;
        crc = ((crc << 8) ^ CRC_TABLE[tableIndex]) & 0xFFFF;
      }

      return crc;
    },

    /**
     * Verifies the CRC-16 checksum embedded at the last 2 bytes of a 32-byte packet.
     * @param {Uint8Array} packet - 32-byte packet
     * @returns {boolean} True if calculated CRC matches the packet's stored CRC
     */
    verify(packet) {
      if (!packet || packet.length < 32) return false;
      
      const payloadLength = 30; // Bytes 0 to 29
      const calculatedCrc = this.compute(packet, 0, payloadLength);
      const storedCrc = ((packet[30] & 0xFF) << 8) | (packet[31] & 0xFF);

      return calculatedCrc === storedCrc;
    },

    /**
     * Appends or writes the 16-bit CRC to the last 2 bytes of a 32-byte packet buffer.
     * @param {Uint8Array} packet - 32-byte packet buffer
     * @returns {Uint8Array} The modified packet buffer
     */
    stamp(packet) {
      if (!packet || packet.length < 32) {
        throw new Error('Packet buffer must be at least 32 bytes to stamp CRC.');
      }
      const crc = this.compute(packet, 0, 30);
      packet[30] = (crc >> 8) & 0xFF;
      packet[31] = crc & 0xFF;
      return packet;
    }
  };

  return CRC16;
}));
