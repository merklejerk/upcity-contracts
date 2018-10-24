const _ = require('lodash');
const path = require('path');
const fs = require('mz/fs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const BUILD_ROOT = path.resolve(PROJECT_ROOT, 'build');
const SOL_ROOT = path.resolve(PROJECT_ROOT, 'sol');

module.exports = {
	PROJECT_ROOT: PROJECT_ROOT,
	BUILD_ROOT: BUILD_ROOT,
	SOL_ROOT: SOL_ROOT
};
