'use strict'
const _ = require('lodash');
const assert = require('assert');
const bn = require('bn-str-256');
const testbed = require('../src/testbed');
const constants = require('../constants.js');
const ERRORS = require('./lib/errors.js');

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

	before(async function() {
		await this.contract.new(
			TOKEN_NAME, TOKEN_SYMBOL, RESERVE, [this.authority]);
	});

	beforeEach(async function() {
		this.snapshotId = await this.saveSnapshot();
	});

	afterEach(async function() {
		await this.restoreSnapshot(this.snapshotId);
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
		assert.equal(await this.contract.balanceOf(wallet), bn.parse(amount));
	});

	it('Authority can burn', async function() {
		const [wallet] = _.sampleSize(this.users, 1);
		const amount = 100;
		await this.contract.mint(wallet, amount, {from: this.authority});
		await this.contract.burn(wallet, amount, {from: this.authority});
		assert.equal(await this.contract.balanceOf(wallet), '0');
	});

	it('Minting increases total supply', async function() {
		const [wallet] = _.sampleSize(this.users, 1);
		const amount = 100;
		const initialSupply = await this.contract.totalSupply();
		await this.contract.mint(wallet, amount, {from: this.authority});
		assert.equal(await this.contract.totalSupply(),
			bn.add(amount, initialSupply));
	});

	it('Burning reduces total supply', async function() {
		const [wallet] = _.sampleSize(this.users, 1);
		const amount = 100;
		const initialSupply = await this.contract.totalSupply();
		await this.contract.mint(wallet, amount, {from: this.authority});
		await this.contract.burn(wallet, amount, {from: this.authority});
		assert.equal(await this.contract.totalSupply(), initialSupply);
	});

	it('Non-authority cannot mint', async function() {
		const [wallet, actor] = _.sampleSize(this.users, 2);
		const amount = 100;
		await assert.rejects(
			this.contract.mint(wallet, amount, {from: actor}),
			ERRORS.RESTRICTED);
	});

	it('Non-authority cannot burn', async function() {
		const [wallet, actor] = _.sampleSize(this.users, 2);
		const amount = 100;
		await this.contract.mint(wallet, amount, {from: this.authority});
		await assert.rejects(
			this.contract.mint(wallet, amount, {from: actor}),
			ERRORS.RESTRICTED);
	});

	it('Cannot transfer with zero balance', async function() {
		const [sender, receiver] = _.sampleSize(this.users, 2);
		const amount = 1;
		return await assert.rejects(
			this.contract.transfer(receiver, amount, {from: sender}),
			ERRORS.INSUFFICIENT);
	});

	it('Cannot transferFrom with zero balance', async function() {
		const [sender, wallet, receiver] = _.sampleSize(this.users, 3);
		const amount = 1;
		return await assert.rejects(
			this.contract.transferFrom(wallet, receiver, amount, {from: sender}),
			ERRORS.INSUFFICIENT);
	});

	it('Cannot transfer more than balance', async function() {
		const [sender, receiver] = _.sampleSize(this.users, 2);
		const amount = 100;
		await this.contract.mint(sender, amount - 1, {from: this.authority});
		return await assert.rejects(
			this.contract.transfer(receiver, amount, {from: sender}),
			ERRORS.INSUFFICIENT);
	});

	it('Cannot transferFrom more than balance', async function() {
		const [sender, wallet, receiver] = _.sampleSize(this.users, 3);
		const amount = 100;
		await this.contract.mint(wallet, amount - 1, {from: this.authority});
		await this.contract.approve(sender, MAX_UINT, {from: wallet})
		return await assert.rejects(
			this.contract.transferFrom(wallet, receiver, amount, {from: sender}),
			ERRORS.INSUFFICIENT);
	});

	it('Cannot transferFrom more than allowance', async function() {
		const [sender, wallet, receiver] = _.sampleSize(this.users, 3);
		const amount = 100;
		await this.contract.mint(wallet, amount, {from: this.authority});
		await this.contract.approve(sender, amount - 1, {from: wallet})
		return await assert.rejects(
			this.contract.transferFrom(wallet, receiver, amount, {from: sender}),
			ERRORS.INSUFFICIENT);
	});

	it('Can transfer entire balance', async function() {
		const [sender, receiver] = _.sampleSize(this.users, 2);
		const amount = 100;
		await this.contract.mint(sender, amount, {from: this.authority});
		await this.contract.transfer(receiver, amount, {from: sender});
		assert.equal(
			await this.contract.balanceOf(receiver),
			bn.parse(amount));
	});

	it('Can transferFrom entire balance', async function() {
		const [sender, wallet, receiver] = _.sampleSize(this.users, 3);
		const amount = 100;
		await this.contract.mint(wallet, amount, {from: this.authority});
		await this.contract.approve(sender, MAX_UINT, {from: wallet});
		await this.contract.transferFrom(wallet, receiver, amount, {from: sender});
		assert.equal(
			await this.contract.balanceOf(receiver),
			bn.parse(amount));
	});

	it('Can transfer < balance', async function() {
		const [sender, receiver] = _.sampleSize(this.users, 2);
		const amount = 100;
		await this.contract.mint(sender, amount, {from: this.authority});
		await this.contract.transfer(receiver, amount - 1, {from: sender});
		assert.equal(
			await this.contract.balanceOf(receiver),
			bn.parse(amount - 1));
	});

	it('Can transferFrom < balance', async function() {
		const [sender, wallet, receiver] = _.sampleSize(this.users, 3);
		const amount = 100;
		await this.contract.mint(wallet, amount, {from: this.authority});
		await this.contract.approve(sender, MAX_UINT, {from: wallet});
		await this.contract.transferFrom(wallet, receiver, amount - 1, {from: sender});
		assert.equal(
			await this.contract.balanceOf(receiver),
			bn.parse(amount - 1));
	});

	it('Transfer to 0x0 burns tokens', async function() {
		const [sender] = _.sampleSize(this.users, 1);
		const amount = 100;
		const initialSupply = await this.contract.totalSupply();
		await this.contract.mint(sender, amount, {from: this.authority});
		await this.contract.transfer(ZERO_ADDRESS, amount, {from: sender});
		assert.equal(await this.contract.totalSupply(), initialSupply);
	});

	it('Transfer to contract burns tokens', async function() {
		const [sender] = _.sampleSize(this.users, 1);
		const amount = 100;
		const initialSupply = await this.contract.totalSupply();
		await this.contract.mint(sender, amount, {from: this.authority});
		await this.contract.transfer(this.contract.address, amount, {from: sender});
		assert.equal(await this.contract.totalSupply(), initialSupply);
	});

	it('TransferFrom to 0x0 burns tokens', async function() {
		const [sender, wallet] = _.sampleSize(this.users, 2);
		const amount = 100;
		const initialSupply = await this.contract.totalSupply();
		await this.contract.mint(wallet, amount, {from: this.authority});
		await this.contract.approve(sender, MAX_UINT, {from: wallet});
		await this.contract.transferFrom(wallet, ZERO_ADDRESS, amount, {from: sender});
		assert.equal(await this.contract.totalSupply(), initialSupply);
	});

	it('TransferFrom to contract burns tokens', async function() {
		const [sender, wallet] = _.sampleSize(this.users, 2);
		const amount = 100;
		const initialSupply = await this.contract.totalSupply();
		await this.contract.mint(wallet, amount, {from: this.authority});
		await this.contract.approve(sender, MAX_UINT, {from: wallet});
		await this.contract.transferFrom(wallet, this.contract.address, amount, {from: sender});
		assert.equal(await this.contract.totalSupply(), initialSupply);
	});
});
