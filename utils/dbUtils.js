const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dbPath = path.join(__dirname, '../database.json');
const sqlitePath = path.join(__dirname, '../database.sqlite');
const useSqlite = process.env.DB_STORAGE === 'sqlite';
let sqliteDatabase = null;
let sqliteAvailable = false;

if (useSqlite) {
    try {
        sqliteAvailable = typeof require('node:sqlite').DatabaseSync === 'function';
    } catch {
        console.warn('DB_STORAGE=sqlite requiere Node 22.5 o superior; se usara database.json.');
    }
}

let _debounceTimer = null;
let _pendingData = null;

function getSqliteDatabase() {
    if (!sqliteAvailable) return null;
    if (sqliteDatabase) return sqliteDatabase;

    const { DatabaseSync } = require('node:sqlite');
    sqliteDatabase = new DatabaseSync(sqlitePath);
    sqliteDatabase.exec('PRAGMA journal_mode = WAL;');
    sqliteDatabase.exec('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)');

    const existing = sqliteDatabase.prepare('SELECT id FROM state WHERE id = 1').get();
    if (!existing) {
        let initialData;
        try {
            initialData = readJsonDatabase();
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw new Error(`No se pudo migrar database.json a SQLite: ${error.message}`, { cause: error });
            }
            initialData = defaultDatabase();
        }
        sqliteDatabase.prepare('INSERT INTO state (id, json) VALUES (1, ?)').run(JSON.stringify(initialData));
    }
    return sqliteDatabase;
}

function defaultDatabase() {
    return {
        users: {},
        transacciones: [],
        antiraid: {},
        backups: [],
        playlists: {},
        placas: {},
        favoritos: {},
        groups: {}
    };
}

function readJsonDatabase() {
    const contents = fs.readFileSync(dbPath, 'utf8');

    try {
        return JSON.parse(contents);
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;

        const backupDir = path.join(__dirname, '../backups');
        const backups = fs.existsSync(backupDir)
            ? fs.readdirSync(backupDir)
                .filter(file => /^database_.*\.json$/.test(file))
                .sort()
                .reverse()
            : [];

        for (const filename of backups) {
            const backupPath = path.join(backupDir, filename);
            const backupContents = fs.readFileSync(backupPath, 'utf8');
            let backup;
            try {
                backup = JSON.parse(backupContents);
            } catch (backupError) {
                if (!(backupError instanceof SyntaxError)) throw backupError;
                console.warn(`Copia de seguridad JSON invalida, se omitira: ${filename}`);
                continue;
            }

            if (!validate(backup)) {
                console.warn(`Copia de seguridad con estructura invalida, se omitira: ${filename}`);
                continue;
            }

            const corruptedPath = `${dbPath}.corrupt-${Date.now()}-${crypto.randomUUID()}`;
            fs.copyFileSync(dbPath, corruptedPath, fs.constants.COPYFILE_EXCL);
            writeAtomic(dbPath, backup);
            console.warn(`database.json estaba corrupto; restaurado desde ${filename}. Original preservado en ${path.basename(corruptedPath)}.`);
            return backup;
        }

        throw new Error('database.json contiene JSON invalido y no se encontro ninguna copia de seguridad valida en backups.', { cause: error });
    }
}

function writeAtomic(filePath, data) {
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const lockPath = `${filePath}.lock`;
    const lockStartedAt = Date.now();
    const lockId = crypto.randomUUID();
    let acquiredLock = false;
    try {
        while (true) {
            try {
                const lock = fs.openSync(lockPath, 'wx');
                fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, lockId, createdAt: Date.now() }), 'utf8');
                fs.closeSync(lock);
                acquiredLock = true;
                break;
            } catch (error) {
                try {
                    const lockAge = Date.now() - fs.statSync(lockPath).mtimeMs;
                    if (lockAge > 10000) {
                        let stale = true;
                        try {
                            const owner = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
                            if (owner.pid && owner.pid !== process.pid) {
                                try {
                                    process.kill(owner.pid, 0);
                                    stale = false;
                                } catch (processError) {
                                    if (processError.code === 'EPERM') stale = false;
                                }
                            } else if (owner.pid === process.pid) {
                                stale = false;
                            }
                        } catch {}
                        if (stale) fs.unlinkSync(lockPath);
                    }
                } catch {}
                if (Date.now() - lockStartedAt > 5000) {
                    throw new Error(`Timeout esperando el lock de ${path.basename(filePath)}`);
                }
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
            }
        }
        fs.writeFileSync(temporaryPath, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(temporaryPath, filePath);
        return true;
    } catch (err) {
        try { if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath); } catch {}
        throw err;
    } finally {
        if (acquiredLock) {
            try {
                const owner = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
                if (owner.pid === process.pid && owner.lockId === lockId) fs.unlinkSync(lockPath);
            } catch {}
        }
    }
}

function ensureDbExists() {
    if (sqliteAvailable) {
        getSqliteDatabase();
        return;
    }
    if (!fs.existsSync(dbPath)) {
        writeAtomic(dbPath, defaultDatabase());
    }
}

function read() {
    ensureDbExists();
    try {
        if (sqliteAvailable) {
            const row = getSqliteDatabase().prepare('SELECT json FROM state WHERE id = 1').get();
            return JSON.parse(row.json);
        }
        return readJsonDatabase();
    } catch (err) {
        console.error('Error reading database:', err);
        throw err;
    }
}

function write(data) {
    try {
        if (sqliteAvailable) {
            const database = getSqliteDatabase();
            database.exec('BEGIN IMMEDIATE');
            try {
                database.prepare('INSERT INTO state (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(JSON.stringify(data));
                database.exec('COMMIT');
                return true;
            } catch (error) {
                database.exec('ROLLBACK');
                throw error;
            }
        }
        return writeAtomic(dbPath, data);
    } catch (err) {
        console.error('Error writing database:', err);
        return false;
    }
}

function validate(db) {
    if (!db || typeof db !== 'object' || Array.isArray(db)) return false;
    if (!Array.isArray(db.transacciones)) db.transacciones = [];
    if (!db.users || typeof db.users !== 'object' || Array.isArray(db.users)) db.users = {};
    if (!db.groups || typeof db.groups !== 'object' || Array.isArray(db.groups)) db.groups = {};
    if (!db.antiraid || typeof db.antiraid !== 'object' || Array.isArray(db.antiraid)) db.antiraid = {};
    if (!Array.isArray(db.backups)) db.backups = [];
    if (!db.playlists || typeof db.playlists !== 'object' || Array.isArray(db.playlists)) db.playlists = {};
    if (!db.placas || typeof db.placas !== 'object' || Array.isArray(db.placas)) db.placas = {};
    if (!db.favoritos || typeof db.favoritos !== 'object' || Array.isArray(db.favoritos)) db.favoritos = {};
    return true;
}

function saveDebounced(data, wait = 1000) {
    try {
        _pendingData = data;
        if (_debounceTimer) clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(() => {
            try {
                if (!write(_pendingData)) {
                    console.error('Error writing debounced DB: el guardado devolvió false.');
                }
            } catch (e) {
                console.error('Error writing debounced DB:', e);
            }
            _pendingData = null;
            _debounceTimer = null;
        }, wait);
        return true;
    } catch (err) {
        console.error('saveDebounced error:', err);
        return false;
    }
}

function flushPending() {
    if (_debounceTimer) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
    }
    if (_pendingData) {
        try {
            if (!write(_pendingData)) {
                console.error('Error flushing pending DB: el guardado devolvió false.');
            }
        } catch (e) {
            console.error('Error flushing pending DB:', e);
        }
        _pendingData = null;
    }
}

function createBackup(db) {
    try {
        const backupDir = path.join(__dirname, '../backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `database_${ts}.json`;
        const filepath = path.join(backupDir, filename);
        writeAtomic(filepath, db);
        if (!db.backups) db.backups = [];
        db.backups.push({ file: filename, createdAt: Date.now() });
        write(db);
        return true;
    } catch (err) {
        console.error('Error creating backup:', err);
        return false;
    }
}

function pruneBackups(limit = 24) {
    const backupDir = path.join(__dirname, '../backups');
    if (!fs.existsSync(backupDir)) return 0;
    const backups = fs.readdirSync(backupDir)
        .filter(file => /^database_.*\.json$/.test(file) && !file.includes('manual'))
        .sort()
        .reverse();
    backups.slice(limit).forEach(file => fs.unlinkSync(path.join(backupDir, file)));
    return Math.max(0, backups.length - limit);
}

module.exports = {
    read,
    write,
    validate,
    saveDebounced,
    createBackup,
    pruneBackups,
    writeAtomic,
    flushPending
};
