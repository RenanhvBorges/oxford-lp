// Recebe o formulário da sessão estratégica e grava o lead no CRM da Oxford
// (POST /api/v1/contacts?upsert=email, que atualiza o contato se o e-mail já existir).
//
// Variáveis de ambiente (Vercel → Settings → Environment Variables):
//   CRM_API_URL      URL base do CRM, sem barra no fim (ex.: https://crm.oxfordosd.com)
//   CRM_API_KEY      chave "oxk_..." gerada no CRM em Configurações → API
//   CRM_PIPELINE_ID  opcional: funil onde abrir um negócio para cada lead
//   CRM_STAGE_ID     opcional: estágio inicial desse negócio (obrigatório junto com o funil)

const LABELS = {
  dificuldade: {
    verba: 'Invisto em anúncios, mas as vendas não acompanham o aumento da verba',
    conversao: 'Tenho cliques e visitas, mas poucas compras',
    escala: 'Não sei quais campanhas ou produtos vale a pena escalar',
    recuperacao: 'Deixo carrinhos abandonados e visitantes interessados escaparem sem uma tentativa de recuperação',
    nenhuma: 'Nenhuma dessas situações está acontecendo comigo',
  },
  prioridade: {
    agora: 'Quero agir agora e estou buscando uma solução para começar',
    '3meses': 'Quero resolver nos próximos três meses',
    indefinido: 'Sei que preciso resolver, mas ainda não defini quando',
    conhecendo: 'Estou apenas conhecendo opções, sem intenção de mudar por enquanto',
  },
  investimento: {
    ate5k: 'Menos de R$5.000',
    '5a10k': 'De R$5.000 a R$9.999',
    '10a20k': 'De R$10.000 a R$19.999',
    '20kmais': 'R$20.000 ou mais',
    indefinido: 'Ainda não defini um orçamento',
  },
};

const TAG_ORIGEM = 'LP Sessão Estratégica';
const TAG_QUALIFICADO = 'Lead qualificado';
const TAG_NAO_QUALIFICADO = 'Lead não qualificado';

const ATTRIBUTION_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'fbclid', 'gclid', 'gbraid', 'wbraid', 'ttclid', 'landing_page', 'referrer',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CRM_TIMEOUT_MS = 8000;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, error: 'Método não permitido.' });
  }

  // Sem JavaScript, o formulário chega como x-www-form-urlencoded e a resposta é um redirecionamento
  const isHtmlForm = String(req.headers['content-type'] || '').includes('application/x-www-form-urlencoded');
  const body = parseBody(req.body);

  // Honeypot preenchido = robô. Responde como sucesso para não dar pista.
  if (body.website) return success(res, isHtmlForm);

  const lead = normalize(body);
  if (lead.error) {
    return isHtmlForm ? redirect(res, '/#sessao') : send(res, 422, { ok: false, error: lead.error });
  }

  const { CRM_API_URL, CRM_API_KEY, CRM_PIPELINE_ID, CRM_STAGE_ID } = process.env;
  if (!CRM_API_URL || !CRM_API_KEY) {
    console.error('[lead] CRM_API_URL ou CRM_API_KEY não configurados.');
    return failure(res, isHtmlForm, 503);
  }
  const crm = crmClient(CRM_API_URL.replace(/\/+$/, ''), CRM_API_KEY);

  let contact;
  try {
    contact = await crm('POST', '/api/v1/contacts?upsert=email', {
      name: lead.nome,
      email: lead.email,
      phone: lead.phone,
      tags: [TAG_ORIGEM, lead.qualified ? TAG_QUALIFICADO : TAG_NAO_QUALIFICADO],
      custom_fields: lead.customFields,
    });
  } catch (err) {
    console.error('[lead] falha ao gravar o contato no CRM:', err.message);
    return failure(res, isHtmlForm, 502);
  }

  // O negócio é um extra: se falhar, o contato já está salvo e o lead não se perde
  if (CRM_PIPELINE_ID && CRM_STAGE_ID && contact && contact.id) {
    try {
      await openDealIfNeeded(crm, contact.id, lead, CRM_PIPELINE_ID, CRM_STAGE_ID);
    } catch (err) {
      console.error('[lead] contato salvo, mas o negócio não foi criado:', err.message);
    }
  }

  return success(res, isHtmlForm);
};

function normalize(body) {
  const nome = clean(body.nome, 120);
  const email = clean(body.email, 160).toLowerCase();
  let phone = String(body.whatsapp || '').replace(/\D/g, '');
  if (phone.length > 11 && phone.startsWith('55')) phone = phone.slice(2);

  if (nome.length < 2) return { error: 'Informe o seu nome.' };
  if (!EMAIL_RE.test(email)) return { error: 'Informe um e-mail válido.' };
  if (phone.length !== 10 && phone.length !== 11) return { error: 'Informe o WhatsApp com DDD.' };

  const answers = {};
  for (const key of Object.keys(LABELS)) {
    const value = clean(body[key], 20);
    answers[key] = LABELS[key][value] ? value : '';
  }
  // Mesma regra do front: quem tem dor, urgência e verba a partir de R$5 mil
  const qualified = answers.dificuldade !== '' && answers.dificuldade !== 'nenhuma'
    && ['agora', '3meses'].includes(answers.prioridade)
    && ['5a10k', '10a20k', '20kmais'].includes(answers.investimento);

  const attribution = body.attribution && typeof body.attribution === 'object' ? body.attribution : {};
  const customFields = {
    lp_dificuldade: LABELS.dificuldade[answers.dificuldade] || '',
    lp_prioridade: LABELS.prioridade[answers.prioridade] || '',
    lp_investimento: LABELS.investimento[answers.investimento] || '',
    lp_qualificado: qualified ? 'Sim' : 'Não',
    lp_origem: 'Landing page — Sessão estratégica',
    lp_data_envio: new Date().toISOString(),
    lp_pagina: clean(body.page, 300),
    lp_event_id: clean(body.event_id, 64),
  };
  for (const key of ATTRIBUTION_KEYS) customFields[key] = clean(attribution[key], 500);
  for (const key of Object.keys(customFields)) if (!customFields[key]) delete customFields[key];

  return { nome, email, phone: '+55' + phone, qualified, customFields };
}

async function openDealIfNeeded(crm, contactId, lead, pipelineId, stageId) {
  const query = new URLSearchParams({ contact_id: contactId, pipeline_id: pipelineId, status: 'open', limit: '1' });
  const existing = await crm('GET', `/api/v1/deals?${query}`);
  if (Array.isArray(existing) && existing.length) return;
  await crm('POST', '/api/v1/deals', {
    title: `Sessão estratégica — ${lead.nome}`,
    pipeline_id: pipelineId,
    stage_id: stageId,
    contact_id: contactId,
  });
}

function crmClient(baseUrl, apiKey) {
  return async function crm(method, path, payload) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CRM_TIMEOUT_MS);
    try {
      const res = await fetch(baseUrl + path, {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: payload ? JSON.stringify(payload) : undefined,
        signal: ctrl.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} → ${res.status} ${json.error || ''}`.trim());
      return json.data;
    } finally {
      clearTimeout(timer);
    }
  };
}

function parseBody(raw) {
  if (!raw) return {};
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (e) { return Object.fromEntries(new URLSearchParams(raw)); }
  }
  return typeof raw === 'object' ? raw : {};
}

function clean(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function success(res, isHtmlForm) {
  return isHtmlForm ? redirect(res, '/obrigado') : send(res, 200, { ok: true });
}

function failure(res, isHtmlForm, status) {
  // Sem JS, manda direto para o WhatsApp para o lead não se perder
  return isHtmlForm
    ? redirect(res, 'https://wa.me/5521964791690')
    : send(res, status, { ok: false, error: 'Não foi possível registrar agora.' });
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  res.statusCode = 303;
  res.setHeader('Location', location);
  res.end();
}
