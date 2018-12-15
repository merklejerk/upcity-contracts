pragma solidity ^0.5;

import './Errors.sol';

/// @dev Base for contracts that don't want to hold ether.
/// Reverts in the fallback function.
contract Nonpayable is Errors {

	/// @dev Revert in the fallback function to prevent accidental
	/// transfer of funds to this contract.
	function() external payable {
		revert(ERROR_INVALID);
	}
}
