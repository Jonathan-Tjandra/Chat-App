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

// To store users in rooms
const roomUsers = {};

io.on('connection', (socket) => {
  console.log(`✅ User Connected: ${socket.id}`);

  socket.on('joinRoom', (room) => {
    socket.join(room);
    console.log(`User ${socket.id} joined room: ${room}`);

    // Store user in the room
    if (!roomUsers[room]) {
      roomUsers[room] = [];
    }
    roomUsers[room].push(socket.id);
    socket.currentRoom = room; // Keep track of the user's room

    // Emit the updated user list to everyone in the room
    io.to(room).emit('roomUsers', roomUsers[room]);
  });

  socket.on('sendMessage', (data) => {
    socket.to(data.room).emit('receiveMessage', data);
  });
  
  // NEW: Listen for typing events
  socket.on('typing', (data) => {
    socket.to(data.room).emit('userTyping', { userId: socket.id, isTyping: data.isTyping });
  });

  socket.on('disconnect', () => {
    console.log(`❌ User Disconnected: ${socket.id}`);
    const room = socket.currentRoom;
    if (room && roomUsers[room]) {
      // Remove user from the room
      roomUsers[room] = roomUsers[room].filter(id => id !== socket.id);
      // Emit the updated user list
      io.to(room).emit('roomUsers', roomUsers[room]);
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});