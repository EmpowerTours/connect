// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import {Base, MockWallet} from "./Base.t.sol";
import {ConnectGateway} from "../src/ConnectGateway.sol";
import {ConnectIdRegistry} from "../src/ConnectIdRegistry.sol";

/// @dev ERC-1271 wallet that returns a fixed answer.
contract FixedWallet {
    bytes4 internal immutable answer;

    constructor(bytes4 answer_) {
        answer = answer_;
    }

    function isValidSignature(bytes32, bytes calldata) external view returns (bytes4) {
        return answer;
    }
}

/// @dev ERC-1271 wallet that reverts.
contract RevertingWallet {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        revert("no");
    }
}

/// @dev ERC-1271 wallet that tries to re-enter the gateway while validating.
contract ReentrantWallet {
    ConnectGateway internal immutable gw;

    constructor(ConnectGateway gw_) {
        gw = gw_;
    }

    function isValidSignature(bytes32, bytes calldata) external returns (bytes4) {
        gw.renounceGuardian(); // any state change: must fail under STATICCALL
        return 0x1626ba7e;
    }
}

/// In-house audit: attack tests (see connect-contracts-audit.md).
contract AttacksTest is Base {
    uint256 internal constant SECP_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    // ------------------------------------------------------- replay

    function test_replay_acrossChains() public {
        ConnectGateway.RegisterParams memory p = regParams(owner, recovery, phonePk, ALL);
        bytes memory sig = signRegister(ownerPk, p); // signed for chain 31337
        vm.chainId(20143);
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.register(p, sig);
    }

    function test_replay_acrossGatewayDeployments() public {
        ConnectGateway gw2 = new ConnectGateway(guardian, 3 days, 7 days);
        ConnectGateway.RegisterParams memory p = regParams(owner, recovery, phonePk, ALL);
        bytes memory sig = signRegister(ownerPk, p);
        gw.register(p, sig);
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw2.register(p, sig);
    }

    function test_replay_acrossIds() public {
        uint64 id1 = registerDefault();
        ConnectGateway.RegisterParams memory p = regParams(newOwner, address(0), laptopPk, ALL);
        uint64 id2 = gw.register(p, signRegister(newOwnerPk, p));
        // the same owner key signs for id1; replaying the signature on id2 fails
        ConnectGateway.Action memory a = actKey(id1, ConnectGateway.Kind.SuspendKey, phonePk);
        ConnectGateway.Auth memory auth = authOwner(ownerPk, a);
        a.id = id2;
        a.keyHash = p256Hash(laptopPk);
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.suspendKey(a, auth);
    }

    function test_replay_registerAfterTransferAway() public {
        uint64 id = registerDefault();
        ConnectGateway.RegisterParams memory p = regParams(owner, recovery, phonePk, ALL);
        bytes memory oldSig = ecdsa(ownerPk, gw.registerDigest(p, 0));
        ConnectGateway.Action memory a = act(id, ConnectGateway.Kind.TransferOwner);
        a.account = newOwner;
        ConnectGateway.Op memory op = startOp(a, authOwner(ownerPk, a), "", newOwnerPk);
        vm.warp(block.timestamp + longDelay);
        gw.finalize(op, "");
        p.deadline = block.timestamp + 1 hours;
        oldSig = ecdsa(ownerPk, gw.registerDigest(p, 0)); // even re-signed with the old nonce
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.register(p, oldSig);
    }

    // --------------------------------------------------- ERC-1271

    function test_1271_wrongMagicRejected() public {
        FixedWallet w = new FixedWallet(0xdeadbeef);
        ConnectGateway.RegisterParams memory p = regParams(address(w), recovery, phonePk, ALL);
        bytes memory sig = signRegister(ownerPk, p);
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.register(p, sig);
    }

    function test_1271_revertingWalletRejected() public {
        RevertingWallet w = new RevertingWallet();
        ConnectGateway.RegisterParams memory p = regParams(address(w), recovery, phonePk, ALL);
        bytes memory sig = signRegister(ownerPk, p);
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.register(p, sig);
    }

    function test_1271_reentrancyBlockedByStaticcall() public {
        ReentrantWallet w = new ReentrantWallet(gw);
        ConnectGateway.RegisterParams memory p = regParams(address(w), recovery, phonePk, ALL);
        bytes memory sig = signRegister(ownerPk, p);
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.register(p, sig);
        assertEq(gw.guardian(), guardian);
        assertEq(ids.idCount(), 0);
    }

    function test_1271_unrelatedEcdsaKeyCannotSpeakForWallet() public {
        MockWallet w = new MockWallet(owner);
        ConnectGateway.RegisterParams memory p = regParams(address(w), recovery, phonePk, ALL);
        bytes memory sig = signRegister(thiefPk, p);
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.register(p, sig);
    }

    function test_1271_smartWalletAsRecoveryRunsReset() public {
        MockWallet w = new MockWallet(recovery);
        ConnectGateway.RegisterParams memory p = regParams(owner, address(w), phonePk, ALL);
        uint64 id = gw.register(p, signRegister(ownerPk, p));
        ConnectGateway.Action memory a = act(id, ConnectGateway.Kind.RecoveryReset);
        a.account = newOwner;
        ConnectGateway.Op memory op = startOp(a, authRecovery(recoveryPk, a), "", newOwnerPk);
        vm.warp(block.timestamp + delay);
        gw.finalize(op, "");
        assertEq(ids.ownerOf(id), newOwner);
    }

    // ------------------------------------------------- malleability

    function test_malleability_highSEcdsaRejected() public {
        ConnectGateway.RegisterParams memory p = regParams(owner, recovery, phonePk, ALL);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, gw.registerDigest(p, 0));
        bytes memory flipped = abi.encodePacked(r, bytes32(SECP_N - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.register(p, flipped);
    }

    function test_malleability_highSP256Rejected() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actAdd(id, laptopPk, ALL);
        ConnectGateway.Auth memory auth = authOD(ownerPk, phonePk, a);
        (bytes32 r, bytes32 s) = abi.decode(auth.device.sig, (bytes32, bytes32));
        auth.device.sig = abi.encode(r, bytes32(P256_N - uint256(s)));
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.addKey(a, auth, p256Key(laptopPk));
    }

    // ---------------------------------------------- timelock bypass

    function test_timelock_cannotRelabelOpToShorterDelay() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = act(id, ConnectGateway.Kind.TransferOwner);
        a.account = newOwner;
        ConnectGateway.Op memory op = startOp(a, authOwner(ownerPk, a), "", newOwnerPk);
        vm.warp(block.timestamp + delay); // 3 days: enough for other kinds, not for a transfer
        op.kind = ConnectGateway.Kind.RecoveryReset;
        vm.expectRevert(ConnectGateway.UnknownOp.selector);
        gw.finalize(op, "");
        op.kind = ConnectGateway.Kind.TransferOwner;
        op.tier = ConnectGateway.Signer.Recovery;
        vm.expectRevert(ConnectGateway.UnknownOp.selector);
        gw.finalize(op, "");
        op.tier = ConnectGateway.Signer.Owner;
        vm.expectRevert(ConnectGateway.NotReady.selector);
        gw.finalize(op, "");
    }

    function test_timelock_cancelledOpCannotFinalize() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actAdd(id, laptopPk, ALL);
        ConnectGateway.Op memory op = startOp(a, authOwner(ownerPk, a), p256Key(laptopPk), 0);
        ConnectGateway.Action memory c = cancelAct(id, op);
        gw.cancel(c, authDevice(phonePk, c), op);
        vm.warp(block.timestamp + delay);
        vm.expectRevert(ConnectGateway.UnknownOp.selector);
        gw.finalize(op, p256Key(laptopPk));
    }

    function test_timelock_noInstantPathForTransferOrRecovery() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = act(id, ConnectGateway.Kind.TransferOwner);
        a.account = newOwner;
        ConnectGateway.Auth memory auth = authOD(ownerPk, phonePk, a);
        vm.expectRevert(ConnectGateway.BadKind.selector);
        gw.addKey(a, auth, "");
        vm.expectRevert(ConnectGateway.BadKind.selector);
        gw.suspendKey(a, auth);
    }

    // ----------------------------------------- cancel-matrix abuse

    function test_cancel_foreignDeviceCannotCancel() public {
        uint64 id = registerDefault();
        ConnectGateway.RegisterParams memory p = regParams(thief, address(0), laptopPk, ALL);
        gw.register(p, signRegister(thiefPk, p)); // thief's own ID with a GUARD laptop
        ConnectGateway.Action memory a = actAdd(id, miniAppPk, MESSAGES);
        ConnectGateway.Op memory op = startOp(a, authOwner(ownerPk, a), p256Key(miniAppPk), 0);
        ConnectGateway.Action memory c = cancelAct(id, op);
        ConnectGateway.Auth memory auth = authDevice(laptopPk, c);
        vm.expectRevert(ConnectGateway.NotGuard.selector);
        gw.cancel(c, auth, op);
    }

    function test_cancel_opFromAnotherIdRejected() public {
        uint64 id = registerDefault();
        ConnectGateway.RegisterParams memory p = regParams(newOwner, address(0), laptopPk, ALL);
        uint64 id2 = gw.register(p, signRegister(newOwnerPk, p));
        ConnectGateway.Action memory a = actAdd(id2, miniAppPk, MESSAGES);
        ConnectGateway.Op memory op = startOp(a, authOwner(newOwnerPk, a), p256Key(miniAppPk), 0);
        ConnectGateway.Action memory c = cancelAct(id, op); // id1's device tries to cancel id2's op
        ConnectGateway.Auth memory auth = authDevice(phonePk, c);
        vm.expectRevert(ConnectGateway.OpMismatch.selector);
        gw.cancel(c, auth, op);
    }

    function test_cancel_deviceSignatureNotReusable() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = act(id, ConnectGateway.Kind.ChangeRecovery);
        a.account = thief;
        ConnectGateway.Op memory op = startOp(a, authOwner(ownerPk, a), "", 0);
        ConnectGateway.Action memory c = cancelAct(id, op);
        ConnectGateway.Auth memory auth = authDevice(phonePk, c);
        gw.cancel(c, auth, op);
        // same op parameters started again get a new opId (nonce), and the old cancel sig is spent
        op = startOp(a.withFreshDeadline(block.timestamp), authOwner(ownerPk, a.withFreshDeadline(block.timestamp)), "", 0);
        c.opId = gw.opIdOf(op);
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.cancel(c, auth, op);
    }

    // ------------------------------------- griefing / DoS (audit H-1)

    /// A thief holding the Mera key burns owner nonces between the member
    /// signing and submitting. Device cancels and the recovery reset are
    /// signed under their own nonces and still land.
    function test_grief_ownerNonceBurnCannotBlockMember() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = act(id, ConnectGateway.Kind.TransferOwner);
        a.account = thief;
        ConnectGateway.Op memory steal = startOp(a, authOwner(ownerPk, a), "", thiefPk);

        // member pre-signs a device cancel and a recovery reset
        ConnectGateway.Action memory c = cancelAct(id, steal);
        ConnectGateway.Auth memory cancelAuth = authDevice(phonePk, c);
        ConnectGateway.Action memory r = act(id, ConnectGateway.Kind.RecoveryReset);
        r.account = newOwner;
        ConnectGateway.Auth memory resetAuth = authRecovery(recoveryPk, r);
        bytes memory consent = ecdsa(newOwnerPk, digestRecovery(r));

        // thief front-runs with owner-nonce-burning actions
        for (uint256 i; i < 3; i++) {
            ConnectGateway.Action memory x = actAdd(id, 0x5000 + i, MESSAGES);
            ConnectGateway.Op memory xo = startOp(x, authOwner(ownerPk, x), p256Key(0x5000 + i), 0);
            ConnectGateway.Action memory xc = cancelAct(id, xo);
            gw.cancel(xc, authOwner(ownerPk, xc), xo);
        }

        gw.cancel(c, cancelAuth, steal);
        assertFalse(isPending(steal));
        gw.start(r, resetAuth, "", consent);
    }

    function test_grief_fullRecoveryTierDoesNotBlockMember() public {
        uint64 id = registerDefault();
        for (uint256 i; i < 5; i++) {
            ConnectGateway.Action memory r = act(id, ConnectGateway.Kind.RecoveryReset);
            r.account = vm.addr(0x7100 + i);
            startOp(r, authRecovery(recoveryPk, r), "", 0x7100 + i);
        }
        // the member can still change the (compromised) recovery address
        ConnectGateway.Action memory a = act(id, ConnectGateway.Kind.ChangeRecovery);
        a.account = makeAddr("fresh recovery");
        startOp(a, authOD(ownerPk, phonePk, a), "", 0);
    }

    function test_grief_deviceNoncePreservedAcrossReAdd() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = act(id, ConnectGateway.Kind.ChangeRecovery);
        a.account = thief;
        ConnectGateway.Op memory op = startOp(a, authOwner(ownerPk, a), "", 0);
        ConnectGateway.Action memory c = cancelAct(id, op);
        gw.cancel(c, authDevice(phonePk, c), op);
        assertEq(gw.deviceNonceOf(id, p256Hash(phonePk)), 1);

        ConnectGateway.Action memory r = act(id, ConnectGateway.Kind.RecoveryReset);
        r.account = newOwner;
        r.flag = true;
        ConnectGateway.Op memory reset = startOp(r, authRecovery(recoveryPk, r), "", newOwnerPk);
        vm.warp(block.timestamp + delay);
        gw.finalize(reset, "");
        ConnectGateway.Action memory add = actAdd(id, phonePk, ALL);
        ConnectGateway.Op memory addOp = startOp(add, authOwner(newOwnerPk, add), p256Key(phonePk), 0);
        vm.warp(block.timestamp + delay);
        gw.finalize(addOp, p256Key(phonePk));
        assertEq(gw.deviceNonceOf(id, p256Hash(phonePk)), 1, "nonce kept on re-add");
    }

    // ------------------------------- M-2: stolen recovery key vs the member

    /// A thief holding only the recovery key can't stop the member (owner +
    /// device) replacing the recovery address: he can't cancel the change, his
    /// resets are cancelled, and the change wipes any reset still pending.
    function test_m2_stolenRecoveryCannotBlockOwnerDeviceReplacement() public {
        uint64 id = registerDefault();
        uint256 t0 = block.timestamp; // absolute warps (via-ir caches timestamp reads)
        address fresh = makeAddr("fresh recovery");

        // thief opens with a reset to himself
        ConnectGateway.Action memory r = act(id, ConnectGateway.Kind.RecoveryReset);
        r.account = thief;
        ConnectGateway.Op memory reset = startOp(r, authRecovery(recoveryPk, r), "", thiefPk);

        // member replaces the recovery address with owner + phone (7 days)
        ConnectGateway.Action memory a = act(id, ConnectGateway.Kind.ChangeRecovery);
        a.account = fresh;
        ConnectGateway.Op memory change = startOp(a, authOD(ownerPk, phonePk, a), "", 0);

        // the stolen recovery key can't veto its own eviction
        ConnectGateway.Action memory c = cancelAct(id, change);
        ConnectGateway.Auth memory auth = authRecovery(recoveryPk, c);
        vm.expectRevert(ConnectGateway.CannotCancel.selector);
        gw.cancel(c, auth, change);

        // member cancels the thief's resets as they appear (every 3 days)
        c = cancelAct(id, reset);
        gw.cancel(c, authOD(ownerPk, phonePk, c), reset);
        vm.warp(t0 + 3 days);
        r = act(id, ConnectGateway.Kind.RecoveryReset);
        r.account = thief;
        reset = startOp(r, authRecovery(recoveryPk, r), "", thiefPk);
        c = cancelAct(id, reset);
        gw.cancel(c, authOD(ownerPk, phonePk, c), reset);

        // a last reset started a day before the change matures
        vm.warp(t0 + 6 days);
        r = act(id, ConnectGateway.Kind.RecoveryReset);
        r.account = thief;
        ConnectGateway.Op memory late = startOp(r, authRecovery(recoveryPk, r), "", thiefPk);

        vm.warp(t0 + 7 days);
        gw.finalize(change, "");
        assertEq(ids.recoveryOf(id), fresh, "recovery replaced");

        // the late reset was invalidated by the change, and the old key is dead
        vm.warp(t0 + 9 days);
        vm.expectRevert(ConnectGateway.OpStale.selector);
        gw.finalize(late, "");
        assertEq(ids.ownerOf(id), owner);
        r = act(id, ConnectGateway.Kind.RecoveryReset);
        r.account = thief;
        auth = authRecovery(recoveryPk, r);
        bytes memory consent = ecdsa(thiefPk, digestFor(r, ConnectGateway.Signer.Recovery));
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.start(r, auth, "", consent);
    }

    /// Accepted tradeoff of the M-2 fix: a thief holding the Mera key AND a
    /// GUARD device can replace the recovery address and the recovery address
    /// can't stop it. The member's only on-chain defence is another GUARD
    /// device, which can still cancel.
    function test_m2_tradeoff_ownerPlusStolenDeviceReplacesRecovery() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory add = actAdd(id, laptopPk, ALL);
        gw.addKey(add, authOD(ownerPk, phonePk, add), p256Key(laptopPk));

        // thief: Mera key + stolen phone
        ConnectGateway.Action memory a = act(id, ConnectGateway.Kind.ChangeRecovery);
        a.account = thief;
        ConnectGateway.Op memory change = startOp(a, authOD(ownerPk, phonePk, a), "", 0);
        ConnectGateway.Action memory c = cancelAct(id, change);
        ConnectGateway.Auth memory auth = authRecovery(recoveryPk, c);
        vm.expectRevert(ConnectGateway.CannotCancel.selector);
        gw.cancel(c, auth, change);

        // with a second GUARD device the member still wins
        gw.cancel(c, authDevice(laptopPk, c), change);
        assertFalse(isPending(change));

        // without one (laptop retired), recovery's escape is cancelled by the
        // thief and the replacement lands after 7 days
        ConnectGateway.Action memory ret = actKey(id, ConnectGateway.Kind.RetireKey, laptopPk);
        gw.retireKey(ret, devSig(laptopPk, digestDevice(ret, laptopPk)));
        a = act(id, ConnectGateway.Kind.ChangeRecovery);
        a.account = thief;
        change = startOp(a, authOD(ownerPk, phonePk, a), "", 0);
        ConnectGateway.Action memory r = act(id, ConnectGateway.Kind.RecoveryReset);
        r.account = newOwner;
        ConnectGateway.Op memory reset = startOp(r, authRecovery(recoveryPk, r), "", newOwnerPk);
        c = cancelAct(id, reset);
        gw.cancel(c, authOD(ownerPk, phonePk, c), reset);
        vm.warp(block.timestamp + longDelay);
        gw.finalize(change, "");
        assertEq(ids.recoveryOf(id), thief, "accepted residual risk");
    }

    // ----------------------------------------- front-running register

    function test_frontrun_registerCannotAlterIntent() public {
        ConnectGateway.RegisterParams memory p = regParams(owner, recovery, phonePk, ALL);
        bytes memory sig = signRegister(ownerPk, p);
        ConnectGateway.RegisterParams memory evil = regParams(owner, thief, phonePk, ALL);
        vm.prank(thief);
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.register(evil, sig);
        evil = regParams(owner, recovery, laptopPk, ALL);
        vm.prank(thief);
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.register(evil, sig);
        // submitting the member's own message first only does what the member asked
        vm.prank(thief);
        uint64 id = gw.register(p, sig);
        assertEq(ids.ownerOf(id), owner);
        assertEq(ids.recoveryOf(id), recovery);
        assertTrue(keys.canSign(id, p256Hash(phonePk), ALL));
    }

    // --------------------------------------------------- pause abuse

    /// Over any window the guardian can keep registration paused at most half the time.
    function testFuzz_pause_dutyCycleCapped(uint64 first, uint256 gap) public {
        first = uint64(bound(first, 1, 14 days));
        gap = bound(gap, 0, 40 days);
        vm.startPrank(guardian);
        gw.pause(first);
        vm.warp(block.timestamp + first + gap);
        if (gap < 14 days) {
            vm.expectRevert(ConnectGateway.BadPause.selector);
            gw.pause(1);
        } else {
            gw.pause(14 days);
        }
        vm.stopPrank();
    }

    function test_pause_guardianHasNoOtherPower() public {
        uint64 id = registerDefault();
        vm.startPrank(guardian);
        ConnectGateway.Action memory a = actKey(id, ConnectGateway.Kind.SuspendKey, phonePk);
        ConnectGateway.Auth memory auth = ConnectGateway.Auth(ConnectGateway.Signer.Owner, "", noDevice());
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.suspendKey(a, auth);
        vm.expectRevert(ConnectIdRegistry.NotGateway.selector);
        ids.setOwner(id, guardian);
        vm.stopPrank();
    }
}

library AttackLib {
    function withFreshDeadline(ConnectGateway.Action memory a, uint256 nowTs)
        internal
        pure
        returns (ConnectGateway.Action memory b)
    {
        b = a;
        b.deadline = nowTs + 2 hours;
    }
}

using AttackLib for ConnectGateway.Action;
