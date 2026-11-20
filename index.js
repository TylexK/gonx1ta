const { Boom } = require('@hapi/boom');
const http = require('node:http');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fs = require('fs');
const path = require('node:path');
require('./utils/safeConsole').installSafeConsole();

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!match || process.env[match[1]]) continue;
        process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
}

const {
    MENU_LINK_TTL_MS,
    buildMenuUrl,
    createMenuLinkStore,
    createMenuTokens
} = require('./services/menuLinks');
const staticMenuLinkStore = createMenuLinkStore({
    staticMenuUrl: process.env.MENU_STATIC_URL
});

const logger = require('./utils/logger');
const dbUtils = require('./utils/dbUtils');
const mediaHandler = require('./utils/mediaHandler');
const { hasPermission, getPermissionError } = require('./utils/commandPermissions');
const { validateUserInput, sanitizeString, checkRateLimit } = require('./utils/validation');
const aiService = require('./services/aiService');
const aiCommands = require('./services/commands/utility/ai');
const expandedLocalCommands = require('./services/commands/utility/expandedLocal');
const groupAdminCommands = require('./services/commands/admin/groupAdmin');
const stickerCommands = require('./services/commands/stickers/stickers');
const bratCommands = require('./services/commands/stickers/brat');
const qrCommands = require('./services/commands/multimedia/qr');
const { getPollPayload } = require('./services/commands/multimedia/forward');
const { getCommandCategory } = require('./services/commands/categories');
const processCommands = require('./services/commands/legacy/processor');
const {
    createHangmanGame,
    getHangmanMask,
    guessHangmanLetter,
    normalizeGameAnswer
} = require('./services/commands/games/wordGames');
const {
    createHigherLowerGame,
    playHigherLower,
    createSecretNumberGame,
    guessSecretNumber,
    createAnagramGame,
    answerAnagram,
    createMemoryGame,
    answerMemory,
    playOddEven
} = require('./services/commands/games/casinoGames');
const activityStore = require('./utils/activityStore');
const { normalizeCommand, isCommandMessage, normalizeDisabledCommand } = require('./services/commandAliases');
const { createWelcomeMessage } = require('./services/commands/admin/welcome');



let baileysModule = null;
let makeWASocket = null;
let useMultiFileAuthState = null;
let DisconnectReason = null;
let fetchLatestBaileysVersion = null;
let downloadContentFromMessage = null;
let normalizeMessageContent = null;
let generateWAMessageFromContent = null;
let activeSocket = null;
let whatsappConnection = 'disconnected';
const botStartedAt = Date.now();
const CONTROL_PORT = Number(process.env.BOT_CONTROL_PORT || 3001);
const GROUP_AUDIO_DIR = path.join(__dirname, 'group_audio');
const GROUP_WELCOME_IMAGE_DIR = path.join(__dirname, 'group_welcome_images');
const MAX_GROUP_AUDIO_BYTES = 15 * 1024 * 1024;

function reportPanelDiagnostic(payload) {
    const body = JSON.stringify(payload);
    const request = http.request({
        hostname: '127.0.0.1',
        port: Number(process.env.PORT || 3000),
        path: '/internal/diagnostics',
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            'x-menu-internal-token': process.env.MENU_INTERNAL_TOKEN || ''
        },
        timeout: 2000
    }, response => response.resume());
    request.on('error', () => {});
    request.end(body);
}

function requestCurrentMenuOrigin() {
    return new Promise((resolve, reject) => {
        const request = http.request({
            hostname: '127.0.0.1',
            port: Number(process.env.PORT || 3000),
            path: '/internal/menu-origin',
            method: 'GET',
            headers: { 'x-menu-internal-token': process.env.MENU_INTERNAL_TOKEN || '' },
            timeout: 20000
        }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => {
                body += chunk;
                if (body.length > 4096) {
                    request.destroy(new Error('La respuesta del servidor del menú es demasiado grande.'));
                }
            });
            response.on('end', () => {
                let payload;
                try {
                    payload = JSON.parse(body);
                } catch {
                    reject(new Error('El servidor devolvió una respuesta inválida al consultar el origen del menú.'));
                    return;
                }
                if (!payload || typeof payload !== 'object' || response.statusCode !== 200 || typeof payload.origin !== 'string') {
                    reject(new Error(payload?.error || 'No se pudo consultar el origen actual del menú.'));
                    return;
                }
                resolve(payload.origin);
            });
        });
        request.on('timeout', () => request.destroy(new Error('El servidor del menú no respondió a tiempo.')));
        request.on('error', reject);
        request.end();
    });
}

function requestTemporaryMenuLink(page) {
    return new Promise((resolve, reject) => {
        const request = http.request({
            hostname: '127.0.0.1',
            port: Number(process.env.PORT || 3000),
            path: `/internal/menu-link?page=${encodeURIComponent(page)}`,
            method: 'POST',
            headers: { 'x-menu-internal-token': process.env.MENU_INTERNAL_TOKEN || '' },
            timeout: 3000
        }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => {
                body += chunk;
                if (body.length > 4096) {
                    request.destroy(new Error('La respuesta del servidor del menú es demasiado grande.'));
                }
            });
            response.on('end', () => {
                let payload;
                try {
                    payload = JSON.parse(body);
                } catch {
                    reject(new Error('El servidor devolvió una respuesta inválida al crear el enlace.'));
                    return;
                }
                if (!payload || typeof payload !== 'object' || response.statusCode !== 200 || typeof payload.url !== 'string') {
                    reject(new Error(payload?.error || 'No se pudo crear el enlace.'));
                    return;
                }
                resolve(payload);
            });
        });
        request.on('timeout', () => request.destroy(new Error('El servidor del menú no respondió a tiempo.')));
        request.on('error', reject);
        request.end();
    });
}

async function createTemporaryMenuLink(page = 'menu') {
    if (page !== 'menu') return requestTemporaryMenuLink(page);

    let origin;
    try {
        origin = await requestCurrentMenuOrigin();
    } catch (error) {
        if (!process.env.MENU_STATIC_URL) throw error;
        return staticMenuLinkStore.createLink('menu');
    }

    const token = createMenuTokens({
        secret: process.env.MENU_SECRET,
        ttlMs: MENU_LINK_TTL_MS
    }).create();
    return {
        url: buildMenuUrl(origin, token),
        expiresAt: Number(token.split('.')[1])
    };
}

async function loadBaileys() {
    if (baileysModule) return baileysModule;
    baileysModule = await import('@whiskeysockets/baileys');
    makeWASocket = baileysModule.default;
    useMultiFileAuthState = baileysModule.useMultiFileAuthState;
    DisconnectReason = baileysModule.DisconnectReason;
    fetchLatestBaileysVersion = baileysModule.fetchLatestBaileysVersion;
    downloadContentFromMessage = baileysModule.downloadContentFromMessage;
    normalizeMessageContent = baileysModule.normalizeMessageContent;
    generateWAMessageFromContent = baileysModule.generateWAMessageFromContent;
    return baileysModule;
}

let ffmpegPath = null;
async function ensureFfmpeg() {
    if (ffmpegPath) return ffmpegPath;
    const path = require('path');
    
    const homeDir = process.env.USERPROFILE || process.env.HOME || '';
    const possiblePaths = [
        path.join(homeDir, 'ffmpeg', 'ffmpeg-master-latest-win64-gpl', 'bin', 'ffmpeg.exe'),
        path.join(homeDir, 'ffmpeg', 'bin', 'ffmpeg.exe'),
        'ffmpeg.exe',
        'ffmpeg'
    ];
    
    for (const checkPath of possiblePaths) {
        if (fs.existsSync(checkPath)) {
            ffmpegPath = checkPath;
            return ffmpegPath;
        }
    }
    
    const { execFileSync } = require('child_process');
    try {
        const locator = process.platform === 'win32' ? 'where.exe' : 'which';
        const result = execFileSync(locator, ['ffmpeg'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0];
        if (result) {
            ffmpegPath = result;
            return ffmpegPath;
        }
    } catch (e) {
        logger.debug('FFmpeg no está disponible en PATH', { error: e.message });
    }

    const bundledFfmpegPath = require('ffmpeg-static');
    if (bundledFfmpegPath && fs.existsSync(bundledFfmpegPath)) {
        ffmpegPath = bundledFfmpegPath;
        return ffmpegPath;
    }
    
    return null;
}

let ffprobePath = null;
function ensureFfprobe(ffmpegExecutable) {
    if (ffprobePath && fs.existsSync(ffprobePath)) return ffprobePath;
    const path = require('path');
    const executableName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    const ffmpegDirectory = ffmpegExecutable && path.dirname(ffmpegExecutable);
    const adjacentFfprobe = ffmpegDirectory && path.join(ffmpegDirectory, executableName);
    if (adjacentFfprobe && fs.existsSync(adjacentFfprobe)) {
        ffprobePath = adjacentFfprobe;
        return ffprobePath;
    }

    const { execFileSync } = require('child_process');
    try {
        const locator = process.platform === 'win32' ? 'where.exe' : 'which';
        const result = execFileSync(locator, ['ffprobe'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0];
        if (result && fs.existsSync(result)) {
            ffprobePath = result;
            return ffprobePath;
        }
    } catch (error) {
        if (error.code !== 'ENOENT' && error.status !== 1) throw error;
    }
    return null;
}

let ytDlpCommand = null;
async function findYtDlpCommand() {
    if (ytDlpCommand) return ytDlpCommand;
    const { spawn } = require('child_process');
    const path = require('path');
    const homeDir = process.env.USERPROFILE || process.env.HOME;
    const commands = [
        ...(homeDir ? [{
            executable: path.join(homeDir, 'AppData', 'Local', 'Python', 'pythoncore-3.14-64', 'Scripts', 'yt-dlp.exe'),
            prefixArgs: []
        }] : []),
        { executable: 'yt-dlp', prefixArgs: [] },
        { executable: 'python', prefixArgs: ['-m', 'yt_dlp'] },
        { executable: 'python3', prefixArgs: ['-m', 'yt_dlp'] },
        { executable: 'npx', prefixArgs: ['yt-dlp'] },
        { executable: 'youtube-dl', prefixArgs: [] }
    ];
    for (const command of commands) {
        const result = await new Promise((resolve) => {
            const probe = spawn(command.executable, [...command.prefixArgs, '--version'], {
                shell: false,
                windowsHide: true
            });
            let settled = false;
            const finish = ok => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolve(ok);
            };
            const timeout = setTimeout(() => {
                probe.kill();
                finish(false);
            }, 20000);
            probe.once('error', () => finish(false));
            probe.once('close', code => finish(code === 0));
        });
        if (result) {
            ytDlpCommand = command;
            return ytDlpCommand;
        }
    }
    return null;
}

async function downloadAndSendAudio(sock, jid, query, progressText = null, quotedMessage = null) {
    const { exec, spawn } = require('child_process');
    const path = require('path');
    const musicDir = path.join(__dirname, 'music_downloads');
    const cacheIndexPath = path.join(musicDir, '.music-cache.json');
    if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir, { recursive: true });

    let musicCache = {};
    try {
        if (fs.existsSync(cacheIndexPath)) {
            musicCache = JSON.parse(fs.readFileSync(cacheIndexPath, 'utf8'));
        }
    } catch (cacheErr) {
        console.warn('No se pudo leer la caché de música:', cacheErr.message || cacheErr);
    }

    const cacheKey = query.trim().toLowerCase();
    const sendCachedTrack = async (entry) => {
        const audioPath = path.join(musicDir, entry.audio);
        const thumbnailPath = entry.thumbnail ? path.join(musicDir, entry.thumbnail) : null;
        if (!fs.existsSync(audioPath)) return false;

        const sendOptions = quotedMessage ? { quoted: quotedMessage } : undefined;
        const audioMessage = { audio: fs.readFileSync(audioPath), mimetype: 'audio/mpeg', ptt: false };
        if (thumbnailPath && fs.existsSync(thumbnailPath)) {
            const thumbnailBuffer = fs.readFileSync(thumbnailPath);
            const thumbnailMime = entry.thumbnailMime || (
                path.extname(thumbnailPath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg'
            );
            await sock.sendMessage(jid, {
                image: thumbnailBuffer,
                mimetype: thumbnailMime,
                caption: `🎵 ${path.basename(audioPath)}`
            }, sendOptions);

            if (entry.thumbnailMime === 'image/jpeg') {
                audioMessage.jpegThumbnail = thumbnailBuffer;
            } else if (sharpAvailable) {
                audioMessage.jpegThumbnail = await sharp(thumbnailBuffer)
                    .resize(300, 300, { fit: 'cover' })
                    .jpeg({ quality: 80 })
                    .toBuffer();
            }
        }
        await sock.sendMessage(jid, audioMessage, sendOptions);
        return true;
    };

    if (musicCache[cacheKey] && await sendCachedTrack(musicCache[cacheKey])) {
        return { ok: true, cached: true };
    }

    const downloadDir = fs.mkdtempSync(path.join(musicDir, '.download-'));
    const cleanupDownloadDir = () => {
        try {
            fs.rmSync(downloadDir, { recursive: true, force: true });
        } catch (cleanupErr) {
            console.warn('No se pudo limpiar la descarga temporal:', cleanupErr.message || cleanupErr);
        }
    };
    const isUrl = /^(https?:\/\/|www\.)/i.test(query);
    const source = isUrl ? query : `ytsearch1:${query}`;
    const ffmpegStatic = await ensureFfmpeg();
    const ffprobeStatic = ensureFfprobe(ffmpegStatic);
    const ytDlp = await findYtDlpCommand();
    if (!ytDlp) {
        cleanupDownloadDir();
        return { error: 'NO_YTDLP' };
    }
    if (!ffmpegStatic) {
        cleanupDownloadDir();
        return { error: 'NO_FFMPEG' };
    }
    if (!ffprobeStatic) {
        console.warn('ffprobe no está disponible en PATH ni junto a ffmpeg; yt-dlp podría no detectar metadatos del audio.');
    }
    const { executable: ytDlpExecutable, prefixArgs: ytDlpPrefixArgs } = ytDlp;
    const outputPattern = path.join(downloadDir, '%(title)s [%(id)s].%(ext)s').replace(/\\/g, '/');
    const processEnv = {
        ...process.env,
        PATH: `${ffprobeStatic ? path.dirname(ffprobeStatic) + path.delimiter : ''}${process.env.PATH || ''}`
    };
    const ytDlpArgs = [
        ...ytDlpPrefixArgs,
        '-f', 'bestaudio/best',
        '-x', '--audio-format', 'mp3',
        '--write-thumbnail', '--convert-thumbnails', 'jpg',
        '--no-playlist',
        '--extractor-args', 'youtube:player_client=android,web',
        source,
        '-o', outputPattern,
        '--no-warnings',
        '--ffmpeg-location', ffmpegStatic
    ];

    return new Promise((resolve) => {
        const downloadProcess = spawn(ytDlpExecutable, ytDlpArgs, { shell: false, env: processEnv });
        let stderr = '';
        downloadProcess.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        downloadProcess.on('error', (err) => {
            console.error('yt-dlp error:', err, stderr);
            cleanupDownloadDir();
            resolve({ error: 'DOWNLOAD', stderr: stderr.slice(-1000) || err.message });
        });
        downloadProcess.on('close', async (code) => {
            if (code !== 0) {
                console.error('yt-dlp error:', stderr);
                cleanupDownloadDir();
                return resolve({ error: 'DOWNLOAD', stderr: stderr ? stderr.slice(-1000) : `yt-dlp terminó con código ${code}` });
            }

            let file;
            let thumbnailFile = null;
            let thumbnailMime = 'image/jpeg';
            try {
                const files = fs.readdirSync(downloadDir).filter(f => f.endsWith('.mp3')).sort((a, b) =>
                    fs.statSync(path.join(downloadDir, b)).mtime - fs.statSync(path.join(downloadDir, a)).mtime
                );
                if (!files.length) return resolve({ error: 'NOFILE' });

                const downloadedFile = path.join(downloadDir, files[0]);
                const buf = fs.readFileSync(downloadedFile);
                if (fs.statSync(downloadedFile).size > 100 * 1024 * 1024) {
                    return resolve({ error: 'BIG' });
                }

                const audioStem = path.basename(downloadedFile, path.extname(downloadedFile));
                const matchingThumbnail = fs.readdirSync(downloadDir).find(candidate =>
                    path.basename(candidate, path.extname(candidate)) === audioStem
                    && /\.(jpe?g|png|webp)$/i.test(candidate)
                );
                if (matchingThumbnail) {
                    thumbnailFile = matchingThumbnail;
                    thumbnailMime = thumbnailFile.toLowerCase().endsWith('.png')
                        ? 'image/png'
                        : thumbnailFile.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg';
                }

                const uniquePrefix = path.basename(downloadDir).slice(-6);
                file = path.join(musicDir, `${uniquePrefix}-${path.basename(downloadedFile)}`);
                fs.renameSync(downloadedFile, file);
                if (thumbnailFile) {
                    const finalThumbnailFile = `${uniquePrefix}-${thumbnailFile}`;
                    fs.renameSync(path.join(downloadDir, thumbnailFile), path.join(musicDir, finalThumbnailFile));
                    thumbnailFile = finalThumbnailFile;
                }

                try {
                    if (thumbnailFile) {
                        await sock.sendMessage(jid, {
                            image: fs.readFileSync(path.join(musicDir, thumbnailFile)),
                            mimetype: thumbnailMime,
                            caption: `🎵 ${path.basename(file)}`
                            }, quotedMessage ? { quoted: quotedMessage } : undefined);
                    }
                    const audioMessage = { audio: buf, mimetype: 'audio/mpeg', ptt: false };
                    if (thumbnailFile && thumbnailMime === 'image/jpeg') {
                        audioMessage.jpegThumbnail = fs.readFileSync(path.join(musicDir, thumbnailFile));
                    }
                    await sock.sendMessage(jid, audioMessage, quotedMessage ? { quoted: quotedMessage } : undefined);
                } catch (sendErr) {
                    console.error('Error enviando audio:', sendErr);
                    return resolve({ error: 'SEND', details: sendErr.message || String(sendErr) });
                }

                try {
                    musicCache[cacheKey] = {
                        audio: path.basename(file),
                        thumbnail: thumbnailFile,
                        thumbnailMime,
                        savedAt: Date.now()
                    };
                    dbUtils.writeAtomic(cacheIndexPath, musicCache);
                } catch (cacheErr) {
                    console.warn('No se pudo guardar la caché de música:', cacheErr.message || cacheErr);
                }
                resolve({ ok: true });
            } catch (downloadErr) {
                console.error('Error procesando la descarga de audio:', downloadErr);
                resolve({ error: 'DOWNLOAD', stderr: downloadErr.message || String(downloadErr) });
            } finally {
                cleanupDownloadDir();
            }
        });
    });
}

async function downloadAndSendTikTok(sock, jid, url, quotedMessage = null) {
    const { spawn } = require('child_process');
    const path = require('path');
    const os = require('os');

    try {
        const apiResponse = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(20000)
        });
        const apiData = await apiResponse.json();
        const videoUrl = apiData?.data?.hdplay || apiData?.data?.play;
        if (apiData?.code === 0 && videoUrl) {
            const videoResponse = await fetch(videoUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(30000)
            });
            if (videoResponse.ok) {
                const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
                if (videoBuffer.length > 100 * 1024 * 1024) return { error: 'BIG' };
                await sock.sendMessage(
                    jid,
                    { video: videoBuffer, mimetype: 'video/mp4', caption: '🎵 TikTok descargado sin marca de agua' },
                    quotedMessage ? { quoted: quotedMessage } : undefined
                );
                return { ok: true, method: 'api' };
            }
        }
    } catch (apiError) {
        console.warn('Respaldo API de TikTok no disponible:', apiError.message || apiError);
    }

    const ytDlp = await findYtDlpCommand();
    if (!ytDlp) return { error: 'NO_YTDLP' };

    if (!/^https?:\/\/(?:www\.)?(?:tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)\//i.test(url)) {
        return { error: 'INVALID_URL' };
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kenny-tiktok-'));
    const outputPath = path.join(tempDir, 'video.%(ext)s');
    const { executable: ytDlpExecutable, prefixArgs: ytDlpPrefixArgs } = ytDlp;
    const args = [
        ...ytDlpPrefixArgs,
        '--no-playlist',
        '-f', 'best',
        '--retries', '3',
        '--fragment-retries', '3',
        '--extractor-args', 'tiktok:app_name=musical_ly;app_version=34.1.4',
        '--add-header', 'Referer:https://www.tiktok.com/',
        '--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        '--no-warnings',
        url,
        '-o', outputPath
    ];

    return new Promise((resolve) => {
        const process = spawn(ytDlpExecutable, args, { shell: false });
        let stderr = '';
        process.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        process.on('error', (error) => {
            fs.rmSync(tempDir, { recursive: true, force: true });
            resolve({ error: 'DOWNLOAD', details: error.message });
        });
        process.on('close', async (code) => {
            try {
                if (code !== 0) {
                    return resolve({ error: 'DOWNLOAD', details: stderr.slice(-1000) });
                }

                const files = fs.readdirSync(tempDir).filter((file) => /\.(mp4|webm|mkv|mov)$/i.test(file));
                if (!files.length) return resolve({ error: 'NOFILE' });

                const videoPath = path.join(tempDir, files[0]);
                const videoBuffer = fs.readFileSync(videoPath);
                if (videoBuffer.length > 100 * 1024 * 1024) {
                    return resolve({ error: 'BIG' });
                }

                await sock.sendMessage(
                    jid,
                    { video: videoBuffer, mimetype: 'video/mp4', caption: '🎵 TikTok descargado sin marca de agua' },
                    quotedMessage ? { quoted: quotedMessage } : undefined
                );
                resolve({ ok: true });
            } catch (error) {
                resolve({ error: 'SEND', details: error.message });
            } finally {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });
    });
}

async function downloadAndSendInstagram(sock, jid, url, quotedMessage = null) {
    const { spawn } = require('child_process');
    const path = require('path');
    const os = require('os');
    const ytDlp = await findYtDlpCommand();
    if (!ytDlp) return { error: 'NO_YTDLP' };

    if (!/^https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\//i.test(url)) {
        return { error: 'INVALID_URL' };
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kenny-instagram-'));
    const outputPath = path.join(tempDir, 'video.%(ext)s');
    const { executable: ytDlpExecutable, prefixArgs: ytDlpPrefixArgs } = ytDlp;
    const args = [
        ...ytDlpPrefixArgs,
        '--no-playlist',
        '-f', 'best[ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '--remux-video', 'mp4',
        '--no-warnings',
        url,
        '-o', outputPath
    ];

    return new Promise((resolve) => {
        const process = spawn(ytDlpExecutable, args, { shell: false });
        let stderr = '';
        process.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        process.on('error', (error) => {
            fs.rmSync(tempDir, { recursive: true, force: true });
            resolve({ error: 'DOWNLOAD', details: error.message });
        });
        process.on('close', async (code) => {
            try {
                if (code !== 0) {
                    return resolve({ error: 'DOWNLOAD', details: stderr.slice(-1000) });
                }

                const files = fs.readdirSync(tempDir).filter((file) => /\.(mp4|webm|mkv)$/i.test(file));
                if (!files.length) return resolve({ error: 'NOFILE' });

                const videoPath = path.join(tempDir, files[0]);
                const videoBuffer = fs.readFileSync(videoPath);
                if (videoBuffer.length > 100 * 1024 * 1024) {
                    return resolve({ error: 'BIG' });
                }

                await sock.sendMessage(
                    jid,
                    { video: videoBuffer, mimetype: 'video/mp4', caption: '📸 Instagram descargado' },
                    quotedMessage ? { quoted: quotedMessage } : undefined
                );
                resolve({ ok: true });
            } catch (error) {
                resolve({ error: 'SEND', details: error.message });
            } finally {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });
    });
}

async function downloadAndSendGenericMedia(sock, jid, url, quotedMessage = null, caption = '📥 Archivo descargado') {
    const { spawn } = require('child_process');
    const os = require('os');
    const ytDlp = await findYtDlpCommand();
    if (!ytDlp) return { error: 'NO_YTDLP' };
    const source = /^(https?:\/\/|www\.)/i.test(url) ? url : `ytsearch1:${url}`;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gonxta-download-'));
    const outputPath = path.join(tempDir, '%(title)s [%(id)s].%(ext)s');
    const { executable, prefixArgs } = ytDlp;
    const args = [
        ...prefixArgs,
        '--no-playlist',
        '-f', 'best[ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '--no-warnings',
        source,
        '-o', outputPath
    ];

    return new Promise((resolve) => {
        const process = spawn(executable, args, { shell: false, windowsHide: true });
        let stderr = '';
        process.stderr.on('data', chunk => { stderr += chunk.toString(); });
        process.on('error', error => {
            fs.rmSync(tempDir, { recursive: true, force: true });
            resolve({ error: 'DOWNLOAD', details: error.message });
        });
        process.on('close', async code => {
            try {
                if (code !== 0) return resolve({ error: 'DOWNLOAD', details: stderr.slice(-1000) });
                const files = fs.readdirSync(tempDir).filter(file => !file.endsWith('.part'));
                if (!files.length) return resolve({ error: 'NOFILE' });

                const filePath = path.join(tempDir, files[0]);
                const buffer = fs.readFileSync(filePath);
                if (buffer.length > 100 * 1024 * 1024) return resolve({ error: 'BIG' });

                const extension = path.extname(filePath).toLowerCase();
                const sendOptions = quotedMessage ? { quoted: quotedMessage } : undefined;
                if (/\.(jpe?g|png|webp|gif)$/i.test(extension)) {
                    await sock.sendMessage(jid, { image: buffer, caption }, sendOptions);
                } else if (/\.(apk|pdf|zip|rar|7z|exe|docx?|xlsx?)$/i.test(extension)) {
                    await sock.sendMessage(jid, {
                        document: buffer,
                        fileName: path.basename(filePath),
                        caption
                    }, sendOptions);
                } else {
                    await sock.sendMessage(jid, { video: buffer, mimetype: 'video/mp4', caption }, sendOptions);
                }
                resolve({ ok: true });
            } catch (error) {
                resolve({ error: 'SEND', details: error.message });
            } finally {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });
    });
}

async function searchAndSendGif(sock, jid, query, quotedMessage = null) {
    const apiKey = process.env.GIPHY_API_KEY;
    if (!apiKey) return { error: 'NO_API_KEY' };

    const searchUrl = new URL('https://api.giphy.com/v1/gifs/search');
    searchUrl.searchParams.set('api_key', apiKey);
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('limit', '8');
    searchUrl.searchParams.set('rating', 'pg-13');
    searchUrl.searchParams.set('lang', 'es');

    try {
        const response = await fetch(searchUrl, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) return { error: 'API', details: `GIPHY respondió HTTP ${response.status}` };

        const data = await response.json();
        const result = data?.data?.[0];
        const gifUrl = result?.images?.original?.mp4
            || result?.images?.downsized_large?.mp4
            || result?.images?.downsized?.mp4;
        if (!gifUrl) return { error: 'NOT_FOUND' };

        const gifResponse = await fetch(gifUrl, { signal: AbortSignal.timeout(30000) });
        if (!gifResponse.ok) return { error: 'DOWNLOAD', details: `GIPHY respondió HTTP ${gifResponse.status}` };

        const gifBuffer = Buffer.from(await gifResponse.arrayBuffer());
        if (!gifBuffer.length) return { error: 'DOWNLOAD', details: 'GIPHY devolvió un archivo vacío' };
        if (gifBuffer.length > 100 * 1024 * 1024) return { error: 'BIG' };

        await sock.sendMessage(
            jid,
            { video: gifBuffer, mimetype: 'video/mp4', gifPlayback: true },
            quotedMessage ? { quoted: quotedMessage } : undefined
        );
        return { ok: true };
    } catch (error) {
        return { error: 'API', details: error.message || String(error) };
    }
}

        async function sendChannelPreviewMessage(sock, jid, text, channelUrl, thumbnailBuffer = null, options = {}) {
            try {
                const { topLabel, previewTitle, previewBody, showUrlInText = false } = options || {};

                const now = new Date();
                const day = now.getDate();
                const month = now.toLocaleString('es-ES', { month: 'long' });
                const dynamicBody = `${day} de ${month} 🌙`;

                let displayText = text || '';
                if (topLabel) displayText = `${topLabel}\n${displayText}`;
                if (showUrlInText && channelUrl) displayText = `${displayText}\n\n${channelUrl}`;

                const message = {
                    text: displayText,
                    contextInfo: {
                        externalAdReply: {
                            showAdAttribution: false,
                            title: previewTitle || 'CANAL DYNASTY',
                            body: previewBody || dynamicBody,
                            mediaType: 1,
                            thumbnail: thumbnailBuffer,
                            sourceUrl: channelUrl
                        }
                    }
                };

                await sock.sendMessage(jid, message);
                return { ok: true };
            } catch (err) {
                console.error('Error sending channel preview message:', err);
                return { error: 'SEND_PREVIEW', details: String(err) };
            }
        }



const localeMap = {
    '1': 'en-US',      
    '7': 'ru-RU',      
    '20': 'ar-EG',     
    '27': 'af-ZA',     
    '30': 'el-GR',     
    '31': 'nl-NL',     
    '32': 'fr-BE',     
    '33': 'fr-FR',     
    '34': 'es-ES',     
    '36': 'hu-HU',     
    '39': 'it-IT',     
    '40': 'ro-RO',     
    '44': 'en-GB',     
    '45': 'da-DK',     
    '46': 'sv-SE',     
    '47': 'no-NO',     
    '48': 'pl-PL',     
    '49': 'de-DE',     
    '52': 'es-MX',     
    '53': 'es-CU',     
    '54': 'es-AR',     
    '55': 'pt-BR',     
    '56': 'es-CL',     
    '57': 'es-CO',     
    '58': 'es-VE',     
    '60': 'ms-MY',     
    '61': 'en-AU',     
    '62': 'id-ID',     
    '63': 'en-PH',     
    '64': 'en-NZ',     
    '65': 'en-SG',     
    '66': 'th-TH',     
    '81': 'ja-JP',     
    '82': 'ko-KR',     
    '84': 'vi-VN',     
    '86': 'zh-CN',     
    '90': 'tr-TR',     
    '91': 'en-IN',     
    '92': 'ur-PK',     
    '93': 'fa-AF',     
    '94': 'si-LK',     
    '95': 'my-MM',     
    '98': 'fa-IR',     
    '212': 'ar-MA',    
    '213': 'ar-DZ',    
    '216': 'ar-TN',    
    '218': 'ar-LY',    
    '220': 'en-GM',    
    '221': 'fr-SN',    
    '222': 'ar-MR',    
    '223': 'fr-ML',    
    '224': 'fr-GN',    
    '225': 'fr-CI',    
    '226': 'fr-BF',    
    '227': 'ha-NE',    
    '228': 'fr-TG',    
    '229': 'fr-BJ',    
    '230': 'fr-MU',    
    '231': 'en-LR',    
    '232': 'en-SL',    
    '233': 'en-GH',    
    '234': 'en-NG',    
    '235': 'ar-TD',    
    '236': 'fr-CF',    
    '237': 'fr-CM',    
    '238': 'pt-CV',    
    '239': 'pt-ST',    
    '240': 'es-GQ',    
    '241': 'fr-GA',    
    '242': 'fr-CG',    
    '243': 'fr-CD',    
    '244': 'pt-AO',    
    '245': 'pt-GW',    
    '246': 'en-IQ',    
    '247': 'en-GD',    
    '248': 'en-SC',    
    '249': 'ar-SD',    
    '250': 'fr-RW',    
    '251': 'am-ET',    
    '252': 'so-SO',    
    '253': 'so-DJ',    
    '254': 'sw-KE',    
    '255': 'sw-TZ',    
    '256': 'en-UG',    
    '257': 'fr-BI',    
    '258': 'pt-MZ',    
    '260': 'en-ZM',    
    '261': 'mg-MG',    
    '262': 'fr-RE',    
    '263': 'en-ZW',    
    '264': 'en-NA',    
    '265': 'en-MW',    
    '266': 'st-LS',    
    '267': 'en-BW',    
    '268': 'en-SZ',    
    '269': 'fr-KM',    
    '290': 'en-SH',    
    '291': 'ti-ER',    
    '297': 'nl-AW',    
    '298': 'fo-FO',    
    '299': 'kl-GL',    
};

function getLocaleFromJid(jid) {
    if (!jid) return 'en-US';
    const num = jid.split('@')[0].replace(/[^0-9]/g, '');
    
    let bestLocale = 'en-US';
    let bestPrefixLength = 0;
    for (const prefix in localeMap) {
        if (num.startsWith(prefix) && prefix.length > bestPrefixLength) {
            bestLocale = localeMap[prefix];
            bestPrefixLength = prefix.length;
        }
    }
    return bestLocale;
}

const googleTTS = require('google-tts-api');
const ffmpeg = require('fluent-ffmpeg');

let sharp;
let sharpAvailable = false;
try {
  sharp = require('sharp');
  sharpAvailable = true;
} catch (e) {
  logger.warn('Sharp no disponible - stickers deshabilitados');
}
const SESSION_DIR = path.join(__dirname, 'sesion');

const OWNERS = ['193476247482594@lid', '174110072111309@lid', '271627187126327@lid', '573027332242@s.whatsapp.net', '573027332242@lid'];
const normalizeJid = (jid) => jid?.toString().replace(/@lid$/i, '@s.whatsapp.net');
const sameJid = (jid1, jid2) => {
    if (!jid1 || !jid2) return false;
    return normalizeJid(jid1) === normalizeJid(jid2);
};
const isOwner = (id) => OWNERS.some(owner => sameJid(owner, id)) ||
    [activeSocket?.user?.id, activeSocket?.user?.lid].some(botId => sameJid(botId, id));
const isActiveGroupMute = (muteValue, now = Date.now()) =>
    muteValue === 'permanent' ||
    (typeof muteValue === 'number' && muteValue > now);
const isPermanentGroupMute = (muteValue) =>
    muteValue === 'permanent' ||
    (muteValue && typeof muteValue === 'object' && muteValue.type === 'permanent');
let db = dbUtils.read();
const panelDataPath = path.join(__dirname, 'panel-data.json');
let panelData = { users: {}, groups: {} };
if (fs.existsSync(panelDataPath)) {
    try {
        panelData = JSON.parse(fs.readFileSync(panelDataPath, 'utf8'));
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        const corruptedPath = `${panelDataPath}.corrupt-${Date.now()}-${process.pid}`;
        fs.copyFileSync(panelDataPath, corruptedPath, fs.constants.COPYFILE_EXCL);
        dbUtils.writeAtomic(panelDataPath, panelData);
        console.error(`panel-data.json estaba corrupto; se inicializo vacío. Original preservado en ${path.basename(corruptedPath)}.`);
    }
}
if (!panelData || typeof panelData !== 'object' || Array.isArray(panelData)) panelData = { users: {}, groups: {} };
if (!panelData.users || typeof panelData.users !== 'object' || Array.isArray(panelData.users)) panelData.users = {};
if (!panelData.groups || typeof panelData.groups !== 'object' || Array.isArray(panelData.groups)) panelData.groups = {};
const savePanelData = () => dbUtils.writeAtomic(panelDataPath, panelData);

const botStateFile = path.join(__dirname, 'bot-state.json');
function readBotState() {
    try {
        if (fs.existsSync(botStateFile)) {
            return JSON.parse(fs.readFileSync(botStateFile, 'utf8')).paused || false;
        }
    } catch (e) {
        logger.warn('No se pudo leer el estado del bot', { error: e.message });
    }
    return false;
}

function saveBotState(paused) {
    try {
        dbUtils.writeAtomic(botStateFile, { paused, updatedAt: new Date().toISOString() });
    } catch (e) {
        logger.error('Error guardando estado del bot', { error: e.message });
    }
}

let botPaused = readBotState();
if (!db.users) db.users = {};
if (!db.transacciones) db.transacciones = [];
if (!db.antiraid) db.antiraid = {};
if (!db.backups) db.backups = [];
if (!db.playlists) db.playlists = {};
if (!db.placas) db.placas = {};
if (!db.favoritos) db.favoritos = {};
if (!db.groups) db.groups = {};


function getGroupKey(jid) {
    if (!jid) return null;
    const value = String(jid).trim();
    if (!value) return null;
    return value.replace(/@lid$/i, '@g.us');
}

function getGroupState(jid) {
    if (!jid) return null;
    const raw = getGroupKey(jid);
    const candidates = Array.from(new Set([
        raw,
        raw?.replace(/@g\.us$/i, '@g.us'),
        String(jid).trim(),
        String(jid).trim().replace(/@lid$/i, '@g.us')
    ].filter(Boolean)));

    for (const key of candidates) {
        if (db.groups[key]) return db.groups[key];
    }

    return null;
}

function ensureGroupSettings(jid) {
    const rawKey = String(jid || '').trim();
    const key = getGroupKey(rawKey);
    if (!key) return;

    if (!db.groups[key]) db.groups[key] = { disabledCommands: [], welcome: null, goodbye: null, activo: true, modoadmin: true, roles: {} };
    if (rawKey && rawKey !== key && !db.groups[rawKey]) db.groups[rawKey] = db.groups[key];
    if (!db.groups[key].roles) db.groups[key].roles = {};
    if (!db.groups[key].afk || typeof db.groups[key].afk !== 'object' || Array.isArray(db.groups[key].afk)) {
        db.groups[key].afk = {};
    }
    if (db.groups[key].modoadmin === undefined) db.groups[key].modoadmin = true;
    return db.groups[key];
}

function formatAfkDuration(milliseconds) {
    const totalMinutes = Math.max(1, Math.floor(milliseconds / 60000));
    if (totalMinutes < 60) return `${totalMinutes} minuto${totalMinutes === 1 ? '' : 's'}`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours} hora${hours === 1 ? '' : 's'}${minutes ? ` y ${minutes} minuto${minutes === 1 ? '' : 's'}` : ''}`;
}

function getAfkDetails(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return { startedAt: value, reason: '', mentions: 0 };
    }
    if (!value || typeof value !== 'object' || !Number.isFinite(value.startedAt)) {
        return null;
    }
    return {
        startedAt: value.startedAt,
        reason: typeof value.reason === 'string' ? value.reason : '',
        mentions: Number.isSafeInteger(value.mentions) && value.mentions >= 0 ? value.mentions : 0
    };
}

function pruneStaleGroups(currentGroupIds = []) {
    if (!db.groups) db.groups = {};
    const liveGroupSet = new Set((currentGroupIds || []).filter(Boolean).map(id => String(id).trim()).filter(id => id.endsWith('@g.us')));
    const staleIds = Object.keys(db.groups).filter(id => id.endsWith('@g.us') && !liveGroupSet.has(id));

    if (!staleIds.length) return 0;

    staleIds.forEach((id) => {
        delete db.groups[id];
    });

    saveDB();
    return staleIds.length;
}

function removeGroupFromPanel(jid) {
    if (!jid || !jid.endsWith?.('@g.us')) return false;
    let changed = false;
    if (db.groups?.[jid]) {
        delete db.groups[jid];
        changed = true;
    }
    if (panelData.groups?.[jid]) {
        delete panelData.groups[jid];
        changed = true;
    }
    if (changed) {
        saveDB();
        savePanelData();
    }
    return changed;
}

let groupSyncBackoffUntil = 0;
async function syncCurrentGroups(sock) {
    if (Date.now() < groupSyncBackoffUntil) return [];

    try {
        if (!sock?.groupFetchAllParticipating) return [];
        const groups = await sock.groupFetchAllParticipating();
        groupSyncBackoffUntil = 0;
        const currentIds = Object.keys(groups || {});
        const removed = pruneStaleGroups(currentIds);
        if (removed > 0) {
            logger.info(`Grupos obsoletos eliminados del registro: ${removed}`);
        }

        const joinedGroupIds = currentIds.filter(jid => jid.endsWith('@g.us'));
        for (let index = 0; index < joinedGroupIds.length; index += 3) {
            await Promise.allSettled(
                joinedGroupIds.slice(index, index + 3).map(jid => refreshGroupPanelInfo(sock, jid))
            );
        }

        return currentIds;
    } catch (error) {
        const statusCode = error?.output?.statusCode || error?.statusCode || null;
        const errorMessage = error?.message || String(error);
        if (statusCode === 500 && /rate[- ]overlimit/i.test(errorMessage)) {
            groupSyncBackoffUntil = Date.now() + 5 * 60 * 1000;
        }
        logger.warn({
            statusCode,
            errorName: error?.name || null,
            errorMessage,
            connection: activeSocket === sock ? 'active' : 'stale'
        }, 'No se pudo sincronizar la lista actual de grupos');
        return [];
    }
}

async function getGroupPicture(sock, jid, metadata) {
    if (metadata?.icon && (Buffer.isBuffer(metadata.icon) || ArrayBuffer.isView(metadata.icon))) {
        return `data:image/jpeg;base64,${Buffer.from(metadata.icon).toString('base64')}`;
    }

    if (typeof sock.profilePictureUrl !== 'function') return null;
    try {
        const pictureUrl = await sock.profilePictureUrl(jid, 'image');
        return typeof pictureUrl === 'string' && pictureUrl.startsWith('https://') ? pictureUrl : null;
    } catch (error) {
        logger.debug('No se pudo obtener la foto de perfil del grupo', { jid, error: error.message });
        return null;
    }
}

async function refreshGroupPanelInfo(sock, jid) {
    if (!jid || !jid.endsWith?.('@g.us')) return null;

    try {
        const metadata = await sock.groupMetadata(jid);
        if (!metadata) return null;

        const picture = await getGroupPicture(sock, jid, metadata);
        const groupName = metadata.subject || jid;

        if (!panelData.groups[jid]) panelData.groups[jid] = {};
        panelData.groups[jid].name = groupName;
        if (picture) panelData.groups[jid].picture = picture;
        panelData.groups[jid].updatedAt = Date.now();

        if (!db.groups[jid]) db.groups[jid] = { disabledCommands: [], welcome: null, goodbye: null, activo: true, modoadmin: true, roles: {} };
        db.groups[jid].name = groupName;
        db.groups[jid].nombre = groupName;
        db.groups[jid].updatedAt = Date.now();

        savePanelData();
        saveDB();
        return panelData.groups[jid];
    } catch (error) {
        logger.debug('No se pudo actualizar la información del grupo', { jid, error: error.message });
        if (!panelData.groups[jid]) panelData.groups[jid] = {};
        panelData.groups[jid].name = panelData.groups[jid].name || jid;
        panelData.groups[jid].updatedAt = Date.now();
        savePanelData();
        return null;
    }
}

function isBotActiveInGroup(jid) {
    const group = getGroupState(jid) || ensureGroupSettings(jid);
    return !!group && group.activo !== false;
}

function setBotActiveInGroup(jid, active) {
    const rawKey = String(jid || '').trim();
    const key = getGroupKey(rawKey);
    if (!key) return false;

    const group = getGroupState(rawKey) || ensureGroupSettings(rawKey);
    if (!group) return false;

    group.activo = active;
    db.groups[key] = group;
    if (rawKey && rawKey !== key) db.groups[rawKey] = group;
    return saveDBImmediate();
}

function registrarAccionAdmin(jid, admin, accion) {
    ensureGroupSettings(jid);
    if (!db.groups[jid].registroAdmin) db.groups[jid].registroAdmin = [];
    
    db.groups[jid].registroAdmin.push({
        admin: admin,
        accion: accion,
        fecha: new Date().toLocaleString('es-ES'),
        timestamp: Date.now()
    });

    if (db.groups[jid].registroAdmin.length > 100) {
        db.groups[jid].registroAdmin.shift();
    }
    
    saveDB();
}

function isCommandDisabledInGroup(jid, cmd) {
    if (!jid || !cmd) return false;
    ensureGroupSettings(jid);
    const list = db.groups[jid].disabledCommands || [];
    const normalized = normalizeDisabledCommand(cmd);
    return list.some(disabledCommand => normalizeDisabledCommand(disabledCommand) === normalized);
}

function setCommandDisabledInGroup(jid, cmd, disabled) {
    ensureGroupSettings(jid);
    const normalized = normalizeDisabledCommand(cmd);
    const list = db.groups[jid].disabledCommands || [];
    if (disabled) {
        if (!list.includes(normalized)) list.push(normalized);
    } else {
        const idx = list.indexOf(normalized);
        if (idx !== -1) list.splice(idx, 1);
    }
    db.groups[jid].disabledCommands = list;
    saveDB();
}


const saveDB = () => {
    
    if (!dbUtils.validate(db)) {
        logger.error('Datos de BD inválidos, guardado cancelado');
        reportPanelDiagnostic({ event: 'database.failure', message: 'Datos inválidos; se canceló el guardado.' });
        return false;
    }
    
    if (!dbUtils.saveDebounced(db)) {
        logger.error('No se pudo programar el guardado de la base de datos');
        reportPanelDiagnostic({ event: 'database.failure', message: 'No se pudo programar el guardado de la base de datos.' });
        return false;
    }
    return true;
};

const saveDBImmediate = () => {
    if (!dbUtils.validate(db)) {
        logger.error('Datos de BD inválidos, guardado inmediato cancelado');
        reportPanelDiagnostic({ event: 'database.failure', message: 'Datos inválidos; se canceló el guardado inmediato.' });
        return false;
    }

    dbUtils.flushPending();
    const saved = dbUtils.write(db);
    if (!saved) reportPanelDiagnostic({ event: 'database.failure', message: 'Falló el guardado inmediato de la base de datos.' });
    return saved;
};

const messageCache = new Map();
const cache = {
    groupMetadata: new Map(),
    userData: new Map()
};
const taskQueue = [];
let activeTasks = 0;
const MAX_TASKS = 2;

function queueTask(task) {
    return new Promise((resolve, reject) => {
        taskQueue.push({ task, resolve, reject });
        processTaskQueue();
    });
}

async function processTaskQueue() {
    if (activeTasks >= MAX_TASKS || taskQueue.length === 0) return;
    const job = taskQueue.shift();
    activeTasks++;
    try {
        const result = await job.task();
        job.resolve(result);
    } catch (err) {
        job.reject(err);
    } finally {
        activeTasks--;
        setImmediate(processTaskQueue);
    }
}

function addToMessageCache(message) {
    if (!message?.key?.id) return;
    messageCache.set(message.key.id, {
        message: message.message,
        key: message.key,
        participant: message.key.participant || message.key.remoteJid
    });
    setTimeout(() => messageCache.delete(message.key.id), 6 * 60 * 60 * 1000); 
}


setInterval(() => {
    try {
        if (!dbUtils.createBackup(db)) {
            logger.error('Falló la copia de seguridad automática.');
            reportPanelDiagnostic({ event: 'backup.failure', message: 'Falló la copia de seguridad automática.' });
            return;
        }
        dbUtils.pruneBackups(24);
        reportPanelDiagnostic({ event: 'backup.success', message: 'Copia de seguridad automática completada.' });
    } catch (e) {
        logger.error('Error en backup automático', { error: e.message });
        reportPanelDiagnostic({ event: 'backup.failure', message: `Error en backup automático: ${e.message}` });
    }
}, 3600000); 


setInterval(() => {
    try {
        mediaHandler.cleanupOldFiles(24);

        const patterns = [/^voz_temp_.*\.mp3$/i, /.*_temp_.*\.mp3$/i, /^.*\.tmp$/i];
        const files = fs.readdirSync(__dirname);

        files.forEach(file => {
            try {
                if (!patterns.some(rx => rx.test(file))) return;
                const pathFile = path.join(__dirname, file);
                if (fs.existsSync(pathFile) && Date.now() - fs.statSync(pathFile).mtime > 3600000) {
                    fs.unlinkSync(pathFile);
                    logger.debug('Archivo temporal eliminado', { file: pathFile });
                }
            } catch (e) {
                logger.debug('No se pudo eliminar archivo temporal', { file, error: e.message });
            }
        });
    } catch (e) {
        logger.warn('Error en limpieza de temporales', { error: e.message });
    }
}, 6 * 60 * 60 * 1000);


setInterval(() => {
    try {
        const now = Date.now();
        const tempFiles = fs.readdirSync(__dirname).filter(file =>
            /^(?:voz_temp_|.*_temp_).*\.mp3$/i.test(file) || /^.*\.tmp$/i.test(file)
        );
        tempFiles.forEach(file => {
            try {
                const pathFile = path.join(__dirname, file);
                const stats = fs.statSync(pathFile);
                
                if (!stats.isDirectory() && now - stats.mtime > 30 * 60 * 1000) {
                    fs.unlinkSync(pathFile);
                    logger.debug('Temporal limpiado', { file: pathFile });
                }
            } catch (e) {
                logger.debug('No se pudo limpiar temporal', { file, error: e.message });
            }
        });
    } catch (e) {
        logger.debug('Error en limpieza agresiva', { error: e.message });
    }
}, 30 * 60 * 1000);


const cooldownGlobal = new Map();
let lastCooldownCleanupMinute = 0;
let commandCooldowns = {};
const MAX_COMMANDS_PER_MINUTE = 20;
const COMMAND_COOLDOWNS = {
    '.s': 3000,
    '.wm': 3000,
    '.qr': 3000,
    '.voz': 5000,
    '.kick': 10000
};

const GROUP_MODERATION_COMMANDS = new Set([
    '.cmd', '.apagar', '.prender', '.inactivos', '.kick', '.ban',
    '.setwelcome', '.setgoodbye', '.goodbye',
    '.promote', '.demote', '.cerrar', '.abrir', '.invitacion', '.registro', '.logs', '.rol',
    '.roles', '.tagall', '.hidetag', '.warn', '.warns', '.unwarn', '.mute',
    '.unmute', '.unmutetemp', '.unmuteperma', '.del', '.delreg', '.placas', '.agg', '.admin', '.n', '.free',
    '.susurro', '.guerra', '.slowmode',
    '.estadisticas_grupo', '.antiraid', '.backup', '.limpiar_transacciones',
    '.reset_user', '.matadero', '.mataderoquitar', '.kickall', '.limpiar'
]);

const ADMIN_MODE_COMMANDS = new Set(['.musica', '.ping']);

function verificarCooldown(sender) {
    const currentMinute = Math.floor(Date.now() / 60000);
    let entry = cooldownGlobal.get(sender);
    if (!entry || entry.minute !== currentMinute) {
        entry = { minute: currentMinute, count: 0 };
        cooldownGlobal.set(sender, entry);
    }
    entry.count++;

    if (lastCooldownCleanupMinute !== currentMinute) {
        lastCooldownCleanupMinute = currentMinute;
        for (const [user, cooldown] of cooldownGlobal) {
            if (currentMinute - cooldown.minute > 1) cooldownGlobal.delete(user);
        }
    }

    if (entry.count > MAX_COMMANDS_PER_MINUTE) {
        return false;
    }
    return true;
}

function verificarCooldownComando(sender, comando) {
    const cooldownMs = COMMAND_COOLDOWNS[comando];
    if (!cooldownMs) return true;
    
    const key = `${comando}_${sender}`;
    const ahora = Date.now();
    
    if (commandCooldowns[key] && ahora - commandCooldowns[key] < cooldownMs) {
        return false;
    }
    
    commandCooldowns[key] = ahora;
    
    if (Math.random() < 0.01) {
        Object.keys(commandCooldowns).forEach(k => {
            if (ahora - commandCooldowns[k] > 3600000) {
                delete commandCooldowns[k];
            }
        });
    }
    
    return true;
}


function registrarTransaccion(tipo, origen, destino, monto, razon = '') {
    if (!db.transacciones) db.transacciones = [];
    db.transacciones.push({
        tipo,
        origen,
        destino,
        monto,
        razon,
        fecha: new Date().toISOString()
    });
    
    if (db.transacciones.length > 1000) {
        db.transacciones = db.transacciones.slice(-1000);
    }
    saveDB();
}

function getText(message) {
    if (!message) return '';
    if (message.conversation) return message.conversation;
    if (message.extendedTextMessage) return message.extendedTextMessage.text;
    if (message.imageMessage) return message.imageMessage.caption || '';
    if (message.videoMessage) return message.videoMessage.caption || '';
    if (message.documentMessage) return message.documentMessage.caption || '';
    if (message.audioMessage) return message.audioMessage.caption || '';
    if (message.stickerMessage) return message.stickerMessage.caption || '';
    if (message.ephemeralMessage) return getText(message.ephemeralMessage.message);
    if (message.viewOnceMessage) return getText(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2) return getText(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension) return getText(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage) return getText(message.documentWithCaptionMessage.message);
    if (message.editedMessage) return getText(message.editedMessage.message);
    return '';
}

function unwrapViewOnceMessage(message) {
    let current = normalizeMessageContent?.(message) || message;
    while (current) {
        const wrapper = current.ephemeralMessage || current.viewOnceMessage || current.viewOnceMessageV2 || current.viewOnceMessageV2Extension;
        if (!wrapper?.message) return current;
        current = normalizeMessageContent?.(wrapper.message) || wrapper.message;
    }
    return null;
}

function getMessageContextInfo(message) {
    const content = normalizeMessageContent?.(message) || message || {};
    const type = Object.keys(content).find(key => key.endsWith('Message') && content[key]?.contextInfo);
    return type ? content[type].contextInfo : content.extendedTextMessage?.contextInfo;
}

async function downloadQuotedMedia(message, maxBytes = Infinity) {
    const mediaMessage = unwrapViewOnceMessage(message);
    if (!mediaMessage) return null;

    const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];
    const mediaType = mediaTypes.find(type => mediaMessage[type]);
    if (!mediaType) return null;

    const contentType = mediaType.replace('Message', '');
    const stream = await downloadContentFromMessage(mediaMessage[mediaType], contentType);
    const chunks = [];
    let size = 0;
    for await (const chunk of stream) {
        size += chunk.length;
        if (size > maxBytes) {
            throw new Error(`La imagen supera el límite de ${Math.floor(maxBytes / (1024 * 1024))} MB.`);
        }
        chunks.push(chunk);
    }

    return {
        type: contentType,
        data: Buffer.concat(chunks),
        message: mediaMessage[mediaType]
    };
}

async function downloadQuotedAudio(message) {
    const mediaMessage = unwrapViewOnceMessage(message);
    const audioMessage = mediaMessage?.audioMessage;
    if (!audioMessage) return null;

    const stream = await downloadContentFromMessage(audioMessage, 'audio');
    const chunks = [];
    let size = 0;
    for await (const chunk of stream) {
        size += chunk.length;
        if (size > MAX_GROUP_AUDIO_BYTES) {
            throw new Error('El audio supera el límite de 15 MB.');
        }
        chunks.push(chunk);
    }

    return {
        data: Buffer.concat(chunks),
        mimetype: audioMessage.mimetype || 'audio/ogg; codecs=opus',
        ptt: Boolean(audioMessage.ptt)
    };
}

let reconnectTimer = null;
let reconnectAttempt = 0;
let stoppingBot = false;
const acertijoActivo = {};
const adivinanzaActiva = {};
const ahorcadoJuego = {};
const casinoJuegos = {};

const controlServer = http.createServer(async (request, response) => {
    if (request.method !== 'POST' || !['/leave-group', '/group/toggle'].includes(request.url)) {
        response.writeHead(404);
        return response.end();
    }
    let body = '';
    request.on('data', chunk => {
        body += chunk;
        if (body.length > 8192) {
            response.writeHead(413);
            response.end();
            request.destroy();
        }
    });
    request.on('end', async () => {
        try {
            const payload = JSON.parse(body || '{}');
            const { groupId } = payload;
            if (!/^\d+(?:-\d+)?@g\.us$/.test(String(groupId || ''))) throw new Error('Grupo inválido');
            if (request.url === '/group/toggle') {
                if (typeof payload.active !== 'boolean') throw new Error('Estado del grupo inválido');
                if (!setBotActiveInGroup(groupId, payload.active)) throw new Error('No se pudo guardar la base de datos');
                response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
                response.end(JSON.stringify({ success: true, groupId, active: payload.active }));
                return;
            }
            if (!activeSocket) throw new Error('El bot aún no está conectado');
            await activeSocket.groupLeave(groupId);
            removeGroupFromPanel(groupId);
            response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify({ success: true, groupId }));
        } catch (error) {
            response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify({ error: error.message || 'No se pudo salir del grupo' }));
        }
    });
});
controlServer.on('error', error => console.error('Error en el control del panel:', error.message));
controlServer.listen(CONTROL_PORT, '127.0.0.1', () => console.log(`Control del panel activo en 127.0.0.1:${CONTROL_PORT}.`));

function archiveSession(reasonLabel = 'invalid') {
    const backupDir = `${SESSION_DIR}_invalid_${Date.now()}_${String(reasonLabel).replace(/[^a-z0-9_-]+/gi, '_').toLowerCase()}`;
    try {
        if (fs.existsSync(SESSION_DIR)) {
            fs.renameSync(SESSION_DIR, backupDir);
            logger.warn('Sesión de WhatsApp invalidada; se archivó para volver a vincular.', { backupDir, reason: reasonLabel });
        }
        return backupDir;
    } catch (error) {
        logger.error('No se pudo archivar la sesión de WhatsApp invalidada', { error: error.message, reason: reasonLabel });
        return null;
    }
}

function shouldResetSessionForClose({ reasonNode, statusCode, disconnectError }) {
    const reasonType = String(reasonNode?.attrs?.type || reasonNode?.tag || '');
    const errorMessage = String(disconnectError?.message || '');
    const combined = `${reasonType} ${errorMessage}`.toLowerCase();
    const invalidSessionHints = [
        'bad mac',
        'no matching sessions found',
        'no session found to decrypt',
        'invalid session',
        'session not found',
        'session.*invalid',
        'device_removed',
        'logged_out'
    ];
    const isConflictReset = reasonNode?.tag === 'conflict' && ['device_removed', 'invalid_session', 'bad_session'].includes(reasonNode.attrs?.type);
    return isConflictReset || statusCode === DisconnectReason.loggedOut || invalidSessionHints.some(hint => combined.includes(hint));
}

function scheduleReconnect(delayMs = null) {
    if (stoppingBot || reconnectTimer) return;
    reconnectAttempt += 1;
    const delay = delayMs ?? Math.min(60000, 5000 * reconnectAttempt);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startBot().catch(error => {
            logger.logCritical('Error al reconectar el bot', error);
            scheduleReconnect();
        });
    }, delay);
    logger.warn('WhatsApp se desconectó; se reintentará la conexión.', {
        attempt: reconnectAttempt,
        delayMs: delay
    });
}

async function startBot() {
    if (stoppingBot) return;
    reportPanelDiagnostic({ connection: 'connecting' });
    logger.info('Bot iniciando...', { owners: OWNERS.length });
    await loadBaileys();
    
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'error' }), 
        browser: ['Gonx!ta Bot', 'Chrome', '1.0.0'],
        emitOwnEvents: false,
        connectTimeoutMs: 120000,
        defaultQueryTimeoutMs: 180000,
        keepAliveIntervalMs: 30000
    });
    activeSocket = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('groups.update', async (updates) => {
        const items = Array.isArray(updates) ? updates : [updates];
        for (const item of items || []) {
            const jid = item?.id || item?.jid;
            if (jid) {
                await refreshGroupPanelInfo(sock, jid).catch(() => {});
            }
        }
    });

    sock.ev.on('groups.upsert', async (updates) => {
        const items = Array.isArray(updates) ? updates : [updates];
        for (const item of items || []) {
            const jid = item?.id || item?.jid;
            if (jid) {
                await refreshGroupPanelInfo(sock, jid).catch(() => {});
            }
        }
    });

    sock.ev.on('group-participants.update', async (update) => {
        const jid = update?.id || update?.jid;
        const botJid = sock.user?.id?.split(':')[0];
        const removedBot = update?.action === 'remove' && (update?.participants || []).some((participant) => String(participant).split(':')[0] === botJid);
        if (jid && removedBot) {
            removeGroupFromPanel(jid);
            logger.info(`Gonx!ta Bot salió del grupo y fue eliminado del panel: ${jid}`);
        }
        if (jid && !removedBot && ['add', 'remove'].includes(update?.action)) {
            const settings = getGroupState(jid) || ensureGroupSettings(jid);
            if (update.action === 'add' && typeof settings?.welcomeText === 'string' && settings.welcomeText.trim()) {
                let image = null;
                const imageName = typeof settings.welcomeImage === 'string'
                    ? path.basename(settings.welcomeImage)
                    : null;
                const imagePath = imageName ? path.join(GROUP_WELCOME_IMAGE_DIR, imageName) : null;
                if (imagePath && fs.existsSync(imagePath)) {
                    try {
                        image = fs.readFileSync(imagePath);
                    } catch (error) {
                        logger.error('No se pudo leer la imagen de bienvenida', { jid, error: error.message });
                    }
                } else if (imageName) {
                    logger.warn('No se encontró la imagen de bienvenida del grupo', { jid, imagePath });
                }

                for (const participant of update.participants || []) {
                    const participantJid = typeof participant === 'string'
                        ? participant
                        : participant?.id || participant?.jid;
                    if (!participantJid) continue;

                    try {
                        await sock.sendMessage(jid, createWelcomeMessage(
                            settings.welcomeText,
                            participantJid,
                            image,
                            settings.welcomeImageMime || 'image/jpeg'
                        ));
                    } catch (error) {
                        logger.error('No se pudo enviar el mensaje de bienvenida', {
                            jid,
                            participantJid,
                            error: error.message
                        });
                    }
                }
            } else if (update.action === 'remove') {
                const kind = 'goodbye';
                const audioName = settings?.goodbyeAudio;
                const audioPath = typeof audioName === 'string'
                    ? path.join(GROUP_AUDIO_DIR, path.basename(audioName))
                    : null;

                if (settings?.goodbyeEnabled && audioPath) {
                    if (!fs.existsSync(audioPath)) {
                        logger.warn(`No se encontró el audio de ${kind} para el grupo`, { jid, audioPath });
                    } else {
                        try {
                            const audio = fs.readFileSync(audioPath);
                            for (const participant of update.participants || []) {
                                const participantJid = typeof participant === 'string'
                                    ? participant
                                    : participant?.id || participant?.jid;
                                if (!participantJid) continue;
                                await sock.sendMessage(jid, {
                                    audio,
                                    mimetype: settings.goodbyeAudioMime || 'audio/ogg; codecs=opus',
                                    ptt: Boolean(settings.goodbyeAudioPtt)
                                });
                            }
                        } catch (error) {
                            logger.error(`No se pudo enviar el audio de ${kind}`, { jid, error: error.message });
                        }
                    }
                }
            }
        }
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (connection) whatsappConnection = connection;
        
        if (qr) {
            console.log('⬇️ ESCANEA ESTE CÓDIGO QR ⬇️');
            console.log('\n========== QR Gonx!ta Bot INICIO ==========' );
            qrcode.generate(qr, { small: true });
            console.log('=========== QR Gonx!ta Bot FIN ===========\n');
        }

        if (connection === 'close') {
            reportPanelDiagnostic({ connection: 'disconnected' });
            if (activeSocket === sock) activeSocket = null;
            
            let statusCode = null;
            try {
                statusCode = lastDisconnect?.error?.output?.statusCode;
            } catch (error) {
                logger.warn('No se pudo determinar la causa del cierre de WhatsApp', { error: error.message });
            }
            const disconnectError = lastDisconnect?.error;
            const errorNode = disconnectError?.data;
            const reasonNode = update.reasonNode
                || errorNode?.content?.find(child => child?.tag)
                || (errorNode?.tag ? errorNode : null);
            logger.warn('Conexión de WhatsApp cerrada', {
                statusCode,
                errorName: disconnectError?.name || null,
                errorMessage: disconnectError?.message || null,
                reasonTag: reasonNode?.tag || null,
                reasonType: reasonNode?.attrs?.type || null
            });

            const isConnectionReplaced = reasonNode?.tag === 'conflict' && reasonNode.attrs?.type === 'replaced'
                || statusCode === DisconnectReason.connectionReplaced;
            if (isConnectionReplaced) {
                logger.error('WhatsApp reemplazó esta sesión por otra conexión. Se detienen los reintentos para evitar un ciclo; verifica dónde se está usando esta misma sesión antes de reiniciar el bot.');
                return;
            }

            const shouldResetSession = shouldResetSessionForClose({ reasonNode, statusCode, disconnectError });
            if (shouldResetSession) {
                archiveSession(reasonNode?.attrs?.type || disconnectError?.name || 'invalid_session');
                scheduleReconnect(5000);
                return;
            }

            scheduleReconnect();
        } else if (connection === 'open') {
            reconnectAttempt = 0;
            reportPanelDiagnostic({ connection: 'connected' });

            console.clear();
            console.log('✅ Gonx!ta Bot está conectado y listo.');

        }
    });



sock.ev.on('messages.upsert', async (chatUpdate) => {
    try {
        for (const m of chatUpdate.messages || []) {
        if (!m.message) continue;
        let messageContent = getText(m.message).trim();
        const isWhatsAppMenuCommand = /^[/.#]menu(?:\s|$)/i.test(messageContent);
        if (isWhatsAppMenuCommand) {
            logger.info({
                fromMe: Boolean(m.key.fromMe),
                chatType: m.key.remoteJid?.endsWith('@g.us') ? 'group' : 'private'
            }, 'Comando .menu recibido');
        }
        const isFromMeCommand = Boolean(m.key.fromMe && isCommandMessage(messageContent));
        if (m.key.fromMe && !isFromMeCommand) continue;
        if (m.key?.id && messageCache.has(m.key.id)) continue;

        addToMessageCache(m);

        let jid = m.key.remoteJid;
        const sender = m.key.fromMe
            ? (m.key.participant || m.key.participantPn || sock.user?.id || sock.user?.lid || jid)
            : (m.key.participant || m.key.participantPn || jid);

        activityStore.recordMessage(sender);

        
        if (!m.key.fromMe && db.users[sender]?.muteado && db.users[sender].muteado > Date.now()) {
            try {
                await sock.sendMessage(jid, { delete: m.key });
            } catch (err) {
                console.log('No se pudo eliminar el mensaje del usuario muteado');
            }
            return;
        } else if (!m.key.fromMe && db.users[sender]?.muteado && db.users[sender].muteado <= Date.now()) {
            delete db.users[sender].muteado;
            saveDB();
        }

        const groupMute = jid.endsWith('@g.us') ? db.groups[jid]?.muteados?.[sender] : null;
        if (!m.key.fromMe && isActiveGroupMute(groupMute)) {
            try {
                await sock.sendMessage(jid, { delete: m.key });
            } catch (err) {
                console.log('No se pudo eliminar el mensaje del usuario muteado en grupo');
            }
            return;
        } else if (!m.key.fromMe && jid.endsWith('@g.us') && typeof groupMute === 'number' && groupMute <= Date.now()) {
            delete db.groups[jid].muteados[sender];
            saveDB();
        }

        if (!m.key.fromMe && jid.endsWith('@g.us')) {
            const groupSettings = ensureGroupSettings(jid);
            const afkDetails = getAfkDetails(groupSettings.afk[sender]);
            const isAfkCommand = /^[/.#]afk(?:\s|$)/i.test(messageContent);
            const contextInfo = getMessageContextInfo(m.message);
            const mentionedJid = contextInfo?.mentionedJid || [];
            let mentionsUpdated = false;
            for (const [afkUser, value] of Object.entries(groupSettings.afk)) {
                if (sameJid(afkUser, sender)) continue;
                const details = getAfkDetails(value);
                if (!details) continue;
                const mentionCount = mentionedJid.filter(mentioned => sameJid(mentioned, afkUser)).length;
                if (mentionCount > 0) {
                    groupSettings.afk[afkUser] = {
                        ...details,
                        mentions: details.mentions + mentionCount
                    };
                    mentionsUpdated = true;
                }
            }
            if (mentionsUpdated) saveDB();
            if (afkDetails && !isAfkCommand) {
                const mentionCount = mentionedJid.filter(mentioned => sameJid(mentioned, sender)).length;
                if (mentionCount > 0) {
                    afkDetails.mentions += mentionCount;
                }
                delete groupSettings.afk[sender];
                saveDB();
                await sock.sendMessage(jid, {
                    text: `✅ @${sender.split('@')[0]} ha vuelto. Estuvo AFK durante ${formatAfkDuration(Date.now() - afkDetails.startedAt)}.\nMenciones durante su ausencia: ${afkDetails.mentions || 0}.${afkDetails.reason ? `\nMotivo: ${afkDetails.reason}` : ''}`,
                    mentions: [sender]
                });
                return;
            }
        } 7

        if (!isCommandMessage(messageContent)) return;

        const [originalCommand, ...args] = messageContent.split(/\s+/);
        const command = normalizeCommand(originalCommand);
        const commandCategory = getCommandCategory(command);
        const isMenuCommand = command === '.menu';
        const subCommand = args[0]?.toLowerCase();
        const isGroupChat = jid.endsWith('@g.us');
        const aiQuestion = command === '.ia' ? messageContent.slice(originalCommand.length).trim() : null;
        if (aiQuestion && aiQuestion.length > 1000) {
            return await sock.sendMessage(jid, { text: 'La pregunta es demasiado larga (máximo 1000 caracteres).' });
        }
        if ((!validateUserInput(messageContent) && command !== '.ia')
            || (!isMenuCommand && !verificarCooldown(sender))
            || !verificarCooldownComando(sender, command)) {
            return;
        }
        let participants = [];

        botPaused = readBotState();
        const isOwnerBotControlCommand = isOwner(sender) && ['.prender', '.apagar'].includes(command);
        if (jid && jid.endsWith('@g.us') && !isBotActiveInGroup(jid) && !isOwnerBotControlCommand && !isMenuCommand) {
            return;
        }
        if (botPaused && !(isOwner(sender) && command === '.prender') && !isMenuCommand) {
            return;
        }

        const remoteGroupKickMatch = command.match(/^\.(\d+(?:-\d+)?)(?:@g\.us)?$/i);
        if (remoteGroupKickMatch && args[0]?.toLowerCase() === 'kick') {
            if (!isOwner(sender)) {
                return await sock.sendMessage(jid, { text: '❌ Solo los owners pueden usar este comando.' });
            }

            const targetGroupJid = `${remoteGroupKickMatch[1]}@g.us`;
            let targetMetadata;
            try {
                targetMetadata = await sock.groupMetadata(targetGroupJid);
            } catch (error) {
                logger.warn('No se pudo consultar el grupo para kick remoto', {
                    groupJid: targetGroupJid,
                    error: error.message
                });
                return await sock.sendMessage(jid, { text: '❌ No pude encontrar o consultar ese grupo.' });
            }

            const botJid = sock.user?.id?.split(':')[0];
            const botParticipant = targetMetadata.participants.find(participant =>
                [participant.id, participant.lid, participant.phoneNumber].some(id => sameJid(id, botJid))
            );
            if (!botParticipant?.admin) {
                return await sock.sendMessage(jid, { text: '❌ Gonx!ta Bot debe ser administrador en ese grupo.' });
            }

            const contextInfo = getMessageContextInfo(m.message);
            const users = [
                ...(contextInfo?.mentionedJid || []),
                ...(contextInfo?.participant ? [contextInfo.participant] : []),
                ...(m.message.reactionMessage?.key?.participant || m.message.reactionMessage?.key?.remoteJid
                    ? [m.message.reactionMessage.key.participant || m.message.reactionMessage.key.remoteJid]
                    : [])
            ];
            const uniqueUsers = [...new Set(users.filter(Boolean))];
            if (!uniqueUsers.length) {
                return await sock.sendMessage(jid, {
                    text: '⚠️ Uso: .ID_DEL_GRUPO kick mencionando al usuario, respondiendo a su mensaje o reaccionando a él.'
                });
            }

            const kickedUsers = [];
            const errors = [];
            for (const user of uniqueUsers) {
                const participant = targetMetadata.participants.find(candidate =>
                    [candidate.id, candidate.lid, candidate.phoneNumber].some(id => sameJid(id, user))
                );
                const targetUser = participant?.id || participant?.lid || user;

                if (!participant) {
                    errors.push(`❌ @${String(user).split('@')[0]} no pertenece a ese grupo.`);
                    continue;
                }
                if (isOwner(targetUser)) {
                    errors.push('❌ No puedo eliminar al dueño de Gonx!ta Bot.');
                    continue;
                }

                try {
                    await sock.groupParticipantsUpdate(targetGroupJid, [targetUser], 'remove');
                    kickedUsers.push(targetUser);
                    registrarAccionAdmin(targetGroupJid, sender, `👋 @${targetUser.split('@')[0]} expulsado`);
                } catch (error) {
                    logger.warn('No se pudo ejecutar kick remoto', {
                        groupJid: targetGroupJid,
                        user: targetUser,
                        error: error.message
                    });
                    errors.push(`❌ Error eliminando a @${targetUser.split('@')[0]}.`);
                }
            }

            if (kickedUsers.length) {
                await sock.sendMessage(jid, {
                    text: `👋 ${kickedUsers.map(user => `@${user.split('@')[0]}`).join(', ')} han sido eliminados de *${targetMetadata.subject || targetGroupJid}*.`,
                    mentions: kickedUsers
                });
            }
            if (errors.length) {
                await sock.sendMessage(jid, { text: errors.join('\n') });
            }
            return;
        }

            let isAdmin = isOwner(sender);

            if (isGroupChat) {
                const groupMetadata = await sock.groupMetadata(jid);
                participants = groupMetadata.participants;
                isAdmin = participants.find(p => [p.id, p.lid, p.phoneNumber].some(id => sameJid(id, sender)))?.admin || isOwner(sender);
                ensureGroupSettings(jid);
                const existingGroupData = panelData.groups[jid] || {};
                const picture = existingGroupData.picture || await getGroupPicture(sock, jid, groupMetadata);
                panelData.groups[jid] = {
                    ...existingGroupData,
                    name: groupMetadata.subject || jid,
                    ...(picture ? { picture } : {}),
                    updatedAt: Date.now()
                };
            }

            panelData.users[sender] = { name: m.pushName || db.users[sender]?.nombre || 'Usuario', updatedAt: Date.now() };
            savePanelData();

            
            if (isGroupChat && command !== '.cmd' && !isMenuCommand) {
                if (isCommandDisabledInGroup(jid, command)) {
                    return await sock.sendMessage(jid, { text: `❌ El comando ${command} está deshabilitado en este grupo.` });
                }
            }

            if (commandCategory === 'stickers' && await stickerCommands.handleStickerCommand({
                command,
                args,
                jid,
                message: m,
                sock,
                getQuotedMessageContextInfo: getMessageContextInfo,
                unwrapMessage: unwrapViewOnceMessage,
                downloadContentFromMessage,
                logger
            })) return;

            if (commandCategory === 'multimedia' && await qrCommands.handleQrCommand({
                command,
                args,
                jid,
                message: m,
                sock
            })) return;

            if (!db.users[sender]) {
                db.users[sender] = { nombre: 'Usuario', monedas: 0, nivel: 1, xp: 0 };
            }
            db.users[sender].ultimoAcceso = Date.now();


            await processCommands({
                ADMIN_MODE_COMMANDS,
                GROUP_MODERATION_COMMANDS,  
                OWNERS,
                activityStore,
                aiCommands,
                aiService,
                aiQuestion,
                createTemporaryMenuLink,
                args,
                acertijoActivo,
                adivinanzaActiva,
                ahorcadoJuego,
                bratCommands,
                casinoJuegos,
                command,
                commandCategory,
                db,
                dbUtils,
                expandedLocalCommands,
                GROUP_AUDIO_DIR,
                GROUP_WELCOME_IMAGE_DIR,
                downloadAndSendAudio,
                downloadAndSendGenericMedia,
                downloadAndSendInstagram,
                downloadAndSendTikTok,
                downloadContentFromMessage,
                downloadQuotedAudio,
                downloadQuotedMedia,
                ensureFfmpeg,
                ensureGroupSettings,
                formatAfkDuration,
                getAfkDetails,
                getLocaleFromJid,
                getMessageContextInfo,
                getText,
                googleTTS,
                groupAdminCommands,
                isActiveGroupMute,
                isAdmin,
                isBotActiveInGroup,
                isGroupChat,
                isOwner,
                fs,
                jid,
                logger,
                m,
                participants,
                path,
                queueTask,
                registrarAccionAdmin,
                registrarTransaccion,
                saveDB,
                saveDBImmediate,
                searchAndSendGif,
                sender,
                setBotActiveInGroup,
                setCommandDisabledInGroup,
                sharp,
                sharpAvailable,
                sock,
                unwrapViewOnceMessage,
                verificarCooldownComando
            });
        }
        } catch (err) {
            console.error('Error:', err.message);
        }
    });

   
sock.ev.on('messages.reaction', async (reactionUpdates) => {
    try {
        for (const update of reactionUpdates) {

            const { key, reaction } = update;

            if (!key || !reaction) continue;

            const jid = key.remoteJid;
            const messageId = key.id;
            const reactedMessageId = key.id || reaction.key?.id;
            const sender = reaction.key?.participant || key.participant || reaction.key?.participantPn || key.participantPn;
            const senderPn = reaction.key?.participantPn || key.participantPn;
            const emoji = reaction.text;

            
            if (!jid.endsWith('@g.us')) continue;

            
            const kickReactions = ['👋', '🚪', '❌', '🔴'];
            const warnReactions = ['⚠️', '⚠'];
            if (!kickReactions.includes(emoji) && !warnReactions.includes(emoji)) continue;

            const groupMetadata = await sock.groupMetadata(jid);
            const participants = groupMetadata.participants;

            const isAdmin = participants.some(p => {
                const participantIds = [p.id, p.lid].filter(Boolean);
                const matches = participantIds.some(id => sameJid(id, sender) || sameJid(id, senderPn));
                return matches && (p.admin === 'admin' || p.admin === 'superadmin' || p.admin === true);
            });

            if (!isAdmin) {
                continue;
            }
            
            try {
                const quotedMessage = messageCache.get(reactedMessageId);
                if (!quotedMessage) {
                    logger.debug('Mensaje citado no encontrado', { reactedMessageId });
                }

                const targetUser =
                    quotedMessage?.participant ||
                    quotedMessage?.key?.participant ||
                    key.participant ||
                    key.participantPn ||
                    quotedMessage?.participantPn ||
                    quotedMessage?.key?.participantPn ||
                    reaction.key?.participant ||
                    reaction.key?.participantPn;
                if (!targetUser) continue;

                
                if (isOwner(targetUser)) {
                    await sock.sendMessage(jid, {
                        text: warnReactions.includes(emoji)
                            ? '❌ No puedo dar aviso al dueño de Gonx!ta Bot.'
                            : '❌ No puedo eliminar al dueño de Gonx!ta Bot.'
                    });
                    continue;
                }

                try {console.log("===== KICK DEBUG =====");
console.log("Grupo:", jid);
console.log("Reactor:", sender);
console.log("Objetivo:", targetUser);
console.log("======================");
                    if (warnReactions.includes(emoji)) {
                        ensureGroupSettings(jid);
                        if (!db.groups[jid].advertencias) db.groups[jid].advertencias = {};
                        if (!db.groups[jid].advertencias[targetUser]) db.groups[jid].advertencias[targetUser] = [];

                        db.groups[jid].advertencias[targetUser].push({
                            razon: 'Aviso por reacción',
                            admin: sender,
                            fecha: new Date().toLocaleString('es-ES'),
                            timestamp: Date.now()
                        });

                        const avisos = db.groups[jid].advertencias[targetUser].length;
                        registrarAccionAdmin(jid, sender, `⚠️ Aviso por reacción a @${targetUser.split('@')[0]} (${avisos}/3)`);
                        saveDB();

                        await sock.sendMessage(jid, {
                            text: `⚠️ @${targetUser.split('@')[0]} ha recibido un aviso (${avisos}/3)\n\n📝 Razón: Aviso por reacción\n👮 Administrador: @${sender.split('@')[0]}\n\n⚡ 3 avisos = expulsión automática`,
                            mentions: [targetUser, sender]
                        });

                        if (avisos >= 3) {
                            await sock.groupParticipantsUpdate(jid, [targetUser], 'remove');
                            await sock.sendMessage(jid, {
                                text: `🚨 @${targetUser.split('@')[0]} ha sido expulsado por acumular 3 avisos.`,
                                mentions: [targetUser]
                            });
                            db.groups[jid].advertencias[targetUser] = [];
                            saveDB();
                        }
                        continue;
                    }

                    await sock.groupParticipantsUpdate(jid, [targetUser], 'remove');

                    await sock.sendMessage(jid, {
                        text: `👋 @${targetUser.split('@')[0]} ha sido expulsado por reacción de @${sender.split('@')[0]}.\n\n📍 Reacción: ${emoji}`,
                        mentions: [targetUser, sender]
                    });

                    logger.info('Kick por reacción ejecutado', {
                        target: targetUser,
                        reactor: sender,
                        reaction: emoji
                    });

                } catch (kickErr) {
                    logger.error('Error ejecutando kick por reacción', {
                        error: kickErr.message
                    });

                    await sock.sendMessage(jid, {
                        text: `❌ Error: No se pudo expulsar a @${targetUser.split('@')[0]}. Asegúrate de que Gonx!ta Bot sea administrador.`,
                        mentions: [targetUser]
                    });
                }

            } catch (msgErr) {
                logger.debug('Error obteniendo mensaje para reacción', {
                    error: msgErr.message
                });
            }

        } 

    } catch (err) {
        logger.error('Error en evento de reacción', {
            error: err.message
        });
    }
});

    

}
process.on('uncaughtException', (err) => {
    console.error('Se produjo un error no controlado:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.logCritical('Promesa no manejada', new Error(String(reason)));
});


startBot().catch(err => {
    logger.logCritical('Error fatal al iniciar bot', err);
    process.exit(1);
});


function shutdownBot(signal) {
    stoppingBot = true;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    logger.info('Bot detenido', { signal });
    try {
        activityStore.flush();
    } catch (error) {
        logger.error('No se pudo guardar la actividad antes de detener el bot', { error: error.message });
    }
    mediaHandler.cleanupAll();
    process.exit(0);
}

process.on('SIGINT', () => shutdownBot('SIGINT'));
process.on('SIGTERM', () => shutdownBot('SIGTERM'));