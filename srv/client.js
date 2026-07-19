// client.js — VINC-0001 wire client. Zero dependencies. Node 18+ (global fetch).
// Keys are generated and stay on THIS machine; only signed objects travel.
//
//   node srv/client.js keygen <name>
//   node srv/client.js register <server> <name> <class>          class: human|agent|device|document|org
//   node srv/client.js delegate <server> <principal> <agent> <scope,csv> <days>
//   node srv/client.js witness  <server> <witnessName> <subjectVid> <att_type> <outcome> <weight> [memo]
//   node srv/client.js verify   <server> <vid>
//   node srv/client.js checkpoint <server>
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { newKeypair, loadKeypair, exportKeypair, vidOf, canon } = require('../ref/vinc.js');

const KEYDIR = path.join(__dirname, 'keys');
const b64u = (b) => b.toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest();
const sign = (kp, body) => b64u(crypto.sign(null, Buffer.from(canon(body)), kp.privateKey));
const kfile = (n) => path.join(KEYDIR, n + '.json');
const loadK = (n) => { const s = JSON.parse(fs.readFileSync(kfile(n), 'utf8')); return { kp: loadKeypair(s), vid: s.vid, class: s.class }; };
async function post(server, ep, obj) {
  const r = await fetch(server + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
  const out = await r.json();
  if (!r.ok) throw new Error(`${ep} → ${r.status}: ${out.error}`);
  return out;
}

(async () => {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === 'keygen') {
    fs.mkdirSync(KEYDIR, { recursive: true });
    const kp = newKeypair();
    fs.writeFileSync(kfile(a[0]), JSON.stringify({ name: a[0], ...exportKeypair(kp) }, null, 2), { mode: 0o600 });
    console.log(`key generated: ${kfile(a[0])} (vid assigned at registration)`);
  } else if (cmd === 'register') {
    const [server, name, cls] = a;
    const s = JSON.parse(fs.readFileSync(kfile(name), 'utf8'));
    const kp = loadKeypair(s);
    const rec = { type: 'entity', spec: 'VINC-0001/0.2', class: cls, vid: vidOf(cls, kp.pub),
      pubkey: kp.pub, alg: 'ed25519', created_at: new Date().toISOString(), substrates: [{ tier: 'software-key' }] };
    rec.sig = sign(kp, rec);
    const out = await post(server, '/register', rec);
    fs.writeFileSync(kfile(name), JSON.stringify({ ...s, vid: rec.vid, class: cls }, null, 2), { mode: 0o600 });
    console.log(`registered ${rec.vid}\nreceipt seq ${out.receipt.seq}, checkpoint root ${out.checkpoint.root.slice(0, 12)}…`);
  } else if (cmd === 'delegate') {
    const [server, pname, aname, scope, days] = a;
    const p = loadK(pname), ag = loadK(aname);
    const d = { type: 'delegation', principal: p.vid, agent: ag.vid, scope: scope.split(','),
      not_before: new Date().toISOString(), expires: new Date(Date.now() + parseInt(days, 10) * 86400000).toISOString() };
    d.sig = sign(p.kp, d);
    const out = await post(server, '/delegate', d);
    console.log(`delegation ${p.vid.slice(0, 24)}… → ${ag.vid.slice(0, 24)}… seq ${out.receipt.seq}`);
  } else if (cmd === 'witness') {
    const [server, wname, subject, att_type, outcome, weight, memo] = a;
    const w = loadK(wname);
    const body = { type: 'attestation', spec: 'VINC-0001/0.2', subject, att_type, outcome,
      weight: parseFloat(weight), payload_hash: memo ? b64u(sha256(memo)) : null, at: new Date().toISOString() };
    const att = { ...body, id: b64u(sha256(canon(body))), witnesses: [{ vid: w.vid, sig: sign(w.kp, body) }] };
    const out = await post(server, '/witness', att);
    console.log(`witnessed (${outcome}, w=${weight}) seq ${out.receipt.seq}`);
  } else if (cmd === 'verify') {
    const [server, vid] = a;
    const r = await fetch(`${server}/verify/${encodeURIComponent(vid)}`);
    console.log(JSON.stringify(await r.json(), null, 1));
  } else if (cmd === 'checkpoint') {
    const r = await fetch(a[0] + '/checkpoint');
    console.log(JSON.stringify(await r.json(), null, 1));
  } else {
    console.log('commands: keygen | register | delegate | witness | verify | checkpoint (see header)');
  }
})().catch(e => { console.error('error: ' + e.message); process.exit(1); });
