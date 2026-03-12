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
| **Test cases** | CT01–CT57 (57 test cases, 5 projects) |
| **CI trigger** | PR Gate on every pull request; Full Suite on push to `main` + daily cron |
| **PR Gate duration** | ~30 s |
| **Full Suite duration** | ~2–3 min |

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
│   │   └── payment-helpers.ts          # Shared: validPaymentPayload, uniqueKey,
│   │                                   #   createAndCapture, createAndReject,
│   │                                   #   setWebhookMode, sleep
│   ├── api/                            # Project: api (10 s timeout)
│   │   ├── payment-creation.spec.ts    # CT01–CT07
│   │   ├── payment-validation.spec.ts  # CT08–CT24
│   │   ├── payment-idempotency.spec.ts # CT25–CT30
│   │   └── payment-state-transitions.spec.ts  # CT31–CT40
│   ├── ledger/                         # Project: ledger (10 s timeout)
│   │   └── ledger.spec.ts              # CT45–CT52
│   ├── concurrency/                    # Project: concurrency (30 s timeout)
│   │   └── concurrent-requests.spec.ts # CT41–CT44
│   └── webhook/                        # Project: resilience (70 s timeout)
│       └── webhook-resilience.spec.ts  # CT53–CT57
├── playwright.config.ts                # 5 projects, per-project timeouts
├── package.json                        # npm scripts
├── .github/
│   └── workflows/
│       └── ci.yml                      # pr-gate + full-suite jobs
├── docs/
│   └── quality-strategy.md             # Risk matrix, metrics, 30-60-90 roadmap
└── examples/
    └── payment-request.json            # Sample request payload
```

---

## Test Coverage

### Test cases by area

| Range | Area | Count |
|---|---|---|
| CT01–CT07 | Payment creation — happy path + structural idempotency | 7 |
| CT08–CT24 | Input validation — amount, currency, split (17 edge cases) | 17 |
| CT25–CT30 | Idempotency deep-dive — triple replay, body comparison, case-sensitivity, conflict preservation | 6 |
| CT31–CT40 | State machine — all 6 transitions, both 404 paths, error contract, read-after-write | 10 |
| CT41–CT44 | Concurrency — same-key race, concurrent capture, keyless creates, ledger mutex | 4 |
| CT45–CT52 | Ledger consistency — response shape, entry count, debit/credit amounts, balance, 404 paths | 8 |
| CT53–CT57 | Webhook resilience — fire-and-forget timing, 500 transparency, retry exhaustion, reject no-webhook | 5 |

### Risk matrix coverage (top risks)

| Risk | Score | Covered by |
|---|---|---|
| Duplicate payment (missing idempotency key) | 9 | CT05, CT25–CT30 |
| Double capture → double ledger entry | 9 | CT33, CT42, CT44 |
| Invalid amount/currency accepted | 9 | CT02, CT08–CT12 |
| Split percentages ≠ 100 accepted | 9 | CT04, CT13–CT16, CT22 |
| Idempotency key reused with different payload | 6 | CT06, CT28, CT30 |
| Webhook failure causes capture rollback | 6 | CT54, CT55 |
| Race condition on concurrent captures → duplicate ledger rows | 6 | CT42, CT44 |

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
|---|---|---|---|
| `npm run test:api` | `api` | 10 s | Every PR — fast, deterministic |
| `npm run test:ledger` | `ledger` | 10 s | Every PR — ledger consistency |
| `npm run test:integration` | `integration` | 20 s | Every PR — multi-step flows |
| `npm run test:concurrency` | `concurrency` | 30 s | Post-merge |
| `npm run test:resilience` | `resilience` | 70 s | Post-merge — webhook retry (~22 s per test) |
| `npm test` | all | — | Post-merge / nightly |

### Examples

```bash
# Fast feedback during development
npm run test:api

# Validate concurrency guards
npm run test:concurrency

# Full webhook retry cycle (slow — ~22 s each)
npm run test:resilience
```

### Viewing the HTML report

```bash
npx playwright show-report
```

---

## CI/CD Pipeline

Two GitHub Actions jobs defined in [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

| Job | Trigger | Projects | Estimated time |
|---|---|---|---|
| `pr-gate` | Every pull request | `api` + `ledger` | ~30 s |
| `full-suite` | Push to `main` + daily cron (06:00 UTC) | All 5 projects | ~2–3 min |

### Pipeline strategy

- **PR Gate blocks merge on failure.** It covers all P0/P1 financial risks using only fast, deterministic tests.
- **Full Suite runs post-merge.** Slow tests (concurrency, webhook retry) add variance without improving signal on new PRs — they run where a failure triggers an alert but doesn't block a developer's day.
- In-progress runs for the same branch are automatically cancelled to save CI minutes.

### Artifacts

| Artifact | Uploaded when | Retention |
|---|---|---|
| `playwright-report-pr-gate` | Always | 7 days |
| `playwright-report-full-suite` | On failure | 14 days |
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
│   └── Requests/
│       └── CreatePaymentRequest.cs
├── Application/
│   ├── Ports/
│   │   ├── IIdempotencyStore.cs
│   │   └── IWebhookPort.cs
│   └── UseCases/
│       ├── CreatePayment/
│       ├── CapturePayment/
│       ├── RejectPayment/
│       ├── GetPayment/
│       └── GetLedger/
├── Domain/
│   ├── Common/        # Result
│   ├── Entities/      # Payment, LedgerEntry
│   ├── Events/        # PaymentCapturedEvent
│   ├── Repositories/  # IPaymentRepository, ILedgerRepository
│   └── ValueObjects/  # Money, SplitItem
└── Infrastructure/
    ├── Adapters/      # WebhookAdapter (fire-and-forget + retry)
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

### `firePost` helper in concurrency tests

Playwright's `APIResponse` body is tied to the lifetime of its `APIRequestContext`. Creating a new context per request (via `playwright.request.newContext()`), reading status + body inline, then disposing it avoids "Response has been disposed" errors that occur when contexts outlive their responses.

### Soft assertions on CT42

`Payment.Capture()` performs a non-atomic check-then-set on `Status`. Under concurrent load, more than one capture may succeed at the HTTP layer. CT42 asserts "all responses are 200 or 422, at least one 200" rather than "exactly one 200" — reflecting the actual guarantee. The hard guarantee (ledger written exactly once) is verified separately in CT44.

### Webhook tests require Docker

CT53–CT57 call `POST http://localhost:4000/control` to switch the webhook sink's failure mode. They cannot run without Docker. `beforeEach` always resets the mode to `ok` so a failure in one test never affects the next.

### Test isolation without a reset endpoint

The API stores all state in `ConcurrentDictionary` instances that live for the container's lifetime. There is no `/reset` endpoint. Isolation is achieved by generating unique identifiers (`uniqueKey()`) and creating new payments per test — keeping the API simple but requiring tests to be additive (never rely on clean state).

---

## Quality Strategy

The full quality strategy is documented in [`docs/quality-strategy.md`](docs/quality-strategy.md), covering:

- **CI/CD pipeline** — stage split rationale, fast-feedback targets, flakiness reduction techniques
- **Risk matrix** — 15 risks scored by Probability × Impact (1–9), each mapped to test cases
- **Coverage map** — CT01–CT57 grouped by area, with documented gaps
- **Technical decisions** — tool comparisons, trade-offs, soft vs. hard assertions
- **Incident investigation protocol** — MTTR reduction playbooks for duplicate charges and missing ledger entries
- **Quality metrics** — escaped bugs, MTTD, MTTR, flaky test rate, deploy frequency
- **30-60-90 day roadmap** — ledger tests, integration flows, contract tests, load testing with k6, mutation testing, chaos injection

### Key quality targets

| Metric | Target | Current |
|---|---|---|
| Test suite pass rate (main branch) | 100% | 100% |
| PR Gate duration | < 60 s | ~30 s |
| Full Suite duration | < 5 min | ~2–3 min |
| Critical-risk (score ≥ 6) coverage | 100% | 100% |
| Flaky test rate (last 30 runs) | < 2% | 0% |

### Assumptions

1. **API state is not reset between tests.** Tests use `uniqueKey()` and create new payments to avoid collisions.
2. **Idempotent replay returns HTTP 201 (not 200).** The controller has a single success path (`StatusCode(201, ...)`). The source code is authoritative over any informal documentation.
3. **`currency` is normalised to uppercase before validation.** The handler calls `command.Currency.ToUpperInvariant()`, so `"brl"` is accepted as valid. Tests for invalid currency use values that remain invalid after normalisation (`"EUR"`, `""`, `"BRL "`).
4. **Webhook delivery is fire-and-forget.** `CapturePaymentHandler` returns the HTTP response immediately and dispatches `SendWithRetryAsync` in a background `Task.Run`.
5. **The webhook sink has no history endpoint.** Webhook delivery is verified indirectly via timing and API health checks.
