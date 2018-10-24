pragma solidity ^0.4.24;

import {SafeMath} from './base/open-zeppelin/SafeMath.sol';
import {BancorFormula} from './base/bancor/BancorFormula.sol';
import {ResourceToken} from './ResourceToken.sol';

using SafeMath for uint256;

/// @title Bancor meta-market for UpCity's resources.
contract UpcityMarket is BancorFormula {

	uint32 constant PPM_ONE = 1000000;

	struct Market {
		ResourceToken token;
		uint256 funds;
	}

	/// @dev Tokens supported.
	address[] public tokens;
	/// @dev Bancor connector weight shared by all markets, in ppm.
	uint32 public connectorWeight;
	/// @dev Indiividual markets for each resource.
	mapping(address=>Market) private _markets;

	/// @dev Create and fund the markets.
	/// Attached ether will be distributed evenly across all token markets.
	/// @param _tokens The UpcityResourceERC20 address for each token/resource.
	/// @param cw The bancor connector weight for all markets, in ppm.
	constructor(address[] _tokens, uint32 cw) payable public {
		require(msg.value >= _tokens.length);
		require(cw <= PPM_ONE);
		connectorWeight = cw;
		for (uint8 i = 0; i < _tokens.length; i++) {
			address addr = _tokens[i];
			tokens.push(addr);
			ResourceToken token = ResourceToken(addr);
			Market storage market = _markets[addr];
			market.token = token;
			market.funds = msg.value / _tokens.length;
			require(market.token.authority() == address(this));
		}
		_bancorInit();
	}

	/// @dev Fund the markets.
	/// Attached ether will be distributed evenly across all token markets.
	function() payable public {
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
			public payable returns (uint256) {

		require(resource != 0x0);
		Market storage market = _markets[resource];
		require(address(market.token) == resource);
		require(msg.value > 0);
		uint256 supply = market.token.totalSupply();
		uint256 bought = calculatePurchaseReturn(
			supply, market.funds, connectorWeight, msg.value);
		market.funds = market.funds.add(msg.value);
		market.token.mint(to, bought);
		return bought;
	}

	/// @dev Sell some tokens for ether.
	/// @param resource The address of the resource contract.
	/// @param amount Amount of tokens to sell.
	/// @param to Recipient of ether.
	/// @return The number of ether received.
	function sell(address resource, uint256 amount, address to)
			public returns (uint256) {

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
		return funds;
	}
}
