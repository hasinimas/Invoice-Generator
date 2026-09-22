# Sehasna Travels Invoice Generator

A cross-platform desktop invoicing app built with Electron. Create invoices with
line items, tax and discount, a company profile with logo, and export any
invoice to PDF — all data is stored locally on your machine, no server or
account required.

## Features

- Dashboard listing all invoices, searchable by number or customer
- Invoice editor: customer details, line items, discount %, tax %, notes,
  live totals
- Company settings: name, address, contact info, logo, currency symbol, tax
  label, invoice number prefix/sequence
- One-click PDF export (uses Electron's built-in PDF renderer — no extra
  dependencies)
- All data saved locally as JSON in your OS user-data folder — works fully
  offline

## Requirements

- [Node.js](https://nodejs.org) 18 or later (includes npm)

## Setup

```bash
cd invoice-app
npm install
```

## Run in development

```bash
npm start
```

This opens the app in a window. Data is stored at:

- **Windows:** `%APPDATA%/invoice-generator/data.json`
- **macOS:** `~/Library/Application Support/invoice-generator/data.json`
- **Linux:** `~/.config/invoice-generator/data.json`

## Build installers (Windows / macOS / Linux)

This project uses [electron-builder](https://www.electron.build/) to produce
native installers.

```bash
npm run dist         # build for your current OS
npm run dist:win      # Windows .exe (NSIS)
npm run dist:mac       # macOS .dmg
npm run dist:linux    # Linux .AppImage
```

Output goes to the `release/` folder. Note: building a Windows installer from
macOS/Linux (or vice versa) requires extra setup (e.g. Wine on Linux/macOS for
Windows targets) — building on the target OS is the most reliable option.

## Project structure

```
invoice-app/
├─ main.js              # Electron main process: window, IPC, local storage, PDF export
├─ preload.js            # Safe bridge exposing window.api to the renderer
├─ invoiceTemplate.js     # Builds the printable invoice HTML (used for PDF export)
├─ package.json
└─ src/
   ├─ index.html          # App shell (sidebar + 3 views: invoices, editor, settings)
   ├─ style.css
   └─ app.js              # Renderer logic (state, rendering, event wiring)
```

## Customizing the invoice PDF layout

Edit `invoiceTemplate.js` — it returns a full HTML document (with inline
`<style>`) that's rendered in a hidden window and printed to PDF. Change the
CSS there to restyle the exported PDF; it's independent from the in-app
`src/style.css`, which only styles the editor UI.

## Notes

- Invoice numbers auto-increment from the "Next invoice number" set in
  Company settings, prefixed with "Invoice number prefix" (default `INV-`).
- Deleting an invoice is permanent — there's a confirmation prompt, but there
  is no undo or trash.
- This app currently doesn't sync or back up data anywhere — back up
  `data.json` yourself if you need to preserve records (e.g. copy it into a
  cloud-synced folder).
