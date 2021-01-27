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
        errorMessage: e.toString(),
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
          message: e.toString(),
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
      if (e instanceof CacheNotFoundError && this.isDefaultConfiguration()) {
        // Ignore error when using default config, return empty result instead
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
      // Get & substitute config settings
      const [
        buildDir,
        extraCtestRunArgs,
        suiteDelimiter,
      ] = await this.getConfigStrings([
        'buildDir',
        'extraCtestRunArgs',
        'suiteDelimiter',
      ]);
      const parallelJobs = this.getParallelJobs();

      // Get flat list of test indexes
      const testIndexes = this.getTestIndexes(tests, suiteDelimiter);

      // Run tests
      const cwd = path.resolve(this.workspaceFolder.uri.fsPath, buildDir);
      this.currentTestProcess = scheduleCmakeTestProcess(
        this.ctestPath,
        cwd,
        testIndexes,
        parallelJobs,
        extraCtestRunArgs
      );
      let outputs: string[][] = [];
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
              break;

            case 'end':
              let message = outputs[event.index]
                ? outputs[event.index].join('\n')
                : undefined;
              this.testStatesEmitter.fire(<TestEvent>{
                type: 'test',
                test: event.name,
                state: event.success ? 'passed' : 'failed',
                message,
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
      // Get global debug config
      const [debugConfig] = await this.getConfigStrings(['debugConfig']);
      const defaultConfig = this.getDefaultDebugConfiguration();

      // Get test-specific debug config
      const debuggedTestConfig = getCmakeTestDebugConfiguration(test);

      // Register a DebugConfigurationProvider to combine global and
      // test-specific debug configurations before the debugging session starts
      disposables.push(
        vscode.debug.registerDebugConfigurationProvider('*', {
          resolveDebugConfiguration: (
            folder: vscode.WorkspaceFolder | undefined,
            config: vscode.DebugConfiguration,
            token?: vscode.CancellationToken
          ): vscode.ProviderResult<vscode.DebugConfiguration> => {
            return {
              ...config,
              ...debuggedTestConfig,
            };
          },
        })
      );

      // Start the debugging session. The actual debug config will combine the
      // global and test-specific values
      await vscode.debug.startDebugging(
        this.workspaceFolder,
        debugConfig || defaultConfig
      );
    } catch (e) {
      this.log.error(`Error debugging CMake test ${id}`, e.toString());
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
   * Check whether the config has default values while loading
   */
  private isDefaultConfiguration() {
    const config = this.getWorkspaceConfiguration();
    return !config.get<string>('buildDir');
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
    let str = configStr;
    varMap.forEach((value, key) => {
      while (str.indexOf(key) > -1) {
        str = str.replace(key, value);
      }
    });
    return str;
  }

  /**
   * Get variable to value substitution map for config strings
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
        const value = (await vscode.commands.executeCommand(command)) as string;
        substitutionMap.set(`\${${varname}}`, value);
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
const getFileFromEnvironment = (
  env: { [key: string]: string },
  fileVar: string
) => env[fileVar];

/**
 * Get line number from environment variables
 *
 * @param env Map of environment variables
 * @param varname Variable name to get value for
 */
const getLineFromEnvironment = (
  env: { [key: string]: string },
  varname: string
) => {
  const value = env[varname];
  // Test Explorer expects 0-indexed line numbers
  if (value) return Number.parseInt(value) - 1;
  return;
};
