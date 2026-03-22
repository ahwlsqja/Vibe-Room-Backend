# Monad RPC 및 가스 정책

## RPC 호환성

- Monad RPC는 **Ethereum RPC API**와 대부분 동일
- `eth_estimateGas`, `eth_sendRawTransaction` 등 표준 메서드 지원
- 일부 차이점: [Monad RPC Differences](https://docs.monad.xyz/reference/rpc-differences) 참조

## 가스 정책 (Gas Pricing)

### EIP-1559 호환

- Base fee, priority fee 구조 동일
- Base fee는 EIP-1559 컨트롤러와 유사하나, **증가 느림, 감소 빠름**

### 중요: gas_limit 기준 차감

Monad는 **gas_used가 아닌 gas_limit** 기준으로 가스비를 차감합니다.

```
총 차감 = value + gas_price * gas_limit
```

- **DOS 방지** 목적 (비동기 실행 환경)
- "insufficient funds" 에러 시: `gas_limit * gas_price`를 고려한 잔고 확인 필요

## Reserve Balance

- Consensus 시점에 **충분한 잔고**가 있어야 트랜잭션 포함
- 노드는 잔고 부족 시 해당 트랜잭션을 블록에 포함하지 않음

## 트랜잭션 타입

- Type 0 (Legacy), 1 (EIP-2930), 2 (EIP-1559), 4 (EIP-7702) 지원
- EIP-2718 typed transaction envelope 사용
