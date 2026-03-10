import { test, expect, type PlaywrightWorkerArgs } from '@playwright/test';
import { validPaymentPayload, uniqueKey } from '../helpers/payment-helpers';

const BASE_URL = 'http://localhost:3000';
const CONCURRENCY = 10;

type Result<T = unknown> = { status: number; body: T };

/**
 * Fires a single request from a fresh, independent APIRequestContext and
 * returns { status, body } synchronously before the context is disposed.
 * This avoids "Response has been disposed" errors that occur when the context
 * is torn down before the response body is consumed.
 */
async function firePost<T = unknown>(
  playwright: PlaywrightWorkerArgs['playwright'],
  path: string,
  options: { headers?: Record<string, string>; data?: unknown } = {},
): Promise<Result<T>> {
  const ctx = await playwright.request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { 'Content-Type': 'application/json' },
  });
  const res = await ctx.post(path, options);
  const status = res.status();
  const body = (await res.json()) as T;
  await ctx.dispose();
  return { status, body };
}

// ---------------------------------------------------------------------------
// CT41 — 10 concurrent POSTs with the SAME Idempotency-Key
//
// ConcurrentDictionary.GetOrAdd is atomic: exactly one payment wins the race;
// all 10 responses must reference that single winner.
// ---------------------------------------------------------------------------
test('CT41 - concurrent creates with same Idempotency-Key all return same payment_id', async ({ playwright }) => {
  // Arrange
  const key = uniqueKey('ct41');
  const payload = validPaymentPayload();

  // Act — fire all requests simultaneously, each from an independent context
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      firePost<{ payment_id: string }>(playwright, '/payments', {
        headers: { 'Idempotency-Key': key },
        data: payload,
      }),
    ),
  );

  // Assert — all succeed
  for (const { status } of results) {
    expect(status).toBe(201);
  }

  // Assert — all reference the same payment (idempotency held under concurrency)
  const ids = results.map((r) => r.body.payment_id);
  expect(new Set(ids).size).toBe(1);
});

// ---------------------------------------------------------------------------
// CT42 — 10 concurrent captures on the SAME PENDING payment
//
// Payment.Capture() is not atomically guarded at the entity level so multiple
// requests may succeed. Firm guarantees:
//   - No 5xx (server stays healthy)
//   - At least one 200 (capture succeeded)
//   - All responses are 200 or 422 exclusively
// ---------------------------------------------------------------------------
test('CT42 - concurrent captures on the same payment produce only 200/422 and at least one 200', async ({ playwright }) => {
  // Arrange — create the payment
  const created = await firePost<{ payment_id: string }>(playwright, '/payments', {
    headers: { 'Idempotency-Key': uniqueKey() },
    data: validPaymentPayload(),
  });
  expect(created.status).toBe(201);
  const { payment_id } = created.body;

  // Act — 10 concurrent captures
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      firePost(playwright, `/payments/${payment_id}/capture`),
    ),
  );

  // Assert — no 5xx
  const statuses = results.map((r) => r.status);
  for (const s of statuses) {
    expect(s).toBeGreaterThanOrEqual(200);
    expect(s).toBeLessThan(500);
  }

  // Assert — only 200 or 422
  for (const s of statuses) {
    expect([200, 422]).toContain(s);
  }

  // Assert — at least one succeeded
  expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// CT43 — 10 concurrent POSTs WITHOUT an Idempotency-Key
//
// With no key every request is independent; every response must carry a
// distinct payment_id.
// ---------------------------------------------------------------------------
test('CT43 - concurrent creates without Idempotency-Key all return unique payment_ids', async ({ playwright }) => {
  // Arrange
  const payload = validPaymentPayload();

  // Act — no idempotency key on any request
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      firePost<{ payment_id: string }>(playwright, '/payments', { data: payload }),
    ),
  );

  // Assert — all succeed
  for (const { status } of results) {
    expect(status).toBe(201);
  }

  // Assert — every payment_id is unique
  const ids = results.map((r) => r.body.payment_id);
  expect(new Set(ids).size).toBe(CONCURRENCY);
});

// ---------------------------------------------------------------------------
// CT44 — Ledger written exactly once after concurrent captures
//
// InMemoryLedgerRepository uses SemaphoreSlim per paymentId in TryWriteAsync.
// Even if multiple captures reach the ledger layer, only the first write lands.
//
// Default split: seller_1 80% (8000) + platform 20% (2000) → 3 total entries.
// ---------------------------------------------------------------------------
test('CT44 - ledger has exactly 3 entries (no duplicates) after concurrent captures', async ({ playwright }) => {
  // Arrange — create a fresh payment
  const created = await firePost<{ payment_id: string }>(playwright, '/payments', {
    headers: { 'Idempotency-Key': uniqueKey() },
    data: validPaymentPayload(),
  });
  expect(created.status).toBe(201);
  const { payment_id } = created.body;

  // Act — 10 concurrent captures
  await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      firePost(playwright, `/payments/${payment_id}/capture`),
    ),
  );

  // GET /ledger/{id} — use a plain context for the read
  const ctx = await playwright.request.newContext({ baseURL: BASE_URL });
  const ledgerRes = await ctx.get(`/ledger/${payment_id}`);
  expect(ledgerRes.status()).toBe(200);
  const { entries } = (await ledgerRes.json()) as {
    payment_id: string;
    entries: Array<{ type: string; account: string; amount: number }>;
  };
  await ctx.dispose();

  // Exactly 3 entries (1 debit + 2 credits — no duplicates)
  expect(entries).toHaveLength(3);

  const debit = entries.find((e) => e.type === 'debit');
  const credits = entries.filter((e) => e.type === 'credit');

  expect(debit).toBeDefined();
  expect(debit!.account).toBe('customer');
  expect(debit!.amount).toBe(10000);

  expect(credits).toHaveLength(2);
  expect(credits.find((e) => e.account === 'seller_1')?.amount).toBe(8000);
  expect(credits.find((e) => e.account === 'platform')?.amount).toBe(2000);
});
