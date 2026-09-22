const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getData: () => ipcRenderer.invoke('data:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  pickLogo: () => ipcRenderer.invoke('dialog:pick-logo'),
  saveInvoice: (invoice) => ipcRenderer.invoke('invoice:save', invoice),
  deleteInvoice: (id) => ipcRenderer.invoke('invoice:delete', id),
  exportInvoicePdf: (id) => ipcRenderer.invoke('invoice:export-pdf', id),
  previewInvoiceHtml: (invoice) => ipcRenderer.invoke('invoice:preview-html', invoice)
});
