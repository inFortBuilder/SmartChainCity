// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {LandNFT} from "../src/LandNFT.sol";
import {PropertyNFT} from "../src/PropertyNFT.sol";

contract PropertyNFTTest is Test {
    LandNFT land;
    PropertyNFT property;

    address admin = makeAddr("admin");
    address owner = makeAddr("dono");
    address other = makeAddr("outro");
    uint256 signerKey;
    address signer;

    uint256 lot42;
    bytes32 constant T1 = bytes32("t1");
    // Id do imóvel no world: os 128 bits do UUID.
    uint256 constant ID = 0x6f1c2b0e8d4a4f3e9b7a1c2d3e4f5a6b;

    function setUp() public {
        (signer, signerKey) = makeAddrAndKey("world-signer");
        land = new LandNFT(admin, admin, "");
        property = new PropertyNFT(admin, land, "http://localhost:8030/v1/world/nft/properties/");
        vm.startPrank(admin);
        land.grantRole(land.SIGNER_ROLE(), signer);
        property.grantRole(property.SIGNER_ROLE(), signer);
        vm.stopPrank();
        lot42 = giveLot(owner, 42);
    }

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

    function voucher(uint256 tokenId, uint256 lotId)
        internal
        view
        returns (PropertyNFT.PropertyVoucher memory)
    {
        return PropertyNFT.PropertyVoucher({
            tokenId: tokenId,
            owner: owner,
            lotId: lotId,
            typeCode: T1,
            level: 1,
            // forge-lint: disable-next-line(environment-read-across-mutation)
            deadline: block.timestamp + 600
        });
    }

    function sign(PropertyNFT.PropertyVoucher memory v, uint256 key) internal view returns (bytes memory) {
        (uint8 pv, bytes32 r, bytes32 s) = vm.sign(key, property.voucherDigest(v));
        return abi.encodePacked(r, s, pv);
    }

    function levelVoucher(uint16 level)
        internal
        view
        returns (PropertyNFT.LevelVoucher memory v, bytes memory sig)
    {
        // forge-lint: disable-next-line(environment-read-across-mutation)
        v = PropertyNFT.LevelVoucher({tokenId: ID, level: level, deadline: block.timestamp + 600});
        (uint8 pv, bytes32 r, bytes32 s) = vm.sign(signerKey, property.levelDigest(v));
        sig = abi.encodePacked(r, s, pv);
    }

    function minted() internal {
        PropertyNFT.PropertyVoucher memory v = voucher(ID, lot42);
        bytes memory sig = sign(v, signerKey);
        vm.prank(owner);
        property.mint(v, sig);
    }

    function test_mintRecordsLotTypeAndLevel() public {
        PropertyNFT.PropertyVoucher memory v = voucher(ID, lot42);
        bytes memory sig = sign(v, signerKey);
        vm.expectEmit(address(property));
        emit PropertyNFT.PropertyMinted(ID, lot42, owner, T1, 1);
        vm.prank(owner);
        property.mint(v, sig);

        assertEq(property.ownerOf(ID), owner);
        assertEq(property.propertyOfLot(lot42), ID);
        PropertyNFT.Property memory p = property.propertyOf(ID);
        assertEq(p.lotId, lot42);
        assertEq(p.typeCode, T1);
        assertEq(p.level, 1);
        assertEq(
            property.tokenURI(ID),
            string.concat("http://localhost:8030/v1/world/nft/properties/", vm.toString(ID))
        );
    }

    function test_sameVoucherMintsOnce() public {
        PropertyNFT.PropertyVoucher memory v = voucher(ID, lot42);
        bytes memory sig = sign(v, signerKey);
        vm.startPrank(owner);
        property.mint(v, sig);
        vm.expectRevert(abi.encodeWithSelector(PropertyNFT.LotHasProperty.selector, ID));
        property.mint(v, sig);
        vm.stopPrank();
    }

    function test_sameTokenOnOtherLotReverts() public {
        minted();
        uint256 lot43 = giveLot(owner, 43);
        PropertyNFT.PropertyVoucher memory v = voucher(ID, lot43);
        bytes memory sig = sign(v, signerKey);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InvalidSender.selector, address(0)));
        property.mint(v, sig);
    }

    function test_rejectsLotOfSomeoneElse() public {
        uint256 lot7 = giveLot(other, 7);
        PropertyNFT.PropertyVoucher memory v = voucher(ID, lot7);
        bytes memory sig = sign(v, signerKey);
        vm.prank(owner);
        vm.expectRevert(PropertyNFT.NotLotOwner.selector);
        property.mint(v, sig);
    }

    function test_rejectsLotNotOnchain() public {
        uint256 missing = land.lotId(1, 999);
        PropertyNFT.PropertyVoucher memory v = voucher(ID, missing);
        bytes memory sig = sign(v, signerKey);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, missing));
        property.mint(v, sig);
    }

    function test_rejectsWrongSignerCallerAndExpired() public {
        PropertyNFT.PropertyVoucher memory v = voucher(ID, lot42);
        (address fake, uint256 fakeKey) = makeAddrAndKey("falso");
        bytes memory bad = sign(v, fakeKey);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PropertyNFT.InvalidSigner.selector, fake));
        property.mint(v, bad);

        bytes memory sig = sign(v, signerKey);
        vm.prank(other);
        vm.expectRevert(PropertyNFT.NotVoucherOwner.selector);
        property.mint(v, sig);

        vm.warp(v.deadline + 1);
        vm.prank(owner);
        vm.expectRevert(PropertyNFT.VoucherExpired.selector);
        property.mint(v, sig);
    }

    function test_rejectsEmptyFields() public {
        PropertyNFT.PropertyVoucher memory v = voucher(ID, lot42);
        v.level = 0;
        bytes memory sig = sign(v, signerKey);
        vm.prank(owner);
        vm.expectRevert(PropertyNFT.InvalidVoucher.selector);
        property.mint(v, sig);
    }

    function test_tamperedVoucherFails() public {
        PropertyNFT.PropertyVoucher memory v = voucher(ID, lot42);
        bytes memory sig = sign(v, signerKey);
        v.level = 3; // o jogador tenta mintar já no nível 3
        vm.prank(owner);
        vm.expectRevert();
        property.mint(v, sig);
    }

    function test_upgradeOnlyGoesUp() public {
        minted();
        (PropertyNFT.LevelVoucher memory v2, bytes memory s2) = levelVoucher(2);
        vm.expectEmit(address(property));
        emit PropertyNFT.PropertyUpgraded(ID, 2);
        vm.prank(owner);
        property.upgrade(v2, s2);
        assertEq(property.propertyOf(ID).level, 2);

        // O mesmo voucher não serve de novo.
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PropertyNFT.LevelNotHigher.selector, 2));
        property.upgrade(v2, s2);

        (PropertyNFT.LevelVoucher memory v3, bytes memory s3) = levelVoucher(3);
        vm.prank(other);
        vm.expectRevert(PropertyNFT.NotPropertyOwner.selector);
        property.upgrade(v3, s3);
    }

    function test_upgradeRejectsForgedLevel() public {
        minted();
        (PropertyNFT.LevelVoucher memory v, bytes memory sig) = levelVoucher(2);
        v.level = 3;
        vm.prank(owner);
        vm.expectRevert();
        property.upgrade(v, sig);
        assertEq(property.propertyOf(ID).level, 1);
    }

    function test_transferIsFreeAndLotStaysLinked() public {
        minted();
        vm.prank(owner);
        property.transferFrom(owner, other, ID);
        assertEq(property.ownerOf(ID), other);
        assertEq(property.propertyOfLot(lot42), ID);
        // O novo dono sobe o nível com voucher do world.
        (PropertyNFT.LevelVoucher memory v, bytes memory sig) = levelVoucher(2);
        vm.prank(other);
        property.upgrade(v, sig);
    }

    function test_pauseBlocksMint() public {
        vm.prank(admin);
        property.pause();
        PropertyNFT.PropertyVoucher memory v = voucher(ID, lot42);
        bytes memory sig = sign(v, signerKey);
        vm.prank(owner);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        property.mint(v, sig);
    }

    function test_onlyAdminSetsBaseURI() public {
        vm.prank(other);
        vm.expectRevert();
        property.setBaseURI("x");
        vm.prank(admin);
        property.setBaseURI("ipfs://p/");
    }

    // ---------------------------------------------------------------- apreensão (ADR-0016)

    /// O imóvel vai junto com o lote no leilão: as duas apreensões, e o vínculo lote → imóvel continua.
    function test_seizeMovesPropertyWithTheLot() public {
        PropertyNFT.PropertyVoucher memory v = voucher(ID, lot42);
        bytes memory sig = sign(v, signerKey);
        vm.prank(owner);
        property.mint(v, sig);

        address winner = makeAddr("vencedor");
        // forge-lint: disable-next-line(environment-read-across-mutation)
        uint256 deadline = block.timestamp + 600;
        LandNFT.Seizure memory ls =
            LandNFT.Seizure({tokenId: lot42, to: winner, nonce: 1, deadline: deadline});
        (uint8 a, bytes32 b, bytes32 c) = vm.sign(signerKey, land.seizureDigest(ls));
        land.seize(ls, abi.encodePacked(b, c, a));
        PropertyNFT.Seizure memory ps =
            PropertyNFT.Seizure({tokenId: ID, to: winner, nonce: 1, deadline: deadline});
        (uint8 pv, bytes32 r, bytes32 s) = vm.sign(signerKey, property.seizureDigest(ps));
        vm.expectEmit(true, true, true, true);
        emit PropertyNFT.Seized(ID, owner, winner, 1);
        vm.prank(winner);
        property.seize(ps, abi.encodePacked(r, s, pv));

        assertEq(land.ownerOf(lot42), winner);
        assertEq(property.ownerOf(ID), winner);
        assertEq(property.propertyOfLot(lot42), ID);
        // O nível sobe pelo novo dono, como antes.
        (PropertyNFT.LevelVoucher memory lv, bytes memory lsig) = levelVoucher(2);
        vm.prank(winner);
        property.upgrade(lv, lsig);
        assertEq(property.propertyOf(ID).level, 2);
    }

    function test_seizeRejectsReuseAndWrongSigner() public {
        PropertyNFT.PropertyVoucher memory v = voucher(ID, lot42);
        bytes memory sig = sign(v, signerKey);
        vm.prank(owner);
        property.mint(v, sig);
        // forge-lint: disable-next-line(environment-read-across-mutation)
        PropertyNFT.Seizure memory ps =
            PropertyNFT.Seizure({tokenId: ID, to: other, nonce: 7, deadline: block.timestamp + 600});
        (, uint256 strangerKey) = makeAddrAndKey("estranho");
        (uint8 xv, bytes32 xr, bytes32 xs) = vm.sign(strangerKey, property.seizureDigest(ps));
        vm.expectRevert();
        property.seize(ps, abi.encodePacked(xr, xs, xv));
        (uint8 pv, bytes32 r, bytes32 s) = vm.sign(signerKey, property.seizureDigest(ps));
        property.seize(ps, abi.encodePacked(r, s, pv));
        vm.expectRevert(PropertyNFT.SeizureAlreadyUsed.selector);
        property.seize(ps, abi.encodePacked(r, s, pv));
    }
}
