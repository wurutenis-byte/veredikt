// scripts/fetch_trends.js
// ════════════════════════════════════════════════════════════
//  VEREDIKT — Importador automático de temas tendencia
//  Fuente: Google Trends España (endpoint no-oficial, gratis)
//
//  Se ejecuta automáticamente vía GitHub Actions (ver
//  .github/workflows/fetch_trends.yml)
//
//  ⚠️ Este endpoint es no-oficial y puede cambiar sin aviso.
//  Si deja de funcionar, el workflow seguirá ejecutándose sin
//  crear temas nuevos (falla de forma silenciosa y registra el error).
// ════════════════════════════════════════════════════════════

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Categoría destino: "Curiosidades" (debe existir en tu tabla categories)
const CATEGORY_NAME = 'Curiosidades';
const SUBTOPIC = 'Tendencias del día · España';

const TRENDS_URL = 'https://trends.google.com/trends/api/dailytrends?hl=es-ES&tz=-60&geo=ES&ns=15';

// ─── 1. Obtener tendencias diarias de Google Trends España ────
async function fetchTrends() {
  const res = await fetch(TRENDS_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });
  if (!res.ok) throw new Error(`Google Trends respondió ${res.status}`);

  let text = await res.text();
  // Google Trends antepone ")]}'" para evitar JSON hijacking — hay que quitarlo
  text = text.replace(/^\)\]\}'[\r\n]*/, '');

  const data = JSON.parse(text);
  const days = data?.default?.trendingSearchesDays || [];
  if (!days.length) return [];

  // Tomar el día más reciente
  const searches = days[0].trendingSearches || [];

  return searches.map(s => ({
    title: s.title?.query || '',
    articles: s.articles || [],
    formattedTraffic: s.formattedTraffic || '',
  })).filter(s => s.title);
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
function buildTitle(trend) {
  let title = trend.title.trim();
  // Evitar títulos demasiado cortos o genéricos
  if (title.length > 150) title = title.slice(0, 147) + '...';
  return `${title}: ¿qué opinas?`;
}

function buildDescription(trend) {
  let desc = 'Tema en tendencia hoy en España.';
  if (trend.formattedTraffic) desc += ` Volumen de búsquedas: ${trend.formattedTraffic}.`;
  if (trend.articles?.length) {
    const article = trend.articles[0];
    if (article.title) desc += ` Relacionado con: "${article.title}".`;
  }
  desc += ' ¿Te parece relevante? Vota, valora y comenta.';
  return desc;
}

// ─── MAIN ───────────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en variables de entorno');
    process.exit(1);
  }

  console.log('→ Obteniendo tendencias de Google Trends España...');

  let trends;
  try {
    trends = await fetchTrends();
  } catch (e) {
    // No fallar el workflow entero si Google cambia el endpoint
    console.error('Error obteniendo tendencias (el endpoint no-oficial puede haber cambiado):', e.message);
    console.log('Finalizando sin crear temas esta vez.');
    return;
  }

  console.log(`  ${trends.length} tendencias encontradas`);

  if (!trends.length) {
    console.log('No hay tendencias disponibles hoy.');
    return;
  }

  const categoryId = await getCategoryId(CATEGORY_NAME);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  // Top 20 tendencias
  const top20 = trends.slice(0, 20);

  for (const trend of top20) {
    const title = buildTitle(trend);

    try {
      const exists = await topicExists(title);
      if (exists) { skipped++; continue; }

      await createTopic({
        title,
        description: buildDescription(trend),
        categoryId,
        subtopic: SUBTOPIC,
      });
      created++;
      console.log(`  ✓ Creado: ${title}`);
    } catch (e) {
      errors++;
      console.error(`  ✗ Error con "${title}":`, e.message);
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
