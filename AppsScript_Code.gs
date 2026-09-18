// ============================================================
// Statement-to-CSV — logging + alerting backend
// ============================================================
// SETUP:
// 1. Open the "Statement-to-CSV — Usage Log" Google Sheet.
// 2. Extensions > Apps Script.
// 3. Delete any starter code and paste this whole file in.
// 4. Replace ALERT_EMAIL below with the address that should get
//    error/bug-report alerts (can be a distribution list).
// 5. Deploy > New deployment > select type "Web app".
//      - Execute as: Me
//      - Who has access: Anyone
//    Click Deploy, authorize when prompted, then copy the Web
//    App URL (it ends in /exec). Send that URL back so the app
//    can be wired up to it, or paste it into LOG_ENDPOINT near
//    the top of statement-to-csv.html yourself.
// ============================================================

const ALERT_EMAIL = 'REPLACE_WITH_YOUR_EMAIL@example.com';

function doPost(e) {
  const sheet = getLogSheet();
  let data = {};
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    // Ignore malformed payloads rather than erroring the whole endpoint.
  }

  sheet.appendRow([
    new Date(),
    data.eventType || '',
    data.issuer || '',
    data.fileName || '',
    (data.transactionCount !== undefined && data.transactionCount !== null) ? data.transactionCount : '',
    data.status || '',
    data.message || '',
    data.userNote || '',
    data.userEmail || ''
  ]);

  if (data.eventType === 'error' || data.eventType === 'bug_report' || data.status === 'zero_transactions') {
    sendAlert(data);
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Log');
  if (!sheet) {
    sheet = ss.insertSheet('Log');
    sheet.appendRow(['Timestamp', 'Event Type', 'Bank/Issuer', 'File Name', 'Transaction Count', 'Status', 'Message', 'User Note', 'User Email']);
    sheet.getRange(1, 1, 1, 9).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function sendAlert(data) {
  const kind = data.eventType === 'bug_report' ? 'Bug report' : 'Error';
  const subject = '[Statement-to-CSV] ' + kind + ' — ' + (data.issuer || 'unknown bank');
  const body = [
    'Event: ' + (data.eventType || 'n/a'),
    'Bank/Issuer: ' + (data.issuer || 'n/a'),
    'File: ' + (data.fileName || 'n/a'),
    'Status: ' + (data.status || 'n/a'),
    'Message: ' + (data.message || 'n/a'),
    'User note: ' + (data.userNote || 'n/a'),
    'User email: ' + (data.userEmail || 'n/a'),
    'Time: ' + new Date()
  ].join('\n');
  MailApp.sendEmail(ALERT_EMAIL, subject, body);
}

// Optional: quick manual test. Run this once from the Apps Script editor
// (select testLog in the function dropdown, click Run) to confirm the
// sheet gets a row and, if you trigger an error test, that email arrives.
function testLog() {
  doPost({ postData: { contents: JSON.stringify({
    eventType: 'conversion', issuer: 'homedepot', fileName: 'test.pdf',
    transactionCount: 5, status: 'success'
  }) } });
}
