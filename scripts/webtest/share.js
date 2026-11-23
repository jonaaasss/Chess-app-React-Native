// Claude's side of "Share my data with Claude" (src/claudeShare.ts), over
// Firestore's REST API without an account (docs/firestore.rules):
//   node scripts/webtest/share.js pull <code>
//       → web-build/share/store.json (Jonas's data) + pulled.json (its hash)
//   node scripts/webtest/share.js push <code> <store.json> "<note>"
//       → leaves that store as a version Jonas can load ("Load Claude's
//         changes"), based on the last pull
// Load store.json into the web test build with run.js --data.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

// Node's fetch only uses the session's proxy with NODE_USE_ENV_PROXY.
if (process.env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status ?? 1);
}

const PROJECT = 'chess-app-3c7e6';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const OUT = path.join(__dirname, '..', '..', 'web-build', 'share');
const INLINE_MAX = 100_000;
const CHUNK_SIZE = 700_000;

// Same fingerprint as hashJson in src/backup.ts (UTF-16 code units).
function hashJson(json) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16)}:${json.length}`;
}

const chunkId = (i) => String(i).padStart(4, '0');

function value(field) {
  if (!field) return undefined;
  if ('stringValue' in field) return field.stringValue;
  if ('integerValue' in field) return Number(field.integerValue);
  if ('doubleValue' in field) return field.doubleValue;
  if ('mapValue' in field) return Object.fromEntries(Object.entries(field.mapValue.fields ?? {}).map(([k, v]) => [k, value(v)]));
  return undefined;
}

async function getDoc(docPath) {
  const r = await fetch(`${BASE}/${docPath}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${docPath}: ${r.status} ${await r.text()}`);
  const body = await r.json();
  return Object.fromEntries(Object.entries(body.fields ?? {}).map(([k, v]) => [k, value(v)]));
}

async function setDoc(docPath, fields) {
  const encoded = {};
  for (const [k, v] of Object.entries(fields)) encoded[k] = typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) };
  const r = await fetch(`${BASE}/${docPath}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: encoded }) });
  if (!r.ok) throw new Error(`PATCH ${docPath}: ${r.status} ${await r.text()}`);
}

async function pull(code) {
  const main = await getDoc(`shared/${code}`);
  if (!main || !main.hash) throw new Error('Nothing shared under this code (sharing off, or not shared yet).');
  let payload = main.payload ?? '';
  for (let i = 0; i < (main.chunkCount ?? 0); i++) {
    const part = await getDoc(`shared/${code}/chunks/${chunkId(i)}`);
    if (!part || part.hash !== main.hash) throw new Error('The copy is being updated: try again in a minute.');
    payload += part.data;
  }
  const json = zlib.gunzipSync(Buffer.from(payload, 'base64')).toString('utf8');
  if (hashJson(json) !== main.hash) throw new Error('The copy does not match its fingerprint.');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'store.json'), json);
  fs.writeFileSync(path.join(OUT, 'pulled.json'), JSON.stringify({ code, hash: main.hash, updatedAtMs: main.updatedAtMs }, null, 2));
  const store = JSON.parse(json);
  console.log(`Shared ${new Date(main.updatedAtMs).toISOString()}: ${store.repertoires.length} repertoires, ${store.openings.length} openings, ${store.cards.length} cards`);
  console.log(`→ ${path.join(OUT, 'store.json')}`);
}

async function push(code, file, note) {
  const pulled = JSON.parse(fs.readFileSync(path.join(OUT, 'pulled.json'), 'utf8'));
  if (pulled.code !== code) throw new Error('Pull with this code first.');
  const json = fs.readFileSync(file, 'utf8');
  const store = JSON.parse(json);
  if (!Array.isArray(store.repertoires) || !Array.isArray(store.openings) || !Array.isArray(store.cards)) throw new Error('Not a store.');
  const hash = hashJson(json);
  const payload = zlib.gzipSync(Buffer.from(json, 'utf8')).toString('base64');
  const chunks = [];
  if (payload.length > INLINE_MAX) for (let i = 0; i < payload.length; i += CHUNK_SIZE) chunks.push(payload.slice(i, i + CHUNK_SIZE));
  for (let i = 0; i < chunks.length; i++) await setDoc(`shared/${code}/fromClaude/c${chunkId(i)}`, { data: chunks[i], hash });
  await setDoc(`shared/${code}/fromClaude/meta`, {
    hash,
    baseHash: pulled.hash,
    note: note ?? '',
    createdAtMs: Date.now(),
    chunkCount: chunks.length,
    ...(chunks.length === 0 ? { payload } : {}),
  });
  console.log(`Left a version (${store.cards.length} cards, ${chunks.length} chunks) based on the copy of ${new Date(pulled.updatedAtMs).toISOString()}.`);
}

(async () => {
  const [cmd, code, file, note] = process.argv.slice(2);
  if (cmd === 'pull' && code) await pull(code);
  else if (cmd === 'push' && code && file) await push(code, file, note);
  else console.log('Usage: share.js pull <code> | push <code> <store.json> "<note>"');
})().catch((e) => {
  console.error(String(e.message ?? e));
  process.exit(1);
});
