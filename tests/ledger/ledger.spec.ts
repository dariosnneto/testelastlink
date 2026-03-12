import { test, expect } from '@playwright/test';
import {
  createAndCapture,
  createAndReject,
  createPending,
  type LedgerEntry,
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
      const { entries } = (await res.json()) as { entries: LedgerEntry[] };

      // Assert
      const debit = entries.find((e) => e.type === 'debit');
      expect(debit).toBeDefined();
      expect(debit!.account).toBe('customer');
      expect(debit!.amount).toBe(amount);
    },
  );

  // ─── CT48 ──────────────────────────────────────────────────────────────
  // Credit entries: each recipient receives the exact amount derived from the
  // business rule (percentage of total), verified against hard-coded expected
  // values — not recomputed using the same formula as the server.
  test(
    'CT48 — credit entries match recipients and correct amounts',
    { tag: ['@ledger', '@critical'] },
    async ({ request }) => {
      // Arrange — seller_1 at 80% of 10000 = 8000; platform at 20% = 2000
      const { payment } = await createAndCapture(request, {
        amount: 10000,
        split: [
          { recipient: 'seller_1', percentage: 80 },
          { recipient: 'platform', percentage: 20 },
        ],
      });

      // Act
      const res = await request.get(`/ledger/${payment.payment_id}`);
      const { entries } = (await res.json()) as { entries: LedgerEntry[] };

      // Assert — two credit entries, amounts are the business-defined values
      const credits = entries.filter((e) => e.type === 'credit');
      expect(credits).toHaveLength(2);

      const seller = credits.find((e) => e.account === 'seller_1');
      expect(seller).toBeDefined();
      expect(seller!.amount).toBe(8000); // 80% of 10000

      const platform = credits.find((e) => e.account === 'platform');
      expect(platform).toBeDefined();
      expect(platform!.amount).toBe(2000); // 20% of 10000
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
      const { entries } = (await res.json()) as { entries: LedgerEntry[] };

      // Assert
      const debit       = entries.find((e) => e.type === 'debit');
      const credits     = entries.filter((e) => e.type === 'credit');
      const creditTotal = credits.reduce((sum, e) => sum + e.amount, 0);

      expect(debit).toBeDefined();
      expect(creditTotal).toBe(debit!.amount);
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
