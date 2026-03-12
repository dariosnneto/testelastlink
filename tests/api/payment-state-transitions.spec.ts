import { test, expect, type APIRequestContext } from '@playwright/test';
import { validPaymentPayload, uniqueKey, createAndCapture, createAndReject } from '../helpers/payment-helpers';

// Local helper: creates a fresh PENDING payment and asserts it was created.
async function createPayment(request: APIRequestContext) {
  const res = await request.post('/payments', {
    headers: { 'Idempotency-Key': uniqueKey() },
    data: validPaymentPayload(),
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { payment_id: string };
}

test.describe('Payment State Transitions', () => {
  // ---------------------------------------------------------------------------
  // CT31 — Capture from PENDING → 200 with status APPROVED
  // ---------------------------------------------------------------------------
  test(
    'CT31 - capture a PENDING payment returns 200 and status APPROVED',
    { tag: ['@smoke', '@api', '@state-machine', '@critical'] },
    async ({ request }) => {
      // Arrange
      const { payment_id } = await createPayment(request);

      // Act
      const response = await request.post(`/payments/${payment_id}/capture`);

      // Assert
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.payment_id).toBe(payment_id);
      expect(body.status).toBe('APPROVED');
    },
  );

  // ---------------------------------------------------------------------------
  // CT32 — Reject from PENDING → 200 with status FAILED
  // ---------------------------------------------------------------------------
  test(
    'CT32 - reject a PENDING payment returns 200 and status FAILED',
    { tag: ['@api', '@state-machine', '@critical'] },
    async ({ request }) => {
      // Arrange
      const { payment_id } = await createPayment(request);

      // Act
      const response = await request.post(`/payments/${payment_id}/reject`);

      // Assert
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.payment_id).toBe(payment_id);
      expect(body.status).toBe('FAILED');
    },
  );

  // ---------------------------------------------------------------------------
  // CT33–CT36 — Invalid state transitions → 422
  //
  // All four illegal transitions are parametrised to avoid repeating the same
  // structure four times. The error message from the domain is:
  //   "Payment is already {STATUS}." — so we assert toContain(`already ${currentStatus}`)
  // ---------------------------------------------------------------------------
  test.describe('Invalid state transitions', () => {
    const invalidTransitions = [
      { label: 'CT33', setup: 'captured' as const, action: 'capture', currentStatus: 'APPROVED' },
      { label: 'CT34', setup: 'captured' as const, action: 'reject',  currentStatus: 'APPROVED' },
      { label: 'CT35', setup: 'rejected' as const, action: 'reject',  currentStatus: 'FAILED'   },
      { label: 'CT36', setup: 'rejected' as const, action: 'capture', currentStatus: 'FAILED'   },
    ] as const;

    for (const { label, setup, action, currentStatus } of invalidTransitions) {
      test(
        `${label} - ${action} on ${setup} payment returns 422 (already ${currentStatus})`,
        { tag: ['@api', '@state-machine', '@critical'] },
        async ({ request }) => {
          // Arrange
          const { payment } =
            setup === 'captured'
              ? await createAndCapture(request)
              : await createAndReject(request);

          // Act
          const response = await request.post(`/payments/${payment.payment_id}/${action}`);

          // Assert
          expect(response.status()).toBe(422);
          const body = await response.json();
          expect(body.error).toContain(`already ${currentStatus}`);
        },
      );
    }
  });

  // ---------------------------------------------------------------------------
  // CT37 — Capture non-existent payment → 404
  // ---------------------------------------------------------------------------
  test(
    'CT37 - capturing a non-existent payment_id returns 404',
    { tag: ['@api', '@state-machine'] },
    async ({ request }) => {
      // Act
      const response = await request.post('/payments/pay_doesnotexist/capture');

      // Assert
      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('not found');
    },
  );

  // ---------------------------------------------------------------------------
  // CT38 — Reject non-existent payment → 404
  // ---------------------------------------------------------------------------
  test(
    'CT38 - rejecting a non-existent payment_id returns 404',
    { tag: ['@api', '@state-machine'] },
    async ({ request }) => {
      // Act
      const response = await request.post('/payments/pay_doesnotexist/reject');

      // Assert
      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('not found');
    },
  );

  // ---------------------------------------------------------------------------
  // CT39 — 422 error message references the actual current status
  //   - double-capture  → error contains "already APPROVED"
  //   - double-reject   → error contains "already FAILED"
  // ---------------------------------------------------------------------------
  test(
    'CT39 - 422 error message names the current status ("already APPROVED" / "already FAILED")',
    { tag: ['@api', '@state-machine'] },
    async ({ request }) => {
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
    },
  );

  // ---------------------------------------------------------------------------
  // CT40 — GET after capture reflects APPROVED status (state is persisted)
  // ---------------------------------------------------------------------------
  test(
    'CT40 - GET /payments/{id} after capture returns status APPROVED',
    { tag: ['@api', '@state-machine'] },
    async ({ request }) => {
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
    },
  );

  // ---------------------------------------------------------------------------
  // CT62 — GET non-existent payment → 404 with error message
  // ---------------------------------------------------------------------------
  test(
    'CT62 - GET /payments/{id} for non-existent payment returns 404',
    { tag: ['@api', '@state-machine'] },
    async ({ request }) => {
      // Act
      const response = await request.get('/payments/pay_00000000000000000000000000000000');

      // Assert
      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('not found');
    },
  );
});
