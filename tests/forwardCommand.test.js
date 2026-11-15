const test = require('node:test');
const assert = require('node:assert/strict');
const { getPollPayload } = require('../services/commands/multimedia/forward');

test('poll conversion keeps its question, choices, and single-choice setting', () => {
    const poll = getPollPayload({
        pollCreationMessageV3: {
            name: '¿Qué prefieres?',
            selectableOptionsCount: 1,
            options: [{ optionName: 'Café' }, { optionName: 'Té' }]
        }
    });

    assert.deepEqual(poll, {
        name: '¿Qué prefieres?',
        values: ['Café', 'Té'],
        selectableCount: 1
    });
});

test('poll conversion supports other Baileys poll versions and rejects malformed polls', () => {
    assert.deepEqual(
        getPollPayload({
            pollCreationMessage: {
                name: 'Elige varias',
                selectableOptionsCount: 2,
                options: [{ optionName: 'A' }, { optionName: 'B' }, { optionName: 'C' }]
            }
        }),
        { name: 'Elige varias', values: ['A', 'B', 'C'], selectableCount: 2 }
    );
    assert.equal(getPollPayload({ conversation: 'not a poll' }), null);
    assert.equal(getPollPayload({
        pollCreationMessageV2: {
            name: 'Invalid',
            selectableOptionsCount: 4,
            options: [{ optionName: 'A' }, { optionName: 'B' }]
        }
    }), null);
});
