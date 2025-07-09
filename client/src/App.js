import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import io from 'socket.io-client';
import './App.css';

const socket = io('http://localhost:4000');

// --- Helper Functions for Naming and Colors ---
const generateRandomId = (length) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const getFromStorage = (key) => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : null;
  } catch (error) {
    return null;
  }
};

const getOrCreateUserInfo = () => {
  let userInfo = getFromStorage('chatAppUserInfo');
  if (!userInfo) {
    userInfo = {
      id: `user_${generateRandomId(12)}`,
      name: `USER-${generateRandomId(8)}`,
      color: `hsl(${Math.floor(Math.random() * 360)}, 70%, 35%)`,
    };
    localStorage.setItem('chatAppUserInfo', JSON.stringify(userInfo));
  }
  return userInfo;
};

// --- REVISED: Join Form now conditionally shows inputs ---
const JoinForm = ({ title, onAction, isCreating, requiresPassword }) => {
  const [room, setRoom] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onAction({ room, password });
  };

  return (
    <form className="joinChatContainer" onSubmit={handleSubmit}>
      <h3>{title}</h3>
      <p className="form-description">
        {isCreating 
          ? `Your username is ${getOrCreateUserInfo().name}. A unique room name will be generated.`
          : `Your username is ${getOrCreateUserInfo().name}.`}
      </p>

      {!isCreating && (
        <input type="text" placeholder="Room Name..." value={room} onChange={(e) => setRoom(e.target.value)} required />
      )}

      {requiresPassword && (
        <input type="password" placeholder="Password (Optional)..." value={password} onChange={(e) => setPassword(e.target.value)} />
      )}
      <button type="submit">{title}</button>
    </form>
  );
};

const MessageInfoModal = ({ message, currentUserId, onClose }) => {
  if (!message) return null;
  const isMyMessage = message.authorUserId === currentUserId;
  const seenByEntries = Object.entries(message.seenBy || {}).filter(([id]) => id !== currentUserId);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Message Info</h3>
        <div className="message-info-bubble">
          <p className="message-text">{message.message}</p>
          <p className="message-time">{message.time}</p>
        </div>
        {isMyMessage ? (
          <div className="seen-by-list">
            <h4>Seen By</h4>
            <ul>
              {seenByEntries.length > 0 ? (
                seenByEntries.map(([id, data]) => (
                  <li key={id}><span className="seen-by-name">{data.name}</span><span className="seen-by-status">✔️ Seen at {new Date(data.seenAt).toLocaleTimeString()}</span></li>
                ))
              ) : ( <li>No one else has seen this message yet.</li> )}
            </ul>
          </div>
        ) : (
          <div className="seen-by-list">
            <h4>Receipt</h4>
            <p>You saw this message at: {message.seenBy && message.seenBy[currentUserId] ? new Date(message.seenBy[currentUserId].seenAt).toLocaleTimeString() : 'Not yet recorded.'}</p>
          </div>
        )}
        <button onClick={onClose} className="modal-close-button">Close</button>
      </div>
    </div>
  );
};

const DeleteConfirmationModal = ({ roomName, onConfirm, onCancel }) => {
  if (!roomName) return null;
  
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content delete-confirmation-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Leave Room</h3>
        <p>Are you sure you want to leave <strong>"{roomName}"</strong> permanently?</p>
        <p className="warning-text">This action cannot be undone and you will lose access to all messages in this room.</p>
        <div className="modal-buttons">
          <button className="cancel-button" onClick={onCancel}>Cancel</button>
          <button className="confirm-delete-button" onClick={onConfirm}>Leave Room</button>
        </div>
      </div>
    </div>
  );
};

// FIXED: Creator delete confirmation modal
const CreatorDeleteConfirmationModal = ({ roomName, onConfirm, onCancel }) => {
  if (!roomName) return null;
  
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content creator-delete-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Room Creator Options</h3>
        <p>You are the creator of <strong>"{roomName}"</strong>. Choose an option:</p>
        
        <div className="creator-options">
          <div className="option-card">
            <h4>Delete Room for Everyone</h4>
            <p>The room will be permanently deleted for all members. Other members will see a notification.</p>
            <button className="delete-option-button" onClick={() => onConfirm('delete')}>
              Delete for Everyone
            </button>
          </div>
          
          <div className="option-card">
            <h4>Leave Room Only</h4>
            <p>You will leave the room but other members can continue using it normally.</p>
            <button className="leave-option-button" onClick={() => onConfirm('leave')}>
              Leave Room
            </button>
          </div>
        </div>
        
        <button className="cancel-button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
};

// FIXED: Deleted room notification component
const DeletedRoomNotification = ({ roomName, deletedBy, deletedAt, onDismiss }) => {
  return (
    <div className="deleted-room-notification">
      <div className="notification-content">
        <h4>Room Deleted</h4>
        <p>The room <strong>"{roomName}"</strong> was deleted by {deletedBy}</p>
        <p className="deletion-time">Deleted at: {new Date(deletedAt).toLocaleString()}</p>
        <button className="dismiss-button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
};

function App() {
  const [userInfo] = useState(getOrCreateUserInfo());
  const { id: userId, name: defaultUsername, color: userColor } = userInfo;
  const [uiState, setUiState] = useState('home');
  const [joinedRooms, setJoinedRooms] = useState(() => getFromStorage('joinedRooms') || {});
  const [error, setError] = useState('');
  const [messages, setMessages] = useState({});
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [currentRoom, setCurrentRoom] = useState('');
  const [currentUsername, setCurrentUsername] = useState(defaultUsername);
  const [currentMessage, setCurrentMessage] = useState('');
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [lastReadTimestamps, setLastReadTimestamps] = useState(() => getFromStorage('lastReadTimestamps') || {});

  const roomRef = useRef(currentRoom);
  const usernameRef = useRef(currentUsername);
  const textareaRef = useRef(null);
  const chatWindowRef = useRef(null);
  const observer = useRef(null);
  const typingTimeoutRef = useRef(null);
  const [activeViewers, setActiveViewers] = useState([]);
  const [deleteConfirmation, setDeleteConfirmation] = useState(null);

  const [deletedRooms, setDeletedRooms] = useState(() => getFromStorage('deletedRooms') || {});
  const [creatorDeleteConfirmation, setCreatorDeleteConfirmation] = useState(null);

  const unreadCounts = useMemo(() => {
    return Object.keys(joinedRooms).reduce((acc, room) => {
      const roomMessages = messages[room] || [];
      const lastRead = lastReadTimestamps[room] || 0;
      acc[room] = roomMessages.filter(msg => msg.timestamp > lastRead && msg.authorUserId !== userId).length;
      return acc;
    }, {});
  }, [messages, joinedRooms, userId, lastReadTimestamps]);

  const deleteRoom = (roomName, e) => {
    e.stopPropagation();
    
    const roomData = joinedRooms[roomName];
    if (roomData && roomData.isCreator) {
      setCreatorDeleteConfirmation(roomName);
    } else {
      setDeleteConfirmation(roomName);
    }
  };

  // FIXED: Creator delete confirmation
  const confirmCreatorDelete = (action) => {
    if (creatorDeleteConfirmation) {
      if (action === 'delete') {
        // Delete for everyone
        socket.emit('deleteRoomAsCreator', { room: creatorDeleteConfirmation, userId });
      } else if (action === 'leave') {
        // Just leave the room
        socket.emit('leaveRoomPermanently', { room: creatorDeleteConfirmation, userId });
      }
      setCreatorDeleteConfirmation(null);
    }
  };

  const cancelCreatorDelete = () => {
    setCreatorDeleteConfirmation(null);
  };

  const confirmDelete = () => {
    if (deleteConfirmation) {
      socket.emit('leaveRoomPermanently', { room: deleteConfirmation, userId });
      setDeleteConfirmation(null);
    }
  };

  const cancelDelete = () => {
    setDeleteConfirmation(null);
  };

  const dismissDeletedRoom = (roomName, e) => {
    e.stopPropagation();
    socket.emit('dismissDeletedRoom', { room: roomName, userId });
  };

  // FIXED: Function to handle room clicks
  const handleRoomClick = (roomName) => {
    // Check if this room was deleted by creator
    if (deletedRooms[roomName]) {
      // Room was deleted by creator, user cannot enter
      return;
    }
    
    // Normal room entry
    const roomData = joinedRooms[roomName];
    if (roomData) {
      socket.emit('joinRoom', { 
        room: roomName, 
        username: roomData.username, 
        password: '', 
        userId 
      });
    }
  };

  // FIXED: Function to create room
  const createRoom = (formData) => {
    const { password } = formData;
    socket.emit('createRoom', { 
      username: currentUsername, 
      password, 
      userId 
    });
  };

  // FIXED: Function to join room
  const joinRoom = (formData) => {
    const { room, password } = formData;
    socket.emit('joinRoom', { 
      room, 
      username: currentUsername, 
      password, 
      userId 
    });
  };

  // FIXED: Function to send message
  const sendMessage = () => {
    if (currentMessage.trim() && currentRoom) {
      const messageData = {
        id: generateRandomId(12),
        room: currentRoom,
        authorUserId: userId,
        author: currentUsername,
        message: currentMessage,
        time: new Date().toLocaleTimeString(),
        timestamp: Date.now(),
        seenBy: { [userId]: { name: currentUsername, seenAt: new Date() } }
      };
      
      socket.emit('sendMessage', messageData);
      setCurrentMessage('');
      
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  // FIXED: Function to handle typing
  const handleTyping = (e) => {
    setCurrentMessage(e.target.value);
    
    if (currentRoom) {
      socket.emit('typing', { room: currentRoom, isTyping: true });
      
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('typing', { room: currentRoom, isTyping: false });
      }, 1000);
    }
  };

  // FIXED: Function to handle key press
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  useEffect(() => {
    socket.emit('registerUser', userId);
    
    socket.on('roomError', (data) => {
      setError(data.message);
      // If user is in chat and gets room error, redirect to home
      if (uiState === 'chat') {
        setUiState('home');
        setCurrentRoom('');
        roomRef.current = '';
      }
    });

    socket.on('joinSuccess', (data) => {
      const { userList, roomName, isCreator } = data;
      
      setCurrentRoom(roomName);
      roomRef.current = roomName;

      setJoinedRooms(prev => {
        const newJoinedRooms = { 
          ...prev, 
          [roomName]: { 
            username: usernameRef.current,
            isCreator: isCreator || false
          }
        };
        localStorage.setItem('joinedRooms', JSON.stringify(newJoinedRooms));
        return newJoinedRooms;
      });
      
      setOnlineUsers(userList);
      setUiState('chat');
      setError('');
      
      // Emit that user entered chat view
      socket.emit('enterChatView', { room: roomName });
    });

    socket.on('receiveMessage', (data) => {
      setMessages(prev => ({ ...prev, [data.room]: [...(prev[data.room] || []), data] }));
    });

    socket.on('roomUsers', (userList) => setOnlineUsers(userList));

    socket.on('userTyping', ({ id, isTyping }) => {
      setTypingUsers(prev => ({ ...prev, [id]: isTyping }));
    });

    socket.on('updateMessageStatus', (data) => {
      const { messageId, room, seenBy, seenAt } = data;
      setMessages(prev => {
        const roomMessages = prev[room] || [];
        const newRoomMessages = roomMessages.map(msg => {
          if (msg.id === messageId) {
            const updatedSeenBy = { ...(msg.seenBy || {}) };
            if (!updatedSeenBy[seenBy.id]) {
              updatedSeenBy[seenBy.id] = { name: seenBy.name, seenAt: seenAt };
            }
            return { ...msg, seenBy: updatedSeenBy };
          }
          return msg;
        });
        return { ...prev, [room]: newRoomMessages };
      });
    });

    socket.on('loadHistory', (history) => {
      setMessages(prev => ({ ...prev, [roomRef.current]: history }));
    });

    socket.on('activeViewersUpdate', (data) => {
      if (data.room === roomRef.current) {
        setActiveViewers(data.viewers);
      }
    });

    socket.on('leftRoomPermanently', (data) => {
      const { room } = data;
      
      // Remove the room from joined rooms
      setJoinedRooms(prev => {
        const newJoinedRooms = { ...prev };
        delete newJoinedRooms[room];
        localStorage.setItem('joinedRooms', JSON.stringify(newJoinedRooms));
        return newJoinedRooms;
      });
      
      // Clear messages for this room
      setMessages(prev => {
        const newMessages = { ...prev };
        delete newMessages[room];
        return newMessages;
      });
      
      // Clear last read timestamps
      setLastReadTimestamps(prev => {
        const newTimestamps = { ...prev };
        delete newTimestamps[room];
        localStorage.setItem('lastReadTimestamps', JSON.stringify(newTimestamps));
        return newTimestamps;
      });

      // If currently in this room, go back to home
      if (currentRoom === room) {
        setUiState('home');
        setCurrentRoom('');
        roomRef.current = '';
      }
    });

    // FIXED: Handle room deleted by creator
    socket.on('roomDeletedByCreator', (data) => {
      const { room, deletedBy, deletedAt } = data;
      
      // Add to deleted rooms for notification
      setDeletedRooms(prev => {
        const newDeletedRooms = { 
          ...prev, 
          [room]: { 
            deletedBy, 
            deletedAt, 
            originalRoom: joinedRooms[room] 
          }
        };
        localStorage.setItem('deletedRooms', JSON.stringify(newDeletedRooms));
        return newDeletedRooms;
      });

      // If currently in this room, go back to home
      if (currentRoom === room) {
        setUiState('home');
        setCurrentRoom('');
        roomRef.current = '';
      }
    });
    
    socket.on('roomDismissed', (data) => {
      const { room } = data;
      
      // Remove from deleted rooms
      setDeletedRooms(prev => {
        const newDeletedRooms = { ...prev };
        delete newDeletedRooms[room];
        localStorage.setItem('deletedRooms', JSON.stringify(newDeletedRooms));
        return newDeletedRooms;
      });
      
      // Also remove from joined rooms
      setJoinedRooms(prev => {
        const newJoinedRooms = { ...prev };
        delete newJoinedRooms[room];
        localStorage.setItem('joinedRooms', JSON.stringify(newJoinedRooms));
        return newJoinedRooms;
      });
    });

    return () => {
      socket.off('roomError');
      socket.off('joinSuccess');
      socket.off('roomUsers');
      socket.off('receiveMessage');
      socket.off('userTyping');
      socket.off('updateMessageStatus');
      socket.off('loadHistory');
      socket.off('activeViewersUpdate');
      socket.off('leftRoomPermanently');
      socket.off('roomDeletedByCreator');
      socket.off('roomDismissed');
    };
  }, [uiState, currentRoom, joinedRooms, userId]);

  // FIXED: Update roomRef and usernameRef
  useEffect(() => {
    roomRef.current = currentRoom;
    usernameRef.current = currentUsername;
  }, [currentRoom, currentUsername]);

  useEffect(() => {
    if (chatWindowRef.current) chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
  }, [messages, currentRoom]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [currentMessage]);
  
  useEffect(() => {
    const handleIntersection = (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const { messageId, authorId, room } = entry.target.dataset;
          if (authorId !== socket.id) {
            socket.emit('messageSeen', { messageId, authorId, room, seenByUserId: userId });
            observer.current.unobserve(entry.target);
          }
        }
      });
    };
    observer.current = new IntersectionObserver(handleIntersection, { threshold: 0.1 });
    
    return () => {
      if (observer.current) {
        observer.current.disconnect();
      }
    };
  }, [userId]);

  // FIXED: Update last read timestamp when entering chat view
  useEffect(() => {
    if (uiState === 'chat' && currentRoom) {
      const currentTime = Date.now();
      setLastReadTimestamps(prev => {
        const newTimestamps = { ...prev, [currentRoom]: currentTime };
        localStorage.setItem('lastReadTimestamps', JSON.stringify(newTimestamps));
        return newTimestamps;
      });
    }
  }, [uiState, currentRoom]);

  // FIXED: Render function for room list
  const renderRoomList = () => {
    const roomEntries = Object.entries(joinedRooms);
    const deletedRoomEntries = Object.entries(deletedRooms);
    
    return (
      <div className="room-list">
        <h3>Your Rooms</h3>
        
        {/* Active Rooms */}
        {roomEntries.map(([roomName, roomData]) => (
          <div 
            key={roomName}
            className={`room-item ${deletedRooms[roomName] ? 'deleted-room' : ''}`}
            onClick={() => !deletedRooms[roomName] && handleRoomClick(roomName)}
          >
            <div className="room-info">
              <span className="room-name">{roomName}</span>
              {roomData.isCreator && <span className="creator-badge">Creator</span>}
              {unreadCounts[roomName] > 0 && (
                <span className="unread-count">{unreadCounts[roomName]}</span>
              )}
            </div>
            {!deletedRooms[roomName] && (
              <button 
                className="delete-room-btn"
                onClick={(e) => deleteRoom(roomName, e)}
              >
                ×
              </button>
            )}
          </div>
        ))}
        
        {/* Deleted Room Notifications */}
        {deletedRoomEntries.map(([roomName, deletedData]) => (
          <div key={`deleted-${roomName}`} className="room-item deleted-room">
            <DeletedRoomNotification
              roomName={roomName}
              deletedBy={deletedData.deletedBy}
              deletedAt={deletedData.deletedAt}
              onDismiss={(e) => dismissDeletedRoom(roomName, e)}
            />
          </div>
        ))}
        
        {roomEntries.length === 0 && deletedRoomEntries.length === 0 && (
          <p className="no-rooms">No rooms yet. Create or join a room to get started!</p>
        )}
      </div>
    );
  };

  // FIXED: Render function for chat messages
  const renderMessages = () => {
    const roomMessages = messages[currentRoom] || [];
    
    return roomMessages.map((msg) => (
      <div 
        key={msg.id}
        className={`message ${msg.authorUserId === userId ? 'own-message' : 'other-message'}`}
        data-message-id={msg.id}
        data-author-id={msg.authorUserId}
        data-room={currentRoom}
        ref={(el) => {
          if (el && observer.current && msg.authorUserId !== userId) {
            observer.current.observe(el);
          }
        }}
        onClick={() => setSelectedMessage(msg)}
      >
        <div className="message-content">
          <div className="message-header">
            <span className="message-author" style={{ color: userColor }}>
              {msg.author}
            </span>
            <span className="message-time">{msg.time}</span>
          </div>
          <div className="message-text">{msg.message}</div>
          {msg.authorUserId === userId && (
            <div className="message-status">
              {Object.keys(msg.seenBy || {}).length > 1 ? '✓✓' : '✓'}
            </div>
          )}
        </div>
      </div>
    ));
  };

  // FIXED: Render function for typing indicators
  const renderTypingIndicators = () => {
    const typingUsersList = Object.entries(typingUsers)
      .filter(([id, isTyping]) => isTyping && id !== socket.id)
      .map(([id]) => {
        const user = onlineUsers.find(u => u.id === id);
        return user ? user.name : 'Someone';
      });
    
    if (typingUsersList.length === 0) return null;
    
    return (
      <div className="typing-indicator">
        {typingUsersList.join(', ')} {typingUsersList.length === 1 ? 'is' : 'are'} typing...
      </div>
    );
  };

  // FIXED: Main render logic
  if (uiState === 'home') {
    return (
      <div className="app">
        <div className="home-container">
          <div className="header">
            <h1>Chat App</h1>
            <p>Welcome, {currentUsername}!</p>
          </div>
          
          {error && <div className="error-message">{error}</div>}
          
          <div className="main-content">
            <div className="forms-section">
              <JoinForm 
                title="Create Room" 
                onAction={createRoom}
                isCreating={true}
                requiresPassword={true}
              />
              <JoinForm 
                title="Join Room" 
                onAction={joinRoom}
                isCreating={false}
                requiresPassword={false}
              />
            </div>
            
            {renderRoomList()}
          </div>
        </div>
        
        {/* Modals */}
        <DeleteConfirmationModal
          roomName={deleteConfirmation}
          onConfirm={confirmDelete}
          onCancel={cancelDelete}
        />
        
        <CreatorDeleteConfirmationModal
          roomName={creatorDeleteConfirmation}
          onConfirm={confirmCreatorDelete}
          onCancel={cancelCreatorDelete}
        />
      </div>
    );
  }

  if (uiState === 'chat') {
    return (
      <div className="app">
        <div className="chat-container">
          <div className={`sidebar ${isSidebarOpen ? 'open' : 'closed'}`}>
            <div className="sidebar-header">
              <h3>Room: {currentRoom}</h3>
              <button 
                className="back-button"
                onClick={() => {
                  socket.emit('leaveChatView', { room: currentRoom });
                  setUiState('home');
                  setCurrentRoom('');
                  roomRef.current = '';
                }}
              >
                ← Back to Home
              </button>
            </div>
            
            <div className="online-users">
              <h4>Online Users ({onlineUsers.length})</h4>
              <ul>
                {onlineUsers.map(user => (
                  <li key={user.id}>
                    <span className="user-name">{user.name}</span>
                    {user.persistentId === userId && <span className="you-badge">(You)</span>}
                  </li>
                ))}
              </ul>
            </div>
            
            <div className="active-viewers">
              <h4>Active Viewers ({activeViewers.length})</h4>
              <p className="viewer-count">{activeViewers.length} viewing chat</p>
            </div>
          </div>
          
          <div className="chat-main">
            <div className="chat-header">
              <button 
                className="sidebar-toggle"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              >
                {isSidebarOpen ? '←' : '→'}
              </button>
              <h2>{currentRoom}</h2>
            </div>
            
            <div className="chat-messages" ref={chatWindowRef}>
              {renderMessages()}
              {renderTypingIndicators()}
            </div>
            
            <div className="chat-input">
              <textarea
                ref={textareaRef}
                value={currentMessage}
                onChange={handleTyping}
                onKeyPress={handleKeyPress}
                placeholder="Type your message..."
                rows="1"
              />
              <button onClick={sendMessage} disabled={!currentMessage.trim()}>
                Send
              </button>
            </div>
          </div>
        </div>
        
        {/* Message Info Modal */}
        <MessageInfoModal
          message={selectedMessage}
          currentUserId={userId}
          onClose={() => setSelectedMessage(null)}
        />
      </div>
    );
  }

  return null;
}

export default App;