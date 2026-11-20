// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {LandNFT} from "../src/LandNFT.sol";
import {Payment} from "../src/lib/Payment.sol";

contract LandNFTTest is Test {
    LandNFT land;
    ERC20Mock scity;

    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address buyer = makeAddr("buyer");
    uint256 signerKey;
    address signer;

    uint32 constant PITTSBURG = 1;

    function setUp() public {
        (signer, signerKey) = makeAddrAndKey("world-signer");
        land = new LandNFT(admin, treasury, "http://localhost:4003/v1/world/nft/lots/");
        scity = new ERC20Mock();
        vm.startPrank(admin);
        land.grantRole(land.SIGNER_ROLE(), signer);
        vm.stopPrank();
        scity.mint(buyer, 10_000 ether);
        vm.deal(buyer, 10 ether);
    }

    function quote(uint32 lot, address currency, uint256 price, uint256 nonce)
        internal
        view
        returns (LandNFT.LotQuote memory)
    {
        return LandNFT.LotQuote({
            city: PITTSBURG,
            lot: lot,
            buyer: buyer,
            currency: currency,
            price: price,
            nonce: nonce,
            deadline: block.timestamp + 120
        });
    }

    function sign(LandNFT.LotQuote memory q, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, land.quoteDigest(q));
        return abi.encodePacked(r, s, v);
    }

    function test_lotIdIsReversible() public view {
        uint256 id = land.lotId(7, 100_151);
        assertEq(id, (uint256(7) << 32) | 100_151);
        (uint32 city, uint32 lot) = land.lotOf(id);
        assertEq(city, 7);
        assertEq(lot, 100_151);
    }

    function testFuzz_lotIdRoundTrip(uint32 city, uint32 lot) public view {
        (uint32 c, uint32 l) = land.lotOf(land.lotId(city, lot));
        assertEq(c, city);
        assertEq(l, lot);
    }

    function test_buyWithScityPaysTreasury() public {
        LandNFT.LotQuote memory q = quote(42, address(scity), 950 ether, 1);
        vm.startPrank(buyer);
        scity.approve(address(land), 950 ether);
        vm.expectEmit(address(land));
        emit LandNFT.LotSold(land.lotId(PITTSBURG, 42), PITTSBURG, 42, buyer, address(scity), 950 ether, 1);
        uint256 id = land.buyPrimary(q, sign(q, signerKey));
        vm.stopPrank();

        assertEq(land.ownerOf(id), buyer);
        assertEq(scity.balanceOf(treasury), 950 ether);
        assertEq(scity.balanceOf(buyer), 9050 ether);
        assertTrue(land.nonceUsed(1));
    }

    function test_buyWithNativePaysTreasury() public {
        LandNFT.LotQuote memory q = quote(43, address(0), 0.5 ether, 2);
        bytes memory sig = sign(q, signerKey);
        vm.prank(buyer);
        land.buyPrimary{value: 0.5 ether}(q, sig);
        assertEq(treasury.balance, 0.5 ether);
        assertEq(land.ownerOf(land.lotId(PITTSBURG, 43)), buyer);
    }

    /// Lote já pago no ledger do jogo: o contrato só registra a posse.
    function test_priceZeroMintsWithoutPayment() public {
        LandNFT.LotQuote memory q = quote(44, address(scity), 0, 3);
        bytes memory sig = sign(q, signerKey);
        vm.prank(buyer);
        land.buyPrimary(q, sig);
        assertEq(land.ownerOf(land.lotId(PITTSBURG, 44)), buyer);
        assertEq(scity.balanceOf(treasury), 0);
    }

    function test_rejectsWrongNativeValue() public {
        LandNFT.LotQuote memory q = quote(45, address(0), 0.5 ether, 4);
        bytes memory sig = sign(q, signerKey);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Payment.WrongValue.selector, 0.5 ether, 0.4 ether));
        land.buyPrimary{value: 0.4 ether}(q, sig);
    }

    function test_rejectsNativeValueOnTokenQuote() public {
        LandNFT.LotQuote memory q = quote(45, address(scity), 1 ether, 4);
        bytes memory sig = sign(q, signerKey);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Payment.WrongValue.selector, 0, 1));
        land.buyPrimary{value: 1}(q, sig);
    }

    function test_rejectsExpiredQuote() public {
        LandNFT.LotQuote memory q = quote(46, address(scity), 0, 5);
        bytes memory sig = sign(q, signerKey);
        vm.warp(q.deadline + 1);
        vm.prank(buyer);
        vm.expectRevert(LandNFT.QuoteExpired.selector);
        land.buyPrimary(q, sig);
    }

    function test_rejectsReusedNonce() public {
        LandNFT.LotQuote memory q = quote(47, address(scity), 0, 6);
        bytes memory sig = sign(q, signerKey);
        vm.prank(buyer);
        land.buyPrimary(q, sig);
        // Outro lote com o mesmo nonce: a cotação não pode ser usada duas vezes.
        LandNFT.LotQuote memory q2 = quote(48, address(scity), 0, 6);
        bytes memory sig2 = sign(q2, signerKey);
        vm.prank(buyer);
        vm.expectRevert(LandNFT.NonceAlreadyUsed.selector);
        land.buyPrimary(q2, sig2);
    }

    function test_rejectsUnknownSigner() public {
        (address other, uint256 otherKey) = makeAddrAndKey("intruso");
        LandNFT.LotQuote memory q = quote(49, address(scity), 0, 7);
        bytes memory sig = sign(q, otherKey);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(LandNFT.InvalidSigner.selector, other));
        land.buyPrimary(q, sig);
    }

    function test_rejectsTamperedPrice() public {
        LandNFT.LotQuote memory q = quote(50, address(scity), 950 ether, 8);
        bytes memory sig = sign(q, signerKey);
        q.price = 1 ether;
        vm.startPrank(buyer);
        scity.approve(address(land), 950 ether);
        vm.expectPartialRevert(LandNFT.InvalidSigner.selector);
        land.buyPrimary(q, sig);
        vm.stopPrank();
    }

    function test_rejectsCallerOtherThanBuyer() public {
        LandNFT.LotQuote memory q = quote(51, address(scity), 0, 9);
        bytes memory sig = sign(q, signerKey);
        vm.prank(makeAddr("outro"));
        vm.expectRevert(LandNFT.NotQuoteBuyer.selector);
        land.buyPrimary(q, sig);
    }

    function test_lotSoldTwiceReverts() public {
        LandNFT.LotQuote memory q = quote(52, address(scity), 0, 10);
        bytes memory sig = sign(q, signerKey);
        vm.prank(buyer);
        land.buyPrimary(q, sig);
        LandNFT.LotQuote memory q2 = quote(52, address(scity), 0, 11);
        bytes memory sig2 = sign(q2, signerKey);
        vm.prank(buyer);
        vm.expectRevert();
        land.buyPrimary(q2, sig2);
    }

    function test_pauseBlocksSales() public {
        vm.prank(admin);
        land.pause();
        LandNFT.LotQuote memory q = quote(53, address(scity), 0, 12);
        bytes memory sig = sign(q, signerKey);
        vm.prank(buyer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        land.buyPrimary(q, sig);
    }

    /// ADR-0014: a regra de bairro vale só no jogo; a transferência on-chain é livre.
    function test_secondaryTransferIsFree() public {
        LandNFT.LotQuote memory q = quote(54, address(scity), 0, 13);
        bytes memory sig = sign(q, signerKey);
        vm.prank(buyer);
        uint256 id = land.buyPrimary(q, sig);
        address friend = makeAddr("amigo");
        vm.prank(buyer);
        land.transferFrom(buyer, friend, id);
        assertEq(land.ownerOf(id), friend);
    }

    function test_tokenURIUsesBaseURI() public {
        LandNFT.LotQuote memory q = quote(55, address(scity), 0, 14);
        bytes memory sig = sign(q, signerKey);
        vm.prank(buyer);
        uint256 id = land.buyPrimary(q, sig);
        assertEq(
            land.tokenURI(id), string.concat("http://localhost:4003/v1/world/nft/lots/", vm.toString(id))
        );
    }

    function test_onlyAdminSetsTreasury() public {
        vm.prank(buyer);
        vm.expectRevert();
        land.setTreasury(buyer);
        vm.prank(admin);
        land.setTreasury(buyer);
        assertEq(land.treasury(), buyer);
    }
}
