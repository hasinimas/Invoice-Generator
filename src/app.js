(() => {
  let state = {
    settings: {},
    invoices: [],
    currentInvoice: null, // object being edited, or null
    searchTerm: ''
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function money(n) {
    return (Number(n) || 0).toFixed(2);
  }

  function computeTotals(inv) {
    const subtotal = (inv.items || []).reduce(
      (sum, it) => sum + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0),
      0
    );
    const discountPercent = Number(inv.discountPercent) || 0;
    const taxPercent = Number(inv.taxPercent) || 0;
    const discountAmount = subtotal * (discountPercent / 100);
    const taxable = subtotal - discountAmount;
    const taxAmount = taxable * (taxPercent / 100);
    const total = taxable + taxAmount;
    return { subtotal, discountAmount, taxAmount, total };
  }

  // ---------- Toast / confirm (non-blocking replacements for alert/confirm,
  // which can leave the Electron window unable to accept keyboard input
  // until it's clicked again) ----------
  function showToast(message, duration = 2600) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    // Force reflow so the transition runs even if a toast is already visible.
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.hidden = true; }, 150);
    }, duration);
  }

  function showConfirm(message, confirmLabel = 'Delete') {
    return new Promise((resolve) => {
      const overlay = $('#confirm-overlay');
      const yesBtn = $('#confirm-yes');
      const noBtn = $('#confirm-no');
      $('#confirm-message').textContent = message;
      yesBtn.textContent = confirmLabel;
      overlay.hidden = false;

      const cleanup = (result) => {
        overlay.hidden = true;
        yesBtn.removeEventListener('click', onYes);
        noBtn.removeEventListener('click', onNo);
        resolve(result);
      };
      const onYes = () => cleanup(true);
      const onNo = () => cleanup(false);
      yesBtn.addEventListener('click', onYes);
      noBtn.addEventListener('click', onNo);
    });
  }

  // ---------- View switching ----------
  function showView(name) {
    $$('.view').forEach((v) => v.classList.remove('active'));
    $(`#view-${name}`).classList.add('active');
    $$('.nav-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === name));
  }

  // ---------- Dashboard ----------
  function renderDashboard() {
    const term = state.searchTerm.trim().toLowerCase();
    const list = state.invoices
      .filter((inv) => {
        if (!term) return true;
        return (
          (inv.number || '').toLowerCase().includes(term) ||
          (inv.customer?.name || '').toLowerCase().includes(term)
        );
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const tbody = $('#invoice-tbody');
    tbody.innerHTML = '';
    $('#empty-state').hidden = state.invoices.length !== 0;

    list.forEach((inv) => {
      const { total } = computeTotals(inv);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(inv.number || '-')}</td>
        <td>${escapeHtml(inv.customer?.name || 'Unnamed customer')}</td>
        <td>${escapeHtml(inv.date || '-')}</td>
        <td>${escapeHtml(inv.dueDate || '-')}</td>
        <td class="num">${state.settings.currencySymbol || '$'}${money(total)}</td>
        <td><span class="status-pill status-${inv.status || 'draft'}">${inv.status || 'draft'}</span></td>
        <td class="row-actions">
          <button class="edit" title="Edit">Edit</button>
          <button class="pdf" title="Export PDF">PDF</button>
          <button class="delete" title="Delete">Delete</button>
        </td>`;
      tr.querySelector('.edit').addEventListener('click', () => openEditor(inv));
      tr.querySelector('.pdf').addEventListener('click', () => exportPdf(inv.id));
      tr.querySelector('.delete').addEventListener('click', () => deleteInvoice(inv.id));
      tbody.appendChild(tr);
    });
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function deleteInvoice(id) {
    const ok = await showConfirm('Delete this invoice? This cannot be undone.');
    if (!ok) return;
    const data = await window.api.deleteInvoice(id);
    state.settings = data.settings;
    state.invoices = data.invoices;
    renderDashboard();
  }

  async function exportPdf(id) {
    const result = await window.api.exportInvoicePdf(id);
    if (result?.ok) {
      showToast(`Saved: ${result.filePath}`);
    } else if (!result?.canceled) {
      showToast(`Could not export PDF: ${result?.error || 'unknown error'}`);
    }
  }

  // ---------- Editor ----------

  // Shown in the Invoice # field for a brand-new invoice — a preview of what
  // the number will be if left untouched. The user can freely type over it;
  // see the note in main.js's invoice:save handler for how that's reconciled
  // with the auto-incrementing counter.
  function predictedInvoiceNumber() {
    const s = state.settings;
    return `${s.invoicePrefix || ''}${s.nextInvoiceNumber || ''}`;
  }

  function blankInvoice() {
    return {
      id: null,
      number: predictedInvoiceNumber(),
      date: todayISO(),
      dueDate: '',
      status: 'draft',
      stampPaid: false,
      customer: { name: '', email: '', address: '', phone: '' },
      items: [{ description: '', qty: 1, unitPrice: 0 }],
      discountPercent: 0,
      taxPercent: 0,
      orderDetails: ''
    };
  }

  function openEditor(invoice) {
    state.currentInvoice = JSON.parse(JSON.stringify(invoice || blankInvoice()));
    $('#editor-title').textContent = invoice ? `Edit ${invoice.number}` : 'New invoice';

    const inv = state.currentInvoice;
    $('#inv-number').value = inv.number || '';
    $('#cust-name').value = inv.customer.name || '';
    $('#cust-email').value = inv.customer.email || '';
    $('#cust-address').value = inv.customer.address || '';
    $('#cust-phone').value = inv.customer.phone || '';
    $('#inv-date').value = inv.date || todayISO();
    $('#inv-due').value = inv.dueDate || '';
    $('#inv-status').value = inv.status || 'draft';
    $('#inv-discount').value = inv.discountPercent || 0;
    $('#inv-tax').value = inv.taxPercent || 0;
    $('#inv-order-details').value = inv.orderDetails || '';
    $('#inv-stamp-paid').checked = !!inv.stampPaid;

    renderItems();
    updateTotals();
    showView('editor');
  }

  // Renders the full items table. Only called when rows are added/removed —
  // typing in a cell updates that cell in place (see wireItemRow) so the
  // input never gets torn down mid-keystroke and losing focus.
  function renderItems() {
    const tbody = $('#items-tbody');
    tbody.innerHTML = '';
    state.currentInvoice.items.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="text" class="item-desc" value="${escapeHtml(item.description)}" placeholder="Item or service" /></td>
        <td class="num"><input type="number" class="item-qty" min="0" step="0.01" value="${item.qty}" /></td>
        <td class="num"><input type="number" class="item-price" min="0" step="0.01" value="${item.unitPrice}" /></td>
        <td class="amount">${money((Number(item.qty) || 0) * (Number(item.unitPrice) || 0))}</td>
        <td><button class="remove-item" title="Remove">&times;</button></td>`;
      wireItemRow(tr, item, idx);
      tbody.appendChild(tr);
    });
  }

  function wireItemRow(tr, item, idx) {
    const amountCell = tr.querySelector('.amount');

    const refreshAmount = () => {
      amountCell.textContent = money((Number(item.qty) || 0) * (Number(item.unitPrice) || 0));
    };

    tr.querySelector('.item-desc').addEventListener('input', (e) => {
      item.description = e.target.value;
    });
    tr.querySelector('.item-qty').addEventListener('input', (e) => {
      item.qty = e.target.value;
      refreshAmount();
      updateTotals();
    });
    tr.querySelector('.item-price').addEventListener('input', (e) => {
      item.unitPrice = e.target.value;
      refreshAmount();
      updateTotals();
    });
    tr.querySelector('.remove-item').addEventListener('click', () => {
      state.currentInvoice.items.splice(idx, 1);
      if (state.currentInvoice.items.length === 0) {
        state.currentInvoice.items.push({ description: '', qty: 1, unitPrice: 0 });
      }
      renderItems();
      updateTotals();
    });
  }

  function updateTotals() {
    state.currentInvoice.discountPercent = Number($('#inv-discount').value) || 0;
    state.currentInvoice.taxPercent = Number($('#inv-tax').value) || 0;
    const { subtotal, discountAmount, taxAmount, total } = computeTotals(state.currentInvoice);
    const symbol = state.settings.currencySymbol || '$';
    $('#sum-subtotal').textContent = symbol + money(subtotal);
    $('#sum-discount').textContent = '-' + symbol + money(discountAmount);
    $('#sum-tax').textContent = symbol + money(taxAmount);
    $('#sum-total').textContent = symbol + money(total);
  }

  function collectInvoiceFromForm() {
    const inv = state.currentInvoice;
    inv.number = $('#inv-number').value.trim();
    inv.customer = {
      name: $('#cust-name').value.trim(),
      email: $('#cust-email').value.trim(),
      address: $('#cust-address').value.trim(),
      phone: $('#cust-phone').value.trim()
    };
    inv.date = $('#inv-date').value || todayISO();
    inv.dueDate = $('#inv-due').value;
    inv.status = $('#inv-status').value;
    inv.stampPaid = $('#inv-stamp-paid').checked;
    inv.discountPercent = Number($('#inv-discount').value) || 0;
    inv.taxPercent = Number($('#inv-tax').value) || 0;
    inv.orderDetails = $('#inv-order-details').value;
    inv.items = inv.items.filter((it) => (it.description || '').trim() || Number(it.unitPrice) > 0);
    if (inv.items.length === 0) {
      inv.items = [{ description: 'Item', qty: 1, unitPrice: 0 }];
    }
    return inv;
  }

  // Saves the invoice and syncs back the id/number the main process assigns
  // to a brand-new invoice, so a follow-up action (like exporting straight
  // after saving) has a real id to work with instead of null.
  async function saveCurrentInvoice() {
    const inv = collectInvoiceFromForm();
    const wasNew = !inv.id;
    const data = await window.api.saveInvoice(inv);
    state.settings = data.settings;
    state.invoices = data.invoices;

    const saved = wasNew
      ? data.invoices[data.invoices.length - 1]
      : data.invoices.find((i) => i.id === inv.id) || inv;

    state.currentInvoice.id = saved.id;
    state.currentInvoice.number = saved.number;
    return saved;
  }

  // ---------- Settings ----------
  function renderSettings() {
    const s = state.settings;
    $('#set-name').value = s.companyName || '';
    $('#set-email').value = s.companyEmail || '';
    $('#set-address').value = s.companyAddress || '';
    $('#set-phone').value = s.companyPhone || '';
    $('#set-phone2').value = s.companyPhone2 || '';
    $('#set-website').value = s.companyWebsite || '';
    $('#set-currency').value = s.currencySymbol || '$';
    $('#set-tax-label').value = s.taxLabel || 'Tax';
    $('#set-prefix').value = s.invoicePrefix || '';
    $('#set-next-number').value = s.nextInvoiceNumber || 1;
    $('#set-bank-account-name').value = s.bankAccountName || '';
    $('#set-bank-account-number').value = s.bankAccountNumber || '';
    $('#set-bank-name').value = s.bankName || '';

    const preview = $('#logo-preview');
    const removeBtn = $('#remove-logo-btn');
    if (s.logoDataUrl) {
      preview.src = s.logoDataUrl;
      preview.hidden = false;
      removeBtn.hidden = false;
    } else {
      preview.hidden = true;
      removeBtn.hidden = true;
    }
  }

  async function saveSettingsFromForm() {
    const settings = {
      companyName: $('#set-name').value.trim(),
      companyEmail: $('#set-email').value.trim(),
      companyAddress: $('#set-address').value.trim(),
      companyPhone: $('#set-phone').value.trim(),
      companyPhone2: $('#set-phone2').value.trim(),
      companyWebsite: $('#set-website').value.trim(),
      // Currency symbol is taken as-typed (no trimming) so trailing spaces
      // the user deliberately added (e.g. "Rs. ") are kept.
      currencySymbol: $('#set-currency').value || '$',
      taxLabel: $('#set-tax-label').value.trim() || 'Tax',
      invoicePrefix: $('#set-prefix').value.trim(),
      nextInvoiceNumber: Number($('#set-next-number').value) || 1,
      logoDataUrl: state.settings.logoDataUrl || '',
      bankAccountName: $('#set-bank-account-name').value.trim(),
      bankAccountNumber: $('#set-bank-account-number').value.trim(),
      bankName: $('#set-bank-name').value.trim()
    };
    state.settings = await window.api.saveSettings(settings);
    renderDashboard();
    showToast('Settings saved.');
  }

  // ---------- Wire up ----------
  function wireEvents() {
    $$('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (view === 'settings') renderSettings();
        if (view === 'dashboard') renderDashboard();
        showView(view);
      });
    });

    $('#new-invoice-btn').addEventListener('click', () => openEditor(null));
    $('#empty-new-btn').addEventListener('click', () => openEditor(null));

    $('#search-input').addEventListener('input', (e) => {
      state.searchTerm = e.target.value;
      renderDashboard();
    });

    $('#add-item-btn').addEventListener('click', () => {
      state.currentInvoice.items.push({ description: '', qty: 1, unitPrice: 0 });
      renderItems();
      updateTotals();
    });

    ['#inv-discount', '#inv-tax'].forEach((sel) => {
      $(sel).addEventListener('input', updateTotals);
    });

    $('#editor-cancel-btn').addEventListener('click', () => {
      showView('dashboard');
      renderDashboard();
    });

    $('#editor-save-btn').addEventListener('click', async () => {
      await saveCurrentInvoice();
      showView('dashboard');
      renderDashboard();
    });

    $('#editor-export-btn').addEventListener('click', async () => {
      const saved = await saveCurrentInvoice();
      await exportPdf(saved.id);
      showView('dashboard');
      renderDashboard();
    });

    $('#pick-logo-btn').addEventListener('click', async () => {
      const dataUrl = await window.api.pickLogo();
      if (dataUrl) {
        state.settings.logoDataUrl = dataUrl;
        renderSettings();
      }
    });

    $('#remove-logo-btn').addEventListener('click', () => {
      state.settings.logoDataUrl = '';
      renderSettings();
    });

    $('#settings-save-btn').addEventListener('click', saveSettingsFromForm);
  }

  async function init() {
    const data = await window.api.getData();
    state.settings = data.settings;
    state.invoices = data.invoices;
    wireEvents();
    renderDashboard();
  }

  init();
})();