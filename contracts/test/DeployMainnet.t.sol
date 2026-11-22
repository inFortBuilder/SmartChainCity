// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

import {DeployMainnet} from "../script/DeployMainnet.s.sol";
import {AvatarNFT} from "../src/AvatarNFT.sol";
import {GameVault} from "../src/GameVault.sol";
import {LandNFT} from "../src/LandNFT.sol";
import {LuckyBox} from "../src/LuckyBox.sol";
import {Marketplace} from "../src/Marketplace.sol";
import {SCityToken} from "../src/SCityToken.sol";
import {LocalVRFCoordinator} from "../src/dev/LocalVRFCoordinator.sol";
import {IVRFCoordinatorV2Plus} from "../src/vrf/VRFV2Plus.sol";

/// Faz as vezes de um Safe: só precisa ter código.
contract FakeSafe {}

/// O deploy da mainnet entrega os papéis do doc 07 §3 e o deployer sai sem nenhum.
contract DeployMainnetTest is Test {
    DeployMainnet script;
    address admin;
    address pauser;
    address signer = makeAddr("kms-signer");
    address treasury = makeAddr("treasury");
    address holder = makeAddr("tge");
    bytes32 constant PAUSER = keccak256("PAUSER_ROLE");
    bytes32 constant UPGRADER = keccak256("UPGRADER_ROLE");

    function setUp() public {
        vm.chainId(97);
        script = new DeployMainnet();
        admin = address(new FakeSafe());
        pauser = address(new FakeSafe());
    }

    function _config() internal returns (DeployMainnet.Config memory c) {
        c.adminMultisig = admin;
        c.pauserMultisig = pauser;
        c.signer = signer;
        c.treasury = treasury;
        c.tokenRecipient = holder;
        c.timelockDelay = 48 hours;
        c.avatarRoyaltyBps = 250;
        c.marketFeeBps = 250;
        c.vaultDailyLimit = 1_000_000 ether;
        c.vaultDailyLimitPerAddress = 10_000 ether;
        c.landBaseURI = "https://x/lots/";
        c.vrf = LuckyBox.VrfConfig({
            coordinator: IVRFCoordinatorV2Plus(address(new LocalVRFCoordinator())),
            keyHash: bytes32(uint256(1)),
            subId: 1,
            requestConfirmations: 3,
            callbackGasLimit: 300_000,
            nativePayment: true
        });
        c.tierPrice = 0.05 ether;
        c.tierWeights = [uint16(4000), 3000, 2000, 1000];
    }

    function _deploy(DeployMainnet.Config memory c) internal returns (DeployMainnet.Deployed memory) {
        return script.deploy(c, address(script), vm.readFile("../cms-strapi/seed/profissoes.json"));
    }

    function test_finalRoles() public {
        DeployMainnet.Deployed memory d = _deploy(_config());
        address me = address(script);
        address[7] memory all = [d.land, d.avatar, d.luckyBox, d.property, d.building, d.vault, d.market];
        for (uint256 i; i < all.length; ++i) {
            IAccessControl ac = IAccessControl(all[i]);
            assertTrue(ac.hasRole(bytes32(0), d.timelock));
            assertFalse(ac.hasRole(bytes32(0), me));
            assertFalse(ac.hasRole(bytes32(0), admin));
            assertFalse(ac.hasRole(PAUSER, me));
            assertEq(ac.hasRole(PAUSER, pauser), i != 1);
        }
        assertTrue(IAccessControl(d.vault).hasRole(UPGRADER, d.timelock));
        assertTrue(IAccessControl(d.market).hasRole(UPGRADER, d.timelock));
        assertTrue(LandNFT(d.land).hasRole(keccak256("SIGNER_ROLE"), signer));
        assertTrue(GameVault(d.vault).hasRole(keccak256("SIGNER_ROLE"), signer));
        assertTrue(AvatarNFT(d.avatar).hasRole(keccak256("MINTER_ROLE"), d.luckyBox));

        // Configuração feita antes da entrega: coleções, caixa, tetos e token novo para o TGE.
        assertTrue(Marketplace(d.market).allowedCollection(d.land));
        assertTrue(Marketplace(d.market).allowedCollection(d.avatar));
        assertEq(LuckyBox(d.luckyBox).tierOf(1).price, 0.05 ether);
        assertGt(LuckyBox(d.luckyBox).professionsOf(0).length, 0);
        assertEq(GameVault(d.vault).dailyLimit(), 1_000_000 ether);
        assertEq(SCityToken(d.scity).balanceOf(holder), SCityToken(d.scity).totalSupply());

        TimelockController t = TimelockController(payable(d.timelock));
        assertEq(t.getMinDelay(), 48 hours);
        assertTrue(t.hasRole(t.PROPOSER_ROLE(), admin));
        assertTrue(t.hasRole(t.EXECUTOR_ROLE(), admin));
        assertFalse(t.hasRole(t.DEFAULT_ADMIN_ROLE(), me));
    }

    function test_pauserPausesAtOnceButCannotChangeParameters() public {
        DeployMainnet.Deployed memory d = _deploy(_config());
        vm.prank(pauser);
        GameVault(d.vault).pause();
        assertTrue(GameVault(d.vault).paused());
        vm.prank(pauser);
        vm.expectRevert();
        GameVault(d.vault).setLimits(1, 1);
        // Nem o multisig de admin muda direto: tem de passar pelo timelock.
        vm.prank(admin);
        vm.expectRevert();
        GameVault(d.vault).setLimits(1, 1);
    }

    function test_timelockChangesParametersOnlyAfterDelay() public {
        DeployMainnet.Deployed memory d = _deploy(_config());
        TimelockController t = TimelockController(payable(d.timelock));
        bytes memory data = abi.encodeCall(GameVault.setLimits, (500 ether, 5 ether));
        uint256 t0 = vm.getBlockTimestamp();
        vm.prank(admin);
        t.schedule(d.vault, 0, data, bytes32(0), bytes32(0), 48 hours);
        vm.warp(t0 + 47 hours);
        vm.prank(admin);
        vm.expectRevert();
        t.execute(d.vault, 0, data, bytes32(0), bytes32(0));
        vm.warp(t0 + 48 hours);
        vm.prank(admin);
        t.execute(d.vault, 0, data, bytes32(0), bytes32(0));
        assertEq(GameVault(d.vault).dailyLimit(), 500 ether);
    }

    function test_existingTokenIsReused() public {
        DeployMainnet.Config memory c = _config();
        c.scity = address(new SCityToken(holder));
        assertEq(_deploy(c).scity, c.scity);
    }

    function test_rejectsBadConfig() public {
        DeployMainnet.Config memory c = _config();
        c.signer = address(0);
        vm.expectRevert(bytes("DeployMainnet: endereco zero na config"));
        _deploy(c);

        c = _config();
        c.treasury = address(script);
        vm.expectRevert(bytes("DeployMainnet: o deployer nao pode ficar com papel nem receber fundos"));
        _deploy(c);

        c = _config();
        c.adminMultisig = makeAddr("eoa");
        vm.expectRevert(bytes("DeployMainnet: adminMultisig precisa ser contrato (Safe)"));
        _deploy(c);

        c = _config();
        c.pauserMultisig = admin;
        vm.expectRevert(bytes("DeployMainnet: admin e pauser sao multisigs diferentes"));
        _deploy(c);

        c = _config();
        c.tierWeights = [uint16(4000), 3000, 2000, 999];
        vm.expectRevert(bytes("DeployMainnet: pesos da caixa somam 10.000"));
        _deploy(c);

        c = _config();
        c.marketFeeBps = 1001;
        vm.expectRevert(bytes("DeployMainnet: taxa acima de 10%"));
        _deploy(c);
    }

    function test_mainnetNeedsTwoDayDelay() public {
        vm.chainId(56);
        DeployMainnet.Config memory c = _config();
        c.timelockDelay = 24 hours;
        vm.expectRevert(bytes("DeployMainnet: atraso < 48 h"));
        _deploy(c);
    }

    function test_runOnlyOnBscWithConfirmation() public {
        vm.chainId(31_337);
        vm.expectRevert(bytes("DeployMainnet: so na BSC (56) ou na testnet (97)"));
        script.run();
        vm.chainId(56);
        vm.setEnv("CONFIRM_MAINNET", "");
        vm.expectRevert(bytes("DeployMainnet: defina CONFIRM_MAINNET=sim"));
        script.run();
    }

    function test_loadsExampleConfig() public view {
        DeployMainnet.Config memory c = script.loadConfig(vm.readFile("deploy/bsc.example.json"));
        assertEq(c.timelockDelay, 48 hours);
        assertEq(c.marketFeeBps, 250);
        assertEq(c.vaultDailyLimit, 1_000_000 ether);
        assertEq(c.tierWeights[3], 1000);
        assertEq(c.vrf.callbackGasLimit, 300_000);
        assertTrue(c.vrf.nativePayment);
        assertEq(c.landBaseURI, "https://api.example.invalid/v1/world/nft/lots/");
    }
}
