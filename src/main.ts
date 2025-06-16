/**
 * @file Extension entry point
 */

import * as vscode from 'vscode';
import { createCmakeController } from './cmake-controller';

/**
 * Main extension entry point
 */
export async function activate(context: vscode.ExtensionContext) {
	const controller = createCmakeController();
	context.subscriptions.push(controller);
}
