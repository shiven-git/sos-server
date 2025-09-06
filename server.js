// 1. Import necessary libraries
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

// 2. Setup the Express App and HTTP Server
const app = express();
const server = http.createServer(app);

// 3. Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*", // Allow connections from any origin
    methods: ["GET", "POST"]
  }
});

// 4. Define the Port
const PORT = process.env.PORT || 3000;

// ✨ NEW: In-memory storage for the current geofence
let currentGeofence = null;

// 5. Define what happens when a client connects
io.on('connection', (socket) => {
  console.log('✅ A user connected. Socket ID:', socket.id);

  // ✨ NEW: Immediately send the current geofence to the newly connected client
  if (currentGeofence) {
    socket.emit('updateGeofence', currentGeofence);
    console.log('Sent existing geofence to new user', socket.id);
  }

  // Listen for the "sos" event from a connected client
  socket.on('sos', (data) => {
    console.log('-------------------------');
    console.log('🆘 SOS Received!');
    console.log('User:', data.user, 'at', data.lat, data.lon);
    console.log('-------------------------');

    // Broadcast SOS to all connected clients (including dashboards)
    io.emit('sosAlert', data);
  });

  // ✨ NEW: Listen for geofence updates from an admin client
  socket.on('setGeofence', (geofenceData) => {
    currentGeofence = geofenceData;
    console.log('-------------------------');
    console.log('🗺️ Geofence Updated/Set');
    console.log('Name:', currentGeofence.name);
    console.log('Points:', currentGeofence.points.length);
    console.log('-------------------------');
    
    // Broadcast the new geofence to ALL connected clients
    io.emit('updateGeofence', currentGeofence);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('❌ User disconnected. Socket ID:', socket.id);
  });
});

// 6. Start the server and listen for connections
server.listen(PORT, () => {
  console.log(`🚀 Server is running and listening on port ${PORT}`);
});
