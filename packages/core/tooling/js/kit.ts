import { Walker } from '@sveltejs/ast-tooling';
import { common, array, imports, exports, type AstTypes } from '../js/index.ts';

export function addGlobalAppInterface(
	ast: AstTypes.Program,
	name: 'Error' | 'RequestEventLocals' | 'PageData' | 'PageState' | 'Platform'
): AstTypes.TSInterfaceDeclaration {
	let startDecl = ast.body
		.filter((n) => n.type === 'TSModuleDeclaration')
		.find(
			(m) => m.declare && m.id.type === 'StringLiteral' && m.id.value === '@solidjs/start/server'
		);
	// default export
	const defaultExport = ast.body.findIndex((n) => n.type === 'ExportDefaultDeclaration');
	if (defaultExport === -1) {
		throw new Error('Missing default export in `src/entry-server.tsx`');
	}

	if (!startDecl) {
		startDecl = common.statementFromString(
			'declare module "@solidjs/start/server" {}'
		) as AstTypes.TSModuleDeclaration;
		// insert before default export
		ast.body.splice(defaultExport, 0, startDecl);
	}

	if (startDecl.body?.type !== 'TSModuleBlock') {
		throw new Error('Unexpected body type of `declare global` in `src/entry-server.tsx`');
	}

	// let app: AstTypes.TSModuleDeclaration | undefined;
	let interfaceNode: AstTypes.TSInterfaceDeclaration | undefined;

	// prettier-ignore
	Walker.walk(startDecl as AstTypes.ASTNode, {}, {
		TSInterfaceDeclaration(node) {
			if (node.id.type === 'Identifier' && node.id.name === name) {
				interfaceNode = node;
			}
		},
	});

	if (!interfaceNode) {
		// add the interface if it's missing
		interfaceNode = common.statementFromString(
			`interface ${name} {}`
		) as AstTypes.TSInterfaceDeclaration;
		startDecl.body.body.push(interfaceNode);
	}

	return interfaceNode;
}

export function addMiddleware(
	ast: AstTypes.Program,
	typescript: boolean,
	newMiddlewareName: string,
	middlewareContent: string
): void {
	let createMiddlewareLocalImport = 'createMiddleware';
	const middlewareLocalName = ast.body.find(
		(n) =>
			n.type === 'ImportDeclaration' &&
			n.source.value === '@solidjs/start/middleware' &&
			n.specifiers?.find((s) => {
				const condition = s.type === 'ImportSpecifier' && s.imported.name === 'createMiddleware';
				if (condition && s.local?.type === 'Identifier') {
					createMiddlewareLocalImport = s.local.name;
				}
				return condition;
			})
	);

	if (!middlewareLocalName) {
		// `createMiddlewareLocalImport` is `createMiddleware` here
		imports.addNamed(ast, '@solidjs/start/middleware', {
			createMiddleware: 'createMiddleware'
		});
	}

	const newMiddleware = common.expressionFromString(middlewareContent);
	if (common.hasNode(ast, newMiddleware)) return;

	const { value: defaultExportDecl } = exports.defaultExport(
		ast,
		common.expressionFromString('createMiddleware({})')
	);

	if (
		defaultExportDecl.type !== 'CallExpression' ||
		defaultExportDecl.callee.type !== 'Identifier' ||
		defaultExportDecl.callee.name !== createMiddlewareLocalImport
	) {
		throw new Error('Unexpected default export declaration in `src/middleware`');
	}
	const objExpression = defaultExportDecl.arguments?.[0];
	if (!objExpression || objExpression.type !== 'ObjectExpression') {
		throw new Error('Middleware config not found');
	}
	const onRequestProperty = objExpression.properties.find(
		(p) => p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.key.name === 'onRequest'
	) as AstTypes.ObjectProperty | undefined;

	if (!onRequestProperty) {
		const onRequestArray = array.createEmpty();
		array.push(onRequestArray, newMiddleware);
		objExpression.properties.push({
			type: 'ObjectProperty',
			key: { type: 'Identifier', name: 'onRequest' },
			value: onRequestArray
		});
	} else if (onRequestProperty.value.type === 'ArrayExpression') {
		array.push(onRequestProperty.value, newMiddleware);
	} else if (onRequestProperty.value.type === 'Identifier') {
		// TODO: check if the variable is an array or object and handle accordingly
		throw new Error('Not implemented when `onRequest` is a variable');
	} else {
		const onRequestArray = array.createEmpty();
		// @ts-ignore
		array.push(onRequestArray, onRequestProperty.value);
		array.push(onRequestArray, newMiddleware);
		onRequestProperty.value = onRequestArray;
	}
}
