document.addEventListener('DOMContentLoaded', function () {
  // מצב אפליקציה
  let sessionToken = localStorage.getItem('stips_session_token') || '';
  let currentUser = null;
  let currentStipsId = '';
  let currentCode = '';
  let pollInterval = null;

  // אלמנטים - סרגל עליון
  const barTitle       = document.getElementById('bar-title');
  const userInfoPill   = document.getElementById('user-info-pill');
  const userPillImg    = document.getElementById('user-pill-img');
  const userPillName   = document.getElementById('user-pill-name');
  const btnAuthAction  = document.getElementById('btn-auth-action');

  // אלמנטים - מסך צ'אט
  const chatScreen       = document.getElementById('chat-screen');
  const messagesFeed     = document.getElementById('messages-feed');
  const bottomBoxWrapper = document.getElementById('bottom-box-wrapper');
  const chatInput        = document.getElementById('chat-input');
  const btnSend          = document.getElementById('btn-send');

  // אלמנטים - מסך חיבור
  const loginScreen         = document.getElementById('login-screen');
  const loginForm           = document.getElementById('login-form');
  const stipsIdInput        = document.getElementById('stips-id-input');
  const btnSubmitId         = document.getElementById('btn-submit-id');
  const codeStep            = document.getElementById('code-step');
  const displayCodeEl       = document.getElementById('display-verification-code');
  const profileDirectLink   = document.getElementById('profile-direct-link');
  const btnVerifyStips      = document.getElementById('btn-verify-stips');
  const loginStatus         = document.getElementById('login-status');

  // עזר: אווטאר בטוח (עיגול לבן / תמונה)
  function getAvatar(user) {
    if (user && user.profilePic && user.profilePic.startsWith('http')) {
      return user.profilePic;
    }
    const name = (user && (user.username || user.id)) || 'U';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=ffffff&color=111111&size=60`;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setLoginStatus(msg, type) {
    loginStatus.textContent = msg;
    loginStatus.className = 'login-status-msg ' + (type || '');
  }

  // ─── ניווט בין מסך הצ'אט למסך החיבור ───
  function showChatView() {
    loginScreen.style.display = 'none';
    chatScreen.style.display = 'flex';
    barTitle.textContent = "צ'אט משתמשים";

    updateHeaderAuthUI();
    loadMessages();

    // התחלת סנכרון הודעות כל 6 שניות
    clearInterval(pollInterval);
    pollInterval = setInterval(loadMessages, 6000);
  }

  function showLoginView() {
    clearInterval(pollInterval);
    chatScreen.style.display = 'none';
    loginScreen.style.display = 'flex';
    barTitle.textContent = "חיבור לסטיפס";
    btnAuthAction.textContent = "חזרה";

    codeStep.style.display = 'none';
    stipsIdInput.value = '';
    setLoginStatus('', '');
    stipsIdInput.focus();
  }

  function updateHeaderAuthUI() {
    if (currentUser) {
      userInfoPill.style.display = 'flex';
      userPillImg.src = getAvatar(currentUser);
      userPillName.textContent = currentUser.username || currentUser.id;
      btnAuthAction.textContent = "התנתק";
    } else {
      userInfoPill.style.display = 'none';
      btnAuthAction.textContent = "התחבר";
    }
  }

  // לחיצה על כפתור הסרגל העליון (התחבר / התנתק / חזרה)
  btnAuthAction.addEventListener('click', function () {
    if (loginScreen.style.display === 'flex') {
      // חזרה לצ'אט
      showChatView();
    } else if (currentUser) {
      // התנתקות
      logout();
    } else {
      // כניסה למסך חיבור
      showLoginView();
    }
  });

  async function logout() {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + sessionToken
        },
        body: JSON.stringify({ sessionToken })
      });
    } catch (e) {}
    sessionToken = '';
    currentUser = null;
    localStorage.removeItem('stips_session_token');
    updateHeaderAuthUI();
  }

  // ─── התנהגות ה-BOX התחתון לשליחת הודעות ───
  // אם לא רשום -> מעביר למסך חיבור לסטיפס
  // אם רשום -> פותח מקלדת ונותן לכתוב ולשלוח
  function handleInputBoxInteraction(e) {
    if (!currentUser || !sessionToken) {
      e.preventDefault();
      chatInput.blur();
      showLoginView();
      return false;
    }
    return true;
  }

  bottomBoxWrapper.addEventListener('click', function (e) {
    if (!currentUser || !sessionToken) {
      e.preventDefault();
      showLoginView();
    }
  });

  chatInput.addEventListener('focus', function (e) {
    if (!currentUser || !sessionToken) {
      e.preventDefault();
      chatInput.blur();
      showLoginView();
    }
  });

  // תמיכה ב-Enter במקלדת לשליחת הודעה
  chatInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  });

  btnSend.addEventListener('click', function (e) {
    e.preventDefault();
    sendMessage();
  });

  // ─── שליחת הודעה ───
  async function sendMessage() {
    if (!handleInputBoxInteraction({ preventDefault: () => {} })) return;

    const text = chatInput.value.trim();
    if (!text) return;

    btnSend.disabled = true;

    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + sessionToken
        },
        body: JSON.stringify({ text })
      });

      const data = await res.json();

      if (res.status === 401 || res.status === 403 || data.expired) {
        sessionToken = '';
        currentUser = null;
        localStorage.removeItem('stips_session_token');
        showLoginView();
        return;
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'שגיאה בשליחת ההודעה');
      }

      chatInput.value = '';
      if (data.messages) {
        renderMessages(data.messages);
      } else {
        loadMessages();
      }

    } catch (err) {
      alert('שגיאה: ' + err.message);
    } finally {
      btnSend.disabled = false;
      chatInput.focus();
    }
  }

  // ─── טעינת והצגת הודעות (החדשות למעלה!) ───
  async function loadMessages() {
    try {
      const res = await fetch('/api/messages');
      const data = await res.json();
      if (res.ok && data.success) {
        renderMessages(data.messages || []);
      }
    } catch (e) {
      console.warn('loadMessages error:', e.message);
    }
  }

  function renderMessages(messages) {
    if (!messages || messages.length === 0) {
      messagesFeed.innerHTML = '<div class="empty-state">אין עדיין הודעות בצ\'אט. היה הראשון לכתוב!</div>';
      return;
    }

    // ההודעות החדשות ביותר מופיעות למעלה
    const newestFirst = [...messages].reverse();

    messagesFeed.innerHTML = newestFirst.map(msg => {
      const avatarSrc = msg.profilePic || getAvatar({ username: msg.username, id: msg.userId });
      const name = msg.username || 'משתמש';
      const text = msg.text || '';

      return `
        <div class="msg-card">
          <div class="msg-content">${escapeHtml(text)}</div>
          <div class="msg-author">${escapeHtml(name)}</div>
          <img class="msg-avatar" src="${escapeHtml(avatarSrc)}" alt=""
               onerror="this.src='https://ui-avatars.com/api/?name=U&background=ffffff&color=111111&size=60'">
        </div>
      `;
    }).join('');
  }

  // ─── תהליך חיבור לסטיפס ───
  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const idVal = stipsIdInput.value.trim();
    if (!idVal) return;

    btnSubmitId.disabled = true;
    btnSubmitId.textContent = 'מייצר קוד...';
    setLoginStatus('', '');

    try {
      const res = await fetch('/api/generate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stipsUsername: idVal })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'נכשל ביצירת קוד אימות');
      }

      currentStipsId = data.identifier || idVal;
      currentCode = data.verificationCode;

      displayCodeEl.textContent = currentCode;
      profileDirectLink.href = data.profileUrl || `https://stips.co.il/profile/${encodeURIComponent(currentStipsId)}`;
      codeStep.style.display = 'block';

      setLoginStatus('הקוד נוצר. הדבק אותו בביו שלך בסטיפס.', 'success');
    } catch (err) {
      setLoginStatus('שגיאה: ' + err.message, 'error');
    } finally {
      btnSubmitId.disabled = false;
      btnSubmitId.textContent = 'קבל קוד אימות';
    }
  });

  btnVerifyStips.addEventListener('click', async function () {
    if (!currentStipsId || !currentCode) {
      setLoginStatus('נא לייצר קוד תחילה.', 'error');
      return;
    }

    btnVerifyStips.disabled = true;
    btnVerifyStips.textContent = 'בודק בסטיפס...';
    setLoginStatus('בודק את הפרופיל שלך בסטיפס...', '');

    try {
      const res = await fetch('/api/verify-stips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stipsUsername: currentStipsId,
          verificationCode: currentCode
        })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'האימות נכשל');
      }

      sessionToken = data.sessionToken;
      currentUser = data.user;
      localStorage.setItem('stips_session_token', sessionToken);

      setLoginStatus('החיבור הצליח! מעביר לצ\'אט...', 'success');

      // החזרה מיידית לצ'אט ופתיחת תיבת ההקלדה
      setTimeout(() => {
        showChatView();
        chatInput.focus();
      }, 300);

    } catch (err) {
      setLoginStatus('האימות נכשל: ' + err.message, 'error');
    } finally {
      btnVerifyStips.disabled = false;
      btnVerifyStips.textContent = 'אמת והתחבר';
    }
  });

  // ─── בדיקת סשן קיים ברקע ───
  async function initSession() {
    if (sessionToken) {
      try {
        const res = await fetch('/api/me', {
          headers: { 'Authorization': 'Bearer ' + sessionToken }
        });
        const data = await res.json();
        if (res.ok && data.success && data.user) {
          currentUser = data.user;
          updateHeaderAuthUI();
        } else {
          sessionToken = '';
          localStorage.removeItem('stips_session_token');
          updateHeaderAuthUI();
        }
      } catch (e) {
        // שגיאת רשת - ממשיכים כרגיל כצופה
      }
    }
  }

  // הפעלה ראשונית: הצגת הצ'אט מיד
  showChatView();
  initSession();
});
