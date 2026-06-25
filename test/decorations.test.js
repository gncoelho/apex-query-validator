const assert = require('assert');
const { computeMatchOffsets } = require('../extension');

suite('computeMatchOffsets', () => {
    test('returns no offsets for no matches', () => {
        assert.deepStrictEqual(computeMatchOffsets('some text', []), []);
    });

    test('computes the correct start/end offset for a single match', () => {
        const text = 'List<Account> accounts = [SELECT Id FROM Account];';
        const match = '[SELECT Id FROM Account]';
        const offsets = computeMatchOffsets(text, [match]);

        assert.strictEqual(offsets.length, 1);
        assert.strictEqual(offsets[0].start, text.indexOf(match));
        assert.strictEqual(offsets[0].end, text.indexOf(match) + match.length);
        assert.strictEqual(text.slice(offsets[0].start, offsets[0].end), match);
    });

    test('gives distinct, correctly-offset ranges for the same query repeated twice', () => {
        const match = '[SELECT Id FROM Account]';
        const text = `${match} some code in between ${match}`;
        const offsets = computeMatchOffsets(text, [match, match]);

        assert.strictEqual(offsets.length, 2);
        assert.notStrictEqual(offsets[0].start, offsets[1].start);
        assert.ok(offsets[1].start > offsets[0].end);
        assert.strictEqual(text.slice(offsets[0].start, offsets[0].end), match);
        assert.strictEqual(text.slice(offsets[1].start, offsets[1].end), match);
    });

    test('computes offsets in order for a mix of distinct matches', () => {
        const soqlMatch = '[SELECT Id FROM Account]';
        const soslMatch = 'FIND {John} IN Name Fields';
        const text = `${soqlMatch} -- ${soslMatch}`;
        const offsets = computeMatchOffsets(text, [soqlMatch, soslMatch]);

        assert.strictEqual(text.slice(offsets[0].start, offsets[0].end), soqlMatch);
        assert.strictEqual(text.slice(offsets[1].start, offsets[1].end), soslMatch);
    });
});
