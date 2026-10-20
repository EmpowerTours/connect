// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {ConnectGateway} from "../src/ConnectGateway.sol";
import {ConnectKeyRegistry} from "../src/ConnectKeyRegistry.sol";

/// Signed key requests (which app asked for a key) and the per-epoch add cap.
contract KeyRequestTest is Base {
    uint256 internal appOwnerPk = 0xA99;
    address internal appOwner;
    uint64 internal appId;
    uint64 internal id;

    function setUp() public override {
        super.setUp();
        appOwner = vm.addr(appOwnerPk);
        id = registerDefault();
        ConnectGateway.RegisterParams memory p = regParams(appOwner, address(0), 0xD9, ALL);
        appId = gw.register(p, signRegister(appOwnerPk, p));
    }

    function req(uint256 signerPk, uint64 requestId, uint64 forId, bytes32 keyHash)
        internal
        view
        returns (ConnectGateway.KeyRequest memory r)
    {
        r.requestId = requestId;
        r.deadline = block.timestamp + 1 hours;
        r.sig = ecdsa(signerPk, gw.keyRequestDigest(requestId, forId, keyHash, r.deadline));
    }

    function test_addKeyRequested_recordsApp() public {
        ConnectGateway.Action memory a = actAdd(id, miniAppPk, MESSAGES);
        ConnectGateway.KeyRequest memory r = req(appOwnerPk, appId, id, a.keyHash);
        vm.expectEmit(true, true, true, true, address(keys));
        emit ConnectKeyRegistry.KeyRequested(id, a.keyHash, appId);
        gw.addKeyRequested(a, authOD(ownerPk, phonePk, a), p256Key(miniAppPk), r);
        assertEq(keys.requestedByOf(id, a.keyHash), appId);
        assertTrue(keys.canSign(id, a.keyHash, 1));
    }

    function test_addKey_recordsNoApp() public {
        ConnectGateway.Action memory a = actAdd(id, laptopPk, ALL);
        gw.addKey(a, authOD(ownerPk, phonePk, a), p256Key(laptopPk));
        assertEq(keys.requestedByOf(id, a.keyHash), 0);
    }

    function test_addKeyRequested_wrongSigner() public {
        ConnectGateway.Action memory a = actAdd(id, miniAppPk, MESSAGES);
        ConnectGateway.KeyRequest memory r = req(thiefPk, appId, id, a.keyHash);
        ConnectGateway.Auth memory auth = authOD(ownerPk, phonePk, a);
        vm.expectRevert(ConnectGateway.BadKeyRequest.selector);
        gw.addKeyRequested(a, auth, p256Key(miniAppPk), r);
    }

    function test_addKeyRequested_boundToTargetIdAndKey() public {
        ConnectGateway.Action memory a = actAdd(id, miniAppPk, MESSAGES);
        ConnectGateway.Auth memory auth = authOD(ownerPk, phonePk, a);
        ConnectGateway.KeyRequest memory otherId = req(appOwnerPk, appId, appId, a.keyHash);
        vm.expectRevert(ConnectGateway.BadKeyRequest.selector);
        gw.addKeyRequested(a, auth, p256Key(miniAppPk), otherId);
        ConnectGateway.KeyRequest memory otherKey = req(appOwnerPk, appId, id, p256Hash(laptopPk));
        vm.expectRevert(ConnectGateway.BadKeyRequest.selector);
        gw.addKeyRequested(a, auth, p256Key(miniAppPk), otherKey);
    }

    function test_addKeyRequested_unknownApp() public {
        ConnectGateway.Action memory a = actAdd(id, miniAppPk, MESSAGES);
        ConnectGateway.Auth memory auth = authOD(ownerPk, phonePk, a);
        ConnectGateway.KeyRequest memory zero = req(appOwnerPk, 0, id, a.keyHash);
        vm.expectRevert(ConnectGateway.BadKeyRequest.selector);
        gw.addKeyRequested(a, auth, p256Key(miniAppPk), zero);
        ConnectGateway.KeyRequest memory missing = req(appOwnerPk, 99, id, a.keyHash);
        vm.expectRevert(ConnectGateway.BadKeyRequest.selector);
        gw.addKeyRequested(a, auth, p256Key(miniAppPk), missing);
    }

    function test_addKeyRequested_expired() public {
        ConnectGateway.Action memory a = actAdd(id, miniAppPk, MESSAGES);
        ConnectGateway.KeyRequest memory r = req(appOwnerPk, appId, id, a.keyHash);
        a.deadline = block.timestamp + 3 hours;
        ConnectGateway.Auth memory auth = authOD(ownerPk, phonePk, a);
        vm.warp(r.deadline + 1);
        vm.expectRevert(ConnectGateway.Expired.selector);
        gw.addKeyRequested(a, auth, p256Key(miniAppPk), r);
    }

    function test_addKeyRequested_stillNeedsOwnerAndDevice() public {
        ConnectGateway.Action memory a = actAdd(id, miniAppPk, MESSAGES);
        ConnectGateway.KeyRequest memory r = req(appOwnerPk, appId, id, a.keyHash);
        ConnectGateway.Auth memory auth = authOD(thiefPk, phonePk, a);
        vm.expectRevert();
        gw.addKeyRequested(a, auth, p256Key(miniAppPk), r);
    }

    /// The cap counts every add in the epoch, even after retiring keys frees live slots.
    function test_maxKeysPerEpoch() public {
        uint16 cap = keys.MAX_KEYS_PER_EPOCH();
        for (uint256 i = 1; i < cap; i++) {
            uint256 pk = 0x10000 + i;
            ConnectGateway.Action memory a = actAdd(id, pk, MESSAGES);
            gw.addKey(a, authOD(ownerPk, phonePk, a), p256Key(pk));
            ConnectGateway.Action memory r = actKey(id, ConnectGateway.Kind.RetireKey, pk);
            gw.retireKey(r, devSig(pk, digestDevice(r, pk)));
        }
        (, uint8 live, uint16 added) = keys.idKeys(id);
        assertEq(live, 1);
        assertEq(added, cap);
        ConnectGateway.Action memory b = actAdd(id, 0x2000, MESSAGES);
        ConnectGateway.Auth memory auth = authOD(ownerPk, phonePk, b);
        vm.expectRevert(ConnectKeyRegistry.TooManyKeys.selector);
        gw.addKey(b, auth, p256Key(0x2000));
    }
}
