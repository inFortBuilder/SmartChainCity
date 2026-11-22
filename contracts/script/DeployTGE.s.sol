// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";

import {TgeDistributor} from "../src/tge/TgeDistributor.sol";
import {TokenLock} from "../src/tge/TokenLock.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice TGE do SCITY (E4.2) na BSC (56) ou na testnet (97): uma transação cria o token e distribui a oferta
/// inteira conforme o doc 04 §2 (vesting por `VestingWallet`, P2E no `RewardsPool`). O deployer não recebe
/// nada. Roda antes do `DeployMainnet`, que usa o token criado aqui (`scity` na config).
///
///   TGE_CONFIG=deploy/tge.local.json forge script script/DeployTGE.s.sol \
///     --rpc-url $BSC_TESTNET_RPC --broadcast --verify --ledger
///
/// Na mainnet também precisa de CONFIRM_MAINNET=sim. Endereços em `deployments/<chainId>-tge.json`.
/// Mês = 365 dias / 12.
contract DeployTGE is Script {
    uint64 constant MONTH = 365 days / 12;
    /// Folga do prazo do LP: o bloco minerado vem depois da simulação, e o contrato exige ≥ 365 dias.
    uint256 constant LOCK_MARGIN = 1 days;

    function run() external returns (TgeDistributor tge) {
        _guardChain();
        (TgeDistributor.Allocation[] memory allocs, TgeDistributor.Rewards memory rewards) =
            loadConfig(vm.readFile(vm.envString("TGE_CONFIG")));
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        tge = deploy(allocs, rewards, deployer);
        vm.stopBroadcast();
        _write(tge);
    }

    /// @notice Trava o LP do pool (depois que o multisig da liquidez criou o par na DEX).
    ///   LP_TOKEN=0x… LP_BENEFICIARY=0x… LP_LOCK_DAYS=365 forge script script/DeployTGE.s.sol --sig "lockLiquidity()" …
    /// Depois, o multisig transfere o LP para o `TokenLock` (o endereço fica em `deployments/<chainId>-lp-lock.json`).
    function lockLiquidity() external returns (TokenLock lock) {
        _guardChain();
        uint256 days_ = vm.envOr("LP_LOCK_DAYS", uint256(365));
        vm.startBroadcast();
        lock = new TokenLock(
            IERC20(vm.envAddress("LP_TOKEN")),
            vm.envAddress("LP_BENEFICIARY"),
            // forge-lint: disable-next-line(unsafe-typecast)
            uint64(block.timestamp + days_ * 1 days + LOCK_MARGIN)
        );
        vm.stopBroadcast();
        string memory key = "lock";
        vm.serializeAddress(key, "lpToken", address(lock.token()));
        vm.serializeAddress(key, "beneficiary", lock.beneficiary());
        vm.serializeUint(key, "releaseTime", lock.releaseTime());
        string memory json = vm.serializeAddress(key, "TokenLock", address(lock));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), "-lp-lock.json"));
    }

    function _guardChain() internal view {
        require(block.chainid == 56 || block.chainid == 97, "DeployTGE: so na BSC (56) ou na testnet (97)");
        if (block.chainid == 56) {
            require(
                keccak256(bytes(vm.envOr("CONFIRM_MAINNET", string("")))) == keccak256("sim"),
                "DeployTGE: defina CONFIRM_MAINNET=sim"
            );
        }
    }

    function loadConfig(string memory json)
        public
        view
        returns (TgeDistributor.Allocation[] memory allocs, TgeDistributor.Rewards memory rewards)
    {
        rewards.beneficiary = vm.parseJsonAddress(json, ".playToEarn.beneficiary");
        rewards.amount = vm.parseJsonUint(json, ".playToEarn.tokens") * 1 ether;
        // forge-lint: disable-next-line(unsafe-typecast)
        rewards.interval = uint64(vm.parseJsonUint(json, ".playToEarn.intervalDays") * 1 days);
        uint256[] memory t = vm.parseJsonUintArray(json, ".playToEarn.tranchesBps");
        rewards.tranches = new uint16[](t.length);
        for (uint256 i; i < t.length; ++i) {
            // forge-lint: disable-next-line(unsafe-typecast)
            rewards.tranches[i] = uint16(t[i]);
        }
        uint256 n;
        while (vm.keyExistsJson(json, string.concat(".allocations[", vm.toString(n), "]"))) n++;
        allocs = new TgeDistributor.Allocation[](n);
        for (uint256 i; i < n; ++i) {
            string memory at = string.concat(".allocations[", vm.toString(i), "]");
            string memory name = vm.parseJsonString(json, string.concat(at, ".name"));
            require(bytes(name).length <= 32, "DeployTGE: nome com mais de 32 bytes");
            allocs[i] = TgeDistributor.Allocation({
                name: bytes32(bytes(name)),
                beneficiary: vm.parseJsonAddress(json, string.concat(at, ".beneficiary")),
                amount: vm.parseJsonUint(json, string.concat(at, ".tokens")) * 1 ether,
                // forge-lint: disable-next-line(unsafe-typecast)
                tgeBps: uint16(vm.parseJsonUint(json, string.concat(at, ".tgeBps"))),
                // forge-lint: disable-next-line(unsafe-typecast)
                cliff: uint64(vm.parseJsonUint(json, string.concat(at, ".cliffMonths"))) * MONTH,
                // forge-lint: disable-next-line(unsafe-typecast)
                duration: uint64(vm.parseJsonUint(json, string.concat(at, ".vestingMonths"))) * MONTH
            });
        }
    }

    /// @notice Confere a config e cria o distribuidor (o TGE inteiro numa transação).
    function deploy(
        TgeDistributor.Allocation[] memory allocs,
        TgeDistributor.Rewards memory rewards,
        address deployer
    ) public returns (TgeDistributor tge) {
        require(rewards.beneficiary != deployer, "DeployTGE: o deployer nao recebe tokens");
        for (uint256 i; i < allocs.length; ++i) {
            require(allocs[i].beneficiary != deployer, "DeployTGE: o deployer nao recebe tokens");
        }
        tge = new TgeDistributor(allocs, rewards);
        require(tge.token().balanceOf(address(tge)) == 0, "DeployTGE: sobrou saldo no distribuidor");
        require(tge.token().balanceOf(deployer) == 0, "DeployTGE: o deployer ficou com tokens");
    }

    function _write(TgeDistributor tge) internal {
        string memory key = "tge";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "tgeTimestamp", tge.tge());
        vm.serializeAddress(key, "TgeDistributor", address(tge));
        vm.serializeAddress(key, "RewardsPool", address(tge.rewardsPool()));
        TgeDistributor.Grant[] memory g = tge.grants();
        string memory wallets = "wallets";
        string memory owners = "beneficiaries";
        string memory w;
        string memory o;
        for (uint256 i; i < g.length; ++i) {
            // Vesting zero: a alocação foi toda no TGE, direto ao beneficiário.
            w = vm.serializeAddress(wallets, _name(g[i].name), g[i].vesting);
            o = vm.serializeAddress(owners, _name(g[i].name), g[i].beneficiary);
        }
        vm.serializeString(key, "vesting", w);
        vm.serializeString(key, "beneficiaries", o);
        string memory json = vm.serializeAddress(key, "SCityToken", address(tge.token()));
        string memory out = string.concat("deployments/", vm.toString(block.chainid), "-tge.json");
        vm.writeJson(json, out);
        console.log("Enderecos em", out);
    }

    function _name(bytes32 b) internal pure returns (string memory) {
        uint256 len;
        while (len < 32 && b[len] != 0) len++;
        bytes memory s = new bytes(len);
        for (uint256 i; i < len; ++i) {
            s[i] = b[i];
        }
        return string(s);
    }
}
