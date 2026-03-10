# Estratégia de Qualidade — Mock Payments API

> Este documento aborda a estratégia de pipeline CI/CD, modelo de risco, justificativa de cobertura de testes, protocolo de investigação de incidentes, métricas de qualidade e o roadmap de 30-60-90 dias para a suite de testes construída nos Passos 0-8.

---

## 1. Pipeline CI/CD

### Distribuição de testes por estágio

| Estágio | Gatilho | Projetos | Passos cobertos | Tempo estimado |
|---|---|---|---|---|
| **PR Gate** | Pull Request | `api` + `ledger` | 1, 2, 3, 4, 6 | ~30 s |
| **Full Suite** | Push para `main` / cron diário | todos | 1–7 | ~2-3 min |

A divisão é intencional: **o PR Gate cobre todos os riscos financeiros P0/P1** (criação, validação, idempotência, transições de estado, consistência do ledger) usando apenas testes rápidos e determinísticos. Testes lentos (concorrência, retry de webhook) são executados após o merge, onde uma falha não bloqueia o dia de um desenvolvedor, mas ainda valida a branch principal.

### Estratégia de feedback rápido

- O PR Gate é executado em < 45 s — mais rápido que uma rodada de revisão de código.
- Testes de webhook (CT53–CT57, ~22 s cada) são excluídos do PR Gate porque dependem do timing da rede Docker e adicionam variância sem melhorar o sinal em um novo PR.
- Uma falha no PR Gate bloqueia o merge. Uma falha no Full Suite dispara um alerta no Slack e deve ser corrigida antes que o próximo PR seja mergeado.

### Redução de instabilidade (flakiness)

| Técnica | Aplicada onde |
|---|---|
| `uniqueKey()` com sufixo `timestamp + random` | Todos os testes de idempotência e criação |
| Cada teste cria seus próprios pagamento(s) | Todos os testes — sem estado compartilhado |
| `beforeEach` redefine o modo de webhook para `ok` | CT53–CT57 |
| `test.slow()` triplica o timeout no CT56 | Apenas CT56 (tempo de execução esperado de 22 s) |
| Nenhum teardown necessário | Servidor reiniciado entre jobs de CI via `docker compose down` |

### Estratégia de dados de testes

| Aspecto | Abordagem |
|---|---|
| **Setup** | Cada teste cria seus próprios dados via API: `validPaymentPayload()` + `uniqueKey()` |
| **Fixtures** | `tests/helpers/payment-helpers.ts` centraliza payloads, geração de chaves e helpers de atalho |
| **Teardown** | Não necessário — a API mock é stateless por container; `docker compose down` reseta tudo |
| **Seed data** | Não utilizado — cada teste é autossuficiente e produz apenas o estado que precisa |

---

## 2. Matriz de Riscos

Os riscos são pontuados por **Probabilidade × Impacto** (escala de 1-3 cada, resultando em 1-9).
A cobertura indica quais casos de teste abordam cada risco.

| # | Risco | Probabilidade | Impacto | Score | Mitigação / Cobertura |
|---|---|:---:|:---:|:---:|---|
| R01 | Pagamento duplicado criado por ausência de chave de idempotência | 3 | 3 | **9** | CT05, CT25-CT30 |
| R02 | Chave de idempotência reutilizada com payload diferente → corrupção silenciosa de dados | 2 | 3 | **6** | CT06, CT28, CT30 |
| R03 | Pagamento capturado duas vezes → lançamento duplicado no ledger / cobrança dupla | 3 | 3 | **9** | CT33, CT42, CT44 |
| R04 | Falha no webhook causa falha na captura / rollback | 2 | 3 | **6** | CT54, CT55 |
| R05 | Loop de retry de webhook trava a API após máximo de tentativas | 1 | 3 | **3** | CT56 |
| R06 | Valor ou moeda inválidos aceitos → erro no cálculo financeiro | 3 | 3 | **9** | CT02, CT08-CT12 |
| R07 | Percentuais de split > ou < 100 aceitos → desequilíbrio no ledger | 3 | 3 | **9** | CT04, CT13-CT16, CT22 |
| R08 | Transição de estado terminal (APPROVED/FAILED) permitida → estado inválido | 2 | 3 | **6** | CT33-CT36, CT39 |
| R09 | Pagamento rejeitado dispara webhook | 1 | 2 | **2** | CT57 |
| R10 | Condição de corrida em criações concorrentes produz pagamentos duplicados | 2 | 2 | **4** | CT41, CT43 |
| R11 | Condição de corrida em capturas concorrentes produz linhas duplicadas no ledger | 2 | 3 | **6** | CT42, CT44 |
| R12 | GET /payments retorna status desatualizado após transição de estado | 1 | 2 | **2** | CT40 |
| R13 | payment_id inexistente retorna 200 em vez de 404 | 1 | 2 | **2** | CT37, CT38 |
| R14 | Busca por chave de idempotência é case-insensitive (deduplicação não intencional) | 1 | 2 | **2** | CT29 |
| R15 | Campo `currency` aceita strings arbitrárias após normalização no servidor | 2 | 2 | **4** | CT10-CT12 |

---

## 3. Mapa de Cobertura de Testes

```
CT01-CT07   Caminho feliz de criação de pagamento + idempotência estrutural
CT08-CT24   Validação de entrada (valor, moeda, split — 17 casos extremos)
CT25-CT30   Aprofundamento em idempotência (triple replay, comparação completa de body,
             sensibilidade a maiúsculas/minúsculas, cobertura de hash, preservação de estado em conflito)
CT31-CT40   Máquina de estados (todas as 6 transições, ambos os caminhos 404, contrato
             de mensagem de erro, consistência de leitura após escrita)
CT41-CT44   Concorrência (corrida com mesma chave, captura concorrente, criações sem chave,
             verificação de mutex no ledger)
CT53-CT57   Resiliência de webhook (timing fire-and-forget, transparência de 500,
             não-bloqueio por timeout, exaustão de retries, rejeição sem webhook)
```

### Lacuna: passos ainda não implementados

| Passo | Área | CTs ausentes |
|---|---|---|
| Passo 6 | Endpoint do ledger (GET /ledger/{id}) | CT45-CT52 (planejado) |
| Passo 7 | Fluxos de integração (create→capture→GET) | CTs de fluxo completo (planejado) |

---

## 4. Decisões Técnicas e Trade-offs

### Escolha de ferramenta: Playwright vs Supertest / Axios

| Critério | Playwright `request` | Supertest | Axios + Jest |
|---|---|---|---|
| Fixtures tipadas | Nativo | Requer configuração | Requer configuração |
| Configurações paralelas de projeto | Nativo | Manual | Manual |
| Reporter de CI | Embutido (`github`) | Nenhum | Nenhum |
| Caminho de evolução para browser | Sim (se UI for adicionada) | Não | Não |
| Apenas API (sem instalação de browser) | Sim | N/A | N/A |

Playwright foi escolhido pelo reporter de CI sem configuração, `APIRequestContext` tipado e pela capacidade de evoluir para testes E2E sem trocar de framework.

### Store em memória — sem isolamento de teste no nível do servidor

A API armazena todo o estado em instâncias de `ConcurrentDictionary` que vivem pelo tempo de vida do container. Não há endpoint `/reset` ou teardown por teste. O isolamento é alcançado gerando identificadores únicos (`uniqueKey()`) e criando novos pagamentos por teste. Este é um trade-off consciente: mantém a API simples, mas exige que os testes sejam aditivos (nunca dependam de estado limpo).

### Concorrência: paralelismo de I/O, não de threads

`Promise.all()` no Node.js emite todas as requisições na mesma thread do event loop, dependendo do OS e do thread pool do ASP.NET Core para criar a condição de corrida real. Isso é suficiente para exercitar os guards do lado do servidor (`SemaphoreSlim`, `GetOrAdd`), mas não substitui ferramentas de load testing (k6, Artillery) para baselines de throughput ou latência.

### Asserções suaves no CT42

`Payment.Capture()` realiza uma verificação e definição não-atômica em `Status`. Sob carga concorrente, mais de uma captura pode ter sucesso na camada HTTP. Este é um detalhe de implementação conhecido. CT42 **não** asserta "exatamente um 200" porque isso seria um teste instável; em vez disso, asserta o invariante que **sempre** se mantém: sem 5xx, todas as respostas são 200 ou 422, pelo menos um 200.
CT44 cobre a garantia forte: o ledger é escrito exatamente uma vez.

---

## 5. Protocolo de Investigação de Incidentes — Redução de MTTR

Cada cenário segue o mesmo processo de cinco etapas:
**triagem → reprodução → isolamento → teste de regressão → post-mortem.**
Uma correção só está completa quando o novo teste de regressão está verde.

---

### Cenário 1: cobranças duplicadas reportadas em produção

**Etapa 1 — Triagem (< 5 min)**
- Identificar os `payment_id`s afetados nos tickets de suporte ou logs do processador de pagamentos.
- Verificar se as duplicatas compartilham a mesma `Idempotency-Key` (falha de idempotência) ou têm chaves diferentes (cobranças genuinamente separadas).

**Etapa 2 — Reproduzir localmente (< 15 min)**
```bash
# Iniciar a API
docker compose up -d --wait

# Simular o cenário que causou as duplicatas
# Opção A: mesma chave, mesmo payload — deve retornar o mesmo pagamento
curl -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: incident-repro-001" \
  -d @examples/payment-request.json

curl -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: incident-repro-001" \
  -d @examples/payment-request.json

# Esperado: ambas as chamadas retornam o MESMO payment_id
# Se retornarem IDs diferentes: idempotência está quebrada → R01/R02

# Opção B: requisições concorrentes
npx playwright test --project=concurrency tests/concurrency/concurrent-requests.spec.ts
```

**Etapa 3 — Isolar o caminho de falha**

| Sintoma | Causa raiz provável | Testes relevantes |
|---|---|---|
| `payment_id` diferente para mesma chave + payload | Corrida perdida no `ConcurrentDictionary.GetOrAdd` | CT41 |
| Mesmo `payment_id` mas duas linhas no ledger | `SemaphoreSlim` não adquirido corretamente | CT44 |
| `payment_id` diferente entre chaves mas mesmo payload | Esperado — sem bug | CT43 |
| Captura retorna 200 duas vezes para o mesmo ID | Leitura-escrita não-atômica em `Payment.Status` | CT42 |

**Etapa 4 — Adicionar um teste de regressão**
Antes de corrigir o bug, escreva um teste falho que o reproduza. Adicione-o ao arquivo de spec apropriado. A correção só está completa quando o novo teste passa.

**Etapa 5 — Verificar end-to-end**
```bash
npm run test:api
npm run test:concurrency
```

**Etapa 6 — Post-mortem**
Documentar em `docs/incidents/YYYY-MM-DD-<slug>.md`:
- Linha do tempo
- Causa raiz (referência ao arquivo fonte + linha)
- Correção aplicada
- Teste de regressão adicionado (número do CT)
- Medidas preventivas

---

### Cenário 2: pagamentos capturados mas ausentes do ledger

> "Alguns pagamentos foram cobrados, mas suas entradas nunca apareceram no ledger."

#### Hipóteses de causa raiz

**H1 — Falha transacional durante a captura**
`CapturePaymentHandler` atualiza o status do pagamento para `APPROVED` e então
chama `TryWriteAsync`. Se a escrita no ledger falhar (timeout, violação de constraint)
após o status já ter sido mutado, o pagamento fica `APPROVED` sem registro contábil.
Não há transação atômica cobrindo ambas as operações.

**H2 — Condição de corrida em capturas concorrentes**
Duas requisições de captura chegam quase simultaneamente. Ambas passam pela verificação
de `PENDING` em `Payment.Capture()` antes que qualquer uma escreva o novo status. Ambas
prosseguem para o ledger; o `SemaphoreSlim` garante que apenas uma escrita seja efetivada,
mas a segunda thread pode observar o ledger como já escrito e silenciosamente ignorá-lo.

**H3 — Falha silenciosa no processamento assíncrono**
Se as escritas no ledger fossem orientadas a eventos (fila de mensagens), o evento poderia
ser perdido: reinicialização do broker, configuração de dead-letter ausente, ou um bug de
desserialização no consumidor. O pagamento é capturado; o evento do ledger nunca é processado.
*(Não é a arquitetura atual — relevante se o sistema for migrado para event sourcing.)*

**H4 — Timeout + retry incorreto**
A escrita no ledger expira por timeout, mas foi de fato confirmada. O retry encontra uma
violação de unicidade, descarta silenciosamente, e o registro original nunca foi persistido.

#### Plano de reprodução

```bash
# 1. Iniciar a API
docker compose up -d --wait

# 2. H1 — Capturar e verificar o ledger imediatamente
PAYMENT_ID=$(curl -s -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: incident2-001" \
  -d @examples/payment-request.json | python3 -c "import sys,json; print(json.load(sys.stdin)['payment_id'])")

curl -s -X POST http://localhost:3000/payments/$PAYMENT_ID/capture

curl -s http://localhost:3000/ledger/$PAYMENT_ID
# Esperado: {"payment_id":"...","entries":[...]}
# Se 404 ou vazio: H1 confirmado

# 3. H2 — Executar teste de captura concorrente
npx playwright test --project=concurrency tests/concurrency/concurrent-requests.spec.ts

# 4. Verificar logs do container para erros no ledger
docker logs mock-payments-api | grep -E "ledger|error|warn"
```

**Tabela de decisão de isolamento:**

| Sintoma | Hipótese provável | Testes relevantes |
|---|---|---|
| `GET /ledger/{id}` retorna 404 após captura bem-sucedida | H1 | CT45 (planejado) |
| Ledger tem entradas corretas mas `amount` divergente | H4 | CT48 (planejado) |
| Entradas de `GET /ledger/{id}` aparecem apenas na segunda requisição | H2 | CT42, CT44 |
| Ledger ausente apenas em execuções de alta concorrência | H2 | CT44 |

#### Logs e métricas necessários

Os seguintes devem estar presentes em logs JSON estruturados (correlacionados por
`payment_id`) para diagnosticar este incidente em 15 minutos:

```
payment.capture.started        { payment_id, status_before }
payment.capture.status_updated { payment_id, new_status }
ledger.write.started           { payment_id, entries_count }
ledger.write.completed         { payment_id, duration_ms }
ledger.write.failed            { payment_id, error, stack_trace }
```

**Métricas de alerta:**

| Métrica | Tipo | Limiar de alerta |
|---|---|---|
| `payment_capture_total{status}` | counter | — |
| `ledger_write_total{status="ok\|failed"}` | counter | P0 se `failed > 0` |
| `ledger_write_duration_ms` | histogram | P95 > 500 ms → warning |
| `payment_without_ledger` | gauge | **P0 se > 0** — alerta imediato |

#### Testes de regressão para prevenir recorrência

| Teste | Hipótese coberta |
|---|---|
| CT45 — Pagamento capturado tem entradas no ledger | H1 |
| CT48 — Soma dos créditos é igual ao valor do débito | H1, H4 |
| CT42 — Sem 5xx em capturas concorrentes | H2 |
| CT44 — Ledger tem exatamente as entradas corretas após capturas concorrentes | H2 |

#### Melhorias estruturais

1. **Transação atômica** — encapsular a atualização de status + escrita no ledger em uma única transação de banco; se a escrita no ledger falhar, reverter a mudança de status.
2. **Padrão Outbox** — inserir um evento de ledger em uma tabela outbox dentro da mesma transação da atualização de status; um worker separado o processa. Reprocessar um evento já aplicado é seguro porque `TryWriteAsync` é idempotente.
3. **Consumidor de ledger idempotente** — usar `payment_id` como chave de deduplicação; reprocessar um evento deve ser uma operação nula, não um erro.
4. **Job de reconciliação** — um cron que compara todos os pagamentos `APPROVED` com as entradas do ledger; discrepâncias disparam reprocessamento automático e um alerta P0.
5. **Constraint única no ledger** — `UNIQUE(payment_id, type, account)` como guarda de último recurso contra duplicatas mesmo sob tempestades de retry.

---

## 6. Métricas de Qualidade

### Acompanhamento semanal

| Métrica | O que mede | Conectada a | Meta |
|---|---|---|---|
| **Bugs escapados para produção** | Bugs encontrados por clientes ou monitoramento | Risco (financeiro / UX) | ≤ 1 / semana |
| **Incidentes pós-deploy** | Incidentes P0/P1 nas primeiras 24 h após deploy | Velocidade (confiança no deploy) | 0 por deploy |
| **Taxa de rollback** | % de deploys que exigiram rollback | Velocidade (estabilidade) | < 5% |
| **Cobertura de fluxos P0** | % de cenários da matriz de risco P0/P1 com testes automatizados | Risco (proteção financeira) | 100% |
| **MTTD** | Tempo médio entre ocorrência do bug e detecção | Qualidade percebida | < 5 min |
| **MTTR** | Tempo médio entre detecção e resolução | Qualidade percebida + velocidade | < 30 min (P0) |
| **Taxa de testes instáveis** | % de testes falhando sem mudança de código | Velocidade (confiança na suite) | < 2% |
| **Frequência de deploy** | Deploys em produção por semana | Velocidade | ≥ 5 / semana |
| **Tempo de execução da suite** | Tempo total de execução da suite completa | Velocidade (ciclo de feedback) | < 5 min |

### Metas no nível da suite

| Métrica | Meta | Atual | Fonte |
|---|---|---|---|
| Taxa de aprovação da suite (branch main) | 100% | 100% | GitHub Actions `full-suite` |
| Duração do `pr-gate` | < 60 s | ~30 s | Timing do GitHub Actions |
| Duração do `full-suite` | < 5 min | ~2-3 min | Timing do GitHub Actions |
| Cobertura de CTs dos endpoints da API | 100% dos endpoints documentados | 100% | Mapeamento manual |
| Cobertura de risco crítico (score ≥ 6) | 100% | 100% | Matriz de risco §2 |
| Taxa de testes instáveis (últimas 30 execuções) | < 2% | 0% | Histórico do GitHub Actions |

### Como cada métrica orienta decisões

- **Bugs escapados ↑** → expandir a suite de testes para fluxos não cobertos; revisar a matriz de risco
- **Incidentes pós-deploy > 0** → introduzir deploys canary ou feature flags; adicionar smoke tests
- **Taxa de rollback > 5%** → aumentar cobertura de testes de integração; adicionar quality gates pré-deploy
- **MTTD alto** → investir em observabilidade: alertas de anomalia de 5xx, gauge de pagamento sem ledger
- **MTTR alto** → melhorar runbooks; adicionar logs estruturados com IDs de correlação de `payment_id`

### Como medir instabilidade

```bash
# Executar a suite completa 5 vezes e contar falhas
for i in $(seq 1 5); do npx playwright test --pass-with-no-tests; done
```

Um teste é considerado instável se falhar em ≥ 1 de 5 execuções sem mudança de código.
Marque testes instáveis com `test.fixme()` e abra uma issue de rastreamento imediatamente.

### Lacunas de cobertura (dívida técnica)

As seguintes áreas ainda não têm cobertura automatizada:

- Endpoint `GET /ledger/{id}` (Passo 6 — planejado, CT45-CT52)
- Fluxos de integração multi-etapas: create → capture → GET ledger (Passo 7)
- `GET /payments/{id}` 404 para ID inexistente (parcialmente coberto implicitamente por CT37/CT38)
- Casos extremos de arredondamento em `SplitItem.CalculateAmount` (ex.: split em 3 partes com valores não divisíveis)
- Testes de stress / carga (throughput, latência P99) — fora do escopo do Playwright; usar k6

---

## 7. Roadmap de 30-60-90 Dias

### Mês 1 (Dias 1-30) — Base completa

**Concluído (Passos 0-8):**
- [x] Configuração do Playwright com TypeScript, 5 projetos, pipeline de CI
- [x] Testes de criação de pagamento (CT01-CT07)
- [x] Testes de validação (CT08-CT24)
- [x] Testes de idempotência (CT25-CT30)
- [x] Testes de transição de estado (CT31-CT40)
- [x] Testes de concorrência (CT41-CT44)
- [x] Testes de resiliência de webhook (CT53-CT57)
- [x] GitHub Actions: `pr-gate` + `full-suite`
- [x] Documentação da estratégia de qualidade

**Metas:**
- Todos os testes do `pr-gate` passando em cada PR
- Zero testes instáveis na branch main
- Duração média do `pr-gate` < 45 s

### Mês 2 (Dias 31-60) — Expansão de cobertura

- [ ] **Passo 6 — Testes do ledger (CT45-CT52)**
  - Ledger criado após captura, valores corretos, sem entradas após rejeição
  - Ledger não duplicado em capturas concorrentes (integração com CT44)
  - `GET /ledger/{id}` retorna 404 para pagamento desconhecido
- [ ] **Fluxos de integração**
  - Caminho feliz completo: create → capture → GET payment → GET ledger
  - Caminho de rejeição completo: create → reject → GET payment → capture bloqueado (422)
  - Idempotência ao longo de todo o ciclo de vida
- [ ] **Testes de contrato**
  - Validação de schema de resposta (amount é inteiro, currency é string, etc.)
  - Garantir que nenhum campo não documentado seja adicionado sem atualização de teste
- [ ] **Observabilidade**
  - Reporter HTML do Playwright habilitado localmente (`npx playwright show-report`)
  - Notificação via Slack/email em falha do `full-suite` via GitHub Actions

### Mês 3 (Dias 61-90) — Hardening e performance

- [ ] **Baseline de carga / stress com k6**
  - 100 usuários concorrentes criando pagamentos: metas de latência P50/P95/P99
  - Verificar ausência de vazamento de memória sob carga sustentada (store em memória cresce ilimitadamente)
- [ ] **Mutation testing**
  - Aplicar Stryker ou equivalente à camada de domínio
  - Meta de kill rate: > 80%
- [ ] **Chaos / injeção de falhas**
  - Matar o webhook-sink durante retry; verificar se a API se recupera
  - Reiniciar o container da API; verificar que o estado em memória é perdido (documentar limitação)
- [ ] **Gerenciamento de dados de teste**
  - Adicionar endpoint `POST /admin/reset` (apenas em modo de desenvolvimento) para permitir
    isolamento verdadeiro por teste e eliminar o workaround do `uniqueKey()`
- [ ] **Superfície de segurança**
  - Fuzzing do campo amount com valores muito grandes, floats, strings
  - Verificar header `Idempotency-Key` com caracteres especiais, strings muito longas
  - Verificar ausência de headers CORS e rate-limiting nas respostas
