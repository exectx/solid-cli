import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { setupTest } from '../_setup/suite.ts';
import { svxFile } from './fixtures.ts';
import mdsvex from '../../mdsvex/index.ts';

const { test, variants, prepareServer } = setupTest({ mdsvex });

test.concurrent.for(variants)('core - %s', async (variant, { page, ...ctx }) => {
	const cwd = await ctx.run(variant, { mdsvex: {} });

	// ...add test files
	addFixture(cwd, variant);

	const { close } = await prepareServer({ cwd, page });
	// kill server process when we're done
	ctx.onTestFinished(async () => await close());

	expect(await page.$('h1')).toBeTruthy();
	expect(await page.$('h2')).toBeTruthy();
	expect(await page.$('p')).toBeTruthy();
});

function addFixture(cwd: string, variant: string) {
	let svx;
	console.log({ test: variant });
	if (variant.startsWith('kit')) {
		svx = path.resolve(cwd, 'src', 'routes', 'demo.mdx');
	} else {
		svx = path.resolve(cwd, 'src', 'demo.mdx');
	}
	fs.writeFileSync(svx, svxFile, 'utf8');
}
