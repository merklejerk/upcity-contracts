pragma solidity ^0.5;

// solhint-disable-next-line
import './base/openzeppelin/math/SafeMath.sol';
import './base/bancor/BancorFormula.sol';
import './Uninitialized.sol';
import './IMarket.sol';
import './Restricted.sol';
import './Macros.sol';

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
	// The bancor connector weight, which determines price evolution, in ppm.
	uint32 private constant CONNECTOR_WEIGHT = $$(int(CONNECTOR_WEIGHT * 1e6));

	// State for each resource token.
	struct Token {
		// The number of tokens minted, in wei.
		uint256 supply;
		// The ether balance for this resource.
		uint256 funds;
		// Price yesterday.
		uint256 priceYesterday;
		// The canonical index of this token.
		uint8 idx;
		// The address of the token contract.
		address token;
		// The balances of each address.
		mapping(address=>uint256) balances;
	}

	// @dev When the priceYesterday of each token was last updated.
	uint64 public yesterday;
	// Indiividual states for each resource token.
	mapping(address=>Token) private _tokens;
	// Token addresses for each resource token.
	address[NUM_RESOURCES] private _tokenAddresses;

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
		require(_tokens[msg.sender].token == msg.sender, ERROR_RESTRICTED);
		_;
	}

	/// @dev Deploy the market.
	/// init() needs to be called before market functions will work.
	constructor() public {
	}

	/// @dev Fund the markets.
	/// Attached ether will be distributed evenly across all token markets.
	function() external payable onlyInitialized {
		if (msg.value > 0) {
			_touch();
			for (uint8 i = 0; i < NUM_RESOURCES; i++) {
				Token storage token = _tokens[_tokenAddresses[i]];
				token.funds = token.funds.add(msg.value/NUM_RESOURCES);
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
		for (uint8 i = 0; i < authorities.length; i++)
			isAuthority[authorities[i]] = true;
		// Initialize token states.
		for (uint8 i = 0; i < NUM_RESOURCES; i++) {
			address addr = tokens[i];
			// Prevent duplicates.
			require(_tokens[addr].token == ZERO_ADDRESS, ERROR_INVALID);
			_tokenAddresses[i] = addr;
			Token storage token = _tokens[addr];
			token.token = addr;
			token.idx = i;
			token.supply = supplyLock;
			token.balances[address(this)] = supplyLock;
			token.funds = msg.value / NUM_RESOURCES;
			token.priceYesterday = _getTokenPrice(
				token.funds, supplyLock);
		}
		yesterday = $(BLOCKTIME);
		_bancorInit();
		_init();
	}

	/// @dev Get all token addresses the market supports.
	/// @return Array of token addresses.
	function getTokens()
			external view returns (address[NUM_RESOURCES] memory tokens) {

		// #for RES in range(NUM_RESOURCES)
		tokens[$$(RES)] = _tokenAddresses[$$(RES)];
		// #done
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

		Token storage token = _tokens[resource];
		require(token.token == resource, ERROR_INVALID);
		price = getPrices()[token.idx];
		supply = token.supply;
		funds = token.funds;
		priceYesterday = token.priceYesterday;
	}

	/// @dev Get the current price of all tokens.
	/// @return The price of each resource, in wei, in canonical order.
	function getPrices()
			public view returns (uint256[NUM_RESOURCES] memory prices) {

		// #for RES in range(NUM_RESOURCES)
		prices[$(RES)] = _getTokenPrice(
			_tokens[_tokenAddresses[$(RES)]].funds,
			_tokens[_tokenAddresses[$(RES)]].supply);
		// #done
	}

	/// @dev Get the supply of all tokens.
	/// @return The supply of each resource, in wei, in canonical order.
	function getSupplies()
			external view returns (uint256[NUM_RESOURCES] memory supplies) {

		// #for RES in range(NUM_RESOURCES)
		supplies[$(RES)] = _tokens[_tokenAddresses[$(RES)]].supply;
		// #done
	}

	/// @dev Get the balances all tokens for `owner`.
	/// @param owner The owner of the tokens.
	/// @return The amount of of each resource held by `owner`, in wei, in
	/// canonical order.
	function getBalances(address owner)
			external view returns (uint256[NUM_RESOURCES] memory balances) {

		// #for RES in range(NUM_RESOURCES)
		balances[$(RES)] = _tokens[_tokenAddresses[$(RES)]].balances[owner];
		// #done
	}

	/// @dev Tansfer tokens between owners.
	/// Can only be called by a token contract.
	/// @param from The owner wallet.
	/// @param to The receiving wallet
	/// @param amounts Amount of each token to transfer.
	function transfer(
			address from, address to, uint256[NUM_RESOURCES] calldata amounts)
			external onlyInitialized onlyToken {

		// #for RES in range(NUM_RESOURCES)
		_transfer(_tokens[_tokenAddresses[$(RES)]], from, to, amounts[$(RES)]);
		// #done
	}

	/// @dev Buy tokens with ether.
	/// Any overpayment of ether will be refunded to the buyer immediately.
	/// @param values Amount of ether to exchange for each resource, in wei,
	/// in canonical order.
	/// @param to Recipient of tokens.
	/// @return The number of each token purchased.
	function buy(uint256[NUM_RESOURCES] calldata values, address to)
			external payable onlyInitialized
			returns (uint256[NUM_RESOURCES] memory bought) {

		_touch();
		uint256 remaining = msg.value;
		for (uint8 i = 0; i < NUM_RESOURCES; i++) {
			uint256 size = values[i];
			require(size <= remaining, ERROR_INSUFFICIENT);
			remaining -= size;
			Token storage token = _tokens[_tokenAddresses[i]];
			bought[i] = calculatePurchaseReturn(
				token.supply, token.funds, CONNECTOR_WEIGHT, size);
			if (bought[i] > 0) {
				_mint(token, to, bought[i]);
				token.funds = token.funds.add(size);
				emit Bought(token.token, to, size, bought[i]);
			}
		}
		// Refund any overpayment.
		if (remaining > 0)
			msg.sender.transfer(remaining);
		return bought;
	}

	/// @dev Sell tokens for ether.
	/// @param amounts Amount of ether to exchange for each resource, in wei,
	/// in canonical order.
	/// @param to Recipient of ether.
	/// @return The combined amount of ether received.
	function sell(uint256[NUM_RESOURCES] calldata amounts, address payable to)
			external onlyInitialized returns (uint256 value) {

		_touch();
		value = 0;
		for (uint8 i = 0; i < NUM_RESOURCES; i++) {
			uint256 size = amounts[i];
			Token storage token = _tokens[_tokenAddresses[i]];
			uint256 _value = calculateSaleReturn(
				token.supply, token.funds, CONNECTOR_WEIGHT, size);
			if (_value > 0) {
				_burn(token, msg.sender, size);
				token.funds = token.funds.sub(_value);
				value = value.add(_value);
				emit Sold(token.token, to, size, _value);
			}
		}
		if (value > 0)
			to.transfer(value);
		return value;
	}

	/// @dev lock up tokens.
	/// Take tokens from an owner and transfer them to this contract, locking
	/// them up permanently.
	/// Only an authority may call this.
	/// @param from The owner whose tokens will be locked.
	/// @param amounts The number of each token to locked, in canonical order.
	function lock(address from, uint256[NUM_RESOURCES] calldata amounts)
			external onlyInitialized onlyAuthority {

		// #for RES in range(NUM_RESOURCES)
		_transfer(_tokens[_tokenAddresses[$(RES)]], from, address(this),
			amounts[$(RES)]);
		// #done
	}

	/// @dev Mint tokens.
	/// Mint a number of every of the token supported, to an owner.
	/// Only an authority may call this.
	/// @param to The owner of the new tokens.
	/// @param amounts The number of each token to mint.
	function mint(address to, uint256[NUM_RESOURCES] calldata amounts)
			external onlyInitialized onlyAuthority {

		_touch();
		// #for RES in range(NUM_RESOURCES)
		_mint(_tokens[_tokenAddresses[$(RES)]], to, amounts[$(RES)]);
		// #done
	}

	/// @dev Burn tokens owned by `from`.
	/// Will revert if insufficient supply or balance.
	/// @param token The token state instance.
	/// @param from The token owner.
	/// @param amount The number of tokens to burn (in wei).
	function _burn(Token storage token, address from, uint256 amount)
			private {

		uint256 balance = token.balances[from];
		require(token.supply >= amount, ERROR_INSUFFICIENT);
		require(balance >= amount, ERROR_INSUFFICIENT);
		token.supply -= amount;
		token.balances[from] -= amount;
	}

	/// @dev Mint tokens to be owned by `to`.
	/// @param token The token state instance.
	/// @param to The token owner.
	/// @param amount The number of tokens to burn (in wei).
	function _mint(Token storage token, address to, uint256 amount)
			private {

		token.supply = token.supply.add(amount);
		token.balances[to] = token.balances[to].add(amount);
	}

	/// @dev Move tokens between andresses.
	/// Will revert if `from` has insufficient balance.
	/// @param token The token state instance.
	/// @param from The token owner.
	/// @param to The token receiver.
	/// @param amount The number of tokens to move (in wei).
	function _transfer(
			Token storage token, address from, address to, uint256 amount)
			private {

		require(token.balances[from] >= amount, ERROR_INSUFFICIENT);
		assert(token.supply + amount >= amount);
		token.balances[from] -= amount;
		token.balances[to] = token.balances[to].add(amount);
	}

	/// @dev Calculate the price of a token.
	/// @param funds The funds (ether) held by the market.
	/// @param supply The token's supply.
	/// @return The (ether) price.
	function _getTokenPrice(uint256 funds, uint256 supply)
			private pure returns (uint256) {
		return ((1 ether) * funds) / ((supply * CONNECTOR_WEIGHT) / PPM_ONE);
	}

	/// @dev Update the price yesterday for all tokens.
	/// Nothing will happen if less than a day has passed since the last
	/// update.
	function _touch() private {
		uint64 _now = $(BLOCKTIME);
		if (_now > yesterday && _now - yesterday >= $$(ONE_DAY)) {
			// #for TOKEN in map(range(NUM_RESOURCES), (X) => `_tokens[_tokenAddresses[${X}]]`)
			$$(TOKEN).priceYesterday = _getTokenPrice(
				$$(TOKEN).funds,
				$$(TOKEN).supply);
			// #done
			yesterday = _now;
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
