const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { createQrSvg, createQrImage, handleQrCommand } = require('../services/commands/multimedia/qr');

test('qr creates a scannable-size SVG with a quiet zone', () => {
    const svg = createQrSvg('https://example.com/á?x=1');

    assert.match(svg, /width="512" height="512"/);
    assert.match(svg, /fill="#fff"/);
    assert.match(svg, /shape-rendering="crispEdges"/);
    assert.match(svg, /<path d="M4,4/);
});

test('qr renders a 512 by 512 PNG', async () => {
    const image = await createQrImage('Texto de prueba 🔒');
    const metadata = await sharp(image).metadata();

    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 512);
});

test('qr rejects empty and oversized content', () => {
    assert.throws(() => createQrSvg('  '), /Escribe el texto/);
    assert.throws(() => createQrSvg('á'.repeat(501)), /1000 bytes/);
});

test('qr command replies with the generated image and quotes the request', async () => {
    const sent = [];
    const message = { key: { id: 'quoted-message' } };
    const sock = {
        async sendMessage(jid, content, options) {
            sent.push({ jid, content, options });
        }
    };

    const handled = await handleQrCommand({
        command: '.qr',
        args: ['https://example.com'],
        jid: 'chat@s.whatsapp.net',
        message,
        sock
    });

    assert.equal(handled, true);
    assert.equal(sent[0].jid, 'chat@s.whatsapp.net');
    assert.equal((await sharp(sent[0].content.image).metadata()).format, 'png');
    assert.deepEqual(sent[0].options, { quoted: message });
});
