# Guia de Execução dos Testes — Mock Payments API

> Este guia descreve como configurar o ambiente, executar a suíte completa ou
> partes específicas dela, e interpretar os resultados.

---

## 1. Pré-requisitos

| Ferramenta | Versão mínima | Finalidade |
|---|---|---|
| Node.js | 18 LTS | Executar Playwright e scripts npm |
| Docker Desktop | 4.x | Subir a API e o webhook sink |
| npm | 9.x (incluído no Node 18) | Gerenciar dependências |

---

## 2. Configuração Inicial

### 2.1 Instalar dependências

```bash
npm install
```

### 2.2 Subir a infraestrutura

```bash
# Inicia a API (porta 3000) e o webhook sink (porta 4000)
docker compose up -d --wait
```

Verifique que os serviços estão saudáveis:

```bash
docker compose ps
# Ambos devem estar com status "running" ou "healthy"
```

### 2.3 Confirmar que a API responde

```bash
curl -s http://localhost:3000/payments \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"amount":100,"currency":"BRL","customer_id":"c1","merchant_id":"m1","split":[{"recipient":"s","percentage":100}]}'
# Esperado: 201 com payment_id
```

---

## 3. Executar os Testes

### 3.1 Suíte completa

```bash
npx playwright test
```

Executa todos os 62 cenários em modo paralelo com os projetos configurados em `playwright.config.ts`.

---

### 3.2 Por projeto (grupo de testes)

| Projeto | Comando | Cenários | Tempo estimado |
|---|---|:---:|---|
| `api` | `npx playwright test --project=api` | 45 | ~5 s |
| `ledger` | `npx playwright test --project=ledger` | 8 | ~3 s |
| `concurrency` | `npx playwright test --project=concurrency` | 4 | ~5 s |
| `webhook` | `npx playwright test --project=webhook` | 5 | ~30 s |

---

### 3.3 Por arquivo de spec

```bash
# Apenas criação de pagamentos
npx playwright test tests/api/payment-creation.spec.ts

# Apenas validação de entrada
npx playwright test tests/api/payment-validation.spec.ts

# Apenas idempotência
npx playwright test tests/api/payment-idempotency.spec.ts

# Apenas transições de estado
npx playwright test tests/api/payment-state-transitions.spec.ts

# Apenas concorrência
npx playwright test tests/concurrency/concurrent-requests.spec.ts

# Apenas ledger
npx playwright test tests/ledger/ledger.spec.ts

# Apenas webhook (lentos — incluem retentativas reais)
npx playwright test tests/webhook/webhook-resilience.spec.ts
```

---

### 3.4 Por tag

```bash
# Somente testes smoke (pré-deploy rápido)
npx playwright test --grep "@smoke"

# Somente testes críticos (bloqueantes de release)
npx playwright test --grep "@critical"

# Somente testes de validação de entrada
npx playwright test --grep "@validation"

# Somente testes de idempotência
npx playwright test --grep "@idempotency"

# Somente testes de concorrência
npx playwright test --grep "@concurrency"

# Somente testes de webhook
npx playwright test --grep "@webhook"

# Somente testes de ledger
npx playwright test --grep "@ledger"

# Excluir testes lentos de webhook (modo PR Gate local)
npx playwright test --grep-invert "@webhook"
```

---

### 3.5 Por ID de cenário (CT)

```bash
# Executar um cenário específico pelo nome
npx playwright test --grep "CT01"

# Executar múltiplos cenários
npx playwright test --grep "CT41|CT42|CT43|CT44"
```

---

### 3.6 Simular o PR Gate (rápido)

Reproduz a pipeline de validação de PR sem os testes lentos de webhook:

```bash
npx playwright test --project=api --project=ledger
# Esperado: 53 testes em ~10 s
```

---

### 3.7 Simular a Full Suite com sharding (como no CI)

```bash
# Shard 1 de 3
npx playwright test --shard=1/3

# Shard 2 de 3
npx playwright test --shard=2/3

# Shard 3 de 3
npx playwright test --shard=3/3
```

---

## 4. Relatórios

### 4.1 Relatório HTML (recomendado localmente)

```bash
# Executa os testes e abre o relatório no browser ao final
npx playwright test --reporter=html

# Abre um relatório já gerado
npx playwright show-report
```

### 4.2 Relatório no terminal

```bash
# Saída concisa (padrão)
npx playwright test --reporter=list

# Saída detalhada com passos
npx playwright test --reporter=line
```

### 4.3 Relatório JSON (integração com ferramentas externas)

```bash
npx playwright test --reporter=json > test-results.json
```

---

## 5. Opções Úteis

| Flag | Efeito |
|---|---|
| `--workers=4` | Limita o número de workers paralelos |
| `--retries=2` | Retenta cenários falhos até 2 vezes antes de marcar como falho |
| `--timeout=30000` | Define o timeout por teste em ms (padrão: 25000) |
| `--headed` | Abre o browser (só para testes E2E — não se aplica aqui) |
| `--debug` | Abre o Playwright Inspector para depuração passo a passo |
| `--pass-with-no-tests` | Retorna exit 0 mesmo sem testes encontrados |
| `-x` | Para na primeira falha |

---

## 6. Executar Apenas o Teste Mais Lento (CT56)

CT56 verifica que a API permanece saudável após esgotar todas as 4 tentativas de webhook (aguarda ~12 s):

```bash
npx playwright test --grep "CT56"
# Tempo esperado: ~15-20 s (test.slow() triplica o timeout)
```

> Não inclua CT56 em pipelines de PR — execute apenas pós-merge ou em estágio dedicado de CI.

---

## 7. Verificação de Estabilidade (Detecção de Testes Instáveis)

Execute a suíte 5 vezes seguidas sem alteração de código. Um teste é considerado instável se falhar em pelo menos 1 de 5 execuções:

```bash
for i in $(seq 1 5); do
  echo "=== Execução $i ==="
  npx playwright test --pass-with-no-tests
done
```

Meta: **0% de taxa de instabilidade** no branch `main`.

---

## 8. Encerrar a Infraestrutura

```bash
# Para e remove os containers (zera o estado em memória da API)
docker compose down
```

> Como a API usa `ConcurrentDictionary` em memória, `docker compose down` é suficiente para limpar todos os dados de teste. Não é necessário nenhum endpoint de reset.

---

## 9. Solução de Problemas Comuns

| Sintoma | Causa Provável | Solução |
|---|---|---|
| `Error: connect ECONNREFUSED 127.0.0.1:3000` | API não está rodando | `docker compose up -d --wait` |
| `Error: connect ECONNREFUSED 127.0.0.1:4000` | Webhook sink não está rodando | `docker compose up -d --wait` |
| CT56 excede o timeout | `test.slow()` não está ativo ou timeout do projeto < 75 s | Verifique `playwright.config.ts` — timeout padrão deve ser ≥ 25 s |
| Testes de idempotência falhando aleatoriamente | Chaves colidindo entre execuções paralelas | `uniqueKey()` já inclui timestamp + random — inspecione se o helper foi modificado |
| `Response has been disposed` nos testes de concorrência | Contexto descartado antes de consumir o body | Padrão `firePost()` já resolve — verifique se novos testes seguem o mesmo padrão |
| `502 Bad Gateway` em qualquer teste | API reiniciando ou com erro | `docker logs mock-payments-api --tail=50` para inspecionar o erro |

---

## 10. Referências Rápidas

| Recurso | Local |
|---|---|
| Especificações dos cenários | `docs/tests-spec.md` |
| Relatório de cobertura detalhado | `docs/relatorio-cobertura-testes.md` |
| Estratégia de qualidade e roadmap | `docs/quality-strategy.md` |
| Helpers compartilhados | `tests/helpers/payment-helpers.ts` |
| Configuração do Playwright | `playwright.config.ts` |
| Pipeline de CI | `.github/workflows/` |
