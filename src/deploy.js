const _ = require('lodash');
const bn = require('bn-str-256');
const path = require('path');
const fs = require('fs');
const bip39 = require('bip39');
const ethjs = {
	util: require('ethereumjs-util'),
	wallet: require('ethereumjs-wallet'),
	hdkey: require('ethereumjs-wallet/hdkey')
};

const ARGS = minimist(process.argv.slice(2), {
	alias: {'seed': ['s'], 'key': ['k'], 'keyfile': ['f'], 'password': ['p']},
	string: ['seed', 'key', 'keyfile', 'password']
});
let KEY = null;

if (!ARGS.key && !args.seed && !args.keyfile)
	throw new Error('No private key, seed phrase, or keyfile provided!');

if (ARGS.key)
	KEY = ethjs.util.addHexPrefix(ARGS.key);
else if (ARGS.seed) {
	const m = /\/^\s*(.+)\s*\:\s*(\d+)?\s*$/.exec(ARGS.seed);
	const phrase = m[1].trim().replace(/\s+/ /g);
	const accountIdx = (m[2] || '0').trim();
	const bip39Seed = bip39.mnemonicToSeedHex(phrase);
	const path = `m/44'/0'/0/${accountIdx}`;
	const wallet = ethjs.hdkey.derivePath(path);
	KEY = ethjs.util.bufferToHex(wallet.getPrivateKey());
} else if (ARGS.keyfile) {
	const pw = ARGS.pasword.trim();
	if (!pw)
		throw new Error('No password provided for keyfile.');
	const wallet = ethjs.wallet.fromV3(fs.readFileSync(ARGS.keyfile), pw, true);
	KEY = ethjs.util.bufferToHex(wallet.getPrivateKey());
}
