'use strict'
const _ = require('lodash');
const crypto = require('crypto');
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

function createAccounts(accounts, balance=bn.mul(100, ONE_TOKEN)) {
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

module.exports = async function(opts={}) {
	const accounts = createAccounts(opts.accounts, opts.balance);
	const providerOpts = {
		accounts: _.map(accounts, a => ({secretKey: a.secret, balance: a.balance})),
		allowUnlimitedContractSize: true,
		locked: false,
		unlocked_accounts: _.map(accounts, a => a.address),
		gasLimit: 10e6
	};
	const provider = ganache.provider(providerOpts);
	const eth = new FlexEther({provider: provider, gasBonus: 0.75});
	provider.setMaxListeners(4096);
	provider.engine.setMaxListeners(4096);
	const artifacts = await Promise.all(
		_.map(opts.contracts || [], n => project.getArtifact(n)));
	const contractOpts = {
		eth: eth,
	};
	const contracts = _.zipObject(opts.contracts || [],
		_.times(artifacts.length,
			i => new FlexContract(artifacts[i], contractOpts)));
	return {
		provider: provider,
		accounts: _.map(accounts, a => a.address),
		eth: eth,
		contracts: contracts
	};
};

module.exports.ONE_TOKEN = ONE_TOKEN;
module.exports.MAX_UINT = MAX_UINT;
module.exports.ZERO_ADDRESS = ZERO_ADDRESS;
module.exports.randomAddress = randomAddress;
