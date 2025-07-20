const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
let buildLogWatcher = null;

const log = (...args) => {
    console.log('[WatchBuildLog] ', ...args);
}

function activate(context) {
    log('extension is now active!');

    buildLogWatcher = new BuildLogWatcher();

    // Register commands
    const startWatchingCommand = vscode.commands.registerCommand('watchbuildlog.startWatching', () => {
        buildLogWatcher.startWatching();
    });

    const stopWatchingCommand = vscode.commands.registerCommand('watchbuildlog.stopWatching', () => {
        buildLogWatcher.stopWatching();
    });

    // Watch for configuration changes
    const configChangeWatcher = vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('watchbuildlog')) {
            buildLogWatcher.onConfigurationChanged();
        }
    });

    context.subscriptions.push(startWatchingCommand, stopWatchingCommand, configChangeWatcher);

    // Auto-start if configured
    const config = vscode.workspace.getConfiguration('watchbuildlog');
    if (config.get('autoStart')) {
        buildLogWatcher.startWatching();
    }
}

function deactivate() {
    if (buildLogWatcher) {
        buildLogWatcher.stopWatching();
        buildLogWatcher = null;
    }
    log('extension is now deactivated!');
}

class BuildLogWatcher {
    constructor() {
        this.watchers = new Map(); // Map of file path to watcher
        this.diagnostics = vscode.languages.createDiagnosticCollection('buildlog');
        this.watching = false;
        this.intervalId = null;
    }

    onConfigurationChanged() {
        if (this.watching) {
            this.stopWatching();
            this.startWatching();
        }
    }

    getMatchedFiles(showWarnings = false) {
        const config = vscode.workspace.getConfiguration('watchbuildlog');
        const wildcards = config.get('logFilePathWildcards') || [];
        const problemPatterns = config.get('problemMatcherPatterns') || [];

        if (wildcards.length === 0) {
            vscode.window.showErrorMessage('No build log file patterns configured. Please set "watchbuildlog.logFilePathWildcards" in your settings.');
            return;
        }
        if (problemPatterns.length === 0) {
            vscode.window.showErrorMessage('No problem matcher patterns configured. Please set "watchbuildlog.problemMatcherPatterns" in your settings.');
            return;
        }

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
        if (!workspaceRoot) {
            vscode.window.showWarningMessage('No workspace folder open. Cannot resolve relative paths.');
        }

        const matchedFiles = this.findMatchingFiles(wildcards, workspaceRoot);
        return matchedFiles;
    }

    updateWatchersAndParseMostRecentLog(fileChanged = false) {
        const matchedFiles = this.getMatchedFiles(false);

        if (matchedFiles.length === 0) {
            vscode.window.showWarningMessage('No files found matching the configured wildcard patterns.');
            return;
        }

        // For each this.watchers, check if its not in matchedFiles and if so, remove it
        let fileSetChange = false;
        this.watchers.forEach((watcher, filePath) => {
            if (!matchedFiles.includes(filePath)) {
                fs.unwatchFile(filePath);
                this.watchers.delete(filePath);
                this.diagnostics.delete(vscode.Uri.file(filePath));
                fileSetChange = true;
            }
        });

        matchedFiles.forEach(filePath => {
            // Skip if already being watched
            if (this.watchers.has(filePath)) {
                return;
            }
            try {
                const watcher = fs.watchFile(filePath, (curr, prev) => {
                    this.updateWatchersAndParseMostRecentLog(true);
                });
                
                this.watchers.set(filePath, watcher);
                fileSetChange = true;
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to watch ${filePath}: ${error}`);
            }
        });

        if (fileSetChange || fileChanged) {
            let mostRecentFile = null;
            let mostRecentTime = 0;

            // Find the most recently modified file
            matchedFiles.forEach(filePath => {
                try {
                    const stats = fs.statSync(filePath);
                    if (stats.mtime.getTime() > mostRecentTime) {
                        mostRecentTime = stats.mtime.getTime();
                        mostRecentFile = filePath;
                    }
                } catch (error) {
                    // File might not exist, skip it
                }
            });

            if (mostRecentFile) {
                this.parseLogFile(mostRecentFile);
            } else {
                // If no files were found, a previous build log might have been deleted
                // so we clear old diagnostics.
                this.diagnostics.clear();
            }
        }

        if (fileSetChange) {
            vscode.window.showInformationMessage(`Watching ${this.watchers.size} build log file(s)`);
        }
    }

    startWatching() {
        if (this.watching) {
            vscode.window.showInformationMessage('Already watching build log files.');
            return;
        }

        // We don't actually care about the results, but we run it to validate the config 
        // and show warnings if there are config issues.
        this.getMatchedFiles(true);

        this.updateWatchersAndParseMostRecentLog(true);

        console.assert(!this.intervalId, 'Interval ID should not be set when starting to watch');
        this.intervalId = setInterval(() => {
            this.updateWatchersAndParseMostRecentLog();
        }, 5000); // Check every 5 seconds

        this.watching = true;
    }

    stopWatching() {
        if (!this.watching) {
            vscode.window.showInformationMessage('Already not watching build log files.');
            return;
        }

        this.watching = false;
        clearInterval(this.intervalId);
        this.intervalId = null;
        this.watchers.forEach((watcher, filePath) => {
            fs.unwatchFile(filePath);
        });
        this.watchers.clear();
        this.diagnostics.clear();
    }

    findMatchingFiles(wildcards, workspaceRoot) {
        const matchedFiles = new Set();

        wildcards.forEach(pattern => {
            const resolvedPattern = path.isAbsolute(pattern) ? pattern : path.resolve(workspaceRoot, pattern);
            const files = this.globMatch(resolvedPattern);
            files.forEach(file => matchedFiles.add(file));
        });

        return Array.from(matchedFiles);
    }

    globMatch(pattern) {
        const matches = [];
        const parts = pattern.split(path.sep);
        
        try {
            this.searchPath(parts, 0, '', matches);
        } catch (error) {
            // Silently ignore errors for invalid paths
        }
        
        return matches;
    }

    searchPath(parts, index, currentPath, matches) {
        if (index >= parts.length) {
            if (fs.existsSync(currentPath) && fs.statSync(currentPath).isFile()) {
                matches.push(currentPath);
            }
            return;
        }

        const part = parts[index];
        
        if (part === '') {
            // Handle leading separator or drive on Windows
            if (index === 0) {
                this.searchPath(parts, index + 1, path.sep, matches);
            }
            return;
        }

        if (part.includes('*')) {
            // Handle wildcard
            const basePath = currentPath || (index === 0 ? '' : path.sep);
            if (!fs.existsSync(basePath) || !fs.statSync(basePath).isDirectory()) {
                return;
            }

            const regex = new RegExp('^' + part.replace(/\*/g, '.*') + '$');
            try {
                const entries = fs.readdirSync(basePath);
                entries.forEach(entry => {
                    if (regex.test(entry)) {
                        const fullPath = path.join(basePath, entry);
                        this.searchPath(parts, index + 1, fullPath, matches);
                    }
                });
            } catch (error) {
                // Ignore permission errors
            }
        } else {
            // Exact match
            const nextPath = currentPath ? path.join(currentPath, part) : part;
            this.searchPath(parts, index + 1, nextPath, matches);
        }
    }

    parseLogFile(logFilePath) {
        try {
            const content = fs.readFileSync(logFilePath, 'utf8');
            // Handle CRLF and LF line endings. Remove any CR and then delimit by LF.
            // This also works for mixed line endings.
            const lines = content.replace('\r', '').split('\n');
            const config = vscode.workspace.getConfiguration('watchbuildlog');
            const problemPatterns = config.get('problemMatcherPatterns') || [];

            log(`File ${logFilePath} has ${lines.length} lines. Parsing with ${problemPatterns.length} problem patterns`);
            const diagnosticsMap = new Map();

            this.diagnostics.clear();

            let previousError = null;

            lines.forEach((line, lineNumber) => {
                line = line.replace('\n', '').trim();
                const errorInfo = this.parseErrorLine(line, problemPatterns);
                if (errorInfo) {
                    let filePath = errorInfo.file;
                    // If filePath is relative, resolve it against the folder containing the log file
                    if (!path.isAbsolute(filePath)) {
                        const logDir = path.dirname(logFilePath);
                        filePath = path.resolve(logDir, filePath);
                    }

                    if (!diagnosticsMap.has(filePath)) {
                        diagnosticsMap.set(filePath, []);
                    }

                    const severity = this.mapSeverity(errorInfo.severity);
                    if (severity === 'note') {
                        if (previousError) {
                            if (!previousError.relatedInformation) {
                                previousError.relatedInformation = [];
                            }
                            previousError.relatedInformation.push(
                                new vscode.DiagnosticRelatedInformation(
                                    new vscode.Location(vscode.Uri.file(filePath), new vscode.Range(
                                        (errorInfo.line ? errorInfo.line - 1 : lineNumber),
                                        (errorInfo.column ? errorInfo.column - 1 : 0),
                                        (errorInfo.line ? errorInfo.line - 1 : lineNumber),
                                        (errorInfo.column ? errorInfo.column - 1 : line.length)
                                    )),
                                    errorInfo.message
                                )
                            );
                        }
                    } else {
                        const diagnostic = new vscode.Diagnostic(
                            new vscode.Range(
                                (errorInfo.line ? errorInfo.line - 1 : lineNumber),
                                (errorInfo.column ? errorInfo.column - 1 : 0),
                                (errorInfo.line ? errorInfo.line - 1 : lineNumber),
                                (errorInfo.column ? errorInfo.column - 1 : line.length)
                            ),
                            errorInfo.message,
                            severity
                        );
                        previousError = diagnostic;

                        diagnostic.source = 'Build Log';
                        if (errorInfo.code) {
                            diagnostic.code = errorInfo.code;
                        }

                        diagnosticsMap.get(filePath).push(diagnostic);
                    }
                }
            });

            // Set new diagnostics
            diagnosticsMap.forEach((diagnostics, filePath) => {
                this.diagnostics.set(vscode.Uri.file(filePath), diagnostics);
            });

            log(`Found ${Array.from(diagnosticsMap.values()).reduce((sum, diags) => sum + diags.length, 0)} total errors/warnings`);
            log("");

        } catch (error) {
            log(`Error parsing log file ${logFilePath}:`, error);
            vscode.window.showErrorMessage(`Failed to parse log file: ${error}`);
        }
    }

    parseErrorLine(line, problemPatterns) {
        for (const pattern of problemPatterns) {
            try {
                const regex = new RegExp(pattern.regexp, 'i');
                const match = line.match(regex);

                if (match) {
                    const errorInfo = {
                        message: pattern.message ? match[pattern.message] : line.trim()
                    };

                    if (pattern.file && match[pattern.file]) {
                        errorInfo.file = match[pattern.file].trim();
                    }
                    
                    if (pattern.line && match[pattern.line]) {
                        errorInfo.line = parseInt(match[pattern.line]);
                    }
                    
                    if (pattern.column && match[pattern.column]) {
                        errorInfo.column = parseInt(match[pattern.column]);
                    }
                    
                    if (pattern.severity && match[pattern.severity]) {
                        errorInfo.severity = match[pattern.severity].toLowerCase();
                    }
                    
                    if (pattern.code && match[pattern.code]) {
                        errorInfo.code = match[pattern.code];
                    }

                    return errorInfo;
                }
            } catch (error) {
                // Invalid regex, skip this pattern
                log(`Invalid regex pattern: ${pattern.regexp}`, error);
            }
        }

        return null;
    }

    mapSeverity(severityString) {
        if (!severityString) {
            return vscode.DiagnosticSeverity.Error;
        }

        switch (severityString.toLowerCase()) {
            case 'error':
            case 'fatal':
            case 'fatal error':
                return vscode.DiagnosticSeverity.Error;
            case 'warning':
            case 'warn':
                return vscode.DiagnosticSeverity.Warning;
            case 'info':
            case 'information':
                return vscode.DiagnosticSeverity.Information;
            case 'hint':
                return vscode.DiagnosticSeverity.Hint;
            case 'note':
                return 'note'; // Special case for notes to associate with previous errors
            default:
                return vscode.DiagnosticSeverity.Error;
        }
    }
}

module.exports = {
    activate,
    deactivate
};
