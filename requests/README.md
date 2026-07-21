# LATAM Requests — Portal de solicitações ao time LATAM

Ferramenta interna da **Aceolution do Brasil**. Páginas estáticas (HTML/JS, sem build) ligadas a uma planilha Google via Apps Script.

| Arquivo | O que é | Quem usa |
|---|---|---|
| `requests.html` | Formulário público de solicitações | Qualquer pessoa da empresa |
| `triage.html` | Triagem — designar responsável, editar e **validar** | Só o time LATAM (URL não divulgada) |
| `dashboard.html` | Painel **somente leitura** (status, ETA, responsável, atrasados) | Time / liderança (URL não divulgada) |
| `apps-script/Code.gs` | Backend (Web App + planilha) | — |

## Fluxo

1. **`requests.html`** — alguém envia uma solicitação → entra como **"pendente de triagem"** (não aparece no dashboard ainda) e **dispara email pra Bia**.
2. **`triage.html`** — o time abre o request novo, **designa responsável** (obrigatório), ajusta status/prioridade/ETA/notas e clica **"Validar"**.
3. Ao validar → o **solicitante recebe um email** (responsável + status) e o request **passa a aparecer no dashboard**.
4. **`dashboard.html`** — visão limpa pra liderança, **só leitura**. Toda edição é feita na triagem.

---

## 1. Criar o backend (uma vez)

1. Crie uma **planilha Google nova** (ex: "LATAM Requests DB").
2. **Extensões → Apps Script**. Apague o padrão e cole **todo** o `apps-script/Code.gs`.
3. Salve. Rode a função **`setup`** uma vez (cria a aba `Requests`). Autorize quando pedir.
4. **Autorize o e-mail:** rode a função **`testEmail`** uma vez. Vai pedir uma autorização extra (envio de e-mail) e mandar um teste pra Bia. Confirme que chegou.
5. **Implantar → Nova implantação → App da Web**
   - Executar como: **Eu** · Quem tem acesso: **Qualquer pessoa**
   - **Implantar** e **copie a URL** (`/exec`).

## 2. Ligar o frontend

Em **`requests.html`**, **`triage.html`** e **`dashboard.html`**, no topo do `<script>`, ponha a URL `/exec` em:

```js
const CONFIG = { scriptUrl: 'https://script.google.com/.../exec', ... };
```

Teste no browser: `SUA_URL/exec?action=ping` → JSON com `success:true`, a versão e `emailEnabled:true`.

## 3. Publicar

- **Local:** abrir os `.html` no browser já funciona.
- **Compartilhável:** GitHub Pages. Divulga só o `requests.html`; `triage.html` e `dashboard.html` ficam internos.

---

## Personalizar (no `CONFIG` do `Code.gs`)

- **`team`** — responsáveis. **Edite com a equipe real.**
- **`sla`** — dias úteis por prioridade (`Urgent:1, High:3, Normal:5, Low:10`).
- **`notify`** — `bia` (quem recebe toda nova solicitação) e `triageUrl` (link no email da Bia).
- **`categories`, `countries`, `statuses`, `priorities`** — listas (o frontend puxa via `getMeta`).

> ⚠️ **Toda vez que mudar o `Code.gs`:** Implantar → **Gerenciar implantações → ✏️ Editar → Versão: Nova versão → Implantar.** Ctrl+S **não** publica. Confira com `?action=ping` (e bumpa `CONFIG.version`).
>
> ⚠️ Se mudou algo no envio de email e der erro de permissão, rode `testEmail()` de novo no editor pra reautorizar.

---

## Modelo de dados (aba `Requests`)

`ID · Created At · Requester Name · Requester Email · Category · Subject · Description · Project · Country · Priority · Responsible · ETA · SLA Due · Status · Link · Internal Notes · Updated At · Validated · Validated At`

- **ID:** sequencial automático (`LATAM-0001`…).
- **SLA Due:** automático (Created At + dias úteis da prioridade).
- **Validated:** vazio = pendente de triagem (só na `triage.html`); `Yes` = validado (aparece no dashboard).
- **Status inicial:** `New`.

## Endpoints (Apps Script)

| Método | Ação | Retorno |
|---|---|---|
| GET | `?action=ping` | versão, total, pendentes de triagem, `emailEnabled` |
| GET | `?action=getMeta` | categorias, status, prioridades, time, SLA |
| GET | `?action=getRequests` | todas (com flag `validated`) |
| POST | `{type:'createRequest', ...}` | cria (gera ID + SLA) + email pra Bia |
| POST | `{type:'updateRequest', id, ...}` | edita campos (sem validar) |
| POST | `{type:'validateRequest', id, ...}` | exige responsável → valida + email pro solicitante |

POSTs são **fire-and-forget** (`mode:'no-cors'`).

## Validar sintaxe (antes de commitar)

```bash
# HTMLs:
node -e 'const fs=require("fs");const c=fs.readFileSync(process.argv[1],"utf8");const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;let m,js="";while((m=re.exec(c)))js+=m[1]+"\n";fs.writeFileSync("/tmp/c.js",js)' requests.html && node --check /tmp/c.js
# Apps Script:
cp apps-script/Code.gs /tmp/c.js && node --check /tmp/c.js
```
