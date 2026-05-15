/**
 * ============================================================
 * Aceolution LATAM — Auth Configuration
 * ============================================================
 *
 * Arquivo central de configuração de usuários para todas as páginas
 * (dashboard.html, ramp.html, driver-profile.html).
 *
 * COMO ADICIONAR/REMOVER/EDITAR USUÁRIOS:
 * ----------------------------------------------------------------
 *
 * 1. Para gerar um hash SHA-256 de uma senha nova:
 *    - Abra `auth-helper.html` no browser (também no GitHub)
 *    - Cole a senha em texto plano
 *    - Copie o hash gerado
 *
 * 2. Adicionar usuário:
 *    - Adicione um objeto novo no array USERS abaixo seguindo o
 *      padrão: { username, passwordHash, fullName }
 *    - O `username` é case-insensitive no login
 *
 * 3. Remover usuário:
 *    - Apague a linha correspondente do array USERS
 *
 * 4. Mudar senha de um usuário:
 *    - Gere o novo hash em auth-helper.html
 *    - Substitua o `passwordHash` no array
 *
 * 5. Tornar alguém admin (vê o painel ⚙ Admin no dashboard):
 *    - Adicione o `username` (lowercase) ao array ADMIN_USERNAMES
 *
 * 6. Commit no GitHub. Aguarde 1–10 min para o GitHub Pages atualizar
 *    e force reload (Ctrl+Shift+R) no browser.
 *
 * ⚠ NOTA DE SEGURANÇA:
 * ----------------------------------------------------------------
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
    username: 'fuss',
    passwordHash: '20fc17a5b2949b22e408a7f0748a07c46833654638dd6f4ae744ba74c3af476a',
    fullName: 'Fuss',
  },
  {
    username: 'pankaj',
    passwordHash: '473dcd19b98e413a24dfda72e73960d02ba47f6319122285a8a00a6741f196ec',
    fullName: 'Pankaj',
  },
  {
    username: 'bia',
    passwordHash: 'f473dcd19b98e413a24dfda72e73960d02ba47f6319122285a8a00a6741f196ec',
    fullName: 'Bia',
  },
  {
    username: 'lucas',
    passwordHash: '473dcd19b98e413a24dfda72e73960d02ba47f6319122285a8a00a6741f196ec',
    fullName: 'Outro Lucas',
  },
];

// ----------------------------------------------------------------
// USUÁRIOS COM PRIVILÉGIO ADMIN
// (veem o botão ⚙ Admin no dashboard)
// ----------------------------------------------------------------
const ADMIN_USERNAMES = ['fuss', 'lucas'];

// ----------------------------------------------------------------
// HELPER: SHA-256 hash (compatível com browser moderno)
// Recebe string em texto plano, retorna hex hash.
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
