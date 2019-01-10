'use strict'
require('colors');
const _ = require('lodash');
const bn = require('bn-str-256');
const secrets = require('./secrets.json');
const constants = require('./constants.js');
const GENESIS_PLAYER = '0x2621ea417659Ad69bAE66af05ebE5788E533E5e7';
const GAME_AUTHORITIES = ['0x2621ea417659Ad69bAE66af05ebE5788E533E5e7'];
const TOKEN_RESERVE = 1e3;
const MARKET_DEPOSIT = 0.1;
const CONNECTOR_WEIGHT = 0.66;
const RESOURCE_NAMES = constants.RESOURCE_NAMES;
const RESOURCE_SYMBOLS = constants.RESOURCE_SYMBOLS;

async function deploy({contracts, target}) {
	const {
		UpcityMarket: market,
		UpcityGame: game,
		UpcityResourceToken} = contracts;
	// Deploy the market and game.
	const cw = bn.int(bn.mul(constants.PRECISION, CONNECTOR_WEIGHT));
	console.log('Deploying market...');
	await market.new(cw).confirmed(3);
	console.log(`\tDeployed to: ${market.address.blue.bold}`);
	console.log('Deploying game...');
	await game.new().confirmed(3);
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
		await token.new(name, symbol, TOKEN_RESERVE, tokenAuthorities).confirmed(3);
		console.log(`\tDeployed to: ${token.address.blue.bold}`);
		tokens.push(token);
	}
	// Init the market.
	const tokenAddresses = _.map(tokens, t => t.address);
	console.log('Initializing the market...');
	await market.init(
		tokenAddresses,
		{value: bn.mul(MARKET_DEPOSIT, '1e18')}).confirmed(3);
	// Init the game.
	console.log('Initializing the game...');
	await game.init(
		tokenAddresses,
		market.address,
		GENESIS_PLAYER,
		GAME_AUTHORITIES).confirmed(3);
	console.log('All done.')
}

const config = {
	"ropsten": {
		network: 'ropsten',
		deployer: deploy,
		gasPrice: 2e9
	}
};

module.exports = _.mapValues(config, target => _.assign(target, secrets))
