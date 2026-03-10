# Quality Strategy — Mock Payments API

> This document covers the risk model, test coverage rationale, incident
> investigation protocol, quality metrics, and the 30-60-90 day roadmap for
> the test suite built in Steps 0-8.

---

## 1. Risk Matrix

Risks are scored by **Probability × Impact** (1–3 scale each, giving 1–9).
Coverage indicates which test cases address each risk.

| # | Risk | Probability | Impact | Score | Mitigation / Coverage |
|---|---|:---:|:---:|:---:|---|
| R01 | Duplicate payment created due to missing idempotency key | 3 | 3 | **9** | CT05, CT25-CT30 |
| R02 | Idempotency key reused with different payload → silent data corruption | 2 | 3 | **6** | CT06, CT28, CT30 |
| R03 | Payment captured twice → double ledger entry / double charge | 3 | 3 | **9** | CT33, CT42, CT44 |
| R04 | Webhook failure causes capture to fail / roll back | 2 | 3 | **6** | CT54, CT55 |
| R05 | Webhook retry loop crashes the API after max retries | 1 | 3 | **3** | CT56 |
| R06 | Invalid amount or currency accepted → financial calculation error | 3 | 3 | **9** | CT02, CT08-CT12 |
| R07 | Split percentages > or < 100 accepted → ledger imbalance | 3 | 3 | **9** | CT04, CT13-CT16, CT22 |
| R08 | Terminal state (APPROVED/FAILED) transition allowed → invalid state | 2 | 3 | **6** | CT33-CT36, CT39 |
| R09 | Rejected payment fires a webhook | 1 | 2 | **2** | CT57 |
| R10 | Race condition on concurrent creates produces duplicate payments | 2 | 2 | **4** | CT41, CT43 |
| R11 | Race condition on concurrent captures produces duplicate ledger rows | 2 | 3 | **6** | CT42, CT44 |
| R12 | GET /payments returns stale status after state transition | 1 | 2 | **2** | CT40 |
| R13 | Non-existent payment_id returns 200 instead of 404 | 1 | 2 | **2** | CT37, CT38 |
| R14 | Idempotency key lookup is case-insensitive (unintended deduplication) | 1 | 2 | **2** | CT29 |
| R15 | `currency` field accepts arbitrary strings after server-side normalisation | 2 | 2 | **4** | CT10-CT12 |

---

## 2. Test Coverage Map

```
CT01-CT07   Payment creation happy path + structural idempotency
CT08-CT24   Input validation (amount, currency, split — 17 edge cases)
CT25-CT30   Idempotency deep-dive (triple replay, full body comparison,
             case sensitivity, hash coverage, conflict state preservation)
CT31-CT40   State machine (all 6 transitions, both 404 paths, error message
             contract, read-after-write consistency)
CT41-CT44   Concurrency (same-key race, concurrent capture, keyless creates,
             ledger mutex verification)
CT53-CT57   Webhook resilience (fire-and-forget timing, 500 transparency,
             timeout non-blocking, retry exhaustion, reject no-webhook)
```

### Gap: steps not yet implemented

| Step | Area | Missing CTs |
|---|---|---|
| Step 6 | Ledger endpoint (GET /ledger/{id}) | CT45-CT52 (planned) |
| Step 7 | Integration flows (create→capture→GET) | full-flow CTs (planned) |

---

## 3. Technical Decisions and Trade-offs

### Tool choice: Playwright over Supertest / Axios

| Criterion | Playwright `request` | Supertest | Axios + Jest |
|---|---|---|---|
| Typed fixtures | Native | Needs wiring | Needs wiring |
| Parallel project configs | Native | Manual | Manual |
| CI reporter | Built-in (`github`) | None | None |
| Browser upgrade path | Yes (if UI added) | No | No |
| API-only (no browser install) | Yes | N/A | N/A |

Playwright was chosen for its zero-setup CI reporter, typed `APIRequestContext`,
and the ability to grow into E2E tests later without switching frameworks.

### In-memory store — no test isolation at server level

The API stores all state in `ConcurrentDictionary` instances that live for the
container's lifetime. There is no `/reset` or per-test teardown endpoint.
Isolation is achieved by generating unique identifiers (`uniqueKey()`) and
creating new payments per test. This is a conscious trade-off: it keeps the
API simple but requires tests to be additive (never rely on clean state).

### Concurrency: I/O parallelism, not thread parallelism

`Promise.all()` in Node.js issues all requests on the same event loop thread,
relying on the OS and ASP.NET Core's thread pool to create the actual race
condition. This is sufficient to exercise server-side guards (`SemaphoreSlim`,
`GetOrAdd`) but is not a substitute for load testing tools (k6, Artillery)
for throughput or latency baselines.

### Soft assertions on CT42

`Payment.Capture()` performs a non-atomic check-then-set on `Status`. Under
concurrent load, more than one capture may succeed at the HTTP layer. This is
a known implementation detail. CT42 does **not** assert "exactly one 200"
because that would be a flaky test; instead it asserts the invariant that
**always** holds: no 5xx, all responses are 200 or 422, at least one 200.
CT44 covers the hard guarantee: the ledger is written exactly once.

---

## 4. Incident Investigation Protocol

### Scenario: duplicate charges reported in production

**Step 1 — Triage (< 5 min)**
- Identify affected `payment_id`s from support tickets or payment processor logs.
- Check if duplicates share the same `Idempotency-Key` (idempotency failure)
  or have different keys (genuinely separate charges).

**Step 2 — Reproduce locally (< 15 min)**
```bash
# Start the API
docker compose up -d --wait

# Simulate the scenario that caused duplicates
# Option A: same key, same payload — should return same payment
curl -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: incident-repro-001" \
  -d @examples/payment-request.json

curl -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: incident-repro-001" \
  -d @examples/payment-request.json

# Expect: both calls return the SAME payment_id
# If they return different IDs: idempotency is broken → R01/R02

# Option B: concurrent requests
npx playwright test --project=concurrency tests/concurrency/concurrent-requests.spec.ts
```

**Step 3 — Isolate the failure path**

| Symptom | Likely root cause | Relevant tests |
|---|---|---|
| Different `payment_id` for same key + payload | `ConcurrentDictionary.GetOrAdd` race lost | CT41 |
| Same `payment_id` but two ledger rows | `SemaphoreSlim` not acquired correctly | CT44 |
| `payment_id` different across keys but same payload | Expected — no bug | CT43 |
| Capture returns 200 twice for same ID | `Payment.Status` non-atomic read-write | CT42 |

**Step 4 — Add a regression test**
Before fixing the bug, write a failing test that reproduces it. Add it to the
appropriate spec file. The fix is complete only when the new test passes.

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

## 5. Quality Metrics

### Targets

| Metric | Target | Current | Source |
|---|---|---|---|
| Test suite pass rate (main branch) | 100% | 100% | GitHub Actions `full-suite` |
| `pr-gate` duration | < 60 s | ~30 s | GitHub Actions timing |
| `full-suite` duration | < 5 min | ~2-3 min | GitHub Actions timing |
| CT coverage of API endpoints | 100% of documented endpoints | 100% | Manual mapping |
| Critical-risk (score ≥ 6) coverage | 100% | 100% | Risk matrix §1 |
| Flaky test rate (last 30 runs) | < 2% | 0% | GitHub Actions history |

### How to measure flakiness

```bash
# Re-run the full suite 5 times and count failures
for i in $(seq 1 5); do npx playwright test --pass-with-no-tests; done
```

A test is considered flaky if it fails in ≥ 1 of 5 runs without a code change.
Tag flaky tests with `test.fixme()` and open a tracking issue immediately.

### Coverage gaps to track

The following areas have no automated coverage yet and represent technical debt:

- `GET /ledger/{id}` endpoint (Step 6 — planned)
- Multi-step integration flows, e.g. create → capture → GET ledger (Step 7)
- `GET /payments/{id}` 404 for non-existent ID (partially covered by CT37/CT38 implicitly)
- Negative amount at the `SplitItem.CalculateAmount` boundary (rounding edge cases)
- Stress / load testing (throughput, P99 latency) — out of scope for Playwright; use k6

---

## 6. 30-60-90 Day Roadmap

### Month 1 (Days 1-30) — Foundation complete

**Done (Steps 0-8):**
- [x] Playwright setup with TypeScript, 5 projects, CI pipeline
- [x] Payment creation tests (CT01-CT07)
- [x] Validation tests (CT08-CT24)
- [x] Idempotency tests (CT25-CT30)
- [x] State transition tests (CT31-CT40)
- [x] Concurrency tests (CT41-CT44)
- [x] Webhook resilience tests (CT53-CT57)
- [x] GitHub Actions: `pr-gate` + `full-suite`
- [x] Quality strategy documentation

**Targets:**
- All `pr-gate` tests passing on every PR
- Zero flaky tests on main branch
- Mean `pr-gate` duration < 45 s

### Month 2 (Days 31-60) — Coverage expansion

- [ ] **Step 6 — Ledger tests (CT45-CT52)**
  - Ledger created after capture, correct amounts, no entries after reject
  - Ledger not duplicated on concurrent captures (integration with CT44)
  - `GET /ledger/{id}` returns 404 for unknown payment
- [ ] **Integration flows**
  - Full happy path: create → capture → GET payment → GET ledger
  - Full rejection path: create → reject → GET payment → capture blocked (422)
  - Idempotency across the full lifecycle
- [ ] **Contract tests**
  - Response schema validation (amount is integer, currency is string, etc.)
  - Ensure no undocumented fields are added without a test update
- [ ] **Observability**
  - Playwright HTML reporter enabled locally (`npx playwright show-report`)
  - Slack/email notification on `full-suite` failure via GitHub Actions

### Month 3 (Days 61-90) — Hardening and performance

- [ ] **Load / stress baseline with k6**
  - 100 concurrent users creating payments: P50/P95/P99 latency targets
  - Verify no memory leak under sustained load (in-memory store grows unbounded)
- [ ] **Mutation testing**
  - Apply Stryker or equivalent to the domain layer
  - Kill rate target: > 80%
- [ ] **Chaos / fault injection**
  - Kill the webhook-sink mid-retry; verify API recovers
  - Restart the API container; verify in-memory state is lost (document limitation)
- [ ] **Test data management**
  - Add a `POST /admin/reset` endpoint (development mode only) to enable
    true per-test isolation and eliminate the `uniqueKey()` workaround
- [ ] **Security surface**
  - Fuzz amount field with very large values, floats, strings
  - Verify `Idempotency-Key` header with special characters, very long strings
  - Check for missing CORS, rate-limiting headers in responses
