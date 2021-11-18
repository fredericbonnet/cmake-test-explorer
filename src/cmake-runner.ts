/**
 * @file CMake test discovery & execution
 */

import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as split2 from 'split2';
import { CmakeTestInfo } from './interfaces/cmake-test-info';
import { CmakeTestResult } from './interfaces/cmake-test-result';
import { CmakeTestProcess } from './interfaces/cmake-test-process';

const { split } = require('split-cmd');

/** Name of CMake cache file in build dir */
const CMAKE_CACHE_FILE = 'CMakeCache.txt';

/** Regexp for CTest path in CMake cache file */
const CTEST_RE = /^CMAKE_CTEST_COMMAND:INTERNAL=(.*)$/m;

/** Regexp for test start line */
const CTEST_START_RE = /^\s+Start\s+(\d+): (\S+)/;

/** Regexp for test output line */
const CTEST_OUTPUT_RE = /^(\d+): .*$/;

/** Regexp for test passed line */
const CTEST_PASSED_RE = /^\s*\d+\/\d+ Test\s+#(\d+): (\S+).*\.\.\.+   Passed/;

/** Regexp for test failed line */
const CTEST_FAILED_RE =
  /^\s*\d+\/\d+ Test\s+#(\d+): (\S+).*\.\.\.+\*\*\*Failed/;

/** Generic test event */
export type CmakeTestEvent =
  | CmakeTestStartEvent
  | CmakeTestOutputEvent
  | CmakeTestEndEvent;

/** Test start event */
export interface CmakeTestStartEvent {
  type: 'start';
  index: number;
  name: string;
}

/** Test output event */
export interface CmakeTestOutputEvent {
  type: 'output';
  index: number;
  line: string;
}

/** Test end event */
export interface CmakeTestEndEvent {
  type: 'end';
  index: number;
  name: string;
  success: boolean;
}

/** Error thrown when CMake cache file is not found in build dir */
export class CacheNotFoundError extends Error {
  /** @see https://github.com/microsoft/TypeScript-wiki/blob/master/Breaking-Changes.md#extending-built-ins-like-error-array-and-map-may-no-longer-work */
  constructor(m: string) {
    super(m);

    // Set the prototype explicitly.
    Object.setPrototypeOf(this, CacheNotFoundError.prototype);
  }
}

/**
 * Load CMake test list
 *
 * @param ctestPath CTest command path
 * @param cwd CMake build directory to run the command within
 * @param buildConfig Build configuration (may be empty)
 * @param extraArgs Extra arguments passed to CTest
 */
export function loadCmakeTests(
  ctestPath: string,
  cwd: string,
  buildConfig?: string,
  extraArgs: string = ''
): Promise<CmakeTestInfo[]> {
  return new Promise<CmakeTestInfo[]>((resolve, reject) => {
    try {
      // Check that cwd directory exists
      // Note: statSync will throw an error if path doesn't exist
      if (!fs.statSync(cwd).isDirectory()) {
        throw new Error(`Directory '${cwd}' does not exist`);
      }

      // Split args string into array for spawn
      const args = split(extraArgs);

      // Execute the ctest command with `--show-only=json-v1` option to get the test list in JSON format
      const ctestProcess = child_process.spawn(
        ctestPath,
        [
          '--show-only=json-v1',
          ...(!!buildConfig ? ['--build-config', buildConfig] : []),
          ...args,
        ],
        { cwd }
      );
      if (!ctestProcess.pid) {
        // Something failed, e.g. the executable or cwd doesn't exist
        throw new Error(`Cannot spawn command '${ctestPath}'`);
      }

      // Capture result on stdout
      const out: string[] = [];
      ctestProcess.stdout
        .on('data', (data) => out.push(data))
        .on('end', () => {
          try {
            const data = JSON.parse(out.join(''));
            const tests: CmakeTestInfo[] = data.tests;
            resolve(tests as CmakeTestInfo[]);
          } catch (e) {
            reject(
              new Error(
                `Error parsing test list - Make sure to use a version of CTest >= 3.14 that supports option '--show-only=json-v1'`
              )
            );
          }
        })
        .on('error', (error: Error) => reject(error));
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Cmake test run options
 */
export type CmakeTestRunOptions = {
  /** CTest command path */
  ctestPath: string;

  /** CMake build directory to run the command within */
  cwd: string;

  /** Environment */
  env: NodeJS.ProcessEnv;

  /** Number of jobs to run in parallel */
  parallelJobs: number;

  /** Build configuration (may be empty) */
  buildConfig: string;

  /** Extra arguments passed to CTest */
  extraArgs: string;
};

/**
 * Schedule a CMake test process
 *
 * @param testIndexes Test indexes to run (empty for all)
 * @param options Run options
 */
export function scheduleCmakeTestProcess(
  testIndexes: number[],
  {
    ctestPath,
    cwd,
    env,
    parallelJobs,
    buildConfig,
    extraArgs,
  }: CmakeTestRunOptions
): CmakeTestProcess {
  // Build options
  const testList = testIndexes.length
    ? ['-I', `0,0,0,${testIndexes.join(',')}`]
    : [];
  const jobs = parallelJobs > 1 ? ['-j', parallelJobs] : [];

  // Split args string into array for spawn
  const args = split(extraArgs);

  const testProcess = child_process.spawn(
    ctestPath,

    [
      ...(!!buildConfig ? ['--build-config', buildConfig] : []),
      '-V',
      ...jobs,
      ...testList,
      ...args,
    ],
    { cwd, env }
  );
  if (!testProcess.pid) {
    // Something failed, e.g. the executable or cwd doesn't exist
    throw new Error(`Cannot run tests`);
  }

  return testProcess;
}

/**
 * Execute a previously scheduled CMake test process
 *
 * @param testProcess Scheduled test process
 * @param onEvent Event callback
 */
export function executeCmakeTestProcess(
  testProcess: CmakeTestProcess,
  onEvent: (event: CmakeTestEvent) => void
): Promise<CmakeTestResult> {
  return new Promise<CmakeTestResult>((resolve, reject) => {
    try {
      // Capture result on stdout
      testProcess.stdout
        .pipe(split2())
        .on('data', (line: string) => {
          // Parse each output line and raise matching events
          let matches;
          if ((matches = line.match(CTEST_START_RE))) {
            // Test start
            const index = Number.parseInt(matches[1]);
            const name = matches[2];
            onEvent({ type: 'start', index, name });
            onEvent({ type: 'output', index, line });
          } else if ((matches = line.match(CTEST_OUTPUT_RE))) {
            // Test output
            const index = Number.parseInt(matches[1]);
            onEvent({ type: 'output', index, line });
          } else if ((matches = line.match(CTEST_PASSED_RE))) {
            // Test passed
            const index = Number.parseInt(matches[1]);
            const name = matches[2];
            onEvent({ type: 'output', index, line });
            onEvent({ type: 'end', index, name, success: true });
          } else if ((matches = line.match(CTEST_FAILED_RE))) {
            // Test failed
            const index = Number.parseInt(matches[1]);
            const name = matches[2];
            onEvent({ type: 'output', index, line });
            onEvent({ type: 'end', index, name, success: false });
          }
        })
        .on('end', () => {
          // All done
          resolve({ code: testProcess.exitCode });
        });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Cancel a previously scheduled CMake test process
 *
 * @param testProcess Scheduled test process
 */
export function cancelCmakeTestProcess(testProcess: CmakeTestProcess) {
  testProcess.kill();
}

/**
 * Get debug configuration for a single CMake test
 *
 * @param test Test to debug
 */
export function getCmakeTestDebugConfiguration(
  test: CmakeTestInfo
): Partial<vscode.DebugConfiguration> {
  const [command, ...args] = test.command;
  const WORKING_DIRECTORY = test.properties.find(
    (p) => p.name === 'WORKING_DIRECTORY'
  );
  const cwd = WORKING_DIRECTORY ? WORKING_DIRECTORY.value : undefined;
  const env = getCmakeTestEnvironmentVariables(test);
  return {
    name: `CTest ${test.name}`,
    program: command,
    args,
    cwd,
    env,
  };
}

/**
 * Get CTest command path from CMakeCache.txt
 *
 * @param cwd CMake build directory to run the command within
 */
export function getCtestPath(cwd: string) {
  // Check that CMakeCache.txt file exists in cwd
  const cacheFilePath = path.join(cwd, CMAKE_CACHE_FILE);
  if (!fs.existsSync(cacheFilePath)) {
    throw new CacheNotFoundError(
      `CMake cache file ${cacheFilePath} does not exist`
    );
  }

  // Extract CTest path from cache file.
  const match = fs.readFileSync(cacheFilePath).toString().match(CTEST_RE);
  if (!match) {
    throw new Error(
      `CTest path not found in CMake cache file ${cacheFilePath}`
    );
  }

  return match[1];
}
/**
 * Get environment variables defined for a CMake test
 *
 * @param test CMake test info
 */
export function getCmakeTestEnvironmentVariables(
  test: CmakeTestInfo
): NodeJS.ProcessEnv | undefined {
  const ENVIRONMENT = test.properties.find((p) => p.name === 'ENVIRONMENT');
  if (!ENVIRONMENT) return;

  const value = ENVIRONMENT.value as string[];
  return value.reduce((acc, v) => {
    const m = v.match(/^(.*)=(.*)$/);
    if (m) {
      acc[m[1]] = m[2];
    }
    return acc;
  }, {} as { [key: string]: string });
}
