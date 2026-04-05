/* ============================================================
   Local ERP/CRM — app.js
   ============================================================ */

const API = window.location.origin;

// ── State ─────────────────────────────────────────────────────
let token = null;
let currentUser = null;  // { email, role }
let workbookTabs = [];
let currentCrmSearchParams = {};
let currentCrmRecords = [];
let currentCrmRawRecords = [];
const DEFAULT_CRM_ROW_HEIGHT = 44;
const crmLayoutStateByRole = {};
const crmFilterStateByRole = {};

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
  const newStatuses = ['No Contact', 'No Contact / Unlocatable', 'Non-priority'];
  const progressStatuses = ['Working', 'Verbally Committed', 'Agreed to Terms', 'Surface Only', 'Outreach Pending'];
  const cls =
    newStatuses.includes(status) ? 'badge-new'
    : progressStatuses.includes(status) ? 'badge-progress'
    : 'badge-closed';
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
    localStorage.setItem('erp_token', token);

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
  localStorage.removeItem('erp_token');
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
    loadWorkbookStorageStatus();
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

const adminManagerCrmColumns = [
  { label: 'AMI/AOI', keys: ['ami_aoi', 'oklahoma_county_tomahawk_project', 'column_1'] },
  { label: 'STATE CODE', keys: ['state_code', 'column_2'] },
  { label: 'COUNTY CODE', keys: ['county_code', 'column_3'] },
  { label: 'T-R-S', keys: ['t_r_s', 'trs', 'column_4'], fallback: (record) => trsCode(record) },
  { label: 'Location #', keys: ['location_number', 'column_5'] },
  { label: 'Well Name', keys: ['well_name', 'column_6'] },
  { label: 'DSU Name', keys: ['dsu_name', 'column_7'] },
  { label: 'PAD NAME', keys: ['pad_name', 'column_8'] },
  { label: 'LEASE #', keys: ['lease_number', 'column_9'] },
  { label: 'LEASE NAME', keys: ['lease_name', 'company', 'column_10'] },
  { label: 'STATE', keys: ['state', 'column_11'] },
  { label: 'COUNTY', keys: ['county', 'column_12'] },
  { label: 'LESSOR / OWNER', keys: ['lessor_owner', 'owner_name', 'owner', 'column_13'] },
  { label: 'LESSEE', keys: ['lessee', 'column_14'] },
  { label: 'LEASE DATE', keys: ['column_15', 'lease_date'], type: 'date' },
  { label: 'VOL', keys: ['column_16', 'vol'] },
  { label: 'PG', keys: ['column_17', 'pg'] },
  { label: 'TWN', keys: ['township', 'twp', 'column_18'] },
  { label: 'RNG', keys: ['range', 'rng', 'column_19'] },
  { label: 'SEC', keys: ['section', 'sec', 'column_20'] },
  { label: 'TRACT DESCRIPTION', keys: ['tract_description', 'column_21'] },
  { label: 'STATUS', keys: ['status', 'column_22'], type: 'status' },
  { label: 'GROSS ACRES', keys: ['gross_acres', 'column_23'] },
  { label: 'NET ACRES', keys: ['net_acres', 'column_24'] },
  { label: 'ROYALTY', keys: ['royalty', 'column_25'] },
  { label: 'BONUS AGREED', keys: ['bonus_agreed', 'column_26'] },
  { label: 'TERM (MONTH)', keys: ['term_months', 'term_month', 'column_27'] },
  { label: 'EXTENSION (MONTH)', keys: ['extension_months', 'extension_month', 'column_28'] },
  { label: 'LEASE AGENT', keys: ['lease_agent', 'landman', 'agent', 'column_29'] },
  { label: 'MAILED', keys: ['column_30', 'mailed_date'], type: 'date' },
  { label: 'LEASE AGENT NOTES', keys: ['lease_agent_notes', 'notes', 'column_31'] },
  { label: 'TITLE DATE REQUESTED', keys: ['title_date_requested', 'column_32'], type: 'date' },
  { label: 'TITLE VERIFIED', keys: ['title_verified', 'column_33'] },
  { label: 'REQUEST NOTES', keys: ['request_notes', 'column_34'] },
  { label: 'LEASE SIGNED AND RETURNED', keys: ['lease_signed_and_returned', 'column_35'] },
  { label: 'BONUS PAID', keys: ['bonus_paid', 'column_36'] },
  { label: 'RECORDED', keys: ['recorded', 'column_37'] },
  { label: 'LPR COMPLETED', keys: ['lpr_completed', 'column_38'] },
  { label: 'CURATIVE IDENTIFIED', keys: ['curative_identified', 'column_39'] },
];

const employeeCrmColumns = [
  { label: 'LEASE NAME', keys: ['lease_name', 'company', 'column_10'] },
  { label: 'STATE', keys: ['state', 'column_11'] },
  { label: 'COUNTY', keys: ['county', 'column_12'] },
  { label: 'LESSOR / OWNER', keys: ['lessor_owner', 'owner_name', 'owner', 'column_13'] },
  { label: 'LESSEE', keys: ['lessee', 'column_14'] },
  { label: 'LEASE DATE', keys: ['column_15', 'lease_date'], type: 'date' },
  { label: 'VOL', keys: ['column_16', 'vol'] },
  { label: 'PG', keys: ['column_17', 'pg'] },
  { label: 'TWN', keys: ['township', 'twp', 'column_18'] },
  { label: 'RNG', keys: ['range', 'rng', 'column_19'] },
  { label: 'SEC', keys: ['section', 'sec', 'column_20'] },
  { label: 'TRACT DESCRIPTION', keys: ['tract_description', 'column_21'] },
  { label: 'STATUS', keys: ['status', 'column_22'], type: 'status' },
  { label: 'GROSS ACRES', keys: ['gross_acres', 'column_23'] },
  { label: 'NET ACRES', keys: ['net_acres', 'column_24'] },
  { label: 'ROYALTY', keys: ['royalty', 'column_25'] },
  { label: 'BONUS AGREED', keys: ['bonus_agreed', 'column_26'] },
  { label: 'TERM (MONTH)', keys: ['term_months', 'term_month', 'column_27'] },
  { label: 'EXTENSION (MONTH)', keys: ['extension_months', 'extension_month', 'column_28'] },
  { label: 'LEASE AGENT', keys: ['lease_agent', 'landman', 'agent', 'column_29'] },
  { label: 'MAILED', keys: ['column_30', 'mailed_date'], type: 'date' },
  { label: 'LEASE AGENT NOTES', keys: ['lease_agent_notes', 'notes', 'column_31'] },
];

const crmColumnEditors = {
  'AMI/AOI': { extraKeys: ['ami_aoi'] },
  'STATE CODE': { extraKeys: ['state_code'] },
  'COUNTY CODE': { extraKeys: ['county_code'] },
  'Location #': { extraKeys: ['location_number'] },
  'Well Name': { extraKeys: ['well_name'] },
  'DSU Name': { extraKeys: ['dsu_name'] },
  'PAD NAME': { extraKeys: ['pad_name'] },
  'LEASE #': { extraKeys: ['lease_number'] },
  'LEASE NAME': { field: 'company', extraKeys: ['lease_name'] },
  'STATE': { extraKeys: ['state'] },
  'COUNTY': { extraKeys: ['county'] },
  'LESSOR / OWNER': { field: 'lessor_owner', extraKeys: ['owner_name', 'owner'] },
  'LESSEE': { field: 'lessee' },
  'LEASE DATE': { field: 'lease_date', type: 'date' },
  'VOL': { field: 'vol' },
  'PG': { field: 'pg' },
  'TWN': { field: 'township', type: 'int' },
  'RNG': { field: 'range', type: 'int' },
  'SEC': { field: 'section', type: 'int' },
  'TRACT DESCRIPTION': { field: 'tract_description' },
  'STATUS': { field: 'status' },
  'GROSS ACRES': { field: 'gross_acres', type: 'float' },
  'NET ACRES': { field: 'net_acres', type: 'float' },
  'ROYALTY': { field: 'royalty' },
  'BONUS AGREED': { field: 'bonus_agreed' },
  'TERM (MONTH)': { field: 'term_months', type: 'int' },
  'EXTENSION (MONTH)': { field: 'extension_months', type: 'int' },
  'LEASE AGENT': { field: 'lease_agent' },
  'MAILED': { field: 'mailed_date', type: 'date' },
  'LEASE AGENT NOTES': { field: 'lease_agent_notes', extraKeys: ['notes'] },
  'TITLE DATE REQUESTED': { extraKeys: ['title_date_requested'], type: 'date' },
  'TITLE VERIFIED': { extraKeys: ['title_verified'] },
  'REQUEST NOTES': { extraKeys: ['request_notes'] },
  'LEASE SIGNED AND RETURNED': { extraKeys: ['lease_signed_and_returned'] },
  'BONUS PAID': { extraKeys: ['bonus_paid'] },
  'RECORDED': { extraKeys: ['recorded'] },
  'LPR COMPLETED': { extraKeys: ['lpr_completed'] },
  'CURATIVE IDENTIFIED': { extraKeys: ['curative_identified'] },
};

function getCrmRoleKey() {
  return currentUser && currentUser.role === 'employee' ? 'employee' : 'manager_admin';
}

function getBaseCrmColumns() {
  return currentUser && currentUser.role === 'employee' ? employeeCrmColumns : adminManagerCrmColumns;
}

function getCrmLayoutState() {
  const roleKey = getCrmRoleKey();
  const baseColumns = getBaseCrmColumns();
  if (!crmLayoutStateByRole[roleKey]) {
    crmLayoutStateByRole[roleKey] = {
      order: baseColumns.map((column) => column.label),
      widths: {},
      rowHeight: DEFAULT_CRM_ROW_HEIGHT,
    };
  }

  const state = crmLayoutStateByRole[roleKey];
  const baseLabels = baseColumns.map((column) => column.label);
  const existing = new Set(state.order);
  baseLabels.forEach((label) => { if (!existing.has(label)) state.order.push(label); });
  state.order = state.order.filter((label) => baseLabels.includes(label));
  return state;
}

function getCrmFilterState() {
  const roleKey = getCrmRoleKey();
  if (!crmFilterStateByRole[roleKey]) crmFilterStateByRole[roleKey] = {};
  return crmFilterStateByRole[roleKey];
}

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item[data-page]').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');

  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  document.getElementById('pageTitle').textContent = pageTitles[page] || page;

  if (page === 'dashboard') loadDashboard();
  if (page === 'crm') loadCRMRecords({});
  if (page === 'workbook-import') loadWorkbookStorageStatus();
  if (page === 'users') loadUsers();
}

document.querySelectorAll('.nav-item[data-page]').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

function syncCrmScrollBar() {
  const viewport = document.getElementById('crmTableViewport');
  const bar = document.getElementById('crmHScroll');
  const inner = document.getElementById('crmHScrollInner');
  const table = document.getElementById('crmTable');
  if (!viewport || !bar || !inner || !table) return;

  const tableWidth = table.scrollWidth;
  inner.style.width = `${tableWidth}px`;
  bar.style.display = tableWidth > viewport.clientWidth ? 'block' : 'none';
}

function bindCrmScrollSync() {
  const viewport = document.getElementById('crmTableViewport');
  const bar = document.getElementById('crmHScroll');
  if (!viewport || !bar || viewport.dataset.scrollSyncBound === '1') return;

  viewport.dataset.scrollSyncBound = '1';
  let syncing = false;

  viewport.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    bar.scrollLeft = viewport.scrollLeft;
    syncing = false;
  });

  bar.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    viewport.scrollLeft = bar.scrollLeft;
    syncing = false;
  });

  window.addEventListener('resize', syncCrmScrollBar);
}

bindCrmScrollSync();

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
    const records = await apiJSON('/crm?limit=300000', { headers: authHeaders() });
    const total = records.length;

    const totalEl = document.getElementById('kpiTotal');
    if (totalEl) totalEl.textContent = total;
    renderDashboardStatusBreakdown(records);
  } catch (err) {
    showToast('Failed to load dashboard: ' + err.message, 'error');
  }
}

function renderDashboardStatusBreakdown(records) {
  const container = document.getElementById('dashStatusBreakdown');
  if (!container) return;

  if (!records.length) {
    container.innerHTML = '<div class="text-muted" style="padding: 20px;">No status data yet</div>';
    return;
  }

  const statusData = new Map();
  records.forEach((r) => {
    const status = (r.status || 'No Contact').trim() || 'No Contact';
    const acresRaw = r.net_acres ?? r.column_24 ?? 0;
    const acresText = String(acresRaw).replace(/,/g, '').trim();
    const acresParsed = Number(acresText);
    const netAcres = Number.isFinite(acresParsed) ? acresParsed : 0;
    
    if (!statusData.has(status)) {
      statusData.set(status, { count: 0, totalAcres: 0 });
    }
    const data = statusData.get(status);
    data.count += 1;
    data.totalAcres += netAcres;
  });

  const sorted = [...statusData.entries()]
    .sort((a, b) => b[1].totalAcres - a[1].totalAcres || a[0].localeCompare(b[0]));
  const topEight = sorted.slice(0, 8);
  
  container.innerHTML = topEight
    .map(([status, data]) => `
      <div class="kpi-card">
        <div class="kpi-label">${esc(status)}</div>
        <div class="kpi-value">${data.totalAcres.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
        <div class="kpi-sub">Net Acres · ${data.count} record${data.count !== 1 ? 's' : ''}</div>
      </div>
    `).join('');
}

function trsCode(r) {
  if (!r.township && !r.range && !r.section) return '—';
  return `T${r.township || '?'}R${r.range || '?'}S${r.section || '?'}`;
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function getCrmColumns() {
  const baseColumns = getBaseCrmColumns();
  const byLabel = new Map(baseColumns.map((column) => [column.label, column]));
  const state = getCrmLayoutState();
  return state.order.map((label) => byLabel.get(label)).filter(Boolean);
}

function getCrmColumnEditor(column) {
  return crmColumnEditors[column.label] || null;
}

function getColumnFilterType(column) {
  if (column.type === 'status') return 'status';
  if (column.type === 'date') return 'date';
  const editor = getCrmColumnEditor(column);
  if (editor && (editor.type === 'int' || editor.type === 'float')) return 'number';
  return 'text';
}

function getColumnWidth(column) {
  const state = getCrmLayoutState();
  if (state.widths[column.label]) return state.widths[column.label];
  return Math.max(140, Math.min(320, 80 + column.label.length * 8));
}

function getColumnFilter(column) {
  const filters = getCrmFilterState();
  if (!filters[column.label]) {
    const t = getColumnFilterType(column);
    filters[column.label] =
      t === 'number' ? { min: '', max: '' }
      : t === 'date' ? { from: '', to: '' }
      : t === 'status' ? { value: '' }
      : { text: '' };
  }
  return filters[column.label];
}

function extractColumnDisplayValue(record, column) {
  const rawValue = getRecordValue(record, column.keys || []);
  const value = rawValue ?? (column.fallback ? column.fallback(record) : null);
  if (value === null || value === undefined || String(value).trim() === '') return '';
  return String(value).trim();
}

function applyCrmColumnFilters(records, columns) {
  return records.filter((record) => {
    for (const column of columns) {
      const type = getColumnFilterType(column);
      const filter = getColumnFilter(column);
      const value = extractColumnDisplayValue(record, column);

      if (type === 'text') {
        const q = (filter.text || '').trim().toLowerCase();
        if (q && !value.toLowerCase().includes(q)) return false;
      } else if (type === 'status') {
        if (filter.value && value !== filter.value) return false;
      } else if (type === 'number') {
        if (!filter.min && !filter.max) continue;
        const n = Number(value.replace(/[^0-9.\-]+/g, ''));
        if (Number.isNaN(n)) return false;
        if (filter.min !== '' && n < Number(filter.min)) return false;
        if (filter.max !== '' && n > Number(filter.max)) return false;
      } else if (type === 'date') {
        if (!filter.from && !filter.to) continue;
        const t = Date.parse(value);
        if (Number.isNaN(t)) return false;
        if (filter.from && t < Date.parse(filter.from)) return false;
        if (filter.to && t > Date.parse(filter.to)) return false;
      }
    }
    return true;
  });
}

function getStatusOptionsForColumn(column) {
  const options = new Set();
  currentCrmRawRecords.forEach((record) => {
    const value = extractColumnDisplayValue(record, column);
    if (value) options.add(value);
  });
  return [...options].sort((a, b) => a.localeCompare(b));
}

function renderCrmFilterControl(column) {
  const filterType = getColumnFilterType(column);
  const filter = getColumnFilter(column);
  const encodedLabel = encodeURIComponent(column.label);

  if (filterType === 'status') {
    const options = getStatusOptionsForColumn(column);
    return `<select class="crm-filter-select" data-filter-label="${encodedLabel}" data-filter-kind="value"><option value="">All</option>${options.map((opt) => `<option value="${esc(opt)}" ${filter.value === opt ? 'selected' : ''}>${esc(opt)}</option>`).join('')}</select>`;
  }

  if (filterType === 'number') {
    return `<div class="crm-filter-number"><input class="crm-filter-input" data-filter-label="${encodedLabel}" data-filter-kind="min" type="number" step="any" placeholder="min" value="${esc(filter.min || '')}" /><input class="crm-filter-input" data-filter-label="${encodedLabel}" data-filter-kind="max" type="number" step="any" placeholder="max" value="${esc(filter.max || '')}" /></div>`;
  }

  if (filterType === 'date') {
    return `<div class="crm-filter-number"><input class="crm-filter-input" data-filter-label="${encodedLabel}" data-filter-kind="from" type="date" value="${esc(filter.from || '')}" /><input class="crm-filter-input" data-filter-label="${encodedLabel}" data-filter-kind="to" type="date" value="${esc(filter.to || '')}" /></div>`;
  }

  return `<input class="crm-filter-input" data-filter-label="${encodedLabel}" data-filter-kind="text" type="text" placeholder="contains" value="${esc(filter.text || '')}" />`;
}

function bindCrmFilterInputs() {
  document.querySelectorAll('.crm-filter-input, .crm-filter-select').forEach((el) => {
    el.addEventListener('input', () => {
      const label = decodeURIComponent(el.dataset.filterLabel || '');
      const kind = el.dataset.filterKind;
      const columns = getCrmColumns();
      const column = columns.find((c) => c.label === label);
      if (!column || !kind) return;
      const filter = getColumnFilter(column);
      filter[kind] = el.value;
      renderCurrentCrmView();
    });
    el.addEventListener('change', () => {
      const label = decodeURIComponent(el.dataset.filterLabel || '');
      const kind = el.dataset.filterKind;
      const columns = getCrmColumns();
      const column = columns.find((c) => c.label === label);
      if (!column || !kind) return;
      const filter = getColumnFilter(column);
      filter[kind] = el.value;
      renderCurrentCrmView();
    });
  });
}

function bindCrmHeaderInteractions() {
  const headers = document.querySelectorAll('#crmThead .crm-col-header');
  const state = getCrmLayoutState();

  headers.forEach((header) => {
    header.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', header.dataset.columnLabel || '');
      e.dataTransfer.effectAllowed = 'move';
    });
    header.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    header.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromLabel = e.dataTransfer.getData('text/plain');
      const toLabel = header.dataset.columnLabel || '';
      if (!fromLabel || !toLabel || fromLabel === toLabel) return;
      const fromIdx = state.order.indexOf(fromLabel);
      const toIdx = state.order.indexOf(toLabel);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = state.order.splice(fromIdx, 1);
      state.order.splice(toIdx, 0, moved);
      renderCurrentCrmView();
    });
  });

  document.querySelectorAll('#crmThead .crm-resize-handle').forEach((handle) => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const label = handle.dataset.columnLabel;
      if (!label) return;
      const startX = e.clientX;
      const col = [...document.querySelectorAll('#crmColgroup col')].find((c) => c.dataset.columnLabel === label);
      const startW = col ? (parseInt(col.style.width, 10) || state.widths[label] || 180) : (state.widths[label] || 180);

      const onMove = (moveEvt) => {
        const next = Math.max(60, Math.min(700, startW + (moveEvt.clientX - startX)));
        state.widths[label] = next;
        if (col) col.style.width = `${next}px`;
        syncCrmScrollBar();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

function applyCrmRowHeight() {
  const table = document.getElementById('crmTable');
  const slider = document.getElementById('crmRowHeight');
  const valEl = document.getElementById('crmRowHeightValue');
  if (!table || !slider || !valEl) return;
  const state = getCrmLayoutState();
  const h = Number(state.rowHeight || DEFAULT_CRM_ROW_HEIGHT);
  table.style.setProperty('--crm-row-height', `${h}px`);
  slider.value = String(h);
  valEl.textContent = `${h}px`;
}

function resetCrmLayout() {
  const roleKey = getCrmRoleKey();
  const baseColumns = getBaseCrmColumns();
  crmLayoutStateByRole[roleKey] = {
    order: baseColumns.map((column) => column.label),
    widths: {},
    rowHeight: DEFAULT_CRM_ROW_HEIGHT,
  };
  crmFilterStateByRole[roleKey] = {};
  applyCrmRowHeight();
  renderCurrentCrmView();
}

function bindCrmControls() {
  const slider = document.getElementById('crmRowHeight');
  const resetBtn = document.getElementById('resetCrmLayoutBtn');
  if (slider && slider.dataset.bound !== '1') {
    slider.dataset.bound = '1';
    slider.addEventListener('input', () => {
      const state = getCrmLayoutState();
      state.rowHeight = Number(slider.value);
      applyCrmRowHeight();
    });
  }
  if (resetBtn && resetBtn.dataset.bound !== '1') {
    resetBtn.dataset.bound = '1';
    resetBtn.addEventListener('click', resetCrmLayout);
  }
}

function getRecordValue(record, keys = []) {
  const extraData = record.extra_data || {};
  for (const key of keys) {
    const directValue = record[key];
    if (directValue !== null && directValue !== undefined && String(directValue).trim() !== '') return directValue;
    const extraValue = extraData[key];
    if (extraValue !== null && extraValue !== undefined && String(extraValue).trim() !== '') return extraValue;
  }
  return null;
}

function formatCrmCell(record, column) {
  const rawValue = getRecordValue(record, column.keys || []);
  const value = rawValue ?? (column.fallback ? column.fallback(record) : null);
  if (value === null || value === undefined || String(value).trim() === '') return '—';
  if (column.type === 'status') return statusBadge(String(value));
  if (column.type === 'date') return esc(fmtDate(value));
  return esc(String(value));
}

function getCrmEditPromptValue(record, column) {
  const rawValue = getRecordValue(record, column.keys || []);
  if (rawValue === null || rawValue === undefined) return '';
  return String(rawValue);
}

function normalizeEditedValue(rawValue, editor) {
  const trimmed = rawValue.trim();
  if (trimmed === '') return null;
  if (editor.type === 'int') {
    const parsed = parseInt(trimmed, 10);
    if (Number.isNaN(parsed)) throw new Error('Enter a whole number');
    return parsed;
  }
  if (editor.type === 'float') {
    const parsed = parseFloat(trimmed);
    if (Number.isNaN(parsed)) throw new Error('Enter a valid number');
    return parsed;
  }
  return trimmed;
}

function buildCrmUpdatePayload(column, value) {
  const editor = getCrmColumnEditor(column);
  if (!editor) return null;

  const normalizedValue = normalizeEditedValue(value, editor);
  if (normalizedValue === null && ['company', 'township', 'range', 'section'].includes(editor.field)) {
    throw new Error(`${column.label} cannot be empty`);
  }
  const payload = {};
  if (editor.field) payload[editor.field] = normalizedValue;
  if (editor.extraKeys && editor.extraKeys.length) {
    payload.extra_data = {};
    editor.extraKeys.forEach((key) => {
      payload.extra_data[key] = normalizedValue;
    });
  }
  return payload;
}

async function editCrmCell(recordIndex, columnIndex) {
  const record = currentCrmRecords[recordIndex];
  const column = getCrmColumns()[columnIndex];
  const editor = getCrmColumnEditor(column);
  if (!record || !column || !editor) return;

  const currentValue = getCrmEditPromptValue(record, column);
  const nextValue = window.prompt(`Edit ${column.label}`, currentValue);
  if (nextValue === null || nextValue === currentValue) return;

  try {
    const payload = buildCrmUpdatePayload(column, nextValue);
    if (!payload) return;
    await apiJSON(`/crm/${record.id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    showToast(`${column.label} updated`, 'success');
    await loadCRMRecords(currentCrmSearchParams);
    await loadDashboard();
  } catch (err) {
    showToast('Update failed: ' + err.message, 'error');
  }
}

function bindCrmEditableCells() {
  document.querySelectorAll('td.crm-editable').forEach((cell) => {
    cell.addEventListener('dblclick', () => {
      editCrmCell(parseInt(cell.dataset.recordIndex, 10), parseInt(cell.dataset.columnIndex, 10));
    });
  });
}

function renderCrmTable(records) {
  const columns = getCrmColumns();
  const colgroup = document.getElementById('crmColgroup');
  const thead = document.getElementById('crmThead');
  const tbody = document.getElementById('crmTbody');
  currentCrmRecords = records;

  colgroup.innerHTML = columns.map((column) => `<col data-column-label="${esc(column.label)}" style="width:${getColumnWidth(column)}px;" />`).join('');

  thead.innerHTML = `
    <tr>
      ${columns.map((column) => `
        <th class="crm-col-header" draggable="true" data-column-label="${esc(column.label)}">
          <div class="crm-header-cell">
            <span class="crm-header-label">${esc(column.label)}</span>
            <span class="crm-drag-handle" title="Drag to move column">::</span>
          </div>
          <span class="crm-resize-handle" data-column-label="${esc(column.label)}" title="Drag to resize"></span>
        </th>
      `).join('')}
    </tr>
    <tr class="crm-filter-row">
      ${columns.map((column) => `<th>${renderCrmFilterControl(column)}</th>`).join('')}
    </tr>
  `;

  if (records.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${columns.length}">No records found</td></tr>`;
    bindCrmHeaderInteractions();
    bindCrmFilterInputs();
    applyCrmRowHeight();
    bindCrmControls();
    syncCrmScrollBar();
    return;
  }

  tbody.innerHTML = records.map((record, recordIndex) => `
    <tr>
      ${columns.map((column, columnIndex) => `<td class="${getCrmColumnEditor(column) ? 'crm-editable' : ''}" data-record-index="${recordIndex}" data-column-index="${columnIndex}">${formatCrmCell(record, column)}</td>`).join('')}
    </tr>`).join('');

  bindCrmEditableCells();
  bindCrmHeaderInteractions();
  bindCrmFilterInputs();
  applyCrmRowHeight();
  bindCrmControls();
  syncCrmScrollBar();
}

function renderCurrentCrmView() {
  const columns = getCrmColumns();
  const filtered = applyCrmColumnFilters(currentCrmRawRecords, columns);
  renderCrmTable(filtered);
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

async function loadWorkbookStorageStatus() {
  const el = document.getElementById('workbookStorageStatus');
  if (!el || !currentUser || !['admin', 'manager'].includes(currentUser.role)) return;

  try {
    const s = await apiJSON('/admin/workbook-storage-status', { headers: authHeaders() });
    el.style.display = 'block';
    if (s.has_workbook_data) {
      el.textContent = `Stored workbook data: READY\nStored workbook file: ${s.has_workbook_file ? `READY (${s.workbook_file_name})` : 'NOT FOUND'}\nStored workbook backup: ${s.has_workbook_backup ? `READY (${s.workbook_backup_name})` : 'NOT FOUND'}\nTabs: ${s.tabs_count}\nWorkbook rows: ${s.workbook_rows}\nCRM rows mapped: ${s.crm_rows_mapped}\nCurrent CRM records: ${s.crm_records_count}`;
    } else {
      el.textContent = `Stored workbook data: NOT FOUND\nStored workbook file: ${s.has_workbook_file ? `READY (${s.workbook_file_name})` : 'NOT FOUND'}\nStored workbook backup: ${s.has_workbook_backup ? `READY (${s.workbook_backup_name})` : 'NOT FOUND'}\nTabs: ${s.tabs_count}\nWorkbook rows: ${s.workbook_rows}\nCRM rows mapped: ${s.crm_rows_mapped}\nCurrent CRM records: ${s.crm_records_count}`;
    }
  } catch (err) {
    el.style.display = 'block';
    el.textContent = `Could not load storage status: ${err.message}`;
  }
}

function renderWorkbookImportSummary(data, mode = 'Import') {
  const summaryEl = document.getElementById('workbookImportSummary');
  if (!summaryEl || !data) return;

  const tabs = Array.isArray(data.tabs) ? data.tabs : [];
  const workbookRowsFromTabs = tabs.reduce((sum, t) => sum + (Number(t.row_count) || 0), 0);
  const workbookRows = Number(data.total_rows_imported ?? workbookRowsFromTabs) || 0;
  const crmRows = Number(data.crm_records_imported || 0);
  const tabsImported = Number(data.tabs_imported || tabs.length || 0);

  summaryEl.style.display = 'block';
  summaryEl.textContent = `${mode} summary\nWorkbook rows found: ${workbookRows}\nCRM rows created: ${crmRows}\nTabs processed: ${tabsImported}`;
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
    renderWorkbookImportSummary(data, 'Import');
    outEl.textContent = JSON.stringify(data, null, 2);
    outEl.style.display = 'block';
    showToast(`Imported ${data.crm_records_imported || 0} CRM records from ${data.tabs_imported} tabs`, 'success');
    await loadWorkbookTabs();
    await loadWorkbookStorageStatus();
    await loadDashboard();
    await loadCRMRecords({});
  } catch (err) {
    outEl.textContent = 'Error: ' + err.message;
    outEl.style.display = 'block';
    showToast('Workbook import failed: ' + err.message, 'error');
  }
});

document.getElementById('rebuildWorkbookBtn').addEventListener('click', async () => {
  const outEl = document.getElementById('workbookImportOut');
  try {
    const data = await apiJSON('/admin/rebuild-crm-from-workbook', {
      method: 'POST',
      headers: authHeaders(),
    });
    renderWorkbookImportSummary(data, 'Rebuild');
    outEl.textContent = JSON.stringify(data, null, 2);
    outEl.style.display = 'block';
    showToast(`Rebuilt ${data.crm_records_imported || 0} CRM records from stored workbook data`, 'success');
    await loadWorkbookTabs();
    await loadWorkbookStorageStatus();
    await loadDashboard();
    await loadCRMRecords(currentCrmSearchParams);
  } catch (err) {
    outEl.textContent = 'Error: ' + err.message;
    outEl.style.display = 'block';
    showToast('Rebuild failed: ' + err.message, 'error');
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
  currentCrmSearchParams = { ...params };
  const qs = new URLSearchParams(params).toString();
  try {
    const path = qs ? `/crm/search?${qs}&limit=300000` : '/crm?limit=300000';
    const records = await apiJSON(path, { headers: authHeaders() });
    currentCrmRawRecords = records;
    renderCurrentCrmView();
  } catch (err) {
    showToast('Search failed: ' + err.message, 'error');
  }
}

// ── CRM Record Modal ───────────────────────────────────────────
const dashAddBtn = document.getElementById('dashAddBtn');
if (dashAddBtn) {
  dashAddBtn.addEventListener('click', () => openModal('crmModal'));
}
document.getElementById('crmAddBtn').addEventListener('click', () => openModal('crmModal'));

document.getElementById('createCrmBtn').addEventListener('click', async () => {
  const body = {
    company:            document.getElementById('crmCompany').value.trim(),
    contact:            document.getElementById('crmContact').value.trim(),
    township:           parseInt(document.getElementById('crmTwp').value) || null,
    range:              parseInt(document.getElementById('crmRange').value) || null,
    section:            parseInt(document.getElementById('crmSec').value) || null,
    status:             document.getElementById('crmStatus').value,
    lease_agent:        document.getElementById('crmLeaseAgent').value.trim() || null,
    lease_agent_notes:  document.getElementById('crmLeaseAgentNotes').value.trim() || null,
    lessor_owner:       document.getElementById('crmLessorOwner').value.trim() || null,
    lessee:             document.getElementById('crmLessee').value.trim() || null,
    lease_date:         document.getElementById('crmLeaseDate').value || null,
    vol:                document.getElementById('crmVol').value.trim() || null,
    pg:                 document.getElementById('crmPg').value.trim() || null,
    tract_description:  document.getElementById('crmTractDescription').value.trim() || null,
    gross_acres:        parseFloat(document.getElementById('crmGrossAcres').value) || null,
    net_acres:          parseFloat(document.getElementById('crmNetAcres').value) || null,
    royalty:            document.getElementById('crmRoyalty').value.trim() || null,
    bonus_agreed:       document.getElementById('crmBonusAgreed').value.trim() || null,
    term_months:        parseInt(document.getElementById('crmTermMonths').value) || null,
    extension_months:   parseInt(document.getElementById('crmExtensionMonths').value) || null,
    mailed_date:        document.getElementById('crmMailedDate').value || null,
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
      tbody.innerHTML = '<tr class="empty-row"><td colspan="3">No users found</td></tr>';
    } else {
      tbody.innerHTML = users.map(u => `
        <tr>
          <td>${esc(u.email)}</td>
          <td>${roleBadge(u.role)}</td>
          <td>
            <button class="btn btn-ghost btn-sm" onclick="openEditUser(${u.id}, '${esc(u.email)}', '${esc(u.role)}')">Edit</button>
          </td>
        </tr>`).join('');
    }
  } catch (err) {
    showToast('Failed to load users: ' + err.message, 'error');
  }
}

function openEditUser(id, email, role) {
  document.getElementById('editUserId').value = id;
  document.getElementById('editUserEmail').value = email;
  document.getElementById('editUserRole').value = role;
  document.getElementById('editUserPassword').value = '';
  openModal('editUserModal');
}

document.getElementById('saveEditUserBtn').addEventListener('click', async () => {
  const id = document.getElementById('editUserId').value;
  const role = document.getElementById('editUserRole').value;
  const password = document.getElementById('editUserPassword').value;
  const body = { role };
  if (password) body.password = password;
  try {
    await apiJSON(`/admin/users/${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body) });
    closeModal('editUserModal');
    showToast('User updated', 'success');
    loadUsers();
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
});

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

// ── Auto-restore session on page load ─────────────────────────
(function restoreSession() {
  const saved = localStorage.getItem('erp_token');
  if (!saved) return;
  try {
    const payload = JSON.parse(atob(saved.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    // Check token expiry (exp is Unix seconds)
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      localStorage.removeItem('erp_token');
      return;
    }
    token = saved;
    currentUser = { email: payload.sub, role: payload.role || 'employee' };
    showApp();
  } catch {
    localStorage.removeItem('erp_token');
  }
})();

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
