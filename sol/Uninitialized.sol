pragma solidity ^0.5;

import './Errors.sol';

/// @dev Base for contracts that require a separate
/// initialization step beyond the constructor.
/// Deriving contracts should set isInitialized to true once they've
/// completed their initialization step.
contract Uninitialized is Errors {

	/// @dev Whether the contract is fully initialized.
	bool public isInitialized = false;

	/// @dev Only callable when contract is initialized.
	modifier onlyInitialized() {
		require(isInitialized, ERROR_UNINITIALIZED);
		_;
	}

	/// @dev Only callable when contract is uninitialized.
	modifier onlyUninitialized() {
		require(!isInitialized, ERROR_UNINITIALIZED);
		_;
	}

	// #if TEST
	/// @dev Debug function for toggling intialized state.
	function __setInitialized(bool initialized) external {
		isInitialized = initialized;
	}
	// #endif
}
