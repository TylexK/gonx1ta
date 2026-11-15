const MAX_STICKER_BYTES = 10 * 1024 * 1024;
const MAX_STICKER_AUTHOR_LENGTH = 100;
const STICKER_PACK_NAME = '';
const EXIF_FLAG = 0x08;
const XMP_FLAG = 0x04;

function makeStickerExif(author) {
    const metadata = Buffer.from(JSON.stringify({
        'sticker-pack-id': 'gonxta-bot',
        'sticker-pack-name': STICKER_PACK_NAME,
        'sticker-pack-publisher': author,
        emojis: []
    }), 'utf8');

    const tiffHeader = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
    const ifdEntry = Buffer.alloc(12);
    ifdEntry.writeUInt16LE(0x5741, 0);
    ifdEntry.writeUInt16LE(7, 2);
    ifdEntry.writeUInt32LE(metadata.length, 4);
    ifdEntry.writeUInt32LE(26, 8);
    const ifdCount = Buffer.alloc(2);
    ifdCount.writeUInt16LE(1, 0);

    return Buffer.concat([tiffHeader, ifdCount, ifdEntry, Buffer.alloc(4), metadata]);
}

function makeVp8xChunk(width, height) {
    const header = Buffer.alloc(18);
    header.write('VP8X', 0, 'ascii');
    header.writeUInt32LE(10, 4);
    header[8] = EXIF_FLAG;
    header.writeUIntLE(width - 1, 12, 3);
    header.writeUIntLE(height - 1, 15, 3);
    return header;
}

function getImageDimensions(chunks) {
    const vp8 = chunks.find(chunk => chunk.id === 'VP8 ');
    if (vp8?.data.length >= 10 &&
        vp8.data[3] === 0x9d && vp8.data[4] === 0x01 && vp8.data[5] === 0x2a) {
        return {
            width: vp8.data.readUInt16LE(6) & 0x3fff,
            height: vp8.data.readUInt16LE(8) & 0x3fff
        };
    }

    const vp8l = chunks.find(chunk => chunk.id === 'VP8L');
    if (vp8l?.data.length >= 5 && vp8l.data[0] === 0x2f) {
        return {
            width: 1 + (((vp8l.data[2] & 0x3f) << 8) | vp8l.data[1]),
            height: 1 + (((vp8l.data[4] & 0x0f) << 10) |
                (vp8l.data[3] << 2) |
                ((vp8l.data[2] & 0xc0) >> 6))
        };
    }

    throw new Error('No se pudieron leer las dimensiones del sticker WebP.');
}

function encodeChunk(id, data) {
    const header = Buffer.alloc(8);
    header.write(id, 0, 'ascii');
    header.writeUInt32LE(data.length, 4);
    return data.length % 2
        ? Buffer.concat([header, data, Buffer.alloc(1)])
        : Buffer.concat([header, data]);
}

function addStickerMetadata(webp, author) {
    if (!Buffer.isBuffer(webp) || webp.length < 12 ||
        webp.toString('ascii', 0, 4) !== 'RIFF' ||
        webp.toString('ascii', 8, 12) !== 'WEBP' ||
        webp.readUInt32LE(4) !== webp.length - 8) {
        throw new Error('El archivo citado no es un sticker WebP válido.');
    }

    const chunks = [];
    let offset = 12;
    while (offset < webp.length) {
        if (offset + 8 > webp.length) throw new Error('El sticker WebP está incompleto.');

        const chunkId = webp.toString('ascii', offset, offset + 4);
        const chunkSize = webp.readUInt32LE(offset + 4);
        const chunkEnd = offset + 8 + chunkSize;
        if (chunkEnd > webp.length) throw new Error('El sticker WebP contiene datos incompletos.');

        const paddedEnd = chunkEnd + (chunkSize % 2);
        if (paddedEnd > webp.length) throw new Error('El sticker WebP contiene un bloque inválido.');
        if (chunkId !== 'EXIF' && chunkId !== 'XMP ') {
            chunks.push({ id: chunkId, data: webp.subarray(offset + 8, chunkEnd) });
        }
        offset = chunkEnd + (chunkSize % 2);
    }

    const vp8xChunks = chunks.filter(chunk => chunk.id === 'VP8X');
    if (vp8xChunks.length > 1 || (vp8xChunks.length === 1 && vp8xChunks[0].data.length !== 10)) {
        throw new Error('El encabezado VP8X del sticker WebP es inválido.');
    }
    if (vp8xChunks.length === 1) {
        vp8xChunks[0].data[0] = (vp8xChunks[0].data[0] | EXIF_FLAG) & ~XMP_FLAG;
    } else {
        const { width, height } = getImageDimensions(chunks);
        if (!width || !height || width > 0x1000000 || height > 0x1000000) {
            throw new Error('Las dimensiones del sticker WebP son inválidas.');
        }
        chunks.unshift({ id: 'VP8X', data: makeVp8xChunk(width, height).subarray(8) });
    }

    const exif = { id: 'EXIF', data: makeStickerExif(author) };
    const xmpIndex = chunks.findIndex(chunk => chunk.id === 'XMP ');
    chunks.splice(xmpIndex === -1 ? chunks.length : xmpIndex, 0, exif);
    const content = Buffer.concat(chunks.map(chunk => encodeChunk(chunk.id, chunk.data)));
    const riffHeader = Buffer.alloc(12);
    riffHeader.write('RIFF', 0, 'ascii');
    riffHeader.writeUInt32LE(content.length + 4, 4);
    riffHeader.write('WEBP', 8, 'ascii');
    return Buffer.concat([riffHeader, content]);
}

async function handleStickerCommand({
    command,
    args,
    jid,
    message,
    sock,
    getQuotedMessageContextInfo,
    unwrapMessage,
    downloadContentFromMessage,
    logger
}) {
    if (command !== '.wm') return false;

    const author = args.join(' ').trim();
    if (!author) {
        await sock.sendMessage(jid, {
            text: '╭━━━〔 🎨 STICKER MAKER 〕━━━╮\n' +
                '┃ Usa: .wm Nombre\n' +
                '┃ Responde a un sticker para cambiar\n' +
                '┃ su autor y devolverlo modificado.\n' +
                '╰━━━━━━━━━━━━━━━━━━━━╯'
        }, { quoted: message });
        return true;
    }
    if (author.length > MAX_STICKER_AUTHOR_LENGTH) {
        await sock.sendMessage(jid, {
            text: `❌ El nombre no puede superar los ${MAX_STICKER_AUTHOR_LENGTH} caracteres.`
        }, { quoted: message });
        return true;
    }
    if (/[\u0000-\u001f\u007f]/.test(author)) {
        await sock.sendMessage(jid, {
            text: '❌ El nombre no puede contener caracteres de control ni saltos de línea.'
        }, { quoted: message });
        return true;
    }

    const quotedMessage = getQuotedMessageContextInfo(message?.message || message)?.quotedMessage;
    const stickerMessage = unwrapMessage(quotedMessage)?.stickerMessage;
    if (!stickerMessage) {
        await sock.sendMessage(jid, {
            text: '⚠️ Debes responder directamente a un sticker con .wm Nombre.'
        }, { quoted: message });
        return true;
    }

    try {
        const stream = await downloadContentFromMessage(stickerMessage, 'sticker');
        const chunks = [];
        let size = 0;
        for await (const chunk of stream) {
            size += chunk.length;
            if (size > MAX_STICKER_BYTES) {
                await sock.sendMessage(jid, {
                    text: '❌ El sticker supera el límite de 10 MB.'
                }, { quoted: message });
                return true;
            }
            chunks.push(chunk);
        }

        const sticker = addStickerMetadata(Buffer.concat(chunks), author);
        await sock.sendMessage(jid, { sticker }, { quoted: message });
    } catch (error) {
        logger.error({ jid, error: error.message }, 'Error procesando .wm');
        await sock.sendMessage(jid, {
            text: '❌ No se pudo modificar el sticker. Inténtalo con otro sticker.'
        }, { quoted: message });
    }

    return true;
}

module.exports = {
    addStickerMetadata,
    handleStickerCommand
};
