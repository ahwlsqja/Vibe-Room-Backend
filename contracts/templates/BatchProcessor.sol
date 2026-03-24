// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BatchProcessor — Parallel Batch Operations with Per-User Job Queues
/// @author Vibe Coding Template
/// @notice Processes batch operations where each user has an independent job queue.
/// @dev **Monad Parallel Execution Pattern — Per-User Job Queues**:
///      Each user's jobs are stored in `userJobs[user]`, an independent mapping slot.
///      When user A submits a batch and user B processes their jobs, these operations
///      touch completely disjoint storage, enabling Monad's parallel execution engine
///      to process them simultaneously.
///
///      This pattern is ideal for: batch token distributions, multi-recipient airdrops,
///      parallel task processing, and any operation where independent user queues
///      eliminate shared-state contention.
///
///      The key insight is that each user's job array and status tracking are fully
///      independent — there is no shared "global job queue" that would serialize processing.
contract BatchProcessor {
    enum JobStatus { Pending, Processing, Completed, Failed }

    struct Job {
        address target;
        uint256 value;
        bytes data;
        JobStatus status;
        uint256 createdAt;
    }

    /// @notice Per-user job queue — each user's jobs are in independent storage.
    /// @dev `userJobs[userA]` and `userJobs[userB]` occupy disjoint storage slots.
    ///      Submitting and processing jobs for different users can execute in full parallel.
    mapping(address => Job[]) public userJobs;

    /// @notice Per-user job count for quick lookups
    mapping(address => uint256) public pendingCount;

    /// @notice Maximum batch size to prevent gas limit issues
    uint256 public constant MAX_BATCH_SIZE = 50;

    /// @notice Contract owner
    address public immutable owner;

    event JobSubmitted(address indexed user, uint256 indexed jobIndex, address target, uint256 value);
    event JobProcessed(address indexed user, uint256 indexed jobIndex, bool success);
    event BatchSubmitted(address indexed user, uint256 count);
    event BatchProcessed(address indexed user, uint256 successCount, uint256 failCount);

    modifier onlyOwner() {
        require(msg.sender == owner, "BatchProcessor: not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Submit a single job to your personal queue.
    /// @dev Only modifies `userJobs[msg.sender]` — parallel-safe across different users.
    /// @param target Address to call when job is processed
    /// @param value ETH value to send with the call
    /// @param data Calldata for the target call
    /// @return jobIndex Index of the submitted job
    function submitJob(address target, uint256 value, bytes calldata data) external returns (uint256 jobIndex) {
        require(target != address(0), "BatchProcessor: zero target");

        jobIndex = userJobs[msg.sender].length;
        userJobs[msg.sender].push(Job({
            target: target,
            value: value,
            data: data,
            status: JobStatus.Pending,
            createdAt: block.timestamp
        }));
        pendingCount[msg.sender] += 1;

        emit JobSubmitted(msg.sender, jobIndex, target, value);
    }

    /// @notice Submit multiple jobs in a single transaction.
    /// @dev Batch submission to your own queue — only touches `userJobs[msg.sender]`.
    /// @param targets Array of target addresses
    /// @param values Array of ETH values
    /// @param datas Array of calldata
    function submitBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata datas
    ) external {
        uint256 count = targets.length;
        require(count > 0 && count <= MAX_BATCH_SIZE, "BatchProcessor: invalid batch size");
        require(count == values.length && count == datas.length, "BatchProcessor: length mismatch");

        for (uint256 i = 0; i < count; i++) {
            require(targets[i] != address(0), "BatchProcessor: zero target");
            userJobs[msg.sender].push(Job({
                target: targets[i],
                value: values[i],
                data: datas[i],
                status: JobStatus.Pending,
                createdAt: block.timestamp
            }));
        }
        pendingCount[msg.sender] += count;

        emit BatchSubmitted(msg.sender, count);
    }

    /// @notice Process pending jobs in your queue.
    /// @dev Only modifies `userJobs[msg.sender]` — parallel-safe across different users.
    ///      Each user processes their own queue independently, enabling Monad to execute
    ///      processing for user A and user B simultaneously.
    /// @param maxJobs Maximum number of jobs to process in this call
    function processMyJobs(uint256 maxJobs) external {
        Job[] storage jobs = userJobs[msg.sender];
        uint256 processed = 0;
        uint256 succeeded = 0;
        uint256 failed = 0;

        for (uint256 i = 0; i < jobs.length && processed < maxJobs; i++) {
            if (jobs[i].status != JobStatus.Pending) continue;

            jobs[i].status = JobStatus.Processing;
            processed++;

            (bool success, ) = jobs[i].target.call{value: jobs[i].value}(jobs[i].data);
            if (success) {
                jobs[i].status = JobStatus.Completed;
                succeeded++;
            } else {
                jobs[i].status = JobStatus.Failed;
                failed++;
            }

            emit JobProcessed(msg.sender, i, success);
        }

        pendingCount[msg.sender] -= processed;
        emit BatchProcessed(msg.sender, succeeded, failed);
    }

    /// @notice Get the total number of jobs for a user.
    /// @param user Address to query
    /// @return Total job count
    function getJobCount(address user) external view returns (uint256) {
        return userJobs[user].length;
    }

    /// @notice Get details of a specific job.
    /// @param user Address of the job owner
    /// @param jobIndex Index of the job
    /// @return target The target address
    /// @return value The ETH value
    /// @return status The current job status
    /// @return createdAt When the job was submitted
    function getJob(address user, uint256 jobIndex) external view returns (
        address target, uint256 value, JobStatus status, uint256 createdAt
    ) {
        require(jobIndex < userJobs[user].length, "BatchProcessor: invalid index");
        Job storage job = userJobs[user][jobIndex];
        return (job.target, job.value, job.status, job.createdAt);
    }

    /// @notice Accept ETH for job execution funding.
    receive() external payable {}
}
