'use strict'
const _ = require('lodash');
const assert = require('assert');
const bn = require('bn-str-256');
const testbed = require('../src/testbed');

const {MAX_UINT, ONE_TOKEN, ZERO_ADDRESS} = testbed;
const RESERVE = ONE_TOKEN;
const TOKEN_NAME = 'TestToken';
const TOKEN_SYMBOL = 'TTKN';

describe(/([^/\\]+?)(\..*)?$/.exec(__filename)[1], function() {
	before(async function() {
		_.assign(this, await testbed({contracts: ['UpcityResourceToken']}));
		this.authority = _.sample(this.accounts);
		this.users = _.without(this.accounts, this.authority);
		this.contract = this.contracts['UpcityResourceToken'];
	});

	beforeEach(async function() {
		return this.contract.new(
			TOKEN_NAME, TOKEN_SYMBOL, RESERVE, [this.authority]);
	});

	it('Can get the token name', async function() {
		const name = await this.contract.name();
		assert.equal(name, TOKEN_NAME);
	});

	it('Can get the token symbol', async function() {
		const sym = await this.contract.symbol();
		assert.equal(sym, TOKEN_SYMBOL);
	});

	it('Can get the authority', async function() {
		assert.equal(true,
			await this.contract.isAuthority(this.authority));
	});

	it('Authority can mint', async function() {
		const [wallet] = _.sampleSize(this.users, 1);
		const amount = 100;
		await this.contract.mint(wallet, amount, {from: this.authority});
		assert.equal(bn.parse(amount), await this.contract.balanceOf(wallet));
	});

	it('Minting increases total supply', async function() {
		const [wallet] = _.sampleSize(this.users, 1);
		const amount = 100;
		await this.contract.mint(wallet, amount, {from: this.authority});
		assert.equal(bn.add(amount, RESERVE), await this.contract.totalSupply());
	});

	it('Non-authority cannot mint', async function() {
		const [wallet, actor] = _.sampleSize(this.users, 2);
		const amount = 100;
		await assert.rejects(
			this.contract.mint(wallet, amount, {from: actor}));
	});

	it('Cannot transfer with zero balance', async function() {
		const [sender, receiver] = _.sampleSize(this.users, 2);
		const amount = 1;
		return await assert.rejects(
			this.contract.transfer(receiver, amount, {from: sender}));
	});

	it('Cannot transferFrom with zero balance', async function() {
		const [sender, wallet, receiver] = _.sampleSize(this.users, 3);
		const amount = 1;
		return await assert.rejects(
			this.contract.transferFrom(wallet, receiver, amount, {from: sender}));
	});

	it('Cannot transfer more than balance', async function() {
		const [sender, receiver] = _.sampleSize(this.users, 2);
		const amount = 100;
		await this.contract.mint(sender, amount - 1, {from: this.authority});
		return await assert.rejects(
			this.contract.transfer(receiver, amount, {from: sender}));
	});

	it('Cannot transferFrom more than balance', async function() {
		const [sender, wallet, receiver] = _.sampleSize(this.users, 3);
		const amount = 100;
		await this.contract.mint(wallet, amount - 1, {from: this.authority});
		await this.contract.approve(sender, MAX_UINT, {from: wallet})
		return await assert.rejects(
			this.contract.transferFrom(wallet, receiver, amount, {from: sender}));
	});

	it('Can transfer entire balance', async function() {
		const [sender, receiver] = _.sampleSize(this.users, 2);
		const amount = 100;
		await this.contract.mint(sender, amount, {from: this.authority});
		await this.contract.transfer(receiver, amount, {from: sender});
		assert.equal(bn.parse(amount), await this.contract.balanceOf(receiver));
	});

	it('Can transferFrom entire balance', async function() {
		const [sender, wallet, receiver] = _.sampleSize(this.users, 3);
		const amount = 100;
		await this.contract.mint(wallet, amount, {from: this.authority});
		await this.contract.approve(sender, MAX_UINT, {from: wallet});
		await this.contract.transferFrom(wallet, receiver, amount, {from: sender});
		assert.equal(bn.parse(amount), await this.contract.balanceOf(receiver));
	});

	it('Can transfer < balance', async function() {
		const [sender, receiver] = _.sampleSize(this.users, 2);
		const amount = 100;
		await this.contract.mint(sender, amount, {from: this.authority});
		await this.contract.transfer(receiver, amount - 1, {from: sender});
		assert.equal(bn.parse(amount - 1), await this.contract.balanceOf(receiver));
	});

	it('Can transferFrom < balance', async function() {
		const [sender, wallet, receiver] = _.sampleSize(this.users, 3);
		const amount = 100;
		await this.contract.mint(wallet, amount, {from: this.authority});
		await this.contract.approve(sender, MAX_UINT, {from: wallet});
		await this.contract.transferFrom(wallet, receiver, amount - 1, {from: sender});
		assert.equal(bn.parse(amount - 1), await this.contract.balanceOf(receiver));
	});

	it('Transfer to 0x0 burns tokens', async function() {
		const [sender] = _.sampleSize(this.users, 1);
		const amount = 100;
		await this.contract.mint(sender, amount, {from: this.authority});
		await this.contract.transfer(ZERO_ADDRESS, amount, {from: sender});
		assert.equal(bn.parse(RESERVE), await this.contract.totalSupply());
	});

	it('TransferFrom to contract burns tokens', async function() {
		const [sender, wallet] = _.sampleSize(this.users, 2);
		const amount = 100;
		await this.contract.mint(wallet, amount, {from: this.authority});
		await this.contract.approve(sender, MAX_UINT, {from: wallet});
		await this.contract.transferFrom(wallet, this.contract.address, amount, {from: sender});
		assert.equal(bn.parse(RESERVE), await this.contract.totalSupply());
	});
});
