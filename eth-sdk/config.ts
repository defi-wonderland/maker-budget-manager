import { defineConfig } from '@dethcrypto/eth-sdk';

export default defineConfig({
  contracts: {
    mainnet: {
      dai: '0x6b175474e89094c44da98b954eedeac495271d0f',
      keep3r: '0xeb02addCfD8B773A5FFA6B9d1FE99c566f8c44CC',
      vest: '0x2Cc583c0AaCDaC9e23CB601fDA8F1A0c56Cdcb71',
    },
  },
});
