// client/src/App.js
import React, { useEffect, useState, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

const socket = io('http://localhost:4000');

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
  const [uiState, setUiState] = useState('initial'); // 'initial', 'create', 'join', 'chat'
  const [error, setError] = useState('');
  const [currentMessage, setCurrentMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  // Keep room and username state here to persist across UI changes
  const [room, setRoom] = useState('');
  const [username, setUsername] = useState('');

  const textareaRef = useRef(null);
  const chatWindowRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    // --- Socket Event Listeners ---
    socket.on('roomError', (data) => {
      setError(data.message);
      // If the error indicates a password is needed, we could potentially switch UI state here
      // but for now, just showing the error is fine.
    });

    socket.on('joinSuccess', (userList) => {
      console.log('Successfully joined room. Users:', userList);
      setOnlineUsers(userList);
      setUiState('chat'); // Switch to chat view on success
      setError(''); // Clear any previous errors
    });

    socket.on('roomUsers', (userList) => setOnlineUsers(userList));
    socket.on('receiveMessage', (data) => setMessages((list) => [...list, data]));
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
  }, []);

  useEffect(() => {
    if (chatWindowRef.current) chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [currentMessage]);

  const handleCreateRoom = (data) => {
    setRoom(data.room);
    setUsername(data.username);
    socket.emit('createRoom', data);
  };

  const handleJoinRoom = (data) => {
    setRoom(data.room);
    setUsername(data.username);
    socket.emit('joinRoom', data);
  };
  
  const handleTyping = () => {
    const user = { id: socket.id, name: username || `User ${socket.id.substring(0, 5)}` };
    socket.emit('typing', { room, user, isTyping: true });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing', { room, user, isTyping: false });
    }, 2000);
  };

  const sendMessage = async () => {
    if (currentMessage.trim() !== '') {
      const messageData = {
        room,
        authorId: socket.id,
        authorName: username || `User ${socket.id.substring(0, 5)}`,
        message: currentMessage.trim(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      await socket.emit('sendMessage', messageData);
      setCurrentMessage('');
      const user = { id: socket.id, name: username };
      socket.emit('typing', { room, user, isTyping: false });
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const renderUI = () => {
    switch (uiState) {
      case 'create':
        return (
          <div>
            <JoinForm title="Create Room" onAction={handleCreateRoom} requiresPassword={true} />
            <button className="back-button" onClick={() => { setUiState('initial'); setError(''); }}>Back</button>
            {error && <p className="error-message">{error}</p>}
          </div>
        );
      case 'join':
        return (
          <div>
            <JoinForm title="Join Room" onAction={handleJoinRoom} requiresPassword={true} />
            <button className="back-button" onClick={() => { setUiState('initial'); setError(''); }}>Back</button>
            {error && <p className="error-message">{error}</p>}
          </div>
        );
      case 'chat':
        return (
          <div className="chat-container">
            <div className={`users-sidebar ${isSidebarOpen ? 'open' : ''}`}>
              <h4>Online Users</h4>
              <ul>
                {onlineUsers.map(user => (
                  <li key={user.id}>
                    {user.name}{user.id === socket.id && ' (You)'}
                    {typingUsers[user.id]?.isTyping && <span className="sidebar-typing-indicator">...typing</span>}
                  </li>
                ))}
              </ul>
            </div>
            <div className="chat-main">
              <div className="chat-header">
                <button className="sidebar-toggle" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>☰</button>
                <p>Room: {room}</p>
              </div>
              <div className="chat-window" ref={chatWindowRef}>
                {messages.map((msg, index) => (
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
      default: // 'initial' state
        return (
          <div className="initial-screen">
            <h2>Welcome to the Chat!</h2>
            <div className="initial-buttons">
              <button onClick={() => setUiState('create')}>Create a Room</button>
              <button onClick={() => setUiState('join')}>Join a Room</button>
            </div>
          </div>
        );
    }
  };

  return <div className="App">{renderUI()}</div>;
}

export default App;