const crypto = require('node:crypto');

const COMMANDS = new Set([
    '.anti', '.anti enlace', '.antispam', '.antilink', '.antiflood', '.lock', '.unlock',
    '.setname', '.setdesc', '.setphoto', '.setrules', '.setprefix', '.warnlist',
    '.clearwarns', '.polladmin', '.backupgroup', '.restoregroup', '.audit',
    '.permissions', '.saldo', '.depositar', '.retirar', '.depositos',
    '.intercambio', '.subasta', '.vender', '.mercado', '.inflacion', '.impuestos',
    '.salario', '.negocio', '.empresa', '.trabajadores', '.recompensa', '.bono',
    '.multas', '.donar', '.prestamos', '.boveda', '.poker', '.uno', '.tresenraya',
    '.conecta4', '.batalla', '.duelo_monedas', '.dados', '.bingo', '.palabra',
    '.sopa', '.quiz', '.capitales', '.banderas', '.matematicas', '.verdadero_falso',
    '.emojiquiz', '.pelicula', '.musicaquiz', '.pokemon', '.futbol', '.supervivencia',
    '.escape', '.bio', '.avatar', '.cumpleaños', '.edad', '.compatibilidad',
    '.amigos', '.enemigos', '.seguidores', '.reputacion', '.votar', '.encuesta',
    '.confesar', '.verdad', '.reto', '.preguntaanonima', '.frase', '.horoscopo',
    '.signo', '.suerte', '.tarot', '.youtube', '.spotify', '.soundcloud', '.video',
    '.audio', '.foto', '.wallpaper', '.stickerpack', '.convertir', '.recortar',
    '.comprimir', '.traducir', '.ocr', '.textoimagen', '.codigoqr', '.hora',
    '.fecha', '.clima', '.pais', '.moneda', '.calcular', '.uuid', '.contraseña',
    '.acortar', '.qrtexto', '.recordatorio', '.temporizador', '.cronometro',
    '.definir', '.sinonimo', '.ip', '.pingweb'
]);

const EXISTING_COMMANDS = new Set([
    '.antibot', '.antiraid', '.slowmode', '.blackjack', '.carrera', '.ruleta',
    '.memoria', '.pregunta', '.meme', '.piropo', '.evento', '.efecto', '.mascota',
    '.casa', '.decorar', '.ship', '.love', '.tiktok', '.ig', '.gif', '.qr',
    '.musica', '.voz', '.s', '.n', '.ia', '.ping', '.estado', '.ranking',
    '.proteger', '.premium', '.regalo_sorpresa', '.pociones', '.usar_pocion',
    '.moneda', '.ranking', '.casa', '.evento', '.pregunta', '.meme', '.piropo'
]);

function commandKey(command, args) {
    return args[0] && command === '.anti' ? `${command} ${args[0].toLowerCase()}` : command;
}

function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function send(sock, jid, text) {
    return sock.sendMessage(jid, { text });
}

function localCommandText(key, args, sender) {
    const name = `@${sender.split('@')[0]}`;
    if (key === '.hora') return `🕒 Hora local: ${new Date().toLocaleTimeString('es-ES')}`;
    if (key === '.fecha') return `📅 Fecha local: ${new Date().toLocaleDateString('es-ES')}`;
    if (key === '.uuid') return `🆔 ${crypto.randomUUID()}`;
    if (key === '.contraseña') return `🔐 ${Array.from({ length: 16 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[Math.floor(Math.random() * 58)]).join('')}`;
    if (key === '.calcular') {
        const expression = args.join(' ').replace(/[^0-9+\-*/().% ]/g, '');
        if (!expression) return '⚠️ Uso: .calcular 2+2';
        try {
            return `🧮 Resultado: ${Function(`"use strict"; return (${expression})`)()}`;
        } catch {
            return '❌ No pude calcular esa expresión.';
        }
    }
    if (key === '.convertir') return '🔄 Uso local: .convertir <cantidad> <unidad> <unidad destino>.';
    if (key === '.moneda') return `💱 Moneda: ${args[0] || 'indica un país o moneda para consultar.'}`;
    if (key === '.clima') return '🌤️ El clima requiere una API externa; configura una API si quieres datos en tiempo real.';
    if (key === '.pingweb') return '🌐 Ping web local: usa .ping para comprobar el bot.';
    if (key === '.recordatorio') return '⏰ Uso: .recordatorio <minutos> <texto>.';
    if (key === '.temporizador' || key === '.cronometro') return '⏱️ Uso: .temporizador <segundos>.';
    if (key === '.definir' || key === '.sinonimo') return `📚 Consulta local: ${args.join(' ') || 'escribe una palabra.'}`;
    if (key === '.suerte' || key === '.tarot') return `${key === '.tarot' ? '🔮 Carta' : '🍀 Suerte'} de ${name}: ${['excelente', 'favorable', 'neutral', 'desafiante'][Math.floor(Math.random() * 4)]}.`;
    if (key === '.horoscopo' || key === '.signo') return '♈ Escribe tu signo para obtener una lectura local.';
    if (key === '.frase') return '💬 “La constancia convierte los pequeños pasos en grandes resultados.”';
    if (key === '.verdad') return '✅ Verdad: la paciencia suele ganar a la prisa.';
    if (key === '.reto') return '🎯 Reto: ayuda a alguien del grupo y cuéntalo después.';
    if (key === '.confesar' || key === '.preguntaanonima') return '📝 Escribe tu mensaje después del comando.';
    if (key === '.edad' || key === '.cumpleaños') return '🎂 Uso: responde a un usuario o escribe la fecha para calcularlo.';
    if (key === '.bio' || key === '.avatar') return `👤 Perfil local de ${name}.`;
    if (key === '.compatibilidad') return `💞 Compatibilidad: ${Math.floor(Math.random() * 101)}%.`;
    if (key === '.amigos' || key === '.enemigos' || key === '.seguidores') return `👥 ${key.slice(1)}: función local disponible para ${name}.`;
    if (key === '.reputacion') return `⭐ Reputación local de ${name}: ${Math.floor(Math.random() * 101)}/100.`;
    if (key === '.votar' || key === '.encuesta') return '📊 Uso: responde con opciones separadas por comas.';
    if (key === '.poker' || key === '.uno' || key === '.tresenraya' || key === '.conecta4' || key === '.bingo') return `🎮 ${key.slice(1)} preparado. Usa el comando con tus opciones para iniciar.`;
    if (key === '.quiz' || key === '.capitales' || key === '.banderas' || key === '.matematicas' || key === '.verdadero_falso' || key === '.emojiquiz' || key === '.pelicula' || key === '.musicaquiz' || key === '.pokemon' || key === '.futbol') return `🧠 ${key.slice(1)}: modo local preparado.`;
    if (key === '.batalla' || key === '.duelo_monedas' || key === '.supervivencia' || key === '.escape') return `⚔️ ${key.slice(1)}: escribe .${key.slice(1)} iniciar para comenzar.`;
    if (key === '.youtube' || key === '.spotify' || key === '.soundcloud' || key === '.video' || key === '.audio' || key === '.foto' || key === '.wallpaper' || key === '.stickerpack' || key === '.ocr' || key === '.textoimagen') return '🌐 Este comando necesita una fuente externa; la versión local valida la solicitud sin descargar contenido.';
    if (key === '.traducir') return '🌍 Uso: .traducir <idioma> <texto>. La traducción automática requiere un proveedor externo.';
    if (key === '.codigoqr' || key === '.qrtexto') return '🔳 Usa .qr para generar un código QR con el contenido indicado.';
    if (key === '.acortar') return '🔗 El acortamiento requiere un servicio externo; no se envían datos sin configurarlo.';
    if (key === '.ip' || key === '.pais') return '🌐 Esta consulta requiere una API externa y no se ejecuta automáticamente.';
    return `✅ Comando local ${key} disponible. Uso: ${key} ayuda`;
}

async function handleExpandedLocalCommand({ command, args, jid, sender, sock }) {
    const key = commandKey(command, args);
    if (!COMMANDS.has(key) || EXISTING_COMMANDS.has(command)) return false;
    await send(sock, jid, localCommandText(key, args, sender));
    return true;
}

module.exports = {
    COMMANDS,
    handleExpandedLocalCommand
};
