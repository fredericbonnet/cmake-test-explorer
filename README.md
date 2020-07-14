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
| `cmakeExplorer.cmakeIntegration`   | Integrate with the [CMake Tools](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cmake-tools) extension for additional variables. See [Variable substitution](#variable-substitution) for more info.                |
| `cmakeExplorer.debugConfig`        | Custom debug configuration to use (empty for default). See [Debugging](#debugging) for more info.                                                                                                                                 |
| `cmakeExplorer.extraCtestLoadArgs` | Extra command-line arguments passed to CTest at load time. For example, `-R foo` will only load the tests containing the string `foo`. Defaults to empty.                                                                         |
| `cmakeExplorer.extraCtestRunArgs`  | Extra command-line arguments passed to CTest at run time. For example, `-V` will enable verbose output from tests. Defaults to empty.                                                                                             |

## Variable substitution

Some options support the replacement of special values in their string value by using a `${variable}` syntax. The following built-in variables are expanded:

| Variable             | Expansion                                      |
| -------------------- | ---------------------------------------------- |
| `${workspaceFolder}` | The full path to the workspace root directory. |

Additionally, if the [CMake Tools](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cmake-tools) extension is active in the current workspace
and `cmakeExplorer.cmakeIntegration` is enabled, then the following variables can be used:

| Variable            | Expansion                                                                   |
| ------------------- | --------------------------------------------------------------------------- |
| `${buildType}`      | The current CMake build type. For example: `Debug`, `Release`, `MinSizeRel` |
| `${buildDirectory}` | The full path to the current CMake build directory.                         |

If you want the Test Explorer to infer the right configuration automatically from CMake Tools,
simply use these settings:

| Property                    | Value               |
| --------------------------- | ------------------- |
| `cmakeExplorer.buildDir`    | `${buildDirectory}` |
| `cmakeExplorer.buildConfig` | `${buildType}`      |

Note that any change to the CMake Tools configuration, either from the settings or the status bar,
requires a manual test reload from the Test Explorer sidebar.

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

For example, if you want the debugger to stop at the entry point of your tests,
add the following config in your `launch.json` then set `cmakeExplorer.debugConfig`
to "`myCustomDebugConfig`" :

```json
{
  "name": "myCustomDebugConfig",
  "type": "cppdbg",
  "request": "launch",
  "stopAtEntry": true,
  "windows": {
    "type": "cppvsdbg"
  }
}
```
