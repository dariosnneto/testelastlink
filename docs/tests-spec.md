# Test Specifications

## Overview

| Category | File | Test Cases |
|---|---|---|
| Payment Creation | `tests/api/payment-creation.spec.ts` | CT01–CT07 |
| Payment Validation | `tests/api/payment-validation.spec.ts` | CT08–CT24 |
| Payment Idempotency | `tests/api/payment-idempotency.spec.ts` | CT25–CT30 |
| Payment State Transitions | `tests/api/payment-state-transitions.spec.ts` | CT31–CT40 |
| Concurrency | `tests/concurrency/concurrent-requests.spec.ts` | CT41–CT44 |
| Ledger | `tests/ledger/ledger.spec.ts` | CT45–CT52 |
| Webhook Resilience | `tests/webhook/webhook-resilience.spec.ts` | CT53–CT57 |

---

## Payment Creation — `tests/api/payment-creation.spec.ts`

| ID | Description | Expected |
|---|---|---|
| CT01 | Valid payment | `201` with correct response shape |
| CT02 | Amount = `0` | `400` |
| CT03 | Currency != `BRL` | `400` |
| CT04 | Split percentages sum != `100` | `400` |
| CT05 | Same `Idempotency-Key` + same payload | `201` with original payment |
| CT06 | Same `Idempotency-Key` + different payload | `409` |
| CT07 | Missing `Idempotency-Key` | New payment on every request |

---

## Payment Validation — `tests/api/payment-validation.spec.ts`

| ID | Description | Expected |
|---|---|---|
| CT08 | Amount = `-1` | `400` |
| CT09 | Amount = `-10000` | `400` |
| CT10 | Currency = `""` | `400` |
| CT11 | Currency = `"EUR"` | `400` |
| CT12 | Currency = `"BRL "` (trailing space) | `400` |
| CT13 | Empty split array (sum = 0) | `400` |
| CT14 | Single split item at 50% (sum = 50) | `400` |
| CT15 | Split percentages sum to 99 | `400` |
| CT16 | Split percentages sum to 101 | `400` |
| CT17 | Split item percentage = `0` | `400` |
| CT18 | Split item percentage = `-1` | `400` |
| CT19 | Split item percentage = `101` | `400` |
| CT20 | Split item recipient = `""` | `400` |
| CT21 | Split item recipient = whitespace | `400` |
| CT22 | 0% item with remaining items summing to 100 | `400` |
| CT23 | Empty body `{}` | `400` |
| CT24 | Body without `split` field (defaults to `[]`, sum = 0) | `400` |

---

## Payment Idempotency — `tests/api/payment-idempotency.spec.ts`

| ID | Description | Expected |
|---|---|---|
| CT25 | Three requests with same key + payload | All return the same `payment_id` |
| CT26 | Idempotent replay | Identical `amount`, `currency`, `split`, `status`, `created_at` |
| CT27 | Different `Idempotency-Key`s with same payload | Different `payment_id`s |
| CT28 | Conflict attempt does not corrupt the key | Original payload still replays correctly |
| CT29 | `Idempotency-Key` is case-sensitive (`KEY-X` ≠ `key-x`) | Treated as different keys |
| CT30 | Same key + different `customer_id` | `409` (hash covers all fields) |

---

## Payment State Transitions — `tests/api/payment-state-transitions.spec.ts`

| ID | Description | Expected |
|---|---|---|
| CT31 | Capture a `PENDING` payment | `200`, status = `APPROVED` |
| CT32 | Reject a `PENDING` payment | `200`, status = `FAILED` |
| CT33 | Capture an already-`APPROVED` payment | `422` |
| CT34 | Reject an `APPROVED` payment | `422` |
| CT35 | Reject an already-`FAILED` payment | `422` |
| CT36 | Capture a `FAILED` payment | `422` |
| CT37 | Capture a non-existent `payment_id` | `404` |
| CT38 | Reject a non-existent `payment_id` | `404` |
| CT39 | `422` error message names the current status | Message contains `"already APPROVED"` or `"already FAILED"` |
| CT40 | `GET /payments/{id}` after capture | `status = APPROVED` |

---

## Concurrency — `tests/concurrency/concurrent-requests.spec.ts`

| ID | Description | Expected |
|---|---|---|
| CT41 | Concurrent creates with same `Idempotency-Key` | All return the same `payment_id` |
| CT42 | Concurrent captures on the same payment | Only `200`/`422` responses; at least one `200` |
| CT43 | Concurrent creates without `Idempotency-Key` | All return unique `payment_id`s |
| CT44 | Ledger after concurrent captures | Exactly 3 entries (no duplicates) |

---

## Ledger — `tests/ledger/ledger.spec.ts`

| ID | Description | Expected |
|---|---|---|
| CT45 | Captured payment | `200` with `payment_id` and `entries` array |
| CT46 | Entry count | 1 debit + 1 credit per split item |
| CT47 | Debit entry | Correct `type`, `account`, and full payment amount |
| CT48 | Credit entries | Match recipients and computed amounts |
| CT49 | Sum of credit amounts | Equals the debit amount |
| CT50 | Unknown `payment_id` | `404` |
| CT51 | `PENDING` payment | `404` (no ledger entries) |
| CT52 | Rejected payment | `404` (no ledger entries) |

---

## Webhook Resilience — `tests/webhook/webhook-resilience.spec.ts`

> These tests are intentionally slow (~15–20 s each for CT56) as they exercise the actual retry backoff schedule: 1 s → 3 s → 5 s across 4 attempts.

| ID | Description | Expected |
|---|---|---|
| CT53 | Capture fires webhook and returns immediately (`mode=ok`) | `200` |
| CT54 | Webhook returns `500` | Capture still returns `200 APPROVED` |
| CT55 | Webhook sink delays 10 s (`mode=timeout`) | Capture returns quickly |
| CT56 | After all webhook retries exhausted (`mode=500`) | API remains fully operational |
| CT57 | Reject in timeout mode | Returns immediately; webhook is not called |
