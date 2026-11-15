const fs = require('node:fs');
const path = require('node:path');

const ENV_KEYS = [
    'AI_API_KEY',
    'AI_API_URL',
    'AI_MODEL',
    'AI_MAX_REQUESTS_PER_DAY',
    'AI_MAX_REQUESTS_PER_USER_PER_DAY',
    'AI_MAX_OUTPUT_TOKENS'
];
const USAGE_PATH = path.join(__dirname, '..', 'ai-usage.json');
const MAX_INPUT_LENGTH = 1000;
const MAX_HISTORY_MESSAGES = 6;
const MAX_RESPONSE_LENGTH = 3500;
const REQUEST_TIMEOUT_MS = 20000;
const MIN_REQUEST_INTERVAL_MS = 10000;
const conversations = new Map();
const lastRequests = new Map();

class AiServiceError extends Error {
    constructor(code, details = {}) {
        super(code);
        this.code = code;
        Object.assign(this, details);
    }
}

function safeProviderCode(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(value)
        ? value
        : undefined;
}

async function getProviderErrorDetails(response) {
    let providerCode;
    try {
        const body = await response.json();
        providerCode = safeProviderCode(body?.error?.code) || safeProviderCode(body?.error?.type);
    } catch {
    }
    return {
        httpStatus: response.status,
        ...(providerCode ? { providerCode } : {})
    };
}

function getEnvironment() {
    const values = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    const envPath = path.join(__dirname, '..', '.env');

    if (!fs.existsSync(envPath)) return values;

    const fileContents = fs.readFileSync(envPath, 'utf8');
    for (const line of fileContents.split(/\r?\n/)) {
        const match = line.match(/^\s*(AI_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (!match || !ENV_KEYS.includes(match[1]) || values[match[1]]) continue;
        values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
    return values;
}

function parseLimit(value, fallback, maximum) {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
        throw new AiServiceError('AI_CONFIGURATION_ERROR');
    }
    return parsed;
}

function getConfig() {
    const env = getEnvironment();
    if (!env.AI_API_KEY) throw new AiServiceError('AI_NOT_CONFIGURED');

    const apiUrl = env.AI_API_URL || 'https://api.openai.com/v1/chat/completions';
    let parsedUrl;
    try {
        parsedUrl = new URL(apiUrl);
    } catch {
        throw new AiServiceError('AI_CONFIGURATION_ERROR');
    }
    if (parsedUrl.protocol !== 'https:') throw new AiServiceError('AI_CONFIGURATION_ERROR');

    return {
        apiKey: env.AI_API_KEY,
        apiUrl: parsedUrl.toString(),
        model: env.AI_MODEL || 'gpt-4o-mini',
        maxRequestsPerDay: parseLimit(env.AI_MAX_REQUESTS_PER_DAY, 100, 10000),
        maxRequestsPerUserPerDay: parseLimit(env.AI_MAX_REQUESTS_PER_USER_PER_DAY, 10, 1000),
        maxOutputTokens: parseLimit(env.AI_MAX_OUTPUT_TOKENS, 400, 1000)
    };
}

function readUsage(today) {
    if (!fs.existsSync(USAGE_PATH)) return { date: today, total: 0, users: {} };

    let usage;
    try {
        usage = JSON.parse(fs.readFileSync(USAGE_PATH, 'utf8'));
    } catch {
        throw new AiServiceError('AI_USAGE_STORAGE_ERROR');
    }

    if (usage.date !== today) return { date: today, total: 0, users: {} };
    if (!Number.isSafeInteger(usage.total) || usage.total < 0 || !usage.users || typeof usage.users !== 'object' || Array.isArray(usage.users)) {
        throw new AiServiceError('AI_USAGE_STORAGE_ERROR');
    }
    for (const count of Object.values(usage.users)) {
        if (!Number.isSafeInteger(count) || count < 0) throw new AiServiceError('AI_USAGE_STORAGE_ERROR');
    }
    return usage;
}

function consumeQuota(userId, config) {
    const today = new Date().toISOString().slice(0, 10);
    const usage = readUsage(today);
    const userCount = usage.users[userId] || 0;
    if (usage.total >= config.maxRequestsPerDay || userCount >= config.maxRequestsPerUserPerDay) {
        throw new AiServiceError('AI_RATE_LIMIT');
    }

    usage.total += 1;
    usage.users[userId] = userCount + 1;
    const temporaryPath = path.join(__dirname, '..', `.ai-usage.json.tmp-${process.pid}`);
    try {
        fs.writeFileSync(temporaryPath, JSON.stringify(usage), { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(temporaryPath, USAGE_PATH);
    } catch {
        try {
            if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
        } catch {
        }
        throw new AiServiceError('AI_USAGE_STORAGE_ERROR');
    }
}

function resetConversation(conversationId) {
    conversations.delete(conversationId);
}

async function ask(conversationId, userId, question) {
    if (typeof question !== 'string' || !question.trim() || question.length > MAX_INPUT_LENGTH) {
        throw new AiServiceError('AI_INVALID_INPUT');
    }

    const config = getConfig();
    const now = Date.now();
    const lastRequest = lastRequests.get(userId) || 0;
    if (now - lastRequest < MIN_REQUEST_INTERVAL_MS) throw new AiServiceError('AI_RATE_LIMIT');

    consumeQuota(userId, config);
    lastRequests.set(userId, now);
    for (const [requester, timestamp] of lastRequests) {
        if (now - timestamp > 60 * 60 * 1000) lastRequests.delete(requester);
    }

    const history = conversations.get(conversationId) || [];
    const messages = [
        {
            role: 'system',
            content: 'Responde siempre en español, de forma clara y concisa. Solo puedes generar texto: no tienes herramientas ni permisos para ejecutar comandos, administrar grupos, expulsar usuarios ni modificar monedas o datos del bot.'
        },
        ...history,
        { role: 'user', content: question.trim() }
    ];

    let response;
    try {
        response = await fetch(config.apiUrl, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${config.apiKey}`,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model: config.model,
                messages,
                max_tokens: config.maxOutputTokens,
                temperature: 0.7
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
    } catch (error) {
        const networkCode = safeProviderCode(error?.code) || safeProviderCode(error?.name);
        throw new AiServiceError('AI_UNAVAILABLE', networkCode ? { networkCode } : {});
    }

    if (!response.ok) {
        throw new AiServiceError('AI_UNAVAILABLE', await getProviderErrorDetails(response));
    }

    let result;
    try {
        result = await response.json();
    } catch {
        throw new AiServiceError('AI_UNAVAILABLE', { httpStatus: response.status });
    }
    const answer = result?.choices?.[0]?.message?.content;
    if (typeof answer !== 'string' || !answer.trim()) {
        const providerCode = safeProviderCode(result?.error?.code) || safeProviderCode(result?.error?.type);
        throw new AiServiceError('AI_UNAVAILABLE', {
            httpStatus: response.status,
            ...(providerCode ? { providerCode } : {})
        });
    }

    const boundedAnswer = answer.trim().slice(0, MAX_RESPONSE_LENGTH);
    const updatedHistory = [
        ...history,
        { role: 'user', content: question.trim() },
        { role: 'assistant', content: boundedAnswer }
    ].slice(-MAX_HISTORY_MESSAGES);
    conversations.set(conversationId, updatedHistory);
    return boundedAnswer;
}

module.exports = {
    ask,
    resetConversation
};
