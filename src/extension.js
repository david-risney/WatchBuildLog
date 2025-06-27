const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function activate(context) {
    console.log('WatchBuildLog extension is now active!');

    const buildLogWatcher = new BuildLogWatcher();

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
    console.log('WatchBuildLog extension is now deactivated!');
}

class BuildLogWatcher {
    constructor() {
        this.watchers = new Map(); // Map of file path to watcher
        this.diagnostics = vscode.languages.createDiagnosticCollection('buildlog');
        this.currentWildcards = [];
    }

    onConfigurationChanged() {
        const config = vscode.workspace.getConfiguration('watchbuildlog');
        const newWildcards = config.get('logFilePathWildcards') || [];
        const newProblemPatterns = config.get('problemMatcherPatterns') || [];
        
        // If wildcards changed, restart watching
        if (JSON.stringify(newWildcards) !== JSON.stringify(this.currentWildcards) ||
            JSON.stringify(newProblemPatterns) !== JSON.stringify(this.currentProblemPatterns)) {
            this.stopWatching();
            if (newWildcards.length > 0 && newProblemPatterns.length > 0) {
                this.startWatching();
            }
        }
    }

    startWatching() {
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

        this.stopWatching(); // Stop any existing watchers
        this.currentWildcards = [...wildcards];
        this.currentProblemPatterns = [...problemPatterns];

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder open. Cannot resolve relative paths.');
            return;
        }

        const matchedFiles = this.findMatchingFiles(wildcards, workspaceRoot);
        
        if (matchedFiles.length === 0) {
            vscode.window.showWarningMessage('No files found matching the configured wildcard patterns.');
            return;
        }

        let watchersStarted = 0;
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

        matchedFiles.forEach(filePath => {
            try {
                const watcher = fs.watchFile(filePath, (curr, prev) => {
                    if (curr.mtime > prev.mtime) {
                        this.parseLogFile(filePath);
                    }
                });
                
                this.watchers.set(filePath, watcher);
                watchersStarted++;
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to watch ${filePath}: ${error}`);
            }
        });

        // Initial parse of only the most recently modified file
        if (mostRecentFile) {
            this.parseLogFile(mostRecentFile);
        }

        if (watchersStarted > 0) {
            vscode.window.showInformationMessage(`Started watching ${watchersStarted} build log file(s)`);
        }
    }

    stopWatching() {
        this.watchers.forEach((watcher, filePath) => {
            fs.unwatchFile(filePath);
        });
        this.watchers.clear();
        this.currentWildcards = [];
        this.diagnostics.clear();
        if (this.watchers.size > 0) {
            vscode.window.showInformationMessage('Stopped watching build logs');
        }
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

    parseLogFile(logFilePath, clearAllDiagnostics = true) {
        console.log(`[WatchBuildLog] Parsing log file: ${logFilePath}`);
        try {
            const content = fs.readFileSync(logFilePath, 'utf8');
            // Handle CRLF and LF line endings. First check for CRLF, then fallback to LF.
            // This ensures we handle both Windows and Unix line endings correctly
            const lines = content.split('\r\n').length > 1 ? content.split('\r\n') : content.split('\n');
            const config = vscode.workspace.getConfiguration('watchbuildlog');
            const problemPatterns = config.get('problemMatcherPatterns') || [];

            console.log(`[WatchBuildLog] File has ${lines.length} lines, using ${problemPatterns.length} problem patterns`);
            const diagnosticsMap = new Map();

            // Clear diagnostics for this specific file, or all files if requested
            if (clearAllDiagnostics) {
                this.diagnostics.clear();
            } else {
                // Clear diagnostics only for this specific file
                this.diagnostics.delete(vscode.Uri.file(logFilePath));
            }

            lines.forEach((line, lineNumber) => {
                const errorInfo = this.parseErrorLine(line, problemPatterns);
                if (errorInfo) {
                    let filePath = errorInfo.file || logFilePath;
                    // If filePath is relative, resolve it against the folder containing the log file
                    if (!path.isAbsolute(filePath)) {
                        const logDir = path.dirname(logFilePath);
                        filePath = path.resolve(logDir, filePath);
                    }

                    if (!diagnosticsMap.has(filePath)) {
                        diagnosticsMap.set(filePath, []);
                    }

                    const severity = this.mapSeverity(errorInfo.severity);
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

                    diagnostic.source = 'Build Log';
                    if (errorInfo.code) {
                        diagnostic.code = errorInfo.code;
                    }
                    
                    diagnosticsMap.get(filePath).push(diagnostic);
                }
            });

            // Set new diagnostics
            diagnosticsMap.forEach((diagnostics, filePath) => {
                this.diagnostics.set(vscode.Uri.file(filePath), diagnostics);
            });

            console.log(`[WatchBuildLog] Parsing complete. Found ${Array.from(diagnosticsMap.values()).reduce((sum, diags) => sum + diags.length, 0)} total errors/warnings`);

        } catch (error) {
            console.error(`[WatchBuildLog] Error parsing log file ${logFilePath}:`, error);
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
                console.warn(`[WatchBuildLog] Invalid regex pattern: ${pattern.regexp}`, error);
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
            default:
                return vscode.DiagnosticSeverity.Error;
        }
    }
}

module.exports = {
    activate,
    deactivate
};
