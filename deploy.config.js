'use strict'

const _ = require('lodash');
const SECRETS = require('./secrets.json');

async function deploy({contracts, target}) {
	console.log(_.keys(contracts), target);
}

module.exports = {
	"ropsten": {
		mnemonic: SECRETS.mnemonic,
		keystore: SECRETS.keystore,
		password: SECRETS.password,
		accountIndex: SECRETS.accountIndex,
		key: SECRETS.key,
		network: 'ropsten',
		deployer: deploy
	}
};
