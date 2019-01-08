pragma solidity ^0.5;

import './Errors.sol';

/// @title Base for contracts that require a separate
/// initialization step beyond the constructor.
/// @author Lawrence Forman (me@merklejerk.com)
/// @dev Deriving contracts should call super._init() in their initialization step
/// to initialize the contract.
contract Uninitialized is Errors {

	/// @dev Whether the contract is fully initialized.
	bool private _isInitialized;

	/// @dev Only callable when contract is initialized.
	modifier onlyInitialized() {
		require(_isInitialized, ERROR_UNINITIALIZED);
		_;
	}

	/// @dev Only callable when contract is uninitialized.
	modifier onlyUninitialized() {
		require(!_isInitialized, ERROR_UNINITIALIZED);
		_;
	}

	/// @dev initialize the contract.
	function _init() internal onlyUninitialized {
		_isInitialized = true;
	}

	// #if TEST
	/// @dev Debug function for toggling intialized state.
	function __setInitialized(bool initialized) external {
		_isInitialized = initialized;
	}
	// #endif
}
