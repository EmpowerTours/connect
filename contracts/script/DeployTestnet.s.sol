// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";

import {ConnectGateway} from "../src/ConnectGateway.sol";

/// Connect protocol on Monad TESTNET (chain 10143). Never mainnet: the script
/// refuses every chain but 10143, plus 20143 (local Monad Solonet) for dry
/// runs only, which write a separate *-dryrun-* file.
///
/// Delays: on 10143 the gateway is deployed with the production delays
/// (3 days, 7 days for transfer/recovery change). The gateway constructor
/// itself reverts on any other value off the dev chains, so a testnet build
/// can't be a short-delay build even if this script were edited. On Solonet
/// (which can't warp time) DEV_DELAY / DEV_LONG_DELAY (default 20 s / 40 s)
/// let the real flows run end to end.
///
/// Guardian: the pause-only role. Defaults to the deployer on testnet; on
/// mainnet it is the EmpowerTours 2-of-3 Safe (renounce ~6 months after
/// mainnet). It can only pause registration and key additions, max 14 days.
///
///   env: DEPLOYER_PK (testnet; the npm wrapper reads it from a file outside
///          the repo and never prints it). On Solonet, if unset, the public
///          anvil dev account DRYRUN_ACCOUNT_INDEX (default 7) is derived from
///          the well-known test mnemonic in memory.
///        GUARDIAN (default deployer)
///        DEV_DELAY, DEV_LONG_DELAY (Solonet only)
///        OUT (default deployments/monad-testnet.json, or the dry-run file)
contract DeployTestnet is Script {
    uint256 internal constant MAINNET = 143;
    uint256 internal constant TESTNET = 10143;
    uint256 internal constant SOLONET = 20143;
    string internal constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

    function run() external {
        require(block.chainid != MAINNET, "refusing Monad mainnet (143)");
        bool solonet = block.chainid == SOLONET;
        require(block.chainid == TESTNET || solonet, "Monad testnet (10143) only; Solonet 20143 for dry runs");

        uint256 pk = solonet
            ? vm.envOr("DEPLOYER_PK", vm.deriveKey(ANVIL_MNEMONIC, uint32(vm.envOr("DRYRUN_ACCOUNT_INDEX", uint256(7)))))
            : vm.envUint("DEPLOYER_PK");
        address me = vm.addr(pk);
        address guardian = vm.envOr("GUARDIAN", me);
        uint256 delay_ = solonet ? vm.envOr("DEV_DELAY", uint256(20)) : 3 days;
        uint256 longDelay_ = solonet ? vm.envOr("DEV_LONG_DELAY", uint256(40)) : 7 days;
        string memory out = vm.envOr(
            "OUT",
            string(solonet ? "deployments/monad-testnet-dryrun-solonet.json" : "deployments/monad-testnet.json")
        );
        uint256 fromBlock = block.number;

        vm.startBroadcast(pk);
        ConnectGateway gw = new ConnectGateway(guardian, delay_, longDelay_);
        vm.stopBroadcast();

        string memory k = "d";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "fromBlock", fromBlock);
        vm.serializeAddress(k, "deployer", me);
        vm.serializeAddress(k, "gateway", address(gw));
        vm.serializeAddress(k, "idRegistry", address(gw.idRegistry()));
        vm.serializeAddress(k, "keyRegistry", address(gw.keyRegistry()));
        vm.serializeAddress(k, "guardian", guardian);
        vm.serializeString(
            k,
            "guardianNote",
            "Pause-only (registrations and key additions, max 14 days, 14-day cooldown, renounceable). Testnet: deployer. Mainnet: EmpowerTours 2-of-3 Safe."
        );
        vm.serializeUint(k, "delaySeconds", gw.delay());
        vm.serializeUint(k, "longDelaySeconds", gw.longDelay());
        vm.serializeBool(k, "devBuild", gw.isDevBuild());
        vm.serializeString(k, "eip712Name", "ConnectProtocol");
        string memory json = vm.serializeString(k, "eip712Version", "1");
        vm.writeJson(json, out);
        console.log("Connect protocol deployed; wrote", out);
        console.log("gateway", address(gw));
    }
}
