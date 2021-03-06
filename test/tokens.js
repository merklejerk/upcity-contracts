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
const TOKEN_NAME = 'TestToken';
const TOKEN_SYMBOL = 'TTKN';

describe(/([^/\\]+?)(\..*)?$/.exec(__filename)[1], function() {
	before(async function() {
		_.assign(this, await testbed({
			contracts: ['UpcityMarket', 'UpcityResourceTokenProxy']}));
		this.authority = _.sample(this.accounts);
		this.users = _.without(this.accounts, this.authority);
		this.tokens = this.contracts['UpcityResourceTokenProxy'];
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
				.new(inst.NAME, inst.SYMBOL, market.address);
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

	it('can get the token name', async function() {
		const token = this.randomToken();
		const name = await token.name();
		assert.equal(name, token.NAME);
	});

	it('can get the token symbol', async function() {
		const token = this.randomToken();
		const sym = await token.symbol();
		assert.equal(sym, token.SYMBOL);
	});

	it('can get the authority', async function() {
		assert.equal(
			await this.market.isAuthority(this.authority),
			true);
	});

	it('authority can mint', async function() {
		const token = this.randomToken();
		const [wallet] = this.randomUsers();
		const amount = 100;
		const balances = _.times(NUM_TOKENS, i => i == token.IDX ? amount : 0);
		await this.market.mint(wallet, balances, {from: this.authority});
		const newBalances = await this.market.getBalances(wallet);
		assert.deepEqual(newBalances, balances);
	});

	it('non-authority cannot mint', async function() {
		const token = this.randomToken();
		const [wallet, caller] = this.randomUsers(2);
		const amount = 100;
		const balances = _.times(NUM_TOKENS, i => i == token.IDX ? amount : 0);
		await assert.rejects(this.market.mint(wallet, balances, {from: caller}),
			ERRORS.RESTRICTED);
	});

	it('authority can mint multiple tokens at once', async function() {
		const [wallet] = this.randomUsers();
		const balances = _.times(NUM_TOKENS, i => _.random(1, 100));
		await this.market.mint(wallet, balances, {from: this.authority});
		const actual = await this.market.getBalances(wallet);
		assert.deepEqual(actual, balances);
	});

	it('minting first depletes stashed tokens', async function() {
		const token = this.randomToken();
		const [wallet] = this.randomUsers();
		const amount = 100;
		const stash = _.random(0, amount-1);
		await this.market.mint(wallet,
			_.times(NUM_TOKENS, i => i == token.IDX ? stash : 0),
			{from: this.authority});
		await this.market.stash(wallet,
			_.times(NUM_TOKENS, i => i == token.IDX ? stash : 0 ),
			{from: this.authority});
		assert.equal((await this.market.describeToken(token.address)).stash, stash);
		await this.market.mint(wallet,
			_.times(NUM_TOKENS, i => i == token.IDX ? amount : 0 ),
			{from: this.authority});
		const bal = await this.market.getBalance(token.address, wallet);
		assert.equal(bal, amount);
		assert.equal((await this.market.describeToken(token.address)).stash, 0);
	});

	it('authority can stash tokens', async function() {
		const token = this.randomToken();
		const [wallet] = this.randomUsers();
		const amount = 100;
		await this.market.mint(wallet, _.times(NUM_TOKENS, i => amount),
			{from: this.authority});
		const stash = _.times(NUM_TOKENS, i => {
			if (i == token.IDX)
			 	return bn.int(bn.mul(Math.random(), amount));
			return '0';
		});
		const tx = await this.market.stash(wallet, stash, {from: this.authority});
		// Ensure wallet's tokens were moved to the market.
		let balancesBefore = await this.market.getBalances(wallet,
			{block: tx.blockNumber-1});
		let balancesAfter = await this.market.getBalances(wallet);
		let expected = _.map(_.zip(balancesBefore, stash), a => bn.sub(a[0], a[1]));
		assert.deepEqual(balancesAfter, expected);
		let stashBefore = _.map(
			await Promise.all(_.map(this.tokens,
				token => this.market.describeToken(token.address, {block: tx.blockNumber-1}))),
			state => state.stash);
		let stashAfter = _.map(
			await Promise.all(_.map(this.tokens,
				token => this.market.describeToken(token.address))),
			state => state.stash);
		expected = _.map(_.zip(stashBefore, stash), a => bn.add(a[0], a[1]));
		assert.deepEqual(stashAfter, expected);
		// Ensure that the supply is unchanged.
		assert.deepEqual(
			await this.market.getSupplies({from: tx.blockNumber-1}),
			await this.market.getSupplies());
	});

	it('non-authority cannot stash tokens', async function() {
		const token = this.randomToken();
		const [wallet, caller] = this.randomUsers(2);
		const amount = 100;
		const balances = _.times(NUM_TOKENS, i => i == token.IDX ? amount : 0);
		await this.market.mint(wallet, balances, {from: this.authority});
		const stash = _.times(NUM_TOKENS, i => i == token.IDX ? amount : 0);
		await assert.rejects(this.market.stash(wallet, stash, {from: caller}),
			ERRORS.RESTRICTED);
	});

	it('cannot stash > balance', async function() {
		const token = this.randomToken();
		const [wallet, caller] = this.randomUsers(2);
		const amount = 100;
		const balances = _.times(NUM_TOKENS, i => i == token.IDX ? amount : 0);
		await this.market.mint(wallet, balances, {from: this.authority});
		const stash = _.times(NUM_TOKENS, i => i == token.IDX ? amount + 1 : 0);
		await assert.rejects(this.market.stash(wallet, stash, {from: this.authority}),
			ERRORS.INSUFFICIENT);
	});

	it('authority cannot call market proxyTransfer', async function() {
		const token = this.randomToken();
		const [wallet, dst] = this.randomUsers(2);
		const amount = 100;
		const balances = _.times(NUM_TOKENS, i => i == token.IDX ? amount : 0);
		await this.market.mint(wallet, balances, {from: this.authority});
		await assert.rejects(
			this.market.proxyTransfer(wallet, dst, amount,
				{from: this.authority}), ERRORS.RESTRICTED);
	});

	it('users cannot call market transfer', async function() {
		const token = this.randomToken();
		const [wallet, dst, rando] = this.randomUsers(3);
		const amount = 100;
		const balances = _.times(NUM_TOKENS, i => i == token.IDX ? amount : 0);
		await this.market.mint(wallet, balances, {from: this.authority});
		await assert.rejects(
			this.market.transfer(wallet, dst, balances, {from: wallet}),
			ERRORS.RESTRICTED);
		await assert.rejects(
			this.market.transfer(wallet, dst, balances, {from: dst}),
			ERRORS.RESTRICTED);
		await assert.rejects(
			this.market.transfer(wallet, dst, balances, {from: rando}),
			ERRORS.RESTRICTED);
	});

	it('users cannot call market proxyTransfer', async function() {
		const token = this.randomToken();
		const [wallet, dst, rando] = this.randomUsers(3);
		const amount = 100;
		const balances = _.times(NUM_TOKENS, i => i == token.IDX ? amount : 0);
		await this.market.mint(wallet, balances, {from: this.authority});
		await assert.rejects(
			this.market.proxyTransfer(wallet, dst, amount, {from: wallet}),
			ERRORS.RESTRICTED);
	});

	it('token.balanceOf returns slice of market.getBalance', async function() {
		const [wallet] = this.randomUsers();
		const balances = _.times(NUM_TOKENS, i => _.random(1, 100));
		await this.market.mint(wallet, balances, {from: this.authority});
		const actual =
			await Promise.all(_.map(this.tokens, t => t.balanceOf(wallet)));
		assert.deepEqual(actual, balances);
	});

	it('token.totalSupply returns slice of market.getSupplies', async function() {
		const [wallet] = this.randomUsers();
		const balances = _.times(NUM_TOKENS, i => _.random(1, 100));
		await this.market.mint(wallet, balances, {from: this.authority});
		const actual =
			await Promise.all(_.map(this.tokens, t => t.totalSupply()));
		const expected = await this.market.getSupplies();
		assert.deepEqual(actual, expected);
	});

	it('minting increases total supply', async function() {
		const token = this.randomToken();
		const [wallet] = this.randomUsers();
		const oldSupplies = await this.market.getSupplies();
		const amount = 100;
		const mint = _.times(NUM_TOKENS, i => i == token.IDX ? amount : 0);
		await this.market.mint(wallet, mint, {from: this.authority});
		const newSupplies = await this.market.getSupplies();
		const expected = _.map(_.zip(oldSupplies, mint), a => bn.sum(a));
		assert.deepEqual(newSupplies, expected);
	});

	it('minting increases balance of user', async function() {
		const token = this.randomToken();
		const [wallet] = this.randomUsers();
		const amount = 100;
		const mint = _.times(NUM_TOKENS, i => i == token.IDX ? amount : 0);
		await this.market.mint(wallet, mint, {from: this.authority});
		const oldBalances = await this.market.getBalances(wallet);
		await this.market.mint(wallet, mint, {from: this.authority});
		const newBalances = await this.market.getBalances(wallet);
		const expected = _.map(_.zip(oldBalances, mint), a => bn.sum(a));
		assert.deepEqual(newBalances, expected);
	});

	it('cannot transfer more than balance', async function() {
		const token = this.randomToken();
		const [spender, receiver] = this.randomUsers(2);
		const amount = 100;
		const balances = _.times(NUM_TOKENS, i => i == token.IDX ? amount : 0);
		await this.market.mint(spender, balances, {from: this.authority});
		return await assert.rejects(
			token.transfer(receiver, amount+1, {from: spender}),
			ERRORS.INSUFFICIENT);
	});

	it('cannot transferFrom more than balance', async function() {
		const token = this.randomToken();
		const [spender, wallet, receiver] = this.randomUsers(3);
		const amount = 100;
		const balances = _.times(NUM_TOKENS, i => i == token.IDX ? amount : 0);
		await this.market.mint(wallet, balances, {from: this.authority});
		await token.approve(spender, MAX_UINT, {from: wallet})
		return await assert.rejects(
			token.transfer(receiver, amount+1, {from: spender}),
			ERRORS.INSUFFICIENT);
	});

	it('cannot transferFrom more than allowance', async function() {
		const token = this.randomToken();
		const [spender, wallet, receiver] = _.sampleSize(this.users, 3);
		const amount = 100;
		const balances = _.times(NUM_TOKENS, i => i == token.IDX ? amount : 0);
		await this.market.mint(wallet, balances, {from: this.authority});
		await token.approve(spender, amount - 1, {from: wallet})
		return await assert.rejects(
			token.transferFrom(wallet, receiver, amount, {from: spender}),
			ERRORS.INSUFFICIENT);
	});

	it('can transfer entire balance', async function() {
		const token = this.randomToken();
		const [spender, receiver] = _.sampleSize(this.users, 2);
		const amount = 100;
		const balances = _.times(NUM_TOKENS, i => i == token.IDX ? amount : 0);
		await this.market.mint(spender, balances, {from: this.authority});
		await token.transfer(receiver, amount, {from: spender});
		assert.equal(
			await token.balanceOf(receiver),
			amount);
		assert.equal(
			await token.balanceOf(spender),
			0);
	});

	it('can transferFrom entire balance', async function() {
		const token = this.randomToken();
		const [spender, wallet, receiver] = _.sampleSize(this.users, 3);
		const amount = 100;
		const balances = _.times(NUM_TOKENS, i => i == token.IDX ? amount : 0);
		await this.market.mint(wallet, balances, {from: this.authority});
		await token.approve(spender, MAX_UINT, {from: wallet});
		await token.transferFrom(wallet, receiver, amount, {from: spender});
		assert.equal(
			await token.balanceOf(receiver),
			bn.parse(amount));
		assert.equal(
			await token.balanceOf(wallet),
			0);
	});

	it('can transfer < balance', async function() {
		const token = this.randomToken();
		const [spender, receiver] = _.sampleSize(this.users, 2);
		const amount = 100;
		const balances = _.times(NUM_TOKENS, i => i == token.IDX ? amount + 1: 0);
		await this.market.mint(spender, balances, {from: this.authority});
		await token.transfer(receiver, amount, {from: spender});
		assert.equal(
			await token.balanceOf(receiver),
			amount);
		assert.equal(
			await token.balanceOf(spender),
			balances[token.IDX] - amount);
	});

	it('can transferFrom < balance', async function() {
		const token = this.randomToken();
		const [spender, wallet, receiver] = _.sampleSize(this.users, 3);
		const amount = 100;
		const balances = _.times(NUM_TOKENS, i => i == token.IDX ? amount + 1: 0);
		await this.market.mint(wallet, balances, {from: this.authority});
		await token.approve(spender, amount, {from: wallet});
		await token.transferFrom(wallet, receiver, amount, {from: spender});
		assert.equal(
			await token.balanceOf(receiver),
			amount);
		assert.equal(
			await token.balanceOf(wallet),
			balances[token.IDX] - amount);
	});

	it('approve sets allowance', async function() {
		const token = this.randomToken();
		const [spender, wallet] = _.sampleSize(this.users, 2);
		const amount = 1337;
		await token.approve(spender, amount, {from: wallet});
		const allowance = await token.allowance(wallet, spender);
		assert.equal(allowance, amount);
	});

	it('approve overwrites previous allowance', async function() {
		const token = this.randomToken();
		const [spender, wallet] = _.sampleSize(this.users, 2);
		await token.approve(spender, 100, {from: wallet});
		const amount = 1337;
		await token.approve(spender, amount, {from: wallet});
		const allowance = await token.allowance(wallet, spender);
		assert.equal(allowance, amount);
	});

	it('allowance is initially zero', async function() {
		const token = this.randomToken();
		const [spender, wallet] = _.sampleSize(this.users, 2);
		const allowance = await token.allowance(wallet, spender);
		assert.equal(allowance, 0);
	});

	it('transferFrom reduces allowance', async function() {
		const token = this.randomToken();
		const [spender, wallet, receiver] = _.sampleSize(this.users, 3);
		const amount = 100;
		const balances = _.times(NUM_TOKENS, i => i == token.IDX ? amount : 0);
		await this.market.mint(wallet, balances, {from: this.authority});
		await token.approve(spender, MAX_UINT, {from: wallet});
		await token.transferFrom(wallet, receiver, amount, {from: spender});
		const allowance = await token.allowance(wallet, spender);
		assert.equal(
			allowance,
			bn.sub(MAX_UINT, amount));
	});

	it('token transfer to 0x0 is not allowed', async function() {
		const token = this.randomToken();
		const [spender, receiver] = _.sampleSize(this.users, 2);
		const amount = 100;
		const balances = _.times(NUM_TOKENS, i => i == token.IDX ? amount : 0);
		await this.market.mint(spender, balances, {from: this.authority});
		await assert.rejects(
			token.transfer(ZERO_ADDRESS, amount, {from: spender}), ERRORS.INVALID);
	});

	it('token transfer to token contract is not allowed', async function() {
		const token = this.randomToken();
		const [spender, receiver] = _.sampleSize(this.users, 2);
		const amount = 100;
		const balances = _.times(NUM_TOKENS, i => i == token.IDX ? amount : 0);
		await this.market.mint(spender, balances, {from: this.authority});
		await assert.rejects(
			token.transfer(token.address, amount, {from: spender}), ERRORS.INVALID);
	});

	it('token transfer to market contract is not allowed', async function() {
		const token = this.randomToken();
		const [spender] = _.sampleSize(this.users, 1);
		const amount = 100;
		const balances = _.times(NUM_TOKENS, i => i == token.IDX ? amount : 0);
		await this.market.mint(spender, balances, {from: this.authority});
		await assert.rejects(
			token.transfer(this.market.address, amount, {from: spender}), ERRORS.INVALID);
	});
});
