/**
 * ============================================================
 * Aceolution LATAM — Auth Configuration
 * ============================================================
 *
 * ARQUIVO GERADO AUTOMATICAMENTE pelo painel admin-users.html.
 * NÃO EDITE MANUALMENTE — suas mudanças serão sobrescritas no
 * próximo commit feito pelo painel. Pra alterar, abra:
 *   admin-users.html (acesso restrito ao usuário "fuss")
 *
 * Última geração: 2026-05-28T02:41:06.628Z
 *
 * ⚠ NOTA DE SEGURANÇA:
 * Este é client-side ("teatro de segurança"): qualquer pessoa
 * com acesso ao GitHub Pages pode ver os hashes e tentar quebrá-los
 * por força bruta offline. Não use senhas reutilizadas em outros
 * serviços. Senhas longas e únicas mitigam o risco.
 *
 * ============================================================
 */

// ----------------------------------------------------------------
// LISTA DE USUÁRIOS
// ----------------------------------------------------------------
const USERS = [
  {
    username: "fuss",
    passwordHash: "20fc17a5b2949b22e408a7f0748a07c46833654638dd6f4ae744ba74c3af476a",
    fullName: "Fuss",
  },
  {
    username: "pankaj",
    passwordHash: "473dcd19b98e413a24dfda72e73960d02ba47f6319122285a8a00a6741f196ec",
    fullName: "Pankaj",
  },
  {
    username: "bia",
    passwordHash: "473dcd19b98e413a24dfda72e73960d02ba47f6319122285a8a00a6741f196ec",
    fullName: "Bia",
  },
  {
    username: "lucas",
    passwordHash: "473dcd19b98e413a24dfda72e73960d02ba47f6319122285a8a00a6741f196ec",
    fullName: "Outro Lucas",
  },
  {
    username: "payroll",
    passwordHash: "946ef4dd0fb666f73883b6a3de531857d91e97769d540be3d5b2d2fec900606b",
    fullName: "Payroll",
  },
  {
    username: "reshma",
    passwordHash: "ebaaa905d5a450b9f6d37ca76516127e3edfc491d439ce106a9e2a12110d8c37",
    fullName: "Reshma",
  },
];

// ----------------------------------------------------------------
// USUÁRIOS COM PRIVILÉGIO ADMIN
// (veem o botão ⚙ Admin no dashboard e seções restritas)
// ----------------------------------------------------------------
const ADMIN_USERNAMES = ["fuss"];

// ----------------------------------------------------------------
// HELPER: SHA-256 hash (compatível com browser moderno)
// ----------------------------------------------------------------
async function sha256(text) {
  const buffer = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ----------------------------------------------------------------
// HELPER: validar credenciais
// Retorna o objeto user em caso de sucesso, null em falha.
// ----------------------------------------------------------------
async function validateLogin(username, password) {
  if (!username || !password) return null;
  const passwordHash = await sha256(password);
  const u = (username || '').trim().toLowerCase();
  return USERS.find(x =>
    x.username.toLowerCase() === u && x.passwordHash === passwordHash
  ) || null;
}

// ----------------------------------------------------------------
// HELPER: checa se um username tem privilégio admin
// ----------------------------------------------------------------
function isAdmin(username) {
  if (!username) return false;
  return ADMIN_USERNAMES.indexOf(String(username).toLowerCase()) >= 0;
}

// ----------------------------------------------------------------
// SESSION: SSO cross-page via localStorage (8h TTL)
// ----------------------------------------------------------------
const SESSION_KEY = 'aceolution_latam_session';
const SESSION_TTL_HOURS = 8;

function saveSession(user) {
  if (!user || !user.username) return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      username: user.username,
      fullName: user.fullName || user.username,
      expiresAt: Date.now() + SESSION_TTL_HOURS * 3600 * 1000,
    }));
  } catch (e) { /* localStorage indisponível */ }
}

// Retorna {username, fullName} se sessão válida, null caso contrário.
// Re-valida que o user ainda existe em USERS (caso auth_teste.js tenha mudado).
function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.username || !s.expiresAt || Date.now() > s.expiresAt) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    const u = USERS.find(x => x.username.toLowerCase() === String(s.username).toLowerCase());
    return u ? { username: u.username, fullName: u.fullName } : null;
  } catch (e) { return null; }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
}
