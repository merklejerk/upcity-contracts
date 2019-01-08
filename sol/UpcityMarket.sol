pragma solidity ^0.5;

// solhint-disable-next-line
import './base/openzeppelin/math/SafeMath.sol';
import './base/bancor/BancorFormula.sol';
import './IResourceToken.sol';
import './Uninitialized.sol';
import './Restricted.sol';

/// @title Bancor market for UpCity's resources.
/// @author Lawrence Forman (me@merklejerk.com)
contract UpcityMarket is BancorFormula, Uninitialized, Restricted {

	using SafeMath for uint256;

	// 100% or 1.0 in parts per million.
	uint32 private constant PPM_ONE = $$(1e6);

	// State for each resource's market.
	struct Market {
		// The resource's token.
		IResourceToken token;
		// The ether balance for this resource.
		uint256 funds;
	}

	/// @dev Tokens supported.
	address[] public tokens;
	/// @dev Bancor connector weight shared by all markets, in ppm.
	uint32 public connectorWeight;
	// Indiividual markets for each resource.
	mapping(address=>Market) private _markets;

	/// @dev Raised whenever resource tokens are bought.
	/// @param resource The address of the token/resource.
	/// @param to The recepient of the tokens.
	/// @param value The ether value of the tokens.
	/// @param bought The number of tokens bought.
	event Bought(
		address indexed resource,
		address indexed to,
		uint256 value,
		uint256 bought);
	/// @dev Raised whenever resource tokens are sold.
	/// @param resource The address of the token/resource.
	/// @param to The recepient of the ether.
	/// @param sold The number of tokens sold.
	/// @param value The ether value of the tokens.
	event Sold(
		address indexed resource,
		address indexed to,
		uint256 sold,
		uint256 value);

	/// @dev Deploy the market.
	/// init() needs to be called before market functions will work.
	/// @param cw the bancor "connector weight" for all token markets, in ppm.
	constructor(uint32 cw) public {
		require(cw <= PPM_ONE);
		connectorWeight = cw;
	}

	/// @dev Fund the markets.
	/// Attached ether will be distributed evenly across all token markets.
	function() external payable onlyInitialized {
		for (uint8 i = 0; i < tokens.length; i++) {
			Market storage market = _markets[tokens[i]];
			market.funds = market.funds.add(msg.value/tokens.length);
		}
	}

	/// @dev Initialize and fund the markets.
	/// This is the only privileged function and can only be called once by
	/// the contract creator.
	/// Attached ether will be distributed evenly across all token markets.
	/// @param _tokens The address of each token.
	function init(address[] calldata _tokens)
			external payable onlyCreator onlyUninitialized {

		require(_tokens.length > 0, ERROR_INVALID);
		require(msg.value >= _tokens.length, ERROR_INVALID);
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
		_init();
	}

	/// @dev Get the market state of a token.
	/// @param resource Address of the resource token contract.
	/// @return The price, supply, and (ether) balance for that token.
	function getState(address resource)
			external view returns (uint256 price, uint256 supply, uint256 funds) {

		Market storage market = _markets[resource];
		require(address(market.token) == resource, ERROR_INVALID);
		price = getPrice(resource);
		supply = market.token.totalSupply();
		funds = market.funds;
	}

	/// @dev Get the current price of a resource.
	/// @param resource The address of the resource contract.
	/// @return The price, in wei.
	function getPrice(address resource) public view returns (uint256) {
		Market storage market = _markets[resource];
		require(address(market.token) == resource, ERROR_INVALID);
		return ((1 ether) * market.funds) /
			((market.token.totalSupply() * connectorWeight) / PPM_ONE);
	}

	/// @dev Buy some tokens with ether.
	/// @param resource The address of the resource token contract.
	/// @param to Recipient of tokens.
	/// @return The number of tokens purchased.
	function buy(address resource, address to)
			external payable onlyInitialized returns (uint256) {

		Market storage market = _markets[resource];
		require(address(market.token) == resource, ERROR_INVALID);
		require(msg.value > 0, ERROR_INVALID);
		uint256 supply = market.token.totalSupply();
		uint256 bought = calculatePurchaseReturn(
			supply, market.funds, connectorWeight, msg.value);
		market.funds = market.funds.add(msg.value);
		market.token.mint(to, bought);
		emit Bought(resource, to, msg.value, bought);
		return bought;
	}

	/// @dev Sell some tokens for ether.
	/// @param resource The address of the resource token contract.
	/// @param amount Amount of tokens to sell.
	/// @param to Recipient of ether.
	/// @return The number of ether received.
	function sell(address resource, uint256 amount, address payable to)
			external onlyInitialized returns (uint256) {

		Market storage market = _markets[resource];
		require(address(market.token) == resource, ERROR_INVALID);
		require(amount > 0, ERROR_INVALID);
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
	// solhint-disable
	function __uninitialize() external {
		tokens.length = 0;
		if (address(this).balance > 0) {
			address payable nobody = address(0x0);
			nobody.transfer(address(this).balance);
		}
	}
	// #endif
}
