'use strict'
require('colors');
const _ = require('lodash');
const assert = require('assert');
const bn = require('bn-str-256');
const ethjs = require('ethereumjs-util');
const testbed = require('../../src/testbed');
const constants = require('../../constants.js');
const ERRORS = require('../lib/errors.js');

const {ONE_TOKEN, ZERO_ADDRESS} = testbed;
const {
	MAX_HEIGHT,
	NUM_RESOURCES,
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
const HIGH_GAS = 400e3;

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
		this.collect = collect;

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
				.new(inst.IDX, inst.NAME, inst.SYMBOL, this.market.address);
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

	describe('buyTile', function() {
		test('owned, empty tile, no neighbors', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			const [x, y] = [0, 0];
			await this.game.__advanceTime(ONE_DAY);
			return this.buyTile(x, y, buyer);
		});

		test('edge tile', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			const [x, y] = _.sample(NEIGHBOR_OFFSETS);
			await this.game.__advanceTime(ONE_DAY);
			return this.buyTile(x, y, buyer);
		});

		test('owned, MAX_HEIGHT tile, no neighbors', async function() {
			const [buyer] = _.sampleSize(this.users, 1);
			const [x, y] = [0, 0];
			const blocks = _.times(MAX_HEIGHT, i => i % NUM_RESOURCES);
			await this.buildTower(x, y, blocks);
			await this.game.__advanceTime(ONE_DAY);
			return this.buyTile(x, y, buyer);
		});

		test('owned, MAX_HEIGHT tile, 6 neighbors', async function() {
			const [x, y] = [0, 0];
			for (const [nx, ny] of NEIGHBOR_OFFSETS)
				await this.buyTile(x + nx, y + ny, _.sample(this.users));
			const [buyer] = _.sampleSize(this.users, 1);
			const blocks = _.times(MAX_HEIGHT, i => i % NUM_RESOURCES);
			await this.buildTower(x, y, blocks);
			await this.game.__advanceTime(ONE_DAY);
			return this.buyTile(x, y, buyer);
		});
	});

	describe('collect', function() {
		test('no tower, no neighbors', async function() {
			const [x, y] = [0, 0];
			await this.game.__advanceTime(ONE_DAY);
			return this.collect(x, y);
		});

		test('MAX_HEIGHT, no neighbors', async function() {
			const [x, y] = [0, 0];
			const blocks = _.times(MAX_HEIGHT, i => i % NUM_RESOURCES);
			await this.buildTower(x, y, blocks);
			await this.game.__advanceTime(ONE_DAY);
			return this.collect(x, y);
		});

		test('MAX_HEIGHT, 6 neighbors', async function() {
			const [x, y] = [0, 0];
			for (const [nx, ny] of NEIGHBOR_OFFSETS)
				await this.buyTile(x + nx, y + ny, _.sample(this.users));
			const blocks = _.times(MAX_HEIGHT, i => i % NUM_RESOURCES);
			await this.buildTower(x, y, blocks);
			await this.game.__advanceTime(ONE_DAY);
			return this.collect(x, y);
		});
	});

	describe('buildBlocks', function() {
		test('0 + 1', async function() {
			const [x, y] = [0, 0];
			await this.game.__advanceTime(ONE_DAY);
			return this.buildTower(x, y, [0]);
		});

		test('1 + 1', async function() {
			const [x, y] = [0, 0];
			await this.buildTower(x, y, [0]);
			await this.game.__advanceTime(ONE_DAY);
			return this.buildTower(x, y, [1]);
		});

		test('0 + MAX_HEIGHT', async function() {
			const [x, y] = [0, 0];
			await this.game.__advanceTime(ONE_DAY);
			const blocks = _.times(MAX_HEIGHT, i => i % NUM_RESOURCES);
			return this.buildTower(x, y, blocks);
		});

		test('1 + (MAX_HEIGHT-1)', async function() {
			const [x, y] = [0, 0];
			await this.buildTower(x, y, [0]);
			await this.game.__advanceTime(ONE_DAY);
			const blocks = _.times(MAX_HEIGHT-1, i => i % NUM_RESOURCES);
			return this.buildTower(x, y, blocks);
		});

		test('0 + 1, 6 neighbors', async function() {
			const [x, y] = [0, 0];
			for (const [nx, ny] of NEIGHBOR_OFFSETS)
				await this.buyTile(x + nx, y + ny, _.sample(this.users));
			await this.game.__advanceTime(ONE_DAY);
			return this.buildTower(x, y, [0]);
		});

		test('1 + 1, 6 neighbors', async function() {
			const [x, y] = [0, 0];
			for (const [nx, ny] of NEIGHBOR_OFFSETS)
				await this.buyTile(x + nx, y + ny, _.sample(this.users));
			await this.buildTower(x, y, [0]);
			await this.game.__advanceTime(ONE_DAY);
			return this.buildTower(x, y, [1]);
		});

		test('0 + MAX_HEIGHT, 6 neighbors', async function() {
			const [x, y] = [0, 0];
			for (const [nx, ny] of NEIGHBOR_OFFSETS)
				await this.buyTile(x + nx, y + ny, _.sample(this.users));
			await this.game.__advanceTime(ONE_DAY);
			const blocks = _.times(MAX_HEIGHT, i => i % NUM_RESOURCES);
			return this.buildTower(x, y, blocks);
		});

		test('1 + (MAX_HEIGHT-1), 6 neighbors', async function() {
			const [x, y] = [0, 0];
			for (const [nx, ny] of NEIGHBOR_OFFSETS)
				await this.buyTile(x + nx, y + ny, _.sample(this.users));
			await this.buildTower(x, y, [0]);
			await this.game.__advanceTime(ONE_DAY);
			const blocks = _.times(MAX_HEIGHT-1, i => i % NUM_RESOURCES);
			return this.buildTower(x, y, blocks);
		});
	});
});

/// Utility Functions
function test(desc, cb) {
	it(desc, async function() {
		const r = await cb.call(this);
		printGasUsage(r.gasUsed || _.toNumber(r));
	});
}

function printGasUsage(gasUsed) {
	const f = gasUsed / HIGH_GAS;
	let s = gasUsed.toString().bold;
	if (f >= 1.0)
		s = s.red;
	else if (f <= 0.33)
		s = s.green;
	else
		s = s.yellow;
	console.log('\t' + s);
}

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

async function collect(x, y) {
	const {owner} = await this.describeTile(x, y);
	return this.game.collect(x, y, {from: owner});
}
