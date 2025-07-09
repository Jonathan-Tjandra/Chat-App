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
const activeViewers = {};

const generateRandomId = (length) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Update the joinUserToRoom function
const joinUserToRoom = (socket, data) => {
  const { room, username, userId } = data;
  socket.join(room);

  const user = {
    id: socket.id,
    name: username || `User ${socket.id.substring(0, 5)}`,
    persistentId: userId 
  };
  users[socket.id] = { ...user, room };

  if (rooms[room]) {
    rooms[room].userCount++;
  }

  const usersInRoom = io.sockets.adapter.rooms.get(room);
  const userList = usersInRoom ? Array.from(usersInRoom).map(id => users[id]).filter(Boolean) : [];

  socket.emit('loadHistory', messageHistory[room] || []);
  
  // Pass creator info
  socket.emit('joinSuccess', { 
    userList: userList, 
    roomName: room,
    isCreator: rooms[room] && rooms[room].creator === userId
  });

  socket.to(room).emit('roomUsers', userList);
};

io.on('connection', (socket) => {
  const handleUserLeave = (socket) => {
    const user = users[socket.id];
    if (user) {
      const { room } = user;
      delete users[socket.id];
      
      // Clean up active viewers
      if (activeViewers[room]) {
        activeViewers[room].delete(socket.id);
        const viewerList = Array.from(activeViewers[room]);
        io.to(room).emit('activeViewersUpdate', { room, viewers: viewerList });
      }
      
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

  socket.on('enterChatView', (data) => {
    const { room } = data;
    if (!activeViewers[room]) {
      activeViewers[room] = new Set();
    }
    activeViewers[room].add(socket.id);
    
    // Broadcast updated viewer list to room
    const viewerList = Array.from(activeViewers[room]);
    io.to(room).emit('activeViewersUpdate', { room, viewers: viewerList });
  });

  socket.on('leaveChatView', (data) => {
    const { room } = data;
    if (activeViewers[room]) {
      activeViewers[room].delete(socket.id);
      
      // Broadcast updated viewer list to room
      const viewerList = Array.from(activeViewers[room]);
      io.to(room).emit('activeViewersUpdate', { room, viewers: viewerList });
    }
  });

  socket.on('createRoom', (data) => {
  const { username, password, userId } = data;
  
  let roomName;
  do {
    roomName = `R#${generateRandomId(8)}`;
  } while (rooms[roomName]);

  rooms[roomName] = { 
    password: password || null, 
    userCount: 0, 
    members: [userId],
    creator: userId // Add this line to track creator
  };
  
  joinUserToRoom(socket, { room: roomName, username, userId });
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
  // Remove from active viewers when leaving room
    if (activeViewers[room]) {
      activeViewers[room].delete(socket.id);
      const viewerList = Array.from(activeViewers[room]);
      io.to(room).emit('activeViewersUpdate', { room, viewers: viewerList });
    }
    
    const user = users[socket.id];
    if (user && rooms[room]) {
      rooms[room].userCount--;
      if (rooms[room].userCount > 0) { 
        const usersInRoom = io.sockets.adapter.rooms.get(room);
        const userList = usersInRoom ? Array.from(usersInRoom).map(id => users[id]).filter(Boolean) : [];
        socket.to(room).emit('roomUsers', userList);
      }
    }
  });

  socket.on('disconnect', () => handleUserLeave(socket));

  // Add this new socket handler in the io.on('connection', (socket) => { block

socket.on('leaveRoomPermanently', (data) => {
  const { room, userId } = data;
  const user = users[socket.id];
  
  if (user && rooms[room]) {
    // Remove user from room members
    if (rooms[room].members) {
      rooms[room].members = rooms[room].members.filter(id => id !== userId);
    }
    
    // Remove from active viewers
    if (activeViewers[room]) {
      activeViewers[room].delete(socket.id);
      const viewerList = Array.from(activeViewers[room]);
      io.to(room).emit('activeViewersUpdate', { room, viewers: viewerList });
    }
    
    // Update user count
    rooms[room].userCount--;
    
    // IMPORTANT: Emit confirmation BEFORE leaving the room
    socket.emit('leftRoomPermanently', { room });
    
    // Leave the Socket.IO room
    socket.leave(room);
    
    // Update the user list for remaining users
    const usersInRoom = io.sockets.adapter.rooms.get(room);
    const userList = usersInRoom ? Array.from(usersInRoom).map(id => users[id]).filter(Boolean) : [];
    io.to(room).emit('roomUsers', userList);
    
    // Clean up room if empty
    if (rooms[room].userCount <= 0 && (!rooms[room].members || rooms[room].members.length === 0)) {
      delete rooms[room];
      delete messageHistory[room];
      delete activeViewers[room];
      console.log(`[SERVER LOG] Room deleted: ${room}`);
    }
  }
  });
  // Add this new socket handler for creator deleting the room entirely
socket.on('deleteRoomAsCreator', (data) => {
  const { room, userId } = data;
  const user = users[socket.id];
  
  if (user && rooms[room]) {
    // Mark the room as deleted by creator
    rooms[room].deletedBy = userId;
    rooms[room].deletedAt = new Date();
    
    // Remove creator from active viewers
    if (activeViewers[room]) {
      activeViewers[room].delete(socket.id);
      const viewerList = Array.from(activeViewers[room]);
      io.to(room).emit('activeViewersUpdate', { room, viewers: viewerList });
    }
    
    // Leave the Socket.IO room
    socket.leave(room);
    
    // Update user count
    rooms[room].userCount--;
    
    // Notify all members that the room was deleted
    io.to(room).emit('roomDeletedByCreator', { 
      room, 
      deletedBy: user.name,
      deletedAt: rooms[room].deletedAt
    });
    
    // Confirm to creator
    socket.emit('leftRoomPermanently', { room });
    
    // Update the user list for remaining users
    const usersInRoom = io.sockets.adapter.rooms.get(room);
    const userList = usersInRoom ? Array.from(usersInRoom).map(id => users[id]).filter(Boolean) : [];
    io.to(room).emit('roomUsers', userList);
    
    console.log(`[SERVER LOG] Room deleted by creator: ${room}`);
  }
  });

  socket.on('dismissDeletedRoom', (data) => {
  const { room, userId } = data;
  
  if (rooms[room] && rooms[room].deletedBy) {
    // Remove user from room members
    if (rooms[room].members) {
      rooms[room].members = rooms[room].members.filter(id => id !== userId);
    }
    
    // Leave the Socket.IO room
    socket.leave(room);
    
    // Update user count
    rooms[room].userCount--;
    
    // Clean up room if no members left
    if (rooms[room].members.length === 0) {
      delete rooms[room];
      delete messageHistory[room];
      delete activeViewers[room];
      console.log(`[SERVER LOG] Deleted room cleaned up: ${room}`);
    }
    
    socket.emit('roomDismissed', { room });
  }
});
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server is running on port ${PORT}`));