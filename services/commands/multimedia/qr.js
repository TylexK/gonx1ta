const QRCode = require('qrcode-terminal/vendor/QRCode');
const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
const sharp = require('sharp');

const QR_IMAGE_SIZE = 512;
const QUIET_ZONE = 4;
const MAX_QR_BYTES = 1000;

function createQrSvg(input) {
    const text = String(input || '').trim();
    if (!text) throw new TypeError('Escribe el texto o enlace que quieres convertir en QR.');

    const data = Buffer.from(text, 'utf8');
    if (data.length > MAX_QR_BYTES) {
        throw new RangeError(`El contenido del QR no puede superar los ${MAX_QR_BYTES} bytes.`);
    }

    const qr = new QRCode(-1, QRErrorCorrectLevel.M);
    qr.addData(data.toString('latin1'));
    qr.make();

    const moduleCount = qr.getModuleCount();
    const paths = [];
    for (let row = 0; row < moduleCount; row++) {
        for (let column = 0; column < moduleCount; column++) {
            if (qr.isDark(row, column)) {
                paths.push(`M${column + QUIET_ZONE},${row + QUIET_ZONE}h1v1h-1z`);
            }
        }
    }

    const viewSize = moduleCount + QUIET_ZONE * 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${QR_IMAGE_SIZE}" height="${QR_IMAGE_SIZE}" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges"><rect width="${viewSize}" height="${viewSize}" fill="#fff"/><path d="${paths.join('')}" fill="#000"/></svg>`;
}

async function createQrImage(input) {
    return sharp(Buffer.from(createQrSvg(input))).png().toBuffer();
}

async function handleQrCommand({ command, args, jid, message, sock }) {
    if (command !== '.qr') return false;

    const text = args.join(' ').trim();
    if (!text) {
        await sock.sendMessage(jid, {
            text: '⚠️ Uso: .qr texto o enlace'
        }, { quoted: message });
        return true;
    }

    try {
        const image = await createQrImage(text);
        await sock.sendMessage(jid, {
            image,
            caption: 'Escanea este código QR.'
        }, { quoted: message });
    } catch (error) {
        if (error instanceof RangeError) {
            await sock.sendMessage(jid, { text: `⚠️ ${error.message}` }, { quoted: message });
            return true;
        }
        throw error;
    }

    return true;
}

module.exports = {
    createQrSvg,
    createQrImage,
    handleQrCommand
};
