// test.js — VINC-0001 scenario tests. Run: node ref/test.js
'use strict';
const { Registry, newKeypair, canon, DAY } = require('./vinc.js');
const crypto = require('crypto');
const assert = require('assert');
const signObj = (kp, body) => Buffer.from(crypto.sign(null, Buffer.from(canon(body)), kp.privateKey)).toString('base64url');

let pass = 0;
const ok = (cond, name) => { assert(cond, name); console.log('  ✓ ' + name); pass++; };
const T0 = Date.parse('2026-07-18T00:00:00Z');

console.log('\n[1] Register entities (human, org, agent, device)');
const reg = new Registry();
const luke = newKeypair(), als = newKeypair(), agent = newKeypair(), device = newKeypair();
const vLuke = reg.register('human', luke, T0).vid;
const vAls = reg.register('org', als, T0).vid;
const vAgent = reg.register('agent', agent, T0).vid;
const vDevice = reg.register('device', device, T0).vid;
ok(vAgent.startsWith('vinc:agent:'), 'VID derivation');
ok(reg.verify(vAgent, T0).trust_rate === 0, 'registration confers existence, not trust (R4)');

console.log('\n[2] Delegation — the Agent Passport');
reg.delegate(als, vAls, vAgent, ['payments:initiate:max=5000AUD'], T0, 90);
const v = reg.verify(vAgent, T0 + 30 * DAY);
ok(v.delegations.length === 1 && v.delegations[0].principal === vAls, 'active delegation chain to principal');
ok(reg.verify(vAgent, T0 + 91 * DAY).delegations.length === 0, 'delegation expires; agent unattributed');

console.log('\n[3] Trust builds slowly (R1): daily fulfilled attestations, w=1');
for (let d = 1; d <= 730; d++)
  reg.witness(vAgent, 'task.completion', 'fulfilled', 1, [{ vid: vAls, kp: als }], T0 + d * DAY);
const at = (day) => reg.trustRate(vAgent, T0 + day * DAY).rate;
const r30 = at(30), r180 = at(180), r365 = at(365), r730 = at(730);
console.log(`    day 30: ${r30.toFixed(3)}  day 180: ${r180.toFixed(3)}  day 365: ${r365.toFixed(3)}  day 730: ${r730.toFixed(3)}`);
ok(r30 < 0.1, 'new entity capped low despite perfect behaviour');
ok(r30 < r180 && r180 < r365 && r365 < r730, 'monotone growth under consistency');

console.log('\n[4] Breach with challenge window (R2 + spec §10.1): w=50 breach at day 731');
reg.witness(vAgent, 'payment.dispute', 'breached', 50, [{ vid: vLuke, kp: luke }], T0 + 731 * DAY);
const rDuringWindow = at(732);
console.log(`    day 732 (inside 7-day window): ${rDuringWindow.toFixed(3)}  (was ${r730.toFixed(3)})`);
ok(Math.abs(rDuringWindow - at(730.9)) < 0.02, 'breach scores nothing inside the challenge window — subject has time to dispute');
const rBreach = at(739);
console.log(`    day 739 (window passed, undisputed): ${rBreach.toFixed(3)}`);
ok(rBreach < r730 * 0.55, 'undisputed breach then removes >45% of a two-year rate');

console.log('\n[5] Trust rebuilds slowly (R3): flawless daily work resumes');
for (let d = 732; d <= 1095; d++)
  reg.witness(vAgent, 'task.completion', 'fulfilled', 1, [{ vid: vAls, kp: als }], T0 + d * DAY);
const r1095 = at(1095);
console.log(`    day 1095 (1y post-breach): ${r1095.toFixed(3)}`);
ok(r1095 > rBreach, 'recovery is possible');
ok(r1095 < r365, 'one year of penance < one clean year at day 365 — breach memory outlasts fulfillment memory');

console.log('\n[6] Determinism (R5): replay yields identical rate');
ok(at(1095) === r1095, 'same log, same time, same params → same rate');

console.log('\n[7] Sybil resistance: fresh identity cannot buy tenure');
const sybil = newKeypair();
const vSybil = reg.register('agent', sybil, T0 + 1095 * DAY).vid;
for (let i = 0; i < 200; i++)
  reg.witness(vSybil, 'task.completion', 'fulfilled', 1, [{ vid: vAls, kp: als }], T0 + (1095 + i / 96) * DAY);
const rSybil = reg.trustRate(vSybil, T0 + 1097 * DAY).rate;
console.log(`    sybil after 200 attestations in 2 days: ${rSybil.toFixed(4)}`);
ok(rSybil < 0.01, 'volume without time buys nothing');

console.log('\n[8] Witness-weight discount: unrated witnesses carry floor weight');
const nobody = newKeypair();
const vNobody = reg.register('human', nobody, T0 + 1095 * DAY).vid;
const lone = new Registry();
const a1 = newKeypair(), w1 = newKeypair();
const vA1 = lone.register('agent', a1, T0).vid, vW1 = lone.register('org', w1, T0).vid;
lone.witness(vA1, 'task.completion', 'fulfilled', 100, [{ vid: vW1, kp: w1 }], T0 + 1 * DAY);
const rA1 = lone.trustRate(vA1, T0 + 2 * DAY).rate;
ok(rA1 < 0.01, 'high-weight attestation from zero-rate witness is floor-discounted');

console.log('\n[9] Tamper evidence: log chain audit');
ok(reg.auditChain().ok, 'clean chain verifies');
const evil = new Registry();
const e1 = newKeypair();
const vE1 = evil.register('agent', e1, T0).vid;
evil.witness(vE1, 'task.completion', 'fulfilled', 1, [{ vid: vE1, kp: e1 }], T0 + DAY);
evil.log[1].object.outcome = 'breached';               // rewrite history
const audit = evil.auditChain();
ok(!audit.ok && audit.at_seq === 1, 'single-field rewrite detected at exact seq');

console.log('\n[10] Point-in-time replay: past rates unaffected by later events');
ok(Math.abs(at(365) - r365) < 1e-12, 'rate at day 365 identical before and after later breach was logged');

console.log('\n[10b] Dormancy (R7): trust cannot be banked — regression for the Fig. 3 flaw');
const rSybilLater = reg.trustRate(vSybil, T0 + (1095 + 365) * DAY).rate;
console.log(`    burst sybil, one year dormant: ${rSybilLater.toFixed(4)}`);
ok(rSybilLater < 0.05, 'burst-then-silence does NOT inflate with calendar time');
ok(reg.trustRate(vSybil, T0 + (1095 + 730) * DAY).rate < rSybilLater + 0.01, 'dormant rate does not grow');

console.log('\n[12] Dispute mechanics (spec §10.2): the Olivier scenario');
// Two victims, identical malicious breaches; one disputes, one does not.
const mal = newKeypair(), v1 = newKeypair(), v2 = newKeypair();
const vMal = reg.register('human', mal, T0 + 1100 * DAY).vid;
const vV1 = reg.register('human', v1, T0 + 1100 * DAY).vid;
const vV2 = reg.register('human', v2, T0 + 1100 * DAY).vid;
for (let d = 1101; d <= 1200; d++) {
  reg.witness(vV1, 'task.completion', 'fulfilled', 1, [{ vid: vAls, kp: als }], T0 + d * DAY);
  reg.witness(vV2, 'task.completion', 'fulfilled', 1, [{ vid: vAls, kp: als }], T0 + d * DAY);
}
const b1 = reg.witness(vV1, 'debt.unpaid', 'breached', 10, [{ vid: vMal, kp: mal }], T0 + 1201 * DAY).attestation;
const b2 = reg.witness(vV2, 'debt.unpaid', 'breached', 10, [{ vid: vMal, kp: mal }], T0 + 1201 * DAY).attestation;
// V1 disputes within the window
const dBody = { type: 'dispute', spec: 'VINC-0001/0.3', attestation_id: b1.id, disputant: vV1,
  evidence_hash: null, at: new Date(T0 + 1203 * DAY).toISOString() };
reg.disputeSigned({ ...dBody, sig: signObj(v1, dBody) }, T0 + 1203 * DAY);
const rV1 = reg.trustRate(vV1, T0 + 1215 * DAY).rate;
const rV2 = reg.trustRate(vV2, T0 + 1215 * DAY).rate;
console.log(`    disputed victim: ${rV1.toFixed(3)} · undisputed victim: ${rV2.toFixed(3)}`);
ok(rV1 > rV2, 'disputing a breach softens its impact — the contest is priced in');
let threw = false;
try { const x = { type: 'dispute', spec: 'VINC-0001/0.3', attestation_id: b2.id, disputant: vMal, evidence_hash: null, at: new Date(T0 + 1204 * DAY).toISOString() };
  reg.disputeSigned({ ...x, sig: signObj(mal, x) }, T0 + 1204 * DAY); } catch (e) { threw = true; }
ok(threw, 'only the SUBJECT of an attestation may dispute it');

console.log('\n[13] Trajectory table for spec/trust-rate.md §5 (daily work continues, breach w=50 at day 731)');
for (let d = 1096; d <= 2191; d++)
  reg.witness(vAgent, 'task.completion', 'fulfilled', 1, [{ vid: vAls, kp: als }], T0 + d * DAY);
for (const d of [30, 180, 365, 730, 732, 739, 1095, 1825, 2191])
  console.log(`    day ${String(d).padEnd(5)} R = ${at(d).toFixed(3)}`);

console.log(`\nAll ${pass} assertions passed.`);
