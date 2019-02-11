'use strict'
const _ = require('lodash');
const assert = require('assert');
const bn = require('bn-str-256');
const ethjs = require('ethereumjs-util');
const testbed = require('../src/testbed');
const constants = require('../constants.js');
const ERRORS = require('./lib/errors.js');

const {ONE_TOKEN, ZERO_ADDRESS} = testbed;
const {
	MAX_HEIGHT,
	NUM_RESOURCES,
	NUM_SEASONS,
	SEASON_FREQUENCY,
 	RESOURCE_NAMES,
	RESOURCE_SYMBOLS,
 	CONNECTOR_WEIGHT } = constants;
const BLOCKS = _.times(NUM_RESOURCES);
const SUPPLY_LOCK = bn.mul(100, ONE_TOKEN);
const INITIAL_FUNDS = bn.mul(1, ONE_TOKEN);
const TOKEN_NAME = 'TestToken';
const TOKEN_SYMBOL = 'TTKN';
const NEIGHBOR_OFFSETS = [[1,0], [1,-1], [0,-1], [-1,0], [-1,1], [0,1]];
const NUM_NEIGHBORS = NEIGHBOR_OFFSETS.length;
const ONE_DAY = 24 * 60 * 60;
const SEASON_DURATION = Math.floor((365.25 * ONE_DAY) / NUM_SEASONS / SEASON_FREQUENCY);

describe(/([^/\\]+?)(\..*)?$/.exec(__filename)[1], function() {

	before(async function() {
		_.assign(this, await testbed());
		this.authority = this.accounts[0];
		this.genesisPlayer = this.accounts[1];
		this.users = _.slice(this.accounts, 2);
		this.market = this.contracts['UpcityMarket'];
		this.game = this.contracts['UpcityGame'];
		this.randomToken = () => _.sample(tokens);
		this.randomUsers = (size=1) => _.sampleSize(this.users, size);
		this.describeTile = describeTile;
		this.buyTokens = buyTokens;
		this.buildTower = buildTower;
		this.buyTile = buyTile;

		// Deploy the game and market
		await this.game.new();
		await this.market.new();
		// Deploy and init the token proxies.
		const tokens = this.tokens = _.times(NUM_RESOURCES,
			i => this.contracts['UpcityResourceTokenProxy'].clone());
		for (let i = 0; i < NUM_RESOURCES; i++) {
			const inst = tokens[i];
			inst.NAME = `${TOKEN_NAME}-${i}`;
			inst.SYMBOL = `${TOKEN_SYMBOL}-${i}`;
			inst.IDX = i;
			await inst
				.new(inst.NAME, inst.SYMBOL, this.market.address);
		}
		// Initialize the market.
		await this.market.init(
			SUPPLY_LOCK, _.map(tokens, t => t.address), [this.game.address],
			{value: INITIAL_FUNDS});
		//  Initialize the game.
		await this.game.init(
			this.market.address,
			this.genesisPlayer,
			[this.authority]);
	});

	beforeEach(async function() {
		this.snapshotId = await this.saveSnapshot();
	});

	afterEach(async function() {
		await this.restoreSnapshot(this.snapshotId);
	});

	describe('lifecycle', function() {
		it('cannot call init again', async function() {
			await assert.rejects(
				this.game.init(
					this.market.address,
					this.genesisPlayer,
					[this.authority]),
				ERRORS.UNINITIALIZED);
		});

		it('cannot buyTile until initialized', async function() {
			const buyer = _.sample(this.users);
			await this.game.__setInitialized(false);
			await assert.rejects(this.buyTile(0, 0, buyer), ERRORS.UNINITIALIZED);
		});

		it('genesis owner owns genesis tile', async function() {
			const tile = await this.describeTile(0, 0);
			assert.equal(tile.owner, this.genesisPlayer);
		});

		it('tiles around genesis tile exist and are unowned', async function() {
			const tiles = await Promise.all(
				_.map(NEIGHBOR_OFFSETS, n => this.describeTile(...n)));
			for (let tile of tiles)
				assert.equal(tile.owner, ZERO_ADDRESS);
		});

		it('tiles around genesis tile have a price >= MINIMUM_TILE_PRICE', async function() {
			const tiles = await Promise.all(
				_.map(NEIGHBOR_OFFSETS, n => this.describeTile(...n)));
			const minPrice = bn.mul(constants.MINIMUM_TILE_PRICE, '1e18');
			for (let tile of tiles)
				assert(bn.gte(tile.price, minPrice));
		});

		it('genesis tile has a price', async function() {
			const tile = await this.describeTile(0, 0);
			assert(bn.gt(tile.price, 0));
		});

		it('describing non-existant tile has a zero id', async function() {
			assert(bn.eq(await this.describeTile(100, 100).id, 0x0));
		});

		it(`genesis tile is in season ${SEASON_FREQUENCY} times a year`, async function() {
			let timesInSeason = 0;
			const dt = SEASON_DURATION + 1;
			const totalSeasons = NUM_SEASONS * SEASON_FREQUENCY;
			assert(dt * totalSeasons >= 365.249);
			for (let i = 0; i < totalSeasons; i++) {
				const tile = await this.describeTile(0, 0);
				if (tile.inSeason)
					timesInSeason++;
				await this.game.__advanceTime(dt);
			}
			assert.equal(timesInSeason, SEASON_FREQUENCY);
		});
	});

	describe('naming', function() {
		it('allows owner to rename tile', async function() {
			const player = this.genesisPlayer;
			const [x, y] = [0, 0];
			const name = 'foobar';
			await this.game.rename(x, y, encodeName(name), {from: player});
			const {name: actualName} = await this.describeTile(x, y);
			assert.equal(actualName, name);
		});

		it('non-owner cannot rename tile', async function() {
			const player = _.sample(this.users);
			const [x, y] = [0, 0];
			const name = 'foobar';
			await assert.rejects(
				this.game.rename(x, y, encodeName(name), {from: player}),
				ERRORS.RESTRICTED);
		});
	});

	describe('game', function() {
		it('block stats are zero initially', async function() {
			const {counts, scores, productions} = await this.game.getBlockStats();
			const zeroes = _.times(NUM_RESOURCES, i => '0');
			assert.deepEqual(counts, zeroes);
			assert.deepEqual(scores, zeroes);
			assert.deepEqual(productions, zeroes);
		});

		it('block stats increase predictably with building towers', async function() {
			const numTiles = 6;
			const tiles = [{player: this.genesisPlayer, x: 0, y: 0}];
			const buyers = _.sampleSize(this.users, numTiles - 1);
			// Meander around, buying up to numTiles.
			for (let buyer of buyers) {
				const prevTile = _.last(tiles);
				// Look ath the neighbors of the last tile.
				let neighbors = _.map(NEIGHBOR_OFFSETS,
					([x, y]) => [prevTile.x + x, prevTile.y + y]);
				// Filter out neighbors we've already added.
				neighbors = _.filter(neighbors,
					([x, y]) => !_.find(tiles, t => t.x == x && t.y == y));
				const [x, y] = _.sample(neighbors);
				const info = await this.describeTile(x, y);
				if (info.owner != buyer)
					await this.buyTile(x, y, buyer);
				tiles.push({
					player: buyer,
					x: x,
					y: y
				});
			}
			// Build a random tower in each tile, aggregating scores and counts.
			const blockCounts = _.times(NUM_RESOURCES, i => 0);
			const blockScores = _.times(NUM_RESOURCES, i => 0);
			const HEIGHT_BONUSES = _.times(MAX_HEIGHT,
				height => constants.BLOCK_HEIGHT_BONUS_BASE ** height)
			for (let tile of tiles) {
				const blocks = _.times(_.random(1, MAX_HEIGHT), i => _.sample(BLOCKS));
				for (let height = 0; height < blocks.length; height++) {
					const block = blocks[height];
					blockCounts[block] += 1;
					blockScores[block] += HEIGHT_BONUSES[height];
				}
				await this.buildTower(tile.x, tile.y, blocks, tile.player);
			}
			const blockProductions = _.times(NUM_RESOURCES,
				i => constants.PRODUCTION_ALPHA * (blockCounts[i] ** 0.5));
			// Check the block stats.
			const {counts, scores, productions} = _.mapValues(
				await this.game.getBlockStats(), v => _.map(v, v => bn.toNumber(v)));
			for (let block = 0; block < NUM_RESOURCES; block++) {
				assert.equal(counts[block], blockCounts[block]);
				assert(equalish(scores[block] / 1e6, blockScores[block]));
				assert(equalish(productions[block] / 1e6, blockProductions[block]));
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
			await assert.rejects(this.game.buy(100, 100,
				{from: buyer, value: bn.mul(10, ONE_TOKEN)}),
				ERRORS.NOT_FOUND);
		});

		it('can buy a tile owned by someone else', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			let tile = await this.describeTile(0, 0);
			const tx = await this.buyTile(0, 0, buyer);
			assert(!!tx.findEvent('Bought',
				{from: tile.owner, to: buyer, price: tile.price}));
			tile = await this.describeTile(0, 0);
			assert.equal(tile.owner, buyer);
		});

		it('can buy an unowned edge tile', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			const [x, y] = _.sample(NEIGHBOR_OFFSETS);
			let tile = await this.describeTile(x, y);
			const tx = await this.buyTile(x, y, buyer);
			assert(!!tx.findEvent('Bought',
				{from: tile.owner, to: buyer, price: tile.price}));
			tile = await this.describeTile(x, y);
			assert.equal(tile.owner, buyer);
		});

		it('buying an edge tile extends tilesBought', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			const [x, y] = _.sample(NEIGHBOR_OFFSETS);
			const oldSlice = await this.game.getTilesBoughtSlice(0, 300);
			await this.buyTile(x, y, buyer);
			const slice = await this.game.getTilesBoughtSlice(0, 300);
			assert(slice.length - oldSlice.length == 1);
		});

		it('buying an innner tile does NOT extend tilesBought', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			const [x, y] = [0, 0];
			const oldSlice = await this.game.getTilesBoughtSlice(0, 300);
			await this.buyTile(x, y, buyer);
			const slice = await this.game.getTilesBoughtSlice(0, 300);
			assert.equal(slice.length, oldSlice.length);
		});

		it('cannot buy a tile with insufficient funds', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			let tile = await this.describeTile(0, 0);
			await assert.rejects(this.game.buy(0, 0,
				{from: buyer, value: bn.sub(tile.price, 1)}),
				ERRORS.INSUFFICIENT);
		});

		it('cannot buy a tile you already own', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			let tile = await this.describeTile(0, 0);
			await this.game.buy(0, 0,
				{from: buyer, value: tile.price});
			tile = await this.describeTile(0, 0);
			await assert.rejects(this.game.buy(0, 0,
				{from: buyer, value: tile.price}),
				ERRORS.ALREADY);
		});

		it('buying a tile credits previous owner', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			let tile = await this.describeTile(0, 0);
			const prevOwner = tile.owner;
			const ownerBalance = await this.game.credits(prevOwner);
			const tx = await this.game.buy(0, 0,
				{from: buyer, value: tile.price});
			assert(bn.gt(await this.game.credits(prevOwner), ownerBalance));
		});

		it('buying an edge tile creates all its neighbors', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			const [x, y] = _.sample(NEIGHBOR_OFFSETS);
			const neighbors = _.map(NEIGHBOR_OFFSETS, ([ox, oy]) => [x+ox, y+oy]);
			const tx = await this.buyTile(x, y, buyer);
			const tiles = await Promise.all(
				_.map(neighbors, n => this.describeTile(...n)));
			assert(_.every(_.map(tiles, t => bn.ne(t.id, '0x0'))));
		});

		it('buying an edge tile increases fees collected', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			const [x, y] = _.sample(NEIGHBOR_OFFSETS);
			const feesBefore = await this.game.fees();
			await this.buyTile(x, y, buyer);
			const feesAfter = await this.game.fees();
			assert(bn.gt(feesAfter, feesBefore));
		});

		it('buying a tile shares funds to owned neighbors', async function() {
			const buyer = _.sample(this.users);
			const tiles = [_.sample(NEIGHBOR_OFFSETS), [0, 0]];
			await this.buyTile(...tiles[0], buyer);
			const fundsBefore = (await this.describeTile(...tiles[0])).funds;
			await this.buyTile(...tiles[1], buyer);
			const fundsAfter = (await this.describeTile(...tiles[0])).funds;
			assert(bn.gt(fundsAfter, fundsBefore));
		});

		it('buying a tile with > price refunds payer difference', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			const tile = await this.describeTile(0, 0);
			const excess = '123';
			const payment = bn.add(tile.price, excess);
			const balanceBefore = await this.eth.getBalance(buyer);
			const tx = await this.game.buy(0, 0,
				{from: buyer, value: payment, gasPrice: 1});
			const balanceAfter = await this.eth.getBalance(buyer);
			const expectedBalance = bn.sub(balanceBefore,
				bn.add(tx.gasUsed, tile.price));
			assert.equal(balanceAfter, expectedBalance);
		});

		it('buying an unowned tile increases fees collected', async function() {
			const [player] = _.sampleSize(this.users, 1);
			const [x, y] = _.sample(NEIGHBOR_OFFSETS);
			let tile = await this.describeTile(x, y);
			const feesBefore = await this.game.fees();
			const tx = await this.game.buy(x, y,
				{from: player, value: tile.price});
			const feesAfter = await this.game.fees();
			assert(bn.gt(feesAfter, feesBefore));
		});

		it('buying an owned edge tile increases fees collected', async function() {
			const [player] = _.sampleSize(this.users, 1);
			const [x, y] = [0, 0];
			let tile = await this.describeTile(x, y);
			const feesBefore = await this.game.fees();
			const tx = await this.game.buy(x, y,
				{from: player, value: tile.price});
			const feesAfter = await this.game.fees();
			assert(bn.gt(feesAfter, feesBefore));
		});

		it('buying a tile first does a collect', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			const [x, y] = [0, 0];
			let tile = await this.describeTile(x, y);
			const prevOwner = tile.owner;
			const ownerBalance = await this.eth.getBalance(prevOwner);
			const tx = await this.game.buy(x, y,
				{from: buyer, value: tile.price});
			assert(tx.findEvent('Collected', {id: toTileId(x, y)}));
		});
	});

	describe('price', function() {
		it('buying a tile increases its price', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			const {price} = await this.describeTile(0, 0);
			await this.game.buy(0, 0, {from: buyer, value: price});
			const {price: newPrice} = await this.describeTile(0, 0);
			assert(bn.gt(newPrice, price));
		});

		it('building a block increases a tile\'s price', async function() {
			const player = this.genesisPlayer;
			const [x, y] = [0, 0];
			const blocks = _.sampleSize(BLOCKS, 1);
			const {price: oldPrice} = await this.describeTile(x, y);
			const tx = await this.buildTower(x, y, blocks, player);
			const {price: newPrice} = await this.describeTile(x, y);
			assert(bn.gt(newPrice, oldPrice));
		});

		it('buying a tile increases its neighbors\' price', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			const [x, y] = [0, 0];
			const oldNeighborPrices = _.map(
				await Promise.all(_.map(NEIGHBOR_OFFSETS,
					([ox, oy]) => this.describeTile(ox, oy))),
				t => t.price);
			await this.buyTile(x, y, buyer);
			const newNeighborPrices = _.map(
				await Promise.all(_.map(NEIGHBOR_OFFSETS,
					([ox, oy]) => this.describeTile(ox, oy))),
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
					([ox, oy]) => this.describeTile(ox, oy))),
				t => t.price);
			const blocks = _.sampleSize(BLOCKS, 1);
			const tx = await this.buildTower(x, y, blocks, player);
			const newNeighborPrices = _.map(
				await Promise.all(_.map(NEIGHBOR_OFFSETS,
					([ox, oy]) => this.describeTile(ox, oy))),
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
			const tx = await this.buildTower(x, y, blocks, player);
			assert(tx.findEvent('Built'));
			const {blocks: built} = await this.describeTile(x, y);
			assert.deepEqual(built, blocks);
		});

		it('can build complete tower at once', async function() {
			const player = this.genesisPlayer;
			const [x, y] = [0, 0];
			const blocks = _.times(MAX_HEIGHT, i => _.sample(BLOCKS));
			const tx = await this.buildTower(x, y, blocks, player);
			assert(tx.findEvent('Built'));
			const {blocks: built} = await this.describeTile(x, y);
			assert.deepEqual(built, blocks);
		});

		it('can build on top of other blocks', async function() {
			const player = this.genesisPlayer;
			const [x, y] = [0, 0];
			const blocks = _.times(_.random(1, MAX_HEIGHT-1),
				i => _.sample(BLOCKS));
			await this.buildTower(x, y, blocks, player);
			const newBlocks = _.times(MAX_HEIGHT - blocks.length,
				i => _.sample(blocks));
			await this.buildTower(x, y, newBlocks, player);
			const {blocks: built} = await this.describeTile(x, y);
			assert.deepEqual(built, [...blocks, ...newBlocks]);
		});

		it('building ignores malformed blocks', async function() {
			const player = this.genesisPlayer;
			const [x, y] = [0, 0];
			// Encoding of [0, 1, 2, NIL, 0, 1, 2]
			// Only the first three blocks should be built.
			const encoded = '0xffffffffffffffffff020100ff020100'
			const cost = await this.game.getBuildCost(x, y, encoded);
			await this.buyTokens(player, cost);
			const tx = await this.game.buildBlocks(x, y,  encoded,
				{from: player});
			assert(tx.findEvent('Built'));
			const {blocks: built} = await this.describeTile(x, y);
			assert.deepEqual(built, [0, 1, 2]);
		});

		it('cannot build on a complete tower', async function() {
			const player = this.genesisPlayer;
			const [x, y] = [0, 0];
			let blocks = _.times(MAX_HEIGHT, i => _.sample(BLOCKS));
			let cost = await this.game.getBuildCost(x, y, encodeBlocks(blocks));
			// We need to allocate more resources for the next build since we can't
			// get block costs on a complete tower.
			await this.buyTokens(player, _.map(cost, c => bn.mul(c, 100)));
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
			await this.buyTokens(player, _.map(cost, c => bn.mul(c, 100)));
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
				ERRORS.RESTRICTED);
		});

		it('cannot build without sufficient resources', async function() {
			const player = this.genesisPlayer;
			const [x, y] = [0, 0];
			const blocks = _.times(_.random(1, MAX_HEIGHT), i => _.sample(BLOCKS));
			const cost = await this.game.getBuildCost(x, y, encodeBlocks(blocks));
			await this.buyTokens(player, _.map(cost, c => bn.max(bn.sub(c, 1), 0)));
			await assert.rejects(this.game.buildBlocks(x, y, blocks, {from: player}),
				ERRORS.INSUFFICIENT);
		});

		it('building blocks locks resources', async function() {
			const player = this.genesisPlayer;
			const [x, y] = [0, 0];
			const blocks = _.times(_.random(1, MAX_HEIGHT), i => _.sample(BLOCKS));
			const cost = await this.game.getBuildCost(x, y, encodeBlocks(blocks));
			const tx = await this.buildTower(x, y, blocks, player);
			// Check that the balance of the market increased by cost and
			// the balance of player decreased by cost.
			let balanceBefore = await this.market.getBalances(
				this.market.address, {block: tx.blockNumber-1});
			let balanceAfter = await this.market.getBalances(
				this.market.address);
			let expected = _.map(_.zip(balanceBefore, cost),
				a => bn.add(a[0], a[1]));
			assert.deepEqual(balanceAfter, expected);
			balanceBefore = await this.market.getBalances(
				player, {block: tx.blockNumber-1});
			balanceAfter = await this.market.getBalances(
				player);
			expected = _.map(_.zip(balanceBefore, cost),
				a => bn.sub(a[0], a[1]));
			assert.deepEqual(balanceAfter, expected);
		});

		it('building on a tile first does a collect', async function() {
			const player = this.genesisPlayer;
			const [x, y] = [0, 0];
			let blocks = _.times(_.random(1, MAX_HEIGHT), i => _.sample(BLOCKS));
			const tx = await this.buildTower(x, y, blocks, player);
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
			await this.buildTower(x, y, BLOCKS, owner);
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
			await this.buildTower(x, y, BLOCKS, owner);
			await this.game.__fundTileAt(x, y, [0,0,0], {value: 100});
			await this.game.__advanceTime(ONE_DAY);
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
			const tile = await this.describeTile(x, y);
			assert(bn.eq(tile.funds, 0));
			for (let res = 0; res < NUM_RESOURCES; res++)
				assert(bn.eq(tile.sharedResources[res], 0));
		});

		it('collect updates lastTouchTime', async function() {
			const owner = this.genesisPlayer;
			const [x, y] = [0, 0];
			const funds = 100;
			// Build one of each block.
			await this.buildTower(x, y, BLOCKS, owner);
			await this.game.__advanceTime(ONE_DAY);
			const tx = await this.game.collect(x, y, {from: owner});
			assert(tx.findEvent('Collected', {id: toTileId(x, y), owner: owner}));
			const tile = await this.describeTile(x, y);
			const now = await this.game.__blockTime();
			assert.equal(tile.lastTouchTime, bn.toNumber(now));
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
			const neighbor = await this.describeTile(..._.sample(NEIGHBOR_OFFSETS));
			for (let res = 0; res < NUM_RESOURCES; res++)
				assert.equal(neighbor.sharedResources[res], '0');
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
			await this.buildTower(x, y, BLOCKS, centerOwner);
			// Advance time.
			await this.game.__advanceTime(ONE_DAY);
			// Buy up all the tiles around it.
			// Note that this has to be done in serial because the price of each
			// tile will increase as the properties around it are bought up.
			for (let n of neighbors)
				await this.buyTile(n.x, n.y, n.player);
			// Drain any shared funds they received from all the buying.
			for (let n of neighbors)
				await this.game.__drainTileAt(n.x, n.y);
			// Advance time and collect from the center tile.
			await this.game.collect(x, y, {from: centerOwner});
			// Now see how much each neighbor got.
			const neighborInfos = await Promise.all(
				_.map(neighbors, n => this.describeTile(n.x, n.y)));
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
			await this.buildTower(x, y, BLOCKS, centerOwner);
			// Advance time.
			await this.game.__advanceTime(ONE_DAY);
			// Buy up all the tiles around it.
			// Note that this has to be done in serial because the price of each
			// tile will increase as the properties around it are bought up.
			for (let n of neighbors)
				await this.buyTile(n.x, n.y, n.player);
			for (let n of neighbors) {
				// Drain any shared funds this neighbor received from all the buying.
				await this.game.__drainTileAt(n.x, n.y);
				// Build a tower.
				const height = n === tallest ? MAX_HEIGHT : _.random(1, MAX_HEIGHT-1);
				const blocks = _.times(height, i => _.sample(BLOCKS));
				await this.buildTower(n.x, n.y, blocks, n.player);
			}
			// Collect from the center tile.
			await this.game.collect(x, y, {from: centerOwner});
			// Now see how much each neighbor got.
			const neighborInfos = await Promise.all(
				_.map(neighbors, n => this.describeTile(n.x, n.y)));
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

/// Utility Functions

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

function encodeName(name) {
	return '0x'+ethjs.setLengthRight(Buffer.from(name), 16).toString('hex');
}

function decodeName(encoded) {
	const buf = ethjs.toBuffer(encoded);
	let end = 0;
	for (; end < buf.length; end++) {
		if (buf[end] == 0)
			break;
	}
	return buf.slice(0, end).toString();
}

function unpackDescription(r) {
	return {
		id: r.id,
		name: decodeName(r.name),
		lastTouchTime: bn.toNumber(r.lastTouchTime),
		timesBought: bn.toNumber(r.timesBought),
		owner: r.owner,
		blocks: decodeBlocks(r.blocks),
		price: r.price,
		sharedResources: r.sharedResources,
		funds: r.funds,
		inSeason: r.inSeason,
		scores: r.scores
	};
}

function toInt32Buffer(v) {
	if (bn.lt(v, 0)) {
		// Encode as two's complement.
		const bits = _.map(bn.toBits(bn.abs(v), 4*8), b => (b+1) % 2);
		v = bn.add(bn.fromBits(bits), 1);
	}
	return bn.toBuffer(v, 4);
}

function equalish(a, b) {
	const ERR = 1e-2;
	return Math.abs(a - b) <= ERR;
}

function toTileId(x, y) {
	const data = Buffer.concat([
		new Buffer.from([0x13, 0x37]),
		toInt32Buffer(y),
		toInt32Buffer(x)
	]);
	return ethjs.bufferToHex(data);
}

function getDistributions(tileInfos) {
	const totals = _.reduce(tileInfos,
		(t, ti) => {
			const balances = [...ti.sharedResources, ti.funds];
			return _.map(_.zip(balances, t), ([a, b]) => bn.add(a, b));
		},
		_.times(NUM_RESOURCES+1, i => '0')
	);
	return _.map(tileInfos,
		ti => {
			const balances = [...ti.sharedResources, ti.funds];
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

async function describeTile(x, y) {
	return _.assign(
		unpackDescription(await this.game.describeTile(x, y)),
		{x: x, y: y});
}

async function buyTokens(whom, amounts, bonus=0.01) {
	assert(_.isArray(amounts) && amounts.length == NUM_RESOURCES);
	const states = await Promise.all(
		_.map(this.tokens, t => this.market.getState(t.address)));
	// Predict the cost of buying each token amount, with a little breathing
	// room.
	const costs = _.map(_.zip(states, amounts), ([s, a]) => bn.int(
			bn.mul(getTokenPurchaseCost(a, s.supply, s.funds), (1+bonus))));
	const tx = await this.market.buy(
		costs, whom, {from: whom, value: bn.sum(costs)});
	// Sell any excess tokens.
	const sells = _.times(NUM_RESOURCES, i => '0');
	for (let token of this.tokens) {
		const amount = amounts[token.IDX];
		const {bought} = tx.findEvent('Bought', {resource: token.address}).args;
		if (bought)
			sells[token.IDX] = bn.max(0, bn.sub(bought, amount));
	}
	await this.market.sell(sells, whom, {from: whom});
}

async function buildTower(x, y, blocks, caller=null) {
	if (!caller)
		caller = (await this.describeTile(x, y)).owner;
	let cost = await this.game.getBuildCost(x, y, encodeBlocks(blocks));
	await this.buyTokens(caller, cost);
	return this.game.buildBlocks(x, y, encodeBlocks(blocks),
		{from: caller});
}

async function buyTile(x, y, player) {
	const {price} = await this.describeTile(x, y);
	return this.game.buy(x, y, {from: player, value: price});
}
