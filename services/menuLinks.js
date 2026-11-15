const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MENU_LINK_TTL_MS = 60 * 60 * 1000;
const MENU_TOKEN_TTL_MAX_MS = 24 * 60 * 60 * 1000;
const MENU_SECRET_FORMAT = /^[0-9a-f]{64}$/;
const MENU_TOKEN_FORMAT = /^[0-9a-f]{32}\.\d{1,16}\.[0-9a-f]{64}$/;

function cargarSecreto(rutaArchivo) {
    const deEntorno = process.env.MENU_SECRET;
    if (deEntorno) {
        if (!MENU_SECRET_FORMAT.test(deEntorno)) {
            throw new Error('MENU_SECRET debe ser 64 caracteres hexadecimales (32 bytes).');
        }
        return deEntorno;
    }

    if (typeof rutaArchivo !== 'string' || !rutaArchivo) {
        throw new Error('La ruta del archivo del secreto es obligatoria.');
    }

    fs.mkdirSync(path.dirname(rutaArchivo), { recursive: true });
    try {
        const nuevo = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(rutaArchivo, nuevo, { flag: 'wx', mode: 0o600 });
        return nuevo;
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const guardado = fs.readFileSync(rutaArchivo, 'utf8').trim();
        if (!MENU_SECRET_FORMAT.test(guardado)) {
            throw new Error('El archivo del secreto del menú está dañado o tiene un formato inválido.');
        }
        return guardado;
    }
}

function createMenuTokens({ secret, ttlMs = MENU_LINK_TTL_MS, now = Date.now } = {}) {
    if (typeof secret !== 'string' || !MENU_SECRET_FORMAT.test(secret)) {
        throw new Error('El secreto del menú debe ser 64 caracteres hexadecimales (32 bytes).');
    }
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MENU_TOKEN_TTL_MAX_MS) {
        throw new Error(`ttlMs debe ser un entero entre 1 y ${MENU_TOKEN_TTL_MAX_MS}.`);
    }
    if (typeof now !== 'function') {
        throw new Error('La fuente de tiempo del menú debe ser una función.');
    }

    const key = Buffer.from(secret, 'hex');
    const sign = payload => crypto.createHmac('sha256', key).update(payload).digest();

    function create() {
        const payload = `${crypto.randomBytes(16).toString('hex')}.${now() + ttlMs}`;
        return `${payload}.${sign(payload).toString('hex')}`;
    }

    function validate(token) {
        if (typeof token !== 'string' || token.length > 200 || !MENU_TOKEN_FORMAT.test(token)) {
            return false;
        }

        const [nonce, expiration, signature] = token.split('.');
        const expiresAt = Number(expiration);
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= now()) return false;

        return crypto.timingSafeEqual(
            sign(`${nonce}.${expiration}`),
            Buffer.from(signature, 'hex')
        );
    }

    return { create, validate };
}

function buildMenuUrl(baseUrl, token) {
    if (typeof token !== 'string' || !MENU_TOKEN_FORMAT.test(token)) {
        throw new Error('Token con formato inválido.');
    }

    let base;
    try {
        base = new URL(baseUrl);
    } catch {
        throw new Error('MENU_PUBLIC_URL no es una URL válida.');
    }

    if (base.protocol !== 'https:') {
        throw new Error('MENU_PUBLIC_URL debe usar HTTPS.');
    }
    if (base.pathname !== '/' || base.search || base.hash || base.username || base.password) {
        throw new Error('MENU_PUBLIC_URL debe ser solo el origen, sin ruta ni parámetros.');
    }

    const url = new URL('/menu', base.origin);
    url.searchParams.set('token', token);
    return url.toString();
}

function createMenuLinkStore({ publicUrl, staticMenuUrl, ttlMs = MENU_LINK_TTL_MS, now = Date.now } = {}) {
    const links = new Map();
    let activePublicUrl = publicUrl;
    let activeStaticMenuUrl = staticMenuUrl;

    function getPublicBaseUrl() {
        if (!activePublicUrl) {
            throw new Error('MENU_PUBLIC_URL no está configurada.');
        }

        let baseUrl;
        try {
            baseUrl = new URL(activePublicUrl);
        } catch {
            throw new Error('MENU_PUBLIC_URL debe ser una URL pública válida.');
        }

        if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.pathname !== '/') {
            throw new Error('MENU_PUBLIC_URL debe ser el origen público del servidor, por ejemplo https://bot.ejemplo.com.');
        }

        return baseUrl;
    }

    function createLink(page = 'menu') {
        if (!['menu', 'doom'].includes(page)) {
            throw new Error('Página temporal no permitida.');
        }

        if (page === 'menu' && !activePublicUrl && activeStaticMenuUrl) {
            let menuUrl;
            try {
                menuUrl = new URL(activeStaticMenuUrl);
            } catch {
                throw new Error('MENU_STATIC_URL debe ser una URL HTTPS válida.');
            }
            if (menuUrl.protocol !== 'https:' || menuUrl.username || menuUrl.password || menuUrl.hash) {
                throw new Error('MENU_STATIC_URL debe ser una URL HTTPS pública sin credenciales ni fragmento.');
            }
            return { url: menuUrl.toString(), expiresAt: null };
        }

        const baseUrl = getPublicBaseUrl();
        const currentTime = now();
        for (const [token, link] of links) {
            if (link.expiresAt <= currentTime) links.delete(token);
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = currentTime + ttlMs;
        links.set(token, { expiresAt, page });

        const url = new URL(`/${page}`, baseUrl);
        url.searchParams.set('token', token);
        return { url: url.toString(), expiresAt };
    }

    function getLink(token) {
        const link = links.get(token);
        if (!link) return null;
        if (link.expiresAt <= now()) {
            links.delete(token);
            return null;
        }
        return { ...link };
    }

    function setPublicUrl(url) {
        activePublicUrl = url;
    }

    function setStaticMenuUrl(url) {
        activeStaticMenuUrl = url;
    }

    function getPublicOrigin() {
        return getPublicBaseUrl().origin;
    }

    return { createLink, getLink, getPublicOrigin, setPublicUrl, setStaticMenuUrl };
}

module.exports = {
    MENU_LINK_TTL_MS,
    MENU_TOKEN_TTL_MAX_MS,
    buildMenuUrl,
    cargarSecreto,
    createMenuLinkStore,
    createMenuTokens
};
