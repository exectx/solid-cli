import { dedent, defineAddon, log, utils } from '@sveltejs/cli-core';
import { array, exports, functions, imports, object, common } from '@sveltejs/cli-core/js';
import { parseScript } from '@sveltejs/cli-core/parsers';

// TODO: use solidbase here

export default defineAddon({
	id: 'mdx',
	shortDescription: 'solid + markdown',
	homepage: 'https://mdxjs.com',
	options: {},
	run: ({ sv, typescript }) => {
		sv.dependency('@mdx-js/mdx', '^3.1.0');
		sv.dependency('solid-mdx', '^0.0.7');
		sv.devDependency('@vinxi/plugin-mdx', '^3.7.2');
		sv.devDependency('remark-frontmatter', '^5.0.0');
		sv.devDependency('gray-matter', '^4.0.3');
		const ext = typescript ? 'ts' : 'js';

		if (typescript) {
			sv.file('global.d.ts', (content) => {
				if (content) {
					log.error('global.d.ts already exists');
					return content;
				}
				return dedent`
				declare module "solid:content" {
					import content from ".vinxi/mdx/data";
					export { content };
				}`;
			});
		}

		sv.file(`app.config.${ext}`, (content) => {
			const { ast, generateCode } = parseScript(content);
			imports.addDefault(ast, 'remark-frontmatter', 'remarkFrontmatter');
			imports.addDefault(ast, '@vinxi/plugin-mdx', 'pkg');
			imports.addDefault(ast, 'node:path', 'path');
			imports.addNamed(ast, 'node:fs', {
				mkdirSync: 'mkdirSync',
				readdirSync: 'readdirSync',
				statSync: 'statSync',
				readFileSync: 'readFileSync',
				existsSync: 'existsSync',
				writeFileSync: 'writeFileSync'
			});
			imports.addDefault(ast, 'gray-matter', 'matter');
			imports.addNamed(ast, 'node:path', {
				resolve: 'resolve'
			});

			const [ts] = utils.createPrinter(typescript);

			if (typescript) {
				imports.addNamed(
					ast,
					'vinxi/dist/types/lib/vite-dev',
					{
						Plugin: 'Plugin'
					},
					true
				);
			}
			const vinxiMdximport = ast.body.find(
				(node) => node.type === 'ImportDeclaration' && node.source.value === '@vinxi/plugin-mdx'
			)!;
			if (typescript) {
				vinxiMdximport.comments = [
					{
						type: 'CommentBlock',
						value: ' @ts-expect-error no-types ',
						leading: true,
						trailing: false
					}
				];
			}
			const { value: rootObject } = exports.defaultExport(ast, functions.call('defineConfig', []));
			let defaultExportIdx = ast.body.findIndex((node) => node.type === 'ExportDefaultDeclaration');
			ast.body.splice(
				defaultExportIdx++,
				0,
				common.statementFromString('const { default: mdx } = pkg;')
			);

			if (typescript) {
				ast.body.splice(
					defaultExportIdx++,
					0,
					common.statementFromString('type Entry = { slug: string; path: string; title: string };')
				);
			}

			const constantMainEntry = common.statementFromString('const MAIN_ENTRY = "src/routes";');
			ast.body.splice(defaultExportIdx++, 0, constantMainEntry);

			const getMdxFrontmatterDataFunction = common.statementFromString(dedent`
			function getMdxData(entry${ts(': string')})${ts(': Entry[]')} {
				const entryPath = path.resolve(process.cwd(), entry);
				const files = readdirSync(entryPath);
				const mdxFiles${ts(': Entry[]')} = [];
				for (const file of files) {
					const filepath = path.join(entryPath, file);
					const stats = statSync(filepath);
					if (stats.isFile() && filepath.endsWith(".mdx")) {
						const relativepath = path.relative(
							path.join(process.cwd(), MAIN_ENTRY),
							filepath,
						);
						const f = readFileSync(filepath);
						const meta = matter(f);
						const slug = file.replace(".mdx", "");
						mdxFiles.push({
							slug,
							path: "/" + relativepath.replace(".mdx", ""),
							title: meta.data.title,
						});
					}
					if (stats.isDirectory()) {
						mdxFiles.push(...getMdxData(filepath));
					}
				}
				return mdxFiles;
			}`);
			ast.body.splice(defaultExportIdx++, 0, getMdxFrontmatterDataFunction);

			const makeFilesFunction = common.statementFromString(dedent`
			function makeFiles() {
				const files = getMdxData(MAIN_ENTRY);
				const collectionDir = path.resolve(process.cwd(), "./.vinxi/mdx");
				if (!existsSync(collectionDir)) {
					mkdirSync(collectionDir, { recursive: true });
				}

				const mdxObject${ts(': Record<string, Entry>')} = {};
				files.forEach((f) => (mdxObject[f.path] = f));

				writeFileSync(
					path.join(collectionDir, "data.ts"),
					\`export default \${JSON.stringify(mdxObject, null, 2)} as const;\`,
					"utf-8",
				);
			}`);
			ast.body.splice(defaultExportIdx++, 0, makeFilesFunction);

			const getFronmatterPlugin = common.statementFromString(dedent`
			function getFrontmatterPlugin()${ts(': Plugin')} {
				return {
					name: "solid-content-gen",
					enforce: "pre",
					buildStart() {
						makeFiles();
					},
					configureServer(server) {
						server.watcher.on("change", (filepath) => {
							if (!filepath.endsWith(".mdx")) return;
							makeFiles();
						});
					},
				};
			}`);
			ast.body.splice(defaultExportIdx++, 0, getFronmatterPlugin);

			const mdxFrontmatterVirtualModule = common.statementFromString(dedent`
			function mdxFrontmatterVirtualModule()${ts(': Plugin')} {
				const virtualModuleId = "solid:content";
				const resolveVirtualModuleId = "\0" + virtualModuleId;
				return {
					name: "solid:content",
					enforce: "post",
					resolveId(id${ts(': string')}) {
						if (id === virtualModuleId) {
							return resolveVirtualModuleId;
						}
					},
					async load(id${ts(': string')}) {
						if (id === resolveVirtualModuleId) {
							return \`import content from "./.vinxi/mdx/data";\nexport { content };\`;
						}
					},
				};
			}`);
			ast.body.splice(defaultExportIdx++, 0, mdxFrontmatterVirtualModule);

			const param1 = functions.argumentByIndex(rootObject, 0, object.createEmpty());
			const viteProperty = object.property(param1, 'vite', object.createEmpty());
			const extensionsArray = object.property(param1, 'extensions', array.createEmpty());
			array.push(extensionsArray, 'mdx');
			array.push(extensionsArray, 'md');
			const pluginsArray = object.property(viteProperty, 'plugins', array.createEmpty());
			array.push(pluginsArray, common.expressionFromString('getFrontmatterPlugin()'));
			array.push(pluginsArray, common.expressionFromString('mdxFrontmatterVirtualModule()'));
			array.push(
				pluginsArray,
				common.expressionFromString(
					'mdx.withImports({})({ jsx: true, jsxImportSource: "solid-js", providerImportSource: "solid-mdx", remarkPlugins: [remarkFrontmatter] })'
				)
			);

			return generateCode();
		});
	}
});
