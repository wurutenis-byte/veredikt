# 🚀 Veredikt — Paquete de mejoras

Resumen de todo lo añadido y pasos para aplicarlo. Sigue el orden indicado.

---

## PASO 1 — Ejecutar la migración SQL

1. Ve a Supabase → **SQL Editor** → **New query**
2. Copia y pega **todo** el contenido de `migration_mejoras.sql`
3. **Run**

Esto crea:
- Función `get_trending_24h()` — para el nuevo filtro "⚡ Últimas 24h" (temas con más actividad reciente, no solo más votos históricos)
- Tabla `comment_reports` — para el sistema de reportar comentarios
- Vista `reported_comments_summary` — para el panel admin

---

## PASO 2 — Reemplazar archivos del frontend

Sustituye estos 3 archivos en tu proyecto:

```
index.html
css/style.css
js/app.js
```

### Qué cambia en cada uno:

**`index.html`**
- Meta tags Open Graph/Twitter Card (para que al compartir en WhatsApp/redes se vea bien)
- Nuevo tab de ordenación "⚡ Últimas 24h"
- Sección "🚩 Comentarios reportados" en el panel admin
- Sección de historial (votos, valoraciones, comentarios) en el perfil

**`css/style.css`**
- Estilos para el historial de perfil
- Estilos para el botón de reportar comentario

**`js/app.js`**
- Sort "Últimas 24h" usando la nueva función SQL
- Botón 🔗 compartir tema → copia enlace `?tema=ID`, y al abrir ese enlace se abre el tema automáticamente
- Historial de perfil (votos/valoraciones/comentarios con enlace al tema)
- Reportar comentarios + panel admin para revisarlos y borrarlos

---

## PASO 3 — Reemplazar script de noticias

Sustituye `scripts/fetch_trends.js`. Cambios:
- Filtra noticias de deportes y sucesos puntuales (muertes, accidentes, crímenes) para mantener "Curiosidades" centrado en debate general
- Soporte opcional para reescribir títulos con Claude (ver paso 4)

`scripts/fetch_leyes.js` **no cambia** — se mantiene como está.

---

## PASO 4 — (Opcional) Títulos más legibles con Claude

El script de noticias puede usar Claude para convertir titulares crudos en preguntas claras de debate (ej: "El Gobierno aprueba la subida del SMI" → "¿Apoyas la subida del Salario Mínimo aprobada por el Gobierno?").

**Para activarlo:**
1. Consigue una API key en [console.anthropic.com](https://console.anthropic.com)
2. GitHub → tu repo → Settings → Secrets and variables → Actions → New repository secret:
   - Name: `ANTHROPIC_API_KEY`
   - Value: tu clave

**Para NO activarlo:** no hagas nada — el script funciona igual sin esa clave, solo con títulos más literales.

⚠️ **Importante — limitación de duplicados:** si activas esto, los títulos de noticias se reescriben con IA cada día, y como la redacción puede variar ligeramente, la detección de duplicados (que compara por título exacto) podría no reconocer la misma noticia de un día para otro y crear entradas repetidas con distinta redacción. Esto es un compromiso aceptado por simplicidad. Si te molesta, revisa periódicamente "Temas publicados" en el panel admin y borra duplicados, o deja esta función desactivada.

---

## PASO 5 — Subir SEO básico

Sube también (si no existen ya en tu repo):
```
robots.txt
sitemap.xml
```

Van en la **raíz** del repo (junto a `index.html`).

⚠️ **Limitación honesta sobre SEO de temas individuales:** como Veredikt es una SPA (single-page app) servida estáticamente desde GitHub Pages, no es posible generar meta tags dinámicos por tema (título/descripción específicos al compartir un enlace `?tema=ID` en redes sociales) sin un servicio de renderizado del lado servidor o "prerendering", que está fuera del alcance actual. Lo que SÍ funciona:
- La portada (`/`) tiene meta tags OG genéricos correctos
- Los enlaces `?tema=ID` abren el tema correcto al cargar (función de compartir)
- Pero al pegar ese enlace en WhatsApp/Twitter, la vista previa mostrará el título/descripción genérico de Veredikt, no el del tema específico

Si en el futuro esto es importante (mucho tráfico desde redes sociales), la solución sería migrar a un hosting con SSR (Vercel/Netlify con funciones) — avísame si llegado el momento quieres ese cambio.

---

## Resumen de todas las mejoras incluidas

| # | Mejora | Dónde se ve |
|---|---|---|
| 1 | Trending últimas 24h | Nuevo tab de ordenación en home |
| 2 | Compartir tema (enlace directo) | Botón 🔗 en cada modal de tema |
| 3 | Historial de perfil | Página de perfil: tus votos, valoraciones y comentarios con enlace al tema |
| 4 | Títulos mejorados con IA (opcional) | Automatización de noticias diarias |
| 5 | Filtro deportes/sucesos | Automatización de noticias diarias |
| 6 | Meta tags SEO + sitemap/robots | `<head>` + archivos raíz |
| 7 | Reportar comentarios | Botón 🚩 en cada comentario + panel admin |

---

## Orden recomendado de subida (PowerShell)

```powershell
# 1. Reemplaza los archivos según las instrucciones arriba, luego:
git add .
git commit -m "mejoras: trending 24h, compartir, historial perfil, reportar comentarios, seo, filtro noticias"
git push
```

Después de subir, recuerda ejecutar el `migration_mejoras.sql` en Supabase (PASO 1) — si lo haces después del push no hay problema, pero la sección "Últimas 24h" y "Comentarios reportados" mostrarán error hasta que la migración esté aplicada.
