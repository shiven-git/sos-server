// ================================================================
// VORTEX SOS SERVER - LIGHTWEIGHT PRODUCTION VERSION
// ================================================================
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 3000;

// ================================================================
// DATA STORAGE (Memory - Use Redis/DB for production scaling)
// ================================================================
let geofences = [];
let connectedClients = new Map();
let sosAlerts = [];
let processedSOSIds = new Set();

// Clean up old data periodically
setInterval(() => {
  if (sosAlerts.length > 50) sosAlerts = sosAlerts.slice(0, 50);
  if (processedSOSIds.size > 500) {
    const ids = Array.from(processedSOSIds);
    processedSOSIds = new Set(ids.slice(-250));
  }
}, 600000); // Every 10 minutes

// ================================================================
// SOCKET HANDLERS
// ================================================================
io.on('connection', (socket) => {
  connectedClients.set(socket.id, {
    id: socket.id,
    type: 'unknown',
    connectedAt: Date.now()
  });

  // Send existing geofences to new clients
  if (geofences.length > 0) {
    socket.emit('allGeofences', geofences);
  }

  // ==================== SOS HANDLER (FIXED & OPTIMIZED) ====================
  socket.on('sos', (data) => {
    console.log('🆘 SOS:', data.sosId, 'from', socket.id);

    // Prevent duplicates
    if (data.sosId && processedSOSIds.has(data.sosId)) {
      console.log('🚫 Duplicate SOS ignored');
      return;
    }

    if (data.sosId) processedSOSIds.add(data.sosId);

    const alert = {
      ...data,
      id: data.sosId || Date.now(),
      receivedAt: new Date().toISOString(),
      sender: socket.id
    };

    sosAlerts.unshift(alert);

    // Broadcast only to monitoring clients (not back to sender)
    let broadcasts = 0;
    connectedClients.forEach((client, clientId) => {
      if (clientId !== socket.id && (client.type === 'web' || client.type === 'admin')) {
        io.to(clientId).emit('sosAlert', alert);
        broadcasts++;
      }
    });

    // Confirm to sender
    socket.emit('sosConfirmation', {
      success: true,
      sosId: data.sosId,
      broadcasts: broadcasts
    });

    console.log('✅ SOS processed, broadcasted to', broadcasts, 'clients');
  });

  // ==================== GEOFENCE HANDLERS ====================
  socket.on('createGeofence', (data) => {
    if (!data?.id || !data?.name) {
      socket.emit('error', { message: 'Invalid geofence data' });
      return;
    }

    const geofence = {
      id: data.id,
      name: data.name,
      type: data.type || 'MONITORING',
      active: data.active !== false,
      points: data.points || [],
      center: data.center,
      radius: data.radius,
      shapeType: data.shapeType || 'polygon',
      alertOnEntry: data.alertOnEntry !== false,
      alertOnExit: data.alertOnExit || false,
      createdAt: new Date().toISOString()
    };

    geofences.push(geofence);
    socket.broadcast.emit('updateGeofence', geofence);
    socket.emit('geofenceCreated', { success: true, geofence });

    console.log('📍 Geofence created:', data.name);
  });

  socket.on('updateGeofence', (data) => {
    const index = geofences.findIndex(g => g.id === data.id);
    if (index !== -1) {
      geofences[index] = { ...geofences[index], ...data, updatedAt: new Date().toISOString() };
      io.emit('updateGeofence', geofences[index]);
    }
  });

  socket.on('deleteGeofence', (data) => {
    geofences = geofences.filter(g => g.id !== data.id);
    io.emit('deleteGeofence', data);
  });

  // ==================== CLIENT MANAGEMENT ====================
  socket.on('identify', (data) => {
    const client = connectedClients.get(socket.id);
    if (client) {
      connectedClients.set(socket.id, {
        ...client,
        type: data.type || 'unknown',
        name: data.name || 'Unknown',
        platform: data.platform || 'unknown'
      });

      if (data.type === 'mobile' && geofences.length > 0) {
        socket.emit('allGeofences', geofences);
      }
    }
  });

  socket.on('getGeofences', () => {
    socket.emit('allGeofences', geofences);
  });

  socket.on('geofenceViolation', (data) => {
    const violation = {
      ...data,
      id: Date.now(),
      receivedAt: new Date().toISOString()
    };

    // Send only to admin clients
    connectedClients.forEach((client, clientId) => {
      if (client.type === 'web' || client.type === 'admin') {
        io.to(clientId).emit('geofenceViolation', violation);
      }
    });
  });

  socket.on('disconnect', () => {
    connectedClients.delete(socket.id);
  });
});

// ================================================================
// API ENDPOINTS (Essential only)
// ================================================================
app.get('/', (req, res) => {
  res.json({
    name: 'Vortex SOS Server',
    version: '2.1-LIGHT',
    status: 'running',
    clients: connectedClients.size,
    geofences: geofences.length,
    alerts: sosAlerts.length
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: Math.floor(process.uptime()),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    clients: connectedClients.size
  });
});

app.get('/api/geofences', (req, res) => {
  res.json({
    success: true,
    count: geofences.length,
    geofences: geofences
  });
});

app.get('/api/alerts', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json({
    success: true,
    count: sosAlerts.length,
    alerts: sosAlerts.slice(0, limit)
  });
});

// ================================================================
// SERVER START
// ================================================================
server.listen(PORT, () => {
  console.log('🚀 Vortex SOS Server v2.1-LIGHT');
  console.log('🚀 Port:', PORT);
  console.log('🚀 Memory limit: Optimized for production');
  console.log('✅ Ready for connections');
});

// ================================================================
// ERROR HANDLING
// ================================================================
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection:', reason);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
