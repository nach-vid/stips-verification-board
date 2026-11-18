document.addEventListener('DOMContentLoaded', function () {

  // ─── עזר: אחסון סשן רב-שכבתי (Local, Cookies, Session, JWT Decode) ───
  function readCookie(name) {
    try {
      const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
      return match ? decodeURIComponent(match[1]) : '';
    } catch (e) { return ''; }
  }

  function writeCookie(name, val) {
    try {
      document.cookie = name + '=' + encodeURIComponent(val) + '; path=/; max-age=31536000; SameSite=Lax';
    } catch (e) {}
  }

  function deleteCookie(name) {
    try {
      document.cookie = name + '=; path=/; max-age=0; SameSite=Lax';
    } catch (e) {}
  }

  function loadSavedSession() {
    let token = '';
    let user = null;

    try { token = localStorage.getItem('stips_session_token') || ''; } catch (e) {}
    if (!token) token = readCookie('stips_session_token');
    if (!token) {
      try { token = sessionStorage.getItem('stips_session_token') || ''; } catch (e) {}
    }

    try {
      const uStr = localStorage.getItem('stips_current_user');
      if (uStr) user = JSON.parse(uStr);
    } catch (e) {}
    if (!user) {
      try {
        const cStr = readCookie('stips_user');
        if (cStr) user = JSON.parse(cStr);
      } catch (e) {}
    }
    if (!user) {
      try {
        const sStr = sessionStorage.getItem('stips_current_user');
        if (sStr) user = JSON.parse(sStr);
      } catch (e) {}
    }

    if (!user && token && token.includes('.')) {
      try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonStr = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        const decoded = JSON.parse(jsonStr);
        if (decoded && (decoded.id || decoded.username)) {
          user = decoded;
        }
      } catch (e) {}
    }

    return { token, user };
  }

  function saveSession(token, user) {
    try { localStorage.setItem('stips_session_token', token); } catch (e) {}
    try { localStorage.setItem('stips_current_user', JSON.stringify(user)); } catch (e) {}
    try { sessionStorage.setItem('stips_session_token', token); } catch (e) {}
    try { sessionStorage.setItem('stips_current_user', JSON.stringify(user)); } catch (e) {}
    writeCookie('stips_session_token', token);
    writeCookie('stips_user', JSON.stringify(user));
  }

  function clearAllSession() {
    try { localStorage.removeItem('stips_session_token'); } catch (e) {}
    try { localStorage.removeItem('stips_current_user'); } catch (e) {}
    try { sessionStorage.removeItem('stips_session_token'); } catch (e) {}
    try { sessionStorage.removeItem('stips_current_user'); } catch (e) {}
    deleteCookie('stips_session_token');
    deleteCookie('stips_user');
  }

  // שחזור מיידי מובטח
  const initial = loadSavedSession();
  let sessionToken = initial.token;
  let currentUser = initial.user;

  let currentStipsId = '';
  let currentCode = '';
  let heartbeatInterval = null;
  let activeOnlineUserIds = new Set();

  // מצבי שיחה נוכחיים
  let activeDmPartner = null; // { id, username, avatar }
  let activeGroupId = null;
  let activeGroupData = null;

  // רשימת אנשי קשר ששוחחנו איתם (לשליפה מהירה ובחירה בקבוצה)
  let cachedContacts = [];

  // אלמנטים - סרגל עליון
  const btnLogout = document.getElementById('btn-logout');
  const btnToContacts = document.getElementById('btn-to-contacts');
  const swordLogoBtn = document.getElementById('sword-logo-btn');

  // מסכים ראשיים
  const chatScreen = document.getElementById('chat-screen');
  const dmScreen = document.getElementById('dm-screen');
  const groupScreen = document.getElementById('group-screen');
  const contactsScreen = document.getElementById('contacts-screen');
  const loginScreen = document.getElementById('login-screen');

  // צ'אט ראשי
  const messagesFeed = document.getElementById('messages-feed');
  const chatInput = document.getElementById('chat-input');
  const btnSend = document.getElementById('btn-send');

  // צ'אט פרטי
  const dmPartnerName = document.getElementById('dm-partner-name');
  const dmPartnerStatus = document.getElementById('dm-partner-status');
  const btnCloseDm = document.getElementById('btn-close-dm');
  const dmMessagesFeed = document.getElementById('dm-messages-feed');
  const dmInput = document.getElementById('dm-input');
  const btnSendDm = document.getElementById('btn-send-dm');

  // צ'אט קבוצתי
  const groupHeaderName = document.getElementById('group-header-name');
  const btnShareGroupLink = document.getElementById('btn-share-group-link');
  const btnCloseGroup = document.getElementById('btn-close-group');
  const groupMessagesFeed = document.getElementById('group-messages-feed');
  const groupInput = document.getElementById('group-input');
  const btnSendGroup = document.getElementById('btn-send-group');

  // אנשי קשר
  const btnCloseContacts = document.getElementById('btn-close-contacts');
  const btnOpenCreateGroup = document.getElementById('btn-open-create-group');
  const groupsListArea = document.getElementById('groups-list-area');
  const contactsListArea = document.getElementById('contacts-list-area');

  // מודאל יצירת קבוצה
  const createGroupModal = document.getElementById('create-group-modal');
  const newGroupNameInput = document.getElementById('new-group-name');
  const modalMembersSelection = document.getElementById('modal-members-selection');
  const btnCancelModal = document.getElementById('btn-cancel-modal');
  const btnConfirmCreateGroup = document.getElementById('btn-confirm-create-group');

  // מסך התחברות
  const btnSubmitId = document.getElementById('btn-submit-id');
  const codeStepBox = document.getElementById('code-step-box');
  const displayCodeEl = document.getElementById('display-verification-code');
  const codeCopyBox = document.getElementById('code-copy-box');
  const copyStatusHint = document.getElementById('copy-status-hint');
  const profileDirectLink = document.getElementById('profile-direct-link');
  const btnVerifyStips = document.getElementById('btn-verify-stips');
  const btnGetNewCode = document.getElementById('btn-get-new-code');
  const btnBackToChat = document.getElementById('btn-back-to-chat');
  const loginStatus = document.getElementById('login-status');

  // ─── מעבר בין מסכים ───
  function hideAllScreens() {
    chatScreen.style.display = 'none';
    dmScreen.style.display = 'none';
    groupScreen.style.display = 'none';
    contactsScreen.style.display = 'none';
    loginScreen.style.display = 'none';
  }

  function showChatView() {
    hideAllScreens();
    chatScreen.style.display = 'flex';
    activeDmPartner = null;
    activeGroupId = null;
    fetchPublicMessages();
  }

  function showDmView(partner) {
    hideAllScreens();
    dmScreen.style.display = 'flex';
    activeDmPartner = partner;
    activeGroupId = null;
    dmPartnerName.textContent = partner.username || 'משתמש ' + partner.id;
    updateDmPartnerStatusUI();
    dmMessagesFeed.innerHTML = '<div class="empty-state">טוען שיחה...</div>';
    fetchDmMessages(partner.id);
  }

  function updateDmPartnerStatusUI() {
    if (!activeDmPartner) return;
    const isOnline = activeOnlineUserIds.has(String(activeDmPartner.id));
    if (isOnline) {
      dmPartnerStatus.textContent = '● מחובר כעת';
      dmPartnerStatus.className = 'sub-badge online';
    } else {
      dmPartnerStatus.textContent = 'מנותק';
      dmPartnerStatus.className = 'sub-badge';
    }
  }

  function showGroupView(groupId, groupName) {
    hideAllScreens();
    groupScreen.style.display = 'flex';
    activeGroupId = groupId;
    activeDmPartner = null;
    groupHeaderName.textContent = groupName || 'קבוצה';
    groupMessagesFeed.innerHTML = '<div class="empty-state">טוען קבוצה...</div>';
    fetchGroupDetailsAndMessages(groupId);
  }

  function showContactsView() {
    hideAllScreens();
    contactsScreen.style.display = 'flex';
    loadContactsAndGroups();
  }

  function showLoginView() {
    hideAllScreens();
    loginScreen.style.display = 'flex';
    codeStepBox.style.display = 'none';
    const stepGetCode = document.getElementById('step-get-code');
    if (stepGetCode) stepGetCode.style.display = 'block';
    setLoginStatus('', '');
  }

  function updateHeaderUI() {
    if (currentUser && sessionToken) {
      btnLogout.style.display = 'inline-block';
      btnLogout.textContent = 'התנתק (' + (currentUser.username || currentUser.id) + ')';
    } else {
      btnLogout.style.display = 'none';
    }
  }

  function setLoginStatus(msg, type) {
    loginStatus.textContent = msg;
    loginStatus.className = 'login-status-msg' + (type ? ' ' + type : '');
  }

  // ─── לב פועם (Heartbeat & Online Tracking) ───
  async function sendHeartbeat() {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (sessionToken) headers['Authorization'] = 'Bearer ' + sessionToken;
      const res = await fetch('/api/heartbeat', {
        method: 'POST',
        headers: headers
      });
      const data = await res.json();
      if (data && Array.isArray(data.onlineUsers)) {
        activeOnlineUserIds = new Set(data.onlineUsers.map(String));
        refreshAllOnlineIndicators();
        if (activeDmPartner) updateDmPartnerStatusUI();
      }
    } catch (e) {
      // שגיאות רשת שקטות
    }
  }

  function refreshAllOnlineIndicators() {
    // עדכון קווי מתאר סביב אווטארים במסך הצ'אט הראשי
    const avatarWraps = document.querySelectorAll('.msg-avatar-wrap');
    avatarWraps.forEach(wrap => {
      const uid = wrap.getAttribute('data-userid');
      if (uid && activeOnlineUserIds.has(String(uid))) {
        wrap.classList.add('online-now');
      } else {
        wrap.classList.remove('online-now');
      }
    });

    // עדכון קווי מתאר ברשימת אנשי קשר אם פתוחה
    const contactAvatars = document.querySelectorAll('.contact-item-card .contact-avatar-wrap');
    contactAvatars.forEach(wrap => {
      const uid = wrap.getAttribute('data-userid');
      if (uid && activeOnlineUserIds.has(String(uid))) {
        wrap.classList.add('online-now');
      } else {
        wrap.classList.remove('online-now');
      }
    });
  }

  // ─── פורמט תאריכים ───
  function formatMsgDate(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      const hours = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      return hours + ':' + mins;
    } catch (e) {
      return '';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ─── רינדור הודעה בצ'אט הכללי (העיצוב המקורי של פעם) ───
  function renderPublicMessageCard(msg) {
    const card = document.createElement('div');
    card.className = 'msg-card';
    card.setAttribute('data-id', msg.id);

    const isOnline = activeOnlineUserIds.has(String(msg.userId));

    const avatarHtml = msg.avatar
      ? `<img src="${escapeHtml(msg.avatar)}" alt="${escapeHtml(msg.username)}" class="msg-avatar ${isOnline ? 'online-now' : ''}" data-userid="${escapeHtml(msg.userId)}">`
      : `<div class="msg-avatar-placeholder ${isOnline ? 'online-now' : ''}" data-userid="${escapeHtml(msg.userId)}">${escapeHtml((msg.username || '?')[0].toUpperCase())}</div>`;

    card.innerHTML = `
      <div class="msg-author-side" data-userid="${escapeHtml(msg.userId)}" data-username="${escapeHtml(msg.username)}" data-avatar="${escapeHtml(msg.avatar || '')}" title="לחץ לשיחה פרטית">
        ${avatarHtml}
        <span class="msg-author">${escapeHtml(msg.username || 'משתמש')}</span>
      </div>
      <div class="msg-content">${escapeHtml(msg.text)}</div>
    `;

    // לחיצה על האוואטר / מחבר לפתיחת צ'אט פרטי
    const authorSide = card.querySelector('.msg-author-side');
    authorSide.addEventListener('click', function () {
      const targetUserId = this.getAttribute('data-userid');
      const targetUsername = this.getAttribute('data-username');
      const targetAvatar = this.getAttribute('data-avatar');

      showDmView({
        id: targetUserId,
        username: targetUsername,
        avatar: targetAvatar
      });
    });

    return card;
  }

  // ─── טעינת הודעות ציבוריות ───
  async function fetchPublicMessages() {
    try {
      const res = await fetch('/api/messages');
      if (!res.ok) throw new Error('נכשל בטעינת הודעות');
      const data = await res.json();

      // API מחזיר { success, messages, onlineUsers } או מערך ישיר
      const msgs = Array.isArray(data) ? data : (data.messages || []);

      // עדכון מחוברים מה-API של הודעות
      if (data.onlineUsers && Array.isArray(data.onlineUsers)) {
        activeOnlineUserIds = new Set(data.onlineUsers.map(String));
        refreshAllOnlineIndicators();
      }

      if (msgs.length === 0) {
        messagesFeed.innerHTML = '<div class="empty-state">אין עדיין הודעות. היה הראשון לכתוב!</div>';
        return;
      }

      const shouldScroll = messagesFeed.scrollTop + messagesFeed.clientHeight >= messagesFeed.scrollHeight - 50;

      messagesFeed.innerHTML = '';
      msgs.forEach(m => {
        messagesFeed.appendChild(renderPublicMessageCard(m));
      });

      if (shouldScroll) {
        messagesFeed.scrollTop = messagesFeed.scrollHeight;
      }
    } catch (e) {
      if (!messagesFeed.querySelector('.stips-msg-card')) {
        messagesFeed.innerHTML = '<div class="empty-state">שגיאה בטעינת ההודעות. מרענן...</div>';
      }
    }
  }

  // ─── שליחת הודעה ציבורית ───
  async function sendPublicMessage() {
    const text = (chatInput.value || '').trim();
    if (!text) return;

    if (!sessionToken || !currentUser) {
      showLoginView();
      return;
    }

    btnSend.disabled = true;
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + sessionToken
        },
        body: JSON.stringify({ text: text })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'שגיאה בשליחת הודעה');
      }

      chatInput.value = '';
      await fetchPublicMessages();
      messagesFeed.scrollTop = messagesFeed.scrollHeight;
    } catch (err) {
      alert('שגיאה: ' + err.message);
    } finally {
      btnSend.disabled = false;
    }
  }

  // ─── שיחות פרטיות (Direct Messages) ───
  async function fetchDmMessages(targetUserId) {
    if (!sessionToken) {
      dmMessagesFeed.innerHTML = '<div class="empty-state">עליך להתחבר כדי לצפות ולשלוח הודעות פרטיות.<br><br><button type="button" class="btn-create-group" id="btn-login-from-dm">התחבר עכשיו</button></div>';
      const btn = document.getElementById('btn-login-from-dm');
      if (btn) btn.onclick = showLoginView;
      return;
    }

    try {
      const res = await fetch('/api/dm/' + encodeURIComponent(targetUserId), {
        headers: { 'Authorization': 'Bearer ' + sessionToken }
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'נכשל בטעינת שיחה פרטית');
      }

      const msgs = data.messages || [];
      if (msgs.length === 0) {
        dmMessagesFeed.innerHTML = '<div class="empty-state">אין עדיין הודעות בשיחה זו. כתוב משהו ראשון!</div>';
        return;
      }

      dmMessagesFeed.innerHTML = '';
      msgs.forEach(m => {
        const isMe = currentUser && (String(currentUser.id) === String(m.senderId));
        const row = document.createElement('div');
        row.className = 'dm-bubble-row ' + (isMe ? 'me' : 'other');

        const bubble = document.createElement('div');
        bubble.className = 'dm-bubble';
        bubble.innerHTML = `
          <div>${escapeHtml(m.text)}</div>
          <div class="msg-bottom-meta" style="color: ${isMe ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.5)'}; font-size: 0.7rem; margin-top: 3px;">${formatMsgDate(m.createdAt)}</div>
        `;
        row.appendChild(bubble);
        dmMessagesFeed.appendChild(row);
      });

      dmMessagesFeed.scrollTop = dmMessagesFeed.scrollHeight;
    } catch (err) {
      dmMessagesFeed.innerHTML = '<div class="empty-state">שגיאה: ' + escapeHtml(err.message) + '</div>';
    }
  }

  async function sendDmMessage() {
    if (!activeDmPartner) return;
    const text = (dmInput.value || '').trim();
    if (!text) return;

    if (!sessionToken || !currentUser) {
      showLoginView();
      return;
    }

    btnSendDm.disabled = true;
    try {
      const res = await fetch('/api/dm/' + encodeURIComponent(activeDmPartner.id), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + sessionToken
        },
        body: JSON.stringify({ text: text })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'שגיאה בשליחת הודעה פרטית');
      }

      dmInput.value = '';
      await fetchDmMessages(activeDmPartner.id);
    } catch (err) {
      alert('שגיאה: ' + err.message);
    } finally {
      btnSendDm.disabled = false;
    }
  }

  // ─── קבוצות (Groups) ───
  async function fetchGroupDetailsAndMessages(groupId) {
    try {
      const headers = {};
      if (sessionToken) headers['Authorization'] = 'Bearer ' + sessionToken;

      const res = await fetch('/api/groups/' + encodeURIComponent(groupId), { headers });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'קבוצה לא נמצאה');
      }

      activeGroupData = data.group;
      groupHeaderName.textContent = activeGroupData.name || 'קבוצה';

      const msgs = activeGroupData.messages || [];
      if (msgs.length === 0) {
        groupMessagesFeed.innerHTML = '<div class="empty-state">אין עדיין הודעות בקבוצה זו. כתוב משהו ראשון!</div>';
        return;
      }

      groupMessagesFeed.innerHTML = '';
      msgs.forEach(m => {
        const senderId = m.senderId || m.userId;
        const senderName = m.senderUsername || m.username || 'חבר קבוצה';
        const senderPic = m.senderAvatar || m.avatar || m.profilePic || '';
        const isMe = currentUser && (String(currentUser.id) === String(senderId));

        const row = document.createElement('div');
        row.className = 'dm-bubble-row ' + (isMe ? 'me' : 'other');

        // תמונת פרופיל של השולח (אם לא אני)
        let avatarElHtml = '';
        if (!isMe) {
          avatarElHtml = senderPic
            ? `<img src="${escapeHtml(senderPic)}" alt="${escapeHtml(senderName)}" class="bubble-avatar" title="${escapeHtml(senderName)}">`
            : `<div class="bubble-avatar-placeholder" title="${escapeHtml(senderName)}">${escapeHtml((senderName || '?')[0].toUpperCase())}</div>`;
        }

        const bodyWrap = document.createElement('div');
        bodyWrap.className = 'dm-bubble-body-wrap';

        // הצגת השם של השולח (אם לא אני)
        if (!isMe) {
          const header = document.createElement('div');
          header.className = 'group-msg-sender-header';
          header.innerHTML = `<span class="group-msg-sender-name">${escapeHtml(senderName)}</span>`;
          bodyWrap.appendChild(header);
        }

        const bubble = document.createElement('div');
        bubble.className = 'dm-bubble';
        bubble.innerHTML = `
          <div>${escapeHtml(m.text)}</div>
          <div class="msg-bottom-meta" style="color: ${isMe ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.5)'}; font-size: 0.7rem; margin-top: 3px;">${formatMsgDate(m.createdAt || m.timestamp)}</div>
        `;
        bodyWrap.appendChild(bubble);

        if (avatarElHtml) {
          const avWrap = document.createElement('div');
          avWrap.innerHTML = avatarElHtml;
          row.appendChild(avWrap.firstElementChild);
        }
        row.appendChild(bodyWrap);
        groupMessagesFeed.appendChild(row);
      });

      groupMessagesFeed.scrollTop = groupMessagesFeed.scrollHeight;
    } catch (err) {
      groupMessagesFeed.innerHTML = '<div class="empty-state">שגיאה: ' + escapeHtml(err.message) + '</div>';
    }
  }

  async function sendGroupMessage() {
    if (!activeGroupId) return;
    const text = (groupInput.value || '').trim();
    if (!text) return;

    // אם המשתמש אורח (נכנס דרך לינק) - מבקשים חיבור!
    if (!sessionToken || !currentUser) {
      alert('כדי לכתוב בקבוצה, עליך להתחבר תחילה!');
      showLoginView();
      return;
    }

    btnSendGroup.disabled = true;
    try {
      const res = await fetch('/api/groups/' + encodeURIComponent(activeGroupId) + '/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + sessionToken
        },
        body: JSON.stringify({ text: text })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'שגיאה בשליחת הודעה לקבוצה');
      }

      groupInput.value = '';
      await fetchGroupDetailsAndMessages(activeGroupId);
    } catch (err) {
      alert('שגיאה: ' + err.message);
    } finally {
      btnSendGroup.disabled = false;
    }
  }

  // ─── טעינת אנשי קשר וקבוצות (Contacts View) ───
  async function loadContactsAndGroups() {
    if (!sessionToken) {
      contactsListArea.innerHTML = '<div class="empty-state">עליך להתחבר כדי לראות את אנשי הקשר שלך.<br><br><button type="button" class="btn-create-group" id="btn-login-from-contacts">התחבר עכשיו</button></div>';
      groupsListArea.innerHTML = '<div class="empty-state">התחבר כדי לראות את הקבוצות שלך</div>';
      const b = document.getElementById('btn-login-from-contacts');
      if (b) b.onclick = showLoginView;
      return;
    }

    contactsListArea.innerHTML = '<div class="empty-state">טוען אנשי קשר...</div>';
    groupsListArea.innerHTML = '<div class="empty-state">טוען קבוצות...</div>';

    try {
      const res = await fetch('/api/contacts', {
        headers: { 'Authorization': 'Bearer ' + sessionToken }
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'נכשל בטעינת אנשי קשר');
      }

      cachedContacts = data.contacts || [];
      const groups = data.groups || [];

      // רינדור קבוצות
      if (groups.length === 0) {
        groupsListArea.innerHTML = '<div class="empty-state" style="padding: 14px 0;">אין עדיין קבוצות. לחץ על "+ קבוצה חדשה" ליצירה!</div>';
      } else {
        groupsListArea.innerHTML = '';
        groups.forEach(g => {
          const item = document.createElement('div');
          item.className = 'contact-item-card';
          item.innerHTML = `
            <div class="contact-avatar-wrap" style="background: #374151; font-weight: 700; color: #f3f4f6;">👥</div>
            <div class="contact-details">
              <div class="contact-name">${escapeHtml(g.name)}</div>
              <div class="contact-sub">${g.memberCount || (g.members && g.members.length) || 1} חברים</div>
            </div>
          `;
          item.addEventListener('click', () => {
            showGroupView(g.id, g.name);
          });
          groupsListArea.appendChild(item);
        });
      }

      // רינדור אנשי קשר
      if (cachedContacts.length === 0) {
        contactsListArea.innerHTML = '<div class="empty-state" style="padding: 20px 0;">עוד לא שוחחת עם אף אחד.<br>לחץ על תמונת משתמש בצ\'אט כדי להתחיל שיחה!</div>';
      } else {
        contactsListArea.innerHTML = '';
        cachedContacts.forEach(c => {
          const isOnline = activeOnlineUserIds.has(String(c.userId));
          const avatarInner = c.avatar
            ? `<img src="${escapeHtml(c.avatar)}" alt="${escapeHtml(c.username)}" class="contact-avatar-img">`
            : `<div class="contact-avatar-placeholder">${escapeHtml((c.username || '?')[0].toUpperCase())}</div>`;

          const item = document.createElement('div');
          item.className = 'contact-item-card';
          item.innerHTML = `
            <div class="contact-avatar-wrap ${isOnline ? 'online-now' : ''}" data-userid="${escapeHtml(c.userId)}">
              ${avatarInner}
            </div>
            <div class="contact-details">
              <div class="contact-name">${escapeHtml(c.username || 'משתמש ' + c.userId)}</div>
              <div class="contact-sub">${isOnline ? '<span style="color:#22c55e;">● מחובר כעת</span>' : 'נראה לאחרונה'}</div>
            </div>
          `;
          item.addEventListener('click', () => {
            showDmView({
              id: c.userId,
              username: c.username,
              avatar: c.avatar
            });
          });
          contactsListArea.appendChild(item);
        });
      }

    } catch (err) {
      contactsListArea.innerHTML = '<div class="empty-state">שגיאה: ' + escapeHtml(err.message) + '</div>';
    }
  }

  // ─── יצירת קבוצה חדשה ───
  function openCreateGroupModal() {
    if (!sessionToken || !currentUser) {
      showLoginView();
      return;
    }

    newGroupNameInput.value = '';
    modalMembersSelection.innerHTML = '';

    if (cachedContacts.length === 0) {
      modalMembersSelection.innerHTML = '<div style="color: #94a3b8; font-size: 0.8rem; padding: 6px;">אין עדיין אנשי קשר מהשיחות שלך. הקבוצה תיווצר ותוכל לשתף לה קישור!</div>';
    } else {
      cachedContacts.forEach(c => {
        const row = document.createElement('label');
        row.className = 'member-check-item';
        row.innerHTML = `
          <input type="checkbox" value="${escapeHtml(c.userId)}" class="group-member-checkbox">
          <span>${escapeHtml(c.username || 'משתמש ' + c.userId)}</span>
        `;
        modalMembersSelection.appendChild(row);
      });
    }

    createGroupModal.style.display = 'flex';
    newGroupNameInput.focus();
  }

  btnConfirmCreateGroup.addEventListener('click', async function () {
    const name = (newGroupNameInput.value || '').trim();
    if (!name) {
      alert('נא להזין שם לקבוצה');
      return;
    }

    const selectedMembers = [];
    const checkboxes = modalMembersSelection.querySelectorAll('.group-member-checkbox:checked');
    checkboxes.forEach(cb => selectedMembers.push(cb.value));

    btnConfirmCreateGroup.disabled = true;
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + sessionToken
        },
        body: JSON.stringify({
          name: name,
          initialMembers: selectedMembers
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'נכשל ביצירת קבוצה');
      }

      createGroupModal.style.display = 'none';
      showGroupView(data.group.id, data.group.name);
    } catch (err) {
      alert('שגיאה: ' + err.message);
    } finally {
      btnConfirmCreateGroup.disabled = false;
    }
  });

  btnCancelModal.addEventListener('click', function () {
    createGroupModal.style.display = 'none';
  });

  // שיתוף קישור לקבוצה
  btnShareGroupLink.addEventListener('click', function () {
    if (!activeGroupId) return;
    const groupUrl = window.location.origin + window.location.pathname + '?group=' + encodeURIComponent(activeGroupId);
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(groupUrl).then(() => {
        const orig = btnShareGroupLink.textContent;
        btnShareGroupLink.textContent = '✓ הועתק!';
        setTimeout(() => { btnShareGroupLink.textContent = orig; }, 2000);
      }).catch(() => {
        prompt('העתק את הקישור לקבוצה:', groupUrl);
      });
    } else {
      prompt('העתק את הקישור לקבוצה:', groupUrl);
    }
  });

  // ─── מאזיני כפתורי ניווט ואירועים ───
  btnToContacts.addEventListener('click', showContactsView);
  swordLogoBtn.addEventListener('click', showChatView);
  btnCloseDm.addEventListener('click', showChatView);
  btnCloseGroup.addEventListener('click', showChatView);
  btnCloseContacts.addEventListener('click', showChatView);
  btnBackToChat.addEventListener('click', showChatView);
  btnOpenCreateGroup.addEventListener('click', openCreateGroupModal);

  // שליחת הודעות
  btnSend.addEventListener('click', sendPublicMessage);
  chatInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendPublicMessage();
    }
  });

  btnSendDm.addEventListener('click', sendDmMessage);
  dmInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendDmMessage();
    }
  });

  btnSendGroup.addEventListener('click', sendGroupMessage);
  groupInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendGroupMessage();
    }
  });

  // העתקת קוד אימות בלחיצה
  codeCopyBox.addEventListener('click', function () {
    const code = displayCodeEl.textContent;
    if (!code) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(() => {
        copyStatusHint.textContent = 'הועתק בהצלחה!';
        copyStatusHint.style.color = '#4caf50';
        setTimeout(() => {
          copyStatusHint.textContent = 'לחץ להעתקה';
          copyStatusHint.style.color = '#ff5252';
        }, 2000);
      });
    }
  });

  // התנתקות (רק לפי בקשת המשתמש המפורשת)
  btnLogout.addEventListener('click', function () {
    if (confirm('האם אתה בטוח שברצונך להתנתק?')) {
      clearAllSession();
      currentUser = null;
      sessionToken = '';
      updateHeaderUI();
      showChatView();
    }
  });

  // ─── כפתור "קבל קוד" (ללא צורך ב-ID) ───
  async function requestNewCode() {
    const stepGetCode = document.getElementById('step-get-code');
    btnSubmitId.disabled = true;
    btnSubmitId.textContent = 'מייצר קוד...';
    setLoginStatus('', '');

    try {
      const res = await fetch('/api/request-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'נכשל ביצירת קוד אימות');
      }

      currentCode = data.verificationCode;

      displayCodeEl.textContent = currentCode;
      profileDirectLink.href = 'https://stips.co.il/profile/428498';
      if (stepGetCode) stepGetCode.style.display = 'none';
      codeStepBox.style.display = 'block';

      setLoginStatus('', '');
    } catch (err) {
      setLoginStatus('שגיאה: ' + err.message, 'error');
    } finally {
      btnSubmitId.disabled = false;
      btnSubmitId.textContent = 'קבל קוד';
    }
  }

  btnSubmitId.addEventListener('click', requestNewCode);

  // כפתור "קבל קוד חדש"
  if (btnGetNewCode) {
    btnGetNewCode.addEventListener('click', function () {
      codeStepBox.style.display = 'none';
      const stepGetCode = document.getElementById('step-get-code');
      if (stepGetCode) stepGetCode.style.display = 'block';
      setLoginStatus('', '');
    });
  }

  btnVerifyStips.addEventListener('click', async function () {
    if (!currentCode) {
      setLoginStatus('נא לקבל קוד תחילה.', 'error');
      return;
    }

    btnVerifyStips.disabled = true;
    btnVerifyStips.textContent = 'בודק בקיר בסטיפס...';
    setLoginStatus('בודק את הקיר בסטיפס...', '');

    try {
      const res = await fetch('/api/verify-stips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verificationCode: currentCode })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'האימות נכשל');
      }

      sessionToken = data.sessionToken;
      currentUser = data.user;

      saveSession(sessionToken, currentUser);
      updateHeaderUI();

      setLoginStatus('אימות הצליח! מעביר לצ\'אט...', 'success');

      setTimeout(() => {
        showChatView();
        chatInput.focus();
      }, 400);

    } catch (err) {
      setLoginStatus('האימות נכשל: ' + err.message, 'error');
    } finally {
      btnVerifyStips.disabled = false;
      btnVerifyStips.textContent = 'שלחתי — אמת אותי!';
    }
  });

  // ─── כניסת מנהל (ADMIN) לנאצ ───
  const btnToggleAdminBox = document.getElementById('btn-toggle-admin-box');
  const adminBoxWrap = document.getElementById('admin-box-wrap');
  const adminPassInput = document.getElementById('admin-pass-input');
  const btnAdminLogin = document.getElementById('btn-admin-login');

  if (btnToggleAdminBox && adminBoxWrap) {
    btnToggleAdminBox.addEventListener('click', function () {
      const isVisible = adminBoxWrap.style.display !== 'none';
      adminBoxWrap.style.display = isVisible ? 'none' : 'block';
      if (!isVisible && adminPassInput) adminPassInput.focus();
    });
  }

  if (btnAdminLogin && adminPassInput) {
    btnAdminLogin.addEventListener('click', async function () {
      const code = (adminPassInput.value || '').trim();
      if (!code) {
        setLoginStatus('נא להזין קוד מנהל', 'error');
        return;
      }

      btnAdminLogin.disabled = true;
      btnAdminLogin.textContent = 'מתחבר...';
      setLoginStatus('מאמת הרשאות מנהל...', '');

      try {
        const res = await fetch('/api/admin-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminCode: code })
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.error || 'קוד מנהל שגוי');
        }

        sessionToken = data.sessionToken;
        currentUser = data.user;

        saveSession(sessionToken, currentUser);
        updateHeaderUI();
        setLoginStatus('התחברת בהצלחה כמנהל!', 'success');

        setTimeout(() => {
          showChatView();
          chatInput.focus();
        }, 400);
      } catch (err) {
        setLoginStatus('שגיאה: ' + err.message, 'error');
      } finally {
        btnAdminLogin.disabled = false;
        btnAdminLogin.textContent = 'התחבר כמנהל';
      }
    });

    adminPassInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        btnAdminLogin.click();
      }
    });
  }

  // ─── בדיקת סשן שקטה ברקע ───
  async function verifySessionQuietly() {
    if (!sessionToken) return;
    try {
      const res = await fetch('/api/me', {
        headers: { 'Authorization': 'Bearer ' + sessionToken }
      });
      const data = await res.json();
      if (res.ok && data.success && data.user) {
        currentUser = data.user;
        saveSession(sessionToken, currentUser);
        updateHeaderUI();
      }
    } catch (e) {
      // לא מנתק לעולם
    }
  }

  // ─── בדיקת כניסה דרך קישור קבוצה (?group=...) ───
  function checkUrlParams() {
    try {
      const params = new URLSearchParams(window.location.search);
      const groupId = params.get('group');
      if (groupId) {
        // גם אורח יכול לצפות!
        showGroupView(groupId, 'קבוצה');
        return true;
      }
    } catch (e) {}
    return false;
  }

  // ─── אתחול ראשי ───
  updateHeaderUI();
  const openedFromGroup = checkUrlParams();
  if (!openedFromGroup) {
    showChatView();
  }
  verifySessionQuietly();

  // התחלת לב פועם לבדיקת חיבור ונוכחות
  sendHeartbeat();
  heartbeatInterval = setInterval(sendHeartbeat, 8000);

  // פולינג הודעות תקופתי בהתאם למסך הפעיל
  setInterval(() => {
    if (chatScreen.style.display !== 'none') {
      fetchPublicMessages();
    } else if (dmScreen.style.display !== 'none' && activeDmPartner) {
      fetchDmMessages(activeDmPartner.id);
    } else if (groupScreen.style.display !== 'none' && activeGroupId) {
      fetchGroupDetailsAndMessages(activeGroupId);
    }
  }, 3500);

});
