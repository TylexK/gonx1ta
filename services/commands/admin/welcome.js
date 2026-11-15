const fs = require('node:fs');
const path = require('node:path');

const MAX_WELCOME_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_WELCOME_IMAGE_CAPTION_LENGTH = 900;

function createWelcomeMessage(welcomeText, participantJid, image = null, mimetype = 'image/jpeg') {
    const mentionText = `@${participantJid.split('@')[0].split(':')[0]}`;
    const text = /\{user\}/i.test(welcomeText)
        ? welcomeText.replace(/\{user\}/gi, mentionText)
        : `${welcomeText}\n\n${mentionText}`;
    return image
        ? { image, mimetype, caption: text, mentions: [participantJid] }
        : { text, mentions: [participantJid] };
}

function getImageExtension(mimetype) {
    const extensions = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp'
    };
    return extensions[mimetype?.split(';')[0].trim().toLowerCase()] || null;
}

async function handleSetWelcomeCommand({
    jid,
    isGroupChat,
    isAdmin,
    message,
    messageText,
    unwrapViewOnceMessage,
    downloadQuotedMedia,
    ensureGroupSettings,
    saveDBImmediate,
    imageDirectory,
    sock,
    logger
}) {
    if (!isGroupChat) {
        await sock.sendMessage(jid, { text: '⚠️ Este comando solo funciona en grupos.' });
        return true;
    }
    if (!isAdmin) {
        await sock.sendMessage(jid, { text: '❌ Solo los administradores pueden configurar la bienvenida.' });
        return true;
    }

    const welcomeText = String(messageText || '').replace(/^\S+\s*/, '').trim();
    const messageContent = unwrapViewOnceMessage(message);
    const hasImage = Boolean(messageContent?.imageMessage);
    if (!welcomeText) {
        await sock.sendMessage(jid, {
            text: '⚠️ Escribe el texto después de .setwelcome. Si quieres una imagen, adjúntala en ese mismo mensaje con el comando como pie de foto.'
        });
        return true;
    }
    if (hasImage && welcomeText.length > MAX_WELCOME_IMAGE_CAPTION_LENGTH) {
        await sock.sendMessage(jid, { text: '⚠️ El texto con imagen debe tener como máximo 900 caracteres.' });
        return true;
    }

    let imagePath = null;
    let oldImagePath = null;
    let temporaryImagePath = null;
    let settings = null;
    let previousSettings = null;
    let configurationSaved = false;

    try {
        let imageName = null;
        if (hasImage) {
            const image = await downloadQuotedMedia(message, MAX_WELCOME_IMAGE_BYTES);
            const extension = getImageExtension(image?.message?.mimetype);
            if (image?.type !== 'image' || !image.data.length || !extension) {
                await sock.sendMessage(jid, { text: '❌ Adjunta una imagen JPG, PNG o WebP con el comando.' });
                return true;
            }

            fs.mkdirSync(imageDirectory, { recursive: true });
            const safeGroupId = jid.replace(/[^a-zA-Z0-9_-]/g, '_');
            imageName = `${safeGroupId}-welcome-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}${extension}`;
            imagePath = path.join(imageDirectory, imageName);
            temporaryImagePath = `${imagePath}.${Math.random().toString(36).slice(2)}.tmp`;
            fs.writeFileSync(temporaryImagePath, image.data, { flag: 'wx' });
            fs.renameSync(temporaryImagePath, imagePath);
            temporaryImagePath = null;
        }

        settings = ensureGroupSettings(jid);
        previousSettings = {
            welcomeText: settings.welcomeText,
            welcomeImage: settings.welcomeImage,
            welcomeImageMime: settings.welcomeImageMime,
            welcomeEnabled: settings.welcomeEnabled
        };
        oldImagePath = typeof settings.welcomeImage === 'string'
            ? path.join(imageDirectory, path.basename(settings.welcomeImage))
            : null;

        settings.welcomeText = welcomeText;
        settings.welcomeImage = imageName;
        settings.welcomeImageMime = imageName ? messageContent.imageMessage.mimetype : null;
        settings.welcomeEnabled = true;
        if (!saveDBImmediate()) {
            Object.assign(settings, previousSettings);
            if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
            await sock.sendMessage(jid, { text: '❌ No se pudo guardar la bienvenida. Inténtalo de nuevo.' });
            return true;
        }
        configurationSaved = true;

        if (oldImagePath && oldImagePath !== imagePath && fs.existsSync(oldImagePath)) {
            try {
                fs.unlinkSync(oldImagePath);
            } catch (error) {
                logger.warn('No se pudo borrar la imagen anterior de bienvenida', { jid, error: error.message });
            }
        }

        await sock.sendMessage(jid, {
            text: `✅ Bienvenida guardada${imageName ? ' con imagen' : ''}. Se enviará al entrar alguien nuevo. Usa {user} en el texto para mencionar a la persona.`
        });
    } catch (error) {
        if (!configurationSaved && settings && previousSettings) Object.assign(settings, previousSettings);
        if (temporaryImagePath && fs.existsSync(temporaryImagePath)) fs.unlinkSync(temporaryImagePath);
        if (!configurationSaved && imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
        logger.error('Error configurando la bienvenida', { jid, error: error.message });
        await sock.sendMessage(jid, {
            text: configurationSaved
                ? '✅ La bienvenida se guardó, pero no pude enviar la confirmación.'
                : error.message.includes('10 MB')
                ? `❌ ${error.message}`
                : '❌ No pude guardar la bienvenida. Comprueba la imagen e inténtalo otra vez.'
        });
    }

    return true;
}

module.exports = {
    MAX_WELCOME_IMAGE_BYTES,
    createWelcomeMessage,
    handleSetWelcomeCommand
};
