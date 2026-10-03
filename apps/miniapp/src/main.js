import './style.css';

const BASE_URL = 'http://localhost:4000';
const navItems = [
  { id: 'home', label: 'Home' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'wallet', label: 'Wallet' },
  { id: 'referrals', label: 'Referrals' },
  { id: 'profile', label: 'Profile' },
];

let currentView = 'home';
let userState = null;

function getTelegramInitData() {
  const tg = window.Telegram?.WebApp;
  if (!tg) return null;
  return tg.initData || '';
}

async function request(path, options = {}) {
  const initData = getTelegramInitData();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (initData) headers['x-telegram-init-data'] = initData;
  if (userState?.user?.id) headers['x-user-id'] = userState.user.id;

  const response = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }
  return payload;
}

async function loadUser() {
  try {
    const auth = await request('/api/auth/telegram', {
      method: 'POST',
      body: JSON.stringify({
        initData: getTelegramInitData(),
        telegram_user_id: window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 0,
        username: window.Telegram?.WebApp?.initDataUnsafe?.user?.username || null,
        first_name: window.Telegram?.WebApp?.initDataUnsafe?.user?.first_name || null,
        last_name: window.Telegram?.WebApp?.initDataUnsafe?.user?.last_name || null,
        photo_url: window.Telegram?.WebApp?.initDataUnsafe?.user?.photo_url || null,
        language_code: window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code || 'en',
      }),
    });
    userState = auth;
  } catch (error) {
    const fallback = await request('/api/users/me').catch(() => null);
    userState = fallback;
  }
}

async function loadDashboard() {
  const user = userState?.user;
  const wallet = userState?.wallet;
  const greeting = user ? `Good morning, ${user.firstName || user.username || 'ALP user'}` : 'Good morning';

  const hero = `
    <div class="hero">
      <small>ALP</small>
      <h2>${greeting}</h2>
      <div class="balance">${wallet?.availableBalance ?? 0} pts</div>
      <div class="muted">Available balance</div>
    </div>
  `;

  const stats = [
    { label: 'Today', value: '0 tasks' },
    { label: 'Completed', value: `${wallet?.totalEarned ?? 0} pts` },
    { label: 'Rewards', value: `${wallet?.availableBalance ?? 0}` },
    { label: 'Referrals', value: '0' },
  ];

  document.getElementById('hero').innerHTML = hero;
  document.getElementById('stats').innerHTML = stats.map((item) => `
    <div class="stat">
      <div class="stat-label">${item.label}</div>
      <div class="stat-value">${item.value}</div>
    </div>
  `).join('');

  const activity = await request('/api/notifications').catch(() => ({ notifications: [] }));
  const items = activity.notifications && activity.notifications.length ? activity.notifications.slice(0, 4).map((n) => `
    <div class="item">
      <div>
        <strong>${n.title}</strong>
        <div class="muted">${n.message}</div>
      </div>
      <span class="pill">${n.status}</span>
    </div>
  `).join('') : '<div class="empty">No activity yet.</div>';

  document.getElementById('content').innerHTML = `
    <div class="section-title">Quick actions</div>
    <div class="button-row">
      <button class="primary" data-action="tasks">Tasks</button>
      <button class="secondary" data-action="wallet">Wallet</button>
    </div>
    <div class="button-row">
      <button class="secondary" data-action="referrals">Invite</button>
      <button class="secondary" data-action="profile">Profile</button>
    </div>
    <div class="section-title">Recent activity</div>
    <div class="list">${items}</div>
  `;

  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      currentView = button.getAttribute('data-action');
      render();
    });
  });
}

async function loadTasks() {
  const result = await request('/api/tasks').catch(() => ({ tasks: [] }));
  const tasks = result.tasks || [];
  const content = tasks.length ? tasks.map((task) => `
    <div class="item">
      <div>
        <strong>${task.title}</strong>
        <div class="muted">${task.description}</div>
      </div>
      <div>
        <div class="pill">${task.reward} pts</div>
        <div class="muted">${task.status}</div>
      </div>
    </div>
  `).join('') : '<div class="empty">No tasks available yet.</div>';
  document.getElementById('content').innerHTML = `<div class="section-title">Tasks</div><div class="list">${content}</div>`;
}

async function loadWallet() {
  const result = await request('/api/wallet').catch(() => ({ wallet: null, transactions: [] }));
  const wallet = result.wallet || { availableBalance: 0, pendingBalance: 0, totalEarned: 0, totalWithdrawn: 0 };
  const transactions = Array.isArray(result.transactions) ? result.transactions : [];
  document.getElementById('content').innerHTML = `
    <div class="section-title">Wallet</div>
    <div class="card">
      <div class="muted">Available balance</div>
      <div class="balance" style="font-size: 1.6rem; margin-top: 8px;">${wallet.availableBalance} pts</div>
      <div class="button-row">
        <button class="primary" id="withdrawButton">Withdraw</button>
      </div>
    </div>
    <div class="section-title">Transactions</div>
    ${transactions.length ? transactions.map((t) => `
      <div class="item">
        <div>
          <strong>${t.type}</strong>
          <div class="muted">${t.description}</div>
        </div>
        <div>
          <div class="pill">${t.amount} pts</div>
          <div class="muted">${t.status}</div>
        </div>
      </div>
    `).join('') : '<div class="empty">No transactions yet.</div>'}
  `;

  document.getElementById('withdrawButton')?.addEventListener('click', () => {
    alert('Withdrawal requests require configured provider support.');
  });
}

async function loadReferrals() {
  const result = await request('/api/referrals').catch(() => ({ code: 'N/A', referralLink: '', totalReferrals: 0, successfulReferrals: 0, referralRewards: 0, history: [] }));
  const history = Array.isArray(result.history) ? result.history : [];
  document.getElementById('content').innerHTML = `
    <div class="section-title">Referrals</div>
    <div class="card">
      <div class="muted">Your code</div>
      <div style="font-size: 1.5rem; font-weight: 800; margin-top: 6px;">${result.code}</div>
      <div class="button-row">
        <button class="primary" onclick="navigator.clipboard?.writeText('${result.referralLink || 'https://t.me/ALP_BOT'}')">Copy invite link</button>
      </div>
    </div>
    <div class="grid">
      <div class="stat"><div class="stat-label">Total referrals</div><div class="stat-value">${result.totalReferrals}</div></div>
      <div class="stat"><div class="stat-label">Successful</div><div class="stat-value">${result.successfulReferrals}</div></div>
      <div class="stat"><div class="stat-label">Rewards</div><div class="stat-value">${result.referralRewards}</div></div>
      <div class="stat"><div class="stat-label">Status</div><div class="stat-value">Active</div></div>
    </div>
    ${history.length ? history.map((row) => `<div class="item"><div><strong>Referral</strong><div class="muted">${row.referralCode}</div></div><div class="pill">${row.status}</div></div>`).join('') : '<div class="empty">You have no referrals yet.</div>'}
  `;
}

async function loadProfile() {
  const user = userState?.user;
  if (!user) {
    document.getElementById('content').innerHTML = '<div class="empty">Unable to load your ALP account.</div>';
    return;
  }

  document.getElementById('content').innerHTML = `
    <div class="section-title">Profile</div>
    <div class="card">
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="width:58px; height:58px; border-radius:50%; background: #dbeafe; display:flex; align-items:center; justify-content:center; font-weight:800; color:#1d4ed8;">${(user.firstName || user.username || 'A').slice(0,1).toUpperCase()}</div>
        <div>
          <strong>${user.firstName || 'ALP user'} ${user.lastName || ''}</strong>
          <div class="muted">@${user.username || 'no_username'}</div>
        </div>
      </div>
      <div class="grid">
        <div class="stat"><div class="stat-label">User ID</div><div class="stat-value">${user.id}</div></div>
        <div class="stat"><div class="stat-label">Balance</div><div class="stat-value">${userState.wallet?.availableBalance ?? 0}</div></div>
        <div class="stat"><div class="stat-label">Join date</div><div class="stat-value">${new Date(user.createdAt).toLocaleDateString()}</div></div>
        <div class="stat"><div class="stat-label">Referrals</div><div class="stat-value">${await request('/api/referrals').then((r) => r.totalReferrals || 0).catch(() => 0)}</div></div>
      </div>
      <div class="button-row">
        <button class="secondary">Settings</button>
        <button class="secondary">Notifications</button>
      </div>
    </div>
  `;
}

function renderNav() {
  document.getElementById('nav').innerHTML = navItems.map((item) => `
    <button class="${currentView === item.id ? 'active' : ''}" data-nav="${item.id}">${item.label}</button>
  `).join('');

  document.querySelectorAll('[data-nav]').forEach((button) => {
    button.addEventListener('click', () => {
      currentView = button.getAttribute('data-nav');
      render();
    });
  });
}

async function render() {
  renderNav();
  if (!userState) {
    await loadUser();
  }
  if (currentView === 'home') await loadDashboard();
  if (currentView === 'tasks') await loadTasks();
  if (currentView === 'wallet') await loadWallet();
  if (currentView === 'referrals') await loadReferrals();
  if (currentView === 'profile') await loadProfile();
}

const themeToggle = document.getElementById('themeToggle');
if (themeToggle) {
  themeToggle.addEventListener('click', () => document.body.classList.toggle('dark'));
}

render();
