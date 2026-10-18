// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {ConnectGateway} from "../src/ConnectGateway.sol";
import {ConnectKeyRegistry} from "../src/ConnectKeyRegistry.sol";

contract ConnectGatewayFuzzTest is Base {
    uint256 internal constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    function _kind(uint8 sel) internal pure returns (ConnectGateway.Kind) {
        ConnectGateway.Kind[5] memory k = [
            ConnectGateway.Kind.TransferOwner,
            ConnectGateway.Kind.ChangeRecovery,
            ConnectGateway.Kind.AddKey,
            ConnectGateway.Kind.RemoveKey,
            ConnectGateway.Kind.RecoveryReset
        ];
        return k[sel % 5];
    }

    /// @dev Starts one delayed op of the chosen kind with a valid signer.
    function _start(uint64 id, ConnectGateway.Kind kind) internal returns (ConnectGateway.Op memory op, bytes memory key) {
        ConnectGateway.Action memory a;
        if (kind == ConnectGateway.Kind.TransferOwner) {
            a = act(id, kind);
            a.account = newOwner;
            op = startOp(a, authOwner(ownerPk, a), "", newOwnerPk);
        } else if (kind == ConnectGateway.Kind.ChangeRecovery) {
            a = act(id, kind);
            a.account = makeAddr("r2");
            op = startOp(a, authOD(ownerPk, phonePk, a), "", 0);
        } else if (kind == ConnectGateway.Kind.AddKey) {
            a = actAdd(id, laptopPk, ALL);
            key = p256Key(laptopPk);
            op = startOp(a, authOwner(ownerPk, a), key, 0);
        } else if (kind == ConnectGateway.Kind.RemoveKey) {
            a = actKey(id, kind, phonePk);
            op = startOp(a, authOwner(ownerPk, a), "", 0);
        } else {
            a = act(id, kind);
            a.account = newOwner;
            op = startOp(a, authRecovery(recoveryPk, a), "", newOwnerPk);
        }
    }

    /// No op of any kind finalizes before its delay (3 or 7 days).
    function testFuzz_noFinalizeBeforeDelay(uint8 sel, uint256 dt) public {
        uint64 id = registerDefault();
        ConnectGateway.Kind kind = _kind(sel);
        uint256 d = gw.delayOf(kind);
        dt = bound(dt, 0, d - 1);
        (ConnectGateway.Op memory op, bytes memory key) = _start(id, kind);
        vm.warp(block.timestamp + dt);
        vm.expectRevert(ConnectGateway.NotReady.selector);
        gw.finalize(op, key);
        vm.warp(block.timestamp + (d - dt));
        gw.finalize(op, key);
    }

    /// The cancel matrix matches the spec table, checked independently.
    function testFuzz_cancelMatrix(uint8 tierSel, uint8 bySel, bool deviceIsTarget, uint8 kindSel) public view {
        ConnectGateway.Signer tier = ConnectGateway.Signer(tierSel % 5);
        ConnectGateway.Signer by = ConnectGateway.Signer(bySel % 5);
        ConnectGateway.Op memory op;
        op.tier = tier;
        op.kind = ConnectGateway.Kind(1 + kindSel % 6); // the 6 delayed kinds
        bool removal = op.kind == ConnectGateway.Kind.RemoveKey;
        op.keyHash = keccak256("target");
        bool usesDevice = by == ConnectGateway.Signer.Device || by == ConnectGateway.Signer.OwnerDevice;
        bytes32 deviceHash = usesDevice ? (deviceIsTarget ? op.keyHash : keccak256("other")) : bytes32(0);

        bool expected;
        if (tier == ConnectGateway.Signer.Owner) {
            expected = by != ConnectGateway.Signer.None;
        } else if (tier == ConnectGateway.Signer.OwnerDevice) {
            expected = by == ConnectGateway.Signer.Device || by == ConnectGateway.Signer.OwnerDevice
                || (by == ConnectGateway.Signer.Recovery && op.kind != ConnectGateway.Kind.ChangeRecovery);
        } else if (tier == ConnectGateway.Signer.Recovery) {
            expected = by == ConnectGateway.Signer.OwnerDevice;
        }
        if (removal && usesDevice && deviceIsTarget && tier != ConnectGateway.Signer.Owner) expected = false;
        // The owner alone can never cancel what the member did with a device or recovery.
        if (by == ConnectGateway.Signer.Owner && tier != ConnectGateway.Signer.Owner) assertFalse(expected);
        // The recovery address can never veto the member replacing it with owner + device.
        if (
            by == ConnectGateway.Signer.Recovery && tier == ConnectGateway.Signer.OwnerDevice
                && op.kind == ConnectGateway.Kind.ChangeRecovery
        ) assertFalse(expected);
        assertEq(gw.canCancel(op, by, deviceHash), expected);
    }

    /// Any key other than the owner's is rejected for registration.
    function testFuzz_registerRejectsOtherSigners(uint256 pk) public {
        pk = bound(pk, 1, SECP256K1_N - 1);
        vm.assume(pk != ownerPk);
        ConnectGateway.RegisterParams memory p = regParams(owner, recovery, phonePk, ALL);
        bytes memory sig = signRegister(pk, p);
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.register(p, sig);
    }

    /// Scope must be a non-zero subset of the 6 defined bits; expiry within 2 years.
    function testFuzz_keyParams(uint8 scope, uint40 life) public {
        life = uint40(bound(life, 0, 3 * 730 days));
        ConnectGateway.RegisterParams memory p = regParams(owner, recovery, phonePk, scope);
        p.expiresAt = uint40(block.timestamp) + life;
        bytes memory sig = signRegister(ownerPk, p);
        bool scopeOk = scope != 0 && scope & ~uint8(63) == 0;
        bool expOk = life > 0 && life <= 730 days;
        if (scope & GUARD == 0) vm.expectRevert(ConnectGateway.FirstKeyNotGuard.selector);
        else if (!scopeOk) vm.expectRevert(ConnectKeyRegistry.BadScope.selector);
        else if (!expOk) vm.expectRevert(ConnectKeyRegistry.BadExpiry.selector);
        gw.register(p, sig);
    }

    /// Random P-256 device keys co-sign correctly (precompile path, low-s).
    function testFuzz_p256DeviceKeys(uint256 devPk, uint256 newPk) public {
        devPk = bound(devPk, 1, P256_N - 1);
        newPk = bound(newPk, 1, P256_N - 1);
        vm.assume(devPk != newPk);
        ConnectGateway.RegisterParams memory p = regParams(owner, recovery, devPk, ALL);
        uint64 id = gw.register(p, signRegister(ownerPk, p));
        ConnectGateway.Action memory a = actAdd(id, newPk, MESSAGES);
        gw.addKey(a, authOD(ownerPk, devPk, a), p256Key(newPk));
        assertTrue(keys.canSign(id, p256Hash(newPk), MESSAGES));
        assertFalse(keys.hasGuardPower(id, p256Hash(newPk)));
    }

    /// A device key alone can never start a change, whatever the kind.
    function testFuzz_deviceCannotStart(uint8 kindSel) public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actAdd(id, laptopPk, ALL);
        a.kind = ConnectGateway.Kind(kindSel % 10);
        a.account = newOwner;
        ConnectGateway.Auth memory auth = authDevice(phonePk, a);
        vm.expectRevert(ConnectGateway.BadSigner.selector);
        gw.start(a, auth, p256Key(laptopPk), "");
    }

    /// Pause length is capped at 14 days and then lapses on its own.
    function testFuzz_pauseCap(uint64 duration) public {
        vm.startPrank(guardian);
        if (duration == 0 || duration > 14 days) {
            vm.expectRevert(ConnectGateway.BadPause.selector);
            gw.pause(duration);
            return;
        }
        gw.pause(duration);
        vm.stopPrank();
        assertTrue(gw.paused());
        vm.warp(block.timestamp + duration);
        assertFalse(gw.paused());
    }
}
