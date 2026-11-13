document.addEventListener('DOMContentLoaded', function () {

  let currentSessionToken = localStorage.getItem('stips_session_token') || '';
  let verifiedUser = null;
  let currentIdentifier = '';
  let currentCode = '';

  // אלמנטים
  const appHeader          = document.getElementById('app-header');
  const headerAvatar       = document.getElementById('header-avatar');
  const headerName         = document.getElementById('header-name');
  const logoutBtn          = document.getElementById('logout-btn');

  const verificationSection = document.getElementById('verification-section');
  const generateForm        = document.getElementById('generate-code-form');
  const usernameInput       = document.getElementById('username-input');
  const generateBtn         = document.getElementById('generate-btn');
  const codeSection         = document.getElementById('code-section');
  const displayCode         = document.getElementById('display-code');
  const stipsProfileLink    = document.getElementById('stips-profile-link');
  const verifyBtn           = document.getElementById('verify-btn');
  const statusMsg           = document.getElementById('status-msg');

  const boardSection        = document.getElementById('board-section');
  const chatMessages        = document.getElementById('chat-messages');
  const emptyMsg            = document.getElementById('empty-msg');
  const messageForm         = document.getElementById('message-form');
  const messageInput        = document.getElementById('message-input');
  const messageStatus       = document.getElementById('message-status');
  const sendBtn             = document.getElementById('send-btn');

  // ── כניסה אוטומטית ──────────────────────────────────────────────────────
  async function checkPersistentLogin() {
    if (!currentSessionToken) { showVerification(); return; }
    try {
      const res  = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + currentSessionToken } });
      const data = await res.json();
      if (res.ok && data.success && data.user) {
        verifiedUser = data.user;
        showBoard();
      } else {
        clearSession(); showVerification();
      }
    } catch (e) { showVerification(); }
  }

  function clearSession() {
    currentSessionToken = '';
    verifiedUser = null;
    localStorage.removeItem('stips_session_token');
  }

  function showBoard() {
    verificationSection.hidden = true;
    boardSection.hidden = false;
    appHeader.hidden = false;

    const avatarSrc = verifiedUser.profilePic || avatarFallback(verifiedUser.username);
    headerAvatar.src = avatarSrc;
    headerAvatar.onerror = () => { headerAvatar.src = avatarFallback(verifiedUser.username); };
    headerName.textContent = verifiedUser.username || verifiedUser.id;

    loadMessages();
    // רענון אוטומטי כל 15 שניות
    clearInterval(window._pollInterval);
    window._pollInterval = setInterval(loadMessages, 15000);
  }

  function showVerification() {
    clearInterval(window._pollInterval);
    boardSection.hidden = true;
    appHeader.hidden = true;
    verificationSection.hidden = false;
    codeSection.hidden = true;
    usernameInput.value = '';
    currentIdentifier = '';
    currentCode = '';
    setStatus('', '');
  }

  function setStatus(msg, type) {
    statusMsg.textContent = msg;
    statusMsg.className = type || '';
  }

  function avatarFallback(name) {
    return 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name || 'U') + '&background=333&color=fff&size=60';
  }

  // ── יצירת קוד ────────────────────────────────────────────────────────────
  generateForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const inputVal = usernameInput.value.trim();
    if (!inputVal) return;

    generateBtn.disabled = true;
    generateBtn.textContent = 'יוצר...';
    setStatus('', '');

    try {
      const res  = await fetch('/api/generate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stipsUsername: inputVal })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'שגיאה');

      currentIdentifier      = data.identifier || inputVal;
      currentCode            = data.verificationCode;
      displayCode.textContent = currentCode;
      stipsProfileLink.href  = data.profileUrl || `https://stips.co.il/profile/${encodeURIComponent(currentIdentifier)}`;
      codeSection.hidden     = false;
      setStatus('הקוד נוצר! הדבק אותו בביו שלך בסטיפס.', 'success');
    } catch (err) {
      setStatus('שגיאה: ' + err.message, 'error');
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = 'קבל קוד';
    }
  });

  // ── אימות ────────────────────────────────────────────────────────────────
  verifyBtn.addEventListener('click', async function () {
    if (!currentIdentifier || !currentCode) {
      setStatus('נא להזין מזהה סטיפס ולייצר קוד תחילה.', 'error');
      return;
    }
    verifyBtn.disabled = true;
    verifyBtn.textContent = 'מאמת...';
    setStatus('בודק את הפרופיל שלך... אנא המתן.', '');

    try {
      const res  = await fetch('/api/verify-stips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stipsUsername: currentIdentifier, verificationCode: currentCode })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'האימות נכשל');

      currentSessionToken = data.sessionToken;
      localStorage.setItem('stips_session_token', currentSessionToken);
      verifiedUser = data.user;

      setStatus('האימות הצליח!', 'success');
      setTimeout(() => showBoard(), 400);
    } catch (err) {
      setStatus('האימות נכשל: ' + err.message, 'error');
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'אמת פרופיל';
    }
  });

  // ── התנתקות ──────────────────────────────────────────────────────────────
  logoutBtn.addEventListener('click', async function () {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + currentSessionToken },
        body: JSON.stringify({ sessionToken: currentSessionToken })
      });
    } catch (e) {}
    clearSession();
    showVerification();
  });

  // ── טעינת הודעות ─────────────────────────────────────────────────────────
  async function loadMessages() {
    try {
      const res  = await fetch('/api/messages');
      const data = await res.json();
      if (res.ok && data.success) renderMessages(data.messages || []);
    } catch (e) {
      console.warn('loadMessages error:', e.message);
    }
  }

  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderMessages(messages) {
    chatMessages.innerHTML = '';

    if (!messages.length) {
      chatMessages.innerHTML = '<div class="empty-chat">עדיין אין הודעות. היה הראשון! 🎉</div>';
      return;
    }

    messages.forEach(function (msg) {
      const isMe  = verifiedUser && msg.userId === verifiedUser.id;
      const wrap  = document.createElement('div');
      wrap.className = 'bubble-wrap ' + (isMe ? 'me' : 'other');

      const src  = msg.profilePic || avatarFallback(msg.username);
      const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '';

      wrap.innerHTML = `
        <img src="${esc(src)}" alt="${esc(msg.username)}" onerror="this.src='${avatarFallback(msg.username)}'">
        <div class="bubble">
          ${!isMe ? `<div class="bname">${esc(msg.username)}</div>` : ''}
          <div>${esc(msg.text)}</div>
          <div class="btime">${esc(time)}</div>
        </div>`;

      chatMessages.appendChild(wrap);
    });

    // גלול לתחתית
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // ── שליחת הודעה ──────────────────────────────────────────────────────────
  messageForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    if (!currentSessionToken || !verifiedUser) {
      messageStatus.textContent = 'אין חיבור פעיל. אנא אמת מחדש.';
      return;
    }

    const text = messageInput.value.trim();
    if (!text) return;

    sendBtn.disabled = true;
    messageInput.disabled = true;

    try {
      const res  = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + currentSessionToken },
        body: JSON.stringify({ text })
      });
      const data = await res.json();

      if (res.status === 401 || res.status === 403 || data.expired) {
        clearSession();
        showVerification();
        return;
      }

      if (!res.ok || !data.success) throw new Error(data.error || 'שגיאה');

      messageInput.value = '';
      messageStatus.textContent = '';

      if (data.messages) renderMessages(data.messages);
      else loadMessages();

    } catch (err) {
      messageStatus.textContent = 'שגיאה: ' + err.message;
    } finally {
      sendBtn.disabled = false;
      messageInput.disabled = false;
      messageInput.focus();
    }
  });

  // הפעלה
  checkPersistentLogin();
});
