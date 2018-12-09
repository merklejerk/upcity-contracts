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
const CONTRACTS = [
	'UpcityResourceToken', 'UpcityMarket', 'UpcityGame', 'GasGuzzler'
];

function unpackDescription(r) {
	return {
		id: r[0],
		x: bn.toNumber(r[1]),
		y: bn.toNumber(r[2]),
		timesBought: bn.toNumber(r[3]),
		lastTouchTime: bn.toNumber(r[4]),
		owner: r[5],
		blocks: r[6],
		price: bn.parse(r[7])
	};
}

describe(/([^/\\]+?)(\..*)?$/.exec(__filename)[1], function() {

	async function describeTileAt(x, y) {
		return unpackDescription(await this.game.describeTileAt(x, y));
	}

	before(async function() {
		_.assign(this, await testbed({
			contracts: CONTRACTS}));
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

	it('can buy a tile owned by someone else', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		let tile = await describeTileAt(0, 0);
		const tx = await this.game.buyTile(0, 0,
			{from: buyer, value: tile.price});
		assert(!!tx.findEvent('Bought',
			{from: tile.owner, to: buyer, price: tile.price}));
		tile = await describeTileAt(0, 0);
		assert.equal(tile.owner, buyer);
	});

	it('can buy a tile owned by a gas guzzler', async function() {
		let tile = await describeTileAt(0, 0);
		const guzzler = this.contracts['GasGuzzler'].clone();
		await guzzler.new(this.game.address);
		await guzzler.buyTile(0, 0, {value: tile.price});
		const guzzlerBalance = await this.eth.getBalance(guzzler.address);
		tile = await describeTileAt(0, 0);
		const [buyer] = _.sampleSize(this.users, 1);
		const tx = await this.game.buyTile(0, 0,
			{from: buyer, value: tile.price});
		tile = await describeTileAt(0, 0);
		assert.equal(tile.owner, buyer);
		// Guzzler doesn't get paid because his fallback function reverts with OOG.
		assert.equal(await this.eth.getBalance(guzzler.address), guzzlerBalance);
	});

	it('cannot buy a tile with insufficient funds', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		let tile = await describeTileAt(0, 0);
		await assert.rejects(this.game.buyTile(0, 0,
			{from: buyer, value: bn.sub(tile.price, 1)}), {message: /INSUFFICIENT$/});
	});

	it('cannot buy a tile you already own', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		let tile = await describeTileAt(0, 0);
		await this.game.buyTile(0, 0,
			{from: buyer, value: tile.price});
		tile = await describeTileAt(0, 0);
		await assert.rejects(this.game.buyTile(0, 0,
			{from: buyer, value: tile.price}), {message: /ALREADY$/});
	});

	it('cannot buy a tile that doesn\'t exist', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		// Just send a lot of ether since we can't get the price.
		await assert.rejects(this.game.buyTile(100, 100,
			{from: buyer, value: bn.mul(10, ONE_TOKEN)}),
			{message: /INVALID$/});
	});

	it('cannot describe a tile that doesn\'t exist', async function() {
		await assert.rejects(describeTileAt(100, 100), {message: /INVALID$/});
	});

	it('buying a tile pays previous owner', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		let tile = await describeTileAt(0, 0);
		const prevOwner = tile.owner;
		const ownerBalance = await this.eth.getBalance(prevOwner);
		const tx = await this.game.buyTile(0, 0,
			{from: buyer, value: tile.price});
		assert(bn.gt(await this.eth.getBalance(prevOwner), ownerBalance));
	});

	it('buying a tile increases tile\'s price', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		const {price}= await describeTileAt(0, 0);
		await this.game.buyTile(0, 0, {from: buyer, value: price});
		const {price: newPrice} = await describeTileAt(0, 0);
		assert(bn.gt(newPrice, price));
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
