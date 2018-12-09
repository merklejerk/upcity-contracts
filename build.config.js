'use strict'

const _ = require('lodash');
const CONSTANTS = require('./constants');
const SOURCE_UNITS = [
	'UpcityMarket.sol',
	'UpcityGame.sol',
	'UpcityResourceToken.sol'
];

module.exports = {
	"test": {
		units: [...SOURCE_UNITS, 'test/*.sol'],
		defs:  _.assign({}, CONSTANTS, {"TEST": 1})
	},
	"release": {
		units: SOURCE_UNITS,
		default: true,
		defs: CONSTANTS,
		optimizer: 200
	}
};
