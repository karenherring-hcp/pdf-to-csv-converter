# What generalises across bank statements

Notes from profiling 22 real statements (Wells Fargo checking and card, Capital
One, Capital One Spark, American Express, Discover, and three unlabelled) against
the tool. Written so the next person — or the next AI session — starts from
evidence instead of re-deriving it.

## The one universal law

    previous balance + everything that happened = new balance

True for checking, savings and credit cards. Nearly every statement prints both
balances. This is the single most valuable thing in this document, because it
lets the tool check its own work on a bank nobody has ever configured. It is
already implemented (`reconcile()` in app.html).

Use it to *verify*, and to *choose between interpretations* — not just to report.

## Structure

**A transaction record starts at a dated line and runs to the next dated line.**
This is the key structural insight. Statements that print one row per line are
just the one-line case of it, so the same logic reads both:

- Wells Fargo: `1/2  Purchase authorized on 01/02 ...  16.10  8,881.06`
- American Express: three lines — date + description, then a reference number on
  its own line, then the amount on its own line.

Parsing line-by-line matters. The original generic parser collapsed the whole
document into one string first, which destroyed exactly the signal that makes
this work — it found 0–1 rows on nearly every statement above.

**Amounts appear at the END of the record**, in one of these shapes:

    1,234.56    $1,234.56    -$1,234.56    - $1,234.56
    1,234.56-   ($1,234.56)  +$1,234.56    1,234.56 CR

**Two trailing amounts means the second is usually a running balance**
(Wells Fargo, Woodforest, Navy Federal). Confirm it rather than assume: a real
balance column moves by exactly the transaction amount each row.

## Dates

Four forms cover everything seen:

| Form | Example | Seen on |
|---|---|---|
| `M/D` | `1/2` | Wells Fargo |
| `MM/DD/YY` | `01/02/25` | American Express |
| `Mon D` | `Jan 2` | Discover |
| `Mon D Mon D` | `Jan 2 Jan 3` | Capital One (transaction date then posting date) |

Where two dates are printed, the **first** is the transaction date. A year is
often absent and must be inferred from the statement period — and December rows
on a January statement belong to the previous year.

## Sign: the hard part

This is where nearly all the difficulty lives. Issuers disagree, and the marker
frequently doesn't survive PDF extraction. Ranked by reliability:

1. **A running-balance column** — if the balance moves by the amount, the
   direction *is* the sign. Exact, no guessing. Best signal available.
2. **An explicit marker** on the row: trailing `-`, leading `-$`, parentheses,
   `CR`. Trustworthy when present.
3. **Section membership** — "Deposits and Additions" vs "Electronic
   Withdrawals". Reliable when section headers survive in document order
   (Truist); not when they don't (Chase, which needs the summary-box counts).
4. **Description keywords** — payment, credit, refund, deposit, reversal.
   A last resort. This is the U.S. Bank parser's weakness.

**The general method:** try each convention, keep whichever one reconciles. That
turns an unanswerable question into an arithmetic one, and means a lost minus
sign is recoverable rather than fatal.

## Traps found in real files

- **Daily balance summaries** list date + balance and look exactly like
  transactions. They inflate totals badly — a closing balance of $55,620 was
  being filed as a purchase. Decide once per document whether amounts sit on the
  dated line; don't let a row reach forward for one.
- **Dated lines are everywhere** — disclosures, rate tables, "as of" notes,
  marketing footers. Real transactions cluster together; strays don't.
- **A bank is not a format.** The Chase parser was built for business checking;
  a Chase *credit card* statement still says "JPMorgan Chase Bank", so it routes
  to the wrong parser and shows no warning. The Amex parser matches Amazon
  Business Prime; ordinary Amex statements don't match it at all.
- **Summary boxes split into two columns** — all the labels, then all the
  figures, as separate lines. Position is lost in extraction, so labels can't be
  paired with values by proximity.
- **Not every PDF is a statement.** A year-to-date summary or an account-activity
  export has no balances and shouldn't be treated as one.

## Where the general reader currently stands

A record-based reader (in the scratchpad, not shipped) reconciles exactly on 5 of
22 and finds plausible rows on most of the rest, against 0–1 rows for the shipped
generic parser. The remaining failures are concentrated in:

- **Busy Wells Fargo checking** — deposits and withdrawals are separate columns
  that collapse together in extraction, and too few rows carry a balance for the
  balance method to engage. Needs the balance deltas used as checkpoints across
  groups of rows rather than row by row.
- **Discover** — the transaction table isn't being located at all yet.
- **Capital One** — rows parse, signs don't reconcile; drift is small and
  consistent, suggesting one systematic rule is missing rather than many.
