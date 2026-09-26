// ============================================================
// Usage Log — menu shortcuts
// ============================================================
// This is NOT the tool. It is a shortcut, bound to the usage-log spreadsheet,
// so opening that Sheet gives you a menu that links to the converter and to
// its code.
//
// The converter itself is a standalone Apps Script project, which is why it
// never appears under this Sheet's Extensions menu and why this stub exists.
//
// ------------------------------------------------------------
// SETUP (once):
// 1. From the usage-log Sheet: Extensions > Apps Script. Google will open an
//    empty project called "Untitled project" — that's fine, use it.
// 2. Paste this file over the contents of Code.gs.
// 3. Rename the project (click its name, top left) to:  Usage Log — menu shortcuts
// 4. Run  onOpen  once and authorise.
// 5. Reload the spreadsheet. A "PDF to CSV" menu appears next to Help.
//
// Nothing else belongs in this project. If you find yourself editing the
// converter here, you are in the wrong place — use the menu to get to it.
// ============================================================

const TOOL_URL = 'https://script.google.com/a/macros/housecallpro.com/s/AKfycbyqMiovaFJWVyqHml-x4ey2YqN__Hx2GCb4ERbojvwlsHAZ048W3V2EL8HVlNj6ukdrkw/exec';
const SCRIPT_URL = 'https://script.google.com/d/18GCmkkXN1KQU3ol18sLb445my1ukuD2w7bNnup0SdaXSXSAwr1MsMM2z/edit';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('PDF to CSV')
    .addItem('Open the converter', 'openTool')
    .addItem('Open its code', 'openScript')
    .addToUi();
}

function openTool()   { openLink_(TOOL_URL, 'the converter'); }
function openScript() { openLink_(SCRIPT_URL, 'the script editor'); }

// Apps Script can't navigate the browser itself, so offer the link and try to
// open it. Pop-up blockers stop window.open silently, so the link is always
// there to click as well — never a dialog with nothing usable in it.
function openLink_(url, what) {
  const html = HtmlService.createHtmlOutput(
    '<style>body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:18px;color:#241F1A}' +
    'a{color:#B84800;font-weight:600;word-break:break-all}</style>' +
    '<p>Opening ' + what + '. If nothing happens, use this link:</p>' +
    '<p><a href="' + url + '" target="_blank" rel="noopener">' + url + '</a></p>' +
    '<script>window.open(' + JSON.stringify(url) + ', "_blank");<\/script>'
  ).setWidth(460).setHeight(170);
  SpreadsheetApp.getUi().showModalDialog(html, 'PDF to CSV');
}
