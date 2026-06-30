const assert = require('assert');
const vscode = require('vscode');
const { buildWorkspaceSummaryMessage } = require('../validator');

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
});
