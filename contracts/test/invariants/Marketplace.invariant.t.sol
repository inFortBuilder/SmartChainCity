// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {Marketplace} from "../../src/Marketplace.sol";
import {SCityToken} from "../../src/SCityToken.sol";

contract InvNFT is ERC721 {
    constructor() ERC721("Inv", "INV") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

/// Ações aleatórias no mercado (fuzz com estado): listar, comprar, cancelar, leiloar, dar lance, encerrar.
contract MarketHandler is Test {
    Marketplace public market;
    SCityToken public scity;
    InvNFT public nft;
    address[] public actors;
    uint256 public constant TOKENS = 12;
    /// Quantas vezes cada caminho de verdade passou (para conferir que o fuzz chega neles).
    uint256 public buys;
    uint256 public bids;
    uint256 public settles;
    uint256 public auctionCancels;
    uint256 public created;
    uint256 public bidTries;

    constructor(Marketplace market_, SCityToken scity_, InvNFT nft_, address[] memory actors_) {
        market = market_;
        scity = scity_;
        nft = nft_;
        actors = actors_;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _one(uint256 tokenId) internal view returns (Marketplace.Item[] memory items) {
        items = new Marketplace.Item[](1);
        items[0] = Marketplace.Item({collection: address(nft), tokenId: tokenId});
    }

    function list(uint256 tokenSeed, uint256 price) external {
        uint256 id = tokenSeed % TOKENS;
        address owner = nft.ownerOf(id);
        if (owner == address(market)) return;
        vm.prank(owner);
        try market.list(_one(id), bound(price, 1 ether, 50 ether), uint64(block.timestamp + 3 days)) {}
            catch {}
    }

    function buy(uint256 buyerSeed, uint256 listingSeed) external {
        uint256 last = market.nextListingId();
        if (last <= 1) return;
        uint256 id = bound(listingSeed, 1, last - 1);
        (,, bool active, uint256 price) = market.listings(id);
        if (!active) return;
        address buyer = _actor(buyerSeed);
        vm.startPrank(buyer);
        scity.approve(address(market), price);
        try market.buy(id, price) {
            buys++;
        } catch {}
        vm.stopPrank();
    }

    function cancel(uint256 listingSeed) external {
        uint256 last = market.nextListingId();
        if (last <= 1) return;
        uint256 id = bound(listingSeed, 1, last - 1);
        (address seller,,,) = market.listings(id);
        vm.prank(seller);
        try market.cancel(id) {} catch {}
    }

    function createAuction(uint256 tokenSeed, uint256 start) external {
        uint256 id = tokenSeed % TOKENS;
        address owner = nft.ownerOf(id);
        if (owner == address(market)) return;
        vm.prank(owner);
        try market.createAuction(_one(id), bound(start, 1 ether, 20 ether), 1 days) {
            created++;
        } catch {}
    }

    function bid(uint256 bidderSeed, uint256 auctionSeed, uint256 extra) external {
        uint256 last = market.nextAuctionId();
        if (last <= 1) return;
        uint256 id = bound(auctionSeed, 1, last - 1);
        (,, bool active,,,) = market.auctions(id);
        if (!active) return;
        uint256 amount;
        try market.minimumBid(id) returns (uint256 m) {
            amount = m + bound(extra, 0, 5 ether);
        } catch {
            return;
        }
        bidTries++;
        address bidder = _actor(bidderSeed);
        (address seller,,,,,) = market.auctions(id);
        // O vendedor não dá lance no próprio leilão: passa para o próximo ator.
        if (bidder == seller) bidder = _actor(bidderSeed + 1);
        vm.startPrank(bidder);
        scity.approve(address(market), amount);
        try market.bid(id, amount) {
            bids++;
        } catch {}
        vm.stopPrank();
    }

    function settle(uint256 auctionSeed) external {
        uint256 last = market.nextAuctionId();
        if (last <= 1) return;
        try market.settle(bound(auctionSeed, 1, last - 1)) {
            settles++;
        } catch {}
    }

    function cancelAuction(uint256 auctionSeed) external {
        uint256 last = market.nextAuctionId();
        if (last <= 1) return;
        uint256 id = bound(auctionSeed, 1, last - 1);
        (address seller,,,,,) = market.auctions(id);
        vm.prank(seller);
        try market.cancelAuction(id) {
            auctionCancels++;
        } catch {}
    }

    function passTime(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 10 minutes, 1 days));
    }
}

contract MarketplaceInvariantTest is Test {
    Marketplace market;
    SCityToken scity;
    InvNFT nft;
    MarketHandler handler;
    address[] actors;
    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    uint256 supplyInPlay;

    function setUp() public {
        scity = new SCityToken(admin);
        nft = new InvNFT();
        market = Marketplace(
            address(
                new ERC1967Proxy(
                    address(new Marketplace()),
                    abi.encodeCall(Marketplace.initialize, (admin, admin, scity, treasury, 250))
                )
            )
        );
        vm.prank(admin);
        market.setCollection(address(nft), true);
        for (uint256 i; i < 4; ++i) {
            actors.push(makeAddr(string.concat("ator", vm.toString(i))));
        }
        for (uint256 i; i < actors.length; ++i) {
            vm.prank(admin);
            // forge-lint: disable-next-line(erc20-unchecked-transfer)
            scity.transfer(actors[i], 1000 ether);
            supplyInPlay += 1000 ether;
            vm.prank(actors[i]);
            nft.setApprovalForAll(address(market), true);
        }
        for (uint256 id; id < 12; ++id) {
            nft.mint(actors[id % actors.length], id);
        }
        handler = new MarketHandler(market, scity, nft, actors);
        targetContract(address(handler));
    }

    /// O SCITY no contrato é só o dos maiores lances dos leilões abertos (compra a preço fixo não passa por aqui).
    function invariant_escrowEqualsOpenBids() public view {
        uint256 sum;
        for (uint256 id = 1; id < market.nextAuctionId(); ++id) {
            (,, bool active,,, uint256 highestBid) = market.auctions(id);
            if (active) sum += highestBid;
        }
        assertEq(scity.balanceOf(address(market)), sum);
    }

    /// Todo NFT guardado no contrato é de exatamente um leilão aberto.
    function invariant_heldNftsBelongToOpenAuctions() public view {
        for (uint256 tokenId; tokenId < 12; ++tokenId) {
            if (nft.ownerOf(tokenId) != address(market)) continue;
            uint256 owners;
            for (uint256 id = 1; id < market.nextAuctionId(); ++id) {
                (,, bool active,,,) = market.auctions(id);
                if (!active) continue;
                Marketplace.Item[] memory items = market.auctionItemsOf(id);
                for (uint256 k; k < items.length; ++k) {
                    if (items[k].collection == address(nft) && items[k].tokenId == tokenId) owners++;
                }
            }
            assertEq(owners, 1);
        }
    }

    /// Os caminhos de verdade foram exercitados na sequência (visível com -vv).
    function afterInvariant() public view {
        console.log("compras", handler.buys(), "lances", handler.bids());
        console.log("encerrados", handler.settles(), "leiloes cancelados", handler.auctionCancels());
        console.log("leiloes criados", handler.created(), "tentativas de lance", handler.bidTries());
    }

    /// Ninguém cria nem some com SCITY: atores, tesouraria e contrato somam o que entrou no jogo.
    function invariant_scityConserved() public view {
        uint256 total = scity.balanceOf(address(market)) + scity.balanceOf(treasury);
        for (uint256 i; i < actors.length; ++i) {
            total += scity.balanceOf(actors[i]);
        }
        assertEq(total, supplyInPlay);
    }
}
