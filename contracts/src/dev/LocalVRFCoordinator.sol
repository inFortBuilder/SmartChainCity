// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVRFConsumerV2Plus, IVRFCoordinatorV2Plus, VRFV2PlusClient} from "../vrf/VRFV2Plus.sol";

/// @notice Coordenador VRF **só para a rede local (anvil) e os testes**. Qualquer um entrega o sorteio, e o
/// número não é seguro. Na BSC (testnet e mainnet) a LuckyBox usa o coordenador real da Chainlink.
contract LocalVRFCoordinator is IVRFCoordinatorV2Plus {
    uint256 public lastRequestId;
    mapping(uint256 requestId => address consumer) public consumerOf;
    mapping(uint256 requestId => uint32 numWords) public numWordsOf;

    event RandomWordsRequested(uint256 indexed requestId, address indexed consumer, uint32 numWords);
    event RandomWordsFulfilled(uint256 indexed requestId);

    error UnknownRequest(uint256 requestId);

    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req)
        external
        returns (uint256 requestId)
    {
        requestId = ++lastRequestId;
        consumerOf[requestId] = msg.sender;
        numWordsOf[requestId] = req.numWords;
        emit RandomWordsRequested(requestId, msg.sender, req.numWords);
    }

    /// @notice Entrega números pseudoaleatórios derivados do bloco.
    function fulfill(uint256 requestId) external {
        uint256[] memory words = new uint256[](numWordsOf[requestId]);
        // forge-lint: disable-next-line(weak-prng)
        bytes32 seed = keccak256(abi.encode(blockhash(block.number - 1), block.prevrandao));
        for (uint256 i; i < words.length; ++i) {
            words[i] = uint256(keccak256(abi.encode(requestId, i, seed)));
        }
        _deliver(requestId, words);
    }

    /// @notice Entrega números escolhidos (testes determinísticos).
    function fulfillWithWords(uint256 requestId, uint256[] calldata words) external {
        _deliver(requestId, words);
    }

    function _deliver(uint256 requestId, uint256[] memory words) private {
        address consumer = consumerOf[requestId];
        if (consumer == address(0)) revert UnknownRequest(requestId);
        delete consumerOf[requestId];
        emit RandomWordsFulfilled(requestId);
        IVRFConsumerV2Plus(consumer).rawFulfillRandomWords(requestId, words);
    }
}
