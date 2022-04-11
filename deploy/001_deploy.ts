import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { shouldVerifyContract } from '../utils/deploy';
import { toUnit } from '@utils/bn';

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const args = [deployer, toUnit(4_000), toUnit(20_000)];

  const deploy = await hre.deployments.deploy('MakerDAOBudgetManager', {
    contract: 'solidity/contracts/MakerDAOBudgetManager.sol:MakerDAOBudgetManager',
    from: deployer,
    args,
    log: true,
  });

  if (await shouldVerifyContract(deploy)) {
    await hre.run('verify:verify', {
      address: deploy.address,
      constructorArguments: args,
    });
  }
};
deployFunction.dependencies = [];
deployFunction.tags = ['MakerDAOBudgetManager'];
export default deployFunction;
