'use strict'
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
	const {UpcityMarket: market, UpCityGame: game, UpcityResourceToken} = contracts;
	// Deploy the market and game.
	const cw = bn.int(bn.mul(constants.PRECISION, CONNECTOR_WEIGHT));
	await market.new(cw);
	await game.new();
	// Deploy and init the tokens.
	const tokenAuthorities = [
		game.address,
		market.address
	];
	// Deploy the tokens.
	const tokens = [];
	for (let [name, symbol] of _.zip(RESOURCE_NAMES, RESOURCE_SYMBOLS)) {
		const token = UpcityResourceToken.clone()
		await token.new(name, symbol, TOKEN_RESERVE, tokenAuthorities);
		tokens.push(token);
	}
	// Init the market.
	const tokenAddresses = _.map(tokens, t => t.address);
	await market.init(tokenAddresses, {value: bn.mul(MARKET_DEPOSIT, '1e18')})
	// Init the game.
	await game.init(
		tokenAddresses,
		market.address,
		GENESIS_PLAYER,
		GAME_AUTHORITIES);
}

const config = {
	"ropsten": {
		network: 'ropsten',
		deployer: deploy
	}
};

module.exports = _.mapValues(config, target => _.assign(target, secrets))
