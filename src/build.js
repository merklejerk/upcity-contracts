const _ = require('lodash');
const fs = require('mz/fs');
const Preprocessor = require('preprocessor');
const path = require('path');
const process = require('process');
const solc = require('solc');
const minimist = require('minimist');
const project = require('./project');
const util = require('./util');

const ARGS = minimist(process.argv.slice(2),
	{boolean: ['force'], alias: {'force': ['f']}});
const FORCE = !!ARGS.force;
const SOL_FILE_FILTER = f => f.match(/\.sol$/i);

async function getSolidityFiles(root) {
	return util.getTreeFiles(root, {filter: SOL_FILE_FILTER});
}

async function getSolidityFilesHash(root) {
	return util.getTreeHash(root, {filter: SOL_FILE_FILTER});
}

async function generateSource(config) {
	const files = await getSolidityFiles(project.SOL_ROOT);
	const promises = [];
	for (let f of files) {
		promises.push((async () => {
			const before = await fs.readFile(f);
			const after = preprocessCode(before, config.defs);
			const dst = util.transplantFilePath(f,
				project.SOL_ROOT, project.BUILD_SOL_ROOT);
			const dst = getCodeDestinationPath(f);
			return util.writeFilePath(dst, after);
		})());
	}
	return Promise.all(promises);
}

function preprocessCode(input, defs) {
	return new Preprocessor(input).process(defs);
}

class CompilationError extends Error {};
class ImportError extends Error {};

async function compileAll(config) {
	const files = await getSolidityFiles(project.BUILD_SOL_ROOT);
	const inputs = _.zipObject(files,
		await Promise.all(_.map(files, f => fs.readFile(f, 'utf-8'))));
	const findImport = (name) => {
			console.log('resolve', name);
		};
	const output = solc.compile({sources: inputs}, config.optimizer || 0, findImport);
	if (output.errors.length) {
		throw new CompilationError(
			_.map(output.errors, e => e.formattedMessage || e).join('\n'));
	}
	for (let name in output.contracts) {
		const contract = output.contracts[name];
		console.log(contract);
	}
}

async function loadConfig() {
	const json = await fs.readFile(project.BUILD_CONFIG_PATH);
	const config = JSON.parse(json);
	const target = process.env['TARGET'];
	if (!target) {
		for (let target in config) {
			if (config[target].default)
				return config[target];
		}
		throw new Error('Unable to find default build target.');
	}
	if (!(target in config))
		throw new Error(`Build target "${target}" not found in build configuration.`);
	return config[target];
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

(async function() {
	try {
		const config = await loadConfig();
		const cached = await loadCache();
		const inHash = await getSolidityFilesHash(project.SOL_ROOT);
		if (FORCE || !cached || cached.inHash != inHash) {
			await util.wipe(project.BUILD_SOL_ROOT);
			await generateSource(config);
		}
		const outHash = await getSolidityFilesHash(project.BUILD_SOL_ROOT);
		if (FORCE || !cached || cached.outHash != outHash) {
			await util.wipe(project.BUILD_OUTPUT_ROOT);
			await compileAll(config);
		}
		await writeCache({inHash: hash, outHash: outHash});
	} catch (err) {
		console.error(err);
		process.exitCode = -1;
	}
})();
