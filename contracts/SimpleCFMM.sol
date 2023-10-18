// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

import "../lib/TFHE.sol";
import "../dependencies/EIP712WithModifier.sol";
import "./EncryptedERC20.sol";

contract SimpleCFMM is EIP712WithModifier {
    address public owner;

    uint public fee;
    euint32 private feeAmountOfTokenA;
    euint32 private feeAmountOfTokenB;
    uint32 private DOMAIN_SEPARATOR = 10000;

    euint32 private balanceOfTokenA;
    euint32 private balanceOfTokenB;
    EncryptedERC20 public addressOfTokenA;
    EncryptedERC20 public addressOfTokenB;

    bool public isOnPause = false;
    bool private stoppable;

    mapping(address => euint32) private userBalanceOfTokenA;
    mapping(address => euint32) private userBalanceOfTokenB;

    event LiquidityAdded(address indexed provider, uint amountA, uint amountB, uint liquidity);
    event LiquidityRemoved(address indexed provider, uint amountA, uint amountB, uint liquidity);
    event Trade(address indexed trader, uint amountAIn, uint amountBOut);
    event FeeWithdrawn(address indexed owner, uint amount);

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    modifier isNotOnPause() {
        require(!isOnPause);
        _;
    }

    constructor(
        uint initialFee,
        EncryptedERC20 initialAddressOfTokenA,
        EncryptedERC20 initialAddressOfTokenB,
        bool isStoppable
    ) EIP712WithModifier("Authorization", "1") {
        owner = msg.sender;
        addressOfTokenA = initialAddressOfTokenA;
        addressOfTokenB = initialAddressOfTokenB;
        fee = initialFee;
        stoppable = isStoppable;
    }

    function addLiquidity(bytes calldata encryptedAmountA, bytes calldata encryptedAmountB) external isNotOnPause {
        euint32 amountA = TFHE.asEuint32(encryptedAmountA);
        euint32 amountB = TFHE.asEuint32(encryptedAmountB);

        require(TFHE.decrypt(TFHE.lt(0, amountA)) && TFHE.decrypt(TFHE.lt(0, amountB)));

        addressOfTokenA.transferFrom(msg.sender, address(this), amountA);
        addressOfTokenB.transferFrom(msg.sender, address(this), amountB);

        euint32 totalLiquidity = balanceOfTokenA + balanceOfTokenB;
        euint32 liquidityMinted = TFHE.div((amountA * totalLiquidity), TFHE.decrypt(amountB));
        balanceOfTokenA = balanceOfTokenA + amountA;
        balanceOfTokenB = balanceOfTokenB + amountB;

        userBalanceOfTokenA[msg.sender] = userBalanceOfTokenA[msg.sender] + amountA;
        userBalanceOfTokenB[msg.sender] = userBalanceOfTokenB[msg.sender] + amountB;

        emit LiquidityAdded(msg.sender, TFHE.decrypt(amountA), TFHE.decrypt(amountB), TFHE.decrypt(liquidityMinted));
    }

    function removeLiquidity(bytes calldata encryptedLiquidity) external isNotOnPause {
        euint32 liquidity = TFHE.asEuint32(encryptedLiquidity);

        require(TFHE.decrypt(TFHE.lt(0, liquidity)));

        euint32 amountA = TFHE.div((liquidity * balanceOfTokenA), TFHE.decrypt(balanceOfTokenA + balanceOfTokenB));
        euint32 amountB = TFHE.div((liquidity * balanceOfTokenB), TFHE.decrypt(balanceOfTokenA + balanceOfTokenB));

        require(TFHE.decrypt(TFHE.lt(amountA, balanceOfTokenA)) && TFHE.decrypt(TFHE.lt(amountB, balanceOfTokenB)));

        balanceOfTokenA = balanceOfTokenA - amountA;
        balanceOfTokenB = balanceOfTokenB - amountB;

        userBalanceOfTokenA[msg.sender] = userBalanceOfTokenA[msg.sender] - amountA;
        userBalanceOfTokenB[msg.sender] = userBalanceOfTokenB[msg.sender] - amountB;

        emit LiquidityRemoved(msg.sender, TFHE.decrypt(amountA), TFHE.decrypt(amountB), TFHE.decrypt(liquidity));

        addressOfTokenA.transfer(msg.sender, amountA);
        addressOfTokenB.transfer(msg.sender, amountB);
    }

    function trade(address token, bytes memory amountIn) external isNotOnPause {
        if (EncryptedERC20(token) == addressOfTokenA) {
            performTrade(token, TFHE.asEuint32(amountIn), balanceOfTokenA, balanceOfTokenB, feeAmountOfTokenB);
        } else {
            performTrade(token, TFHE.asEuint32(amountIn), balanceOfTokenB, balanceOfTokenA, feeAmountOfTokenA);
        }
    }

    function performTrade(
        address tokenIn,
        euint32 amountIn,
        euint32 balanceOfTokenIn,
        euint32 balanceOfTokenOut,
        euint32 feeAmountOfTokenOut
    ) private {
        require(TFHE.decrypt(TFHE.lt(0, amountIn)));

        euint32 amountOut = TFHE.div(TFHE.mul(amountIn, balanceOfTokenOut), TFHE.decrypt(balanceOfTokenIn));

        euint32 amountOfFee = TFHE.div(TFHE.mul(amountOut, TFHE.asEuint32(fee)), DOMAIN_SEPARATOR);

        euint32 amountReceived = amountOut - amountOfFee;

        balanceOfTokenIn = balanceOfTokenIn + amountIn;
        balanceOfTokenOut = balanceOfTokenOut - amountReceived;
        feeAmountOfTokenOut = feeAmountOfTokenOut + amountOfFee;

        emit Trade(msg.sender, TFHE.decrypt(amountIn), TFHE.decrypt(amountReceived));

        if (EncryptedERC20(tokenIn) == addressOfTokenA) {
            userBalanceOfTokenA[msg.sender] = userBalanceOfTokenA[msg.sender] + amountIn;
            userBalanceOfTokenB[msg.sender] = userBalanceOfTokenB[msg.sender] + amountReceived;

            addressOfTokenA.transferFrom(msg.sender, address(this), amountReceived);
            addressOfTokenB.transfer(msg.sender, amountIn);
        } else {
            userBalanceOfTokenA[msg.sender] = userBalanceOfTokenA[msg.sender] + amountReceived;
            userBalanceOfTokenB[msg.sender] = userBalanceOfTokenB[msg.sender] + amountIn;

            addressOfTokenB.transferFrom(msg.sender, address(this), amountIn);
            addressOfTokenA.transfer(msg.sender, amountReceived);
        }
    }

    function setFee(bytes calldata newFee) external onlyOwner {
        require(isOnPause);
        fee = TFHE.decrypt(TFHE.asEuint32(newFee));
    }

    function switchPause() external onlyOwner {
        require(stoppable);
        if (!isOnPause) {
            isOnPause = true;
        } else {
            isOnPause = false;
        }
    }

    function withdrawFee(address token, bytes calldata feeAmount) external onlyOwner {
        require(TFHE.decrypt(TFHE.lt(0, TFHE.asEuint32(feeAmount))));
        euint32 withdrawalFee = TFHE.asEuint32(feeAmount);
        euint32 _feeAmount = TFHE.asEuint32(feeAmount);
        _feeAmount = TFHE.NIL32;

        emit FeeWithdrawn(owner, TFHE.decrypt(withdrawalFee));

        processFee(token, withdrawalFee);
    }

    function processFee(address token, euint32 withdrawalFee) private {
        if (EncryptedERC20(token) == addressOfTokenA) {
            addressOfTokenA.transfer(owner, withdrawalFee);
        } else {
            addressOfTokenB.transfer(owner, withdrawalFee);
        }
    }

    function getFeeAmount(address token) external view onlyOwner returns (euint32) {
        if (EncryptedERC20(token) == addressOfTokenA) {
            return feeAmountOfTokenA;
        } else {
            return feeAmountOfTokenB;
        }
    }

    function getBalanceOfToken(
        address token,
        bytes32 publicKey,
        bytes calldata signature
    ) external view onlySignedPublicKey(publicKey, signature) returns (bytes memory) {
        if (EncryptedERC20(token) == addressOfTokenA) {
            return TFHE.reencrypt(balanceOfTokenA, publicKey);
        } else {
            return TFHE.reencrypt(balanceOfTokenB, publicKey);
        }
    }

    function getUserBalanceOfToken(
        address token,
        bytes32 publicKey,
        bytes calldata signature
    ) external view onlySignedPublicKey(publicKey, signature) returns (bytes memory) {
        if (EncryptedERC20(token) == addressOfTokenA) {
            return TFHE.reencrypt(userBalanceOfTokenA[msg.sender], publicKey);
        } else {
            return TFHE.reencrypt(userBalanceOfTokenB[msg.sender], publicKey);
        }
    }
}
