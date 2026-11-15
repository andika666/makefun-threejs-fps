// Rounds and the match: buy phase, live round, round end, next round. A round
// ends on elimination, on the bomb exploding or being defused, or on the timer
// running out (defenders win). First team to 5 round wins takes the match.
// The module owns the clock and the score; main.js owns what the player sees.
export const BUY_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const ROUND_END_SECONDS = 4;
export const WIN_ROUNDS = 5;

export function createRounds() {
  const state = {
    phase: 'buy', // 'buy' | 'live' | 'over' | 'match'
    round: 1,
    score: { vanguard: 0, ember: 0 },
    timeLeft: BUY_SECONDS,
    endTimer: 0,
    winner: null, // 'vanguard' | 'ember' | null
    endReason: '',
    matchWinner: null,
  };

  function reset() {
    state.phase = 'buy';
    state.round = 1;
    state.score.vanguard = 0;
    state.score.ember = 0;
    state.timeLeft = BUY_SECONDS;
    state.endTimer = 0;
    state.winner = null;
    state.endReason = '';
    state.matchWinner = null;
  }

  function startRound() {
    state.phase = 'live';
    state.timeLeft = ROUND_SECONDS;
    state.winner = null;
    state.endReason = '';
  }

  function endRound(winner, reason) {
    if (state.phase === 'over' || state.phase === 'match') return false;
    state.phase = 'over';
    state.winner = winner;
    state.endReason = reason;
    state.score[winner] += 1;
    state.endTimer = ROUND_END_SECONDS;
    if (state.score[winner] >= WIN_ROUNDS) state.matchWinner = winner;
    return true;
  }

  function nextRound() {
    state.round += 1;
    state.phase = 'buy';
    state.timeLeft = BUY_SECONDS;
    state.winner = null;
    state.endReason = '';
    state.endTimer = 0;
  }

  function step(dt) {
    if (state.phase === 'buy' || state.phase === 'live') {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) {
        state.timeLeft = 0;
        if (state.phase === 'buy') return 'buy-timeout';
        return 'round-timeout';
      }
    } else if (state.phase === 'over') {
      state.endTimer -= dt;
      if (state.endTimer <= 0) return 'round-end-done';
    }
    return null;
  }

  return { state, reset, startRound, endRound, nextRound, step };
}
