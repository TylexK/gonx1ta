const FEATURED_COMMANDS_BY_GROUP = {
    group: [
        '.abrir', '.cerrar', '.antilink', '.antiflood', '.warn', '.mute',
        '.kick', '.ban', '.promote', '.setwelcome'
    ],
    admin: [
        '.antiraid', '.activar_2fa', '.estadisticas_grupo', '.backup',
        '.audit', '.permissions', '.modoadmin'
    ],
    downloads: [
        '.tiktok', '.ig', '.facebook', '.mediafire', '.pinterest',
        '.youtube', '.spotify', '.drive'
    ],
    ai: ['.ia'],
    media: [
        '.musica', '.play', '.voz', '.mp3', '.qr', '.convertir', '.gif'
    ],
    games: [
        '.ppt', '.tragamonedas', '.blackjack', '.ahorcado', '.quiz', '.uno',
        '.ajedrez'
    ],
    fun: [
        '.meme', '.joke', '.boda', '.crear_clan', '.top', '.tarot', '.reto'
    ],
    pets: ['.mascota', '.casa', '.decorar'],
    economy: [
        '.daily', '.trabajar', '.minar', '.pescar', '.tienda', '.comprar',
        '.banco', '.transferir', '.ranking'
    ],
    profile: [
        '.reg', '.perfil', '.nivel', '.estadisticas', '.logros', '.misgrupos',
        '.id'
    ],
    stickers: ['.s', '.sticker', '.brat', '.bratv'],
    system: [
        '.menu', '.bot', '.ping', '.reglas', '.soporte', '.clima',
        '.recordatorio', '.tutorial', '.qrtexto'
    ]
};

const FEATURED_MENU_COMMANDS = new Set(
    Object.values(FEATURED_COMMANDS_BY_GROUP).flat()
);

module.exports = {
    FEATURED_COMMANDS_BY_GROUP,
    FEATURED_MENU_COMMANDS
};
