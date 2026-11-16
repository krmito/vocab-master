/**
 * Spaced Repetition Scheduling based on SM-2 / Modern SRS principles.
 * Rating:
 *  1: Again (Fallo / Repetir)
 *  2: Hard (Difícil)
 *  3: Good (Bien)
 *  4: Easy (Fácil)
 */

export function calculateNextReview(card, rating, now = new Date()) {
  let {
    state = 0,         // 0: new, 1: learning, 2: review, 3: relearning
    stability = 2.5,   // Ease factor, starts at 2.5
    scheduled_days = 0,
    reps = 0,
    lapses = 0
  } = card || {};

  stability = stability || 2.5;
  reps = (reps || 0) + 1;

  let nextState = state;
  let nextScheduledDays = scheduled_days;
  let nextStability = stability;
  let nextLapses = lapses;
  let nextDueDate = new Date(now);

  if (rating === 1) { // Again
    nextLapses = lapses + 1;
    nextStability = Math.max(1.3, stability - 0.2);
    nextState = state === 2 ? 3 : 1; // relearning or learning
    nextScheduledDays = 0;
    // Due in 10 minutes
    nextDueDate = new Date(now.getTime() + 10 * 60 * 1000);
  } else if (rating === 2) { // Hard
    nextStability = Math.max(1.3, stability - 0.15);
    if (state === 0 || state === 1 || state === 3) {
      nextScheduledDays = 1;
      nextDueDate = new Date(now.getTime() + 12 * 60 * 60 * 1000); // 12 hours
      nextState = 1;
    } else {
      nextScheduledDays = Math.max(1, Math.round((scheduled_days || 1) * 1.2));
      nextDueDate = new Date(now.getTime() + nextScheduledDays * 24 * 60 * 60 * 1000);
      nextState = 2;
    }
  } else if (rating === 3) { // Good
    if (state === 0 || state === 1 || state === 3) {
      nextScheduledDays = 1;
      nextDueDate = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 1 day
      nextState = 2; // graduated
    } else {
      nextScheduledDays = Math.max(1, Math.round((scheduled_days || 1) * nextStability));
      nextDueDate = new Date(now.getTime() + nextScheduledDays * 24 * 60 * 60 * 1000);
      nextState = 2;
    }
  } else if (rating === 4) { // Easy
    nextStability = stability + 0.15;
    if (state === 0 || state === 1 || state === 3) {
      nextScheduledDays = 3;
      nextDueDate = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days
      nextState = 2; // graduated directly
    } else {
      nextScheduledDays = Math.max(2, Math.round((scheduled_days || 1) * nextStability * 1.3));
      nextDueDate = new Date(now.getTime() + nextScheduledDays * 24 * 60 * 60 * 1000);
      nextState = 2;
    }
  }

  return {
    state: nextState,
    stability: Number(nextStability.toFixed(2)),
    scheduled_days: nextScheduledDays,
    reps,
    lapses: nextLapses,
    last_review: now.toISOString(),
    due: nextDueDate.toISOString()
  };
}
