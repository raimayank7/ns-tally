/* NSTallyIn: Tally (TallyPrime / Tally.ERP 9) export files -> NSBiz records. Pure, no screen; runs in the App ("Bring data from other
   software") and in Node (tests). Tally's XML is also what Marg, Vyapar, myBillBook, Swipe, Zoho Invoice, Gofrugal, Petpooja, greytHR and
   many more produce for "Export to Tally", so this one reader brings in their users too.

   Files: Tally's "Export > Masters" and "Export > Day Book / Transactions" (XML, UTF-16 or UTF-8), in any number; read together.
   Layout (Tally's own import/export format): ENVELOPE / BODY / (IMPORTDATA / REQUESTDATA | DATA / COLLECTION) / TALLYMESSAGE with
   GROUP, LEDGER, STOCKITEM, UNIT, VOUCHERTYPE masters and VOUCHER records. A voucher's ledger lines are LEDGERENTRIES.LIST /
   ALLLEDGERENTRIES.LIST, and for invoices also ACCOUNTINGALLOCATIONS.LIST inside each ALLINVENTORYENTRIES.LIST / INVENTORYENTRIES.LIST
   (the sales / purchase ledger of that item). AMOUNT: minus = debit, plus = credit (ISDEEMEDPOSITIVE Yes = debit). Ledger OPENINGBALANCE
   uses the same sign. Quantities "2 PCS", rates "50.00/PCS", dates yyyymmdd.

   How it comes into NSBiz (the same way as Evershine, engine/evcore.js):
   - ledgers by their Tally group: Sundry Debtors / Creditors -> parties, Bank Accounts / Bank OD -> banks, Cash-in-Hand -> cash,
     Duties & Taxes -> GST accounts (or other taxes), Sales / Purchase Accounts -> sales / purchases, expenses, incomes, capital,
     loans, fixed assets, current assets and liabilities by prefix. Stock items -> items with HSN, unit and GST rate.
   - Sales, Purchase, Credit Note and Debit Note with item lines -> NSBiz documents with those lines; each posts exactly what Tally
     posted (a small journal beside the bill holds any difference). Every other voucher (Receipt, Payment, Contra, Journal, invoices
     without items, custom types) -> a journal of Tally's own ledger lines. Orders, delivery / receipt notes, memoranda, optional and
     cancelled vouchers post nothing in Tally and are left out (counted).
   - ledger and stock item opening balances -> NSBiz openings on the first day.
   Every record carries src = { sw: 'tally', co, id }: a second run brings only what is new. */
(function (G) {
  'use strict';
  function key(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function r2(n) { return Math.round((+n + Number.EPSILON) * 100) / 100; }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; }
  function t(s) { return String(s == null ? '' : s).trim(); }

  /* ---------- reading the files ---------- */
  /* bytes -> text: UTF-16 (Tally's default) or UTF-8, with or without a byte order mark */
  function decode(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var enc = 'utf-8', start = 0;
    if (b[0] === 0xFF && b[1] === 0xFE) { enc = 'utf-16le'; start = 2; }
    else if (b[0] === 0xFE && b[1] === 0xFF) { enc = 'utf-16be'; start = 2; }
    else if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) start = 3;
    else if (b.length > 3 && b[1] === 0 && b[3] === 0) enc = 'utf-16le';
    else if (b.length > 3 && b[0] === 0 && b[2] === 0) enc = 'utf-16be';
    return new TextDecoder(enc).decode(b.subarray(start));
  }
  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  function unent(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
      if (e[0] === '#') { var c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return c < 32 && c !== 9 && c !== 10 && c !== 13 ? '' : String.fromCodePoint(c); }
      return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m;
    });
  }
  /* a small, forgiving XML reader (Tally writes control characters as &#4; and the like, which strict parsers refuse):
     -> { n: name, a: {attrs}, c: [children], x: text } */
  function parse(text) {
    var root = { n: '#root', a: {}, c: [], x: '' }, stack = [root], i = 0, L = text.length;
    while (i < L) {
      var lt = text.indexOf('<', i);
      if (lt < 0) break;
      if (lt > i) { var top = stack[stack.length - 1]; top.x += unent(text.slice(i, lt)); }
      if (text.startsWith('<!--', lt)) { var e1 = text.indexOf('-->', lt + 4); i = e1 < 0 ? L : e1 + 3; continue; }
      if (text.startsWith('<![CDATA[', lt)) { var e2 = text.indexOf(']]>', lt + 9); stack[stack.length - 1].x += text.slice(lt + 9, e2 < 0 ? L : e2); i = e2 < 0 ? L : e2 + 3; continue; }
      if (text[lt + 1] === '?' || text[lt + 1] === '!') { var e3 = text.indexOf('>', lt); i = e3 < 0 ? L : e3 + 1; continue; }
      var gt = text.indexOf('>', lt); if (gt < 0) break;
      var tag = text.slice(lt + 1, gt);
      if (tag[0] === '/') { var nm = tag.slice(1).trim(); for (var s = stack.length - 1; s > 0; s--) if (stack[s].n === nm) { stack.length = s; break; } i = gt + 1; continue; }
      var self = /\/\s*$/.test(tag); if (self) tag = tag.replace(/\/\s*$/, '');
      var m = tag.match(/^([^\s]+)/), node = { n: m ? m[1] : tag, a: {}, c: [], x: '' };
      tag.replace(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, function (_, k, __, v1, v2) { node.a[k] = unent(v1 != null ? v1 : v2); return ''; });
      stack[stack.length - 1].c.push(node);
      if (!self) stack.push(node);
      i = gt + 1;
    }
    return root;
  }
  function kid(n, name) { for (var i = 0; i < (n.c || []).length; i++) if (n.c[i].n === name) return n.c[i]; return null; }
  function kids(n, name) { return (n.c || []).filter(function (c) { return c.n === name; }); }
  function val(n, name) { var k = kid(n, name); return k ? t(k.x) : ''; }
  function walk(n, fn) { fn(n); (n.c || []).forEach(function (c) { walk(c, fn); }); }
  function ymd(s) { s = t(s); return /^\d{8}$/.test(s) ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6) : ''; }
  function nameOf(n) { return t(n.a.NAME) || val(n, 'NAME') || (kid(n, 'NAME.LIST') ? val(kid(n, 'NAME.LIST'), 'NAME') : ''); }
  /* "2 PCS" -> { q: 2, u: 'PCS' }; "50.00/PCS" -> 50 */
  function qty(s) { var m = t(s).match(/^(-?[\d.,]+)\s*(.*)$/); return m ? { q: Math.abs(num(m[1])), u: t(m[2]).split(/\s+/)[0] } : { q: 0, u: '' }; }
  function rate(s) { return Math.abs(num(t(s).split('/')[0])); }

  /* ---------- Indian states: name -> GST code (Tally keeps the state name) ---------- */
  var STATES = { 'jammu and kashmir': '01', 'himachal pradesh': '02', 'punjab': '03', 'chandigarh': '04', 'uttarakhand': '05', 'haryana': '06', 'delhi': '07', 'rajasthan': '08',
    'uttar pradesh': '09', 'bihar': '10', 'sikkim': '11', 'arunachal pradesh': '12', 'nagaland': '13', 'manipur': '14', 'mizoram': '15', 'tripura': '16', 'meghalaya': '17', 'assam': '18',
    'west bengal': '19', 'jharkhand': '20', 'odisha': '21', 'orissa': '21', 'chhattisgarh': '22', 'madhya pradesh': '23', 'gujarat': '24', 'dadra and nagar haveli and daman and diu': '26',
    'daman and diu': '26', 'dadra and nagar haveli': '26', 'maharashtra': '27', 'karnataka': '29', 'goa': '30', 'lakshadweep': '31', 'kerala': '32', 'tamil nadu': '33', 'puducherry': '34',
    'pondicherry': '34', 'andaman and nicobar islands': '35', 'telangana': '36', 'andhra pradesh': '37', 'ladakh': '38', 'other territory': '97' };
  function stateCode(s) { s = key(s).replace(/&/g, 'and'); return STATES[s] || (/^\d\d$/.test(s) ? s : ''); }

  /* ---------- reading Tally's files, piece by piece ----------
     A working company's day book is often hundreds of MB. Each master and voucher is cut out of the text on its own, read, and kept
     in a small form (only what the import uses); the whole file is never held as a tree. collector().feed(bytes) takes a file in
     parts (decoded as it comes), .end() closes that file, .M is the result; collect([...]) does the same for whole texts or bytes. */
  var WANT = /<(VOUCHER|LEDGER|GROUP|STOCKITEM|VOUCHERTYPE|UNIT|SVCURRENTCOMPANY)(?=[\s>\/])/g;
  var VF = ['VOUCHERTYPENAME', 'DATE', 'VOUCHERNUMBER', 'PARTYLEDGERNAME', 'REFERENCE', 'REFERENCEDATE', 'NARRATION', 'PLACEOFSUPPLY', 'STATENAME', 'PARTYGSTIN', 'GUID',
    'ISCANCELLED', 'ISOPTIONAL', 'ISDELETED', 'ISINVOICE'];
  function vchOf(n) {
    var f = {}; VF.forEach(function (k) { var x = val(n, k); if (x) f[k] = x; });
    var lines = [];
    function led(x, alloc) { if (!val(x, 'LEDGERNAME')) return; var l = { name: val(x, 'LEDGERNAME'), amt: r2(-num(val(x, 'AMOUNT'))) }; if (alloc) l.alloc = 1;
      /* a bank ledger's line: cheque / UTR number and the date the bank cleared it, as typed in Tally's bank allocation (bank reconciliation, 28 Nov 2026) */
      var ba = kids(x, 'BANKALLOCATIONS.LIST')[0]; if (ba) { var ch = val(ba, 'INSTRUMENTNUMBER'), bd = ymd(val(ba, 'BANKERSDATE')); if (ch) l.chq = ch; if (bd) l.bdate = bd; if (val(ba, 'TRANSACTIONTYPE')) l.ttype = val(ba, 'TRANSACTIONTYPE'); }
      /* bill-wise references of the line (New Ref / Agst Ref names): byof3-msme43bh (28 Nov 2026), to tie a payment to the bill it settles */
      var bl = kids(x, 'BILLALLOCATIONS.LIST').map(function (b) { return { name: val(b, 'NAME'), amt: r2(-num(val(b, 'AMOUNT'))), type: val(b, 'BILLTYPE') }; }).filter(function (b) { return b.name; }); if (bl.length) l.bills = bl;
      lines.push(l); }
    ['LEDGERENTRIES.LIST', 'ALLLEDGERENTRIES.LIST'].forEach(function (nm) { kids(n, nm).forEach(function (x) { led(x); }); });
    var inv = [];
    ['ALLINVENTORYENTRIES.LIST', 'INVENTORYENTRIES.LIST', 'INVENTORYENTRIESIN.LIST', 'INVENTORYENTRIESOUT.LIST'].forEach(function (nm) {
      kids(n, nm).forEach(function (ie) {
        var al = kids(ie, 'ACCOUNTINGALLOCATIONS.LIST'); al.forEach(function (x) { led(x, 1); });
        if (nm === 'ALLINVENTORYENTRIES.LIST' || nm === 'INVENTORYENTRIES.LIST')
          inv.push({ name: val(ie, 'STOCKITEMNAME'), qty: val(ie, 'BILLEDQTY') || val(ie, 'ACTUALQTY'), rate: val(ie, 'RATE'), amt: val(ie, 'AMOUNT'), gst: gstOfItem(ie), hsn: hsnOf(ie),
            allocs: al.map(function (x) { return key(val(x, 'LEDGERNAME')); }) });
      });
    });
    return { a: { VCHTYPE: n.a.VCHTYPE || '', REMOTEID: n.a.REMOTEID || '', ACTION: n.a.ACTION || '' }, f: f, lines: lines, inv: inv };
  }
  function ledOf(n, nm) {
    var o = { name: nm, parent: val(n, 'PARENT'), duty: (val(n, 'GSTDUTYHEAD') || val(n, 'TAXTYPE')).toLowerCase(), gstin: (val(n, 'PARTYGSTIN') || '').toUpperCase(), addr: [], pin: '', st: '',
      phone: val(n, 'LEDGERPHONE') || val(n, 'LEDGERMOBILE'), email: val(n, 'EMAIL'), cdays: num(val(n, 'BILLCREDITPERIOD')) || '', opening: val(n, 'OPENINGBALANCE'), closing: val(n, 'CLOSINGBALANCE'),   /* closing: byof2-final (28 Nov 2026), trial balance from masters */
      gst: gstOfItem(n),
      pan: (val(n, 'INCOMETAXNUMBER') || '').toUpperCase(), tdsType: val(n, 'TDSDEDUCTEETYPE') || val(n, 'DEDUCTEETYPE') };   /* byof-tds (28 Nov 2026): PAN and deductee type of a party, for the TDS site */
    walk(n, function (x) { if (!o.gstin && x.n === 'GSTIN') o.gstin = t(x.x).toUpperCase(); if (x.n === 'ADDRESS') o.addr.push(t(x.x)); if (!o.pin && x.n === 'PINCODE') o.pin = t(x.x); if (!o.st && (x.n === 'LEDSTATENAME' || x.n === 'STATE' || x.n === 'STATENAME')) o.st = t(x.x); });
    o.addr = o.addr.filter(Boolean).join(', ');
    /* MSME details of a party ledger (TallyPrime's MSME registration part; tags matched by name, not tried on a real export): byof3-msme43bh (28 Nov 2026) */
    walk(n, function (x) { if (!/MSME|UDYAM/.test(x.n || '')) return; var v = t(x.x); if (!v) return; if (!o.udyam && /^UDYAM/i.test(v.replace(/[^A-Za-z0-9]/g, ''))) o.udyam = v.toUpperCase(); else if (!o.msme && /^(micro|small|medium)$/i.test(v)) o.msme = v.toLowerCase(); else if (!o.activity && /ACTIVITY/.test(x.n) && /manufactur|service|trad/i.test(v)) o.activity = v; });
    return o;
  }
  function itemOf(n, nm) { return Object.assign({ name: nm, unit: val(n, 'BASEUNITS'), hsn: hsnOf(n), gst: gstOfItem(n), ob: val(n, 'OPENINGBALANCE'), ov: val(n, 'OPENINGVALUE'), orate: val(n, 'OPENINGRATE') }, itemMore(n, nm)); }
  /* byof-pricelist (28 Nov 2026): what a price list needs from a STOCKITEM (extra fields only; the import above does not use them):
     group = PARENT (stock group), cat = CATEGORY, alias = other names in NAME.LIST, mrp = newest MRPRATE, sp = newest STANDARDPRICELIST
     RATE (selling price), cost = newest STANDARDCOSTLIST RATE, levels = { price level: rate } from FULLPRICELIST.LIST, cb = CLOSINGBALANCE */
  function itemMore(n, nm) {
    var o = { group: val(n, 'PARENT'), cat: val(n, 'CATEGORY'), alias: '', mrp: 0, sp: 0, cost: 0, levels: {}, cb: val(n, 'CLOSINGBALANCE') };
    var nl = kid(n, 'NAME.LIST'); if (nl) o.alias = kids(nl, 'NAME').map(function (x) { return t(x.x); }).filter(function (x) { return x && key(x) !== key(nm); })[0] || '';
    function newest(list, rk) { var best = null; list.forEach(function (x) { var d = val(x, 'DATE') || val(x, 'FROMDATE'), r = rate(val(x, rk)); if (r && (!best || d >= best.d)) best = { d: d, r: r }; }); return best ? best.r : 0; }
    o.sp = newest(kids(n, 'STANDARDPRICELIST.LIST'), 'RATE');
    o.cost = newest(kids(n, 'STANDARDCOSTLIST.LIST'), 'RATE');
    var mrps = []; walk(n, function (x) { if (x.n === 'MRPDETAILS.LIST') { var d = val(x, 'FROMDATE'); walk(x, function (y) { if (y.n === 'MRPRATE' && rate(y.x)) mrps.push({ d: d, r: rate(y.x) }); }); } });
    var md = null; mrps.forEach(function (m) { if (md === null || m.d >= md) { md = m.d; o.mrp = m.r; } });
    kids(n, 'FULLPRICELIST.LIST').forEach(function (x) { var lv = val(x, 'PRICELEVEL'), pl = kids(x, 'PRICELEVELLIST.LIST')[0]; if (lv && pl && rate(val(pl, 'RATE'))) o.levels[lv] = rate(val(pl, 'RATE')); });
    return o;
  }
  function collector() {
    var M = { groups: {}, ledgers: {}, items: {}, vtypes: {}, units: {}, vouchers: [], company: '', _m: 1 }, dec = null, buf = '';
    function take(name, xml) {
      var n = parse(xml).c[0]; if (!n) return;
      if (name === 'SVCURRENTCOMPANY') { if (!M.company) M.company = t(n.x); return; }
      if (name === 'VOUCHER') { M.vouchers.push(vchOf(n)); return; }
      var nm = nameOf(n); if (!nm) return;
      if (name === 'GROUP') M.groups[key(nm)] = { name: nm, parent: val(n, 'PARENT') };
      else if (name === 'LEDGER') M.ledgers[key(nm)] = ledOf(n, nm);
      else if (name === 'STOCKITEM') M.items[key(nm)] = itemOf(n, nm);
      else if (name === 'VOUCHERTYPE') M.vtypes[key(nm)] = val(n, 'PARENT');
      else if (name === 'UNIT') M.units[key(nm)] = nm;
    }
    function scan() {
      var pos = 0, m;
      for (;;) {
        WANT.lastIndex = pos; m = WANT.exec(buf);
        if (!m) { pos = Math.max(pos, buf.length - 40); break; }   /* a tag cut at the end of this part waits for the next */
        var gt = buf.indexOf('>', m.index); if (gt < 0) { pos = m.index; break; }
        if (buf[gt - 1] === '/') { take(m[1], buf.slice(m.index, gt + 1)); pos = gt + 1; continue; }
        var close = '</' + m[1] + '>', end = buf.indexOf(close, gt); if (end < 0) { pos = m.index; break; }
        take(m[1], buf.slice(m.index, end + close.length)); pos = end + close.length;
      }
      buf = buf.slice(pos);
    }
    return {
      M: M,
      text: function (txt) { buf += txt; scan(); buf = ''; },
      feed: function (bytes) {
        var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), st = 0;
        if (!dec) {
          var enc = 'utf-8';
          if (b[0] === 0xFF && b[1] === 0xFE) { enc = 'utf-16le'; st = 2; } else if (b[0] === 0xFE && b[1] === 0xFF) { enc = 'utf-16be'; st = 2; }
          else if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) st = 3;
          else if (b.length > 3 && b[1] === 0 && b[3] === 0) enc = 'utf-16le'; else if (b.length > 3 && b[0] === 0 && b[2] === 0) enc = 'utf-16be';
          dec = new TextDecoder(enc);
        }
        buf += dec.decode(st ? b.subarray(st) : b, { stream: true }); scan();
      },
      end: function () { if (dec) buf += dec.decode(); scan(); buf = ''; dec = null; }
    };
  }
  /* texts, byte arrays, or an already collected result */
  function collect(inputs) {
    if (inputs && inputs._m) return inputs;
    var c = collector();
    (inputs || []).forEach(function (x) { if (typeof x === 'string') c.text(x); else { c.feed(x); c.end(); } });
    return c.M;
  }
  function fv(v, k) { return v.f[k] || ''; }

  /* ---------- ledgers: Tally group -> NSBiz account ---------- */
  var RES = ['capital account', 'reserves & surplus', 'loans (liability)', 'bank od a/c', 'secured loans', 'unsecured loans', 'current liabilities', 'duties & taxes', 'provisions',
    'sundry creditors', 'fixed assets', 'investments', 'current assets', 'bank accounts', 'cash-in-hand', 'deposits (asset)', 'loans & advances (asset)', 'stock-in-hand', 'sundry debtors',
    'branch / divisions', 'misc. expenses (asset)', 'suspense a/c', 'sales accounts', 'purchase accounts', 'direct incomes', 'indirect incomes', 'direct expenses', 'indirect expenses'];
  function topGroup(M, g) {
    var seen = {}, k = key(g);
    while (k && !seen[k]) { seen[k] = 1; if (RES.indexOf(k) >= 0) return k; var p = M.groups[k]; if (!p) return k; k = key(p.parent); }
    return k;
  }
  function ledgerMap(M) {
    var out = {}, used = {};
    function one(nm, parent, n) {
      var g = topGroup(M, parent), k = key(nm), lower = nm.toLowerCase(), m;
      var duty = n ? n.duty : '';
      if (/round(ing)?\s*-?\s*off/.test(lower)) m = { k: 'round-off' };
      else if (g === 'sundry debtors' || g === 'sundry creditors') {
        var role = g === 'sundry creditors' ? 'supplier' : 'customer';
        m = { k: 'p:' + k, party: nm, role: role, side: role === 'supplier' ? 'pay' : 'recv', grp: key(parent) !== g ? t(parent) : '' };
      }
      else if (g === 'cash-in-hand') m = { k: 'cash' };
      else if (g === 'bank accounts') m = { k: 'bank:' + k, bank: nm };
      else if (g === 'bank od a/c') m = { k: 'od:' + k };
      else if (g === 'duties & taxes') {
        var w = duty + ' ' + lower;   /* "SGST/UTGST" and "State Tax" are SGST; UTGST only when it says nothing of the state */
        var head = /igst|integrated/.test(w) ? 'igst' : /cgst|central/.test(w) ? 'cgst' : /sgst|state/.test(w) ? 'sgst' : /utgst|union/.test(w) ? 'utgst' : '';
        if (head && /gst|tax/.test(duty + ' ' + lower) && !/tds|tcs|cess/.test(lower)) {
          var io = /input|itc|purchase/.test(lower) ? 'in' : /output|sale/.test(lower) ? 'out' : '';
          m = { k: 'gst-' + (io || 'out') + '-' + head, dual: !io, head: head };   /* one ledger for both sides: compared as one */
        } else m = { k: 'ocl:' + k };
      }
      else if (g === 'sales accounts') m = { k: 'sales' };
      else if (g === 'purchase accounts') m = { k: 'purchases' };
      else if (g === 'direct expenses' || g === 'indirect expenses' || g === 'misc. expenses (asset)') m = { k: 'exp:' + k };
      else if (g === 'direct incomes' || g === 'indirect incomes') m = { k: 'inc:' + k };
      else if (g === 'capital account' || g === 'reserves & surplus') m = { k: 'cap:' + k };
      else if (g === 'loans (liability)' || g === 'secured loans' || g === 'unsecured loans') m = { k: 'loan:' + k };
      else if (g === 'fixed assets') m = { k: 'fa:' + k };
      else if (g === 'current liabilities' || g === 'provisions' || g === 'suspense a/c') m = { k: 'ocl:' + k };
      else m = { k: 'oca:' + k };
      m.name = nm; m.group = g; if (n && n.gst) m.gst = n.gst; out[key(nm)] = m;
      return m;
    }
    Object.keys(M.ledgers).forEach(function (k) { var n = M.ledgers[k]; one(n.name, n.parent, n); });
    /* a ledger used in a voucher but not in the masters export: a party when it is the voucher's party, else by its name */
    M.vouchers.forEach(function (v) {
      v.lines.forEach(function (l) {
        if (out[key(l.name)]) return;
        var party = key(fv(v, 'PARTYLEDGERNAME')) === key(l.name);
        var base = baseType(M, v);
        var guess = l.alloc ? (/purchase|debit note/.test(base) ? 'purchase accounts' : 'sales accounts') : party ? (/purchase|debit note/.test(base) ? 'sundry creditors' : 'sundry debtors') : /^(cash)$/i.test(l.name) ? 'cash-in-hand' : /\bbank\b/i.test(l.name) ? 'bank accounts' :
          /cgst|sgst|igst|utgst|gst/i.test(l.name) ? 'duties & taxes' : /^sales?\b/i.test(l.name) ? 'sales accounts' : /^purchases?\b/i.test(l.name) ? 'purchase accounts' : '';
        one(l.name, guess, null).guessed = true;
      });
    });
    void used;
    ['sales', 'purchases'].forEach(function (b) {
      var ks = Object.keys(out).filter(function (k) { return out[k].k === b; });
      if (ks.length > 1) ks.forEach(function (k) { out[k].k = b + ':' + k; out[k].led = out[k].name; });
    });
    return out;
  }

  /* ---------- vouchers ---------- */
  var BASE = ['sales', 'purchase', 'credit note', 'debit note', 'receipt', 'payment', 'contra', 'journal', 'sales order', 'purchase order', 'delivery note', 'receipt note',
    'rejections in', 'rejections out', 'stock journal', 'physical stock', 'memorandum', 'reversing journal', 'material in', 'material out', 'job work in order', 'job work out order', 'attendance', 'payroll'];
  function baseType(M, v) {
    var k = key(fv(v, 'VOUCHERTYPENAME') || v.a.VCHTYPE), seen = {};
    while (k && !seen[k]) { seen[k] = 1; if (BASE.indexOf(k) >= 0) return k; var p = M.vtypes[k]; if (!p) break; k = key(p); }
    var a = key(v.a.VCHTYPE); if (BASE.indexOf(a) >= 0) return a;
    return byName(k);
  }
  /* a custom type whose master is not in the files: by the words of its name ("Gst Sale", "GST PURCHASE", "Sales Invoice 2"...) */
  function byName(k) {
    if (/order/.test(k)) return /purchase/.test(k) ? 'purchase order' : /sale/.test(k) ? 'sales order' : k;
    if (/challan|delivery/.test(k)) return 'delivery note';   /* goods sent before the bill: posts nothing in Tally (owner's Tally, 25 Nov 2026) */
    if (/receipt\s*note|\bgrn\b|goods\s*receipt|material\s*receipt/.test(k)) return 'receipt note';
    if (/credit\s*note|sales?\s*return/.test(k)) return 'credit note';
    if (/debit\s*note|purchase\s*return/.test(k)) return 'debit note';
    if (/stock\s*journal|manufactur/.test(k)) return 'stock journal';
    if (/purchase/.test(k)) return 'purchase';
    if (/\bsales?\b|invoice|\bbill\b/.test(k)) return 'sales';
    if (/receipt/.test(k)) return 'receipt';
    if (/payment/.test(k)) return 'payment';
    if (/contra/.test(k)) return 'contra';
    if (/journal/.test(k)) return 'journal';
    return k;
  }
  var NOPOST = { 'sales order': 1, 'purchase order': 1, 'delivery note': 1, 'receipt note': 1, 'rejections in': 1, 'rejections out': 1, 'memorandum': 1, 'physical stock': 1, 'material in': 1, 'material out': 1,
    'job work in order': 1, 'job work out order': 1, 'attendance': 1, 'reversing journal': 1, 'stock journal': 1 };
  function gstOfItem(n) {
    if (!n) return 0;
    var best = 0;
    walk(n, function (x) { if (x.n === 'RATEDETAILS.LIST') { var h = val(x, 'GSTRATEDUTYHEAD').toLowerCase(), r = num(val(x, 'GSTRATE')); if (/igst|integrated/.test(h) && r) best = r; } });
    if (!best) walk(n, function (x) { if (x.n === 'RATEDETAILS.LIST') { var h = val(x, 'GSTRATEDUTYHEAD').toLowerCase(), r = num(val(x, 'GSTRATE')); if (/cgst|central|sgst|state/.test(h)) best += r; } });
    if (!best) { var g = val(n, 'GSTRATE') || val(n, 'IGSTRATE'); best = num(g); }
    return best;
  }
  function hsnOf(n) { var h = ''; if (n) walk(n, function (x) { if (!h && (x.n === 'HSNCODE' || x.n === 'GSTHSNCODE' || x.n === 'GSTHSNNAME' || x.n === 'HSN') && /^\d{4,8}$/.test(t(x.x))) h = t(x.x); }); return h; }

  function plan(texts, opts) {
    opts = opts || {};
    var M = collect(texts), L = ledgerMap(M), co = opts.co || M.company || 'tally', seller = opts.seller || { name: opts.bizName || co }, have = opts.have || {}, tot = opts.totals, warn = [];
    var src = function (id) { return { sw: 'tally', co: co, id: id }; };
    var out = { company: M.company, parties: [], items: [], groups: [], banks: [], docs: [], warn: warn, counts: {}, skipped: 0, left: {}, map: L };
    function add(d) { d.seller = seller; d.app = 1; if (have[d.src.id]) { out.skipped++; return; } out.docs.push(d); out.counts[d.type] = (out.counts[d.type] || 0) + 1; }
    function acct(name) { var m = L[key(name)]; if (!m) { m = { k: 'oca:' + key(name), name: name }; L[key(name)] = m; } return m; }
    function lineOf(m, dr, cr, narr) { var l = m.party ? { a: 'party', party: m.party, side: m.side } : { a: m.k }; l.dr = r2(dr); l.cr = r2(cr); if (narr) l.narr = narr; return l; }

    /* masters */
    var grpSeen = {};
    Object.keys(L).forEach(function (k) {
      var m = L[k], n = M.ledgers[k];
      if (m.party) {
        var gid = m.grp ? 'gtl-' + key(co + ' ' + m.grp).replace(/[^a-z0-9]+/g, '-') : '';
        if (gid && !grpSeen[gid]) { grpSeen[gid] = 1; out.groups.push({ id: gid, name: m.grp, under: m.side === 'pay' ? 'creditors' : 'debtors', src: src('grp/' + gid) }); }
        var o = n || { gstin: '', st: '', addr: '', pin: '', phone: '', email: '', cdays: '' }, gstin = o.gstin;
        out.parties.push({ name: m.party, role: m.role, group: gid || (m.side === 'pay' ? 'creditors' : 'debtors'), addr: o.addr, pin: o.pin, state: stateCode(o.st) || (/^\d\d/.test(gstin) ? gstin.slice(0, 2) : ''),
          gstin: gstin, phone: t(o.phone), email: t(o.email), cdays: o.cdays || '', src: src('led/' + k) });
        m.state = out.parties[out.parties.length - 1].state; m.gstin = gstin;
      }
      if (m.bank) out.banks.push({ k: m.k, name: m.bank, src: src('led/' + k) });
    });
    var items = {};
    Object.keys(M.items).forEach(function (k) {
      var n = M.items[k];
      var x = { desc: n.name, hsn: n.hsn, unit: n.unit, gst: n.gst, rate: '', kind: 'goods', src: src('item/' + k) };
      items[k] = x; out.items.push(x);
    });

    var L2 = {}; Object.keys(L).forEach(function (k) { L2[L[k].k] = L2[L[k].k] || L[k]; });
    var ownSt = {};
    /* vouchers */
    var firstDay = '';
    M.vouchers.forEach(function (v) { var d = ymd(fv(v, 'DATE')); if (d && (!firstDay || d < firstDay)) firstDay = d; });
    if (firstDay) { var y = +firstDay.slice(0, 4); if (+firstDay.slice(5, 7) < 4) y--; firstDay = y + '-04-01'; }
    firstDay = opts.from || firstDay;
    M.vouchers.forEach(function (v, vi) {
      var base = baseType(M, v), date = ymd(fv(v, 'DATE')), no = fv(v, 'VOUCHERNUMBER'), id = (t(v.a.REMOTEID) || fv(v, 'GUID') || (base + '/' + date + '/' + no + '/' + vi));
      if (gone(v)) { out.left.cancelled = (out.left.cancelled || 0) + 1; return; }
      if (NOPOST[base]) { out.left[base] = (out.left[base] || 0) + 1; return; }
      var lines = v.lines, narr = fv(v, 'NARRATION');
      if (!lines.length) { out.left.empty = (out.left.empty || 0) + 1; return; }
      var inv = v.inv, party = L[key(fv(v, 'PARTYLEDGERNAME'))];
      var acInv = !inv.length && /^yes$/i.test(fv(v, 'ISINVOICE')) && lines.some(function (l) { return isSP(acct(l.name)); });
      var asDoc = (inv.length || acInv) && party && party.party && /^(sales|purchase|credit note|debit note)$/.test(base);
      /* a purchase bill booked straight to expense or asset ledgers (consumables, repairs, a machine): NSBiz expense / fixed-asset
         records, one per ledger, on credit from the supplier, as the Evershine import does; the goods do not go into stock */
      if (base === 'purchase' && party && party.party && (inv.length || /^yes$/i.test(fv(v, 'ISINVOICE')))) {
        var oth = lines.filter(function (l) { var m = acct(l.name); return m !== party && !/^gst-/.test(m.k) && m.k !== 'round-off'; });
        if (oth.length && oth.every(function (l) { return /^(exp|fa):/.test(acct(l.name).k); })) { expBill(v, lines, oth, party, base, date, no, id, narr); return; }
      }
      if (asDoc) {
        var buy = base === 'purchase' || base === 'debit note';
        var pState = stateCode(fv(v, 'PLACEOFSUPPLY') || fv(v, 'STATENAME')) || party.state || '';
        var pl = { name: party.party, state: buy ? (party.state || pState) : party.state || pState, gstin: party.gstin || fv(v, 'PARTYGSTIN').toUpperCase() };
        var taxLines = lines.filter(function (l) { return /^gst-/.test(acct(l.name).k); }), taxable = 0, taxAmt = 0;
        /* the business's own state: that of parties billed with CGST + SGST */
        if (pl.state && taxLines.some(function (l) { return /cgst|sgst|utgst/.test(acct(l.name).k); })) ownSt[pl.state] = (ownSt[pl.state] || 0) + 1;
        var src0 = inv.length ? inv : lines.filter(function (l) { return isSP(acct(l.name)); }).map(function (l) {
          var m = acct(l.name), pc = (l.name.match(/(\d+(?:\.\d+)?)\s*%/) || [])[1];
          return { name: l.name, qty: '1', rate: String(Math.abs(l.amt)), amt: String(Math.abs(l.amt)), gst: m.gst || (pc ? +pc : 0), hsn: '', allocs: [key(l.name)], acc: 1 };
        });
        var its = src0.map(function (ie) {
          var nm = ie.name, q = qty(ie.qty), amt = Math.abs(num(ie.amt)), r = rate(ie.rate);
          var qq = q.q || 1, rr = r;
          if (Math.abs(qq * rr - amt) >= 0.01) rr = Math.round(amt / qq * 10000) / 10000;
          taxable += amt;
          var g = ie.gst || (items[key(nm)] && items[key(nm)].gst) || 0;
          var lm = ie.allocs.length ? L[ie.allocs[0]] : null, lf = buy ? 'pl' : 'sl', o = {};
          if (lm && lm.led) o[lf] = lm.led;
          return Object.assign(o, { desc: nm || 'Item', hsn: ie.hsn || (items[key(nm)] && items[key(nm)].hsn) || '', qty: qq, unit: q.u || (items[key(nm)] && items[key(nm)].unit) || '', rate: rr, disc: '', gst: g });
        });
        taxLines.forEach(function (l) { taxAmt += Math.abs(l.amt); });
        /* no rate on the lines: the bill's own tax over its value, to the nearest GST rate */
        if (taxAmt && its.some(function (x) { return !x.gst; }) && taxable) { var eff = taxAmt / taxable * 100, R = [0.25, 3, 5, 12, 18, 28, 40].sort(function (a, b) { return Math.abs(a - eff) - Math.abs(b - eff); })[0]; its.forEach(function (x) { if (!x.gst) x.gst = R; }); }
        var pAmt = Math.abs((lines.filter(function (l) { return key(l.name) === key(party.name); })[0] || { amt: 0 }).amt);
        var d = { no: (base === 'purchase' && fv(v, 'REFERENCE')) || no, date: date, notes: narr, items: its, charges: [], round: false, buyer: pl, src: src(id) };
        if (base === 'sales') Object.assign(d, { type: 'invoice', kind: taxAmt || its.some(function (x) { return x.gst; }) ? 'tax' : 'supply', vno: no, pos: pl.state, status: 'unpaid', withGst: true, comp: true, copies: 1, paper: 'a4', design: 'classic' });
        else if (base === 'purchase') Object.assign(d, { type: 'pbill', kind: 'bill', noGst: false, bdate: ymd(fv(v, 'REFERENCEDATE')), vno: no });
        else if (base === 'credit note') Object.assign(d, { type: 'note', kind: 'credit', side: 'sale', reason: 'ret', orig: fv(v, 'REFERENCE') });
        else Object.assign(d, { type: 'note', kind: 'debit', side: 'purchase', reason: 'ret', orig: fv(v, 'REFERENCE') });
        /* other charges in the bill (freight and the like) that are not GST, round off or the party: become bill charges */
        /* every other line (freight, packing, a sales ledger not tied to an item...): a bill charge. It carries the main item's GST when
           the bill's tax shows GST was charged on it, else none */
        var itemTax = its.reduce(function (a, x) { return a + x.qty * x.rate * (x.gst || 0) / 100; }, 0), spare = taxAmt - itemTax;
        var mainG = its.slice().sort(function (a, b) { return b.qty * b.rate - a.qty * a.rate; })[0];
        mainG = mainG ? mainG.gst || 0 : 0;
        lines.forEach(function (l) {
          var m = acct(l.name); if (m === party || /^gst-/.test(m.k) || m.k === 'round-off') return;
          if (src0.some(function (ie) { return ie.allocs.indexOf(key(l.name)) >= 0; })) return;
          var amt = r2(Math.abs(l.amt)), need = amt * mainG / 100, taxed = mainG && spare >= need - 1;
          if (taxed) spare -= need;
          d.charges.push({ name: l.name, amt: amt, gst: taxed ? '' : 0 });
          if (m.led && !d[buy ? 'pl' : 'sl']) d[buy ? 'pl' : 'sl'] = m.led;
        });
        if (!d[buy ? 'pl' : 'sl']) { var big = its.slice().sort(function (a, b) { return b.qty * b.rate - a.qty * a.rate; })[0]; if (big && big[buy ? 'pl' : 'sl']) d[buy ? 'pl' : 'sl'] = big[buy ? 'pl' : 'sl']; }
        d.total = pAmt || (tot ? tot(Object.assign({}, d, { total: null })).total : 0);
        if (tot && pAmt) { var gap = r2(pAmt - tot(Object.assign({}, d, { total: null })).total); if (Math.abs(gap) > 1) warn.push({ w: 'billgap', id: no, amt: gap }); }
        add(d);
        if (opts.postings) fix(d, lines, id, no);
        return;
      }
      var jl = lines.map(function (l) { return lineOf(acct(l.name), l.amt > 0 ? l.amt : 0, l.amt < 0 ? -l.amt : 0); });
      var s = jl.reduce(function (a, l) { return r2(a + l.dr - l.cr); }, 0);
      if (s) { warn.push({ w: 'unbalanced', id: no, amt: s }); jl.push({ a: 'ocl:tally difference', dr: s < 0 ? -s : 0, cr: s > 0 ? s : 0 }); }
      add({ type: 'jv', no: no || base, date: date, lines: jl, narr: narr, evtype: base, src: src(id) });
    });
    function expBill(v, lines, oth, party, base, date, no, id, narr) {
      var tax = 0, inter = false, val = 0, grp = {}, order = [];
      lines.forEach(function (l) { var m = acct(l.name); if (/^gst-/.test(m.k)) { tax += l.amt; if (/igst/.test(m.k)) inter = true; } });
      oth.forEach(function (l) { var k = key(l.name); if (!grp[k]) { grp[k] = 0; order.push(k); } grp[k] = r2(grp[k] + l.amt); val += l.amt; });
      tax = r2(tax);
      var rates = {}; v.inv.forEach(function (ie) { (ie.allocs || []).forEach(function (a) { if (ie.gst) rates[a] = ie.gst; }); });
      var pl = { name: party.party, state: party.state || '', gstin: party.gstin || fv(v, 'PARTYGSTIN').toUpperCase() }, bill = fv(v, 'REFERENCE') || no, recs = [], left = tax;
      order.forEach(function (k, j) {
        var m = L[k], amt = grp[k], tx = j === order.length - 1 ? left : r2(val ? tax * amt / val : 0); left = r2(left - tx);
        var g = rates[k] || (amt && tx ? [0.25, 3, 5, 12, 18, 28, 40].sort(function (a, b) { return Math.abs(a - tx / amt * 100) - Math.abs(b - tx / amt * 100); })[0] : 0);
        var r = /^fa:/.test(m.k) ?
          { type: 'fa', kind: 'buy', date: date, no: bill, name: m.name, amount: r2(amt), gstAmt: tx, gst: g ? String(g) : '', itc: !!tx, inter: inter, mode: 'credit', buyer: pl, notes: narr, total: r2(amt + tx), src: src(id + '#' + j) } :
          { type: 'exp', date: date, no: bill, cat: m.name, amount: r2(amt + tx), gst: g ? String(g) : '', itc: !!tx, inter: inter, mode: 'credit', buyer: pl, notes: narr, total: r2(amt + tx), src: src(id + '#' + j) };
        add(r); recs.push(r);
      });
      if (opts.postings) fix(recs, lines, id, no);
    }
    /* the bill posts exactly Tally's lines: differences in a small journal beside it (as for Evershine) */
    function fix(d, lines, id, no) {
      var want = {}, got = {}, recs = Array.isArray(d) ? d : [d]; d = recs[0];
      lines.forEach(function (l) { var k = canon(acct(l.name)); want[k] = r2((want[k] || 0) + l.amt); });
      recs.forEach(function (r) { opts.postings(r).forEach(function (l) { var k = canon(L2[l.a] || { k: l.a }); got[k] = r2((got[k] || 0) + l.dr - l.cr); }); });
      var fl = [];
      Object.keys(Object.assign({}, want, got)).forEach(function (k) {
        var diff = r2((want[k] || 0) - (got[k] || 0)); if (Math.abs(diff) < 0.005) return;
        var m = null; lines.some(function (l) { var x = acct(l.name); if (canon(x) === k) { m = x; return true; } return false; }); m = m || byCanon(k); fl.push(m ? lineOf(m, diff > 0 ? diff : 0, diff < 0 ? -diff : 0) : { a: k, dr: diff > 0 ? diff : 0, cr: diff < 0 ? -diff : 0 });
      });
      if (!fl.length) return;
      var s2 = fl.reduce(function (a, l) { return r2(a + l.dr - l.cr); }, 0);
      /* a voucher whose own lines in the file do not add up (an incomplete export): the gap is shown, never hidden in round off */
      var own = lines.reduce(function (a, l) { return r2(a + l.amt); }, 0);
      if (Math.abs(own) >= 0.01) warn.push({ w: 'unbalanced', id: no, amt: own });
      if (Math.abs(s2) >= 0.005) fl.push({ a: Math.abs(own) >= 0.01 ? 'ocl:tally difference' : 'round-off', dr: s2 < 0 ? -s2 : 0, cr: s2 > 0 ? s2 : 0 });
      out.fixed = (out.fixed || 0) + 1;
      add({ type: 'jv', no: (d.no || no) + ' (Tally)', date: d.date, lines: fl, narr: 'Tally posting of ' + (d.no || no), fixOf: d.src.id, src: src(id + '#fix') });
    }
    function byCanon(c) { var f = null; Object.keys(L).some(function (k) { if (canon(L[k]) === c) { f = L[k]; return true; } return false; }); return f; }

    /* openings: ledgers and stock items */
    if (!opts.noOpening) {
      var rest = [];
      Object.keys(M.ledgers).forEach(function (k) {
        var n = M.ledgers[k], amt = -num(n.opening), m = L[k]; if (!amt || !m) return;
        var id = 'OP/' + k;
        if (m.party) add({ type: 'ob', date: firstDay, side: amt > 0 ? 'recv' : 'pay', amount: r2(Math.abs(amt)), buyer: { name: m.party }, no: '', total: r2(Math.abs(amt)), src: src(id) });
        else if (m.k === 'cash' || /^bank:/.test(m.k)) add({ type: 'ob', date: firstDay, side: m.k === 'cash' ? 'cash' : 'bank', bacct: m.k === 'cash' ? '' : m.k, amount: r2(amt), buyer: { name: '' }, no: '', total: r2(Math.abs(amt)), src: src(id) });
        else rest.push(lineOf(m, amt > 0 ? amt : 0, amt < 0 ? -amt : 0));
      });
      if (rest.length) { var s3 = rest.reduce(function (a, l) { return r2(a + l.dr - l.cr); }, 0); if (s3) rest.push({ a: 'opening', dr: s3 < 0 ? -s3 : 0, cr: s3 > 0 ? s3 : 0 }); add({ type: 'jv', no: 'OP', date: firstDay, lines: rest, narr: 'Opening balances from Tally', src: src('OP/ledgers') }); }
      var stk = Object.keys(M.items).map(function (k) {
        var n = M.items[k], q = qty(n.ob); if (!q.q) return null;
        var v2 = Math.abs(num(n.ov)); return { desc: n.name, unit: q.u || n.unit, qty: q.q, rate: v2 ? Math.round(v2 / q.q * 10000) / 10000 : rate(n.orate) };
      }).filter(Boolean);
      if (stk.length && firstDay) add({ type: 'stk', kind: 'open', no: 'OPEN/TALLY', date: firstDay, gd: '', note: 'Opening stock from Tally', lines: stk, src: src('OP/stock') });
    }
    /* items used on bills but not in the masters file (Tally's accounting-masters export leaves stock items out) */
    M.vouchers.forEach(function (v) {
      v.inv.forEach(function (ie) {
        var k = key(ie.name); if (!k || items[k]) return;
        var x = { desc: ie.name, hsn: ie.hsn || '', unit: qty(ie.qty).u, gst: ie.gst || 0, rate: '', kind: 'goods', src: src('item/' + k) };
        items[k] = x; out.items.push(x);
      });
    });
    out.ownState = Object.keys(ownSt).sort(function (a, b) { return ownSt[b] - ownSt[a]; })[0] || '';
    out.docs.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return out;
  }
  function isSP(m) { return /^(sales|purchases)(:|$)/.test(m.k); }
  function gone(v) { return /^yes$/i.test(fv(v, 'ISCANCELLED')) || /^yes$/i.test(fv(v, 'ISOPTIONAL')) || /^yes$/i.test(fv(v, 'ISDELETED')) || /^delete$/i.test(v.a.ACTION || ''); }
  /* GST ledgers Tally keeps for both sides (one "CGST" ledger) and returns booked by NSBiz to their own accounts: compared as one */
  var SAME = { 'sales-return': 'sales', 'purchase-return': 'purchases' };
  function canon(m) { var k = m.k; k = SAME[k] || k; if (/^gst-(in|out)-/.test(k)) k = 'gst-' + k.split('-')[2]; return k; }

  /* ---------- the check: NSBiz's books against Tally's own ledger lines and openings ---------- */
  function check(texts, P, books0, opts) {
    opts = opts || {};
    var M = collect(texts), want = {}, names = {}, got = {};
    function put(name, amt) { var m = P.map[key(name)]; if (!m) return; var k = canon(m); want[k] = r2((want[k] || 0) + amt); names[k] = names[k] || m.name; }
    if (!opts.noOpening) Object.keys(M.ledgers).forEach(function (k) { var n = M.ledgers[k]; put(n.name, -num(n.opening)); });
    M.vouchers.forEach(function (v) {
      if (gone(v) || NOPOST[baseType(M, v)]) return;
      v.lines.forEach(function (l) { put(l.name, l.amt); });
    });
    Object.keys(books0).forEach(function (k) { var c = canon({ k: k }); got[c] = r2((got[c] || 0) + books0[k]); });
    var rows = [], ok = 0, bad = 0;
    Object.keys(Object.assign({}, want, got)).forEach(function (k) {
      if (k === 'opening' || k === 'ocl:tally difference') return;
      var e = r2(want[k] || 0), n = r2(got[k] || 0), d = r2(n - e); if (!e && !n) return;
      if (Math.abs(d) < 0.01) ok++; else bad++;
      rows.push({ k: k, name: names[k] || k, tally: e, nsbiz: n, diff: d });
    });
    rows.sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff); });
    return { rows: rows, ok: ok, bad: bad };
  }

  /* ---------- the purchase register of a Day Book (for the GSTR-2B matcher, g2core.js) ----------
     Purchase vouchers and debit notes (purchase returns) only, cancelled / optional ones left out. One bill each: the supplier's own
     number and date (REFERENCE, REFERENCEDATE; else the voucher's), the party's GSTIN, the bill value = the party line, tax = the
     Duties & Taxes lines by head (IGST, CGST, SGST / UTGST, cess), taxable value = value - tax - round off. Nothing is changed. */
  function purchases(texts) {
    var M = collect(texts), L = ledgerMap(M), out = { company: M.company, bills: [], read: 0, left: 0 };
    M.vouchers.forEach(function (v) {
      var base = baseType(M, v);
      if (base !== 'purchase' && base !== 'debit note') return;
      out.read++;
      if (gone(v)) { out.left++; return; }
      var party = fv(v, 'PARTYLEDGERNAME'), pk = key(party), val = 0, tax = { igst: 0, cgst: 0, sgst: 0, cess: 0 }, ro = 0;
      v.lines.forEach(function (l) {
        var m = L[key(l.name)] || {}, a = Math.abs(l.amt), nm = l.name.toLowerCase();
        if (pk ? key(l.name) === pk : m.party) { val = r2(val + a); return; }
        if (m.k === 'round-off') { ro = r2(ro + l.amt); return; }
        if (m.group === 'duties & taxes' || /\b(cgst|sgst|igst|utgst|cess)\b/.test(nm)) {
          var h = /cess/.test(nm) ? 'cess' : m.head === 'utgst' ? 'sgst' : m.head || (/igst|integrated/.test(nm) ? 'igst' : /cgst|central/.test(nm) ? 'cgst' : /sgst|utgst|state/.test(nm) ? 'sgst' : '');
          if (h) tax[h] = r2(tax[h] + a);
        }
      });
      var led = M.ledgers[pk] || {}, sumTax = tax.igst + tax.cgst + tax.sgst + tax.cess;
      out.bills.push({ kind: base === 'debit note' ? 'cn' : 'inv', name: party, gstin: (fv(v, 'PARTYGSTIN') || led.gstin || '').toUpperCase(), no: fv(v, 'REFERENCE') || fv(v, 'VOUCHERNUMBER'),
        date: ymd(fv(v, 'REFERENCEDATE')) || ymd(fv(v, 'DATE')), vno: fv(v, 'VOUCHERNUMBER'), vtype: fv(v, 'VOUCHERTYPENAME') || v.a.VCHTYPE || '', value: val,
        txv: r2(val - sumTax - (base === 'debit note' ? -ro : ro)), igst: tax.igst, cgst: tax.cgst, sgst: tax.sgst, cess: tax.cess });
    });
    return out;
  }

  /* ---------- money paid to suppliers (byof3-msme43bh, 28 Nov 2026: MSME 45-day check on audit.) ----------
     Payment and Journal vouchers (and any other non-invoice type) that DEBIT a Sundry Creditors ledger: one row per supplier line, with
     the voucher's date, the amount, and the bill references of its bill-wise allocation (Agst Ref names). Purchase bills: purchases().
     Also the suppliers' MSME details from their ledgers (msme, udyam, activity, credit days). */
  function supplierPayments(texts) {
    var M = collect(texts), L = ledgerMap(M), out = { company: M.company, pays: [], read: 0, left: 0, sups: [] };
    M.vouchers.forEach(function (v) {
      var base = baseType(M, v);
      if (/^(purchase|sales|debit note|credit note|purchase order|sales order|delivery note|receipt note|stock journal|memorandum)$/.test(base)) return;
      v.lines.forEach(function (l) {
        var m = L[key(l.name)] || {}; if (m.role !== 'supplier' || !(l.amt > 0)) return;
        out.read++; if (gone(v)) { out.left++; return; }
        out.pays.push({ name: l.name, date: ymd(fv(v, 'DATE')), amt: r2(l.amt), vno: fv(v, 'VOUCHERNUMBER'), vtype: fv(v, 'VOUCHERTYPENAME') || v.a.VCHTYPE || '', base: base,
          refs: (l.bills || []).filter(function (b) { return !/^(on account|new ref)$/i.test(b.type); }).map(function (b) { return b.name; }) });
      });
    });
    Object.keys(M.ledgers).forEach(function (k) { var d = M.ledgers[k], m = L[k] || {}; if (m.role === 'supplier') out.sups.push({ name: d.name, msme: d.msme || '', udyam: d.udyam || '', activity: d.activity || '', cdays: d.cdays || '', gstin: d.gstin }); });
    return out;
  }
  /* voucher number + date -> the supplier line's bill reference names (New Ref) of each purchase / debit note, to match Agst Ref payments */
  function purchaseRefs(texts) {
    var M = collect(texts), L = ledgerMap(M), out = {};
    M.vouchers.forEach(function (v) { var base = baseType(M, v); if (base !== 'purchase' && base !== 'debit note') return;
      v.lines.forEach(function (l) { var m = L[key(l.name)] || {}; if (m.role === 'supplier' && l.bills) out[fv(v, 'VOUCHERNUMBER') + '|' + ymd(fv(v, 'DATE'))] = l.bills.map(function (b) { return b.name; }); }); });
    return out;
  }

  var API = { decode: decode, parse: parse, collect: collect, collector: collector, plan: plan, check: check, stateCode: stateCode, purchases: purchases, supplierPayments: supplierPayments, purchaseRefs: purchaseRefs };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else G.NSTallyIn = API;
})(typeof window !== 'undefined' ? window : this);
