pragma solidity ^0.5;

import './base/openzeppelin/math/SafeMath.sol';
import './base/openzeppelin/token/ERC20/IERC20.sol';
import './Macros.sol';
import './Nonpayable.sol';
import './IMarket.sol';

/// @title ERC20 token "proxy" contract for upcity resources.
/// @author lawrence forman (me@merklejerk.com)
/// @dev Most logic is deferred to the UpcityMarket contract instance,
/// which maintians the balances and supply of each token. The only real
/// responsibility of this contract is to manage spending allowances.
contract UpcityResourceTokenProxy is
		IERC20,
		Nonpayable {

	using SafeMath for uint256;

	uint8 private constant NUM_RESOURCES = $$(NUM_RESOURCES);

	string public name;
	string public symbol;
	uint8 public constant decimals = 18;
	/// @dev The UpcityMarket contract.
	IMarket private _market;
	/// @dev Spending allowances for each spender for a wallet.
	/// The mapping order is wallet -> spender -> allowance.
	mapping(address=>mapping(address=>uint256)) private _allowances;

	/// @dev Creates the contract.
	/// @param _name Token name
	/// @param _symbol Token symbol
	/// @param market The market address.
	constructor(
			string memory _name,
			string memory _symbol,
			address market)
			public {

		name = _name;
		symbol = _symbol;
		_market = IMarket(market);
	}

	/// @dev Get the current supply of tokens.
	/// @return The current supply of tokens (in wei).
	function totalSupply() external view returns (uint256) {
		// Query the market.
		return _market.getSupply(address(this));
	}

	/// @dev Get the token balance of an address.
	/// @param who The address that owns the tokens.
	/// @return The balance of an address (in wei).
	function balanceOf(address who) external view returns (uint256) {
		// Query the market.
		return _market.getBalance(address(this), who);
	}

	/// @dev Get the spending allowance for a spender and owner pair.
	/// @param owner The address that owns the tokens.
	/// @param spender The address that has been given an allowance to spend
	/// from `owner`.
	/// @return The remaining spending allowance (in wei).
	function allowance(address owner, address spender)
			external view returns (uint256) {

		return _allowances[owner][spender];
	}

	/// @dev Grant an allowance to `spender` from the caller's wallet.
	/// This allowance will be reduced every time a successful
	/// transferFrom() occurs.
	/// @param spender The wallet's spender.
	/// @param value The allowance amount.
	function approve(address spender, uint256 value) external returns (bool) {
		// Overwrite the previous allowance.
		_allowances[msg.sender][spender] = value;
		emit Approval(msg.sender, spender, value);
		return true;
	}

	/// @dev Transfer tokens from the caller's wallet.
	/// Reverts if the caller does not have the funds to cover the transfer.
	/// @param to The recipient.
	/// @param amt The number of tokens to send (in wei)
	function transfer(address to, uint256 amt) external returns (bool) {
		// Let the market handle it. This call should revert on failure.
		_transfer(msg.sender, to, amt);
		return true;
	}

	/// @dev Transfer tokens from a wallet.
	/// Reverts if the `from` does not have the funds to cover the transfer
	/// or the caller does not have enough allowance.
	/// @param from The wallet to spend tokens from.
	/// @param to The recipient.
	/// @param amt The number of tokens to send (in wei)
	function transferFrom(address from, address to, uint256 amt)
			external returns (bool) {

		// Ensure that the spender has enough allowance.
		uint256 remaining = _allowances[from][msg.sender];
		require(remaining >= amt, ERROR_INSUFFICIENT);
		// Reduce the allowance.
		_allowances[from][msg.sender] = remaining - amt;
		_transfer(from, to, amt);
		return true;
	}

	/// @dev Perform an unchecked transfer between addresses.
	/// @param from The sender address.
	/// @param to The receiver address/
	/// @param amt The amount of tokens to transfer, in wei.
	function _transfer(address from, address to, uint256 amt)
			private {

		require(to != address(0x0) && to != address(this), ERROR_INVALID);
		// This should revert if the balances are insufficient.
		_market.proxyTransfer(from, to, amt);
		emit Transfer(from, to, amt);
	}
}
