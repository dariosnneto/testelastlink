import { test, expect } from '@playwright/test';
import { validPaymentPayload } from '../helpers/payment-helpers';

// Shared assertion: any 4xx response with an `error` field in the body.
async function assertValidationError(response: Awaited<ReturnType<typeof import('@playwright/test').request.post>>) {
  expect(response.status()).toBeGreaterThanOrEqual(400);
  expect(response.status()).toBeLessThan(500);
  const body = await response.json();
  expect(body.error).toBeTruthy();
}

// ---------------------------------------------------------------------------
// Amount validation (CT08–CT09)
// ---------------------------------------------------------------------------

test('CT08 - amount = -1 returns 400', async ({ request }) => {
  // Arrange
  const payload = validPaymentPayload({ amount: -1 });

  // Act
  const response = await request.post('/payments', { data: payload });

  // Assert
  await assertValidationError(response);
});

test('CT09 - amount = -10000 returns 400', async ({ request }) => {
  // Arrange
  const payload = validPaymentPayload({ amount: -10000 });

  // Act
  const response = await request.post('/payments', { data: payload });

  // Assert
  await assertValidationError(response);
});

// ---------------------------------------------------------------------------
// Currency validation (CT10–CT12)
// ---------------------------------------------------------------------------

test('CT10 - currency = "" returns 400', async ({ request }) => {
  // Arrange
  const payload = validPaymentPayload({ currency: '' });

  // Act
  const response = await request.post('/payments', { data: payload });

  // Assert
  await assertValidationError(response);
});

test('CT11 - currency = "EUR" returns 400', async ({ request }) => {
  // Arrange
  const payload = validPaymentPayload({ currency: 'EUR' });

  // Act
  const response = await request.post('/payments', { data: payload });

  // Assert
  await assertValidationError(response);
});

test('CT12 - currency = "BRL " (trailing space) returns 400', async ({ request }) => {
  // Arrange — ToUpperInvariant() preserves the space, so "BRL " ≠ "BRL"
  const payload = validPaymentPayload({ currency: 'BRL ' });

  // Act
  const response = await request.post('/payments', { data: payload });

  // Assert
  await assertValidationError(response);
});

// ---------------------------------------------------------------------------
// Split sum validation (CT13–CT16)
// ---------------------------------------------------------------------------

test('CT13 - empty split array returns 400 (sum = 0)', async ({ request }) => {
  // Arrange
  const payload = validPaymentPayload({ split: [] });

  // Act
  const response = await request.post('/payments', { data: payload });

  // Assert
  await assertValidationError(response);
});

test('CT14 - single split item at 50% returns 400 (sum = 50)', async ({ request }) => {
  // Arrange
  const payload = validPaymentPayload({
    split: [{ recipient: 'seller_1', percentage: 50 }],
  });

  // Act
  const response = await request.post('/payments', { data: payload });

  // Assert
  await assertValidationError(response);
});

test('CT15 - split percentages sum to 99 returns 400', async ({ request }) => {
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
  await assertValidationError(response);
});

test('CT16 - split percentages sum to 101 returns 400', async ({ request }) => {
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
  await assertValidationError(response);
});

// ---------------------------------------------------------------------------
// Split item — percentage range (CT17–CT19)
// ---------------------------------------------------------------------------

test('CT17 - split item percentage = 0 returns 400', async ({ request }) => {
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
  await assertValidationError(response);
});

test('CT18 - split item percentage = -1 returns 400', async ({ request }) => {
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
  await assertValidationError(response);
});

test('CT19 - split item percentage = 101 returns 400', async ({ request }) => {
  // Arrange
  const payload = validPaymentPayload({
    split: [{ recipient: 'seller_1', percentage: 101 }],
  });

  // Act
  const response = await request.post('/payments', { data: payload });

  // Assert
  await assertValidationError(response);
});

// ---------------------------------------------------------------------------
// Split item — recipient (CT20–CT21)
// ---------------------------------------------------------------------------

test('CT20 - split item recipient = "" returns 400', async ({ request }) => {
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
  await assertValidationError(response);
});

test('CT21 - split item recipient = whitespace returns 400', async ({ request }) => {
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
  await assertValidationError(response);
});

// ---------------------------------------------------------------------------
// CT22 — Item-level validation fires before sum check
// Split has a 0% item; sum would equal 100 if 0% were allowed.
// Proves item validation runs before the sum check.
// ---------------------------------------------------------------------------

test('CT22 - 0% item rejected even when remaining items sum to 100', async ({ request }) => {
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
  await assertValidationError(response);
});

// ---------------------------------------------------------------------------
// CT23 — Structural: empty body defaults to amount=0 and currency=""
// ---------------------------------------------------------------------------

test('CT23 - empty body {} returns 400', async ({ request }) => {
  // Arrange — amount defaults to 0, currency to ""
  // Act
  const response = await request.post('/payments', { data: {} });

  // Assert
  await assertValidationError(response);
});

// ---------------------------------------------------------------------------
// CT24 — Structural: body without split field defaults to split=[] (sum=0)
// ---------------------------------------------------------------------------

test('CT24 - body without split field returns 400 (split defaults to [], sum=0)', async ({ request }) => {
  // Arrange
  const { split: _, ...payloadWithoutSplit } = validPaymentPayload();

  // Act
  const response = await request.post('/payments', { data: payloadWithoutSplit });

  // Assert
  await assertValidationError(response);
});
