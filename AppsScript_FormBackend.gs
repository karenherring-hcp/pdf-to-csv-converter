// ============================================================
// PDF to CSV Converter — logging backend (Google Form edition)
// ============================================================
// WHY A FORM INSTEAD OF A WEB APP:
// The original backend was an Apps Script web app. It can't work here: the
// housecallpro.com Workspace policy blocks sharing Apps Script web apps
// outside the domain, so anonymous POSTs get a 302 to accounts.google.com
// and a 401. Confirmed against three separate deployments.
//
// A Google Form has its own per-form login toggle that the form's OWNER
// controls (setRequireLogin below), so it accepts anonymous submissions
// without any admin involvement.
//
// ------------------------------------------------------------
// HOW TO USE:
// 1. Open the "Statement-to-CSV — Usage Log" Sheet > Extensions > Apps Script.
// 2. Add this as a NEW file (File > + > Script). Leave any existing code
//    alone — the old doPost is dead but harmless.
// 3. Set FORM_ALERT_EMAIL below if it should go somewhere other than Karen.
//
// Every .gs file in an Apps Script project shares ONE global scope, so a
// top-level name declared here must not also exist in the old file. That's
// why the constants below carry a FORM_ prefix: the old backend already
// declares ALERT_EMAIL, and two `const ALERT_EMAIL` declarations anywhere in
// the project are a SyntaxError that stops every function from running.
// 4. Select "setUpLoggingForm" in the function dropdown and click Run.
//    Authorize when prompted.
// 5. Open View > Logs and copy the whole block it prints. That output has
//    the POST URL and field IDs needed to wire up index.html.
//
// Running setUpLoggingForm twice creates a SECOND form. Run it once.
// ============================================================

const FORM_ALERT_EMAIL = 'karen.herring@housecallpro.com';

// Order matters only for readability; the wiring is by name.
const FORM_LOG_FIELDS = [
  'eventType',
  'issuer',
  'fileName',
  'transactionCount',
  'status',
  'message',
  'userNote',
  'userEmail'
];

function setUpLoggingForm() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const form = FormApp.create('PDF to CSV Converter — Usage & Bug Log');
  form.setDescription('Automated log. Rows are submitted by the converter app, not by people.');

  // The important line: this is the per-form "Restrict to users in Housecall
  // Pro" toggle. Without it, anonymous submissions are bounced to a sign-in
  // page exactly like the web app was. If this throws, an admin has locked
  // the setting and the whole Form approach is blocked too — report the error.
  form.setRequireLogin(false);

  form.setCollectEmail(false);
  form.setAllowResponseEdits(false);
  form.setAcceptingResponses(true);
  form.setProgressBar(false);

  const items = FORM_LOG_FIELDS.map(function (name) {
    return form.addTextItem().setTitle(name);
  });

  // Responses land in a new tab of the existing usage-log spreadsheet.
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  // Email alerts, replacing the web app's sendAlert().
  ScriptApp.newTrigger('onLoggingFormSubmit')
    .forForm(form)
    .onFormSubmit()
    .create();

  // Recover the entry.N ids the app has to POST to. Submitting each field's
  // own name as its value makes the mapping unambiguous regardless of the
  // order Google emits the query parameters in.
  let response = form.createResponse();
  items.forEach(function (item) {
    response = response.withItemResponse(item.createResponse(item.getTitle()));
  });
  const prefilled = response.toPrefilledUrl();

  const mapping = {};
  prefilled.split('?')[1].split('&').forEach(function (pair) {
    const parts = pair.split('=');
    if (parts[0].indexOf('entry.') === 0) {
      mapping[decodeURIComponent(parts[1])] = parts[0];
    }
  });

  const postUrl = form.getPublishedUrl().replace(/\/viewform.*$/, '/formResponse');

  const out = [
    '================ COPY EVERYTHING BELOW ================',
    'POST_URL: ' + postUrl,
    'FIELD_MAP: ' + JSON.stringify(mapping),
    'EDIT_URL: ' + form.getEditUrl(),
    'REQUIRES_LOGIN: ' + form.requiresLogin(),
    '================ COPY EVERYTHING ABOVE ================'
  ].join('\n');

  Logger.log(out);
  return out;
}

function onLoggingFormSubmit(e) {
  const data = {};
  e.response.getItemResponses().forEach(function (ir) {
    data[ir.getItem().getTitle()] = ir.getResponse();
  });

  const alertWorthy =
    data.eventType === 'error' ||
    data.eventType === 'bug_report' ||
    data.status === 'zero_transactions';
  if (!alertWorthy) return;

  const kind = data.eventType === 'bug_report' ? 'Bug report' : 'Error';
  const subject = '[PDF to CSV] ' + kind + ' — ' + (data.issuer || 'unknown bank');
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

  MailApp.sendEmail(FORM_ALERT_EMAIL, subject, body);
}

// Prints the wiring details again without creating anything. Useful if the
// setUpLoggingForm output scrolled away. Paste the form's edit URL in first.
function showExistingFormWiring() {
  const EDIT_URL = '';  // <-- paste the form's edit URL here, then Run this
  if (!EDIT_URL) throw new Error('Set EDIT_URL first.');

  const form = FormApp.openByUrl(EDIT_URL);
  const items = form.getItems(FormApp.ItemType.TEXT).map(function (i) {
    return i.asTextItem();
  });

  let response = form.createResponse();
  items.forEach(function (item) {
    response = response.withItemResponse(item.createResponse(item.getTitle()));
  });

  const mapping = {};
  response.toPrefilledUrl().split('?')[1].split('&').forEach(function (pair) {
    const parts = pair.split('=');
    if (parts[0].indexOf('entry.') === 0) {
      mapping[decodeURIComponent(parts[1])] = parts[0];
    }
  });

  Logger.log([
    'POST_URL: ' + form.getPublishedUrl().replace(/\/viewform.*$/, '/formResponse'),
    'FIELD_MAP: ' + JSON.stringify(mapping),
    'REQUIRES_LOGIN: ' + form.requiresLogin()
  ].join('\n'));
}
