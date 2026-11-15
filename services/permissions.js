const ADMIN_COMMANDS = new Set([
    '.warn', '.warns', '.unwarn', '.mute', '.unmute',
    '.del', '.agg', '.kick', '.ban', '.promote', '.demote',
    '.setwelcome', '.setgoodbye', '.goodbye', '.registro', '.logs',
    '.sc'
]);

function requiresAdmin(command) {
    return ADMIN_COMMANDS.has(String(command || '').toLowerCase());
}

function canUseCommand(command, isAdmin) {
    return !requiresAdmin(command) || Boolean(isAdmin);
}

module.exports = {
    ADMIN_COMMANDS,
    requiresAdmin,
    canUseCommand
};
