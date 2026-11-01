# Oxford — Landing page "Vença a barreira dos R$100k"

Landing page estática da Oxford (Growth para e-commerces), hospedada na Vercel. O objetivo da página é agendar a **sessão estratégica gratuita**.

| Arquivo | O que é |
|---|---|
| `index.html` | Página principal. CSS e JS inline, sem framework e sem build. |
| `obrigado.html` | Página pós-formulário, com botão para o WhatsApp (21) 96479-1690. Fica fora dos buscadores (`noindex`). |
| `privacidade.html` | Política de privacidade (LGPD) linkada no formulário. |
| `content/blog/*.md` | Artigos do blog em Markdown (fonte). `_modelo.md` mostra o front matter. Imagens em `content/blog/img/`. |
| `scripts/build-blog.js`, `scripts/blog.css` | Geram `blog/` (listagem, posts, `feed.xml`) e regeneram `sitemap.xml`. Rodam no deploy da Vercel (`npm run build`). `blog/` não é versionado. |
| `api/lead.js` | Função da Vercel que grava o lead no CRM da Oxford. |
| `img/` | Imagens em webp, ícones e imagem de compartilhamento (`og-oxford.jpg`). |
| `llms.txt`, `robots.txt`, `sitemap.xml` | SEO e GEO (buscadores e assistentes de IA). |

## Integração com o CRM

O formulário envia para `/api/lead`, que faz `POST /api/v1/contacts?upsert=email` no CRM. Se o e-mail já existir, o contato é atualizado em vez de duplicado.

Configure na Vercel (Settings → Environment Variables):

| Variável | Obrigatória | Valor |
|---|---|---|
| `CRM_API_URL` | sim | URL do CRM, sem barra no fim |
| `CRM_API_KEY` | sim | chave `oxk_...` criada no CRM em Configurações → API |
| `CRM_PIPELINE_ID` | não | funil onde abrir um negócio para cada lead |
| `CRM_STAGE_ID` | não | estágio inicial desse negócio |

O que chega no CRM:

- **Tags:** `LP Sessão Estratégica` + `Lead qualificado` ou `Lead não qualificado`. As duas últimas são excludentes: a cada envio vale o resultado mais recente e a outra tag é removida (`remove_tags` do upsert do CRM).
- **Campos personalizados** (crie em Contatos → Campos, com estas chaves, para aparecerem na ficha): `lp_dificuldade`, `lp_prioridade`, `lp_faturamento`, `lp_site_loja`, `lp_qualificado`, `lp_motivos`, `lp_regra_versao`, `lp_origem`, `lp_data_envio`, `lp_pagina`, `lp_event_id`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, `gclid`, `gbraid`, `wbraid`, `ttclid`, `fbc`, `fbp`, `landing_page`, `referrer`.
- **Identificadores para conversões offline:** `gclid`/`gbraid`/`wbraid` (Google Ads), `fbc` e `fbp` (Meta, lidos dos cookies `_fbc` e `_fbp` do pixel; sem `_fbc`, o `fbc` é montado a partir do `fbclid` e do momento do clique) e `lp_event_id`, o mesmo `event_id` do `generate_lead` no dataLayer.

**Lead qualificado (MQL)**, regra `v2`, avaliada em `api/lead.js` (único lugar; o front só usa o `qualified` devolvido pela API):

| Critério | Qualifica quando | Motivo se falhar |
|---|---|---|
| Dor | Marcou uma dificuldade (qualquer uma, menos "nenhuma dessas") | `sem_dor` |
| Urgência | Quer agir agora ou resolver em até 3 meses | `sem_urgencia` |
| Faturamento | A loja fatura R$40.000/mês ou mais | `faturamento_baixo` |

Só conta o que o lead declara: UTM e origem do tráfego não entram, para a taxa de qualificados por campanha medir a qualidade do público. Todos os critérios que falharam vão para `lp_motivos` (ex.: `sem_urgencia, faturamento_baixo`; `Nenhum` para quem qualifica). `lp_regra_versao` identifica a regra vigente quando ela mudar, para não misturar séries nos relatórios. O site ou @ da loja é obrigatório (é como se confirma que a loja existe) e é validado no front e no servidor. O SQL (SDR confirma que o lead está apto a comprar) é registrado por mudança de estágio no funil do CRM, não por este formulário.

Se o CRM estiver fora do ar, o formulário mostra um botão de WhatsApp com as respostas já preenchidas, para o lead não se perder.

## Eventos no dataLayer (GTM-WV3CXKBR)

| Evento | Quando |
|---|---|
| `generate_lead` | Lead gravado no CRM. Traz `lead_qualificado` (true/false, vindo da API), as 3 respostas (`lp_dificuldade`, `lp_prioridade`, `lp_faturamento`), `event_id` (deduplicação com a API de Conversões) e `user_data` (e-mail e telefone para conversões otimizadas). |
| `lp_form_start` / `lp_form_step` | Início do formulário e cada etapa (`form_step`). |
| `lp_form_error` | Falha no envio (o lead viu o botão de WhatsApp). |
| `lp_cta_click` | Clique em qualquer CTA (`cta_location`). |
| `lp_diag_select` | Clique em "Esse é o meu caso" na seção de diagnóstico. |
| `lp_proof_zoom` | Ampliação de um print de resultado. |
| `lp_thankyou_view` / `lp_whatsapp_click` | Visualização da página de obrigado e clique no WhatsApp. |

Para otimizar campanhas por lead qualificado, crie no GTM um acionador de `generate_lead` com `lead_qualificado = true`.
