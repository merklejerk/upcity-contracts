pragma solidity ^0.5;

// solhint-disable-next-line
import './base/openzeppelin/math/SafeMath.sol';
import './base/bancor/BancorFormula.sol';
import './IResourceToken.sol';
import './Uninitialized.sol';
import './Restricted.sol';

// #def ONE_DAY 24 * 60 * 60

// #if TEST
// #def BLOCKTIME _blockTime
// #else
// #def BLOCKTIME uint64(block.timestamp)
// #endif

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
		// Price yesterday.
		uint256 priceYesterday;
		// Time when priceYesterday was computed.
		uint64 yesterday;
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
	/// @dev Raised whenever the market is funded.
	/// @param value The amount of ether deposited.
	event Funded(uint256 value);

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
		if (msg.value > 0) {
			for (uint8 i = 0; i < tokens.length; i++) {
				Market storage market = _markets[tokens[i]];
				market.funds = market.funds.add(msg.value/tokens.length);
				_updatePriceYesterday(market, market.token.totalSupply());
			}
			emit Funded(msg.value);
		}
	}

	/// @dev Initialize and fund the markets.
	/// This can only be called once by the contract creator.
	/// Attached ether will be distributed evenly across all token markets.
	/// @param _tokens The address of each token.
	/// @param authorities Address of authorities to register.
	function init(address[] calldata _tokens, address[] calldata authorities)
			external payable onlyCreator onlyUninitialized {

		require(_tokens.length > 0, ERROR_INVALID);
		require(msg.value >= _tokens.length, ERROR_INVALID);
		// Set authorities.
		for (uint256 i = 0; i < authorities.length; i++) {
			isAuthority[authorities[i]] = true;
		}
		// Create markets.
		for (uint256 i = 0; i < _tokens.length; i++) {
			address addr = _tokens[i];
			tokens.push(addr);
			IResourceToken token = IResourceToken(addr);
			Market storage market = _markets[addr];
			market.token = token;
			market.funds = msg.value / _tokens.length;
			market.priceYesterday = _getMarketPrice(
				market.funds, token.totalSupply());
			market.yesterday = $(BLOCKTIME);
			require(market.token.isAuthority(address(this)));
		}
		_bancorInit();
		_init();
	}

	/// @dev Get the market state of a token.
	/// @param resource Address of the resource token contract.
	/// @return The price, supply, (ether) balance, and yesterday's price
	// for that token.
	function getState(address resource)
			external view returns (
				uint256 price,
				uint256 supply,
				uint256 funds,
				uint256 priceYesterday) {

		Market storage market = _markets[resource];
		require(address(market.token) == resource, ERROR_INVALID);
		price = getPrice(resource);
		supply = market.token.totalSupply();
		funds = market.funds;
		priceYesterday = market.priceYesterday;
	}

	/// @dev Get the current price of a resource.
	/// @param resource The address of the resource contract.
	/// @return The price, in wei.
	function getPrice(address resource) public view returns (uint256) {
		Market storage market = _markets[resource];
		require(address(market.token) == resource, ERROR_INVALID);
		return _getMarketPrice(market.funds, market.token.totalSupply());
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
		_updatePriceYesterday(market, supply);
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
		_updatePriceYesterday(market, supply);
		market.token.burn(msg.sender, amount);
		uint256 funds = calculateSaleReturn(
			supply, market.funds, connectorWeight, amount);
		market.funds = market.funds.sub(funds);
		to.transfer(funds);
		emit Sold(resource, to, amount, funds);
		return funds;
	}

	/// @dev Burn tokens.
	/// Only an authority may call this.
	/// @param resource The address of the resource token contract.
	/// @param from The owner whose tokens will be burned.
	/// @param amount The number of tokens to burn.
	function burn(address resource, address from, uint256 amount)
			external onlyInitialized onlyAuthority {

		Market storage market = _markets[resource];
		require(address(market.token) == resource, ERROR_INVALID);
		require(amount > 0, ERROR_INVALID);
		_updatePriceYesterday(market, market.token.totalSupply());
		market.token.burn(from, amount);
	}

	/// @dev Mint tokens.
	/// Only an authority may call this.
	/// @param resource The address of the resource token contract.
	/// @param to The owner of the new tokens.
	/// @param amount The number of tokens to mint.
	function mint(address resource, address to, uint256 amount)
			external onlyInitialized onlyAuthority {

		Market storage market = _markets[resource];
		require(address(market.token) == resource, ERROR_INVALID);
		require(amount > 0, ERROR_INVALID);
		_updatePriceYesterday(market, market.token.totalSupply());
		market.token.mint(to, amount);
	}

	/// @dev Calculate the price of a market token, given funds and supply.
	/// @param funds The funds (ether) held by the market.
	/// @param supply The token's supply.
	/// @return The (ether) price.
	function _getMarketPrice(uint256 funds, uint256 supply)
			private view returns (uint256) {
		return ((1 ether) * funds) / ((supply * connectorWeight) / PPM_ONE);
	}

	/// @dev Update the price yesterday of a market.
	/// Nothing will happen if less than a day has passed since the last
	/// update.
	/// @param market The token's market instance.
	/// @param supply The current supply of the token.
	function _updatePriceYesterday(Market storage market, uint256 supply)
			private {

		uint64 _now = $(BLOCKTIME);
		if (_now > market.yesterday && _now - market.yesterday >= $$(ONE_DAY)) {
			market.priceYesterday = _getMarketPrice(market.funds, supply);
			market.yesterday = _now;
		}
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

	// The current blocktime.
	uint64 public _blockTime = uint64(block.timestamp);

	// Set the current blocktime.
	function __setBlockTime(uint64 t) public {
		_blockTime = t;
	}

	// Advance the current blocktime.
	function __advanceTime(uint64 dt) public {
		_blockTime += dt;
	}
	// #endif
}
