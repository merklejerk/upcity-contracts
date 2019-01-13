'use strict'
require('colors');
const _ = require('lodash');
const bn = require('bn-str-256');
const fs = require('mz/fs');
const path = require('path');
const constants = require('./constants.js');
const TOKEN_RESERVE = 1e3;
const MARKET_DEPOSIT = 0.1;
const CONNECTOR_WEIGHT = 0.66;
const RESOURCE_NAMES = constants.RESOURCE_NAMES;
const RESOURCE_SYMBOLS = constants.RESOURCE_SYMBOLS;

let config = {
	"ropsten": {
		network: 'ropsten',
		deployer: deploy,
		gasPrice: 10e9,
		authorities: ['0x2621ea417659Ad69bAE66af05ebE5788E533E5e7']
	},
	"main": {
		deployer: deploy,
		authorities: ['merklejerk.eth'],
	},
	"localhost": {
		deployer: deploy,
		authorities: ['0x2621ea417659Ad69bAE66af05ebE5788E533E5e7'],
		confirmations: 0
	}
};

// Fold in secrets to each config target (if it exists).
try {
	const secrets = JSON.parse(
		fs.readFileSync(path.resolve(__dirname, 'secrets.json')));
	config = _.mapValues(config, target => _.assign(target, secrets))
} catch (err) {
	if (err.code != 'ENOENT')
		throw err;
}
module.exports = config;

async function deploy({contracts, target, config}) {
	const confirmations = _.get(config, 'confirmations', 2);
	const {
		UpcityMarket: market,
		UpcityGame: game,
		UpcityResourceToken} = contracts;
	// Deploy the market and game.
	const cw = bn.int(bn.mul(constants.PRECISION, CONNECTOR_WEIGHT));
	console.log('Deploying market...');
	await market.new(cw).confirmed(confirmations);
	console.log(`\tDeployed to: ${market.address.blue.bold}`);
	console.log('Deploying game...');
	await game.new().confirmed(confirmations);
	console.log(`\tDeployed to: ${game.address.blue.bold}`);
	// Deploy and init the tokens.
	const tokenAuthorities = [
		game.address,
		market.address
	];
	// Deploy the tokens.
	const tokens = [];
	for (let [name, symbol] of _.zip(RESOURCE_NAMES, RESOURCE_SYMBOLS)) {
		console.log(`Deploying resource token "${name}"...`);
		const token = UpcityResourceToken.clone();
		await token.new(name, symbol, TOKEN_RESERVE, tokenAuthorities)
			.confirmed(confirmations);
		console.log(`\tDeployed to: ${token.address.blue.bold}`);
		tokens.push(token);
	}
	// Init the market.
	const tokenAddresses = _.map(tokens, t => t.address);
	console.log('Initializing the market...');
	await market.init(
		tokenAddresses,
		{value: bn.mul(MARKET_DEPOSIT, '1e18')}).confirmed(confirmations);
	// Init the game.
	console.log('Initializing the game...');
	await game.init(
		tokenAddresses,
		market.address,
		config.authorities[0],
		config.authorities).confirmed(confirmations);
	console.log('All done.')
}
