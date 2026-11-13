document.addEventListener('DOMContentLoaded', function () {
  // Application State
  let currentIdentifier = '';
  let currentCode = '';
  let currentSessionToken = localStorage.getItem('stips_session_token') || '';
  let verifiedUser = null;

  // DOM Elements - Verification Section
  const verificationSection = document.getElementById('verification-section');
  const generateForm = document.getElementById('generate-code-form');
  const usernameInput = document.getElementById('username-input');
  const generateBtn = document.getElementById('generate-btn');
  const codeSection = document.getElementById('code-section');
  const displayCode = document.getElementById('display-code');
  const stipsProfileLink = document.getElementById('stips-profile-link');
  const verifyBtn = document.getElementById('verify-btn');
  const verificationStatus = document.getElementById('verification-status');

  // DOM Elements - Message Board Section
  const boardSection = document.getElementById('board-section');
  const loggedUserName = document.getElementById('logged-user-name');
  const loggedUserAvatar = document.getElementById('logged-user-avatar');
  const loggedUserBio = document.getElementById('logged-user-bio');
  const logoutBtn = document.getElementById('logout-btn');
  const messagesList = document.getElementById('messages-list');
  const refreshMessagesBtn = document.getElementById('refresh-messages-btn');
  const messageForm = document.getElementById('message-form');
  const messageInput = document.getElementById('message-input');
  const messageStatus = document.getElementById('message-status');

  // 1. Persistent Login (Auto-Login):
  // Check if session token exists in localStorage on page load
  async function checkPersistentLogin() {
    if (!currentSessionToken) {
      // No token stored; ensure verification screen is displayed
      verificationSection.hidden = false;
      boardSection.hidden = true;
      return;
    }

    try {
      // Validate session token with backend GET /api/me
      const response = await fetch('/api/me', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + currentSessionToken
        }
      });

      const data = await response.json();

      if (response.ok && data.success && data.user) {
        // Valid session: skip verification and load message board directly
        verifiedUser = data.user;
        localStorage.setItem('stips_verified_user', JSON.stringify(verifiedUser));
        switchToBoard(verifiedUser);
      } else {
        // Token invalid or expired: clear storage and show verification screen
        clearSessionStorage();
        verificationSection.hidden = false;
        boardSection.hidden = true;
      }
    } catch (err) {
      console.warn('Auto-login check failed:', err.message);
      verificationSection.hidden = false;
      boardSection.hidden = true;
    }
  }

  // Clear local storage and state
  function clearSessionStorage() {
    currentSessionToken = '';
    verifiedUser = null;
    localStorage.removeItem('stips_session_token');
    localStorage.removeItem('stips_verified_user');
  }

  // Switch View to Message Board (skip verification screen)
  function switchToBoard(user) {
    verificationSection.hidden = true;
    boardSection.hidden = false;

    loggedUserName.textContent = user.username || user.id;
    loggedUserAvatar.src = user.profilePic || 'https://stips.co.il/images/default-avatar.png';
    loggedUserBio.textContent = user.id ? 'Stips ID: ' + user.id : '';

    loadMessages();
  }

  // Switch View to Verification Screen
  function switchToVerification() {
    boardSection.hidden = true;
    verificationSection.hidden = false;
    currentIdentifier = '';
    currentCode = '';
    usernameInput.value = '';
    codeSection.hidden = true;
    verificationStatus.textContent = '';
  }

  // 2. Handle Generate Verification Code
  generateForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const inputVal = usernameInput.value.trim();
    if (!inputVal) return;

    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating code...';
    verificationStatus.textContent = '';

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (currentSessionToken) {
        headers['Authorization'] = 'Bearer ' + currentSessionToken;
      }

      const response = await fetch('/api/generate-code', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          stipsUsername: inputVal,
          sessionToken: currentSessionToken
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to generate verification code');
      }

      currentIdentifier = data.identifier || inputVal;
      currentCode = data.verificationCode;

      displayCode.textContent = currentCode;
      const profileUrl = data.profileUrl || `https://stips.co.il/profile/${encodeURIComponent(currentIdentifier)}`;
      stipsProfileLink.href = profileUrl;
      stipsProfileLink.textContent = profileUrl;

      codeSection.hidden = false;
      verificationStatus.textContent = `Code generated. Please ensure "${currentCode}" is saved in your Stips bio, then click "Verify Stips Profile".`;
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = 'Generate Verification Code';
    }
  });

  // 3. Handle Verify Stips Profile
  verifyBtn.addEventListener('click', async function () {
    if (!currentIdentifier || !currentCode) {
      alert('Please enter your Stips Profile ID or URL and generate a code first.');
      return;
    }

    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Verifying profile on Stips...';
    verificationStatus.textContent = `Scanning Stips profile for "${currentCode}"... Please wait.`;

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (currentSessionToken) {
        headers['Authorization'] = 'Bearer ' + currentSessionToken;
      }

      const response = await fetch('/api/verify-stips', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          stipsUsername: currentIdentifier,
          verificationCode: currentCode,
          sessionToken: currentSessionToken
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Verification failed');
      }

      // Persist the session token in localStorage for auto-login
      if (data.sessionToken) {
        currentSessionToken = data.sessionToken;
        localStorage.setItem('stips_session_token', currentSessionToken);
      }

      verifiedUser = data.user;
      localStorage.setItem('stips_verified_user', JSON.stringify(verifiedUser));

      verificationStatus.textContent = 'Verification successful! Session token saved. Transitioning to message board...';
      setTimeout(function () {
        switchToBoard(verifiedUser);
      }, 400);

    } catch (err) {
      verificationStatus.textContent = 'Verification Failed: ' + err.message;
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'Verify Stips Profile';
    }
  });

  // 4. Handle Logout: clears token from localStorage and returns to verification
  logoutBtn.addEventListener('click', async function () {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + currentSessionToken
        },
        body: JSON.stringify({ sessionToken: currentSessionToken })
      });
    } catch (e) {
      // Ignore network failures on logout
    }

    clearSessionStorage();
    switchToVerification();
  });

  // 5. Fetch and Render Messages
  async function loadMessages() {
    refreshMessagesBtn.disabled = true;
    refreshMessagesBtn.textContent = 'Refreshing...';
    messageStatus.textContent = 'Loading messages...';

    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fetch' })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch messages');
      }

      renderMessages(data.messages || []);
      messageStatus.textContent = '';
    } catch (err) {
      messageStatus.textContent = 'Error loading messages: ' + err.message;
    } finally {
      refreshMessagesBtn.disabled = false;
      refreshMessagesBtn.textContent = 'Refresh Messages';
    }
  }

  function renderMessages(messages) {
    messagesList.innerHTML = '';

    if (messages.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.textContent = 'No messages posted yet. Be the first to write something!';
      messagesList.appendChild(emptyItem);
      return;
    }

    messages.forEach(function (msg) {
      const li = document.createElement('li');

      if (msg.profilePic) {
        const img = document.createElement('img');
        img.src = msg.profilePic;
        img.alt = msg.username;
        img.width = 30;
        img.height = 30;
        li.appendChild(img);
        li.appendChild(document.createTextNode(' '));
      }

      const strong = document.createElement('strong');
      strong.textContent = msg.username;
      li.appendChild(strong);

      const timeSpan = document.createElement('span');
      const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '';
      timeSpan.textContent = ` (${timeStr}): `;
      li.appendChild(timeSpan);

      const textSpan = document.createElement('span');
      textSpan.textContent = msg.text;
      li.appendChild(textSpan);

      messagesList.appendChild(li);
    });
  }

  refreshMessagesBtn.addEventListener('click', loadMessages);

  // 6. Handle Posting a Message (sends session token)
  messageForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!currentSessionToken || !verifiedUser) {
      alert('You must be verified with an active session token to post a message.');
      return;
    }

    const text = messageInput.value.trim();
    if (!text) return;

    const sendBtn = document.getElementById('send-btn');
    sendBtn.disabled = true;
    sendBtn.textContent = 'Posting...';
    messageStatus.textContent = 'Sending message...';

    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + currentSessionToken
        },
        body: JSON.stringify({
          text: text,
          sessionToken: currentSessionToken
        })
      });

      const data = await response.json();

      if (response.status === 401 || response.status === 403) {
        clearSessionStorage();
        alert('Your session has expired. Please verify your Stips account again.');
        switchToVerification();
        return;
      }

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to send message');
      }

      messageInput.value = '';
      messageStatus.textContent = 'Message posted successfully.';

      if (data.messages) {
        renderMessages(data.messages);
      } else {
        loadMessages();
      }
    } catch (err) {
      messageStatus.textContent = 'Error sending message: ' + err.message;
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Post Message';
    }
  });

  // Run persistent login check immediately on page load
  checkPersistentLogin();
});
