# Mock Payments API

Mock Payments API for QA automation challenges. Built with ASP.NET Core (.NET 8), runs fully in Docker with no external dependencies.

---

## Requirements

- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/)

---

## Run

```bash
git clone https://github.com/lastlink-team/mock-payments-api
cd mock-payments-api
docker compose up
```

API: http://localhost:3000
Webhook sink: http://localhost:4000/webhook

---

## Endpoints

### POST /payments — Create a payment

```bash
curl -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: key-001" \
  -d @examples/payment-request.json
```

**Body:**
```json
{
  "amount": 10000,
  "currency": "BRL",
  "customer_id": "cus_123",
  "merchant_id": "merch_456",
  "split": [
    { "recipient": "seller_1", "percentage": 80 },
    { "recipient": "platform", "percentage": 20 }
  ]
}
```

**Validation rules:**
- `amount` must be > 0
- `currency` must be `BRL`
- `split` percentages must sum to 100

**Idempotency:**
- Same `Idempotency-Key` + same payload → returns the original payment (HTTP 200)
- Same `Idempotency-Key` + different payload → HTTP 409

---

### GET /payments/{payment_id} — Get a payment

```bash
curl http://localhost:3000/payments/pay_<id>
```

**Response:**
```json
{
  "payment_id": "pay_xxx",
  "status": "PENDING",
  "amount": 10000,
  "currency": "BRL",
  "customer_id": "cus_123",
  "merchant_id": "merch_456",
  "split": [...],
  "created_at": "2024-01-01T00:00:00Z"
}
```

Possible statuses: `PENDING`, `APPROVED`, `FAILED`

> The `Idempotency-Key` header is **optional**. If omitted, no idempotency check is applied and every request creates a new payment.

---

### POST /payments/{payment_id}/capture — Capture a payment

```bash
curl -X POST http://localhost:3000/payments/pay_<id>/capture
```

- Changes status to `APPROVED`
- Writes ledger entries (idempotent — will not duplicate)
- Fires a `payment.approved` webhook event to the sink with exponential backoff retry (1s → 3s → 5s, max 4 attempts total)

---

### POST /payments/{payment_id}/reject — Reject a payment

```bash
curl -X POST http://localhost:3000/payments/pay_<id>/reject
```

- Changes status to `FAILED`
- Only allowed from `PENDING` state; returns HTTP 422 otherwise

---

### GET /ledger/{payment_id} — Get ledger entries

```bash
curl http://localhost:3000/ledger/pay_<id>
```

**Response:**
```json
{
  "payment_id": "pay_xxx",
  "entries": [
    { "type": "debit",  "account": "customer",  "amount": 10000 },
    { "type": "credit", "account": "seller_1",  "amount": 8000  },
    { "type": "credit", "account": "platform",  "amount": 2000  }
  ]
}
```

---

## Example workflow

```bash
# 1. Create payment
PAYMENT=$(curl -s -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-001" \
  -d @examples/payment-request.json)

PAYMENT_ID=$(echo $PAYMENT | python3 -c "import sys,json; print(json.load(sys.stdin)['payment_id'])")
echo "Created: $PAYMENT_ID"

# 2. Capture it (status → APPROVED, ledger written, webhook fired)
curl -s -X POST http://localhost:3000/payments/$PAYMENT_ID/capture | python3 -m json.tool

# 3. Check ledger
curl -s http://localhost:3000/ledger/$PAYMENT_ID | python3 -m json.tool

# --- Alternatively: reject the payment (status → FAILED) ---
# curl -s -X POST http://localhost:3000/payments/$PAYMENT_ID/reject | python3 -m json.tool
```

## Simulating webhook failures

The webhook sink exposes a control endpoint to switch failure modes at runtime — no container restart required.

```bash
# Force HTTP 500 on all incoming webhooks
curl -s -X POST http://localhost:4000/control \
  -H "Content-Type: application/json" \
  -d '{"mode": "500"}'

# Force timeout (10 s delay)
curl -s -X POST http://localhost:4000/control \
  -H "Content-Type: application/json" \
  -d '{"mode": "timeout"}'

# Restore normal behaviour
curl -s -X POST http://localhost:4000/control \
  -H "Content-Type: application/json" \
  -d '{"mode": "ok"}'
```

Then trigger a capture to observe the retry logic (1 s → 3 s → 5 s, 4 attempts total) in the API container logs:

```bash
docker logs mock-payments-api --follow
```

---

## Testing areas covered

| Area | How |
|---|---|
| API automation | All endpoints have deterministic responses |
| Idempotency | `Idempotency-Key` header on POST /payments |
| Concurrency | Ledger writes are mutex-protected — safe to hammer |
| Ledger consistency | Entries are written once and never duplicated |
| Webhook retry logic | Captured payments trigger webhook with 1s/3s/5s backoff |

---

## Architecture

Clean Architecture with DDD building blocks.

```
MockPaymentsApi/
├── API/
│   ├── Controllers/
│   │   ├── PaymentsController.cs   # POST /payments, GET /payments/{id},
│   │   │                           # POST /payments/{id}/capture,
│   │   │                           # POST /payments/{id}/reject
│   │   └── LedgerController.cs     # GET /ledger/{id}
│   └── Requests/
│       └── CreatePaymentRequest.cs
├── Application/
│   ├── Ports/
│   │   ├── IIdempotencyStore.cs
│   │   └── IWebhookPort.cs
│   └── UseCases/
│       ├── CreatePayment/
│       ├── CapturePayment/
│       ├── RejectPayment/
│       ├── GetPayment/
│       └── GetLedger/
├── Domain/
│   ├── Common/        # Result
│   ├── Entities/      # Payment, LedgerEntry
│   ├── Events/        # PaymentCapturedEvent
│   ├── Repositories/  # IPaymentRepository, ILedgerRepository
│   └── ValueObjects/  # Money, SplitItem
├── Infrastructure/
│   ├── Adapters/      # WebhookAdapter (fire-and-forget + retry)
│   └── Persistence/   # InMemoryPaymentRepository, InMemoryLedgerRepository,
│                      # InMemoryIdempotencyStore
├── examples/
│   └── payment-request.json
├── Program.cs
├── Dockerfile
└── docker-compose.yml
```
