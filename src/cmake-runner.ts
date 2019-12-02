/**
 * @file CMake test discovery & execution
 */

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CmakeTestInfo } from './interfaces/cmake-test-info';
import { CmakeTestResult } from './interfaces/cmake-test-result';
import { CmakeTestProcess } from './interfaces/cmake-test-process';

/** Name of CMake cache file in build dir */
const CMAKE_CACHE_FILE = 'CMakeCache.txt';

/** Regexp for CTest path in CMake cache file */
const CTEST_RE = /^CMAKE_CTEST_COMMAND:INTERNAL=(.*)$/m;

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
 */
export function loadCmakeTests(
  ctestPath: string,
  cwd: string,
  buildConfig?: string
): Promise<CmakeTestInfo[]> {
  return new Promise<CmakeTestInfo[]>((resolve, reject) => {
    try {
      // Check that cwd directory exists
      // Note: statSync will throw an error if path doesn't exist
      if (!fs.statSync(cwd).isDirectory()) {
        throw new Error(`Directory '${cwd}' does not exist`);
      }

      // Execute the ctest command with `--show-only=json-v1` option to get the test list in JSON format
      const ctestProcess = child_process.spawn(
        ctestPath,
        [
          '--show-only=json-v1',
          ...(!!buildConfig ? ['--build-config', buildConfig] : []),
        ],
        { cwd }
      );
      if (!ctestProcess.pid) {
        // Something failed, e.g. the executable or cwd doesn't exist
        throw new Error(`Cannot spaw command '${ctestPath}'`);
      }

      // Capture result on stdout
      const out: string[] = [];
      ctestProcess.stdout.on('data', data => {
        out.push(data);
      });

      // The 'exit' event is always sent even if the child process crashes or is
      // killed so we can safely resolve/reject the promise from there
      ctestProcess.once('exit', () => {
        try {
          const data = JSON.parse(out.join(''));
          const tests: CmakeTestInfo[] = data.tests;
          resolve(tests);
        } catch {
          reject(
            new Error(
              `Error parsing test list - Make sure to use a version of CTest >= 3.14 that supports option '--show-only=json-v1'`
            )
          );
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Schedule a single CMake test
 *
 * @param ctestPath CTest command path
 * @param test Test to run
 */
export function scheduleCmakeTest(
  ctestPath: string,
  test: CmakeTestInfo
): CmakeTestProcess {
  const { name, config } = test;
  const WORKING_DIRECTORY = test.properties.find(
    p => p.name === 'WORKING_DIRECTORY'
  );
  const cwd = WORKING_DIRECTORY ? WORKING_DIRECTORY.value : undefined;
  const testProcess = child_process.spawn(
    ctestPath,
    [
      '-R',
      `^${name}$`,
      '--output-on-failure',
      ...(!!config ? ['-C', config] : []),
    ],
    { cwd }
  );
  if (!testProcess.pid) {
    // Something failed, e.g. the executable or cwd doesn't exist
    throw new Error(`Cannot run test ${name}`);
  }

  return testProcess;
}

/**
 * Execute a previously scheduled CMake test
 *
 * @param testProcess Scheduled test process
 */
export function executeCmakeTest(
  testProcess: CmakeTestProcess
): Promise<CmakeTestResult> {
  return new Promise<CmakeTestResult>((resolve, reject) => {
    try {
      // Capture result on stdout
      const out: string[] = [];
      testProcess.stdout.on('data', data => {
        out.push(data);
      });

      // The 'exit' event is always sent even if the child process crashes or is
      // killed so we can safely resolve/reject the promise from there
      testProcess.once('exit', code => {
        const result: CmakeTestResult = {
          code,
          out: out.length ? out.join('') : undefined,
        };
        resolve(result);
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Cancel a previously scheduled CMake test
 *
 * @param testProcess Scheduled test process
 */
export function cancelCmakeTest(testProcess: CmakeTestProcess) {
  testProcess.kill();
}

/**
 * Run a single CMake test
 *
 * @param ctestPath CTest command path
 * @param test Test to run
 */
export function runCmakeTest(
  ctestPath: string,
  test: CmakeTestInfo
): Promise<CmakeTestResult> {
  const testProcess = scheduleCmakeTest(ctestPath, test);
  return executeCmakeTest(testProcess);
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
  const match = fs
    .readFileSync(cacheFilePath)
    .toString()
    .match(CTEST_RE);
  if (!match) {
    throw new Error(
      `CTest path not found in CMake cache file ${cacheFilePath}`
    );
  }

  return match[1];
}
