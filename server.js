const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dbUtils = require('./utils/dbUtils');
const { categories: commandCategories } = require('./services/commands/categories');
const {
  MENU_LINK_TTL_MS,
  buildMenuUrl,
  cargarSecreto,
  createMenuLinkStore,
  createMenuTokens
} = require('./services/menuLinks');
const { FEATURED_COMMANDS_BY_GROUP } = require('./services/menuFeaturedCommands');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

const PORT = Number(process.env.PORT || 3000);
const MENU_TUNNEL_PORT = Number(process.env.MENU_TUNNEL_PORT || 3061);
const BOT_CONTROL_PORT = Number(process.env.BOT_CONTROL_PORT || 3001);
const RESTART_DELAY_MS = Number(process.env.RESTART_DELAY_MS || 5000);
const BOT_SCRIPT = process.env.BOT_SCRIPT || 'index.js';
const BOT_COMMAND = process.env.BOT_COMMAND;
const PANEL_TOKEN = process.env.PANEL_TOKEN;
const PANEL_HOST = process.env.PANEL_HOST || '127.0.0.1';
const MENU_INTERNAL_TOKEN = randomBytes(32).toString('hex');
const menuSecret = cargarSecreto(
  process.env.MENU_SECRET_FILE || path.join(os.homedir(), '.gonxta', 'menu.secret')
);
process.env.MENU_SECRET = menuSecret;
const menuTokens = createMenuTokens({ secret: menuSecret, ttlMs: MENU_LINK_TTL_MS });
const menuLinkStore = createMenuLinkStore({
  publicUrl: process.env.MENU_PUBLIC_URL,
  staticMenuUrl: process.env.MENU_STATIC_URL,
  ttlMs: MENU_LINK_TTL_MS
});
let menuTunnelProcess = null;
let menuTunnelRestartTimer = null;
if (!PANEL_TOKEN || PANEL_TOKEN.length < 32) {
  throw new Error('PANEL_TOKEN es obligatorio y debe tener al menos 32 caracteres.');
}
const LOG_LIMIT = 200;
const logs = [];
const AUDIT_LIMIT = 500;
const auditPath = path.join(__dirname, 'panel-audit.json');
const recentMemory = [];

let botProcess = null;
let botStartedAt = null;
let botConnection = 'disconnected';
let stopping = false;
let restartTimer = null;
let menuTunnelOutput = '';
function readBotPaused() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'bot-state.json'), 'utf8')).paused === true;
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('No se pudo leer el estado del bot:', error.message);
    return false;
  }
}
let botPaused = readBotPaused();
let menuTunnelState = process.env.MENU_PUBLIC_URL ? 'ready' : 'pending';
let resolveMenuTunnelReady;
const menuTunnelReady = new Promise(resolve => {
  resolveMenuTunnelReady = resolve;
});
if (menuTunnelState === 'ready') resolveMenuTunnelReady(menuTunnelState);

function setMenuTunnelState(state) {
  menuTunnelState = state;
  resolveMenuTunnelReady(state);
}

async function waitForMenuTunnel(timeoutMs = 15000) {
  if (menuTunnelState !== 'pending') return;
  let timeout;
  await Promise.race([
    menuTunnelReady,
    new Promise(resolve => { timeout = setTimeout(resolve, timeoutMs); })
  ]);
  clearTimeout(timeout);
}

function addLog(type, text) {
  const message = String(text).trim();
  if (!message) return;
  const normalizedType = type === 'out' && /\b(error|failed|failure|fall[oó]|no se pudo|exception)\b/i.test(message)
    ? 'error'
    : type;
  logs.push({ time: new Date().toISOString(), type: normalizedType, message });
  if (logs.length > LOG_LIMIT) logs.shift();
  process.stdout.write(`[bot:${type}] ${message}\n`);
}

function isAuthorized(request) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  return url.searchParams.get('token') === PANEL_TOKEN || request.headers.authorization === `Bearer ${PANEL_TOKEN}`;
}

function isInternalBotRequest(request) {
  const supplied = Buffer.from(String(request.headers['x-menu-internal-token'] || ''));
  const expected = Buffer.from(MENU_INTERNAL_TOKEN);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function startMenuTunnel() {
  if (process.env.MENU_PUBLIC_URL) {
    setMenuTunnelState('ready');
    return;
  }
  if (process.env.MENU_TUNNEL === 'false' || stopping) {
    setMenuTunnelState('disabled');
    return;
  }
  const executable = process.env.CLOUDFLARED_BIN || (process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  const tunnel = spawn(executable, ['tunnel', '--url', `http://127.0.0.1:${MENU_TUNNEL_PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  menuTunnelProcess = tunnel;

  const inspectTunnelOutput = chunk => {
    menuTunnelOutput = `${menuTunnelOutput}${String(chunk)}`.slice(-4096);
    const tunnelUrl = menuTunnelOutput.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0];
    if (tunnelUrl) {
      menuLinkStore.setPublicUrl(tunnelUrl);
      setMenuTunnelState('ready');
      console.log(`Menú interactivo disponible mediante túnel temporal: ${tunnelUrl}`);
      menuTunnelOutput = '';
    }
  };
  tunnel.stdout.on('data', inspectTunnelOutput);
  tunnel.stderr.on('data', inspectTunnelOutput);
  tunnel.once('error', error => {
    menuTunnelProcess = null;
    if (menuTunnelState === 'pending') setMenuTunnelState('failed');
    console.error(`No se pudo iniciar Cloudflare Quick Tunnel (${executable}): ${error.message}`);
  });
  tunnel.once('close', (code, signal) => {
    if (menuTunnelProcess === tunnel) menuTunnelProcess = null;
    if (menuTunnelState === 'pending') setMenuTunnelState('failed');
    else if (!process.env.MENU_PUBLIC_URL && menuTunnelState === 'ready') {
      menuLinkStore.setPublicUrl(null);
      setMenuTunnelState('failed');
    }
    if (!stopping) {
      console.warn(`El túnel temporal del menú terminó (código=${code ?? 'desconocido'}, señal=${signal || 'ninguna'}).`);
    }
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function serveMenuAsset(response) {
  fs.readFile(path.join(__dirname, 'Gonx!ta Bot.png'), (error, image) => {
    if (error) {
      console.error('No se pudo leer la imagen de Gonx!ta Bot para el menú:', error.message);
      return sendJson(response, 500, { error: 'La imagen del menú no está disponible.' });
    }
    response.writeHead(200, {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff'
    });
    response.end(image);
  });
}

function serveMenuPage(response, token) {
  if (!menuTokens.validate(token)) {
    response.writeHead(410, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff'
    });
    response.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Enlace vencido</title><body style="font:16px system-ui;background:#090b13;color:#f5f5ff;display:grid;place-items:center;min-height:90vh"><main><h1>Este enlace ya venció</h1><p>Escribe <b>.menu</b> en WhatsApp para obtener uno nuevo.</p></main></body></html>');
    return;
  }

  const expiresAt = Number(token.split('.')[1]);
  let menuHtml;
  try {
    menuHtml = fs.readFileSync(path.join(__dirname, 'menu.html'), 'utf8');
  } catch (error) {
    console.error('No se pudo leer el menú interactivo:', error.message);
    return sendJson(response, 500, { error: 'El menú interactivo no está disponible.' });
  }
  const menuData = JSON.stringify(commandCategories.map(category => ({
    name: category.name,
    commands: category.commands
  }))).replace(/</g, '\\u003c');
  const featuredCommands = JSON.stringify(FEATURED_COMMANDS_BY_GROUP).replace(/</g, '\\u003c');
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  });
  response.end(menuHtml
    .replace('__MENU_DATA__', menuData)
    .replace('__FEATURED_COMMANDS__', featuredCommands)
    .replace('__MENU_EXPIRES_AT__', JSON.stringify(expiresAt)));
}

function serveDoomPage(response, token) {
  const link = menuLinkStore.getLink(token);
  if (!link || link.page !== 'doom') {
    response.writeHead(410, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff'
    });
    response.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Partida vencida</title><body style="font:16px system-ui;background:#090b13;color:#f5f5ff;display:grid;place-items:center;min-height:90vh"><main><h1>Este enlace ya venció</h1><p>Escribe <b>.doom</b> en WhatsApp para empezar otra partida.</p></main></body></html>');
    return;
  }
  try {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    });
    response.end(fs.readFileSync(path.join(__dirname, 'doom.html')));
  } catch (error) {
    console.error('No se pudo leer el juego temporal:', error.message);
    return sendJson(response, 500, { error: 'El juego no está disponible.' });
  }
}

function handlePublicMenuRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/menu') {
    return serveMenuPage(response, url.searchParams.get('token'));
  }
  if (request.method === 'GET' && url.pathname === '/menu-assets/gonxta.png') {
    return serveMenuAsset(response);
  }
  if (request.method === 'GET' && url.pathname === '/doom') {
    return serveDoomPage(response, url.searchParams.get('token'));
  }
  return sendJson(response, 404, { error: 'Not found' });
}

const publicMenuServer = http.createServer(handlePublicMenuRequest);

function readAudit() {
  if (!fs.existsSync(auditPath)) return [];
  try {
    const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
    if (!Array.isArray(audit)) throw new Error('Formato de auditoría inválido');
    return audit.slice(-AUDIT_LIMIT);
  } catch (error) {
    addLog('error', `No se pudo leer el registro administrativo: ${error.message}`);
    return [];
  }
}

let auditEntries = readAudit();

function recordAudit(action, groupId, success, detail) {
  const entry = {
    user: 'Administrador del panel',
    action,
    group: groupId || '—',
    date: new Date().toISOString(),
    result: success ? 'success' : 'failure',
    detail: String(detail || '').slice(0, 240)
  };
  auditEntries.push(entry);
  auditEntries = auditEntries.slice(-AUDIT_LIMIT);
  try {
    dbUtils.writeAtomic(auditPath, auditEntries);
  } catch (error) {
    addLog('error', `No se pudo guardar el registro administrativo: ${error.message}`);
  }
}

function isActionAuthorized(request) {
  const host = request.headers.host;
  const origin = request.headers.origin;
  const hasBearer = request.headers.authorization === 'Bearer ' + PANEL_TOKEN;
  let sameOrigin = true;
  if (origin) {
    try {
      sameOrigin = Boolean(host && new URL(origin).host === host);
    } catch {
      sameOrigin = false;
    }
  }
  return hasBearer && sameOrigin && request.headers['content-type']?.split(';')[0].trim() === 'application/json';
}

function readDatabase() {
  return dbUtils.read();
}

function readPanelData() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'panel-data.json'), 'utf8'));
  } catch (error) {
    return { users: {}, groups: {} };
  }
}

function normalizePanelName(value, fallback) {
  const candidate = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!candidate || candidate === 'Usuario' || candidate === 'undefined' || candidate === 'null') {
    return fallback;
  }
  return candidate;
}

const PANEL_STYLE = `<style>
:root {
  color-scheme: dark;
  --bg: #171717;
  --panel: #292929;
  --panel-strong: #202020;
  --ink: #f3f3f3;
  --muted: #aaa;
  --line: #4a4a4a;
  --gold: #e5e5e5;
  --gold-2: #fff;
  --green: #59c995;
  --green-soft: #203a30;
  --red: #ed806c;
  --shadow: 0 18px 48px rgba(0, 0, 0, .28);
  --cream: #292929;
  --orange-strong: #fff;
  --orange-mid: #d8d8d8;
  --orange-soft: #aaa;
  --brown: #ddd;
}
html, body { min-height: 100%; }
body {
  min-height: 100vh;
  padding: 12px;
  font-family: Inter, "Segoe UI", Arial, sans-serif;
  background:
    radial-gradient(ellipse at 50% 0, rgba(255, 255, 255, .08), transparent 48%),
    linear-gradient(145deg, #111 0%, #1c1c1c 52%, #111 100%);
  color: var(--ink);
}
.shell {
  max-width: 1180px;
  min-height: calc(100vh - 24px);
  padding: clamp(22px, 4vw, 44px);
  border: 1px solid #424242;
  border-radius: 22px;
  background: linear-gradient(145deg, rgba(52, 52, 52, .88), rgba(27, 27, 27, .96));
  box-shadow: 0 18px 60px rgba(0, 0, 0, .4), inset 0 1px rgba(255, 255, 255, .06);
}
.top {
  align-items: center;
  padding-bottom: 24px;
  border-bottom: 1px solid rgba(255, 255, 255, .12);
}
.eyebrow { color: #aaa; letter-spacing: 3px; }
.hgroup h1 {
  color: #f5f5f5;
  font-family: Inter, "Segoe UI", Arial, sans-serif;
  letter-spacing: -.04em;
  text-transform: uppercase;
}
.status {
  background: rgba(24, 24, 24, .72);
  border-color: #505050;
  color: #ededed;
  box-shadow: inset 0 1px rgba(255, 255, 255, .05);
}
.refresh, .toggle-bot, .group-toggle {
  border: 1px solid #555;
  background: #393939;
  color: #f3f3f3;
  box-shadow: none;
  font-family: Inter, "Segoe UI", Arial, sans-serif;
}
.refresh { background: #ededed; color: #171717; border-color: #ededed; }
.refresh:hover, .toggle-bot:hover, .group-toggle:hover {
  box-shadow: 0 8px 20px rgba(0, 0, 0, .22);
}
.toggle-bot.paused, .group-toggle.off { background: #444; color: #ddd; }
.grid { gap: 14px; }
.stat, .panel {
  background: linear-gradient(145deg, rgba(61, 61, 61, .88), rgba(39, 39, 39, .92));
  border: 1px solid rgba(255, 255, 255, .13);
  border-radius: 16px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, .2), inset 0 1px rgba(255, 255, 255, .035);
  backdrop-filter: blur(8px);
}
.stat { min-height: 108px; }
.stat strong { color: #f5f5f5; }
.stat span, .panel h2 { color: #e8e8e8; }
.columns { gap: 16px; }
.panel { padding: 22px; }
.row {
  background: rgba(255, 255, 255, .035);
  border-color: rgba(255, 255, 255, .08);
}
.row.header { color: #aaa; }
.avatar {
  background: linear-gradient(145deg, #555, #333);
  color: #fff;
  border-color: rgba(255, 255, 255, .12);
}
.badge.active { background: #203a30; color: #9be3bf; border-color: #315d48; }
.badge.off { background: #432d2b; color: #f0aaa0; border-color: #65413d; }
.empty, .logs time { color: #aaa; }
.logs .row span:last-child { color: #e5e5e5; }
button { transition: background-color .16s ease, transform .16s ease, box-shadow .16s ease; }
button:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
@media (max-width: 820px) {
  body { padding: 8px; }
  .shell { min-height: calc(100vh - 16px); padding: 24px; }
}
@media (max-width: 520px) {
  .shell { padding: 20px 14px; border-radius: 16px; }
  .status-wrap { gap: 8px; flex-wrap: wrap; }
  .panel { padding: 16px; }
  .row { gap: 8px; }
}
</style>`;

const PANEL_DASHBOARD_STYLE = `<style>
body{min-height:100vh;padding:0;background:#080d1b;color:#e7ecff;font-family:Inter,"Segoe UI",Arial,sans-serif}
.shell{max-width:none;min-height:100vh;margin:0;padding:22px 28px 32px 244px;border:0;border-radius:0;background:linear-gradient(135deg,#10172a,#080d1b 65%);box-shadow:none;position:relative}
.shell:before{content:none}
.top{align-items:center;padding-bottom:17px;border-bottom:1px solid #202b46}
.eyebrow{color:#8390ad;letter-spacing:.3px;text-transform:none;font:12px Inter,"Segoe UI",sans-serif}
.hgroup h1{margin:5px 0 0;color:#e8edff;text-transform:none;font-size:clamp(1.4rem,2.4vw,2rem);letter-spacing:-.02em}
.status{color:#cbd5ef;background:#131c31;border:1px solid #253252;box-shadow:none}
.refresh,.toggle-bot,.group-toggle{color:#e7ecff;background:#18233c;border:1px solid #273657;box-shadow:none;font:12px Inter,"Segoe UI",sans-serif}
.refresh{background:#4334c8;border-color:#5949e8;color:#fff}
.grid{grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin:16px 0}
.stat,.panel{min-width:0;background:linear-gradient(150deg,#121c32,#0e172a);border:1px solid #1e2b49;border-radius:12px;box-shadow:0 8px 24px #03081766}
.stat{min-height:85px;padding:15px}
.grid{grid-template-columns:repeat(3,minmax(0,1fr))}
.stat .stat-icon{font-size:15px;line-height:1;color:#758bff}
.stat strong{font-size:clamp(1.1rem,1.8vw,1.6rem);color:#f4f6ff}
.stat span,.row.header{color:#9ba9c7;letter-spacing:0;text-transform:none;font:11px Inter,"Segoe UI",sans-serif}
.columns{grid-template-columns:minmax(0,1.2fr) minmax(270px,.8fr);gap:12px;margin-top:12px;align-items:start}
.panel{padding:16px}
.panel h2{margin:0 0 14px;color:#dce4ff;font-size:15px}
.row{grid-template-columns:minmax(0,1fr) 68px 100px;gap:6px;padding:8px;background:#111b30;border-color:#1c2945;border-radius:9px;font-size:12px}
.row.header{background:transparent;border:0;padding:5px 8px}
.avatar{width:30px;height:30px;background:#27365b;color:#c6d2ff;border:0}
.badge.active{background:#123c35;color:#66e2ac;border-color:#1e5b4c}
.badge.off{background:#3b2436;color:#f49ab9;border-color:#63334b}
.group-toggle{padding:6px 8px;border-radius:7px}
.group-toggle.off{background:#31243d;color:#efb7ff}
#usersTable{display:none!important}#systemPanel{order:2;grid-column:2;grid-row:1}
#groupsPanel{order:1;grid-column:1;grid-row:1 / span 2;width:100%}
.logs{display:block!important;grid-column:2;order:3;margin:0}
.logs .table{max-height:250px}#groupsPanel .table{max-height:520px;overflow:auto}
.logs .row{grid-template-columns:1fr;gap:3px}
.logs time,.logs .row span:last-child{color:#aebbd8}
.activity-line{display:grid;grid-template-columns:28px 1fr;gap:8px;padding:8px 0;border-bottom:1px solid #202b43;font-size:11px}
.activity-line:last-child{border-bottom:0}
.activity-icon{width:24px;height:24px;border-radius:7px;display:grid;place-items:center;background:#263867;color:#dce4ff}
.activity-line small{display:block;color:#7f8dac;margin-top:3px}
.chart-wrap{height:155px;margin-top:12px}
.chart-wrap svg{width:100%;height:100%;overflow:visible}
.chart-grid{stroke:#202b43;stroke-width:1}
.chart-area{fill:url(#chartFill)}
.chart-line{fill:none;stroke:#6356ff;stroke-width:3}
.system-meta{display:flex;justify-content:space-between;color:#8998b8;font-size:11px}
.status-label{font-size:11px;color:#9ba9c7}
.diagnostics{display:flex;gap:10px;align-items:center}
.error-banner{margin:12px 0;padding:10px 12px;border:1px solid #683345;border-radius:9px;background:#321d2d;color:#ffb3c5;font-size:12px}
@media(max-width:1100px){.shell{padding-left:225px;padding-right:18px}.shell:before{width:195px}.grid{grid-template-columns:repeat(3,minmax(0,1fr))}#groupsPanel .meta small{display:none}}
@media(max-width:760px){.shell{padding:16px}.columns{grid-template-columns:1fr}.columns>#usersTable,.columns>article.panel,.logs{grid-column:1;grid-row:auto}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:480px){.grid{gap:8px}.stat{min-height:72px;padding:11px}.stat span{font-size:9px}.top{align-items:flex-start;flex-direction:column}.status-wrap{width:100%;justify-content:flex-start;flex-wrap:wrap}.row{grid-template-columns:minmax(0,1fr) 58px 90px;gap:5px;padding:7px 5px}.panel{padding:12px}}
</style>`;

const PANEL_DASHBOARD_SCRIPT = `<script>
${fs.readFileSync(path.join(__dirname, 'services', 'panelDashboard.js'), 'utf8')}
</script>`;

const PANEL_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gonx!ta Bot Panel</title><style>.columns{display:flex;justify-content:center}.columns>.panel{width:min(100%,760px)}@media (max-width:820px){.columns{display:block}.columns>.panel{width:100%}}</style><style>
:root{--bg:#fff3d4;--bg-2:#ffd081;--panel:#fffaf0;--panel-strong:#fffdf8;--ink:#3c2109;--muted:#89542d;--line:#f5c06b;--gold:#ffb347;--gold-2:#ff8a1e;--green:#49b974;--green-soft:#ebf9ef;--red:#e46d39;--shadow:0 18px 40px rgba(122,60,12,.18);--cream:#fffaf0;--orange-strong:#ff8d24;--orange-mid:#ffb347;--orange-soft:#ffd88a;--brown:#6a3d19}*{box-sizing:border-box}html,body{margin:0;height:100%}body{font-family:Georgia,serif;background:radial-gradient(circle at 15% 10%,rgba(255,175,64,.82),transparent 16%),radial-gradient(circle at 90% 8%,rgba(255,128,32,.18),transparent 18%),linear-gradient(135deg,#fff9eb 0%,#ffe8a7 32%,#ffb85c 100%);color:var(--ink)}.shell{max-width:1180px;margin:0 auto;padding:28px 20px 40px}.top{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;padding-bottom:20px;border-bottom:3px solid rgba(96,48,12,.85)}.eyebrow{font:12px/1.2 'SFMono-Regular',Consolas,monospace;letter-spacing:2px;text-transform:uppercase;color:#7c4a22}.hgroup h1{margin:10px 0 0;font-size:clamp(2.5rem,5vw,4.5rem);font-weight:700;letter-spacing:.06em;color:#4a2708}.status-wrap{display:flex;align-items:center;gap:12px}.status{display:inline-flex;align-items:center;gap:10px;padding:10px 14px;border-radius:999px;background:rgba(255,249,238,.72);border:1px solid rgba(116,60,16,.22);box-shadow:inset 0 1px 0 rgba(255,255,255,.7);font:13px 'SFMono-Regular',Consolas,monospace}.dot{width:11px;height:11px;border-radius:50%;background:var(--red);box-shadow:0 0 0 4px rgba(228,109,57,.18)}.dot.on{background:var(--green);box-shadow:0 0 0 4px rgba(73,185,116,.18)}.refresh,.toggle-bot,.group-toggle{border:1px solid rgba(113,60,12,.7);background:linear-gradient(180deg,#ffd976,#f7a91a);padding:10px 14px;border-radius:12px;font:13px 'SFMono-Regular',Consolas,monospace;cursor:pointer;color:#4a2708;box-shadow:0 8px 18px rgba(255,140,0,.18);transition:transform .15s ease,box-shadow .15s ease}.refresh:hover,.toggle-bot:hover,.group-toggle:hover{transform:translateY(-1px);box-shadow:0 10px 20px rgba(122,60,12,.15)}.toggle-bot.paused{background:linear-gradient(180deg,#ffe9bf,#f6c764)}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:22px 0 18px}.stat,.panel{background:rgba(255,250,240,.72);backdrop-filter:blur(2px);border:2px solid rgba(101,54,23,.18);border-radius:18px;box-shadow:var(--shadow)}.stat{padding:18px 18px 14px;display:flex;flex-direction:column;gap:8px;min-height:116px}.stat strong{font-size:clamp(1.8rem,3vw,2.5rem);color:var(--orange-strong)}.stat span{font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);font-family:'SFMono-Regular',Consolas,monospace}.columns{display:grid;grid-template-columns:1.1fr 1fr;gap:18px;margin-top:18px}.panel{padding:18px}.panel h2{margin:0 0 14px;font-size:1.25rem;color:#4a2708}.table{display:grid;gap:10px}.row{display:grid;grid-template-columns:1.6fr .7fr .6fr;align-items:center;gap:12px;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,.18);border:1px solid rgba(114,59,19,.09)}.row.header{background:transparent;border:none;padding:6px 10px;color:var(--muted);font:12px 'SFMono-Regular',Consolas,monospace;letter-spacing:1.2px;text-transform:uppercase}.name-cell{display:flex;align-items:center;gap:10px;min-width:0}.avatar{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#ffcc71,#f59f2d);color:#4d2608;font-weight:700;font-size:.8rem;border:2px solid rgba(92,47,14,.12)}.avatar img{width:100%;height:100%;object-fit:cover;border-radius:50%}.meta{min-width:0}.meta strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.95rem}.badge{display:inline-flex;padding:5px 9px;border-radius:999px;font:11px 'SFMono-Regular',Consolas,monospace;border:1px solid transparent}.badge.active{background:#ebf9ef;color:#235c38;border-color:rgba(36,108,65,.2)}.badge.off{background:#ffe0cf;color:#9c4e2d;border-color:rgba(156,78,45,.15)}.empty{margin:0;color:var(--muted);font-style:italic}.logs{margin-top:18px}.logs .table{max-height:260px;overflow:auto}.logs .row{grid-template-columns:auto 1fr}.logs time{font:11px 'SFMono-Regular',Consolas,monospace;color:#7a4a1e;display:block;padding-top:2px}.logs .row span:last-child{white-space:pre-wrap;word-break:break-word;color:#4a2708}.toggle-bot{padding:10px 14px}.group-toggle{padding:8px 10px;border-radius:10px}.group-toggle.off{background:linear-gradient(180deg,#f9c87d,#f2a647)}@media (max-width:820px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.columns{grid-template-columns:1fr}}@media (max-width:520px){.top{flex-direction:column;align-items:flex-start}.status-wrap{width:100%;justify-content:space-between}.grid{grid-template-columns:1fr}.row{grid-template-columns:1.4fr .8fr .7fr}.panel{padding:14px}}</style></head><body><main class="shell"><header class="top"><div class="hgroup"><div class="eyebrow">WhatsApp bot / control center</div><h1>Gonx!ta Bot</h1></div><div class="status-wrap"><div class="status"><i class="dot" id="dot"></i><b id="state">Cargando</b></div><button class="refresh" onclick="load()">Actualizar</button><button class="toggle-bot" id="toggleBtn" onclick="toggleBot()">⏸ Pausar</button></div></header>
<section class="grid"><div class="stat"><span class="stat-icon" aria-hidden="true">♙</span><strong id="users">-</strong><span>Usuarios</span></div><div class="stat"><span class="stat-icon" aria-hidden="true">♧</span><strong id="groups">-</strong><span>Grupos</span></div><div class="stat"><span class="stat-icon" aria-hidden="true">◉</span><strong id="tx">-</strong><span>Transacciones</span></div><div class="stat"><span class="stat-icon" aria-hidden="true">◷</span><strong id="uptime">-</strong><span>Uptime</span></div><div class="stat"><span class="stat-icon" aria-hidden="true">▤</span><strong id="memoryCard">-</strong><span>Memoria utilizada</span></div><div class="stat"><span class="stat-icon" aria-hidden="true">⚠</span><strong id="errorCard">-</strong><span>Fallas recientes</span></div></section>
<section class="columns"><div id="usersTable" hidden></div><article class="panel"><h2>Grupos</h2><div class="table" id="groupsTable"></div></article></section>
<div id="logs" hidden></div></main><script>
const token=new URLSearchParams(location.search).get('token')||'';
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const fmt=n=>n<60?\`\${n}s\`:n<3600?\`\${Math.floor(n/60)}m\`:n<86400?\`\${Math.floor(n/3600)}h\`:\`\${Math.floor(n/86400)}d\`;
const initials=(name='')=>String(name).trim().split(/\s+/).filter(Boolean).slice(0,2).map(v=>v[0]).join('').toUpperCase()||'N';
let botState='running';
async function toggleBot(){const r=await fetch('/api/bot/toggle?token='+encodeURIComponent(token),{method:'POST'});if(r.ok){const d=await r.json();botState=d.bot;updateBotButton();}load();}
async function toggleGroup(button){const groupId=button.dataset.groupId;const active=button.dataset.active==='1';const r=await fetch('/api/group/toggle?token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({groupId,active:!active})});if(r.ok){load();}}
async function leaveGroup(button){const groupId=button.dataset.groupId;const groupName=button.dataset.groupName||groupId;if(!confirm('¿Gonx!ta Bot saldrá de '+groupName+'? Esta acción no se puede deshacer desde el panel.'))return;const r=await fetch('/api/group/leave?token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({groupId})});const d=await r.json().catch(()=>({}));if(!r.ok)alert(d.error||'No se pudo salir del grupo.');else load();}
function addLeaveButtons(){document.querySelectorAll('#groupsTable .group-toggle[data-group-id]').forEach(function(button){const row=button.closest('.row');if(!row||row.querySelector('.leave-group'))return;const leaveButton=document.createElement('button');leaveButton.className='group-toggle off leave-group';leaveButton.textContent='Salir';leaveButton.title='Salir del grupo';leaveButton.style.cssText='display:block;min-width:64px;margin-top:5px;white-space:nowrap;';leaveButton.dataset.groupId=button.dataset.groupId;leaveButton.dataset.groupName=row.querySelector('.meta strong')?.textContent||button.dataset.groupId;leaveButton.onclick=function(){leaveGroup(leaveButton);};button.parentElement.appendChild(leaveButton);});}

function updateBotButton(){const btn=document.querySelector('#toggleBtn');if(botState==='paused'){btn.textContent='▶ Reanudar';btn.className='toggle-bot paused';}else{btn.textContent='⏸ Pausar';btn.className='toggle-bot';}}
async function load(){const r=await fetch('/api/panel?token='+encodeURIComponent(token));if(!r.ok){document.body.innerHTML='<main class="shell"><h1>Acceso denegado</h1><p>Usa el token configurado en PANEL_TOKEN.</p></main>';return}const d=await r.json();botState=d.bot;updateBotButton();document.querySelector('#state').textContent=d.bot==='running'?'Bot online':d.bot==='paused'?'Bot pausado':'Bot detenido';document.querySelector('#dot').className='dot '+(d.bot==='running'?'on':'');document.querySelector('#users').textContent=d.counts.users;document.querySelector('#groups').textContent=d.counts.groups;document.querySelector('#tx').textContent=d.counts.transactions;document.querySelector('#uptime').textContent=fmt(d.uptime);document.querySelector('#usersTable').innerHTML='<div class="row header"><span>Nombre</span><span>Nivel</span><span>Monedas</span></div>'+d.users.map(function(u){const nombre=String(u.nombre||'Usuario');return '<div class="row"><div class="name-cell"><div class="avatar">'+esc(initials(nombre))+'</div><div class="meta"><strong>'+esc(nombre)+'</strong></div></div><span>N'+(u.nivel||1)+'</span><span>'+(u.monedas||0)+'</span></div>'}).join('')||'<p class="empty">Sin usuarios recientes</p>';document.querySelector('#groupsTable').innerHTML='<div class="row header"><span>Grupo</span><span>Estado</span><span>Comandos</span></div>'+d.groups.map(function(g){const name=String(g.name||'Grupo sin nombre');const avatar=g.picture?'<img src="'+esc(g.picture)+'" alt="'+esc(name)+'">':esc(initials(name));return '<div class="row"><div class="name-cell"><div class="avatar">'+avatar+'</div><div class="meta"><strong>'+esc(name)+'</strong></div></div><span><span class="badge '+(g.active?'active':'off')+'">'+(g.active?'Activo':'Off')+'</span></span><span><button class="group-toggle '+(g.active?'':'off')+'" data-group-id="'+esc(g.id)+'" data-active="'+(g.active?'1':'0')+'" onclick="toggleGroup(this)">'+(g.active?'Apagar':'Prender')+'</button></span></div>'}).join('')||'<p class="empty">Sin grupos</p>';document.querySelector('#logs').innerHTML=d.logs.map(function(l){return '<div class="log"><time>'+new Date(l.time).toLocaleTimeString()+'</time>'+esc(l.message)+'</div>'}).join('')||'<p class="empty">Sin logs recientes</p>'}
</script></body></html>`;

function getBotProcess() {
  if (BOT_COMMAND) {
    const [command, ...args] = BOT_COMMAND.trim().split(/\s+/);
    return spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, MENU_INTERNAL_TOKEN },
    });
  }

  const scriptPath = path.resolve(BOT_SCRIPT);
  if (!fs.existsSync(scriptPath)) {
    console.warn(`No se encontro ${BOT_SCRIPT}. Configura BOT_COMMAND o coloca el bot en la raiz.`);
    return null;
  }

  return spawn(process.execPath, [scriptPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MENU_INTERNAL_TOKEN },
  });
}

function startBot() {
  if (stopping || botPaused || botProcess) return;

  botProcess = getBotProcess();
  if (!botProcess) return;
  botStartedAt = Date.now();
  botConnection = 'connecting';

  console.log(`Gonx!ta Bot iniciado con PID ${botProcess.pid}.`);

  botProcess.stdout?.on('data', (chunk) => {
    String(chunk).split(/\r?\n/).forEach((line) => addLog('out', line));
  });
  botProcess.stderr?.on('data', (chunk) => {
    String(chunk).split(/\r?\n/).forEach((line) => addLog('error', line));
  });

  botProcess.on('error', (error) => {
    console.error('No se pudo iniciar el bot:', error.message);
    botConnection = 'disconnected';
    addLog('error', `No se pudo iniciar el bot: ${error.message}`);
  });

  botProcess.on('exit', (code, signal) => {
    botProcess = null;
    botConnection = 'disconnected';
    console.warn(`El bot termino (codigo=${code}, senal=${signal || 'ninguna'}).`);
    if (code !== 0 && !botPaused) addLog('error', `El proceso del bot terminó con código ${code ?? 'desconocido'}.`);

    if (!stopping && !botPaused) {
      console.log(`Reintentando en ${RESTART_DELAY_MS} ms...`);
      restartTimer = setTimeout(() => {
        restartTimer = null;
        startBot();
      }, RESTART_DELAY_MS);
    }
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (url.pathname === '/internal/menu-link' && request.method === 'POST') {
    const remoteAddress = request.socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress) || !isInternalBotRequest(request)) {
      return sendJson(response, 403, { error: 'Acceso local únicamente' });
    }

    try {
      const page = url.searchParams.get('page') || 'menu';
      if (page === 'menu') {
        await waitForMenuTunnel();
        const token = menuTokens.create();
        return sendJson(response, 200, {
          url: buildMenuUrl(menuLinkStore.getPublicOrigin(), token),
          expiresAt: Number(token.split('.')[1])
        });
      }
      return sendJson(response, 200, menuLinkStore.createLink(page));
    } catch (error) {
      return sendJson(response, 503, { error: error.message });
    }
  }

  if (url.pathname === '/internal/menu-origin' && request.method === 'GET') {
    const remoteAddress = request.socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress) || !isInternalBotRequest(request)) {
      return sendJson(response, 403, { error: 'Acceso local únicamente' });
    }

    try {
      await waitForMenuTunnel();
      return sendJson(response, 200, { origin: menuLinkStore.getPublicOrigin() });
    } catch (error) {
      return sendJson(response, 503, { error: `El origen público del menú no está disponible: ${error.message}` });
    }
  }

  if (url.pathname === '/menu-assets/gonxta.png' && request.method === 'GET') {
    return serveMenuAsset(response);
  }

  if (url.pathname === '/menu' && request.method === 'GET') {
    return serveMenuPage(response, url.searchParams.get('token'));
  }

  if (url.pathname === '/doom' && request.method === 'GET') {
    return serveDoomPage(response, url.searchParams.get('token'));
  }

  if (url.pathname === '/internal/diagnostics' && request.method === 'POST') {
    const remoteAddress = request.socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress) || !isInternalBotRequest(request)) {
      return sendJson(response, 403, { error: 'Acceso local únicamente' });
    }
    let body = '';
    let tooLarge = false;
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 8192) {
        tooLarge = true;
        sendJson(response, 413, { error: 'Solicitud demasiado grande' });
      }
    });
    request.on('end', () => {
      if (tooLarge) return;
      try {
        const payload = JSON.parse(body || '{}');
        if (['connecting', 'connected', 'disconnected'].includes(payload.connection)) {
          botConnection = payload.connection;
        }
        if (['backup.failure', 'database.failure', 'backup.success'].includes(payload.event)) {
          const message = typeof payload.message === 'string' ? payload.message.slice(0, 240) : payload.event;
          addLog(payload.event.endsWith('.failure') ? 'error' : 'out', message);
        }
        sendJson(response, 200, { success: true });
      } catch (error) {
        sendJson(response, 400, { error: 'Diagnóstico inválido', message: error.message });
      }
    });
    return;
  }

  if (url.pathname === '/' || url.pathname === '/panel') {
    if (!isAuthorized(request)) return sendJson(response, 401, { error: 'Unauthorized', panel: '/panel?token=...' });
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff'
    });
    response.end(PANEL_HTML
      .replace('</head>', `${PANEL_STYLE}${PANEL_DASHBOARD_STYLE}</head>`)
      .replace('</body>', `${PANEL_DASHBOARD_SCRIPT}</body>`));
    return;
  }

  if (url.pathname === '/api/panel' && request.method === 'GET') {
    if (!isAuthorized(request)) return sendJson(response, 401, { error: 'Unauthorized' });
    let database;
    try {
      database = readDatabase();
    } catch (error) {
      console.error('No se pudo leer la base de datos del panel:', error.message);
      return sendJson(response, 500, { error: 'No se pudo leer la base de datos' });
    }
    const panelData = readPanelData();
    const users = Object.entries(database.users || {}).map(([id, user]) => ({
      id,
      nombre: normalizePanelName(panelData.users?.[id]?.name || user.nombre, id.includes('@') ? id.split('@')[0] : id),
      nivel: user.nivel || 1,
      monedas: user.monedas || 0,
      lastAccess: user.ultimoAcceso || 0,
    })).sort((a, b) => b.lastAccess - a.lastAccess).slice(0, 100);
    const groups = Object.entries(database.groups || {})
      .filter(([id]) => id && id.endsWith('@g.us'))
      .map(([id, group]) => ({
        id,
        name: normalizePanelName(panelData.groups?.[id]?.name || group.name || group.nombre, id.includes('@g.us') ? id.replace('@g.us', '') : id),
        picture: panelData.groups?.[id]?.picture || null,
        active: group.activo !== false,
        commands: (group.disabledCommands || []).length,
      }))
      .filter((group) => group.name && group.name !== 'undefined' && group.name !== 'null');
    groups.sort((left, right) => left.name.localeCompare(right.name, 'es', { sensitivity: 'base' }));
    const memoryUsage = process.memoryUsage();
    const memory = {
      usedMb: Math.round(memoryUsage.rss / 1024 / 1024),
      totalMb: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      heapUsedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024)
    };
    recentMemory.push(memory.usedMb);
    if (recentMemory.length > 20) recentMemory.shift();
    const failures = logs.filter(entry => entry.type === 'error').slice(-10).reverse();
    return sendJson(response, 200, {
      bot: botPaused ? 'paused' : (botProcess ? 'running' : 'stopped'),
      connection: botPaused ? 'disconnected' : botConnection,
      uptime: Math.floor(process.uptime()),
      botUptime: botProcess && botStartedAt ? Math.floor((Date.now() - botStartedAt) / 1000) : 0,
      memory,
      memoryHistory: recentMemory,
      counts: {
        users: Object.keys(database.users || {}).length,
        groups: groups.length,
        transactions: (database.transacciones || []).length,
        coins: Object.values(database.users || {}).reduce((sum, user) => sum + (Number(user.monedas) || 0), 0)
      },
      users,
      groups,
      failures,
      audit: auditEntries.slice(-30).reverse(),
      logs: logs.slice(-20).reverse()
    });
  }

  if (
    request.method === 'POST' &&
    ['/api/group/toggle', '/api/group/leave', '/api/bot/toggle'].includes(url.pathname) &&
    !isActionAuthorized(request)
  ) {
    return sendJson(response, 403, { error: 'Acción no autorizada. Recarga el panel e inténtalo otra vez.' });
  }

  if (url.pathname === '/api/group/toggle' && request.method === 'POST') {
    if (!isAuthorized(request)) return sendJson(response, 401, { error: 'Unauthorized' });

    let body = '';
    let tooLarge = false;
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 8192) {
        tooLarge = true;
        sendJson(response, 413, { error: 'Solicitud demasiado grande' });
      }
    });
    request.on('end', () => {
      if (tooLarge) return;
      let payload;
      try {
        payload = JSON.parse(body || '{}');
      } catch (error) {
        return sendJson(response, 400, { error: 'JSON inválido', message: error.message });
      }

      const groupId = payload.groupId || payload.id;
      try {
        if (!groupId) {
          return sendJson(response, 400, { error: 'groupId requerido' });
        }

        if (!/^\d+(?:-\d+)?@g\.us$/.test(String(groupId || ''))) {
          recordAudit('Cambiar estado del grupo', String(groupId || '—'), false, 'Grupo inválido');
          return sendJson(response, 400, { error: 'Grupo inválido' });
        }
        if (typeof payload.active !== 'boolean') {
          recordAudit('Cambiar estado del grupo', groupId, false, 'Estado inválido');
          return sendJson(response, 400, { error: 'Estado del grupo inválido' });
        }

        const database = readDatabase();
        if (!database.groups?.[groupId]) {
          recordAudit('Cambiar estado del grupo', groupId, false, 'Grupo no encontrado');
          return sendJson(response, 404, { error: 'Grupo no encontrado' });
        }

        if (!botProcess) {
          if (!database.groups) database.groups = {};
          database.groups[groupId].activo = payload.active;
          if (!dbUtils.validate(database) || !dbUtils.write(database)) {
            throw new Error('No se pudo guardar la base de datos');
          }
          recordAudit('Cambiar estado del grupo', groupId, true, payload.active ? 'Bot activado en el grupo' : 'Bot apagado en el grupo');
          return sendJson(response, 200, {
            success: true,
            groupId,
            active: payload.active,
            status: payload.active ? 'activo' : 'apagado'
          });
        }

        const controlRequest = http.request({
          hostname: '127.0.0.1',
          port: BOT_CONTROL_PORT,
          path: '/group/toggle',
          method: 'POST',
          headers: { 'content-type': 'application/json' }
        }, (controlResponse) => {
          let result = '';
          controlResponse.on('data', chunk => { result += chunk; });
          controlResponse.on('end', () => {
            let resultPayload;
            try {
              resultPayload = JSON.parse(result || '{}');
            } catch {
              resultPayload = { error: 'Respuesta inválida del bot' };
            }
            const succeeded = (controlResponse.statusCode || 502) >= 200 && (controlResponse.statusCode || 502) < 300;
            recordAudit('Cambiar estado del grupo', groupId, succeeded, resultPayload.status || resultPayload.error || (payload.active ? 'Activado' : 'Apagado'));
            sendJson(response, controlResponse.statusCode || 502, resultPayload);
          });
        });
        controlRequest.on('error', error => {
          recordAudit('Cambiar estado del grupo', groupId, false, 'Bot no disponible');
          sendJson(response, 503, { error: 'El bot no está disponible', message: error.message });
        });
        controlRequest.end(JSON.stringify({ groupId, active: payload.active }));
      } catch (error) {
        console.error('No se pudo cambiar el estado del grupo:', error.message);
        recordAudit('Cambiar estado del grupo', groupId, false, error.message);
        return sendJson(response, 500, { error: 'No se pudo cambiar el estado del grupo' });
      }
    });
    return;
  }

  if (url.pathname === '/api/group/leave' && request.method === 'POST') {
    if (!isAuthorized(request)) return sendJson(response, 401, { error: 'Unauthorized' });
    let body = '';
    let tooLarge = false;
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 8192) {
        tooLarge = true;
        sendJson(response, 413, { error: 'Solicitud demasiado grande' });
      }
    });
    request.on('end', () => {
      if (tooLarge) return;
      try {
        const { groupId } = JSON.parse(body || '{}');
        if (!/^\d+(?:-\d+)?@g\.us$/.test(String(groupId || ''))) {
          recordAudit('Salir del grupo', String(groupId || '—'), false, 'Grupo inválido');
          return sendJson(response, 400, { error: 'Grupo inválido' });
        }
        const controlRequest = http.request({ hostname: '127.0.0.1', port: BOT_CONTROL_PORT, path: '/leave-group', method: 'POST', headers: { 'content-type': 'application/json' } }, (controlResponse) => {
          let result = '';
          controlResponse.on('data', chunk => { result += chunk; });
          controlResponse.on('end', () => {
            let payload;
            try { payload = JSON.parse(result || '{}'); } catch { payload = { error: 'Respuesta inválida del bot' }; }
            const succeeded = (controlResponse.statusCode || 502) >= 200 && (controlResponse.statusCode || 502) < 300;
            recordAudit('Salir del grupo', groupId, succeeded, payload.error || (succeeded ? 'Bot salió del grupo' : 'No se pudo salir'));
            sendJson(response, controlResponse.statusCode || 502, payload);
          });
        });
        controlRequest.on('error', error => {
          recordAudit('Salir del grupo', groupId, false, 'Bot no disponible');
          sendJson(response, 503, { error: 'El bot no está disponible', message: error.message });
        });
        controlRequest.end(JSON.stringify({ groupId }));
      } catch (error) {
        recordAudit('Salir del grupo', '—', false, error.message);
        return sendJson(response, 400, { error: 'JSON inválido', message: error.message });
      }
    });
    return;
  }

  if (url.pathname === '/api/bot/toggle' && request.method === 'POST') {
    if (!isAuthorized(request)) return sendJson(response, 401, { error: 'Unauthorized' });
    const nextPaused = !botPaused;
    try {
      dbUtils.writeAtomic(path.join(__dirname, 'bot-state.json'), { paused: nextPaused, updatedAt: new Date().toISOString() });
    } catch (error) {
      console.error('Error guardando estado del bot', error.message);
      recordAudit('Cambiar estado del bot', '—', false, 'No se pudo guardar el estado');
      return sendJson(response, 500, { error: 'No se pudo guardar el estado del bot' });
    }
    botPaused = nextPaused;
    
    if (botPaused && botProcess) {
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      botProcess.kill('SIGTERM');
      addLog('out', '🛑 Bot pausado manualmente desde el panel');
    } else if (!botPaused) {
      if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
      }
      if (!botProcess) {
      addLog('out', '▶️ Bot reanudado desde el panel');
      startBot();
      }
    }
    botConnection = botPaused ? 'disconnected' : botConnection;
    recordAudit(botPaused ? 'Pausar bot' : 'Reanudar bot', '—', true, botPaused ? 'Bot pausado desde el panel' : 'Bot reanudado desde el panel');
    return sendJson(response, 200, { bot: botPaused ? 'paused' : 'running', status: botPaused ? 'Bot pausado' : 'Bot activo' });
  }

  if (request.url === '/health' && request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      status: 'ok',
      bot: botPaused ? 'paused' : botProcess ? 'running' : 'stopped',
      uptime: Math.floor(process.uptime()),
    }));
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ error: 'Not found' }));
});

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal}: cerrando servidor...`);

  if (restartTimer) clearTimeout(restartTimer);
  if (menuTunnelProcess) menuTunnelProcess.kill('SIGTERM');
  if (botProcess) botProcess.kill('SIGTERM');

  publicMenuServer.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

publicMenuServer.listen(MENU_TUNNEL_PORT, '127.0.0.1', () => {
  console.log(`Servidor del menú escuchando solo en 127.0.0.1:${MENU_TUNNEL_PORT}.`);
  server.listen(PORT, PANEL_HOST, () => {
    console.log(`Servidor escuchando en ${PANEL_HOST}:${PORT}.`);
    startMenuTunnel();
    if (!botPaused) startBot();
  });
});
