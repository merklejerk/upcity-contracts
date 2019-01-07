'use strict'
const _ = require('lodash');
const crypto = require('crypto');
const {promisify} = require('util');
const fs = require('mz/fs');
const path = require('path');
const ganache = require('ganache-cli');
const bn = require('bn-str-256');
const ethjs = require('ethereumjs-util');
const FlexContract = require('flex-contract');
const FlexEther = require('flex-ether');
const process = require('process');
const project = require('./project');

process.on('unhandledRejection', (err) => {});
const ONE_TOKEN = bn.parse('1e18');
const MAX_UINT = bn.sub(bn.pow(2, 256), 1);
const ZERO_ADDRESS = '0x' + _.repeat('0', 40);

function createAccounts(accounts, balance=bn.mul(1e6, ONE_TOKEN)) {
	if (_.isArray(accounts)) {
		return _.map(accounts, acct => {
			if (_.isString(acct)) {
				const secret = acct;
				return {
					address: secretToAddress(secret),
					secret: secret,
					balance: bn.parse(balance)
				};
			}
			let secret = acct.privateKey || acct.secret;
			if (!secret)
				throw new Error('Account secret not defined.');
			const addr = secretToAddress(secret);
			return {
				address: addr,
				secret: secret,
				balance: bn.parse(acct.balance || balance)
			};
		});
	}
	if (_.isPlainObject(accounts))
		return _.map(accounts, (v,k) => ({
			address: secretToAddress(k),
			secret: k,
			balance: bn.parse(v)}));
	if (!_.isNumber(accounts))
		accounts = 128;
	return _.times(accounts, i =>
		_.assign(randomAccount(), {balance: balance}));
}

function randomAccount() {
	const secret = randomPrivateKey();
	return {
		address: secretToAddress(secret),
		secret: secret
	};
}

function secretToAddress(secret) {
	secret = ethjs.toBuffer(secret);
	return ethjs.toChecksumAddress(
		ethjs.privateToAddress(secret).toString('hex'));
}

function randomAddress() {
	return ethjs.toChecksumAddress(crypto.randomBytes(20).toString('hex'));
}

function randomPrivateKey() {
	return ethjs.bufferToHex(crypto.randomBytes(32));
}

async function saveSnapshot(provider) {
	const payload = {
		jsonrpc: '2.0',
		method: 'evm_snapshot',
		id: crypto.randomBytes(32).toString('hex'),
		params: []
	};
	const resp = await promisify(provider.sendAsync)(payload);
	if (resp.error)
		throw new Error(resp.error);
	return resp.result;
}

async function restoreSnapshot(provider, id) {
	const payload = {
		jsonrpc: '2.0',
		method: 'evm_revert',
		id: crypto.randomBytes(32).toString('hex'),
		params: [id]
	};
	const resp = await promisify(provider.sendAsync)(payload);
	if (resp.error)
		throw new Error(resp.error);
	return resp.result;
}

module.exports = async function(opts={}) {
	const accounts = createAccounts(opts.accounts, opts.balance);
	const providerOpts = {
		accounts: _.map(accounts, a => ({secretKey: a.secret, balance: a.balance})),
		allowUnlimitedContractSize: true,
		locked: false,
		unlocked_accounts: _.map(accounts, a => a.address),
		// Why does this have to be so high?
		gasLimit: 100e6
	};
	const provider = ganache.provider(providerOpts);
	const eth = new FlexEther({provider: provider, gasBonus: 0.75});
	provider.setMaxListeners(4096);
	provider.engine.setMaxListeners(4096);
	const artifacts = await (opts.contracts ?
		project.getArtifacts(opts.contracts) : project.getAllArtifacts());
	const contracts = _.mapValues(artifacts,
		a => new FlexContract(a, {eth: eth}));
	return {
		provider: provider,
		saveSnapshot: () => saveSnapshot(provider),
		restoreSnapshot: (id) => restoreSnapshot(provider, id),
		accounts: _.map(accounts, a => a.address),
		eth: eth,
		contracts: contracts
	};
};

module.exports.ONE_TOKEN = ONE_TOKEN;
module.exports.MAX_UINT = MAX_UINT;
module.exports.ZERO_ADDRESS = ZERO_ADDRESS;
module.exports.randomAddress = randomAddress;
