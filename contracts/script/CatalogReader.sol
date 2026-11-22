// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";

/// @notice Lê as profissões do seed do CMS e agrupa por raridade, para a LuckyBox (`setProfessions`).
abstract contract CatalogReader is Script {
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
}
