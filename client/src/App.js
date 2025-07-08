// client/src/App.js
import React, { useEffect, useState, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

const socket = io('http://localhost:4000');

function App() {
  // State variables...
  const [username, setUsername] = useState('');
  const [room, setRoom] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [currentMessage, setCurrentMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Refs for DOM elements
  const typingTimeoutRef = useRef(null);
  const textareaRef = useRef(null);
  const chatWindowRef = useRef(null);

  // Auto-scroll to the bottom of the chat window when new messages arrive
  useEffect(() => {
    if (chatWindowRef.current) {
      chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle auto-resizing of the textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [currentMessage]);

  const joinRoom = () => {
    if (room !== '') {
      socket.emit('joinRoom', { room, username });
      setShowChat(true);
    }
  };

  const handleTyping = () => {
    const user = { id: socket.id, name: username || `User ${socket.id.substring(0, 5)}` };
    socket.emit('typing', { room, user, isTyping: true });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing', { room, user, isTyping: false });
    }, 2000); // Increased timeout for a better experience
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

  // Handle 'Enter' to send, 'Shift+Enter' for new line
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  useEffect(() => {
    const messageListener = (data) => setMessages((list) => [...list, data]);
    const roomUsersListener = (users) => setOnlineUsers(users);
    const userTypingListener = ({ user, isTyping }) => {
      if (user.id !== socket.id) {
        setTypingUsers(prev => ({ ...prev, [user.id]: { isTyping, name: user.name } }));
      }
    };

    socket.on('receiveMessage', messageListener);
    socket.on('roomUsers', roomUsersListener);
    socket.on('userTyping', userTypingListener);

    return () => {
      socket.off('receiveMessage', messageListener);
      socket.off('roomUsers', roomUsersListener);
      socket.off('userTyping', userTypingListener);
    };
  }, []);

  return (
    <div className="App">
      {!showChat ? (
        <div className="joinChatContainer">
          {/* Join Chat UI remains the same */}
          <h3>Join A Chat</h3>
          <input type="text" placeholder="Your Name (Optional)..." onChange={(e) => setUsername(e.target.value)} />
          <input type="text" placeholder="Room Name..." onChange={(e) => setRoom(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && joinRoom()} />
          <button onClick={joinRoom}>Join Room</button>
        </div>
      ) : (
        <div className="chat-container">
          <div className={`users-sidebar ${isSidebarOpen ? 'open' : ''}`}>
            <h4>Online Users</h4>
            <ul>
              {onlineUsers.map(user => (
                <li key={user.id}>
                  {user.name}
                  {user.id === socket.id && ' (You)'}
                  {/* CHANGED: Typing indicator is now here */}
                  {typingUsers[user.id]?.isTyping && (
                    <span className="sidebar-typing-indicator">...typing</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="chat-main">
            <div className="chat-header">
              <button className="sidebar-toggle" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>☰</button>
              <p>Live Chat: Room {room}</p>
            </div>
            {/* Added a ref for auto-scrolling */}
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
            {/* REMOVED: Old typing indicator div is gone from here */}
            <form className="chat-form" onSubmit={(e) => { e.preventDefault(); sendMessage(); }}>
              {/* CHANGED: Input is now a textarea with new handlers */}
              <textarea
                ref={textareaRef}
                className="chat-input"
                value={currentMessage}
                placeholder="Type a message..."
                onChange={(e) => {
                  setCurrentMessage(e.target.value);
                  handleTyping();
                }}
                onKeyDown={handleKeyDown}
                rows={1}
              />
              <button type="submit" className="send-button">Send</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;