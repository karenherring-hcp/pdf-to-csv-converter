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
