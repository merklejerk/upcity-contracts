pragma solidity ^0.5;

/// @dev Base contract defining common error codes.
contract Errors {
	// #for MSG in ERRORS
	string internal constant $$(`ERROR_${MSG}`) = $$(quote(`${MSG}`));
	// #done
}
