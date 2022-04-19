//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

import '../../interfaces/external/IKeep3rV2.sol';

contract JobForTest {
  address constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
  address immutable keep3r;

  constructor(address _keep3r) {
    keep3r = _keep3r;
  }

  function workForKP3Rs(uint256 _amount) external {
    IKeep3rV2(keep3r).bondedPayment(msg.sender, _amount);
  }

  function workForDAIs(uint256 _amount) external {
    IKeep3rV2(keep3r).directTokenPayment(DAI, msg.sender, _amount);
  }
}
