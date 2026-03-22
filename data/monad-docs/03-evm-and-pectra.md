# Monad EVM 및 Pectra Fork

## EVM 호환성

- Monad는 **Pectra fork** 수준의 EVM 구현
- Ethereum과 **동일한 merkle root** 생성 (역사적 트랜잭션 시뮬레이션 검증)

## Opcode

- Pectra fork 기준 모든 opcode 지원
- Opcode 가스 비용은 Ethereum과 대부분 동일 (일부 repricing 있음)
- [Opcode Pricing](https://docs.monad.xyz/developer-essentials/opcode-pricing) 참조

## Precompiles

- Ethereum Pectra: `0x01` ~ `0x11`
- 추가: `0x0100` (EIP-7951)

## 컨트랙트 크기

| 네트워크 | 최대 크기 |
|---------|----------|
| Ethereum | 24.5 kb |
| Monad | **128 kb** |

## Cancun/Pectra 기능

- TSTORE, TLOAD, MCOPY 등 지원
- EIP-2718 typed transactions
