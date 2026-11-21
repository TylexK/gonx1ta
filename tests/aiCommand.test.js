const test = require('node:test');
const assert = require('node:assert/strict');

const { handleAiCommand } = require('../services/commands/utility/ai');

test('avisa cuando el proveedor rechaza la clave y registra el error estructurado', async () => {
    const sentMessages = [];
    const warnings = [];
    const error = Object.assign(new Error('AI_INVALID_API_KEY'), {
        code: 'AI_INVALID_API_KEY',
        httpStatus: 401,
        providerCode: 'invalid_api_key'
    });

    await handleAiCommand({
        command: '.ia',
        jid: 'user@s.whatsapp.net',
        sender: 'user@s.whatsapp.net',
        isGroupChat: false,
        question: 'Hola',
        sock: {
            async sendMessage(jid, message) {
                sentMessages.push({ jid, message });
            }
        },
        aiService: {
            async ask() {
                throw error;
            }
        },
        logger: {
            warn(fields, message) {
                warnings.push({ fields, message });
            }
        }
    });

    assert.match(sentMessages[0].message.text, /AI_API_KEY/);
    assert.doesNotMatch(sentMessages[0].message.text, /sk-/);
    assert.equal(warnings[0].message, 'Solicitud de IA no disponible');
    assert.equal(warnings[0].fields.errorCode, 'AI_INVALID_API_KEY');
    assert.equal(warnings[0].fields.httpStatus, 401);
    assert.equal(warnings[0].fields.providerCode, 'invalid_api_key');
});
