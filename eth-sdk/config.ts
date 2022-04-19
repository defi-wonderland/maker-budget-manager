import { defineConfig } from '@dethcrypto/eth-sdk';

export default defineConfig({
  contracts: {
    mainnet: {
      dai: '0x6b175474e89094c44da98b954eedeac495271d0f',
      keep3r: '0x4A6cFf9E1456eAa3b6f37572395C6fa0c959edAB',
      vest: '0x2Cc583c0AaCDaC9e23CB601fDA8F1A0c56Cdcb71',
    },
  },
});
