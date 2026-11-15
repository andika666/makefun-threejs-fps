// The look plan, in one place. VAULTLINE is a container yard at dusk: a cold blue-grey
// sky, warm sodium lamps, rust-red and teal containers, and two team colours that read at
// a glance — teal for Vanguard (attackers), ember orange for Ember (defenders).
// The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#202835', // dusk sky / fog
  ground: '#2b2f36', // asphalt
  surface: '#31363e', // walls, floors
  hairline: '#3d444e', // trim, dark metal
  ink: '#e9e6df', // near-white
  muted: '#9aa3ad', // grey text
  accent: '#f5a623', // sodium lamp amber
  rust: '#a8542f', // container red
  teal: '#2f7f7a', // container teal
  ochre: '#b98a2e', // container ochre
  slate: '#4a5568', // container slate
  vanguard: '#35c4b5', // attacker team
  ember: '#e8722a', // defender team
  danger: '#e5484d', // damage / bomb
  good: '#4cc38a', // money / win
};

export function shade(name) {
  return PALETTE[name];
}
