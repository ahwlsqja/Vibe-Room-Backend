# Monad Consensus 및 Mempool

## Consensus

- **MonadBFT**: Tail-fork resistant pipelined BFT
- Consensus와 Execution이 **파이프라인** 방식으로 동시 진행
- 블록 제안: 정렬된 트랜잭션 목록 + k=3 블록 이전의 지연된 state merkle root

## Block & Finality

- **Block frequency**: 400ms
- **Speculative finality**: 400ms
- **Full finality**: 800ms

## Mempool

- **Local mempool** (Ethereum의 global mempool과 상이)
- RPC가 트랜잭션 수신 시 → 다음 3명의 리더에게 전달
- 포함되지 않으면 2회 추가 전달 시도

## Transaction Lifecycle

1. RPC 수신
2. 다음 3명 리더의 local mempool로 전달
3. 블록에 포함되지 않으면 재전달 (최대 2회)
