// client/src/App.js
import React, { useEffect, useState, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

const socket = io('http://localhost:4000');

function App() {
  const [room, setRoom] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [currentMessage, setCurrentMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  
  const typingTimeoutRef = useRef(null);

  const joinRoom = () => {
    if (room !== '') {
      socket.emit('joinRoom', room);
      setShowChat(true);
    }
  };

  const handleTyping = () => {
    socket.emit('typing', { room, isTyping: true });
    
    // Clear previous timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    // Set a new timeout to emit 'stop typing' event
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing', { room, isTyping: false });
    }, 1000); // 1 second timeout
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (currentMessage !== '') {
      const messageData = {
        room,
        authorId: socket.id,
        message: currentMessage,
        time: new Date(Date.now()).toLocaleTimeString(),
      };
      await socket.emit('sendMessage', messageData);
      setMessages((list) => [...list, messageData]);
      setCurrentMessage('');
      socket.emit('typing', { room, isTyping: false }); // Ensure typing indicator stops after sending
    }
  };

  useEffect(() => {
    const messageListener = (data) => setMessages((list) => [...list, data]);
    const roomUsersListener = (users) => setOnlineUsers(users);
    const userTypingListener = ({ userId, isTyping }) => {
      setTypingUsers(prev => ({ ...prev, [userId]: isTyping }));
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
  
  const typingDisplay = Object.entries(typingUsers)
    .filter(([userId, isTyping]) => isTyping && userId !== socket.id)
    .map(([userId]) => `User ${userId.substring(0, 5)}`)
    .join(', ');

  return (
    <div className="App">
      {!showChat ? (
        <div className="joinChatContainer">
          <h3>Join A Chat</h3>
          <input
            type="text"
            placeholder="Room Name..."
            onChange={(e) => setRoom(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && joinRoom()}
          />
          <button onClick={joinRoom}>Join Room</button>
        </div>
      ) : (
        <div className="chat-container">
          <div className="users-sidebar">
            <h4>Online Users</h4>
            <ul>
              {onlineUsers.map(id => (
                <li key={id}>
                  {`User ${id.substring(0, 5)}`}
                  {id === socket.id && ' (You)'}
                </li>
              ))}
            </ul>
          </div>
          <div className="chat-main">
            <div className="chat-header"><p>Live Chat: Room {room}</p></div>
            <div className="chat-window">
                {messages.map((msg, index) => (
                  <div key={index} className="message" id={socket.id === msg.authorId ? 'you' : 'other'}>
                    <div className="message-bubble">
                      <p className="message-author">{socket.id !== msg.authorId && `User ${msg.authorId.substring(0, 5)}`}</p>
                      <p className="message-text">{msg.message}</p>
                      <p className="message-time">{msg.time}</p>
                    </div>
                  </div>
                ))}
            </div>
             <div className="typing-indicator">
              {typingDisplay && `${typingDisplay} is typing...`}
            </div>
            <form className="chat-form" onSubmit={sendMessage}>
              <input
                type="text"
                className="chat-input"
                value={currentMessage}
                placeholder="Type a message..."
                onChange={(e) => {
                  setCurrentMessage(e.target.value);
                  handleTyping();
                }}
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