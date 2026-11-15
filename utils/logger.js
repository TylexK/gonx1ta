const pino = require('pino');

const logger = pino({
    level: 'info'
});

logger.logCritical = (message, error) => logger.fatal({ err: error }, message);

module.exports = logger;
