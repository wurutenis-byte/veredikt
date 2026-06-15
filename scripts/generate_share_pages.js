// scripts/generate_share_pages.js
// ════════════════════════════════════════════════════════════
//  VEREDIKT — Generador de páginas estáticas para compartir
//
//  Genera un archivo t/<id>.html por cada tema publicado, con
//  meta tags Open Graph/Twitter correctos (título y descripción
//  reales del tema). Estas páginas son las que se comparten en
//  redes sociales; al abrirlas en un navegador normal, redirigen
//  automáticamente a la app con el tema abierto.
//
//  Se ejecuta vía GitHub Actions (ver
//  .github/workflows/generate_share_pages.yml)
// ════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const SITE_URL = 'https://wurutenis-byte.github.io/veredikt';
const OUTPUT_DIR = path.join(__dirname, '..', 't');

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtml(topic) {
  const title = escapeHtml(topic.title);
  let description = (topic.description || 'Vota, valora y comenta este tema en Veredikt.').trim();
  if (description.length > 200) description = description.slice(0, 197) + '...';
  description = escapeHtml(description);

  const topicUrl = `${SITE_URL}/?tema=${topic.id}`;
  const shareUrl = `${SITE_URL}/t/${topic.id}.html`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Veredikt</title>
  <meta name="description" content="${description}">

  <!-- Open Graph -->
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${shareUrl}">
  <meta property="og:locale" content="es_ES">
  <meta property="og:site_name" content="Veredikt">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">

  <!-- Redirección a la app para visitantes humanos -->
  <link rel="canonical" href="${topicUrl}">
  <meta http-equiv="refresh" content="0; url=${topicUrl}">
  <script>window.location.replace(${JSON.stringify(topicUrl)});</script>

  <style>
    body {
      background: #0d0d0f; color: #e8e8f0;
      font-family: -apple-system, sans-serif;
      display: flex; align-items: center; justify-content: center;
      height: 100vh; margin: 0; text-align: center; padding: 2rem;
    }
    a { color: #7c5cfc; }
  </style>
</head>
<body>
  <div>
    <p>Redirigiendo a Veredikt…</p>
    <p><a href="${topicUrl}">Haz clic aquí si no eres redirigido automáticamente</a></p>
  </div>
</body>
</html>
`;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Faltan SUPABASE_URL o SUPABASE_ANON_KEY en variables de entorno');
    process.exit(1);
  }

  console.log('→ Obteniendo temas publicados...');

  // Paginar para traer todos los temas (PostgREST limita por defecto)
  let allTopics = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/topics?status=eq.published&select=id,title,description`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Range': `${from}-${from + pageSize - 1}`,
        },
      }
    );
    if (!res.ok) throw new Error(`Error ${res.status} obteniendo temas`);
    const batch = await res.json();
    allTopics.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  console.log(`  ${allTopics.length} temas publicados encontrados`);

  // Limpiar y recrear la carpeta de salida
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let generated = 0;
  for (const topic of allTopics) {
    const html = buildHtml(topic);
    const filePath = path.join(OUTPUT_DIR, `${topic.id}.html`);
    fs.writeFileSync(filePath, html, 'utf-8');
    generated++;
  }

  console.log(`✓ Generadas ${generated} páginas en /t/`);
}

main().catch(e => {
  console.error('Error fatal:', e);
  process.exit(1);
});
