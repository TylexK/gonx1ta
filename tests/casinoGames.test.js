const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createHigherLowerGame,
    playHigherLower,
    createSecretNumberGame,
    guessSecretNumber,
    createAnagramGame,
    answerAnagram,
    createMemoryGame,
    answerMemory,
    playOddEven
} = require('../services/commands/games/casinoGames');

test('higher or lower resolves a correct prediction', () => {
    const game = createHigherLowerGame(() => 0);
    assert.deepEqual(playHigherLower(game, 'mayor', () => 0.99), {
        status: 'won',
        previous: 1,
        next: 13
    });
});

test('secret number provides hints and detects a win', () => {
    const game = createSecretNumberGame(() => 0.41);
    assert.equal(game.number, 42);
    assert.equal(guessSecretNumber(game, 20).status, 'higher');
    assert.equal(guessSecretNumber(game, 42).status, 'won');
});

test('anagram and memory validate answers', () => {
    const anagram = createAnagramGame(() => 0);
    assert.equal(answerAnagram(anagram, 'PLANETA').status, 'won');

    const memory = createMemoryGame(() => 0, 2);
    assert.equal(answerMemory(memory, '🍎 🍎').status, 'won');
    assert.equal(answerMemory(memory, '🍎').status, 'invalid');
});

test('odd or even reports the rolled value', () => {
    assert.deepEqual(playOddEven('impar', () => 0), {
        status: 'won',
        roll: 1,
        parity: 'impar'
    });
});
