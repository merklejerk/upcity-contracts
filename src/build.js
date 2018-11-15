const _ = require('lodash');
const fs = require('mz/fs');
const path = require('path');
const process = require('process');
const solc = require('solc');
const minimist = require('minimist');
const project = require('./project');
const util = require('./util');
const solpp = require('solpp');

const ARGS = minimist(process.argv.slice(2),
	{boolean: ['force'], alias: {'force': ['f']}, string: ['target']});
const FORCE = !!ARGS.force;

async function generateSourceUnits(config) {
	const files = config.units;
	const promises = [];
	for (let f of files) {
		promises.push((async () => {
			let code = await fs.readFile(f, 'utf-8');
			try {
				code = await solpp.processCode(code, {
					name: f,
					cwd: path.dirname(f),
					defs: config.defs
				});
			} catch (err) {
				console.error(`Failed to preprocess file "${f}": ${err.message}`);
				throw err;
			}
			const dst = util.transplantFilePath(f,
				project.SOL_ROOT, project.BUILD_SOL_ROOT);
			return util.writeFilePath(dst, code);
		})());
	}
	return Promise.all(promises);
}

async function getSolidityFiles(root) {
	return util.getTreeFiles(root, {filter: f => /\.sol$/.test(f)});
}

class CompilationError extends Error {};

async function compileAll(config) {
	const files = await getSolidityFiles(project.BUILD_SOL_ROOT);
	console.log(`Compiling: ${files.join(', ')}...`);
	const inputs = _.zipObject(files,
		await Promise.all(_.map(files, f => fs.readFile(f, 'utf-8'))));
	const output = solc.compile({sources: inputs}, config.optimizer || 0);
	if (output.errors && output.errors.length) {
		throw new CompilationError(
			_.map(output.errors, e => e.formattedMessage || e).join('\n'));
	}
	const targets = _.map(files, f => path.basename(f, '.sol'));
	const contracts = {};
	for (let name in output.contracts) {
		const m = (/\:([a-z_][a-z0-9]+)$/i).exec(name);
		if (m && _.includes(targets, m[1]))
			contracts[m[1]] = output.contracts[name];
	}
	return _.mapValues(contracts, c => {
		c.interface = JSON.parse(c.interface);
		return c;
	});
}

async function writeArtifacts(contracts) {
	return Promise.all(_.map(contracts,
		(v,k) => util.writeFilePath(
			path.resolve(project.BUILD_OUTPUT_ROOT, k + '.json'),
			JSON.stringify(v))));
}

async function loadConfig() {
	const config = require(project.BUILD_CONFIG_PATH);
	let target = ARGS['target'] || process.env['TARGET'];
	if (!target) {
		for (let name in config) {
			if (config[name].default)
				target = name;
		}
	}
	if (!target || !(target in config))
		throw new Error(`Build target "${target}" not found in build configuration.`);
	const subConfig = config[target];
	// Resolve all config paths.
	subConfig.units = _.map(subConfig.units,
		f => path.resolve(project.SOL_ROOT, f));
	return subConfig;
}

async function loadCache() {
	try {
		const json = await fs.readFile(project.CACHE_PATH);
		return JSON.parse(json);
	} catch (err) {
		return null;
	}
}

async function writeCache(data) {
	await fs.writeFile(project.CACHE_PATH, JSON.stringify(data));
}

async function wipeGeneratedSource(config) {
	const except = _.map(config.units,
		f => util.transplantFilePath(f, project.SOL_ROOT,
			project.BUILD_SOL_ROOT, f));
	await util.wipeExcept(project.BUILD_SOL_ROOT, except);
}

(async function() {
	try {
		const config = await loadConfig();
		const cached = await loadCache();
		const inHash = await util.hashFiles(config.units);
		let units = [];
		if (FORCE || !cached || cached.inHash != inHash) {
			await wipeGeneratedSource(config);
			units = await generateSourceUnits(config);
		}
		const outHash = await util.getTreeHash(project.BUILD_SOL_ROOT);
		if (FORCE || !cached || cached.outHash != outHash) {
			await util.wipe(project.BUILD_OUTPUT_ROOT);
			const contracts = await compileAll(config);
			await writeArtifacts(contracts);
		}
		await writeCache({inHash: inHash, outHash: outHash});
	} catch (err) {
		console.error(err);
		process.exitCode = -1;
	}
})();
