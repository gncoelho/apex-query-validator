const assert = require('assert');
const {
    findQueries,
    isExemptFile,
    matchesGlob,
    buildSummaryMessage
} = require('../validator');

suite('validator', () => {
    suite('findQueries', () => {
        test('finds a single SOQL query with correct offsets', () => {
            const text = "List<Account> a = [SELECT Id FROM Account];";
            const results = findQueries(text);
            assert.strictEqual(results.length, 1);
            assert.strictEqual(results[0].type, 'SOQL');
            assert.strictEqual(text.slice(results[0].start, results[0].end), results[0].match);
        });

        test('returns distinct correct offsets for duplicate SOQL queries', () => {
            const query = '[SELECT Id FROM Account]';
            const text = `List<Account> a1 = ${query}; List<Account> a2 = ${query};`;
            const results = findQueries(text);
            assert.strictEqual(results.length, 2);
            assert.notStrictEqual(results[0].start, results[1].start);
            assert.strictEqual(text.slice(results[0].start, results[0].end), query);
            assert.strictEqual(text.slice(results[1].start, results[1].end), query);
            assert.ok(results[1].start > text.indexOf(query));
        });

        test('matches SOQL with WHERE, GROUP BY, ORDER BY and LIMIT clauses', () => {
            const text = "[SELECT Id FROM Account WHERE Name = 'x' GROUP BY Id ORDER BY Id LIMIT 10]";
            const results = findQueries(text);
            assert.strictEqual(results.length, 1);
            assert.strictEqual(results[0].match, text);
        });

        test('matches real bracketed, quoted SOSL syntax', () => {
            const text = "[FIND 'John' IN NAME FIELDS RETURNING Contact(Id, Name)]";
            const results = findQueries(text);
            assert.strictEqual(results.length, 1);
            assert.strictEqual(results[0].type, 'SOSL');
        });

        test('matches SOSL with double-quoted term and ALL FIELDS scope', () => {
            const text = '[FIND "Acme" IN ALL FIELDS]';
            const results = findQueries(text);
            assert.strictEqual(results.length, 1);
            assert.strictEqual(results[0].type, 'SOSL');
        });

        test('does not match legacy unbracketed curly-brace SOSL syntax', () => {
            const text = 'String s = FIND {John} IN Name Fields;';
            const results = findQueries(text);
            assert.strictEqual(results.length, 0);
        });

        test('returns an empty array when no queries are present', () => {
            const results = findQueries('public class Foo { void bar() {} }');
            assert.deepStrictEqual(results, []);
        });
    });

    suite('isExemptFile', () => {
        test('exempts default dao/test filenames case-insensitively', () => {
            assert.strictEqual(isExemptFile('/src/AccountDAO.cls', ['dao', 'test']), true);
            assert.strictEqual(isExemptFile('/src/AccountTest.cls', ['dao', 'test']), true);
        });

        test('does not exempt unrelated filenames', () => {
            assert.strictEqual(isExemptFile('/src/AccountController.cls', ['dao', 'test']), false);
        });

        test('respects a custom keyword list', () => {
            assert.strictEqual(isExemptFile('/src/AccountRepository.cls', ['repository']), true);
            assert.strictEqual(isExemptFile('/src/AccountDAO.cls', ['repository']), false);
        });
    });

    suite('matchesGlob', () => {
        test('matches default .cls and .trigger globs', () => {
            const globs = ['**/*.cls', '**/*.trigger'];
            assert.strictEqual(matchesGlob('/src/classes/MyClass.cls', globs), true);
            assert.strictEqual(matchesGlob('/src/triggers/MyTrigger.trigger', globs), true);
        });

        test('does not match unrelated extensions', () => {
            const globs = ['**/*.cls', '**/*.trigger'];
            assert.strictEqual(matchesGlob('/src/extension.js', globs), false);
            assert.strictEqual(matchesGlob('/docs/README.md', globs), false);
        });

        test('honors a custom glob list', () => {
            assert.strictEqual(matchesGlob('/src/classes/MyClass.cls-meta.xml', ['**/*.cls-meta.xml']), true);
        });
    });

    suite('buildSummaryMessage', () => {
        test('does not call violations "valid" when queries are found', () => {
            const message = buildSummaryMessage(2, 1);
            assert.ok(!/valid/i.test(message));
            assert.ok(message.includes('should be moved to a DAO class'));
        });

        test('reports no queries found when counts are zero', () => {
            const message = buildSummaryMessage(0, 0);
            assert.ok(message.includes('No SOQL queries found'));
            assert.ok(message.includes('No SOSL queries found'));
        });
    });
});
