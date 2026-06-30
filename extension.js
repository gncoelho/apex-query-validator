const vscode = require('vscode');
const { findQueries, isExemptFile, matchesGlob, buildSummaryMessage, buildWorkspaceSummaryMessage } = require('./validator');

const decorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 255, 0, 0.2)',
    border: '1px solid yellow'
});

function getConfig() {
    const config = vscode.workspace.getConfiguration('apexQueryValidator');
    return {
        exemptKeywords: config.get('exemptFilenameKeywords'),
        includeGlobs: config.get('includeGlobs'),
        severity: config.get('diagnosticSeverity') === 'Error'
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning,
        autoValidate: config.get('autoValidate')
    };
}

function clearDocument(document, diagnosticCollection) {
    diagnosticCollection.delete(document.uri);
    const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === document.uri.toString());
    if (editor) {
        editor.setDecorations(decorationType, []);
    }
}

function applyDocumentValidation(document, diagnosticCollection, { severity }) {
    const text = document.getText();
    const matches = findQueries(text);

    const diagnostics = matches.map(({ type, start, end }) => {
        const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
        return new vscode.Diagnostic(range, `${type} query should be moved to a DAO class.`, severity);
    });
    diagnosticCollection.set(document.uri, diagnostics);

    const editor = vscode.window.visibleTextEditors.find(
        e => e.document.uri.toString() === document.uri.toString()
    );
    if (editor) {
        editor.setDecorations(decorationType, matches.map(({ start, end }) => ({
            range: new vscode.Range(document.positionAt(start), document.positionAt(end))
        })));
    }

    return {
        soqlCount: matches.filter(m => m.type === 'SOQL').length,
        soslCount: matches.filter(m => m.type === 'SOSL').length
    };
}

function runValidation(document, diagnosticCollection, { silent }) {
    const { exemptKeywords, includeGlobs, severity, autoValidate } = getConfig();

    if (!matchesGlob(document.fileName, includeGlobs)) {
        clearDocument(document, diagnosticCollection);
        return;
    }

    if (isExemptFile(document.fileName, exemptKeywords)) {
        clearDocument(document, diagnosticCollection);
        if (!silent) {
            vscode.window.showInformationMessage('Validation skipped for DAO or test files');
        }
        return;
    }

    if (silent && !autoValidate) {
        return;
    }

    const { soqlCount, soslCount } = applyDocumentValidation(document, diagnosticCollection, { severity });

    if (!silent) {
        vscode.window.showInformationMessage(buildSummaryMessage(soqlCount, soslCount));
    }
}

// Returns true when it is safe to delete diagnostics on close (URI is not workspace-validated).
// Exported for testing.
function shouldClearOnClose(uriString, workspaceValidatedUris) {
    return !workspaceValidatedUris.has(uriString);
}

async function validateWorkspace(diagnosticCollection, workspaceValidatedUris) {
    const { exemptKeywords, includeGlobs, severity } = getConfig();

    // Reset tracked URIs so a re-run starts clean.
    workspaceValidatedUris.clear();

    const uriSets = await Promise.all(includeGlobs.map(glob => vscode.workspace.findFiles(glob)));
    const seen = new Set();
    const uris = [];
    for (const batch of uriSets) {
        for (const uri of batch) {
            const key = uri.toString();
            if (!seen.has(key)) { seen.add(key); uris.push(uri); }
        }
    }

    let totalSoql = 0, totalSosl = 0, fileCount = 0;

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Validating workspace...', cancellable: false },
        async () => {
            for (const uri of uris) {
                const document = await vscode.workspace.openTextDocument(uri);
                if (!matchesGlob(document.fileName, includeGlobs)) continue;
                if (isExemptFile(document.fileName, exemptKeywords)) continue;
                const { soqlCount, soslCount } = applyDocumentValidation(document, diagnosticCollection, { severity });
                // Track this URI so onDidCloseTextDocument does not wipe its diagnostics.
                workspaceValidatedUris.add(uri.toString());
                totalSoql += soqlCount;
                totalSosl += soslCount;
                fileCount++;
            }
        }
    );

    vscode.window.showInformationMessage(buildWorkspaceSummaryMessage(fileCount, totalSoql, totalSosl));
}

function activate(context) {
    console.log('"apex-query-validator" extension is active!');

    const diagnosticCollection = vscode.languages.createDiagnosticCollection('apexQueryValidator');
    const workspaceValidatedUris = new Set();

    context.subscriptions.push(diagnosticCollection);
    context.subscriptions.push(decorationType);

    const disposable = vscode.commands.registerCommand('apex-query-validator.validateSoqlSosl', function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor!');
            return;
        }

        runValidation(editor.document, diagnosticCollection, { silent: false });
    });
    context.subscriptions.push(disposable);

    const workspaceDisposable = vscode.commands.registerCommand(
        'apex-query-validator.validateWorkspace',
        function () { return validateWorkspace(diagnosticCollection, workspaceValidatedUris); }
    );
    context.subscriptions.push(workspaceDisposable);

    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
        runValidation(document, diagnosticCollection, { silent: true });
    }));

    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => {
        runValidation(document, diagnosticCollection, { silent: true });
    }));

    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => {
        if (shouldClearOnClose(document.uri.toString(), workspaceValidatedUris)) {
            diagnosticCollection.delete(document.uri);
        }
    }));
}

function deactivate() {}

module.exports = {
    activate,
    deactivate,
    shouldClearOnClose
};
