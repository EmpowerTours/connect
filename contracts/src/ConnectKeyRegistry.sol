// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

/// @title ConnectKeyRegistry
/// @notice Device keys per Connect ID. A device key signs everyday messages
///         (posts, reactions, follows, profile edits, attestations); keys with
///         the GUARD scope can also cancel pending changes and co-sign with
///         the owner. Key material is not stored, only its hash; the bytes are
///         emitted in {KeyAdded} for indexers.
///
///         Lifecycle: Active <-> Suspended -> Retired | Removed.
///           - Suspended: no new messages, but a GUARD key keeps its cancel and
///             co-sign powers, so a thief holding the Mera key cannot lock the
///             member out by suspending every device.
///           - Retired: the device revoked itself; past messages stay valid.
///           - Removed: past and future messages are invalid. Terminal.
///         A recovery reset may bump the ID's key epoch, which makes every
///         existing key stale at once (no loop over keys).
///
///         Pure storage: only the gateway that deployed it can mutate it.
///
///         The per-epoch add cap and the "requested by" record follow Farcaster's
///         KeyRegistry (maxKeysPerFid) and SignedKeyRequestValidator.
///         Copyright (c) 2020-2024 Merkle Manufactory and others, MIT License;
///         see THIRD_PARTY_NOTICES.md.
contract ConnectKeyRegistry {
    enum State {
        None,
        Active,
        Suspended,
        Retired,
        Removed
    }

    /// @dev One storage slot (25 bytes).
    struct Key {
        uint8 keyType;
        uint8 scope;
        State state;
        uint40 expiresAt;
        uint40 addedAt;
        uint32 epoch;
        uint64 nonce; // this device's own action nonce (device-only cancels, retire)
    }

    struct IdKeys {
        uint32 epoch;
        uint8 live; // Active + Suspended keys in the current epoch
        uint16 added; // keys added in the current epoch, including re-adds and later removed ones
    }

    uint8 public constant TYPE_P256 = 1;
    uint8 public constant TYPE_SECP256K1 = 2;

    uint8 public constant SCOPE_POST = 1;
    uint8 public constant SCOPE_REACT = 2;
    uint8 public constant SCOPE_FOLLOW = 4;
    uint8 public constant SCOPE_PROFILE = 8;
    uint8 public constant SCOPE_ATTEST = 16;
    uint8 public constant SCOPE_GUARD = 32;
    uint8 public constant SCOPE_ALL = 63;

    uint8 public constant MAX_LIVE_KEYS = 20;
    /// @notice Bounds the KeyAdded events (indexer work) one ID can cause per key
    ///         epoch. A recovery reset starts a new epoch, so a thief cannot use up
    ///         the cap for good.
    uint16 public constant MAX_KEYS_PER_EPOCH = 1000;
    uint256 public constant MAX_KEY_LIFETIME = 730 days;

    error NotGateway();
    error BadKey();
    error BadScope();
    error BadExpiry();
    error KeyExists();
    error TooManyKeys();
    error WrongState();

    event KeyAdded(
        uint64 indexed id, bytes32 indexed keyHash, uint8 keyType, uint8 scope, uint40 expiresAt, bytes key
    );
    /// @notice Emitted with {KeyAdded} when the key was added at the signed
    ///         request of another Connect ID (an app or mini app).
    event KeyRequested(uint64 indexed id, bytes32 indexed keyHash, uint64 indexed requestedBy);
    event KeySuspended(uint64 indexed id, bytes32 indexed keyHash);
    event KeyUnsuspended(uint64 indexed id, bytes32 indexed keyHash);
    event KeyRetired(uint64 indexed id, bytes32 indexed keyHash);
    event KeyRemoved(uint64 indexed id, bytes32 indexed keyHash);
    event KeysReset(uint64 indexed id, uint32 epoch);

    address public immutable gateway;

    mapping(uint64 id => mapping(bytes32 keyHash => Key)) internal _keys;
    mapping(uint64 id => IdKeys) public idKeys;
    /// @notice Connect ID of the app that requested the key at its latest add; 0 if none.
    mapping(uint64 id => mapping(bytes32 keyHash => uint64 requestedBy)) public requestedByOf;

    constructor() {
        gateway = msg.sender;
    }

    modifier onlyGateway() {
        if (msg.sender != gateway) revert NotGateway();
        _;
    }

    // ---------------------------------------------------------------- views

    /// @notice P-256 keys are abi.encode(x, y) (64 bytes); secp256k1 keys are
    ///         abi.encode(address) (32 bytes).
    function keyHashOf(uint8 keyType, bytes memory key) public pure returns (bytes32) {
        return keccak256(abi.encode(keyType, key));
    }

    /// @notice Format check for key bytes. Does not check curve membership for
    ///         P-256 (signature verification rejects invalid points).
    function isWellFormed(uint8 keyType, bytes memory key) public pure returns (bool) {
        if (keyType == TYPE_P256) return key.length == 64;
        if (keyType == TYPE_SECP256K1) {
            if (key.length != 32) return false;
            uint256 word = abi.decode(key, (uint256));
            return word != 0 && word >> 160 == 0;
        }
        return false;
    }

    /// @notice Raw record plus whether it belongs to the current key epoch.
    function keyOf(uint64 id, bytes32 keyHash) external view returns (Key memory k, bool current) {
        k = _keys[id][keyHash];
        current = k.state != State.None && k.epoch == idKeys[id].epoch;
    }

    /// @notice Nonce for actions signed by this device alone.
    function nonceOf(uint64 id, bytes32 keyHash) external view returns (uint64) {
        return _keys[id][keyHash].nonce;
    }

    /// @notice Effective state: stale (pre-reset) keys report Suspended.
    function stateOf(uint64 id, bytes32 keyHash) external view returns (State) {
        Key storage k = _keys[id][keyHash];
        State s = k.state;
        if (s == State.Active && k.epoch != idKeys[id].epoch) return State.Suspended;
        return s;
    }

    /// @notice True if the key may sign new messages needing every bit in `scopeBits`.
    function canSign(uint64 id, bytes32 keyHash, uint8 scopeBits) external view returns (bool) {
        Key storage k = _keys[id][keyHash];
        return k.state == State.Active && k.epoch == idKeys[id].epoch && k.expiresAt > block.timestamp
            && k.scope & scopeBits == scopeBits;
    }

    /// @notice GUARD power: cancel pending changes and co-sign with the owner.
    ///         Survives suspension; lost on retire, remove, expiry or reset.
    function hasGuardPower(uint64 id, bytes32 keyHash) external view returns (bool) {
        Key storage k = _keys[id][keyHash];
        State s = k.state;
        return (s == State.Active || s == State.Suspended) && k.epoch == idKeys[id].epoch
            && k.expiresAt > block.timestamp && k.scope & SCOPE_GUARD != 0;
    }

    /// @notice Current-epoch key that is Active or Suspended (expiry ignored).
    function isLive(uint64 id, bytes32 keyHash) external view returns (bool) {
        Key storage k = _keys[id][keyHash];
        State s = k.state;
        return (s == State.Active || s == State.Suspended) && k.epoch == idKeys[id].epoch;
    }

    /// @notice Validates parameters for a future {add}; reverts with the same errors.
    function checkAdd(uint64 id, uint8 keyType, bytes memory key, uint8 scope, uint40 expiresAt)
        public
        view
        returns (bytes32 keyHash)
    {
        if (!isWellFormed(keyType, key)) revert BadKey();
        if (scope == 0 || scope & ~SCOPE_ALL != 0) revert BadScope();
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + MAX_KEY_LIFETIME) revert BadExpiry();
        keyHash = keyHashOf(keyType, key);
        Key storage k = _keys[id][keyHash];
        // A key can be re-added only if it is stale from before a reset and
        // was never retired or removed (those are permanent for this ID).
        if (k.state != State.None) {
            bool stale = k.epoch != idKeys[id].epoch;
            if (!stale || k.state == State.Retired || k.state == State.Removed) revert KeyExists();
        }
        IdKeys storage ik = idKeys[id];
        if (ik.live >= MAX_LIVE_KEYS || ik.added >= MAX_KEYS_PER_EPOCH) revert TooManyKeys();
    }

    // ------------------------------------------------------------ mutations

    /// @param requestedBy Connect ID whose signed key request the gateway checked; 0 if none.
    function add(uint64 id, uint8 keyType, bytes calldata key, uint8 scope, uint40 expiresAt, uint64 requestedBy)
        external
        onlyGateway
    {
        bytes32 keyHash = checkAdd(id, keyType, key, scope, expiresAt);
        IdKeys storage ik = idKeys[id];
        Key storage k = _keys[id][keyHash];
        // A re-added (stale) key keeps its nonce so its old signatures can't be replayed.
        _keys[id][keyHash] = Key({
            keyType: keyType,
            scope: scope,
            state: State.Active,
            expiresAt: expiresAt,
            addedAt: uint40(block.timestamp),
            epoch: ik.epoch,
            nonce: k.nonce
        });
        unchecked {
            ik.live += 1;
            ik.added += 1;
        }
        if (requestedByOf[id][keyHash] != requestedBy) requestedByOf[id][keyHash] = requestedBy;
        emit KeyAdded(id, keyHash, keyType, scope, expiresAt, key);
        if (requestedBy != 0) emit KeyRequested(id, keyHash, requestedBy);
    }

    function suspend(uint64 id, bytes32 keyHash) external onlyGateway {
        Key storage k = _current(id, keyHash);
        if (k.state != State.Active) revert WrongState();
        k.state = State.Suspended;
        emit KeySuspended(id, keyHash);
    }

    function unsuspend(uint64 id, bytes32 keyHash) external onlyGateway {
        Key storage k = _current(id, keyHash);
        if (k.state != State.Suspended) revert WrongState();
        k.state = State.Active;
        emit KeyUnsuspended(id, keyHash);
    }

    function retire(uint64 id, bytes32 keyHash) external onlyGateway {
        Key storage k = _current(id, keyHash);
        if (k.state != State.Active && k.state != State.Suspended) revert WrongState();
        k.state = State.Retired;
        unchecked {
            idKeys[id].live -= 1;
        }
        emit KeyRetired(id, keyHash);
    }

    /// @dev Works on stale and retired keys too: removal is how a member says
    ///      "messages from this key were never mine".
    function remove(uint64 id, bytes32 keyHash) external onlyGateway {
        Key storage k = _keys[id][keyHash];
        State s = k.state;
        if (s == State.None || s == State.Removed) revert WrongState();
        if ((s == State.Active || s == State.Suspended) && k.epoch == idKeys[id].epoch) {
            unchecked {
                idKeys[id].live -= 1;
            }
        }
        k.state = State.Removed;
        emit KeyRemoved(id, keyHash);
    }

    /// @notice Returns and consumes the device's nonce.
    function useNonce(uint64 id, bytes32 keyHash) external onlyGateway returns (uint64 n) {
        Key storage k = _keys[id][keyHash];
        n = k.nonce;
        unchecked {
            k.nonce = n + 1;
        }
    }

    /// @notice Makes every key of `id` stale in O(1).
    function resetKeys(uint64 id) external onlyGateway {
        IdKeys storage ik = idKeys[id];
        uint32 epoch;
        unchecked {
            epoch = ik.epoch + 1;
        }
        ik.epoch = epoch;
        ik.live = 0;
        ik.added = 0;
        emit KeysReset(id, epoch);
    }

    function _current(uint64 id, bytes32 keyHash) private view returns (Key storage k) {
        k = _keys[id][keyHash];
        if (k.state == State.None || k.epoch != idKeys[id].epoch) revert WrongState();
    }
}
