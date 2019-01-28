pragma solidity ^0.5;

// solhint-disable-next-line
import './base/openzeppelin/math/SafeMath.sol';
import './base/bancor/BancorFormula.sol';
import './Uninitialized.sol';
import './IMarket.sol'
import './Restricted.sol';

// #def ONE_DAY 24 * 60 * 60

// #if TEST
// #def BLOCKTIME _blockTime
// #else
// #def BLOCKTIME uint64(block.timestamp)
// #endif

/// @title Contract that manages buying, selling, minting, burning, and
/// moving of Upcity resource tokens.
/// @author Lawrence Forman (me@merklejerk.com)
contract UpcityMarket is BancorFormula, Uninitialized, Restricted, IMarket {

	using SafeMath for uint256;

	address private constant ZERO_ADDRESS = address(0x0);
	// 100% or 1.0 in parts per million.
	uint32 private constant PPM_ONE = $$(1e6);

	// State for each resource token.
	struct Token {
		// The number of tokens minted, in wei.
		uint256 supply;
		// The ether balance for this resource.
		uint256 funds;
		// Price yesterday.
		uint256 priceYesterday;
		// Time when priceYesterday was computed.
		uint64 yesterday;
		// The balances of each address.
		mapping(address=>uint256) balances;
	}

	/// @dev Bancor connector weight shared by all markets, in ppm.
	uint32 public connectorWeight;
	// Indiividual states for each resource token.
	mapping(address=>Token) private _tokens;
	// Token addresses for each resource token.
	address private _tokenAddresses;

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

	// Only callable by a registered token.
	modifier onlyToken() {
		require(_tokens[msg.sender].supply > 0, ERROR_NOT_ALLOWED);
		_;
	}

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
				Token storage token = _tokens[tokens[i]];
				token.funds = token.funds.add(msg.value/tokens.length);
				_updatePriceYesterday(token);
			}
			emit Funded(msg.value);
		}
	}

	/// @dev Initialize and fund the markets.
	/// This can only be called once by the contract creator.
	/// Attached ether will be distributed evenly across all token markets.
	/// This will also establish the "canonical order," of tokens.
	/// @param supplyLock The amount of each token to mint and lock up immediately.
	/// @param tokens The address of each token, in canonical order.
	/// @param authorities Address of authorities to register, which are
	/// addresses that can mint and burn tokens.
	function init(
			uint256 supplyLock,
			address[NUM_RESOURCES] calldata tokens,
			address[] calldata authorities)
			external payable onlyCreator onlyUninitialized {

		require(msg.value >= NUM_RESOURCES, ERROR_INVALID);
		// Set authorities.
		for (uint256 i = 0; i < authorities.length; i++)
			isAuthority[authorities[i]] = true;
		// Initialize token states.
		for (uint256 i = 0; i < tokens.length; i++) {
			address addr = tokens[i];
			// Prevent duplicates.
			assert(!_isToken[addr]);
			_tokenAddresses.push(addr);
			Token storage token = _tokens[addr];
			token.supply = supplyLock;
			token.funds = msg.value / NUM_RESOURCES;
			token.priceYesterday = _getTokenPrice(
				token.funds, supplyLock);
			token.yesterday = $(BLOCKTIME);
		}
		_bancorInit();
		_init();
	}

	/// @dev Get the state of a resource token.
	/// @param resource Address of the resource token contract.
	/// @return The price, supply, (ether) balance, and yesterday's price
	// for that token.
	function getState(address resource)
			external view returns (
				uint256 price,
				uint256 supply,
				uint256 funds,
				uint256 priceYesterday) {

		require(_isToken(resource), ERROR_INVALID);
		Token storage token = _tokens[resource];
		price = getPrice(resource);
		supply = token.supply;
		funds = token.funds;
		priceYesterday = token.priceYesterday;
	}

	/// @dev Get the current price of all tokens.
	/// @return The price of each resource, in wei, in canonical order.
	function getPrices()
			public view returns (uint256[NUM_RESOURCES] memory prices) {

		// #for RES of range(NUM_RESOURCES)
		prices[$(RES)] = _getTokenPrice(
			_tokens[$(RES)].funds, _tokens[$(RES)].supply);
		// #done
	}

	/// @dev Get the supply of all tokens.
	/// @return The supply of each resource, in wei, in canonical order.
	function getSupplies()
			external view returns (uint256[NUM_RESOURCES] memory supplies) {

		// #for RES of range(NUM_RESOURCES)
		supplies[$(RES)] = _tokens[$(RES)].supply;
		// #done
	}

	/// @dev Get the balances all tokens for `owner`.
	/// @param owner The owner of the tokens.
	/// @return The amount of of each resource held by `owner`, in wei, in
	/// canonical order.
	function getBalances(address owner)
			external view returns (uint256[NUM_RESOURCES] memory balances) {

		// #for RES of range(NUM_RESOURCES)
		balances[$(RES)] = _tokens[$(RES)].balances[owner];
		// #done
	}

	/// @dev Buy some tokens with ether.
	/// @param resource The address of the resource token contract.
	/// @param to Recipient of tokens.
	/// @return The number of tokens purchased.
	function buy(address resource, address to)
			external payable onlyInitialized returns (uint256) {

		require(_isToken(resource), ERROR_INVALID);
		Token storage token = _tokens[resource];
		require(msg.value > 0, ERROR_INVALID);
		_updatePriceYesterday(token);
		uint256 bought = calculatePurchaseReturn(
			supply, token.funds, connectorWeight, msg.value);
		token.funds = token.funds.add(msg.value);
		_mint(token, to, bought);
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

		Token storage token = _tokens[resource];
		require(_isToken(resource), ERROR_INVALID);
		require(amount > 0, ERROR_INVALID);
		_updatePriceYesterday(token);
		uint256 funds = calculateSaleReturn(
			supply, token.funds, connectorWeight, amount);
		token.funds = token.funds.sub(funds);
		_burn(resource, msg.sender, amount);
		to.transfer(funds);
		emit Sold(resource, to, amount, funds);
		return funds;
	}

	/// @dev Burn tokens.
	/// Burn a number of every of the token supported, from an owner.
	/// Only an authority may call this.
	/// @param from The owner whose tokens will be burned.
	/// @param amounts The number of each token to burn, in canonical order.
	function burn(address from, uint256[NUM_RESOURCES] calldata amounts)
			external onlyInitialized onlyAuthority {

		require(_isToken(resource), ERROR_INVALID);
		// #for RES in range(NUM_RESOURCES)
		_burn(_tokenAddresses[$(RES)], from, amounts[$(RES)]);
		// #done
	}

	/// @dev Mint tokens.
	/// Mint a number of every of the token supported, to an owner.
	/// Only an authority may call this.
	/// @param to The owner of the new tokens.
	/// @param amount The number of each token to mint.
	function mint(address to, uint256[NUM_RESOURCES] calldata amounts)
			external onlyInitialized onlyAuthority {

		require(_isToken(resource), ERROR_INVALID);
		// #for RES in range(NUM_RESOURCES)
		_mint(_tokenAddresses[$(RES)], from, amounts[$(RES)]);
		// #done
	}

	/// @dev Burn tokens owned by `from`.
	/// Will revert if insufficient balance.
	/// @param resource The token's address.
	/// @param from The token owner.
	/// @param amount The number of tokens to burn (in wei).
	function _burn(address resource, address from, uint256 amount)
			private {

		Token storage token = _tokens[resource];
		uint256 balance = token.balances[from];
		require(token.supply >= amount, ERROR_INSUFFICIENT);
		require(balance >= amount, ERROR_INSUFFICIENT);
		token.supply -= amount;
		token.balances[from] -= amount;
		_updatePriceYesterday(token);
	}

	/// @dev Mint tokens to be owned by `from`.
	/// @param resource The token's address.
	/// @param from The token owner.
	/// @param amount The number of tokens to burn (in wei).
	function _mint(address resource, address from, uint256 amount)
			private {

		Token storage token = _tokens[resource];
		uint256 balance = token.balances[from];
		assert(token.supply + amount >= amount);
		token.supply += amount;
		token.balances[from] += amount;
		_updatePriceYesterday(token);
	}

	/// @dev Calculate the price of a token.
	/// @param funds The funds (ether) held by the market.
	/// @param supply The token's supply.
	/// @return The (ether) price.
	function _getTokenPrice(uint256 funds, uint256 supply)
			private view returns (uint256) {
		return ((1 ether) * funds) / ((supply * connectorWeight) / PPM_ONE);
	}

	/// @dev Update the price yesterday of a token.
	/// Nothing will happen if less than a day has passed since the last
	/// update.
	/// @param token The token's state instance.
	function _updatePriceYesterday(Token storage token)
			private {

		uint64 _now = $(BLOCKTIME);
		if (_now > token.yesterday && _now - token.yesterday >= $$(ONE_DAY)) {
			token.priceYesterday = _getTokenPrice(token.funds, token.supply);
			token.yesterday = _now;
		}
	}

	// #if TEST
	// solhint-disable

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
