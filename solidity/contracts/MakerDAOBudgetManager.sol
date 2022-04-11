// SPDX-License-Identifier: MIT

/*

  Coded for MakerDAO and The Keep3r Network with ♥ by
  ██████╗░███████╗███████╗██╗  ░██╗░░░░░░░██╗░█████╗░███╗░░██╗██████╗░███████╗██████╗░██╗░░░░░░█████╗░███╗░░██╗██████╗░
  ██╔══██╗██╔════╝██╔════╝██║  ░██║░░██╗░░██║██╔══██╗████╗░██║██╔══██╗██╔════╝██╔══██╗██║░░░░░██╔══██╗████╗░██║██╔══██╗
  ██║░░██║█████╗░░█████╗░░██║  ░╚██╗████╗██╔╝██║░░██║██╔██╗██║██║░░██║█████╗░░██████╔╝██║░░░░░███████║██╔██╗██║██║░░██║
  ██║░░██║██╔══╝░░██╔══╝░░██║  ░░████╔═████║░██║░░██║██║╚████║██║░░██║██╔══╝░░██╔══██╗██║░░░░░██╔══██║██║╚████║██║░░██║
  ██████╔╝███████╗██║░░░░░██║  ░░╚██╔╝░╚██╔╝░╚█████╔╝██║░╚███║██████╔╝███████╗██║░░██║███████╗██║░░██║██║░╚███║██████╔╝
  ╚═════╝░╚══════╝╚═╝░░░░░╚═╝  ░░░╚═╝░░░╚═╝░░░╚════╝░╚═╝░░╚══╝╚═════╝░╚══════╝╚═╝░░╚═╝╚══════╝╚═╝░░╚═╝╚═╝░░╚══╝╚═════╝░
  https://defi.sucks

*/

pragma solidity >=0.8.4 <0.9.0;

import './utils/Governable.sol';
import './utils/DustCollector.sol';

import '../interfaces/external/IKeep3rV2.sol';
import '../interfaces/external/IDssVest.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/utils/math/Math.sol';

contract MakerDAOBudgetManager is Governable, DustCollector {
  uint256 immutable minBuffer;
  uint256 immutable maxBuffer;

  uint256 public daiToClaim;

  uint256 VEST_ID;

  event InvoicedGas(uint256 _gasCostETH, uint256 _claimableDai);
  event DaiReturned(uint256);
  event TokenCreditsRefilled(uint256);
  event ClaimedDai(uint256);

  error MinBuffer();

  address constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
  address constant DSS_VEST = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
  // Add setters!
  address constant KEEP3R = 0x4A6cFf9E1456eAa3b6f37572395C6fa0c959edAB;
  address constant JOB = 0x28937B751050FcFd47Fd49165C6E1268c296BA19;

  constructor(
    address _governor,
    uint256 _minBuffer,
    uint256 _maxBuffer
  ) Governable(_governor) {
    minBuffer = _minBuffer;
    maxBuffer = _maxBuffer;
  }

  // Views

  function credits() public view returns (uint256 _daiCredits) {
    return IKeep3rV2(KEEP3R).jobTokenCredits(JOB, DAI);
  }

  // buffer can be negative?
  function buffer() public view returns (int256 _dai) {
    _dai += int256(credits());
    _dai -= int256(daiToClaim);
  }

  // Methods

  function invoiceGas(uint256 _gasCostETH, uint256 _claimableDai) external onlyGovernor {
    /* TODO:
     * - _claimableDai = twap calculation for ETH / DAI
     * - DAI_WETH_V3_POOL = 0xC2e9F25Be6257c210d7Adf0D4Cd6E3E881ba25f8
     * - add way of register from-to of invoicedGas
     */

    daiToClaim += _claimableDai;

    // emits event to be tracked in DuneAnalytics dashboard & contrast with txs
    emit InvoicedGas(_gasCostETH, _claimableDai);
  }

  function claimDai() external onlyGovernor {
    int256 _buffer = buffer();
    // can't claim when minBuffer has not been reached
    if (_buffer >= int256(minBuffer)) revert MinBuffer();

    uint256 daiBalance = IERC20(DAI).balanceOf(address(this));
    IDssVest(DSS_VEST).vest(VEST_ID);
    // removes previous balance from scope
    daiBalance = IERC20(DAI).balanceOf(address(this)) - daiBalance;

    // Checks for credits on Keep3rJob and refills up to minBuffer
    uint256 daiCredits = credits();
    int256 creditsToRefill = int256(minBuffer - daiCredits);
    if (creditsToRefill > 0) {
      // TODO: add setters and behaviour for low/high thresholds
      IERC20(DAI).approve(KEEP3R, uint256(creditsToRefill));
      IKeep3rV2(KEEP3R).addTokenCreditsToJob(JOB, DAI, uint256(creditsToRefill));
      // refilled DAI do not count as claimed
      daiBalance -= uint256(creditsToRefill);

      emit TokenCreditsRefilled(uint256(creditsToRefill));
    }

    // limits claim to maxBuffer and gives back any excess of DAI
    uint256 claimableDai = Math.min(daiToClaim, maxBuffer);
    if (daiBalance > claimableDai) {
      uint256 daiToReturn = daiBalance - claimableDai;
      // TODO: set transfer back destination
      IERC20(DAI).transfer(DAI, daiToReturn);
      daiBalance -= daiToReturn;

      emit DaiReturned(daiToReturn);
    }

    // reduces debt of DAI
    daiToClaim -= daiBalance;
    // should we use: delete daiToClaim; ?

    emit ClaimedDai(daiBalance);
  }
}
