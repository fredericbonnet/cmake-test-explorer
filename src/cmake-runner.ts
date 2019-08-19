/**
 * @file CMake test discovery & execution
 */

import * as child_process from 'child_process';
import { CmakeTestInfo } from './interfaces/cmake-test-info';
import { CmakeTestResult } from './interfaces/cmake-test-result';

/**
 * Load CMake test list
 *
 * @param cwd CMake build directory to run the command within
 */
export function loadCmakeTests(cwd: string): Promise<CmakeTestInfo[]> {
  return new Promise<CmakeTestInfo[]>((resolve, reject) => {
    try {
      // Execute the `ctest --show-only=json-v1` command to get the test list in JSON format
      const ctestProcess = child_process.spawn(
        'ctest',
        ['--show-only=json-v1'],
        { cwd }
      );
      if (!ctestProcess.pid) {
        // Something failed, e.g. the executable or cwd doesn't exist
        throw new Error(`Cannot spaw command 'ctest'`);
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
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Run a single CMake test
 *
 * @param test Test to run
 */
export function runCmakeTest(test: CmakeTestInfo): Promise<CmakeTestResult> {
  return new Promise<CmakeTestResult>((resolve, reject) => {
    try {
      const [command, ...args] = test.command;
      const WORKING_DIRECTORY = test.properties.find(
        p => p.name === 'WORKING_DIRECTORY'
      );
      const cwd = WORKING_DIRECTORY ? WORKING_DIRECTORY.value : undefined;
      const testProcess = child_process.spawn(command, args, { cwd });
      if (!testProcess.pid) {
        // Something failed, e.g. the executable or cwd doesn't exist
        throw new Error(`Cannot spawn test command ${command}`);
      }

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
