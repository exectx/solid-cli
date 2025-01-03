import fs from 'node:fs';
import path from 'node:path';
import { create } from '../dist/index.js';

const repo = /** @type {string} */ (process.argv[2]);

fs.readdirSync(repo).forEach((file) => {
	if (file !== '.git') {
		fs.rmSync(path.join(repo, file), {
			recursive: true,
			force: true
		});
	}
});

create(repo, {
	name: 'kit-template-default',
	template: 'demo',
	types: 'checkjs'
});

// Remove the Sverdle from the template because it doesn't work within Stackblitz (cookies not set)
fs.rmSync(path.join(repo, 'src', 'routes', 'sverdle'), { force: true, recursive: true });

const header_file = path.join(repo, 'src', 'routes', 'Header.svelte');
const header = fs.readFileSync(header_file, 'utf-8');
fs.writeFileSync(
	header_file,
	// Remove the Sverdle link from the header
	header.replace(/<\/li>\s+<li.+?'\/sverdle'[\s\S]+?<\/li>/, '</li>')
);

const about_file = path.join(repo, 'src', 'routes', 'about', '+page.svelte');
const about = fs.readFileSync(about_file, 'utf-8');
fs.writeFileSync(
	about_file,
	// Remove the Sverdle paragraph from the about page
	about.replace(/<\/p>\s+<p>\s+?[\s\S]+?Sverdle[\s\S]+?<\/p>/, '</p>')
);
