// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {ConnectGateway} from "../../src/ConnectGateway.sol";
import {StolenOwnerHandler} from "./StolenOwnerHandler.sol";

/// Stolen Mera key: whatever the thief does, the member's recovery reset wins.
contract StolenOwnerInvariantTest is Base {
    StolenOwnerHandler internal handler;
    uint64 internal id;
    ConnectGateway.Op internal reset;

    function setUp() public override {
        super.setUp();
        id = registerDefault();
        ConnectGateway.Action memory a = actAdd(id, laptopPk, ALL);
        gw.addKey(a, authOD(ownerPk, phonePk, a), p256Key(laptopPk));

        a = act(id, ConnectGateway.Kind.RecoveryReset);
        a.account = newOwner;
        a.flag = true;
        reset = startOp(a, authRecovery(recoveryPk, a), "", newOwnerPk);

        handler = new StolenOwnerHandler(gw, id, reset, ownerPk);
        targetContract(address(handler));
        bytes4[] memory skip = new bytes4[](1);
        skip[0] = handler.setUp.selector; // no-op in the handler; don't waste calls on it
        excludeSelector(FuzzSelector({addr: address(handler), selectors: skip}));
    }

    /// The ID is only ever owned by the original (stolen) wallet or the member's new one.
    function invariant_thiefNeverOwns() public view {
        address o = ids.ownerOf(id);
        assertTrue(o == owner || o == newOwner, "owner moved to a third party");
        assertEq(ids.recoveryOf(id), recovery, "recovery changed");
    }

    function invariant_thiefCannotCancelReset() public view {
        assertEq(handler.ghostThiefCancelledReset(), 0);
        assertEq(handler.ghostThiefFinalized(), 0);
    }

    /// Until it lands, the reset stays pending and current.
    function invariant_resetAlive() public view {
        if (ids.ownerOf(id) == newOwner) return;
        (uint40 readyAt, uint32 opEpoch) = gw.pending(gw.opIdOf(reset));
        (,, uint32 cur,,,) = gw.idState(id);
        assertTrue(readyAt != 0, "reset gone");
        assertEq(opEpoch, cur, "reset stale");
    }

    /// At the end of every run, the member can always land the reset.
    function afterInvariant() external {
        handler.memberCancelsAll();
        if (ids.ownerOf(id) != newOwner) {
            (uint40 readyAt,) = gw.pending(gw.opIdOf(reset));
            if (block.timestamp < readyAt) vm.warp(readyAt);
            gw.finalize(reset, "");
        }
        assertEq(ids.ownerOf(id), newOwner);
    }
}
