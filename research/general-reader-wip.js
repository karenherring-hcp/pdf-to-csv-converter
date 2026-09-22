// Candidate general statement reader — iterate here against the corpus, then
// port into index.html once it beats the current one.
//
// The organising idea: a transaction RECORD begins at a dated line and runs
// until the next dated line. Statements that print one row per line are just
// the one-line case, so the same code reads Wells Fargo's single lines and
// Amex's three-line groups (date+description, reference, amount) without
// knowing anything about either bank.

const MONTHS = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12};

// Some layouts print two dates (transaction then posting); the first is the one
// that belongs in the CSV.
const DATE_FORMS = [
  { re: /^([A-Z][a-z]{2})\.?\s+(\d{1,2})\s+[A-Z][a-z]{2}\.?\s+\d{1,2}\s+/, kind: 'mon' },
  { re: /^([A-Z][a-z]{2})\.?\s+(\d{1,2})\s+/,                               kind: 'mon' },
  { re: /^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\s+\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\s+/, kind: 'num' },
  { re: /^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\s+/,                 kind: 'num' },
  { re: /^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/,                   kind: 'num' }
];

function matchDate(line){
  for (const form of DATE_FORMS){
    const m = line.match(form.re);
    if (!m) continue;
    let month, day, year = null;
    if (form.kind === 'mon'){
      month = MONTHS[m[1].toLowerCase()];
      day = parseInt(m[2], 10);
      if (!month) continue;
    } else {
      month = parseInt(m[1], 10);
      day = parseInt(m[2], 10);
      if (m[3]) { year = parseInt(m[3], 10); if (year < 100) year += 2000; }
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    return { month, day, year, rest: line.slice(m[0].length).trim() };
  }
  return null;
}

// 1,234.56 / $1,234.56 / -$1,234.56 / - $1,234.56 / 1,234.56- / ($1,234.56) /
// +$1,234.56 / 1,234.56 CR
const TRAILING_AMOUNT = /(?:^|\s)(\(|-|\+)?\s*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})\s*(\)|-|CR|DR)?\s*$/i;

function popTrailingAmount(text){
  const m = text.match(TRAILING_AMOUNT);
  if (!m) return null;
  const value = parseFloat(m[2].replace(/,/g, ''));
  if (isNaN(value)) return null;
  const lead = m[1] || '';
  const tail = (m[3] || '').toUpperCase();
  const negative = lead === '-' || lead === '(' || tail === '-' || tail === ')' || tail === 'CR';
  const positive = lead === '+' || tail === 'DR';
  return {
    value, negative,
    explicit: negative || positive,
    rest: text.slice(0, m.index).trim()
  };
}

const AMOUNT_ONLY = /^[-+(]?\s*\$?\s*\d{1,3}(?:,\d{3})*\.\d{2}\s*[)\-]?$/;

const SUMMARY_LINE = /\b(previous balance|new balance|total balance|current balance|beginning balance|ending balance|balance forward|minimum payment|credit limit|available credit|annual percentage|interest charge|total fees|total interest|account summary|year[- ]to[- ]date|days in billing|payment due|statement period|page \d+ of \d+|total deposits|total withdrawals|total credits|total charges|amount enclosed|please pay|customer service)\b/i;

// Reference numbers and tracking ids carry no meaning for a CSV and would
// otherwise be glued onto the description.
const REFERENCE_ONLY = /^[A-Z0-9]{8,30}$/;

function looksLikeDescription(text){
  return !!text && /[A-Za-z]{2}/.test(text);
}

function parseRecords(rawText, maxRecordLines = 6){
  const lines = rawText.split('\n').map(l => l.trim());

  const startIndexes = [];
  lines.forEach((line, i) => {
    if (!line || line.length > 300) return;
    if (SUMMARY_LINE.test(line)) return;
    if (matchDate(line)) startIndexes.push(i);
  });

  // Decide ONCE per document whether amounts live on the dated line or on a
  // following line. Deciding per row lets a statement that prints amounts
  // inline (Wells Fargo) reach forward into the daily-balance summary and pick
  // up a balance as if it were a transaction — which is how a $55,620 closing
  // balance ends up filed as a purchase.
  let inlineCount = 0;
  for (const i of startIndexes){
    const d = matchDate(lines[i]);
    if (d && popTrailingAmount(d.rest)) inlineCount++;
  }
  const amountsAreInline = startIndexes.length > 0 &&
                           inlineCount >= startIndexes.length * 0.6;

  const rows = [];
  for (let s = 0; s < startIndexes.length; s++){
    const start = startIndexes[s];
    const hardEnd = (s + 1 < startIndexes.length) ? startIndexes[s + 1] : lines.length;
    const end = Math.min(hardEnd, start + maxRecordLines);

    const dated = matchDate(lines[start]);
    let descriptionParts = [];
    let amountToken = null;
    let balanceToken = null;

    // Same-line amounts first. Two of them means the second is usually a
    // running balance — checked later by seeing whether it actually tracks.
    const first = popTrailingAmount(dated.rest);
    if (first){
      const second = popTrailingAmount(first.rest);
      amountToken = second ? second : first;
      balanceToken = second ? first : null;
      if (second ? second.rest : first.rest) descriptionParts.push(second ? second.rest : first.rest);
    } else {
      if (dated.rest) descriptionParts.push(dated.rest);
    }

    // Otherwise look through the rest of the record for the amount, treating
    // plain text as more of the description.
    for (let i = start + 1; !amountsAreInline && i < Math.min(end, start + 4) && !amountToken; i++){
      const line = lines[i];
      if (!line || SUMMARY_LINE.test(line)) continue;
      if (AMOUNT_ONLY.test(line)){
        amountToken = popTrailingAmount(line);
        continue;
      }
      const inline = popTrailingAmount(line);
      if (inline && inline.rest && !REFERENCE_ONLY.test(inline.rest)){
        amountToken = inline;
        descriptionParts.push(inline.rest);
        continue;
      }
      if (!REFERENCE_ONLY.test(line) && /[A-Za-z]{2}/.test(line)) descriptionParts.push(line);
    }

    if (!amountToken) continue;
    const description = descriptionParts.join(' ').replace(/\s+/g, ' ').trim();
    if (!looksLikeDescription(description)) continue;

    rows.push({
      line: start,
      month: dated.month, day: dated.day, year: dated.year,
      description,
      value: amountToken.value,
      negative: amountToken.negative,
      explicit: amountToken.explicit,
      balance: balanceToken ? balanceToken.value : null
    });
  }
  return keepTransactionTables(rows);
}

// Dated lines appear all over a statement — in disclosures, interest-rate
// tables, "as of" notes, marketing footers. Real transactions cluster: they sit
// close together in one or more tables. So keep runs of rows that are packed
// together and drop the strays, rather than trying to recognise every kind of
// line that isn't a transaction.
function keepTransactionTables(rows, maxGap = 12, minRun = 3){
  if (rows.length <= minRun) return rows;

  const runs = [];
  let current = [rows[0]];
  for (let i = 1; i < rows.length; i++){
    if (rows[i].line - rows[i - 1].line <= maxGap) current.push(rows[i]);
    else { runs.push(current); current = [rows[i]]; }
  }
  runs.push(current);

  const kept = runs.filter(run => run.length >= minRun);
  if (!kept.length) return rows;   // nothing clustered — better to over-report than drop everything
  return kept.reduce((all, run) => all.concat(run), []);
}

// If that trailing second amount really is a running balance, consecutive rows
// differ by exactly the transaction amount — which gives the sign outright, with
// no guessing and no per-bank knowledge.
function deriveSignsFromBalance(rows, openingBalance){
  const withBalance = rows.filter(r => r.balance !== null);
  if (withBalance.length < Math.max(3, rows.length * 0.6)) return null;

  let prev = openingBalance;
  let matched = 0;
  const signs = [];
  for (const row of rows){
    if (row.balance === null){ signs.push(null); continue; }
    if (prev === null){ prev = row.balance; signs.push(null); continue; }
    const up = Math.abs((prev + row.value) - row.balance) < 0.011;
    const down = Math.abs((prev - row.value) - row.balance) < 0.011;
    if (up && !down){ signs.push(false); matched++; }
    else if (down && !up){ signs.push(true); matched++; }
    else signs.push(null);
    prev = row.balance;
  }
  if (matched < withBalance.length * 0.7) return null;
  return signs;
}

module.exports = { parseRecords, deriveSignsFromBalance, matchDate, popTrailingAmount, MONTHS };
