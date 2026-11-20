const CATEGORY_PAGE_SIZE = 7;
const COMMAND_PAGE_SIZE = 7;
const MAX_LIST_ROWS = 10;
const ROW_PREFIX = 'gonxta-menu';
const ADDITIONAL_MENU_COMMANDS = [
    { command: '.doom', category: 'games' }
];

const MENU_CATEGORY_DEFINITIONS = [
    { name: 'admin', title: 'Staff y bot', icon: '♜', description: 'Control, estado y protección del bot' },
    { name: 'economy', title: 'RPG y economía', icon: '◇', description: 'Monedas, tienda, banco y recompensas' },
    { name: 'games', title: 'Juegos RPG', icon: '♢', description: 'Juegos, retos y trivias' },
    { name: 'downloads', title: 'Búsquedas y descargas', icon: '⇩', description: 'Busca y descarga contenido' },
    { name: 'ai', title: 'Inteligencia IA', icon: '✧', description: 'Asistente de inteligencia artificial' },
    { name: 'media', title: 'Media', icon: '♫', description: 'Música, voz, imágenes y multimedia' },
    { name: 'fun', title: 'Diversión', icon: '✿', description: 'Interacción social y entretenimiento' },
    { name: 'pets', title: 'Mascotas', icon: '♧', description: 'Mascotas, casas y decoración' },
    { name: 'profile', title: 'Perfil', icon: '♙', description: 'Tu cuenta, perfil y progreso' },
    { name: 'stickers', title: 'Stickers', icon: '✦', description: 'Crea y personaliza stickers' },
    { name: 'group', title: 'Admins de grupo', icon: '♧', description: 'Moderación y administración del grupo' },
    { name: 'system', title: 'Utilidades', icon: '⌘', description: 'Ayuda, herramientas y estado del bot' }
];

const GROUP_COMMANDS = new Set([
    '.abrir', '.cerrar', '.invitacion', '.link', '.l', '.tagall', '.hidetag', '.afk',
    '.grupo_info', '.setwelcome', '.setgoodbye', '.goodbye', '.slowmode',
    '.antilink', '.antiflood', '.lock', '.unlock', '.setrules', '.warn',
    '.warns', '.unwarn', '.mute', '.unmute', '.unmutetemp', '.unmuteperma',
    '.kick', '.ban', '.promote', '.demote', '.rol', '.roles'
]);

const PROFILE_COMMANDS = new Set([
    '.reg', '.perfil', '.perfildos', '.nivel', '.estadisticas', '.logros',
    '.logros_especiales', '.myid', '.id', '.misgrupos', '.usuarios_totales'
]);

const PET_COMMANDS = new Set(['.mascota', '.casa', '.decorar']);
const AI_COMMANDS = new Set(['.ia', '.iareset']);
const DOWNLOAD_COMMANDS = new Set([
    '.tiktok', '.tt', '.ig', '.reel', '.facebook', '.fb', '.mediafire', '.mf',
    '.pinterest', '.pin', '.mp4', '.twitter', '.x', '.ytsearch', '.search',
    '.imagen', '.img', '.aptoide', '.apk', '.drive', '.gdrive', '.youtube',
    '.spotify', '.soundcloud', '.video', '.foto', '.wallpaper', '.play2'
]);

const COMMAND_DESCRIPTIONS = {
    '.menu': 'Abre el panel interactivo de comandos.',
    '.bot': 'Muestra información y comandos disponibles del bot.',
    '.doom': 'Abre el minijuego de acción del bot.',
    '.reg': 'Crea tu perfil para empezar a usar las funciones del bot.',
    '.perfil': 'Consulta tu perfil y tus estadísticas.',
    '.tienda': 'Muestra los artículos disponibles para comprar.',
    '.comprar': 'Compra un artículo de la tienda usando su número.',
    '.inventario': 'Muestra los artículos que tienes.',
    '.tagall': 'Menciona a todos los participantes del grupo. Requiere permisos.',
    '.hidetag': 'Envía un mensaje mencionando al grupo sin mostrar la lista.',
    '.kick': 'Expulsa del grupo al usuario mencionado. Requiere permisos.',
    '.promote': 'Promociona a un participante a administrador.',
    '.demote': 'Quita el rol de administrador a un participante.',
    '.musica': 'Busca y envía audio a partir de una canción o enlace.',
    '.play': 'Busca y reproduce audio por nombre o enlace.',
    '.ia': 'Pregunta algo al asistente de inteligencia artificial.',
    '.qr': 'Genera un código QR a partir de un texto o enlace.',
    '.s': 'Crea un sticker a partir de una imagen o video.',
    '.daily': 'Reclama tu recompensa diaria.',
    '.banco': 'Consulta tu balance y cuenta.',
    '.afk': 'Indica que estás ausente en el grupo.'
};

function getMenuCategoryName(command, sourceName) {
    if (GROUP_COMMANDS.has(command)) return 'group';
    if (PROFILE_COMMANDS.has(command)) return 'profile';
    if (PET_COMMANDS.has(command)) return 'pets';
    if (AI_COMMANDS.has(command)) return 'ai';
    if (sourceName === 'admin') return 'admin';
    if (sourceName === 'stickers') return 'stickers';
    if (sourceName === 'multimedia') return DOWNLOAD_COMMANDS.has(command) ? 'downloads' : 'media';
    if (sourceName === 'games') return 'games';
    if (sourceName === 'economy') return 'economy';
    if (sourceName === 'social') return 'fun';
    return 'system';
}

function createMenuCategories(sourceCategories) {
    const categories = MENU_CATEGORY_DEFINITIONS.map(category => ({
        ...category,
        commands: []
    }));
    const categoriesByName = new Map(categories.map(category => [category.name, category]));
    const seen = new Set();

    for (const source of sourceCategories) {
        for (const command of source.commands) {
            if (seen.has(command)) continue;
            seen.add(command);
            categoriesByName.get(getMenuCategoryName(command, source.name)).commands.push(command);
        }
    }
    for (const { command, category } of ADDITIONAL_MENU_COMMANDS) {
        if (seen.has(command)) continue;
        categoriesByName.get(category).commands.push(command);
    }

    return categories
        .filter(category => category.commands.length)
        .map(category => ({
            ...category,
            commands: category.commands.sort((left, right) => left.localeCompare(right, 'es'))
        }));
}

function createTextWhatsAppMenu(sourceCategories, url) {
    const categories = createMenuCategories(sourceCategories)
        .filter(category => category.commands.length);
    const sections = categories.map(category => {
        const commandLines = [];
        for (let index = 0; index < category.commands.length; index += 7) {
            commandLines.push(`┃ ${category.commands.slice(index, index + 7).join(' • ')}`);
        }
        return [
            `╭━━〔 ${category.icon} *${category.title.toLocaleUpperCase('es')}* 〕`,
            ...commandLines,
            '╰━━━━━━━━━━━━━━━━━━━━━━'
        ].join('\n');
    });

    const menuAccess = url
        ? `🔎 Explora y busca comandos en el menú interactivo:\n${url}`
        : '🌐 Para abrir el menú visual, escribe .menu web.';
    return `✨ *GONX!TA BOT · MENÚ COMPLETO* ✨\n\n${sections.join('\n\n')}\n\n${menuAccess}`;
}

function createTextWhatsAppSearch(sourceCategories, query) {
    const normalizedQuery = normalizeSearchText(query.trim());
    if (!normalizedQuery) {
        return 'Escribe qué comando buscas. Ejemplo: .menu buscar música';
    }

    const categories = createMenuCategories(sourceCategories);
    const commands = getMenuCommands(categories);
    const results = commands.filter(item => {
        const categoryName = getCategoryPresentation(categories[item.categoryIndex]).title;
        return normalizeSearchText(`${item.command} ${categoryName}`).includes(normalizedQuery);
    });

    if (!results.length) {
        return `No encontré comandos que coincidan con “${query}”. Prueba otra búsqueda o escribe .menu web para explorar el menú.`;
    }

    const displayedResults = results.slice(0, 20).map(item => {
        const category = getCategoryPresentation(categories[item.categoryIndex]);
        return `• ${item.command} — ${category.title}`;
    });
    const remaining = results.length - displayedResults.length;
    return `🔎 *Resultados para “${query}”*\n\n${displayedResults.join('\n')}${remaining > 0 ? `\n\nY ${remaining} más.` : ''}\n\n🌐 Para ver detalles, escribe .menu web.`;
}

function getCategoryPresentation(category) {
    return category.title ? category : {
        title: category.name,
        icon: '📁'
    };
}

function getMenuCommands(categories) {
    const seen = new Set();
    const commands = [];
    for (let categoryIndex = 0; categoryIndex < categories.length; categoryIndex++) {
        const category = categories[categoryIndex];
        for (const command of category.commands) {
            if (seen.has(command)) continue;
            seen.add(command);
            commands.push({ command, categoryIndex });
        }
    }
    return commands;
}

function createList(title, description, sectionTitle, rows) {
    if (rows.length > MAX_LIST_ROWS) {
        throw new Error('El menú de WhatsApp no puede tener más de 10 opciones.');
    }
    return {
        type: 'list',
        payload: {
            title,
            description,
            buttonText: 'Menú completo',
            listType: 1,
            sections: [{ title: sectionTitle, rows }]
        }
    };
}

function limitRowTitle(title) {
    const characters = Array.from(title);
    return characters.length <= 24
        ? title
        : `${characters.slice(0, 23).join('')}…`;
}

function createWhatsAppInteractiveMessage(payload) {
    return {
        interactiveMessage: {
            header: {
                title: payload.title,
                hasMediaAttachment: false
            },
            body: { text: payload.description },
            footer: { text: 'Gonx!ta Bot' },
            nativeFlowMessage: {
                buttons: [{
                    name: 'single_select',
                    buttonParamsJson: JSON.stringify({
                        title: payload.buttonText,
                        sections: payload.sections.map(section => ({
                            title: section.title,
                            rows: section.rows.map(row => ({
                                id: row.rowId,
                                title: row.title,
                                ...(row.description ? { description: row.description } : {})
                            }))
                        }))
                    })
                }],
                messageVersion: 1
            }
        }
    };
}

function getWhatsAppMenuSelection(message) {
    let content = message;
    for (let depth = 0; content && depth < 5; depth++) {
        const wrapper = content.ephemeralMessage
            || content.viewOnceMessage
            || content.viewOnceMessageV2
            || content.viewOnceMessageV2Extension
            || content.documentWithCaptionMessage
            || content.editedMessage;
        if (!wrapper?.message) break;
        content = wrapper.message;
    }

    const listSelection = content?.listResponseMessage?.singleSelectReply?.selectedRowId;
    if (typeof listSelection === 'string') return listSelection;

    const paramsJson = content?.interactiveResponseMessage
        ?.nativeFlowResponseMessage?.paramsJson;
    if (typeof paramsJson !== 'string') return null;

    try {
        const params = JSON.parse(paramsJson);
        const selection = params.id || params.rowId || params.selectedRowId;
        return typeof selection === 'string' ? selection : null;
    } catch {
        return null;
    }
}

function createCategoriesMenu(categories, page = 0) {
    const pageCount = Math.max(1, Math.ceil(categories.length / CATEGORY_PAGE_SIZE));
    const currentPage = Math.max(0, Math.min(page, pageCount - 1));
    const start = currentPage * CATEGORY_PAGE_SIZE;
    const rows = categories.slice(start, start + CATEGORY_PAGE_SIZE).map((category, offset) => {
        const categoryIndex = start + offset;
        const presentation = getCategoryPresentation(category);
        return {
            title: limitRowTitle(`${presentation.icon} ${presentation.title}`),
            description: limitRowTitle(`${category.commands.length} comandos`),
            rowId: `${ROW_PREFIX}:category:${categoryIndex}`
        };
    });

    if (currentPage > 0) {
        rows.push({
            title: '‹ Categorías anteriores',
            rowId: `${ROW_PREFIX}:categories:${currentPage - 1}`
        });
    }
    if (currentPage + 1 < pageCount) {
        rows.push({
            title: 'Más categorías ›',
            rowId: `${ROW_PREFIX}:categories:${currentPage + 1}`
        });
    }
    rows.push({
        title: '✦ Ver todos los comandos',
        rowId: `${ROW_PREFIX}:all:0`
    });

    return createList(
        'Gonx!ta Bot · Menú completo',
        'Explora todas las categorías y comandos disponibles del bot.',
        `Categorías ${currentPage + 1}/${pageCount}`,
        rows
    );
}

function createCommandsMenu(categories, categoryIndex, page = 0) {
    const allCommands = getMenuCommands(categories);
    const selectedCategory = categoryIndex === -1 ? null : categories[categoryIndex];
    if (categoryIndex !== -1 && !selectedCategory) return null;

    const commands = selectedCategory
        ? allCommands.filter(item => item.categoryIndex === categoryIndex)
        : allCommands;
    const pageCount = Math.max(1, Math.ceil(commands.length / COMMAND_PAGE_SIZE));
    const currentPage = Math.max(0, Math.min(page, pageCount - 1));
    const start = currentPage * COMMAND_PAGE_SIZE;
    const rows = commands.slice(start, start + COMMAND_PAGE_SIZE).map(item => {
        const commandIndex = allCommands.indexOf(item);
        const presentation = getCategoryPresentation(categories[item.categoryIndex]);
        return {
            title: limitRowTitle(item.command),
            description: limitRowTitle(presentation.title),
            rowId: `${ROW_PREFIX}:command:${commandIndex}:${categoryIndex === -1 ? 'all' : `category:${categoryIndex}`}:${currentPage}`
        };
    });

    if (currentPage > 0) {
        rows.push({
            title: '‹ Comandos anteriores',
            rowId: `${ROW_PREFIX}:commands:${categoryIndex}:${currentPage - 1}`
        });
    }
    if (currentPage + 1 < pageCount) {
        rows.push({
            title: 'Más comandos ›',
            rowId: `${ROW_PREFIX}:commands:${categoryIndex}:${currentPage + 1}`
        });
    }
    rows.push({
        title: '↩ Volver a categorías',
        rowId: `${ROW_PREFIX}:categories:${Math.floor(Math.max(categoryIndex, 0) / CATEGORY_PAGE_SIZE)}`
    });

    const heading = selectedCategory
        ? getCategoryPresentation(selectedCategory).title
        : 'Todos los comandos';
    return createList(
        `Gonx!ta · ${heading}`,
        `Página ${currentPage + 1}/${pageCount}. Toca un comando para ver sus opciones.`,
        'Comandos',
        rows
    );
}

function normalizeSearchText(value) {
    return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es');
}

function createSearchMenu(categories, query, page = 0) {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) {
        return { type: 'text', text: 'Escribe qué comando buscas. Ejemplo: .menu buscar musica' };
    }

    const allCommands = getMenuCommands(categories);
    const results = allCommands.filter(item => {
        const categoryName = getCategoryPresentation(categories[item.categoryIndex]).title;
        return normalizeSearchText(`${item.command} ${categoryName}`).includes(normalizedQuery);
    });
    if (!results.length) {
        return { type: 'text', text: `No encontré comandos que coincidan con “${query}”. Prueba con otra búsqueda o escribe .menu.` };
    }

    const pageCount = Math.ceil(results.length / COMMAND_PAGE_SIZE);
    const currentPage = Math.max(0, Math.min(page, pageCount - 1));
    const start = currentPage * COMMAND_PAGE_SIZE;
    const rows = results.slice(start, start + COMMAND_PAGE_SIZE).map(item => ({
        title: limitRowTitle(item.command),
        description: limitRowTitle(getCategoryPresentation(categories[item.categoryIndex]).title),
        rowId: `${ROW_PREFIX}:command:${allCommands.indexOf(item)}:search:${encodeURIComponent(query)}:${currentPage}`
    }));

    if (currentPage > 0) {
        rows.push({
            title: '‹ Resultados anteriores',
            rowId: `${ROW_PREFIX}:search:${encodeURIComponent(query)}:${currentPage - 1}`
        });
    }
    if (currentPage + 1 < pageCount) {
        rows.push({
            title: 'Más resultados ›',
            rowId: `${ROW_PREFIX}:search:${encodeURIComponent(query)}:${currentPage + 1}`
        });
    }
    rows.push({
        title: '↩ Volver a categorías',
        rowId: `${ROW_PREFIX}:categories:0`
    });

    return createList(
        'Gonx!ta · Búsqueda',
        `Resultados para “${query}” · Página ${currentPage + 1}/${pageCount}`,
        `Coincidencias · ${results.length}`,
        rows
    );
}

function createCommandDetails(categories, commandIndex, backRowId) {
    const commands = getMenuCommands(categories);
    const item = commands[commandIndex];
    if (!item) return null;

    const presentation = getCategoryPresentation(categories[item.categoryIndex]);
    const description = COMMAND_DESCRIPTIONS[item.command]
        || `Comando de ${presentation.title}. Si requiere parámetros, el bot te indicará cómo utilizarlos.`;
    return createList(
        item.command,
        description,
        'Opciones',
        [
            {
                title: '▶ Ejecutar',
                description: 'El bot validará parámetros y permisos',
                rowId: `${ROW_PREFIX}:execute:${commandIndex}`
            },
            {
                title: '↩ Volver',
                rowId: backRowId
            },
            {
                title: '⌂ Inicio',
                rowId: `${ROW_PREFIX}:categories:0`
            }
        ]
    );
}

function createWhatsAppMenuResponse(categories, rowId = '') {
    categories = createMenuCategories(categories);
    if (!rowId) return createCategoriesMenu(categories);
    if (!rowId.startsWith(`${ROW_PREFIX}:`)) return null;

    const parts = rowId.split(':');
    const action = parts[1];
    if (action === 'categories' && /^\d+$/.test(parts[2] || '')) {
        return createCategoriesMenu(categories, Number(parts[2]));
    }
    if (action === 'category' && /^\d+$/.test(parts[2] || '')) {
        return createCommandsMenu(categories, Number(parts[2]));
    }
    if (action === 'all' && /^\d+$/.test(parts[2] || '')) {
        return createCommandsMenu(categories, -1, Number(parts[2]));
    }
    if (action === 'commands' && /^-?\d+$/.test(parts[2] || '') && /^\d+$/.test(parts[3] || '')) {
        return createCommandsMenu(categories, Number(parts[2]), Number(parts[3]));
    }
    if (action === 'command' && /^\d+$/.test(parts[2] || '')) {
        let backRowId;
        if (parts[3] === 'category' && /^\d+$/.test(parts[4] || '') && /^\d+$/.test(parts[5] || '')) {
            backRowId = `${ROW_PREFIX}:commands:${Number(parts[4])}:${Number(parts[5])}`;
        } else if (parts[3] === 'all' && /^\d+$/.test(parts[4] || '')) {
            backRowId = `${ROW_PREFIX}:all:${Number(parts[4])}`;
        } else if (parts[3] === 'search' && /^\d+$/.test(parts[5] || '')) {
            try {
                decodeURIComponent(parts[4] || '');
            } catch {
                return null;
            }
            backRowId = `${ROW_PREFIX}:search:${parts[4]}:${Number(parts[5])}`;
        } else {
            return null;
        }
        return createCommandDetails(categories, Number(parts[2]), backRowId);
    }
    if (action === 'search' && /^\d+$/.test(parts[3] || '')) {
        let query;
        try {
            query = decodeURIComponent(parts[2] || '');
        } catch {
            return null;
        }
        return createSearchMenu(categories, query, Number(parts[3]));
    }
    return null;
}

async function sendWhatsAppMenu({
    categories,
    jid,
    sock,
    generateWAMessageFromContent,
    logger,
    selection = '',
    query = '',
    fallbackUrl = ''
}) {
    const rowId = selection || (query
        ? `${ROW_PREFIX}:search:${encodeURIComponent(query)}:0`
        : '');
    const response = createWhatsAppMenuResponse(categories, rowId);
    if (!response) return false;
    if (response.type === 'text') {
        await sock.sendMessage(jid, { text: response.text });
        return true;
    }
    if (typeof generateWAMessageFromContent !== 'function') {
        throw new Error('Baileys no puede generar mensajes interactivos en este momento.');
    }

    const generatedMessage = generateWAMessageFromContent(
        jid,
        createWhatsAppInteractiveMessage(response.payload),
        {
            userJid: sock.user?.id || sock.user?.lid || jid,
            logger
        }
    );
    if (!generatedMessage?.key?.id || !generatedMessage.message) {
        throw new Error('Baileys generó una lista interactiva inválida.');
    }

    let acknowledgementTimer;
    let fallbackSent = false;
    let acknowledgementReceived = false;
    const cleanupAcknowledgementListeners = () => {
        clearTimeout(acknowledgementTimer);
        sock.ev?.off?.('messages.update', onMessageUpdate);
        sock.ev?.off?.('message-receipt.update', onReceiptUpdate);
    };
    const sendTextFallback = errorCode => {
        if (fallbackSent) return;
        fallbackSent = true;
        const reason = errorCode ? ` (código ${errorCode})` : '';
        void sock.sendMessage(jid, {
            text: `⚠️ WhatsApp no mostró la lista interactiva${reason}. Abre el panel o usa estos comandos:\n\n${createTextWhatsAppMenu(
                categories,
                fallbackUrl || 'Escribe .menu web para abrir el panel.'
            )}`
        }).catch(error => {
            if (typeof logger?.error === 'function') {
                logger.error({ error: error.message }, 'No se pudo enviar el menú alternativo');
            }
        });
    };
    const onMessageUpdate = updates => {
        const matchingUpdate = updates.find(update => update.key?.id === generatedMessage.key.id);
        if (!matchingUpdate) return;

        const status = matchingUpdate.update?.status;
        const errorCode = matchingUpdate.update?.messageStubParameters?.[0];
        if (status >= 2 && !errorCode) acknowledgementReceived = true;
        if (errorCode || status === 0 || status >= 3) cleanupAcknowledgementListeners();
        if (errorCode || status === 0) sendTextFallback(errorCode);
    };
    const onReceiptUpdate = updates => {
        if (updates.some(update => update.key?.id === generatedMessage.key.id)) {
            cleanupAcknowledgementListeners();
        }
    };

    if (sock.ev?.on) {
        sock.ev.on('messages.update', onMessageUpdate);
        sock.ev.on('message-receipt.update', onReceiptUpdate);
        acknowledgementTimer = setTimeout(() => {
            cleanupAcknowledgementListeners();
            if (!acknowledgementReceived) sendTextFallback();
        }, 30000);
        acknowledgementTimer.unref?.();
    }

    try {
        await sock.relayMessage(jid, generatedMessage.message, {
            messageId: generatedMessage.key.id
        });
    } catch (error) {
        cleanupAcknowledgementListeners();
        if (typeof logger?.warn === 'function') {
            logger.warn({ error: error.message }, 'No se pudo enviar la lista interactiva');
        }
        await sock.sendMessage(jid, {
            text: `⚠️ No se pudo enviar la lista interactiva. Abre el panel o usa estos comandos:\n\n${createTextWhatsAppMenu(
                categories,
                fallbackUrl || 'Escribe .menu web para abrir el panel.'
            )}`
        });
    }
    return true;
}

function createWhatsAppMenuPanelMessage(url, expiresAt = null) {
    let panelUrl;
    try {
        panelUrl = new URL(url);
    } catch {
        throw new Error('El enlace del panel no es válido.');
    }
    if (panelUrl.protocol !== 'https:') {
        throw new Error('El enlace del panel debe usar HTTPS.');
    }

    const expiration = expiresAt
        ? ` Este enlace temporal vence a las ${new Date(expiresAt).toLocaleTimeString('es', {
            hour: '2-digit',
            minute: '2-digit'
        })}.`
        : '';
    return {
        interactiveMessage: {
            header: {
                title: 'Gonx!ta Bot',
                subtitle: 'MENÚ INTERACTIVO',
                hasMediaAttachment: false
            },
            body: {
                text: `Explora las categorías, busca comandos y toca uno para ver sus detalles.${expiration}`
            },
            footer: {
                text: 'Abre el panel dentro de WhatsApp'
            },
            nativeFlowMessage: {
                buttons: [{
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                        display_text: 'Abrir menú',
                        url: panelUrl.toString(),
                        merchant_url: panelUrl.toString()
                    })
                }],
                messageVersion: 1
            }
        }
    };
}

async function sendWhatsAppMenuPanel({
    jid,
    sock,
    generateWAMessageFromContent,
    logger,
    url,
    expiresAt = null
}) {
    const fallbackText = errorCode => {
        const reason = errorCode ? ` (código ${errorCode})` : '';
        return `⚠️ WhatsApp no mostró el botón del panel${reason}. Abre el panel desde este enlace:\n${url}`;
    };
    const sendTextFallback = errorCode => {
        void sock.sendMessage(jid, { text: fallbackText(errorCode) }).catch(error => {
            if (typeof logger?.error === 'function') {
                logger.error({ error: error.message }, 'No se pudo enviar el enlace alternativo del panel');
            }
        });
    };
    const warn = (error, message) => {
        if (typeof logger?.warn === 'function') {
            logger.warn({ error: error.message }, message);
        }
    };

    const content = createWhatsAppMenuPanelMessage(url, expiresAt);
    if (typeof generateWAMessageFromContent !== 'function') {
        sendTextFallback();
        return true;
    }

    let generatedMessage;
    try {
        generatedMessage = generateWAMessageFromContent(
            jid,
            content,
            {
                userJid: sock.user?.id || sock.user?.lid || jid,
                logger
            }
        );
    } catch (error) {
        warn(error, 'No se pudo generar el botón del panel');
        sendTextFallback();
        return true;
    }
    if (!generatedMessage?.key?.id || !generatedMessage.message) {
        const error = new Error('Baileys generó un botón del panel inválido.');
        warn(error, 'No se pudo generar el botón del panel');
        sendTextFallback();
        return true;
    }

    let acknowledgementTimer;
    let fallbackSent = false;
    const cleanupAcknowledgementListeners = () => {
        clearTimeout(acknowledgementTimer);
        sock.ev?.off?.('messages.update', onMessageUpdate);
        sock.ev?.off?.('message-receipt.update', onReceiptUpdate);
    };
    const onMessageUpdate = updates => {
        const matchingUpdate = updates.find(update => update.key?.id === generatedMessage.key.id);
        if (!matchingUpdate) return;

        const status = matchingUpdate.update?.status;
        const errorCode = matchingUpdate.update?.messageStubParameters?.[0];
        if (errorCode || status === 0 || status >= 3) cleanupAcknowledgementListeners();
        if (errorCode || status === 0) {
            if (fallbackSent) return;
            fallbackSent = true;
            sendTextFallback(errorCode);
        }
    };
    const onReceiptUpdate = updates => {
        if (updates.some(update => update.key?.id === generatedMessage.key.id)) {
            cleanupAcknowledgementListeners();
        }
    };

    if (sock.ev?.on) {
        sock.ev.on('messages.update', onMessageUpdate);
        sock.ev.on('message-receipt.update', onReceiptUpdate);
        acknowledgementTimer = setTimeout(cleanupAcknowledgementListeners, 30000);
        acknowledgementTimer.unref?.();
    }

    try {
        await sock.relayMessage(jid, generatedMessage.message, {
            messageId: generatedMessage.key.id
        });
    } catch (error) {
        cleanupAcknowledgementListeners();
        warn(error, 'No se pudo enviar el botón del panel');
        if (!fallbackSent) {
            fallbackSent = true;
            await sock.sendMessage(jid, { text: fallbackText() });
        }
    }
    return true;
}

function getWhatsAppMenuExecution(categories, rowId) {
    if (typeof rowId !== 'string') return null;
    const match = rowId.match(/^gonxta-menu:execute:(\d+)$/);
    if (!match) return null;
    const item = getMenuCommands(createMenuCategories(categories))[Number(match[1])];
    return item?.command || null;
}

module.exports = {
    createWhatsAppInteractiveMessage,
    createWhatsAppMenuResponse,
    createMenuCategories,
    createWhatsAppMenuPanelMessage,
    createTextWhatsAppMenu,
    createTextWhatsAppSearch,
    getWhatsAppMenuExecution,
    getWhatsAppMenuSelection,
    getMenuCommands,
    sendWhatsAppMenu,
    sendWhatsAppMenuPanel
};
