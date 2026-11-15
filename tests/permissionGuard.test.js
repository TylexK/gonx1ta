const test = require('node:test');
const assert = require('node:assert/strict');
const processCommands = require('../services/commands/legacy/processor');
const aiCommands = require('../services/commands/utility/ai');

async function dispatchScCommand(isAdmin) {
    const sent = [];
    await processCommands({
        command: '.sc',
        commandCategory: 'other',
        args: [],
        jid: 'user@s.whatsapp.net',
        sender: 'user@s.whatsapp.net',
        m: { message: {} },
        isGroupChat: false,
        isAdmin,
        expandedLocalCommands: { async handleExpandedLocalCommand() { return false; } },
        sock: { async sendMessage(jid, payload) { sent.push({ jid, ...payload }); } }
    });
    return sent;
}

test('legacy dispatcher enforces the admin-command list without undefined identifiers', async () => {
    const sent = await dispatchScCommand(false);
    assert.match(sent[0].text, /reservado para administradores/);
});

test('admin commands continue to reach their command-specific behavior', async () => {
    const sent = await dispatchScCommand(true);
    assert.match(sent[0].text, /solo funciona en grupos/);
});

test('legacy dispatcher passes the AI service to the AI command handler', async () => {
    const sent = [];
    const asked = [];
    await processCommands({
        command: '.ia',
        commandCategory: 'utility',
        args: [],
        aiCommands,
        aiQuestion: 'Hola',
        aiService: {
            async ask(...args) {
                asked.push(args);
                return 'Hola';
            }
        },
        jid: 'user@s.whatsapp.net',
        sender: 'user@s.whatsapp.net',
        isGroupChat: false,
        isAdmin: false,
        expandedLocalCommands: { async handleExpandedLocalCommand() { return false; } },
        logger: { warn() {} },
        sock: { async sendMessage(jid, payload) { sent.push({ jid, ...payload }); } }
    });

    assert.deepEqual(asked, [['user@s.whatsapp.net', 'user@s.whatsapp.net', 'Hola']]);
    assert.equal(sent[0].text, 'Hola');
});

test('menu command sends a direct panel button and opens the native menu', async () => {
    const sent = [];
    let panelRequest;
    let menuRequest;
    let linkRequested = false;
    await processCommands({
        command: '.menu',
        commandCategory: 'other',
        args: [],
        jid: 'user@s.whatsapp.net',
        sender: 'user@s.whatsapp.net',
        isGroupChat: false,
        isAdmin: false,
        createTemporaryMenuLink: async () => {
            linkRequested = true;
            return { url: 'https://bot.example.com/menu', expiresAt: null };
        },
        sendWhatsAppMenuPanel: async request => { panelRequest = request; return true; },
        sendWhatsAppMenu: async request => { menuRequest = request; return true; },
        expandedLocalCommands: { async handleExpandedLocalCommand() { return false; } },
        logger: { warn() {} },
        sock: { async sendMessage(jid, payload) { sent.push({ jid, ...payload }); } }
    });

    assert.equal(sent.length, 0);
    assert.equal(linkRequested, true);
    assert.equal(panelRequest.jid, 'user@s.whatsapp.net');
    assert.equal(panelRequest.url, 'https://bot.example.com/menu');
    assert.equal(menuRequest.jid, 'user@s.whatsapp.net');
    assert.equal(menuRequest.fallbackUrl, 'https://bot.example.com/menu');
});

test('menu command can search command names inside WhatsApp', async () => {
    const sent = [];
    let nativeMenuCalled = false;
    await processCommands({
        command: '.menu',
        commandCategory: 'other',
        args: ['buscar', 'música'],
        jid: 'user@s.whatsapp.net',
        sender: 'user@s.whatsapp.net',
        isGroupChat: false,
        isAdmin: false,
        sendWhatsAppMenu: async () => { nativeMenuCalled = true; },
        expandedLocalCommands: { async handleExpandedLocalCommand() { return false; } },
        logger: { warn() {} },
        sock: { async sendMessage(jid, payload) { sent.push({ jid, ...payload }); } }
    });

    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /Resultados para “música”/);
    assert.match(sent[0].text, /\.musica/);
    assert.equal(nativeMenuCalled, false);
});

test('menu web subcommand preserves the shareable HTML page link', async () => {
    const sent = [];
    await processCommands({
        command: '.menu',
        commandCategory: 'other',
        args: ['web'],
        jid: 'user@s.whatsapp.net',
        sender: 'user@s.whatsapp.net',
        isGroupChat: false,
        isAdmin: false,
        createTemporaryMenuLink: async () => ({
            url: 'https://tylexk.github.io/MENU/',
            expiresAt: null
        }),
        expandedLocalCommands: { async handleExpandedLocalCommand() { return false; } },
        logger: { warn() {} },
        sock: { async sendMessage(jid, payload) { sent.push({ jid, ...payload }); } }
    });

    assert.match(sent[0].text, /https:\/\/tylexk\.github\.io\/MENU\//);
    assert.match(sent[0].text, /Menú público interactivo/);
    assert.doesNotMatch(sent[0].text, /funciona hasta las/);
});

test('menu web falls back to essential commands when the panel server is disconnected', async () => {
    const sent = [];
    await processCommands({
        command: '.menu',
        commandCategory: 'other',
        args: ['web'],
        jid: 'user@s.whatsapp.net',
        sender: 'user@s.whatsapp.net',
        isGroupChat: false,
        isAdmin: false,
        createTemporaryMenuLink: async () => { throw new Error('connect ECONNREFUSED'); },
        expandedLocalCommands: { async handleExpandedLocalCommand() { return false; } },
        logger: { warn() {} },
        sock: { async sendMessage(jid, payload) { sent.push({ jid, ...payload }); } }
    });

    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /No pude conectar con el panel visual/);
    assert.match(sent[0].text, /COMANDOS ESENCIALES/);
    assert.doesNotMatch(sent[0].text, /ECONNREFUSED/);
});

test('doom command sends a temporary link for the browser game', async () => {
    const sent = [];
    const generatedLink = {
        url: 'https://bot.example.com/doom?token=game-token',
        expiresAt: Date.now() + 60 * 60 * 1000
    };
    const createTemporaryMenuLink = async page => {
        assert.equal(page, 'doom');
        return generatedLink;
    };

    await processCommands({
        command: '.doom',
        commandCategory: 'other',
        args: [],
        jid: 'user@s.whatsapp.net',
        sender: 'user@s.whatsapp.net',
        isGroupChat: false,
        isAdmin: false,
        createTemporaryMenuLink,
        expandedLocalCommands: { async handleExpandedLocalCommand() { return false; } },
        logger: { warn() {} },
        sock: { async sendMessage(jid, payload) { sent.push({ jid, ...payload }); } }
    });

    assert.match(sent[0].text, /ARENA INFERNAL/);
    assert.match(sent[0].text, /https:\/\/bot\.example\.com\/doom\?token=game-token/);
    assert.match(sent[0].text, /Este enlace funciona hasta las/);
});
