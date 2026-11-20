const test = require('node:test');
const assert = require('node:assert/strict');

const { categories: sourceCategories } = require('../services/commands/categories');
const {
    createMenuCategories,
    createWhatsAppMenuResponse,
    getWhatsAppMenuSelection,
    getMenuCommands,
    getWhatsAppMenuExecution,
    sendWhatsAppMenu
} = require('../services/whatsappMenu');

test('el menú incluye todos los comandos definidos para el bot', () => {
    const expectedCommands = new Set(sourceCategories.flatMap(category => category.commands));
    expectedCommands.add('.doom');
    const menuCategories = createMenuCategories(sourceCategories);
    const displayedCommands = new Set(getMenuCommands(menuCategories).map(item => item.command));

    assert.deepEqual([...displayedCommands].sort(), [...expectedCommands].sort());
});

test('todos los comandos se pueden recorrer y ejecutar desde las páginas del menú', () => {
    const menuCategories = createMenuCategories(sourceCategories);
    const commands = getMenuCommands(menuCategories);
    const displayedCommands = [];

    for (let page = 0; displayedCommands.length < commands.length; page++) {
        const response = createWhatsAppMenuResponse(sourceCategories, `gonxta-menu:all:${page}`);
        const rows = response.payload.sections[0].rows;

        assert.ok(rows.length <= 10);
        displayedCommands.push(...rows
            .filter(row => row.rowId.startsWith('gonxta-menu:command:'))
            .map(row => row.title));
    }

    assert.deepEqual(displayedCommands, commands.map(item => item.command));
    assert.equal(
        getWhatsAppMenuExecution(sourceCategories, 'gonxta-menu:execute:0'),
        commands[0].command
    );
});

test('el menú usa selección nativa y conserva los identificadores de sus opciones', async () => {
    let relayedMessage;
    let relayOptions;
    const sock = {
        user: { id: 'bot@s.whatsapp.net' },
        async relayMessage(jid, message, options) {
            assert.equal(jid, 'user@s.whatsapp.net');
            relayedMessage = message;
            relayOptions = options;
        }
    };

    await sendWhatsAppMenu({
        categories: sourceCategories,
        jid: 'user@s.whatsapp.net',
        sock,
        generateWAMessageFromContent: (jid, message) => ({
            key: { id: 'menu-message-id' },
            message
        })
    });

    const nativeFlow = relayedMessage.interactiveMessage.nativeFlowMessage;
    assert.equal(nativeFlow.buttons[0].name, 'single_select');
    const params = JSON.parse(nativeFlow.buttons[0].buttonParamsJson);
    const firstOption = params.sections[0].rows[0];
    assert.ok(firstOption.id.startsWith('gonxta-menu:'));
    assert.equal(
        getWhatsAppMenuSelection({
            interactiveResponseMessage: {
                nativeFlowResponseMessage: {
                    paramsJson: JSON.stringify({ id: firstOption.id })
                }
            }
        }),
        firstOption.id
    );
    assert.deepEqual(relayOptions, { messageId: 'menu-message-id' });
});
