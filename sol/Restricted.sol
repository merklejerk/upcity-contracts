pragma solidity ^0.5;

import './Errors.sol';

/// @title Base class for contracts that want to restrict access to privileged
/// functions to either the contract creator or a group of addresses.
/// @author Lawrence Forman (me@merklejerk.com)
/// @dev Derived contracts should set isAuthority to true for each address
/// with privileged access to functions protected by the onlyAuthority modifier.
contract Restricted is Errors {

	/// @dev Creator of this contract.
	address internal _creator;
	/// @dev Addresses that can call onlyAuthority functions.
	mapping(address=>bool) public isAuthority;

	/// @dev Set the contract creator to the sender.
	constructor() public {
		_creator = msg.sender;
	}

	/// @dev Only callable by contract creator.
	modifier onlyCreator() {
		require(msg.sender == _creator, ERROR_RESTRICTED);
		_;
	}

	/// @dev Restrict calls to only from an authority
	modifier onlyAuthority() {
		require(isAuthority[msg.sender], ERROR_RESTRICTED);
		_;
	}
}
