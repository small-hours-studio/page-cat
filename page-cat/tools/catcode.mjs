// Makes and checks Page Cat cat codes.
//
//   node tools/catcode.mjs keygen          create the signing key (once; back it up)
//   node tools/catcode.mjs sign cat.json   print the code for a cat spec
//   node tools/catcode.mjs read PC1.xxx    check a code and print the cat inside it
//
// A code is "PC1." + base64url(deflate-raw(spec JSON)) + "." + base64url(ECDSA P-256 signature).
// The private key lives outside the repo (~/.pagecat/signing-key.pem, or PAGECAT_KEY).
// The extension only has the public key, in shared.js, so it can check codes but never make them.
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = process.env.PAGECAT_KEY || join(homedir(), '.pagecat', 'signing-key.pem');
const SHARED = join(dirname(fileURLToPath(import.meta.url)), '..', 'shared.js');
const b64 = buf => Buffer.from(buf).toString('base64url');

function publicKeyFromShared() {
  const m = readFileSync(SHARED, 'utf8').match(/CAT_CODE_KEY = '([A-Za-z0-9_-]+)'/);
  if (!m) throw new Error('No CAT_CODE_KEY in shared.js');
  const raw = Buffer.from(m[1], 'base64url');
  return createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64(raw.subarray(1, 33)), y: b64(raw.subarray(33, 65)) }, format: 'jwk' });
}
function rawPublic(pub) {
  const j = pub.export({ format: 'jwk' });
  return b64(Buffer.concat([Buffer.from([4]), Buffer.from(j.x, 'base64url'), Buffer.from(j.y, 'base64url')]));
}
function checkSpec(s) {
  const hex = c => typeof c === 'string' && /^[0-9a-f]{6}$/i.test(c);
  if (!s || s.v !== 1) throw new Error('spec needs "v": 1');
  if (typeof s.n !== 'string' || !s.n.trim() || s.n.length > 24) throw new Error('spec needs a name "n" (1-24 characters)');
  if (!Array.isArray(s.c) || s.c.length !== 5 || !s.c.every(hex)) throw new Error('"c" must be 5 hex colors: coat, shade, stripe, eye, closed eye');
  if (s.m !== undefined && (!Array.isArray(s.m) || s.m.length > 60)) throw new Error('"m" must be a list of markings');
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'keygen') {
  if (existsSync(KEY)) { console.error(`A key already exists at ${KEY}. Not replacing it: codes made with it would stop working.`); process.exit(1); }
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  mkdirSync(dirname(KEY), { recursive: true });
  writeFileSync(KEY, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const pub = rawPublic(publicKey);
  const shared = readFileSync(SHARED, 'utf8');
  writeFileSync(SHARED, shared.replace(/CAT_CODE_KEY = '[^']*'/, `CAT_CODE_KEY = '${pub}'`));
  console.log(`Private key: ${KEY}\nPublic key written to shared.js: ${pub}`);
} else if (cmd === 'sign') {
  const spec = JSON.parse(readFileSync(arg === '-' || !arg ? 0 : arg, 'utf8'));
  checkSpec(spec);
  const data = deflateRawSync(Buffer.from(JSON.stringify(spec)), { level: 9 });
  const sig = sign('sha256', data, { key: createPrivateKey(readFileSync(KEY)), dsaEncoding: 'ieee-p1363' });
  if (!verify('sha256', data, { key: publicKeyFromShared(), dsaEncoding: 'ieee-p1363' }, sig)) throw new Error('The key in shared.js does not match the signing key');
  console.log(`PC1.${b64(data)}.${b64(sig)}`);
} else if (cmd === 'read') {
  const m = String(arg || '').replace(/\s+/g, '').match(/^PC1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (!m) { console.error("That isn't a cat code."); process.exit(1); }
  const data = Buffer.from(m[1], 'base64url'), sig = Buffer.from(m[2], 'base64url');
  const ok = verify('sha256', data, { key: publicKeyFromShared(), dsaEncoding: 'ieee-p1363' }, sig);
  console.log(ok ? 'Signature OK' : 'SIGNATURE DOES NOT MATCH');
  console.log(JSON.stringify(JSON.parse(inflateRawSync(data).toString()), null, 1));
  process.exit(ok ? 0 : 1);
} else {
  console.log('Usage: node tools/catcode.mjs keygen | sign <spec.json> | read <code>');
}
