const ANAGRAM_WORDS = [
    'planeta',
    'servidor',
    'aventura',
    'whatsapp',
    'computadora',
    'murcielago',
    'biblioteca'
];

const MEMORY_SYMBOLS = ['🍎', '🚀', '🐱', '⚽', '🌟', '🎵', '🍀', '🔥'];

function randomItem(items, random = Math.random) {
    return items[Math.floor(random() * items.length)];
}

function createHigherLowerGame(random = Math.random) {
    return { card: Math.floor(random() * 13) + 1 };
}

function playHigherLower(game, choice, random = Math.random) {
    if (!['mayor', 'menor'].includes(choice)) return { status: 'invalid' };
    const nextCard = Math.floor(random() * 13) + 1;
    const win = nextCard === game.card || (choice === 'mayor' ? nextCard > game.card : nextCard < game.card);
    const result = { status: win ? 'won' : 'lost', previous: game.card, next: nextCard };
    game.card = nextCard;
    return result;
}

function createSecretNumberGame(random = Math.random) {
    return {
        number: Math.floor(random() * 100) + 1,
        attempts: 7
    };
}

function guessSecretNumber(game, value) {
    const guess = Number(value);
    if (!Number.isInteger(guess) || guess < 1 || guess > 100) return { status: 'invalid' };
    game.attempts--;
    if (guess === game.number) return { status: 'won' };
    if (game.attempts <= 0) return { status: 'lost', number: game.number };
    return { status: guess < game.number ? 'higher' : 'lower', attempts: game.attempts };
}

function createAnagramGame(random = Math.random) {
    const word = randomItem(ANAGRAM_WORDS, random);
    return {
        word,
        scrambled: [...word].sort(() => random() - 0.5).join('')
    };
}

function answerAnagram(game, answer) {
    const normalized = String(answer || '').trim().toLocaleLowerCase('es');
    if (!normalized) return { status: 'invalid' };
    return { status: normalized === game.word ? 'won' : 'wrong' };
}

function createMemoryGame(random = Math.random, length = 4) {
    const sequence = Array.from({ length }, () => randomItem(MEMORY_SYMBOLS, random));
    return { sequence };
}

function answerMemory(game, answer) {
    const sequence = String(answer || '').trim().split(/\s+/);
    if (sequence.length !== game.sequence.length) return { status: 'invalid' };
    return {
        status: sequence.every((symbol, index) => symbol === game.sequence[index]) ? 'won' : 'lost'
    };
}

function playOddEven(choice, random = Math.random) {
    if (!['par', 'impar'].includes(choice)) return { status: 'invalid' };
    const roll = Math.floor(random() * 6) + 1;
    const parity = roll % 2 === 0 ? 'par' : 'impar';
    return { status: parity === choice ? 'won' : 'lost', roll, parity };
}

module.exports = {
    ANAGRAM_WORDS,
    createHigherLowerGame,
    playHigherLower,
    createSecretNumberGame,
    guessSecretNumber,
    createAnagramGame,
    answerAnagram,
    createMemoryGame,
    answerMemory,
    playOddEven
};
