const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

async function downloadAudio(query) {
    return new Promise((resolve, reject) => {
        if (typeof query !== 'string' || !query.trim()) {
            reject(new TypeError('La búsqueda de audio es obligatoria.'));
            return;
        }
        const downloadDir = path.join(__dirname, '../downloads');
        fs.mkdirSync(downloadDir, { recursive: true });
        const outputTemplate = path.join(downloadDir, '%(title)s.%(ext)s');
        const args = [
            '-x',
            '--audio-format', 'mp3',
            '--audio-quality', '192',
            '-o', outputTemplate,
            query.trim()
        ];

        const downloadProcess = spawn('python', ['-m', 'yt_dlp', ...args], { shell: false, windowsHide: true });
        let stderr = '';

        downloadProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        downloadProcess.once('error', reject);
        downloadProcess.once('close', (code) => {
            if (code !== 0) {
                reject(new Error(`yt-dlp failed: ${stderr.slice(-1000) || `process exited with code ${code}`}`));
            } else {
                resolve();
            }
        });
    });
}

function cleanupAll() {
    try {
        const downloadDir = path.join(__dirname, '../downloads');
        if (fs.existsSync(downloadDir)) {
            const files = fs.readdirSync(downloadDir);
            files.forEach(file => {
                try {
                    const filePath = path.join(downloadDir, file);
                    if (fs.statSync(filePath).isFile()) fs.unlinkSync(filePath);
                } catch (e) {
                    console.log('No se pudo eliminar:', file);
                }
            });
        }
    } catch (e) {
        console.log('Error al limpiar archivos:', e.message);
    }
}

function cleanupOldFiles(maxAgeHours = 24) {
    const downloadDir = path.join(__dirname, '../downloads');
    if (!fs.existsSync(downloadDir)) return;
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
    for (const file of fs.readdirSync(downloadDir)) {
        const filePath = path.join(downloadDir, file);
        try {
            const stats = fs.statSync(filePath);
            if (stats.isFile() && stats.mtimeMs < cutoff) fs.unlinkSync(filePath);
        } catch (error) {
            console.warn(`No se pudo limpiar ${file}:`, error.message);
        }
    }
}

module.exports = {
    downloadAudio,
    cleanupAll,
    cleanupOldFiles
};
