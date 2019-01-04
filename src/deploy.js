const _ = require('lodash');
const bn = require('bn-str-256');
const path = require('path');

const ARGS = minimist(process.argv.slice(2), {
	alias: {'seed': ['s']},
	string: ['seed', 'key']
});
