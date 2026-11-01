// Recebe o formulário da sessão estratégica, classifica o lead (MQL: qualificado ou não) e o
// grava no CRM da Oxford (POST /api/v1/contacts?upsert=email, que atualiza o contato se o
// e-mail já existir). A resposta devolve { ok, qualified }, que o front usa no dataLayer.
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
  faturamento: {
    '100kmais': 'R$100 mil ou mais',
    '70a100k': 'De R$70 mil a R$100 mil',
    '40a70k': 'De R$40 mil a R$70 mil',
    '20a40k': 'De R$20 mil a R$40 mil',
    ate20k: 'Menos de R$20 mil',
  },
};

// Regra de MQL (versão registrada em lp_regra_versao): dor + urgência + faturamento mínimo.
// Só entra o que o lead declara no formulário; UTM e origem não influenciam a classificação,
// para que a taxa de qualificados por campanha meça a qualidade do público que ela traz.
const REGRA_VERSAO = 'v2';
const URGENTES = ['agora', '3meses'];
const FATURAMENTO_QUALIFICA = ['40a70k', '70a100k', '100kmais']; // a partir de R$40 mil/mês

const TAG_ORIGEM = 'LP Sessão Estratégica';
const TAG_QUALIFICADO = 'Lead qualificado';
const TAG_NAO_QUALIFICADO = 'Lead não qualificado';

// O CRM guarda as tags do contato pelo nome, mas o menu Contatos → Tags e o seletor de
// gatilhos das automações leem o catálogo (tabela de tags). Por isso cada tag usada aqui
// também é registrada no catálogo, com a cor abaixo.
const TAG_COLORS = {
  [TAG_ORIGEM]: '#263fa3',
  [TAG_QUALIFICADO]: '#1f8f5a',
  [TAG_NAO_QUALIFICADO]: '#6b7599',
};
const knownTags = new Set(); // evita repetir o registro enquanto a instância está quente

const ATTRIBUTION_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'fbclid', 'gclid', 'gbraid', 'wbraid', 'ttclid', 'fbc', 'fbp', 'landing_page', 'referrer',
];

// Formato dos identificadores da Meta (cookies _fbc e _fbp): fb.<subdomínio>.<timestamp ms>.<valor>
const META_ID_RE = { fbc: /^fb\.\d\.\d{10,13}\.\S+$/, fbp: /^fb\.\d\.\d{10,13}\.\d+$/ };

// Site (com ou sem http, www ou caminho, ex.: instagram.com/sualoja) ou @ do Instagram
const STORE_HANDLE_RE = /^@[A-Za-z0-9._]{2,30}$/;
const STORE_DOMAIN_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?([/?#]\S*)?$/i;

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

  // As duas tags são excludentes: em um reenvio vale o último envio, então a outra sai
  // (remove_tags, suportado pelo upsert do CRM; num CRM antigo o campo é ignorado).
  const tags = [TAG_ORIGEM, lead.qualified ? TAG_QUALIFICADO : TAG_NAO_QUALIFICADO];
  const removeTags = [lead.qualified ? TAG_NAO_QUALIFICADO : TAG_QUALIFICADO];
  await ensureTagsInCatalog(crm, tags);

  let contact;
  try {
    contact = await crm('POST', '/api/v1/contacts?upsert=email', {
      name: lead.nome,
      email: lead.email,
      phone: lead.phone,
      tags,
      remove_tags: removeTags,
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

  return success(res, isHtmlForm, lead.qualified);
};

// Classifica o lead pelo que ele declarou. Devolve todos os critérios que falharam, não só o
// primeiro, para o CRM mostrar por que o tráfego de cada campanha não qualifica.
function qualify(answers) {
  const motivos = [];
  if (!answers.dificuldade || answers.dificuldade === 'nenhuma') motivos.push('sem_dor');
  if (!URGENTES.includes(answers.prioridade)) motivos.push('sem_urgencia');
  if (!FATURAMENTO_QUALIFICA.includes(answers.faturamento)) motivos.push('faturamento_baixo');
  return { qualified: motivos.length === 0, motivos };
}

function normalize(body) {
  const nome = clean(body.nome, 120);
  const email = clean(body.email, 160).toLowerCase();
  let phone = String(body.whatsapp || '').replace(/\D/g, '');
  if (phone.length > 11 && phone.startsWith('55')) phone = phone.slice(2);

  if (nome.length < 2) return { error: 'Informe o seu nome.' };
  if (!EMAIL_RE.test(email)) return { error: 'Informe um e-mail válido.' };
  if (phone.length !== 10 && phone.length !== 11) return { error: 'Informe o WhatsApp com DDD.' };
  const loja = clean(body.loja, 200);
  if (!STORE_HANDLE_RE.test(loja) && !STORE_DOMAIN_RE.test(loja)) {
    return { error: 'Informe o site ou o @ da sua loja.' };
  }

  const answers = {};
  for (const key of Object.keys(LABELS)) {
    const value = clean(body[key], 20);
    answers[key] = LABELS[key][value] ? value : '';
  }
  const { qualified, motivos } = qualify(answers);

  const attribution = body.attribution && typeof body.attribution === 'object' ? body.attribution : {};
  const customFields = {
    lp_dificuldade: LABELS.dificuldade[answers.dificuldade] || '',
    lp_prioridade: LABELS.prioridade[answers.prioridade] || '',
    lp_faturamento: LABELS.faturamento[answers.faturamento] || '',
    lp_site_loja: loja,
    lp_qualificado: qualified ? 'Sim' : 'Não',
    // "Nenhum" (e não vazio) porque campos vazios não são enviados, e o CRM mantém o valor
    // antigo no reenvio: sem isso, um lead que passou a qualificar ficaria com os motivos antigos.
    lp_motivos: qualified ? 'Nenhum' : motivos.join(', '),
    lp_regra_versao: REGRA_VERSAO,
    lp_origem: 'Landing page — Sessão estratégica',
    lp_data_envio: new Date().toISOString(),
    lp_pagina: clean(body.page, 300),
    lp_event_id: clean(body.event_id, 64),
  };
  for (const key of ATTRIBUTION_KEYS) customFields[key] = clean(attribution[key], 500);
  for (const key of Object.keys(META_ID_RE)) {
    if (!META_ID_RE[key].test(customFields[key])) customFields[key] = '';
  }
  for (const key of Object.keys(customFields)) if (!customFields[key]) delete customFields[key];

  return { nome, email, phone: '+55' + phone, qualified, customFields };
}

// Registra as tags no catálogo do CRM. Nome repetido (409) significa que já existe, então
// conta como sucesso. Qualquer outra falha só vai para o log: o lead nunca depende disso.
async function ensureTagsInCatalog(crm, tags) {
  await Promise.all(tags.filter((tag) => !knownTags.has(tag)).map(async (tag) => {
    try {
      await crm('POST', '/api/v1/tags', { name: tag, color: TAG_COLORS[tag] });
      knownTags.add(tag);
    } catch (err) {
      if (/→ 409/.test(err.message)) knownTags.add(tag);
      else console.error('[lead] tag não registrada no catálogo:', tag, err.message);
    }
  }));
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

function success(res, isHtmlForm, qualified) {
  return isHtmlForm ? redirect(res, '/obrigado') : send(res, 200, { ok: true, qualified });
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
