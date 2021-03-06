'use strict'
require('colors');
const _ = require('lodash');
const bn = require('bn-str-256');
const fs = require('mz/fs');
const path = require('path');
const constants = require('./constants.js');
const TOKEN_RESERVE = 128;
const MARKET_DEPOSIT = 20/120;
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
		UpcityResourceTokenProxy} = contracts;
	// Deploy the game and market.
	console.log('Deploying game...');
	await game.new().confirmed(confirmations);
	console.log(`\tDeployed to: ${game.address.blue.bold}`);
	console.log('Deploying market...');
	await market.new().confirmed(confirmations);
	console.log(`\tDeployed to: ${market.address.blue.bold}`);
	// Deploy the tokens.
	const tokens = [];
	for (const [name, symbol] of _.zip(RESOURCE_NAMES, RESOURCE_SYMBOLS)) {
		console.log(`Deploying resource token "${name}"...`);
		const token = UpcityResourceTokenProxy.clone();
		await token.new(
				name,
				symbol,
				market.address)
			.confirmed(confirmations);
		console.log(`\tDeployed to: ${token.address.blue.bold}`);
		tokens.push(token);
	}
	// Initialize the market.
	console.log('Initializing the market...');
	await market.init(
			bn.mul(TOKEN_RESERVE, '1e18'),
			_.map(tokens, t => t.address),
			[game.address],
			{value: bn.mul(MARKET_DEPOSIT, '1e18')})
		.confirmed(confirmations);
	// Init the game.
	console.log('Initializing the game...');
	await game.init(
			market.address,
			config.authorities[0],
			config.authorities)
		.confirmed(confirmations);
	console.log('All done.')
}
