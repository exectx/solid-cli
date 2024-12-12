import { imports, exports, common } from '@sveltejs/cli-core/js';
import { parseScript, parseSvelte } from '@sveltejs/cli-core/parsers';

export function addEslintConfigPrettier(content: string): string {
	const { ast, generateCode } = parseScript(content);
	imports.addDefault(ast, 'eslint-config-prettier', 'prettier');
	const fallbackConfig = common.expressionFromString('[]');
	const defaultExport = exports.defaultExport(ast, fallbackConfig);
	const eslintConfig = defaultExport.value;
	if (eslintConfig.type !== 'ArrayExpression' && eslintConfig.type !== 'CallExpression')
		return content;

	const prettier = common.expressionFromString('prettier');

	const nodesToInsert = [];
	if (!common.hasNode(eslintConfig, prettier)) nodesToInsert.push(prettier);

	return generateCode();
}

export function addToDemoPage(content: string, path: string): string {
	const { template, generateCode } = parseSvelte(content);

	for (const node of template.ast.childNodes) {
		if (node.type === 'tag' && node.attribs['href'] === `/demo/${path}`) {
			return content;
		}
	}

	const newLine = template.source ? '\n' : '';
	const src = template.source + `${newLine}<a href="/demo/${path}">${path}</a>`;
	return generateCode({ template: src });
}
