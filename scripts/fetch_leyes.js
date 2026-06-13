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

  // Los enlaces son relativos (ej: /webpublica/opendata/iniciativas/ProyectosDeLey__XXXX.json)
  const patterns = [
    /href=["'](\/webpublica\/opendata\/iniciativas\/ProyectosDeLey__[^"']+\.json)["']/i,
    /href=["'](https:\/\/www\.congreso\.es\/webpublica\/opendata\/iniciativas\/ProyectosDeLey__[^"']+\.json)["']/i,
  ];
  const patternsProposiciones = [
    /href=["'](\/webpublica\/opendata\/iniciativas\/ProposicionesDeLey__[^"']+\.json)["']/i,
    /href=["'](https:\/\/www\.congreso\.es\/webpublica\/opendata\/iniciativas\/ProposicionesDeLey__[^"']+\.json)["']/i,
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

  const urls = [proyectosUrl, proposicionesUrl]
    .filter(Boolean)
    .map(u => u.startsWith('http') ? u : `https://www.congreso.es${u}`);

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

async function getExistingLawTopicsMap() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/topics?subtopic=eq.${encodeURIComponent(SUBTOPIC)}&select=id,title`, {
    headers: sbHeaders,
  });
  if (!res.ok) throw new Error(`Error obteniendo temas existentes: ${res.status}`);
  const rows = await res.json();
  const map = new Map();
  for (const row of rows) map.set(row.title, row.id);
  return map;
}

async function deleteTopic(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/topics?id=eq.${id}`, {
    method: 'DELETE',
    headers: sbHeaders,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Error borrando tema ${id}: ${err}`);
  }
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
  const objeto = iniciativa.OBJETO || iniciativa.Objeto || '';
  let title = objeto.trim().replace(/\s+/g, ' ');
  if (title.length > 180) title = title.slice(0, 177) + '...';
  return title;
}

function buildDescription(iniciativa) {
  const tipo = iniciativa.TIPO || iniciativa.Tipo || 'Iniciativa legislativa';
  const fecha = iniciativa.FECHACALIFICACION || iniciativa.FACHAPRESENTACION || '';
  const situacion = iniciativa.SITUACIONACTUAL || iniciativa.TRAMITACIONSEGUIDA || '';
  const autor = iniciativa.AUTOR || 'Congreso de los Diputados';

  let desc = `${tipo}.`;
  if (autor) desc += ` Presentada por: ${String(autor).replace(/\s+/g, ' ').trim()}.`;
  if (fecha) desc += ` Fecha: ${fecha}.`;
  if (situacion) desc += ` Estado: ${String(situacion).replace(/\s+/g, ' ').trim()}.`;
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

  // Cargar de una vez todos los temas de leyes ya existentes (id + título)
  console.log('→ Cargando temas de leyes existentes...');
  const existingMap = await getExistingLawTopicsMap();
  console.log(`  ${existingMap.size} temas de leyes ya en la base de datos`);

  let created = 0;
  let skipped = 0;
  let errors = 0;
  let deleted = 0;

  // Recopilamos todos los títulos que el Congreso reporta como vigentes
  // ahora mismo, para luego borrar los que ya no estén
  const currentTitles = new Set();

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

    for (const ini of iniciativas) {
      const title = buildTitle(ini);
      if (!title || title.length < 10) { skipped++; continue; }

      currentTitles.add(title);

      if (existingMap.has(title)) { skipped++; continue; }

      try {
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

  // ─── Borrar leyes que ya no están en tramitación ────────────
  console.log('\n→ Comprobando leyes que ya no están en tramitación...');
  for (const [title, id] of existingMap.entries()) {
    if (!currentTitles.has(title)) {
      try {
        await deleteTopic(id);
        deleted++;
        console.log(`  🗑 Borrado (ya no en tramitación): ${title.slice(0, 70)}...`);
      } catch (e) {
        errors++;
        console.error(`  ✗ Error borrando "${title.slice(0, 50)}":`, e.message);
      }
    }
  }

  console.log('\n══════════════════════════════════');
  console.log(`  Creados: ${created} | Omitidos (ya existían): ${skipped} | Borrados: ${deleted} | Errores: ${errors}`);
  console.log('══════════════════════════════════');
}

main().catch(e => {
  console.error('Error fatal:', e);
  process.exit(1);
});
