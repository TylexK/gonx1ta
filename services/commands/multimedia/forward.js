function getPollPayload(message) {
    const poll = message?.pollCreationMessageV3
        || message?.pollCreationMessageV2
        || message?.pollCreationMessage;
    if (!poll || typeof poll.name !== 'string' || !Array.isArray(poll.options)) return null;

    const values = poll.options
        .map(option => option?.optionName)
        .filter(optionName => typeof optionName === 'string' && optionName.length > 0);
    if (values.length < 2) return null;

    const selectableCount = Number(poll.selectableOptionsCount);
    if (!Number.isInteger(selectableCount) || selectableCount < 0 || selectableCount > values.length) return null;

    return {
        name: poll.name,
        values,
        selectableCount
    };
}

module.exports = { getPollPayload };
