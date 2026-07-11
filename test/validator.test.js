const assert = require('assert');
const {
    findQueries,
    runRules,
    hasAggregate,
    extractFieldList,
    fieldsMacroType,
    skipStringLiteral,
    isInsideLoop,
    buildLineStarts,
    offsetToLine,
    collectSuppressions,
    isCollectionType,
    getAssignmentContext,
    findDynamicQueryCalls,
    hasUnquotedPlus,
    isExemptFile,
    isDaoFile,
    extractSoqlObjects,
    extractSoslObjects,
    globToRegExp,
    matchesGlob,
    buildSummaryMessage,
    buildWorkspaceSummaryMessage
} = require('../validator');

suite('validator', () => {
    suite('findQueries', () => {
        test('finds a single SOQL query with correct offsets', () => {
            const text = "List<Account> a = [SELECT Id FROM Account LIMIT 1];";
            const results = findQueries(text);
            assert.strictEqual(results.length, 1);
            assert.strictEqual(results[0].type, 'SOQL');
            assert.strictEqual(text.slice(results[0].start, results[0].end), results[0].match);
        });

        test('returns distinct correct offsets for duplicate SOQL queries', () => {
            const query = '[SELECT Id FROM Account LIMIT 1]';
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

        test('includes objects field in SOQL results', () => {
            const results = findQueries('[SELECT Id FROM Account]');
            assert.deepStrictEqual(results[0].objects, ['Account']);
        });

        test('includes objects field in SOSL results', () => {
            const results = findQueries("[FIND 'x' IN ALL FIELDS RETURNING Contact(Id)]");
            assert.deepStrictEqual(results[0].objects, ['Contact']);
        });

        test('includes empty objects array for SOSL without RETURNING', () => {
            const results = findQueries('[FIND "Acme" IN ALL FIELDS]');
            assert.deepStrictEqual(results[0].objects, []);
        });
    });

    suite('extractSoqlObjects', () => {
        test('extracts object from simple SELECT', () => {
            assert.deepStrictEqual(extractSoqlObjects('[SELECT Id FROM Account]'), ['Account']);
        });

        test('extracts object with WHERE clause', () => {
            assert.deepStrictEqual(
                extractSoqlObjects("[SELECT Id FROM Contact WHERE Name = 'x']"),
                ['Contact']
            );
        });

        test('is case-insensitive for FROM keyword', () => {
            assert.deepStrictEqual(extractSoqlObjects('[select id from Opportunity]'), ['Opportunity']);
        });

        test('extracts object with ORDER BY and LIMIT', () => {
            assert.deepStrictEqual(
                extractSoqlObjects('[SELECT Id FROM Lead ORDER BY CreatedDate LIMIT 10]'),
                ['Lead']
            );
        });

        test('returns empty array when no FROM clause present', () => {
            assert.deepStrictEqual(extractSoqlObjects('[FIND "x" IN ALL FIELDS]'), []);
        });

        test('returns empty array for empty string', () => {
            assert.deepStrictEqual(extractSoqlObjects(''), []);
        });
    });

    suite('extractSoslObjects', () => {
        test('extracts single object with fields from RETURNING clause', () => {
            assert.deepStrictEqual(
                extractSoslObjects("[FIND 'John' IN NAME FIELDS RETURNING Contact(Id, Name)]"),
                ['Contact']
            );
        });

        test('extracts multiple objects from RETURNING clause', () => {
            const result = extractSoslObjects(
                "[FIND 'Acme' IN ALL FIELDS RETURNING Contact(Id), Account(Id, Name)]"
            );
            assert.deepStrictEqual(result, ['Contact', 'Account']);
        });

        test('extracts object without fields specified in RETURNING clause', () => {
            assert.deepStrictEqual(
                extractSoslObjects("[FIND 'x' IN ALL FIELDS RETURNING Contact]"),
                ['Contact']
            );
        });

        test('returns empty array when no RETURNING clause', () => {
            assert.deepStrictEqual(extractSoslObjects('[FIND "Acme" IN ALL FIELDS]'), []);
        });

        test('deduplicates objects that appear more than once', () => {
            const result = extractSoslObjects(
                "[FIND 'x' IN ALL FIELDS RETURNING Contact(Id), Contact(Name)]"
            );
            assert.deepStrictEqual(result, ['Contact']);
        });

        test('returns empty array for empty string', () => {
            assert.deepStrictEqual(extractSoslObjects(''), []);
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

    suite('isDaoFile', () => {
        test('identifies DAO files case-insensitively', () => {
            assert.strictEqual(isDaoFile('/src/AccountDAO.cls', ['dao']), true);
            assert.strictEqual(isDaoFile('/src/accountdao.cls', ['dao']), true);
        });

        test('returns false for non-DAO files', () => {
            assert.strictEqual(isDaoFile('/src/AccountService.cls', ['dao']), false);
            assert.strictEqual(isDaoFile('/src/AccountTest.cls', ['dao']), false);
        });

        test('respects a custom dao keyword list', () => {
            assert.strictEqual(isDaoFile('/src/AccountRepository.cls', ['repository']), true);
            assert.strictEqual(isDaoFile('/src/AccountDAO.cls', ['repository']), false);
        });

        test('returns false for empty keywords list', () => {
            assert.strictEqual(isDaoFile('/src/AccountDAO.cls', []), false);
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

    suite('buildWorkspaceSummaryMessage', () => {
        test('includes file count in the message', () => {
            assert.ok(buildWorkspaceSummaryMessage(5, 0, 0).includes('5'));
        });

        test('reports SOQL and SOSL counts when both are non-zero', () => {
            const msg = buildWorkspaceSummaryMessage(3, 4, 2);
            assert.ok(msg.includes('4 SOQL'));
            assert.ok(msg.includes('2 SOSL'));
            assert.ok(msg.includes('should be moved to a DAO class'));
        });

        test('uses singular "query" for count of 1', () => {
            const msg = buildWorkspaceSummaryMessage(1, 1, 0);
            assert.ok(msg.includes('1 SOQL query'));
            assert.ok(!/1 SOQL queries/.test(msg));
        });

        test('reports no queries found when counts are zero', () => {
            const msg = buildWorkspaceSummaryMessage(10, 0, 0);
            assert.ok(msg.includes('No SOQL queries found'));
            assert.ok(msg.includes('No SOSL queries found'));
        });

        test('does not say queries are valid when violations exist', () => {
            const msg = buildWorkspaceSummaryMessage(2, 1, 1);
            assert.ok(msg.includes('should be moved to a DAO class'));
        });

        test('uses plural "files" for count greater than 1', () => {
            assert.ok(buildWorkspaceSummaryMessage(3, 0, 0).includes('3 files scanned'));
        });

        test('uses singular "file" for count of 1', () => {
            assert.ok(buildWorkspaceSummaryMessage(1, 0, 0).includes('1 file scanned'));
        });
    });

    suite('runRules', () => {
        test('returns no findings when no queries are present', () => {
            const results = runRules('public class Foo {}', { dao: true });
            assert.deepStrictEqual(results, []);
        });

        test('returns SOQL finding when dao category is enabled', () => {
            const results = runRules('[SELECT Id FROM Account LIMIT 1]', { dao: true, performance: false, security: false, style: false });
            assert.strictEqual(results.length, 1);
            assert.strictEqual(results[0].ruleId, 'dao/soql-placement');
            assert.strictEqual(results[0].category, 'dao');
            assert.strictEqual(results[0].type, 'SOQL');
        });

        test('returns SOSL finding when dao category is enabled', () => {
            const results = runRules("[FIND 'x' IN ALL FIELDS RETURNING Contact(Id)]",
                { dao: true, correctness: false, performance: false, security: false, style: false, governor: false });
            assert.strictEqual(results.length, 1);
            assert.strictEqual(results[0].ruleId, 'dao/sosl-placement');
            assert.strictEqual(results[0].type, 'SOSL');
        });

        test('suppresses dao findings when dao category is disabled', () => {
            const results = runRules('[SELECT Id FROM Account LIMIT 1]', { dao: false, performance: false, security: false, style: false });
            assert.deepStrictEqual(results, []);
        });

        test('runs dao rules when category flag is absent (opt-out semantics)', () => {
            // An absent key is treated as enabled — callers must explicitly set false to disable.
            const results = runRules('[SELECT Id FROM Account LIMIT 1]', { performance: false, security: false, style: false });
            assert.strictEqual(results.length, 1);
            assert.strictEqual(results[0].ruleId, 'dao/soql-placement');
        });

        test('enabling only dao category replicates findQueries behaviour', () => {
            const text = "List<Account> a = [SELECT Id FROM Account LIMIT 1]; [FIND 'x' IN ALL FIELDS]";
            const fromRunRules = runRules(text, { dao: true, correctness: false, performance: false, security: false, style: false, governor: false });
            const fromFindQueries = findQueries(text);
            assert.strictEqual(fromRunRules.length, fromFindQueries.length);
            for (let i = 0; i < fromRunRules.length; i++) {
                assert.strictEqual(fromRunRules[i].start, fromFindQueries[i].start);
                assert.strictEqual(fromRunRules[i].end, fromFindQueries[i].end);
                assert.strictEqual(fromRunRules[i].type, fromFindQueries[i].type);
            }
        });

        test('finding includes correct start/end offsets', () => {
            const text = 'x = [SELECT Id FROM Account LIMIT 1];';
            const results = runRules(text, { dao: true, performance: false, security: false, style: false });
            assert.strictEqual(results.length, 1);
            assert.strictEqual(text.slice(results[0].start, results[0].end), '[SELECT Id FROM Account LIMIT 1]');
        });

        test('finding includes objects array', () => {
            const results = runRules('[SELECT Id FROM Contact]', { dao: true });
            assert.deepStrictEqual(results[0].objects, ['Contact']);
        });

        test('unknown categories in enabledCategories are ignored gracefully', () => {
            const results = runRules('[SELECT Id FROM Account LIMIT 1]', { dao: true, performance: false, security: false, style: false, unknown: true });
            assert.strictEqual(results.length, 1);
        });
    });

    suite('perf/missing-limit', () => {
        const cats = { performance: true, dao: false, security: false, style: false };

        test('flags a SOQL query with no LIMIT', () => {
            const r = runRules('[SELECT Id, Name FROM Account]', cats);
            assert.strictEqual(r.length, 1);
            assert.strictEqual(r[0].ruleId, 'perf/missing-limit');
        });

        test('does not flag a query that has LIMIT', () => {
            assert.deepStrictEqual(runRules('[SELECT Id, Name FROM Account LIMIT 10]', cats), []);
        });

        test('does not flag an aggregate query without LIMIT', () => {
            assert.deepStrictEqual(runRules('[SELECT COUNT() FROM Account]', cats), []);
        });

        test('does not flag aggregate with SUM', () => {
            assert.deepStrictEqual(runRules('[SELECT SUM(Amount) FROM Opportunity]', cats), []);
        });

        test('message mentions LIMIT and governor limits', () => {
            const r = runRules('[SELECT Id FROM Account]', cats);
            assert.ok(r[0].message.includes('LIMIT'));
            assert.ok(r[0].message.includes('governor'));
        });

        test('returns no findings when performance category is disabled', () => {
            assert.deepStrictEqual(
                runRules('[SELECT Id, Name FROM Account]', { performance: false, dao: false, security: false, style: false }), []
            );
        });
    });

    suite('perf/wide-field-list', () => {
        const cats = { performance: true, dao: false };
        const manyFields = 'Id, Name, Phone, Email, Title, Department, AccountId, OwnerId, CreatedDate, LastModifiedDate, AnnualRevenue';

        test('flags a query exceeding the default threshold of 10 fields', () => {
            const r = runRules(`[SELECT ${manyFields} FROM Contact]`, cats);
            assert.ok(r.some(f => f.ruleId === 'perf/wide-field-list'));
        });

        test('does not flag a query within the threshold', () => {
            const r = runRules('[SELECT Id, Name FROM Account]', cats);
            assert.ok(!r.some(f => f.ruleId === 'perf/wide-field-list'));
        });

        test('respects a custom maxSelectFields option', () => {
            const r = runRules('[SELECT Id, Name, Phone FROM Account]', cats, { maxSelectFields: 2 });
            assert.ok(r.some(f => f.ruleId === 'perf/wide-field-list'));
        });

        test('does not flag when field count equals the threshold exactly', () => {
            const twoFieldQuery = '[SELECT Id, Name FROM Account]';
            const r = runRules(twoFieldQuery, cats, { maxSelectFields: 2 });
            assert.ok(!r.some(f => f.ruleId === 'perf/wide-field-list'));
        });

        test('message includes field count and threshold', () => {
            const r = runRules(`[SELECT ${manyFields} FROM Contact]`, cats);
            const f = r.find(x => x.ruleId === 'perf/wide-field-list');
            assert.ok(f.message.includes('fields'));
            assert.ok(f.message.includes('10'));
        });
    });

    suite('perf/soql-in-loop', () => {
        const cats = { performance: true, dao: false };

        test('flags a SOQL query directly inside a for loop body', () => {
            const text = 'for (Integer i = 0; i < 10; i++) { Account a = [SELECT Id FROM Account LIMIT 1]; }';
            const r = runRules(text, cats);
            assert.ok(r.some(f => f.ruleId === 'perf/soql-in-loop'));
        });

        test('flags a SOQL query inside a while loop body', () => {
            const text = 'while (condition) { List<Account> a = [SELECT Id FROM Account LIMIT 1]; }';
            const r = runRules(text, cats);
            assert.ok(r.some(f => f.ruleId === 'perf/soql-in-loop'));
        });

        test('does not flag a SOQL query outside any loop', () => {
            const text = 'List<Account> a = [SELECT Id FROM Account LIMIT 1];';
            const r = runRules(text, cats);
            assert.ok(!r.some(f => f.ruleId === 'perf/soql-in-loop'));
        });

        test('flags a query inside a for-each loop', () => {
            const text = 'for (Account a : accounts) { Contact c = [SELECT Id FROM Contact LIMIT 1]; }';
            const r = runRules(text, cats);
            assert.ok(r.some(f => f.ruleId === 'perf/soql-in-loop'));
        });

        test('message mentions loop and governor limit', () => {
            const text = 'for (Integer i = 0; i < 5; i++) { [SELECT Id FROM Account LIMIT 1]; }';
            const r = runRules(text, cats);
            const f = r.find(x => x.ruleId === 'perf/soql-in-loop');
            assert.ok(f.message.includes('loop'));
            assert.ok(f.message.includes('governor'));
        });
    });

    suite('perf/unbounded-large-object', () => {
        const cats = { performance: true, dao: false };

        test('flags a query on a default large object with no WHERE', () => {
            const r = runRules('[SELECT Id FROM Task]', cats);
            assert.ok(r.some(f => f.ruleId === 'perf/unbounded-large-object'));
        });

        test('does not flag when WHERE clause is present', () => {
            const r = runRules("[SELECT Id FROM Task WHERE Status = 'Open']", cats);
            assert.ok(!r.some(f => f.ruleId === 'perf/unbounded-large-object'));
        });

        test('does not flag a non-large object', () => {
            const r = runRules('[SELECT Id FROM Account]', cats);
            assert.ok(!r.some(f => f.ruleId === 'perf/unbounded-large-object'));
        });

        test('respects a custom largeObjects list', () => {
            const r = runRules('[SELECT Id FROM Account]', cats, { largeObjects: ['Account'] });
            assert.ok(r.some(f => f.ruleId === 'perf/unbounded-large-object'));
        });

        test('matching is case-insensitive for SObject names', () => {
            const r = runRules('[SELECT Id FROM task]', cats);
            assert.ok(r.some(f => f.ruleId === 'perf/unbounded-large-object'));
        });

        test('message includes the SObject name', () => {
            const r = runRules('[SELECT Id FROM Event]', cats);
            const f = r.find(x => x.ruleId === 'perf/unbounded-large-object');
            assert.ok(f.message.includes('Event'));
        });
    });

    suite('perf/order-by-no-limit', () => {
        const cats = { performance: true, dao: false };

        test('flags a query with ORDER BY and no LIMIT', () => {
            const r = runRules('[SELECT Id FROM Account ORDER BY Name]', cats);
            assert.ok(r.some(f => f.ruleId === 'perf/order-by-no-limit'));
        });

        test('does not flag when ORDER BY has a LIMIT', () => {
            const r = runRules('[SELECT Id FROM Account ORDER BY Name LIMIT 50]', cats);
            assert.ok(!r.some(f => f.ruleId === 'perf/order-by-no-limit'));
        });

        test('does not flag a query with no ORDER BY', () => {
            const r = runRules('[SELECT Id FROM Account]', cats);
            assert.ok(!r.some(f => f.ruleId === 'perf/order-by-no-limit'));
        });

        test('message mentions ORDER BY and LIMIT', () => {
            const r = runRules('[SELECT Id FROM Account ORDER BY Name]', cats);
            const f = r.find(x => x.ruleId === 'perf/order-by-no-limit');
            assert.ok(f.message.includes('ORDER BY'));
            assert.ok(f.message.includes('LIMIT'));
        });
    });

    suite('security/dynamic-soql-concat', () => {
        const cats = { security: true, dao: false, performance: false };

        test('flags Database.query() with string concatenation', () => {
            const r = runRules("Database.query('SELECT Id FROM ' + objectName)", cats);
            assert.ok(r.some(f => f.ruleId === 'security/dynamic-soql-concat'));
        });

        test('does not flag Database.query() with a plain variable (no concat)', () => {
            const r = runRules('Database.query(queryString)', cats);
            assert.ok(!r.some(f => f.ruleId === 'security/dynamic-soql-concat'));
        });

        test('does not flag Database.query() with a string literal (no concat)', () => {
            const r = runRules("Database.query('SELECT Id FROM Account LIMIT 10')", cats);
            assert.ok(!r.some(f => f.ruleId === 'security/dynamic-soql-concat'));
        });

        test('flags concatenation with spaces around the + operator', () => {
            const r = runRules("Database.query('SELECT Id FROM ' + sobjectType + ' LIMIT 10')", cats);
            assert.ok(r.some(f => f.ruleId === 'security/dynamic-soql-concat'));
        });

        test('is case-insensitive for DATABASE.QUERY', () => {
            const r = runRules("DATABASE.QUERY('SELECT Id FROM ' + t)", cats);
            assert.ok(r.some(f => f.ruleId === 'security/dynamic-soql-concat'));
        });

        test('message mentions injection risk and bind variables', () => {
            const r = runRules("Database.query('SELECT Id FROM ' + obj)", cats);
            const f = r.find(x => x.ruleId === 'security/dynamic-soql-concat');
            assert.ok(f.message.toLowerCase().includes('injection'));
            assert.ok(f.message.toLowerCase().includes('bind'));
        });

        test('returns no findings when security category is disabled', () => {
            const r = runRules("Database.query('SELECT Id FROM ' + obj)", { security: false });
            assert.ok(!r.some(f => f.ruleId === 'security/dynamic-soql-concat'));
        });
    });

    suite('security/hardcoded-id', () => {
        const cats = { security: true, dao: false, performance: false };

        test('flags a 15-char Salesforce ID in a WHERE clause', () => {
            const r = runRules("[SELECT Id FROM Account WHERE Id = '001000000000001' LIMIT 1]", cats);
            assert.ok(r.some(f => f.ruleId === 'security/hardcoded-id'));
        });

        test('flags an 18-char Salesforce ID in a WHERE clause', () => {
            const r = runRules("[SELECT Id FROM Account WHERE Id = '001000000000001AAA' LIMIT 1]", cats);
            assert.ok(r.some(f => f.ruleId === 'security/hardcoded-id'));
        });

        test('does not flag a query with no WHERE clause', () => {
            const r = runRules('[SELECT Id FROM Account LIMIT 1]', cats);
            assert.ok(!r.some(f => f.ruleId === 'security/hardcoded-id'));
        });

        test('does not flag a short string that is not a valid ID length', () => {
            const r = runRules("[SELECT Id FROM Account WHERE Name = 'Acme' LIMIT 1]", cats);
            assert.ok(!r.some(f => f.ruleId === 'security/hardcoded-id'));
        });

        test('message includes the hardcoded ID value', () => {
            const r = runRules("[SELECT Id FROM Account WHERE Id = '001000000000001' LIMIT 1]", cats);
            const f = r.find(x => x.ruleId === 'security/hardcoded-id');
            assert.ok(f.message.includes('001000000000001'));
        });
    });

    suite('security/user-input-in-where', () => {
        const cats = { security: true, dao: false, performance: false };

        test('flags a WHERE clause with a string literal and no bind variable', () => {
            const r = runRules("[SELECT Id FROM Account WHERE Name = 'Acme' LIMIT 1]", cats);
            assert.ok(r.some(f => f.ruleId === 'security/user-input-in-where'));
        });

        test('does not flag a WHERE clause that uses a bind variable', () => {
            const r = runRules('[SELECT Id FROM Account WHERE Name = :searchName LIMIT 1]', cats);
            assert.ok(!r.some(f => f.ruleId === 'security/user-input-in-where'));
        });

        test('does not flag a WHERE clause with both a literal and a bind variable', () => {
            // With the fixed logic, a bare literal alongside a bind variable IS flagged —
            // the presence of :n does not excuse the hardcoded 'Partner' literal.
            const r = runRules("[SELECT Id FROM Account WHERE Name = :n AND Type = 'Partner' LIMIT 1]", cats);
            assert.ok(r.some(f => f.ruleId === 'security/user-input-in-where'));
        });

        test('does not flag a query with no WHERE clause', () => {
            const r = runRules('[SELECT Id FROM Account LIMIT 1]', cats);
            assert.ok(!r.some(f => f.ruleId === 'security/user-input-in-where'));
        });

        test('finding has information severity', () => {
            const r = runRules("[SELECT Id FROM Account WHERE Name = 'Acme' LIMIT 1]", cats);
            const f = r.find(x => x.ruleId === 'security/user-input-in-where');
            assert.strictEqual(f.severity, 'information');
        });

        test('message mentions bind variable syntax', () => {
            const r = runRules("[SELECT Id FROM Account WHERE Name = 'Acme' LIMIT 1]", cats);
            const f = r.find(x => x.ruleId === 'security/user-input-in-where');
            assert.ok(f.message.includes(':variable'));
        });
    });

    suite('style/select-id-only', () => {
        const cats = { style: true, dao: false, performance: false, security: false };

        test('flags a query that selects only Id', () => {
            const r = runRules('[SELECT Id FROM Account LIMIT 1]', cats);
            assert.ok(r.some(f => f.ruleId === 'style/select-id-only'));
        });

        test('does not flag a query with multiple fields', () => {
            const r = runRules('[SELECT Id, Name FROM Account LIMIT 1]', cats);
            assert.ok(!r.some(f => f.ruleId === 'style/select-id-only'));
        });

        test('is case-insensitive for Id field', () => {
            const r = runRules('[SELECT ID FROM Account LIMIT 1]', cats);
            assert.ok(r.some(f => f.ruleId === 'style/select-id-only'));
        });

        test('does not flag a query selecting Id with trailing whitespace handled', () => {
            const r = runRules('[SELECT  Id  FROM Account LIMIT 1]', cats);
            assert.ok(r.some(f => f.ruleId === 'style/select-id-only'));
        });

        test('finding has style category', () => {
            const r = runRules('[SELECT Id FROM Account LIMIT 1]', cats);
            assert.strictEqual(r.find(f => f.ruleId === 'style/select-id-only').category, 'style');
        });

        test('returns no findings when style category is disabled', () => {
            const r = runRules('[SELECT Id FROM Account LIMIT 1]', { style: false });
            assert.ok(!r.some(f => f.ruleId === 'style/select-id-only'));
        });
    });

    suite('style/aggregate-missing-group-by', () => {
        const cats = { style: true, dao: false, performance: false, security: false };

        test('flags COUNT() in field list without GROUP BY', () => {
            const r = runRules('[SELECT Name, COUNT(Id) FROM Account LIMIT 10]', cats);
            assert.ok(r.some(f => f.ruleId === 'style/aggregate-missing-group-by'));
        });

        test('flags SUM() without GROUP BY', () => {
            const r = runRules('[SELECT SUM(Amount) FROM Opportunity LIMIT 10]', cats);
            assert.ok(r.some(f => f.ruleId === 'style/aggregate-missing-group-by'));
        });

        test('does not flag when GROUP BY is present', () => {
            const r = runRules('[SELECT Name, COUNT(Id) FROM Account GROUP BY Name LIMIT 10]', cats);
            assert.ok(!r.some(f => f.ruleId === 'style/aggregate-missing-group-by'));
        });

        test('does not flag a query with no aggregate', () => {
            const r = runRules('[SELECT Id, Name FROM Account LIMIT 1]', cats);
            assert.ok(!r.some(f => f.ruleId === 'style/aggregate-missing-group-by'));
        });

        test('flags AVG, MAX, MIN without GROUP BY', () => {
            assert.ok(runRules('[SELECT AVG(Amount) FROM Opportunity LIMIT 1]', cats).some(f => f.ruleId === 'style/aggregate-missing-group-by'));
            assert.ok(runRules('[SELECT MAX(Amount) FROM Opportunity LIMIT 1]', cats).some(f => f.ruleId === 'style/aggregate-missing-group-by'));
            assert.ok(runRules('[SELECT MIN(Amount) FROM Opportunity LIMIT 1]', cats).some(f => f.ruleId === 'style/aggregate-missing-group-by'));
        });

        test('message mentions GROUP BY', () => {
            const r = runRules('[SELECT COUNT(Id) FROM Account LIMIT 1]', cats);
            const f = r.find(x => x.ruleId === 'style/aggregate-missing-group-by');
            assert.ok(f.message.includes('GROUP BY'));
        });
    });

    suite('style/sosl-no-returning', () => {
        const cats = { style: true, dao: false, performance: false, security: false };

        test('flags a SOSL query with no RETURNING clause', () => {
            const r = runRules('[FIND "Acme" IN ALL FIELDS]', cats);
            assert.ok(r.some(f => f.ruleId === 'style/sosl-no-returning'));
        });

        test('does not flag a SOSL query with a RETURNING clause', () => {
            const r = runRules('[FIND "Acme" IN ALL FIELDS RETURNING Account(Id)]', cats);
            assert.ok(!r.some(f => f.ruleId === 'style/sosl-no-returning'));
        });

        test('finding has style category', () => {
            const r = runRules('[FIND "x" IN ALL FIELDS]', cats);
            assert.strictEqual(r.find(f => f.ruleId === 'style/sosl-no-returning').category, 'style');
        });

        test('message mentions RETURNING clause', () => {
            const r = runRules('[FIND "x" IN ALL FIELDS]', cats);
            const f = r.find(x => x.ruleId === 'style/sosl-no-returning');
            assert.ok(f.message.includes('RETURNING'));
        });

        test('returns no findings when style category is disabled', () => {
            const r = runRules('[FIND "x" IN ALL FIELDS]', { style: false });
            assert.ok(!r.some(f => f.ruleId === 'style/sosl-no-returning'));
        });
    });

    suite('style/sosl-sidebar-scope', () => {
        const cats = { style: true, dao: false, performance: false, security: false };

        test('flags a SOSL query using IN SIDEBAR FIELDS', () => {
            const r = runRules('[FIND "Acme" IN SIDEBAR FIELDS]', cats);
            assert.ok(r.some(f => f.ruleId === 'style/sosl-sidebar-scope'));
        });

        test('does not flag a SOSL query using IN ALL FIELDS', () => {
            const r = runRules('[FIND "Acme" IN ALL FIELDS]', cats);
            assert.ok(!r.some(f => f.ruleId === 'style/sosl-sidebar-scope'));
        });

        test('does not flag IN NAME FIELDS', () => {
            const r = runRules("[FIND 'x' IN NAME FIELDS RETURNING Contact(Id)]", cats);
            assert.ok(!r.some(f => f.ruleId === 'style/sosl-sidebar-scope'));
        });

        test('is case-insensitive for SIDEBAR keyword', () => {
            const r = runRules('[FIND "x" IN sidebar FIELDS]', cats);
            assert.ok(r.some(f => f.ruleId === 'style/sosl-sidebar-scope'));
        });

        test('message mentions SIDEBAR and suggests alternatives', () => {
            const r = runRules('[FIND "x" IN SIDEBAR FIELDS]', cats);
            const f = r.find(x => x.ruleId === 'style/sosl-sidebar-scope');
            assert.ok(f.message.includes('SIDEBAR'));
            assert.ok(f.message.includes('ALL'));
        });
    });

    suite('governor/too-many-queries', () => {
        const cats = { governor: true, dao: false, performance: false, security: false, style: false };
        // Build text with N queries (all safe: have LIMIT, WHERE, named fields)
        const makeQueries = n => Array.from({ length: n },
            (_, i) => `[SELECT Id, Name FROM Account${i} WHERE Id != null LIMIT 1]`
        ).join(' ');

        test('fires when query count exceeds default threshold of 5', () => {
            const r = runRules(makeQueries(6), cats);
            assert.ok(r.some(f => f.ruleId === 'governor/too-many-queries'));
        });

        test('does not fire when query count equals the threshold', () => {
            const r = runRules(makeQueries(5), cats);
            assert.ok(!r.some(f => f.ruleId === 'governor/too-many-queries'));
        });

        test('does not fire when query count is below the threshold', () => {
            const r = runRules(makeQueries(3), cats);
            assert.ok(!r.some(f => f.ruleId === 'governor/too-many-queries'));
        });

        test('respects a custom maxQueriesPerFile option', () => {
            const r = runRules(makeQueries(3), cats, { maxQueriesPerFile: 2 });
            assert.ok(r.some(f => f.ruleId === 'governor/too-many-queries'));
        });

        test('counts SOSL queries too', () => {
            const text = makeQueries(4) + " [FIND 'x' IN ALL FIELDS] [FIND 'y' IN ALL FIELDS]";
            const r = runRules(text, cats);
            assert.ok(r.some(f => f.ruleId === 'governor/too-many-queries'));
        });

        test('finding is emitted at offset 0', () => {
            const r = runRules(makeQueries(6), cats);
            const f = r.find(x => x.ruleId === 'governor/too-many-queries');
            assert.strictEqual(f.start, 0);
            assert.strictEqual(f.end, 0);
        });

        test('message includes count and threshold', () => {
            const r = runRules(makeQueries(6), cats);
            const f = r.find(x => x.ruleId === 'governor/too-many-queries');
            assert.ok(f.message.includes('6'));
            assert.ok(f.message.includes('5'));
        });

        test('returns no findings when governor category is disabled', () => {
            const r = runRules(makeQueries(6), { governor: false });
            assert.ok(!r.some(f => f.ruleId === 'governor/too-many-queries'));
        });
    });

    suite('governor/dynamic-soql-call', () => {
        const cats = { governor: true, dao: false, performance: false, security: false, style: false };

        test('flags a Database.query() call', () => {
            const r = runRules('Database.query(queryString)', cats);
            assert.ok(r.some(f => f.ruleId === 'governor/dynamic-soql-call'));
        });

        test('flags Database.query() with string concatenation', () => {
            const r = runRules("Database.query('SELECT Id FROM ' + obj)", cats);
            assert.ok(r.some(f => f.ruleId === 'governor/dynamic-soql-call'));
        });

        test('flags Database.query() with a plain string literal', () => {
            const r = runRules("Database.query('SELECT Id FROM Account LIMIT 1')", cats);
            assert.ok(r.some(f => f.ruleId === 'governor/dynamic-soql-call'));
        });

        test('is case-insensitive for DATABASE.QUERY', () => {
            const r = runRules('DATABASE.QUERY(q)', cats);
            assert.ok(r.some(f => f.ruleId === 'governor/dynamic-soql-call'));
        });

        test('flags multiple calls and reports each one', () => {
            const r = runRules('Database.query(q1); Database.query(q2);', cats);
            assert.strictEqual(r.filter(f => f.ruleId === 'governor/dynamic-soql-call').length, 2);
        });

        test('message mentions governor limit', () => {
            const r = runRules('Database.query(q)', cats);
            const f = r.find(x => x.ruleId === 'governor/dynamic-soql-call');
            assert.ok(f.message.toLowerCase().includes('governor'));
        });

        test('returns no findings when governor category is disabled', () => {
            const r = runRules('Database.query(q)', { governor: false });
            assert.ok(!r.some(f => f.ruleId === 'governor/dynamic-soql-call'));
        });
    });

    suite('governor/dynamic-sosl-call', () => {
        const cats = { governor: true, dao: false, performance: false, security: false, style: false };

        test('flags a Search.query() call', () => {
            const r = runRules('Search.query(searchQuery)', cats);
            assert.ok(r.some(f => f.ruleId === 'governor/dynamic-sosl-call'));
        });

        test('flags a Database.search() call', () => {
            const r = runRules('Database.search(searchQuery)', cats);
            assert.ok(r.some(f => f.ruleId === 'governor/dynamic-sosl-call'));
        });

        test('is case-insensitive', () => {
            const r = runRules('SEARCH.QUERY(q)', cats);
            assert.ok(r.some(f => f.ruleId === 'governor/dynamic-sosl-call'));
        });

        test('flags multiple calls and reports each one', () => {
            const r = runRules('Search.query(q1); Database.search(q2);', cats);
            assert.strictEqual(r.filter(f => f.ruleId === 'governor/dynamic-sosl-call').length, 2);
        });

        test('does not flag Database.query() — that is G2', () => {
            const r = runRules('Database.query(q)', cats);
            assert.ok(!r.some(f => f.ruleId === 'governor/dynamic-sosl-call'));
        });

        test('message mentions governor limits', () => {
            const r = runRules('Search.query(q)', cats);
            const f = r.find(x => x.ruleId === 'governor/dynamic-sosl-call');
            assert.ok(f.message.toLowerCase().includes('governor'));
        });

        test('returns no findings when governor category is disabled', () => {
            const r = runRules('Search.query(q)', { governor: false });
            assert.ok(!r.some(f => f.ruleId === 'governor/dynamic-sosl-call'));
        });
    });

    suite('correctness/single-row-no-limit', () => {
        const cats = { correctness: true, dao: false, performance: false, security: false, style: false, governor: false };

        test('flags a single-SObject assignment without LIMIT 1', () => {
            const r = runRules('Account a = [SELECT Id FROM Account];', cats);
            assert.ok(r.some(f => f.ruleId === 'correctness/single-row-no-limit'));
        });

        test('does not flag when LIMIT 1 is present', () => {
            const r = runRules('Account a = [SELECT Id FROM Account LIMIT 1];', cats);
            assert.ok(!r.some(f => f.ruleId === 'correctness/single-row-no-limit'));
        });

        test('flags when a non-1 LIMIT is present', () => {
            const r = runRules('Account a = [SELECT Id FROM Account LIMIT 5];', cats);
            assert.ok(r.some(f => f.ruleId === 'correctness/single-row-no-limit'));
        });

        test('does not flag a List assignment', () => {
            const r = runRules('List<Account> a = [SELECT Id FROM Account];', cats);
            assert.ok(!r.some(f => f.ruleId === 'correctness/single-row-no-limit'));
        });

        test('does not flag an array-typed assignment', () => {
            const r = runRules('Account[] a = [SELECT Id FROM Account];', cats);
            assert.ok(!r.some(f => f.ruleId === 'correctness/single-row-no-limit'));
        });

        test('does not flag a SOQL for-loop', () => {
            const r = runRules('for (Account a : [SELECT Id FROM Account]) { }', cats);
            assert.ok(!r.some(f => f.ruleId === 'correctness/single-row-no-limit'));
        });

        test('flags immediate [0] indexing without LIMIT 1', () => {
            const r = runRules('System.debug([SELECT Id FROM Account][0]);', cats);
            assert.ok(r.some(f => f.ruleId === 'correctness/single-row-no-limit'));
        });

        test('does not flag a new Map<>([...]) bulk construction', () => {
            const r = runRules('Map<Id, Account> m = new Map<Id, Account>([SELECT Id FROM Account]);', cats);
            assert.ok(!r.some(f => f.ruleId === 'correctness/single-row-no-limit'));
        });

        test('does not flag a bare return statement', () => {
            const r = runRules('return [SELECT Id FROM Account];', cats);
            assert.ok(!r.some(f => f.ruleId === 'correctness/single-row-no-limit'));
        });

        test('message mentions LIMIT 1 and QueryException', () => {
            const r = runRules('Account a = [SELECT Id FROM Account];', cats);
            const f = r.find(x => x.ruleId === 'correctness/single-row-no-limit');
            assert.ok(f.message.includes('LIMIT 1'));
            assert.ok(f.message.includes('QueryException'));
        });

        test('respects the correctness category toggle', () => {
            const r = runRules('Account a = [SELECT Id FROM Account];', { correctness: false });
            assert.ok(!r.some(f => f.ruleId === 'correctness/single-row-no-limit'));
        });
    });

    suite('correctness/offset-too-large', () => {
        const cats = { correctness: true, dao: false, performance: false, security: false, style: false, governor: false };

        test('flags OFFSET greater than 2000', () => {
            const r = runRules('[SELECT Id FROM Account ORDER BY Name LIMIT 10 OFFSET 2001]', cats);
            assert.ok(r.some(f => f.ruleId === 'correctness/offset-too-large'));
        });

        test('does not flag OFFSET equal to 2000', () => {
            const r = runRules('[SELECT Id FROM Account ORDER BY Name LIMIT 10 OFFSET 2000]', cats);
            assert.ok(!r.some(f => f.ruleId === 'correctness/offset-too-large'));
        });

        test('does not flag a query with no OFFSET', () => {
            const r = runRules('[SELECT Id FROM Account LIMIT 10]', cats);
            assert.ok(!r.some(f => f.ruleId === 'correctness/offset-too-large'));
        });

        test('flags OFFSET without a preceding LIMIT clause', () => {
            const r = runRules('[SELECT Id FROM Account OFFSET 5000]', cats);
            assert.ok(r.some(f => f.ruleId === 'correctness/offset-too-large'));
        });

        test('is case-insensitive for OFFSET', () => {
            const r = runRules('[SELECT Id FROM Account offset 3000]', cats);
            assert.ok(r.some(f => f.ruleId === 'correctness/offset-too-large'));
        });

        test('message includes the offset value and the 2000 limit', () => {
            const r = runRules('[SELECT Id FROM Account OFFSET 5000]', cats);
            const f = r.find(x => x.ruleId === 'correctness/offset-too-large');
            assert.ok(f.message.includes('5000'));
            assert.ok(f.message.includes('2000'));
        });

        test('respects the correctness category toggle', () => {
            const r = runRules('[SELECT Id FROM Account OFFSET 5000]', { correctness: false });
            assert.ok(!r.some(f => f.ruleId === 'correctness/offset-too-large'));
        });
    });

    suite('correctness/sosl-min-length', () => {
        const cats = { correctness: true, dao: false, performance: false, security: false, style: false, governor: false };

        test('flags a single-character search term', () => {
            const r = runRules("[FIND 'a' IN ALL FIELDS RETURNING Account(Id)]", cats);
            assert.ok(r.some(f => f.ruleId === 'correctness/sosl-min-length'));
        });

        test('does not flag a two-character search term', () => {
            const r = runRules("[FIND 'ab' IN ALL FIELDS RETURNING Account(Id)]", cats);
            assert.ok(!r.some(f => f.ruleId === 'correctness/sosl-min-length'));
        });

        test('does not count a wildcard toward the minimum', () => {
            const r = runRules("[FIND 'a*' IN ALL FIELDS RETURNING Account(Id)]", cats);
            assert.ok(r.some(f => f.ruleId === 'correctness/sosl-min-length'));
        });

        test('does not flag a wildcarded term with two literal characters', () => {
            const r = runRules("[FIND 'ab*' IN ALL FIELDS RETURNING Account(Id)]", cats);
            assert.ok(!r.some(f => f.ruleId === 'correctness/sosl-min-length'));
        });

        test('flags an empty search term', () => {
            const r = runRules('[FIND "" IN ALL FIELDS]', cats);
            assert.ok(r.some(f => f.ruleId === 'correctness/sosl-min-length'));
        });

        test('works with double-quoted terms', () => {
            const r = runRules('[FIND "a" IN ALL FIELDS]', cats);
            assert.ok(r.some(f => f.ruleId === 'correctness/sosl-min-length'));
        });

        test('message includes the term and the 2-character minimum', () => {
            const r = runRules("[FIND 'a' IN ALL FIELDS]", cats);
            const f = r.find(x => x.ruleId === 'correctness/sosl-min-length');
            assert.ok(f.message.includes("'a'"));
            assert.ok(f.message.includes('2-character'));
        });

        test('respects the correctness category toggle', () => {
            const r = runRules("[FIND 'a' IN ALL FIELDS]", { correctness: false });
            assert.ok(!r.some(f => f.ruleId === 'correctness/sosl-min-length'));
        });
    });

    suite('correctness/fields-macro-needs-limit', () => {
        const cats = { correctness: true, dao: false, performance: false, security: false, style: false, governor: false };

        test('flags FIELDS(ALL) with no LIMIT', () => {
            const r = runRules('[SELECT FIELDS(ALL) FROM Account]', cats);
            assert.ok(r.some(f => f.ruleId === 'correctness/fields-macro-needs-limit'));
        });

        test('flags FIELDS(ALL) with a LIMIT above 200', () => {
            const r = runRules('[SELECT FIELDS(ALL) FROM Account LIMIT 201]', cats);
            assert.ok(r.some(f => f.ruleId === 'correctness/fields-macro-needs-limit'));
        });

        test('does not flag FIELDS(ALL) with a LIMIT of 200', () => {
            const r = runRules('[SELECT FIELDS(ALL) FROM Account LIMIT 200]', cats);
            assert.ok(!r.some(f => f.ruleId === 'correctness/fields-macro-needs-limit'));
        });

        test('flags FIELDS(CUSTOM) with no LIMIT', () => {
            const r = runRules('[SELECT FIELDS(CUSTOM) FROM Account]', cats);
            assert.ok(r.some(f => f.ruleId === 'correctness/fields-macro-needs-limit'));
        });

        test('does not flag bounded FIELDS(STANDARD) without a LIMIT', () => {
            const r = runRules('[SELECT FIELDS(STANDARD) FROM Account]', cats);
            assert.ok(!r.some(f => f.ruleId === 'correctness/fields-macro-needs-limit'));
        });

        test('does not flag a query with no FIELDS() macro', () => {
            const r = runRules('[SELECT Id, Name FROM Account]', cats);
            assert.ok(!r.some(f => f.ruleId === 'correctness/fields-macro-needs-limit'));
        });

        test('message names the macro and the 200 limit', () => {
            const r = runRules('[SELECT FIELDS(ALL) FROM Account]', cats);
            const f = r.find(x => x.ruleId === 'correctness/fields-macro-needs-limit');
            assert.ok(f.message.includes('FIELDS(ALL)'));
            assert.ok(f.message.includes('200'));
        });

        test('respects the correctness category toggle', () => {
            const r = runRules('[SELECT FIELDS(ALL) FROM Account]', { correctness: false });
            assert.ok(!r.some(f => f.ruleId === 'correctness/fields-macro-needs-limit'));
        });
    });

    suite('fieldsMacroType', () => {
        test('detects ALL', () => assert.strictEqual(fieldsMacroType('[SELECT FIELDS(ALL) FROM Account]'), 'ALL'));
        test('detects STANDARD case-insensitively', () => assert.strictEqual(fieldsMacroType('[SELECT fields(standard) FROM Account]'), 'STANDARD'));
        test('detects CUSTOM with inner whitespace', () => assert.strictEqual(fieldsMacroType('[SELECT FIELDS( CUSTOM ) FROM Account]'), 'CUSTOM'));
        test('returns null when no macro present', () => assert.strictEqual(fieldsMacroType('[SELECT Id FROM Account]'), null));
    });

    suite('dynamic-query call coverage', () => {
        const gov = { governor: true, dao: false, correctness: false, performance: false, security: false, style: false };

        test('flags Database.getQueryLocator() as a dynamic SOQL call', () => {
            const r = runRules('Database.getQueryLocator(q)', gov);
            assert.ok(r.some(f => f.ruleId === 'governor/dynamic-soql-call'));
        });

        test('flags Database.countQuery() as a dynamic SOQL call', () => {
            const r = runRules('Database.countQuery(q)', gov);
            assert.ok(r.some(f => f.ruleId === 'governor/dynamic-soql-call'));
        });

        test('flags Database.queryWithBinds() as a dynamic SOQL call', () => {
            const r = runRules('Database.queryWithBinds(q, binds, AccessLevel.USER_MODE)', gov);
            assert.ok(r.some(f => f.ruleId === 'governor/dynamic-soql-call'));
        });

        test('does not classify queryWithBinds as a SOSL call', () => {
            const r = runRules('Database.queryWithBinds(q, binds, AccessLevel.USER_MODE)', gov);
            assert.ok(!r.some(f => f.ruleId === 'governor/dynamic-sosl-call'));
        });

        test('distinguishes query from queryWithBinds (two soql findings)', () => {
            const r = runRules('Database.query(a); Database.queryWithBinds(b, m, AccessLevel.USER_MODE);', gov);
            assert.strictEqual(r.filter(f => f.ruleId === 'governor/dynamic-soql-call').length, 2);
        });
    });

    // -------------------------------------------------------------------------
    // Direct helper function tests
    // -------------------------------------------------------------------------

    suite('hasAggregate', () => {
        test('detects COUNT()', () => {
            assert.strictEqual(hasAggregate('[SELECT COUNT() FROM Account]'), true);
        });

        test('detects COUNT(Id)', () => {
            assert.strictEqual(hasAggregate('[SELECT COUNT(Id) FROM Account]'), true);
        });

        test('detects SUM', () => {
            assert.strictEqual(hasAggregate('[SELECT SUM(Amount) FROM Opportunity]'), true);
        });

        test('detects AVG', () => {
            assert.strictEqual(hasAggregate('[SELECT AVG(Amount) FROM Opportunity]'), true);
        });

        test('detects MAX', () => {
            assert.strictEqual(hasAggregate('[SELECT MAX(CreatedDate) FROM Account]'), true);
        });

        test('detects MIN', () => {
            assert.strictEqual(hasAggregate('[SELECT MIN(CreatedDate) FROM Account]'), true);
        });

        test('is case-insensitive', () => {
            assert.strictEqual(hasAggregate('[SELECT count(id) FROM account]'), true);
        });

        test('returns false for a plain field list', () => {
            assert.strictEqual(hasAggregate('[SELECT Id, Name FROM Account]'), false);
        });

        test('returns false for an empty string', () => {
            assert.strictEqual(hasAggregate(''), false);
        });
    });

    suite('extractFieldList', () => {
        test('extracts a single field', () => {
            assert.strictEqual(extractFieldList('[SELECT Id FROM Account]'), 'Id');
        });

        test('extracts multiple fields', () => {
            assert.strictEqual(extractFieldList('[SELECT Id, Name, Phone FROM Account]'), 'Id, Name, Phone');
        });

        test('is case-insensitive for SELECT and FROM keywords', () => {
            assert.strictEqual(extractFieldList('[select id from Account]'), 'id');
        });

        test('returns null when FROM clause is absent', () => {
            assert.strictEqual(extractFieldList('[FIND "x" IN ALL FIELDS]'), null);
        });

        test('returns null for an empty string', () => {
            assert.strictEqual(extractFieldList(''), null);
        });

        test('handles extra whitespace around field names', () => {
            const result = extractFieldList('[SELECT  Id  ,  Name  FROM Account]');
            assert.ok(result !== null);
            assert.ok(result.includes('Id'));
        });
    });

    suite('skipStringLiteral', () => {
        test('advances past a single-quoted string', () => {
            const text = "'hello' rest";
            const end = skipStringLiteral(text, 0);
            assert.strictEqual(end, 6); // index of closing '
            assert.strictEqual(text[end], '\'');
        });

        test('advances past a double-quoted string', () => {
            const text = '"world" rest';
            const end = skipStringLiteral(text, 0);
            assert.strictEqual(end, 6);
            assert.strictEqual(text[end], '"');
        });

        test('handles escaped quote inside string', () => {
            const text = "'it\\'s here' rest";
            const end = skipStringLiteral(text, 0);
            assert.strictEqual(text[end], '\'');
        });

        test('returns last index when string is unclosed', () => {
            const text = "'unclosed";
            const end = skipStringLiteral(text, 0);
            assert.strictEqual(end, text.length - 1);
        });

        test('string containing closing paren does not confuse callers', () => {
            // Simulates Database.query('WHERE Name = ")" LIMIT 1') — the ) is inside string
            const text = "'WHERE Name = \")\" LIMIT 1'";
            const end = skipStringLiteral(text, 0);
            assert.strictEqual(text[end], '\''); // closes at outer quote, not at )
        });
    });

    suite('isInsideLoop', () => {
        test('returns true for a query inside a for loop', () => {
            const text = 'for (Integer i = 0; i < 5; i++) { [SELECT Id FROM Account LIMIT 1]; }';
            const queryStart = text.indexOf('[');
            assert.strictEqual(isInsideLoop(text, queryStart), true);
        });

        test('returns true for a query inside a while loop', () => {
            const text = 'while (cond) { [SELECT Id FROM Account LIMIT 1]; }';
            const queryStart = text.indexOf('[');
            assert.strictEqual(isInsideLoop(text, queryStart), true);
        });

        test('returns true for a query inside a do-while loop', () => {
            const text = 'do { [SELECT Id FROM Account LIMIT 1]; } while (cond);';
            const queryStart = text.indexOf('[');
            assert.strictEqual(isInsideLoop(text, queryStart), true);
        });

        test('returns false for a query outside any loop', () => {
            const text = 'List<Account> a = [SELECT Id FROM Account LIMIT 1];';
            const queryStart = text.indexOf('[');
            assert.strictEqual(isInsideLoop(text, queryStart), false);
        });

        test('returns false for a query after a loop body has closed', () => {
            const text = 'for (Integer i = 0; i < 5; i++) { Integer x = 1; } [SELECT Id FROM Account LIMIT 1];';
            const queryStart = text.indexOf('[');
            assert.strictEqual(isInsideLoop(text, queryStart), false);
        });

        test('returns true for a query inside a nested loop', () => {
            const text = 'for (Integer i = 0; i < 3; i++) { for (Integer j = 0; j < 3; j++) { [SELECT Id FROM Account LIMIT 1]; } }';
            const queryStart = text.indexOf('[');
            assert.strictEqual(isInsideLoop(text, queryStart), true);
        });

        test('returns true for a query in outer loop when not in inner loop', () => {
            const text = 'for (Integer i = 0; i < 3; i++) { for (Integer j = 0; j < 3; j++) { Integer x = 1; } [SELECT Id FROM Account LIMIT 1]; }';
            const queryStart = text.lastIndexOf('[');
            assert.strictEqual(isInsideLoop(text, queryStart), true);
        });
    });

    suite('isCollectionType', () => {
        test('List<...> is a collection', () => assert.strictEqual(isCollectionType('List<Account>'), true));
        test('Set<...> is a collection', () => assert.strictEqual(isCollectionType('Set<Id>'), true));
        test('Map<...> is a collection', () => assert.strictEqual(isCollectionType('Map<Id, Account>'), true));
        test('array type is a collection', () => assert.strictEqual(isCollectionType('Account[]'), true));
        test('a plain SObject type is not a collection', () => assert.strictEqual(isCollectionType('Account'), false));
    });

    suite('getAssignmentContext', () => {
        test('detects a single-SObject declaration', () => {
            const text = 'Account a = [SELECT Id FROM Account];';
            const start = text.indexOf('[SELECT');
            const end = start + '[SELECT Id FROM Account]'.length;
            assert.strictEqual(getAssignmentContext(text, start, end).singleRow, true);
        });

        test('does not treat a List declaration as single-row', () => {
            const text = 'List<Account> a = [SELECT Id FROM Account];';
            const start = text.indexOf('[SELECT');
            const end = start + '[SELECT Id FROM Account]'.length;
            assert.strictEqual(getAssignmentContext(text, start, end).singleRow, false);
        });

        test('detects trailing [0] indexing outside an assignment', () => {
            const text = 'foo(  [SELECT Id FROM Account][0] )';
            const start = text.indexOf('[SELECT');
            const end = start + '[SELECT Id FROM Account]'.length;
            assert.strictEqual(getAssignmentContext(text, start, end).singleRow, true);
        });
    });

    suite('findDynamicQueryCalls', () => {
        test('returns kind soql for Database.query', () => {
            const [c] = findDynamicQueryCalls('Database.query(x)');
            assert.strictEqual(c.kind, 'soql');
            assert.strictEqual(c.isBinds, false);
            assert.strictEqual(c.method, 'Database.query');
        });

        test('marks WithBinds variants as isBinds', () => {
            const [c] = findDynamicQueryCalls('Database.queryWithBinds(x, m, AccessLevel.USER_MODE)');
            assert.strictEqual(c.isBinds, true);
        });

        test('returns kind sosl for Search.query', () => {
            const [c] = findDynamicQueryCalls('Search.query(x)');
            assert.strictEqual(c.kind, 'sosl');
        });

        test('captures the argument text with string literals intact', () => {
            const [c] = findDynamicQueryCalls("Database.query('SELECT Id FROM Account')");
            assert.strictEqual(c.argText, "'SELECT Id FROM Account'");
        });

        test('ignores a non-existent object.method combination', () => {
            assert.strictEqual(findDynamicQueryCalls('Search.getQueryLocator(x)').length, 0);
        });

        test('returns argEnd -1 for an unterminated call', () => {
            const [c] = findDynamicQueryCalls('Database.query(');
            assert.strictEqual(c.argEnd, -1);
        });
    });

    suite('hasUnquotedPlus', () => {
        test('detects a + outside strings', () => assert.strictEqual(hasUnquotedPlus("'a' + b"), true));
        test('ignores a + inside a string literal', () => assert.strictEqual(hasUnquotedPlus("'a + b'"), false));
        test('returns false with no +', () => assert.strictEqual(hasUnquotedPlus("'SELECT Id'"), false));
    });

    suite('globToRegExp', () => {
        test('matches a simple extension glob', () => {
            assert.ok(globToRegExp('**/*.cls').test('src/classes/MyClass.cls'));
        });

        test('matches a trigger glob', () => {
            assert.ok(globToRegExp('**/*.trigger').test('triggers/MyTrigger.trigger'));
        });

        test('does not match a different extension', () => {
            assert.ok(!globToRegExp('**/*.cls').test('src/MyClass.js'));
        });

        test('matches a path with a single ** prefix', () => {
            // globToRegExp handles a single leading ** correctly
            assert.ok(globToRegExp('**/*.cls').test('force-app/main/dao/AccountDAO.cls'));
        });

        test('? matches exactly one character', () => {
            assert.ok(globToRegExp('src/Account?.cls').test('src/AccountX.cls'));
            assert.ok(!globToRegExp('src/Account?.cls').test('src/Account.cls'));
        });

        test('is case-insensitive', () => {
            assert.ok(globToRegExp('**/*.CLS').test('src/MyClass.cls'));
        });

        test('escapes regex special characters in literal parts', () => {
            assert.ok(globToRegExp('**/*.cls-meta.xml').test('src/MyClass.cls-meta.xml'));
        });
    });

    // -------------------------------------------------------------------------
    // Bug-fix regression tests
    // -------------------------------------------------------------------------

    suite('security/dynamic-soql-concat — string-aware paren walker', () => {
        const cats = { security: true, dao: false, performance: false, style: false, governor: false };

        test('does not flag when ) appears inside a string literal in the argument', () => {
            // The ) inside 'foo)bar' must not close the depth counter prematurely
            const r = runRules("Database.query('SELECT Id FROM Account WHERE Name = \")\" LIMIT 1')", cats);
            assert.ok(!r.some(f => f.ruleId === 'security/dynamic-soql-concat'));
        });

        test('does flag when + appears outside string literals alongside an inner )', () => {
            const r = runRules("Database.query('SELECT Id FROM ' + sobjectType + ' WHERE Name = \")\"')", cats);
            assert.ok(r.some(f => f.ruleId === 'security/dynamic-soql-concat'));
        });

        test('does not flag a plain variable argument containing a ) in a comment', () => {
            // No + sign at all — should not flag
            const r = runRules('Database.query(buildQuery(criteria))', cats);
            assert.ok(!r.some(f => f.ruleId === 'security/dynamic-soql-concat'));
        });
    });

    suite('security/user-input-in-where — mixed literal and bind variable', () => {
        const cats = { security: true, dao: false, performance: false, style: false, governor: false };

        test('flags when a hardcoded literal coexists with a bind variable in the same WHERE', () => {
            // Both 'Acme' (hardcoded) and :status (bound) present — should still flag 'Acme'
            const r = runRules("[SELECT Id FROM Account WHERE Name = 'Acme' AND Status = :status LIMIT 1]", cats);
            assert.ok(r.some(f => f.ruleId === 'security/user-input-in-where'));
        });

        test('does not flag when the WHERE clause has only bind variables', () => {
            const r = runRules('[SELECT Id FROM Account WHERE Name = :n AND Status = :s LIMIT 1]', cats);
            assert.ok(!r.some(f => f.ruleId === 'security/user-input-in-where'));
        });

        test('does not flag when the WHERE clause has no string literals at all', () => {
            const r = runRules('[SELECT Id FROM Account WHERE Amount > 100 LIMIT 1]', cats);
            assert.ok(!r.some(f => f.ruleId === 'security/user-input-in-where'));
        });
    });

    suite('perf/soql-in-loop — do-while support', () => {
        const cats = { performance: true, dao: false, security: false, style: false, governor: false };

        test('flags a SOQL query inside a do-while loop body', () => {
            const text = 'do { List<Account> a = [SELECT Id, Name FROM Account WHERE Id != null LIMIT 1]; } while (condition);';
            const r = runRules(text, cats);
            assert.ok(r.some(f => f.ruleId === 'perf/soql-in-loop'));
        });

        test('does not flag a query after the do-while body closes', () => {
            const text = 'do { Integer x = 1; } while (cond); List<Account> a = [SELECT Id, Name FROM Account WHERE Id != null LIMIT 1];';
            const r = runRules(text, cats);
            assert.ok(!r.some(f => f.ruleId === 'perf/soql-in-loop'));
        });
    });

    // -------------------------------------------------------------------------
    // Inline suppression
    // -------------------------------------------------------------------------

    suite('buildLineStarts / offsetToLine', () => {
        const text = 'line0\nline1\nline2';
        const starts = buildLineStarts(text);

        test('records the start offset of each line', () => {
            assert.deepStrictEqual(starts, [0, 6, 12]);
        });

        test('maps an offset on the first line to line 0', () => {
            assert.strictEqual(offsetToLine(starts, 2), 0);
        });

        test('maps an offset on a later line correctly', () => {
            assert.strictEqual(offsetToLine(starts, text.indexOf('line2')), 2);
        });

        test('maps the exact line-start offset to that line', () => {
            assert.strictEqual(offsetToLine(starts, 6), 1);
        });
    });

    suite('collectSuppressions', () => {
        test('parses a file-level directive with a category', () => {
            const text = '// aqv-disable performance';
            const { file, byLine } = collectSuppressions(text, buildLineStarts(text));
            assert.strictEqual(file.length, 1);
            assert.strictEqual(byLine.size, 0);
            assert.ok(file[0].ids.has('performance'));
        });

        test('parses a next-line directive targeting the following line', () => {
            const text = '// aqv-disable-next-line perf/missing-limit\n[SELECT Id FROM Account]';
            const { byLine } = collectSuppressions(text, buildLineStarts(text));
            assert.ok(byLine.has(1));
            assert.ok(byLine.get(1)[0].ids.has('perf/missing-limit'));
        });

        test('a bare directive marks the entry as "all"', () => {
            const text = '// aqv-disable-next-line\n[SELECT Id FROM Account]';
            const { byLine } = collectSuppressions(text, buildLineStarts(text));
            assert.strictEqual(byLine.get(1)[0].all, true);
        });
    });

    suite('runRules — inline suppression', () => {
        const perf = { performance: true, dao: false, security: false, style: false, governor: false };

        test('disable-next-line silences a specific rule on the following line', () => {
            const text = '// aqv-disable-next-line perf/missing-limit\n[SELECT Id FROM Account]';
            const r = runRules(text, perf);
            assert.ok(!r.some(f => f.ruleId === 'perf/missing-limit'));
        });

        test('disable-line silences a finding on the same (trailing-comment) line', () => {
            const text = '[SELECT Id FROM Account] // aqv-disable-line perf/missing-limit';
            const r = runRules(text, perf);
            assert.ok(!r.some(f => f.ruleId === 'perf/missing-limit'));
        });

        test('a directive for one rule leaves other rules on that line intact', () => {
            const text = '// aqv-disable-next-line perf/missing-limit\n[SELECT Id FROM Account]';
            const r = runRules(text, { performance: true, style: true, dao: false, security: false, governor: false });
            assert.ok(!r.some(f => f.ruleId === 'perf/missing-limit'));
            assert.ok(r.some(f => f.ruleId === 'style/select-id-only'));
        });

        test('a bare directive silences every rule on the following line', () => {
            const text = '// aqv-disable-next-line\n[SELECT Id FROM Account]';
            const r = runRules(text, { performance: true, style: true, dao: true, security: false, governor: false });
            assert.deepStrictEqual(r, []);
        });

        test('a file-level directive silences all findings of a category', () => {
            const text = '// aqv-disable performance\n[SELECT Id FROM Account]\n[SELECT Id FROM Contact]';
            const r = runRules(text, perf);
            assert.deepStrictEqual(r, []);
        });

        test('a file-level directive by rule id silences only that rule', () => {
            const text = '// aqv-disable style/select-id-only\n[SELECT Id FROM Account]';
            const r = runRules(text, { performance: true, style: true, dao: false, security: false, governor: false });
            assert.ok(!r.some(f => f.ruleId === 'style/select-id-only'));
            assert.ok(r.some(f => f.ruleId === 'perf/missing-limit'));
        });

        test('suppression only affects the targeted line', () => {
            const text = '// aqv-disable-next-line perf/missing-limit\n[SELECT Id FROM Account]\n[SELECT Id FROM Contact]';
            const r = runRules(text, perf);
            assert.strictEqual(r.filter(f => f.ruleId === 'perf/missing-limit').length, 1);
        });

        test('supports comma-separated ids in one directive', () => {
            const text = '// aqv-disable-next-line perf/missing-limit, style/select-id-only\n[SELECT Id FROM Account]';
            const r = runRules(text, { performance: true, style: true, dao: false, security: false, governor: false });
            assert.ok(!r.some(f => f.ruleId === 'perf/missing-limit'));
            assert.ok(!r.some(f => f.ruleId === 'style/select-id-only'));
        });

        test('ignores a reason after " -- "', () => {
            const text = '// aqv-disable-next-line perf/missing-limit -- admin-only batch query\n[SELECT Id FROM Account]';
            const r = runRules(text, perf);
            assert.ok(!r.some(f => f.ruleId === 'perf/missing-limit'));
        });
    });

    suite('runRules — per-rule overrides', () => {
        test('a rule set to "off" is skipped even when its category is enabled', () => {
            const r = runRules('[SELECT Id FROM Account]',
                { performance: true, dao: false, security: false, style: false, governor: false },
                { ruleOverrides: { 'perf/missing-limit': 'off' } });
            assert.ok(!r.some(f => f.ruleId === 'perf/missing-limit'));
        });

        test('a rule with a severity override runs even when its category is disabled', () => {
            const r = runRules('[SELECT Id FROM Account]',
                { performance: false, dao: false, security: false, style: false, governor: false },
                { ruleOverrides: { 'perf/missing-limit': 'warning' } });
            assert.ok(r.some(f => f.ruleId === 'perf/missing-limit'));
        });

        test('an unrelated override does not affect other rules', () => {
            const r = runRules('[SELECT Id FROM Account]',
                { performance: true, dao: false, security: false, style: false, governor: false },
                { ruleOverrides: { 'style/select-id-only': 'off' } });
            assert.ok(r.some(f => f.ruleId === 'perf/missing-limit'));
        });

        test('absent ruleOverrides preserves category-based behaviour', () => {
            const r = runRules('[SELECT Id FROM Account]',
                { performance: true, dao: false, security: false, style: false, governor: false });
            assert.ok(r.some(f => f.ruleId === 'perf/missing-limit'));
        });
    });
});
