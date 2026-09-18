# PDF to CSV Converter

A single self-contained web page that turns bank and credit-card statement PDFs
into CSV files. Parsing happens entirely in the browser — the PDF is never
uploaded anywhere.

**Use it here:** https://karenherring-hcp.github.io/pdf-to-csv-converter/

No account, install, or login needed. Any modern browser works.

## How to use

1. Open the link above.
2. Drag in one or more statement PDFs (or click to browse).
3. Review the extracted transactions on screen.
4. Download — one combined CSV, or a .zip with one CSV per statement.

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
- `AppsScript_Code.gs` — the Google Apps Script backend that receives usage and
  bug-report logs. Deployed as a Web App; its `/exec` URL is set in the
  `LOG_ENDPOINT` constant near the top of `index.html`'s `<script>` block.

External dependencies (pdf.js and JSZip) load from cdnjs at runtime; there's no
build step and nothing to install.
