'use strict'
const _ = require('lodash');
const assert = require('assert');
const bn = require('bn-str-256');
const testbed = require('../src/testbed');
const constants = require('../constants.js');
const ERRORS = require('./lib/errors.js');

const {ONE_TOKEN, ZERO_ADDRESS} = testbed;
const NUM_TOKENS = constants.NUM_RESOURCES;
const SUPPLY_LOCK = bn.mul(100, ONE_TOKEN);
const INITIAL_FUNDS = bn.mul(1, ONE_TOKEN);
const ONE_DAY = 60 * 60 * 24;
const NUM_RESOURCES = constants.NUM_RESOURCES;
const RESOURCE_NAMES = constants.RESOURCE_NAMES;
const RESOURCE_SYMBOLS = constants.RESOURCE_SYMBOLS;
const TOKEN_NAME = 'TestToken';
const TOKEN_SYMBOL = 'TTKN';

describe(/([^/\\]+?)(\..*)?$/.exec(__filename)[1], function() {

	before(async function() {
		_.assign(this, await testbed({
			contracts: ['UpcityMarket', 'UpcityResourceTokenProxy']}));
		this.authority = this.accounts[0];
		this.users = _.slice(this.accounts, 1);
		this.market = this.contracts['UpcityMarket'];
		this.randomToken = () => _.sample(tokens);
		this.randomUsers = (size=1) => _.sampleSize(this.users, size);

		// Deploy the market and tokens.
		const market = this.market = this.contracts['UpcityMarket'].clone();
		await market.new();
		const tokens = this.tokens = _.times(NUM_TOKENS,
			i => this.contracts['UpcityResourceTokenProxy'].clone());
		for (let i = 0; i < NUM_TOKENS; i++) {
			const inst = tokens[i];
			inst.NAME = `${TOKEN_NAME}-${i}`;
			inst.SYMBOL = `${TOKEN_SYMBOL}-${i}`;
			inst.IDX = i;
			await inst
				.new(inst.IDX, inst.NAME, inst.SYMBOL, market.address);
		}
		// Initialize the market.
		await market.init(
			SUPPLY_LOCK, _.map(tokens, t => t.address), [this.authority],
			{value: INITIAL_FUNDS});
	});

	beforeEach(async function() {
		this.snapshotId = await this.saveSnapshot();
	});

	afterEach(async function() {
		await this.restoreSnapshot(this.snapshotId);
	});

	it('Cannot call init again', async function() {
		const token = testbed.randomAddress();
		await assert.rejects(this.market.init(
			SUPPLY_LOCK, _.map(this.tokens, t => t.address), [this.authority],
			{value: INITIAL_FUNDS}), ERRORS.UNINITIALIZED);
	});

	it('Can get all supported tokens', async function() {
		const tokens = await this.market.getTokens();
		assert.deepEqual(tokens, _.map(this.tokens, t => t.address));
	});

	it('Cannot get the market state of an unknown token', async function() {
		const token = testbed.randomAddress();
		await assert.rejects(this.market.getState(token), ERRORS.INVALID);
	});

	it('Can get the price of all tokens', async function() {
		const prices = await this.market.getPrices();
		assert(prices.length == NUM_TOKENS);
		assert(_.every(prices, p => bn.gt(p, 0)));
	});

	it('Can get the market state of a valid token', async function() {
		const token = _.sample(this.tokens).address;
		const state = await this.market.getState(token);
		assert(bn.gt(state.price, 0));
		assert(bn.gt(state.supply, 0));
		assert(bn.gt(state.funds, 0));
		assert(bn.gt(state.priceYesterday, 0));
	});

	it('Cannot buy if uninitialized', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		const buys = _.times(NUM_RESOURCES,
			i => bn.int(bn.mul(Math.random(), ONE_TOKEN)));
		await this.market.__setInitialized(false);
		await assert.rejects(this.market.buy(buys, buyer,
			{from: buyer, value: bn.sum(buys)}), ERRORS.UNINITIALIZED);
	});

	it('Cannot sell if uninitialized', async function() {
		const [seller] = _.sampleSize(this.users, 1);
		const balances = _.times(NUM_RESOURCES,
			i => bn.int(bn.mul(Math.random(), ONE_TOKEN)));
		await this.market.mint(seller, balances);
		await this.market.__setInitialized(false);
		await assert.rejects(this.market.sell(
			balances, seller, {from: seller}), ERRORS.UNINITIALIZED);
	});

	it('Sum of individual buy amounts cannot exceed attached ether', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		const token = _.sample(this.tokens);
		const buys = _.times(NUM_RESOURCES,
			i => bn.int(bn.mul(Math.random(), ONE_TOKEN)));
		const value = bn.sub(bn.sum(buys), 1);
		await assert.rejects(this.market.buy(buys, buyer,
			{from: buyer, value: value}), ERRORS.INSUFFICIENT);
	});

	it('Cannot sell with insufficient funds', async function() {
		const [seller] = _.sampleSize(this.users, 1);
		const balances = _.times(NUM_RESOURCES,
			i => bn.int(bn.mul(Math.random(), ONE_TOKEN)));
		await this.market.mint(seller, balances);
		// One sell amount will exceed the token balance of seller.
		const idx = _.random(NUM_RESOURCES-1);
		const sells = _.clone(balances);
		sells[idx] = bn.add(sells[idx], 1);
		await assert.rejects(this.market.sell(
			sells, seller, {from: seller}), ERRORS.INSUFFICIENT);
	});

	it('Can buy tokens', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		const buys = _.times(NUM_RESOURCES,
			i => bn.int(bn.mul(Math.random(), ONE_TOKEN)));
		const tx = await this.market.buy(buys, buyer,
			{from: buyer, value: bn.sum(buys)});
		for (const token of this.tokens) {
			const event = tx.findEvent('Bought',
				{resource: token.address, to: buyer});
			assert(!_.isNil(event));
			assert.equal(
				await token.balanceOf(buyer),
				event.args.bought);
		}
	});

	it('Can buy token for another', async function() {
		const [buyer, dst] = _.sampleSize(this.users, 2);
		const buys = _.times(NUM_RESOURCES,
			i => bn.int(bn.mul(Math.random(), ONE_TOKEN)));
		const tx = await this.market.buy(buys, dst,
			{from: buyer, value: bn.sum(buys)});
		for (const token of this.tokens) {
			const event = tx.findEvent('Bought',
				{resource: token.address, to: dst});
			assert(!_.isNil(event));
			assert.equal(
				await token.balanceOf(dst),
				event.args.bought);
		}
	});

	it('Buy refunds overpayment', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		const balanceBefore = await this.eth.getBalance(buyer);
		const buys = _.times(NUM_RESOURCES,
			i => bn.int(bn.mul(Math.random(), ONE_TOKEN)));
		const tx = await this.market.buy(buys, buyer,
			{from: buyer, value: bn.add(bn.sum(buys), 1)});
		const balanceAfter = await this.eth.getBalance(buyer);
		assert(bn.eq(balanceAfter, bn.sub(balanceBefore, bn.sum(buys, tx.gasUsed))));
	});

	it('Buying tokens increases supplies', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		const suppliesBefore = await this.market.getSupplies();
		const buys = _.times(NUM_RESOURCES,
			i => bn.int(bn.mul(Math.random(), ONE_TOKEN)));
		const tx = await this.market.buy(buys, buyer,
			{from: buyer, value: bn.sum(buys)});
		const suppliesAfter = await this.market.getSupplies();
		// Check that supplies were increased.
		for (const token of this.tokens) {
			const {bought} = tx.findEvent('Bought',
				{resource: token.address}).args;
			const before = suppliesBefore[token.IDX];
			const after = suppliesAfter[token.IDX];
			assert.equal(after, bn.add(before, bought));
		}
	});

	it('Can sell all tokens', async function() {
		const [seller] = _.sampleSize(this.users, 1);
		const ethBalanceBefore = await this.eth.getBalance(seller);
		const balances = _.times(NUM_RESOURCES,
			i => bn.int(bn.mul(Math.random(), ONE_TOKEN)));
		await this.market.mint(seller, balances);
		const tx = await this.market.sell(balances, seller,
			{from: seller});
		const [ethBalanceAfter, balanceAfter] = await Promise.all([
			this.eth.getBalance(seller),
			this.market.getBalances(seller)]);
		// Check that all tokens were sold.
		for (const token of this.tokens) {
			const {sold} = tx.findEvent('Sold',
				{resource: token.address, sold: balances[token.IDX]}).args;
			assert(sold);
			assert.equal(balanceAfter[token.IDX], '0');
		}
		// Check that the seller was paid ether.
		assert(bn.gt(ethBalanceAfter, bn.sub(ethBalanceBefore, tx.gasUsed)));
	});

	it('Can sell some tokens', async function() {
		const [seller] = _.sampleSize(this.users, 1);
		const ethBalanceBefore = await this.eth.getBalance(seller);
		const balances = _.times(NUM_RESOURCES,
			i => bn.int(bn.mul(Math.random(), ONE_TOKEN)));
		await this.market.mint(seller, balances);
		const sells = _.map(balances, b => bn.int(bn.mul(Math.random(), b)));
		const tx = await this.market.sell(sells, seller,
			{from: seller});
		const [ethBalanceAfter, balanceAfter] = await Promise.all([
			this.eth.getBalance(seller),
			this.market.getBalances(seller)]);
		// Check that tokens were sold.
		for (const token of this.tokens) {
			const {sold} = tx.findEvent('Sold',
				{resource: token.address, sold: sells[token.IDX]}).args;
			assert(sold);
			assert.equal(balanceAfter[token.IDX],
				bn.sub(balances[token.IDX], sells[token.IDX]));
		}
		// Check that the seller was paid ether.
		assert(bn.gt(ethBalanceAfter, bn.sub(ethBalanceBefore, tx.gasUsed)));
	});

	it('Can sell tokens to another', async function() {
		const [seller, dst] = _.sampleSize(this.users, 2);
		const ethBalanceBefore = await this.eth.getBalance(dst);
		const balances = _.times(NUM_RESOURCES,
			i => bn.int(bn.mul(Math.random(), ONE_TOKEN)));
		await this.market.mint(seller, balances);
		const tx = await this.market.sell(balances, dst,
			{from: seller});
		const ethBalanceAfter = await this.eth.getBalance(dst);
		// Check that the receiver was paid ether.
		assert(bn.gt(ethBalanceAfter, bn.sub(ethBalanceBefore, tx.gasUsed)));
	});

	it('Selling tokens decreases supply', async function() {
		const [seller] = _.sampleSize(this.users, 1);
		const balances = _.times(NUM_RESOURCES,
			i => bn.int(bn.mul(Math.random(), ONE_TOKEN)));
		await this.market.mint(seller, balances);
		const suppliesBefore = await this.market.getSupplies();
		const sells = _.map(balances, b => bn.int(bn.mul(Math.random(), b)));
		const tx = await this.market.sell(sells, seller,
			{from: seller});
		const suppliesAfter = await this.market.getSupplies();
		// Check that supplies were reduced.
		for (const token of this.tokens) {
			const {sold} = tx.findEvent('Sold',
				{resource: token.address}).args;
			assert(sold);
			const before = suppliesBefore[token.IDX];
			const after = suppliesAfter[token.IDX];
			assert.equal(after, bn.sub(before, sold));
		}
	});

	it('Raises Funded even when funded', async function() {
		const amount = bn.int(bn.mul(Math.random(0.25, 0.5), ONE_TOKEN));
		await this.eth.transfer(this.market.address, amount);
		const events = await this.market.Funded({fromBlock: -1, toBlock: -1});
		assert(events.length == 1);
		assert(events[0].name == 'Funded');
		const {value} = events[0].args;
		assert.equal(value, amount);
	});
});
