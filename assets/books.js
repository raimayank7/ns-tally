/* NSBooks: the accounts underneath the Nivesh Sahayak App (Phase 2: money in and out).
   Nothing new is stored here: every saved document in the data home is turned into double-entry lines on the fly
   (party, sales, purchases, expenses, GST, cash, bank, TDS), so the ledgers can never drift from the documents.
   Pure functions: the page passes in the documents and gets balances, statements and bill-wise dues back.

   Records it reads (store 'doc'; seller = our business on every record, buyer = the other party):
     invoice, cashmemo           sale: the customer owes the total (status 'paid' without a linked payment = paid at once)
     note credit / debit         sales return or price cut (customer owes less) / extra charge (customer owes more)
     receipt pay / adv           money in from buyer; tds = TDS the customer cut (settles that much more)
     receipt ref                 refund paid back to buyer
     voucher                     money out: with forBill (made in the app) it pays the supplier, else an expense by account head
     self                        purchase from an unregistered supplier (supplier is owed the taxable value; GST on reverse charge)
     pbill bill / return         purchase bill from a supplier (we owe it) / purchase return (we owe less)
     exp                         expense; mode 'credit' = not paid yet (we owe the payee)
     ob                          opening balance: side 'recv' (a party owes us), 'pay' (we owe a party), 'cash' or 'bank' (no party)
     contra                      cash deposited in the bank (from 'cash', to 'bank') or withdrawn (from 'bank', to 'cash')
   chq: { date, bank, st, on } on a receipt or voucher paid by cheque: st 'hand' (received, not deposited), 'dep' (deposited),
     'iss' (issued by us), 'ok' (cleared on date 'on'), 'bounce' (bounced: the record is left out of the books, so its bills are due again).
     Until it clears, the money sits in 'chq-in' (cheques received) or 'chq-out' (cheques issued) instead of 'bank'.
   alloc: [{ id, amt }] on a receipt or app voucher links money to bills; whatever is not linked settles the oldest bills first. */
(function (G) {
  'use strict';
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; }
  function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function key(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  var UT = { '04': 1, '26': 1, '31': 1, '35': 1, '38': 1 };
  var BANKISH = { upi: 1, cheque: 1, bank: 1, card: 1, dd: 1, other: 1 };
  function moneyAcct(mode) { return BANKISH[mode] ? 'bank' : 'cash'; }
  function bounced(d) { return !!(d.chq && d.chq.st === 'bounce' && d.mode === 'cheque'); }
  /* where the money of a receipt / voucher went: a cheque not cleared yet is not in the bank */
  function payAcct(d, out) { return d.mode === 'cheque' && d.chq && d.chq.st && d.chq.st !== 'ok' ? (out ? 'chq-out' : 'chq-in') : moneyAcct(d.mode); }

  /* tax split of an item document (same rules as docs.js totals) */
  function itemTotals(d) {
    var noTax = d.kind === 'supply' || d.kind === 'plain' || d.withGst === false || d.type === 'pbill' && d.noGst;
    /* a purchase bill comes from the supplier (buyer field) to us (seller field) */
    var buy = d.type === 'pbill', origin = buy ? d.buyer && d.buyer.state : d.seller && d.seller.state;
    var dest = buy ? d.seller && d.seller.state : d.pos || d.buyer && d.buyer.state || origin;
    origin = origin || dest;
    var intra = !origin || !dest || origin === dest, o = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    (d.items || []).forEach(function (it) {
      var q = it.qty === '' || it.qty == null ? 1 : num(it.qty), rate = num(it.rate);
      if (!it.desc && !rate) return;
      var taxable = r2(q * rate - q * rate * num(it.disc) / 100), tax = noTax ? 0 : r2(taxable * num(it.gst) / 100);
      o.taxable += taxable;
      if (intra) { o.cgst += tax / 2; o.sgst += tax / 2; } else o.igst += tax;
    });
    o.taxable = r2(o.taxable); o.cgst = r2(o.cgst); o.sgst = r2(o.sgst); o.igst = r2(o.igst);
    var total = r2(o.taxable + o.cgst + o.sgst + o.igst);
    o.total = d.total != null && d.total !== '' ? num(d.total) : total;
    o.round = r2(o.total - total);
    o.ut = !buy && UT[origin] && intra;
    return o;
  }

  function partyName(d) { return String(d.buyer && d.buyer.name || '').trim(); }
  function bizOf(d) { return key(d.seller && d.seller.name); }

  /* kind of each record for the books: 'sale', 'sret' (credit note), 'sdeb' (debit note), 'in', 'refund', 'out', 'outexp', 'buy', 'pret', 'exp', 'ob', or '' (not in the books) */
  function role(d) {
    if (bounced(d)) return '';
    switch (d.type || 'invoice') {
      case 'invoice': case 'cashmemo': case 'pharma': return 'sale';   /* pharma: pharmacy.niveshsahayak.in */
      case 'resto': return d.status === 'open' ? '' : 'sale';   /* restaurant: a running table is not a sale yet */
      case 'lr': return 'sale';   /* bilty: freight earned; the payer is the customer */
      case 'fee': return 'sale';   /* fee receipt: fees received (status paid) */
      case 'job': return d.print === 'bill' ? 'sale' : '';   /* job card: a sale once it is a service bill */
      case 'rabill': return 'sale';   /* contractor RA bill: value of work in this bill (retention and TDS settle at payment) */
      case 'note': return d.kind === 'debit' ? 'sdeb' : 'sret';
      case 'receipt': return d.kind === 'ref' ? 'refund' : 'in';
      case 'voucher': return d.forBill ? 'out' : 'outexp';
      case 'self': return 'buy';
      case 'pbill': return d.kind === 'return' ? 'pret' : 'buy';
      case 'exp': return 'exp';
      case 'ob': return 'ob';
      case 'contra': return 'contra';
    }
    return '';
  }

  /* double-entry lines of one record: [{ a: account, dr, cr }]; party accounts are 'p:<name key>' */
  function postings(d) {
    var R = role(d), P = 'p:' + key(partyName(d)), L = [];
    function dr(a, v) { v = r2(v); if (v) L.push({ a: a, dr: v, cr: 0 }); }
    function cr(a, v) { v = r2(v); if (v) L.push({ a: a, dr: 0, cr: v }); }
    var t, amt;
    if (R === 'sale' || R === 'sret' || R === 'sdeb') {
      t = itemTotals(d);
      var side = R === 'sret' ? cr : dr, other = R === 'sret' ? dr : cr, sales = R === 'sret' ? 'sales-return' : 'sales';
      side(partyName(d) ? P : 'p:cash-customer', t.total);
      other(sales, t.taxable);
      other('gst-out-cgst', t.cgst); other(t.ut ? 'gst-out-utgst' : 'gst-out-sgst', t.sgst); other('gst-out-igst', t.igst);
      if (t.round) (t.round > 0 ? other : side)('round-off', Math.abs(t.round));
      /* marked paid on the bill itself (no payment entry linked): money came in on the bill date */
      if (R === 'sale' && d.status === 'paid' && !d.paidBy) { dr(moneyAcct(d.payMode || 'cash'), t.total); cr(partyName(d) ? P : 'p:cash-customer', t.total); }
    } else if (R === 'in') {
      amt = num(d.amount); var tds = num(d.tds);
      dr(payAcct(d), amt); dr('tds-receivable', tds); cr(P, amt + tds);
    } else if (R === 'refund') {
      amt = num(d.amount); dr(P, amt); cr(payAcct(d, true), amt);
    } else if (R === 'out' || R === 'outexp') {
      var gross = (d.lines || []).reduce(function (a, l) { return a + num(l.amt); }, 0), tdsOut = r2(gross * num(d.tdsRate) / 100);
      if (R === 'out') dr(P, gross);
      else (d.lines || []).forEach(function (l) { dr('exp:' + key(l.head || 'Miscellaneous'), num(l.amt)); });
      cr(payAcct(d, true), gross - tdsOut); cr('tds-payable', tdsOut);
    } else if (R === 'buy' || R === 'pret') {
      t = itemTotals(d);
      var s2 = R === 'pret' ? cr : dr, o2 = R === 'pret' ? dr : cr, buys = R === 'pret' ? 'purchase-return' : 'purchases';
      s2(buys, t.taxable);
      if (d.type === 'self') {   /* reverse charge: input tax credit and tax payable both, supplier gets the taxable value */
        s2('gst-in-cgst', t.cgst); s2('gst-in-sgst', t.sgst); s2('gst-in-igst', t.igst);
        o2('gst-rcm-payable', t.cgst + t.sgst + t.igst); o2(P, t.taxable);
        if (d.status === 'sipaid') { dr(P, t.taxable); cr(moneyAcct(d.payMode || 'cash'), t.taxable); }
      } else {
        s2('gst-in-cgst', t.cgst); s2('gst-in-sgst', t.sgst); s2('gst-in-igst', t.igst);
        if (t.round) (t.round > 0 ? s2 : o2)('round-off', Math.abs(t.round));
        o2(P, t.total);
      }
    } else if (R === 'exp') {
      amt = num(d.amount); var g = num(d.gst), itc = d.itc && g ? r2(amt * g / (100 + g)) : 0;
      dr('exp:' + key(d.cat || 'Miscellaneous'), amt - itc);
      if (itc) { if (d.inter) dr('gst-in-igst', itc); else { dr('gst-in-cgst', r2(itc / 2)); dr('gst-in-sgst', itc - r2(itc / 2)); } }
      if (d.mode === 'credit') cr(partyName(d) ? P : 'p:unknown', amt); else cr(moneyAcct(d.mode), amt);
    } else if (R === 'contra') {
      amt = num(d.amount); dr(d.to === 'cash' ? 'cash' : 'bank', amt); cr(d.from === 'bank' ? 'bank' : 'cash', amt);
    } else if (R === 'ob') {
      amt = num(d.amount);
      if (d.side === 'cash' || d.side === 'bank') { dr(d.side, amt); cr('opening', amt); }   /* cash in hand / bank balance on the start date */
      else if (d.side === 'pay') { dr('opening', amt); cr(P, amt); } else { dr(P, amt); cr('opening', amt); }
    }
    return L;
  }

  /* the business's records in date order (same date: sales and bills before money, so a same-day payment settles them) */
  var ORDER = { ob: 0, sale: 1, sdeb: 1, buy: 1, exp: 1, sret: 2, pret: 2, 'in': 3, out: 3, outexp: 3, refund: 3, contra: 4 };
  function inBooks(docs, biz) {
    var b = key(biz);
    return docs.filter(function (d) { return role(d) && (!b || bizOf(d) === b); }).sort(function (x, y) {
      return (x.date || '').localeCompare(y.date || '') || ORDER[role(x)] - ORDER[role(y)] || (x.created || 0) - (y.created || 0);
    });
  }

  /* party balances: { key: { name, recv, bal, docs } }; bal > 0 = they owe us, < 0 = we owe them */
  function parties(docs, biz) {
    var out = {};
    inBooks(docs, biz).forEach(function (d) {
      var nm = partyName(d); if (!nm) return;
      var k = key(nm), mine = postings(d).filter(function (l) { return l.a === 'p:' + k; });
      if (!mine.length) return;   /* e.g. a voucher paid straight as an expense */
      var p = out[k] || (out[k] = { key: k, name: nm, bal: 0, n: 0, last: '' });
      mine.forEach(function (l) { p.bal = r2(p.bal + l.dr - l.cr); });
      p.n++; p.last = d.date || p.last;
      if (d.buyer && d.buyer.phone) p.phone = d.buyer.phone;
    });
    return out;
  }

  /* account balances (dr - cr) for the whole business, optionally up to a date */
  function accounts(docs, biz, upto) {
    var out = {};
    inBooks(docs, biz).forEach(function (d) {
      if (upto && d.date > upto) return;
      postings(d).forEach(function (l) { out[l.a] = r2((out[l.a] || 0) + l.dr - l.cr); });
    });
    return out;
  }

  /* bill-wise dues of one party (or every party): open bills with what is left on each.
     Receivable bills: sales, debit notes, opening 'recv'. Payable bills: purchase bills, self invoices, expenses on credit, opening 'pay'.
     Money and returns go first to the bills they name (alloc / orig no.), then to the oldest bill on the same side. */
  function bills(docs, biz, partyKey) {
    var list = inBooks(docs, biz).filter(function (d) { return !partyKey || key(partyName(d)) === partyKey; });
    var open = {}, byId = {}, credits = [];
    function pk(d) { return key(partyName(d)); }
    function bill(d, side, amt) {
      if (amt <= 0) return;
      var b = { id: d.id, no: d.no || d.billNo || '', date: d.date, due: d.due || '', side: side, total: r2(amt), left: r2(amt), type: d.type, kind: d.kind, party: partyName(d) };
      (open[pk(d)] = open[pk(d)] || []).push(b); byId[d.id] = b;
    }
    list.forEach(function (d) {
      var R = role(d), t;
      if (!partyName(d)) return;
      if (R === 'sale') { t = itemTotals(d).total; bill(d, 'recv', t); if (d.status === 'paid' && !d.paidBy) credits.push({ side: 'recv', amt: t, to: d.id, date: d.date }); }
      else if (R === 'sdeb') bill(d, 'recv', itemTotals(d).total);
      else if (R === 'buy') {
        t = itemTotals(d); bill(d, 'pay', d.type === 'self' ? t.taxable : t.total);
        if (d.type === 'self' && d.status === 'sipaid') credits.push({ side: 'pay', amt: t.taxable, to: d.id, date: d.date });
      }
      else if (R === 'exp' && d.mode === 'credit') bill(d, 'pay', num(d.amount));
      else if (R === 'ob' && d.side !== 'cash' && d.side !== 'bank') bill(d, d.side === 'pay' ? 'pay' : 'recv', num(d.amount));
      else if (R === 'in') credits.push({ side: 'recv', amt: num(d.amount) + num(d.tds), alloc: d.alloc, d: d });
      else if (R === 'sret') credits.push({ side: 'recv', amt: itemTotals(d).total, origNo: d.orig && d.orig.no, d: d });
      else if (R === 'refund') bill(d, 'recv', num(d.amount));   /* a refund paid out makes the customer "owe" it back against their advance */
      else if (R === 'out') credits.push({ side: 'pay', amt: (d.lines || []).reduce(function (a, l) { return a + num(l.amt); }, 0), alloc: d.alloc, d: d });
      else if (R === 'pret') credits.push({ side: 'pay', amt: itemTotals(d).total, origNo: d.orig && d.orig.no, d: d });
    });
    /* apply credits in date order (list was sorted, credits keep that order) */
    var adv = {};
    credits.forEach(function (c) {
      var left = r2(c.amt), p = c.d ? pk(c.d) : null;
      function take(b, max) { var x = r2(Math.min(b.left, max == null ? left : max, left)); if (x > 0) { b.left = r2(b.left - x); left = r2(left - x); } }
      if (c.to && byId[c.to]) { take(byId[c.to]); return; }
      (c.alloc || []).forEach(function (a) { var b = byId[a.id]; if (b && b.side === c.side) take(b, num(a.amt)); });
      if (c.origNo) (open[p] || []).forEach(function (b) { if (b.side === c.side && key(b.no) === key(c.origNo)) take(b); });
      (open[p] || []).forEach(function (b) { if (left > 0 && b.side === c.side) take(b); });
      if (left > 0 && p) { adv[p] = adv[p] || { recv: 0, pay: 0 }; adv[p][c.side] = r2(adv[p][c.side] + left); }
    });
    /* an advance on one side is used up by bills that come later on the same side */
    Object.keys(adv).forEach(function (p) {
      ['recv', 'pay'].forEach(function (s) {
        (open[p] || []).forEach(function (b) { if (adv[p][s] > 0 && b.side === s && b.left > 0) { var x = Math.min(b.left, adv[p][s]); b.left = r2(b.left - x); adv[p][s] = r2(adv[p][s] - x); } });
      });
    });
    var all = [];
    Object.keys(open).forEach(function (p) { open[p].forEach(function (b) { if (b.left > 0.004) all.push(b); }); });
    return { bills: all, advances: adv };
  }

  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5); }
  /* ageing buckets by days since the bill date: 0-30, 31-60, 61-90, 90+ */
  function ageing(openBills, today) {
    var B = [0, 0, 0, 0];
    openBills.forEach(function (b) { var n = daysBetween(b.date, today); B[n <= 30 ? 0 : n <= 60 ? 1 : n <= 90 ? 2 : 3] = r2(B[n <= 30 ? 0 : n <= 60 ? 1 : n <= 90 ? 2 : 3] + b.left); });
    return B;
  }

  /* statement of account of one party between two dates: opening, rows with running balance, closing */
  function statement(docs, biz, partyKey, from, to) {
    var acct = 'p:' + partyKey, open = 0, rows = [], bal;
    inBooks(docs, biz).forEach(function (d) {
      if (key(partyName(d)) !== partyKey) return;
      var dr = 0, cr = 0;
      postings(d).forEach(function (l) { if (l.a === acct) { dr += l.dr; cr += l.cr; } });
      dr = r2(dr); cr = r2(cr);
      if (!dr && !cr) return;
      if (from && d.date < from) { open = r2(open + dr - cr); return; }
      if (to && d.date > to) return;
      rows.push({ d: d, date: d.date, dr: dr, cr: cr });
    });
    bal = open;
    rows.forEach(function (r) { bal = r2(bal + r.dr - r.cr); r.bal = bal; });
    return { open: open, rows: rows, close: bal, dr: r2(rows.reduce(function (a, r) { return a + r.dr; }, 0)), cr: r2(rows.reduce(function (a, r) { return a + r.cr; }, 0)) };
  }

  /* one account's lines (cash book, bank book) between two dates; a cleared cheque reaches the bank on the day it cleared */
  function book(docs, biz, acct, from, to) {
    var open = 0, rows = [];
    inBooks(docs, biz).map(function (d) {
      return { d: d, date: acct === 'bank' && d.mode === 'cheque' && d.chq && d.chq.st === 'ok' && d.chq.on ? d.chq.on : d.date };
    }).sort(function (x, y) { return (x.date || '').localeCompare(y.date || ''); }).forEach(function (x) {
      var d = x.d, dr = 0, cr = 0;
      postings(d).forEach(function (l) { if (l.a === acct) { dr += l.dr; cr += l.cr; } });
      if (!dr && !cr) return;
      if (from && x.date < from) { open = r2(open + dr - cr); return; }
      if (to && x.date > to) return;
      rows.push({ d: d, date: x.date, dr: r2(dr), cr: r2(cr) });
    });
    var bal = open; rows.forEach(function (r) { bal = r2(bal + r.dr - r.cr); r.bal = bal; });
    return { open: open, rows: rows, close: bal };
  }

  var API = { num: num, r2: r2, key: key, role: role, itemTotals: itemTotals, postings: postings, inBooks: inBooks, parties: parties, accounts: accounts,
    bills: bills, ageing: ageing, statement: statement, book: book, daysBetween: daysBetween, moneyAcct: moneyAcct, payAcct: payAcct, bounced: bounced, partyName: partyName };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else G.NSBooks = API;
})(this);
