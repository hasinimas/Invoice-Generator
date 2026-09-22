const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { buildInvoiceHtml } = require('./invoiceTemplate');

const DATA_FILE = () => path.join(app.getPath('userData'), 'data.json');

// Cap the number of stored invoices so the local JSON file (and the app)
// stay fast indefinitely. 2000 is generous for a single small business
// (years of invoices for most users) while keeping the data file small
// enough to read/write instantly on every save. Oldest invoices (by
// invoice date, falling back to creation order) are dropped first.
const MAX_INVOICES = 2000;

function enforceInvoiceLimit(data) {
  if (data.invoices.length <= MAX_INVOICES) return;
  data.invoices.sort((a, b) => {
    const dateCompare = (a.date || '').localeCompare(b.date || '');
    if (dateCompare !== 0) return dateCompare;
    return (a.id || '').localeCompare(b.id || '');
  });
  data.invoices = data.invoices.slice(data.invoices.length - MAX_INVOICES);
}

// Used as the default company logo for a brand-new install (no data.json
// yet). Once the user saves settings — including clearing the logo — their
// own value takes over and this is never consulted again.
function defaultLogoDataUrl() {
  try {
    const logoPath = path.join(__dirname, 'assets', 'logo-transparent.png');
    const b64 = fs.readFileSync(logoPath).toString('base64');
    return `data:image/png;base64,${b64}`;
  } catch (err) {
    return '';
  }
}

const DEFAULT_DATA = {
  settings: {
    companyName: '',
    companyAddress: '',
    companyPhone: '',
    companyPhone2: '',
    companyEmail: '',
    companyWebsite: '',
    currencySymbol: '$',
    taxLabel: 'Tax',
    invoicePrefix: '',
    nextInvoiceNumber: 6909001,
    logoDataUrl: defaultLogoDataUrl(),
    bankAccountName: '',
    bankAccountNumber: '',
    bankName: ''
  },
  invoices: []
};

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE(), 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_DATA, ...parsed, settings: { ...DEFAULT_DATA.settings, ...parsed.settings } };
  } catch (err) {
    return { ...DEFAULT_DATA };
  }
}

function saveData(data) {
  fs.mkdirSync(path.dirname(DATA_FILE()), { recursive: true });
  fs.writeFileSync(DATA_FILE(), JSON.stringify(data, null, 2), 'utf-8');
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(path.join(__dirname, 'assets', 'icon.png'));
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: data ----

ipcMain.handle('data:get', () => {
  return loadData();
});

ipcMain.handle('settings:save', (event, settings) => {
  const data = loadData();
  data.settings = { ...data.settings, ...settings };
  saveData(data);
  return data.settings;
});

ipcMain.handle('dialog:pick-logo', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select company logo',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const b64 = fs.readFileSync(filePath).toString('base64');
  return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${b64}`;
});

ipcMain.handle('invoice:save', (event, invoice) => {
  const data = loadData();
  const isNewInvoice = !invoice.id;

  if (isNewInvoice) {
    invoice.id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // The renderer pre-fills the number field with the predicted next
    // number so it shows up ready-to-go, but the user can freely type over
    // it before saving. Either way, once this invoice is new, the counter
    // always advances by one — whether the final number matches the
    // prediction or was overridden — so the *next* suggested number is
    // never reused or skipped.
    if (!invoice.number || !String(invoice.number).trim()) {
      invoice.number = `${data.settings.invoicePrefix || ''}${data.settings.nextInvoiceNumber}`;
    }
    data.settings.nextInvoiceNumber = (Number(data.settings.nextInvoiceNumber) || 0) + 1;
  }

  const idx = data.invoices.findIndex((i) => i.id === invoice.id);
  if (idx >= 0) {
    data.invoices[idx] = invoice;
  } else {
    data.invoices.push(invoice);
  }
  enforceInvoiceLimit(data);
  saveData(data);
  return data;
});

ipcMain.handle('invoice:delete', (event, id) => {
  const data = loadData();
  data.invoices = data.invoices.filter((i) => i.id !== id);
  saveData(data);
  return data;
});

ipcMain.handle('invoice:export-pdf', async (event, invoiceId) => {
  const data = loadData();
  const invoice = data.invoices.find((i) => i.id === invoiceId);
  if (!invoice) return { ok: false, error: 'Invoice not found' };

  const saveResult = await dialog.showSaveDialog(mainWindow, {
    title: 'Export invoice as PDF',
    defaultPath: `${invoice.number || 'invoice'}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (saveResult.canceled || !saveResult.filePath) return { ok: false, canceled: true };

  const html = buildInvoiceHtml(invoice, data.settings);

  const printWin = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true }
  });

  try {
    await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdfBuffer = await printWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'none' }
    });
    fs.writeFileSync(saveResult.filePath, pdfBuffer);
    return { ok: true, filePath: saveResult.filePath };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    printWin.destroy();
  }
});

ipcMain.handle('invoice:preview-html', (event, invoice) => {
  const data = loadData();
  return buildInvoiceHtml(invoice, data.settings);
});