-- sitting_percentile reads nothing but its three arguments, so it is PARALLEL SAFE. Left at the
-- default, PARALLEL UNSAFE, it kept the planner from any parallel plan for a query that calls it: a
-- standing and both points boards. The body is unchanged from 20260911190000.

CREATE OR REPLACE FUNCTION sitting_percentile(outscored bigint, tied bigint, cohort bigint)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN cohort <= 1 THEN 100::numeric ELSE
    ROUND(LEAST(
      (LEAST(GREATEST(outscored, 0), cohort)
        + LEAST(GREATEST(tied, 1), GREATEST(cohort - LEAST(GREATEST(outscored, 0), cohort), 1)) / 2.0
      ) / cohort,
      1) * 100, 2)
  END
$$;
