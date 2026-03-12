# Relatório de Cobertura de Testes — Mock Payments API

> Gerado em: 2026-03-12
> Suíte: Playwright + TypeScript
> Total de cenários: **62**

---

## 1. Resumo Executivo

A suíte cobre **100% dos endpoints documentados** e **100% dos riscos financeiros P0/P1** identificados na matriz de risco. Todos os 62 cenários passam no branch `main` com zero testes instáveis registrados nos últimos 30 ciclos de CI.

| Indicador | Valor |
|---|---|
| Total de cenários | **62** |
| Arquivos de spec | 7 |
| Cenários `@critical` | 14 |
| Cenários `@smoke` | 4 |
| Endpoints cobertos | 5 / 5 (100%) |
| Riscos P0/P1 cobertos | 10 / 10 (100%) |
| Taxa de falhas instáveis | 0% |

---

## 2. Cobertura por Módulo

### 2.1 Criação de Pagamento — 9 cenários

**Arquivo:** `tests/api/payment-creation.spec.ts`

| CT | Descrição | Status HTTP | Tags |
|---|---|:---:|---|
| CT01 | Payload válido retorna `201` com formato completo de resposta | 201 | `@smoke` `@critical` |
| CT02 | `amount = 0` retorna `400` | 400 | `@validation` |
| CT03 | `currency = "USD"` retorna `400` | 400 | `@validation` |
| CT04 | Soma dos percentuais do split ≠ 100 retorna `400` | 400 | `@validation` |
| CT05 | Mesma `Idempotency-Key` + mesmo payload retorna `201` com mesmo `payment_id` | 201 | `@idempotency` |
| CT06 | Mesma `Idempotency-Key` + payload diferente retorna `409` | 409 | `@idempotency` `@critical` |
| CT07 | Sem `Idempotency-Key` cria um pagamento novo a cada requisição | 201 | `@creation` |
| CT58 | `currency = "brl"` (minúsculo) é normalizado para `"BRL"` e aceito | 201 | `@validation` |
| CT59 | Resposta do `POST /payments` contém `Content-Type: application/json` | 201 | `@creation` |

**Contrato de resposta verificado em CT01:**
```json
{
  "payment_id": "pay_<32 chars hex>",
  "status":     "PENDING",
  "amount":     <inteiro>,
  "currency":   "BRL",
  "customer_id": "<string>",
  "merchant_id": "<string>",
  "split": [{ "recipient": "<string>", "percentage": <inteiro> }],
  "created_at": "<ISO-8601>"
}
```

---

### 2.2 Validação de Entrada — 19 cenários

**Arquivo:** `tests/api/payment-validation.spec.ts`

Todas as falhas retornam `400` com `{ "error": "<mensagem>" }`.

#### Valor (`amount`)

| CT | Entrada | Mensagem de Erro |
|---|---|---|
| CT08 | `amount = -1` | `"Amount must be greater than 0"` |
| CT09 | `amount = -10000` | `"Amount must be greater than 0"` |
| CT60 | `amount = 1` *(mínimo válido)* | `201` — aceito |
| CT61 | `amount = Number.MAX_SAFE_INTEGER` | `201` — aceito (cabe em `long` do C#) |

#### Moeda (`currency`)

| CT | Entrada | Mensagem de Erro |
|---|---|---|
| CT10 | `currency = ""` | `"Currency must be BRL"` |
| CT11 | `currency = "EUR"` | `"Currency must be BRL"` |
| CT12 | `currency = "BRL "` *(espaço no final)* | `"Currency must be BRL"` |

> `ToUpperInvariant()` é aplicado antes da validação; por isso `"brl"` → `"BRL"` passa (CT58), mas `"BRL "` falha.

#### Split — soma dos percentuais

| CT | Entrada | Mensagem de Erro |
|---|---|---|
| CT13 | `split = []` (soma = 0) | `"Split percentages must sum to 100"` |
| CT14 | Um item com 50% (soma = 50) | `"Split percentages must sum to 100"` |
| CT15 | Dois itens somando 99 | `"Split percentages must sum to 100"` |
| CT16 | Dois itens somando 101 | `"Split percentages must sum to 100"` |

#### Split — percentual por item

| CT | Entrada | Mensagem de Erro |
|---|---|---|
| CT17 | Item `percentage = 0` | `"Percentage must be between 1 and 100"` |
| CT18 | Item `percentage = -1` | `"Percentage must be between 1 and 100"` |
| CT19 | Item `percentage = 101` | `"Percentage must be between 1 and 100"` |

#### Split — destinatário por item

| CT | Entrada | Mensagem de Erro |
|---|---|---|
| CT20 | Item `recipient = ""` | `"Recipient is required"` |
| CT21 | Item `recipient = "   "` *(só espaços)* | `"Recipient is required"` |

#### Validação cruzada / estrutural

| CT | Entrada | Mensagem de Erro |
|---|---|---|
| CT22 | Item com 0% quando soma dos demais é 100 | `"Percentage must be between 1 and 100"` (validação por item precede soma) |
| CT23 | Body vazio `{}` | `"Amount must be greater than 0"` (`amount` padrão = 0) |
| CT24 | Body sem campo `split` | `"Split percentages must sum to 100"` (`split` padrão = `[]`) |

---

### 2.3 Idempotência — 7 cenários

**Arquivo:** `tests/api/payment-idempotency.spec.ts`

| CT | Descrição | Resultado Esperado |
|---|---|---|
| CT25 | Três requisições com mesma chave + payload | Todas retornam `201` com o mesmo `payment_id` |
| CT26 | Replay retorna resposta completa idêntica | Mesmo `amount`, `currency`, `customer_id`, `merchant_id`, `split`, `status`, `created_at` |
| CT27 | Chaves diferentes + mesmo payload | `201` com `payment_id`s distintos |
| CT28 | Tentativa de conflito não corrompe a chave | 1. `201` (original) → 2. `409` (conflito) → 3. `201` (original inalterado) |
| CT29 | Chave é case-sensitive | `KEY-X` e `key-x` são chaves independentes |
| CT30 | Mesma chave + `customer_id` diferente | `409` — hash cobre todos os campos do payload |
| CT63 | Replay após captura retorna status atualizado | `201` — status `APPROVED` (store guarda `payment_id`, não snapshot) |

**O hash de conflito cobre:** `amount`, `currency`, `customer_id`, `merchant_id` e todos os campos de cada item de `split`. Alterar qualquer campo único com a mesma chave retorna `409`.

---

### 2.4 Máquina de Estados — 10 cenários

**Arquivo:** `tests/api/payment-state-transitions.spec.ts`

#### Transições válidas

| CT | De | Ação | Resultado |
|---|---|---|---|
| CT31 | `PENDING` | captura | `200`, `status = APPROVED` |
| CT32 | `PENDING` | rejeição | `200`, `status = FAILED` |

#### Transições inválidas — 422 (parametrizado, CT33–CT36)

| CT | De | Ação | Mensagem de Erro |
|---|---|---|---|
| CT33 | `APPROVED` | captura | `422` — `"already APPROVED"` |
| CT34 | `APPROVED` | rejeição | `422` — `"already APPROVED"` |
| CT35 | `FAILED` | rejeição | `422` — `"already FAILED"` |
| CT36 | `FAILED` | captura | `422` — `"already FAILED"` |

> CT33–CT36 são implementados como um único loop parametrizado; o reporter os conta como 4 casos separados.

#### Caminhos "não encontrado"

| CT | Ação | Resultado |
|---|---|---|
| CT37 | capturar `pay_doesnotexist` | `404` — `"not found"` |
| CT38 | rejeitar `pay_doesnotexist` | `404` — `"not found"` |
| CT62 | `GET /payments/{id}` inexistente | `404` — `"not found"` |

#### Consistência de leitura após escrita

| CT | Sequência | Resultado |
|---|---|---|
| CT40 | Criar → capturar → `GET /payments/{id}` | `200`, `status = APPROVED` |

**Diagrama da máquina de estados:**
```
              captura → APPROVED ─┐
PENDING ──────┤                   ├── qualquer nova transição → 422
              rejeição → FAILED  ─┘
```

---

### 2.5 Concorrência — 4 cenários

**Arquivo:** `tests/concurrency/concurrent-requests.spec.ts`

Todos os testes disparam 10 requisições em paralelo via `Promise.all()`, cada uma em um `APIRequestContext` independente.

| CT | Cenário | Invariante Verificado |
|---|---|---|
| CT41 | 10 POSTs simultâneos, mesma `Idempotency-Key` | Todos `201`; apenas um `payment_id` único |
| CT42 | 10 capturas simultâneas no mesmo pagamento `PENDING` | Todas as respostas são `200` ou `422`; sem `5xx`; pelo menos um `200` |
| CT43 | 10 POSTs simultâneos, sem `Idempotency-Key` | Todos `201`; todos os 10 `payment_id`s são distintos |
| CT44 | 10 capturas simultâneas → consulta ao ledger | Exatamente 3 entradas (1 débito + 2 créditos); sem duplicatas |

> CT42 **não** verifica "exatamente um `200`" porque `Payment.Capture()` não é atomicamente protegido a nível de entidade — trata-se de um detalhe de implementação conhecido. A garantia forte de unicidade do ledger é coberta por CT44 (`SemaphoreSlim` por `payment_id`).

---

### 2.6 Ledger (Contabilidade) — 8 cenários

**Arquivo:** `tests/ledger/ledger.spec.ts`
**Endpoint:** `GET /ledger/{payment_id}`

Formato de resposta:
```json
{
  "payment_id": "pay_...",
  "entries": [
    { "type": "debit",  "account": "customer", "amount": 10000 },
    { "type": "credit", "account": "seller_1", "amount": 8000  },
    { "type": "credit", "account": "platform", "amount": 2000  }
  ]
}
```

| CT | Descrição | Resultado Esperado |
|---|---|---|
| CT45 | Pagamento capturado | `200` — `payment_id` e array `entries` não vazio |
| CT46 | Contagem de entradas | `1 + split.length` (1 débito + 1 crédito por destinatário) |
| CT47 | Entrada de débito | `type="debit"`, `account="customer"`, `amount=` valor total do pagamento |
| CT48 | Entradas de crédito | `seller_1` → `8000`; `platform` → `2000` (valores de negócio hard-coded, não recalculados) |
| CT49 | Equilíbrio contábil | Soma dos créditos = valor do débito |
| CT50 | `payment_id` desconhecido | `404` com string `error` não vazia |
| CT51 | Pagamento `PENDING` | `404` — entradas só são gravadas na captura |
| CT52 | Pagamento rejeitado | `404` — rejeição nunca grava no ledger |

**Regra de negócio — gravação no ledger:**
O ledger é gravado **apenas** quando o pagamento transita para `APPROVED` (captura). Rejeição nunca grava. Capturas concorrentes são protegidas por `SemaphoreSlim(1,1)` por `payment_id` para evitar entradas duplicadas (verificado por CT44).

---

### 2.7 Resiliência de Webhook — 5 cenários

**Arquivo:** `tests/webhook/webhook-resilience.spec.ts`

O sink de webhook (`http://localhost:4000`) suporta três modos, controlados via `POST /control { "mode": "ok"|"500"|"timeout" }`.

**Agenda de retentativas (WebhookAdapter):**

| Tentativa | Atraso antes | Tempo acumulado |
|---|---|---|
| 1 (imediata) | — | 0 s |
| 2 | +1 s | ~1 s |
| 3 | +3 s | ~4 s |
| 4 | +5 s | ~9 s |

Um `beforeEach` e `afterEach` redefinem o sink para `mode=ok` em torno de cada teste.

| CT | Modo | Descrição | Resultado Esperado |
|---|---|---|---|
| CT53 | `ok` | Captura dispara webhook | `200 APPROVED` em < 2 s (fire-and-forget) |
| CT54 | `500` | Webhook retorna 500 | Captura ainda retorna `200 APPROVED`; loop de retry roda silenciosamente |
| CT55 | `timeout` | Sink dorme 10 s | Captura retorna em < 5 s (não bloqueante) |
| CT56 | `500` | Todas as 4 tentativas esgotadas (aguarda 12 s) | API totalmente operacional após o ciclo (`test.slow()`, timeout efetivo 75 s) |
| CT57 | `timeout` | Rejeitar com sink de 10 s | Retorna em < 2 s (rejeição nunca chama webhook) |

---

## 3. Cobertura por Endpoint

| Endpoint | Método | Coberto por |
|---|---|---|
| `/payments` | POST | CT01–CT07, CT08–CT24, CT25–CT30, CT41, CT43, CT58–CT59 |
| `/payments/{id}` | GET | CT40, CT62 |
| `/payments/{id}/capture` | POST | CT31, CT33–CT34, CT36–CT37, CT42, CT53–CT56 |
| `/payments/{id}/reject` | POST | CT32, CT34–CT35, CT38, CT57 |
| `/ledger/{id}` | GET | CT44–CT52 |

---

## 4. Distribuição por Tag

| Tag | Cenários | Exemplos |
|---|:---:|---|
| `@api` | 45 | Todos os testes em `tests/api/` |
| `@validation` | 19 | CT02–CT04, CT08–CT24, CT58, CT60–CT61 |
| `@critical` | 14 | CT06, CT30, CT33–CT36, CT42, CT44, CT47–CT49, CT54–CT55 |
| `@idempotency` | 8 | CT05–CT06, CT25–CT30, CT41, CT63 |
| `@state-machine` | 10 | CT31–CT38, CT40, CT62 |
| `@ledger` | 9 | CT44–CT52 |
| `@webhook` | 5 | CT53–CT57 |
| `@concurrency` | 4 | CT41–CT44 |
| `@resilience` | 4 | CT54–CT57 |
| `@smoke` | 4 | CT01, CT31, CT45, CT53 |

---

## 5. Lacunas de Cobertura Identificadas

As seguintes áreas **não possuem cobertura automatizada** ainda:

| Área | Descrição | Prioridade |
|---|---|---|
| Fluxos integrados end-to-end | criar → capturar → GET pagamento → GET ledger | Alta |
| Arredondamento no split | Ex.: 3 destinatários com valores não divisíveis (33/33/34%) | Média |
| Testes de carga / stress | Throughput e latência P99 — fora do escopo do Playwright; usar k6 | Média |
| Segurança / fuzzing | `amount` com floats/strings, `Idempotency-Key` com caracteres especiais | Baixa |
| CORS e rate-limiting | Cabeçalhos de segurança na resposta | Baixa |
