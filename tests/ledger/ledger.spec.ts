import { test, expect } from '@playwright/test';
import {
  createAndCapture,
  createAndReject,
  createPending,
} from '../helpers/payment-helpers';

// ---------------------------------------------------------------------------
// CT45–CT52 — Ledger endpoint: GET /ledger/{payment_id}
// ---------------------------------------------------------------------------

test.describe('Ledger endpoint', () => {
  // ─── CT45 ──────────────────────────────────────────────────────────────
  // Happy path: captured payment returns 200 with expected response shape.
  test(
    'CT45 — captured payment returns 200 with payment_id and entries array',
    { tag: ['@ledger', '@smoke', '@critical'] },
    async ({ request }) => {
      // Arrange
      const { payment } = await createAndCapture(request);

      // Act
      const res = await request.get(`/ledger/${payment.payment_id}`);

      // Assert
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('payment_id', payment.payment_id);
      expect(body).toHaveProperty('entries');
      expect(Array.isArray(body.entries)).toBe(true);
      expect(body.entries.length).toBeGreaterThan(0);
    },
  );

  // ─── CT46 ──────────────────────────────────────────────────────────────
  // Entry count: 1 debit + 1 credit per split recipient.
  test(
    'CT46 — entry count equals 1 debit plus one credit per split item',
    { tag: ['@ledger'] },
    async ({ request }) => {
      // Arrange
      const split = [
        { recipient: 'seller_1', percentage: 80 },
        { recipient: 'platform', percentage: 20 },
      ];
      const { payment } = await createAndCapture(request, { split });

      // Act
      const res = await request.get(`/ledger/${payment.payment_id}`);
      const body = await res.json();

      // Assert — 1 debit + 2 credits = 3 entries total
      expect(body.entries).toHaveLength(1 + split.length);
    },
  );

  // ─── CT47 ──────────────────────────────────────────────────────────────
  // Debit entry: type="debit", account="customer", amount=full payment amount.
  test(
    'CT47 — debit entry has correct type, account, and full payment amount',
    { tag: ['@ledger', '@critical'] },
    async ({ request }) => {
      // Arrange
      const amount = 10000;
      const { payment } = await createAndCapture(request, { amount });

      // Act
      const res = await request.get(`/ledger/${payment.payment_id}`);
      const { entries } = await res.json();

      // Assert
      const debit = entries.find((e: { type: string }) => e.type === 'debit');
      expect(debit).toBeDefined();
      expect(debit.account).toBe('customer');
      expect(debit.amount).toBe(amount);
    },
  );

  // ─── CT48 ──────────────────────────────────────────────────────────────
  // Credit entries: type="credit", accounts match split recipients,
  // amounts = Math.round(total * percentage / 100).
  test(
    'CT48 — credit entries match recipients and computed amounts',
    { tag: ['@ledger', '@critical'] },
    async ({ request }) => {
      // Arrange
      const amount = 10000;
      const split = [
        { recipient: 'seller_1', percentage: 80 }, // 8000
        { recipient: 'platform', percentage: 20 },  // 2000
      ];
      const { payment } = await createAndCapture(request, { amount, split });

      // Act
      const res = await request.get(`/ledger/${payment.payment_id}`);
      const { entries } = await res.json();

      // Assert
      const credits = entries.filter((e: { type: string }) => e.type === 'credit');
      expect(credits).toHaveLength(split.length);

      for (const item of split) {
        const expectedAmount = Math.round((amount * item.percentage) / 100);
        const credit = credits.find((e: { account: string }) => e.account === item.recipient);
        expect(credit, `credit for ${item.recipient} should exist`).toBeDefined();
        expect(credit.amount).toBe(expectedAmount);
      }
    },
  );

  // ─── CT49 ──────────────────────────────────────────────────────────────
  // Accounting balance: sum of credits equals the debit amount.
  test(
    'CT49 — sum of credit amounts equals the debit amount',
    { tag: ['@ledger', '@critical'] },
    async ({ request }) => {
      // Arrange
      const { payment } = await createAndCapture(request);

      // Act
      const res = await request.get(`/ledger/${payment.payment_id}`);
      const { entries } = await res.json();

      // Assert
      const debit       = entries.find((e: { type: string }) => e.type === 'debit');
      const credits     = entries.filter((e: { type: string }) => e.type === 'credit');
      const creditTotal = credits.reduce((sum: number, e: { amount: number }) => sum + e.amount, 0);

      expect(creditTotal).toBe(debit.amount);
    },
  );

  // ─── CT50 ──────────────────────────────────────────────────────────────
  // Unknown payment ID → 404 with error field.
  test(
    'CT50 — unknown payment ID returns 404',
    { tag: ['@ledger'] },
    async ({ request }) => {
      // Act
      const res = await request.get('/ledger/pay_does_not_exist');

      // Assert
      expect(res.status()).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty('error');
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);
    },
  );

  // ─── CT51 ──────────────────────────────────────────────────────────────
  // PENDING payment (created but not yet captured) → 404.
  // Ledger entries are only written on capture.
  test(
    'CT51 — PENDING payment has no ledger entries (404)',
    { tag: ['@ledger'] },
    async ({ request }) => {
      // Arrange
      const { payment_id } = await createPending(request);

      // Act
      const res = await request.get(`/ledger/${payment_id}`);

      // Assert
      expect(res.status()).toBe(404);
    },
  );

  // ─── CT52 ──────────────────────────────────────────────────────────────
  // Rejected payment → 404. Reject never writes ledger entries.
  test(
    'CT52 — rejected payment has no ledger entries (404)',
    { tag: ['@ledger'] },
    async ({ request }) => {
      // Arrange
      const { payment } = await createAndReject(request);

      // Act
      const res = await request.get(`/ledger/${payment.payment_id}`);

      // Assert
      expect(res.status()).toBe(404);
    },
  );
});
