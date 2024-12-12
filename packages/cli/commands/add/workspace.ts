import fs from 'node:fs';
import path from 'node:path';
import * as find from 'empathic/find';
import { type AstTypes } from '@sveltejs/cli-core/js';
import { parseScript, parseJson } from '@sveltejs/cli-core/parsers';
import { detectSync } from 'package-manager-detector';
import type { OptionValues, PackageManager, Workspace } from '@sveltejs/cli-core';
import { TESTING } from '../../utils/env.ts';
import { commonFilePaths, getPackageJson, readFile } from './utils.ts';
import { getUserAgent } from '../../utils/package-manager.ts';

type CreateWorkspaceOptions = {
	cwd: string;
	packageManager?: PackageManager;
	options?: OptionValues<any>;
};
export function createWorkspace({
	cwd,
	options = {},
	packageManager = detectSync({ cwd })?.name ?? getUserAgent() ?? 'npm'
}: CreateWorkspaceOptions): Workspace<any> {
	const resolvedCwd = path.resolve(cwd);
	const viteConfigPath = path.join(resolvedCwd, commonFilePaths.viteConfigTS);
	let usesTypescript = fs.existsSync(viteConfigPath);

	if (TESTING) {
		// while executing tests, we only look into the direct `cwd`
		// as we might detect the monorepo `tsconfig.json` otherwise.
		usesTypescript ||= fs.existsSync(path.join(resolvedCwd, commonFilePaths.tsconfig));
	} else {
		usesTypescript ||= find.up(commonFilePaths.tsconfig, { cwd }) !== undefined;
	}

	let dependencies: Record<string, string> = {};
	let directory = resolvedCwd;
	const root = findRoot(resolvedCwd);
	while (directory && directory !== root) {
		if (fs.existsSync(path.join(directory, commonFilePaths.packageJson))) {
			const { data: packageJson } = getPackageJson(directory);
			dependencies = {
				...packageJson.devDependencies,
				...packageJson.dependencies,
				...dependencies
			};
		}
		directory = path.dirname(directory);
	}
	// removes the version ranges (e.g. `^` is removed from: `^9.0.0`)
	for (const [key, value] of Object.entries(dependencies)) {
		dependencies[key] = value.replaceAll(/[^\d|.]/g, '');
	}

	return {
		cwd: resolvedCwd,
		options,
		packageManager,
		typescript: usesTypescript,
		kit: dependencies['@solidjs/start'] ? parseKitOptions(resolvedCwd, usesTypescript) : undefined,
		dependencyVersion: (pkg) => dependencies[pkg]
	};
}

function findRoot(cwd: string): string {
	const { root } = path.parse(cwd);
	let directory = cwd;
	while (directory && directory !== root) {
		if (fs.existsSync(path.join(directory, commonFilePaths.packageJson))) {
			if (fs.existsSync(path.join(directory, 'pnpm-workspace.yaml'))) {
				return directory;
			}
			const { data } = getPackageJson(directory);
			if (data.workspaces) {
				return directory;
			}
		}
		directory = path.dirname(directory);
	}
	return root;
}

function parseKitOptions(cwd: string, ts: boolean) {
	const jsOrTsConfig = readFile(cwd, ts ? 'tsconfig.json' : 'jsconfig.json');
	const { data } = parseJson(jsOrTsConfig);
	const paths = Object.entries(data.compilerOptions?.paths ?? {});
	let mainAlias = '';
	for (const [pathName, pathValue] of paths) {
		if (!(pathValue instanceof Array)) {
			continue;
		}
		if (pathValue.find((pathMapping: string) => pathMapping.includes('src/*'))) {
			mainAlias = pathName.replace('/*', '');
			break;
		}
	}

	const configSource = readFile(cwd, `app.config.${ts ? 'ts' : 'js'}`);
	const { ast } = parseScript(configSource);

	// NOTE: Leaving these checks to make sure app.config.[js|ts] is valid
	const defaultExport = ast.body.find((s) => s.type === 'ExportDefaultDeclaration');
	if (!defaultExport) throw Error(`Missing default export in \`app.config.${ts ? 'ts' : 'js'}\``);

	let callExpression: AstTypes.CallExpression | undefined;
	if (defaultExport.declaration.type === 'Identifier') {
		// e.g. `export default config;`
		const identifier = defaultExport.declaration;
		for (const declaration of ast.body) {
			if (declaration.type !== 'VariableDeclaration') continue;

			const declarator = declaration.declarations.find(
				(d): d is AstTypes.VariableDeclarator =>
					d.type === 'VariableDeclarator' &&
					d.id.type === 'Identifier' &&
					d.id.name === identifier.name
			);

			if (declarator?.init?.type !== 'CallExpression') continue;

			callExpression = declarator.init;
		}

		if (!callExpression)
			throw Error(
				`Unable to find solid start config object expression from \`app.config.${ts ? 'ts' : 'js'}\``
			);
	} else if (defaultExport.declaration.type === 'CallExpression') {
		// e.g. `export default { ... };`
		callExpression = defaultExport.declaration;
	}

	// We'll error out since we can't safely determine the config object
	if (!callExpression)
		throw new Error(`Unexpected svelte config shape from \`app.config.${ts ? 'ts' : 'js'}\``);

	// NOTE: this commeted block is svelte kit specific, solidstart config doesn't have this structure

	// const objectConfig = functions.argumentByIndex(callExpression, 0, object.createEmpty());
	// const kit = object.property(objectConfig, 'kit', object.createEmpty());
	// const files = object.property(kit, 'files', object.createEmpty());
	// const routes = object.property(files, 'routes', common.createLiteral());
	// const lib = object.property(files, 'lib', common.createLiteral());

	const routesDirectory = 'src/routes';
	const libDirectory = 'src/lib';

	return { routesDirectory, libDirectory, alias: mainAlias };
}
