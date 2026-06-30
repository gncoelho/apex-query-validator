const assert = require('assert');
const vscode = require('vscode');
const { buildWorkspaceSummaryMessage } = require('../validator');
const { shouldClearOnClose } = require('../extension');

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

    // --- shouldClearOnClose unit tests (no VS Code APIs used in assertions) ---

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

    // --- workspace command sets diagnostics for discovered files ---

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
});
