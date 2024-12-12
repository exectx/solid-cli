import { dedent, defineAddon, log, colors } from '@sveltejs/cli-core';
import { addEslintConfigPrettier } from '../common.ts';
import { parseJson, parseScript } from '@sveltejs/cli-core/parsers';
import { object, exports, common } from '@sveltejs/cli-core/js';

export default defineAddon({
	id: 'prettier',
	shortDescription: 'formatter',
	homepage: 'https://prettier.io',
	options: {},
	run: ({ sv, dependencyVersion }) => {
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

		sv.file('prettier.config.js', (content) => {
			const { ast, generateCode } = parseScript(content);
			const prettierConfig = object.createEmpty();
			const defaultExport = exports.defaultExport(ast, prettierConfig);
			// NOTE: more checks here in case `add prettier` is run multiple times
			common.addJsDocTypeComment(defaultExport.astNode, "import('prettier').Config");
			return generateCode();
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
