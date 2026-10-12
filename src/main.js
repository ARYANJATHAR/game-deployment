import { Game } from './Game.js';

const TIPS = [
  'Hold R to rewind time after a mistake — just like the pros (sort of).',
  'Chain drifts, jumps and near misses together without crashing to grow your skill multiplier.',
  'Orange XP boards are hidden all around the island. Smash them for bonus XP.',
  'Upgrade tyres before power: grip wins races.',
  'Press N to switch radio stations. Every track is generated live.',
  'Rally cars and trucks lose far less grip off-road.',
  'Speed traps reward your top speed; speed zones reward your average speed.',
  'Change the season in Settings — winter turns the island white.',
];

function loadingScreen(root) {
  const el = document.createElement('div');
  el.className = 'loading';
  el.innerHTML = `<div class="logo"><div class="l1">HORIZON RUSH</div><div class="l2">OPEN WORLD FESTIVAL</div></div>
    <div class="loadbar"><div></div></div><div class="loadlabel">Starting engines</div>
    <div class="loadtip">${TIPS[Math.floor(Math.random() * TIPS.length)]}</div>`;
  root.appendChild(el);
  return {
    set(f, label) {
      el.querySelector('.loadbar > div').style.width = `${Math.round(f * 100)}%`;
      el.querySelector('.loadlabel').textContent = label;
    },
    done() {
      el.classList.add('fade');
      setTimeout(() => el.remove(), 900);
    },
    error(msg) {
      el.querySelector('.loadlabel').textContent = msg;
      el.querySelector('.loadlabel').style.color = '#ff6b6b';
    },
  };
}

async function main() {
  const canvas = document.getElementById('game');
  const ui = document.getElementById('ui');
  const loader = loadingScreen(ui);
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) {
    loader.error('WebGL 2 is not available in this browser. Please use a recent Chrome, Edge, Firefox or Safari.');
    return;
  }
  const game = new Game(canvas, ui);
  window.__game = game;
  try {
    await game.init((f, label) => loader.set(f, label));
    loader.done();
    window.__ready = true;
  } catch (e) {
    console.error(e);
    loader.error(`Failed to start: ${e.message}`);
  }
}

main();
