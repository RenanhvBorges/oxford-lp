# Oxford — Landing page "Vença a barreira dos R$100k"

Landing page estática da Oxford (Growth para e-commerces), hospedada na Vercel. O objetivo da página é agendar a **sessão estratégica gratuita**.

| Arquivo | O que é |
|---|---|
| `index.html` | Página principal. CSS e JS inline, sem framework e sem build. |
| `obrigado.html` | Página pós-formulário, com botão para o WhatsApp (21) 96479-1690. Fica fora dos buscadores (`noindex`). |
| `privacidade.html` | Política de privacidade (LGPD) linkada no formulário. |
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

- **Tags:** `LP Sessão Estratégica` + `Lead qualificado` ou `Lead não qualificado`.
- **Campos personalizados** (crie em Contatos → Campos, com estas chaves, para aparecerem na ficha): `lp_dificuldade`, `lp_prioridade`, `lp_investimento`, `lp_qualificado`, `lp_origem`, `lp_data_envio`, `lp_pagina`, `lp_event_id`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, `gclid`, `gbraid`, `wbraid`, `ttclid`, `landing_page`, `referrer`.

**Lead qualificado** = marcou uma dificuldade real, quer resolver agora ou em até 3 meses, e prevê investir a partir de R$5.000/mês em marketing.

Se o CRM estiver fora do ar, o formulário mostra um botão de WhatsApp com as respostas já preenchidas, para o lead não se perder.

## Eventos no dataLayer (GTM-WV3CXKBR)

| Evento | Quando |
|---|---|
| `generate_lead` | Lead gravado no CRM. Traz `lead_qualificado` (true/false), as 3 respostas, `event_id` (deduplicação com a API de Conversões) e `user_data` (e-mail e telefone para conversões otimizadas). |
| `lp_form_start` / `lp_form_step` | Início do formulário e cada etapa (`form_step`). |
| `lp_form_error` | Falha no envio (o lead viu o botão de WhatsApp). |
| `lp_cta_click` | Clique em qualquer CTA (`cta_location`). |
| `lp_diag_select` | Clique em "Esse é o meu caso" na seção de diagnóstico. |
| `lp_proof_zoom` | Ampliação de um print de resultado. |
| `lp_thankyou_view` / `lp_whatsapp_click` | Visualização da página de obrigado e clique no WhatsApp. |

Para otimizar campanhas por lead qualificado, crie no GTM um acionador de `generate_lead` com `lead_qualificado = true`.
