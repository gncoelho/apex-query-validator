const vscode = require('vscode');

// Regex SOQL
const soqlPattern = /\[SELECT\s+.+\s+FROM\s+\w+(\s+WHERE\s+.+)?(\s+GROUP\s+BY\s+.+)?(\s+ORDER\s+BY\s+.+)?(\s+LIMIT\s+\d+)?\]/gi;

// Regex SOSL
const soslPattern = /FIND\s+{.*}\s+IN\s+\w+\s+FIELDS/gi;

function shouldSkipFile(fileName) {
    const lowerFileName = fileName.toLowerCase();
    return lowerFileName.includes('dao') || lowerFileName.includes('test');
}

function findSoqlMatches(text) {
    return text.match(soqlPattern) || [];
}

function findSoslMatches(text) {
    return text.match(soslPattern) || [];
}

function buildResultMessage(soqlMatches, soslMatches) {
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

    return message;
}

function computeMatchOffsets(text, matches) {
    let searchFrom = 0;
    return matches.map(match => {
        const start = text.indexOf(match, searchFrom);
        const end = start + match.length;
        searchFrom = end;
        return { match, start, end };
    });
}

function activate(context) {
    console.log('"apex-query-validator" extension is active!');

    let disposable = vscode.commands.registerCommand('apex-query-validator.validateSoqlSosl', function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor!');
            return;
        }

        const document = editor.document;
        const fileName = document.fileName;

        if (shouldSkipFile(fileName)) {
            vscode.window.showInformationMessage('Validation skipped for DAO or test files');
            return;
        }

        const text = document.getText();

        const soqlMatches = findSoqlMatches(text);
        const soslMatches = findSoslMatches(text);

        vscode.window.showInformationMessage(buildResultMessage(soqlMatches, soslMatches));

        // Highlight matches in the editor
        const decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 255, 0, 0.2)',
            border: '1px solid yellow'
        });

        const allMatches = [...soqlMatches, ...soslMatches];
        const offsets = computeMatchOffsets(text, allMatches);
        const decorations = offsets.map(({ start, end }) => {
            return { range: new vscode.Range(document.positionAt(start), document.positionAt(end)) };
        });

        editor.setDecorations(decorationType, decorations);
    });

    context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate,
    shouldSkipFile,
    findSoqlMatches,
    findSoslMatches,
    buildResultMessage,
    computeMatchOffsets
};
