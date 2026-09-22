const G=require('./general.js');

// Balance vocabulary, allowing the date some statements put between the label
// and the figure ("Beginning balance on 1/2 $8,881.06").
const MONEY='\\$?\\s*(-?\\d{1,3}(?:,\\d{3})*\\.\\d{2})';
const GAP='(?:\\s+on\\s+\\d{1,2}[\\/\\-]\\d{1,2}(?:[\\/\\-]\\d{2,4})?)?[^\\d$\\-]{0,12}';
function firstMatch(text,labels){
  for(const l of labels){
    const m=text.match(new RegExp(l+GAP+MONEY,'i'));
    if(m){const v=parseFloat(m[1].replace(/,/g,''));if(!isNaN(v))return v;}
  }
  return null;
}
function statedTotals(text){
  const flat=text.replace(/\s+/g,' ');
  return {
    previous:firstMatch(flat,['Previous\\s*Balance','Beginning\\s*Balance','Balance\\s*Forward','Opening\\s*Balance','Previous\\s*Statement\\s*Balance']),
    ending:firstMatch(flat,['New\\s*Balance','Ending\\s*Balance','Closing\\s*Balance','Statement\\s*Balance','Ending\\s*Daily\\s*Balance'])
  };
}
const CREDIT_WORDS=/\b(payment|credit|refund|reversal|rebate|deposit|transfer\s*in|returned|adjustment|interest\s*paid|cashback|redemption)\b/i;
function apply(rows,mode){
  return rows.map(r=>{
    let neg;
    if(mode==='as-marked')neg=r.negative;
    else if(mode==='flipped')neg=!r.negative;
    else if(mode==='keywords')neg=CREDIT_WORDS.test(r.description);
    else if(mode==='keywords-inverted')neg=!CREDIT_WORDS.test(r.description);
    else neg=true;
    return {...r,signed:(neg?-1:1)*r.value};
  });
}
function reconcile(signedRows,t){
  if(t.previous===null||t.ending===null)return{verdict:'unchecked'};
  const expected=t.ending-t.previous;
  const actual=signedRows.reduce((s,r)=>s+r.signed,0);
  const drift=Math.abs(expected-actual);
  const tol=Math.max(0.05,signedRows.length*0.011);
  return{verdict:drift<=tol?'ok':'off',drift,expected,actual};
}
function parse(text){
  const rows=G.parseRecords(text);
  const t=statedTotals(text);
  if(!rows.length)return{rows:[],totals:t,check:{verdict:'unchecked'},how:'none'};
  // 1. A running-balance column settles the sign outright.
  const derived=G.deriveSignsFromBalance(rows,t.previous);
  if(derived){
    const signed=rows.map((r,i)=>({...r,signed:(derived[i]===null?(CREDIT_WORDS.test(r.description)?-1:1):(derived[i]?-1:1))*r.value}));
    const c=reconcile(signed,t);
    if(c.verdict!=='off')return{rows:signed,totals:t,check:c,how:'running-balance'};
  }
  // 2. Otherwise try each convention and keep whichever reconciles.
  let best=null;
  for(const mode of ['as-marked','flipped','keywords','keywords-inverted','all-negative']){
    const signed=apply(rows,mode);
    const c=reconcile(signed,t);
    if(c.verdict==='ok')return{rows:signed,totals:t,check:c,how:mode};
    if(c.verdict==='unchecked')return{rows:apply(rows,'as-marked'),totals:t,check:c,how:'as-marked (unverified)'};
    if(!best||c.drift<best.check.drift)best={rows:signed,totals:t,check:c,how:mode};
  }
  return best;
}
module.exports={parse,statedTotals};
