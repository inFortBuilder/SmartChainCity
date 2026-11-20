// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice O mínimo do Chainlink VRF v2.5 que a LuckyBox usa: o formato do pedido e a função do
/// coordenador. Os campos e a etiqueta dos argumentos extras são os mesmos do `VRFV2PlusClient` oficial,
/// então o contrato fala com o coordenador real da BSC sem depender do pacote da Chainlink.
library VRFV2PlusClient {
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes4 internal constant EXTRA_ARGS_V1_TAG = bytes4(keccak256("VRF ExtraArgsV1"));

    struct ExtraArgsV1 {
        bool nativePayment;
    }

    struct RandomWordsRequest {
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
    }

    function argsToBytes(ExtraArgsV1 memory extraArgs) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, extraArgs);
    }
}

interface IVRFCoordinatorV2Plus {
    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req)
        external
        returns (uint256 requestId);
}

/// @notice O coordenador chama esta função para entregar os números sorteados.
interface IVRFConsumerV2Plus {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}
