# The Witness Protocol (VINC-0001)

**Attribution rails for the agent economy.**

> Trust is consistency, compounded by time. A rate, not a state.

As AI agents become economic actors, one question decides whether that economy is
governable: **which entity acted, under whose authority, and how consistent has it been
over how long?** The Witness Protocol answers it with three primitives — `register`,
`witness`, `verify` — over an append-only, hash-chained, publicly auditable log, for
any entity class: humans, AI agents, devices, documents, organisations.

Trust is not asserted; it is computed. R = C × T × Fr — consistency over witnessed
history, × tenure that cannot be bought or backdated, × freshness that decays under
dormancy. Deterministic: same log, same time, same parameters → same rate, computed by
anyone, arbitrated by no one.

## What's here

- **[spec/VINC-0001-witness-protocol.md](spec/VINC-0001-witness-protocol.md)** — the protocol: data model, wire format, operations, security analysis
- **[spec/trust-rate.md](spec/trust-rate.md)** — the scoring function: derivation, parameters, worked examples, attack analysis
- **[ref/vinc.js](ref/vinc.js)** — reference implementation: single file, zero dependencies, Node 18+
- **[ref/test.js](ref/test.js)** — executable properties: `node ref/test.js` (17 assertions)
- **[PLEDGE.md](PLEDGE.md)** — royalty-free patent pledge covering AU application 2026906417

## Try it

```
node ref/test.js
```

## Run a registry

```
node srv/server.js --port 8140
```

Then, from any machine that can reach it:

```
node srv/client.js keygen alice
node srv/client.js register http://localhost:8140 alice human
node srv/client.js keygen bot
node srv/client.js register http://localhost:8140 bot agent
node srv/client.js delegate http://localhost:8140 alice bot "email:send" 90
node srv/client.js witness  http://localhost:8140 alice <bot-vid> task.completion fulfilled 1 "did the thing"
node srv/client.js verify   http://localhost:8140 <bot-vid>
```

Private keys never leave the client; only signed objects travel. The registry is itself
a registered entity in its own log, and signs every checkpoint it serves. Integration
tests: `node srv/test-wire.js`.

Watch trust build slowly over two simulated years, crater on a single breach, rebuild
at a fraction of the pace it was lost, and watch a sybil earn nothing from volume and a
dormant entity decay to zero. Tamper with one byte of the log and watch the chain
refuse to load.

## What this is not

Not a blockchain. Not a token. Not compute verification or alignment auditing. A
registry here is an accountable log operator, closer to Certificate Transparency than
to Bitcoin — kept honest by observability and log portability, not consensus mining.

## Status

v0.2 draft. Open, royalty-free, patent-pledged. Stewarded by Vinc.
Feedback, implementations, and adversarial review welcome — especially adversarial
review. The protocol's own thesis is that claims earn trust through witnessed
challenge over time. Starting with this one.
