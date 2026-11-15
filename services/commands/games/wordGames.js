function normalizeLetters(value) {
    return String(value || '')
        .toLocaleLowerCase('es')
        .replace(/ñ/g, '\uE000')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/\uE000/g, 'ñ')
        .normalize('NFC');
}

function normalizeGameAnswer(value) {
    return normalizeLetters(value).replace(/[^\p{L}\p{N}]/gu, '');
}

function createHangmanGame(word, attempts = 6) {
    return {
        palabra: normalizeLetters(word),
        letras: [],
        intentos: attempts
    };
}

function getHangmanMask(game) {
    return [...game.palabra]
        .map(character => character === ' ' || game.letras.includes(character) ? character : '_')
        .join('');
}

function guessHangmanLetter(game, input) {
    const letter = normalizeLetters(String(input || '').trim());
    if ([...letter].length !== 1 || !/^\p{L}$/u.test(letter)) return { status: 'invalid' };
    if (game.letras.includes(letter)) return { status: 'duplicate' };

    game.letras.push(letter);
    if (!game.palabra.includes(letter)) {
        game.intentos--;
        return { status: game.intentos <= 0 ? 'lost' : 'wrong' };
    }

    return { status: getHangmanMask(game) === game.palabra ? 'won' : 'correct' };
}

module.exports = {
    createHangmanGame,
    getHangmanMask,
    guessHangmanLetter,
    normalizeGameAnswer
};
