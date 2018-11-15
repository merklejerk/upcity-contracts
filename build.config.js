'use strict'

const SOURCE_UNITS = [
	'UpcityMarket.sol', 'UpcityGame.sol', 'UpcityResourceToken.sol'
];

module.exports = {
	"test": {
		units: SOURCE_UNITS,
		defs:  {"TEST": 1}
	},
	"release": {
		units: SOURCE_UNITS,
		default: true,
		defs: {},
		optimizer: 200
	}
};
