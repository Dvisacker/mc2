pragma solidity ^0.4.19;


contract DistributeEth {
    function execute(address a, address b, uint256 amountA, uint256 amountB) external {
        a.transfer(amountA);
        b.transfer(amountB);
    }
}
