// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import {Base, MockWallet} from "./Base.t.sol";
import {ConnectGateway} from "../src/ConnectGateway.sol";
import {ConnectIdRegistry} from "../src/ConnectIdRegistry.sol";
import {ConnectKeyRegistry} from "../src/ConnectKeyRegistry.sol";

contract ConnectGatewayTest is Base {
    using ConnectGatewayTestLib for ConnectGateway.Action;

    ConnectGateway.Kind constant TRANSFER = ConnectGateway.Kind.TransferOwner;
    ConnectGateway.Kind constant CHANGE_RECOVERY = ConnectGateway.Kind.ChangeRecovery;
    ConnectGateway.Kind constant ADD = ConnectGateway.Kind.AddKey;
    ConnectGateway.Kind constant REMOVE = ConnectGateway.Kind.RemoveKey;
    ConnectGateway.Kind constant UNSUSPEND = ConnectGateway.Kind.UnsuspendKey;
    ConnectGateway.Kind constant RESET = ConnectGateway.Kind.RecoveryReset;
    ConnectGateway.Kind constant SUSPEND = ConnectGateway.Kind.SuspendKey;
    ConnectGateway.Kind constant RETIRE = ConnectGateway.Kind.RetireKey;

    // ============================================================ register

    function test_register() public {
        uint64 id = registerDefault();
        assertEq(id, 1);
        assertEq(ids.idOf(owner), 1);
        assertEq(ids.ownerOf(1), owner);
        assertEq(ids.recoveryOf(1), recovery);
        assertTrue(keys.canSign(1, p256Hash(phonePk), ALL));
        assertTrue(keys.hasGuardPower(1, p256Hash(phonePk)));
        (uint32 epoch, uint8 live) = keys.idKeys(1);
        assertEq(epoch, 0);
        assertEq(live, 1);
    }

    function test_register_relayerSubmits() public {
        ConnectGateway.RegisterParams memory p = regParams(owner, recovery, phonePk, ALL);
        bytes memory sig = signRegister(ownerPk, p);
        vm.prank(makeAddr("relayer"));
        assertEq(gw.register(p, sig), 1);
    }

    function test_register_revertsOnWrongSigner() public {
        ConnectGateway.RegisterParams memory p = regParams(owner, recovery, phonePk, ALL);
        bytes memory sig = signRegister(thiefPk, p);
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.register(p, sig);
    }

    function test_register_revertsOnReplay() public {
        ConnectGateway.RegisterParams memory p = regParams(owner, recovery, phonePk, ALL);
        bytes memory sig = signRegister(ownerPk, p);
        gw.register(p, sig);
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.register(p, sig);
    }

    function test_register_revertsAfterDeadline() public {
        ConnectGateway.RegisterParams memory p = regParams(owner, recovery, phonePk, ALL);
        bytes memory sig = signRegister(ownerPk, p);
        vm.warp(p.deadline + 1);
        vm.expectRevert(ConnectGateway.Expired.selector);
        gw.register(p, sig);
    }

    function test_register_oneIdPerOwner() public {
        registerDefault();
        ConnectGateway.RegisterParams memory p = regParams(owner, recovery, laptopPk, ALL);
        bytes memory sig = signRegister(ownerPk, p);
        vm.expectRevert(ConnectIdRegistry.AlreadyHasId.selector);
        gw.register(p, sig);
    }

    function test_register_recoveryMustDiffer() public {
        ConnectGateway.RegisterParams memory p = regParams(owner, owner, phonePk, ALL);
        bytes memory sig = signRegister(ownerPk, p);
        vm.expectRevert(ConnectIdRegistry.RecoveryIsOwner.selector);
        gw.register(p, sig);
    }

    function test_register_noRecoveryAllowed() public {
        ConnectGateway.RegisterParams memory p = regParams(owner, address(0), phonePk, ALL);
        gw.register(p, signRegister(ownerPk, p));
        assertEq(ids.recoveryOf(1), address(0));
    }

    function test_register_badKeyInputs() public {
        ConnectGateway.RegisterParams memory p = regParams(owner, recovery, phonePk, ALL);
        p.key = hex"1234";
        bytes memory sig = signRegister(ownerPk, p);
        vm.expectRevert(ConnectKeyRegistry.BadKey.selector);
        gw.register(p, sig);

        p = regParams(owner, recovery, phonePk, 64);
        sig = signRegister(ownerPk, p);
        vm.expectRevert(ConnectKeyRegistry.BadScope.selector);
        gw.register(p, sig);

        p = regParams(owner, recovery, phonePk, ALL);
        p.expiresAt = uint40(block.timestamp + 731 days);
        sig = signRegister(ownerPk, p);
        vm.expectRevert(ConnectKeyRegistry.BadExpiry.selector);
        gw.register(p, sig);
    }

    function test_register_secp256k1DeviceKey() public {
        ConnectGateway.RegisterParams memory p = regParams(owner, recovery, phonePk, ALL);
        p.keyType = K1;
        p.key = k1Key(phonePk);
        gw.register(p, signRegister(ownerPk, p));
        assertTrue(keys.canSign(1, keys.keyHashOf(K1, k1Key(phonePk)), ALL));
    }

    function test_register_erc1271Owner() public {
        MockWallet wallet = new MockWallet(owner);
        ConnectGateway.RegisterParams memory p = regParams(address(wallet), recovery, phonePk, ALL);
        gw.register(p, signRegister(ownerPk, p));
        assertEq(ids.idOf(address(wallet)), 1);
    }

    /// @dev A Mera wallet delegated via EIP-7702 has code; its EOA key must still work.
    function test_register_7702DelegatedEoa() public {
        vm.etch(owner, abi.encodePacked(hex"ef0100", address(0xdead)));
        ConnectGateway.RegisterParams memory p = regParams(owner, recovery, phonePk, ALL);
        gw.register(p, signRegister(ownerPk, p));
        assertEq(ids.idOf(owner), 1);
    }

    function test_register_blockedWhilePaused() public {
        vm.prank(guardian);
        gw.pause(1 days);
        ConnectGateway.RegisterParams memory p = regParams(owner, recovery, phonePk, ALL);
        bytes memory sig = signRegister(ownerPk, p);
        vm.expectRevert(ConnectGateway.IsPaused.selector);
        gw.register(p, sig);
    }

    // ========================================================= instant add

    function test_addKey_ownerPlusDeviceIsInstant() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actAdd(id, laptopPk, ALL);
        gw.addKey(a, authOD(ownerPk, phonePk, a), p256Key(laptopPk));
        assertTrue(keys.canSign(id, p256Hash(laptopPk), ALL));
        assertEq(gw.nonceOf(id), 1);
    }

    function test_addKey_ownerAloneCannotAddInstantly() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actAdd(id, laptopPk, ALL);
        ConnectGateway.Auth memory auth = authOwner(ownerPk, a);
        vm.expectRevert(ConnectGateway.BadSigner.selector);
        gw.addKey(a, auth, p256Key(laptopPk));
    }

    function test_addKey_nonGuardDeviceCannotCosign() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actAdd(id, miniAppPk, MESSAGES);
        gw.addKey(a, authOD(ownerPk, phonePk, a), p256Key(miniAppPk));
        a = actAdd(id, laptopPk, ALL);
        ConnectGateway.Auth memory auth = authOD(ownerPk, miniAppPk, a);
        vm.expectRevert(ConnectGateway.NotGuard.selector);
        gw.addKey(a, auth, p256Key(laptopPk));
    }

    function test_addKey_unregisteredDeviceCannotCosign() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actAdd(id, laptopPk, ALL);
        ConnectGateway.Auth memory auth = authOD(ownerPk, laptopPk, a);
        vm.expectRevert(ConnectGateway.NotGuard.selector);
        gw.addKey(a, auth, p256Key(laptopPk));
    }

    function test_addKey_badDeviceSignature() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actAdd(id, laptopPk, ALL);
        ConnectGateway.Auth memory auth = authOD(ownerPk, phonePk, a);
        auth.device.sig = p256Sig(laptopPk, digestOf(a));
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.addKey(a, auth, p256Key(laptopPk));
    }

    function test_addKey_keyBytesMustMatchHash() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actAdd(id, laptopPk, ALL);
        ConnectGateway.Auth memory auth = authOD(ownerPk, phonePk, a);
        vm.expectRevert(ConnectGateway.KeyMismatch.selector);
        gw.addKey(a, auth, p256Key(miniAppPk));
    }

    function test_addKey_maxLiveKeys() public {
        uint64 id = registerDefault();
        for (uint256 i = 1; i < 20; i++) {
            ConnectGateway.Action memory a = actAdd(id, 0x1000 + i, MESSAGES);
            gw.addKey(a, authOD(ownerPk, phonePk, a), p256Key(0x1000 + i));
        }
        ConnectGateway.Action memory b = actAdd(id, 0x2000, MESSAGES);
        ConnectGateway.Auth memory auth = authOD(ownerPk, phonePk, b);
        vm.expectRevert(ConnectKeyRegistry.TooManyKeys.selector);
        gw.addKey(b, auth, p256Key(0x2000));
    }

    function test_addKey_secp256k1DeviceCosigns() public {
        ConnectGateway.RegisterParams memory p = regParams(owner, recovery, phonePk, ALL);
        p.keyType = K1;
        p.key = k1Key(phonePk);
        uint64 id = gw.register(p, signRegister(ownerPk, p));
        ConnectGateway.Action memory a = actAdd(id, laptopPk, ALL);
        bytes32 d = digestOf(a);
        ConnectGateway.Auth memory auth = ConnectGateway.Auth(
            ConnectGateway.Signer.OwnerDevice,
            ecdsa(ownerPk, d),
            ConnectGateway.DeviceSig(K1, k1Key(phonePk), ecdsa(phonePk, d))
        );
        gw.addKey(a, auth, p256Key(laptopPk));
        assertTrue(keys.canSign(id, p256Hash(laptopPk), ALL));
    }

    function test_addKey_signatureNotReplayable() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actAdd(id, laptopPk, ALL);
        ConnectGateway.Auth memory auth = authOD(ownerPk, phonePk, a);
        gw.addKey(a, auth, p256Key(laptopPk));
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.addKey(a, auth, p256Key(laptopPk));
    }

    // ===================================================== suspend, retire

    function test_suspend_ownerAloneInstant_guardPowerSurvives() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actKey(id, SUSPEND, phonePk);
        gw.suspendKey(a, authOwner(ownerPk, a));
        assertFalse(keys.canSign(id, p256Hash(phonePk), 1));
        assertTrue(keys.hasGuardPower(id, p256Hash(phonePk)));
    }

    function test_suspend_deviceAloneCannot() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actKey(id, SUSPEND, phonePk);
        ConnectGateway.Auth memory auth = authDevice(phonePk, a);
        vm.expectRevert(ConnectGateway.BadSigner.selector);
        gw.suspendKey(a, auth);
    }

    function test_retire_deviceSelf() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actKey(id, RETIRE, phonePk);
        gw.retireKey(a, devSig(phonePk, digestOf(a)));
        assertEq(uint8(keys.stateOf(id, p256Hash(phonePk))), uint8(ConnectKeyRegistry.State.Retired));
        assertFalse(keys.hasGuardPower(id, p256Hash(phonePk)));
        (, uint8 live) = keys.idKeys(id);
        assertEq(live, 0);
    }

    function test_retire_cannotRetireAnotherKey() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actKey(id, RETIRE, phonePk);
        ConnectGateway.DeviceSig memory d = devSig(laptopPk, digestOf(a));
        vm.expectRevert(ConnectGateway.KeyMismatch.selector);
        gw.retireKey(a, d);
    }

    function test_retire_retiredKeyCannotBeReadded() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actKey(id, RETIRE, phonePk);
        gw.retireKey(a, devSig(phonePk, digestOf(a)));
        a = actAdd(id, phonePk, ALL);
        ConnectGateway.Auth memory auth = authOwner(ownerPk, a);
        bytes memory key = p256Key(phonePk);
        vm.expectRevert(ConnectKeyRegistry.KeyExists.selector);
        gw.start(a, auth, key, "");
    }

    // ========================================================= delayed ops

    function test_delayedAdd_ownerAlone() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actAdd(id, laptopPk, ALL);
        ConnectGateway.Op memory op = startOp(a, authOwner(ownerPk, a), p256Key(laptopPk), 0);
        assertFalse(keys.canSign(id, p256Hash(laptopPk), 1));

        vm.warp(block.timestamp + delay - 1);
        vm.expectRevert(ConnectGateway.NotReady.selector);
        gw.finalize(op, p256Key(laptopPk));

        vm.warp(block.timestamp + 1);
        vm.expectRevert(ConnectGateway.KeyMismatch.selector);
        gw.finalize(op, p256Key(miniAppPk));
        vm.prank(makeAddr("anyone"));
        gw.finalize(op, p256Key(laptopPk));
        assertTrue(keys.canSign(id, p256Hash(laptopPk), ALL));
        assertFalse(isPending(op));
    }

    function test_delayedAdd_blockedWhilePaused_finalizeNot() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actAdd(id, laptopPk, ALL);
        ConnectGateway.Op memory op = startOp(a, authOwner(ownerPk, a), p256Key(laptopPk), 0);
        vm.prank(guardian);
        gw.pause(14 days);
        ConnectGateway.Action memory b = actAdd(id, miniAppPk, MESSAGES);
        ConnectGateway.Auth memory auth = authOwner(ownerPk, b);
        vm.expectRevert(ConnectGateway.IsPaused.selector);
        gw.start(b, auth, p256Key(miniAppPk), "");
        vm.warp(block.timestamp + delay);
        gw.finalize(op, p256Key(laptopPk));
        assertTrue(keys.canSign(id, p256Hash(laptopPk), ALL));
    }

    function test_delayedAdd_ownerPlusDeviceMustUseInstantPath() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actAdd(id, laptopPk, ALL);
        ConnectGateway.Auth memory auth = authOD(ownerPk, phonePk, a);
        vm.expectRevert(ConnectGateway.BadSigner.selector);
        gw.start(a, auth, p256Key(laptopPk), "");
    }

    function test_transfer_needsConsentAndInvalidatesPending() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory add = actAdd(id, laptopPk, ALL);
        ConnectGateway.Op memory addOp = startOp(add, authOwner(ownerPk, add), p256Key(laptopPk), 0);

        ConnectGateway.Action memory a = act(id, TRANSFER).withAccount(newOwner);
        ConnectGateway.Auth memory auth = authOwner(ownerPk, a);
        bytes memory wrongConsent = ecdsa(thiefPk, digestOf(a));
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.start(a, auth, "", wrongConsent);

        ConnectGateway.Op memory op = startOp(a, authOwner(ownerPk, a), "", newOwnerPk);
        // transfer waits 7 days, not 3
        vm.warp(block.timestamp + delay);
        vm.expectRevert(ConnectGateway.NotReady.selector);
        gw.finalize(op, "");
        vm.warp(block.timestamp + longDelay - delay);
        gw.finalize(op, "");
        assertEq(ids.ownerOf(id), newOwner);
        assertEq(ids.idOf(owner), 0);
        assertEq(ids.idOf(newOwner), id);
        // devices survive a voluntary transfer
        assertTrue(keys.canSign(id, p256Hash(phonePk), ALL));

        vm.expectRevert(ConnectGateway.OpStale.selector);
        gw.finalize(addOp, p256Key(laptopPk));
        gw.prune(addOp);
        assertFalse(isPending(addOp));
    }

    function test_transfer_targetMustBeFree() public {
        uint64 id = registerDefault();
        ConnectGateway.RegisterParams memory p = regParams(newOwner, address(0), laptopPk, ALL);
        gw.register(p, signRegister(newOwnerPk, p));
        ConnectGateway.Action memory a = act(id, TRANSFER).withAccount(newOwner);
        ConnectGateway.Auth memory auth = authOwner(ownerPk, a);
        bytes memory consent = ecdsa(newOwnerPk, digestOf(a));
        vm.expectRevert(ConnectGateway.BadAccount.selector);
        gw.start(a, auth, "", consent);
    }

    function test_changeRecovery() public {
        uint64 id = registerDefault();
        address r2 = makeAddr("r2");
        ConnectGateway.Action memory a = act(id, CHANGE_RECOVERY).withAccount(r2);
        ConnectGateway.Op memory op = startOp(a, authOD(ownerPk, phonePk, a), "", 0);
        vm.warp(block.timestamp + longDelay - 1);
        vm.expectRevert(ConnectGateway.NotReady.selector);
        gw.finalize(op, "");
        vm.warp(block.timestamp + 1);
        gw.finalize(op, "");
        assertEq(ids.recoveryOf(id), r2);
    }

    function test_changeRecovery_cannotBeOwner() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = act(id, CHANGE_RECOVERY).withAccount(owner);
        ConnectGateway.Auth memory auth = authOwner(ownerPk, a);
        vm.expectRevert(ConnectGateway.BadAccount.selector);
        gw.start(a, auth, "", "");
    }

    function test_removeAndUnsuspend() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actAdd(id, laptopPk, ALL);
        gw.addKey(a, authOD(ownerPk, phonePk, a), p256Key(laptopPk));

        a = actKey(id, SUSPEND, laptopPk);
        gw.suspendKey(a, authOwner(ownerPk, a));
        a = actKey(id, UNSUSPEND, laptopPk);
        ConnectGateway.Op memory unsus = startOp(a, authOwner(ownerPk, a), "", 0);
        a = actKey(id, REMOVE, phonePk);
        ConnectGateway.Op memory rem = startOp(a, authOD(ownerPk, laptopPk, a), "", 0);

        vm.warp(block.timestamp + delay);
        gw.finalize(unsus, "");
        gw.finalize(rem, "");
        assertTrue(keys.canSign(id, p256Hash(laptopPk), ALL));
        assertEq(uint8(keys.stateOf(id, p256Hash(phonePk))), uint8(ConnectKeyRegistry.State.Removed));
        (, uint8 live) = keys.idKeys(id);
        assertEq(live, 1);
    }

    function test_unsuspend_requiresSuspended() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actKey(id, UNSUSPEND, phonePk);
        ConnectGateway.Auth memory auth = authOwner(ownerPk, a);
        vm.expectRevert(ConnectGateway.WrongKeyState.selector);
        gw.start(a, auth, "", "");
    }

    function test_recoveryReset_withKeyReset() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = act(id, RESET).withAccount(newOwner);
        a.flag = true;
        ConnectGateway.Op memory op = startOp(a, authRecovery(recoveryPk, a), "", newOwnerPk);
        vm.warp(block.timestamp + delay);
        gw.finalize(op, "");
        assertEq(ids.ownerOf(id), newOwner);
        assertFalse(keys.canSign(id, p256Hash(phonePk), 1));
        assertFalse(keys.hasGuardPower(id, p256Hash(phonePk)));
        (uint32 epoch, uint8 live) = keys.idKeys(id);
        assertEq(epoch, 1);
        assertEq(live, 0);
        // a stale (not retired/removed) key may be re-added after the reset
        a = actAdd(id, phonePk, ALL);
        op = startOp(a, authOwner(newOwnerPk, a), p256Key(phonePk), 0);
        vm.warp(block.timestamp + delay);
        gw.finalize(op, p256Key(phonePk));
        assertTrue(keys.canSign(id, p256Hash(phonePk), ALL));
    }

    function test_recoveryReset_onlyRecoveryCanStart() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = act(id, RESET).withAccount(newOwner);
        ConnectGateway.Auth memory auth = authOD(ownerPk, phonePk, a);
        bytes memory consent = ecdsa(newOwnerPk, digestOf(a));
        vm.expectRevert(ConnectGateway.BadSigner.selector);
        gw.start(a, auth, "", consent);
    }

    function test_recovery_cannotStartOtherKinds() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = act(id, CHANGE_RECOVERY).withAccount(makeAddr("x"));
        ConnectGateway.Auth memory auth = authRecovery(recoveryPk, a);
        vm.expectRevert(ConnectGateway.BadSigner.selector);
        gw.start(a, auth, "", "");
    }

    function test_device_cannotStartAnything() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = act(id, CHANGE_RECOVERY).withAccount(makeAddr("x"));
        ConnectGateway.Auth memory auth = authDevice(phonePk, a);
        vm.expectRevert(ConnectGateway.BadSigner.selector);
        gw.start(a, auth, "", "");
    }

    function test_startRejectsInstantKinds() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actKey(id, SUSPEND, phonePk);
        ConnectGateway.Auth memory auth = authOwner(ownerPk, a);
        vm.expectRevert(ConnectGateway.BadKind.selector);
        gw.start(a, auth, "", "");
    }

    function test_finalizeWindowAndPrune() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actAdd(id, laptopPk, ALL);
        ConnectGateway.Op memory op = startOp(a, authOwner(ownerPk, a), p256Key(laptopPk), 0);
        vm.expectRevert(ConnectGateway.NotReady.selector);
        gw.prune(op);
        vm.warp(block.timestamp + delay + 30 days);
        vm.expectRevert(ConnectGateway.OpExpired.selector);
        gw.finalize(op, p256Key(laptopPk));
        gw.prune(op);
        (,, uint8 pOwner,,) = gw.idState(id);
        assertEq(pOwner, 0);
    }

    function test_pendingCapIsPerTier() public {
        uint64 id = registerDefault();
        for (uint256 i; i < 5; i++) {
            ConnectGateway.Action memory a = actAdd(id, 0x3000 + i, MESSAGES);
            startOp(a, authOwner(ownerPk, a), p256Key(0x3000 + i), 0);
        }
        ConnectGateway.Action memory b = actAdd(id, 0x4000, MESSAGES);
        ConnectGateway.Auth memory auth = authOwner(ownerPk, b);
        vm.expectRevert(ConnectGateway.TooManyPending.selector);
        gw.start(b, auth, p256Key(0x4000), "");
        // a full owner tier never blocks the recovery address
        ConnectGateway.Action memory r = act(id, RESET).withAccount(newOwner);
        startOp(r, authRecovery(recoveryPk, r), "", newOwnerPk);
    }

    // ======================================================== cancel matrix

    function _ownerOp(uint64 id) internal returns (ConnectGateway.Op memory) {
        ConnectGateway.Action memory a = act(id, CHANGE_RECOVERY).withAccount(thief);
        return startOp(a, authOwner(ownerPk, a), "", 0);
    }

    function _odOp(uint64 id) internal returns (ConnectGateway.Op memory) {
        ConnectGateway.Action memory a = act(id, CHANGE_RECOVERY).withAccount(makeAddr("r2"));
        return startOp(a, authOD(ownerPk, phonePk, a), "", 0);
    }

    function _resetOp(uint64 id) internal returns (ConnectGateway.Op memory) {
        ConnectGateway.Action memory a = act(id, RESET).withAccount(newOwner);
        return startOp(a, authRecovery(recoveryPk, a), "", newOwnerPk);
    }

    function _setupWithLaptop() internal returns (uint64 id) {
        id = registerDefault();
        ConnectGateway.Action memory a = actAdd(id, laptopPk, ALL);
        gw.addKey(a, authOD(ownerPk, phonePk, a), p256Key(laptopPk));
    }

    function test_cancel_ownerOp_byEachParty() public {
        uint64 id = _setupWithLaptop();
        ConnectGateway.Op memory op = _ownerOp(id);
        ConnectGateway.Action memory c = cancelAct(id, op);
        gw.cancel(c, authOwner(ownerPk, c), op);
        assertFalse(isPending(op));

        op = _ownerOp(id);
        c = cancelAct(id, op);
        gw.cancel(c, authRecovery(recoveryPk, c), op);
        assertFalse(isPending(op));

        op = _ownerOp(id);
        c = cancelAct(id, op);
        gw.cancel(c, authDevice(laptopPk, c), op);
        assertFalse(isPending(op));

        op = _ownerOp(id);
        c = cancelAct(id, op);
        gw.cancel(c, authOD(ownerPk, phonePk, c), op);
        assertFalse(isPending(op));
        (,, uint8 pOwner,,) = gw.idState(id);
        assertEq(pOwner, 0);
    }

    function test_cancel_ownerDeviceOp_notByOwnerAlone() public {
        uint64 id = _setupWithLaptop();
        ConnectGateway.Op memory op = _odOp(id);
        ConnectGateway.Action memory c = cancelAct(id, op);
        ConnectGateway.Auth memory auth = authOwner(ownerPk, c);
        vm.expectRevert(ConnectGateway.CannotCancel.selector);
        gw.cancel(c, auth, op);

        gw.cancel(c, authRecovery(recoveryPk, c), op);
        assertFalse(isPending(op));
        op = _odOp(id);
        c = cancelAct(id, op);
        gw.cancel(c, authDevice(laptopPk, c), op);
        op = _odOp(id);
        c = cancelAct(id, op);
        gw.cancel(c, authOD(ownerPk, laptopPk, c), op);
        assertFalse(isPending(op));
    }

    function test_cancel_recoveryReset_onlyOwnerPlusDevice() public {
        uint64 id = _setupWithLaptop();
        ConnectGateway.Op memory op = _resetOp(id);
        ConnectGateway.Action memory c = cancelAct(id, op);

        ConnectGateway.Auth memory auth = authOwner(ownerPk, c);
        vm.expectRevert(ConnectGateway.CannotCancel.selector);
        gw.cancel(c, auth, op);
        auth = authDevice(phonePk, c);
        vm.expectRevert(ConnectGateway.CannotCancel.selector);
        gw.cancel(c, auth, op);
        auth = authRecovery(recoveryPk, c);
        vm.expectRevert(ConnectGateway.CannotCancel.selector);
        gw.cancel(c, auth, op);

        gw.cancel(c, authOD(ownerPk, phonePk, c), op);
        assertFalse(isPending(op));
    }

    function test_cancel_deviceCannotCancelOwnRemoval() public {
        uint64 id = _setupWithLaptop();
        ConnectGateway.Action memory a = actKey(id, REMOVE, laptopPk);
        ConnectGateway.Op memory op = startOp(a, authOwner(ownerPk, a), "", 0);
        ConnectGateway.Action memory c = cancelAct(id, op);
        ConnectGateway.Auth memory auth = authDevice(laptopPk, c);
        vm.expectRevert(ConnectGateway.CannotCancel.selector);
        gw.cancel(c, auth, op);
        gw.cancel(c, authDevice(phonePk, c), op);
        assertFalse(isPending(op));
    }

    function test_cancel_suspendedGuardStillCancels() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory s = actKey(id, SUSPEND, phonePk);
        gw.suspendKey(s, authOwner(ownerPk, s));
        ConnectGateway.Op memory op = _ownerOp(id);
        ConnectGateway.Action memory c = cancelAct(id, op);
        gw.cancel(c, authDevice(phonePk, c), op);
        assertFalse(isPending(op));
    }

    function test_cancel_nonGuardAndExpiredKeysCannot() public {
        uint64 id = registerDefault();
        ConnectGateway.Action memory a = actAdd(id, miniAppPk, MESSAGES);
        gw.addKey(a, authOD(ownerPk, phonePk, a), p256Key(miniAppPk));
        ConnectGateway.Op memory op = _ownerOp(id);
        ConnectGateway.Action memory c = cancelAct(id, op);
        ConnectGateway.Auth memory auth = authDevice(miniAppPk, c);
        vm.expectRevert(ConnectGateway.NotGuard.selector);
        gw.cancel(c, auth, op);

        vm.warp(block.timestamp + 366 days); // phone key expired
        c = cancelAct(id, op);
        auth = authDevice(phonePk, c);
        vm.expectRevert(ConnectGateway.NotGuard.selector);
        gw.cancel(c, auth, op);
    }

    function test_cancel_opMustMatch() public {
        uint64 id = registerDefault();
        ConnectGateway.Op memory op = _ownerOp(id);
        ConnectGateway.Action memory c = cancelAct(id, op);
        op.account = owner;
        ConnectGateway.Auth memory auth = authOwner(ownerPk, c);
        vm.expectRevert(ConnectGateway.OpMismatch.selector);
        gw.cancel(c, auth, op);
    }

    // ============================================== stolen-owner scenario

    /// @dev The thief has the Mera key (ownerPk). The member has the phone
    ///      (GUARD) and the recovery address. Recovery must win.
    function test_stolenOwner_recoveryWins() public {
        uint64 id = _setupWithLaptop();
        // thief suspends every device instantly...
        ConnectGateway.Action memory a = actKey(id, SUSPEND, phonePk);
        gw.suspendKey(a, authOwner(ownerPk, a));
        a = actKey(id, SUSPEND, laptopPk);
        gw.suspendKey(a, authOwner(ownerPk, a));
        // ...and starts moving the ID and the recovery address to himself
        a = act(id, TRANSFER).withAccount(thief);
        ConnectGateway.Op memory steal = startOp(a, authOwner(ownerPk, a), "", thiefPk);
        a = act(id, CHANGE_RECOVERY).withAccount(thief);
        ConnectGateway.Op memory stealRec = startOp(a, authOwner(ownerPk, a), "", 0);

        // member: suspended phone still cancels both
        ConnectGateway.Action memory c = cancelAct(id, steal);
        gw.cancel(c, authDevice(phonePk, c), steal);
        c = cancelAct(id, stealRec);
        gw.cancel(c, authDevice(laptopPk, c), stealRec);

        // member: recovery reset to a fresh Mera wallet, resetting keys
        a = act(id, RESET).withAccount(newOwner);
        a.flag = true;
        ConnectGateway.Op memory reset = startOp(a, authRecovery(recoveryPk, a), "", newOwnerPk);

        // thief cannot cancel it with the owner key alone
        c = cancelAct(id, reset);
        ConnectGateway.Auth memory auth = authOwner(ownerPk, c);
        vm.expectRevert(ConnectGateway.CannotCancel.selector);
        gw.cancel(c, auth, reset);

        vm.warp(block.timestamp + delay);
        gw.finalize(reset, "");
        assertEq(ids.ownerOf(id), newOwner);

        // the old key is now useless
        a = actKey(id, SUSPEND, phonePk);
        auth = authOwner(ownerPk, a);
        vm.expectRevert(ConnectGateway.BadSignature.selector);
        gw.suspendKey(a, auth);
    }

    // ============================================================ guardian

    function test_pause_rules() public {
        vm.expectRevert(ConnectGateway.NotGuardian.selector);
        gw.pause(1 days);

        vm.startPrank(guardian);
        vm.expectRevert(ConnectGateway.BadPause.selector);
        gw.pause(14 days + 1);
        gw.pause(14 days);
        assertTrue(gw.paused());
        vm.expectRevert(ConnectGateway.BadPause.selector);
        gw.pause(1 days); // already paused
        gw.unpause();
        assertFalse(gw.paused());
        vm.expectRevert(ConnectGateway.BadPause.selector);
        gw.pause(1 days); // cooldown
        vm.warp(block.timestamp + 14 days);
        gw.pause(1 days);
        gw.renounceGuardian();
        vm.stopPrank();
        assertEq(gw.guardian(), address(0));
        vm.warp(block.timestamp + 30 days);
        vm.prank(guardian);
        vm.expectRevert(ConnectGateway.NotGuardian.selector);
        gw.pause(1 days);
    }

    function test_pause_doesNotBlockSafetyPaths() public {
        uint64 id = _setupWithLaptop();
        ConnectGateway.Op memory op = _ownerOp(id);
        vm.prank(guardian);
        gw.pause(14 days);

        ConnectGateway.Action memory c = cancelAct(id, op);
        gw.cancel(c, authDevice(phonePk, c), op);
        ConnectGateway.Action memory a = actKey(id, SUSPEND, laptopPk);
        gw.suspendKey(a, authOwner(ownerPk, a));
        a = actKey(id, RETIRE, laptopPk);
        gw.retireKey(a, devSig(laptopPk, digestOf(a)));
        ConnectGateway.Op memory reset = _resetOp(id);
        vm.warp(block.timestamp + delay);
        gw.finalize(reset, "");
        assertEq(ids.ownerOf(id), newOwner);
    }

    // ============================================================ delays

    function test_delayOf() public view {
        assertEq(gw.delayOf(TRANSFER), 7 days);
        assertEq(gw.delayOf(CHANGE_RECOVERY), 7 days);
        assertEq(gw.delayOf(ADD), 3 days);
        assertEq(gw.delayOf(REMOVE), 3 days);
        assertEq(gw.delayOf(UNSUSPEND), 3 days);
        assertEq(gw.delayOf(RESET), 3 days);
        assertFalse(gw.isDevBuild());
    }

    function test_delayGuard_prodChainsRequireExactDelays() public {
        uint256[3] memory chains = [uint256(10143), 143, 1];
        for (uint256 i; i < chains.length; i++) {
            vm.chainId(chains[i]);
            vm.expectRevert(ConnectGateway.BadDelay.selector);
            new ConnectGateway(guardian, 30, 60);
            vm.expectRevert(ConnectGateway.BadDelay.selector);
            new ConnectGateway(guardian, 3 days, 3 days);
            vm.expectRevert(ConnectGateway.BadDelay.selector);
            new ConnectGateway(guardian, 7 days, 7 days);
            ConnectGateway g = new ConnectGateway(guardian, 3 days, 7 days);
            assertFalse(g.isDevBuild());
        }
    }

    function test_delayGuard_devChainsAllowShortDelays() public {
        uint256[2] memory chains = [uint256(20143), 31337];
        for (uint256 i; i < chains.length; i++) {
            vm.chainId(chains[i]);
            ConnectGateway g = new ConnectGateway(guardian, 20, 40);
            assertTrue(g.isDevBuild());
            assertEq(g.delayOf(TRANSFER), 40);
            vm.expectRevert(ConnectGateway.BadDelay.selector);
            new ConnectGateway(guardian, 0, 40);
            vm.expectRevert(ConnectGateway.BadDelay.selector);
            new ConnectGateway(guardian, 40, 20);
            vm.expectRevert(ConnectGateway.BadDelay.selector);
            new ConnectGateway(guardian, 3 days + 1, 7 days);
            vm.expectRevert(ConnectGateway.BadDelay.selector);
            new ConnectGateway(guardian, 3 days, 7 days + 1);
        }
    }

    // ======================================================== registries

    function test_registries_onlyGateway() public {
        vm.expectRevert(ConnectIdRegistry.NotGateway.selector);
        ids.register(owner, recovery);
        vm.expectRevert(ConnectKeyRegistry.NotGateway.selector);
        keys.resetKeys(1);
        assertEq(ids.gateway(), address(gw));
        assertEq(keys.gateway(), address(gw));
    }
}

library ConnectGatewayTestLib {
    function withAccount(ConnectGateway.Action memory a, address account)
        internal
        pure
        returns (ConnectGateway.Action memory)
    {
        a.account = account;
        return a;
    }
}
