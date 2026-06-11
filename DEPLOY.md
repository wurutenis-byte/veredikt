# 🚀 Desplegar Veredikt en Railway — Guía paso a paso

## Lo que necesitas
- Cuenta en railway.app (ya la tienes)
- Cuenta en github.com (gratuita)
- Git instalado en Windows (https://git-scm.com/download/win)

---

## PASO 1 — Subir el código a GitHub

Abre PowerShell o Git Bash en la carpeta del proyecto y ejecuta:

```bash
git init
git add .
git commit -m "Veredikt MVP inicial"
```

Luego ve a github.com → New repository → nombre: `veredikt` → Create
Y ejecuta lo que GitHub te indica (algo como):

```bash
git remote add origin https://github.com/TU_USUARIO/veredikt.git
git branch -M main
git push -u origin main
```

---

## PASO 2 — Crear proyecto en Railway

1. Ve a railway.app → Log in
2. Clic en **"New Project"**
3. Selecciona **"Deploy from GitHub repo"**
4. Conecta tu cuenta GitHub si no lo has hecho
5. Selecciona el repositorio `veredikt`
6. Railway detectará el **Dockerfile** automáticamente → clic **Deploy**

⏳ Tardará ~2 minutos en construir la primera vez.

---

## PASO 3 — Asignar dominio público

1. En Railway, entra a tu proyecto → pestaña **Settings**
2. Sección **Networking** → clic **"Generate Domain"**
3. Copia la URL que aparece (ej: `veredikt-production.up.railway.app`)

---

## PASO 4 — Crear tu cuenta admin en PocketBase

1. Abre en el navegador: `https://TU-URL.up.railway.app/_/`
2. Railway te pedirá crear la primera cuenta de administrador
3. Pon tu email y una contraseña segura → **Create and Login**

---

## PASO 5 — Configurar las colecciones (schema)

En el panel admin de PocketBase, crea estas colecciones manualmente:

### Colección: `categories`
Settings → Collections → New collection → Base collection → nombre: `categories`
Campos:
- `name` → Plain text, Required
- `icon` → Plain text
- `order` → Number

### Colección: `topics`
Nueva colección base `topics`:
- `title` → Plain text, Required
- `description` → Plain text
- `category` → Relation → categories, Required
- `subtopic` → Plain text
- `author` → Relation → users
- `status` → Select → valores: pending, published, rejected
- `votes_up` → Number
- `votes_down` → Number
- `votes_total` → Number
- `rating_avg` → Number
- `rating_count` → Number
- `comments_count` → Number

### Colección: `votes`
Nueva colección base `votes`:
- `user` → Relation → users, Required
- `topic` → Relation → topics, Required
- `value` → Select → valores: up, down, Required

### Colección: `ratings`
Nueva colección base `ratings`:
- `user` → Relation → users, Required
- `topic` → Relation → topics, Required
- `value` → Number, Required

### Colección: `comments`
Nueva colección base `comments`:
- `user` → Relation → users, Required
- `topic` → Relation → topics, Required
- `text` → Plain text, Required

---

## PASO 6 — Configurar reglas de acceso

Para cada colección, en la pestaña **API Rules**:

**topics:**
- List/View rule: `status = "published"`
- Create rule: `@request.auth.id != ""`
- Update/Delete rule: dejar vacío (solo admin por ahora)

**votes, ratings, comments:**
- List/View: `@request.auth.id != ""`
- Create: `@request.auth.id != ""`
- Update/Delete: `@request.auth.id = user`

---

## PASO 7 — Poblar categorías iniciales

Edita `seed_categories.js` líneas 4-5:
```js
const ADMIN_EMAIL    = 'tu@email.com';    // el que usaste en paso 4
const ADMIN_PASSWORD = 'tu_password';
```

Luego desde PowerShell (con Node.js instalado):
```bash
# Cambia la URL por la tuya de Railway
PB_URL=https://TU-URL.up.railway.app node seed_categories.js
```

O edita directamente la línea 3 del archivo temporalmente:
```js
const PB_URL = 'https://TU-URL.up.railway.app';
```

---

## ¡Listo! 🎉

Tu app estará en: `https://TU-URL.up.railway.app`

---

## Opcional: Volumen persistente en Railway

⚠️ Por defecto Railway borra los datos al redesplegar.
Para que la base de datos sea persistente:

1. Railway → tu proyecto → pestaña **Volumes**
2. **"Add Volume"** → Mount path: `/pb/pb_data`
3. Redesplegar

Esto guarda la SQLite en disco permanente.

---

## Opcional: Google OAuth

1. Ve a console.cloud.google.com → New Project
2. APIs & Services → Credentials → Create OAuth 2.0 Client
3. Authorized redirect URI: `https://TU-URL.up.railway.app/api/oauth2-redirect`
4. En PocketBase admin → Settings → Auth Providers → Google → pegar Client ID y Secret
