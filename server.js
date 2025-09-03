// 1. Import necessary libraries
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

// 2. Setup the Express App and HTTP Server
const app = express();
const server = http.createServer(app);

// 3. Initialize Socket.IO
// CORS (Cross-Origin Resource Sharing) is configured to allow all connections.
// This is okay for development but should be more restrictive in production.
const io = new Server(server, {
  cors: {
    origin: "*", // Allow connections from any origin
    methods: ["GET", "POST"]
  }
});

// 4. Define the Port
// This will use the port provided by a hosting service (like Render)
// or default to port 3000 for local testing.
const PORT = process.env.PORT || 3000;

// 5. Define what happens when a client connects
io.on('connection', (socket) => {
  console.log('✅ A user connected. Socket ID:', socket.id);

  // Listen for the "sos" event from a connected client
  socket.on('sos', (data) => {
    // When an "sos" message is received, log its contents to the console.
    console.log('-------------------------');
    console.log('🆘 SOS Received!');
    console.log('User:', data.user);
    console.log('Latitude:', data.lat);
    console.log('Longitude:', data.lon);
    console.log('Timestamp:', data.timestamp);
    console.log('Message:', data.message);
    console.log('-------------------------');

    // In a real app, you would do more here, like:
    // - Save the data to a database
    // - Send an alert (SMS, email) to an administrator
    // - Broadcast this alert to an admin dashboard
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
