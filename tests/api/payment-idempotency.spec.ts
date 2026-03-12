import { test, expect } from '@playwright/test';
import { validPaymentPayload, uniqueKey } from '../helpers/payment-helpers';

test.describe('Payment Idempotency', () => {
  // ---------------------------------------------------------------------------
  // CT25 — Triple replay: three identical requests return the same payment
  // ---------------------------------------------------------------------------
  test(
    'CT25 - three requests with same key + payload all return the same payment_id',
    { tag: ['@api', '@idempotency'] },
    async ({ request }) => {
      // Arrange
      const key = uniqueKey('ct25');
      const payload = validPaymentPayload();

      // Act
      const r1 = await request.post('/payments', { headers: { 'Idempotency-Key': key }, data: payload });
      const r2 = await request.post('/payments', { headers: { 'Idempotency-Key': key }, data: payload });
      const r3 = await request.post('/payments', { headers: { 'Idempotency-Key': key }, data: payload });

      // Assert — all succeed
      expect(r1.status()).toBe(201);
      expect(r2.status()).toBe(201);
      expect(r3.status()).toBe(201);

      // Assert — all return the same payment
      const id1 = (await r1.json()).payment_id;
      const id2 = (await r2.json()).payment_id;
      const id3 = (await r3.json()).payment_id;
      expect(id2).toBe(id1);
      expect(id3).toBe(id1);
    },
  );

  // ---------------------------------------------------------------------------
  // CT26 — Replay returns an identical full response (not just the same ID)
  // ---------------------------------------------------------------------------
  test(
    'CT26 - idempotent replay returns identical amount, currency, split, status and created_at',
    { tag: ['@api', '@idempotency'] },
    async ({ request }) => {
      // Arrange
      const key = uniqueKey('ct26');
      const payload = validPaymentPayload();

      // Act
      const original = await request.post('/payments', { headers: { 'Idempotency-Key': key }, data: payload });
      const replay   = await request.post('/payments', { headers: { 'Idempotency-Key': key }, data: payload });

      // Assert
      expect(original.status()).toBe(201);
      expect(replay.status()).toBe(201);

      const orig = await original.json();
      const rep  = await replay.json();

      expect(rep.payment_id).toBe(orig.payment_id);
      expect(rep.status).toBe(orig.status);
      expect(rep.amount).toBe(orig.amount);
      expect(rep.currency).toBe(orig.currency);
      expect(rep.customer_id).toBe(orig.customer_id);
      expect(rep.merchant_id).toBe(orig.merchant_id);
      expect(rep.split).toEqual(orig.split);
      expect(rep.created_at).toBe(orig.created_at);
    },
  );

  // ---------------------------------------------------------------------------
  // CT27 — Different keys + same payload create independent payments
  // ---------------------------------------------------------------------------
  test(
    'CT27 - different Idempotency-Keys with the same payload produce different payments',
    { tag: ['@api', '@idempotency'] },
    async ({ request }) => {
      // Arrange
      const keyA = uniqueKey('ct27a');
      const keyB = uniqueKey('ct27b');
      const payload = validPaymentPayload();

      // Act
      const rA = await request.post('/payments', { headers: { 'Idempotency-Key': keyA }, data: payload });
      const rB = await request.post('/payments', { headers: { 'Idempotency-Key': keyB }, data: payload });

      // Assert — both succeed with distinct IDs
      expect(rA.status()).toBe(201);
      expect(rB.status()).toBe(201);
      expect((await rA.json()).payment_id).not.toBe((await rB.json()).payment_id);
    },
  );

  // ---------------------------------------------------------------------------
  // CT28 — After a conflict attempt, the original key still replays correctly
  //
  // Sequence:
  //   1. POST key=K, payload=A → 201 (creates P1)
  //   2. POST key=K, payload=B → 409 (conflict, key state unchanged)
  //   3. POST key=K, payload=A → 201 (still returns P1)
  // ---------------------------------------------------------------------------
  test(
    'CT28 - conflict attempt does not corrupt the key; original payload still replays',
    { tag: ['@api', '@idempotency'] },
    async ({ request }) => {
      // Arrange
      const key      = uniqueKey('ct28');
      const payloadA = validPaymentPayload({ amount: 10000 });
      const payloadB = validPaymentPayload({ amount: 20000 }); // different — will conflict

      // Act
      const original     = await request.post('/payments', { headers: { 'Idempotency-Key': key }, data: payloadA });
      const conflict     = await request.post('/payments', { headers: { 'Idempotency-Key': key }, data: payloadB });
      const afterConflict = await request.post('/payments', { headers: { 'Idempotency-Key': key }, data: payloadA });

      // Assert
      expect(original.status()).toBe(201);
      expect(conflict.status()).toBe(409);
      expect(afterConflict.status()).toBe(201);

      const originalId      = (await original.json()).payment_id;
      const afterConflictId = (await afterConflict.json()).payment_id;
      expect(afterConflictId).toBe(originalId);
    },
  );

  // ---------------------------------------------------------------------------
  // CT29 — Idempotency key is case-sensitive
  // "KEY-1" and "key-1" are treated as distinct keys.
  // ---------------------------------------------------------------------------
  test(
    'CT29 - Idempotency-Key is case-sensitive (KEY-X ≠ key-x)',
    { tag: ['@api', '@idempotency'] },
    async ({ request }) => {
      // Arrange — use a fixed suffix so the case difference is the only variable
      const suffix   = `ct29-${Date.now()}`;
      const keyUpper = `KEY-${suffix}`;
      const keyLower = `key-${suffix}`;
      const payload  = validPaymentPayload();

      // Act
      const rUpper = await request.post('/payments', { headers: { 'Idempotency-Key': keyUpper }, data: payload });
      const rLower = await request.post('/payments', { headers: { 'Idempotency-Key': keyLower }, data: payload });

      // Assert — both succeed and produce distinct payments
      expect(rUpper.status()).toBe(201);
      expect(rLower.status()).toBe(201);
      expect((await rUpper.json()).payment_id).not.toBe((await rLower.json()).payment_id);
    },
  );

  // ---------------------------------------------------------------------------
  // CT30 — Hash covers all payload fields: changing customer_id triggers 409
  // ---------------------------------------------------------------------------
  test(
    'CT30 - same key + different customer_id returns 409 (hash covers all fields)',
    { tag: ['@api', '@idempotency', '@critical'] },
    async ({ request }) => {
      // Arrange
      const key = uniqueKey('ct30');

      // Act
      const original = await request.post('/payments', {
        headers: { 'Idempotency-Key': key },
        data: validPaymentPayload({ customer_id: 'cus_original' }),
      });

      const conflict = await request.post('/payments', {
        headers: { 'Idempotency-Key': key },
        data: validPaymentPayload({ customer_id: 'cus_different' }),
      });

      // Assert
      expect(original.status()).toBe(201);
      expect(conflict.status()).toBe(409);
      const body = await conflict.json();
      expect(body.error).toContain('Idempotency key already used with a different payload');
    },
  );

  // ---------------------------------------------------------------------------
  // CT63 — Replay after capture returns the current (updated) status
  //
  // The idempotency store caches the payment_id, not a snapshot of the payment.
  // On replay, the handler fetches the live payment from the repository,
  // so the response reflects APPROVED — not the original PENDING state.
  // ---------------------------------------------------------------------------
  test(
    'CT63 - idempotency replay after capture returns status APPROVED',
    { tag: ['@api', '@idempotency'] },
    async ({ request }) => {
      // Arrange
      const key     = uniqueKey('ct63');
      const payload = validPaymentPayload();

      // Act — create original payment
      const create1 = await request.post('/payments', {
        headers: { 'Idempotency-Key': key },
        data: payload,
      });
      expect(create1.status()).toBe(201);
      const { payment_id } = await create1.json();

      // Act — capture the payment (status → APPROVED)
      await request.post(`/payments/${payment_id}/capture`);

      // Act — replay the creation with the same key
      const create2 = await request.post('/payments', {
        headers: { 'Idempotency-Key': key },
        data: payload,
      });

      // Assert — same payment returned, but now showing the live APPROVED status
      expect(create2.status()).toBe(201);
      const replayed = await create2.json();
      expect(replayed.payment_id).toBe(payment_id);
      expect(replayed.status).toBe('APPROVED');
    },
  );
});
