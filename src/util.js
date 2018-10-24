const _ = require('lodash');
const fs = require('mz/fs');
const fse = require('fs-extra');
const path = require('path');
const promisify = require('util').promisify;
const mkdirp = promisify(require('mkdirp'));
const crypto = require('crypto');

async function getTreeHash(root, opts={}) {
	const files = await getTreeFiles(root, {filter: opts.filter});
	const hash = crypto.createHash('sha256');
	for (let f of files)
		hash.update(await fs.readFile(f), 'utf-8');
	return hash.digest('hex');
}

async function getTreeFiles(root, opts={}) {
	const recursed = !!opts.files;
	files = opts.files || {};
	const contents = await fs.readdir(root)
	for (let f of contents) {
		const p = path.resolve(root, f);
		const s = await fs.stat(p);
		if (s.isDirectory()) {
			await getTreeFiles(p, _.assign({}, opts, {files: files}));
		} else if (s.isFile()) {
			if (opts.filter && !opts.filter(p))
				continue;
			files[p] = f;
		}
	}
	if (!recursed)
		return _.keys(files);
}

function transplantFilePath(filepath, srcPrefix, dstPrefix) {
	if (!filepath.startsWith(srcPrefix))
		throw new Error(`Unable to transplant file "${filepath}"`);
	const rel = _.trimStart(filepath.substr(srcPrefix.length), '/\\');
	return path.resolve(dstPrefix, rel);
}

async function writeFilePath(filepath, data, opts) {
	filepath = path.resolve(filepath);
	await mkdirp(path.dirname(filepath));
	return fs.writeFile(filepath, data, opts);
}

async function wipe(root) {
	root = path.resolve(root);
	const contents = _.map(await fs.readdir(root), f => path.resolve(root, f));
	return Promise.all(_.map(contents, f => fse.remove(f)));
}

module.exports = {
	getTreeHash: getTreeHash,
	getTreeFiles: getTreeFiles,
	transplantFilePath: transplantFilePath,
	writeFilePath: writeFilePath,
	wipe: wipe
};
