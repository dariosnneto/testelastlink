import { test, expect } from '@playwright/test';
import { validPaymentPayload, uniqueKey } from '../helpers/payment-helpers';

test.describe('Payment Creation', () => {
  // ---------------------------------------------------------------------------
  // CT01 — Happy path: valid payload returns 201 with all expected fields
  // ---------------------------------------------------------------------------
  test(
    'CT01 - valid payment returns 201 with correct response shape',
    { tag: ['@smoke', '@api', '@creation', '@critical'] },
    async ({ request }) => {
      // Arrange
      const payload = validPaymentPayload();

      // Act
      const response = await request.post('/payments', { data: payload });

      // Assert — status
      expect(response.status()).toBe(201);

      // Assert — body shape
      const body = await response.json();
      expect(body.payment_id).toMatch(/^pay_[0-9a-f]{32}$/);
      expect(body.status).toBe('PENDING');
      expect(body.amount).toBe(payload.amount);
      expect(body.currency).toBe(payload.currency);
      expect(body.customer_id).toBe(payload.customer_id);
      expect(body.merchant_id).toBe(payload.merchant_id);
      expect(body.split).toHaveLength(2);
      expect(body.split[0]).toEqual({ recipient: 'seller_1', percentage: 80 });
      expect(body.split[1]).toEqual({ recipient: 'platform', percentage: 20 });
      expect(new Date(body.created_at).getTime()).not.toBeNaN();
    },
  );

  // ---------------------------------------------------------------------------
  // CT02 — Validation: amount = 0 returns 400
  // ---------------------------------------------------------------------------
  test(
    'CT02 - amount = 0 returns 400 with error',
    { tag: ['@api', '@validation'] },
    async ({ request }) => {
      // Arrange
      const payload = validPaymentPayload({ amount: 0 });

      // Act
      const response = await request.post('/payments', { data: payload });

      // Assert
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('Amount must be greater than 0');
    },
  );

  // ---------------------------------------------------------------------------
  // CT03 — Validation: invalid currency returns 400
  // ---------------------------------------------------------------------------
  test(
    'CT03 - currency != BRL returns 400 with error',
    { tag: ['@api', '@validation'] },
    async ({ request }) => {
      // Arrange
      const payload = validPaymentPayload({ currency: 'USD' });

      // Act
      const response = await request.post('/payments', { data: payload });

      // Assert
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('Currency must be BRL');
    },
  );

  // ---------------------------------------------------------------------------
  // CT04 — Validation: split percentages don't sum to 100 returns 400
  // ---------------------------------------------------------------------------
  test(
    'CT04 - split percentages != 100 returns 400 with error',
    { tag: ['@api', '@validation'] },
    async ({ request }) => {
      // Arrange
      const payload = validPaymentPayload({
        split: [
          { recipient: 'seller_1', percentage: 70 },
          { recipient: 'platform', percentage: 20 }, // total = 90
        ],
      });

      // Act
      const response = await request.post('/payments', { data: payload });

      // Assert
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('Split percentages must sum to 100');
    },
  );

  // ---------------------------------------------------------------------------
  // CT05 — Idempotency: same key + same payload → 201 with same payment_id
  // ---------------------------------------------------------------------------
  test(
    'CT05 - same Idempotency-Key + same payload returns 201 with original payment',
    { tag: ['@api', '@idempotency'] },
    async ({ request }) => {
      // Arrange
      const key = uniqueKey('ct05');
      const payload = validPaymentPayload();

      // Act — first request
      const first = await request.post('/payments', {
        headers: { 'Idempotency-Key': key },
        data: payload,
      });

      // Act — second request (identical)
      const second = await request.post('/payments', {
        headers: { 'Idempotency-Key': key },
        data: payload,
      });

      // Assert
      expect(first.status()).toBe(201);
      expect(second.status()).toBe(201);

      const firstBody = await first.json();
      const secondBody = await second.json();
      expect(secondBody.payment_id).toBe(firstBody.payment_id);
    },
  );

  // ---------------------------------------------------------------------------
  // CT06 — Idempotency conflict: same key + different payload → 409
  // ---------------------------------------------------------------------------
  test(
    'CT06 - same Idempotency-Key + different payload returns 409',
    { tag: ['@api', '@idempotency', '@critical'] },
    async ({ request }) => {
      // Arrange
      const key = uniqueKey('ct06');

      // Act — first request
      await request.post('/payments', {
        headers: { 'Idempotency-Key': key },
        data: validPaymentPayload({ amount: 10000 }),
      });

      // Act — second request with different amount
      const second = await request.post('/payments', {
        headers: { 'Idempotency-Key': key },
        data: validPaymentPayload({ amount: 20000 }),
      });

      // Assert
      expect(second.status()).toBe(409);
      const body = await second.json();
      expect(body.error).toContain('Idempotency key already used with a different payload');
    },
  );

  // ---------------------------------------------------------------------------
  // CT07 — No Idempotency-Key: each request creates a distinct payment
  // ---------------------------------------------------------------------------
  test(
    'CT07 - omitting Idempotency-Key creates a new payment on every request',
    { tag: ['@api', '@creation'] },
    async ({ request }) => {
      // Arrange
      const payload = validPaymentPayload();

      // Act — two requests with no idempotency key
      const first = await request.post('/payments', { data: payload });
      const second = await request.post('/payments', { data: payload });

      // Assert — both succeed and produce different IDs
      expect(first.status()).toBe(201);
      expect(second.status()).toBe(201);

      const firstBody = await first.json();
      const secondBody = await second.json();
      expect(secondBody.payment_id).not.toBe(firstBody.payment_id);
    },
  );

  // ---------------------------------------------------------------------------
  // CT58 — Boundary: lowercase currency is normalised and accepted
  // The handler calls .ToUpperInvariant() before Money validation, so "brl" → "BRL".
  // ---------------------------------------------------------------------------
  test(
    'CT58 - currency "brl" (lowercase) returns 201 normalised to BRL',
    { tag: ['@api', '@validation'] },
    async ({ request }) => {
      // Arrange
      const payload = validPaymentPayload({ currency: 'brl' });

      // Act
      const response = await request.post('/payments', { data: payload });

      // Assert
      expect(response.status()).toBe(201);
      const body = await response.json();
      expect(body.currency).toBe('BRL');
    },
  );

  // ---------------------------------------------------------------------------
  // CT59 — Response contract: POST /payments returns Content-Type application/json
  // ---------------------------------------------------------------------------
  test(
    'CT59 - POST /payments response has Content-Type application/json',
    { tag: ['@api', '@creation'] },
    async ({ request }) => {
      // Act
      const response = await request.post('/payments', { data: validPaymentPayload() });

      // Assert
      expect(response.status()).toBe(201);
      expect(response.headers()['content-type']).toContain('application/json');
    },
  );
});
