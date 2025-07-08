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

const rooms = {};
const users = {}; 
const messageHistory = {};

const joinUserToRoom = (socket, data) => {
  const { room, username, userId } = data;
  socket.join(room);

  const user = {
    id: socket.id,
    name: username || `User ${socket.id.substring(0, 5)}`,
    persistentId: userId 
  };
  users[socket.id] = { ...user, room };

  if (rooms[room]) { rooms[room].userCount++; }

  const usersInRoom = io.sockets.adapter.rooms.get(room);
  const userList = usersInRoom ? Array.from(usersInRoom).map(id => users[id]).filter(Boolean) : [];

  socket.emit('loadHistory', messageHistory[room] || []);
  socket.emit('joinSuccess', userList);
  socket.to(room).emit('roomUsers', userList);
};


io.on('connection', (socket) => {
  const handleUserLeave = (socket) => {
    const user = users[socket.id];
    if (user) {
      const { room } = user;
      delete users[socket.id];
      if (rooms[room]) {
        rooms[room].userCount--;
        if (rooms[room].userCount <= 0) {
          console.log(`[SERVER LOG] Room is now empty: ${room}`);
        } else {
          const usersInRoom = io.sockets.adapter.rooms.get(room);
          const userList = usersInRoom ? Array.from(usersInRoom).map(id => users[id]).filter(Boolean) : [];
          io.to(room).emit('roomUsers', userList);
        }
      }
    }
  };

  socket.on('createRoom', (data) => {
    const { room, username, password, userId } = data;
    if (rooms[room]) {
      socket.emit('roomError', { message: 'A room with this name is already active.' });
      return;
    }
    rooms[room] = { password: password || null, userCount: 0, members: [userId] };
    joinUserToRoom(socket, { room, username, userId });
  });

  socket.on('joinRoom', (data) => {
    const { room, username, password, userId } = data;
    const roomData = rooms[room];
    if (!roomData) {
      socket.emit('roomError', { message: 'This room does not exist.' });
      return;
    }
    if (roomData.password) {
      const isMember = roomData.members.includes(userId);
      if (!isMember && roomData.password !== password) {
        socket.emit('roomError', { message: 'Incorrect password.' });
        return;
      }
      if (!isMember) { roomData.members.push(userId); }
    }
    joinUserToRoom(socket, { room, username, userId });
  });

  socket.on('sendMessage', (data) => {
    if (!messageHistory[data.room]) { messageHistory[data.room] = []; }
    messageHistory[data.room].push(data);
    if (messageHistory[data.room].length > 50) { messageHistory[data.room].shift(); }

    // FIX: Broadcast to the reliable Socket.IO room.
    // This now sends messages to ALL members, including those on the homepage.
    io.to(data.room).emit('receiveMessage', data);
  });

  socket.on('typing', (data) => {
    // FIX: Broadcast with the user's unique socket.id for reliability
    socket.to(data.room).emit('userTyping', { id: socket.id, isTyping: data.isTyping });
  });
  
  socket.on('messageSeen', (data) => {
    const { messageId, room, seenByUserId } = data;
    const seenByUser = Object.values(users).find(u => u.persistentId === seenByUserId);
    if (!seenByUser) return;
    
    const roomHistory = messageHistory[room] || [];
    const messageToUpdate = roomHistory.find(msg => msg.id === messageId);

    if (messageToUpdate && !messageToUpdate.seenBy[seenByUserId]) {
      const seenAt = new Date();
      messageToUpdate.seenBy[seenByUserId] = { name: seenByUser.name, seenAt: seenAt };
      
      // FIX: Broadcast the status update to the reliable Socket.IO room.
      io.to(room).emit('updateMessageStatus', {
        messageId, room,
        seenBy: { id: seenByUser.persistentId, name: seenByUser.name },
        seenAt: seenAt,
      });
    }
  });

  socket.on('leaveRoom', (room) => {
    // Note: We no longer call socket.leave(room). The user stays subscribed.
    // We just update the online user count for the UI.
    const user = users[socket.id];
    if (user && rooms[room]) {
      rooms[room].userCount--;
      if (rooms[room].userCount > 0) { 
        const usersInRoom = io.sockets.adapter.rooms.get(room);
        const userList = usersInRoom ? Array.from(usersInRoom).map(id => users[id]).filter(Boolean) : [];
        // We only tell users who are *currently viewing* the chat room about the updated online list.
        socket.to(room).emit('roomUsers', userList);
      }
    }
  });

  socket.on('disconnect', () => handleUserLeave(socket));
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server is running on port ${PORT}`));