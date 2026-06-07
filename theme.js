/**
 * ============================================================
 * Aceolution LATAM — Theme controller
 * ============================================================
 *
 * 1. FOUC prevention: aplica data-theme="dark" no <html> ANTES
 *    de renderizar, lendo de localStorage. Esta parte roda
 *    imediatamente quando o script carrega (no <head>).
 *
 * 2. setupThemeToggle(user): chamado pelas páginas dentro de
 *    onLoginSuccess(). Injeta um botão flutuante no canto inferior
 *    direito SE o user estiver em ADMIN_USERNAMES (auth.js).
 *
 * 3. removeThemeToggle(): chamado no logout pra limpar o botão.
 *
 * O setting é salvo em localStorage.AC_THEME e respeitado entre
 * páginas e sessões. Não-admins ficam fixos no light (não vêem o
 * toggle; mas se o localStorage já tem 'dark' setado de outro
 * user no mesmo browser, eles veriam dark — edge case aceitável).
 * ============================================================
 */

(function applyStoredTheme() {
  try {
    const t = localStorage.getItem('AC_THEME');
    if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  } catch (e) { /* localStorage indisponível */ }
})();

function setupThemeToggle(user) {
  // Toggle de tema disponível pra TODOS os usuários logados (antes era só admin).
  if (document.getElementById('theme-toggle-btn')) return; // já existe
  const btn = document.createElement('button');
  btn.id = 'theme-toggle-btn';
  btn.className = 'theme-toggle-btn';
  btn.type = 'button';
  btn.title = 'Trocar tema (claro/escuro)';
  btn.setAttribute('aria-label', 'Trocar tema');
  btn.innerHTML = themeToggleIcon();
  btn.addEventListener('click', toggleTheme);
  document.body.appendChild(btn);
}

function removeThemeToggle() {
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.remove();
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('AC_THEME', 'light'); } catch (e) {}
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    try { localStorage.setItem('AC_THEME', 'dark'); } catch (e) {}
  }
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.innerHTML = themeToggleIcon();
}

function themeToggleIcon() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  // Lua quando light (clica pra escurecer), sol quando dark (clica pra clarear)
  return isDark ? '☀' : '☾';
}
