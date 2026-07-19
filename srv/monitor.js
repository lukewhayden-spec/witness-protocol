// monitor.js — independent equivocation watchdog for a Witness Protocol registry.
// Run from ANY machine that is not the registry: node srv/monitor.js [registry-url]
// "No single witness, ever" — applied to the registry itself.
//
// Checks, every run:
//   1. chain integrity  — full log re-audited from scratch (hash chain)
//   2. checkpoint sig   — signed by the registry's own registered key (TOFU on first sight)
//   3. append-only      — every entry seen before must be byte-identical now (no rewrites)
//   4. progress         — log never shrinks
// State lives in ~/.vinc-monitor/<host>.json. On violation: loud console + macOS notification.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { Registry, canon } = require('../ref/vinc.js');

const SERVER = process.argv[2] || 'https://vincprotocol.org';
const host = SERVER.replace(/[^a-z0-9.]/gi, '_');
const DIR = path.join(os.homedir(), '.vinc-monitor');
const STATE = path.join(DIR, host + '.json');
fs.mkdirSync(DIR, { recursive: true });

function notify(title, msg) {
  console.error(`\n!!! ${title}: ${msg}\n`);
  if (process.platform === 'darwin') {
    try { execFileSync('osascript', ['-e', `display notification ${JSON.stringify(msg)} with title ${JSON.stringify('VINC MONITOR: ' + title)} sound name "Basso"`]); } catch {}
  }
}

(async () => {
  const now = new Date().toISOString();
  // fetch everything
  let all = [], from = 0, total = 1;
  while (from < total) {
    const page = await (await fetch(`${SERVER}/log?from=${from}&_m=${Date.now()}`, { signal: AbortSignal.timeout(15000) })).json();
    all = all.concat(page.entries); total = page.total;
    if (page.entries.length === 0) break;
    from = all.length;
  }
  const cp = await (await fetch(`${SERVER}/checkpoint?_m=${Date.now()}`, { signal: AbortSignal.timeout(15000) })).json();

  // 1. chain integrity
  let reg;
  try { reg = Registry.fromEntries(all); }
  catch (e) { notify('CHAIN BROKEN', e.message); process.exit(2); }

  // 2. checkpoint signature against the registry's registered key
  const orgRec = all.map(e => e.object).find(o => o.type === 'entity' && o.vid === cp.registry);
  if (!orgRec) { notify('UNKNOWN REGISTRY KEY', 'checkpoint signed by a vid not on its own chain: ' + cp.registry); process.exit(2); }
  const { sig, ...cpBody } = cp;
  const key = crypto.createPublicKey({ key: Buffer.from(orgRec.pubkey, 'base64url'), type: 'spki', format: 'der' });
  const sigOk = crypto.verify(null, Buffer.from(canon(cpBody)), key, Buffer.from(sig, 'base64url'));
  if (!sigOk) { notify('BAD CHECKPOINT SIGNATURE', 'registry served a checkpoint its own key did not sign'); process.exit(2); }
  const head = all[all.length - 1];
  if (cp.seq !== head.seq || cp.root !== head.entry_hash) { notify('CHECKPOINT MISMATCH', `checkpoint (seq ${cp.seq}) does not match served log head (seq ${head.seq})`); process.exit(2); }

  // 3 & 4. append-only versus everything this monitor has ever seen
  const prev = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null;
  if (prev) {
    if (all.length < prev.length) { notify('EQUIVOCATION — LOG SHRANK', `previously ${prev.length} entries, now ${all.length}. History has been deleted.`); process.exit(3); }
    for (let i = 0; i < prev.hashes.length; i++) {
      if (all[i].entry_hash !== prev.hashes[i]) {
        notify('EQUIVOCATION — HISTORY REWRITTEN', `entry ${i} changed. Was ${prev.hashes[i].slice(0, 12)}…, now ${all[i].entry_hash.slice(0, 12)}…. The registry has forked its past.`);
        process.exit(3);
      }
    }
  }
  fs.writeFileSync(STATE, JSON.stringify({ length: all.length, hashes: all.map(e => e.entry_hash), registry: cp.registry, updated: now }));

  const first = prev ? '' : ' (first run — baseline recorded, trust-on-first-use)';
  console.log(`[${now}] OK — ${SERVER} · ${all.length} entries · chain intact · checkpoint signed & matching · append-only holds${first}`);
})().catch (e => { notify('MONITOR ERROR', e.message + ' — registry unreachable or misbehaving'); process.exit(1); });
