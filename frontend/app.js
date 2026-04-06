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
let selectedCrmRecordIds = new Set();
let customProjects = [];

function loadCustomProjects() {
  try {
    const stored = localStorage.getItem('erp_custom_projects');
    customProjects = stored ? JSON.parse(stored) : [];
  } catch { customProjects = []; }
}

function saveCustomProjects() {
  localStorage.setItem('erp_custom_projects', JSON.stringify(customProjects));
}

function getAllProjects() {
  return [
    { key: 'tomahawk', name: 'Tomahawk' },
    { key: 'romulus', name: 'Romulus' },
    ...customProjects,
  ];
}

function getProjectName(key) {
  const k = String(key || '').toLowerCase().trim();
  if (!k) return '';
  const found = getAllProjects().find((p) => p.key === k || p.name.toLowerCase() === k);
  return found ? found.name : key;
}

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
  const classByStatus = {
    'No Contact': 'badge-status-no-contact',
    'No Contact / Unlocatable': 'badge-status-no-contact',
    'Surface Only': 'badge-status-surface-only',
    'Working': 'badge-status-working',
    'Verbally Committed': 'badge-status-verbally-committed',
    'Agreed to Terms': 'badge-status-agreed',
    'Signed / In Hand': 'badge-status-signed',
  };
  const cls = classByStatus[status] || 'badge-closed';
  return `<span class="badge ${cls}">${status}</span>`;
}

function roleBadge(role) {
  const cls = role === 'admin' ? 'badge-admin' : role === 'manager' ? 'badge-manager' : 'badge-employee';
  return `<span class="badge ${cls}">${role}</span>`;
}

function projectBadge(projectKey) {
  const value = (projectKey || '').toLowerCase().trim();
  if (!value || value === 'unassigned') return '<span class="badge badge-employee">Unassigned</span>';
  if (value === 'tomahawk') return '<span class="badge badge-progress">Tomahawk</span>';
  if (value === 'romulus') return '<span class="badge badge-admin">Romulus</span>';
  return `<span class="badge badge-manager">${esc(getProjectName(value))}</span>`;
}

function detectProjectFromRecord(record) {
  const extra = record && record.extra_data ? record.extra_data : {};
  const explicit = String(extra.project_normalized || '').trim().toLowerCase();
  if (explicit === 'tomahawk' || explicit === 'romulus') return explicit;

  const candidates = [
    extra.project,
    extra.project_name,
    extra.work_project,
    extra.program_name,
    extra.workbook_name,
    extra.workbook_sheet,
    extra.workbook_tab_key,
    extra.ami_aoi,
    extra.oklahoma_county_tomahawk_project,
    record.company,
    record.contact,
    record.lease_agent,
    record.lessor_owner,
    record.lessee,
  ]
    .filter((v) => v !== null && v !== undefined)
    .map((v) => String(v).toLowerCase());

  if (candidates.some((v) => v.includes('romulus'))) return 'romulus';
  if (candidates.some((v) => v.includes('tomahawk'))) return 'tomahawk';
  return '';
}

function updateProjectSearchDropdown() {
  const select = document.getElementById('searchProject');
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">All projects</option>` +
    getAllProjects().map((p) => `<option value="${esc(p.key)}"${current === p.key ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
}

function updateCrmBatchBar() {
  const bar = document.getElementById('crmBatchBar');
  const countEl = document.getElementById('crmSelectionCount');
  if (!bar) return;
  if (selectedCrmRecordIds.size > 0) {
    bar.style.display = 'flex';
    if (countEl) countEl.textContent = `${selectedCrmRecordIds.size} record${selectedCrmRecordIds.size === 1 ? '' : 's'} selected`;
  } else {
    bar.style.display = 'none';
  }
}

function getSelectedCrmRecords() {
  return currentCrmRawRecords.filter((record) => selectedCrmRecordIds.has(record.id));
}

function getBatchTargetRecords() {
  const scope = document.getElementById('batchEditScope')?.value || 'selected';
  if (scope === 'visible') return currentCrmRecords;
  return getSelectedCrmRecords();
}

function renderBatchIndividualRows(column) {
  const container = document.getElementById('batchIndividualRows');
  if (!container) return;
  const targetRecords = getBatchTargetRecords();
  if (targetRecords.length === 0) {
    container.innerHTML = '<div class="text-muted">No records in scope.</div>';
    return;
  }

  container.innerHTML = targetRecords.map((record) => {
    const label = record.company || record.lessor_owner || record.contact || `Record ${record.id}`;
    const currentValue = getCrmEditPromptValue(record, column);
    return `
      <div class="batch-individual-row">
        <label for="batchValue_${record.id}">${esc(label)}</label>
        <input id="batchValue_${record.id}" class="batch-individual-input" data-record-id="${record.id}" value="${esc(currentValue)}" autocomplete="off" />
      </div>
    `;
  }).join('');
}

function syncBatchEditModeUI() {
  const mode = document.getElementById('batchEditMode')?.value || 'replace';
  const replaceSection = document.getElementById('batchReplaceSection');
  const individualSection = document.getElementById('batchIndividualSection');
  if (replaceSection) replaceSection.style.display = mode === 'replace' ? '' : 'none';
  if (individualSection) individualSection.style.display = mode === 'individual' ? '' : 'none';
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

  loadCustomProjects();
  updateProjectSearchDropdown();
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
  { label: 'PROJECT', keys: ['project_normalized', 'project', 'project_name'], type: 'project', fallback: (record) => detectProjectFromRecord(record) || 'unassigned' },
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
  { label: 'PROJECT', keys: ['project_normalized', 'project', 'project_name'], type: 'project', fallback: (record) => detectProjectFromRecord(record) || 'unassigned' },
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
  'PROJECT': { extraKeys: ['project_normalized', 'project', 'project_name'], type: 'project' },
  'AMI/AOI': { extraKeys: ['ami_aoi'] },
  'STATE CODE': { extraKeys: ['state_code'] },
  'COUNTY CODE': { extraKeys: ['county_code'] },
  'T-R-S': { type: 'trs', extraKeys: ['t_r_s', 'trs'] },
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
    const summary = await apiJSON('/dashboard/summary', { headers: authHeaders() });
    renderDashboard(summary);
  } catch (err) {
    showToast('Failed to load dashboard: ' + err.message, 'error');
  }
}

function formatMetric(value, digits = 2) {
  const num = Number(value || 0);
  return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

function renderStatusRows(statuses, roleTitle) {
  if (!Array.isArray(statuses) || statuses.length === 0) {
    return `<tr class="empty-row"><td colspan="4">No ${esc(roleTitle)} status data yet</td></tr>`;
  }

  return statuses.slice(0, 10).map((row) => `
    <tr>
      <td>${statusBadge(row.status || 'No Contact')}</td>
      <td>${formatMetric(row.record_count, 0)}</td>
      <td>${formatMetric(row.net_acres_total, 2)}</td>
      <td>${formatMetric(row.variable_count, 0)}</td>
    </tr>
  `).join('');
}

function renderProjectSummaryCard(summary, scopeLabel) {
  if (!summary) {
    return `<div class="kpi-card"><div class="kpi-label">${esc(scopeLabel)}</div><div class="kpi-sub">No data</div></div>`;
  }

  return `
    <div class="dashboard-project-card">
      <div class="card-header">
        <h3>${esc(summary.project_name)} Dashboard</h3>
        <span class="badge badge-manager">${esc(scopeLabel)}</span>
      </div>
      <div class="card-body">
        <div class="kpi-grid dashboard-mini-kpis">
          <div class="kpi-card"><div class="kpi-label">Total Records</div><div class="kpi-value">${formatMetric(summary.total_records, 0)}</div></div>
          <div class="kpi-card"><div class="kpi-label">Total Net Acres</div><div class="kpi-value">${formatMetric(summary.total_net_acres, 2)}</div></div>
          <div class="kpi-card"><div class="kpi-label">Variable Count</div><div class="kpi-value">${formatMetric(summary.variable_count, 0)}</div></div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Status</th><th>Records</th><th>Net Acres</th><th>Variables</th></tr></thead>
            <tbody>${renderStatusRows(summary.statuses, summary.project_name)}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderDashboard(summary) {
  const totalEl = document.getElementById('kpiTotal');
  const netAcreEl = document.getElementById('kpiNetAcres');
  const variableEl = document.getElementById('kpiVariables');
  const scopeEl = document.getElementById('kpiScope');
  const gridEl = document.getElementById('dashProjectPanels');

  if (!summary || !summary.master_summary) {
    if (gridEl) gridEl.innerHTML = '<div class="card"><div class="card-body text-muted">No dashboard data available.</div></div>';
    if (totalEl) totalEl.textContent = '0';
    if (netAcreEl) netAcreEl.textContent = '0';
    if (variableEl) variableEl.textContent = '0';
    if (scopeEl) scopeEl.textContent = 'No records in scope';
    return;
  }

  const role = summary.role || (currentUser ? currentUser.role : 'employee');
  const scopeLabel = role === 'admin' ? 'Admin' : role === 'manager' ? 'Manager' : 'Employee';
  const master = summary.master_summary;

  if (totalEl) totalEl.textContent = formatMetric(master.total_records, 0);
  if (netAcreEl) netAcreEl.textContent = formatMetric(master.total_net_acres, 2);
  if (variableEl) variableEl.textContent = formatMetric(master.variable_count, 0);
  if (scopeEl) scopeEl.textContent = `${scopeLabel} scope · ${formatMetric(summary.scope_record_count, 0)} record${Number(summary.scope_record_count) === 1 ? '' : 's'}`;

  if (!gridEl) return;

  const byKey = new Map((summary.project_summaries || []).map((item) => [item.project_key, item]));
  const panels = [];

  if (role === 'admin') {
    panels.push(renderProjectSummaryCard(byKey.get('tomahawk'), 'Admin Scope'));
    panels.push(renderProjectSummaryCard(byKey.get('romulus'), 'Admin Scope'));
    panels.push(renderProjectSummaryCard(master, 'Master Combined'));
  } else if (role === 'manager') {
    panels.push(renderProjectSummaryCard(byKey.get('tomahawk'), 'Manager Scope'));
    panels.push(renderProjectSummaryCard(byKey.get('romulus'), 'Manager Scope'));
    panels.push(renderProjectSummaryCard(master, 'Combined View'));
  } else {
    panels.push(renderProjectSummaryCard(master, 'Assigned Portfolio'));
  }

  gridEl.innerHTML = panels.join('');
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
  if (column.type === 'project') return 'project';
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
      : t === 'project' ? { value: '' }
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
      } else if (type === 'project') {
        if (filter.value && value.toLowerCase() !== filter.value.toLowerCase()) return false;
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

  if (filterType === 'project') {
    const projectOptions = [...getAllProjects(), { key: 'unassigned', name: 'Unassigned' }];
    return `<select class="crm-filter-select" data-filter-label="${encodedLabel}" data-filter-kind="value"><option value="">All</option>${projectOptions.map((p) => `<option value="${esc(p.key)}" ${filter.value === p.key ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
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
  const clearFiltersBtn = document.getElementById('clearCrmFiltersBtn');
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
  if (clearFiltersBtn && clearFiltersBtn.dataset.bound !== '1') {
    clearFiltersBtn.dataset.bound = '1';
    clearFiltersBtn.addEventListener('click', () => {
      const roleKey = getCrmRoleKey();
      crmFilterStateByRole[roleKey] = {};
      renderCurrentCrmView();
    });
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
  if (column.type === 'project') return projectBadge(String(value));
  if (column.type === 'date') return esc(fmtDate(value));
  return esc(String(value));
}

function getCrmEditPromptValue(record, column) {
  if (column.label === 'T-R-S') {
    const t = record.township ?? '?';
    const r = record.range ?? '?';
    const s = record.section ?? '?';
    return `T${t}R${r}S${s}`;
  }
  if (column.label === 'PROJECT') {
    return detectProjectFromRecord(record) || '';
  }
  const rawValue = getRecordValue(record, column.keys || []);
  if (rawValue === null || rawValue === undefined) return '';
  return String(rawValue);
}

function parseTrsValue(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Enter T-R-S as T25R9S14 or 25-9-14');

  const compact = raw.toUpperCase().replace(/\s+/g, '');
  const labeled = compact.match(/^T?(\d+)R(\d+)S(\d+)$/);
  if (labeled) {
    return { township: Number(labeled[1]), range: Number(labeled[2]), section: Number(labeled[3]) };
  }

  const parts = raw.split(/[^0-9]+/).filter(Boolean);
  if (parts.length === 3) {
    return { township: Number(parts[0]), range: Number(parts[1]), section: Number(parts[2]) };
  }

  throw new Error('Invalid T-R-S format. Use T25R9S14 or 25-9-14');
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

  if (editor.type === 'trs') {
    const parsed = parseTrsValue(value);
    const trsText = `T${parsed.township}R${parsed.range}S${parsed.section}`;
    return {
      township: parsed.township,
      range: parsed.range,
      section: parsed.section,
      extra_data: {
        t_r_s: trsText,
        trs: trsText,
      },
    };
  }

  if (editor.type === 'project') {
    const inputRaw = String(value || '').trim();
    const inputLower = inputRaw.toLowerCase();
    const isUnassigned = !inputLower || ['unassigned', 'none', 'blank', '\u2014', '-'].includes(inputLower);
    if (isUnassigned) {
      return { extra_data: { project_normalized: null, project: null, project_name: null } };
    }
    const matched = getAllProjects().find((p) => p.key === inputLower || p.name.toLowerCase() === inputLower);
    const projectKey = matched ? matched.key : inputLower.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const projectName = matched ? matched.name : inputRaw;
    return {
      extra_data: {
        project_normalized: projectKey,
        project: projectKey,
        project_name: projectName,
      },
    };
  }

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
  let promptLabel = `Edit ${column.label}`;
  if (editor.type === 'project') {
    promptLabel += ` (${getAllProjects().map((p) => p.name).join(', ')})`;
  }
  const nextValue = window.prompt(promptLabel, currentValue);
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

async function saveCrmCellInline(record, column, value) {
  const payload = buildCrmUpdatePayload(column, value);
  if (!payload) return;
  await apiJSON(`/crm/${record.id}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
}

function startInlineCrmCellEdit(cell) {
  if (!cell || cell.dataset.editing === '1') return;

  const recordIndex = parseInt(cell.dataset.recordIndex, 10);
  const columnIndex = parseInt(cell.dataset.columnIndex, 10);
  const record = currentCrmRecords[recordIndex];
  const column = getCrmColumns()[columnIndex];
  const editor = getCrmColumnEditor(column);
  if (!record || !column || !editor) return;

  const original = getCrmEditPromptValue(record, column);
  cell.dataset.editing = '1';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'crm-inline-editor';
  input.value = original;
  input.setAttribute('aria-label', `Edit ${column.label}`);

  if (editor.type === 'project') {
    input.placeholder = getAllProjects().map((p) => p.name).join(', ');
  }

  cell.textContent = '';
  cell.appendChild(input);
  input.focus();
  input.select();

  let finished = false;
  const cancel = () => {
    if (finished) return;
    finished = true;
    delete cell.dataset.editing;
    cell.innerHTML = formatCrmCell(record, column);
  };

  const commit = async () => {
    if (finished) return;
    finished = true;
    const nextValue = input.value;
    if (nextValue === original) {
      delete cell.dataset.editing;
      cell.innerHTML = formatCrmCell(record, column);
      return;
    }

    input.disabled = true;
    try {
      await saveCrmCellInline(record, column, nextValue);
      delete cell.dataset.editing;
      showToast(`${column.label} updated`, 'success');
      await loadCRMRecords(currentCrmSearchParams);
      await loadDashboard();
    } catch (err) {
      delete cell.dataset.editing;
      cell.innerHTML = formatCrmCell(record, column);
      showToast('Update failed: ' + err.message, 'error');
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  });

  input.addEventListener('blur', () => {
    commit();
  });
}

function bindCrmEditableCells() {
  document.querySelectorAll('td.crm-editable').forEach((cell) => {
    cell.addEventListener('click', () => {
      startInlineCrmCellEdit(cell);
    });
  });
}

function bindCrmRowCheckboxes() {
  const selectAll = document.getElementById('selectAllCrmRows');
  if (selectAll) {
    selectAll.addEventListener('change', () => {
      document.querySelectorAll('.crm-row-check').forEach((cb) => {
        cb.checked = selectAll.checked;
        const id = parseInt(cb.dataset.recordId, 10);
        if (selectAll.checked) selectedCrmRecordIds.add(id);
        else selectedCrmRecordIds.delete(id);
      });
      updateCrmBatchBar();
    });
  }
  document.querySelectorAll('.crm-row-check').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = parseInt(cb.dataset.recordId, 10);
      if (cb.checked) selectedCrmRecordIds.add(id);
      else selectedCrmRecordIds.delete(id);
      updateCrmBatchBar();
      const allCbs = document.querySelectorAll('.crm-row-check');
      const sa = document.getElementById('selectAllCrmRows');
      if (sa) sa.checked = allCbs.length > 0 && [...allCbs].every((c) => c.checked);
    });
  });
}

function renderCrmTable(records) {
  const columns = getCrmColumns();
  const colgroup = document.getElementById('crmColgroup');
  const thead = document.getElementById('crmThead');
  const tbody = document.getElementById('crmTbody');
  currentCrmRecords = records;

  const allChecked = currentCrmRecords.length > 0 && currentCrmRecords.every((r) => selectedCrmRecordIds.has(r.id));
  colgroup.innerHTML = `<col style="width:40px;" />` + columns.map((column) => `<col data-column-label="${esc(column.label)}" style="width:${getColumnWidth(column)}px;" />`).join('');

  thead.innerHTML = `
    <tr>
      <th class="crm-check-th"><input type="checkbox" id="selectAllCrmRows" ${allChecked && currentCrmRecords.length > 0 ? 'checked' : ''} /></th>
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
      <th></th>
      ${columns.map((column) => `<th>${renderCrmFilterControl(column)}</th>`).join('')}
    </tr>
  `;

  if (records.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${columns.length + 1}">No records found</td></tr>`;
    bindCrmRowCheckboxes();
    bindCrmHeaderInteractions();
    bindCrmFilterInputs();
    applyCrmRowHeight();
    bindCrmControls();
    syncCrmScrollBar();
    return;
  }

  tbody.innerHTML = records.map((record, recordIndex) => `
    <tr class="${selectedCrmRecordIds.has(record.id) ? 'crm-row-selected' : ''}">
      <td class="crm-check-cell"><input type="checkbox" class="crm-row-check" data-record-id="${record.id}" ${selectedCrmRecordIds.has(record.id) ? 'checked' : ''} /></td>
      ${columns.map((column, columnIndex) => `<td class="${getCrmColumnEditor(column) ? 'crm-editable' : ''}" data-record-index="${recordIndex}" data-column-index="${columnIndex}">${formatCrmCell(record, column)}</td>`).join('')}
    </tr>`).join('');

  bindCrmRowCheckboxes();
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
    // Ensure tabs is an array
    workbookTabs = Array.isArray(tabs) ? tabs : [];
    renderWorkbookNav(workbookTabs);
  } catch (err) {
    workbookTabs = [];
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

const reclassifyProjectsBtn = document.getElementById('reclassifyProjectsBtn');
if (reclassifyProjectsBtn) {
  reclassifyProjectsBtn.addEventListener('click', async () => {
    const outEl = document.getElementById('workbookImportOut');
    try {
      const data = await apiJSON('/admin/projects/reclassify', {
        method: 'POST',
        headers: authHeaders(),
      });
      outEl.textContent = JSON.stringify(data, null, 2);
      outEl.style.display = 'block';
      showToast(`Projects normalized for ${data.updated_records || 0} record(s)`, 'success');
      await loadDashboard();
      await loadCRMRecords(currentCrmSearchParams);
    } catch (err) {
      outEl.textContent = 'Error: ' + err.message;
      outEl.style.display = 'block';
      showToast('Project reclassification failed: ' + err.message, 'error');
    }
  });
}

// ── CRM Records ────────────────────────────────────────────────
document.getElementById('searchAllBtn').addEventListener('click', () => loadCRMRecords({}));
document.getElementById('searchBtn').addEventListener('click', () => {
  const params = {};
  const twp = document.getElementById('searchTwp').value;
  const rng = document.getElementById('searchRange').value;
  const sec = document.getElementById('searchSec').value;
  const status = document.getElementById('searchStatus').value;
  const project = document.getElementById('searchProject').value;
  if (twp) params.township = twp;
  if (rng) params.range = rng;
  if (sec) params.section = sec;
  if (status) params.status = status;
  if (project) params.project = project;
  loadCRMRecords(params);
});

async function loadCRMRecords(params) {
  currentCrmSearchParams = { ...params };
  const qs = new URLSearchParams(params).toString();
  try {
    const path = qs ? `/crm/search?${qs}&limit=300000` : '/crm?limit=300000';
    const records = await apiJSON(path, { headers: authHeaders() });
    
    // Ensure records is an array
    if (!Array.isArray(records)) {
      showToast('CRM data is invalid', 'error');
      currentCrmRawRecords = [];
    } else {
      currentCrmRawRecords = records;
    }
    renderCurrentCrmView();
  } catch (err) {
    showToast('Search failed: ' + err.message, 'error');
    currentCrmRawRecords = [];
    renderCurrentCrmView();
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

// ── Add Project ────────────────────────────────────────────────
document.getElementById('addProjectBtn').addEventListener('click', () => {
  document.getElementById('newProjectName').value = '';
  openModal('addProjectModal');
});

document.getElementById('saveNewProjectBtn').addEventListener('click', () => {
  const name = document.getElementById('newProjectName').value.trim();
  if (!name) { showToast('Enter a project name', 'error'); return; }
  const key = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  if (!key) { showToast('Invalid project name', 'error'); return; }
  if (getAllProjects().some((p) => p.key === key)) {
    showToast(`Project "${name}" already exists`, 'error');
    return;
  }
  customProjects.push({ key, name });
  saveCustomProjects();
  closeModal('addProjectModal');
  showToast(`Project "${name}" added`, 'success');
  updateProjectSearchDropdown();
});

// ── Batch Find & Replace ───────────────────────────────────────
document.getElementById('batchEditBtn').addEventListener('click', () => {
  const colSelect = document.getElementById('batchEditColumn');
  const modeSelect = document.getElementById('batchEditMode');
  const scopeSelect = document.getElementById('batchEditScope');
  const editableCols = getCrmColumns().filter((col) => getCrmColumnEditor(col));
  if (editableCols.length === 0) { showToast('No editable columns available', 'error'); return; }

  const hasSelected = selectedCrmRecordIds.size > 0;
  scopeSelect.value = hasSelected ? 'selected' : 'visible';
  colSelect.innerHTML = editableCols.map((col) => `<option value="${esc(col.label)}">${esc(col.label)}</option>`).join('');
  modeSelect.value = 'replace';
  document.getElementById('batchFindValue').value = '';
  document.getElementById('batchReplaceValue').value = '';
  const scopeCount = getBatchTargetRecords().length;
  document.getElementById('batchEditStatus').textContent = `Will apply to ${scopeCount} record(s) in current scope.`;
  syncBatchEditModeUI();
  renderBatchIndividualRows(editableCols[0]);
  openModal('findReplaceModal');
});

document.getElementById('batchEditMode').addEventListener('change', () => {
  const colLabel = document.getElementById('batchEditColumn').value;
  const column = getCrmColumns().find((c) => c.label === colLabel);
  syncBatchEditModeUI();
  if (column) renderBatchIndividualRows(column);
});

document.getElementById('batchEditColumn').addEventListener('change', () => {
  const colLabel = document.getElementById('batchEditColumn').value;
  const column = getCrmColumns().find((c) => c.label === colLabel);
  if (column) renderBatchIndividualRows(column);
});

document.getElementById('batchEditScope').addEventListener('change', () => {
  const colLabel = document.getElementById('batchEditColumn').value;
  const column = getCrmColumns().find((c) => c.label === colLabel);
  const count = getBatchTargetRecords().length;
  const statusEl = document.getElementById('batchEditStatus');
  if (statusEl) statusEl.textContent = `Will apply to ${count} record(s) in current scope.`;
  if (column) renderBatchIndividualRows(column);
});

document.getElementById('clearSelectionBtn').addEventListener('click', () => {
  selectedCrmRecordIds.clear();
  updateCrmBatchBar();
  renderCurrentCrmView();
});

document.getElementById('executeBatchEditBtn').addEventListener('click', async () => {
  const colLabel = document.getElementById('batchEditColumn').value;
  const mode = document.getElementById('batchEditMode').value;
  const findValue = document.getElementById('batchFindValue').value;
  const replaceValue = document.getElementById('batchReplaceValue').value;
  const statusEl = document.getElementById('batchEditStatus');
  if (!colLabel) { showToast('Select a column', 'error'); return; }
  const column = getCrmColumns().find((c) => c.label === colLabel);
  if (!column) { showToast('Column not found', 'error'); return; }

  const targetRecords = getBatchTargetRecords();
  if (targetRecords.length === 0) {
    statusEl.textContent = 'No records available in current scope.';
    return;
  }

  let successes = 0;
  let failures = 0;

  if (mode === 'replace') {
    let payload;
    try {
      payload = buildCrmUpdatePayload(column, replaceValue);
    } catch (err) {
      showToast('Invalid value: ' + err.message, 'error');
      return;
    }
    if (!payload) { showToast('No payload generated', 'error'); return; }

    const findTrimmed = findValue.trim().toLowerCase();
    const candidates = findTrimmed
      ? targetRecords.filter((r) => getCrmEditPromptValue(r, column).toLowerCase().includes(findTrimmed))
      : targetRecords;
    if (candidates.length === 0) { statusEl.textContent = 'No matching records found.'; return; }
    statusEl.textContent = `Updating ${candidates.length} record(s)...`;

    for (const record of candidates) {
      try {
        await apiJSON(`/crm/${record.id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
        successes++;
      } catch {
        failures++;
      }
    }
  } else {
    statusEl.textContent = `Updating ${targetRecords.length} record(s) with individual values...`;
    for (const record of targetRecords) {
      const inputEl = document.getElementById(`batchValue_${record.id}`);
      if (!inputEl) continue;
      try {
        const payload = buildCrmUpdatePayload(column, inputEl.value);
        if (!payload) continue;
        await apiJSON(`/crm/${record.id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
        successes++;
      } catch {
        failures++;
      }
    }
  }

  closeModal('findReplaceModal');
  showToast(failures > 0 ? `Updated ${successes}, failed ${failures}` : `Updated ${successes} record(s)`, failures > 0 ? 'error' : 'success');
  selectedCrmRecordIds.clear();
  updateCrmBatchBar();
  await loadCRMRecords(currentCrmSearchParams);
  await loadDashboard();
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
