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

import '../interfaces/IMakerDAOBudgetManager.sol';
import '../interfaces/external/IKeep3rV2.sol';
import '../interfaces/external/IDaiJoin.sol';
import '../interfaces/external/IDssVest.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/utils/math/Math.sol';

contract MakerDAOBudgetManager is IMakerDAOBudgetManager, Governable, DustCollector {
  uint256 public immutable override minBuffer;
  uint256 public immutable override maxBuffer;

  uint256 public override daiToClaim;

  /* TODO: add setters */
  uint256 public immutable override vestId;
  address public immutable override job;

  mapping(uint256 => uint256) public override invoiceAmount;
  uint256 public override invoiceNonce;

  address public constant override DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
  address public constant override DAI_JOIN = 0x9759A6Ac90977b93B58547b4A71c78317f391A28;
  address public constant override VOW = 0xA950524441892A31ebddF91d3cEEFa04Bf454466;
  address public constant override DSS_VEST = 0x2Cc583c0AaCDaC9e23CB601fDA8F1A0c56Cdcb71;

  /* TODO: add setters */
  address public constant override KEEP3R = 0xeb02addCfD8B773A5FFA6B9d1FE99c566f8c44CC;

  constructor(
    address _governor,
    address _job,
    uint256 _minBuffer,
    uint256 _maxBuffer,
    uint256 _vestId
  ) Governable(_governor) {
    job = _job;
    minBuffer = _minBuffer;
    maxBuffer = _maxBuffer;
    vestId = _vestId;

    IERC20(DAI).approve(DAI_JOIN, type(uint256).max);
  }

  // Views

  function credits() public view override returns (uint256 _daiCredits) {
    return IKeep3rV2(KEEP3R).jobTokenCredits(job, DAI);
  }

  // Methods

  function invoiceGas(
    uint256 _gasCostETH,
    uint256 _claimableDai,
    string memory _description
  ) external override onlyGovernor {
    daiToClaim += _claimableDai;
    invoiceAmount[++invoiceNonce] = _claimableDai;

    // emits event to be tracked in DuneAnalytics dashboard & contrast with txs
    emit InvoicedGas(invoiceNonce, _gasCostETH, _claimableDai, _description);
  }

  function deleteInvoice(uint256 _invoiceNonce) external override onlyGovernor {
    uint256 deleteAmount = invoiceAmount[_invoiceNonce];
    if (deleteAmount > daiToClaim) revert InvoiceClaimed();

    unchecked {
      // deleteAmount < daiToClaim
      daiToClaim -= deleteAmount;
    }
    delete invoiceAmount[_invoiceNonce];

    // emits event to filter out InvoicedGas events
    emit DeletedInvoice(_invoiceNonce);
  }

  function claimDai() external override onlyGovernor {
    // claims DAI
    uint256 daiAmount = IERC20(DAI).balanceOf(address(this));
    IDssVest(DSS_VEST).vest(vestId);
    // removes previous balance from scope
    daiAmount = IERC20(DAI).balanceOf(address(this)) - daiAmount;

    /* TODO: discuss if it's worth the revert */
    if (daiAmount < minBuffer) revert MinBuffer();

    // avoids any claim above maxBuffer
    uint256 daiToReturn;
    if (daiAmount > maxBuffer) {
      unchecked {
        // daiAmount > maxBuffer
        daiToReturn = daiAmount - maxBuffer;
      }
      daiAmount = maxBuffer;
    }

    // checks for DAI debt and reduces debt if applies
    uint256 claimableDai;
    if (daiToClaim > minBuffer) {
      claimableDai = Math.min(daiToClaim, daiAmount);

      // reduces debt accountance
      daiToClaim -= claimableDai;
      daiAmount -= claimableDai;
    }

    // checks for credits on Keep3rJob and refills up to maxBuffer
    uint256 daiCredits = credits();
    uint256 creditsToRefill;
    if (daiCredits < minBuffer && daiAmount > 0) {
      // refill credits up to maxBuffer or available DAI
      creditsToRefill = Math.min(maxBuffer - daiCredits, daiAmount);

      // refill DAI credits on Keep3rJob
      IERC20(DAI).approve(KEEP3R, uint256(creditsToRefill));
      IKeep3rV2(KEEP3R).addTokenCreditsToJob(job, DAI, uint256(creditsToRefill));

      daiAmount -= creditsToRefill;
    }

    // returns any excess of DAI
    daiToReturn += daiAmount;
    if (daiToReturn > 0) {
      IDaiJoin(DAI_JOIN).join(VOW, daiToReturn);
    }

    emit ClaimedDai(invoiceNonce, claimableDai, creditsToRefill, daiToReturn);
  }
}
