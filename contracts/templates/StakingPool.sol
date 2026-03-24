// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title StakingPool — Per-User Staking with Reward Distribution
/// @author Vibe Coding Template
/// @notice A staking pool where each user's stake is tracked independently.
/// @dev **Parallel execution pattern**: Each user's staking position is stored in
///      `stakes[user]`, an independent mapping slot. When user A stakes and user B
///      unstakes, they touch disjoint storage, enabling parallel execution on Monad.
///
///      Reward calculation uses a "reward per token" accumulator pattern:
///      - `rewardPerTokenStored` tracks cumulative rewards per staked unit
///      - `userRewardPerTokenPaid[user]` tracks the last checkpoint per user
///      - Pending rewards = stake * (current_rewardPerToken - userRewardPerTokenPaid)
///
///      The per-user checkpoint values are independent storage slots, but
///      `rewardPerTokenStored` and `totalStaked` are shared state. Stake/unstake
///      operations do serialize on these shared counters, but Monad can still
///      parallelize claim-only operations which only touch per-user slots.
contract StakingPool {
    /// @notice Per-user stake amount — independent storage slots
    mapping(address => uint256) public stakes;

    /// @notice Per-user reward checkpoint — independent storage slots
    mapping(address => uint256) public userRewardPerTokenPaid;

    /// @notice Per-user accumulated rewards — independent storage slots
    mapping(address => uint256) public rewards;

    /// @notice Total staked across all users
    uint256 public totalStaked;

    /// @notice Cumulative reward per staked token (scaled by 1e18)
    uint256 public rewardPerTokenStored;

    /// @notice Reward rate: tokens distributed per second
    uint256 public rewardRate;

    /// @notice Last time rewards were updated
    uint256 public lastUpdateTime;

    /// @notice End time of the reward period
    uint256 public rewardPeriodEnd;

    /// @notice Pool owner who can fund rewards
    address public immutable owner;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event RewardsFunded(uint256 amount, uint256 duration);

    modifier onlyOwner() {
        require(msg.sender == owner, "Staking: not owner");
        _;
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = _lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Stake ETH into the pool.
    /// @dev Updates per-user state in `stakes[msg.sender]` and shared `totalStaked`.
    ///      While `totalStaked` is shared, different users' stake entries are independent.
    function stake() external payable updateReward(msg.sender) {
        require(msg.value > 0, "Staking: zero amount");
        stakes[msg.sender] += msg.value;
        totalStaked += msg.value;
        emit Staked(msg.sender, msg.value);
    }

    /// @notice Unstake ETH from the pool.
    /// @param amount Amount to unstake
    function unstake(uint256 amount) external updateReward(msg.sender) {
        require(amount > 0, "Staking: zero amount");
        require(stakes[msg.sender] >= amount, "Staking: insufficient stake");

        stakes[msg.sender] -= amount;
        totalStaked -= amount;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Staking: transfer failed");

        emit Unstaked(msg.sender, amount);
    }

    /// @notice Claim accumulated rewards.
    /// @dev Only modifies per-user state (`rewards[msg.sender]`) — parallel-safe
    ///      when different users claim simultaneously, as each user's reward
    ///      and checkpoint slots are independent.
    function claimReward() external updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        require(reward > 0, "Staking: no rewards");

        rewards[msg.sender] = 0;

        (bool success, ) = msg.sender.call{value: reward}("");
        require(success, "Staking: transfer failed");

        emit RewardClaimed(msg.sender, reward);
    }

    /// @notice Fund the reward pool (owner only).
    /// @param duration Duration in seconds for the reward distribution
    function fundRewards(uint256 duration) external payable onlyOwner updateReward(address(0)) {
        require(msg.value > 0, "Staking: zero funding");
        require(duration > 0, "Staking: zero duration");

        if (block.timestamp < rewardPeriodEnd) {
            uint256 remaining = rewardPeriodEnd - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (msg.value + leftover) / duration;
        } else {
            rewardRate = msg.value / duration;
        }

        lastUpdateTime = block.timestamp;
        rewardPeriodEnd = block.timestamp + duration;

        emit RewardsFunded(msg.value, duration);
    }

    /// @notice Calculate current reward per token.
    /// @return Current cumulative reward per staked token (scaled by 1e18)
    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        return rewardPerTokenStored +
            ((_lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) / totalStaked;
    }

    /// @notice Calculate pending rewards for an account.
    /// @param account Address to query
    /// @return Pending reward amount
    function earned(address account) public view returns (uint256) {
        return (stakes[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18
            + rewards[account];
    }

    /// @dev Returns the last timestamp where rewards are applicable.
    function _lastTimeRewardApplicable() private view returns (uint256) {
        return block.timestamp < rewardPeriodEnd ? block.timestamp : rewardPeriodEnd;
    }
}
