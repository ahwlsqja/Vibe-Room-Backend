import { OptimizerService, MonadOptimizationResult } from '../src/analysis/optimizer.service';

describe('OptimizerService', () => {
  let service: OptimizerService;

  beforeEach(() => {
    service = new OptimizerService();
  });

  describe('calculateScore', () => {
    it('should return score 100 for empty contract', () => {
      const result = service.calculateScore('');
      expect(result.score).toBe(100);
      expect(result.deductions).toHaveLength(0);
      expect(result.suggestions.length).toBeGreaterThanOrEqual(1);
    });

    it('should return high score (≥80) for simple storage contract', () => {
      const simpleContract = `
        // SPDX-License-Identifier: MIT
        pragma solidity ^0.8.19;
        
        contract SimpleStorage {
          mapping(address => uint256) private balances;
          
          function deposit() external payable {
            balances[msg.sender] += msg.value;
          }
          
          function getBalance(address user) external view returns (uint256) {
            return balances[user];
          }
        }
      `;
      const result = service.calculateScore(simpleContract);
      expect(result.score).toBeGreaterThanOrEqual(80);
    });

    it('should return low score (≤35) for centralized counter contract', () => {
      // Single global counter that every tx increments — worst case for parallel execution
      const parallelConflictContract = `
        // SPDX-License-Identifier: MIT
        pragma solidity ^0.8.19;
        
        contract ParallelConflict {
          uint256 public totalCount;
          
          function increment() external {
            totalCount += 1;
          }
        }
      `;
      const result = service.calculateScore(parallelConflictContract);
      expect(result.score).toBeLessThanOrEqual(35);
      expect(result.deductions.length).toBeGreaterThanOrEqual(1);
      // Should suggest mapping for distribution
      const hasMappingSuggestion = result.suggestions.some(
        (s) => s.toLowerCase().includes('mapping') || s.toLowerCase().includes('distribut'),
      );
      expect(hasMappingSuggestion).toBe(true);
    });

    it('should detect block property dependency', () => {
      const blockDependentContract = `
        pragma solidity ^0.8.19;
        contract TimeLock {
          mapping(address => uint256) private balances;
          function withdraw() external {
            require(block.timestamp > 1000, "Too early");
            balances[msg.sender] = 0;
          }
        }
      `;
      const result = service.calculateScore(blockDependentContract);
      expect(result.score).toBeLessThan(100);
      const hasBlockDeduction = result.deductions.some((d) =>
        d.reason.toLowerCase().includes('block'),
      );
      expect(hasBlockDeduction).toBe(true);
    });

    it('should detect loop storage access with SSTORE/SLOAD', () => {
      const loopStorageContract = `
        pragma solidity ^0.8.19;
        contract LoopStorage {
          uint256[] private data;
          function process() external {
            for (uint i = 0; i < 10; i++) {
              assembly { SSTORE(i, add(SLOAD(i), 1)) }
            }
          }
        }
      `;
      const result = service.calculateScore(loopStorageContract);
      expect(result.score).toBeLessThan(100);
    });

    it('should detect direct SLOAD/SSTORE usage', () => {
      const asmContract = `
        pragma solidity ^0.8.19;
        contract AsmStorage {
          function read() external view returns (uint256 val) {
            assembly {
              val := SLOAD(0)
              let a := SLOAD(1)
              let b := SLOAD(2)
              let c := SLOAD(3)
            }
          }
        }
      `;
      const result = service.calculateScore(asmContract);
      expect(result.score).toBeLessThan(100);
      const hasStorageDeduction = result.deductions.some((d) =>
        d.reason.toLowerCase().includes('storage opcode'),
      );
      expect(hasStorageDeduction).toBe(true);
    });
  });
});
