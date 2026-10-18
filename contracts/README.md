# Connect protocol contracts

Phase 1 of the Connect protocol on Monad (design: `connect-monad-protocol.md`). Three
contracts, no owner, no upgrade path:

| Contract | Role |
|---|---|
| `ConnectGateway` | The only writer. Verifies EIP-712 signatures (owner and recovery: ECDSA, then ERC-1271; devices: P-256 or secp256k1), runs the timelock, the cancel matrix and the pause guardian. Deploys both registries in its constructor. |
| `ConnectIdRegistry` | Connect ID → owner (the member's Mera wallet) and optional recovery address. One ID per owner. |
| `ConnectKeyRegistry` | Device keys per ID: type, scopes (POST, REACT, FOLLOW, PROFILE, ATTEST, GUARD), expiry, Active/Suspended/Retired/Removed, max 20 live keys, O(1) reset by key epoch. |

## Rules enforced on chain

- **Delays:** 7 days for transfer ownership and change recovery; 3 days for delayed key
  operations and the recovery reset. Anyone can finalize within 30 days after `readyAt`.
- **Instant:** register (owner signature, the relayer can submit); owner + GUARD device adds a
  key; owner suspends a key; a device retires itself.
- **Device keys never start a change.** GUARD keys can cancel and co-sign, and keep those
  powers while suspended (so a thief holding the Mera key can't lock the member out).
- **Cancel matrix:**
  - owner-only ops: the owner, the recovery address or any GUARD device;
  - owner + device ops: recovery, any GUARD device, or owner + device, but not the owner alone;
  - the recovery reset: owner + device only;
  - a device never cancels its own removal.
- **Pending ops:** max 5 per signer tier, so a thief with one key can't fill the member's slots.
  Transfer, reset and recovery change invalidate every other pending op of that ID.
- **Pause:** the guardian, a Safe, can pause registration and key additions for at most 14 days,
  once per 14-day cooldown, and can renounce. It never touches IDs, keys, cancels, finalizes or
  recovery.

### The delay guard (why Solonet runs use short delays)

Monad Solonet can't warp time, so the real flows need short delays. The gateway constructor
takes `delay` and `longDelay` and enforces them by chain id:

- **chains 31337 (anvil) and 20143 (Solonet):** any `1 ≤ delay ≤ longDelay`, with `delay ≤ 3 days`
  and `longDelay ≤ 7 days` (dev build; `isDevBuild()` returns true);
- **every other chain, including 10143 testnet and 143 mainnet:** exactly 3 days and 7 days,
  or the constructor reverts.

The deploy script also hardcodes 3 and 7 days for 10143. A short-delay build therefore can't
exist on testnet or mainnet, even from an edited script.

## Develop

```bash
git submodule update --init contracts/lib/forge-std contracts/lib/openzeppelin-contracts
cd contracts
forge test                      # unit, fuzz (512 runs) and invariant (128 runs × depth 120)
FOUNDRY_PROFILE=deep forge test # fuzz 20k runs, invariants 512 × 300
forge snapshot                  # gas snapshot (.gas-snapshot)
```

`evm_version = "osaka"` gives the test EVM the P256VERIFY precompile Monad has. solc 0.8.28
caps the bytecode target at prague (no new opcodes over cancun).

## Deploy

All three modes go through `npm run protocol:deploy`, which:

- refuses chain 143;
- checks the RPC's chain id;
- uses forge's gas estimate × 1.10, because Monad charges the gas **limit**;
- prints the gas charged and the MON cost.

| Command | What it does |
|---|---|
| `npm run protocol:deploy -- --solonet` | Dry run on local Monad Solonet (`http://localhost:8080`, chain 20143) with a dev build (20 s / 40 s). Uses the public anvil dev account (test mnemonic, index 7). Writes `contracts/deployments/monad-testnet-dryrun-solonet.json` (git-ignored). |
| `npm run protocol:flows` | The real flows on that Solonet deployment: register, instant add, delayed add (one cancelled, one finalized), change recovery on the long path. Prints the gas charged per step. |
| `npm run protocol:deploy -- --fork` | Dry run on an anvil fork of testnet, with production delays. |
| `npm run protocol:deploy -- --broadcast` | **Real testnet deploy. Run by you, with your own key.** It reads the key from `DEPLOYER_KEY_FILE` (default `/home/box/.connect/deployer.key`, chmod 600, outside the repo), passes it to forge via env only and never prints it. It simulates first and refuses if the balance can't cover the estimate. It writes `deployments/monad-testnet.json` at the repo root; commit that file. |

Env: `TESTNET_RPC` (default `https://testnet-rpc.monad.xyz`), `GUARDIAN` (default deployer on
testnet; the 2-of-3 Safe on mainnet), `GAS_MULT` (default 110), `DEV_DELAY` / `DEV_LONG_DELAY`
(Solonet only).

### Gas measured on Solonet

Solonet runs the Monad gas schedule (MIP-8 storage pages, limit-charged). At a 100 gwei base fee:

| Step | Gas charged (limit = estimate × 1.10) | MON |
|---|---:|---:|
| Deploy (gateway + 2 registries) | 6,003,852 | 0.600 |
| Register (+ first device key) | 291,875 | 0.0292 |
| Add device, instant (owner + device) | 195,369 | 0.0195 |
| Start delayed add (owner) | 159,866 | 0.0160 |
| Start change recovery (owner + device) | 162,179 | 0.0162 |
| Cancel (device) | 134,347 | 0.0134 |
| Finalize delayed add | 123,470 | 0.0123 |
| Finalize change recovery | 85,258 | 0.0085 |

## Relayer (off-chain config, enforced by the Connect server, not the contracts)

The contracts don't care who submits a signed message. The relayer decides what Connect pays for.

- **Sponsored registration requires** a signup through a valid invite link, **or** a one-time
  phone or email verification. Everyone else self-pays: the member's own Mera wallet submits
  the same signed `register` call.
- **1 sponsored registration per account** (Mera address).
- **Per-IP cap:** 3 sponsored signups per IP per day. Invite-link signups are exempt from the
  IP cap. They are limited per inviter instead (20 per inviter per day).
- **Max 10 sponsored transactions per account per day** (key adds, cancels, finalizes and so on).
- **Wallet limits:** 100 MON balance cap on the relayer wallet (top up from a separate funding
  wallet; never hold more); 50 MON per day spend cap. If the cap is hit, sponsorship stops and
  members self-pay until the next day.
- Every sponsored transaction uses gas limit = estimate × 1.10 (Monad charges the limit).

The relayer key lives only in the server's secret store. It is a gas payer, not an authority:
it can't sign anything for a member.
