// ─── CONFIG ──────────────────────────────────────────────────
// En Railway, el frontend Y PocketBase corren en el mismo origen.
// window.location.origin funciona automáticamente en cualquier dominio.
const SUPABASE_URL      = 'https://qnzlmgqchmffnrlfljrf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fioeWGpnQ-2eSkn_VhivIA_K8O_iMKN';

// ─── STATE ───────────────────────────────────────────────────
const state = {
  user: null,
  currentCategory: 'all',
  currentSort: 'trending',
  topics: [],
  categories: [],
  page: 1,
  loading: false,
  openTopic: null,
};

// ─── PocketBase API helpers ───────────────────────────────────
const pb = {
  token: () => localStorage.getItem('pb_token'),

  headers(extra = {}) {
    const h = { 'Content-Type': 'application/json', ...extra };
    if (this.token()) h['Authorization'] = this.token();
    return h;
  },

  async request(method, path, body = null) {
    const opts = { method, headers: this.headers() };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${PB_URL}/api/${path}`, opts);
    const data = await res.json();
    if (!res.ok) throw data;
    return data;
  },

  async get(path)         { return this.request('GET', path); },
  async post(path, body)  { return this.request('POST', path, body); },
  async patch(path, body) { return this.request('PATCH', path, body); },
  async delete(path)      { return this.request('DELETE', path); },

  // Auth
  async loginWithGoogle() {
    const res = await fetch(`${PB_URL}/api/collections/users/auth-methods`);
    const data = await res.json();
    const google = data.authProviders?.find(p => p.name === 'google');
    if (!google) { toast('Google OAuth no configurado en PocketBase', 'error'); return; }
    localStorage.setItem('pb_oauth_state', google.state);
    localStorage.setItem('pb_oauth_verifier', google.codeVerifier);
    window.location.href = google.authUrl + encodeURIComponent(window.location.origin + '/oauth');
  },

  async loginWithEmail(email, password) {
    const data = await this.post('collections/users/auth-with-password', { identity: email, password });
    this.saveAuth(data);
    return data;
  },

  async register(email, password, name) {
    const user = await this.post('collections/users/records', {
      email, password, passwordConfirm: password, name, username: email.split('@')[0]
    });
    return this.loginWithEmail(email, password);
  },

  saveAuth(data) {
    localStorage.setItem('pb_token', data.token);
    localStorage.setItem('pb_user', JSON.stringify(data.record));
    state.user = data.record;
    renderUserNav();
  },

  logout() {
    localStorage.removeItem('pb_token');
    localStorage.removeItem('pb_user');
    state.user = null;
    renderUserNav();
    toast('Sesión cerrada');
  },

  restoreAuth() {
    const token = localStorage.getItem('pb_token');
    const user  = localStorage.getItem('pb_user');
    if (token && user) {
      state.user = JSON.parse(user);
      renderUserNav();
    }
  },

  // Collections
  async getCategories() {
    return this.get('collections/categories/records?sort=order&perPage=100');
  },

  async getTopics({ category = 'all', sort = 'trending', search = '', page = 1 } = {}) {
    const filters = ['status="published"'];
    if (category !== 'all') filters.push(`category="${category}"`);
    if (search) filters.push(`(title~"${search}" || subtopic~"${search}")`);
    const filter = filters.join(' && ');
    const sortMap = { trending: '-votes_up', newest: '-created', top: '-rating_avg', controversial: '-votes_total' };
    const sortField = sortMap[sort] || '-votes_up';
    return this.get(`collections/topics/records?filter=${encodeURIComponent(filter)}&sort=${sortField}&page=${page}&perPage=20&expand=category`);
  },

  async getTopic(id) {
    return this.get(`collections/topics/records/${id}?expand=category`);
  },

  async getMyVote(topicId) {
    if (!state.user) return null;
    try {
      const res = await this.get(`collections/votes/records?filter=${encodeURIComponent(`user="${state.user.id}" && topic="${topicId}"`)}&perPage=1`);
      return res.items?.[0] || null;
    } catch { return null; }
  },

  async getMyRating(topicId) {
    if (!state.user) return null;
    try {
      const res = await this.get(`collections/ratings/records?filter=${encodeURIComponent(`user="${state.user.id}" && topic="${topicId}"`)}&perPage=1`);
      return res.items?.[0] || null;
    } catch { return null; }
  },

  async getMyComment(topicId) {
    if (!state.user) return null;
    try {
      const res = await this.get(`collections/comments/records?filter=${encodeURIComponent(`user="${state.user.id}" && topic="${topicId}"`)}&perPage=1`);
      return res.items?.[0] || null;
    } catch { return null; }
  },

  async getComments(topicId) {
    return this.get(`collections/comments/records?filter=${encodeURIComponent(`topic="${topicId}"`)}&sort=-created&expand=user&perPage=50`);
  },

  async vote(topicId, value) {
    if (!state.user) { openAuthModal(); return; }
    const existing = await this.getMyVote(topicId);
    if (existing) {
      if (existing.value === value) {
        await this.delete(`collections/votes/records/${existing.id}`);
        toast('Voto retirado');
      } else {
        await this.patch(`collections/votes/records/${existing.id}`, { value });
        toast('Voto actualizado');
      }
    } else {
      await this.post('collections/votes/records', { user: state.user.id, topic: topicId, value });
      toast('¡Votado!', 'success');
    }
    return await this.recalcTopic(topicId);
  },

  async rate(topicId, value) {
    if (!state.user) { openAuthModal(); return; }
    const existing = await this.getMyRating(topicId);
    if (existing) {
      await this.patch(`collections/ratings/records/${existing.id}`, { value });
      toast('Valoración actualizada');
    } else {
      await this.post('collections/ratings/records', { user: state.user.id, topic: topicId, value });
      toast('¡Valorado!', 'success');
    }
    return await this.recalcTopic(topicId);
  },

  async comment(topicId, text) {
    if (!state.user) { openAuthModal(); return; }
    const existing = await this.getMyComment(topicId);
    if (existing) { toast('Ya has comentado en este tema', 'error'); return null; }
    const comment = await this.post('collections/comments/records', {
      user: state.user.id, topic: topicId, text
    });
    // Update comment count
    const topic = await this.getTopic(topicId);
    await this.patch(`collections/topics/records/${topicId}`, {
      comments_count: (topic.comments_count || 0) + 1
    });
    toast('Comentario publicado', 'success');
    return comment;
  },

  async recalcTopic(topicId) {
    const votes = await this.get(`collections/votes/records?filter=${encodeURIComponent(`topic="${topicId}"`)}&perPage=500`);
    // Note: recalc is done server-side via PocketBase hooks in production
    // Here we just return the updated topic
    return await this.getTopic(topicId);
  },

  async proposeTopic(data) {
    if (!state.user) { openAuthModal(); return; }
    return this.post('collections/topics/records', {
      ...data,
      author: state.user.id,
      status: 'pending',
      votes_up: 0, votes_down: 0, votes_total: 0,
      rating_avg: 0, rating_count: 0,
      comments_count: 0
    });
  },

  // Admin
  async getPendingTopics() {
    return this.get(`collections/topics/records?filter=${encodeURIComponent('status="pending"')}&sort=-created&perPage=100`);
  },

  async approveTopic(id) {
    return this.patch(`collections/topics/records/${id}`, { status: 'published' });
  },

  async rejectTopic(id) {
    return this.delete(`collections/topics/records/${id}`);
  },
};

// ─── RENDER HELPERS ───────────────────────────────────────────
function renderUserNav() {
  const navRight = document.getElementById('nav-right');
  if (!navRight) return;
  if (state.user) {
    const initials = (state.user.name || state.user.email || '?').slice(0, 2).toUpperCase();
    navRight.innerHTML = `
      <div class="user-avatar" onclick="toggleUserMenu()" id="user-avatar-btn">
        ${state.user.avatarUrl
          ? `<img src="${state.user.avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
          : initials}
        <div class="user-menu" id="user-menu">
          <a onclick="showPage('profile')">Mi perfil</a>
          ${state.user.isAdmin ? `<a onclick="showPage('admin')">Panel admin</a>` : ''}
          <div class="divider"></div>
          <a onclick="pb.logout()">Cerrar sesión</a>
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
  const rating = topic.rating_avg ? topic.rating_avg.toFixed(1) : '—';
  const catName = topic.expand?.category?.name || topic.category || '';
  return `
    <div class="topic-card" onclick="openTopicModal('${topic.id}')">
      <div class="card-meta">
        <span class="card-cat-badge">${catName}</span>
        ${topic.subtopic ? `<span style="color:var(--small)">› ${topic.subtopic}</span>` : ''}
        <span style="margin-left:auto">${timeAgo(topic.created)}</span>
      </div>
      <div class="card-title">${topic.title}</div>
      <div class="card-actions">
        <button class="vote-btn up" onclick="event.stopPropagation(); quickVote('${topic.id}', 'up', this)">
          👍 ${topic.votes_up || 0}
        </button>
        <div class="vote-bar">
          <div class="vote-bar-fill" style="width:${up}%"></div>
        </div>
        <button class="vote-btn down" onclick="event.stopPropagation(); quickVote('${topic.id}', 'down', this)">
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
        <span class="cat-count">${state.topics.length}</span>
      </a>
    </li>`;
  const items = categories.map(c => `
    <li class="cat-item">
      <a href="#" class="${state.currentCategory === c.id ? 'active' : ''}" onclick="filterCategory('${c.id}', event)">
        <span class="cat-icon">${c.icon || '📂'}</span> ${c.name}
        <span class="cat-count">${c.topics_count || ''}</span>
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
  if (append) grid.innerHTML += html;
  else grid.innerHTML = html;
}

function showSkeletons() {
  const grid = document.getElementById('topics-grid');
  if (!grid) return;
  grid.innerHTML = Array(6).fill(`<div class="skeleton skeleton-card"></div>`).join('');
}

// ─── DATA LOADING ─────────────────────────────────────────────
async function loadTopics(append = false) {
  if (state.loading) return;
  state.loading = true;
  if (!append) showSkeletons();
  try {
    const res = await pb.getTopics({
      category: state.currentCategory,
      sort: state.currentSort,
      search: document.getElementById('search-input')?.value || '',
      page: state.page,
    });
    const newTopics = res.items || [];
    if (append) state.topics = [...state.topics, ...newTopics];
    else state.topics = newTopics;
    renderTopics(state.topics, false);
    updateTicker();
  } catch (e) {
    console.error(e);
    if (!append) renderTopicsError();
  } finally {
    state.loading = false;
  }
}

function renderTopicsError() {
  const grid = document.getElementById('topics-grid');
  if (grid) grid.innerHTML = `
    <div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">⚠️</div>
      <h3>No se pudo conectar</h3>
      <p>Verifica que PocketBase está corriendo en <strong>${PB_URL}</strong></p>
    </div>`;
}

async function loadCategories() {
  try {
    const res = await pb.getCategories();
    state.categories = res.items || [];
    renderCategories(state.categories);
    populateCategorySelects();
  } catch {
    state.categories = [];
  }
}

function populateCategorySelects() {
  ['propose-category', 'admin-category-filter'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `<option value="">Selecciona categoría</option>` +
      state.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  });
}

function updateTicker() {
  const track = document.getElementById('ticker-track');
  if (!track || !state.topics.length) return;
  const items = [...state.topics, ...state.topics].map(t =>
    `<span class="ticker-item"><strong>${t.title}</strong> 👍${t.votes_up || 0} · ⭐${t.rating_avg?.toFixed(1) || '—'}</span>`
  ).join('');
  track.innerHTML = items;
}

// ─── INTERACTIONS ─────────────────────────────────────────────
async function quickVote(topicId, value, btn) {
  if (!state.user) { openAuthModal(); return; }
  btn.style.opacity = '0.5';
  try {
    await pb.vote(topicId, value);
    await loadTopics();
  } finally {
    btn.style.opacity = '1';
  }
}

// ─── MODAL ───────────────────────────────────────────────────
async function openTopicModal(topicId) {
  const overlay = document.getElementById('topic-modal-overlay');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Loading state
  document.getElementById('modal-content').innerHTML = `
    <div style="text-align:center;padding:3rem;color:var(--muted)">Cargando...</div>`;

  try {
    const [topic, comments, myVote, myRating, myComment] = await Promise.all([
      pb.getTopic(topicId),
      pb.getComments(topicId),
      pb.getMyVote(topicId),
      pb.getMyRating(topicId),
      pb.getMyComment(topicId),
    ]);
    state.openTopic = topic;
    renderTopicModal(topic, comments.items || [], myVote, myRating, myComment);
  } catch (e) {
    document.getElementById('modal-content').innerHTML = `
      <p style="color:var(--down)">Error al cargar el tema.</p>`;
  }
}

function renderTopicModal(topic, comments, myVote, myRating, myComment) {
  const up = pctUp(topic);
  const catName = topic.expand?.category?.name || topic.category || '';
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
      <span style="font-size:0.78rem;color:var(--small)">${timeAgo(topic.created)}</span>
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
          ${topic.rating_avg ? topic.rating_avg.toFixed(1) : '—'}
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
                <div class="comment-avatar">${(c.expand?.user?.name || '?').slice(0,2).toUpperCase()}</div>
                <span class="comment-name">${c.expand?.user?.name || 'Usuario'}</span>
                <span class="comment-date">${timeAgo(c.created)}</span>
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
  await pb.vote(state.openTopic.id, value);
  await openTopicModal(state.openTopic.id);
  loadTopics();
}

async function modalRate() {
  if (!state.user) { openAuthModal(); return; }
  if (!state.openTopic) return;
  const val = parseInt(document.getElementById('modal-rating-input').value);
  await pb.rate(state.openTopic.id, val);
  await openTopicModal(state.openTopic.id);
  loadTopics();
}

async function modalComment() {
  if (!state.user) { openAuthModal(); return; }
  if (!state.openTopic) return;
  const text = document.getElementById('comment-textarea')?.value?.trim();
  if (!text) { toast('Escribe algo antes de publicar', 'error'); return; }
  await pb.comment(state.openTopic.id, text);
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
    await pb.loginWithEmail(email, pass);
    closeAuthModal();
    toast('¡Bienvenido!', 'success');
  } catch (e) {
    toast(e.message || 'Credenciales incorrectas', 'error');
  } finally { btn.textContent = 'Entrar'; btn.disabled = false; }
}

async function submitRegister() {
  const name  = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass  = document.getElementById('reg-pass').value;
  if (!name || !email || !pass) { toast('Rellena todos los campos', 'error'); return; }
  const btn = document.getElementById('reg-btn');
  btn.textContent = 'Creando cuenta...'; btn.disabled = true;
  try {
    await pb.register(email, pass, name);
    closeAuthModal();
    toast('¡Cuenta creada!', 'success');
  } catch (e) {
    toast(e.message || 'Error al registrar', 'error');
  } finally { btn.textContent = 'Crear cuenta'; btn.disabled = false; }
}

function showAuthTab(tab) {
  document.getElementById('auth-login').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('auth-register').style.display = tab === 'register' ? 'block' : 'none';
  document.querySelectorAll('.auth-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
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
    await pb.proposeTopic({ title, category, subtopic, description: desc });
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
    const res = await pb.getPendingTopics();
    const topics = res.items || [];
    if (topics.length === 0) {
      el.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--small)">Sin propuestas pendientes ✓</td></tr>`;
      return;
    }
    el.innerHTML = topics.map(t => `
      <tr>
        <td>${t.title}</td>
        <td>${t.category || '—'}</td>
        <td>${t.subtopic || '—'}</td>
        <td><span class="badge badge-pending">Pendiente</span></td>
        <td style="display:flex;gap:0.5rem">
          <button class="btn-approve" onclick="adminApprove('${t.id}')">✓ Aprobar</button>
          <button class="btn-reject" onclick="adminReject('${t.id}')">✕ Rechazar</button>
        </td>
      </tr>`).join('');
  } catch {
    el.innerHTML = `<tr><td colspan="5" style="color:var(--down);padding:1rem">Error de carga. ¿Eres admin?</td></tr>`;
  }
}

async function adminApprove(id) {
  await pb.approveTopic(id);
  toast('Tema publicado', 'success');
  loadAdminPanel();
  loadTopics();
}

async function adminReject(id) {
  if (!confirm('¿Rechazar y eliminar esta propuesta?')) return;
  await pb.rejectTopic(id);
  toast('Propuesta rechazada');
  loadAdminPanel();
}

function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  const el = document.getElementById(`page-${page}`);
  if (el) {
    el.style.display = 'block';
    if (page === 'admin') loadAdminPanel();
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
  pb.restoreAuth();
  renderUserNav();
  await loadCategories();
  await loadTopics();

  // Keyboard shortcut: '/' focuses search
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !e.target.matches('input,textarea')) {
      e.preventDefault();
      document.getElementById('search-input')?.focus();
    }
  });

  // Close modals on overlay click
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

document.addEventListener('DOMContentLoaded', () => {
  init();

  // Sobrescribir showPage para poblar el perfil
  const _origShowPage = showPage;
  window.showPage = function(page) {
    _origShowPage(page);
    if (page === 'profile' && state.user) {
      const initials = (state.user.name || '?').slice(0, 2).toUpperCase();
      const el = document.getElementById('profile-avatar');
      const nameEl  = document.getElementById('profile-name');
      const emailEl = document.getElementById('profile-email');
      if (el)      el.textContent = initials;
      if (nameEl)  nameEl.textContent  = state.user.name  || 'Sin nombre';
      if (emailEl) emailEl.textContent = state.user.email || '';
    }
  };
});
