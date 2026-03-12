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

test.describe('Payment Validation', () => {
  // ---------------------------------------------------------------------------
  // Amount validation (CT08–CT09, CT60–CT61)
  // ---------------------------------------------------------------------------
  test.describe('Amount', () => {
    test(
      'CT08 - amount = -1 returns 400',
      { tag: ['@api', '@validation'] },
      async ({ request }) => {
        // Arrange
        const payload = validPaymentPayload({ amount: -1 });

        // Act
        const response = await request.post('/payments', { data: payload });

        // Assert
        await assertValidationError(response, 'Amount must be greater than 0');
      },
    );

    test(
      'CT09 - amount = -10000 returns 400',
      { tag: ['@api', '@validation'] },
      async ({ request }) => {
        // Arrange
        const payload = validPaymentPayload({ amount: -10000 });

        // Act
        const response = await request.post('/payments', { data: payload });

        // Assert
        await assertValidationError(response, 'Amount must be greater than 0');
      },
    );

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
    test(
      'CT10 - currency = "" returns 400',
      { tag: ['@api', '@validation'] },
      async ({ request }) => {
        // Arrange
        const payload = validPaymentPayload({ currency: '' });

        // Act
        const response = await request.post('/payments', { data: payload });

        // Assert
        await assertValidationError(response, 'Currency must be BRL');
      },
    );

    test(
      'CT11 - currency = "EUR" returns 400',
      { tag: ['@api', '@validation'] },
      async ({ request }) => {
        // Arrange
        const payload = validPaymentPayload({ currency: 'EUR' });

        // Act
        const response = await request.post('/payments', { data: payload });

        // Assert
        await assertValidationError(response, 'Currency must be BRL');
      },
    );

    test(
      'CT12 - currency = "BRL " (trailing space) returns 400',
      { tag: ['@api', '@validation'] },
      async ({ request }) => {
        // Arrange — ToUpperInvariant() preserves the space, so "BRL " ≠ "BRL"
        const payload = validPaymentPayload({ currency: 'BRL ' });

        // Act
        const response = await request.post('/payments', { data: payload });

        // Assert
        await assertValidationError(response, 'Currency must be BRL');
      },
    );
  });

  // ---------------------------------------------------------------------------
  // Split sum validation (CT13–CT16)
  // ---------------------------------------------------------------------------
  test.describe('Split sum', () => {
    test(
      'CT13 - empty split array returns 400 (sum = 0)',
      { tag: ['@api', '@validation'] },
      async ({ request }) => {
        // Arrange
        const payload = validPaymentPayload({ split: [] });

        // Act
        const response = await request.post('/payments', { data: payload });

        // Assert
        await assertValidationError(response, 'Split percentages must sum to 100');
      },
    );

    test(
      'CT14 - single split item at 50% returns 400 (sum = 50)',
      { tag: ['@api', '@validation'] },
      async ({ request }) => {
        // Arrange
        const payload = validPaymentPayload({
          split: [{ recipient: 'seller_1', percentage: 50 }],
        });

        // Act
        const response = await request.post('/payments', { data: payload });

        // Assert
        await assertValidationError(response, 'Split percentages must sum to 100');
      },
    );

    test(
      'CT15 - split percentages sum to 99 returns 400',
      { tag: ['@api', '@validation'] },
      async ({ request }) => {
        // Arrange
        const payload = validPaymentPayload({
          split: [
            { recipient: 'seller_1', percentage: 79 },
            { recipient: 'platform', percentage: 20 }, // total = 99
          ],
        });

        // Act
        const response = await request.post('/payments', { data: payload });

        // Assert
        await assertValidationError(response, 'Split percentages must sum to 100');
      },
    );

    test(
      'CT16 - split percentages sum to 101 returns 400',
      { tag: ['@api', '@validation'] },
      async ({ request }) => {
        // Arrange
        const payload = validPaymentPayload({
          split: [
            { recipient: 'seller_1', percentage: 81 },
            { recipient: 'platform', percentage: 20 }, // total = 101
          ],
        });

        // Act
        const response = await request.post('/payments', { data: payload });

        // Assert
        await assertValidationError(response, 'Split percentages must sum to 100');
      },
    );
  });

  // ---------------------------------------------------------------------------
  // Split item — percentage range (CT17–CT19)
  // ---------------------------------------------------------------------------
  test.describe('Split item — percentage range', () => {
    test(
      'CT17 - split item percentage = 0 returns 400',
      { tag: ['@api', '@validation'] },
      async ({ request }) => {
        // Arrange
        const payload = validPaymentPayload({
          split: [
            { recipient: 'seller_1', percentage: 0 },
            { recipient: 'platform', percentage: 100 },
          ],
        });

        // Act
        const response = await request.post('/payments', { data: payload });

        // Assert
        await assertValidationError(response, 'Percentage must be between 1 and 100');
      },
    );

    test(
      'CT18 - split item percentage = -1 returns 400',
      { tag: ['@api', '@validation'] },
      async ({ request }) => {
        // Arrange
        const payload = validPaymentPayload({
          split: [
            { recipient: 'seller_1', percentage: -1 },
            { recipient: 'platform', percentage: 101 },
          ],
        });

        // Act
        const response = await request.post('/payments', { data: payload });

        // Assert
        await assertValidationError(response, 'Percentage must be between 1 and 100');
      },
    );

    test(
      'CT19 - split item percentage = 101 returns 400',
      { tag: ['@api', '@validation'] },
      async ({ request }) => {
        // Arrange
        const payload = validPaymentPayload({
          split: [{ recipient: 'seller_1', percentage: 101 }],
        });

        // Act
        const response = await request.post('/payments', { data: payload });

        // Assert
        await assertValidationError(response, 'Percentage must be between 1 and 100');
      },
    );
  });

  // ---------------------------------------------------------------------------
  // Split item — recipient (CT20–CT21)
  // ---------------------------------------------------------------------------
  test.describe('Split item — recipient', () => {
    test(
      'CT20 - split item recipient = "" returns 400',
      { tag: ['@api', '@validation'] },
      async ({ request }) => {
        // Arrange
        const payload = validPaymentPayload({
          split: [
            { recipient: '', percentage: 80 },
            { recipient: 'platform', percentage: 20 },
          ],
        });

        // Act
        const response = await request.post('/payments', { data: payload });

        // Assert
        await assertValidationError(response, 'Recipient is required');
      },
    );

    test(
      'CT21 - split item recipient = whitespace returns 400',
      { tag: ['@api', '@validation'] },
      async ({ request }) => {
        // Arrange — string.IsNullOrWhiteSpace catches "   "
        const payload = validPaymentPayload({
          split: [
            { recipient: '   ', percentage: 80 },
            { recipient: 'platform', percentage: 20 },
          ],
        });

        // Act
        const response = await request.post('/payments', { data: payload });

        // Assert
        await assertValidationError(response, 'Recipient is required');
      },
    );
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
