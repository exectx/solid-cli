import { dedent, defineAddon, log, colors, Walker } from '@sveltejs/cli-core';
import { addEslintConfigPrettier } from '../common.ts';
import { parseJson, parseScript } from '@sveltejs/cli-core/parsers';
import { object, exports, common, type AstTypes } from '@sveltejs/cli-core/js';
import fs from 'node:fs';

export default defineAddon({
	id: 'prettier',
	shortDescription: 'formatter',
	homepage: 'https://prettier.io',
	options: {},
	run: ({ sv, dependencyVersion, cwd }) => {
		sv.devDependency('prettier', '^3.3.2');

		sv.file('.prettierignore', (content) => {
			if (content) return content;
			return dedent`
				# Package Managers
				package-lock.json
				pnpm-lock.yaml
				yarn.lock
			`;
		});

		let prettierConfigFile: string | undefined;
		if (fs.existsSync(`${cwd}/prettier.config.js`)) prettierConfigFile = 'prettier.config.js';
		if (!prettierConfigFile && fs.existsSync(`${cwd}/.prettierrc`))
			prettierConfigFile = '.prettierrc';
		prettierConfigFile ??= 'prettier.config.js';

		sv.file(prettierConfigFile, (content) => {
			return handlePrettierConfig(prettierConfigFile, content);
		});

		const eslintVersion = dependencyVersion('eslint');
		const eslintInstalled = hasEslint(eslintVersion);

		sv.file('package.json', (content) => {
			const { data, generateCode } = parseJson(content);

			data.scripts ??= {};
			const scripts: Record<string, string> = data.scripts;
			const CHECK_CMD = 'prettier --check .';
			scripts['format'] ??= 'prettier --write .';

			if (eslintInstalled) {
				scripts['lint'] ??= `${CHECK_CMD} && eslint .`;
				if (!scripts['lint'].includes(CHECK_CMD)) scripts['lint'] += ` && ${CHECK_CMD}`;
			} else {
				scripts['lint'] ??= CHECK_CMD;
			}
			return generateCode();
		});

		if (eslintVersion?.startsWith(SUPPORTED_ESLINT_VERSION) === false) {
			log.warn(
				`An older major version of ${colors.yellow(
					'eslint'
				)} was detected. Skipping ${colors.yellow('eslint-config-prettier')} installation.`
			);
		}

		if (eslintInstalled) {
			sv.devDependency('eslint-config-prettier', '^9.1.0');
			sv.file('eslint.config.js', addEslintConfigPrettier);
		}
	}
});

const SUPPORTED_ESLINT_VERSION = '9';

function hasEslint(version: string | undefined): boolean {
	return !!version && version.startsWith(SUPPORTED_ESLINT_VERSION);
}

function handlePrettierConfig(filename: string, content: string) {
	if (filename === 'prettier.config.js') {
		const { ast, generateCode } = parseScript(content);
		const prettierConfig = exports.defaultExport(ast, object.createEmpty());
		if (!content) {
			object.property(prettierConfig.value, 'useTabs', common.createLiteral(false));
			common.addJsDocTypeComment(prettierConfig.astNode, "import('prettier').Config");
		}
		if (prettierConfig.value.type !== 'ObjectExpression') {
			log.error('Expected existing prettier config to be of type `ObjectExpression`');
			return content;
		}

		const defaultExport = ast.body.find((s) => s.type === 'ExportDefaultDeclaration')!;
		let jsDocComments = defaultExport.comments;
		if (common.hasNode(defaultExport, prettierConfig.value)) {
			defaultExport.comments ??= [];
			jsDocComments = defaultExport.comments;
		} else {
			Walker.walk(
				ast as AstTypes.ASTNode,
				{},
				{
					VariableDeclaration(node, { next, stop }) {
						if (common.hasNode(node, prettierConfig.value)) {
							node.comments ??= [];
							jsDocComments = node.comments;
							stop();
						}
						next();
					}
				}
			);
			if (!jsDocComments)
				throw new Error(
					'Could not find prettier config variable declaration, This state should not be possible'
				);
		}

		if (!jsDocComments.find((c) => c.value.includes('prettier'))) {
			// overring existing comments
			if (jsDocComments.length) jsDocComments.splice(0, jsDocComments.length);
			jsDocComments.push({
				type: 'CommentBlock',
				value: "* @type {import('prettier').Config}",
				leading: true
			});
		}
		return generateCode();
	} else if (filename === '.prettierrc') {
		const { data, generateCode } = parseJson(content);
		if (Object.keys(data).length === 0) {
			// we'll only set these defaults if there is no pre-existing config
			data.useTabs = false;
		}
		return generateCode();
	} else {
		throw new Error('Prettier config file must be either `prettier.config.js` or `.prettierrc`');
	}
}
