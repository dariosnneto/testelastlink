# Mock Payments API — Quality Automation Suite

End-to-end automated test suite for the Mock Payments API, built with **Playwright** (TypeScript) and backed by a **GitHub Actions** CI/CD pipeline. The suite validates payment creation, input validation, idempotency, state transitions, ledger consistency, concurrency safety, and webhook resilience.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Test Coverage](#test-coverage)
- [Quickstart](#quickstart)
- [Running Tests](#running-tests)
- [CI/CD Pipeline](#cicd-pipeline)
- [Architecture Under Test](#architecture-under-test)
- [Key Design Decisions](#key-design-decisions)
- [Quality Strategy](#quality-strategy)

---

## Overview

| Attribute | Value |
|---|---|
| **Framework** | Playwright `^1.49.0` (API testing via `request` fixture) |
| **Language** | TypeScript |
| **API under test** | ASP.NET Core 8 — Clean Architecture + DDD |
| **Test cases** | 62 test cases across 4 Playwright projects |
| **CI trigger** | PR Gate on every pull request; Full Suite on push to `main` + daily cron |
| **PR Gate duration** | ~10 s |
| **Full Suite duration** | ~30 s (3 shards × 2 workers) |

---

## Tech Stack

| Tool | Role |
|---|---|
| [Playwright](https://playwright.dev) | Test runner, API client (`request` fixture), parallel project config, CI reporter |
| TypeScript | Test language (strict types, IDE autocomplete) |
| Docker + Docker Compose | API runtime + webhook sink (required for resilience tests) |
| GitHub Actions | CI/CD — two jobs: `pr-gate` and `full-suite` |
| ASP.NET Core 8 (C#) | The system under test |

---

## Project Structure

```
mock-payments-api/
├── tests/
│   ├── helpers/
│   │   └── payment-helpers.ts          # Interfaces: PaymentResponse, PaymentPayload,
│   │                                   #   SplitItem, LedgerEntry, WebhookMode
│   │                                   # Builders: validPaymentPayload, uniqueKey
│   │                                   # Helpers: createAndCapture, createAndReject,
│   │                                   #   createPending, setWebhookMode,
│   │                                   #   pollUntil, sleep
│   ├── api/                            # Project: api (10 s timeout)
│   │   ├── payment-creation.spec.ts    # CT01–CT07, CT58, CT59      (9 tests)
│   │   ├── payment-validation.spec.ts  # CT08–CT24, CT60, CT61     (19 tests)
│   │   ├── payment-idempotency.spec.ts # CT25–CT30, CT63            (7 tests)
│   │   └── payment-state-transitions.spec.ts  # CT31–CT38, CT40, CT62  (10 tests)
│   ├── ledger/                         # Project: ledger (10 s timeout)
│   │   └── ledger.spec.ts              # CT45–CT52                  (8 tests)
│   ├── concurrency/                    # Project: concurrency (15 s timeout)
│   │   └── concurrent-requests.spec.ts # CT41–CT44                  (4 tests)
│   └── webhook/                        # Project: resilience (25 s timeout)
│       └── webhook-resilience.spec.ts  # CT53–CT57                  (5 tests)
├── playwright.config.ts                # 4 projects, per-project timeouts
├── package.json                        # npm scripts
├── .github/
│   └── workflows/
│       └── ci.yml                      # pr-gate + full-suite jobs
├── docs/
│   ├── tests-spec.md                   # Test catalogue — all 62 CTs with detail
│   ├── quality-strategy.md             # Risk matrix, metrics, 30-60-90 roadmap
│   └── relatorio-revisao-suite-testes.md  # AGENTS guide compliance review
└── examples/
    └── payment-request.json            # Sample request payload
```

---

## Test Coverage

### Test cases by area

| Area | File | Tests | CTs |
|---|---|:---:|---|
| Payment creation — happy path + idempotency | `payment-creation.spec.ts` | 9 | CT01–CT07, CT58, CT59 |
| Input validation — amount, currency, split | `payment-validation.spec.ts` | 19 | CT08–CT24, CT60, CT61 |
| Idempotency deep-dive | `payment-idempotency.spec.ts` | 7 | CT25–CT30, CT63 |
| State machine — transitions + 404 + consistency | `payment-state-transitions.spec.ts` | 10 | CT31–CT38, CT40, CT62 |
| Concurrency — same-key race, ledger mutex | `concurrent-requests.spec.ts` | 4 | CT41–CT44 |
| Ledger consistency — shape, amounts, balance | `ledger.spec.ts` | 8 | CT45–CT52 |
| Webhook resilience — retry, timeout, health | `webhook-resilience.spec.ts` | 5 | CT53–CT57 |
| **Total** | | **62** | |


### Risk matrix coverage (top risks)

| Risk | Score | Covered by |
|---|:---:|---|
| Duplicate payment (missing idempotency key) | 9 | CT05, CT25–CT30, CT63 |
| Double capture → double ledger entry | 9 | CT33, CT42, CT44 |
| Invalid amount/currency accepted | 9 | CT02, CT08–CT12, CT60, CT61 |
| Split percentages ≠ 100 accepted → ledger imbalance | 9 | CT04, CT13–CT16, CT22 |
| Idempotency key reused with different payload | 6 | CT06, CT28, CT30 |
| Webhook failure causes capture rollback | 6 | CT54, CT55 |
| Race condition on concurrent captures → duplicate ledger rows | 6 | CT42, CT44 |
| Terminal state transition allowed | 6 | CT33–CT36 |
| Non-existent payment_id returns 200 instead of 404 | 2 | CT37, CT38, CT62 |
| Idempotency replay returns stale status | 2 | CT63 |

All critical-risk scenarios (score ≥ 6) have 100% automated coverage.

---

## Quickstart

### Prerequisites

- Node.js 22+
- Docker + Docker Compose

### Setup

```bash
# 1 — Start the API and webhook sink
docker compose up -d --wait

# 2 — Install test dependencies (first run only)
npm install

# 3 — Run the full suite
npm test
```

---

## Running Tests

### By project

| Command | Project | Timeout | When to use |
|---|---|:---:|---|
| `npm run test:api` | `api` | 10 s | Every PR — fast, deterministic (45 tests) |
| `npm run test:ledger` | `ledger` | 10 s | Every PR — ledger consistency (8 tests) |
| `npm run test:concurrency` | `concurrency` | 15 s | Post-merge — concurrent request safety |
| `npm run test:resilience` | `resilience` | 25 s | Post-merge — webhook retry cycle |
| `npm test` | all | — | Post-merge / nightly |

### Filter by tag

```bash
# Smoke tests only (fast pre-deploy validation)
npx playwright test --grep @smoke

# All critical financial-risk tests
npx playwright test --grep @critical

# Only idempotency tests
npx playwright test --grep @idempotency

# Only webhook tests
npx playwright test --grep @webhook
```

### Examples

```bash
# Fast feedback during development
npm run test:api

# Validate concurrency guards
npm run test:concurrency

# Full webhook retry cycle (~12 s for CT56)
npm run test:resilience
```

### Viewing the HTML report

```bash
npx playwright show-report
```

---

## CI/CD Pipeline

Two GitHub Actions jobs defined in [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

| Job | Trigger | Projects | Tests | Est. time |
|---|---|---|:---:|---|
| `pr-gate` | Every pull request | `api` + `ledger` | 53 | ~10 s |
| `full-suite` | Push to `main` + daily cron (06:00 UTC-3) | All 4 projects | 62 | ~30 s |

### Pipeline strategy

- **PR Gate blocks merge on failure.** It covers all P0/P1 financial risks using only fast, deterministic tests.
- **Full Suite runs post-merge.** Slow tests (concurrency, webhook retry) add variance without improving signal on new PRs — they run where a failure triggers an alert but doesn't block a developer's day.
- In-progress runs for the same branch are automatically cancelled to save CI minutes.

### Artifacts

| Artifact | Uploaded when | Retention |
|---|---|---|
| `playwright-report-pr-gate` | Always | 7 days |
| `playwright-report-full-suite` | Always | 14 days |
| `docker-logs-full-suite` | On failure | 14 days |

---

## Architecture Under Test

The system under test follows Clean Architecture with DDD building blocks.

```
MockPaymentsApi/
├── API/
│   ├── Controllers/
│   │   ├── PaymentsController.cs   # POST /payments, GET /payments/{id},
│   │   │                           # POST /payments/{id}/capture,
│   │   │                           # POST /payments/{id}/reject
│   │   └── LedgerController.cs     # GET /ledger/{id}
│   └── Dtos/                       # Request/response DTOs + mappers
├── Application/
│   ├── Ports/
│   │   ├── IIdempotencyStore.cs
│   │   └── IWebhookPort.cs
│   └── UseCases/
│       ├── CreatePayment/          # Handler + Validator + IdempotencyGuard
│       ├── CapturePayment/
│       ├── RejectPayment/
│       ├── GetPayment/
│       └── GetLedger/
├── Domain/
│   ├── Common/        # UseCaseResponse
│   ├── Entities/      # Payment, LedgerEntry
│   ├── Events/        # PaymentCapturedEvent
│   ├── Repositories/  # IPaymentRepository, ILedgerRepository
│   └── ValueObjects/  # Money, SplitItem
└── Infrastructure/
    ├── Adapters/      # WebhookAdapter (fire-and-forget + 4-attempt retry)
    └── Persistence/   # InMemoryPaymentRepository, InMemoryLedgerRepository,
                       # InMemoryIdempotencyStore
```

### API endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/payments` | Create a payment (supports `Idempotency-Key` header) |
| `GET` | `/payments/{id}` | Get payment by ID |
| `POST` | `/payments/{id}/capture` | Capture a pending payment |
| `POST` | `/payments/{id}/reject` | Reject a pending payment |
| `GET` | `/ledger/{id}` | Get ledger entries for a payment |

---

## Key Design Decisions

### Why Playwright for API testing?

The `request` fixture provides a typed `APIRequestContext` with built-in parallelism hooks, a familiar assertion API (`expect`), native CI reporters, and the ability to grow into E2E tests later — all without requiring browser installation or a separate HTTP client library.

### `uniqueKey()` on every idempotency test

The API stores idempotency keys in an in-memory `ConcurrentDictionary` that is never cleared between requests (no per-test isolation at the server level). Using `timestamp + random` suffixes guarantees each test run operates on a fresh key space without needing to restart the server.

### Fail-fast assertions in shared helpers

`createAndCapture`, `createAndReject`, and `createPending` all assert the expected HTTP status code immediately after each network call. Without this, a bug in test setup (e.g. create returning 400) would propagate as a confusing `Cannot read properties of undefined` error three lines later, masking the real cause.

### `firePost` helper in concurrency tests

Playwright's `APIResponse` body is tied to the lifetime of its `APIRequestContext`. Creating a new context per request (via `playwright.request.newContext()`), reading status + body inline, then disposing it avoids "Response has been disposed" errors that occur when contexts outlive their responses.

### Soft assertions on CT42

`Payment.Capture()` performs a non-atomic check-then-set on `Status`. Under concurrent load, more than one capture may succeed at the HTTP layer. CT42 asserts "all responses are 200 or 422, at least one 200" rather than "exactly one 200" — reflecting the actual guarantee. The hard guarantee (ledger written exactly once) is verified separately in CT44.

### Webhook tests require Docker

CT53–CT57 call `POST http://localhost:4000/control` to switch the webhook sink's failure mode. They cannot run without Docker. `beforeEach` resets the mode to `ok` before each test; `afterEach` resets it again afterwards — providing symmetric cleanup even when a test throws, preventing mode contamination across tests.

### Test isolation without a reset endpoint

The API stores all state in `ConcurrentDictionary` instances that live for the container's lifetime. There is no `/reset` endpoint. Isolation is achieved by generating unique identifiers (`uniqueKey()`) and creating new payments per test — keeping the API simple but requiring tests to be additive (never rely on clean state).

### Hard-coded expected values in ledger tests (CT48)

CT48 asserts `seller_1 → 8000` and `platform → 2000` as literals, not as `Math.round((amount * percentage) / 100)`. Recomputing the server's formula in the test is the Mirror anti-pattern — a bug in the formula would pass undetected. Hard-coded values derived from the business rule ("80% of 10 000 = 8 000") are the correct approach.

---

## Quality Strategy

Full documentation in [`docs/quality-strategy.md`](docs/quality-strategy.md) and [`docs/tests-spec.md`](docs/tests-spec.md).

### Key quality targets

| Metric | Target | Current |
|---|---|---|
| Test suite pass rate (main branch) | 100% | 100% |
| PR Gate duration | < 60 s | ~10 s |
| Full Suite duration | < 5 min | ~30 s |
| Critical-risk (score ≥ 6) coverage | 100% | 100% |
| Flaky test rate (last 30 runs) | < 2% | 0% |
| Total test cases | — | **62** |

### Assumptions

1. **API state is not reset between tests.** Tests use `uniqueKey()` and create new payments to avoid collisions.
2. **Idempotent replay returns HTTP 201 (not 200).** The controller has a single success path (`StatusCode(201, ...)`). The source code is authoritative over any informal documentation.
3. **`currency` is normalised to uppercase before validation.** The handler calls `command.Currency.ToUpperInvariant()`, so `"brl"` is accepted as valid. Tests for invalid currency use values that remain invalid after normalisation (`"EUR"`, `""`, `"BRL "`).
4. **Webhook delivery is fire-and-forget.** `CapturePaymentHandler` returns the HTTP response immediately and dispatches `SendWithRetryAsync` in a background `Task.Run`.
5. **The webhook sink has no history endpoint.** Webhook delivery is verified indirectly via timing and API health checks.
