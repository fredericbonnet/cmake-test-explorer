/**
 * @file CMake test adapter
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import {
  TestAdapter,
  TestLoadStartedEvent,
  TestLoadFinishedEvent,
  TestRunStartedEvent,
  TestRunFinishedEvent,
  TestSuiteEvent,
  TestEvent,
  TestDecoration,
  TestInfo,
  TestSuiteInfo,
  RetireEvent,
} from 'vscode-test-adapter-api';
import { Log } from 'vscode-test-adapter-util';
import { CmakeTestInfo } from './interfaces/cmake-test-info';
import { CmakeTestProcess } from './interfaces/cmake-test-process';
import {
  loadCmakeTests,
  scheduleCmakeTestProcess,
  executeCmakeTestProcess,
  cancelCmakeTestProcess,
  getCmakeTestDebugConfiguration,
  getCmakeTestEnvironmentVariables,
  CacheNotFoundError,
  getCtestPath,
  CmakeTestEvent,
  CmakeTestRunOptions,
} from './cmake-runner';

/** Special ID value for the root suite */
const ROOT_SUITE_ID = '*';

/** Suffix for suite IDS, used to distinguish suite IDs from test IDs */
const SUITE_SUFFIX = '*';

/**
 * CMake test adapter for the Test Explorer UI extension
 */
export class CmakeAdapter implements TestAdapter {
  private disposables: { dispose(): void }[] = [];

  /** Discovered CTest command path */
  private ctestPath: string = '';

  /** Discovered CMake tests */
  private cmakeTests: CmakeTestInfo[] = [];

  /** State */
  private state: 'idle' | 'loading' | 'running' | 'cancelled' = 'idle';

  /** Currently running test process */
  private currentTestProcess?: CmakeTestProcess;

  //
  // TestAdapter implementations
  //

  private readonly testsEmitter = new vscode.EventEmitter<
    TestLoadStartedEvent | TestLoadFinishedEvent
  >();
  private readonly testStatesEmitter = new vscode.EventEmitter<
    TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
  >();
  private readonly retireEmitter = new vscode.EventEmitter<RetireEvent>();
  private readonly autorunEmitter = new vscode.EventEmitter<void>();

  get tests(): vscode.Event<TestLoadStartedEvent | TestLoadFinishedEvent> {
    return this.testsEmitter.event;
  }
  get testStates(): vscode.Event<
    TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
  > {
    return this.testStatesEmitter.event;
  }
  get retire(): vscode.Event<RetireEvent> | undefined {
    return this.retireEmitter.event;
  }
  get autorun(): vscode.Event<void> | undefined {
    return this.autorunEmitter.event;
  }

  constructor(
    public readonly workspaceFolder: vscode.WorkspaceFolder,
    private readonly log: Log
  ) {
    this.log.info('Initializing CMake test adapter');

    this.disposables.push(this.testsEmitter);
    this.disposables.push(this.testStatesEmitter);
    this.disposables.push(this.autorunEmitter);
  }

  async load(): Promise<void> {
    if (this.state !== 'idle') return; // it is safe to ignore a call to `load()`, even if it comes directly from the Test Explorer

    this.state = 'loading';
    this.log.info('Loading CMake tests');
    this.testsEmitter.fire(<TestLoadStartedEvent>{ type: 'started' });

    try {
      const suite = await this.loadTestSuite();
      this.testsEmitter.fire(<TestLoadFinishedEvent>{
        type: 'finished',
        suite,
      });
    } catch (e) {
      this.testsEmitter.fire(<TestLoadFinishedEvent>{
        type: 'finished',
        errorMessage: `${e}`,
      });
    }

    this.state = 'idle';
  }

  async run(tests: string[]): Promise<void> {
    if (this.state !== 'idle') return; // it is safe to ignore a call to `run()`

    this.state = 'running';
    this.log.info(`Running CMake tests ${JSON.stringify(tests)}`);
    this.testStatesEmitter.fire(<TestRunStartedEvent>{
      type: 'started',
      tests,
    });

    const runAll = tests.length == 1 && tests[0] === ROOT_SUITE_ID;
    if (runAll) {
      try {
        this.testStatesEmitter.fire(<TestSuiteEvent>{
          type: 'suite',
          suite: ROOT_SUITE_ID,
          state: 'running',
        });
        await this.runTests([]);
        this.testStatesEmitter.fire(<TestSuiteEvent>{
          type: 'suite',
          suite: ROOT_SUITE_ID,
          state: 'completed',
        });
      } catch (e) {
        this.testStatesEmitter.fire(<TestSuiteEvent>{
          type: 'suite',
          suite: ROOT_SUITE_ID,
          state: 'errored',
          message: `${e}`,
        });
      }
    } else {
      try {
        await this.runTests(tests);
      } catch (e) {
        // Fail silently
      }
    }

    this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: 'finished' });
    this.state = 'idle';
  }

  async debug(tests: string[]): Promise<void> {
    this.log.info(`Debugging CMake tests ${JSON.stringify(tests)}`);

    try {
      for (const id of tests) {
        await this.debugTest(id);
      }
    } catch (e) {
      // Fail silently
    }
  }

  cancel(): void {
    if (this.state !== 'running') return; // ignore

    if (this.currentTestProcess)
      cancelCmakeTestProcess(this.currentTestProcess);

    // State will eventually transition to idle once the run loop completes
    this.state = 'cancelled';
  }

  dispose(): void {
    this.cancel();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }

  /**
   * Load test suite
   */
  private async loadTestSuite() {
    try {
      // Get & substitute config settings
      const [
        buildDir,
        buildConfig,
        extraCtestLoadArgs,
        suiteDelimiter,
        testFileVar,
        testLineVar,
      ] = await this.getConfigStrings([
        'buildDir',
        'buildConfig',
        'extraCtestLoadArgs',
        'suiteDelimiter',
        'testFileVar',
        'testLineVar',
      ]);

      // Load CTest test list
      const dir = path.resolve(this.workspaceFolder.uri.fsPath, buildDir);
      this.ctestPath = getCtestPath(dir);
      this.cmakeTests = await loadCmakeTests(
        this.ctestPath,
        dir,
        buildConfig,
        extraCtestLoadArgs
      );

      // Convert to Test Explorer format
      const rootSuite: TestSuiteInfo = {
        type: 'suite',
        id: ROOT_SUITE_ID,
        label: 'CMake', // the label of the root node should be the name of the testing framework
        children: [],
      };
      if (!suiteDelimiter) {
        // CTest doesn't support nested tests and we do not split them ourselves
        // Create one top-level suite containing all tests
        rootSuite.children = this.cmakeTests.map((test) => ({
          type: 'test',
          id: test.name,
          label: test.name,
          ...getTestFileInfo(test, testFileVar, testLineVar),
        }));
        return rootSuite;
      } else {
        // Create a hierarchical suite by splitting CTest names
        for (let test of this.cmakeTests) {
          const path = test.name.split(suiteDelimiter);
          const testName = path.pop() || 'undefined';
          let suite = rootSuite;
          let currentId = '';
          for (let name of path) {
            currentId += name + suiteDelimiter;
            let childSuite = suite.children.find(
              (item) =>
                item.type == 'suite' && item.id === currentId + SUITE_SUFFIX
            );
            if (!childSuite) {
              childSuite = {
                type: 'suite',
                id: currentId + SUITE_SUFFIX,
                label: name,
                children: [],
                tooltip: currentId.substr(
                  0,
                  currentId.length - suiteDelimiter.length
                ),
              };
              suite.children.push(childSuite);
            }
            suite = childSuite as TestSuiteInfo;
          }
          const testInfo: TestInfo = {
            type: 'test',
            id: test.name,
            label: testName,
            description: test.name,
            tooltip: test.name,
            ...getTestFileInfo(test, testFileVar, testLineVar),
          };
          suite.children.push(testInfo);
        }
        return rootSuite;
      }
    } catch (e) {
      if (e instanceof CacheNotFoundError && !(await this.isCmakeWorkspace())) {
        // Ignore error when extension is not activable, return empty result instead
        this.log.info(
          `Workspace does not seem to contain CMake project files, ignoring tests`
        );
        return;
      } else {
        throw e;
      }
    }
  }

  /**
   * Run tests
   *
   * @param tests Test IDs (empty for all)
   */
  private async runTests(tests: string[]) {
    if (this.state === 'cancelled') {
      // Test run cancelled, retire tests
      this.retireEmitter.fire(<RetireEvent>{ tests });
      return;
    }

    try {
      // Get run options
      const options = await this.getRunOptions();

      // Get & substitute config settings
      const [suiteDelimiter, errorPattern] = await this.getConfigStrings([
        'suiteDelimiter',
        'errorPattern',
      ]);
      const errorPatternRe = new RegExp(errorPattern);

      // Get flat list of test indexes
      const testIndexes = this.getTestIndexes(tests, suiteDelimiter);

      // Run tests
      this.currentTestProcess = scheduleCmakeTestProcess(testIndexes, options);
      const outputs: string[][] = [];
      const decorations: TestDecoration[][] = [];

      await executeCmakeTestProcess(
        this.currentTestProcess,
        (event: CmakeTestEvent) => {
          switch (event.type) {
            case 'start':
              this.testStatesEmitter.fire(<TestEvent>{
                type: 'test',
                test: event.name,
                state: 'running',
              });
              break;

            case 'output':
              if (!outputs[event.index]) outputs[event.index] = [];
              outputs[event.index].push(event.line);

              const matches = event.text?.match(errorPatternRe);
              if (matches?.groups) {
                const { file, line, severity, message } = matches.groups;

                if (!decorations[event.index]) decorations[event.index] = [];
                decorations[event.index].push({
                  file,
                  line: Number.parseInt(line) - 1,
                  message: severity ? `${severity}: ${message}` : message,
                });
              }
              break;

            case 'end':
              let message = outputs[event.index]
                ? outputs[event.index].join('\n')
                : undefined;
              this.testStatesEmitter.fire(<TestEvent>{
                type: 'test',
                test: event.name,
                state: event.state,
                message,
                decorations: decorations[event.index],
              });
              break;
          }
        }
      );
    } finally {
      this.currentTestProcess = undefined;
    }
  }

  /**
   * Get test run options
   *
   * @return Run options
   */
  private async getRunOptions(): Promise<CmakeTestRunOptions> {
    // Get & substitute config settings
    const [buildDir, buildConfig, extraCtestRunArgs] =
      await this.getConfigStrings([
        'buildDir',
        'buildConfig',
        'extraCtestRunArgs',
      ]);
    const extraCtestEnvVars = await this.getConfigObject('extraCtestEnvVars');
    const parallelJobs = this.getParallelJobs();

    return {
      ctestPath: this.ctestPath,
      cwd: path.resolve(this.workspaceFolder.uri.fsPath, buildDir),
      env: mergeVariablesIntoProcessEnv(extraCtestEnvVars),
      parallelJobs,
      buildConfig,
      extraArgs: extraCtestRunArgs,
    };
  }

  /**
   * Get flat list of test indexes
   *
   * @param ids Test or suite IDs (empty for all)
   * @param suiteDelimiter Test suite delimiter
   */
  private getTestIndexes(ids: string[], suiteDelimiter: string) {
    if (ids.length === 0) {
      // All tests
      return [];
    }

    // Build flat test list
    let tests = [];
    const allTests = this.cmakeTests.map((test) => test.name);
    for (const id of ids) {
      if (suiteDelimiter && id.endsWith(suiteDelimiter + SUITE_SUFFIX)) {
        // Include whole suite if given a suite ID
        tests.push(
          ...allTests.filter((test) =>
            test.startsWith(id.substr(0, id.length - SUITE_SUFFIX.length))
          )
        );
      } else {
        // Single test
        tests.push(id);
      }
    }

    // Return test indexes
    return tests.map(
      (id) => this.cmakeTests.findIndex((test) => test.name === id) + 1
    );
  }

  /**
   * Debug a single test
   *
   * @param id Test ID
   */
  private async debugTest(id: string) {
    if (id === ROOT_SUITE_ID) {
      // Can't debug test suite.
      return;
    }

    //
    // Single test
    //

    const test = this.cmakeTests.find((test) => test.name === id);
    if (!test) {
      // Not found.
      return;
    }

    // Debug test
    this.log.info(`Debugging CMake test ${id}`);
    const disposables: vscode.Disposable[] = [];
    try {
      // Get & substitute config settings
      const extraCtestEnvVars = await this.getConfigObject('extraCtestEnvVars');

      // Get global debug config
      const [debugConfig] = await this.getConfigStrings(['debugConfig']);
      const defaultConfig = this.getDefaultDebugConfiguration();

      // Get test-specific debug config
      const { env, ...debuggedTestConfig } =
        getCmakeTestDebugConfiguration(test);

      // Utilities to merge configs and environment variables
      const mergeEnvironments = (environment: DebugEnvironment) =>
        mergeVariablesIntoDebugEnv(
          mergeVariablesIntoDebugEnv(environment, extraCtestEnvVars),
          env
        );
      const mergeConfigs = ({
        environment = [],
        ...config
      }: vscode.DebugConfiguration) => ({
        ...config,
        ...debuggedTestConfig,
        environment: mergeEnvironments(environment),
      });
      const mergeLldbConfigs = (config: vscode.DebugConfiguration) => ({
        ...config,
        ...debuggedTestConfig,
        env: { ...config.env, ...extraCtestEnvVars, ...env },
      });

      // Register a DebugConfigurationProvider to combine global and
      // test-specific debug configurations before the debugging session starts
      disposables.push(
        vscode.debug.registerDebugConfigurationProvider('*', {
          resolveDebugConfigurationWithSubstitutedVariables: (
            folder: vscode.WorkspaceFolder | undefined,
            config: vscode.DebugConfiguration,
            token?: vscode.CancellationToken
          ): vscode.ProviderResult<vscode.DebugConfiguration> =>
            config.type === 'lldb'
              ? mergeLldbConfigs(config)
              : mergeConfigs(config),
        })
      );

      // Start the debugging session. The actual debug config will combine the
      // global and test-specific values
      await vscode.debug.startDebugging(
        this.workspaceFolder,
        debugConfig || defaultConfig
      );
    } catch (e) {
      this.log.error(`Error debugging CMake test ${id}: ${e}`);
    } finally {
      disposables.forEach((disposable) => disposable.dispose());
    }
  }

  /**
   * Get default debug config when none is specified in the settings
   */
  private getDefaultDebugConfiguration(): vscode.DebugConfiguration {
    return {
      name: 'CTest',
      type: 'cppdbg',
      request: 'launch',
      windows: {
        type: 'cppvsdbg',
      },
      linux: {
        type: 'cppdbg',
        MIMode: 'gdb',
      },
      osx: {
        type: 'cppdbg',
        MIMode: 'lldb',
      },
    };
  }

  /**
   * Get workspace configuration object
   */
  private getWorkspaceConfiguration() {
    return vscode.workspace.getConfiguration(
      'cmakeExplorer',
      this.workspaceFolder.uri
    );
  }

  /**
   * Check whether the workspace contains CMake project files
   *
   * Note: we don't use `"activationEvents" for that because of issue
   * [#57](https://github.com/fredericbonnet/cmake-test-explorer/issues/57).
   * Testing the file presence explicitly allows us to make this test
   * programmatically
   */
  private async isCmakeWorkspace() {
    const uris = await vscode.workspace.findFiles('**/CMakeLists.txt', null, 1);
    return !!uris.length;
  }

  /**
   * Get & substitute config settings
   *
   * @param name Config names
   *
   * @return Config values
   */
  private async getConfigStrings(names: string[]) {
    const config = this.getWorkspaceConfiguration();
    const varMap = await this.getVariableSubstitutionMap();
    return names.map((name) => this.configGetStr(config, varMap, name));
  }

  /**
   * Get & substitute config settings
   *
   * @param config VS Code workspace configuration
   * @param varMap Variable to value map
   * @param key Config name
   */
  private configGetStr(
    config: vscode.WorkspaceConfiguration,
    varMap: Map<string, string>,
    key: string
  ) {
    const configStr = config.get<string>(key) || '';
    return substituteString(configStr, varMap);
  }

  /**
   * Get & substitute config object
   *
   * @param name Config object name
   *
   * @return Config object values
   */
  private async getConfigObject(name: string) {
    const config = this.getWorkspaceConfiguration();
    const varMap = await this.getVariableSubstitutionMap();
    const obj = config.get<{ [key: string]: string }>(name) || {};
    for (let key in obj) {
      obj[key] = substituteString(obj[key], varMap);
    }
    return obj;
  }

  /**
   * Get variable to value substitution map for config strings
   *
   * @note on Windows environment variable names are converted to uppercase
   */
  private async getVariableSubstitutionMap() {
    // Standard variables
    const substitutionMap = new Map<string, string>([
      ['${workspaceFolder}', this.workspaceFolder.uri.fsPath],
    ]);

    // Variables from the CMake Tools extension
    for (const varname of ['buildType', 'buildDirectory']) {
      const command = `cmake.${varname}`;
      if ((await vscode.commands.getCommands()).includes(command)) {
        const value = (await vscode.commands.executeCommand(
          command,
          this.workspaceFolder
        )) as string;
        substitutionMap.set(`\${${varname}}`, value);
      } else {
        // Missing variables default to empty
        substitutionMap.set(`\${${varname}}`, '');
      }
    }

    // Environment variables prefixed by 'env:'
    for (const [varname, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        substitutionMap.set(
          `\${env:${
            process.platform == 'win32' ? varname.toUpperCase() : varname
          }}`,
          value
        );
      }
    }

    return substitutionMap;
  }

  /**
   * Get number of jobs to run in parallel
   */
  private getParallelJobs() {
    const config = vscode.workspace.getConfiguration(
      'cmakeExplorer',
      this.workspaceFolder.uri
    );

    let parallelJobs = config.get<number>('parallelJobs');
    if (!parallelJobs) {
      const cmakeConfig = vscode.workspace.getConfiguration(
        'cmake',
        this.workspaceFolder.uri
      );
      parallelJobs = cmakeConfig.get<number>('ctest.parallelJobs');
      if (!parallelJobs) {
        parallelJobs = cmakeConfig.get<number>('parallelJobs');
        if (!parallelJobs) {
          parallelJobs = os.cpus().length;
        }
      }
    }
    if (parallelJobs < 1) parallelJobs = 1;
    return parallelJobs;
  }
}

/**
 * Get test file/line number info from CMake test info
 *
 * @param test CMake test info
 * @param testFileVar CTest environment variable for file path
 * @param testLineVar CTest environment variable for line number
 */
const getTestFileInfo = (
  test: CmakeTestInfo,
  testFileVar: string,
  testLineVar: string
) => {
  const env = getCmakeTestEnvironmentVariables(test);
  if (!env) return {};

  return {
    file: getFileFromEnvironment(env, testFileVar),
    line: getLineFromEnvironment(env, testLineVar),
  };
};

/**
 * Get file path from environment variables
 *
 * @param env Map of environment variables
 * @param varname Variable name to get value for
 */
const getFileFromEnvironment = (env: NodeJS.ProcessEnv, fileVar: string) =>
  env[fileVar];

/**
 * Get line number from environment variables
 *
 * @param env Map of environment variables
 * @param varname Variable name to get value for
 */
const getLineFromEnvironment = (env: NodeJS.ProcessEnv, varname: string) => {
  const value = env[varname];
  // Test Explorer expects 0-indexed line numbers
  if (value) return Number.parseInt(value) - 1;
  return;
};

/**
 * Substitute variables in string
 *
 * @param str String to substitute
 * @param varMap Variable to value map
 *
 * @return Substituted string
 */
const substituteString = (str: string, varMap: Map<string, string>) => {
  varMap.forEach((value, key) => {
    while (str.indexOf(key) > -1) {
      str = str.replace(key, value);
    }
  });
  return str;
};

/** Debug environment array */
type DebugEnvironment = { name: string; value: string | undefined }[];

/**
 * Get key of variable in process environment
 *
 * Some platforms such as Win32 have case-insensitive environment variables
 *
 * @param varname Variable name
 * @param env Process environment
 */
const getVariableKey = (varname: string, env: NodeJS.ProcessEnv) =>
  process.platform === 'win32'
    ? Object.keys(env).find(
        (key) => key.toUpperCase() == varname.toUpperCase()
      ) || varname
    : varname;

/**
 * Get index of variable in debug environment
 *
 * Some platforms such as Win32 have case-insensitive environment variables
 *
 * @param varname Variable name
 * @param environment Debug environment
 */
const getVariableIndex = (varname: string, environment: DebugEnvironment) =>
  process.platform === 'win32'
    ? environment.findIndex(
        ({ name }) => name.toUpperCase() == varname.toUpperCase()
      )
    : environment.findIndex(({ name }) => name == varname);

/**
 * Merge variables into process environment
 *
 * @param variables Variables to merge
 *
 * @return Environment with variables merged
 */
const mergeVariablesIntoProcessEnv = (variables: {
  [name: string]: string;
}) => {
  const result = { ...process.env };
  for (let name in variables) {
    delete result[getVariableKey(name, process.env)];
    result[name] = variables[name];
  }
  return result;
};

/**
 * Merge variables into debug environment
 *
 * @param environment Target environment
 * @param variables Variables to merge
 *
 * @return Environment with variables merged
 */
const mergeVariablesIntoDebugEnv = (
  environment: DebugEnvironment,
  variables: { [name: string]: string }
) => {
  const result = [...environment];
  for (let name in variables) {
    const variableIndex = getVariableIndex(name, environment);
    if (variableIndex == -1) {
      result.push({ name, value: variables[name] });
    } else {
      result[variableIndex] = { name, value: variables[name] };
    }
  }
  return result;
};
