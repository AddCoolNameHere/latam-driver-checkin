/**
 * ============================================================
 * Aceolution LATAM — Common helpers
 * ============================================================
 *
 * Funções compartilhadas entre todas as páginas. Reduz duplicação
 * de login screen, topbar e fetch caching.
 *
 * Exporta no escopo global:
 *   - cachedFetch(url, ttlSec, opts)  →  GET com cache em localStorage
 *   - clearDataCache(prefix?)         →  invalida cache (tudo ou por prefix)
 *   - injectLogin(opts)               →  renderiza tela de login + auto-login
 *   - injectTopbar(opts)              →  renderiza topbar com user pill + ações
 *
 * Depende: auth.js (validateLogin, saveSession, loadSession, clearSession,
 *          isAdmin) + theme.css (estilos .login-screen, .topbar etc).
 * ============================================================
 */

// =============================================================
// 1) FETCH COM CACHE LOCAL
// =============================================================
const AC_CACHE_PREFIX = 'AC_CACHE_';

/**
 * GET com cache em localStorage.
 *
 * @param {string} url - URL completa (já com query params)
 * @param {number} ttlSec - TTL em segundos (300 = 5min)
 * @param {object} [opts]
 * @param {boolean} [opts.forceRefresh] - ignora cache e refaz fetch
 * @param {number} [opts.timeoutMs] - aborta o fetch após N ms (default sem timeout)
 * @returns {Promise<object>} - resposta JSON; tem flag `_fromCache: true` se veio do cache
 */
async function cachedFetch(url, ttlSec, opts) {
  opts = opts || {};
  const key = AC_CACHE_PREFIX + url;

  if (!opts.forceRefresh) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const c = JSON.parse(raw);
        if (c && c.expiresAt > Date.now() && c.data) {
          c.data._fromCache = true;
          return c.data;
        }
      }
    } catch (e) { /* ignore */ }
  } else {
    try { localStorage.removeItem(key); } catch (e) {}
  }

  // Fetch (com timeout opcional via AbortController)
  let res;
  try {
    if (opts.timeoutMs && typeof AbortController !== 'undefined') {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
      try {
        res = await fetch(url, { signal: ctrl.signal }).then(r => r.json());
      } finally {
        clearTimeout(timer);
      }
    } else {
      res = await fetch(url).then(r => r.json());
    }
  } catch (err) {
    // staleOnError: se a busca falhou (timeout/rede), devolve o ÚLTIMO cache salvo
    // (mesmo VENCIDO) marcado com _stale:true, em vez de quebrar. Evita tela vazia.
    if (opts.staleOnError) {
      try {
        const rawOld = localStorage.getItem(key);
        if (rawOld) {
          const old = JSON.parse(rawOld);
          if (old && old.data) {
            old.data._fromCache = true;
            old.data._stale = true;
            return old.data;
          }
        }
      } catch (e) { /* sem cache pra cair — segue pro throw */ }
    }
    throw err;
  }

  // Só faz cache de respostas success — não cacheia erros
  if (res && res.success !== false) {
    try {
      localStorage.setItem(key, JSON.stringify({
        data: res,
        expiresAt: Date.now() + ttlSec * 1000,
      }));
    } catch (e) {
      clearDataCache();
      try {
        localStorage.setItem(key, JSON.stringify({
          data: res,
          expiresAt: Date.now() + ttlSec * 1000,
        }));
      } catch (e2) { /* desisto */ }
    }
  }
  return res;
}

/** Limpa todas as entradas de cache (ou por prefix opcional adicional) */
function clearDataCache(extraPrefix) {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(AC_CACHE_PREFIX)) continue;
      if (extraPrefix && !k.includes(extraPrefix)) continue;
      keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
}


// =============================================================
// 2) LOGIN SCREEN
// =============================================================
const ACE_LOGIN_I18N = {
  pt: { user: 'Usuário', pass: 'Senha', submit: 'Entrar', checking: 'Verificando…',
        empty: 'Preencha usuário e senha', invalid: 'Usuário ou senha inválidos',
        generic: 'Erro ao fazer login' },
  es: { user: 'Usuario', pass: 'Contraseña', submit: 'Entrar', checking: 'Verificando…',
        empty: 'Complete usuario y contraseña', invalid: 'Usuario o contraseña inválidos',
        generic: 'Error al iniciar sesión' },
  en: { user: 'Username', pass: 'Password', submit: 'Sign in', checking: 'Verifying…',
        empty: 'Enter username and password', invalid: 'Invalid username or password',
        generic: 'Login error' },
};

/**
 * Renderiza tela de login fullscreen e wireia o handler de submit.
 * Auto-loga se já tiver sessão válida.
 *
 * @param {object} opts
 * @param {string} opts.title - Título da tela (ex: 'Admin Hub')
 * @param {string} [opts.sub] - Subtítulo opcional
 * @param {function} opts.onSuccess - callback(user) — chamado quando logado com sucesso
 * @param {string} [opts.lang] - 'pt' | 'es' | 'en' (default 'pt')
 * @param {string} [opts.superAdminGate] - se setado, só esse username (lowercase) passa
 * @param {boolean} [opts.adminGate] - se true, só usuários em ADMIN_USERNAMES (isAdmin) passam
 */
function injectLogin(opts) {
  const lang = opts.lang || 'pt';
  const i18n = ACE_LOGIN_I18N[lang] || ACE_LOGIN_I18N.pt;

  // Gate de acesso: superAdminGate (username específico) > adminGate (isAdmin) > livre.
  // Reaproveitável; quando houver sistema de cargos, dá pra estender aqui (ex: opts.requireRole).
  function gatePasses(username) {
    const u = String(username || '').toLowerCase();
    if (opts.superAdminGate) return u === String(opts.superAdminGate).toLowerCase();
    if (opts.adminGate) return (typeof isAdmin === 'function') && isAdmin(u);
    return true;
  }
  const GATE_DENIED = {
    pt: 'Acesso restrito a administradores',
    es: 'Acceso restringido a administradores',
    en: 'Restricted to administrators',
  };
  const deniedMsg = opts.superAdminGate ? 'Acesso restrito ao super admin' : (GATE_DENIED[lang] || GATE_DENIED.pt);

  // Auto-login se sessão válida (e passa do gate se aplicável)
  const saved = (typeof loadSession === 'function') ? loadSession() : null;
  if (saved) {
    if (gatePasses(saved.username)) {
      Promise.resolve().then(() => opts.onSuccess(saved));
      return;
    }
  }

  // Cria o DOM
  const screen = document.createElement('div');
  screen.className = 'ac-login-screen';
  screen.innerHTML = `
    <div class="ac-login-card">
      <img src="https://aceolution.com/img/logo2.png" alt="Aceolution" class="ac-login-logo">
      <div class="ac-login-title">${escapeHtml(opts.title || 'Aceolution LATAM')}</div>
      <div class="ac-login-sub">${escapeHtml(opts.sub || '')}</div>
      <form>
        <label>${i18n.user}</label>
        <input type="text" id="ac-login-user" required autofocus autocomplete="username">
        <label>${i18n.pass}</label>
        <input type="password" id="ac-login-pass" required autocomplete="current-password">
        <button type="submit" class="ac-login-btn">${i18n.submit}</button>
        <div class="ac-login-error"></div>
      </form>
    </div>
  `;
  document.body.appendChild(screen);

  const form = screen.querySelector('form');
  const userEl = screen.querySelector('#ac-login-user');
  const passEl = screen.querySelector('#ac-login-pass');
  const btn = screen.querySelector('.ac-login-btn');
  const err = screen.querySelector('.ac-login-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = userEl.value.trim().toLowerCase();
    const p = passEl.value;
    err.textContent = '';
    err.classList.remove('visible');
    if (!u || !p) {
      err.textContent = i18n.empty;
      err.classList.add('visible');
      return;
    }
    btn.disabled = true; btn.textContent = i18n.checking;
    try {
      const user = await validateLogin(u, p);
      if (!user) {
        await new Promise(r => setTimeout(r, 350));
        err.textContent = i18n.invalid;
        err.classList.add('visible');
        passEl.value = '';
        passEl.focus();
        btn.disabled = false; btn.textContent = i18n.submit;
        return;
      }
      // Gate de acesso (super admin / admin)
      if (!gatePasses(user.username)) {
        err.textContent = deniedMsg;
        err.classList.add('visible');
        btn.disabled = false; btn.textContent = i18n.submit;
        return;
      }
      saveSession(user);
      screen.remove();
      opts.onSuccess(user);
    } catch (e2) {
      err.textContent = i18n.generic + ' — ' + e2.message;
      err.classList.add('visible');
      btn.disabled = false; btn.textContent = i18n.submit;
    }
  });
}

/**
 * Loga out do user atual e recarrega a página (cleanup mais simples).
 * Limpa também cache de dados.
 */
function aceLogout(confirmText) {
  if (confirmText && !confirm(confirmText)) return;
  try { clearSession(); } catch (e) {}
  clearDataCache();
  if (typeof removeThemeToggle === 'function') removeThemeToggle();
  location.reload();
}


// =============================================================
// 3) TOPBAR
// =============================================================
const ACE_TOPBAR_I18N = {
  pt: { logout: 'Sair', confirmLogout: 'Sair?', back: '← Hub', refresh: 'Atualizar' },
  es: { logout: 'Salir', confirmLogout: '¿Salir?', back: '← Hub', refresh: 'Actualizar' },
  en: { logout: 'Sign out', confirmLogout: 'Sign out?', back: '← Hub', refresh: 'Refresh' },
};

/**
 * Renderiza o topbar. Cria o elemento e injeta no início do body
 * (ou em opts.mount se passado).
 *
 * @param {object} opts
 * @param {string} opts.region - texto da region (ex: 'LATAM · DASHBOARD')
 * @param {object} opts.user - { username, fullName }
 * @param {boolean} [opts.showBack=true] - mostra link "← Hub"
 * @param {boolean} [opts.showLangSwitch=false] - mostra PT/ES/EN
 * @param {string} [opts.lang='pt'] - idioma corrente
 * @param {function} [opts.onLangChange] - callback(lang)
 * @param {function} [opts.onRefresh] - se setado, mostra botão ⟳ que chama essa fn (refresh manual)
 * @param {Array} [opts.extras] - [{ html, onClick, className }] botões extras antes do user pill
 * @param {HTMLElement} [opts.mount] - elemento alvo (default: prepend no body)
 * @returns {HTMLElement} — o nó do topbar
 */
function injectTopbar(opts) {
  const lang = opts.lang || 'pt';
  const i18n = ACE_TOPBAR_I18N[lang] || ACE_TOPBAR_I18N.pt;
  const showBack = opts.showBack !== false;
  const showLang = opts.showLangSwitch === true;

  const initials = (opts.user && opts.user.fullName)
    ? opts.user.fullName.split(' ').map(s => s[0] || '').slice(0, 2).join('').toUpperCase()
    : '?';

  const topbar = document.createElement('header');
  topbar.className = 'ac-topbar';
  topbar.innerHTML = `
    <div class="ac-brand">
      <img src="https://aceolution.com/img/logo2.png" alt="Aceolution" class="ac-brand-logo">
      <div class="ac-brand-divider"></div>
      <span class="ac-brand-region"></span>
    </div>
    <div class="ac-topbar-right">
      ${showLang ? `<div class="ac-lang-switch">
        <button type="button" data-lang="pt">PT</button>
        <button type="button" data-lang="es">ES</button>
        <button type="button" data-lang="en">EN</button>
      </div>` : ''}
      ${showBack ? `<a class="ac-back-link" href="admin.html">${escapeHtml(i18n.back)}</a>` : ''}
      <span class="ac-extras-slot"></span>
      <div class="ac-user-pill">
        <div class="ac-user-avatar"></div>
        <span class="ac-user-name"></span>
      </div>
      <button type="button" class="ac-logout-btn"></button>
    </div>
  `;

  // Fill in dynamic content
  topbar.querySelector('.ac-brand-region').textContent = opts.region || '';
  topbar.querySelector('.ac-user-avatar').textContent = initials;
  topbar.querySelector('.ac-user-name').textContent = (opts.user && opts.user.fullName) || '—';
  topbar.querySelector('.ac-logout-btn').textContent = i18n.logout;

  // Wire logout
  topbar.querySelector('.ac-logout-btn').addEventListener('click', () => {
    aceLogout(i18n.confirmLogout);
  });

  // Lang switch
  if (showLang && opts.onLangChange) {
    const langButtons = topbar.querySelectorAll('.ac-lang-switch button');
    langButtons.forEach(b => {
      if (b.dataset.lang === lang) b.classList.add('active');
      b.addEventListener('click', () => {
        const newLang = b.dataset.lang;
        langButtons.forEach(x => x.classList.toggle('active', x.dataset.lang === newLang));
        opts.onLangChange(newLang);
      });
    });
  }

  // Extras
  const extrasSlot = topbar.querySelector('.ac-extras-slot');

  // Botão de refresh (opcional) — recarrega os dados da página sob demanda.
  // Fica antes dos extras pra ter posição consistente entre páginas.
  if (typeof opts.onRefresh === 'function') {
    const rbtn = document.createElement('button');
    rbtn.type = 'button';
    rbtn.className = 'ac-topbar-btn ac-refresh-btn';
    rbtn.innerHTML = '⟳';
    rbtn.title = i18n.refresh;
    rbtn.setAttribute('aria-label', i18n.refresh);
    rbtn.addEventListener('click', () => opts.onRefresh());
    extrasSlot.appendChild(rbtn);
  }

  if (Array.isArray(opts.extras)) {
    opts.extras.forEach(ext => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ac-topbar-btn' + (ext.className ? ' ' + ext.className : '');
      btn.innerHTML = ext.html || '';
      if (ext.onClick) btn.addEventListener('click', ext.onClick);
      extrasSlot.appendChild(btn);
    });
  }

  // Mount
  const target = opts.mount || document.body;
  if (target === document.body) {
    target.insertBefore(topbar, target.firstChild);
  } else {
    target.appendChild(topbar);
  }
  return topbar;
}


// =============================================================
// Helpers internos
// =============================================================
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
