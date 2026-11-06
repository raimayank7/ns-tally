/* NSTF: final accounts in the traditional T format (horizontal), the way shop owners, firms, their accountants, banks and
   Tally show them. Pure functions over the same trial balance lines as the Schedule III view (NSPL.fromBooks: rows with a
   head g, dr, cr), so both views always give the same net profit and the same balance sheet totals.
     Trading account     Dr: opening stock, purchases less returns, materials, direct expenses, gross profit c/d
                         Cr: sales less returns, closing stock, gross loss c/d
     Profit and loss     Dr: gross loss b/d, indirect expenses, depreciation, interest, tax, net profit (to capital)
                         Cr: gross profit b/d, other income, net loss
     Balance sheet       Liabilities: capital account (per owner / partner), loans, sundry creditors, duties and taxes,
                         other current liabilities | Assets: fixed assets, investments, closing stock, sundry debtors,
                         cash, bank, loans and advances, GST input credit, TDS receivable
   Direct or indirect: every expense line of the heads 'emp' and 'oth' (depreciation, interest and tax always stay in the
   profit and loss part). Defaults follow Tally practice: freight inward / transport on purchases, carriage, wages, factory
   power and fuel, packing for production are direct; everything else indirect. The user changes it per expense in
   My data › Settings: settings.tf = { fmt: '' (by business type) | 't' | 'v', dx: { account key: true | false } };
   a typed line (profit-loss.) carries its own dx.
   Each output line: { t (what it is), v (amount), row (the trial balance line, when it is one), parts (inner lines), name }.
   Screens put the words on it: English on paper, the user's language on screen. */
(function (G) {
  'use strict';
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; }
  function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function key(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  var CRH = { cap: 1, res: 1, ltb: 1, stb: 1, tpay: 1, ocl: 1, rev: 1, oinc: 1 };
  function amt(x) { return CRH[x.g] ? r2(num(x.cr) - num(x.dr)) : r2(num(x.dr) - num(x.cr)); }

  /* a company files Schedule III (vertical); proprietors and firms keep the T format. Company = PAN holder type C
     (4th letter of the PAN, 6th of the GSTIN) or a constitution naming a company */
  function isCompany(biz) {
    biz = biz || {};
    var c = String(biz.constitution || biz.gst && (biz.gst.constitution || biz.gst.const) || '');
    if (/company|limited|pvt|private ltd/i.test(c)) return true;
    var pan = String(biz.pan || '').toUpperCase(), g = String(biz.gstin || '').toUpperCase();
    return pan.length === 10 ? pan[3] === 'C' : g.length === 15 ? g[5] === 'C' : false;
  }
  function fmt(settings, biz) {
    var f = settings && settings.tf && settings.tf.fmt;
    return f === 't' || f === 'v' ? f : isCompany(biz) ? 'v' : 't';
  }

  /* expense codes of the App's expense form (app.js EXP) that are direct by default */
  var DIRECT_CODES = { transport: 1, fuel: 1 }, INDIRECT_CODES = { rent: 1, power: 1, salary: 1, phone: 1, repair: 1, office: 1, bank: 1, prof: 1, ads: 1, misc: 1 };
  var DIRECT_RE = /freight|carriage|cartage|wage|factory|packing|loading|unloading|octroi|import duty|custom duty|customs|clearing|power and fuel|coal|job ?work|manufactur|production|labour|labor|majdoori|mazdoori|hammali/;
  /* default for an account key (exp:transport) and its name */
  function defaultDirect(k, name) {
    var code = String(k || '').indexOf('exp:') === 0 ? String(k).slice(4) : '';
    if (DIRECT_CODES[code]) return true;
    if (INDIRECT_CODES[code]) return false;   /* the App's own heads: office salary, office electricity ... */
    var n = key(name) + ' ' + key(code);
    if (/office|admin|sales|selling|outward/.test(n)) return false;
    return DIRECT_RE.test(n);
  }
  /* can this trial balance line be a direct expense at all */
  function canDirect(x) { return (x.g === 'emp' || x.g === 'oth') && x.k !== 'round-off'; }
  function isDirect(x, dx) {
    if (!canDirect(x)) return false;
    if (x.dx != null) return !!x.dx;   /* a typed line says it itself */
    if (dx && dx[x.k] != null) return !!dx[x.k];
    return defaultDirect(x.k, x.en || x.name);
  }

  /* Trading and Profit and Loss Account. rows = trial balance lines, cs = closing stock, dx = settings.tf.dx */
  function tradingPL(rows, cs, dx) {
    cs = r2(num(cs));
    var os = 0, sal = 0, sret = 0, pur = 0, pret = 0, mat = [], dir = [], ind = [], dep = [], fin = [], tax = [], oinc = [];
    rows.forEach(function (x) {
      var v = amt(x);
      if (x.g === 'osk') os = r2(os + v);
      else if (x.g === 'rev') { if (x.k === 'sales-return') sret = r2(sret - v); else sal = r2(sal + v); }
      else if (x.g === 'pur') { if (x.k === 'purchase-return') pret = r2(pret - v); else pur = r2(pur + v); }
      else if (x.g === 'mat') mat.push({ t: 'row', row: x, v: v });
      else if (x.g === 'emp' || x.g === 'oth') (isDirect(x, dx) ? dir : ind).push({ t: 'row', row: x, v: v });
      else if (x.g === 'dep') dep.push({ t: 'row', row: x, v: v });
      else if (x.g === 'fin') fin.push({ t: 'row', row: x, v: v });
      else if (x.g === 'tax') tax.push({ t: 'row', row: x, v: v });
      else if (x.g === 'oinc') oinc.push({ t: 'row', row: x, v: v });
    });
    function sum(a) { return r2(a.reduce(function (s, y) { return s + y.v; }, 0)); }
    var salesNet = r2(sal - sret), purNet = r2(pur - pret);
    var gross = r2(salesNet + cs - os - purNet - sum(mat) - sum(dir));
    var trDr = [], trCr = [];
    if (os) trDr.push({ t: 'osk', v: os });
    if (pur || pret) trDr.push({ t: 'pur', v: purNet, parts: pret ? [{ t: 'purg', v: pur }, { t: 'pret', v: pret }] : null });
    trDr = trDr.concat(mat);
    if (dir.length) trDr.push({ t: 'dirh', v: sum(dir), parts: dir });
    if (gross >= 0) trDr.push({ t: 'gpcd', v: gross });
    if (sal || sret) trCr.push({ t: 'sales', v: salesNet, parts: sret ? [{ t: 'salg', v: sal }, { t: 'sret', v: sret }] : null });
    trCr.push({ t: 'csk', v: cs });
    if (gross < 0) trCr.push({ t: 'glcd', v: -gross });
    var trTot = r2(Math.max(sum(trDr), sum(trCr)));
    var net = r2(gross + sum(oinc) - sum(ind) - sum(dep) - sum(fin) - sum(tax));
    var plDr = [], plCr = [];
    if (gross < 0) plDr.push({ t: 'glbd', v: -gross });
    if (ind.length) plDr.push({ t: 'indh', v: sum(ind), parts: ind });
    plDr = plDr.concat(dep, fin, tax);
    if (net >= 0) plDr.push({ t: 'np', v: net });
    if (gross >= 0) plCr.push({ t: 'gpbd', v: gross });
    plCr = plCr.concat(oinc);
    if (net < 0) plCr.push({ t: 'nl', v: -net });
    var plTot = r2(Math.max(sum(plDr), sum(plCr)));
    return { tr: { dr: trDr, cr: trCr, tot: trTot, drTot: sum(trDr), crTot: sum(trCr) }, pl: { dr: plDr, cr: plCr, tot: plTot, drTot: sum(plDr), crTot: sum(plCr) },
      gross: gross, net: net, os: os, cs: cs, sales: salesNet, purchases: purNet, direct: sum(dir), indirect: sum(ind) };
  }

  /* Balance sheet. opt: { capOpen: { account key: credit balance on the day before the period }, dep: { fa account: depreciation
     of the period } }. Capital accounts are cap:<owner> / drw:<owner> (finrep.js capital form); with one owner (or none) every
     capital line is one capital account, with several each partner gets an account and the rest stays undivided.
     opt.firm = NSFA.firm(...) for a partnership firm / LLP (famore.js A.famFirm): each partner's capital account then carries
     interest, salary and share of profit or loss, exactly as the Schedule III balance sheet, nothing left undivided. */
  function balanceSheet(rows, cs, net, opt) {
    opt = opt || {}; cs = r2(num(cs)); net = r2(num(net));
    var capOpen = opt.capOpen || {}, depMap = opt.dep || {};
    var owners = {}, otherCap = 0, otherDrw = [], res = 0, L = [], A = [];
    function own(k, name, row) { var o = owners[k] = owners[k] || { k: k, name: name, open: 0, add: 0, drw: 0 }; if (row && !o.row) o.row = row; return o; }
    var grp = { ltb: [], stb: [], tpay: [], duty: [], ocl: [], ppe: [], ninv: [], trec: [], cash: [], bank: [], chq: [], oca: [], gstin: [], tdsr: [] };
    rows.forEach(function (x) {
      var v = amt(x);
      if (x.g === 'cap') {
        if (x.k.indexOf('cap:') === 0) { var o = own(x.k.slice(4), x.en || x.name, x), op = r2(num(capOpen[x.k])); o.open = r2(o.open + op); o.add = r2(o.add + v - op); }
        else otherCap = r2(otherCap + v);
      } else if (x.g === 'drw') {
        if (x.k.indexOf('drw:') === 0 && (owners[x.k.slice(4)] || rows.some(function (y) { return y.k === 'cap:' + x.k.slice(4); }))) own(x.k.slice(4), '').drw += v;
        else otherDrw.push({ t: 'row', row: x, v: v });
      } else if (x.g === 'res') res = r2(res + v);
      else if (x.g === 'ltb') grp.ltb.push(x);
      else if (x.g === 'stb') grp.stb.push(x);
      else if (x.g === 'tpay') grp.tpay.push(x);
      else if (x.g === 'ocl') (x.k === 'gst' || /^gst-/.test(x.k) || x.k === 'tds-payable' || /\b(gst|tds|tcs|tax|duty|duties|cess)\b/i.test(x.en || x.name || '') ? grp.duty : grp.ocl).push(x);
      else if (x.g === 'ppe') grp.ppe.push(x);
      else if (x.g === 'ninv') grp.ninv.push(x);
      else if (x.g === 'trec') grp.trec.push(x);
      else if (x.g === 'cash') (x.k === 'bank' ? grp.bank : x.k === 'chq-in' ? grp.chq : grp.cash).push(x);
      else if (x.g === 'oca') (x.k === 'gst' || /^gst-/.test(x.k) ? grp.gstin : x.k === 'tds-receivable' ? grp.tdsr : grp.oca).push(x);
    });
    /* owners whose name came only from drawings */
    Object.keys(owners).forEach(function (k) { var o = owners[k]; o.drw = r2(o.drw); if (!o.name) { var d = rows.filter(function (y) { return y.k === 'drw:' + k; })[0]; o.name = d ? d.en || d.name : k; } });
    var list = Object.keys(owners).map(function (k) { return owners[k]; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    function sum(a) { return r2(a.reduce(function (s, y) { return s + y.v; }, 0)); }
    var oDrw = sum(otherDrw), fc = opt.firm && opt.firm.caps && opt.firm.caps.length ? opt.firm.caps : null;
    if (fc) {
      var inF = {}; fc.forEach(function (c) { inF[c.k] = 1; });
      fc.forEach(function (c) {
        var p = [{ t: 'capopen', v: c.open }];
        if (c.intro) p.push({ t: 'capadd', v: c.intro });
        if (c.int) p.push({ t: 'capint', v: c.int });
        if (c.sal) p.push({ t: 'capsal', v: c.sal });
        if (c.share) p.push({ t: c.share < 0 ? 'capshl' : 'capsh', v: c.share });
        if (c.drw) p.push({ t: 'capdrw', v: -c.drw });
        L.push({ t: 'cap', name: c.name, own: owners[c.k] && owners[c.k].row, v: c.close, parts: p });
      });
      /* capital not in a partner's account (an old 'Capital' line, earlier profit) and any gap between the two profit figures */
      var rest = r2(otherCap + res), q = [];
      list.forEach(function (o) { if (!inF[o.k]) rest = r2(rest + o.open + o.add - o.drw); });
      if (rest) q.push({ t: 'capopen', v: rest });
      var gap = r2(net - num(opt.firm.appr && opt.firm.appr.profit));
      if (gap) q.push({ t: gap < 0 ? 'capnl' : 'capnp', v: gap });
      otherDrw.forEach(function (y) { q.push({ t: 'capdrw', row: y.row, v: -y.v }); });
      if (q.length && r2(sum(q))) L.push({ t: 'capo', v: sum(q), parts: q });
    } else if (list.length <= 1) {
      var o1 = list[0] || { k: '', name: '', open: 0, add: 0, drw: 0 };
      var parts = [{ t: 'capopen', v: r2(o1.open + otherCap + res) }];
      if (o1.add) parts.push({ t: 'capadd', v: o1.add });
      parts.push({ t: net < 0 ? 'capnl' : 'capnp', v: net });
      if (o1.drw) parts.push({ t: 'capdrw', v: -o1.drw });
      otherDrw.forEach(function (y) { parts.push({ t: 'capdrw', row: y.row, v: -y.v }); });
      L.push({ t: 'cap', name: o1.name, own: o1.row, v: sum(parts), parts: parts });
    } else {
      list.forEach(function (o) {
        var p = [{ t: 'capopen', v: o.open }]; if (o.add) p.push({ t: 'capadd', v: o.add }); if (o.drw) p.push({ t: 'capdrw', v: -o.drw });
        L.push({ t: 'cap', name: o.name, own: o.row, v: sum(p), parts: p });
      });
      var q = []; if (r2(otherCap + res)) q.push({ t: 'capopen', v: r2(otherCap + res) });
      q.push({ t: net < 0 ? 'capnl' : 'capnp', v: net });
      otherDrw.forEach(function (y) { q.push({ t: 'capdrw', row: y.row, v: -y.v }); });
      L.push({ t: 'capu', v: sum(q), parts: q });
    }
    function rowsOf(a) { return a.map(function (x) { return { t: 'row', row: x, v: amt(x) }; }); }
    function grpLine(t, a, always) { if (!a.length && !always) return; var p = rowsOf(a); L.push({ t: t, v: sum(p), parts: p.length > 1 || always && p.length ? p : null, row: p.length === 1 ? a[0] : null }); }
    grpLine('loans', grp.ltb); grpLine('stl', grp.stb);
    if (grp.tpay.length) L.push({ t: 'cred', v: sum(rowsOf(grp.tpay)), row: grp.tpay[0] });
    grpLine('duty', grp.duty); grpLine('ocl', grp.ocl);
    function aLine(t, a, always) { if (!a.length && !always) return; var p = rowsOf(a); A.push({ t: t, v: sum(p), parts: p.length > 1 ? p : null, row: p.length === 1 ? a[0] : null }); }
    if (grp.ppe.length) {
      var fp = grp.ppe.map(function (x) {
        var v = amt(x), d = r2(num(depMap[x.k]));
        return { t: 'row', row: x, v: v, parts: d ? [{ t: 'fagross', v: r2(v + d) }, { t: 'fadep', v: -d }] : null };
      });
      A.push({ t: 'fa', v: sum(fp), parts: fp });
    }
    aLine('inv', grp.ninv);
    A.push({ t: 'csk', v: cs });
    if (grp.trec.length) A.push({ t: 'debt', v: sum(rowsOf(grp.trec)), row: grp.trec[0] });
    aLine('cash', grp.cash); aLine('chq', grp.chq); aLine('bank', grp.bank);
    aLine('adv', grp.oca); aLine('gstin', grp.gstin); aLine('tdsr', grp.tdsr);
    var tl = sum(L), ta = sum(A);
    return { liab: L, assets: A, tl: tl, ta: ta, diff: r2(ta - tl), owners: list.length };
  }

  /* depreciation of the period per fixed asset account, from the journal entries that post it (exp:depreciation + fa: lines) */
  function depOf(docs, from, to) {
    var o = {};
    (docs || []).forEach(function (d) {
      if (d.type !== 'jv' || from && d.date < from || to && d.date > to) return;
      var L = d.lines || []; if (!L.some(function (l) { return l.a === 'exp:depreciation'; })) return;
      L.forEach(function (l) { if (String(l.a || '').indexOf('fa:') === 0) o[l.a] = r2((o[l.a] || 0) + num(l.cr) - num(l.dr)); });
    });
    return o;
  }

  var API = { isCompany: isCompany, fmt: fmt, defaultDirect: defaultDirect, canDirect: canDirect, isDirect: isDirect, DIRECT_CODES: DIRECT_CODES,
    tradingPL: tradingPL, balanceSheet: balanceSheet, depOf: depOf, amt: amt };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else G.NSTF = API;
})(typeof window !== 'undefined' ? window : this);
