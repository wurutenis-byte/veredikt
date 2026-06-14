// ─── CONFIG ──────────────────────────────────────────────────
// ⚠️ RELLENA ESTOS DOS VALORES con los de tu proyecto Supabase
// (Supabase Dashboard → Settings → API)
const SUPABASE_URL      = 'https://qnzlmgqchmffnrlfljrf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fioeWGpnQ-2eSkn_VhivIA_K8O_iMKN';

// ─── SUPABASE CLIENT ────────────────────────────────────────
// Cargado vía CDN en index.html como `window.supabase`
//
// ⚠️ NOTA TÉCNICA IMPORTANTE:
// sb.auth.* y sb.from() de la librería oficial se quedan COLGADOS
// indefinidamente (Promise que nunca resuelve) en cuanto hay una
// sesión activa guardada en localStorage. Es un bug del cliente
// con el mecanismo interno de refresh de token / Web Locks API en
// este entorno. Para evitarlo, todas las operaciones de datos y
// auth se hacen aquí con `fetch` directo contra la REST API de
// PostgREST y el endpoint /auth/v1 de Supabase (GoTrue), gestionando
// la sesión manualmente en localStorage.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,   // gestionamos la sesión nosotros mismos
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

const STORAGE_KEY = `sb-${SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]}-auth-token`;

// ─── STATE ───────────────────────────────────────────────────
const state = {
  user: null,
  profile: null,
  currentCategory: 'all',
  currentSort: 'trending',
  topics: [],
  categories: [],
  page: 1,
  loading: false,
  openTopic: null,
};

// ─── REST helpers (fetch directo) ──────────────────────────────
function getSavedSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

function authHeaders() {
  const session = getSavedSession();
  const token = session?.access_token || SUPABASE_ANON_KEY;
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token}`,
  };
}

// Petición genérica a PostgREST (/rest/v1/<table>)
async function rest(path, { method = 'GET', body = null, prefer = null, params = {} } = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const headers = authHeaders();
  if (prefer) headers['Prefer'] = prefer;

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let errMsg;
    try { errMsg = (await res.json()).message; } catch { errMsg = `Error ${res.status}`; }
    throw new Error(errMsg || `Error ${res.status}`);
  }

  if (res.status === 204) return null; // No Content (deletes/updates sin Prefer)
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Petición al endpoint de auth (/auth/v1/...)
async function authRest(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || data.message || 'Error de autenticación');
  return data;
}

// ─── AUTH ────────────────────────────────────────────────────
const auth = {
  async loginWithGoogle() {
    // Redirección OAuth estándar de GoTrue (no requiere el cliente JS)
    const redirectTo = encodeURIComponent(window.location.origin + window.location.pathname);
    window.location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${redirectTo}`;
  },

  async loginWithEmail(email, password) {
    const data = await authRest('token?grant_type=password', { email, password });
    saveSession(data);
    state.user = data.user;
    await this.loadProfile();
    renderUserNav();
    return data;
  },

  async register(email, password, name) {
    const data = await authRest('signup', { email, password, data: { name } });
    if (data.access_token) {
      saveSession(data);
      state.user = data.user;
      await this.loadProfile();
      renderUserNav();
    }
    return data;
  },

  async logout() {
    clearSession();
    state.user = null;
    state.profile = null;
    renderUserNav();
    toast('Sesión cerrada');
  },

  async restoreSession() {
    // Limpiar claves antiguas de PocketBase que puedan corromper el storage
    localStorage.removeItem('pb_token');
    localStorage.removeItem('pb_user');
    localStorage.removeItem('pb_oauth_state');
    localStorage.removeItem('pb_oauth_verifier');

    // 1. Comprobar si venimos de un redirect OAuth (token en el hash de la URL)
    if (window.location.hash.includes('access_token')) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken) {
        // Obtener datos del usuario con el token recién recibido
        try {
          const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${accessToken}` },
          });
          const user = await res.json();
          const session = {
            access_token: accessToken,
            refresh_token: refreshToken,
            user,
            expires_at: Math.floor(Date.now() / 1000) + parseInt(params.get('expires_in') || '3600'),
          };
          saveSession(session);
          state.user = user;
          // Limpiar el hash de la URL
          history.replaceState(null, '', window.location.pathname + window.location.search);
        } catch (e) {
          console.error('Error procesando redirect OAuth:', e);
        }
      }
    }

    // 2. Restaurar sesión guardada de localStorage
    if (!state.user) {
      const session = getSavedSession();
      if (session?.user) {
        state.user = session.user;
      }
    }

    if (state.user) {
      await this.loadProfile();
      renderUserNav();
    }
  },

  async loadProfile() {
    if (!state.user) return;
    try {
      const data = await rest('profiles', { params: { id: `eq.${state.user.id}`, select: '*' } });
      state.profile = data?.[0] || null;
    } catch (e) {
      console.warn('No se pudo cargar el perfil:', e.message);
      state.profile = null;
    }
  },
};

// ─── DATA API ───────────────────────────────────────────────
const api = {
  async getCategories() {
    return rest('categories', { params: { select: '*', order: 'order.asc' } });
  },

  async getTopics({ category = 'all', sort = 'trending', search = '', page = 1 } = {}) {
    const sortMap = {
      trending:      'votes_up.desc',
      newest:        'created_at.desc',
      top:           'rating_avg.desc',
      controversial: 'votes_total.desc',
    };
    const perPage = 20;
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    const params = {
      select: '*,categories(name,icon)',
      status: 'eq.published',
      order: sortMap[sort] || sortMap.trending,
    };
    if (category !== 'all') params.category_id = `eq.${category}`;
    if (search) params.or = `(title.ilike.*${search}*,subtopic.ilike.*${search}*)`;

    const headers = authHeaders();
    headers['Range'] = `${from}-${to}`;

    const url = new URL(`${SUPABASE_URL}/rest/v1/topics`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return res.json();
  },

  async getTopic(id) {
    const data = await rest('topics', { params: { id: `eq.${id}`, select: '*,categories(name,icon)' } });
    if (!data?.length) throw new Error('Tema no encontrado');
    return data[0];
  },

  async getMyVote(topicId) {
    if (!state.user) return null;
    const data = await rest('votes', { params: { topic_id: `eq.${topicId}`, user_id: `eq.${state.user.id}`, select: '*' } });
    return data?.[0] || null;
  },

  async getMyRating(topicId) {
    if (!state.user) return null;
    const data = await rest('ratings', { params: { topic_id: `eq.${topicId}`, user_id: `eq.${state.user.id}`, select: '*' } });
    return data?.[0] || null;
  },

  async getMyComment(topicId) {
    if (!state.user) return null;
    const data = await rest('comments', { params: { topic_id: `eq.${topicId}`, user_id: `eq.${state.user.id}`, select: '*' } });
    return data?.[0] || null;
  },

  async getComments(topicId) {
    return rest('comments', { params: { topic_id: `eq.${topicId}`, select: '*,profiles(name)', order: 'created_at.desc' } });
  },

  async vote(topicId, value) {
    if (!state.user) { openAuthModal(); return; }
    const existing = await this.getMyVote(topicId);
    if (existing) {
      if (existing.value === value) {
        await rest(`votes?id=eq.${existing.id}`, { method: 'DELETE' });
        toast('Voto retirado');
      } else {
        await rest(`votes?id=eq.${existing.id}`, { method: 'PATCH', body: { value } });
        toast('Voto actualizado');
      }
    } else {
      await rest('votes', { method: 'POST', body: { user_id: state.user.id, topic_id: topicId, value } });
      toast('¡Votado!', 'success');
    }
  },

  async rate(topicId, value) {
    if (!state.user) { openAuthModal(); return; }
    const existing = await this.getMyRating(topicId);
    if (existing) {
      await rest(`ratings?id=eq.${existing.id}`, { method: 'PATCH', body: { value } });
      toast('Valoración actualizada');
    } else {
      await rest('ratings', { method: 'POST', body: { user_id: state.user.id, topic_id: topicId, value } });
      toast('¡Valorado!', 'success');
    }
  },

  async comment(topicId, text) {
    if (!state.user) { openAuthModal(); return; }
    const existing = await this.getMyComment(topicId);
    if (existing) { toast('Ya has comentado en este tema', 'error'); return null; }
    await rest('comments', { method: 'POST', body: { user_id: state.user.id, topic_id: topicId, text } });
    toast('Comentario publicado', 'success');
  },

  async proposeTopic({ title, category, subtopic, description }) {
    if (!state.user) { openAuthModal(); return; }
    await rest('topics', {
      method: 'POST',
      body: {
        title, subtopic, description,
        category_id: category,
        author_id: state.user.id,
        status: 'pending',
      },
    });
  },

  // Admin
  async getPendingTopics() {
    return rest('topics', { params: { status: 'eq.pending', select: '*,categories(name)', order: 'created_at.desc' } });
  },

  async approveTopic(id) {
    await rest(`topics?id=eq.${id}`, { method: 'PATCH', body: { status: 'published' } });
  },

  async rejectTopic(id) {
    await rest(`topics?id=eq.${id}`, { method: 'DELETE' });
  },

  async getPublishedTopics(search = '') {
    const params = { status: 'eq.published', select: '*,categories(name)', order: 'created_at.desc', limit: '100' };
    if (search) params.title = `ilike.*${search}*`;
    return rest('topics', { params });
  },

  async deleteTopic(id) {
    await rest(`topics?id=eq.${id}`, { method: 'DELETE' });
  },
};

// ─── RENDER HELPERS ───────────────────────────────────────────
function renderUserNav() {
  const navRight = document.getElementById('nav-right');
  if (!navRight) return;
  if (state.user) {
    const name = state.profile?.name || state.user.email || '?';
    const initials = name.slice(0, 2).toUpperCase();
    navRight.innerHTML = `
      <div class="user-avatar" onclick="toggleUserMenu()" id="user-avatar-btn">
        ${initials}
        <div class="user-menu" id="user-menu">
          <a onclick="showPage('profile')">Mi perfil</a>
          ${state.profile?.is_admin ? `<a onclick="showPage('admin')">Panel admin</a>` : ''}
          <div class="divider"></div>
          <a onclick="auth.logout()">Cerrar sesión</a>
        </div>
      </div>`;
  } else {
    navRight.innerHTML = `<button class="btn-login" onclick="openAuthModal()">Entrar</button>`;
  }
}

function pctUp(topic) {
  const total = (topic.votes_up || 0) + (topic.votes_down || 0);
  return total === 0 ? 50 : Math.round((topic.votes_up / total) * 100);
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

function renderTopicCard(topic) {
  const up = pctUp(topic);
  const rating = topic.rating_avg ? Number(topic.rating_avg).toFixed(1) : '—';
  const catName = topic.categories?.name || '';
  return `
    <div class="topic-card" onclick="openTopicModal('${topic.id}')">
      <div class="card-meta">
        <span class="card-cat-badge">${catName}</span>
        ${topic.subtopic ? `<span style="color:var(--small)">› ${topic.subtopic}</span>` : ''}
        <span style="margin-left:auto">${timeAgo(topic.created_at)}</span>
      </div>
      <div class="card-title">${topic.title}</div>
      <div class="card-actions">
        <button class="vote-btn up" onclick="event.stopPropagation(); quickVote('${topic.id}', 'up')">
          👍 ${topic.votes_up || 0}
        </button>
        <div class="vote-bar">
          <div class="vote-bar-fill" style="width:${up}%"></div>
        </div>
        <button class="vote-btn down" onclick="event.stopPropagation(); quickVote('${topic.id}', 'down')">
          👎 ${topic.votes_down || 0}
        </button>
      </div>
      <div class="card-footer">
        <div class="comment-count">💬 ${topic.comments_count || 0} comentarios</div>
        <div class="rating-display">
          <span class="rating-number">${rating}</span>
          <span class="rating-label">/10</span>
        </div>
      </div>
    </div>`;
}

function renderCategories(categories) {
  const list = document.getElementById('cat-list');
  if (!list) return;
  const all = `
    <li class="cat-item">
      <a href="#" class="${state.currentCategory === 'all' ? 'active' : ''}" onclick="filterCategory('all', event)">
        <span class="cat-icon">🌐</span> Todo
      </a>
    </li>`;
  const items = categories.map(c => `
    <li class="cat-item">
      <a href="#" class="${state.currentCategory === c.id ? 'active' : ''}" onclick="filterCategory('${c.id}', event)">
        <span class="cat-icon">${c.icon || '📂'}</span> ${c.name}
      </a>
    </li>`).join('');
  list.innerHTML = all + items;
}

function renderTopics(topics, append = false) {
  const grid = document.getElementById('topics-grid');
  if (!grid) return;
  if (topics.length === 0 && !append) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">🔍</div>
        <h3>Sin resultados</h3>
        <p>Prueba con otra categoría o propón este tema.</p>
      </div>`;
    return;
  }
  const html = topics.map(renderTopicCard).join('');
  if (append) grid.insertAdjacentHTML('beforeend', html);
  else grid.innerHTML = html;
}

function showSkeletons() {
  const grid = document.getElementById('topics-grid');
  if (!grid) return;
  grid.innerHTML = Array(6).fill(`<div class="skeleton skeleton-card"></div>`).join('');
}

// ─── DATA LOADING ─────────────────────────────────────────────
const PAGE_SIZE = 20;

async function loadTopics(append = false) {
  if (state.loading) return;
  state.loading = true;
  if (!append) showSkeletons();
  else setLoadMoreLoading(true);

  try {
    const topics = await api.getTopics({
      category: state.currentCategory,
      sort: state.currentSort,
      search: document.getElementById('search-input')?.value || '',
      page: state.page,
    });
    const newTopics = topics || [];

    if (append) state.topics = [...state.topics, ...newTopics];
    else state.topics = newTopics;

    renderTopics(newTopics, append);
    updateLoadMoreButton(newTopics.length);
    if (!append) updateTicker();
  } catch (e) {
    console.error(e);
    if (!append) renderTopicsError(e);
  } finally {
    state.loading = false;
    setLoadMoreLoading(false);
  }
}

async function loadMoreTopics() {
  state.page += 1;
  await loadTopics(true);
}

function setLoadMoreLoading(loading) {
  const btn = document.getElementById('load-more-btn');
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? 'Cargando...' : 'Cargar más';
}

function updateLoadMoreButton(lastBatchCount) {
  const btn = document.getElementById('load-more-btn');
  if (!btn) return;
  // Si la última página trajo menos del tamaño completo, no hay más resultados
  btn.style.display = (lastBatchCount < PAGE_SIZE) ? 'none' : 'block';
}

function renderTopicsError(e) {
  const grid = document.getElementById('topics-grid');
  if (grid) grid.innerHTML = `
    <div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">⚠️</div>
      <h3>No se pudo conectar con Supabase</h3>
      <p>${e?.message || 'Verifica SUPABASE_URL y SUPABASE_ANON_KEY en app.js'}</p>
    </div>`;
}

async function loadCategories() {
  try {
    state.categories = await api.getCategories();
    renderCategories(state.categories);
    populateCategorySelects();
  } catch (e) {
    console.error('Error loading categories:', e);
    state.categories = [];
  }
}

function populateCategorySelects() {
  const el = document.getElementById('propose-category');
  if (!el) return;
  el.innerHTML = `<option value="">Selecciona categoría</option>` +
    state.categories.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
}

function updateTicker() {
  const track = document.getElementById('ticker-track');
  if (!track || !state.topics.length) return;
  const items = [...state.topics, ...state.topics].map(t =>
    `<span class="ticker-item"><strong>${t.title}</strong> 👍${t.votes_up || 0} · ⭐${t.rating_avg ? Number(t.rating_avg).toFixed(1) : '—'}</span>`
  ).join('');
  track.innerHTML = items;

  // Forzar reinicio de la animación CSS: en algunos navegadores móviles
  // (especialmente en orientación vertical durante la carga inicial),
  // la animación no arranca hasta que hay un reflow/repaint del elemento.
  track.style.animation = 'none';
  // Forzar reflow leyendo una propiedad de layout
  // eslint-disable-next-line no-unused-expressions
  track.offsetHeight;
  track.style.animation = '';
}

// ─── INTERACTIONS ─────────────────────────────────────────────
async function quickVote(topicId, value) {
  if (!state.user) { openAuthModal(); return; }
  await api.vote(topicId, value);
  await loadTopics();
}

// ─── MODAL ───────────────────────────────────────────────────
async function openTopicModal(topicId) {
  const overlay = document.getElementById('topic-modal-overlay');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  document.getElementById('modal-content').innerHTML = `
    <div style="text-align:center;padding:3rem;color:var(--muted)">Cargando...</div>`;

  try {
    const [topic, comments, myVote, myRating, myComment] = await Promise.all([
      api.getTopic(topicId),
      api.getComments(topicId),
      api.getMyVote(topicId),
      api.getMyRating(topicId),
      api.getMyComment(topicId),
    ]);
    state.openTopic = topic;
    renderTopicModal(topic, comments || [], myVote, myRating, myComment);
  } catch (e) {
    document.getElementById('modal-content').innerHTML = `
      <p style="color:var(--down)">Error al cargar el tema: ${e.message || e}</p>`;
  }
}

function renderTopicModal(topic, comments, myVote, myRating, myComment) {
  const up = pctUp(topic);
  const catName = topic.categories?.name || '';
  const myRatingVal = myRating?.value || 5;
  const hasVotedUp   = myVote?.value === 'up';
  const hasVotedDown = myVote?.value === 'down';

  document.getElementById('modal-content').innerHTML = `
    <div class="modal-header">
      <h2 class="modal-title">${topic.title}</h2>
      <button class="modal-close" onclick="closeTopicModal()">✕</button>
    </div>
    <div class="modal-meta">
      <span class="card-cat-badge">${catName}</span>
      ${topic.subtopic ? `<span class="card-cat-badge">${topic.subtopic}</span>` : ''}
      <span style="font-size:0.78rem;color:var(--small)">${timeAgo(topic.created_at)}</span>
    </div>
    ${topic.description ? `<p style="color:var(--muted);font-size:0.92rem;margin-bottom:1.5rem;line-height:1.6">${topic.description}</p>` : ''}

    <!-- VOTAR -->
    <div class="modal-section">
      <div class="modal-section-label">¿A favor o en contra?</div>
      <div class="vote-big">
        <button class="vote-big-btn up ${hasVotedUp ? 'active' : ''}" onclick="modalVote('up')">
          👍 A favor <strong style="font-family:var(--font-mono)">${topic.votes_up || 0}</strong>
        </button>
        <button class="vote-big-btn down ${hasVotedDown ? 'active' : ''}" onclick="modalVote('down')">
          👎 En contra <strong style="font-family:var(--font-mono)">${topic.votes_down || 0}</strong>
        </button>
      </div>
      <div class="vote-result-bar">
        <div class="vote-result-fill" id="modal-vote-bar" style="width:${up}%"></div>
      </div>
      <div class="vote-result-labels">
        <span class="up-pct" id="modal-up-pct">${up}% a favor</span>
        <span class="down-pct">${100 - up}% en contra</span>
      </div>
    </div>

    <!-- VALORAR -->
    <div class="modal-section">
      <div class="modal-section-label">
        Valora del 1 al 10
        ${myRating ? '· <span style="color:var(--up)">Ya valorado</span>' : ''}
      </div>
      <div style="display:flex;align-items:center;gap:1rem;">
        <input type="range" min="1" max="10" value="${myRatingVal}"
          class="rating-input" id="modal-rating-input"
          oninput="document.getElementById('modal-rating-val').textContent = this.value">
        <div class="rating-value-display" id="modal-rating-val">${myRatingVal}</div>
      </div>
      <button class="btn-rate" onclick="modalRate()">
        ${myRating ? 'Actualizar valoración' : 'Valorar'}
      </button>
      <div class="rating-avg-display">
        <div class="rating-avg-big" id="modal-rating-avg">
          ${topic.rating_avg ? Number(topic.rating_avg).toFixed(1) : '—'}
        </div>
        <div>
          <div style="font-size:0.85rem;color:var(--text);font-weight:600">/10 media</div>
          <div class="rating-avg-sub">${topic.rating_count || 0} valoraciones</div>
        </div>
      </div>
    </div>

    <!-- COMENTAR -->
    <div class="modal-section">
      <div class="modal-section-label">Comentarios · ${topic.comments_count || 0}</div>
      ${myComment
        ? `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:0.8rem 1rem;margin-bottom:1rem;font-size:0.9rem;color:var(--muted)">
            <strong style="color:var(--text)">Tu comentario:</strong> ${myComment.text}
           </div>`
        : `<div class="comment-input-wrap">
            <textarea id="comment-textarea" class="comment-textarea" placeholder="Escribe tu opinión (solo 1 por tema)..." maxlength="500"></textarea>
            <button class="btn-comment" onclick="modalComment()">Publicar</button>
           </div>`
      }
      <div id="comments-list">
        ${comments.length === 0
          ? `<p style="color:var(--small);font-size:0.88rem;text-align:center;padding:1rem">Sin comentarios todavía.</p>`
          : comments.map(c => `
            <div class="comment-item">
              <div class="comment-author">
                <div class="comment-avatar">${(c.profiles?.name || '?').slice(0,2).toUpperCase()}</div>
                <span class="comment-name">${c.profiles?.name || 'Usuario'}</span>
                <span class="comment-date">${timeAgo(c.created_at)}</span>
              </div>
              <div class="comment-text">${c.text}</div>
            </div>`).join('')
        }
      </div>
    </div>`;
}

function closeTopicModal() {
  const overlay = document.getElementById('topic-modal-overlay');
  overlay.classList.remove('open');
  document.body.style.overflow = '';
  state.openTopic = null;
}

async function modalVote(value) {
  if (!state.user) { openAuthModal(); return; }
  if (!state.openTopic) return;
  await api.vote(state.openTopic.id, value);
  await openTopicModal(state.openTopic.id);
  loadTopics();
}

async function modalRate() {
  if (!state.user) { openAuthModal(); return; }
  if (!state.openTopic) return;
  const val = parseInt(document.getElementById('modal-rating-input').value);
  await api.rate(state.openTopic.id, val);
  await openTopicModal(state.openTopic.id);
  loadTopics();
}

async function modalComment() {
  if (!state.user) { openAuthModal(); return; }
  if (!state.openTopic) return;
  const text = document.getElementById('comment-textarea')?.value?.trim();
  if (!text) { toast('Escribe algo antes de publicar', 'error'); return; }
  await api.comment(state.openTopic.id, text);
  await openTopicModal(state.openTopic.id);
  loadTopics();
}

// ─── AUTH MODAL ───────────────────────────────────────────────
function openAuthModal() {
  document.getElementById('auth-modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeAuthModal() {
  document.getElementById('auth-modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

async function submitLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  if (!email || !pass) { toast('Rellena todos los campos', 'error'); return; }
  const btn = document.getElementById('login-btn');
  btn.textContent = 'Entrando...'; btn.disabled = true;
  try {
    await auth.loginWithEmail(email, pass);
    closeAuthModal();
    toast('¡Bienvenido!', 'success');
    loadTopics();
  } catch (e) {
    toast(e.message || 'Credenciales incorrectas', 'error');
  } finally { btn.textContent = 'Entrar'; btn.disabled = false; }
}

async function submitRegister() {
  const name  = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass  = document.getElementById('reg-pass').value;
  if (!name || !email || !pass) { toast('Rellena todos los campos', 'error'); return; }
  if (pass.length < 6) { toast('La contraseña debe tener al menos 6 caracteres', 'error'); return; }
  const btn = document.getElementById('reg-btn');
  btn.textContent = 'Creando cuenta...'; btn.disabled = true;
  try {
    await auth.register(email, pass, name);
    closeAuthModal();
    toast('¡Cuenta creada! Revisa tu email si se requiere confirmación.', 'success');
  } catch (e) {
    toast(e.message || 'Error al registrar', 'error');
  } finally { btn.textContent = 'Crear cuenta'; btn.disabled = false; }
}

function showAuthTab(tab) {
  document.getElementById('auth-login').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('auth-register').style.display = tab === 'register' ? 'block' : 'none';
  document.querySelectorAll('.auth-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
    if (t.dataset.tab === tab) {
      t.style.background = 'var(--surface2)';
      t.style.color = 'var(--text)';
    } else {
      t.style.background = 'transparent';
      t.style.color = 'var(--muted)';
    }
  });
}

// ─── PROPOSE MODAL ────────────────────────────────────────────
function openProposeModal() {
  if (!state.user) { openAuthModal(); return; }
  document.getElementById('propose-modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeProposeModal() {
  document.getElementById('propose-modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

async function submitPropose() {
  const title    = document.getElementById('propose-title').value.trim();
  const category = document.getElementById('propose-category').value;
  const subtopic = document.getElementById('propose-subtopic').value.trim();
  const desc     = document.getElementById('propose-desc').value.trim();
  if (!title || !category) { toast('Título y categoría son obligatorios', 'error'); return; }
  const btn = document.getElementById('propose-btn');
  btn.textContent = 'Enviando...'; btn.disabled = true;
  try {
    await api.proposeTopic({ title, category, subtopic, description: desc });
    closeProposeModal();
    document.getElementById('propose-title').value = '';
    document.getElementById('propose-subtopic').value = '';
    document.getElementById('propose-desc').value = '';
    toast('Propuesta enviada, pendiente de revisión', 'success');
  } catch (e) {
    toast(e.message || 'Error al enviar', 'error');
  } finally { btn.textContent = 'Proponer tema'; btn.disabled = false; }
}

// ─── FILTERS & SORT ───────────────────────────────────────────
function filterCategory(catId, event) {
  if (event) event.preventDefault();
  state.currentCategory = catId;
  state.page = 1;
  document.querySelectorAll('.cat-item a').forEach(a => a.classList.remove('active'));
  if (event?.target) event.target.closest('a').classList.add('active');
  loadTopics();
}

function setSort(sort) {
  state.currentSort = sort;
  state.page = 1;
  document.querySelectorAll('.sort-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.sort === sort);
  });
  loadTopics();
}

// ─── SEARCH ──────────────────────────────────────────────────
let searchTimeout;
function onSearch(value) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    state.page = 1;
    loadTopics();
  }, 350);
}

// ─── USER MENU ────────────────────────────────────────────────
function toggleUserMenu() {
  document.getElementById('user-menu')?.classList.toggle('open');
}
document.addEventListener('click', e => {
  if (!e.target.closest('#user-avatar-btn')) {
    document.getElementById('user-menu')?.classList.remove('open');
  }
});

// ─── ADMIN ───────────────────────────────────────────────────
async function loadAdminPanel() {
  const el = document.getElementById('admin-table-body');
  if (!el) return;
  el.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--muted)">Cargando...</td></tr>`;
  try {
    const topics = await api.getPendingTopics();
    if (!topics || topics.length === 0) {
      el.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--small)">Sin propuestas pendientes ✓</td></tr>`;
      return;
    }
    el.innerHTML = topics.map(t => `
      <tr>
        <td>${t.title}</td>
        <td>${t.categories?.name || '—'}</td>
        <td>${t.subtopic || '—'}</td>
        <td><span class="badge badge-pending">Pendiente</span></td>
        <td style="display:flex;gap:0.5rem">
          <button class="btn-approve" onclick="adminApprove('${t.id}')">✓ Aprobar</button>
          <button class="btn-reject" onclick="adminReject('${t.id}')">✕ Rechazar</button>
        </td>
      </tr>`).join('');
  } catch (e) {
    el.innerHTML = `<tr><td colspan="5" style="color:var(--down);padding:1rem">Error: ${e.message}. ¿Eres admin?</td></tr>`;
  }
}

async function adminApprove(id) {
  try {
    await api.approveTopic(id);
    toast('Tema publicado', 'success');
    loadAdminPanel();
    loadTopics();
  } catch (e) { toast(e.message, 'error'); }
}

async function adminReject(id) {
  if (!confirm('¿Rechazar y eliminar esta propuesta?')) return;
  try {
    await api.rejectTopic(id);
    toast('Propuesta rechazada');
    loadAdminPanel();
  } catch (e) { toast(e.message, 'error'); }
}

// ─── ADMIN: temas publicados (borrar) ─────────────────────────
let adminPublishedSearchTimeout;
function onAdminPublishedSearch(value) {
  clearTimeout(adminPublishedSearchTimeout);
  adminPublishedSearchTimeout = setTimeout(() => loadAdminPublished(value), 350);
}

async function loadAdminPublished(search = '') {
  const el = document.getElementById('admin-published-body');
  if (!el) return;
  el.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--muted)">Cargando...</td></tr>`;
  try {
    const topics = await api.getPublishedTopics(search);
    if (!topics || topics.length === 0) {
      el.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--small)">Sin resultados</td></tr>`;
      return;
    }
    el.innerHTML = topics.map(t => `
      <tr>
        <td>${t.title}</td>
        <td>${t.categories?.name || '—'}</td>
        <td>${t.subtopic || '—'}</td>
        <td>
          <button class="btn-reject" onclick="adminDeleteTopic('${t.id}', this)">🗑 Borrar</button>
        </td>
      </tr>`).join('');
  } catch (e) {
    el.innerHTML = `<tr><td colspan="4" style="color:var(--down);padding:1rem">Error: ${e.message}</td></tr>`;
  }
}

async function adminDeleteTopic(id, btn) {
  if (!confirm('¿Borrar este tema permanentemente? Se eliminarán también sus votos, valoraciones y comentarios.')) return;
  try {
    btn.disabled = true;
    btn.textContent = 'Borrando...';
    await api.deleteTopic(id);
    toast('Tema borrado', 'success');
    btn.closest('tr').remove();
    loadTopics();
  } catch (e) {
    toast(e.message, 'error');
    btn.disabled = false;
    btn.textContent = '🗑 Borrar';
  }
}

function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  const el = document.getElementById(`page-${page}`);
  if (el) {
    el.style.display = 'block';
    if (page === 'admin') { loadAdminPanel(); loadAdminPublished(); }
    if (page === 'profile' && state.user) {
      const name = state.profile?.name || 'Sin nombre';
      const initials = name.slice(0, 2).toUpperCase();
      const avatarEl = document.getElementById('profile-avatar');
      const nameEl  = document.getElementById('profile-name');
      const emailEl = document.getElementById('profile-email');
      if (avatarEl) avatarEl.textContent = initials;
      if (nameEl)  nameEl.textContent  = name;
      if (emailEl) emailEl.textContent = state.user.email || '';
    }
  }
  document.getElementById('user-menu')?.classList.remove('open');
}

// ─── TOAST ───────────────────────────────────────────────────
function toast(msg, type = '') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── INIT ────────────────────────────────────────────────────
async function init() {
  try {
    await auth.restoreSession();
  } catch (e) {
    console.error('Error restaurando sesión:', e);
  }
  renderUserNav();
  await loadCategories();
  await loadTopics();

  document.addEventListener('keydown', e => {
    if (e.key === '/' && !e.target.matches('input,textarea')) {
      e.preventDefault();
      document.getElementById('search-input')?.focus();
    }
  });

  document.getElementById('topic-modal-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeTopicModal();
  });
  document.getElementById('auth-modal-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeAuthModal();
  });
  document.getElementById('propose-modal-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeProposeModal();
  });
}

document.addEventListener('DOMContentLoaded', init);
