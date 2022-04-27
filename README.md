# MakerDAO Budget Manager

## What?

A contract to handle the vesting of DAI to pay for the maintenance of a Keep3r Network

## How?

The contract will allow the vest to be called when there is more to claim than `minBuffer`. If vested DAI surpass `maxBuffer`, it will first trim the DAI amount to that max, and then proceed in following order to:

- pay invoiced debt in DAI
- refill credits in Keep3r Job
- return any surplus amount of DAI

### Invoices

The governor of the contract can add invoices that result in increasing the total debt amount. When the vest is called, the debt get's reduced with the received DAI. Invoices will be tracked through a Dune dashboard, to allow public contrast with the actual work transactions of the network.

### Vest

MakerDAO can setup the DAI vest, and may vary the buffer thresholds.

### Keep3rJob Credits

A Keep3rJob will be replenished with DAI credits everytime it has less DAI than `minBuffer`, and will replenish it up to `maxBuffer`, or the remaining amount of DAI.

### Upkeep Mechanism

The Keep3rJob can also trigger the `claimDaiUpkeep` function, allowing a keeper to perform the task, being payed an amount in DAI for the spent gas. In that way, there will always be enough DAI for somebody to cleanse the vest and earn their reward.
