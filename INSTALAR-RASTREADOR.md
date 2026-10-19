# Instalar o rastreador da Referência Capital

O rastreador registra visita, origem e anúncio, rolagem, cliques (mapa de calor), localização, formulário e lead.
É **um script só**, igual para todas as páginas. Não pesa na página: carrega em segundo plano (`async`).

```html
<script src="https://SEU-WORKER.SUA-CONTA.workers.dev/t.js" async></script>
```

---

## 1. Páginas WordPress e Lovable que já têm GTM (pelo Google Tag Manager)

1. Abra https://tagmanager.google.com e entre no contêiner das páginas da Referência.
2. **Tags → Nova**. Nome: `Rastreador Referência Capital`.
3. **Configuração da tag → HTML personalizado** e cole:
   ```html
   <script src="https://SEU-WORKER.SUA-CONTA.workers.dev/t.js" async></script>
   ```
4. **Acionamento → All Pages** (Todas as páginas). Se o contêiner tiver um acionador de "Inicialização" ou de "Consentimento", use **All Pages** mesmo.
5. **Salvar → Enviar → Publicar**. Nome da versão: `Rastreador Referência Capital`.
6. Se houver **mais de um contêiner** (um para o WordPress e outro para os simuladores Lovable), repita em cada um.

Páginas cobertas por esse passo: SEU-DOMINIO.com.br (todas as LPs de investimentos-estrangeiros, alavancagem-patrimonial etc.), simulador, simuladoramais, simuladorp, simuladorpremium, simuladorref, simuladorclt e as demais que já carregam o GTM.

## 2. SUBDOMINIO-1.SEU-DOMINIO.com.br e SUBDOMINIO-2.SEU-DOMINIO.com.br (Lovable, sem GTM)

No projeto de cada um no Lovable, peça no chat do Lovable:

> Adicione no `index.html`, dentro do `<head>`, exatamente esta linha:
> `<script src="https://SEU-WORKER.SUA-CONTA.workers.dev/t.js" async></script>`
> Não altere mais nada. Depois publique.

Ou edite o `index.html` direto e coloque a linha antes de `</head>`.

**Typebot:** se o formulário roda dentro do Typebot (iframe), o script não lê os campos. Nesse caso, no bloco final do fluxo (depois de coletar e-mail e telefone), adicione um bloco **Script** com:
```js
window.parent.rcTrack && window.parent.rcTrack.lead({ email: {{Email}}, phone: {{Telefone}}, name: {{Nome}} });
```
(troque `{{Email}}`, `{{Telefone}}`, `{{Nome}}` pelas variáveis do fluxo).

## 3. Páginas do e-book e outras fora do GTM

Mesma linha do passo 2, antes de `</head>`.

## Como conferir que funcionou

Abra a página, role até o fim e clique em algo. Em até 5 minutos a visita aparece no painel (aba Páginas).
Para checar na hora: F12 → aba **Rede (Network)** → filtre por `t/c` → deve aparecer uma chamada com status **204**.

---

## Dar acesso ao GTM para o Claude (opcional, para eu instalar e manter as tags sozinho)

O Claude não entra com login e senha. O acesso é por uma **conta de serviço** do Google:

1. Em https://console.cloud.google.com crie (ou use) um projeto, por exemplo `referencia-capital-painel`.
2. **APIs e serviços → Biblioteca → "Tag Manager API" → Ativar.**
3. **IAM e administrador → Contas de serviço → Criar conta de serviço**. Nome: `claude-gtm`. Não precisa de papel no projeto.
4. Abra a conta criada → **Chaves → Adicionar chave → JSON**. O arquivo baixa no seu computador.
5. Salve o arquivo em `D:\referencia-capital-meta\gtm-service-account.json` (fica só no seu PC, nunca no chat).
6. No GTM: **Administrador → Gerenciamento de usuários (da conta) → + → Adicionar usuário** com o e-mail da conta de serviço (termina em `@...iam.gserviceaccount.com`).
   Permissão da conta: **Usuário**. Permissão nos contêineres: **Publicar**.
7. Me avise. Eu leio os contêineres e mostro o que vou criar antes de publicar.
