'use strict'
const _ = require('lodash');
const fse = require('fs-extra');
const project = require('./project');
const util = require('./util');

(async function() {
	try {
		await util.wipe(project.BUILD_SOL_ROOT);
		await util.wipe(project.BUILD_OUTPUT_ROOT);
		await fse.remove(project.CACHE_PATH)
	} catch (err) {
		console.error(err);
		process.exitCode = -1;
	}
})();
