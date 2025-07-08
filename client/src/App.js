// client/src/App.js
import React, { useEffect, useState, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

const socket = io('http://localhost:4000');

// --- Helper function to get rooms from localStorage ---
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
      {/* FIXED: Corrected e.targe.value to e.target.value */}
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
  // FIXED: Default state is 'home'
  const [uiState, setUiState] = useState('home'); 
  const [joinedRooms, setJoinedRooms] = useState(getJoinedRoomsFromStorage());
  const [error, setError] = useState('');
  
  // FIXED: Messages state is an object {}
  const [messages, setMessages] = useState({});
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  // Current session state
  const [currentRoom, setCurrentRoom] = useState('');
  const [currentUsername, setCurrentUsername] = useState('');
  const [currentMessage, setCurrentMessage] = useState('');

  const usernameRef = useRef(currentUsername);
  const roomRef = useRef(currentRoom);

  // Refs
  const textareaRef = useRef(null);
  const chatWindowRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const [joiningRoomData, setJoiningRoomData] = useState(null);

  useEffect(() => {
    // This listener now intelligently handles password requests from the server
    socket.on('roomError', (data) => {
      if (data.needsPassword) {
        setUiState('password_prompt');
        setError(data.message); // Show "Incorrect password" or similar message
      } else {
        setError(data.message);
      }
    });

    socket.on('joinSuccess', (userList) => {
      // Logic to save the room to localStorage
      const newJoinedRooms = { ...joinedRooms, [roomRef.current]: { username: usernameRef.current } };
      localStorage.setItem('joinedRooms', JSON.stringify(newJoinedRooms));
      setJoinedRooms(newJoinedRooms);
      
      // Update state and switch to the chat view
      setOnlineUsers(userList);
      setUiState('chat');
      setError('');
    });
    
    socket.on('receiveMessage', (data) => {
      setMessages(prev => ({
        ...prev,
        [data.room]: [...(prev[data.room] || []), data]
      }));
    });

    socket.on('roomUsers', (userList) => setOnlineUsers(userList));

    socket.on('userTyping', ({ user, isTyping }) => {
      if (user.id !== socket.id) {
        setTypingUsers(prev => ({ ...prev, [user.id]: { isTyping, name: user.name } }));
      }
    });

    // Cleanup function to prevent memory leaks
    return () => {
      socket.off('roomError');
      socket.off('joinSuccess');
      socket.off('roomUsers');
      socket.off('receiveMessage');
      socket.off('userTyping');
    };
  }, [joinedRooms, currentRoom, currentUsername]);

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
    // Reset the current session, but PRESERVE the messages state
    setCurrentRoom('');
    setCurrentUsername('');
    setOnlineUsers([]);
    
    setUiState('home');
    setError('');
  };

    const handleCreateRoom = (data) => {
    // Update refs for the listeners
    roomRef.current = data.room;
    usernameRef.current = data.username;
    // Update state for the UI
    setCurrentRoom(data.room);
    setCurrentUsername(data.username);
    socket.emit('createRoom', data);
  };
  
  const handleJoinRoom = (data) => {
    // Update refs for the listeners
    roomRef.current = data.room;
    usernameRef.current = data.username;
    // Update state for the UI
    setCurrentRoom(data.room);
    setCurrentUsername(data.username);
    socket.emit('joinRoom', data);
  };
  
  const rejoinRoom = (roomName) => {
    const roomData = joinedRooms[roomName];
    if (roomData) {
      // Set the data for the room we're trying to join
      const data = { room: roomName, username: roomData.username, password: '' };
      setJoiningRoomData(data);
      // Attempt to join. The server will tell us if a password is now needed.
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const renderUI = () => {
    switch (uiState) {
      case 'create':
        return ( <div> <JoinForm title="Create Room" onAction={handleCreateRoom} requiresPassword={true} /> <button className="back-button" onClick={goHome}>Back</button> {error && <p className="error-message">{error}</p>} </div> );
      case 'join':
        return ( <div> <JoinForm title="Join Room" onAction={handleJoinRoom} requiresPassword={true} /> <button className="back-button" onClick={goHome}>Back</button> {error && <p className="error-message">{error}</p>} </div> );
      
      // NEW: This case handles the UI for when a password is required to rejoin a room
      case 'password_prompt':
        return (
          <div className="password-prompt-container">
            <h3>Password Required</h3>
            <p>The room "{joiningRoomData?.room}" requires a password.</p>
            <form 
              className="joinChatContainer" 
              onSubmit={(e) => {
                e.preventDefault();
                const password = e.target.password.value;
                // Resubmit the join request, this time with the password
                handleJoinRoom({ ...joiningRoomData, password });
              }}
            >
              <input name="password" type="password" placeholder="Room Password..." required autoFocus />
              <button type="submit">Enter Room</button>
            </form>
            <button className="back-button" onClick={goHome}>Back to Home</button>
            {error && <p className="error-message">{error}</p>}
          </div>
        );

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
              {Object.keys(joinedRooms).length === 0 ? (
                <p>You haven't joined any rooms yet.</p>
              ) : (
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