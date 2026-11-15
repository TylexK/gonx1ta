const test = require('node:test');
const assert = require('node:assert/strict');
const { addStickerMetadata, handleStickerCommand } = require('../services/commands/stickers/stickers');

function makeChunk(id, data) {
    const header = Buffer.alloc(8);
    header.write(id, 0, 'ascii');
    header.writeUInt32LE(data.length, 4);
    return data.length % 2
        ? Buffer.concat([header, data, Buffer.alloc(1)])
        : Buffer.concat([header, data]);
}

function makeWebp(chunks, includeVp8x = true) {
    if (includeVp8x && !chunks.some(chunk => chunk.toString('ascii', 0, 4) === 'VP8X')) {
        chunks = [makeChunk('VP8X', Buffer.from([0, 0, 0, 0, 0xff, 0x01, 0, 0xff, 0x01, 0])), ...chunks];
    }
    const body = Buffer.concat(chunks);
    const header = Buffer.alloc(12);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(body.length + 4, 4);
    header.write('WEBP', 8, 'ascii');
    return Buffer.concat([header, body]);
}

function getChunks(webp) {
    const chunks = [];
    let offset = 12;
    while (offset < webp.length) {
        const id = webp.toString('ascii', offset, offset + 4);
        const size = webp.readUInt32LE(offset + 4);
        chunks.push({ id, data: webp.subarray(offset + 8, offset + 8 + size) });
        offset += 8 + size + (size % 2);
    }
    return chunks;
}

function readStickerMetadata(exif) {
    const metadataSize = exif.readUInt32LE(14);
    const metadataOffset = exif.readUInt32LE(18);
    return JSON.parse(exif.toString('utf8', metadataOffset, metadataOffset + metadataSize));
}

function makeQuotedStickerMessage() {
    return {
        message: {
            extendedTextMessage: {
                contextInfo: {
                    quotedMessage: {
                        stickerMessage: { mimetype: 'image/webp' }
                    }
                }
            }
        }
    };
}

function createSocket() {
    const sent = [];
    return {
        sent,
        async sendMessage(jid, content, options) {
            sent.push({ jid, content, options });
        }
    };
}

test('wm sets fixed pack and requested author while preserving animated WebP chunks', () => {
    const animation = makeChunk('ANIM', Buffer.from([1, 2, 3, 4]));
    const frame = makeChunk('ANMF', Buffer.from([5, 6, 7, 8]));
    const image = makeChunk('VP8 ', Buffer.from([9, 10, 11, 12]));
    const result = addStickerMetadata(makeWebp([animation, frame, image]), 'GONX!TA BOT');
    const chunks = getChunks(result);

    assert.deepEqual(chunks.map(chunk => chunk.id), ['VP8X', 'ANIM', 'ANMF', 'VP8 ', 'EXIF']);
    assert.equal(chunks[0].data[0] & 0x08, 0x08);
    assert.deepEqual(chunks.slice(1, 4).map(chunk => chunk.data), [
        Buffer.from([1, 2, 3, 4]),
        Buffer.from([5, 6, 7, 8]),
        Buffer.from([9, 10, 11, 12])
    ]);
    assert.deepEqual(readStickerMetadata(chunks.at(-1).data), {
        'sticker-pack-id': 'gonxta-bot',
        'sticker-pack-name': '',
        'sticker-pack-publisher': 'GONX!TA BOT',
        emojis: []
    });
    assert.equal(result.readUInt32LE(4), result.length - 8);
});

test('wm replaces previous EXIF author without duplicating metadata', () => {
    const original = makeWebp([
        makeChunk('VP8 ', Buffer.from([1, 2, 3, 4])),
        makeChunk('XMP ', Buffer.from('<xmp>old author</xmp>')),
        makeChunk('EXIF', Buffer.from('old metadata'))
    ]);
    const first = addStickerMetadata(original, 'Kevin');
    const second = addStickerMetadata(first, 'OTRO NOMBRE');
    const chunks = getChunks(second);
    const metadata = readStickerMetadata(chunks.find(chunk => chunk.id === 'EXIF').data);

    assert.equal(chunks.filter(chunk => chunk.id === 'EXIF').length, 1);
    assert.equal(chunks.some(chunk => chunk.id === 'XMP '), false);
    assert.equal(chunks.find(chunk => chunk.id === 'VP8X').data[0] & 0x04, 0);
    assert.equal(metadata['sticker-pack-name'], '');
    assert.equal(metadata['sticker-pack-publisher'], 'OTRO NOMBRE');
});

test('wm creates a VP8X header and enables its EXIF flag for simple WebP stickers', () => {
    const lossyImage = Buffer.alloc(10);
    lossyImage[3] = 0x9d;
    lossyImage[4] = 0x01;
    lossyImage[5] = 0x2a;
    lossyImage.writeUInt16LE(512, 6);
    lossyImage.writeUInt16LE(512, 8);
    const original = makeWebp([makeChunk('VP8 ', lossyImage)], false);
    const result = addStickerMetadata(original, 'Autor nuevo');
    const chunks = getChunks(result);
    const vp8x = chunks.find(chunk => chunk.id === 'VP8X');

    assert.equal(chunks[0].id, 'VP8X');
    assert.equal(vp8x.data[0] & 0x08, 0x08);
    assert.equal(vp8x.data.readUIntLE(4, 3) + 1, 512);
    assert.equal(vp8x.data.readUIntLE(7, 3) + 1, 512);
});

test('wm downloads quoted sticker and sends modified sticker with quoted context', async () => {
    const sock = createSocket();
    const message = makeQuotedStickerMessage();
    const original = makeWebp([makeChunk('VP8 ', Buffer.from([1, 2, 3, 4]))]);
    let downloadedType;

    const handled = await handleStickerCommand({
        command: '.wm',
        args: ['OTRO', 'NOMBRE'],
        jid: 'group@g.us',
        message,
        sock,
        getQuotedMessageContextInfo: current => current.extendedTextMessage.contextInfo,
        unwrapMessage: current => current,
        downloadContentFromMessage: async function* (sticker, type) {
            assert.equal(sticker.mimetype, 'image/webp');
            downloadedType = type;
            yield original;
        },
        logger: { error() {} }
    });

    assert.equal(handled, true);
    assert.equal(downloadedType, 'sticker');
    assert.deepEqual(sock.sent[0].options, { quoted: message });
    assert.equal(
        readStickerMetadata(getChunks(sock.sent[0].content.sticker).at(-1).data)['sticker-pack-publisher'],
        'OTRO NOMBRE'
    );
});

test('wm explains usage when no author is supplied', async () => {
    const sock = createSocket();
    const handled = await handleStickerCommand({
        command: '.wm',
        args: [],
        jid: 'group@g.us',
        message: makeQuotedStickerMessage(),
        sock,
        logger: { error() {} }
    });

    assert.equal(handled, true);
    assert.match(sock.sent[0].content.text, /Usa: \.wm Nombre/);
});

test('wm requires a replied sticker', async () => {
    const sock = createSocket();
    const handled = await handleStickerCommand({
        command: '.wm',
        args: ['Autor'],
        jid: 'group@g.us',
        message: { message: {} },
        sock,
        getQuotedMessageContextInfo: () => null,
        unwrapMessage: current => current,
        logger: { error() {} }
    });

    assert.equal(handled, true);
    assert.match(sock.sent[0].content.text, /responder directamente a un sticker/);
});
