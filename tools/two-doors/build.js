#!/usr/bin/env node
/* "Two Doors, One Storm" — rebuild the published, encrypted index.html from the
 * readable master.
 *
 *   TDOS_CODE=<a reader access code> node tools/two-doors/build.js <master.html> [index.html]
 *
 * How the published page works: index.html is the gate. It carries a payload P
 * = { it, i, c, w } — the simulator's HTML encrypted with a random MASTER KEY
 * (AES-GCM, iv `i`, ciphertext `c`), and that master key wrapped once per
 * access code (`w`: PBKDF2-SHA256 of the code, `it` iterations, salt `s`, then
 * AES-GCM). The gate unwraps the key with whatever code the reader types and
 * opens the bundle; a wrong code simply fails to decrypt.
 *
 * This script needs ONE valid code: it unwraps the existing master key from the
 * current index.html, encrypts the new master with that same key and a fresh
 * IV, and writes the payload back — so every other code keeps working without
 * being known here. The gate markup around the payload is left untouched. It
 * verifies its own output by opening it again before writing.
 *
 * To ADD a code (T3), pass TDOS_ADD_CODE=<new code>: a new wrapped entry is
 * appended to `w`. Nothing else changes.
 *
 * Uses only Node's built-in WebCrypto (Node 16+). Nothing is uploaded. */
'use strict';
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');
const subtle = webcrypto.subtle;

const [,, masterPath, indexArg] = process.argv;
const INDEX = indexArg || path.join(__dirname, '..', '..', 'index.html');
const CODE = process.env.TDOS_CODE;
const ADD = process.env.TDOS_ADD_CODE;
if (!masterPath || !CODE) {
  console.error('usage: TDOS_CODE=<reader code> node tools/two-doors/build.js <master.html> [index.html]');
  process.exit(2);
}

const b64 = (s) => Buffer.from(s, 'base64');
const toB64 = (buf) => Buffer.from(buf).toString('base64');

async function deriveKey(pw, salt, it, usage) {
  const base = await subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', salt, iterations: it, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, [usage]);
}
async function unwrap(P, pw) {
  for (let i = 0; i < P.w.length; i++) {
    const w = P.w[i];
    try {
      const k = await deriveKey(pw, b64(w.s), P.it, 'decrypt');
      return { raw: await subtle.decrypt({ name: 'AES-GCM', iv: b64(w.i) }, k, b64(w.c)), slot: i };
    } catch (e) { /* next slot */ }
  }
  return null;
}
async function wrap(rawMaster, pw, it) {
  const s = webcrypto.getRandomValues(new Uint8Array(16)), i = webcrypto.getRandomValues(new Uint8Array(12));
  const k = await deriveKey(pw, s, it, 'encrypt');
  const c = await subtle.encrypt({ name: 'AES-GCM', iv: i }, k, rawMaster);
  return { s: toB64(s), i: toB64(i), c: toB64(c) };
}
async function seal(rawMaster, html) {
  const k = await subtle.importKey('raw', rawMaster, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const c = await subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(html));
  const back = new TextDecoder().decode(await subtle.decrypt({ name: 'AES-GCM', iv }, k, c));
  if (back !== html) throw new Error('round-trip failed');
  return { i: toB64(iv), c: toB64(c) };
}

(async () => {
  const gate = fs.readFileSync(INDEX, 'utf8');
  const m = gate.match(/(\n\s*var P = )(\{[\s\S]*?\});\n/);
  if (!m) throw new Error('payload `var P = {...};` not found in ' + INDEX);
  const P = JSON.parse(m[2]);
  let master = fs.readFileSync(masterPath, 'utf8');
  // area 25 — the as-built line, and the build refuses emoji (area 22: inline SVG only).
  let commit = 'unknown';
  try { commit = require('child_process').execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..', '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) {}
  const built = 'as built: ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + ' · source ' + commit;
  master = master.split('__AS_BUILT__').join(built);
  const emoji = master.match(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu) || [];
  if (emoji.length) throw new Error('the master contains emoji (' + emoji.join(' ') + '); the UI uses inline SVG only');
  if (!/Two Doors, One Storm/.test(master) || /var P = \{/.test(master)) throw new Error(masterPath + ' does not look like the readable master');

  const got = await unwrap(P, CODE);
  if (!got) { console.error('that code does not open the current build; nothing written'); process.exit(1); }
  const sealed = await seal(got.raw, master);
  const next = { it: P.it, i: sealed.i, c: sealed.c, w: P.w.slice() };
  if (ADD) { next.w.push(await wrap(got.raw, ADD, P.it)); console.log('added a code (slot ' + (next.w.length - 1) + ')'); }

  const out = gate.replace(m[0], m[1] + JSON.stringify(next) + ';\n');
  // Verify the written gate opens with the code before touching the file.
  const P2 = JSON.parse(out.match(/\n\s*var P = (\{[\s\S]*?\});\n/)[1]);
  const again = await unwrap(P2, CODE);
  if (!again) throw new Error('verification failed: the rebuilt gate does not open');
  const k = await subtle.importKey('raw', again.raw, 'AES-GCM', false, ['decrypt']);
  const html = new TextDecoder().decode(await subtle.decrypt({ name: 'AES-GCM', iv: b64(P2.i) }, k, b64(P2.c)));
  if (html !== master) throw new Error('verification failed: the rebuilt bundle differs from the master');
  fs.writeFileSync(masterPath.replace(/\.html$/, '') + '.built.html', master);   // the exact text that was sealed, beside the master

  fs.writeFileSync(INDEX, out);
  console.log(built + '\nwrote ' + INDEX + ' — master ' + master.length + ' bytes, payload ' + next.c.length + ' b64 chars, ' + next.w.length + ' code(s) kept');
})().catch((e) => { console.error(e.message || e); process.exit(1); });
