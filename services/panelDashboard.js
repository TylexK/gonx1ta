const panelHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
};
const shell = document.querySelector('.shell');
const sidebar = document.createElement('nav');
sidebar.className = 'panel-nav';
sidebar.setAttribute('aria-label', 'Navegación del panel');
sidebar.innerHTML = '<div class="brand">Gonx!ta <small>CONTROL CENTER</small></div><a href="#dashboard">Dashboard</a><a href="#groups">Grupos</a><a href="#users">Usuarios</a><div class="nav-status"><span id="sideDot" class="dot"></span><span id="sideState">Conectando</span><small id="sideUptime">Activo: 0s</small></div>';
document.body.insertBefore(sidebar, shell);
const columns = document.querySelector('.columns');
const groupsPanel = document.querySelector('#groupsTable').closest('.panel');
const statGrid = document.querySelector('.grid');
const groupsTitle = groupsPanel.querySelector('h2');
groupsPanel.id = 'groupsPanel';
groupsTitle.textContent = 'Grupos conectados';

const dashboardView = document.createElement('section');
dashboardView.id = 'dashboardView';
dashboardView.className = 'dashboard-view';
const groupsView = document.createElement('section');
groupsView.id = 'groupsView';
groupsView.className = 'groups-view';
groupsView.hidden = true;
const usersView = document.createElement('section');
usersView.id = 'usersView';
usersView.className = 'users-view';
usersView.hidden = true;
const usersPanel = document.createElement('article');
usersPanel.id = 'usersPanel';
usersPanel.className = 'panel';
usersPanel.innerHTML = '<h2 id="usersTitle">Usuarios registrados</h2><div id="usersList" class="table"></div>';
usersView.append(usersPanel);

const systemPanel = document.createElement('article');
systemPanel.id = 'systemPanel';
systemPanel.className = 'panel chart-panel';
systemPanel.innerHTML = '<h2>Uso del sistema</h2><div class="system-meta"><span>Memoria del panel</span><strong id="dashboardMemoryValue">-</strong></div><div class="chart-wrap" id="dashboardMemoryChart"></div><div class="system-meta"><span id="dashboardRuntimeValue">Uptime</span><span id="dashboardFailureValue">Sin fallas</span></div>';

const activityPanel = document.createElement('article');
activityPanel.id = 'activityPanel';
activityPanel.className = 'panel logs';
activityPanel.innerHTML = '<h2>Últimas actividades</h2><div id="activityList"></div>';

dashboardView.append(statGrid, systemPanel, activityPanel);
groupsView.append(groupsPanel);
document.querySelector('#usersTable').remove();
columns.remove();
shell.append(dashboardView, groupsView, usersView);
shell.id = 'dashboard';
document.querySelector('#logs').hidden = true;
document.querySelector('#tx').closest('.stat').id = 'economy';
statGrid.children[2].lastElementChild.textContent = 'Monedas totales';

const navStyle = document.createElement('style');
navStyle.textContent = `
.brand{padding:5px 9px 18px;color:#fff;font-size:13px;font-weight:800;letter-spacing:.5px}
.brand small{display:block;color:#8c7cff;font-size:9px}
.panel-nav{display:flex!important;flex-direction:column;gap:8px;position:fixed;z-index:3;inset:0 auto 0 0;width:212px;padding:23px 14px;background:#080d19;border-right:1px solid #202b46}
.panel-nav a{padding:9px 10px;border-radius:8px;color:#aab7d5;text-decoration:none;font-size:12px}
.panel-nav a.active{background:#27205e;color:#fff}
.nav-status{margin-top:auto;padding:12px;border:1px solid #202b46;border-radius:10px;font-size:11px}
.nav-status small{display:block;margin-top:7px;color:#8291af}
.nav-status .dot{display:inline-block;margin-right:7px;width:8px;height:8px}
.dashboard-view{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(270px,.8fr);gap:12px;margin-top:16px;align-items:start}
.dashboard-view .grid{grid-column:1/-1;margin:0}
#systemPanel{grid-column:1;grid-row:2}
#activityPanel{grid-column:2;grid-row:2}
#groupsPanel{width:100%;max-width:none}
#groupsPanel .table{max-height:calc(100vh - 230px);overflow:auto}
#groupsPanel .meta small{display:none}
#usersPanel .table{max-height:calc(100vh - 230px);overflow:auto}
#usersPanel .row{grid-template-columns:minmax(0,1fr) 70px 100px 190px}
#usersPanel .avatar{flex:none}
.groups-view{margin-top:18px}
.users-view{margin-top:18px}
.groups-view[hidden],.dashboard-view[hidden],.users-view[hidden]{display:none!important}
.group-photo{width:100%;height:100%;flex:none;border-radius:50%;object-fit:cover;background:#27365b}
#groupsPanel .avatar{overflow:hidden;padding:0}
.connected-count{margin-left:8px;color:#7f8dac;font-size:12px;font-weight:400}
.activity-line{display:grid;grid-template-columns:28px 1fr;gap:8px;padding:8px 0;border-bottom:1px solid #202b43;font-size:11px}
.activity-line:last-child{border-bottom:0}
.activity-icon{width:24px;height:24px;border-radius:7px;display:grid;place-items:center;background:#263867;color:#dce4ff}
.activity-line small{display:block;color:#7f8dac;margin-top:3px}
.chart-wrap{height:155px;margin-top:12px}
.chart-wrap svg{width:100%;height:100%;overflow:visible}
.chart-grid{stroke:#202b43;stroke-width:1}
.chart-area{fill:url(#chartFill)}
.chart-line{fill:none;stroke:#6356ff;stroke-width:3}
.system-meta{display:flex;justify-content:space-between;gap:10px;color:#8998b8;font-size:11px}
.error-banner{margin:12px 0;padding:10px 12px;border:1px solid #683345;border-radius:9px;background:#321d2d;color:#ffb3c5;font-size:12px}
@media(max-width:1100px){.dashboard-view{grid-template-columns:minmax(0,1.2fr) minmax(250px,.8fr)}.panel-nav{width:195px}}
@media(max-width:760px){.panel-nav{position:static;width:auto;inset:auto;flex-direction:row;flex-wrap:wrap;margin-bottom:12px;padding:8px;border:1px solid #202b46;border-radius:10px}.nav-status{display:none}.dashboard-view{grid-template-columns:1fr}.dashboard-view .grid{grid-column:1}.dashboard-view #systemPanel,.dashboard-view #activityPanel{grid-column:1;grid-row:auto}.groups-view,.users-view{margin-top:12px}#usersPanel .row{grid-template-columns:minmax(0,1fr) 50px 70px 100px;gap:5px;padding:7px 5px}}
`;
document.head.appendChild(navStyle);

function setView(view, updateHash = true) {
    const showGroups = view === 'groups';
    const showUsers = view === 'users';
    dashboardView.hidden = showGroups;
    groupsView.hidden = !showGroups;
    usersView.hidden = !showUsers;
    sidebar.querySelectorAll('a').forEach(link => {
        link.classList.toggle('active', link.hash === `#${view}`);
    });
    if (updateHash) history.replaceState(null, '', `#${view}`);
}

sidebar.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', event => {
        event.preventDefault();
        setView(link.hash.slice(1));
    });
});
window.addEventListener('hashchange', () => setView(['groups', 'users'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard', false));
setView(['groups', 'users'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard', false);

function drawMemory(values) {
    const points = values.slice(-20);
    if (!points.length) return;
    const max = Math.max(32, ...points);
    const coordinates = points.map((value, index) => {
        const x = 8 + (index * (284 / Math.max(1, points.length - 1)));
        const y = 128 - (value / max * 108);
        return `${x},${y}`;
    });
    const line = coordinates.join(' ');
    const area = `8,132 ${line} 292,132`;
    document.querySelector('#dashboardMemoryChart').innerHTML = `<svg viewBox="0 0 300 145" role="img" aria-label="Uso de memoria en las últimas lecturas"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#5548ed" stop-opacity=".55"/><stop offset="1" stop-color="#5548ed" stop-opacity=".03"/></linearGradient></defs><path class="chart-grid" d="M8 20H292M8 55H292M8 90H292M8 125H292"/><polygon class="chart-area" points="${area}"/><polyline class="chart-line" points="${line}"/></svg>`;
}

function renderActivity(entries) {
    const host = document.querySelector('#activityList');
    host.innerHTML = entries.length
        ? entries.map(entry => {
            const failed = entry.result === 'failure' || entry.type === 'error';
            const label = entry.action || entry.message || 'Actividad del bot';
            const target = entry.group && entry.group !== '—' ? `Grupo: ${entry.group}` : '';
            return `<div class="activity-line"><span class="activity-icon">${failed ? '!' : '✓'}</span><div>${esc(label)}<small>${esc(target || entry.detail || entry.message || '')} · ${new Date(entry.date || entry.time).toLocaleString()}</small></div></div>`;
        }).join('')
        : '<p class="empty">Sin actividad reciente</p>';
}

function renderGroups(groups) {
    groupsTitle.innerHTML = `Grupos conectados <span class="connected-count">${groups.length}</span>`;
    document.querySelector('#groupsTable').innerHTML = '<div class="row header"><span>Grupo</span><span>Estado</span><span>Acciones</span></div>' +
        groups.map(group => {
            const name = String(group.name || 'Grupo sin nombre');
            const avatar = group.picture
                ? `<div class="avatar"><img class="group-photo" src="${esc(group.picture)}" alt="${esc(name)}" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span hidden>${esc(initials(name))}</span></div>`
                : `<div class="avatar">${esc(initials(name))}</div>`;
            return `<div class="row"><div class="name-cell">${avatar}<div class="meta"><strong>${esc(name)}</strong><small>${group.commands} comandos desactivados</small></div></div><span><span class="badge ${group.active ? 'active' : 'off'}">${group.active ? 'Activo' : 'Apagado'}</span></span><span><button class="group-toggle" data-group-id="${esc(group.id)}" data-active="${group.active ? '1' : '0'}" onclick="toggleGroup(this)">${group.active ? 'Apagar' : 'Prender'}</button><button class="group-toggle off leave-group" data-group-id="${esc(group.id)}" data-group-name="${esc(name)}" onclick="leaveGroup(this)">Salir</button></span></div>`;
        }).join('') || '<p class="empty">No hay grupos conectados al bot.</p>';
}

function renderUsers(users, total) {
    document.querySelector('#usersTitle').textContent = `Usuarios registrados (${Number(total).toLocaleString('es')})`;
    document.querySelector('#usersList').innerHTML = users.length
        ? '<div class="row header"><span>Usuario</span><span>Nivel</span><span>Monedas</span><span>Última actividad</span></div>' +
            users.map(user => {
                const name = String(user.nombre || 'Usuario');
                const lastAccess = Number(user.lastAccess);
                const lastSeen = lastAccess > 0 ? new Date(lastAccess).toLocaleString('es') : 'Sin registro';
                return `<div class="row"><div class="name-cell"><div class="avatar">${esc(initials(name))}</div><div class="meta"><strong>${esc(name)}</strong></div></div><span>N${Number(user.nivel) || 1}</span><span>${(Number(user.monedas) || 0).toLocaleString('es')}</span><span>${esc(lastSeen)}</span></div>`;
            }).join('')
        : '<p class="empty">No hay usuarios registrados.</p>';
}

async function dashboardLoad() {
    try {
        const response = await fetch('/api/panel?token=' + encodeURIComponent(token), { cache: 'no-store' });
        if (!response.ok) throw new Error('No se pudo cargar el panel');
        const data = await response.json();
        botState = data.bot;
        updateBotButton();
        document.querySelector('#state').textContent = data.connection === 'connected' ? 'Bot online' : data.bot === 'paused' ? 'Bot pausado' : data.connection === 'connecting' ? 'Conectando' : 'Bot desconectado';
        document.querySelector('#dot').className = 'dot ' + (data.connection === 'connected' ? 'on' : '');
        document.querySelector('#sideDot').className = 'dot ' + (data.connection === 'connected' ? 'on' : '');
        document.querySelector('#sideState').textContent = data.connection === 'connected' ? 'Bot en línea' : data.bot === 'paused' ? 'Bot pausado' : 'Sin conexión';
        document.querySelector('#sideUptime').textContent = 'Activo: ' + fmt(data.botUptime || 0);
        document.querySelector('#users').textContent = data.counts.users.toLocaleString('es');
        document.querySelector('#groups').textContent = data.counts.groups.toLocaleString('es');
        document.querySelector('#tx').textContent = data.counts.coins.toLocaleString('es');
        document.querySelector('#uptime').textContent = fmt(data.botUptime || 0);
        document.querySelector('#memoryCard').textContent = data.memory.usedMb + ' MB';
        document.querySelector('#errorCard').textContent = data.failures.length.toLocaleString('es');
        document.querySelector('#dashboardMemoryValue').textContent = data.memory.usedMb + ' MB RSS / ' + data.memory.heapUsedMb + ' MB heap';
        document.querySelector('#dashboardRuntimeValue').textContent = 'Tiempo activo: ' + fmt(data.botUptime || 0);
        document.querySelector('#dashboardFailureValue').textContent = data.failures.length ? 'Última falla: ' + new Date(data.failures[0].time).toLocaleTimeString() : 'Sin fallas recientes';
        drawMemory(data.memoryHistory);
        renderGroups(data.groups);
        renderUsers(data.users, data.counts.users);
        const activity = data.audit.concat(data.logs).sort((a, b) => new Date(b.date || b.time) - new Date(a.date || a.time)).slice(0, 8);
        renderActivity(activity);
        const oldBanner = document.querySelector('.error-banner');
        if (oldBanner) oldBanner.remove();
        if (data.failures.length) {
            const banner = document.createElement('div');
            banner.className = 'error-banner';
            banner.textContent = 'Aviso: ' + data.failures[0].message;
            statGrid.after(banner);
        }
    } catch {
        const oldBanner = document.querySelector('.error-banner');
        if (oldBanner) oldBanner.remove();
        const banner = document.createElement('div');
        banner.className = 'error-banner';
        banner.textContent = 'No se pudieron actualizar los diagnósticos del panel.';
        statGrid.after(banner);
    }
}

window.load = dashboardLoad;
window.toggleBot = async function() {
    const response = await fetch('/api/bot/toggle', { method: 'POST', headers: panelHeaders });
    if (!response.ok) {
        alert('No se pudo cambiar el estado del bot.');
        return;
    }
    await dashboardLoad();
};
window.toggleGroup = async function(button) {
    const response = await fetch('/api/group/toggle', {
        method: 'POST',
        headers: panelHeaders,
        body: JSON.stringify({ groupId: button.dataset.groupId, active: button.dataset.active !== '1' })
    });
    if (!response.ok) {
        alert('No se pudo actualizar el grupo.');
        return;
    }
    await dashboardLoad();
};
window.leaveGroup = async function(button) {
    if (!confirm('¿Gonx!ta Bot saldrá de ' + (button.dataset.groupName || button.dataset.groupId) + '? Esta acción no se puede deshacer desde el panel.')) return;
    const response = await fetch('/api/group/leave', {
        method: 'POST',
        headers: panelHeaders,
        body: JSON.stringify({ groupId: button.dataset.groupId })
    });
    if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        alert(result.error || 'No se pudo salir del grupo.');
        return;
    }
    await dashboardLoad();
};

dashboardLoad();
setInterval(dashboardLoad, 60 * 1000);
