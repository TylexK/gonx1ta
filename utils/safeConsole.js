const SESSION_LOG_PREFIXES = [
    'Removing old closed session:',
    'Closing session:',
    'Opening session:',
    'Session already closed',
    'Session already open'
];

function installSafeConsole(consoleTarget = console) {
    const originals = new Map();
    for (const method of ['info', 'warn']) {
        const original = consoleTarget[method];
        originals.set(method, original);
        consoleTarget[method] = function (...args) {
            if (typeof args[0] === 'string' && SESSION_LOG_PREFIXES.some(prefix => args[0].startsWith(prefix))) {
                return original.call(this, args[0]);
            }
            return original.apply(this, args);
        };
    }

    return () => {
        for (const [method, original] of originals) {
            consoleTarget[method] = original;
        }
    };
}

module.exports = { installSafeConsole };
