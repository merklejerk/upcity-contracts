'use strict'
const _ = require('lodash');
const assert = require('assert');
const bn = require('bn-str-256');
const testbed = require('../src/testbed');
const constants = require('../constants.js');
const ERRORS = require('./lib/errors.js');

const {MAX_UINT, ONE_TOKEN, ZERO_ADDRESS} = testbed;
const RESERVE = ONE_TOKEN;
const MARKET_DEPOSIT = bn.mul(0.1, ONE_TOKEN);
const CONNECTOR_WEIGHT = 0.66;
const ONE_DAY = 60 * 60 * 24;
const NUM_RESOURCES = constants.NUM_RESOURCES;
const RESOURCE_NAMES = constants.RESOURCE_NAMES;
const RESOURCE_SYMBOLS = constants.RESOURCE_SYMBOLS;

describe(/([^/\\]+?)(\..*)?$/.exec(__filename)[1], function() {

	before(async function() {
		_.assign(this, await testbed({
			contracts: ['UpcityResourceToken', 'UpcityMarket']}));
		this.authority = this.accounts[0];
		this.users = _.slice(this.accounts, 1);
		this.market = this.contracts['UpcityMarket'];

		// Deploy the market and tokens.
		await this.market.new(Math.round(1e6 * CONNECTOR_WEIGHT));
		this.tokens = [];
		for (let [name, symbol] of _.zip(RESOURCE_NAMES, RESOURCE_SYMBOLS)) {
			const token = this.contracts['UpcityResourceToken'].clone();
			await token.new(
				name,
				symbol,
				RESERVE,
				[this.market.address]);
			this.tokens.push(token);
		}
		await this.market.init(
			_.map(this.tokens, t => t.address),
			[this.authority],
			{value: MARKET_DEPOSIT});
	});

	beforeEach(async function() {
		this.snapshotId = await this.saveSnapshot();
	});

	afterEach(async function() {
		await this.restoreSnapshot(this.snapshotId);
	});

	it('Cannot get the price of an unknown token', async function() {
		const token = testbed.randomAddress();
		assert.rejects(this.market.getPrice(token), ERRORS.INVALID);
	});

	it('Cannot get the market state of an unknown token', async function() {
		const token = testbed.randomAddress();
		assert.rejects(this.market.getState(token), ERRORS.INVALID);
	});

	it('Can get the price of a token', async function() {
		const token = _.sample(this.tokens).address;
		assert(bn.gt(await this.market.getPrice(token), 0));
	});

	it('Can get the market state of a token', async function() {
		const token = _.sample(this.tokens).address;
		assert(await this.market.getState(token));
	});

	it('Cannot buy unknown token', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		const token = testbed.randomAddress();
		const payment = bn.mul(ONE_TOKEN, 0.5);
		assert.rejects(this.market.buy(token, buyer,
			{from: buyer, value: payment}), ERRORS.INVALID);
	});

	it('Cannot buy if uninitialized', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		const token = _.sample(this.tokens);
		const payment = bn.mul(ONE_TOKEN, 0.5);
		await this.market.__uninitialize();
		assert.rejects(this.market.buy(token.address, buyer,
			{from: buyer, value: payment}), ERRORS.UNINITIALIZED);
	});

	it('Cannot sell if uninitialized', async function() {
		const [seller] = _.sampleSize(this.users, 1);
		const token = _.sample(this.tokens);
		const amount = bn.mul(ONE_TOKEN, 0.5);
		await this.market.mint(token.address, seller, amount);
		await this.market.__uninitialize();
		assert.rejects(this.market.sell(
			token.address, seller, amount,
			{from: seller}), ERRORS.UNINITIALIZED);
	});

	it('Cannot buy zero', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		const token = _.sample(this.tokens);
		const payment = 0;
		assert.rejects(this.market.buy(token.address, buyer,
			{from: buyer, value: payment}), ERRORS.INVALID);
	});

	it('Cannot sell zero', async function() {
		const [seller] = _.sampleSize(this.users, 1);
		const token = _.sample(this.tokens);
		const amount = 0;
		const balance = bn.mul(ONE_TOKEN, 1);
		await this.market.mint(token.address, seller, balance);
		await this.market.__uninitialize();
		assert.rejects(this.market.sell(
			token.address, seller, amount,
			{from: seller}), ERRORS.INVALID);
	});

	it('Cannot sell with insufficient funds', async function() {
		const [seller] = _.sampleSize(this.users, 1);
		const token = _.sample(this.tokens);
		const balance = bn.mul(ONE_TOKEN, 1);
		const amount = bn.add(balance, 1);
		await this.market.mint(token.address, seller, balance);
		await this.market.__uninitialize();
		assert.rejects(this.market.sell(
			token.address, seller, amount,
			{from: seller}));
	});

	it('Can buy token', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		const token = _.sample(this.tokens);
		const payment = bn.mul(ONE_TOKEN, 0.1);
		const tx = await this.market.buy(
			token.address, buyer, {value: payment, from: buyer});
		const event = tx.findEvent('Bought',
			{resource: token.address, to: buyer});
		assert(!_.isNil(event));
		assert.equal(
			await token.balanceOf(buyer),
			event.args.bought);
	});

	it('Can buy token for another', async function() {
		const [payer, dst] = _.sampleSize(this.users, 2);
		const token = _.sample(this.tokens);
		const payment = bn.mul(ONE_TOKEN, 0.1);
		const tx = await this.market.buy(
			token.address, dst, {value: payment, from: payer});
		const event = tx.findEvent('Bought',
			{resource: token.address, to: dst});
		assert(!_.isNil(event));
		assert.equal(
			await token.balanceOf(dst),
			event.args.bought);
	});

	it('Buying tokens increases supply', async function() {
		const [buyer] = _.sampleSize(this.users, 1);
		const token = _.sample(this.tokens);
		const oldSupply = await token.totalSupply();
		const payment = bn.mul(ONE_TOKEN, 0.1);
		const tx = await this.market.buy(
			token.address, buyer, {value: payment, from: buyer});
		const {bought} = tx.findEvent('Bought').args;
		const newSupply = await token.totalSupply();
		assert.equal(newSupply, bn.add(oldSupply, bought));
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
