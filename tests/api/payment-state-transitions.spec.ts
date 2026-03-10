import { test, expect } from '@playwright/test';
import { validPaymentPayload, uniqueKey, createAndCapture, createAndReject } from '../helpers/payment-helpers';

// Helpers local to this file.
async function createPayment(request: Parameters<typeof createAndCapture>[0]) {
  const res = await request.post('/payments', {
    headers: { 'Idempotency-Key': uniqueKey() },
    data: validPaymentPayload(),
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { payment_id: string };
}

// ---------------------------------------------------------------------------
// CT31 — Capture from PENDING → 200 with status APPROVED
// ---------------------------------------------------------------------------
test('CT31 - capture a PENDING payment returns 200 and status APPROVED', async ({ request }) => {
  // Arrange
  const { payment_id } = await createPayment(request);

  // Act
  const response = await request.post(`/payments/${payment_id}/capture`);

  // Assert
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.payment_id).toBe(payment_id);
  expect(body.status).toBe('APPROVED');
});

// ---------------------------------------------------------------------------
// CT32 — Reject from PENDING → 200 with status FAILED
// ---------------------------------------------------------------------------
test('CT32 - reject a PENDING payment returns 200 and status FAILED', async ({ request }) => {
  // Arrange
  const { payment_id } = await createPayment(request);

  // Act
  const response = await request.post(`/payments/${payment_id}/reject`);

  // Assert
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.payment_id).toBe(payment_id);
  expect(body.status).toBe('FAILED');
});

// ---------------------------------------------------------------------------
// CT33 — Double-capture: APPROVED → capture → 422
// ---------------------------------------------------------------------------
test('CT33 - capturing an already-APPROVED payment returns 422', async ({ request }) => {
  // Arrange — bring payment to APPROVED
  const { payment } = await createAndCapture(request);

  // Act — attempt second capture
  const response = await request.post(`/payments/${payment.payment_id}/capture`);

  // Assert
  expect(response.status()).toBe(422);
  const body = await response.json();
  expect(body.error).toBeTruthy();
});

// ---------------------------------------------------------------------------
// CT34 — Reject after capture: APPROVED → reject → 422
// ---------------------------------------------------------------------------
test('CT34 - rejecting an APPROVED payment returns 422', async ({ request }) => {
  // Arrange
  const { payment } = await createAndCapture(request);

  // Act
  const response = await request.post(`/payments/${payment.payment_id}/reject`);

  // Assert
  expect(response.status()).toBe(422);
  const body = await response.json();
  expect(body.error).toBeTruthy();
});

// ---------------------------------------------------------------------------
// CT35 — Double-reject: FAILED → reject → 422
// ---------------------------------------------------------------------------
test('CT35 - rejecting an already-FAILED payment returns 422', async ({ request }) => {
  // Arrange — bring payment to FAILED
  const { payment } = await createAndReject(request);

  // Act — attempt second reject
  const response = await request.post(`/payments/${payment.payment_id}/reject`);

  // Assert
  expect(response.status()).toBe(422);
  const body = await response.json();
  expect(body.error).toBeTruthy();
});

// ---------------------------------------------------------------------------
// CT36 — Capture after reject: FAILED → capture → 422
// ---------------------------------------------------------------------------
test('CT36 - capturing a FAILED payment returns 422', async ({ request }) => {
  // Arrange
  const { payment } = await createAndReject(request);

  // Act
  const response = await request.post(`/payments/${payment.payment_id}/capture`);

  // Assert
  expect(response.status()).toBe(422);
  const body = await response.json();
  expect(body.error).toBeTruthy();
});

// ---------------------------------------------------------------------------
// CT37 — Capture non-existent payment → 404
// ---------------------------------------------------------------------------
test('CT37 - capturing a non-existent payment_id returns 404', async ({ request }) => {
  // Act
  const response = await request.post('/payments/pay_doesnotexist/capture');

  // Assert
  expect(response.status()).toBe(404);
  const body = await response.json();
  expect(body.error).toBeTruthy();
});

// ---------------------------------------------------------------------------
// CT38 — Reject non-existent payment → 404
// ---------------------------------------------------------------------------
test('CT38 - rejecting a non-existent payment_id returns 404', async ({ request }) => {
  // Act
  const response = await request.post('/payments/pay_doesnotexist/reject');

  // Assert
  expect(response.status()).toBe(404);
  const body = await response.json();
  expect(body.error).toBeTruthy();
});

// ---------------------------------------------------------------------------
// CT39 — 422 error message references the actual current status
//   - double-capture  → error contains "already APPROVED"
//   - double-reject   → error contains "already FAILED"
// ---------------------------------------------------------------------------
test('CT39 - 422 error message names the current status ("already APPROVED" / "already FAILED")', async ({ request }) => {
  // Arrange
  const { payment: approvedPayment } = await createAndCapture(request);
  const { payment: failedPayment }   = await createAndReject(request);

  // Act — try to capture an APPROVED payment
  const captureAgain = await request.post(`/payments/${approvedPayment.payment_id}/capture`);
  // Act — try to reject a FAILED payment
  const rejectAgain  = await request.post(`/payments/${failedPayment.payment_id}/reject`);

  // Assert
  expect(captureAgain.status()).toBe(422);
  expect((await captureAgain.json()).error).toContain('APPROVED');

  expect(rejectAgain.status()).toBe(422);
  expect((await rejectAgain.json()).error).toContain('FAILED');
});

// ---------------------------------------------------------------------------
// CT40 — GET after capture reflects APPROVED status (state is persisted)
// ---------------------------------------------------------------------------
test('CT40 - GET /payments/{id} after capture returns status APPROVED', async ({ request }) => {
  // Arrange
  const { payment_id } = await createPayment(request);

  // Act — capture
  await request.post(`/payments/${payment_id}/capture`);

  // Act — read back
  const getResponse = await request.get(`/payments/${payment_id}`);

  // Assert
  expect(getResponse.status()).toBe(200);
  const body = await getResponse.json();
  expect(body.payment_id).toBe(payment_id);
  expect(body.status).toBe('APPROVED');
});
