# Maintenance — how to fix a bad parse or add a bank

Written for whoever picks this up next, human or AI. It assumes no memory of how
the project was built. Everything needed is in this repo.

## First: there is no model here

Nothing is trained and nothing is learned. Each bank has hand-written rules — a
function like `parseChaseStatement` in `app.html` that says, in effect, "a
transaction line looks like MM/DD, then a description, then a dollar amount."
Adding a bank means writing another one of those functions. That's the whole job.

## What a bug report gives you, and what it doesn't

The "Report a bug" button records the bank detected, the file name, the
transaction count, the user's note and their email — enough to know *that*
something is wrong, rarely enough to know *why*.

**The one thing you need is the extracted text.** Every result card has a **Raw
text** button that downloads exactly what the PDF reader pulled out of that file.
Ask the reporter for it. Without it you are guessing; with it the fix is usually
quick.

That text may contain client names, account numbers and amounts. Ask them to
redact identifying details but to **leave dates and amounts intact** — the
Woodforest and Navy Federal parsers work out whether a row is a charge or a
credit by checking whether the running balance went up or down, so altered
numbers make the logic impossible to verify.

## How the parsing works

1. `extractPageText()` turns each PDF page into text, inserting line breaks and
   spaces based on the coordinates of each text fragment. PDFs have no real
   concept of lines or spaces, so this is reconstruction, and it's where most
   weirdness originates.
2. `detectIssuer()` matches the text against letterhead phrases to pick a bank.
   It deliberately looks for product names like `Pro Xtra Credit Card`, not bare
   bank names — a Chase checking statement can list "American Express" as an ACH
   counterparty without being an Amex statement.
3. `parseStatement()` dispatches to that bank's function, or falls through to
   `parseGenericStatement()`.

## Adding a bank

1. Get a raw-text sample (above). Read it. Find the transaction rows.
2. Add a letterhead pattern to `detectIssuer()`. Pick something that appears on
   every statement from that bank and nowhere else.
3. Write `parseXxxStatement(clean)`, modelled on the closest existing one, and
   register it in `parseStatement()`.
4. Return the same object shape as the others. Leave fields blank rather than
   guessing — a blank cell is obvious, a wrong one isn't.
5. Add the bank to the footer text and the README list.

### The recurring trap: which rows are credits

For an unrecognised bank this is now handled generically:
`chooseSignConvention` applies each known convention in turn and keeps whichever
one reconciles. So a new bank often needs no sign logic written at all — check
whether the generic parser already lands on `Balances` before writing one.

The per-bank conventions below still matter for the dedicated parsers, and for
understanding why a statement won't balance.

Most of the work is sign, not extraction. Issuers disagree on how they mark a
credit, and the useful marker often doesn't survive PDF extraction:

- **Home Depot** — trailing `-` after the amount.
- **Amex / Amazon Business** — leading `-$`.
- **Chase** — *nothing per row.* The sign comes from which section a row is in.
  The parser reads the section counts out of the summary box and uses them as
  boundaries in one ordered pass.
- **Truist** — section headers stay in document order, so the text is sliced by
  section.
- **Woodforest, Navy Federal** — no marker at all. Sign is derived by tracking
  the running balance: if it went up by the transaction amount it's a credit.
- **U.S. Bank** — the `CR` marker doesn't stay next to its amount in extracted
  text, so credits are detected by keywords (`payment`, `credit`, `refund`).
  **This is the weakest parser in the codebase.** An unusually-worded credit will
  come out with the wrong sign. If you get a US Bank bug report, start here.

Before assuming a per-row marker exists, check the raw text for it.

### Verifying

This is now automatic. `reconcile()` runs on every statement, whatever the bank,
and checks the one identity every statement obeys:

    previous balance + everything that happened = new balance

It reads both balances with generic vocabulary (`extractStatedTotals`), sums the
parsed rows, and compares. The result shows on the result card and is recorded
in the log as `success`, `success_unverified` or `does_not_balance`, so a parser
that quietly breaks surfaces in the weekly report rather than downstream in
someone's books.

A near-exact mirror image is reported as reversed signs specifically, because
that's the most common failure and the least obvious.

When adding a parser, get it to `Balances` on a real statement. That's a much
stronger signal than eyeballing the table.

Test the neighbours too — a change to the shared helpers (`splitVendorDescription`,
`fixGluedPhrases`, `resolveTransactionYear`) affects every bank.

## Unrecognised banks

Anything unknown falls through to `parseGenericStatement()`, and the result card
shows a warning telling the user to check the output before importing. That
warning is the main safety net against a wrong-but-plausible parse, so keep it
if you touch `renderResults()`.

## Shipping a fix

Edit `app.html`, commit, push to `main`. GitHub Pages redeploys in about a
minute; users get it on next load. There is no build step and nothing to install.

Verify against the live URL rather than a local file — opening `app.html` from
disk behaves differently from being served.


## Logging

Logging goes through `logUsage` in `AppsScript_WebApp.gs`, which appends to the
usage-log Sheet as the script owner and returns a real result, so a failure is
visible rather than silent.

An earlier version posted to a Google Form instead. That existed only because
the tool once served people with no Google account, and it carried a real bug: a
browser hides the response to a cross-site form post, so a broken endpoint was
indistinguishable from a working one and users were told their report had been
sent when nothing was recorded. It is retired — the code is in git history, and
nothing posts to that form any more. Don't reintroduce it.
