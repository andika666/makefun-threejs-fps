// The economy: money earned per round and per kill, spent in the buy menu.
// Win $3250, loss $1900 plus $500 per consecutive loss (capped at $3400),
// kill $300, plant $300, defuse $300. The player starts with $800 — enough for
// a pistol round, a save, or an SMG if they skip armor.
import { WEAPONS, GRENADE_PRICE, ARMOR_PRICE } from './weapons.js';

export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const LOSS_STREAK_BONUS = 500;
export const LOSS_REWARD_CAP = 3400;
export const KILL_REWARD = 300;
export const OBJECTIVE_REWARD = 300;

export const BUY_ITEMS = [
  { id: 'pistol', name: WEAPONS.pistol.name, price: 300, detail: '12 / 36 · headshot machine' },
  { id: 'smg', name: WEAPONS.smg.name, price: WEAPONS.smg.price, detail: '28 / 84 · close quarters' },
  { id: 'rifle', name: WEAPONS.rifle.name, price: WEAPONS.rifle.price, detail: '30 / 90 · the all-rounder' },
  { id: 'sniper', name: WEAPONS.sniper.name, price: WEAPONS.sniper.price, detail: '5 / 15 · one shot, one kill' },
  { id: 'armor', name: 'Kevlar Vest', price: ARMOR_PRICE, detail: '50 armor · halves damage' },
  { id: 'grenade', name: 'Frag Grenade', price: GRENADE_PRICE, detail: 'Blast radius 6 m' },
];

export function createEconomy() {
  const state = { money: 800, lossStreak: 0 };
  return {
    state,
    reset() {
      state.money = 800;
      state.lossStreak = 0;
    },
    earn(amount) {
      state.money += amount;
    },
    canAfford(price) {
      return state.money >= price;
    },
    // Returns true when the purchase went through.
    buy(price) {
      if (state.money < price) return false;
      state.money -= price;
      return true;
    },
    roundEnd(won) {
      if (won) {
        state.money += WIN_REWARD;
        state.lossStreak = 0;
      } else {
        state.lossStreak += 1;
        state.money += Math.min(LOSS_REWARD_CAP, LOSS_REWARD + LOSS_STREAK_BONUS * (state.lossStreak - 1));
      }
    },
  };
}
