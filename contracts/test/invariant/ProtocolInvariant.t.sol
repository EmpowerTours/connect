// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import {console} from "forge-std/Test.sol";
import {Base} from "../Base.t.sol";
import {ConnectGateway} from "../../src/ConnectGateway.sol";
import {ProtocolHandler} from "./ProtocolHandler.sol";

contract ProtocolInvariantTest is Base {
    ProtocolHandler internal handler;
    uint64 internal id;

    function setUp() public override {
        super.setUp();
        id = registerDefault();
        ConnectGateway.Action memory a = actAdd(id, laptopPk, ALL);
        gw.addKey(a, authOD(ownerPk, phonePk, a), p256Key(laptopPk));
        handler = new ProtocolHandler(gw, id, ownerPk, recoveryPk);
        targetContract(address(handler));
        bytes4[] memory skip = new bytes4[](1);
        skip[0] = handler.setUp.selector; // no-op in the handler; don't waste calls on it
        excludeSelector(FuzzSelector({addr: address(handler), selectors: skip}));
    }

    /// No path finalizes before its delay (3 days, or 7 for transfer/recovery change).
    function invariant_noEarlyFinalize() public view {
        assertEq(handler.ghostEarlyFinalize(), 0);
    }

    /// A device key alone never starts a change.
    function invariant_deviceNeverStarts() public view {
        assertEq(handler.ghostDeviceStarts(), 0);
    }

    /// Every successful cancel is allowed by the cancel matrix.
    function invariant_cancelMatrixHolds() public view {
        assertEq(handler.ghostBadCancels(), 0);
    }

    function invariant_liveKeysBounded() public view {
        (, uint8 live) = keys.idKeys(id);
        assertLe(live, keys.MAX_LIVE_KEYS());
    }

    function invariant_idMapsOneToOne() public view {
        address o = ids.ownerOf(id);
        assertEq(ids.idOf(o), id);
        assertTrue(o != address(0));
        assertTrue(o != ids.recoveryOf(id));
        assertEq(ids.idCount(), 1);
    }

    function invariant_pendingPerTierBounded() public view {
        (,,, uint8 a, uint8 b, uint8 c) = gw.idState(id);
        assertLe(a, 5);
        assertLe(b, 5);
        assertLe(c, 5);
    }

    /// @dev Coverage report (forge test -vv): ops started, cancelled, finalized per run.
    function afterInvariant() external view {
        console.log("started", handler.ghostStarted());
        console.log("cancelled", handler.ghostCancelled());
        console.log("finalized", handler.ghostFinalized());
    }
}
