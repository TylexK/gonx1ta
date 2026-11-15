const { canUseCommand } = require('../../permissions');
const { categories: menuCommandCategories } = require('../categories');
const {
    createTextWhatsAppMenu,
    createTextWhatsAppSearch
} = require('../../whatsappMenu');

async function processCommands(context) {
    const {
        ADMIN_MODE_COMMANDS,
        GROUP_MODERATION_COMMANDS,
        OWNERS,
        activityStore,
        aiCommands,
        aiService,
        aiQuestion,
        createTemporaryMenuLink,
        sendWhatsAppMenu,
        sendWhatsAppMenuPanel,
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
    } = context;

    if (await expandedLocalCommands.handleExpandedLocalCommand({
        command,
        args,
        jid,
        sender,
        sock
    })) return;

if (command === '.setwelcome') {
    const { handleSetWelcomeCommand } = require('../admin/welcome');
    return await handleSetWelcomeCommand({
        jid,
        isGroupChat,
        isAdmin,
        message: m.message,
        messageText: getText(m.message),
        unwrapViewOnceMessage,
        downloadQuotedMedia,
        ensureGroupSettings,
        saveDBImmediate,
        imageDirectory: GROUP_WELCOME_IMAGE_DIR,
        sock,
        logger
    });
}

if (command === '.setgoodbye') {
    if (!isGroupChat) return await sock.sendMessage(jid, { text: '⚠️ Este comando solo funciona en grupos.' });
    if (!isAdmin) return await sock.sendMessage(jid, { text: '❌ Solo los administradores pueden configurar estos audios.' });

    const kind = 'goodbye';
    const quotedMessage = getMessageContextInfo(m.message)?.quotedMessage;
    if (!quotedMessage) {
        return await sock.sendMessage(jid, {
            text: `⚠️ Responde al audio que quieres guardar con ${command}. El audio debe pesar hasta 15 MB.`
        });
    }

    try {
        const audio = await downloadQuotedAudio(quotedMessage);
        if (!audio?.data.length) {
            return await sock.sendMessage(jid, { text: '❌ El mensaje citado no contiene un audio válido.' });
        }

        fs.mkdirSync(GROUP_AUDIO_DIR, { recursive: true });
        const safeGroupId = getGroupKey(jid).replace(/[^a-zA-Z0-9_-]/g, '_');
        const audioName = `${safeGroupId}-${kind}.bin`;
        const audioPath = path.join(GROUP_AUDIO_DIR, audioName);
        const temporaryPath = `${audioPath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(temporaryPath, audio.data);
        fs.renameSync(temporaryPath, audioPath);

        const settings = ensureGroupSettings(jid);
        settings[`${kind}Audio`] = audioName;
        settings[`${kind}AudioMime`] = audio.mimetype;
        settings[`${kind}AudioPtt`] = audio.ptt;
        settings[`${kind}Enabled`] = true;
        if (!saveDBImmediate()) {
            throw new Error('No se pudo guardar la configuración en la base de datos.');
        }

        const label = kind === 'welcome' ? 'bienvenida' : 'despedida';
        return await sock.sendMessage(jid, { text: `✅ Audio de ${label} guardado y activado.` });
    } catch (error) {
        logger.error(`Error configurando audio de ${kind}`, { jid, error: error.message });
        return await sock.sendMessage(jid, {
            text: error.message.includes('15 MB')
                ? `❌ ${error.message}`
                : '❌ No pude guardar ese audio. Comprueba que siga disponible e inténtalo otra vez.'
        });
    }
}

if (command === '.goodbye') {
    if (!isGroupChat) return await sock.sendMessage(jid, { text: '⚠️ Este comando solo funciona en grupos.' });
    if (!isAdmin) return await sock.sendMessage(jid, { text: '❌ Solo los administradores pueden activar o apagar el audio de despedida.' });

    const kind = 'goodbye';
    const enabled = args[0]?.toLowerCase();
    if (!['on', 'off'].includes(enabled)) {
        return await sock.sendMessage(jid, { text: 'Uso: .goodbye on|off (audio de despedida)' });
    }

    const settings = ensureGroupSettings(jid);
    if (enabled === 'on' && !settings[`${kind}Audio`]) {
        return await sock.sendMessage(jid, { text: '⚠️ Primero responde al audio con .setgoodbye para configurarlo.' });
    }

    settings[`${kind}Enabled`] = enabled === 'on';
    if (!saveDBImmediate()) {
        return await sock.sendMessage(jid, { text: '❌ No se pudo guardar la configuración. Inténtalo de nuevo.' });
    }

    return await sock.sendMessage(jid, {
        text: `✅ Audio de despedida ${enabled === 'on' ? 'activado' : 'apagado'} en este grupo.`
    });
}


if (command === '.ver') {
    const quotedMessage = getMessageContextInfo(m.message)?.quotedMessage;
    if (!quotedMessage) {
        return await sock.sendMessage(jid, { text: '⚠️ Responde a una imagen, video, audio o documento de ver una vez con .ver.' });
    }

    try {
        const media = await downloadQuotedMedia(quotedMessage);
        if (!media) {
            return await sock.sendMessage(jid, { text: '❌ El mensaje citado no contiene un archivo compatible.' });
        }

        const source = media.message;
        const caption = source.caption || undefined;
        let content;
        if (media.type === 'image') {
            content = { image: media.data, mimetype: source.mimetype, caption };
        } else if (media.type === 'video') {
            content = { video: media.data, mimetype: source.mimetype, caption };
        } else if (media.type === 'audio') {
            content = { audio: media.data, mimetype: source.mimetype, ptt: Boolean(source.ptt) };
        } else {
            content = {
                document: media.data,
                mimetype: source.mimetype,
                fileName: source.fileName || 'archivo'
            };
        }

        await sock.sendMessage(jid, content);
    } catch (error) {
        console.error('Error en .ver:', error.message || error);
        await sock.sendMessage(jid, { text: '❌ No pude descargar ese archivo. Puede haber caducado.' });
    }
    return;
}


if (command === '.limpiar') {
    if (!isAdmin) return await sock.sendMessage(jid, { text: '❌ Solo los administradores pueden usar este comando.' });

    try {
        const lineasVacias = Array(100).fill('\u00a0'.repeat(20)).join('\n');
        await sock.sendMessage(jid, { text: lineasVacias });
    } catch (err) {
        console.error('Error en .limpiar:', err);
        await sock.sendMessage(jid, { text: '❌ No se pudo limpiar el chat.' });
    }
    return;
}


if (command === '.id') {
    const mentionedJid = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    const argNumber = args[0] ? args[0].replace(/\D/g, '') : null;
    const targetJid = mentionedJid || (argNumber ? `${argNumber}@s.whatsapp.net` : sender);
    await sock.sendMessage(jid, { text: `${targetJid}` });
    return;
}


if (command === '.cmd') {
    if (!isGroupChat) return await sock.sendMessage(jid, { text: '⚠️ Este comando solo funciona en grupos.' });
    if (!isAdmin) return await sock.sendMessage(jid, { text: '❌ Solo administradores pueden cambiar comandos.' });

    const action = args[0]?.toLowerCase();
    const target = args[1]?.toLowerCase();

    if (!action || !['enable','disable','list'].includes(action)) {
        return await sock.sendMessage(jid, { text: 'Uso: .cmd <enable|disable|list> <comando>' });
    }

    if (action === 'list') {
        ensureGroupSettings(jid);
        const list = db.groups[jid].disabledCommands || [];
        return await sock.sendMessage(jid, { text: `Comandos deshabilitados: ${list.length? list.join(', '): 'ninguno'}` });
    }

    if (!target) return await sock.sendMessage(jid, { text: 'Especifica el comando, por ejemplo: .cmd disable .s' });

    if (action === 'disable') {
        setCommandDisabledInGroup(jid, target, true);
        return await sock.sendMessage(jid, { text: `✅ Comando ${target} deshabilitado en este grupo.` });
    }

    if (action === 'enable') {
        setCommandDisabledInGroup(jid, target, false);
        return await sock.sendMessage(jid, { text: `✅ Comando ${target} habilitado en este grupo.` });
    }
}

         if (command === '.inactivos') {
    if (!isAdmin) return await sock.sendMessage(jid, { text: '❌ Solo administradores pueden usar este comando.' });
    
    if (!jid.endsWith('@g.us')) {
        return sock.sendMessage(jid, { text: '❌ Solo en grupos' });
    }

    const metadata = await sock.groupMetadata(jid);
    const participants = metadata.participants;

    const actividad = activityStore.getAll();

    const ahora = Date.now();
    const LIMITE = 3 * 24 * 60 * 60 * 1000; 

    let text = '┏━━━━━━━━━━━━━━━━━━━━━━━━━┓\n┃ 🕐 *INACTIVOS - 3+ DÍAS* 🕐\n┗━━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n';
    let mentions = [];
    let count = 0;

    for (const p of participants) {
        const user = p.id;
        const userActividad = actividad[user];

        
        
        
        const esInactivo = !userActividad || (ahora - userActividad.lastMessage > LIMITE);

        if (esInactivo) {
            count++;
            mentions.push(user);

            if (!userActividad) {
                
                text += `│ 🆕 @${user.split('@')[0]} — Sin actividad\n`;
            } else {
                const dias = Math.floor((ahora - userActividad.lastMessage) / (1000 * 60 * 60 * 24));
                text += `│ ⏰ @${user.split('@')[0]} — ${dias} días\n`;
            }
        }
    }

    if (count === 0) {
        return sock.sendMessage(jid, { text: '✅ *¡Todos activos!*\n\nNadie tiene más de 3 días de inactividad.' });
    }

    text += `\n╰─ 👥 *Total inactivos:* ${count}\n\n> *Gonx!ta Bot Coded by Gonx!ta Bot 2026*`;

    await sock.sendMessage(jid, {
        text,
        mentions
    });
}

        if (command === '.kick' && args[0] === 'inactivos') {
            if (!jid.endsWith('@g.us')) {
                return sock.sendMessage(jid, { text: '❌ Solo en grupos' });
            }

            if (!isAdmin && !isOwner(sender)) {
                return await sock.sendMessage(jid, { text: '❌ Solo los admins pueden usar este comando.' });
            }

            const metadata = await sock.groupMetadata(jid);
            const participants = metadata.participants;

            const actividad = activityStore.getAll();

            const ahora = Date.now();
            const LIMITE = 3 * 24 * 60 * 60 * 1000; 

            let inactivos = [];
            let errors = [];

            for (const p of participants) {
                const user = p.id;
                const userActividad = actividad[user];

                
                const esInactivo = !userActividad || (ahora - userActividad.lastMessage > LIMITE);

                if (esInactivo && !isOwner(user)) {
                    inactivos.push(user);
                }
            }

            if (inactivos.length === 0) {
                return await sock.sendMessage(jid, { text: '✅ *No hay inactivos para expulsar*\n\nTodos están activos o protegidos.' });
            }

            let kicked = [];
            for (const user of inactivos) {
                try {
                    await sock.groupParticipantsUpdate(jid, [user], 'remove');
                    kicked.push(`@${user.split('@')[0]}`);
                } catch (e) {
                    errors.push(`❌ Error con @${user.split('@')[0]}`);
                }
            }

            let resp = `🚪 *INACTIVOS EXPULSADOS*\n\n${kicked.join(', ')}\n\n👥 *Total:* ${kicked.length} eliminados`;
            if (errors.length > 0) {
                resp += `\n\n${errors.join('\n')}`;
            }

            await sock.sendMessage(jid, {
                text: resp,
                mentions: kicked.map(k => `${k.replace('@', '')}@s.whatsapp.net`)
            });
        }

            if (command === '.voz') {
                try {
                    if (!verificarCooldownComando(sender, '.voz')) {
                        return await sock.sendMessage(jid, { text: '⏱️ Espera un poco antes de usar .voz de nuevo.' });
                    }

                    if (!isAdmin) {
                        return await sock.sendMessage(jid, { text: '❌ Solo los administradores pueden usar a Gonx!ta Bot para este comando.' });
                    }

                    if (!args.length) {
                        return await sock.sendMessage(jid, { text: '⚠️ Escribe el texto que quieres que lea el bot.\nEjemplo: *.voz Hola, soy Gonx!ta Bot.*' });
                    }

                    const texto = args.join(' ').slice(0, 300);
                    const url = googleTTS.getAudioUrl(texto, { lang: 'es', slow: false, host: 'https://translate.google.com' });

                    const https = require('https');
                    const fs = require('fs');
                    const path = require('path');
                    const tempMp3 = path.join('.', `voz_temp_${Date.now()}.mp3`);
                    const tempOgg = path.join('.', `voz_temp_${Date.now()}.ogg`);

                    await new Promise((res, rej) => {
                        const file = fs.createWriteStream(tempMp3);
                        const request = https.get(url, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36'
                            }
                        }, (response) => {
                            if (response.statusCode !== 200) {
                                file.close();
                                try { if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3); } catch (e) {}
                                return rej(new Error(`HTTP ${response.statusCode} descargando audio`));
                            }
                            response.pipe(file);
                            response.on('error', (err) => {
                                try { if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3); } catch (e) {}
                                rej(err);
                            });
                            file.on('finish', () => {
                                file.close();
                                res();
                            });
                        });
                        request.on('error', (err) => {
                            try { if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3); } catch (e) {}
                            rej(err);
                        });
                    });

                      
                    const ffmpegStatic = await ensureFfmpeg();
                    let sent = false;

                    if (ffmpegStatic) {
                        try {
                            const ffmpeg = require('fluent-ffmpeg');
                            ffmpeg.setFfmpegPath(ffmpegStatic);
                            await new Promise((res, rej) => {
                                ffmpeg(tempMp3)
                                    .audioCodec('libopus')
                                    .format('ogg')
                                    .audioBitrate('64k')
                                    .on('error', (err) => rej(err))
                                    .on('end', () => res())
                                    .save(tempOgg);
                            });

                            const oggBuf = fs.readFileSync(tempOgg);
                            await sock.sendMessage(jid, { audio: oggBuf, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                            sent = true;
                        } catch (convErr) {
                            console.error('Error convirtiendo a OGG/Opus:', convErr);
                            
                        }
                    }

                    if (!sent) {
                        
                        const mp3Buf = fs.readFileSync(tempMp3);
                        try {
                            await sock.sendMessage(jid, { audio: mp3Buf, mimetype: 'audio/mpeg', ptt: false });
                        } catch (sendErr) {
                            console.error('Error enviando MP3 backup:', sendErr);
                            await sock.sendMessage(jid, { text: '❌ No se pudo enviar el audio. Revisa los logs.' });
                        }
                    }

                    
                    try { if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3); } catch (e) {}
                    try { if (fs.existsSync(tempOgg)) fs.unlinkSync(tempOgg); } catch (e) {}

                } catch (e) {
                    console.error('Error en .voz:', e);
                    await sock.sendMessage(jid, { text: '❌ Ocurrió un error inesperado al procesar el comando.' });
                }
                return;
            }

            

            if (command === '.s') {
                let tempVideoPath = null;
                let tempStickerPath = null;
                try {
                    if (!isAdmin) {
                        return await sock.sendMessage(jid, { text: '❌ Solo los administradores pueden crear stickers.' });
                    }

                    const quotedMessage = getMessageContextInfo(m.message)?.quotedMessage;
                    const quotedContent = unwrapViewOnceMessage(quotedMessage);
                    const currentContent = unwrapViewOnceMessage(m.message);
                    const imageMessage = quotedContent?.imageMessage || currentContent?.imageMessage;
                    const videoMessage = quotedContent?.videoMessage || currentContent?.videoMessage;

                    if (!imageMessage && !videoMessage) {
                        return await sock.sendMessage(jid, { text: '⚠️ Responde a una imagen o video de menos de 5 segundos con *.s* o *.sticker*.' });
                    }

                    const mediaMessage = imageMessage || videoMessage;
                    const mediaType = imageMessage ? 'image' : 'video';
                    const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                    let mediaBuffer = Buffer.alloc(0);
                    for await (const chunk of stream) {
                        mediaBuffer = Buffer.concat([mediaBuffer, chunk]);
                    }

                    if (mediaBuffer.length > 10 * 1024 * 1024) {
                        return await sock.sendMessage(jid, { text: '⚠️ El archivo es muy grande (máximo 10MB).' });
                    }

                    let stickerBuffer;
                    if (videoMessage && !imageMessage) {
                        const ffmpegStatic = await ensureFfmpeg();
                        if (!ffmpegStatic) {
                            return await sock.sendMessage(jid, { text: '❌ FFmpeg no está disponible para crear stickers de video.' });
                        }

                        const timestamp = Date.now();
                        tempVideoPath = require('path').join(__dirname, `sticker_${timestamp}.mp4`);
                        tempStickerPath = require('path').join(__dirname, `sticker_${timestamp}.webp`);
                        fs.writeFileSync(tempVideoPath, mediaBuffer);

                        const duration = await new Promise((resolve) => {
                            const { exec } = require('child_process');
                            exec(`"${ffmpegStatic}" -i "${tempVideoPath}"`, { shell: true, timeout: 30000 }, (err, stdout, stderr) => {
                                const match = String(stderr).match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
                                resolve(match ? (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]) : null);
                            });
                        });

                        if (duration === null) {
                            return await sock.sendMessage(jid, { text: '❌ No se pudo leer la duración del video.' });
                        }
                        if (duration >= 5) {
                            return await sock.sendMessage(jid, { text: '⚠️ El video debe durar menos de 5 segundos.' });
                        }

                        const ffmpeg = require('fluent-ffmpeg');
                        ffmpeg.setFfmpegPath(ffmpegStatic);
                        await new Promise((resolve, reject) => {
                            ffmpeg(tempVideoPath)
                                .videoCodec('libwebp')
                                .outputOptions(['-loop', '0', '-an', '-fps_mode', 'passthrough'])
                                .videoFilters('scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=15')
                                .toFormat('webp')
                                .on('error', reject)
                                .on('end', resolve)
                                .save(tempStickerPath);
                        });
                        stickerBuffer = fs.readFileSync(tempStickerPath);
                    } else {
                        if (!sharpAvailable) {
                            return await sock.sendMessage(jid, { text: '❌ La función de stickers no está disponible. Contacta al admin.' });
                        }
                        stickerBuffer = await sharp(mediaBuffer)
                            .resize(512, 512, {
                                fit: 'contain',
                                background: { r: 0, g: 0, b: 0, alpha: 0 }
                            })
                            .webp({ quality: 80 })
                            .toBuffer();
                    }

                    await sock.sendMessage(jid, {
                        sticker: stickerBuffer,
                        pack: 'Gonx!ta Bot',
                        author: `Creado por ${m.pushName || db.users[sender]?.nombre || sender.split('@')[0]}`
                    }, { quoted: m });
                    logger.info('Sticker creado exitosamente', { user: sender, type: videoMessage ? 'video' : 'image' });
                } catch (e) {
                    logger.error('Error general en .s', { error: e.message });
                    await sock.sendMessage(jid, { text: '❌ Ocurrió un error al crear el sticker.' });
                } finally {
                    if (tempVideoPath && fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
                    if (tempStickerPath && fs.existsSync(tempStickerPath)) fs.unlinkSync(tempStickerPath);
                }
                return;
            }

            if (command === '.brat' || command === '.bratv') {
                let tempDir = null;
                let stickerStage = 'validating';
                try {
                    if (!isAdmin && !isOwner(sender)) {
                        return await sock.sendMessage(jid, { text: '❌ Solo los administradores pueden crear stickers.' });
                    }

                    if (!sharpAvailable) {
                        return await sock.sendMessage(jid, { text: '❌ La función de stickers no está disponible. Contacta al admin.' });
                    }

                    const bratText = args.join(' ').trim();
                    if (!bratText) {
                        return await sock.sendMessage(jid, {
                            text: command === '.bratv'
                                ? '⚠️ Uso: .bratv texto del sticker animado'
                                : '⚠️ Uso: .brat texto del sticker'
                        });
                    }

                    let layout;
                    try {
                        layout = bratCommands.createBratLayout(bratText);
                    } catch (error) {
                        if (error instanceof RangeError) {
                            return await sock.sendMessage(jid, { text: `⚠️ ${error.message}` });
                        }
                        throw error;
                    }
                    const { lines } = layout;
                    const svgText = bratCommands.renderBratText(layout);

                    let stickerBuffer;
                    stickerStage = command === '.bratv' ? 'rendering-animation' : 'rendering-static';
                    if (command === '.bratv') {
                        const ffmpegStatic = await ensureFfmpeg();
                        if (!ffmpegStatic) {
                            return await sock.sendMessage(jid, { text: '❌ FFmpeg no está disponible para crear stickers animados.' });
                        }

                        const path = require('path');
                        const os = require('os');
                        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kenny-bratv-'));
                        const framePath = (index) => path.join(tempDir, `frame_${String(index).padStart(4, '0')}.png`);
                        const imageSvg = (frameContent) => bratCommands.renderBratSvg(layout, frameContent);
                        const wordCount = lines.reduce((total, line) => total + line.split(' ').length, 0);
                        let frameIndex = 0;

                        for (let activeWordIndex = 0; activeWordIndex < wordCount; activeWordIndex++) {
                            const frameText = bratCommands.renderBratProgress(layout, activeWordIndex);
                            const frameBuffer = await sharp(Buffer.from(imageSvg(frameText))).png().toBuffer();
                            fs.writeFileSync(framePath(frameIndex++), frameBuffer);
                        }

                        for (let holdFrame = 0; holdFrame < 4; holdFrame++) {
                            const finalSvg = imageSvg(svgText);
                            const frameBuffer = await sharp(Buffer.from(finalSvg)).png().toBuffer();
                            fs.writeFileSync(framePath(frameIndex++), frameBuffer);
                        }

                        const tempStickerPath = path.join(tempDir, 'bratv.webp');
                        ffmpeg.setFfmpegPath(ffmpegStatic);
                        await new Promise((resolve, reject) => {
                            ffmpeg(path.join(tempDir, 'frame_%04d.png'))
                                .inputOptions(['-framerate', '4'])
                                .videoCodec('libwebp')
                                .outputOptions(['-loop', '0', '-an', '-fps_mode', 'passthrough', '-q:v', '60', '-compression_level', '6'])
                                .toFormat('webp')
                                .on('error', reject)
                                .on('end', resolve)
                                .save(tempStickerPath);
                        });
                        stickerBuffer = fs.readFileSync(tempStickerPath);
                    } else {
                        const svg = bratCommands.renderBratSvg(layout, svgText);
                        stickerBuffer = await sharp(Buffer.from(svg))
                            .webp({ quality: 90 })
                            .toBuffer();
                    }

                    stickerStage = 'sending';
                    await sock.sendMessage(jid, {
                        sticker: stickerBuffer,
                        pack: 'Gonx!ta Bot',
                        author: bratText.slice(0, 32)
                    }, { quoted: m });
                    logger.info('Sticker brat creado exitosamente', { user: sender, animated: command === '.bratv' });
                } catch (e) {
                    logger.error({ err: e, command, stage: stickerStage }, `Error general en ${command}`);
                    await sock.sendMessage(jid, {
                        text: command === '.bratv'
                            ? '❌ Ocurrió un error al crear el sticker animado.'
                            : '❌ Ocurrió un error al crear el sticker de texto.'
                    });
                } finally {
                    if (tempDir && fs.existsSync(tempDir)) {
                        try {
                            fs.rmSync(tempDir, { recursive: true, force: true });
                        } catch (cleanupError) {
                            logger.warn('No se pudieron eliminar los archivos temporales de .bratv.', {
                                error: cleanupError.message,
                                path: tempDir
                            });
                        }
                    }
                }
                return;
            }

            if (command === '.reglas') {
                const reglas = `📋 *REGLAS DE Gonx!ta Bot* 📋

╭─〔 ⚖️ NORMAS GENERALES 〕
│ 1️⃣ Respeto y cordialidad.
│ 2️⃣ Sin spam ni floods.
│ 3️⃣ Nada de contenido inapropiado.
│ 4️⃣ Prohibido compartir datos privados.
│ 5️⃣ Usa solo comandos autorizados.
│ 6️⃣ Mantén el chat limpio y activo.
╰───────────────

╭─〔 🎮 NORMAS DE JUEGO 〕
│ 7️⃣ No estafes ni robes a otros.
│ 8️⃣ Respeta a admins y moderación.
│ 9️⃣ Participa en eventos y retos.
│ 🔟 Mantén actividad para seguir en el clan.
╰───────────────

> *Quien incumpla las reglas puede recibir advertencia o expulsión.*
> *¡Disfruta de la experiencia Gonx!ta Bot!* ⚡`;

                await sock.sendMessage(jid, { text: reglas });
                return;
            }

            if (command === '.tiktok') {
                const tiktokUrl = args[0]?.trim();
                if (!tiktokUrl) {
                    return await sock.sendMessage(jid, { text: '⚠️ Usa: .tiktok https://www.tiktok.com/@usuario/video/123456789' });
                }

                const result = await queueTask(() => downloadAndSendTikTok(sock, jid, tiktokUrl, m));
                if (result?.error === 'INVALID_URL') {
                    return await sock.sendMessage(jid, { text: '⚠️ Envía un enlace válido de TikTok.' });
                }
                if (result?.error === 'NO_YTDLP') {
                    return await sock.sendMessage(jid, { text: '❌ No se encontró yt-dlp. Instálalo para usar .tiktok.' });
                }
                if (result?.error === 'BIG') {
                    return await sock.sendMessage(jid, { text: '❌ El video supera el límite de 100 MB.' });
                }
                if (result?.error) {
                    const detail = result.details ? `\n\n_${result.details.slice(-500)}_` : '';
                    return await sock.sendMessage(jid, { text: `❌ No se pudo descargar el video de TikTok.${detail}` });
                }
                return;
            }

            if (command === '.ig') {
                const instagramUrl = args[0]?.trim();
                if (!instagramUrl) {
                    return await sock.sendMessage(jid, { text: '⚠️ Usa: .ig https://www.instagram.com/reel/ABC123/' });
                }

                const result = await queueTask(() => downloadAndSendInstagram(sock, jid, instagramUrl, m));
                if (result?.error === 'INVALID_URL') {
                    return await sock.sendMessage(jid, { text: '⚠️ Envía un enlace válido de Instagram.' });
                }
                if (result?.error === 'NO_YTDLP') {
                    return await sock.sendMessage(jid, { text: '❌ No se encontró yt-dlp. Instálalo para usar .ig.' });
                }
                if (result?.error === 'BIG') {
                    return await sock.sendMessage(jid, { text: '❌ El video supera el límite de 100 MB.' });
                }
                if (result?.error) {
                    return await sock.sendMessage(jid, { text: '❌ No se pudo descargar el video de Instagram. Verifica que sea público.' });
                }
                return;
            }

            if (command === '.gif') {
                const query = args.join(' ').trim();
                if (!query) {
                    return await sock.sendMessage(jid, { text: '⚠️ Uso: .gif <búsqueda>\nEjemplo: .gif feliz' });
                }

                const result = await queueTask(() => searchAndSendGif(sock, jid, query, m));
                if (result?.error === 'NO_API_KEY') {
                    return await sock.sendMessage(jid, { text: '❌ Falta configurar GIPHY_API_KEY en el archivo .env.' });
                }
                if (result?.error === 'NOT_FOUND') {
                    return await sock.sendMessage(jid, { text: `🔎 No encontré GIFs para: ${query}` });
                }
                if (result?.error === 'BIG') {
                    return await sock.sendMessage(jid, { text: '❌ El GIF supera el límite de 100 MB.' });
                }
                if (result?.error) {
                    logger.warn('No se pudo obtener GIF de GIPHY', { error: result.details || result.error });
                    return await sock.sendMessage(jid, { text: '❌ No se pudo obtener el GIF. Intenta nuevamente.' });
                }
                return;
            }

            const genericDownloadCommands = new Set([
                '.facebook', '.fb', '.mediafire', '.mf', '.pinterest',
                '.twitter', '.x', '.drive', '.gdrive', '.aptoide', '.apk', '.apkdl',
                '.play2', '.mp4', '.playvideo', '.ytvideo', '.ytmp4',
                '.ytsearch', '.search', '.ys', '.imagen', '.img', '.image'
            ]);
            if (genericDownloadCommands.has(command) || (command === '.pin' && args.length > 0)) {
                const source = args.join(' ').trim();
                if (!source) {
                    return await sock.sendMessage(jid, {
                        text: `⚠️ Uso: ${command} <enlace o búsqueda>\nEjemplo: ${command} https://ejemplo.com/archivo`
                    });
                }

                const result = await queueTask(() => downloadAndSendGenericMedia(
                    sock,
                    jid,
                    source,
                    m,
                    command === '.imagen' || command === '.img' || command === '.image'
                        ? '🖼️ Imagen encontrada'
                        : '📥 Descarga completada'
                ));
                if (result?.error === 'NO_YTDLP') {
                    return await sock.sendMessage(jid, { text: '❌ No se encontró yt-dlp. Instálalo para usar este comando.' });
                }
                if (result?.error === 'INVALID_URL') {
                    return await sock.sendMessage(jid, { text: '⚠️ Envía un enlace válido o una búsqueda.' });
                }
                if (result?.error === 'BIG') {
                    return await sock.sendMessage(jid, { text: '❌ El archivo supera el límite de 100 MB.' });
                }
                if (result?.error) {
                    const detail = result.details ? `\n\n_${result.details.slice(-500)}_` : '';
                    return await sock.sendMessage(jid, { text: `❌ No se pudo completar ${command}.${detail}` });
                }
                return;
            }

            if (command === '.musica') {
                const quotedMessage = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                const song = args.join(' ').trim() || getText(quotedMessage).trim();
                if (!song) {
                    return await sock.sendMessage(jid, { text: '⚠️ Escribe una canción o responde a un mensaje con .musica o .play.\nEjemplo: .play Bad Bunny - Tití Me Preguntó' });
                }

                const result = await queueTask(() => downloadAndSendAudio(sock, jid, song, null, m));
                if (result?.error) {
                    let message = '❌ No se pudo descargar la canción.';
                    if (result.error === 'NOFILE') message = '❌ No se encontró ningún archivo de audio después de la descarga.';
                    if (result.error === 'BIG') message = '❌ El archivo resultante supera los 100 MB, prueba con otra canción o usa un enlace más corto.';
                    if (result.error === 'SEND') message = `❌ Error al enviar el audio: ${result.details || 'ver logs'}`;
                    if (result.error === 'NO_YTDLP') message = '❌ No se encontró yt-dlp. Instala yt-dlp o python con yt_dlp para usar este comando.';
                    if (result.error === 'NO_FFMPEG') message = '❌ No se encontró ffmpeg. Instala FFmpeg o agrega su ubicación al PATH.';
                    return await sock.sendMessage(jid, { text: message });
                }
                return;
            }

            if (command === '.playlist') {
                db.playlists = db.playlists || {};
                if (!db.playlists[jid]) db.playlists[jid] = [];

                if (args[0] === 'add') {
                    const song = args.slice(1).join(' ').trim();
                    if (!song) {
                        return await sock.sendMessage(jid, { text: '⚠️ Uso: .playlist add [nombre o link]' });
                    }
                    db.playlists[jid].push({ song, addedBy: sender, addedAt: Date.now() });
                    saveDB();
                    return await sock.sendMessage(jid, { text: `✅ Canción agregada a la playlist:\n• ${song}` });
                }

                if (args[0] === 'clear') {
                    if (!isAdmin) return await sock.sendMessage(jid, { text: '❌ Solo admins pueden limpiar la playlist.' });
                    db.playlists[jid] = [];
                    saveDB();
                    return await sock.sendMessage(jid, { text: '✅ Playlist del grupo limpiada.' });
                }

                if (args[0] === 'play' || args[0] === 'reproducir') {
                    const playlist = db.playlists[jid] || [];
                    if (!playlist.length) {
                        return await sock.sendMessage(jid, { text: '🎵 La playlist del grupo está vacía. Usa .playlist add [nombre o link] para agregar canciones.' });
                    }
                    const index = parseInt(args[1], 10);
                    const trackIndex = Number.isInteger(index) && index > 0 ? index - 1 : 0;
                    if (trackIndex < 0 || trackIndex >= playlist.length) {
                        return await sock.sendMessage(jid, { text: `⚠️ Número inválido. Usa .playlist play [número] entre 1 y ${playlist.length}.` });
                    }
                    const songItem = playlist[trackIndex];
                    await sock.sendMessage(jid, { text: `🎧 Reproduciendo canción #${trackIndex + 1}: ${songItem.song}` });
                    const result = await queueTask(() => downloadAndSendAudio(sock, jid, songItem.song, '🔎 Buscando tu música...', m));
                    if (result?.error) {
                        const reason = result.error === 'NOFILE' ? 'No se encontró el audio.'
                            : result.error === 'BIG' ? 'El archivo resultante es mayor a 100MB.'
                            : 'No se pudo descargar o enviar el audio.';
                        return await sock.sendMessage(jid, { text: `❌ ${reason}` });
                    }
                    return;
                }

                const playlist = db.playlists[jid] || [];
                if (!playlist.length) {
                    return await sock.sendMessage(jid, { text: '🎵 La playlist del grupo está vacía. Usa .playlist add [nombre o link] para agregar canciones.' });
                }

                const listText = playlist.map((item, index) => `${index + 1}. ${item.song} - @${item.addedBy.split('@')[0]}`).join('\n');
                const mentions = [...new Set(playlist.map((item) => item.addedBy))];
                await sock.sendMessage(jid, {
                    text: `🎶 *Playlist del grupo* (${playlist.length} canciones):\n\n${listText}\n\n📌 Usa .playlist play [número] para reproducir una canción.`,
                    mentions
                });
                return;
            }

            if (command === '.placas') {
                if (!isAdmin) return await sock.sendMessage(jid, { text: '❌ Solo administradores pueden usar este comando.' });
                
                db.placas = db.placas || {};
                if (!db.placas[jid]) db.placas[jid] = {};

                if (args[0] === 'add') {
                    const mentionedJid = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    const targetJid = mentionedJid || (args[1] ? args[1].replace(/\D/g, '') + '@s.whatsapp.net' : null);
                    const countArg = mentionedJid ? args.slice(2).join(' ').trim() : args.slice(2).join(' ').trim();
                    const placasCount = Number(countArg);

                    if (!targetJid || !countArg || Number.isNaN(placasCount) || placasCount <= 0 || placasCount > 10000) {
                        return await sock.sendMessage(jid, { text: '⚠️ Uso: .placas add @usuario [cantidad 1-10000]\nEjemplo: .placas add @user 10' });
                    }

                    const existing = db.placas[jid][targetJid] || { placas: 0, addedBy: sender, updatedAt: Date.now() };
                    existing.placas += placasCount;
                    existing.addedBy = sender;
                    existing.updatedAt = Date.now();
                    db.placas[jid][targetJid] = existing;
                    saveDB();

                    logger.info('Placas añadidas', { user: targetJid, count: placasCount, addedBy: sender });
                    return await sock.sendMessage(jid, {
                        text: `✅ Se registraron ${placasCount} placas para @${targetJid.split('@')[0]}\nTotal actual: ${existing.placas} placas.`,
                        mentions: [targetJid]
                    });
                }

                if (args[0] === 'clean') {
                    if (!isAdmin) return await sock.sendMessage(jid, { text: '❌ Solo admins pueden limpiar placas de usuarios.' });
                    const mentionedJid = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    const targetJid = mentionedJid || (args[1] ? args[1].replace(/\D/g, '') + '@s.whatsapp.net' : null);
                    if (!targetJid || !db.placas[jid]?.[targetJid]) {
                        return await sock.sendMessage(jid, { text: '⚠️ Debes mencionar a un usuario que tenga placas registradas.\nEjemplo: .placas clean @usuario' });
                    }
                    delete db.placas[jid][targetJid];
                    saveDB();
                    return await sock.sendMessage(jid, {
                        text: `✅ Placas eliminadas para @${targetJid.split('@')[0]}.`,
                        mentions: [targetJid]
                    });
                }

                if (args[0] === 'list') {
                    const placasData = db.placas[jid] || {};
                    const entries = Object.entries(placasData);
                    if (!entries.length) {
                        return await sock.sendMessage(jid, { text: '📋 No hay registros de placas en este grupo. Usa .placas add @usuario [cantidad].' });
                    }

                    const listText = entries.map(([userJid, data], index) => `${index + 1}. @${userJid.split('@')[0]} — ${data.placas} placas`).join('\n');
                    const mentions = entries.map(([userJid]) => userJid);
                    return await sock.sendMessage(jid, {
                        text: `📋 *Registro de placas del grupo* (${entries.length} usuarios):\n\n${listText}`,
                        mentions
                    });
                }

                return await sock.sendMessage(jid, {
                    text: '📌 Comandos de placas:\n.placas add @usuario [cantidad]\n.placas clean @usuario\n.placas list',
                });
            }

            
            if (command === '.n') {
                if (!isAdmin) return await sock.sendMessage(jid, { text: '❌ Solo administradores pueden usar este comando.' });
                
                try {
                    if (!isGroupChat) {
                        return await sock.sendMessage(jid, { text: '❌ Este comando solo funciona en grupos.' });
                    }

                    const quotedMessage = getMessageContextInfo(m.message)?.quotedMessage;
                    const quotedContent = unwrapViewOnceMessage(quotedMessage);
                    const currentContent = unwrapViewOnceMessage(m.message);
                    const pollPayload = getPollPayload(quotedContent);
                    const imageSource = quotedContent?.imageMessage ? quotedMessage : currentContent?.imageMessage ? m.message : null;
                    const originalText = quotedMessage ? getText(quotedMessage) : args.join(' ').trim();
                    const output = originalText || '';

                    const mentions = participants.map(participant => participant.id);
                    if (pollPayload) {
                        await sock.sendMessage(jid, { poll: pollPayload }, { quoted: m });
                        if (mentions.length) {
                            await sock.sendMessage(jid, {
                                text: '📊 Encuesta para todos:',
                                mentions
                            }, { quoted: m });
                        }
                    } else if (imageSource) {
                        const media = await downloadQuotedMedia(imageSource);
                        if (!media?.data.length) {
                            return await sock.sendMessage(jid, { text: '❌ No se pudo descargar la imagen.' });
                        }
                        if (media.type !== 'image') {
                            return await sock.sendMessage(jid, { text: '⚠️ Responde a una imagen para reenviarla con .n.' });
                        }
                        if (media.data.length > 10 * 1024 * 1024) {
                            return await sock.sendMessage(jid, { text: '⚠️ La imagen es demasiado grande (máximo 10 MB).' });
                        }

                        const caption = args.length ? args.join(' ').trim() : (quotedMessage ? getText(quotedMessage) : '');
                        await sock.sendMessage(jid, {
                            image: media.data,
                            ...(caption ? { caption } : {}),
                            mentions
                        }, { quoted: m });
                    } else {
                        await sock.sendMessage(jid, { text: output, mentions }, { quoted: m });
                    }
                } catch (err) {
                    console.error('Error ejecutando .n:', err);
                    await sock.sendMessage(jid, { text: '❌ Ocurrió un error al ejecutar .n' });
                }
                return;
            }

            
            if (command === '.prender' || command === '.apagar') {
                if (!isOwner(sender)) {
                    return await sock.sendMessage(jid, { text: '❌ Solo los owners pueden usar este comando.' });
                }

                const targetGroup = isGroupChat ? jid : (m.key.remoteJid || jid);
                if (command === '.prender') {
                    if (!setBotActiveInGroup(targetGroup, true)) {
                        return await sock.sendMessage(jid, { text: '❌ No se pudo guardar el estado del bot en este grupo.' });
                    }
                    return await sock.sendMessage(jid, { text: '✅ *Bot PRENDIDO en este grupo*\n\nGonx!ta Bot queda activo solo en este chat.' });
                }

                if (!setBotActiveInGroup(targetGroup, false)) {
                    return await sock.sendMessage(jid, { text: '❌ No se pudo guardar el estado del bot en este grupo.' });
                }
                return await sock.sendMessage(jid, { text: '🔴 *Bot APAGADO en este grupo*\n\nGonx!ta Bot no responderá aquí. Usa .prender para reactivarlo.' });
            }

            
            if (command === '.unirse') {
                if (!isOwner(sender)) {
                    return await sock.sendMessage(jid, { text: '❌ Solo los owners pueden usar este comando.' });
                }

                const inviteInput = args.join(' ').trim();
                if (!inviteInput) {
                    return await sock.sendMessage(jid, { text: '⚠️ Uso: .unirse https://chat.whatsapp.com/ABC123' });
                }

                let inviteCode = inviteInput;
                const match = inviteInput.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
                if (match) {
                    inviteCode = match[1];
                }

                try {
                    await sock.groupAcceptInvite(inviteCode);
                    return await sock.sendMessage(jid, { text: '✅ Invitación aceptada. El bot intentará unirse al grupo o comunidad.' });
                } catch (err) {
                    console.error('Error al unirse por invitación:', err);
                    return await sock.sendMessage(jid, { text: '❌ No pude aceptar la invitación. Verifica que el enlace sea válido.' });
                }
            }

            
            if (command === '.myid') {
                return await sock.sendMessage(jid, { text: `📱 *Tu ID:*\n\`${sender}\`\n\nCopia este número y añádelo a la lista OWNERS en el código si quieres que sea owner.` });
            }

            if (command === '.misgrupos') {
                await syncCurrentGroups(sock);
                const registeredGroups = Object.entries(db.groups)
                    .filter(([groupJid]) => groupJid.endsWith('@g.us'))
                    .map(([groupJid, groupData]) => ({
                        jid: groupJid,
                        name: groupData?.name || groupData?.nombre || groupJid
                    }))
                    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

                if (!registeredGroups.length) {
                    return await sock.sendMessage(jid, { text: '📋 No hay grupos registrados actualmente.' });
                }

                const groupList = registeredGroups
                    .map((group, index) => `${index + 1}. *${group.name}*\n   ID: \`${group.jid}\``)
                    .join('\n');
                return await sock.sendMessage(jid, {
                    text: `📋 *Grupos registrados para este bot* (${registeredGroups.length})\n\n${groupList}`
                });
            }

            if (command === '.creador') {
                return await sock.sendMessage(jid, {
                    contacts: {
                        displayName: 'Creador de Gonx!ta Bot',
                        contacts: [{
                            vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Creador de Gonx!ta Bot\nORG:Gonx!ta Bot\nTEL;type=CELL;type=VOICE;waid=66966893079:+66 966893079\nTEL;type=CELL;type=VOICE;waid=50672186538:+506 72186538\nEND:VCARD`
                        }]
                    }
                });
            }

            if (command === '.soporte') {
                await sock.sendMessage(jid, {
                    contacts: {
                        displayName: 'Soporte Costa Rica',
                        contacts: [{
                            vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Soporte Costa Rica\nORG:Gonx!ta Bot\nTEL;type=CELL;type=VOICE;waid=50672186538:+506 72186538\nEND:VCARD`
                        }]
                    }
                });
                return await sock.sendMessage(jid, {
                    contacts: {
                        displayName: 'Soporte Tailandia',
                        contacts: [{
                            vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Soporte Tailandia\nORG:Gonx!ta Bot\nTEL;type=CELL;type=VOICE;waid=66966893079:+66 966893079\nEND:VCARD`
                        }]
                    }
                });
            }

            if (command === '.vendedor') {
                await sock.sendMessage(jid, {
                    contacts: {
                        displayName: 'Vendedor Costa Rica',
                        contacts: [{
                            vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Vendedor Costa Rica\nORG:Gonx!ta Bot\nTEL;type=CELL;type=VOICE;waid=50672186538:+506 72186538\nEND:VCARD`
                        }]
                    }
                });
                return await sock.sendMessage(jid, {
                    contacts: {
                        displayName: 'Vendedor Tailandia',
                        contacts: [{
                            vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Vendedor Tailandia\nORG:Gonx!ta Bot\nTEL;type=CELL;type=VOICE;waid=66966893079:+66 966893079\nEND:VCARD`
                        }]
                    }
                });
            }


            if (command === '.promocion') {
                const promocion = `🚀 *Gonx!ta Bot*

Potencia tu grupo con un bot completo, profesional y lleno de funciones.

✅ Más de *100 comandos*
✅ Administración avanzada
✅ Juegos y entretenimiento
✅ Sistema de economía y monedas
✅ Niveles, XP y logros
✅ Clanes, rankings y competencias
✅ Música, stickers y audios
✅ Herramientas para grupos
✅ Sistema premium
✅ Comandos exclusivos para administradores

> Todo lo que necesitas para organizar y hacer crecer tu comunidad en un solo bot.

📩 *Si quieres adquirirlo, escríbeme:*`;

                const promotionMentions = [...new Set(
                    participants
                        .map(participant => participant.id || participant.lid || participant.phoneNumber)
                        .filter(Boolean)
                )];
                await sock.sendMessage(jid, {
                    text: promocion,
                    mentions: promotionMentions
                });
                return await sock.sendMessage(jid, {
                    contacts: {
                        displayName: 'Creador de Gonx!ta Bot',
                        contacts: [{
                            vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Creador de Gonx!ta Bot\nORG:Gonx!ta Bot\nTEL;type=CELL;type=VOICE;waid=66966893079:+66 966893079\nTEL;type=CELL;type=VOICE;waid=50672186538:+506 72186538\nEND:VCARD'
                        }]
                    }
                });
            }

            if (command === '.ping') {
                const pingStart = Date.now();
                const sentMessage = await sock.sendMessage(jid, { text: '🏓 Midiendo ping...' });
                const latency = Date.now() - pingStart;
                await sock.sendMessage(jid, {
                    text: `🏓 *PONG*\n⚡ Latencia: *${latency} ms*`,
                    edit: sentMessage.key
                });
                return;
            }

            if (command === '.estado') {
                const formatDuration = (milliseconds) => {
                    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
                    const days = Math.floor(totalSeconds / 86400);
                    const hours = Math.floor((totalSeconds % 86400) / 3600);
                    const minutes = Math.floor((totalSeconds % 3600) / 60);
                    const seconds = totalSeconds % 60;
                    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
                };
                const memory = process.memoryUsage();
                const connectionLabel = {
                    open: '✅ Conectado',
                    connecting: '🔄 Conectando',
                    close: '❌ Desconectado'
                }[whatsappConnection] || `⚠️ ${whatsappConnection}`;
                return await sock.sendMessage(jid, {
                    text: `📊 *ESTADO DE GONX!TA BOT*\n\n` +
                        `📡 Conexión: ${connectionLabel}\n` +
                        `⏱️ Activo: ${formatDuration(Date.now() - botStartedAt)}\n` +
                        `🧠 Memoria: ${(memory.rss / 1024 / 1024).toFixed(1)} MB RSS\n` +
                        `📥 Tareas: ${activeTasks} activas / ${taskQueue.length} pendientes\n` +
                        `🔁 Reintentos: ${reconnectAttempt}`
                });
            }

            if (command === '.modoadmin') {
                if (!isGroupChat) {
                    return await sock.sendMessage(jid, { text: '⚠️ Este comando solo funciona en grupos.' });
                }

                if (!isAdmin) {
                    return await sock.sendMessage(jid, { text: '❌ Solo administradores pueden cambiar el modo admin.' });
                }

                const mode = args[0]?.toLowerCase();
                if (!['on', 'off'].includes(mode)) {
                    return await sock.sendMessage(jid, { text: `⚠️ Uso: .modoadmin on|off\nEstado actual: ${ensureGroupSettings(jid).modoadmin === false ? 'off' : 'on'}` });
                }

                ensureGroupSettings(jid).modoadmin = mode === 'on';
                saveDB();
                return await sock.sendMessage(jid, {
                    text: `✅ Modo admin ${mode === 'on' ? 'activado' : 'desactivado'}.\n${mode === 'on' ? 'Solo los administradores pueden usar los comandos.' : 'Los usuarios también pueden usar los comandos permitidos.'}`
                });
            }

            if (!canUseCommand(command, isAdmin)) {
                return await sock.sendMessage(jid, { text: '❌ Este comando está reservado para administradores.' });
            }

            if (commandCategory === 'utility' && await aiCommands.handleAiCommand({
                command,
                jid,
                sender,
                isGroupChat,
                question: aiQuestion,
                sock,
                aiService,
                logger
            })) return;

            if (command === '.sc') {
                if (!isGroupChat) {
                    return await sock.sendMessage(jid, {
                        text: '❌ Este comando solo funciona en grupos.'
                    });
                }

                return await sock.sendMessage(jid, {
                    text: '❌ No se puede iniciar una videollamada grupal desde este bot. La versión actual de Baileys no ofrece una API para crear llamadas; solo permite rechazar llamadas entrantes.'
                });
            }

            if (isGroupChat && !isAdmin && db.groups[jid].modoadmin === false && GROUP_MODERATION_COMMANDS.has(command)) {
                return await sock.sendMessage(jid, { text: '❌ Este comando está reservado para administradores.' });
            }

            if (isGroupChat && !isAdmin && db.groups[jid].modoadmin !== false && ADMIN_MODE_COMMANDS.has(command)) {
                return await sock.sendMessage(jid, { text: '❌ .musica y .ping solo están disponibles para administradores cuando el modo admin está activado.' });
            }
            
            if (isGroupChat && !isAdmin && db.groups[jid].modoadmin !== false && !['.top', '.menu', '.doom', '.bot', '.wm', '.qr', '.afk'].includes(command)) return;

            if (command === '.afk') {
                if (!isGroupChat) {
                    return await sock.sendMessage(jid, {
                        text: '❌ Este comando solo funciona en grupos.'
                    });
                }

                const groupSettings = ensureGroupSettings(jid);
                const afkDetails = getAfkDetails(groupSettings.afk[sender]);
                if (afkDetails) {
                    delete groupSettings.afk[sender];
                    saveDB();
                    return await sock.sendMessage(jid, {
                        text: `✅ @${sender.split('@')[0]} ha salido de AFK después de ${formatAfkDuration(Date.now() - afkDetails.startedAt)}.\nMenciones durante su ausencia: ${afkDetails.mentions || 0}.`,
                        mentions: [sender]
                    });
                }

                const reason = args.slice(0).join(' ').trim().slice(0, 200);
                groupSettings.afk[sender] = {
                    startedAt: Date.now(),
                    reason,
                    mentions: 0
                };
                saveDB();
                return await sock.sendMessage(jid, {
                    text: `💤 @${sender.split('@')[0]} está AFK${reason ? `: ${reason}` : ''}. El modo se desactivará cuando vuelva a escribir en este grupo.`,
                    mentions: [sender]
                });
            }

            if (command === '.menu') {
                try {
                    if (args[0]?.toLowerCase() === 'web') {
                        const menuLink = await createTemporaryMenuLink();
                        const expirationText = menuLink.expiresAt
                            ? `\n\n⏳ Este enlace funciona hasta las ${new Date(menuLink.expiresAt).toLocaleTimeString('es', {
                                hour: '2-digit',
                                minute: '2-digit'
                            })}.`
                            : '\n\n🌐 Menú público interactivo de Gonx!ta Bot.';
                        return await sock.sendMessage(jid, {
                            text: `✨ *MENÚ INTERACTIVO*\n\nBusca comandos, explora las categorías y toca cualquiera para ver sus detalles:\n\n${menuLink.url}${expirationText}`
                        });
                    }

                    if (args[0]?.toLowerCase() === 'buscar') {
                        const query = args.slice(1).join(' ').trim();
                        return await sock.sendMessage(jid, {
                            text: createTextWhatsAppSearch(menuCommandCategories, query)
                        });
                    }

                    const menuLink = await createTemporaryMenuLink();
                    const expirationText = menuLink.expiresAt
                        ? `\n\n⏳ Este enlace funciona hasta las ${new Date(menuLink.expiresAt).toLocaleTimeString('es', {
                            hour: '2-digit',
                            minute: '2-digit'
                        })}.`
                        : '\n\n🌐 Menú público interactivo de Gonx!ta Bot.';
                    if (typeof sendWhatsAppMenuPanel === 'function') {
                        const sent = await sendWhatsAppMenuPanel({
                            jid,
                            sock,
                            url: menuLink.url,
                            expiresAt: menuLink.expiresAt
                        });
                        if (!sent) throw new Error('No se pudo enviar el botón del panel.');
                    } else {
                        await sock.sendMessage(jid, {
                            text: `✨ *MENÚ DE GONX!TA BOT*\n\nAbre el panel visual desde este enlace:\n${menuLink.url}${expirationText}`
                        });
                    }
                    if (typeof sendWhatsAppMenu === 'function') {
                        const sent = await sendWhatsAppMenu({ jid, sock, fallbackUrl: menuLink.url });
                        if (!sent) throw new Error('No se pudo abrir la lista de comandos.');
                        return;
                    }
                    return await sock.sendMessage(jid, {
                        text: createTextWhatsAppMenu(menuCommandCategories, menuLink.url)
                    });
                } catch (error) {
                    logger.warn('No se pudo mostrar el menú de WhatsApp', { error: error.message });
                    if (args[0]?.toLowerCase() === 'web') {
                        return await sock.sendMessage(jid, {
                            text: `⚠️ No pude conectar con el panel visual. Aquí tienes los comandos esenciales:\n\n${createTextWhatsAppMenu(menuCommandCategories)}`
                        });
                    }
                    return await sock.sendMessage(jid, {
                        text: `❌ No pude enviar el panel de comandos. ${error.message}\n\n${createTextWhatsAppMenu(menuCommandCategories)}`
                    });
                }
            }

            if (command === '.doom') {
                try {
                    const gameLink = await createTemporaryMenuLink('doom');
                    const expiresAt = new Date(gameLink.expiresAt).toLocaleTimeString('es', {
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    return await sock.sendMessage(jid, {
                        text: `🎮 *GONX!TA: ARENA INFERNAL*\n\nUn mini shooter original inspirado en los clásicos: explora el laberinto, apunta y elimina a los demonios.\n\n${gameLink.url}\n\n🕹️ Teclado: WASD + ratón · Móvil: controles en pantalla\n⏳ Este enlace funciona hasta las ${expiresAt}.`
                    });
                } catch (error) {
                    logger.warn('No se pudo crear el enlace temporal del juego', { error: error.message });
                    return await sock.sendMessage(jid, {
                        text: `❌ No pude iniciar el juego en este momento. ${error.message}`
                    });
                }
            }

            if (command === '.bot') {
                const botMenu = `╭━━━〔 ⚡ *GONX!TA BOT* ⚡ 〕━━━╮
┃ 👋 ¡Qué más, @${sender.split('@')[0]}!
┃ 🚀 Tu centro de comandos está listo
╰━━━━━━━━━━━━━━━━━━━━━━╯

╭━━〔 👤 *PERFIL Y USUARIO* 〕
┃ .reg • .perfil • .perfildos • .nivel
┃ .estadisticas • .logros • .logros_especiales
┃ .myid • .id • .usuarios_totales • .quitarme
┃ .misgrupos • .creador • .soporte • .vendedor
╰━━━━━━━━━━━━━━━━━━━━━━

╭━━〔 💰 *ECONOMÍA* 〕
┃ .banco • .daily • .trabajar • .minar • .pescar
┃ .regalar • .transferir • .dar • .pagar
┃ .prestamo • .interes • .top monedas
┃ .tienda • .comprar • .inventario • .historial
┃ .comprar_xp • .gemas • .comprar_gemas
┃ .crear_pin • .verificar_pin • .pin
╰━━━━━━━━━━━━━━━━━━━━━━

╭━━〔 🎮 *JUEGOS Y RETOS* 〕
┃ .ppt • .tragamonedas • .slot • .dado • .moneda
┃ .apostar • .duelo • .sorteo • .ruleta • .ruleta_colores
┃ .blackjack • .acertijo • .respuesta • .adivinanza
┃ .ahorcado • .letra • .trivia_batalla • .pregunta
┃ .casino • .mayor_menor • .numero_secreto • .anagrama
┃ .memoria • .par_impar
╰━━━━━━━━━━━━━━━━━━━━━━

╭━━〔 🎁 *DIVERSIÓN* 〕
┃ .meme • .joke • .piropo • .ship • .love • .gay • .gorda • .negra
┃ .evento • .evento_temporal • .evento_global • .efecto
┃ .mascota • .casa • .decorar • .hazme_caso • .besame
┃ .flip • .lucky • .spin • .tips • .tutorial • .ayuda
╰━━━━━━━━━━━━━━━━━━━━━━

╭━━〔 🎵 *MÚSICA Y MULTIMEDIA* 〕
┃ .musica / .play / .mp3 • .playlist • .tiktok / .tt • .ig / .reel
┃ .gif <búsqueda>
┃ .estado / .status
┃ .facebook / .fb • .mediafire / .mf • .pinterest / .pin
┃ .play2 / .mp4 • .twitter / .x • .ytsearch / .search
┃ .imagen / .img • .aptoide / .apk • .drive / .gdrive
┃ .s • .sticker • .wm autor • .qr texto • .brat • .bratv
╰━━━━━━━━━━━━━━━━━━━━━━

╭━━〔 🏆 *GRUPOS Y CLANES* 〕
┃ .reglas • .grupo_info • .competencia • .ranking • .ligas
┃ .crear_clan • .invitar_clan • .info_clan • .pelear_clan
┃ .boda • .divorcio • .ajedrez • .carrera • .royale
┃ .loteria • .comparar • .quest • .mision • .mision_diaria
╰━━━━━━━━━━━━━━━━━━━━━━

╭━━〔 🛡️ *ADMINISTRACIÓN* 〕
┃ .cmd enable|disable|list • .modoadmin on|off
┃ .promote • .demote • .warn • .warns • .unwarn
┃ .mute [minutos] • .unmute • .unmutetemp • .unmuteperma
┃ .kick • .ban • .kickall
┃ .abrir • .cerrar • .invitacion • .link • .unirse
┃ .setwelcome texto (opcional: imagen) • .setgoodbye / .goodbye on|off
┃ .tagall • .hidetag • .l • .rol • .roles • .n
┃ .placas • .del • .delreg • .logs • .registro [1-20] • .historial_admin
┃ .stats • .estadisticas_grupo • .antiraid • .antibot
┃ .backup • .limpiar_transacciones • .reset_user
┃ .apagar • .prender • .slowmode • .proteger • .reporte • .sc
╰━━━━━━━━━━━━━━━━━━━━━━

╭━━〔 ✨ *PREMIUM Y TEMPORADA* 〕
┃ .premium • .comprar_premium • .titulo • .insignias
┃ .temporada • .prestigio • .records • .free
╰━━━━━━━━━━━━━━━━━━━━━━

💡 _Usa .menu para abrir el panel resumido._
⚡ _Gonx!ta Bot • Diversión y control en un solo lugar_`;

                const menuImagePath = path.join(__dirname, 'Gonx!ta Bot.png');
                if (fs.existsSync(menuImagePath)) {
                    try {
                        await sock.sendMessage(jid, {
                            image: fs.readFileSync(menuImagePath),
                            mimetype: 'image/png',
                            caption: `⚡ *GONX!TA BOT • COMANDOS* ⚡\n\n🚀 ¡Hola, @${sender.split('@')[0]}! Aquí tienes la guía completa.\n👇 Desliza y encuentra lo que necesitas.`,
                            mentions: [sender]
                        });
                    } catch (error) {
                        logger.warn('No se pudo enviar la portada de .bot; se enviará el menú en texto.', {
                            error: error.message,
                            path: menuImagePath
                        });
                    }
                }
                await sock.sendMessage(jid, { text: botMenu, mentions: [sender] });
            }

          
            if (command === '.rol') {
                const mentionedJid = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!mentionedJid) {
                    return await sock.sendMessage(jid, {
                        text: '⚠️ Uso: .rol @usuario [ROL] | [HORARIO] | [DISPONIBILIDAD]\nEjemplo asignar: .rol @usuario L1 | 08:00-16:00 | Disponible\nEjemplo consultar: .rol @usuario'
                    });
                }

                const roleText = args.slice(1).join(' ').trim();
                ensureGroupSettings(jid);

                if (!roleText) {
                    const currentRole = db.groups[jid].roles[mentionedJid];
                    if (!currentRole) {
                        return await sock.sendMessage(jid, { text: `ℹ️ @${mentionedJid.split('@')[0]} no tiene rol asignado.`, mentions: [mentionedJid] });
                    }
                    return await sock.sendMessage(jid, {
                        text: `📌 Rol de @${mentionedJid.split('@')[0]}:\n• Rol: ${currentRole.role}\n• Horario: ${currentRole.horario}\n• Disponibilidad: ${currentRole.disponibilidad}\n• Asignado por: @${currentRole.assignedBy.split('@')[0]}`,
                        mentions: [mentionedJid]
                    });
                }

                if (!isAdmin) return await sock.sendMessage(jid, { text: '❌ Solo administradores pueden asignar roles.' });

                const parts = roleText.split('|').map(p => p.trim()).filter(Boolean);
                const role = parts[0] || 'No definido';
                const horario = parts[1] || 'No definido';
                const disponibilidad = parts[2] || 'No definido';

                db.groups[jid].roles[mentionedJid] = {
                    role,
                    horario,
                    disponibilidad,
                    assignedBy: sender,
                    assignedAt: Date.now()
                };
                saveDB();

                registrarAccionAdmin(jid, sender, `👤 Rol asignado a @${mentionedJid.split('@')[0]}: ${role}`);

                return await sock.sendMessage(jid, {
                    text: `✅ Rol asignado a @${mentionedJid.split('@')[0]}:\n• Rol: ${role}\n• Horario: ${horario}\n• Disponibilidad: ${disponibilidad}`,
                    mentions: [mentionedJid]
                });
            }

            if (command === '.kickall') {
                if (!isOwner(sender)) {
                    return await sock.sendMessage(jid, { text: '❌ Solo los owners pueden usar .kickall.' });
                }
                const botJids = [
                    sock.user?.id,
                    sock.user?.lid,
                    sock.user?.id?.split(':')[0],
                    sock.user?.lid?.split(':')[0]
                ].filter(Boolean);
                const botNumbers = new Set(botJids.map(botJid =>
                    String(botJid).split('@')[0].split(':')[0].split('_')[0]
                ));
                const isBotIdentifier = identifier => {
                    if (!identifier) return false;
                    const value = String(identifier);
                    const number = value.split('@')[0].split(':')[0].split('_')[0];
                    return botJids.some(botJid => sameJid(value, botJid)) || botNumbers.has(number);
                };
                const botParticipant = participants.find(participant =>
                    [participant.id, participant.lid, participant.phoneNumber].some(isBotIdentifier)
                );
                if (!botParticipant) {
                    logger.error('Se canceló .kickall porque no se pudo identificar al bot entre los participantes.', {
                        botJids
                    });
                    return await sock.sendMessage(jid, {
                        text: '❌ No pude identificar al bot en este grupo. No se expulsó a nadie para proteger la sesión.'
                    });
                }
                const removableUsers = participants
                    .map(participant => ({
                        user: participant.id || participant.lid || participant.phoneNumber,
                        identifiers: [participant.id, participant.lid, participant.phoneNumber]
                    }))
                    .filter(({ user, identifiers }) => user && !identifiers.some(isBotIdentifier))
                    .map(({ user }) => user);
                let removed = 0;
                for (const user of removableUsers) {
                    try {
                        await sock.groupParticipantsUpdate(jid, [user], 'remove');
                        removed++;
                    } catch (kickErr) {
                        logger.warn('No se pudo expulsar durante .kickall', { user, error: kickErr.message });
                    }
                }

                registrarAccionAdmin(jid, sender, `🧹 .kickall ejecutado: ${removed} miembros expulsados`);
                return await sock.sendMessage(jid, { text: `✅ .kickall terminado. Miembros expulsados: ${removed}. El bot fue protegido.` });
            }

            if (command === '.roles') {
                if (!jid.endsWith('@g.us')) {
                    return await sock.sendMessage(jid, { text: '❌ Este comando solo funciona en grupos.' });
                }
                ensureGroupSettings(jid);
                const roles = db.groups[jid].roles || {};
                const entries = Object.entries(roles);
                if (!entries.length) {
                    return await sock.sendMessage(jid, { text: 'ℹ️ No hay roles asignados en este grupo todavía.' });
                }
                const listText = entries.map(([userJid, data], index) => `*${index + 1}.* @${userJid.split('@')[0]}\n• Rol: ${data.role}\n• Horario: ${data.horario}\n• Disponibilidad: ${data.disponibilidad}\n`).join('\n');
                const mentions = entries.map(([userJid]) => userJid);
                return await sock.sendMessage(jid, {
                    text: `📋 *Roles asignados en este grupo:*\n\n${listText}`,
                    mentions
                });
            }

            if (command === '.top') {
                if (!isGroupChat) {
                    return await sock.sendMessage(jid, { text: '⚠️ Este comando solo funciona en grupos.' });
                }

                const topic = args.join(' ')
                    .replace(/[\u0000-\u001f\u007f]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 50);
                if (!topic) {
                    return await sock.sendMessage(jid, { text: 'Uso: .top <tema>\nEjemplo: .top más dormilones' });
                }

                if (topic.toLowerCase() === 'monedas') {
                    const sorted = Object.entries(db.users)
                        .sort((a, b) => (b[1].monedas || 0) - (a[1].monedas || 0))
                        .slice(0, 5);
                    const ranking = sorted
                        .map(([userJid, user], index) => `${index + 1}. @${userJid.split('@')[0]} - ${user.monedas || 0} 💰`)
                        .join('\n');
                    return await sock.sendMessage(jid, {
                        text: `🏆 *TOP 5 MÁS RICOS DE Gonx!ta Bot* 🏆\n\n${ranking}`,
                        mentions: sorted.map(([userJid]) => userJid)
                    });
                }

                const normalizedTopic = topic.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                const botJid = sock.user?.id?.split(':')[0];
                const eligibleParticipants = participants
                    .map((participant) => participant.id || participant.lid || participant.phoneNumber)
                    .filter((participant) => typeof participant === 'string' && participant.includes('@'))
                    .filter((participant) => !sameJid(participant, botJid));

                for (let i = eligibleParticipants.length - 1; i > 0; i--) {
                    const randomIndex = Math.floor(Math.random() * (i + 1));
                    [eligibleParticipants[i], eligibleParticipants[randomIndex]] =
                        [eligibleParticipants[randomIndex], eligibleParticipants[i]];
                }

                const selectedParticipants = eligibleParticipants.slice(0, 10);
                if (!selectedParticipants.length) {
                    return await sock.sendMessage(jid, { text: '❌ No encontré miembros para crear el ranking.' });
                }

                const ranking = selectedParticipants
                    .map((participant, index) => `${index + 1}. @${participant.split('@')[0]}`)
                    .join('\n');
                return await sock.sendMessage(jid, {
                    text: `🎲 *TOP ${selectedParticipants.length}: ${topic}*\n\n${ranking}\n\n_._`,
                    mentions: selectedParticipants
                });
            }

            if (await groupAdminCommands.handleGroupAdminCommand({
                command,
                category: commandCategory,
                jid,
                isAdmin,
                participants,
                registroAdmin: db.groups[jid]?.registroAdmin,
                args,
                sender,
                message: m,
                sock,
                registrarAccionAdmin
            })) return;
            if (command === '.kick') {
                if (!isAdmin) return await sock.sendMessage(jid, { text: '❌ Solo administradores pueden usar este comando.' });

                let users = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];

                if (users.length === 0) {
                    const ctx = m.message.extendedTextMessage?.contextInfo;
                    const quotedParticipant = ctx?.participant;
                    if (quotedParticipant) users.push(quotedParticipant);
                }

                if (users.length === 0) {
                    const reactionParticipant = m.message.reactionMessage?.key?.participant || m.message.reactionMessage?.key?.remoteJid;
                    if (reactionParticipant) users.push(reactionParticipant);
                }

                if (users.length > 0) {
                    let kickedUsers = [];
                    let errors = [];

                    for (let user of users) {
                        if (isOwner(user)) {
                            errors.push(`❌ No puedo eliminar al dueño de Gonx!ta Bot.`);
                            continue;
                        }

                        try {
                            await sock.groupParticipantsUpdate(jid, [user], 'remove');
                            kickedUsers.push(`@${user.split('@')[0]}`);
                            registrarAccionAdmin(jid, sender, `👋 @${user.split('@')[0]} expulsado`);
                        } catch (e) {
                            errors.push(`❌ Error eliminando a @${user.split('@')[0]}: Asegúrate de que Gonx!ta Bot sea administrador.`);
                        }
                    }

                    if (kickedUsers.length > 0) {
                        await sock.sendMessage(jid, { text: `👋 ${kickedUsers.join(', ')} han sido eliminados.`, mentions: users.filter(u => kickedUsers.some(k => k.includes(u.split('@')[0]))) });
                    }

                    if (errors.length > 0) {
                        await sock.sendMessage(jid, { text: errors.join('\n') });
                    }
                } else {
                    await sock.sendMessage(jid, { text: '⚠️ Uso: Responde a un mensaje con *.kick*, reacciona al mensaje y ejecuta *.kick*, o usa *.kick @usuario1 @usuario2 ...*' });
                }
            }
            if (command === '.ban') {
                if (!isAdmin) return await sock.sendMessage(jid, { text: '❌ Solo administradores pueden usar este comando.' });

                let users = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                if (!users.length && args[0]?.toLowerCase() === 'aleatorio') {
                    const eligibleParticipants = participants.filter(p => !isOwner(p.id) && !p.admin);
                    if (!eligibleParticipants.length) return await sock.sendMessage(jid, { text: '❌ No hay miembros elegibles para banear.' });
                    users = [eligibleParticipants[Math.floor(Math.random() * eligibleParticipants.length)].id];
                }
                if (!users.length) {
                    return await sock.sendMessage(jid, { text: '⚠️ Menciona al usuario o usa .ban aleatorio.' });
                }
                
                try {
                    const bannedUsers = users.filter(user => !isOwner(user) && !participants.find(p => sameJid(p.id, user) && p.admin));
                    if (!bannedUsers.length) return await sock.sendMessage(jid, { text: '❌ No hay usuarios válidos para banear.' });
                    await sock.groupParticipantsUpdate(jid, bannedUsers, 'remove');
                    await sock.sendMessage(jid, {
                        text: `🚫 ${bannedUsers.map(user => `@${user.split('@')[0]}`).join(', ')} ha(n) sido baneado(s).`,
                        mentions: bannedUsers
                    });
                } catch (e) {
                    await sock.sendMessage(jid, { text: '❌ Error: Asegúrate de que Gonx!ta Bot sea administrador.' });
                }
            }
            if (command === '.susurro') {
                let user = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                
                let textoSusurro = args.slice(1).join(' ');

                if (user && textoSusurro) {
                    try {
                        await sock.sendMessage(user, { text: `🤫 *Recibiste un susurro:* \n\n${textoSusurro}` });

                        await sock.sendMessage(jid, { delete: m.key });
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            
                        await sock.sendMessage(jid, { 
                            text: `✅ *SUSURRO ENVIADO CON ÉXITO*`, 
                            mentions: [user] 
                        });
                    } catch (e) {
                        await sock.sendMessage(jid, { text: '❌ No pude enviar el susurro. Puede que el usuario tenga el privado bloqueado.' });
                    }
                } else {
                    await sock.sendMessage(jid, { text: '⚠️ Uso correcto: *.susurro @usuario (mensaje)*' });
                }
            }

            if (command === '.warn') {
                const contextInfo = m.message.extendedTextMessage?.contextInfo;
                const user = contextInfo?.mentionedJid?.[0] ||
                    contextInfo?.participant ||
                    m.message.reactionMessage?.key?.participant ||
                    m.message.reactionMessage?.key?.remoteJid;
                const razon = args.slice(1).join(' ') || 'Sin especificar';
                
                if (!user) return await sock.sendMessage(jid, { text: '⚠️ Menciona a un usuario, responde a su mensaje o reacciona a su mensaje: *.warn @usuario [razón]*' });
                if (isOwner(user)) return await sock.sendMessage(jid, { text: '❌ No puedo dar aviso al dueño de Gonx!ta Bot.' });

                if (!db.groups[jid]) ensureGroupSettings(jid);
                if (!db.groups[jid].advertencias) db.groups[jid].advertencias = {};
                if (!db.groups[jid].advertencias[user]) db.groups[jid].advertencias[user] = [];

                db.groups[jid].advertencias[user].push({
                    razon: razon,
                    admin: sender,
                    fecha: new Date().toLocaleString('es-ES'),
                    timestamp: Date.now()
                });

                const avisos = db.groups[jid].advertencias[user].length;
                registrarAccionAdmin(jid, sender, `⚠️ Aviso dado a @${user.split('@')[0]}: "${razon}" (${avisos}/3)`);
                saveDB();

                await sock.sendMessage(jid, {
                    text: `⚠️ @${user.split('@')[0]} ha recibido un aviso (${avisos}/3)\n\n📝 Razón: ${razon}\n👮 Administrador: @${sender.split('@')[0]}\n\n⚡ 3 avisos = expulsión automática`,
                    mentions: [user, sender]
                });

                if (avisos >= 3) {
                    try {
                        await sock.groupParticipantsUpdate(jid, [user], 'remove');
                        await sock.sendMessage(jid, { text: `🚨 @${user.split('@')[0]} ha sido expulsado por acumular 3 avisos.`, mentions: [user] });
                        registrarAccionAdmin(jid, sender, `🚨 Expulsión automática: @${user.split('@')[0]} (3 avisos)`);
                        db.groups[jid].advertencias[user] = [];
                        saveDB();
                    } catch (e) {
                        await sock.sendMessage(jid, { text: '❌ No pude expulsar. Verifica permisos de admin.' });
                    }
                }
            }

            if (command === '.warns') {
                const user = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!user) return await sock.sendMessage(jid, { text: '⚠️ Menciona a un usuario: *.warns @usuario*' });

                if (!db.groups[jid]?.advertencias?.[user] || db.groups[jid].advertencias[user].length === 0) {
                    return await sock.sendMessage(jid, { text: `✅ @${user.split('@')[0]} no tiene avisos registrados.`, mentions: [user] });
                }

                let texto = `⚠️ *AVISOS DE @${user.split('@')[0]}*\n\n`;
                db.groups[jid].advertencias[user].forEach((aviso, i) => {
                    texto += `${i + 1}. *${aviso.razon}*\n   👮 ${aviso.admin.split('@')[0]} | 📅 ${aviso.fecha}\n\n`;
                });

                await sock.sendMessage(jid, { text: texto, mentions: [user] });
            }

            if (command === '.unwarn') {
                const user = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                const indice = parseInt(args[1]) - 1;

                if (!user || isNaN(indice)) return await sock.sendMessage(jid, { text: '⚠️ Uso: *.unwarn @usuario [número]*' });
                if (!db.groups[jid]?.advertencias?.[user] || !db.groups[jid].advertencias[user][indice]) {
                    return await sock.sendMessage(jid, { text: '❌ Aviso no encontrado.' });
                }

                const avisoRemovido = db.groups[jid].advertencias[user].splice(indice, 1)[0];
                saveDB();

                await sock.sendMessage(jid, {
                    text: `✅ Aviso removido: "${avisoRemovido.razon}"\n📊 Avisos restantes: ${db.groups[jid].advertencias[user].length}/3`,
                    mentions: [user]
                });
            }

            if (command === '.mute') {
                const contextInfo = m.message.extendedTextMessage?.contextInfo;
                const user = contextInfo?.mentionedJid?.[0] ||
                    contextInfo?.participant ||
                    m.message.reactionMessage?.key?.participant ||
                    m.message.reactionMessage?.key?.remoteJid;
                const tiempoTexto = args.find(arg => /^\d+$/.test(arg));
                const tiempo = tiempoTexto ? parseInt(tiempoTexto, 10) : null;

                if (!user) {
                    return await sock.sendMessage(jid, { text: '⚠️ Menciona a un usuario o responde a su mensaje: *.mute @usuario [minutos]*' });
                }
                if (isOwner(user)) return await sock.sendMessage(jid, { text: '❌ No puedo silenciar al dueño.' });

                if (!db.groups[jid]) ensureGroupSettings(jid);
                if (!db.groups[jid].muteados) db.groups[jid].muteados = {};

                const isPermanent = tiempo === null;
                db.groups[jid].muteados[user] = isPermanent ? 'permanent' : Date.now() + (tiempo * 60000);
                registrarAccionAdmin(
                    jid,
                    sender,
                    isPermanent
                        ? `🔇 @${user.split('@')[0]} silenciado indefinidamente`
                        : `🔇 @${user.split('@')[0]} silenciado por ${tiempo} minuto(s)`
                );
                saveDB();

                await sock.sendMessage(jid, {
                    text: isPermanent
                        ? `🔇 @${user.split('@')[0]} ha sido silenciado indefinidamente.\n\n📌 Solo podrá hablar cuando un administrador use .unmute.`
                        : `🔇 @${user.split('@')[0]} ha sido silenciado por ${tiempo} minuto(s).\n\n📌 No podrá enviar mensajes durante este tiempo.`,
                    mentions: [user]
                });
            }

            if (command === '.unmute' || command === '.unmutetemp' || command === '.unmuteperma') {
                const contextInfo = m.message.extendedTextMessage?.contextInfo;
                const user = contextInfo?.mentionedJid?.[0] ||
                    contextInfo?.participant ||
                    m.message.reactionMessage?.key?.participant ||
                    m.message.reactionMessage?.key?.remoteJid;

                if (!user) return await sock.sendMessage(jid, { text: '⚠️ Menciona a un usuario o responde a su mensaje: *.unmute @usuario*' });
                const muteValue = db.groups[jid]?.muteados?.[user];
                const isPermanent = isPermanentGroupMute(muteValue);
                const isTemporary = typeof muteValue === 'number';
                const shouldRemove = command === '.unmute' ||
                    (command === '.unmutetemp' && isTemporary) ||
                    (command === '.unmuteperma' && isPermanent);
                if (!muteValue || !shouldRemove) {
                    return await sock.sendMessage(jid, { text: `ℹ️ @${user.split('@')[0]} no está silenciado.`, mentions: [user] });
                }

                delete db.groups[jid].muteados[user];
                registrarAccionAdmin(jid, sender, `🔊 @${user.split('@')[0]} desilenciado`);
                saveDB();

                await sock.sendMessage(jid, {
                    text: `🔊 @${user.split('@')[0]} ha sido desilenciado.`,
                    mentions: [user]
                });
            }

            if (command === '.stats') {
                if (!isAdmin) return await sock.sendMessage(jid, { text: '❌ Solo administradores pueden ver estadísticas.' });
                
                const stats = `📊 *ESTADÍSTICAS DEL GRUPO*

👥 *Miembros:* ${participants.length}
👮 *Administradores:* ${participants.filter(p => p.admin).length}
⚠️ *Usuarios con avisos:* ${db.groups[jid]?.advertencias ? Object.keys(db.groups[jid].advertencias).filter(u => db.groups[jid].advertencias[u].length > 0).length : 0}
🔇 *Usuarios silenciados:* ${db.groups[jid]?.muteados ? Object.keys(db.groups[jid].muteados).filter(u => isActiveGroupMute(db.groups[jid].muteados[u])).length : 0}

🔋 *Estado del bot:* ${isBotActiveInGroup(jid) ? '✅ Activo' : '❌ Inactivo'}

> *Última actualización:* ${new Date().toLocaleString('es-ES')}`;

                await sock.sendMessage(jid, { text: stats });
            }

            if (command === '.del') {
                const quotedMessage = m.message.extendedTextMessage?.contextInfo?.stanzaId;
                
                if (quotedMessage) {
                    try {
                        await sock.sendMessage(jid, { 
                            delete: { 
                                remoteJid: jid, 
                                fromMe: false, 
                                id: quotedMessage, 
                                participant: m.message.extendedTextMessage.contextInfo.participant 
                            } 
                        });

                        await sock.sendMessage(jid, { delete: m.key });

                    } catch (e) {
                        await sock.sendMessage(jid, { delete: m.key });
                        console.log("Error al eliminar mensaje ajeno: posible falta de permisos.");
                    }
                } else {
                    await sock.sendMessage(jid, { delete: m.key });
                }
            }
if (command === '.reg') {
    if (db.users[sender]) return await sock.sendMessage(jid, { text: '⚠️ Ya estás registrado en el sistema de Gonx!ta Bot.' });
    
    db.users[sender] = {
        nombre: m.pushName || 'Usuario Gonx!ta Bot',
        monedas: 100,
        nivel: 1,
        xp: 0,
        ultimoDaily: 0,
        ultimoTrabajo: 0
    };
    saveDB();
    await sock.sendMessage(jid, { text: `✅ ¡Registro exitoso! Recibiste 100 monedas de bienvenida. @${sender.split('@')[0]}`, mentions: [sender] });
}

if (command === '.delreg') {
    const isAdminUser = participants.find(p => sameJid(p.id, sender))?.admin || isOwner(sender);
    if (!isAdminUser) return await sock.sendMessage(jid, { text: '❌ Solo los admins/owners pueden usar este comando.' }); 
    
    let user = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    if (!user) return await sock.sendMessage(jid, { text: '⚠️ Menciona al usuario que deseas eliminar del registro.' });
    
    if (!db.users[user]) return await sock.sendMessage(jid, { text: '❌ Este usuario no está registrado.' });
    
    delete db.users[user];
    saveDB();
    
    await sock.sendMessage(jid, { text: `🗑️ @${user.split('@')[0]} ha sido eliminado del registro de usuarios.`, mentions: [user] });
}

if (command === '.perfil' || command === '.nivel') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ No estás registrado. Usa *.reg*' });
    
    const u = db.users[sender];
    let nivel = u.nivel || 1;
    let rango = "";
    let icono = "";

    if (nivel >= 1 && nivel <= 10) {
        rango = "Recluta del Clan";
        icono = "🛡️";
    } else if (nivel >= 11 && nivel <= 30) {
        rango = "Guerrero Gonx!ta Bot";
        icono = "⚔️";
    } else if (nivel >= 31 && nivel <= 50) {
        rango = "Comandante de Élite";
        icono = "🎖️";
    } else if (nivel >= 51 && nivel <= 80) {
        rango = "General Maestro";
        icono = "🔱";
    } else if (nivel >= 81) {
        rango = "Leyenda Inmortal Gonx!ta Bot";
        icono = "👑";
    }

    const mentionHandle = `@${sender.split('@')[0]}`;
    const perfilTxt = `┏━━━━━━━━━━━━━━━━━━━┓
┃    👤 *PERFIL DE USUARIO*
┗━━━━━━━━━━━━━━━━━━━┛
✨ *Nombre:* ${u.nombre || 'Usuario Gonx!ta Bot'} ${mentionHandle}
${icono} *Rango:* ${rango}
📊 *Nivel:* ${nivel}
✨ *Progreso XP:* [ ${u.xp}/100 ]
💰 *Cartera:* ${u.monedas} monedas

> *Sigue activo para subir de rango y desbloquear beneficios.*
> *Coded by Gonx!ta Bot 2026*`;

    await sock.sendMessage(jid, { text: perfilTxt, mentions: [sender] });
    return;
}
if (command === '.minar' || command === '.pescar' || command === '.trabajar') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero con *.reg*' });
    
    const cooldown = 600000; 
    if (Date.now() - db.users[sender].ultimoTrabajo < cooldown) return await sock.sendMessage(jid, { text: '⏳ Estás agotado, espera 10 minutos.' });

    let ganancia = Math.floor(Math.random() * 200) + 50;
    db.users[sender].monedas += ganancia;
    db.users[sender].xp += 10;
    db.users[sender].ultimoTrabajo = Date.now();
    
    if (db.users[sender].xp >= 100) {
        db.users[sender].nivel += 1;
        db.users[sender].xp = 0;
    }
    
    saveDB();
    const accion = command === '.minar' ? 'minado ⛏️' : command === '.pescar' ? 'pescado 🎣' : 'trabajado 👷';
    await sock.sendMessage(jid, { text: `💰 Has ${accion} con éxito y ganaste *${ganancia} monedas*.` });
}

if (command === '.daily' || command === '.dayli') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Usa *.reg*' });
    
    const dia = 86400000; 
    if (Date.now() - db.users[sender].ultimoDaily < dia) return await sock.sendMessage(jid, { text: '🎁 Ya recogiste tu regalo de hoy.' });

    db.users[sender].monedas += 500;
    db.users[sender].ultimoDaily = Date.now();
    saveDB();
    await sock.sendMessage(jid, { text: '🎁 *RECOMPENSA DIARIA:* Has recibido 500 monedas.' });
}
if (command === '.regalar') {
    let user = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    let monto = parseInt(args[1]);
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    if (!user || isNaN(monto) || monto <= 0) return await sock.sendMessage(jid, { text: '⚠️ Uso: *.regalar @usuario 100*' });
    
    if (db.users[sender].monedas < monto) return await sock.sendMessage(jid, { text: '❌ No tienes suficientes monedas.' });

    db.users[sender].monedas -= monto;
    if (!db.users[user]) db.users[user] = { nombre: 'Usuario', monedas: 0, nivel: 1, xp: 0 };
    db.users[user].monedas += monto;
    
    registrarTransaccion('regalo', sender, user, monto, 'Regalo voluntario');
    saveDB();
    await sock.sendMessage(jid, { text: `🎀 Le has regalado ${monto} monedas a @${user.split('@')[0]}`, mentions: [user] });
}

if (command === '.tienda') {
    const tienda = `🛒 *━━━ Gonx!ta Bot STORE ━━━* 🛒

╭─ ⛏️ *HERRAMIENTAS* ⛏️
│
│ 1️⃣ *Pico de Bronce*
│    💰 500 monedas
│    ✨ +25% ganancias al minar
│    ⏱️ Durabilidad: 30 usos
│
│ 2️⃣ *Pico de Plata*
│    💰 1.500 monedas
│    ✨ +50% ganancias al minar
│    ⏱️ Durabilidad: 60 usos
│
│ 3️⃣ *Pico de Oro*
│    💰 3.500 monedas
│    ✨ +100% ganancias al minar
│    ⏱️ Durabilidad: 100 usos
│
╰────────────────────

╭─ 🛡️ *DEFENSA* 🛡️
│
│ 4️⃣ *Escudo Protector*
│    💰 800 monedas
│    ✨ -50% riesgo de robo
│    ⏱️ Duración: 48 horas
│
│ 5️⃣ *Armadura de Hierro*
│    💰 2.000 monedas
│    ✨ Protección total 24h
│    ⏱️ No pierdes dinero
│
│ 6️⃣ *Fortaleza Divina*
│    💰 5.000 monedas
│    ✨ Protección 7 días
│    ⏱️ 100% seguridad
│
╰────────────────────

╭─ ✨ *EXPERIENCIA* ✨
│
│ 7️⃣ *Tarjeta XP Pequeña*
│    💰 600 monedas
│    ✨ +500 XP
│
│ 8️⃣ *Tarjeta XP Mediana*
│    💰 1.200 monedas
│    ✨ +1500 XP
│
│ 9️⃣ *Tarjeta XP Grande*
│    💰 2.500 monedas
│    ✨ +5000 XP
│    🎯 +1 nivel automático
│
│ 🔟 *Nivel Instantáneo*
│    💰 3.000 monedas
│    ✨ Sube 1 nivel inmediato
│    🎯 Bonus: +200 monedas
│
╰────────────────────

╭─ 💎 *PREMIUM* 💎
│
│ 🔟 *Monedas x2*
│    💰 4.000 monedas
│    ✨ Duplica dinero en banco
│    ⏱️ Válido 24 horas
│
│ 1️⃣1️⃣ *Pase VIP Semanal*
│    💰 6.000 monedas
│    ✨ +20% todas las ganancias
│    ✨ Acceso a .tienda premium
│    ⏱️ 7 días de validez
│
│ 1️⃣2️⃣ *Mascota Legendaria*
│    💰 8.000 monedas
│    ✨ Bonus permanente +15% XP
│    ✨ Ayuda en trabajos
│
╰────────────────────

*💡 CÓMO COMPRAR:*
Usa: *.comprar [número]* 

📊 *TU BALANCE:*
💰 Monedas: ${db.users[sender]?.monedas || 0}
📈 Nivel: ${db.users[sender]?.nivel || 1}
✨ XP: ${db.users[sender]?.xp || 0}/100

*Ej: .comprar 1* (Comprar Pico de Bronce)`;
    
    await sock.sendMessage(jid, { text: tienda });
}

if (command === '.m' || command === '.help') {
    const menuText = `📜 *Gonx!ta Bot • AYUDA RÁPIDA*

_Acciones frecuentes para comenzar:_

🛒 *.tienda* - Ver artículos disponibles
🛍️ *.comprar [número]* - Comprar artículo
📈 *.comprar_xp [cantidad]* - Comprar XP
🎒 *.inventario* - Ver tu inventario completo
⭐ *.favorito add [nombre]* - Agregar favorito
🌟 *.favoritos* - Ver tus favoritos
🛡️ *.kick @usuario* - Expulsar mencionando
👋 Reacciona con 👋 🚪 ❌ 🔴 para expulsar por mensaje
📌 *.reglas* - Ver normas del grupo`;

    const buttons = [
        { buttonId: '.tienda', buttonText: { displayText: 'Tienda' }, type: 1 },
        { buttonId: '.inventario', buttonText: { displayText: 'Inventario' }, type: 1 },
        { buttonId: '.favoritos', buttonText: { displayText: 'Favoritos' }, type: 1 }
    ];

    await sock.sendMessage(jid, {
        text: menuText,
        footer: 'Gonx!ta Bot Bot',
        buttons,
        headerType: 1
    });
    return;
}
if (command === '.ppt') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate con .reg' });
    const opciones = ['piedra', 'papel', 'tijera'];
    const botChoice = opciones[Math.floor(Math.random() * 3)];
    const userChoice = args[0]?.toLowerCase();
    if (!opciones.includes(userChoice)) return await sock.sendMessage(jid, { text: '⚠️ Uso: .ppt piedra | papel | tijera' });

    let resultado = "";
    if (userChoice === botChoice) resultado = "🤝 ¡Empate!";
    else if ((userChoice === 'piedra' && botChoice === 'tijera') || (userChoice === 'papel' && botChoice === 'piedra') || (userChoice === 'tijera' && botChoice === 'papel')) {
        db.users[sender].monedas += 50;
        resultado = `🥳 ¡Ganaste! El bot eligió ${botChoice}. Recibes 50 monedas.`;
    } else {
        db.users[sender].monedas -= 30;
        resultado = `💀 Perdiste. El bot eligió ${botChoice}. Pierdes 30 monedas.`;
    }
    saveDB();
    await sock.sendMessage(jid, { text: resultado });
}

if (command === '.tragamonedas' || command === '.slot') {
    if (!db.users[sender] || db.users[sender].monedas < 50) return await sock.sendMessage(jid, { text: '❌ Necesitas al menos 50 monedas.' });
    const emojis = ["🍎", "💎", "🎰", "🍒", "🌟"];
    const a = emojis[Math.floor(Math.random() * emojis.length)];
    const b = emojis[Math.floor(Math.random() * emojis.length)];
    const c = emojis[Math.floor(Math.random() * emojis.length)];
    
    let msg = `🎰 **CASINO Gonx!ta Bot** 🎰\n──────────\n      ${a} | ${b} | ${c}\n──────────\n`;
    if (a === b && b === c) {
        db.users[sender].monedas += 500;
        msg += "🔥 ¡JACKPOT! Ganaste 500 monedas.";
    } else if (a === b || b === c || a === c) {
        db.users[sender].monedas += 100;
        msg += "✨ ¡Casi! Ganaste 100 monedas.";
    } else {
        db.users[sender].monedas -= 50;
        msg += "❌ Perdiste 50 monedas.";
    }
    saveDB();
    await sock.sendMessage(jid, { text: msg });
}

if (command === '.casino') {
    return await sock.sendMessage(jid, {
        text: `🎰 *TODOS LOS JUEGOS DE GONX!TA* 🎮\n\n` +
            `💰 *Casino y apuestas*\n` +
            `• .tragamonedas / .slot\n` +
            `• .blackjack\n` +
            `• .ruleta / .ruleta_colores\n` +
            `• .apostar • .sorteo • .loteria\n` +
            `• .mayor_menor mayor|menor\n` +
            `• .par_impar par|impar\n\n` +
            `🎲 *Juegos rápidos*\n` +
            `• .ppt piedra|papel|tijera\n` +
            `• .dado • .moneda • .8ball\n` +
            `• .duelo • .ajedrez • .carrera\n\n` +
            `🧠 *Juegos de ingenio*\n` +
            `• .numero_secreto [número]\n` +
            `• .anagrama [palabra]\n` +
            `• .memoria [secuencia]\n` +
            `• .ahorcado y .letra [letra]\n` +
            `• .acertijo y .respuesta [respuesta]\n` +
            `• .adivinanza respuesta [respuesta]\n` +
            `• .pregunta y .trivia_batalla\n\n` +
            `💵 Los juegos nuevos cuestan 50 monedas y pagan 100 al ganar.`
    });
}

if (['.mayor_menor', '.numero_secreto', '.anagrama', '.memoria', '.par_impar'].includes(command)) {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate con .reg' });
    const gameKey = `${jid}:${sender}`;
    const user = db.users[sender];
    if (!Number.isFinite(user.monedas)) user.monedas = 0;
    const charge = 50;
    const reward = 100;

    if (command === '.par_impar') {
        if (user.monedas < charge) return await sock.sendMessage(jid, { text: '❌ Necesitas 50 monedas.' });
        const result = playOddEven(args[0]?.toLowerCase());
        if (result.status === 'invalid') return await sock.sendMessage(jid, { text: '⚠️ Uso: .par_impar par | impar' });
        user.monedas += result.status === 'won' ? reward - charge : -charge;
        saveDB();
        return await sock.sendMessage(jid, {
            text: `🎲 Salió *${result.roll}* (${result.parity}).\n${result.status === 'won' ? '✅ ¡Ganaste 100 monedas!' : '❌ Perdiste 50 monedas.'}`
        });
    }

    if (command === '.mayor_menor') {
        if (!casinoJuegos[gameKey]) {
            if (user.monedas < charge) return await sock.sendMessage(jid, { text: '❌ Necesitas 50 monedas.' });
            user.monedas -= charge;
            casinoJuegos[gameKey] = { type: command, game: createHigherLowerGame() };
            saveDB();
            return await sock.sendMessage(jid, { text: '🃏 Carta actual: *' + casinoJuegos[gameKey].game.card + '*\nAdivina con `.mayor_menor mayor` o `menor`.' });
        }
        const active = casinoJuegos[gameKey];
        const result = playHigherLower(active.game, args[0]?.toLowerCase());
        if (result.status === 'invalid') return await sock.sendMessage(jid, { text: '⚠️ Responde: .mayor_menor mayor | menor' });
        delete casinoJuegos[gameKey];
        if (result.status === 'won') user.monedas += reward;
        saveDB();
        return await sock.sendMessage(jid, {
            text: `🃏 ${result.previous} → ${result.next}\n${result.status === 'won' ? '✅ ¡Ganaste 100 monedas!' : '❌ Perdiste la partida.'}`
        });
    }

    if (!casinoJuegos[gameKey]) {
        if (user.monedas < charge) return await sock.sendMessage(jid, { text: '❌ Necesitas 50 monedas.' });
        user.monedas -= charge;
        const game = command === '.numero_secreto'
            ? createSecretNumberGame()
            : command === '.anagrama'
                ? createAnagramGame()
                : createMemoryGame();
        casinoJuegos[gameKey] = { type: command, game };
        saveDB();
        const prompt = command === '.numero_secreto'
            ? 'Adivina un número del 1 al 100 con `.numero_secreto <número>` (7 intentos).'
            : command === '.anagrama'
                ? `Ordena esta palabra: *${game.scrambled}*. Responde con \`.anagrama <palabra>\`.`
                : `Memoriza: *${game.sequence.join(' ')}*. Luego responde con \`.memoria <secuencia>\`.`;
        return await sock.sendMessage(jid, { text: `🎰 Partida iniciada (-50 monedas).\n${prompt}` });
    }

    const active = casinoJuegos[gameKey];
    let result;
    if (command === '.numero_secreto') result = guessSecretNumber(active.game, args[0]);
    if (command === '.anagrama') result = answerAnagram(active.game, args.join(' '));
    if (command === '.memoria') result = answerMemory(active.game, args.join(' '));
    if (result.status === 'invalid') return await sock.sendMessage(jid, { text: '⚠️ Respuesta inválida. Revisa las instrucciones del juego.' });
    if (result.status === 'higher' || result.status === 'lower') {
        return await sock.sendMessage(jid, { text: `🔎 El número es ${result.status === 'higher' ? 'mayor' : 'menor'}. Te quedan ${result.attempts} intentos.` });
    }
    delete casinoJuegos[gameKey];
    if (result.status === 'won') user.monedas += reward;
    saveDB();
    return await sock.sendMessage(jid, {
        text: result.status === 'won'
            ? '✅ ¡Ganaste 100 monedas!'
            : `❌ Perdiste la partida.${result.number ? ` El número era ${result.number}.` : ''}`
    });
}

if (command === '.dado') {
    const cara = Math.floor(Math.random() * 6) + 1;
    await sock.sendMessage(jid, { text: `🎲 El dado cayó en: *${cara}*` });
}

if (command === '.moneda') {
    const lado = Math.random() > 0.5 ? 'CARA' : 'CRUZ';
    await sock.sendMessage(jid, { text: `🪙 Lanzaste una moneda y cayó en: *${lado}*` });
}
if (command === '.apostar') {
    const mencionado = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    const monto = Number(args[1]);
    if (!mencionado || !Number.isSafeInteger(monto) || monto <= 0) return await sock.sendMessage(jid, { text: '⚠️ Uso: .apostar @usuario 100' });
    if (mencionado === sender) return await sock.sendMessage(jid, { text: '❌ No puedes apostar contra ti mismo.' });
    if (db.users[sender].monedas < monto) return await sock.sendMessage(jid, { text: '❌ No tienes saldo.' });

    const ganador = Math.random() > 0.5 ? sender : mencionado;
    db.users[sender].monedas -= monto;
    if (!db.users[mencionado]) db.users[mencionado] = { monedas: 0, nivel: 1, xp: 0 };
    db.users[ganador].monedas += monto * 2;
    saveDB();
    await sock.sendMessage(jid, { text: `🎲 @${ganador.split('@')[0]} ganó la apuesta de ${monto}!`, mentions: [ganador] });
}

if (command === '.robar') {
    const user = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    if (!user) return await sock.sendMessage(jid, { text: '⚠️ Menciona a tu víctima.' });
    if (user === sender) return await sock.sendMessage(jid, { text: '❌ No puedes robarte a ti mismo.' });
    if (!db.users[user]) return await sock.sendMessage(jid, { text: '❌ La persona mencionada debe registrarse primero con .reg.' });

    if (db.users[user]?.protegido && db.users[user].protegido > Date.now()) {
        return await sock.sendMessage(jid, { text: '🛡️ Este usuario está protegido contra robos.' });
    }
    
    if (Math.random() > 0.7) { 
        const saldoVictima = Number.isFinite(db.users[user].monedas) ? db.users[user].monedas : 0;
        if (saldoVictima <= 0) return await sock.sendMessage(jid, { text: '❌ Esa persona no tiene monedas para robar.' });
        const robo = Math.min(Math.floor(Math.random() * 100) + 10, saldoVictima);
        db.users[sender].monedas += robo;
        db.users[user].monedas -= robo;
        registrarTransaccion('robo', sender, user, robo, 'Robo exitoso');
        saveDB();
        await sock.sendMessage(jid, { text: `🥷 ¡Éxito! Le robaste ${robo} monedas a @${user.split('@')[0]}`, mentions: [user] });
    } else {
        db.users[sender].monedas -= 50;
        registrarTransaccion('multa_robo', sender, 'sistema', 50, 'Multa por intento fallido de robo');
        saveDB();
        await sock.sendMessage(jid, { text: '👮 ¡Te atraparon! Pagaste 50 monedas de multa.' });
    }
}
if (command === '.8ball') {
    const respuestas = ["Sí", "No", "Tal vez", "Definitivamente", "No lo creo", "Pregunta de nuevo"];
    const r = respuestas[Math.floor(Math.random() * respuestas.length)];
    await sock.sendMessage(jid, { text: `🎱 *Bola Mágica:* ${r}` });
}
if (command === '.duelo') {
    let oponente = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    if (!oponente) return await sock.sendMessage(jid, { text: '⚠️ Menciona a alguien para pelear.' });
    if (oponente === sender) return await sock.sendMessage(jid, { text: '❌ No puedes pelear contigo mismo.' });

    const vidaBot = Math.floor(Math.random() * 100);
    const vidaUser = Math.floor(Math.random() * 100);
    const ganador = vidaUser > vidaBot ? sender : oponente;

    await sock.sendMessage(jid, { 
        text: `⚔️ *DUELO ÉPICO* ⚔️\n\n@${sender.split('@')[0]}: ${vidaUser} HP\n@${oponente.split('@')[0]}: ${vidaBot} HP\n\n🏆 El ganador es: @${ganador.split('@')[0]}`, 
        mentions: [sender, oponente] 
    });
}

if (command === '.sorteo') {
    if (!isGroupChat || participants.length === 0) {
        return await sock.sendMessage(jid, { text: '⚠️ El sorteo solo se puede hacer en un grupo con participantes.' });
    }
    const seleccion = participants[Math.floor(Math.random() * participants.length)];
    const premio = args.join(' ') || 'un beso del admin';
    await sock.sendMessage(jid, { 
        text: `🎁 *SORTEO Gonx!ta Bot*\n\nEl ganador de: *${premio}* es...\n\n🎉 ¡Felicidades @${seleccion.id.split('@')[0]}!`, 
        mentions: [seleccion.id] 
    });
}
if (command === '.acertijo') {
    const acertijos = [
        { q: "Tiene ojos y no ve, tiene agua y no la bebe, tiene carne y no la come.", a: "coco" },
        { q: "Oro parece, plata no es, el que no lo adivine, bien tonto es.", a: "platano" },
        { q: "Blanco por dentro, verde por fuera. Si quieres que te lo diga, espera.", a: "pera" }
    ];
    const res = acertijos[Math.floor(Math.random() * acertijos.length)];
    acertijoActivo[jid] = res.a;
    await sock.sendMessage(jid, { text: `🧩 *ACERTIJO Gonx!ta Bot*\n\n"${res.q}"\n\n> Responde con: *.respuesta (palabra)*` });
}

if (command === '.respuesta') {
    if (!acertijoActivo[jid]) return await sock.sendMessage(jid, { text: '⚠️ No hay un acertijo activo ahora.' });
    if (args[0]?.toLowerCase() === acertijoActivo[jid]) {
        db.users[sender].monedas += 100;
        saveDB();
        delete acertijoActivo[jid];
        await sock.sendMessage(jid, { text: `✅ ¡CORRECTO! @${sender.split('@')[0]} ganó 100 monedas.`, mentions: [sender] });
    } else {
        await sock.sendMessage(jid, { text: '❌ Respuesta incorrecta, sigue intentando.' });
    }
}

if (command === '.adivinanza' && args[0]?.toLowerCase() !== 'respuesta') {
    const adivinanzas = [
        { q: "Blanca por dentro, verde por fuera. Si quieres que te lo diga, espera.", a: "pera" },
        { q: "Oro parece, plata no es. Abran las cortinas y verán lo que es.", a: "plátano" },
        { q: "Tiene ojos y no ve, tiene agua y no la bebe, tiene carne y no la come.", a: "coco" },
        { q: "Sombrero sobre sombrero de un tejido muy fino, no lo adivinarás en un año ni un siglo.", a: "cebolla" },
        { q: "Una cajita de buen parecer, ningún carpintero la sabe hacer.", a: "nuez" },
        { q: "Agrio es su sabor, bastante dura su piel y si lo quieres tomar, tendrás que estrujarlo bien.", a: "limón" },
        { q: "Me escriben con tres letras, pero el peso del mundo sostengo.", a: "pan" },
        { q: "Soy roja y redondita y tengo pecas negras; nací en un árbol y me comen las abejas.", a: "cereza" },
        { q: "Una señora muy señoreada, con muchos remiendos y nada de puntadas.", a: "col" },
        { q: "Blanca soy, de la vaca nací, pobre del niño que no beba de mí.", a: "leche" },
        { q: "En alto vive, en alto mora, en alto teje la tejedora.", a: "araña" },
        { q: "¿Cuál es el animal que tiene silla y no se puede sentar?", a: "caballo" },
        { q: "Canto en la orilla, vivo en el agua, no soy pescado ni soy cigarra.", a: "rana" },
        { q: "Llevo la casa a cuestas, camino sin tener pies, voy dejando mi huella como un hilo de plata.", a: "caracol" },
        { q: "Vuelo de noche, duermo de día y nunca verás plumas en el ala mía.", a: "murciélago" },
        { q: "Mi cuello es largo, mis patas también, y manchas en el cuerpo tengo yo bien.", a: "jirafa" },
        { q: "¿Quién es el que silba sin boca, corre sin pies y te pega en la cara y no lo ves?", a: "viento" },
        { q: "Soy un animal muy elegante, muy veloz y poco fiero; y cuando quiero calzarme voy a casa del herrero.", a: "caballo" },
        { q: "Tiene las orejas largas, tiene la cola cortita; corre y salta muy ligero.", a: "conejo" },
        { q: "Tengo patas y no ando, soy plana y no hablo, y sobre mí la comida siempre están dejando.", a: "mesa" },
        { q: "Me pisas y no me quejo, me cepillas si me mancho, y con mis hermanos duermo en un cajón muy ancho.", a: "zapato" },
        { q: "Abierta siempre estoy de día y cerrada de noche; dejo pasar la luz y detengo el coche.", a: "ventana" },
        { q: "Tengo dientes y no muerdo, guardo tesoros y no soy cofre.", a: "llave" },
        { q: "Dos hermanitos muy igualitos, cuando llegan a viejos abren los ojitos.", a: "zapatos" },
        { q: "Por un camino de hierro voy corriendo muy veloz, y doy un fuerte silbido cuando llego a la estación.", a: "tren" },
        { q: "Sube llena y baja vacía, si no se da prisa, la sopa se enfría.", a: "cuchara" },
        { q: "Cuatro patas tiene y no puede caminar, también tiene un respaldo y no sabe hablar.", a: "silla" },
        { q: "Siempre quietas, siempre en su lugar, pero si te mueves, te pueden golpear.", a: "paredes" },
        { q: "Te la digo y no me entiendes, te la vuelvo a decir y no la comprendes.", a: "tela" },
        { q: "Nazco y muero a cada instante, pero nunca me verás moverme un solo guante.", a: "luz" },
        { q: "¿Qué es algo que siempre viene pero nunca llega?", a: "mañana" },
        { q: "Tengo hojas pero no soy árbol, tengo lomo pero no soy animal.", a: "libro" },
        { q: "Redondo, redondo como un queso y nadie puede darle un beso.", a: "sol" },
        { q: "Vuela sin alas, silba sin boca.", a: "viento" },
        { q: "Sale de noche, se va de día, es blanca y redonda.", a: "luna" },
        { q: "Una vieja con un solo diente que llama a toda la gente.", a: "campana" },
        { q: "Cien amigos tengo, todos en una tabla, si yo no los toco, ellos no me hablan.", a: "piano" },
        { q: "Caen de lo alto y no se rompen, caen al agua y se deshacen.", a: "lluvia" },
        { q: "Cuanto más crece, menos se ve.", a: "oscuridad" },
        { q: "Todos lo tienen, pero otros lo usan más que tú.", a: "nombre" },
        { q: "Si lo nombras, lo rompes.", a: "silencio" },
        { q: "Me hablas y te respondo, pero no tengo cuerpo.", a: "eco" },
        { q: "Si lo tienes, lo quieres compartir; si lo compartes, ya no lo tienes.", a: "secreto" },
        { q: "Sube pero nunca baja.", a: "humo" },
        { q: "Te sigue a todas partes pero no puedes tocarla.", a: "sombra" },
        { q: "No tiene manos pero aprieta.", a: "frío" },
        { q: "Se moja mientras te seca.", a: "toalla" },
        { q: "Tiene muchos dientes pero no come.", a: "peine" },
        { q: "Si te ríes, se ríe; si lloras, llora.", a: "espejo" },
        { q: "Tiene un ojo y no ve.", a: "aguja" },
        { q: "Tiene seis caras y no tiene cuerpo.", a: "dado" },
        { q: "Está en medio del mar y al final del día.", a: "a" },
        { q: "Camina y no tiene pies, tiene agujas y no cose.", a: "reloj" },
        { q: "Tiene ciudades pero no casas, montañas pero no árboles.", a: "mapa" },
        { q: "En el medio del cielo estoy, sin ser lucero ni estrella.", a: "e" },
        { q: "Blanco y negro, pero suena a colores.", a: "piano" },
        { q: "Llena de agujeros pero aguanta el agua.", a: "esponja" },
        { q: "Va por todo el mundo sin moverse de su sitio.", a: "camino" },
        { q: "Si llueve, sube; si no llueve, baja.", a: "paraguas" }
       

    ];
    const res = adivinanzas[Math.floor(Math.random() * adivinanzas.length)];
    adivinanzaActiva[jid] = res.a;
    await sock.sendMessage(jid, { text: `🧩 *ADIVINANZA Gonx!ta Bot*\n\n"${res.q}"\n\n> Responde con: *.adivinanza respuesta (palabra)*` });
    return;
}

if (command === '.adivinanza' && args[0]?.toLowerCase() === 'respuesta') {
    if (!adivinanzaActiva[jid]) return await sock.sendMessage(jid, { text: '⚠️ No hay una adivinanza activa ahora.' });
    const respuestaUsuario = normalizeGameAnswer(args.slice(1).join(' '));
    if (!respuestaUsuario) {
        return await sock.sendMessage(jid, { text: '⚠️ Escribe tu respuesta: .adivinanza respuesta <palabra>' });
    }
    if (respuestaUsuario === normalizeGameAnswer(adivinanzaActiva[jid])) {
        if (db.users[sender]) {
            db.users[sender].monedas += 100;
            saveDB();
        }
        delete adivinanzaActiva[jid];
        await sock.sendMessage(jid, { text: `✅ ¡CORRECTO! @${sender.split('@')[0]} ganó 100 monedas.`, mentions: [sender] });
    } else {
        await sock.sendMessage(jid, { text: '❌ Respuesta incorrecta, sigue intentando.' });
    }
    return;
}
if (command === '.top' && args[0] === 'pareja') {
    let p1 = participants[Math.floor(Math.random() * participants.length)].id;
    let p2 = participants[Math.floor(Math.random() * participants.length)].id;
    let amor = Math.floor(Math.random() * 100);
    
    const txt = `👰 *RANKING DE PAREJAS GK* 🤵\n\n❤️ @${p1.split('@')[0]} & @${p2.split('@')[0]}\n📊 *Compatibilidad:* ${amor}%\n\n> ${amor > 70 ? '¡Se aman de verdad!' : 'Solo son amigos.'}`;
    await sock.sendMessage(jid, { text: txt, mentions: [p1, p2] });
}

if (command === '.meme' || command === '.joke') {
    const chistes = [
        "— ¿Qué hace una abeja en el gimnasio?\n— ¡Zumba!",
        "— Papá, ¿qué se siente tener un hijo tan guapo?\n— No sé hijo, pregúntale a tu abuelo.",
        "Había una vez un perro que se llamaba pegamento, se cayó y se pegó."
    ];
    await sock.sendMessage(jid, { text: `🤡 *Gonx!ta Bot HUMOR:* \n\n${chistes[Math.floor(Math.random() * chistes.length)]}` });
}

if (command === '.ruleta') {
    const bala = Math.floor(Math.random() * 6); 
    if (bala === 0) {
        await sock.sendMessage(jid, { text: '😵 *¡BANG!* Te has eliminado (metafóricamente).' });
        db.users[sender].monedas -= 50;
        saveDB();
    } else {
        await sock.sendMessage(jid, { text: '😌 *CLIC...* Te has salvado de milagro.' });
    }
}
if (command === '.perfildos' || command === '.estadisticas') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate con .reg' });
    const u = db.users[sender];
    
    let rango = u.nivel > 10 ? '⚔️ Guerrero Gonx!ta Bot' : u.nivel > 5 ? '🛡️ Recluta' : '👶 Novato';
    
    const stats = `👤 *PERFIL DETALLADO* 👤
───────────────
🏅 *Rango:* ${rango}
📊 *Nivel:* ${u.nivel}
✨ *XP:* ${u.xp}/100
💰 *Cartera:* ${u.monedas} monedas
🎖️ *Logros:* ${u.logros?.length || 0}
🎯 *Misiones:* ${u.misionesCompletadas || 0}
───────────────
>  Kill Bot 2026*`;

    await sock.sendMessage(jid, { text: stats });
    return;
}
if (command === '.logros') {
    if (!db.users[sender]) return;
    const u = db.users[sender];
    if (!u.logros) u.logros = [];

    if (u.monedas >= 1000 && !u.logros.includes('💰 Millonario')) u.logros.push('💰 Millonario');
    if (u.nivel >= 10 && !u.logros.includes('🔥 Leyenda')) u.logros.push('🔥 Leyenda');
    saveDB();

    let lista = u.logros.length > 0 ? u.logros.map(l => `• ${l}`).join('\n') : 'Aún no tienes logros.';
    await sock.sendMessage(jid, { text: `🎖️ *TUS LOGROS Gonx!ta Bot*\n\n${lista}` });
}

if (command === '.mision') {
    if (!db.users[sender]) return;
    const hoy = new Date().toLocaleDateString();
    
    if (db.users[sender].ultimaMision === hoy) {
        return await sock.sendMessage(jid, { text: '🎯 Ya completaste tu misión de hoy. Vuelve mañana.' });
    }

    db.users[sender].monedas += 200;
    db.users[sender].misionesCompletadas = (db.users[sender].misionesCompletadas || 0) + 1;
    db.users[sender].ultimaMision = hoy;
    saveDB();

    await sock.sendMessage(jid, { text: '🎯 *MISIÓN CUMPLIDA*\n\nHas entrenado con el clan hoy.\n🎁 *Recompensa:* 200 monedas y +1 en estadísticas.' });
}
if (command === '.bolsa') {
    let monto = parseInt(args[0]);
    if (isNaN(monto) || monto <= 0) return await sock.sendMessage(jid, { text: '⚠️ Uso: .bolsa (monto)' });
    if (db.users[sender].monedas < monto) return await sock.sendMessage(jid, { text: '❌ No tienes suficientes monedas.' });

    const exito = Math.random() > 0.5; 
    const multiplicador = (Math.random() * 2).toFixed(2);
    
    if (exito) {
        let ganancia = Math.floor(monto * multiplicador);
        db.users[sender].monedas += ganancia;
        await sock.sendMessage(jid, { text: `📈 *¡LA BOLSA SUBIÓ!*\n\nTu inversión creció x${multiplicador}.\n💰 Ganaste: ${ganancia} monedas.` });
    } else {
        db.users[sender].monedas -= monto;
        await sock.sendMessage(jid, { text: `📉 *¡CRASH BURSÁTIL!*\n\nEl mercado cayó y perdiste tu inversión de ${monto} monedas.` });
    }
    saveDB();
}
if (command === '.dar') {
    if (!isOwner(sender)) return; 
    let user = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    let monto = parseInt(args[1]); 
    
    if (user && monto) {
        if (!db.users[user]) db.users[user] = { monedas: 0, nivel: 1, xp: 0 };
        db.users[user].monedas += monto;
        registrarTransaccion('admin', sender, user, monto, 'Monedas otorgadas por admin');
        saveDB();
        await sock.sendMessage(jid, { text: `👑 Se han asignado ${monto} monedas a @${user.split('@')[0]}`, mentions: [user] });
    }
}

if (command === '.banco') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate con .reg' });
    
    let accion = args[0]?.toLowerCase();
    let monto = parseInt(args[1]);
    
    if (!db.users[sender].banco) db.users[sender].banco = 0;
    
    if (accion === 'guardar') {
        if (isNaN(monto) || monto <= 0) return await sock.sendMessage(jid, { text: '⚠️ Uso: .banco guardar (monto)' });
        if (db.users[sender].monedas < monto) return await sock.sendMessage(jid, { text: '❌ No tienes suficientes monedas.' });
        
        db.users[sender].monedas -= monto;
        db.users[sender].banco += monto;
        saveDB();
        await sock.sendMessage(jid, { text: `🏦 Guardaste ${monto} monedas en el banco.\n💰 Cartera: ${db.users[sender].monedas}\n🏦 Banco: ${db.users[sender].banco}` });
    } else if (accion === 'retirar') {
        if (isNaN(monto) || monto <= 0) return await sock.sendMessage(jid, { text: '⚠️ Uso: .banco retirar (monto)' });
        if (db.users[sender].banco < monto) return await sock.sendMessage(jid, { text: '❌ No tienes suficiente en el banco.' });
        
        db.users[sender].banco -= monto;
        db.users[sender].monedas += monto;
        saveDB();
        await sock.sendMessage(jid, { text: `💸 Retiraste ${monto} monedas del banco.\n💰 Cartera: ${db.users[sender].monedas}\n🏦 Banco: ${db.users[sender].banco}` });
    } else {
        const banco = db.users[sender].banco || 0;
        await sock.sendMessage(jid, { text: `🏦 *TU BANCO*\n💰 Cartera: ${db.users[sender].monedas}\n🏦 Banco: ${banco}` });
    }
}

if (command === '.interes') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate con .reg' });
    
    const banco = db.users[sender].banco || 0;
    if (banco < 100) return await sock.sendMessage(jid, { text: '❌ Necesitas mínimo 100 monedas en el banco.' });
    
    const interes = Math.floor(banco * 0.05); 
    db.users[sender].banco += interes;
    saveDB();
    await sock.sendMessage(jid, { text: `📈 Ganaste ${interes} monedas de interés.\n🏦 Banco actual: ${db.users[sender].banco}` });
}

if (command === '.prestamo') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate con .reg' });
    
    let monto = parseInt(args[0]);
    if (isNaN(monto) || monto <= 0) return await sock.sendMessage(jid, { text: '⚠️ Uso: .prestamo (monto)' });
    if (monto > 5000) return await sock.sendMessage(jid, { text: '❌ Máximo préstamo: 5000 monedas.' });
    
    if (!db.users[sender].prestamo) db.users[sender].prestamo = 0;
    if (db.users[sender].prestamo > 0) return await sock.sendMessage(jid, { text: '❌ Ya tienes un préstamo activo.' });
    
    db.users[sender].monedas += monto;
    db.users[sender].prestamo = Math.floor(monto * 1.1); 
    saveDB();
    await sock.sendMessage(jid, { text: `💳 Préstamo de ${monto} monedas aprobado.\n⚠️ Deberás pagar ${db.users[sender].prestamo} monedas.\n📌 Usa .pagar para devolver.` });
}

if (command === '.pagar') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate con .reg' });
    if (!db.users[sender].prestamo || db.users[sender].prestamo <= 0) return await sock.sendMessage(jid, { text: '❌ No tienes préstamos pendientes.' });
    
    const deuda = db.users[sender].prestamo;
    if (db.users[sender].monedas < deuda) return await sock.sendMessage(jid, { text: `❌ Necesitas ${deuda} monedas para pagar el préstamo.` });
    
    db.users[sender].monedas -= deuda;
    db.users[sender].prestamo = 0;
    saveDB();
    await sock.sendMessage(jid, { text: `✅ Pagaste ${deuda} monedas del préstamo.\n💰 Cartera: ${db.users[sender].monedas}` });
}

if (command === '.trabajo_especial') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate con .reg' });
    
    const cooldown = 1800000; 
    if (!db.users[sender].ultimoEspecial) db.users[sender].ultimoEspecial = 0;
    
    if (Date.now() - db.users[sender].ultimoEspecial < cooldown) {
        const espera = Math.ceil((cooldown - (Date.now() - db.users[sender].ultimoEspecial)) / 60000);
        return await sock.sendMessage(jid, { text: `⏳ Espera ${espera} minutos para trabajar nuevamente.` });
    }
    
    const trabajos = ['guardia', 'entrenador', 'mercader', 'cazador'];
    const trabajo = trabajos[Math.floor(Math.random() * trabajos.length)];
    const ganancias = Math.floor(Math.random() * 500) + 300;
    const xpGanado = 25;
    
    db.users[sender].monedas += ganancias;
    db.users[sender].xp += xpGanado;
    db.users[sender].ultimoEspecial = Date.now();
    
    if (db.users[sender].xp >= 100) {
        db.users[sender].nivel += 1;
        db.users[sender].xp = 0;
    }
    
    saveDB();
    await sock.sendMessage(jid, { text: `💼 Trabajaste como *${trabajo}* y ganaste *${ganancias} monedas* + ${xpGanado} XP.` });
}

if (command === '.carrera') {
    let oponente = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    if (!oponente) return await sock.sendMessage(jid, { text: '⚠️ Menciona a alguien: .carrera @usuario' });
    if (oponente === sender) return await sock.sendMessage(jid, { text: '❌ No puedes competir contigo mismo.' });
    
    const velocidad1 = Math.floor(Math.random() * 100);
    const velocidad2 = Math.floor(Math.random() * 100);
    const ganador = velocidad1 > velocidad2 ? sender : oponente;
    const premio = 100;
    
    if (!db.users[ganador]) db.users[ganador] = { monedas: 0, nivel: 1, xp: 0 };
    db.users[ganador].monedas += premio;
    saveDB();
    
    await sock.sendMessage(jid, { 
        text: `🏃 *CARRERA ÉPICA* 🏃\n\n@${sender.split('@')[0]}: ${velocidad1} km/h\n@${oponente.split('@')[0]}: ${velocidad2} km/h\n\n🏆 ¡@${ganador.split('@')[0]} ganó ${premio} monedas!`,
        mentions: [sender, oponente, ganador]
    });
}

if (command === '.ruleta_colores') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate con .reg' });
    
    let apuesta = parseInt(args[0]);
    let color = args[1]?.toLowerCase();
    
    if (isNaN(apuesta) || apuesta <= 0) return await sock.sendMessage(jid, { text: '⚠️ Uso: .ruleta_colores (monto) (rojo/negro/verde)' });
    if (!['rojo', 'negro', 'verde'].includes(color)) return await sock.sendMessage(jid, { text: '⚠️ Elige: rojo | negro | verde' });
    if (db.users[sender].monedas < apuesta) return await sock.sendMessage(jid, { text: '❌ No tienes suficientes monedas.' });
    
    const colores = ['🔴 Rojo', '⚫ Negro', '🟢 Verde'];
    const resultado = colores[Math.floor(Math.random() * colores.length)];
    const colorGanador = resultado.includes('Rojo') ? 'rojo' : resultado.includes('Negro') ? 'negro' : 'verde';
    
    let msg = `🎡 *RULETA DE COLORES*\n\n${resultado}\n`;
    
    if (color === colorGanador) {
        const ganancia = color === 'verde' ? apuesta * 10 : apuesta * 2;
        db.users[sender].monedas += ganancia;
        msg += `\n🎉 ¡Ganaste ${ganancia} monedas!`;
    } else {
        db.users[sender].monedas -= apuesta;
        msg += `\n❌ Perdiste ${apuesta} monedas.`;
    }
    
    saveDB();
    await sock.sendMessage(jid, { text: msg });
}

if (command === '.blackjack') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate con .reg' });
    
    let apuesta = parseInt(args[0]);
    if (isNaN(apuesta) || apuesta <= 0) return await sock.sendMessage(jid, { text: '⚠️ Uso: .blackjack (monto)' });
    if (db.users[sender].monedas < apuesta) return await sock.sendMessage(jid, { text: '❌ No tienes suficientes monedas.' });
    
    const tuMano = Math.floor(Math.random() * 11) + 10; 
    const botMano = Math.floor(Math.random() * 11) + 10;
    
    let resultado = `🎴 *BLACKJACK*\n\nTu mano: ${tuMano}\nBot: ${botMano}\n`;
    
    if (tuMano > 21) {
        db.users[sender].monedas -= apuesta;
        resultado += `❌ Te pasaste de 21. Perdiste ${apuesta} monedas.`;
    } else if (botMano > 21 || tuMano > botMano) {
        db.users[sender].monedas += apuesta * 2;
        resultado += `🎉 ¡Ganaste ${apuesta * 2} monedas!`;
    } else if (tuMano === botMano) {
        resultado += `🤝 Empate. Se devuelven tus monedas.`;
    } else {
        db.users[sender].monedas -= apuesta;
        resultado += `❌ Perdiste ${apuesta} monedas.`;
    }
    
    saveDB();
    await sock.sendMessage(jid, { text: resultado });
}

let trivia = {
    '¿Cuál es la capital de Francia?': 'paris',
    '¿Cuántos continentes hay?': 'cinco',
    '¿En qué año cayó el muro de Berlín?': '1989',
    '¿Cuál es el planeta más grande del sistema solar?': 'jupiter'
};

if (command === '.pregunta') {
    const preguntas = Object.keys(trivia);
    const pregunta = preguntas[Math.floor(Math.random() * preguntas.length)];
    acertijoActivo[jid] = trivia[pregunta];
    
    await sock.sendMessage(jid, { text: `❓ *PREGUNTA TRIVIA*\n\n"${pregunta}"\n\n> Responde con: *.respuesta (palabra)*` });
}

if (command === '.piropo') {
    let user = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    
    const piropos = [
        "Si la belleza fuera tiempo, serías la eternidad.",
        "Eres tan bella que hiciste que olvidara mi línea.",
        "¿Eres de azúcar? Porque eres tan dulce.",
        "Si fueras una flor, seríamos un jardín perfecto.",
        "Tu sonrisa brilla más que el sol.",
        "Eres el motivo por el que creo en la magia.",
        "Si la belleza fuera un crimen, estarías en la cárcel.",
        "¿Licencia de piloto? Porque hiciste que mi corazón despegara."
        
    ];
    
    const piropo = piropos[Math.floor(Math.random() * piropos.length)];
    
    if (user) {
        await sock.sendMessage(jid, { text: `💕 *PIROPO PARA @${user.split('@')[0]}*\n\n"${piropo}"`, mentions: [user] });
    } else {
        await sock.sendMessage(jid, { text: `💕 *UN PIROPO PARA TI*\n\n"${piropo}"` });
    }
}

if (command === '.gay') {
    let user = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
               m.message.extendedTextMessage?.contextInfo?.participant || 
               (args[0] ? args[0].replace(/\D/g, '') + '@s.whatsapp.net' : sender);

    const username = user.split('@')[0];

    
    if (isOwner(user)) {
        const mensajeOwner = ` @${username} es 100% hetero.`;
        await sock.sendMessage(jid, { text: mensajeOwner, mentions: [user] });
        return;
    }

    
    const porcentaje = Math.floor(Math.random() * 101);
    let mensaje = `🌈 @${username} es ${porcentaje}% gay.`;
    if (porcentaje === 0) mensaje += ' ¡Nivel super-hetero! 😎';
    else if (porcentaje <= 20) mensaje += ' Un toque de misterio...';
    else if (porcentaje <= 50) mensaje += ' Balance interesante.';
    else if (porcentaje <= 80) mensaje += ' ¡Aquí hay arcoíris! 🌈';
    else mensaje += ' ¡Nivel máximo de purpurina! ✨';

    await sock.sendMessage(jid, { text: mensaje, mentions: [user] });
}
if (command === '.gorda') {
    let user = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
               m.message.extendedTextMessage?.contextInfo?.participant || 
               (args[0] ? args[0].replace(/\D/g, '') + '@s.whatsapp.net' : sender);

    const username = user.split('@')[0];

    
    const porcentaje = Math.floor(Math.random() * 101);
    let mensaje = `🍔 @${username} es ${porcentaje}% gorda.`;
    if (porcentaje === 0) mensaje += ' ¡Gorda nomas esas tetas Uhmmm! 😎';
    else if (porcentaje <= 20) mensaje += ' Ni al promedio w...';
    else if (porcentaje <= 50) mensaje += ' Aparte de yucateca gorda mejor mrd.';
    else if (porcentaje <= 80) mensaje += ' La grasa vive en ti Que puto asco';
    else mensaje += ' ¡Puta kirby nmms, Suicidate xfa! 🤮';

    await sock.sendMessage(jid, { text: mensaje, mentions: [user] });
}

if (command === '.negra') {
    let user = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
               m.message.extendedTextMessage?.contextInfo?.participant || 
               (args[0] ? args[0].replace(/\D/g, '') + '@s.whatsapp.net' : sender);

    const username = user.split('@')[0];
    
    await sock.sendMessage(jid, { text: `😈 @${username} la mai tuya 🔥`, mentions: [user] });
}

if (command === '.guerra') {
    const frasesGuerra = [
        "hay guerra de clanes pirobos hpts",
        "hay guerra de clanes tetranutras butifarras",
        "hay guerra de clanes homosexual",
        "hay guerra de clanes maricas putos",
        "hay guerra de clanes tetranutras maricones",
        "hay guerra de clanes hpts butifarras",
        "hay guerra de clanes pirobos homosexuales",
        "hay guerra de clanes tetranutras hpts",
        "hay guerra de clanes butifarras maricas",
        "homosexual pirobos no piensan jugar?",
        "LOS PUNTOS NO SE SUBEN SOLOS PIROBOS GAYS",
        "EL QUE NO JUEGUE LE GUSTA YAIR",
        "pirobo gay, ¿no vas a jugar? Los puntos no suben solos!",
        "Tetranutras homosexuales, salgan a pelear!",
        "Butifarras maricas, ¿les gusta Yair o qué?",
        "Hpts pirobos, el que no juegue es gay!",
        "Maricones tetranutras, piensen jugar!",
        "Gays butifarras, los puntos se suben solos? No!",
        "Homosexual pirobos, ¿dónde están? Juguemos!",
        "Putos hpts, salgan o les gusta Yair?",
        "Tetranutras gays, no piensan subir puntos?",
        "Butifarras homosexuales, el que no juegue le gusta Yair!",
        "Pirobos maricas, salgan a la guerra!",
        "Hpts putos, los puntos no se suben solos!",
        "Maricones butifarras, ¿no van a jugar?"
    ];

    const frase = frasesGuerra[Math.floor(Math.random() * frasesGuerra.length)];

    await sock.sendMessage(jid, { text: frase, mentions: participants.map(a => a.id) });
}

if (command === '.iniciales') {
    await sock.sendMessage(jid, { text: 'ҳ̸(nombre)ㅤGonx!ta Bot' });
}

if (command === '.grupo_info') {
    if (!isGroupChat) {
        return await sock.sendMessage(jid, { text: '⚠️ Este comando solo funciona en grupos.' });
    }

    const info = await sock.groupMetadata(jid);
    const participantes = info.participants.length;
    const admins = info.participants.filter(p => p.admin).length;
    
    const infoText = `📊 *INFORMACIÓN DEL GRUPO*\n\n👥 *Participantes:* ${participantes}\n👑 *Admins:* ${admins}\n📝 *Nombre:* ${info.subject}\n🔗 *Descripción:* ${info.desc || 'Sin descripción'}`;
    
    await sock.sendMessage(jid, { text: infoText });
}

if (command === '.competencia') {
    const usuarios = Object.entries(db.users).slice(0, 5);
    let competencia = "🏆 *COMPETENCIA DE MINERÍA*\n\n";
    
    usuarios.forEach((u, i) => {
        const ganancias = Math.floor(Math.random() * 500) + 100;
        db.users[u[0]].monedas += ganancias;
        competencia += `${i + 1}. @${u[0].split('@')[0]} - ${ganancias} monedas\n`;
    });
    
    saveDB();
    await sock.sendMessage(jid, { text: competencia });
}

if (command === '.quitarme') {
    if (!db.users[sender]) db.users[sender] = { nombre: 'Usuario', monedas: 0, nivel: 1, xp: 0 };
    
    if (!db.users[sender].muteado || db.users[sender].muteado <= Date.now()) {
        return await sock.sendMessage(jid, { text: '❌ No estás muteado, no necesitas ser desmutado.' });
    }
    
    delete db.users[sender].muteado;
    saveDB();
    
    await sock.sendMessage(jid, { text: `✅ Te has removido el mute. ¡Ahora puedes hablar libremente! 🔊` });
}

if (command === '.slowmode') {
    let segundos = parseInt(args[0]) || 5;
    
    await sock.sendMessage(jid, { text: `⏱️ Modo lento activado: ${segundos} segundos entre mensajes.` });
}

if (command === '.inventario') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate con .reg' });
    
    const u = db.users[sender];
    const ahora = Date.now();
    let inventario = `📦 *TU INVENTARIO COMPLETO*\n\n`;
    let tieneContenido = false;

    if (u.herramientas && Object.keys(u.herramientas).length > 0) {
        tieneContenido = true;
        inventario += `⛏️ *HERRAMIENTAS*\n`;
        for (const [nombre, data] of Object.entries(u.herramientas)) {
            inventario += `  • ${nombre} — +${Math.round(data.bonus * 100)}%, durabilidad ${data.durabilidad}\n`;
        }
        inventario += `\n`;
    }

    if (u.defensa && Object.keys(u.defensa).length > 0) {
        tieneContenido = true;
        inventario += `🛡️ *PROTECCIONES*\n`;
        for (const [nombre, data] of Object.entries(u.defensa)) {
            if (data.activo && data.hasta > ahora) {
                const horas = Math.ceil((data.hasta - ahora) / (1000 * 60 * 60));
                inventario += `  • ${nombre} — ${horas}h restantes\n`;
            }
        }
        inventario += `\n`;
    }

    if (u.bonificaciones && Object.keys(u.bonificaciones).length > 0) {
        tieneContenido = true;
        inventario += `💎 *BONIFICACIONES*\n`;
        if (u.bonificaciones.dinero_x2 && u.bonificaciones.dinero_x2 > ahora) {
            const horas = Math.ceil((u.bonificaciones.dinero_x2 - ahora) / (1000 * 60 * 60));
            inventario += `  • Dinero x2 — ${horas}h restantes\n`;
        }
        if (u.premium?.vip?.activo && u.premium.vip.hasta > ahora) {
            const dias = Math.ceil((u.premium.vip.hasta - ahora) / (1000 * 60 * 60 * 24));
            inventario += `  • VIP Premium — ${dias}d restantes\n`;
        }
        inventario += `\n`;
    }

    if (u.items && u.items.length > 0) {
        tieneContenido = true;
        inventario += `🎁 *ITEMS ESPECIALES*\n`;
        u.items.forEach((item) => {
            const favorito = u.favoritos?.includes(item) ? ' ⭐' : '';
            inventario += `  • ${item}${favorito}\n`;
        });
        inventario += `\n`;
    }

    if (u.favoritos && u.favoritos.length > 0) {
        inventario += `💖 *FAVORITOS*\n`;
        inventario += u.favoritos.map(item => `  • ${item}`).join('\n');
        inventario += `\n\n`;
    }

    const ranking = Object.keys(db.users)
        .sort((a, b) => (db.users[b]?.monedas || 0) - (db.users[a]?.monedas || 0))
        .indexOf(sender) + 1;

    inventario += `╭─ 📊 *ESTADÍSTICAS*\n`;
    inventario += `│ 💰 Monedas: ${u.monedas || 0}\n`;
    inventario += `│ 📈 Nivel: ${u.nivel || 1}\n`;
    inventario += `│ ✨ XP: ${u.xp || 0}/100\n`;
    inventario += `│ ⚖️ Advertencias: ${u.warns || 0}/5\n`;
    inventario += `╰─ 🎯 Ranking: ${ranking}\n`;

    if (!tieneContenido) {
        inventario = `📦 *TU INVENTARIO*\n\nTu inventario está vacío.\nUsa *.tienda* para ver qué puedes comprar.`;
    }

    await sock.sendMessage(jid, { text: inventario });
}

if (command === '.favorito') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate con .reg' });
    const sub = args[0]?.toLowerCase();
    const item = args.slice(1).join(' ').trim();
    if (!sub || !item) return await sock.sendMessage(jid, { text: '⚠️ Usa: .favorito add/remove [nombre de item]' });

    if (!db.users[sender].favoritos) db.users[sender].favoritos = [];

    if (sub === 'add') {
        if (db.users[sender].favoritos.includes(item)) return await sock.sendMessage(jid, { text: '⚠️ Ya está en tus favoritos.' });
        db.users[sender].favoritos.push(item);
        saveDB();
        return await sock.sendMessage(jid, { text: `✅ "${item}" fue agregado a tus favoritos.` });
    }

    if (sub === 'remove') {
        db.users[sender].favoritos = db.users[sender].favoritos.filter(i => i !== item);
        saveDB();
        return await sock.sendMessage(jid, { text: `✅ "${item}" fue removido de tus favoritos.` });
    }

    return await sock.sendMessage(jid, { text: '⚠️ Subcomando inválido. Usa add o remove.' });
}

if (command === '.favoritos') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate con .reg' });
    const favs = db.users[sender].favoritos || [];
    if (!favs.length) {
        return await sock.sendMessage(jid, { text: '📌 No tienes favoritos aún. Usa .favorito add [item]' });
    }
    await sock.sendMessage(jid, { text: `💖 *TUS FAVORITOS*\n\n${favs.map(item => `• ${item}`).join('\n')}` });
}

if (command === '.evento') {
    const eventos = ['Lluvia de oro', 'Doble XP', 'Descuento en tienda', 'Bonus de trabajo'];
    const evento = eventos[Math.floor(Math.random() * eventos.length)];
    
    await sock.sendMessage(jid, { text: `🎊 *EVENTO ESPECIAL ACTIVADO*\n\n${evento}\n\n¡Aprovechen esta semana!` });
}

if (command === '.hazme_caso') {
    const respuestas = [
        "👀 Te estoy mirando...",
        "😒 Estoy ocupado(a).",
        "💅 Claro, te hago caso.",
        "🙄 ¿Qué quieres?",
        "😏 Depende del favor.",
        "✨ ¡Claro que sí, amor!"
    ];
    
    await sock.sendMessage(jid, { text: respuestas[Math.floor(Math.random() * respuestas.length)] });
}

if (command === '.besame') {
    const besos = [
        "😘 *Te doy un beso en la frente*",
        "💋 *Te doy un beso en la mejilla*",
        "😍 *Te doy un beso apasionado*",
        "🥰 *Te abrazo y te doy un beso*"
    ];
    
    await sock.sendMessage(jid, { text: besos[Math.floor(Math.random() * besos.length)] });
}

if (command === '.mision_diaria') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate con .reg' });
    
    const hoy = new Date().toLocaleDateString();
    
    if (db.users[sender].ultimaMisionDiaria === hoy) {
        return await sock.sendMessage(jid, { text: '🎯 Ya completaste tu misión diaria. Vuelve mañana.' });
    }
    
    const misiones = [
        { desc: 'Gana 5 partidas de PPT', premio: 250 },
        { desc: 'Llega a 500 monedas', premio: 300 },
        { desc: 'Sube 1 nivel', premio: 400 }
    ];
    
    const misionDelDia = misiones[Math.floor(Math.random() * misiones.length)];
    
    db.users[sender].monedas += misionDelDia.premio;
    db.users[sender].ultimaMisionDiaria = hoy;
    saveDB();
    
    await sock.sendMessage(jid, { text: `🎯 *MISIÓN DIARIA*\n\n📌 ${misionDelDia.desc}\n🎁 Recompensa: ${misionDelDia.premio} monedas` });
}

if (command === '.ranking') {
    const categoria = args[0]?.toLowerCase() || 'monedas';
    
    let sorted;
    if (categoria === 'nivel') {
        sorted = Object.entries(db.users).sort((a, b) => (b[1].nivel || 0) - (a[1].nivel || 0)).slice(0, 5);
    } else if (categoria === 'xp') {
        sorted = Object.entries(db.users).sort((a, b) => (b[1].xp || 0) - (a[1].xp || 0)).slice(0, 5);
    } else {
        sorted = Object.entries(db.users).sort((a, b) => (b[1].monedas || 0) - (a[1].monedas || 0)).slice(0, 5);
    }
    
    let txt = `🏆 *RANKING ${categoria.toUpperCase()}* 🏆\n\n`;
    sorted.forEach((u, i) => {
        const valor = categoria === 'nivel' ? u[1].nivel : categoria === 'xp' ? u[1].xp : u[1].monedas;
        txt += `${i + 1}. @${u[0].split('@')[0]} - ${valor}\n`;
    });
    
    await sock.sendMessage(jid, { text: txt, mentions: sorted.map(u => u[0]) });
}

if (command === '.comprar' && !['premium', 'xp'].includes(args[0]?.toLowerCase())) {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate con .reg' });
    
    const itemNum = parseInt(args[0]);
    const items = [
        { id: 1, nombre: 'Pico de Bronce', precio: 500, desc: '+25% minería', tipo: 'herramienta', bonus: 0.25 },
        { id: 2, nombre: 'Escudo Protector', precio: 800, desc: '-50% robos', tipo: 'defensa', duracion: 172800000 },
        { id: 3, nombre: 'Pico de Plata', precio: 1500, desc: '+50% minería', tipo: 'herramienta', bonus: 0.50 },
        { id: 4, nombre: 'Armadura de Hierro', precio: 2000, desc: 'Protección 24h', tipo: 'defensa', duracion: 86400000 },
        { id: 5, nombre: 'Tarjeta XP Pequeña', precio: 600, desc: '+500 XP', tipo: 'xp', cantidad: 500 },
        { id: 6, nombre: 'Tarjeta XP Mediana', precio: 1200, desc: '+1500 XP', tipo: 'xp', cantidad: 1500 },
        { id: 7, nombre: 'Pico de Oro', precio: 3500, desc: '+100% minería', tipo: 'herramienta', bonus: 1.0 },
        { id: 8, nombre: 'Nivel Instantáneo', precio: 3000, desc: '+1 nivel', tipo: 'nivel', bonus: 200 },
        { id: 9, nombre: 'Tarjeta XP Grande', precio: 2500, desc: '+5000 XP', tipo: 'xp', cantidad: 5000 },
        { id: 10, nombre: 'Monedas x2', precio: 4000, desc: 'Duplica dinero', tipo: 'multiplicador', duracion: 86400000 },
        { id: 11, nombre: 'Fortaleza Divina', precio: 5000, desc: 'Protección 7 días', tipo: 'defensa', duracion: 604800000 },
        { id: 12, nombre: 'Pase VIP Semanal', precio: 6000, desc: '+20% ganancias', tipo: 'premium', duracion: 604800000 }
    ];
    
    if (itemNum < 1 || itemNum > items.length) {
        return await sock.sendMessage(jid, { text: '⚠️ Ítem no válido (1-12). Usa .tienda para ver opciones.' });
    }
    
    const item = items[itemNum - 1];
    
    if (db.users[sender].monedas < item.precio) {
        return await sock.sendMessage(jid, { 
            text: `❌ Necesitas ${item.precio - db.users[sender].monedas} monedas más.\n💰 Tienes: ${db.users[sender].monedas}` 
        });
    }
    
    
    db.users[sender].monedas -= item.precio;
    
    
    let confirmacion = `✅ *COMPRA EXITOSA*\n\n🛍️ Producto: ${item.nombre}\n💰 Precio: ${item.precio} monedas\n`;
    
    if (item.tipo === 'herramienta') {
        if (!db.users[sender].herramientas) db.users[sender].herramientas = {};
        if (!db.users[sender].herramientas[item.nombre]) {
            db.users[sender].herramientas[item.nombre] = { bonus: item.bonus, durabilidad: 100, comprado: Date.now() };
        }
        confirmacion += `\n⛏️ Bonus minería: +${Math.round(item.bonus * 100)}%`;
    } 
    else if (item.tipo === 'defensa') {
        if (!db.users[sender].defensa) db.users[sender].defensa = {};
        db.users[sender].defensa[item.nombre] = { activo: true, hasta: Date.now() + item.duracion };
        const dias = Math.floor(item.duracion / (24 * 60 * 60 * 1000));
        confirmacion += `\n🛡️ Protección: ${dias} ${dias === 1 ? 'día' : 'días'}`;
    }
    else if (item.tipo === 'xp') {
        db.users[sender].xp += item.cantidad;
        confirmacion += `\n✨ XP ganado: +${item.cantidad}`;
    }
    else if (item.tipo === 'nivel') {
        db.users[sender].nivel += 1;
        db.users[sender].monedas += item.bonus;
        confirmacion += `\n🎯 Nivel: ${db.users[sender].nivel}\n💰 Bonus: +${item.bonus} monedas`;
    }
    else if (item.tipo === 'multiplicador') {
        if (!db.users[sender].bonificaciones) db.users[sender].bonificaciones = {};
        db.users[sender].bonificaciones.dinero_x2 = Date.now() + item.duracion;
        confirmacion += `\n💎 Dinero duplicado por 24 horas`;
    }
    else if (item.tipo === 'premium') {
        if (!db.users[sender].premium) db.users[sender].premium = {};
        db.users[sender].premium.vip = { activo: true, hasta: Date.now() + item.duracion, bonus: 0.20 };
        confirmacion += `\n👑 VIP Semanal activado (+20% ganancias)`;
    }
    
    confirmacion += `\n\n💰 Balance: ${db.users[sender].monedas} monedas`;
    
    saveDB();
    logger.info('Item comprado', { item: item.nombre, user: sender, price: item.precio });
    await sock.sendMessage(jid, { text: confirmacion });
}

if (command === '.regalar_item') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate con .reg' });
    
    let user = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    let itemNombre = args.slice(1).join(' ');
    
    if (!user || !itemNombre) return await sock.sendMessage(jid, { text: '⚠️ Uso: .regalar_item @usuario (nombre)' });
    if (!db.users[sender].items || !db.users[sender].items.includes(itemNombre)) return await sock.sendMessage(jid, { text: '❌ No tienes ese item.' });
    
    if (!db.users[user]) db.users[user] = { nombre: 'Usuario', monedas: 0, nivel: 1, xp: 0 };
    if (!db.users[user].items) db.users[user].items = [];
    
    db.users[sender].items = db.users[sender].items.filter(i => i !== itemNombre);
    db.users[user].items.push(itemNombre);
    saveDB();
    
    await sock.sendMessage(jid, { text: `🎁 Le regalaste "${itemNombre}" a @${user.split('@')[0]}`, mentions: [user] });
}

if (command === '.historial') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate con .reg' });
    
    const historial = db.users[sender].historial || [];
    const lista = historial.length > 0 ? historial.slice(-5).map(h => `• ${h}`).join('\n') : 'Sin historial.';
    
    await sock.sendMessage(jid, { text: `📋 *TU HISTORIAL*\n\n${lista}` });
}

if (command === '.resumen_dia') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate con .reg' });
    
    const u = db.users[sender];
    const resumen = `📊 *RESUMEN DEL DÍA*\n\n💰 Monedas: ${u.monedas}\n📊 Nivel: ${u.nivel}\n✨ XP: ${u.xp}/100\n🏦 Banco: ${u.banco || 0}\n🎖️ Logros: ${u.logros?.length || 0}`;
    
    await sock.sendMessage(jid, { text: resumen });
}

if (command === '.crear_clan') {
    let nombreClan = args.join(' ');
    if (!nombreClan || nombreClan.length < 3) return await sock.sendMessage(jid, { text: '⚠️ Nombre del clan muy corto.' });
    if (db.users[sender]?.clan) return await sock.sendMessage(jid, { text: '❌ Ya perteneces a un clan.' });
    
    if (!db.clanes) db.clanes = {};
    db.clanes[nombreClan] = { lider: sender, miembros: [sender], fecha: Date.now(), tesoro: 0 };
    db.users[sender].clan = nombreClan;
    saveDB();
    
    await sock.sendMessage(jid, { text: `⚔️ *CLAN CREADO*\n\n🏰 Nombre: ${nombreClan}\n👑 Líder: @${sender.split('@')[0]}\n\n¡Invita a más miembros con .invitar_clan!`, mentions: [sender] });
}

if (command === '.invitar_clan') {
    let user = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    if (!user) return await sock.sendMessage(jid, { text: '⚠️ Menciona a alguien.' });
    if (!db.users[sender]?.clan) return await sock.sendMessage(jid, { text: '❌ No estás en un clan.' });
    
    const clan = db.users[sender].clan;
    if (db.clanes[clan]?.lider !== sender) return await sock.sendMessage(jid, { text: '❌ Solo el líder puede invitar.' });
    
    if (db.users[user]?.clan) return await sock.sendMessage(jid, { text: '❌ Ya está en un clan.' });
    
    db.clanes[clan].miembros.push(user);
    db.users[user].clan = clan;
    saveDB();
    
    await sock.sendMessage(jid, { text: `✅ @${user.split('@')[0]} se unió al clan ${clan}!`, mentions: [user] });
}

if (command === '.info_clan') {
    const clan = db.users[sender]?.clan;
    if (!clan) return await sock.sendMessage(jid, { text: '❌ No estás en un clan.' });
    
    const c = db.clanes[clan];
    const miembros = c.miembros.length;
    const info = `⚔️ *${clan}*\n\n👑 Líder: @${c.lider.split('@')[0]}\n👥 Miembros: ${miembros}\n💰 Tesoro: ${c.tesoro}\n📅 Creado: ${new Date(c.fecha).toLocaleDateString()}`;
    
    await sock.sendMessage(jid, { text: info, mentions: [c.lider] });
}

if (command === '.pelear_clan') {
    let otroClan = args[0];
    const miClan = db.users[sender]?.clan;
    
    if (!miClan) return await sock.sendMessage(jid, { text: '❌ No estás en un clan.' });
    if (!db.clanes[otroClan]) return await sock.sendMessage(jid, { text: '❌ Ese clan no existe.' });
    if (miClan === otroClan) return await sock.sendMessage(jid, { text: '❌ No puedes pelear contra tu propio clan.' });
    
    const poder1 = db.clanes[miClan].miembros.length * 50;
    const poder2 = db.clanes[otroClan].miembros.length * 50;
    const ganador = poder1 > poder2 ? miClan : otroClan;
    const premio = 500;
    
    db.clanes[ganador].tesoro += premio;
    saveDB();
    
    await sock.sendMessage(jid, { text: `⚔️ *BATALLA DE CLANES*\n\n${miClan} vs ${otroClan}\n\n🏆 ¡${ganador} ganó ${premio} monedas!` });
}

if (command === '.boda') {
    let pareja = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    if (!pareja) return await sock.sendMessage(jid, { text: '⚠️ Menciona a tu pareja.' });
    
    if (!db.users[sender]) db.users[sender] = { nombre: 'Usuario', monedas: 0, nivel: 1, xp: 0 };
    if (!db.users[pareja]) db.users[pareja] = { nombre: 'Usuario', monedas: 0, nivel: 1, xp: 0 };
    
    const costo = 2000;
    if (db.users[sender].monedas < costo) return await sock.sendMessage(jid, { text: `❌ Necesitas ${costo} monedas.` });
    
    db.users[sender].monedas -= costo;
    db.users[sender].casado = pareja;
    db.users[pareja].casado = sender;
    db.users[sender].bonusPareja = 1.5;
    db.users[pareja].bonusPareja = 1.5;
    saveDB();
    
    await sock.sendMessage(jid, { text: `💍 *¡BODA ESPECIAL!*\n\n@${sender.split('@')[0]} y @${pareja.split('@')[0]} se casan!\n\n🎉 Ahora tienen 50% bonus en todas las ganancias!`, mentions: [sender, pareja] });
}

if (command === '.divorcio') {
    const pareja = db.users[sender]?.casado;
    if (!pareja) return await sock.sendMessage(jid, { text: '❌ No estás casado.' });
    
    db.users[sender].casado = null;
    db.users[sender].bonusPareja = 1;
    if (db.users[pareja]) {
        db.users[pareja].casado = null;
        db.users[pareja].bonusPareja = 1;
    }
    saveDB();
    
    await sock.sendMessage(jid, { text: '💔 Se ha anulado el matrimonio.' });
}

if (command === '.ajedrez') {
    let oponente = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    if (!oponente) return await sock.sendMessage(jid, { text: '⚠️ Menciona a un oponente.' });
    
    const resultado = Math.random() > 0.5 ? sender : oponente;
    const premio = 200;
    
    if (!db.users[resultado]) db.users[resultado] = { monedas: 0, nivel: 1, xp: 0 };
    db.users[resultado].monedas += premio;
    saveDB();
    
    await sock.sendMessage(jid, { text: `♟️ *PARTIDA DE AJEDREZ*\n\n🏆 @${resultado.split('@')[0]} ganó ${premio} monedas!`, mentions: [resultado] });
}

if (command === '.ahorcado') {
    const palabras = ['javascript', 'kenny bot', 'bot', 'programacion', 'gamer', 'discord', 'whatsapp'];
    const palabra = palabras[Math.floor(Math.random() * palabras.length)];
    const gameKey = `${jid}:${sender}`;
    const juego = createHangmanGame(palabra);
    ahorcadoJuego[gameKey] = juego;

    await sock.sendMessage(jid, {
        text: `🎮 *AHORCADO*\n\nPalabra: ${getHangmanMask(juego)}\nIntentos: ${juego.intentos}\n\nUsa: .letra <letra>`
    });
}

if (command === '.letra') {
    const gameKey = `${jid}:${sender}`;
    const juego = ahorcadoJuego[gameKey];
    if (!juego) return await sock.sendMessage(jid, { text: '⚠️ No estás jugando. Usa .ahorcado' });

    const resultado = guessHangmanLetter(juego, args[0] || '');
    if (resultado.status === 'invalid') {
        return await sock.sendMessage(jid, { text: '⚠️ Escribe una sola letra. Ejemplo: .letra a' });
    }
    if (resultado.status === 'duplicate') {
        return await sock.sendMessage(jid, { text: `Ya probaste esa letra.\nPalabra: ${getHangmanMask(juego)}\nIntentos: ${juego.intentos}` });
    }
    if (resultado.status === 'won') {
        if (!db.users[sender]) db.users[sender] = { monedas: 0, nivel: 1, xp: 0 };
        db.users[sender].monedas += 150;
        saveDB();
        delete ahorcadoJuego[gameKey];
        return await sock.sendMessage(jid, { text: `✅ ¡Ganaste! La palabra era: ${juego.palabra}\n💰 Ganaste 150 monedas.` });
    }
    if (resultado.status === 'lost') {
        delete ahorcadoJuego[gameKey];
        return await sock.sendMessage(jid, { text: `❌ Se acabaron los intentos. La palabra era: ${juego.palabra}` });
    }

    await sock.sendMessage(jid, {
        text: `${resultado.status === 'correct' ? '✅ Letra correcta.' : '❌ Esa letra no está.'}\nPalabra: ${getHangmanMask(juego)}\nIntentos: ${juego.intentos}`
    });
}

if (command === '.trivia_batalla') {
    let oponente = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    if (!oponente) return await sock.sendMessage(jid, { text: '⚠️ Menciona a un oponente.' });
    
    const preguntas = [
        { q: '¿Capital de Francia?', a: 'paris' },
        { q: '¿Planeta más grande?', a: 'jupiter' },
        { q: '¿Continentes?', a: 'cinco' }
    ];
    
    const preg = preguntas[Math.floor(Math.random() * preguntas.length)];
    const ganador = Math.random() > 0.5 ? sender : oponente;
    
    if (!db.users[ganador]) db.users[ganador] = { monedas: 0, nivel: 1, xp: 0 };
    db.users[ganador].monedas += 200;
    saveDB();
    
    await sock.sendMessage(jid, { text: `❓ *TRIVIA BATALLA*\n\nPregunta: ${preg.q}\n\n🏆 @${ganador.split('@')[0]} ganó 200 monedas!`, mentions: [ganador] });
}

if (command === '.ligas') {
    const liga = args[0]?.toLowerCase();
    
    if (!db.ligas) db.ligas = { bronce: [], plata: [], oro: [], platino: [] };
    
    if (liga === 'ver') {
        let info = '🏆 *LIGAS*\n\n';
        Object.entries(db.ligas).forEach((l, i) => {
            info += `${['🥉', '🥈', '🥇', '💎'][i]} ${l[0].toUpperCase()}: ${l[1].length} usuarios\n`;
        });
        return await sock.sendMessage(jid, { text: info });
    }
    
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    
    const userLiga = Object.keys(db.ligas).find(l => db.ligas[l].includes(sender));
    if (!userLiga) {
        db.ligas.bronce.push(sender);
        saveDB();
        return await sock.sendMessage(jid, { text: '🥉 Te uniste a la Liga Bronce!' });
    }
    
    await sock.sendMessage(jid, { text: `Ya estás en la Liga ${userLiga.toUpperCase()}` });
}

if (command === '.torneo') {
    if (!db.torneo) db.torneo = [];
    
    if (args[0] === 'unirse') {
        if (db.torneo.includes(sender)) return await sock.sendMessage(jid, { text: '❌ Ya estás inscrito.' });
        db.torneo.push(sender);
        saveDB();
        await sock.sendMessage(jid, { text: `✅ Te inscribiste al torneo!\n📊 Participantes: ${db.torneo.length}` });
    } else if (args[0] === 'iniciar' && isOwner(sender)) {
        if (db.torneo.length < 2) return await sock.sendMessage(jid, { text: '❌ Se necesitan al menos 2 participantes.' });
        
        const ganador = db.torneo[Math.floor(Math.random() * db.torneo.length)];
        if (!db.users[ganador]) db.users[ganador] = { monedas: 0, nivel: 1, xp: 0 };
        
        const premio = db.torneo.length * 500;
        db.users[ganador].monedas += premio;
        saveDB();
        
        await sock.sendMessage(jid, { text: `🏆 *TORNEO FINALIZADO*\n\n🥇 Ganador: @${ganador.split('@')[0]}\n💰 Premio: ${premio} monedas!`, mentions: [ganador] });
        db.torneo = [];
    }
}

if (command === '.royale') {
    if (!db.royale) db.royale = [];
    
    if (args[0] === 'unirse') {
        if (db.royale.includes(sender)) return await sock.sendMessage(jid, { text: '❌ Ya estás inscrito.' });
        db.royale.push(sender);
        saveDB();
        await sock.sendMessage(jid, { text: `✅ Te inscribiste a Royale!\n👥 Participantes: ${db.royale.length}` });
    } else if (args[0] === 'jugar') {
        if (db.royale.length < 2) return await sock.sendMessage(jid, { text: '❌ Se necesitan al menos 2 participantes.' });
        
        let mensaje = `⚔️ *BATTLE ROYALE* ⚔️\n\n`;
        while (db.royale.length > 1) {
            const i1 = Math.floor(Math.random() * db.royale.length);
            const i2 = Math.floor(Math.random() * db.royale.length);
            if (i1 !== i2) {
                const ganador = Math.random() > 0.5 ? i1 : i2;
                db.royale.splice(ganador > i1 && ganador > i2 ? Math.max(i1, i2) : Math.min(i1, i2), 1);
            }
        }
        
        const ganador = db.royale[0];
        if (!db.users[ganador]) db.users[ganador] = { monedas: 0, nivel: 1, xp: 0 };
        db.users[ganador].monedas += 1000;
        saveDB();
        
        mensaje += `\n🏆 Último sobreviviente: @${ganador.split('@')[0]}\n💰 Premio: 1000 monedas!`;
        db.royale = [];
        
        await sock.sendMessage(jid, { text: mensaje, mentions: [ganador] });
    }
}

if (command === '.comparar') {
    let user = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    if (!user) return await sock.sendMessage(jid, { text: '⚠️ Menciona a alguien.' });
    
    const u1 = db.users[sender] || { monedas: 0, nivel: 1, xp: 0 };
    const u2 = db.users[user] || { monedas: 0, nivel: 1, xp: 0 };
    
    const comp = `📊 *COMPARACIÓN*\n\n@${sender.split('@')[0]}:\n💰 ${u1.monedas}\n📊 Nivel ${u1.nivel}\n\nvs\n\n@${user.split('@')[0]}:\n💰 ${u2.monedas}\n📊 Nivel ${u2.nivel}`;
    
    await sock.sendMessage(jid, { text: comp, mentions: [sender, user] });
}

if (command === '.loteria') {
    let apuesta = parseInt(args[0]);
    if (isNaN(apuesta) || apuesta <= 0) return await sock.sendMessage(jid, { text: '⚠️ Uso: .loteria (monto)' });
    if (!db.users[sender]) db.users[sender] = { monedas: 0, nivel: 1, xp: 0 };
    if (db.users[sender].monedas < apuesta) return await sock.sendMessage(jid, { text: '❌ No tienes suficientes monedas.' });
    
    if (!db.jackpot) db.jackpot = 0;
    db.jackpot += apuesta;
    db.users[sender].monedas -= apuesta;
    
    const ganador = Math.random() > 0.99 ? true : false;
    
    if (ganador) {
        db.users[sender].monedas += db.jackpot;
        const premio = db.jackpot;
        db.jackpot = 0;
        saveDB();
        return await sock.sendMessage(jid, { text: `🎲 *¡JACKPOT MEGA!*\n\n@${sender.split('@')[0]} ganó ${premio} monedas!\n\n💰 Jackpot actual: 0` });
    }
    
    saveDB();
    await sock.sendMessage(jid, { text: `🎰 No ganaste esta vez.\n💰 Jackpot actual: ${db.jackpot}` });
}

if (command === '.mascota') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    
    if (args[0] === 'crear') {
        const tipos = ['perro', 'gato', 'pajaro', 'dragón'];
        const tipo = tipos[Math.floor(Math.random() * tipos.length)];
        
        db.users[sender].mascota = {
            tipo: tipo,
            energia: 100,
            hambre: 0,
            felicidad: 100
        };
        saveDB();
        
        await sock.sendMessage(jid, { text: `🐕 *MASCOTA CREADA*\n\nTipo: ${tipo}\n⚡ Energía: 100\n😊 Felicidad: 100` });
    } else if (args[0] === 'alimentar') {
        if (!db.users[sender].mascota) return await sock.sendMessage(jid, { text: '❌ No tienes mascota.' });
        
        db.users[sender].mascota.hambre = Math.max(0, db.users[sender].mascota.hambre - 20);
        db.users[sender].mascota.felicidad = Math.min(100, db.users[sender].mascota.felicidad + 10);
        saveDB();
        
        await sock.sendMessage(jid, { text: `🍖 Tu mascota ha comido!\n😊 Felicidad: ${db.users[sender].mascota.felicidad}` });
    } else if (args[0] === 'jugar') {
        if (!db.users[sender].mascota) return await sock.sendMessage(jid, { text: '❌ No tienes mascota.' });
        
        const ganancias = Math.floor(Math.random() * 100) + 50;
        db.users[sender].mascota.felicidad = Math.min(100, db.users[sender].mascota.felicidad + 20);
        db.users[sender].monedas += ganancias;
        saveDB();
        
        await sock.sendMessage(jid, { text: `🎮 Jugaste con tu mascota!\n💰 Ganaste ${ganancias} monedas\n😊 Felicidad: ${db.users[sender].mascota.felicidad}` });
    } else if (args[0] === 'ver') {
        if (!db.users[sender].mascota) return await sock.sendMessage(jid, { text: '❌ No tienes mascota.' });
        
        const m = db.users[sender].mascota;
        await sock.sendMessage(jid, { text: `🐾 *TU MASCOTA*\n\nTipo: ${m.tipo}\n⚡ Energía: ${m.energia}\n🍗 Hambre: ${m.hambre}\n😊 Felicidad: ${m.felicidad}` });
    }
}

if (command === '.efecto') {
    const efectos = ['⭐', '💫', '✨', '🌟', '💥'];
    const efecto = efectos[Math.floor(Math.random() * efectos.length)];
    
    await sock.sendMessage(jid, { text: `${efecto} *EFECTO ACTIVADO* ${efecto}` });
}

if (command === '.titulo') {
    let titulo = args.join(' ');
    if (!titulo) return await sock.sendMessage(jid, { text: '⚠️ Usa: .titulo (tu título)' });
    
    if (!db.users[sender]) db.users[sender] = { monedas: 0, nivel: 1, xp: 0 };
    db.users[sender].titulo = titulo;
    saveDB();
    
    await sock.sendMessage(jid, { text: `✨ Tu título ahora es: "${titulo}"` });
}

if (command === '.proteger') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    
    const costo = 200;
    if (db.users[sender].monedas < costo) return await sock.sendMessage(jid, { text: `❌ Necesitas ${costo} monedas.` });
    
    db.users[sender].monedas -= costo;
    db.users[sender].protegido = Date.now() + 86400000; 
    saveDB();
    
    await sock.sendMessage(jid, { text: `🛡️ Activaste protección por 24 horas.\nℹ️ No puedes ser robado durante este tiempo.` });
}

if (command === '.reporte') {
    let user = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    let razon = args.slice(1).join(' ');
    
    if (!user || !razon) return await sock.sendMessage(jid, { text: '⚠️ Uso: .reporte @usuario (razón)' });
    
    if (!db.reportes) db.reportes = [];
    db.reportes.push({ usuario: user, reporter: sender, razon: razon, fecha: new Date() });
    saveDB();
    
    await sock.sendMessage(jid, { text: `📋 Reporte enviado a los administradores.` });
}

if (command === '.insignias') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    
    const insignias = [];
    const u = db.users[sender];
    
    if (u.monedas >= 5000) insignias.push('💰 Millonario');
    if (u.nivel >= 50) insignias.push('⚔️ Guerrero Épico');
    if (u.casado) insignias.push('💍 Casado');
    if (u.clan) insignias.push('🏰 Miembro de Clan');
    
    const lista = insignias.length > 0 ? insignias.join('\n') : 'Aún no tienes insignias.';
    await sock.sendMessage(jid, { text: `🎖️ *TUS INSIGNIAS*\n\n${lista}` });
}

if (command === '.casa') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    
    if (!db.users[sender].casa) {
        db.users[sender].casa = { decoraciones: [], nivel: 1, valor: 1000 };
        saveDB();
        return await sock.sendMessage(jid, { text: `🏠 *CASA CREADA*\n\nTu primera casa está lista!\n💰 Valor: 1000 monedas` });
    }
    
    const casa = db.users[sender].casa;
    const decoraciones = casa.decoraciones.length > 0 ? casa.decoraciones.join(', ') : 'Ninguna';
    
    await sock.sendMessage(jid, { text: `🏡 *TU CASA*\n\nNivel: ${casa.nivel}\nDecoraciones: ${decoraciones}\n💰 Valor: ${casa.valor}` });
}

if (command === '.decorar') {
    if (!db.users[sender]?.casa) return await sock.sendMessage(jid, { text: '❌ Necesitas crear una casa primero.' });
    
    const decoracion = args.join(' ');
    if (!decoracion) return await sock.sendMessage(jid, { text: '⚠️ Usa: .decorar (nombre decoración)' });
    
    db.users[sender].casa.decoraciones.push(decoracion);
    db.users[sender].casa.valor += 500;
    saveDB();
    
    await sock.sendMessage(jid, { text: `✨ Agregaste "${decoracion}" a tu casa!\n💰 Nuevo valor: ${db.users[sender].casa.valor}` });
}

if (command === '.evento_temporal') {
    const eventos = [
        { nombre: 'Lluvia de Oro', bonus: 2 },
        { nombre: 'Doble XP', bonus: 2 },
        { nombre: 'Descuento Tienda', bonus: 0.5 },
        { nombre: 'Trabajo Especial', bonus: 1.5 }
    ];
    
    const e = eventos[Math.floor(Math.random() * eventos.length)];
    
    await sock.sendMessage(jid, { text: `🎊 *EVENTO TEMPORAL ACTIVADO*\n\n🎯 ${e.nombre}\n📊 Multiplicador: x${e.bonus}\n⏰ Duración: 1 hora` });
}

if (command === '.records') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    
    const u = db.users[sender];
    const records = `📊 *TUS RÉCORDS*\n\n💰 Mayor ganancia: ${u.maxGanancia || 0}\n📊 Máximo nivel alcanzado: ${u.maxNivel || u.nivel}\n🎲 Racha ganadora: ${u.racha || 0}`;
    
    await sock.sendMessage(jid, { text: records });
}

if (command === '.temporada') {
    
    const adminParticipant = participants.find(p => p.admin === 'admin' || p.admin === true);
    const locale = getLocaleFromJid(adminParticipant?.id);

    const now = new Date();
    const monthName = now.toLocaleString(locale, { month: 'long' });
    const year = now.getFullYear();

    const startOfMonth = new Date(year, now.getMonth(), 1);
    const startOfNext = new Date(year, now.getMonth() + 1, 1);
    const msPerDay = 1000 * 60 * 60 * 24;
    const progressDays = Math.floor((now - startOfMonth) / msPerDay) + 1;
    const totalDays = Math.round((startOfNext - startOfMonth) / msPerDay);
    const remaining = totalDays - progressDays;

    const leaderEntry = Object.entries(db.users).sort((a, b) => b[1].monedas - a[1].monedas)[0] || ['N/A'];
    const leaderId = leaderEntry[0].split('@')[0] || 'N/A';

    const info = `📅 *TEMPORADA ACTUAL*\n\nTemporada 1: ${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year}\n📊 Progreso: ${progressDays} días\n🏆 Líder: @${leaderId}\n\nRestablecimiento en: ${remaining} días`;
    
    await sock.sendMessage(jid, { text: info });
}

if (command === '.premium') {
    const info = `👑 *SISTEMA PREMIUM*\n\n✨ Beneficios:\n • 50% más de ganancias\n • Acceso a eventos VIP\n • Título exclusivo\n • Items premium\n • Sin publicidad\n\n💰 Precio: 5000 monedas/mes`;
    
    await sock.sendMessage(jid, { text: info });
}

if (command === '.comprar_premium' || (command === '.comprar' && args[0]?.toLowerCase() === 'premium')) {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    
    const costo = 5000;
    if (db.users[sender].monedas < costo) return await sock.sendMessage(jid, { text: `❌ Necesitas ${costo} monedas.` });
    
    db.users[sender].monedas -= costo;
    db.users[sender].premium = Date.now() + 2592000000; 
    db.users[sender].bonusMultiplicador = 1.5;
    saveDB();
    
    await sock.sendMessage(jid, { text: `👑 ¡Eres PREMIUM ahora!\n\n✨ Disfruta de todos los beneficios exclusivos durante 30 días.` });
}

if (command === '.comprar_xp' || (command === '.comprar' && args[0]?.toLowerCase() === 'xp')) {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    
    const cantidad = parseInt(args[args[0]?.toLowerCase() === 'xp' ? 1 : 0]) || 500;
    
    const tarifas = {
        500: 500,
        1000: 900,
        1500: 1200,
        5000: 2500,
        10000: 4500
    };
    
    if (!tarifas[cantidad]) {
        const opciones = Object.keys(tarifas).join(', ');
        return await sock.sendMessage(jid, { 
            text: `⚠️ XP disponibles: ${opciones}\n\nEjemplo: *.comprar_xp 1000*` 
        });
    }
    
    const costo = tarifas[cantidad];
    
    if (db.users[sender].monedas < costo) {
        const falta = costo - db.users[sender].monedas;
        return await sock.sendMessage(jid, { 
            text: `❌ Necesitas ${falta} monedas más.\n💰 Tienes: ${db.users[sender].monedas}/${costo}` 
        });
    }
    
    db.users[sender].monedas -= costo;
    db.users[sender].xp += cantidad;
    
    
    let nivelAntes = db.users[sender].nivel;
    while (db.users[sender].xp >= 100) {
        db.users[sender].xp -= 100;
        db.users[sender].nivel += 1;
    }
    let nivelDespues = db.users[sender].nivel;
    let subioNivel = nivelDespues > nivelAntes;
    
    saveDB();
    
    let confirmacion = `✅ *COMPRA DE XP EXITOSA*\n\n`;
    confirmacion += `✨ XP comprado: +${cantidad}\n`;
    confirmacion += `💰 Costo: ${costo} monedas\n`;
    confirmacion += `📊 XP total: ${db.users[sender].xp}/100\n`;
    confirmacion += `💳 Balance: ${db.users[sender].monedas} monedas`;
    
    if (subioNivel) {
        confirmacion += `\n\n🎉 *¡SUBISTE DE NIVEL!*\n🎯 Nuevo nivel: ${nivelDespues}`;
    }
    
    logger.info('XP comprado', { cantidad, costo, user: sender, nivel: nivelDespues });
    await sock.sendMessage(jid, { text: confirmacion });
}

if (command === '.batalla_jefe') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    
    const jefes = [
        { nombre: 'Dragón de Fuego', dano: 50, premio: 2000 },
        { nombre: 'Kraken del Abismo', dano: 60, premio: 2500 },
        { nombre: 'Rey Oscuro', dano: 70, premio: 3000 }
    ];
    
    const jefe = jefes[Math.floor(Math.random() * jefes.length)];
    const vidaJugador = db.users[sender].nivel * 10;
    const vidaJefe = 100;
    
    const ganador = vidaJugador > vidaJefe ? 'Tu' : 'El jefe';
    
    if (ganador === 'Tu') {
        db.users[sender].monedas += jefe.premio;
        db.users[sender].xp += 50;
        saveDB();
        return await sock.sendMessage(jid, { text: `⚔️ *BATALLA CONTRA JEFE*\n\n${jefe.nombre}\n\n🏆 ¡Ganaste!\n💰 Recompensa: ${jefe.premio} monedas + 50 XP` });
    } else {
        return await sock.sendMessage(jid, { text: `⚔️ *BATALLA CONTRA JEFE*\n\n${jefe.nombre}\n\n❌ Perdiste. Intenta más tarde.` });
    }
}

if (command === '.regalo_sorpresa') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    
    const cooldown = 86400000; 
    if (!db.users[sender].ultimoRegalo) db.users[sender].ultimoRegalo = 0;
    
    if (Date.now() - db.users[sender].ultimoRegalo < cooldown) {
        return await sock.sendMessage(jid, { text: '⏳ Vuelve mañana para tu regalo sorpresa.' });
    }
    
    const regalos = [
        { item: 'Cofre de Oro', valor: 500 },
        { item: 'Poción de Fuerza', valor: 300 },
        { item: 'Gema Rara', valor: 1000 }
    ];
    
    const regalo = regalos[Math.floor(Math.random() * regalos.length)];
    db.users[sender].monedas += regalo.valor;
    db.users[sender].ultimoRegalo = Date.now();
    saveDB();
    
    await sock.sendMessage(jid, { text: `🎁 *REGALO SORPRESA*\n\n${regalo.item}\n💰 Valor: ${regalo.valor} monedas` });
}

if (command === '.gemas') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    
    if (!db.users[sender].gemas) db.users[sender].gemas = 0;
    
    const gemas = db.users[sender].gemas;
    const monedas = db.users[sender].monedas;
    
    await sock.sendMessage(jid, { text: `💎 *TUS GEMAS PREMIUM*\n\n💰 Monedas: ${monedas}\n💎 Gemas: ${gemas}\n\n> Las gemas no pueden ser robadas ni perdidas.` });
}

if (command === '.comprar_gemas') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    
    let cantidad = parseInt(args[0]);
    if (isNaN(cantidad) || cantidad <= 0) return await sock.sendMessage(jid, { text: '⚠️ Uso: .comprar_gemas (cantidad)' });
    
    const costo = cantidad * 100; 
    if (db.users[sender].monedas < costo) return await sock.sendMessage(jid, { text: `❌ Necesitas ${costo} monedas.` });
    
    if (!db.users[sender].gemas) db.users[sender].gemas = 0;
    
    db.users[sender].monedas -= costo;
    db.users[sender].gemas += cantidad;
    saveDB();
    
    await sock.sendMessage(jid, { text: `💎 Compraste ${cantidad} gemas por ${costo} monedas!\n💎 Gemas totales: ${db.users[sender].gemas}` });
}

let ultimoComando = {};

if (true) { 
    const ahora = Date.now();
    if (!ultimoComando[sender]) ultimoComando[sender] = 0;
    
    if (ahora - ultimoComando[sender] < 1000) { 
        return await sock.sendMessage(jid, { text: '⏱️ Espera un poco antes de usar otro comando.' });
    }
    ultimoComando[sender] = ahora;
}

if (command === '.antibot') {
    if (!isOwner(sender)) return;
    
    if (!db.antibot) db.antibot = true;
    
    db.antibot = !db.antibot;
    saveDB();
    
    await sock.sendMessage(jid, { text: `🤖 Anti-bot: ${db.antibot ? '✅ ACTIVADO' : '❌ DESACTIVADO'}` });
}

if (command === '.ship') {
    if (!isGroupChat) {
        return await sock.sendMessage(jid, { text: '⚠️ Este comando solo funciona en grupos.' });
    }

    const groupMetadata = await sock.groupMetadata(jid);
    const participants = groupMetadata.participants.map(p => p.id);
    
    const shuffled = participants.sort(() => 0.5 - Math.random());
    const user1 = shuffled[0];
    const user2 = shuffled[1];
    
    const nombre1 = user1.split('@')[0];
    const nombre2 = user2.split('@')[0];
    
    const porcentaje = Math.floor(Math.random() * 21) * 5;
    
    let romanticidad = '';
    if (porcentaje <= 20) romanticidad = '💔 No tienen química, mejor amigos';
    else if (porcentaje <= 40) romanticidad = '😐 Podrían ser amigos, nada más';
    else if (porcentaje <= 60) romanticidad = '❤️ Hay un poco de atracción';
    else if (porcentaje <= 80) romanticidad = '💕 ¡Muy compatibles, posible pareja!';
    else romanticidad = '🔥 ¡PAREJA PERFECTA, amor eterno!';
    
    let ship = `💘 *SHIP ROMÁNTICO* 💘\n\n👤 @${nombre1} + 👤 @${nombre2}\n\n❤️ Compatibilidad: ${porcentaje}%\n\n${romanticidad}`;
    
    if (Math.random() < 0.1) {
        const user3 = shuffled[2];
        const nombre3 = user3.split('@')[0];
        ship += `\n\n🌈 ¡Y con @${nombre3} podrían formar un poliamor perfecto!`;
        await sock.sendMessage(jid, { text: ship, mentions: [user1, user2, user3] });
    } else {
        await sock.sendMessage(jid, { text: ship, mentions: [user1, user2] });
    }
}

if (command === '.love') {
    let user1 = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
    let user2 = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[1];
    
    if (!user2) {
        return await sock.sendMessage(jid, { text: '⚠️ Uso: .love @usuario1 @usuario2\n\n💌 Calcula la compatibilidad amorosa entre dos personas' });
    }
    
    const nombre1 = user1.split('@')[0];
    const nombre2 = user2.split('@')[0];
    
    const porcentaje = Math.floor(Math.random() * 21) * 5;
    
    let amorFrase = '';
    if (porcentaje <= 20) amorFrase = '💔 Su amor es como una chispa apagada, mejor amigos';
    else if (porcentaje <= 40) amorFrase = '😐 Hay cariño, pero no pasión ardiente';
    else if (porcentaje <= 60) amorFrase = '❤️ Se quieren, pero falta intensidad';
    else if (porcentaje <= 80) amorFrase = '💕 ¡Amor verdadero, podrían ser felices juntos!';
    else amorFrase = '🔥 ¡Amor eterno, almas gemelas para siempre!';
    
    const love = `💌 *COMPATIBILIDAD AMOROSA* 💌\n\n👤 @${nombre1} ❤️ 👤 @${nombre2}\n\n💖 Nivel de Amor: ${porcentaje}%\n\n${amorFrase}`;
    
    await sock.sendMessage(jid, { text: love, mentions: [user1, user2] });
}

if (command === '.quest') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    
    if (!db.users[sender].quest) {
        db.users[sender].quest = {
            actual: 1,
            progreso: 0,
            completadas: 0,
            recompensa: 500
        };
    }
    
    const quest = db.users[sender].quest;
    const questDesc = [
        'Gana 10 duelos',
        'Obtén 5000 monedas',
        'Sube al nivel 20',
        'Juega 50 juegos de PPT',
        'Crea un clan y agrega 3 miembros'
    ];
    
    const desc = questDesc[quest.actual - 1] || 'Todas las quests completadas!';
    
    await sock.sendMessage(jid, { text: `🎯 *QUEST ACTUAL*\n\n${desc}\nProgreso: ${quest.progreso}%\nRecompensa: ${quest.recompensa} monedas` });
}

if (command === '.pociones') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    
    if (!db.users[sender].pociones) db.users[sender].pociones = {};
    
    const pociones = `🧪 *TUS POCIONES*\n\n💪 Fuerza: ${db.users[sender].pociones.fuerza || 0}\n🛡️ Defensa: ${db.users[sender].pociones.defensa || 0}\n⚡ Velocidad: ${db.users[sender].pociones.velocidad || 0}\n\n> Usa: .usar_pocion (tipo)`;
    
    await sock.sendMessage(jid, { text: pociones });
}

if (command === '.usar_pocion') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    
    const tipo = args[0]?.toLowerCase();
    if (!['fuerza', 'defensa', 'velocidad'].includes(tipo)) return await sock.sendMessage(jid, { text: '⚠️ Tipo: fuerza | defensa | velocidad' });
    
    if (!db.users[sender].pociones || db.users[sender].pociones[tipo] <= 0) {
        return await sock.sendMessage(jid, { text: '❌ No tienes esa poción.' });
    }
    
    db.users[sender].pociones[tipo]--;
    db.users[sender].buffs = { tipo: tipo, duracion: 3600000 }; 
    saveDB();
    
    await sock.sendMessage(jid, { text: `✨ Usaste poción de ${tipo}!\n⏱️ Dura 1 hora.` });
}

if (command === '.tienda_premium') {
    const tiendaRotativa = `🛒 *TIENDA PREMIUM SEMANAL*\n\n⭐ BÁSICO:\n1. Poción Mágica - 300 monedas\n2. Llave Antigua - 500 monedas\n\n💎 PREMIUM:\n3. Escudo Legendario - 2000 monedas\n4. Alas de Ángel - 3000 monedas\n\n👑 LEGENDARIO:\n5. Corona de Oro - 10000 monedas\n6. Capa Infinita - 15000 monedas\n\n⏰ Oferta especial: 20% descuento en todos`;
    
    await sock.sendMessage(jid, { text: tiendaRotativa });
}

if (command === '.flip') {
    const resultado = Math.random() > 0.5 ? 'CARA' : 'CRUZ';
    const apuesta = parseInt(args[0]) || 50;
    
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    
    const ganas = Math.random() > 0.5;
    if (ganas) {
        db.users[sender].monedas += apuesta;
        return await sock.sendMessage(jid, { text: `🪙 ${resultado}\n✅ ¡Ganaste ${apuesta} monedas!` });
    } else {
        db.users[sender].monedas -= apuesta;
        return await sock.sendMessage(jid, { text: `🪙 ${resultado}\n❌ Perdiste ${apuesta} monedas.` });
    }
}

if (command === '.lucky') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    
    const numero = Math.floor(Math.random() * 100) + 1;
    const premio = numero * 10;
    
    db.users[sender].monedas += premio;
    saveDB();
    
    await sock.sendMessage(jid, { text: `🍀 *NÚMERO DE LA SUERTE*\n\n🎰 Número: ${numero}\n💰 Premio: ${premio} monedas!` });
}

if (command === '.spin') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    
    const items = ['🎁', '💎', '💰', '⭐', '👑', '🎊'];
    const resultado = items[Math.floor(Math.random() * items.length)];
    
    await sock.sendMessage(jid, { text: `🎡 *RULETA RÁPIDA*\n\n${resultado}` });
}

if (command === '.evento_global') {
    const eventos = [
        { nombre: 'Lluvia de Monedas', meta: 100000, premio: 5000 },
        { nombre: 'Maratón de XP', meta: 500, premio: 3000 },
        { nombre: 'Búsqueda de Tesoro', meta: 50, premio: 2000 }
    ];
    
    const evento = eventos[Math.floor(Math.random() * eventos.length)];
    
    if (!db.eventoGlobal) db.eventoGlobal = evento;
    
    await sock.sendMessage(jid, { text: `🌍 *EVENTO GLOBAL ACTIVO*\n\n🎯 ${evento.nombre}\n📊 Meta: ${evento.meta}\n🎁 Recompensa: ${evento.premio} monedas (para todos)` });
}

if (command === '.raid') {
    if (!db.raid) db.raid = { participantes: [], jefe: null, vida: 500, turno: 0 };
    
    if (args[0] === 'unirse') {
        if (db.raid.participantes.includes(sender)) return await sock.sendMessage(jid, { text: '❌ Ya estás en el raid.' });
        
        db.raid.participantes.push(sender);
        saveDB();
        
        await sock.sendMessage(jid, { text: `⚔️ *RAID COOPERATIVO*\n\n👥 Participantes: ${db.raid.participantes.length}\n❤️ Vida del jefe: ${db.raid.vida}\n\n⚠️ Se necesitan 5 participantes para empezar.` });
    } else if (args[0] === 'atacar') {
        if (!db.raid.participantes.includes(sender)) return await sock.sendMessage(jid, { text: '❌ No estás en el raid.' });
        
        const dano = Math.floor(Math.random() * 50) + 30;
        db.raid.vida -= dano;
        
        if (db.raid.vida <= 0) {
            const premio = 1000 * db.raid.participantes.length;
            db.raid.participantes.forEach(p => {
                if (db.users[p]) db.users[p].monedas += premio;
            });
            await sock.sendMessage(jid, { text: `🎉 *RAID COMPLETADO*\n\n🏆 ¡Todos ganaron ${premio} monedas!` });
            db.raid = { participantes: [], jefe: null, vida: 500 };
        } else {
            await sock.sendMessage(jid, { text: `⚔️ Hiciste ${dano} de daño!\n❤️ Vida restante: ${db.raid.vida}` });
        }
        saveDB();
    }
}

if (command === '.crear_pin') {
    let pin = args[0];
    if (!pin || pin.length !== 4) return await sock.sendMessage(jid, { text: '⚠️ El PIN debe tener 4 dígitos.' });
    if (!db.users[sender]) db.users[sender] = { monedas: 0, nivel: 1, xp: 0 };
    
    db.users[sender].pin = pin;
    saveDB();
    
    await sock.sendMessage(jid, { text: '🔐 PIN creado exitosamente. Úsalo para transacciones sensibles.' });
}

if (command === '.verificar_pin') {
    let pin = args[0];
    if (!db.users[sender]?.pin) return await sock.sendMessage(jid, { text: '❌ No tienes PIN configurado.' });
    
    if (db.users[sender].pin === pin) {
        db.users[sender].pinVerificado = Date.now() + 600000; 
        saveDB();
        return await sock.sendMessage(jid, { text: '✅ PIN verificado. Puedes hacer transacciones seguras.' });
    } else {
        return await sock.sendMessage(jid, { text: '❌ PIN incorrecto.' });
    }
}

if (command === '.pin') {
    const user = db.users[sender];
    if (!user?.pin) {
        return await sock.sendMessage(jid, { text: '🔐 No tienes un PIN configurado. Usa .crear_pin XXXX para crear uno.' });
    }

    const verificado = user.pinVerificado && user.pinVerificado > Date.now();
    const tiempoRestante = verificado ? Math.ceil((user.pinVerificado - Date.now()) / 60000) : 0;
    return await sock.sendMessage(jid, {
        text: `🔐 *ESTADO DE TU PIN*\n\n✅ PIN configurado: sí\n🛡️ Estado: ${verificado ? `verificado (${tiempoRestante} min restantes)` : 'pendiente de verificación'}\n\n🔒 Por seguridad, el número del PIN nunca se muestra.`
    });
}

if (command === '.logros_especiales') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    
    const u = db.users[sender];
    let logrosEspeciales = [];
    
    if (u.monedas >= 1000) logrosEspeciales.push('💰 1K Monedas');
    if (u.monedas >= 10000) logrosEspeciales.push('💎 10K Monedas');
    if (u.monedas >= 100000) logrosEspeciales.push('👑 100K Monedas');
    if (u.nivel >= 50) logrosEspeciales.push('🔥 Nivel 50');
    if (u.nivel >= 100) logrosEspeciales.push('⚔️ Nivel 100');
    if (u.casado) logrosEspeciales.push('💍 Casado');
    if (u.clan) logrosEspeciales.push('🏰 En un Clan');
    if (u.prestigio > 0) logrosEspeciales.push(`👑 Prestigio ${u.prestigio}`);
    
    const lista = logrosEspeciales.length > 0 ? logrosEspeciales.join('\n') : 'Aún no tienes logros especiales.';
    
    await sock.sendMessage(jid, { text: `🎖️ *LOGROS ESPECIALES*\n\n${lista}` });
}

if (command === '.tutorial') {
    const tutorial = `📚 *TUTORIAL Gonx!ta Bot*\n\n1️⃣ *INICIO:* Usa .reg para registrarte\n2️⃣ *DINERO:* Trabaja con .minar .pescar .trabajar\n3️⃣ *NIVEL:* Gana XP completando trabajos\n4️⃣ *JUEGOS:* Juega .ppt .tragamonedas .blackjack\n5️⃣ *CLAN:* Crea uno con .crear_clan\n6️⃣ *PAREJA:* Cásate con .boda\n7️⃣ *PREMIUM:* Compra con .comprar_premium\n8️⃣ *PRESTIGIO:* Alcanza nivel 100 y usa .prestigio\n\n📖 Más info: .menu o .bot`;
    
    await sock.sendMessage(jid, { text: tutorial });
}
if (command === '.free') {
                if (!isAdmin) return await sock.sendMessage(jid, { text: '❌ Este comando solo puede ser usado por administradores.' });
                const audioPath = './Audios/Freeseñal.mp3'; 

                if (fs.existsSync(audioPath)) {
                    await sock.sendMessage(jid, {
                        audio: { url: audioPath },
                        mimetype: 'audio/mp4',
                        ptt: true
                    }, { quoted: m });
                } else {
                    await sock.sendMessage(jid, { text: '⚠️ No encuentro el archivo "Freeseñal.mp3".' });
                }
            }
if (command === '.ayuda') {
    const tema = args[0]?.toLowerCase();
    
    const ayudas = {
        'dinero': '💰 Usa .banco .prestamo .interes para gestionar dinero',
        'trabajos': '⛏️ .minar .pescar .trabajar .trabajo_especial',
        'juegos': '🎮 .ppt .tragamonedas .blackjack .ruleta',
        'clan': '🏰 .crear_clan .invitar_clan .info_clan .pelear_clan',
        'pareja': '💑 .novio .novia .boda .divorcio',
        'seguridad': '🔐 .crear_pin .verificar_pin .proteger',
        'premium': '👑 .premium .comprar_premium .prestigio'
    };
    
    if (!tema || !ayudas[tema]) {
        return await sock.sendMessage(jid, { text: `⚠️ Temas: ${Object.keys(ayudas).join(' | ')}` });
    }
    
    await sock.sendMessage(jid, { text: `ℹ️ *AYUDA: ${tema.toUpperCase()}*\n\n${ayudas[tema]}` });
}

if (command === '.tips') {
    const tips = [
        '💡 Protege tus monedas con .proteger',
        '💡 Invierte en el banco para ganar interés',
        '💡 Las gemas no pueden ser robadas',
        '💡 Completa quests para bonificación',
        '💡 Cásate para obtener 50% bonus',
        '💡 Prestigia en nivel 100 para más multiplos',
        '💡 Los eventos globales dan recompensas a todos',
        '💡 Participa en raids para ganar mucho dinero'
    ];
    
    const tip = tips[Math.floor(Math.random() * tips.length)];
    await sock.sendMessage(jid, { text: `${tip}` });
}

if (command === '.prestigio') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    if (db.users[sender].nivel < 100) return await sock.sendMessage(jid, { text: `❌ Necesitas nivel 100. Estás en nivel ${db.users[sender].nivel}` });
    
    const prestigioActual = db.users[sender].prestigio || 0;
    const multiplicador = 1 + (prestigioActual * 0.5);
    
    db.users[sender].prestigio = prestigioActual + 1;
    db.users[sender].nivel = 1;
    db.users[sender].xp = 0;
    db.users[sender].monedas = Math.floor(db.users[sender].monedas * 1.5);
    db.users[sender].bonusMultiplicador = multiplicador;
    saveDB();
    
    const mensaje = `👑 *¡PRESTIGIO ALCANZADO!* 👑\n\n⭐ Nivel de Prestigio: ${db.users[sender].prestigio}\n✨ Multiplicador: x${multiplicador.toFixed(2)}\n💰 Monedas: +50% (${db.users[sender].monedas})\n📊 Nivel: Reiniciado a 1\n\n> ¡Eres cada vez más poderoso!`;
    
    await sock.sendMessage(jid, { text: mensaje });
}


if (command === '.matadero') {
    
    try {
        if (!db.matadero) db.matadero = {};
        if (!db.matadero[jid]) db.matadero[jid] = [];

        
        if (args[0] === 'ver') {
            if (db.matadero[jid].length === 0) return await sock.sendMessage(jid, { text: '⚠️ El matadero está vacío.' });
            const listaMenciones = db.matadero[jid].map(u => `@${u.split('@')[0]}`).join(', ');
            const mensaje = `🔪 *ESTOS SON LOS QUE SE VAN A ENFRENTAR EN EL MATADERO Y SOLO LA MITAD SE VAN A QUEDAR* 🔪\n\n${listaMenciones}`;
            return await sock.sendMessage(jid, { text: mensaje, mentions: db.matadero[jid] });
        }

        
        if (args[0] === 'limpiar') {
            db.matadero[jid] = [];
            saveDB();
            return await sock.sendMessage(jid, { text: '🗑️ El matadero ha sido limpiado.' });
        }

        
        const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentioned.length > 0) {
            const agregados = [];
            for (const u of mentioned) {
                if (!db.matadero[jid].includes(u)) {
                    db.matadero[jid].push(u);
                    agregados.push(u);
                }
            }
            if (agregados.length === 0) return await sock.sendMessage(jid, { text: '⚠️ Todos los mencionados ya estaban en el matadero.' });
            saveDB();
            const lista = db.matadero[jid].map(u => `@${u.split('@')[0]}`).join(', ');
            const mensaje = `🔪 *ESTOS SON LOS QUE SE VAN A ENFRENTAR EN EL MATADERO Y SOLO LA MITAD SE VAN A QUEDAR* 🔪\n\n${lista}`;
            return await sock.sendMessage(jid, { text: mensaje, mentions: db.matadero[jid] });
        }

        
        const botId = sock.user?.id;
        const añadidos = [];
        for (const p of participants) {
            if (p.id !== botId && !db.matadero[jid].includes(p.id)) {
                db.matadero[jid].push(p.id);
                añadidos.push(p.id);
            }
        }
        if (añadidos.length === 0) return await sock.sendMessage(jid, { text: '⚠️ Todos ya estaban en el matadero.' });
        saveDB();
        const lista = db.matadero[jid].map(u => `@${u.split('@')[0]}`).join(', ');
        const mensaje = `🔪 *ESTOS SON LOS QUE SE VAN A ENFRENTAR EN EL MATADERO Y SOLO LA MITAD SE VAN A QUEDAR* 🔪\n\n${lista}`;
        return await sock.sendMessage(jid, { text: mensaje, mentions: db.matadero[jid] });
    } catch (err) {
        console.error('Error en .matadero:', err);
        return await sock.sendMessage(jid, { text: '❌ Ocurrió un error al procesar .matadero.' });
    }
}

if (command === '.mataderoquitar') {
    try {
        const user = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (!user) return await sock.sendMessage(jid, { text: '⚠️ Menciona a alguien. Uso: .mataderoquitar @usuario' });
        if (!db.matadero || !db.matadero[jid] || !db.matadero[jid].length) return await sock.sendMessage(jid, { text: '⚠️ El matadero está vacío.' });
        const idx = db.matadero[jid].indexOf(user);
        if (idx === -1) return await sock.sendMessage(jid, { text: `⚠️ @${user.split('@')[0]} no está en el matadero.`, mentions: [user] });
        db.matadero[jid].splice(idx, 1);
        saveDB();
        if (db.matadero[jid].length === 0) return await sock.sendMessage(jid, { text: '🗑️ El matadero está vacío.' });
        const lista = db.matadero[jid].map(u => `@${u.split('@')[0]}`).join(', ');
        const mensaje = `🔪 *ESTOS SON LOS QUE SE VAN A ENFRENTAR EN EL MATADERO Y SOLO LA MITAD SE VAN A QUEDAR* 🔪\n\n${lista}`;
        return await sock.sendMessage(jid, { text: mensaje, mentions: db.matadero[jid] });
    } catch (err) {
        console.error('Error en .mataderoquitar:', err);
        return await sock.sendMessage(jid, { text: '❌ Ocurrió un error al procesar .mataderoquitar.' });
    }
}




            if (command === '.agg') {
                if (!jid.endsWith('@g.us')) {
                    return await sock.sendMessage(jid, { text: '⚠️ Este comando solo funciona en grupos.' });
                }
                
                let num = args.join('').replace(/\D/g, '');
                
                if (num.length >= 8) {
                    let jidUser = num + '@s.whatsapp.net';
                    try {
                        await sock.groupParticipantsUpdate(jid, [jidUser], 'add');
                    } catch (e) {
                        console.error('Error al añadir usuario:', e.message);
                        await sock.sendMessage(jid, { text: `❌ Error: No se pudo añadir al usuario. Verifica que:\n• Gonx!ta Bot sea administrador\n• El número sea válido\n• El usuario no esté ya en el grupo` });
                    }
                } else {
                    await sock.sendMessage(jid, { text: '⚠️ Formato incorrecto. Usa: *.agg (codigo)(numero)*' });
                }
            }

if (command === '.transferir') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate con .reg' });
    
    let user = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    let monto = parseInt(args[1]);
    
    if (!user || isNaN(monto) || monto <= 0) return await sock.sendMessage(jid, { text: '⚠️ Uso: .transferir @usuario (monto)' });
    if (db.users[sender].monedas < monto) return await sock.sendMessage(jid, { text: '❌ No tienes suficientes monedas.' });
    
    db.users[sender].monedas -= monto;
    if (!db.users[user]) db.users[user] = { nombre: 'Usuario', monedas: 0, nivel: 1, xp: 0 };
    db.users[user].monedas += monto;
    
    registrarTransaccion('transferencia', sender, user, monto, 'Transferencia directa');
    saveDB();
    
    await sock.sendMessage(jid, { text: `✅ Transferencia completada\n\n💰 Enviaste: ${monto} monedas\n👤 Destinatario: @${user.split('@')[0]}\n\n📊 Tu saldo: ${db.users[sender].monedas}`, mentions: [user] });
}

if (command === '.admin') {
    if (!isOwner(sender)) return await sock.sendMessage(jid, { text: '❌ Solo los owners pueden usar este comando.' });
    
    const adminMenu = `👑 *PANEL DE ADMINISTRADOR* 👑\n\n📊 *COMANDOS DE ADMIN:*\n.antiraid (on/off) - Activar protección contra raids\n.dar @usuario (monto) - Dar monedas\n.estadisticas_grupo - Ver stats del grupo\n.historial_admin - Ver historial de transacciones\n.usuarios_totales - Cantidad de usuarios registrados\n.backup - Crear backup manual\n.limpiar_transacciones - Limpiar log de transacciones\n.reset_user @usuario - Resetear usuario\n\n🔒 *INFORMACIÓN:*\n• Backups automáticos cada hora\n• Log de transacciones: ${db.transacciones?.length || 0} registros\n• Usuarios registrados: ${Object.keys(db.users).length}\n• Anti-raid: ${db.antiraid?.activado ? '✅ ACTIVO' : '❌ INACTIVO'}`;
    
    await sock.sendMessage(jid, { text: adminMenu });
}

if (command === '.estadisticas_grupo') {
    if (!isGroupChat) {
        return await sock.sendMessage(jid, { text: '⚠️ Este comando solo funciona en grupos.' });
    }

    const groupMetadata = await sock.groupMetadata(jid);
    const totalUsers = groupMetadata.participants.length;
    const admins = groupMetadata.participants.filter(p => p.admin).length;
    const registrados = Object.keys(db.users).length;
    
    const totalMonedas = Object.values(db.users).reduce((acc, u) => acc + (u.monedas || 0), 0);
    const totalNiveles = Object.values(db.users).reduce((acc, u) => acc + (u.nivel || 0), 0);
    
    const stats = `📊 *ESTADÍSTICAS DEL GRUPO* 📊\n\n👥 Participantes: ${totalUsers}\n👑 Administradores: ${admins}\n📝 Registrados: ${registrados}\n\n💰 Monedas totales: ${totalMonedas}\n📈 Nivel promedio: ${(totalNiveles / (registrados || 1)).toFixed(2)}\n\n🏆 Top usuario:\n${Object.entries(db.users).sort((a, b) => b[1].monedas - a[1].monedas)[0] ? `@${Object.entries(db.users).sort((a, b) => b[1].monedas - a[1].monedas)[0][0].split('@')[0]}: ${Object.entries(db.users).sort((a, b) => b[1].monedas - a[1].monedas)[0][1].monedas} 💰` : 'Sin datos'}`;
    
    await sock.sendMessage(jid, { text: stats });
}

if (command === '.antiraid') {
    if (!isOwner(sender)) return await sock.sendMessage(jid, { text: '❌ Solo los owners pueden usar esto.' });
    
    const estado = args[0]?.toLowerCase();
    if (!['on', 'off'].includes(estado)) return await sock.sendMessage(jid, { text: '⚠️ Uso: .antiraid (on|off)' });
    
    if (!db.antiraid) db.antiraid = {};
    db.antiraid[jid] = estado === 'on';
    db.antiraid.activado = estado === 'on';
    saveDB();
    
    await sock.sendMessage(jid, { text: `🛡️ Anti-raid: ${estado === 'on' ? '✅ ACTIVADO' : '❌ DESACTIVADO'}\n\nEl grupo está ${estado === 'on' ? 'protegido contra floods' : 'sin protección'}` });
}

if (command === '.activar_2fa') {
    if (!db.users[sender]) return await sock.sendMessage(jid, { text: '❌ Regístrate primero.' });
    
    const codigo = Math.random().toString(36).substring(2, 8).toUpperCase();
    db.users[sender].codigo2fa = codigo;
    db.users[sender].codigo2faFecha = Date.now();
    saveDB();
    
    await sock.sendMessage(jid, { text: `🔐 *VERIFICACIÓN DE 2 FACTORES ACTIVADA*\n\n🔑 Tu código de seguridad es:\n${codigo}\n\n⚠️ Úsalo en transacciones críticas.\n⏰ Válido por 10 minutos.` });
}

if (command === '.verificar_2fa') {
    if (!db.users[sender]?.codigo2fa) return await sock.sendMessage(jid, { text: '❌ No tienes 2FA activado.' });
    
    const codigo = args[0];
    const ahora = Date.now();
    
    if (!codigo || codigo !== db.users[sender].codigo2fa) return await sock.sendMessage(jid, { text: '❌ Código incorrecto.' });
    if (ahora - db.users[sender].codigo2faFecha > 600000) return await sock.sendMessage(jid, { text: '❌ Código expirado.' });
    
    db.users[sender].verificado2fa = Date.now() + 3600000;
    saveDB();
    
    await sock.sendMessage(jid, { text: '✅ Verificación completada. Puedes realizar transacciones seguras por 1 hora.' });
}

if (command === '.historial_admin') {
    if (!isOwner(sender)) return await sock.sendMessage(jid, { text: '❌ Solo los owners pueden usar esto.' });
    
    const transacciones = db.transacciones?.slice(-10) || []; 
    if (transacciones.length === 0) return await sock.sendMessage(jid, { text: '📋 Sin transacciones registradas.' });
    
    let historial = '📋 *ÚLTIMAS 10 TRANSACCIONES*\n\n';
    transacciones.forEach((t, i) => {
        historial += `${i+1}. ${t.tipo.toUpperCase()}\n💰 ${t.monto} monedas\n👤 De: ${t.origen.split('@')[0]}\n👥 Para: ${t.destino.split('@')[0]}\n📅 ${new Date(t.fecha).toLocaleString('es-ES')}\n\n`;
    });
    
    await sock.sendMessage(jid, { text: historial });
}

if (command === '.usuarios_totales') {
    if (!isOwner(sender)) return await sock.sendMessage(jid, { text: '❌ Solo los owners pueden usar esto.' });
    
    const total = Object.keys(db.users).length;
    const activos = Object.values(db.users).filter(u => u.ultimoAcceso && Date.now() - u.ultimoAcceso < 86400000).length;
    
    await sock.sendMessage(jid, { text: `👥 *USUARIOS REGISTRADOS*\n\n📊 Total: ${total}\n✅ Activos (24h): ${activos}\n⏰ Inactivos: ${total - activos}` });
}

if (command === '.backup') {
    if (!isOwner(sender)) return await sock.sendMessage(jid, { text: '❌ Solo los owners pueden usar esto.' });
    
    try {
        const backupDir = path.join(__dirname, 'backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${backupDir}/database_${timestamp}.json`;
        dbUtils.writeAtomic(backupPath, db);
        
        await sock.sendMessage(jid, { text: `✅ Backup manual creado\n📁 Archivo: database_${timestamp}.json` });
    } catch (e) {
        await sock.sendMessage(jid, { text: `❌ Error al crear backup: ${e.message}` });
    }
}

if (command === '.limpiar_transacciones') {
    if (!isOwner(sender)) return await sock.sendMessage(jid, { text: '❌ Solo los owners pueden usar esto.' });
    
    const cantidad = db.transacciones?.length || 0;
    db.transacciones = [];
    saveDB();
    
    await sock.sendMessage(jid, { text: `🗑️ Se eliminaron ${cantidad} transacciones del historial.` });
}

if (command === '.reset_user') {
    if (!isOwner(sender)) return await sock.sendMessage(jid, { text: '❌ Solo los owners pueden usar esto.' });
    
    let user = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    if (!user) return await sock.sendMessage(jid, { text: '⚠️ Menciona al usuario a resetear.' });
    
    db.users[user] = { nombre: 'Usuario', monedas: 0, nivel: 1, xp: 0, warns: 0 };
    saveDB();
    
    await sock.sendMessage(jid, { text: `🔄 Usuario @${user.split('@')[0]} ha sido reseteado.`, mentions: [user] });
}

}

module.exports = processCommands;
