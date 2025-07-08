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

// --- Data Structures ---
// rooms[roomName] = { password: '...', userCount: 0 }
const rooms = {};
// users[socket.id] = { name: '...', room: '...' }
const users = {}; 

// --- Helper function to join a user to a room ---
const joinUserToRoom = (socket, data) => {
  const { room, username } = data;
  socket.join(room);

  const user = {
    id: socket.id,
    name: username || `User ${socket.id.substring(0, 5)}`, 
    persistentId: data.userId
  };
  users[socket.id] = { ...user, room };

  if (rooms[room]) {
    rooms[room].userCount++;
  }

  // Get a list of user objects for the current room
  const usersInRoom = io.sockets.adapter.rooms.get(room);
  const userList = usersInRoom ? Array.from(usersInRoom).map(id => users[id]) : [];

  console.log(`[SERVER LOG] User ${user.name} joined room: ${room}`);
  socket.emit('joinSuccess', userList); // Notify the joining user they were successful
  socket.to(room).emit('roomUsers', userList); // Notify everyone else in the room
};


io.on('connection', (socket) => {
  console.log(`✅ User Connected: ${socket.id}`);

  socket.on('createRoom', (data) => {
    const { room, username, password, userId } = data;
    if (rooms[room]) {
      socket.emit('roomError', { message: 'A room with this name is already active.' });
      return;
    }
    // Create the new room, now with a members list
    rooms[room] = { 
      password: password || null, 
      userCount: 0,
      members: [userId] // The creator is the first member
    };
    console.log(`[SERVER LOG] Room created: ${room} by ${userId}`);
    joinUserToRoom(socket, { room, username, userId });
  });

  socket.on('joinRoom', (data) => {
    const { room, username, password, userId } = data;
    const roomData = rooms[room];

    if (!roomData) {
      socket.emit('roomError', { message: 'This room does not exist.' });
      return;
    }

    // Check if the room is private
    if (roomData.password) {
      // If private, check if user is already a member OR if they provided the correct password
      const isMember = roomData.members.includes(userId);

      if (!isMember && roomData.password !== password) {
        socket.emit('roomError', { message: 'Incorrect password.', needsPassword: true });
        return;
      }

      // If they passed the check and are not yet a member, add them
      if (!isMember) {
        roomData.members.push(userId);
        console.log(`[SERVER LOG] New member ${userId} added to room: ${room}`);
      }
    }

    // All checks passed, join the user
    joinUserToRoom(socket, { room, username, userId });
  });

  socket.on('sendMessage', (data) => {
    io.to(data.room).emit('receiveMessage', data);
  });
  
  socket.on('typing', (data) => {
    socket.broadcast.to(data.room).emit('userTyping', { user: data.user, isTyping: data.isTyping });
  });

  // --- REVISED: Disconnect Logic ---
  socket.on('disconnect', () => {
    console.log(`❌ User Disconnected: ${socket.id}`);
    const user = users[socket.id];
    if (user) {
      const { room } = user;
      delete users[socket.id];

      if (rooms[room]) {
        rooms[room].userCount--;
        // If the room is now empty, delete it
        if (rooms[room].userCount <= 0) {
          console.log(`[SERVER LOG] Room removed: ${room}`);
        } else {
          // Otherwise, just update the user list for remaining users
          const usersInRoom = io.sockets.adapter.rooms.get(room);
          const userList = usersInRoom ? Array.from(usersInRoom).map(id => users[id]) : [];
          io.to(room).emit('roomUsers', userList);
        }
      }
    }
  });

  socket.on('leaveRoom', (room) => {
    socket.leave(room);
    console.log(`[SERVER LOG] User ${socket.id} left room: ${room}`);
    
    if (rooms[room]) {
      // Decrement user count
      rooms[room].userCount--;
      // If room is now empty, delete it
      if (rooms[room].userCount <= 0) {
        console.log(`[SERVER LOG] Room removed: ${room}`);
      } else {
        // Otherwise, just update the user list for remaining users
        const usersInRoom = io.sockets.adapter.rooms.get(room);
        const userList = usersInRoom ? Array.from(usersInRoom).map(id => users[id]).filter(Boolean) : [];
        io.to(room).emit('roomUsers', userList);
      }
    }
  });

});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server is running on port ${PORT}`));