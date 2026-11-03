/* Where You Stand: opening a locked statement on the device.
 *
 * A registrar's statement arrives locked: a PDF, an Excel workbook or a zip
 * archive, each sealed with the password the reader set when they asked for
 * it. This file undoes that seal here, in the page, from the password the
 * reader types. The password is used once, for the file in hand, and is kept
 * nowhere: not written to this device, not sent anywhere, not remembered
 * after the file is read. Nothing in this file touches the network.
 *
 * What it opens, and how each format says it is locked:
 *   an Excel workbook (.xlsx) saved with a password: an OLE compound file holding
 *     EncryptionInfo and EncryptedPackage, in Office's "standard" form (AES-ECB,
 *     SHA-1, 50,000 spins) or its "agile" form (AES-CBC in 4,096-byte segments,
 *     SHA-1 / SHA-256 / SHA-384 / SHA-512, the spin count the file names);
 *   an old workbook (.xls) with a FILEPASS record: RC4 keyed by MD5 (the Excel
 *     97 way) or by SHA-1 through CryptoAPI, re-keyed every 1,024 bytes of the
 *     stream, with the record headers and a few records left in the clear;
 *   a zip archive: the traditional PKWARE cipher, or WinZip's AES (AE-1, AE-2)
 *     with PBKDF2-SHA1 and a little-endian counter.
 * A locked PDF is opened by pdf.js (pdfrows.js), which takes the password itself.
 *
 * Every primitive is written out here (MD5, SHA-1, SHA-256, SHA-384, SHA-512,
 * HMAC, PBKDF2, AES, RC4), so the page needs no library and stays readable.
 * Each is checked against Node's own crypto in ../tests/locked.test.js.
 * A wrong password is reported as one (error.wrong); nothing is guessed.
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------ bytes */
  function concat(list) {
    var n = 0, i;
    for (i = 0; i < list.length; i++) n += list[i].length;
    var out = new Uint8Array(n), p = 0;
    for (i = 0; i < list.length; i++) { out.set(list[i], p); p += list[i].length; }
    return out;
  }
  function utf16le(s) {
    var out = new Uint8Array(s.length * 2);
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); out[2 * i] = c & 255; out[2 * i + 1] = c >>> 8; }
    return out;
  }
  function utf8(s) { return new TextEncoder().encode(s); }
  function le32(n) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }
  function rd32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function rd16(b, o) { return b[o] | (b[o + 1] << 8); }
  function same(a, b, n) {
    if (a.length < n || b.length < n) return false;
    var d = 0;
    for (var i = 0; i < n; i++) d |= a[i] ^ b[i];
    return d === 0;
  }
  function fromBase64(s) {
    var clean = String(s || '').replace(/[^A-Za-z0-9+\/=]/g, '');
    var bin = typeof atob === 'function' ? atob(clean) : Buffer.from(clean, 'base64').toString('binary');
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
    return out;
  }
  function wrong() { var e = new Error('wrong password'); e.wrong = true; return e; }
  function unsupported(what) { var e = new Error('this file is locked in a form that cannot be opened here' + (what ? ' (' + what + ')' : '')); e.unsupported = true; return e; }

  /* ------------------------------------------------------- the hashes
     Round constants are derived here from their definitions (the fractional
     parts of the square and cube roots of the first primes), so no table of
     eighty 64-bit numbers has to be typed and trusted. */
  function primes(n) { var out = [], k = 2; while (out.length < n) { var p = true; for (var i = 0; i < out.length && out[i] * out[i] <= k; i++) if (k % out[i] === 0) { p = false; break; } if (p) out.push(k); k++; } return out; }
  function iroot(n, k) {   /* floor of the k-th root of a BigInt, Newton from above */
    var K = BigInt(k), x = BigInt(1) << BigInt(Math.ceil(n.toString(2).length / k) + 1);
    for (;;) {
      var y = ((K - BigInt(1)) * x + n / (x ** (K - BigInt(1)))) / K;
      if (y >= x) return x;
      x = y;
    }
  }
  var MASK64 = (BigInt(1) << BigInt(64)) - BigInt(1), MASK32 = BigInt(0xFFFFFFFF);
  function frac64(p, k, shift) { return iroot(BigInt(p) << BigInt(shift), k) & MASK64; }
  function pair(b) { return [Number(b >> BigInt(32)) >>> 0, Number(b & MASK32) >>> 0]; }
  var P80 = primes(80);
  var K512 = P80.map(function (p) { return pair(frac64(p, 3, 192)); });
  var H512 = P80.slice(0, 8).map(function (p) { return pair(frac64(p, 2, 128)); });
  var H384 = P80.slice(8, 16).map(function (p) { return pair(frac64(p, 2, 128)); });
  var K256 = P80.slice(0, 64).map(function (p) { return Number(iroot(BigInt(p) << BigInt(96), 3) & MASK32) >>> 0; });
  var H256 = P80.slice(0, 8).map(function (p) { return Number(iroot(BigInt(p) << BigInt(64), 2) & MASK32) >>> 0; });

  /* big-endian padding for SHA-1 and SHA-256 (64-byte blocks, 64-bit length) */
  function padBE(msg, block) {
    var len = msg.length, total = Math.ceil((len + 1 + (block === 128 ? 16 : 8)) / block) * block;
    var out = new Uint8Array(total);
    out.set(msg); out[len] = 0x80;
    var bits = len * 8, lo = bits >>> 0, hi = Math.floor(bits / 4294967296);
    out[total - 1] = lo & 255; out[total - 2] = (lo >>> 8) & 255; out[total - 3] = (lo >>> 16) & 255; out[total - 4] = lo >>> 24;
    out[total - 5] = hi & 255; out[total - 6] = (hi >>> 8) & 255; out[total - 7] = (hi >>> 16) & 255; out[total - 8] = hi >>> 24;
    return out;
  }
  function be32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
  function putBE(out, o, w) { out[o] = w >>> 24; out[o + 1] = (w >>> 16) & 255; out[o + 2] = (w >>> 8) & 255; out[o + 3] = w & 255; }
  function rotl(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }
  function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

  function sha1(msg) {
    var m = padBE(msg, 64), h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0, w = new Array(80);
    for (var off = 0; off < m.length; off += 64) {
      var i;
      for (i = 0; i < 16; i++) w[i] = be32(m, off + i * 4);
      for (i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      var a = h0, b = h1, c = h2, d = h3, e = h4, f, k;
      for (i = 0; i < 80; i++) {
        if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
        else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
        else { f = b ^ c ^ d; k = 0xCA62C1D6; }
        var t = (rotl(a, 5) + (f >>> 0) + e + k + w[i]) >>> 0;
        e = d; d = c; c = rotl(b, 30); b = a; a = t;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    var out = new Uint8Array(20);
    putBE(out, 0, h0); putBE(out, 4, h1); putBE(out, 8, h2); putBE(out, 12, h3); putBE(out, 16, h4);
    return out;
  }
  function sha256(msg) {
    var m = padBE(msg, 64), H = H256.slice(), w = new Array(64);
    for (var off = 0; off < m.length; off += 64) {
      var i;
      for (i = 0; i < 16; i++) w[i] = be32(m, off + i * 4);
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + (ch >>> 0) + K256[i] + w[i]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + (maj >>> 0)) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var out = new Uint8Array(32);
    for (var k = 0; k < 8; k++) putBE(out, k * 4, H[k]);
    return out;
  }
  /* SHA-512 and SHA-384 on pairs of 32-bit halves [hi, lo] */
  function sha512core(msg, init, outBytes) {
    var m = padBE(msg, 128), H = init.map(function (p) { return p.slice(); }), w = new Array(80);
    var i, o;
    function rot(hi, lo, n, dst) {   /* right rotate by n (0 < n < 64) into dst */
      if (n >= 32) { var t = hi; hi = lo; lo = t; n -= 32; }
      if (n === 0) { dst[0] = hi; dst[1] = lo; return; }
      dst[0] = ((hi >>> n) | (lo << (32 - n))) >>> 0; dst[1] = ((lo >>> n) | (hi << (32 - n))) >>> 0;
    }
    var r1 = [0, 0], r2 = [0, 0], r3 = [0, 0];
    for (var off = 0; off < m.length; off += 128) {
      for (i = 0; i < 16; i++) w[i] = [be32(m, off + i * 8), be32(m, off + i * 8 + 4)];
      for (i = 16; i < 80; i++) {
        var x = w[i - 15], y = w[i - 2];
        rot(x[0], x[1], 1, r1); rot(x[0], x[1], 8, r2);
        var s0h = r1[0] ^ r2[0] ^ (x[0] >>> 7), s0l = r1[1] ^ r2[1] ^ (((x[1] >>> 7) | (x[0] << 25)) >>> 0);
        rot(y[0], y[1], 19, r1); rot(y[0], y[1], 61, r2);
        var s1h = r1[0] ^ r2[0] ^ (y[0] >>> 6), s1l = r1[1] ^ r2[1] ^ (((y[1] >>> 6) | (y[0] << 26)) >>> 0);
        var lo = (w[i - 16][1] >>> 0) + (s0l >>> 0) + (w[i - 7][1] >>> 0) + (s1l >>> 0);
        var hi = (w[i - 16][0] >>> 0) + (s0h >>> 0) + (w[i - 7][0] >>> 0) + (s1h >>> 0) + Math.floor(lo / 4294967296);
        w[i] = [hi >>> 0, lo >>> 0];
      }
      var a = H[0].slice(), b = H[1].slice(), c = H[2].slice(), d = H[3].slice(), e = H[4].slice(), f = H[5].slice(), g = H[6].slice(), h = H[7].slice();
      for (i = 0; i < 80; i++) {
        rot(e[0], e[1], 14, r1); rot(e[0], e[1], 18, r2); rot(e[0], e[1], 41, r3);
        var S1h = r1[0] ^ r2[0] ^ r3[0], S1l = r1[1] ^ r2[1] ^ r3[1];
        var chh = (e[0] & f[0]) ^ (~e[0] & g[0]), chl = (e[1] & f[1]) ^ (~e[1] & g[1]);
        var t1l = (h[1] >>> 0) + (S1l >>> 0) + (chl >>> 0) + (K512[i][1] >>> 0) + (w[i][1] >>> 0);
        var t1h = (h[0] >>> 0) + (S1h >>> 0) + (chh >>> 0) + (K512[i][0] >>> 0) + (w[i][0] >>> 0) + Math.floor(t1l / 4294967296);
        t1l = t1l >>> 0; t1h = t1h >>> 0;
        rot(a[0], a[1], 28, r1); rot(a[0], a[1], 34, r2); rot(a[0], a[1], 39, r3);
        var S0h = r1[0] ^ r2[0] ^ r3[0], S0l = r1[1] ^ r2[1] ^ r3[1];
        var mjh = (a[0] & b[0]) ^ (a[0] & c[0]) ^ (b[0] & c[0]), mjl = (a[1] & b[1]) ^ (a[1] & c[1]) ^ (b[1] & c[1]);
        var t2l = (S0l >>> 0) + (mjl >>> 0), t2h = (S0h >>> 0) + (mjh >>> 0) + Math.floor(t2l / 4294967296);
        t2l = t2l >>> 0; t2h = t2h >>> 0;
        h = g; g = f; f = e;
        var el = (d[1] >>> 0) + t1l, eh = (d[0] >>> 0) + t1h + Math.floor(el / 4294967296);
        e = [eh >>> 0, el >>> 0];
        d = c; c = b; b = a;
        var al = t1l + t2l, ah = t1h + t2h + Math.floor(al / 4294967296);
        a = [ah >>> 0, al >>> 0];
      }
      var regs = [a, b, c, d, e, f, g, h];
      for (i = 0; i < 8; i++) {
        var sl = (H[i][1] >>> 0) + (regs[i][1] >>> 0), sh = (H[i][0] >>> 0) + (regs[i][0] >>> 0) + Math.floor(sl / 4294967296);
        H[i] = [sh >>> 0, sl >>> 0];
      }
    }
    var out = new Uint8Array(64);
    for (o = 0; o < 8; o++) { putBE(out, o * 8, H[o][0]); putBE(out, o * 8 + 4, H[o][1]); }
    return out.subarray(0, outBytes);
  }
  function sha512(msg) { return sha512core(msg, H512, 64); }
  function sha384(msg) { return sha512core(msg, H384, 48); }

  var MD5_T = [], MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (var mi = 0; mi < 64; mi++) MD5_T[mi] = Math.floor(Math.abs(Math.sin(mi + 1)) * 4294967296) >>> 0;
  function md5(msg) {
    var len = msg.length, total = Math.ceil((len + 9) / 64) * 64, m = new Uint8Array(total);
    m.set(msg); m[len] = 0x80;
    var bits = len * 8, lo = bits >>> 0, hi = Math.floor(bits / 4294967296);
    m[total - 8] = lo & 255; m[total - 7] = (lo >>> 8) & 255; m[total - 6] = (lo >>> 16) & 255; m[total - 5] = (lo >>> 24) & 255;
    m[total - 4] = hi & 255; m[total - 3] = (hi >>> 8) & 255; m[total - 2] = (hi >>> 16) & 255; m[total - 1] = (hi >>> 24) & 255;
    var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476, w = new Array(16);
    for (var off = 0; off < total; off += 64) {
      var i;
      for (i = 0; i < 16; i++) w[i] = rd32(m, off + i * 4);
      var a = a0, b = b0, c = c0, d = d0;
      for (i = 0; i < 64; i++) {
        var f, g;
        if (i < 16) { f = (b & c) | (~b & d); g = i; }
        else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
        else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
        else { f = c ^ (b | ~d); g = (7 * i) % 16; }
        var t = d; d = c; c = b;
        b = (b + rotl(((a >>> 0) + (f >>> 0) + MD5_T[i] + w[g]) >>> 0, MD5_S[(i >> 4) * 4 + (i % 4)])) >>> 0;
        a = t;
      }
      a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
    }
    return concat([le32(a0), le32(b0), le32(c0), le32(d0)]);
  }
  var HASH = { sha1: { fn: sha1, block: 64 }, sha256: { fn: sha256, block: 64 }, sha384: { fn: sha384, block: 128 }, sha512: { fn: sha512, block: 128 }, md5: { fn: md5, block: 64 } };
  function hashNamed(name) {
    var key = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (key === 'sha1') return HASH.sha1;
    if (key === 'sha256') return HASH.sha256;
    if (key === 'sha384') return HASH.sha384;
    if (key === 'sha512') return HASH.sha512;
    if (key === 'md5') return HASH.md5;
    return null;
  }
  function hmac(h, key, msg) {
    if (key.length > h.block) key = h.fn(key);
    var ik = new Uint8Array(h.block), ok = new Uint8Array(h.block);
    for (var i = 0; i < h.block; i++) { var k = i < key.length ? key[i] : 0; ik[i] = k ^ 0x36; ok[i] = k ^ 0x5c; }
    return h.fn(concat([ok, h.fn(concat([ik, msg]))]));
  }
  function pbkdf2(h, password, salt, iterations, length) {
    var out = [], block = 1, have = 0;
    while (have < length) {
      var u = hmac(h, password, concat([salt, new Uint8Array([block >>> 24, (block >>> 16) & 255, (block >>> 8) & 255, block & 255])]));
      var t = u.slice();
      for (var i = 1; i < iterations; i++) { u = hmac(h, password, u); for (var j = 0; j < t.length; j++) t[j] ^= u[j]; }
      out.push(t); have += t.length; block++;
    }
    return concat(out).subarray(0, length);
  }

  /* ------------------------------------------------------------- AES */
  var SBOX = new Uint8Array(256), INV = new Uint8Array(256);
  (function () {
    var p = 1, q = 1;
    do {
      p = p ^ (p << 1) ^ (p & 0x80 ? 0x1B : 0); p &= 255;
      q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 255; if (q & 0x80) q ^= 0x09;
      var x = q ^ ((q << 1) | (q >>> 7)) ^ ((q << 2) | (q >>> 6)) ^ ((q << 3) | (q >>> 5)) ^ ((q << 4) | (q >>> 4));
      SBOX[p] = (x ^ 0x63) & 255;
    } while (p !== 1);
    SBOX[0] = 0x63;
    for (var i = 0; i < 256; i++) INV[SBOX[i]] = i;
  })();
  function xt(a) { return ((a << 1) ^ (a & 0x80 ? 0x1B : 0)) & 255; }
  function gmul(a, b) { var r = 0; while (b) { if (b & 1) r ^= a; a = xt(a); b >>>= 1; } return r; }
  var M2 = new Uint8Array(256), M3 = new Uint8Array(256), M9 = new Uint8Array(256), M11 = new Uint8Array(256), M13 = new Uint8Array(256), M14 = new Uint8Array(256);
  for (var gi = 0; gi < 256; gi++) { M2[gi] = gmul(gi, 2); M3[gi] = gmul(gi, 3); M9[gi] = gmul(gi, 9); M11[gi] = gmul(gi, 11); M13[gi] = gmul(gi, 13); M14[gi] = gmul(gi, 14); }
  function expandKey(key) {
    var nk = key.length / 4, rounds = nk + 6, total = 4 * (rounds + 1), w = new Uint8Array(total * 4);
    w.set(key);
    var rcon = 1;
    for (var i = nk; i < total; i++) {
      var t = w.subarray((i - 1) * 4, i * 4), tmp = [t[0], t[1], t[2], t[3]];
      if (i % nk === 0) { tmp = [SBOX[tmp[1]] ^ rcon, SBOX[tmp[2]], SBOX[tmp[3]], SBOX[tmp[0]]]; rcon = xt(rcon); }
      else if (nk > 6 && i % nk === 4) tmp = [SBOX[tmp[0]], SBOX[tmp[1]], SBOX[tmp[2]], SBOX[tmp[3]]];
      for (var j = 0; j < 4; j++) w[i * 4 + j] = w[(i - nk) * 4 + j] ^ tmp[j];
    }
    return { w: w, rounds: rounds };
  }
  function addRound(s, w, r) { for (var i = 0; i < 16; i++) s[i] ^= w[r * 16 + i]; }
  function encryptBlock(ks, inp, out) {
    var s = new Uint8Array(inp), t = new Uint8Array(16), r, i;
    addRound(s, ks.w, 0);
    for (r = 1; r <= ks.rounds; r++) {
      for (i = 0; i < 16; i++) t[i] = SBOX[s[i]];
      /* shift rows: byte at row i, column c moves to column (c - i) */
      for (i = 0; i < 16; i++) s[i] = t[(i + 4 * (i % 4)) % 16];
      if (r !== ks.rounds) {
        for (i = 0; i < 16; i += 4) {
          var a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
          s[i] = M2[a0] ^ M3[a1] ^ a2 ^ a3; s[i + 1] = a0 ^ M2[a1] ^ M3[a2] ^ a3;
          s[i + 2] = a0 ^ a1 ^ M2[a2] ^ M3[a3]; s[i + 3] = M3[a0] ^ a1 ^ a2 ^ M2[a3];
        }
      }
      addRound(s, ks.w, r);
    }
    out.set(s);
  }
  function decryptBlock(ks, inp, out) {
    var s = new Uint8Array(inp), t = new Uint8Array(16), r, i;
    addRound(s, ks.w, ks.rounds);
    for (r = ks.rounds - 1; r >= 0; r--) {
      /* inverse shift rows, then inverse sub bytes */
      for (i = 0; i < 16; i++) t[(i + 4 * (i % 4)) % 16] = s[i];
      for (i = 0; i < 16; i++) s[i] = INV[t[i]];
      addRound(s, ks.w, r);
      if (r !== 0) {
        for (i = 0; i < 16; i += 4) {
          var a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
          s[i] = M14[a0] ^ M11[a1] ^ M13[a2] ^ M9[a3]; s[i + 1] = M9[a0] ^ M14[a1] ^ M11[a2] ^ M13[a3];
          s[i + 2] = M13[a0] ^ M9[a1] ^ M14[a2] ^ M11[a3]; s[i + 3] = M11[a0] ^ M13[a1] ^ M9[a2] ^ M14[a3];
        }
      }
    }
    out.set(s);
  }
  function aesEcbDecrypt(key, data) {
    var ks = expandKey(key), n = data.length - (data.length % 16), out = new Uint8Array(n), blk = new Uint8Array(16);
    for (var o = 0; o < n; o += 16) { decryptBlock(ks, data.subarray(o, o + 16), blk); out.set(blk, o); }
    return out;
  }
  function aesCbcDecrypt(key, iv, data) {
    var ks = expandKey(key), n = data.length - (data.length % 16), out = new Uint8Array(n), blk = new Uint8Array(16), prev = iv.subarray(0, 16);
    for (var o = 0; o < n; o += 16) {
      var c = data.subarray(o, o + 16);
      decryptBlock(ks, c, blk);
      for (var i = 0; i < 16; i++) out[o + i] = blk[i] ^ prev[i];
      prev = c;
    }
    return out;
  }
  /* WinZip's counter mode: a 16-byte little-endian counter starting at 1 */
  function aesCtrLE(key, data) {
    var ks = expandKey(key), out = new Uint8Array(data.length), ctr = new Uint8Array(16), ks16 = new Uint8Array(16);
    for (var o = 0; o < data.length; o += 16) {
      for (var k = 0; k < 16; k++) { ctr[k] = (ctr[k] + 1) & 255; if (ctr[k]) break; }
      encryptBlock(ks, ctr, ks16);
      var n = Math.min(16, data.length - o);
      for (var i = 0; i < n; i++) out[o + i] = data[o + i] ^ ks16[i];
    }
    return out;
  }

  /* ------------------------------------------------------------- RC4 */
  function rc4(key) {
    var S = new Uint8Array(256), i, j = 0, t;
    for (i = 0; i < 256; i++) S[i] = i;
    for (i = 0; i < 256; i++) { j = (j + S[i] + key[i % key.length]) & 255; t = S[i]; S[i] = S[j]; S[j] = t; }
    var x = 0, y = 0;
    return { next: function () { x = (x + 1) & 255; y = (y + S[x]) & 255; t = S[x]; S[x] = S[y]; S[y] = t; return S[(S[x] + S[y]) & 255]; } };
  }
  function rc4Apply(key, data) { var g = rc4(key), out = new Uint8Array(data.length); for (var i = 0; i < data.length; i++) out[i] = data[i] ^ g.next(); return out; }

  /* ================================================ an Excel workbook (.xlsx)
     Office's two forms of the same idea: a password becomes a key through
     many rounds of a hash; a verifier proves the password before anything
     else is touched; the package is AES-decrypted and cut to its length. */
  function ooxml(info, pkg, password) {
    var major = rd16(info, 0), minor = rd16(info, 2);
    if (major === 4 && minor === 4) return agile(info, pkg, password);
    if (minor === 2 && (major === 2 || major === 3 || major === 4)) return standard(info, pkg, password);
    if (minor === 3) throw unsupported('extensible encryption');
    throw unsupported('EncryptionInfo ' + major + '.' + minor);
  }
  function standard(info, pkg, password) {
    var flags = rd32(info, 4), headerSize = rd32(info, 8), h = 12;
    var algId = rd32(info, h + 8), algHash = rd32(info, h + 12), keyBits = rd32(info, h + 16);
    if (!(flags & 0x20) || (algId !== 0x660E && algId !== 0x660F && algId !== 0x6610)) throw unsupported('not AES');
    if (algHash !== 0x8004) throw unsupported('hash');
    var v = h + headerSize;
    var saltSize = rd32(info, v), salt = info.subarray(v + 4, v + 4 + saltSize);
    var encVerifier = info.subarray(v + 4 + saltSize, v + 20 + saltSize);
    var hashSize = rd32(info, v + 20 + saltSize), encHash = info.subarray(v + 24 + saltSize, v + 24 + saltSize + 32);
    var keyLen = keyBits / 8 || 16;
    var hh = sha1(concat([salt, utf16le(password)]));
    for (var i = 0; i < 50000; i++) hh = sha1(concat([le32(i), hh]));
    hh = sha1(concat([hh, le32(0)]));
    function derive(fill) { var buf = new Uint8Array(64); for (var k = 0; k < 64; k++) buf[k] = (k < hh.length ? hh[k] : 0) ^ fill; return sha1(buf); }
    var key = concat([derive(0x36), derive(0x5C)]).subarray(0, keyLen);
    var verifier = aesEcbDecrypt(key, encVerifier), vhash = aesEcbDecrypt(key, encHash);
    if (!same(sha1(verifier), vhash, hashSize)) throw wrong();
    var size = rd32(pkg, 0) + rd32(pkg, 4) * 4294967296;
    var plain = aesEcbDecrypt(key, pkg.subarray(8));
    return plain.subarray(0, Math.min(size, plain.length));
  }
  function attrs(xml, tag) {
    var m = new RegExp('<(?:\\w+:)?' + tag + '\\b([^>]*)>').exec(xml);
    if (!m) return null;
    var out = {}, re = /([\w:]+)="([^"]*)"/g, a;
    while ((a = re.exec(m[1]))) out[a[1].replace(/^\w+:/, '')] = a[2];
    return out;
  }
  function agile(info, pkg, password) {
    var xml = new TextDecoder('utf-8').decode(info.subarray(8));
    var keyData = attrs(xml, 'keyData'), enc = attrs(xml, 'encryptedKey');
    if (!keyData || !enc) throw unsupported('agile header');
    if (!/^AES$/i.test(enc.cipherAlgorithm || 'AES') || !/CBC/i.test(enc.cipherChaining || 'ChainingModeCBC')) throw unsupported('cipher');
    var h = hashNamed(enc.hashAlgorithm || 'SHA1'), hk = hashNamed(keyData.hashAlgorithm || 'SHA1');
    if (!h || !hk) throw unsupported('hash ' + enc.hashAlgorithm);
    var spin = +enc.spinCount || 100000, keyBytes = (+enc.keyBits || 256) / 8, blockSize = +enc.blockSize || 16, hashSize = +enc.hashSize || h.fn(new Uint8Array(0)).length;
    var salt = fromBase64(enc.saltValue), pw = utf16le(password);
    var hh = h.fn(concat([salt, pw]));
    for (var i = 0; i < spin; i++) hh = h.fn(concat([le32(i), hh]));
    function blockKey(block) {
      var k = h.fn(concat([hh, block]));
      if (k.length >= keyBytes) return k.subarray(0, keyBytes);
      var out = new Uint8Array(keyBytes); out.fill(0x36); out.set(k); return out;
    }
    function iv(saltBytes) {
      if (saltBytes.length >= blockSize) return saltBytes.subarray(0, blockSize);
      var out = new Uint8Array(blockSize); out.fill(0x36); out.set(saltBytes); return out;
    }
    var K_INPUT = new Uint8Array([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]);
    var K_VALUE = new Uint8Array([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]);
    var K_KEY = new Uint8Array([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]);
    var vin = aesCbcDecrypt(blockKey(K_INPUT), iv(salt), fromBase64(enc.encryptedVerifierHashInput)).subarray(0, salt.length);
    var vhash = aesCbcDecrypt(blockKey(K_VALUE), iv(salt), fromBase64(enc.encryptedVerifierHashValue));
    if (!same(h.fn(vin), vhash, hashSize)) throw wrong();
    var secret = aesCbcDecrypt(blockKey(K_KEY), iv(salt), fromBase64(enc.encryptedKeyValue)).subarray(0, keyBytes);
    var kdSalt = fromBase64(keyData.saltValue), kdBlock = +keyData.blockSize || 16;
    var size = rd32(pkg, 0) + rd32(pkg, 4) * 4294967296, body = pkg.subarray(8), out = new Uint8Array(body.length), SEG = 4096;
    for (var seg = 0, o = 0; o < body.length; seg++, o += SEG) {
      var ivSeg = hk.fn(concat([kdSalt, le32(seg)]));
      var ivUse = ivSeg.length >= kdBlock ? ivSeg.subarray(0, kdBlock) : iv(ivSeg);
      var chunk = body.subarray(o, Math.min(o + SEG, body.length));
      out.set(aesCbcDecrypt(secret, ivUse, chunk), o);
    }
    return out.subarray(0, Math.min(size, out.length));
  }

  /* ============================================ an old workbook (.xls): FILEPASS
     The stream is RC4-encrypted in place, by position: a new key every 1,024
     bytes, record headers in the clear, and these records' bodies in the clear
     too: BOF, FILEPASS, UsrExcl, FileLock, InterfaceHdr, RRDInfo, RRDHead, and
     the first four bytes of each BoundSheet8 (where the sheet starts). */
  var CLEAR_RECORDS = { 0x0809: 1, 0x002F: 1, 0x0194: 1, 0x0195: 1, 0x00E1: 1, 0x0196: 1, 0x0138: 1 };
  function biff(stream, password) {
    var pos = 0, fp = null;
    while (pos + 4 <= stream.length) {
      var type = rd16(stream, pos), len = rd16(stream, pos + 2);
      if (type === 0x002F) { fp = { at: pos + 4, len: len }; break; }
      if (type === 0x000A) break;
      pos += 4 + len;
    }
    if (!fp) throw new Error('no FILEPASS record');
    var body = stream.subarray(fp.at, fp.at + fp.len);
    var wType = rd16(body, 0);
    if (wType === 0) throw unsupported('XOR obfuscation');
    var vMajor = rd16(body, 2), vMinor = rd16(body, 4), blockKey;
    if (vMajor === 1 && vMinor === 1) {
      /* RC4 keyed by MD5, the Excel 97 way */
      var salt = body.subarray(6, 22), encV = body.subarray(22, 38), encH = body.subarray(38, 54);
      var h0 = md5(utf16le(password)).subarray(0, 5), inter = [];
      for (var r = 0; r < 16; r++) { inter.push(h0); inter.push(salt); }
      var base = md5(concat(inter)).subarray(0, 5);
      blockKey = function (n) { return md5(concat([base, le32(n)])); };
      var g0 = rc4(blockKey(0)), v = new Uint8Array(16), vh = new Uint8Array(16), i;
      for (i = 0; i < 16; i++) v[i] = encV[i] ^ g0.next();
      for (i = 0; i < 16; i++) vh[i] = encH[i] ^ g0.next();
      if (!same(md5(v), vh, 16)) throw wrong();
    } else if (vMinor === 2 && (vMajor === 2 || vMajor === 3 || vMajor === 4)) {
      /* RC4 through CryptoAPI, keyed by SHA-1 */
      var flags = rd32(body, 6), headerSize = rd32(body, 10), hs = 14;
      var algId = rd32(body, hs + 8), algHash = rd32(body, hs + 12), keyBits = rd32(body, hs + 16) || 40;
      if (algId !== 0x6801 || algHash !== 0x8004) throw unsupported('CryptoAPI ' + algId.toString(16));
      var vo = hs + headerSize, saltSize = rd32(body, vo), salt2 = body.subarray(vo + 4, vo + 4 + saltSize);
      var encV2 = body.subarray(vo + 4 + saltSize, vo + 20 + saltSize), hashSize = rd32(body, vo + 20 + saltSize);
      var encH2 = body.subarray(vo + 24 + saltSize, vo + 24 + saltSize + hashSize);
      var hp = sha1(concat([salt2, utf16le(password)])), keyLen = keyBits / 8;
      blockKey = function (n) {
        var k = sha1(concat([hp, le32(n)])).subarray(0, keyLen);
        if (keyBits === 40) { var p = new Uint8Array(16); p.set(k); return p; }
        return k;
      };
      var g1 = rc4(blockKey(0)), v2 = new Uint8Array(16), vh2 = new Uint8Array(hashSize), j;
      for (j = 0; j < 16; j++) v2[j] = encV2[j] ^ g1.next();
      for (j = 0; j < hashSize; j++) vh2[j] = encH2[j] ^ g1.next();
      if (!same(sha1(v2), vh2, hashSize)) throw wrong();
      void flags;
    } else throw unsupported('FILEPASS ' + vMajor + '.' + vMinor);

    /* the keystream by stream position, a fresh RC4 for each 1,024-byte block */
    var BLOCK = 1024, cache = {};
    function keyByte(p) {
      var b = Math.floor(p / BLOCK), ks = cache[b];
      if (!ks) { var g = rc4(blockKey(b)); ks = new Uint8Array(BLOCK); for (var q = 0; q < BLOCK; q++) ks[q] = g.next(); cache = {}; cache[b] = ks; }
      return ks[p % BLOCK];
    }
    var out = new Uint8Array(stream.length), p = 0;
    out.set(stream);
    while (p + 4 <= stream.length) {
      var t = rd16(stream, p), n = rd16(stream, p + 2), bodyAt = p + 4, clear = 4;
      if (CLEAR_RECORDS[t]) clear += n;
      else if (t === 0x0085) clear += Math.min(4, n);
      /* the header (and any clear part) keeps its bytes; the keystream still runs over them */
      for (var k = bodyAt + (clear - 4); k < bodyAt + n && k < stream.length; k++) out[k] = stream[k] ^ keyByte(k);
      p = bodyAt + n;
    }
    return out;
  }

  /* ================================================================ zip
     The entries of an archive, and each one opened: decrypted when the entry
     says it is encrypted, then inflated. */
  function zipEntries(bytes) {
    var end = -1, k;
    for (k = bytes.length - 22; k >= Math.max(0, bytes.length - 65557); k--) if (rd32(bytes, k) === 0x06054b50) { end = k; break; }
    if (end < 0) throw new Error('not a zip archive');
    var count = rd16(bytes, end + 10), at = rd32(bytes, end + 16), out = [];
    for (var n = 0; n < count && at + 46 <= bytes.length; n++) {
      if (rd32(bytes, at) !== 0x02014b50) break;
      var flags = rd16(bytes, at + 8), method = rd16(bytes, at + 10), time = rd16(bytes, at + 12), crc = rd32(bytes, at + 16);
      var compSize = rd32(bytes, at + 20), size = rd32(bytes, at + 24), nameLen = rd16(bytes, at + 28), extraLen = rd16(bytes, at + 30), commentLen = rd16(bytes, at + 32);
      var local = rd32(bytes, at + 42), name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
      var cExtra = bytes.subarray(at + 46 + nameLen, at + 46 + nameLen + extraLen);
      if (rd32(bytes, local) === 0x04034b50) {
        var lName = rd16(bytes, local + 26), lExtra = rd16(bytes, local + 28);
        var dataStart = local + 30 + lName + lExtra;
        var aes = aesExtra(bytes.subarray(local + 30 + lName, dataStart)) || aesExtra(cExtra);
        out.push({ name: name, method: method, flags: flags, time: time, crc: crc, size: size, compSize: compSize,
                   encrypted: !!(flags & 1), aes: method === 99 ? aes : null, dir: /\/$/.test(name), raw: bytes.subarray(dataStart, dataStart + compSize) });
      }
      at += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }
  function aesExtra(extra) {
    var p = 0;
    while (p + 4 <= extra.length) {
      var id = rd16(extra, p), len = rd16(extra, p + 2);
      if (id === 0x9901 && len >= 7) return { version: rd16(extra, p + 4), strength: extra[p + 8], method: rd16(extra, p + 9) };
      p += 4 + len;
    }
    return null;
  }
  function inflateRaw(data, method) {
    if (method === 0) return Promise.resolve(data);
    if (method !== 8) return Promise.reject(new Error('compression method ' + method + ' is not deflate'));
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('this browser cannot unzip it'));
    var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }
  var CRC_TABLE = (function () { var t = new Uint32Array(256); for (var i = 0; i < 256; i++) { var c = i; for (var k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; t[i] = c >>> 0; } return t; })();
  function zipCryptoDecrypt(password, entry) {
    var k0 = 305419896, k1 = 591751049, k2 = 878082192;
    function update(c) {
      k0 = (CRC_TABLE[(k0 ^ c) & 255] ^ (k0 >>> 8)) >>> 0;
      k1 = (k1 + (k0 & 255)) >>> 0; k1 = (Math.imul(k1, 134775813) + 1) >>> 0;
      k2 = (CRC_TABLE[(k2 ^ (k1 >>> 24)) & 255] ^ (k2 >>> 8)) >>> 0;
    }
    function stream() { var t = (k2 | 2) >>> 0; return (Math.imul(t, t ^ 1) >>> 8) & 255; }
    var pw = utf8(password), i;
    for (i = 0; i < pw.length; i++) update(pw[i]);
    var raw = entry.raw, head = new Uint8Array(12);
    for (i = 0; i < 12; i++) { var c = raw[i] ^ stream(); update(c); head[i] = c; }
    var check = entry.flags & 8 ? (entry.time >>> 8) & 255 : (entry.crc >>> 24) & 255;
    if (head[11] !== check) throw wrong();
    var out = new Uint8Array(raw.length - 12);
    for (i = 12; i < raw.length; i++) { var d = raw[i] ^ stream(); update(d); out[i - 12] = d; }
    return out;
  }
  function openEntry(entry, password) {
    if (!entry.encrypted) return inflateRaw(entry.raw, entry.method);
    if (password == null) { var e = new Error('locked'); e.locked = true; return Promise.reject(e); }
    try {
      if (entry.aes) {
        var strength = entry.aes.strength, saltLen = 4 + 4 * strength, keyLen = 8 + 8 * strength, raw = entry.raw;
        var salt = raw.subarray(0, saltLen), pv = raw.subarray(saltLen, saltLen + 2);
        var derived = pbkdf2(HASH.sha1, utf8(password), salt, 1000, 2 * keyLen + 2);
        if (!same(derived.subarray(2 * keyLen), pv, 2)) throw wrong();
        var cipher = raw.subarray(saltLen + 2, raw.length - 10), auth = raw.subarray(raw.length - 10);
        var mac = hmac(HASH.sha1, derived.subarray(keyLen, 2 * keyLen), cipher);
        if (!same(mac, auth, 10)) throw wrong();
        return inflateRaw(aesCtrLE(derived.subarray(0, keyLen), cipher), entry.aes.method);
      }
      return inflateRaw(zipCryptoDecrypt(password, entry), entry.method);
    } catch (err) { return Promise.reject(err); }
  }

  /* ---------------------------------------------------------- what is this?
     The first bytes of a file say what it is, before any slot decides what to do. */
  function magic(bytes) {
    if (!bytes || bytes.length < 4) return null;
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
    if (bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 3 && bytes[3] === 4) return 'zip';
    if (bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) return 'cfb';
    if (bytes[0] === 0x4D && bytes[1] === 0x5A) return 'exe';
    return null;
  }
  /* a PDF whose trailer names an /Encrypt dictionary is locked (pdf.js decides for certain) */
  function pdfLooksLocked(bytes) {
    var tail = bytes.subarray(Math.max(0, bytes.length - 65536));
    var text = '';
    for (var i = 0; i < tail.length; i++) text += String.fromCharCode(tail[i]);
    return /\/Encrypt\b/.test(text);
  }
  function zipLooksLocked(bytes) {
    try { return zipEntries(bytes).some(function (e) { return e.encrypted && !e.dir; }); } catch (e) { return false; }
  }

  var api = {
    md5: md5, sha1: sha1, sha256: sha256, sha384: sha384, sha512: sha512, hmac: hmac, pbkdf2: pbkdf2, HASH: HASH,
    aesEcbDecrypt: aesEcbDecrypt, aesCbcDecrypt: aesCbcDecrypt, aesCtrLE: aesCtrLE, encryptBlock: encryptBlock, expandKey: expandKey, rc4Apply: rc4Apply,
    ooxml: ooxml, biff: biff, zipEntries: zipEntries, openEntry: openEntry, inflateRaw: inflateRaw,
    magic: magic, pdfLooksLocked: pdfLooksLocked, zipLooksLocked: zipLooksLocked, utf16le: utf16le, concat: concat
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PRCLocked = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
