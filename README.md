# CMake Test Explorer for Visual Studio Code

Run your [CMake](https://cmake.org) tests using the [Test Explorer UI](https://marketplace.visualstudio.com/items?itemName=hbenl.vscode-test-explorer).

## Features

- Shows a Test Explorer in the Test view in VS Code's sidebar with all detected tests and suites and their state
- Shows a failed test's log when the test is selected in the explorer
- Forwards the console output from the test executable to a VS Code output channel

## Getting started

- Install the extension
- Open the Test view
- Run your tests using the ![Run](img/run.png) icon in the Test Explorer

## Configuration

| Property                           | Description                                                                                                                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cmakeExplorer.buildDir`           | Location of the CMake build directory. Can be absolute or relative to the workspace. Defaults to empty, i.e. the workspace directory.                                                                                             |
| `cmakeExplorer.buildConfig`        | Name of the CMake build configuration. Can be set to any standard or custom configuration name (e.g. `Default`, `Release`, `RelWithDebInfo`, `MinSizeRel` ). Case-insensitive. Defaults to empty, i.e. no specific configuration. |
| `cmakeExplorer.debugConfig`        | Custom debug configuration to use (empty for default). See [Debugging](#debugging) for more info.                                                                                                                                 |
| `cmakeExplorer.extraCtestLoadArgs` | Extra command-line arguments passed to CTest at load time. For example, `-R foo` will only load the tests containing the string `foo`. Defaults to empty.                                                                         |
| `cmakeExplorer.extraCtestRunArgs`  | Extra command-line arguments passed to CTest at run time. For example, `-V` will enable verbose output from tests. Defaults to empty.                                                                                             |

## Debugging

The extension comes pre-configured with sensible defaults for debugging tests:

```json
{
  "name": "CTest",
  "type": "cppdbg",
  "request": "launch",
  "windows": {
    "type": "cppvsdbg"
  },
  "linux": {
    "type": "cppdbg",
    "MIMode": "gdb"
  },
  "osx": {
    "type": "cppdbg",
    "MIMode": "lldb"
  }
}
```

You can also use a custom configuration defined in the standard `launch.json`.
To do so, edit the `cmakeExplorer.debugConfig` settings with the name of the
debug configuration to use.

Debugging a test will overwrite the following debug configuration fields with
values from the CTest metadata:

| Field     | Value                            |
| --------- | -------------------------------- |
| `name`    | `CTest ${test name}`             |
| `program` | CTest `COMMAND` option           |
| `args`    | CTest arguments                  |
| `cwd`     | CTest `WORKING_DIRECTORY` option |
