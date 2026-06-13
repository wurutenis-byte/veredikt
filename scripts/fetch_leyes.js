// scripts/fetch_leyes.js
// ════════════════════════════════════════════════════════════
//  VEREDIKT — Importador automático de leyes en tramitación
//  Congreso de los Diputados (datos abiertos, gratis, sin API key)
//
//  Se ejecuta automáticamente vía GitHub Actions (ver
//  .github/workflows/fetch_leyes.yml)
// ════════════════════════════════════════════════════════════

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // service_role, no anon

const OPENDATA_PAGE = 'https://www.congreso.es/es/opendata/iniciativas';

// Categoría destino: "Política" (debe existir en tu tabla categories)
const CATEGORY_NAME = 'Política';
const SUBTOPIC = 'Leyes en tramitación · Congreso';

// ─── 1. Obtener la URL actual del JSON de Proyectos de Ley ────
async function getCurrentJsonUrl() {
  const res = await fetch(OPENDATA_PAGE, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9',
    },
  });
  if (!res.ok) {
    throw new Error(`La página de opendata respondió ${res.status}`);
  }
  const html = await res.text();
  console.log(`  (Página descargada: ${html.length} caracteres)`);

  // Probar varios patrones, ya que el HTML puede usar comillas simples/dobles
  // o estar en distintas líneas
  const patterns = [
    /href=["'](https:\/\/www\.congreso\.es\/webpublica\/opendata\/iniciativas\/ProyectosDeLey__[^"']+\.json)["']/i,
    /(https:\/\/www\.congreso\.es\/webpublica\/opendata\/iniciativas\/ProyectosDeLey__\d+\.json)/i,
  ];
  const patternsProposiciones = [
    /href=["'](https:\/\/www\.congreso\.es\/webpublica\/opendata\/iniciativas\/ProposicionesDeLey__[^"']+\.json)["']/i,
    /(https:\/\/www\.congreso\.es\/webpublica\/opendata\/iniciativas\/ProposicionesDeLey__\d+\.json)/i,
  ];

  let proyectosUrl = null;
  for (const p of patterns) {
    const m = html.match(p);
    if (m) { proyectosUrl = m[1]; break; }
  }

  let proposicionesUrl = null;
  for (const p of patternsProposiciones) {
    const m = html.match(p);
    if (m) { proposicionesUrl = m[1]; break; }
  }

  const urls = [proyectosUrl, proposicionesUrl].filter(Boolean);

  if (urls.length === 0) {
    // Diagnóstico: mostrar si la palabra "ProyectosDeLey" aparece en absoluto
    const hasProyectos = html.includes('ProyectosDeLey');
    const hasOpendata = html.includes('opendata');
    console.log(`  Diagnóstico: contiene "ProyectosDeLey"=${hasProyectos}, contiene "opendata"=${hasOpendata}`);
    // Mostrar un fragmento alrededor de "ProyectosDeLey" si existe
    if (hasProyectos) {
      const idx = html.indexOf('ProyectosDeLey');
      console.log('  Fragmento:', html.slice(Math.max(0, idx - 100), idx + 200));
    }
    throw new Error('No se encontraron enlaces JSON en la página de opendata del Congreso');
  }
  return urls;
}

// ─── 2. Descargar y parsear el JSON de iniciativas ─────────────
async function fetchIniciativas(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Error descargando ${url}: ${res.status}`);
  const text = await res.text();

  // El JSON del Congreso puede venir con BOM o encoding latin1; normalizar
  const cleaned = text.replace(/^\uFEFF/, '');
  const data = JSON.parse(cleaned);

  // La estructura típica es { iniciativas: [...] } o un array directo
  return Array.isArray(data) ? data : (data.iniciativas || data.Iniciativas || []);
}

// ─── 3. Supabase REST helpers (usando service_role para bypassear RLS) ─
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

// ─── 4. Limpieza y formato del título ──────────────────────────
function buildTitle(iniciativa) {
  // Campos típicos: "Tipo", "Objeto", "Titulo", "TituloCorto", "Tipotram"
  const objeto = iniciativa.Objeto || iniciativa.Titulo || iniciativa.objeto || '';
  // Limitar longitud y limpiar espacios
  let title = objeto.trim().replace(/\s+/g, ' ');
  if (title.length > 180) title = title.slice(0, 177) + '...';
  return title;
}

function buildDescription(iniciativa) {
  const tipo = iniciativa.Tipo || iniciativa.tipo || 'Iniciativa legislativa';
  const fecha = iniciativa.FechaCalificacion || iniciativa.Fecha || iniciativa.FechaPresentacion || '';
  const situacion = iniciativa.Situacion || iniciativa.SituacionActual || iniciativa.Tramitacion || '';
  const autor = iniciativa.Autor || iniciativa.AutorTexto || 'Congreso de los Diputados';

  let desc = `${tipo}.`;
  if (autor) desc += ` Presentada por: ${autor}.`;
  if (fecha) desc += ` Fecha: ${fecha}.`;
  if (situacion) desc += ` Estado: ${situacion}.`;
  desc += ' ¿Apoyas esta iniciativa legislativa?';
  return desc;
}

// ─── MAIN ───────────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en variables de entorno');
    process.exit(1);
  }

  console.log('→ Obteniendo URLs actuales de datos abiertos del Congreso...');
  let jsonUrls;
  try {
    jsonUrls = await getCurrentJsonUrl();
  } catch (e) {
    console.error('Error obteniendo URLs (la web del Congreso puede haber cambiado su estructura):', e.message);
    console.log('Finalizando sin crear temas esta vez.');
    return;
  }
  console.log(`  Encontradas ${jsonUrls.length} fuentes:`, jsonUrls);

  const categoryId = await getCategoryId(CATEGORY_NAME);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const url of jsonUrls) {
    console.log(`\n→ Procesando ${url}`);
    let iniciativas;
    try {
      iniciativas = await fetchIniciativas(url);
    } catch (e) {
      console.error('  Error descargando/parseando:', e.message);
      errors++;
      continue;
    }

    console.log(`  ${iniciativas.length} iniciativas encontradas`);

    // Solo procesar las más recientes (últimas 20 por fuente) para no saturar
    const recientes = iniciativas.slice(0, 20);

    for (const ini of recientes) {
      const title = buildTitle(ini);
      if (!title || title.length < 10) { skipped++; continue; }

      try {
        const exists = await topicExists(title);
        if (exists) { skipped++; continue; }

        await createTopic({
          title,
          description: buildDescription(ini),
          categoryId,
          subtopic: SUBTOPIC,
        });
        created++;
        console.log(`  ✓ Creado: ${title.slice(0, 70)}...`);
      } catch (e) {
        errors++;
        console.error(`  ✗ Error con "${title.slice(0, 50)}":`, e.message);
      }
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
