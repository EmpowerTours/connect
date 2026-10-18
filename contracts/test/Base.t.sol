// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {ConnectGateway} from "../src/ConnectGateway.sol";
import {ConnectIdRegistry} from "../src/ConnectIdRegistry.sol";
import {ConnectKeyRegistry} from "../src/ConnectKeyRegistry.sol";

/// @dev Minimal ERC-1271 smart wallet with one ECDSA signer.
contract MockWallet {
    address public immutable signer;

    constructor(address signer_) {
        signer = signer_;
    }

    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        (bytes32 r, bytes32 s) = abi.decode(sig[:64], (bytes32, bytes32));
        uint8 v = uint8(sig[64]);
        return ecrecover(hash, v, r, s) == signer ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

abstract contract Base is Test {
    uint256 internal constant P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint8 internal constant P256 = 1;
    uint8 internal constant K1 = 2;
    uint8 internal constant ALL = 63;
    uint8 internal constant GUARD = 32;
    uint8 internal constant MESSAGES = 31; // everything but GUARD (mini-app key)

    ConnectGateway internal gw;
    ConnectIdRegistry internal ids;
    ConnectKeyRegistry internal keys;

    uint256 internal ownerPk = 0xA11CE;
    uint256 internal recoveryPk = 0xB0B;
    uint256 internal newOwnerPk = 0xC0FFEE;
    uint256 internal thiefPk = 0xBAD;
    address internal owner;
    address internal recovery;
    address internal newOwner;
    address internal thief;
    address internal guardian = makeAddr("guardian");

    // P-256 device keys
    uint256 internal phonePk = 0xD1;
    uint256 internal laptopPk = 0xD2;
    uint256 internal miniAppPk = 0xD3;

    uint256 internal delay;
    uint256 internal longDelay;

    function setUp() public virtual {
        owner = vm.addr(ownerPk);
        recovery = vm.addr(recoveryPk);
        newOwner = vm.addr(newOwnerPk);
        thief = vm.addr(thiefPk);
        vm.warp(1_750_000_000);
        gw = new ConnectGateway(guardian, 3 days, 7 days);
        ids = gw.idRegistry();
        keys = gw.keyRegistry();
        delay = gw.delay();
        longDelay = gw.longDelay();
    }

    // ---------------------------------------------------------------- keys

    function p256Key(uint256 pk) internal pure returns (bytes memory) {
        (uint256 x, uint256 y) = vm.publicKeyP256(pk);
        return abi.encode(x, y);
    }

    function p256Hash(uint256 pk) internal view returns (bytes32) {
        return keys.keyHashOf(P256, p256Key(pk));
    }

    function k1Key(uint256 pk) internal pure returns (bytes memory) {
        return abi.encode(vm.addr(pk));
    }

    function ecdsa(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev WebCrypto-style: ECDSA P-256 over sha256(digest), normalized to low s.
    function p256Sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (bytes32 r, bytes32 s) = vm.signP256(pk, sha256(abi.encodePacked(digest)));
        if (uint256(s) > P256_N / 2) s = bytes32(P256_N - uint256(s));
        return abi.encode(r, s);
    }

    function exp() internal view returns (uint40) {
        return uint40(block.timestamp + 365 days);
    }

    // ------------------------------------------------------------ register

    function regParams(address o, address r, uint256 devPk, uint8 scope)
        internal
        view
        returns (ConnectGateway.RegisterParams memory p)
    {
        p = ConnectGateway.RegisterParams({
            owner: o,
            recovery: r,
            keyType: P256,
            key: p256Key(devPk),
            scope: scope,
            expiresAt: exp(),
            deadline: block.timestamp + 1 hours
        });
    }

    function signRegister(uint256 pk, ConnectGateway.RegisterParams memory p) internal view returns (bytes memory) {
        return ecdsa(pk, gw.registerDigest(p, gw.registerNonce(p.owner)));
    }

    /// @dev owner + recovery, phone (GUARD, all scopes) registered.
    function registerDefault() internal returns (uint64 id) {
        ConnectGateway.RegisterParams memory p = regParams(owner, recovery, phonePk, ALL);
        id = gw.register(p, signRegister(ownerPk, p));
    }

    // ------------------------------------------------------------- actions

    function act(uint64 id, ConnectGateway.Kind kind) internal view returns (ConnectGateway.Action memory a) {
        a.id = id;
        a.kind = kind;
        a.deadline = block.timestamp + 1 hours;
    }

    function actKey(uint64 id, ConnectGateway.Kind kind, uint256 devPk)
        internal
        view
        returns (ConnectGateway.Action memory a)
    {
        a = act(id, kind);
        a.keyType = P256;
        a.keyHash = p256Hash(devPk);
    }

    function actAdd(uint64 id, uint256 devPk, uint8 scope) internal view returns (ConnectGateway.Action memory a) {
        a = actKey(id, ConnectGateway.Kind.AddKey, devPk);
        a.scope = scope;
        a.expiresAt = exp();
    }

    function digestOf(ConnectGateway.Action memory a) internal view returns (bytes32) {
        return gw.actionDigest(a, gw.nonceOf(a.id));
    }

    function devSig(uint256 devPk, bytes32 digest) internal pure returns (ConnectGateway.DeviceSig memory d) {
        d = ConnectGateway.DeviceSig({keyType: P256, key: p256Key(devPk), sig: p256Sig(devPk, digest)});
    }

    function noDevice() internal pure returns (ConnectGateway.DeviceSig memory d) {}

    function authOwner(uint256 pk, ConnectGateway.Action memory a) internal view returns (ConnectGateway.Auth memory) {
        return ConnectGateway.Auth(ConnectGateway.Signer.Owner, ecdsa(pk, digestOf(a)), noDevice());
    }

    function authRecovery(uint256 pk, ConnectGateway.Action memory a)
        internal
        view
        returns (ConnectGateway.Auth memory)
    {
        return ConnectGateway.Auth(ConnectGateway.Signer.Recovery, ecdsa(pk, digestOf(a)), noDevice());
    }

    function authOD(uint256 pk, uint256 devPk, ConnectGateway.Action memory a)
        internal
        view
        returns (ConnectGateway.Auth memory)
    {
        bytes32 d = digestOf(a);
        return ConnectGateway.Auth(ConnectGateway.Signer.OwnerDevice, ecdsa(pk, d), devSig(devPk, d));
    }

    function authDevice(uint256 devPk, ConnectGateway.Action memory a)
        internal
        view
        returns (ConnectGateway.Auth memory)
    {
        return ConnectGateway.Auth(ConnectGateway.Signer.Device, "", devSig(devPk, digestOf(a)));
    }

    function opFor(ConnectGateway.Action memory a, ConnectGateway.Signer tier, uint64 nonce)
        internal
        pure
        returns (ConnectGateway.Op memory op)
    {
        op = ConnectGateway.Op({
            id: a.id,
            kind: a.kind,
            tier: tier,
            account: a.account,
            keyType: a.keyType,
            keyHash: a.keyHash,
            scope: a.scope,
            expiresAt: a.expiresAt,
            flag: a.flag,
            nonce: nonce
        });
    }

    /// @dev Starts a delayed op and returns it (consent signed by `consentPk` if nonzero).
    function startOp(ConnectGateway.Action memory a, ConnectGateway.Auth memory auth, bytes memory key, uint256 consentPk)
        internal
        returns (ConnectGateway.Op memory op)
    {
        uint64 nonce = gw.nonceOf(a.id);
        bytes memory consent = consentPk == 0 ? bytes("") : ecdsa(consentPk, digestOf(a));
        bytes32 opId = gw.start(a, auth, key, consent);
        op = opFor(a, auth.signer, nonce);
        assertEq(opId, gw.opIdOf(op), "opId");
    }

    function cancelAct(uint64 id, ConnectGateway.Op memory op) internal view returns (ConnectGateway.Action memory a) {
        a = act(id, ConnectGateway.Kind.Cancel);
        a.opId = gw.opIdOf(op);
    }

    function isPending(ConnectGateway.Op memory op) internal view returns (bool) {
        (uint40 readyAt,) = gw.pending(gw.opIdOf(op));
        return readyAt != 0;
    }
}
