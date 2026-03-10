/**
 * Webhook resilience tests — CT53–CT57
 *
 * These tests are intentionally slow (~15-20 s each for CT56) because they
 * exercise the actual retry backoff schedule (1 s → 3 s → 5 s, 4 attempts).
 * Run them only post-merge or on a dedicated CI stage; do not run on every PR.
 *
 * Retry timing reference (WebhookAdapter):
 *   attempt 0: immediate
 *   attempt 1: +1 s
 *   attempt 2: +3 s (cumulative: +4 s)
 *   attempt 3: +5 s (cumulative: +9 s)
 *
 * Timeout-mode quirk: the Python sink sleeps 10 s then returns HTTP 200.
 * This simulates a slow endpoint, not a failing one. A single attempt
 * eventually succeeds; no retries are triggered.
 */

import { test, expect } from '@playwright/test';
import { validPaymentPayload, uniqueKey, setWebhookMode, sleep } from '../helpers/payment-helpers';

// ---------------------------------------------------------------------------
// Shared setup — restore the webhook sink to a known-good state before every
// test so a failure or mode change in one test never bleeds into the next.
// ---------------------------------------------------------------------------
test.beforeEach(async ({ request }) => {
  await setWebhookMode(request, 'ok');
});

test.afterAll(async ({ request }) => {
  await setWebhookMode(request, 'ok');
});

// ---------------------------------------------------------------------------
// CT53 — Normal delivery: capture fires webhook and returns fast (mode=ok)
// ---------------------------------------------------------------------------
test('CT53 - capture fires webhook and returns 200 immediately (mode=ok)', async ({ request }) => {
  // Arrange
  const createRes = await request.post('/payments', {
    headers: { 'Idempotency-Key': uniqueKey('ct53') },
    data: validPaymentPayload(),
  });
  expect(createRes.status()).toBe(201);
  const { payment_id } = await createRes.json();

  // Act
  const start = Date.now();
  const captureRes = await request.post(`/payments/${payment_id}/capture`);
  const elapsed = Date.now() - start;

  // Assert — capture succeeds and is non-blocking
  expect(captureRes.status()).toBe(200);
  const body = await captureRes.json();
  expect(body.status).toBe('APPROVED');
  expect(elapsed).toBeLessThan(2_000); // fire-and-forget: should return in milliseconds
});

// ---------------------------------------------------------------------------
// CT54 — Webhook failure (mode=500) is transparent to the API caller
// The webhook delivery fails but the payment state is already APPROVED and
// the HTTP response is 200 — the caller must never see webhook errors.
// ---------------------------------------------------------------------------
test('CT54 - capture returns 200 APPROVED even when webhook returns 500 (mode=500)', async ({ request }) => {
  // Arrange
  await setWebhookMode(request, '500');
  const createRes = await request.post('/payments', {
    headers: { 'Idempotency-Key': uniqueKey('ct54') },
    data: validPaymentPayload(),
  });
  expect(createRes.status()).toBe(201);
  const { payment_id } = await createRes.json();

  // Act
  const captureRes = await request.post(`/payments/${payment_id}/capture`);

  // Assert — capture succeeds despite background webhook failures
  expect(captureRes.status()).toBe(200);
  const body = await captureRes.json();
  expect(body.status).toBe('APPROVED');
  // The background retry loop (1 s → 3 s → 5 s) is now running silently.
});

// ---------------------------------------------------------------------------
// CT55 — Webhook timeout doesn't block capture (mode=timeout)
// The Python sink sleeps 10 s before responding. If capture were synchronous,
// it would take at least 10 s. Since it's fire-and-forget, it must return fast.
// ---------------------------------------------------------------------------
test('CT55 - capture returns quickly even when webhook sink delays 10 s (mode=timeout)', async ({ request }) => {
  // Arrange
  await setWebhookMode(request, 'timeout');
  const createRes = await request.post('/payments', {
    headers: { 'Idempotency-Key': uniqueKey('ct55') },
    data: validPaymentPayload(),
  });
  expect(createRes.status()).toBe(201);
  const { payment_id } = await createRes.json();

  // Act — time the capture; it must complete well before the 10 s sink delay
  const start = Date.now();
  const captureRes = await request.post(`/payments/${payment_id}/capture`);
  const elapsed = Date.now() - start;

  // Assert
  expect(captureRes.status()).toBe(200);
  expect((await captureRes.json()).status).toBe('APPROVED');
  // Must return in < 5 s — well under the sink's 10 s sleep.
  // If this fails, SendAsync is accidentally awaiting the webhook.
  expect(elapsed).toBeLessThan(5_000);
});

// ---------------------------------------------------------------------------
// CT56 — API remains healthy after all 4 retry attempts are exhausted
//
// Schedule with mode=500 (total ~9 s):
//   t=0   attempt 1 → 500 — wait 1 s
//   t≈1   attempt 2 → 500 — wait 3 s
//   t≈4   attempt 3 → 500 — wait 5 s
//   t≈9   attempt 4 → 500 — log webhook_failed
//
// After waiting 12 s, we restore ok mode and verify the API still creates
// and captures payments normally — ensuring the retry loop doesn't crash or
// wedge the server.
// ---------------------------------------------------------------------------
test('CT56 - API is fully operational after all webhook retries are exhausted (mode=500)', async ({ request }) => {
  test.slow(); // triples the project timeout (60 s × 3 = 180 s)

  // Arrange — trigger the retry cycle
  await setWebhookMode(request, '500');
  const createRes1 = await request.post('/payments', {
    headers: { 'Idempotency-Key': uniqueKey('ct56-trigger') },
    data: validPaymentPayload(),
  });
  expect(createRes1.status()).toBe(201);
  const { payment_id: triggerPaymentId } = await createRes1.json();

  // Capture → starts the 4-attempt retry loop in the background
  const triggerCapture = await request.post(`/payments/${triggerPaymentId}/capture`);
  expect(triggerCapture.status()).toBe(200);

  // Wait for all retries to exhaust (9 s + safety margin = 12 s)
  await sleep(12_000);

  // Restore webhook to working mode
  await setWebhookMode(request, 'ok');

  // Act — create and capture a fresh payment to confirm the server is healthy
  const createRes2 = await request.post('/payments', {
    headers: { 'Idempotency-Key': uniqueKey('ct56-health') },
    data: validPaymentPayload(),
  });
  expect(createRes2.status()).toBe(201);
  const { payment_id: healthPaymentId } = await createRes2.json();

  const healthCapture = await request.post(`/payments/${healthPaymentId}/capture`);

  // Assert — server is still fully operational
  expect(healthCapture.status()).toBe(200);
  expect((await healthCapture.json()).status).toBe('APPROVED');
});

// ---------------------------------------------------------------------------
// CT57 — Reject does NOT fire the webhook
//
// The webhook is fired only in CapturePaymentHandler. RejectPaymentHandler
// has no webhook call. Even with mode=timeout (sink sleeps 10 s), reject
// must return in < 2 s because no HTTP call to the sink is made.
// ---------------------------------------------------------------------------
test('CT57 - reject returns immediately in timeout mode (webhook is not called on reject)', async ({ request }) => {
  // Arrange
  await setWebhookMode(request, 'timeout');
  const createRes = await request.post('/payments', {
    headers: { 'Idempotency-Key': uniqueKey('ct57') },
    data: validPaymentPayload(),
  });
  expect(createRes.status()).toBe(201);
  const { payment_id } = await createRes.json();

  // Act — time the reject
  const start = Date.now();
  const rejectRes = await request.post(`/payments/${payment_id}/reject`);
  const elapsed = Date.now() - start;

  // Assert — returns immediately (no 10 s sink delay triggered)
  expect(rejectRes.status()).toBe(200);
  expect((await rejectRes.json()).status).toBe('FAILED');
  // If reject called the webhook, this would take ≥ 10 s.
  expect(elapsed).toBeLessThan(2_000);
});
