// vinc.js — VINC-0001 reference implementation (v0.1)
// Zero dependencies. Node 18+. Auditable in one sitting; that is the point.
'use strict';
const crypto = require('crypto');

// ---------- canonical JSON (RFC 8785 profile: sorted keys, no whitespace) ----------
function canon(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canon).join(',') + ']';
  return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canon(obj[k])).join(',') + '}';
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest();
const b64u = (buf) => buf.toString('base64url');

// ---------- keys & identity ----------
function newKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { publicKey, privateKey,
    pub: b64u(publicKey.export({ type: 'spki', format: 'der' })) };
}
const vidOf = (cls, pub) => `vinc:${cls}:${b64u(sha256(pub))}`;
const sign = (priv, body) => b64u(crypto.sign(null, Buffer.from(canon(body)), priv));
function verifySig(pub, body, sig) {
  const key = crypto.createPublicKey({ key: Buffer.from(pub, 'base64url'), type: 'spki', format: 'der' });
  return crypto.verify(null, Buffer.from(canon(body)), key, Buffer.from(sig, 'base64url'));
}

// ---------- trust-rate parameters (profile v0 — provisional, Gate G2) ----------
const PARAMS = {
  version: 'v0.2',
  H_f: 180,        // fulfillment half-life, days
  H_b: 1460,       // breach half-life, days
  k: 8,            // breach amplifier
  tau: 365,        // tenure constant, days
  H_r: 90,         // freshness half-life, days — dormancy decays the rate (R7)
  eps: 1e-9,
  R_floor: 0.1,    // minimum witness weight multiplier
};
const DAY = 86400000;

// ---------- registry ----------
class Registry {
  constructor() { this.log = []; this.entities = new Map(); this.keys = new Map(); }

  _append(object, now) {
    const prev = this.log.length ? this.log[this.log.length - 1].entry_hash : b64u(sha256('vinc:genesis'));
    const body = { seq: this.log.length, prev, at: new Date(now).toISOString(), object };
    const entry = { ...body, entry_hash: b64u(sha256(canon(body))) };
    this.log.push(entry);
    return { seq: entry.seq, entry_hash: entry.entry_hash };
  }

  register(cls, kp, now, substrates = [{ tier: 'software-key' }]) {
    const rec = { type: 'entity', spec: 'VINC-0001/0.1', class: cls, vid: vidOf(cls, kp.pub),
      pubkey: kp.pub, alg: 'ed25519', created_at: new Date(now).toISOString(), substrates };
    rec.sig = sign(kp.privateKey, { ...rec });
    if (!verifySig(rec.pubkey, (({ sig, ...r }) => r)(rec), rec.sig)) throw new Error('bad self-signature');
    if (this.entities.has(rec.vid)) throw new Error('already registered');
    this.entities.set(rec.vid, rec);
    this.keys.set(rec.vid, kp.pub);
    return { vid: rec.vid, receipt: this._append(rec, now) };
  }

  delegate(principalKp, principalVid, agentVid, scope, now, days) {
    if (!this.entities.has(principalVid) || !this.entities.has(agentVid)) throw new Error('unregistered party');
    const d = { type: 'delegation', principal: principalVid, agent: agentVid, scope,
      not_before: new Date(now).toISOString(), expires: new Date(now + days * DAY).toISOString() };
    d.sig = sign(principalKp.privateKey, { ...d });
    return { delegation: d, receipt: this._append(d, now) };
  }

  witness(subjectVid, att_type, outcome, weight, witnessList, now, payload_hash = null) {
    if (!this.entities.has(subjectVid)) throw new Error('unregistered subject');
    const body = { type: 'attestation', spec: 'VINC-0001/0.1', subject: subjectVid, att_type,
      outcome, weight, payload_hash, at: new Date(now).toISOString() };
    const witnesses = witnessList.map(({ vid, kp }) => {
      if (!this.entities.has(vid)) throw new Error('unregistered witness: ' + vid);
      return { vid, sig: sign(kp.privateKey, body) };
    });
    for (const w of witnesses)
      if (!verifySig(this.keys.get(w.vid), body, w.sig)) throw new Error('bad witness sig');
    const att = { ...body, id: b64u(sha256(canon(body))), witnesses };
    return { attestation: att, receipt: this._append(att, now) };
  }

  // ---------- trust rate (deterministic; anyone can replay this) ----------
  trustRate(vid, now, p = PARAMS) {
    let F = 0, B = 0, first = null, last = null;
    const counts = { fulfilled: 0, breached: 0, neutral: 0 };
    for (const e of this.log) {
      const o = e.object;
      if (o.type !== 'attestation' || o.subject !== vid) continue;
      const t = Date.parse(o.at);
      if (t > now) continue; // point-in-time replay: the future must not exist yet (R5)
      if (first === null) first = t;
      if (last === null || t > last) last = t;
      counts[o.outcome] = (counts[o.outcome] || 0) + 1;
      if (o.outcome === 'neutral') continue;
      // witness-weight discount: attestation weight scaled by best witness rate at its time
      const wr = Math.max(...o.witnesses.map(w => this.trustRateShallow(w.vid, t, p)), p.R_floor);
      const w = o.weight * Math.max(wr, p.R_floor);
      const age = (now - t) / DAY;
      if (o.outcome === 'fulfilled') F += w * Math.pow(2, -age / p.H_f);
      else if (o.outcome === 'breached') B += w * Math.pow(2, -age / p.H_b);
    }
    if (first === null) return { rate: 0, C: 0, T: 0, Fr: 0, counts, first_witnessed: null };
    const C = F / (F + p.k * B + p.eps);
    const T = 1 - Math.exp(-((now - first) / DAY) / p.tau);
    // freshness (R7): trust cannot be banked — dormancy decays the rate
    const Fr = Math.pow(2, -((now - last) / DAY) / p.H_r);
    return { rate: C * T * Fr, C, T, Fr, counts, first_witnessed: new Date(first).toISOString() };
  }
  // one-level recursion guard: witnesses rated without their own witness discount
  trustRateShallow(vid, now, p) {
    let F = 0, B = 0, first = null, last = null;
    for (const e of this.log) {
      const o = e.object;
      if (o.type !== 'attestation' || o.subject !== vid || o.outcome === 'neutral') continue;
      const t = Date.parse(o.at);
      if (t > now) continue;
      if (first === null) first = t;
      if (last === null || t > last) last = t;
      const age = (now - t) / DAY;
      if (o.outcome === 'fulfilled') F += o.weight * Math.pow(2, -age / p.H_f);
      else B += o.weight * Math.pow(2, -age / p.H_b);
    }
    if (first === null) return 0;
    const C = F / (F + p.k * B + p.eps);
    const T = 1 - Math.exp(-((now - first) / DAY) / p.tau);
    const Fr = Math.pow(2, -((now - last) / DAY) / p.H_r);
    return C * T * Fr;
  }

  verify(vid, now) {
    const entity = this.entities.get(vid);
    if (!entity) return { vid, registered: false };
    const delegations = this.log.filter(e => e.object.type === 'delegation'
      && e.object.agent === vid && Date.parse(e.object.expires) > now).map(e => e.object);
    const tr = this.trustRate(vid, now);
    return { vid, registered: true, class: entity.class, trust_rate: +tr.rate.toFixed(4),
      params_version: PARAMS.version, first_witnessed: tr.first_witnessed,
      events: tr.counts, delegations, log_length: this.log.length };
  }

  // ---------- tamper evidence ----------
  auditChain() {
    let prev = b64u(sha256('vinc:genesis'));
    for (const e of this.log) {
      const { entry_hash, ...body } = e;
      if (e.prev !== prev) return { ok: false, at_seq: e.seq, reason: 'chain break' };
      if (b64u(sha256(canon(body))) !== entry_hash) return { ok: false, at_seq: e.seq, reason: 'entry hash mismatch' };
      prev = entry_hash;
    }
    return { ok: true, length: this.log.length };
  }
}

// ---------- wire path: accept externally-signed objects (clients sign, registry validates) ----------
Registry.prototype.registerSigned = function (rec, now) {
  if (rec.type !== 'entity') throw new Error('not an entity record');
  const { sig, ...body } = rec;
  if (!sig) throw new Error('missing self-signature');
  if (rec.vid !== vidOf(rec.class, rec.pubkey)) throw new Error('vid does not derive from pubkey');
  if (!verifySig(rec.pubkey, body, sig)) throw new Error('bad self-signature');
  if (this.entities.has(rec.vid)) throw new Error('already registered');
  this.entities.set(rec.vid, rec);
  this.keys.set(rec.vid, rec.pubkey);
  return this._append(rec, now);
};
Registry.prototype.witnessSigned = function (att, now) {
  if (att.type !== 'attestation') throw new Error('not an attestation');
  const { id, witnesses, ...body } = att;
  if (!witnesses || !witnesses.length) throw new Error('no witnesses: no single witness ever means at least one');
  if (id !== b64u(sha256(canon(body)))) throw new Error('attestation id does not match body');
  if (!this.entities.has(att.subject)) throw new Error('unregistered subject');
  if (!['fulfilled', 'breached', 'neutral'].includes(att.outcome)) throw new Error('bad outcome');
  if (!(att.weight > 0)) throw new Error('bad weight');
  for (const w of witnesses) {
    if (!this.entities.has(w.vid)) throw new Error('unregistered witness: ' + w.vid);
    if (!verifySig(this.keys.get(w.vid), body, w.sig)) throw new Error('bad witness signature: ' + w.vid);
  }
  return this._append(att, now);
};
Registry.prototype.delegateSigned = function (d, now) {
  if (d.type !== 'delegation') throw new Error('not a delegation');
  const { sig, ...body } = d;
  if (!this.entities.has(d.principal) || !this.entities.has(d.agent)) throw new Error('unregistered party');
  if (!verifySig(this.keys.get(d.principal), body, sig)) throw new Error('bad principal signature');
  if (!(Date.parse(d.expires) > Date.parse(d.not_before))) throw new Error('expiry precedes not_before');
  return this._append(d, now);
};

// ---------- persistence: reconstruct a registry from a serialized log ----------
Registry.fromEntries = function (entries) {
  const reg = new Registry();
  for (const e of entries) {
    reg.log.push(e);
    if (e.object.type === 'entity') {
      reg.entities.set(e.object.vid, e.object);
      reg.keys.set(e.object.vid, e.object.pubkey);
    }
  }
  const audit = reg.auditChain();
  if (!audit.ok) throw new Error(`refusing to load tampered log: ${audit.reason} at seq ${audit.at_seq}`);
  return reg;
};

// keypair from stored PKCS8/SPKI DER (base64url)
function loadKeypair(stored) {
  return {
    publicKey: crypto.createPublicKey({ key: Buffer.from(stored.pub, 'base64url'), type: 'spki', format: 'der' }),
    privateKey: crypto.createPrivateKey({ key: Buffer.from(stored.priv, 'base64url'), type: 'pkcs8', format: 'der' }),
    pub: stored.pub,
  };
}
function exportKeypair(kp) {
  return { pub: kp.pub, priv: b64u(kp.privateKey.export({ type: 'pkcs8', format: 'der' })) };
}

module.exports = { Registry, PARAMS, newKeypair, loadKeypair, exportKeypair, vidOf, canon, DAY };
