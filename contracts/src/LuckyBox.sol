// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {AvatarNFT} from "./AvatarNFT.sol";
import {Payment} from "./lib/Payment.sol";
import {IVRFConsumerV2Plus, IVRFCoordinatorV2Plus, VRFV2PlusClient} from "./vrf/VRFV2Plus.sol";

/// @title LuckyBox
/// @notice Venda de caixas que sorteiam um Smartcityano (doc 07 §2.3, doc 02 §2). Cada tier tem moeda, preço e
/// a tabela de probabilidades por raridade, pública on-chain. `open` cobra, pede um número ao Chainlink VRF e
/// guarda a tabela daquele momento; o callback sorteia raridade e profissão e minta o avatar.
/// Moeda (ADR-0014): BNB ou stablecoin no lançamento; SCITY depois do TGE. Depende do parecer jurídico (E0.8).
contract LuckyBox is AccessControl, Pausable, ReentrancyGuard, IVRFConsumerV2Plus {
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint8 public constant RARITY_COUNT = 4;
    uint16 public constant WEIGHT_TOTAL = 10_000;

    struct Tier {
        address currency;
        uint256 price;
        /// @dev Probabilidade de cada raridade em pontos-base (soma 10.000): Comum, Raro, Épico, Lendário.
        uint16[4] weights;
        bool active;
    }

    struct VrfConfig {
        IVRFCoordinatorV2Plus coordinator;
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        bool nativePayment;
    }

    struct Request {
        address buyer;
        uint32 tier;
        bool fulfilled;
        uint16[4] weights;
    }

    AvatarNFT public immutable avatar;
    address public treasury;
    VrfConfig public vrf;

    mapping(uint32 tierId => Tier) private tiers;
    mapping(uint8 rarity => bytes32[]) private professions;
    mapping(uint256 requestId => Request) private requests;

    event TierSet(uint32 indexed tierId, address currency, uint256 price, uint16[4] weights, bool active);
    event ProfessionsSet(uint8 indexed rarity, bytes32[] professions);
    event BoxOpened(uint256 indexed requestId, address indexed buyer, uint32 indexed tierId);
    event AvatarRevealed(
        uint256 indexed requestId, address indexed buyer, uint256 tokenId, uint8 rarity, bytes32 profession
    );
    event TreasuryChanged(address treasury);
    event VrfChanged(address coordinator, bytes32 keyHash, uint256 subId);

    error TierInactive(uint32 tierId);
    error WeightsMustSum(uint256 sum);
    error NoProfessions(uint8 rarity);
    error InvalidRarity(uint8 rarity);
    error OnlyCoordinator(address caller);
    error UnknownRequest(uint256 requestId);
    error AlreadyFulfilled(uint256 requestId);
    error ZeroAddress();

    constructor(address admin, AvatarNFT avatar_, address treasury_, VrfConfig memory vrf_) {
        if (admin == address(0) || treasury_ == address(0) || address(vrf_.coordinator) == address(0)) {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        avatar = avatar_;
        treasury = treasury_;
        vrf = vrf_;
    }

    // ---------------------------------------------------------------- compra e sorteio

    /// @notice Abre uma caixa do tier. Cobra na hora; o avatar chega no callback do VRF.
    function open(uint32 tierId) external payable nonReentrant whenNotPaused returns (uint256 requestId) {
        Tier storage t = tiers[tierId];
        if (!t.active) revert TierInactive(tierId);
        // Uma raridade sorteável sem profissão travaria o callback: confere antes de cobrar.
        for (uint8 r; r < RARITY_COUNT; ++r) {
            // forge-lint: disable-next-line(require-revert-in-loop)
            if (t.weights[r] > 0 && professions[r].length == 0) revert NoProfessions(r);
        }

        Payment.collect(t.currency, t.price, msg.sender, treasury);

        VrfConfig memory c = vrf;
        requestId = c.coordinator
            .requestRandomWords(
                VRFV2PlusClient.RandomWordsRequest({
                    keyHash: c.keyHash,
                    subId: c.subId,
                    requestConfirmations: c.requestConfirmations,
                    callbackGasLimit: c.callbackGasLimit,
                    numWords: 1,
                    extraArgs: VRFV2PlusClient.argsToBytes(
                        VRFV2PlusClient.ExtraArgsV1({nativePayment: c.nativePayment})
                    )
                })
            );
        requests[requestId] = Request({buyer: msg.sender, tier: tierId, fulfilled: false, weights: t.weights});
        // O id do pedido vem do coordenador, então o evento só pode sair depois da chamada.
        // forge-lint: disable-next-line(reentrancy-events)
        emit BoxOpened(requestId, msg.sender, tierId);
    }

    /// @inheritdoc IVRFConsumerV2Plus
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external override {
        if (msg.sender != address(vrf.coordinator)) revert OnlyCoordinator(msg.sender);
        Request storage req = requests[requestId];
        if (req.buyer == address(0)) revert UnknownRequest(requestId);
        if (req.fulfilled) revert AlreadyFulfilled(requestId);
        req.fulfilled = true;

        uint256 word = randomWords[0];
        uint8 rarity = pickRarity(req.weights, uint256(keccak256(abi.encode(word, 0))));
        bytes32[] storage list = professions[rarity];
        bytes32 profession = list[uint256(keccak256(abi.encode(word, 1))) % list.length];

        uint256 tokenId = avatar.mint(req.buyer, rarity, profession);
        // O tokenId vem do AvatarNFT (contrato do projeto, sem callback ao comprador).
        // forge-lint: disable-next-line(reentrancy-events)
        emit AvatarRevealed(requestId, req.buyer, tokenId, rarity, profession);
    }

    /// @notice Raridade sorteada: o número cai numa das faixas acumuladas da tabela.
    function pickRarity(uint16[4] memory weights, uint256 random) public pure returns (uint8) {
        uint256 roll = random % WEIGHT_TOTAL;
        uint256 acc = 0;
        for (uint8 r; r < RARITY_COUNT; ++r) {
            acc += weights[r];
            if (roll < acc) return r;
        }
        // Inalcançável com soma 10.000 (conferida em setTier).
        return RARITY_COUNT - 1;
    }

    // ---------------------------------------------------------------- leitura

    function tierOf(uint32 tierId) external view returns (Tier memory) {
        return tiers[tierId];
    }

    function professionsOf(uint8 rarity) external view returns (bytes32[] memory) {
        return professions[rarity];
    }

    function vrfConfig() external view returns (VrfConfig memory) {
        return vrf;
    }

    function requestOf(uint256 requestId) external view returns (Request memory) {
        return requests[requestId];
    }

    // ---------------------------------------------------------------- administração

    function setTier(uint32 tierId, address currency, uint256 price, uint16[4] calldata weights, bool active)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        uint256 sum = 0;
        for (uint8 r; r < RARITY_COUNT; ++r) {
            sum += weights[r];
        }
        if (sum != WEIGHT_TOTAL) revert WeightsMustSum(sum);
        tiers[tierId] = Tier(currency, price, weights, active);
        emit TierSet(tierId, currency, price, weights, active);
    }

    function setProfessions(uint8 rarity, bytes32[] calldata list) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (rarity >= RARITY_COUNT) revert InvalidRarity(rarity);
        if (list.length == 0) revert NoProfessions(rarity);
        professions[rarity] = list;
        emit ProfessionsSet(rarity, list);
    }

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryChanged(treasury_);
    }

    /// @notice Depois da troca, o coordenador antigo não consegue mais entregar os pedidos pendentes:
    /// troque só sem caixas abertas esperando o sorteio.
    function setVrf(VrfConfig calldata vrf_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(vrf_.coordinator) == address(0)) revert ZeroAddress();
        vrf = vrf_;
        emit VrfChanged(address(vrf_.coordinator), vrf_.keyHash, vrf_.subId);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
