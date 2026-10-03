/* Where You Stand: reading an old Excel file (.xls), without a library.
 *
 * Fund houses still hand out NAV histories as .xls, and a file with that
 * ending can be any of five things inside:
 *   a binary workbook (Excel 97 to 2003, or 95), the real old format;
 *   an HTML table saved under an Excel name, which is what most websites'
 *     "Download to Excel" buttons write;
 *   an Excel 2003 XML spreadsheet;
 *   a newer .xlsx package under the old ending;
 *   plain text with commas or tabs.
 * Each is read here, on the device, into the same rows a CSV gives: one array
 * of cells per row, a date-formatted number written as yyyy-mm-dd. Nothing is
 * sent anywhere.
 *
 *   PRCXls.read(arrayBuffer) -> { kind, sheets: [{ name, rows }] }   (throws if unreadable)
 *   kind: 'biff' | 'html' | 'xml' | 'text' | 'zip' (the caller reads a zip as .xlsx)
 */
(function (root) {
  'use strict';

  function read(buf) {
    var bytes = new Uint8Array(buf);
    if (bytes.length >= 8 && bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) {
      return { kind: 'biff', sheets: readBiff(bytes) };
    }
    if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 3 && bytes[3] === 4) return { kind: 'zip', sheets: [] };
    var text = decode(bytes);
    /* Excel 2003 XML first: its <Table> is not an HTML table */
    if (/<(\w+:)?Workbook\b[^>]*urn:schemas-microsoft-com:office:spreadsheet/i.test(text) || /<(ss:)?Worksheet\b/i.test(text)) return { kind: 'xml', sheets: xmlSheets(text) };
    if (/<table\b/i.test(text)) return { kind: 'html', sheets: [{ name: 'Sheet 1', rows: htmlRows(text) }] };
    return { kind: 'text', sheets: [], text: text };
  }
  function decode(bytes) {
    var t;
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    t = new TextDecoder('utf-8').decode(bytes);
    if (t.indexOf('�') !== -1) { try { t = new TextDecoder('windows-1252').decode(bytes); } catch (e) { /* keep utf-8 */ } }
    return t.replace(/^﻿/, '');
  }

  /* ============================================== the compound file around a workbook */
  var END = 0xFFFFFFFE, FREE = 0xFFFFFFFF;
  function readBiff(bytes) {
    var cfb = compoundFile(bytes);
    var stream = cfb.stream('Workbook') || cfb.stream('Book');
    if (!stream) throw new Error('no workbook inside');
    return biffSheets(stream);
  }
  function compoundFile(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var u32 = function (o) { return view.getUint32(o, true); };
    var secSize = 1 << view.getUint16(30, true), miniSize = 1 << view.getUint16(32, true);
    var nFat = u32(44), dirStart = u32(48), cutoff = u32(56), miniFatStart = u32(60), difatStart = u32(68);
    function sectorOffset(n) { return (n + 1) * secSize; }
    /* the FAT's own sectors: 109 in the header, the rest chained through DIFAT sectors */
    var fatSectors = [];
    for (var i = 0; i < 109 && fatSectors.length < nFat; i++) { var s = u32(76 + i * 4); if (s !== FREE) fatSectors.push(s); }
    var d = difatStart, guard = 0;
    while (d !== END && d !== FREE && fatSectors.length < nFat && guard++ < 10000) {
      var off = sectorOffset(d), per = secSize / 4 - 1;
      for (var k = 0; k < per && fatSectors.length < nFat; k++) { var f = u32(off + k * 4); if (f !== FREE) fatSectors.push(f); }
      d = u32(off + per * 4);
    }
    var fat = [];
    fatSectors.forEach(function (fs) { var o = sectorOffset(fs); for (var j = 0; j < secSize / 4; j++) fat.push(u32(o + j * 4)); });
    function chain(start, table) {
      var out = [], n = start, seen = 0;
      while (n !== END && n !== FREE && n < table.length && seen++ < table.length + 1) { out.push(n); n = table[n]; }
      return out;
    }
    function bigStream(start, size) {
      var out = new Uint8Array(size), pos = 0;
      chain(start, fat).forEach(function (n) {
        if (pos >= size) return;
        var o = sectorOffset(n), take = Math.min(secSize, size - pos);
        out.set(bytes.subarray(o, o + take), pos); pos += take;
      });
      if (pos < size) throw new Error('the workbook is cut short');
      return out;
    }
    /* the directory */
    var dirBytes = [], dirChain = chain(dirStart, fat);
    dirChain.forEach(function (n) { var o = sectorOffset(n); dirBytes.push(bytes.subarray(o, o + secSize)); });
    var entries = [];
    dirBytes.forEach(function (sec) {
      for (var e = 0; e + 128 <= sec.length; e += 128) {
        var dv = new DataView(sec.buffer, sec.byteOffset + e, 128);
        var nameLen = dv.getUint16(64, true), type = dv.getUint8(66);
        var name = '';
        for (var c = 0; c + 2 < nameLen && c < 62; c += 2) name += String.fromCharCode(dv.getUint16(c, true));
        entries.push({ name: name, type: type, start: dv.getUint32(116, true), size: dv.getUint32(120, true) });
      }
    });
    var rootEntry = entries.filter(function (x) { return x.type === 5; })[0];
    var miniStream = null, miniFat = null;
    function mini() {
      if (miniStream) return;
      miniStream = rootEntry ? bigStream(rootEntry.start, rootEntry.size) : new Uint8Array(0);
      miniFat = [];
      chain(miniFatStart, fat).forEach(function (n) { var o = sectorOffset(n); for (var j = 0; j < secSize / 4; j++) miniFat.push(u32(o + j * 4)); });
    }
    return {
      stream: function (name) {
        var hit = entries.filter(function (x) { return x.type === 2 && x.name.toLowerCase() === name.toLowerCase(); })[0];
        if (!hit) return null;
        if (hit.size >= cutoff) return bigStream(hit.start, hit.size);
        mini();
        var out = new Uint8Array(hit.size), pos = 0;
        chain(hit.start, miniFat).forEach(function (n) {
          if (pos >= hit.size) return;
          var o = n * miniSize, take = Math.min(miniSize, hit.size - pos);
          out.set(miniStream.subarray(o, o + take), pos); pos += take;
        });
        return out;
      }
    };
  }

  /* ============================================================ the workbook's records */
  var DATE_FORMAT_IDS = [14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58];
  /* a format that writes a day, a month or a year, and no digits of a number:
     "dd-mmm-yyyy" is a date, "h:mm" a time, "#,##0.0000" a number */
  function dateCode(code) {
    var c = String(code || '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '').toLowerCase();
    if (/[#0?]/.test(c)) return false;
    return /[dy]/.test(c) || (/m/.test(c) && !/[hs]/.test(c));
  }
  function biffSheets(s) {
    var view = new DataView(s.buffer, s.byteOffset, s.byteLength);
    var records = [], pos = 0;
    while (pos + 4 <= s.length) {
      var type = view.getUint16(pos, true), len = view.getUint16(pos + 2, true);
      records.push({ type: type, at: pos + 4, len: len });
      pos += 4 + len;
    }
    var biff8 = true, sst = [], formats = {}, xfs = [], date1904 = false, sheets = [];
    /* the globals: up to the first EOF */
    var i = 0;
    for (; i < records.length; i++) {
      var r = records[i];
      if (r.type === 0x0809 && i === 0) { biff8 = view.getUint16(r.at, true) === 0x0600; continue; }
      if (r.type === 0x000A) { i++; break; }
      if (r.type === 0x0022) date1904 = view.getUint16(r.at, true) === 1;
      else if (r.type === 0x041E || r.type === 0x001E) {
        var id = view.getUint16(r.at, true);
        formats[id] = biff8 ? xlString(s, r.at + 2, 2).text : byteString(s, r.at + 2, 1).text;
      } else if (r.type === 0x00E0) xfs.push(view.getUint16(r.at + 2, true));
      else if (r.type === 0x0085) {
        var bof = view.getUint32(r.at, true), kind = view.getUint8(r.at + 5);
        var nm = biff8 ? shortString(s, r.at + 6) : byteString(s, r.at + 6, 1).text;
        if (kind === 0) sheets.push({ name: nm, bof: bof, rows: [] });
      } else if (r.type === 0x00FC) sst = readSst(s, view, records, i);
    }
    var dateXf = xfs.map(function (fmt) {
      if (DATE_FORMAT_IDS.indexOf(fmt) !== -1) return true;
      return dateCode(formats[fmt]);
    });
    function serialIso(n) {
      var ms = Math.round((n - (date1904 ? 24107 : 25569)) * 86400000), d = new Date(ms);
      return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    }
    function numberCell(n, xf) { return dateXf[xf] && n > 0 && n < 2958466 ? serialIso(n) : String(n); }
    /* each sheet from its BOF to its EOF */
    var byOffset = {};
    records.forEach(function (rec, k) { byOffset[rec.at - 4] = k; });
    sheets.forEach(function (sh) {
      var k = byOffset[sh.bof];
      if (k == null) return;
      var grid = [], pendingFormula = null;
      function put(row, col, v) {
        while (grid.length <= row) grid.push([]);
        var line = grid[row];
        while (line.length < col) line.push('');
        line[col] = v;
      }
      for (var j = k + 1; j < records.length; j++) {
        var rec = records[j], at = rec.at, t = rec.type;
        if (t === 0x000A) break;
        if (t === 0x00FD) put(view.getUint16(at, true), view.getUint16(at + 2, true), sst[view.getUint32(at + 6, true)] || '');
        else if (t === 0x0203) put(view.getUint16(at, true), view.getUint16(at + 2, true), numberCell(view.getFloat64(at + 6, true), view.getUint16(at + 4, true)));
        else if (t === 0x027E) put(view.getUint16(at, true), view.getUint16(at + 2, true), numberCell(rk(view, at + 6), view.getUint16(at + 4, true)));
        else if (t === 0x00BD) {
          var row = view.getUint16(at, true), c0 = view.getUint16(at + 2, true), n = (rec.len - 6) / 6;
          for (var m = 0; m < n; m++) put(row, c0 + m, numberCell(rk(view, at + 4 + m * 6 + 2), view.getUint16(at + 4 + m * 6, true)));
        } else if (t === 0x0204) put(view.getUint16(at, true), view.getUint16(at + 2, true), biff8 ? xlString(s, at + 6, 2).text : byteString(s, at + 6, 2).text);
        else if (t === 0x00D6) put(view.getUint16(at, true), view.getUint16(at + 2, true), byteString(s, at + 6, 2).text);
        else if (t === 0x0006) {
          var fr = view.getUint16(at, true), fc = view.getUint16(at + 2, true), fxf = view.getUint16(at + 4, true);
          if (view.getUint16(at + 12, true) === 0xFFFF) {
            var ft = view.getUint8(at + 6);
            if (ft === 0) pendingFormula = { row: fr, col: fc };
            else if (ft === 1) put(fr, fc, view.getUint8(at + 8) ? 'TRUE' : 'FALSE');
          } else put(fr, fc, numberCell(view.getFloat64(at + 6, true), fxf));
        } else if (t === 0x0207 && pendingFormula) {
          put(pendingFormula.row, pendingFormula.col, biff8 ? xlString(s, at, 2).text : byteString(s, at, 2).text);
          pendingFormula = null;
        } else if (t === 0x0205) {
          if (!view.getUint8(at + 7)) put(view.getUint16(at, true), view.getUint16(at + 2, true), view.getUint8(at + 6) ? 'TRUE' : 'FALSE');
        }
      }
      sh.rows = grid.filter(function (line) { return line.some(function (c) { return c !== '' && c != null; }); })
        .map(function (line) { return line.map(function (c) { return c == null ? '' : c; }); });
    });
    return sheets.map(function (sh) { return { name: sh.name, rows: sh.rows }; });
  }
  function rk(view, at) {
    var v = view.getInt32(at, true), d;
    if (v & 2) d = v >> 2;
    else {
      var b = new DataView(new ArrayBuffer(8));
      b.setUint32(0, 0, true); b.setUint32(4, (v & 0xFFFFFFFC) >>> 0, true);
      d = b.getFloat64(0, true);
    }
    return v & 1 ? d / 100 : d;
  }
  /* strings: a count, a flag byte (bit 0: two bytes a character), the characters */
  function xlString(s, at, countBytes) {
    var view = new DataView(s.buffer, s.byteOffset, s.byteLength);
    var n = countBytes === 2 ? view.getUint16(at, true) : view.getUint8(at);
    var flags = view.getUint8(at + countBytes), p = at + countBytes + 1;
    var rich = flags & 0x08 ? view.getUint16(p, true) : 0; if (flags & 0x08) p += 2;
    var ext = flags & 0x04 ? view.getUint32(p, true) : 0; if (flags & 0x04) p += 4;
    var text = chars(s, p, n, flags & 1);
    return { text: text, end: p + n * (flags & 1 ? 2 : 1) + rich * 4 + ext };
  }
  function shortString(s, at) { return xlString(s, at, 1).text; }
  function byteString(s, at, countBytes) {
    var view = new DataView(s.buffer, s.byteOffset, s.byteLength);
    var n = countBytes === 2 ? view.getUint16(at, true) : view.getUint8(at);
    return { text: chars(s, at + countBytes, n, 0), end: at + countBytes + n };
  }
  function chars(s, p, n, wide) {
    var out = '';
    for (var i = 0; i < n; i++) out += String.fromCharCode(wide ? s[p + i * 2] | (s[p + i * 2 + 1] << 8) : s[p + i]);
    return out;
  }
  /* The shared strings run on through CONTINUE records, and a string that
     crosses into one starts again with its own flag byte. */
  function readSst(s, view, records, i) {
    var parts = [records[i]];
    for (var k = i + 1; k < records.length && records[k].type === 0x003C; k++) parts.push(records[k]);
    var pi = 0, p = parts[0].at + 8, end = parts[0].at + parts[0].len;
    var total = view.getUint32(parts[0].at + 4, true), out = [];
    function next() { pi++; if (pi >= parts.length) return false; p = parts[pi].at; end = p + parts[pi].len; return true; }
    function need(n) { if (p + n > end && !next()) throw new Error('shared strings cut short'); }
    for (var sIdx = 0; sIdx < total; sIdx++) {
      if (p >= end && !next()) break;
      need(3);
      var n = view.getUint16(p, true), flags = view.getUint8(p + 2); p += 3;
      var rich = 0, ext = 0;
      if (flags & 0x08) { need(2); rich = view.getUint16(p, true); p += 2; }
      if (flags & 0x04) { need(4); ext = view.getUint32(p, true); p += 4; }
      var wide = flags & 1, text = '', left = n;
      while (left > 0) {
        if (p >= end) { if (!next()) break; wide = view.getUint8(p) & 1; p += 1; }
        var room = Math.floor((end - p) / (wide ? 2 : 1)), take = Math.min(left, room);
        text += chars(s, p, take, wide); p += take * (wide ? 2 : 1); left -= take;
      }
      var skip = rich * 4 + ext;
      while (skip > 0) { if (p >= end && !next()) break; var sk = Math.min(skip, end - p); p += sk; skip -= sk; }
      out.push(text);
    }
    return out;
  }

  /* ===================================================== an HTML table under an Excel name */
  function decodeEntities(t) {
    return String(t).replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
      .replace(/&#x([0-9a-f]+);/gi, function (a, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (a, d) { return String.fromCharCode(+d); }).replace(/&amp;/gi, '&');
  }
  function cellText(html) {
    return decodeEntities(String(html).replace(/<br\s*\/?>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
  }
  function htmlRows(text) {
    var rows = [];
    var body = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    var trRe = /<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table>|$)/gi, tr;
    while ((tr = trRe.exec(body))) {
      var cells = [], cellRe = /<t([dh])\b([^>]*)>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi, td;
      while ((td = cellRe.exec(tr[1]))) {
        cells.push(cellText(td[3].replace(/<\/t[dh]>[\s\S]*$/i, '')));
        var span = /colspan\s*=\s*["']?(\d+)/i.exec(td[2]);
        for (var k = 1; span && k < Math.min(+span[1], 50); k++) cells.push('');
      }
      if (cells.some(function (c) { return c !== ''; })) rows.push(cells);
    }
    if (!rows.length) throw new Error('the table inside is empty');
    return rows;
  }

  /* =================================================== an Excel 2003 XML spreadsheet */
  function xmlSheets(text) {
    var out = [], wsRe = /<(?:\w+:)?Worksheet\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?Worksheet>/gi, ws;
    while ((ws = wsRe.exec(text))) {
      var name = /Name="([^"]*)"/i.exec(ws[1]);
      var rows = [], rowRe = /<(?:\w+:)?Row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?Row>)/gi, rw, at = 0;
      while ((rw = rowRe.exec(ws[2]))) {
        var ri = /(?:\w+:)?Index="(\d+)"/i.exec(rw[1]);
        if (ri) at = +ri[1] - 1;
        var cells = [], cellRe = /<(?:\w+:)?Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?Cell>)/gi, cl, col = 0;
        while ((cl = cellRe.exec(rw[2] || ''))) {
          var ci = /(?:\w+:)?Index="(\d+)"/i.exec(cl[1]);
          if (ci) col = +ci[1] - 1;
          var data = /<(?:\w+:)?Data\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?Data>/i.exec(cl[2] || '');
          var v = data ? cellText(data[2]) : '';
          if (data && /Type="DateTime"/i.test(data[1])) v = v.slice(0, 10);
          while (cells.length < col) cells.push('');
          cells[col] = v;
          var across = /MergeAcross="(\d+)"/i.exec(cl[1]);
          col += 1 + (across ? +across[1] : 0);
        }
        while (rows.length < at) rows.push([]);
        rows[at] = cells; at++;
      }
      out.push({ name: name ? decodeEntities(name[1]) : 'Sheet ' + (out.length + 1),
                 rows: rows.filter(function (r) { return r && r.some(function (c) { return c !== '' && c != null; }); }) });
    }
    if (!out.length) throw new Error('no worksheet inside');
    return out;
  }

  var api = { read: read, htmlRows: htmlRows, xmlSheets: xmlSheets };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PRCXls = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
