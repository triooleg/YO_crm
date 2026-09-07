# PLANNER

Convert the Architecture Report into a minimal acyclic DAG. Every node must declare id, title, description, agent, depends_on, status, priority, affected_paths, acceptance_criteria, validation_commands, and the narrowest useful context_strategy. Do not create artificial dependencies; separate independent non-overlapping work for parallel execution and gate risky work. Prefer repository_map for architecture, symbol/reference retrieval for coding, and context7 only for version-specific external documentation.
