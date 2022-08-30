# Saddle contracts tests in NEON

This project demonstrates usage of Saddle finance contracts in NEON environment.

# Saddle Finance deployment
- docker scripts:
- deploying local Solana
- deploying Neon proxy
- deploy of the Saddle pool contracts using the Neon proxy
- deploy of the Saddle metapool contracts using the Neon proxy
- deploy of the Saddle rewards distributor contracts using the Neon proxy

# Testing actions in Saddle protocol
## Addition of at least 3 Saddle pools:

- 2 non-native stable tokens
- 3 non-native stable tokens
- 1 non-native stable token + LP token of another pool - testing all types of swaps in all pools

## Testing the LP farming scenario
- adding liquidity to all pools
- performing swaps in all pools, receiving rewards
- gathering rewards from all pools after swaps
- transfer of part of LP tokens from one farming address to another - swaps and rewards receiving with new LP tokens distribution

## Installation

```bash
$ npm ci --legacy-peer-deps
```

### Build

```bash
$ npm run build
```

## Run local NEON environment:
```shell
sudo NEON_EVM_COMMIT=v0.8.3 FAUCET_COMMIT=latest REVISION=v0.9.1 docker-compose -f docker-compose.neon.yml up -d
```

Run:

```shell
npx hardhat run ./scripts/deploy2Tokens.ts
npx hardhat run ./scripts/deploy3Tokens.ts
npx hardhat run ./scripts/deployMetaPool.ts
```