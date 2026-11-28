/* NSBI: bank statement import for NSBiz (gap-money, 2026-11-14). Pure functions, no screen; node scripts/test_bankimport.js.
   The statement is read by NSBank (bankcore.js: CSV or Excel, columns found by heading or chosen by hand). This file decides, for each line:
     - is it already in the books? (a line posted by an earlier import carries the same key `bsk`; a line that matches a saved receipt,
       payment, expense or contra of the same amount and direction within a few days is "in the books" and left out)
     - what is it? receipt from a party (settling an open bill when the amount is exactly one bill, else the oldest bills as always),
       payment to a party, an expense, other income, cash deposited or withdrawn, or nothing yet
     - by which rule? a rule the user taught before (the narration pattern -> party or head, kept in meta 'bankrules'), the party's name
       found in the narration, an open bill of exactly this amount, or a plain-words hint (bank charges, interest, ATM / cash)
   and builds the records the App's Money screens already make (receipt, voucher with forBill, exp, oinc, contra): books.js reads them
   like any other, so nothing new is stored but a `bsk` on each record, which also protects against posting the same statement twice. */
(function (G) {
  'use strict';
  function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function key(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function days(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }

  /* ---------- the narration ---------- */
  var STOP = {}; ('upi neft imps rtgs ach nach ecs chq cheque clg clearing by to from transfer trf tfr payment pay paid ref txn trxn mob mobile bank ltd pvt private limited and the ' +
    'inward outward credit debit upiint upiin ybl ibl axl apl okhdfcbank okaxis oksbi okicici paytm phonepe gpay googlepay phone sbi hdfc icici axis pnb bob ifsc utr tpt mmt int self acct account ' +
    'mobile banking transfer via cash dep deposit wdl withdrawal atm pos ecom towards sent received rec bill bil for with online mps ft fund funds hdfcn sbin icic utib barb punb kkbk').split(' ').forEach(function (w) { STOP[w] = 1; });
  function segments(desc) { return String(desc || '').split(/[\/|~]|\s-\s|-(?=[A-Za-z])/).map(function (s) { return s.trim(); }).filter(Boolean); }
  function words(seg) {
    return String(seg).toLowerCase().replace(/[0-9]+/g, ' ').split(/[^a-z]+/).filter(function (w) { return w.length >= 3 && !STOP[w]; });
  }
  /* all the meaningful words of a line (for finding a party's name in it) */
  function tokens(desc) { var o = {}, out = []; segments(desc).forEach(function (s) { words(s).forEach(function (w) { if (!o[w]) { o[w] = 1; out.push(w); } }); }); return out; }
  /* the pattern a rule is kept under: the first part of the narration that has a name in it, up to three words ('rajesh kumar', 'big bazaar') */
  function pattern(desc) {
    var s = segments(desc);
    for (var j = 0; j < s.length; j++) if (s[j].indexOf('@') > 0) { var v = words(s[j].split('@')[0]); if (v.length) return v.slice(0, 3).join(' '); }   /* a UPI address names the payee better than the remark */
    for (var i = 0; i < s.length; i++) { var w = words(s[i]); if (w.length) return w.slice(0, 3).join(' '); }
    return '';
  }
  function hasAll(toks, pat) { return !!pat && pat.split(' ').every(function (w) { return toks.indexOf(w) >= 0; }); }

  /* ---------- keys of lines (a line posted once is never posted again) ---------- */
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }
  /* two identical lines on a day (same amount, same text) are two lines: the occurrence number keeps them apart */
  function lineKeys(lines) {
    var seen = {};
    return lines.map(function (l) {
      var base = [l.date, l.dr, l.cr, key(l.ref), key(l.desc)].join('|'); seen[base] = (seen[base] || 0) + 1;
      return hash(base) + '.' + seen[base];
    });
  }

  /* ---------- the payee: the name a bank prints in the narration (25 Nov 2026, after a real ICICI statement) ----------
     Banks write the name between codes: RTGS/ICICR4202.../CIUB0000219/GARG TRADING COMPANY, NEFT-SBIN2261...-M S ASHOK KUMAR
     SONS-ATTNINBINVOICE-0000107...-SBIN0001550, CLG/SAECO STRIPS PRIVATE LT/062451/CBI/..., MMT/IMPS/6094.../salary/sonu/CIUB...,
     UPI/6138.../remark/shahafajil.sidd/Kotak Mahindra /KOT..., TRFR TO: LUDHIANA WIRES. The parts with numbers mixed in (references,
     IFSC codes, account numbers), the channel words and the bank names are dropped; of what is left, the longest part is the name.
     Before this the first word left over was taken, which was often a code (icicr, ciub): one choice then spread to unrelated lines. */
  var CHAN = {}; ('upi neft rtgs imps mmt inf inft clg trf trfr ach nach ecs bil onl ift ft chq cheque by to from ib int ft nft tpt mob mobile banking ' +
    'transfer transfered transferred inward outward fund funds bulk net online cms ref txn').split(' ').forEach(function (w) { CHAN[w] = 1; });
  var PURP = /^(salary|salaries|wages?|rent|advance|payment|pay|paid|upi pay|bill|bills|invoice|inv|fees?|emi|loan|refund|ac|a c|acct|account|self|na|n a|others?|misc|attninbinvoice|sent using.*|payment from.*|paid via.*|payment to.*|collect request.*|pay to.*|trf to.*|neft txn|imps txn)$/i;
  var BANKSEG = /\b(bank|bnk)\b|^(state bank|punjab national|kotak mahindra|axis|hdfc|icici|sbi|pnb|canara|union|indian|central|idbi|yes|indusind|federal|paytm payments|airtel payments|ptax|ybl|ibl|axl|okhdfcbank|okaxis|oksbi|okicici)\b/i;
  var SUFFIX = { pvt: 1, private: 1, ltd: 1, limited: 1, llp: 1, co: 1, company: 1, corp: 1, corporation: 1, inc: 1, the: 1, and: 1, m: 1, s: 1, ms: 1, mrs: 1, mr: 1, sh: 1, shri: 1, smt: 1, lt: 1, pv: 1 };
  /* letters only, without the words every firm name carries: 'M/S Sharu Industries Pvt. Ltd.' -> 'sharuindustries' */
  function core(name) {
    var w = String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/\([^)]*\)/g, ' ').replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean);
    var k = w.filter(function (x) { return !SUFFIX[x]; }); if (!k.length) k = w;
    var c = k.join('');
    /* a name the bank printed as one word keeps its tail on: SHARUINDUSTRIESPRIVATELIMITED */
    return c.replace(/(privatelimited|pvtltd|private|limited|pvt|ltd|llp|company|co)$/, '') || c;
  }
  function title(s) { return String(s || '').toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }).replace(/\s+/g, ' ').trim(); }
  function isCode(seg) {
    var t = seg.replace(/\s+/g, ''), dg = (t.match(/\d/g) || []).length, lt = (t.match(/[a-z]/gi) || []).length;
    if (!lt) return true;
    if (/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(t)) return true;   /* IFSC */
    return dg >= 3 && dg * 2 >= lt;
  }
  function cleanSeg(seg) {
    var x = String(seg).replace(/\b\w*X{4,}\w*\b/g, ' ').replace(/@.*$/, '').replace(/[._]+/g, ' ').replace(/[^A-Za-z&' ]+/g, ' ').replace(/\s+/g, ' ').trim();
    x = x.replace(/^(m\s*\/?\s*s|ms|messrs|trfr to|trf to|by|to)\s+/i, '').trim();
    x = x.replace(/^(ach\s+[dc]\s+|(pos|tp|ach|wdl|tfr|dep|inb|nach|ecs|upi|imps|neft|rtgs|micr|cts)\s+)+/i, '').replace(/\s+pos(\s+debit)?$|\s+debit$/i, '').trim();
    return x.replace(/\s+[A-Za-z]$/, '');   /* a name the bank cut off: 'CHINTPURNI CHARAN I' */
  }
  function candidates(desc) {
    var d = String(desc || ''), out = [], purpose = '';
    var segs = d.split(/[\/|~:;*\[\]]|\s+-\s*|-(?=\S)/);
    /* where some banks always print the other side's name (HDFC UPI-NAME-vpa@bank-..., SBI UPI/DR/ref/NAME/..., card POS 4160XXXX NAME) */
    [/^\s*UPI-([^-]+?)-[^-\s]*@/i, /UPI\/(?:DR|CR)\/\d+\/([^\/]+)/i, /^\s*POS\s+\S*X{3,}\S*\s+(.+?)\s*$/i].forEach(function (re) {
      var m = re.exec(d), c = m && cleanSeg(m[1]); if (c && c.replace(/[^a-z]/gi, '').length >= 3 && !PURP.test(c.toLowerCase())) out.push({ s: c, sc: 1000 });
    });
    var upi = /^\s*upi\b/i.test(d) && d.split('/').length >= 4;
    segs.forEach(function (seg, i) {
      seg = seg.trim(); if (!seg || isCode(seg)) return;
      var c = cleanSeg(seg), lw = c.toLowerCase();
      if (!c || c.replace(/[^a-z]/gi, '').length < 3) return;
      var ws = lw.split(' ').filter(function (w) { return w && !CHAN[w] && !STOP[w]; });
      if (!ws.length) return;
      if (PURP.test(lw)) { purpose = purpose || lw; return; }
      if (BANKSEG.test(lw) && ws.length <= 3) return;
      var sc = c.replace(/[^a-z]/gi, '').length;
      if (upi && i === 3) sc += 40;              /* UPI/ref/remark/address/bank/...: the address names the other side */
      if (upi && i === 2) sc -= 20;              /* the remark is often the payer's own note */
      out.push({ s: c, sc: sc });
    });
    out.sort(function (a, b) { return b.sc - a.sc; });
    return { names: out.map(function (o) { return o.s; }), purpose: purpose };
  }
  /* the payee of a line: { name: 'Garg Trading Company', core: 'gargtrading', purpose: 'salary' } (name '' when none) */
  function payee(desc) {
    var c = candidates(desc), n = c.names[0] || '', k = core(n);
    if (k.length < 3) { n = ''; k = ''; }
    return { name: n ? title(n) : '', core: k, purpose: c.purpose };
  }
  /* bulk transfer files (INF/INFT/<ref>/<batch>/<name>): lines of one batch are usually the same kind of payment (wages) */
  function batchOf(desc) { var m = String(desc || '').match(/^\s*INFT?\/[^\/]*\/[^\/]*\/\s*(\d{4,})\s*\//i); return m ? m[1] : ''; }
  /* edit distance, stopped early (for names spelt a little differently: LUDHIANA GASSES / Ludhiana Gases) */
  function near(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return false;
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i]; var low = i;
      for (j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (cur[j] < low) low = cur[j]; }
      if (low > max) return false; prev = cur;
    }
    return prev[b.length] <= max;
  }
  /* party index: find the saved party a payee is, by its letters (spaces, Pvt Ltd, M/S, a name the bank cut short, a letter or two off) */
  function partyIndex(names) {
    var list = (names || []).map(function (n) { return { n: n, c: core(n) }; }).filter(function (p) { return p.c.length >= 3; }), by = {};
    var first = {}, memo = {}, long8 = list.filter(function (p) { return p.c.length >= 8; });
    list.forEach(function (p) { (by[p.c] = by[p.c] || []).push(p); (first[p.c[0]] = first[p.c[0]] || []).push(p); });
    function find(pc, flat) {
      if (!pc) return null;
      if (memo.hasOwnProperty(pc)) return memo[pc] || (flat ? scan(flat) : null);
      var f = find0(pc); memo[pc] = f;
      return f || (flat ? scan(flat) : null);
    }
    function scan(flat) { var h = long8.filter(function (p) { return flat.indexOf(p.c) >= 0; }); return pick(h); }   /* the name runs into other words */
    function pick(hits) {
      if (!hits.length) return null;
      var best = Math.max.apply(null, hits.map(function (p) { return p.c.length; })), top = hits.filter(function (p) { return p.c.length === best; });
      return top.length === 1 ? { p: top[0], how: 'like' } : null;
    }
    function find0(pc) {
      if (by[pc]) return by[pc].length === 1 ? { p: by[pc][0], how: 'exact' } : null;
      var same = first[pc[0]] || [];
      var hits = same.filter(function (p) {
        return (pc.length >= 8 && p.c.indexOf(pc) === 0) || (p.c.length >= 6 && pc.indexOf(p.c) === 0);   /* the bank cut the name short, or added words */
      });
      if (!hits.length && pc.length >= 6) hits = same.filter(function (p) { return p.c.length >= 6 && near(pc, p.c, pc.length >= 12 ? 2 : 1); });
      return pick(hits);
    }
    return { find: find, size: list.length };
  }
  function ruleHit(r, py, ptk) {
    if (/^p:/.test(r.pat)) { var rc = r.pat.slice(2); return !!py.core && (py.core === rc || (rc.length >= 8 && py.core.indexOf(rc) === 0) || (py.core.length >= 8 && rc.indexOf(py.core) === 0)); }
    return hasAll(ptk, r.pat);   /* rules saved before 25 Nov: their words must be in the payee's name, not in the codes around it */
  }

  /* ---------- plain-words hints (checked before names: 'LONG GER INDUSTRY CO LTDCHARGE' is a charge, not a payment to the party) ---------- */
  var HINT = [
    ['cr', /\b(cash\s*(dep|deposit)|cdm|by\s*cash)\b|cash dep/i, { kind: 'contra', from: 'cash' }, 'h_cashdep'],
    ['cr', /\b(int(erest)?\.?\s*(credit|paid|pd|cr|on)|credit\s*interest|int\s*pd|savings?\s*interest|fd\s*interest)\b/i, { kind: 'oinc', name: 'Interest received' }, 'h_int'],
    ['cr', /^\s*rev(ersal)?\b.*\b(atw|nwd|eaw|atm)\b/i, { kind: 'contra', from: 'cash' }, 'h_atmrev'],
    ['dr', /^\s*(atw|nwd|eaw)-|\b(atm\s*(wdl|withdrawal|cash)|cash\s*(wdl|withdrawal|paid)|self\s*(chq|cheque)|chq\s*self|to\s*self|nfs\s*cash)\b|cash paid/i, { kind: 'contra', from: 'bank' }, 'h_cashwd'],
    ['dr', /\bint\.?\s*coll\b|\binterest\s*(debit|charged|collected|on\s*(od|cc|loan))|\b(od|cc)\s*int(erest)?\b|\bint\.?\s*(dr|debit)\b/i, { kind: 'exp', name: 'Interest on loans' }, 'h_intpaid'],
    ['dr', /\b(sms\s*(chg|charge)s?|chrg|chgs?|gst\s*(on|@)|annual\s*maint|amc\s*chg|debit\s*card\s*(fee|annual)|min(imum)?\s*bal|processing\s*fee|cheque\s*book|chq\s*book|penal|commission|annual\s*fee|amc)\b|(?<!re)charges?\b|charge$|chg\b/i, { kind: 'exp', name: 'Bank charges' }, 'h_chg']
  ];

  /* ---------- suggest what each line is ----------
     ctx: { lines, parties: [names], bills: [{ id, no, date, party, side: 'recv'|'pay', left }] (open bills of NSBooks.bills),
            rules: [{ pat, kind: 'party'|'head'|'cash', name, dir: 'cr'|'dr', n }], done: { key: 1 } (bsk of records already in the books),
            book: [NSBank bookLines] for "already in the books", days (default 5) }
     returns one entry per line: { i, key, status: 'done' | 'inbooks' | 'new', kind: '' | 'in' | 'out' | 'exp' | 'oinc' | 'contra',
       name, billId, from (contra), why (key of the reason), conf: 'rule' | 'name' | 'bill' | 'hint' | 'guess' | '', payee, batch }
     'guess' = the payee's name as printed, not a saved party yet: shown for the user to confirm, never ticked by itself.
     Speed: the books are looked up by amount (one pass), parties by their letters, so 2,000 lines take a few milliseconds. */
  /* a keyword is compared by its letters and digits only (spaces, dots and case ignored), so 'Garg Trading' finds 'GARG-TRADING/CO' */
  function kwNorm(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function suggest(ctx) {
    var L = ctx.lines, keys = ctx.keys || lineKeys(L), tol = ctx.days == null ? 5 : ctx.days, rules = ctx.rules || [], used = {};
    /* lines already in the books through a saved record of the same amount and direction (and not through this import) */
    var bookUsed = {}, byAmt = {};
    (ctx.book || []).forEach(function (b) {
      if (b.d && b.d.bsk) return;
      if (b.inn) (byAmt['cr' + Math.round(b.inn * 100)] = byAmt['cr' + Math.round(b.inn * 100)] || []).push(b);
      if (b.out) (byAmt['dr' + Math.round(b.out * 100)] = byAmt['dr' + Math.round(b.out * 100)] || []).push(b);
    });
    function inBooks(l) {
      var list = byAmt[(l.cr ? 'cr' : 'dr') + Math.round((l.cr || l.dr) * 100)]; if (!list) return null;
      for (var j = 0; j < list.length; j++) { var b = list[j]; if (bookUsed[b.id]) continue; if (Math.abs(days(b.date, l.date)) <= tol) { bookUsed[b.id] = 1; return b; } }
      return null;
    }
    var PI = ctx.pindex || partyIndex(ctx.parties);
    /* open bills by side and amount */
    var billAmt = {};
    (ctx.bills || []).forEach(function (b) { var k = b.side + Math.round(b.left * 100); (billAmt[k] = billAmt[k] || []).push(b); });
    /* rules by direction and first letter of the payee (every payee rule needs the same first letter); rules by words are tried on every line.
       2,000 lines x 800 rules was 1.6 million tests; now a few hundred. */
    /* ledger keywords the user set (ctx.kw = [{ n: normalised word, L: ledger }], longest first) */
    var KW = (ctx.kw || []).slice().sort(function (a, b) { return b.n.length - a.n.length; });
    var RB = {}, RW = [];
    rules.forEach(function (r, ri) { var m = /^p:(.)/.exec(r.pat); if (m) { var bk = r.dir + m[1]; (RB[bk] = RB[bk] || []).push([r, ri]); } else RW.push([r, ri]); });
    /* ctx.only: work out these lines again and keep the others as they were (ctx.prev); used after a choice teaches the lines of the same payee */
    var only = null;
    if (ctx.only && ctx.prev) {
      only = {}; ctx.only.forEach(function (j) { only[j] = 1; });
      ctx.prev.forEach(function (p, j) { if (!only[j] && p && p.billId) used[p.billId] = 1; });
    }
    return L.map(function (l, i) {
      if (only && !only[i]) return ctx.prev[i];
      var e = { i: i, key: keys[i], status: 'new', kind: '', name: '', billId: '', why: '', conf: '' }, dir = l.cr ? 'cr' : 'dr', amt = l.cr || l.dr;
      if (ctx.done && ctx.done[keys[i]]) { e.status = 'done'; return e; }
      var text = l.desc + ' ' + l.ref, py = l._py || (l._py = payee(l.desc)), ptk = py.name ? tokens(py.name) : [];
      e.payee = py.name; e.batch = batchOf(l.desc);
      /* 0. a keyword of a ledger is in the narration: the longest keyword wins (like Tally's Suggested Keyword) */
      if (KW.length) {
        var flat = kwNorm(l.desc + ' ' + l.ref);
        for (var kk = 0; kk < KW.length; kk++) {
          if (flat.indexOf(KW[kk].n) < 0 || !allowed(KW[kk].L, dir)) continue;
          var fk = fromLedger(KW[kk].L, dir); e.kind = fk.kind; e.name = fk.name || ''; if (fk.from) e.from = fk.from; if (fk.to) e.to = fk.to; if (fk.led) e.led = fk.led; e.conf = 'keyword'; e.why = 'w_kw'; break;
        }
      }
      /* 1. a rule the user taught (this statement's own choices first: ctx.rules carries them at the end) */
      var best = null, cand = (py.core ? RB[dir + py.core[0]] || [] : []).concat(RW);
      cand.forEach(function (x) { var r = x[0], ri = x[1]; if (r.dir !== dir || !ruleHit(r, py, ptk)) return; var sc = (/^p:/.test(r.pat) ? 1000 : r.pat.split(' ').length * 100) + (r.n || 1) + ri / 1e4; if (!best || sc > best.sc) best = { r: r, sc: sc }; });
      if (!best && !e.kind && e.batch) rules.forEach(function (r) { if (r.batch === e.batch && r.dir === dir && (!best || (r.n || 1) > best.sc)) best = { r: r, sc: r.n || 1 }; });
      if (best && !e.kind) {
        e.conf = 'rule'; e.why = 'w_rule'; e.name = best.r.name;
        e.kind = best.r.kind === 'head' ? (dir === 'cr' ? 'oinc' : 'exp') : dir === 'cr' ? 'in' : 'out';
        if (best.r.kind === 'cash') { e.kind = 'contra'; e.from = best.r.name; e.name = ''; }
        if (best.r.kind === 'led' && best.r.led) { e.kind = 'jv'; e.led = best.r.led; }   /* any other ledger (loan, capital, asset...): a journal */
        if (best.r.kind === 'xfer' && best.r.led) { e.kind = 'contra'; e.from = best.r.led.from; e.to = best.r.led.to; }   /* a transfer to or from another bank account */
      }
      /* 2. plain-words hints: charges, interest, cash */
      if (!e.kind) {
        for (var h = 0; h < HINT.length; h++) {
          if (HINT[h][0] !== dir || !HINT[h][1].test(text)) continue;
          var o = HINT[h][2];
          if (ctx.ledset && o.name && !ctx.ledset[(o.kind === 'oinc' ? 'inc' : 'exp') + '|' + key(o.name)]) continue;   /* the head is not one of the ledgers: no suggestion */
          e.kind = o.kind; e.name = o.name || ''; if (o.from) e.from = o.from; e.conf = 'hint'; e.why = HINT[h][3]; break;
        }
      }
      /* 3. the payee is a saved party */
      if (!e.kind && PI.size) {
        var f = PI.find(py.core, String(l.desc).toLowerCase().replace(/[^a-z]/g, ''));
        if (f && ctx.ledOf) {   /* the payee is the name of a ledger (party, head or other account): the ledger decides the entry */
          var LG = ctx.ledOf(f.p.n, dir);
          if (LG) { var fl = fromLedger(LG, dir); e.conf = 'name'; e.why = 'w_name'; e.kind = fl.kind; e.name = fl.name || ''; if (fl.from) e.from = fl.from; if (fl.to) e.to = fl.to; if (fl.led) e.led = fl.led; }
        } else if (f) { e.conf = 'name'; e.why = 'w_name'; e.name = f.p.n; e.kind = dir === 'cr' ? 'in' : 'out'; }
      }
      /* 4. salary or wages paid to a person who is not a party */
      if (!e.kind && dir === 'dr' && /^(salary|salaries|wages?)$/.test(py.purpose) && (!ctx.ledset || ctx.ledset['exp|salary and wages'])) { e.kind = 'exp'; e.name = 'Salary and wages'; e.conf = 'hint'; e.why = 'h_salary'; }
      /* 5. an open bill of exactly this amount (customer for money in, supplier for money out) */
      if (e.kind === 'in' || e.kind === 'out') {
        var ex = (billAmt[(e.kind === 'in' ? 'recv' : 'pay') + Math.round(amt * 100)] || []).filter(function (b) { return key(b.party) === key(e.name) && !used[b.id]; });
        if (ex.length) { ex.sort(function (a, b) { return a.date.localeCompare(b.date); }); e.billId = ex[0].id; used[ex[0].id] = 1; e.why = e.conf === 'rule' ? 'w_rulebill' : 'w_namebill'; }
      } else if (!e.kind) {
        var ex2 = (billAmt[(dir === 'cr' ? 'recv' : 'pay') + Math.round(amt * 100)] || []).filter(function (b) { return !used[b.id]; });
        if (ex2.length === 1) { var b0 = ex2[0]; e.kind = dir === 'cr' ? 'in' : 'out'; e.name = b0.party; e.billId = b0.id; used[b0.id] = 1; e.conf = 'bill'; e.why = 'w_bill'; }
      }
      /* 6. a name is printed but no party has it: offered as a new party, for the user to confirm */
      if (!e.kind && !ctx.ledOf && py.name && py.core.length >= 4) { e.kind = dir === 'cr' ? 'in' : 'out'; e.name = py.name; e.conf = 'guess'; e.why = 'w_guess'; }
      /* already in the books: a saved record of the same amount and direction within a few days */
      var bk = only ? null : inBooks(l); if (bk) { e.status = 'inbooks'; e.bookId = bk.id; }
      return e;
    });
  }

  /* ---------- rules taught by the lines the user posted (or chose on screen: the same statement's other lines follow at once) ----------
     entries: [{ line, kind, name, from }]; returns the rules list with the new ones added or counted.
     A rule is kept under the payee's letters ('p:gargtrading'); a line with no payee name keeps the old word pattern;
     a line of a bulk transfer file also teaches its batch (r.batch) so the other lines of that file follow. */
  function learn(rules, entries) {
    var out = (rules || []).map(function (r) { return Object.assign({}, r); });
    entries.forEach(function (e) {
      if (!e.line) return;
      var dir = e.line.cr ? 'cr' : 'dr', py = payee(e.line.desc), pat = py.core.length >= 3 ? 'p:' + py.core : pattern(e.line.desc), bt = batchOf(e.line.desc);
      var xf = e.kind === 'contra' && (e.to && e.to !== 'cash' && e.to !== 'bank' || e.from && e.from !== 'cash' && e.from !== 'bank');
      var kind = e.kind === 'in' || e.kind === 'out' ? 'party' : e.kind === 'exp' || e.kind === 'oinc' ? 'head' : e.kind === 'contra' ? (xf ? 'xfer' : 'cash') : e.kind === 'jv' ? 'led' : '';
      if (!kind) return;
      var name = kind === 'cash' ? e.from : kind === 'xfer' ? (e.name || e.from + '>' + e.to) : e.name; if (!name) return;
      var led = kind === 'led' ? e.led : kind === 'xfer' ? { from: e.from, to: e.to } : null; if ((kind === 'led' || kind === 'xfer') && !led) return;
      if (bt && kind === 'head') {
        var hb = out.filter(function (r) { return r.batch === bt && r.dir === dir; })[0];
        if (hb) { hb.name = name; hb.kind = kind; hb.n = (hb.n || 1) + 1; } else out.push({ pat: 'b:' + bt, batch: bt, kind: kind, name: name, dir: dir, n: 1 });
      }
      if (!pat) return;
      var hit = out.filter(function (r) { return r.pat === pat && r.dir === dir; })[0];
      if (hit) { if (hit.name === name && hit.kind === kind) hit.n = (hit.n || 1) + 1; else { hit.name = name; hit.kind = kind; hit.n = 1; } if (led) hit.led = led; else delete hit.led; }
      else { var nr = { pat: pat, kind: kind, name: name, dir: dir, n: 1 }; if (led) nr.led = led; out.push(nr); }
    });
    return out.slice(-800);
  }

  /* ---------- the records ----------
     e: { kind, name, billId, from, note }, l: the statement line, o: { seller, no (function (type, prefix, date) -> next number), file, bills (open bills), mode,
     bacct (which of the business's banks the statement is from: 'bank:<name>'; none = the default bank) } */
  function modeOf(l) { var t = String(l.desc + ' ' + l.ref).toLowerCase(); return /\bupi\b/.test(t) ? 'upi' : 'bank'; }
  function records(e, l, o) {
    var amt = l.cr || l.dr, mode = modeOf(l), ref = l.ref || (String(l.desc).match(/\b\d{9,16}\b/) || [''])[0] || '', note = e.note || l.desc || '', base = { app: 1, bsk: e.key, bsfile: o.file || '', seller: o.seller, date: l.date };
    if (/^bank:/.test(o.bacct || '')) base.bacct = o.bacct;
    var bill = e.billId ? (o.bills || []).filter(function (b) { return b.id === e.billId; })[0] : null, alloc = bill ? [{ id: bill.id, no: bill.no || '', amt: Math.min(amt, bill.left) }] : [];
    if (e.kind === 'in') {
      return Object.assign({ type: 'receipt', no: o.no('receipt', 'RCT', l.date), paper: 'a4', design: 'classic', copies: 1, copyLabel: '', gstAdv: false, rate: '18', pos: '', sac: '', rv: '', rvDate: '', refDate: '', bank: '', balance: '', status: '',
        kind: alloc.length ? 'pay' : 'adv', amount: amt, tds: '', disc: 0, mode: mode, ref: ref, against: bill ? bill.no || '' : '', purpose: note, alloc: alloc,
        buyer: { name: e.name, addr: '', phone: '', gstin: '', pan: '' }, total: amt }, base);
    }
    if (e.kind === 'out') {
      return Object.assign({ type: 'voucher', no: o.no('voucher', 'PV', l.date), paper: 'a4', design: 'classic', copies: 1, copyLabel: 'orig', tdsSec: '', rcm: false, rcmRate: '18', prep: '', appr: '', status: '',
        forBill: true, mode: mode, ref: ref, tdsRate: '', disc: 0, alloc: alloc, lines: [{ desc: bill ? 'Payment against bill ' + (bill.no || '') : 'Payment on account', head: 'Supplier payment', amt: amt }],
        buyer: { name: e.name, addr: '', phone: '', gstin: '', pan: '' }, total: amt }, base);
    }
    if (e.kind === 'exp') {
      return Object.assign({ type: 'exp', cat: e.name, amount: amt, mode: mode, buyer: { name: '' }, no: l.ref || '', gst: '', itc: false, inter: false, notes: note, total: amt }, base);
    }
    if (e.kind === 'oinc') {
      return Object.assign({ type: 'oinc', no: o.no('oinc', 'OI', l.date), head: e.name, amount: amt, tds: '', mode: mode, payer: e.payer || '', ref: ref, notes: note, total: amt, narr: [e.name, note].filter(Boolean).join(' · ') }, base);
    }
    if (e.kind === 'contra') {
      if (e.to && e.to !== 'cash' && e.to !== 'bank' || e.from && e.from !== 'cash' && e.from !== 'bank') {   /* between two bank accounts of the business: this statement's bank is 'bank' on its side */
        return Object.assign({ type: 'contra', no: '', from: e.from || 'bank', to: e.to || 'bank', amount: amt, ref: ref, notes: note }, base);
      }
      var from = e.from === 'bank' ? 'bank' : 'cash';
      return Object.assign({ type: 'contra', no: '', from: from, to: from === 'cash' ? 'bank' : 'cash', amount: amt, ref: ref, notes: note }, base);
    }
    if (e.kind === 'susp') {   /* no ledger yet: a journal against the Suspense A/c, with the line's own words kept so it can be given a ledger later */
      var sb = /^bank:/.test(o.bacct || '') ? o.bacct : 'bank';
      return Object.assign({ type: 'jv', no: o.no('jv', 'JV', l.date), narr: note, susp: 1, sdesc: l.desc || '', sref: l.ref || '',
        lines: l.dr ? [{ t: SUSP.t, nm: SUSP.nm, a: SUSP.a, dr: amt, cr: 0 }, { t: 'bank', nm: '', a: sb, dr: 0, cr: amt }] : [{ t: 'bank', nm: '', a: sb, dr: amt, cr: 0 }, { t: SUSP.t, nm: SUSP.nm, a: SUSP.a, dr: 0, cr: amt }], total: amt }, base);
    }
    if (e.kind === 'jv' && e.led) {   /* a ledger with no money screen of its own (loan, capital, drawings, asset...): a journal against the bank */
      var bk = /^bank:/.test(o.bacct || '') ? o.bacct : 'bank', ln = { t: e.led.t, nm: e.led.nm || '', a: e.led.a, dr: l.dr ? amt : 0, cr: l.cr ? amt : 0 }, bl = { t: 'bank', nm: '', a: bk, dr: l.cr ? amt : 0, cr: l.dr ? amt : 0 };
      return Object.assign({ type: 'jv', no: o.no('jv', 'JV', l.date), narr: [e.name, note].filter(Boolean).join(' \u00b7 '), lines: l.dr ? [ln, bl] : [bl, ln], total: amt }, base);
    }
    return null;
  }
  /* what is still missing before an entry can be posted (key of a screen text) or '' */
  function problem(e, l) {
    if (!e.kind) return 'p_kind';
    if (e.kind === 'susp') return '';
    if ((e.kind === 'in' || e.kind === 'out' || e.kind === 'exp' || e.kind === 'oinc') && !String(e.name || '').trim()) return e.kind === 'exp' || e.kind === 'oinc' ? 'p_head' : 'p_party';
    if (e.kind === 'in' && !l.cr) return 'p_dir_in';
    if (e.kind === 'out' && !l.dr) return 'p_dir_out';
    if (e.kind === 'exp' && !l.dr) return 'p_dir_out';
    if (e.kind === 'oinc' && !l.cr) return 'p_dir_in';
    if (e.kind === 'contra' && !(e.from === 'bank' ? l.dr : l.cr)) return 'p_dir_contra';
    if (e.kind === 'jv' && !(e.led && e.led.a)) return 'p_kind';
    return '';
  }
  /* ---------- one ledger picker (26 Nov 2026): the ledger the user picks decides what the line is ----------
     L = { k: 'party' | 'exp' | 'inc' | 'cash' | 'bank' | 'other', name, bk (a bank account key), t, nm, a (account key of an 'other' ledger) }; dir 'cr' = money in, 'dr' = money out.
     Returns the fields of the entry: { kind, name, from, to, led }. A supplier or customer with money out is a payment, with money in a receipt;
     an expense head is an expense, an income head other income; cash is cash deposited or withdrawn; another bank account is a transfer;
     any other ledger (loan, capital, drawings, asset...) is a journal against this bank. */
  var SUSP = { a: 'ocl:suspense a/c', t: 'ocl', nm: 'Suspense A/c' };   /* like Tally's reserved group Suspense A/c: lines with no ledger yet wait here */
  function fromLedger(L, dir) {
    if (!L) return { kind: '' };
    if (L.a === SUSP.a) return { kind: 'susp', name: SUSP.nm, from: undefined, to: undefined, led: undefined };
    if (L.k === 'party') return { kind: dir === 'cr' ? 'in' : 'out', name: L.name, from: undefined, to: undefined, led: undefined };
    if (L.k === 'exp') return { kind: 'exp', name: L.name, from: undefined, to: undefined, led: undefined };
    if (L.k === 'inc') return { kind: 'oinc', name: L.name, from: undefined, to: undefined, led: undefined };
    if (L.k === 'cash') return { kind: 'contra', from: dir === 'cr' ? 'cash' : 'bank', to: undefined, name: '', led: undefined };
    if (L.k === 'bank') return { kind: 'contra', from: dir === 'cr' ? L.bk : 'bank', to: dir === 'cr' ? 'bank' : L.bk, name: L.name, led: undefined };
    return { kind: 'jv', name: L.name, led: { a: L.a, t: L.t, nm: L.nm || '' }, from: undefined, to: undefined };
  }
  /* is a ledger of this kind offered for this direction? (an expense head only for money out, an income head only for money in) */
  function allowed(L, dir) { return !(L.k === 'exp' && dir === 'cr') && !(L.k === 'inc' && dir === 'dr'); }
  /* the ledger a suggested entry stands for, to show in the picker: { name, tag } */
  function ledgerOf(e) {
    if (!e || !e.kind) return null;
    if (e.kind === 'contra') { var other = e.to && e.to !== 'bank' && e.to !== 'cash' ? e.to : e.from && e.from !== 'bank' && e.from !== 'cash' ? e.from : ''; return other ? { name: e.name || '', tag: 'bank', bk: other } : { name: '', tag: 'cash' }; }
    if (e.kind === 'susp') return null;
    if (e.kind === 'jv') return { name: e.name || (e.led && e.led.nm) || '', tag: 'other' };
    return { name: e.name || '', tag: e.kind === 'exp' ? 'exp' : e.kind === 'oinc' ? 'inc' : 'party' };
  }
  /* the bsk keys of the records already in the books (a record can carry one key) */
  function doneKeys(docs) { var o = {}; (docs || []).forEach(function (d) { if (d && d.bsk) o[d.bsk] = 1; }); return o; }

  var API = { key: key, words: words, tokens: tokens, pattern: pattern, payee: payee, core: core, partyIndex: partyIndex, batchOf: batchOf, lineKeys: lineKeys, suggest: suggest, learn: learn, records: records, problem: problem, doneKeys: doneKeys, kwNorm: kwNorm, fromLedger: fromLedger, allowed: allowed, ledgerOf: ledgerOf, SUSP: SUSP, modeOf: modeOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else G.NSBI = API;
})(this);
