/**
 * @file CMake test conroller
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { CmakeTestInfo } from './interfaces/cmake-test-info';
import {
	extractCtestPath,
	loadCmakeTests,
	// scheduleCmakeTestProcess,
	// executeCmakeTestProcess,
	// cancelCmakeTestProcess,
	// getCmakeTestDebugConfiguration,
	getCmakeTestEnvironmentVariables,
	CMAKE_CACHE_FILE,
	// CacheNotFoundError,
	// getCtestPath,
	// CmakeTestEvent,
	// CmakeTestRunOptions,
	// isCmakeWorkspace,
} from './cmake-runner';

export function createCmakeController() {
	const controller = vscode.tests.createTestController(
		'cmakeTestExplorer',
		'CMake Tests'
	);

	controller.resolveHandler = async (item?: vscode.TestItem) => {
		if (!item) {
			await loadTestsFromAllWorkspaceFolders(controller);
		} else {
			// TODO
		}
	};
	controller.refreshHandler = async () => {
		await loadTestsFromAllWorkspaceFolders(controller);
	};

	return controller;
}

function loadTestsFromAllWorkspaceFolders(controller: vscode.TestController) {
	controller.items.replace([]);
	return Promise.all(
		getWorkspaceCacheFilePatterns().map(({ workspaceFolder, pattern }) =>
			loadTestsFromCacheFilePattern(controller, workspaceFolder, pattern)
		)
	);
}

function getWorkspaceCacheFilePatterns() {
	if (!vscode.workspace.workspaceFolders) {
		return [];
	}

	return vscode.workspace.workspaceFolders.map((workspaceFolder) => ({
		workspaceFolder,
		pattern: new vscode.RelativePattern(
			workspaceFolder,
			'**/' + CMAKE_CACHE_FILE
		),
	}));
}

async function loadTestsFromCacheFilePattern(
	controller: vscode.TestController,
	workspaceFolder: vscode.WorkspaceFolder,
	pattern: vscode.RelativePattern
) {
	for (const file of await vscode.workspace.findFiles(pattern)) {
		loadTestsFromCacheFile(controller, workspaceFolder, file);
	}
}

interface TestData {
	uri: vscode.Uri;
	ctestPath: string;
}

export const testData = new WeakMap<vscode.TestItem, TestData>();

async function loadTestsFromCacheFile(
	controller: vscode.TestController,
	workspaceFolder: vscode.WorkspaceFolder,
	uri: vscode.Uri
) {
	// Get & substitute config settings
	const [
		// buildDir,
		buildConfig,
		extraCtestLoadArgs,
		suiteDelimiter,
		testFileVar,
		testLineVar,
	] = await getConfigStrings(workspaceFolder, [
		// 'buildDir',
		'buildConfig',
		'extraCtestLoadArgs',
		'suiteDelimiter',
		'testFileVar',
		'testLineVar',
	]);

	// Resolve CTest path
	const cacheFilePath = uri.fsPath;
	const dir = path.dirname(cacheFilePath);
	const ctestPath = extractCtestPath(cacheFilePath);

	// Load CTest test list
	const cmakeTests = await loadCmakeTests(
		ctestPath,
		dir,
		buildConfig,
		extraCtestLoadArgs
	);

	// Create root test item for build dir
	const rootId = uri.toString();
	const label = vscode.workspace.asRelativePath(dir, true);
	const rootItem = controller.createTestItem(rootId, label, uri);
	controller.items.add(rootItem);

	cmakeTests.forEach((test) => {
		const testId = test.name;
		let testUri;
		if (testFileVar) {
			const testFileInfo = getTestFileInfo(
				test,
				testFileVar,
				testLineVar
			);
			if (testFileInfo.file) {
				testUri = uri.with({
					path: testFileInfo.file,
					fragment: testFileInfo.line
						? 'L' + testFileInfo.line
						: undefined,
				});
			}
		}
		let parentItem = rootItem;
		let testName = test.name;
		if (suiteDelimiter) {
			const testPath = test.name.split(suiteDelimiter);
			testName = testPath[testPath.length - 1];
			for (let level = 0; level < testPath.length - 1; level++) {
				const levelName = testPath[level];
				const levelId = levelName;
				let levelItem = parentItem.children.get(levelId);
				if (!levelItem) {
					levelItem = controller.createTestItem(levelId, levelName);
					parentItem.children.add(levelItem);
				}
				parentItem = levelItem;
			}
		}
		const testItem = controller.createTestItem(testId, testName, testUri);
		parentItem.children.add(testItem);
	});
}

/**
 * Get workspace configuration object
 *
 * @param workspaceFolder Workspace folder
 */
function getWorkspaceConfiguration(workspaceFolder: vscode.WorkspaceFolder) {
	return vscode.workspace.getConfiguration(
		'cmakeExplorer',
		workspaceFolder.uri
	);
}

/**
 * Get & substitute config settings
 *
 * @param workspaceFolder Workspace folder
 * @param name Config names
 *
 * @return Config values
 */
async function getConfigStrings(
	workspaceFolder: vscode.WorkspaceFolder,
	names: string[]
) {
	const config = getWorkspaceConfiguration(workspaceFolder);
	const varMap = await getVariableSubstitutionMap(workspaceFolder);
	return names.map((name) => configGetStr(config, varMap, name));
}

/**
 * Get & substitute config settings
 *
 * @param config VS Code workspace configuration
 * @param varMap Variable to value map
 * @param key Config name
 */
function configGetStr(
	config: vscode.WorkspaceConfiguration,
	varMap: Map<string, string>,
	key: string
) {
	const configStr = config.get<string>(key) || '';
	return substituteString(configStr, varMap);
}

// /**
//  * Get & substitute config object
//  *
//  * @param workspaceFolder Workspace folder
//  * @param name Config object name
//  *
//  * @return Config object values
//  */
// async function getConfigObject(
// 	workspaceFolder: vscode.WorkspaceFolder,
// 	name: string
// ) {
// 	const config = getWorkspaceConfiguration(workspaceFolder);
// 	const varMap = await getVariableSubstitutionMap(workspaceFolder);
// 	const obj = config.get<{ [key: string]: string }>(name) || {};
// 	for (let key in obj) {
// 		obj[key] = substituteString(obj[key], varMap);
// 	}
// 	return obj;
// }

/**
 * Get variable to value substitution map for config strings
 *
 * @param workspaceFolder Workspace folder
 *
 * @note on Windows environment variable names are converted to uppercase
 */
async function getVariableSubstitutionMap(
	workspaceFolder: vscode.WorkspaceFolder
) {
	// Standard variables
	const substitutionMap = new Map<string, string>([
		['${workspaceFolder}', workspaceFolder.uri.fsPath],
	]);

	// Variables from the CMake Tools extension
	for (const varname of ['buildType', 'buildDirectory']) {
		const command = `cmake.${varname}`;
		if ((await vscode.commands.getCommands()).includes(command)) {
			const value = (await vscode.commands.executeCommand(
				command,
				workspaceFolder
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
					process.platform == 'win32'
						? varname.toUpperCase()
						: varname
				}}`,
				value
			);
		}
	}

	return substitutionMap;
}

/**
 * Get test file/line number info from CMake test info
 *
 * @param test CMake test info
 * @param testFileVar CTest environment variable for file path
 * @param testLineVar CTest environment variable for line number
 */
function getTestFileInfo(
	test: CmakeTestInfo,
	testFileVar: string,
	testLineVar: string
) {
	const env = getCmakeTestEnvironmentVariables(test);
	if (!env) return {};

	return {
		file: getFileFromEnvironment(env, testFileVar),
		line: getLineFromEnvironment(env, testLineVar),
	};
}

/**
 * Get file path from environment variables
 *
 * @param env Map of environment variables
 * @param varname Variable name to get value for
 */
function getFileFromEnvironment(env: NodeJS.ProcessEnv, fileVar: string) {
	return env[fileVar];
}

/**
 * Get line number from environment variables
 *
 * @param env Map of environment variables
 * @param varname Variable name to get value for
 */
function getLineFromEnvironment(env: NodeJS.ProcessEnv, varname: string) {
	const value = env[varname];
	if (value) return Number.parseInt(value);
	return;
}

/**
 * Substitute variables in string
 *
 * @param str String to substitute
 * @param varMap Variable to value map
 *
 * @return Substituted string
 */
function substituteString(str: string, varMap: Map<string, string>) {
	varMap.forEach((value, key) => {
		while (str.indexOf(key) > -1) {
			str = str.replace(key, value);
		}
	});
	return str;
}
