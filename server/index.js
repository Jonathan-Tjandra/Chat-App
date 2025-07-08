// server/index.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// This will store a mapping of socket IDs to their user object
const users = {}; 
// This will store a mapping of rooms to an array of socket IDs
const roomUsers = {}; 

io.on('connection', (socket) => {
  console.log(`✅ User Connected: ${socket.id}`);

  socket.on('joinRoom', (data) => {
    const { room, username } = data;
    socket.join(room);

    // Create and store the new user
    const user = {
      id: socket.id,
      name: username || `User ${socket.id.substring(0, 5)}`
    };
    users[socket.id] = { ...user, room };

    // Add user to the room's list
    if (!roomUsers[room]) {
      roomUsers[room] = [];
    }
    roomUsers[room].push(user);

    console.log(`[SERVER LOG] User ${user.name} joined room: ${room}`);
    
    // Broadcast the updated user list to the room
    io.to(room).emit('roomUsers', roomUsers[room]);
    console.log(`[SERVER LOG] Emitted 'roomUsers' to room ${room} with data:`, roomUsers[room]);
  });

  socket.on('sendMessage', (data) => {
    // Broadcast to the room, not just the socket
    io.to(data.room).emit('receiveMessage', data);
    console.log(`[SERVER LOG] Emitted 'receiveMessage' to room ${data.room} with data:`, data);
  });
  
  socket.on('typing', (data) => {
    socket.broadcast.to(data.room).emit('userTyping', { user: data.user, isTyping: data.isTyping });
  });

  socket.on('disconnect', () => {
    console.log(`❌ User Disconnected: ${socket.id}`);
    const user = users[socket.id];
    if (user) {
      const { room } = user;
      // Remove user from our lists
      delete users[socket.id];
      if (roomUsers[room]) {
        roomUsers[room] = roomUsers[room].filter(u => u.id !== socket.id);
        
        // Broadcast the new user list
        io.to(room).emit('roomUsers', roomUsers[room]);
        console.log(`[SERVER LOG] Emitted 'roomUsers' after disconnect to room ${room}`);
      }
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});