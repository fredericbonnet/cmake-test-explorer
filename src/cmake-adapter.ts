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
import { CmakeTestResult } from './interfaces/cmake-test-result';
import { CmakeTestProcess } from './interfaces/cmake-test-process';
import {
  loadCmakeTests,
  scheduleCmakeTest,
  executeCmakeTest,
  cancelCmakeTest,
  getCmakeTestDebugConfiguration,
  CacheNotFoundError,
  getCtestPath,
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

  /** Currently running tests */
  private currentTestProcessList: {
    [id: string]: CmakeTestProcess;
  } = {};

  /** Currently running tests */
  private runningTests: Set<Promise<void>> = new Set();

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
        await this.runTests(this.cmakeTests.map((test) => test.name));
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

    for (const proc of Object.values(this.currentTestProcessList)) {
      cancelCmakeTest(proc);
    }

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
      ] = await this.getConfigStrings([
        'buildDir',
        'buildConfig',
        'extraCtestLoadArgs',
        'suiteDelimiter',
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

      // Convert to Text Explorer format
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
   * @param ids Test IDs
   */
  private async runTests(ids: string[]) {
    const [suiteDelimiter] = await this.getConfigStrings(['suiteDelimiter']);
    let parallelJobs = this.getParallelJobs();
    const allTests = this.cmakeTests.map((test) => test.name);
    for (const id of ids) {
      // Include all suite tests if given a suite ID
      const tests =
        suiteDelimiter && id.endsWith(suiteDelimiter + SUITE_SUFFIX)
          ? allTests.filter((test) =>
              test.startsWith(id.substr(0, id.length - SUITE_SUFFIX.length))
            )
          : [id];
      for (const test of tests) {
        const run = this.runTest(test).finally(() =>
          this.runningTests.delete(run)
        );
        this.runningTests.add(run);
        while (this.runningTests.size >= parallelJobs) {
          await Promise.race(this.runningTests);
        }
      }
    }
    await Promise.all(this.runningTests);
  }

  /**
   * Run a single test
   *
   * @param id Test ID
   */
  private async runTest(id: string) {
    if (this.state === 'cancelled') {
      // Test run cancelled, retire test
      this.retireEmitter.fire(<RetireEvent>{ tests: [id] });
      return;
    }

    const test = this.cmakeTests.find((test) => test.name === id);
    if (!test) {
      // Not found, mark test as skipped.
      this.testStatesEmitter.fire(<TestEvent>{
        type: 'test',
        test: id,
        state: 'skipped',
      });
      return;
    }

    // Run test
    this.testStatesEmitter.fire(<TestEvent>{
      type: 'test',
      test: id,
      state: 'running',
    });
    try {
      // Get & substitute config settings
      const [buildDir, extraCtestRunArgs] = await this.getConfigStrings([
        'buildDir',
        'extraCtestRunArgs',
      ]);

      // Schedule & execute test
      const cwd = path.resolve(this.workspaceFolder.uri.fsPath, buildDir);
      this.currentTestProcessList[id] = scheduleCmakeTest(
        this.ctestPath,
        cwd,
        test,
        extraCtestRunArgs
      );
      const result: CmakeTestResult = await executeCmakeTest(
        this.currentTestProcessList[id]
      );
      this.testStatesEmitter.fire(<TestEvent>{
        type: 'test',
        test: id,
        state: result.code ? 'failed' : 'passed',
        message: result.out,
      });
    } catch (e) {
      this.testStatesEmitter.fire(<TestEvent>{
        type: 'test',
        test: id,
        state: 'errored',
        message: e.toString(),
      });
    } finally {
      delete this.currentTestProcessList[id];
    }
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
