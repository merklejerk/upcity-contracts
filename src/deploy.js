'use strict'
require('colors');
const _ = require('lodash');
const bn = require('bn-str-256');
const path = require('path');
const fs = require('mz/fs');
const bip39 = require('bip39');
const net = require('net');
const ethjs = {
	util: require('ethereumjs-util'),
	wallet: require('ethereumjs-wallet'),
	hdkey: require('ethereumjs-wallet/hdkey')
};
const FlexEther = require('flex-ether');
const FlexContract = require('flex-contract');
const minimist = require('minimist');
const project = require('./project');

async function getDeployerKey(cfg) {
	if (cfg.key) {
		// Private key is explicitly given.
		return ethjs.util.addHexPrefix(cfg.key);
	} else if (cfg.mnemonic) {
		// Private key is from a BIP39 seed phrase.
		return mnemonicToKey(cfg.mnemonic, cfg.accountIndex);
	} else if (cfg.keystore) {
		// Private key is from a keystore file.
		const pw = cfg.pasword.trim();
		if (!pw)
			throw new Error('No password provided for keystore.');
		const _path = path.resolve(path.dirname(project.DEPLOY_CONFIG_PATH),
			cfg.keystore);
		const contents = await fs.readFile(_path);
		const wallet = ethjs.wallet.fromV3(content, pw, true);
		return ethjs.util.bufferToHex(wallet.getPrivateKey());
	}
}

function mnemonicToKey(mnemonic, idx=0) {
	const m = /^\s*(.+)\s*$/.exec(mnemonic);
	const phrase = m[1].trim().replace(/\s+/g, ' ');
	idx = idx || 0;
	const seed = bip39.mnemonicToSeedHex(phrase);
	const _path = `m/44'/0'/0/${idx}`;
	const wallet = ethjs.hdkey.fromMasterSeed(seed).derivePath(_path).getWallet();
	return ethjs.util.bufferToHex(wallet.getPrivateKey());
}

async function loadConfig(target) {
	const cfg = require(project.DEPLOY_CONFIG_PATH);
	if (!(target in cfg))
		throw new Error(`Target "${target}" not found in deployment configuration.`)
	return cfg[target];
}

function loadProgramArguments() {
	const args = minimist(process.argv.slice(2), {
		alias: {
			'mnemonic': ['m'],
			'key': ['k'],
			'keystore': ['f'],
			'password': ['p'],
			'gas': ['g'],
			'account': ['a'],
			'account-index': ['n']
		},
		string: [
			'mnemonic',
			'key',
			'keystore',
			'password',
			'provider',
			'account',
			'infura-key',
			'network',
			'deployer'
		]
	});
	const target = args._[0];
	if (_.isNil(target))
		throw new Error('Deployment target must be given');
	return {
		target: target,
		mnemonic: args['mnemonic'],
		key: args['key'],
		keystore: args['keystore'],
		password: args['password'],
		gasPrice: args['gas'],
		account: args['account'],
		provider: args['provider'],
		accountIndex: args['account-index'],
		network: args['network'],
		infuraKey: args['infura-key'],
		deployer: args._['deployer'],
		target: target
	};
}

async function loadContracts(cfg, eth) {
	const artifacts = await (_.isArray(cfg.contracts) ?
		project.getArtifacts(cfg.contracts) : project.getAllArtifacts());
	return _.mapValues(artifacts, a => createContract(a, eth, cfg));
}

function createContract(artifact, eth, cfg) {
	const contract = new FlexContract(artifact, {eth: eth});
	// Create a FlexContract instance with baked-in default options.
	const defaults = {
		gasPrice: cfg.gasPrice
	};
	if (cfg.key)
		defaults.key = cfg.key;
	if (cfg.account)
		defaults.from = cfg.account;
	return hookContractMethods(contract, defaults);
}

function hookContractMethods(contract, defaults) {
	// Override all ABI functions.
	const overrideTypes = ['function', 'constructor']
	const defs = _.filter(contract.abi, i => _.includes(overrideTypes, i.type));
	for (let def of defs) {
		const name = def.name || 'new';
		const method = contract[name];
		if (_.isFunction(method)) {
			contract[name] = function(...args) {
				let opts = _.last(args);
				if (!_.isPlainObject(opts))
					args.push(opts = {});
				_.defaults(opts, defaults);
				return method.call(contract, ...args);
			}
		}
	}
	// Override clone() to hook the clone's methods too.
	const clone = _.bind(contract.clone, contract);
	contract.clone = (...args) => hookContractMethods(clone(...args), defaults);
	return contract;
}

function keyToAddress(key) {
	return ethjs.util.toChecksumAddress(
		ethjs.util.bufferToHex(
			ethjs.util.privateToAddress(
				ethjs.util.toBuffer(key))));
}

async function deploy(opts) {
	if (!_.isFunction(opts.deployer))
		throw new Error('A "deployer" function or script was not provided');
	const account = opts.config.account ?
		opts.config.account : keyToAddress(opts.config.key);
	console.log(`Deploying to "${opts.target.bold}" from ${account.blue.bold}...`);
	const contracts = await loadContracts(opts.config, opts.eth);
	return opts.deployer({
		contracts: contracts,
		eth: opts.eth,
		target: opts.target,
		config: opts.config,
		account: account
	});
}

async function main() {
	const args = loadProgramArguments();
	const cfg = _.defaults({}, args, await loadConfig(args.target));
	const eth = new FlexEther({
		net: net,
		provider: cfg.provider,
		network: cfg.network,
		infuraKey: cfg.infuraKey
	});

	_.assign(cfg, {
		account: cfg.account ?
			ethjs.util.addHexPrefix(cfg.account) : await eth.getDefaultAccount(),
		key: await getDeployerKey(cfg)
	});
	if (!cfg.account && !cfg.key)
		throw new Error('Cannot determine deployer account');
	// If the deployer is a string, assume it's a path to a script.
	let deployer = cfg.deployer;
	if (_.isString(cfg.deployer)) {
		const _path = path.resolve(
			path.dirname(project.DEPLOY_CONFIG_PATH), cfg.deployer);
		deployer = require(_path);
	}
	return deploy({config: cfg, eth: eth, target: args.target, deployer: deployer});
}

if (require.main === module) {
	(async () => {
		try {
			await main();
		} catch (err) {
			console.error(err);
			process.exit(-1);
		}
		process.exit();
	})();
}
