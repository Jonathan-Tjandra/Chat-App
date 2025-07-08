import React, { useEffect, useState, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

const socket = io('http://localhost:4000');

// FIX: Added the missing helper function definitions at the top
const getOrCreateUserId = () => {
  let userId = localStorage.getItem('chatAppUserId');
  if (!userId) {
    userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('chatAppUserId', userId);
  }
  return userId;
};

const getJoinedRoomsFromStorage = () => {
  try {
    const rooms = localStorage.getItem('joinedRooms');
    return rooms ? JSON.parse(rooms) : {};
  } catch (error) {
    console.error("Could not parse joinedRooms from localStorage", error);
    return {};
  }
};

// --- Reusable Join Form Component ---
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


// --- Main App Component ---
function App() {
  const [userId] = useState(getOrCreateUserId());
  const [uiState, setUiState] = useState('home');
  const [joinedRooms, setJoinedRooms] = useState(getJoinedRoomsFromStorage());
  const [error, setError] = useState('');
  
  const [messages, setMessages] = useState({});
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  const [currentRoom, setCurrentRoom] = useState('');
  const [currentUsername, setCurrentUsername] = useState('');
  const [currentMessage, setCurrentMessage] = useState('');
  const [joiningRoomData, setJoiningRoomData] = useState(null);

  const roomRef = useRef(currentRoom);
  const usernameRef = useRef(currentUsername);

  const textareaRef = useRef(null);
  const chatWindowRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {

    socket.on('roomError', (data) => {
      setError(data.message);
    });

    socket.on('joinSuccess', (userList) => {
      const newJoinedRooms = { ...joinedRooms, [roomRef.current]: { username: usernameRef.current } };
      localStorage.setItem('joinedRooms', JSON.stringify(newJoinedRooms));
      setJoinedRooms(newJoinedRooms);
      
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

    return () => {
      socket.off('roomError');
      socket.off('joinSuccess');
      socket.off('roomUsers');
      socket.off('receiveMessage');
      socket.off('userTyping');
    };
  }, [joinedRooms]);

  useEffect(() => {
    if (chatWindowRef.current) {
      chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
    }
  }, [messages[currentRoom]]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [currentMessage]);

  const goHome = () => {
    if (currentRoom) {
      socket.emit('leaveRoom', currentRoom);
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
      const data = { room: roomName, username: roomData.username, password: '' };
      handleJoinRoom(data);
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
        room: currentRoom,
        authorId: socket.id,
        authorName: currentUsername || `User ${socket.id.substring(0, 5)}`,
        message: currentMessage.trim(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      await socket.emit('sendMessage', messageData);
      setCurrentMessage('');
      const user = { id: socket.id, name: currentUsername };
      socket.emit('typing', { room: currentRoom, user, isTyping: false });
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
                {(messages[currentRoom] || []).map((msg, index) => (
                  <div key={index} className="message" id={socket.id === msg.authorId ? 'you' : 'other'}>
                    <div className="message-bubble">
                      <p className="message-author">{socket.id !== msg.authorId && msg.authorName}</p>
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
                    <h4>{roomName}</h4>
                    <p>Joined as: {joinedRooms[roomName].username}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        );
    }
  };

  return <div className="App">{renderUI()}</div>;
}

export default App;