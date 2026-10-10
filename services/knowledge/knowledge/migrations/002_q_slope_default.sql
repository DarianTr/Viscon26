-- Testbench result: a wandering learning rate (q_slope 3e-6, half-life fixed
-- at 20 days) gives honest exam-forecast intervals; 1e-7 covered only ~70%.
alter table plan_params alter column q_slope set default 0.000003;
