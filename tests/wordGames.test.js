const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createHangmanGame,
    getHangmanMask,
    guessHangmanLetter,
    normalizeGameAnswer
} = require('../services/commands/games/wordGames');

test('hangman keeps its progress between guesses and reveals spaces', () => {
    const game = createHangmanGame('kenny bot');

    assert.equal(getHangmanMask(game), '_____ ___');
    assert.equal(guessHangmanLetter(game, 'k').status, 'correct');
    assert.equal(getHangmanMask(game), 'k____ ___');
    assert.equal(guessHangmanLetter(game, 'b').status, 'correct');
    assert.equal(getHangmanMask(game), 'k____ b__');
});

test('hangman validates guesses and does not penalize repeated letters', () => {
    const game = createHangmanGame('bot');

    assert.equal(guessHangmanLetter(game, '').status, 'invalid');
    assert.equal(guessHangmanLetter(game, 'bo').status, 'invalid');
    assert.equal(game.intentos, 6);
    assert.equal(guessHangmanLetter(game, 'x').status, 'wrong');
    assert.equal(game.intentos, 5);
    assert.equal(guessHangmanLetter(game, 'x').status, 'duplicate');
    assert.equal(game.intentos, 5);
});

test('hangman detects a win and a loss', () => {
    const winningGame = createHangmanGame('bot');
    assert.equal(guessHangmanLetter(winningGame, 'b').status, 'correct');
    assert.equal(guessHangmanLetter(winningGame, 'o').status, 'correct');
    assert.equal(guessHangmanLetter(winningGame, 't').status, 'won');

    const losingGame = createHangmanGame('a', 1);
    assert.equal(guessHangmanLetter(losingGame, 'z').status, 'lost');
});

test('riddle answers ignore accents, case, and punctuation', () => {
    assert.equal(normalizeGameAnswer('PLATANO!'), normalizeGameAnswer('plátano'));
    assert.equal(normalizeGameAnswer('  ¿El Caballo?  '), normalizeGameAnswer('el caballo'));
});
