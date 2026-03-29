import { test, expect, type APIResponse } from '@playwright/test';
import { validPaymentPayload } from '../helpers/payment-helpers';

// ---------------------------------------------------------------------------
// Shared assertion — validates status is exactly 400 Bad Request and
// optionally checks that the error message contains the expected text.
// Using toBe(400) instead of toBeGreaterThanOrEqual(400): any routing bug that
// returns 404, 409, or 422 would otherwise pass silently.
// ---------------------------------------------------------------------------
async function assertValidationError(response: APIResponse, expectedMessage?: string) {
  expect(response.status()).toBe(400);
  const body = await response.json();
  expect(body.error).toBeTruthy();
  if (expectedMessage) {
    expect(body.error).toContain(expectedMessage);
  }
}

type SplitItem = { recipient: string; percentage: number };

test.describe('Payment Validation', () => {
  // ---------------------------------------------------------------------------
  // Amount validation (CT08–CT09, CT60–CT61)
  // ---------------------------------------------------------------------------
  test.describe('Amount', () => {
    // CT08–CT09: every negative value is rejected with the same rule.
    for (const { label, amount } of [
      { label: 'CT08', amount: -1 },
      { label: 'CT09', amount: -10000 },
    ]) {
      test(
        `${label} - amount = ${amount} returns 400`,
        { tag: ['@api', '@validation'] },
        async ({ request }) => {
          const response = await request.post('/payments', { data: validPaymentPayload({ amount }) });
          await assertValidationError(response, 'Amount must be greater than 0');
        },
      );
    }

    test(
      'CT60 - amount = 1 (minimum valid boundary) returns 201',
      { tag: ['@api', '@validation'] },
      async ({ request }) => {
        // Arrange — amount=1 is the lowest value Money accepts (value > 0)
        const payload = validPaymentPayload({ amount: 1 });

        // Act
        const response = await request.post('/payments', { data: payload });

        // Assert
        expect(response.status()).toBe(201);
        const body = await response.json();
        expect(body.amount).toBe(1);
      },
    );

    test(
      'CT61 - amount = Number.MAX_SAFE_INTEGER returns 201',
      { tag: ['@api', '@validation'] },
      async ({ request }) => {
        // Arrange — MAX_SAFE_INTEGER (~9e15) fits within C# long range (~9.2e18)
        const payload = validPaymentPayload({ amount: Number.MAX_SAFE_INTEGER });

        // Act
        const response = await request.post('/payments', { data: payload });

        // Assert
        expect(response.status()).toBe(201);
      },
    );
  });

  // ---------------------------------------------------------------------------
  // Currency validation (CT10–CT12)
  // ---------------------------------------------------------------------------
  test.describe('Currency', () => {
    // CT10–CT12: all non-"BRL" strings fail the same validation rule.
    // CT12 uses a trailing space; ToUpperInvariant() preserves it, so "BRL " ≠ "BRL".
    for (const { label, currency, description } of [
      { label: 'CT10', currency: '',     description: '""' },
      { label: 'CT11', currency: 'EUR',  description: '"EUR"' },
      { label: 'CT12', currency: 'BRL ', description: '"BRL " (trailing space)' },
    ]) {
      test(
        `${label} - currency = ${description} returns 400`,
        { tag: ['@api', '@validation'] },
        async ({ request }) => {
          const response = await request.post('/payments', { data: validPaymentPayload({ currency }) });
          await assertValidationError(response, 'Currency must be BRL');
        },
      );
    }
  });

  // ---------------------------------------------------------------------------
  // Split sum validation (CT13–CT16)
  // ---------------------------------------------------------------------------
  test.describe('Split sum', () => {
    // All four cases trigger the same "must sum to 100" rule; the split arrays
    // differ to cover zero, under, and over boundary values.
    for (const { label, description, split } of [
      {
        label: 'CT13',
        description: 'empty split array (sum = 0)',
        split: [] as SplitItem[],
      },
      {
        label: 'CT14',
        description: 'single item at 50% (sum = 50)',
        split: [{ recipient: 'seller_1', percentage: 50 }],
      },
      {
        label: 'CT15',
        description: 'two items summing to 99',
        split: [
          { recipient: 'seller_1', percentage: 79 },
          { recipient: 'platform', percentage: 20 },
        ],
      },
      {
        label: 'CT16',
        description: 'two items summing to 101',
        split: [
          { recipient: 'seller_1', percentage: 81 },
          { recipient: 'platform', percentage: 20 },
        ],
      },
    ]) {
      test(
        `${label} - ${description} returns 400`,
        { tag: ['@api', '@validation'] },
        async ({ request }) => {
          const response = await request.post('/payments', { data: validPaymentPayload({ split }) });
          await assertValidationError(response, 'Split percentages must sum to 100');
        },
      );
    }
  });

  // ---------------------------------------------------------------------------
  // Split item — percentage range (CT17–CT19)
  // ---------------------------------------------------------------------------
  test.describe('Split item — percentage range', () => {
    // CT17–CT19: item-level validation rejects percentages outside [1, 100].
    // Note: CT18 sets the second item to 101 so the sum check does not fire
    // before the item check — isolating the per-item validation path.
    for (const { label, description, split } of [
      {
        label: 'CT17',
        description: 'percentage = 0',
        split: [
          { recipient: 'seller_1', percentage: 0 },
          { recipient: 'platform', percentage: 100 },
        ],
      },
      {
        label: 'CT18',
        description: 'percentage = -1',
        split: [
          { recipient: 'seller_1', percentage: -1 },
          { recipient: 'platform', percentage: 101 },
        ],
      },
      {
        label: 'CT19',
        description: 'percentage = 101',
        split: [{ recipient: 'seller_1', percentage: 101 }],
      },
    ]) {
      test(
        `${label} - split item ${description} returns 400`,
        { tag: ['@api', '@validation'] },
        async ({ request }) => {
          const response = await request.post('/payments', { data: validPaymentPayload({ split }) });
          await assertValidationError(response, 'Percentage must be between 1 and 100');
        },
      );
    }
  });

  // ---------------------------------------------------------------------------
  // Split item — recipient (CT20–CT21)
  // ---------------------------------------------------------------------------
  test.describe('Split item — recipient', () => {
    // CT20–CT21: empty string and whitespace-only strings both fail the same
    // IsNullOrWhiteSpace check in the domain layer.
    for (const { label, recipient, description } of [
      { label: 'CT20', recipient: '',    description: '""' },
      { label: 'CT21', recipient: '   ', description: 'whitespace ("   ")' },
    ]) {
      test(
        `${label} - split item recipient = ${description} returns 400`,
        { tag: ['@api', '@validation'] },
        async ({ request }) => {
          const response = await request.post('/payments', {
            data: validPaymentPayload({
              split: [
                { recipient, percentage: 80 },
                { recipient: 'platform', percentage: 20 },
              ],
            }),
          });
          await assertValidationError(response, 'Recipient is required');
        },
      );
    }
  });

  // ---------------------------------------------------------------------------
  // Cross-field / structural validation (CT22–CT24)
  // ---------------------------------------------------------------------------
  test.describe('Cross-field / structural', () => {
    // CT22 — Item-level validation fires before sum check.
    // Split has a 0% item; sum would equal 100 if 0% were allowed.
    // Proves item validation runs before the sum check.
    test(
      'CT22 - 0% item rejected even when remaining items sum to 100',
      { tag: ['@api', '@validation'] },
      async ({ request }) => {
        // Arrange — sum = 50+50+0 = 100, but 0% is individually invalid
        const payload = validPaymentPayload({
          split: [
            { recipient: 'seller_1', percentage: 50 },
            { recipient: 'seller_2', percentage: 50 },
            { recipient: 'platform', percentage: 0 },
          ],
        });

        // Act
        const response = await request.post('/payments', { data: payload });

        // Assert
        await assertValidationError(response, 'Percentage must be between 1 and 100');
      },
    );

    // CT23 — Empty body: amount defaults to 0 in C#, which fails the amount check first.
    test(
      'CT23 - empty body {} returns 400',
      { tag: ['@api', '@validation'] },
      async ({ request }) => {
        // Act
        const response = await request.post('/payments', { data: {} });

        // Assert — amount defaults to 0 → "Amount must be greater than 0."
        await assertValidationError(response, 'Amount must be greater than 0');
      },
    );

    // CT24 — Body without split field: split defaults to [] in C# (sum = 0 ≠ 100).
    test(
      'CT24 - body without split field returns 400 (split defaults to [], sum=0)',
      { tag: ['@api', '@validation'] },
      async ({ request }) => {
        // Arrange
        const { split: _, ...payloadWithoutSplit } = validPaymentPayload();

        // Act
        const response = await request.post('/payments', { data: payloadWithoutSplit });

        // Assert
        await assertValidationError(response, 'Split percentages must sum to 100');
      },
    );
  });
});
