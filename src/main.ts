/**
 * @file Extension entry point
 */

import * as vscode from 'vscode';
import { createCmakeController } from './cmake-controller';

/**
 * Main extension entry point
 *
 * Code is from the vscode-example-test-adapter extension template
 */
export async function activate(context: vscode.ExtensionContext) {
	const controller = createCmakeController();
	context.subscriptions.push(controller);
}

export function deactivate() {}
