const test = require('node:test');
const assert = require('node:assert/strict');
const { handleAiCommand } = require('../services/commands/utility/ai');
const { handleGroupAdminCommand } = require('../services/commands/admin/groupAdmin');
const { normalizeCommand } = require('../services/commandAliases');

function createSocket() {
    const sent = [];
    return {
        sent,
        async sendMessage(jid, message) {
            sent.push({ jid, ...message });
        },
        async groupMetadata() {
            return {
                participants: [
                    { id: '111@s.whatsapp.net' },
                    { id: '222@s.whatsapp.net' }
                ]
            };
        },
        async groupParticipantsUpdate(...args) {
            this.groupUpdate = args;
        },
        async groupSettingUpdate(...args) {
            this.groupSettings = args;
        }
    };
}

test('tagall only sends mentions after group metadata is loaded', async () => {
    const sock = createSocket();
    const handled = await handleGroupAdminCommand({
        command: '.tagall',
        jid: 'group@g.us',
        isAdmin: true,
        participants: [],
        args: [],
        sender: 'admin@s.whatsapp.net',
        sock,
        registrarAccionAdmin() {}
    });

    assert.equal(handled, true);
    assert.deepEqual(sock.sent[0].mentions, ['111@s.whatsapp.net', '222@s.whatsapp.net']);
    assert.match(sock.sent[0].text, /Total: 2 participantes/);
});

test('tagall rejects non-admin users without loading group metadata', async () => {
    const sock = createSocket();
    const handled = await handleGroupAdminCommand({
        command: '.tagall',
        jid: 'group@g.us',
        isAdmin: false,
        participants: [],
        args: [],
        sender: 'member@s.whatsapp.net',
        sock,
        registrarAccionAdmin() {}
    });

    assert.equal(handled, true);
    assert.match(sock.sent[0].text, /Solo los administradores/);
});

test('hidetag passes participant mentions and records the action', async () => {
    const sock = createSocket();
    const actions = [];
    const participants = [{ id: '111@s.whatsapp.net' }];
    const handled = await handleGroupAdminCommand({
        command: '.hidetag',
        jid: 'group@g.us',
        isAdmin: true,
        participants,
        args: ['Aviso', 'importante'],
        sender: 'admin@s.whatsapp.net',
        sock,
        registrarAccionAdmin: (...args) => actions.push(args)
    });

    assert.equal(handled, true);
    assert.equal(sock.sent[0].text, 'Aviso importante');
    assert.deepEqual(sock.sent[0].mentions, ['111@s.whatsapp.net']);
    assert.equal(actions.length, 1);
});

test('registro shows only the requested latest group actions and mentions admins', async () => {
    const sock = createSocket();
    const handled = await handleGroupAdminCommand({
        command: '.registro',
        jid: 'group@g.us',
        isAdmin: true,
        participants: [],
        args: ['2'],
        sender: 'admin@s.whatsapp.net',
        registroAdmin: [
            { admin: 'first@s.whatsapp.net', accion: 'Primera acción', fecha: '01/01/2026' },
            { admin: 'second@s.whatsapp.net', accion: 'Segunda acción', fecha: '02/01/2026' },
            { admin: 'first@s.whatsapp.net', accion: 'Tercera acción', fecha: '03/01/2026' }
        ],
        sock,
        registrarAccionAdmin() {}
    });

    assert.equal(handled, true);
    assert.match(sock.sent[0].text, /ÚLTIMAS 2 ACCIONES/);
    assert.match(sock.sent[0].text, /Tercera acción/);
    assert.match(sock.sent[0].text, /Segunda acción/);
    assert.doesNotMatch(sock.sent[0].text, /Primera acción/);
    assert.deepEqual(sock.sent[0].mentions, ['first@s.whatsapp.net', 'second@s.whatsapp.net']);
});

test('registro rejects non-admin users', async () => {
    const sock = createSocket();
    const handled = await handleGroupAdminCommand({
        command: '.registro',
        jid: 'group@g.us',
        isAdmin: false,
        participants: [],
        args: [],
        sender: 'member@s.whatsapp.net',
        registroAdmin: [{ admin: 'admin@s.whatsapp.net', accion: 'Secreto', fecha: 'hoy' }],
        sock,
        registrarAccionAdmin() {}
    });

    assert.equal(handled, true);
    assert.match(sock.sent[0].text, /Solo administradores/);
    assert.doesNotMatch(sock.sent[0].text, /Secreto/);
});

test('registro validates its count', async () => {
    const sock = createSocket();
    const handled = await handleGroupAdminCommand({
        command: '.registro',
        jid: 'group@g.us',
        isAdmin: true,
        participants: [],
        args: ['21'],
        sender: 'admin@s.whatsapp.net',
        registroAdmin: [],
        sock,
        registrarAccionAdmin() {}
    });

    assert.equal(handled, true);
    assert.match(sock.sent[0].text, /Uso: \.registro/);
});

test('promote delegates role changes to the WhatsApp socket and records the action', async () => {
    const sock = createSocket();
    const actions = [];
    const handled = await handleGroupAdminCommand({
        command: '.promote',
        jid: 'group@g.us',
        isAdmin: true,
        participants: [],
        args: [],
        sender: 'admin@s.whatsapp.net',
        message: {
            message: {
                extendedTextMessage: {
                    contextInfo: { mentionedJid: ['111@s.whatsapp.net'] }
                }
            }
        },
        sock,
        registrarAccionAdmin: (...args) => actions.push(args)
    });

    assert.equal(handled, true);
    assert.deepEqual(sock.groupUpdate, ['group@g.us', ['111@s.whatsapp.net'], 'promote']);
    assert.deepEqual(sock.sent[0].mentions, ['111@s.whatsapp.net']);
    assert.equal(actions.length, 1);
});

test('group close uses the expected announcement setting', async () => {
    const sock = createSocket();
    const handled = await handleGroupAdminCommand({
        command: '.cerrar',
        jid: 'group@g.us',
        isAdmin: true,
        participants: [],
        args: [],
        sender: 'admin@s.whatsapp.net',
        sock,
        registrarAccionAdmin() {}
    });

    assert.equal(handled, true);
    assert.deepEqual(sock.groupSettings, ['group@g.us', 'announcement']);
    assert.match(sock.sent[0].text, /Grupo cerrado/);
});

test('.link sends the group invitation URL for admins', async () => {
    const sock = createSocket();
    sock.groupInviteCode = async jid => {
        assert.equal(jid, 'group@g.us');
        return 'invite-code';
    };
    const handled = await handleGroupAdminCommand({
        command: normalizeCommand('.link'),
        jid: 'group@g.us',
        isAdmin: true,
        participants: [],
        args: [],
        sender: 'admin@s.whatsapp.net',
        sock,
        registrarAccionAdmin() {}
    });

    assert.equal(handled, true);
    assert.equal(sock.sent[0].text, '🔗 *Link de invitación:*\nhttps://chat.whatsapp.com/invite-code');
});

test('AI reset clears the conversation scoped to the group and sender', async () => {
    const sock = createSocket();
    const resetIds = [];
    const handled = await handleAiCommand({
        command: '.iareset',
        jid: 'group@g.us',
        sender: 'user@s.whatsapp.net',
        isGroupChat: true,
        sock,
        aiService: { resetConversation: id => resetIds.push(id) },
        logger: { warn() {} }
    });

    assert.equal(handled, true);
    assert.deepEqual(resetIds, ['group@g.us:user@s.whatsapp.net']);
    assert.match(sock.sent[0].text, /borrado el contexto/);
});

test('AI provider diagnostics include safe status/code fields without provider message', async () => {
    const sock = createSocket();
    const logs = [];
    const privateMessage = 'do-not-log-secret';
    const handled = await handleAiCommand({
        command: '.ia',
        jid: 'user@s.whatsapp.net',
        sender: 'user@s.whatsapp.net',
        isGroupChat: false,
        question: 'Hola',
        sock,
        aiService: {
            async ask() {
                const error = new Error(privateMessage);
                error.code = 'AI_UNAVAILABLE';
                error.httpStatus = 429;
                error.providerCode = 'insufficient_quota';
                throw error;
            }
        },
        logger: { warn: (message, details) => logs.push({ message, details }) }
    });

    assert.equal(handled, true);
    assert.equal(logs[0].details.httpStatus, 429);
    assert.equal(logs[0].details.providerCode, 'insufficient_quota');
    assert.equal(JSON.stringify(logs).includes(privateMessage), false);
    assert.match(sock.sent[0].text, /temporalmente ocupado/);
});
