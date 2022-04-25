// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

interface IMakerDAOBudgetManager {
  // Events

  event InvoicedGas(uint256 indexed _nonce, uint256 _gasCostETH, uint256 _claimableDai, string _description);
  event DeletedInvoice(uint256 indexed nonce);
  event ClaimedDai(uint256 indexed _nonce, uint256 _claimed, uint256 _refilled, uint256 _returned);
  event Keep3rJobSet(address _keep3r, address _job);
  event KeeperSet(address _keeper);

  // Errors

  error MinBuffer();
  error InvoiceClaimed();
  error OnlyKeeper();

  // Views

  function daiToClaim() external returns (uint256);

  function keep3r() external returns (address);

  function job() external returns (address);

  function keeper() external returns (address);

  function invoiceAmount(uint256 _invoiceNonce) external returns (uint256);

  function invoiceNonce() external returns (uint256);

  function credits() external view returns (uint256 _daiCredits);

  // Methods

  function invoiceGas(
    uint256 _gasCostETH,
    uint256 _claimableDai,
    string memory _description
  ) external;

  function deleteInvoice(uint256 _invoiceNonce) external;

  function claimDai() external;

  function claimDaiUpkeep() external;

  function setKeep3rJob(address _keep3r, address _job) external;

  function setKeeper(address _keeper) external;
}
