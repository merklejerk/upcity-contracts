pragma solidity ^0.5;

/// @title Base contract defining common error codes.
/// @author Lawrence Forman (me@merklejerk.com)
contract Errors {

	// #for MSG in ERRORS
	string internal constant $$(`ERROR_${MSG}`) = $$(quote(`${MSG}`));
	// #done
}
