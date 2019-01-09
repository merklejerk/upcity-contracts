'use strict'
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
	// Create a FlexContract instance with baked-in default options.
	const defaults = {
		gasPrice: cfg.gasPrice
	};
	if (cfg.key)
		defaults.key = cfg.key;
	if (cfg.account)
		defaults.from = cfg.account;
	const contract = new FlexContract(artifact, {eth: eth});
	const overrideTypes = ['function', 'constructor']
	const defs = _.filter(artifact.abi, i => _.includes(overrideTypes, i.type));
	for (let def of defs) {
		const name = def.name || 'new';
		const method = contract[name];
		if (_.isFunction(method)) {
			contract[name] = function(...args) {
				let opts = _.last(args);
				if (!_.isPlainObject(opts))
					args.push(opts = {});
				_.defaults(opts, defaults);
				return method(...args);
			}
		}
	}
	return contract;
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
	if (_.isString(cfg.deployer)) {
		const _path = path.resolve(
			path.dirname(project.DEPLOY_CONFIG_PATH), cfg.deployer);
		cfg.deployer = require(_path);
	}
	if (!_.isFunction(cfg.deployer))
		throw new Error('A "deployer" function or script was not provided');
	const contracts = await loadContracts(cfg, eth);
	return cfg.deployer({
		contracts: contracts,
		eth: eth,
		target: args.target,
		config: cfg
	});
}

if (require.main === module) {
	(async () => {
		try {
			await main();
		} catch (err) {
			console.error(err);
			process.exitCode = -1;
		}
	})();
}
