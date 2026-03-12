import { expect, type APIRequestContext } from '@playwright/test';

// ---------------------------------------------------------------------------
// Payload builder
// ---------------------------------------------------------------------------

export interface SplitItem {
  recipient: string;
  percentage: number;
}

export interface PaymentPayload {
  amount: number;
  currency: string;
  customer_id: string;
  merchant_id: string;
  split: SplitItem[];
}

export interface PaymentResponse {
  payment_id: string;
  status: string;
  amount: number;
  currency: string;
  customer_id: string;
  merchant_id: string;
  split: SplitItem[];
  created_at: string;
}

export function validPaymentPayload(overrides: Partial<PaymentPayload> = {}): PaymentPayload {
  return {
    amount: 10000,
    currency: 'BRL',
    customer_id: 'cus_123',
    merchant_id: 'merch_456',
    split: [
      { recipient: 'seller_1', percentage: 80 },
      { recipient: 'platform', percentage: 20 },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Idempotency key generator
// ---------------------------------------------------------------------------

export function uniqueKey(prefix = 'key'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Shortcut helpers
// ---------------------------------------------------------------------------

export async function createAndCapture(request: APIRequestContext, overrides: Partial<PaymentPayload> = {}) {
  const createRes = await request.post('/payments', {
    headers: { 'Idempotency-Key': uniqueKey() },
    data: validPaymentPayload(overrides),
  });

  const payment = await createRes.json();
  const captureRes = await request.post(`/payments/${payment.payment_id}/capture`);
  return { createRes, captureRes, payment: (await captureRes.json()) as PaymentResponse };
}

export async function createPending(
  request: APIRequestContext,
  overrides: Partial<PaymentPayload> = {},
): Promise<PaymentResponse> {
  const res = await request.post('/payments', {
    headers: { 'Idempotency-Key': uniqueKey('pending') },
    data: validPaymentPayload(overrides),
  });
  expect(res.status()).toBe(201);
  return res.json();
}

export async function createAndReject(request: APIRequestContext, overrides: Partial<PaymentPayload> = {}) {
  const createRes = await request.post('/payments', {
    headers: { 'Idempotency-Key': uniqueKey() },
    data: validPaymentPayload(overrides),
  });

  const payment = await createRes.json();
  const rejectRes = await request.post(`/payments/${payment.payment_id}/reject`);
  return { createRes, rejectRes, payment: (await rejectRes.json()) as PaymentResponse };
}

// ---------------------------------------------------------------------------
// Webhook sink control
// ---------------------------------------------------------------------------

export type WebhookMode = 'ok' | '500' | 'timeout';

export async function setWebhookMode(request: APIRequestContext, mode: WebhookMode): Promise<void> {
  await request.post('http://localhost:4000/control', {
    data: { mode },
  });
}

// ---------------------------------------------------------------------------
// Polling — prefer over fixed sleep() when an observable condition exists
// ---------------------------------------------------------------------------

export async function pollUntil(
  fn: () => Promise<boolean>,
  { timeout = 10_000, interval = 250, label = 'condition' } = {},
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`pollUntil: "${label}" not satisfied within ${timeout}ms`);
}

// ---------------------------------------------------------------------------
// Timing — use only when polling is not possible (e.g. waiting for a
// background retry loop whose completion has no observable API signal)
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
