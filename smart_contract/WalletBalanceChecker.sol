// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract WalletBalanceChecker {
    
    // Structure to store wallet address, balance, and key
    struct WalletBalance {
        string key;
        address wallet;
        uint256 balance;
    }
    
    // Function to check balances of multiple wallets with keys
    function checkBalances(address[] memory wallets, string[] memory keys) public view returns (WalletBalance[] memory) {
        
        WalletBalance[] memory balances = new WalletBalance[](wallets.length);
        
        for (uint256 i = 0; i < wallets.length; i++) {
            uint256 balance = wallets[i].balance;
            balances[i] = balance > 0 ? WalletBalance(keys[i], wallets[i], balance) : WalletBalance("0", address(0), 0);
        }
        
        return balances;
    }
}