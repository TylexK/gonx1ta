async function handleAiCommand({
    command,
    jid,
    sender,
    isGroupChat,
    question,
    sock,
    aiService,
    logger
}) {
    if (command === '.iareset') {
        const conversationId = isGroupChat ? `${jid}:${sender}` : sender;
        aiService.resetConversation(conversationId);
        await sock.sendMessage(jid, { text: '✅ He borrado el contexto de nuestra conversación.' });
        return true;
    }

    if (command !== '.ia') return false;
    if (!question) {
        await sock.sendMessage(jid, { text: 'Uso: .ia <pregunta>\nPara borrar el contexto usa .iareset.' });
        return true;
    }

    const conversationId = isGroupChat ? `${jid}:${sender}` : sender;
    try {
        const answer = await aiService.ask(conversationId, sender, question);
        await sock.sendMessage(jid, { text: answer });
    } catch (error) {
        if (!['AI_RATE_LIMIT', 'AI_NOT_CONFIGURED', 'AI_INVALID_INPUT'].includes(error.code)) {
            logger.warn({
                jid,
                sender,
                errorCode: error.code || 'AI_UNAVAILABLE',
                ...(Number.isInteger(error.httpStatus) ? { httpStatus: error.httpStatus } : {}),
                ...(error.providerCode ? { providerCode: error.providerCode } : {}),
                ...(error.networkCode ? { networkCode: error.networkCode } : {})
            }, 'Solicitud de IA no disponible');
        }
        if (error.code === 'AI_RATE_LIMIT') {
            await sock.sendMessage(jid, { text: 'Has alcanzado el límite de consultas de IA. Inténtalo más tarde.' });
            return true;
        }
        if (error.code === 'AI_NOT_CONFIGURED') {
            await sock.sendMessage(jid, { text: 'La IA no está configurada. Avisa al administrador del bot.' });
            return true;
        }
        if (error.code === 'AI_INVALID_API_KEY') {
            await sock.sendMessage(jid, {
                text: 'El proveedor rechazó la clave de IA (HTTP 401). Actualiza AI_API_KEY en el .env local y reinicia el bot.'
            });
            return true;
        }
        await sock.sendMessage(jid, { text: 'El servicio de IA está temporalmente ocupado. Inténtalo de nuevo más tarde.' });
    }

    return true;
}

module.exports = { handleAiCommand };
