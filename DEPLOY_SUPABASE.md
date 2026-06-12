# 🚀 Veredikt — Despliegue con Supabase + GitHub Pages

100% gratis, sin tarjeta de crédito.

---

## PASO 1 — Crear proyecto en Supabase

1. Ve a **supabase.com** → Sign up (puedes usar GitHub)
2. Clic en **"New Project"**
3. Rellena:
   - **Name**: `veredikt`
   - **Database Password**: genera una segura y guárdala
   - **Region**: la más cercana (Frankfurt/EU si está disponible)
4. Clic **"Create new project"** (tarda ~2 minutos en aprovisionar)

---

## PASO 2 — Ejecutar el schema SQL

1. En el panel de Supabase, ve a **SQL Editor** (icono de la izquierda)
2. Clic **"New query"**
3. Abre el archivo `schema.sql` (te lo he generado), copia **todo** el contenido
4. Pégalo en el editor y clic **"Run"** (o Ctrl+Enter)
5. Deberías ver "Success. No rows returned"

Esto crea todas las tablas, seguridad (RLS), triggers automáticos y las 22 categorías + 8 temas de ejemplo.

---

## PASO 3 — Obtener las claves de API

1. Ve a **Settings** (icono engranaje) → **API**
2. Copia estos dos valores:
   - **Project URL** (algo como `https://xxxxx.supabase.co`)
   - **anon public** key (una clave larga que empieza por `eyJ...`)

---

## PASO 4 — Configurar el frontend

Abre `js/app.js` con el Bloc de notas, líneas 3-4:

```js
const SUPABASE_URL      = 'https://xxxxx.supabase.co';   // ← tu Project URL
const SUPABASE_ANON_KEY = 'eyJ...........................'; // ← tu anon key
```

Guarda el archivo.

---

## PASO 5 — Subir a GitHub Pages

Si ya tienes el repo `veredikt` en GitHub, simplemente:

```powershell
git add .
git commit -m "Migración a Supabase"
git push
```

Ahora activa GitHub Pages:

1. Ve a tu repo en github.com → **Settings** → **Pages** (menú izquierdo)
2. En **"Source"**, selecciona **"Deploy from a branch"**
3. Branch: **main** / carpeta: **/ (root)** → **Save**
4. Espera 1-2 minutos, recarga la página y verás la URL: `https://TU_USUARIO.github.io/veredikt/`

---

## PASO 6 — Configurar autenticación en Supabase

1. En Supabase → **Authentication** → **URL Configuration**
2. **Site URL**: pon tu URL de GitHub Pages: `https://TU_USUARIO.github.io/veredikt/`
3. **Redirect URLs**: añade la misma URL
4. Guarda

### Para email/password (ya funciona por defecto)
En **Authentication** → **Providers** → **Email** debería estar activado ya.

⚠️ Por defecto Supabase requiere confirmación de email. Para desactivarlo en desarrollo:
**Authentication** → **Providers** → **Email** → desmarca **"Confirm email"**

### Para Google OAuth (opcional)
1. **Authentication** → **Providers** → **Google** → activar
2. Sigue el enlace a Google Cloud Console para crear credenciales OAuth
3. Authorized redirect URI que te pedirá Google:
   `https://xxxxx.supabase.co/auth/v1/callback`
4. Pega Client ID y Secret en Supabase → Save

---

## PASO 7 — Convertirte en administrador

Para aprobar/rechazar propuestas necesitas marcar tu usuario como admin:

1. Regístrate primero en tu app (botón Entrar → Registrarse)
2. Ve a Supabase → **Table Editor** → tabla `profiles`
3. Busca tu fila (por tu nombre/email)
4. Edita la columna `is_admin` → cámbiala a **true**
5. Guarda

Recarga la app — ahora verás "Panel admin" en tu menú de usuario.

---

## ¡Listo! 🎉

Tu app está en: `https://TU_USUARIO.github.io/veredikt/`

Base de datos persistente, gratis para siempre (hasta 500MB / 50k usuarios activos al mes), sin tarjeta.

---

## Límites del plan gratuito de Supabase

- 500 MB de base de datos
- 50,000 usuarios activos mensuales (MAU)
- 2 GB de transferencia/mes
- El proyecto se pausa tras 7 días de inactividad total (se reactiva solo al usar la API)

Para un proyecto en crecimiento esto es más que suficiente durante mucho tiempo.

---

## Solución de problemas

**"Sin resultados" o error de conexión:**
Verifica que `SUPABASE_URL` y `SUPABASE_ANON_KEY` están bien copiados en `js/app.js` (sin espacios extra).

**No puedo registrarme:**
Revisa Authentication → Providers → Email → "Confirm email" debe estar desactivado para pruebas, o revisa tu bandeja de spam.

**El panel admin da error:**
Verifica que tu usuario tiene `is_admin = true` en la tabla `profiles`.
