const fs = require('node:fs');
const path = require('node:path');
const { writeAtomic } = require('./dbUtils');

const ACTIVITY_PATH = path.join(__dirname, '..', 'actividad.json');
const WRITE_DELAY_MS = 2000;
let activity;
let writeTimer = null;
let dirty = false;

function load() {
    if (activity) return activity;

    try {
        activity = fs.existsSync(ACTIVITY_PATH)
            ? JSON.parse(fs.readFileSync(ACTIVITY_PATH, 'utf8')) || {}
            : {};
        if (!activity || typeof activity !== 'object' || Array.isArray(activity)) {
            throw new Error('Formato de actividad.json inválido');
        }
    } catch (error) {
        console.error('Error leyendo actividad.json:', error.message);
        activity = {};
    }

    return activity;
}

function flush() {
    if (!dirty) return;
    if (writeTimer) {
        clearTimeout(writeTimer);
        writeTimer = null;
    }

    try {
        writeAtomic(ACTIVITY_PATH, activity);
        dirty = false;
    } catch (error) {
        console.error('Error guardando actividad.json:', error.message);
        throw error;
    }
}

function scheduleFlush() {
    if (writeTimer) return;
    writeTimer = setTimeout(() => {
        writeTimer = null;
        try {
            flush();
        } catch {
            scheduleFlush();
        }
    }, WRITE_DELAY_MS);
    writeTimer.unref?.();
}

function recordMessage(sender, timestamp = Date.now()) {
    if (typeof sender !== 'string' || !sender) return;
    load()[sender] = { lastMessage: timestamp };
    dirty = true;
    scheduleFlush();
}

function getAll() {
    return load();
}

module.exports = {
    recordMessage,
    getAll,
    flush
};
