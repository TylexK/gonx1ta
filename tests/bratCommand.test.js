const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const {
    CANVAS_SIZE,
    FONT_FAMILY,
    createBratLayout,
    renderBratSvg,
    renderBratText,
    renderBratProgress
} = require('../services/commands/stickers/brat');

test('brat layout keeps a fixed square canvas and reduces font size for longer text', () => {
    const short = createBratLayout('Sacate');
    const long = createBratLayout('Sacate una para imaginarme la otra y recordar todo lo que vivimos');

    assert.equal(short.width, CANVAS_SIZE);
    assert.equal(short.height, CANVAS_SIZE);
    assert.equal(long.width, CANVAS_SIZE);
    assert.equal(long.height, CANVAS_SIZE);
    assert.ok(long.fontSize < short.fontSize);
    assert.ok(long.lines.length > 1);
});

test('brat SVG fills the whole 512x512 canvas white and uses the reference sans font', async () => {
    const layout = createBratLayout('Sacate una para imaginarme la otra');
    const svg = renderBratSvg(layout, renderBratText(layout));
    const { data, info } = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true });

    assert.equal(info.width, CANVAS_SIZE);
    assert.equal(info.height, CANVAS_SIZE);
    assert.match(svg, /fill="#ffffff"/);
    assert.match(svg, new RegExp(`font-family="${FONT_FAMILY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));

    const pixelAt = (x, y) => {
        const index = ((y * info.width) + x) * info.channels;
        return Array.from(data.subarray(index, index + 3));
    };
    assert.deepEqual(pixelAt(0, 0), [255, 255, 255]);
    assert.deepEqual(pixelAt(CANVAS_SIZE - 1, 0), [255, 255, 255]);
    assert.deepEqual(pixelAt(0, CANVAS_SIZE - 1), [255, 255, 255]);
    assert.deepEqual(pixelAt(CANVAS_SIZE - 1, CANVAS_SIZE - 1), [255, 255, 255]);
    assert.ok(data.some((value, index) => index % info.channels === 0 && value < 64));
});

test('brat layout rejects empty and overlong text', () => {
    assert.throws(() => createBratLayout('  \n  '), /obligatorio/);
    assert.throws(() => createBratLayout('x'.repeat(301)), /300 caracteres/);
});

test('brat constrains every rendered line to the available width, including long words', () => {
    const longWord = 'supercalifragilisticexpialidocious';
    const layout = createBratLayout(longWord);
    const svgText = renderBratText(layout);

    assert.deepEqual(layout.lines, [longWord]);
    assert.ok(layout.lineWidths.every(width => width <= layout.maxWidth));
    assert.equal((svgText.match(/<text /g) || []).length, layout.lines.length);
});

test('brat SVG keeps a long line within the canvas margins', async () => {
    const layout = createBratLayout('W'.repeat(20));
    const svg = renderBratSvg(layout, renderBratText(layout));
    const { data, info } = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const blackPixels = [];

    for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
            const index = ((y * info.width) + x) * info.channels;
            if (data[index] < 64 && data[index + 1] < 64 && data[index + 2] < 64) blackPixels.push(x);
        }
    }

    assert.ok(blackPixels.length > 0);
    assert.ok(Math.min(...blackPixels) >= 48);
    assert.ok(Math.max(...blackPixels) <= CANVAS_SIZE - 48);
});

test('brat uses a regular font weight instead of bold', () => {
    const layout = createBratLayout('Texto fino');
    const svg = renderBratSvg(layout, renderBratText(layout));

    assert.match(svg, /font-weight="400"/);
    assert.doesNotMatch(svg, /font-weight="600"/);
});

test('brat preserves emoji glyphs in the SVG font stack and layout', () => {
    const text = '😀 ❤️ 👍🏽 🚀';
    const layout = createBratLayout(text);
    const svg = renderBratSvg(layout, renderBratText(layout));

    assert.match(svg, /Segoe UI Emoji/);
    assert.ok(layout.lineWidths.every(width => width <= layout.maxWidth));
    assert.match(svg, /😀/);
    assert.match(svg, /👍🏽/);
});

test('bratv progressively reveals whole words and escapes markup', async () => {
    const layout = createBratLayout('palabraextraordinaria prueba <script>');
    const words = layout.lines.flatMap(line => line.split(' '));
    const firstFrame = renderBratProgress(layout, 0);
    const finalFrame = renderBratProgress(layout, words.length - 1);
    const firstSvg = renderBratSvg(layout, firstFrame);
    const finalSvg = renderBratSvg(layout, finalFrame);

    assert.equal((firstFrame.match(/fill="#ffffff"/g) || []).length, words.length - 1);
    assert.doesNotMatch(finalFrame, /fill="#ffffff"/);
    assert.match(finalFrame, /&lt;script&gt;/);
    assert.doesNotMatch(finalFrame, /<script>/);

    const [first, final] = await Promise.all([
        sharp(Buffer.from(firstSvg)).ensureAlpha().raw().toBuffer(),
        sharp(Buffer.from(finalSvg)).ensureAlpha().raw().toBuffer()
    ]);
    const countDarkPixels = buffer => {
        let count = 0;
        for (let index = 0; index < buffer.length; index += 4) {
            if (buffer[index + 3] > 128 &&
                buffer[index] < 64 && buffer[index + 1] < 64 && buffer[index + 2] < 64) count++;
        }
        return count;
    };
    assert.ok(countDarkPixels(first) < countDarkPixels(final));
});
