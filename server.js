// ================================================================
// VORTEX SOS SERVER - Complete Enhanced Version
// ================================================================
// Features:
// - SOS Emergency Alert System
// - Advanced Geofencing Management
// - Real-time Socket.IO Communication
// - RESTful API Endpoints
// - Multi-client Support (Web Admin, Mobile Apps)
// ================================================================

// 1. Import necessary libraries
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

// 2. Setup the Express App and HTTP Server
const app = express();
const server = http.createServer(app);

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// 3. Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*", // Allow connections from any origin
    methods: ["GET", "POST"]
  }
});

// 4. Define the Port
const PORT = process.env.PORT || 3000;

// ================================================================
// DATA STORAGE (In-memory - Use database in production)
// ================================================================
let geofences = []; // Array to store multiple geofences
let connectedClients = new Map(); // Track connected clients
let sosAlerts = []; // Store recent SOS alerts

// ================================================================
// SOCKET.IO CONNECTION HANDLER
// ================================================================
io.on('connection', (socket) => {
  console.log('✅ A user connected. Socket ID:', socket.id);

  // Store client information
  connectedClients.set(socket.id, {
    id: socket.id,
    type: 'unknown', // 'web', 'mobile', etc.
    connectedAt: new Date().toISOString()
  });

  // Send all existing geofences to newly connected client
  if (geofences.length > 0) {
    geofences.forEach(geofence => {
      socket.emit('updateGeofence', geofence);
    });
    console.log(📍 Sent ${geofences.length} existing geofences to new user:, socket.id);
  }

  // ==================== SOS EMERGENCY SYSTEM ====================

  // Listen for the "sos" event from a connected client
  socket.on('sos', (data) => {
    console.log('-------------------------');
    console.log('🆘 SOS EMERGENCY RECEIVED!');
    console.log('User:', data.user || 'Unknown User');
    console.log('Location:', data.lat, data.lon);
    console.log('Message:', data.message || 'Emergency assistance needed');
    console.log('Time:', new Date().toLocaleString());
    console.log('-------------------------');

    // Add timestamp and ID for better tracking
    const alertData = {
      ...data,
      id: Date.now() + Math.random(),
      timestamp: data.timestamp || new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      user: data.user || 'Unknown User',
      message: data.message || 'Emergency assistance needed'
    };

    // Store alert (keep last 100 alerts)
    sosAlerts.unshift(alertData);
    if (sosAlerts.length > 100) {
      sosAlerts = sosAlerts.slice(0, 100);
    }

    // Broadcast SOS to all connected clients (including dashboards)
    io.emit('sosAlert', alertData);
    io.emit('emergency', alertData);
    io.emit('alert', alertData);
    io.emit('sos', alertData); // Also emit with original event name

    console.log('📢 SOS Alert broadcasted to', connectedClients.size, 'connected clients');
  });

  // ==================== LEGACY GEOFENCE SUPPORT ====================

  // Keep original setGeofence for backward compatibility
  socket.on('setGeofence', (geofenceData) => {
    console.log('-------------------------');
    console.log('🗺 LEGACY GEOFENCE UPDATED/SET');
    console.log('Name:', geofenceData.name || 'Unnamed Geofence');
    console.log('Points:', geofenceData.points?.length || 0);
    console.log('-------------------------');

    // Convert to new format and store
    const newGeofence = {
      id: geofenceData.id || 'legacy-' + Date.now().toString(),
      name: geofenceData.name || 'Legacy Geofence',
      type: geofenceData.type || 'MONITORING',
      priority: geofenceData.priority || 'medium',
      active: geofenceData.active !== false,
      points: geofenceData.points || [],
      center: geofenceData.center || null,
      radius: geofenceData.radius || null,
      shapeType: geofenceData.shapeType || (geofenceData.center ? 'circle' : 'polygon'),
      alertOnEntry: geofenceData.alertOnEntry !== false,
      alertOnExit: geofenceData.alertOnExit || false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Replace or add geofence
    const existingIndex = geofences.findIndex(g => g.id === newGeofence.id);
    if (existingIndex !== -1) {
      geofences[existingIndex] = newGeofence;
      console.log('🔄 Updated existing legacy geofence');
    } else {
      geofences.push(newGeofence);
      console.log('➕ Added new legacy geofence');
    }

    // Broadcast to all clients
    io.emit('updateGeofence', newGeofence);
    console.log('📢 Legacy geofence broadcasted to all clients');
  });

  // ==================== ENHANCED GEOFENCE SYSTEM ====================

  // Handle geofence creation from web admin
  socket.on('createGeofence', (geofenceData) => {
    console.log('-------------------------');
    console.log('📍 CREATE GEOFENCE - Web Admin');
    console.log('Name:', geofenceData.name);
    console.log('Type:', geofenceData.type);
    console.log('Priority:', geofenceData.priority);
    console.log('Shape:', geofenceData.shapeType || geofenceData.type);
    console.log('Active:', geofenceData.active);
    console.log('-------------------------');

    // Validate geofence data
    if (!geofenceData || !geofenceData.name || !geofenceData.id) {
      console.error('❌ Invalid geofence data received');
      socket.emit('error', { message: 'Invalid geofence data - missing name or id' });
      return;
    }

    // Create properly structured geofence
    const newGeofence = {
      id: geofenceData.id,
      name: geofenceData.name,
      type: geofenceData.type || 'MONITORING',
      priority: geofenceData.priority || 'medium',
      active: geofenceData.active !== false,
      alertOnEntry: geofenceData.alertOnEntry !== false,
      alertOnExit: geofenceData.alertOnExit || false,
      shapeType: geofenceData.shapeType || geofenceData.type || 'polygon',
      points: geofenceData.points || [],
      center: geofenceData.center || null,
      radius: geofenceData.radius || null,
      createdAt: geofenceData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Store geofence
    geofences.push(newGeofence);
    console.log('✅ Geofence created successfully. Total geofences:', geofences.length);

    // Broadcast to all connected clients
    socket.broadcast.emit('updateGeofence', newGeofence);

    // Send to specific mobile clients
    connectedClients.forEach((client, clientId) => {
      if (client.type === 'mobile' || clientId !== socket.id) {
        io.to(clientId).emit('updateGeofence', newGeofence);
      }
    });

    // Send confirmation back to creator
    socket.emit('geofenceCreated', { 
      success: true, 
      geofence: newGeofence,
      message: Geofence "${newGeofence.name}" created successfully
    });

    console.log('📢 New geofence broadcasted to', connectedClients.size - 1, 'other clients');
  });

  // Handle geofence updates from web admin
  socket.on('updateGeofence', (geofenceData) => {
    console.log('-------------------------');
    console.log('📍 UPDATE GEOFENCE - Web Admin');
    console.log('ID:', geofenceData.id);
    console.log('Name:', geofenceData.name);
    console.log('Active:', geofenceData.active);
    console.log('-------------------------');

    if (!geofenceData || !geofenceData.id) {
      console.error('❌ Invalid geofence update data - missing id');
      socket.emit('error', { message: 'Invalid geofence update data - missing id' });
      return;
    }

    // Find and update geofence
    const index = geofences.findIndex(g => g.id === geofenceData.id);
    if (index !== -1) {
      geofences[index] = {
        ...geofences[index],
        ...geofenceData,
        updatedAt: new Date().toISOString()
      };

      console.log('✅ Geofence updated successfully:', geofenceData.name);

      // Broadcast update to all clients
      io.emit('updateGeofence', geofences[index]);

      console.log('📢 Geofence update broadcasted to all clients');
    } else {
      console.warn('⚠ Geofence not found for update, creating new one:', geofenceData.id);

      // If not found, create it as new geofence
      const newGeofence = {
        ...geofenceData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      geofences.push(newGeofence);
      io.emit('updateGeofence', newGeofence);

      console.log('✅ Created new geofence from update request');
    }
  });

  // Handle geofence deletion from web admin
  socket.on('deleteGeofence', (data) => {
    console.log('-------------------------');
    console.log('📍 DELETE GEOFENCE - Web Admin');
    console.log('ID:', data.id);
    console.log('-------------------------');

    if (!data || !data.id) {
      console.error('❌ Invalid geofence delete data - missing id');
      socket.emit('error', { message: 'Invalid geofence delete data - missing id' });
      return;
    }

    // Find geofence to delete
    const geofenceToDelete = geofences.find(g => g.id === data.id);
    const geofenceName = geofenceToDelete?.name || 'Unknown';

    // Remove geofence
    const initialLength = geofences.length;
    geofences = geofences.filter(g => g.id !== data.id);

    if (geofences.length < initialLength) {
      console.log('✅ Geofence deleted successfully:', geofenceName);

      // Broadcast deletion to all clients
      io.emit('deleteGeofence', data);

      console.log('📢 Geofence deletion broadcasted to all clients');
      console.log('📊 Remaining geofences:', geofences.length);
    } else {
      console.warn('⚠ Geofence not found for deletion:', data.id);
      socket.emit('error', { message: Geofence with id ${data.id} not found });
    }
  });

  // ==================== CLIENT MANAGEMENT ====================

  // Handle client identification (for Flutter apps, web admin, etc.)
  socket.on('identify', (data) => {
    console.log('-------------------------');
    console.log('🏷 CLIENT IDENTIFICATION');
    console.log('Type:', data.type || 'unknown');
    console.log('Name:', data.name || 'unknown');
    console.log('Platform:', data.platform || 'unknown');
    console.log('Socket ID:', socket.id);
    console.log('-------------------------');

    if (connectedClients.has(socket.id)) {
      connectedClients.set(socket.id, {
        ...connectedClients.get(socket.id),
        type: data.type || 'unknown',
        name: data.name || 'Unknown Client',
        platform: data.platform || 'unknown',
        userAgent: data.userAgent || 'unknown',
        ...data
      });

      // Send all existing geofences to new mobile client
      if (data.type === 'mobile' && geofences.length > 0) {
        console.log('📱 Sending all geofences to new mobile client...');

        // Send geofences one by one
        geofences.forEach((geofence, index) => {
          setTimeout(() => {
            socket.emit('updateGeofence', geofence);
          }, index * 100); // Small delay between each geofence
        });

        console.log(📍 Queued ${geofences.length} geofences for mobile client);

        // Also send via bulk method
        setTimeout(() => {
          socket.emit('allGeofences', geofences);
        }, geofences.length * 100 + 500);
      }

      console.log('✅ Client identified and configured');
    }
  });

  // ==================== GEOFENCE VIOLATIONS ====================

  // Handle geofence violations from mobile clients
  socket.on('geofenceViolation', (violationData) => {
    console.log('-------------------------');
    console.log('⚠ GEOFENCE VIOLATION DETECTED');
    console.log('User:', violationData.user || 'Unknown User');
    console.log('Action:', violationData.action || 'unknown action');
    console.log('Geofence:', violationData.geofenceName || 'Unknown Geofence');
    console.log('Location:', violationData.lat, violationData.lng || violationData.lon);
    console.log('Priority:', violationData.priority || 'medium');
    console.log('Time:', new Date().toLocaleString());
    console.log('-------------------------');

    const violation = {
      id: Date.now() + Math.random(),
      user: violationData.user || 'Unknown User',
      action: violationData.action || 'entered',
      geofenceName: violationData.geofenceName || 'Unknown Geofence',
      geofenceId: violationData.geofenceId,
      lat: violationData.lat,
      lng: violationData.lng || violationData.lon,
      priority: violationData.priority || 'medium',
      timestamp: violationData.timestamp || new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      ...violationData
    };

    // Broadcast violation to all clients (especially web admin)
    io.emit('geofenceViolation', violation);

    console.log('📢 Geofence violation broadcasted to', connectedClients.size, 'clients');
  });

  // ==================== UTILITY EVENTS ====================

  // Get all geofences (for mobile apps requesting sync)
  socket.on('getGeofences', () => {
    console.log('📍 All geofences requested by client:', socket.id);
    const clientInfo = connectedClients.get(socket.id);
    console.log('📍 Requesting client type:', clientInfo?.type || 'unknown');

    // Send all geofences
    socket.emit('allGeofences', geofences);

    // Also send them individually for better compatibility
    geofences.forEach((geofence, index) => {
      setTimeout(() => {
        socket.emit('updateGeofence', geofence);
      }, index * 50);
    });

    console.log(📍 Sent ${geofences.length} geofences to requesting client);
  });

  // Get recent SOS alerts
  socket.on('getRecentAlerts', () => {
    console.log('🆘 Recent alerts requested by client:', socket.id);
    socket.emit('recentAlerts', sosAlerts.slice(0, 50)); // Send last 50 alerts
  });

  // Server status request
  socket.on('getServerStatus', () => {
    const status = {
      connectedClients: connectedClients.size,
      totalGeofences: geofences.length,
      activeGeofences: geofences.filter(g => g.active).length,
      recentAlerts: sosAlerts.length,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };

    socket.emit('serverStatus', status);
    console.log('📊 Server status sent to client:', socket.id);
  });

  // ==================== DISCONNECT HANDLER ====================

  // Handle disconnection
  socket.on('disconnect', () => {
    const client = connectedClients.get(socket.id);
    console.log('-------------------------');
    console.log('❌ CLIENT DISCONNECTED');
    console.log('Socket ID:', socket.id);
    console.log('Type:', client?.type || 'unknown');
    console.log('Name:', client?.name || 'unknown');
    console.log('Connected for:', client ? Math.floor((Date.now() - new Date(client.connectedAt).getTime()) / 1000) + 's' : 'unknown');
    console.log('-------------------------');

    connectedClients.delete(socket.id);
    console.log('👥 Remaining connected clients:', connectedClients.size);
  });
});

// ================================================================
// REST API ENDPOINTS
// ================================================================

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Vortex SOS Server - Emergency Response System',
    version: '2.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    features: [
      'SOS Emergency Alerts',
      'Advanced Geofencing',
      'Real-time Communication',
      'Multi-client Support'
    ]
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  const clientTypes = {};
  connectedClients.forEach(client => {
    clientTypes[client.type] = (clientTypes[client.type] || 0) + 1;
  });

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    connectedClients: connectedClients.size,
    clientTypes: clientTypes,
    geofences: geofences.length,
    activeGeofences: geofences.filter(g => g.active).length,
    recentAlerts: sosAlerts.length,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Get all geofences via REST API
app.get('/api/geofences', (req, res) => {
  console.log('🌐 GET /api/geofences - Client IP:', req.ip);

  const activeOnly = req.query.active === 'true';
  const filteredGeofences = activeOnly ? geofences.filter(g => g.active) : geofences;

  res.json({
    success: true,
    count: filteredGeofences.length,
    totalCount: geofences.length,
    activeCount: geofences.filter(g => g.active).length,
    geofences: filteredGeofences,
    timestamp: new Date().toISOString()
  });
});

// Create geofence via REST API
app.post('/api/geofences', (req, res) => {
  console.log('🌐 POST /api/geofences - Creating geofence via REST API');
  console.log('🌐 Geofence name:', req.body.name);

  const newGeofence = {
    id: req.body.id || Date.now().toString(),
    name: req.body.name || 'REST API Geofence',
    type: req.body.type || 'MONITORING',
    priority: req.body.priority || 'medium',
    active: req.body.active !== false,
    alertOnEntry: req.body.alertOnEntry !== false,
    alertOnExit: req.body.alertOnExit || false,
    shapeType: req.body.shapeType || 'polygon',
    points: req.body.points || [],
    center: req.body.center || null,
    radius: req.body.radius || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...req.body
  };

  geofences.push(newGeofence);

  // Broadcast to all connected Socket.IO clients
  io.emit('updateGeofence', newGeofence);

  console.log('✅ Geofence created via REST API and broadcasted');

  res.status(201).json({
    success: true,
    message: 'Geofence created successfully',
    geofence: newGeofence
  });
});

// Get recent SOS alerts via REST API
app.get('/api/alerts', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const recentAlerts = sosAlerts.slice(0, limit);

  res.json({
    success: true,
    count: recentAlerts.length,
    totalCount: sosAlerts.length,
    alerts: recentAlerts,
    timestamp: new Date().toISOString()
  });
});

// Get server statistics
app.get('/api/stats', (req, res) => {
  const clientTypes = {};
  const clientDetails = [];

  connectedClients.forEach(client => {
    clientTypes[client.type] = (clientTypes[client.type] || 0) + 1;
    clientDetails.push({
      id: client.id,
      type: client.type,
      name: client.name,
      connectedAt: client.connectedAt,
      connectedFor: Math.floor((Date.now() - new Date(client.connectedAt).getTime()) / 1000)
    });
  });

  res.json({
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    },
    clients: {
      total: connectedClients.size,
      types: clientTypes,
      details: clientDetails
    },
    geofences: {
      total: geofences.length,
      active: geofences.filter(g => g.active).length,
      byType: geofences.reduce((acc, g) => {
        acc[g.type] = (acc[g.type] || 0) + 1;
        return acc;
      }, {})
    },
    alerts: {
      total: sosAlerts.length,
      recent: sosAlerts.slice(0, 10)
    }
  });
});

// ================================================================
// SERVER STARTUP
// ================================================================

// Start the server and listen for connections
server.listen(PORT, () => {
  console.clear(); // Clear console for clean startup
  console.log('🚀================================================================🚀');
  console.log('🚀                    VORTEX SOS SERVER                        🚀');
  console.log('🚀================================================================🚀');
  console.log('🚀 Server Status: RUNNING');
  console.log('🚀 Port:', PORT);
  console.log('🚀 Environment:', process.env.NODE_ENV || 'development');
  console.log('🚀 Time:', new Date().toLocaleString());
  console.log('🚀================================================================🚀');
  console.log('✅ Socket.IO ready for real-time connections');
  console.log('📍 Enhanced geofencing system active');
  console.log('🆘 SOS emergency alert system ready');
  console.log('🌐 REST API endpoints available at:');
  console.log('   GET  /', http://localhost:${PORT}/);
  console.log('   GET  /api/health', http://localhost:${PORT}/api/health);
  console.log('   GET  /api/stats', http://localhost:${PORT}/api/stats);
  console.log('   GET  /api/geofences', http://localhost:${PORT}/api/geofences);
  console.log('   POST /api/geofences', http://localhost:${PORT}/api/geofences);
  console.log('   GET  /api/alerts', http://localhost:${PORT}/api/alerts);
  console.log('🚀================================================================🚀');
  console.log('🎯 Waiting for client connections...');
  console.log('');
});

// ================================================================
// BACKGROUND TASKS & MONITORING
// ================================================================

// Periodic status logging every 5 minutes
setInterval(() => {
  const activeGeofences = geofences.filter(g => g.active).length;
  const clientTypes = {};
  connectedClients.forEach(client => {
    clientTypes[client.type] = (clientTypes[client.type] || 0) + 1;
  });

  console.log('📊================================================================📊');
  console.log('📊                    SERVER STATUS REPORT                        📊');
  console.log('📊================================================================📊');
  console.log('📊 Uptime:', Math.floor(process.uptime()), 'seconds');
  console.log('📊 Memory:', Math.round(process.memoryUsage().heapUsed / 1024 / 1024), 'MB');
  console.log('👥 Connected clients:', connectedClients.size);
  console.log('   - Types:', JSON.stringify(clientTypes));
  console.log('📍 Geofences:');
  console.log('   - Total:', geofences.length);
  console.log('   - Active:', activeGeofences);
  console.log('🆘 Recent alerts:', sosAlerts.length);
  console.log('📊================================================================📊');
  console.log('');
}, 300000); // Every 5 minutes

// Clean up old alerts every hour
setInterval(() => {
  const oldLength = sosAlerts.length;
  sosAlerts = sosAlerts.slice(0, 100); // Keep only last 100 alerts

  if (oldLength > 100) {
    console.log('🧹 Cleaned up', oldLength - 100, 'old SOS alerts');
  }
}, 3600000); // Every hour

// ================================================================
// GRACEFUL SHUTDOWN HANDLING
// ================================================================

const gracefulShutdown = (signal) => {
  console.log('\n🛑================================================================🛑');
  console.log('🛑 GRACEFUL SHUTDOWN INITIATED');
  console.log('🛑 Signal:', signal);
  console.log('🛑================================================================🛑');
  console.log('📊 Final Server Statistics:');
  console.log('   - Uptime:', Math.floor(process.uptime()), 'seconds');
  console.log('   - Connected clients:', connectedClients.size);
  console.log('   - Total geofences:', geofences.length);
  console.log('   - Active geofences:', geofences.filter(g => g.active).length);
  console.log('   - SOS alerts processed:', sosAlerts.length);
  console.log('🛑================================================================🛑');
  console.log('👋 Thank you for using Vortex SOS Server!');
  console.log('🛑================================================================🛑');

  // Close server gracefully
  server.close(() => {
    console.log('✅ Server closed successfully');
    process.exit(0);
  });

  // Force close after 5 seconds
  setTimeout(() => {
    console.log('⚠ Force closing server...');
    process.exit(1);
  }, 5000);
};

// Handle shutdown signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

// ================================================================
// END OF VORTEX SOS SERVER
// ================================================================
