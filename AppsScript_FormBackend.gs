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
  'userEmail',
  // Added later for bug triage. Adding questions does NOT change the ids of
  // existing ones, so extending this list is safe; renaming or deleting is not.
  'orgId',
  'bankReported',
  'statementMonth'
];

// ------------------------------------------------------------
// These MUST stay identical to LOG_ENDPOINT and LOG_FIELD_MAP in app.html.
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
  userEmail:        'entry.640039570',
  orgId:            'entry.2087700925',
  bankReported:     'entry.923042208',
  statementMonth:   'entry.394294366'
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

  // ---- 3. Questions (add only the missing ones) ------------------------
  // Adding a question leaves every existing question's id untouched, so this
  // can extend an existing form safely. Never rename or delete a question:
  // that's what reassigns ids and silently breaks the app's posting.
  const existingTitles = form.getItems(FormApp.ItemType.TEXT).map(function (i) {
    return i.asTextItem().getTitle();
  });
  const missing = FORM_LOG_FIELDS.filter(function (name) {
    return existingTitles.indexOf(name) === -1;
  });
  if (missing.length === 0) {
    Logger.log('All ' + FORM_LOG_FIELDS.length + ' questions already present.');
  } else {
    missing.forEach(function (name) {
      formRetry_('add question "' + name + '"', function () {
        return form.addTextItem().setTitle(name);
      });
    });
    Logger.log('Added ' + missing.length + ' missing question(s): ' + missing.join(', '));
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

  // ---- 7. Weekly usage report ------------------------------------------
  installWeeklySummary_();
  Logger.log('Weekly usage summary scheduled (Mondays, around 6am).');

  // Let the edits settle before reading the form back.
  Utilities.sleep(3000);

  Logger.log(buildWiringReport_(form));
}

// Reads the values app.html needs. Separated so it can be re-run on its own
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
    lines.push('LOG_FIELD_MAP in app.html (and FORM_WIRED_FIELD_MAP here) to match.');
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

// ============================================================
// Usage reporting — who's using the tool and how often.
//
// Run buildUsageSummary() any time, or let the weekly trigger refresh it.
// It writes a "Usage Summary" tab to this spreadsheet: one block per person,
// one per month, and a list of open feedback. Reading the raw response rows
// isn't reporting; this is.
// ============================================================

function buildUsageSummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const responses = findResponsesSheet_(ss);
  if (!responses) throw new Error('No form-responses tab found in this spreadsheet.');

  const values = responses.getDataRange().getValues();
  if (values.length < 2) {
    Logger.log('No responses logged yet.');
    return;
  }

  const header = values[0].map(function (h) { return String(h).trim(); });
  const col = {};
  header.forEach(function (h, i) { col[h] = i; });

  const people = {};      // who -> {conversions, files, lastUsed, banks:{}, errors}
  const months = {};      // YYYY-MM -> {conversions, people:{}}
  const feedback = [];

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const when = row[0] instanceof Date ? row[0] : new Date(row[0]);
    const type = String(row[col.eventType] || '');
    const who = String(row[col.userEmail] || '').trim() || '(not identified)';

    if (type === 'selftest') continue;   // the monitor's own heartbeat rows

    if (type === 'conversion') {
      const p = people[who] || (people[who] = { conversions: 0, lastUsed: null, banks: {}, errors: 0 });
      p.conversions++;
      if (!p.lastUsed || when > p.lastUsed) p.lastUsed = when;
      const bank = String(row[col.issuer] || 'unknown');
      p.banks[bank] = (p.banks[bank] || 0) + 1;
      if (String(row[col.status] || '') !== 'success') p.errors++;

      const key = Utilities.formatDate(when, Session.getScriptTimeZone(), 'yyyy-MM');
      const m = months[key] || (months[key] = { conversions: 0, people: {} });
      m.conversions++;
      m.people[who] = true;
    }

    if (type === 'error') {
      const p = people[who] || (people[who] = { conversions: 0, lastUsed: null, banks: {}, errors: 0 });
      p.errors++;
    }

    if (type === 'bug_report' || type.indexOf('feedback_') === 0) {
      feedback.push([
        when,
        type === 'bug_report' ? 'Problem' : type.replace('feedback_', ''),
        who,
        String(row[col.orgId] || ''),
        String(row[col.bankReported] || row[col.issuer] || ''),
        String(row[col.userNote] || '').slice(0, 500)
      ]);
    }
  }

  const out = [];
  out.push(['PDF to CSV Converter — usage summary']);
  out.push(['Generated', new Date()]);
  out.push([]);

  out.push(['BY PERSON']);
  out.push(['Person', 'Conversions', 'Last used', 'Problems', 'Banks used']);
  Object.keys(people)
    .sort(function (a, b) { return people[b].conversions - people[a].conversions; })
    .forEach(function (who) {
      const p = people[who];
      const banks = Object.keys(p.banks)
        .sort(function (a, b) { return p.banks[b] - p.banks[a]; })
        .map(function (b) { return b + ' (' + p.banks[b] + ')'; })
        .join(', ');
      out.push([who, p.conversions, p.lastUsed, p.errors, banks]);
    });
  out.push([]);

  out.push(['BY MONTH']);
  out.push(['Month', 'Conversions', 'People who used it']);
  Object.keys(months).sort().forEach(function (key) {
    out.push([key, months[key].conversions, Object.keys(months[key].people).length]);
  });
  out.push([]);

  out.push(['FEEDBACK AND PROBLEMS']);
  out.push(['When', 'Kind', 'From', 'Org ID', 'Bank', 'What they said']);
  feedback.sort(function (a, b) { return b[0] - a[0]; }).forEach(function (f) { out.push(f); });

  writeSummarySheet_(ss, out);
  Logger.log('Usage summary rebuilt: ' + Object.keys(people).length + ' people, ' + feedback.length + ' feedback items.');
}

// The form's own tab is whichever one carries the questions as headers.
function findResponsesSheet_(ss) {
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const first = sheets[i].getRange(1, 1, 1, sheets[i].getLastColumn() || 1).getValues()[0];
    if (first.indexOf('eventType') !== -1 && first.indexOf('userEmail') !== -1) return sheets[i];
  }
  return null;
}

// Rewrites only the summary tab. Never touches the response data.
function writeSummarySheet_(ss, rows) {
  let sheet = ss.getSheetByName('Usage Summary');
  if (!sheet) sheet = ss.insertSheet('Usage Summary');
  sheet.clear();

  const width = rows.reduce(function (w, r) { return Math.max(w, r.length); }, 1);
  const padded = rows.map(function (r) {
    const copy = r.slice();
    while (copy.length < width) copy.push('');
    return copy;
  });

  sheet.getRange(1, 1, padded.length, width).setValues(padded);
  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setFontSize(12);
  padded.forEach(function (r, i) {
    const label = String(r[0]);
    if (label === 'BY PERSON' || label === 'BY MONTH' || label === 'FEEDBACK AND PROBLEMS') {
      sheet.getRange(i + 1, 1, 1, width).setFontWeight('bold').setBackground('#F0ECE2');
    }
  });
  sheet.setFrozenRows(2);
  for (let c = 1; c <= width; c++) sheet.autoResizeColumn(c);
}

function installWeeklySummary_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'buildUsageSummary') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('buildUsageSummary').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(6).create();
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
