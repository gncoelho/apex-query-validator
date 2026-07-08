const assert = require('assert');
const {
    findQueries,
    runRules,
    isExemptFile,
    isDaoFile,
    extractSoqlObjects,
    extractSoslObjects,
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
            const results = runRules("[FIND 'x' IN ALL FIELDS RETURNING Contact(Id)]", { dao: true });
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
            const fromRunRules = runRules(text, { dao: true, performance: false, security: false, style: false, governor: false });
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
            // Bind variable is present — considered safe
            const r = runRules("[SELECT Id FROM Account WHERE Name = :n AND Type = 'Partner' LIMIT 1]", cats);
            assert.ok(!r.some(f => f.ruleId === 'security/user-input-in-where'));
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
});
