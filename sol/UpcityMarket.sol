pragma solidity ^0.4.24;

import 'https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-solidity/9b3710465583284b8c4c5d2245749246bb2e0094/contracts/math/SafeMath.sol';
import './base/bancor/BancorFormula.sol';
import './IResourceToken.sol';

/// @title Bancor meta-market for UpCity's resources.
contract UpcityMarket is BancorFormula {

	using SafeMath for uint256;

	uint32 constant PPM_ONE = $${1e6};

	struct Market {
		IResourceToken token;
		uint256 funds;
	}

	/// @dev Tokens supported.
	address[] public tokens;
	/// @dev Bancor connector weight shared by all markets, in ppm.
	uint32 public connectorWeight;
	/// @dev Indiividual markets for each resource.
	mapping(address=>Market) private _markets;
	/// @dev Creator of this contract, who can call init().
	address private _creator;

	event Bought(address resource, address to, uint256 value, uint256 bought);
	event Sold(address resource, address to, uint256 sold, uint256 value);

	/// @dev Deploy the market.
	/// init() needs to be called before market functions will work.
	/// @param cw the bancor "connector weight" for all token markets, in ppm.
	constructor(uint32 cw) public {
		require(cw <= PPM_ONE);
		connectorWeight = cw;
		_creator = msg.sender;
	}

	/// @dev Only callable by contract creator.
	modifier onlyCreator() {
		require(msg.sender == _creator);
		_;
	}

	/// @dev Only callable when the contract has been initialized.
	modifier onlyInitialized() {
		require(tokens.length > 0);
		_;
	}

	/// @dev Only callable when the contract is uninitialized.
	modifier onlyUninitialized() {
		require(tokens.length == 0);
		_;
	}

	/// @dev Initialize and fund the markets.
	/// This is the only privileged function and can only be called once by
	/// the contract creator.
	/// Attached ether will be distributed evenly across all token markets.
	/// @param _tokens The address of each token.
	function init(address[] _tokens)
			public payable onlyCreator onlyUninitialized {

		require(msg.value >= _tokens.length);
		for (uint256 i = 0; i < _tokens.length; i++) {
			address addr = _tokens[i];
			tokens.push(addr);
			IResourceToken token = IResourceToken(addr);
			Market storage market = _markets[addr];
			market.token = token;
			market.funds = msg.value / _tokens.length;
			require(market.token.isAuthority(address(this)));
		}
		_bancorInit();
	}

	/// @dev Fund the markets.
	/// Attached ether will be distributed evenly across all token markets.
	function() payable onlyInitialized public {
		for (uint8 i = 0; i < tokens.length; i++) {
			Market storage market = _markets[tokens[i]];
			market.funds = market.funds.add(msg.value/tokens.length);
		}
	}

	/// @dev Get the current price of a resource.
	/// @param resource The address of the resource contract.
	/// @return The price, in wei.
	function getPrice(address resource) public view returns (uint256) {
		require(resource != 0x0);
		Market storage market = _markets[resource];
		require(address(market.token) == resource);
		return (((1 ether) * market.funds) /
			(market.token.totalSupply() * connectorWeight)) / PPM_ONE;
	}

	/// @dev Buy some tokens with ether.
	/// @param resource The address of the resource contract.
	/// @param to Recipient of tokens.
	/// @return The number of tokens purchased.
	function buy(address resource, address to)
			public payable onlyInitialized returns (uint256) {

		require(resource != 0x0);
		Market storage market = _markets[resource];
		require(address(market.token) == resource);
		require(msg.value > 0);
		uint256 supply = market.token.totalSupply();
		uint256 bought = calculatePurchaseReturn(
			supply, market.funds, connectorWeight, msg.value);
		market.funds = market.funds.add(msg.value);
		market.token.mint(to, bought);
		emit Bought(resource, to, msg.value, bought);
		return bought;
	}

	/// @dev Sell some tokens for ether.
	/// @param resource The address of the resource contract.
	/// @param amount Amount of tokens to sell.
	/// @param to Recipient of ether.
	/// @return The number of ether received.
	function sell(address resource, uint256 amount, address to)
			public onlyInitialized returns (uint256) {

		require(resource != 0x0);
		Market storage market = _markets[resource];
		require(address(market.token) == resource);
		require(amount > 0);
		uint256 supply = market.token.totalSupply();
		market.token.burn(msg.sender, amount);
		uint256 funds = calculateSaleReturn(
			supply, market.funds, connectorWeight, amount);
		market.funds = market.funds.sub(funds);
		to.transfer(funds);
		emit Sold(resource, to, amount, funds);
		return funds;
	}

	// #if TEST
	function __uninitialize() public {
		tokens.length = 0;
		if (address(this).balance > 0)
			address(0x0).transfer(address(this).balance);
	}
	// #endif
}
