const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWelcomeMessage, handleSetWelcomeCommand, MAX_WELCOME_IMAGE_BYTES } = require('../services/commands/admin/welcome');

function createContext({ message, messageText, settings = {}, downloadQuotedMedia = async () => null, isGroupChat = true, isAdmin = true, saveDBImmediate = () => true }) {
    const sent = [];
    return {
        sent,
        settings,
        context: {
            jid: 'group@g.us',
            isGroupChat,
            isAdmin,
            message,
            messageText,
            unwrapViewOnceMessage: value => value,
            downloadQuotedMedia,
            ensureGroupSettings: () => settings,
            saveDBImmediate,
            imageDirectory: fs.mkdtempSync(path.join(os.tmpdir(), 'welcome-command-')),
            sock: { async sendMessage(jid, payload) { sent.push({ jid, ...payload }); } },
            logger: { error() {}, warn() {} }
        }
    };
}

function cleanup(context) {
    fs.rmSync(context.imageDirectory, { recursive: true, force: true });
}

test('setwelcome saves custom text, enables it, and clears an old image', async () => {
    const context = createContext({
        message: { conversation: '.setwelcome Hola {user}' },
        messageText: '.setwelcome Hola {user}',
        settings: { welcomeImage: 'old.jpg', welcomeImageMime: 'image/jpeg' }
    });
    try {
        const handled = await handleSetWelcomeCommand(context.context);
        assert.equal(handled, true);
        assert.equal(context.settings.welcomeText, 'Hola {user}');
        assert.equal(context.settings.welcomeImage, null);
        assert.equal(context.settings.welcomeImageMime, null);
        assert.equal(context.settings.welcomeEnabled, true);
        assert.match(context.sent[0].text, /guardada/);
    } finally {
        cleanup(context.context);
    }
});

test('setwelcome stores an image attached to the command and its text', async () => {
    const imageBuffer = Buffer.from('fake image data');
    const message = { imageMessage: { mimetype: 'image/png', caption: '.setwelcome Bienvenido {user}' } };
    const context = createContext({
        message,
        messageText: message.imageMessage.caption,
        downloadQuotedMedia: async (actualMessage, maxBytes) => {
            assert.equal(actualMessage, message);
            assert.equal(maxBytes, MAX_WELCOME_IMAGE_BYTES);
            return { type: 'image', data: imageBuffer, message: message.imageMessage };
        }
    });
    try {
        await handleSetWelcomeCommand(context.context);
        assert.equal(context.settings.welcomeText, 'Bienvenido {user}');
        assert.equal(context.settings.welcomeImageMime, 'image/png');
        const imagePath = path.join(context.context.imageDirectory, context.settings.welcomeImage);
        assert.deepEqual(fs.readFileSync(imagePath), imageBuffer);
        assert.match(context.sent[0].text, /con imagen/);
    } finally {
        cleanup(context.context);
    }
});

test('setwelcome rejects missing text without changing settings', async () => {
    let saved = false;
    const context = createContext({
        message: { conversation: '.setwelcome' },
        messageText: '.setwelcome',
        settings: { welcomeText: 'Existing welcome' },
        saveDBImmediate: () => { saved = true; return true; }
    });
    try {
        await handleSetWelcomeCommand(context.context);
        assert.equal(saved, false);
        assert.equal(context.settings.welcomeText, 'Existing welcome');
        assert.match(context.sent[0].text, /Escribe el texto/);
    } finally {
        cleanup(context.context);
    }
});

test('welcome message includes the joining participant and optional image', () => {
    const image = Buffer.from('image');
    const withImage = createWelcomeMessage('Bienvenido {user}', '123:4@s.whatsapp.net', image, 'image/png');
    assert.equal(withImage.caption, 'Bienvenido @123');
    assert.equal(withImage.image, image);
    assert.equal(withImage.mimetype, 'image/png');
    assert.deepEqual(withImage.mentions, ['123:4@s.whatsapp.net']);

    const textOnly = createWelcomeMessage('Hola', '456@s.whatsapp.net');
    assert.equal(textOnly.text, 'Hola\n\n@456');
    assert.deepEqual(textOnly.mentions, ['456@s.whatsapp.net']);
});
