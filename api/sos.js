// Vercel Serverless Function: /api/sos
const activeIncidents = [];

module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method === 'POST') {
    try {
      const payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const lat = payload.location?.lat || payload.latitude || 37.774900;
      const lng = payload.location?.lng || payload.longitude || -122.419400;
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
        audio_duration: payload.audio_duration || 3.5,
        device_id: payload.device_id || `DEV-${Math.floor(Math.random() * 9000 + 1000)}`,
        timestamp: payload.timestamp || new Date().toISOString()
      };

      activeIncidents.unshift(enrichedIncident);
      if (activeIncidents.length > 50) activeIncidents.pop();

      res.status(200).json({
        status: 'success',
        message: 'SOS Broadcast received & relayed',
        incident_id: enrichedIncident.incident_id,
        map_url: mapUrl,
        timestamp: enrichedIncident.timestamp
      });
    } catch (err) {
      res.status(400).json({ status: 'error', message: 'Invalid payload' });
    }
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({
      status: 'success',
      count: activeIncidents.length,
      incidents: activeIncidents
    });
    return;
  }

  res.status(405).json({ status: 'error', message: 'Method Not Allowed' });
};
