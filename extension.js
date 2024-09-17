const vscode = require('vscode');

function activate(context) {
    console.log('"apex-query-validator" extension is active!');

    let disposable = vscode.commands.registerCommand('apex-query-validator.validateSoqlSosl', function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor!');
            return;
        }

        const document = editor.document;
        const fileName = document.fileName.toLowerCase();
        
        if (fileName.includes('dao') || fileName.includes('test')) {
            vscode.window.showInformationMessage('Validation skipped for DAO or test files');
            return;
        }

        const text = document.getText();

        // Regex SOQL
        const soqlPattern = /\[SELECT\s+.+\s+FROM\s+\w+(\s+WHERE\s+.+)?(\s+GROUP\s+BY\s+.+)?(\s+ORDER\s+BY\s+.+)?(\s+LIMIT\s+\d+)?\]/gi;

        // Regex SOSL
        const soslPattern = /FIND\s+{.*}\s+IN\s+\w+\s+FIELDS/gi;

        const soqlMatches = text.match(soqlPattern) || [];
        const soslMatches = text.match(soslPattern) || [];

        let message = '';

        if (soqlMatches.length > 0) {
            message += `${soqlMatches.length} valid SOQL queries found.\n`;
        } else {
            message += 'No valid SOQL queries found.\n';
        }

        if (soslMatches.length > 0) {
            message += `${soslMatches.length} valid SOSL queries found.\n`;
        } else {
            message += 'No valid SOSL queries found.\n';
        }

        vscode.window.showInformationMessage(message);

        // Highlight matches in the editor
        const decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 255, 0, 0.2)',
            border: '1px solid yellow'
        });

        const allMatches = [...soqlMatches, ...soslMatches];
        const decorations = allMatches.map(match => {
            const startPos = document.positionAt(text.indexOf(match));
            const endPos = document.positionAt(text.indexOf(match) + match.length);
            return { range: new vscode.Range(startPos, endPos) };
        });

        editor.setDecorations(decorationType, decorations);
    });

    context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};