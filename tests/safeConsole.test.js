const test = require('node:test');
const assert = require('node:assert/strict');
const { installSafeConsole } = require('../utils/safeConsole');

test('session diagnostics do not print Signal session objects', () => {
    const calls = [];
    const target = {
        info(...args) { calls.push(['info', ...args]); },
        warn(...args) { calls.push(['warn', ...args]); }
    };
    const restore = installSafeConsole(target);
    const privateSession = { currentRatchet: { privateKey: Buffer.from('sensitive') } };

    try {
        target.info('Removing old closed session:', privateSession);
        target.info('Opening session:', privateSession);
        target.warn('Session already closed', privateSession);
        target.warn('ordinary warning', privateSession);

        assert.deepEqual(calls, [
            ['info', 'Removing old closed session:'],
            ['info', 'Opening session:'],
            ['warn', 'Session already closed'],
            ['warn', 'ordinary warning', privateSession]
        ]);
    } finally {
        restore();
    }
});

test('safe console preserves normal diagnostic arguments and restores methods', () => {
    const calls = [];
    const target = {
        info(...args) { calls.push(['info', ...args]); },
        warn(...args) { calls.push(['warn', ...args]); }
    };
    const originalInfo = target.info;
    const originalWarn = target.warn;
    const restore = installSafeConsole(target);

    target.info('normal info', { count: 1 });
    target.warn('normal warning', { code: 'W_TEST' });
    restore();

    assert.deepEqual(calls, [
        ['info', 'normal info', { count: 1 }],
        ['warn', 'normal warning', { code: 'W_TEST' }]
    ]);
    assert.equal(target.info, originalInfo);
    assert.equal(target.warn, originalWarn);
});
