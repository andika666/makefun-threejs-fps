// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score,
// killfeed, a live minimap, the buy menu and the round banners. It never touches
// the simulation; main.js pushes numbers in and reads callbacks out. Every setter
// is cheap and skips DOM writes when nothing changed.
import { BUY_ITEMS } from './economy.js';

const COPY = {
  start: {
    title: 'VAULTLINE',
    copy: 'Meridian Yard, dusk. Five Vanguard attackers against five Ember defenders. Plant the charge on A or B — or clear the yard.',
    action: 'Click to play',
  },
  paused: {
    title: 'VAULTLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  match: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud(world) {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammo = $('ammo');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const grenadeCount = $('grenades');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const armorFill = $('armor-fill');
  const moneyValue = $('money');
  const roundNum = $('round-num');
  const timer = $('timer');
  const scoreVan = $('score-van');
  const scoreEmb = $('score-emb');
  const killfeed = $('killfeed');
  const bombStatus = $('bomb-status');
  const bombTimer = $('bomb-timer');
  const channel = $('channel');
  const channelFill = $('channel-fill');
  const channelLabel = $('channel-label');
  const vignette = $('vignette');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyMenu = $('buy-menu');
  const buyItems = $('buy-items');
  const buyMoney = $('buy-money');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const minimap = $('minimap');
  const mapCtx = minimap ? minimap.getContext('2d') : null;

  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';
  let lastGrenades = -1;
  let lastHealth = -1;
  let lastArmor = -1;
  let lastMoney = -1;
  let lastRound = -1;
  let lastTimer = -1;
  let lastScore = '';
  let hitTimer = 0;
  let bannerTimer = 0;

  // Build the buy menu once from the economy's item list.
  const buyButtons = [];
  if (buyItems) {
    BUY_ITEMS.forEach((item, index) => {
      const button = document.createElement('button');
      button.className = 'buy-item';
      button.type = 'button';
      button.innerHTML = `<span class="buy-key">${index + 1}</span><span class="buy-name">${item.name}</span><span class="buy-detail">${item.detail}</span><span class="buy-price">$${item.price}</span>`;
      button.addEventListener('click', () => buyHandler && buyHandler(item.id));
      buyItems.appendChild(button);
      buyButtons.push(button);
    });
  }
  let buyHandler = null;

  function formatTime(seconds) {
    const value = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  }

  return {
    setAmmo(mag, reserve) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammo.classList.toggle('empty', mag === 0);
    },
    setWeapon(name, grenades) {
      if (name !== lastWeapon) {
        lastWeapon = name;
        weaponName.textContent = name;
      }
      if (grenades !== lastGrenades) {
        lastGrenades = grenades;
        grenadeCount.textContent = grenades > 0 ? `◉ ${grenades}` : '○ 0';
        grenadeCount.classList.toggle('has', grenades > 0);
      }
    },
    setHealth(health, armor) {
      if (health !== lastHealth) {
        lastHealth = health;
        healthFill.style.width = `${Math.max(0, health)}%`;
        healthNum.textContent = String(Math.max(0, Math.ceil(health)));
        healthFill.classList.toggle('low', health <= 30);
      }
      if (armor !== lastArmor) {
        lastArmor = armor;
        armorFill.style.width = `${Math.max(0, armor)}%`;
      }
    },
    setMoney(money) {
      if (money === lastMoney) return;
      lastMoney = money;
      moneyValue.textContent = `$${money}`;
      if (buyMoney) buyMoney.textContent = `$${money}`;
    },
    setRound(round) {
      if (round === lastRound) return;
      lastRound = round;
      roundNum.textContent = `ROUND ${round}`;
    },
    setTimer(seconds, phase) {
      const text = formatTime(seconds);
      const key = `${text}|${phase}`;
      if (key === lastTimer) return;
      lastTimer = key;
      timer.textContent = text;
      timer.classList.toggle('urgent', phase === 'live' && seconds <= 10);
      timer.classList.toggle('buy', phase === 'buy');
    },
    setScore(van, emb) {
      const key = `${van}-${emb}`;
      if (key === lastScore) return;
      lastScore = key;
      scoreVan.textContent = String(van);
      scoreEmb.textContent = String(emb);
    },
    setCrosshairGap(spreadPx) {
      crosshair.style.setProperty('--gap', `${spreadPx.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      vignette.classList.remove('flash');
      void vignette.offsetWidth;
      vignette.classList.add('flash');
    },
    killfeed(killerName, victimName, killerTeam, headshot) {
      if (!killfeed) return;
      const line = document.createElement('div');
      line.className = 'kill-line';
      line.innerHTML = `<span class="${killerTeam}">${killerName}</span> <span class="kill-weapon">${headshot ? '◉' : '—'}</span> <span class="victim">${victimName}</span>`;
      killfeed.prepend(line);
      while (killfeed.children.length > 4) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => line.classList.add('fade'), 4200);
      setTimeout(() => line.remove(), 5000);
    },
    setBomb(planted, timeLeft, siteId) {
      if (!planted) {
        bombStatus.hidden = true;
        return;
      }
      bombStatus.hidden = false;
      bombTimer.textContent = `${Math.ceil(timeLeft)}s`;
      bombStatus.firstChild.textContent = `CHARGE PLANTED — SITE ${siteId} · `;
    },
    setChannel(label, progress) {
      if (!label) {
        channel.hidden = true;
        return;
      }
      channel.hidden = false;
      channelLabel.textContent = label;
      channelFill.style.width = `${Math.round(progress * 100)}%`;
    },
    showBanner(titleText, subText, good, holdMs = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.classList.toggle('good', good);
      banner.classList.toggle('bad', !good);
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { banner.hidden = true; }, holdMs);
    },
    hideBanner() {
      banner.hidden = true;
    },
    showBuyMenu(show) {
      buyMenu.hidden = !show;
    },
    refreshBuy(money) {
      buyButtons.forEach((button, index) => {
        button.classList.toggle('poor', money < BUY_ITEMS[index].price);
      });
    },
    onBuy(handler) {
      buyHandler = handler;
    },
    showOverlay(mode, scoreText) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'match' ? scoreText : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    // Top-down minimap: walls from the colliders, sites, bomb and fighters.
    drawMinimap(fighters, bomb, player) {
      if (!mapCtx) return;
      const width = minimap.width;
      const height = minimap.height;
      const scaleX = width / 56;
      const scaleY = height / 44;
      const toX = (x) => (x + 28) * scaleX;
      const toY = (z) => (z + 22) * scaleY;
      mapCtx.clearRect(0, 0, width, height);
      mapCtx.fillStyle = 'rgba(32,40,53,0.92)';
      mapCtx.fillRect(0, 0, width, height);
      mapCtx.fillStyle = 'rgba(233,230,223,0.25)';
      for (const box of world.colliders) {
        if (box.max.y < 0.6) continue;
        mapCtx.fillRect(toX(box.min.x), toY(box.min.z), (box.max.x - box.min.x) * scaleX, (box.max.z - box.min.z) * scaleY);
      }
      mapCtx.font = 'bold 11px system-ui, sans-serif';
      mapCtx.textAlign = 'center';
      mapCtx.textBaseline = 'middle';
      for (const site of world.sites) {
        mapCtx.fillStyle = bomb.state.planted && bomb.state.siteId === site.id ? '#e5484d' : '#f5a623';
        mapCtx.fillText(site.id, toX(site.center.x), toY(site.center.z));
      }
      if (bomb.state.planted) {
        mapCtx.fillStyle = '#e5484d';
        mapCtx.beginPath();
        mapCtx.arc(toX(bomb.state.position.x), toY(bomb.state.position.z), 4, 0, Math.PI * 2);
        mapCtx.fill();
      }
      for (const fighter of fighters) {
        if (!fighter.alive) continue;
        mapCtx.fillStyle = fighter.team === 'vanguard' ? '#35c4b5' : '#e8722a';
        mapCtx.beginPath();
        mapCtx.arc(toX(fighter.body.position.x), toY(fighter.body.position.z), fighter.isPlayer ? 3.5 : 2.5, 0, Math.PI * 2);
        mapCtx.fill();
      }
      if (player && player.alive) {
        const px = toX(player.body.position.x);
        const py = toY(player.body.position.z);
        const angle = Math.atan2(-Math.sin(player.body.yaw), -Math.cos(player.body.yaw));
        mapCtx.strokeStyle = '#e9e6df';
        mapCtx.lineWidth = 1.5;
        mapCtx.beginPath();
        mapCtx.moveTo(px, py);
        mapCtx.lineTo(px + Math.cos(angle) * 8, py + Math.sin(angle) * 8);
        mapCtx.stroke();
      }
    },
  };
}
