/* NSStock: the stock register underneath stock.niveshsahayak.in (and the closing stock of profit-loss.).
   Like NSBooks, nothing extra is stored for bills: every saved document in the data home is read on the fly.
   Pure functions: the page passes in documents and item masters and gets movements, a summary and item ledgers back.

   Goods come in:   pbill (purchase bill), self (self invoice), note credit with reason 'ret' (sales return),
                    stk open (opening stock), stk adj with a + quantity (found, extra on count)
   Goods go out:    invoice, cashmemo, pbill return (purchase return), stk adj with a − quantity
                    (damage, own use, free sample, gift, lost or stolen, expired, short on count)
   Record of this site (store 'doc', seller = our business):
     { type:'stk', kind:'open'|'adj', date, no, seller, note, lines:[{ desc, unit, qty, rate, reason }] }
     open: qty = quantity in hand on that date, rate = cost per unit. adj: qty signed (+ in, − out), reason code.
   Which lines count: item masters marked as goods, or any name that was bought, opened or adjusted.
   Services (master kind 'service' or SAC code 99…) and names that were only ever sold are left out.
   Value: weighted average cost of opening stock and purchases (rate after discount, without GST) up to the date, or FIFO
   (first in, first out: the stock in hand is valued at the cost of the latest purchases) when My data › Settings says so
   (meta settings.stockValue 'fifo'; pages call NSStock.valuation(settings.stockValue) after loading). Both are allowed by
   AS 2 (Valuation of Inventories); use the same method every year. Under FIFO a purchase return comes off the newest lot.
   Batch 2 (godowns, batches, manufacturing):
     godown   d.gd on a bill (or it.gd on a line) = the godown the goods left or came into; '' = the main godown.
     move     { type:'stk', kind:'move', from, to, lines:[{ desc, unit, qty, batch }] }: stock transfer between godowns
              (the business's total does not change, so the summary of all godowns leaves transfers out).
     make     { type:'stk', kind:'make', gd, out:{ desc, unit, qty, rate, batch, exp }, lines:[{ desc, unit, qty }], extra }:
              production; raw material lines go out, the finished item comes in at out.rate (cost of the raw material
              at average cost plus extra cost, per unit, worked out when it was saved), which joins the average cost.
     batch    it.batch, it.exp (YYYY-MM, usable to the end of that month), it.serial (serial / IMEI numbers, comma separated). */
(function (G) {
  'use strict';
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; }
  function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function r3(n) { return Math.round((n + Number.EPSILON) * 1000) / 1000; }
  function key(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  var OUTR = { damage: 1, own: 1, sample: 1, gift: 1, lost: 1, expired: 1, short: 1, jwloss: 1 };   /* jwloss: loss and waste at the job worker (ITC-04), not theft */
  var INR = { found: 1, extra: 1 };

  function bizOf(d) { return key(d.seller && d.seller.name); }
  function lineQty(it) { return it.qty === '' || it.qty == null ? 1 : num(it.qty); }
  function lineCost(it) { var r = num(it.rate); return r2(r - r * num(it.disc) / 100); }
  function isService(m, it) { return m && m.kind === 'service' || /^99/.test(String(it && it.hsn || m && m.hsn || '').replace(/\D/g, '')); }

  function serialsOf(it) { return String(it && it.serial || '').split(/[,;\n]+/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function mv(k, name, unit, d, q, rate, src, reason, gd, it) {
    return { k: k, name: name, unit: unit, date: d.date || '', qty: r3(q), rate: rate, src: src, reason: reason || '', d: d,
      g: String(gd || '').trim(), batch: String(it && it.batch || '').trim(), exp: String(it && it.exp || '').trim(), sn: serialsOf(it) };
  }
  /* godown filter: gd null/'' = the whole business (transfers left out), else that godown ('main' = the main godown, '') */
  var MAIN = 'main';
  function gdOk(x, gd) { if (gd == null || gd === '') return x.src !== 'move'; return key(x.g || MAIN) === key(gd); }

  /* every stock movement of one business, in date order: { k, name, unit, date, qty (+ in / − out), rate (cost, in only), src, reason, d } */
  /* manufacturing extras (mfgcore.js): job work, by-products and second units become plain records first */
  function mfg() { return G.NSMfg || (typeof require === 'function' ? require('./mfgcore.js') : null); }
  function moves(docs, items, biz) {
    var b = key(biz), M = {}, out = [], X = mfg(); if (X) docs = X.expand(docs, items);
    (items || []).forEach(function (m) { if (m && m.desc) M[key(m.desc)] = m; });
    (docs || []).forEach(function (d) {
      if (b && bizOf(d) !== b) return;
      var ty = d.type || 'invoice', src = '', sign = 0;
      if (ty === 'stk' && d.kind === 'move') {
        (d.lines || []).forEach(function (it) {
          var nm = String(it.desc || '').trim(), q = num(it.qty); if (!nm || !q) return;
          var k = key(nm), m = M[k];
          [[d.from, -q], [d.to, q]].forEach(function (p) { out.push(mv(k, m ? m.desc : nm, it.unit || m && m.unit || '', d, p[1], null, 'move', '', p[0], it)); });
        });
        return;
      }
      if (ty === 'stk' && d.kind === 'make') {
        var o = d.out || {}, onm = String(o.desc || '').trim(), oq = num(o.qty);
        (d.lines || []).forEach(function (it) {
          var nm = String(it.desc || '').trim(), q = num(it.qty); if (!nm || !q) return;
          var k = key(nm), m = M[k]; if (isService(m, it)) return;
          out.push(mv(k, m ? m.desc : nm, it.unit || m && m.unit || '', d, -q, null, 'use', '', d.gd, it));
        });
        if (onm && oq) { var ok = key(onm), om = M[ok]; out.push(mv(ok, om ? om.desc : onm, o.unit || om && om.unit || '', d, oq, num(o.rate), 'make', '', d.gd, o)); }
        return;
      }
      if (ty === 'stk') src = d.kind === 'open' ? 'open' : 'adj';
      else if (ty === 'pbill') { src = d.kind === 'return' ? 'pret' : 'buy'; sign = d.kind === 'return' ? -1 : 1; }
      else if (ty === 'self') { src = 'buy'; sign = 1; }
      else if (ty === 'invoice' || ty === 'cashmemo') { src = 'sale'; sign = -1; }
      else if (ty === 'note' && d.side === 'purchase') { if (d.kind === 'debit' && d.reason === 'ret') { src = 'pret'; sign = -1; } }   /* goods sent back to the supplier */
      else if (ty === 'note' && d.kind !== 'debit' && d.reason === 'ret') { src = 'sret'; sign = 1; }
      if (!src) return;
      (src === 'open' || src === 'adj' ? d.lines : d.items || []).forEach(function (it) {
        var nm = String(it.desc || '').trim(); if (!nm) return;
        var k = key(nm), m = M[k];
        if (isService(m, it)) return;
        var q, rate = null;
        if (src === 'open') { q = num(it.qty); rate = num(it.rate); }
        else if (src === 'adj') { q = num(it.qty); if (OUTR[it.reason] && q > 0) q = -q; if (INR[it.reason] && q < 0) q = -q; }
        else { q = sign * lineQty(it); if (src === 'buy') rate = lineCost(it); }
        if (!q) return;
        out.push(mv(k, m ? m.desc : nm, it.unit || m && m.unit || '', d, q, rate, src, it.reason || '', it.gd != null && it.gd !== '' ? it.gd : d.gd, it));
      });
    });
    var ORD = { open: 0, buy: 1, sret: 1, make: 1, move: 2, use: 2, adj: 2, pret: 3, sale: 3 };
    out.sort(function (x, y) { return x.date.localeCompare(y.date) || ORD[x.src] - ORD[y.src] || (x.d.created || 0) - (y.d.created || 0); });
    return out;
  }

  /* which names the register follows: goods masters + anything bought, opened or adjusted */
  function tracked(mv, items) {
    var T = {};
    (items || []).forEach(function (m) { if (m && m.desc && m.kind === 'goods' && !isService(m)) T[key(m.desc)] = { k: key(m.desc), name: m.desc, unit: m.unit || '', min: num(m.min), m: m }; });
    var M = {}; (items || []).forEach(function (m) { if (m && m.desc) M[key(m.desc)] = m; });
    mv.forEach(function (x) {
      if (x.src === 'sale' || x.src === 'sret') return;
      if (!T[x.k]) T[x.k] = { k: x.k, name: x.name, unit: x.unit, min: num(M[x.k] && M[x.k].min), m: M[x.k] || null };
      if (!T[x.k].unit && x.unit) T[x.k].unit = x.unit;
    });
    return T;
  }

  /* summary of every tracked item for a period: opening, in, out, adjust, closing, average cost, value, low */
  function summary(docs, items, biz, from, to, gd, how) {
    var all = moves(docs, items, biz), T = tracked(all, items), S = {}, CQ = {};
    var mv = all.filter(function (x) { return gdOk(x, gd); });
    /* average cost is the business's own, whichever godown the goods sit in */
    all.forEach(function (x) { if (to && x.date > to || x.rate == null || x.qty <= 0) return; var c = CQ[x.k] = CQ[x.k] || [0, 0]; c[0] += x.qty; c[1] += x.qty * x.rate; });
    Object.keys(T).forEach(function (k) { S[k] = { k: k, name: T[k].name, unit: T[k].unit, min: T[k].min, m: T[k].m, open: 0, inq: 0, outq: 0, adj: 0, close: 0, n: 0 }; });
    mv.forEach(function (x) {
      var s = S[x.k]; if (!s) return;
      if (to && x.date > to) return;
      if (!from || x.date < from || x.src === 'open') s.open += x.qty;
      else if (x.src === 'adj') s.adj += x.qty;
      else if (x.qty > 0) s.inq += x.qty;
      else s.outq -= x.qty;
      s.n++;
    });
    var tot = 0, low = 0, neg = 0, fifo = (how || VAL) === 'fifo', BQ = {};
    /* FIFO: the business's own quantity in hand (all godowns) is valued from the newest lots back */
    if (fifo) all.forEach(function (x) { if (to && x.date > to || x.src === 'move') return; BQ[x.k] = (BQ[x.k] || 0) + x.qty; });
    var list = Object.keys(S).map(function (k) {
      var s = S[k];
      s.open = r3(s.open); s.inq = r3(s.inq); s.outq = r3(s.outq); s.adj = r3(s.adj);
      s.close = r3(s.open + s.inq - s.outq + s.adj);
      var c = CQ[k]; s.cost = c && c[0] > 0 ? r2(c[1] / c[0]) : 0;
      if (fifo) { var bq = r3(BQ[k] || 0), fv = bq > 0 ? fifoValue(all, k, to, bq, s.cost) : 0; if (bq > 0) s.cost = r2(fv / bq); s.value = s.close > 0 ? (s.close === bq ? fv : r2(s.close * s.cost)) : 0; }
      else s.value = s.close > 0 ? r2(s.close * s.cost) : 0;
      s.low = s.min > 0 && s.close <= s.min;
            tot = r2(tot + s.value); if (s.low) low++; if (s.close < 0) neg++;
      return s;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    return { items: list, value: tot, low: low, neg: neg };
  }

  /* stock valuation method of the books: 'avg' (weighted average, the default) or 'fifo'; summary(..., how) can ask for either */
  var VAL = 'avg';
  function valuation(m) { if (m !== undefined) VAL = m === 'fifo' ? 'fifo' : 'avg'; return VAL; }
  /* FIFO value of qty units of item k in hand on `to`: lots bought (opening stock, purchases, production) in date order, a purchase
     return takes its quantity off the newest lots; the stock in hand is the newest lots. A quantity with no priced lot left
     (for example goods found on a count) is valued at `fallback` (the average cost). */
  function fifoValue(mv, k, to, qty, fallback) {
    var lots = [];
    mv.forEach(function (x) {
      if (x.k !== k || to && x.date > to) return;
      if (x.rate != null && x.qty > 0) lots.push([x.qty, x.rate]);
      else if (x.src === 'pret') { var q = -x.qty; for (var i = lots.length - 1; i >= 0 && q > 0; i--) { var t = Math.min(q, lots[i][0]); lots[i][0] -= t; q -= t; } }
    });
    var left = qty, v = 0;
    for (var j = lots.length - 1; j >= 0 && left > 0.0005; j--) { var u = Math.min(left, lots[j][0]); v += u * lots[j][1]; left -= u; }
    if (left > 0.0005) v += left * (fallback || 0);
    return r2(v);
  }

  /* one item's register: opening, rows with running balance, closing */
  function ledger(docs, items, biz, k, from, to, gd) {
    var open = 0, rows = [], bal;
    moves(docs, items, biz).forEach(function (x) {
      if (x.k !== k || to && x.date > to || !gdOk(x, gd)) return;
      if (from && x.date < from) { open = r3(open + x.qty); return; }
      rows.push(x);
    });
    bal = open;
    rows.forEach(function (r) { bal = r3(bal + r.qty); r.bal = bal; });
    return { open: open, rows: rows, close: bal, inq: r3(rows.reduce(function (a, r) { return a + (r.qty > 0 ? r.qty : 0); }, 0)), outq: r3(rows.reduce(function (a, r) { return a + (r.qty < 0 ? -r.qty : 0); }, 0)) };
  }

  /* quantity in hand of every tracked item on a date (for the count sheet and the adjustment form) */
  function inHand(docs, items, biz, upto, gd) {
    var o = {}; summary(docs, items, biz, '', upto, gd).items.forEach(function (s) { o[s.k] = s.close; }); return o;
  }

  /* stock of each godown up to a date: [{ g ('' = main), value, n (items in hand), neg }]; names = godowns set in Settings */
  function godowns(docs, items, biz, upto, names) {
    var seen = {}, out = [];
    [''].concat(names || []).concat(moves(docs, items, biz).map(function (x) { return x.g; })).forEach(function (g) {
      var k = key(g || MAIN); if (seen[k]) return; seen[k] = 1;
      var s = summary(docs, items, biz, '', upto, g || MAIN);
      out.push({ g: g || '', value: s.value, n: s.items.filter(function (x) { return x.close; }).length, neg: s.neg, items: s.items });
    });
    return out;
  }

  /* expiry month YYYY-MM -> last day of that month (goods may be used until then) */
  function expEnd(m) { if (!/^\d{4}-\d{2}$/.test(m || '')) return ''; var d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)); return d.toISOString().slice(0, 10); }
  /* batches in hand of one item (k) or every item: [{ k, name, batch, exp, qty }], qty > 0 only.
     Goods going out take their own batch first; what is left (or a line without a batch) takes the earliest expiry first. */
  function batches(docs, items, biz, k, upto, gd) {
    var by = {}, order = [];
    moves(docs, items, biz).forEach(function (x) {
      if (k && x.k !== k || upto && x.date > upto || !gdOk(x, gd)) return;
      var id = x.k + '|' + key(x.batch);
      if (x.qty > 0) { if (!by[id]) { by[id] = { k: x.k, name: x.name, batch: x.batch, exp: x.exp, qty: 0 }; order.push(id); } if (x.exp && !by[id].exp) by[id].exp = x.exp; by[id].qty = r3(by[id].qty + x.qty); return; }
      var need = -x.qty;
      if (x.batch && by[id]) { var t = Math.min(need, by[id].qty); by[id].qty = r3(by[id].qty - t); need = r3(need - t); }
      order.filter(function (o) { return by[o].k === x.k && by[o].qty > 0; }).sort(function (a, b) { return (by[a].exp || '9999').localeCompare(by[b].exp || '9999'); }).forEach(function (o) {
        if (need <= 0) return; var t2 = Math.min(need, by[o].qty); by[o].qty = r3(by[o].qty - t2); need = r3(need - t2);
      });
    });
    return order.map(function (o) { return by[o]; }).filter(function (b) { return b.qty > 0.0005; });
  }
  /* batches that expire within `days` of today (or have expired), earliest first */
  function expiring(docs, items, biz, today, days) {
    var lim = new Date(Date.parse(today + 'T00:00:00Z') + (days || 0) * 864e5).toISOString().slice(0, 10);
    return batches(docs, items, biz, '', today).filter(function (b) { var e = expEnd(b.exp); return e && e <= lim; })
      .map(function (b) { b.end = expEnd(b.exp); b.gone = b.end < today; return b; }).sort(function (a, b) { return a.end.localeCompare(b.end); });
  }
  /* serial / IMEI numbers: in hand, and where each one went (last movement) */
  function serials(docs, items, biz, k) {
    var have = {}, went = {};
    moves(docs, items, biz).forEach(function (x) {
      if (k && x.k !== k || x.src === 'move') return;
      x.sn.forEach(function (n) { var nk = key(n); if (x.qty > 0) { have[nk] = { sn: n, k: x.k, name: x.name, d: x.d }; delete went[nk]; } else { delete have[nk]; went[nk] = { sn: n, k: x.k, name: x.name, d: x.d }; } });
    });
    return { inHand: Object.keys(have).map(function (n) { return have[n]; }), out: Object.keys(went).map(function (n) { return went[n]; }) };
  }
  /* cost of raw material at average cost on a date: { lines: [{ k, qty, cost, value, have }], total } */
  function makeCost(docs, items, biz, lines, date) {
    var S = {}; summary(docs, items, biz, '', date).items.forEach(function (s) { S[s.k] = s; });
    var tot = 0, out = (lines || []).map(function (l) { var k = key(l.desc), c = S[k] ? S[k].cost : 0, v = r2(num(l.qty) * c); tot += v; return { k: k, qty: num(l.qty), cost: c, value: v, have: S[k] ? S[k].close : 0 }; });
    return { lines: out, total: r2(tot) };
  }

  /* ---------- Stock ledger (groups, ledgers of many items, godown and batch views, movement report) ----------
     Item groups (meta 'groups'.item = [{ id, name, under }], under = '' or a top group id; one level of sub-groups).
     An item's group: item.group (id), else a group named like item.cat, else the category itself as a group of its own
     (so categories typed so far show as groups), else no group. NS.itemGroup in core.js, when there, decides instead. */
  function itemGroupOf(m, groups) {
    var G = groups || [], g = m && m.group ? G.filter(function (x) { return x.id === m.group; })[0] : null;
    if (!g && m && m.cat) g = G.filter(function (x) { return key(x.name) === key(m.cat); })[0] || { id: 'cat:' + key(m.cat), name: String(m.cat).trim(), under: '' };
    if (!g) return { id: '', name: '', top: '' };
    return { id: g.id, name: g.name, top: g.under || '' };
  }
  /* list of rows (anything with .m = item master) sorted into groups: [{ id, name, list, subs: [{ id, name, list, tot }], tot }]
     gOf(m) -> { id, name, top }; fields = the numbers to add up; groups without a name ("No group") come last */
  function groupTree(list, gOf, groups, fields) {
    var G = groups || [], T = {}, order = [];
    function nameOf(id) { var g = G.filter(function (x) { return x.id === id; })[0]; return g ? g.name : ''; }
    function node(id, name) { if (!T[id]) { T[id] = { id: id, name: name, list: [], subs: [], S: {}, tot: {} }; order.push(id); } return T[id]; }
    function add(tot, x) { (fields || []).forEach(function (f) { tot[f] = r3((tot[f] || 0) + num(x[f])); }); tot.n = (tot.n || 0) + 1; }
    (list || []).forEach(function (x) {
      var g = gOf(x.m || null) || {}, top = g.top ? node(g.top, g.topName || nameOf(g.top) || g.top) : node(g.id || '', g.name || '');
      if (g.top) { var s = top.S[g.id]; if (!s) { s = top.S[g.id] = { id: g.id, name: g.name, list: [], tot: {} }; top.subs.push(s); } s.list.push(x); add(s.tot, x); }
      else top.list.push(x);
      add(top.tot, x);
    });
    return order.map(function (id) { var n = T[id]; delete n.S; n.subs.sort(function (a, b) { return a.name.localeCompare(b.name); }); return n; })
      .sort(function (a, b) { return !a.id - !b.id || a.name.localeCompare(b.name); });
  }
  /* voucher type of a movement, for the ledger filter */
  var VT = { open: 'open', buy: 'buy', sret: 'sret', sale: 'sale', pret: 'pret', adj: 'adj', move: 'move', make: 'make', use: 'make' };
  function partyOf(x) { var d = x.d || {}; if (x.src === 'move') return (d.from || 'Main') + ' → ' + (d.to || 'Main'); return d.buyer && d.buyer.name || ''; }
  /* ledgers of many items at once.  o = { keys: [k] (null = every tracked item), from, to, gd (godown, see gdOk), types: { vt: 1 } (null = all) }
     Each: { k, name, unit, m, open, openValue, rows: [{ date, vt, no, party, inq, outq, bal, cost, value, neg, x }], inq, outq, close, cost, value, neg }
     The running balance counts every movement; the type filter only hides rows (their in/out leave the totals too).
     cost = weighted average cost of everything that came in up to that row's date (the summary's cost at `to`). */
  function ledgers(docs, items, biz, o) {
    o = o || {};
    var all = moves(docs, items, biz), T = tracked(all, items), want = o.keys ? {} : null, by = {};
    if (want) o.keys.forEach(function (k) { want[k] = 1; });
    all.forEach(function (x) { if (T[x.k] && (!want || want[x.k])) (by[x.k] = by[x.k] || []).push(x); });
    return Object.keys(T).filter(function (k) { return !want || want[k]; }).map(function (k) {
      var t = T[k], open = 0, bal = 0, rows = [], inq = 0, outq = 0, neg = 0, c = [0, 0], oc = 0;
      function cost() { return c[0] > 0 ? r2(c[1] / c[0]) : 0; }
      (by[k] || []).forEach(function (x) {
        if (o.to && x.date > o.to) return;
        if (o.from && x.date >= o.from && !oc) oc = cost() || -1;
        if (x.rate != null && x.qty > 0) { c[0] += x.qty; c[1] += x.qty * x.rate; }
        if (!gdOk(x, o.gd)) return;
        bal = r3(bal + x.qty);
        if (o.from && x.date < o.from) { open = bal; return; }
        var vt = x.d && x.d._job ? 'job' : VT[x.src] || x.src, cc = cost(), row = { date: x.date, vt: vt, src: x.src, reason: x.reason, no: x.d.no || x.d.billNo || '', party: partyOf(x),
          inq: x.qty > 0 ? x.qty : 0, outq: x.qty < 0 ? -x.qty : 0, bal: bal, cost: cc, value: bal > 0 ? r2(bal * cc) : 0, neg: bal < 0, batch: x.batch, x: x };
        if (row.neg) neg++;
        if (o.types && !o.types[vt]) return;
        inq = r3(inq + row.inq); outq = r3(outq + row.outq); rows.push(row);
      });
      if (!oc) oc = cost();
      return { k: k, name: t.name, unit: t.unit, m: t.m, min: t.min, open: open, openValue: open > 0 && oc > 0 ? r2(open * oc) : 0, rows: rows, inq: inq, outq: outq,
        close: bal, cost: cost(), value: bal > 0 ? r2(bal * cost()) : 0, neg: neg };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  /* totals of several ledgers (a group, or all items): { open, inq, outq, close, openValue, value, neg (items that went below zero) } */
  function ledgerTotals(L) {
    var t = { open: 0, inq: 0, outq: 0, close: 0, openValue: 0, value: 0, neg: 0 };
    (L || []).forEach(function (l) { ['open', 'inq', 'outq', 'close'].forEach(function (f) { t[f] = r3(t[f] + l[f]); }); t.openValue = r2(t.openValue + l.openValue); t.value = r2(t.value + l.value); t.neg += l.neg ? 1 : 0; });
    return t;
  }
  /* stock of every item in each godown on a date: { gds: ['' (main), names…], keys (godown keys, same order), rows: [{ k, name, unit, m, q: { godown key: qty }, total, value }], tot } */
  function godownMatrix(docs, items, biz, upto, names) {
    var G = godowns(docs, items, biz, upto, names), R = {}, tot = {};
    G.forEach(function (g) {
      var gk = key(g.g || MAIN);
      g.items.forEach(function (s) {
        var r = R[s.k] = R[s.k] || { k: s.k, name: s.name, unit: s.unit, m: s.m, q: {}, total: 0, value: 0 };
        r.q[gk] = s.close; r.total = r3(r.total + s.close); tot[gk] = r3((tot[gk] || 0) + s.close);
      });
    });
    var S = {}; summary(docs, items, biz, '', upto).items.forEach(function (s) { S[s.k] = s; });
    var rows = Object.keys(R).map(function (k) { var r = R[k]; r.value = S[k] ? S[k].value : 0; return r; })
      .filter(function (r) { return Object.keys(r.q).some(function (g) { return r.q[g]; }); }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    return { gds: G.map(function (g) { return g.g; }), keys: G.map(function (g) { return key(g.g || MAIN); }), rows: rows, tot: tot };
  }
  /* each batch of one item with its own in, out and balance: [{ batch, exp, end, open, rows: [{ date, vt, no, party, inq, outq, bal, neg, x }], inq, outq, close }]
     Goods going out take their own batch first, then the earliest expiry first (as batches()); what no batch can cover
     stays on the line's own batch (or "no batch") as a minus balance, so the warning shows where it happened. */
  function batchLedger(docs, items, biz, k, from, to, gd) {
    var by = {}, order = [];
    function get(b, exp) { var id = key(b); if (!by[id]) { by[id] = { batch: b || '', exp: exp || '', bal: 0, open: 0, rows: [], inq: 0, outq: 0 }; order.push(id); } if (exp && !by[id].exp) by[id].exp = exp; return by[id]; }
    function put(B, x, q) {
      B.bal = r3(B.bal + q);
      if (from && x.date < from) { B.open = B.bal; return; }
      var r = { date: x.date, vt: x.d && x.d._job ? 'job' : VT[x.src] || x.src, src: x.src, reason: x.reason, no: x.d.no || x.d.billNo || '', party: partyOf(x), inq: q > 0 ? q : 0, outq: q < 0 ? -q : 0, bal: B.bal, neg: B.bal < 0, x: x };
      B.inq = r3(B.inq + r.inq); B.outq = r3(B.outq + r.outq); B.rows.push(r);
    }
    moves(docs, items, biz).forEach(function (x) {
      if (x.k !== k || to && x.date > to || !gdOk(x, gd)) return;
      if (x.qty > 0) { put(get(x.batch, x.exp), x, x.qty); return; }
      var need = r3(-x.qty), own = x.batch && by[key(x.batch)];
      if (own && own.bal > 0) { var t = Math.min(need, own.bal); put(own, x, -t); need = r3(need - t); }
      order.map(function (id) { return by[id]; }).filter(function (b) { return b.bal > 0; }).sort(function (a, b) { return (a.exp || '9999').localeCompare(b.exp || '9999'); }).forEach(function (b) {
        if (need <= 0) return; var t2 = Math.min(need, b.bal); put(b, x, -t2); need = r3(need - t2);
      });
      if (need > 0.0005) put(get(x.batch, x.exp), x, -need);
    });
    return order.map(function (id) { var b = by[id]; b.close = b.bal; b.end = expEnd(b.exp); delete b.bal; return b; })
      .filter(function (b) { return b.rows.length || b.open; })
      .sort(function (a, b) { return (a.exp || '9999').localeCompare(b.exp || '9999') || a.batch.localeCompare(b.batch); });
  }
  /* fast, slow and non-moving items.  Period from..to; days = no movement for this many days up to `to` (default 90).
     sold = quantity sold in the period (sales less sales returns); lastSale = last sale up to `to`; lastMove = last movement
     of any kind except opening stock and godown transfers; idle = days since lastMove (or since the first entry);
     cover = days the closing stock lasts at the period's selling speed.
     fast = the top third of the items sold in the period by value sold at cost (at least one);
     none = in hand and nothing moved for `days` days; slow = every other item sold or in hand. */
  function movement(docs, items, biz, from, to, days) {
    days = days == null || days === '' ? 90 : num(days);
    var all = moves(docs, items, biz), T = tracked(all, items), S = {}, A = {};
    summary(docs, items, biz, from, to).items.forEach(function (s) { S[s.k] = s; });
    Object.keys(T).forEach(function (k) { A[k] = { k: k, name: T[k].name, unit: T[k].unit, m: T[k].m, sold: 0, lastSale: '', lastMove: '', first: '' }; });
    all.forEach(function (x) {
      var a = A[x.k]; if (!a || to && x.date > to || x.src === 'move') return;
      if (!a.first) a.first = x.date;
      if (x.src !== 'open') a.lastMove = x.date;
      if (x.src === 'sale') a.lastSale = x.date;
      /* raw material used in production moves too: a manufacturer's sheet and handles are not "slow" (round C) */
      if ((x.src === 'sale' || x.src === 'sret' || x.src === 'use') && (!from || x.date >= from)) a.sold = r3(a.sold - x.qty);
      if (x.src === 'use' && (!a.lastSale || x.date > a.lastSale)) a.lastSale = x.date;
    });
    var span = from && to ? Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1) : 0;
    var cut = to ? new Date(Date.parse(to + 'T00:00:00Z') - days * 864e5).toISOString().slice(0, 10) : '';
    var list = Object.keys(A).map(function (k) {
      var a = A[k], s = S[k] || {}, since = a.lastMove || a.first;
      a.close = s.close || 0; a.cost = s.cost || 0; a.value = s.value || 0; a.soldValue = r2(Math.max(0, a.sold) * a.cost);
      a.idle = to && since ? Math.round((Date.parse(to) - Date.parse(since)) / 864e5) : null;
      a.cover = span && a.sold > 0 && a.close > 0 ? Math.round(a.close / (a.sold / span)) : null;
      a.cls = ''; a.rank = 0;
      return a;
    });
    var sold = list.filter(function (a) { return a.sold > 0; }).sort(function (a, b) { return b.soldValue - a.soldValue || b.sold - a.sold; }), nf = Math.max(1, Math.ceil(sold.length / 3));
    sold.forEach(function (a, i) { a.rank = i + 1; if (i < nf) a.cls = 'fast'; });
    list.forEach(function (a) {
      if (a.cls) return;
      if (a.close > 0 && cut && (a.lastMove || a.first) <= cut) a.cls = 'none';
      else if (a.close > 0 || a.sold > 0) a.cls = 'slow';
    });
    var order = { fast: 0, slow: 1, none: 2 };
    return list.filter(function (a) { return a.cls; }).sort(function (a, b) { return order[a.cls] - order[b.cls] || (a.rank || 1e9) - (b.rank || 1e9) || b.value - a.value || a.name.localeCompare(b.name); });
  }

  var API = { num: num, r2: r2, r3: r3, key: key, moves: moves, tracked: tracked, summary: summary, ledger: ledger, inHand: inHand, OUTR: OUTR, INR: INR,
    MAIN: MAIN, godowns: godowns, batches: batches, expiring: expiring, expEnd: expEnd, serials: serials, serialsOf: serialsOf, makeCost: makeCost };
  /* Stock ledger additions */
  API.itemGroupOf = itemGroupOf; API.groupTree = groupTree; API.VT = VT; API.ledgers = ledgers; API.ledgerTotals = ledgerTotals;
  /* stock valuation (FIFO or weighted average) */
  API.valuation = valuation; API.fifoValue = fifoValue;
  API.godownMatrix = godownMatrix; API.batchLedger = batchLedger; API.movement = movement;
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else G.NSStock = API;
})(this);
