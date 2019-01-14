pragma solidity ^0.5;

import './base/openzeppelin/token/ERC20/ERC20.sol';
import './Restricted.sol';
import './Nonpayable.sol';

/// @title ERC20 token contract for upcity resources.
/// @author Lawrence Forman (me@merklejerk.com)
contract UpcityResourceToken is ERC20, Restricted, Nonpayable {

	using SafeMath for uint256;

	string public name;
	string public symbol;
	uint8 public constant decimals = 18;
	address internal constant ZERO_ADDRESS = address(0x0);

	/// @dev Creates the contract.
	/// @param _name Token name
	/// @param _symbol Token symbol
	/// @param reserve Amount of tokens the contract instantly mint and will keep
	/// @param authorities List of authority addresses.
	/// locked up forever.
	constructor(
			string memory _name,
			string memory _symbol,
			uint256 reserve,
			address[] memory authorities)
			public {

		require(reserve >= 0, ERROR_INVALID);
		require(authorities.length > 0, ERROR_INVALID);
		name = _name;
		symbol = _symbol;
		for (uint256 i = 0; i < authorities.length; i++)
			isAuthority[authorities[i]] = true;
		_mint(address(this), reserve);
	}

	/// @dev Mint new tokens and give them to an address.
	/// Only an authority may call this.
	/// @param to The owner of the new tokens.
	/// @param amt The number of tokens to mint.
	function mint(address to, uint256 amt) external onlyAuthority {
		_mint(to, amt);
	}

	/// @dev Burn tokens held by an address.
	/// Only an authority may call this.
	/// @param from The owner whose tokens will be burned.
	/// @param amt The number of tokens to burn.
	function burn(address from, uint256 amt) external onlyAuthority {
		require(amt > 0, ERROR_INVALID);
		require(from != ZERO_ADDRESS && from != address(this), ERROR_INVALID);
		require(balanceOf(from) >= amt, ERROR_INSUFFICIENT);
		_burn(from, amt);
	}

	/// @dev Oerride transfer() to burn tokens if sent to
	/// 0x0 or this contract address.
	function transfer(address to, uint256 amt) public returns (bool) {
		require(amt > 0, ERROR_INVALID);
		require(balanceOf(msg.sender) >= amt, ERROR_INSUFFICIENT);
		// Transfers to 0x0 or this contract are burns.
		if (to == ZERO_ADDRESS || to == address(this)) {
			_burn(msg.sender, amt);
			return true;
		}
		return super.transfer(to, amt);
	}

	/// @dev Oerride transferFrom() to burn tokens if sent to
	/// 0x0 or this contract address.
	function transferFrom(address from, address to, uint256 amt)
			public returns (bool) {

		require(amt > 0, ERROR_INVALID);
		require(balanceOf(from) >= amt, ERROR_INSUFFICIENT);
		require(allowance(from, msg.sender) >= amt, ERROR_INSUFFICIENT);
		// Transfers to 0x0 or this contract are burns.
		if (to == ZERO_ADDRESS || to == address(this)) {
			_burnFrom(from, amt);
			return true;
		}
		return super.transferFrom(from, to, amt);
	}
}
