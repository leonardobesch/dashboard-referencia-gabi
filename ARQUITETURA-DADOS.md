# Prompt / especificação — Arquitetura de dados do Growth Funnel OS (Referência Capital)

Use este documento como prompt para qualquer manutenção futura nos dados do painel.

## Objetivo
1. **Histórico completo no computador local** (SQLite local, sem limite): Meta Ads + PipeRun desde o início.
2. **Cloudflare só com os dados "quentes"** (últimos 30 dias) para o painel abrir rápido em qualquer lugar.
3. **Período único no painel**: padrão = últimos 30 dias; seletor visível no topo (7/30/90 dias ou personalizado);
   a mesma data vale para todas as abas e continua selecionada ao trocar de aba (e ao recarregar a página).
4. Período dentro dos últimos 30 dias → dados do Cloudflare. Período maior → dados do arquivo local no PC
   (`http://127.0.0.1:8789`). Se o PC/serviço não estiver disponível, a tela avisa em vez de mostrar números incompletos.

5. **PC primeiro para tudo**: `public/period.js` redireciona toda chamada `/api/*` para `http://127.0.0.1:8789`
   quando o serviço do PC responde. O PC atende localmente cache, histórico, sincronização e a aba Otimização
   (mesmo `optimization-worker.js`, tabelas no SQLite) e repassa o resto ao Worker. Ações na Meta a partir do PC
   passam pela ponte assinada `/api/archive/meta-action` (token só no Cloudflare). Configurações da Otimização
   salvas no PC ficam no SQLite local.

## Fontes e escopo
- **Meta Ads**: 13 contas da Referência Capital (lista fixa `RC_ACCOUNT_IDS` em `worker.js`). Filtro de escopo: `isReferenciaCapitalAdRaw`.
- **PipeRun**: somente os pipelines oficiais
  - `78790` Prospecção - Consórcio (SDR): Novos → Abertura → Conexão → Qualificados → No show → Agendamento → Oportunidade
  - `84566` Vendas - Consórcio (Closers): 1ª Reunião → Pré-RC2 → 2ª Reunião → Contorno de objeções → Green flag → Documentação → Resgate
- Tokens (Meta e PipeRun) ficam **só no Cloudflare** (`wrangler secret put META_ACCESS_TOKEN` / `PIPERUN_TOKEN`).
  O PC nunca guarda token: ele busca os dados através do Worker (`/api/archive/*`), com requisição assinada (ECDSA).

## Definições do funil (iguais no Cloudflare e no PC — código único em `crm-store.js`)
| Etapa | Definição |
|---|---|
| Lead CRM | negócio criado no 78790 (data = criação) |
| Lead Meta no CRM | negócio do 78790 com "ID do anúncio" preenchido ("Lead ID" do PipeRun é interno e vem em todos) |
| Agendamento | negócio criado no 84566 |
| Comparecimento | atividade "1ª Reunião" concluída (status 2); no-show = status 4 |
| Proposta / 2ª reunião | atividade "2ª Reunião" concluída |
| Venda | negócio do 84566 ganho (status 1), data = fechamento; valor = campo Valor do PipeRun |
| Atribuição ao anúncio | campo "ID do anúncio" do negócio; negócio do Closer herda o anúncio do negócio SDR da mesma pessoa |

## Limites do Cloudflare (plano gratuito) que a arquitetura respeita
- 50 chamadas externas por execução → cópia do CRM em passos pequenos (fila em `sync_state.crm_queue`).
- D1: 100 mil linhas gravadas por dia → upserts só gravam quando o registro mudou; D1 guarda só 30 dias.
- Cron a cada 5 min: minutos múltiplos de 15 = Meta; demais = passo do CRM.

## Componentes
- `worker.js` — API + cron. D1 = dados quentes. `/api/archive/*` = ponte assinada para o PC.
- `crm-store.js` — cópia incremental do PipeRun e cálculo do funil (roda no Worker **e** no PC, mesmo código).
- `optimization-worker.js` — aba Otimização.
- `archive/service.mjs` — serviço local (Node + SQLite em `archive/data/`): sincroniza tudo, confirma ao Worker
  (`/api/archive/ack`) o que já está salvo, e responde o painel para períodos longos.
- `public/` — painel. `period.js` = período global compartilhado entre abas.

## Deploy
- `npx wrangler deploy`, com a sua própria conta Cloudflare (`npx wrangler login`).
- Comandos D1: `npx wrangler d1 execute referencia-capital-growth-db --remote --command "..."`.

## Regras
- Nunca inventar números; dado ausente aparece como ausente.
- O Worker só apaga dados antigos do D1 depois que o PC confirmar que já os arquivou.
- Testar JS com `node --input-type=module --check < arquivo.js` antes do deploy; validar as abas no ambiente publicado.
