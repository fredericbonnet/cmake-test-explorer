/**
 * @file Extension entry point
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as md from 'markdown-it';
import { createCmakeController } from './cmake-controller';

/**
 * Main extension entry point
 */
export async function activate(context: vscode.ExtensionContext) {
	const controller = createCmakeController();
	context.subscriptions.push(controller);
	showWhatsNew(context);
}

function showWhatsNew(context: vscode.ExtensionContext) {
	if (context.extensionMode == vscode.ExtensionMode.Development) {
		// Clear for local development
		context.globalState.update('lastVersion', undefined);
	}

	const currentVersion = context.extension.packageJSON.version;
	const lastVersion = context.globalState.get('lastVersion');
	if (lastVersion === currentVersion) return;

	context.globalState.update('lastVersion', currentVersion);
	const readmePath = path.join(context.extensionPath, 'README.md');
	const markdown = fs.readFileSync(readmePath, 'utf-8');
	const html = md().render(markdown);
	const title = `What's New in CMake Test Explorer ${currentVersion}`;

	const panel = vscode.window.createWebviewPanel(
		'whatsNew',
		title,
		vscode.ViewColumn.One
	);
	panel.webview.html = getWebviewContent(title, html);
}

const getWebviewContent = (title: string, content: string): string => `
	<!DOCTYPE html>
	<html>
	<head>
		<meta charset="UTF-8">
		<title>${title}</title>
		<style>
			body {
				font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif);
				margin: 2rem auto;
				max-width: 800px;
				background: var(--vscode-editor-background, #1e1e1e);
				color: var(--vscode-editor-foreground, #d4d4d4);
				line-height: 1.6;
			}
			h1, h2, h3, h4, h5, h6 {
				color: var(--vscode-foreground, #569cd6);
				margin-top: 2em;
				margin-bottom: 1em;
			}
			a {
				color: var(--vscode-textLink-foreground, #4fc1ff);
				text-decoration: none;
			}
			a:hover {
				text-decoration: underline;
			}
			pre, code {
				background: var(--vscode-editorWidget-background, #252526);
				color: var(--vscode-editorWidget-foreground, #dcdcaa);
				border-radius: 4px;
				font-family: var(--vscode-editor-font-family, 'Fira Mono', 'Consolas', 'Monaco', monospace);
			}
			pre {
				padding: 1em;
				overflow-x: auto;
			}
			code {
				padding: 0.2em 0.4em;
			}
			ul, ol {
				margin-left: 2em;
			}
			blockquote {
				border-left: 4px solid var(--vscode-textBlockQuote-border, #007acc);
				margin: 1em 0;
				padding: 0.5em 1em;
				color: var(--vscode-textBlockQuote-foreground, #9cdcfe);
				background: var(--vscode-textBlockQuote-background, #23272e);
			}
			table {
				border-collapse: collapse;
				width: 100%;
				margin: 1em 0;
			}
			th, td {
				border: 1px solid var(--vscode-editorWidget-border, #333);
				padding: 0.5em 1em;
			}
			th {
				background: var(--vscode-editorWidget-background, #222);
			}
		</style>
	</head>
	<body>
		${content}
	</body>
	</html>
	`;
