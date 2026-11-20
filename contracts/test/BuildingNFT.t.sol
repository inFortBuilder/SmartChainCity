// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import {BuildingNFT} from "../src/BuildingNFT.sol";
import {LandNFT} from "../src/LandNFT.sol";

contract BuildingNFTTest is Test {
    LandNFT land;
    BuildingNFT building;

    address admin = makeAddr("admin");
    address dev = makeAddr("construtor");
    address other = makeAddr("outro");
    uint256 signerKey;
    address signer;

    uint256 lot42;
    bytes32 constant MODEL = keccak256("modelo.glb v1");

    function setUp() public {
        (signer, signerKey) = makeAddrAndKey("world-signer");
        land = new LandNFT(admin, admin, "");
        building = new BuildingNFT(admin, land, "http://localhost:8030/v1/world/nft/buildings/");
        vm.startPrank(admin);
        land.grantRole(land.SIGNER_ROLE(), signer);
        building.grantRole(building.SIGNER_ROLE(), signer);
        vm.stopPrank();
        lot42 = giveLot(dev, 42);
    }

    /// Lote já pago no ledger (preço 0) levado ao LandNFT, como faz o world.
    function giveLot(address to, uint32 lot) internal returns (uint256) {
        LandNFT.LotQuote memory q = LandNFT.LotQuote({
            city: 1,
            lot: lot,
            buyer: to,
            currency: address(0),
            price: 0,
            nonce: land.lotId(1, lot),
            // forge-lint: disable-next-line(environment-read-across-mutation)
            deadline: block.timestamp + 60
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, land.quoteDigest(q));
        vm.prank(to);
        return land.buyPrimary(q, abi.encodePacked(r, s, v));
    }

    function voucher(uint256 lotId, uint256 nonce)
        internal
        view
        returns (BuildingNFT.BuildingVoucher memory)
    {
        return BuildingNFT.BuildingVoucher({
            lotId: lotId,
            developer: dev,
            modelHash: MODEL,
            floors: 25,
            nonce: nonce,
            // forge-lint: disable-next-line(environment-read-across-mutation)
            deadline: block.timestamp + 600
        });
    }

    function sign(BuildingNFT.BuildingVoucher memory v, uint256 key) internal view returns (bytes memory) {
        (uint8 pv, bytes32 r, bytes32 s) = vm.sign(key, building.voucherDigest(v));
        return abi.encodePacked(r, s, pv);
    }

    function test_mintRecordsLotModelAndFloors() public {
        BuildingNFT.BuildingVoucher memory v = voucher(lot42, 1);
        bytes memory sig = sign(v, signerKey);
        vm.expectEmit(address(building));
        emit BuildingNFT.BuildingMinted(1, lot42, dev, MODEL, 25);
        vm.prank(dev);
        uint256 id = building.mint(v, sig);

        assertEq(building.ownerOf(id), dev);
        assertEq(building.buildingOfLot(lot42), id);
        BuildingNFT.Building memory b = building.buildingOf(id);
        assertEq(b.lotId, lot42);
        assertEq(b.modelHash, MODEL);
        assertEq(b.floors, 25);
        assertEq(b.developer, dev);
        assertEq(building.tokenURI(id), "http://localhost:8030/v1/world/nft/buildings/1");
    }

    function test_rejectsLotOfSomeoneElse() public {
        uint256 lot7 = giveLot(other, 7);
        BuildingNFT.BuildingVoucher memory v = voucher(lot7, 2);
        bytes memory sig = sign(v, signerKey);
        vm.prank(dev);
        vm.expectRevert(BuildingNFT.NotLotOwner.selector);
        building.mint(v, sig);
    }

    function test_rejectsLotNotOnChain() public {
        uint256 offChain = land.lotId(1, 999);
        BuildingNFT.BuildingVoucher memory v = voucher(offChain, 3);
        bytes memory sig = sign(v, signerKey);
        vm.prank(dev);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, offChain));
        building.mint(v, sig);
    }

    function test_oneBuildingPerLot() public {
        BuildingNFT.BuildingVoucher memory v = voucher(lot42, 4);
        bytes memory sig = sign(v, signerKey);
        vm.prank(dev);
        building.mint(v, sig);
        BuildingNFT.BuildingVoucher memory v2 = voucher(lot42, 5);
        bytes memory sig2 = sign(v2, signerKey);
        vm.prank(dev);
        vm.expectRevert(abi.encodeWithSelector(BuildingNFT.LotHasBuilding.selector, 1));
        building.mint(v2, sig2);
    }

    function test_rejectsReusedNonceExpiredAndWrongSigner() public {
        BuildingNFT.BuildingVoucher memory v = voucher(lot42, 6);
        bytes memory sig = sign(v, signerKey);
        vm.prank(dev);
        building.mint(v, sig);

        uint256 lot8 = giveLot(dev, 8);
        BuildingNFT.BuildingVoucher memory reused = voucher(lot8, 6);
        bytes memory sigReused = sign(reused, signerKey);
        vm.prank(dev);
        vm.expectRevert(BuildingNFT.NonceAlreadyUsed.selector);
        building.mint(reused, sigReused);

        BuildingNFT.BuildingVoucher memory late = voucher(lot8, 7);
        bytes memory sigLate = sign(late, signerKey);
        vm.warp(late.deadline + 1);
        vm.prank(dev);
        vm.expectRevert(BuildingNFT.VoucherExpired.selector);
        building.mint(late, sigLate);

        (address intruso, uint256 intrusoKey) = makeAddrAndKey("intruso");
        BuildingNFT.BuildingVoucher memory forged = voucher(lot8, 8);
        bytes memory sigForged = sign(forged, intrusoKey);
        vm.prank(dev);
        vm.expectRevert(abi.encodeWithSelector(BuildingNFT.InvalidSigner.selector, intruso));
        building.mint(forged, sigForged);
    }

    function test_onlyDeveloperMintsAndModelIsRequired() public {
        BuildingNFT.BuildingVoucher memory v = voucher(lot42, 9);
        bytes memory sig = sign(v, signerKey);
        vm.prank(other);
        vm.expectRevert(BuildingNFT.NotVoucherDeveloper.selector);
        building.mint(v, sig);

        BuildingNFT.BuildingVoucher memory empty = voucher(lot42, 10);
        empty.modelHash = bytes32(0);
        bytes memory sigEmpty = sign(empty, signerKey);
        vm.prank(dev);
        vm.expectRevert(BuildingNFT.EmptyModel.selector);
        building.mint(empty, sigEmpty);
    }

    function test_tamperedFloorsBreakSignature() public {
        BuildingNFT.BuildingVoucher memory v = voucher(lot42, 11);
        bytes memory sig = sign(v, signerKey);
        v.floors = 80;
        vm.prank(dev);
        vm.expectPartialRevert(BuildingNFT.InvalidSigner.selector);
        building.mint(v, sig);
    }

    function test_demolishFreesTheLot() public {
        BuildingNFT.BuildingVoucher memory v = voucher(lot42, 12);
        bytes memory sig = sign(v, signerKey);
        vm.prank(dev);
        uint256 id = building.mint(v, sig);

        vm.prank(other);
        vm.expectRevert(BuildingNFT.NotBuildingAndLotOwner.selector);
        building.demolish(id);

        vm.prank(dev);
        building.demolish(id);
        assertEq(building.buildingOfLot(lot42), 0);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, id));
        building.ownerOf(id);

        BuildingNFT.BuildingVoucher memory again = voucher(lot42, 13);
        bytes memory sigAgain = sign(again, signerKey);
        vm.prank(dev);
        assertEq(building.mint(again, sigAgain), 2);
    }

    /// O prédio circula livre; demolir exige ter prédio e lote juntos.
    function test_buildingTransferIsFreeButDemolishNeedsBoth() public {
        BuildingNFT.BuildingVoucher memory v = voucher(lot42, 14);
        bytes memory sig = sign(v, signerKey);
        vm.prank(dev);
        uint256 id = building.mint(v, sig);
        vm.prank(dev);
        building.transferFrom(dev, other, id);
        assertEq(building.ownerOf(id), other);
        vm.prank(other);
        vm.expectRevert(BuildingNFT.NotBuildingAndLotOwner.selector);
        building.demolish(id);
    }
}
