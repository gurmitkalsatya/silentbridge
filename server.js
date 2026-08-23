/**
 * SilentBridge Backend Relay Server
 * Handles:
 *  - Static file hosting for Sender, Receiver, and Mesh portals.
 *  - REST API endpoint: POST /api/sos (Broadcast SOS with GPS, Audio & Google Maps link).
 *  - REST API endpoint: GET /api/sos (Fetch active incidents).
 *  - REST API endpoint: POST /api/ack (Relay rescue acknowledgment).
 *  - WebSocket Relay Server (/ws) for sub-millisecond multi-dispatcher broadcasting.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;

// In-Memory Incident Store
const activeIncidents = [];
const connectedClients = new Set();

// MIME Types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webm': 'audio/webm',
  '.wav': 'audio/wav'
};

// Create HTTP Server
const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // 1. REST API: POST /api/sos (Receive Broadcast SOS)
  if (pathname === '/api/sos' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const lat = payload.location?.lat || 37.774900;
        const lng = payload.location?.lng || -122.419400;
        const mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;

        const enrichedIncident = {
          incident_id: payload.session_id || `INC-${Date.now().toString(36).toUpperCase()}`,
          session_id: payload.session_id || `SES-${Date.now()}`,
          type: 'BROADCAST_SOS',
          distress_type: payload.distress_type || 1,
          message: payload.message || 'PANIC SOS: NEED RESCUE',
          location: {
            lat: lat,
            lng: lng,
            address: payload.location?.address || `GPS: ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
            accuracy: payload.location?.accuracy || 5.0
          },
          map_url: mapUrl,
          audio_base64: payload.audio_base64 || null,
          audio_duration: payload.audio_duration || 3.0,
          device_id: payload.device_id || `DEV-${Math.floor(Math.random() * 9000 + 1000)}`,
          timestamp: payload.timestamp || new Date().toISOString()
        };

        // Add to active store (keep last 100)
        activeIncidents.unshift(enrichedIncident);
        if (activeIncidents.length > 100) activeIncidents.pop();

        // Broadcast to all connected WebSocket dispatchers
        broadcastToWebSockets({
          type: 'BROADCAST_SOS',
          incident: enrichedIncident
        });

        console.log(`[SilentBridge Relay] 🚨 SOS Broadcast received: ${enrichedIncident.incident_id} at [${lat}, ${lng}]`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'success',
          message: 'SOS Broadcast received & relayed to all dispatchers',
          incident_id: enrichedIncident.incident_id,
          map_url: mapUrl,
          timestamp: enrichedIncident.timestamp
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // 2. REST API: GET /api/sos (Fetch recent incidents)
  if (pathname === '/api/sos' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'success',
      count: activeIncidents.length,
      incidents: activeIncidents
    }));
    return;
  }

  // 3. REST API: POST /api/ack (Relay ACK confirmation)
  if (pathname === '/api/ack' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const ackData = {
          type: 'ACK_BROADCAST',
          target_message_id: payload.target_message_id || payload.session_id,
          message: payload.message || 'RESCUE TEAM EN ROUTE',
          timestamp: new Date().toISOString()
        };

        broadcastToWebSockets(ackData);

        console.log(`[SilentBridge Relay] ✅ ACK Broadcast sent for incident: ${ackData.target_message_id}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', message: 'ACK relayed to survivor' }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // 4. Static File Server (with clean URL rewrites)
  let filePath = path.join(PUBLIC_DIR, pathname);
  if (pathname === '/' || pathname === '') {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  } else if (pathname === '/sender') {
    filePath = path.join(PUBLIC_DIR, 'sender.html');
  } else if (pathname === '/receiver' || pathname === '/rescuer') {
    filePath = path.join(PUBLIC_DIR, 'receiver.html');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, must-revalidate'
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

// Lightweight Built-In WebSocket Server Implementation (RFC 6455)
server.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  // Accept WebSocket Handshake
  const acceptKey = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`
  ];

  socket.write(headers.join('\r\n') + '\r\n\r\n');

  const client = { socket };
  connectedClients.add(client);
  console.log(`[SilentBridge WS] 🔌 Client connected. Total active: ${connectedClients.size}`);

  socket.on('data', buffer => {
    try {
      const parsed = decodeWebSocketFrame(buffer);
      if (parsed && parsed.payload) {
        const msg = JSON.parse(parsed.payload);
        
        if (msg.type === 'BROADCAST_SOS') {
          const lat = msg.location?.lat || 37.774900;
          const lng = msg.location?.lng || -122.419400;
          const mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;

          const enriched = {
            incident_id: msg.session_id || `INC-${Date.now().toString(36).toUpperCase()}`,
            session_id: msg.session_id || `SES-${Date.now()}`,
            type: 'BROADCAST_SOS',
            distress_type: msg.distress_type || 1,
            message: msg.message || 'PANIC SOS: NEED RESCUE',
            location: {
              lat: lat,
              lng: lng,
              address: msg.location?.address || `GPS: ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
              accuracy: msg.location?.accuracy || 5.0
            },
            map_url: mapUrl,
            audio_base64: msg.audio_base64 || null,
            audio_duration: msg.audio_duration || 3.0,
            device_id: msg.device_id || `DEV-${Math.floor(Math.random() * 9000 + 1000)}`,
            timestamp: msg.timestamp || new Date().toISOString()
          };

          activeIncidents.unshift(enriched);
          if (activeIncidents.length > 100) activeIncidents.pop();

          broadcastToWebSockets({
            type: 'BROADCAST_SOS',
            incident: enriched
          });
        } else if (msg.type === 'ACK_BROADCAST') {
          broadcastToWebSockets(msg);
        }
      }
    } catch (e) {}
  });

  socket.on('close', () => {
    connectedClients.delete(client);
    console.log(`[SilentBridge WS] ❌ Client disconnected. Remaining: ${connectedClients.size}`);
  });

  socket.on('error', () => {
    connectedClients.delete(client);
  });
});

function broadcastToWebSockets(data) {
  const jsonStr = JSON.stringify(data);
  const frame = encodeWebSocketFrame(jsonStr);

  connectedClients.forEach(client => {
    try {
      if (client.socket && client.socket.writable) {
        client.socket.write(frame);
      }
    } catch (e) {
      connectedClients.delete(client);
    }
  });
}

function decodeWebSocketFrame(buffer) {
  if (buffer.length < 2) return null;
  const isMasked = (buffer[1] & 0x80) === 0x80;
  let length = buffer[1] & 0x7f;
  let offset = 2;

  if (length === 126) {
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  let mask = null;
  if (isMasked) {
    mask = buffer.slice(offset, offset + 4);
    offset += 4;
  }

  const payload = buffer.slice(offset, offset + length);
  if (isMasked && mask) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= mask[i % 4];
    }
  }

  return { payload: payload.toString('utf8') };
}

function encodeWebSocketFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const length = payload.length;
  let header;

  if (length <= 125) {
    header = Buffer.from([0x81, length]);
  } else if (length <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚨 SilentBridge Emergency Relay Server is running!`);
  console.log(`🌐 Local Portal:   http://localhost:${PORT}`);
  console.log(`📱 Sender Client:  http://localhost:${PORT}/sender`);
  console.log(`🛡️ Rescue Console: http://localhost:${PORT}/receiver`);
  console.log(`⚡ WebSocket URL:  ws://localhost:${PORT}/ws`);
  console.log(`📡 REST API:       POST /api/sos | GET /api/sos | POST /api/ack`);
  console.log(`======================================================\n`);
});
