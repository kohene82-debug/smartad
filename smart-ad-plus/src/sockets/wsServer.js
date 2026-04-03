/**
 * WebSocket Server
 * Endpoint: ws://host/ws?token=<jwt>
 * Pushes BALANCE_UPDATE events in real-time to connected users.
 */

const { WebSocketServer, WebSocket } = require('ws');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

// Map: userId -> Set of ws connections
const userConnections = new Map();

let wss = null;

const initWebSocket = (server) => {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url  = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Missing token');
      return;
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      ws.close(4001, 'Invalid token');
      return;
    }

    if (decoded.type !== 'user') {
      ws.close(4003, 'Forbidden');
      return;
    }

    const userId = decoded.userId;
    ws.userId = userId;
    ws.isAlive = true;

    // Register connection
    if (!userConnections.has(userId)) {
      userConnections.set(userId, new Set());
    }
    userConnections.get(userId).add(ws);

    logger.info('WS client connected', { userId, totalClients: wss.clients.size });

    // Send welcome
    ws.send(JSON.stringify({ type: 'CONNECTED', userId, timestamp: new Date().toISOString() }));

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
      // Clients may send ping; respond
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG', timestamp: new Date().toISOString() }));
        }
      } catch { /* ignore malformed */ }
    });

    ws.on('close', () => {
      const conns = userConnections.get(userId);
      if (conns) {
        conns.delete(ws);
        if (conns.size === 0) userConnections.delete(userId);
      }
      logger.info('WS client disconnected', { userId });
    });

    ws.on('error', (err) => {
      logger.error('WS error', { userId, error: err.message });
    });
  });

  // Heartbeat: ping all clients every 30s, drop dead ones
  const heartbeat = setInterval(() => {
    try {
      wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
          logger.warn('WS client unresponsive — terminating', { userId: ws.userId });
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    } catch (err) {
      logger.error('WS heartbeat error', { error: err.message, stack: err.stack });
    }
  }, 30000);

  wss.on('close', () => clearInterval(heartbeat));

  wss.on('error', (err) => {
    logger.error('WebSocket server error', { error: err.message, stack: err.stack });
  });

  logger.info('WebSocket server initialized at /ws');
};

/**
 * Broadcast a message to all connections for a specific userId
 */
const broadcastToUser = (userId, payload) => {
  const conns = userConnections.get(userId);
  if (!conns || conns.size === 0) return;

  const message = JSON.stringify({ ...payload, timestamp: new Date().toISOString() });

  conns.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
};

/**
 * Broadcast to all connected clients (admin broadcasts, etc.)
 */
const broadcastAll = (payload) => {
  if (!wss) return;
  const message = JSON.stringify({ ...payload, timestamp: new Date().toISOString() });
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(message);
  });
};

const getStats = () => ({
  totalConnections: wss ? wss.clients.size : 0,
  uniqueUsers: userConnections.size,
});

module.exports = { initWebSocket, broadcastToUser, broadcastAll, getStats };
