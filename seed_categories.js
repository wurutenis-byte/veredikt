// seed_categories.js
// Inserta las categorías iniciales en PocketBase
// Uso: node seed_categories.js
// Requiere: PocketBase corriendo en http://127.0.0.1:8090
//           y haber creado cuenta admin

const PB_URL   = 'http://127.0.0.1:8090';
const ADMIN_EMAIL    = process.env.PB_ADMIN_EMAIL    || 'admin@veredikt.com';
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || 'TU_PASSWORD_ADMIN';

const CATEGORIES = [
  { name: 'Política',        icon: '🏛️',  order: 1 },
  { name: 'Sociedad',        icon: '👥',  order: 2 },
  { name: 'Cultura',         icon: '🎭',  order: 3 },
  { name: 'Cine y series',   icon: '🎬',  order: 4 },
  { name: 'Música',          icon: '🎵',  order: 5 },
  { name: 'Deporte',         icon: '⚽',  order: 6 },
  { name: 'Tecnología',      icon: '💻',  order: 7 },
  { name: 'Gastronomía',     icon: '🍽️',  order: 8 },
  { name: 'Ciencia',         icon: '🔬',  order: 9 },
  { name: 'Historia',        icon: '📜',  order: 10 },
  { name: 'Economía',        icon: '📈',  order: 11 },
  { name: 'Naturaleza',      icon: '🌿',  order: 12 },
  { name: 'Videojuegos',     icon: '🎮',  order: 13 },
  { name: 'Viajes',          icon: '✈️',  order: 14 },
  { name: 'Moda y estilo',   icon: '👗',  order: 15 },
  { name: 'Educación',       icon: '📚',  order: 16 },
  { name: 'Salud',           icon: '🏥',  order: 17 },
  { name: 'Arte',            icon: '🎨',  order: 18 },
  { name: 'Filosofía',       icon: '🤔',  order: 19 },
  { name: 'España',          icon: '🇪🇸',  order: 20 },
  { name: 'Curiosidades',    icon: '🤓',  order: 21 },
  { name: 'Debates clásicos',icon: '⚔️',  order: 22 },
];

// Temas de ejemplo para arrancar la plataforma
const SEED_TOPICS = [
  {
    title: 'La tortilla de patatas ¿con o sin cebolla?',
    description: 'El debate más antiguo y encendido de la gastronomía española. Cada familia tiene su bando.',
    category_name: 'Gastronomía',
    subtopic: 'Debates clásicos · España',
    status: 'published',
  },
  {
    title: 'Semana de trabajo de 4 días',
    description: '¿Debería implantarse la semana laboral de 4 días como estándar en España?',
    category_name: 'Sociedad',
    subtopic: 'Trabajo y economía',
    status: 'published',
  },
  {
    title: 'Breaking Bad vs The Wire',
    description: '¿Cuál es la mejor serie de televisión de todos los tiempos?',
    category_name: 'Cine y series',
    subtopic: 'Drama · Series de culto',
    status: 'published',
  },
  {
    title: 'La Inteligencia Artificial como herramienta educativa',
    description: '¿El uso de IA en el aula es positivo para el aprendizaje de los estudiantes?',
    category_name: 'Tecnología',
    subtopic: 'Educación · IA',
    status: 'published',
  },
  {
    title: 'Real Madrid vs FC Barcelona: ¿quién ha sido más grande históricamente?',
    description: 'No el mejor ahora mismo, sino en el conjunto de su historia.',
    category_name: 'Deporte',
    subtopic: 'Fútbol · LaLiga',
    status: 'published',
  },
  {
    title: 'El cambio climático, ¿la mayor amenaza del siglo XXI?',
    description: 'En términos de impacto global a largo plazo, ¿supera al resto de problemas actuales?',
    category_name: 'Ciencia',
    subtopic: 'Medioambiente · Política global',
    status: 'published',
  },
  {
    title: 'Vivir en ciudad grande vs pueblo pequeño',
    description: '¿Qué modo de vida es preferible en términos de calidad y bienestar?',
    category_name: 'Sociedad',
    subtopic: 'Estilo de vida',
    status: 'published',
  },
  {
    title: 'Beethoven vs Mozart: ¿quién fue el mayor genio de la música clásica?',
    description: 'El duelo eterno entre los dos compositores más influyentes de la historia.',
    category_name: 'Música',
    subtopic: 'Música clásica',
    status: 'published',
  },
];

async function main() {
  console.log('\n⚖️  Veredikt — Seed inicial\n');

  // 1. Autenticarse como admin
  console.log('→ Autenticando como admin...');
  const authRes = await fetch(`${PB_URL}/api/admins/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!authRes.ok) {
    const err = await authRes.json();
    console.error('Error auth:', err.message);
    console.log('\n⚠️  Edita ADMIN_EMAIL y ADMIN_PASSWORD en este archivo o usa variables de entorno:');
    console.log('   PB_ADMIN_EMAIL=tu@email.com PB_ADMIN_PASSWORD=tupass node seed_categories.js\n');
    process.exit(1);
  }
  const { token } = await authRes.json();
  const headers = { 'Content-Type': 'application/json', Authorization: token };
  console.log('✓ Autenticado\n');

  // 2. Insertar categorías
  console.log('→ Insertando categorías...');
  const catMap = {};
  for (const cat of CATEGORIES) {
    try {
      const res = await fetch(`${PB_URL}/api/collections/categories/records`, {
        method: 'POST', headers,
        body: JSON.stringify(cat),
      });
      const data = await res.json();
      catMap[cat.name] = data.id;
      console.log(`  ✓ ${cat.icon} ${cat.name}`);
    } catch (e) {
      console.log(`  ⚠ Omitido: ${cat.name} (puede que ya exista)`);
    }
  }

  // 3. Insertar temas de ejemplo
  console.log('\n→ Insertando temas de ejemplo...');
  for (const topic of SEED_TOPICS) {
    const catId = catMap[topic.category_name];
    if (!catId) { console.log(`  ⚠ Categoría no encontrada: ${topic.category_name}`); continue; }
    try {
      await fetch(`${PB_URL}/api/collections/topics/records`, {
        method: 'POST', headers,
        body: JSON.stringify({
          title: topic.title,
          description: topic.description,
          category: catId,
          subtopic: topic.subtopic,
          status: topic.status,
          votes_up: Math.floor(Math.random() * 200) + 10,
          votes_down: Math.floor(Math.random() * 80) + 5,
          votes_total: 0,
          rating_avg: (Math.random() * 3 + 6).toFixed(1),
          rating_count: Math.floor(Math.random() * 80) + 15,
          comments_count: Math.floor(Math.random() * 20),
        }),
      });
      console.log(`  ✓ "${topic.title.slice(0, 50)}..."`);
    } catch (e) {
      console.log(`  ⚠ Error: ${topic.title.slice(0, 40)}`);
    }
  }

  console.log('\n══════════════════════════════════════');
  console.log('  ✅ Seed completado');
  console.log('  Abre http://127.0.0.1:8090 para ver la app');
  console.log('══════════════════════════════════════\n');
}

main().catch(console.error);
