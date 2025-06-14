/**
 * @file CMake test controller
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { CmakeTestInfo } from './interfaces/cmake-test-info';
import {
	extractCtestPath,
	loadCmakeTests,
	scheduleCmakeTestProcess,
	executeCmakeTestProcess,
	cancelCmakeTestProcess,
	getCmakeTestDebugConfiguration,
	getCmakeTestEnvironmentVariables,
	CMAKE_CACHE_FILE,
	CmakeTestRunOptions,
	CmakeTestEvent,
} from './cmake-runner';

/**
 * Create CMake test controller
 */
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
	controller.createRunProfile(
		'Run',
		vscode.TestRunProfileKind.Run,
		async (request, token) => {
			await runTests(controller, request, token);
		}
	);
	controller.createRunProfile(
		'Debug',
		vscode.TestRunProfileKind.Debug,
		async (request, token) => {
			await debugTests(controller, request, token);
		}
	);

	return controller;
}

/**
 * Load tests from all workspace folders
 *
 * @param controller Test controller
 */
function loadTestsFromAllWorkspaceFolders(controller: vscode.TestController) {
	controller.items.replace([]);
	return Promise.all(
		getWorkspaceCacheFilePatterns().map(({ workspaceFolder, pattern }) =>
			loadTestsFromCacheFilePattern(controller, workspaceFolder, pattern)
		)
	);
}

/**
 * Get workspace cache file patterns
 */
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

/**
 * Load tests from cache file pattern
 *
 * @param controller Test controller
 * @param workspaceFolder Workspace folder
 * @param pattern Cache file pattern
 */
async function loadTestsFromCacheFilePattern(
	controller: vscode.TestController,
	workspaceFolder: vscode.WorkspaceFolder,
	pattern: vscode.RelativePattern
) {
	for (const file of await vscode.workspace.findFiles(pattern)) {
		loadTestsFromCacheFile(controller, workspaceFolder, file);
	}
}

/**
 * Load tests from cache file
 *
 * @param controller Test controller
 * @param workspaceFolder Workspace folder
 * @param uri Cache file URI
 */
async function loadTestsFromCacheFile(
	controller: vscode.TestController,
	workspaceFolder: vscode.WorkspaceFolder,
	uri: vscode.Uri
) {
	// Get & substitute config settings
	const [
		buildConfig,
		extraCtestLoadArgs,
		suiteDelimiter,
		testFileVar,
		testLineVar,
	] = await getConfigStrings(workspaceFolder, [
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
 * Run tests
 *
 * @param controller Test controller
 * @param request Test run request
 * @param token Cancellation token
 */
async function runTests(
	controller: vscode.TestController,
	request: vscode.TestRunRequest,
	token: vscode.CancellationToken
) {
	// Create a test run to record results
	const run = controller.createTestRun(request);
	try {
		if (!request.include) {
			// Run all tests - collect all root items (one per CMakeCache.txt)
			for (const [_, rootItem] of controller.items) {
				await runTestsForRoot(run, rootItem, token);
			}
		} else {
			// Collect test items grouped by root
			const itemsByRoot = collectTestItemsByRoot(request.include);

			// Run each group
			for (const [root, tests] of itemsByRoot) {
				await runTestsForRoot(run, root, token, tests);
			}
		}
	} finally {
		run.end();
	}
}

/**
 * Run tests for root item
 *
 * @param run Test run
 * @param root Root test item
 * @param token Cancellation token
 * @param testsToRun Optional list of tests to run
 */
async function runTestsForRoot(
	run: vscode.TestRun,
	root: vscode.TestItem,
	token: vscode.CancellationToken,
	testsToRun?: vscode.TestItem[]
) {
	if (!root.uri) return; // Should never happen

	try {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(root.uri);
		if (!workspaceFolder) return;
		// Get options including CTest path, config, env vars, etc.
		const cwd = path.dirname(root.uri.fsPath);
		const ctestPath = extractCtestPath(root.uri.fsPath);
		const options = await getRunOptions(ctestPath, workspaceFolder, cwd);

		// Get error pattern from settings
		const [errorPattern] = await getConfigStrings(workspaceFolder, [
			'errorPattern',
		]);
		const errorPatternRe = new RegExp(errorPattern);

		// Map test items to their indexes
		const allTests = await loadCmakeTests(
			ctestPath,
			cwd,
			options.buildConfig,
			''
		);
		const indexToItem = new Map<number, vscode.TestItem>();
		const testIndexes = (testsToRun || collectTestItems(root)).map(
			(test) => {
				const index = allTests.findIndex((t) => t.name === test.id) + 1;
				if (index > 0) {
					indexToItem.set(index, test);
				}
				return index;
			}
		);

		// Schedule and run tests
		const testProcess = scheduleCmakeTestProcess(testIndexes, options);

		// Handle cancellation
		token.onCancellationRequested(() => {
			cancelCmakeTestProcess(testProcess);
		});

		// Run tests and collect output
		const decorations = new Map<number, vscode.TestMessage[]>();

		await executeCmakeTestProcess(testProcess, (event: CmakeTestEvent) => {
			const testItem = indexToItem.get(event.index);
			if (!testItem) return;
			switch (event.type) {
				case 'start': {
					run.started(testItem);
					break;
				}

				case 'output': {
					run.appendOutput(event.line + '\r\n', undefined, testItem);

					// Parse error patterns
					if (event.text) {
						const matches =
							event.text.match(errorPatternRe)?.groups;
						if (matches) {
							const { file, line, severity, message } = matches;

							if (!decorations.has(event.index)) {
								decorations.set(event.index, []);
							}

							const decoration = new vscode.TestMessage(
								severity ? `${severity}: ${message}` : message
							);
							decoration.location = new vscode.Location(
								vscode.Uri.file(file),
								new vscode.Position(
									Number.parseInt(line) - 1,
									0
								)
							);
							decorations.get(event.index)?.push(decoration);
						}
					}
					break;
				}

				case 'end': {
					const testDecorations = decorations.get(event.index) || [];

					// Update test state
					switch (event.state) {
						case 'passed':
							run.passed(testItem, event.duration);
							break;
						case 'failed':
							if (testDecorations.length > 0) {
								run.failed(
									testItem,
									testDecorations,
									event.duration
								);
							} else {
								run.failed(
									testItem,
									new vscode.TestMessage('Test failed')
								);
							}
							break;
						case 'skipped':
							run.skipped(testItem);
							break;
					}
					break;
				}
			}
		});
	} catch (e) {
		// Mark all tests as errored
		const errorMessage = new vscode.TestMessage(`${e}`);
		if (testsToRun) {
			for (const test of testsToRun) {
				run.errored(test, [errorMessage]);
			}
		} else {
			const allTests = collectTestItems(root);
			for (const test of allTests) {
				run.errored(test, [errorMessage]);
			}
		}
	}
}

/**
 * Collect test items grouped by root
 *
 * @param include Test items to include with their children
 *
 * @return Leaf test items grouped by root
 */
function collectTestItemsByRoot(include: readonly vscode.TestItem[]) {
	const itemsByRoot = new Map<vscode.TestItem, vscode.TestItem[]>();
	for (const item of include) {
		// Get root by traversing up the tree
		let root = item;
		while (root.parent) {
			root = root.parent;
		}

		// Get all leaf test items under this item
		const leafTests = collectTestItems(item);

		// Add tests to the root's collection
		let tests = itemsByRoot.get(root) || [];
		tests.push(...leafTests);
		itemsByRoot.set(root, tests);
	}
	return itemsByRoot;
}

/**
 * Collect test items under an item
 *
 * @param item Test item
 *
 * @return List of leaf test items
 */
function collectTestItems(item: vscode.TestItem): vscode.TestItem[] {
	if (item.children.size == 0) {
		return [item];
	}
	const results: vscode.TestItem[] = [];
	item.children.forEach((child) => {
		if (child.children.size === 0) {
			// Leaf = test
			results.push(child);
		} else {
			// Non-leaf = suite
			results.push(...collectTestItems(child));
		}
	});
	return results;
}

/**
 * Get test run options
 *
 * @param ctestPath The path to the CTest executable
 * @param workspaceFolder The workspace folder containing the tests
 * @param cwd The working directory for CTest
 *
 * @return Run options
 */
async function getRunOptions(
	ctestPath: string,
	workspaceFolder: vscode.WorkspaceFolder,
	cwd: string
): Promise<CmakeTestRunOptions> {
	// Get & substitute config settings
	const [buildConfig, extraCtestRunArgs] = await getConfigStrings(
		workspaceFolder,
		['buildConfig', 'extraCtestRunArgs']
	);
	const extraCtestEnvVars = await getConfigObject(
		workspaceFolder,
		'extraCtestEnvVars'
	);
	const parallelJobs = getParallelJobs(workspaceFolder);

	return {
		ctestPath,
		cwd,
		env: mergeVariablesIntoProcessEnv(extraCtestEnvVars),
		parallelJobs,
		buildConfig,
		extraArgs: extraCtestRunArgs,
	};
}

/**
 * Debug tests
 *
 * @param controller Test controller
 * @param request Test run request
 * @param token Cancellation token
 */
async function debugTests(
	controller: vscode.TestController,
	request: vscode.TestRunRequest,
	token: vscode.CancellationToken
) {
	if (!request.include?.length) return;

	try {
		// Collect test items grouped by root
		const itemsByRoot = collectTestItemsByRoot(request.include);

		// Debug each group
		for (const [root, tests] of itemsByRoot) {
			await debugTestsForRoot(root, token, tests);
		}
	} catch (e) {
		await vscode.window.showErrorMessage(
			`Error debugging CMake tests: ${e}`
		);
	}
}

/**
 * Debug tests for root item
 *
 * @param root Root test item
 * @param token Cancellation token
 * @param testsToRun List of tests to debug
 */
async function debugTestsForRoot(
	root: vscode.TestItem,
	token: vscode.CancellationToken,
	testsToRun: vscode.TestItem[]
) {
	if (!root.uri) return; // Should never happen

	const workspaceFolder = vscode.workspace.getWorkspaceFolder(root.uri);
	if (!workspaceFolder) return;

	// Get CTest path and load tests
	const cwd = path.dirname(root.uri.fsPath);
	const ctestPath = extractCtestPath(root.uri.fsPath);
	const [buildConfig] = await getConfigStrings(workspaceFolder, [
		'buildConfig',
	]);
	const cmakeTests = await loadCmakeTests(ctestPath, cwd, buildConfig, '');

	// Debug each test in the group
	for (const item of testsToRun) {
		if (token.isCancellationRequested) return;
		await debugTest(workspaceFolder, cmakeTests, ctestPath, item.id);
	}
}

/**
 * Debug a single test
 *
 * @param workspaceFolder Workspace folder containing the test
 * @param cmakeTests List of available CMake tests
 * @param ctestPath Path to CTest executable
 * @param id Test ID to debug
 */
async function debugTest(
	workspaceFolder: vscode.WorkspaceFolder,
	cmakeTests: CmakeTestInfo[],
	ctestPath: string,
	id: string
) {
	const test = cmakeTests.find((test) => test.name === id);
	if (!test) {
		// Not found.
		return;
	}

	// Debug test
	const disposables: vscode.Disposable[] = [];
	try {
		// Get & substitute config settings
		const extraCtestEnvVars = await getConfigObject(
			workspaceFolder,
			'extraCtestEnvVars'
		);
		const [debugConfig] = await getConfigStrings(workspaceFolder, [
			'debugConfig',
		]);
		const defaultConfig = getDefaultDebugConfiguration();

		// Get test-specific debug config
		const { env, ...debuggedTestConfig } =
			getCmakeTestDebugConfiguration(test);

		// Utilities to merge configs and environment variables
		const mergeEnvironments = (environment: DebugEnvironment) =>
			mergeVariablesIntoDebugEnv(
				mergeVariablesIntoDebugEnv(environment, extraCtestEnvVars),
				env
			);
		const mergeConfigs = ({
			environment = [],
			...config
		}: vscode.DebugConfiguration) => ({
			...config,
			...debuggedTestConfig,
			environment: mergeEnvironments(environment),
		});
		const mergeLldbConfigs = (config: vscode.DebugConfiguration) => ({
			...config,
			...debuggedTestConfig,
			env: { ...config.env, ...extraCtestEnvVars, ...env },
		});

		// Register a DebugConfigurationProvider to combine global and
		// test-specific debug configurations before the debugging session starts
		disposables.push(
			vscode.debug.registerDebugConfigurationProvider('*', {
				resolveDebugConfigurationWithSubstitutedVariables: (
					folder: vscode.WorkspaceFolder | undefined,
					config: vscode.DebugConfiguration,
					token?: vscode.CancellationToken
				): vscode.ProviderResult<vscode.DebugConfiguration> =>
					config.type === 'lldb'
						? mergeLldbConfigs(config)
						: mergeConfigs(config),
			})
		);

		// Start the debugging session. The actual debug config will combine the
		// global and test-specific values
		await vscode.debug.startDebugging(
			workspaceFolder,
			debugConfig || defaultConfig
		);
	} catch (e) {
		await vscode.window.showErrorMessage(
			`Error debugging CMake test ${id}: ${e}`
		);
	} finally {
		disposables.forEach((disposable) => disposable.dispose());
	}
}

/**
 * Get default debug config when none is specified in the settings
 */
function getDefaultDebugConfiguration(): vscode.DebugConfiguration {
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
 * @param names Config names
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

/**
 * Get & substitute config object
 *
 * @param workspaceFolder Workspace folder
 * @param name Config object name
 *
 * @return Config object values
 */
async function getConfigObject(
	workspaceFolder: vscode.WorkspaceFolder,
	name: string
) {
	const config = getWorkspaceConfiguration(workspaceFolder);
	const varMap = await getVariableSubstitutionMap(workspaceFolder);
	const obj = config.get<{ [key: string]: string }>(name) || {};
	for (let key in obj) {
		obj[key] = substituteString(obj[key], varMap);
	}
	return obj;
}

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

	// Variables from the CMake Tools extension if enabled
	const config = getWorkspaceConfiguration(workspaceFolder);
	const cmakeIntegration = config.get('cmakeIntegration');
	if (cmakeIntegration === 'true' || cmakeIntegration === true) {
		const cmakeExtension = vscode.extensions.getExtension(
			'ms-vscode.cmake-tools'
		);
		if (cmakeExtension) {
			if (!cmakeExtension.isActive) await cmakeExtension.activate();
			for (const varname of ['buildType', 'buildDirectory']) {
				const command = `cmake.${varname}`;
				if ((await vscode.commands.getCommands()).includes(command)) {
					const value = (await vscode.commands.executeCommand(
						command,
						workspaceFolder
					)) as string;
					substitutionMap.set(`\${${varname}}`, value);
				} else {
					substitutionMap.set(`\${${varname}}`, '');
				}
			}
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
 * Get number of jobs to run in parallel
 *
 * @param workspaceFolder Workspace folder
 */
function getParallelJobs(workspaceFolder: vscode.WorkspaceFolder) {
	const config = getWorkspaceConfiguration(workspaceFolder);
	let parallelJobs = config.get<number>('parallelJobs');
	if (!parallelJobs) {
		const cmakeConfig = vscode.workspace.getConfiguration(
			'cmake',
			workspaceFolder.uri
		);
		parallelJobs =
			cmakeConfig.get<number>('ctest.parallelJobs') ||
			cmakeConfig.get<number>('parallelJobs') ||
			os.cpus().length;
	}
	if (parallelJobs < 1) parallelJobs = 1;
	return parallelJobs;
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
function getFileFromEnvironment(env: NodeJS.ProcessEnv, varname: string) {
	return env[varname];
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

/** Debug environment array */
type DebugEnvironment = { name: string; value: string | undefined }[];

/**
 * Get key of variable in process environment
 *
 * Some platforms such as Win32 have case-insensitive environment variables
 *
 * @param varname Variable name
 * @param env Process environment
 */
function getVariableKey(varname: string, env: NodeJS.ProcessEnv) {
	return process.platform === 'win32'
		? Object.keys(env).find(
				(key) => key.toUpperCase() == varname.toUpperCase()
			) || varname
		: varname;
}
/**
 * Get index of variable in debug environment
 *
 * Some platforms such as Win32 have case-insensitive environment variables
 *
 * @param varname Variable name
 * @param environment Debug environment
 */
function getVariableIndex(varname: string, environment: DebugEnvironment) {
	return process.platform === 'win32'
		? environment.findIndex(
				({ name }) => name.toUpperCase() == varname.toUpperCase()
			)
		: environment.findIndex(({ name }) => name == varname);
}

/**
 * Merge variables into process environment
 *
 * @param variables Variables to merge
 *
 * @return Environment with variables merged
 */
function mergeVariablesIntoProcessEnv(variables: { [name: string]: string }) {
	const result = { ...process.env };
	for (let name in variables) {
		delete result[getVariableKey(name, process.env)];
		result[name] = variables[name];
	}
	return result;
}

/**
 * Merge variables into debug environment
 *
 * @param environment Target environment
 * @param variables Variables to merge
 *
 * @return Environment with variables merged
 */
function mergeVariablesIntoDebugEnv(
	environment: DebugEnvironment,
	variables: { [name: string]: string }
) {
	const result = [...environment];
	for (let name in variables) {
		const variableIndex = getVariableIndex(name, environment);
		if (variableIndex == -1) {
			result.push({ name, value: variables[name] });
		} else {
			result[variableIndex] = { name, value: variables[name] };
		}
	}
	return result;
}
