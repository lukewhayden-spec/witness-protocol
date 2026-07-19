# VINC-0001: The Witness Protocol

**Version:** 0.1 draft · **Status:** private (Gate G1) · **Public name:** pending (L1)

## 0. Positioning — the witness stand, not the bench

The Witness Protocol will be mistaken for two things it is not: a toy, and a tyranny.
This section exists to prevent both, and should be read before the mechanics.

**What law does, in four jobs:** sets norms (what is allowed), adjudicates (was a norm
broken in this case), enforces (consequences follow), and holds legitimacy (why the
above is accepted). Vinc touches three of these. It must never touch the fourth the way
a state does.

**Where Vinc fits — and it is a large space:**

1. **The evidence layer.** Legal and institutional systems run on testimony that a
   single authority can later reclassify under pressure — attestation without
   verification infrastructure. Vinc is the un-rewritable, attributable record that
   layer has always lacked. It does not judge; it makes *who attested what, when*
   impossible to quietly alter. Every adjudicating body is downstream of this and none
   possess it.
2. **Private ordering.** Most enforceable norms are not the state: merchant law, guilds,
   credit ratings, professional bodies, marketplace reputation, certification. These run
   on reputation and exclusion, predate state law by millennia, and coexist with it.
   Vinc is a general substrate for such opt-in communities — the ISO/certification model,
   where a body defines the norm and Vinc makes compliance checkable.
3. **The agent frontier.** Human law assumes human deterrents — incarceration, shame,
   ruin — that autonomous software actors do not feel. An agent cannot be jailed. It can
   be bound to a human principal by delegation, have every action witnessed, and carry a
   computed trust rate. For the agent economy, attestation may be the only regulatory
   layer that physically functions.

**Where Vinc stops — by design, not deficiency:**

1. **It does not adjudicate contested truth.** It records the claim and the dispute; it
   does not rule who is right, because a ruler is a capturable authority. For genuinely
   contested facts it surfaces the disagreement and halts. Resolution-by-more-attestation
   is majoritarian, and majorities are what real due process exists to restrain. The
   challenge window (§10.1) and dispute mechanism (§10.2) are proto-due-process; they are
   not due process.
2. **It does not wield coercive force.** Its only sanction is reputational exclusion —
   potent in opt-in economic life, inert against those indifferent to their rate, those
   powerful enough to ignore exclusion, and harms for which reputation damage is not
   remotely proportionate. Reputation cannot price violence.
3. **It refuses to become a universal score.** A mandatory, cross-domain, always-on
   reputation enforced by exclusion is a control grid. The only things separating this
   protocol from that outcome are architectural and load-bearing: **open, forkable,
   domain-scoped, user-held keys, no central arbiter, disputable, opt-in.** These are not
   features to be traded away for convenience. Removing any of them converts the witness
   stand into the panopticon.

**The claim that holds:** law tells you what happens after trust breaks; Vinc measures
trust before it breaks and records the break when it happens. It sits *upstream* of law,
not in its chair — the witness stand, the merchant's ledger, and the agent's leash,
three things every legal order assumes and none has built. It is not the judge, the
police, or the sovereign. The day it claims to be, it should be shut down.

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

## 10. Adversarial attestation and dispute

The protocol's primary attack surface is not cryptographic. It is **truthful-looking
malice**: validly signed attestations whose content is false, one-sided, or coercive.
Named threats:

- **T1 — One-sided breach.** A genuine falling-out filed by the angry party, in their
  framing, with no voice for the subject.
- **T2 — Power asymmetry.** A high-rate party (landlord, employer, platform) can breach
  a low-rate party consequentially; the reverse carries little weight. Unmitigated,
  the protocol industrialises the asymmetry it exists to expose.
- **T3 — Pile-on.** Multiple real identities attesting the same falsehood.
- **T4 — Shakedown.** "Pay, or I file." Extortion with a clean audit trail.

Design stance: an attestation is a **claim, not a verdict**. Mechanisms:

### 10.1 Challenge window (v0.3, normative)
A `breached` attestation contributes nothing to the subject's rate until it is
`challenge_days` old (reference: 7 days). The window is the subject's opportunity to
dispute before damage lands. Cost: genuine breaches punish late. Accepted: a false
verdict that lands instantly is worse than a true one that lands in a week.

### 10.2 Dispute operation (v0.3, normative)
A first-class log object: the **subject** of an attestation MAY file a signed dispute
referencing the attestation id, with optional evidence hash. While an attestation is
disputed, its scoring weight is multiplied by `dispute_discount` (reference: 0.5).
Disputes are permanent log entries — the disagreement itself becomes part of both
parties' witnessed history, visible to any relying party. Resolution is not
adjudicated by the registry: it emerges from further attestations (counter-witnesses,
co-signed settlements), never from editing history.

### 10.3 Roadmap (v0.4, specified intent — not yet normative)
- **Filer stake:** filing a breach places a fraction of the filer's own rate at risk,
  released if the breach stands unchallenged, forfeited if contradicted by
  preponderant co-witnessed evidence (extends the witness-contradiction rule of §4.2).
- **Mutual-origination records:** obligations (loans, deals) SHOULD be registered as
  records co-signed by both parties at origination; a breach filed against a co-signed
  record carries full weight, a breach against an unacknowledged obligation is capped.
  Consent at origination is the difference between evidence and accusation.
- **Domain scoping:** rates computed per attestation domain (personal, commercial,
  operational), preventing context collapse where a personal grudge destroys a
  professional record.

### 10.4 The honest limit, restated
The protocol cannot make people less vindictive. It makes malice **attributable**
(signed), **costly** (staked, contradictable), **contestable** (disputed in the same
ledger, at parity), and **scoped** (bounded blast radius). The alternative — the
unsigned review, the whisper network, the unaccountable report — offers its targets
none of these. That is the bar, and the only one claimed.

## 11. Versioning

Spec versions are append-only; wire objects carry `spec: "VINC-0001/0.1"`. Breaking
changes require a new document number, never a silent edit. The spec obeys its own
physics.
