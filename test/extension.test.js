const assert = require('assert');
const vscode = require('vscode');

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
});
