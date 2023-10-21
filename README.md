# fhEVM testing

It's a testing project for fhEVM. There used to be a dilemma in blockchain: keep your application and user data on-chain, allowing everyone to see it, or keep it privately off-chain and lose contract composability. Thanks to a breakthrough in homomorphic encryption, Zama’s fhEVM makes it possible to run confidential smart contracts on encrypted data, guaranteeing both confidentiality and composability.

## Zama’s fhEVM enables confidential smart contracts using fully homomorphic encryption (FHE)

- End-to-end encryption of transactions and state: Data included in transactions is encrypted and never visible to anyone.
- Composability and data availability on-chain: States are updated while remaining encrypted at all times.
- No impact on existing dapps and state: Encrypted state co-exist alongside public one, and doesn't impact existing dapps.

## Developers can write confidential smart contracts without learning cryptography

- Solidity Integration: fhEVM contracts are simple solidity contracts that are built using traditional solidity toolchains.
- Simple Developer Experience: Developers can use the euint data types to mark which part of their contracts should be private.
- Programmable Privacy: All the logic for access control of encrypted states is defined by developers in their smart contracts.