function validateUserInput(input) {
    if (!input || typeof input !== 'string') return false;
    if (input.length > 1000) return false;
    return true;
}

function sanitizeString(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[<>]/g, '');
}

const rateLimits = {};

function checkRateLimit(key, limit = 3000) {
    const now = Date.now();
    if (!rateLimits[key]) {
        rateLimits[key] = now;
        return true;
    }
    
    if (now - rateLimits[key] < limit) {
        return false;
    }
    
    rateLimits[key] = now;
    return true;
}

module.exports = {
    validateUserInput,
    sanitizeString,
    checkRateLimit
};
