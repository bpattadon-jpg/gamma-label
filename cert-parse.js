/* อ่านข้อมูลจากไฟล์ "CERTIFICATE OF GAMMA IRRADIATION" (แบบฟอร์ม FM-IC-02-71)
   รับ text items ของแต่ละหน้าจาก pdf.js แล้วคืนค่า
   { ref, issued, client, totalCartons, jobText, jobs[], orderNo, irrDate, minDose, maxDose, tfc, lots:[{product, lot, cartons}], warnings[] } */
(function (root) {
  'use strict';

  // รวม text items เป็นบรรทัด แล้วรวมชิ้นที่อยู่ติดกันเป็นช่อง (chunk)
  function toLines(items) {
    const rows = [];
    items.filter(it => String(it.str).trim() !== '').forEach(it => {
      const x = it.transform[4], y = it.transform[5], w = it.width || 0;
      let row = rows.find(r => Math.abs(r.y - y) <= 2);
      if (!row) { row = { y: y, items: [] }; rows.push(row); }
      row.items.push({ x: x, x2: x + w, s: String(it.str) });
    });
    rows.sort((a, b) => b.y - a.y);
    return rows.map(r => {
      r.items.sort((a, b) => a.x - b.x);
      const chunks = [];
      r.items.forEach(it => {
        const last = chunks[chunks.length - 1];
        const gap = last ? it.x - last.x2 : Infinity;
        if (last && gap < 1.5) { last.s += it.s; last.x2 = Math.max(last.x2, it.x2); }
        else if (last && gap < 12) { last.s += ' ' + it.s; last.x2 = Math.max(last.x2, it.x2); }
        else chunks.push({ x: it.x, x2: it.x2, s: it.s });
      });
      chunks.forEach(c => { c.s = c.s.replace(/\s+/g, ' ').trim(); });
      return { y: r.y, chunks: chunks.filter(c => c.s), text: chunks.map(c => c.s).join('  ').replace(/\s+/g, ' ').trim() };
    });
  }

  const num = s => Number(String(s).replace(/,/g, ''));

  // "12095.1-12095.2" → ['12095.1','12095.2'], "12098" → ['12098'], "12095.1,12095.3" → [...]
  function expandJobs(text) {
    const out = [];
    String(text || '').split(/[,;/]|\s+and\s+/i).map(s => s.trim()).filter(Boolean).forEach(part => {
      const m = part.match(/^(\d+)(?:\.(\d+))?\s*[-–]\s*(\d+)(?:\.(\d+))?$/);
      if (m) {
        const [, b1, s1, b2, s2] = m;
        if (s1 && s2 && b1 === b2 && +s2 >= +s1 && +s2 - +s1 <= 50) { for (let i = +s1; i <= +s2; i++) out.push(b1 + '.' + i); return; }
        if (!s1 && !s2 && +b2 >= +b1 && +b2 - +b1 <= 50) { for (let i = +b1; i <= +b2; i++) out.push(String(i)); return; }
        out.push(b1 + (s1 ? '.' + s1 : '')); out.push(b2 + (s2 ? '.' + s2 : '')); return;
      }
      const one = part.match(/^\d+(?:\.\d+)?$/);
      if (one) out.push(part);
    });
    return Array.from(new Set(out));
  }

  function parseCertificate(pages) {
    const lines = [];
    pages.forEach((items, p) => toLines(items).forEach(l => { l.page = p + 1; lines.push(l); }));
    const all = lines.map(l => l.text).join('\n');
    const pick = (re, i) => { const m = all.match(re); return m ? m[i || 1].trim() : ''; };

    const res = {
      title: /CERTIFICATE OF GAMMA IRRADIATION/i.test(all) ? 'CERTIFICATE OF GAMMA IRRADIATION' : '',
      ref: pick(/Reference No\.?\s*:?\s*([^\s]+)/i),
      issued: pick(/Issued date\s*:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i),
      client: pick(/Client Name and Address\s*:\s*(.+)/i),
      totalCartons: num(pick(/Total\s+Quantity\s*\(cartons\)\s*:\s*([\d,]+)/i)) || 0,
      orderNo: pick(/Irradiation Order No\.?\s*:\s*(.+?)(?:\s{2,}|\s+Irradiation Minimum|$)/im),
      jobText: pick(/Irradiation Job No\.?\s*:\s*([\d.]+(?:\s*[-–,]\s*[\d.]+)*)/i),
      irrDate: pick(/Irradiation Date\s*:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i),
      minDose: pick(/Minimum Dose\s*\(kGy\)\s*:\s*([\d.]+)/i),
      maxDose: pick(/Maximum Dose\s*\(kGy\)\s*:\s*([\d.]+)/i),
      tfc: pick(/\(TFC\)\s*:\s*([^\s]+)/i),
      lots: [],
      warnings: []
    };
    res.jobs = expandJobs(res.jobText);

    // ตาราง Details of products (อาจต่อหลายหน้า)
    let cols = null, inTable = false;
    lines.forEach((l, idx) => {
      if (/Lot No/i.test(l.text) && /Numbers? of/i.test(l.text)) {
        const ch = l.chunks;
        const prod = ch.find(c => /Product/i.test(c.s)), lot = ch.find(c => /Lot No/i.test(c.s)), qty = ch.find(c => /Numbers? of/i.test(c.s));
        cols = { prodX: prod ? prod.x : 0, lotX: lot ? lot.x : 250, lotX2: lot ? lot.x2 : 400, qtyX: qty ? qty.x : 430 };
        inTable = true; return;
      }
      if (!inTable) return;
      if (/^(Remark|Approved by|This report|Irradiation Center, Thailand|FM-IC|Page \d)/i.test(l.text) || l.y < 85) { inTable = false; return; }
      const ch = l.chunks.slice();
      const last = ch[ch.length - 1];
      const hasQty = last && /^[\d,]+$/.test(last.s) && last.x >= cols.qtyX - 40;
      const qty = hasQty ? num(ch.pop().s) : null;
      const lotEdge = cols.lotX - 25;
      const lotPart = ch.filter(c => (c.x + c.x2) / 2 >= lotEdge).map(c => c.s).join(' ');
      const prodPart = ch.filter(c => (c.x + c.x2) / 2 < lotEdge).map(c => c.s).join(' ');
      const prev = res.lots[res.lots.length - 1];
      if (hasQty) {
        res.lots.push({ product: prodPart || (prev ? prev.product : ''), lot: lotPart, cartons: qty });
      } else if (prev && l.page === prev._page) {           // บรรทัดต่อของชื่อสินค้า/เลข Lot ที่ขึ้นบรรทัดใหม่
        if (prodPart) prev.product = (prev.product + ' ' + prodPart).trim();
        if (lotPart) prev.lot = (prev.lot + ' ' + lotPart).trim();
      }
      if (hasQty) res.lots[res.lots.length - 1]._page = l.page;
    });
    res.lots.forEach(r => { delete r._page; });

    // ตรวจความครบถ้วน
    const sum = res.lots.reduce((a, r) => a + r.cartons, 0);
    if (!res.title) res.warnings.push('ไม่ใช่แบบฟอร์ม CERTIFICATE OF GAMMA IRRADIATION');
    if (!res.ref) res.warnings.push('ไม่พบเลขที่อ้างอิง (Reference No.)');
    if (!res.jobs.length) res.warnings.push('ไม่พบ Irradiation Job No.');
    if (!res.lots.length) res.warnings.push('ไม่พบรายการ Lot');
    if (res.lots.some(r => !r.lot)) res.warnings.push('มีบางแถวที่ไม่มีเลข Lot');
    if (res.totalCartons && sum !== res.totalCartons) res.warnings.push('ผลรวมกล่องของทุก Lot (' + sum + ') ไม่เท่ากับ Total Quantity (' + res.totalCartons + ')');
    res.sumCartons = sum;
    return res;
  }

  const api = { parseCertificate: parseCertificate, expandJobs: expandJobs, toLines: toLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CertParse = api;
})(this);
