const CANVAS_SIZE = 512;
const TEXT_PADDING = 48;
const FONT_FAMILY = 'Segoe UI Emoji, Noto Color Emoji, Segoe UI Symbol, Arial, Helvetica, sans-serif';

function escapeXml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function characterWidth(character) {
    if (/\s/.test(character)) return 0.3;
    const codePoint = character.codePointAt(0);
    if (codePoint === 0x200d || (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
        (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)) return 0;
    if ((codePoint >= 0x1f000 && codePoint <= 0x1ffff) ||
        (codePoint >= 0x2600 && codePoint <= 0x27ff)) return 1;
    if (codePoint > 0x2e7f) return 1;
    if (/[ilI.,:;!|'`]/.test(character)) return 0.34;
    if (/[mwMW@%&]/.test(character)) return 1;
    if (/[A-Z0-9]/.test(character)) return 0.74;
    return 0.62;
}

function measureText(text, fontSize) {
    return Array.from(text).reduce((width, character) => width + characterWidth(character) * fontSize, 0);
}

function wrapText(text, fontSize, maxWidth) {
    const lines = [];
    let line = '';

    for (const word of text.split(' ')) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && measureText(candidate, fontSize) > maxWidth) {
            lines.push(line);
            line = word;
        } else {
            line = candidate;
        }
    }

    if (line) lines.push(line);
    return lines;
}

function createBratLayout(input) {
    const text = String(input || '').replace(/\s+/g, ' ').trim();
    if (!text) throw new TypeError('El texto del sticker es obligatorio.');
    if (Array.from(text).length > 300) throw new RangeError('El texto del sticker no puede superar los 300 caracteres.');

    const maxWidth = CANVAS_SIZE - TEXT_PADDING * 2;
    for (let fontSize = 96; fontSize >= 8; fontSize--) {
        const lines = wrapText(text, fontSize, maxWidth);
        const lineHeight = fontSize * 1.12;
        const textHeight = lines.length * lineHeight;
        if (textHeight > CANVAS_SIZE - TEXT_PADDING * 2) continue;
        if (lines.some(line => measureText(line, fontSize) > maxWidth)) continue;

        const firstLineY = (CANVAS_SIZE - textHeight) / 2 + (lineHeight - fontSize) / 2 + fontSize * 0.8;
        return {
            lines,
            lineWidths: lines.map(line => measureText(line, fontSize)),
            maxWidth,
            fontSize,
            lineHeight,
            firstLineY,
            width: CANVAS_SIZE,
            height: CANVAS_SIZE
        };
    }

    throw new RangeError('El texto no cabe en el sticker. Usa un texto más corto.');
}

function renderBratSvg(layout, textMarkup) {
    return `<svg width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="#ffffff"/>
        <g font-family="${FONT_FAMILY}" font-size="${layout.fontSize}" font-weight="400" fill="#000000" text-anchor="middle">${textMarkup}</g>
    </svg>`;
}

function renderBratText(layout) {
    return layout.lines.map((line, index) =>
        `<text x="${CANVAS_SIZE / 2}" y="${layout.firstLineY + index * layout.lineHeight}">${escapeXml(line)}</text>`
    ).join('');
}

function renderBratProgress(layout, activeWordIndex) {
    let wordIndex = 0;
    return layout.lines.map((line, lineIndex) => {
        const words = line.split(' ');
        const spans = words.map((word, wordInLine) => {
            const isVisible = wordIndex++ <= activeWordIndex;
            const hidden = isVisible ? '' : ' fill="#ffffff"';
            const trailingSpace = wordInLine < words.length - 1 ? ' ' : '';
            return `<tspan${hidden}>${escapeXml(word + trailingSpace)}</tspan>`;
        }).join('');
        return `<text x="${CANVAS_SIZE / 2}" y="${layout.firstLineY + lineIndex * layout.lineHeight}">${spans}</text>`;
    }).join('');
}

module.exports = {
    CANVAS_SIZE,
    FONT_FAMILY,
    createBratLayout,
    escapeXml,
    renderBratSvg,
    renderBratText,
    renderBratProgress
};
