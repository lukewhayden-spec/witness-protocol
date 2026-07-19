# VINC-0001: The Witness Protocol

**Version:** 0.1 draft · **Status:** private (Gate G1) · **Public name:** pending (L1)

## 1. Purpose

A minimal protocol for attributable action: any entity — human, AI agent, device,
document, organisation — can be registered, have its actions witnessed into a
tamper-evident log, and be verified by anyone as *(identity, authority, trust rate)*.

Three operations. Nothing else is core protocol.

| Op | Question answered |
|----|-------------------|
| `register` | Who is this entity and what key speaks for it? |
| `witness` | What happened, attested by whom? |
| `verify` | Is this entity who it claims, acting within delegated authority, and how consistent has it been over how long? |

### 1.1 Non-goals

Compute/training verification; alignment evaluation; content moderation; payment;
consensus. A Vinc registry is an accountable log operator (cf. Certificate
Transparency), not a blockchain.

## 2. Terminology

- **Entity** — anything with a keypair and a class: `human | agent | device | document | org`.
- **VID** — entity identifier: `vinc:<class>:<base64url(SHA-256(pubkey))>`.
- **Witness** — a registered entity that signs an attestation about a subject.
- **Registry** — an operator maintaining an append-only, hash-chained, checkpointed log.
- **Relying party** — anyone calling `verify`. Requires no registration.

## 3. Data model

All signed payloads are canonical JSON (RFC 8785 profile: UTF-8, lexicographically
sorted keys, no insignificant whitespace). All hashes SHA-256. All signatures Ed25519
(`alg: "ed25519"`, versioned for future migration).

### 3.1 Entity record

```json
{
  "type": "entity",
  "vid": "vinc:agent:Ab3…",
  "class": "agent",
  "pubkey": "<base64url>",
  "alg": "ed25519",
  "created_at": "2026-07-18T00:00:00Z",
  "substrates": [ { "tier": "software-key" } ],
  "sig": "<self-signature over all fields except sig>"
}
```

`substrates` declares the assurance tier of the identity binding. v0 defines
`software-key` only; hardware and biometric tiers plug in via §7 without protocol change.

### 3.2 Delegation record — the Agent Passport core

```json
{
  "type": "delegation",
  "principal": "vinc:org:Xy9…",
  "agent": "vinc:agent:Ab3…",
  "scope": ["payments:initiate:max=5000AUD", "email:send"],
  "not_before": "2026-07-18T00:00:00Z",
  "expires": "2026-10-18T00:00:00Z",
  "sig": "<principal signature>"
}
```

An agent action outside a valid, unexpired, unrevoked delegation chain to a registered
principal is **unattributed by definition**. Revocation is a witnessed log event
(`delegation.revoke`), effective from log inclusion.

### 3.3 Attestation

```json
{
  "type": "attestation",
  "id": "<hash of canonical body>",
  "subject": "vinc:agent:Ab3…",
  "att_type": "task.completion",
  "outcome": "fulfilled",
  "weight": 1,
  "payload_hash": "<SHA-256 of external evidence, optional>",
  "at": "2026-07-18T09:30:00Z",
  "witnesses": [
    { "vid": "vinc:org:Xy9…", "sig": "<sig over body>" },
    { "vid": "vinc:human:Qr2…", "sig": "<sig over body>" }
  ]
}
```

`outcome` ∈ `fulfilled | breached | neutral`. Evidence lives off-log; the log holds its
hash. Privacy model: the log proves *that* something was attested and by whom, not the
contents — consent to the underlying evidence remains with its holder (federated data,
user-held keys).

### 3.4 Log entry and checkpoint

Each accepted object is wrapped: `{ "seq": n, "prev": "<hash of entry n−1>",
"entry_hash": "<hash of this body>", "object": … }`. Registries publish signed Merkle
checkpoints at fixed intervals; independent monitors replicate and cross-check them.
A registry that rewrites history equivocates observably — that observability, not
authority, is the trust anchor for registries themselves. Registries are entities with
VIDs and trust rates of their own; the protocol eats its own cooking.

## 4. Operations

### 4.1 `register(entity_record) → log receipt`
Validates self-signature and VID derivation; appends. Registration is neutral: it
confers existence, not trust (trust-rate.md R4).

### 4.2 `witness(attestation) → log receipt`
Validates every witness signature, witness registration, and (for agent subjects) the
delegation chain if `att_type` requires scoped authority. Appends. Witnesses stake
their own rate: an attestation later contradicted by preponderant co-witnessed evidence
is recorded as a breach on the lying witness's log (`witness.contradicted`).

### 4.3 `verify(vid, at?) → verification response`

```json
{
  "vid": "vinc:agent:Ab3…",
  "entity": { … },
  "delegations": [ …active chain… ],
  "trust_rate": 0.63,
  "params_version": "v0",
  "first_witnessed": "2025-07-01T…",
  "events": { "fulfilled": 412, "breached": 1, "neutral": 9 },
  "checkpoint": { "root": "…", "seq": 18211, "sig": "…" },
  "proof": [ …Merkle path… ]
}
```

Deterministic: any party replaying the log at the same `at` with the same params
obtains the same rate. The registry computes nothing a verifier cannot recompute.

## 5. Wire protocol

HTTPS + JSON in v0. `POST /register`, `POST /witness`, `GET /verify/{vid}`,
`GET /log?from={seq}`, `GET /checkpoint`. Transport is deliberately boring; the
protocol is the data model and the log discipline, not the pipe.

## 6. Trust rate

Normative function, parameters, and attack analysis: `trust-rate.md`. The rate is
computed, never assigned. No override interface exists in the protocol — by design
there is nothing for an operator, government, or court to quietly turn. Disputes are
resolved by *more attestations*, not by editing history.

## 7. Substrate interface (assurance tiers)

Identity binding strength is declared, not assumed. A substrate tier is a named,
certifiable procedure binding a keypair to a physical or biological anchor (hardware
attestation/PUF, biometric enrolment, document custody, multi-substrate composites).
Higher tiers raise the *ceiling* of `weight` an attestation about that entity may carry;
they never bypass the time axis. Multi-substrate composites across heterogeneous
failure modes are the designated high-assurance tier — specified in a separate,
non-public document, optional. Core protocol runs on `software-key` alone.

Certification of substrate suppliers against tier definitions is the steward's revenue
layer (ISO model) and lives entirely outside protocol.

## 8. Interoperability

Entities MAY bind existing W3C DIDs (`also_known_as`); attestations are exportable as
W3C Verifiable Credentials; C2PA content-provenance manifests may be carried as
attestation payloads for `document` entities. Vinc adds the layer none of these have:
computable trust over witnessed time.

## 9. Security considerations

- **Key compromise** — `entity.rekey` is a witnessed high-weight event co-signed by
  witnesses meeting a rate threshold; history survives, the incident is visible forever.
- **Sybil / rate farming** — tenure from first witnessed act + witness-weight discount
  (trust-rate.md §7). Rate farming requires real time and real counterparties; the
  attack cost is the defence.
- **Collusion rings** — closed loops of mutual attestation are detectable (graph
  locality, discounted witness weight) and, once any member defects or an external
  contradiction lands, every member's log carries the breach permanently. v0 ships
  detection heuristics in monitors, not in protocol.
- **Registry capture** — mitigated by observability (checkpoint cross-monitoring),
  registry-level trust rates, and log portability: subjects can re-anchor their history
  to another registry with proofs intact. Exit is cheap; capture buys little.
- **The honest limit** — Vinc proves attribution and consistency. It does not prove
  intent, alignment, or future behaviour. A perfectly consistent entity can defect
  tomorrow; the protocol's promise is that the defection is attributable, priced, and
  permanent, not that it is impossible. Stated plainly because overclaiming here is how
  trust infrastructure dies.

## 10. Versioning

Spec versions are append-only; wire objects carry `spec: "VINC-0001/0.1"`. Breaking
changes require a new document number, never a silent edit. The spec obeys its own
physics.
