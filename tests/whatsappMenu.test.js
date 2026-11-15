const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { categories } = require('../services/commands/categories');
const { FEATURED_MENU_COMMANDS } = require('../services/menuFeaturedCommands');
const {
    createMenuCategories,
    createTextWhatsAppMenu,
    createWhatsAppListMessage,
    createWhatsAppMenuPanelMessage,
    createWhatsAppMenuResponse,
    getMenuCommands,
    getWhatsAppMenuExecution,
    getWhatsAppMenuSelection,
    sendWhatsAppMenu,
    sendWhatsAppMenuPanel
} = require('../services/whatsappMenu');

test('native WhatsApp menu categorizes essential commands into 12 sections', () => {
    const menuCategories = createMenuCategories(categories);
    const sourceCommands = getMenuCommands(categories).map(item => item.command).sort();
    const menuCommands = getMenuCommands(menuCategories).map(item => item.command).sort();

    assert.deepEqual(menuCategories.map(category => category.title), [
        'Administración',
        'Economía',
        'Juegos',
        'Descargas',
        'Inteligencia artificial',
        'Música y multimedia',
        'Diversión',
        'Mascotas',
        'Perfil y usuarios',
        'Stickers',
        'Grupos',
        'Sistema'
    ]);
    assert.deepEqual(menuCommands, [...FEATURED_MENU_COMMANDS].sort());
    assert.ok(menuCommands.length < sourceCommands.length);
    assert.equal(new Set(menuCommands).size, menuCommands.length);
});

test('text WhatsApp menu highlights essential commands and links to the interactive menu', () => {
    const text = createTextWhatsAppMenu(categories, 'https://bot.example.com/menu');
    const registeredCommands = getMenuCommands(categories).map(item => item.command);

    assert.match(text, /COMANDOS ESENCIALES/);
    assert.match(text, /Explora y busca comandos esenciales en el menú interactivo/);
    assert.match(text, /https:\/\/bot\.example\.com\/menu/);
    assert.match(text, /\.daily/);
    assert.match(text, /\.antilink/);
    assert.ok(registeredCommands.includes('.antibot'));
    assert.doesNotMatch(text, /\.antibot/);
    assert.ok(text.split('\n').length < 70);
});

test('native WhatsApp menus paginate category and command lists within row limits', () => {
    const categoryMenu = createWhatsAppMenuResponse(categories);
    assert.equal(categoryMenu.type, 'list');
    assert.equal(categoryMenu.payload.listType, 1);
    assert.ok(categoryMenu.payload.sections[0].rows.length <= 10);
    assert.ok(categoryMenu.payload.sections[0].rows.every(row => Array.from(row.title).length <= 24));
    assert.ok(categoryMenu.payload.sections[0].rows.length > 0);

    const firstCategory = createWhatsAppMenuResponse(categories, 'gonxta-menu:category:0');
    assert.equal(firstCategory.type, 'list');
    assert.ok(firstCategory.payload.sections[0].rows.length <= 10);
    assert.ok(firstCategory.payload.sections[0].rows.some(row => row.title.startsWith('.')));

    const firstPage = createWhatsAppMenuResponse(categories, 'gonxta-menu:all:0');
    const nextPage = firstPage.payload.sections[0].rows.find(row => row.rowId === 'gonxta-menu:commands:-1:1');
    assert.ok(nextPage);
    const secondPage = createWhatsAppMenuResponse(categories, nextPage.rowId);
    assert.ok(secondPage.payload.sections[0].rows.length <= 10);
    assert.ok(secondPage.payload.sections[0].rows.some(row => row.rowId === 'gonxta-menu:commands:-1:0'));
});

test('selecting a command opens details with execute, back, and home options', () => {
    const allCommands = getMenuCommands(createMenuCategories(categories));
    const commandList = createWhatsAppMenuResponse(categories, 'gonxta-menu:category:0');
    const commandRow = commandList.payload.sections[0].rows.find(row => row.rowId.startsWith('gonxta-menu:command:'));
    assert.ok(commandRow);

    const details = createWhatsAppMenuResponse(categories, commandRow.rowId);
    assert.equal(details.type, 'list');
    assert.equal(details.payload.title, allCommands[Number(commandRow.rowId.split(':')[2])].command);
    assert.ok(details.payload.description.length > 0);

    const rows = details.payload.sections[0].rows;
    assert.ok(rows.some(row => row.rowId.startsWith('gonxta-menu:execute:')));
    assert.ok(rows.some(row => row.rowId.startsWith('gonxta-menu:commands:')));
    assert.ok(rows.some(row => row.rowId === 'gonxta-menu:categories:0'));
});

test('executing a selected menu command resolves the registered command', () => {
    const commands = getMenuCommands(createMenuCategories(categories));
    const index = commands.findIndex(item => item.command === '.ping');
    assert.notEqual(index, -1);

    assert.equal(
        getWhatsAppMenuExecution(categories, `gonxta-menu:execute:${index}`),
        '.ping'
    );
    assert.equal(getWhatsAppMenuExecution(categories, 'gonxta-menu:execute:99999'), null);
    assert.equal(getWhatsAppMenuExecution(categories, 'other-bot:execute:0'), null);
});

test('sending the menu relays a native WhatsApp list with its business type node', async () => {
    const sent = [];
    const relayed = [];
    const sock = {
        user: { id: 'bot@s.whatsapp.net' },
        async sendMessage(...args) { sent.push(args); },
        async relayMessage(...args) { relayed.push(args); }
    };
    const generated = {
        key: { id: 'generated-menu-id' },
        message: { listMessage: {} }
    };
    const generatedInputs = [];

    await sendWhatsAppMenu({
        categories,
        jid: 'user@s.whatsapp.net',
        sock,
        generateWAMessageFromContent(...args) {
            generatedInputs.push(args);
            return generated;
        },
        logger: { child() {} }
    });

    assert.equal(sent.length, 0);
    assert.equal(generatedInputs.length, 1);
    assert.equal(generatedInputs[0][1].listMessage.title, createWhatsAppMenuResponse(categories).payload.title);
    assert.deepEqual(relayed, [[
        'user@s.whatsapp.net',
        generated.message,
        {
            messageId: 'generated-menu-id',
            additionalNodes: [{
                tag: 'biz',
                attrs: {},
                content: [{
                    tag: 'list',
                    attrs: { type: 'product_list', v: '2' }
                }]
            }]
        }
    ]]);
});

test('panel button opens the HTTPS menu URL from WhatsApp', () => {
    const message = createWhatsAppMenuPanelMessage(
        'https://bot.example.com/menu?token=panel-token',
        Date.UTC(2026, 10, 14, 21, 46)
    );
    const interactive = message.interactiveMessage;
    const button = interactive.nativeFlowMessage.buttons[0];

    assert.equal(interactive.header.title, 'Gonx!ta Bot');
    assert.match(interactive.body.text, /Explora las categorías/);
    assert.match(interactive.body.text, /vence a las/);
    assert.equal(button.name, 'cta_url');
    assert.deepEqual(JSON.parse(button.buttonParamsJson), {
        display_text: 'Abrir menú',
        url: 'https://bot.example.com/menu?token=panel-token',
        merchant_url: 'https://bot.example.com/menu?token=panel-token'
    });
    assert.throws(
        () => createWhatsAppMenuPanelMessage('http://bot.example.com/menu'),
        /HTTPS/
    );
});

test('a rejected panel button falls back to its clickable panel link', async () => {
    const sent = [];
    const relayed = [];
    const events = new EventEmitter();
    const sock = {
        user: { id: 'bot@s.whatsapp.net' },
        ev: events,
        async sendMessage(...args) { sent.push(args); },
        async relayMessage(jid, message, options) {
            relayed.push([jid, message, options]);
            queueMicrotask(() => events.emit('messages.update', [{
                key: { id: options.messageId },
                update: { status: 0, messageStubParameters: ['479'] }
            }]));
        }
    };

    await sendWhatsAppMenuPanel({
        jid: 'user@s.whatsapp.net',
        sock,
        url: 'https://panel.example.com/menu?token=panel-token',
        generateWAMessageFromContent(jid, content) {
            return {
                key: { id: 'rejected-panel-id' },
                message: content
            };
        },
        logger: { warn() {}, error() {} }
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(relayed.length, 1);
    assert.equal(relayed[0][1].interactiveMessage.nativeFlowMessage.buttons[0].name, 'cta_url');
    assert.equal(sent.length, 1);
    assert.match(sent[0][1].text, /botón del panel \(código 479\)/);
    assert.match(sent[0][1].text, /https:\/\/panel\.example\.com\/menu\?token=panel-token/);
});

test('a rejected native list falls back to the menu link and essential commands', async () => {
    const sent = [];
    const events = new EventEmitter();
    const sock = {
        user: { id: 'bot@s.whatsapp.net' },
        ev: events,
        async sendMessage(...args) { sent.push(args); },
        async relayMessage(jid, message, options) {
            queueMicrotask(() => events.emit('messages.update', [{
                key: { id: options.messageId },
                update: { status: 0, messageStubParameters: ['479'] }
            }]));
        }
    };

    await sendWhatsAppMenu({
        categories,
        jid: 'user@s.whatsapp.net',
        sock,
        fallbackUrl: 'https://panel.example.com/menu',
        generateWAMessageFromContent() {
            return {
                key: { id: 'rejected-menu-id' },
                message: { listMessage: {} }
            };
        },
        logger: { child() {} }
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(sent.length, 1);
    assert.match(sent[0][1].text, /código 479/);
    assert.match(sent[0][1].text, /COMANDOS ESENCIALES/);
    assert.match(sent[0][1].text, /\.daily/);
    assert.match(sent[0][1].text, /https:\/\/panel.example.com\/menu/);
});

test('WhatsApp menu search is accent-insensitive and opens native command details', () => {
    const search = createWhatsAppMenuResponse(categories, 'gonxta-menu:search:m%C3%BAsica:0');
    assert.equal(search.type, 'list');
    const commandRow = search.payload.sections[0].rows.find(row => row.rowId.startsWith('gonxta-menu:command:'));
    assert.ok(commandRow);

    const details = createWhatsAppMenuResponse(categories, commandRow.rowId);
    assert.equal(details.type, 'list');
    assert.ok(details.payload.sections[0].rows.some(row => row.rowId === 'gonxta-menu:categories:0'));

    const backRow = details.payload.sections[0].rows.find(row => row.title === '↩ Volver');
    const previousSearch = createWhatsAppMenuResponse(categories, backRow.rowId);
    assert.equal(previousSearch.type, 'list');
    assert.match(previousSearch.payload.title, /Búsqueda/);
});

test('WhatsApp menu rejects unrelated and malformed list selections', () => {
    assert.equal(createWhatsAppMenuResponse(categories, 'other-bot:category:0'), null);
    assert.equal(createWhatsAppMenuResponse(categories, 'gonxta-menu:category:invalid'), null);
    assert.equal(createWhatsAppMenuResponse(categories, 'gonxta-menu:category:999'), null);
    assert.equal(createWhatsAppMenuResponse(categories, 'gonxta-menu:command:1:search:%E0%A4%A:0'), null);
});

test('Baileys serializes menu payload as a direct native WhatsApp list', async () => {
    const { generateWAMessageFromContent } = await import('@whiskeysockets/baileys');
    const menu = createWhatsAppMenuResponse(categories);
    const generated = generateWAMessageFromContent(
        'user@s.whatsapp.net',
        createWhatsAppListMessage(menu.payload),
        { userJid: 'bot@s.whatsapp.net' }
    );
    const list = generated.message.listMessage;

    assert.equal(list.title, menu.payload.title);
    assert.equal(list.description, menu.payload.description);
    assert.equal(list.buttonText, menu.payload.buttonText);
    assert.equal(list.listType, 1);
    assert.equal(list.sections[0].rows.length, menu.payload.sections[0].rows.length);
    assert.equal(list.sections[0].rows[0].rowId, menu.payload.sections[0].rows[0].rowId);
});

test('Baileys serializes the panel button as a native URL action', async () => {
    const { generateWAMessageFromContent } = await import('@whiskeysockets/baileys');
    const generated = generateWAMessageFromContent(
        'user@s.whatsapp.net',
        createWhatsAppMenuPanelMessage('https://bot.example.com/menu?token=panel-token'),
        { userJid: 'bot@s.whatsapp.net' }
    );
    const interactive = generated.message.interactiveMessage;

    assert.equal(interactive.header.title, 'Gonx!ta Bot');
    assert.equal(interactive.nativeFlowMessage.messageVersion, 1);
    assert.equal(interactive.nativeFlowMessage.buttons[0].name, 'cta_url');
    assert.deepEqual(JSON.parse(interactive.nativeFlowMessage.buttons[0].buttonParamsJson), {
        display_text: 'Abrir menú',
        url: 'https://bot.example.com/menu?token=panel-token',
        merchant_url: 'https://bot.example.com/menu?token=panel-token'
    });
});

test('WhatsApp menu reads native-flow selections and keeps legacy list replies working', () => {
    const selection = 'gonxta-menu:category:0';
    assert.equal(getWhatsAppMenuSelection({
        viewOnceMessage: {
            message: {
                interactiveResponseMessage: {
                    nativeFlowResponseMessage: {
                        name: 'single_select',
                        paramsJson: JSON.stringify({ id: selection })
                    }
                }
            }
        }
    }), selection);
    assert.equal(getWhatsAppMenuSelection({
        listResponseMessage: {
            singleSelectReply: { selectedRowId: selection }
        }
    }), selection);
    assert.equal(getWhatsAppMenuSelection({
        interactiveResponseMessage: {
            nativeFlowResponseMessage: { paramsJson: '{invalid' }
        }
    }), null);
});
