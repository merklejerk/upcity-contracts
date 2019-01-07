'use strict'

const _ = require('lodash');
const SECRETS = require('./secrets.json');

async function deploy({contracts}) {

}

module.exports = {
	"ropsten": {
		seed: SECRETS.seed,
		network: 'ropsten',
		deployer: deploy
	}
};
