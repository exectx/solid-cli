import { defineAddon, defineAddonOptions, log, Walker } from '@sveltejs/cli-core';
import { addImports } from '@sveltejs/cli-core/css';
import { array, common, exports, imports, object, type AstTypes } from '@sveltejs/cli-core/js';
import { parseCss, parseJson, parseScript } from '@sveltejs/cli-core/parsers';
import fs from 'node:fs';

type Plugin = {
	id: string;
	package: string;
	version: string;
	identifier: string;
};

const plugins: Plugin[] = [
	{
		id: 'typography',
		package: '@tailwindcss/typography',
		version: '^0.5.15',
		identifier: 'typography'
	},
	{
		id: 'forms',
		package: '@tailwindcss/forms',
		version: '^0.5.9',
		identifier: 'forms'
	},
	{
		id: 'container-queries',
		package: '@tailwindcss/container-queries',
		version: '^0.1.1',
		identifier: 'containerQueries'
	}
];

const options = defineAddonOptions({
	plugins: {
		type: 'multiselect',
		question: 'Which plugins would you like to add?',
		options: plugins.map((p) => ({ value: p.id, label: p.id, hint: p.package })),
		default: []
	}
});

export default defineAddon({
	id: 'tailwindcss',
	alias: 'tailwind',
	shortDescription: 'css framework',
	homepage: 'https://tailwindcss.com',
	options,
	run: ({ sv, options, cwd, typescript, dependencyVersion }) => {
		const ext = typescript ? 'ts' : 'js';
		const prettierInstalled = Boolean(dependencyVersion('prettier'));

		sv.devDependency('tailwindcss', '^3.4.9');
		sv.devDependency('autoprefixer', '^10.4.20');

		if (prettierInstalled) sv.devDependency('prettier-plugin-tailwindcss', '^0.6.5');

		for (const plugin of plugins) {
			if (!options.plugins.includes(plugin.id)) continue;

			sv.dependency(plugin.package, plugin.version);
		}

		sv.file(`tailwind.config.${ext}`, (content) => {
			const { ast, generateCode } = parseScript(content);
			let root;
			const rootExport = object.createEmpty();
			if (typescript) {
				imports.addNamed(ast, 'tailwindcss', { Config: 'Config' }, true);
				root = common.satisfiesExpression(rootExport, 'Config');
			}

			const { astNode: exportDeclaration, value: node } = exports.defaultExport(
				ast,
				root ?? rootExport
			);

			const config = node.type === 'TSSatisfiesExpression' ? node.expression : node;
			if (config.type !== 'ObjectExpression') {
				throw new Error(`Unexpected tailwind config shape: ${config.type}`);
			}

			if (!typescript) {
				common.addJsDocTypeComment(exportDeclaration, "import('tailwindcss').Config");
			}

			const contentArray = object.property(config, 'content', array.createEmpty());
			array.push(contentArray, './src/**/*.{js,jsx,ts,tsx}');

			const themeObject = object.property(config, 'theme', object.createEmpty());
			object.property(themeObject, 'extend', object.createEmpty());

			const pluginsArray = object.property(config, 'plugins', array.createEmpty());

			for (const plugin of plugins) {
				if (!options.plugins.includes(plugin.id)) continue;
				imports.addDefault(ast, plugin.package, plugin.identifier);
				array.push(pluginsArray, { type: 'Identifier', name: plugin.identifier });
			}

			return generateCode();
		});

		sv.file('postcss.config.js', (content) => {
			const { ast, generateCode } = parseScript(content);
			const { value: rootObject } = exports.defaultExport(ast, object.createEmpty());
			const pluginsObject = object.property(rootObject, 'plugins', object.createEmpty());

			object.property(pluginsObject, 'tailwindcss', object.createEmpty());
			object.property(pluginsObject, 'autoprefixer', object.createEmpty());
			return generateCode();
		});

		sv.file('src/app.css', (content) => {
			const layerImports = ['base', 'components', 'utilities'].map(
				(layer) => `tailwindcss/${layer}`
			);
			if (layerImports.every((i) => content.includes(i))) {
				return content;
			}

			const { ast, generateCode } = parseCss(content);
			const originalFirst = ast.first;

			const specifiers = layerImports.map((i) => `'${i}'`);
			const nodes = addImports(ast, specifiers);

			if (
				originalFirst !== ast.first &&
				originalFirst?.type === 'atrule' &&
				originalFirst.name === 'import'
			) {
				originalFirst.raws.before = '\n';
			}

			// We remove the first node to avoid adding a newline at the top of the stylesheet
			nodes.shift();

			// Each node is prefixed with single newline, ensuring the imports will always be single spaced.
			// Without this, the CSS printer will vary the spacing depending on the current state of the stylesheet
			nodes.forEach((n) => (n.raws.before = '\n'));

			return generateCode();
		});

		if (dependencyVersion('prettier')) {
			let prettierConfigFile: string | undefined;
			if (fs.existsSync(`${cwd}/prettier.config.js`)) prettierConfigFile = 'prettier.config.js';
			if (!prettierConfigFile && fs.existsSync(`${cwd}/.prettierrc`))
				prettierConfigFile = '.prettierrc';
			prettierConfigFile ??= 'prettier.config.js';

			sv.file(prettierConfigFile, (content) => {
				return handlePrettierTailwindConfig(prettierConfigFile, content);
			});
		}
	}
});

function handlePrettierTailwindConfig(filename: string, content: string) {
	const PLUGIN_NAME = 'prettier-plugin-tailwindcss';
	if (filename === 'prettier.config.js') {
		const { ast, generateCode } = parseScript(content);
		const prettierConfig = exports.defaultExport(ast, object.createEmpty());
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
		if (!jsDocComments.find((c) => c.value.includes('prettier-plugin-tailwindcss'))) {
			// overring existing comments
			if (jsDocComments.length) jsDocComments.splice(0, jsDocComments.length);
			jsDocComments.push({
				type: 'CommentBlock',
				value:
					"* @type {import('prettier').Config & import('prettier-plugin-tailwindcss').PluginOptions}",
				leading: true
			});
		}
		const plugins = object.property(prettierConfig.value, 'plugins', array.createEmpty());
		array.push(plugins, PLUGIN_NAME);
		return generateCode();
	} else if (filename === '.prettierrc') {
		const { data, generateCode } = parseJson(content);
		data.plugins ??= [];
		const plugins: string[] = data.plugins;
		if (!plugins.includes(PLUGIN_NAME)) plugins.push(PLUGIN_NAME);
		return generateCode();
	} else {
		throw new Error('Prettier config file must be either `prettier.config.js` or `.prettierrc`');
	}
}
