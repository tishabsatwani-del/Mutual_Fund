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

  /* A consolidated account statement is not one sheet. CAMS and KFintech both
   * write a workbook with a cover, a summary and the transactions on a third
   * tab, and reading sheet1 out of that hands the reader a cover page and a
   * refusal. So the sheets are listed, and which one to read is a choice. */
  function readWorkbook(file, which) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error('this browser cannot unzip it'));
    }
    return file.arrayBuffer().then(function (buf) {
      var entries = unzip(new Uint8Array(buf));
      return sheetIndex(entries).then(function (sheets) {
        var pick = null;
        if (which != null) {
          pick = sheets.filter(function (sh) {
            return sh.name === which || sh.index === which;
          })[0];
        }
        if (!pick) pick = sheets[0];
        var raw = pick && entries[pick.path];
        if (!raw) throw new Error('no worksheet inside');
        return Promise.all([
          inflate(raw),
          entries['xl/sharedStrings.xml'] ? inflate(entries['xl/sharedStrings.xml']) : Promise.resolve(''),
          entries['xl/styles.xml'] ? inflate(entries['xl/styles.xml']) : Promise.resolve('')
        ]).then(function (xml) {
          var rows = sheetToRows(xml[0], xml[1], xml[2]);
          rows.sheetName = pick.name;
          return rows;
        });
      });
    });
  }

  /* The names a reader sees on the tabs, in the order they appear on them. */
  function listSheets(file) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error('this browser cannot unzip it'));
    }
    return file.arrayBuffer().then(function (buf) {
      return sheetIndex(unzip(new Uint8Array(buf))).then(function (sheets) {
        return sheets.map(function (sh) { return sh.name; });
      });
    });
  }

  /* workbook.xml holds the tab names and their relationship ids; the rels file
   * maps those ids to the part each one lives in. The two are NOT in the same
   * order in every writer, which is why the mapping is followed rather than
   * assuming the nth tab is sheetN.xml. Positional order is the fallback for a
   * package with no rels, which some exporters produce. */
  function sheetIndex(entries) {
    var parts = [
      entries['xl/workbook.xml'] ? inflate(entries['xl/workbook.xml']) : Promise.resolve(''),
      entries['xl/_rels/workbook.xml.rels'] ? inflate(entries['xl/_rels/workbook.xml.rels'])
                                            : Promise.resolve('')
    ];
    return Promise.all(parts).then(function (xml) {
      var byId = {};
      String(xml[1]).replace(/<Relationship\b([^>]*)\/?>/g, function (all, attrs) {
        var id = /Id="([^"]*)"/.exec(attrs), target = /Target="([^"]*)"/.exec(attrs);
        if (id && target) {
          var t = target[1].replace(/^\/?xl\//, '').replace(/^\.\//, '');
          byId[id[1]] = 'xl/' + t;
        }
        return all;
      });

      var found = [], seen = 0;
      String(xml[0]).replace(/<sheet\b([^>]*)\/?>/g, function (all, attrs) {
        var name = /name="([^"]*)"/.exec(attrs);
        var rid = /r:id="([^"]*)"/.exec(attrs) || /relationshipId="([^"]*)"/.exec(attrs);
        var path = rid && byId[rid[1]];
        seen++;
        if (!path || !entries[path]) path = 'xl/worksheets/sheet' + seen + '.xml';
        if (entries[path]) {
          found.push({ name: name ? unescapeXml(name[1]) : 'Sheet ' + seen,
                       path: path, index: found.length });
        }
        return all;
      });

      if (found.length) return found;
      /* No workbook.xml at all: fall back to whatever worksheets are in there. */
      return Object.keys(entries)
        .filter(function (k) { return /^xl\/worksheets\/.*\.xml$/.test(k); })
        .sort()
        .map(function (path, i) { return { name: 'Sheet ' + (i + 1), path: path, index: i }; });
    });
  }

  function unescapeXml(t) {
    return String(t).replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
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

  var api = { readWorkbook: readWorkbook, listSheets: listSheets, sheetToRows: sheetToRows };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SimWorkbook = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
