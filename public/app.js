document.addEventListener('DOMContentLoaded', function () {
  // מצב אפליקציה
  let sessionToken = localStorage.getItem('stips_session_token') || '';
  let currentUser = null;
  let currentStipsId = '';
  let generatedCode = '';
  let pollTimer = null;

  // אלמנטים - מסך התחברות
  const loginScreen   = document.getElementById('login-screen');
  const authForm      = document.getElementById('auth-form');
  const stipsInput    = document.getElementById('stips-input');
  const btnGetCode    = document.getElementById('btn-get-code');
  const codeBoxWrapper= document.getElementById('code-box-wrapper');
  const codeText      = document.getElementById('code-text');
  const stipsLink     = document.getElementById('stips-link');
  const btnVerify     = document.getElementById('btn-verify');
  const authStatus    = document.getElementById('auth-status');

  // אלמנטים - מסך לוח מסרים
  const boardScreen   = document.getElementById('board-screen');
  const myAvatar      = document.getElementById('my-avatar');
  const myName        = document.getElementById('my-name');
  const myTag         = document.getElementById('my-tag');
  const btnLogout     = document.getElementById('btn-logout');

  // תיבת פרסום ופיד
  const composerForm   = document.getElementById('composer-form');
  const composerText   = document.getElementById('composer-text');
  const composerStatus = document.getElementById('composer-status');
  const btnPublish     = document.getElementById('btn-publish');
  const feedContainer  = document.getElementById('feed-container');

  // עזר: אווטאר ברירת מחדל
  function getAvatarUrl(user) {
    if (user && user.profilePic && user.profilePic.startsWith('http')) {
      return user.profilePic;
    }
    const name = (user && (user.username || user.id)) || 'U';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=111827&color=ffffff&size=80`;
  }

  // עזר: תאריך ושעה נוחים בעברית
  function formatTime(isoString) {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('he-IL', {
        day: 'numeric',
        month: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return '';
    }
  }

  function setAuthStatus(msg, type) {
    authStatus.textContent = msg;
    authStatus.className = 'status-alert ' + (type || '');
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ─── 1. מעבר חלק בין מסכים ───
  function showBoardView(user) {
    currentUser = user;
    loginScreen.style.display = 'none';
    boardScreen.style.display = 'flex';

    myAvatar.src = getAvatarUrl(user);
    myAvatar.onerror = () => { myAvatar.src = getAvatarUrl(null); };
    myName.textContent = user.username || user.id;
    myTag.textContent = '@' + (user.id || '');

    // טעינת מסרים
    loadMessages();
    clearInterval(pollTimer);
    pollTimer = setInterval(loadMessages, 8000);
  }

  function showLoginView() {
    currentUser = null;
    sessionToken = '';
    localStorage.removeItem('stips_session_token');
    clearInterval(pollTimer);

    boardScreen.style.display = 'none';
    loginScreen.style.display = 'flex';
    codeBoxWrapper.hidden = true;
    stipsInput.value = '';
    currentStipsId = '';
    generatedCode = '';
    setAuthStatus('', '');
  }

  // ─── 2. אימות אוטומטי בכניסה (Persistent Login) ───
  async function checkPersistentSession() {
    if (!sessionToken) {
      showLoginView();
      return;
    }

    try {
      const res = await fetch('/api/me', {
        headers: { 'Authorization': 'Bearer ' + sessionToken }
      });
      const data = await res.json();

      if (res.ok && data.success && data.user) {
        showBoardView(data.user);
      } else {
        showLoginView();
      }
    } catch (err) {
      showLoginView();
    }
  }

  // ─── 3. שלב א': יצירת קוד אימות ───
  authForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const inputVal = stipsInput.value.trim();
    if (!inputVal) return;

    btnGetCode.disabled = true;
    btnGetCode.textContent = 'מייצר קוד...';
    setAuthStatus('', '');

    try {
      const res = await fetch('/api/generate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stipsUsername: inputVal })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'נכשל ביצירת קוד אימות');
      }

      currentStipsId = data.identifier || inputVal;
      generatedCode = data.verificationCode;

      codeText.textContent = generatedCode;
      stipsLink.href = data.profileUrl || `https://stips.co.il/profile/${encodeURIComponent(currentStipsId)}`;
      codeBoxWrapper.hidden = false;

      setAuthStatus('הקוד נוצר. הדבק אותו בביו ולחץ "אמת וכנס".', 'success');
    } catch (err) {
      setAuthStatus('שגיאה: ' + err.message, 'error');
    } finally {
      btnGetCode.disabled = false;
      btnGetCode.textContent = 'קבל קוד אימות';
    }
  });

  // ─── 4. שלב ב': אימות הפרופיל ───
  btnVerify.addEventListener('click', async function () {
    if (!currentStipsId || !generatedCode) {
      setAuthStatus('אנא צור קוד תחילה.', 'error');
      return;
    }

    btnVerify.disabled = true;
    btnVerify.textContent = 'בודק פרופיל בסטיפס...';
    setAuthStatus('בודק את הפרופיל שלך בסטיפס, אנא המתן...', '');

    try {
      const res = await fetch('/api/verify-stips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stipsUsername: currentStipsId,
          verificationCode: generatedCode
        })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'האימות נכשל');
      }

      if (data.sessionToken) {
        sessionToken = data.sessionToken;
        localStorage.setItem('stips_session_token', sessionToken);
      }

      setAuthStatus('אימות הצליח! מעביר ללוח המסרים...', 'success');
      setTimeout(() => {
        showBoardView(data.user);
      }, 350);

    } catch (err) {
      setAuthStatus('האימות נכשל: ' + err.message, 'error');
    } finally {
      btnVerify.disabled = false;
      btnVerify.textContent = 'אמת וכנס ללוח';
    }
  });

  // ─── 5. התנתקות ───
  btnLogout.addEventListener('click', async function () {
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
    showLoginView();
  });

  // ─── 6. טעינת והצגת מסרים (Feed) ───
  async function loadMessages() {
    try {
      const res = await fetch('/api/messages');
      const data = await res.json();
      if (res.ok && data.success) {
        renderFeed(data.messages || []);
      }
    } catch (err) {
      console.warn('Error loading messages:', err.message);
    }
  }

  function renderFeed(messages) {
    if (!messages || messages.length === 0) {
      feedContainer.innerHTML = '<div class="empty-feed">עדיין לא פורסמו מסרים. היה הראשון לפרסם! ✨</div>';
      return;
    }

    // הצגה מהמסר החדש ביותר לישן ביותר
    const sorted = [...messages].reverse();

    feedContainer.innerHTML = sorted.map(msg => {
      const avatar = msg.profilePic || getAvatarUrl({ username: msg.username, id: msg.userId });
      const timeStr = formatTime(msg.timestamp);

      return `
        <article class="message-card">
          <img class="avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(msg.username)}"
               onerror="this.src='https://ui-avatars.com/api/?name=U&background=111827&color=ffffff&size=72'">
          <div class="message-body">
            <div class="message-meta">
              <span class="author-name">${escapeHtml(msg.username || 'משתמש')}</span>
              <time class="message-time">${escapeHtml(timeStr)}</time>
            </div>
            <div class="message-text">${escapeHtml(msg.text)}</div>
          </div>
        </article>
      `;
    }).join('');
  }

  // ─── 7. פרסום מסר חדש ───
  composerForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!sessionToken || !currentUser) {
      showLoginView();
      return;
    }

    const text = composerText.value.trim();
    if (!text) return;

    btnPublish.disabled = true;
    btnPublish.textContent = 'מפרסם...';
    composerStatus.textContent = '';

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
        showLoginView();
        return;
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'שגיאה בפרסום המסר');
      }

      composerText.value = '';
      composerStatus.textContent = 'פורסם בהצלחה!';
      setTimeout(() => { composerStatus.textContent = ''; }, 2500);

      if (data.messages) {
        renderFeed(data.messages);
      } else {
        loadMessages();
      }

    } catch (err) {
      composerStatus.textContent = 'שגיאה: ' + err.message;
    } finally {
      btnPublish.disabled = false;
      btnPublish.textContent = 'פרסם מסר';
      composerText.focus();
    }
  });

  // התחלת בדיקה בכניסה לדף
  checkPersistentSession();
});
