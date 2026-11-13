import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strongestAttack, idleClip, deathClip } from '../src/animations.js';

const clips = (...list) => list.map((x) => (Array.isArray(x) ? { name: x[0], duration: x[1] } : { name: x, duration: 1 }));

test('escolhe o ataque mais forte de cada modelo do bestiário', () => {
  const pick = (...l) => strongestAttack(clips(...l))?.name;
  // Dragão: o sopro de fogo, não a mordida.
  assert.equal(pick('Idle', ['Attack_Bite', 1.1], ['Attack_Fire', 2.4], 'Hit', 'Death', 'Fly'), 'Attack_Fire');
  assert.equal(pick('Idle', ['Attack', 1], 'Hit', ['Attack_Heavy', 1.5], 'Roar'), 'Attack_Heavy');
  assert.equal(pick('Idle', 'Walk', ['Attack', 0.9], 'Hit', 'Death'), 'Attack');
  assert.equal(pick('Idle', ['Attack_Bite', 1], 'Threat'), 'Attack_Bite');
});

test('ignora guarda, golpe recebido e morte, e prefere arma a soco', () => {
  const pick = (...l) => strongestAttack(clips(...l))?.name;
  assert.equal(pick('CharacterArmature|Attacking_Idle', 'CharacterArmature|RecieveHit_Attacking', 'CharacterArmature|Punch', ['CharacterArmature|Dagger_Attack2', 1.2], ['CharacterArmature|Dagger_Attack', 1]),
    'CharacterArmature|Dagger_Attack2');
  assert.equal(pick('CharacterArmature|Idle_Gun_Shoot', 'CharacterArmature|Punch_Right', 'CharacterArmature|Sword_Slash', 'CharacterArmature|Kick_Left'), 'CharacterArmature|Sword_Slash');
  assert.equal(pick('CharacterArmature|Punch', 'CharacterArmature|Weapon', 'CharacterArmature|Yes'), 'CharacterArmature|Weapon');
  assert.equal(pick('Idle', 'Walk', 'Death'), undefined);
});

test('idle de verdade, não a guarda de ataque', () => {
  assert.equal(idleClip(clips('Attacking_Idle', 'Dagger_Attack', 'Idle')).name, 'Idle');
  assert.equal(idleClip(clips('BatArmature|Bat_Attack', 'BatArmature|Bat_Flying', 'BatArmature|Bat_Hit')).name, 'BatArmature|Bat_Flying');
  assert.equal(idleClip(clips('MonsterArmature|Bite_Front', 'MonsterArmature|Flying')).name, 'MonsterArmature|Flying');
});

test('acha o clipe de morte, com ou sem o prefixo do esqueleto', () => {
  assert.equal(deathClip(clips('Idle', 'Attack', 'Hit', 'Death')).name, 'Death');
  assert.equal(deathClip(clips('BatArmature|Bat_Attack', 'BatArmature|Bat_Death')).name, 'BatArmature|Bat_Death');
  assert.equal(deathClip(clips('Armature|Swim')), null);
});
