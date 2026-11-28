// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {BuildingNFT} from "../src/BuildingNFT.sol";
import {LandNFT} from "../src/LandNFT.sol";
import {Marketplace} from "../src/Marketplace.sol";
import {SCityToken} from "../src/SCityToken.sol";
import {UnitMarket} from "../src/UnitMarket.sol";
import {UnitNFT} from "../src/UnitNFT.sol";

/// Unidades dos prédios on-chain (doc 13 §7, E3.11): venda primária por voucher do world, royalty na revenda e
/// aluguel por período.
contract UnitMarketTest is Test {
    LandNFT land;
    BuildingNFT building;
    UnitNFT units;
    UnitMarket market;
    SCityToken scity;

    address admin = makeAddr("admin");
    address treasury = makeAddr("tesouraria");
    address dev = makeAddr("construtor");
    address buyer = makeAddr("comprador");
    address tenant = makeAddr("inquilino");
    address other = makeAddr("outro");
    uint256 signerKey;
    address signer;
    uint256 buildingId;

    uint256 constant PRICE = 1000 ether;
    uint256 constant RENT = 10 ether;

    function setUp() public {
        (signer, signerKey) = makeAddrAndKey("world-signer");
        land = new LandNFT(admin, admin, "");
        building = new BuildingNFT(admin, land, "");
        units = new UnitNFT(admin, "http://localhost:8030/v1/world/nft/units/");
        scity = new SCityToken(admin);
        market = new UnitMarket(admin, units, building, scity, treasury, 500, 1000);
        vm.startPrank(admin);
        land.grantRole(land.SIGNER_ROLE(), signer);
        building.grantRole(building.SIGNER_ROLE(), signer);
        market.grantRole(market.SIGNER_ROLE(), signer);
        units.grantRole(units.MINTER_ROLE(), address(market));
        scity.transfer(buyer, 10_000 ether);
        scity.transfer(tenant, 10_000 ether);
        scity.transfer(other, 10_000 ether);
        vm.stopPrank();
        buildingId = giveBuilding(dev, 42);
        vm.prank(buyer);
        scity.approve(address(market), type(uint256).max);
        vm.prank(tenant);
        scity.approve(address(market), type(uint256).max);
        vm.prank(other);
        scity.approve(address(market), type(uint256).max);
    }

    /// Lote e prédio do construtor, como o world leva ao LandNFT e ao BuildingNFT.
    function giveBuilding(address to, uint32 lot) internal returns (uint256) {
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
        uint256 lotId = land.buyPrimary(q, abi.encodePacked(r, s, v));
        BuildingNFT.BuildingVoucher memory bv = BuildingNFT.BuildingVoucher({
            lotId: lotId,
            developer: to,
            modelHash: keccak256("edificio.glb"),
            floors: 10,
            nonce: lot,
            // forge-lint: disable-next-line(environment-read-across-mutation)
            deadline: block.timestamp + 600
        });
        (v, r, s) = vm.sign(signerKey, building.voucherDigest(bv));
        vm.prank(to);
        return building.mint(bv, abi.encodePacked(r, s, v));
    }

    function sale(uint256 unitKey, uint256 nonce) internal view returns (UnitMarket.UnitSale memory) {
        return UnitMarket.UnitSale({
            buildingId: buildingId,
            unitKey: unitKey,
            floor: 3,
            areaM2x100: 7235,
            code: bytes16("0302"),
            buyer: buyer,
            developer: dev,
            price: PRICE,
            nonce: nonce,
            // forge-lint: disable-next-line(environment-read-across-mutation)
            deadline: block.timestamp + 600
        });
    }

    function sign(UnitMarket.UnitSale memory s, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(key, market.saleDigest(s));
        return abi.encodePacked(r, ss, v);
    }

    function buyUnit(uint256 unitKey, uint256 nonce) internal returns (uint256) {
        UnitMarket.UnitSale memory s = sale(unitKey, nonce);
        bytes memory sig = sign(s, signerKey);
        vm.prank(buyer);
        return market.buyPrimary(s, sig);
    }

    // ------------------------------------------------------------------ venda primária

    function test_primarySaleMintsUnitAndSplitsPrice() public {
        uint256 devBefore = scity.balanceOf(dev);
        uint256 id = buyUnit(7, 1);

        assertEq(units.ownerOf(id), buyer);
        UnitNFT.Unit memory u = units.unitOf(id);
        assertEq(u.buildingId, buildingId);
        assertEq(u.floor, 3);
        assertEq(u.areaM2x100, 7235);
        assertEq(u.code, bytes16("0302"));
        assertEq(units.tokenOfUnit(buildingId, 7), id);
        // 5% para a tesouraria, 95% para o construtor.
        assertEq(scity.balanceOf(treasury), 50 ether);
        assertEq(scity.balanceOf(dev) - devBefore, 950 ether);
        assertEq(scity.balanceOf(address(market)), 0);
        // Royalty de 2% para o construtor na revenda.
        (address receiver, uint256 royalty) = units.royaltyInfo(id, 1000 ether);
        assertEq(receiver, dev);
        assertEq(royalty, 20 ether);
    }

    function test_sameUnitOrVoucherOnlyOnce() public {
        buyUnit(7, 1);
        UnitMarket.UnitSale memory again = sale(7, 1);
        bytes memory sig = sign(again, signerKey);
        vm.prank(buyer);
        vm.expectRevert(UnitMarket.NonceAlreadyUsed.selector);
        market.buyPrimary(again, sig);

        UnitMarket.UnitSale memory sameUnit = sale(7, 2);
        sig = sign(sameUnit, signerKey);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(UnitNFT.UnitAlreadyMinted.selector, 1));
        market.buyPrimary(sameUnit, sig);
    }

    function test_primaryRejectsBadVouchers() public {
        UnitMarket.UnitSale memory s = sale(7, 1);
        bytes memory sig = sign(s, signerKey);

        vm.prank(other);
        vm.expectRevert(UnitMarket.NotVoucherBuyer.selector);
        market.buyPrimary(s, sig);

        (, uint256 fakeKey) = makeAddrAndKey("falso");
        bytes memory fake = sign(s, fakeKey);
        vm.prank(buyer);
        vm.expectRevert();
        market.buyPrimary(s, fake);

        UnitMarket.UnitSale memory tampered = s;
        tampered.price = 1 ether;
        vm.prank(buyer);
        vm.expectRevert();
        market.buyPrimary(tampered, sig);

        vm.warp(block.timestamp + 601);
        vm.prank(buyer);
        vm.expectRevert(UnitMarket.VoucherExpired.selector);
        market.buyPrimary(s, sig);
    }

    function test_voucherFailsAfterBuildingChangesHands() public {
        UnitMarket.UnitSale memory s = sale(7, 1);
        bytes memory sig = sign(s, signerKey);
        vm.prank(dev);
        building.transferFrom(dev, other, buildingId);
        vm.prank(buyer);
        vm.expectRevert(UnitMarket.NotBuildingOwner.selector);
        market.buyPrimary(s, sig);
    }

    function test_onlyMarketMints() public {
        UnitNFT.Unit memory u = UnitNFT.Unit(buildingId, 1, 1, 5000, bytes16("0101"));
        bytes32 role = units.MINTER_ROLE();
        vm.prank(other);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, other, role)
        );
        units.mint(other, other, u);
    }

    // ------------------------------------------------------------------ aluguel

    function test_rentPaysOwnerAndExtendsUpTo30Days() public {
        uint256 id = buyUnit(7, 1);
        vm.prank(buyer);
        market.setRent(id, RENT);
        assertEq(market.rentPrice(id), RENT);

        uint256 ownerBefore = scity.balanceOf(buyer);
        uint256 treasuryBefore = scity.balanceOf(treasury);
        vm.prank(tenant);
        market.rent(id, 7, RENT);
        assertEq(market.tenantOf(id), tenant);
        (, uint64 endsAt) = market.leases(id);
        assertEq(endsAt, block.timestamp + 7 days);
        // 70 de aluguel: 10% (7) para a tesouraria, 63 para o dono.
        assertEq(scity.balanceOf(treasury) - treasuryBefore, 7 ether);
        assertEq(scity.balanceOf(buyer) - ownerBefore, 63 ether);

        // O mesmo inquilino estende; outro espera.
        vm.prank(tenant);
        market.rent(id, 20, RENT);
        vm.prank(other);
        vm.expectRevert(
            abi.encodeWithSelector(UnitMarket.UnitRented.selector, tenant, uint64(block.timestamp + 27 days))
        );
        market.rent(id, 1, RENT);
        vm.prank(tenant);
        vm.expectRevert(UnitMarket.RentPrepaid.selector);
        market.rent(id, 4, RENT);

        // Acabou o aluguel: outro pode alugar.
        vm.warp(block.timestamp + 27 days);
        assertEq(market.tenantOf(id), address(0));
        vm.prank(other);
        market.rent(id, 1, RENT);
        assertEq(market.tenantOf(id), other);
    }

    function test_rentRules() public {
        uint256 id = buyUnit(7, 1);
        vm.prank(tenant);
        vm.expectRevert(UnitMarket.NotForRent.selector);
        market.rent(id, 1, RENT);

        vm.prank(other);
        vm.expectRevert(UnitMarket.NotUnitOwner.selector);
        market.setRent(id, RENT);

        vm.prank(buyer);
        market.setRent(id, RENT);
        vm.prank(buyer);
        vm.expectRevert(UnitMarket.OwnUnit.selector);
        market.rent(id, 1, RENT);
        vm.prank(tenant);
        vm.expectRevert(abi.encodeWithSelector(UnitMarket.PriceChanged.selector, RENT));
        market.rent(id, 1, RENT - 1);
        vm.prank(tenant);
        vm.expectRevert(UnitMarket.BadDays.selector);
        market.rent(id, 31, RENT);
        vm.prank(tenant);
        vm.expectRevert(UnitMarket.BadDays.selector);
        market.rent(id, 0, RENT);
    }

    function test_saleDropsOfferButKeepsPaidLease() public {
        uint256 id = buyUnit(7, 1);
        vm.prank(buyer);
        market.setRent(id, RENT);
        vm.prank(tenant);
        market.rent(id, 5, RENT);

        vm.prank(buyer);
        units.transferFrom(buyer, other, id);
        // A oferta era do dono antigo: some. O aluguel pago segue.
        assertEq(market.rentPrice(id), 0);
        assertEq(market.tenantOf(id), tenant);
        vm.prank(tenant);
        vm.expectRevert(UnitMarket.NotForRent.selector);
        market.rent(id, 1, RENT);
    }

    // ------------------------------------------------------------------ revenda e operação

    function test_resaleOnMarketplacePaysDeveloperRoyalty() public {
        Marketplace mp = Marketplace(
            address(
                new ERC1967Proxy(
                    address(new Marketplace()),
                    abi.encodeCall(Marketplace.initialize, (admin, admin, scity, treasury, 250))
                )
            )
        );
        vm.prank(admin);
        mp.setCollection(address(units), true);
        uint256 id = buyUnit(7, 1);

        Marketplace.Item[] memory items = new Marketplace.Item[](1);
        items[0] = Marketplace.Item(address(units), id);
        vm.startPrank(buyer);
        units.setApprovalForAll(address(mp), true);
        // forge-lint: disable-next-line(environment-read-across-mutation)
        uint256 listingId = mp.list(items, 2000 ether, uint64(block.timestamp + 1 days));
        vm.stopPrank();

        uint256 devBefore = scity.balanceOf(dev);
        vm.startPrank(other);
        scity.approve(address(mp), type(uint256).max);
        mp.buy(listingId, 2000 ether);
        vm.stopPrank();
        assertEq(units.ownerOf(id), other);
        // 2% de royalty ao construtor.
        assertEq(scity.balanceOf(dev) - devBefore, 40 ether);
    }

    function test_pauseStopsSalesRentAndTransfers() public {
        uint256 id = buyUnit(7, 1);
        vm.startPrank(admin);
        market.pause();
        units.pause();
        vm.stopPrank();

        UnitMarket.UnitSale memory s = sale(8, 2);
        bytes memory sig = sign(s, signerKey);
        vm.prank(buyer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        market.buyPrimary(s, sig);
        vm.prank(buyer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        units.transferFrom(buyer, other, id);
    }

    function test_feeLimits() public {
        vm.prank(admin);
        vm.expectRevert(UnitMarket.FeeTooHigh.selector);
        market.setFees(treasury, 1001, 100);
        vm.prank(admin);
        vm.expectRevert(UnitNFT.RoyaltyTooHigh.selector);
        units.setRoyaltyBps(1001);
        vm.prank(admin);
        market.setFees(treasury, 0, 0);
        uint256 devBefore = scity.balanceOf(dev);
        buyUnit(9, 3);
        assertEq(scity.balanceOf(dev) - devBefore, PRICE);
    }

    function testFuzz_primarySplitAddsUp(uint256 price, uint16 feeBps) public {
        price = bound(price, 0, 5000 ether);
        feeBps = uint16(bound(feeBps, 0, 1000));
        vm.prank(admin);
        market.setFees(treasury, feeBps, 1000);
        UnitMarket.UnitSale memory s = sale(11, 4);
        s.price = price;
        bytes memory sig = sign(s, signerKey);
        uint256 buyerBefore = scity.balanceOf(buyer);
        uint256 devBefore = scity.balanceOf(dev);
        vm.prank(buyer);
        market.buyPrimary(s, sig);
        assertEq(buyerBefore - scity.balanceOf(buyer), price);
        assertEq((scity.balanceOf(dev) - devBefore) + scity.balanceOf(treasury), price);
    }
    // ------------------------------------------------------------------ bordas

    function test_constructorsRejectZeroAndHighFees() public {
        vm.expectRevert(UnitNFT.ZeroAddress.selector);
        new UnitNFT(address(0), "");
        vm.expectRevert(UnitMarket.ZeroAddress.selector);
        new UnitMarket(admin, units, building, scity, address(0), 500, 1000);
        vm.expectRevert(UnitMarket.FeeTooHigh.selector);
        new UnitMarket(admin, units, building, scity, treasury, 500, 1001);
    }

    function test_unitNftEdges() public {
        uint256 id = buyUnit(7, 1);
        assertEq(units.tokenURI(id), "http://localhost:8030/v1/world/nft/units/1");
        vm.prank(admin);
        units.setBaseURI("ipfs://unidades/");
        assertEq(units.tokenURI(id), "ipfs://unidades/1");
        vm.prank(admin);
        units.setRoyaltyBps(300);
        assertEq(units.royaltyBps(), 300);
        // ERC-721, EIP-2981 e AccessControl.
        assertTrue(units.supportsInterface(0x80ac58cd));
        assertTrue(units.supportsInterface(0x2a55205a));
        assertTrue(units.supportsInterface(0x7965db0b));
        vm.expectRevert();
        units.unitOf(999);

        UnitNFT.Unit memory u = UnitNFT.Unit(buildingId, 2, 1, 5000, bytes16("0101"));
        vm.startPrank(admin);
        units.grantRole(units.MINTER_ROLE(), admin);
        vm.expectRevert(UnitNFT.ZeroAddress.selector);
        units.mint(address(0), dev, u);
        vm.expectRevert(UnitNFT.ZeroAddress.selector);
        units.mint(other, address(0), u);
        units.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        units.mint(other, dev, u);
        units.unpause();
        units.mint(other, dev, u);
        vm.stopPrank();
        assertEq(units.ownerOf(2), other);
    }

    function test_unitMarketEdges() public {
        vm.prank(admin);
        vm.expectRevert(UnitMarket.ZeroAddress.selector);
        market.setFees(address(0), 500, 1000);

        uint256 id = buyUnit(7, 1);
        assertEq(market.tenantOf(id), address(0));
        vm.startPrank(admin);
        market.pause();
        market.unpause();
        vm.stopPrank();
        vm.prank(buyer);
        market.setRent(id, RENT);
        assertEq(market.rentPrice(id), RENT);
    }
}
