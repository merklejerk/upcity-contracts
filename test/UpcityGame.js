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

function unpackDescription(r) {
	return {
		id: r[0],
		x: bn.toNumber(r[1]),
		y: bn.toNumber(r[2]),
		timesBought: bn.toNumber(r[3]),
		owner: r[4],
		blocks: r[5],
		price: bn.parse(r[6])
	};
}

describe(/([^/\\]+?)(\..*)?$/.exec(__filename)[1], function() {

	async function describeTileAt(x, y) {
		return unpackDescription(await this.game.describeTileAt(x, y));
	}

	before(async function() {
		_.assign(this, await testbed({
			contracts: ['UpcityResourceToken', 'UpcityMarket', 'UpcityGame']}));
		this.users = _.slice(this.accounts, 1);
		[this.authority, this.genesisUser] = _.sampleSize(this.users, 2);
		this.users = _.without(this.users, this.authority, this.genesisUser);
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
		describeTileAt = _.bind(describeTileAt, this);
	});


	it('genesis owner owns genesis tile', async function() {
		const tile = await describeTileAt(0, 0);
		assert.equal(tile.owner, this.genesisUser);
	});

	it('genesis tile has a price', async function() {
		const tile = await describeTileAt(0, 0);
		assert(bn.gt(tile.price, 0));
	});

	it('can buy owned tile', async function() {
		const [player] = _.sampleSize(this.users, 1);
		let tile = await describeTileAt(0, 0);
		const tx = await this.game.buyTile(0, 0,
			{from: player, value: tile.price});
		tile = await describeTileAt(0, 0);
		assert.equal(tile.owner, player);
	});

	it('buying a tile with > price refunds difference', async function() {
		const [player] = _.sampleSize(this.users, 1);
		let tile = await describeTileAt(0, 0);
		const prevBalance = await this.eth.getBalance(player);
		const payment = bn.add(tile.price, ONE_TOKEN);
		const tx = await this.game.buyTile(0, 0,
			{from: player, value: payment, gasPrice: 1});
		const predicted = bn.sub(bn.sub(prevBalance, tx.gasUsed), tile.price);
		const balance = await this.eth.getBalance(player);
		assert.equal(balance, predicted);
	});

	it('buying edge tile increases funds collected', async function() {
		const [player] = _.sampleSize(this.users, 1);
		let tile = await describeTileAt(0, 0);
		const tx = await this.game.buyTile(0, 0,
			{from: player, value: tile.price});
		const funds = await this.game.fundsCollected();
		assert(bn.gt(funds, 0));
	});

});
