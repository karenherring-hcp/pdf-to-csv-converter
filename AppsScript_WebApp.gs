// ============================================================
// PDF to CSV Converter — Apps Script web app
// ============================================================
// This is the whole backend. It serves the page, identifies the signed-in user,
// logs usage straight to the Sheet, and provides AI extraction for statements
// the built-in parsers can't read.
//
// ------------------------------------------------------------
// SETUP — do these in order, once.
//
// 1. Create a NEW Apps Script project at script.new. Name it
//    "PDF to CSV Converter".
// 2. Paste this file over Code.gs.
// 3. Add an HTML file named exactly  Index  (File > + > HTML) and paste in the
//    entire contents of index.html from the repo.
// 4. Set LOG_SHEET_ID below to the id of the usage-log spreadsheet.
// 5. Run  setGeminiApiKey  once with the key pasted in, then clear it and save.
// 6. Run  listGeminiModels  and copy a model name from the log into
//    GEMINI_MODEL below.
// 7. Deploy > New deployment > Web app
//       Execute as:     User accessing the web app
//       Who has access: Anyone within Housecall Pro
//    Deploy, authorize, share the /exec URL.
// 8. Run  testSetup  to confirm all four pieces work.
// ============================================================

// The "Statement-to-CSV — Usage Log" spreadsheet id (the long string in its URL).
const LOG_SHEET_ID = '1mpWzJAiDh3papsQyV1g8tgVq3zflGZZxYauySseNr7w';
const LOG_TAB = 'Usage';
const ALERT_TO = 'karen.herring@housecallpro.com';

// Set this from the output of listGeminiModels().
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_HOST = 'https://generativelanguage.googleapis.com/v1beta';

// ------------------------------------------------------------
// Serving the page
// ------------------------------------------------------------

function doGet() {
  const page = HtmlService.createTemplateFromFile('Index').getRawContent();
  const email = currentUserEmail_();

  const withIdentity = page.replace(
    /let SERVER_IDENTITY = \{[^}]*\}; \/\*SERVER_IDENTITY\*\//,
    'let SERVER_IDENTITY = ' + JSON.stringify({ name: nameFromEmail_(email), email: email }) + '; /*SERVER_IDENTITY*/'
  );

  return HtmlService.createHtmlOutput(withIdentity)
    .setTitle('PDF to CSV Converter')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function currentUserEmail_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (err) { return ''; }
}

function nameFromEmail_(email) {
  if (!email) return '';
  return email.split('@')[0].split(/[._-]+/).filter(String)
    .map(function (p) { return p.charAt(0).toUpperCase() + p.slice(1); }).join(' ');
}

// ------------------------------------------------------------
// Logging — straight to the Sheet, as the owner, with the real signed-in user.
// Unlike the old form endpoint, a failure here actually surfaces.
// ------------------------------------------------------------

const LOG_COLUMNS = ['Timestamp', 'User', 'Event', 'Bank detected', 'File name',
                     'Transactions', 'Status', 'Message', 'Feedback', 'Org ID',
                     'Bank reported', 'Statement month'];

function logUsage(payload) {
  try {
    const sheet = logSheet_();
    const p = payload || {};
    sheet.appendRow([
      new Date(), currentUserEmail_(), p.eventType || '', p.issuer || '',
      p.fileName || '', p.transactionCount === undefined ? '' : p.transactionCount,
      p.status || '', p.message || '', p.userNote || '', p.orgId || '',
      p.bankReported || '', p.statementMonth || ''
    ]);
    if (p.eventType === 'error' || p.eventType === 'bug_report' ||
        p.status === 'zero_transactions' || p.status === 'does_not_balance') {
      sendAlert_(p);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function logSheet_() {
  const ss = SpreadsheetApp.openById(LOG_SHEET_ID);
  let sheet = ss.getSheetByName(LOG_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_TAB);
    sheet.appendRow(LOG_COLUMNS);
    sheet.getRange(1, 1, 1, LOG_COLUMNS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function sendAlert_(p) {
  const kind = p.eventType === 'bug_report' ? 'Feedback' : 'Problem';
  MailApp.sendEmail(ALERT_TO,
    '[PDF to CSV] ' + kind + ' — ' + (p.bankReported || p.issuer || 'unknown bank'),
    ['User: ' + currentUserEmail_(),
     'Event: ' + (p.eventType || ''),
     'Bank detected: ' + (p.issuer || ''),
     'Bank reported: ' + (p.bankReported || ''),
     'Org ID: ' + (p.orgId || ''),
     'Statement month: ' + (p.statementMonth || ''),
     'File: ' + (p.fileName || ''),
     'Status: ' + (p.status || ''),
     'Message: ' + (p.message || ''),
     'Note: ' + (p.userNote || ''),
     'Time: ' + new Date()].join('\n'));
}

// ------------------------------------------------------------
// Usage stats, shown back to the person using the tool.
// The log already exists for reporting; this makes it visible to the people
// feeding it rather than only to whoever reads the Sheet.
// ------------------------------------------------------------

function getUsageStats() {
  try {
    const sheet = SpreadsheetApp.openById(LOG_SHEET_ID).getSheetByName(LOG_TAB);
    if (!sheet || sheet.getLastRow() < 2) {
      return { ok: true, you: 0, team: 0, youTransactions: 0, teamTransactions: 0 };
    }
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, LOG_COLUMNS.length).getValues();
    const me = currentUserEmail_();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let you = 0, team = 0, youTx = 0, teamTx = 0;
    rows.forEach(function (r) {
      const when = r[0] instanceof Date ? r[0] : new Date(r[0]);
      if (!(when >= monthStart)) return;
      if (String(r[2]) !== 'conversion') return;      // not feedback or self-tests
      const tx = parseInt(r[5], 10) || 0;
      team++; teamTx += tx;
      if (String(r[1]) === me) { you++; youTx += tx; }
    });
    return { ok: true, you: you, team: team, youTransactions: youTx, teamTransactions: teamTx };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ------------------------------------------------------------
// AI extraction (Gemini) — for statements the parsers can't read.
// The key lives in Script Properties, never in the page.
// ------------------------------------------------------------

function setGeminiApiKey() {
  const key = '';  // <-- paste the key, Run once, then clear this line and save
  if (!key) throw new Error('Paste the key into setGeminiApiKey first.');
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', key);
  Logger.log('Stored. Now clear the key from this function and save.');
}

// Prints the models this key can actually use. Copy one into GEMINI_MODEL.
function listGeminiModels() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('Run setGeminiApiKey first.');
  const res = UrlFetchApp.fetch(GEMINI_HOST + '/models', {
    headers: { 'x-goog-api-key': key }, muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('Failed (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 400));
    return;
  }
  JSON.parse(res.getContentText()).models
    .filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1; })
    .forEach(function (m) { Logger.log(m.name.replace('models/', '')); });
}

// Called from the page. Takes the text the browser already pulled out of the
// PDF — the PDF file itself never leaves the user's machine.
function extractTransactions(statementText) {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) return { ok: false, error: 'No API key configured yet.' };
  if (!statementText || statementText.length < 40) return { ok: false, error: 'Nothing to read.' };

  const MAX_CHARS = 60000;
  const truncated = statementText.length > MAX_CHARS;
  const text = truncated ? statementText.slice(0, MAX_CHARS) : statementText;

  const schema = {
    type: 'OBJECT',
    properties: {
      previousBalance: { type: 'NUMBER', nullable: true },
      newBalance: { type: 'NUMBER', nullable: true },
      transactions: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            date: { type: 'STRING' },
            vendor: { type: 'STRING' },
            description: { type: 'STRING' },
            amount: { type: 'NUMBER' }
          },
          required: ['date', 'vendor', 'description', 'amount']
        }
      }
    },
    required: ['transactions']
  };

  const prompt = [
    'This is the text extracted from a bank or credit card statement PDF.',
    'Return every transaction, plus the opening and closing balances if printed.',
    '',
    'Rules:',
    '- date: M/D/YYYY. Infer the year from the statement period if a row omits it.',
    '- vendor: the merchant or payee. description: any remaining detail such as city and state, else an empty string.',
    '- amount: NEGATIVE for money leaving the account (purchases, withdrawals, fees), POSITIVE for money arriving (deposits, payments, credits, refunds).',
    '- Issuers mark credits differently: a trailing minus, a leading minus, brackets, "CR", or a separate column that may be lost in this text. Work out the convention from the statement.',
    '- If a running balance column is present, use the direction it moves to decide each sign. That is more reliable than any marker.',
    '- Skip summary, subtotal and total lines. Real transactions only.',
    '- Copy amounts exactly as printed. Do not round, correct or invent figures.',
    truncated ? '- The statement was long and has been trimmed; return what is present.' : '',
    '',
    '--- STATEMENT TEXT ---',
    text
  ].filter(Boolean).join('\n');

  let res;
  try {
    res = UrlFetchApp.fetch(GEMINI_HOST + '/models/' + GEMINI_MODEL + ':generateContent', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': key },
      payload: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: schema
        }
      }),
      muteHttpExceptions: true
    });
  } catch (err) {
    return { ok: false, error: 'Could not reach the AI service: ' + err.message };
  }

  if (res.getResponseCode() !== 200) {
    Logger.log('Gemini ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 600));
    return { ok: false, error: 'The AI service returned an error (' + res.getResponseCode() +
                              '). Check the Apps Script logs — often a wrong GEMINI_MODEL.' };
  }

  let data;
  try {
    const body = JSON.parse(res.getContentText());
    const part = body.candidates && body.candidates[0] &&
                 body.candidates[0].content && body.candidates[0].content.parts &&
                 body.candidates[0].content.parts[0];
    if (!part || !part.text) return { ok: false, error: 'The AI service returned nothing usable.' };
    data = JSON.parse(part.text);
  } catch (err) {
    return { ok: false, error: 'Could not read the AI response: ' + err.message };
  }

  return { ok: true, truncated: truncated, model: GEMINI_MODEL, data: data };
}

// ------------------------------------------------------------
// Run this after deploying. It checks all four pieces and says what's wrong.
// ------------------------------------------------------------

function testSetup() {
  const out = [];

  const email = currentUserEmail_();
  out.push(email ? 'OK  identity: ' + email
                 : 'FAIL identity is blank — set the deployment to "Execute as: User accessing the web app"');

  try {
    const page = doGet().getContent();
    out.push(/let SERVER_IDENTITY = \{[^}]*"email":"[^"]+"/.test(page)
      ? 'OK  page serves with the signed-in user stamped in'
      : 'FAIL the Index file is missing or is an out-of-date copy of index.html');
  } catch (err) { out.push('FAIL serving the page: ' + err.message); }

  const logged = logUsage({ eventType: 'selftest', status: 'setup_check',
                            message: 'testSetup — safe to delete this row' });
  out.push(logged.ok ? 'OK  logged a row to the Sheet'
                     : 'FAIL logging: ' + logged.error);

  if (!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY')) {
    out.push('FAIL no API key — run setGeminiApiKey');
  } else {
    const r = extractTransactions(
      'TEST BANK Previous Balance $1,000.00 New Balance $950.00\n' +
      '08/03 HARDWARE STORE BOISE ID 200.00\n' +
      '08/07 FUEL STOP NAMPA ID 50.00\n' +
      '08/19 ONLINE PAYMENT THANK YOU 300.00-\n');
    if (!r.ok) out.push('FAIL AI extraction: ' + r.error);
    else {
      const rows = (r.data.transactions || []);
      const sum = rows.reduce(function (s, t) { return s + t.amount; }, 0);
      out.push('OK  AI extraction returned ' + rows.length + ' rows, total ' + sum.toFixed(2) +
               (Math.abs(sum + 50) < 0.02 ? ' (correct)' : ' (expected -50.00 — check the model)'));
    }
  }

  Logger.log(out.join('\n'));
}
