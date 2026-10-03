const API_URL = 'http://localhost:4000';
let adminConfig = { username: '', secret: '' };

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (adminConfig.username && adminConfig.secret) {
    headers['x-admin-username'] = adminConfig.username;
    headers['x-admin-secret'] = adminConfig.secret;
  }
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Request failed');
  return payload;
}

async function login() {
  const username = document.getElementById('adminUsername').value.trim();
  const password = document.getElementById('adminPassword').value.trim();

  adminConfig = { username, secret: password };
  await request('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

  renderDashboard();
}

async function renderDashboard() {
  const dashboard = document.getElementById('dashboard');
  const stats = await request('/api/admin/dashboard');
  const users = await request('/api/admin/users');
  const withdrawals = await request('/api/admin/withdrawals');
  const tasks = await request('/api/tasks');

  dashboard.innerHTML = `
    <div class="grid">
      <div class="card"><div class="muted">Total users</div><div class="metric">${stats.statistics.totalUsers}</div></div>
      <div class="card"><div class="muted">Active users</div><div class="metric">${stats.statistics.activeUsers}</div></div>
      <div class="card"><div class="muted">New users</div><div class="metric">${stats.statistics.newUsers}</div></div>
      <div class="card"><div class="muted">Total rewards</div><div class="metric">${stats.statistics.totalRewards}</div></div>
      <div class="card"><div class="muted">Pending withdrawals</div><div class="metric">${stats.statistics.pendingWithdrawals}</div></div>
      <div class="card"><div class="muted">Completed tasks</div><div class="metric">${stats.statistics.completedTasks}</div></div>
    </div>

    <div class="section">
      <h3>Users</h3>
      <div class="list">
        ${(users.users || []).slice(0, 5).map((user) => `
          <div class="row"><div><strong>${user.firstName || user.username || 'ALP user'}</strong><div class="muted">${user.status}</div></div><div>${user.wallet?.availableBalance || 0}</div></div>
        `).join('') || '<div class="card">No users yet.</div>'}
      </div>
    </div>

    <div class="section">
      <h3>Tasks</h3>
      <div class="list">
        ${(tasks.tasks || []).slice(0, 5).map((task) => `
          <div class="row"><div><strong>${task.title}</strong><div class="muted">${task.status}</div></div><div>${task.reward} pts</div></div>
        `).join('') || '<div class="card">No tasks yet.</div>'}
      </div>
    </div>

    <div class="section">
      <h3>Withdrawals</h3>
      <div class="list">
        ${(withdrawals.withdrawals || []).slice(0, 5).map((row) => `
          <div class="row"><div><strong>${row.user?.firstName || row.user?.username || 'User'}</strong><div class="muted">${row.method}</div></div><div>${row.amount}</div></div>
        `).join('') || '<div class="card">No withdrawals yet.</div>'}
      </div>
    </div>
  `;
  dashboard.style.display = 'block';
}

document.getElementById('loginButton').addEventListener('click', login);
