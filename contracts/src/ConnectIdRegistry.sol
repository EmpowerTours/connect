// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

/// @title ConnectIdRegistry
/// @notice Connect ID -> owner (the member's Mera wallet) and recovery address.
///         Pure storage: every mutation comes from the gateway that deployed
///         it, which enforces signatures and the 3-day rule. No owner, no
///         upgrade path.
contract ConnectIdRegistry {
    struct Record {
        address owner;
        address recovery;
    }

    error NotGateway();
    error ZeroAddress();
    error AlreadyHasId();
    error UnknownId();
    error RecoveryIsOwner();

    event Registered(uint64 indexed id, address indexed owner, address recovery);
    event OwnerChanged(uint64 indexed id, address indexed from, address indexed to);
    event RecoveryChanged(uint64 indexed id, address indexed from, address indexed to);

    /// @notice The gateway is the deployer; it creates this registry in its constructor.
    address public immutable gateway;

    /// @notice Number of IDs issued. IDs start at 1; 0 means "no ID".
    uint64 public idCount;

    /// @notice One ID per address (owner side only).
    mapping(address owner => uint64 id) public idOf;

    mapping(uint64 id => Record) internal _records;

    constructor() {
        gateway = msg.sender;
    }

    modifier onlyGateway() {
        if (msg.sender != gateway) revert NotGateway();
        _;
    }

    function ownerOf(uint64 id) external view returns (address) {
        return _records[id].owner;
    }

    function recoveryOf(uint64 id) external view returns (address) {
        return _records[id].recovery;
    }

    function recordOf(uint64 id) external view returns (address owner, address recovery) {
        Record storage r = _records[id];
        return (r.owner, r.recovery);
    }

    function register(address owner, address recovery) external onlyGateway returns (uint64 id) {
        if (owner == address(0)) revert ZeroAddress();
        if (idOf[owner] != 0) revert AlreadyHasId();
        if (recovery == owner) revert RecoveryIsOwner();
        id = ++idCount;
        idOf[owner] = id;
        _records[id] = Record(owner, recovery);
        emit Registered(id, owner, recovery);
    }

    function setOwner(uint64 id, address to) external onlyGateway {
        Record storage r = _records[id];
        address from = r.owner;
        if (from == address(0)) revert UnknownId();
        if (to == address(0)) revert ZeroAddress();
        if (idOf[to] != 0) revert AlreadyHasId();
        if (to == r.recovery) revert RecoveryIsOwner();
        delete idOf[from];
        idOf[to] = id;
        r.owner = to;
        emit OwnerChanged(id, from, to);
    }

    /// @dev `to` may be zero (no recovery address).
    function setRecovery(uint64 id, address to) external onlyGateway {
        Record storage r = _records[id];
        if (r.owner == address(0)) revert UnknownId();
        if (to == r.owner) revert RecoveryIsOwner();
        address from = r.recovery;
        r.recovery = to;
        emit RecoveryChanged(id, from, to);
    }
}
