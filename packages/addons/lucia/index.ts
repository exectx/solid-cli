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
import * as js from '@sveltejs/cli-core/js';
import type { AstTypes } from '@sveltejs/cli-core/js';
import { parseScript } from '@sveltejs/cli-core/parsers';
import { addToDemoPage } from '../common.ts';

const TABLE_TYPE = {
	mysql: 'mysqlTable',
	postgresql: 'pgTable',
	sqlite: 'sqliteTable'
};

type Dialect = 'mysql' | 'postgresql' | 'sqlite';

let drizzleDialect: Dialect;
let schemaPath: string;

const options = defineAddonOptions({
	demo: {
		type: 'boolean',
		default: true,
		question: `Do you want to include a demo? ${colors.dim('(includes a login/register page)')}`
	}
});

export default defineAddon({
	id: 'lucia',
	shortDescription: 'auth guide',
	homepage: 'https://lucia-auth.com',
	options,
	setup: ({ kit, dependencyVersion, unsupported, dependsOn }) => {
		if (!kit) unsupported('Requires SvelteKit');
		if (!dependencyVersion('drizzle-orm')) dependsOn('drizzle');
	},
	run: ({ sv, typescript, options, kit, dependencyVersion }) => {
		const ext = typescript ? 'ts' : 'js';
		const jsxExt = typescript ? 'tsx' : 'jsx';

		sv.dependency('@oslojs/crypto', '^1.0.1');
		sv.dependency('@oslojs/encoding', '^1.1.0');

		if (options.demo) {
			// password hashing for demo
			sv.dependency('@node-rs/argon2', '^1.1.0');
		}

		sv.file(`drizzle.config.${ext}`, (content) => {
			const { ast, generateCode } = parseScript(content);
			const isProp = (name: string, node: AstTypes.ObjectProperty) =>
				node.key.type === 'Identifier' && node.key.name === name;

			// prettier-ignore
			Walker.walk(ast as AstTypes.ASTNode, {}, {
				ObjectProperty(node) {
					if (isProp('dialect', node) && node.value.type === 'StringLiteral') {
						drizzleDialect = node.value.value as Dialect;
					}
					if (isProp('schema', node) && node.value.type === 'StringLiteral') {
						schemaPath = node.value.value;
					}
				}
			})

			if (!drizzleDialect) {
				throw new Error('Failed to detect DB dialect in your `drizzle.config.[js|ts]` file');
			}
			if (!schemaPath) {
				throw new Error('Failed to find schema path in your `drizzle.config.[js|ts]` file');
			}
			return generateCode();
		});

		sv.file(schemaPath, (content) => {
			const { ast, generateCode } = parseScript(content);
			const createTable = (name: string) => js.functions.call(TABLE_TYPE[drizzleDialect], [name]);

			const userDecl = js.variables.declaration(ast, 'const', 'user', createTable('user'));
			const sessionDecl = js.variables.declaration(ast, 'const', 'session', createTable('session'));

			const user = js.exports.namedExport(ast, 'user', userDecl);
			const session = js.exports.namedExport(ast, 'session', sessionDecl);

			const userTable = getCallExpression(user);
			const sessionTable = getCallExpression(session);

			if (!userTable || !sessionTable) {
				throw new Error('failed to find call expression of `user` or `session`');
			}

			if (userTable.arguments.length === 1) {
				userTable.arguments.push(js.object.createEmpty());
			}
			if (sessionTable.arguments.length === 1) {
				sessionTable.arguments.push(js.object.createEmpty());
			}

			const userAttributes = userTable.arguments[1];
			const sessionAttributes = sessionTable.arguments[1];
			if (
				userAttributes?.type !== 'ObjectExpression' ||
				sessionAttributes?.type !== 'ObjectExpression'
			) {
				throw new Error('unexpected shape of `user` or `session` table definition');
			}

			if (drizzleDialect === 'sqlite') {
				js.imports.addNamed(ast, 'drizzle-orm/sqlite-core', {
					sqliteTable: 'sqliteTable',
					text: 'text',
					integer: 'integer'
				});
				js.object.overrideProperties(userAttributes, {
					id: js.common.expressionFromString("text('id').primaryKey()")
				});
				if (options.demo) {
					js.object.overrideProperties(userAttributes, {
						username: js.common.expressionFromString("text('username').notNull().unique()"),
						passwordHash: js.common.expressionFromString("text('password_hash').notNull()")
					});
				}
				js.object.overrideProperties(sessionAttributes, {
					id: js.common.expressionFromString("text('id').primaryKey()"),
					userId: js.common.expressionFromString(
						"text('user_id').notNull().references(() => user.id)"
					),
					expiresAt: js.common.expressionFromString(
						"integer('expires_at', { mode: 'timestamp' }).notNull()"
					)
				});
			}
			if (drizzleDialect === 'mysql') {
				js.imports.addNamed(ast, 'drizzle-orm/mysql-core', {
					mysqlTable: 'mysqlTable',
					varchar: 'varchar',
					datetime: 'datetime'
				});
				js.object.overrideProperties(userAttributes, {
					id: js.common.expressionFromString("varchar('id', { length: 255 }).primaryKey()")
				});
				if (options.demo) {
					js.object.overrideProperties(userAttributes, {
						username: js.common.expressionFromString(
							"varchar('username', { length: 32 }).notNull().unique()"
						),
						passwordHash: js.common.expressionFromString(
							"varchar('password_hash', { length: 255 }).notNull()"
						)
					});
				}
				js.object.overrideProperties(sessionAttributes, {
					id: js.common.expressionFromString("varchar('id', { length: 255 }).primaryKey()"),
					userId: js.common.expressionFromString(
						"varchar('user_id', { length: 255 }).notNull().references(() => user.id)"
					),
					expiresAt: js.common.expressionFromString("datetime('expires_at').notNull()")
				});
			}
			if (drizzleDialect === 'postgresql') {
				js.imports.addNamed(ast, 'drizzle-orm/pg-core', {
					pgTable: 'pgTable',
					text: 'text',
					timestamp: 'timestamp'
				});
				js.object.overrideProperties(userAttributes, {
					id: js.common.expressionFromString("text('id').primaryKey()")
				});
				if (options.demo) {
					js.object.overrideProperties(userAttributes, {
						username: js.common.expressionFromString("text('username').notNull().unique()"),
						passwordHash: js.common.expressionFromString("text('password_hash').notNull()")
					});
				}
				js.object.overrideProperties(sessionAttributes, {
					id: js.common.expressionFromString("text('id').primaryKey()"),
					userId: js.common.expressionFromString(
						"text('user_id').notNull().references(() => user.id)"
					),
					expiresAt: js.common.expressionFromString(
						"timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull()"
					)
				});
			}

			let code = generateCode();
			if (typescript) {
				if (!code.includes('export type Session =')) {
					code += '\n\nexport type Session = typeof session.$inferSelect;';
				}
				if (!code.includes('export type User =')) {
					code += '\n\nexport type User = typeof user.$inferSelect;';
				}
			}
			return code;
		});

		sv.file(`${kit?.libDirectory}/server/auth.${ext}`, (content) => {
			const { ast, generateCode } = parseScript(content);

			js.imports.addNamespace(ast, `${kit?.alias}/lib/server/db/schema`, 'table');
			js.imports.addNamed(ast, `${kit?.alias}/lib/server/db`, { db: 'db' });
			js.imports.addNamed(ast, '@oslojs/encoding', {
				encodeBase64url: 'encodeBase64url',
				encodeHexLowerCase: 'encodeHexLowerCase'
			});
			js.imports.addNamed(ast, '@oslojs/crypto/sha2', { sha256: 'sha256' });
			js.imports.addNamed(ast, 'drizzle-orm', { eq: 'eq' });
			js.imports.addNamed(ast, 'vinxi/http', {
				deleteCookie: 'deleteCookie',
				setCookie: 'setCookie'
			});

			const ms = new MagicString(generateCode().trim());
			const [ts] = utils.createPrinter(typescript);

			if (!ms.original.includes('const DAY_IN_MS')) {
				ms.append('\n\nconst DAY_IN_MS = 1000 * 60 * 60 * 24;');
			}
			if (!ms.original.includes('export const sessionCookieName')) {
				ms.append("\n\nexport const sessionCookieName = 'auth-session';");
			}
			if (!ms.original.includes('export function generateSessionToken')) {
				const generateSessionToken = dedent`					
					export function generateSessionToken() {
						const bytes = crypto.getRandomValues(new Uint8Array(18));
						const token = encodeBase64url(bytes);
						return token;
					}`;
				ms.append(`\n\n${generateSessionToken}`);
			}
			if (!ms.original.includes('async function createSession')) {
				const createSession = dedent`
					${ts('', '/**')}
					${ts('', ' * @param {string} token')}
					${ts('', ' * @param {string} userId')}
					${ts('', ' */')}
					export async function createSession(token${ts(': string')}, userId${ts(': string')}) {
						const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
						const session${ts(': table.Session')} = {
							id: sessionId,
							userId,
							expiresAt: new Date(Date.now() + DAY_IN_MS * 30)
						};
						await db.insert(table.session).values(session);
						return session;
					}`;
				ms.append(`\n\n${createSession}`);
			}
			if (!ms.original.includes('async function validateSessionToken')) {
				const validateSessionToken = dedent`					
					${ts('', '/** @param {string} token */')}
					export async function validateSessionToken(token${ts(': string')}) {
						const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
						const [result] = await db
							.select({
								// Adjust user table here to tweak returned data
								user: { id: table.user.id, username: table.user.username },
								session: table.session
							})
							.from(table.session)
							.innerJoin(table.user, eq(table.session.userId, table.user.id))
							.where(eq(table.session.id, sessionId));

						if (!result) {
							return { session: null, user: null };
						}
						const { session, user } = result;

						const sessionExpired = Date.now() >= session.expiresAt.getTime();
						if (sessionExpired) {
							await db.delete(table.session).where(eq(table.session.id, session.id));
							return { session: null, user: null };
						}

						const renewSession = Date.now() >= session.expiresAt.getTime() - DAY_IN_MS * 15;
						if (renewSession) {
							session.expiresAt = new Date(Date.now() + DAY_IN_MS * 30);
							await db
								.update(table.session)
								.set({ expiresAt: session.expiresAt })
								.where(eq(table.session.id, session.id));
						}

						return { session, user };
					}`;
				ms.append(`\n\n${validateSessionToken}`);
			}
			if (typescript && !ms.original.includes('export type SessionValidationResult')) {
				const sessionType =
					'export type SessionValidationResult = Awaited<ReturnType<typeof validateSessionToken>>;';
				ms.append(`\n\n${sessionType}`);
			}
			if (!ms.original.includes('async function invalidateSession')) {
				const invalidateSession = dedent`					
					${ts('', '/** @param {string} sessionId */')}
					export async function invalidateSession(sessionId${ts(': string')}) {
						await db.delete(table.session).where(eq(table.session.id, sessionId));
					}`;
				ms.append(`\n\n${invalidateSession}`);
			}
			if (!ms.original.includes('export function setSessionTokenCookie')) {
				const setSessionTokenCookie = dedent`					
					${ts('', '/**')}
					${ts('', ' * @param {string} token')}
					${ts('', ' * @param {Date} expiresAt')}
					${ts('', ' */')}
					export function setSessionTokenCookie(token${ts(': string')}, expiresAt${ts(': Date')}) {
						setCookie(sessionCookieName, token, {
							expires: expiresAt,
							path: '/'
						});
					}`;
				ms.append(`\n\n${setSessionTokenCookie}`);
			}
			if (!ms.original.includes('export function deleteSessionTokenCookie')) {
				const deleteSessionTokenCookie = dedent`					
					export function deleteSessionTokenCookie() {
						deleteCookie(sessionCookieName, {
							path: '/'
						});
					}`;
				ms.append(`\n\n${deleteSessionTokenCookie}`);
			}

			return ms.toString();
		});

		if (typescript) {
			sv.file('src/entry-server.tsx', (content) => {
				const { ast, generateCode } = parseScript(content);

				const locals = js.kit.addGlobalAppInterface(ast, 'Locals');

				js.imports.addNamed(
					ast,
					`${kit?.alias}/lib/server/auth`,
					{ SessionValidationResult: 'SessionValidationResult' },
					true
				);
				if (!locals) {
					throw new Error('Failed detecting `locals` interface in `src/entry-server.tsx`');
				}

				const user = locals.body.body.find((prop) => js.common.hasTypeProp('user', prop));
				const session = locals.body.body.find((prop) => js.common.hasTypeProp('session', prop));

				if (!user) {
					locals.body.body.push(createLuciaType('user'));
				}
				if (!session) {
					locals.body.body.push(createLuciaType('session'));
				}
				return generateCode();
			});
		}

		sv.file(`src/middleware.${ext}`, (content) => {
			const { ast, generateCode } = parseScript(content);
			js.imports.addNamespace(ast, `${kit?.alias}/lib/server/auth`, 'auth');

			// check if `createMiddleware` named import already exists
			const hastMiddlewareImport = ast.body.find(
				(n) =>
					n.type === 'ImportDeclaration' &&
					n.source.value === '@solidjs/start/middleware' &&
					n.specifiers?.some(
						(s) =>
							s.type === 'ImportSpecifier' &&
							s.imported.type === 'Identifier' &&
							s.imported.name === 'createMiddleware'
					)
			);
			const hasCookieImport = ast.body.find(
				(n) =>
					n.type === 'ImportDeclaration' &&
					n.source.value === 'vinxi/http' &&
					n.specifiers?.some(
						(s) =>
							s.type === 'ImportSpecifier' &&
							s.imported.type === 'Identifier' &&
							s.imported.name === 'getCookie'
					)
			);
			if (!hastMiddlewareImport) {
				js.imports.addNamed(ast, '@solidjs/start/middleware', {
					createMiddleware: 'createMiddleware'
				});
			}
			if (!hasCookieImport) {
				js.imports.addNamed(ast, 'vinxi/http', { getCookie: 'getCookie' });
			}
			js.kit.addMiddleware(ast, typescript, 'authMiddleware', getAuthMiddlewareContent());
			return generateCode();
		});

		sv.file(`app.config.${ext}`, (content) => {
			const { ast, generateCode } = parseScript(content);
			const { value: rootObject } = js.exports.defaultExport(
				ast,
				js.functions.call('defineConfig', [])
			);
			const param1 = js.functions.argumentByIndex(rootObject, 0, js.object.createEmpty());
			js.object.property(param1, 'middleware', js.common.createLiteral(`./src/middleware.${ext}`));
			return generateCode();
		});

		if (options.demo) {
			sv.file(`${kit?.routesDirectory}/demo/index.${jsxExt}`, (content) => {
				const template = addToDemoPage('', 'lucia');
				const { ast, generateCode } = parseScript(content);
				const defaultExportNodeIdx = ast.body.findIndex(
					(n) => n.type === 'ExportDefaultDeclaration'
				);
				let defaultExportNode = ast.body[defaultExportNodeIdx] as
					| AstTypes.ExportDefaultDeclaration
					| undefined;
				const demoComponent = js.common.statementFromString(
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
				const jsxReturnStatement = js.common.statementFromString(
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
					js.common.expressionFromString(template) as AstTypes.JSXElement
				);
				return generateCode();
			});

			sv.file(`${kit!.routesDirectory}/demo/lucia/login.${jsxExt}`, (content) => {
				if (content) {
					const filePath = `${kit!.routesDirectory}/demo/lucia/login.${jsxExt}`;
					log.warn(`Existing ${colors.yellow(filePath)} file. Could not update.`);
					return content;
				}

				const [ts] = utils.createPrinter(typescript);
				return dedent`
          import {
            action,
            query,
            redirect,
            useSubmission,
            ${ts('type RouteDefinition,\n')}
          } from "@solidjs/router";
          import * as table from "${kit?.alias}/lib/server/db/schema";
          import * as auth from "${kit?.alias}/lib/server/auth";
          import { hash, verify } from "@node-rs/argon2";
          import { getRequestEvent } from "solid-js/web";
          import { encodeBase32LowerCase } from "@oslojs/encoding";
          import { db } from "${kit?.alias}/lib/server/db";
          import { eq } from "drizzle-orm";
          import { setResponseStatus } from "vinxi/http";

          const redirectIfAuthed = query(async () => {
            "use server";
            const event = getRequestEvent();
            if (event?.locals.user) {
              return redirect("/demo/lucia/");
            }
            return {};
          }, "authed-login?");

          export const route${ts(': RouteDefinition')} = {
            async preload() {
              return redirectIfAuthed();
            },
          };

          const login = action(async (formData${ts(': FormData')}) => {
            "use server";
            const event = getRequestEvent()${ts('!')};
            const username = formData.get("username");
            const password = formData.get("password");
            if (!validateUsername(username)) {
              setResponseStatus(400);
              throw new Error("Invalid username");
            }
            if (!validatePassword(password)) {
              setResponseStatus(400);
              throw new Error("Invalid password");
            }
            const results = await db
              .select()
              .from(table.user)
              .where(eq(table.user.username, username));
            const existingUser = results.at(0);
            if (!existingUser) {
              setResponseStatus(400);
              throw new Error("Incorrect username or password");
            }
            const validPassword = await verify(existingUser.passwordHash, password, {
              memoryCost: 19456,
              timeCost: 2,
              outputLen: 32,
              parallelism: 1,
            });
            if (!validPassword) {
              setResponseStatus(400);
              throw new Error("Incorrect username or password");
            }
            const sessionToken = auth.generateSessionToken();
            const session = await auth.createSession(sessionToken, existingUser.id);
            auth.setSessionTokenCookie(sessionToken, session.expiresAt);
            event.locals.user = existingUser;
            event.locals.session = session;
            return redirect("/demo/lucia");
          });

          const register = action(async (formData${ts(': FormData')}) => {
            "use server";
            const event = getRequestEvent()${ts('!')};
            const username = formData.get("username");
            const password = formData.get("password");
            if (!validateUsername(username)) {
              setResponseStatus(400);
              throw new Error("Invalid username");
            }
            if (!validatePassword(password)) {
              setResponseStatus(400);
              throw new Error("Invalid password");
            }
            const userId = generateUserId();
            const passwordHash = await hash(password, {
              // recommended minimum parameters
              memoryCost: 19456,
              timeCost: 2,
              outputLen: 32,
              parallelism: 1,
            });
            try {
              await db.insert(table.user).values({ id: userId, username, passwordHash });
              const sessionToken = auth.generateSessionToken();
              const session = await auth.createSession(sessionToken, userId);
              auth.setSessionTokenCookie(sessionToken, session.expiresAt);
              event.locals.user = { id: userId, username };
              event.locals.session = session;
            } catch (e) {
              setResponseStatus(500);
              throw new Error("An error has occurred");
            }
            return redirect("/demo/lucia");
          });

          function generateUserId() {
            // ID with 120 bits of entropy, or about the same as UUID v4.
            const bytes = crypto.getRandomValues(new Uint8Array(15));
            const id = encodeBase32LowerCase(bytes);
            return id;
          }

          function validateUsername(username${ts(': unknown')})${ts(': username is string')} {
            return (
              typeof username === 'string' &&
              username.length >= 3 &&
              username.length <= 31 &&
              /^[a-z0-9_-]+$/.test(username)
            );
          }

          function validatePassword(password${ts(': unknown')})${ts(': password is string')} {
            return (
              typeof password === 'string' &&
              password.length >= 6 &&
              password.length <= 255
            );
          }

          export default function () {
            const loginSubmission = useSubmission(login);
            const registerSubmission = useSubmission(register);
            return (
              <>
                <h1>Login/Register</h1>
                <form method="post" action={login}>
                  <label>
                    Username
                    <input name="username" />
                  </label>
                  <label>
                    Password
                    <input type="password" name="password" />
                  </label>
                  <button>Login</button>
                  <button formaction={register}>Register</button>
                </form>
                <p style="color: red">{loginSubmission.error?.message ?? ""}</p>
                <p style="color: red">{registerSubmission.error?.message ?? ""}</p>
              </>
            );
          }
        `;
			});

			sv.file(`${kit!.routesDirectory}/demo/lucia/index.${jsxExt}`, (content) => {
				if (content) {
					const filePath = `${kit!.routesDirectory}/demo/lucia/index.${jsxExt}`;
					log.warn(`Existing ${colors.yellow(filePath)} file. Could not update.`);
					return content;
				}

				const [ts] = utils.createPrinter(typescript);
				return dedent`
          import {
            query,
            createAsync,
            redirect,
            ${ts('type RouteDefinition,\n')}
            action,
          } from "@solidjs/router";
          import * as auth from "${kit?.alias}/lib/server/auth";
          import { getRequestEvent } from "solid-js/web";
          import { setResponseStatus } from "vinxi/http";

          const redirectIfNotAuthed = query(async () => {
            "use server";
            const event = getRequestEvent();
            if (!event?.locals.user) {
              return redirect("/demo/lucia/login");
            }
            return { user: event.locals.user };
          }, "authed?");

          export const route${ts(': RouteDefinition')} = {
            async preload() {
              return redirectIfNotAuthed();
            },
          };

          const logout = action(async () => {
            "use server";
            const event = getRequestEvent()${ts('!')};
            if (!event.locals.session) {
              setResponseStatus(401);
              return;
            }
            await auth.invalidateSession(event.locals.session.id);
            auth.deleteSessionTokenCookie();
            event.locals.session = null;
            event.locals.user = null;
            return redirect("/demo/lucia/login");
          });

          export default function () {
            const data = createAsync(() => redirectIfNotAuthed(), {
              deferStream: true,
            });
            return (
              <>
                <h1>Hi, {data()?.user.username}!</h1>
                <p>Your user ID is {data()?.user.id}.</p>
                <form method="post" action={logout}>
                  <button>Sign out</button>
                </form>
              </>
            );
          }
        `;
			});
		}
	},
	nextSteps: ({ highlighter, options, packageManager }) => {
		const steps = [
			`Run ${highlighter.command(`${packageManager} run db:push`)} to update your database schema`
		];
		if (options.demo) {
			steps.push(`Visit ${highlighter.route('/demo/lucia')} route to view the demo`);
		}

		return steps;
	}
});

function createLuciaType(name: string): AstTypes.TSInterfaceBody['body'][number] {
	return {
		type: 'TSPropertySignature',
		key: {
			type: 'Identifier',
			name
		},
		typeAnnotation: {
			type: 'TSTypeAnnotation',
			typeAnnotation: {
				type: 'TSIndexedAccessType',
				objectType: {
					type: 'TSTypeReference',
					typeName: {
						type: 'Identifier',
						name: 'SessionValidationResult'
					}
				},
				indexType: {
					type: 'TSLiteralType',
					literal: {
						type: 'StringLiteral',
						value: name
					}
				}
			}
		}
	};
}

function getAuthMiddlewareContent() {
	return `
    async (event) => {
      const sessionToken = getCookie(event.nativeEvent, auth.sessionCookieName);
      if (!sessionToken) {
        event.locals.user = null;
        event.locals.session = null;
        return;
      }
      const { session, user } = await auth.validateSessionToken(sessionToken);
      if (session) {
        auth.setSessionTokenCookie(sessionToken, session.expiresAt);
      } else {
        auth.deleteSessionTokenCookie();
      }
      event.locals.user = user;
      event.locals.session = session;
    };`;
}

function getCallExpression(ast: AstTypes.ASTNode): AstTypes.CallExpression | undefined {
	let callExpression;

	// prettier-ignore
	Walker.walk(ast, {}, {
		CallExpression(node) {
			callExpression ??= node;
		},
	});

	return callExpression;
}
