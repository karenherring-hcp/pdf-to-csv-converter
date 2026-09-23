// ============================================================
// PDF to CSV Converter — Apps Script hosting wrapper
// ============================================================
// Serves the same index.html as the public site, but because the visitor is
// signed in with their Google account, it can stamp their real identity into
// the page before sending it. No name to type, nothing to fake.
//
// The tool still does all its work in the visitor's browser. This only serves
// the page — statements are never uploaded here either.
//
// ------------------------------------------------------------
// SETUP (one time):
// 1. Create a NEW Apps Script project (script.new). Keep it separate from the
//    logging project on the Sheet — different job, different deployment.
// 2. Add this file's contents as Code.gs.
// 3. Add an HTML file named exactly  Index  (File > + > HTML), and paste the
//    entire contents of index.html into it.
// 4. Deploy > New deployment > type: Web app
//      Execute as:      User accessing the web app
//      Who has access:  Anyone within Housecall Pro
//    Deploy, authorize, and share the /exec URL with the team.
//
// WHY "Execute as: User accessing the web app":
// That's what makes Session.getActiveUser() reliably return the visitor rather
// than the owner. It also means the code only ever runs with the visitor's own
// permissions, which is the safer default — this page needs no access to
// anything of yours. Logging still works because the page submits to the
// Google Form, which accepts submissions from anyone; nobody needs access to
// the log Sheet itself.
//
// KEEPING IT IN SYNC:
// index.html in the repo stays the single source of truth. After changing it,
// re-paste it into the Index file here (or `clasp push` if this project is
// linked). Don't edit the copy here by hand — the two will drift and the bug
// you're chasing will only exist in one of them.
// ============================================================

function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  let page = template.getRawContent();

  let email = '';
  try {
    email = Session.getActiveUser().getEmail() || '';
  } catch (err) {
    // Shouldn't happen with "Execute as: User accessing", but an unidentified
    // visitor should still get a working tool — it just falls back to asking.
    email = '';
  }

  page = page.replace(
    /let SERVER_IDENTITY = \{[^}]*\}; \/\*SERVER_IDENTITY\*\//,
    'let SERVER_IDENTITY = ' + JSON.stringify({ name: nameFromEmail_(email), email: email }) + '; /*SERVER_IDENTITY*/'
  );

  return HtmlService.createHtmlOutput(page)
    .setTitle('PDF to CSV Converter')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// "karen.herring@housecallpro.com" -> "Karen Herring". Only for display; the
// email is what's actually recorded and what a report should group by.
function nameFromEmail_(email) {
  if (!email) return '';
  return email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(String)
    .map(function (part) { return part.charAt(0).toUpperCase() + part.slice(1); })
    .join(' ');
}

// ============================================================
// AI extraction — the fallback for statements no parser handles
// ============================================================
// The hand-written parsers are exact, instant, free, and give the same answer
// every time, so they stay in front for the banks they cover. This handles the
// rest: an unrecognised bank, or a recognised one whose output doesn't
// reconcile.
//
// It lives here rather than in the page because an API key cannot go in a
// web page — anything in the page is readable by anyone who opens it. Apps
// Script holds the key server-side and the page never sees it.
//
// IMPORTANT — this is the one path where statement text leaves the browser.
// It is deliberately opt-in per statement (the user clicks a button), so the
// tool's default promise that nothing is uploaded still holds.
//
// SETUP: run setClaudeApiKey() once from the editor after pasting the key into
// it, then DELETE the key from the function body and save. The key is stored in
// Script Properties, which is not visible to people using the web app.
// ============================================================

const CLAUDE_MODEL = 'claude-opus-5';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

function setClaudeApiKey() {
  const key = '';  // <-- paste the key, Run once, then clear this line and save
  if (!key) throw new Error('Paste the API key into setClaudeApiKey first.');
  PropertiesService.getScriptProperties().setProperty('CLAUDE_API_KEY', key);
  Logger.log('Stored. Now clear the key from this function and save the file.');
}

function hasClaudeApiKey() {
  return !!PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
}

// Called from the page via google.script.run. Takes the text already extracted
// from the PDF in the browser — the PDF itself never leaves the user's machine.
function extractTransactionsWithAI(statementText) {
  const key = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!key) return { ok: false, error: 'No API key configured. Run setClaudeApiKey once.' };
  if (!statementText || statementText.length < 40) return { ok: false, error: 'Nothing to read.' };

  // Apps Script's UrlFetchApp has no streaming and a request ceiling around a
  // minute, so keep the work bounded: low effort is right for mechanical
  // extraction, and a very long statement is trimmed rather than timing out.
  const MAX_CHARS = 60000;
  const text = statementText.length > MAX_CHARS ? statementText.slice(0, MAX_CHARS) : statementText;
  const truncated = statementText.length > MAX_CHARS;

  const tool = {
    name: 'record_transactions',
    description: 'Record every transaction found on the statement.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        previousBalance: { type: ['number', 'null'], description: 'Opening balance printed on the statement, or null.' },
        newBalance: { type: ['number', 'null'], description: 'Closing balance printed on the statement, or null.' },
        transactions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              date: { type: 'string', description: 'M/D/YYYY. Infer the year from the statement period.' },
              vendor: { type: 'string', description: 'Merchant or payee.' },
              description: { type: 'string', description: 'Remaining detail, e.g. city and state. Empty string if none.' },
              amount: { type: 'number', description: 'Negative for money leaving the account (charges, withdrawals, fees); positive for money arriving (deposits, payments, credits, refunds).' }
            },
            required: ['date', 'vendor', 'description', 'amount']
          }
        }
      },
      required: ['previousBalance', 'newBalance', 'transactions']
    }
  };

  const prompt = [
    'Below is the text extracted from a bank or credit card statement PDF.',
    'Record every transaction, and the opening and closing balances if printed.',
    '',
    'Rules:',
    '- Sign convention: money leaving the account is negative, money arriving is positive.',
    '- Issuers mark credits differently (a trailing minus, a leading minus, brackets, "CR", or a separate column that may be lost in extraction). Work out the convention from the statement itself.',
    '- If a running balance column is present, use the direction it moves to decide each sign. That is more reliable than any marker.',
    '- Skip summary and total lines. Only real transactions.',
    '- Do not invent, round, or correct figures. Copy the amounts exactly as printed.',
    '- If a year is not printed on a row, infer it from the statement period.',
    truncated ? '- NOTE: the statement was long and has been truncated; record what is present.' : '',
    '',
    '--- STATEMENT TEXT ---',
    text
  ].filter(Boolean).join('\n');

  const payload = {
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'low' },
    fallbacks: [{ model: 'claude-opus-4-8' }],
    tools: [tool],
    tool_choice: { type: 'tool', name: 'record_transactions' },
    messages: [{ role: 'user', content: prompt }]
  };

  let response;
  try {
    response = UrlFetchApp.fetch(CLAUDE_API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-06-01'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) {
    return { ok: false, error: 'Could not reach the API: ' + err.message };
  }

  const code = response.getResponseCode();
  if (code !== 200) {
    Logger.log('Claude API ' + code + ': ' + response.getContentText().slice(0, 500));
    return { ok: false, error: 'The extraction service returned an error (' + code + '). Check the Apps Script logs.' };
  }

  let body;
  try { body = JSON.parse(response.getContentText()); }
  catch (err) { return { ok: false, error: 'Unreadable response from the extraction service.' }; }

  // A policy decline comes back as HTTP 200 — check before reading content.
  if (body.stop_reason === 'refusal') {
    return { ok: false, error: 'The extraction service declined this document.' };
  }

  const block = (body.content || []).filter(function (b) { return b.type === 'tool_use'; })[0];
  if (!block || !block.input) return { ok: false, error: 'No transactions came back.' };

  return {
    ok: true,
    truncated: truncated,
    model: body.model || CLAUDE_MODEL,
    usage: body.usage || null,
    data: block.input
  };
}

// Run this once after deploying, to confirm the substitution actually happened.
// It should log an identity line containing your own email address.
function testIdentityInjection() {
  const page = doGet().getContent();
  const match = page.match(/let SERVER_IDENTITY = \{[^}]*\}/);
  if (!match) {
    Logger.log('FAILED: the SERVER_IDENTITY line was not found in Index.');
    Logger.log('The Index file is probably an out-of-date copy of index.html.');
    return;
  }
  Logger.log(match[0]);
  if (match[0].indexOf('"email":""') !== -1) {
    Logger.log('WARNING: email came back empty. Check the deployment is set to');
    Logger.log('"Execute as: User accessing the web app".');
  } else {
    Logger.log('OK — visitors will be identified automatically.');
  }
}
