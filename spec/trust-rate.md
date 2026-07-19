# The Trust Rate

**Status:** v0.1 draft · normative for VINC-0001 §6 · parameters provisional (Gate G2)

## 1. The claim

Trust is a rate, not a state. It is the observable consistency of an entity's witnessed
behaviour over time. This document turns that sentence into a deterministic function any
verifier can compute from a public witness log and nothing else.

Design requirements, fixed before the math:

- **R1 — Trust builds slowly.** The only way to a high rate is sustained consistency.
  Time itself is the cost of forgery.
- **R2 — Trust craters instantly.** A breach must cost far more than a fulfillment earns.
- **R3 — Trust rebuilds slowly.** Breach memory must outlast fulfillment memory by an
  order of magnitude. Trust arrives on foot and leaves on horseback; the function must
  price the return trip.
- **R4 — Tenure cannot be bought.** A new identity, however well-behaved, is capped low.
  No stockpiling aged identities: the clock starts at first *witnessed* act, not registration.
- **R5 — Deterministic and verifiable.** Same log, same time, same parameters → same rate,
  computed by anyone. No oracle, no arbitration, no reputation committee.
- **R6 — Bounded.** R ∈ [0, 1). Certainty is unreachable by construction.
- **R7 — Trust cannot be banked.** A rate is consistency *maintained*, not accumulated.
  Dormancy decays the rate; no entity coasts on history. (Added v0.2 after the
  dormancy-inflation flaw was exposed by the reference implementation's own trajectory
  plot: under v0.1, a burst of activity followed by silence inflated toward 1 on pure
  calendar time.)

## 2. Inputs

For subject entity *s* at evaluation time *t*, take every attestation in the log where
*s* is subject, each carrying: timestamp *tᵢ*, weight *wᵢ* > 0 (economic/criticality
weight, declared by attestation type), and outcome ∈ {fulfilled, breached, neutral}.
Neutral events (registrations, informational witnessing) carry log presence but no score.

## 3. The function

**Effective fulfillment mass** (recency-weighted, half-life H_f):

    F(t) = Σ over fulfilled i of:  wᵢ · 2^(−(t − tᵢ)/H_f)

**Effective breach mass** (recency-weighted, half-life H_b ≫ H_f):

    B(t) = Σ over breached j of:  wⱼ · 2^(−(t − tⱼ)/H_b)

**Consistency** (breaches amplified by k):

    C(t) = F(t) / (F(t) + k·B(t) + ε)

**Tenure** (a = time since first witnessed attestation):

    T(t) = 1 − e^(−a/τ)

**Freshness** (Δ = time since most recent scored attestation):

    Fr(t) = 2^(−Δ/H_r)

**Trust rate:**

    R(t) = C(t) · T(t) · Fr(t)

An entity with no witnessed history has R = 0. Exactly zero, exactly by R4.
An entity that stops being witnessed decays toward 0 with half-life H_r, by R7.

## 4. Parameters (v0 — provisional until Gate G2)

| Param | v0 value | Meaning |
|-------|----------|---------|
| H_f | 180 days | Fulfillment memory half-life. Consistency must be maintained, not banked. |
| H_b | 1460 days | Breach memory half-life. A breach is ~8× more durable than a fulfillment. |
| k | 8 | Breach amplifier. One breach cancels ~8 equal-weight recent fulfillments. |
| τ | 365 days | Tenure constant. One year of witnessed presence → T ≈ 0.63; three years → T ≈ 0.95. |
| H_r | 90 days | Freshness half-life. Three months of silence halves the rate ×0.5... continued silence → 0. Domain profiles may lengthen this for entity classes with legitimately sparse cadence (humans) and shorten it for agents. |
| ε | 10⁻⁹ | Division guard. |

Parameters are versioned in the log (`params_version`); a verifier always knows which
profile produced a published rate. Different deployment domains MAY register different
profiles (an electrical-compliance registry and an agent-payments registry price time
differently), but a profile is immutable once registered.

## 5. Behaviour — worked example

Agent registers day 0, first witnessed attestation day 1, then one fulfilled attestation
(w = 1) per day throughout. One breach at day 731, weight 50 (weight scales with harm; a
serious failure is not priced like a routine task). Values computed by the reference
implementation (`node ref/test.js`, scenario 11) — the code, not this table, is normative.

| Day | R(t) | |
|-----|------|---|
| 30 | 0.076 | New. Nearly untrusted regardless of perfect behaviour (R1, R4). |
| 180 | 0.388 | Half a year of daily consistency. |
| 365 | 0.631 | Tenure factor now dominates; consistency is saturated. |
| 730 | 0.864 | Two years. |
| 731 | **0.327** | The breach. 62% of a two-year rate gone in one event (R2). |
| 1095 | 0.411 | A year of flawless daily work later — barely a third of the way back (R3). |
| 1825 | 0.519 | Three years of penance: still below its own day-365 self. |
| 2191 | 0.564 | Four years post-breach: memory has faded, not vanished. |

The asymmetry is the security property: an adversary must spend real calendar time
behaving consistently to obtain a rate worth abusing, and abusing it destroys, in one
event, more than the abuse can typically capture. Cost to breach increases with time —
now as a theorem of the function, not a slogan.

## 6. What the rate is not

Not a probability, a credit score, or a moral judgment. It is a compression of one
question: *how consistent has this entity's witnessed behaviour been, over how long?*
Interpretation and thresholds belong to the relying party, never to the registry.
The registry publishes logs; the math is public; no human arbitrates a rate.

## 7. Known attacks and stances

- **Sybil farming** — mitigated by R4 (tenure from first witnessed act) plus witness
  weight: attestations witnessed by low-rate entities carry discounted weight
  (w′ = w · max(R_witness, R_floor); v0 R_floor = 0.1). Full recursive treatment in VINC-0001 §9.
- **Selective disclosure** — subjects cannot prune their own history: logs are
  append-only and checkpointed; a verifier detects gaps by chain inspection.
- **Outcome corruption** (witnesses lie) — witnesses are themselves rated entities whose
  false attestations, once contradicted by other witnesses, are breaches on *their* log.
  Lying is priced in the same currency.
- **Parameter gaming** — profiles are immutable and version-pinned; shopping for a
  friendlier profile is visible in the verification response.
- **Dormancy banking** (closed in v0.2) — burst activity followed by silence no longer
  inflates with tenure; the freshness factor decays dormant entities toward 0.
  Residual: minimal-cadence maintenance (one attestation per H_r) keeps Fr high at low
  cost, but each maintenance attestation still requires a rated witness staking its own
  rate, and low evidence mass keeps such an entity's weight ceiling low. Accepted for
  v0, revisit at calibration (Gate G2).
