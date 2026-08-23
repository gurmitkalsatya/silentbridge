// Vercel Serverless Function: /api/ack
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
      const ackData = {
        type: 'ACK_BROADCAST',
        target_message_id: payload.target_message_id || payload.session_id,
        message: payload.message || 'RESCUE TEAM EN ROUTE',
        timestamp: new Date().toISOString()
      };

      res.status(200).json({
        status: 'success',
        message: 'ACK confirmation processed',
        target_message_id: ackData.target_message_id,
        timestamp: ackData.timestamp
      });
    } catch (err) {
      res.status(400).json({ status: 'error', message: 'Invalid payload' });
    }
    return;
  }

  res.status(405).json({ status: 'error', message: 'Method Not Allowed' });
};
