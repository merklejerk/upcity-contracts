pragma solidity ^0.5;

/// @title Public interface for the Upcity Market contract.
/// @author Lawrence Forman (me@merklejerk.com)
contract IMarket {

	uint8 internal constant NUM_RESOURCES = $$(NUM_RESOURCES);

	function getPrices()
		external view returns (uint256[NUM_RESOURCES] memory prices);
	function getSupplies()
		external view returns (uint256[NUM_RESOURCES] memory supplies);
	function getBalances(address who)
		external view returns (uint256[NUM_RESOURCES] memory balances);
	function transfer(
		address from, address to, uint256[NUM_RESOURCES] calldata amounts)
		external view returns (uint256);
	function mint(address to, uint256[NUM_RESOURCES] calldata amounts)
		external;
	function burn(address from, uint256[NUM_RESOURCES] calldata amounts)
		external;
}
