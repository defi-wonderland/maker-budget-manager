// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

interface IMakerDAOBudgetManager {
  // events
  event InvoicedGas(uint256 indexed _nonce, uint256 _gasCostETH, uint256 _claimableDai, string _description);
  event DeletedInvoice(uint256 indexed nonce);
  /* TODO: add all events on same emit? */
  event DaiReturned(uint256 _returned);
  event TokenCreditsRefilled(uint256 _refilled);
  event ClaimedDai(uint256 _claimed);

  // errors
  error MinBuffer();
  error InvoiceClaimed();

  // views

  function minBuffer() external returns (uint256);

  function maxBuffer() external returns (uint256);

  function daiToClaim() external returns (uint256);

  function vestId() external returns (uint256);

  function job() external returns (address);

  function invoiceAmount(uint256 _invoiceNonce) external returns (uint256);

  function invoiceNonce() external returns (uint256);

  function DAI() external returns (address);

  function DAI_JOIN() external returns (address);

  function VOW() external returns (address);

  function DSS_VEST() external returns (address);

  function KEEP3R() external returns (address);

  function credits() external view returns (uint256 _daiCredits);

  // methods

  function invoiceGas(
    uint256 _gasCostETH,
    uint256 _claimableDai,
    string memory _description
  ) external;

  function deleteInvoice(uint256 _invoiceNonce) external;

  function claimDai() external;
}
