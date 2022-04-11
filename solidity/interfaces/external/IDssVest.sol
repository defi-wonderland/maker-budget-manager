// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

interface IDssVest {
  function vest(uint256 _id) external;

  function vest(uint256 _id, uint256 _maxAmt) external;
}
