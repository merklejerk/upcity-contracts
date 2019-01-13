![build status](https://travis-ci.org/merklejerk/upcity-contracts.svg?branch=master)
# Smart Contracts for [upcity.app](https://upcity.app)

## Install
```bash
# First clone this repo.
git clone git@github:merklejerk/upcity-contracts
# Go into it.
cd upcity-contracts
# Install development dependencies.
yarn -D
```

## Run tests
```bash
yarn test
```


## Build

To create release artifacts of the contracts:

```bash
yarn build
```

## Deploy

The deployment configuration/logic is in
[`/deploy.config.js`](./deploy.config.js).

You will likely want to change the `authorities` fields to addresses you control.

If you want to use the default (Infura/node-less) deployment configuration, the pipeline needs your deployer account's credentials. There are two
basic ways to provide that.

### Defining credentials in a secrets.json file

First create a `secrets.json` file in the root directory (it is explicitly
blacklisted in [`.gitignore`](./.gitignore), so it will not be committed).

This file defines the private key of your deployer.

The JSON schema for the file follows. Note that you only need to define *ONE* of
the `key`, `mnemonic`, or `keystore` properties.
```js
{
  // Your deployer's private key.
  "key": "0x12345....",
  // Your deployer's bip39 mnemonic phrase (for HD wallets)
  "mnemonic": "boogers are delicious ...",
  // Your HD wallet account index
  // (optional, defaults to 0).
  "accountIndex": 0,
  // Your (v3) keystore file path.
  "keystore": "path/to/keystore.json",
  // Your keystore's password
  // (optional, you can also pass this with the -p flag)
  "password": "mysecretpassword"
}
```

Then you just run
```bash
# Deploy to ropsten
yarn deploy ropsten
# Deploy to main
yarn deploy main
```

### Passing credentials on the command line

**TIP**: When passing  credentials on the command line, remember to prefix your
command with a space so it doesn't get saved to shell history.

These examples all deploy to ropsten. To deploy to the main network just
replace `ropsten` with `main`.
```bash
# Deploy to ropsten with a private key.
yarn deploy ropsten -k "0x12345..."
# Deploy to ropsten with a bip39 mnemonic phrase (HD wallet)
yarn deploy ropsten -m "waffles are weird pancakes"
# Deploy to ropsten with a bip39 mnemonic phrase (HD wallet) with account index
yarn deploy ropsten -m "waffles are weird pancakes" -n 2
# Deploy to ropsten with a (v3) keystore and password
yarn deploy ropsten -f "path/to/keystore.json" -p "mysecretpassword"
```
