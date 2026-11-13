document.addEventListener('DOMContentLoaded', function () {
  // מצב האפליקציה
  let currentIdentifier = '';
  let currentCode = '';
  let currentSessionToken = localStorage.getItem('stips_session_token') || '';
  let verifiedUser = null;

  // אלמנטים - אימות
  const verificationSection = document.getElementById('verification-section');
  const generateForm        = document.getElementById('generate-code-form');
  const usernameInput       = document.getElementById('username-input');
  const generateBtn         = document.getElementById('generate-btn');
  const codeSection         = document.getElementById('code-section');
  const displayCode         = document.getElementById('display-code');
  const stipsProfileLink    = document.getElementById('stips-profile-link');
  const verifyBtn           = document.getElementById('verify-btn');
  const statusMsg           = document.getElementById('status-msg');

  // אלמנטים - לוח הודעות
  const boardSection        = document.getElementById('board-section');
  const loggedUserName      = document.getElementById('logged-user-name');
  const loggedUserAvatar    = document.getElementById('logged-user-avatar');
  const loggedUserBio       = document.getElementById('logged-user-bio');
  const logoutBtn           = document.getElementById('logout-btn');
  const messagesList        = document.getElementById('messages-list');
  const refreshMessagesBtn  = document.getElementById('refresh-messages-btn');
  const messageForm         = document.getElementById('message-form');
  const messageInput        = document.getElementById('message-input');
  const messageStatus       = document.getElementById('message-status');

  // --- כניסה אוטומטית ---
  async function checkPersistentLogin() {
    if (!currentSessionToken) {
      showVerification();
      return;
    }
    try {
      const res = await fetch('/api/me', {
        headers: { 'Authorization': 'Bearer ' + currentSessionToken }
      });
      const data = await res.json();
      if (res.ok && data.success && data.user) {
        verifiedUser = data.user;
        showBoard(verifiedUser);
      } else {
        clearSession();
        showVerification();
      }
    } catch (e) {
      showVerification();
    }
  }

  function clearSession() {
    currentSessionToken = '';
    verifiedUser = null;
    localStorage.removeItem('stips_session_token');
    localStorage.removeItem('stips_verified_user');
  }

  function showBoard(user) {
    verificationSection.hidden = true;
    boardSection.hidden = false;
    loggedUserName.textContent  = user.username || user.id;
    loggedUserAvatar.src        = user.profilePic || 'https://stips.co.il/images/default-avatar.png';
    loggedUserAvatar.onerror    = function() { this.src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.username || 'U') + '&background=667eea&color=fff'; };
    loggedUserBio.textContent   = 'מזהה סטיפס: ' + (user.id || '');
    loadMessages();
  }

  function showVerification() {
    boardSection.hidden = true;
    verificationSection.hidden = false;
    currentIdentifier = '';
    currentCode = '';
    usernameInput.value = '';
    codeSection.hidden = true;
    setStatus('', '');
  }

  function setStatus(msg, type) {
    statusMsg.textContent = msg;
    statusMsg.className = type || '';
  }

  // --- יצירת קוד אימות ---
  generateForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const inputVal = usernameInput.value.trim();
    if (!inputVal) return;

    generateBtn.disabled = true;
    generateBtn.textContent = 'יוצר קוד...';
    setStatus('', '');

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (currentSessionToken) headers['Authorization'] = 'Bearer ' + currentSessionToken;

      const res  = await fetch('/api/generate-code', {
        method: 'POST',
        headers,
        body: JSON.stringify({ stipsUsername: inputVal })
      });
      const data = await res.json();

      if (!res.ok || !data.success) throw new Error(data.error || 'שגיאה ביצירת הקוד');

      currentIdentifier = data.identifier || inputVal;
      currentCode       = data.verificationCode;

      displayCode.textContent    = currentCode;
      stipsProfileLink.href      = data.profileUrl || `https://stips.co.il/profile/${encodeURIComponent(currentIdentifier)}`;
      stipsProfileLink.textContent = 'לחץ לפתיחת הפרופיל שלך';

      codeSection.hidden = false;
      setStatus('הקוד נוצר! הדבק אותו בביו שלך בסטיפס ולחץ "אמת פרופיל".', 'success');
    } catch (err) {
      setStatus('שגיאה: ' + err.message, 'error');
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = 'קבל קוד';
    }
  });

  // --- אימות פרופיל ---
  verifyBtn.addEventListener('click', async function () {
    if (!currentIdentifier || !currentCode) {
      setStatus('אנא הכנס מזהה סטיפס ויצור קוד תחילה.', 'error');
      return;
    }

    verifyBtn.disabled = true;
    verifyBtn.textContent = 'מאמת...';
    setStatus('בודק את הפרופיל שלך בסטיפס... אנא המתן.', '');

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (currentSessionToken) headers['Authorization'] = 'Bearer ' + currentSessionToken;

      const res  = await fetch('/api/verify-stips', {
        method: 'POST',
        headers,
        body: JSON.stringify({ stipsUsername: currentIdentifier, verificationCode: currentCode })
      });
      const data = await res.json();

      if (!res.ok || !data.success) throw new Error(data.error || 'האימות נכשל');

      if (data.sessionToken) {
        currentSessionToken = data.sessionToken;
        localStorage.setItem('stips_session_token', currentSessionToken);
      }

      verifiedUser = data.user;
      localStorage.setItem('stips_verified_user', JSON.stringify(verifiedUser));

      setStatus('האימות הצליח! עובר ללוח ההודעות...', 'success');
      setTimeout(() => showBoard(verifiedUser), 500);

    } catch (err) {
      setStatus('האימות נכשל: ' + err.message, 'error');
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = '✅ אמת פרופיל';
    }
  });

  // --- התנתקות ---
  logoutBtn.addEventListener('click', async function () {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + currentSessionToken },
        body: JSON.stringify({ sessionToken: currentSessionToken })
      });
    } catch (e) {}
    clearSession();
    showVerification();
  });

  // --- טעינת הודעות ---
  async function loadMessages() {
    refreshMessagesBtn.disabled = true;
    refreshMessagesBtn.textContent = 'טוען...';
    messageStatus.textContent = '';

    try {
      const res  = await fetch('/api/messages');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'שגיאה בטעינת הודעות');
      renderMessages(data.messages || []);
    } catch (err) {
      messageStatus.textContent = 'שגיאה בטעינת הודעות: ' + err.message;
    } finally {
      refreshMessagesBtn.disabled = false;
      refreshMessagesBtn.textContent = 'רענן';
    }
  }

  function renderMessages(messages) {
    messagesList.innerHTML = '';

    if (!messages || messages.length === 0) {
      messagesList.innerHTML = '<div class="empty-msg">עדיין אין הודעות. היה הראשון לכתוב! 🎉</div>';
      return;
    }

    // הצג מהחדש לישן
    [...messages].reverse().forEach(function (msg) {
      const item = document.createElement('div');
      item.className = 'message-item';

      const avatarSrc = msg.profilePic || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(msg.username || 'U') + '&background=667eea&color=fff&size=36');
      const timeStr   = msg.timestamp ? new Date(msg.timestamp).toLocaleString('he-IL') : '';

      item.innerHTML = `
        <img src="${escHtml(avatarSrc)}" alt="${escHtml(msg.username)}" onerror="this.src='https://ui-avatars.com/api/?name=U&background=667eea&color=fff&size=36'">
        <div class="msg-body">
          <div class="msg-name">${escHtml(msg.username || 'אנונימי')}</div>
          <div class="msg-time">${escHtml(timeStr)}</div>
          <div class="msg-text">${escHtml(msg.text)}</div>
        </div>`;

      messagesList.appendChild(item);
    });
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  refreshMessagesBtn.addEventListener('click', loadMessages);

  // --- שליחת הודעה ---
  messageForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    if (!currentSessionToken || !verifiedUser) {
      messageStatus.textContent = 'אין חיבור פעיל. אנא אמת מחדש את הפרופיל שלך.';
      return;
    }

    const text    = messageInput.value.trim();
    if (!text) return;

    const sendBtn = document.getElementById('send-btn');
    sendBtn.disabled = true;
    sendBtn.textContent = 'שולח...';
    messageStatus.textContent = '';

    try {
      const res  = await fetch('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + currentSessionToken
        },
        body: JSON.stringify({ text })
      });

      const data = await res.json();

      // סשן פג תוקף
      if (res.status === 401 || res.status === 403 || data.expired) {
        clearSession();
        showVerification();
        setStatus('הסשן פג תוקף. אנא אמת שוב את הפרופיל שלך.', 'error');
        return;
      }

      if (!res.ok || !data.success) throw new Error(data.error || 'שגיאה בשליחת ההודעה');

      messageInput.value = '';
      messageStatus.textContent = '✅ ההודעה נשלחה!';
      setTimeout(() => { messageStatus.textContent = ''; }, 2000);

      if (data.messages) {
        renderMessages(data.messages);
      } else {
        loadMessages();
      }
    } catch (err) {
      messageStatus.textContent = 'שגיאה: ' + err.message;
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'שלח';
    }
  });

  // הפעלה
  checkPersistentLogin();
});
