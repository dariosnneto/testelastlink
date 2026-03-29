# Relatório da Suíte de Testes — Mock Payments API

> Documento técnico completo sobre a estrutura, decisões e justificativas de cada cenário
> de teste da suíte automatizada. Voltado a engenheiros que precisam entender **o quê**
> é testado, **por quê** foi escolhido e **como** o código de teste foi organizado.

---

## Sumário

1. [Contexto e Objetivo](#1-contexto-e-objetivo)
2. [Arquitetura da Suíte](#2-arquitetura-da-suíte)
3. [Infraestrutura de Testes — Helpers](#3-infraestrutura-de-testes--helpers)
4. [Payment Creation](#4-payment-creation)
5. [Payment Validation](#5-payment-validation)
6. [Payment Idempotency](#6-payment-idempotency)
7. [Payment State Transitions](#7-payment-state-transitions)
8. [Concurrency](#8-concurrency)
9. [Ledger](#9-ledger)
10. [Webhook Resilience](#10-webhook-resilience)
11. [Decisões Globais de Design](#11-decisões-globais-de-design)
12. [O Que Não Foi Testado e Por Quê](#12-o-que-não-foi-testado-e-por-quê)

---

## 1. Contexto e Objetivo

O sistema sob teste é uma API de pagamentos fictícia (ASP.NET Core 8, arquitetura limpa
com DDD) que expõe cinco endpoints:

| Método | Path | Responsabilidade |
|---|---|---|
| `POST` | `/payments` | Criação de pagamento com suporte a `Idempotency-Key` |
| `GET` | `/payments/{id}` | Consulta de pagamento por ID |
| `POST` | `/payments/{id}/capture` | Captura de pagamento pendente |
| `POST` | `/payments/{id}/reject` | Rejeição de pagamento pendente |
| `GET` | `/ledger/{id}` | Consulta de entradas contábeis de um pagamento |

O objetivo da suíte é validar **todos os contratos funcionais** e **todos os riscos
financeiros catalogados** de forma automatizada, reproduzível e executável em CI em
menos de 30 segundos.

### Por que Playwright?

A escolha do Playwright sobre alternativas como Supertest ou Axios+Jest foi motivada por:

- **`APIRequestContext` tipado** — as requisições HTTP são fortemente tipadas, e erros
  de payload são detectados em tempo de compilação, não em runtime.
- **Reporter nativo para CI** (`github`) — emite anotações diretamente no GitHub Actions
  sem configuração adicional.
- **Paralelismo nativo** — o Playwright executa os quatro projetos em paralelo com
  configuração declarativa em `playwright.config.ts`.
- **Caminho de crescimento** — se o sistema evoluir para ter UI, a mesma ferramenta
  cobre testes E2E sem troca de framework.

---

## 2. Arquitetura da Suíte

```
tests/
├── helpers/
│   └── payment-helpers.ts       ← interfaces, builders, shortcut helpers
├── api/                         ← projeto "api" (timeout 10 s)
│   ├── payment-creation.spec.ts
│   ├── payment-validation.spec.ts
│   ├── payment-idempotency.spec.ts
│   └── payment-state-transitions.spec.ts
├── ledger/                      ← projeto "ledger" (timeout 10 s)
│   └── ledger.spec.ts
├── concurrency/                 ← projeto "concurrency" (timeout 15 s)
│   └── concurrent-requests.spec.ts
└── webhook/                     ← projeto "resilience" (timeout 25 s)
    └── webhook-resilience.spec.ts
```

### Por que quatro projetos separados?

Cada projeto tem um timeout diferente que reflete a natureza dos seus testes:

| Projeto | Timeout | Motivo |
|---|---|---|
| `api` | 10 s | Testes síncronos e determinísticos; qualquer coisa acima de 10 s indica bloqueio |
| `ledger` | 10 s | Mesmo perfil que `api` |
| `concurrency` | 15 s | `Promise.all()` com 10 contextos paralelos precisa de margem |
| `resilience` | 25 s | CT56 aguarda exaustão do ciclo de retry (~12 s); `test.slow()` triplica o timeout |

### Pipeline CI/CD

```
PR Gate → api + ledger (52 testes, ~10 s)  ← bloqueia merge
Full Suite → todos os projetos (61 testes, ~30 s)  ← roda pós-merge + cron diário
```

O PR Gate deliberadamente exclui os testes de concorrência e webhook porque eles
dependem de Docker e têm variância de timing. A cobertura de todos os riscos P0/P1
é garantida pelos 52 testes rápidos.

---

## 3. Infraestrutura de Testes — Helpers

O arquivo `tests/helpers/payment-helpers.ts` centraliza tudo que é compartilhado entre
os spec files. Cada helper resolve um problema específico.

### `validPaymentPayload(overrides?)`

```typescript
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
```

**Por quê:** Sem este builder, cada teste precisaria repetir os cinco campos do payload
mesmo que só quisesse mudar um. Com `overrides`, o teste expressa exatamente o que está
sendo variado:

```typescript
// Intenção clara: somente o amount muda
const payload = validPaymentPayload({ amount: 0 });
```

O spread `...overrides` no final garante que os campos do caller sobrescrevam os
defaults — semântica de "patch", não de "merge profundo".

---

### `uniqueKey(prefix?)`

```typescript
export function uniqueKey(prefix = 'key'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
```

**Por quê:** A API armazena chaves de idempotência em um `ConcurrentDictionary` que
persiste durante toda a vida do container — não há endpoint de reset. Sem sufixos únicos,
duas execuções do mesmo teste produziriam a mesma chave e o segundo teste encontraria
a chave já registrada, causando falha espúria (flakiness).

A combinação `timestamp + random` garante unicidade mesmo em execuções paralelas
no mesmo milissegundo.

---

### Shortcut helpers com fail-fast

```typescript
export async function createAndCapture(request, overrides = {}) {
  const createRes = await request.post('/payments', { ... });
  expect(createRes.status()).toBe(201); // fail-fast: expõe erros de setup imediatamente

  const payment = await createRes.json();
  const captureRes = await request.post(`/payments/${payment.payment_id}/capture`);
  expect(captureRes.status()).toBe(200); // fail-fast
  return { createRes, captureRes, payment: await captureRes.json() };
}
```

Os `expect()` dentro dos helpers são intencionais. Sem eles, uma falha no `POST
/payments` (ex.: payload inválido) propagaria como `Cannot read properties of undefined`
três linhas depois, mascarando a causa real.

Com os asserts no helper, a mensagem de erro é imediatamente:
```
Expected: 201
Received: 400
```

---

### `pollUntil` e `sleep`

```typescript
// Preferido quando há sinal observável
export async function pollUntil(fn, { timeout = 10_000, interval = 250 } = {}) { ... }

// Reservado para quando não há sinal observável
export function sleep(ms: number): Promise<void> { ... }
```

`sleep` é usado em **apenas um teste** (CT56), com comentário explicando por quê polling
não é possível. Nos demais testes qualquer espera usa `pollUntil`, que falha com mensagem
útil ao expirar em vez de silenciosamente esperar.

---

## 4. Payment Creation

**Arquivo:** `tests/api/payment-creation.spec.ts`
**Total:** 8 testes (CT01–CT04, CT06–CT07, CT58, CT59)

### CT01 — Happy path completo

```typescript
test('CT01 - valid payment returns 201 with correct response shape', async ({ request }) => {
  const payload = validPaymentPayload();
  const response = await request.post('/payments', { data: payload });

  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.payment_id).toMatch(/^pay_[0-9a-f]{32}$/);
  expect(body.status).toBe('PENDING');
  expect(body.amount).toBe(payload.amount);
  expect(body.currency).toBe(payload.currency);
  // ... demais campos
});
```

**Por quê foi escolhido:** É o teste "smoke" mais crítico — valida o contrato completo
da resposta. O `toMatch(/^pay_[0-9a-f]{32}$/)` verifica não apenas que o campo existe,
mas que o formato do ID é exatamente o especificado. Se o servidor mudar o prefixo ou
o comprimento, este teste falha imediatamente.

A tag `@smoke` significa que ele deve passar antes de qualquer deploy.

---

### CT02, CT03, CT04 — Validações na rota de criação

Estes três testes existem em `payment-creation.spec.ts` (e não em `payment-validation.spec.ts`)
porque cobrem os **erros mais óbvios** que um consumidor da API encontraria ao integrar:
amount zero, moeda errada e split incorreto.

```typescript
// CT02
const payload = validPaymentPayload({ amount: 0 });
const response = await request.post('/payments', { data: payload });
expect(response.status()).toBe(400);
expect(body.error).toContain('Amount must be greater than 0');
```

**Por quê:** CT02–CT04 são o "contrato mínimo de validação" — um desenvolvedor que lê
apenas o arquivo de criação já entende as regras básicas. Os casos extremos (amount = -1,
-10000, currency = '', etc.) pertencem ao arquivo de validação especializado.

---

### CT06 — Conflito de idempotência

```typescript
// Act — primeiro request com amount=10000
await request.post('/payments', {
  headers: { 'Idempotency-Key': key },
  data: validPaymentPayload({ amount: 10000 }),
});

// Act — segundo request com amount=20000 (payload diferente)
const second = await request.post('/payments', {
  headers: { 'Idempotency-Key': key },
  data: validPaymentPayload({ amount: 20000 }),
});

expect(second.status()).toBe(409);
expect(body.error).toContain('Idempotency key already used with a different payload');
```

**Por quê:** O risco R02 (reuso de chave com payload diferente → corrupção silenciosa)
tem score 6 na matriz de riscos. É obrigatório ter este teste na rota de criação
porque é o cenário de conflito mais direto que um consumidor pode acionar.

A tag `@critical` indica que falha aqui bloqueia release.

---

### CT07 — Ausência de chave cria pagamentos distintos

```typescript
const first = await request.post('/payments', { data: payload }); // sem Idempotency-Key
const second = await request.post('/payments', { data: payload });

expect(secondBody.payment_id).not.toBe(firstBody.payment_id);
```

**Por quê:** Valida que a ausência do header não é tratada como uma chave implícita
compartilhada. Se a API usasse string vazia como chave default, dois requests sem
header retornariam o mesmo pagamento — comportamento incorreto.

---

### CT58 — Normalização de moeda

```typescript
const payload = validPaymentPayload({ currency: 'brl' }); // lowercase
const response = await request.post('/payments', { data: payload });

expect(response.status()).toBe(201);
expect(body.currency).toBe('BRL'); // normalizado pelo servidor
```

**Por quê:** O servidor aplica `.ToUpperInvariant()` antes da validação. Este teste
documenta e protege esse comportamento: se a normalização for removida, o teste falha
explicitamente em vez de o consumidor descobrir em produção que `"brl"` retorna 400.

---

### CT59 — Content-Type da resposta

```typescript
expect(response.status()).toBe(201);
expect(response.headers()['content-type']).toContain('application/json');
```

**Por quê:** APIs que retornam `text/plain` em vez de `application/json` quebram
clientes que fazem `response.json()` sem verificar o header. Este teste é um contrato
de protocolo, não de negócio.

---

### Por que CT05 foi removido?

CT05 testava "mesma chave + mesmo payload → 201 com mesmo payment_id" (dois requests).
CT25 testa a mesma coisa com três requests e CT26 valida o corpo completo da resposta
idempotente. Manter CT05 seria ruído sem valor diagnóstico adicional.

---

## 5. Payment Validation

**Arquivo:** `tests/api/payment-validation.spec.ts`
**Total:** 19 testes (CT08–CT24, CT60, CT61)

Este arquivo cobre sistematicamente todos os casos de borda de validação de input.
Os grupos de testes que testam a mesma regra são implementados como loops parametrizados.

### Estrutura do helper de asserção

```typescript
async function assertValidationError(response: APIResponse, expectedMessage?: string) {
  expect(response.status()).toBe(400); // toBe, não toBeGreaterThanOrEqual
  const body = await response.json();
  expect(body.error).toBeTruthy();
  if (expectedMessage) {
    expect(body.error).toContain(expectedMessage);
  }
}
```

**Por quê `toBe(400)` e não `toBeGreaterThanOrEqual(400)`?** Um bug de roteamento que
retorna 404 ou 422 passaria silenciosamente com a comparação relaxada. O `toBe` exato
força o servidor a retornar exatamente o status semântico correto.

---

### CT08–CT09 — Valores negativos de amount (parametrizado)

```typescript
for (const { label, amount } of [
  { label: 'CT08', amount: -1 },
  { label: 'CT09', amount: -10000 },
]) {
  test(`${label} - amount = ${amount} returns 400`, async ({ request }) => {
    const response = await request.post('/payments', { data: validPaymentPayload({ amount }) });
    await assertValidationError(response, 'Amount must be greater than 0');
  });
}
```

**Por quê dois valores?** `-1` cobre o caso imediatamente abaixo do zero, `-10000` cobre
um valor grande negativo. A regra (`amount > 0`) é a mesma, mas os dois valores garantem
que não há implementação ingênua como `if (amount == -1) reject()`.

**Por que parametrizado?** Antes da refatoração, cada caso era um `test()` separado com
80% de código duplicado. O loop mantém os dois casos distintos no reporter (CT08 e CT09
aparecem separados) mas elimina a repetição estrutural.

---

### CT60–CT61 — Limites válidos de amount

```typescript
// CT60 — mínimo válido
const payload = validPaymentPayload({ amount: 1 });
expect(response.status()).toBe(201);
expect(body.amount).toBe(1);

// CT61 — máximo seguro do JavaScript
const payload = validPaymentPayload({ amount: Number.MAX_SAFE_INTEGER });
expect(response.status()).toBe(201);
```

**Por quê:** Testes de validação normalmente cobrem apenas casos inválidos. CT60 e CT61
cobrem os **limites válidos** — garantindo que `amount = 1` não é rejeitado por engano
(ex.: `if (amount < 1)` vs `if (amount <= 0)`) e que o campo `long` do C# aceita o
valor máximo do JavaScript sem overflow.

---

### CT10–CT12 — Validação de moeda (parametrizado)

```typescript
for (const { label, currency, description } of [
  { label: 'CT10', currency: '',     description: '""' },
  { label: 'CT11', currency: 'EUR',  description: '"EUR"' },
  { label: 'CT12', currency: 'BRL ', description: '"BRL " (trailing space)' },
]) {
  test(`${label} - currency = ${description} returns 400`, async ({ request }) => {
    const response = await request.post('/payments', { data: validPaymentPayload({ currency }) });
    await assertValidationError(response, 'Currency must be BRL');
  });
}
```

**Por quê CT12 (trailing space) é especialmente importante?** O servidor aplica
`ToUpperInvariant()` antes da validação. `"BRL "` após normalização continua sendo
`"BRL "` (com espaço), não `"BRL"`. Sem este teste, uma implementação que compara
após trim aceitaria `"BRL "` silenciosamente.

---

### CT13–CT16 — Soma dos percentuais do split (parametrizado)

```typescript
for (const { label, description, split } of [
  { label: 'CT13', description: 'empty split array (sum = 0)',    split: [] },
  { label: 'CT14', description: 'single item at 50% (sum = 50)', split: [{ recipient: 'seller_1', percentage: 50 }] },
  { label: 'CT15', description: 'two items summing to 99',        split: [{ recipient: 'seller_1', percentage: 79 }, { recipient: 'platform', percentage: 20 }] },
  { label: 'CT16', description: 'two items summing to 101',       split: [{ recipient: 'seller_1', percentage: 81 }, { recipient: 'platform', percentage: 20 }] },
]) {
  test(`${label} - ${description} returns 400`, async ({ request }) => {
    await assertValidationError(response, 'Split percentages must sum to 100');
  });
}
```

**Estratégia de cobertura:**
- CT13: array vazio — cobre o caso de soma 0
- CT14: um item — cobre o caso de soma < 100 com um único elemento
- CT15: soma 99 — cobre underflow em 1 ponto
- CT16: soma 101 — cobre overflow em 1 ponto

Os dois últimos são especialmente importantes porque uma implementação com tolerância
(`abs(sum - 100) < 2`) passaria nos limites mas falharia nestes casos.

---

### CT17–CT19 — Percentual por item (parametrizado)

```typescript
for (const { label, description, split } of [
  { label: 'CT17', description: 'percentage = 0',   split: [{ recipient: 'seller_1', percentage: 0 }, { recipient: 'platform', percentage: 100 }] },
  { label: 'CT18', description: 'percentage = -1',  split: [{ recipient: 'seller_1', percentage: -1 }, { recipient: 'platform', percentage: 101 }] },
  { label: 'CT19', description: 'percentage = 101', split: [{ recipient: 'seller_1', percentage: 101 }] },
]) { ... }
```

**Observação sobre CT18:** O segundo item tem `percentage: 101` propositalmente. A soma
total seria `-1 + 101 = 100`, o que passaria na validação de soma. O objetivo é isolar
a validação **por item** da validação **de soma**. Se o segundo item fosse 100, a soma
total seria 99, ativando o erro de soma antes do erro de item.

---

### CT22 — Validação por item precede validação de soma

```typescript
const payload = validPaymentPayload({
  split: [
    { recipient: 'seller_1', percentage: 50 },
    { recipient: 'seller_2', percentage: 50 },
    { recipient: 'platform', percentage: 0 }, // 0% é inválido por item
  ],
  // soma total = 100 (seria válida se 0% fosse permitido)
});

await assertValidationError(response, 'Percentage must be between 1 and 100');
```

**Por quê:** Este teste documenta explicitamente a **ordem de validação** do domínio.
Se no futuro a ordem mudar (soma verificada antes do item), o erro retornado seria
`"Split percentages must sum to 100"` em vez de `"Percentage must be between 1 and 100"`,
e este teste detectaria a regressão.

---

### CT23–CT24 — Validação estrutural do corpo

```typescript
// CT23 — corpo vazio
const response = await request.post('/payments', { data: {} });
await assertValidationError(response, 'Amount must be greater than 0');
// amount default em C# é 0, que falha a validação de amount

// CT24 — sem campo split
const { split: _, ...payloadWithoutSplit } = validPaymentPayload();
await assertValidationError(response, 'Split percentages must sum to 100');
// split default em C# é [], soma = 0
```

**Por quê:** Documentam o comportamento do binding do ASP.NET Core. Quando um campo
não é enviado, o C# usa o valor default do tipo (`0` para `int`, `[]` para lista).
Estes testes garantem que as validações cobrem esses defaults.

---

## 6. Payment Idempotency

**Arquivo:** `tests/api/payment-idempotency.spec.ts`
**Total:** 7 testes (CT25–CT30, CT63)

Este arquivo é o deep-dive de idempotência — cobre propriedades mais sofisticadas
que os testes básicos de CT06 e CT07.

### CT25 — Triple replay

```typescript
const r1 = await request.post('/payments', { headers: { 'Idempotency-Key': key }, data: payload });
const r2 = await request.post('/payments', { headers: { 'Idempotency-Key': key }, data: payload });
const r3 = await request.post('/payments', { headers: { 'Idempotency-Key': key }, data: payload });

expect(r1.status()).toBe(201);
expect(r2.status()).toBe(201);
expect(r3.status()).toBe(201);

expect(id2).toBe(id1);
expect(id3).toBe(id1);
```

**Por quê três requests?** CT06 já testa dois. O terceiro request verifica que o
mecanismo não tem estado interno que se esgota após o segundo replay (ex.: um contador
ou uma flag de "já foi replicado").

---

### CT26 — Resposta idempotente completa

```typescript
expect(rep.payment_id).toBe(orig.payment_id);
expect(rep.status).toBe(orig.status);
expect(rep.amount).toBe(orig.amount);
expect(rep.currency).toBe(orig.currency);
expect(rep.customer_id).toBe(orig.customer_id);
expect(rep.merchant_id).toBe(orig.merchant_id);
expect(rep.split).toEqual(orig.split);
expect(rep.created_at).toBe(orig.created_at); // timestamp original preservado
```

**Por quê `created_at` deve ser idêntico?** O `created_at` é o timestamp da criação
original. Se o replay retornar um novo timestamp, o consumidor não consegue usar este
campo como "data da transação" — ele seria diferente em cada replay, quebrando relatórios
e auditorias.

---

### CT28 — Conflito não corrompe a chave

```typescript
// Sequência: original → conflito → replay do original
const original     = await post(key, payloadA); // 201 — cria P1
const conflict     = await post(key, payloadB); // 409 — conflito
const afterConflict = await post(key, payloadA); // 201 — deve retornar P1 ainda

expect(original.status()).toBe(201);
expect(conflict.status()).toBe(409);
expect(afterConflict.status()).toBe(201);
expect(afterConflictId).toBe(originalId);
```

**Por quê:** Este é o teste de **integridade do store de idempotência**. Uma implementação
ingênua poderia, ao receber o payload conflitante, atualizar o registro com o payload B.
Então o replay posterior com payload A retornaria 409 (agora o payload A é que conflita).
O teste garante que o request 409 é descartado sem modificar o estado.

---

### CT29 — Chave é case-sensitive

```typescript
const keyUpper = `KEY-${suffix}`;
const keyLower = `key-${suffix}`;

const rUpper = await post(keyUpper, payload); // 201 — pagamento P1
const rLower = await post(keyLower, payload); // 201 — pagamento P2 (distinto)

expect(rUpper.payment_id).not.toBe(rLower.payment_id);
```

**Por quê:** Documentar que a comparação de chaves é case-sensitive é essencial. Se
a API não diferenciasse maiúsculas de minúsculas, um consumidor que gerou a chave
`"KEY-abc"` e depois enviou `"key-abc"` receberia o mesmo pagamento — comportamento
inesperado que poderia causar deduplicação não intencional.

---

### CT30 — Hash cobre todos os campos do payload

```typescript
// Mesmo key, mas customer_id diferente
const original = await post(key, validPaymentPayload({ customer_id: 'cus_original' })); // 201
const conflict  = await post(key, validPaymentPayload({ customer_id: 'cus_different' })); // 409

expect(conflict.status()).toBe(409);
expect(conflictBody.error).toContain('Idempotency key already used with a different payload');
```

**Por quê:** CT06 muda o `amount`, CT30 muda o `customer_id`. Isso garante que o hash
de comparação cobre **todos** os campos do payload, não apenas os campos "financeiros".
Uma implementação que hasheia só `amount + currency` aceitaria erroneamente um pagamento
com `customer_id` diferente — risco de cobrar o cliente errado.

---

### CT63 — Replay após captura retorna status atualizado

```typescript
// Cria pagamento com chave K
const { payment_id } = await create(key, payload); // 201, PENDING

// Captura o pagamento
await request.post(`/payments/${payment_id}/capture`); // APPROVED

// Replay com a mesma chave K
const replayed = await post(key, payload); // 201

expect(replayed.payment_id).toBe(payment_id);
expect(replayed.status).toBe('APPROVED'); // não PENDING
```

**Por quê:** Documenta um detalhe de implementação crítico: o store de idempotência
armazena o `payment_id`, não um snapshot da resposta. No replay, o handler busca o
pagamento vivo no repositório, então o status reflete o estado atual — não o estado
no momento da criação. Se o store armazenasse um snapshot, o replay retornaria
`PENDING` mesmo após captura.

---

## 7. Payment State Transitions

**Arquivo:** `tests/api/payment-state-transitions.spec.ts`
**Total:** 10 testes (CT31–CT38, CT40, CT62)

### CT31–CT32 — Transições válidas

```typescript
// CT31: PENDING → capture → APPROVED
const response = await request.post(`/payments/${payment_id}/capture`);
expect(response.status()).toBe(200);
expect(body.status).toBe('APPROVED');

// CT32: PENDING → reject → FAILED
const response = await request.post(`/payments/${payment_id}/reject`);
expect(response.status()).toBe(200);
expect(body.status).toBe('FAILED');
```

**Por quê:** São os testes de happy path das duas únicas transições válidas do sistema.
A tag `@critical` em CT31 reflete que falha de captura bloqueia receita.

---

### CT33–CT36 — Transições inválidas (parametrizado)

```typescript
const invalidTransitions = [
  { label: 'CT33', setup: 'captured', action: 'capture', currentStatus: 'APPROVED' },
  { label: 'CT34', setup: 'captured', action: 'reject',  currentStatus: 'APPROVED' },
  { label: 'CT35', setup: 'rejected', action: 'reject',  currentStatus: 'FAILED'   },
  { label: 'CT36', setup: 'rejected', action: 'capture', currentStatus: 'FAILED'   },
];

for (const { label, setup, action, currentStatus } of invalidTransitions) {
  test(`${label} - ${action} on ${setup} payment returns 422`, async ({ request }) => {
    const { payment } = setup === 'captured'
      ? await createAndCapture(request)
      : await createAndReject(request);

    const response = await request.post(`/payments/${payment.payment_id}/${action}`);
    expect(response.status()).toBe(422);
    expect(body.error).toContain(`already ${currentStatus}`);
  });
}
```

**Por quê 422 (Unprocessable Entity) em vez de 400?** O 400 indica payload inválido;
o 422 indica que o payload é válido mas o estado do servidor impede a operação. A
distinção semântica é importante para consumidores que precisam diferenciar "erro de
input" de "conflito de estado".

**Por que parametrizado?** As quatro transições têm estrutura idêntica: setup de estado,
tentativa de transição, validação do 422 com mensagem. O loop mantém cada caso visível
no reporter mas elimina 80% de código duplicado.

---

### CT37–CT38 — Recurso inexistente (parametrizado)

```typescript
for (const { label, action } of [
  { label: 'CT37', action: 'capture' },
  { label: 'CT38', action: 'reject' },
] as const) {
  test(`${label} - ${action} on non-existent payment_id returns 404`, async ({ request }) => {
    const response = await request.post(`/payments/pay_doesnotexist/${action}`);
    expect(response.status()).toBe(404);
    expect(body.error).toContain('not found');
  });
}
```

**Por quê dois testes separados?** Capture e reject são handlers diferentes. Um poderia
implementar a busca do pagamento corretamente e o outro usar um caminho diferente que
não valida a existência antes de tentar operar.

---

### CT40 — Read-after-write consistency

```typescript
// Arrange
const { payment_id } = await createPayment(request);
await request.post(`/payments/${payment_id}/capture`);

// Act — lê o estado persistido
const getResponse = await request.get(`/payments/${payment_id}`);

expect(getResponse.status()).toBe(200);
expect(body.status).toBe('APPROVED');
```

**Por quê:** Valida que o `GET /payments/{id}` lê o estado atual do repositório, não
um cache ou snapshot antigo. É o teste de consistência de leitura após escrita.

---

### CT62 — GET de pagamento inexistente

```typescript
const response = await request.get('/payments/pay_00000000000000000000000000000000');
expect(response.status()).toBe(404);
expect(body.error).toContain('not found');
```

**Por quê um ID com 32 zeros?** O ID segue o formato `pay_<32 hex chars>`. Usar um ID
estruturalmente válido mas inexistente testa que o servidor busca no repositório, não
que rejeita o formato. Se fosse `pay_doesnotexist` (string curta), um bug de validação
de formato poderia retornar 400 em vez de 404, passando o teste por motivo errado.

---

## 8. Concurrency

**Arquivo:** `tests/concurrency/concurrent-requests.spec.ts`
**Total:** 4 testes (CT41–CT44)

Todos os testes disparam 10 requests em paralelo via `Promise.all()`, cada um de um
`APIRequestContext` independente.

### Por que `APIRequestContext` separado por request?

```typescript
async function firePost(playwright, path, options = {}) {
  const ctx = await playwright.request.newContext({ baseURL: BASE_URL });
  const res = await ctx.post(path, options);
  const status = res.status();
  const body = await res.json();
  await ctx.dispose(); // corpo consumido ANTES do dispose
  return { status, body };
}
```

O `APIResponse` do Playwright está vinculado ao ciclo de vida do seu contexto. Se o
contexto fosse destruído antes de `res.json()`, o erro seria `"Response has been
disposed"`. Consumir `status` e `body` dentro do contexto e dispor depois resolve isso.

---

### CT41 — Criações concorrentes com mesma chave

```typescript
const results = await Promise.all(
  Array.from({ length: 10 }, () =>
    firePost(playwright, '/payments', {
      headers: { 'Idempotency-Key': key },
      data: payload,
    }),
  ),
);

// Todos os 10 retornam 201
for (const { status } of results) expect(status).toBe(201);

// Todos referem o mesmo pagamento
const ids = results.map(r => r.body.payment_id);
expect(new Set(ids).size).toBe(1); // set de tamanho 1 = todos iguais
```

**Por quê:** Testa a atomicidade do `ConcurrentDictionary.GetOrAdd` sob concorrência
real. Em uma implementação não thread-safe, dois requests poderiam passar pela
checagem "chave existe?" simultaneamente e ambos criar pagamentos — retornando IDs
diferentes para a mesma chave.

---

### CT42 — Capturas concorrentes do mesmo pagamento

```typescript
const statuses = results.map(r => r.status);
for (const s of statuses) {
  expect([200, 422]).toContain(s); // somente 200 ou 422 — nenhum 5xx
}
expect(statuses.filter(s => s === 200).length).toBeGreaterThanOrEqual(1);
```

**Por quê não assertar "exatamente um 200"?** `Payment.Capture()` faz um
check-then-set não atômico no status. Sob carga concorrente, mais de uma captura
pode suceder no nível HTTP. Assertar "exatamente um 200" seria um teste frágil
(flaky). O invariante real é: pelo menos uma captura sucede e nenhuma retorna 5xx.

A garantia forte (ledger escrito exatamente uma vez) é coberta pelo CT44.

---

### CT43 — Criações concorrentes sem chave

```typescript
const ids = results.map(r => r.body.payment_id);
expect(new Set(ids).size).toBe(CONCURRENCY); // todos os 10 são únicos
```

**Por quê:** O inverso do CT41. Sem chave de idempotência, cada request deve criar
um pagamento distinto. Uma implementação que usa string vazia como chave default
falharia aqui — retornaria o mesmo `payment_id` para todos os 10 requests.

---

### CT44 — Ledger escrito exatamente uma vez após capturas concorrentes

```typescript
// 10 capturas concorrentes
await Promise.all(Array.from({ length: 10 }, () =>
  firePost(playwright, `/payments/${payment_id}/capture`),
));

// Verifica ledger
expect(entries).toHaveLength(3); // 1 débito + 2 créditos, não 10 × 3

const debit = entries.find(e => e.type === 'debit');
expect(debit.account).toBe('customer');
expect(debit.amount).toBe(10000);
expect(credits.find(e => e.account === 'seller_1')?.amount).toBe(8000);
expect(credits.find(e => e.account === 'platform')?.amount).toBe(2000);
```

**Por quê:** Este é o teste de **integridade contábil** mais importante. O
`InMemoryLedgerRepository` usa `SemaphoreSlim(1,1)` por `payment_id` para garantir
que somente uma escrita ocorre mesmo com 10 capturas simultâneas. Se o semáforo
estiver quebrado, o ledger teria 30 entradas (10 × 3) em vez de 3.

Os valores `10000`, `8000`, `2000` são hard-coded — não calculados com a fórmula
do servidor. Isso evita o anti-pattern "Mirror Test" onde um bug na fórmula passaria
porque o teste usa a mesma fórmula.

---

## 9. Ledger

**Arquivo:** `tests/ledger/ledger.spec.ts`
**Total:** 8 testes (CT45–CT52)

### CT45–CT49 — Cobertura do happy path em camadas

A cobertura do ledger é dividida em cinco testes distintos por uma razão: cada um
falha de forma independente, apontando para um componente específico.

| Teste | O que falha se cair |
|---|---|
| CT45 | O endpoint não retorna 200 ou não tem o campo `entries` |
| CT46 | A contagem de entradas está errada (falta debit ou credit) |
| CT47 | Os campos do debit estão errados (type, account ou amount) |
| CT48 | Os valores dos créditos não correspondem à regra de negócio |
| CT49 | A soma dos créditos não fecha com o débito (ledger desequilibrado) |

Se fossem um único teste, uma falha não indicaria qual dos cinco problemas ocorreu.

---

### CT47 — Entrada de débito

```typescript
const amount = 10000;
const { payment } = await createAndCapture(request, { amount });
const { entries } = await res.json();

const debit = entries.find(e => e.type === 'debit');
expect(debit).toBeDefined();
expect(debit.account).toBe('customer');
expect(debit.amount).toBe(amount); // o débito é sempre o valor total
```

**Por quê:** Valida o modelo contábil: o customer é debitado pelo valor total do
pagamento. Se `debit.account` fosse `'merchant'` ou `debit.amount` fosse o valor
após split, o ledger estaria contabilizando errado.

---

### CT48 — Valores dos créditos (hard-coded)

```typescript
// 80% de 10000 = 8000; 20% de 10000 = 2000
const seller = credits.find(e => e.account === 'seller_1');
expect(seller.amount).toBe(8000); // literal, não Math.round(10000 * 0.80)

const platform = credits.find(e => e.account === 'platform');
expect(platform.amount).toBe(2000);
```

**Por quê valores literais e não a fórmula?** Se o servidor tivesse um bug em
`SplitItem.CalculateAmount()` — por exemplo, usando divisão inteira que perde centavos
em splits não divisíveis — e o teste recalculasse com a mesma fórmula, o teste passaria
mascarando o bug. Valores literais derivados da regra de negócio ("80% de 10.000 = 8.000")
são a única forma correta de assertar resultados financeiros.

---

### CT49 — Equilíbrio contábil

```typescript
const debit = entries.find(e => e.type === 'debit');
const credits = entries.filter(e => e.type === 'credit');
const creditTotal = credits.reduce((sum, e) => sum + e.amount, 0);

expect(creditTotal).toBe(debit.amount); // débito = soma dos créditos
```

**Por quê:** Implementa a **identidade contábil fundamental**: a soma dos créditos deve
igualar o débito. CT48 verifica os valores individuais; CT49 verifica que não há
"dinheiro sumindo" no processo de divisão. São garantias complementares.

---

### CT50–CT52 — Caminhos de 404

```typescript
// CT50 — ID inexistente
const res = await request.get('/ledger/pay_does_not_exist');
expect(res.status()).toBe(404);
expect(body.error.length).toBeGreaterThan(0); // mensagem não vazia

// CT51 — pagamento PENDING (ledger só é escrito na captura)
const { payment_id } = await createPending(request);
const res = await request.get(`/ledger/${payment_id}`);
expect(res.status()).toBe(404);

// CT52 — pagamento FAILED (reject nunca escreve ledger)
const { payment } = await createAndReject(request);
const res = await request.get(`/ledger/${payment.payment_id}`);
expect(res.status()).toBe(404);
```

**Por quê CT51 e CT52 são testes separados de CT50?** CT50 testa um ID que nunca
existiu. CT51 e CT52 testam IDs de pagamentos reais cujo ledger nunca foi escrito.
São caminhos de código diferentes: CT50 passa pelo branch "pagamento não existe",
enquanto CT51/CT52 passam pelo branch "pagamento existe mas ledger não".

---

## 10. Webhook Resilience

**Arquivo:** `tests/webhook/webhook-resilience.spec.ts`
**Total:** 5 testes (CT53–CT57)

O webhook sink Python suporta três modos controlados via `POST /control`:

| Modo | Comportamento |
|---|---|
| `ok` | Retorna 200 imediatamente |
| `500` | Retorna HTTP 500 em toda request |
| `timeout` | Dorme 10 segundos antes de responder |

### Isolamento entre testes

```typescript
test.beforeEach(async ({ request }) => { await setWebhookMode(request, 'ok'); });
test.afterEach(async ({ request }) => { await setWebhookMode(request, 'ok'); });
```

**Por quê `afterEach` além do `beforeEach`?** O `beforeEach` garante que o estado
inicial é `ok`. O `afterEach` garante que se um teste muda o modo e depois falha
(antes de restaurar), o próximo teste não herda o modo incorreto. São garantias
simétricas — o `beforeEach` é redundante mas aumenta a resiliência a ordens de
execução inesperadas.

---

### CT53 — Entrega normal é não-bloqueante

```typescript
const start = Date.now();
const captureRes = await request.post(`/payments/${payment_id}/capture`);
const elapsed = Date.now() - start;

expect(captureRes.status()).toBe(200);
expect(elapsed).toBeLessThan(2_000); // deve retornar em milissegundos
```

**Por quê < 2s e não < 100ms?** O servidor está em um container Docker com overhead
de rede. Assertar < 100ms seria flaky em CI. O threshold de 2s é conservador o
suficiente para ser estável mas restritivo o suficiente para detectar se a entrega
acidentalmente se tornou síncrona.

---

### CT54 — Falha do webhook é transparente ao chamador

```typescript
await setWebhookMode(request, '500');
// ... cria e captura pagamento

expect(captureRes.status()).toBe(200);
expect(body.status).toBe('APPROVED');
// O loop de retry roda silenciosamente em background
```

**Por quê:** O risco R04 (falha do webhook causa rollback da captura) tem score 6.
O consumidor da API não deve receber erro porque o webhook falhou — a captura é
uma operação de negócio que não depende da entrega do webhook para sua validade.

---

### CT55 — Timeout do webhook não bloqueia a resposta

```typescript
await setWebhookMode(request, 'timeout'); // sink dorme 10s

const start = Date.now();
const captureRes = await request.post(`/payments/${payment_id}/capture`);
const elapsed = Date.now() - start;

expect(elapsed).toBeLessThan(5_000); // muito abaixo dos 10s do sink
```

**Por quê:** O `CapturePaymentHandler` usa `Task.Run(() => SendWithRetryAsync(...))` —
fire-and-forget. Se alguém remover o `Task.Run` e tornar a entrega síncrona, este
teste falharia com `elapsed ≈ 10.000ms > 5.000ms`.

---

### CT56 — API permanece saudável após exaustão dos retries

```typescript
test.slow(); // 25s × 3 = 75s de timeout efetivo

// Aciona o ciclo de retry (modo 500)
await setWebhookMode(request, '500');
await capturePayment(triggerPaymentId); // inicia 4 tentativas em background

// Aguarda a exaustão (~9s + margem = 12s)
await sleep(12_000); // único uso justificado de sleep na suíte

// Restaura modo ok e verifica que o servidor ainda funciona
await setWebhookMode(request, 'ok');
expect(healthCapture.status()).toBe(200);
```

**Por quê `sleep` em vez de `pollUntil`?** A exaustão do ciclo de retry não tem
nenhum sinal observável na API — não há endpoint de status do webhook, não há
mudança no pagamento. `pollUntil` exigiria uma condição observável que não existe.
Este é o único caso em que `sleep` é justificado e está documentado com comentário.

---

### CT57 — Reject não chama o webhook

```typescript
await setWebhookMode(request, 'timeout'); // sink dorme 10s

const start = Date.now();
const rejectRes = await request.post(`/payments/${payment_id}/reject`);
const elapsed = Date.now() - start;

expect(elapsed).toBeLessThan(2_000); // se o webhook fosse chamado, seriam ≥10s
```

**Por quê:** Documenta que `RejectPaymentHandler` deliberadamente não chama o webhook
(apenas `CapturePaymentHandler` o faz). Se alguém adicionar uma chamada de webhook
ao reject, este teste falharia com `elapsed ≈ 10.000ms`.

---

## 11. Decisões Globais de Design

### Padrão AAA (Arrange–Act–Assert)

Todo teste segue explicitamente o padrão com comentários de seção:

```typescript
// Arrange
const payload = validPaymentPayload({ amount: 0 });

// Act
const response = await request.post('/payments', { data: payload });

// Assert
expect(response.status()).toBe(400);
```

**Por quê:** Em testes com múltiplas etapas (ex.: CT28: create → conflict → replay),
os comentários delimitam claramente qual linha faz setup e qual faz verificação.

---

### Um Act por teste

CT39 foi removido justamente por violar esta regra — ele testava uma transição inválida
E uma mensagem de erro em um único teste, tornando o diagnóstico de falha ambíguo.
CT33–CT36 cobrem os mesmos cenários, cada um com exatamente um Act.

---

### Tags como contratos de execução

```typescript
{ tag: ['@smoke', '@api', '@creation', '@critical'] }
```

As tags são usadas no pipeline CI para filtrar:

```bash
npx playwright test --grep @smoke    # apenas smoke tests
npx playwright test --grep @critical # apenas testes financeiros P0/P1
```

Isso permite rodar subconjuntos da suíte sem modificar código.

---

### `toBe` vs `toEqual` para objetos

```typescript
// Primitivos: toBe (referência exata)
expect(body.status).toBe('APPROVED');
expect(body.amount).toBe(10000);

// Objetos/arrays: toEqual (comparação profunda de valor)
expect(rep.split).toEqual(orig.split);
```

`toBe` em objetos compara referência, não valor. `toEqual` faz deep equal. Usar `toBe`
em objetos causaria falsos negativos mesmo que os conteúdos fossem idênticos.

---

## 12. O Que Não Foi Testado e Por Quê

| Área | Motivo da exclusão |
|---|---|
| Splits com valores não divisíveis (33/33/34%) | Requer conhecimento de como C# trata divisão inteira; agendado para Mês 2 |
| Fluxo integrado ponta-a-ponta (create → capture → GET → ledger) | Valor incremental baixo dado que cada etapa já é testada individualmente; agendado para Mês 2 |
| Fuzz do campo `amount` com floats e strings | Testes de segurança/robustez; agendado para Mês 3 |
| `Idempotency-Key` com caracteres especiais e strings longas | Idem; agendado para Mês 3 |
| Carga e latência (`P99 < Xms`) | Fora do escopo do Playwright; requer k6 ou Artillery; agendado para Mês 3 |
| Testes de mutação | Requer Stryker; agendado para Mês 3 |
| Headers CORS e rate-limiting | Não documentados como requisito da API mock |
| Reset de estado entre testes | A API não expõe `POST /admin/reset`; contornado com `uniqueKey()` |
