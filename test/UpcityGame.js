'use strict'
const _ = require('lodash');
const assert = require('assert');
const bn = require('bn-str-256');
const testbed = require('../src/testbed');

const {MAX_UINT, ONE_TOKEN, ZERO_ADDRESS} = testbed;
const RESERVE = ONE_TOKEN;
const MARKET_DEPOSIT = bn.mul(0.1, ONE_TOKEN);
const CONNECTOR_WEIGHT = Math.round(1e6 * 0.33);
const NUM_RESOURCES = 3;

describe(/([^/\\]+?)(\..*)?$/.exec(__filename)[1], function() {
	before(async function() {
		_.assign(this, await testbed({
			contracts: ['UpcityResourceToken', 'UpcityMarket', 'UpcityGame']}));
		this.users = _.slice(this.accounts, 1);
		this.authority = _.sample(this.users);
		this.users = _.without(this.users, this.authority);
		this.genesisUser = this.users[0];
		this.market = this.contracts['UpcityMarket'];
		this.game = this.contracts['UpcityGame'];
	});

	beforeEach(async function() {
		await this.market.new(CONNECTOR_WEIGHT);
		this.tokens = [];
		for (let i = 0; i < NUM_RESOURCES; i++) {
			const token = this.contracts['UpcityResourceToken'].clone();
			await token.new(
				`Token-${i}`, `TTK${i}`, RESERVE,
				[this.market.address, this.accounts[0]]);
			this.tokens.push(token);
		}
		await this.market.init(
			_.map(this.tokens, t => t.address),
			{value: MARKET_DEPOSIT});
		const tx = await this.game.new(
			_.map(this.tokens, t => t.address),
			this.market.address,
			[this.authority],
			{gasBonus: 0.25}
		);
		await this.game.init(this.genesisUser, {from: this.authority});
	});

	it('TODO', async function() {
	});
});
