// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";

import {AvatarNFT} from "../src/AvatarNFT.sol";
import {BuildingNFT} from "../src/BuildingNFT.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {GameVault} from "../src/GameVault.sol";
import {LandNFT} from "../src/LandNFT.sol";
import {LuckyBox} from "../src/LuckyBox.sol";
import {Marketplace} from "../src/Marketplace.sol";
import {PropertyNFT} from "../src/PropertyNFT.sol";
import {SCityToken} from "../src/SCityToken.sol";
import {LocalDexPool, LocalUSD} from "../src/dev/LocalDexPool.sol";
import {LocalVRFCoordinator} from "../src/dev/LocalVRFCoordinator.sol";
import {IVRFCoordinatorV2Plus} from "../src/vrf/VRFV2Plus.sol";

/// @notice Sobe os contratos da Etapa 2 no anvil (rede local, chain 31337) e grava os endereços em
/// `deployments/anvil.json`. Só para desenvolvimento: usa o coordenador VRF local e a conta do anvil.
///
///   anvil
///   forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
///     --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
///
/// Variáveis opcionais: `WORLD_SIGNER` (quem assina as cotações de lote; padrão: o próprio deployer).
contract DeployLocal is Script {
    string constant PROFESSIONS = "../cms-strapi/seed/profissoes.json";
    string[4] RARITIES = ["common", "rare", "epic", "legendary"];

    /// Lê o seed item a item: o filtro JSONPath do forge não devolve listas.
    function _professionsByRarity(string memory catalog) internal view returns (bytes32[][4] memory out) {
        uint256 n;
        while (vm.keyExistsJson(catalog, string.concat("$[", vm.toString(n), "]"))) n++;
        uint256[4] memory counts;
        bytes32[] memory codes = new bytes32[](n);
        uint8[] memory rarities = new uint8[](n);
        for (uint256 i; i < n; ++i) {
            string memory at = string.concat("$[", vm.toString(i), "]");
            codes[i] = bytes32(bytes(vm.parseJsonString(catalog, string.concat(at, ".code"))));
            bytes32 rarity = keccak256(bytes(vm.parseJsonString(catalog, string.concat(at, ".rarity"))));
            for (uint8 r; r < 4; ++r) {
                if (rarity == keccak256(bytes(RARITIES[r]))) {
                    rarities[i] = r;
                    counts[r]++;
                }
            }
        }
        for (uint8 r; r < 4; ++r) {
            out[r] = new bytes32[](counts[r]);
            uint256 k;
            for (uint256 i; i < n; ++i) {
                if (rarities[i] == r) out[r][k++] = codes[i];
            }
        }
    }

    address localUsd;
    address localDexPool;
    address marketplace;
    address timelock;

    /// Mercado secundário (E3.6): SCITY, taxa de 2,5% para a tesouraria (aqui, o deployer), lote, imóvel e avatar.
    function _deployMarket(address scity, address deployer, address land, address property, address avatar)
        internal
    {
        Marketplace m = Marketplace(
            address(
                new ERC1967Proxy(
                    address(new Marketplace()),
                    abi.encodeCall(
                        Marketplace.initialize, (deployer, timelock, SCityToken(scity), deployer, 250)
                    )
                )
            )
        );
        m.setCollection(land, true);
        m.setCollection(property, true);
        m.setCollection(avatar, true);
        marketplace = address(m);
    }

    function _deployTimelock(address deployer) internal returns (address) {
        address[] memory proposers = new address[](1);
        proposers[0] = deployer;
        return address(new TimelockController(0, proposers, proposers, address(0)));
    }

    /// Fora do `run` para não estourar a pilha.
    function _deployDex(address scity, address deployer) internal {
        localUsd = address(new LocalUSD(deployer));
        localDexPool = address(new LocalDexPool(scity, localUsd, 0));
    }

    function run() external {
        require(block.chainid == 31_337, "DeployLocal so roda no anvil (31337)");
        address deployer = msg.sender;
        address worldSigner = vm.envOr("WORLD_SIGNER", deployer);
        string memory catalog = vm.readFile(PROFESSIONS);

        vm.startBroadcast(deployer);

        SCityToken scity = new SCityToken(deployer);
        LandNFT land = new LandNFT(deployer, deployer, "http://localhost:4003/v1/world/nft/lots/");
        land.grantRole(land.SIGNER_ROLE(), worldSigner);

        AvatarNFT avatar = new AvatarNFT(deployer, deployer, 250, "http://localhost:4002/v1/nft/avatars/");
        LocalVRFCoordinator vrf = new LocalVRFCoordinator();
        LuckyBox box = new LuckyBox(
            deployer,
            avatar,
            deployer,
            LuckyBox.VrfConfig({
                coordinator: IVRFCoordinatorV2Plus(address(vrf)),
                keyHash: bytes32(0),
                subId: 0,
                requestConfirmations: 1,
                callbackGasLimit: 300_000,
                nativePayment: false
            })
        );
        avatar.grantRole(avatar.MINTER_ROLE(), address(box));

        // Profissões do catálogo (mesmo seed do Strapi), por raridade.
        bytes32[][4] memory byRarity = _professionsByRarity(catalog);
        for (uint8 r; r < 4; ++r) {
            box.setProfessions(r, byRarity[r]);
        }
        // Tier de teste em BNB do anvil. Probabilidades PROVISÓRIAS (as fatias do simulador): a tabela do
        // whitepaper não está nas fontes (doc 02 §2).
        box.setTier(1, address(0), 0.05 ether, [uint16(4000), 3000, 2000, 1000], true);

        // Por último, para os endereços de antes não mudarem num anvil novo.
        BuildingNFT buildingNft =
            new BuildingNFT(deployer, land, "http://localhost:8030/v1/world/nft/buildings/");
        buildingNft.grantRole(buildingNft.SIGNER_ROLE(), worldSigner);
        PropertyNFT propertyNft =
            new PropertyNFT(deployer, land, "http://localhost:8030/v1/world/nft/properties/");
        propertyNft.grantRole(propertyNft.SIGNER_ROLE(), worldSigner);
        // Cofre: limites de partida (PREMISSA) e uma reserva para os saques. No MVP local, o mesmo signer.
        // Upgrades só pelo timelock (doc 07 §5). No anvil, atraso 0 e o deployer propõe e executa; na mainnet,
        // 48 h e o multisig 3-de-5.
        timelock = _deployTimelock(deployer);
        GameVault vault = GameVault(
            address(
                new ERC1967Proxy(
                    address(new GameVault()),
                    abi.encodeCall(
                        GameVault.initialize, (deployer, timelock, scity, 1_000_000 ether, 10_000 ether)
                    )
                )
            )
        );
        vault.grantRole(vault.SIGNER_ROLE(), worldSigner);
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        scity.transfer(address(vault), 1_000_000 ether);
        // Par SCITY/dólar de teste para o TWAP do câmbio, a US$ 1 (tick 0). Depois do cofre, pelo mesmo motivo.
        _deployDex(address(scity), deployer);
        // Por último, para os endereços de antes não mudarem.
        _deployMarket(address(scity), deployer, address(land), address(propertyNft), address(avatar));

        vm.stopBroadcast();

        string memory key = "anvil";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "SCityToken", address(scity));
        vm.serializeAddress(key, "LandNFT", address(land));
        vm.serializeAddress(key, "AvatarNFT", address(avatar));
        vm.serializeAddress(key, "LuckyBox", address(box));
        vm.serializeAddress(key, "LocalVRFCoordinator", address(vrf));
        vm.serializeAddress(key, "BuildingNFT", address(buildingNft));
        vm.serializeAddress(key, "PropertyNFT", address(propertyNft));
        vm.serializeAddress(key, "GameVault", address(vault));
        vm.serializeAddress(key, "LocalUSD", localUsd);
        vm.serializeAddress(key, "LocalDexPool", localDexPool);
        vm.serializeAddress(key, "Marketplace", marketplace);
        vm.serializeAddress(key, "Timelock", timelock);
        string memory json = vm.serializeAddress(key, "worldSigner", worldSigner);
        vm.writeJson(json, "deployments/anvil.json");

        console.log("LandNFT  ", address(land));
        console.log("LuckyBox ", address(box));
        console.log("Enderecos em deployments/anvil.json");
    }
}
