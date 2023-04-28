import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { shouldVerifyContract } from '../utils/deploy';

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const wonderland = '0x45fEEBbd5Cf86dF61be8F81025E22Ae07a07cB23';
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
