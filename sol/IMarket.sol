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
	function getSupply(address token) external view returns (uint256 supply);
	function getBalance(address token, address who)
		external view returns (uint256 balance);
	function proxyTransfer(
		address from, address to, uint256 amount)
		external;
	function transfer(
		address from, address to, uint256[NUM_RESOURCES] calldata amounts)
		external;
	function mint(address to, uint256[NUM_RESOURCES] calldata amounts)
		external;
	function lock(address from, uint256[NUM_RESOURCES] calldata amounts)
		external;
	function buy(uint256[NUM_RESOURCES] calldata amounts, address to)
		external payable returns (uint256[NUM_RESOURCES] memory bought);
	function sell(uint256[NUM_RESOURCES] calldata amounts, address payable to)
		external returns (uint256 value);
}
