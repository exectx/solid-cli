import MagicString from 'magic-string';
import {
	colors,
	dedent,
	defineAddon,
	defineAddonOptions,
	log,
	utils,
	Walker
} from '@sveltejs/cli-core';
import {
	array,
	common,
	functions,
	imports,
	object,
	variables,
	exports,
	kit as kitJs,
	type AstTypes
} from '@sveltejs/cli-core/js';
import * as html from '@sveltejs/cli-core/html';
import { parseHtml, parseJson, parseScript, parseSvelte } from '@sveltejs/cli-core/parsers';
import { addToDemoPage } from '../common.ts';

const DEFAULT_INLANG_PROJECT = {
	$schema: 'https://inlang.com/schema/project-settings',
	modules: [
		'https://cdn.jsdelivr.net/npm/@inlang/message-lint-rule-empty-pattern@1/dist/index.js',
		'https://cdn.jsdelivr.net/npm/@inlang/message-lint-rule-identical-pattern@1/dist/index.js',
		'https://cdn.jsdelivr.net/npm/@inlang/message-lint-rule-missing-translation@1/dist/index.js',
		'https://cdn.jsdelivr.net/npm/@inlang/message-lint-rule-without-source@1/dist/index.js',
		'https://cdn.jsdelivr.net/npm/@inlang/message-lint-rule-valid-js-identifier@1/dist/index.js',
		'https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@2/dist/index.js',
		'https://cdn.jsdelivr.net/npm/@inlang/plugin-m-function-matcher@0/dist/index.js'
	],
	'plugin.inlang.messageFormat': {
		pathPattern: './messages/{languageTag}.json'
	}
};

const options = defineAddonOptions({
	availableLanguageTags: {
		question: `Which languages would you like to support? ${colors.gray('(e.g. en,de-ch)')}`,
		type: 'string',
		default: 'en',
		validate(input) {
			const { invalidLanguageTags, validLanguageTags } = parseLanguageTagInput(input);

			if (invalidLanguageTags.length > 0) {
				if (invalidLanguageTags.length === 1) {
					return `The input "${invalidLanguageTags[0]}" is not a valid IETF BCP 47 language tag`;
				} else {
					const listFormat = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });
					return `The inputs ${listFormat.format(invalidLanguageTags.map((x) => `"${x}"`))} are not valid BCP47 language tags`;
				}
			}
			if (validLanguageTags.length === 0)
				return 'Please enter at least one valid BCP47 language tag. Eg: en';

			return undefined;
		}
	},
	demo: {
		type: 'boolean',
		default: true,
		question: 'Do you want to include a demo?'
	}
});

export default defineAddon({
	id: 'paraglide',
	shortDescription: 'i18n',
	homepage: 'https://inlang.com',
	options,
	setup: ({ kit, unsupported }) => {
		if (!kit) unsupported('Requires SvelteKit');
	},
	run: ({ sv, options, typescript, kit }) => {
		const ext = typescript ? 'ts' : 'js';
		const jsxExt = typescript ? 'tsx' : 'jsx';
		if (!kit) throw new Error('SvelteKit is required');

		sv.devDependency('@inlang/paraglide-vite', '^1.2.76');

		sv.file('project.inlang/settings.json', (content) => {
			if (content) return content;

			const { data, generateCode } = parseJson(content);

			for (const key in DEFAULT_INLANG_PROJECT) {
				data[key] = DEFAULT_INLANG_PROJECT[key as keyof typeof DEFAULT_INLANG_PROJECT];
			}
			const { validLanguageTags } = parseLanguageTagInput(options.availableLanguageTags);
			const sourceLanguageTag = validLanguageTags[0];

			data.sourceLanguageTag = sourceLanguageTag;
			data.languageTags = validLanguageTags;

			return generateCode();
		});

		// add the vite plugin
		sv.file(`app.config.${ext}`, (content) => {
			const { ast, generateCode } = parseScript(content);

			const vitePluginName = 'paraglide';
			imports.addNamed(ast, '@inlang/paraglide-vite', { paraglide: vitePluginName });

			const { value: rootObject } = exports.defaultExport(ast, functions.call('defineConfig', []));
			const param1 = functions.argumentByIndex(rootObject, 0, object.createEmpty());

			const viteProperty = object.property(param1, 'vite', object.createEmpty());
			const pluginsArray = object.property(viteProperty, 'plugins', array.createEmpty());
			const pluginFunctionCall = functions.call(vitePluginName, []);
			const pluginConfig = object.create({
				project: common.createLiteral('./project.inlang'),
				outdir: common.createLiteral('./src/lib/paraglide')
			});
			functions.argumentByIndex(pluginFunctionCall, 0, pluginConfig);
			array.push(pluginsArray, pluginFunctionCall);

			return generateCode();
		});

		sv.file(`src/lib/paraglide-adapter.${ext}`, () => {
			const [ts] = utils.createPrinter(typescript);
			return dedent`
				/*
				Paraglide — SolidStart Adapter
				This file will in the future be a npm package.
				Right now you can copy it into your project.
				And use it like this: (see ./index.tsx)
				*/
				import * as solid from "solid-js";
				import * as solid_web from "solid-js/web";
				import * as router from "@solidjs/router";

				/**
				 * Normalize a pathname.
				 * (e.g. "/foo" → "/foo")
				 * (e.g. "foo" → "/foo")
				 ${ts('', '*')}
				 ${ts('', '* @param {string} pathname - The pathname to normalize')}
				 ${ts('', '* @returns {string} Normalized pathname')}
				 */
				export function normalizePathname(pathname${ts(': string')})${ts(': string')} {
				  return pathname[0] === "/" ? pathname : "/" + pathname;
				}

				/**
				 * Get the language tag from the URL.
				 *
				 * @param ${ts('', '{string}')} pathname The pathname to check. (e.g. "/en/foo") (use {@link normalizePathname} first)
				 * @param ${ts('', '{string[]}')} all_language_tags All available language tags. (From paraglide, e.g. "en", "de")
				 * @returns ${ts('', '{string|undefined}')} The language tag from the URL, or \`undefined\` if no language tag was found.
				 */
				export function languageTagFromPathname${ts('<T extends string>')}(
				  pathname${ts(': string')},
				  all_language_tags${ts(': readonly T[]')},
				)${ts(': T | undefined')} {
				  for (const tag of all_language_tags) {
				    if (
				      pathname.startsWith(tag, 1) &&
				      (pathname.length === tag.length + 1 || pathname[tag.length + 1] === "/")
				    ) {
				      return tag;
				    }
				  }
				  return undefined;
				}

				/**
				 * Changes a provided url to include the correct language tag.
				 *
				 * To be used on \`<A href="...">\` components to make sure that the anchor tag will link to the correct language, when server side rendered.
				 *
				 * **Use only on internal links. (e.g. \`<A href="/foo">\` or \`<A href="/en/foo">\`)**
				 *
				 * @param ${ts('', '{string}')} pathname The pathname to link to. (e.g. "/foo/bar")
				 * @param ${ts('', '{string}')} page_language_tag The current language tag. (e.g. "en")
				 * @param ${ts('', '{string[]}')} available_language_tags All available language tags. (From paraglide, e.g. "en", "de")
				 * @returns ${ts('', '{string}')} The translated pathname. (e.g. "/en/bar")
				 */
				export function translateHref${ts('<T extends string>')}(
				  pathname${ts(': string')},
				  page_language_tag${ts(': T')},
				  available_language_tags${ts(': readonly T[]')},
				)${ts(': string')} {
				  const to_normal_pathname = normalizePathname(pathname);
				  const to_language_tag = languageTagFromPathname(
				    to_normal_pathname,
				    available_language_tags,
				  );
				  return to_language_tag
				    ? to_normal_pathname.replace(to_language_tag, page_language_tag)
				    : "/" + page_language_tag + to_normal_pathname;
				}

				/**
				 * Returns the current pathname. From request on server, from window on client.
				 *
				 * Use with {@link languageTagFromPathname} to get the language tag from the URL.
				 *
				 * @example
				 * \`\`\`ts
				 * const pathname = useLocationPathname()
				 * const language_tag = languageTagFromPathname(pathname, all_language_tags)
				 * \`\`\`
				 */
				export function useLocationPathname()${ts(': string')} {
				  return solid_web.isServer
				    ? ${ts('// eslint-disable-next-line @typescript-eslint/no-non-null-assertion')}
				      new URL(solid_web.getRequestEvent()${ts('!')}.request.url).pathname
				    : window.location.pathname;
				}

				${ts('/**')}
				${ts(' * The compiled paraglide runtime module.')}
				${ts(' * (e.g. "paraglide/runtime.js")')}
				${ts(' */')}
				${ts('export interface Paraglide<T extends string> {')}
				${ts('  readonly setLanguageTag: (language_tag: T | (() => T)) => void;')}
				${ts('  readonly languageTag: () => T;')}
				${ts('  readonly onSetLanguageTag: (callback: (language_tag: T) => void) => void;')}
				${ts('  readonly availableLanguageTags: readonly T[];')}
				${ts('  readonly sourceLanguageTag: T;')}
				${ts('}')}
				${ts('export interface I18n<T extends string> {')}
				${ts('  readonly languageTag: solid.Accessor<T>;')}
				${ts('  readonly setLanguageTag: (language_tag: T) => void;')}
				${ts('  readonly LanguageTagProvider: solid.ContextProviderComponent<T>;')}
				${ts('}')}
				/**
				 * Create an i18n adapter for SolidStart.
				 *
				 * @param ${ts('{Object}')} paraglide - The compiled paraglide runtime module. (e.g. "paraglide/runtime.js")
				 * @returns ${ts('{Object}')} An i18n adapter for SolidStart.
				 * @example
				 * \`\`\`ts
				 * import * as paraglide from '../paraglide/runtime.js'
				 *
				 * export const {LanguageTagProvider, languageTag, setLanguageTag} = adapter.createI18n(paraglide)
				 * \`\`\`
				 */
				export function createI18n${ts('<T extends string>')}(paraglide${ts(': Paraglide<T>')})${ts(': I18n<T>')} {
				  let languageTag${ts(': I18n<T>["languageTag"]')};
				  let setLanguageTag${ts(': I18n<T>["setLanguageTag"]')};
				  let LanguageTagProvider${ts(': I18n<T>["LanguageTagProvider"]')};
				  // SERVER
				  if (solid_web.isServer) {
				    const LanguageTagCtx = solid.createContext${ts('<T>')}();
				    LanguageTagProvider = LanguageTagCtx.Provider;
				    setLanguageTag = () => {
				      throw new Error("setLanguageTag not available on server");
				    };
				    languageTag = () => {
				      const ctx = solid.useContext(LanguageTagCtx);
				      if (!ctx) {
				        throw new Error("LanguageTagCtx not found");
				      }
				      return ctx;
				    };
				    paraglide.setLanguageTag(languageTag);
				  }
				  // BROWSER
				  else {
				    let language_tag${ts(': T')};
				    LanguageTagProvider = (props) => {
				      language_tag = props.value;
				      paraglide.setLanguageTag(language_tag);
				      const navigate = router.useNavigate();
				      /*
				      Keep the language tag in the URL
				      */
				      router.useBeforeLeave((e) => {
				        if (typeof e.to !== "string") return;
				        const from_pathname = normalizePathname(e.from.pathname);
				        const from_language_tag = languageTagFromPathname(
				          from_pathname,
				          paraglide.availableLanguageTags,
				        );
				        const to_pathname = normalizePathname(e.to);
				        const to_language_tag = languageTagFromPathname(
				          to_pathname,
				          paraglide.availableLanguageTags,
				        );
				        //  /en/foo → /en/bar  |  /foo → /bar
				        if (to_language_tag === from_language_tag) return;
				        e.preventDefault();
				        //  /en/foo → /bar  |  /de/foo → /bar
				        if (!to_language_tag) {
				          navigate("/" + from_language_tag + to_pathname, e.options);
				        }
				        //  /foo → /en/bar
				        else if (
				          to_language_tag === paraglide.sourceLanguageTag &&
				          !from_language_tag
				        ) {
				          navigate(to_pathname.slice(to_language_tag.length + 1), e.options);
				        }
				        //  /de/foo → /en/bar  |  /foo → /de/bar
				        else {
				          location.pathname = to_pathname;
				        }
				      });
				      return props.children;
				    };
				    setLanguageTag = paraglide.setLanguageTag;
				    languageTag = () => language_tag;
				    paraglide.onSetLanguageTag((new_language_tag) => {
				      if (new_language_tag === language_tag) return;
				      const pathname = normalizePathname(location.pathname);
				      location.pathname =
				        "/" + new_language_tag + pathname.replace("/" + language_tag, "");
				    });
				  }
				  return {
				    languageTag,
				    setLanguageTag,
				    LanguageTagProvider,
				  };
				}`;
		});

		// src/lib/i18n file
		sv.file(`src/lib/i18n.${jsxExt}`, (content) => {
			if (content)
				log.warn(`The \`src/lib/i18n.${ext}\` file already exists. It will be overwritten`);
			const [ts] = utils.createPrinter(typescript);
			return dedent`
				// i18n.tsx
				import * as paraglide from "${kit.alias}/lib/paraglide/runtime"; // generated by paraglide
				${ts('import type { JSX } from "solid-js";', '')}
				import * as adapter from "./paraglide-adapter";
				${ts('export type AvailableLanguageTag = paraglide.AvailableLanguageTag;', '')}
				export const { availableLanguageTags, sourceLanguageTag } = paraglide;
				export const { useLocationPathname } = adapter;
				export const { LanguageTagProvider, languageTag, setLanguageTag } =
				  adapter.createI18n(paraglide);

				/**
				 * Programmatically change the language tag.
				 * (won't work without javascript)
				 */
				export function LocaleSwitcher() {
				  const language_tag = languageTag();
				  return (
				    <select
				      name="language"
				      onChange={(e) => setLanguageTag(e.target.value${ts(' as AvailableLanguageTag')})}
				    >
				      {availableLanguageTags.map((tag) => (
				        <option value={tag} selected={tag === language_tag}>
				          {tag}
				        </option>
				      ))}
				    </select>
				  );
				}

				${ts('export interface AlternateLinksProps {')}
				${ts('  href?: string;')}
				${ts('  languageTag?: AvailableLanguageTag;')}
				${ts('}')}

				/**
				 * Generates \`<link rel="alternate" hreflang="..." href="...">\` tags for all available languages.
				 *
				 * To be used in the \`<head>\` of your html document.
				 */
				export function AlternateLinks(props${ts(': AlternateLinksProps')}) {
				  const language_tag = props.languageTag ?? languageTag();
				  const href = props.href ?? useLocationPathname();
				  const links${ts(': JSX.Element[]')} = [];
				  for (const tag of availableLanguageTags) {
				    if (tag !== language_tag) {
				      links.push(
				        <link
				          rel="alternate"
				          hreflang={tag}
				          href={adapter.translateHref(
				            href,
				            tag,
				            paraglide.availableLanguageTags,
				          )}
				        />,
				      );
				    }
				  }
				  return links;
				}

				/**
				 * Get the language tag from the URL.
				 *
				 * @param ${ts('', '{string}')} pathname The pathname to check. (e.g. "/en/foo")
				 * @returns The language tag from the URL, or \`undefined\` if no language tag was found.
				 */
				export function languageTagFromPathname(
				  pathname${ts(': string')},
				)${ts(': AvailableLanguageTag | undefined')} {
				  return adapter.languageTagFromPathname(pathname, availableLanguageTags);
				}

				/**
				 * Get the language tag from the URL.
				 */
				export function useLocationLanguageTag()${ts(': AvailableLanguageTag | undefined')} {
				  const pathname = useLocationPathname();
				  return languageTagFromPathname(pathname);
				}
			`;
		});

		// reroute hook
		sv.file(`src/app.${jsxExt}`, (content) => {
			const { ast, generateCode } = parseScript(content);

			imports.addDefault(ast, `${kit.alias}/lib/i18n`, '* as i18n');
			const defaultAppExport = ast.body.find(
				(n) => n.type === 'ExportDefaultDeclaration'
			) as AstTypes.ExportDefaultDeclaration;

			let returnStatement:
				| (AstTypes.ReturnStatement & { argument: AstTypes.JSXElement })
				| undefined;
			if (
				!defaultAppExport ||
				defaultAppExport.declaration.type !== 'FunctionDeclaration' ||
				defaultAppExport.declaration.id?.name !== 'App' ||
				!defaultAppExport.declaration.body.body.find((n) => {
					const condition = n.type === 'ReturnStatement' && n.argument?.type === 'JSXElement';
					if (condition) {
						// @ts-ignore
						returnStatement = n;
					}
					return condition;
				}) ||
				!returnStatement
			) {
				log.error(
					`Could not find a valid default export for the \`App\` function component in \`src/app.${jsxExt}\`. Ensure that the file defines a JSX component named \`App\` and exports it as the default.`
				);
				return generateCode();
			}

			defaultAppExport.declaration.body.body.unshift(
				common.statementFromString('const url_language_tag = i18n.useLocationLanguageTag();'),
				common.statementFromString(
					'const language_tag = url_language_tag ?? i18n.sourceLanguageTag;'
				)
			);

			const updated = Walker.walk(
				returnStatement.argument as AstTypes.ASTNode,
				{},
				{
					JSXElement(node, { next, stop }) {
						const isRouter =
							node.openingElement.name.type === 'JSXIdentifier' &&
							node.openingElement.name.name === 'Router';
						const isSuspense =
							node.openingElement.name.type === 'JSXIdentifier' &&
							node.openingElement.name.name === 'Suspense' &&
							node.closingElement?.name.type === 'JSXIdentifier' &&
							node.closingElement.name.name === 'Suspense';

						if (isRouter) {
							const baseProp = node.openingElement.attributes?.find(
								(attr) =>
									attr.type === 'JSXAttribute' &&
									attr.name.type === 'JSXIdentifier' &&
									attr.name.name === 'base'
							);
							if (!baseProp) {
								node.openingElement.attributes ??= [];
								node.openingElement.attributes.unshift({
									type: 'JSXAttribute',
									name: {
										type: 'JSXIdentifier',
										name: 'base'
									},
									value: {
										type: 'JSXExpressionContainer',
										expression: {
											type: 'Identifier',
											name: 'url_language_tag'
										}
									}
								});
							}
							const rootProp = node.openingElement.attributes?.find(
								(attr) =>
									attr.type === 'JSXAttribute' &&
									attr.name.type === 'JSXIdentifier' &&
									attr.name.name === 'root'
							);
							if (!rootProp) {
								log.error('Could not find the root prop in the Router component');
								stop();
							} else {
								next();
							}
						} else if (isSuspense) {
							const provider = common.expressionFromString(
								'<i18n.LanguageTagProvider value={language_tag}></i18n.LanguageTagProvider>'
							) as AstTypes.JSXElement;
							provider.children = [node];
							return provider;
						} else {
							next();
						}
					}
				}
			);

			returnStatement.argument = updated as AstTypes.JSXElement;
			return generateCode();
		});

		// add the text-direction and lang attribute placeholders to app.html
		sv.file(`src/entry-server.${jsxExt}`, (content) => {
			const { ast, generateCode } = parseScript(content);
			imports.addDefault(ast, `${kit.alias}/lib/i18n`, '* as i18n');

			const defaultHandlerExport = ast.body.find(
				(n) => n.type === 'ExportDefaultDeclaration'
			) as AstTypes.ExportDefaultDeclaration;

			if (
				!defaultHandlerExport ||
				defaultHandlerExport.declaration.type !== 'CallExpression' ||
				defaultHandlerExport.declaration.callee.type !== 'Identifier' ||
				defaultHandlerExport.declaration.callee.name !== 'createHandler'
			) {
				log.error(
					`Could not find a valid default export for the \`createHandler\` function call in \`src/entry-server.${jsxExt}\`. Ensure that the file defines a function call named \`createHandler\` and exports it as the default.`
				);
				return generateCode();
			}

			const updated = Walker.walk(
				defaultHandlerExport.declaration as AstTypes.ASTNode,
				{ updatedArrowFunction: false },
				{
					ArrowFunctionExpression(node, { next, state, stop }) {
						if (!state.updatedArrowFunction) {
							const langugeTagVar = common.statementFromString(
								'const language_tag = i18n.useLocationLanguageTag() ?? i18n.sourceLanguageTag;'
							) as AstTypes.ExpressionStatement;
							// handle block body or if arrow function body is another type of node
							if (node.body.type === 'BlockStatement') {
								state.updatedArrowFunction = true;
								node.body.body.unshift(langugeTagVar);
							} else if (node.body.type === 'JSXElement') {
								// transform arrow function to block statement
								// add language tag at the beginning of new body
								// return the previous arrow function body
								const jsxElement = node.body;
								node.body = {
									type: 'BlockStatement',
									body: [
										langugeTagVar,
										{
											type: 'ReturnStatement',
											argument: jsxElement
										}
									]
								};
								state.updatedArrowFunction = true;
							} else {
								log.error('Unexpected body type of arrow function in `src/entry-server.tsx`');
								stop();
							}
						}
						next({ updatedArrowFunction: state.updatedArrowFunction });
					},
					JSXElement(node, { next }) {
						if (
							node.openingElement.name.type === 'JSXIdentifier' &&
							node.openingElement.name.name === 'html'
						) {
							node.openingElement.attributes ??= [];
							const langAttribute = node.openingElement.attributes.find(
								(attr) =>
									attr.type === 'JSXAttribute' &&
									attr.name.type === 'JSXIdentifier' &&
									attr.name.name === 'lang'
								// (attr.value?.type === 'StringLiteral' || attr.value?.type === 'JSXExpressionContainer')
							) as AstTypes.JSXAttribute | undefined;
							const newJsxExpressionContainer: AstTypes.JSXExpressionContainer = {
								type: 'JSXExpressionContainer',
								expression: {
									type: 'Identifier',
									name: 'language_tag'
								}
							};

							if (langAttribute) {
								langAttribute.value = newJsxExpressionContainer;
							} else {
								node.openingElement.attributes.push({
									type: 'JSXAttribute',
									name: {
										type: 'JSXIdentifier',
										name: 'lang'
									},
									value: newJsxExpressionContainer
								});
							}
							next();
						} else if (
							node.openingElement.name.type === 'JSXIdentifier' &&
							node.openingElement.name.name === 'head'
						) {
							const languageHtmlEl = common.expressionFromString(
								'<i18n.AlternateLinks languageTag={language_tag} />'
							) as AstTypes.JSXElement;
							node.children ??= [];
							node.children.push(languageHtmlEl);
							return node;
						} else {
							next();
						}
					}
				}
			);
			defaultHandlerExport.declaration = updated as AstTypes.CallExpression;
			return generateCode();
		});

		if (options.demo) {
			sv.file(`${kit.routesDirectory}/demo/index.${jsxExt}`, (content) => {
				const template = addToDemoPage('', 'paraglide');
				const { ast, generateCode } = parseScript(content);
				const defaultExportNodeIdx = ast.body.findIndex(
					(n) => n.type === 'ExportDefaultDeclaration'
				);
				let defaultExportNode = ast.body[defaultExportNodeIdx] as
					| AstTypes.ExportDefaultDeclaration
					| undefined;
				const demoComponent = common.statementFromString(
					'export default function Demo() {}'
				) as AstTypes.ExportDefaultDeclaration;
				if (!defaultExportNode || defaultExportNode.declaration.type !== 'FunctionDeclaration') {
					defaultExportNodeIdx === -1
						? ast.body.push(demoComponent)
						: (ast.body[defaultExportNodeIdx] = demoComponent);
					defaultExportNode = demoComponent;
				}
				if (defaultExportNode.declaration.type !== 'FunctionDeclaration') {
					// NOTE: doing this for typescript
					throw new Error('Expected default export to be a function declaration');
				}
				let returnStatement = defaultExportNode.declaration.body.body.find(
					(n) => n.type === 'ReturnStatement'
				);
				const jsxReturnStatement = common.statementFromString(
					'return <main></main>'
				) as AstTypes.ReturnStatement;
				const jsxElement = jsxReturnStatement.argument as AstTypes.JSXElement;

				if (!returnStatement) {
					returnStatement = jsxReturnStatement;
					defaultExportNode.declaration.body.body.push(returnStatement);
				}
				if (!returnStatement.argument || returnStatement.argument.type !== 'JSXElement') {
					// NOTE: Overwrite incompatible return statement
					returnStatement.argument = jsxElement;
				}
				returnStatement.argument.children ??= [];
				returnStatement.argument.children.push(
					common.expressionFromString(template) as AstTypes.JSXElement
				);
				return generateCode();
			});

			// solid
			sv.file(`${kit.routesDirectory}/demo/paraglide/index.${jsxExt}`, () => {
				const { ast, generateCode } = parseScript('');
				imports.addDefault(ast, `${kit.alias}/lib/paraglide/messages`, '* as m');
				imports.addNamed(ast, `${kit.alias}/lib/i18n`, { setLanguageTag: 'setLanguageTag' });
				const { validLanguageTags } = parseLanguageTagInput(options.availableLanguageTags);
				const links = validLanguageTags
					.map((x) => `<button onClick={() => setLanguageTag('${x}')}>${x}</button>`)
					.join('\n');
				const paraglideComponent = common.statementFromString(
					dedent`export default function Paraglide() {
              return (
                <main>
                  <h1>Paraglide Demo</h1>
                  <p>{m.hello_world({ name: "SolidStart User" })}</p>
                  <div>
                    ${links}
                  </div>
                </main>
              )
            }`
				) as AstTypes.ExportDefaultDeclaration;
				ast.body.push(paraglideComponent);
				return generateCode();
			});
		}

		const { validLanguageTags } = parseLanguageTagInput(options.availableLanguageTags);
		for (const languageTag of validLanguageTags) {
			sv.file(`messages/${languageTag}.json`, (content) => {
				const { data, generateCode } = parseJson(content);
				data['$schema'] = 'https://inlang.com/schema/inlang-message-format';
				data.hello_world = `Hello, {name} from ${languageTag}!`;

				return generateCode();
			});
		}
	},

	nextSteps: ({ highlighter }) => {
		const steps = [
			`Edit your messages in ${highlighter.path('messages/en.json')}`,
			'Consider installing the Sherlock IDE Extension'
		];
		if (options.demo) {
			steps.push(`Visit ${highlighter.route('/demo/paraglide')} route to view the demo`);
		}

		return steps;
	}
});

const isValidLanguageTag = (languageTag: string): boolean =>
	// Regex vendored in from https://github.com/opral/monorepo/blob/94c2298cc1da5378b908e4c160b0fa71a45caadb/inlang/source-code/versioned-interfaces/language-tag/src/interface.ts#L16
	RegExp(
		'^((?<grandfathered>(en-GB-oed|i-ami|i-bnn|i-default|i-enochian|i-hak|i-klingon|i-lux|i-mingo|i-navajo|i-pwn|i-tao|i-tay|i-tsu|sgn-BE-FR|sgn-BE-NL|sgn-CH-DE)|(art-lojban|cel-gaulish|no-bok|no-nyn|zh-guoyu|zh-hakka|zh-min|zh-min-nan|zh-xiang))|((?<language>([A-Za-z]{2,3}(-(?<extlang>[A-Za-z]{3}(-[A-Za-z]{3}){0,2}))?))(-(?<script>[A-Za-z]{4}))?(-(?<region>[A-Za-z]{2}|[0-9]{3}))?(-(?<variant>[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3}))*))$'
	).test(languageTag);

function parseLanguageTagInput(input: string): {
	validLanguageTags: string[];
	invalidLanguageTags: string[];
} {
	const probablyLanguageTags = input
		.replace(/[,:\s]/g, ' ') // replace common separators with spaces
		.split(' ')
		.filter(Boolean) // remove empty segments
		.map((tag) => tag.toLowerCase());

	const validLanguageTags: string[] = [];
	const invalidLanguageTags: string[] = [];

	for (const tag of probablyLanguageTags) {
		if (isValidLanguageTag(tag)) validLanguageTags.push(tag);
		else invalidLanguageTags.push(tag);
	}

	return {
		validLanguageTags,
		invalidLanguageTags
	};
}
