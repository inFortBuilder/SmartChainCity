// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AvatarNFT} from "../src/AvatarNFT.sol";
import {BuildingNFT} from "../src/BuildingNFT.sol";
import {GameVault} from "../src/GameVault.sol";
import {LandNFT} from "../src/LandNFT.sol";
import {LuckyBox} from "../src/LuckyBox.sol";
import {Marketplace} from "../src/Marketplace.sol";
import {PropertyNFT} from "../src/PropertyNFT.sol";
import {SCityToken} from "../src/SCityToken.sol";
import {IVRFCoordinatorV2Plus} from "../src/vrf/VRFV2Plus.sol";
import {CatalogReader} from "./CatalogReader.sol";

/// @notice Deploy na BNB Smart Chain (56) ou na testnet (97), com os papéis finais do doc 07 §3:
/// - `DEFAULT_ADMIN_ROLE` de todos e `UPGRADER_ROLE` do cofre e do mercado: o `TimelockController`
///   (atraso ≥ 48 h na mainnet), com o multisig 3-de-5 propondo e executando e sem admin próprio;
/// - `PAUSER_ROLE`: o multisig 2-de-3, para a pausa imediata num incidente;
/// - `SIGNER_ROLE`: a chave do backend no KMS;
/// - `MINTER_ROLE` do AvatarNFT: a LuckyBox.
/// O deployer configura tudo e **sai sem papel nenhum**: o script confere no fim e reverte se sobrar algum.
///
///   DEPLOY_CONFIG=deploy/bsc-testnet.json forge script script/DeployMainnet.s.sol \
///     --rpc-url $BSC_TESTNET_RPC --broadcast --verify --ledger   (ou --account, nunca a chave na linha)
///
/// Na mainnet (56) também precisa de CONFIRM_MAINNET=sim. Endereços em `deployments/<chainId>.json`.
contract DeployMainnet is CatalogReader {
    uint256 constant MIN_MAINNET_DELAY = 48 hours;

    struct Config {
        address adminMultisig; // 3-de-5: propõe e executa no timelock
        address pauserMultisig; // 2-de-3: pausa imediata
        address signer; // chave do backend no KMS
        address treasury; // recebe taxas, vendas de lote e caixas, royalties
        address scity; // token já criado (TGE); zero cria aqui com o suprimento para tokenRecipient
        address tokenRecipient;
        uint256 timelockDelay;
        uint96 avatarRoyaltyBps;
        uint16 marketFeeBps;
        uint256 vaultDailyLimit;
        uint256 vaultDailyLimitPerAddress;
        string landBaseURI;
        string avatarBaseURI;
        string propertyBaseURI;
        string buildingBaseURI;
        LuckyBox.VrfConfig vrf;
        // Tier 1 da caixa (moeda zero = BNB). Probabilidades em pontos-base, somando 10.000.
        address tierCurrency;
        uint256 tierPrice;
        uint16[4] tierWeights;
    }

    struct Deployed {
        address scity;
        address timelock;
        address land;
        address avatar;
        address luckyBox;
        address property;
        address building;
        address vault;
        address vaultImpl;
        address market;
        address marketImpl;
    }

    function run() external returns (Deployed memory d) {
        require(
            block.chainid == 56 || block.chainid == 97, "DeployMainnet: so na BSC (56) ou na testnet (97)"
        );
        if (block.chainid == 56) {
            require(
                keccak256(bytes(vm.envOr("CONFIRM_MAINNET", string("")))) == keccak256("sim"),
                "DeployMainnet: defina CONFIRM_MAINNET=sim"
            );
        }
        Config memory c = loadConfig(vm.readFile(vm.envString("DEPLOY_CONFIG")));
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        d = deploy(c, deployer, vm.readFile(PROFESSIONS));
        vm.stopBroadcast();
        _write(d);
    }

    function loadConfig(string memory json) public pure returns (Config memory c) {
        c.adminMultisig = vm.parseJsonAddress(json, ".adminMultisig");
        c.pauserMultisig = vm.parseJsonAddress(json, ".pauserMultisig");
        c.signer = vm.parseJsonAddress(json, ".signer");
        c.treasury = vm.parseJsonAddress(json, ".treasury");
        c.scity = vm.parseJsonAddress(json, ".scity");
        c.tokenRecipient = vm.parseJsonAddress(json, ".tokenRecipient");
        c.timelockDelay = vm.parseJsonUint(json, ".timelockDelaySeconds");
        c.avatarRoyaltyBps = uint96(vm.parseJsonUint(json, ".avatarRoyaltyBps"));
        c.marketFeeBps = uint16(vm.parseJsonUint(json, ".marketFeeBps"));
        c.vaultDailyLimit = vm.parseJsonUint(json, ".vaultDailyLimitWei");
        c.vaultDailyLimitPerAddress = vm.parseJsonUint(json, ".vaultDailyLimitPerAddressWei");
        c.landBaseURI = vm.parseJsonString(json, ".baseURIs.land");
        c.avatarBaseURI = vm.parseJsonString(json, ".baseURIs.avatar");
        c.propertyBaseURI = vm.parseJsonString(json, ".baseURIs.property");
        c.buildingBaseURI = vm.parseJsonString(json, ".baseURIs.building");
        c.vrf = LuckyBox.VrfConfig({
            coordinator: IVRFCoordinatorV2Plus(vm.parseJsonAddress(json, ".vrf.coordinator")),
            keyHash: vm.parseJsonBytes32(json, ".vrf.keyHash"),
            subId: vm.parseJsonUint(json, ".vrf.subId"),
            requestConfirmations: uint16(vm.parseJsonUint(json, ".vrf.requestConfirmations")),
            callbackGasLimit: uint32(vm.parseJsonUint(json, ".vrf.callbackGasLimit")),
            nativePayment: vm.parseJsonBool(json, ".vrf.nativePayment")
        });
        c.tierCurrency = vm.parseJsonAddress(json, ".luckyBoxTier1.currency");
        c.tierPrice = vm.parseJsonUint(json, ".luckyBoxTier1.priceWei");
        uint256[] memory w = vm.parseJsonUintArray(json, ".luckyBoxTier1.weights");
        require(w.length == 4, "DeployMainnet: weights precisa de 4 valores");
        for (uint256 i; i < 4; ++i) {
            c.tierWeights[i] = uint16(w[i]);
        }
    }

    /// @notice Faz o deploy e a configuração com `deployer` como admin provisório e entrega os papéis finais.
    function deploy(Config memory c, address deployer, string memory catalog)
        public
        returns (Deployed memory d)
    {
        _validate(c, deployer);

        d.scity = c.scity == address(0) ? address(new SCityToken(c.tokenRecipient)) : c.scity;
        d.timelock = _timelock(c);

        LandNFT land = new LandNFT(deployer, c.treasury, c.landBaseURI);
        AvatarNFT avatar = new AvatarNFT(deployer, c.treasury, c.avatarRoyaltyBps, c.avatarBaseURI);
        LuckyBox box = new LuckyBox(deployer, avatar, c.treasury, c.vrf);
        PropertyNFT property = new PropertyNFT(deployer, land, c.propertyBaseURI);
        BuildingNFT building = new BuildingNFT(deployer, land, c.buildingBaseURI);
        d.land = address(land);
        d.avatar = address(avatar);
        d.luckyBox = address(box);
        d.property = address(property);
        d.building = address(building);

        d.vaultImpl = address(new GameVault());
        d.vault = address(
            new ERC1967Proxy(
                d.vaultImpl,
                abi.encodeCall(
                    GameVault.initialize,
                    (deployer, d.timelock, IERC20(d.scity), c.vaultDailyLimit, c.vaultDailyLimitPerAddress)
                )
            )
        );
        d.marketImpl = address(new Marketplace());
        d.market = address(
            new ERC1967Proxy(
                d.marketImpl,
                abi.encodeCall(
                    Marketplace.initialize,
                    (deployer, d.timelock, IERC20(d.scity), c.treasury, c.marketFeeBps)
                )
            )
        );

        // Configuração enquanto o deployer ainda é admin.
        avatar.grantRole(avatar.MINTER_ROLE(), d.luckyBox);
        bytes32[][4] memory byRarity = _professionsByRarity(catalog);
        for (uint8 r; r < 4; ++r) {
            box.setProfessions(r, byRarity[r]);
        }
        box.setTier(1, c.tierCurrency, c.tierPrice, c.tierWeights, true);
        Marketplace(d.market).setCollection(d.land, true);
        Marketplace(d.market).setCollection(d.property, true);
        Marketplace(d.market).setCollection(d.avatar, true);
        land.grantRole(land.SIGNER_ROLE(), c.signer);
        property.grantRole(property.SIGNER_ROLE(), c.signer);
        building.grantRole(building.SIGNER_ROLE(), c.signer);
        GameVault(d.vault).grantRole(GameVault(d.vault).SIGNER_ROLE(), c.signer);

        // Entrega: pausa ao multisig 2-de-3, admin ao timelock, e o deployer sai de tudo.
        address[7] memory all = [d.land, d.avatar, d.luckyBox, d.property, d.building, d.vault, d.market];
        for (uint256 i; i < all.length; ++i) {
            _handOver(IAccessControl(all[i]), deployer, d.timelock, c.pauserMultisig, i != 1); // o AvatarNFT não pausa
        }
        _check(d, c, deployer);
    }

    function _validate(Config memory c, address deployer) internal view {
        address[5] memory must =
            [c.adminMultisig, c.pauserMultisig, c.signer, c.treasury, address(c.vrf.coordinator)];
        for (uint256 i; i < must.length; ++i) {
            require(must[i] != address(0), "DeployMainnet: endereco zero na config");
            require(
                must[i] != deployer, "DeployMainnet: o deployer nao pode ficar com papel nem receber fundos"
            );
        }
        require(
            c.scity != address(0) || c.tokenRecipient != address(0), "DeployMainnet: scity ou tokenRecipient"
        );
        require(c.adminMultisig != c.pauserMultisig, "DeployMainnet: admin e pauser sao multisigs diferentes");
        require(c.adminMultisig.code.length > 0, "DeployMainnet: adminMultisig precisa ser contrato (Safe)");
        require(c.pauserMultisig.code.length > 0, "DeployMainnet: pauserMultisig precisa ser contrato (Safe)");
        if (block.chainid == 56) {
            require(c.timelockDelay >= MIN_MAINNET_DELAY, "DeployMainnet: atraso < 48 h");
            // Na mainnet o SCITY vem do TGE (DeployTGE), com o vesting do doc 04: nada de criar aqui.
            require(c.scity.code.length > 0, "DeployMainnet: na mainnet, scity e o token do TGE");
        }
        require(c.marketFeeBps <= 1000, "DeployMainnet: taxa acima de 10%");
        uint256 sum = uint256(c.tierWeights[0]) + c.tierWeights[1] + c.tierWeights[2] + c.tierWeights[3];
        require(sum == 10_000, "DeployMainnet: pesos da caixa somam 10.000");
    }

    function _timelock(Config memory c) internal returns (address) {
        address[] memory team = new address[](1);
        team[0] = c.adminMultisig;
        // Sem admin próprio: o timelock só muda a si mesmo pelo próprio atraso.
        return address(new TimelockController(c.timelockDelay, team, team, address(0)));
    }

    function _handOver(IAccessControl ac, address deployer, address timelock, address pauser, bool pausable)
        internal
    {
        bytes32 pauserRole = keccak256("PAUSER_ROLE");
        if (pausable) {
            ac.grantRole(pauserRole, pauser);
            ac.renounceRole(pauserRole, deployer);
        }
        ac.grantRole(bytes32(0), timelock);
        ac.renounceRole(bytes32(0), deployer);
    }

    /// @dev Confere os papéis finais; reverte o deploy inteiro se algo ficou errado.
    function _check(Deployed memory d, Config memory c, address deployer) internal view {
        bytes32 admin = bytes32(0);
        bytes32 pauser = keccak256("PAUSER_ROLE");
        address[7] memory all = [d.land, d.avatar, d.luckyBox, d.property, d.building, d.vault, d.market];
        for (uint256 i; i < all.length; ++i) {
            IAccessControl ac = IAccessControl(all[i]);
            require(
                !ac.hasRole(admin, deployer) && !ac.hasRole(pauser, deployer),
                "check: deployer ficou com papel"
            );
            require(ac.hasRole(admin, d.timelock), "check: timelock sem admin");
            require(
                !ac.hasRole(admin, c.adminMultisig),
                "check: multisig com admin direto (tem de passar no timelock)"
            );
            if (i != 1) require(ac.hasRole(pauser, c.pauserMultisig), "check: pauser sem pausa");
        }
        bytes32 upgrader = keccak256("UPGRADER_ROLE");
        require(IAccessControl(d.vault).hasRole(upgrader, d.timelock), "check: cofre sem upgrader");
        require(IAccessControl(d.market).hasRole(upgrader, d.timelock), "check: mercado sem upgrader");
        require(!IAccessControl(d.vault).hasRole(upgrader, deployer), "check: deployer com upgrader");
        require(
            AvatarNFT(d.avatar).hasRole(AvatarNFT(d.avatar).MINTER_ROLE(), d.luckyBox),
            "check: caixa sem minter"
        );
        TimelockController t = TimelockController(payable(d.timelock));
        require(t.getMinDelay() == c.timelockDelay, "check: atraso do timelock");
        require(t.hasRole(t.PROPOSER_ROLE(), c.adminMultisig), "check: multisig nao propoe");
        require(!t.hasRole(t.DEFAULT_ADMIN_ROLE(), deployer), "check: deployer admin do timelock");
    }

    function _write(Deployed memory d) internal {
        string memory key = "deploy";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "SCityToken", d.scity);
        vm.serializeAddress(key, "Timelock", d.timelock);
        vm.serializeAddress(key, "LandNFT", d.land);
        vm.serializeAddress(key, "AvatarNFT", d.avatar);
        vm.serializeAddress(key, "LuckyBox", d.luckyBox);
        vm.serializeAddress(key, "PropertyNFT", d.property);
        vm.serializeAddress(key, "BuildingNFT", d.building);
        vm.serializeAddress(key, "GameVaultImpl", d.vaultImpl);
        vm.serializeAddress(key, "MarketplaceImpl", d.marketImpl);
        vm.serializeAddress(key, "Marketplace", d.market);
        string memory json = vm.serializeAddress(key, "GameVault", d.vault);
        string memory out = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, out);
        console.log("Enderecos em", out);
    }
}
