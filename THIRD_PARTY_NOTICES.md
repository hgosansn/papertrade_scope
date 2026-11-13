# Third-party sources

## Papertrade Recomp

Source: [aaronjmars/papertrade-recomp](https://github.com/aaronjmars/papertrade-recomp/tree/a671e1aa10406ffbb2cd60e7c353e75dc1a625da), commit `a671e1aa10406ffbb2cd60e7c353e75dc1a625da`.

The preserved interface-evidence JSON and post-upgrade runtime capture under `evidence/open-source-abi/` originate from this independently reconstructed contract repository. MIT license, copyright (c) 2026 Aaron Elijah Mars. The full upstream license is included in [LICENSES/papertrade-recomp-MIT.txt](LICENSES/papertrade-recomp-MIT.txt). Reconstruction evidence is not verified original contract source.

## Hypermate ABI leads

[jihanwi/hypermate-bot's public fixture](https://github.com/jihanwi/hypermate-bot/blob/98a4480caaebd29a2b33500818a2b9cf2662e330/tests/fixtures/papertrade_exchange_abi.json) supplied event signature/topic leads, cross-checked against Recomp and public chain observations. The full fixture is linked rather than redistributed here. The runtime uses only the independently checked partial interface described in DECODER.md.

## Public observations

Saved chain logs, transaction data, bytecode, getters and block headers are public HyperEVM observations. Reference candles originate from Hyperliquid's documented public API. Wallet addresses in these fixtures are public on-chain participants. They are not connected user wallets or private credentials.

## shadcn/ui

Official new-york registry component sources are vendored under `src/components/ui/`. Source URLs are recorded in `provenance.json`; the original MIT license is in `LICENSES/shadcn-ui-MIT.txt`. The optional `tools/fetch-shadcn.py` refresh helper retrieves those official definitions. React, Tailwind, Radix, Lucide and other dependency versions are locked in `package-lock.json`; their notices are included in their npm packages.
