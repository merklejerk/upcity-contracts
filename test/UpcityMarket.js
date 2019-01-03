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
const CONNECTOR_WEIGHT = Math.round(1e6 * constants.CONNECTOR_WEIGHT);
const NUM_TOKENS = constants.NUM_RESOURCES;

describe(/([^/\\]+?)(\..*)?$/.exec(__filename)[1], function() {
	before(async function() {
		_.assign(this, await testbed({
			contracts: ['UpcityResourceToken', 'UpcityMarket']}));
		this.users = _.slice(this.accounts, 1);
		this.market = this.contracts['UpcityMarket'];
	});

	before(async function() {
		await this.market.new(CONNECTOR_WEIGHT);
		this.tokens = [];
		for (let i = 0; i < NUM_TOKENS; i++) {
			const token = this.contracts['UpcityResourceToken'].clone();
			await token.new(
				`Token-${i}`, `TTK${i}`, RESERVE);
			await token.init([this.market.address, this.accounts[0]]);
			this.tokens.push(token);
		}
		await this.market.init(
			_.map(this.tokens, t => t.address),
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

	it('Can get the price of a token', async function() {
		const token = _.sample(this.tokens).address;
		assert(bn.gt(await this.market.getPrice(token), 0));
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
		await token.mint(seller, amount);
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
		await token.mint(seller, balance);
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
		await token.mint(seller, balance);
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

	it('Can sell all tokens', async function() {
		const [seller] = _.sampleSize(this.users, 1);
		const token = _.sample(this.tokens);
		const balance = bn.mul(ONE_TOKEN, 1);
		const initialEthBalance = await this.eth.getBalance(seller);
		await token.mint(seller, balance);
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
		await token.mint(seller, balance);
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
		await token.mint(seller, balance);
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
});
