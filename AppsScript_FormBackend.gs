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
// 2. Paste this over the whole contents of the Form backend file. Leave the
//    old backend file alone — its doPost is dead but harmless.
// 3. Set FORM_ALERT_EMAIL below if alerts should go somewhere other than Karen.
// 4. Select "setUpLoggingForm" in the function dropdown and click Run.
//    Authorize when prompted.
// 5. Open View > Logs and copy the whole block it prints.
//
// This also schedules runLoggingSelfTest to run daily. That's the monitor:
// it submits a tagged row the same way the app does and checks it arrived,
// emailing FORM_ALERT_EMAIL if it didn't. No email means logging is healthy.
// To check on demand, run runLoggingSelfTest by hand — the log line says
// whether it passed.
//
// SAFE TO RE-RUN. It looks for an existing form by title and adopts it rather
// than creating a second one, only adds questions if there are none, only
// links the spreadsheet if it isn't linked, and replaces its own trigger
// instead of stacking duplicates. If a run dies partway through — Apps Script
// throws a transient "Failed to edit the form. Please wait and try again."
// under rapid successive edits — just run it again.
//
// Every .gs file in an Apps Script project shares ONE global scope, so a
// top-level name declared here must not also exist in the old file. That's
// why the constants below carry a FORM_ prefix: the old backend already
// declares ALERT_EMAIL, and two `const ALERT_EMAIL` declarations anywhere in
// the project are a SyntaxError that stops every function from running.
// ============================================================

const FORM_ALERT_EMAIL = 'karen.herring@housecallpro.com';

const FORM_TITLE = 'PDF to CSV Converter — Usage & Bug Log';

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

// ------------------------------------------------------------
// These MUST stay identical to LOG_ENDPOINT and LOG_FIELD_MAP in index.html.
// The daily self-test deliberately posts using these copies rather than asking
// the form for its current ids — that's the whole point. If someone edits the
// form and Google reassigns the ids, posting to the stale ids fails, the test
// row never lands, and you get an email. Deriving the ids live would hide
// exactly the failure this is meant to catch.
// ------------------------------------------------------------
const FORM_WIRED_POST_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSd813_hfyGvYxop0u_hv4u62SL8OOgjTyNz0D3-ae5D8pPhRg/formResponse';

const FORM_WIRED_FIELD_MAP = {
  eventType:        'entry.2124701020',
  issuer:           'entry.295167859',
  fileName:         'entry.515932360',
  transactionCount: 'entry.908279194',
  status:           'entry.525529088',
  message:          'entry.203522849',
  userNote:         'entry.1654949428',
  userEmail:        'entry.640039570'
};

// FormApp intermittently rejects an edit or read that closely follows another
// one. Retrying with a widening pause clears it; failing the whole run doesn't.
function formRetry_(label, fn) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
      Logger.log('  (retry ' + attempt + '/5 on "' + label + '": ' + err.message + ')');
      Utilities.sleep(1500 * attempt);
    }
  }
  throw new Error('"' + label + '" still failing after 5 attempts: ' + lastErr.message);
}

function setUpLoggingForm() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ---- 1. Find or create the form -------------------------------------
  const matches = [];
  const files = DriveApp.getFilesByName(FORM_TITLE);
  while (files.hasNext()) matches.push(files.next());

  let form;
  if (matches.length > 0) {
    form = formRetry_('open existing form', function () {
      return FormApp.openById(matches[0].getId());
    });
    Logger.log('Adopted existing form (' + matches.length + ' found with this title).');
    if (matches.length > 1) {
      Logger.log('WARNING: more than one form has this title. Delete the extras in Drive;');
      Logger.log('only the one in EDIT_URL below is wired up.');
    }
  } else {
    form = formRetry_('create form', function () {
      return FormApp.create(FORM_TITLE);
    });
    Logger.log('Created a new form.');
  }

  // ---- 2. Settings (each guarded; they're the flaky ones) --------------
  formRetry_('setRequireLogin(false)', function () {
    // The per-form "Restrict to users in Housecall Pro" toggle. If this
    // throws for real, an admin has locked it and the Form route is blocked
    // exactly like the web app was.
    form.setRequireLogin(false);
  });
  formRetry_('setCollectEmail(false)', function () { form.setCollectEmail(false); });
  formRetry_('setAcceptingResponses(true)', function () { form.setAcceptingResponses(true); });
  formRetry_('setDescription', function () {
    form.setDescription('Automated log. Rows are submitted by the converter app, not by people.');
  });
  Logger.log('Settings applied.');

  // ---- 3. Questions (only if the form has none) ------------------------
  let items = form.getItems(FormApp.ItemType.TEXT).map(function (i) { return i.asTextItem(); });
  if (items.length === 0) {
    items = FORM_LOG_FIELDS.map(function (name) {
      return formRetry_('add question "' + name + '"', function () {
        return form.addTextItem().setTitle(name);
      });
    });
    Logger.log('Added ' + items.length + ' questions.');
  } else {
    Logger.log('Form already has ' + items.length + ' questions; left as-is.');
  }

  // ---- 4. Link responses to this spreadsheet (only if unlinked) --------
  let destination = null;
  try { destination = form.getDestinationId(); } catch (e) { destination = null; }
  if (destination) {
    Logger.log('Responses already linked to a spreadsheet.');
  } else {
    formRetry_('setDestination', function () {
      form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
    });
    Logger.log('Linked responses to this spreadsheet.');
  }

  // ---- 5. Alert trigger (replace, never stack) -------------------------
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onLoggingFormSubmit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onLoggingFormSubmit').forForm(form).onFormSubmit().create();
  Logger.log('Alert trigger registered.');

  // ---- 6. Daily "is logging still alive?" check ------------------------
  installDailySelfTest_();
  Logger.log('Daily self-test scheduled (around 7am).');

  // Let the edits settle before reading the form back.
  Utilities.sleep(3000);

  Logger.log(buildWiringReport_(form));
}

// Reads the values index.html needs. Separated so it can be re-run on its own
// if setUpLoggingForm dies after the form is already built.
function buildWiringReport_(form) {
  const items = form.getItems(FormApp.ItemType.TEXT).map(function (i) { return i.asTextItem(); });

  // Submitting each field's own name as its value makes the entry.N mapping
  // unambiguous regardless of the order Google emits the parameters in.
  const prefilled = formRetry_('build prefilled url', function () {
    let response = form.createResponse();
    items.forEach(function (item) {
      response = response.withItemResponse(item.createResponse(item.getTitle()));
    });
    return response.toPrefilledUrl();
  });

  const mapping = {};
  prefilled.split('?')[1].split('&').forEach(function (pair) {
    const parts = pair.split('=');
    if (parts[0].indexOf('entry.') === 0) {
      mapping[decodeURIComponent(parts[1])] = parts[0];
    }
  });

  const postUrl = formRetry_('get published url', function () {
    return form.getPublishedUrl();
  }).replace(/\/viewform.*$/, '/formResponse');

  // Non-essential: report it if available, but never fail the run over it.
  let requiresLogin = 'could not read (re-run showLoggingFormWiring to check)';
  try {
    requiresLogin = String(form.requiresLogin());
  } catch (e) {
    Logger.log('  (note: requiresLogin() read failed: ' + e.message + ')');
  }

  return [
    '',
    '================ COPY EVERYTHING BELOW ================',
    'POST_URL: ' + postUrl,
    'FIELD_MAP: ' + JSON.stringify(mapping),
    'EDIT_URL: ' + form.getEditUrl(),
    'REQUIRES_LOGIN: ' + requiresLogin,
    '================ COPY EVERYTHING ABOVE ================'
  ].join('\n');
}

// Prints the wiring details for the existing form without changing anything.
// Run this if setUpLoggingForm already built the form and you just need the
// values again, or to re-check REQUIRES_LOGIN.
function showLoggingFormWiring() {
  const files = DriveApp.getFilesByName(FORM_TITLE);
  if (!files.hasNext()) throw new Error('No form titled "' + FORM_TITLE + '" found. Run setUpLoggingForm first.');
  const form = FormApp.openById(files.next().getId());
  Logger.log(buildWiringReport_(form));
}

// ============================================================
// Daily self-test — the thing that tells you when logging has broken.
//
// The app cannot detect a failed send: browsers hide the response from a
// cross-site form post, so a broken pipeline looks identical to a working one
// from the user's side, and they'd still be told their report was submitted.
// This closes that gap from the outside: once a day it submits a tagged row
// exactly the way the app does, then checks whether the row actually arrived.
// If it didn't, you get an email. Silence means it's working.
// ============================================================

function runLoggingSelfTest() {
  const token = 'selftest-' + Utilities.getUuid().slice(0, 8);
  const startedAt = new Date(Date.now() - 60 * 1000);

  const payload = {};
  payload[FORM_WIRED_FIELD_MAP.eventType] = 'selftest';
  payload[FORM_WIRED_FIELD_MAP.issuer] = 'monitor';
  payload[FORM_WIRED_FIELD_MAP.fileName] = token;
  payload[FORM_WIRED_FIELD_MAP.transactionCount] = '0';
  payload[FORM_WIRED_FIELD_MAP.status] = 'selftest';
  payload[FORM_WIRED_FIELD_MAP.message] = 'Automated daily check that logging still works.';

  let postError = null;
  let httpStatus = null;
  try {
    const res = UrlFetchApp.fetch(FORM_WIRED_POST_URL, {
      method: 'post',
      payload: payload,
      followRedirects: true,
      muteHttpExceptions: true
    });
    httpStatus = res.getResponseCode();
  } catch (err) {
    postError = err.message;
  }

  // Did the row actually land? Retry briefly; Forms writes are quick but not
  // instant, and a slow write shouldn't read as an outage.
  const form = FormApp.openById(findLoggingFormId_());
  let landed = false;
  for (let attempt = 1; attempt <= 6 && !landed; attempt++) {
    Utilities.sleep(5000);
    try {
      landed = form.getResponses(startedAt).some(function (response) {
        return response.getItemResponses().some(function (ir) {
          return String(ir.getResponse()).indexOf(token) !== -1;
        });
      });
    } catch (err) {
      // transient FormApp read failure; try again
    }
  }

  // Separately: have the form's ids drifted away from what's wired up? This
  // catches a form edit before it silently costs you real reports.
  const drifted = detectFieldIdDrift_(form);

  if (landed && drifted.length === 0) {
    Logger.log('Self-test OK — ' + token + ' submitted and found. Field ids match.');
    return;
  }

  const lines = ['The PDF to CSV Converter logging pipeline looks broken.', ''];
  if (!landed) {
    lines.push('A test submission did not arrive in the log.');
    lines.push('  Token:       ' + token);
    lines.push('  HTTP status: ' + (httpStatus === null ? 'request threw' : httpStatus));
    if (postError) lines.push('  Error:       ' + postError);
    lines.push('');
    lines.push('Users filing bug reports right now are being told their report');
    lines.push('was submitted, but nothing is being recorded.');
    lines.push('');
  }
  if (drifted.length > 0) {
    lines.push('The form\'s field ids no longer match what the app posts to.');
    lines.push('Someone has probably edited the form\'s questions.');
    drifted.forEach(function (d) {
      lines.push('  ' + d.field + ': app posts to ' + d.wired + ', form now expects ' + d.actual);
    });
    lines.push('');
    lines.push('Fix: run showLoggingFormWiring, then update LOG_ENDPOINT and');
    lines.push('LOG_FIELD_MAP in index.html (and FORM_WIRED_FIELD_MAP here) to match.');
    lines.push('');
  }
  lines.push('App:  https://karenherring-hcp.github.io/pdf-to-csv-converter/');
  lines.push('Repo: https://github.com/karenherring-hcp/pdf-to-csv-converter');

  MailApp.sendEmail(
    FORM_ALERT_EMAIL,
    '[PDF to CSV] ACTION NEEDED — logging has stopped working',
    lines.join('\n')
  );
  Logger.log('Self-test FAILED; alert email sent.');
}

function findLoggingFormId_() {
  const files = DriveApp.getFilesByName(FORM_TITLE);
  if (!files.hasNext()) throw new Error('No form titled "' + FORM_TITLE + '" found.');
  return files.next().getId();
}

// Compares the ids the app posts to against the form's current ids.
function detectFieldIdDrift_(form) {
  const items = form.getItems(FormApp.ItemType.TEXT).map(function (i) { return i.asTextItem(); });
  let response = form.createResponse();
  items.forEach(function (item) {
    response = response.withItemResponse(item.createResponse(item.getTitle()));
  });

  const actual = {};
  response.toPrefilledUrl().split('?')[1].split('&').forEach(function (pair) {
    const parts = pair.split('=');
    if (parts[0].indexOf('entry.') === 0) actual[decodeURIComponent(parts[1])] = parts[0];
  });

  const drift = [];
  for (const field in FORM_WIRED_FIELD_MAP) {
    if (actual[field] !== FORM_WIRED_FIELD_MAP[field]) {
      drift.push({ field: field, wired: FORM_WIRED_FIELD_MAP[field], actual: actual[field] || '(question missing)' });
    }
  }
  return drift;
}

function installDailySelfTest_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runLoggingSelfTest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runLoggingSelfTest').timeBased().everyDays(1).atHour(7).create();
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
