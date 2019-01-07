'use strict'
const _ = require('lodash');
const path = require('path');
const fs = require('mz/fs');
const util = require('./util');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const BUILD_ROOT = path.resolve(PROJECT_ROOT, 'build');
const SOL_ROOT = path.resolve(PROJECT_ROOT, 'sol');
const BUILD_CONFIG_PATH = path.resolve(PROJECT_ROOT, 'build.config.js');
const DEPLOY_CONFIG_PATH = path.resolve(PROJECT_ROOT, 'deploy.config.js');
const CACHE_PATH = path.resolve(BUILD_ROOT, 'cache.json');
const BUILD_SOL_ROOT = path.resolve(BUILD_ROOT, 'src');
const BUILD_OUTPUT_ROOT = path.resolve(BUILD_ROOT, 'artifacts');

async function getArtifact(name) {
	const f = path.resolve(BUILD_OUTPUT_ROOT, `${name}.json`);
	return JSON.parse(await fs.readFile(f, 'utf-8'));
}

async function getArtifacts(names) {
	const artifacts = await Promise.all(_.map(names, n => getArtifact(n)));
	return _.zipObject(names, artifacts);
}

async function getAllArtifacts() {
	const files = await util.glob('*.json', BUILD_OUTPUT_ROOT);
	const names = _.map(files, f => path.basename(f, '.json'));
	return getArtifacts(names);
}

module.exports = {
	PROJECT_ROOT: PROJECT_ROOT,
	BUILD_ROOT: BUILD_ROOT,
	SOL_ROOT: SOL_ROOT,
	BUILD_CONFIG_PATH: BUILD_CONFIG_PATH,
	DEPLOY_CONFIG_PATH: DEPLOY_CONFIG_PATH,
	CACHE_PATH: CACHE_PATH,
	BUILD_SOL_ROOT: BUILD_SOL_ROOT,
	BUILD_OUTPUT_ROOT: BUILD_OUTPUT_ROOT,
	getArtifact: getArtifact,
	getArtifacts: getArtifacts,
	getAllArtifacts: getAllArtifacts
};
