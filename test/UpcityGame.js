'use strict'
const _ = require('lodash');
const assert = require('assert');
const bn = require('bn-str-256');
const testbed = require('../src/testbed');
const constants = require('../constants.js');
const ERRORS = require('./lib/errors.js');

const {MAX_UINT, ONE_TOKEN, ZERO_ADDRESS} = testbed;
const {
	ONITE_BLOCK,
	TOPITE_BLOCK,
	RUBITE_BLOCK,
	MAX_HEIGHT,
	NUM_RESOURCES } = constants;
const BLOCKS = [ONITE_BLOCK, TOPITE_BLOCK, RUBITE_BLOCK];
const BLOCK_NAMES = ['Onite', 'Topite', 'Rubite'];
const RESERVE = ONE_TOKEN;
const MARKET_DEPOSIT = bn.mul(0.1, ONE_TOKEN);
const CONNECTOR_WEIGHT = Math.round(1e6 * constants.CONNECTOR_WEIGHT);
const NEIGHBOR_OFFSETS = [[1,0], [1,-1], [0,-1], [-1,0], [-1,1], [0,1]];
const CONTRACTS = [
	'UpcityResourceToken', 'UpcityMarket', 'UpcityGame', 'GasGuzzler'
];

function decodeBlocks(encoded) {
	const hex = bn.toHex(encoded, MAX_HEIGHT*2).substr(2);
	return _.filter(
		_.times(MAX_HEIGHT, i => parseInt(hex.substr(-(i+1)*2, 2), 16)),
		b => b != 255);
}

function encodeBlocks(blocks) {
	assert(blocks.length <= MAX_HEIGHT);
	const slots = [];
	for (let i = 0; i < MAX_HEIGHT; i++)
		slots.push(i < blocks.length ? blocks[i]: 255);
	return '0x'+_.map(_.reverse(slots),
		n => bn.toHex(n, 2).substr(2)).join('');
}

function unpackDescription(r) {
	return {
		id: r[0],
		x: bn.toNumber(r[1]),
		y: bn.toNumber(r[2]),
		timesBought: bn.toNumber(r[3]),
		lastTouchTime: bn.toNumber(r[4]),
		owner: r[5],
		blocks: decodeBlocks(r[6]),
		price: bn.parse(r[7])
	};
}

describe(/([^/\\]+?)(\..*)?$/.exec(__filename)[1], function() {

	async function describeTileAt(x, y) {
		return unpackDescription(await this.game.describeTileAt(x, y));
	}

	async function grantTokens(whom, tokens) {
		assert(_.isArray(tokens) && tokens.length == NUM_RESOURCES);
		for (let res = 0; res < tokens.length; res++)
			await this.tokens[res].mint(whom, tokens[res]);
	}

	before(async function() {
		_.assign(this, await testbed({
			contracts: CONTRACTS}));
		this.authority = this.accounts[0];
		this.genesisPlayer = this.accounts[1];
		this.users = _.slice(this.accounts, 2);
		this.market = this.contracts['UpcityMarket'];
		this.game = this.contracts['UpcityGame'];
		describeTileAt = _.bind(describeTileAt, this);
		grantTokens = _.bind(grantTokens, this);
	});

	beforeEach(async function() {
		await this.market.new(CONNECTOR_WEIGHT);
		const tx = await this.game.new();
		this.tokens = [];
		for (let name of BLOCK_NAMES) {
			const symbol = _.upperCase(name.substr(0, 3));
			const token = this.contracts['UpcityResourceToken'].clone();
			await token.new(
				name, name.substr(0, 3),
				RESERVE);
			await token.init([
				this.game.address, this.market.address, this.accounts[0]]);
			this.tokens.push(token);
		}
		const tokens = _.map(this.tokens, t => t.address);
		await this.market.init(tokens, {value: MARKET_DEPOSIT});
		await this.game.init(tokens, this.market.address,
			[this.authority], this.genesisPlayer);
	});

	it('genesis owner owns genesis tile', async function() {
		const tile = await describeTileAt(0, 0);
		assert.equal(tile.owner, this.genesisPlayer);
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
			{from: buyer, value: bn.sub(tile.price, 1)}),
			ERRORS.INSUFFICIENT);
	});

	it('cannot buy a tile you already own', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		let tile = await describeTileAt(0, 0);
		await this.game.buyTile(0, 0,
			{from: buyer, value: tile.price});
		tile = await describeTileAt(0, 0);
		await assert.rejects(this.game.buyTile(0, 0,
			{from: buyer, value: tile.price}),
			ERRORS.ALREADY);
	});

	it('cannot buy a tile that doesn\'t exist', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		// Just send a lot of ether since we can't get the price.
		await assert.rejects(this.game.buyTile(100, 100,
			{from: buyer, value: bn.mul(10, ONE_TOKEN)}),
			ERRORS.INVALID);
	});

	it('cannot describe a tile that doesn\'t exist', async function() {
		await assert.rejects(describeTileAt(100, 100), ERRORS.INVALID);
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

	it('buying a tile increases its price', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		const {price} = await describeTileAt(0, 0);
		await this.game.buyTile(0, 0, {from: buyer, value: price});
		const {price: newPrice} = await describeTileAt(0, 0);
		assert(bn.gt(newPrice, price));
	});

	it('buying a tile increases its neighbors\' price', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		const {price} = await describeTileAt(0, 0);
		const oldNeighborPrices = _.map(
			await Promise.all(_.map(NEIGHBOR_OFFSETS,
				([ox, oy]) => describeTileAt(ox, oy))),
			t => t.price);
		await this.game.buyTile(0, 0, {from: buyer,value: price});
		const newNeighborPrices = _.map(
			await Promise.all(_.map(NEIGHBOR_OFFSETS,
				([ox, oy]) => describeTileAt(ox, oy))),
			t => t.price);
		for (let [oldPrice, newPrice] of
				_.zip(oldNeighborPrices, newNeighborPrices)) {
			assert(bn.gt(newPrice, oldPrice));
		}
	});

	it('buying a tile with > price refunds difference', async function() {
		const [player] = _.sampleSize(this.users, 1);
		const tile = await describeTileAt(0, 0);
		const prevBalance = await this.eth.getBalance(player);
		const payment = bn.add(tile.price, ONE_TOKEN);
		const tx = await this.game.buyTile(0, 0,
			{from: player, value: payment, gasPrice: 1});
		const predicted = bn.sub(bn.sub(prevBalance, tx.gasUsed), tile.price);
		const balance = await this.eth.getBalance(player);
		assert.equal(balance, predicted);
	});

	it('can get the build cost for building blocks on an empty tile', async function() {
		const player = this.genesisPlayer;
		const [x, y] = [0, 0];
		const numBlocks = _.random(1, MAX_HEIGHT);
		const blocks = encodeBlocks(_.times(numBlocks, i => _.sample(BLOCKS)));
		const cost = await this.game.getBuildCost(x, y, blocks);
		for (let amount of cost)
			assert(bn.gt(amount, 0));
	});

	it('can build blocks on own tile', async function() {
		const player = this.genesisPlayer;
		const [x, y] = [0, 0];
		const numBlocks = _.random(1, MAX_HEIGHT);
		const blocks = _.times(numBlocks, i => _.sample(BLOCKS));
		const cost = await this.game.getBuildCost(x, y, encodeBlocks(blocks));
		await grantTokens(player, cost);
		const tx = await this.game.buildBlocks(x, y,  encodeBlocks(blocks),
			{from: player});
		assert(tx.findEvent('Built'));
		const {blocks: built} = await describeTileAt(x, y);
		assert.deepEqual(built, blocks);
	});

	it('can build complete tower at once', async function() {
		const player = this.genesisPlayer;
		const [x, y] = [0, 0];
		const blocks = _.times(MAX_HEIGHT, i => _.sample(BLOCKS));
		const cost = await this.game.getBuildCost(x, y, encodeBlocks(blocks));
		await grantTokens(player, cost);
		const tx = await this.game.buildBlocks(x, y,  encodeBlocks(blocks),
			{from: player});
		assert(tx.findEvent('Built'));
		const {blocks: built} = await describeTileAt(x, y);
		assert.deepEqual(built, blocks);
	});

	it('can build on top of other blocks', async function() {
		const player = this.genesisPlayer;
		const [x, y] = [0, 0];
		const blocks = _.times(_.random(1, MAX_HEIGHT-1),
			i => _.sample(BLOCKS));
		let cost = await this.game.getBuildCost(x, y, blocks);
		await grantTokens(player, cost);
		await this.game.buildBlocks(x, y,  encodeBlocks(blocks),
			{from: player});
		const newBlocks = _.times(MAX_HEIGHT - blocks.length,
			i => _.sample(blocks));
		cost = await this.game.getBuildCost(x, y, encodeBlocks(newBlocks));
		await grantTokens(player, cost);
		await this.game.buildBlocks(x, y, encodeBlocks(newBlocks),
			{from: player});
		const {blocks: built} = await describeTileAt(x, y);
		assert.deepEqual(built, [...blocks, ...newBlocks]);
	});

	it('building ignores malformed blocks', async function() {
		const player = this.genesisPlayer;
		const [x, y] = [0, 0];
		// Encoding of [0, 1, 2, NIL, 0, 1, 2]
		// Only the first three blocks should be built.
		const encoded = '0xffffffffffffffffff020100ff020100'
		const cost = await this.game.getBuildCost(x, y, encoded);
		await grantTokens(player, cost);
		const tx = await this.game.buildBlocks(x, y,  encoded,
			{from: player});
		assert(tx.findEvent('Built'));
		const {blocks: built} = await describeTileAt(x, y);
		assert.deepEqual(built, [0, 1, 2]);
	});

	it('cannot build on a complete tower', async function() {
		const player = this.genesisPlayer;
		const [x, y] = [0, 0];
		let blocks = _.times(MAX_HEIGHT, i => _.sample(BLOCKS));
		let cost = await this.game.getBuildCost(x, y, encodeBlocks(blocks));
		// We need to allocate more resources for the next build since we can't
		// get block costs on a complete tower.
		await grantTokens(player, _.map(cost, c => bn.mul(c, 100)));
		await this.game.buildBlocks(x, y, encodeBlocks(blocks),
			{from: player});
		blocks = [_.sample(BLOCKS)];
		// Just allocate enough resources since getBuildCost() will revert.
		await assert.rejects(
			this.game.buildBlocks(x, y, encodeBlocks(blocks), {from: player}),
			ERRORS.MAX_HEIGHT);
	});

	it('cannot build beyond max height', async function() {
		const player = this.genesisPlayer;
		const [x, y] = [0, 0];
		let blocks = _.times(_.random(0, MAX_HEIGHT-1), i => _.sample(BLOCKS));
		let cost = await this.game.getBuildCost(x, y, encodeBlocks(blocks));
		// We need to allocate more resources for the next build since we can't
		// get block costs on a complete tower.
		await grantTokens(player, _.map(cost, c => bn.mul(c, 100)));
		await this.game.buildBlocks(x, y, encodeBlocks(blocks),
			{from: player});
		blocks = _.times(MAX_HEIGHT - blocks.length + 1, i => _.sample(BLOCKS));
		await assert.rejects(
			this.game.buildBlocks(x, y, encodeBlocks(blocks), {from: player}),
			ERRORS.MAX_HEIGHT);
	});

	it('cannot build on a tile owned by someone else', async function() {
		const [builder] = _.sampleSize(this.users, 1);
		const blocks = encodeBlocks([ONITE_BLOCK]);
		await assert.rejects(this.game.buildBlocks(0, 0, blocks),
			ERRORS.NOT_ALLOWED);
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
