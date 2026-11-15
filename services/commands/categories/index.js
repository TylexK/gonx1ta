const categories = [
    require('./admin'),
    require('./stickers'),
    require('./multimedia'),
    require('./games'),
    require('./economy'),
    require('./social'),
    require('./utility')
];

const commandCategories = new Map();
for (const category of categories) {
    for (const command of category.commands) {
        if (!commandCategories.has(command)) {
            commandCategories.set(command, category.name);
        }
    }
}

function getCommandCategory(command) {
    return commandCategories.get(command) || 'other';
}

module.exports = {
    categories,
    getCommandCategory
};
