// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title GameVault
/// @notice Cofre do SCITY entre a carteira e o jogo (doc 07 §2.4, doc 05 §4).
/// - Depósito: o jogador chama `deposit`; o contrato guarda o SCITY e emite `Deposited`. O chain-indexer espera as
///   confirmações e credita o saldo no ledger do jogo uma vez só, pela transação e pelo log.
/// - Saque: o servidor debita o saldo no ledger, aplica limites e assina um voucher EIP-712; a carteira resgata
///   com `claim`. Cada nonce vale uma vez.
/// - Circuit breaker: limite de saque por dia, no total e por endereço. Passou do limite, o `claim` reverte e o
///   voucher pode ser resgatado no dia seguinte (o prazo do voucher manda).
/// MVP: contrato sem proxy. A ADR de upgrade (UUPS atrás de timelock, doc 07 §5) entra antes da mainnet.
contract GameVault is EIP712, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    bytes32 public constant WITHDRAWAL_TYPEHASH =
        keccak256("Withdrawal(address to,uint256 amount,uint256 nonce,uint256 deadline)");

    struct Withdrawal {
        address to;
        uint256 amount;
        uint256 nonce;
        uint256 deadline;
    }

    IERC20 public immutable token;
    /// @notice Teto de saque por dia (UTC), somando todos os endereços.
    uint256 public dailyLimit;
    /// @notice Teto de saque por dia para um endereço.
    uint256 public dailyLimitPerAddress;

    mapping(uint256 nonce => bool) public nonceUsed;
    mapping(uint256 day => uint256) public withdrawnOn;
    mapping(uint256 day => mapping(address => uint256)) public withdrawnBy;

    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount, uint256 indexed nonce);
    event LimitsChanged(uint256 dailyLimit, uint256 dailyLimitPerAddress);

    error ZeroAddress();
    error ZeroAmount();
    error VoucherExpired();
    error NonceAlreadyUsed();
    error InvalidSigner(address recovered);
    error NotRecipient();
    error DailyLimitExceeded(uint256 available);
    error AddressLimitExceeded(uint256 available);

    constructor(address admin, IERC20 token_, uint256 dailyLimit_, uint256 dailyLimitPerAddress_)
        EIP712("SCC GameVault", "1")
    {
        if (admin == address(0) || address(token_) == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        token = token_;
        dailyLimit = dailyLimit_;
        dailyLimitPerAddress = dailyLimitPerAddress_;
        emit LimitsChanged(dailyLimit_, dailyLimitPerAddress_);
    }

    /// @notice Deposita SCITY no jogo. Antes, a carteira aprova o cofre no token (ou usa permit).
    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        // forge-lint: disable-next-line(reentrancy-events)
        emit Deposited(msg.sender, amount);
    }

    /// @notice Hash EIP-712 do voucher que o servidor assina.
    function withdrawalDigest(Withdrawal calldata w) public view returns (bytes32) {
        return
            _hashTypedDataV4(keccak256(abi.encode(WITHDRAWAL_TYPEHASH, w.to, w.amount, w.nonce, w.deadline)));
    }

    /// @notice Resgata o saque assinado pelo servidor. Só o destinatário chama.
    function claim(Withdrawal calldata w, bytes calldata signature) external nonReentrant whenNotPaused {
        if (msg.sender != w.to) revert NotRecipient();
        if (w.amount == 0) revert ZeroAmount();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > w.deadline) revert VoucherExpired();
        if (nonceUsed[w.nonce]) revert NonceAlreadyUsed();
        address signer = ECDSA.recover(withdrawalDigest(w), signature);
        if (!hasRole(SIGNER_ROLE, signer)) revert InvalidSigner(signer);

        uint256 day = block.timestamp / 1 days;
        uint256 total = withdrawnOn[day] + w.amount;
        if (total > dailyLimit) revert DailyLimitExceeded(dailyLimit - withdrawnOn[day]);
        uint256 mine = withdrawnBy[day][w.to] + w.amount;
        if (mine > dailyLimitPerAddress) {
            revert AddressLimitExceeded(dailyLimitPerAddress - withdrawnBy[day][w.to]);
        }

        nonceUsed[w.nonce] = true;
        withdrawnOn[day] = total;
        withdrawnBy[day][w.to] = mine;
        token.safeTransfer(w.to, w.amount);
        // forge-lint: disable-next-line(reentrancy-events)
        emit Withdrawn(w.to, w.amount, w.nonce);
    }

    /// @notice Muda os tetos de saque. Na mainnet, o admin é o multisig atrás do timelock (doc 07 §3).
    function setLimits(uint256 dailyLimit_, uint256 dailyLimitPerAddress_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        dailyLimit = dailyLimit_;
        dailyLimitPerAddress = dailyLimitPerAddress_;
        emit LimitsChanged(dailyLimit_, dailyLimitPerAddress_);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
