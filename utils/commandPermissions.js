function hasPermission(sender, jid, db) {
    const isOwner = process.env.OWNERS?.split(',').includes(sender.split('@')[0]) || false;
    const isGroupChat = jid.endsWith('@g.us');
    
    if (!isGroupChat) return true;
    
    return isOwner;
}

function getPermissionError(command) {
    return `❌ No tienes permisos para usar ${command}`;
}

module.exports = {
    hasPermission,
    getPermissionError
};
