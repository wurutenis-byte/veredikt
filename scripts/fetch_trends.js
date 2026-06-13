// scripts/fetch_trends.js
// ════════════════════════════════════════════════════════════
//  VEREDIKT — Importador automático de temas de actualidad
//  Fuente: RSS de portadas de medios españoles (gratis, estable)
//
//  Se ejecuta automáticamente vía GitHub Actions (ver
//  .github/workflows/fetch_trends.yml)
// ════════════════════════════════════════════════════════════

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Categoría destino: "Curiosidades" (debe existir en tu tabla categories)
const CATEGORY_NAME = 'Curiosidades';
const SUBTOPIC = 'Actualidad del día · España';

// Fuentes RSS de portada (gratis, sin clave, sin registro)
const RSS_FEEDS = [
  { name: 'RTVE',      url: 'https://www.rtve.es/api/temas_noticias-portada.rss' },
  { name: 'elDiario',  url: 'https://www.eldiario.es/rss/' },
  { name: '20minutos', url: 'https://www.20minutos.es/rss/' },
];

const MAX_TEMAS = 20;

// ─── 1. Descargar y parsear un feed RSS (XML simple, sin librerías) ─
async function fetchRssItems(feed) {
  const res = await fetch(feed.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
  });
  if (!res.ok) throw new Error(`${feed.name} respondió ${res.status}`);

  const xml = await res.text();

  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/g) || [];

  return itemBlocks.map(block => {
    const title = extractTag(block, 'title');
    const description = extractTag(block, 'description');
    const link = extractTag(block, 'link');
    return { title: cleanText(title), description: cleanText(description), link, source: feed.name };
  }).filter(item => item.title);
}

function extractTag(xml, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const m = xml.match(regex);
  if (!m) return '';
  let content = m[1];
  content = content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1');
  return content.trim();
}

function cleanText(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ')
    .replace(/&Aacute;/g, 'Á').replace(/&Eacute;/g, 'É').replace(/&Iacute;/g, 'Í')
    .replace(/&Oacute;/g, 'Ó').replace(/&Uacute;/g, 'Ú').replace(/&Ntilde;/g, 'Ñ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── 2. Supabase REST helpers ──────────────────────────────────
const sbHeaders = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_SERVICE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Prefer': 'return=representation',
};

async function getCategoryId(name) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/categories?name=eq.${encodeURIComponent(name)}&select=id`, {
    headers: sbHeaders,
  });
  const data = await res.json();
  if (!data.length) throw new Error(`Categoría "${name}" no encontrada en Supabase`);
  return data[0].id;
}

async function topicExists(title) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/topics?title=eq.${encodeURIComponent(title)}&select=id`, {
    headers: sbHeaders,
  });
  const data = await res.json();
  return data.length > 0;
}

async function createTopic({ title, description, categoryId, subtopic }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/topics`, {
    method: 'POST',
    headers: sbHeaders,
    body: JSON.stringify({
      title,
      description,
      category_id: categoryId,
      subtopic,
      status: 'published',
      author_id: null,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Error creando tema "${title}": ${err}`);
  }
  return res.json();
}

// ─── 3. Construir título y descripción ─────────────────────────
function buildTitle(item) {
  let title = item.title.trim();
  if (title.length > 170) title = title.slice(0, 167) + '...';
  return `${title} — ¿qué opinas?`;
}

function buildDescription(item) {
  let desc = item.description || 'Noticia de actualidad.';
  if (desc.length > 300) desc = desc.slice(0, 297) + '...';
  desc += ` (Fuente: ${item.source})`;
  if (item.link) desc += ` Más info: ${item.link}`;
  desc += ' ¿Te parece relevante? Vota, valora y comenta.';
  return desc;
}

// ─── MAIN ───────────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en variables de entorno');
    process.exit(1);
  }

  console.log('→ Obteniendo noticias de actualidad de medios españoles...');

  let allItems = [];
  for (const feed of RSS_FEEDS) {
    try {
      const items = await fetchRssItems(feed);
      console.log(`  ${feed.name}: ${items.length} noticias`);
      allItems.push(...items);
    } catch (e) {
      console.error(`  ${feed.name}: error -`, e.message);
    }
  }

  if (!allItems.length) {
    console.log('No se obtuvieron noticias de ninguna fuente. Finalizando sin crear temas.');
    return;
  }

  const seen = new Set();
  allItems = allItems.filter(item => {
    const key = item.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`  Total noticias únicas: ${allItems.length}`);

  const categoryId = await getCategoryId(CATEGORY_NAME);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  const top = allItems.slice(0, MAX_TEMAS);

  for (const item of top) {
    const title = buildTitle(item);
    if (title.length < 15) { skipped++; continue; }

    try {
      const exists = await topicExists(title);
      if (exists) { skipped++; continue; }

      await createTopic({
        title,
        description: buildDescription(item),
        categoryId,
        subtopic: SUBTOPIC,
      });
      created++;
      console.log(`  ✓ Creado: ${title.slice(0, 80)}`);
    } catch (e) {
      errors++;
      console.error(`  ✗ Error con "${title.slice(0, 50)}":`, e.message);
    }
  }

  console.log('\n══════════════════════════════════');
  console.log(`  Creados: ${created} | Omitidos (ya existían): ${skipped} | Errores: ${errors}`);
  console.log('══════════════════════════════════');
}

main().catch(e => {
  console.error('Error fatal:', e);
  process.exit(1);
});
