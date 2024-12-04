import { defineAddon } from '@sveltejs/cli-core';
import { array, exports, functions, imports, object, common } from '@sveltejs/cli-core/js';
import { parseScript } from '@sveltejs/cli-core/parsers';

export default defineAddon({
	id: 'mdx',
	shortDescription: 'solid + markdown',
	homepage: 'https://mdxjs.com',
	options: {},
	run: ({ sv, typescript }) => {
		sv.dependency('@mdx-js/mdx', '^3.1.0');
		sv.dependency('solid-mdx', '^0.0.7');
		sv.devDependency('@vinxi/plugin-mdx', '^3.7.2');
		const ext = typescript ? 'ts' : 'js';

		sv.file(`app.config.${ext}`, (content) => {
			const { ast, generateCode } = parseScript(content);
			imports.addDefault(ast, '@vinxi/plugin-mdx', 'pkg');
			const vinxiMdximport = ast.body.find(
				(node) => node.type === 'ImportDeclaration' && node.source.value === '@vinxi/plugin-mdx'
			)!;
			if (typescript) {
				vinxiMdximport.comments = [
					{
						type: 'CommentBlock',
						value: ' @ts-expect-error typerror',
						leading: true,
						trailing: false
					}
				];
			}
			const { value: rootObject } = exports.defaultExport(ast, functions.call('defineConfig', []));
			const defaultExport = ast.body.findIndex((node) => node.type === 'ExportDefaultDeclaration');
			ast.body.splice(
				defaultExport,
				0,
				common.statementFromString('const { default: mdx } = pkg;')
			);
			const param1 = functions.argumentByIndex(rootObject, 0, object.createEmpty());
			const viteProperty = object.property(param1, 'vite', object.createEmpty());
			const extensionsArray = object.property(param1, 'extensions', array.createEmpty());
			array.push(extensionsArray, 'mdx');
			array.push(extensionsArray, 'md');
			const pluginsArray = object.property(viteProperty, 'plugins', array.createEmpty());
			const mdxPlugin = common.expressionFromString(
				'mdx.withImports({})({ jsx: true, jsxImportSource: "solid-js", providerImportSource: "solid-mdx", })'
			);
			array.push(pluginsArray, mdxPlugin);

			return generateCode();
		});
	}
});
