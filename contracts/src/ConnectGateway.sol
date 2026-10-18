// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {ConnectIdRegistry} from "./ConnectIdRegistry.sol";
import {ConnectKeyRegistry} from "./ConnectKeyRegistry.sol";

/// @title ConnectGateway
/// @notice The only writer to the Connect ID and key registries. Every action
///         is an EIP-712 message signed by the member's keys, so a relayer can
///         submit it and pay gas; `msg.sender` never matters.
///
///         Who can do what (see connect-monad-protocol.md, "The 3-day rule"):
///           Owner (Mera wallet) alone:
///             instant  - suspend a device key
///             7 days   - transfer ownership, change recovery
///             3 days   - add a device, remove a device, unsuspend a device
///           Owner + a GUARD device key:
///             instant  - add a device, suspend a device
///             7 days   - transfer ownership, change recovery
///             3 days   - remove, unsuspend
///           Recovery address:
///             3 days   - recovery reset (new owner; optionally reset all keys),
///                        so the real member escapes before a thief's 7-day
///                        transfer can complete
///           Any device key: retire itself.
///           Device keys alone never start a change; GUARD keys can cancel.
///
///         Cancel matrix (who can cancel a pending op, by who started it):
///           Owner-only op       -> owner, recovery, any GUARD device
///           Owner + device op   -> recovery, any GUARD device, owner + device
///                                  (NOT the owner alone: a thief holding only
///                                  the Mera key cannot undo the member)
///           Recovery reset      -> owner + GUARD device only
///           A device can't cancel its own removal when the owner AND
///           another device started it; it can cancel an owner-only one (so
///           a single-device member survives a stolen Mera key).
///
///         Nonces: one per party (owner, recovery, each device), so no party
///         can invalidate another party's signed actions by burning a shared
///         nonce (a thief with the Mera key can't front-run the member's
///         device cancels or recovery reset).
///
///         Delays: 7 days for the two permanent-takeover paths (transfer
///         ownership, change recovery), 3 days for everything else. The
///         constructor enforces exactly these values on every chain except
///         local anvil (31337) and Monad Solonet (20143), which cannot warp
///         time; there shorter dev delays are allowed for end-to-end runs.
///
///         Pause: an optional guardian (a Safe) can pause new registrations
///         and key additions for at most 14 days, once per 14-day cooldown,
///         and can renounce. It can never touch IDs, keys, cancels, finalizes
///         or recovery. No owner, no upgrades.
contract ConnectGateway is EIP712 {
    enum Kind {
        None,
        TransferOwner,
        ChangeRecovery,
        AddKey,
        RemoveKey,
        UnsuspendKey,
        RecoveryReset,
        SuspendKey,
        RetireKey,
        Cancel
    }

    /// @notice Who authorized an action. Also the "tier" of a pending op.
    enum Signer {
        None,
        Owner,
        OwnerDevice,
        Recovery,
        Device
    }

    /// @notice A signed request. Unused fields are zero.
    struct Action {
        uint64 id;
        Kind kind;
        address account; // new owner (transfer, reset) or new recovery
        uint8 keyType;
        bytes32 keyHash; // target key (add/remove/suspend/unsuspend/retire)
        uint8 scope; // add only
        uint40 expiresAt; // add only
        bool flag; // reset: also reset every device key
        bytes32 opId; // cancel only
        uint256 deadline;
    }

    struct DeviceSig {
        uint8 keyType;
        bytes key; // P-256: abi.encode(x, y); secp256k1: abi.encode(address)
        bytes sig; // P-256: abi.encode(r, s) with low s; secp256k1: 65-byte r,s,v
    }

    struct Auth {
        Signer signer;
        bytes sig; // owner or recovery signature (ECDSA, or ERC-1271 for contracts)
        DeviceSig device; // for OwnerDevice and Device
    }

    /// @notice A pending delayed op. Only keccak256(abi.encode(op)) is stored;
    ///         the full op is in {OpStarted} for whoever finalizes.
    struct Op {
        uint64 id;
        Kind kind;
        Signer tier;
        address account;
        uint8 keyType;
        bytes32 keyHash;
        uint8 scope;
        uint40 expiresAt;
        bool flag;
        uint64 nonce;
    }

    struct Pending {
        uint40 readyAt;
        uint32 opEpoch;
    }

    struct IdState {
        uint64 nonce; // owner and owner + device actions
        uint64 recoveryNonce; // recovery actions
        uint32 opEpoch; // bumped on owner/recovery change: invalidates pending ops
        uint8 pendingOwner;
        uint8 pendingOwnerDevice;
        uint8 pendingRecovery;
    }

    struct RegisterParams {
        address owner;
        address recovery;
        uint8 keyType;
        bytes key;
        uint8 scope;
        uint40 expiresAt;
        uint256 deadline;
    }

    uint256 public constant PROD_DELAY = 3 days;
    uint256 public constant PROD_LONG_DELAY = 7 days;
    uint256 public constant OP_WINDOW = 30 days; // finalize within this after readyAt
    uint256 public constant MAX_PAUSE = 14 days;
    uint256 public constant PAUSE_COOLDOWN = 14 days;
    /// @dev Per tier, so a thief holding one key cannot fill the slots the
    ///      member needs (e.g. owner-only ops never block a recovery reset).
    uint8 public constant MAX_PENDING_PER_TIER = 5;

    /// @dev Mirrors ConnectKeyRegistry (constants, so no external call).
    uint8 internal constant TYPE_P256 = 1;
    uint8 internal constant TYPE_SECP256K1 = 2;
    uint8 internal constant SCOPE_GUARD = 32;

    uint256 public constant CHAIN_MONAD = 143;
    uint256 public constant CHAIN_MONAD_TESTNET = 10143;
    uint256 public constant CHAIN_SOLONET = 20143;
    uint256 public constant CHAIN_ANVIL = 31337;

    bytes32 public constant REGISTER_TYPEHASH = keccak256(
        "Register(address owner,address recovery,uint8 keyType,bytes32 keyHash,uint8 scope,uint40 expiresAt,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant ACTION_TYPEHASH = keccak256(
        "Action(uint64 id,uint8 kind,address account,uint8 keyType,bytes32 keyHash,uint8 scope,uint40 expiresAt,bool flag,bytes32 opId,uint256 nonce,uint256 deadline)"
    );

    error BadDelay();
    error Expired();
    error UnknownId();
    error BadSignature();
    error NotGuard();
    error BadKind();
    error BadSigner();
    error BadAccount();
    error KeyMismatch();
    error WrongKeyState();
    error TooManyPending();
    error UnknownOp();
    error OpMismatch();
    error NotReady();
    error OpExpired();
    error OpStale();
    error CannotCancel();
    error IsPaused();
    error NotGuardian();
    error BadPause();
    error FirstKeyNotGuard();

    event OpStarted(bytes32 indexed opId, uint64 indexed id, Op op, uint40 readyAt, bytes key);
    event OpCancelled(bytes32 indexed opId, uint64 indexed id, Signer by);
    event OpFinalized(bytes32 indexed opId, uint64 indexed id);
    event OpPruned(bytes32 indexed opId, uint64 indexed id);
    event OpsInvalidated(uint64 indexed id, uint32 opEpoch);
    event Paused(address indexed guardian, uint64 until);
    event Unpaused(address indexed guardian);
    event GuardianRenounced(address indexed guardian);

    ConnectIdRegistry public immutable idRegistry;
    ConnectKeyRegistry public immutable keyRegistry;
    /// @notice Delay for key ops and recovery reset. 3 days except on dev chains.
    uint256 public immutable delay;
    /// @notice Delay for transfer ownership and change recovery. 7 days except on dev chains.
    uint256 public immutable longDelay;

    address public guardian;
    uint64 public pausedUntil;

    mapping(uint64 id => IdState) public idState;
    mapping(address owner => uint256) public registerNonce;
    mapping(bytes32 opId => Pending) public pending;

    /// @param guardian_ Pause-only guardian (a Safe), or zero for none.
    /// @param delay_    Must be PROD_DELAY (3 days) on every chain except anvil and Solonet.
    /// @param longDelay_ Must be PROD_LONG_DELAY (7 days) on every chain except anvil and Solonet.
    constructor(address guardian_, uint256 delay_, uint256 longDelay_) EIP712("ConnectProtocol", "1") {
        if (!_isDevChain()) {
            if (delay_ != PROD_DELAY || longDelay_ != PROD_LONG_DELAY) revert BadDelay();
        } else if (
            delay_ == 0 || delay_ > PROD_DELAY || longDelay_ < delay_ || longDelay_ > PROD_LONG_DELAY
        ) {
            revert BadDelay();
        }
        delay = delay_;
        longDelay = longDelay_;
        guardian = guardian_;
        idRegistry = new ConnectIdRegistry();
        keyRegistry = new ConnectKeyRegistry();
    }

    modifier whenNotPaused() {
        if (block.timestamp < pausedUntil) revert IsPaused();
        _;
    }

    // ================================================================ views

    function paused() external view returns (bool) {
        return block.timestamp < pausedUntil;
    }

    function isDevBuild() external view returns (bool) {
        return delay != PROD_DELAY || longDelay != PROD_LONG_DELAY;
    }

    /// @notice Nonce for owner and owner + device actions.
    function nonceOf(uint64 id) external view returns (uint64) {
        return idState[id].nonce;
    }

    /// @notice Nonce for recovery-address actions.
    function recoveryNonceOf(uint64 id) external view returns (uint64) {
        return idState[id].recoveryNonce;
    }

    /// @notice Nonce for actions signed by one device alone.
    function deviceNonceOf(uint64 id, bytes32 keyHash) external view returns (uint64) {
        return keyRegistry.nonceOf(id, keyHash);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function registerDigest(RegisterParams calldata p, uint256 nonce) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    REGISTER_TYPEHASH,
                    p.owner,
                    p.recovery,
                    p.keyType,
                    keyRegistry.keyHashOf(p.keyType, p.key),
                    p.scope,
                    p.expiresAt,
                    nonce,
                    p.deadline
                )
            )
        );
    }

    function actionDigest(Action calldata a, uint256 nonce) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ACTION_TYPEHASH,
                    a.id,
                    uint8(a.kind),
                    a.account,
                    a.keyType,
                    a.keyHash,
                    a.scope,
                    a.expiresAt,
                    a.flag,
                    a.opId,
                    nonce,
                    a.deadline
                )
            )
        );
    }

    /// @notice Delay that applies to a delayed op kind.
    function delayOf(Kind kind) public view returns (uint256) {
        return kind == Kind.TransferOwner || kind == Kind.ChangeRecovery ? longDelay : delay;
    }

    function opIdOf(Op memory op) public pure returns (bytes32) {
        return keccak256(abi.encode(op));
    }

    /// @notice The cancel matrix. `deviceHash` is the device that signed the
    ///         cancel (zero if none).
    function canCancel(Op memory op, Signer by, bytes32 deviceHash) public pure returns (bool) {
        if (
            deviceHash != bytes32(0) && op.kind == Kind.RemoveKey && deviceHash == op.keyHash
                && op.tier != Signer.Owner
        ) return false;
        if (op.tier == Signer.Recovery) return by == Signer.OwnerDevice;
        if (op.tier == Signer.OwnerDevice) {
            return by == Signer.Recovery || by == Signer.Device || by == Signer.OwnerDevice;
        }
        if (op.tier == Signer.Owner) return by != Signer.None;
        return false;
    }

    // ======================================================== registration

    /// @notice Creates a Connect ID owned by `p.owner` with one active device key.
    function register(RegisterParams calldata p, bytes calldata ownerSig)
        external
        whenNotPaused
        returns (uint64 id)
    {
        if (block.timestamp > p.deadline) revert Expired();
        // The first key is the member's own device; it must be able to cancel.
        if (p.scope & SCOPE_GUARD == 0) revert FirstKeyNotGuard();
        uint256 nonce = registerNonce[p.owner];
        if (!_isValidSig(p.owner, registerDigest(p, nonce), ownerSig)) revert BadSignature();
        unchecked {
            registerNonce[p.owner] = nonce + 1;
        }
        id = idRegistry.register(p.owner, p.recovery);
        keyRegistry.add(id, p.keyType, p.key, p.scope, p.expiresAt);
    }

    // ===================================================== instant actions

    /// @notice Owner + GUARD device: add a key now.
    function addKey(Action calldata a, Auth calldata auth, bytes calldata key) external whenNotPaused {
        if (a.kind != Kind.AddKey) revert BadKind();
        if (auth.signer != Signer.OwnerDevice) revert BadSigner();
        _authorize(a, auth);
        if (keyRegistry.keyHashOf(a.keyType, key) != a.keyHash) revert KeyMismatch();
        keyRegistry.add(a.id, a.keyType, key, a.scope, a.expiresAt);
    }

    /// @notice Owner (alone or with a device): suspend a key now. Suspension
    ///         stops new messages; a GUARD key keeps its cancel power.
    function suspendKey(Action calldata a, Auth calldata auth) external {
        if (a.kind != Kind.SuspendKey) revert BadKind();
        if (auth.signer != Signer.Owner && auth.signer != Signer.OwnerDevice) revert BadSigner();
        _authorize(a, auth);
        keyRegistry.suspend(a.id, a.keyHash);
    }

    /// @notice A device key retires itself (lost trust, app uninstall).
    function retireKey(Action calldata a, DeviceSig calldata device) external {
        if (a.kind != Kind.RetireKey) revert BadKind();
        if (block.timestamp > a.deadline) revert Expired();
        bytes32 h = keyRegistry.keyHashOf(device.keyType, device.key);
        if (h != a.keyHash) revert KeyMismatch();
        bytes32 digest = actionDigest(a, keyRegistry.useNonce(a.id, h));
        if (_verifyDevice(digest, device) != h) revert KeyMismatch();
        keyRegistry.retire(a.id, h);
    }

    // ======================================================= delayed ops

    /// @notice Starts a delayed op. `key` is the key bytes for AddKey (empty
    ///         otherwise). `consentSig` is the new owner's signature over the
    ///         same action for TransferOwner and RecoveryReset.
    function start(Action calldata a, Auth calldata auth, bytes calldata key, bytes calldata consentSig)
        external
        returns (bytes32 opId)
    {
        Signer s = auth.signer;
        if (s != Signer.Owner && s != Signer.OwnerDevice && s != Signer.Recovery) revert BadSigner();
        (address owner, address recovery) = idRegistry.recordOf(a.id);
        (bytes32 digest, uint64 nonce) = _authorize(a, auth);
        Kind k = a.kind;

        if (k == Kind.RecoveryReset) {
            if (s != Signer.Recovery) revert BadSigner();
        } else if (s == Signer.Recovery) {
            revert BadSigner();
        }

        if (k == Kind.TransferOwner || k == Kind.RecoveryReset) {
            address to = a.account;
            if (to == address(0) || to == recovery || idRegistry.idOf(to) != 0) revert BadAccount();
            if (!_isValidSig(to, digest, consentSig)) revert BadSignature();
        } else if (k == Kind.ChangeRecovery) {
            if (a.account == owner) revert BadAccount();
        } else if (k == Kind.AddKey) {
            // Owner + device adds instantly via addKey().
            if (s != Signer.Owner) revert BadSigner();
            if (block.timestamp < pausedUntil) revert IsPaused();
            if (keyRegistry.checkAdd(a.id, a.keyType, key, a.scope, a.expiresAt) != a.keyHash) {
                revert KeyMismatch();
            }
        } else if (k == Kind.RemoveKey) {
            ConnectKeyRegistry.State st = keyRegistry.stateOf(a.id, a.keyHash);
            if (st == ConnectKeyRegistry.State.None || st == ConnectKeyRegistry.State.Removed) {
                revert WrongKeyState();
            }
        } else if (k == Kind.UnsuspendKey) {
            if (
                !keyRegistry.isLive(a.id, a.keyHash)
                    || keyRegistry.stateOf(a.id, a.keyHash) != ConnectKeyRegistry.State.Suspended
            ) revert WrongKeyState();
        } else {
            revert BadKind();
        }

        IdState storage st_ = idState[a.id];
        _incPending(st_, s);

        Op memory op = Op({
            id: a.id,
            kind: k,
            tier: s,
            account: a.account,
            keyType: a.keyType,
            keyHash: a.keyHash,
            scope: a.scope,
            expiresAt: a.expiresAt,
            flag: a.flag,
            nonce: nonce
        });
        opId = opIdOf(op);
        uint40 readyAt = uint40(block.timestamp + delayOf(k));
        pending[opId] = Pending({readyAt: readyAt, opEpoch: st_.opEpoch});
        emit OpStarted(opId, a.id, op, readyAt, k == Kind.AddKey ? key : bytes(""));
    }

    /// @notice Cancels a pending op per the cancel matrix. `a.opId` names it.
    function cancel(Action calldata a, Auth calldata auth, Op calldata op) external {
        if (a.kind != Kind.Cancel) revert BadKind();
        if (opIdOf(op) != a.opId || op.id != a.id) revert OpMismatch();
        Pending memory p = pending[a.opId];
        if (p.readyAt == 0) revert UnknownOp();
        _authorize(a, auth);
        bytes32 deviceHash = auth.signer == Signer.OwnerDevice || auth.signer == Signer.Device
            ? keyRegistry.keyHashOf(auth.device.keyType, auth.device.key)
            : bytes32(0);
        if (!canCancel(op, auth.signer, deviceHash)) revert CannotCancel();
        _clear(a.opId, op, p);
        emit OpCancelled(a.opId, a.id, auth.signer);
    }

    /// @notice Anyone can finalize once the delay has passed (within 30 days).
    /// @param key Key bytes for AddKey (from {OpStarted}); empty otherwise.
    function finalize(Op calldata op, bytes calldata key) external {
        bytes32 opId = opIdOf(op);
        Pending memory p = pending[opId];
        if (p.readyAt == 0) revert UnknownOp();
        if (block.timestamp < p.readyAt) revert NotReady();
        if (block.timestamp >= uint256(p.readyAt) + OP_WINDOW) revert OpExpired();
        IdState storage st = idState[op.id];
        if (p.opEpoch != st.opEpoch) revert OpStale();
        _clear(opId, op, p);
        emit OpFinalized(opId, op.id);

        // Effects on this contract first; the registries are trusted and non-reentrant by design.
        Kind k = op.kind;
        if (k == Kind.TransferOwner || k == Kind.RecoveryReset) {
            _invalidateOps(st, op.id);
            idRegistry.setOwner(op.id, op.account);
            if (k == Kind.RecoveryReset && op.flag) keyRegistry.resetKeys(op.id);
        } else if (k == Kind.ChangeRecovery) {
            _invalidateOps(st, op.id);
            idRegistry.setRecovery(op.id, op.account);
        } else if (k == Kind.AddKey) {
            if (keyRegistry.keyHashOf(op.keyType, key) != op.keyHash) revert KeyMismatch();
            keyRegistry.add(op.id, op.keyType, key, op.scope, op.expiresAt);
        } else if (k == Kind.RemoveKey) {
            keyRegistry.remove(op.id, op.keyHash);
        } else {
            // UnsuspendKey (start() admits no other kinds)
            keyRegistry.unsuspend(op.id, op.keyHash);
        }
    }

    /// @notice Anyone can clear an op that expired or went stale.
    function prune(Op calldata op) external {
        bytes32 opId = opIdOf(op);
        Pending memory p = pending[opId];
        if (p.readyAt == 0) revert UnknownOp();
        bool stale = p.opEpoch != idState[op.id].opEpoch;
        if (!stale && block.timestamp < uint256(p.readyAt) + OP_WINDOW) revert NotReady();
        _clear(opId, op, p);
        emit OpPruned(opId, op.id);
    }

    // ============================================================ guardian

    function pause(uint64 duration) external {
        if (msg.sender != guardian) revert NotGuardian();
        uint64 until_ = pausedUntil;
        if (duration == 0 || duration > MAX_PAUSE) revert BadPause();
        if (block.timestamp < until_) revert BadPause();
        if (until_ != 0 && block.timestamp < uint256(until_) + PAUSE_COOLDOWN) revert BadPause();
        uint64 newUntil = uint64(block.timestamp + duration);
        pausedUntil = newUntil;
        emit Paused(msg.sender, newUntil);
    }

    function unpause() external {
        if (msg.sender != guardian) revert NotGuardian();
        if (block.timestamp >= pausedUntil) revert BadPause();
        pausedUntil = uint64(block.timestamp);
        emit Unpaused(msg.sender);
    }

    function renounceGuardian() external {
        if (msg.sender != guardian) revert NotGuardian();
        guardian = address(0);
        emit GuardianRenounced(msg.sender);
    }

    // ============================================================ internal

    function _isDevChain() private view returns (bool) {
        return block.chainid == CHAIN_ANVIL || block.chainid == CHAIN_SOLONET;
    }

    /// @dev Checks the signatures required by `auth.signer` and consumes the
    ///      nonce of the party that leads the action: the owner (Owner,
    ///      OwnerDevice), the recovery address, or the device (Device).
    function _authorize(Action calldata a, Auth calldata auth) private returns (bytes32 digest, uint64 nonce) {
        if (block.timestamp > a.deadline) revert Expired();
        (address owner, address recovery) = idRegistry.recordOf(a.id);
        if (owner == address(0)) revert UnknownId();
        Signer s = auth.signer;
        IdState storage st = idState[a.id];
        if (s == Signer.Owner || s == Signer.OwnerDevice) {
            nonce = st.nonce;
            unchecked {
                st.nonce = nonce + 1;
            }
            digest = actionDigest(a, nonce);
            if (!_isValidSig(owner, digest, auth.sig)) revert BadSignature();
        } else if (s == Signer.Recovery) {
            nonce = st.recoveryNonce;
            unchecked {
                st.recoveryNonce = nonce + 1;
            }
            digest = actionDigest(a, nonce);
            if (!_isValidSig(recovery, digest, auth.sig)) revert BadSignature();
        } else if (s == Signer.Device) {
            nonce = keyRegistry.useNonce(a.id, keyRegistry.keyHashOf(auth.device.keyType, auth.device.key));
            digest = actionDigest(a, nonce);
        } else {
            revert BadSigner();
        }
        if (s == Signer.OwnerDevice || s == Signer.Device) {
            bytes32 h = _verifyDevice(digest, auth.device);
            if (!keyRegistry.hasGuardPower(a.id, h)) revert NotGuard();
        }
    }

    /// @dev Verifies a device signature over `digest` and returns the key hash.
    ///      Registration status is checked by the caller.
    function _verifyDevice(bytes32 digest, DeviceSig calldata d) private view returns (bytes32 h) {
        bool ok = false;
        if (d.keyType == TYPE_P256 && d.key.length == 64 && d.sig.length == 64) {
            // WebCrypto ECDSA P-256/SHA-256 over the 32-byte digest.
            (bytes32 x, bytes32 y) = abi.decode(d.key, (bytes32, bytes32));
            (bytes32 r, bytes32 s) = abi.decode(d.sig, (bytes32, bytes32));
            ok = P256.verify(sha256(abi.encodePacked(digest)), r, s, x, y);
        } else if (d.keyType == TYPE_SECP256K1 && d.key.length == 32) {
            address signer = abi.decode(d.key, (address));
            (address rec, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(digest, d.sig);
            ok = err == ECDSA.RecoverError.NoError && rec == signer && signer != address(0);
        }
        if (!ok) revert BadSignature();
        h = keyRegistry.keyHashOf(d.keyType, d.key);
    }

    /// @dev ECDSA first, then ERC-1271. Unlike OZ SignatureChecker this keeps
    ///      accepting the EOA key of an EIP-7702-delegated Mera wallet (which
    ///      has code). A plain contract has no private key, so the ECDSA path
    ///      can never match it.
    function _isValidSig(address signer, bytes32 digest, bytes calldata sig) private view returns (bool) {
        if (signer == address(0)) return false;
        (address rec, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(digest, sig);
        if (err == ECDSA.RecoverError.NoError && rec == signer) return true;
        return signer.code.length != 0 && SignatureChecker.isValidERC1271SignatureNowCalldata(signer, digest, sig);
    }

    function _incPending(IdState storage st, Signer tier) private {
        uint8 n;
        if (tier == Signer.Owner) {
            n = st.pendingOwner;
            if (n >= MAX_PENDING_PER_TIER) revert TooManyPending();
            st.pendingOwner = n + 1;
        } else if (tier == Signer.OwnerDevice) {
            n = st.pendingOwnerDevice;
            if (n >= MAX_PENDING_PER_TIER) revert TooManyPending();
            st.pendingOwnerDevice = n + 1;
        } else {
            n = st.pendingRecovery;
            if (n >= MAX_PENDING_PER_TIER) revert TooManyPending();
            st.pendingRecovery = n + 1;
        }
    }

    /// @dev Deletes the op; frees its tier slot only if it is still current
    ///      (stale ops were already dropped from the counters).
    function _clear(bytes32 opId, Op memory op, Pending memory p) private {
        delete pending[opId];
        IdState storage st = idState[op.id];
        if (p.opEpoch != st.opEpoch) return;
        unchecked {
            if (op.tier == Signer.Owner) st.pendingOwner -= 1;
            else if (op.tier == Signer.OwnerDevice) st.pendingOwnerDevice -= 1;
            else st.pendingRecovery -= 1;
        }
    }

    function _invalidateOps(IdState storage st, uint64 id) private {
        uint32 e;
        unchecked {
            e = st.opEpoch + 1;
        }
        st.opEpoch = e;
        st.pendingOwner = 0;
        st.pendingOwnerDevice = 0;
        st.pendingRecovery = 0;
        emit OpsInvalidated(id, e);
    }
}
