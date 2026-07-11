const assert = require('assert');
const vscode = require('vscode');
const { buildWorkspaceSummaryMessage, buildWorkspaceCancelledMessage } = require('../validator');
const { shouldClearOnClose, findDaoFilesForObjects, resolveSeverity, diagnosticRuleId, QUICK_FIXES, buildDaoMethodAction, getMetadataIndex, invalidateMetadataIndex } = require('../extension');

suite('Extension Test Suite', () => {
    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension('gncoelho.apex-query-validator');
        await extension.activate();
    });

    test('registers the validateSoqlSosl command on activation', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('apex-query-validator.validateSoqlSosl'));
    });

    test('shows an error message when there is no active editor', async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');

        const originalShowErrorMessage = vscode.window.showErrorMessage;
        let capturedMessage;
        vscode.window.showErrorMessage = (message) => {
            capturedMessage = message;
        };

        try {
            await vscode.commands.executeCommand('apex-query-validator.validateSoqlSosl');
            assert.strictEqual(capturedMessage, 'No active editor!');
        } finally {
            vscode.window.showErrorMessage = originalShowErrorMessage;
        }
    });

    test('registers the validateWorkspace command on activation', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('apex-query-validator.validateWorkspace'));
    });

    test('shows workspace summary when validateWorkspace command is executed', async () => {
        const origShowInfo = vscode.window.showInformationMessage;
        const origWithProgress = vscode.window.withProgress;
        const origFindFiles = vscode.workspace.findFiles;
        let capturedMessage;

        vscode.workspace.findFiles = async () => [];
        vscode.window.withProgress = async (_opts, task) => task({ report: () => {} });
        vscode.window.showInformationMessage = (msg) => { capturedMessage = msg; };

        try {
            await vscode.commands.executeCommand('apex-query-validator.validateWorkspace');
            assert.strictEqual(capturedMessage, buildWorkspaceSummaryMessage(0, 0, 0));
        } finally {
            vscode.window.showInformationMessage = origShowInfo;
            vscode.window.withProgress = origWithProgress;
            vscode.workspace.findFiles = origFindFiles;
        }
    });

    test('validateWorkspace sets diagnostics for files containing SOQL', async () => {
        const fakeUri = vscode.Uri.file('/fake/MyController.cls');
        const fakeDocument = {
            getText: () => '[SELECT Id FROM Account]',
            fileName: '/fake/MyController.cls',
            uri: fakeUri,
            positionAt: (offset) => new vscode.Position(0, offset)
        };

        const origFindFiles = vscode.workspace.findFiles;
        const origOpenDoc = vscode.workspace.openTextDocument;
        const origWithProgress = vscode.window.withProgress;
        const origShowInfo = vscode.window.showInformationMessage;

        vscode.workspace.findFiles = async () => [fakeUri];
        vscode.workspace.openTextDocument = async () => fakeDocument;
        vscode.window.withProgress = async (_opts, task) => task({ report: () => {} });
        vscode.window.showInformationMessage = () => {};

        try {
            await vscode.commands.executeCommand('apex-query-validator.validateWorkspace');
            const diagnostics = vscode.languages.getDiagnostics(fakeUri);
            assert.ok(diagnostics.length > 0, 'Expected diagnostics to be set for the discovered file');
        } finally {
            vscode.workspace.findFiles = origFindFiles;
            vscode.workspace.openTextDocument = origOpenDoc;
            vscode.window.withProgress = origWithProgress;
            vscode.window.showInformationMessage = origShowInfo;
        }
    });

    test('validateWorkspace reports cancellation and scans nothing when cancelled up front', async () => {
        const fileA = vscode.Uri.file('/fake/CancelA.cls');
        const fileB = vscode.Uri.file('/fake/CancelB.cls');
        const docFor = (uri) => ({
            getText: () => '[SELECT Id FROM Account]',
            fileName: uri.fsPath, uri, positionAt: (o) => new vscode.Position(0, o)
        });

        const origFindFiles = vscode.workspace.findFiles;
        const origOpenDoc = vscode.workspace.openTextDocument;
        const origWithProgress = vscode.window.withProgress;
        const origShowInfo = vscode.window.showInformationMessage;
        let capturedMessage;
        let openedCount = 0;

        vscode.workspace.findFiles = async () => [fileA, fileB];
        vscode.workspace.openTextDocument = async (uri) => { openedCount++; return docFor(uri); };
        vscode.window.withProgress = async (_opts, task) => task({ report: () => {} }, { isCancellationRequested: true });
        vscode.window.showInformationMessage = (msg) => { capturedMessage = msg; };

        try {
            await vscode.commands.executeCommand('apex-query-validator.validateWorkspace');
            assert.strictEqual(openedCount, 0, 'no files should be opened when cancelled before the loop');
            assert.strictEqual(capturedMessage, buildWorkspaceCancelledMessage(0, 0, 0));
        } finally {
            vscode.workspace.findFiles = origFindFiles;
            vscode.workspace.openTextDocument = origOpenDoc;
            vscode.window.withProgress = origWithProgress;
            vscode.window.showInformationMessage = origShowInfo;
        }
    });

    test('validateWorkspace keeps partial results when cancelled after one file', async () => {
        const fileA = vscode.Uri.file('/fake/PartA.cls');
        const fileB = vscode.Uri.file('/fake/PartB.cls');
        const docFor = (uri) => ({
            getText: () => '[SELECT Id FROM Account]',
            fileName: uri.fsPath, uri, positionAt: (o) => new vscode.Position(0, o)
        });

        // Cancel is requested only from the second check onward, so file A is
        // processed and file B is skipped.
        let checks = 0;
        const token = { get isCancellationRequested() { return checks++ >= 1; } };

        const origFindFiles = vscode.workspace.findFiles;
        const origOpenDoc = vscode.workspace.openTextDocument;
        const origWithProgress = vscode.window.withProgress;
        const origShowInfo = vscode.window.showInformationMessage;
        let capturedMessage;

        vscode.workspace.findFiles = async () => [fileA, fileB];
        vscode.workspace.openTextDocument = async (uri) => docFor(uri);
        vscode.window.withProgress = async (_opts, task) => task({ report: () => {} }, token);
        vscode.window.showInformationMessage = (msg) => { capturedMessage = msg; };

        try {
            await vscode.commands.executeCommand('apex-query-validator.validateWorkspace');
            assert.ok(vscode.languages.getDiagnostics(fileA).length > 0, 'file A partial results should be kept');
            assert.strictEqual(vscode.languages.getDiagnostics(fileB).length, 0, 'file B should not be processed');
            assert.ok(/cancel/i.test(capturedMessage), 'message should indicate cancellation');
        } finally {
            vscode.workspace.findFiles = origFindFiles;
            vscode.workspace.openTextDocument = origOpenDoc;
            vscode.window.withProgress = origWithProgress;
            vscode.window.showInformationMessage = origShowInfo;
        }
    });

    test('sets the rule id as the diagnostic code', async () => {
        const fakeUri = vscode.Uri.file('/fake/CodeController.cls');
        const fakeDocument = {
            getText: () => '[SELECT Id FROM Account]',
            fileName: '/fake/CodeController.cls',
            uri: fakeUri,
            positionAt: (offset) => new vscode.Position(0, offset)
        };

        const origFindFiles = vscode.workspace.findFiles;
        const origOpenDoc = vscode.workspace.openTextDocument;
        const origWithProgress = vscode.window.withProgress;
        const origShowInfo = vscode.window.showInformationMessage;

        vscode.workspace.findFiles = async () => [fakeUri];
        vscode.workspace.openTextDocument = async () => fakeDocument;
        vscode.window.withProgress = async (_opts, task) => task({ report: () => {} });
        vscode.window.showInformationMessage = () => {};

        try {
            await vscode.commands.executeCommand('apex-query-validator.validateWorkspace');
            const diagnostics = vscode.languages.getDiagnostics(fakeUri);
            const placement = diagnostics.find(d => {
                const code = typeof d.code === 'object' ? d.code.value : d.code;
                return code === 'dao/soql-placement';
            });
            assert.ok(placement, 'Expected a diagnostic whose code is the dao/soql-placement rule id');
        } finally {
            vscode.workspace.findFiles = origFindFiles;
            vscode.workspace.openTextDocument = origOpenDoc;
            vscode.window.withProgress = origWithProgress;
            vscode.window.showInformationMessage = origShowInfo;
        }
    });

    suite('getMetadataIndex', () => {
        test('builds and caches an index from workspace metadata files', async () => {
            const origFindFiles = vscode.workspace.findFiles;
            vscode.workspace.findFiles = async (glob) => {
                if (String(glob).includes('object-meta')) {
                    return [vscode.Uri.file('/p/objects/Broker__c/Broker__c.object-meta.xml')];
                }
                return [vscode.Uri.file('/p/objects/Broker__c/fields/Phone__c.field-meta.xml')];
            };
            try {
                invalidateMetadataIndex();
                const idx = await getMetadataIndex();
                assert.ok(idx.objects.has('broker__c'));
                assert.ok(idx.fieldsByObject.get('broker__c').has('phone__c'));
                assert.ok(idx.objects.has('account'), 'baseline standard objects should be present');
            } finally {
                vscode.workspace.findFiles = origFindFiles;
                invalidateMetadataIndex();
            }
        });
    });

    // --- shouldClearOnClose unit tests ---

    test('shouldClearOnClose returns true when URI is not workspace-validated', () => {
        const tracked = new Set(['file:///a.cls']);
        assert.strictEqual(shouldClearOnClose('file:///b.cls', tracked), true);
    });

    test('shouldClearOnClose returns false when URI is workspace-validated', () => {
        const tracked = new Set(['file:///a.cls']);
        assert.strictEqual(shouldClearOnClose('file:///a.cls', tracked), false);
    });

    test('shouldClearOnClose returns true when the tracked set is empty', () => {
        assert.strictEqual(shouldClearOnClose('file:///a.cls', new Set()), true);
    });

    // --- Quick Fix tests ---

    suite('diagnosticRuleId', () => {
        test('reads a plain string code', () => {
            assert.strictEqual(diagnosticRuleId({ code: 'style/sosl-sidebar-scope' }), 'style/sosl-sidebar-scope');
        });

        test('reads the value of an object code', () => {
            assert.strictEqual(diagnosticRuleId({ code: { value: 'perf/missing-limit', target: 'x' } }), 'perf/missing-limit');
        });
    });

    suite('QUICK_FIXES', () => {
        const uri = vscode.Uri.file('/fake/Foo.cls');
        function runFix(ruleId, queryText) {
            const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, queryText.length));
            const doc = { uri, getText: () => queryText };
            const diag = new vscode.Diagnostic(range, 'msg', vscode.DiagnosticSeverity.Warning);
            const actions = QUICK_FIXES[ruleId](doc, diag);
            return actions.length ? actions[0].edit.get(uri)[0].newText : null;
        }

        test('style/sosl-sidebar-scope replaces SIDEBAR with ALL', () => {
            assert.strictEqual(runFix('style/sosl-sidebar-scope', '[FIND "x" IN SIDEBAR FIELDS]'), '[FIND "x" IN ALL FIELDS]');
        });

        test('perf/missing-limit inserts LIMIT before the closing bracket', () => {
            assert.strictEqual(runFix('perf/missing-limit', '[SELECT Id FROM Account]'), '[SELECT Id FROM Account LIMIT 200]');
        });

        test('perf/missing-limit inserts LIMIT before an existing OFFSET', () => {
            assert.strictEqual(runFix('perf/missing-limit', '[SELECT Id FROM Account OFFSET 10]'), '[SELECT Id FROM Account LIMIT 200 OFFSET 10]');
        });

        test('perf/order-by-no-limit inserts LIMIT after ORDER BY', () => {
            assert.strictEqual(runFix('perf/order-by-no-limit', '[SELECT Id FROM Account ORDER BY Name]'), '[SELECT Id FROM Account ORDER BY Name LIMIT 200]');
        });

        test('correctness/single-row-no-limit inserts LIMIT 1', () => {
            assert.strictEqual(runFix('correctness/single-row-no-limit', '[SELECT Id FROM Account]'), '[SELECT Id FROM Account LIMIT 1]');
        });

        test('correctness/single-row-no-limit replaces an existing LIMIT with 1', () => {
            assert.strictEqual(runFix('correctness/single-row-no-limit', '[SELECT Id FROM Account LIMIT 5]'), '[SELECT Id FROM Account LIMIT 1]');
        });

        test('security/missing-security-enforced inserts before LIMIT', () => {
            assert.strictEqual(
                runFix('security/missing-security-enforced', "[SELECT Id FROM Account WHERE Name = 'x' LIMIT 10]"),
                "[SELECT Id FROM Account WHERE Name = 'x' WITH SECURITY_ENFORCED LIMIT 10]"
            );
        });

        test('security/missing-security-enforced inserts before the closing bracket', () => {
            assert.strictEqual(runFix('security/missing-security-enforced', '[SELECT Id FROM Account]'), '[SELECT Id FROM Account WITH SECURITY_ENFORCED]');
        });

        test('security/dynamic-soql-concat wraps the variable in escapeSingleQuotes', () => {
            assert.strictEqual(
                runFix('security/dynamic-soql-concat', "Database.query('SELECT Id FROM ' + objectName)"),
                "Database.query('SELECT Id FROM ' + String.escapeSingleQuotes(objectName))"
            );
        });

        test('security/dynamic-sosl-concat wraps only the unsafe segment', () => {
            assert.strictEqual(
                runFix('security/dynamic-sosl-concat', "Search.query('FIND ' + term + ' IN ALL FIELDS')"),
                "Search.query('FIND ' + String.escapeSingleQuotes(term) + ' IN ALL FIELDS')"
            );
        });

        test('security/hardcoded-id extracts the id to a class constant', () => {
            const whole = "public class Foo {\n    void m() { Account a = [SELECT Id FROM Account WHERE Id = '001000000000001' LIMIT 1]; }\n}";
            const litText = "'001000000000001'";
            const litStart = whole.indexOf(litText);
            const doc = {
                uri,
                getText: (range) => (range ? litText : whole),
                positionAt: (offset) => {
                    const before = whole.slice(0, offset);
                    const line = (before.match(/\n/g) || []).length;
                    return new vscode.Position(line, offset - (before.lastIndexOf('\n') + 1));
                }
            };
            const range = new vscode.Range(doc.positionAt(litStart), doc.positionAt(litStart + litText.length));
            const diag = new vscode.Diagnostic(range, 'msg', vscode.DiagnosticSeverity.Warning);
            const actions = QUICK_FIXES['security/hardcoded-id'](doc, diag);
            assert.strictEqual(actions.length, 1);
            assert.ok(actions[0].title.toLowerCase().includes('constant'));
            const edits = actions[0].edit.get(uri);
            assert.strictEqual(edits.length, 2);
            assert.ok(edits.some(e => e.newText === 'RECORD_ID'));
            assert.ok(edits.some(e => /private static final Id RECORD_ID = '001000000000001';/.test(e.newText)));
        });

        test('security/hardcoded-id offers no fix without an enclosing class', () => {
            const whole = "trigger Foo on Account (before insert) { }";
            const doc = { uri, getText: (range) => (range ? "'001000000000001'" : whole), positionAt: () => new vscode.Position(0, 0) };
            const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 17));
            const diag = new vscode.Diagnostic(range, 'msg', vscode.DiagnosticSeverity.Warning);
            assert.strictEqual(QUICK_FIXES['security/hardcoded-id'](doc, diag).length, 0);
        });
    });

    suite('buildDaoMethodAction', () => {
        test('inserts a DAO method and replaces the query with a call', async () => {
            const daoUri = vscode.Uri.file('/project/AccountDAO.cls');
            const daoText = 'public class AccountDAO {\n}';
            const srcUri = vscode.Uri.file('/project/Foo.cls');
            const srcDoc = { uri: srcUri, getText: (range) => (range ? '[SELECT Id FROM Account]' : 'x') };
            const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 24));
            const diag = new vscode.Diagnostic(range, 'msg', vscode.DiagnosticSeverity.Warning);
            diag.code = 'dao/soql-placement';

            const origOpen = vscode.workspace.openTextDocument;
            vscode.workspace.openTextDocument = async () => ({
                getText: () => daoText,
                positionAt: (offset) => {
                    const before = daoText.slice(0, offset);
                    const line = (before.match(/\n/g) || []).length;
                    return new vscode.Position(line, offset - (before.lastIndexOf('\n') + 1));
                }
            });

            try {
                const action = await buildDaoMethodAction(srcDoc, diag, daoUri);
                assert.ok(action, 'expected a code action');
                assert.ok(action.title.includes('getAccounts()'));

                const daoEdits = action.edit.get(daoUri);
                assert.ok(daoEdits.some(e => /public static List<Account> getAccounts\(\)/.test(e.newText)));

                const srcEdits = action.edit.get(srcUri);
                assert.strictEqual(srcEdits[0].newText, 'AccountDAO.getAccounts()');
            } finally {
                vscode.workspace.openTextDocument = origOpen;
            }
        });
    });

    // --- resolveSeverity tests ---

    suite('resolveSeverity', () => {
        const W = vscode.DiagnosticSeverity.Warning;

        test('a per-rule override wins over everything', () => {
            assert.strictEqual(
                resolveSeverity(
                    { ruleId: 'perf/missing-limit', category: 'performance' },
                    { ruleOverrides: { 'perf/missing-limit': 'error' }, defaultSeverity: W }
                ),
                vscode.DiagnosticSeverity.Error
            );
        });

        test('style category defaults to Information', () => {
            assert.strictEqual(
                resolveSeverity(
                    { ruleId: 'style/select-id-only', category: 'style' },
                    { ruleOverrides: {}, defaultSeverity: W }
                ),
                vscode.DiagnosticSeverity.Information
            );
        });

        test('an override can raise a style rule above Information', () => {
            assert.strictEqual(
                resolveSeverity(
                    { ruleId: 'style/select-id-only', category: 'style' },
                    { ruleOverrides: { 'style/select-id-only': 'warning' }, defaultSeverity: W }
                ),
                vscode.DiagnosticSeverity.Warning
            );
        });

        test('an information finding severity maps to Information', () => {
            assert.strictEqual(
                resolveSeverity(
                    { ruleId: 'security/user-input-in-where', category: 'security', severity: 'information' },
                    { ruleOverrides: {}, defaultSeverity: W }
                ),
                vscode.DiagnosticSeverity.Information
            );
        });

        test('falls back to the global default severity', () => {
            assert.strictEqual(
                resolveSeverity(
                    { ruleId: 'perf/missing-limit', category: 'performance' },
                    { ruleOverrides: {}, defaultSeverity: W }
                ),
                W
            );
        });
    });

    // --- findDaoFilesForObjects tests ---

    suite('findDaoFilesForObjects', () => {
        test('returns matching DAO URI when object name matches filename', async () => {
            const accountDaoUri = vscode.Uri.file('/project/AccountDAO.cls');
            const contactDaoUri = vscode.Uri.file('/project/ContactDAO.cls');
            const origFindFiles = vscode.workspace.findFiles;
            vscode.workspace.findFiles = async () => [accountDaoUri, contactDaoUri];
            try {
                const results = await findDaoFilesForObjects(
                    ['Account'],
                    { daoKeywords: ['dao'], includeGlobs: ['**/*.cls'] }
                );
                assert.strictEqual(results.length, 1);
                assert.strictEqual(results[0].toString(), accountDaoUri.toString());
            } finally {
                vscode.workspace.findFiles = origFindFiles;
            }
        });

        test('returns empty array when no DAO file matches the object name', async () => {
            const contactDaoUri = vscode.Uri.file('/project/ContactDAO.cls');
            const origFindFiles = vscode.workspace.findFiles;
            vscode.workspace.findFiles = async () => [contactDaoUri];
            try {
                const results = await findDaoFilesForObjects(
                    ['Account'],
                    { daoKeywords: ['dao'], includeGlobs: ['**/*.cls'] }
                );
                assert.strictEqual(results.length, 0);
            } finally {
                vscode.workspace.findFiles = origFindFiles;
            }
        });

        test('returns empty array when objectNames is empty', async () => {
            const origFindFiles = vscode.workspace.findFiles;
            vscode.workspace.findFiles = async () => [vscode.Uri.file('/project/AccountDAO.cls')];
            try {
                const results = await findDaoFilesForObjects(
                    [],
                    { daoKeywords: ['dao'], includeGlobs: ['**/*.cls'] }
                );
                assert.strictEqual(results.length, 0);
            } finally {
                vscode.workspace.findFiles = origFindFiles;
            }
        });

        test('excludes non-DAO files even when they contain the object name', async () => {
            const accountServiceUri = vscode.Uri.file('/project/AccountService.cls');
            const origFindFiles = vscode.workspace.findFiles;
            vscode.workspace.findFiles = async () => [accountServiceUri];
            try {
                const results = await findDaoFilesForObjects(
                    ['Account'],
                    { daoKeywords: ['dao'], includeGlobs: ['**/*.cls'] }
                );
                assert.strictEqual(results.length, 0);
            } finally {
                vscode.workspace.findFiles = origFindFiles;
            }
        });

        test('matches multiple objects and returns all relevant DAO files', async () => {
            const accountDaoUri = vscode.Uri.file('/project/AccountDAO.cls');
            const contactDaoUri = vscode.Uri.file('/project/ContactDAO.cls');
            const origFindFiles = vscode.workspace.findFiles;
            vscode.workspace.findFiles = async () => [accountDaoUri, contactDaoUri];
            try {
                const results = await findDaoFilesForObjects(
                    ['Account', 'Contact'],
                    { daoKeywords: ['dao'], includeGlobs: ['**/*.cls'] }
                );
                assert.strictEqual(results.length, 2);
            } finally {
                vscode.workspace.findFiles = origFindFiles;
            }
        });

        test('deduplicates URIs found across multiple globs', async () => {
            const accountDaoUri = vscode.Uri.file('/project/AccountDAO.cls');
            const origFindFiles = vscode.workspace.findFiles;
            vscode.workspace.findFiles = async () => [accountDaoUri];
            try {
                const results = await findDaoFilesForObjects(
                    ['Account'],
                    { daoKeywords: ['dao'], includeGlobs: ['**/*.cls', '**/*.cls'] }
                );
                assert.strictEqual(results.length, 1);
            } finally {
                vscode.workspace.findFiles = origFindFiles;
            }
        });
    });
});
