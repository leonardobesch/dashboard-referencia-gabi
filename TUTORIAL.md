# Dashboard Referência Capital — tutorial de configuração

Este pacote é uma cópia do painel de métricas da Referência Capital (Growth Funnel OS). Ele roda no Cloudflare (Worker + D1 + KV) e lê dados da Meta Ads e do PipeRun.

> **Segredos:** nenhum token, senha ou chave está neste pacote. Você vai criar os seus. Não envie nenhum valor por chat, e-mail ou git público.

---

## Prompt para colar no Claude (ou para seguir passo a passo)

> Quero configurar esta cópia do dashboard da Referência Capital na minha conta Cloudflare. Leia o arquivo `TUTORIAL.md` e me guie passo a passo. Antes de cada comando, me explique o que ele faz. Não peça para eu colar senhas ou tokens no chat: eu vou digitá-los direto no terminal quando o comando pedir.

---

## 1. Pré-requisitos

- Conta gratuita na Cloudflare (https://dash.cloudflare.com).
- Node.js 20 ou mais recente (`node -v` no terminal).
- Acesso ao Meta Business Manager das contas de anúncio da Referência Capital, com permissão de leitura.
- Acesso ao PipeRun (token de API).

---

## 2. Instalar as dependências

Dentro da pasta deste pacote:

```bash
npm install -g wrangler
npx wrangler login
```

O `wrangler login` abre o navegador. Entre com **a sua** conta Cloudflare.

Confira a conta ativa:

```bash
npx wrangler whoami
```

---

## 3. Criar o banco D1 e o KV na sua conta

```bash
npx wrangler d1 create referencia-capital-growth-db
npx wrangler kv namespace create META_CONFIG
```

Cada comando mostra um ID. Abra o arquivo `wrangler.toml` e troque:

- `database_id` (em `[[d1_databases]]`) pelo ID do D1.
- `id` (em `[[kv_namespaces]]`) pelo ID do KV.
- `name` na primeira linha (pode deixar `referencia-capital-growth-os`, ou escolher outro nome livre).

Os IDs vêm com marcadores (`COLE-AQUI-...`). **Troque antes de qualquer deploy.**

---

## 4. Criar as tabelas

Execute o esquema e as migrações na ordem abaixo:

```bash
npx wrangler d1 execute referencia-capital-growth-db --remote --file=schema.sql
npx wrangler d1 execute referencia-capital-growth-db --remote --file=schema_optimization.sql
npx wrangler d1 execute referencia-capital-growth-db --remote --file=crm_store.sql
npx wrangler d1 execute referencia-capital-growth-db --remote --file=rc_track.sql
```

Se algum comando reclamar que a tabela já existe, pode seguir: os arquivos usam `CREATE TABLE IF NOT EXISTS`.

---

## 5. Cadastrar os segredos

Cada comando pede o valor no terminal. Digite e pressione Enter. O valor não aparece na tela.

| Segredo | O que é | Como gerar / onde pegar |
|---|---|---|
| `PANEL_PASSWORD` | Senha para entrar no painel | Crie uma senha forte e guarde em um gerenciador de senhas |
| `ADMIN_KEY` | Chave da rota administrativa (`x-admin-key`) | Gere uma string aleatória longa, por exemplo com `openssl rand -hex 32` |
| `TOKEN_KEY` | Chave que cifra os tokens guardados no KV | `openssl rand -hex 32`. **Guarde bem: se perder, os tokens salvos viram lixo** |
| `META_ACCESS_TOKEN` | Token da Meta com acesso às contas de anúncio | Meta for Developers → seu app → gerar token de usuário do sistema com `ads_read` nas contas da Referência Capital |
| `PIPERUN_TOKEN` | Token de API do PipeRun | PipeRun → Configurações → Integrações/API |

```bash
npx wrangler secret put PANEL_PASSWORD
npx wrangler secret put ADMIN_KEY
npx wrangler secret put TOKEN_KEY
npx wrangler secret put META_ACCESS_TOKEN
npx wrangler secret put PIPERUN_TOKEN
```

Se a Meta ou o PipeRun não forem usados, pode pular o segredo correspondente; a tela avisa que a fonte está sem dados.

---

## 6. Ajustar o que é específico da Referência Capital

No `worker.js`, duas listas são fixas:

- `RC_ACCOUNT_IDS`: as 13 contas de anúncio da Referência Capital. Se você não tem acesso a elas, troque pela lista das contas que você pode ler.
- `RC_PROSPECTION_PIPELINE_ID = '78790'` e `RC_CLOSER_PIPELINE_ID = '84566'`: os funis oficiais do PipeRun. Confirme os IDs no seu PipeRun antes de usar.

---

## 7. Deploy

```bash
npx wrangler deploy
```

No fim, o terminal mostra a URL do Worker (algo como `https://referencia-capital-growth-os.<sua-conta>.workers.dev`). Abra no navegador e entre com a `PANEL_PASSWORD`.

---

## 8. Como os dados entram (importante)

O cron do Worker está **desligado** (`crons = []` no `wrangler.toml`). Quem busca os dados da Meta e do PipeRun é um serviço local, em `archive/service.mjs`, que roda em um computador (Node + SQLite). Ele envia os dados para o Worker.

Para isso funcionar, é preciso:

1. Ter um computador ligado com Node instalado.
2. Copiar `archive/config.example.json` para `archive/config.json` e preencher com a URL do seu Worker e as chaves da assinatura. (Antes de usar, confira o formato do arquivo: a versão de exemplo não estava em JSON válido na minha leitura.)
3. Gerar o par de chaves com `node archive/setup-key.mjs`. Ele mostra a chave pública, que você cadastra no Worker, e guarda a privada no computador. **Nunca envie a chave privada.**
4. Rodar `node archive/service.mjs` (ou `archive/start-archive.cmd` no Windows).

Sem esse serviço, o painel abre, mas sem dados novos de Meta e PipeRun.

> **Alternativa a decidir:** ligar o cron no próprio Cloudflare (sem computador). Isso exige reescrever a parte de coleta. Ainda não foi feito.

---

## 9. Conferir se está funcionando

1. Abra a URL do Worker e entre com a senha do painel.
2. Abra a aba de métricas: deve aparecer o período padrão (últimos 30 dias).
3. Se aparecer "sem dados", confira: segredos cadastrados (`npx wrangler secret list`), IDs no `wrangler.toml` e o serviço local rodando (seção 8).

---

## 10. O que não está neste pacote (de propósito)

- Senhas, tokens, chaves privadas e arquivos `.env`.
- Bancos de dados locais (`archive/data`, `*.sqlite`).
- Versões antigas e cópias de outros projetos.
- IDs de banco, KV e chave pública da conta original: substituídos por marcadores. Preencha conforme as seções 3 e 8.
