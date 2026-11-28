/* NSXlTally (byof2-tally, 28 Nov 2026): any Excel / CSV of sales, purchases, credit and debit notes, receipts, payments, contra or
   journal entries -> a TallyPrime import file (masters: the ledgers and stock items that are new; vouchers), after a check of every row.
   Pure, no screen: tally.niveshsahayak.in's "Excel to Tally" box (xltally.js) and Node tests (scripts/test_xltally.js) use it.

   Reading: NSTpl (tplcore.js) finds the heading row and the columns by name (field set SETS.xltally, added here at load: tplcore.js is
   not changed). Rows can be one row per voucher (a sales register: party, taxable value, CGST, SGST, IGST, total) or one row per line
   (an item line of a bill with qty and rate, or a ledger line with Debit / Credit like Tally's own Day Book). Lines of one voucher share
   its voucher type + number + date, or leave date and number empty under the first line.

   The XML uses the same tags as engine/tally.js (TallyPrime's help pages "Sample XML" and "XML Integration", read 5 Nov 2026):
   ENVELOPE / Import Data / All Masters | Vouchers, LEDGER NAME PARENT, VOUCHER with ALLLEDGERENTRIES.LIST, ISDEEMEDPOSITIVE (Yes = debit,
   amount minus), BILLALLOCATIONS.LIST. Item invoices (stock items with qty and rate) use Tally's invoice layout: ISINVOICE Yes,
   ALLINVENTORYENTRIES.LIST with ACCOUNTINGALLOCATIONS.LIST and BATCHALLOCATIONS.LIST, the party and taxes in LEDGERENTRIES.LIST, and
   STOCKITEM / UNIT masters (BASEUNITS). Those invoice tags follow TallyPrime's usual export format; not tried in a real TallyPrime here.
   Designed & Developed by: Nivesh Sahayak (https://www.niveshsahayak.in/) */
(function (G) {
  'use strict';
  var TP = G.NSTpl || (typeof require !== 'undefined' ? require('./tplcore.js') : null);
  function key(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); }
  function r2(n) { return Math.round((+n + Number.EPSILON) * 100) / 100; }
  function t(s) { return String(s == null ? '' : s).trim(); }
  function num(s) { return TP ? TP.num(s) : (parseFloat(String(s || '').replace(/,/g, '')) || 0); }
  function has(o, k) { return o[k] != null && t(o[k]) !== ''; }

  /* ---------- the columns (field set for NSTpl.pick) ---------- */
  var SET = { k: 'xltally', name: 'Tally entries', w: 'Sales, purchases, notes, receipts, payments, contra and journal entries. One row per entry, or one row per line.', cols: [
    { k: 'date', h: 'Date', need: 1, w: 'Voucher date, 25-04-2026', ex: '05-04-2026', a: ['voucher date', 'vch date', 'bill date', 'invoice date', 'inv date', 'doc date', 'document date', 'posting date', 'txn date', 'transaction date', 'dated', 'entry date', 'date of invoice', 'invoice dt', 'bill dt'] },
    { k: 'vtype', h: 'Voucher type', w: 'Sales, Purchase, Credit Note, Debit Note, Receipt, Payment, Contra or Journal', ex: 'Sales', a: ['vch type', 'type', 'voucher', 'entry type', 'transaction type', 'txn type', 'vtype', 'bill type', 'document type', 'doc type', 'vch/bill type', 'voucher type name'] },
    { k: 'no', h: 'Voucher no', w: 'Bill, note, receipt or voucher number (empty = Tally numbers it)', ex: 'INV/101', a: ['vch no', 'voucher number', 'bill no', 'invoice no', 'inv no', 'bill number', 'invoice number', 'doc no', 'document no', 'document number', 'entry no', 'receipt no', 'payment no', 'vch/bill no', 'supplier bill no', 'supplier invoice no', 'invoice no.', 'ref no', 'reference no'] },
    { k: 'party', h: 'Party', w: 'Customer or supplier (empty on a sale = Cash)', ex: 'Garg Traders', a: ['party name', 'customer', 'customer name', 'supplier', 'supplier name', 'vendor', 'vendor name', 'buyer', 'buyer name', 'name', 'party a/c name', "party's name", 'billed to', 'name of party', 'trade name', 'receiver name', 'recipient name', 'paid to', 'received from'] },
    { k: 'ledger', h: 'Ledger', w: 'Sales, purchase or expense ledger, or the ledger of a journal / day book line', ex: 'Sales', a: ['ledger name', 'account', 'account name', 'particulars', 'head', 'account head', 'expense head', 'sales ledger', 'purchase ledger', 'expense', 'income head', 'a/c name', 'ledger account'] },
    { k: 'gstin', h: 'GSTIN', w: 'Party GSTIN, if registered', ex: '03AAACG1234A1Z5', a: ['gstin/uin', 'gst no', 'gst number', 'party gstin', 'customer gstin', 'supplier gstin', 'gstin of supplier', 'gstin of recipient', 'gstin/uin of recipient', 'buyer gstin', 'gst in', 'gstin no'] },
    { k: 'state', h: 'Place of supply', w: 'State name or code (empty = from the GSTIN)', ex: 'Punjab', a: ['state', 'party state', 'pos', 'supply state', 'state name', 'place of supply (state)', 'state code', 'place of supply state'] },
    { k: 'item', h: 'Item', w: 'Stock item name (with Qty: an item invoice in Tally)', ex: 'MS Pipe 1 inch', a: ['item name', 'stock item', 'product', 'product name', 'description', 'item description', 'goods', 'name of item', 'description of goods', 'item details', 'stock item name'] },
    { k: 'hsn', h: 'HSN or SAC', w: '', ex: '7306', a: ['hsn', 'sac', 'hsn code', 'hsn/sac', 'hsn sac', 'hsn/sac code'] },
    { k: 'qty', h: 'Qty', w: 'Quantity', ex: '10', a: ['quantity', 'qnty', 'billed qty', 'actual qty', 'qty.'] },
    { k: 'unit', h: 'Unit', w: 'Nos, Kgs, Box...', ex: 'Nos', a: ['uom', 'units', 'per', 'unit of measure', 'uqc'] },
    { k: 'rate', h: 'Rate', w: 'Per unit, before GST', ex: '100', a: ['price', 'unit price', 'rate per unit', 'item rate', 'rate (rs)', 'unit rate'] },
    { k: 'disc', h: 'Discount %', w: '', ex: '', a: ['disc %', 'disc', 'discount', 'disc%'] },
    { k: 'taxable', h: 'Taxable value', w: 'Value before GST', ex: '1000', a: ['taxable amount', 'taxable', 'assessable value', 'value', 'amount before tax', 'basic amount', 'basic value', 'item amount', 'amount (excl gst)', 'taxable value (rs)', 'sale value', 'purchase value', 'net value', 'goods value'] },
    { k: 'amt', h: 'Amount', w: 'Receipts, payments, contra: the amount. Bills: value before GST', ex: '', a: ['amount rs', 'amount (rs)', 'amt', 'paid amount', 'received amount', 'amount paid', 'amount received'] },
    { k: 'gst', h: 'GST %', w: '0, 5, 18 or 40', ex: '18', a: ['gst rate', 'tax %', 'rate of tax', 'igst %', 'gst%', 'tax rate', 'gst rate %', 'rate %', 'tax rate %'] },
    { k: 'cgst', h: 'CGST', w: 'CGST amount', ex: '90', a: ['cgst amount', 'cgst amt', 'central tax', 'cgst rs', 'central tax amount'] },
    { k: 'sgst', h: 'SGST', w: 'SGST or UTGST amount', ex: '90', a: ['sgst amount', 'sgst amt', 'state tax', 'sgst/utgst', 'utgst', 'sgst rs', 'state/ut tax', 'sgst/utgst amount', 'state tax amount'] },
    { k: 'igst', h: 'IGST', w: 'IGST amount', ex: '', a: ['igst amount', 'igst amt', 'integrated tax', 'igst rs', 'integrated tax amount'] },
    { k: 'cess', h: 'Cess', w: 'Cess amount', ex: '', a: ['cess amount', 'cess amt', 'compensation cess'] },
    { k: 'round', h: 'Round off', w: 'Can be minus', ex: '', a: ['rounding', 'r/off', 'round', 'round off amount', 'rounded off', 'roundoff'] },
    { k: 'total', h: 'Bill total', w: 'Total with GST (on the first row of a bill); checked against its lines', ex: '1180', a: ['invoice value', 'invoice total', 'total', 'grand total', 'bill amount', 'total amount', 'invoice amount', 'gross total', 'total invoice value', 'bill value', 'net amount', 'total value'] },
    { k: 'dr', h: 'Debit', w: 'Ledger line: debit amount', ex: '', a: ['dr', 'debit amount', 'dr amount', 'debit rs', 'debit (rs)', 'debit(rs.)', 'dr.'] },
    { k: 'cr', h: 'Credit', w: 'Ledger line: credit amount', ex: '', a: ['cr', 'credit amount', 'cr amount', 'credit rs', 'credit (rs)', 'credit(rs.)', 'cr.'] },
    { k: 'drcr', h: 'Dr or Cr', w: 'With Amount on a ledger line', ex: '', a: ['dr/cr', 'drcr', 'side', 'dr / cr', 'debit/credit'] },
    { k: 'mode', h: 'Cash or bank', w: 'Receipts, payments: Cash, or the bank ledger (HDFC Bank)', ex: 'Bank', a: ['mode', 'payment mode', 'cash/bank', 'bank', 'bank account', 'paid through', 'received in', 'through', 'mode of payment', 'bank ledger', 'cash or bank ledger', 'paid by', 'deposited in'] },
    { k: 'against', h: 'Against bill no', w: 'The bill a receipt, payment or note settles (bill-wise)', ex: 'INV/101', a: ['against', 'against invoice', 'ref bill', 'bill ref', 'against bill', 'agst ref', 'reference bill', 'against bill no.', 'original invoice no', 'original bill no'] },
    { k: 'narr', h: 'Narration', w: '', ex: '', a: ['remarks', 'notes', 'note', 'comment', 'comments', 'memo', 'narr'] }] };
  if (TP && TP.SETS && !TP.SETS.xltally) TP.SETS.xltally = SET;

  /* ---------- voucher types ---------- */
  var VT = ['Sales', 'Purchase', 'Credit Note', 'Debit Note', 'Receipt', 'Payment', 'Contra', 'Journal'];
  function vtype(s) {
    var k = key(s).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim(); if (!k) return '';
    if (/credit note|^cn$|sales? return|return inward|cr note/.test(k)) return 'Credit Note';
    if (/debit note|^dn$|purchase return|return outward|dr note/.test(k)) return 'Debit Note';
    if (/contra|cash deposit|cash withdrawal|^transfer|deposit|withdraw/.test(k)) return 'Contra';
    if (/journal|^jv$|^jnl/.test(k)) return 'Journal';
    if (/receipt|^rcpt|^rct|received|^collection/.test(k)) return 'Receipt';
    if (/payment|^pymt|^pmt|^paid|^pay$/.test(k)) return 'Payment';
    if (/purchase|^purc|^pur$|^buy|bill of entry/.test(k)) return 'Purchase';
    if (/sale|invoice|^inv|^tax invoice|^bill of supply|^cash memo|^b2b|^b2c|^export/.test(k)) return 'Sales';
    return '';
  }
  var INVTYPE = { Sales: 1, Purchase: -1, 'Credit Note': -1, 'Debit Note': 1 };   /* party side: +1 = party debited (Sales, Debit Note) */

  /* ---------- ledger names and groups ---------- */
  var GROUPS = ['Sundry Debtors', 'Sundry Creditors', 'Sales Accounts', 'Purchase Accounts', 'Duties & Taxes', 'Direct Expenses', 'Indirect Expenses', 'Direct Incomes', 'Indirect Incomes',
    'Cash-in-Hand', 'Bank Accounts', 'Bank OD A/c', 'Capital Account', 'Reserves & Surplus', 'Loans (Liability)', 'Secured Loans', 'Unsecured Loans', 'Current Liabilities', 'Provisions',
    'Fixed Assets', 'Investments', 'Current Assets', 'Deposits (Asset)', 'Loans & Advances (Asset)', 'Stock-in-Hand', 'Misc. Expenses (ASSET)', 'Suspense A/c', 'Branch / Divisions'];
  var BANKW = /\bbank\b|\bhdfc\b|\bsbi\b|\bicici\b|\baxis\b|\bkotak\b|\bpnb\b|\bcanara\b|\bbaroda\b|\bidbi\b|\bindusind\b|\bidfc\b|\byes bank\b|\bfederal\b|\bunion bank\b|\bboi\b|\buco\b|\bod a\/c\b|\bcc a\/c\b/;
  function guessGroup(name, role) {
    var k = key(name);
    if (role === 'debtor') return 'Sundry Debtors';
    if (role === 'creditor') return 'Sundry Creditors';
    if (role === 'sales') return 'Sales Accounts';
    if (role === 'purchase') return 'Purchase Accounts';
    if (role === 'tax') return 'Duties & Taxes';
    if (/^cash\b|cash in hand|petty cash/.test(k)) return 'Cash-in-Hand';
    if (/\b(od|o\/d|overdraft|cash credit)\b/.test(k) && BANKW.test(k)) return 'Bank OD A/c';
    if (BANKW.test(k)) return 'Bank Accounts';
    if (/\b(cgst|sgst|utgst|igst|gst|cess|tds|tcs|vat|duty|duties)\b/.test(k)) return 'Duties & Taxes';
    if (/round ?off|rounding/.test(k)) return 'Indirect Expenses';
    if (/\b(sale|sales)\b/.test(k)) return 'Sales Accounts';
    if (/\b(purchase|purchases)\b/.test(k)) return 'Purchase Accounts';
    if (/payable|outstanding|provision/.test(k)) return 'Current Liabilities';
    if (/(rent|interest|commission|discount|dividend|incentive).*(received|income|earned)|income$|other income/.test(k)) return 'Indirect Incomes';
    if (/freight inward|carriage inward|cartage inward|wages|factory|power and fuel|labour charges|job work charges|manufacturing/.test(k)) return 'Direct Expenses';
    if (/rent|salary|salaries|electricity|power|telephone|mobile|internet|freight|carriage|cartage|transport|repair|printing|stationery|travel|conveyance|office|advertis|bank charges|charges|commission|audit|professional|legal|insurance|depreciation|expense|expenses|fees|postage|courier|staff|welfare|donation|maintenance|interest/.test(k)) return 'Indirect Expenses';
    if (/capital|drawings?/.test(k)) return 'Capital Account';
    if (/loan|borrow/.test(k)) return 'Loans (Liability)';
    if (/furniture|machinery|computer|vehicle|building|plant|equipment|land|laptop|printer|car\b/.test(k)) return 'Fixed Assets';
    if (/advance|deposit|prepaid/.test(k)) return 'Loans & Advances (Asset)';
    return '';
  }
  function moneyLed(s, opts) {   /* the cash or bank ledger of a receipt / payment from the "Cash or bank" cell */
    var v = t(s), k = key(v);
    if (!v || /^(cash|by cash|cash a\/c|in cash)$/.test(k)) return opts.cash || 'Cash';
    if (/^(bank|upi|neft|rtgs|imps|cheque|chq|card|online|net banking|transfer|dd|gpay|phonepe|paytm|google pay)$/.test(k)) return opts.bank || 'Bank';
    return v;
  }

  /* ---------- rows of a sheet -> clean rows ---------- */
  /* rows: the sheet's rows; L: NSTpl.pick() result (row, map); sheet: name for messages; def: the voucher type for rows that have none */
  function fromSheet(rows, L, sheet, def) {
    var out = [], prev = null;
    L = fixLayout(L);
    for (var r = L.row + 1; r < rows.length; r++) {
      var row = rows[r] || [], o = { _r: r + 1, _s: sheet }, any = false;
      Object.keys(L.map).forEach(function (f) { var v = t(row[L.map[f]]); o[f] = v; if (v) any = true; });
      if (!any) continue;
      /* a "Total" / "Grand Total" line at the bottom of a register: not an entry */
      if (!TP.date(o.date) && /^(grand total|total|sub ?total|closing balance|opening balance|carried over|brought forward|c\/o|b\/f)\b/.test(key(o.no || o.party || o.ledger || o.vtype || o.date || ''))) continue;
      o.vt = vtype(o.vtype) || (has(o, 'vtype') ? '' : def || '');
      o.badType = has(o, 'vtype') && !vtype(o.vtype);
      /* a line under the first line of a voucher: no date, no number, no type */
      o.cont = !!prev && !has(o, 'date') && !has(o, 'no') && !has(o, 'vtype');
      out.push(o); prev = o;
    }
    return out;
  }
  /* a register's "Rate" next to taxes and no Qty is the GST rate, not a price per unit (GSTR-1 style registers) */
  function fixLayout(L) {
    var m = L.map || {};
    if ('rate' in m && !('qty' in m) && !('gst' in m) && ('cgst' in m || 'igst' in m || 'taxable' in m || 'total' in m)) { m = Object.assign({}, m); m.gst = m.rate; delete m.rate; L = Object.assign({}, L, { map: m }); }
    return L;
  }
  /* which voucher type a sheet holds when it has no type column: from the sheet or file name */
  function typeFromName(s) { return vtype(String(s || '').replace(/register|report|book|list|data|export|sheet|\d+/gi, ' ')); }

  /* ---------- rows -> vouchers, with every problem ----------
     opts: { state: company GST state code, fy: first year of the Tally company's financial year (2026 = 1 Apr 2026 to 31 Mar 2027) or '',
     byRate: GST and sales/purchase ledgers per rate, round: round each bill to the rupee when no total is given, stock: item invoices,
     led: { sales, purchase, cash, bank, round } own names, today: 'YYYY-MM-DD' } */
  function build(rows, opts) {
    opts = opts || {};
    var L = { sales: 'Sales', purchase: 'Purchase', cash: 'Cash', bank: 'Bank', round: 'Round Off' };
    Object.keys(opts.led || {}).forEach(function (k) { if (t(opts.led[k])) L[k] = t(opts.led[k]); });
    var mo = { cash: L.cash, bank: L.bank };
    var groups = [], byKey = {}, probs = [];
    function prob(o, lvl, code, v) { probs.push({ sheet: o._s, r: o._r, lvl: lvl, code: code, v: v || {} }); }
    /* 1. group the rows into vouchers */
    (rows || []).forEach(function (o) {
      if (o.badType) { prob(o, 'err', 'type', { t: o.vtype }); return; }
      var cur = groups[groups.length - 1];
      if (o.cont && cur && !cur.dead) { cur.rows.push(o); return; }
      if (!o.vt) { prob(o, 'err', 'notype'); return; }
      var d = TP.date(o.date);
      if (!d) { prob(o, 'err', has(o, 'date') ? 'date' : 'nodate', { d: o.date }); groups.push({ dead: true, rows: [o] }); return; }
      var k = has(o, 'no') ? o.vt + '|' + key(o.no) + '|' + d : '';
      if (k && byKey[k]) { byKey[k].rows.push(o); return; }
      var g = { vt: o.vt, no: t(o.no), date: d, rows: [o] }; groups.push(g); if (k) byKey[k] = g;
    });
    /* 2. each voucher -> ledger lines (Dr positive) */
    var V = [], ledgers = {}, items = {}, seenNo = {};
    function led(name, role, o) {
      name = t(name); if (!name) return '';
      var k = key(name), l = ledgers[k];
      if (!l) l = ledgers[k] = { name: name, role: role || '', group: '', rows: 0, spell: {} };
      if (role && l.role && role !== l.role && /^(debtor|creditor)$/.test(role) && /^(debtor|creditor)$/.test(l.role)) l.both = 1;
      if (role && (!l.role || l.role === 'other' && role !== 'other')) l.role = role;
      l.rows++; if (name !== l.name) l.spell[name] = 1;
      return l.name;
    }
    groups.forEach(function (g) {
      if (g.dead) return;
      var o0 = g.rows[0], errs = 0;
      function err(o, code, v) { prob(o, 'err', code, v); errs++; }
      function warn(o, code, v) { prob(o, 'warn', code, v); }
      /* financial year of the Tally company */
      if (opts.fy) { var f0 = opts.fy + '-04-01', f1 = (+opts.fy + 1) + '-03-31'; if (g.date < f0 || g.date > f1) err(o0, 'fy', { d: g.date, fy: opts.fy + '-' + String(+opts.fy + 1).slice(2) }); }
      if (opts.today && g.date > opts.today) warn(o0, 'future', { d: g.date });
      if (g.no) { var dk = g.vt + '|' + key(g.no); if (seenNo[dk] && seenNo[dk] !== g.date) warn(o0, 'dupno', { no: g.no }); seenNo[dk] = g.date; }
      var v = { type: g.vt, no: g.no, date: g.date, party: '', lines: [], inv: [], bill: null, lbills: {}, narr: '', rows: g.rows.map(function (o) { return o._r; }), sheet: o0._s, r: o0._r, gst: { cgst: 0, sgst: 0, igst: 0, cess: 0, taxable: 0 } };
      v.narr = g.rows.map(function (o) { return t(o.narr); }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }).join('; ').slice(0, 500);
      var lineMode = g.rows.some(function (o) { return has(o, 'dr') || has(o, 'cr') || has(o, 'drcr') && has(o, 'amt'); }) && !g.rows.some(function (o) { return has(o, 'taxable') || has(o, 'qty') || has(o, 'cgst') || has(o, 'igst'); });
      var add = function (name, val, extra) { if (!name || !r2(val)) return; var l = { a: name, v: r2(val) }; if (extra) Object.keys(extra).forEach(function (k) { l[k] = extra[k]; }); v.lines.push(l); };
      if (lineMode || g.vt === 'Journal') {
        /* ---- ledger lines as given (journal, Tally day book style) ---- */
        g.rows.forEach(function (o) {
          var nm = t(o.ledger) || t(o.party), dv = num(o.dr), cv = num(o.cr), a = num(o.amt);
          if (!dv && !cv && a) { var s = key(o.drcr); if (/^(dr|debit|d|by)$/.test(s)) dv = a; else if (/^(cr|credit|c|to)$/.test(s)) cv = a; else { err(o, 'drcr'); return; } }
          if (!dv && !cv) { if (nm) err(o, 'noamt'); return; }
          if (!nm) { err(o, 'noled'); return; }
          var role = 'other';
          if (key(nm) === key(L.cash) || /^cash\b/.test(key(nm))) role = 'cash'; else if (BANKW.test(key(nm))) role = 'bank';
          var name = led(nm, role, o);
          if (dv) add(name, Math.abs(dv) * (dv < 0 ? -1 : 1)); if (cv) add(name, -Math.abs(cv) * (cv < 0 ? -1 : 1));
          if (has(o, 'against') && role === 'other') v.lbills[name] = [{ type: 'Agst Ref', name: t(o.against) }];
        });
        /* the party of a receipt / payment / sale written as lines: the line that is not cash, bank, tax or sales */
        var other = v.lines.filter(function (l) { var r = ledgers[key(l.a)].role; return r !== 'cash' && r !== 'bank'; });
        if (g.vt === 'Receipt') other.forEach(function (l) { if (l.v < 0 && !ledgers[key(l.a)].group && !guessGroup(l.a)) ledgers[key(l.a)].role = 'debtor'; });
        if (g.vt === 'Payment') other.forEach(function (l) { if (l.v > 0 && !guessGroup(l.a)) ledgers[key(l.a)].role = 'creditor'; });
        if (g.vt === 'Contra' && other.length) warn(o0, 'contra');
        if (/^(Receipt|Payment|Contra)$/.test(g.vt) && !v.lines.some(function (l) { var r = ledgers[key(l.a)].role; return r === 'cash' || r === 'bank'; })) warn(o0, 'nomoney');
        v.party = (other[0] && other[0].a) || '';
      } else if (INVTYPE[g.vt]) {
        /* ---- a bill or note: party, sales / purchase ledger, GST, round off, items ---- */
        var k = INVTYPE[g.vt], buy = g.vt === 'Purchase' || g.vt === 'Debit Note';
        var party = t(o0.party) || t(g.rows.map(function (o) { return o.party; }).filter(Boolean)[0]);
        var gstin = (g.rows.map(function (o) { return t(o.gstin).toUpperCase().replace(/\s/g, ''); }).filter(Boolean)[0]) || '';
        if (!party) { if (g.vt === 'Sales') { party = L.cash; warn(o0, 'cashsale'); } else { err(o0, 'noparty'); return; } }
        if (gstin && G.NS && G.NS.gstinCheck && !G.NS.gstinCheck(gstin).ok) warn(o0, 'gstin', { g: gstin });
        else if (gstin && !G.NS && !/^\d{2}[A-Z0-9]{13}$/.test(gstin)) warn(o0, 'gstin', { g: gstin });
        var st = TP.stateCode(g.rows.map(function (o) { return o.state; }).filter(Boolean)[0] || '', gstin);
        if (gstin && has(o0, 'state') && /^\d{2}/.test(gstin) && TP.stateCode(o0.state) && TP.stateCode(o0.state) !== gstin.slice(0, 2) && TP.stateCode(o0.state) !== '96' && TP.stateCode(o0.state) !== '97') warn(o0, 'posgstin', { s: o0.state, g: gstin });
        var intra = opts.state ? (st ? st === opts.state : null) : null;
        var isCash = key(party) === key(L.cash);
        var pname = led(party, isCash ? 'cash' : buy ? 'creditor' : 'debtor', o0); v.party = pname;
        if (gstin && !isCash) { var pl = ledgers[key(pname)]; if (!pl.gstin) pl.gstin = gstin; if (st) pl.state = st; }
        var credits = 0, total = null, tax = { cgst: 0, sgst: 0, igst: 0, cess: 0 }, roundGiven = null;
        g.rows.forEach(function (o, i) {
          var q = num(o.qty), rt = num(o.rate), dp = num(o.disc);
          var tv = has(o, 'taxable') ? num(o.taxable) : has(o, 'amt') ? num(o.amt) : q && rt ? r2(q * rt * (1 - dp / 100)) : 0;
          var rate = has(o, 'gst') ? TP.rate(o.gst) : null;
          if (has(o, 'total')) { var tt = num(o.total); if (total == null) total = tt; else if (i > 0 && tt && Math.abs(tt - total) > 0.01) total = r2(total + tt); }
          if (has(o, 'round')) roundGiven = r2((roundGiven || 0) + num(o.round));
          var c = num(o.cgst), s = num(o.sgst), ig = num(o.igst), ce = num(o.cess);
          var given = has(o, 'cgst') || has(o, 'sgst') || has(o, 'igst');
          if (!tv && !c && !s && !ig) { if (!has(o, 'total') && (has(o, 'item') || has(o, 'ledger'))) err(o, 'noamt'); return; }
          if (q && rt && has(o, 'taxable') && Math.abs(r2(q * rt * (1 - dp / 100)) - tv) > 1) warn(o, 'qtyrate', { a: r2(q * rt * (1 - dp / 100)), b: tv });
          if (tv < 0) warn(o, 'minus');
          if (!given && rate != null) {   /* GST worked out from the rate */
            var all = r2(tv * rate / 100), same = intra !== false;
            if (rate && intra === null) warn(o, 'nostate');
            if (same) { c = r2(all / 2); s = r2(all - c); } else ig = all;
          } else if (given) {
            if ((c || s) && Math.abs(c - s) > 0.05) err(o, 'cgsgst', { c: c, s: s });
            if ((c || s) && ig) err(o, 'both');
            if (intra === true && ig) warn(o, 'igstin');
            if (intra === false && (c || s)) warn(o, 'cgstout');
            if (rate != null && tv) { var want = r2(tv * rate / 100), got = r2(c + s + ig); if (Math.abs(want - got) > 1) warn(o, 'taxrate', { r: rate, w: want, g: got }); }
          }
          if (rate == null && tv && (c || s || ig)) rate = TP.rate(r2((c + s + ig) / tv * 100));
          if (rate != null && TP.RATES.indexOf(rate) < 0) warn(o, 'oddrate', { r: rate });
          /* the ledger of the line */
          var lname = t(o.ledger);
          if (!lname) lname = opts.byRate ? (buy ? L.purchase : L.sales) + (rate ? ' GST ' + rate + '%' : rate === 0 ? ' Exempt' : '') : buy ? L.purchase : L.sales;
          var lrole = guessGroup(lname, '') === 'Sales Accounts' ? 'sales' : guessGroup(lname, '') === 'Purchase Accounts' ? 'purchase' : t(o.ledger) ? 'other' : buy ? 'purchase' : 'sales';
          lname = led(lname, lrole, o);
          var item = t(o.item);
          if (opts.stock && item && q) {
            var unit = t(o.unit) || 'Nos', ik = key(item), it = items[ik];
            if (!it) it = items[ik] = { name: item, unit: unit, hsn: t(o.hsn), gst: rate, rows: 0 };
            it.rows++; if (!it.hsn && has(o, 'hsn')) it.hsn = t(o.hsn);
            if (key(it.unit) !== key(unit)) warn(o, 'unit', { i: item, a: it.unit, b: unit });
            v.inv.push({ item: it.name, qty: Math.abs(q), unit: it.unit, rate: rt || r2(tv / q), amt: r2(tv), led: lname, v: r2(-k * tv) });
          } else add(lname, -k * tv);
          credits = r2(credits + tv);
          tax.cgst = r2(tax.cgst + c); tax.sgst = r2(tax.sgst + s); tax.igst = r2(tax.igst + ig); tax.cess = r2(tax.cess + ce);
          v.gst.taxable = r2(v.gst.taxable + tv);
          if (c || s || ig) { var rk = opts.byRate && rate ? rate : ''; ['cgst', 'sgst', 'igst'].forEach(function (h) { var val = h === 'cgst' ? c : h === 'sgst' ? s : ig; if (!val) return; var nm = taxName(h, buy, rk); add(led(nm, 'tax', o), -k * val); }); }
          if (ce) add(led(taxName('cess', buy, ''), 'tax', o), -k * ce);
        });
        v.gst.cgst = tax.cgst; v.gst.sgst = tax.sgst; v.gst.igst = tax.igst; v.gst.cess = tax.cess;
        var sum = r2(credits + tax.cgst + tax.sgst + tax.igst + tax.cess);
        if (!sum && total == null) { err(o0, 'noamt'); return; }
        var ro = 0;
        if (total != null && total) {
          ro = r2(total - sum - (roundGiven || 0));
          if (roundGiven) ro = r2(ro + roundGiven);
          if (Math.abs(ro) > 1) { err(o0, 'total', { t: total, s: r2(sum + (roundGiven || 0)) }); return; }
        } else if (roundGiven != null) ro = roundGiven;
        else if (opts.round) ro = r2(Math.round(sum) - sum);
        if (Math.abs(ro) > 1) warn(o0, 'bigro', { v: ro });
        if (ro) add(led(L.round, 'round', o0), -k * ro);
        var tot = r2(sum + ro);
        /* the party line comes first, as in Tally */
        v.lines.unshift({ a: pname, v: r2(k * tot), party: 1 });
        v.total = tot;
        if (!isCash) {
          var ag = t(g.rows.map(function (o) { return o.against; }).filter(Boolean)[0]);
          v.bill = /^(Sales|Purchase)$/.test(g.vt) ? [{ type: 'New Ref', name: g.no || '' }] : ag ? [{ type: 'Agst Ref', name: ag }] : [{ type: 'On Account', name: '' }];
          if (/^(Sales|Purchase)$/.test(g.vt) && !g.no) { v.bill = [{ type: 'On Account', name: '' }]; warn(o0, 'nobillno'); }
        }
        if (v.inv.length && v.lines.some(function (l, i) { return i > 0 && ledgers[key(l.a)] && /^(sales|purchase|other)$/.test(ledgers[key(l.a)].role); })) v.mixed = 1;
      } else {
        /* ---- receipt, payment, contra: one row per party line (or per amount) ---- */
        var pay = g.vt === 'Payment';
        g.rows.forEach(function (o) {
          var a = has(o, 'amt') ? num(o.amt) : has(o, 'total') ? num(o.total) : has(o, 'taxable') ? num(o.taxable) : 0;
          if (!a) { err(o, 'noamt'); return; }
          var nm = t(o.party) || t(o.ledger);
          if (!nm) { err(o, g.vt === 'Contra' ? 'nocontra' : 'noparty'); return; }
          var money = moneyLed(o.mode, mo), mrole = key(money) === key(L.cash) || /^cash\b/.test(key(money)) ? 'cash' : 'bank';
          var role = g.vt === 'Contra' ? (/^cash\b/.test(key(nm)) || key(nm) === key(L.cash) ? 'cash' : 'bank') : t(o.party) ? (pay ? 'creditor' : 'debtor') : 'other';
          if (role !== 'cash' && role !== 'bank' && t(o.ledger) && !t(o.party)) role = 'other';
          if (g.vt === 'Contra' && key(nm) === key(money)) { err(o, 'samecontra'); return; }
          var name = led(nm, role, o), mname = led(money, mrole, o);
          /* Receipt: money in (cash/bank Dr), party Cr. Payment: party Dr, money Cr. Contra: the account named Dr, the cash / bank column Cr */
          var dIn = g.vt === 'Receipt' ? mname : name, dOut = g.vt === 'Receipt' ? name : mname;
          add(dIn, Math.abs(a)); add(dOut, -Math.abs(a));
          if (a < 0) warn(o, 'minus');
          if ((role === 'debtor' || role === 'creditor') && g.vt !== 'Contra') { var b = has(o, 'against') ? { type: 'Agst Ref', name: t(o.against), amt: Math.abs(a) } : { type: 'On Account', name: '', amt: Math.abs(a) }; (v.lbills[name] = v.lbills[name] || []).push(b); }
          if (!v.party && role !== 'cash' && role !== 'bank') v.party = name;
        });
      }
      if (errs) return;
      v.lines = net(v.lines);
      var dr = 0, cr = 0; v.lines.forEach(function (l) { if (l.v > 0) dr = r2(dr + l.v); else cr = r2(cr - l.v); }); v.inv.forEach(function (e) { if (e.v > 0) dr = r2(dr + e.v); else cr = r2(cr - e.v); });
      if (!v.lines.length && !v.inv.length) { prob(o0, 'err', 'noamt'); return; }
      if (Math.abs(dr - cr) > 0.005) { prob(o0, 'err', 'unbal', { d: dr, c: cr }); return; }
      if (v.lines.length + v.inv.length < 2) { prob(o0, 'err', 'oneline'); return; }
      v.amount = dr;
      V.push(v);
    });
    Object.keys(ledgers).forEach(function (k) { var l = ledgers[k]; l.group = guessGroup(l.name, l.role) || (l.role === 'cash' ? 'Cash-in-Hand' : l.role === 'bank' ? 'Bank Accounts' : l.role === 'round' ? 'Indirect Expenses' : ''); l.guessed = !!l.group; if (Object.keys(l.spell).length) l.spellings = Object.keys(l.spell); });
    return { vouchers: V, ledgers: ledgers, items: items, probs: probs, rows: (rows || []).length };
  }
  function taxName(h, buy, rate) {
    var base = (buy ? 'Input ' : 'Output ') + (h === 'cess' ? 'Cess' : h.toUpperCase());
    return rate ? base + ' ' + (h === 'igst' ? rate : r2(rate / 2)) + '%' : base;
  }
  /* the same ledger twice on one voucher becomes one line (but never the party line of a bill) */
  function net(lines) {
    var out = [], at = {};
    lines.forEach(function (l) { var k = key(l.a) + (l.party ? '|p' : ''); if (k in at) out[at[k]].v = r2(out[at[k]].v + l.v); else { at[k] = out.length; out.push(Object.assign({}, l)); } });
    return out.filter(function (l) { return l.v; });
  }

  /* ---------- the ledgers of a Tally masters export (NSTallyIn.collect result) ---------- */
  function tallyMasters(M) {
    var L = {}, I = {}, gr = {};
    Object.keys((M && M.groups) || {}).forEach(function (k) { gr[k] = M.groups[k].name; });
    function top(g) { var seen = {}, k = key(g); while (k && !seen[k]) { seen[k] = 1; var p = M.groups && M.groups[k]; if (!p || !p.parent || key(p.parent) === 'primary') return p ? p.name : g; k = key(p.parent); } return g; }
    Object.keys((M && M.ledgers) || {}).forEach(function (k) { var l = M.ledgers[k]; L[k] = { name: l.name, group: l.parent || '', top: top(l.parent || '') }; });
    Object.keys((M && M.items) || {}).forEach(function (k) { I[k] = { name: M.items[k].name, unit: M.items[k].unit }; });
    return { ledgers: L, items: I, groups: Object.keys(gr).map(function (k) { return gr[k]; }), company: (M && M.company) || '' };
  }
  /* a file ledger name -> the Tally ledger with the same letters (case, spaces, dots, & / and ignored) */
  function loose(s) { return key(s).replace(/&/g, ' and ').replace(/\b(a\/c|ac|account)\b/g, '').replace(/[^a-z0-9]/g, ''); }
  function autoMap(R, T, saved) {
    var map = {}, idx = {};
    Object.keys((T && T.ledgers) || {}).forEach(function (k) { idx[loose(T.ledgers[k].name)] = T.ledgers[k]; });
    Object.keys(R.ledgers).forEach(function (k) {
      var l = R.ledgers[k], s = saved && saved[k], to = s && s.to ? s.to : '', hit = null;
      if (to && T && T.ledgers[key(to)]) hit = T.ledgers[key(to)];
      if (!to) { hit = (T && T.ledgers[k]) || idx[loose(l.name)] || null; to = hit ? hit.name : l.name; }
      /* every new Tally company already has a ledger "Cash" (Cash-in-Hand) */
      map[k] = { to: to, group: hit ? hit.group : (s && s.group) || l.group || '', exists: !!hit || !!(s && s.exists && !T) || !s && !T && k === 'cash', fromTally: !!hit };
    });
    return map;
  }
  function itemMap(R, T) {
    var map = {}; Object.keys(R.items).forEach(function (k) { var hit = T && T.items && (T.items[k] || Object.keys(T.items).map(function (x) { return T.items[x]; }).filter(function (x) { return loose(x.name) === loose(R.items[k].name); })[0]); map[k] = { to: hit ? hit.name : R.items[k].name, exists: !!hit }; }); return map;
  }

  /* ---------- the XML ---------- */
  function x(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]; }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
  function amt(v) { return (v < 0 ? '-' : '') + Math.abs(v).toFixed(2); }
  function ymd(iso) { return String(iso || '').replace(/-/g, '').slice(0, 8); }
  function envelope(report, body) {
    return '<ENVELOPE>\n<HEADER>\n <TALLYREQUEST>Import Data</TALLYREQUEST>\n</HEADER>\n<BODY>\n<IMPORTDATA>\n <REQUESTDESC>\n  <REPORTNAME>' + report + '</REPORTNAME>\n </REQUESTDESC>\n <REQUESTDATA>\n  <TALLYMESSAGE xmlns:UDF="TallyUDF">\n' +
      body + '  </TALLYMESSAGE>\n </REQUESTDATA>\n</IMPORTDATA>\n</BODY>\n</ENVELOPE>\n';
  }
  function nameOf(map, n) { var m = map && map[key(n)]; return m && t(m.to) ? t(m.to) : n; }
  /* masters: only what is not in the Tally company yet (map[k].exists) */
  function mastersXml(R, map, imap, vs) {
    var used = {}, iu = {};
    (vs || R.vouchers).forEach(function (v) { v.lines.forEach(function (l) { used[key(l.a)] = 1; }); v.inv.forEach(function (e) { used[key(e.led)] = 1; iu[key(e.item)] = 1; }); });
    var out = [], units = {}, done = {};
    Object.keys(R.items).forEach(function (k) {
      if (!iu[k] || imap && imap[k] && imap[k].exists) return;
      var it = R.items[k]; if (!units[key(it.unit)]) { units[key(it.unit)] = 1; out.push('   <UNIT NAME="' + x(it.unit) + '" ACTION="Create">\n    <NAME>' + x(it.unit) + '</NAME>\n    <ISSIMPLEUNIT>Yes</ISSIMPLEUNIT>\n   </UNIT>\n'); }
    });
    Object.keys(R.items).forEach(function (k) {
      if (!iu[k] || imap && imap[k] && imap[k].exists) return;
      var it = R.items[k], nm = imap && imap[k] ? t(imap[k].to) || it.name : it.name;
      out.push('   <STOCKITEM NAME="' + x(nm) + '" ACTION="Create">\n    <NAME>' + x(nm) + '</NAME>\n    <PARENT></PARENT>\n    <BASEUNITS>' + x(it.unit) + '</BASEUNITS>\n   </STOCKITEM>\n');
    });
    Object.keys(R.ledgers).forEach(function (k) {
      var l = R.ledgers[k], m = map && map[k] || {}; if (!used[k] || m.exists) return;
      var nm = t(m.to) || l.name; if (done[key(nm)]) return; done[key(nm)] = 1;
      var grp = t(m.group) || l.group || 'Suspense A/c', party = /^Sundry (Debtors|Creditors)$/.test(grp);
      out.push('   <LEDGER NAME="' + x(nm) + '" ACTION="Create">\n    <NAME>' + x(nm) + '</NAME>\n    <PARENT>' + x(grp) + '</PARENT>\n' +
        (party ? '    <ISBILLWISEON>Yes</ISBILLWISEON>\n' : '') + (party && l.state && l.state !== '96' && G.NS && G.NS.stateName ? '    <COUNTRYNAME>India</COUNTRYNAME>\n    <LEDSTATENAME>' + x(G.NS.stateName(l.state)) + '</LEDSTATENAME>\n' : '') + '   </LEDGER>\n');
    });
    return envelope('All Masters', out.join(''));
  }
  function billsXml(bl, v) {
    var left = Math.abs(v);
    return (bl || []).map(function (b, i, all) {
      var a = i === all.length - 1 ? left : b.amt != null ? Math.min(b.amt, left) : left; left = r2(left - a);
      return a > 0 ? '     <BILLALLOCATIONS.LIST>\n      <NAME>' + x(b.name) + '</NAME>\n      <BILLTYPE>' + b.type + '</BILLTYPE>\n      <AMOUNT>' + amt(v > 0 ? -a : a) + '</AMOUNT>\n     </BILLALLOCATIONS.LIST>\n' : '';
    }).join('');
  }
  function vouchersXml(R, map, imap, vs, o) {
    o = o || {}; var bills = o.bills !== false;
    return envelope('Vouchers', (vs || R.vouchers).map(function (v) {
      var inv = v.inv.length > 0, view = inv ? 'Invoice Voucher View' : 'Accounting Voucher View', tag = inv ? 'LEDGERENTRIES.LIST' : 'ALLLEDGERENTRIES.LIST';
      var pty = v.lines.filter(function (l) { return l.party; })[0];
      return '   <VOUCHER VCHTYPE="' + x(v.type) + '" ACTION="Create" OBJVIEW="' + view + '">\n    <DATE>' + ymd(v.date) + '</DATE>\n    <VOUCHERTYPENAME>' + x(v.type) + '</VOUCHERTYPENAME>\n' +
        (v.no ? '    <VOUCHERNUMBER>' + x(v.no) + '</VOUCHERNUMBER>\n' : '') + (pty ? '    <PARTYLEDGERNAME>' + x(nameOf(map, pty.a)) + '</PARTYLEDGERNAME>\n' : '') +
        '    <PERSISTEDVIEW>' + view + '</PERSISTEDVIEW>\n    <ISINVOICE>' + (inv ? 'Yes' : 'No') + '</ISINVOICE>\n' +
        (v.narr ? '    <NARRATION>' + x(v.narr) + '</NARRATION>\n' : '') +
        v.lines.map(function (l) {
          var dr = l.v > 0, R0 = R.ledgers[key(l.a)] || {}, isParty = !!l.party || /^(debtor|creditor)$/.test(R0.role) || /^Sundry (Debtors|Creditors)$/.test((map && map[key(l.a)] || {}).group || '');
          var bl = l.party ? v.bill : v.lbills[l.a];
          return '    <' + tag + '>\n     <LEDGERNAME>' + x(nameOf(map, l.a)) + '</LEDGERNAME>\n     <ISDEEMEDPOSITIVE>' + (dr ? 'Yes' : 'No') + '</ISDEEMEDPOSITIVE>\n' +
            (isParty ? '     <ISPARTYLEDGER>Yes</ISPARTYLEDGER>\n' : '') + '     <AMOUNT>' + amt(-l.v) + '</AMOUNT>\n' + (bills && isParty && bl ? billsXml(bl, l.v) : '') + '    </' + tag + '>\n';
        }).join('') +
        v.inv.map(function (e) {
          var dr = e.v > 0, q = ' ' + String(+e.qty.toFixed(3)) + ' ' + x(e.unit), a = amt(-e.v), nm = imap && imap[key(e.item)] ? t(imap[key(e.item)].to) || e.item : e.item;
          return '    <ALLINVENTORYENTRIES.LIST>\n     <STOCKITEMNAME>' + x(nm) + '</STOCKITEMNAME>\n     <ISDEEMEDPOSITIVE>' + (dr ? 'Yes' : 'No') + '</ISDEEMEDPOSITIVE>\n' +
            '     <RATE>' + (+e.rate).toFixed(2) + '/' + x(e.unit) + '</RATE>\n     <AMOUNT>' + a + '</AMOUNT>\n     <ACTUALQTY>' + q + '</ACTUALQTY>\n     <BILLEDQTY>' + q + '</BILLEDQTY>\n' +
            '     <BATCHALLOCATIONS.LIST>\n      <GODOWNNAME>Main Location</GODOWNNAME>\n      <BATCHNAME>Primary Batch</BATCHNAME>\n      <AMOUNT>' + a + '</AMOUNT>\n      <ACTUALQTY>' + q + '</ACTUALQTY>\n      <BILLEDQTY>' + q + '</BILLEDQTY>\n     </BATCHALLOCATIONS.LIST>\n' +
            '     <ACCOUNTINGALLOCATIONS.LIST>\n      <LEDGERNAME>' + x(nameOf(map, e.led)) + '</LEDGERNAME>\n      <ISDEEMEDPOSITIVE>' + (dr ? 'Yes' : 'No') + '</ISDEEMEDPOSITIVE>\n      <AMOUNT>' + a + '</AMOUNT>\n     </ACCOUNTINGALLOCATIONS.LIST>\n    </ALLINVENTORYENTRIES.LIST>\n';
        }).join('') + '   </VOUCHER>\n';
    }).join(''));
  }

  /* ---------- the check list (Excel) and the blank sheet ---------- */
  function checkSheet(R, words) {
    var w = words || function (c) { return c; };
    var head = [['Sheet', 'Row', 'Error or warning', 'What to fix']];
    return head.concat(R.probs.map(function (p) { return [p.sheet || '', p.r, p.lvl === 'err' ? 'Error' : 'Warning', w(p.code, p.v)]; }));
  }
  function voucherSheet(R, map) {
    var rows = [['Date', 'Voucher type', 'Voucher no', 'Party', 'Amount', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Lines', 'Rows in the file']];
    R.vouchers.forEach(function (v) { rows.push([v.date, v.type, v.no, v.party ? nameOf(map, v.party) : '', v.amount, v.gst.taxable || '', v.gst.cgst || '', v.gst.sgst || '', v.gst.igst || '', v.lines.concat(v.inv).length, v.rows.join(', ')]); });
    return rows;
  }
  function blank() {
    var how = [['Column', 'Must fill', 'What to type', 'Example']];
    SET.cols.forEach(function (c) { how.push([c.h, c.need ? 'Yes' : '', c.w, c.ex]); });
    how.push(['', '', 'One row per voucher, or one row per line: lines of one voucher repeat its Voucher type, Voucher no and Date (or leave them empty under the first line). Journal lines: Ledger + Debit or Credit.', '']);
    var H = ['Date', 'Voucher type', 'Voucher no', 'Party', 'GSTIN', 'Item', 'Qty', 'Unit', 'Rate', 'Taxable value', 'GST %', 'CGST', 'SGST', 'IGST', 'Round off', 'Bill total', 'Ledger', 'Debit', 'Credit', 'Cash or bank', 'Against bill no', 'Narration'];
    return [['Entries', [H]], ['How to fill', how, [22, 10, 70, 22], 'wrap']];
  }

  /* ---------- sample files (made up; GSTINs carry correct check digits) ---------- */
  var SAMPLES = {
    'Sample sales register (made up).csv': 'Sample Sharma Hardware - Sales register,,,,,,,,,\n,,,,,,,,,\nInvoice Date,Invoice No,Customer Name,GSTIN/UIN,Place of Supply,Taxable Value,Rate,CGST,SGST,IGST,Invoice Value\n' +
      '02-04-2026,SH/26-27/001,Sample Garg Traders,03AAACG1234A1ZO,Punjab,"10,000",18,900,900,,"11,800"\n' +
      '05-04-2026,SH/26-27/002,Sample Delhi Steels Pvt Ltd,07AAACD9999B1ZD,Delhi,"25,000.50",18,,,"4,500.09","29,501"\n' +
      '05-04-2026,SH/26-27/003,Sample Mehta and Sons,,Punjab,"4,200",5,105,105,,"4,410"\n' +
      '09-04-2026,SH/26-27/004,Sample Garg Traders,03AAACG1234A1ZO,Punjab,"8,000",18,720,720,,"9,500"\n' +
      '15-04-2026,SH/26-27/005,,,Punjab,"1,000",18,90,90,,"1,180"\n' +
      ',,,,,,,,,\n,Total,,,,"48,200.50",,"1,815","1,815","4,500.09","56,391"\n',
    'Sample purchase bills with items (made up).csv': 'Bill Date,Supplier Bill No,Supplier,Supplier GSTIN,Item Name,HSN,Qty,UOM,Rate,GST %,Bill Total\n' +
      '03-04-2026,DS/551,Sample Delhi Steels Pvt Ltd,07AAACD9999B1ZD,Sample MS Pipe 1 inch,7306,100,Kgs,80,18,"14,868"\n' +
      ',,,,Sample MS Pipe 2 inch,7306,50,Kgs,92,18,\n' +
      '06-04-2026,KP/88,Sample Kapoor Paints,03AAFFK2222B1Z9,Sample Wall Putty 20kg,3214,10,Bag,450,18,"5,310"\n',
    'Sample receipts and payments (made up).csv': 'Date,Type,Voucher No,Party,Account,Amount,Mode,Against Bill No,Narration\n' +
      '07-04-2026,Receipt,R/1,Sample Garg Traders,,"11,800",HDFC Bank,SH/26-27/001,NEFT UTR 1234\n' +
      '08-04-2026,Payment,P/1,Sample Delhi Steels Pvt Ltd,,"10,000",HDFC Bank,DS/551,Part payment\n' +
      '10-04-2026,Payment,P/2,,Shop Rent,"15,000",Cash,,April rent\n' +
      '10-04-2026,Contra,C/1,HDFC Bank,,"20,000",Cash,,Cash deposited\n' +
      '12-04-2026,Rcpt,R/2,Sample Mehta and Sons,,,Cash,,No amount: shows a row error\n',
    'Sample journal (made up).csv': 'Date,Vch Type,Vch No,Particulars,Debit,Credit,Narration\n' +
      '30-04-2026,Journal,J/1,Depreciation,"4,000",,Monthly depreciation\n,,,Furniture and Fixtures,,"4,000",\n' +
      '30-04-2026,Journal,J/2,Salary,"30,000",,April salary\n,,,Salary Payable,,"29,000",\n,,,TDS Payable,,"1,000",\n'
  };

  var API = { SET: SET, fixLayout: fixLayout, VT: VT, GROUPS: GROUPS, vtype: vtype, typeFromName: typeFromName, guessGroup: guessGroup, fromSheet: fromSheet, build: build, tallyMasters: tallyMasters,
    autoMap: autoMap, itemMap: itemMap, loose: loose, mastersXml: mastersXml, vouchersXml: vouchersXml, checkSheet: checkSheet, voucherSheet: voucherSheet, blank: blank, SAMPLES: SAMPLES, taxName: taxName };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else G.NSXlTally = API;
})(typeof window !== 'undefined' ? window : this);
