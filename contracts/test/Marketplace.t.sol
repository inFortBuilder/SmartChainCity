// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {Marketplace} from "../src/Marketplace.sol";
import {SCityToken} from "../src/SCityToken.sol";

/// Coleção simples (como o LandNFT e o PropertyNFT: sem royalty).
contract PlainNFT is ERC721 {
    constructor() ERC721("Plain", "PLN") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

/// Coleção com royalty EIP-2981 (como o AvatarNFT).
contract RoyaltyNFT is ERC721, ERC2981 {
    constructor(address receiver, uint96 bps) ERC721("Royal", "RYL") {
        _setDefaultRoyalty(receiver, bps);
    }

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }

    function supportsInterface(bytes4 id) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(id);
    }
}

contract MarketplaceTest is Test {
    SCityToken scity;
    Marketplace market;
    PlainNFT land;
    PlainNFT property;
    RoyaltyNFT avatar;

    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address seller = makeAddr("seller");
    address buyer = makeAddr("buyer");
    address other = makeAddr("other");

    function setUp() public {
        scity = new SCityToken(admin);
        market = Marketplace(
            address(
                new ERC1967Proxy(
                    address(new Marketplace()),
                    abi.encodeCall(Marketplace.initialize, (admin, admin, scity, treasury, 250))
                )
            )
        );
        land = new PlainNFT();
        property = new PlainNFT();
        avatar = new RoyaltyNFT(creator, 250);
        vm.startPrank(admin);
        market.setCollection(address(land), true);
        market.setCollection(address(property), true);
        market.setCollection(address(avatar), true);
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        scity.transfer(buyer, 10_000 ether);
        vm.stopPrank();
        land.mint(seller, 1);
        property.mint(seller, 1);
        avatar.mint(seller, 7);
        vm.startPrank(seller);
        land.setApprovalForAll(address(market), true);
        property.setApprovalForAll(address(market), true);
        avatar.setApprovalForAll(address(market), true);
        vm.stopPrank();
        vm.prank(buyer);
        scity.approve(address(market), type(uint256).max);
        vm.warp(1000);
    }

    function one(address c, uint256 id) internal pure returns (Marketplace.Item[] memory items) {
        items = new Marketplace.Item[](1);
        items[0] = Marketplace.Item(c, id);
    }

    function listOne(address c, uint256 id, uint256 price) internal returns (uint256) {
        vm.prank(seller);
        return market.list(one(c, id), price, uint64(block.timestamp + 1 days));
    }

    function test_VendaComTaxaDoProtocolo() public {
        uint256 id = listOne(address(land), 1, 1000 ether);
        vm.expectEmit(true, true, true, true);
        emit Marketplace.Sold(id, seller, buyer, 1000 ether, 25 ether, 0);
        vm.prank(buyer);
        market.buy(id, 1000 ether);
        assertEq(land.ownerOf(1), buyer);
        assertEq(scity.balanceOf(treasury), 25 ether);
        assertEq(scity.balanceOf(seller), 975 ether);
        assertEq(market.listingOf(address(land), 1), 0);
        (,, bool active,) = market.listings(id);
        assertFalse(active);
    }

    function test_ComboLoteImovelERoyaltyDoAvatar() public {
        Marketplace.Item[] memory items = new Marketplace.Item[](3);
        items[0] = Marketplace.Item(address(land), 1);
        items[1] = Marketplace.Item(address(property), 1);
        items[2] = Marketplace.Item(address(avatar), 7);
        vm.prank(seller);
        uint256 id = market.list(items, 3000 ether, uint64(block.timestamp + 1 days));
        vm.prank(buyer);
        market.buy(id, 3000 ether);
        // Tudo passa junto; o royalty de 2,5% vale só sobre a parte do avatar (1/3 do preço).
        assertEq(land.ownerOf(1), buyer);
        assertEq(property.ownerOf(1), buyer);
        assertEq(avatar.ownerOf(7), buyer);
        assertEq(scity.balanceOf(creator), 25 ether);
        assertEq(scity.balanceOf(treasury), 75 ether);
        assertEq(scity.balanceOf(seller), 2900 ether);
    }

    function test_CompraRecusaVencidaPrecoMaiorPropriaEVendidaFora() public {
        uint256 id = listOne(address(land), 1, 1000 ether);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.PriceChanged.selector, 1000 ether));
        market.buy(id, 999 ether);
        vm.prank(seller);
        vm.expectRevert(Marketplace.SelfPurchase.selector);
        market.buy(id, 1000 ether);
        // O vendedor passou o lote para outra carteira (ou o leilão apreendeu): a listagem ficou velha.
        vm.prank(seller);
        land.transferFrom(seller, other, 1);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.ListingStale.selector, address(land), 1));
        market.buy(id, 1000 ether);
        vm.warp(block.timestamp + 2 days);
        vm.prank(buyer);
        vm.expectRevert(Marketplace.Expired.selector);
        market.buy(id, 1000 ether);
    }

    function test_ListagemRecusaSemPosseSemAprovacaoColecaoForaEDuplicada() public {
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.NotOwner.selector, address(land), 1));
        market.list(one(address(land), 1), 1 ether, uint64(block.timestamp + 1 days));

        land.mint(other, 2);
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.NotApproved.selector, address(land), 2));
        market.list(one(address(land), 2), 1 ether, uint64(block.timestamp + 1 days));

        PlainNFT outsider = new PlainNFT();
        outsider.mint(seller, 1);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.CollectionNotAllowed.selector, address(outsider)));
        market.list(one(address(outsider), 1), 1 ether, uint64(block.timestamp + 1 days));

        uint256 id = listOne(address(land), 1, 1 ether);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.AlreadyListed.selector, id));
        market.list(one(address(land), 1), 2 ether, uint64(block.timestamp + 1 days));

        Marketplace.Item[] memory twice = new Marketplace.Item[](2);
        twice[0] = Marketplace.Item(address(avatar), 7);
        twice[1] = Marketplace.Item(address(avatar), 7);
        vm.prank(seller);
        vm.expectRevert(Marketplace.BadItems.selector);
        market.list(twice, 1 ether, uint64(block.timestamp + 1 days));
        vm.prank(seller);
        vm.expectRevert(Marketplace.ZeroPrice.selector);
        market.list(one(address(avatar), 7), 0, uint64(block.timestamp + 1 days));
        vm.prank(seller);
        vm.expectRevert(Marketplace.BadExpiry.selector);
        market.list(one(address(avatar), 7), 1 ether, uint64(block.timestamp));
    }

    function test_NovoDonoRelistaEAListagemVelhaFecha() public {
        uint256 old = listOne(address(land), 1, 1 ether);
        vm.prank(seller);
        land.transferFrom(seller, other, 1);
        vm.startPrank(other);
        land.setApprovalForAll(address(market), true);
        uint256 id = market.list(one(address(land), 1), 5 ether, uint64(block.timestamp + 1 days));
        vm.stopPrank();
        (,, bool oldActive,) = market.listings(old);
        assertFalse(oldActive);
        assertEq(market.listingOf(address(land), 1), id);
        vm.prank(buyer);
        market.buy(id, 5 ether);
        assertEq(land.ownerOf(1), buyer);
    }

    function test_CancelaSoVendedorOuAdmin() public {
        uint256 id = listOne(address(land), 1, 1 ether);
        vm.prank(other);
        vm.expectRevert(Marketplace.NotSeller.selector);
        market.cancel(id);
        vm.prank(seller);
        market.cancel(id);
        vm.prank(buyer);
        vm.expectRevert(Marketplace.NotActive.selector);
        market.buy(id, 1 ether);
        uint256 id2 = listOne(address(land), 1, 1 ether);
        vm.prank(admin);
        market.cancel(id2);
        assertEq(market.listingOf(address(land), 1), 0);
    }

    function test_PausaParaListarEComprar() public {
        uint256 id = listOne(address(land), 1, 1 ether);
        vm.prank(admin);
        market.pause();
        vm.prank(buyer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        market.buy(id, 1 ether);
        vm.prank(seller);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        market.list(one(address(avatar), 7), 1 ether, uint64(block.timestamp + 1 days));
    }

    function test_TaxaTemTeto() public {
        vm.prank(admin);
        vm.expectRevert(Marketplace.FeeTooHigh.selector);
        market.setFee(treasury, 1001);
        vm.prank(other);
        vm.expectRevert();
        market.setFee(treasury, 100);
    }

    // ------------------------------------------------------------------ leilão

    address bidder2 = makeAddr("bidder2");

    function auctionOne(address c, uint256 id, uint256 start) internal returns (uint256) {
        vm.prank(seller);
        return market.createAuction(one(c, id), start, 1 days);
    }

    function fund(address who, uint256 amount) internal {
        vm.prank(admin);
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        scity.transfer(who, amount);
        vm.prank(who);
        scity.approve(address(market), type(uint256).max);
    }

    function test_LeilaoGuardaONftLancesDevolvemOAnteriorEVencedorLeva() public {
        fund(bidder2, 10_000 ether);
        uint256 id = auctionOne(address(land), 1, 100 ether);
        assertEq(land.ownerOf(1), address(market)); // guardado até o fim
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.BidTooLow.selector, 100 ether));
        market.bid(id, 99 ether);
        vm.prank(buyer);
        market.bid(id, 100 ether);
        assertEq(market.minimumBid(id), 105 ether); // +5%
        vm.prank(bidder2);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.BidTooLow.selector, 105 ether));
        market.bid(id, 104 ether);
        vm.prank(bidder2);
        market.bid(id, 200 ether);
        assertEq(scity.balanceOf(buyer), 10_000 ether); // o lance anterior voltou
        assertEq(scity.balanceOf(address(market)), 200 ether);

        vm.prank(buyer);
        vm.expectRevert(Marketplace.AuctionNotEnded.selector);
        market.settle(id);
        vm.warp(block.timestamp + 1 days);
        vm.prank(buyer);
        vm.expectRevert(Marketplace.AuctionEnded.selector);
        market.bid(id, 300 ether);
        vm.prank(other); // qualquer um fecha
        market.settle(id);
        assertEq(land.ownerOf(1), bidder2);
        assertEq(scity.balanceOf(treasury), 5 ether);
        assertEq(scity.balanceOf(seller), 195 ether);
        assertEq(scity.balanceOf(address(market)), 0);
        vm.expectRevert(Marketplace.NotActive.selector);
        market.settle(id);
    }

    function test_LanceNoFimEsticaOPrazo() public {
        uint256 id = auctionOne(address(land), 1, 100 ether);
        (, uint64 endsAt,,,,) = market.auctions(id);
        vm.warp(endsAt - 60);
        vm.prank(buyer);
        market.bid(id, 100 ether);
        (, uint64 newEnd,,,,) = market.auctions(id);
        assertEq(newEnd, uint64(block.timestamp) + 10 minutes);
    }

    function test_SemLanceVoltaAoVendedorECancelamento() public {
        uint256 id = auctionOne(address(land), 1, 100 ether);
        vm.warp(block.timestamp + 1 days);
        market.settle(id);
        assertEq(land.ownerOf(1), seller);

        vm.prank(seller);
        land.setApprovalForAll(address(market), true);
        uint256 id2 = auctionOne(address(land), 1, 100 ether);
        vm.prank(seller);
        market.cancelAuction(id2); // sem lance, o vendedor cancela
        assertEq(land.ownerOf(1), seller);

        uint256 id3 = auctionOne(address(land), 1, 100 ether);
        vm.prank(buyer);
        market.bid(id3, 100 ether);
        vm.prank(seller);
        vm.expectRevert(Marketplace.HasBids.selector);
        market.cancelAuction(id3);
        vm.prank(admin); // moderação: devolve o lance e o lote
        market.cancelAuction(id3);
        assertEq(land.ownerOf(1), seller);
        assertEq(scity.balanceOf(buyer), 10_000 ether);
    }

    function test_ComboComRoyaltyEVendaAPrecoFixoDoMesmoNftCai() public {
        uint256 listing = listOne(address(avatar), 7, 50 ether);
        Marketplace.Item[] memory items = new Marketplace.Item[](2);
        items[0] = Marketplace.Item(address(land), 1);
        items[1] = Marketplace.Item(address(avatar), 7);
        vm.prank(seller);
        uint256 id = market.createAuction(items, 1000 ether, 2 hours);
        (,, bool listed,) = market.listings(listing);
        assertFalse(listed); // o avatar foi para o leilão
        vm.prank(buyer);
        market.bid(id, 1000 ether);
        vm.warp(block.timestamp + 2 hours);
        market.settle(id);
        assertEq(land.ownerOf(1), buyer);
        assertEq(avatar.ownerOf(7), buyer);
        assertEq(scity.balanceOf(creator), 12.5 ether); // 2,5% da metade do preço
        assertEq(scity.balanceOf(treasury), 25 ether);
        assertEq(scity.balanceOf(seller), 962.5 ether);
    }

    function test_NftQueSaiuDoLeilaoDesfazAVenda() public {
        uint256 id = auctionOne(address(land), 1, 100 ether);
        vm.prank(buyer);
        market.bid(id, 100 ether);
        // Simula a apreensão (ADR-0016): o token sai do contrato sem passar pelo mercado.
        vm.prank(address(market));
        land.transferFrom(address(market), other, 1);
        vm.warp(block.timestamp + 1 days);
        market.settle(id);
        assertEq(scity.balanceOf(buyer), 10_000 ether); // o lance voltou
        assertEq(land.ownerOf(1), other);
    }

    function test_LeilaoRecusaPrazoProprioLanceEPausa() public {
        vm.prank(seller);
        vm.expectRevert(Marketplace.BadDuration.selector);
        market.createAuction(one(address(land), 1), 1 ether, 30 minutes);
        uint256 id = auctionOne(address(land), 1, 1 ether);
        vm.prank(seller);
        vm.expectRevert(Marketplace.SelfPurchase.selector);
        market.bid(id, 1 ether);
        vm.prank(admin);
        market.pause();
        vm.prank(buyer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        market.bid(id, 1 ether);
    }
}
