'use strict'
const _ = require('lodash');
const assert = require('assert');
const bn = require('bn-str-256');
const testbed = require('../src/testbed');
const constants = require('../constants.js');
const ERRORS = require('./lib/errors.js');

const {MAX_UINT, ONE_TOKEN, ZERO_ADDRESS} = testbed;
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
			i => bn.mul(Math.random(), ONE_TOKEN));
		await this.market.__setInitialized(false);
		await assert.rejects(this.market.buy(buys, buyer,
			{from: buyer, value: bn.sum(buys)}), ERRORS.UNINITIALIZED);
	});

	it('Cannot sell if uninitialized', async function() {
		const [seller] = _.sampleSize(this.users, 1);
		const balances = _.times(NUM_RESOURCES,
			i => bn.mul(Math.random(), ONE_TOKEN));
		await this.market.mint(seller, balances);
		await this.market.__setInitialized(false);
		await assert.rejects(this.market.sell(
			balances, seller, {from: seller}), ERRORS.UNINITIALIZED);
	});

	it('Sum of individual buy amounts cannot exceed attached ether', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		const token = _.sample(this.tokens);
		const buys = _.times(NUM_RESOURCES,
			i => bn.mul(Math.random(), ONE_TOKEN));
		const value = bn.sub(bn.sum(buys), 1);
		await assert.rejects(this.market.buy(buys, buyer,
			{from: buyer, value: value}), ERRORS.INSUFFICIENT);
	});

	it('Cannot sell with insufficient funds', async function() {
		const [seller] = _.sampleSize(this.users, 1);
		const balances = _.times(NUM_RESOURCES,
			i => bn.mul(Math.random(), ONE_TOKEN));
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
			i => bn.mul(Math.random(), ONE_TOKEN));
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
			i => bn.mul(Math.random(), ONE_TOKEN));
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

	it('Buying tokens increases supplies', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		const oldSupplies = await this.market.getSupplies();
		const buys = _.times(NUM_RESOURCES,
			i => bn.mul(Math.random(), ONE_TOKEN));
		const tx = await this.market.buy(buys, buyer,
			{from: buyer, value: bn.sum(buys)});
		const newSupplies = await this.market.getSupplies();
		for (const token of this.tokens) {
			const {bought} = tx.findEvent('Bought',
				{resource: token.address}).args;
			assert(bought);
			const before = oldSupplies[token.IDX];
			const after = newSupplies[token.IDX];
			assert.equal(after, bn.add(before, bought));
		}
	});

	it('Can sell all tokens', async function() {
		const [seller] = _.sampleSize(this.users, 1);
		const token = _.sample(this.tokens);
		const balance = bn.mul(ONE_TOKEN, 1);
		const initialEthBalance = await this.eth.getBalance(seller);
		await this.market.mint(token.address, seller, balance);
		const tx = await this.market.sell(
			token.address, balance, seller,
			{from: seller});
		const event = tx.findEvent('Sold',
			{resource: token.address, to: seller});
		assert(!_.isNil(event));
		assert.equal(
			await token.balanceOf(seller),
			bn.parse(0), );
		assert(bn.gt(await this.eth.getBalance(seller), initialEthBalance));
	});

	it('Can sell some tokens', async function() {
		const [seller] = _.sampleSize(this.users, 1);
		const token = _.sample(this.tokens);
		const balance = bn.mul(ONE_TOKEN, 1);
		const amount = bn.mul(balance, 0.1);
		const initialEthBalance = await this.eth.getBalance(seller);
		await this.market.mint(token.address, seller, balance);
		const tx = await this.market.sell(
			token.address, amount, seller,
			{from: seller});
		const event = tx.findEvent('Sold',
			{resource: token.address, to: seller});
		assert(!_.isNil(event));
		assert.equal(
			await token.balanceOf(seller),
			bn.sub(balance, amount));
		assert(bn.gt(await this.eth.getBalance(seller), initialEthBalance));
	});

	it('Can sell tokens to another', async function() {
		const [seller, dst] = _.sampleSize(this.users, 2);
		const token = _.sample(this.tokens);
		const balance = bn.mul(ONE_TOKEN, 1);
		const amount = bn.mul(balance, 0.1);
		const initialEthBalance = await this.eth.getBalance(dst);
		await this.market.mint(token.address, seller, balance);
		const tx = await this.market.sell(
			token.address, amount, dst,
			{from: seller});
		const event = tx.findEvent('Sold',
			{resource: token.address, to: dst});
		assert(!_.isNil(event));
		assert.equal(
			await token.balanceOf(seller),
			bn.sub(balance, amount));
		assert(bn.gt(await this.eth.getBalance(dst), initialEthBalance));
	});

	it('Selling tokens decreases supply', async function() {
		const [seller] = _.sampleSize(this.users, 1);
		const token = _.sample(this.tokens);
		const balance = bn.mul(ONE_TOKEN, 1);
		const amount = bn.mul(balance, 0.1);
		await this.market.mint(token.address, seller, balance);
		const oldSupply = await token.totalSupply();
		const tx = await this.market.sell(
			token.address, amount, seller,
			{from: seller});
		const {sold} = tx.findEvent('Sold').args;
		const newSupply = await token.totalSupply();
		assert.equal(newSupply, bn.sub(oldSupply, sold));
	});

	it('Raises Funded even when funded', async function() {
		const [funder] = _.sampleSize(this.users, 1);
		const amount = bn.mul(ONE_TOKEN, 0.5);
		await this.eth.transfer(this.market.address, amount,
			{from: funder});
		const events = await this.market.Funded({fromBlock: -1, toBlock: -1});
		assert(events.length == 1);
		assert(events[0].name == 'Funded');
		const {value} = events[0].args;
		assert.equal(value, amount);
	});

	it('DOES NOT update yesterday\'s price after < a day has passed', async function() {
		const [user] = _.sampleSize(this.users, 1);
		const token = _.sample(this.tokens);
		await this.market.__advanceTime(ONE_DAY);
		await this.market.mint(token.address, user, ONE_TOKEN);
		const {priceYesterday: prevYP} =
			await this.market.getState(token.address);
		await this.market.__advanceTime(ONE_DAY-1);
		await this.market.buy(token.address, user,
			{value: ONE_TOKEN, from: user});
		const {priceYesterday: newYP} =
			await this.market.getState(token.address);
		assert.equal(prevYP, newYP);
	});

	it('Buy updates yesterday\'s price after a day has passed', async function() {
		const [user] = _.sampleSize(this.users, 1);
		const token = _.sample(this.tokens);
		await this.market.__advanceTime(ONE_DAY);
		await this.market.mint(token.address, user, ONE_TOKEN);
		const {priceYesterday: prevYP} =
			await this.market.getState(token.address);
		await this.market.__advanceTime(ONE_DAY);
		await this.market.buy(token.address, user,
			{value: ONE_TOKEN, from: user});
		const {priceYesterday: newYP} =
			await this.market.getState(token.address);
		assert.notEqual(prevYP, newYP);
	});

	it('Sell updates yesterday\'s price after a day has passed', async function() {
		const [user] = _.sampleSize(this.users, 1);
		const token = _.sample(this.tokens);
		await this.market.__advanceTime(ONE_DAY);
		await this.market.mint(token.address, user, ONE_TOKEN);
		const {priceYesterday: prevYP} =
			await this.market.getState(token.address);
		await this.market.__advanceTime(ONE_DAY);
		await this.market.sell(token.address, bn.mul(ONE_TOKEN, 0.5), user,
			{from: user});
		const {priceYesterday: newYP} =
			await this.market.getState(token.address);
		assert.notEqual(prevYP, newYP);
	});

	it('mint updates yesterday\'s price after a day has passed', async function() {
		const [user] = _.sampleSize(this.users, 1);
		const token = _.sample(this.tokens);
		await this.market.__advanceTime(ONE_DAY);
		await this.market.mint(token.address, user, ONE_TOKEN);
		const {priceYesterday: prevYP} =
			await this.market.getState(token.address);
		await this.market.__advanceTime(ONE_DAY);
		await this.market.mint(token.address, user, ONE_TOKEN);
		const {priceYesterday: newYP} =
			await this.market.getState(token.address);
		assert.notEqual(prevYP, newYP);
	});

	it('burn updates yesterday\'s price after a day has passed', async function() {
		const [user] = _.sampleSize(this.users, 1);
		const token = _.sample(this.tokens);
		await this.market.__advanceTime(ONE_DAY);
		await this.market.mint(token.address, user, ONE_TOKEN);
		const {priceYesterday: prevYP} =
			await this.market.getState(token.address);
		await this.market.__advanceTime(ONE_DAY);
		await this.market.burn(token.address, user, bn.mul(ONE_TOKEN, 0.5));
		const {priceYesterday: newYP} =
			await this.market.getState(token.address);
		assert.notEqual(prevYP, newYP);
	});

	it('funding updates yesterday\'s price after a day has passed', async function() {
		const [user] = _.sampleSize(this.users, 1);
		const token = _.sample(this.tokens);
		await this.market.__advanceTime(ONE_DAY);
		await this.market.mint(token.address, user, ONE_TOKEN);
		const {priceYesterday: prevYP} =
			await this.market.getState(token.address);
		await this.market.__advanceTime(ONE_DAY);
		await this.eth.transfer(this.market.address, ONE_TOKEN, {from: user});
		const {priceYesterday: newYP} =
			await this.market.getState(token.address);
		assert.notEqual(prevYP, newYP);
	});
});
