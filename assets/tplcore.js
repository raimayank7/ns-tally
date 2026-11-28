/* NSTpl: NSBiz's own import templates (Excel) and any sheet of rows -> NSBiz records. Pure, no screen: the import screen
   ("Bring data from other software", migrate.js), the database route (SQL Server / ODBC through NSBiz for Windows) and Node tests use it.

   Six sheets, one per kind of data, each with a heading row (the template's own headings, or any headings matched to them once and
   remembered: see layout()): Parties, Items, Opening balances, Sales bills, Purchase bills, Receipts and payments; plus "How to fill".
   Bills are one row per item line; the rows of one bill share its bill number (or leave it empty under the first row).
   Out: the same shape as the Tally and Evershine imports ({ parties, items, groups, banks, docs, warn, counts, skipped, left }), so
   the screen's preview, saving and "Take it out again" work unchanged. Every record carries src = { sw, co, id }: a second import of
   the same file brings only what is new. check(): every total of the file against the books NSBiz would make, before saving.
   Designed & Developed by: Nivesh Sahayak (https://www.niveshsahayak.in/) */
(function (G) {
  'use strict';
  function key(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function r2(n) { return Math.round((+n + Number.EPSILON) * 100) / 100; }
  function t(s) { return String(s == null ? '' : s).trim(); }
  function hk(s) { return key(s).replace(/[^a-z0-9%]+/g, ''); }   /* heading key: "Bill No." = "billno" */

  /* ---------- the sheets and their columns ---------- k: field, h: heading, need: must be filled, w: what to type, ex: example, a: other headings ---------- */
  var SHEETS = [
    { k: 'parties', name: 'Parties', w: 'Your customers and suppliers. One row each.', cols: [
      { k: 'name', h: 'Name', need: 1, w: 'Name as on their bills', ex: 'Garg Traders', a: ['party', 'party name', 'customer', 'supplier', 'account name', 'ledger', 'cardname'] },
      { k: 'type', h: 'Customer or supplier', w: 'Customer, Supplier or Both (empty = Customer)', ex: 'Customer', a: ['type', 'role', 'party type'] },
      { k: 'group', h: 'Group', w: 'Your own group name, if any (Ludhiana parties, Dealers)', ex: 'Ludhiana dealers', a: ['party group', 'under'] },
      { k: 'gstin', h: 'GSTIN', w: '15 characters, if registered', ex: '03AAACG1234A1Z5', a: ['gst no', 'gst number', 'gstin/uin', 'gst', 'vat'] },
      { k: 'state', h: 'State', w: 'State name or GST state code (empty = from the GSTIN)', ex: 'Punjab', a: ['state name', 'state code'] },
      { k: 'addr', h: 'Address', w: 'Street, area', ex: '12 Mall Road', a: ['address 1', 'address1', 'street'] },
      { k: 'city', h: 'City', w: '', ex: 'Ludhiana', a: ['town', 'place'] },
      { k: 'pin', h: 'PIN code', w: '6 digits', ex: '141001', a: ['pin', 'pincode', 'zip', 'zip code', 'postal code'] },
      { k: 'phone', h: 'Phone', w: 'Mobile or phone', ex: '9876543210', a: ['mobile', 'phone no', 'contact', 'mobile no'] },
      { k: 'email', h: 'Email', w: '', ex: 'garg@example.com', a: ['e-mail', 'email id', 'mail'] },
      { k: 'cdays', h: 'Credit days', w: 'Days you allow for payment', ex: '30', a: ['credit period', 'due days', 'payment terms'] },
      { k: 'climit', h: 'Credit limit', w: 'Rupees', ex: '200000', a: [] },
      { k: 'obal', h: 'Opening balance', w: 'What they owed you (or you owed them) on the first day', ex: '5000', a: ['opening', 'balance', 'op balance', 'opening amount'] },
      { k: 'odrcr', h: 'Dr or Cr', w: 'Dr = they owe you, Cr = you owe them (empty: customers Dr, suppliers Cr)', ex: 'Dr', a: ['drcr', 'dr/cr', 'balance type'] }] },
    { k: 'items', name: 'Items', w: 'Goods and services you sell or buy. One row each.', cols: [
      { k: 'name', h: 'Item name', need: 1, w: '', ex: 'MS Pipe 1 inch', a: ['item', 'name', 'product', 'description', 'stock item', 'itemname'] },
      { k: 'kind', h: 'Goods or service', w: 'Goods or Service (empty = Goods)', ex: 'Goods', a: ['type', 'item type'] },
      { k: 'hsn', h: 'HSN or SAC', w: 'HSN for goods, SAC for services', ex: '7306', a: ['hsn', 'sac', 'hsn code', 'hsn/sac'] },
      { k: 'unit', h: 'Unit', w: 'Nos, Kgs, Box, Mtr...', ex: 'Kgs', a: ['uom', 'units', 'unit of measure'] },
      { k: 'gst', h: 'GST %', w: '0, 5, 12, 18, 28 or 40', ex: '18', a: ['gst rate', 'tax %', 'gst%', 'rate of tax', 'igst %'] },
      { k: 'rate', h: 'Sale rate', w: 'Rupees per unit, before GST', ex: '95', a: ['sale price', 'selling rate', 'price', 'mrp', 'rate'] },
      { k: 'prate', h: 'Purchase rate', w: 'Rupees per unit, before GST', ex: '80', a: ['purchase price', 'cost', 'cost price'] },
      { k: 'oqty', h: 'Opening quantity', w: 'Stock on the first day', ex: '50', a: ['opening qty', 'op qty', 'opening stock'] },
      { k: 'orate', h: 'Opening rate', w: 'Cost per unit of that stock', ex: '80', a: ['opening value rate', 'op rate'] }] },
    { k: 'openings', name: 'Opening balances', w: 'Balances on the first day of every other account: cash, banks, capital, loans, assets. Parties and stock have theirs on their own sheets.', cols: [
      { k: 'acct', h: 'Account', need: 1, w: 'Account name', ex: 'HDFC Bank', a: ['account name', 'ledger', 'name', 'particulars'] },
      { k: 'type', h: 'Kind of account', need: 1, w: 'Cash, Bank, Capital, Loan taken, Loan given, Fixed asset, Other asset, Other liability, Customer, Supplier', ex: 'Bank', a: ['type', 'group', 'account type'] },
      { k: 'amt', h: 'Amount', need: 1, w: 'Rupees', ex: '50000', a: ['balance', 'opening balance', 'amount rs'] },
      { k: 'drcr', h: 'Dr or Cr', need: 1, w: 'Dr (asset, cash, bank) or Cr (capital, loan taken)', ex: 'Dr', a: ['drcr', 'dr/cr'] },
      { k: 'date', h: 'As on date', w: 'The first day of your books (empty = start of the financial year of your first bill)', ex: '01-04-2026', a: ['date', 'as on'] }] },
    { k: 'sales', name: 'Sales bills', w: 'Sale bills and sale returns (credit notes). One row for every item line; the bill number repeats on each line of the same bill.', cols: [
      { k: 'no', h: 'Bill no', need: 1, w: 'Your bill number', ex: 'INV/101', a: ['invoice no', 'bill number', 'voucher no', 'vch no', 'inv no', 'invoice number', 'docnum'] },
      { k: 'date', h: 'Date', need: 1, w: 'Bill date', ex: '10-04-2026', a: ['bill date', 'invoice date', 'voucher date', 'docdate', 'posting date'] },
      { k: 'party', h: 'Party', need: 1, w: 'Customer name (empty = Cash sale)', ex: 'Garg Traders', a: ['customer', 'party name', 'buyer', 'customer name', 'cardname', 'billed to'] },
      { k: 'gstin', h: 'Party GSTIN', w: 'Only for a party not on the Parties sheet', ex: '03AAACG1234A1Z5', a: ['gstin', 'customer gstin', 'buyer gstin'] },
      { k: 'pos', h: 'Place of supply', w: 'State name or code (empty = the party\'s state)', ex: 'Punjab', a: ['pos', 'state', 'supply state'] },
      { k: 'item', h: 'Item', need: 1, w: 'Item or service name', ex: 'MS Pipe 1 inch', a: ['item name', 'description', 'product', 'particulars', 'stock item', 'dscription'] },
      { k: 'hsn', h: 'HSN or SAC', w: '', ex: '7306', a: ['hsn', 'sac', 'hsn code'] },
      { k: 'qty', h: 'Qty', w: 'Empty = 1', ex: '10', a: ['quantity', 'qnty'] },
      { k: 'unit', h: 'Unit', w: '', ex: 'Kgs', a: ['uom', 'unitmsr'] },
      { k: 'rate', h: 'Rate', need: 1, w: 'Per unit, before GST', ex: '100', a: ['price', 'unit price', 'rate per unit', 'pricebefdi'] },
      { k: 'disc', h: 'Discount %', w: '', ex: '', a: ['disc %', 'discount', 'disc', 'discprcnt'] },
      { k: 'gst', h: 'GST %', w: '0, 5, 12, 18, 28 or 40', ex: '18', a: ['gst rate', 'tax %', 'igst %', 'vatprcnt', 'gst%'] },
      { k: 'kind', h: 'Kind', w: 'Tax invoice, Bill of supply or Credit note (empty = Tax invoice)', ex: 'Tax invoice', a: ['bill type', 'type', 'voucher type'] },
      { k: 'against', h: 'Against bill no', w: 'For a credit note: the bill it returns', ex: '', a: ['original bill', 'ref bill', 'reference'] },
      { k: 'total', h: 'Bill total', w: 'The bill\'s total with GST, on its first row; checked against the lines', ex: '1180', a: ['grand total', 'invoice total', 'net amount', 'doctotal', 'total amount'] },
      { k: 'narr', h: 'Narration', w: '', ex: '', a: ['remarks', 'notes', 'comments'] }] },
    { k: 'purchases', name: 'Purchase bills', w: 'Purchase bills and purchase returns (debit notes). One row for every item line.', cols: [
      { k: 'no', h: 'Supplier bill no', need: 1, w: 'The number on the supplier\'s bill', ex: 'DS/55', a: ['bill no', 'invoice no', 'supplier invoice no', 'ref no', 'numatcard', 'vendor bill no'] },
      { k: 'date', h: 'Date', need: 1, w: 'Supplier bill date', ex: '12-04-2026', a: ['bill date', 'invoice date', 'docdate'] },
      { k: 'party', h: 'Supplier', need: 1, w: 'Supplier name', ex: 'Delhi Steels Pvt Ltd', a: ['party', 'party name', 'vendor', 'supplier name', 'cardname'] },
      { k: 'gstin', h: 'Supplier GSTIN', w: 'Only for a supplier not on the Parties sheet', ex: '07AAACD9999B1Z2', a: ['gstin', 'party gstin', 'vendor gstin'] },
      { k: 'item', h: 'Item', need: 1, w: '', ex: 'MS Pipe 1 inch', a: ['item name', 'description', 'product', 'particulars', 'dscription'] },
      { k: 'hsn', h: 'HSN or SAC', w: '', ex: '7306', a: ['hsn', 'sac'] },
      { k: 'qty', h: 'Qty', w: 'Empty = 1', ex: '10', a: ['quantity'] },
      { k: 'unit', h: 'Unit', w: '', ex: 'Kgs', a: ['uom', 'unitmsr'] },
      { k: 'rate', h: 'Rate', need: 1, w: 'Per unit, before GST', ex: '100', a: ['price', 'unit price', 'pricebefdi'] },
      { k: 'disc', h: 'Discount %', w: '', ex: '', a: ['disc %', 'discount', 'discprcnt'] },
      { k: 'gst', h: 'GST %', w: '', ex: '18', a: ['gst rate', 'tax %', 'vatprcnt'] },
      { k: 'kind', h: 'Kind', w: 'Purchase or Return (debit note) (empty = Purchase)', ex: 'Purchase', a: ['type', 'bill type', 'voucher type'] },
      { k: 'against', h: 'Against bill no', w: 'For a return: the supplier bill it returns', ex: '', a: ['original bill', 'reference'] },
      { k: 'vno', h: 'Our entry no', w: 'Your own number for the entry, if any', ex: 'P/7', a: ['voucher no', 'entry no', 'docnum'] },
      { k: 'total', h: 'Bill total', w: 'The bill\'s total with GST, on its first row', ex: '1230', a: ['grand total', 'invoice total', 'doctotal'] },
      { k: 'narr', h: 'Narration', w: '', ex: '', a: ['remarks', 'notes'] }] },
    { k: 'money', name: 'Receipts and payments', w: 'Money received and paid. One row each. For an expense paid (rent, salary) leave Party empty and write the expense in Account.', cols: [
      { k: 'date', h: 'Date', need: 1, w: '', ex: '20-04-2026', a: ['voucher date', 'docdate', 'posting date'] },
      { k: 'dir', h: 'Received or paid', need: 1, w: 'Received or Paid', ex: 'Received', a: ['type', 'in or out', 'receipt or payment', 'voucher type', 'payment type'] },
      { k: 'party', h: 'Party', w: 'Customer or supplier', ex: 'Garg Traders', a: ['party name', 'customer', 'supplier', 'cardname', 'name'] },
      { k: 'acct', h: 'Account', w: 'When there is no party: Rent, Salary, Interest received...', ex: '', a: ['expense', 'head', 'account head', 'ledger'] },
      { k: 'amt', h: 'Amount', need: 1, w: 'Rupees', ex: '900', a: ['amount rs', 'paid amount', 'received amount', 'doctotal'] },
      { k: 'mode', h: 'Mode', w: 'Cash, Bank, UPI, Cheque or Card (empty = Cash)', ex: 'Bank', a: ['payment mode', 'mode of payment', 'by'] },
      { k: 'bank', h: 'Bank account', w: 'Which bank (when you have more than one)', ex: 'HDFC Bank', a: ['bank', 'bank name'] },
      { k: 'against', h: 'Against bill no', w: 'The bill it pays', ex: 'INV/101', a: ['bill no', 'against', 'invoice no'] },
      { k: 'ref', h: 'Cheque or reference no', w: '', ex: 'UTR 123456', a: ['cheque no', 'reference', 'ref no', 'utr'] },
      { k: 'narr', h: 'Narration', w: '', ex: '', a: ['remarks', 'notes'] }] }
  ];
  var BYK = {}; SHEETS.forEach(function (s) { BYK[s.k] = s; });
  /* Field sets that are NOT sheets of the import template (byof-bankreco, 28 Nov 2026): read only through layoutOf(kind, rows), never
     guessed by layout() or listed by template(). bankbook = the bank account's ledger from any software (Tally "Ledger Account" export,
     Busy ledger, a cash book with a bank column, any sheet): Debit / Receipt = money into the bank, Credit / Payment = money out. */
  var EXTRA = [
    { k: 'bankbook', name: 'Bank book', w: 'The bank account as your books show it', cols: [
      { k: 'date', h: 'Date', need: 1, a: ['dated', 'vch date', 'voucher date', 'entry date', 'txn date', 'transaction date', 'posting date', 'doc date', 'bill date'] },
      { k: 'party', h: 'Particulars', a: ['account', 'account name', 'ledger', 'ledger name', 'party', 'party name', 'name', 'description', 'details', 'paid to', 'received from'] },
      { k: 'vtype', h: 'Vch Type', a: ['voucher type', 'type', 'vchtype', 'entry type', 'vch/bill type'] },
      { k: 'vno', h: 'Vch No.', a: ['voucher no', 'voucher number', 'vch/bill no', 'bill no', 'entry no', 'doc no', 'document no'] },
      { k: 'ref', h: 'Cheque / Ref No', a: ['cheque no', 'chq no', 'chq/ref no', 'cheque/ref no', 'chq./ref.no.', 'instrument no', 'instrument number', 'inst no', 'ref no', 'reference', 'reference no', 'utr', 'utr no', 'transaction id', 'cheque number'] },
      { k: 'narr', h: 'Narration', a: ['short narration', 'long narration', 'remarks', 'notes', 'narr'] },
      { k: 'dr', h: 'Debit', a: ['dr', 'debit amount', 'debit rs', 'debit(rs.)', 'debit (rs)', 'dr amount', 'receipt', 'receipts', 'deposit', 'deposits', 'money in', 'amount in', 'inflow', 'received'] },
      { k: 'cr', h: 'Credit', a: ['cr', 'credit amount', 'credit rs', 'credit(rs.)', 'credit (rs)', 'cr amount', 'payment', 'payments', 'withdrawal', 'withdrawals', 'money out', 'amount out', 'outflow', 'paid'] },
      { k: 'amt', h: 'Amount', a: ['amount rs', 'amount (rs)', 'value'] },
      { k: 'drcr', h: 'Dr or Cr', a: ['drcr', 'dr/cr', 'dr / cr', 'side'] },
      { k: 'bal', h: 'Balance', a: ['running balance', 'closing balance', 'balance rs', 'bal', 'balance (rs)'] }] }
  ];
  EXTRA.forEach(function (s) { BYK[s.k] = s; });
  /* the heading row and columns of one EXTRA set: the row (of the first 40) with the most of its headings and every 'need' field */
  function layoutOf(kind, rows, saved) {
    var S = BYK[kind], best = null; if (!S) return null;
    for (var r = 0; r < Math.min((rows || []).length, 40); r++) {
      var heads = rows[r] || [], s = sig(heads), map = {}, n = 0;
      if (saved && s && saved[s] && saved[s].kind === kind) return { kind: kind, row: r, map: saved[s].map, sig: s, heads: heads, remembered: true };
      heads.forEach(function (h, i) { var f = fieldOf(kind, h); if (f && !(f in map)) { map[f] = i; n++; } });
      if (S.cols.some(function (c) { return c.need && !(c.k in map); })) continue;   /* every 'need' field present (bank book, price list) */
      if (n >= 2 && (!best || n > best.n)) best = { kind: kind, row: r, map: map, sig: s, heads: heads, n: n, score: n };
    }
    return best;
  }
  /* Field sets used by single tools, not by the import screen: they are NOT in SHEETS (so read() and layout() never pick them for a
     workbook) but fieldOf() / layoutOf() know them. byof-pricelist (28 Nov 2026): 'pricelist' = an item list for price-list.niveshsahayak.in
     (Tally / Busy / Marg / Vyapar item exports, any shop's own sheet). */
  var EXTRA2 = [
    { k: 'pricelist', name: 'Price list', w: 'Your items with their prices. One row each.', cols: [
      { k: 'name', h: 'Item name', need: 1, w: '', ex: 'MS Pipe 1 inch', a: ['item', 'name', 'product', 'product name', 'description', 'stock item', 'itemname', 'particulars', 'item description', 'name of item', 'article'] },
      { k: 'code', h: 'Item code', w: 'Your code, SKU or part number', ex: 'MSP-1', a: ['code', 'sku', 'part no', 'part number', 'product code', 'alias', 'barcode', 'item no', 'article no', 'model', 'model no', 'catalogue no'] },
      { k: 'cat', h: 'Category', w: 'Group the list by this (Pipes, Paints, Hardware)', ex: 'Pipes', a: ['group', 'item group', 'stock group', 'product group', 'category name', 'parent', 'under', 'brand', 'department', 'section', 'sub group'] },
      { k: 'unit', h: 'Unit', w: 'Nos, Kgs, Box, Mtr...', ex: 'Nos', a: ['uom', 'units', 'unit of measure', 'base unit', 'base units', 'unit name', 'per', 'main unit', 'primary unit'] },
      { k: 'hsn', h: 'HSN or SAC', w: '', ex: '7306', a: ['hsn', 'sac', 'hsn code', 'hsn/sac', 'hsn sac', 'hsn sac code'] },
      { k: 'gst', h: 'GST %', w: '0, 5, 18 or 40', ex: '18', a: ['gst rate', 'tax %', 'gst%', 'rate of tax', 'igst %', 'igst rate', 'tax rate', 'tax category', 'tax', 'gst'] },
      { k: 'mrp', h: 'MRP', w: 'Rupees, including all taxes', ex: '130', a: ['m.r.p', 'max retail price', 'maximum retail price', 'mrp rs', 'mrp rate'] },
      { k: 'rate', h: 'Retail price', w: 'Your selling price', ex: '115', a: ['sale price', 'selling price', 'sale rate', 'selling rate', 'retail', 'retail rate', 'price', 'rate', 'sp', 'unit price', 'list price', 'standard price', 'standard selling price', 'sales price', 'sell price', 'rate a', 'sale price incl tax'] },
      { k: 'wrate', h: 'Wholesale price', w: 'Price for dealers and bulk buyers', ex: '100', a: ['wholesale', 'wholesale rate', 'dealer price', 'dealer rate', 'trade price', 'distributor price', 'distributor rate', 'bulk price', 'whole sale price', 'b2b price', 'rate b'] },
      { k: 'prate', h: 'Purchase price', w: 'Your cost (never shown to customers unless you tick it)', ex: '85', a: ['purchase rate', 'purch price', 'purch rate', 'cost', 'cost price', 'landing cost', 'buying price', 'standard cost', 'purchase', 'purc price', 'purc rate'] },
      { k: 'stock', h: 'Stock', w: 'Quantity in hand, if you want it on the list', ex: '40', a: ['closing stock', 'qty', 'quantity', 'balance', 'in stock', 'closing qty', 'closing balance', 'available', 'stock qty', 'current stock', 'opening stock quantity', 'stock quantity'] },
      { k: 'img', h: 'Picture link', w: 'A web address of the item\'s picture, or a file name (pipe1.jpg) of a picture you add', ex: '', a: ['picture', 'image', 'photo', 'image url', 'img', 'image link', 'photo url', 'picture url', 'image file', 'photo link'] },
      { k: 'desc', h: 'Details', w: 'One short line under the name', ex: 'ISI, 6 m length', a: ['detail', 'specification', 'specifications', 'remarks', 'notes', 'size', 'features'] },
      { k: 'kind', h: 'Goods or service', w: 'Goods or Service (empty = Goods)', ex: 'Goods', a: ['item type', 'goods/service'] }] }
  ];
  EXTRA2.forEach(function (s) { BYK[s.k] = s; }); EXTRA = EXTRA.concat(EXTRA2);   /* merged 28 Nov: byof-bankreco + byof-pricelist both add EXTRA sets */
  /* the sheet a name stands for (the template's own names and the usual words people use) */
  var SHEETWORDS = { parties: /part(y|ies)|customer|supplier|debtor|creditor|ledger/, items: /item|product|stock|goods/, openings: /opening/, sales: /sale|invoice/, purchases: /purchase|buy/, money: /receipt|payment|money|cash|bank/ };

  /* ---------- the blank template: [sheet name, rows, widths, style] for NS.xlsx.write ---------- */
  function template() {
    var how = [['Sheet', 'Column', 'Must fill', 'What to type', 'Example']];
    how.push(['', '', '', 'Fill the sheets you need and leave the others empty. Keep the heading row as it is. Dates as 25-04-2026; amounts without commas or Rs. Then: NSBiz > Utilities > Bring data from other software > NSBiz template > Choose the file.', '']);
    SHEETS.forEach(function (s) {
      how.push([s.name, '', '', s.w, '']);
      s.cols.forEach(function (c) { how.push(['', c.h, c.need ? 'Yes' : '', c.w, c.ex]); });
    });
    var out = [['How to fill', how, [20, 26, 10, 80, 22], 'wrap']];
    SHEETS.forEach(function (s) { out.push([s.name, [s.cols.map(function (c) { return c.h; })], s.cols.map(function (c) { return Math.max(12, Math.min(28, c.h.length + 4)); })]); });
    return out;
  }

  /* ---------- reading a sheet: where the headings are and which column is which ---------- */
  function fieldOf(sheet, heading) {
    var h = hk(heading); if (!h) return '';
    var f = ''; BYK[sheet].cols.some(function (c) { if (hk(c.h) === h || (c.a || []).some(function (a) { return hk(a) === h; })) { f = c.k; return true; } return false; }); return f;
  }
  /* the headings of a sheet as a signature: a remembered layout is used again for a file with the same headings */
  function sig(heads) { return heads.map(hk).filter(Boolean).join('|'); }
  /* which kind of data a sheet holds, the heading row and the column of each field; saved = remembered layouts { sig: { kind, map } } */
  function layout(name, rows, saved) {
    var best = null;
    for (var r = 0; r < Math.min(rows.length, 15); r++) {
      var heads = rows[r] || [], s = sig(heads);
      if (saved && s && saved[s]) return { kind: saved[s].kind, row: r, map: saved[s].map, sig: s, heads: heads, remembered: true };
      SHEETS.forEach(function (S) {
        var map = {}, n = 0, need = 0;
        heads.forEach(function (h, i) { var f = fieldOf(S.k, h); if (f && !(f in map)) { map[f] = i; n++; if (S.cols.some(function (c) { return c.k === f && c.need; })) need++; } });
        var score = n + need * 2 + (SHEETWORDS[S.k].test(key(name)) ? 3 : 0) + (key(name) === key(S.name) ? 10 : 0);
        if (n >= 2 && (!best || score > best.score)) best = { kind: S.k, row: r, map: map, sig: s, heads: heads, score: score };
      });
    }
    return best;
  }
  /* rows of a sheet -> objects by field, with the sheet's row number for messages */
  function objects(rows, L) {
    var out = [];
    for (var r = L.row + 1; r < rows.length; r++) {
      var row = rows[r] || [], o = { _r: r + 1 }, any = false;
      Object.keys(L.map).forEach(function (f) { var v = t(row[L.map[f]]); o[f] = v; if (v) any = true; });
      if (any) out.push(o);
    }
    return out;
  }

  /* ---------- values ---------- */
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /* 25-04-2026, 25/04/26, 2026-04-25, 25-Apr-2026, 25.04.2026, an Excel day number (46137) or 2026-04-25 00:00:00 */
  function date(s) { var d = date0(s); return d && real(d) ? d : ''; }
  function real(d) { var x = new Date(d + 'T00:00:00Z'); return !isNaN(x) && x.toISOString().slice(0, 10) === d && +d.slice(0, 4) > 1950 && +d.slice(0, 4) < 2100; }
  function date0(s) {
    s = t(s); if (!s) return '';
    var m;
    if (/^\d{5}(\.\d+)?$/.test(s)) { var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 864e5); return d.toISOString().slice(0, 10); }
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
    if ((m = s.match(/^(\d{1,2})[-\/. ]([A-Za-z]{3})[A-Za-z]*[-\/. ,]+(\d{2,4})$/)) && MON[m[2].toLowerCase()]) return yr(m[3]) + '-' + pad(MON[m[2].toLowerCase()]) + '-' + pad(+m[1]);
    if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/))) return yr(m[3]) + '-' + pad(+m[2]) + '-' + pad(+m[1]);
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return m[1] + '-' + m[2] + '-' + m[3];
    return '';
    function yr(y) { y = +y; return y < 100 ? 2000 + y : y; }
  }
  /* 1,23,456.50 / Rs 500 / 500 Dr / (500) -> number; Dr / Cr found in the text comes back in .side */
  function amt(s) {
    s = t(s); if (!s) return { v: 0, side: '' };
    var side = /\bcr\b/i.test(s) ? 'cr' : /\bdr\b/i.test(s) ? 'dr' : '', neg = /^\(.*\)$/.test(s) || /^-/.test(s);
    var m = s.replace(/,/g, '').match(/\d+(\.\d+)?|\.\d+/), n = m ? parseFloat(m[0]) : 0; if (!isFinite(n)) n = 0;
    return { v: neg ? -n : n, side: side };
  }
  function num(s) { return amt(s).v; }
  var STATES = { 'jammu and kashmir': '01', 'himachal pradesh': '02', 'punjab': '03', 'chandigarh': '04', 'uttarakhand': '05', 'haryana': '06', 'delhi': '07', 'rajasthan': '08', 'uttar pradesh': '09',
    'bihar': '10', 'sikkim': '11', 'arunachal pradesh': '12', 'nagaland': '13', 'manipur': '14', 'mizoram': '15', 'tripura': '16', 'meghalaya': '17', 'assam': '18', 'west bengal': '19', 'jharkhand': '20',
    'odisha': '21', 'orissa': '21', 'chhattisgarh': '22', 'madhya pradesh': '23', 'gujarat': '24', 'daman and diu': '26', 'dadra and nagar haveli': '26', 'dadra and nagar haveli and daman and diu': '26',
    'maharashtra': '27', 'karnataka': '29', 'goa': '30', 'lakshadweep': '31', 'kerala': '32', 'tamil nadu': '33', 'puducherry': '34', 'pondicherry': '34', 'andaman and nicobar islands': '35',
    'telangana': '36', 'andhra pradesh': '37', 'ladakh': '38', 'other territory': '97', 'outside india': '96' };
  function stateCode(s, gstin) {
    var k = key(s).replace(/&/g, 'and'), m = k.match(/^(\d{1,2})\b/);
    if (m) return pad(+m[1]);
    if (STATES[k]) return STATES[k];
    var g = t(gstin).toUpperCase(); return /^\d{2}/.test(g) ? g.slice(0, 2) : '';
  }
  var RATES = [0, 0.1, 0.25, 1.5, 3, 5, 12, 18, 28, 40];
  /* a rate worked out from totals (17.99 from a database's tax / value) is the GST rate it is nearest to, when within 0.2 */
  function rate(v) { var g = num(v); if (RATES.indexOf(g) >= 0) return g; var n = RATES.filter(function (x) { return Math.abs(x - g) <= 0.2; })[0]; return n == null ? g : n; }

  /* ---------- a whole workbook (or the rows a database query gave) -> data by kind ----------
     book: [{ name, rows: [[...], ...] }]; opts.layouts: remembered layouts; opts.force { sheetName: { kind, map, row } } from the column screen */
  function read(book, opts) {
    opts = opts || {};
    var D = { parties: [], items: [], openings: [], sales: [], purchases: [], money: [] }, found = [], probs = [];
    (book || []).forEach(function (sh) {
      if (key(sh.name) === 'how to fill') return;
      var L = (opts.force && opts.force[sh.name]) || layout(sh.name, sh.rows || [], opts.layouts);
      if (!L) { if ((sh.rows || []).length > 1) found.push({ name: sh.name, kind: '', rows: sh.rows.length, heads: (sh.rows[0] || []).slice(0, 30) }); return; }
      var objs = objects(sh.rows, L), S = BYK[L.kind];
      var miss = S.cols.filter(function (c) { return c.need && !(c.k in L.map); }).map(function (c) { return c.h; });
      found.push({ name: sh.name, kind: L.kind, rows: objs.length, map: L.map, sig: L.sig, heads: L.heads, headRow: L.row, remembered: !!L.remembered, missing: miss });
      if (miss.length && objs.length) { probs.push({ sheet: sh.name, row: L.row + 1, msg: 'No column for ' + miss.join(', ') + ': choose it with Columns.' }); return; }
      objs.forEach(function (o) { o._s = sh.name; D[L.kind].push(o); });
    });
    D.found = found; D.probs = probs;
    return D;
  }

  /* ---------- data -> NSBiz records ----------
     opts: { co (source name for src), sw ('excel'|'sql'...), seller { name, state }, totals (NSBooks.itemTotals), postings (NSBooks.postings),
     have { src.id: 1 } (already in NSBiz), noOpening, from (first day), partiesHave { key(name): party } (already in NSBiz) } */
  function plan(D, opts) {
    opts = opts || {};
    var sw = opts.sw || 'excel', co = opts.co || 'file', seller = opts.seller || { name: 'My business', state: '' }, own = seller.state || '';
    var have = opts.have || {}, tot = opts.totals, warn = [], probs = (D.probs || []).slice();
    var out = { parties: [], items: [], groups: [], banks: [], docs: [], warn: warn, probs: probs, counts: {}, skipped: 0, left: {}, sums: {} };
    function src(id) { return { sw: sw, co: co, id: id }; }
    function add(d) { d.seller = seller; d.app = 1; if (have[d.src.id]) { out.skipped++; return; } out.docs.push(d); out.counts[d.type] = (out.counts[d.type] || 0) + 1; }
    function prob(o, msg) { probs.push({ sheet: o._s, row: o._r, msg: msg }); }
    function sum(k, v) { out.sums[k] = r2((out.sums[k] || 0) + v); }

    /* parties */
    var P = {}, grpSeen = {}, obSeen = {};
    function party(name, role, extra) {
      var k = key(name); if (!k) return null;
      if (P[k]) { if (role && P[k].role !== role && P[k].role !== 'both') P[k].role = 'both'; return P[k]; }
      var known = opts.partiesHave && opts.partiesHave[k];
      var p = Object.assign({ name: t(name), role: role || 'customer', group: '', addr: '', pin: '', state: '', gstin: '', phone: '', email: '', cdays: '', src: src('party/' + k) }, extra || {});
      if (known) { p.state = p.state || known.state || ''; p.gstin = p.gstin || known.gstin || ''; p._known = 1; }
      P[k] = p; if (!known) out.parties.push(p);
      return p;
    }
    var openDate = opts.from || '';
    if (!openDate) {
      var first = ''; ['sales', 'purchases', 'money'].forEach(function (k) { D[k].forEach(function (o) { var d = date(o.date); if (d && (!first || d < first)) first = d; }); });
      if (first) { var y = +first.slice(0, 4); if (+first.slice(5, 7) < 4) y--; openDate = y + '-04-01'; }
      D.openings.forEach(function (o) { var d = date(o.date); if (d && (!openDate || d < openDate)) openDate = d; });
    }
    if (!openDate) openDate = new Date().toISOString().slice(0, 10);
    D.parties.forEach(function (o) {
      if (!o.name) return prob(o, 'Name is empty.');
      var ty = key(o.type), role = /both/.test(ty) ? 'both' : /suppl|credit|vendor|^s$/.test(ty) ? 'supplier' : 'customer';
      var gstin = t(o.gstin).toUpperCase().replace(/\s+/g, '');
      if (gstin && !/^\d{2}[A-Z0-9]{13}$/.test(gstin)) { prob(o, 'GSTIN "' + o.gstin + '" is not 15 characters: kept out.'); gstin = ''; }
      var gname = t(o.group), gid = '';
      if (gname) {
        gid = 'gti-' + key(co + ' ' + gname).replace(/[^a-z0-9]+/g, '-');
        if (!grpSeen[gid]) { grpSeen[gid] = 1; out.groups.push({ id: gid, name: gname, under: role === 'supplier' ? 'creditors' : 'debtors', src: src('grp/' + gid) }); }
      }
      var p = party(o.name, role, { group: gid || (role === 'supplier' ? 'creditors' : 'debtors'), addr: [t(o.addr), t(o.city)].filter(Boolean).join(', '), pin: t(o.pin), state: stateCode(o.state, gstin),
        gstin: gstin, phone: t(o.phone), email: t(o.email), cdays: num(o.cdays) || '', climit: num(o.climit) || '' });
      var ob = amt(o.obal); if (!ob.v) return;
      if (obSeen[key(o.name)]) return prob(o, o.name + ' is on the Parties sheet twice: the opening balance is taken once.');
      obSeen[key(o.name)] = 1;
      var side = key(o.odrcr) === 'cr' || ob.side === 'cr' ? 'cr' : key(o.odrcr) === 'dr' || ob.side === 'dr' ? 'dr' : role === 'supplier' ? 'cr' : 'dr';
      if (ob.v < 0) side = side === 'dr' ? 'cr' : 'dr';
      if (!opts.noOpening) { add({ type: 'ob', date: openDate, side: side === 'dr' ? 'recv' : 'pay', amount: r2(Math.abs(ob.v)), buyer: { name: p.name }, no: '', total: r2(Math.abs(ob.v)), src: src('ob/party/' + key(o.name)) }); sum('ob:' + (side === 'dr' ? 'dr' : 'cr'), Math.abs(ob.v)); }
    });

    /* items */
    var I = {};
    D.items.forEach(function (o) {
      if (!o.name) return prob(o, 'Item name is empty.');
      var k = key(o.name); if (I[k]) return;
      var g = rate(o.gst); if (o.gst && RATES.indexOf(g) < 0) prob(o, 'GST % ' + o.gst + ' is not a GST rate.');
      var x = { desc: t(o.name), hsn: t(o.hsn).replace(/\s+/g, ''), unit: t(o.unit), gst: g, rate: num(o.rate) || '', kind: /serv/i.test(o.kind) ? 'service' : 'goods', src: src('item/' + k) };
      if (num(o.prate)) x.prate = num(o.prate);
      I[k] = x; out.items.push(x);
    });
    function item(name, line) {
      var k = key(name); if (!k || I[k]) return;
      var x = { desc: t(name), hsn: line.hsn || '', unit: line.unit || '', gst: line.gst || 0, rate: '', kind: /^99/.test(line.hsn || '') ? 'service' : 'goods', src: src('item/' + k) };
      I[k] = x; out.items.push(x);
    }
    if (!opts.noOpening) {
      var stk = D.items.filter(function (o) { return num(o.oqty); }).map(function (o) { return { desc: t(o.name), unit: t(o.unit), qty: num(o.oqty), rate: num(o.orate) || num(o.prate) || 0 }; });
      if (stk.length) { add({ type: 'stk', kind: 'open', no: 'OPEN/IMPORT', date: openDate, gd: '', note: 'Opening stock (imported)', lines: stk, src: src('ob/stock') }); sum('stock', stk.reduce(function (a, l) { return a + l.qty * l.rate; }, 0)); }
    }

    /* other openings */
    var banks = {};
    function bankOf(name) { var k = key(name); if (!k) return ''; if (!banks[k]) { banks[k] = 1; out.banks.push({ k: 'bank:' + k, name: t(name), src: src('bank/' + k) }); } return 'bank:' + k; }
    if (!opts.noOpening) {
      var rest = [];
      D.openings.forEach(function (o) {
        var a = amt(o.amt); if (!a.v) return;
        var side = key(o.drcr) === 'cr' || a.side === 'cr' ? 'cr' : key(o.drcr) === 'dr' || a.side === 'dr' ? 'dr' : '';
        if (!side) return prob(o, 'Write Dr or Cr for ' + (o.acct || 'this account') + '.');
        if (a.v < 0) side = side === 'dr' ? 'cr' : 'dr';
        var v = r2(Math.abs(a.v)), ty = key(o.type), nm = t(o.acct), id = 'ob/acct/' + key(nm);
        sum('ob:' + side, v);
        if (/cash/.test(ty)) return add({ type: 'ob', date: openDate, side: 'cash', amount: side === 'dr' ? v : -v, buyer: { name: '' }, no: '', total: v, src: src(id) });
        if (/bank|od|overdraft|cc/.test(ty) && !/loan/.test(ty)) return add({ type: 'ob', date: openDate, side: 'bank', bacct: bankOf(nm), amount: side === 'dr' ? v : -v, buyer: { name: '' }, no: '', total: v, src: src(id) });
        if (/customer|debtor/.test(ty) || /supplier|creditor/.test(ty)) {
          var p = party(nm, /suppl|credit/.test(ty) ? 'supplier' : 'customer');
          return add({ type: 'ob', date: openDate, side: side === 'dr' ? 'recv' : 'pay', amount: v, buyer: { name: p.name }, no: '', total: v, src: src(id) });
        }
        var pre = /capital|reserve|drawing|proprietor|partner/.test(ty) ? 'cap:' : /loan given|advance given|given/.test(ty) ? 'given:' : /loan|borrow|od/.test(ty) ? 'loan:' : /fixed|asset.*fix|machine|furniture|vehicle|building/.test(ty) ? 'fa:' :
          /liab|payable|provision|duty|tax/.test(ty) ? 'ocl:' : /expense/.test(ty) ? 'exp:' : /income/.test(ty) ? 'inc:' : 'oca:';
        rest.push({ a: pre + key(nm), dr: side === 'dr' ? v : 0, cr: side === 'cr' ? v : 0 });
      });
      if (rest.length) {
        var s = rest.reduce(function (a, l) { return r2(a + l.dr - l.cr); }, 0);
        if (s) rest.push({ a: 'opening', dr: s < 0 ? -s : 0, cr: s > 0 ? s : 0 });
        add({ type: 'jv', no: 'OP', date: openDate, lines: rest, narr: 'Opening balances (imported)', src: src('ob/accounts') });
      }
    }

    /* bills: rows grouped by bill number (a row with no number belongs to the bill above it) */
    function bills(rows, buy) {
      var list = [], cur = null;
      rows.forEach(function (o) {
        var no = t(o.no), k = no ? key(no) + '|' + key(o.party || (cur && cur.party)) : '';
        if (!no && cur) { cur.lines.push(o); return; }
        if (cur && k === cur.k && (!o.date || date(o.date) === cur.date)) { cur.lines.push(o); return; }
        cur = { k: k, no: no, date: date(o.date), party: t(o.party), head: o, lines: [o] }; list.push(cur);
      });
      var seen = {};
      list.forEach(function (b) {
        var o = b.head;
        if (!b.no) return prob(o, 'Bill no is empty.');
        if (!b.date) return prob(o, 'Date "' + (o.date || '') + '" is not a date (use 25-04-2026).');
        var kind = key(o.kind), credit = !buy && /credit|return/.test(kind), debit = buy && /debit|return/.test(kind), supply = !buy && /supply/.test(kind);
        var pname = b.party || (buy ? '' : 'Cash sale'); if (!pname) return prob(o, 'Supplier is empty.');
        var p = party(pname, buy ? 'supplier' : 'customer', { gstin: t(o.gstin).toUpperCase(), state: stateCode('', o.gstin) });
        var pos = stateCode(o.pos) || p.state || own;
        var its = [];
        b.lines.forEach(function (l) {
          if (!t(l.item) && !num(l.rate)) return;
          var g = rate(l.gst); if (l.gst && RATES.indexOf(g) < 0) prob(l, 'GST % ' + l.gst + ' is not a GST rate.');
          var q = t(l.qty) === '' ? 1 : num(l.qty); if (credit || debit) q = Math.abs(q);   /* a return written with minus quantities (ERPNext, Odoo) */
          var it = { desc: t(l.item) || 'Item', hsn: t(l.hsn).replace(/\s+/g, ''), qty: q, unit: t(l.unit), rate: num(l.rate), disc: num(l.disc) || '', gst: supply ? 0 : g };
          if (!it.hsn && I[key(it.desc)]) it.hsn = I[key(it.desc)].hsn;
          if (!it.unit && I[key(it.desc)]) it.unit = I[key(it.desc)].unit;
          its.push(it); item(it.desc, it);
        });
        if (!its.length) return prob(o, 'This bill has no item lines with a rate.');
        var sk = (buy ? 'p|' : 's|') + key(p.name) + '|' + key(b.no) + '|' + b.date; if (seen[sk]) { prob(o, 'Bill ' + b.no + ' appears twice; the second is left out.'); return; } seen[sk] = 1;
        var id = (buy ? 'pur/' : 'sale/') + key(p.name) + '/' + key(b.no) + '/' + b.date;
        var d = { no: b.no, date: b.date, notes: t(o.narr), items: its, charges: [], buyer: { name: p.name, state: p.state || pos, gstin: p.gstin }, src: src(id) };
        if (!buy && !credit) Object.assign(d, { type: 'invoice', kind: supply ? 'supply' : 'tax', pos: pos, status: 'unpaid', withGst: !supply, comp: true, copies: 1, paper: 'a4', design: 'classic' });
        else if (!buy) Object.assign(d, { type: 'note', kind: 'credit', side: 'sale', reason: 'ret', orig: t(o.against), pos: pos });
        else if (!debit) Object.assign(d, { type: 'pbill', kind: 'bill', noGst: false, vno: t(o.vno), bdate: b.date });
        else Object.assign(d, { type: 'note', kind: 'debit', side: 'purchase', reason: 'ret', orig: t(o.against) });
        var calc = tot ? tot(Object.assign({}, d, { total: null })).total : 0, given = num(o.total); if (credit || debit) given = Math.abs(given);
        if (given) {
          var gap = r2(given - calc);
          if (tot && Math.abs(gap) > 1) warn.push({ w: 'billgap', id: b.no, amt: gap, sheet: o._s, row: o._r });
          d.total = given;
        } else d.total = calc || null;
        sum((buy ? (debit ? 'pret' : 'pur') : (credit ? 'sret' : 'sale')), d.total || 0);
        add(d);
      });
    }
    bills(D.sales, false); bills(D.purchases, true);

    /* receipts and payments */
    var mseen = {};
    D.money.forEach(function (o) {
      var dt = date(o.date); if (!dt) return prob(o, 'Date "' + (o.date || '') + '" is not a date.');
      var a = num(o.amt); if (!a) return prob(o, 'Amount is empty.');
      var dir = /^(r|rec|in|receipt|received|receive|inbound|cr)/i.test(t(o.dir)) ? 'in' : /^(p|pay|out|payment|paid|outbound|dr)/i.test(t(o.dir)) ? 'out' : '';
      if (!dir) return prob(o, 'Write Received or Paid.');
      if (a < 0) { a = -a; dir = dir === 'in' ? 'out' : 'in'; }
      var mk = key(o.mode), mode = /upi|gpay|phonepe|paytm/.test(mk) ? 'upi' : /cheque|chq|check/.test(mk) ? 'cheque' : /card/.test(mk) ? 'card' : /bank|neft|rtgs|imps|transfer|online|dd/.test(mk) || t(o.bank) ? 'bank' : 'cash';
      var base = dt + '|' + dir + '|' + key(o.party || o.acct) + '|' + a + '|' + key(o.ref), n = mseen[base] = (mseen[base] || 0) + 1, id = 'money/' + base + '|' + n;
      var d = { date: dt, mode: mode, ref: t(o.ref), paper: 'a4', design: 'classic', copies: 1, src: src(id) };
      if (mode !== 'cash') { var bk = t(o.bank) ? bankOf(o.bank) : ''; if (bk) d.bacct = bk; }
      if (t(o.party)) {
        var p = party(o.party, dir === 'in' ? 'customer' : 'supplier');
        if (dir === 'in') Object.assign(d, { type: 'receipt', kind: 'pay', no: t(o.ref) || '', buyer: { name: p.name }, amount: r2(a), tds: '', disc: 0, against: t(o.against), purpose: t(o.narr), alloc: [], total: r2(a) });
        else Object.assign(d, { type: 'voucher', forBill: true, no: t(o.ref) || '', buyer: { name: p.name }, lines: [{ desc: t(o.narr) || ('Payment' + (o.against ? ' against bill ' + t(o.against) : '')), head: 'Supplier payment', amt: r2(a) }], total: r2(a), tdsRate: '' });
      } else if (t(o.acct)) {
        if (dir === 'in') Object.assign(d, { type: 'oinc', no: t(o.ref) || '', head: t(o.acct), amount: r2(a), tds: '', notes: t(o.narr), total: r2(a) });
        else Object.assign(d, { type: 'voucher', forBill: false, no: t(o.ref) || '', buyer: { name: '' }, lines: [{ desc: t(o.narr) || t(o.acct), head: t(o.acct), amt: r2(a) }], total: r2(a), tdsRate: '' });
      } else return prob(o, 'Write the Party, or the Account for money not from a party.');
      sum(dir === 'in' ? 'in' : 'out', a);
      add(d);
    });
    out.from = openDate;
    out.docs.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return out;
  }

  /* ---------- the balance check, before saving ----------
     Each kind of entry: the file's own total against what NSBiz will post for it (the party's side of every bill, the cash and bank side
     of every receipt and payment), the openings' Dr against Cr, and the books as a whole. postings = NSBooks.postings. */
  function check(P, postings, books) {
    var S = P.sums, N = {};
    function put(k, v) { N[k] = r2((N[k] || 0) + v); }
    P.docs.forEach(function (d) {
      if (d.type === 'ob' || d.type === 'stk' || d.no === 'OP') return;
      var L = postings(d), party = 0, money = 0;
      L.forEach(function (l) { var v = (+l.dr || 0) - (+l.cr || 0); if (/^p:/.test(l.a)) party += v; if (/^(cash|bank)(:|$)/.test(l.a)) money += v; });
      if (d.type === 'invoice') put('sale', party);
      else if (d.type === 'note' && d.kind === 'credit') put('sret', -party);
      else if (d.type === 'pbill') put('pur', -party);
      else if (d.type === 'note') put('pret', party);
      else if (d.type === 'receipt' || d.type === 'oinc') put('in', money);
      else if (d.type === 'voucher') put('out', -money);
    });
    var names = { sale: 'Sales bills', sret: 'Sale returns (credit notes)', pur: 'Purchase bills', pret: 'Purchase returns (debit notes)', 'in': 'Money received', out: 'Money paid' }, rows = [];
    Object.keys(names).forEach(function (k) { var f = r2(S[k] || 0), n = r2(N[k] || 0); if (!f && !n) return; rows.push({ k: k, name: names[k], file: f, nsbiz: n, diff: r2(n - f) }); });
    var dr = r2((S['ob:dr'] || 0) + (S.stock || 0)), cr = r2(S['ob:cr'] || 0);
    var total = books ? r2(Object.keys(books).reduce(function (a, k) { return a + books[k]; }, 0)) : 0;
    return { rows: rows, bad: rows.filter(function (r) { return Math.abs(r.diff) > 0.01; }).length, openings: { dr: dr, cr: cr, gap: r2(dr - cr) }, balanced: Math.abs(total) < 0.01,
      gaps: P.warn.filter(function (w) { return w.w === 'billgap'; }).length };
  }

  /* ---------- extra field sets for single-purpose sites (byof-gstr1, 28 Nov 2026) ----------
     addSet({ k, name, cols }) makes fieldOf(k, heading) work for another kind of sheet (a GSTR-1 sales register, a bank statement...)
     WITHOUT adding it to SHEETS, so read() / layout() of the import screen never pick it. match(k, name, rows, saved) is layout() for that
     one set: the heading row among the first 15 with the most matched columns; saved = remembered layouts { sig: { kind, map } } of the site. */
  function addSet(S) { if (S && S.k && !BYK[S.k]) { BYK[S.k] = S; SHEETWORDS[S.k] = SHEETWORDS[S.k] || /(?!)/; } return BYK[S && S.k]; }
  function match(k, name, rows, saved) {
    var S = BYK[k]; if (!S) return null;
    var best = null;
    for (var r = 0; r < Math.min(rows.length, 15); r++) {
      var heads = rows[r] || [], s = sig(heads);
      if (saved && s && saved[s] && saved[s].kind === k) return { kind: k, row: r, map: saved[s].map, sig: s, heads: heads, remembered: true };
      var map = {}, n = 0, need = 0;
      heads.forEach(function (h, i) { var f = fieldOf(k, h); if (f && !(f in map)) { map[f] = i; n++; if (S.cols.some(function (c) { return c.k === f && c.need; })) need++; } });
      var score = n + need * 2;
      if (n >= 2 && (!best || score > best.score)) best = { kind: k, row: r, map: map, sig: s, heads: heads, score: score };
    }
    return best;
  }
  /* byof-tds (28 Nov 2026): field sets for the free single-purpose sites that read a visitor's own sheet. They are NOT part of the NSBiz
     template, of read() or of the remembered layouts above; a site asks for its own set: pick(set, rows, saved) -> { row, map, sig, heads,
     missing, remembered } (saved = that site's own remembered layouts { sig: { map } }), then objects(rows, L). New sets go into SETS only. */
  var SETS = {};
  SETS.tds = { k: 'tds', name: 'TDS payments', w: 'Payments on which TDS is (or may be) due. One row per payment or credit.', cols: [
    { k: 'party', h: 'Party name', need: 1, w: 'Name of the payee (deductee)', ex: 'Sharma Builders', a: ['party', 'name', 'payee', 'payee name', 'deductee', 'deductee name', 'name of deductee', 'name of the deductee', 'vendor', 'vendor name', 'supplier', 'supplier name', 'ledger', 'ledger name', 'particulars', 'account', 'account name'] },
    { k: 'pan', h: 'PAN', w: '10 characters', ex: 'ABCPS1234K', a: ['pan no', 'pan number', 'pan of deductee', 'deductee pan', 'pan of the deductee', 'party pan', 'payee pan', 'permanent account number'] },
    { k: 'sec', h: 'Section', need: 1, w: 'Old (194C) or new (393(1) Sl. 6(i)) section, the 4-digit code (1024), or a word (contractor, rent)', ex: '194C', a: ['tds section', 'section code', 'nature', 'nature of payment', 'tds nature', 'tds nature of payment', 'tds head', 'type of payment', 'payment for', 'tds ledger', 'sec'] },
    { k: 'dtype', h: 'Deductee type', w: 'Individual, HUF, Firm, Company... (empty = from the PAN)', ex: 'Individual', a: ['type', 'payee type', 'deductee status', 'status', 'party type', 'deductee category'] },
    { k: 'date', h: 'Date of payment or credit', need: 1, w: 'Bill booked or paid, whichever was first', ex: '15-05-2026', a: ['date', 'payment date', 'date of payment', 'credit date', 'date of credit', 'voucher date', 'bill date', 'invoice date', 'transaction date', 'vch date', 'entry date', 'posting date', 'doc date', 'date of payment/credit', 'date of payment or credit (dd/mm/yyyy)'] },
    { k: 'amt', h: 'Amount paid or credited', need: 1, w: 'Rupees, without GST', ex: '75000', a: ['amount', 'amount paid', 'amount credited', 'gross amount', 'taxable value', 'taxable amount', 'bill amount', 'base amount', 'amount paid/credited', 'amount of payment', 'payment amount', 'value'] },
    { k: 'tds', h: 'TDS deducted', w: 'What you deducted (empty = not known)', ex: '750', a: ['tds', 'tds amount', 'tds amt', 'tax deducted', 'amount of tds', 'tds deducted amount', 'total tax deducted', 'tds rs'] },
    { k: 'rate', h: 'TDS rate %', w: 'The rate you used, if any', ex: '1', a: ['rate', 'tds rate', 'tds %', 'rate %', 'rate of tds', 'rate at which tax deducted'] },
    { k: 'ded', h: 'Date of deduction', w: 'Empty = same as the payment date', ex: '15-05-2026', a: ['deduction date', 'tds date', 'date of tds', 'date of deduction (dd/mm/yyyy)'] },
    { k: 'bsr', h: 'BSR code', w: '7 digits on the challan', ex: '0510308', a: ['bsr', 'bsr code of bank', 'bank bsr code'] },
    { k: 'chsr', h: 'Challan serial no', w: '5 digits on the challan', ex: '00123', a: ['challan no', 'challan serial', 'challan number', 'challan serial number', 'cin serial', 'serial no'] },
    { k: 'chdate', h: 'Challan date', w: 'Date the TDS was paid to the Government', ex: '05-06-2026', a: ['date of deposit', 'deposit date', 'paid on', 'tds paid on', 'date paid', 'challan deposit date', 'date of challan'] },
    { k: 'ldc', h: 'Lower deduction certificate', w: 'Certificate number, if the payee gave one', ex: '', a: ['ldc', 'ldc no', 'certificate no', 'certificate number', 'lower deduction certificate no'] },
    { k: 'ref', h: 'Bill or voucher no', w: '', ex: 'SB/21', a: ['bill no', 'invoice no', 'voucher no', 'vch no', 'ref', 'reference', 'ref no', 'doc no'] }] };
  /* byof2-stock (28 Nov 2026): stock movements and a stock summary from Tally, Busy or any sheet (stkfile.js on stock.) */
  SETS.stock = { k: 'stock', name: 'Stock movements', w: 'One row per goods in or out: item, date, quantity in / out (or one + / - quantity), rate.', cols: [
    { k: 'item', h: 'Item name', need: 1, w: 'Stock item', ex: 'Paracetamol 500 Tab', a: ['item', 'item name', 'stock item', 'stock item name', 'name of item', 'product', 'product name', 'item description', 'description', 'description of goods', 'goods', 'medicine', 'medicine name', 'article', 'sku', 'material', 'material name'] },
    { k: 'date', h: 'Date', need: 1, w: 'Date of the bill or entry', ex: '12-05-2026', a: ['date', 'vch date', 'voucher date', 'bill date', 'invoice date', 'trans date', 'transaction date', 'entry date', 'doc date', 'txn date', 'tran date', 'dated'] },
    { k: 'vtype', h: 'Type', w: 'Purchase, Sales, Opening, Sales return, Damage...', ex: 'Purchase', a: ['vch type', 'voucher type', 'type', 'vtype', 'transaction type', 'trans type', 'entry type', 'doc type', 'nature', 'movement', 'txn type', 'tran type', 'particular', 'remarks'] },
    { k: 'vno', h: 'Voucher no', ex: 'P-101', a: ['vch no', 'vch no.', 'voucher no', 'voucher number', 'bill no', 'invoice no', 'doc no', 'ref no', 'reference'] },
    { k: 'party', h: 'Party', w: 'Supplier or customer', ex: 'Sharma Traders', a: ['particulars', 'party', 'party name', 'account', 'account name', 'supplier', 'customer', 'supplier / customer', 'ledger'] },
    { k: 'inq', h: 'Quantity in', w: 'Goods received', ex: '300', a: ['in', 'in qty', 'qty in', 'inward', 'inwards', 'inward qty', 'inwards qty', 'inward quantity', 'inwards quantity', 'receipt', 'receipts', 'receipt qty', 'received', 'received qty', 'purchase qty', 'stock in', 'qty received'] },
    { k: 'inval', h: 'Value in', ex: '3720', a: ['inward value', 'inwards value', 'in value', 'receipt value', 'purchase value', 'value in'] },
    { k: 'outq', h: 'Quantity out', w: 'Goods sold or issued', ex: '180', a: ['out', 'out qty', 'qty out', 'outward', 'outwards', 'outward qty', 'outwards qty', 'outward quantity', 'outwards quantity', 'issue', 'issues', 'issued', 'issue qty', 'sold', 'sold qty', 'sale qty', 'sales qty', 'stock out', 'qty issued'] },
    { k: 'outval', h: 'Value out', ex: '3240', a: ['outward value', 'outwards value', 'out value', 'issue value', 'sale value', 'sales value', 'value out'] },
    { k: 'qty', h: 'Quantity (+ in / - out)', w: 'One column: plus for goods in, minus for goods out', ex: '-55', a: ['qty', 'quantity', 'qnty', 'nos', 'billed qty', 'actual qty', 'qty (+/-)', 'net qty'] },
    { k: 'rate', h: 'Rate', w: 'Cost per unit for goods in (selling rate for goods out)', ex: '12.40', a: ['rate', 'cost', 'cost price', 'purchase rate', 'unit cost', 'rate per unit', 'price', 'unit price', 'ptr', 'purchase price', 'landing cost', 'landed cost'] },
    { k: 'unit', h: 'Unit', ex: 'Pcs', a: ['unit', 'uom', 'units', 'per', 'unit of measure'] },
    { k: 'batch', h: 'Batch', ex: 'PC2611', a: ['batch', 'batch no', 'batch no.', 'batch number', 'lot', 'lot no', 'batch/lot'] },
    { k: 'exp', h: 'Expiry', w: 'Month and year (03/2027) or a date', ex: '03/2027', a: ['expiry', 'exp', 'exp date', 'expiry date', 'exp. date', 'expiry dt', 'best before', 'use before', 'exp dt'] },
    { k: 'sale', h: 'Selling price', w: 'For the lower of cost and net realisable value (AS 2)', ex: '20', a: ['selling price', 'sale price', 'sales price', 'mrp', 'sale rate', 'selling rate', 'market price', 'nrv', 'net realisable value', 'net realizable value', 'retail price', 'list price'] }] };
  SETS.stocksum = { k: 'stocksum', name: 'Stock summary', w: 'One row per item: closing quantity and its rate or value.', cols: [
    { k: 'item', h: 'Item name', need: 1, ex: 'Wall Putty 20 kg', a: SETS.stock.cols[0].a.concat(['particulars', 'name']) },
    { k: 'close', h: 'Closing quantity', need: 1, ex: '35', a: ['closing quantity', 'closing qty', 'closing balance quantity', 'closing stock', 'closing stock qty', 'stock', 'stock qty', 'balance', 'balance qty', 'qty', 'quantity', 'in hand', 'qty in hand', 'stock in hand', 'current stock', 'cl qty', 'cl. qty'] },
    { k: 'rate', h: 'Rate', ex: '640', a: ['closing rate', 'closing balance rate', 'rate', 'cost', 'cost price', 'purchase rate', 'unit cost', 'avg rate', 'average rate', 'avg cost', 'price'] },
    { k: 'cval', h: 'Closing value', ex: '22400', a: ['closing value', 'closing balance value', 'value', 'stock value', 'amount', 'closing amount', 'cl value', 'cl. value', 'total value'] },
    { k: 'unit', h: 'Unit', ex: 'Bag', a: ['unit', 'uom', 'units', 'per'] },
    { k: 'batch', h: 'Batch', ex: '', a: ['batch', 'batch no', 'batch no.', 'lot', 'lot no'] },
    { k: 'exp', h: 'Expiry', ex: '', a: ['expiry', 'exp', 'exp date', 'expiry date'] },
    { k: 'sale', h: 'Selling price', ex: '600', a: ['selling price', 'sale price', 'mrp', 'sale rate', 'selling rate', 'market price', 'nrv', 'net realisable value', 'net realizable value'] }] };
  /* byof3-noticekit (28 Nov 2026): one row of a mismatch list (GSTR-2B match, 3B vs 1, e-invoice vs GSTR-1, or the visitor's own sheet)
     for the GST notice reply kit on drafts. (noticecore.js). 'a' = the figure as per the visitor's books / return, 'b' = as per the other
     side (GSTR-2B, the notice, the portal); taxa / taxb are the tax columns when a sheet has both taxable value and tax. */
  SETS.notice = { k: 'notice', name: 'Mismatch list', w: 'One row per difference: what differs, the party or bill, the two figures or the difference, and your reason.', cols: [
    { k: 'point', h: 'Point no', w: 'The point of the notice this row answers (1, 2, 3...)', ex: '1', a: ['point', 'para', 'para no', 'notice point', 'point of notice', 'discrepancy no', 'item no', 'sr no', 'sl no', 's no', 'serial no'] },
    { k: 'topic', h: 'Discrepancy', w: 'What differs (empty = the sheet name)', ex: 'ITC in GSTR-3B more than GSTR-2B', a: ['issue', 'mismatch', 'mismatch type', 'type of mismatch', 'what differs', 'nature of difference', 'nature', 'category', 'status', 'result', 'remark', 'head', 'table', 'section', 'particulars of difference', 'difference type'] },
    { k: 'party', h: 'Party', w: 'Supplier or customer', ex: 'Sample Steel Traders', a: ['supplier', 'supplier name', 'customer', 'customer name', 'party name', 'name', 'trade name', 'legal name', 'trade/legal name', 'name of supplier', 'recipient', 'recipient name', 'buyer', 'seller', 'vendor', 'ledger', 'particulars'] },
    { k: 'gstin', h: 'GSTIN', w: '', ex: '03AAFCS5678L1Z5', a: ['gstin of supplier', 'supplier gstin', 'gstin/uin', 'gstin of recipient', 'customer gstin', 'party gstin', 'ctin', 'gstin/uin of recipient', 'gst no'] },
    { k: 'no', h: 'Bill no', w: 'Invoice or note number', ex: 'SST/115', a: ['bill no.', 'invoice no', 'invoice number', 'inv no', 'doc no', 'document no', 'document number', 'note no', 'voucher no', 'vch no', 'bill no (your books)', 'your bill no', 'no', 'invoice no (books)', 'number'] },
    { k: 'date', h: 'Date', w: '', ex: '18-04-2026', a: ['bill date', 'invoice date', 'doc date', 'document date', 'date (your bill)', 'date (books)', 'vch date', 'month', 'period', 'tax period', 'return period'] },
    { k: 'txa', h: 'Taxable (your bill)', w: 'Taxable value as per your books', ex: '22000', a: ['taxable value (books)', 'taxable as per books', 'books taxable', 'taxable (books)', 'taxable value as per books', 'taxable (gstr-1)', 'taxable as per gstr-1'] },
    { k: 'txb', h: 'Taxable (2B)', w: 'Taxable value as per the other side', ex: '22000', a: ['taxable value (2b)', 'taxable as per 2b', 'taxable (gstr-2b)', 'taxable (portal)', 'taxable as per notice', 'taxable (gstr-3b)', 'taxable (e-invoice)'] },
    { k: 'taxa', h: 'Tax (your bill)', w: 'Tax as per your books or your return', ex: '3960', a: ['tax (books)', 'tax as per books', 'books tax', 'tax (gstr-1)', 'tax as per gstr-1', 'gstr-1 tax', 'as per books', 'as per our books', 'as per return', 'as per gstr-3b', 'gstr-3b', 'tax (gstr-3b)', 'claimed', 'itc claimed', 'itc as per books', 'itc in gstr-3b', 'books', 'our figure', 'amount (books)'] },
    { k: 'taxb', h: 'Tax (2B)', w: 'Tax as per GSTR-2B, the portal or the notice', ex: '0', a: ['tax (gstr-2b)', 'tax as per 2b', 'tax (portal)', 'tax (e-invoice)', 'as per notice', 'as per department', 'as per gstr-2b', 'gstr-2b', 'as per gstr-1', 'gstr-1', 'itc as per 2b', 'itc in gstr-2b', 'portal', 'department figure', 'amount (notice)', 'as per portal'] },
    { k: 'tax1', h: 'Tax', w: 'One tax figure, when the sheet lists bills found on one side only', ex: '2700', a: ['tax amount', 'total tax', 'gst', 'gst amount', 'total gst', 'itc amount', 'tax rs', 'tax (rs)'] },
    { k: 'txv1', h: 'Taxable value', w: 'One taxable value, when there is no tax column', ex: '15000', a: ['taxable', 'taxable amount', 'taxable value (rs)', 'value', 'invoice value', 'total value', 'bill amount', 'invoice amount'] },
    { k: 'diff', h: 'Difference', w: 'Rupees; empty = worked out from the two figures', ex: '3960', a: ['gap', 'difference amount', 'diff', 'excess', 'short', 'excess/short', 'variance', 'mismatch amount', 'difference (rs)', 'tax difference', 'amount', 'amount of difference'] },
    { k: 'reason', h: 'Reason', w: 'Your explanation for this row', ex: 'Supplier reported it in May 2026', a: ['reply', 'explanation', 'remarks', 'our reply', 'reason for difference', 'justification', 'comments', 'comment', 'notes'] },
    { k: 'proof', h: 'Proof attached', w: 'Documents you will attach', ex: 'Invoice copy, e-way bill', a: ['proof', 'documents', 'document', 'evidence', 'annexure', 'supporting documents', 'attachment', 'attachments', 'enclosure', 'enclosures'] }] };
  function fieldIn(cols, heading) {   /* cols = a list of columns, or a set { cols } (byof-tds and byof-salary both use it) */
    var h = hk(heading); if (!h) return ''; if (cols && !Array.isArray(cols)) cols = cols.cols || [];
    var f = ''; cols.some(function (c) { if (hk(c.h) === h || (c.a || []).some(function (a) { return hk(a) === h; })) { f = c.k; return true; } return false; }); return f;
  }
  function pick(set, rows, saved) {
    var S = SETS[set]; if (!S) return null;
    var best = null;
    for (var r = 0; r < Math.min((rows || []).length, 15); r++) {
      var heads = rows[r] || [], s = sig(heads);
      if (saved && s && saved[s] && saved[s].map) { best = { row: r, map: saved[s].map, sig: s, heads: heads, remembered: true, score: 1e9 }; break; }
      var map = {}, n = 0, need = 0;
      heads.forEach(function (h, i) { var f = fieldIn(S.cols, h); if (f && !(f in map)) { map[f] = i; n++; if (S.cols.some(function (c) { return c.k === f && c.need; })) need++; } });
      var score = n + need * 2;
      if (n >= 2 && (!best || score > best.score)) best = { row: r, map: map, sig: s, heads: heads, score: score };
    }
    if (best) best.missing = S.cols.filter(function (c) { return c.need && !(c.k in best.map); }).map(function (c) { return c.k; });
    return best;
  }
  /* ---------- another tool's own field sets (byof-salary, 28 Nov 2026): the same heading search, matching and row reading as the import
     sheets, for a list of sets shaped like SHEETS ({ k, name, words (RegExp on the sheet name), cols }). Used by salary-slip's bulk screen
     (salcore.js). readAs(book, sets, opts) -> { <set k>: [rows], found, probs }; opts.layouts / opts.force as in read(). ---------- */
  function layoutAs(sets, name, rows, saved) {
    var best = null;
    for (var r = 0; r < Math.min(rows.length, 15); r++) {
      var heads = rows[r] || [], s = sig(heads);
      if (saved && s && saved[s] && sets.some(function (S) { return S.k === saved[s].kind; })) return { kind: saved[s].kind, row: r, map: saved[s].map, sig: s, heads: heads, remembered: true };
      sets.forEach(function (S) {
        var map = {}, n = 0, need = 0;
        heads.forEach(function (h, i) { var f = fieldIn(S, h); if (f && !(f in map)) { map[f] = i; n++; if (S.cols.some(function (c) { return c.k === f && c.need; })) need++; } });
        var score = n + need * 2 + (S.words && S.words.test(key(name)) ? 3 : 0) + (key(name) === key(S.name) ? 10 : 0);
        if (n >= 2 && (!best || score > best.score)) best = { kind: S.k, row: r, map: map, sig: s, heads: heads, score: score };
      });
    }
    return best;
  }
  function readAs(book, sets, opts) {
    opts = opts || {};
    var D = { found: [], probs: [] }; sets.forEach(function (S) { D[S.k] = []; });
    (book || []).forEach(function (sh) {
      if (key(sh.name) === 'how to fill') return;
      var L = (opts.force && opts.force[sh.name]) || layoutAs(sets, sh.name, sh.rows || [], opts.layouts);
      if (!L) { if ((sh.rows || []).length > 1) D.found.push({ name: sh.name, kind: '', rows: sh.rows.length, heads: (sh.rows[0] || []).slice(0, 30) }); return; }
      var S = sets.filter(function (x) { return x.k === L.kind; })[0], objs = objects(sh.rows, L);
      var miss = S.cols.filter(function (c) { return c.need && !(c.k in L.map); }).map(function (c) { return c.h; });
      D.found.push({ name: sh.name, kind: L.kind, rows: objs.length, map: L.map, sig: L.sig, heads: L.heads, headRow: L.row, remembered: !!L.remembered, missing: miss });
      if (miss.length && objs.length) { D.probs.push({ sheet: sh.name, row: L.row + 1, msg: 'No column for ' + miss.join(', ') + ': choose it with Columns.' }); return; }
      objs.forEach(function (o) { o._s = sh.name; D[L.kind].push(o); });
    });
    return D;
  }
  /* byof-bulkcheck (28 Nov 2026): the heading row and columns of a sheet for ANY list of columns [{ k, h, need, a }], the same
     matching as layout() (heading words and their other names); for one-job lists (GSTINs, HSN codes) that are not import sheets.
     -> { row, map: { field: column }, heads } or null when no heading row names a needed column within the first 15 rows */
  function matchCols(rows, cols) {
    var best = null;
    for (var r = 0; r < Math.min((rows || []).length, 15); r++) {
      var heads = rows[r] || [], map = {}, n = 0, need = 0;
      heads.forEach(function (h, i) { var x = hk(h); if (!x) return; cols.some(function (c) { if (c.k in map) return false; if (hk(c.h) === x || (c.a || []).some(function (a) { return hk(a) === x; })) { map[c.k] = i; n++; if (c.need) need++; return true; } return false; }); });
      if (need && (!best || n + need * 2 > best.score)) best = { row: r, map: map, heads: heads, score: n + need * 2 };
    }
    return best;
  }


  var API = { SHEETS: SHEETS, template: template, layout: layout, sig: sig, read: read, plan: plan, check: check, date: date, amt: amt, stateCode: stateCode, fieldOf: fieldOf, addSet: addSet, match: match, objects: objects, hk: hk, SETS: SETS, pick: pick, fieldIn: fieldIn, layoutAs: layoutAs, readAs: readAs, EXTRA: EXTRA, layoutOf: layoutOf, matchCols: matchCols };
  API.EXTRA = EXTRA; API.layoutOf = layoutOf; API.objects = objects; API.num = num; API.rate = rate; API.RATES = RATES;   /* byof-pricelist (28 Nov 2026) */
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else G.NSTpl = API;
})(typeof window !== 'undefined' ? window : this);
