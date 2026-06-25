const assert = require('assert');
const { findSoqlMatches, findSoslMatches, buildResultMessage } = require('../extension');

suite('findSoqlMatches', () => {
    test('returns no matches for text without SOQL queries', () => {
        assert.deepStrictEqual(findSoqlMatches('public class Foo {}'), []);
    });

    test('returns one match for a single SOQL query', () => {
        const text = "List<Account> accounts = [SELECT Id, Name FROM Account];";
        assert.deepStrictEqual(findSoqlMatches(text), ['[SELECT Id, Name FROM Account]']);
    });

    test('returns multiple matches for multiple SOQL queries', () => {
        const text = "List<Account> a = [SELECT Id FROM Account];\nList<Contact> c = [SELECT Id FROM Contact];";
        assert.deepStrictEqual(findSoqlMatches(text), ['[SELECT Id FROM Account]', '[SELECT Id FROM Contact]']);
    });
});

suite('findSoslMatches', () => {
    test('returns no matches for text without SOSL queries', () => {
        assert.deepStrictEqual(findSoslMatches('public class Foo {}'), []);
    });

    test('returns one match for a single SOSL query', () => {
        const text = "String q = FIND {John} IN Name Fields;";
        assert.deepStrictEqual(findSoslMatches(text), ['FIND {John} IN Name Fields']);
    });

    test('returns multiple matches for multiple SOSL queries', () => {
        const text = "String q1 = FIND {John} IN Name Fields;\nString q2 = FIND {Jane} IN Email Fields;";
        assert.deepStrictEqual(findSoslMatches(text), ['FIND {John} IN Name Fields', 'FIND {Jane} IN Email Fields']);
    });
});

suite('buildResultMessage', () => {
    test('reports no queries found when both lists are empty', () => {
        assert.strictEqual(
            buildResultMessage([], []),
            'No valid SOQL queries found.\nNo valid SOSL queries found.\n'
        );
    });

    test('reports a single SOQL match and no SOSL matches', () => {
        assert.strictEqual(
            buildResultMessage(['[SELECT Id FROM Account]'], []),
            '1 valid SOQL queries found.\nNo valid SOSL queries found.\n'
        );
    });

    test('reports multiple SOSL matches and no SOQL matches', () => {
        assert.strictEqual(
            buildResultMessage([], ['FIND {John} IN Name Fields', 'FIND {Jane} IN Email Fields']),
            'No valid SOQL queries found.\n2 valid SOSL queries found.\n'
        );
    });

    test('reports both SOQL and SOSL matches together', () => {
        assert.strictEqual(
            buildResultMessage(['[SELECT Id FROM Account]'], ['FIND {John} IN Name Fields']),
            '1 valid SOQL queries found.\n1 valid SOSL queries found.\n'
        );
    });
});
