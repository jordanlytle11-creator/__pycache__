/* ============================================================
   Local ERP/CRM — app.js
   ============================================================ */

const API = window.location.origin;

// ── State ─────────────────────────────────────────────────────
let token = null;
let currentUser = null;  // { email, role }
let workbookTabs = [];

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg, type = 'info', duration = 3500) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ── Auth headers ───────────────────────────────────────────────
function authHeaders(extra = {}) {
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...extra };
}

// ── API helpers ────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, opts);
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = j.detail || detail; } catch {}
    throw new Error(detail);
  }
  return res;
}

async function apiJSON(path, opts = {}) {
  const res = await apiFetch(path, opts);
  return res.json();
}

// ── Badges ─────────────────────────────────────────────────────
function statusBadge(status) {
  const cls = status === 'new' ? 'badge-new' : status === 'in-progress' ? 'badge-progress' : 'badge-closed';
  return `<span class="badge ${cls}">${status}</span>`;
}

function roleBadge(role) {
  const cls = role === 'admin' ? 'badge-admin' : role === 'manager' ? 'badge-manager' : 'badge-employee';
  return `<span class="badge ${cls}">${role}</span>`;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Login / Logout ─────────────────────────────────────────────
document.getElementById('loginBtn').addEventListener('click', doLogin);
document.getElementById('loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginErr');
  errEl.style.display = 'none';

  if (!email || !pass) { errEl.textContent = 'Please enter email and password.'; errEl.style.display = 'block'; return; }

  try {
    const form = new URLSearchParams();
    form.append('username', email);
    form.append('password', pass);
    const data = await apiJSON('/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
    token = data.access_token;

    // Decode role from JWT payload (base64 middle segment)
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    currentUser = { email: payload.sub, role: payload.role || 'employee' };

    showApp();
  } catch (err) {
    errEl.textContent = 'Login failed: ' + err.message;
    errEl.style.display = 'block';
  }
}

document.getElementById('logoutBtn').addEventListener('click', () => {
  token = null;
  currentUser = null;
  document.getElementById('sidebar').style.display = 'none';
  document.getElementById('main').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('loginPass').value = '';
});

// ── Show app after login ───────────────────────────────────────
function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('sidebar').style.display = 'flex';
  document.getElementById('main').style.display = 'flex';

  // User pill
  document.getElementById('userEmailDisplay').textContent = currentUser.email;
  document.getElementById('userRoleDisplay').textContent = currentUser.role;
  document.getElementById('userAvatar').textContent = currentUser.email[0].toUpperCase();

  // Role-based nav visibility
  const isManagerPlus = ['admin', 'manager'].includes(currentUser.role);
  document.getElementById('navExports').style.display = isManagerPlus ? '' : 'none';
  document.getElementById('navAdmin').style.display = currentUser.role === 'admin' ? '' : 'none';
  document.getElementById('navWorkbook').style.display = isManagerPlus ? '' : 'none';

  if (isManagerPlus) {
    loadWorkbookTabs();
  }

  navigateTo('dashboard');
}

// ── Navigation ─────────────────────────────────────────────────
const pageTitles = {
  dashboard: 'Dashboard',
  crm: 'CRM Records',
  import: 'Import CSV',
  'workbook-import': 'Import Workbook',
  'workbook-tab': 'Workbook Tab',
  exports: 'Export Tools',
  users: 'User Management',
  invites: 'Invite Management',
  links: 'Link Tokens',
};

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item[data-page]').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');

  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  document.getElementById('pageTitle').textContent = pageTitles[page] || page;

  if (page === 'dashboard') loadDashboard();
  if (page === 'users') loadUsers();
}

document.querySelectorAll('.nav-item[data-page]').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

// ── Modal helpers ──────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay.id); });
});

// ── Forgot credentials ────────────────────────────────────────
document.getElementById('forgotCredsBtn').addEventListener('click', () => openModal('forgotCredsModal'));

document.getElementById('submitForgotCredsBtn').addEventListener('click', async () => {
  const body = {
    email: document.getElementById('forgotEmail').value.trim() || null,
    username: document.getElementById('forgotUsername').value.trim() || null,
    message: document.getElementById('forgotMessage').value.trim() || null,
  };

  if (!body.email && !body.username) {
    showToast('Enter at least email or username', 'error');
    return;
  }

  try {
    const result = await apiJSON('/auth/forgot-credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    closeModal('forgotCredsModal');
    showToast(
      result.delivery === 'email'
        ? 'Request sent to admin email'
        : 'Request saved and queued for admin review',
      'success'
    );
  } catch (err) {
    showToast('Could not submit request: ' + err.message, 'error');
  }
});

// ── Dashboard ─────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const records = await apiJSON('/crm?limit=100', { headers: authHeaders() });
    const total = records.length;
    const newCount = records.filter(r => r.status === 'new').length;
    const progCount = records.filter(r => r.status === 'in-progress').length;
    const closedCount = records.filter(r => r.status === 'closed').length;

    document.getElementById('kpiTotal').textContent = total;
    document.getElementById('kpiNew').textContent = newCount;
    document.getElementById('kpiProg').textContent = progCount;
    document.getElementById('kpiClosed').textContent = closedCount;

    const tbody = document.getElementById('dashTbody');
    const recent = records.slice(-10).reverse();
    if (recent.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No records yet</td></tr>';
    } else {
      tbody.innerHTML = recent.map(r => `
        <tr>
          <td>${r.id}</td>
          <td>${esc(r.company || '—')}</td>
          <td>${esc(r.contact || '—')}</td>
          <td>${trsCode(r)}</td>
          <td>${statusBadge(r.status)}</td>
          <td>${fmtDate(r.created_at)}</td>
        </tr>`).join('');
    }
  } catch (err) {
    showToast('Failed to load dashboard: ' + err.message, 'error');
  }
}

function trsCode(r) {
  if (!r.township && !r.range && !r.section) return '—';
  return `T${r.township || '?'}R${r.range || '?'}S${r.section || '?'}`;
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Workbook Ingestion + Cards ───────────────────────────────
async function loadWorkbookTabs() {
  try {
    const tabs = await apiJSON('/crm/workbook-tabs', { headers: authHeaders() });
    workbookTabs = tabs;
    renderWorkbookNav(tabs);
  } catch (err) {
    renderWorkbookNav([]);
  }
}

function renderWorkbookNav(tabs) {
  const container = document.getElementById('workbookTabsNav');
  if (!tabs || tabs.length === 0) {
    container.innerHTML = '<div class="text-muted" style="padding:0 10px 8px;">No workbook tabs imported</div>';
    return;
  }

  container.innerHTML = tabs.map(t => `
    <div class="nav-item nav-workbook-tab" data-page="workbook-tab" data-tab-key="${esc(t.tab_key)}" data-tab-name="${esc(t.sheet_name)}">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h8m-8 4h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z"/></svg>
      ${esc(t.workbook_name || t.sheet_name)}
    </div>
  `).join('');

  container.querySelectorAll('.nav-workbook-tab').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo('workbook-tab');
      document.querySelectorAll('.nav-workbook-tab').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      loadWorkbookTabRows(item.dataset.tabKey, item.dataset.tabName);
    });
  });
}

async function loadWorkbookTabRows(tabKey, tabName) {
  const titleEl = document.getElementById('workbookTabTitle');
  const metaEl = document.getElementById('workbookTabMeta');
  const cardsEl = document.getElementById('workbookCards');

  titleEl.textContent = tabName || 'Workbook Tab';
  metaEl.textContent = 'Loading rows...';
  cardsEl.innerHTML = '';

  try {
    const data = await apiJSON(`/crm/workbook-tabs/${encodeURIComponent(tabKey)}/rows?limit=300000`, { headers: authHeaders() });
    metaEl.textContent = `Rows: ${data.rows.length}`;

    if (!data.rows.length) {
      cardsEl.innerHTML = '<div class="card"><div class="card-body text-muted">No rows found in this tab.</div></div>';
      return;
    }

    cardsEl.innerHTML = data.rows.map((row) => {
      const keys = Object.keys(row).filter(k => k !== 'id' && k !== 'source_row_number');
      const kv = keys.map(k => `<div class="kv-row"><b>${esc(k)}:</b> ${esc(row[k] ?? '')}</div>`).join('');
      return `<div class="data-card"><h4>Row ${row.source_row_number || row.id}</h4><div class="kv">${kv}</div></div>`;
    }).join('');
  } catch (err) {
    metaEl.textContent = 'Failed to load';
    cardsEl.innerHTML = `<div class="card"><div class="card-body" style="color:#dc2626;">${esc(err.message)}</div></div>`;
  }
}

document.getElementById('importWorkbookBtn').addEventListener('click', async () => {
  const fileInput = document.getElementById('workbookFile');
  const outEl = document.getElementById('workbookImportOut');
  const f = fileInput.files && fileInput.files[0];
  if (!f) {
    showToast('Choose an .xlsx file first', 'error');
    return;
  }

  const form = new FormData();
  form.append('file', f);

  try {
    const res = await apiFetch('/admin/import-excel-workbook', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: form,
    });
    const data = await res.json();
    outEl.textContent = JSON.stringify(data, null, 2);
    outEl.style.display = 'block';
    showToast(`Imported ${data.crm_records_imported || 0} CRM records from ${data.tabs_imported} tabs`, 'success');
    await loadWorkbookTabs();
    await loadDashboard();
    await loadCRMRecords({});
  } catch (err) {
    outEl.textContent = 'Error: ' + err.message;
    outEl.style.display = 'block';
    showToast('Workbook import failed: ' + err.message, 'error');
  }
});

// ── CRM Records ────────────────────────────────────────────────
document.getElementById('searchAllBtn').addEventListener('click', () => loadCRMRecords({}));
document.getElementById('searchBtn').addEventListener('click', () => {
  const params = {};
  const twp = document.getElementById('searchTwp').value;
  const rng = document.getElementById('searchRange').value;
  const sec = document.getElementById('searchSec').value;
  const status = document.getElementById('searchStatus').value;
  if (twp) params.township = twp;
  if (rng) params.range = rng;
  if (sec) params.section = sec;
  if (status) params.status = status;
  loadCRMRecords(params);
});

async function loadCRMRecords(params) {
  const qs = new URLSearchParams(params).toString();
  try {
    const path = qs ? `/crm/search?${qs}&limit=300000` : '/crm?limit=300000';
    const records = await apiJSON(path, { headers: authHeaders() });
    const tbody = document.getElementById('crmTbody');
    if (records.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="9">No records found</td></tr>';
    } else {
      tbody.innerHTML = records.map(r => `
        <tr>
          <td>${r.id}</td>
          <td>${esc(r.company || '—')}</td>
          <td>${esc(r.contact || '—')}</td>
          <td>${trsCode(r)}</td>
          <td>${r.township || '—'}</td>
          <td>${r.range || '—'}</td>
          <td>${r.section || '—'}</td>
          <td>${statusBadge(r.status)}</td>
          <td>${fmtDate(r.created_at)}</td>
        </tr>`).join('');
    }
  } catch (err) {
    showToast('Search failed: ' + err.message, 'error');
  }
}

// ── CRM Record Modal ───────────────────────────────────────────
document.getElementById('dashAddBtn').addEventListener('click', () => openModal('crmModal'));
document.getElementById('crmAddBtn').addEventListener('click', () => openModal('crmModal'));

document.getElementById('createCrmBtn').addEventListener('click', async () => {
  const body = {
    company: document.getElementById('crmCompany').value.trim(),
    contact: document.getElementById('crmContact').value.trim(),
    township: parseInt(document.getElementById('crmTwp').value) || null,
    range: parseInt(document.getElementById('crmRange').value) || null,
    section: parseInt(document.getElementById('crmSec').value) || null,
    status: document.getElementById('crmStatus').value,
  };
  if (!body.company) { showToast('Company name is required', 'error'); return; }
  try {
    await apiJSON('/crm', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    closeModal('crmModal');
    showToast('Record created', 'success');
    loadDashboard();
    loadCRMRecords({});
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
});

// ── CSV Import ─────────────────────────────────────────────────
document.getElementById('csvImportBtn').addEventListener('click', async () => {
  const csv = document.getElementById('csvText').value.trim();
  if (!csv) { showToast('Paste CSV data first', 'error'); return; }
  const outEl = document.getElementById('csvOut');
  try {
    const res = await apiFetch('/crm/import-csv', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'text/plain' }, body: csv });
    const data = await res.json();
    outEl.textContent = JSON.stringify(data, null, 2);
    outEl.style.display = 'block';
    showToast('Import complete', 'success');
  } catch (err) {
    outEl.textContent = 'Error: ' + err.message;
    outEl.style.display = 'block';
    showToast('Import failed: ' + err.message, 'error');
  }
});

// ── Exports ────────────────────────────────────────────────────
document.getElementById('shapefileBtn').addEventListener('click', async () => {
  const outEl = document.getElementById('shapeOut');
  try {
    const data = await apiJSON('/crm/shapefile', { headers: authHeaders() });
    outEl.textContent = JSON.stringify(data, null, 2);
    outEl.style.display = 'block';
    showToast('Shapefile generated', 'success');
  } catch (err) {
    outEl.textContent = 'Error: ' + err.message;
    outEl.style.display = 'block';
    showToast('Export failed: ' + err.message, 'error');
  }
});

document.getElementById('shareBtn').addEventListener('click', async () => {
  const outEl = document.getElementById('shareOut');
  try {
    const data = await apiJSON('/sharepoint/export', { headers: authHeaders() });
    outEl.textContent = JSON.stringify(data, null, 2);
    outEl.style.display = 'block';
    showToast('Exported to OneDrive', 'success');
  } catch (err) {
    outEl.textContent = 'Error: ' + err.message;
    outEl.style.display = 'block';
    showToast('Export failed: ' + err.message, 'error');
  }
});

// ── Users ──────────────────────────────────────────────────────
async function loadUsers() {
  try {
    const users = await apiJSON('/admin/users', { headers: authHeaders() });
    const tbody = document.getElementById('usersTbody');
    if (!users.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="2">No users found</td></tr>';
    } else {
      tbody.innerHTML = users.map(u => `
        <tr><td>${esc(u.email)}</td><td>${roleBadge(u.role)}</td></tr>`).join('');
    }
  } catch (err) {
    showToast('Failed to load users: ' + err.message, 'error');
  }
}

document.getElementById('openCreateUserModal').addEventListener('click', () => openModal('createUserModal'));

document.getElementById('createUserBtn').addEventListener('click', async () => {
  const body = {
    email: document.getElementById('newEmail').value.trim(),
    password: document.getElementById('newPass').value,
    role: document.getElementById('newRole').value,
  };
  if (!body.email || !body.password) { showToast('Email and password are required', 'error'); return; }
  try {
    await apiJSON('/admin/users', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    closeModal('createUserModal');
    showToast('User created', 'success');
    loadUsers();
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
});

// ── Invites ────────────────────────────────────────────────────
document.getElementById('inviteBtn').addEventListener('click', async () => {
  const body = {
    email: document.getElementById('inviteEmail').value.trim(),
    role: document.getElementById('inviteRole').value,
  };
  const outEl = document.getElementById('inviteOut');
  if (!body.email) { showToast('Email is required', 'error'); return; }
  try {
    const data = await apiJSON('/admin/invite', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    outEl.textContent = JSON.stringify(data, null, 2);
    outEl.style.display = 'block';
    if (data.delivery === 'email') {
      showToast('Invite email sent', 'success');
    } else {
      showToast('SMTP not configured; invite saved with link/token output', 'info');
    }
  } catch (err) {
    outEl.textContent = 'Error: ' + err.message;
    outEl.style.display = 'block';
    showToast('Failed: ' + err.message, 'error');
  }
});

document.getElementById('acceptBtn').addEventListener('click', async () => {
  const body = {
    token: document.getElementById('acceptToken').value.trim(),
    password: document.getElementById('acceptPass').value,
  };
  const outEl = document.getElementById('acceptOut');
  if (!body.token || !body.password) { showToast('Token and password required', 'error'); return; }
  try {
    const data = await apiJSON('/admin/accept-invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    outEl.textContent = JSON.stringify(data, null, 2);
    outEl.style.display = 'block';
    showToast('Registration complete', 'success');
  } catch (err) {
    outEl.textContent = 'Error: ' + err.message;
    outEl.style.display = 'block';
    showToast('Failed: ' + err.message, 'error');
  }
});

function prefillInviteTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token = (params.get('invite_token') || '').trim();
  if (!token) return;

  const tokenInput = document.getElementById('acceptToken');
  if (tokenInput) tokenInput.value = token;
}

prefillInviteTokenFromUrl();

// ── Link Tokens ────────────────────────────────────────────────
document.getElementById('linkBtn').addEventListener('click', async () => {
  const body = {
    permission: document.getElementById('linkPermission').value,
    expires_in_hours: parseInt(document.getElementById('linkHours').value) || 24,
  };
  const outEl = document.getElementById('linkOut');
  try {
    const data = await apiJSON('/admin/link', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    outEl.textContent = JSON.stringify(data, null, 2);
    outEl.style.display = 'block';
    showToast('Link token generated', 'success');
  } catch (err) {
    outEl.textContent = 'Error: ' + err.message;
    outEl.style.display = 'block';
    showToast('Failed: ' + err.message, 'error');
  }
});
