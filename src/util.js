'use strict'
const _ = require('lodash');
const fs = require('mz/fs');
const fse = require('fs-extra');
const process = require('process');
const path = require('path');
const promisify = require('util').promisify;
const mkdirp = promisify(require('mkdirp'));
const crypto = require('crypto');
const _glob = promisify(require('glob').glob);

async function glob(names, cwd) {
	cwd = cwd || process.cwd();
	if (!_.isArray(names))
		names = [names];
	return _.flatten(
		await Promise.all(_.map(names, f => _glob(f, {cwd: cwd}))));
}

async function hashFiles(files) {
	const hash = crypto.createHash('sha256');
	for (let f of files)
		hash.update(await fs.readFile(f), 'utf-8');
	return hash.digest('hex');
}

function hashString(str) {
	const hash = crypto.createHash('sha256');
	hash.update(str);
	return hash.digest('hex');
}

async function getTreeHash(root, opts={}) {
	const files = await getTreeFiles(root, {filter: opts.filter});
	const hash = crypto.createHash('sha256');
	for (let f of files)
		hash.update(await fs.readFile(f), 'utf-8');
	return hash.digest('hex');
}

async function getTreeFiles(root, opts={}) {
	const recursed = !!opts.files;
	const files = opts.files || {};
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

async function wipe(root, opts={}) {
	const filter = opts.filter;
	root = path.resolve(root);
	try {
		let contents = _.map(await fs.readdir(root), f => path.resolve(root, f));
		const trash = [];
		for (let f of contents) {
			if (filter && !filter(f))
				continue;
			const st = await fs.stat(f);
			if (st.isDirectory())
				await wipe(f, opts);
			else
				await fs.unlink(f);
		}
		if ((await fs.readdir(root)).length == 0)
			fs.rmdir(root);
	} catch (err) {
		if (err.code == 'ENOENT')
			return;
		throw err;
	}
}

async function wipeExcept(root, files) {
	return wipe(root, {filter: f => !_.includes(files, f)});
}

module.exports = {
	hashFiles: hashFiles,
	getTreeHash: getTreeHash,
	getTreeFiles: getTreeFiles,
	hashString: hashString,
	transplantFilePath: transplantFilePath,
	writeFilePath: writeFilePath,
	wipe: wipe,
	wipeExcept: wipeExcept,
	glob: glob
};
