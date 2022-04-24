// SPDX-License-Identifier: MIT

pragma solidity >=0.8.4 <0.9.0;

interface IMakerDAOParameters {
  // Events

  event BufferSet(uint256 _minBuffer, uint256 _maxBuffer);
  event VestSet(uint256 indexed _vestId, uint48 _bgn, uint48 _clf, uint48 _fin, uint128 _tot);

  // Errors

  error IncorrectVestId();
  error OnlyMaker();

  // Views

  function DAI() external view returns (address dai);

  function DAI_JOIN() external view returns (address daiJoin);

  function DSS_VEST() external view returns (address dssVest);

  function MAKER_DAO() external view returns (address makerDao);

  function VOW() external view returns (address vow);

  function minBuffer() external view returns (uint256 minBuffer);

  function maxBuffer() external view returns (uint256 maxBuffer);

  function buffer() external view returns (uint256 minBuffer, uint256 maxBuffer);

  // Methods

  function vestId() external view returns (uint256 vestId);

  function setBuffer(uint256 _minBuffer, uint256 _maxBuffer) external;

  function setVestId(uint256 _vestId) external;
}
