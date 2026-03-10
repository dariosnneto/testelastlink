# Quality Strategy — Mock Payments API

> This document covers the CI/CD pipeline strategy, risk model, test coverage rationale, incident investigation protocol, quality metrics, and the 30-60-90 day roadmap for the test suite built in Steps 0-8.

---

## 1. CI/CD Pipeline

### Test distribution by stage

| Stage | Trigger | Projects | Steps covered | Estimated time |
|---|---|---|---|---|
| **PR Gate** | Pull Request | `api` + `ledger` | 1, 2, 3, 4, 6 | ~30 s |
| **Full Suite** | Push to `main` / daily cron | all | 1–7 | ~2-3 min |

The split is intentional: **the PR Gate covers all P0/P1 financial risks** (creation, validation, idempotency, state transitions, ledger consistency) using only fast, deterministic tests. Slow tests (concurrency, webhook retry) run after merge, where a failure does not block a developer's day but still validates the main branch.

### Fast feedback strategy

- The PR Gate runs in < 45 s — faster than a code review round.
- Webhook tests (CT53–CT57, ~22 s each) are excluded from the PR Gate because they depend on Docker network timing and add variance without improving signal on a new PR.
- A PR Gate failure blocks the merge. A Full Suite failure triggers a Slack alert and must be fixed before the next PR is merged.

### Flakiness reduction

| Technique | Applied where |
|---|---|
| `uniqueKey()` with `timestamp + random` suffix | All idempotency and creation tests |
| Each test creates its own payment(s) | All tests — no shared state |
| `beforeEach` resets webhook mode to `ok` | CT53–CT57 |
| `test.slow()` triples the timeout in CT56 | CT56 only (expected runtime ~22 s) |
| No teardown needed | Server restarted between CI jobs via `docker compose down` |

### Test data strategy

| Aspect | Approach |
|---|---|
| **Setup** | Each test creates its own data via API: `validPaymentPayload()` + `uniqueKey()` |
| **Fixtures** | `tests/helpers/payment-helpers.ts` centralizes payloads, key generation, and shortcut helpers |
| **Teardown** | Not needed — the mock API is stateless per container; `docker compose down` resets everything |
| **Seed data** | Not used — each test is self-contained and produces only the state it needs |

---

## 2. Risk Matrix

Risks are scored by **Probability × Impact** (scale of 1-3 each, resulting in 1-9).
Coverage indicates which test cases address each risk.

| # | Risk | Probability | Impact | Score | Mitigation / Coverage |
|---|---|:---:|:---:|:---:|---|
| R01 | Duplicate payment created due to missing idempotency key | 3 | 3 | **9** | CT05, CT25-CT30 |
| R02 | Idempotency key reused with different payload → silent data corruption | 2 | 3 | **6** | CT06, CT28, CT30 |
| R03 | Payment captured twice → duplicate ledger entry / double charge | 3 | 3 | **9** | CT33, CT42, CT44 |
| R04 | Webhook failure causes capture failure / rollback | 2 | 3 | **6** | CT54, CT55 |
| R05 | Webhook retry loop stalls the API after max attempts | 1 | 3 | **3** | CT56 |
| R06 | Invalid amount or currency accepted → financial calculation error | 3 | 3 | **9** | CT02, CT08-CT12 |
| R07 | Split percentages > or < 100 accepted → ledger imbalance | 3 | 3 | **9** | CT04, CT13-CT16, CT22 |
| R08 | Terminal state transition (APPROVED/FAILED) allowed → invalid state | 2 | 3 | **6** | CT33-CT36, CT39 |
| R09 | Rejected payment fires webhook | 1 | 2 | **2** | CT57 |
| R10 | Race condition in concurrent creates produces duplicate payments | 2 | 2 | **4** | CT41, CT43 |
| R11 | Race condition in concurrent captures produces duplicate ledger rows | 2 | 3 | **6** | CT42, CT44 |
| R12 | GET /payments returns stale status after state transition | 1 | 2 | **2** | CT40 |
| R13 | Non-existent payment_id returns 200 instead of 404 | 1 | 2 | **2** | CT37, CT38 |
| R14 | Idempotency key lookup is case-insensitive (unintended deduplication) | 1 | 2 | **2** | CT29 |
| R15 | `currency` field accepts arbitrary strings after server-side normalization | 2 | 2 | **4** | CT10-CT12 |

---

## 3. Test Coverage Map

```
CT01-CT07   Payment creation happy path + structural idempotency
CT08-CT24   Input validation (amount, currency, split — 17 edge cases)
CT25-CT30   Idempotency deep-dive (triple replay, full body comparison,
             case-sensitivity, hash coverage, conflict state preservation)
CT31-CT40   State machine (all 6 transitions, both 404 paths, error message
             contract, read-after-write consistency)
CT41-CT44   Concurrency (same-key race, concurrent capture, keyless creates,
             ledger mutex verification)
CT53-CT57   Webhook resilience (fire-and-forget timing, 500 transparency,
             timeout non-blocking, retry exhaustion, rejection without webhook)
```

### Gap: steps not yet implemented

| Step | Area | Missing CTs |
|---|---|---|
| Step 6 | Ledger endpoint (GET /ledger/{id}) | CT45-CT52 (planned) |
| Step 7 | Integration flows (create→capture→GET) | Full-flow CTs (planned) |

---

## 4. Technical Decisions and Trade-offs

### Tool choice: Playwright vs Supertest / Axios

| Criterion | Playwright `request` | Supertest | Axios + Jest |
|---|---|---|---|
| Typed fixtures | Native | Requires setup | Requires setup |
| Parallel project configurations | Native | Manual | Manual |
| CI reporter | Built-in (`github`) | None | None |
| Evolution path to browser | Yes (if UI is added) | No | No |
| API-only (no browser install) | Yes | N/A | N/A |

Playwright was chosen for its zero-config CI reporter, typed `APIRequestContext`, and the ability to evolve to E2E tests without switching frameworks.

### In-memory store — no server-level test isolation

The API stores all state in `ConcurrentDictionary` instances that live for the container's lifetime. There is no `/reset` endpoint or per-test teardown. Isolation is achieved by generating unique identifiers (`uniqueKey()`) and creating new payments per test. This is a conscious trade-off: it keeps the API simple, but requires tests to be additive (never depending on clean state).

### Concurrency: I/O parallelism, not thread parallelism

`Promise.all()` in Node.js fires all requests on the same event loop thread, relying on the OS and ASP.NET Core's thread pool to create the real race condition. This is sufficient to exercise server-side guards (`SemaphoreSlim`, `GetOrAdd`), but does not replace load testing tools (k6, Artillery) for throughput or latency baselines.

### Soft assertions in CT42

`Payment.Capture()` performs a non-atomic check-and-set on `Status`. Under concurrent load, more than one capture may succeed at the HTTP layer. This is a known implementation detail. CT42 does **not** assert "exactly one 200" because that would be a flaky test; instead, it asserts the invariant that **always** holds: no 5xx, all responses are 200 or 422, at least one 200.
CT44 covers the strong guarantee: the ledger is written exactly once.

---

## 5. Incident Investigation Protocol — MTTR Reduction

Each scenario follows the same five-step process:
**triage → reproduction → isolation → regression test → post-mortem.**
A fix is only complete when the new regression test is green.

---

### Scenario 1: duplicate charges reported in production

**Step 1 — Triage (< 5 min)**
- Identify the affected `payment_id`s in support tickets or payment processor logs.
- Check whether duplicates share the same `Idempotency-Key` (idempotency failure) or have different keys (genuinely separate charges).

**Step 2 — Reproduce locally (< 15 min)**
```bash
# Start the API
docker compose up -d --wait

# Simulate the scenario that caused the duplicates
# Option A: same key, same payload — must return the same payment
curl -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: incident-repro-001" \
  -d @examples/payment-request.json

curl -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: incident-repro-001" \
  -d @examples/payment-request.json

# Expected: both calls return the SAME payment_id
# If they return different IDs: idempotency is broken → R01/R02

# Option B: concurrent requests
npx playwright test --project=concurrency tests/concurrency/concurrent-requests.spec.ts
```

**Step 3 — Isolate the failure path**

| Symptom | Likely root cause | Relevant tests |
|---|---|---|
| Different `payment_id` for same key + payload | Lost race in `ConcurrentDictionary.GetOrAdd` | CT41 |
| Same `payment_id` but two ledger rows | `SemaphoreSlim` not acquired correctly | CT44 |
| Different `payment_id` across keys but same payload | Expected — no bug | CT43 |
| Capture returns 200 twice for the same ID | Non-atomic read-write on `Payment.Status` | CT42 |

**Step 4 — Add a regression test**
Before fixing the bug, write a failing test that reproduces it. Add it to the appropriate spec file. The fix is only complete when the new test passes.

**Step 5 — Verify end-to-end**
```bash
npm run test:api
npm run test:concurrency
```

**Step 6 — Post-mortem**
Document in `docs/incidents/YYYY-MM-DD-<slug>.md`:
- Timeline
- Root cause (reference to source file + line)
- Fix applied
- Regression test added (CT number)
- Preventive measures

---

### Scenario 2: payments captured but missing from the ledger

> "Some payments were charged, but their entries never appeared in the ledger."

#### Root cause hypotheses

**H1 — Transactional failure during capture**
`CapturePaymentHandler` updates the payment status to `APPROVED` and then
calls `TryWriteAsync`. If the ledger write fails (timeout, constraint violation)
after the status has already been mutated, the payment is left as `APPROVED` with no accounting record.
There is no atomic transaction covering both operations.

**H2 — Race condition in concurrent captures**
Two capture requests arrive nearly simultaneously. Both pass the `PENDING` check
in `Payment.Capture()` before either writes the new status. Both proceed to the ledger;
the `SemaphoreSlim` ensures only one write lands, but the second thread may observe
the ledger as already written and silently skip it.

**H3 — Silent failure in async processing**
If ledger writes were event-driven (message queue), the event could be lost: broker restart,
missing dead-letter configuration, or a deserialization bug in the consumer. The payment is captured;
the ledger event is never processed.
*(Not the current architecture — relevant if the system is migrated to event sourcing.)*

**H4 — Timeout + incorrect retry**
The ledger write times out but was actually committed. The retry hits a uniqueness violation,
silently discards it, and the original record was never persisted.

#### Reproduction plan

```bash
# 1. Start the API
docker compose up -d --wait

# 2. H1 — Capture and verify the ledger immediately
PAYMENT_ID=$(curl -s -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: incident2-001" \
  -d @examples/payment-request.json | python3 -c "import sys,json; print(json.load(sys.stdin)['payment_id'])")

curl -s -X POST http://localhost:3000/payments/$PAYMENT_ID/capture

curl -s http://localhost:3000/ledger/$PAYMENT_ID
# Expected: {"payment_id":"...","entries":[...]}
# If 404 or empty: H1 confirmed

# 3. H2 — Run the concurrent capture test
npx playwright test --project=concurrency tests/concurrency/concurrent-requests.spec.ts

# 4. Check container logs for ledger errors
docker logs mock-payments-api | grep -E "ledger|error|warn"
```

**Isolation decision table:**

| Symptom | Likely hypothesis | Relevant tests |
|---|---|---|
| `GET /ledger/{id}` returns 404 after successful capture | H1 | CT45 (planned) |
| Ledger has correct entries but `amount` diverges | H4 | CT48 (planned) |
| `GET /ledger/{id}` entries appear only on the second request | H2 | CT42, CT44 |
| Ledger missing only in high-concurrency runs | H2 | CT44 |

#### Required logs and metrics

The following must be present in structured JSON logs (correlated by `payment_id`)
to diagnose this incident within 15 minutes:

```
payment.capture.started        { payment_id, status_before }
payment.capture.status_updated { payment_id, new_status }
ledger.write.started           { payment_id, entries_count }
ledger.write.completed         { payment_id, duration_ms }
ledger.write.failed            { payment_id, error, stack_trace }
```

**Alert metrics:**

| Metric | Type | Alert threshold |
|---|---|---|
| `payment_capture_total{status}` | counter | — |
| `ledger_write_total{status="ok\|failed"}` | counter | P0 if `failed > 0` |
| `ledger_write_duration_ms` | histogram | P95 > 500 ms → warning |
| `payment_without_ledger` | gauge | **P0 if > 0** — immediate alert |

#### Regression tests to prevent recurrence

| Test | Hypothesis covered |
|---|---|
| CT45 — Captured payment has ledger entries | H1 |
| CT48 — Sum of credits equals the debit amount | H1, H4 |
| CT42 — No 5xx in concurrent captures | H2 |
| CT44 — Ledger has exactly the correct entries after concurrent captures | H2 |

#### Structural improvements

1. **Atomic transaction** — wrap the status update + ledger write in a single database transaction; if the ledger write fails, roll back the status change.
2. **Outbox pattern** — insert a ledger event in an outbox table within the same transaction as the status update; a separate worker processes it. Reprocessing an already-applied event is safe because `TryWriteAsync` is idempotent.
3. **Idempotent ledger consumer** — use `payment_id` as the deduplication key; reprocessing an event should be a no-op, not an error.
4. **Reconciliation job** — a cron that compares all `APPROVED` payments with ledger entries; discrepancies trigger automatic reprocessing and a P0 alert.
5. **Unique constraint on ledger** — `UNIQUE(payment_id, type, account)` as a last-resort guard against duplicates even under retry storms.

---

## 6. Quality Metrics

### Weekly tracking

| Metric | What it measures | Connected to | Goal |
|---|---|---|---|
| **Escaped bugs to production** | Bugs found by customers or monitoring | Risk (financial / UX) | ≤ 1 / week |
| **Post-deploy incidents** | P0/P1 incidents within the first 24 h after deploy | Velocity (deploy confidence) | 0 per deploy |
| **Rollback rate** | % of deploys that required rollback | Velocity (stability) | < 5% |
| **P0 flow coverage** | % of P0/P1 risk matrix scenarios with automated tests | Risk (financial protection) | 100% |
| **MTTD** | Mean time between bug occurrence and detection | Perceived quality | < 5 min |
| **MTTR** | Mean time between detection and resolution | Perceived quality + velocity | < 30 min (P0) |
| **Flaky test rate** | % of tests failing without code changes | Velocity (suite confidence) | < 2% |
| **Deploy frequency** | Production deploys per week | Velocity | ≥ 5 / week |
| **Suite runtime** | Total runtime of the full suite | Velocity (feedback cycle) | < 5 min |

### Suite-level targets

| Metric | Target | Current | Source |
|---|---|---|---|
| Suite pass rate (main branch) | 100% | 100% | GitHub Actions `full-suite` |
| `pr-gate` duration | < 60 s | ~30 s | GitHub Actions timing |
| `full-suite` duration | < 5 min | ~2-3 min | GitHub Actions timing |
| CT coverage of API endpoints | 100% of documented endpoints | 100% | Manual mapping |
| Critical risk coverage (score ≥ 6) | 100% | 100% | Risk matrix §2 |
| Flaky test rate (last 30 runs) | < 2% | 0% | GitHub Actions history |

### How each metric drives decisions

- **Escaped bugs ↑** → expand the test suite to uncovered flows; review the risk matrix
- **Post-deploy incidents > 0** → introduce canary deploys or feature flags; add smoke tests
- **Rollback rate > 5%** → increase integration test coverage; add pre-deploy quality gates
- **High MTTD** → invest in observability: 5xx anomaly alerts, payment-without-ledger gauge
- **High MTTR** → improve runbooks; add structured logs with `payment_id` correlation IDs

### How to measure flakiness

```bash
# Run the full suite 5 times and count failures
for i in $(seq 1 5); do npx playwright test --pass-with-no-tests; done
```

A test is considered flaky if it fails in ≥ 1 of 5 runs without code changes.
Mark flaky tests with `test.fixme()` and open a tracking issue immediately.

### Coverage gaps (technical debt)

The following areas do not yet have automated coverage:

- `GET /ledger/{id}` endpoint (Step 6 — planned, CT45-CT52)
- Multi-step integration flows: create → capture → GET ledger (Step 7)
- `GET /payments/{id}` 404 for non-existent ID (partially covered implicitly by CT37/CT38)
- Rounding edge cases in `SplitItem.CalculateAmount` (e.g., 3-way split with non-divisible amounts)
- Stress / load tests (throughput, P99 latency) — out of Playwright's scope; use k6

---

## 7. 30-60-90 Day Roadmap

### Month 1 (Days 1-30) — Foundation complete

**Completed (Steps 0-8):**
- [x] Playwright setup with TypeScript, 5 projects, CI pipeline
- [x] Payment creation tests (CT01-CT07)
- [x] Validation tests (CT08-CT24)
- [x] Idempotency tests (CT25-CT30)
- [x] State transition tests (CT31-CT40)
- [x] Concurrency tests (CT41-CT44)
- [x] Webhook resilience tests (CT53-CT57)
- [x] GitHub Actions: `pr-gate` + `full-suite`
- [x] Quality strategy documentation

**Goals:**
- All `pr-gate` tests passing on every PR
- Zero flaky tests on the main branch
- Average `pr-gate` duration < 45 s

### Month 2 (Days 31-60) — Coverage expansion

- [ ] **Step 6 — Ledger tests (CT45-CT52)**
  - Ledger created after capture, correct amounts, no entries after rejection
  - Ledger not duplicated on concurrent captures (integration with CT44)
  - `GET /ledger/{id}` returns 404 for unknown payment
- [ ] **Integration flows**
  - Full happy path: create → capture → GET payment → GET ledger
  - Full rejection path: create → reject → GET payment → capture blocked (422)
  - Idempotency across the full lifecycle
- [ ] **Contract tests**
  - Response schema validation (amount is integer, currency is string, etc.)
  - Ensure no undocumented field is added without a test update
- [ ] **Observability**
  - Playwright HTML reporter enabled locally (`npx playwright show-report`)
  - Slack/email notification on `full-suite` failure via GitHub Actions

### Month 3 (Days 61-90) — Hardening and performance

- [ ] **Load / stress baseline with k6**
  - 100 concurrent users creating payments: P50/P95/P99 latency targets
  - Verify no memory leak under sustained load (in-memory store grows unboundedly)
- [ ] **Mutation testing**
  - Apply Stryker or equivalent to the domain layer
  - Kill rate target: > 80%
- [ ] **Chaos / fault injection**
  - Kill the webhook-sink during retry; verify the API recovers
  - Restart the API container; verify in-memory state is lost (document limitation)
- [ ] **Test data management**
  - Add `POST /admin/reset` endpoint (development mode only) to enable true per-test
    isolation and eliminate the `uniqueKey()` workaround
- [ ] **Security surface**
  - Fuzz the amount field with very large values, floats, strings
  - Check `Idempotency-Key` header with special characters, very long strings
  - Verify absence of CORS headers and rate-limiting in responses
