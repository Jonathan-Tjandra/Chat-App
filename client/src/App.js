import React, { useEffect, useState, useRef,  useCallback, useMemo } from 'react';
import io from 'socket.io-client';
import './App.css';

const socket = io('http://localhost:4000');

const getOrCreateUserId = () => {
  let userId = localStorage.getItem('chatAppUserId');
  if (!userId) {
    userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('chatAppUserId', userId);
  }
  return userId;
};

const getFromStorage = (key) => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : null;
  } catch (error) {
    return null;
  }
};

const JoinForm = ({ title, onAction, requiresPassword }) => {
  const [room, setRoom] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const handleSubmit = (e) => {
    e.preventDefault();
    onAction({ room, username, password });
  };
  return (
    <form className="joinChatContainer" onSubmit={handleSubmit}>
      <h3>{title}</h3>
      <input type="text" placeholder="Your Name..." value={username} onChange={(e) => setUsername(e.target.value)} required />
      <input type="text" placeholder="Room Name..." value={room} onChange={(e) => setRoom(e.target.value)} required />
      {requiresPassword && (
        <input type="password" placeholder="Room Password..." value={password} onChange={(e) => setPassword(e.target.value)} />
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

function App() {
  const [userId] = useState(getOrCreateUserId());
  const [uiState, setUiState] = useState('home');
  const [joinedRooms, setJoinedRooms] = useState(() => getFromStorage('joinedRooms') || {});
  const [error, setError] = useState('');
  const [messages, setMessages] = useState({});
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [currentRoom, setCurrentRoom] = useState('');
  const [currentUsername, setCurrentUsername] = useState('');
  const [currentMessage, setCurrentMessage] = useState('');
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [lastReadTimestamps, setLastReadTimestamps] = useState(() => getFromStorage('lastReadTimestamps') || {});

  const roomRef = useRef(currentRoom);
  const usernameRef = useRef(currentUsername);
  const textareaRef = useRef(null);
  const chatWindowRef = useRef(null);
  const observer = useRef(null);
  const typingTimeoutRef = useRef(null);

  const unreadCounts = useMemo(() => {
    return Object.keys(joinedRooms).reduce((acc, room) => {
      const roomMessages = messages[room] || [];
      const lastRead = lastReadTimestamps[room] || 0;
      acc[room] = roomMessages.filter(msg => msg.timestamp > lastRead && msg.authorUserId !== userId).length;
      return acc;
    }, {});
  }, [messages, joinedRooms, userId, lastReadTimestamps]);

  useEffect(() => {
    // This single, stable useEffect handles all socket events correctly.
    socket.on('roomError', (data) => setError(data.message));
    socket.on('joinSuccess', (userList) => {
      setJoinedRooms(prev => {
        const newJoinedRooms = { ...prev, [roomRef.current]: { username: usernameRef.current } };
        localStorage.setItem('joinedRooms', JSON.stringify(newJoinedRooms));
        return newJoinedRooms;
      });
      setOnlineUsers(userList);
      setUiState('chat');
      setError('');
    });
    socket.on('receiveMessage', (data) => {
      setMessages(prev => ({ ...prev, [data.room]: [...(prev[data.room] || []), data] }));
    });
    socket.on('roomUsers', (userList) => setOnlineUsers(userList));
    socket.on('userTyping', ({ user, isTyping }) => {
      if (user.id !== socket.id) {
        setTypingUsers(prev => ({ ...prev, [user.id]: { isTyping, name: user.name } }));
      }
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
    return () => {
      socket.off('roomError');
      socket.off('joinSuccess');
      socket.off('roomUsers');
      socket.off('receiveMessage');
      socket.off('userTyping');
      socket.off('updateMessageStatus');
      socket.off('loadHistory');
    };
  }, []); // An empty dependency array makes these listeners permanent and stable.

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
    observer.current = new IntersectionObserver(handleIntersection, { threshold: 1.0 });
    return () => observer.current.disconnect();
  }, [userId]);

  const messageRef = useCallback(node => {
    if (node && observer.current) {
      observer.current.observe(node);
    }
  }, []);

  const goHome = () => {
    if (currentRoom) {
      socket.emit('leaveRoom', currentRoom);
      const newTimestamps = { ...lastReadTimestamps, [currentRoom]: Date.now() };
      setLastReadTimestamps(newTimestamps);
      localStorage.setItem('lastReadTimestamps', JSON.stringify(newTimestamps));
    }
    setCurrentRoom('');
    setCurrentUsername('');
    setOnlineUsers([]);
    setUiState('home');
    setError('');
  };

  const updateSession = (data) => {
    roomRef.current = data.room;
    usernameRef.current = data.username;
    setCurrentRoom(data.room);
    setCurrentUsername(data.username);
  };

  const handleCreateRoom = (data) => {
    updateSession(data);
    socket.emit('createRoom', { ...data, userId });
  };
  
  const handleJoinRoom = (data) => {
    updateSession(data);
    socket.emit('joinRoom', { ...data, userId });
  };
  
  const rejoinRoom = (roomName) => {
    const roomData = joinedRooms[roomName];
    if (roomData) {
      handleJoinRoom({ room: roomName, username: roomData.username, password: '' });
    }
  };

  const handleTyping = () => {
    const user = { id: socket.id, name: currentUsername || `User ${socket.id.substring(0, 5)}` };
    socket.emit('typing', { room: currentRoom, user, isTyping: true });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing', { room: currentRoom, user, isTyping: false });
    }, 2000);
  };

  const sendMessage = async () => {
    if (currentMessage.trim() !== '') {
      const messageData = {
        id: `${socket.id}-${Date.now()}`,
        room: currentRoom,
        authorId: socket.id,
        authorUserId: userId,
        authorName: currentUsername || `User ${socket.id.substring(0, 5)}`,
        message: currentMessage.trim(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: Date.now(),
        seenBy: { [userId]: { name: currentUsername || 'You', seenAt: new Date() } }
      };
      // FIX: The server now broadcasts back to the sender, so we no longer add the message locally here.
      // This prevents the duplication bug.
      await socket.emit('sendMessage', messageData);
      setCurrentMessage('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const renderUI = () => {
    switch (uiState) {
      case 'create':
        return ( <div> <JoinForm title="Create Room" onAction={handleCreateRoom} requiresPassword={true} /> <button className="back-button" onClick={goHome}>Back</button> {error && <p className="error-message">{error}</p>} </div> );
      case 'join':
        return ( <div> <JoinForm title="Join Room" onAction={handleJoinRoom} requiresPassword={true} /> <button className="back-button" onClick={goHome}>Back</button> {error && <p className="error-message">{error}</p>} </div> );
      case 'chat':
        return (
          <div className="chat-container">
            <div className={`users-sidebar ${isSidebarOpen ? 'open' : ''}`}>
              <h4>Online Users</h4>
              <ul>
                {onlineUsers.map(user => ( <li key={user.id}> {user.name}{user.id === socket.id && ' (You)'} {typingUsers[user.id]?.isTyping && <span className="sidebar-typing-indicator">...typing</span>} </li> ))}
              </ul>
            </div>
            <div className="chat-main">
              <div className="chat-header">
                <button className="sidebar-toggle" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>☰</button>
                <p>Room: {currentRoom}</p>
                <button className="home-button" onClick={goHome}>Back to Home</button>
              </div>
              <div className="chat-window" ref={chatWindowRef}>
                {(messages[currentRoom] || []).map((msg) => (
                  <div key={msg.id} className="message" id={msg.authorUserId === userId ? 'you' : 'other'} ref={msg.authorUserId !== userId ? messageRef : null} data-message-id={msg.id} data-author-id={msg.authorId} data-room={msg.room} >
                    <div className="message-bubble" onClick={() => setSelectedMessage(msg)}>
                      <p className="message-author">{msg.authorUserId !== userId && msg.authorName}</p>
                      <p className="message-text">{msg.message}</p>
                      <p className="message-time">{msg.time}</p>
                    </div>
                  </div>
                ))}
              </div>
              <form className="chat-form" onSubmit={(e) => { e.preventDefault(); sendMessage(); }}>
                <textarea ref={textareaRef} className="chat-input" value={currentMessage} placeholder="Type a message..." onChange={(e) => {setCurrentMessage(e.target.value); handleTyping();}} onKeyDown={handleKeyDown} rows={1} />
                <button type="submit" className="send-button">Send</button>
              </form>
            </div>
          </div>
        );
      default: // 'home' state
        return (
          <div className="home-container">
            <div className="home-header">
              <h2>Your Rooms</h2>
              <div className="actions">
                <button onClick={() => { setUiState('create'); setError(''); }}>Create Room</button>
                <button onClick={() => { setUiState('join'); setError(''); }}>Join New Room</button>
              </div>
            </div>
            <div className="room-list">
              {Object.keys(joinedRooms).length === 0 ? ( <p>You haven't joined any rooms yet.</p> ) : (
                Object.keys(joinedRooms).map(roomName => (
                  <div key={roomName} className="room-item" onClick={() => rejoinRoom(roomName)}>
                    <div className="room-item-details">
                      <h4>{roomName}</h4>
                      <p>Joined as: {joinedRooms[roomName].username}</p>
                    </div>
                    {unreadCounts[roomName] > 0 && (
                      <div className="unread-badge">
                        {unreadCounts[roomName] > 9 ? '9+' : unreadCounts[roomName]}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        );
    }
  };

  return (
    <div className="App">
      {renderUI()}
      <MessageInfoModal 
        message={selectedMessage} 
        currentUserId={userId} 
        onClose={() => setSelectedMessage(null)} 
      />
    </div>
  );
}

export default App;