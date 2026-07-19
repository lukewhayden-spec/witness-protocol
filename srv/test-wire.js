// test-wire.js — integration test over live HTTP. Run: node srv/test-wire.js
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const assert = require('assert');
const { canon } = require('../ref/vinc.js');

const PORT = 8000 + Math.floor(Math.random() * 1000);
const S = `http://localhost:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'vinc-wire-'));
const KEYDIR = path.join(__dirname, 'keys');
const b64u = (b) => b.toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(s).digest();
let pass = 0;
const ok = (c, n) => { assert(c, n); console.log('  ✓ ' + n); pass++; };
const cli = (...args) => execFileSync('node', [path.join(__dirname, 'client.js'), ...args], { encoding: 'utf8' });

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), '--port', String(PORT), '--data', DATA], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  try {
    const info = await (await fetch(S + '/')).json();
    ok(info.protocol === 'VINC-0001/0.2', 'server up, protocol banner correct');
    ok(info.registry.startsWith('vinc:org:'), 'registry self-registered as entity');

    for (const n of ['w-alice', 'w-bot']) { try { fs.unlinkSync(path.join(KEYDIR, n + '.json')); } catch {} }
    cli('keygen', 'w-alice'); cli('register', S, 'w-alice', 'human');
    cli('keygen', 'w-bot'); cli('register', S, 'w-bot', 'agent');
    const vid = (n) => JSON.parse(fs.readFileSync(path.join(KEYDIR, n + '.json'))).vid;
    const A = vid('w-alice'), B = vid('w-bot');
    ok(A.startsWith('vinc:human:') && B.startsWith('vinc:agent:'), 'both parties registered over the wire');

    let r = await (await fetch(S + '/register', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(JSON.parse(fs.readFileSync(path.join(KEYDIR, 'w-alice.json'))).vid && { type: 'entity' }) })).status;
    ok(r === 422, 'malformed registration rejected');

    cli('delegate', S, 'w-alice', 'w-bot', 'email:send', '30');
    cli('witness', S, 'w-alice', B, 'task.completion', 'fulfilled', '1', 'wire test');
    const v = await (await fetch(`${S}/verify/${encodeURIComponent(B)}`)).json();
    ok(v.delegations.length === 1 && v.events.fulfilled === 1, 'delegation + witnessed event visible via verify');

    // forged witness signature must bounce
    const body = { type: 'attestation', spec: 'VINC-0001/0.2', subject: B, att_type: 'x', outcome: 'fulfilled', weight: 9, payload_hash: null, at: new Date().toISOString() };
    const att = { ...body, id: b64u(sha(canon(body))), witnesses: [{ vid: A, sig: b64u(Buffer.from('nope'.repeat(16))) }] };
    r = (await fetch(S + '/witness', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(att) })).status;
    ok(r === 422, 'forged witness signature rejected');

    // unregistered witness must bounce
    att.witnesses[0].vid = 'vinc:human:doesnotexist';
    r = (await fetch(S + '/witness', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(att) })).status;
    ok(r === 422, 'unregistered witness rejected');

    const cp = await (await fetch(S + '/checkpoint')).json();
    ok(cp.sig && cp.root && cp.seq >= 4, 'signed checkpoint served');

    // dispute over the wire: file a breach against alice, alice disputes it
    const wk = JSON.parse(fs.readFileSync(path.join(KEYDIR, 'w-bot.json')));
    const breachBody = { type: 'attestation', spec: 'VINC-0001/0.3', subject: A, att_type: 'debt.unpaid',
      outcome: 'breached', weight: 5, payload_hash: null, at: new Date().toISOString() };
    const { loadKeypair } = require('../ref/vinc.js');
    const bkp = loadKeypair(wk);
    const bsig = b64u(crypto.sign(null, Buffer.from(canon(breachBody)), bkp.privateKey));
    const breach = { ...breachBody, id: b64u(sha(canon(breachBody))), witnesses: [{ vid: B, sig: bsig }] };
    let br = await fetch(S + '/witness', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(breach) });
    ok(br.status === 200, 'breach attestation accepted (validly signed claims are admissible)');
    const ak = loadKeypair(JSON.parse(fs.readFileSync(path.join(KEYDIR, 'w-alice.json'))));
    const dBody = { type: 'dispute', spec: 'VINC-0001/0.3', attestation_id: breach.id, disputant: A, evidence_hash: null, at: new Date().toISOString() };
    const dsig = b64u(crypto.sign(null, Buffer.from(canon(dBody)), ak.privateKey));
    br = await fetch(S + '/dispute', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...dBody, sig: dsig }) });
    ok(br.status === 200, 'subject disputed the breach over the wire');
    const dBad = { type: 'dispute', spec: 'VINC-0001/0.3', attestation_id: breach.id, disputant: B, evidence_hash: null, at: new Date().toISOString() };
    const dBadSig = b64u(crypto.sign(null, Buffer.from(canon(dBad)), bkp.privateKey));
    br = await fetch(S + '/dispute', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...dBad, sig: dBadSig }) });
    ok(br.status === 422, 'non-subject dispute rejected');

    // persistence: restart server, log must reload intact
    srv.kill(); await new Promise(r2 => setTimeout(r2, 300));
    const srv2 = spawn('node', [path.join(__dirname, 'server.js'), '--port', String(PORT), '--data', DATA], { stdio: 'ignore' });
    await new Promise(r2 => setTimeout(r2, 1200));
    const v2 = await (await fetch(`${S}/verify/${encodeURIComponent(B)}`)).json();
    ok(v2.registered && v2.events.fulfilled === 1, 'log survives server restart, chain intact');
    srv2.kill();

    console.log(`\nAll ${pass} wire assertions passed.`);
  } catch (e) { srv.kill(); console.error('FAIL: ' + e.message); process.exit(1); }
})();
