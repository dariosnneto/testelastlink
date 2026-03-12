# Test Specifications

## Overview

| Category | File | Tests | CTs |
|---|---|:---:|---|
| Payment Creation | `tests/api/payment-creation.spec.ts` | 9 | CT01–CT07, CT58, CT59 |
| Payment Validation | `tests/api/payment-validation.spec.ts` | 19 | CT08–CT24, CT60, CT61 |
| Payment Idempotency | `tests/api/payment-idempotency.spec.ts` | 7 | CT25–CT30, CT63 |
| Payment State Transitions | `tests/api/payment-state-transitions.spec.ts` | 10 | CT31–CT38, CT40, CT62 |
| Concurrency | `tests/concurrency/concurrent-requests.spec.ts` | 4 | CT41–CT44 |
| Ledger | `tests/ledger/ledger.spec.ts` | 8 | CT45–CT52 |
| Webhook Resilience | `tests/webhook/webhook-resilience.spec.ts` | 5 | CT53–CT57 |
| **Total** | | **62** | |

> CT39 was removed — 100% redundant with CT33–CT36 and violated the one-Act-per-test rule.

---

## Tag reference

| Tag | Meaning | Used in |
|---|---|---|
| `@smoke` | Must pass before any deployment | CT01, CT31, CT45, CT53 |
| `@critical` | P0/P1 financial risk — failure blocks release | CT06, CT30, CT33–CT36, CT42, CT44, CT47–CT49, CT54–CT55 |
| `@api` | Tests an API endpoint directly | All `tests/api/` tests |
| `@validation` | Input validation test | CT02–CT04, CT08–CT24, CT58, CT60–CT61 |
| `@idempotency` | Idempotency behaviour | CT05–CT06, CT25–CT30, CT41, CT63 |
| `@state-machine` | Payment state transition | CT31–CT38, CT40, CT62 |
| `@ledger` | Ledger endpoint | CT44–CT52 |
| `@webhook` | Webhook delivery or resilience | CT53–CT57 |
| `@resilience` | Retry, timeout, or failure-mode | CT54–CT57 |
| `@concurrency` | Concurrent-request test | CT41–CT44 |

---

## Payment Creation — `tests/api/payment-creation.spec.ts`

| ID | Description | Expected | Tags |
|---|---|---|---|
| CT01 | Valid payload | `201` with `payment_id`, `status=PENDING`, all fields | `@smoke` `@critical` |
| CT02 | `amount = 0` | `400` — `"Amount must be greater than 0"` | `@validation` |
| CT03 | `currency = "USD"` | `400` — `"Currency must be BRL"` | `@validation` |
| CT04 | Split percentages sum ≠ 100 | `400` — `"Split percentages must sum to 100"` | `@validation` |
| CT05 | Same `Idempotency-Key` + same payload (replay) | `201` — same `payment_id` | `@idempotency` |
| CT06 | Same `Idempotency-Key` + different payload | `409` — `"Idempotency key already used with a different payload"` | `@idempotency` `@critical` |
| CT07 | No `Idempotency-Key` | `201` with a new `payment_id` on every call | `@creation` |
| CT58 | `currency = "brl"` (lowercase) | `201` — response `currency` normalised to `"BRL"` | `@validation` |
| CT59 | Valid payload | `201` — `Content-Type: application/json` header present | `@creation` |

### Response shape contract (CT01)

```
{
  "payment_id": "pay_<32 hex chars>",
  "status":     "PENDING",
  "amount":     <integer>,
  "currency":   "BRL",
  "customer_id": <string>,
  "merchant_id": <string>,
  "split": [{ "recipient": <string>, "percentage": <integer> }],
  "created_at": <ISO-8601 timestamp>
}
```

---

## Payment Validation — `tests/api/payment-validation.spec.ts`

All validation failures return `400` with `{ "error": "<message>" }`.

### Amount

| ID | Input | Error message |
|---|---|---|
| CT08 | `amount = -1` | `"Amount must be greater than 0"` |
| CT09 | `amount = -10000` | `"Amount must be greater than 0"` |
| CT60 | `amount = 1` *(minimum valid boundary)* | `201` — accepted |
| CT61 | `amount = Number.MAX_SAFE_INTEGER` | `201` — accepted (fits C# `long`) |

### Currency

| ID | Input | Error message |
|---|---|---|
| CT10 | `currency = ""` | `"Currency must be BRL"` |
| CT11 | `currency = "EUR"` | `"Currency must be BRL"` |
| CT12 | `currency = "BRL "` *(trailing space)* | `"Currency must be BRL"` |

> `ToUpperInvariant()` is applied before validation, so `"brl"` → `"BRL"` (passes). `"BRL "` contains a space after normalisation and therefore fails.

### Split — sum

| ID | Input | Error message |
|---|---|---|
| CT13 | `split = []` (sum = 0) | `"Split percentages must sum to 100"` |
| CT14 | Single item at 50% (sum = 50) | `"Split percentages must sum to 100"` |
| CT15 | Two items summing to 99 | `"Split percentages must sum to 100"` |
| CT16 | Two items summing to 101 | `"Split percentages must sum to 100"` |

### Split — per-item percentage

| ID | Input | Error message |
|---|---|---|
| CT17 | Item `percentage = 0` | `"Percentage must be between 1 and 100"` |
| CT18 | Item `percentage = -1` | `"Percentage must be between 1 and 100"` |
| CT19 | Item `percentage = 101` | `"Percentage must be between 1 and 100"` |

### Split — per-item recipient

| ID | Input | Error message |
|---|---|---|
| CT20 | Item `recipient = ""` | `"Recipient is required"` |
| CT21 | Item `recipient = "   "` *(whitespace)* | `"Recipient is required"` |

### Cross-field / structural

| ID | Input | Error message |
|---|---|---|
| CT22 | 0% item + remaining sum to 100 | `"Percentage must be between 1 and 100"` (item check precedes sum check) |
| CT23 | Empty body `{}` | `"Amount must be greater than 0"` (`amount` defaults to 0) |
| CT24 | Body without `split` field | `"Split percentages must sum to 100"` (`split` defaults to `[]`) |

---

## Payment Idempotency — `tests/api/payment-idempotency.spec.ts`

| ID | Description | Expected |
|---|---|---|
| CT25 | Three requests with same key + payload | All three return `201` and the same `payment_id` |
| CT26 | Replay returns identical full response | Same `amount`, `currency`, `customer_id`, `merchant_id`, `split`, `status`, `created_at` |
| CT27 | Different keys + same payload | `201` with distinct `payment_id`s |
| CT28 | Conflict attempt does not corrupt the key | 1. `201` (original) → 2. `409` (conflict) → 3. `201` (original replays correctly) |
| CT29 | Key is case-sensitive | `KEY-X` and `key-x` are independent keys; produce different payments |
| CT30 | Same key + different `customer_id` | `409` — `"Idempotency key already used with a different payload"` |
| CT63 | Replay after capture | `201` — response shows live status `APPROVED` (store caches `payment_id`, not a snapshot) |

### Idempotency hash coverage

The conflict detection hash covers **all payload fields**: `amount`, `currency`, `customer_id`, `merchant_id`, and every field of every `split` item. Changing any single field with the same key returns `409`.

---

## Payment State Transitions — `tests/api/payment-state-transitions.spec.ts`

### Valid transitions

| ID | From | Action | Expected |
|---|---|---|---|
| CT31 | `PENDING` | capture | `200`, `status = APPROVED` |
| CT32 | `PENDING` | reject | `200`, `status = FAILED` |

### Invalid transitions — 422 (parametrised, CT33–CT36)

| ID | From | Action | Error message |
|---|---|---|---|
| CT33 | `APPROVED` | capture | `422` — `"already APPROVED"` |
| CT34 | `APPROVED` | reject | `422` — `"already APPROVED"` |
| CT35 | `FAILED` | reject | `422` — `"already FAILED"` |
| CT36 | `FAILED` | capture | `422` — `"already FAILED"` |

> CT33–CT36 are implemented as a single parametrised loop over an `invalidTransitions` array; they are counted as four separate test cases in the reporter.

### Not-found paths

| ID | Action | Expected |
|---|---|---|
| CT37 | capture `pay_doesnotexist` | `404` — `"not found"` |
| CT38 | reject `pay_doesnotexist` | `404` — `"not found"` |
| CT62 | GET `pay_00000000000000000000000000000000` | `404` — `"not found"` |

### Read-after-write consistency

| ID | Sequence | Expected |
|---|---|---|
| CT40 | Create → capture (Arrange) → `GET /payments/{id}` (Act) | `200`, `status = APPROVED` |

### State machine diagram

```
              capture → APPROVED ─┐
PENDING ─ ──┤                    ├── any further transition → 422
              reject  → FAILED  ─┘
```

---

## Concurrency — `tests/concurrency/concurrent-requests.spec.ts`

All tests fire 10 requests in parallel via `Promise.all()`, each from an independent `APIRequestContext`.

| ID | Scenario | Invariant asserted |
|---|---|---|
| CT41 | 10 concurrent POSTs, same `Idempotency-Key` | All `201`; all share exactly one `payment_id` |
| CT42 | 10 concurrent captures on the same `PENDING` payment | All responses `200` or `422`; no `5xx`; at least one `200` |
| CT43 | 10 concurrent POSTs, no `Idempotency-Key` | All `201`; all 10 `payment_id`s are distinct |
| CT44 | 10 concurrent captures, then read ledger | Exactly 3 entries (1 debit + 2 credits); amounts `10000`, `8000`, `2000` |

> CT42 does **not** assert "exactly one 200" because `Payment.Capture()` is not atomically guarded at entity level — that is a known implementation detail. The hard ledger-uniqueness guarantee is covered by CT44 (`SemaphoreSlim` per `paymentId`).

---

## Ledger — `tests/ledger/ledger.spec.ts`

Endpoint: `GET /ledger/{payment_id}`

Response shape:
```json
{
  "payment_id": "pay_...",
  "entries": [
    { "type": "debit",  "account": "customer",  "amount": 10000 },
    { "type": "credit", "account": "seller_1",  "amount": 8000  },
    { "type": "credit", "account": "platform",  "amount": 2000  }
  ]
}
```

| ID | Description | Expected |
|---|---|---|
| CT45 | Captured payment | `200` — `payment_id` and non-empty `entries` array |
| CT46 | Entry count | `1 + split.length` entries (1 debit + 1 credit per split recipient) |
| CT47 | Debit entry | `type="debit"`, `account="customer"`, `amount=` full payment amount |
| CT48 | Credit entries | `seller_1` → `8000`; `platform` → `2000` (hard-coded business values, not recomputed) |
| CT49 | Accounting balance | Sum of all credit amounts = debit amount |
| CT50 | Unknown `payment_id` | `404` with non-empty `error` string |
| CT51 | `PENDING` payment | `404` — ledger entries written only on capture |
| CT52 | Rejected payment | `404` — reject never writes ledger entries |

### Business rule — ledger write

Ledger is written **only** when a payment transitions to `APPROVED` (capture). Reject never writes. Concurrent captures are guarded by `SemaphoreSlim(1,1)` per `payment_id` to prevent duplicate entries (verified by CT44).

---

## Webhook Resilience — `tests/webhook/webhook-resilience.spec.ts`

The webhook sink (`http://localhost:4000`) supports three modes, controlled via `POST /control { "mode": "ok"|"500"|"timeout" }`.

### Retry schedule (WebhookAdapter)

| Attempt | Delay before attempt | Cumulative elapsed |
|---|---|---|
| 1 (immediate) | — | 0 s |
| 2 | +1 s | ~1 s |
| 3 | +3 s | ~4 s |
| 4 | +5 s | ~9 s |

A `beforeEach` and `afterEach` reset the sink to `mode=ok` around every test.

| ID | Mode | Description | Expected |
|---|---|---|---|
| CT53 | `ok` | Capture fires webhook | `200 APPROVED` in < 2 s (fire-and-forget) |
| CT54 | `500` | Webhook returns 500 | Capture still `200 APPROVED`; retry loop runs silently |
| CT55 | `timeout` | Sink sleeps 10 s | Capture returns in < 5 s (non-blocking) |
| CT56 | `500` | All 4 retries exhausted (wait 12 s) | API fully operational afterwards (`test.slow()`, effective timeout 75 s) |
| CT57 | `timeout` | Reject with 10 s sink | Returns in < 2 s (reject never calls webhook) |
