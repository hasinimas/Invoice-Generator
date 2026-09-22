// Builds a self-contained HTML document for an invoice.
// Used by main.js to render into a hidden window before printing to PDF.

const fs = require('fs');
const path = require('path');

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(amount, symbol) {
  const n = Number(amount) || 0;
  return `${symbol}${n.toFixed(2)}`;
}

function computeTotals(invoice) {
  const subtotal = (invoice.items || []).reduce(
    (sum, item) => sum + (Number(item.qty) || 0) * (Number(item.unitPrice) || 0),
    0
  );
  const discountPercent = Number(invoice.discountPercent) || 0;
  const taxPercent = Number(invoice.taxPercent) || 0;
  const discountAmount = subtotal * (discountPercent / 100);
  const taxable = subtotal - discountAmount;
  const taxAmount = taxable * (taxPercent / 100);
  const total = taxable + taxAmount;
  return { subtotal, discountAmount, taxAmount, total };
}

// The bundled default stamp graphic (assets/paid-stamp.png, shipped alongside
// this file). Read once and cached as a base64 data URL so the generated
// invoice HTML stays fully self-contained (no file:// or relative-path
// lookups from inside the hidden print window).
let _defaultStampDataUrl = null;
function getDefaultStampDataUrl() {
  if (_defaultStampDataUrl) return _defaultStampDataUrl;
  try {
    const file = fs.readFileSync(path.join(__dirname, 'assets', 'paid-stamp.png'));
    _defaultStampDataUrl = `data:image/png;base64,${file.toString('base64')}`;
  } catch (err) {
    console.warn('Paid stamp image not found; skipping stamp.', err.message);
    _defaultStampDataUrl = '';
  }
  return _defaultStampDataUrl;
}

// Small contact icons (location/phone/email/website) for the header block.
// Expected files, add these under assets/ whenever you're ready — anything
// missing is simply skipped (the label still shows, just without an icon),
// so the app works fine before and after you drop them in:
//   assets/icon-location.png
//   assets/icon-phone.png
//   assets/icon-email.png
//   assets/icon-website.png
const _iconCache = {};
function getIconDataUrl(name) {
  if (_iconCache[name] !== undefined) return _iconCache[name];
  try {
    const file = fs.readFileSync(path.join(__dirname, 'assets', `icon-${name}.png`));
    _iconCache[name] = `data:image/png;base64,${file.toString('base64')}`;
  } catch (err) {
    _iconCache[name] = '';
  }
  return _iconCache[name];
}

function contactRow(iconName, text) {
  if (!text) return '';
  const icon = getIconDataUrl(iconName);
  const iconImg = icon ? `<img src="${icon}" class="contact-icon" alt="" />` : '';
  return `<div class="contact-row">${iconImg}<span>${text}</span></div>`;
}

// The stamp is a real image (assets/paid-stamp.png by default) dropped onto
// the invoice. settings.stampImageDataUrl lets a caller swap in a different
// stamp graphic (e.g. a scanned company stamp) the same way
// settings.logoDataUrl overrides the logo — pass a data: URL and it's used
// as-is.
function buildStampHtml(invoice, settings) {
  if (!invoice.stampPaid || invoice.status !== 'paid') return '';
  const stampSrc = settings.stampImageDataUrl || getDefaultStampDataUrl();
  if (!stampSrc) return '';
  return `
  <div class="stamp-wrap">
    <img src="${stampSrc}" class="stamp-image" alt="Paid stamp" />
  </div>`;
}

function buildInvoiceHtml(invoice, settings) {
  const symbol = settings.currencySymbol || '$';
  const { subtotal, discountAmount, taxAmount, total } = computeTotals(invoice);

  const rows = (invoice.items || [])
    .map((item) => {
      const lineTotal = (Number(item.qty) || 0) * (Number(item.unitPrice) || 0);
      return `
        <tr>
          <td>${escapeHtml(item.description)}</td>
          <td class="num">${Number(item.qty) || 0}</td>
          <td class="num">${money(item.unitPrice, symbol)}</td>
          <td class="num">${money(lineTotal, symbol)}</td>
        </tr>`;
    })
    .join('');

  const logoBlock = settings.logoDataUrl
    ? `<img src="${settings.logoDataUrl}" class="logo" />`
    : '';

  const phonesText = [settings.companyPhone, settings.companyPhone2].filter(Boolean).map(escapeHtml).join(' / ');
  const contactBlock = [
    contactRow('location', settings.companyAddress ? escapeHtml(settings.companyAddress) : ''),
    contactRow('phone', phonesText),
    contactRow('email', settings.companyEmail ? escapeHtml(settings.companyEmail) : ''),
    contactRow('website', settings.companyWebsite ? escapeHtml(settings.companyWebsite) : '')
  ].join('');

  const hasPaymentDetails = settings.bankAccountName || settings.bankAccountNumber || settings.bankName;
  const paymentDetailsHtml = hasPaymentDetails
    ? `
  <div class="section-block">
    <div class="label">Payment details</div>
    <div class="payment-grid">
      ${settings.bankAccountName ? `<div><span class="muted">Account name</span><br /><strong>${escapeHtml(settings.bankAccountName)}</strong></div>` : ''}
      ${settings.bankAccountNumber ? `<div><span class="muted">Account number</span><br /><strong>${escapeHtml(settings.bankAccountNumber)}</strong></div>` : ''}
      ${settings.bankName ? `<div><span class="muted">Bank</span><br /><strong>${escapeHtml(settings.bankName)}</strong></div>` : ''}
    </div>
  </div>`
    : '';

  const orderDetailsHtml = invoice.orderDetails
    ? `
  <div class="section-block">
    <div class="label">Order details</div>
    <div class="section-text">${escapeHtml(invoice.orderDetails)}</div>
  </div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  /* Professional, neutral palette: charcoal-navy for structure, a single
     muted plum accent for the invoice title — kept deliberately restrained
     rather than pulling in the bright brand gradient, which reads better
     on a printed business document. */
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    color: #1f2430;
    margin: 40px;
    font-size: 13px;
  }
  .page { position: relative; }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    border-bottom: 3px solid #2f2b45;
    padding-bottom: 16px;
    margin-bottom: 24px;
  }
  .logo { max-height: 60px; max-width: 180px; margin-bottom: 8px; }
  .company-name { font-size: 23px; font-weight: 700; margin-bottom: 4px; }
  .muted { color: #6b7280; }
  .contact-row { display: flex; align-items: center; gap: 6px; color: #6b7280; font-size: 12px; margin-top: 3px; }
  .contact-icon { width: 12px; height: 12px; object-fit: contain; flex: none; }
  .invoice-title {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: 1px;
    color: #4f4370;
    text-align: right;
  }
  .meta-table { text-align: right; margin-top: 8px; }
  .meta-table td { padding: 2px 0 2px 12px; }
  .parties { display: flex; justify-content: space-between; margin-bottom: 24px; }
  .parties .block { max-width: 45%; }
  .label { text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; color: #6b7280; margin-bottom: 4px; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  table.items th {
    text-align: left;
    background: #2f2b45;
    color: #fff;
    padding: 8px 10px;
    font-size: 11px;
    text-transform: uppercase;
  }
  table.items td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
  table.items th.num, table.items td.num { text-align: right; }
  /* The stamp and totals sit in the same flex row so they can never
     overlap each other or the items table, regardless of how many line
     items or totals rows an invoice has — no manual pixel offsets to
     fight with. margin-left: auto on .totals pushes it to the right edge
     of the row whether or not a stamp is present alongside it. */
  .totals-row { display: flex; align-items: flex-end; margin-top: 4px; gap: 24px; }
  .totals { width: 280px; margin-left: auto; }
  .totals tr td { padding: 4px 0; }
  .totals tr td:last-child { text-align: right; }
  .totals .grand { font-size: 16px; font-weight: 700; color: #2f2b45; border-top: 2px solid #1f2430; padding-top: 8px; }
  .stamp-wrap {
    flex: none;
    opacity: 0.85;
    transform: rotate(-12deg);
    pointer-events: none;
  }
  .stamp-image {
    width: 130px;
    height: 130px;
    display: block;
    object-fit: contain;
  }
  .section-block { margin-top: 28px; }
  .section-text { font-size: 12px; color: #374151; white-space: pre-wrap; }
  .payment-grid { display: flex; gap: 36px; margin-top: 4px; }
  .payment-grid > div { font-size: 12px; }
  .payment-grid strong { font-size: 13px; }
  .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #9ca3af; }
</style>
</head>
<body>
  <div class="page">
  <div class="header">
    <div>
      ${logoBlock}
      <div class="company-name">${escapeHtml(settings.companyName || 'Your Company')}</div>
      ${contactBlock}
    </div>
    <div>
      <div class="invoice-title">INVOICE</div>
      <table class="meta-table">
        <tr><td class="muted">Invoice #</td><td><strong>${escapeHtml(invoice.number)}</strong></td></tr>
        <tr><td class="muted">Date</td><td>${escapeHtml(invoice.date)}</td></tr>
        <tr><td class="muted">Due date</td><td>${escapeHtml(invoice.dueDate || '-')}</td></tr>
        <tr><td class="muted">Status</td><td>${escapeHtml((invoice.status || 'draft').toUpperCase())}</td></tr>
      </table>
    </div>
  </div>

  <div class="parties">
    <div class="block">
      <div class="label">Bill to</div>
      <div><strong>${escapeHtml(invoice.customer?.name)}</strong></div>
      <div class="muted">${escapeHtml(invoice.customer?.address)}</div>
      <div class="muted">${escapeHtml(invoice.customer?.email)} ${invoice.customer?.phone ? '&middot; ' + escapeHtml(invoice.customer.phone) : ''}</div>
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>Description</th>
        <th class="num">No of PAX</th>
        <th class="num">Rate</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="4" class="muted">No items</td></tr>'}
    </tbody>
  </table>

  <div class="totals-row">
    ${buildStampHtml(invoice, settings)}
    <table class="totals">
      <tr><td>Subtotal</td><td>${money(subtotal, symbol)}</td></tr>
      ${invoice.discountPercent ? `<tr><td>Discount (${invoice.discountPercent}%)</td><td>-${money(discountAmount, symbol)}</td></tr>` : ''}
      ${invoice.taxPercent ? `<tr><td>${escapeHtml(settings.taxLabel || 'Tax')} (${invoice.taxPercent}%)</td><td>${money(taxAmount, symbol)}</td></tr>` : ''}
      <tr class="grand"><td>Total</td><td>${money(total, symbol)}</td></tr>
    </table>
  </div>

  ${orderDetailsHtml}

  ${paymentDetailsHtml}
  </div>
</body>
</html>`;
}

module.exports = { buildInvoiceHtml, computeTotals };