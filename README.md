# PDF to CSV Converter

A single self-contained web page that turns bank and credit-card statement PDFs
into CSV files. Parsing happens entirely in the browser — the PDF is never
uploaded anywhere.

**Use it here:** https://karenherring-hcp.github.io/pdf-to-csv-converter/

No account, install, or login needed. Any modern browser works.

## How to use

1. Open the link above.
2. Drag in your statement PDFs, or click to browse. One file or fifteen — select
   them all at once, and each file's bank is detected on its own.
3. Review the extracted transactions on screen.
4. Download, choosing one of two shapes:
   - **One combined CSV** — every transaction from every statement in a single
     file. Usually what you want: it imports in one pass.
   - **Separate CSV per statement (.zip)** — one file per statement, named after
     the PDF it came from. Use this when each statement has to stay on its own.

   With a single statement loaded there's no choice to make; you just get a
   Download CSV button.

The CSV columns are `Date, Vendor, Description, Amount`. Credits and payments
come through as negative amounts.

## Supported statement formats

The bank is auto-detected per file; there's nothing to select.

- Home Depot Pro Xtra Credit Card
- Amazon Business Prime Card / American Express
- Chase business checking
- U.S. Bank Business Platinum Card
- Truist (consolidated checking + savings)
- Woodforest National Bank
- Navy Federal Credit Union
- Anything else falls through to a generic parser that works off document
  structure (date + description + amount) rather than bank-specific labels. It's
  a reasonable first attempt, not a guarantee.

If a field can't be found on a given statement, it's left blank rather than
guessed.

## Known limitations

- **U.S. Bank** — credits are identified by description keywords ("payment",
  "credit", "refund") because the "CR" marker isn't reliably positioned in the
  extracted text. An unusually-worded credit could come through with the wrong
  sign. Spot-check these.
- **Navy Federal** — descriptions and amounts are reconstructed from two
  separately-extracted blocks per page (a PDF quirk, not a choice). Validated
  against the statement's own totals, but the page where one account transitions
  to the next is structurally messier. Spot-check if totals look off.
- A brand-new bank format uses the generic parser. If the output looks wrong,
  send a sample statement so a dedicated parser can be built.

Every statement also has a **Raw text** button, which downloads exactly what was
extracted from the PDF — useful when reporting a parsing problem.

## Reporting bugs

Use the "Report a bug" button in the top-right of the app. Reports go to a usage
log and email an alert.

## Repository layout

- `index.html` — the entire app (HTML, CSS, JS inlined). This is the canonical
  copy; fixes and new bank formats get pushed here and go live on GitHub Pages
  automatically.
- `AppsScript_FormBackend.gs` — sets up the usage/bug-report log. Run
  `setUpLoggingForm()` once from the log Sheet's Apps Script project; it builds
  a Google Form, points its responses at that Sheet, registers an email alert
  trigger, and prints the two values to paste into `LOG_ENDPOINT` and
  `LOG_FIELD_MAP` in `index.html`.

### A note on logging

Logging is **off** unless both `LOG_ENDPOINT` and `LOG_FIELD_MAP` are filled in.
Leave them empty rather than guessing: when logging is on, the bug-report modal
tells the user their report was submitted, and it has no way to detect a failed
send (the response is opaque by design). A misconfigured endpoint therefore
means users are thanked for reports that were never recorded. Verify an
anonymous POST succeeds before enabling it.

The earlier approach — an Apps Script web app receiving JSON — is in git history
but doesn't work here. The housecallpro.com Workspace policy blocks sharing Apps
Script web apps outside the domain, so anonymous requests get redirected to a
Google sign-in page and fail with 401 no matter what the deployment's access
setting says. A Google Form's login requirement is controlled per-form by its
owner, which is why it works without admin involvement.

External dependencies (pdf.js and JSZip) load from cdnjs at runtime; there's no
build step and nothing to install.
