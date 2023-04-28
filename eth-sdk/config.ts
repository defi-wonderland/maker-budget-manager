import { defineConfig } from '@dethcrypto/eth-sdk';

export default defineConfig({
  contracts: {
    mainnet: {
      dai: '0x6b175474e89094c44da98b954eedeac495271d0f',
      keep3r: '0xeb02addCfD8B773A5FFA6B9d1FE99c566f8c44CC',
      networkPaymentAdapter: '0xaeFed819b6657B3960A8515863abe0529Dfc444A',
      vest: '0xa4c22f0e25C6630B2017979AcF1f865e94695C4b',
    },
  },
});
