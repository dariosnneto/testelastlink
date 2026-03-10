## Running the test suite

### Prerequisites

- Node.js 18+
- Docker + Docker Compose (to run the API)

### Quickstart

```bash
# 1 — Start the API (includes webhook sink)
docker compose up -d --wait

# 2 — Install test dependencies (first time only)
npm install

# 3 — Run the full suite
npm test
```

### Run by project

| Command | Project | Timeout | When to use |
|---|---|---|---|
| `npm run test:api` | `api` | 10 s | Every PR (fast, deterministic) |
| `npm run test:ledger` | `ledger` | 10 s | Every PR (ledger consistency) |
| `npm run test:integration` | `integration` | 20 s | Every PR (multi-step flows) |
| `npm run test:concurrency` | `concurrency` | 30 s | Post-merge |
| `npm run test:resilience` | `resilience` | 60 s | Post-merge (webhook retry, ~22 s per run) |
| `npm test` | all | — | Post-merge / nightly |

```bash
# Individual project examples
npm run test:api
npm run test:concurrency
npm run test:resilience    # slow — runs webhook retry cycle (~22 s)
```

### Test structure

```
tests/
├── helpers/
│   └── payment-helpers.ts      # shared: validPaymentPayload, uniqueKey,
│                               #         createAndCapture, createAndReject,
│                               #         setWebhookMode, sleep
├── api/                        # project: api (10 s timeout)
│   ├── payment-creation.spec.ts       # CT01–CT07
│   ├── payment-validation.spec.ts     # CT08–CT24
│   ├── payment-idempotency.spec.ts    # CT25–CT30
│   └── payment-state-transitions.spec.ts  # CT31–CT40
├── ledger/                     # project: ledger (10 s timeout)  [Step 6]
├── integration/                # project: integration (20 s timeout)  [future]
├── concurrency/                # project: concurrency (30 s timeout)
│   └── concurrent-requests.spec.ts   # CT41–CT44
└── webhook/                    # project: resilience (60 s timeout)
    └── webhook-resilience.spec.ts    # CT53–CT57
```

### CI pipeline

Two GitHub Actions jobs in [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

| Job | Trigger | Projects | Est. time |
|---|---|---|---|
| `pr-gate` | pull_request | `api` + `ledger` | ~30 s |
| `full-suite` | push to `main` + daily cron | all | ~2-3 min |

### Technical decisions and trade-offs

**Why Playwright for API testing?**
The `request` fixture provides a clean, typed `APIRequestContext` with built-in parallelism hooks, a familiar assertion API (`expect`), and native CI reporters — all without requiring a separate HTTP client library. No browser installation is needed for API-only tests.

**Why `uniqueKey()` on every idempotency test?**
The API stores idempotency keys in an in-memory `ConcurrentDictionary` that is never cleared between requests (no per-test isolation at the server level). Using `timestamp + random` suffixes guarantees each test run operates on a fresh key space without needing to restart the server.

**`firePost` helper in concurrency tests**
Playwright's `APIResponse` body is tied to the lifetime of its `APIRequestContext`. Creating a new context per request (via `playwright.request.newContext()`), reading status + body inline, then disposing the context avoids "Response has been disposed" errors that occur when contexts outlive their responses.

**Concurrency assertions are intentionally soft**
`Payment.Capture()` in the domain entity performs a non-atomic read-modify-write on `Status`. Under concurrent load, multiple captures can succeed at the HTTP layer. CT42 asserts "all responses are 200 or 422, at least one 200" rather than "exactly one 200" — reflecting the actual guarantee. The hard guarantee (ledger written exactly once) is verified separately in CT44.

**Webhook tests require the Docker sink**
CT53–CT57 call `POST http://localhost:4000/control` to switch the webhook sink's failure mode. They cannot run without Docker. `beforeEach` always resets the mode to `ok` so failures in one test never affect the next.

### Assumptions

1. **API state is not reset between tests.** The in-memory repositories persist for the entire Docker container lifetime. Tests use `uniqueKey()` and create new payments to avoid collisions.
2. **Idempotent replay returns HTTP 201 (not 200).** The controller has a single success path (`StatusCode(201, ...)`). The README says "HTTP 200" but the source code is authoritative.
3. **`currency` is normalised to uppercase before validation.** The handler calls `command.Currency.ToUpperInvariant()`, so `"brl"` is accepted as valid. Tests for invalid currency use values that remain invalid after normalisation (`"EUR"`, `""`, `"BRL "`).
4. **Webhook delivery is fire-and-forget.** `CapturePaymentHandler` returns the HTTP response immediately and dispatches `SendWithRetryAsync` in a background `Task.Run`. Capture timing tests (CT55) rely on this.
5. **The webhook sink has no "history" endpoint.** There is no way to query how many webhooks the sink received. Webhook delivery is verified indirectly via timing (capture returns fast despite sink delay) and API health (server survives exhausted retries).

---

## Testing areas covered

| Area | How |
|---|---|
| API automation | All endpoints have deterministic responses |
| Idempotency | `Idempotency-Key` header on POST /payments |
| Concurrency | Ledger writes are mutex-protected — safe to hammer |
| Ledger consistency | Entries are written once and never duplicated |
| Webhook retry logic | Captured payments trigger webhook with 1s/3s/5s backoff |

---

## Architecture

Clean Architecture with DDD building blocks.

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
├── Infrastructure/
│   ├── Adapters/      # WebhookAdapter (fire-and-forget + retry)
│   └── Persistence/   # InMemoryPaymentRepository, InMemoryLedgerRepository,
│                      # InMemoryIdempotencyStore
├── examples/
│   └── payment-request.json
├── Program.cs
├── Dockerfile
└── docker-compose.yml
```
