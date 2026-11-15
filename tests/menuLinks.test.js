const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    MENU_LINK_TTL_MS,
    buildMenuUrl,
    cargarSecreto,
    createMenuLinkStore,
    createMenuTokens
} = require('../services/menuLinks');

test('temporary menu links use the public origin and expire after one hour', () => {
    let now = 1000;
    const store = createMenuLinkStore({
        publicUrl: 'https://bot.example.com',
        ttlMs: MENU_LINK_TTL_MS,
        now: () => now
    });

    const link = store.createLink();
    const token = new URL(link.url).searchParams.get('token');
    assert.equal(new URL(link.url).origin, 'https://bot.example.com');
    assert.equal(new URL(link.url).pathname, '/menu');
    assert.equal(link.expiresAt, now + 60 * 60 * 1000);
    assert.deepEqual(store.getLink(token), { expiresAt: link.expiresAt, page: 'menu' });

    now = link.expiresAt;
    assert.equal(store.getLink(token), null);
});

test('temporary game links use their own route and cannot be used as menu links', () => {
    const store = createMenuLinkStore({ publicUrl: 'https://bot.example.com' });
    const gameLink = store.createLink('doom');
    const token = new URL(gameLink.url).searchParams.get('token');

    assert.equal(new URL(gameLink.url).pathname, '/doom');
    assert.equal(store.getLink(token).page, 'doom');
    assert.throws(() => store.createLink('unknown'), /Página temporal no permitida/);
});

test('configured static menu URL is used when there is no public panel server', () => {
    const store = createMenuLinkStore({ staticMenuUrl: 'https://tylexk.github.io/MENU/' });

    assert.deepEqual(store.createLink(), {
        url: 'https://tylexk.github.io/MENU/',
        expiresAt: null
    });
});

test('temporary public panel URL takes precedence over static backup', () => {
    const store = createMenuLinkStore({
        publicUrl: 'https://menu-tunnel.example.com',
        staticMenuUrl: 'https://tylexk.github.io/MENU/'
    });

    const link = store.createLink();
    const gameLink = store.createLink('doom');
    assert.equal(new URL(link.url).origin, 'https://menu-tunnel.example.com');
    assert.equal(new URL(link.url).pathname, '/menu');
    assert.ok(new URL(link.url).searchParams.get('token'));
    assert.equal(new URL(gameLink.url).origin, 'https://menu-tunnel.example.com');
    assert.ok(gameLink.expiresAt);
});

test('static menu URL must be a public HTTPS URL', () => {
    const insecure = createMenuLinkStore({
        staticMenuUrl: 'http://menu.example.com'
    });
    assert.throws(() => insecure.createLink(), /HTTPS/);

    const staticOnlyStore = createMenuLinkStore({ staticMenuUrl: 'https://menu.example.com#secret' });
    assert.throws(() => staticOnlyStore.createLink(), /sin credenciales ni fragmento/);
});

test('temporary menu link generation requires a valid public origin', () => {
    const missingUrl = createMenuLinkStore();
    assert.throws(() => missingUrl.createLink(), /MENU_PUBLIC_URL/);
    missingUrl.setPublicUrl('https://menu.example.com');
    assert.equal(new URL(missingUrl.createLink().url).origin, 'https://menu.example.com');
    assert.equal(missingUrl.getPublicOrigin(), 'https://menu.example.com');
    missingUrl.setPublicUrl('https://next-menu.example.com');
    assert.equal(missingUrl.getPublicOrigin(), 'https://next-menu.example.com');

    const invalidUrl = createMenuLinkStore({ publicUrl: 'file:///menu' });
    assert.throws(() => invalidUrl.createLink(), /origen público/);
});

test('signed menu tokens validate once and reject malformed, modified, and expired tokens', () => {
    let now = 1000;
    const tokens = createMenuTokens({
        secret: 'a'.repeat(64),
        ttlMs: 100,
        now: () => now
    });
    const token = tokens.create();
    const verifier = createMenuTokens({
        secret: 'a'.repeat(64),
        ttlMs: 100,
        now: () => now
    });
    const alteredSignature = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;

    assert.equal(tokens.validate(token), true);
    assert.equal(verifier.validate(token), true);
    assert.equal(verifier.validate(alteredSignature), false);
    assert.equal(tokens.validate(`${token}x`), false);
    assert.equal(tokens.validate('not-a-token'), false);

    now = 1100;
    assert.equal(tokens.validate(token), false);
});

test('signed menu token configuration enforces secret and expiration limits', () => {
    assert.throws(() => createMenuTokens({ secret: 'short' }), /secreto del menú/);
    assert.throws(() => createMenuTokens({ secret: 'a'.repeat(64), ttlMs: 0 }), /ttlMs/);
    assert.throws(() => createMenuTokens({ secret: 'a'.repeat(64), ttlMs: 24 * 60 * 60 * 1000 + 1 }), /ttlMs/);
});

test('signed menu URLs require a well-formed token and an HTTPS origin', () => {
    const token = createMenuTokens({ secret: 'b'.repeat(64) }).create();

    assert.equal(buildMenuUrl('https://menu.example.com', token), `https://menu.example.com/menu?token=${token}`);
    assert.throws(() => buildMenuUrl('https://menu.example.com/path', token), /solo el origen/);
    assert.throws(() => buildMenuUrl('http://menu.example.com', token), /HTTPS/);
    assert.throws(() => buildMenuUrl('https://menu.example.com', 'arbitrary text'), /Token con formato inválido/);
});

test('secret file is created in a missing directory and remains stable', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gonxta-menu-secret-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const secretPath = path.join(directory, 'nested', 'menu.secret');

    const first = cargarSecreto(secretPath);
    const second = cargarSecreto(secretPath);

    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal(second, first);
});
