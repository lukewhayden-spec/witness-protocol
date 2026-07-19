// server.js — VINC-0001 registry server. Zero dependencies. Node 18+.
// Usage: node srv/server.js [--port 8140] [--data ./srv/data]
// The registry is itself a registered entity in its own log. It eats its own cooking.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Registry, PARAMS, newKeypair, loadKeypair, exportKeypair, vidOf, canon } = require('../ref/vinc.js');
const crypto = require('crypto');

const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const PORT = parseInt(arg('port', '8140'), 10);
const DATA = path.resolve(arg('data', path.join(__dirname, 'data')));
const LOG = path.join(DATA, 'log.jsonl');
const KEYS = path.join(DATA, 'registry-keys.json');

fs.mkdirSync(DATA, { recursive: true });

// ---- boot: load or create the registry, ensure the registry's own entity exists ----
let reg, regKp, regVid;
if (fs.existsSync(LOG)) {
  reg = Registry.fromEntries(fs.readFileSync(LOG, 'utf8').trim().split('\n').map(JSON.parse));
  console.log(`[boot] loaded log: ${reg.log.length} entries, chain ${reg.auditChain().ok ? 'intact' : 'BROKEN'}`);
  if (fs.existsSync(KEYS)) {
    const stored = JSON.parse(fs.readFileSync(KEYS, 'utf8'));
    regKp = loadKeypair(stored); regVid = stored.vid;
  } else {
    // adopting an existing log (e.g. the genesis pilot): the registry registers itself into it
    regKp = newKeypair();
    const r = reg.register('org', regKp, Date.now());
    regVid = r.vid;
    fs.writeFileSync(KEYS, JSON.stringify({ vid: regVid, ...exportKeypair(regKp) }, null, 2), { mode: 0o600 });
    persist();
    console.log(`[boot] adopted existing log; registry self-registered: ${regVid}`);
  }
} else {
  reg = new Registry();
  regKp = newKeypair();
  const r = reg.register('org', regKp, Date.now());
  regVid = r.vid;
  fs.writeFileSync(KEYS, JSON.stringify({ vid: regVid, ...exportKeypair(regKp) }, null, 2), { mode: 0o600 });
  persist();
  console.log(`[boot] new registry genesis. registry vid: ${regVid}`);
}

function persist() {
  fs.writeFileSync(LOG, reg.log.map(e => JSON.stringify(e)).join('\n') + (reg.log.length ? '\n' : ''));
}

function checkpoint() {
  const head = reg.log[reg.log.length - 1];
  const body = { registry: regVid, seq: head.seq, root: head.entry_hash, at: new Date().toISOString(), params: PARAMS.version };
  const sig = crypto.sign(null, Buffer.from(canon(body)), regKp.privateKey).toString('base64url');
  return { ...body, sig };
}

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(obj)); };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST' }); return res.end(); }

  if (req.method === 'GET' && u.pathname.startsWith('/verify/')) {
    const vid = decodeURIComponent(u.pathname.slice('/verify/'.length));
    return json(res, 200, reg.verify(vid, Date.now()));
  }
  if (req.method === 'GET' && u.pathname === '/checkpoint') return json(res, 200, checkpoint());
  if (req.method === 'GET' && u.pathname === '/log') {
    const from = parseInt(u.searchParams.get('from') || '0', 10);
    return json(res, 200, { entries: reg.log.slice(from, from + 500), total: reg.log.length });
  }
  if (req.method === 'GET' && u.pathname === '/about') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'about.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch { return json(res, 404, { error: 'about page not installed' }); }
  }
  if (req.method === 'GET' && u.pathname === '/join') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'join.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch { return json(res, 404, { error: 'join page not installed' }); }
  }
  if (req.method === 'GET' && u.pathname === '/' && String(req.headers.accept || '').includes('text/html')) {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'explorer.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch { /* fall through to JSON banner */ }
  }
  if (req.method === 'GET' && u.pathname === '/') {
    return json(res, 200, { protocol: 'VINC-0001/0.2', registry: regVid, entries: reg.log.length,
      params_version: PARAMS.version, endpoints: ['POST /register', 'POST /witness', 'POST /delegate', 'POST /dispute', 'GET /verify/{vid}', 'GET /log?from=n', 'GET /checkpoint'] });
  }

  if (req.method === 'POST') {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 262144) req.destroy(); });
    req.on('end', () => {
      let obj;
      try { obj = JSON.parse(raw); } catch { return json(res, 400, { error: 'invalid JSON' }); }
      try {
        let receipt;
        if (u.pathname === '/register') receipt = reg.registerSigned(obj, Date.now());
        else if (u.pathname === '/witness') receipt = reg.witnessSigned(obj, Date.now());
        else if (u.pathname === '/delegate') receipt = reg.delegateSigned(obj, Date.now());
        else if (u.pathname === '/dispute') receipt = reg.disputeSigned(obj, Date.now());
        else return json(res, 404, { error: 'unknown endpoint' });
        persist();
        return json(res, 200, { ok: true, receipt, checkpoint: checkpoint() });
      } catch (e) {
        return json(res, 422, { error: e.message });
      }
    });
    return;
  }
  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[vinc] Witness Protocol registry listening on :${PORT}`);
  console.log(`[vinc] registry entity: ${regVid}`);
  console.log(`[vinc] log: ${LOG} (${reg.log.length} entries)`);
});
