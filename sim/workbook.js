/* Where You Stand — reading a workbook, without a library.
 *
 * Review v4 §5: the door accepts .txt, .csv, .xlsx and .json. The first, second
 * and fourth are text; this is the third. It unzips the package with the
 * browser's own DecompressionStream and walks the sheet XML, so no third-party
 * spreadsheet library ships with the tool and no request leaves the page.
 *
 * Lifted out of tool/app.js unchanged so the older tool and the four new
 * screens read a workbook the same way rather than each having their own.
 */
(function (root) {
  'use strict';

  function readWorkbook(file) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error('this browser cannot unzip it'));
    }
    return file.arrayBuffer().then(function (buf) {
      var entries = unzip(new Uint8Array(buf));
      var sheet = entries['xl/worksheets/sheet1.xml'];
      if (!sheet) {
        var first = Object.keys(entries).filter(function (k) { return /^xl\/worksheets\/.*\.xml$/.test(k); }).sort()[0];
        sheet = first && entries[first];
      }
      if (!sheet) throw new Error('no worksheet inside');
      return Promise.all([
        inflate(sheet),
        entries['xl/sharedStrings.xml'] ? inflate(entries['xl/sharedStrings.xml']) : Promise.resolve(''),
        entries['xl/styles.xml'] ? inflate(entries['xl/styles.xml']) : Promise.resolve('')
      ]).then(function (xml) { return sheetToRows(xml[0], xml[1], xml[2]); });
    });
  }

  function unzip(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var out = {};
    /* walk local file headers; enough for the flat packages Excel writes */
    var i = 0;
    while (i < bytes.length - 4) {
      if (view.getUint32(i, true) !== 0x04034b50) break;
      var method = view.getUint16(i + 8, true);
      var compSize = view.getUint32(i + 18, true);
      var uncompSize = view.getUint32(i + 22, true);
      var nameLen = view.getUint16(i + 26, true);
      var extraLen = view.getUint16(i + 28, true);
      var nameStart = i + 30;
      var name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen));
      var dataStart = nameStart + nameLen + extraLen;
      if (compSize === 0 && uncompSize === 0) break;   /* streamed entry: give up cleanly */
      out[name] = { method: method, data: bytes.subarray(dataStart, dataStart + compSize) };
      i = dataStart + compSize;
    }
    if (!Object.keys(out).length) throw new Error('not a readable workbook');
    return out;
  }

  function inflate(entry) {
    if (entry.method === 0) return Promise.resolve(new TextDecoder().decode(entry.data));
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([entry.data]).stream().pipeThrough(ds);
    return new Response(stream).text();
  }

  var DATE_FORMAT_IDS = [14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57, 58];

  function sheetToRows(sheetXml, sharedXml, stylesXml) {
    var dom = new DOMParser();
    var shared = [];
    if (sharedXml) {
      var sdoc = dom.parseFromString(sharedXml, 'application/xml');
      Array.prototype.forEach.call(sdoc.getElementsByTagName('si'), function (si) {
        var text = '';
        Array.prototype.forEach.call(si.getElementsByTagName('t'), function (t) { text += t.textContent; });
        shared.push(text);
      });
    }
    /* which cell styles mean "this number is a date" */
    var dateStyles = {};
    if (stylesXml) {
      var stdoc = dom.parseFromString(stylesXml, 'application/xml');
      var customDate = {};
      Array.prototype.forEach.call(stdoc.getElementsByTagName('numFmt'), function (f) {
        var code = f.getAttribute('formatCode') || '';
        if (/[dmy]/i.test(code) && !/[#0]/.test(code.replace(/\[[^\]]*\]/g, ''))) {
          customDate[f.getAttribute('numFmtId')] = true;
        }
      });
      var xfs = stdoc.getElementsByTagName('cellXfs')[0];
      if (xfs) Array.prototype.forEach.call(xfs.getElementsByTagName('xf'), function (xf, idx) {
        var id = xf.getAttribute('numFmtId');
        if (customDate[id] || DATE_FORMAT_IDS.indexOf(+id) !== -1) dateStyles[idx] = true;
      });
    }

    var doc = dom.parseFromString(sheetXml, 'application/xml');
    var rows = [];
    Array.prototype.forEach.call(doc.getElementsByTagName('row'), function (r) {
      var cells = [];
      Array.prototype.forEach.call(r.getElementsByTagName('c'), function (c) {
        var ref = c.getAttribute('r') || '';
        var col = colIndex(ref.replace(/\d+/g, ''));
        var type = c.getAttribute('t');
        var styleIdx = c.getAttribute('s');
        var vNode = c.getElementsByTagName('v')[0];
        var value = '';
        if (type === 'inlineStr') {
          var isNode = c.getElementsByTagName('t')[0];
          value = isNode ? isNode.textContent : '';
        } else if (type === 's') {
          value = shared[+(vNode ? vNode.textContent : -1)] || '';
        } else if (vNode) {
          value = vNode.textContent;
          if (dateStyles[+styleIdx] && isFinite(+value)) value = serialToIso(+value);
        }
        while (cells.length < col) cells.push('');
        cells[col] = value;
      });
      if (cells.some(function (c) { return c !== ''; })) rows.push(cells);
    });
    if (!rows.length) throw new Error('the first sheet is empty');
    return rows;
  }

  function colIndex(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return Math.max(0, n - 1);
  }
  /* Excel counts days from 30 December 1899, and pretends 1900 was a leap year. */
  function serialToIso(serial) {
    var ms = Math.round((serial - 25569) * 86400000);
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
           String(d.getUTCDate()).padStart(2, '0');
  }

  var api = { readWorkbook: readWorkbook, sheetToRows: sheetToRows };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SimWorkbook = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
