'use strict'
const _ = require('lodash');
const assert = require('assert');
const bn = require('bn-str-256');
const ethjs = require('ethereumjs-util');
const testbed = require('../src/testbed');
const constants = require('../constants.js');
const ERRORS = require('./lib/errors.js');

const {MAX_UINT, ONE_TOKEN, ZERO_ADDRESS} = testbed;
const {
	MAX_HEIGHT,
	NUM_RESOURCES,
	NUM_SEASONS,
	SEASON_FREQUENCY } = constants;
const CONNECTOR_WEIGHT = 0.66;
const BLOCKS = _.times(NUM_RESOURCES);
const BLOCK_NAMES = ['Onite', 'Topite', 'Rubite'];
const RESERVE = bn.mul(ONE_TOKEN, 1e3);
const MARKET_DEPOSIT = bn.mul(0.1, ONE_TOKEN);
const NEIGHBOR_OFFSETS = [[1,0], [1,-1], [0,-1], [-1,0], [-1,1], [0,1]];
const NUM_NEIGHBORS = NEIGHBOR_OFFSETS.length;
const ONE_DAY = 24 * 60 * 60;
const SEASON_DURATION = Math.floor((365.25 * ONE_DAY) / NUM_SEASONS / SEASON_FREQUENCY);

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
		id: r.id,
		timesBought: bn.toNumber(r.timesBought),
		lastTouchTime: bn.toNumber(r.lastTouchTime),
		owner: r.owner,
		blocks: decodeBlocks(r.blocks),
		price: r.price,
		resources: r.resources,
		funds: r.funds,
		inSeason: r.inSeason
	};
}

function toInt32Buffer(v) {
	if (bn.lt(v, 0)) {
		// Encode as two's complement.
		const bits = _.map(bn.toBits(bn.abs(v), -4*8), b => (b+1) % 2);
		v = bn.add(bn.fromBits(bits), 1);
	}
	return bn.toBuffer(v, 4);
}

function getDistributions(tileInfos) {
	const totals = _.reduce(tileInfos,
		(t, ti) => {
			const balances = [...ti.resources, ti.funds];
			return _.map(_.zip(balances, t), ([a, b]) => bn.add(a, b));
		},
		_.times(NUM_RESOURCES+1, i => '0')
	);
	return _.map(tileInfos,
		ti => {
			const balances = [...ti.resources, ti.funds];
			return bn.dp(bn.div(
				bn.sum(_.map(_.zip(balances, totals),
					([a, b]) => bn.div(a, b))), balances.length), 2);
		}
	);
}

function getTokenPurchaseCost(amount, supply, funds) {
	let c = bn.div(bn.add(supply, amount), supply)
	c = bn.pow(c, 1/CONNECTOR_WEIGHT);
	c = bn.sub(c, 1);
	c = bn.mul(c, funds);
	return bn.round(c);
}

describe(/([^/\\]+?)(\..*)?$/.exec(__filename)[1], function() {

	async function describeTile(x, y) {
		return _.assign(
			unpackDescription(await this.game.describeTile(x, y)),
			{x: x, y: y});
	}

	async function buyTokens(whom, tokens, bonus=0.01) {
		assert(_.isArray(tokens) && tokens.length == NUM_RESOURCES);
		for (let res = 0; res < tokens.length; res++) {
			const amount = tokens[res];
			const token = this.tokens[res].address;
			const {price, supply, funds} = await this.market.getState(token);
			// Need to pay a little more to ensure we get enough.
			const cost = bn.int(
				bn.mul(getTokenPurchaseCost(amount, supply, funds), (1+bonus)));
			const tx = await this.market.buy(
				token,
				whom,
				{from: whom, value: cost}
			);
			const {bought} = tx.findEvent('Bought').args;
			// Sell any excess.
			if (bn.gt(bought, amount)) {
				await this.market.sell(
					token,
					bn.sub(bought, amount),
					whom,
					{from: whom}
				);
			}
		}
	}

	function toTileId(x, y) {
		const data = Buffer.concat([
			toInt32Buffer(x),
			toInt32Buffer(y),
			ethjs.toBuffer(this.game.address)
		]);
		return ethjs.bufferToHex(ethjs.keccak256(data)).slice(0, 16*2+2);
	}

	async function buildTower(x, y, blocks, caller=null) {
		if (!caller)
			caller = (await describeTile(x, y)).owner;
		let cost = await this.game.getBuildCost(x, y, encodeBlocks(blocks));
		await buyTokens(caller, cost);
		return this.game.buildBlocks(x, y, encodeBlocks(blocks),
			{from: caller});
	}

	async function buyTile(x, y, player) {
		const {price} = await describeTile(x, y);
		return this.game.buyTile(x, y, {from: player, value: price});
	}

	before(async function() {
		_.assign(this, await testbed());
		this.authority = this.accounts[0];
		this.genesisPlayer = this.accounts[1];
		this.users = _.slice(this.accounts, 2);
		this.market = this.contracts['UpcityMarket'];
		this.game = this.contracts['UpcityGame'];
		describeTile = _.bind(describeTile, this);
		buyTokens = _.bind(buyTokens, this);
		toTileId = _.bind(toTileId, this);
		buildTower = _.bind(buildTower, this);
		buyTile = _.bind(buyTile, this);

		await this.market.new(Math.round(1e6 * CONNECTOR_WEIGHT));
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

	beforeEach(async function() {
		this.snapshotId = await this.saveSnapshot();
	});

	afterEach(async function() {
		await this.restoreSnapshot(this.snapshotId);
	});

	describe('lifecycle', function() {
		it('cannot call init again', async function() {
			const tokens = _.map(this.tokens, t => t.address);
			await assert.rejects(
				this.game.init(tokens, this.market.address,
					[this.authority], this.genesisPlayer),
				ERRORS.UNINITIALIZED);
		});

		it('cannot buyTile until initialized', async function() {
			const buyer = _.sample(this.users);
			await this.game.__setInitialized(false);
			await assert.rejects(buyTile(0, 0, buyer), ERRORS.UNINITIALIZED);
		});

		it('genesis owner owns genesis tile', async function() {
			const tile = await describeTile(0, 0);
			assert.equal(tile.owner, this.genesisPlayer);
		});

		it('tiles around genesis tile exist and are unowned', async function() {
			const tiles = await Promise.all(
				_.map(NEIGHBOR_OFFSETS, n => describeTile(...n)));
			for (let tile of tiles)
				assert.equal(tile.owner, ZERO_ADDRESS);
		});

		it('tiles around genesis tile have a price >= MINIMUM_TILE_PRICE', async function() {
			const tiles = await Promise.all(
				_.map(NEIGHBOR_OFFSETS, n => describeTile(...n)));
			const minPrice = bn.mul(constants.MINIMUM_TILE_PRICE, '1e18');
			for (let tile of tiles)
				assert(bn.gte(tile.price, minPrice));
		});

		it('genesis tile has a price', async function() {
			const tile = await describeTile(0, 0);
			assert(bn.gt(tile.price, 0));
		});

		it('Describing non-existant tile has a zero id', async function() {
			assert(bn.eq(await describeTile(100, 100).id, 0x0));
		});

		it(`genesis tile is in season ${SEASON_FREQUENCY} times a year`, async function() {
			let timesInSeason = 0;
			const dt = SEASON_DURATION + 1;
			const totalSeasons = NUM_SEASONS * SEASON_FREQUENCY;
			assert(dt * totalSeasons >= 365.249);
			for (let i = 0; i < totalSeasons; i++) {
				const tile = await describeTile(0, 0);
				if (tile.inSeason)
					timesInSeason++;
				await this.game.__advanceTime(dt);
			}
			assert.equal(timesInSeason, SEASON_FREQUENCY);
		});
	});

	describe('game', function() {
		it('block stats are zero initially', async function() {
			const {count, production} = await this.game.getBlockStats();
			const zeroes = _.times(NUM_RESOURCES, i => '0');
			assert.deepEqual(count, zeroes);
			assert.deepEqual(production, zeroes);
		});

		it('block stats increase with building a tower', async function() {
			const [x, y] = [0, 0];
			const numBlocks = _.random(1, MAX_HEIGHT);
			const blocks = _.times(numBlocks, i => _.sample(BLOCKS));
			await buildTower(x, y, blocks);
			const {count, production} = await this.game.getBlockStats();
			for (let res = 0; res < NUM_RESOURCES; res++) {
				if (_.includes(blocks, res)) {
					assert(bn.gt(count[res], 0));
					assert(bn.gt(production[res], 0));
				}
			}
		});
	});

	describe('claiming', function() {
		it('non-authority cannot claim fees', async function() {
			const [caller, dst] = _.sampleSize(this.users, 2);
			const amount = '12345';
			await this.game.__fundFees({value: amount});
			await assert.rejects(this.game.collectFees(dst, {from: caller}));
		});

		it('authority can claim fees to itself', async function() {
			// Needs to be high enough to cover gas.
			const amount = '12345';
			await this.game.__fundFees({value: amount});
			const balanceBefore = await this.eth.getBalance(this.authority);
			const tx = await this.game.collectFees(this.authority,
				{from: this.authority, gasPrice: 1});
			assert(tx.findEvent('FeesCollected',
				{to: this.authority, amount: bn.parse(amount)}));
			const balanceAfter = await this.eth.getBalance(this.authority);
			const gain = bn.sub(bn.add(balanceAfter, tx.gasUsed), balanceBefore);
			assert.equal(gain, amount);
		});

		it('authority can claim fees to another wallet', async function() {
			const dst = _.sample(this.users);
			const amount = '12345';
			await this.game.__fundFees({value: amount});
			const balanceBefore = await this.eth.getBalance(dst);
			const tx = await this.game.collectFees(dst,
				{from: this.authority, gasPrice: 1});
			assert(tx.findEvent('FeesCollected',
				{to: dst, amount: bn.parse(amount)}));
			const balanceAfter = await this.eth.getBalance(dst);
			const gain = bn.sub(balanceAfter, balanceBefore);
			assert.equal(gain, amount);
		});

		it('claiming fees resets fees to zero.', async function() {
			const dst = _.sample(this.users);
			const amount = '12345';
			await this.game.__fundFees({value: amount});
			const tx = await this.game.collectFees(dst, {from: this.authority});
			assert(tx.findEvent('FeesCollected',
				{to: dst, amount: bn.parse(amount)}));
			const fees = await this.game.fees();
			assert.equal(fees, '0');
		});

		it('player can claim payment to itself.', async function() {
			const player = _.sample(this.users);
			const amount = '12345';
			await this.game.__fundPlayer(player, {value: amount});
			const balanceBefore = await this.eth.getBalance(player);
			const tx = await this.game.collectCredits(player,
				{from: player, gasPrice: 1});
			assert(tx.findEvent('CreditsCollected',
				{from: player, to: player, amount: amount}));
			const balanceAfter = await this.eth.getBalance(player);
			const gain = bn.sub(bn.add(balanceAfter, tx.gasUsed), balanceBefore);
			assert.equal(gain, amount);
		});

		it('player can claim payment to another wallet.', async function() {
			const [player, wallet] = _.sampleSize(this.users, 2);
			const amount = '12345';
			await this.game.__fundPlayer(player, {value: amount});
			const balanceBefore = await this.eth.getBalance(wallet);
			const tx = await this.game.collectCredits(wallet, {from: player});
			assert(tx.findEvent('CreditsCollected',
				{from: player, to: wallet, amount: amount}));
			const balanceAfter = await this.eth.getBalance(wallet);
			const expected = bn.add(balanceBefore, amount);
			assert.equal(balanceAfter, expected);
		});
	});

	describe('buying', function() {
		it('cannot buy a tile that doesn\'t exist', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			// Just send a lot of ether since we can't get the price.
			await assert.rejects(this.game.buyTile(100, 100,
				{from: buyer, value: bn.mul(10, ONE_TOKEN)}),
				ERRORS.NOT_FOUND);
		});

		it('can buy a tile owned by someone else', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			let tile = await describeTile(0, 0);
			const tx = await buyTile(0, 0, buyer);
			assert(!!tx.findEvent('Bought',
				{from: tile.owner, to: buyer, price: tile.price}));
			tile = await describeTile(0, 0);
			assert.equal(tile.owner, buyer);
		});

		it('can buy an unowned edge tile', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			const [x, y] = _.sample(NEIGHBOR_OFFSETS);
			let tile = await describeTile(x, y);
			const tx = await buyTile(x, y, buyer);
			assert(!!tx.findEvent('Bought',
				{from: tile.owner, to: buyer, price: tile.price}));
			tile = await describeTile(x, y);
			assert.equal(tile.owner, buyer);
		});

		it('cannot buy a tile with insufficient funds', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			let tile = await describeTile(0, 0);
			await assert.rejects(this.game.buyTile(0, 0,
				{from: buyer, value: bn.sub(tile.price, 1)}),
				ERRORS.INSUFFICIENT);
		});

		it('cannot buy a tile you already own', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			let tile = await describeTile(0, 0);
			await this.game.buyTile(0, 0,
				{from: buyer, value: tile.price});
			tile = await describeTile(0, 0);
			await assert.rejects(this.game.buyTile(0, 0,
				{from: buyer, value: tile.price}),
				ERRORS.ALREADY);
		});

		it('buying a tile credits previous owner', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			let tile = await describeTile(0, 0);
			const prevOwner = tile.owner;
			const ownerBalance = await this.game.credits(prevOwner);
			const tx = await this.game.buyTile(0, 0,
				{from: buyer, value: tile.price});
			assert(bn.gt(await this.game.credits(prevOwner), ownerBalance));
		});

		it('buying an edge tile creates all its neighbors', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			const [x, y] = _.sample(NEIGHBOR_OFFSETS);
			const neighbors = _.map(NEIGHBOR_OFFSETS, ([ox, oy]) => [x+ox, y+oy]);
			const tx = await buyTile(x, y, buyer);
			const tiles = await Promise.all(
				_.map(neighbors, n => describeTile(...n)));
			assert(_.every(_.map(tiles, t => bn.ne(t.id, '0x0'))));
		});

		it('buying an edge tile increases fees collected', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			const [x, y] = _.sample(NEIGHBOR_OFFSETS);
			const feesBefore = await this.game.fees();
			await buyTile(x, y, buyer);
			const feesAfter = await this.game.fees();
			assert(bn.gt(feesAfter, feesBefore));
		});

		it('buying a tile shares funds to owned neighbors', async function() {
			const buyer = _.sample(this.users);
			const tiles = [_.sample(NEIGHBOR_OFFSETS), [0, 0]];
			await buyTile(...tiles[0], buyer);
			const fundsBefore = (await describeTile(...tiles[0])).funds;
			await buyTile(...tiles[1], buyer);
			const fundsAfter = (await describeTile(...tiles[0])).funds;
			assert(bn.gt(fundsAfter, fundsBefore));
		});

		it('buying a tile with > price refunds payer difference', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			const tile = await describeTile(0, 0);
			const excess = '123';
			const payment = bn.add(tile.price, excess);
			const balanceBefore = await this.eth.getBalance(buyer);
			const tx = await this.game.buyTile(0, 0,
				{from: buyer, value: payment, gasPrice: 1});
			const balanceAfter = await this.eth.getBalance(buyer);
			const expectedBalance = bn.sub(balanceBefore,
				bn.add(tx.gasUsed, tile.price));
			assert.equal(balanceAfter, expectedBalance);
		});

		it('buying an unowned tile increases fees collected', async function() {
			const [player] = _.sampleSize(this.users, 1);
			const [x, y] = _.sample(NEIGHBOR_OFFSETS);
			let tile = await describeTile(x, y);
			const feesBefore = await this.game.fees();
			const tx = await this.game.buyTile(x, y,
				{from: player, value: tile.price});
			const feesAfter = await this.game.fees();
			assert(bn.gt(feesAfter, feesBefore));
		});

		it('buying an owned edge tile increases fees collected', async function() {
			const [player] = _.sampleSize(this.users, 1);
			const [x, y] = [0, 0];
			let tile = await describeTile(x, y);
			const feesBefore = await this.game.fees();
			const tx = await this.game.buyTile(x, y,
				{from: player, value: tile.price});
			const feesAfter = await this.game.fees();
			assert(bn.gt(feesAfter, feesBefore));
		});

		it('buying a tile first does a collect', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			const [x, y] = [0, 0];
			let tile = await describeTile(x, y);
			const prevOwner = tile.owner;
			const ownerBalance = await this.eth.getBalance(prevOwner);
			const tx = await this.game.buyTile(x, y,
				{from: buyer, value: tile.price});
			assert(tx.findEvent('Collected', {id: toTileId(x, y)}));
		});
	});

	describe('price', function() {
		it('buying a tile increases its price', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			const {price} = await describeTile(0, 0);
			await this.game.buyTile(0, 0, {from: buyer, value: price});
			const {price: newPrice} = await describeTile(0, 0);
			assert(bn.gt(newPrice, price));
		});

		it('building a block increases a tile\'s price', async function() {
			const player = this.genesisPlayer;
			const [x, y] = [0, 0];
			const blocks = _.sampleSize(BLOCKS, 1);
			const {price: oldPrice} = await describeTile(x, y);
			const tx = await buildTower(x, y, blocks, player);
			const {price: newPrice} = await describeTile(x, y);
			assert(bn.gt(newPrice, oldPrice));
		});

		it('buying a tile increases its neighbors\' price', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			const [x, y] = [0, 0];
			const oldNeighborPrices = _.map(
				await Promise.all(_.map(NEIGHBOR_OFFSETS,
					([ox, oy]) => describeTile(ox, oy))),
				t => t.price);
			await buyTile(x, y, buyer);
			const newNeighborPrices = _.map(
				await Promise.all(_.map(NEIGHBOR_OFFSETS,
					([ox, oy]) => describeTile(ox, oy))),
				t => t.price);
			for (let [oldPrice, newPrice] of
					_.zip(oldNeighborPrices, newNeighborPrices)) {
				assert(bn.gt(newPrice, oldPrice));
			}
		});

		it('building a block increases its neighbors\' price', async function() {
			const player = this.genesisPlayer;
			const [x, y] = [0, 0];
			const oldNeighborPrices = _.map(
				await Promise.all(_.map(NEIGHBOR_OFFSETS,
					([ox, oy]) => describeTile(ox, oy))),
				t => t.price);
			const blocks = _.sampleSize(BLOCKS, 1);
			const tx = await buildTower(x, y, blocks, player);
			const newNeighborPrices = _.map(
				await Promise.all(_.map(NEIGHBOR_OFFSETS,
					([ox, oy]) => describeTile(ox, oy))),
				t => t.price);
			for (let [oldPrice, newPrice] of
					_.zip(oldNeighborPrices, newNeighborPrices)) {
				assert(bn.gt(newPrice, oldPrice));
			}
		});
	});

	describe('building', function() {
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
			const tx = await buildTower(x, y, blocks, player);
			assert(tx.findEvent('Built'));
			const {blocks: built} = await describeTile(x, y);
			assert.deepEqual(built, blocks);
		});

		it('can build complete tower at once', async function() {
			const player = this.genesisPlayer;
			const [x, y] = [0, 0];
			const blocks = _.times(MAX_HEIGHT, i => _.sample(BLOCKS));
			const tx = await buildTower(x, y, blocks, player);
			assert(tx.findEvent('Built'));
			const {blocks: built} = await describeTile(x, y);
			assert.deepEqual(built, blocks);
		});

		it('can build on top of other blocks', async function() {
			const player = this.genesisPlayer;
			const [x, y] = [0, 0];
			const blocks = _.times(_.random(1, MAX_HEIGHT-1),
				i => _.sample(BLOCKS));
			await buildTower(x, y, blocks, player);
			const newBlocks = _.times(MAX_HEIGHT - blocks.length,
				i => _.sample(blocks));
			await buildTower(x, y, newBlocks, player);
			const {blocks: built} = await describeTile(x, y);
			assert.deepEqual(built, [...blocks, ...newBlocks]);
		});

		it('building ignores malformed blocks', async function() {
			const player = this.genesisPlayer;
			const [x, y] = [0, 0];
			// Encoding of [0, 1, 2, NIL, 0, 1, 2]
			// Only the first three blocks should be built.
			const encoded = '0xffffffffffffffffff020100ff020100'
			const cost = await this.game.getBuildCost(x, y, encoded);
			await buyTokens(player, cost);
			const tx = await this.game.buildBlocks(x, y,  encoded,
				{from: player});
			assert(tx.findEvent('Built'));
			const {blocks: built} = await describeTile(x, y);
			assert.deepEqual(built, [0, 1, 2]);
		});

		it('cannot build on a complete tower', async function() {
			const player = this.genesisPlayer;
			const [x, y] = [0, 0];
			let blocks = _.times(MAX_HEIGHT, i => _.sample(BLOCKS));
			let cost = await this.game.getBuildCost(x, y, encodeBlocks(blocks));
			// We need to allocate more resources for the next build since we can't
			// get block costs on a complete tower.
			await buyTokens(player, _.map(cost, c => bn.mul(c, 100)));
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
			let blocks = _.times(_.random(1, MAX_HEIGHT-1), i => _.sample(BLOCKS));
			let cost = await this.game.getBuildCost(x, y, encodeBlocks(blocks));
			// We need to allocate more resources for the next build since we can't
			// get block costs on a complete tower.
			await buyTokens(player, _.map(cost, c => bn.mul(c, 100)));
			await this.game.buildBlocks(x, y, encodeBlocks(blocks),
				{from: player});
			blocks = _.times(MAX_HEIGHT - blocks.length + 1, i => _.sample(BLOCKS));
			await assert.rejects(
				this.game.buildBlocks(x, y, encodeBlocks(blocks), {from: player}),
				ERRORS.MAX_HEIGHT);
		});

		it('cannot build on a tile owned by someone else', async function() {
			const [builder] = _.sampleSize(this.users, 1);
			const [x, y] = [0, 0];
			const blocks = encodeBlocks([BLOCKS[0]]);
			await assert.rejects(this.game.buildBlocks(x, y, blocks),
				ERRORS.NOT_ALLOWED);
		});

		it('cannot build without sufficient resources', async function() {
			const player = this.genesisPlayer;
			const [x, y] = [0, 0];
			const blocks = _.times(_.random(1, MAX_HEIGHT), i => _.sample(BLOCKS));
			const cost = await this.game.getBuildCost(x, y, encodeBlocks(blocks));
			await buyTokens(player, _.map(cost, c => bn.max(bn.sub(c, 1), 0)));
			await assert.rejects(this.game.buildBlocks(x, y, blocks, {from: player}),
				ERRORS.INSUFFICIENT);
		});

		it('building blocks burn resources', async function() {
			const player = this.genesisPlayer;
			const [x, y] = [0, 0];
			const blocks = _.times(_.random(1, MAX_HEIGHT), i => _.sample(BLOCKS));
			const initialSupplies = await Promise.all(
				_.map(this.tokens, token => token.totalSupply()));
			const tx = await buildTower(x, y, blocks, player);
			const transfers = tx.findEvents('Transfer');
			for (let xfr of transfers) {
				assert.equal(xfr.args.to, ZERO_ADDRESS);
				assert.equal(xfr.args.from, player);
			}
			const bals = await Promise.all(
				_.map(BLOCKS, b => this.tokens[b].balanceOf(player)));
			assert.deepEqual(bals, ['0', '0', '0']);
			const supplies = await Promise.all(
				_.map(this.tokens, token => token.totalSupply()));
			assert.deepEqual(supplies, initialSupplies);
		});

		it('building on a tile first does a collect', async function() {
			const player = this.genesisPlayer;
			const [x, y] = [0, 0];
			let blocks = _.times(_.random(1, MAX_HEIGHT), i => _.sample(BLOCKS));
			const tx = await buildTower(x, y, blocks, player);
			assert(tx.findEvent('Collected', {id: toTileId(x, y)}));
		});
	});

	describe('collecting', function() {
		it('collect on unowned tile does nothing', async function() {
			const [caller] = _.sampleSize(this.users, 1);
			const [x, y] = _.sample(NEIGHBOR_OFFSETS);
			await this.game.__advanceTime(ONE_DAY);
			const tx = await this.game.collect(x, y);
			assert(!tx.findEvent('Collected', {id: toTileId(x, y)}));
		});

		it('cannot collect nonexistant tile', async function() {
			const [caller] = _.sampleSize(this.users, 1);
			const [x, y] = [100, -100];
			await this.game.__advanceTime(ONE_DAY);
			await assert.rejects(this.game.collect(x, y), ERRORS.NOT_FOUND);
		});

		it('collect mints tokens', async function() {
			const owner = this.genesisPlayer;
			const [caller] = _.sampleSize(this.users, 1);
			const funds = 100;
			const [x, y] = [0, 0];
			// Build one of each block.
			await buildTower(x, y, BLOCKS, owner);
			const oldSupply = await Promise.all(_.map(this.tokens, t => t.totalSupply()));
			await this.game.__advanceTime(ONE_DAY);
			const tx = await this.game.collect(x, y, {from: caller});
			const newSupply = await Promise.all(_.map(this.tokens, t => t.totalSupply()));
			for (let res of BLOCKS)
				assert(bn.gt(newSupply[res], oldSupply[res]));
		});

		it('collect credits tile owner, not caller', async function() {
			const owner = this.genesisPlayer;
			const [caller] = _.sampleSize(this.users, 1);
			const funds = 100;
			const [x, y] = [0, 0];
			// Build one of each block.
			await buildTower(x, y, BLOCKS, owner);
			await this.game.__fundTileAt(x, y, [0,0,0], {value: 100});
			await this.game.__advanceTime(ONE_DAY);
			const oldBalanceOwner = await this.game.getPlayerBalance(owner);
			const oldBalanceCaller = await this.game.getPlayerBalance(caller);
			const tx = await this.game.collect(x, y, {from: caller});
			assert(tx.findEvent('Collected', {id: toTileId(x, y), owner: owner}));
			const transfers = tx.findEvents('Transfer');
			const credits = tx.findEvents('Credited');
			for (let xfr of transfers)
				assert.equal(xfr.args.to, owner);
			for (let credit of credits)
				assert.equal(credit.args.to, owner);
		});

		it('collect clears shared resources and funds', async function() {
			const owner = this.genesisPlayer;
			const [x, y] = [0, 0];
			const funds = 100;
			const resources = _.times(NUM_RESOURCES, i => _.random(1, 100));
			await this.game.__fundTileAt(x, y, resources, {value: 100});
			const tx = await this.game.collect(x, y, {from: owner});
			assert(tx.findEvent('Collected', {id: toTileId(x, y), owner: owner}));
			const tile = await describeTile(x, y);
			assert(bn.eq(tile.funds, 0));
			for (let res = 0; res < NUM_RESOURCES; res++)
				assert(bn.eq(tile.resources[res], 0));
		});

		it('collect clears generated resources', async function() {
			const owner = this.genesisPlayer;
			const [x, y] = [0, 0];
			const funds = 100;
			// Build one of each block.
			await buildTower(x, y, BLOCKS, owner);
			await this.game.__advanceTime(ONE_DAY);
			const tx = await this.game.collect(x, y, {from: owner});
			assert(tx.findEvent('Collected', {id: toTileId(x, y), owner: owner}));
			const tile = await describeTile(x, y);
			for (let res = 0; res < NUM_RESOURCES; res++)
				assert(bn.eq(tile.resources[res], 0));
		});

		it('collect does not credit unowned neighbor, instead goes to fees', async function() {
			const owner = this.genesisPlayer;
			const [x, y] = [0, 0];
			const funds = 100;
			await this.game.__fundTileAt(
				x, y,
				_.times(NUM_RESOURCES, i => bn.parse('1e18')),
				{value: bn.parse('0.5e18')});
			const tx = await this.game.collect(x, y, {from: owner});
			const neighbor = await describeTile(..._.sample(NEIGHBOR_OFFSETS));
			for (let res = 0; res < NUM_RESOURCES; res++)
				assert.equal(neighbor.resources[res], '0');
			assert.equal(neighbor.funds, '0');
			assert(bn.gt(await this.game.fees(), '0'));
		});

		it('collect shares resources evenly among empty, owned tiles', async function() {
			const centerOwner = this.genesisOwner;
			const neighbors = _.map(
				_.zip(_.sampleSize(this.users, NUM_NEIGHBORS), NEIGHBOR_OFFSETS),
				([player, [nx, ny]]) => ({player: player, x: nx, y: ny}));
			const [x, y] = [0, 0];
			// Build one of each block in the center tile.
			await buildTower(x, y, BLOCKS, centerOwner);
			// Advance time.
			await this.game.__advanceTime(ONE_DAY);
			// Buy up all the tiles around it.
			// Note that this has to be done in serial because the price of each
			// tile will increase as the properties around it are bought up.
			for (let n of neighbors)
				await buyTile(n.x, n.y, n.player);
			// Drain any shared funds they received from all the buying.
			for (let n of neighbors)
				await this.game.__drainTileAt(n.x, n.y);
			// Advance time and collect from the center tile.
			await this.game.collect(x, y, {from: centerOwner});
			// Now see how much each neighbor got.
			const neighborInfos = await Promise.all(
				_.map(neighbors, n => describeTile(n.x, n.y)));
			const dists = getDistributions(neighborInfos);
			// Since all neighbors are of equal height, there should only be one
			// unique value in the distributions list.
			assert.equal(_.uniq(dists).length, 1);
		});

		it('tallest neighbor gets the largest share', async function() {
			const centerOwner = this.genesisOwner;
			const neighbors = _.map(
				_.zip(_.sampleSize(this.users, NUM_NEIGHBORS), NEIGHBOR_OFFSETS),
				([player, [nx, ny]]) => ({player: player, x: nx, y: ny}));
			const tallest = _.sample(neighbors);
			const [x, y] = [0, 0];
			// Build one of each block in the center tile.
			await buildTower(x, y, BLOCKS, centerOwner);
			// Advance time.
			await this.game.__advanceTime(ONE_DAY);
			// Buy up all the tiles around it.
			// Note that this has to be done in serial because the price of each
			// tile will increase as the properties around it are bought up.
			for (let n of neighbors)
				await buyTile(n.x, n.y, n.player);
			for (let n of neighbors) {
				// Drain any shared funds this neighbor received from all the buying.
				await this.game.__drainTileAt(n.x, n.y);
				// Build a tower.
				const height = n === tallest ? MAX_HEIGHT : _.random(1, MAX_HEIGHT-1);
				const blocks = _.times(height, i => _.sample(BLOCKS));
				await buildTower(n.x, n.y, blocks, n.player);
			}
			// Collect from the center tile.
			await this.game.collect(x, y, {from: centerOwner});
			// Now see how much each neighbor got.
			const neighborInfos = await Promise.all(
				_.map(neighbors, n => describeTile(n.x, n.y)));
			const dists = getDistributions(neighborInfos);
			// The neighbor with the largest share should also be the tallest.
			const [largest] = _.reduce(_.zip(neighbors, dists),
				([largestNeighbor, largestDist], [n, d]) => {
					if (!largestNeighbor || bn.gt(d, largestDist))
						return [n, d];
					return [largestNeighbor, largestDist];
				}, [null, '0']);
			assert.strictEqual(largest, tallest);
		});
	})
});
