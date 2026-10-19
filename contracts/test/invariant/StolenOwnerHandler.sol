// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {ConnectGateway} from "../../src/ConnectGateway.sol";

/// @dev The thief holds the member's Mera key and acts at random. The member
///      holds two GUARD devices and the recovery address, has started a
///      recovery reset, and checks in at least once a day (each warp step):
///      every open thief op is cancelled from a device.
contract StolenOwnerHandler is Base {
    struct Tracked {
        ConnectGateway.Op op;
        bool open;
    }

    uint64 public id;
    ConnectGateway.Op internal reset;
    Tracked[] internal thiefOps;

    uint256 public ghostThiefCancelledReset;
    uint256 public ghostThiefFinalized;
    uint256 public thiefStarts;

    constructor(ConnectGateway gw_, uint64 id_, ConnectGateway.Op memory reset_, uint256 thiefHoldsPk) {
        gw = gw_;
        ids = gw_.idRegistry();
        keys = gw_.keyRegistry();
        id = id_;
        reset = reset_;
        ownerPk = thiefHoldsPk;
        thief = vm.addr(thiefPk);
    }

    /// @dev Not a fixture here; a no-op so the fuzzer cannot redeploy anything.
    function setUp() public override {}

    function _target(uint256 seed) internal view returns (uint256) {
        return seed % 2 == 0 ? phonePk : laptopPk;
    }

    function thiefSuspend(uint256 seed) external {
        ConnectGateway.Action memory a = actKey(id, ConnectGateway.Kind.SuspendKey, _target(seed));
        try gw.suspendKey(a, authOwner(ownerPk, a)) {} catch {}
    }

    function thiefStart(uint8 kindSel, uint256 seed) external {
        ConnectGateway.Kind kind = ConnectGateway.Kind(1 + kindSel % 5); // all but RecoveryReset
        ConnectGateway.Action memory a = act(id, kind);
        bytes memory key;
        uint256 consentPk;
        if (kind == ConnectGateway.Kind.TransferOwner) {
            a.account = thief;
            consentPk = thiefPk;
        } else if (kind == ConnectGateway.Kind.ChangeRecovery) {
            a.account = thief;
        } else if (kind == ConnectGateway.Kind.AddKey) {
            uint256 tk = 0x9000 + seed % 20;
            a = actAdd(id, tk, ALL);
            key = p256Key(tk);
        } else {
            a = actKey(id, kind, _target(seed));
        }
        uint64 nonce = gw.nonceOf(id);
        bytes memory consent = consentPk == 0 ? bytes("") : ecdsa(consentPk, digestOf(a));
        try gw.start(a, authOwner(ownerPk, a), key, consent) {
            thiefOps.push(Tracked(opFor(a, ConnectGateway.Signer.Owner, nonce), true));
            thiefStarts++;
        } catch {}
    }

    /// The thief tries to kill the recovery reset with the owner key alone.
    function thiefCancelReset() external {
        ConnectGateway.Action memory a = cancelAct(id, reset);
        try gw.cancel(a, authOwner(ownerPk, a), reset) {
            ghostThiefCancelledReset++;
        } catch {}
    }

    function thiefFinalize(uint256 idx) external {
        if (thiefOps.length == 0) return;
        Tracked storage t = thiefOps[idx % thiefOps.length];
        if (!t.open) return;
        try gw.finalize(t.op, "") {
            t.open = false;
            ghostThiefFinalized++;
        } catch {}
    }

    /// Time passes (at most a day); the member reacts before it does.
    function warp(uint256 dt) external {
        memberCancelsAll();
        vm.warp(block.timestamp + bound(dt, 1, 1 days));
    }

    function memberCancelsAll() public {
        for (uint256 i; i < thiefOps.length; i++) {
            Tracked storage t = thiefOps[i];
            if (!t.open) continue;
            // a device cannot cancel its own removal: use the other one
            uint256 dev = t.op.kind == ConnectGateway.Kind.RemoveKey && t.op.keyHash == p256Hash(phonePk)
                ? laptopPk
                : phonePk;
            ConnectGateway.Action memory a = cancelAct(id, t.op);
            try gw.cancel(a, authDevice(dev, a), t.op) {
                t.open = false;
            } catch {
                (uint40 readyAt,) = gw.pending(gw.opIdOf(t.op));
                if (readyAt == 0) t.open = false;
            }
        }
    }

    function finalizeReset() external {
        try gw.finalize(reset, "") {} catch {}
    }
}
