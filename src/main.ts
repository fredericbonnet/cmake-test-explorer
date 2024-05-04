/**
 * @file Extension entry point
 */

import * as vscode from 'vscode';
import { TestHub, testExplorerExtensionId } from 'vscode-test-adapter-api';
import { Log, TestAdapterRegistrar } from 'vscode-test-adapter-util';
import { CmakeAdapter, isCmakeWorkspace } from './cmake-adapter';

/**
 * Main extension entry point
 *
 * Code is from the vscode-example-test-adapter extension template
 */
export async function activate(context: vscode.ExtensionContext) {
  const workspaceFolder = (vscode.workspace.workspaceFolders || [])[0];

  // create a simple logger that can be configured with the configuration variables
  // `cmakeExplorer.logpanel` and `cmakeExplorer.logfile`
  const log = new Log('cmakeExplorer', workspaceFolder, 'CMake Explorer Log');
  context.subscriptions.push(log);

  const config = vscode.workspace.getConfiguration(
    'cmakeExplorer',
    workspaceFolder.uri
  );

  // Note: config.get() returns 'true' instead of true with default settings
  const cmakeIntegration = config.get('cmakeIntegration');
  if (cmakeIntegration === 'true' || cmakeIntegration === true) {
    // Check for CMake Tools extension
    let cmakeExtension = vscode.extensions.getExtension(
      'ms-vscode.cmake-tools'
    );
    if (!cmakeExtension) {
      const message = `CMake integration is enabled but the CMake Tools extension is not installed`;
      log.warn(message);
    } else if (!cmakeExtension.isActive) {
      log.warn(
        `CMake integration is enabled but the CMake Tools extension is not active`
      );
      if (await isCmakeWorkspace()) {
        // Only activate extension if the workspace contains CMake project files
        log.info(
          `Workspace contains CMake project files, waiting for CMake Tools extension to activate`
        );
        await cmakeExtension.activate();
      }
    }
  }

  // get the Test Explorer extension
  const testExplorerExtension = vscode.extensions.getExtension<TestHub>(
    testExplorerExtensionId
  );
  if (log.enabled)
    log.warn(`Test Explorer ${testExplorerExtension ? '' : 'not '}found`);

  if (testExplorerExtension) {
    const testHub = testExplorerExtension.exports;

    // this will register a CmakeAdapter for each WorkspaceFolder
    context.subscriptions.push(
      new TestAdapterRegistrar(
        testHub,
        (workspaceFolder) => new CmakeAdapter(workspaceFolder, log),
        log
      )
    );
  }
}

export function deactivate() {}
