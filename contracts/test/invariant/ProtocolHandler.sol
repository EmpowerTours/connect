// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {ConnectGateway} from "../../src/ConnectGateway.sol";

/// @dev Drives one member's ID through random signed actions from every
///      party and records any outcome the spec forbids in ghost counters.
contract ProtocolHandler is Base {
    struct Tracked {
        ConnectGateway.Op op;
        bytes key;
        uint256 startedAt;
        bool open;
    }

    uint64 public id;
    uint256 public curOwnerPk;
    uint256 public curRecoveryPk;
    Tracked[] internal ops;
    uint256[] internal devicePks;

    uint256 public ghostEarlyFinalize;
    uint256 public ghostDeviceStarts;
    uint256 public ghostBadCancels;
    uint256 public ghostFinalized;
    uint256 public ghostCancelled;
    uint256 public ghostStarted;

    constructor(ConnectGateway gw_, uint64 id_, uint256 ownerPk_, uint256 recoveryPk_) {
        gw = gw_;
        ids = gw_.idRegistry();
        keys = gw_.keyRegistry();
        id = id_;
        curOwnerPk = ownerPk_;
        curRecoveryPk = recoveryPk_;
        devicePks.push(0xD1); // phone (GUARD), registered
        devicePks.push(0xD2); // laptop (GUARD)
        devicePks.push(0xD3); // mini app (no GUARD)
        for (uint256 i; i < 6; i++) {
            devicePks.push(0x6000 + i);
        }
    }

    function opCount() external view returns (uint256) {
        return ops.length;
    }

    /// @dev Not a fixture here; a no-op so the fuzzer cannot redeploy anything.
    function setUp() public override {}

    function _dev(uint256 seed) internal view returns (uint256) {
        return devicePks[seed % devicePks.length];
    }

    function _auth(uint8 who, uint256 devSeed, ConnectGateway.Action memory a)
        internal
        view
        returns (ConnectGateway.Auth memory)
    {
        uint8 w = who % 4;
        if (w == 0) return authOwner(curOwnerPk, a);
        if (w == 1) return authOD(curOwnerPk, _dev(devSeed), a);
        if (w == 2) return authRecovery(curRecoveryPk, a);
        return authDevice(_dev(devSeed), a);
    }

    // ------------------------------------------------------------- actions

    function startOp(uint8 kindSel, uint8 who, uint256 seed) external {
        ConnectGateway.Kind kind = ConnectGateway.Kind(1 + kindSel % 6); // the 6 delayed kinds
        ConnectGateway.Action memory a = act(id, kind);
        bytes memory key;
        uint256 consentPk;
        if (kind == ConnectGateway.Kind.TransferOwner || kind == ConnectGateway.Kind.RecoveryReset) {
            consentPk = 0x7000 + seed % 50;
            a.account = vm.addr(consentPk);
            a.flag = seed % 2 == 0;
        } else if (kind == ConnectGateway.Kind.ChangeRecovery) {
            a.account = vm.addr(0x8000 + seed % 50);
        } else {
            uint256 dpk = _dev(seed);
            a.keyType = P256;
            key = p256Key(dpk);
            a.keyHash = keys.keyHashOf(P256, key);
            a.scope = dpk == 0xD3 ? MESSAGES : ALL;
            a.expiresAt = uint40(block.timestamp + 365 days);
            if (kind != ConnectGateway.Kind.AddKey) key = "";
        }
        ConnectGateway.Auth memory auth = _auth(who, seed >> 8, a);
        uint64 nonce = nonceFor(id, auth.signer);
        bytes memory consent = consentPk == 0 ? bytes("") : ecdsa(consentPk, digestFor(a, auth.signer));
        try gw.start(a, auth, key, consent) {
            if (auth.signer == ConnectGateway.Signer.Device) ghostDeviceStarts++;
            ops.push(Tracked(opFor(a, auth.signer, nonce), key, block.timestamp, true));
            ghostStarted++;
        } catch {}
    }

    function cancel(uint256 idx, uint8 who, uint256 devSeed) external {
        (bool found, uint256 j) = _pickOpen(idx);
        if (!found) return;
        Tracked storage t = ops[j];
        ConnectGateway.Action memory a = cancelAct(id, t.op);
        ConnectGateway.Auth memory auth = _auth(who, devSeed, a);
        try gw.cancel(a, auth, t.op) {
            t.open = false;
            ghostCancelled++;
            bytes32 dh = auth.signer == ConnectGateway.Signer.OwnerDevice || auth.signer == ConnectGateway.Signer.Device
                ? keys.keyHashOf(P256, auth.device.key)
                : bytes32(0);
            if (!_specAllowsCancel(t.op, auth.signer, dh)) ghostBadCancels++;
        } catch {}
    }

    function finalize(uint256 idx) external {
        (bool found, uint256 j) = _pickOpen(idx);
        if (!found) return;
        Tracked storage t = ops[j];
        ConnectGateway.Kind kind = t.op.kind;
        try gw.finalize(t.op, t.key) {
            t.open = false;
            ghostFinalized++;
            if (block.timestamp < t.startedAt + gw.delayOf(kind)) ghostEarlyFinalize++;
            if (kind == ConnectGateway.Kind.TransferOwner || kind == ConnectGateway.Kind.RecoveryReset) {
                curOwnerPk = 0x7000 + _pkIndex(t.op.account, 0x7000);
            } else if (kind == ConnectGateway.Kind.ChangeRecovery) {
                curRecoveryPk = 0x8000 + _pkIndex(t.op.account, 0x8000);
            }
        } catch {}
    }

    function addKeyNow(uint256 seed, uint256 devSeed) external {
        uint256 dpk = _dev(seed);
        ConnectGateway.Action memory a = actAdd(id, dpk, dpk == 0xD3 ? MESSAGES : ALL);
        ConnectGateway.Auth memory auth = authOD(curOwnerPk, _dev(devSeed), a);
        try gw.addKey(a, auth, p256Key(dpk)) {} catch {}
    }

    function suspend(uint256 seed) external {
        ConnectGateway.Action memory a = actKey(id, ConnectGateway.Kind.SuspendKey, _dev(seed));
        try gw.suspendKey(a, authOwner(curOwnerPk, a)) {} catch {}
    }

    function retire(uint256 seed) external {
        uint256 dpk = _dev(seed);
        ConnectGateway.Action memory a = actKey(id, ConnectGateway.Kind.RetireKey, dpk);
        try gw.retireKey(a, devSig(dpk, digestDevice(a, dpk))) {} catch {}
    }

    function prune(uint256 idx) external {
        (bool found, uint256 j) = _pickOpen(idx);
        if (!found) return;
        Tracked storage t = ops[j];
        try gw.prune(t.op) {
            t.open = false;
        } catch {}
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 4 days));
    }

    // ------------------------------------------------------------- helpers

    /// @dev First open op at or after idx (wrapping), so calls are rarely wasted.
    function _pickOpen(uint256 idx) internal view returns (bool, uint256) {
        uint256 n = ops.length;
        if (n == 0) return (false, 0);
        uint256 start = idx % n;
        for (uint256 k; k < n; k++) {
            uint256 j = (start + k) % n;
            if (ops[j].open) return (true, j);
        }
        return (false, 0);
    }

    function _pkIndex(address a, uint256 base) internal pure returns (uint256) {
        for (uint256 i; i < 50; i++) {
            if (vm.addr(base + i) == a) return i;
        }
        revert("unknown account");
    }

    /// @dev The cancel matrix from the protocol doc, written out independently.
    function _specAllowsCancel(ConnectGateway.Op memory op, ConnectGateway.Signer by, bytes32 deviceHash)
        internal
        pure
        returns (bool)
    {
        if (op.kind == ConnectGateway.Kind.RemoveKey && deviceHash == op.keyHash && op.tier != ConnectGateway.Signer.Owner) {
            return false;
        }
        if (op.tier == ConnectGateway.Signer.Recovery) return by == ConnectGateway.Signer.OwnerDevice;
        if (op.tier == ConnectGateway.Signer.OwnerDevice) {
            // the recovery address can't veto its own owner + device replacement (M-2)
            if (by == ConnectGateway.Signer.Recovery) return op.kind != ConnectGateway.Kind.ChangeRecovery;
            return by != ConnectGateway.Signer.Owner;
        }
        return true;
    }
}
