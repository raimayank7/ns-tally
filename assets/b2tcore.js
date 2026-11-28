/* NSB2T (byof3-bank2tally, 28 Nov 2026): a bank statement -> TallyPrime Receipt, Payment and Contra vouchers, with the ledger of every
   line remembered by the payee printed in the narration (next statement: the same payee is filled in by itself). Pure, no screen:
   tally.niveshsahayak.in's "Bank statement to Tally" box (b2tally.js) and Node tests (scripts/test_b2tally.js) use it.

   Nothing here reads a statement or writes XML itself:
   - the statement lines come from NSBank (bankcore.js: CSV / Excel rows, columns by heading; PDFs through NSBankPdf),
   - the payee of a narration and the remembered choices are NSBI's (bankimport.js: payee(), suggest() with rules, learn()),
   - the vouchers and masters XML are NSXlTally's (xltcore.js: build() checks every voucher, mastersXml() / vouchersXml()).
   This file only turns "statement line + chosen ledger" into the rows xltcore.js reads:
     money in  + party / income / other ledger  -> Receipt  (bank Dr, ledger Cr)
     money out + party / expense / other ledger -> Payment  (ledger Dr, bank Cr)
     cash deposited / withdrawn, or another bank account -> Contra
   A ledger's kind comes from its Tally group (from the dropped masters export or Excel ledger list, else the group the visitor picks,
   else a guess from the name). Designed & Developed by: Nivesh Sahayak (https://www.niveshsahayak.in/) */
(function (G) {
  'use strict';
  var req = typeof require !== 'undefined' ? require : null;
  var TP = G.NSTpl || (req ? req('./tplcore.js') : null);
  var X = G.NSXlTally || (req ? req('./xltcore.js') : null);
  var BI = G.NSBI || (req ? req('./bankimport.js') : null);
  function key(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); }
  function t(s) { return String(s == null ? '' : s).trim(); }
  function r2(n) { return Math.round((+n + Number.EPSILON) * 100) / 100; }

  /* ---------- a ledger list as an Excel / CSV sheet (Tally's "List of Accounts" exported to Excel, or typed): name + group ---------- */
  var LSET = { k: 'b2tled', name: 'Ledger list', w: 'Your Tally ledgers: name and group', cols: [
    { k: 'name', h: 'Ledger', need: 1, w: 'Ledger name as in Tally', ex: 'Garg Traders', a: ['ledger name', 'name', 'name of ledger', 'account', 'account name', 'particulars', 'ledger account', 'a/c name', 'accounts'] },
    { k: 'group', h: 'Group', w: 'Tally group (Sundry Debtors, Indirect Expenses...)', ex: 'Sundry Debtors', a: ['under', 'parent', 'group name', 'account group', 'ledger group', 'parent group', 'primary group'] }] };
  if (TP && TP.SETS && !TP.SETS.b2tled) TP.SETS.b2tled = LSET;
  /* rows of the sheet -> the same shape as NSXlTally.tallyMasters(): { ledgers: { key: { name, group, top } }, groups, company } */
  function ledgerSheet(rows) {
    var L = TP.pick('b2tled', rows || [], {});
    if (!L || L.missing.length) return null;
    var out = { ledgers: {}, items: {}, groups: [], company: '' }, seen = {};
    for (var r = L.row + 1; r < rows.length; r++) {
      var row = rows[r] || [], nm = t(row[L.map.name]), g = 'group' in L.map ? t(row[L.map.group]) : '';
      if (!nm || /^(grand total|total)$/i.test(nm)) continue;
      out.ledgers[key(nm)] = { name: nm, group: g, top: g };
      if (g && !seen[key(g)]) { seen[key(g)] = 1; out.groups.push(g); }
    }
    return Object.keys(out.ledgers).length ? out : null;
  }

  /* ---------- the kind of a ledger, from its Tally group ---------- */
  var EXPG = /^(indirect expenses|direct expenses|purchase accounts|misc\. expenses \(asset\))$/, INCG = /^(indirect incomes|direct incomes|sales accounts)$/;
  function kindOfGroup(g) {
    var k = key(g);
    if (!k) return '';
    if (k === 'sundry debtors' || k === 'sundry creditors') return 'party';
    if (k === 'cash-in-hand') return 'cash';
    if (k === 'bank accounts' || k === 'bank od a/c' || k === 'bank occ a/c') return 'bank';
    if (EXPG.test(k)) return 'exp';
    if (INCG.test(k)) return 'inc';
    if (k === 'suspense a/c') return 'susp';
    return 'other';
  }
  /* the group a new ledger gets when nobody chose one: from its name, else a customer (money in) or supplier (money out) */
  function guessGroup(name, dir) {
    if (key(name) === 'suspense a/c') return 'Suspense A/c';
    return (X && X.guessGroup(name, '')) || (dir === 'cr' ? 'Sundry Debtors' : 'Sundry Creditors');
  }
  /* led: { key: { name, group, top, k } } from the Tally masters (T) and the visitor's own picks (info: { key: { name, group } }) */
  function ledgers(T, info) {
    var o = {};
    Object.keys((T && T.ledgers) || {}).forEach(function (k) { var l = T.ledgers[k]; o[k] = { name: l.name, group: l.group || '', top: l.top || l.group || '', inTally: true }; });
    Object.keys(info || {}).forEach(function (k) { if (o[k]) return; var l = info[k]; o[k] = { name: l.name, group: l.group || '', top: l.group || '', inTally: !!l.exists }; });
    Object.keys(o).forEach(function (k) { o[k].k = kindOfGroup(o[k].top) || kindOfGroup(o[k].group) || ''; });
    return o;
  }
  function banksOf(led) { return Object.keys(led).filter(function (k) { return led[k].k === 'bank'; }).map(function (k) { return led[k].name; }); }
  function cashOf(led) { var c = Object.keys(led).filter(function (k) { return led[k].k === 'cash'; }).map(function (k) { return led[k].name; }); return c.indexOf('Cash') >= 0 ? 'Cash' : c[0] || 'Cash'; }

  /* ---------- what each line is, from the remembered choices and the names in the narration ----------
     o: { rules, led (ledgers()), hasT (a Tally ledger list was dropped), bank, cash, keys }
     -> one entry per line: { led: Tally ledger name or '', conf: 'rule' | 'keyword' | 'name' | 'hint' | 'guess' | '', why, payee } */
  function suggest(lines, o) {
    o = o || {};
    var led = o.led || {}, names = [], ledset = {};
    Object.keys(led).forEach(function (k) {
      var l = led[k]; if (k === key(o.bank)) return;
      names.push(l.name);
      if (l.k === 'exp') ledset['exp|' + k] = 1;
      if (l.k === 'inc') ledset['inc|' + k] = 1;
    });
    var ctx = { lines: lines, keys: o.keys, rules: o.rules || [], parties: names };
    if (o.hasT) {
      ctx.ledset = ledset;
      ctx.ledOf = function (n) { var l = led[key(n)]; if (!l || key(n) === key(o.bank)) return null; return { k: l.k === 'susp' ? 'other' : l.k || 'other', name: l.name, a: l.name, t: 'x', nm: l.name, bk: l.name }; };
    }
    var E = BI.suggest(ctx), NR = {};
    (o.rules || []).forEach(function (r) { if (/^n:/.test(r.pat)) NR[r.dir + r.pat] = r; });
    return E.map(function (e, i) {
      var nm = '';
      if (e.kind === 'in' || e.kind === 'out' || e.kind === 'exp' || e.kind === 'oinc') nm = e.name;
      else if (e.kind === 'contra') {
        var other = [e.from, e.to].filter(function (x) { return x && x !== 'cash' && x !== 'bank'; })[0];
        nm = other ? (e.name || other) : (o.cash || 'Cash');
      } else if (e.kind === 'jv') nm = (e.led && e.led.nm) || e.name;
      else if (e.kind === 'susp') nm = 'Suspense A/c';
      var nr = !nm && NR[(lines[i].cr ? 'cr' : 'dr') + 'n:' + norm(lines[i].desc)];
      if (nr) { nm = nr.k === 'cash' ? (o.cash || 'Cash') : nr.name; e = { conf: 'rule', why: 'w_rule', payee: e.payee }; }
      if (nm && key(nm) === key(o.bank)) nm = '';   /* never the statement's own bank */
      if (nm && led[key(nm)]) nm = led[key(nm)].name;   /* the Tally spelling */
      return { led: nm || '', conf: nm ? e.conf : '', why: nm ? e.why : '', payee: e.payee || '' };
    });
  }

  /* ---------- remembering a choice (NSBI rules: kept under the payee's letters, for money in and money out apart) ---------- */
  function entryFor(line, name, k, o) {
    var cr = !!line.cr;
    if (!name || k === 'susp' || key(name) === 'suspense a/c') return null;
    if (k === 'party') return { line: line, kind: cr ? 'in' : 'out', name: name };
    if (k === 'exp' || k === 'inc') return { line: line, kind: cr ? 'oinc' : 'exp', name: name };
    if (k === 'cash') return { line: line, kind: 'contra', from: cr ? 'cash' : 'bank' };
    if (k === 'bank') return { line: line, kind: 'contra', from: cr ? name : 'bank', to: cr ? 'bank' : name, name: name };
    return { line: line, kind: 'jv', name: name, led: { a: name, t: 'x', nm: name } };
  }
  /* a narration with no payee name in it (TRF TO OWN CC ACCOUNT, SMS CHARGES...): kept under its words without numbers ('n:' rules,
     which NSBI.suggest never matches, so they are looked up here and only fill a line nothing else filled) */
  function norm(desc) { return String(desc || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim(); }
  function learn(rules, items, o) {
    var E = [], N = [];
    (items || []).forEach(function (x) { var e = entryFor(x.line, x.name, x.k, o); if (!e) return; E.push(e); if (BI.payee(x.line.desc).core.length < 3 && norm(x.line.desc).length >= 6) N.push(x); });
    var out = E.length ? BI.learn(rules || [], E) : (rules || []).slice();
    N.forEach(function (x) {
      var pat = 'n:' + norm(x.line.desc), dir = x.line.cr ? 'cr' : 'dr', hit = out.filter(function (r) { return r.pat === pat && r.dir === dir; })[0];
      if (hit) { hit.name = x.name; hit.k = x.k; hit.n = (hit.n || 1) + 1; } else out.push({ pat: pat, name: x.name, k: x.k, dir: dir, n: 1 });
    });
    return out.slice(-800);
  }

  /* ---------- statement lines + chosen ledgers -> the rows NSXlTally.build reads ----------
     picks[i] = ledger name ('' = leave the line out); o: { bank, cash, kind(name, dir) -> 'party' | 'exp' | ..., file, narr: 'bank' | 'none' } */
  function toRows(lines, picks, o) {
    var rows = [];
    lines.forEach(function (l, i) {
      var nm = t(picks[i]); if (!nm) return;
      var cr = !!l.cr, a = r2(l.cr || l.dr); if (!a) return;
      var k = o.kind(nm, cr ? 'cr' : 'dr');
      var r = { _r: l.row || i + 1, _s: o.file || 'statement', date: l.date, no: '', cont: false, badType: false, amt: String(a), party: '', ledger: '', mode: o.bank,
        narr: o.narr === 'none' ? '' : t(l.desc) + (t(l.ref) && String(l.desc).indexOf(t(l.ref)) < 0 ? ' Ref ' + t(l.ref) : ''), _i: i };
      if (k === 'cash') { r.vt = 'Contra'; if (cr) { r.ledger = o.bank; r.mode = nm; } else { r.ledger = nm; r.mode = o.bank; } }
      else if (k === 'bank') { r.vt = 'Contra'; if (cr) { r.ledger = o.bank; r.mode = nm; } else { r.ledger = nm; r.mode = o.bank; } }
      else { r.vt = cr ? 'Receipt' : 'Payment'; if (k === 'party') r.party = nm; else r.ledger = nm; }
      rows.push(r);
    });
    return rows;
  }
  /* the financial year most of the dates fall in (2026 = 1 Apr 2026 to 31 Mar 2027) */
  function fyOf(lines) {
    var c = {}; lines.forEach(function (l) { if (l.date) { var y = +l.date.slice(0, 4) - (+l.date.slice(5, 7) < 4 ? 1 : 0); c[y] = (c[y] || 0) + 1; } });
    var best = ''; Object.keys(c).forEach(function (y) { if (!best || c[y] > c[best]) best = y; }); return best ? +best : '';
  }
  /* everything: R (NSXlTally.build result) + map (ledger key -> { to, group, exists }) for mastersXml / vouchersXml
     o: { bank, cash, led (ledgers()), info ({ key: { name, group, exists } }), fy ('' = no year check), file, narr } */
  function make(lines, picks, o) {
    var led = o.led || {};
    var kind = function (nm, dir) { var l = led[key(nm)]; if (key(nm) === key(o.cash)) return 'cash'; if (l && l.k) return l.k === 'susp' ? 'other' : l.k; return kindOfGroup(guessGroup(nm, dir)) || 'other'; };
    var rows = toRows(lines, picks, { bank: o.bank, cash: o.cash, kind: kind, file: o.file, narr: o.narr });
    var R = X.build(rows, { fy: o.fy, led: { cash: o.cash || 'Cash', bank: o.bank || 'Bank' } });
    var map = {};
    Object.keys(R.ledgers).forEach(function (k) {
      var l = R.ledgers[k], T = led[k], inf = (o.info || {})[k] || {};
      if (T && T.inTally) map[k] = { to: T.name, group: T.group, exists: true, fromTally: true };
      else map[k] = { to: l.name, group: inf.group || (k === key(o.bank) ? 'Bank Accounts' : k === key(o.cash) ? 'Cash-in-Hand' : l.group || guessGroup(l.name, '')), exists: !!inf.exists || (!o.hasT && k === 'cash' && !inf.group) };
    });
    var at = {}; rows.forEach(function (r) { at[r._s + '|' + r._r] = r._i; });
    R.vouchers.forEach(function (v) { v.line = at[v.sheet + '|' + v.r]; });
    return { R: R, map: map, rows: rows };
  }

  /* ---------- sample files (made up; clearly marked) ---------- */
  var SAMPLES = {
    'Sample bank statement (made up).csv': 'Sample Bank Ltd - Account statement (made up for the tool sample),,,,,,\nAccount No: XXXXXX1234,,,,,,\n,,,,,,\n' +
      'Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance\n' +
      '01-04-2026,01-04-2026,Opening Balance,,,,"1,00,000.00"\n' +
      '02-04-2026,02-04-2026,NEFT CR-HDFC0000123-SAMPLE GARG TRADERS-INV 101,N092600123456,,"11,800.00","1,11,800.00"\n' +
      '03-04-2026,03-04-2026,UPI/609312345678/Payment/samplemehta@okaxis/Sample Mehta and Sons,609312345678,,"4,410.00","1,16,210.00"\n' +
      '04-04-2026,04-04-2026,RTGS DR-SBIN0001234-SAMPLE DELHI STEELS PVT LTD,SBINR52026040412,"10,000.00",,"1,06,210.00"\n' +
      '05-04-2026,05-04-2026,ATW-416021XXXXXX1234-S1ANLD01-LUDHIANA,,"5,000.00",,"1,01,210.00"\n' +
      '06-04-2026,06-04-2026,CHQ PAID-000452-SAMPLE PROPERTIES,000452,"15,000.00",,"86,210.00"\n' +
      '07-04-2026,07-04-2026,SMS CHARGES FOR QTR ENDED 31-03-2026,,59.00,,"86,151.00"\n' +
      '08-04-2026,08-04-2026,BY CASH DEPOSIT,,,"20,000.00","1,06,151.00"\n' +
      '09-04-2026,09-04-2026,NEFT CR-ICIC0000456-SAMPLE GARG TRADERS-INV 104,N099600987654,,"9,440.00","1,15,591.00"\n' +
      '10-04-2026,10-04-2026,UPI/609998887776/electricity/pspcl@sbi/PSPCL,609998887776,"3,250.00",,"1,12,341.00"\n' +
      '11-04-2026,11-04-2026,TRF TO SAMPLE ICICI BANK CC ACCOUNT,,"25,000.00",,"87,341.00"\n' +
      '12-04-2026,12-04-2026,IMPS/P2A/610212345678/RAVI KUMAR/salary,610212345678,"12,000.00",,"75,341.00"\n' +
      '15-04-2026,15-04-2026,INT.PD:01-01-2026 TO 31-03-2026,,,412.00,"75,753.00"\n',
    'Sample Tally ledger list (made up).xml': '<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA><TALLYMESSAGE>' +
      '<LEDGER NAME="Sample HDFC Bank"><PARENT>Bank Accounts</PARENT></LEDGER>' +
      '<LEDGER NAME="Sample ICICI Bank CC"><PARENT>Bank OD A/c</PARENT></LEDGER>' +
      '<LEDGER NAME="Cash"><PARENT>Cash-in-Hand</PARENT></LEDGER>' +
      '<LEDGER NAME="Sample Garg Traders"><PARENT>Sundry Debtors</PARENT></LEDGER>' +
      '<LEDGER NAME="Sample Mehta and Sons"><PARENT>Sundry Debtors</PARENT></LEDGER>' +
      '<LEDGER NAME="Sample Delhi Steels Pvt Ltd"><PARENT>Sundry Creditors</PARENT></LEDGER>' +
      '<LEDGER NAME="Rent"><PARENT>Indirect Expenses</PARENT></LEDGER>' +
      '<LEDGER NAME="Bank Charges"><PARENT>Indirect Expenses</PARENT></LEDGER>' +
      '<LEDGER NAME="Electricity Charges"><PARENT>Indirect Expenses</PARENT></LEDGER>' +
      '<LEDGER NAME="Salary"><PARENT>Indirect Expenses</PARENT></LEDGER>' +
      '<LEDGER NAME="Interest Received"><PARENT>Indirect Incomes</PARENT></LEDGER>' +
      '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'
  };

  var API = { LSET: LSET, ledgerSheet: ledgerSheet, kindOfGroup: kindOfGroup, guessGroup: guessGroup, ledgers: ledgers, banksOf: banksOf, cashOf: cashOf,
    suggest: suggest, entryFor: entryFor, learn: learn, toRows: toRows, fyOf: fyOf, make: make, SAMPLES: SAMPLES };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else G.NSB2T = API;
})(typeof window !== 'undefined' ? window : this);
