// ============================================================
// GasTrack - Frontend Application Logic
// ============================================================

// --- State ---
let currentFirmId = 1;
let currentFirm = {};
let CYLINDER_TYPES = []; // [{id, label, price}]
let stock = {};
let emptyStock = {};
let customers = [];
let transactions = [];
let inventoryLogs = [];
let currentTab = 'dashboard';
let selectedCustomers = new Set();
let showFrequentOnly = false;
let currentReceiptData = null;
let connectionMode = 'new';

// --- API Helper ---
async function apiCall(method, path, body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== null) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

function updateStateFromFirmData(data) {
    currentFirm    = data.firm;
    CYLINDER_TYPES = data.cylinderTypes  || [];
    stock          = data.stock          || {};
    emptyStock     = data.emptyStock     || {};
    customers      = data.customers      || [];
    transactions   = data.transactions   || [];
    inventoryLogs  = data.inventoryLogs  || [];
}

async function loadFirmData(firmId) {
    try {
        const data = await apiCall('GET', `/api/firms/${firmId}`);
        updateStateFromFirmData(data);
        renderAll();
    } catch (e) {
        showErrorModal('Failed to load firm data: ' + e.message);
    }
}

function renderAll() {
    updateFirmHeader();
    renderDashboard();
    renderTransactions();
    renderStock();
    renderProducts();
    renderCustomers();
    populateOrderCustomerSelect();
    if (window.lucide) lucide.createIcons();
}

function updateFirmHeader() {
    const name    = currentFirm.name     || 'GasTrack';
    const loc     = currentFirm.location || '';
    const phone   = currentFirm.phone    || '';
    const details = [loc, phone].filter(Boolean).join(' | ');
    document.getElementById('sidebar-firm-name').textContent    = name;
    document.getElementById('sidebar-firm-details').textContent = details;
    document.getElementById('mobile-firm-name').textContent     = name;
    document.getElementById('mobile-firm-loc').textContent      = loc;
}

// ============================================================
// Tab / Firm Navigation
// ============================================================
function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('[id^="view-"]').forEach(el => el.classList.add('hidden'));
    const view = document.getElementById('view-' + tab);
    if (view) { view.classList.remove('hidden'); view.classList.add('fade-in'); }

    document.querySelectorAll('.nav-item').forEach(btn => {
        const active = btn.dataset.tab === tab;
        btn.classList.toggle('bg-slate-800', active);
        btn.classList.toggle('text-white',   active);
        btn.classList.toggle('text-slate-400', !active);
    });
    document.querySelectorAll('.nav-item-mobile').forEach(btn => {
        const active = btn.dataset.tab === tab;
        btn.classList.toggle('text-blue-600',       active);
        btn.classList.toggle('dark:text-blue-400',  active);
        btn.classList.toggle('text-slate-400',      !active);
    });
    const titles = { dashboard: 'Dashboard', transactions: 'History', stock: 'Inventory', customers: 'Customers' };
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = titles[tab] || tab;
}

async function switchFirm(firmId) {
    currentFirmId = firmId;
    closeAdminModal();
    await loadFirmData(firmId);
}

// ============================================================
// Dashboard
// ============================================================
function getDateRange() {
    const range = document.getElementById('report-range')?.value || 'today';
    const today = new Date();
    const fmt   = d => d.toISOString().split('T')[0];
    if (range === 'today')  return { start: fmt(today), end: fmt(today) };
    if (range === 'week')   { const d = new Date(today); d.setDate(d.getDate() - d.getDay()); return { start: fmt(d), end: fmt(today) }; }
    if (range === 'month')  return { start: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), end: fmt(today) };
    if (range === 'year')   return { start: fmt(new Date(today.getFullYear(), 0, 1)), end: fmt(today) };
    if (range === 'custom') return { start: document.getElementById('report-start')?.value || '', end: document.getElementById('report-end')?.value || '' };
    return { start: '', end: '' };
}

function filterByRange(txns) {
    const { start, end } = getDateRange();
    if (!start && !end) return txns;
    return txns.filter(t => {
        if (start && t.date < start) return false;
        if (end   && t.date > end)   return false;
        return true;
    });
}

function toggleReportCustomDates(val) {
    document.getElementById('report-custom-dates')?.classList.toggle('hidden', val !== 'custom');
}

function renderDashboard() {
    const filtered      = filterByRange(transactions);
    const totalRevenue  = filtered.reduce((s, t) => s + (t.total || 0), 0);
    const deliveredCnt  = filtered.filter(t => t.status === 'Delivered').length;
    const pendingCnt    = filtered.filter(t => t.status === 'Pending').length;
    const cylindersOut  = filtered.reduce((s, t) => s + (t.items || []).reduce((ss, i) => ss + (i.filled || 0), 0), 0);

    // Stats cards
    const statsEl = document.getElementById('dashboard-stats');
    if (statsEl) statsEl.innerHTML = [
        statCard('₹' + totalRevenue.toFixed(2), 'Total Revenue',     'trending-up',  'blue'),
        statCard(deliveredCnt,                  'Delivered',          'check-circle', 'green'),
        statCard(pendingCnt,                    'Pending Returns',    'clock',        'amber'),
        statCard(cylindersOut,                  'Cylinders Out',      'package',      'purple'),
    ].join('');

    // Stock distribution cards
    const stockEl = document.getElementById('dashboard-stock-cards');
    if (stockEl) {
        stockEl.innerHTML = CYLINDER_TYPES.map(ct => {
            const f = stock[ct.id] || 0, e = emptyStock[ct.id] || 0;
            const total = f + e, pct = total > 0 ? Math.round((f / total) * 100) : 0;
            return `<div class="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm">
                <div class="flex justify-between items-start mb-2">
                    <h4 class="font-bold text-slate-800 dark:text-slate-200">${ct.label}</h4>
                    <span class="text-xs text-slate-500 dark:text-slate-400">${pct}%</span>
                </div>
                <div class="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 mb-3">
                    <div class="bg-blue-500 h-2 rounded-full" style="width:${pct}%"></div>
                </div>
                <div class="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>Filled: <strong class="text-slate-700 dark:text-slate-200">${f}</strong></span>
                    <span>Empty: <strong class="text-slate-700 dark:text-slate-200">${e}</strong></span>
                </div>
            </div>`;
        }).join('') || '<p class="text-slate-400 col-span-full text-sm">No products configured.</p>';
    }

    // Alerts
    const alertsEl = document.getElementById('dashboard-alerts');
    if (alertsEl) {
        const alerts = [];
        const todayStr = new Date().toISOString().split('T')[0];
        CYLINDER_TYPES.forEach(ct => {
            if ((stock[ct.id] || 0) < 5)
                alerts.push(`Low filled stock: <strong>${ct.label}</strong> (${stock[ct.id] || 0} remaining)`);
        });
        transactions.forEach(t => {
            (t.items || []).forEach(item => {
                const pending = (item.filled || 0) - (item.empty || 0);
                if (pending > 0 && item.dueDate && item.dueDate < todayStr) {
                    const cust = customers.find(c => c.id === t.customerId);
                    alerts.push(`Overdue return: <strong>${cust ? cust.name : 'Unknown'}</strong> – ${item.type} (${pending} cylinders, due ${item.dueDate})`);
                }
            });
        });
        if (alerts.length === 0) {
            alertsEl.innerHTML = '<p class="text-sm text-green-600 dark:text-green-400 flex items-center"><i data-lucide="check-circle" size="16" class="mr-2"></i> All systems normal.</p>';
        } else {
            alertsEl.innerHTML = alerts.slice(0, 5).map(a =>
                `<div class="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400 mb-2">
                    <i data-lucide="alert-triangle" size="16" class="mt-0.5 flex-shrink-0"></i>
                    <span>${a}</span>
                </div>`
            ).join('');
        }
    }

    // Recent transactions
    const recentEl = document.getElementById('dashboard-recent-table');
    if (recentEl) {
        const rows = filtered.slice(0, 10);
        if (rows.length === 0) {
            recentEl.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400">No transactions in this period.</td></tr>`;
        } else {
            recentEl.innerHTML = rows.map(t => {
                const cust   = customers.find(c => c.id === t.customerId);
                const name   = cust ? cust.name : (t.customerId ? 'Unknown' : 'Walk-in');
                const detail = (t.items || []).map(i => `${i.filled}×${i.type}`).join(', ');
                return `<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td class="p-4">
                        <p class="font-medium text-slate-800 dark:text-slate-200">${name}</p>
                        <p class="text-xs text-slate-400">#${t.id}</p>
                    </td>
                    <td class="p-4 text-slate-600 dark:text-slate-400 text-sm">${detail}</td>
                    <td class="p-4 font-medium text-slate-800 dark:text-slate-200">₹${(t.total || 0).toFixed(2)}</td>
                    <td class="p-4">${statusBadge(t.status)}</td>
                </tr>`;
            }).join('');
        }
    }
    if (window.lucide) lucide.createIcons();
}

function statCard(value, label, icon, color) {
    const palette = {
        blue:   'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
        green:  'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
        amber:  'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
        purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
    };
    return `<div class="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm">
        <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium text-slate-500 dark:text-slate-400">${label}</span>
            <div class="p-2 rounded-lg ${palette[color] || ''}"><i data-lucide="${icon}" size="18"></i></div>
        </div>
        <p class="text-2xl font-bold text-slate-800 dark:text-white">${value}</p>
    </div>`;
}

function statusBadge(status) {
    if (status === 'Delivered')
        return `<span class="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Delivered</span>`;
    return `<span class="px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Pending</span>`;
}

async function generateReport() {
    const { start, end } = getDateRange();
    const filtered  = filterByRange(transactions);
    const totalRev  = filtered.reduce((s, t) => s + (t.total || 0), 0);

    const bodyRows = filtered.map(t => {
        const cust = customers.find(c => c.id === t.customerId);
        const items = (t.items || []).map(i => `${i.filled}×${i.type}`).join(', ');
        return `<tr>
            <td style="padding:6px 8px;border:1px solid #e2e8f0;">#${t.id}</td>
            <td style="padding:6px 8px;border:1px solid #e2e8f0;">${t.date}</td>
            <td style="padding:6px 8px;border:1px solid #e2e8f0;">${cust ? cust.name : 'Walk-in'}</td>
            <td style="padding:6px 8px;border:1px solid #e2e8f0;">${items}</td>
            <td style="padding:6px 8px;text-align:right;border:1px solid #e2e8f0;">₹${(t.total || 0).toFixed(2)}</td>
            <td style="padding:6px 8px;text-align:center;border:1px solid #e2e8f0;">${t.status}</td>
        </tr>`;
    }).join('');

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `<div style="font-family:sans-serif;padding:20px;max-width:800px;margin:auto;">
        <div style="text-align:center;margin-bottom:20px;">
            <h1 style="font-size:22px;font-weight:bold;margin:0;">${currentFirm.name || 'GasTrack'}</h1>
            <p style="color:#666;margin:4px 0;">${currentFirm.location || ''}</p>
            <p style="color:#888;font-size:13px;">Report: ${start || 'All'} to ${end || 'date'}</p>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead><tr style="background:#f1f5f9;">
                <th style="padding:8px;text-align:left;border:1px solid #e2e8f0;">#ID</th>
                <th style="padding:8px;text-align:left;border:1px solid #e2e8f0;">Date</th>
                <th style="padding:8px;text-align:left;border:1px solid #e2e8f0;">Customer</th>
                <th style="padding:8px;text-align:left;border:1px solid #e2e8f0;">Items</th>
                <th style="padding:8px;text-align:right;border:1px solid #e2e8f0;">Total</th>
                <th style="padding:8px;text-align:center;border:1px solid #e2e8f0;">Status</th>
            </tr></thead>
            <tbody>${bodyRows}</tbody>
            <tfoot><tr style="background:#f8fafc;font-weight:bold;">
                <td colspan="4" style="padding:8px;text-align:right;border:1px solid #e2e8f0;">Total Revenue:</td>
                <td style="padding:8px;text-align:right;border:1px solid #e2e8f0;">₹${totalRev.toFixed(2)}</td>
                <td style="border:1px solid #e2e8f0;"></td>
            </tr></tfoot>
        </table>
        <p style="text-align:right;color:#888;font-size:11px;margin-top:12px;">Generated ${new Date().toLocaleString()}</p>
    </div>`;
    document.body.appendChild(wrapper);
    await html2pdf().from(wrapper).set({
        margin: 10,
        filename: `GasTrack-Report-${start || 'all'}.pdf`,
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
    }).save();
    document.body.removeChild(wrapper);
}

// ============================================================
// Transactions
// ============================================================
function renderTransactions() {
    const search      = (document.getElementById('trans-search')?.value || '').toLowerCase();
    const dateFilter  = document.getElementById('trans-filter-date')?.value  || 'all';
    const custFilter  = document.getElementById('trans-filter-cust')?.value  || 'all';
    const startDate   = document.getElementById('trans-filter-start')?.value || '';
    const endDate     = document.getElementById('trans-filter-end')?.value   || '';

    // Populate customer dropdown on first call
    const custSel = document.getElementById('trans-filter-cust');
    if (custSel) {
        const existing = new Set(Array.from(custSel.options).map(o => o.value));
        customers.forEach(c => {
            if (!existing.has(String(c.id))) custSel.add(new Option(c.name, c.id));
        });
    }

    const today      = new Date().toISOString().split('T')[0];
    const weekStart  = (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().split('T')[0]; })();
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const yearStart  = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];

    let filtered = transactions.filter(t => {
        if (search) {
            const cust = customers.find(c => c.id === t.customerId);
            if (!String(t.id).includes(search) && !(cust && cust.name.toLowerCase().includes(search))) return false;
        }
        if (dateFilter === 'today'  && t.date !== today)       return false;
        if (dateFilter === 'week'   && t.date < weekStart)     return false;
        if (dateFilter === 'month'  && t.date < monthStart)    return false;
        if (dateFilter === 'year'   && t.date < yearStart)     return false;
        if (dateFilter === 'custom') {
            if (startDate && t.date < startDate) return false;
            if (endDate   && t.date > endDate)   return false;
        }
        if (custFilter !== 'all' && t.customerId !== parseInt(custFilter)) return false;
        return true;
    });

    const noResults = document.getElementById('trans-no-results');
    if (noResults) noResults.classList.toggle('hidden', filtered.length > 0);

    const tbody = document.getElementById('transactions-table-body');
    if (tbody) {
        tbody.innerHTML = filtered.map(t => {
            const cust   = customers.find(c => c.id === t.customerId);
            const name   = cust ? cust.name : (t.customerId ? 'Unknown' : 'Walk-in');
            const detail = (t.items || []).map(i => {
                const pend = (i.filled || 0) - (i.empty || 0);
                return `<span class="inline-block text-xs bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded mr-1">${i.filled}×${i.type}${pend > 0 ? ` <span class="text-amber-500">(${pend}↩)</span>` : ''}</span>`;
            }).join('');
            const retBtns = (t.items || []).map((item, idx) => {
                const pend = (item.filled || 0) - (item.empty || 0);
                return pend > 0
                    ? `<button onclick="openReturnModal(${t.id},${idx})" class="p-1.5 text-slate-400 hover:text-amber-600 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20" title="Return ${item.type}"><i data-lucide="rotate-ccw" size="16"></i></button>`
                    : '';
            }).join('');
            return `<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td class="p-4 text-slate-500 text-xs">#${t.id}</td>
                <td class="p-4 text-slate-600 dark:text-slate-400 text-sm">${t.date}</td>
                <td class="p-4 font-medium text-slate-800 dark:text-slate-200">${name}</td>
                <td class="p-4">${detail}</td>
                <td class="p-4 text-right font-bold text-slate-800 dark:text-slate-200">₹${(t.total || 0).toFixed(2)}</td>
                <td class="p-4 text-center">${statusBadge(t.status)}</td>
                <td class="p-4 text-center">
                    <div class="flex items-center justify-center gap-1">
                        <button onclick="showReceiptModal(${t.id})" class="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20" title="Receipt"><i data-lucide="receipt" size="16"></i></button>
                        ${retBtns}
                    </div>
                </td>
            </tr>`;
        }).join('') || `<tr><td colspan="7" class="p-4 text-center text-slate-400">No transactions found.</td></tr>`;
    }

    const mobileList = document.getElementById('transactions-mobile-list');
    if (mobileList) {
        mobileList.innerHTML = filtered.map(t => {
            const cust       = customers.find(c => c.id === t.customerId);
            const name       = cust ? cust.name : 'Walk-in';
            const detail     = (t.items || []).map(i => `${i.filled}×${i.type}`).join(', ');
            const pendItems  = (t.items || []).filter(i => (i.filled || 0) > (i.empty || 0));
            const retBtns    = pendItems.map(item => {
                const idx = (t.items || []).indexOf(item);
                return `<button onclick="openReturnModal(${t.id},${idx})" class="flex-1 py-1.5 text-xs border border-amber-200 dark:border-amber-900/30 rounded-lg text-amber-600 dark:text-amber-400 hover:bg-amber-50">Return ${item.type}</button>`;
            }).join('');
            return `<div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <p class="font-bold text-slate-800 dark:text-slate-200">${name}</p>
                        <p class="text-xs text-slate-500 dark:text-slate-400">#${t.id} &bull; ${t.date}</p>
                    </div>
                    <div class="flex flex-col items-end gap-1">
                        ${statusBadge(t.status)}
                        <span class="font-bold text-slate-800 dark:text-slate-200">₹${(t.total || 0).toFixed(2)}</span>
                    </div>
                </div>
                <p class="text-xs text-slate-500 dark:text-slate-400 mb-3">${detail}</p>
                <div class="flex gap-2">
                    <button onclick="showReceiptModal(${t.id})" class="flex-1 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-50">Receipt</button>
                    ${retBtns}
                </div>
            </div>`;
        }).join('') || '<p class="text-center text-sm text-slate-400 py-4">No transactions found.</p>';
    }
    if (window.lucide) lucide.createIcons();
}

function toggleTransDateInputs(val) {
    document.getElementById('trans-filter-custom')?.classList.toggle('hidden', val !== 'custom');
}

function resetTransFilters() {
    ['trans-search', 'trans-filter-start', 'trans-filter-end'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    const dateEl = document.getElementById('trans-filter-date'); if (dateEl) dateEl.value = 'all';
    const custEl = document.getElementById('trans-filter-cust'); if (custEl) custEl.value = 'all';
    document.getElementById('trans-filter-custom')?.classList.add('hidden');
    renderTransactions();
}

// --- New Order Modal ---
function openNewOrderModal() {
    populateOrderCustomerSelect();
    const cont = document.getElementById('order-items-container');
    if (cont) cont.innerHTML = '';
    addOrderItemRow();
    document.getElementById('order-modal').classList.remove('hidden');
}
function closeNewOrderModal() {
    document.getElementById('order-modal').classList.add('hidden');
    document.getElementById('order-form')?.reset();
}

function populateOrderCustomerSelect() {
    const sel = document.getElementById('order-customer');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">Select Customer</option>';
    customers.forEach(c => sel.add(new Option(c.name + (c.phone ? ` (${c.phone})` : ''), c.id)));
    if (prev) sel.value = prev;
}

function addOrderItemRow() {
    const cont = document.getElementById('order-items-container');
    if (!cont) return;
    const opts = CYLINDER_TYPES.map(ct => `<option value="${ct.id}">${ct.label} (₹${ct.price})</option>`).join('');
    const row  = document.createElement('div');
    row.className = 'flex gap-2 items-center';
    row.innerHTML = `
        <select class="flex-1 p-2.5 border border-slate-300 dark:border-slate-700 rounded-xl text-sm focus:outline-none bg-white dark:bg-slate-800 dark:text-slate-200 order-type">${opts}</select>
        <input type="number" min="1" value="1" placeholder="Qty" class="w-20 p-2.5 border border-slate-300 dark:border-slate-700 rounded-xl text-sm focus:outline-none dark:bg-slate-800 dark:text-slate-200 order-filled">
        <input type="date" class="flex-1 p-2.5 border border-slate-300 dark:border-slate-700 rounded-xl text-sm focus:outline-none dark:bg-slate-800 dark:text-slate-200 order-due">
        <button type="button" onclick="this.parentElement.remove()" class="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"><i data-lucide="trash-2" size="16"></i></button>
    `;
    cont.appendChild(row);
    if (window.lucide) lucide.createIcons();
}

async function submitOrder(event) {
    event.preventDefault();
    const customerId = document.getElementById('order-customer').value;
    const rows = document.querySelectorAll('#order-items-container > div');
    const items = [];
    let total = 0;
    rows.forEach(row => {
        const type    = row.querySelector('.order-type')?.value;
        const filled  = parseInt(row.querySelector('.order-filled')?.value || 0);
        const dueDate = row.querySelector('.order-due')?.value || '';
        if (type && filled > 0) {
            const ct = CYLINDER_TYPES.find(c => c.id === type);
            total += (ct ? ct.price : 0) * filled;
            items.push({ type, filled, empty: 0, dueDate, returnedDate: '' });
        }
    });
    if (items.length === 0) return showErrorModal('Add at least one item.');
    try {
        const data = await apiCall('POST', `/api/firms/${currentFirmId}/transactions`, {
            customerId: customerId ? parseInt(customerId) : null,
            items, total,
        });
        updateStateFromFirmData(data);
        renderAll();
        closeNewOrderModal();
        showSuccessModal('Order created successfully!');
    } catch (e) { showErrorModal(e.message); }
}

// --- Return Modal ---
function openReturnModal(transId, itemIdx) {
    const txn  = transactions.find(t => t.id === transId);
    if (!txn) return;
    const item = (txn.items || [])[itemIdx];
    if (!item) return;
    const total   = item.filled || 0;
    const already = item.empty  || 0;
    const pending = total - already;
    document.getElementById('ret-trans-id').value        = transId;
    document.getElementById('ret-item-idx').value        = itemIdx;
    document.getElementById('ret-total-filled').textContent  = total;
    document.getElementById('ret-already-empty').textContent = already;
    document.getElementById('ret-pending-count').textContent = pending;
    document.getElementById('ret-qty-input').value = pending;
    document.getElementById('ret-qty-input').max   = pending;
    document.getElementById('ret-new-due-date').value = '';
    document.getElementById('return-modal').classList.remove('hidden');
}
function closeReturnModal() { document.getElementById('return-modal').classList.add('hidden'); }

async function submitReturn(event) {
    event.preventDefault();
    const transId    = parseInt(document.getElementById('ret-trans-id').value);
    const itemIdx    = parseInt(document.getElementById('ret-item-idx').value);
    const qty        = parseInt(document.getElementById('ret-qty-input').value || 0);
    const newDueDate = document.getElementById('ret-new-due-date').value || '';
    try {
        const data = await apiCall('POST', `/api/transactions/${transId}/return`, { itemIdx, qty, newDueDate });
        updateStateFromFirmData(data);
        renderAll();
        closeReturnModal();
        showSuccessModal('Return recorded successfully!');
    } catch (e) { showErrorModal(e.message); }
}

// --- Receipt Modal ---
function showReceiptModal(transId) {
    const txn  = transactions.find(t => t.id === transId);
    if (!txn) return;
    const cust = customers.find(c => c.id === txn.customerId);
    currentReceiptData = { txn, cust };

    const itemRows = (txn.items || []).map(item => {
        const ct     = CYLINDER_TYPES.find(c => c.id === item.type);
        const price  = ct ? ct.price : 0;
        const amount = price * (item.filled || 0);
        return `<tr>
            <td class="py-2 text-slate-700">${ct ? ct.label : item.type}</td>
            <td class="py-2 text-center text-slate-700">${item.filled || 0}</td>
            <td class="py-2 text-right text-slate-700">₹${price.toFixed(2)}</td>
            <td class="py-2 text-right font-medium text-slate-800">₹${amount.toFixed(2)}</td>
        </tr>`;
    }).join('');

    document.getElementById('receipt-print-area').innerHTML = `
        <div class="text-center mb-4">
            <h2 class="text-xl font-bold text-slate-800">${currentFirm.name || 'GasTrack'}</h2>
            <p class="text-sm text-slate-500">${currentFirm.location || ''}</p>
            <p class="text-sm text-slate-500">${currentFirm.phone || ''}</p>
        </div>
        <div class="border-t border-b border-slate-200 py-3 mb-4 text-sm">
            <div class="flex justify-between mb-1"><span class="text-slate-500">Receipt #</span><span class="font-bold">${txn.id}</span></div>
            <div class="flex justify-between mb-1"><span class="text-slate-500">Date</span><span>${txn.date}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">Customer</span><span class="font-medium">${cust ? cust.name : 'Walk-in'}</span></div>
        </div>
        <table class="w-full text-sm mb-4">
            <thead><tr class="border-b border-slate-200">
                <th class="py-2 text-left text-slate-600">Item</th>
                <th class="py-2 text-center text-slate-600">Qty</th>
                <th class="py-2 text-right text-slate-600">Rate</th>
                <th class="py-2 text-right text-slate-600">Amount</th>
            </tr></thead>
            <tbody class="divide-y divide-slate-100">${itemRows}</tbody>
        </table>
        <div class="border-t-2 border-slate-800 pt-3 flex justify-between font-bold text-lg">
            <span>Total</span><span>₹${(txn.total || 0).toFixed(2)}</span>
        </div>
        <p class="text-center text-xs text-slate-400 mt-4">Thank you for your business!</p>
    `;
    document.getElementById('receipt-modal').classList.remove('hidden');
}
function closeReceiptModal() { document.getElementById('receipt-modal').classList.add('hidden'); }

async function downloadCurrentReceipt() {
    const el  = document.getElementById('receipt-print-area');
    if (!el) return;
    await html2pdf().from(el).set({
        margin: 10,
        filename: `Receipt-${currentReceiptData?.txn?.id || currentReceiptData?.log?.id || 'record'}.pdf`,
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    }).save();
}

// ============================================================
// Inventory / Stock
// ============================================================
function renderStock() {
    renderProducts();

    // Warehouse stock bars
    const list = document.getElementById('stock-progress-list');
    if (list) {
        list.innerHTML = CYLINDER_TYPES.map(ct => {
            const f = stock[ct.id] || 0, e = emptyStock[ct.id] || 0;
            const total = f + e, pct = total > 0 ? Math.round((f / total) * 100) : 0;
            return `<div class="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 border border-slate-100 dark:border-slate-700">
                <div class="flex justify-between items-center mb-2">
                    <h4 class="font-bold text-slate-800 dark:text-slate-200 text-sm">${ct.label}</h4>
                    <span class="text-xs text-slate-500">${pct}% filled</span>
                </div>
                <div class="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3 mb-3">
                    <div class="bg-blue-500 h-3 rounded-full transition-all" style="width:${pct}%"></div>
                </div>
                <div class="grid grid-cols-2 gap-2 text-sm">
                    <div class="bg-green-50 dark:bg-green-900/20 rounded-lg p-2 text-center">
                        <p class="text-2xl font-bold text-green-600 dark:text-green-400">${f}</p>
                        <p class="text-xs text-slate-500">Filled</p>
                    </div>
                    <div class="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-2 text-center">
                        <p class="text-2xl font-bold text-orange-500 dark:text-orange-400">${e}</p>
                        <p class="text-xs text-slate-500">Empty</p>
                    </div>
                </div>
            </div>`;
        }).join('') || '<p class="text-slate-400 text-sm col-span-full">No products configured.</p>';
    }

    // Inventory logs table
    const tbody = document.getElementById('inventory-logs-body');
    if (tbody) {
        tbody.innerHTML = inventoryLogs.slice(0, 50).map(log => {
            const isIn   = log.type === 'IN';
            const badge  = isIn
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
            const items  = Object.entries(log.items || {}).map(([k, v]) => `${v}×${k}`).join(', ');
            return `<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td class="p-4 text-slate-500 text-sm">${log.date}</td>
                <td class="p-4"><span class="px-2 py-1 rounded-full text-xs font-bold ${badge}">${isIn ? '⬇ IN' : '⬆ OUT'}</span></td>
                <td class="p-4 text-sm text-slate-700 dark:text-slate-300">${items}</td>
                <td class="p-4 text-sm text-slate-600 dark:text-slate-400">${log.vehicle || '-'}</td>
                <td class="p-4 text-center">
                    <button onclick="showInventoryReceipt(${log.id})" class="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20"><i data-lucide="receipt" size="16"></i></button>
                </td>
            </tr>`;
        }).join('') || `<tr><td colspan="5" class="p-4 text-center text-slate-400">No movements recorded.</td></tr>`;
    }

    // Mobile logs
    const mobileLog = document.getElementById('inventory-logs-mobile');
    if (mobileLog) {
        mobileLog.innerHTML = inventoryLogs.slice(0, 50).map(log => {
            const isIn  = log.type === 'IN';
            const items = Object.entries(log.items || {}).map(([k, v]) => `${v}×${k}`).join(', ');
            return `<div class="flex items-start gap-3 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
                <div class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isIn ? 'bg-green-100 dark:bg-green-900/30' : 'bg-orange-100 dark:bg-orange-900/30'}">
                    <i data-lucide="${isIn ? 'download' : 'upload'}" size="18" class="${isIn ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}"></i>
                </div>
                <div class="flex-1">
                    <p class="font-medium text-slate-800 dark:text-slate-200 text-sm">${isIn ? 'Received' : 'Sent'}: ${items}</p>
                    <p class="text-xs text-slate-500 dark:text-slate-400">${log.date} &bull; ${log.vehicle || 'No vehicle'}</p>
                </div>
                <button onclick="showInventoryReceipt(${log.id})" class="p-1.5 text-slate-400 hover:text-blue-600"><i data-lucide="receipt" size="14"></i></button>
            </div>`;
        }).join('') || '<p class="text-center text-sm text-slate-400 py-4">No movements.</p>';
    }

    // Seed empty rows in forms if needed
    ['send-empties-rows', 'receive-filled-rows'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.children.length === 0) addInventoryRow(id);
    });
    if (window.lucide) lucide.createIcons();
}

function addInventoryRow(containerId) {
    const cont = document.getElementById(containerId);
    if (!cont) return;
    const opts = CYLINDER_TYPES.map(ct => `<option value="${ct.id}">${ct.label}</option>`).join('');
    const row  = document.createElement('div');
    row.className = 'flex gap-2 items-center';
    row.innerHTML = `
        <select class="flex-1 p-2 border border-slate-300 dark:border-slate-700 rounded-lg text-sm focus:outline-none bg-white dark:bg-slate-800 dark:text-slate-200">${opts}</select>
        <input type="number" min="1" value="1" class="w-20 p-2 border border-slate-300 dark:border-slate-700 rounded-lg text-sm focus:outline-none dark:bg-slate-800 dark:text-slate-200">
        <button type="button" onclick="this.parentElement.remove()" class="p-2 text-red-400 hover:text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"><i data-lucide="x" size="14"></i></button>
    `;
    cont.appendChild(row);
    if (window.lucide) lucide.createIcons();
}

async function handleInventoryAction(event, type) {
    event.preventDefault();
    const form      = event.target;
    const vehicle   = (form.querySelector('[name="vehicle"]')?.value || '').trim().toUpperCase();
    const contId    = type === 'OUT' ? 'send-empties-rows' : 'receive-filled-rows';
    const rows      = document.querySelectorAll(`#${contId} > div`);
    const items     = {};
    rows.forEach(row => {
        const sel = row.querySelector('select');
        const qty = parseInt(row.querySelector('input[type="number"]')?.value || 0);
        if (sel && qty > 0) items[sel.value] = (items[sel.value] || 0) + qty;
    });
    if (Object.keys(items).length === 0) return showErrorModal('Add at least one item.');
    if (!vehicle) return showErrorModal('Vehicle number is required.');
    const endpoint = type === 'OUT' ? 'send' : 'receive';
    try {
        const data = await apiCall('POST', `/api/firms/${currentFirmId}/inventory/${endpoint}`, { vehicle, items });
        updateStateFromFirmData(data);
        renderAll();
        form.reset();
        const cont = document.getElementById(contId);
        if (cont) { cont.innerHTML = ''; addInventoryRow(contId); }
        showSuccessModal(type === 'OUT' ? 'Empties dispatched!' : 'Stock received!');
    } catch (e) { showErrorModal(e.message); }
}

// --- Products ---
function renderProducts() {
    const tbody  = document.getElementById('product-catalog-body');
    const mobile = document.getElementById('product-catalog-mobile');

    if (tbody) {
        tbody.innerHTML = CYLINDER_TYPES.map(ct => `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td class="p-3 font-mono text-slate-500 text-sm">${ct.id}</td>
                <td class="p-3 font-medium text-slate-800 dark:text-slate-200">${ct.label}</td>
                <td class="p-3 text-slate-600 dark:text-slate-400">₹${ct.price.toFixed(2)}</td>
                <td class="p-3 text-right">
                    <div class="flex justify-end gap-1">
                        <button onclick="openProductModal('${ct.id}')" class="p-1.5 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20" title="Edit"><i data-lucide="pencil" size="14"></i></button>
                        <button onclick="showProductHistory('${ct.id}')" class="p-1.5 text-slate-400 hover:text-purple-600 rounded hover:bg-purple-50 dark:hover:bg-purple-900/20" title="History"><i data-lucide="history" size="14"></i></button>
                    </div>
                </td>
            </tr>
        `).join('') || `<tr><td colspan="4" class="p-3 text-center text-slate-400">No products.</td></tr>`;
    }
    if (mobile) {
        mobile.innerHTML = CYLINDER_TYPES.map(ct => `
            <div class="flex items-center justify-between p-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
                <div>
                    <p class="font-medium text-slate-800 dark:text-slate-200 text-sm">${ct.label}</p>
                    <p class="text-xs text-slate-500">${ct.id} &bull; ₹${ct.price.toFixed(2)}</p>
                </div>
                <div class="flex gap-1">
                    <button onclick="openProductModal('${ct.id}')" class="p-1.5 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50"><i data-lucide="pencil" size="14"></i></button>
                    <button onclick="showProductHistory('${ct.id}')" class="p-1.5 text-slate-400 hover:text-purple-600 rounded hover:bg-purple-50"><i data-lucide="history" size="14"></i></button>
                </div>
            </div>
        `).join('') || '<p class="text-center text-sm text-slate-400 p-3">No products.</p>';
    }
    if (window.lucide) lucide.createIcons();
}

function openProductModal(sizeId = null) {
    const modeEl  = document.getElementById('prod-mode');
    const idEl    = document.getElementById('prod-id');
    const labelEl = document.getElementById('prod-label');
    const priceEl = document.getElementById('prod-price');
    const titleEl = document.getElementById('product-modal-title');
    if (sizeId) {
        const ct = CYLINDER_TYPES.find(c => c.id === sizeId);
        if (!ct) return;
        titleEl.textContent = 'Edit Product';
        modeEl.value = 'edit';
        idEl.value = ct.id; idEl.readOnly = true;
        labelEl.value = ct.label;
        priceEl.value = ct.price;
    } else {
        titleEl.textContent = 'Add Product';
        modeEl.value = 'add';
        idEl.value = ''; idEl.readOnly = false;
        labelEl.value = ''; priceEl.value = '';
    }
    document.getElementById('product-modal').classList.remove('hidden');
}
function closeProductModal() { document.getElementById('product-modal').classList.add('hidden'); }

async function handleSaveProduct(event) {
    event.preventDefault();
    const mode  = document.getElementById('prod-mode').value;
    const id    = document.getElementById('prod-id').value.trim();
    const label = document.getElementById('prod-label').value.trim();
    const price = parseFloat(document.getElementById('prod-price').value);
    try {
        const data = mode === 'add'
            ? await apiCall('POST', `/api/firms/${currentFirmId}/products`, { id, label, price })
            : await apiCall('PUT',  `/api/firms/${currentFirmId}/products/${id}`, { label, price });
        updateStateFromFirmData(data);
        renderAll();
        closeProductModal();
        showSuccessModal(mode === 'add' ? 'Product added!' : 'Product updated!');
    } catch (e) { showErrorModal(e.message); }
}

async function showProductHistory(sizeId) {
    try {
        const hist  = await apiCall('GET', `/api/firms/${currentFirmId}/products/${sizeId}/history`);
        const tbody = document.getElementById('product-history-body');
        document.getElementById('history-modal-title').textContent = `History: ${sizeId}`;
        if (tbody) {
            tbody.innerHTML = hist.length === 0
                ? `<tr><td colspan="3" class="p-3 text-center text-slate-400">No history.</td></tr>`
                : hist.map(h => `<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td class="p-3 text-sm text-slate-500">${h.date}</td>
                    <td class="p-3 text-sm font-medium text-slate-800 dark:text-slate-200">${h.action}</td>
                    <td class="p-3 text-sm text-slate-600 dark:text-slate-400">${h.details}</td>
                </tr>`).join('');
        }
        document.getElementById('product-history-modal').classList.remove('hidden');
    } catch (e) { showErrorModal(e.message); }
}

// --- Bulk Stock Init ---
function openAddCylinderModal() {
    const cont = document.getElementById('add-stock-rows-container');
    if (cont) { cont.innerHTML = ''; addStockRow(); }
    document.getElementById('add-cylinder-modal').classList.remove('hidden');
}
function closeAddCylinderModal() { document.getElementById('add-cylinder-modal').classList.add('hidden'); }

function addStockRow() {
    const cont = document.getElementById('add-stock-rows-container');
    if (!cont) return;
    const opts = CYLINDER_TYPES.map(ct => `<option value="${ct.id}">${ct.label}</option>`).join('');
    const row  = document.createElement('div');
    row.className = 'grid grid-cols-[1fr_80px_80px_auto] gap-2 items-center';
    row.innerHTML = `
        <select class="p-2.5 border border-slate-300 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-slate-200">${opts}</select>
        <input type="number" min="0" value="0" placeholder="Filled" class="p-2.5 border border-slate-300 dark:border-slate-700 rounded-xl text-sm dark:bg-slate-800 dark:text-slate-200">
        <input type="number" min="0" value="0" placeholder="Empty"  class="p-2.5 border border-slate-300 dark:border-slate-700 rounded-xl text-sm dark:bg-slate-800 dark:text-slate-200">
        <button type="button" onclick="this.parentElement.remove()" class="p-2 text-red-400 hover:text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"><i data-lucide="trash-2" size="16"></i></button>
    `;
    cont.appendChild(row);
    if (window.lucide) lucide.createIcons();
}

async function handleSaveCylinderStock(event) {
    event.preventDefault();
    const rows    = document.querySelectorAll('#add-stock-rows-container > div');
    const payload = [];
    rows.forEach(row => {
        const sel    = row.querySelector('select');
        const inputs = row.querySelectorAll('input[type="number"]');
        const filled = parseInt(inputs[0]?.value || 0);
        const empty  = parseInt(inputs[1]?.value || 0);
        if (sel) payload.push({ weight: sel.value, filled, empty });
    });
    try {
        const data = await apiCall('POST', `/api/firms/${currentFirmId}/stock/init`, payload);
        updateStateFromFirmData(data);
        renderAll();
        closeAddCylinderModal();
        showSuccessModal('Stock updated successfully!');
    } catch (e) { showErrorModal(e.message); }
}

// --- Inventory Receipt ---
function showInventoryReceipt(logId) {
    const log = inventoryLogs.find(l => l.id === logId);
    if (!log) return;
    const isIn   = log.type === 'IN';
    currentReceiptData = { log };
    const itemRows = Object.entries(log.items || {}).map(([k, v]) =>
        `<tr><td class="py-2 text-slate-700">${k}</td><td class="py-2 text-center text-slate-700">${v}</td></tr>`
    ).join('');
    document.getElementById('receipt-print-area').innerHTML = `
        <div class="text-center mb-4">
            <h2 class="text-xl font-bold text-slate-800">${currentFirm.name || 'GasTrack'}</h2>
            <p class="text-sm text-slate-500">${currentFirm.location || ''}</p>
        </div>
        <div class="border-t border-b border-slate-200 py-3 mb-4 text-sm">
            <div class="flex justify-between mb-1"><span class="text-slate-500">Log #</span><span class="font-bold">${log.id}</span></div>
            <div class="flex justify-between mb-1"><span class="text-slate-500">Date</span><span>${log.date}</span></div>
            <div class="flex justify-between mb-1">
                <span class="text-slate-500">Type</span>
                <span class="font-bold ${isIn ? 'text-green-600' : 'text-orange-600'}">${isIn ? 'RECEIVED (IN)' : 'SENT (OUT)'}</span>
            </div>
            <div class="flex justify-between"><span class="text-slate-500">Vehicle</span><span>${log.vehicle || '-'}</span></div>
        </div>
        <table class="w-full text-sm mb-4">
            <thead><tr class="border-b border-slate-200">
                <th class="py-2 text-left text-slate-600">Type</th>
                <th class="py-2 text-center text-slate-600">Qty</th>
            </tr></thead>
            <tbody class="divide-y divide-slate-100">${itemRows}</tbody>
        </table>
        <p class="text-center text-xs text-slate-400 mt-4">Inventory Movement Record</p>
    `;
    document.getElementById('receipt-modal').classList.remove('hidden');
}

// ============================================================
// Customers
// ============================================================
function renderCustomers() {
    const search = (document.getElementById('cust-search')?.value || '').toLowerCase();
    const filtered = customers.filter(c => {
        if (search && !c.name.toLowerCase().includes(search) && !(c.phone || '').includes(search)) return false;
        if (showFrequentOnly && transactions.filter(t => t.customerId === c.id).length < 3) return false;
        return true;
    });

    function planBadges(c) {
        return (c.plans || []).map(p =>
            `<span class="inline-block text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded mr-1">${p.sizeId}×${p.limit}</span>`
        ).join('');
    }

    const tbody = document.getElementById('customers-list-body');
    if (tbody) {
        tbody.innerHTML = filtered.map(c => {
            const plans  = planBadges(c);
            const txnCnt = transactions.filter(t => t.customerId === c.id).length;
            const chk    = selectedCustomers.has(c.id) ? 'checked' : '';
            return `<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td class="p-4"><input type="checkbox" ${chk} onchange="toggleCustomerSelect(${c.id},this.checked)" class="rounded border-slate-300 text-blue-600 focus:ring-blue-500"></td>
                <td class="p-4">
                    <p class="font-medium text-slate-800 dark:text-slate-200">${c.name}</p>
                    <p class="text-xs text-slate-500 dark:text-slate-400">${c.address || ''}</p>
                </td>
                <td class="p-4">${plans || '<span class="text-xs text-slate-400">No plans</span>'}</td>
                <td class="p-4">
                    <p class="text-sm text-slate-700 dark:text-slate-300">${c.phone || '-'}</p>
                    <p class="text-xs text-slate-400">${txnCnt} orders</p>
                </td>
                <td class="p-4 text-right">
                    <div class="flex items-center justify-end gap-1">
                        <button onclick="openNewOrderForCustomer(${c.id})" class="p-1.5 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20" title="New Order"><i data-lucide="shopping-cart" size="14"></i></button>
                        <button onclick="openChangePlanModal(${c.id})" class="p-1.5 text-slate-400 hover:text-green-600 rounded hover:bg-green-50 dark:hover:bg-green-900/20" title="Plans"><i data-lucide="edit-2" size="14"></i></button>
                        <button onclick="showCustomerHistory(${c.id})" class="p-1.5 text-slate-400 hover:text-purple-600 rounded hover:bg-purple-50 dark:hover:bg-purple-900/20" title="History"><i data-lucide="history" size="14"></i></button>
                    </div>
                </td>
            </tr>`;
        }).join('') || `<tr><td colspan="5" class="p-4 text-center text-slate-400">No customers found.</td></tr>`;
    }

    const mobileList = document.getElementById('customers-mobile-list');
    if (mobileList) {
        mobileList.innerHTML = filtered.map(c => {
            const plans  = planBadges(c);
            const txnCnt = transactions.filter(t => t.customerId === c.id).length;
            return `<div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <p class="font-bold text-slate-800 dark:text-slate-200">${c.name}</p>
                        <p class="text-xs text-slate-500 dark:text-slate-400">${c.phone || '-'} &bull; ${txnCnt} orders</p>
                    </div>
                    <div class="flex gap-1">
                        <button onclick="openChangePlanModal(${c.id})" class="p-1.5 text-slate-400 hover:text-green-600 rounded hover:bg-green-50"><i data-lucide="edit-2" size="14"></i></button>
                        <button onclick="showCustomerHistory(${c.id})" class="p-1.5 text-slate-400 hover:text-purple-600 rounded hover:bg-purple-50"><i data-lucide="history" size="14"></i></button>
                    </div>
                </div>
                ${plans ? `<div class="flex flex-wrap gap-1 mb-2">${plans}</div>` : ''}
                <button onclick="openNewOrderForCustomer(${c.id})" class="w-full mt-2 py-1.5 text-xs border border-blue-200 dark:border-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50">New Order</button>
            </div>`;
        }).join('') || '<p class="text-center text-sm text-slate-400 py-4">No customers found.</p>';
    }

    const selBar = document.getElementById('customer-selection-bar');
    const selCnt = document.getElementById('selected-count');
    if (selBar) selBar.classList.toggle('hidden', selectedCustomers.size === 0);
    if (selCnt) selCnt.textContent = selectedCustomers.size;
    if (window.lucide) lucide.createIcons();
}

function openNewOrderForCustomer(custId) {
    openNewOrderModal();
    setTimeout(() => {
        const sel = document.getElementById('order-customer');
        if (sel) sel.value = custId;
    }, 50);
}

function toggleCustomerSelect(id, checked) {
    checked ? selectedCustomers.add(id) : selectedCustomers.delete(id);
    const selBar = document.getElementById('customer-selection-bar');
    const selCnt = document.getElementById('selected-count');
    if (selBar) selBar.classList.toggle('hidden', selectedCustomers.size === 0);
    if (selCnt) selCnt.textContent = selectedCustomers.size;
}

function toggleSelectAllCustomers(checked) {
    checked ? customers.forEach(c => selectedCustomers.add(c.id)) : selectedCustomers.clear();
    renderCustomers();
}

function clearCustomerSelection() {
    selectedCustomers.clear();
    renderCustomers();
}

function toggleFrequentFilter() {
    showFrequentOnly = !showFrequentOnly;
    const btn = document.getElementById('btn-filter-frequent');
    if (btn) {
        btn.classList.toggle('bg-yellow-100',         showFrequentOnly);
        btn.classList.toggle('dark:bg-yellow-900/20', showFrequentOnly);
        btn.classList.toggle('text-yellow-700',       showFrequentOnly);
        btn.classList.toggle('dark:text-yellow-400',  showFrequentOnly);
    }
    renderCustomers();
}

function openAddCustomerModal() {
    connectionMode = 'new';
    setConnectionMode('new');
    const form = document.querySelector('#add-customer-modal form');
    if (form) form.reset();
    const cont = document.getElementById('connection-setup-rows');
    if (cont) { cont.innerHTML = ''; addConnectionRow(); }
    document.getElementById('add-customer-modal').classList.remove('hidden');
}
function closeAddCustomerModal() { document.getElementById('add-customer-modal').classList.add('hidden'); }

function setConnectionMode(mode) {
    connectionMode = mode;
    const newBtn = document.getElementById('btn-conn-new');
    const oldBtn = document.getElementById('btn-conn-old');
    const desc   = document.getElementById('conn-desc');

    [newBtn, oldBtn].forEach((btn, i) => {
        const active = (i === 0) ? mode === 'new' : mode === 'existing';
        btn.classList.toggle('bg-blue-600',              active);
        btn.classList.toggle('text-white',               active);
        btn.classList.toggle('border-blue-600',          active);
        btn.classList.toggle('text-slate-600',           !active);
        btn.classList.toggle('dark:text-slate-400',      !active);
        btn.classList.toggle('border-slate-300',         !active);
        btn.classList.toggle('dark:border-slate-700',    !active);
    });

    if (desc) {
        desc.textContent = mode === 'new'
            ? 'New connection: Stock will be deducted from warehouse and a delivery transaction will be created.'
            : 'Existing customer: Their current cylinders will be logged as incoming empty stock.';
        desc.className = `text-sm mb-3 leading-tight ${mode === 'new' ? 'text-blue-700 dark:text-blue-400' : 'text-orange-700 dark:text-orange-400'}`;
    }
}

function addConnectionRow() {
    const cont = document.getElementById('connection-setup-rows');
    if (!cont) return;
    const opts = CYLINDER_TYPES.map(ct => `<option value="${ct.id}">${ct.label}</option>`).join('');
    const row  = document.createElement('div');
    row.className = 'flex gap-2 items-center';
    row.innerHTML = `
        <select class="flex-1 p-2 border border-slate-300 dark:border-slate-700 rounded-lg text-sm bg-white dark:bg-slate-800 dark:text-slate-200">${opts}</select>
        <input type="number" min="1" value="1" class="w-20 p-2 border border-slate-300 dark:border-slate-700 rounded-lg text-sm dark:bg-slate-800 dark:text-slate-200" placeholder="Qty">
        <button type="button" onclick="this.parentElement.remove()" class="p-1.5 text-red-400 hover:text-red-600 rounded hover:bg-red-50"><i data-lucide="x" size="14"></i></button>
    `;
    cont.appendChild(row);
    if (window.lucide) lucide.createIcons();
}

async function handleAddCustomer(event) {
    event.preventDefault();
    const form    = event.target;
    const name    = form.querySelector('[name="name"]')?.value?.trim()    || '';
    const phone   = form.querySelector('[name="phone"]')?.value?.trim()   || '';
    const address = form.querySelector('[name="address"]')?.value?.trim() || '';
    const rows    = document.querySelectorAll('#connection-setup-rows > div');
    const connRows = [];
    rows.forEach(row => {
        const sel = row.querySelector('select');
        const qty = parseInt(row.querySelector('input[type="number"]')?.value || 0);
        if (sel && qty > 0) connRows.push({ typeId: sel.value, qty });
    });
    try {
        const data = await apiCall('POST', `/api/firms/${currentFirmId}/customers`, {
            name, phone, address, connectionMode, rows: connRows,
        });
        updateStateFromFirmData(data);
        renderAll();
        closeAddCustomerModal();
        showSuccessModal('Customer added successfully!');
    } catch (e) { showErrorModal(e.message); }
}

function openChangePlanModal(custId) {
    const cust = customers.find(c => c.id === custId);
    if (!cust) return;
    document.getElementById('edit-plan-customer-id').value     = custId;
    document.getElementById('edit-plan-customer-name').textContent = cust.name;
    const cont = document.getElementById('edit-cust-plans-container');
    if (cont) {
        cont.innerHTML = '';
        const plans = cust.plans || [];
        if (plans.length === 0) addPlanRow('edit-cust-plans-container');
        else plans.forEach(p => addPlanRow('edit-cust-plans-container', p));
    }
    document.getElementById('change-plan-modal').classList.remove('hidden');
}
function closeChangePlanModal() { document.getElementById('change-plan-modal').classList.add('hidden'); }

function addPlanRow(containerId, plan = null) {
    const cont = document.getElementById(containerId);
    if (!cont) return;
    const opts = CYLINDER_TYPES.map(ct =>
        `<option value="${ct.id}" ${plan && plan.sizeId === ct.id ? 'selected' : ''}>${ct.label}</option>`
    ).join('');
    const row = document.createElement('div');
    row.className = 'flex gap-2 items-center';
    row.innerHTML = `
        <select class="flex-1 p-2 border border-slate-300 dark:border-slate-700 rounded-lg text-sm bg-white dark:bg-slate-800 dark:text-slate-200">${opts}</select>
        <input type="number" min="1" value="${plan ? plan.limit : 1}" class="w-20 p-2 border border-slate-300 dark:border-slate-700 rounded-lg text-sm dark:bg-slate-800 dark:text-slate-200">
        <button type="button" onclick="this.parentElement.remove()" class="p-1.5 text-red-400 hover:text-red-600 rounded hover:bg-red-50"><i data-lucide="x" size="14"></i></button>
    `;
    cont.appendChild(row);
    if (window.lucide) lucide.createIcons();
}

async function handleUpdatePlan(event) {
    event.preventDefault();
    const custId = parseInt(document.getElementById('edit-plan-customer-id').value);
    const rows   = document.querySelectorAll('#edit-cust-plans-container > div');
    const plans  = [];
    rows.forEach(row => {
        const sel   = row.querySelector('select');
        const limit = parseInt(row.querySelector('input[type="number"]')?.value || 1);
        if (sel) plans.push({ sizeId: sel.value, limit });
    });
    if (plans.length === 0) return showErrorModal('Add at least one plan.');
    try {
        const data = await apiCall('PUT', `/api/customers/${custId}/plans`, { plans });
        updateStateFromFirmData(data);
        renderAll();
        closeChangePlanModal();
        showSuccessModal('Plans updated successfully!');
    } catch (e) { showErrorModal(e.message); }
}

function showCustomerHistory(custId) {
    const cust     = customers.find(c => c.id === custId);
    if (!cust) return;
    const custTxns = transactions.filter(t => t.customerId === custId);
    document.getElementById('hist-cust-name').textContent    = cust.name;
    document.getElementById('hist-cust-details').textContent =
        `${cust.phone || ''} | ${cust.address || ''} | ${custTxns.length} transactions`;

    const tbody = document.getElementById('hist-table-body');
    if (tbody) {
        tbody.innerHTML = custTxns.map(t => {
            const detail = (t.items || []).map(i => {
                const pend = (i.filled || 0) - (i.empty || 0);
                return `${i.filled}×${i.type}${pend > 0 ? ` (${pend} pending)` : ''}`;
            }).join(', ');
            const retBtns = (t.items || []).map((item, idx) => {
                const pend = (item.filled || 0) - (item.empty || 0);
                return pend > 0
                    ? `<button onclick="openReturnModal(${t.id},${idx})" class="p-1 text-slate-400 hover:text-amber-600 rounded hover:bg-amber-50"><i data-lucide="rotate-ccw" size="14"></i></button>`
                    : '';
            }).join('');
            return `<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td class="p-3">
                    <p class="font-medium text-slate-800 dark:text-slate-200">#${t.id}</p>
                    <p class="text-xs text-slate-400">${t.date}</p>
                </td>
                <td class="p-3 text-sm text-slate-600 dark:text-slate-400">${detail}</td>
                <td class="p-3 text-right font-bold text-slate-800 dark:text-slate-200">₹${(t.total || 0).toFixed(2)}</td>
                <td class="p-3 text-center">${statusBadge(t.status)}</td>
                <td class="p-3 text-center">
                    <div class="flex justify-center gap-1">
                        <button onclick="showReceiptModal(${t.id})" class="p-1 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50"><i data-lucide="receipt" size="14"></i></button>
                        ${retBtns}
                    </div>
                </td>
            </tr>`;
        }).join('') || `<tr><td colspan="5" class="p-4 text-center text-slate-400">No transactions yet.</td></tr>`;
    }
    document.getElementById('customer-history-modal').classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

// ============================================================
// Admin
// ============================================================
function openAdminModal() {
    document.getElementById('admin-modal').classList.remove('hidden');
    document.querySelectorAll('[name="firm-select"]').forEach(r => {
        r.checked = parseInt(r.value) === currentFirmId;
    });
}
function closeAdminModal() { document.getElementById('admin-modal').classList.add('hidden'); }

async function backupData() {
    try {
        const data = await apiCall('GET', '/api/backup');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        a.download = `GasTrack-Backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showSuccessModal('Backup downloaded!');
    } catch (e) { showErrorModal('Backup failed: ' + e.message); }
}

async function restoreData(input) {
    const file = input.files[0];
    if (!file) return;
    try {
        const data = JSON.parse(await file.text());
        await apiCall('POST', '/api/restore', data);
        await loadFirmData(currentFirmId);
        closeAdminModal();
        showSuccessModal('Data restored successfully!');
    } catch (e) { showErrorModal('Restore failed: ' + e.message); }
    input.value = '';
}

async function clearAllData() {
    if (!confirm('WARNING: This will permanently delete ALL data. Are you sure?')) return;
    try {
        await apiCall('POST', '/api/clear', { confirm: 'CLEAR_ALL_DATA' });
        await loadFirmData(currentFirmId);
        closeAdminModal();
        showSuccessModal('All data cleared and reset!');
    } catch (e) { showErrorModal('Clear failed: ' + e.message); }
}

function toggleDarkMode() {
    const isDark = document.documentElement.classList.toggle('dark');
    document.documentElement.classList.toggle('light', !isDark);
    localStorage.setItem('darkMode', isDark ? 'dark' : 'light');
}

// ============================================================
// Modal Helpers
// ============================================================
function _showModal(id, msgId, message) {
    const modal = document.getElementById(id);
    const msg   = document.getElementById(msgId);
    if (!modal) return;
    if (msg) msg.textContent = message;
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        const inner = modal.querySelector('div');
        if (inner) { inner.classList.remove('scale-95'); inner.classList.add('scale-100'); }
    });
}

function _closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('opacity-0');
    const inner = modal.querySelector('div');
    if (inner) { inner.classList.add('scale-95'); inner.classList.remove('scale-100'); }
    setTimeout(() => modal.classList.add('hidden'), 300);
}

function showSuccessModal(message) { _showModal('success-modal', 'success-modal-message', message); }
function closeSuccessModal()       { _closeModal('success-modal'); }
function showErrorModal(message)   { _showModal('error-modal',   'error-modal-message',   message); }
function closeErrorModal()         { _closeModal('error-modal'); }

// ============================================================
// Init
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    // Restore dark mode
    if (localStorage.getItem('darkMode') === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
    }
    loadFirmData(currentFirmId).then(() => switchTab('dashboard'));
});
