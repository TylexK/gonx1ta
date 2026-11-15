const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCommand, isCommandMessage, normalizeDisabledCommand } = require('../services/commandAliases');

test('English aliases resolve to the existing Spanish command handlers', () => {
    assert.equal(normalizeCommand('.sing'), '.musica');
    assert.equal(normalizeCommand('.music'), '.musica');
    assert.equal(normalizeCommand('.ai'), '.ia');
    assert.equal(normalizeCommand('.open'), '.abrir');
    assert.equal(normalizeCommand('.link'), '.invitacion');
    assert.equal(normalizeCommand('.sticker'), '.s');
});

test('native commands and unknown commands keep their behavior', () => {
    assert.equal(normalizeCommand('.stats'), '.stats');
    assert.equal(normalizeCommand('.joke'), '.joke');
    assert.equal(normalizeCommand('.unknown'), '.unknown');
    assert.equal(normalizeCommand('.MUSIC'), '.musica');
});

test('dot, slash, and hash prefixes all route to the same command', () => {
    for (const prefix of ['.', '/', '#']) {
        assert.equal(normalizeCommand(`${prefix}sing`), '.musica');
        assert.equal(normalizeCommand(`${prefix}ping`), '.ping');
        assert.equal(isCommandMessage(`${prefix}ping`), true);
    }

    assert.equal(isCommandMessage('ping'), false);
    assert.equal(isCommandMessage(' #ping'), false);
});

test('group command aliases share the canonical disabled-command name', () => {
    assert.equal(normalizeDisabledCommand('.music'), 'musica');
    assert.equal(normalizeDisabledCommand('/music'), 'musica');
    assert.equal(normalizeDisabledCommand('#sing'), 'musica');
    assert.equal(normalizeDisabledCommand('sing'), 'musica');
    assert.equal(normalizeDisabledCommand('.musica'), 'musica');
});
