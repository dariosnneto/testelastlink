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

---

### POST /payments/{payment_id}/capture — Capture a payment

```bash
curl -X POST http://localhost:3000/payments/pay_<id>/capture
```

- Changes status to `APPROVED`
- Writes ledger entries (idempotent — will not duplicate)
- Fires a webhook event to the sink with exponential backoff retry (1s → 3s → 5s, max 3 retries)

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

# 2. Capture it
curl -s -X POST http://localhost:3000/payments/$PAYMENT_ID/capture | python3 -m json.tool

# 3. Check ledger
curl -s http://localhost:3000/ledger/$PAYMENT_ID | python3 -m json.tool
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

```
MockPaymentsApi/
├── Controllers/
│   ├── PaymentsController.cs   # POST /payments, GET /payments/{id}, POST /payments/{id}/capture
│   └── LedgerController.cs     # GET /ledger/{id}
├── Services/
│   ├── PaymentService.cs       # Business logic, idempotency
│   ├── LedgerService.cs        # Ledger write with concurrency guard
│   └── WebhookService.cs       # Fire-and-forget with retry
├── Models/
│   ├── Payment.cs
│   ├── Split.cs
│   └── LedgerEntry.cs
├── Store/
│   └── InMemoryStore.cs        # Thread-safe in-memory storage
├── examples/
│   └── payment-request.json
├── Program.cs
├── Dockerfile
└── docker-compose.yml
```
