module.exports = {
  skipFiles: ['contracts/for-test', 'interfaces', 'contracts/external', 'mocks'],
  mocha: {
    forbidOnly: true,
    grep: '@skip-on-coverage',
    invert: true,
  },
};
