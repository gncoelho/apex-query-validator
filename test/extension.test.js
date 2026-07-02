const assert = require('assert');
const vscode = require('vscode');
const { buildWorkspaceSummaryMessage } = require('../validator');
const { shouldClearOnClose, findDaoFilesForObjects } = require('../extension');

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
