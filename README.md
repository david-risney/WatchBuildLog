# WatchBuildLog VS Code Extension

A Visual Studio Code extension that monitors build log files for errors and displays them in VS Code's Problems panel for quick identification and navigation.

## Features

- **Real-time monitoring**: Watches build log files for changes and automatically parses new content
- **Error detection**: Configurable regex patterns to identify different types of build errors
- **VS Code integration**: Displays errors in the Problems panel with clickable links to source files
- **File navigation**: Jump directly to error locations when file paths and line numbers are available
- **Multiple log formats**: Supports common build log formats from various compilers and build systems

## Commands

The extension provides the following commands accessible via the Command Palette (`Ctrl+Shift+P`):

- **WatchBuildLog: Start Watching Build Log** - Begin monitoring the configured log file
- **WatchBuildLog: Stop Watching Build Log** - Stop monitoring and clear error diagnostics

## Configuration

Configure the extension through VS Code settings:

### `watchbuildlog.logFilePathWildcards`
- **Type**: `array`
- **Default**: `[]`
- **Description**: Glob-style wildcard patterns for build log files. Patterns can be absolute paths or relative to the project root. Use '*' to match any text in a folder segment.
- **Scope**: Resource (can be set per workspace)
- **Examples**: 
  - `"out/*_x64/siso.log"` - Matches siso.log in any subfolder of out/ that ends with _x64
  - `"build/*/errors.log"` - Matches errors.log in any direct subfolder of build/
  - `"C:/logs/*.log"` - Absolute path matching any .log file in C:/logs/

### `watchbuildlog.autoStart`
- **Type**: `boolean`
- **Default**: `false`
- **Description**: Automatically start watching when VS Code opens

### `watchbuildlog.errorPatterns`
- **Type**: `array`
- **Default**: `["error:", "Error:", "ERROR:", "fatal error:", "Fatal Error:"]`
- **Description**: Regex patterns to identify error lines in build logs

## Supported Error Formats

The extension can parse common error formats including:

- GCC/Clang: `filename.cpp:123:45: error: message`
- MSVC: `filename.cpp(123,45): error: message`
- Generic: `filename.cpp(123): error: message`
- Simple: Lines containing configured error patterns

## Usage

1. **Configure log file patterns**: 
   - Open VS Code Settings (`Ctrl+,`)
   - Search for "watchbuildlog"
   - Add wildcard patterns to "Log File Path Wildcards"
   - Or add to your `settings.json`: `"watchbuildlog.logFilePathWildcards": ["out/*_x64/siso.log", "build/*/errors.log"]`

2. **Start watching**: Run "Start Watching Build Log" command or enable auto-start

3. **View errors**: Build errors will appear in the Problems panel (`Ctrl+Shift+M`)

4. **Navigate to errors**: Click on errors in the Problems panel to jump to the source location

### Settings UI Access

1. **Via Settings UI**:
   - Open Settings (`Ctrl+,`)
   - Search for "Watch Build Log" or "watchbuildlog"
   - Configure all extension settings through the UI

2. **Via JSON Settings**:
   ```json
   {
     "watchbuildlog.logFilePathWildcards": [
       "out/*_x64/siso.log",
       "build/*/errors.log",
       "C:/absolute/path/to/build.log"
     ],
     "watchbuildlog.autoStart": true,
     "watchbuildlog.errorPatterns": ["error:", "Error:", "ERROR:"]
   }
   ```

### Wildcard Pattern Examples

- `"out/*_x64/siso.log"` - Matches `out/Debug_x64/siso.log`, `out/Release_x64/siso.log`, etc.
- `"build/*/logs/*.log"` - Matches any .log file in any subfolder of build/*/logs/
- `"**/build.log"` - Matches build.log in any subdirectory at any depth
- `"logs/*"` - Matches any file directly in the logs folder

## Installation

### From Source
1. Clone this repository
2. Press `F5` to open a new Extension Development Host window (no build step required!)

### Building VSIX Package
1. Install vsce: `npm install -g vsce`
2. Run `vsce package` to create a .vsix file
3. Install via `code --install-extension watchbuildlog-0.0.1.vsix`

## Requirements

- Visual Studio Code 1.74.0 or higher

## Extension Development

### Project Structure
```
├── src/
│   └── extension.js         # Main extension code
├── package.json             # Extension manifest
└── README.md               # This file
```

### Build Commands
- No build step required! The extension runs directly from JavaScript.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Release Notes

### 0.0.1
- Initial release
- Basic log file watching functionality
- Error parsing and display in Problems panel
- Configurable error patterns
