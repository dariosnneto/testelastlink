import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  validPaymentPayload,
  uniqueKey,
  createAndCapture,
  createAndReject,
  type PaymentResponse,
} from '../helpers/payment-helpers';

// Local helper: creates a fresh PENDING payment and asserts creation succeeded.
async function createPayment(request: APIRequestContext): Promise<PaymentResponse> {
  const res = await request.post('/payments', {
    headers: { 'Idempotency-Key': uniqueKey() },
    data: validPaymentPayload(),
  });
  expect(res.status()).toBe(201);
  return res.json();
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
  //   "Payment is already {STATUS}." — asserted via toContain(`already ${currentStatus}`)
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
  // CT40 — State is persisted: GET after capture reflects APPROVED
  //
  // CT33-CT36 already cover the 422 error messages for invalid transitions,
  // so no separate "CT39" is needed — it would duplicate those assertions.
  // ---------------------------------------------------------------------------
  test(
    'CT40 - GET /payments/{id} after capture returns status APPROVED',
    { tag: ['@api', '@state-machine'] },
    async ({ request }) => {
      // Arrange — create payment and bring it to APPROVED state
      const { payment_id } = await createPayment(request);
      await request.post(`/payments/${payment_id}/capture`);

      // Act — read back the persisted state
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
