pragma solidity ^0.5;

import './base/openzeppelin/token/ERC20/ERC20.sol';
import './Uninitialized.sol';
import './Restricted.sol';
import './Nonpayable.sol';

/// @title ERC20 token contract for upcity resources.
/// @author Lawrence Forman (me@merklejerk.com)
contract UpcityResourceToken is ERC20, Uninitialized, Restricted, Nonpayable {

	using SafeMath for uint256;

	string public name;
	string public symbol;
	uint8 public constant decimals = 18;
	address internal constant ZERO_ADDRESS = address(0x0);

	/// @dev Creates the contract. The contract will still need to be
	/// initialized via initialize() before tokens can be minted or burned
	/// to other addresses.
	/// @param _name Token name
	/// @param _symbol Token symbol
	/// @param reserve Amount of tokens the contract instantly mint and will keep
	/// locked up forever.
	constructor(
			string memory _name,
			string memory _symbol,
			uint256 reserve)
			public {

		require(reserve >= 0, ERROR_INVALID);
		name = _name;
		symbol = _symbol;
		_mint(address(this), reserve);
	}

	/// @dev Initialize the contract by setting the authorities.
	/// Authorities are who are allowed to call the mint and burn
	/// functions.
	/// @param  _authorities List of authority addresses.
	function init(address[] calldata _authorities)
			external onlyUninitialized onlyCreator {

		require(_authorities.length > 0, ERROR_INVALID);
		for (uint256 i = 0; i < _authorities.length; i++)
			isAuthority[_authorities[i]] = true;
		Uninitialized._init();
	}

	/// @dev Mint new tokens and give them to an address.
	/// Only the authority may call this.
	function mint(address to, uint256 amt)
			public onlyInitialized onlyAuthority {

		_mint(to, amt);
	}

	/// @dev Burn tokens held by an address.
	/// Only the authority may call this.
	function burn(address from, uint256 amt)
			public onlyInitialized onlyAuthority {

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
