//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

import '../../interfaces/external/IKeep3rV2.sol';
import '../../interfaces/IMakerDAOBudgetManager.sol';

contract JobForTest {
  address constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
  address immutable keep3r;
  address immutable budgetManager;

  uint256 public constant DAI_REWARD = 1_000 ether;

  constructor(address _keep3r, address _budgetManager) {
    keep3r = _keep3r;
    budgetManager = _budgetManager;
  }

  function workForKP3Rs(uint256 _amount) external {
    IKeep3rV2(keep3r).bondedPayment(msg.sender, _amount);
  }

  function workForDAIs(uint256 _amount) external {
    IKeep3rV2(keep3r).directTokenPayment(DAI, msg.sender, _amount);
  }

  function cleanseDAIs() external {
    IMakerDAOBudgetManager(budgetManager).claimDaiUpkeep();
    IKeep3rV2(keep3r).directTokenPayment(DAI, msg.sender, DAI_REWARD);
  }
}
