# Monad 병렬 실행 (Parallel Execution)

## 요약

Monad는 트랜잭션을 **병렬로 실행**합니다. 블록은 Ethereum과 동일하게 선형 순서의 트랜잭션 집합이며, 실행 결과는 Ethereum과 동일합니다.

## Optimistic Execution

Monad는 **낙관적 실행(Optimistic Execution)**을 사용합니다.

- 트랜잭션이 이전 트랜잭션 완료를 기다리지 않고 먼저 실행을 시작할 수 있음
- 경우에 따라 잘못된 실행이 발생할 수 있음

### 예시: State Conflict

1. 트랜잭션 1: 계정 A의 잔고를 읽고 업데이트 (B로부터 전송 수신)
2. 트랜잭션 2: 계정 A의 잔고를 읽고 업데이트 (C로 전송)

두 트랜잭션이 병렬 실행되고, 트랜잭션 2가 트랜잭션 1 완료 전에 시작되면, 트랜잭션 2가 읽는 A의 잔고가 순차 실행 시와 다를 수 있어 **잘못된 실행**이 발생할 수 있습니다.

### 해결 방식

- 실행 중 트랜잭션 2가 사용한 **입력(input)**을 추적
- 트랜잭션 1의 **출력(output)**과 비교
- 다르면 트랜잭션 2가 잘못된 데이터로 실행된 것이므로 **재실행(reschedule)** 필요
- 각 트랜잭션의 상태 업데이트는 **원래 순서대로 병합(merge)**

## 관련 개념

- **Optimistic Concurrency Control (OCC)**
- **Software Transactional Memory (STM)**

## 개발자 주의사항

- nonce 충돌, state conflict 관련 에러 시 **재시도** 또는 **트랜잭션 순서** 검토
- 동일 계정/스토리지에 대한 동시 접근 시 re-execution 발생 가능
