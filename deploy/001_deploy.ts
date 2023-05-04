import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { shouldVerifyContract } from '../utils/deploy';

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const wonderland = '0xa211CA28299D9caaD3d6A050C98f393726B1F39e';
  const args = [wonderland];

  const deploy = await hre.deployments.deploy('MakerDAOBudgetManager', {
    contract: 'solidity/contracts/MakerDAOBudgetManager.sol:MakerDAOBudgetManager',
    from: deployer,
    args,
    log: true,
  });

  if (await shouldVerifyContract(deploy)) {
    await hre.run('verify:verify', {
      contract: 'solidity/contracts/MakerDAOBudgetManager.sol:MakerDAOBudgetManager',
      address: deploy.address,
      constructorArguments: args,
    });
  }
};
deployFunction.dependencies = [];
deployFunction.tags = ['MakerDAOBudgetManager'];
export default deployFunction;
