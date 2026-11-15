async function handleGroupAdminCommand({
    command,
    jid,
    isAdmin,
    participants,
    args,
    sender,
    message,
    registroAdmin,
    sock,
    registrarAccionAdmin
}) {
    if (command === '.promote' || command === '.demote') {
        if (!isAdmin) {
            await sock.sendMessage(jid, { text: '❌ Solo administradores pueden usar este comando.' });
            return true;
        }

        const user = message.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
            message.message.extendedTextMessage?.contextInfo?.participant ||
            (args[0] ? args[0].replace(/\D/g, '') + '@s.whatsapp.net' : null);
        if (!user) {
            await sock.sendMessage(jid, { text: '⚠️ Menciona a alguien o responde a su mensaje.' });
            return true;
        }

        const action = command === '.promote' ? 'promote' : 'demote';
        const description = command === '.promote'
            ? `👑 @${user.split('@')[0]} ahora es administrador.`
            : `❌ @${user.split('@')[0]} ya no es administrador.`;
        const auditDescription = command === '.promote'
            ? `👑 @${user.split('@')[0]} promovido a admin`
            : `❌ @${user.split('@')[0]} removido como admin`;
        await sock.groupParticipantsUpdate(jid, [user], action);
        await sock.sendMessage(jid, { text: description, mentions: [user] });
        registrarAccionAdmin(jid, sender, auditDescription);
        return true;
    }

    if (command === '.cerrar' || command === '.abrir') {
        if (!isAdmin) {
            await sock.sendMessage(jid, { text: '❌ Solo administradores pueden usar este comando.' });
            return true;
        }

        const closing = command === '.cerrar';
        await sock.groupSettingUpdate(jid, closing ? 'announcement' : 'not_announcement');
        registrarAccionAdmin(jid, sender, closing ? '🔒 Grupo cerrado' : '🔓 Grupo abierto');
        await sock.sendMessage(jid, {
            text: closing ? '🔒 *Gonx!ta Bot:* Grupo cerrado.' : '🔓 *Gonx!ta Bot:* Grupo abierto.'
        });
        return true;
    }

    if (command === '.invitacion') {
        if (!isAdmin) {
            await sock.sendMessage(jid, { text: '❌ Solo administradores pueden usar este comando.' });
            return true;
        }

        try {
            let inviteCode;
            if (typeof sock.groupInviteCode === 'function') {
                inviteCode = await sock.groupInviteCode(jid);
            } else {
                const metadata = await sock.groupMetadata(jid);
                inviteCode = metadata.inviteCode || metadata.inviteLink?.split('/').pop();
            }
            if (!inviteCode) throw new Error('No invite code');
            await sock.sendMessage(jid, { text: `🔗 *Link de invitación:*\nhttps://chat.whatsapp.com/${inviteCode}` });
        } catch (error) {
            console.error('Error al generar invitación:', error);
            await sock.sendMessage(jid, {
                text: '❌ No pude generar el link de invitación. Asegúrate de que Gonx!ta Bot sea admin y tenga permisos para crear enlaces.'
            });
        }
        return true;
    }

    if (command === '.hidetag') {
        if (!isAdmin) {
            await sock.sendMessage(jid, { text: '❌ Solo administradores pueden usar este comando.' });
            return true;
        }

        const text = args.join(' ') || '¡Atención grupo! 📣';
        registrarAccionAdmin(jid, sender, '📢 Hidetag enviado');
        await sock.sendMessage(jid, { text, mentions: participants.map(participant => participant.id) });
        return true;
    }

    if (command === '.registro' || command === '.logs') {
        if (!jid.endsWith('@g.us')) {
            await sock.sendMessage(jid, { text: '⚠️ Este comando solo funciona en grupos.' });
            return true;
        }
        if (!isAdmin) {
            await sock.sendMessage(jid, { text: command === '.logs'
                ? '❌ Solo administradores pueden ver logs.'
                : '❌ Solo administradores pueden consultar el registro.' });
            return true;
        }

        let requestedCount = 10;
        if (command === '.registro' && args[0] !== undefined) {
            requestedCount = Number(args[0]);
            if (!/^\d+$/.test(args[0]) || !Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 20) {
                await sock.sendMessage(jid, { text: '⚠️ Uso: .registro [1-20]\nPor defecto muestra las últimas 10 acciones.' });
                return true;
            }
        }

        const selectedEntries = Array.isArray(registroAdmin) ? registroAdmin.slice(-requestedCount) : [];
        const entries = command === '.registro' ? selectedEntries.reverse() : selectedEntries;
        if (!entries.length) {
            await sock.sendMessage(jid, { text: command === '.logs'
                ? '📜 No hay registro de acciones administrativas aún.'
                : '📋 Todavía no hay acciones administrativas registradas en este grupo.' });
            return true;
        }

        if (command === '.logs') {
            const text = `📜 *ÚLTIMAS ACCIONES ADMINISTRATIVAS*\n\n${entries.map((entry, index) =>
                `${index + 1}. ${entry.accion}\n   👮 ${entry.admin.split('@')[0]} | 📅 ${entry.fecha}`
            ).join('\n\n')}`;
            await sock.sendMessage(jid, { text });
            return true;
        }

        const mentions = [...new Set(entries
            .map(entry => entry?.admin)
            .filter(admin => typeof admin === 'string' && admin.includes('@')))];
        const lines = entries.map((entry, index) => {
            const admin = typeof entry?.admin === 'string' ? entry.admin : 'Administrador';
            const adminLabel = admin.includes('@') ? `@${admin.split('@')[0]}` : admin;
            const action = typeof entry?.accion === 'string' ? entry.accion : 'Acción sin descripción';
            const date = typeof entry?.fecha === 'string' ? entry.fecha : 'Fecha desconocida';
            return `${index + 1}. ${date}\n   👮 ${adminLabel}\n   ${action}`;
        });

        await sock.sendMessage(jid, {
            text: `📋 *ÚLTIMAS ${entries.length} ACCIONES ADMINISTRATIVAS*\n\n${lines.join('\n\n')}`,
            mentions
        });
        return true;
    }

    if (command === '.l') {
        if (!isAdmin) {
            await sock.sendMessage(jid, { text: '❌ Solo administradores pueden usar este comando.' });
            return true;
        }

        if (!jid.endsWith('@g.us')) {
            await sock.sendMessage(jid, { text: '❌ Este comando solo funciona en grupos' });
            return true;
        }

        const admins = participants.filter(participant => participant.admin);
        if (admins.length === 0) {
            await sock.sendMessage(jid, { text: '⚠️ No hay administradores en este grupo' });
            return true;
        }

        const mentions = admins.map(participant => participant.id);
        const text = `📢 *ADMINISTRADORES*\n\n${mentions.map(user => `@${user.split('@')[0]}`).join('\n')}\n`;
        await sock.sendMessage(jid, { text, mentions });
        return true;
    }

    if (command !== '.tagall') return false;

    if (!jid.endsWith('@g.us')) {
        await sock.sendMessage(jid, {
            text: '╭━━━〔 ⚠️ 𝐄𝐑𝐑𝐎𝐑 〕━━━╮\n' +
                  '┃ 🔒 Este comando es exclusivo\n' +
                  '┃    para grupos de WhatsApp.\n' +
                  '╰━━━━━━━━━━━━━━━━━━╯'
        });
        return true;
    }

    if (!isAdmin) {
        await sock.sendMessage(jid, {
            text: '╭━━━〔 🚫 𝐀𝐂𝐂𝐄𝐒𝐎 𝐁𝐋𝐎𝐐𝐔𝐄𝐀𝐃𝐎 〕━━━╮\n' +
                  '┃ 👑 Solo los administradores\n' +
                  '┃    pueden activar esta función.\n' +
                  '╰━━━━━━━━━━━━━━━━━━━━━━━━╯'
        });
        return true;
    }

    try {
        const metadata = await sock.groupMetadata(jid);
        const participants = metadata.participants;

        if (!participants.length) {
            await sock.sendMessage(jid, { text: '⚠️ No se encontraron miembros en el grupo.' });
            return true;
        }

        const mentions = [];
        const total = participants.length;

        let text =
`╔══════════════════════╗
║  🔥 𝐆 𝐎 𝐍 𝐗 ! 𝐓 𝐀 🔥
║       𝐁 𝐎 𝐓  𝐔 𝐋 𝐓 𝐑 𝐀
╚══════════════════════╝

╭━━━『 ⚡ ¡𝐀𝐓𝐄𝐍𝐂𝐈𝐎́𝐍, 𝐓𝐎𝐃𝐎𝐒! 』━━━╮
┣━━━━━━━━━━━━━━━━━━━━━━
┃  👥 𝐈𝐍𝐅𝐎𝐑𝐌𝐄 𝐃𝐄 𝐌𝐈𝐄𝐌𝐁𝐑𝐎𝐒
┃  💠 Total: ${total} participantes
┣━━━━━━━━━━━━━━━━━━━━━━━╯
`;

        for (const participant of participants) {
            const user = participant.id;
            mentions.push(user);
            text += `┃ 🔴 @${user.split('@')[0]}\n`;
        }

        text +=
`┣━━━━━━━━━━━━━━━━━━━━━━
┃  ⚡ 𝐂𝐎𝐌𝐀𝐍𝐃𝐎 𝐀𝐂𝐓𝐈𝐕𝐀𝐃𝐎
┃
╰━━━『 👑 𝐆𝐎𝐍𝐗!𝐓𝐀 𝐁𝐎𝐓 』━━━╯
         ⚡ 𝐏𝐑𝐄𝐌𝐈𝐔𝐌 𝐒𝐘𝐒𝐓𝐄𝐌 ⚡`;

        await sock.sendMessage(jid, { text, mentions });
    } catch (error) {
        console.error('[GONX TAGALL]', error);
        await sock.sendMessage(jid, {
            text: '╭━━━〔 ❌ 𝐄𝐑𝐑𝐎𝐑 〕━━━╮\n' +
                  '┃ No se pudo completar el tagall.\n' +
                  '┃ Inténtalo nuevamente.\n' +
                  '╰━━━━━━━━━━━━━━━━━━╯'
        });
    }

    return true;
}

module.exports = { handleGroupAdminCommand };
